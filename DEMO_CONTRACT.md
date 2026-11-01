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

Earlier PR #6 reported `FIXTURE_NEGATIVE_TESTS_PASS scenarios=15`
and a synthetic inventory validation. Those prior host-only results
do not attest this newer branch. This branch declares seven HTTP
contracts (success, negative, disconnect, bounds, framing, headers, routes)
and eight indexed Oreslang sources (one server and seven clients). The current
GitHub source-organizational workflow has not executed fixture steps.
Neither those previous host-only checks nor this branch's static
registry audit constitute native compiler, listener, or client evidence.

## HTTP request-framing and media-parameter admission (pending native execution)

The source candidate now allows exactly `text/plain`,
`text/plain; charset=utf-8`, or `text/plain;charset=utf-8` for
`POST /echo`. Unsupported, malformed, or ambiguous media parameters
fail closed with 415. This temporary strict profile is not a general
RFC-compliant media-type parameter parser; in particular, other valid
case/whitespace permutations may be rejected.

`tests/http_negative.ores` also probes unknown parameters and an
unexpected `iso-8859-1` charset. `tests/http_framing.ores` probes
duplicate conflicting `Content-Length` headers and conflicting
`Transfer-Encoding: chunked` plus `Content-Length`, then checks
independent `/hello` and `/echo` requests remain responsive.
The only permitted outcomes for ambiguous framing are rejection or
connection closure, **never successful echo dispatch**. These
regressions exercise the upstream HTTP parser. They do not make it safe
if the native runtime actually accepts ambiguous framing, and they do
not establish formal request-smuggling resistance on reverse-proxy
paths or across backends.

All new `.ores` checks are **NOT_EXECUTED** until the independently
reviewed exact-head compiler and listener contracts run successfully.
The contract runner's per-fixture 30-second timeout is not evidence
of the configured five-second application request deadline.

## Additional regression gates (source-only pending execution)

- `tests/http_headers.ores`: malformed HTTP/1.1 Host/header
  admission (missing Host, duplicate Host, nondecimal or negative body
  length) must never produce a successful echo.
- `tests/http_routes.ores`: exact route and method gates for
  `/HELLO`, `/hello/`, `OPTIONS /hello`, `PUT /echo` and
  `DELETE /echo`. A valid request must work afterward.
- `ci/test-runner-preflight.sh`: eleven host-only cases, including
  the valid exact-head path reaching a non-executing fixture sentinel,
  malformed or stale candidate hashes, dirty demo/compiler worktrees,
  invalid SOURCE_REF and a committed symlink SOURCE_REF. No Maven
  or compiler guest may run during these tests.
- `ci/test-fixtures.sh`: now declares 24 host-only adversarial
  fixtures against bad source/oracle registries and unsafe Git entries.

These tests are additions to the **reviewed source candidate**, not
native test passes. GitHub Actions runner assignment, exact compiler
execution, overload, shutdown and live transport remain separate gates.

### Local exact-blob host regression evidence

The 11-case runner preflight and 24-case Git-index fixture policy suites
both executed successfully under local Bash and Git. Before execution,
the local copies were checked against GitHub Git blob IDs:

- `scripts/run-contracts.sh` — `ba7b12441b5fed101bd2586e4dc6b04e43ad7039`
- `ci/check-fixtures.sh` — `42401d66712ed4753de248663e4b985c63c5fe8b`
- `ci/test-runner-preflight.sh` — `c240541424c870bedd0fa5bb05ef7c439501a893`
- `ci/test-fixtures.sh` — `99ed3738fe1034398408b0063c45064e76630e0e`

Observed outputs: `PREFLIGHT_HOST_TESTS_PASS scenarios=11` and
`FIXTURE_NEGATIVE_TESTS_PASS scenarios=24`. A synthetic Git index
containing all seven declared test contracts and eight `.ores` files
also passed the structural inventory gate. Synthetic fixture contents
were placeholders, so this is **not** a native compile or HTTP run,
and it is **not** a green GitHub Actions execution.

