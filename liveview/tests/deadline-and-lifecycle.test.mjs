// Executed host-reference regressions for absolute partial-message deadlines,
// per-view admission limits and immediate transport teardown. NOT native Oreslang.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {ClientFrameParser, encodeClientFrame} from '../reference/ws-wire.mjs';
import {LiveViewSession} from '../reference/liveview-core.mjs';
import {installReferenceGateway} from '../reference/ws-gateway.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const origin='http://127.0.0.1';
const session=(opts={})=>new LiveViewSession({
  viewId:'counter',sessionId:'session',csrfToken:'long-csrf-token-1234',origin,
  initialState:{count:0},render:s=>[{tag:'span',id:'count',text:String(s.count)}],
  reduce:s=>({count:s.count+1}),authorize:()=>true,...opts
});
const join=()=>({v:1,type:'join',view_id:'counter',session_id:'session',csrf:'long-csrf-token-1234',resume_rev:-1});
const transport=(connectionId)=>({connectionId,user:'alice',origin});
const deadlineError=e=>e?.closeCode===1008 && /deadline/.test(e.message);

test('reject incomplete first header after absolute assembly deadline',()=>{
  let clock=0;const p=new ClientFrameParser({maxMessageAgeMs:30,now:()=>clock});
  const frame=encodeClientFrame(1,'hello');
  assert.deepEqual(p.feed(frame.subarray(0,1)),[]);
  clock=31;
  assert.throws(()=>p.feed(frame.subarray(1)),deadlineError);
});
test('partial payload trickle cannot renew an incomplete frame deadline',()=>{
  let clock=0;const p=new ClientFrameParser({maxMessageAgeMs:30,now:()=>clock});
  const frame=encodeClientFrame(1,'abcdef');
  for(const [at,start,end] of [[0,0,3],[10,3,5],[20,5,6]]){
    clock=at; assert.deepEqual(p.feed(frame.subarray(start,end)),[]);
  }
  clock=31;assert.throws(()=>p.feed(frame.subarray(6)),deadlineError);
});
test('absolute deadline stays bound to fragmented message through interleaved pong',()=>{
  let clock=0;const p=new ClientFrameParser({maxMessageAgeMs:30,now:()=>clock});
  assert.deepEqual(p.feed(encodeClientFrame(1,'alpha',{fin:false})),[]);
  clock=15;assert.equal(p.feed(encodeClientFrame(10,'heartbeat'))[0].type,'pong');
  clock=31;assert.throws(()=>p.feed(encodeClientFrame(0,'omega',{fin:true})),deadlineError);
});
test('exact assembly deadline is accepted, greater-than is rejected',()=>{
  let clock=0;const p=new ClientFrameParser({maxMessageAgeMs:30,now:()=>clock});
  const frame=encodeClientFrame(1,'alpha');
  assert.deepEqual(p.feed(frame.subarray(0,4)),[]);
  clock=30;assert.equal(p.feed(frame.subarray(4))[0].data,'alpha');
});
test('completed data messages reset the assembly deadline',()=>{
  let clock=0;const p=new ClientFrameParser({maxMessageAgeMs:30,now:()=>clock});
  assert.equal(p.feed(encodeClientFrame(1,'a'))[0].data,'a');
  clock=500;assert.equal(p.feed(encodeClientFrame(1,'b'))[0].data,'b');
});
test('standalone ping and pong do not create a phantom incomplete message',()=>{
  let clock=0;const p=new ClientFrameParser({maxMessageAgeMs:30,now:()=>clock});
  assert.equal(p.feed(encodeClientFrame(9,'x'))[0].type,'ping');
  clock=1000;assert.equal(p.feed(encodeClientFrame(10,'x'))[0].type,'pong');
  clock=2000;assert.equal(p.feed(encodeClientFrame(1,'valid'))[0].data,'valid');
});
test('control frames split across TCP reads must complete within deadline',()=>{
  let clock=0;const p=new ClientFrameParser({maxMessageAgeMs:30,now:()=>clock});
  const frame=encodeClientFrame(9,Buffer.alloc(12));
  assert.deepEqual(p.feed(frame.subarray(0,2)),[]);
  clock=50;assert.throws(()=>p.feed(frame.subarray(2)),deadlineError);
});
test('invalid assembly budgets fail closed',()=>{
  for(const invalid of [0,-1,1.5,NaN,Infinity])
    assert.throws(()=>new ClientFrameParser({maxMessageAgeMs:invalid}),/invalid parser budgets/);
  assert.throws(()=>new ClientFrameParser({now:42}),/invalid parser budgets/);
});
test('subscriber budget rejects invalid size and duplicate connection IDs',()=>{
  for(const invalid of [0,-1,1.2,4097])assert.throws(()=>session({maxSubscribers:invalid}),/subscriber bound/);
  const s=session({maxSubscribers:2});s.attach('one',()=>{});
  assert.throws(()=>s.attach('one',()=>{}),/duplicate subscription/);
  assert.equal(s.subscribers.size,1);
});
test('subscriber quota is reclaimed on detach without removing other peers',()=>{
  const s=session({maxSubscribers:1}),send=()=>{};
  s.attach('one',send);assert.throws(()=>s.attach('two',send),/subscriber limit/);
  s.receive(join(),transport('one'));
  s.detach('one');
  assert.equal(s.subscribers.size,0);assert.equal(s.joined.size,0);
  s.attach('two',send);assert.equal(s.subscribers.size,1);
});

