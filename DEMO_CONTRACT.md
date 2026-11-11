# AttoLang Phoenix-style HTTP acceptance contract

**Status:** canonical `.atto` candidate; native guest execution not attested.

## Current intended boundary

- Loopback-only `127.0.0.1:8082`, 64 active HTTP admissions, 16 pooled isolated actors, 16 KiB body cap, 5s per-request deadline.
- `GET /healthz` -> 200 `ok`; `GET /hello` -> 200 `hello from attolang`; `POST /echo` returns the exact plain-text request body.
- Unknown route 404, wrong method 405, unsupported echo media type 415.
- Single-use `http.claim` actor-bound token; no guest socket, reflection, process or unrestricted filesystem authority.
- `eq` / `neq` canonical comparison operators and unsuffixed awaitable I/O APIs.

## Required executed evidence before promotion

1. Attest exact demo PR head/tree and `SOURCE_REF` compiler head/tree.
2. Run source inventory and Git-index negative policy tests (legacy `.ores`, odd-case extension, path/symlink/contract tampering).
3. Compile-check **all** inventory `.atto` files with the pinned real compiler.
4. Start a real actor-backed loopback HTTP server, run all **three** native `.atto` clients, compare exact stdout, check negative HTTP status codes and server survival.
5. Add and execute request framing, 503 overload, 504 deadline, disconnect, drain, restart, hot-generation and actor-reclamation tests.
6. Require nonzero-step exact-head CI and independent review; zero-step jobs remain `NOT_EXECUTED`.
7. Repeat actual portable contracts with LLVM, .NET NativeAOT, Wasm and Forge before any five-backend claim.

No public bind, TLS, HTTP/2, native guest WebSockets, Phoenix compatibility, arbitrary HTML rendering or hostile-code tenant sandbox is claimed. Transport validates framing; actor application logic stays in `.atto`; the supervisor retains lifecycle and admission authority. Stateful sessions need serial mailbox ownership, generation fencing, bounded slow-subscriber backpressure and cancellation.
