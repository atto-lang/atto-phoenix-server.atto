// Real network checks: a cookie-like authentication result without a valid
// stable principal identity must never become a WebSocket actor capability.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {installReferenceGateway} from '../reference/ws-gateway.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function environment(principal) {
  const server=http.createServer((req,res)=>res.writeHead(404).end());
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const port=server.address().port,origin=`http://127.0.0.1:${port}`;
  let sessions=0,attaches=0;
  const session={receive:()=>[],detach:()=>{},attach:()=>{attaches++;}};
  const gateway=installReferenceGateway(server,{origins:new Set([origin]),hosts:new Set([`127.0.0.1:${port}`]),
    allowLoopbackCleartext:true,authenticate:()=>principal,getSession:()=>{sessions++;return session;}});
  return {port,origin,gateway,get sessions(){return sessions;},get attaches(){return attaches;},async close(){gateway.close();await new Promise(r=>server.close(r));}};
}
async function attempt(env){
  const socket=net.connect({host:'127.0.0.1',port:env.port});
  let received='';socket.setTimeout(1500,()=>socket.destroy());
  socket.on('data',b=>{received+=b.toString('latin1');});
  try{
    await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
    socket.write([
      'GET /live HTTP/1.1',`Host: 127.0.0.1:${env.port}`,'Upgrade: websocket','Connection: Upgrade',
      `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Protocol: ores-liveview-v1',`Origin: ${env.origin}`,'Cookie: session=allow','',''
    ].join('\r\n'));
    for(let n=0;n<300&&!received.includes('\r\n\r\n');n++)await sleep(2);
    assert.match(received,/\r\n\r\n/,'HTTP upgrade response required');
    return received.split('\r\n')[0];
  }finally{socket.destroy();}
}

test('real TCP: an authentication object missing its user ID is refused before actor allocation',async()=>{
  const env=await environment({name:'alice'});try{
    assert.match(await attempt(env),/403 Rejected/);
    assert.equal(env.sessions,0);assert.equal(env.attaches,0);assert.equal(env.gateway.connections,0);
  }finally{await env.close();}
});
test('real TCP: numeric and empty user IDs cannot bind actor sessions',async()=>{
  for(const principal of [{id:42},{id:''}]) {
    const env=await environment(principal);try{
      assert.match(await attempt(env),/403 Rejected/);assert.equal(env.sessions,0);assert.equal(env.gateway.connections,0);
    }finally{await env.close();}
  }
});
test('real TCP: oversized authenticated user identity is rejected before session lookup',async()=>{
  const env=await environment({id:'a'.repeat(257)});try{
    assert.match(await attempt(env),/403 Rejected/);assert.equal(env.sessions,0);
  }finally{await env.close();}
});
test('real TCP: properly authenticated ID still upgrades and closes cleanly',async()=>{
  const env=await environment({id:'alice'});try{
    assert.match(await attempt(env),/101 Switching Protocols/);assert.equal(env.sessions,1);assert.equal(env.attaches,1);
    for(let n=0;n<100&&env.gateway.connections;n++)await sleep(2);
    assert.equal(env.gateway.connections,0);
  }finally{await env.close();}
});
