import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveViewSession} from '../reference/liveview-core.mjs';

const origin='https://example.test';
const csrf='valid-token-123456789';
const join={v:1,type:'join',session_id:'session',csrf,resume_rev:-1};
const t=id=>Object.freeze({connectionId:id,user:'alice',origin});
const event=id=>({v:1,type:'event',event_id:id,name:'increase',payload:{},base_rev:0});
const session=()=>new LiveViewSession({viewId:'counter',sessionId:'session',csrfToken:csrf,rootId:'root',origin,
  initialState:{n:0},render:s=>[{tag:'span',id:'value',text:String(s.n)}],reduce:s=>({n:s.n+1}),authorize:()=>true});

function setup() {
  const s=session();
  s.attach('sender',()=>{});
  s.receive(join,t('sender'));
  return s;
}

test('a subscriber attached inside another delivery cannot receive the in-flight revision',()=>{
  const s=setup();
  // Simulates a previously joined connection whose callback is attached mid-send.
  s.receive(join,t('late'));
  let lateDeliveries=0,firstDeliveries=0;
  s.attach('first',()=>{firstDeliveries++;s.attach('late',()=>{lateDeliveries++;});});
  s.receive(join,t('first'));
  s.receive(event('12345678'),t('sender'));
  assert.equal(firstDeliveries,1);
  assert.equal(lateDeliveries,0,'late listener must not receive prior in-flight revision');
  assert.equal(s.revision,1);
});

test('a throwing old send callback cannot detach a replacement connection generation',()=>{
  const s=setup();
  s.attach('observer',()=>{
    s.detach('observer');
    s.attach('observer',()=>{});
    throw Error('stale generation send error');
  });
  s.receive(join,t('observer'));
  s.receive(event('12345678'),t('sender'));
  assert.equal(s.subscribers.has('observer'),true,'newly attached successor must survive old callback failure');
  assert.equal(s.revision,1);
});

test('an unmodified joined observer still receives one update per committed revision',()=>{
  const s=setup();const revs=[];
  s.attach('observer',frame=>revs.push(frame.rev));
  s.receive(join,t('observer'));
  s.receive(event('12345678'),t('sender'));
  assert.deepEqual(revs,[1]);
});
