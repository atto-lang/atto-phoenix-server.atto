# Additional Phoenix loopback HTTP wire-test matrix

This stacked draft adds source-authored probes to the seven Oreslang fixtures
and existing Python wire tests. It does not change application behavior,
private compiler pin, environment approval, or native authorization.

## Added matrix

- Three exact canonical text/plain MIME spellings require 200 and byte-identical echo.
- Seven unsupported MIME values (prefix lookalikes, JSON, unknown/duplicate
  parameters, ISO-8859-1, trailing semicolon) require 415 and no successful echo.
- Eight wrong-route/method cases require their exact 404 or 405, plus positive /hello.
- Seven raw framing variants probe reversed conflicting Content-Length, mismatching
  comma-separated lengths, signed and overflowing lengths, reversed/case-varied
  Transfer-Encoding + Content-Length, and a pipelined second request.
  All must receive 4xx/5xx or a clean close, never a timeout or success.
- Valid /hello must work after framing rejection.
- Eleven local host-only oracle tests cover status/body false positives,
  corpus completeness, rejection exceptions, timeout propagation and recovery.

## Evidence and limits

The new 11/11 offline unit tests executed locally with a minimal interface
shim. The two Python files were byte-verified against GitHub Git blob IDs.
This proves the authored test oracles, not any HTTP server, compiler,
runner admission, native guest or backend behavior.

A source-org GitHub Actions host run must execute steps at the exact SHA.
Separately reviewed main-branch dispatch, private environment protections,
a clean pinned JDK 25 compiler, and real Oreslang client/server execution
are required before native results can be claimed.

First-response rejection for a smuggling-shaped payload does NOT establish
absence of secondary request dispatch. That stronger property needs parser
and dispatch instrumentation. This strict MIME profile is not a complete
RFC media-type parser. Overload/503, exact five-second deadline, actor
failure, draining, shutdown, hot generation, resource reclamation and
Java/Graal/LLVM/WASM/Forge/.NET parity remain separate unverified gates.

Keep the PR draft, SHA allowlist empty and native guest switch disabled.
