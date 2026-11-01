#!/usr/bin/env python3
"""Offline contract self-tests: mock the wire probe; never use private source."""
import importlib.util
from pathlib import Path
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location(
    "phoenix_extra", Path(__file__).with_name("http-wire-extra-probe.py"))
extra = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extra)


class ExtraOracleTests(unittest.TestCase):
    def test_mime_matrix_accepts_only_exact_canonical_bodies(self):
        def reply(method, path, data=None, headers=None):
            content_type = headers["Content-Type"]
            if content_type in extra.CANONICAL:
                return 200, data
            return 415, b"text/plain required"
        with mock.patch.object(extra.probe, "exchange", side_effect=reply) as run:
            extra.verify_mime()
            self.assertEqual(run.call_count, len(extra.CANONICAL) + len(extra.REJECTED))

    def test_mime_canonical_200_wrong_body_fails(self):
        with mock.patch.object(extra.probe, "exchange", return_value=(200, b"wrong")):
            with self.assertRaises(AssertionError):
                extra.verify_mime()

    def test_mime_unsupported_200_fails(self):
        def reply(method, path, data=None, headers=None):
            return 200, data
        with mock.patch.object(extra.probe, "exchange", side_effect=reply):
            with self.assertRaises(AssertionError):
                extra.verify_mime()

    def test_mime_unsupported_4xx_other_than_415_fails(self):
        def reply(method, path, data=None, headers=None):
            return (200, data) if headers["Content-Type"] in extra.CANONICAL else (400, b"bad")
        with mock.patch.object(extra.probe, "exchange", side_effect=reply):
            with self.assertRaises(AssertionError):
                extra.verify_mime()

    def test_routes_require_exact_status(self):
        def reply(method, path, data=None, headers=None):
            if (method, path) == ("GET", "/hello"):
                return 200, b"hello from oreslang"
            expected = {(method, path): code for method, path, code in extra.ROUTES}
            return expected[(method, path)], b"not found"
        with mock.patch.object(extra.probe, "exchange", side_effect=reply) as run:
            extra.verify_route_matrix()
            self.assertEqual(run.call_count, len(extra.ROUTES) + 1)

    def test_route_wrong_status_fails(self):
        def reply(method, path, data=None, headers=None):
            return (200, b"hello from oreslang")
        with mock.patch.object(extra.probe, "exchange", side_effect=reply):
            with self.assertRaises(AssertionError):
                extra.verify_route_matrix()

    def test_framing_corpus_is_unique_and_bytes_only(self):
        cases = extra.malformed_framing_cases()
        self.assertEqual(len(cases), 7)
        self.assertEqual(len(set(cases.values())), len(cases))
        for request in cases.values():
            self.assertIsInstance(request, bytes)
            self.assertTrue(request.startswith(b"POST /echo HTTP/1.1\r\n"))
            self.assertIn(b"\r\n\r\n", request)
            self.assertIn(b"Connection: close\r\n", request)

    def test_framing_calls_raw_rejection_for_every_case(self):
        with mock.patch.object(extra.probe, "reject_raw", return_value=400) as reject, \
             mock.patch.object(extra.probe, "exchange", return_value=(200, b"hello from oreslang")):
            extra.verify_framing_variants()
            self.assertEqual(reject.call_count, 7)

    def test_framing_oracle_error_fails_closed(self):
        with mock.patch.object(extra.probe, "reject_raw", side_effect=AssertionError("2xx")):
            with self.assertRaises(AssertionError):
                extra.verify_framing_variants()

    def test_framing_timeout_fails_closed(self):
        import socket
        with mock.patch.object(extra.probe, "reject_raw", side_effect=socket.timeout("stalled")):
            with self.assertRaises(socket.timeout):
                extra.verify_framing_variants()

    def test_framing_recovery_wrong_body_fails(self):
        with mock.patch.object(extra.probe, "reject_raw", return_value="closed"), \
             mock.patch.object(extra.probe, "exchange", return_value=(200, b"wrong")):
            with self.assertRaises(AssertionError):
                extra.verify_framing_variants()


if __name__ == "__main__":
    result = unittest.main(verbosity=1, exit=False).result
    if result.wasSuccessful():
        print(f"HTTP_WIRE_EXTRA_HOST_PASS scenarios={result.testsRun}")
    raise SystemExit(0 if result.wasSuccessful() else 1)