Latest candidate source-org GitHub Actions [run #41270965534](https://github.com/ores-truffle-oreslang/oreslang-phoenix-server.ores/actions/runs/41270965534)
failed at zero steps with `runner_id=0` for host fixture admission,
while native guest execution was skipped. Do not promote this
candidate until exact-head host CI and real Oreslang listener tests run.

## Byte-accurate HTTP wire probe and oracle tests (2026-11-01)

`ci/http-wire-probe.py` runs only **after** the native Oreslang
listener and seven native client contracts. Unlike source-only `.ores`
fixtures, it sends actual HTTP/1.1 bytes using Python's standard
library, requires full bodies and exact response bytes, and performs
these acceptance checks:

- Exact successful `/echo` payloads at 0, 1, 16,383 and 16,384
  bytes and `/hello` body match.
- Fully transmitted 16,385-byte `/echo` payload must result in an
  HTTP rejection or an explicit reset/connection close, **never 2xx**.
- Conflicting Content-Length, Transfer-Encoding/Content-Length,
  nonnumeric/negative length, duplicate/missing Host must reject or
  close the connection, never return a successful echo.
- 32 independent requests (8 concurrent workers) must return
  the correct per-request body. This tests bounded concurrency
  and isolation, **not** admission-overload/503 at 64 connections.
- A partial header must receive a rejection or connection closure
  within 8.5 seconds of socket timeout (9s wall-clock allowance)
  and the server must remain responsive afterward. This tests
  bounded handling, **not** exact five-second request deadlines.

A silent socket timeout, malformed or truncated status, 1xx/2xx/3xx,
or false body equality fails the wire probe. `ci/test-http-wire-probe.py`
runs offline against synthetic localhost sockets and mocked HTTP
responses. The earlier version verified **16/16 host-only oracle regressions locally**
under Python 3.13.5 both with and without `-O`; the local files
exactly matched their current GitHub Git blob hashes:

- `ci/http-wire-probe.py` `be6c62faf01537985191de452c525fac49bb8ae7`
- `ci/test-http-wire-probe.py` `5a7ba8150f7b31442aa604dc89afa1fb694df301`

Native execution remains **NOT_EXECUTED** pending the reviewed-SHA
controller, private Actions runner admission, pinned Java/Graal
compiler and exact-head live listener. No generic Phoenix, WebSocket,
load-balancer, security or backend-parity claim is made from synthetic
oracle tests. The exact native runner requires `python3`, runs the
16 offline cases, then executes the TCP probe with an outer timeout.

## Expanded churn and fail-closed oracle coverage (2026-11-01)

This later candidate extends the independently checked wire probe with
four successive waves of 32 GET/POST requests (128 total, eight active
workers at a time) and per-request body identity. This checks repeated
actor dispatch and socket churn, *not* 64-admission overload/503.
It additionally creates and closes 64 deliberately incomplete
client requests across four waves, then requires a fresh successful
`GET /hello` after each wave. This checks recovery from client
disconnects, *not* leak freedom or deterministic actor cancellation.

The probe also verifies strict `/echo` media admission for three
accepted forms and four denied/missing Content-Type cases.
An oversized completed request may only return an HTTP 4xx/5xx
or close/reset; redirect, 2xx, nonstandard 6xx and timeout are
not accepted as proof of rejection. The raw status oracle now
requires a proper CRLF terminator and rejects LF-only status lines.

`ci/test-http-wire-probe.py` now declares **34 host-only test
methods**, including synthetic socket mocks for closure, teardown,
failed recovery, repeated-wave request identity and malformed
response classifications. These additional methods have **not**
been executed on the current candidate in GitHub Actions;
the earlier 16-test local pass applies only to its earlier exact
blobs. Current source integrity and any subsequently executed
tests must be recorded against their own exact Git SHAs.

Still **not covered**: forcing 64 simultaneously active HTTP
exchanges (as distinct from open TCP sockets), proving 503
overload admission, actor supervisor replacement, signal-triggered
graceful drain, memory/FD leak quantification, exact five-second
deadline semantics, WebSockets or native multi-backend parity.
These require instrumented runtime/protocol hooks and actual
reviewed-head native execution; never infer them from churn
or the host-only oracle.

## Strict 503 admission saturation gate (pending native execution)

`ci/http-capacity-probe.py` is an independent loopback TCP acceptance
probe. It sends **80 concurrent incomplete POST bodies** (declaring
16,384 bytes and sending one byte), holds at least **65 established**
connections, observes bounded responses over seven seconds, and
**requires at least one explicit HTTP 503**. An HTTP 408, a close or
reset without a status, a socket remaining silent, or an accepted TCP
handshake is *not* proof of 503/backpressure. It rejects any 1xx/2xx/
3xx response to an incomplete request and checks **two consecutive**
healthy `GET /hello` requests after releasing the held sockets.

The check is intentionally strict and may FAIL on a runtime that
queues and times out requests rather than issuing a 503. Such failure
identifies missing or unverified overload behavior, but does **not**
alone prove a particular runtime defect: TCP connection acceptance
does not prove the HTTP runtime has admitted an application request.
The exact 64-request capacity, resource accounting, supervisor
replacement, graceful drain, five-second deadline, and post-test
memory/descriptor stability remain separate promotion gates.

`ci/test-http-capacity-probe.py` has **32 offline host-only tests**
for malformed HTTP status lines, false 200/302/100/600 success,
408-only and closure-only outcomes, insufficient established sockets,
silent pending connections, real local socket-pair I/O, and two-step
recovery. The suite passed locally under normal and optimized Python
with the following **byte-identical GitHub blob IDs**:

- `ci/http-capacity-probe.py`: `42c2fed9088fa71c5d5f52a42ff9ba481cdb5cbb`
- `ci/test-http-capacity-probe.py`: `7052384ea17e7fad86649c52d581afaacdfda171`

These tests use **no Oreslang compiler**. The hosted PR workflow
runs the 26 offline cases, and the manually reviewed exact-SHA
native runner runs them again before the bounded 45-second live
saturation probe. All native saturation results are currently
**NOT_EXECUTED**; no 503 success is claimed.

The additional five local oracle tests verify that socket ownership is
retained for successful dials, send failures close their sockets, and
**all 80 sockets (or all 64 successfully established ones)** are closed
after both successful and failed synthetic saturation outcomes. Local
unit tests deliberately print a synthetic `HTTP_CAPACITY_PASS` from
mocked I/O; that text is **not** a native server result.

A further end-to-end host self-test runs an actual localhost TCP
server (not Oreslang), holds 64 incomplete requests and responds 503
to overload. It verified 80 established connections, 16 explicit
HTTP 503 responses, cleanup, and two healthy recovery requests.
The full **32/32** tests passed locally both with standard Python
and `-O`. Git blob SHA for the exact executed test file is
`7052384ea17e7fad86649c52d581afaacdfda171`. The synthetic
server is merely a controlled test fixture and does not establish
that the production Oreslang server returns 503 under pressure.

## Slow-client trickle deadline and recovery checks (source candidate)

`ci/http-slow-client-probe.py` uses real loopback TCP to leave
HTTP/1.1 request headers or a 16,384-byte declared request body
incomplete, while continuously trickling one byte every ~650 ms.
For each case it requires an explicit HTTP 4xx/5xx status or connection
closure **within seven seconds from initial connection attempt**,
followed by a successful byte-identical GET `/hello`.

A silent connection, HTTP success or redirect, malformed/partial
status line, or elapsed-time bound violation fails the gate. The
seven-second upper bound is intentionally conservative relative to the
configured five-second request deadline: **a pass is not evidence of
precise five-second accounting**, nor actor/FD leak freedom.

`ci/test-http-slow-client-probe.py` includes 20 offline host-only
checks for 100/200/302/600 false successes, 408/503/599 valid
rejections, LF-only/truncated/oversized status lines, synthetic live
TCP rejection/closure/silence/trickling, invalid parameters and
recovery body corruption. Both files were compared byte-for-byte with
their GitHub Git blobs and **20/20 tests passed locally under normal
and optimized Python**:

- Live probe: `e861fea21bfb1481530ed0690df9a9c2a636758b`
- Offline oracle suite: `9805f396b75b9117b19cb5fe5664337124eca1c7`

The automatic PR job runs only the offline oracle suite. The manually
authorized exact-SHA native runner runs the oracle and then executes
the live probe with an outer 30-second timeout. Neither actual Oreslang
listener execution nor exact-head GitHub Actions step execution is
implied by these local synthetic results. All runtime evidence remains
**NOT_EXECUTED** pending the protected private-runner gate.
