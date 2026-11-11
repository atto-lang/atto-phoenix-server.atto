# AttoLang Phoenix-style actor web server

**Status: `.atto` source candidate — native execution NOT VERIFIED.**

This application is an AttoLang actor-backed HTTP demo, **not** a port or compatibility implementation of Elixir Phoenix, Plug, LiveView, or the BEAM.

The repository's `main` remains a bootstrap while HTTP PR #2 and the LiveView/WebSocket drafts await their own independent security reviews. This migration stacks on [HTTP PR #2](https://github.com/ores-truffle-oreslang/oreslang-phoenix-server.ores/pull/2) to preserve the existing actor server implementation.

## HTTP application

- `src/main.atto`: an isolated `RequestHandler` actor receives single-use claimed request-exchange tokens. The lower-level HTTP host adapter owns framing and socket I/O.
- `GET /healthz` returns 200 `ok`; `GET /hello` returns 200 `hello from attolang`; `POST /echo` echoes only `text/plain`.
- Wrong methods return 405, missing routes 404, and unsupported echo media types 415.
- Fixed loopback-only `127.0.0.1:8082`, 64 active request admissions, 16 pooled request actors, 16 KiB request body limit, 5s request deadline.
- `tests/*.atto` are candidate guest clients with exact output oracles. `ci/atto-files.txt` and `ci/contracts.tsv` must match the Git index.
- `SOURCE_REF` pins Java/GraalVM compiler commit `6d8eb70048eafc9a84c5aebe9c1bb06104f16e76` (observed `main` on 2026-11-10). A newer compiler tip requires another reviewed pin update and retest.

## Validate and execute

Unprivileged GitHub-hosted CI checks source inventory, legacy extension rejection, Git-index symlinks, exact HEAD, and adversarial fixture policy. **It never compiles or executes AttoLang guests.**

On a separately authorized isolated runner with a clean exact checkout of the pinned Java backend:

```bash
export EXPECTED_DEMO_SHA="$(git rev-parse HEAD)"  # Must match independently reviewed SHA
export ATTOLANG_SOURCE_DIR=/absolute/path/to/trusted/oreslang-source.java
bash ci/check-fixtures.sh
bash ci/test-fixtures.sh
bash scripts/run-contracts.sh
```

The runner requires JDK 25, Maven, `setsid`, `timeout`, and scoped loopback network access. After independently approving that exact demo SHA, it compiler-checks every `.atto` file, launches the loopback actor server, runs three guest clients, compares exact outputs, verifies server survival, and terminates the process group.

**Unreviewed PR code must not run on persistent private compiler runners.** The previous PR-triggered self-hosted native job is disabled by the structural-only replacement. Native execution needs an independently reviewed exact-SHA approval dispatcher (draft [PR #7](https://github.com/ores-truffle-oreslang/oreslang-phoenix-server.ores/pull/7)) and stepful evidence. No unauthorized cross-organization private source transfer.

## Next phases

LiveView/WebSocket reference drafts [#11](https://github.com/ores-truffle-oreslang/oreslang-phoenix-server.ores/pull/11), [#14](https://github.com/ores-truffle-oreslang/oreslang-phoenix-server.ores/pull/14) and [#17](https://github.com/ores-truffle-oreslang/oreslang-phoenix-server.ores/pull/17) already include transport hardening and a native `counter_live.atto` *target*. They remain separate and **not verified as native guest execution**. Add typed channels, per-view actors, supervision, safe server-rendered diffs and PubSub only behind explicit capabilities, resource limits and security reviews.

See [DEMO_CONTRACT.md](DEMO_CONTRACT.md) and [migration gates](docs/ATTO_MIGRATION_GATES.md).
