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

## Repository ownership and migration (2026-11-08)

The language is publicly **AttoLang** (formerly Oreslang), while the repository remains `ores-truffle-oreslang/oreslang-phoenix-server.ores`. Keep supported `.ores` source, historical import/package IDs and command names working unless a reviewed compatibility change proves replacements.

- **Belongs here:** Phoenix-style server and actor demo source, protocol acceptance tests.
- **Explicitly out of scope:** production HTTP-server feature parity without executed native guest proof.
- **Organization split:** [atto-lang](https://github.com/atto-lang) maintains the compiler, portable language libraries and demo ecosystem; [atto-co](https://github.com/atto-co) handles independently governed commercial cloud hosting, tenant identity, billing, deployment control, networking and infrastructure. Related `atto-*` repos are not assumed transferred copies.
- **Proposed first move:** transfer this **same GitHub repository** to `atto-lang/oreslang-phoenix-server.ores`, preserving numeric ID, name and Git history, after individual authorizations. No direct old-org transfer to `atto-co` is authorized now. Future product spinouts need a separate decision.

**Migration and security checklist:** post ownership claim to [coordination issue #26](https://github.com/ores-truffle-oreslang/.github/issues/26); follow private [runbook draft #25](https://github.com/ores-truffle-oreslang/.github/pull/25). Record ID, exact head SHA/tree, PR/release/package consumers, Apps/webhooks, Pages, secrets, Actions/runners, branch/ruleset enforcement, target visibility/access, source/target admin approval, independent security review and rollback owner. Never mirror private source to evade a blocked transfer. Verify unchanged identity/history/tree and re-enable protections after the authorized GitHub transfer, then update external references and run exact-head CI. Jobs with zero executed steps (`steps=[]`/`null`) are `NOT_EXECUTED`, not success. Host-only and static tests do not prove native AttoLang guest or production networking capabilities.
