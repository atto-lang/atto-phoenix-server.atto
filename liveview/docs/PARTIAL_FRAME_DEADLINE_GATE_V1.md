# Absolute WebSocket assembly deadline across coalesced reads

**Status: host-reference regression verified locally; no guest-native proof.**

## Finding

A TCP `data` callback may deliver a complete WebSocket text (or ping/pong)
frame followed by just one byte of the next frame header. The reference parser
reset its absolute message clock after the complete frame but did not arm a new
clock for the incomplete trailing header. Thus a silent client could hold one
buffer slot until the socket idle timeout; if it sent the rest of the frame
later, the parser also accepted it after the intended assembly deadline.

## Fix

Record the read's arrival timestamp and, after processing complete frames,
arm that timestamp for any residual `pending` bytes without a currently active
fragmented message timer. Preserve the existing absolute deadline for
fragmented messages across interleaved control frames. `ws-gateway.mjs` already
watches `messageStartedAt` with an independent timer for silent peers; this
change ensures that such trailing partial headers activate that watchdog.

## Regressions

- Coalesced complete text + one-byte next header; reject completion after
  deadline (1008).
- Coalesced ping + one-byte next header; same deadline behavior.
- Empty subsequent feed after expiry must reject the incomplete frame.
- Real loopback HTTP/1.1 101 WebSocket handshake, join + partial header:
  server must proactively close with 1008, detach the only subscriber, and
  reclaim the connection without waiting for another client read.
- Real ping + trailing partial header also proactively closes with 1008.

## All-toolchain promotion gate

This must run against a **compiled guest** and its real transport on Java/GraalVM,
LLVM, Forge/Cranelift, .NET Native AOT, and a host-provided Wasm network
adapter. A host parser pass is not an actor/guest execution pass. Each target
must prove the separate wire and message budgets, reactor-independent
assembly deadline, typed actor ownership, zero stale deliveries after close,
and bounded timeout cleanup. Native execution receipts require pinned source
and executable SHA, authentic nonzero CI steps, and the independent conformance
gate. No private source export across organizations is authorized by this
fixture; incident #22 and source branch protections remain prerequisites.
