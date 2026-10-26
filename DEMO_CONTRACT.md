# Phoenix-style server demo acceptance contract

This is an Oreslang-native HTTP application example inspired by ergonomic server frameworks. It is **not** a Phoenix, Plug, BEAM, or Elixir compatibility claim.

## First server boundary

- The first executable listener binds loopback only and exposes exactly the reviewed routes.
- Start with `GET /hello` and `POST /echo`; unknown routes fail closed.
- Request headers and body are independently bounded. Oversized requests are rejected before actor work is admitted.
- The echo route returns bytes/text only after content-type and UTF-8 policy is explicit; it must not become a template/HTML sink by accident.
- No filesystem, subprocess, outbound-network, environment-secret, or reflection capability is granted unless the route requires and tests it.
- Admission/backpressure is bounded and observable; overload gets an explicit response rather than unbounded actor growth.

## Actor lifecycle

- A request has one documented actor owner and completion future.
- Cancellation, deadline expiry, client disconnect, handler error, and graceful shutdown settle the request exactly once.
- Restart/supervision uses Oreslang supervisor semantics; do not emulate OTP behavior and then claim OTP compatibility.
- Hot reload, when introduced, must route new requests to a new generation while old requests drain under their original generation.

## First executable evidence

The implementation PR must replace bootstrap-only CI with exact-head guest execution. Required tests: exact hello response, echo success, unsupported method, missing route, malformed/oversized body, overload, deadline, client disconnect, handler failure, graceful drain, and repeated restart.

No benchmark or framework-comparison claim is valid until the same executable path passes correctness tests first.
