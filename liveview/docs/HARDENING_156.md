# LiveView v1 — host reference E2E hardening, 156 tests (2026-11-01)

**Scope:** JavaScript/Node **host reference only**. No native Oreslang compiler, actor, browser-Chromium automation, five-backend parity, or GitHub Actions runner steps were executed by this suite.

## Bugs addressed

1. The browser `open` handler now validates actual negotiated subprotocol `ores-liveview-v1` before sending any `join`. Offering the protocol alone did not prove that the server selected it. Failure closes with WebSocket 1002 and reports an error.
2. Client ACK admission now requires a known queued, previously-sent event ID and an ACK revision strictly newer than the original `base_rev`. A forged/early ACK cannot discard an unsent command. This enforces the v1 server's commit-before-ACK contract; it is not durable exactly-once delivery.
3. The browser rejects query strings on first-party WebSocket URLs, preventing accidental secret-bearing connection parameters. No CSRF or session token belongs in a URL.
4. Atomic DOM patch validation refuses `set_text` and `replace_children` on HTML void elements (`input`, `img`, `br`, `hr`), matching the typed-tree validator. Other pending DOM writes are not applied when one operation is rejected.
5. A legacy test double was corrected to advertise the real negotiated protocol, so the ACK regression continues to exercise an open authenticated socket rather than a failed handshake.

## Additional executable cases

- `tests/client-security-edges.test.mjs`: 16 cases spanning browser protocol acceptance and rejection, ACK tampering and ordering, DOM atomicity, void element behavior, incomplete-frame memory budgets, interleaved ping with fragmented UTF-8, and replay ledger state.
- `tests/live-network-adversarial.test.mjs`: 21 cases with **actual loopback TCP sockets**, including 13 invalid HTTP Upgrade requests, exact RFC 6455 SHA-1 Accept negotiation, coalesced join/event delivery, unjoined event denial, orphan continuation, RSV extension bits, invalid UTF-8, 64-bit oversize lengths rejected before payload allocation, and recovery after a malicious peer.

## Commands / local evidence

```bash
cd liveview
node --check web/liveview.mjs
node --check tests/client-security-edges.test.mjs
node --check tests/live-network-adversarial.test.mjs
node --check tests/liveview.test.mjs
npm test
node --experimental-test-coverage --test tests/*.test.mjs
```

- Tested under Node.js 22.16.0.
- Three independent full runs: **156 tests, 156 pass, 0 fail each**.
- Aggregate local line coverage: **96.96%**; branch coverage: **90.43%**. Coverage includes both tests and reference modules; do not treat as native runtime coverage.
- Test file and source contents were compared with Git blob hashes before submission; verify the pushed PR commit separately.

## Promotion gates still required

- An approved native Oreslang RFC 6455 + upgrade/actor connection API and actual Java/GraalVM guest execution on a clean, pinned JDK 25 compiler.
- Native test import of the existing 14 stable wire vectors plus multi-client/reconnect/cancellation/actor supervision and load/stress evidence.
- A browser automation run with permitted network access; local Chromium remained unavailable due to browser-network restrictions, so none of these new tests claim a Chromium pass.
- GitHub Actions admission restored with nonzero executed steps; preserve PR #7's review/allowlist/circuit-breaker security boundaries and issue #8's governance blocker.
- LLVM, Wasm, .NET Native AOT and Forge parity tested separately before any backend-neutral production claim.
