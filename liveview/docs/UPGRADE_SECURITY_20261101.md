# WebSocket upgrade security and portability regression

This draft adds a fail-closed check for an **empty** `Sec-WebSocket-Extensions` header. An absent header is different from an empty one; LiveView v1 negotiates no extensions, including no permessage-deflate. The header must appear at most once in the raw HTTP headers, and the admission check rejects its presence regardless of value.

It also requires HTTP `Origin` to be its exact serialized origin (RFC 6454), without a path, query, fragment or embedded credentials. Both assertions precede authentication/session lookup. A valid upgrade continues to work.

The five backend targets must preserve their exact host-adapter boundary; a structural contract validator rejects changed adapter declarations. The alias `cranelift` maps to Forge but is not an additional sixth backend.

Evidence: tests in `tests/upgrade-origin-extensions.test.mjs` include direct validation and real loopback TCP upgrades. Native Oreslang WebSocket guests **have not** executed. The 41-vector RFC6455 fixture is unchanged. Source-org CI requires actual executed steps; no private-source export to alternate organizations is authorized under platform-conformance issue #22.
