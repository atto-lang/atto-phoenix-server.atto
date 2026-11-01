// Cross-backend transport oracle: closing a WebSocket connection is terminal.
// These tests execute the host reference. They are not Oreslang guest evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ClientFrameParser, encodeClientFrame, WireError } from '../reference/ws-wire.mjs';
import { LiveViewSession } from '../reference/liveview-core.mjs';

const close=()=>encodeClientFrame(8, Buffer.from([0x03,0xe8]));
const data=()=>encodeClientFrame(1, '{"v":1,"type":"event"}');
const ping=()=>encodeClientFrame(9, 'hb');
const bad=e=>e instanceof WireError;

test('close frame followed by text frame in same read is terminal', () => {
  const parser = new ClientFrameParser();
  assert.throws(() => parser.feed(Buffer.concat([close(), data()])), bad);
});
test('close frame followed by ping frame in same read is terminal', () => {
  const parser = new ClientFrameParser();
  assert.throws(() => parser.feed(Buffer.concat([close(), ping()])), bad);
});
test('close frame followed by arbitrary trailing bytes is terminal', () => {
  const parser = new ClientFrameParser();
  assert.throws(() => parser.feed(Buffer.concat([close(), Buffer.from([0])])), bad);
});
test('standalone close is terminal across TCP reads', () => {
  const parser = new ClientFrameParser();
  assert.deepEqual(parser.feed(close()).map(x => x.type), ['close']);
  assert.throws(() => parser.feed(data()), bad);
});
test('close after completed messages is accepted without trailing application bytes', () => {
  const parser = new ClientFrameParser();
  assert.deepEqual(parser.feed(Buffer.concat([data(), close()])).map(x => x.type), ['text','close']);
});
test('empty input after close cannot re-open parser', () => {
  const parser = new ClientFrameParser();
  parser.feed(close());
  assert.throws(() => parser.feed(Buffer.alloc(0)), bad);
});
const session=()=>new LiveViewSession({
  viewId:'counter',sessionId:'session',csrfToken:'long-csrf-token-1234',origin:'http://127.0.0.1',
  initialState:{value:0},render:s=>[{tag:'span',id:'val',text:String(s.value)}],
  reduce:s=>({value:s.value+1}),authorize:()=>true
});
const transport={connectionId:'conn',user:'alice',origin:'http://127.0.0.1'};
const joined={v:1,type:'join',view_id:'counter',session_id:'session',csrf:'long-csrf-token-1234',resume_rev:-1};

test('stale event rejection does not mutate actor state or revision', () => {
  const s=session();s.attach('conn',()=>{});s.receive(joined,transport);
  const response=s.receive({v:1,type:'event',event_id:'12345678',name:'increment',payload:{},base_rev:99},transport);
  assert.equal(response[0].type,'event_rejected');
  assert.equal(s.revision,0);assert.deepEqual(s.state,{value:0});
});
test('join must authenticate origin and CSRF before subscribing', () => {
  const s=session();s.attach('conn',()=>{});
  assert.throws(()=>s.receive({...joined,csrf:'x'.repeat(20)},transport),/CSRF/);
  assert.equal(s.joined.size,0);
  assert.throws(()=>s.receive(joined,{...transport,origin:'https://evil.example'}),/origin/);
  assert.equal(s.joined.size,0);
});
test('state callbacks are never invoked after stale revision rejected',()=>{
  let calls=0;const s=new LiveViewSession({
    viewId:'counter',sessionId:'session',csrfToken:'long-csrf-token-1234',origin:'http://127.0.0.1',
    initialState:{value:0},render:x=>[{tag:'span',id:'val',text:String(x.value)}],
    reduce:x=>{calls++;return {value:x.value+1}},authorize:()=>true
  });s.attach('conn',()=>{});s.receive(joined,transport);
  s.receive({v:1,type:'event',event_id:'12345678',name:'increment',payload:{},base_rev:200},transport);
  assert.equal(calls,0);
});
