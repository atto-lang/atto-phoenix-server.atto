import test from 'node:test';
import assert from 'node:assert/strict';
import {applySnapshot,applyPatch,validateTree,validateWsUrl,validateEvent,OresLiveView} from '../web/liveview.mjs';
import {LiveViewSession,diffView} from '../reference/liveview-core.mjs';
const origin='https://example.test';
class Node {
  constructor(tag,doc,text='') {this.tagName=tag;this.ownerDocument=doc;this.parentNode=null;this.children=[];this.attributes={};this.textContent=text;this.id='';this.listeners={};}
  appendChild(child) {if(child.tagName==='#fragment') {for(const c of [...child.children]) this.appendChild(c);return child;}this.children.push(child);child.parentNode=this;return child;}
  replaceChildren(...children) {this.children=[];for(const child of children)this.appendChild(child);}
  setAttribute(k,v){this.attributes[k]=v;if(k==='id')this.id=v;}
  removeAttribute(k){delete this.attributes[k];}
  getAttribute(k){return Object.hasOwn(this.attributes,k)?this.attributes[k]:null;}
  contains(node){return node===this || this.children.some(c=>c.contains(node));}
  addEventListener(k,fn){this.listeners[k]=fn;}
  removeEventListener(k){delete this.listeners[k];}
}
class Doc {
  constructor(){this.location={href:'https://example.test/demo',origin};this.roots=[];}
  createElement(tag){return new Node(tag,this);}
  createDocumentFragment(){return new Node('#fragment',this);}
  createTextNode(value){return new Node('#text',this,value);}
  getElementById(id){function walk(n){if(n.id===id)return n;for(const c of n.children){const hit=walk(c);if(hit)return hit;}return null;}for(const r of this.roots){const hit=walk(r);if(hit)return hit;}return null;}
}
function makeRoot(){const doc=new Doc();const root=doc.createElement('main');root.id='root';root.setAttribute('data-ores-live-root','');root.setAttribute('data-ores-view-id','counter');doc.roots=[root];return root;}
const initial=[{tag:'div',id:'counter',children:[{tag:'span',id:'value',text:'0'},{tag:'button',id:'increment',attrs:{'data-ores-click':'increment'},text:'+'}]}];
function session(){return new LiveViewSession({viewId:'counter',sessionId:'s1',csrfToken:'secure-token-123456',rootId:'root',origin,initialState:{count:0},render:s=>[{tag:'div',id:'counter',children:[{tag:'span',id:'value',text:String(s.count)},{tag:'button',id:'increment',attrs:{'data-ores-click':'increment'},text:'+'}]}],reduce:(s,name)=>{if(name!=='increment')throw new Error('unknown event');return {count:s.count+1};},authorize:(transport)=>transport.user==='alice' && transport.origin===origin});}
const transport={user:'alice',origin,connectionId:'socket-1'};
const join=(resume_rev=-1,csrf='secure-token-123456')=>({v:1,type:'join',view_id:'counter',session_id:'s1',csrf,client_id:'client-1',resume_rev});
const event=(event_id='11111111-1111-4111-8111-111111111111',base_rev=0)=>({v:1,type:'event',event_id,name:'increment',payload:{},base_rev});
test('safe typed DOM snapshot and text-only patch',()=>{const root=makeRoot();applySnapshot(root,initial,origin);assert.equal(root.ownerDocument.getElementById('value').textContent,'0');applyPatch(root,[{op:'set_text',id:'value',text:'42'}],origin);assert.equal(root.ownerDocument.getElementById('value').textContent,'42');});
test('reject script tags, handlers, javascript URLs, iframe and duplicate identities',()=>{for(const tree of [[{tag:'script',id:'evil',text:'x'}],[{tag:'a',id:'link',attrs:{href:'javascript:alert(1)'}}],[{tag:'div',id:'d',attrs:{onclick:'alert(1)'}}],[{tag:'iframe',id:'evil'}],[{tag:'div',id:'dup'},{tag:'p',id:'dup'}]]) assert.throws(()=>validateTree(tree,origin),/ORES_LIVEVIEW_PROTOCOL/);});
test('cannot patch outside root, change IDs, or attach event handler',()=>{const root=makeRoot();applySnapshot(root,initial,origin);const rogue=root.ownerDocument.createElement('div');rogue.id='outside';root.ownerDocument.roots.push(rogue);assert.throws(()=>applyPatch(root,[{op:'set_text',id:'outside',text:'x'}],origin),/outside/);assert.throws(()=>applyPatch(root,[{op:'set_attr',id:'value',name:'id',value:'new'}],origin),/identity/);assert.throws(()=>applyPatch(root,[{op:'set_attr',id:'value',name:'onload',value:'x'}],origin),/attribute/);});
test('patch validation is performed before DOM mutation',()=>{const root=makeRoot();applySnapshot(root,initial,origin);assert.throws(()=>applyPatch(root,[{op:'set_text',id:'value',text:'1'},{op:'set_text',id:'missing',text:'2'}],origin));assert.equal(root.ownerDocument.getElementById('value').textContent,'0');});
test('WebSocket requires same-origin host and TLS outside loopback',()=>{const loc={href:'https://example.test/page'};assert.equal(validateWsUrl('wss://example.test/live',loc),'wss://example.test/live');for(const url of ['ws://example.test/live','wss://evil.test/live','https://example.test/live','wss://u:p@example.test/live'])assert.throws(()=>validateWsUrl(url,loc));assert.equal(validateWsUrl('ws://localhost:80/live',{href:'http://localhost/live'}),'ws://localhost/live');});
test('invalid event names, prototype keys, deep payloads rejected',()=>{assert.throws(()=>validateEvent('DoIt',{}));assert.throws(()=>validateEvent('increment',JSON.parse('{"__proto__":"malicious"}')));assert.throws(()=>validateEvent('increment',{x:'x'.repeat(9000)}));});
test('server authenticates join with token and transport identity',()=>{const live=session();assert.throws(()=>live.receive(join(-1,'wrong-token-123456'),transport),/CSRF/);assert.throws(()=>live.receive(join(),{origin,user:'bob',connectionId:'socket-bad'}),/unauthorized/);const frames=live.receive(join(),transport);assert.deepEqual(frames.map(f=>f.type),['snapshot','ready']);});
test('session commits serially, returns revisioned patches and deduplicates replays',()=>{const live=session();live.receive(join(),transport);const frames=live.receive(event(),transport);assert.deepEqual(frames.map(f=>f.type),['patch','event_ack']);assert.equal(live.revision,1);assert.equal(frames[0].prev,0);assert.equal(frames[0].rev,1);assert.deepEqual(frames[0].ops,[{op:'set_text',id:'value',text:'1'}]);const dup=live.receive(event(),transport);assert.equal(dup.length,1);assert.equal(dup[0].type,'event_ack');assert.equal(live.state.count,1);});
test('stale event rejected and reconnect replays missed diffs',()=>{const live=session();live.receive(join(),transport);live.receive(event(),transport);const stale=live.receive(event('22222222-2222-4222-8222-222222222222',0),transport);assert.equal(stale[0].type,'event_rejected');assert.equal(stale[0].code,'stale_revision');assert.equal(live.revision,1);assert.deepEqual(live.receive(join(0),transport).map(f=>f.type),['patch','ready']);assert.deepEqual(live.receive(join(1),transport).map(f=>f.type),['ready']);});
test('snapshot fallback when history too old',()=>{const live=session();live.maxHistory=1;live.receive(join(),transport);live.receive(event(),transport);live.receive(event('22222222-2222-4222-8222-222222222222',1),transport);assert.deepEqual(live.receive(join(0),transport).map(f=>f.type),['snapshot','ready']);});
test('large render refused without changing state or revision',()=>{const live=new LiveViewSession({viewId:'v',sessionId:'s',csrfToken:'secure-token-123456',origin,initialState:{count:0},render:s=>[{tag:'div',id:'a',text:s.count?'x'.repeat(8193):'ok'}],reduce:()=>({count:1}),authorize:()=>true});live.receive({v:1,type:'join',view_id:'v',session_id:'s',csrf:'secure-token-123456',resume_rev:-1},transport);assert.throws(()=>live.receive({v:1,type:'event',event_id:'12345678',name:'increment',payload:{},base_rev:0},transport));assert.equal(live.revision,0);});
test('client sends first join then one in-flight event; ack unlocks next',()=>{
  const root=makeRoot();const sent=[];let socket;
  class Socket{constructor(url,protocol){this.url=url;this.protocol=protocol;this.readyState=0;this.listeners={};socket=this;}addEventListener(k,fn){this.listeners[k]=fn;}send(data){sent.push(JSON.parse(data));}close(){this.readyState=3;}emit(k,data){this.listeners[k]({data});}}
  const client=new OresLiveView({root,url:'wss://example.test/live',sessionId:'s1',csrfToken:'secure-token-123456',webSocket:Socket,randomUUID:(()=>{let n=0;return()=>`client-${++n}`;})()});
  client.start();assert.equal(socket.protocol,'ores-liveview-v1');socket.readyState=1;socket.emit('open');assert.equal(sent[0].resume_rev,-1);
  socket.emit('message',JSON.stringify({v:1,type:'snapshot',rev:0,children:initial}));socket.emit('message',JSON.stringify({v:1,type:'ready',rev:0}));
  client.dispatch('increment');client.dispatch('increment');assert.equal(sent.filter(m=>m.type==='event').length,1);
  const id=sent[1].event_id;
  socket.emit('message',JSON.stringify({v:1,type:'patch',prev:0,rev:1,ops:[{op:'set_text',id:'value',text:'1'}]}));
  socket.emit('message',JSON.stringify({v:1,type:'event_ack',event_id:id,rev:1}));
  assert.equal(sent.filter(m=>m.type==='event').length,2);assert.equal(sent[2].base_rev,1);
  client.close();
});
test('diff for changed keyed list generates bounded replace operation',()=>{const old=[{tag:'ul',id:'list',children:[{tag:'li',id:'first',text:'a'}]}];const next=[{tag:'ul',id:'list',children:[{tag:'li',id:'first',text:'a'},{tag:'li',id:'second',text:'b'}]}];assert.deepEqual(diffView(old,next),[{op:'replace_children',id:'list',children:next[0].children}]);});
import {encodeHtmxSnapshot,encodeHtmxPatch,parseHtmxWsForm} from '../reference/htmx-bridge.mjs';
test('HTMX OOB HTML encoding escapes untrusted content and attributes',()=>{const html=encodeHtmxSnapshot('root',[{tag:'div',id:'message',attrs:{title:'" onclick="evil'},text:'<img src=x onerror=alert(1)>&'}],origin);assert.match(html,/&lt;img/);assert.match(html,/&quot; onclick=&quot;evil/);assert.ok(!html.includes('<img src=x'));assert.match(html,/hx-swap-oob="innerHTML"/);});
test('HTMX patch only supports safe text or child replacement',()=>{const html=encodeHtmxPatch([{op:'set_text',id:'value',text:'<script>x</script>'}],origin);assert.match(html,/&lt;script&gt;/);assert.equal(encodeHtmxPatch([{op:'set_attr',id:'value',name:'class',value:'red'}],origin),null);});
test('HTMX input enforces explicit replay key, CSRF, and ignores spoofed HX headers',()=>{const frame=parseHtmxWsForm(JSON.stringify({event:'increment',event_id:'aabbccdd-1234',base_rev:1,csrf:'secure-token-123456',HEADERS:{'HX-Request':'true'},counter:'1'}));assert.deepEqual(Object.entries(frame.payload),[['counter','1']]);assert.throws(()=>parseHtmxWsForm(JSON.stringify({event:'increment',base_rev:1,csrf:'secure-token-123456'})));});
test('server requires join before events on each socket connection',()=>{const live=session();assert.throws(()=>live.receive(event(),transport),/join required/);live.receive(join(),transport);live.detach('socket-1');assert.throws(()=>live.receive(event(),transport),/join required/);});
test('invalid structural patch with ancestor and child targets does not partially mutate DOM',()=>{const root=makeRoot();applySnapshot(root,initial,origin);assert.throws(()=>applyPatch(root,[{op:'replace_children',id:'counter',children:[{tag:'span',id:'new_value',text:'a'}]},{op:'set_text',id:'value',text:'broken'}],origin),/overlapping/);assert.equal(root.ownerDocument.getElementById('value').textContent,'0');});
test('reject duplicate IDs across view root and separate DOM roots',()=>{const root=makeRoot();assert.throws(()=>applySnapshot(root,[{tag:'div',id:'root',text:'dup'}],origin));const other=root.ownerDocument.createElement('div');other.id='collision';root.ownerDocument.roots.push(other);assert.throws(()=>applySnapshot(root,[{tag:'p',id:'collision',text:'not allowed'}],origin),/outside view/);});
test('HTMX void element serialization does not generate invalid closing tags',()=>{const html=encodeHtmxSnapshot('root',[{tag:'input',id:'query',attrs:{type:'text',value:'abc'}}],origin);assert.match(html,/<input/);assert.ok(!html.includes('</input>'));});
test('host protocol round trip across 100 sequential events and DOM diffs',()=>{
  const root=makeRoot();const live=session();
  const [snap]=live.receive(join(),transport);applySnapshot(root,snap.children,origin);
  for(let i=0;i<100;i++){
    const frames=live.receive(event((i+1).toString(16).padStart(8,'0')+'-0000-4000-8000-000000000000',i),transport);
    assert.equal(frames[0].type,'patch');
    assert.equal(frames[0].prev,i);applyPatch(root,frames[0].ops,origin);
    assert.equal(root.ownerDocument.getElementById('value').textContent,String(i+1));
    assert.equal(frames[1].rev,i+1);
  }
  assert.equal(live.revision,100);
});
test('attempting to replace children with another target ID fails before mutation',()=>{
  const root=makeRoot();applySnapshot(root,initial,origin);
  assert.throws(()=>applyPatch(root,[{op:'replace_children',id:'value',children:[{tag:'span',id:'increment',text:'collision'}]}],origin),/duplicate ID/);
  assert.equal(root.ownerDocument.getElementById('value').textContent,'0');
});
test('reject duplicate new IDs across sibling replacement operations',()=>{
  const root=makeRoot();applySnapshot(root,[{tag:'div',id:'left'},{tag:'div',id:'right'}],origin);
  assert.throws(()=>applyPatch(root,[
    {op:'replace_children',id:'left',children:[{tag:'span',id:'collision',text:'a'}]},
    {op:'replace_children',id:'right',children:[{tag:'span',id:'collision',text:'b'}]}
  ],origin),/duplicate ID/);
  assert.equal(root.ownerDocument.getElementById('collision'),null);
});
test('deny URL credentials even for same-origin asset paths',()=>{
  assert.throws(()=>validateTree([{tag:'img',id:'photo',attrs:{src:'https://u:p@example.test/private'}}],origin),/credentials/);
  assert.throws(()=>validateTree([{tag:'form',id:'formx',attrs:{action:'https://u:p@example.test/post'}}],origin),/credentials/);
});
test('host refuses invalid event acknowledgement revisions',()=>{
  const root=makeRoot();const sockets=[];
  class Socket{constructor(){this.readyState=0;this.listeners={};sockets.push(this);}addEventListener(k,cb){this.listeners[k]=cb;}send(){}close(){}emit(k,data){this.listeners[k]({data});}}
  const client=new OresLiveView({root,url:'wss://example.test/live',sessionId:'s1',csrfToken:'secure-token-123456',webSocket:Socket,randomUUID:()=> 'deadbeef-dead-beef-8888-deadbeefdead'});
  client.start();sockets[0].readyState=1;sockets[0].emit('open');
  sockets[0].emit('message',JSON.stringify({v:1,type:'snapshot',rev:0,children:initial}));
  sockets[0].emit('message',JSON.stringify({v:1,type:'ready',rev:0}));
  client.dispatch('increment');
  sockets[0].emit('message',JSON.stringify({v:1,type:'event_ack',event_id:'deadbeef-dead-beef-8888-deadbeefdead',rev:2}));
  assert.equal(client.ready,false);client.close();
});
