> **AI agent instructions (organization-wide):** Before working on code, issues, or pull requests, read and follow the [organization `AGENTS.md`](https://github.com/atto-lang/.github/blob/main/AGENTS.md), including its **merge-first stealth-development policy**. Honor any repository-local `AGENTS.md`, explicit holds, and GitHub-enforced rules.

# atto-phoenix-server.atto

Experimental server architecture and concurrency patterns implemented in AttoLang.

## Naming migration and language authority

This repository is maintained at [atto-lang/atto-phoenix-server.atto](https://github.com/atto-lang/atto-phoenix-server.atto); use `https://github.com/atto-lang/atto-phoenix-server.atto.git` for Git remotes and canonical `.atto` source examples. The normative language contract is [atto-spec](https://github.com/atto-lang/atto-spec), with executable guest evidence tracked by [atto-platform-conformance](https://github.com/atto-lang/atto-platform-conformance). Follow current ownership, borrowing, effects, actor, and syntax rules there; do not infer implemented features from a README or unexecuted CI.

## Project scope

Server concurrency, connection handling, and runtime experiments.

## Development and validation

Document the specific `.atto` source, expected results, supported backend/toolchain, and commands that have been executed.

## Status

This is a statement of intended scope, not a claim of completed implementation or production readiness. Source, CI, and checked-in examples are authoritative for actual supported features and commands.

## Ecosystem

- [AttoLang organization](https://github.com/atto-lang)
- [Language specification](https://github.com/atto-lang/atto-spec)
- [Platform conformance](https://github.com/atto-lang/atto-platform-conformance)

## Repository ownership and contribution routing

**Belongs here:** An experimental Phoenix-inspired server design in .atto: connection supervision, actor fan-out, messaging and live state architecture.

**Belongs elsewhere:** Generic HTTP routing in atto-http-routing; general server example in atto-api-server.atto; reusable reactive functions in atto-rx.

**Security and portability boundary:** Clearly label research vs production support; test supervised failures, mailbox quotas, reconnect/restart and generation-fenced actor references.

AttoLang is the canonical project name; new source, examples and documentation use `.atto` and the `atto-lang` repository organization. This README defines scope, not feature readiness.

**Acceptance:** name exact source SHA/tree, runtime/toolchain, positive and negative checks and execution receipt before claiming support. Host-only tests and empty CI steps do not prove guest execution.

## Historical HTTP candidate (migration in progress)

This branch preserves the original `.ores` loopback HTTP candidate for integration with the canonical `.atto` migration in PR #20. It defines GET /hello, POST /echo, 404/405/415 contracts, a 16 KiB body bound, a five-second deadline and a 127.0.0.1:8082 listener. These are source-level intentions, not verified runtime behavior. See `DEMO_CONTRACT.md` and `demo-status.txt` for the historical scope and evidence boundary. Do not treat this legacy candidate as an accepted AttoLang implementation.

The historical compiler pin is recorded in `SOURCE_REF`; the legacy compiler is not fetched or executed by automatic PR jobs. Only ephemeral host-side fixture checks run here. Native execution requires a separately reviewed exact-SHA dispatcher and an authorized isolated compiler checkout; no private compiler source may be mirrored without authorization. See [legacy security incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22). No Phoenix/Plug/BEAM compatibility, production readiness, or native execution is attested.
