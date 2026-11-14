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
