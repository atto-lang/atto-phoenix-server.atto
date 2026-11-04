# First-party Oreslang LiveView: five-toolchain portability gate

**Status 2026-11-01: HOST_REFERENCE_ONLY, five native guests NOT ATTESTED.**
This document does not claim a working Java, LLVM, Wasm, Forge/Cranelift,
or .NET Oreslang guest. It fixes the common contract to implement and test.

## Single application contract

The source-level LiveView application must remain pure Oreslang: it receives
`mount`, `event` and authenticated `resume` commands; reduces actor-sealed
state; constructs a typed/escaped view; and emits `snapshot`, `patch`,
`event_ack`, `event_rejected`, `ready`, and `resync` under protocol
`ores-liveview-v1`. Only the transport adapter may use sockets, selectors,
Kestrel, Wasmtime browser/worker imports, or native host handles. A guest may
never hold a raw host fd or JDK/.NET object, and application `panic` goes to
its supervisor through a CONTROL notice rather than being intercepted.

Host I/O and acknowledgements must be asynchronous, without blocking actor
scheduler carriers or running reducer code on reactor threads. Actor state is
sealed and accessed only through `handle_state(critical-read ...)` and
`handle_state(critical-write ...)`. API methods use `snake_case`; explicitly
blocking APIs end `_blocking`. A frame's network wire encoding is
MessagePack/JSON codec-specific, but the first-party LiveView v1 socket
subprotocol uses bounded JSON text frames, never arbitrary HTML or scripts.

## Toolchain-specific adapter, not different application source

| Toolchain | Target topology | Current verified boundary | Promotion requirement |
|---|---|---|---|
| `oreslang-source.java` | JVM + GraalVM Native Image server | Draft host WebSocket codec and 41-vector JUnit test; no compiled guest | `http.try_upgrade_websocket` capability + pinned JDK25 guest `CounterLive` E2E and AOT |
| `oreslang-source.llvm` | Native server, zero-GC/HRT goal | Draft fixed-storage C++ RFC6455 parser, not guest listener | Integrate epoll/actor-owned sockets, no unbounded allocation, sanitizer/HRT checks |
| `oreslang-source.wasm` | Browser/worker/Wasmtime *host adapter* | Pure core Wasm deliberately rejects WebSocket/LiveView | Explicit host adapter imports and capability; browser runtime cannot accept an inbound TCP listener |
| `oreslang-source.forge` | Forge/Cranelift native server | Draft C++ host parser, not guest listener | Native actor-socket integration and fixed-storage test proof |
| `oreslang-source.net` | Native AOT server | Kestrel HTTP provider, guest WebSocket/LiveView flags rejected | Explicit actor-owned upgrade, Native AOT compile, lifecycle E2E |

**A browser Wasm target cannot be declared `server`** merely to achieve a
numerical "five-of-five" count. Guest application semantics should be
portable; networking capability and deployment topology remain target-specific.
Unsupported transports must reject clearly before guest execution.

## Connection-retirement linearization (all five backends)

A single transport read may contain multiple complete WebSocket messages.
If an actor callback revokes or closes its transport during processing of one,
later decoded messages from that read **must not** enter the actor, and retired
actor output must neither be enumerated nor transmitted. Detachment is
idempotent even when local shutdown, EOF and error paths race.

The same capability fencing applies to Java NIO, LLVM and Forge reactors,
Kestrel/.NET and explicit Wasm host adapters. A compiled-guest receipt must
include `coalesced_retirement_e2e`, `retired_output_suppression_e2e`,
and `exactly_once_detach_e2e`. These flags are only structural assertions:
they never authenticate a build or turn a host parser into a guest implementation.

## Dual conformance planes

1. **Transport:** the immutable 41-vector RFC6455 registry has Git blob SHA
   `931f58c1acd40e4c7e1b0b061f1711a0afe3c9b8`. Keep it identical across
   Phoenix PR #14, Java #2410, LLVM #1264, Wasm #233, Forge #162, .NET #296,
   and platform-conformance #278. A host parser's pass is not a compiled
   Oreslang guest pass.
2. **Application:** in each toolchain, compile the *same* `.ores` LiveView
   counter application; prove an authenticated JOIN, a revisioned PATCH and
   ACK, replay and snapshot fallback, session expiry, two-client broadcast,
   failed authorization and supervisor restart. Distinguish `server` from
   Wasm's explicit `host-adapter` topology. Prove browser client and HTMX OOB
   adapter separately, including sanitized render output.

The JSON registry in `fixtures/ores-liveview-toolchain-v1.json` and
`reference/toolchain-parity.mjs` enforce structural invariants and refuse
unattested claims. Even a fabricated, structurally complete receipt returns
`certified:false`; only independently authenticated exact-head guest CI may
establish runnable parity. No source/runner transfers are authorized by a
matching Git blob or a valid receipt shape.

## Release blockers / safe CI plan

- Source branch protection and independent source-export authorization are
  outstanding under `oreslang-platform-conformance` issues #22 and #170.
  **Never mirror private-source blobs across organizations** just because an
  alternate private runner has minutes; public/private destination visibility
  and remaining budget do not override incident policy.
- Source-org GitHub Actions jobs failing with zero executed steps are
  `NOT_EXECUTED`, not successes or application-test failures.
- Before promotion, capture each source/tree/compiler/binary SHA, runnable
  stage and exact guest logs, runner job ID and nonzero executed steps, real
  socket/actor-lifecycle tests, JDK Native Image, LLVM sanitizer/HRT,
  Forge, Wasm worker/Wasmtime, and Windows/Linux .NET Native AOT.
- Keep Phoenix PR #11, stacked 41-vector PR #14 and the five backend drafts
  unmerged until independent code review and native admission succeed.


### Serial actor operation / synchronous callback non-reentrancy

A LiveView session owns its state and revision. Guest implementations must
refuse synchronous reentry through the reducer, renderer, authentication and
subscriber callbacks before invoking nested callbacks. The operation guard
must unwind on error (defer/finally). A subscriber may enqueue work onto an
actor mailbox, but must not execute another session operation synchronously
inside the original commit/broadcast. Each backend must execute a native
`serial_nonreentrant_actor_e2e` test, including error recovery, to claim the
shape of a complete receipt. The structural verifier cannot authenticate
these claims or certify backend parity.

### Portable rendered Unicode scalar values

The LiveView render tree admits Unicode scalar values only. Unpaired UTF-16
surrogates must be rejected in text nodes, attributes, links and patch payloads
**before** state/replay commit or any browser DOM mutation. Valid supplementary
characters must round-trip. Node's `JSON.stringify` escaping of an unpaired
surrogate does not establish portable UTF-8 data. Each backend needs a compiled
guest `render_unicode_e2e` test including rejection, rollback, socket retirement,
second-subscriber isolation and valid round-trip. Structural receipts never
authenticate guest execution.
