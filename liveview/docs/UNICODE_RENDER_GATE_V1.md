# AttoLang LiveView: Unicode scalar-value render gate

**Security boundary:** compiled guest renderer -> actor state/revision -> wire -> browser DOM.

A JavaScript string can contain unpaired UTF-16 surrogates. `JSON.stringify`
escapes them, while DOM insertion / `TextEncoder` can replace them, and native
UTF-8 runtimes may reject the same values. This difference causes observable
cross-toolchain protocol drift. The host-reference `validateTree`, `applySnapshot`,
`applyPatch` and `validateAttr` now share a fail-closed scalar-value check via
`boundedString`. The check rejects lone high and low surrogates, including
those in nested children, URL attributes, and atomic patch operations. It
preserves valid high+low surrogate pairs representing supplementary characters.

## Executable reference regressions

- `tests/render-unicode-e2e.test.mjs`: real HTTP/1.1 upgrade and masked RFC6455
  connections, two subscribers, failed malformed render with WebSocket 1008,
  no state/revision/replay commit, healthy subscriber resync, valid Unicode
  supplementary text/attribute round-trip, initial snapshot admission.
- `tests/unicode-dom-atomic.test.mjs`: the browser rejects malformed snapshot,
  attribute and nested patch payloads *before* any DOM write; valid Unicode
  remains admitted.
- `tests/five-toolchain-contract.test.mjs`: no backend can submit even a
  structurally complete guest receipt without `render_unicode_e2e: true`;
  `rendered_unicode_scalar_values_only` may not be disabled. These are
  structural assertions, **not verified runner provenance**.

## Native backend acceptance

The same app-level Unicode contract applies to Java/GraalVM, LLVM, Wasm,
Forge/Cranelift and .NET Native AOT. Each backend must test malformed JSON
surrogate escapes and guest-generated invalid strings, atomic render failure,
unchanged actor revision and replay state, subscriber isolation, plus valid
supplementary Unicode. For browser/worker Wasm use the permitted host adapter.
These tests must execute against *actual compiled `.atto` guest code* to
satisfy backend parity. Passing Node host-reference tests is not sufficient.

No source export to an alternate GitHub organization is authorized while
conformance security incident #22 and branch-protection issue #170 remain open.
