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

## Additional hardening tests

The source candidate includes `http_headers` and `http_routes`
native regression clients for HTTP parser admission and exact route
matching. Host-only CI now adds `ci/test-runner-preflight.sh` and
more fixture-index adversaries. These are intentionally **not** claims
of Java/Graal native guest execution. The reviewed exact-head runner
gate and protected-environment approval remain prerequisites.

## Byte-accurate HTTP acceptance tests

The native contract runner now performs an additional independent,
dependency-free Python TCP probe **against the real Oreslang loopback
listener**. It checks fully transmitted 16 KiB boundaries, completed
16 KiB + 1 overflow rejection, malformed framing, 32 concurrent
requests with isolated response bodies and stalled-header closure.

`python3 -I -B ci/test-http-wire-probe.py` runs the corresponding
host-only failure-oracle tests without a compiler or application
listener. These offline tests are not a substitute for native
execution; the reviewed private-runner gate remains closed.

## Repeated connection churn and abort tests

The byte-level wire contract now requests 128 independent
GET/POST operations across four waves, checks 64 deliberate
client disconnects, and verifies per-wave recovery and strict
media types. Offline oracle coverage has expanded to 34
authored cases; the new ones still require exact-head CI or
independent execution to become verified pass results.
These probes are not proof of 64-admission overload/503,
resource-leak freedom or actor supervision recovery.

## Strict overload evidence (not yet executed on Oreslang)

`ci/http-capacity-probe.py` deliberately holds 80 incomplete request
bodies against the 64-admission listener. It requires at least 65
established sockets, **an explicit HTTP 503**, and post-pressure
healthy responses; silent or timed-out sockets cannot satisfy the
503 gate. `ci/test-http-capacity-probe.py` tests the oracle offline.
Local verified host checks: **31/31** under normal and optimized Python.
The actual 503/overload runtime result remains **NOT_EXECUTED**.
