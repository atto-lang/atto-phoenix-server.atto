# Oreslang LiveView v1 — independent reference slice

**Status: host-tested reference code; NOT a native Oreslang WebSocket/LiveView implementation.**

This package starts a first-party LiveView design without importing Phoenix, Elixir,
BEAM, or HTMX protocol semantics into the core Oreslang runtime. It contains:

- `web/liveview.mjs`: browser WebSocket client, typed safe DOM tree/patch
  interpreter, reconnect and resync logic, bounded stop-and-wait event transport.
- `reference/liveview-core.mjs`: deterministic single-view state/revision/replay
  model for eventual actor-native implementation.
- `reference/htmx-bridge.mjs`: **separate** HTMX WebSocket OOB HTML encoder and
  safe form-message parser. HTMX does NOT understand native LiveView JSON frames.
- `tests/liveview.test.mjs`, `tests/replay-wire-e2e.test.mjs`, and `tests/wire-fixtures.test.mjs`: offline and real-socket tests using Node built-ins and a minimal DOM
  test double; real loopback WebSocket tests are included, but no Oreslang compiler or guest is executed.
- `docs/PROTOCOL.md` and `docs/NATIVE_INTEGRATION.md`: protocol contract, threat
  model, implementation sequence, and explicit release blockers.

## Local tests

```sh
node --test tests/*.test.mjs
```

Node 20+ is required for tests. There are no external packages; E2E tests open loopback-only TCP sockets.

## Native status and provenance

Repository audited: `ores-truffle-oreslang/oreslang-phoenix-server.ores`.
Its default branch remains a source-free bootstrap. Native HTTP work lives in
stacked draft PRs #2, #5, and #6, and trusted-runner approval remains blocked by
issue #8. **This package does not modify those PRs or authorize the native runner.**

Native work remains: implement origin-checked HTTP upgrade and RFC 6455 framing,
authenticated session binding, actor-owned view state/reducer/render lifecycle,
WebSocket send/receive integration, bounded mailbox admission, reconnect storage,
shutdown/drain, and browser + server end-to-end suites. Treat local reference test
results as `HOST_REFERENCE_ONLY`, not execution proof for Java, LLVM, Wasm, Forge,
.NET, JDK native image or any production server.

## New host-only WebSocket gateway and runnable demo

The package now includes `reference/ws-wire.mjs` (bounded RFC 6455 frame parser),
`reference/ws-gateway.mjs` (authenticated loopback-only HTTP upgrade and socket
adapter), `reference/demo-server.mjs` (single-user local counter), and
`web/demo-entry.mjs`. All are **Node host references**, not Oreslang runtime
or browser automation evidence.

```sh
npm test
node reference/demo-server.mjs
# Open the printed http://127.0.0.1:<port>/ URL in a local browser.
```

The executable demo binds `127.0.0.1` only, authenticates a local cookie at
upgrade, validates exact Origin/Host, enforces per-view CSRF at join, has a
bounded wire/message/session queue, and performs no external network requests.
**It is deliberately not a production session service:** one process has a
single demo principal, no persistent auth backing or durable idempotency, and
no native Oreslang guest. It cannot be used as a TLS termination/server
replacement. To implement the native runtime, follow `docs/NATIVE_BOUNDARY.md`.

## E2E and transport hardening (2026-10-31)

The test harness now includes a real loopback HTTP/WebSocket end-to-end suite
(`tests/e2e.test.mjs`). It exercises cookie/Origin/CSRF admission, two
subscribers receiving authoritative patches, exact revision recovery after a
reconnect, duplicate-event suppression, and stale-revision resync. Inbound
frame fragmentation is capped even for zero-byte fragments; message-rate,
connection, pending-byte and idle-time budgets are enforced. The browser now
requests the required `ores-liveview-v1` WebSocket subprotocol and selects
`ws:`/`wss:` based on the document scheme.

The **optional** Chromium test (`tests/browser-e2e.py`) covers browser DOM clicks,
two-tab broadcasts and reload. It requires Python Playwright and an unrestricted
loopback browser network. Run it separately:

