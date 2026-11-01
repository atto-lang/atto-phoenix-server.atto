// Adversarial, deterministic host-only tests. These do not execute native Oreslang.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {ClientFrameParser,encodeClientFrame,WireError} from '../reference/ws-wire.mjs';
import {installReferenceGateway} from '../reference/ws-gateway.mjs';
import {LiveViewSession} from '../reference/liveview-core.mjs';

const ORIGIN='http://127.0.0.1:8000';
const live = (options={}) => new LiveViewSession({viewId:'counter',sessionId:'s',csrfToken:'long-csrf-1234567890',origin:ORIGIN,
  initialState:{count:0},render:s=>[{tag:'span',id:'count',text:String(s.count)}],
  reduce:(s,name)=>{if(name!=='add')throw Error('invalid');return {count:s.count+1};},
  authorize:transport=>transport.user==='alice'&&transport.origin===ORIGIN,...options});
const join = (resume=-1)=>({v:1,type:'join',view_id:'counter',session_id:'s',csrf:'long-csrf-1234567890',resume_rev:resume});
const event = (n,base)=>({v:1,type:'event',event_id:n.toString(16).padStart(8,'0')+'-dead-4000-8000-000000000000',name:'add',payload:{},base_rev:base});
const transport = id => ({connectionId:id,origin:ORIGIN,user:'alice'});
function seeded(seed=0x67be8e13) {let x=seed>>>0;return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return x>>>0;};}
function randomChunks(buf,seed=1) {const rand=seeded(seed),chunks=[];let i=0;while(i<buf.length){const n=1+(rand()%Math.min(511,buf.length-i));chunks.push(buf.subarray(i,i+n));i+=n;}return chunks;}
function errorCode(fn,code) {assert.throws(fn,err=>err instanceof WireError && err.closeCode===code);}

