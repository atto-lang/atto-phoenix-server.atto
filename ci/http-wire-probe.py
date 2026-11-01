#!/usr/bin/env python3
"""Real loopback HTTP acceptance probes; never a native/compiler substitute.

Run only after the exact pinned Oreslang listener has started. No dependencies
beyond Python 3's standard library. A socket timeout is NEVER a pass.
"""
import concurrent.futures
import http.client
import re
import socket
import sys
import time

HOST = "127.0.0.1"
PORT = 8082
CONNECT_TIMEOUT = 7.0


def exchange(method, path, data=None, headers=None, timeout=CONNECT_TIMEOUT):
    conn = http.client.HTTPConnection(HOST, PORT, timeout=timeout)
    try:
        conn.request(method, path, body=data, headers=headers or {})
        response = conn.getresponse()
        payload = response.read()
        return response.status, payload
    finally:
        conn.close()


def reject_raw(payload, host=HOST, port=PORT, timeout=CONNECT_TIMEOUT):
    """Require explicit HTTP 4xx/5xx or a clean connection close; not silence."""
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.settimeout(timeout)
        sock.sendall(payload)
        received = bytearray()
        while b"\n" not in received:
            part = sock.recv(1024)
            if not part:
                if received:
                    raise AssertionError("truncated HTTP status line")
                return "closed"
            received.extend(part)
            if len(received) > 1024:
                raise AssertionError("unbounded HTTP status line")
        line = bytes(received).split(b"\n", 1)[0].rstrip(b"\r")
        match = re.fullmatch(rb"HTTP/1\.[01] ([0-9]{3})(?: [^\r\n]*)?", line)
        if not match:
            raise AssertionError("invalid HTTP status line: " + repr(line))
        code = int(match.group(1))
        if not 400 <= code <= 599:
            raise AssertionError(f"unsafe/nonterminal HTTP status: {code}")
        return code


def verify_success():
    status, body = exchange("GET", "/hello")
    assert (status, body) == (200, b"hello from oreslang"), (status, body[:80])
    for length in (0, 1, 16383, 16384):
        payload = b"x" * length
        status, echoed = exchange("POST", "/echo", payload, {"Content-Type": "text/plain"})
        assert (status, echoed) == (200, payload), (length, status, len(echoed))
    print("PASS wire exact body 0/1/16383/16384 bytes")


def verify_oversized():
    payload = b"x" * 16385
    try:
        status, _ = exchange("POST", "/echo", payload, {"Content-Type": "text/plain"})
    except (http.client.RemoteDisconnected, ConnectionResetError, BrokenPipeError):
        print("PASS oversized completed body rejected by connection close")
        return
    assert status >= 400, f"oversized completed 16385-byte body returned {status}"
    print("PASS oversized completed body rejected by HTTP status")


def verify_bad_framing():
    header = b"POST /echo HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: text/plain\r\n"
    cases = {
        "conflicting_content_length":
            header + b"Content-Length: 4\r\nContent-Length: 8\r\nConnection: close\r\n\r\npingpong",
        "chunked_and_content_length":
            header + b"Transfer-Encoding: chunked\r\nContent-Length: 4\r\nConnection: close\r\n\r\n0\r\n\r\n",
        "nondecimal_content_length":
            header + b"Content-Length: NaN\r\nConnection: close\r\n\r\nping",
        "negative_content_length":
            header + b"Content-Length: -1\r\nConnection: close\r\n\r\nping",
        "duplicate_host":
            header + b"Host: example.invalid\r\nContent-Length: 4\r\nConnection: close\r\n\r\nping",
        "missing_host":
            b"POST /echo HTTP/1.1\r\nContent-Type: text/plain\r\nContent-Length: 4\r\nConnection: close\r\n\r\nping",
    }
    for label, request in cases.items():
        result = reject_raw(request)
        print(f"PASS {label} rejected ({result})")


def verify_concurrent():
    def run_one(i):
        if i % 2:
            return exchange("GET", "/hello")
        body = ("request-" + str(i)).encode("ascii")
        return exchange("POST", "/echo", body, {"Content-Type": "text/plain"})
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(run_one, i) for i in range(32)]
        for i, future in enumerate(futures):
            status, body = future.result(timeout=12)
            expected = b"hello from oreslang" if i % 2 else ("request-" + str(i)).encode("ascii")
            assert (status, body) == (200, expected), (i, status, body[:80])
    print("PASS 32 concurrent requests; all response bodies isolated")


def verify_partial_header_deadline():
    start = time.monotonic()
    request = b"GET /hello HTTP/1.1\r\nHost: 127.0.0.1\r\n"
    result = reject_raw(request, timeout=8.5)
    elapsed = time.monotonic() - start
    assert elapsed <= 8.5, f"partial-header handling exceeded 8.5s: {elapsed:.2f}s"
    print(f"PASS incomplete header bounded rejection/close ({elapsed:.2f}s; {result})")


def main():
    verify_success()
    verify_oversized()
    verify_bad_framing()
    verify_concurrent()
    verify_partial_header_deadline()
    verify_success()
    print("HTTP_WIRE_PROBE_PASS listener=127.0.0.1:8082")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"HTTP_WIRE_PROBE_FAIL {type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)
