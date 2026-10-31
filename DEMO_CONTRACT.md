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

## CI trust boundary (must be configured outside this repository)

- Unreviewed pull-request code runs **host-only structural checks** on an
  ephemeral GitHub-hosted runner. It must never run the private compiler or
  execute guest code with access to a persistent trusted compiler checkout.
- The exact native runtime job is **manual workflow_dispatch from `main` only** and needs
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
- The host fixture gate rejects tracked symlinks and gitlinks anywhere in the\n  Git index, not merely under source and test directories. This does not by\n  itself guarantee that a manually approved guest is safe to execute.\n- A queued, blocked, zero-step, skipped, or host-only green job is **not** native
  compiler/guest execution proof. Keep `execution=pending-exact-head` until a
  complete exact-head compile and actual HTTP client/server run succeeds.

Release remains blocked until the runtime gate runs and the outstanding
shutdown, overload, isolation and multi-backend requirements above are met.
