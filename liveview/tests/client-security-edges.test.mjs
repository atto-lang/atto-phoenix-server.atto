// First-party browser boundary regressions. No external DOM or WS packages.
import test from 'node:test';
import assert from 'node:assert/strict';
import {OresLiveView,applySnapshot,applyPatch,validateWsUrl} from '../web/liveview.mjs';
import {LiveViewSession} from '../reference/liveview-core.mjs';
import {ClientFrameParser,encodeClientFrame,WireError} from '../reference/ws-wire.mjs';

const origin='https://example.test';
class El {
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.parentNode=null;this.children=[];this.attributes={};this.listeners={};this.id='';this.textContent='';}
  getAttribute(name){return Object.hasOwn(this.attributes,name)?this.attributes[name]:null;}
  setAttribute(name,v){this.attributes[name]=v;if(name==='id')this.id=v;}
  removeAttribute(name){delete this.attributes[name];}
  appendChild(n){if(n.tagName==='#FRAGMENT'){for(const c of [...n.children])this.appendChild(c);return;}this.children.push(n);n.parentNode=this;}
  replaceChildren(...children){this.children=[];for(const c of children)this.appendChild(c);}
  contains(n){return n===this||this.children.some(c=>c.contains(n));}
  addEventListener(name,cb){this.listeners[name]=cb;}
  removeEventListener(name){delete this.listeners[name];}
}
function root(){
  const doc={location:{origin,href:origin+'/counter'},roots:[],
    createElement(tag){return new El(tag,this);},createDocumentFragment(){return new El('#fragment',this);},
    createTextNode(text){const el=new El('#text',this);el.textContent=text;return el;},
    getElementById(id){const walk=n=>n.id===id?n:(n.children.map(walk).find(Boolean)||null);return this.roots.map(walk).find(Boolean)||null;}};
  const r=doc.createElement('main');r.id='root';r.setAttribute('data-ores-live-root','');r.setAttribute('data-ores-view-id','counter');doc.roots=[r];return r;
}
function browser({negotiated='ores-liveview-v1'}={}) {
  const r=root(),sent=[],errors=[];let socket;
  class FakeSocket {
    constructor(url,protocol){this.url=url;this.protocol=negotiated;this.offeredProtocol=protocol;this.readyState=0;this.events={};socket=this;}
    addEventListener(type,cb){this.events[type]=cb;}
    emit(type,data){this.events[type]?.({data});}
    send(s){sent.push(JSON.parse(s));}
    close(code){this.closeCode=code;this.readyState=3;}
  }
  let seq=0;
  const client=new OresLiveView({root:r,url:'wss://example.test/live',sessionId:'session',csrfToken:'valid-token-12345678',webSocket:FakeSocket,
    randomUUID:()=>String(++seq).padStart(8,'0'),onError:e=>errors.push(e.message)});
  client.start();socket.readyState=1;socket.emit('open');
  return {root:r,client,socket,sent,errors,
    deliver:x=>socket.emit('message',JSON.stringify(x)),
    prepare(){socket.emit('message',JSON.stringify({v:1,type:'snapshot',rev:0,children:[{tag:'span',id:'value',text:'0'}]}));socket.emit('message',JSON.stringify({v:1,type:'ready',rev:0}));}};
}
const ack=(id,rev)=>({v:1,type:'event_ack',event_id:id,rev});

