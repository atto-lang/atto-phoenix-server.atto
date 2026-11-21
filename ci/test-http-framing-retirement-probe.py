#!/usr/bin/env python3
"""Host-only adversarial validation; fake TCP servers never run Oreslang."""
import importlib.util
from pathlib import Path
import socketserver
import threading
import time
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("retirement", Path(__file__).with_name("http-framing-retirement-probe.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


def fake_server(response, *, delay=0.0):
    class Handler(socketserver.BaseRequestHandler):
        def handle(self):
            self.request.settimeout(0.25)
            try:
                self.request.recv(8192)
            except OSError:
                pass
            if response is not None:
                try:
                    self.request.sendall(response)
                except OSError:
                    pass
            if delay:
                time.sleep(delay)
    class Server(socketserver.TCPServer):
        allow_reuse_address = True
    return Server(("127.0.0.1", 0), Handler)


def simulate(response, *, delay=0.0, timeout=0.5):
    with fake_server(response, delay=delay) as server:
        t = threading.Thread(target=server.handle_request, daemon=True)
        t.start()
        try:
            return probe.retirement_probe(b"invalid", port=server.server_address[1], max_seconds=timeout)
        finally:
            t.join(timeout=0.8)


class RetirementTests(unittest.TestCase):
    def test_empty_close_passes(self):
        self.assertEqual(simulate(b""), "closed-empty")

    def test_http_400_then_close_passes(self):
        self.assertEqual(simulate(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"), 400)

    def test_http_503_then_close_passes(self):
        self.assertEqual(simulate(b"HTTP/1.1 503 Unavailable\r\n\r\n"), 503)

    def test_http_200_fails(self):
        with self.assertRaises(AssertionError):
            simulate(b"HTTP/1.1 200 OK\r\n\r\n")

    def test_302_fails(self):
        with self.assertRaises(AssertionError):
            simulate(b"HTTP/1.1 302 Found\r\n\r\n")

    def test_first_400_then_200_pipeline_fails(self):
        with self.assertRaisesRegex(AssertionError, "additional response"):
            simulate(b"HTTP/1.1 400 Bad Request\r\n\r\nHTTP/1.1 200 OK\r\n\r\n")

    def test_second_400_response_also_fails(self):
        with self.assertRaisesRegex(AssertionError, "additional response"):
            simulate(b"HTTP/1.1 400 Bad Request\r\n\r\nHTTP/1.1 400 Bad Request\r\n\r\n")

    def test_silent_keepalive_fails(self):
        with self.assertRaises(AssertionError):
            simulate(None, delay=0.3, timeout=0.1)

    def test_http_lf_only_status_fails(self):
        with self.assertRaises(AssertionError):
            simulate(b"HTTP/1.1 400 Bad Request\n\n")

    def test_truncated_status_fails(self):
        with self.assertRaises(AssertionError):
            simulate(b"HTTP/1.1 400 Bad Request")

    def test_overlong_status_fails(self):
        with self.assertRaises(AssertionError):
            simulate(b"HTTP/1.1 400 " + b"x" * 2000 + b"\r\n")

    def test_oversize_response_fails(self):
        with self.assertRaises(AssertionError):
            simulate(b"HTTP/1.1 400 Bad Request\r\n" + b"x" * 9000)

    def test_corpus_is_distinct_and_pipelined(self):
        self.assertEqual(len(probe.CASES), 3)
        self.assertEqual(len(set(probe.CASES.values())), 3)
        self.assertTrue(all(p.endswith(probe.FOLLOWUP) for p in probe.CASES.values()))

    def test_bounded_recovery_orchestration(self):
        with mock.patch.object(probe, "retirement_probe", return_value=400) as p, \
             mock.patch.object(probe, "recovery") as r:
            probe.main()
            self.assertEqual(p.call_count, 3)
            self.assertEqual(r.call_count, 4)

    def test_recovery_error_cannot_be_ignored(self):
        with mock.patch.object(probe, "retirement_probe", return_value=400), \
             mock.patch.object(probe, "recovery", side_effect=AssertionError("unhealthy")):
            with self.assertRaises(AssertionError):
                probe.main()


if __name__ == "__main__":
    result = unittest.main(verbosity=1, exit=False).result
    if result.wasSuccessful():
        print(f"HTTP_FRAMING_RETIREMENT_HOST_PASS scenarios={result.testsRun}")
    raise SystemExit(0 if result.wasSuccessful() else 1)
