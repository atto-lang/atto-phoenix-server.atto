import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveViewSession} from '../reference/liveview-core.mjs';

const origin='https://example.test';
const transport=Object.freeze({connectionId:'conn',user:'alice',origin});
const other=Object.freeze({connectionId:'observer',user:'alice',origin});
const join={v:1,type:'join',session_id:'session',csrf:'valid-token-12345678',resume_rev:-1};
const event=(event_id='12345678',base_rev=0)=>({v:1,type:'event',event_id,name:'increment',payload:{},base_rev});
const render=s=>[{tag:'span',id:'count',text:String(s.count)}];
function make({reduce=(s)=>({count:s.count+1}),renderFn=render,authorize=()=>true}={}) {
  return new LiveViewSession({viewId:'counter',sessionId:'session',csrfToken:'valid-token-12345678',rootId:'root',origin,
    initialState:{count:0},render:renderFn,reduce,authorize});
}
function joined(session){session.attach('conn',()=>{});session.receive(join,transport);}

test('actor reducer cannot synchronously reenter its own session and overwrite committed revision',()=>{
  let session,inner=true;
  session=make({reduce:state=>{
    if(inner){inner=false;session.receive(event('abcdef12',0),transport);}
    return {count:state.count+1};
  }});
  joined(session);
  assert.throws(()=>session.receive(event(),transport),/reentrant session/i);
  assert.equal(session.revision,0);
  assert.equal(session.state.count,0);
  assert.equal(session.seen.size,0);
  inner=false;
  const [change,ack]=session.receive(event(),transport);
  assert.equal(session.revision,1);
  assert.equal(session.state.count,1);
  assert.equal(ack.rev,1);
  assert.equal(change.type,'patch');
});

test('render callback reentrancy fails closed without partial state or replay commit',()=>{
  let session,inner=true;
  session=make({renderFn:state=>{
    if(inner && state.count>0){inner=false;session.receive(event('abcdef12'),transport);}
    return render(state);
  }});
  joined(session);
  assert.throws(()=>session.receive(event(),transport),/reentrant session/i);
  assert.equal(session.revision,0);
  assert.equal(session.state.count,0);
  assert.equal(session.history.length,0);
  inner=false;
  assert.equal(session.receive(event(),transport)[1].rev,1);
});

test('authorization callback cannot recursively join before original transport admission finishes',()=>{
  let session,inner=true;
  session=make({authorize:()=>{
    if(inner)session.receive(join,transport);
    return true;
  }});
  session.attach('conn',()=>{});
  assert.throws(()=>session.receive(join,transport),/reentrant session/i);
  assert.equal(session.joined.size,0);
  inner=false;
  assert.deepEqual(session.receive(join,transport).map(x=>x.type),['snapshot','ready']);
});

test('subscriber callback cannot execute another actor event during broadcast',()=>{
  const session=make();
  session.attach('conn',()=>{});
  session.attach('observer',()=>session.receive(event('abcdef12',1),other));
  session.receive(join,transport);
  session.receive(join,other);
  assert.equal(session.receive(event(),transport)[1].rev,1);
  assert.equal(session.revision,1);
  assert.equal(session.state.count,1);
  assert.equal(session.seen.size,1);
  assert.equal(session.subscribers.has('observer'),false,'faulty synchronous subscriber detached');
});

test('outer operation unlocks after invalid frame and subsequent valid join/event succeeds',()=>{
  const session=make();
  session.attach('conn',()=>{});
  assert.throws(()=>session.receive({...join,csrf:'incorrect-token'},transport),/CSRF/);
  session.receive(join,transport);
  assert.equal(session.receive({...event(),base_rev:99},transport)[0].type,'event_rejected');
  assert.equal(session.receive(event(),transport)[1].rev,1);
});
