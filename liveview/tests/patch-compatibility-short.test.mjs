import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveViewSession,diffView} from '../reference/liveview-core.mjs';
const node=(id,children=[],attrs={})=>({tag:'div',id,children,attrs});
const text=(id,value)=>({tag:'span',id,text:value});
function run(before,after){
  const s=new LiveViewSession({viewId:'counter',sessionId:'session',csrfToken:'valid-token-12345678',origin:'https://example.test',initialState:0,
    render:v=>structuredClone(v===0?before:after),reduce:()=>1,authorize:()=>true});
  const transport={connectionId:'owner',origin:'https://example.test',user:'alice'};
  s.receive({v:1,type:'join',view_id:'counter',session_id:'session',csrf:'valid-token-12345678',resume_rev:-1},transport);
  const frames=s.receive({v:1,type:'event',event_id:'12345678',name:'advance',payload:{},base_rev:0},transport);
  return {s,frames};
}
test('cross-parent keyed-node move uses snapshot instead of invalid patch',()=>{
  const old=[node('left',[text('moved','x')]),node('right')];
  const next=[node('left'),node('right',[text('moved','x')])];
  assert.equal(diffView(old,next).length,2);
  const {frames,s}=run(old,next);
  assert.deepEqual(frames.map(f=>f.type),['snapshot','event_ack']);
  assert.equal(s.history.length,0);
});
test('mixed same-target attribute and structural mutation uses snapshot',()=>{
  const old=[node('panel',[text('child','a')],{class:'old'})];
  const next=[node('panel',[text('child','a'),text('newchild','b')],{class:'new'})];
  assert.deepEqual(diffView(old,next).map(op=>op.op),['set_attr','replace_children']);
  assert.equal(run(old,next).frames[0].type,'snapshot');
});
test('valid independent sibling replacement patches remain incremental',()=>{
  const old=[node('left'),node('right')];
  const next=[node('left',[text('newleft','a')]),node('right',[text('newright','b')])];
  assert.deepEqual(run(old,next).frames[0].ops.map(op=>op.op),['replace_children','replace_children']);
});
test('entire root replacement can safely move existing identity',()=>{
  const old=[node('panel',[text('moving','a')])];
  const next=[node('panel'),text('moving','a')];
  assert.equal(run(old,next).frames[0].type,'patch');
});
test('snapshot fallback cannot replay client-invalid patch history',()=>{
  const old=[node('left',[text('moving','a')]),node('right')];
  const next=[node('left'),node('right',[text('moving','a')])];
  const {s}=run(old,next);
  const frames=s.receive({v:1,type:'join',view_id:'counter',session_id:'session',csrf:'valid-token-12345678',resume_rev:0},
    {connectionId:'rejoining',origin:'https://example.test',user:'alice'});
  assert.deepEqual(frames.map(f=>f.type),['snapshot','ready']);
});
