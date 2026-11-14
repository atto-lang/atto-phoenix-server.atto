> [!IMPORTANT]
> **DEPRECATED — project moved to [atto-poc/atto-phoenix-demo.atto](https://github.com/atto-poc/atto-phoenix-demo.atto).**
>
> This private Oreslang-named repository is retained as a **read-only historical reference**; do not start new feature work here. The replacement Atto project has been initialized and [draft migration/benchmark PR #1](https://github.com/atto-poc/atto-phoenix-demo.atto/pull/1) is open.
>
> **Migration is not finished.** This repo's `main` is documentation-only; its unmerged `.atto` implementation and LiveView branches remain here until independently authorized cross-organization source transfer and review. [Security incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) still blocks source copying. Neither full Phoenix compatibility nor a native-executed Atto server is attested.
>
> Repository archival is a follow-up **after** reviewed source migration; this notice does not set the GitHub Archived flag.

# Oreslang Phoenix-style server demo

**Status: empty-demo bootstrap.** This is a prospective Oreslang-native example, **not** a port of or claim of compatibility with Elixir/Phoenix, Plug or the BEAM VM. There is no runnable server here yet.

## Integration contract

- [oreslang-spin](https://github.com/ores-truffle-oreslang/oreslang-spin) provides the proposed HTTP actor dispatch/ownership model.
- [oreslang-rpc](https://github.com/ores-truffle-oreslang/oreslang-rpc) supplies typed operation and schema IDs, with routing metadata kept stable.
- Example supervision/restart should ultimately use optional `stdlib/otp` behaviours, not force OTP into freestanding `core`.
- Routes and templating must not bypass sandbox/host-effect grants or emit unsafe HTML; capabilities remain explicit.

## First executable milestone

1. Implement a tiny GET /hello and POST /echo Oreslang actor application with pinned Spin/router/compiler sources.
2. Add exact-response/body/status tests and backpressure/graceful-shutdown cases, comparing against common REST conformance before any benchmark claims.
3. Separate Oreslang guest execution evidence from host mock/adapter tests; unsupported OTP operations fail closed.
4. Only run private source in reviewed source-org or independently authorized private CI.

Tracked by private [organization integration registry PR #79](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/79).

## Historical repository ownership and migration notes (updated 2026-11-14)

The language is now **AttoLang** (formerly Oreslang). This historical repository retains its original GitHub name and .ores identity; preserve historical source, supported import/package IDs and compatibility behavior when planning migrations.

- **Historical scope:** Phoenix-style server and actor demo source, protocol acceptance tests, and the review history recorded in this repository.
- **Not a production claim:** native AttoLang HTTP/actor runtime support and Phoenix feature parity require independently executed guest evidence.
- **Current demo successor:** [atto-poc/atto-phoenix-demo.atto](https://github.com/atto-poc/atto-phoenix-demo.atto). New implementation work belongs there, subject to its review and security policies.
- **Organization responsibilities:** [atto-lang](https://github.com/atto-lang) covers the language/compiler ecosystem; [atto-poc](https://github.com/atto-poc) holds proof-of-concept demos; [atto-co](https://github.com/atto-co) is separately governed for commercial hosting and operations. The original proposal to transfer this same repository directly to atto-lang is superseded by the successor project and is **not authorization** for any transfer.
- **Source security:** [open incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) forbids private-source mirroring across organizations pending independent clearance. Do not use test-runner budget or branch mirroring as a substitute for security authorization.

**Migration checklist:** coordinate ownership and approvals through [issue #26](https://github.com/ores-truffle-oreslang/.github/issues/26) and the [runbook draft #25](https://github.com/ores-truffle-oreslang/.github/pull/25). Record source/destination identity, exact head and tree SHA, existing PR/release/package consumers, Apps/webhooks, runners/secrets, visibility, protection rules, independent security review, rollback owner and explicit permission for any source transfer. Preserve history and verify exact source identity if a later transfer is authorized. Jobs with zero executed steps are NOT_EXECUTED, not passing CI; host-only source tests do not prove native guest or network execution.

## Unmerged AttoLang HTTP migration candidate (PR #20; native not verified)

This is a stacked historical branch, not an authorization to merge untested source into the deprecated default branch or to copy it to another organization.

**Status: `.atto` source candidate — native execution NOT VERIFIED.**

This application is an AttoLang actor-backed HTTP demo, **not** a port or compatibility implementation of Elixir Phoenix, Plug, LiveView, or the BEAM.

The current default branch is documentation-only and deprecated; HTTP PR #2 and the LiveView/WebSocket drafts remain unverified pending independent security reviews. This migration stacks on [HTTP PR #2](https://github.com/ores-truffle-oreslang/oreslang-phoenix-server.ores/pull/2) to preserve the existing actor server implementation.

## HTTP application

- `src/main.atto`: an isolated `RequestHandler` actor receives single-use claimed request-exchange tokens. The lower-level HTTP host adapter owns framing and socket I/O. The supervisor dispatches the exchange with `rt mut borrow exchange` (matching the pinned Java compiler's documented native HTTP handler ABI).
- `GET /healthz` returns 200 `ok`; `GET /hello` returns 200 `hello from attolang`; `POST /echo` echoes only `text/plain`.
- Wrong methods return 405, missing routes 404, and unsupported echo media types 415.
- Fixed loopback-only `127.0.0.1:8082`, 64 active request admissions, 16 pooled request actors, 16 KiB request body limit, 5s request deadline.
- `tests/*.atto` are candidate guest clients with exact output oracles. `ci/atto-files.txt` and `ci/contracts.tsv` must match the Git index.
- `SOURCE_REF` pins Java/GraalVM compiler commit `6d8eb70048eafc9a84c5aebe9c1bb06104f16e76` (observed `main` on 2026-11-10). A newer compiler tip requires another reviewed pin update and retest.

## Validate and execute

Unprivileged GitHub-hosted CI checks source inventory, native HTTP mutable-borrow dispatch, legacy extension rejection, Git-index symlinks, exact HEAD, and adversarial negative mutations. **It never compiles or executes AttoLang guests.**

On a separately authorized isolated runner with a clean exact checkout of the pinned Java backend:

```bash
# Values must come from an *independent, approved* review/dispatch record.
# Do not self-approve a checkout by deriving these from its current HEAD.
export EXPECTED_DEMO_SHA=<approved-40-character-commit-sha>
export EXPECTED_DEMO_TREE=<approved-40-character-git-tree-sha>
export ATTOLANG_SOURCE_DIR=/absolute/path/to/trusted/oreslang-source.java
bash ci/check-fixtures.sh
bash ci/test-fixtures.sh
bash scripts/run-contracts.sh
```

The runner requires JDK 25, Maven, `setsid`, `timeout`, and scoped loopback network access. After independently approving that exact demo commit and tree, the native preflight rejects dirty, staged and untracked source changes before compiler invocation. It then compiler-checks every `.atto` file, launches the loopback actor server, runs three guest clients, compares exact outputs, verifies server survival, and terminates the process group.

**Unreviewed PR code must not run on persistent private compiler runners.** The previous PR-triggered self-hosted native job is disabled by the structural-only replacement. Native execution needs an independently reviewed exact-SHA approval dispatcher (draft [PR #7](https://github.com/ores-truffle-oreslang/oreslang-phoenix-server.ores/pull/7)) and stepful evidence. No unauthorized cross-organization private source transfer.

## Next phases

LiveView/WebSocket reference drafts [#11](https://github.com/ores-truffle-oreslang/oreslang-phoenix-server.ores/pull/11), [#14](https://github.com/ores-truffle-oreslang/oreslang-phoenix-server.ores/pull/14) and [#17](https://github.com/ores-truffle-oreslang/oreslang-phoenix-server.ores/pull/17) already include transport hardening and a native `counter_live.atto` *target*. They remain separate and **not verified as native guest execution**. Add typed channels, per-view actors, supervision, safe server-rendered diffs and PubSub only behind explicit capabilities, resource limits and security reviews.

See [DEMO_CONTRACT.md](DEMO_CONTRACT.md) and [migration gates](docs/ATTO_MIGRATION_GATES.md).
