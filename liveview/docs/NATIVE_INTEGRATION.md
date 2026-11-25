# Oreslang native integration sequence / admission gates

## Current repository checkpoint (2026-10-31)

- `main` tree `1ebcedd11a522795f401b674eeb8fe4983f25388` contains only
  bootstrap docs/policy, no WebSocket or LiveView `.ores` runtime.
- Draft PR #2 implements candidate HTTP routes, not an attested native server.
- Stacked draft PRs #5/#6 add boundary and fixture tests, not WS execution.
- Draft PR #7 proposes fail-closed exact-PR SHA approval on main. Native
  allowlist is empty and enable variable is off/unset per its audit.
- Issue #8 records private Actions zero-step runner failures. Do not bypass
  security review by executing an unreviewed PR on a persistent private
  compiler runner or mirroring private source to an unapproved org.

## Native architecture: dependencies and responsibilities

1. **Transport actor:** HTTP/1.1 upgrade must validate `Connection`, `Upgrade`,
   `Sec-WebSocket-Key`, version 13, Origin, host, path, cookie authentication,
   capacity and deadline. Implement fully validated RFC 6455 frame parsing:
   client masking, continuation/fragmentation, bounded compressed/uncompressed
   lengths (disable compression initially), control-frame limits, UTF-8,
   ping/pong and close semantics. Never parse raw frames in application actor.
2. **Session registry actor:** authenticated principal -> view capability token;
   enforce TTL, view ID, generation, topic permissions, maximum connections
   per session, and invalidation on logout or permission change.
3. **LiveView actor:** each view owns sealed state with
   `handle_state(critical-read |s| -> ...)` and
   `handle_state(critical-write |s| -> { ... })`. Register typed events and
   renderers. Reducer, render, revision commit and dedup decision are serialized;
   do not hold critical locks during I/O or `await`. Only immutable rendered
   diffs cross actor boundaries. `panic` travels to supervisor CONTROL.
4. **Renderer/diff engine:** escaping and allowlist before serialization;
   deterministic stable keyed IDs; bounded structural diffs with snapshot
   fallback; avoid allocations outside actor arenas. Preserve form state/focus.
5. **PubSub/group actor:** group capabilities; topic ACLs; fan-out with
   independent bounded subscriber queues; slow clients dropped or compacted
   to snapshots. Broadcast contains data, not executable HTML or callbacks.
6. **Lifecycle manager:** disconnect cancel/unsubscribe, bounded heartbeat,
   supervisor restart policy, drain/close on shutdown, hot-generation binding.
   No worker ownership may leak after socket close.
7. **HTTP + HTMX compatibility:** keep `/live/htmx` separate. HTMX `ws` extension
   expects server-generated OOB HTML, not JSON patches. Never run htmx and the
   native LiveView DOM patcher against the same element subtree. Escaped HTML
   and server-side target ID checks are mandatory.

## Required negative and differential tests

- Upgrade wrong origin, unauthenticated cookie, invalid/expired CSRF, HTTP
  method misuse, mixed-case and duplicate headers, body over budget, request
  smuggling (Content-Length and Transfer-Encoding conflicts), slowloris.
- WebSocket fragmented invalid UTF-8, unmasked frames, 64-bit frame overflow,
  RSV flag misuse, ping floods, close half-handshake, compression bombs,
  queued send bound, abnormal disconnect, idle expiry and reconnect storms.
- Join authorization and rev/ACK contract: stale revisions, lost ACK, duplicates,
  concurrent tabs, disconnected/rejoined view, actor death between state
  mutation and ACK, dedup eviction and server restart.
- DOM hostile tags/attrs/URL schemes, prototype keys, other-root IDs, duplicate
  keyed nodes, HTML entity injection, focus preservation and selection.
- 10k independent connection churn, saturation/503/1013 behavior, memory/actor
  leak assertions, bounded mailboxes, fairness with slow client and fast
  client, graceful shutdown and hot reload.
- Java/GraalVM checked execution first, LLVM differential wire bytes/state
  next, then .NET AOT, Wasm, Forge. Never assert five-backend parity until
  all five pass the **same** binary/JSON protocol and guest-facing fixtures.

## Promotion checklist

1. Land reviewed **host-only** protocol fixture and security tests.
2. Restore nonzero-step hosted CI on exact SHA and record tree SHA, job/runner
   ID, step logs, positive and negative fixture output.
3. Implement Oreslang native transport and actor integration on a dedicated
   branch. Do not change source-org default branch directly.
4. Review/enable protected environment and exact-SHA native dispatcher only
   after independent authorization and runner isolation.
5. Run real browser + Oreslang socket tests on authorized exact compiler SHA.
6. Add multi-backend parity and security fuzzing before production readiness.

The bundled `.mjs` is a **protocol reference/harness**, not an implementation
of native Oreslang server runtime or a proof that current compiler syntax
can express these APIs today.
