// Additional REAL TCP WebSocket E2E security/regression checks. Host reference only.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {randomBytes,createHash} from 'node:crypto';
import {launchReferenceDemo} from '../reference/demo-server.mjs';
import {encodeClientFrame} from '../reference/ws-wire.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const magic='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
async function env() {
  const server=await launchReferenceDemo();
  const page=await fetch(server.origin+'/');
  const cookie=page.headers.get('set-cookie').split(';')[0];
  const boot=await (await fetch(server.origin+'/bootstrap.json',{headers:{Cookie:cookie}})).json();
  return {server,cookie,boot,close:()=>server.close()};
}
function request(e,{method='GET',path='/live',host=`127.0.0.1:${e.server.port}`,origin=e.server.origin,
  cookie=e.cookie,version='13',protocol='ores-liveview-v1',key=randomBytes(16).toString('base64'),extras=[]}={}) {
  const lines=[`${method} ${path} HTTP/1.1`,`Host: ${host}`,'Upgrade: websocket','Connection: keep-alive, Upgrade',
    `Sec-WebSocket-Key: ${key}`,`Sec-WebSocket-Version: ${version}`,`Sec-WebSocket-Protocol: ${protocol}`,
    `Origin: ${origin}`,`Cookie: ${cookie}`,...extras,'',''];
  return lines.join('\r\n');
}
async function connect(e,raw) {
  const socket=net.connect({host:'127.0.0.1',port:e.server.port});
  socket.on('error',()=>{}); // Rejections may tear down TCP before the test reads the response.
  socket.setTimeout(2500,()=>socket.destroy());
  let pending=Buffer.alloc(0),status=null;
  socket.on('data',bytes=>{pending=Buffer.concat([pending,bytes]);});
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
  socket.write(raw);
  for(let attempt=0;attempt<150;attempt++) {
    const i=pending.indexOf('\r\n\r\n');
    if(i>=0){status=pending.subarray(0,i+4).toString();pending=pending.subarray(i+4);break;}
    await pause(3);
  }
  if(status===null){socket.destroy();throw new Error('missing handshake response');}
  const queue=[];
  function parse() {
    let offset=0;
    while(pending.length-offset>=2) {
      const indicator=pending[offset+1]&127;
      let header=2,size=indicator;
      if(indicator===126){if(pending.length-offset<4)break;header=4;size=pending.readUInt16BE(offset+2);}
      if(indicator===127){if(pending.length-offset<10)break;header=10;size=Number(pending.readBigUInt64BE(offset+2));}
      if(pending.length-offset<header+size)break;
      const opcode=pending[offset]&15,body=Buffer.from(pending.subarray(offset+header,offset+header+size));
      queue.push({opcode,body,json:opcode===1?JSON.parse(body.toString()):null});offset+=header+size;
    }
    pending=pending.subarray(offset);
  }
  return {socket,status,send:(value)=>socket.write(encodeClientFrame(1,JSON.stringify(value))),
    async take(n=1){for(let tries=0;tries<200;tries++){parse();if(queue.length>=n)return queue.splice(0,n);await pause(3);}throw Error(`frame timeout ${queue.length}/${n}`);},
    shutdown(){socket.destroy();}};
}
const join=e=>({v:1,type:'join',view_id:'counter',session_id:e.boot.session_id,csrf:e.boot.csrf,resume_rev:-1});
const event=(id,base_rev)=>({v:1,type:'event',event_id:id,name:'increment',payload:{},base_rev});
const expectClose=async(c,code)=>{const frames=await c.take();assert.equal(frames[0].opcode,8);assert.equal(frames[0].body.readUInt16BE(0),code);};

