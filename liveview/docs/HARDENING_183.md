# LiveView 183-test transport/lifecycle hardening — source-only evidence

## Scope and provenance

- Repository: private `ores-truffle-oreslang/oreslang-phoenix-server.ores`, draft PR #11.
- Parent source head (verified before changes): `82066d32110535f8d84e39983ff604f9da9910ae`.
- Source verification: reference files were matched against GitHub Git-blob SHA on the parent head before changes.
- No native Oreslang compiler, Java/GraalVM actor, LLVM backend, or Chromium browser was executed by this change.

## Implementation changes

1. The RFC 6455 frame parser now implements a bounded **absolute partial-frame/fragmented-message assembly deadline** (`maxMessageAgeMs`, default 15,000 ms). This complements, rather than replaces, the idle timeout: byte-by-byte traffic cannot continually reset the deadline. The parser clock can be injected for deterministic regression tests.
2. Standalone Ping/Pong frames reset their own assembly deadline; Ping/Pong interleaved **inside** a fragmented data message do not reset that data message's deadline. Exhaustion fails closed with WebSocket close code 1008.
3. The gateway exposes the message-assembly deadline as a bounded configuration and passes it to each parser.
4. Gateway `close()` synchronously invokes every active session detach callback before destroying sockets; subsequent socket errors/closes do not detach twice. This avoids transient lingering actor capabilities.
5. Each `LiveViewSession` enforces a bounded `maxSubscribers` admission budget (default 64, maximum 4,096), rejects duplicate connection IDs, and reclaims slots upon detach. The bound is per-view, independent of per-gateway connection caps.

## Verification

- Host: Node.js 22.16.0, offline, dependency-free.
- New: 13 tests (`tests/deadline-and-lifecycle.test.mjs`), including real loopback TCP upgrades and masked frames.
- Full suite: **183/183 passed** on each of **three** clean local runs; syntax checked all modified `.mjs` files.
- `node --test --experimental-test-coverage tests/*.test.mjs`: 97.35% aggregate lines and 91.22% aggregate branches (measured reference code **and** test code; not native runtime coverage).

## Unresolved native/CI gates

- Source repository `main` reports `protected:false`. Private CI source export remains prohibited under [security incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) and [policy issue #170](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/170). A private alternate org or a working runner **does not constitute approval**. No source was transferred between organizations.
- Exact-head GitHub Actions admission and independently protected runner approvals remain unverified. Zero-step jobs are `NOT_EXECUTED`.
- Java/LLVM/.NET/Wasm/Forge parity and native actor lifecycle proof remain open.
