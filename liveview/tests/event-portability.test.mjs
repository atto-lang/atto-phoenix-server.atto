// Golden application-envelope vectors for Oreslang backend implementations.
// Host reference tests, never compiler/guest attestation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OresLiveView,validateEvent} from '../web/liveview.mjs';
import {LiveViewSession,eventCommandFingerprint,canonicalEventJson} from '../reference/liveview-core.mjs';

const fixture=JSON.parse(readFileSync(new URL('../fixtures/liveview-event-fingerprint-v1.json',import.meta.url)));
const origin='https://example.test';
const transport={connectionId:'socket-1',user:'alice',origin};
function actor() {return new LiveViewSession({viewId:'counter',sessionId:'session',csrfToken:'very-long-csrf-secret',origin,
  initialState:{count:0},render:s=>[{tag:'span',id:'value',text:String(s.count)}],
  reduce:s=>({count:s.count+1}),authorize:()=>true});}
function joined(s) {s.receive({v:1,type:'join',view_id:'counter',session_id:'session',csrf:'very-long-csrf-secret',resume_rev:-1},transport);}
function ev(event_id,payload,base_rev=0) {return {v:1,type:'event',name:'increment',event_id,payload,base_rev};}
function browser() {const root={ownerDocument:{location:{href:'https://example.test/page',origin}},
  getAttribute:k=>k==='data-ores-live-root'?'':k==='data-ores-view-id'?'counter':null,
  addEventListener(){},removeEventListener(){}};
  return new OresLiveView({root,url:'wss://example.test/live',sessionId:'session',csrfToken:'very-long-csrf-secret',randomUUID:()=> '12345678'});
}

test('golden fingerprints follow one precisely versioned backend-neutral encoding',()=>{
  assert.equal(fixture.schema,'ores-liveview-event-fingerprint-v1');
  assert.ok(fixture.cases.length>=6);
  for(const item of fixture.cases) {
    assert.equal(canonicalEventJson(item.payload),item.canonical_payload_json,item.id);
    assert.equal(eventCommandFingerprint(item.user,item.name,item.payload,item.base_rev),item.sha256,item.id);
  }
});
test('fingerprints ignore JSON object member order recursively, but preserve array order',()=>{
  const first={outer:{a:1,b:2},list:[{x:3,y:4},'🌐']};
  const second={list:[{y:4,x:3},'🌐'],outer:{b:2,a:1}};
  assert.equal(eventCommandFingerprint('alice','increment',first,0),eventCommandFingerprint('alice','increment',second,0));
  assert.notEqual(eventCommandFingerprint('alice','increment',first,0),
    eventCommandFingerprint('alice','increment',{list:['🌐',{x:3,y:4}],outer:{a:1,b:2}},0));
});
test('authenticated sender, event name and base revision each bind to fingerprint',()=>{
  const p={a:1};const id=eventCommandFingerprint('alice','increment',p,0);
  for(const different of [eventCommandFingerprint('bob','increment',p,0),
    eventCommandFingerprint('alice','decrement',p,0),eventCommandFingerprint('alice','increment',p,1)])
    assert.notEqual(different,id);
});
test('server dedup acknowledges semantically identical reordered payload, without mutation',()=>{
  const s=actor();joined(s);
  const eventId='abc12345';
  s.receive(ev(eventId,{left:1,right:{alpha:2,beta:3}}),transport);
  const replies=s.receive(ev(eventId,{right:{beta:3,alpha:2},left:1}),transport);
  assert.deepEqual(replies,[{v:1,type:'event_ack',event_id:eventId,rev:1}]);
  assert.equal(s.revision,1);assert.equal(s.state.count,1);
});
test('server rejects replay ID reuse with different array ordering and preserves committed state',()=>{
  const s=actor();joined(s);
  s.receive(ev('abc12345',{items:['a','b']}),transport);
  assert.throws(()=>s.receive(ev('abc12345',{items:['b','a']}),transport),/different command/);
  assert.equal(s.revision,1);assert.equal(s.state.count,1);
});
test('browser snapshots mutable event payload at dispatch before an eventual send',()=>{
  const client=browser();const payload={quantity:1,nested:{alpha:1},array:[1,2]};
  client.dispatch('increment',payload);
  payload.quantity=99;payload.nested.alpha=99;payload.array.push(3);
  assert.deepEqual(client.queue[0].payload,{quantity:1,nested:{alpha:1},array:[1,2]});
  client.close();
});
test('browser forbids non-JSON Date, class and accessor objects before queuing',()=>{
  const client=browser();const obj={};Object.defineProperty(obj,'name',{enumerable:true,get(){return 'dynamic';}});
  class Payload {constructor(){this.a=1;}}
  for(const value of [new Date('2020-01-01'),new Payload(),obj])
    assert.throws(()=>client.dispatch('increment',value),/non-JSON payload object|payload accessors/);
  assert.equal(client.queue.length,0);client.close();
});
test('JSON payload restrictions reject sparse arrays, unsafe integers and lone surrogates',()=>{
  for(const payload of [{items:new Array(2)},{count:9007199254740992},
    {bad:'\uD800'},{bad:'\uDC00'},{bad:'x\uD800z'}])
    assert.throws(()=>validateEvent('increment',payload),/ORES_LIVEVIEW_PROTOCOL/);
  assert.doesNotThrow(()=>validateEvent('increment',{emoji:'🌐',values:[1,2]}));
});
test('invalid mutable user payload cannot alter an already queued event',()=>{
  const client=browser();const payload={a:1};client.dispatch('increment',payload);
  payload.a=NaN;payload.b=()=>3;
  assert.deepEqual(client.queue[0].payload,{a:1});client.close();
});