test('seeded streaming fuzz: 100 masked UTF-8 text frames tolerate arbitrary TCP splits',()=>{
  const rand=seeded();
  for(let i=0;i<100;i++) {
    const length=(rand()%650)+1;
    const body='π🌐a'.repeat(length);
    const frame=encodeClientFrame(1,Buffer.from(body));
    const parser=new ClientFrameParser(),out=[];
    for(const part of randomChunks(frame,i+1))out.push(...parser.feed(part));
    assert.deepEqual(out,[{type:'text',data:body}]);
    assert.equal(parser.pending.length,0);
  }
});
test('fragmented Unicode and interleaved ping survive randomized network chunking',()=>{
  const payload=Buffer.from('hello-🌐-world');
  const frames=Buffer.concat([
    encodeClientFrame(1,payload.subarray(0,7),{fin:false}),
    encodeClientFrame(9,'keepalive'),
    encodeClientFrame(0,payload.subarray(7,9),{fin:false}),
    encodeClientFrame(0,payload.subarray(9))]);
  for(let seed=1;seed<=20;seed++) {
    const parser=new ClientFrameParser(),out=[];
    for(const part of randomChunks(frames,seed))out.push(...parser.feed(part));
    assert.deepEqual(out,[{type:'ping',data:Buffer.from('keepalive')},{type:'text',data:'hello-🌐-world'}]);
  }
});
test('invalid fragmented UTF-8 is rejected after reassembly (1007)',()=>{
  const parser=new ClientFrameParser();
  parser.feed(encodeClientFrame(1,Buffer.from([0xf0,0x9f]),{fin:false}));
  errorCode(()=>parser.feed(encodeClientFrame(0,Buffer.from([0x41,0x42]))),1007);
});
test('masked short, non-minimal and oversized frames are rejected fail-closed',()=>{
  const invalid=[
    [Buffer.from([0x81,0x01,0x41]),1002],
    [Buffer.from([0xc1,0x80,1,2,3,4]),1002],
    [Buffer.from([0x83,0x80,1,2,3,4]),1002],
    [Buffer.from([0x81,0xfe,0,1,1,2,3,4,0]),1002],
    [Buffer.from([0x81,0xff,0x80,0,0,0,0,1,0,0,1,2,3,4]),1002],
    [encodeClientFrame(1,'0123456789'),1009],
  ];
  for(const [index,[raw,code]] of invalid.entries()) {
    const parser=new ClientFrameParser(index===5?{maxMessage:5}:{});
    errorCode(()=>parser.feed(raw),code);
  }
});
test('oversized fragmented message is rejected before final frame',()=>{
  const parser=new ClientFrameParser({maxMessage:8});
  parser.feed(encodeClientFrame(1,'12345',{fin:false}));
  errorCode(()=>parser.feed(encodeClientFrame(0,'6789',{fin:false})),1009);
});
test('fragment slot limit prevents zero-byte fragmentation exhaustion',()=>{
  const parser=new ClientFrameParser({maxFragments:3});
  parser.feed(encodeClientFrame(1,'',{fin:false}));
  parser.feed(encodeClientFrame(0,'',{fin:false}));
  parser.feed(encodeClientFrame(0,'',{fin:false}));
  errorCode(()=>parser.feed(encodeClientFrame(0,'',{fin:false})),1009);
});
test('session replay window falls back to snapshot while preserving monotonic state',()=>{
  const s=live({maxHistory:3});const t=transport('a');
  assert.equal(s.receive(join(),t)[0].type,'snapshot');
  for(let i=0;i<12;i++)s.receive(event(i+1,i),t);
  assert.equal(s.revision,12);assert.equal(s.state.count,12);assert.equal(s.history.length,3);
  assert.deepEqual(s.receive(join(9),transport('b')).map(x=>x.type),['patch','patch','patch','ready']);
  assert.deepEqual(s.receive(join(7),transport('c')).map(x=>x.type),['snapshot','ready']);
});
test('expired idempotency window does not accept stale events',()=>{
  const s=live({maxDedup:2}),t=transport('alice');s.receive(join(),t);
  for(let i=0;i<5;i++)s.receive(event(i+1,i),t);
  assert.equal(s.seen.size,2);
  assert.equal(s.receive(event(1,0),t)[0].type,'resync_required');
  assert.equal(s.state.count,5);
});
test('malformed and unauthorized events do not advance committed revision',()=>{
  const s=live(),t=transport('alice');s.receive(join(),t);
  for(const v of [{...event(1,0),name:'<script>'},{...event(2,0),payload:{__danger:'x'}},{...event(3,0),type:'unknown'}]) {
    assert.throws(()=>s.receive(v,t));assert.equal(s.revision,0);
  }
  assert.throws(()=>s.receive(event(4,0),{...t,user:'mallory'}));
  assert.equal(s.state.count,0);
});
test('detached subscribers receive no patches while remaining subscribers receive one',()=>{
  const s=live(),a=transport('a'),b=transport('b'),c=transport('c');
  const received={a:[],b:[],c:[]};
  for(const t of [a,b,c]) {s.attach(t.connectionId,frame=>received[t.connectionId].push(frame));s.receive(join(),t);}
  s.detach('b');
  const [patch,ack]=s.receive(event(1,0),a);
  assert.equal(patch.rev,1);assert.equal(ack.rev,1);
  assert.deepEqual(received,{a:[],b:[],c:[patch]});
});

test('subscriber callback failure is isolated from live actor state and other clients',()=>{
  const s=live(),a=transport('a'),b=transport('b'),c=transport('c');const delivered=[];
  s.attach('b',()=>{throw Error('dead subscriber');});
  s.attach('c',frame=>delivered.push(frame));
  for(const t of [a,b,c])s.receive(join(),t);
  s.receive(event(1,0),a);
  assert.equal(s.revision,1);assert.equal(s.state.count,1);
  assert.equal(s.subscribers.has('b'),false);assert.equal(delivered.length,1);
});

