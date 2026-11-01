#!/usr/bin/env python3
"""Additional exact-byte HTTP tests against the approved loopback Oreslang server.

Invoked only after trusted native startup. This is not compiler evidence by itself.
Negative raw requests require 4xx/5xx or close; timeouts are failures.
"""
import importlib.util
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location(
    "phoenix_wire_probe", Path(__file__).with_name("http-wire-probe.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

BODY = b"exact-mime-payload"
CANONICAL = (
    "text/plain",
    "text/plain; charset=utf-8",
    "text/plain;charset=utf-8",
)
REJECTED = (
    "text/plainx",
    "application/json",
    "text/plain;evil=true",
    "text/plain; charset=iso-8859-1",
    "text/plain; charset=utf-8;evil=true",
    "text/plain; charset=utf-8; charset=iso-8859-1",
    "text/plain;",
)
ROUTES = (
    ("GET", "/HELLO", 404),
    ("GET", "/hello/", 404),
    ("GET", "/missing", 404),
    ("OPTIONS", "/hello", 405),
    ("POST", "/hello", 405),
    ("PUT", "/echo", 405),
    ("DELETE", "/echo", 405),
    ("GET", "/echo", 405),
)


def verify_mime():
    for content_type in CANONICAL:
        status, echoed = probe.exchange(
            "POST", "/echo", BODY, {"Content-Type": content_type})
        probe.require((status, echoed) == (200, BODY),
                      f"MIME success mismatch: {content_type!r}, {status}, {echoed[:64]!r}")
    for content_type in REJECTED:
        status, echoed = probe.exchange(
            "POST", "/echo", BODY, {"Content-Type": content_type})
        probe.require(status == 415 and echoed != BODY,
                      f"MIME rejection mismatch: {content_type!r}, {status}")
    print(f"PASS MIME exact-body canonical={len(CANONICAL)} rejected={len(REJECTED)}")


def verify_route_matrix():
    status, body = probe.exchange("GET", "/hello")
    probe.require((status, body) == (200, b"hello from oreslang"),
                  "baseline /hello wrong status/body")
    for method, path, expected in ROUTES:
        status, _ = probe.exchange(method, path)
        probe.require(status == expected,
                      f"route isolation {method} {path}: expected {expected}, got {status}")
    print(f"PASS route and method isolation cases={len(ROUTES)}")


def malformed_framing_cases():
    base = b"POST /echo HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: text/plain\r\n"
    ending = b"Connection: close\r\n\r\n"
    return {
        "cl_conflict_reversed":
            base + b"Content-Length: 8\r\nContent-Length: 4\r\n" + ending + b"pingpong",
        "cl_conflict_comma_list":
            base + b"Content-Length: 4, 8\r\n" + ending + b"pingpong",
        "cl_sign_prefix":
            base + b"Content-Length: +4\r\n" + ending + b"ping",
        "cl_integer_overflow":
            base + b"Content-Length: 999999999999999999999999999999\r\n" + ending,
        "te_cl_reversed":
            base + b"Content-Length: 4\r\nTransfer-Encoding: chunked\r\n" + ending + b"0\r\n\r\n",
        "te_cl_case_folded":
            base + b"transfer-encoding: chunked\r\ncontent-length: 4\r\n" + ending + b"0\r\n\r\n",
        "te_cl_smuggled_followup":
            base + b"Transfer-Encoding: chunked\r\nContent-Length: 4\r\n" + ending +
            b"0\r\n\r\nGET /hello HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
    }


def verify_framing_variants():
    for label, request in malformed_framing_cases().items():
        probe.reject_raw(request)
        print(f"PASS ambiguous framing rejected {label}")
    status, body = probe.exchange("GET", "/hello")
    probe.require((status, body) == (200, b"hello from oreslang"),
                  "listener failed to recover after framing rejection")


def main():
    verify_mime()
    verify_route_matrix()
    verify_framing_variants()
    print("HTTP_WIRE_EXTRA_PASS listener=127.0.0.1:8082")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"HTTP_WIRE_EXTRA_FAIL {type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)
