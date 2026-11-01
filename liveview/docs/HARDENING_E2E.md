# LiveView host transport hardening: executed evidence

Status: **HOST_REFERENCE_ONLY**. No `.ores` compiler/runtime guest was invoked.

## Changes

- Catch `session.attach` exceptions after authenticated HTTP upgrade, close the WebSocket with `1011`, detach and release the connection slot; do not throw from the HTTP upgrade event.
- Isolate `session.detach` exceptions from socket-close events so a failed view teardown cannot crash the gateway.
- Catch subscriber serialization/transport callback exceptions, close with `1011`, prevent failure propagation.
- Expose bounded, copy-returned `gateway.faults` counts (`attach`, `detach`, `output`) without including session IDs or payloads.
- Add 14 adversarial tests under `tests/hardening.test.mjs`. Earlier suite had 54.

## Executed local commands

```sh
npm test
node --check reference/ws-gateway.mjs
node --check tests/hardening.test.mjs
```

Repeated `npm test` three times locally with Node v22.16.0; each run: **68 tests, 68 passed, 0 failed**.

## Representative security and E2E scenarios

- 100 deterministic masked UTF-8 frame payloads with randomized TCP segmentation.
- Interleaved ping, continuation frames, and UTF-8 multibyte splits (20 deterministic seeds).
- Fatal 1007 on invalid UTF-8, 1002 on invalid framing, and 1009 on oversized fragmented messages.
- Bound zero-byte fragmentation by fragment count.
- Replay windows honor finite history; expired event IDs with stale revision fail closed.
- Malformed/unauthorized events do not advance view state or revision.
- One subscriber failing cannot block independent subscribed clients.
- Actual Node TCP/WebSocket gateway survives throwing attach/detach callbacks and circular outbound messages. HTTP 101 upgrade / close 1011 are observed on sockets.

## Not attested

- No real Chromium automation this round (prior environment blocks browser loopback).
- GitHub Actions admission remains separately blocked for private repository runners.
- No Java/Graal AOT, LLVM, Wasm, .NET AOT, or Forge native Oreslang execution.
- Not production security or performance certification.

Existing source security and CI authorization gates must remain unchanged. Do not merge a draft PR until independent runner admission and native execution gates are satisfied.

## 2026-11-01 follow-up: replay identity and coalesced TCP frames

The RFC 6455 reference parser now budgets **incomplete frame data** independently of
bytes in a TCP read. Valid concatenated frames can exceed the input-buffer
budget in aggregate; each frame must individually fit. A separate bounded
frame-per-feed limit prevents control-frame floods from monopolizing the
actor scheduler. Cross-backend raw wire vectors live in
`fixtures/liveview-wire-v1.json`; every fixture is executed by Node tests.

Replay identity now binds an event ID to its authenticated principal,
command name, exact JSON payload serialization, and base revision. Reuse
of an event ID for a different command fails closed. A stale, previously
unseen event receives `{type: "event_rejected", code: "stale_revision",
event_id, rev}`; browser clients discard only that rejected command,
notify the application via `onError`, and request resynchronization before
admitting the next queued command. This deliberately does **not** retry
stale writes automatically or provide durable exactly-once effects.

**Native evidence remains NOT_EXECUTED.** These fixtures are a portability
contract for Java/GraalVM, LLVM, Wasm, .NET Native AOT and Forge, not
runtime parity proof. The source security approval gate remains unchanged.

## 2026-11-01 control-plane and DOM atomicity follow-up

Twenty-six new host-reference tests were added in
`tests/control-plane-e2e.test.mjs` (18) and
`tests/validation-boundaries.test.mjs` (8):

- A shared, configurable inbound **Ping + Pong** quota blocks unsolicited Pong
  floods that previously bypassed message-rate admission. The existing ping
  pacing remains, and a control flood on one real TCP connection cannot block
  a separate authenticated subscriber.
- RFC 6455 binary frames are rejected as soon as their header is available,
  before buffering the unsupported payload. Outgoing WebSocket close frames
  validate status, code length, and UTF-8 reason as well as frame length.
- The typed DOM patch interpreter refuses duplicate structural writes and
  conflicting attribute writes **before performing any DOM mutation**.
  Invalid event IDs are rejected by the browser before enqueueing, and
  duplicate queued IDs cannot impersonate an earlier command.
- A revision rollover past JavaScript's safe integer range cannot commit a
  reducer result. A browser receiving a lower-revision snapshot closes rather
  than silently rolling back a view from a different generation; native
  protocol evolution must introduce an authenticated generation/epoch handoff
  for transparent actor restarts.
- Real-socket E2E cases cover malformed Close/JSON, disabled compression,
  bounded write backpressure (1013), authenticated replay conflicts,
  control-plane isolation, and 12 consecutive join/close/rejoin cycles without
  leaked connections or subscriptions.

Verification: Node v22.16.0, `node --test tests/*.test.mjs` passed 119/119
in **three separate local runs**, zero failed. Built-in Node test coverage:
96.50% lines, 89.25% branches, and 93.60% functions across measured
reference and test files. These are HOST_REFERENCE_ONLY results.

These tests do **not** establish a real Chromium pass, GitHub Actions runner
execution, native Oreslang runtime semantics, production resilience, or
Java/LLVM/Wasm/.NET/Forge parity. Protect the native runner, leave the existing
reviewed-SHA controls disabled, and do not transfer private compiler source.
