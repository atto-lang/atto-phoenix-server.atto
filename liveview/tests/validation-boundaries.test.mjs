// Atomic DOM application and browser protocol failure boundaries; host-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {applySnapshot,applyPatch,OresLiveView} from '../web/liveview.mjs';
import {LiveViewSession} from '../reference/liveview-core.mjs';
const origin='https://example.test';
class Node {
  constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.parentNode=null;this.attrs={};this.id='';this.textContent='';this.listeners={};}
  getAttribute(k){return Object.hasOwn(this.attrs,k)?this.attrs[k]:null;}
  setAttribute(k,v){this.attrs[k]=v;if(k==='id')this.id=v;}
  removeAttribute(k){delete this.attrs[k];}
  addEventListener(k,fn){this.listeners[k]=fn;}
  removeEventListener(k){delete this.listeners[k];}
  contains(n){return n===this||this.children.some(c=>c.contains(n));}
  appendChild(n){if(n.tagName==='#fragment'){for(const c of [...n.children])this.appendChild(c);return;}
    n.parentNode=this;this.children.push(n);}
  replaceChildren(...nodes){this.children=[];this.textContent='';for(const n of nodes)this.appendChild(n);}
}
function dom(){const doc={location:{href:'https://example.test/page',origin},roots:[],createElement(tag){return new Node(tag,this);},
    createTextNode(text){const n=new Node('#text',this);n.textContent=text;return n;},
    createDocumentFragment(){return new Node('#fragment',this);},
    getElementById(id){function search(n){if(n.id===id)return n;for(const c of n.children){const r=search(c);if(r)return r;}return null;}
      for(const n of this.roots){const r=search(n);if(r)return r;}return null;}};
  const root=new Node('main',doc);root.id='root';root.setAttribute('data-ores-live-root','');root.setAttribute('data-ores-view-id','counter');
  doc.roots=[root];return root;}
const tree=[{tag:'section',id:'panel',children:[{tag:'span',id:'value',text:'0'},{tag:'p',id:'description',text:'hello'}]}];
test('duplicate set_text on the same DOM identity fails without partial mutation',()=>{
  const root=dom();applySnapshot(root,tree,origin);
  assert.throws(()=>applyPatch(root,[{op:'set_text',id:'value',text:'1'},{op:'set_text',id:'value',text:'2'}],origin),/duplicate patch mutation/);
  assert.equal(root.ownerDocument.getElementById('value').textContent,'0');
});
test('conflicting set_attr and remove_attr on one key fails atomically',()=>{
  const root=dom();applySnapshot(root,tree,origin);
  assert.throws(()=>applyPatch(root,[{op:'set_attr',id:'panel',name:'class',value:'danger'},
    {op:'remove_attr',id:'panel',name:'class'}],origin),/duplicate patch mutation/);
  assert.equal(root.ownerDocument.getElementById('panel').getAttribute('class'),null);
});
test('duplicate replacement operations at a single target fail without replacement',()=>{
  const root=dom();applySnapshot(root,tree,origin);
  assert.throws(()=>applyPatch(root,[{op:'replace_children',id:'panel',children:[{tag:'span',id:'new_first'}]},
    {op:'replace_children',id:'panel',children:[{tag:'span',id:'new_second'}]}],origin),/duplicate patch mutation/);
  assert.equal(root.ownerDocument.getElementById('value').textContent,'0');
});
test('different attribute changes on one element remain supported',()=>{
  const root=dom();applySnapshot(root,tree,origin);
  applyPatch(root,[{op:'set_attr',id:'panel',name:'class',value:'ready'},
    {op:'set_attr',id:'panel',name:'title',value:'safe'}],origin);
  assert.equal(root.ownerDocument.getElementById('panel').getAttribute('class'),'ready');
  assert.equal(root.ownerDocument.getElementById('panel').getAttribute('title'),'safe');
});
test('client refuses malformed event IDs before adding them to its send queue',()=>{
  const root=dom();const client=new OresLiveView({root,url:'wss://example.test/live',sessionId:'session',
    csrfToken:'valid-token-12345678',randomUUID:()=> 'not valid!'});
  assert.throws(()=>client.dispatch('increment'),/invalid event ID/);assert.equal(client.queue.length,0);client.close();
});
test('client rejects event ID collision inside the bounded command queue',()=>{
  const root=dom();const client=new OresLiveView({root,url:'wss://example.test/live',sessionId:'session',
    csrfToken:'valid-token-12345678',randomUUID:()=> '12345678'});
  client.dispatch('increment');assert.throws(()=>client.dispatch('increment'),/duplicate queued event ID/);
  assert.equal(client.queue.length,1);client.close();
});
test('stale actor generation snapshot refuses DOM rollback and stops client',()=>{
  const root=dom();const errors=[];const client=new OresLiveView({root,url:'wss://example.test/live',sessionId:'session',
    csrfToken:'valid-token-12345678',randomUUID:()=> '12345678',onError:e=>errors.push(e)});
  applySnapshot(root,tree,origin);client.rev=10;
  assert.throws(()=>client._receive(JSON.stringify({v:1,type:'snapshot',rev:9,children:[]})),/revision rollback/);
  assert.equal(client.closed,true);assert.equal(client.rev,10);
  assert.equal(root.ownerDocument.getElementById('value').textContent,'0');
});
test('failed reducer and renderer do not commit state or notify peers',()=>{
  const events=[];const s=new LiveViewSession({viewId:'counter',sessionId:'session',csrfToken:'valid-token-12345678',origin,
    initialState:{count:0},render:s=>{if(s.count===2)throw Error('renderer failed');return [{tag:'span',id:'value',text:String(s.count)}];},
    reduce:(s,name)=>{if(name==='reject')throw Error('reducer failed');return {count:s.count+1};},authorize:()=>true});
  const one={connectionId:'one',user:'alice',origin},two={connectionId:'two',user:'alice',origin};
  const join={v:1,type:'join',view_id:'counter',session_id:'session',csrf:'valid-token-12345678',resume_rev:-1};
  s.attach('two',f=>events.push(f));s.receive(join,one);s.receive(join,two);
  const ev=(event_id,name,base_rev)=>({v:1,type:'event',event_id,name,payload:{},base_rev});
  assert.throws(()=>s.receive(ev('11111111','reject',0),one),/reducer failed/);
  assert.equal(s.state.count,0);assert.equal(events.length,0);
  s.receive(ev('22222222','increment',0),one);assert.equal(events.length,1);
  assert.throws(()=>s.receive(ev('33333333','increment',1),one),/renderer failed/);
  assert.equal(s.state.count,1);assert.equal(s.revision,1);assert.equal(events.length,1);
});
