# Oreslang Phoenix-style server demo

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
