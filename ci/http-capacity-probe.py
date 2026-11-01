#!/usr/bin/env python3
"""Strict loopback admission saturation test, separate from churn coverage.

Run only on a reviewed native Oreslang guest. 80 deliberately incomplete
request bodies test 64-slot admission. A real HTTP 503 must be observed:
TCP acceptance, resets, and ordinary 408 timeouts alone are not proof of 503.
"""
import concurrent.futures
import http.client
import re
import select
import socket
import sys
import time

HOST = "127.0.0.1"
PORT = 8082
PENDING_BODY = (
    b"POST /echo HTTP/1.1\r\nHost: 127.0.0.1\r\n"
    b"Content-Type: text/plain\r\nContent-Length: 16384\r\n"
    b"Connection: close\r\n\r\nx"
)


def require(condition, description):
    if not condition:
        raise AssertionError(description)


def classify_status(first_bytes):
    """Return an HTTP error code or 'closed'. Reject success and ambiguity."""
    if first_bytes == b"":
        return "closed"
    pos = first_bytes.find(b"\r\n")
    require(pos >= 0 and pos <= 1024, "incomplete or overlong HTTP status line")
    status = first_bytes[:pos]
    match = re.fullmatch(rb"HTTP/1\.[01] ([0-9]{3})(?: [^\r\n]*)?", status)
    require(match is not None, "malformed HTTP status")
    code = int(match.group(1))
    require(400 <= code <= 599, f"unexpected response under overload: {code}")
    return code


def assess_capacity(established, outcomes, required=65):
    """Require evidence of pressure AND an explicit 503, not just dropped TCP."""
    require(isinstance(established, int) and established >= required,
            f"not enough held sockets to exceed admission: {established} < {required}")
    require(0 < len(outcomes) <= established, "no observed overload outcomes")
    for value in outcomes:
        require(value == "closed" or (isinstance(value, int) and 400 <= value <= 599),
                f"invalid overload outcome: {value!r}")
    count_503 = sum(value == 503 for value in outcomes)
    require(count_503 > 0,
            "no explicit HTTP 503 observed (queued/closed/408 requests are not 503 proof)")
    return count_503


def connect_partial(_):
    sock = socket.create_connection((HOST, PORT), timeout=3.0)
    try:
        sock.settimeout(2.0)
        sock.sendall(PENDING_BODY)
        return sock
    except BaseException:
        sock.close()
        raise


def collect_responses(sockets, seconds=7.0):
    """Sample socket readiness until the deadline, without counting silence."""
    pending = list(sockets)
    outcomes = []
    deadline = time.monotonic() + seconds
    while pending and time.monotonic() < deadline:
        remaining = min(0.5, max(0.0, deadline - time.monotonic()))
        ready, _, _ = select.select(pending, [], [], remaining)
        for sock in ready:
            pending.remove(sock)
            try:
                sock.settimeout(1.0)
                response = bytearray()
                while b"\r\n" not in response and len(response) <= 1024:
                    piece = sock.recv(1024)
                    if not piece:
                        break
                    response.extend(piece)
                outcomes.append(classify_status(bytes(response)))
            except ConnectionResetError:
                outcomes.append("closed")
    return outcomes, len(pending)


def healthy():
    conn = http.client.HTTPConnection(HOST, PORT, timeout=2.0)
    try:
        conn.request("GET", "/hello")
        response = conn.getresponse()
        body = response.read()
        return (response.status, body) == (200, b"hello from oreslang")
    finally:
        conn.close()


def wait_for_recovery(seconds=8.0):
    deadline = time.monotonic() + seconds
    successes = 0
    while time.monotonic() < deadline:
        try:
            successes = successes + 1 if healthy() else 0
            if successes >= 2:
                return
        except (OSError, http.client.HTTPException):
            successes = 0
        time.sleep(0.2)
    raise AssertionError("listener did not recover two consecutive healthy requests")


def verify_saturation(attempts=80, minimum=65):
    require(attempts > 64 and minimum > 64 and minimum <= attempts,
            "invalid saturation parameters")
    require(healthy(), "listener unhealthy before saturation")
    held = []
    failed = 0
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
            future_list = [pool.submit(connect_partial, i) for i in range(attempts)]
            # Socket dials each have a 3s timeout. Collect every completed
            # future; timing out only on future.result() could orphan a socket
            # which connects later and never enters the final cleanup list.
            for future in future_list:
                try:
                    held.append(future.result())
                except OSError:
                    failed += 1
        require(len(held) >= minimum,
                f"only {len(held)} held connections of {attempts}; saturation inconclusive")
        outcomes, still_pending = collect_responses(held, seconds=7)
        count_503 = assess_capacity(len(held), outcomes, required=minimum)
    finally:
        for sock in held:
            sock.close()
    wait_for_recovery()
    print(f"HTTP_CAPACITY_PASS attempted={attempts} established={len(held)} "
          f"failed_connect={failed} explicit_503={count_503} pending={still_pending}")


if __name__ == "__main__":
    try:
        verify_saturation()
    except Exception as exc:
        print(f"HTTP_CAPACITY_FAIL {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)
