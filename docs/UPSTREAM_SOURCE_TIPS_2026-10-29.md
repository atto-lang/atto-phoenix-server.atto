# Upstream-source compatibility and demo acceptance — 2026-10-29

**Scope:** `ores-truffle-oreslang/oreslang-phoenix-server.ores`. This is an audit and release-gate checklist, **not proof of native guest execution**.

## Verified inventory (default branch, 2026-10-29)

README-only bootstrap: no .ores guest, listener, test runner, or HTTP response evidence.

## Source-repository guidance

- The Java source README on `main` (inspected commit `9f4f4a3b75dd4b124e8509b65a88a98213c11ab5`) explicitly prohibits Python tooling across the organization. Use Rust for new/ported tooling; retaining an existing Python implementation is not compliance.
- Use actor isolation, sealed state, capability-limited host I/O, immutable/sendable mailbox values, bounded admission and deterministic close/drain semantics. Treat source-branch proposals as **unmerged** unless an exact compiler revision and real execution prove them.
- Keep methods/functions in `snake_case`; use public `rt borrow`, `rt take`, `rt copy`, and `rt share` ownership forms where admitted. Do not assume that every backend has the same implemented feature set.
- Distinguish Java/GraalVM, LLVM, WASM, .NET and Forge with separately pinned compiler/runtime evidence. Native features cannot be marked portable based on a Java-only run.
- Any external/private Actions carrier requires explicit source-transfer authorization, exact source Git-tree/blob verification, no cross-organization secret reuse, and recorded runner steps. A zero-step run means `NOT_EXECUTED`.

## This repository's next executable gate

Implement minimal GET /hello and POST /echo actors with bounded request ownership; exercise shutdown, 404/405, and capability-denied cases using real native execution.

**Related contracts:** oreslang-spin, oreslang-rpc and Java reference runtime; no Phoenix/BEAM compatibility claim.

## Acceptance requirements

1. Record an immutable 40-hex source commit for each compiler/backend actually invoked, including toolchain build provenance and executable SHA-256. Never silently repin a demo because an upstream feature PR opened.
2. Verify source syntax with the **real compiler**, run every admitted guest under resource/time bounds, and compare stdout/stderr/exit or protocol bytes to an explicit oracle.
3. Run negative cases for capability denial, malformed input, cancellation, actor close/drain and bounded allocation. Compile-only and simulated-host tests remain separate statuses.
4. Capture checked-out demo commit and Git tree, compiler identity, runner ID, nonempty step log, exact test counts and failure traces before claiming an executed pass.
5. Require independent review and branch-protected, latest-head checks for promotion. Structural hygiene may pass while the demo remains `NOT_EXECUTED`.

The `upstream-source-hygiene.yml` workflow only enforces a **structural** no-new-Python gate and prints evidence classification. It cannot prove compiler/runtime behavior.
