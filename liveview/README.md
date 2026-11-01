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
- `tests/liveview.test.mjs`: offline tests using Node built-ins and a minimal DOM
  test double; no network connections, no Oreslang compiler or guest execution.
- `docs/PROTOCOL.md` and `docs/NATIVE_INTEGRATION.md`: protocol contract, threat
  model, implementation sequence, and explicit release blockers.

## Local tests

```sh
node --test tests/*.test.mjs
```

Node 20+ is required for tests. No external packages or network are used.

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
