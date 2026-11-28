# LiveView v1 event replay fingerprint — draft conformance contract

**Status:** Node reference and golden vectors. NOT verified on any Oreslang guest backend.

To make an event ID idempotent across Java, LLVM, browser/worker Wasm, Forge/Cranelift and .NET, compute the exact SHA-256 digest over the UTF-8 encoding of:

```text
JSON.stringify([authenticated_user, event_name, base_revision, canonical_payload_json])
```

Here `canonical_payload_json` is a **JSON string**, not a nested JSON object. It is obtained recursively by:

- sorting record keys in ascending UTF-16 code-unit order (keys are ASCII `[A-Za-z][A-Za-z0-9_-]*` under the existing v1 event validator);
- emitting JSON-escaped keys and scalars using ECMAScript `JSON.stringify` scalar formatting, with no optional whitespace;
- retaining array element order; and
- allowing only JSON null, booleans, finite numbers (integers must be IEEE-754 safe), valid Unicode strings, dense arrays (up to 64 values) and plain JSON records (up to 64 fields, depth at most 8).

No prototypes, accessors, `toJSON` hooks, missing array elements, lone surrogate code units, `NaN`, infinities, or unsafe integers. A browser dispatch snapshots the payload after validation, before first send; subsequent caller mutation cannot change the queued command or retry fingerprint. This is a **version-1 wire contract**: altering the encoding requires a new version and a deliberate migration of deduplication records.

The exact fixture is `fixtures/liveview-event-fingerprint-v1.json` (8 vectors), Git blob SHA `e9fc97d87dee2670c56ff3abf9e86befbc0f2ff8`. Backends must compare each complete 64-character digest against those values, including Unicode, decimals, nested objects, ordering, user identity and revision. The fixed 41-case RFC6455 fixture tests the separate transport layer. Passing either fixture on a host parser cannot establish Oreslang guest execution.

**Security limits:** The digest is a command equality key, **not** a MAC, signature, CSRF token or authentication proof. Authenticity comes from the upgraded transport's session and CSRF checks, and replay IDs must remain unpredictable. The bounded in-memory replay ledger does not guarantee exactly-once side effects through actor restart or durable failover. Persist idempotency and revision atomically with external side effects if that property is required.

Native promotion requires compiler-produced guest execution, actual socket I/O, actor-owned state, supervisor shutdown/restart, reconnect E2E, authenticated exact-head runner provenance, and positive and negative proofs on all five backends. Wasm requires an explicit host WebSocket capability; it must not pretend to listen for inbound TCP in core Wasm.
