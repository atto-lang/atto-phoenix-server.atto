# LiveView subscriber broadcast generation fence

This host-only reference hardening prevents a callback from mutating the live
subscriber iteration. A broadcast snapshots its admitted audience before any
outbound callback runs; new attachments must not receive the in-flight revision.
Delivery checks that the originally snapshotted attachment generation is still
current. A failed old-generation callback must not detach a reattached successor.
The actor state/revision commit remains authoritative and is not rolled back by
observer failure. These tests are NOT compiled AttoLang guest evidence.

Native implementations must provide equivalent generation-fenced subscriber
iteration and error cleanup for Java/GraalVM, LLVM, Wasm host adapters,
Forge/Cranelift, and .NET AOT. Execute actual actor/transport tests before parity
or release claims. Do not mirror private source across organizations while the
security issue #22 source-export hold is open.
