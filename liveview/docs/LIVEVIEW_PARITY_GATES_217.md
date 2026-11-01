# LiveView 217 host-reference security and parity gate

Host-reference suite expands 209 to 217 cases, including case-sensitive WebSocket protocol offers, duplicate-token denial, live TCP upgrade tests and required application-frame contract enforcement.

These are Node/host-only checks and DO NOT demonstrate native Oreslang guest execution on Java, LLVM, Wasm, Forge/Cranelift or .NET.

Native promotion still requires a compiled .ores actor-owned session, 41 exact RFC6455 wire observations, authenticated stepful job/run/runner evidence, bounded lifecycle and reconnect/supervisor E2E per backend. Pure Wasm requires a host adapter rather than a freestanding inbound listener.

Source-org protected-main approval and the security incident #22 private-source export hold remain in force. No guest claims or merges until verified.
