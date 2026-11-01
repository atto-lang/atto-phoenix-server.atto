#!/usr/bin/env python3
"""Host-only, no-Oreslang regression tests for strict overload evidence."""
import importlib.util
from pathlib import Path
import socket
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location(
    "http_capacity_probe", Path(__file__).with_name("http-capacity-probe.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class CapacityOracleTests(unittest.TestCase):
    def test_400_is_rejection(self):
        self.assertEqual(probe.classify_status(b"HTTP/1.1 400 Bad Request\r\n"), 400)

    def test_503_is_explicit_overload(self):
        self.assertEqual(probe.classify_status(b"HTTP/1.1 503 Unavailable\r\n"), 503)

    def test_599_is_rejection(self):
        self.assertEqual(probe.classify_status(b"HTTP/1.1 599 Error\r\n"), 599)

    def test_clean_close_is_not_503(self):
        self.assertEqual(probe.classify_status(b""), "closed")

    def test_successful_200_is_not_rejection(self):
        with self.assertRaises(AssertionError):
            probe.classify_status(b"HTTP/1.1 200 OK\r\n")

    def test_redirect_302_is_not_rejection(self):
        with self.assertRaises(AssertionError):
            probe.classify_status(b"HTTP/1.1 302 Found\r\n")

    def test_interim_100_is_not_rejection(self):
        with self.assertRaises(AssertionError):
            probe.classify_status(b"HTTP/1.1 100 Continue\r\n")

    def test_status_600_is_invalid(self):
        with self.assertRaises(AssertionError):
            probe.classify_status(b"HTTP/1.1 600 Invalid\r\n")

    def test_lf_only_line_is_invalid(self):
        with self.assertRaises(AssertionError):
            probe.classify_status(b"HTTP/1.1 503\n")

    def test_truncated_line_is_invalid(self):
        with self.assertRaises(AssertionError):
            probe.classify_status(b"HTTP/1.1 503")

    def test_non_http_is_invalid(self):
        with self.assertRaises(AssertionError):
            probe.classify_status(b"NOTHTTP\r\n")

    def test_overlong_status_is_invalid(self):
        with self.assertRaises(AssertionError):
            probe.classify_status(b"HTTP/1.1 503 " + b"a" * 1025 + b"\r\n")

    def test_valid_explicit_503_among_errors(self):
        self.assertEqual(probe.assess_capacity(80, [408, "closed", 503, 503]), 2)

    def test_65_held_sockets_required(self):
        with self.assertRaises(AssertionError):
            probe.assess_capacity(64, [503])

    def test_64_at_higher_required_threshold_fails(self):
        with self.assertRaises(AssertionError):
            probe.assess_capacity(66, [503], required=70)

    def test_silent_saturation_is_not_proof(self):
        with self.assertRaises(AssertionError):
            probe.assess_capacity(80, [])

    def test_only_connection_closures_are_not_503(self):
        with self.assertRaises(AssertionError):
            probe.assess_capacity(80, ["closed", "closed"])

    def test_only_timeout_408_is_not_503(self):
        with self.assertRaises(AssertionError):
            probe.assess_capacity(80, [408, 408])

    def test_pending_socket_is_not_rejection(self):
        with self.assertRaises(AssertionError):
            probe.assess_capacity(80, ["pending", 503])

    def test_successful_status_is_not_allowed(self):
        with self.assertRaises(AssertionError):
            probe.assess_capacity(80, [503, 200])

    def test_more_outcomes_than_connections_is_invalid(self):
        with self.assertRaises(AssertionError):
            probe.assess_capacity(65, [503] * 66)

    def test_socketpair_observes_real_503(self):
        receiver, sender = socket.socketpair()
        try:
            sender.sendall(b"HTTP/1.1 503 Service Unavailable\r\n\r\n")
            outcomes, pending = probe.collect_responses([receiver], seconds=0.2)
            self.assertEqual((outcomes, pending), ([503], 0))
        finally:
            receiver.close()
            sender.close()

    def test_socketpair_silence_stays_pending(self):
        receiver, sender = socket.socketpair()
        try:
            outcomes, pending = probe.collect_responses([receiver], seconds=0.02)
            self.assertEqual((outcomes, pending), ([], 1))
        finally:
            receiver.close()
            sender.close()

    def test_socketpair_200_fails(self):
        receiver, sender = socket.socketpair()
        try:
            sender.sendall(b"HTTP/1.1 200 OK\r\n\r\n")
            with self.assertRaises(AssertionError):
                probe.collect_responses([receiver], seconds=0.2)
        finally:
            receiver.close()
            sender.close()

    def test_recovery_requires_two_consecutive_healthy_requests(self):
        with mock.patch.object(probe, "healthy", side_effect=[True, False, True, True]) as check:
            with mock.patch.object(probe.time, "sleep"):
                probe.wait_for_recovery(seconds=1)
        self.assertEqual(check.call_count, 4)

    def test_invalid_saturation_setup_rejected_before_network(self):
        with mock.patch.object(probe, "healthy") as check:
            for attempts, minimum in ((64, 65), (80, 64), (65, 80)):
                with self.subTest(attempts=attempts, minimum=minimum):
                    with self.assertRaises(AssertionError):
                        probe.verify_saturation(attempts=attempts, minimum=minimum)
            check.assert_not_called()

    def test_partial_connect_returns_owned_socket_and_exact_request(self):
        class FakeSocket:
            def __init__(self):
                self.messages = []
                self.timeout = None
                self.closed = False
            def settimeout(self, value):
                self.timeout = value
            def sendall(self, data):
                self.messages.append(data)
            def close(self):
                self.closed = True

        sock = FakeSocket()
        with mock.patch.object(probe.socket, "create_connection", return_value=sock):
            received = probe.connect_partial(0)
        self.assertIs(received, sock)
        self.assertEqual(sock.messages, [probe.PENDING_BODY])
        self.assertEqual(sock.timeout, 2.0)
        self.assertFalse(sock.closed)
        sock.close()

    def test_partial_connect_write_failure_closes_socket(self):
        class FakeSocket:
            def __init__(self):
                self.closed = False
            def settimeout(self, value):
                pass
            def sendall(self, data):
                raise BrokenPipeError("simulated transport abort")
            def close(self):
                self.closed = True

        sock = FakeSocket()
        with mock.patch.object(probe.socket, "create_connection", return_value=sock):
            with self.assertRaises(BrokenPipeError):
                probe.connect_partial(0)
        self.assertTrue(sock.closed)

    def test_saturation_success_cleans_all_eighty_connections(self):
        connections = []

        class TrackedSocket:
            def __init__(self):
                self.closed = False
            def close(self):
                self.closed = True

        def dial(_):
            sock = TrackedSocket()
            connections.append(sock)
            return sock

        with mock.patch.object(probe, "healthy", return_value=True), \
             mock.patch.object(probe, "connect_partial", side_effect=dial) as opened, \
             mock.patch.object(probe, "collect_responses", return_value=([503, 408], 78)), \
             mock.patch.object(probe, "wait_for_recovery") as recovered:
            probe.verify_saturation()
        self.assertEqual(opened.call_count, 80)
        self.assertEqual(len(connections), 80)
        self.assertTrue(all(sock.closed for sock in connections))
        recovered.assert_called_once()

    def test_failed_saturation_still_closes_every_connection(self):
        connections = []

        class TrackedSocket:
            def __init__(self):
                self.closed = False
            def close(self):
                self.closed = True

        def dial(_):
            sock = TrackedSocket()
            connections.append(sock)
            return sock

        with mock.patch.object(probe, "healthy", return_value=True), \
             mock.patch.object(probe, "connect_partial", side_effect=dial), \
             mock.patch.object(probe, "collect_responses", return_value=([408], 79)), \
             mock.patch.object(probe, "wait_for_recovery") as recovered:
            with self.assertRaises(AssertionError):
                probe.verify_saturation()
        self.assertEqual(len(connections), 80)
        self.assertTrue(all(sock.closed for sock in connections))
        recovered.assert_not_called()

    def test_insufficient_established_connections_cleanup_is_total(self):
        connections = []

        class TrackedSocket:
            def __init__(self):
                self.closed = False
            def close(self):
                self.closed = True

        def dial(i):
            if i >= 64:
                raise TimeoutError("synthetic admission failure")
            sock = TrackedSocket()
            connections.append(sock)
            return sock

        with mock.patch.object(probe, "healthy", return_value=True), \
             mock.patch.object(probe, "connect_partial", side_effect=dial), \
             mock.patch.object(probe, "collect_responses") as observed:
            with self.assertRaises(AssertionError):
                probe.verify_saturation()
        self.assertEqual(len(connections), 64)
        self.assertTrue(all(sock.closed for sock in connections))
        observed.assert_not_called()


if __name__ == "__main__":
    result = unittest.main(verbosity=1, exit=False).result
    if result.wasSuccessful():
        print(f"HTTP_CAPACITY_ORACLE_HOST_PASS scenarios={result.testsRun}")
    raise SystemExit(0 if result.wasSuccessful() else 1)