async function networkEnv(options={}){
  const server=http.createServer((_req,res)=>{res.writeHead(404);res.end();});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port,live=session({origin:`http://127.0.0.1:${port}`});
  const gateway=installReferenceGateway(server,{origins:new Set([`http://127.0.0.1:${port}`]),hosts:new Set([`127.0.0.1:${port}`]),
    allowLoopbackCleartext:true,authenticate:r=>r.headers.cookie==='session=yes'?{id:'alice'}:null,
    getSession:()=>live,...options});
  return {server,port,live,gateway,async stop(){gateway.close();await new Promise(resolve=>server.close(resolve));}};
}
async function connect(env){
  const socket=net.createConnection({port:env.port,host:'127.0.0.1'});
  let buf=Buffer.alloc(0);socket.on('data',d=>{buf=Buffer.concat([buf,d]);});
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
  const key=randomBytes(16).toString('base64');
  socket.write(`GET /live HTTP/1.1\r\nHost: 127.0.0.1:${env.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: ores-liveview-v1\r\nOrigin: http://127.0.0.1:${env.port}\r\nCookie: session=yes\r\n\r\n`);
  for(let i=0;i<150;i++){
    const index=buf.indexOf('\r\n\r\n');
    if(index>=0){const status=buf.subarray(0,index).toString();buf=buf.subarray(index+4);assert.match(status,/101 Switching Protocols/);return {socket,
      send:(data)=>socket.write(data),
      async closeFrame(){for(let j=0;j<150;j++){
        if(buf.length>=4 && (buf[0]&15)===8){const width=(buf[1]&127)<126?2:4;const len=width===2?(buf[1]&127):buf.readUInt16BE(2);if(buf.length>=width+len)return buf.readUInt16BE(width);}
        await delay(3);
      }throw Error('no close frame');}};}
    await delay(3);
  }socket.destroy();throw Error('upgrade timeout');
}
test('real upgraded TCP socket kills slow partial header with close 1008',async()=>{
  const env=await networkEnv({maxMessageAgeMs:25});
  try {const c=await connect(env);const frame=encodeClientFrame(1,'hello');
    c.send(frame.subarray(0,1));await delay(70);c.send(frame.subarray(1));
    assert.equal(await c.closeFrame(),1008);c.socket.destroy();
    for(let i=0;i<100&&env.gateway.connections;i++)await delay(2);
    assert.equal(env.gateway.connections,0);assert.equal(env.live.subscribers.size,0);
  }finally{await env.stop();}
});
test('gateway shutdown detaches actor synchronously, even before socket close event',async()=>{
  const env=await networkEnv();
  try {const a=await connect(env),b=await connect(env);
    assert.equal(env.gateway.connections,2);assert.equal(env.live.subscribers.size,2);
    env.gateway.close();
    assert.equal(env.gateway.connections,0);assert.equal(env.live.subscribers.size,0);
    assert.equal(env.live.joined.size,0);
    env.gateway.close();assert.equal(env.gateway.connections,0);
    a.socket.destroy();b.socket.destroy();
  }finally{await env.stop();}
});
test('per-session subscriber cap applies across gateways and leaves healthy peer attached',async()=>{
  const env=await networkEnv({maxConnections:3});
  try {env.live.maxSubscribers=1;
    const a=await connect(env);assert.equal(env.live.subscribers.size,1);
    const b=await connect(env);assert.equal(await b.closeFrame(),1011);
    assert.equal(env.live.subscribers.size,1);
    a.socket.destroy();b.socket.destroy();
  }finally{await env.stop();}
});
