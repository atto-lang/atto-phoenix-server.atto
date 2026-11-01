// Host-only adversarial transport tests; the exact native Oreslang runtime remains unverified.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {ClientFrameParser,WireError,encodeClientFrame} from '../reference/ws-wire.mjs';
import {LiveViewSession} from '../reference/liveview-core.mjs';
import {installReferenceGateway} from '../reference/ws-gateway.mjs';
import {OresLiveView} from '../web/liveview.mjs';
const ORIGIN='http://127.0.0.1:8080';
const t=(id='one',user='alice')=>({connectionId:id,user,origin:ORIGIN});
const id=n=>n.toString(16).padStart(8,'0')+'-cafe-4000-8000-000000000000';
const event=(n,base_rev,payload={})=>({v:1,type:'event',event_id:id(n),name:'inc',payload,base_rev});
const join=(resume_rev=-1)=>({v:1,type:'join',view_id:'counter',session_id:'session',csrf:'a-long-random-csrf-token',resume_rev});
const makeSession=()=>new LiveViewSession({viewId:'counter',sessionId:'session',csrfToken:'a-long-random-csrf-token',origin:ORIGIN,
  initialState:{count:0},render:s=>[{tag:'span',id:'counter-value',text:String(s.count)}],reduce:s=>({count:s.count+1}),
  authorize:tr=>tr.user==='alice'&&tr.origin===ORIGIN});
function wireCode(fn,code){assert.throws(fn,e=>e instanceof WireError&&e.closeCode===code);}

test('coalesced 4 large RFC6455 frames fit independent per-frame buffers',()=>{
  const payload='λ'.repeat(16000),parts=Array.from({length:4},()=>encodeClientFrame(1,payload));
  const parser=new ClientFrameParser();const out=parser.feed(Buffer.concat(parts));
  assert.equal(out.length,4);for(const x of out)assert.equal(x.data,payload);assert.equal(parser.pending.length,0);
});
test('coalesced control/data frames maintain original order',()=>{
  const parser=new ClientFrameParser();const out=parser.feed(Buffer.concat([
    encodeClientFrame(9,'A'),encodeClientFrame(1,'one'),encodeClientFrame(10,'B'),encodeClientFrame(1,'two')
  ]));
  assert.deepEqual(out.map(x=>x.type),['ping','text','pong','text']);
  assert.deepEqual(out.filter(x=>x.type==='text').map(x=>x.data),['one','two']);
});
test('per-feed frame admission is bounded independently of bytes',()=>{
  const parser=new ClientFrameParser({maxFramesPerFeed:4});
  wireCode(()=>parser.feed(Buffer.concat(Array.from({length:5},()=>encodeClientFrame(9,'x')))),1009);
});
test('incomplete single frame exceeding configured buffer budget is rejected',()=>{
  const parser=new ClientFrameParser({maxMessage:128,maxBuffer:24});
  wireCode(()=>parser.feed(encodeClientFrame(1,'x'.repeat(32))),1009);
});
test('multiple coalesced client frames split across every byte boundary',()=>{
  const frames=Buffer.concat([encodeClientFrame(1,'first'),encodeClientFrame(1,'🌍'),encodeClientFrame(9,'ok')]);
  for(let split=1;split<frames.length;split++) {
    const parser=new ClientFrameParser(),out=[...parser.feed(frames.subarray(0,split)),...parser.feed(frames.subarray(split))];
    assert.deepEqual(out.map(x=>x.type),['text','text','ping']);
    assert.equal(out[1].data,'🌍');
  }
});
test('duplicate event ID is acknowledged only for the identical command',()=>{
  const s=makeSession();s.receive(join(),t());s.receive(event(1,0,{value:'same'}),t());
  assert.equal(s.receive(event(1,0,{value:'same'}),t())[0].type,'event_ack');
  assert.equal(s.revision,1);
  for(const changed of [event(1,0,{value:'different'}),event(1,1,{value:'same'}),{...event(1,0,{value:'same'}),name:'other'}]) {
    assert.throws(()=>s.receive(changed,t()),/event ID reused/);
    assert.equal(s.revision,1);
  }
});
test('event ID replay from another authenticated connection with same user stays idempotent',()=>{
  const s=makeSession();s.receive(join(),t());s.receive(event(1,0),t());s.receive(join(0),t('two'));
  const ack=s.receive(event(1,0),t('two'))[0];assert.equal(ack.type,'event_ack');assert.equal(ack.rev,1);
  assert.equal(s.state.count,1);
});
test('stale queued command is explicitly rejected, rather than endless resync',()=>{
  const s=makeSession();s.receive(join(),t());s.receive(event(1,0),t());
  const rejected=s.receive(event(2,0),t())[0];
  assert.deepEqual(rejected,{v:1,type:'event_rejected',event_id:id(2),code:'stale_revision',rev:1});
  assert.equal(s.revision,1);assert.equal(s.state.count,1);
  assert.equal(s.receive(event(3,1),t())[0].rev,2);
});

