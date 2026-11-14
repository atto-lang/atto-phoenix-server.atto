#!/usr/bin/env python3
"""Fail-closed slow-client deadline tests for the approved native listener.

Measures a deadline from socket connection, even while peer trickles bytes.
A 4xx/5xx response or clean close is acceptable; silence, malformed status,
HTTP success, or a timeout beyond MAX_WAIT is not. Not precise 5s proof.
"""
import http.client
import re
import select
import socket
import sys
import time

HOST = "127.0.0.1"
PORT = 8082
MAX_WAIT = 7.0  # 5s configured deadline + conservative CI scheduling allowance
TRICKLE_INTERVAL = 0.65
HEADER_PREFIX = b"GET /hello HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Stall: "
BODY_PREFIX = (b"POST /echo HTTP/1.1\r\nHost: 127.0.0.1\r\n"
               b"Content-Type: text/plain\r\nContent-Length: 16384\r\n"
               b"Connection: close\r\n\r\nx")


def require(condition, why):
    if not condition:
        raise AssertionError(why)


def parse_status(line):
    require(len(line) <= 1024, "overlong HTTP status")
    require(line.endswith(b"\r\n"), "status must end in CRLF")
    match = re.fullmatch(rb"HTTP/1\.[01] ([0-9]{3})(?: [^\r\n]*)?\r\n", line)
    require(match is not None, "malformed HTTP status")
    status = int(match.group(1))
    require(400 <= status <= 599, f"unexpected success/redirect: {status}")
    return status


def watch_stall(prefix, *, max_wait=MAX_WAIT, interval=TRICKLE_INTERVAL,
                host=HOST, port=PORT):
    """Return (rejection status/closed, elapsed, trickles); never swallow a timeout."""
    require(0.05 <= max_wait <= 15 and 0.02 <= interval < max_wait,
            "invalid deadline probe bounds")
    start = time.monotonic()
    deadline = start + max_wait
    with socket.create_connection((host, port), timeout=min(3.0, max_wait)) as sock:
        sock.setblocking(False)
        sock.sendall(prefix)
        status = bytearray()
        trickles = 0
        next_write = time.monotonic() + interval
        while time.monotonic() < deadline:
            now = time.monotonic()
            wait = min(0.25, max(0.0, deadline - now), max(0.0, next_write - now))
            readable, _, _ = select.select([sock], [], [], wait)
            if readable:
                try:
                    chunk = sock.recv(1024)
                except ConnectionResetError:
                    require(not status, "reset after partial HTTP status")
                    return "closed", time.monotonic() - start, trickles
                if not chunk:
                    require(not status, "truncated HTTP status")
                    return "closed", time.monotonic() - start, trickles
                status.extend(chunk)
                require(len(status) <= 1024, "overlong HTTP status")
                if b"\n" in status:
                    line = bytes(status[:status.index(b"\n") + 1])
                    return parse_status(line), time.monotonic() - start, trickles
            if time.monotonic() >= next_write:
                try:
                    sock.sendall(b"x")
                except (BrokenPipeError, ConnectionResetError):
                    require(not status, "write failed after partial HTTP status")
                    return "closed", time.monotonic() - start, trickles
                trickles += 1
                next_write = time.monotonic() + interval
    raise AssertionError(f"silent slow-client socket exceeded {max_wait:.2f}s")


def check_recovery(host=HOST, port=PORT):
    conn = http.client.HTTPConnection(host, port, timeout=3.0)
    try:
        conn.request("GET", "/hello")
        response = conn.getresponse()
        body = response.read()
        require((response.status, body) == (200, b"hello from oreslang"),
                f"listener recovery failed: {response.status} {body[:80]!r}")
    finally:
        conn.close()


def main():
    check_recovery()
    for label, prefix in (("partial-header", HEADER_PREFIX),
                          ("partial-body", BODY_PREFIX)):
        status, elapsed, trickles = watch_stall(prefix)
        require(elapsed <= MAX_WAIT + 0.25, f"deadline exceeded: {elapsed:.2f}s")
        print(f"PASS slow-client {label} rejection={status} elapsed={elapsed:.2f}s trickles={trickles}")
        check_recovery()
    print("HTTP_SLOW_CLIENT_PASS bounded_recovery=2 deadline_bound_seconds=7")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"HTTP_SLOW_CLIENT_FAIL {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)
