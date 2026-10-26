# Phoenix-style server acceptance contract

The repository is an **executable loopback source candidate**. Promotion requires a real green exact-head run on the pinned compiler.

## Implemented boundary

- Fixed loopback listener: `127.0.0.1:8082`.
- Bounded HTTP admission: 64 active requests.
- Bounded request body: 16 KiB.
- Request deadline: 5 seconds.
- Pooled isolated request actors: 16.
- `GET /hello` only.
- `POST /echo` only, with `text/plain` content type.
- Unknown routes return 404; wrong methods return 405; unsupported echo media types return 415.
- No filesystem, subprocess, host reflection, public bind, template, database, or arbitrary outbound-network capability.

## Required executable evidence

The exact runner must:

1. prove the demo and compiler commit/tree identities;
2. prove the compiler checkout is clean and equals `SOURCE_REF`;
3. compiler-check every path in `ci/oreslang-files.txt`;
4. start the real Oreslang HTTP listener;
5. execute every row in `ci/contracts.tsv` with exact stdout oracles;
6. verify the server remains alive after the negative cases.

Current clients verify exact hello/echo bodies plus 404/405/415 status behavior.

## Remaining gates

- graceful application-triggered drain using `server.shutdown(grace_ms)`;
- client disconnect and deadline behavior;
- overload/503 behavior under bounded admission;
- handler failure mapping and actor replacement;
- repeated start/stop with no leaked actors or listener state;
- hot-generation routing where new requests bind to the new generation and old requests drain under the old generation;
- Java/Graal AOT and LLVM parity before backend-neutral claims.

No Phoenix/Plug/BEAM compatibility, production readiness, or benchmark claim follows from this source candidate.
