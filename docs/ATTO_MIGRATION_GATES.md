# Canonical AttoLang migration gates (2026-11-10)

| Gate | Source/evidence | Status |
| --- | --- | --- |
| Canonical sources | `src/main.atto`, `tests/http_{health,negative,success}.atto` | Authored; not compiled |
| Java/GraalVM source pin | `6d8eb70048eafc9a84c5aebe9c1bb06104f16e76` | Pinned; not executed |
| Legacy extensions | Both source policies reject tracked `.ores`; inventory rejects misplaced/case-variant `.atto` | Structural tests pending hosted execution |
| Actor and I/O semantics | Isolated pooled handler using `rt mut borrow exchange`, `eq`/`neq`, unsuffixed awaitable I/O | Native compile/runtime pending |
| Guest routes | Health, hello, echo; negative status contracts | Loopback native guest pending |
| Transport abuse | Ambiguous framing, body deadline, overload, drain | Not yet app-certified |
| LiveView/WebSocket | Separate drafted host reference and `.atto` target | Not native-verified |
| Full AOT parity | Java first, then LLVM/.NET/Wasm/Forge | Not verified |
| Runner gate | PR CI structural only; private compiler needs independent reviewed exact-SHA dispatch | P0 blocked |

Host-only tests, shared JSON contracts and zero-step CI cannot certify native actor or compiler execution. No unauthorized cross-organization mirroring, private runner bypass or merge without review.
