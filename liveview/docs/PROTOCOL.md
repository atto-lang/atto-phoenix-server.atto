# `ores-liveview-v1`: protocol and threat model (DRAFT)

## Scope and transport

- `/live` is the **native Oreslang LiveView** WebSocket endpoint. It carries
  versioned JSON frames and **never** sends HTMX `hx-swap-oob` HTML.
- `/live/htmx` is an optional, **separate** HTMX ws-extension endpoint, whose
  responses are escaped HTML Out-of-Band swaps. It cannot be mounted over the
  same connection as `/live`. The reference HTMX bridge serializes only a safe
  DOM tree subset and requires a separately authenticated ingress controller.
- The HTTP upgrade layer MUST verify authenticated cookie/session principal,
  exact allowed `Origin`, secure transport, fixed upgrade path, negotiated
  subprotocol `ores-liveview-v1` (for `/live`), and bounded headers/size/time.
  Never trust user-supplied `HEADERS`, cookie/session IDs, or Origin inside JSON.
- Bind `view_id` and `session_id` to the upgraded principal and to a per-view
  server-generated CSRF secret with constant-time comparison. Reject an event on
  a connection that has not passed `join`. Server reference accepts an
  authorization callback and requires a distinct transport `connectionId`.
- Browser keeps the session CSRF token in a server-supplied bootstrap field,
  **not** in a WebSocket URL. Session cookies should be Secure, HttpOnly and
  appropriately SameSite. Use strict CSP, no inline JS, and no framing by
  untrusted origins. TLS is mandatory except isolated local development.

## Envelopes

Every frame carries `v: 1`; maximum serialized frame is 65,536 bytes.
Client-to-server examples:

```json
{"v":1,"type":"join","view_id":"counter","session_id":"opaque","csrf":"per-view-secret","client_id":"random-uuid","resume_rev":-1}
{"v":1,"type":"event","event_id":"random-uuid","name":"increment","payload":{},"base_rev":0}
{"v":1,"type":"resync","view_id":"counter","revision":3}
```

Server-to-client examples:

```json
{"v":1,"type":"snapshot","rev":0,"children":[{"tag":"span","id":"value","text":"0"}]}
{"v":1,"type":"patch","prev":0,"rev":1,"ops":[{"op":"set_text","id":"value","text":"1"}]}
{"v":1,"type":"event_ack","event_id":"random-uuid","rev":1}
{"v":1,"type":"ready","rev":1}
{"v":1,"type":"event_rejected","event_id":"random-uuid","code":"stale_revision","rev":2}
{"v":1,"type":"resync_required"}
{"v":1,"type":"error","code":"not_authorized","fatal":true}
```

`resume_rev=-1` means a new page requiring a complete initial snapshot.
Revisions are monotonically increasing **per view**. Every patch has
`rev = prev + 1`. The client refuses out-of-order patches and requests resync;
server replays an available consecutive bounded patch chain or sends a snapshot.
`ready` completes join or resync and permits outbound events. `resync_required` remains available for transport-level revisions; `event_rejected` carries an explicit event ID so a stale queued command does not livelock the client.

## State machine and delivery

- One isolated server actor owns each view's state and serializes its reducer.
  All event handlers are explicitly registered and authenticated. Renderers
  produce typed tree structures, not raw HTML concatenation.
- One event is in-flight per browser view because events include `base_rev`.
  Client queue maximum: 128; in-flight maximum: 1. ACK after state commit and
  patch/snapshot publication. Outstanding IDs are retried on reconnect.
- Server deduplicates event IDs within an actor session, and rejects stale
  `base_rev` with an `event_rejected` frame without mutating state. The browser removes that rejected command, reports an application conflict, and requests a fresh snapshot; it MUST NOT automatically replay the command with a new base revision. Event ID replay is accepted only when principal, event name, payload serialization, and base revision match the original command. Reference defaults: 256 remembered event IDs
  and 32 patch revisions. Eviction is bounded; **this does not provide
  exactly-once side effects across actor restart or failover**. Native system
  must persist idempotency records transactionally for durable effects.
- Reconnect uses bounded exponential backoff (500ms..30s). Production adapter
  must add jitter, maximum session idle TTL, a heartbeat, and cleanup on
  disconnect. A dropped slow client must not block any scheduler carrier.
- A renderer failure, invalid tree, or oversized outbound frame MUST be
  rejected before committing state. Do not execute user events on a partially
  authenticated connection.

## Safe browser patch vocabulary

`set_text`, `set_attr`, `remove_attr`, `replace_children` are the only v1 ops.
Elements have stable IDs. Snapshot tree and replacement subtree have strict
budgets: 512 elements, depth 24, strings at most 8 KiB. HTML tags, attributes,
and URL schemes are allowlisted. No `innerHTML`, `eval`, inline event handlers,
`javascript:` URLs, `<script>`, `<iframe>`, CSS injection, SVG, or foreign
namespaces. All updated IDs must belong to the view root.

The host reference checks operations before DOM writes, but it is **not a
transactional DOM engine**. The native browser implementation still needs
keyed list reconciliation, input/focus/selection preservation, accessibility
announcement policy, cross-op target conflicts, streaming/multipart views,
and recovery from DOM hooks mutated by other libraries.

## Threats / gates

| Risk | Required behavior | Evidence |
|---|---|---|
| Cross-site WebSocket hijack | Upgrade Origin allowlist, auth cookie, per-view CSRF bind | Reference callback + browser restrictions only; **network test pending** |
| XSS via server data | Typed text nodes, escaping, tag/attribute/URL allowlists, CSP | Host reference tests |
| Cross-root DOM corruption | Verify every target belongs to owning view | Host reference tests |
| Out-of-order updates | Revision predecessor check and resync | Host reference tests |
| Duplicate events | ID bound to authenticated command fingerprint | Host reference tests; durable ledger pending |
| Slow client / overload | Bounded send buffers, fairness, disconnect and 503/1013 | **Native gateway pending** |
| Message fragment / masking bugs | RFC 6455 parser, control frames and UTF-8 checks | Host wire vectors and real TCP tests; **native gateway pending** |
| Actor crash / restart | Supervisor escalation, lifecycle cleanup, authorization recheck | **Native guest tests pending** |
| Hot reload | Bind each connection to immutable generation until drained | **Native integration pending** |
| CSP / HTMX script execution | Isolated endpoints, allowlisted OOB HTML, safe headers | Host serializer only; browser integration pending |

A test-only reference reducer cannot prove any of the unexecuted network,
compiler, lifecycle, or backend properties.
