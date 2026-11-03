// Run against a real HTTP/1.1 upgrade and masked WebSocket client frames.
// The actor is not allowed to rewrite the gateway's authenticated principal,
// connection identity, or request origin for later events on that socket.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {encodeClientFrame} from '../reference/ws-wire.mjs';
import {installReferenceGateway} from '../reference/ws-gateway.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function open({onReceive}={}) {
  const server=http.createServer((_req,res)=>res.writeHead(404).end());
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port,origin=`http://127.0.0.1:${port}`;
  const seen=[],detached=[];
  const session={attach(){},detach:id=>detached.push(id),receive(frame,transport){
    seen.push({frame,transport,user:transport.user,origin:transport.origin,id:transport.connectionId});
    onReceive?.(frame,transport);return [];
  }};
  const gateway=installReferenceGateway(server,{
    hosts:new Set([`127.0.0.1:${port}`]),origins:new Set([origin]),allowLoopbackCleartext:true,
    authenticate:()=>({id:'alice'}),getSession:()=>session});
  const socket=net.connect({host:'127.0.0.1',port});
  let response='';socket.setTimeout(2000,()=>socket.destroy());
  socket.on('data',chunk=>{response+=chunk.toString('latin1');});
  const cleanup=async()=>{socket.destroy();gateway.close();await new Promise(resolve=>server.close(resolve));};
  try {
    await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
    socket.write(['GET /live HTTP/1.1',`Host: 127.0.0.1:${port}`,'Upgrade: websocket','Connection: Upgrade',
      `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Protocol: ores-liveview-v1',`Origin: ${origin}`,'',''].join('\r\n'));
    for(let n=0;n<400&&!response.includes('\r\n\r\n');n++)await sleep(2);
    assert.match(response,/101 Switching Protocols/);
    return {socket,seen,detached,origin,gateway,cleanup};
  }catch(e){await cleanup();throw e;}
}
async function deliver(env,frame={type:'event'}) {
  const count=env.seen.length;
  env.socket.write(encodeClientFrame(1,JSON.stringify(frame)));
  for(let n=0;n<400&&env.seen.length===count;n++)await sleep(2);
  assert.equal(env.seen.length,count+1,'WebSocket actor must receive exactly one frame');
}

test('real TCP: reducer cannot mutate authenticated transport identity for later events',async()=>{
  let successfulMutations=null;
  const env=await open({onReceive:(_frame,transport)=>{
    if(successfulMutations!==null)return;
    successfulMutations=['user','origin','connectionId'].map(key=>Reflect.set(transport,key,'mallory'));
  }});
  try {
    await deliver(env,{type:'join'});
    await deliver(env,{type:'event'});
    assert.deepEqual(successfulMutations,[false,false,false]);
    assert.equal(env.seen.length,2);
    assert.equal(env.seen[0].transport,env.seen[1].transport);
    assert.equal(env.seen[0].user,'alice');assert.equal(env.seen[1].user,'alice');
    assert.equal(env.seen[1].origin,env.origin);
    assert.equal(env.seen[0].id,env.seen[1].id);
    const originalId=env.seen[0].id;
    await env.cleanup();
    assert.deepEqual(env.detached,[originalId], 'detach must use original authenticated connection');
  }finally{await env.cleanup();}
});

test('real TCP: forged getter or setter cannot be installed on transport capability',async()=>{
  let descriptorResult=true,deleteResult=true;
  const env=await open({onReceive:(_frame,transport)=>{
    descriptorResult=Reflect.defineProperty(transport,'user',{get(){return 'mallory'}});
    deleteResult=Reflect.deleteProperty(transport,'origin');
  }});
  try {
    await deliver(env);
    assert.equal(descriptorResult,false);
    assert.equal(deleteResult,false);
    assert.equal(env.seen[0].transport.user,'alice');
    assert.equal(env.seen[0].transport.origin,env.origin);
  }finally{await env.cleanup();}
});


test('real TCP: each connection owns an independent immutable transport authority',async()=>{
  const a=await open(),b=await open();
  try {
    await deliver(a);await deliver(b);
    assert.equal(Object.isFrozen(a.seen[0].transport),true);
    assert.equal(Object.isFrozen(b.seen[0].transport),true);
    assert.notEqual(a.seen[0].transport,b.seen[0].transport);
    assert.notEqual(a.seen[0].id,b.seen[0].id);
    assert.equal(a.seen[0].user,b.seen[0].user);
  }finally{await a.cleanup();await b.cleanup();}
});

test('real TCP: assigning forged privilege fields throws and does not change the next frame',async()=>{
  let mutations=0;
  const env=await open({onReceive:(_frame,transport)=>{
    try {Object.assign(transport,{user:'admin',origin:'https://evil.test',connectionId:'hijacked'});}catch(e){
      assert(e instanceof TypeError);mutations++;
    }
  }});
  try {
    await deliver(env);await deliver(env);
    assert.equal(mutations,2);
    assert.deepEqual(env.seen.map(x=>x.user),['alice','alice']);
    assert.deepEqual(env.seen.map(x=>x.origin),[env.origin,env.origin]);
    assert.equal(env.seen[0].id,env.seen[1].id);
    assert.equal(env.gateway.connections,1);
  }finally{await env.cleanup();}
});