async function gatewayHarness(sessionFactory) {
  const server=http.createServer((req,res)=>{res.writeHead(404).end();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port,origin=`http://127.0.0.1:${port}`;
  const session=sessionFactory();
  const gateway=installReferenceGateway(server,{origins:new Set([origin]),hosts:new Set([`127.0.0.1:${port}`]),allowLoopbackCleartext:true,
    authenticate:()=>({id:'alice'}),getSession:()=>session});
  return {port,origin,gateway,session,async stop(){gateway.close();await new Promise(resolve=>server.close(resolve));}};
}
async function connect(port,origin){
  const s=net.createConnection({host:'127.0.0.1',port});
  const timer=setTimeout(()=>s.destroy(new Error('timeout')),1500);
  const chunks=[];s.on('data',b=>chunks.push(b));
  try{
    await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('error',reject);});
    s.write(['GET /live HTTP/1.1',`Host: 127.0.0.1:${port}`,'Upgrade: websocket','Connection: Upgrade',
      `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Protocol: ores-liveview-v1',`Origin: ${origin}`,'',''].join('\r\n'));
    for(let i=0;i<100;i++){if(Buffer.concat(chunks).includes(Buffer.from('\r\n\r\n')))break;await new Promise(r=>setTimeout(r,5));}
    const bytes=Buffer.concat(chunks),end=bytes.indexOf('\r\n\r\n');
    assert(end>=0,'HTTP upgrade never responded');
    return {s,headers:bytes.subarray(0,end+4).toString(),frames:()=>Buffer.concat(chunks).subarray(end+4)};
  }finally{clearTimeout(timer);}
}
test('throwing session attach returns 1011 close without crashing gateway or leaking slot',async()=>{
  let detached=0;
  const env=await gatewayHarness(()=>({receive:()=>[],attach(){throw Error('actor offline');},detach(){detached++;}}));
  try{
    const c=await connect(env.port,env.origin);assert.match(c.headers,/101 Switching Protocols/);
    for(let i=0;i<100&&c.frames().length<4;i++)await new Promise(r=>setTimeout(r,5));
    assert.equal(c.frames()[0]&15,8);assert.equal(c.frames().readUInt16BE(2),1011);
    assert.equal(env.gateway.connections,0);assert.equal(detached,1);
    assert.equal(env.gateway.faults.attach,1);c.s.destroy();
    const again=await connect(env.port,env.origin);
    assert.match(again.headers,/101 Switching Protocols/);again.s.destroy();
  }finally{await env.stop();}
});
test('throwing detach callback cannot crash close event or prevent another upgrade',async()=>{
  const env=await gatewayHarness(()=>({receive:()=>[],attach(){},detach(){throw Error('detachment bug');}}));
  try{
    const a=await connect(env.port,env.origin);a.s.write(encodeClientFrame(8));
    for(let i=0;i<100&&env.gateway.connections!==0;i++)await new Promise(r=>setTimeout(r,5));
    assert.equal(env.gateway.connections,0);
    assert.equal(env.gateway.faults.detach,1);
    const b=await connect(env.port,env.origin);assert.match(b.headers,/101 Switching Protocols/);b.s.destroy();
  }finally{await env.stop();}
});
test('cyclic subscriber output produces 1011 close rather than process-level exception',async()=>{
  const env=await gatewayHarness(()=>({receive:()=>[],attach(_id,send){const x={};x.self=x;send(x);},detach(){}}));
  try{
    const c=await connect(env.port,env.origin);assert.match(c.headers,/101 Switching Protocols/);
    for(let i=0;i<100&&c.frames().length<4;i++)await new Promise(r=>setTimeout(r,5));
    assert.equal(c.frames()[0]&15,8);assert.equal(c.frames().readUInt16BE(2),1011);
    assert.equal(env.gateway.connections,0);assert.equal(env.gateway.faults.output,1);c.s.destroy();
  }finally{await env.stop();}
});
