import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {LiveViewSession} from '../reference/liveview-core.mjs';
import {encodeClientFrame} from '../reference/ws-wire.mjs';
import {installReferenceGateway} from '../reference/ws-gateway.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function setup(gatewayOptions={}) {
  const server=http.createServer((req,res)=>{res.writeHead(404);res.end();});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port,origin=`http://127.0.0.1:${port}`;
  const session=new LiveViewSession({viewId:'counter',sessionId:'s1',csrfToken:'valid-token-12345678',origin,initialState:{count:0},
    render:s=>[{tag:'span',id:'value',text:String(s.count)}],reduce:(s,name)=>{if(name!=='increment')throw Error('invalid event');return {count:s.count+1};},
    authorize:t=>t.user==='alice'&&t.origin===origin});
  const gateway=installReferenceGateway(server,{origins:new Set([origin]),hosts:new Set([`127.0.0.1:${port}`]),allowLoopbackCleartext:true,
    authenticate:req=>req.headers.cookie==='session=allow' ? {id:'alice'}:null,getSession:()=>session,maxConnections:2,...gatewayOptions});
  return {server,gateway,port,origin,session,async stop(){gateway.close();await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}};
}
function request(port,origin,{cookie='session=allow',path='/live',key=randomBytes(16).toString('base64'),extras=''}={}){
  return `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: ores-liveview-v1\r\nOrigin: ${origin}\r\nCookie: ${cookie}\r\n${extras}\r\n`;
}
async function connect(port,req) {
  const s=net.connect({host:'127.0.0.1',port});s.setTimeout(2000,()=>s.destroy(new Error('socket test timeout')));
  await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('error',reject);});
  let buffer=Buffer.alloc(0);const onData=data=>buffer=Buffer.concat([buffer,data]);s.on('data',onData);
  s.write(req);
  for(let i=0;i<100;i++) {if(buffer.includes(Buffer.from('\r\n\r\n')))break;await delay(3);}
  const idx=buffer.indexOf(Buffer.from('\r\n\r\n'));if(idx<0){s.destroy();throw new Error('no HTTP response');}
  const status=buffer.subarray(0,idx+4).toString('utf8');buffer=buffer.subarray(idx+4);
  return {socket:s,status,readFrames:async (count)=>{
    const output=[];
    for(let attempt=0;attempt<150;attempt++){
      let offset=0;
      while(buffer.length-offset>=2){const b=buffer[offset+1],size=b&127;let length=size,header=2;if(size===126){if(buffer.length-offset<4)break;length=buffer.readUInt16BE(offset+2);header=4;}else if(size===127){if(buffer.length-offset<10)break;length=Number(buffer.readBigUInt64BE(offset+2));header=10;}
        if(buffer.length-offset<header+length)break;
        const opcode=buffer[offset]&15,data=buffer.subarray(offset+header,offset+header+length);output.push({opcode,data:Buffer.from(data),text:data.toString()});offset+=header+length;
      }
      buffer=buffer.subarray(offset);
      if(output.length>=count)return output;
      await delay(3);
    }
    throw new Error(`frame timeout, got ${output.length}/${count}`);
  }};
}
test('actual TCP upgrade, authenticated join, patch and ACK',async()=>{
  const env=await setup();try{
    const c=await connect(env.port,request(env.port,env.origin));assert.match(c.status,/101 Switching Protocols/);
    assert.match(c.status,/Sec-WebSocket-Protocol: ores-liveview-v1/);
    c.socket.write(encodeClientFrame(1,JSON.stringify({v:1,type:'join',view_id:'counter',session_id:'s1',csrf:'valid-token-12345678',resume_rev:-1})));
    const frames=(await c.readFrames(2)).map(f=>JSON.parse(f.text));assert.deepEqual(frames.map(f=>f.type),['snapshot','ready']);
    c.socket.write(encodeClientFrame(1,JSON.stringify({v:1,type:'event',event_id:'bbbbbbbb-1111',name:'increment',payload:{},base_rev:0})));
    const reply=(await c.readFrames(2)).map(f=>JSON.parse(f.text));assert.deepEqual(reply.map(f=>f.type),['patch','event_ack']);assert.equal(env.session.state.count,1);
    c.socket.destroy();
  }finally{await env.stop();}
});
test('reject cross-origin, missing auth, duplicate Origin and body-framing on upgrade',async()=>{
  const env=await setup();try{
    const checks=[request(env.port,'http://evil.test'),request(env.port,env.origin,{cookie:'session=deny'}),request(env.port,env.origin,{extras:'Origin: '+env.origin+'\r\n'}),request(env.port,env.origin,{extras:'Content-Length: 3\r\n'})];
    for(const bad of checks){const c=await connect(env.port,bad);assert.match(c.status,/HTTP\/1.1 (400|403)/);c.socket.destroy();}
    assert.equal(env.gateway.connections,0);
  }finally{await env.stop();}
});
test('unmasked frames close with protocol error and detach view',async()=>{
  const env=await setup();try{
    const c=await connect(env.port,request(env.port,env.origin));c.socket.write(Buffer.from([0x81,2,123,125]));
    const frames=await c.readFrames(1);assert.equal(frames[0].opcode,8);assert.equal(frames[0].data.readUInt16BE(0),1002);
    c.socket.destroy();await delay(10);assert.equal(env.gateway.connections,0);
  }finally{await env.stop();}
});

test('real TCP enforces per-connection message flood budget with 1008',async()=>{
  const env=await setup({maxMessagesPerWindow:2,messageWindowMs:10000});
  try{
    const c=await connect(env.port,request(env.port,env.origin));
    const join={v:1,type:'join',view_id:'counter',session_id:'s1',csrf:'valid-token-12345678',resume_rev:-1};
    c.socket.write(encodeClientFrame(1,JSON.stringify(join)));
    await c.readFrames(2);
    c.socket.write(encodeClientFrame(1,JSON.stringify({v:1,type:'resync',view_id:'counter',revision:0})));
    await c.readFrames(2);
    c.socket.write(encodeClientFrame(1,JSON.stringify({v:1,type:'resync',view_id:'counter',revision:0})));
    const result=await c.readFrames(1);
    assert.equal(result[0].opcode,8);assert.equal(result[0].data.readUInt16BE(0),1008);
    c.socket.destroy();
  }finally{await env.stop();}
});
test('real TCP enforces a finite idle timeout and closes 1001',async()=>{
  const env=await setup({idleTimeoutMs:75});
  try{
    const c=await connect(env.port,request(env.port,env.origin));
    const result=await c.readFrames(1);
    assert.equal(result[0].opcode,8);assert.equal(result[0].data.readUInt16BE(0),1001);
    c.socket.destroy();
  }finally{await env.stop();}
});
test('real TCP rejects additional clients at connection quota with HTTP 503',async()=>{
  const env=await setup({maxConnections:1});
  try{
    const first=await connect(env.port,request(env.port,env.origin));
    assert.match(first.status,/101 Switching Protocols/);
    const second=await connect(env.port,request(env.port,env.origin));
    assert.match(second.status,/503 Rejected/);
    second.socket.destroy();first.socket.destroy();
  }finally{await env.stop();}
});
