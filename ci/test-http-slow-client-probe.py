#!/usr/bin/env python3
"""Offline slow-client probe oracle tests; no Oreslang compiler/runtime."""
import importlib.util
from pathlib import Path
import socketserver
import threading
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location(
    "http_slow_client_probe", Path(__file__).with_name("http-slow-client-probe.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class FakeServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def local_run(reply, *, delay=0.0, max_wait=0.2, interval=0.04, prefix=None):
    # Local TCP server consumes prefix; may reject, close, or keep silent.
    class Handler(socketserver.BaseRequestHandler):
        def handle(self):
            self.request.recv(4096)
            if delay:
                threading.Event().wait(delay)
            if reply is not None:
                try:
                    self.request.sendall(reply)
                except OSError:
                    pass
    with FakeServer(("127.0.0.1", 0), Handler) as server:
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            return probe.watch_stall(probe.HEADER_PREFIX if prefix is None else prefix,
                                     host="127.0.0.1",
                                     port=server.server_address[1],
                                     max_wait=max_wait, interval=interval)
        finally:
            server.shutdown()
            worker.join(timeout=1)


class SlowClientOracleTests(unittest.TestCase):
    def test_408_valid_rejection(self):
        self.assertEqual(probe.parse_status(b"HTTP/1.1 408 Request Timeout\r\n"), 408)

    def test_503_valid_rejection(self):
        self.assertEqual(probe.parse_status(b"HTTP/1.1 503 Unavailable\r\n"), 503)

    def test_599_valid_rejection(self):
        self.assertEqual(probe.parse_status(b"HTTP/1.1 599 Error\r\n"), 599)

    def test_200_not_rejection(self):
        with self.assertRaises(AssertionError):
            probe.parse_status(b"HTTP/1.1 200 OK\r\n")

    def test_302_not_rejection(self):
        with self.assertRaises(AssertionError):
            probe.parse_status(b"HTTP/1.1 302 Found\r\n")

    def test_100_not_rejection(self):
        with self.assertRaises(AssertionError):
            probe.parse_status(b"HTTP/1.1 100 Continue\r\n")

    def test_600_not_valid_status(self):
        with self.assertRaises(AssertionError):
            probe.parse_status(b"HTTP/1.1 600 Invalid\r\n")

    def test_lf_only_not_valid_status(self):
        with self.assertRaises(AssertionError):
            probe.parse_status(b"HTTP/1.1 408\n")

    def test_partial_status_not_valid(self):
        with self.assertRaises(AssertionError):
            probe.parse_status(b"HTTP/1.1 408")

    def test_overlong_status_fails(self):
        with self.assertRaises(AssertionError):
            probe.parse_status(b"HTTP/1.1 408 " + b"x" * 1025 + b"\r\n")

    def test_real_tcp_408_passes(self):
        result, elapsed, _ = local_run(b"HTTP/1.1 408 Request Timeout\r\n\r\n")
        self.assertEqual(result, 408)
        self.assertLess(elapsed, 0.2)

    def test_real_tcp_200_fails(self):
        with self.assertRaises(AssertionError):
            local_run(b"HTTP/1.1 200 OK\r\n\r\n")

    def test_real_tcp_clean_close_passes(self):
        result, _, _ = local_run(b"")
        self.assertEqual(result, "closed")

    def test_real_tcp_silence_times_out(self):
        with self.assertRaises(AssertionError):
            local_run(b"", delay=0.35, max_wait=0.15)

    def test_real_tcp_malformed_status_fails(self):
        with self.assertRaises(AssertionError):
            local_run(b"NOTHTTP\r\n")

    def test_real_tcp_truncated_status_fails(self):
        with self.assertRaises(AssertionError):
            local_run(b"HTTP/1.1 408")

    def test_real_tcp_trickle_sent_during_delay(self):
        result, _, trickles = local_run(b"HTTP/1.1 408\r\n", delay=0.11, max_wait=0.25)
        self.assertEqual(result, 408)
        self.assertGreaterEqual(trickles, 1)

    def test_bad_probe_bounds_fail_before_connect(self):
        with mock.patch.object(probe.socket, "create_connection") as conn:
            for kw in ({"max_wait": 0}, {"interval": 0}, {"interval": 16},
                       {"interval": 0.4, "max_wait": 0.3}):
                with self.subTest(kw=kw), self.assertRaises(AssertionError):
                    probe.watch_stall(b"X", **kw)
            conn.assert_not_called()

    def test_recovery_wrong_body_fails(self):
        class Result:
            status = 200
            def read(self):
                return b"wrong"
        fake = mock.MagicMock()
        fake.getresponse.return_value = Result()
        with mock.patch.object(probe.http.client, "HTTPConnection", return_value=fake):
            with self.assertRaises(AssertionError):
                probe.check_recovery()
        fake.close.assert_called_once()

    def test_recovery_exact_body_passes(self):
        class Result:
            status = 200
            def read(self):
                return b"hello from oreslang"
        fake = mock.MagicMock()
        fake.getresponse.return_value = Result()
        with mock.patch.object(probe.http.client, "HTTPConnection", return_value=fake):
            probe.check_recovery()
        fake.close.assert_called_once()

    def test_real_tcp_partial_body_408_with_trickling(self):
        result, elapsed, trickles = local_run(
            b"HTTP/1.1 408 Request Timeout\r\n\r\n",
            delay=0.11, max_wait=0.25, prefix=probe.BODY_PREFIX)
        self.assertEqual(result, 408)
        self.assertGreaterEqual(trickles, 1)
        self.assertLess(elapsed, 0.25)

    def test_main_checks_both_stalls_and_recovers_each_time(self):
        with mock.patch.object(probe, "watch_stall", side_effect=[
            (408, 4.0, 3), ("closed", 5.0, 4)]) as run:
            with mock.patch.object(probe, "check_recovery") as recovered:
                probe.main()
        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args_list[0].args[0], probe.HEADER_PREFIX)
        self.assertEqual(run.call_args_list[1].args[0], probe.BODY_PREFIX)
        self.assertEqual(recovered.call_count, 3)

    def test_main_rejects_overseven_second_stall(self):
        with mock.patch.object(probe, "watch_stall", return_value=(408, 7.5, 10)):
            with mock.patch.object(probe, "check_recovery"):
                with self.assertRaises(AssertionError):
                    probe.main()


if __name__ == "__main__":
    result = unittest.main(verbosity=1, exit=False).result
    if result.wasSuccessful():
        print(f"HTTP_SLOW_CLIENT_ORACLE_HOST_PASS scenarios={result.testsRun}")
    raise SystemExit(0 if result.wasSuccessful() else 1)
