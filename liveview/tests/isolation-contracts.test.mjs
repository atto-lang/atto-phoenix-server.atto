// Host-only regression tests: a reference LiveView actor must not expose
// mutable state/history/patch objects to renderers or client subscribers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveViewSession} from '../reference/liveview-core.mjs';
const origin='https://example.test';
const t=id=>({connectionId:id,user:'alice',origin});
const join=(resume_rev=-1)=>({v:1,type:'join',view_id:'counter',session_id:'session',csrf:'very-long-csrf-secret',resume_rev});
const event=(i,base_rev)=>({v:1,type:'event',event_id:i.toString(16).padStart(8,'0'),name:'increment',payload:{},base_rev});
const tree=count=>[{tag:'span',id:'value',text:String(count)}];
const make=(custom={})=>new LiveViewSession({viewId:'counter',sessionId:'session',csrfToken:'very-long-csrf-secret',origin,initialState:{count:0},render:s=>tree(s.count),reduce:s=>({count:s.count+1}),authorize:()=>true,...custom});

test('constructor copies the caller-owned initial state',()=>{
  const input={count:0},s=make({initialState:input});input.count=500;
  assert.equal(s.state.count,0);assert.equal(s.receive(join(),t('a'))[0].children[0].text,'0');
});
test('constructor copies the renderer-owned initial tree',()=>{
  const cached=tree(0),s=make({render:()=>cached});cached[0].text='attacker changed cached tree';
  assert.equal(s.receive(join(),t('a'))[0].children[0].text,'0');
});
test('committed revision copies the renderer-owned replacement tree',()=>{
  let cached;const s=make({render:v=>(cached=tree(v.count))});
  s.receive(join(),t('a'));s.receive(event(1,0),t('a'));
  cached[0].text='tampered after commit';
  assert.equal(s.receive(join(),t('b'))[0].children[0].text,'1');
});
test('a hostile subscriber cannot mutate another subscriber patch',()=>{
  const s=make(),received=[];s.attach('evil',f=>{f.ops[0].text='owned';});s.attach('good',f=>received.push(f));
  for(const id of ['a','evil','good'])s.receive(join(),t(id));
  s.receive(event(1,0),t('a'));
  assert.equal(received.length,1);assert.equal(received[0].ops[0].text,'1');
});
test('a hostile subscriber cannot corrupt replay history',()=>{
  const s=make();s.attach('evil',f=>{f.ops[0].text='owned';});
  s.receive(join(),t('a'));s.receive(join(),t('evil'));
  s.receive(event(1,0),t('a'));
  const replay=s.receive(join(0),t('b'));
  assert.equal(replay[0].ops[0].text,'1');assert.equal(replay[0].rev,1);
});
test('mutating a returned patch cannot poison future replay',()=>{
  const s=make();s.receive(join(),t('a'));
  const response=s.receive(event(1,0),t('a'));
  response[0].ops[0].text='owned';
  assert.equal(s.receive(join(0),t('b'))[0].ops[0].text,'1');
});
test('mutating replay output cannot poison another reconnect',()=>{
  const s=make();s.receive(join(),t('a'));s.receive(event(1,0),t('a'));
  const first=s.receive(join(0),t('b'));first[0].ops[0].text='owned';
  assert.equal(s.receive(join(0),t('c'))[0].ops[0].text,'1');
});
test('a thrown subscriber callback is detached without suppressing healthy subscriber',()=>{
  const s=make(),received=[];s.attach('bad',()=>{throw Error('subscriber fault')});s.attach('good',f=>received.push(f));
  for(const id of ['a','bad','good'])s.receive(join(),t(id));s.receive(event(1,0),t('a'));
  assert.equal(s.subscribers.has('bad'),false);assert.equal(received.length,1);assert.equal(received[0].rev,1);
});
test('renderer failure after reducer input mutation rolls back state and revision',()=>{
  const s=make({reduce:v=>{v.count=99;return {count:99}},render:v=>{if(v.count===99)throw Error('renderer denied');return tree(v.count);}});
  s.receive(join(),t('a'));assert.throws(()=>s.receive(event(1,0),t('a')),/renderer denied/);
  assert.equal(s.state.count,0);assert.equal(s.revision,0);assert.equal(s.receive(join(),t('b'))[0].children[0].text,'0');
});
test('replay fingerprint binds event ID to authenticated user',()=>{
  const s=make();s.receive(join(),t('a'));s.receive(event(1,0),t('a'));
  s.receive(join(1),{connectionId:'b',user:'bob',origin});
  assert.throws(()=>s.receive(event(1,0),{connectionId:'b',user:'bob',origin}),/different command/);
  assert.equal(s.revision,1);
});
