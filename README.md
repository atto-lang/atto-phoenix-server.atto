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

## Historical unmerged HTTP candidate (PR #2; not verified)

This draft branch carries earlier Oreslang HTTP actor source and tests, even though the current default branch is documentation-only and this project is deprecated. The code remains unmerged, not native-executed, and not approved for transfer to a different organization.

**Status: loopback HTTP source candidate; exact-head execution pending.**

This repository now contains a small Oreslang-native HTTP actor application with:

- `GET /hello` → `hello from oreslang`;
- `POST /echo` → echoes a bounded `text/plain` request body;
- explicit 404, 405, and 415 behavior;
- a fixed **127.0.0.1:8082** listener;
- admission capacity 64, 16 pooled isolated request actors, a 16 KiB body limit, and a 5 second request deadline.

This is an ergonomics/demo project. It is **not** a port of or compatibility claim for Elixir Phoenix, Plug, or the BEAM VM.

The machine-readable status is in [`demo-status.txt`](demo-status.txt), and [`DEMO_CONTRACT.md`](DEMO_CONTRACT.md) defines the promotion boundary.

## Exact compiler boundary

`SOURCE_REF` pins the Java/Graal compiler/runtime to `f40b9c3a3b5b4691eb4f4a5d5d0558a112f237aa`.

The CI runner never fetches, resets, or mirrors private compiler source. The trusted source-org runner must provide an existing clean `ORESLANG_SOURCE_DIR` at exactly that commit. The contract runner compiler-checks every inventoried source, starts the real Oreslang listener, and drives it with Oreslang HTTP/TCP clients.

A queued or zero-step job is `NOT_EXECUTED`; no runtime pass is claimed until real steps run.

## Current constraints

TLS, HTTP/2, WebSockets, templates, JSON codecs, signed cookies, database access, public bind, and outbound application network access are not part of this demo. The server receives only the loopback listener capability used by the test profile.

Graceful signal-driven draining and hot-generation routing remain later gates. The underlying HTTP runtime exposes bounded server shutdown, but this source candidate does not yet expose an application control path for it.

Tracked by [issue #3](https://github.com/ores-truffle-oreslang/oreslang-phoenix-server.ores/issues/3).
