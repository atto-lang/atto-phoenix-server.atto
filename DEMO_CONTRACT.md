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

Current clients verify exact hello/echo bodies, 404/405/415 status
behavior, and recovery after clients disconnect mid-header or mid-body.
The disconnect regression uses only existing native `.ores` client APIs,
then checks both /hello and /echo remain responsive. It does **not**
prove all pending resources were freed or that timeouts are enforced.

### New source-only coverage (requires real compiler/runtime execution)

- `tests/http_negative.ores`: HTTP 405 for POST /hello, HEAD /hello,
  and GET /echo; HTTP 404 for /missing; HTTP 415 for application/json,
  prefix-lookalike text/plainx, and a missing Content-Type.
- `tests/http_disconnect.ores`: a connection that closes before its
  headers finish, a connection advertising more body bytes than supplied,
  and subsequent successful /hello and /echo requests.
- `ci/contracts.tsv`: exact exit/stdout oracle for the disconnect test;
  `ci/oreslang-files.txt`: explicit compiler-check registration.

Tests must not be marked as passing merely because the sources exist or
host-only registry checks succeed. If the runtime rejects, hangs, or cannot
compile these cases, keep the PR draft and surface a specific compiler or
HTTP-runtime defect.

## Remaining gates

- graceful application-triggered drain using `server.shutdown(grace_ms)`;
- client disconnect and deadline behavior;
- overload/503 behavior under bounded admission;
- handler failure mapping and actor replacement;
- repeated start/stop with no leaked actors or listener state;
- hot-generation routing where new requests bind to the new generation and old requests drain under the old generation;
- Java/Graal AOT and LLVM parity before backend-neutral claims.

No Phoenix/Plug/BEAM compatibility, production readiness, or benchmark claim follows from this source candidate.

## CI trust boundary (must be configured outside this repository)

- Unreviewed pull-request code runs **host-only structural checks** on an
  ephemeral GitHub-hosted runner. It must never run the private compiler or
  execute guest code with access to a persistent trusted compiler checkout.
- Native execution requires a separately installed reviewed dispatcher (**not provided by this branch**) and needs
  an explicit, fully qualified reviewed demo commit SHA. Runner scripts require
  both the demo worktree and the pinned compiler worktree to be clean at their
  exact expected commits.
- The `phoenix-exact-guest-review` GitHub Environment is a *required external
  operational control*: administrators must configure protected branches/ref
  restrictions and required human reviewers before any manual run. Merely
  declaring the environment in YAML does **not** configure those protections.
- Use a dedicated runner with minimal network access and no unrelated secrets.
  Compiler checkouts must not be fetched, copied, or mirrored into another
  organization unless that private-source transfer is independently authorized.
- The host fixture gate rejects tracked symlinks and gitlinks anywhere in the
  Git index, not merely under source and test directories. This does not by
  itself guarantee that a manually approved guest is safe to execute.\n- A queued, blocked, zero-step, skipped, or host-only green job is **not** native
  compiler/guest execution proof. Keep `execution=pending-exact-head` until a
  complete exact-head compile and actual HTTP client/server run succeeds.

Release remains blocked until the runtime gate runs and the outstanding
shutdown, overload, isolation and multi-backend requirements above are met.

## Proposed body-size and deadline regression

The native `tests/http_bounds.ores` client now sends a declared
`Content-Length: 16385` to a 16 KiB listener, then sends an unfinished
header section and waits for rejection or connection closure. **Neither
case may return HTTP 200**, and the listener must still serve `GET
/hello` afterward. The per-contract runner timeout is 30 seconds.

This is a bounded-recovery probe, not proof of precise five-second
deadline accounting or of correct body buffering/memory usage. In
particular, the client declares 16,385 bytes but does not transmit a
full 16,385-byte body; this primarily checks header admission, not
allocation under a completed oversized upload. The fixture also cannot
prove overload/503 or graceful shutdown, which remain separate gates.
Until the native compiler runs the exact candidate, the result is
**pending, not passing**.

## Exact-source fixture security verification

The host-side fixture validator checks all Git index entries and rejects
case-mixed source and oracle extensions (e.g. `.OrEs`, `.oReS`,
`.OuT`), including filenames with embedded newlines that the
line-oriented Git output could quote or omit. Accepted Oreslang source
paths are exactly `src/[a-z0-9_]+.ores` and
`tests/[a-z0-9_]+.ores`; oracles are exactly
`tests/[a-z0-9_]+.out`.

The independently executed fixture regression reports
`FIXTURE_NEGATIVE_TESTS_PASS scenarios=15`. A synthetic local Git
checkout containing the registered three contracts and four sources
reports `FIXTURE_STRUCTURAL_PASS contracts=3 sources=4`.
These are **host-only** checks, not execution of the real `.ores`
clients, the HTTP server, or the pinned Java compiler.