test('browser conflict consumes one stale command and allows following command after resync',()=>{
  const doc={location:{href:'https://example.test/live',origin:'https://example.test'},roots:[],createElement(tag){return new Node(tag,this);},
    createTextNode(v){const n=new Node('#text',this);n.textContent=v;return n;},
    createDocumentFragment(){return new Node('#fragment',this);},
    getElementById(id){function visit(n){if(n.id===id)return n;for(const c of n.children){const v=visit(c);if(v)return v;}return null;}
      for(const n of this.roots){const v=visit(n);if(v)return v;}return null;}};
  class Socket {
    constructor(url,protocol){this.protocol=protocol;this.readyState=0;this.handlers={};this.sent=[];Socket.current=this;}
    addEventListener(type,fn){this.handlers[type]=fn;}
    send(v){this.sent.push(JSON.parse(v));}
    emit(type,v){this.handlers[type]?.({data:v});}
    close(){this.readyState=3;}
  }
  class Node {
    constructor(tag,ownerDocument){this.tagName=tag;this.ownerDocument=ownerDocument;this.parentNode=null;this.children=[];this.attrs={};this.id='';this.textContent='';this.listeners={};}
    setAttribute(k,v){this.attrs[k]=v;if(k==='id')this.id=v;}
    getAttribute(k){return this.attrs[k]??null;}
    addEventListener(k,fn){this.listeners[k]=fn;}
    removeEventListener(k){delete this.listeners[k];}
    appendChild(n){if(n.tagName==='#fragment'){for(const child of [...n.children])this.appendChild(child);return;}n.parentNode=this;this.children.push(n);}
    replaceChildren(...nodes){this.children=[];for(const n of nodes)this.appendChild(n);}
    contains(n){return n===this||this.children.some(x=>x.contains(n));}
  }
  const root=new Node('main',doc);root.id='root';root.setAttribute('data-ores-live-root','');root.setAttribute('data-ores-view-id','counter');doc.roots=[root];
  let nextId=0;const errors=[];
  const client=new OresLiveView({root,url:'wss://example.test/live',sessionId:'session',csrfToken:'a-long-random-csrf-token',
    webSocket:Socket,randomUUID:()=>id(++nextId),onError:e=>errors.push(e.message)});
  const sendFromServer=frame=>Socket.current.emit('message',JSON.stringify(frame));
  client.start();Socket.current.readyState=1;Socket.current.emit('open');
  sendFromServer({v:1,type:'snapshot',rev:0,children:[{tag:'span',id:'value',text:'0'}]});sendFromServer({v:1,type:'ready',rev:0});
  client.dispatch('inc');client.dispatch('inc');
  const events=()=>Socket.current.sent.filter(x=>x.type==='event');
  assert.equal(events().length,1);
  sendFromServer({v:1,type:'event_rejected',event_id:events()[0].event_id,code:'stale_revision',rev:1});
  assert.equal(client.queue.length,1);assert.equal(client.ready,false);assert.match(errors[0],/stale/);
  assert.equal(Socket.current.sent.at(-1).type,'resync');
  sendFromServer({v:1,type:'snapshot',rev:1,children:[{tag:'span',id:'value',text:'1'}]});
  sendFromServer({v:1,type:'ready',rev:1});
  assert.equal(events().length,2);assert.equal(events()[1].base_rev,1);client.close();
});

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('real TCP: coalesced WebSocket JSON frames above parser buffer budget succeed',async()=>{
  const server=http.createServer((req,res)=>res.writeHead(404).end());
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const port=server.address().port,origin=`http://127.0.0.1:${port}`;
  const session=new LiveViewSession({viewId:'counter',sessionId:'session',csrfToken:'a-long-random-csrf-token',origin,
    initialState:{count:0},render:s=>[{tag:'span',id:'counter-value',text:String(s.count)}],reduce:s=>s,authorize:()=>true});
  const gateway=installReferenceGateway(server,{origins:new Set([origin]),hosts:new Set([`127.0.0.1:${port}`]),allowLoopbackCleartext:true,
    authenticate:()=>({id:'alice'}),getSession:()=>session,maxMessagesPerWindow:20});
  const socket=net.connect({host:'127.0.0.1',port});socket.setTimeout(2500,()=>socket.destroy());
  let buffer=Buffer.alloc(0);socket.on('data',x=>{buffer=Buffer.concat([buffer,x]);});
  try {
    await new Promise((res,rej)=>{socket.once('connect',res);socket.once('error',rej);});
    const request=['GET /live HTTP/1.1',`Host: 127.0.0.1:${port}`,'Upgrade: websocket','Connection: Upgrade',
      `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Protocol: ores-liveview-v1',`Origin: ${origin}`,'',''].join('\r\n');
    socket.write(request);
    for(let i=0;i<200&&!buffer.includes(Buffer.from('\r\n\r\n'));i++)await pause(4);
    const split=buffer.indexOf('\r\n\r\n');assert(split!==-1);assert.match(buffer.subarray(0,split).toString(),/101 Switching Protocols/);
    buffer=buffer.subarray(split+4);
    const padding='z'.repeat(19000);const body=JSON.stringify({...join(),pad:padding});
    const payload=Buffer.concat(Array.from({length:5},()=>encodeClientFrame(1,body)));
    assert(payload.length>65536+64);
    socket.write(payload);
    const decode=()=>{let pos=0,frames=[];while(buffer.length-pos>=2){const type=buffer[pos]&15,code=buffer[pos+1]&127;let len=code,head=2;
      if(code===126){if(buffer.length-pos<4)break;len=buffer.readUInt16BE(pos+2);head=4;}
      if(code===127){if(buffer.length-pos<10)break;len=Number(buffer.readBigUInt64BE(pos+2));head=10;}
      if(buffer.length-pos<head+len)break;
      if(type===1)frames.push(JSON.parse(buffer.subarray(pos+head,pos+head+len).toString()));
      if(type===8)throw Error('server unexpectedly closed WebSocket');pos+=head+len;}
      buffer=buffer.subarray(pos);return frames;};
    const frames=[];for(let i=0;i<300&&frames.length<10;i++){frames.push(...decode());await pause(4);}
    assert.equal(frames.length,10);assert.deepEqual(frames.map(x=>x.type),Array.from({length:5},()=>['snapshot','ready']).flat());
    assert.equal(gateway.connections,1);
  }finally{socket.destroy();gateway.close();await new Promise(r=>server.close(r));}
});
