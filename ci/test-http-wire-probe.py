#!/usr/bin/env python3
"""Offline test-oracle self-tests; never connects to an Oreslang guest."""
import importlib.util
from pathlib import Path
import socket
import socketserver
import threading
import time
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location(
    "http_wire_probe", Path(__file__).with_name("http-wire-probe.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
REQUEST = b"GET /hello HTTP/1.1\r\nHost: localhost\r\n\r\n"


def fake_response(reply, timeout=0.5, delay=0.0):
    """Run one local TCP exchange to test the rejection oracle only."""
    class Handler(socketserver.BaseRequestHandler):
        def handle(self):
            self.request.recv(8192)
            if delay:
                time.sleep(delay)
            if reply:
                try:
                    self.request.sendall(reply)
                except OSError:
                    pass
    with socketserver.TCPServer(("127.0.0.1", 0), Handler) as server:
        worker = threading.Thread(target=server.handle_request, daemon=True)
        worker.start()
        try:
            return probe.reject_raw(REQUEST, port=server.server_address[1], timeout=timeout)
        finally:
            worker.join(timeout=0.6)


class OracleTests(unittest.TestCase):
    def test_closed_connection_is_rejection(self):
        self.assertEqual(fake_response(None), "closed")

    def test_http_400_is_rejection(self):
        self.assertEqual(fake_response(b"HTTP/1.1 400 Bad Request\r\n\r\n"), 400)

    def test_http_503_is_rejection(self):
        self.assertEqual(fake_response(b"HTTP/1.1 503 Unavailable\r\n\r\n"), 503)

    def test_http_200_is_not_rejection(self):
        with self.assertRaises(AssertionError):
            fake_response(b"HTTP/1.1 200 OK\r\n\r\n")

    def test_http_204_is_not_rejection(self):
        with self.assertRaises(AssertionError):
            fake_response(b"HTTP/1.1 204 No Content\r\n\r\n")

    def test_redirect_is_not_rejection(self):
        with self.assertRaises(AssertionError):
            fake_response(b"HTTP/1.1 302 Found\r\n\r\n")

    def test_interim_http_100_is_not_rejection(self):
        with self.assertRaises(AssertionError):
            fake_response(b"HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\n\r\n")

    def test_invalid_status_is_not_rejection(self):
        with self.assertRaises(AssertionError):
            fake_response(b"NOT_HTTP\r\n")

    def test_truncated_status_is_not_rejection(self):
        with self.assertRaises(AssertionError):
            fake_response(b"HTTP/1.1 400")

    def test_silent_socket_timeout_is_not_rejection(self):
        with self.assertRaises(socket.timeout):
            fake_response(None, timeout=0.03, delay=0.15)

    def test_huge_status_line_is_not_rejection(self):
        with self.assertRaises(AssertionError):
            fake_response(b"HTTP/1.1 400 " + b"x" * 2048 + b"\r\n")

    def test_oversized_200_fails(self):
        with mock.patch.object(probe, "exchange", return_value=(200, b"echo")):
            with self.assertRaises(AssertionError):
                probe.verify_oversized()

    def test_oversized_413_passes(self):
        with mock.patch.object(probe, "exchange", return_value=(413, b"")):
            probe.verify_oversized()

    def test_oversized_timeout_fails(self):
        with mock.patch.object(probe, "exchange", side_effect=socket.timeout("stalled")):
            with self.assertRaises(socket.timeout):
                probe.verify_oversized()

    def test_concurrent_response_isolation(self):
        def echo(method, path, data=None, headers=None, timeout=7):
            return (200, b"hello from oreslang" if method == "GET" else data)
        with mock.patch.object(probe, "exchange", side_effect=echo):
            probe.verify_concurrent()

    def test_concurrent_wrong_response_fails(self):
        with mock.patch.object(probe, "exchange", return_value=(200, b"wrong")):
            with self.assertRaises(AssertionError):
                probe.verify_concurrent()


if __name__ == "__main__":
    result = unittest.main(verbosity=1, exit=False).result
    if result.wasSuccessful():
        print(f"HTTP_WIRE_ORACLE_HOST_PASS scenarios={result.testsRun}")
    raise SystemExit(0 if result.wasSuccessful() else 1)
