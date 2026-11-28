# `CounterLive.atto` — native guest integration target

**Status: target source, NOT_COMPILED.** This file is intentionally a small
actor-state implementation rather than a host mock or an invented WebSocket API.
It follows the draft AttoLang actor syntax, but no current toolchain is claimed
to parse, lower, compile, or execute it on this branch. It is not a functional
LiveView server by itself.

## Boundary

An authorized transport adapter (a different component) must:

1. Authenticate HTTP upgrade, origin, session and CSRF before handing events to
   the actor; pass only typed owned `Increment` values, never host socket objects.
2. Run the actor on a serialized mailbox/turn gate; protect its sealed state
   and fence stale generations and callbacks.
3. Render `read_count()` to the same `ores-liveview-v1` snapshot/patch envelope
   with strictly monotone revisions, bounded ACK/dedup and immutable UTF-8.
4. Implement the validated WebSocket close/fragment/deadline/backpressure rules.
5. Execute the same tests on Java/GraalVM, LLVM, Wasm host adapter,
   Forge/Cranelift and .NET Native AOT; attach immutable source/binary/runtime
   and stepful runner receipts to the central conformance gate.

## Promotion gate

A future compiler-driven test must build **this exact `.atto` blob** with
actual backend compiler binaries (not Node or Java host stubs), launch the guest
with a bounded test port/host adapter, and run a real socket event → revision →
patch/ACK → supervisor/reconnect test. If the adapter or toolchain is absent,
return `NOT_EXECUTED` / fail closed; never substitute the existing Node
`reference/` host implementation or assert native compatibility.

The Java WebSocket draft PR #2061 explicitly describes its APIs as host-only.
Do not assume `http.listen` or a guest `WebSocket` constructor can perform
an HTTP upgrade in the current Java compiler. No compile test has passed yet.
