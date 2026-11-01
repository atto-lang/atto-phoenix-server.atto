// Explicitly test the *join* membership budget, independently of the
// WebSocket transport's attached-callback capacity.
import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveViewSession} from '../reference/liveview-core.mjs';

const origin='https://live.example';
const peer=id=>({connectionId:id,user:'alice',origin});
const join=(resume_rev=-1)=>({v:1,type:'join',session_id:'session',csrf:'secure-token-123456',resume_rev});
const create=(cap=2)=>new LiveViewSession({
  viewId:'counter',sessionId:'session',csrfToken:'secure-token-123456',
  rootId:'root',origin,initialState:{count:0},
  render:s=>[{tag:'span',id:'value',text:String(s.count)}],
  reduce:(s,name)=>({count:s.count+1}),
  authorize:t=>t.user==='alice'&&t.origin===origin,
  maxSubscribers:cap
});
test('unauthenticated direct connection IDs cannot grow joined beyond quota',()=>{
  const s=create(2);
  s.receive(join(),peer('one'));s.receive(join(),peer('two'));
  assert.equal(s.joined.size,2);
  for(let i=0;i<64;i++)assert.throws(()=>s.receive(join(),peer('ghost'+i)),/joined connection limit exceeded/);
  assert.deepEqual([...s.joined],['one','two']);
  assert.equal(s.revision,0);
});
test('rejoin of existing connection is idempotent even at capacity',()=>{
  const s=create(1);
  assert.deepEqual(s.receive(join(),peer('one')).map(f=>f.type),['snapshot','ready']);
  assert.deepEqual(s.receive(join(0),peer('one')).map(f=>f.type),['ready']);
  assert.equal(s.joined.size,1);
});
test('detach removes joined identity and releases the single budget',()=>{
  const s=create(1);
  s.receive(join(),peer('one'));s.detach('one');
  assert.equal(s.joined.size,0);
  assert.deepEqual(s.receive(join(),peer('two')).map(f=>f.type),['snapshot','ready']);
  assert.equal(s.joined.size,1);
});
test('rejected quota bypass cannot submit an event',()=>{
  const s=create(1);
  s.receive(join(),peer('one'));
  assert.throws(()=>s.receive(join(),peer('unjoined')),/joined connection limit exceeded/);
  assert.throws(()=>s.receive({v:1,type:'event',event_id:'aaaaaaaa',name:'increment',payload:{},base_rev:0},peer('unjoined')),/join required/);
  assert.equal(s.state.count,0);
});
