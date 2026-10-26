# Oreslang Phoenix-style server demo

**Status: empty-demo bootstrap.** The machine-readable state is in [`demo-status.txt`](demo-status.txt), and [`DEMO_CONTRACT.md`](DEMO_CONTRACT.md) is the fail-closed acceptance contract that must be satisfied before this repository can claim executable behavior. This is a prospective Oreslang-native example, **not** a port of or claim of compatibility with Elixir/Phoenix, Plug or the BEAM VM. There is no runnable server here yet.

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
