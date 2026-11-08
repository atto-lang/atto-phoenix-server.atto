# atto-phoenix-server.atto

Experimental server architecture and concurrency patterns implemented in AttoLang.

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

AttoLang is the public name; preserve existing Oreslang/.ores compatibility and use canonical .atto for new portable library source. This README defines scope, not feature readiness.

**Acceptance:** name exact source SHA/tree, runtime/toolchain, positive and negative checks and execution receipt before claiming support. Host-only tests and empty CI steps do not prove guest execution.
