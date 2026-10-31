# Native Oreslang WebSocket implementation boundary — blocked until runtime APIs exist

## Verified separation (2026-10-31)

The original Phoenix candidate in draft PR #2 uses `http.listen`,
`server.accept`, `http.claim` and `exchange.respond`. No runnable WebSocket
upgrade/frame/connection API was verified in that candidate. A GitHub code
search for `websocket` and `http.upgrade` in the Java source repository
returned no indexed matches; **this is not proof such APIs are absent**.

The Node reference provides **wire oracles**, not implementations of the
Oreslang runtime API. Do **not** add a fake `.ores` server that assumes
unverified guest intrinsics or report a compiler pass on source that was not
actually compiled. The native runtime must implement and verify:

- `http.try_upgrade_websocket(exchange, policy) -> Result<WebSocket, WsError>`:
  admission with exact Host/Origin, authenticated principal, key/version,
  framing rejects, no compression, secure loopback/TLS handling and fd
  ownership transfer; fail closed on any missing capability.
- `WebSocket.recv_async()` and `send_async()` returning bounded typed
  text/control events, closing on invalid mask/UTF-8, unbounded fragments,
  premature continuation, invalid close and oversized frames. Never block an
  actor scheduler carrier; shutdown/close own the fd and pending operations.
- `LiveViewSessionActor`: one isolated actor per view. Actor-owned sealed state
  read/writes only through critical-read/critical-write; reducer -> render ->
  wire frame chosen before state revision committed. Supervisor handles panic
  via CONTROL notice. Unique socket capability and principal bind are passed
  from the transport, not from untrusted JSON body.
- `LiveViewRegistryActor`: quotas, connection/view mapping, CSRF/session binds,
  expiration, generation pin, detach cancellation, bounded replay history and
  dedup ledger. No remote host I/O while holding critical state locks.
- Renderer: deterministic typed tree -> allowlisted JSON patches; never raw
  DOM/HTML injection. HTMX uses a separate OOB-HTML endpoint.

## Exact native promotion test sequence

1. **Compiler surface**: add a negative test proving unsupported WebSocket API
   usage fails cleanly before it exists, then a positive test for the pinned
   compiler head and runtime handshake API after implementation.
2. **Wire**: use the vectors in `tests/ws-wire.test.mjs`, translated into
   backend-neutral binary fixtures; enforce mask, continuation, close,
   malformed 64-bit length, UTF-8 and frame budgets identically.
3. **Guest**: compile the candidate with exact trusted Java compiler SHA,
   actually launch an Oreslang listener, connect with native browser/WebSocket
   client and prove a click causes a revisioned patch and ACK.
4. **Lifecycle**: prove detach/reconnect after actor death, shutdown and retry,
   503/1013 pressure behavior, bounded actor/mailbox allocations and
   cancellation. Validate actor supervision, restart and generation fencing.
5. **Parity**: run the same binary/JSON fixtures against LLVM, Wasm, .NET AOT,
   Forge, and Java. Do not assert backends equivalent from source-only checks.

## CI/security boundary

PR #7's allowlist and native circuit breaker remain disabled; issue #8 records
private Actions admission failures. Only an independently reviewed and
protected exact-head native job may execute untrusted guest source with the
private compiler. Host-reference CI can execute on ephemeral runners with
read-only permissions and without secrets. No private source mirroring.
