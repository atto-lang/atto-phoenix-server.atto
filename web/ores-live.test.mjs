import assert from 'node:assert/strict';
import {OresLiveClient, SUBPROTOCOL} from './ores-live.mjs';
class Element {
  constructor(doc, id = '') { this.ownerDocument = doc; this.id = id; this.children = []; this.parent = null; this._textContent = ''; this.attrs = new Map(); }
  set textContent(value) { this._textContent = value; for (const child of this.children) child.parent = null; this.children = []; }
  get textContent() { return this._textContent; }
  contains(node) { for (let p = node; p; p = p.parent) if (p === this) return true; return false; }
  setAttribute(k, v) { this.attrs.set(k, v); }
  getAttribute(k) { return this.attrs.get(k) ?? null; }
  appendChild(n) { n.parent = this; this.children.push(n); }
  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
}
class Document {
  constructor() { this.nodes = []; }
  createElement() { return new Element(this); }
  getElementById(id) { return this.nodes.find(n => n.id === id) ?? null; }
  named(id, parent) { const node = new Element(this, id); this.nodes.push(node); if (parent) parent.appendChild(node); return node; }
}
class Socket {
  constructor(protocol) { this.protocol = protocol; this.readyState = 0; this.bufferedAmount = 0; this.messages = []; this.closedCode = null; }
  open() { this.readyState = 1; this.onopen(); }
  send(raw) { this.messages.push(JSON.parse(raw)); }
  receive(frame) { this.onmessage({data: typeof frame === 'string' ? frame : JSON.stringify(frame)}); }
  close(code) { this.closedCode = code; this.readyState = 3; this.onclose?.(); }
}
const doc = new Document();
const root = doc.named('root');
const counter = doc.named('counter', root);
const list = doc.named('feed', root);
const outsider = doc.named('outside');
const sockets = [], timers = [], status = [];
const client = new OresLiveClient({url:'wss://app.example/live', baseUrl:'https://app.example/page',
  root, topic:'room:1', csrf:'0123456789abcdef', socketFactory:(url, p) => {
    assert.equal(url, 'wss://app.example/live'); const s = new Socket(p); sockets.push(s); return s;
  }, schedule:(fn,ms) => { timers.push({fn,ms}); return timers.length; }, cancel:()=>{},
  random:()=>0.25, onStatus:s=>status.push(s)});