for(const [label,fields,status] of [
  ['wrong WebSocket path',{path:'/not-live'},400],
  ['wrong HTTP method',{method:'POST'},400],
  ['untrusted host',{host:'evil.invalid'},400],
  ['untrusted Origin',{origin:'http://evil.invalid'},400],
  ['wrong WebSocket version',{version:'12'},400],
  ['unoffered subprotocol',{protocol:'other-liveview'},400],
  ['invalid Sec-WebSocket-Key',{key:'invalid-key'},400],
  ['missing credentials',{cookie:'session=invalid'},403],
  ['extension negotiation',{extras:['Sec-WebSocket-Extensions: permessage-deflate']},400],
  ['duplicate Origin',{extras:['Origin: http://example.invalid']},400],
  ['duplicate Cookie',{extras:['Cookie: session=invalid']},400],
  ['unexpected Content-Length',{extras:['Content-Length: 12']},400],
  ['header budget exhaustion',{extras:['X-Pad: '+('p'.repeat(9000))]},400],
]) test(`real TCP rejects ${label} at HTTP upgrade`,async()=>{
  const e=await env();let c;
  try{c=await connect(e,request(e,fields));assert.match(c.status,new RegExp(`HTTP/1.1 ${status}`));assert.equal(e.server.view.revision,0);}
  finally{c?.shutdown();await e.close();}
});
test('real TCP validates RFC6455 accept and negotiated first-party subprotocol',async()=>{
  const e=await env();let c;
  const key=randomBytes(16).toString('base64');
  try{c=await connect(e,request(e,{key}));assert.match(c.status,/101 Switching Protocols/);
    const digest=createHash('sha1').update(key+magic).digest('base64');
    assert.ok(c.status.includes(`Sec-WebSocket-Accept: ${digest}`));
    assert.match(c.status,/Sec-WebSocket-Protocol: ores-liveview-v1/);
  }finally{c?.shutdown();await e.close();}
});
test('real TCP processes coalesced join plus event in order, committing only once',async()=>{
  const e=await env();let c;
  try{c=await connect(e,request(e));
    c.socket.write(Buffer.concat([encodeClientFrame(1,JSON.stringify(join(e))),
      encodeClientFrame(1,JSON.stringify(event('abcdef12-1111-4444-8888-12345678abcd',0)))]));
    const frames=(await c.take(4)).map(f=>f.json);
    assert.deepEqual(frames.map(x=>x.type),['snapshot','ready','patch','event_ack']);
    assert.equal(frames[2].rev,1);assert.equal(e.server.view.state.count,1);
  }finally{c?.shutdown();await e.close();}
});
test('real TCP event before join fails closed and does not mutate actor',async()=>{
  const e=await env();let c;
  try{c=await connect(e,request(e));c.send(event('abcdef12-2222-4444-8888-12345678abcd',0));
    await expectClose(c,1008);assert.equal(e.server.view.state.count,0);
  }finally{c?.shutdown();await e.close();}
});
test('real TCP unexpected continuation frame closes with protocol error 1002',async()=>{
  const e=await env();let c;
  try{c=await connect(e,request(e));c.socket.write(encodeClientFrame(0,'orphan'));await expectClose(c,1002);}
  finally{c?.shutdown();await e.close();}
});
test('real TCP reserved RSV bit closes with protocol error 1002',async()=>{
  const e=await env();let c;
  try{c=await connect(e,request(e));const frame=encodeClientFrame(1,'{}');frame[0]|=0x40;c.socket.write(frame);await expectClose(c,1002);}
  finally{c?.shutdown();await e.close();}
});
test('real TCP invalid fragmented UTF-8 closes with 1007',async()=>{
  const e=await env();let c;
  try{c=await connect(e,request(e));c.socket.write(Buffer.concat([
    encodeClientFrame(1,Buffer.from([0xf0,0x9f]),{fin:false}),encodeClientFrame(0,Buffer.from([0xff,0x80]))]));await expectClose(c,1007);}
  finally{c?.shutdown();await e.close();}
});
test('real TCP 64-bit frame over message budget is rejected at the header with 1009',async()=>{
  const e=await env();let c;
  try{c=await connect(e,request(e));const frame=Buffer.alloc(14);frame[0]=0x81;frame[1]=0xff;frame.writeBigUInt64BE(70000n,2);
    frame.writeUInt32BE(0xdeadbeef,10);c.socket.write(frame);await expectClose(c,1009);}
  finally{c?.shutdown();await e.close();}
});
test('real TCP previously rejected peer cannot poison a subsequent authenticated session',async()=>{
  const e=await env();let bad,good;
  try{bad=await connect(e,request(e));bad.send(event('abcdef12-3333-4444-8888-12345678abcd',0));await expectClose(bad,1008);
    good=await connect(e,request(e));good.send(join(e));
    assert.deepEqual((await good.take(2)).map(f=>f.json.type),['snapshot','ready']);
    good.send(event('abcdef12-4444-4444-8888-12345678abcd',0));
    assert.deepEqual((await good.take(2)).map(f=>f.json.type),['patch','event_ack']);
    assert.equal(e.server.view.state.count,1);
  }finally{bad?.shutdown();good?.shutdown();await e.close();}
});