test('deny secret-bearing WebSocket query strings even on same origin',()=>{
  for(const url of ['wss://example.test/live?csrf=secret','wss://example.test/live?session=abc','wss://example.test/live#token'])
    assert.throws(()=>validateWsUrl(url,{href:origin+'/counter'}),/credentials\/fragment\/query/);
  assert.equal(validateWsUrl('wss://example.test/live',{href:origin+'/counter'}),'wss://example.test/live');
});
test('correctly negotiated browser protocol sends authenticated join',()=>{
  const b=browser();assert.equal(b.socket.offeredProtocol,'ores-liveview-v1');
  assert.equal(b.sent[0].type,'join');assert.equal(b.sent[0].csrf,'valid-token-12345678');b.client.close();
});
for(const negotiated of ['', 'another-protocol']) test(`browser rejects unnegotiated protocol ${JSON.stringify(negotiated)}`,()=>{
  const b=browser({negotiated});assert.equal(b.sent.length,0);assert.equal(b.socket.closeCode,1002);
  assert.match(b.errors.join(' '),/subprotocol mismatch/);b.client.close();
});
test('unsolicited ACK cannot remove an unsent pending event',()=>{
  const b=browser();const id=b.client.dispatch('increment');assert.equal(b.client.queue.length,1);
  assert.throws(()=>b.client._receive(JSON.stringify(ack(id,1))),/invalid event acknowledgment revision/);
  assert.equal(b.client.queue[0].id,id);b.client.close();
});
test('ACK with unknown event ID cannot discard another queued command',()=>{
  const b=browser();b.prepare();b.client.dispatch('increment');
  assert.throws(()=>b.client._receive(JSON.stringify(ack('ffffffff',1))),/unrecognized event acknowledgment/);
  assert.equal(b.client.queue.length,1);b.client.close();
});
for(const revision of [0,-1]) test(`ACK with noncommitting revision ${revision} cannot acknowledge event`,()=>{
  const b=browser();b.prepare();const id=b.client.dispatch('increment');
  assert.throws(()=>b.client._receive(JSON.stringify(ack(id,revision))),/invalid event acknowledgment revision|invalid event ack/);
  assert.equal(b.client.queue.length,1);b.client.close();
});
test('legitimate ACK releases subsequent queued event with advanced base revision',()=>{
  const b=browser();b.prepare();const a=b.client.dispatch('increment');const c=b.client.dispatch('increment');
  assert.equal(b.sent.filter(f=>f.type==='event').length,1);
  b.deliver({v:1,type:'patch',prev:0,rev:1,ops:[{op:'set_text',id:'value',text:'1'}]});
  b.deliver(ack(a,1));
  const events=b.sent.filter(f=>f.type==='event');assert.equal(events.length,2);
  assert.equal(events[1].event_id,c);assert.equal(events[1].base_rev,1);b.client.close();
});
test('void element rejects set_text without mutating earlier valid operations',()=>{
  const r=root();applySnapshot(r,[{tag:'span',id:'status',text:'old'},{tag:'input',id:'field',attrs:{type:'text'}}],origin);
  assert.throws(()=>applyPatch(r,[{op:'set_text',id:'status',text:'new'},{op:'set_text',id:'field',text:'unsafe'}],origin),/void element/);
  assert.equal(r.ownerDocument.getElementById('status').textContent,'old');
});
test('void element rejects replace_children with no partial DOM mutation',()=>{
  const r=root();applySnapshot(r,[{tag:'input',id:'field',attrs:{type:'text'}},{tag:'span',id:'status',text:'old'}],origin);
  assert.throws(()=>applyPatch(r,[{op:'set_text',id:'status',text:'new'},{op:'replace_children',id:'field',children:[]}],origin),/void element/);
  assert.equal(r.ownerDocument.getElementById('status').textContent,'old');
});
test('void element still supports bounded safe attribute changes',()=>{
  const r=root();applySnapshot(r,[{tag:'input',id:'field',attrs:{type:'text'}}],origin);
  applyPatch(r,[{op:'set_attr',id:'field',name:'title',value:'allowed'}],origin);
  assert.equal(r.ownerDocument.getElementById('field').getAttribute('title'),'allowed');
});
test('valid coalesced masked frames are accepted even when feed exceeds incomplete frame limit',()=>{
  const parser=new ClientFrameParser({maxBuffer:1024,maxMessage:900});
  const many=Buffer.concat(Array.from({length:40},(_,i)=>encodeClientFrame(1,String(i).padStart(64,'x'))));
  assert.deepEqual(parser.feed(many).filter(f=>f.type==='text').length,40);
});
test('zero-length continuation frames consume fragment budget',()=>{
  const parser=new ClientFrameParser({maxFragments:2});
  parser.feed(encodeClientFrame(1,'a',{fin:false}));parser.feed(encodeClientFrame(0,'',{fin:false}));
  assert.throws(()=>parser.feed(encodeClientFrame(0,'b')),(err)=>err instanceof WireError&&err.closeCode===1009);
});
test('masked ping inserted between text fragments preserves UTF-8 message',()=>{
  const parser=new ClientFrameParser();
  assert.deepEqual(parser.feed(Buffer.concat([encodeClientFrame(1,Buffer.from([0xf0,0x9f]),{fin:false}),encodeClientFrame(9,'ping')])).map(x=>x.type),['ping']);
  const result=parser.feed(encodeClientFrame(0,Buffer.from([0x98,0x83])));
  assert.deepEqual(result.map(x=>x.data),['😃']);
});
test('replay dedup ledger never commits invalid event revision',()=>{
  const session=new LiveViewSession({viewId:'counter',sessionId:'session',csrfToken:'valid-token-12345678',origin,
    initialState:{n:0},render:s=>[{tag:'span',id:'value',text:String(s.n)}],reduce:s=>({n:s.n+1}),authorize:()=>true});
  const transport={user:'alice',origin,connectionId:'one'};
  session.receive({v:1,type:'join',session_id:'session',csrf:'valid-token-12345678',resume_rev:-1},transport);
  const event={v:1,type:'event',event_id:'11111111',name:'inc',payload:{},base_rev:1};
  const frames=session.receive(event,transport);assert.equal(frames[0].type,'event_rejected');
  assert.equal(session.state.n,0);assert.equal(session.seen.size,0);assert.equal(session.revision,0);
});
