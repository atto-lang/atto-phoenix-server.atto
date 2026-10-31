# Ores Live v1 — native live-update design and browser protocol

**Status:** source sequencing rules + tested browser client, **not** a live server.
This draft does not add a native WebSocket/SSE endpoint, persistent view actor,
HTMX server adapter or five-backend compatibility. No native compiler or guest
execution is attested. The HTTP-only demo is unchanged.

## Upstream blocker

The pinned Java runtime from `SOURCE_REF` uses
`com.sun.net.httpserver.HttpServer`. Its documented `http.claim` exchange
does not expose HTTP Upgrade or WebSockets. Streaming
`http.start/write/finish` exists, but the current 5-second request deadline
and request-actor ownership are not a durable SSE/session implementation.
Implement capability-scoped nonblocking socket accept/read/write/close,
transfer/cancellation and RFC 6455 framing first. Do not fake a WebSocket by
writing `101 Switching Protocols` through `exchange.respond`.

## Protocol: ores.live.v1

WebSocket path (future): `/live`, same-origin secure `wss` for HTTPS, negotiated
subprotocol `ores.live.v1`. Maximum UTF-8 JSON frame 64 KiB, maximum 128 DOM
operations/frame, bounded topic/session quotas and replay retention.

All envelopes carry `v:1`, `type`, `topic`. Topics match
`^[a-z][a-z0-9_:/-]{0,127}$`; stream `epoch` is an unpredictable generation ID,
and `seq` is a nonnegative revision. The current pure Oreslang revision helper
uses signed 32-bit values; rotate epochs well before 2^31-2. A future v2 may
standardize lossless 64-bit encoding.

Client to server:

- `join {v:1,type:"join",topic,csrf,epoch,seq}` — validate the handshake Origin
  against an explicit allowlist and authenticate the cookie-bound session,
  then verify CSRF and topic authorization. CSRF is **not** identity.
  Never place tokens in WebSocket URLs.
- `event {v:1,type:"event",topic,event,data}` — authorize each mutation,
  validate typed payload and rate-limit. No client mutation is auto-replayed
  across disconnect. For retryable effects use server-side deduplication.
- `ack {v:1,type:"ack",topic,epoch,seq}` — reject future/foreign acknowledgments.
- `resync {v:1,type:"resync",topic,epoch,seq}` — force authoritative snapshot.

Server to client:

- `snapshot {v:1,type:"snapshot",topic,epoch,seq,ops:[...]}` — full view, clear
  mutable lists before replacing contents.
- `patch {v:1,type:"patch",topic,epoch,seq,ops:[...]}` — must be **exactly**
  the successor of last received revision; no optimistic application after gaps.
- `ready {v:1,type:"ready",topic,epoch,seq}` — after replay completes,
  matching current acknowledged revision; only then enable client mutations.
  A new snapshot also establishes readiness.

The replay classifier in `src/live_wire.ores` chooses `replay` only when
`last >= floor - 1` and epoch matches, otherwise `snapshot`. Invalid negative,
inverted or overflowing positions are rejected. Retention gaps require a
snapshot, not a permanent reconnect loop. A duplicate stale snapshot in the
same epoch is ignored.

## Browser DOM patch vocabulary

`web/ores-live.mjs` never invokes eval or parses remote HTML. It accepts only
ID targets inside a designated root, not arbitrary CSS selectors:

- `{op:"text",id,text}` uses `textContent`;
- `{op:"attr",id,name,value}` allows only `class`, `title`, `role`,
  `hidden` and lowercase `aria-*` attributes; never `on*`, style, URL attrs;
- `{op:"append_text",id,key,tag,text}` creates an allowlisted element and
  assigns literal text; `remove_key` removes one existing keyed child;
- `{op:"clear",id}` clears a container; snapshot may clear then reappend.

Operations undergo preflight target, schema, length, key and parent/child
conflict checking before mutation. No promise of transactional rollback
against hostile out-of-band DOM modifications. Only server-controlled IDs
inside the live root are valid; require application escaping for HTML served
through separate adapters.

Example browser integration **after** a native /live server exists:

```js
import {OresLiveClient} from '/web/ores-live.mjs';
const live = new OresLiveClient({
  url: 'wss://example.com/live',
  root: document.getElementById('live-root'),
  topic: 'counter:public',
  csrf: document.querySelector('meta[name="csrf-token"]').content
});
live.start();
// live.sendEvent('increment', {by: 1}) only after snapshot/ready.
```

## Native actor contract (to implement)

- Isolate one `LiveSession` actor per authenticated view. Assigns/revision and
  subscription state are sealed and accessed only through
  `handle_state(critical-read/critical-write)`; no loan/guard across socket
  await, and no global shared mutable socket registry.
- Domain actors publish immutable typed changes to a bounded `PubSub` actor,
  which enforces authorization, fan-out quotas, and backpressure.
- Each session owns outbound capacity, replay epoch and ACK high-water mark.
  Repeated failures, slow readers, revocation, graceful drain and hot generation
  switches tear down or resnapshot sessions; no leaked timers/capabilities.
- Enforce origin, authentication, CSRF, topic checks, message length, frame
  fragmentation, per-event schema, rate limits, idle ping/pong, session expiry,
  cancellation, socket ownership and bounded buffers. Document close codes and
  prevent a malicious connection from monopolizing scheduler carriers.
- Wire protocol and state transitions belong in Oreslang source; Java/Graal and
  LLVM should expose only capability-checked low-level I/O operations.

## HTMX and SSE are separate adapters

HTMX `hx-ext="ws"`/`ws-connect` expects **out-of-band HTML fragments** and
`ws-send` sends form JSON; it does not understand Ores Live JSON messages.
A separately authorized `/live/htmx` adapter may translate the same view diff
into escaped, ID-stable `hx-swap-oob` HTML. Never claim that `/live` is HTMX
compatible. Reference: https://htmx.org/extensions/ws/

SSE transports server-to-client updates and needs separately authenticated
HTTP POST for mutations; its long-lived stream needs deadline/ownership redesign.
Normal server-rendered HTTP remains the no-JavaScript fallback.

## Evidence and release gates

1. **Present:** `bash ci/test-live-web.sh` has 13 local Node host cases:
   revisions, snapshots, keyed DOM patches, duplicate preflight, injection,
   reconnect/replay, gaps, resync, origin URL and no mutation replay. These
   are browser-model tests, **not** actual browser or native transport tests.
2. **Pending:** exact-head Oreslang compiler check and execution of
   `tests/live_wire.ores` under the pinned private compiler, along with
   existing HTTP contracts. Do not mark this as a pass until runner steps execute.
3. **Pending:** native WebSocket RFC 6455 handshake, framing, auth, lifecycle,
   cancellation and negative raw-TCP suites; Java/Graal and LLVM first.
4. **Pending:** LiveSession/PubSub actors, reconnect retention/resync,
   multi-client changes, backpressure, log-safe metrics, session invalidation,
   graceful shutdown and hot load, followed by HTMX/SSE adapters.
5. **Pending:** backend-neutral conformance for Java, LLVM, Wasm, Forge, .NET,
   native AOT, sanitizers, and real browser/HTMX integration.

The private-source exact-SHA CI approval guard remains mandatory. A foreign-org
hosted test is not authorized to clone, mirror or execute private Oreslang source
unless that transfer and runner trust boundary are separately approved. A
zero-step/queued/skipped job is `NOT_EXECUTED`, not evidence of correctness.

Security reference: https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html
