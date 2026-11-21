# HTTP ambiguous-framing connection-retirement gate

This draft is stacked on Phoenix HTTP PR #12 and retains its security boundaries.
The new native test writes three ambiguous HTTP requests **followed by a
pipelined GET /hello on the same TCP connection**. Each case must produce one
explicit 4xx/5xx response or close without a response, and then the connection
must physically close within seven seconds. Silence, a lingering keep-alive,
HTTP 2xx/3xx, a second HTTP response, malformed status, partial resets and
oversize response buffers are not accepted.

The suite checks independent GET /hello exact-body recovery before and after
each malformed connection. A host-only fake TCP server test has 15 unit cases;
normal and optimized Python both passed locally. Neither executed Oreslang.

This narrows but does **not** prove request-smuggling resistance. A server
could execute an unauthorized second request without emitting an observable
second response. The stronger proof needs native HTTP parser/actor dispatch
instrumentation with request IDs, generation fences and delivered-exchange
counters, plus reverse-proxy differential tests if deployment includes a
frontend proxy.

Review and run only after private Actions host admission and independently
approved pinned JDK25 compiler guest execution. Keep zero-step runs and
unavailable backends classified NOT_EXECUTED. Do not transfer private compiler
source to another org or bypass default-branch/environment protections.