function frame(type,seq,ops,epoch='epoch_A'){return {v:1,type,topic:'room:1',seq,epoch,ops};}
let count = 0;
const test = (name, fn) => { fn(); count++; console.log('PASS '+name); };
test('join is versioned, scoped and resumes', () => {
  client.start(); sockets[0].open(); assert.equal(sockets[0].protocol,SUBPROTOCOL);
  assert.deepEqual(sockets[0].messages[0],{v:1,type:'join',topic:'room:1',csrf:'0123456789abcdef',epoch:null,seq:0});
});
test('snapshot sets text inertly and acknowledges',()=>{
  sockets[0].receive(frame('snapshot',4,[{op:'text',id:'counter',text:'<img onerror=alert(1)>'}]));
  assert.equal(counter.textContent,'<img onerror=alert(1)>'); assert.equal(client.seq,4);
  assert.equal(sockets[0].messages.at(-1).type,'ack');
});
test('sequential patch supports keyed inserts',()=>{
  sockets[0].receive(frame('patch',5,[{op:'append_text',id:'feed',key:'r1',tag:'li',text:'hello'}]));
  assert.equal(list.children.length,1); assert.equal(list.children[0].textContent,'hello');
});
test('authoritative snapshot can clear and rebuild keyed items',()=>{
  sockets[0].receive(frame('snapshot',5,[{op:'clear',id:'feed'},{op:'append_text',id:'feed',key:'r1',tag:'li',text:'replaced'}]));
  assert.equal(list.children.length,1); assert.equal(list.children[0].textContent,'replaced');
});
test('duplicate keyed insert fails before any DOM writes',()=>{
  const temp = new OresLiveClient({url:'wss://app.example/live',baseUrl:'https://app.example',root,topic:'room:1',csrf:'0123456789abcdef',socketFactory:()=>new Socket(SUBPROTOCOL)});
  temp.start(); temp.socket.open();
  temp.socket.receive(frame('snapshot',6,[{op:'text',id:'counter',text:'partial'},{op:'append_text',id:'feed',key:'r1',tag:'li',text:'duplicate'}]));
  assert.equal(temp.socket.closedCode,1008); assert.notEqual(counter.textContent,'partial');
});
test('gap causes resync without state mutation',()=>{
  sockets[0].receive(frame('patch',7,[{op:'text',id:'counter',text:'should not apply'}]));
  assert.equal(client.ready,false); assert.equal(client.seq,5);
  assert.equal(sockets[0].messages.at(-1).type,'resync');
});
test('snapshot after gap restores state with new epoch',()=>{
  sockets[0].receive(frame('snapshot',2,[{op:'text',id:'counter',text:'resynced'}],'epoch_B'));
  assert.equal(client.seq,2); assert.equal(counter.textContent,'resynced'); assert.equal(client.epoch,'epoch_B');
});
test('no automatic retry of client commands',()=>{
  assert.equal(client.sendEvent('increment',{by:1}),true);
  assert.equal(sockets[0].messages.at(-1).event,'increment');
  sockets[0].close(1006); assert.equal(client.ready,false);
  assert.equal(client.sendEvent('increment',{by:1}),false); assert.equal(timers.length,1);
  timers.shift().fn(); sockets[1].open();
  assert.equal(sockets[1].messages[0].seq,2); assert.equal(sockets[1].messages[0].epoch,'epoch_B');
  assert.equal(sockets[1].messages.some(m=>m.type==='event'),false);
});
test('reconnect replays ordered patches before ready',()=>{
  sockets[1].receive(frame('patch',3,[{op:'text',id:'counter',text:'replayed'}],'epoch_B'));
  assert.equal(client.seq,3); assert.equal(client.ready,false);
  sockets[1].receive({v:1,type:'ready',topic:'room:1',epoch:'epoch_B',seq:3});
  assert.equal(client.ready,true);
});
test('wrong epoch patch requests new snapshot',()=>{
  sockets[1].receive(frame('patch',4,[{op:'text',id:'counter',text:'bad'}],'epoch_A'));
  assert.equal(sockets[1].messages.at(-1).type, 'resync');
  assert.equal(counter.textContent,'replayed');
});
test('out-of-root target fails closed before DOM mutation',()=>{
  sockets[1].receive(frame('snapshot',4,[{op:'text',id:'counter',text:'partial'},{op:'text',id:outsider.id,text:'unsafe'}],'epoch_B'));
  assert.equal(counter.textContent,'replayed'); assert.equal(sockets[1].closedCode,1008);
});
test('bad connection URL rejected',()=>{
  assert.throws(()=>new OresLiveClient({url:'wss://other.example/live',baseUrl:'https://app.example',root,topic:'room:1',csrf:'0123456789abcdef'}));
  assert.throws(()=>new OresLiveClient({url:'ws://app.example/live',baseUrl:'https://app.example',root,topic:'room:1',csrf:'0123456789abcdef'}));
});
test('unsupported dynamic attributes cannot execute scripts',()=>{
  const c = new OresLiveClient({url:'wss://app.example/live',baseUrl:'https://app.example',root,topic:'room:1',csrf:'0123456789abcdef',socketFactory:()=>new Socket(SUBPROTOCOL)});
  c.start(); c.socket.open(); c.socket.receive(frame('snapshot',0,[{op:'attr',id:'counter',name:'onclick',value:'alert(1)'}]));
  assert.equal(c.socket.closedCode,1008);
});
console.log(`LIVE_CLIENT_HOST_PASS cases=${count}`);
