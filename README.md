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

## Canonical HTTP candidate

This branch carries the `.atto` loopback actor demo with health, hello, echo and negative request contracts. See `DEMO_CONTRACT.md` and `docs/ATTO_MIGRATION_GATES.md`. The public compiler checkout is pinned by `SOURCE_REF`; a new isolated hosted workflow runs the public compiler and guest contracts without private credentials, private source transfer or persistent runner access. Its existence is not execution evidence. The historical private runner remains disabled pending its separate approval policy. No Phoenix compatibility, production, or multi-backend parity claim is made.

## Ores Live v1 protocol foundation (not a WebSocket server)

The independent `web/ores-live.mjs` browser client and `src/live_wire.atto` revision/replay rules are described in [the protocol contract](docs/LIVE_UPDATES_V1.md). Run `bash ci/test-live-web.sh` for host tests. Native guest evidence requires a successful pinned compiler run. This is not an integrated WebSocket server.
