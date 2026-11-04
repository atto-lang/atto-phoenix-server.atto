// Source-only checks intentionally do NOT count as compiler/native evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const source=readFileSync(new URL('../guest/counter_live.atto',import.meta.url),'utf8');
const admission=readFileSync(new URL('../guest/README.md',import.meta.url),'utf8');
test('CounterLive target has a typed actor and only sealed state access',()=>{
  assert.match(source,/define actor CounterLive as/);
  assert.match(source,/receive\(Increment message\) -> void ::/);
  assert.match(source,/handle_state\(critical-write/);
  assert.match(source,/handle_state\(critical-read/);
  assert.doesNotMatch(source,/\b(?:node|javascript|socket|WebSocket|HostObject|eval)\s*\(/);
});
test('CounterLive fixture cannot be mistaken for a compiled native LiveView app',()=>{
  assert.match(source,/TARGET PORTABILITY FIXTURE ONLY/);
  assert.match(admission,/NOT_COMPILED/);
  assert.match(admission,/NOT_EXECUTED/);
  assert.match(admission,/Java\/GraalVM, LLVM, Wasm host adapter,/);
});
