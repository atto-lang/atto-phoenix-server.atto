#!/usr/bin/env python3
"""Strict ambiguous HTTP framing connection retirement probe.

Real 127.0.0.1:8082 network test; run only after approved native guest startup.
A 4xx/5xx (or empty close) must be followed by close within a bounded deadline.
This is not a substitute for server dispatch instrumentation.
"""
import http.client
import re
import socket
import sys
import time

HOST = "127.0.0.1"
PORT = 8082
MAX_SECONDS = 7.0
MAX_BYTES = 8192
PREFIX = (b"POST /echo HTTP/1.1\r\nHost: 127.0.0.1\r\n"
          b"Content-Type: text/plain\r\n")
FOLLOWUP = b"GET /hello HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
CASES = {
    "cl_conflict_with_followup": PREFIX +
        b"Content-Length: 4\r\nContent-Length: 8\r\nConnection: close\r\n\r\npingpong" + FOLLOWUP,
    "te_cl_with_followup": PREFIX +
        b"Transfer-Encoding: chunked\r\nContent-Length: 4\r\nConnection: close\r\n\r\n0\r\n\r\n" + FOLLOWUP,
    "cl_comma_conflict_with_followup": PREFIX +
        b"Content-Length: 4, 8\r\nConnection: close\r\n\r\npingpong" + FOLLOWUP,
}


def judge_closed_response(data):
    """All accumulated response bytes are available ONLY after socket retirement."""
    if not isinstance(data, bytes) or len(data) > MAX_BYTES:
        raise AssertionError("invalid/oversize response")
    if not data:
        return "closed-empty"
    line, separator, rest = data.partition(b"\r\n")
    if not separator or len(line) > 1024:
        raise AssertionError("missing CRLF / incomplete status")
    m = re.fullmatch(rb"HTTP/1\.[01] ([0-9]{3})(?: [^\r\n]*)?", line)
    if m is None or not 400 <= int(m.group(1)) <= 599:
        raise AssertionError("framing ambiguity resulted in non-error status")
    # A second HTTP response indicates the pipeline may have been admitted.
    if re.search(rb"HTTP/1\.[01] [0-9]{3}", rest):
        raise AssertionError("additional response after ambiguous framing")
    return int(m.group(1))


def retirement_probe(payload, host=HOST, port=PORT, max_seconds=MAX_SECONDS):
    if not 0.1 <= max_seconds <= 15:
        raise ValueError("invalid bound")
    deadline = time.monotonic() + max_seconds
    with socket.create_connection((host, port), timeout=max_seconds) as sock:
        sock.sendall(payload)
        result = bytearray()
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                raise AssertionError("ambiguous request connection was not retired")
            sock.settimeout(left)
            try:
                part = sock.recv(min(2048, MAX_BYTES + 1 - len(result)))
            except socket.timeout as exc:
                raise AssertionError("silent/keepalive ambiguous connection") from exc
            except ConnectionResetError:
                if result:
                    raise AssertionError("reset after partial HTTP response")
                return "reset-empty"
            if not part:
                return judge_closed_response(bytes(result))
            result.extend(part)
            if len(result) > MAX_BYTES:
                raise AssertionError("ambiguous response exceeded byte budget")


def recovery():
    conn = http.client.HTTPConnection(HOST, PORT, timeout=3)
    try:
        conn.request("GET", "/hello")
        reply = conn.getresponse()
        body = reply.read()
        if (reply.status, body) != (200, b"hello from oreslang"):
            raise AssertionError("listener failed exact-body recovery")
    finally:
        conn.close()


def main():
    recovery()
    for label, request in CASES.items():
        outcome = retirement_probe(request)
        recovery()
        print(f"PASS ambiguous framing connection retired {label} result={outcome}")
    print(f"HTTP_FRAMING_RETIREMENT_PASS cases={len(CASES)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"HTTP_FRAMING_RETIREMENT_FAIL {type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)
