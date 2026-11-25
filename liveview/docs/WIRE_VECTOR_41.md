# Ores LiveView WebSocket wire vector expansion (host-only)

This stacked change extends the existing 14 exact RFC6455 vectors to **41**
curated positive/negative byte vectors, without changing the protocol version.
It adds 27 cases for empty and 125-byte control payloads, fragmented UTF-8,
Unicode validity, close codes/reasons, opcode/RSV/control flags, nonminimal
lengths and oversized 64-bit frame declarations.

Each of the 41 vectors is independently run through the existing Node
host-reference parser in four deterministic transport segmentations: whole
input, one byte at a time, Fibonacci chunks, and 7-byte chunks. The original
whole-frame test stays in place: **205 authored vector assertions**
(41 original matrix cases + 164 segmented variants), plus one strict
inventory test. These are new authored tests, **not** claimed executed
without actual runtime evidence.

Case values and close/error codes are reviewed for protocol agreement; on
future adoption the exact fixture must be tested against **compiled native
Java, LLVM, Wasm, Forge/Cranelift and .NET** decoder outputs, with each backend
reporting the actual bytes and close reason. Node executions only prove the
independent host reference; Java host JUnit without source guest does not
establish Oreslang language runtime parity.

WebSocket transport actor ownership, session authorization and HTMX OOB remain
separate layers. Do not use these wire vectors to claim those security
boundaries passed.

Source scope: draft Phoenix PR #11. It is a host-reference branch; the
pinned Java backend WebSocket feature is draft #2061. Private runner admission
and independent approval security gates remain unchanged. No private source
has been exported to another organization.