```sh
python -m playwright install chromium
python tests/browser-e2e.py
```

Browser automation can be blocked by environment policy even if the Node socket
E2E suite passes; do not report it as passing unless it actually executes.
All reference tests remain **HOST_REFERENCE_ONLY**, not native Oreslang or five-
backend evidence. Keep the WebSocket runtime and trusted compiler approval gate
blocked until separately verified.

## Additional adversarial and lifecycle regressions

`tests/hardening.test.mjs` adds 14 deterministic regressions to the existing
54-test Node reference suite. Scenarios cover seeded TCP chunk splitting,
fragmented Unicode/ping delivery, invalid UTF-8, malformed/noncanonical RFC
6455 framing, oversized fragmented frames, zero-byte fragmentation exhaustion,
replay-window expiration, stale event IDs, unauthorized events, detached and
crashing subscribers, and real loopback sockets with failing attach, detach and
circular outbound session messages.

The reference gateway now handles actor/subscriber callback exceptions without
propagating them from the HTTP `upgrade` or socket `close` listener. A failed
attach or nonserializable outbound subscriber frame closes with RFC 6455 1011,
while a detach failure is counted and isolated. The `gateway.faults` getter
exposes read-only copies of `{attach, detach, output}` counters for diagnostics;
no user payload, token or credential enters those metrics.

Repeatability: three clean runs of `npm test` each completed **68/68**, and
`node --check` passed for the changed gateway and the new tests. This is
HOST_REFERENCE_ONLY; real browser Chromium tests, native Java/Graal execution
and other backend parity were not executed in this batch. Review
`docs/HARDENING_E2E.md` before interpreting the evidence.

## Replay and wire hardening (2026-11-01)

The host wire parser now handles multiple valid frames coalesced in one TCP read
without treating aggregate bytes as an incomplete-frame budget. A separate
`maxFramesPerFeed` cap prevents event-loop monopolization. Replay IDs are
cryptographically bound to their original command and authenticated principal.
Stale commands get explicit `event_rejected` frames; the browser drops the
rejected command, reports a conflict, and resynchronizes before sending
subsequent commands. The 14 JSON wire vectors in
`fixtures/liveview-wire-v1.json` are designed for future exact-byte
conformance on all five native backends. These tests are still
`HOST_REFERENCE_ONLY`.

## 2026-11-01 follow-up: 119 host-reference checks

`tests/control-plane-e2e.test.mjs` and `tests/validation-boundaries.test.mjs`
add 26 checks for Ping/Pong floods, malformed/binary/Close frames, write
backpressure, session replay conflicts, repeated disconnect cleanup,
atomic DOM updates, event ID validation, and revision rollover protection.
Three local Node 22.16.0 executions passed 119/119; the code remains an
independent reference and no native Oreslang compiler or browser Chromium
end-to-end pass is claimed. See `docs/HARDENING_E2E.md` for detailed limits.

## 2026-11-01 E2E security extension (156 tests)

Two new suites add **37 executable Node host-reference tests**, including 21
real TCP/WebSocket E2E checks. Browser WebSocket negotiation is verified before
join; early/unsolicited ACKs cannot remove queued events; query parameters are
forbidden on the first-party socket URL; and void-element DOM patches are
rejected atomically. Three clean Node.js 22.16.0 runs passed **156/156** each.
This is not native Oreslang execution or Chromium browser evidence. See
`docs/HARDENING_156.md` for the test cases, threat model and release gates.

## November 1, 2026 — assembly deadlines and per-view admission

The host reference adds an absolute 15-second incomplete-WebSocket-message
assembly deadline (configurable and independent of idle timeout), immediate
actor unsubscribe on gateway shutdown, and a bounded per-view subscriber cap.
Run `npm test` for the 183-test reference suite and see
`docs/HARDENING_183.md` for limits, adversarial cases and the native CI gate.
These tests do not certify a native Oreslang WebSocket runtime.

## Wire conformance extension (41 vectors)

See `docs/WIRE_VECTOR_41.md` for the 41-vector RFC6455 registry and deterministic split-admission tests. These are host-reference tests only; cross-backend native guest evidence remains pending.
