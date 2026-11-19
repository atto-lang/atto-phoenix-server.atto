> **AI agent instructions (organization-wide):** Before working on code, issues, or pull requests, read and follow the [organization `AGENTS.md`](https://github.com/ores-truffle-oreslang/.github/blob/main/AGENTS.md), including its **merge-first stealth-development policy**. Honor any repository-local `AGENTS.md`, explicit holds, and GitHub-enforced rules.

> [!IMPORTANT]
> **DEPRECATED — project moved to [atto-poc/atto-phoenix-demo.atto](https://github.com/atto-poc/atto-phoenix-demo.atto).**
>
> This private Oreslang-named repository is retained as a **read-only historical reference**; do not start new feature work here. The replacement Atto project has been initialized and [draft migration/benchmark PR #1](https://github.com/atto-poc/atto-phoenix-demo.atto/pull/1) is open.
>
> **Migration is not finished.** This repo's `main` is documentation-only; its unmerged `.atto` implementation and LiveView branches remain here until independently authorized cross-organization source transfer and review. [Security incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) still blocks source copying. Neither full Phoenix compatibility nor a native-executed Atto server is attested.
>
> Repository archival is a follow-up **after** reviewed source migration; this notice does not set the GitHub Archived flag.

# Oreslang Phoenix-style server demo

## AttoLang migration and current contracts (2026-11-18)

**AttoLang (formerly Oreslang)** is the public language name. This `ores-truffle-oreslang/oreslang-phoenix-server.ores` repository is the legacy named checkout; new corresponding work is routed to **[atto-lang/atto-phoenix-server.atto](https://github.com/atto-lang/atto-phoenix-server.atto)**. Existing history, issue/PR records, CI results, commands, and implementation status are not assumed identical across the two repos. The content and example commands below document this checkout, and legacy `.ores`, `oreslang-*` names and ABI/wire interfaces remain compatibility surfaces until proven migrations.

**[atto-spec](https://github.com/atto-lang/atto-spec)** is the canonical normative language specification (not old Oreslang README files); [atto-platform-conformance](https://github.com/atto-lang/atto-platform-conformance) owns portable positive/negative guest tests, and [atto-common-source](https://github.com/atto-lang/atto-common-source) owns portable `.atto` library code. Source design targets include `snake_case`, explicit `borrow!`/`take!`/`share!`/`copy!`/`copy!!`, [implicit argument borrowing](https://github.com/atto-lang/atto-spec/blob/main/language/implicit-argument-borrow-v1.md), [file/module `define const` with permitted one-time nonthrowing `os.read_env`](https://github.com/atto-lang/atto-spec/blob/main/language/file-module-const-v1.md) and [bitwise shifts `<<<`/`>>>`/`ashr` versus `<<`/`>>` stream operations](https://github.com/atto-lang/atto-spec/blob/main/language/bitwise-and-stream-operators-v1.md). These are intended semantics, not evidence this old project executes them.

No Python scripts, generators or test/CI harnesses for new AttoLang work; prefer Rust tools when necessary. Compiler/runtime parity requires exact commits/tree, toolchain, actual positive and negative compiled guest tests, and explicit unsupported/failed/not-executed results. Host-only tests or zero-step Actions cannot certify language support.

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
