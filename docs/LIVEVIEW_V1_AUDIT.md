# Oreslang Phoenix LiveView v1 — audited implementation plan (2026-10-31)

**Status: design and host-reference validation only. NOT native execution or production-ready LiveView.**

## Audited repository evidence

- `main` remains a source-free bootstrap, tree `1ebcedd11a522795f401b674eeb8fe4983f25388`.
- Draft PR #2: candidate native loopback HTTP `GET /hello`, `POST /echo`.
- Stacked draft PRs #5 and #6: security/fixture and negative HTTP hardening; no proven WebSocket or LiveView execution.
- Draft PR #7: exact-SHA security authorization controller, fail-closed.
- Issue #8: private Actions run admission fails before steps; do not equate zero-step jobs with native test evidence.

## First-party LiveView transport (new, not Phoenix wire-compatible)

- `/live` — first-party `ores-liveview-v1` JSON WebSocket protocol with server-authoritative actor state.
- `/live/htmx` — optional separate HTMX `ws` extension endpoint, sending HTML out-of-band swaps. HTMX does **not** interpret the JSON protocol.
- Authenticated HTTP upgrade validates exact Origin, session cookies, path, WebSocket key, capacities and strict TLS; per-view CSRF token is validated on join, never placed in a URL.
- Actor-scoped immutable view ID/session capability and permission-checked events; no actor direct-state reads outside sealed critical callbacks.
- Event envelope `{v:1,type:"event",event_id,name,payload,base_rev}`; limit 65,536-byte JSON frames; one in-flight revision-dependent client event.
- Server emits `snapshot`, `patch` with `prev` and `rev=prev+1`, `event_ack`, `ready`, `resync_required`. A first join requests `resume_rev=-1`.
- Small bounded replay history and dedup ledger; duplicates in a live actor session are suppressed, but durable exactly-once side effects require a persistent transactional idempotency record.
- Deterministic typed render tree (stable IDs) -> bounded allowlisted DOM ops: `set_text`, `set_attr`, `remove_attr`, `replace_children`. No `innerHTML` or executable HTML in first-party protocol.
- Reject event handlers, scripts, SVG/foreign namespaces, unsafe URL schemes, arbitrary CSS, duplicate IDs, cross-root patches, stale revisions, and stale session grants.

## Native actor hierarchy

1. HTTP/WebSocket transport actor: RFC 6455 framing, masks, continuation, ping/pong, UTF-8, close, frame quotas, slow-client admission.
2. Session registry: credentials, CSRF/session binding, permission/TTL, generation and clean invalidation.
3. Isolated LiveView actor: state, reducer, renderer, revision commit, replay/dedup, supervisor CONTROL on panic.
4. Renderer/diff engine: safe HTML escaping, stable keyed updates, form focus/selection preservation.
5. Capability-scoped PubSub actor: fan-out, per-subscriber bounded queues and overload snapshots.
6. Lifecycle supervisor: timeout/disconnect cleanup, hot-generation pin, graceful drain and restart policy.

## Verification/promotion gates

- Host-only reference package developed separately (browser client, state machine, HTMX OOB bridge, offline Node tests). Its evidence is **not** native Oreslang execution; integration and the code itself must be reviewed in a later PR.
- Require malicious Upgrade/Origin/CSRF tests, WebSocket parser fuzzing (unmasked frames, fragmented UTF-8, overflow), duplicate/missing ACK and reconnect/actor restart tests, cross-root XSS tests, slow-client fairness and leak/stress checks.
- Require a real nonzero-step exact-head host CI run, approved protected native runner, clean pinned Java compiler SHA, native guest + actual WebSocket browser evidence; next verify LLVM, .NET AOT, Wasm and Forge differential fixtures.
- Keep PRs draft and native dispatch authorization disabled. Do not transfer private source or the private compiler to another org without explicit authorization.
