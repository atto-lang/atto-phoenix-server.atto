// First-party AttoLang LiveView is same-origin. Independently allowlisted
// Hosts and Origins must not create an unintended cross-tenant trust matrix.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {validateUpgrade,installReferenceGateway} from '../reference/ws-gateway.mjs';

async function fixture({alternatePort=false}={}) {
  const server=http.createServer((_req,res)=>{res.writeHead(404).end();});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  const hostA=`127.0.0.1:${port}`,hostB=`localhost:${port}`;
  let authentications=0,lookups=0,attaches=0,detaches=0;
  const gateway=installReferenceGateway(server,{
    hosts:new Set([hostA,hostB]),
    origins:new Set([`http://${hostA}`,`http://${hostB}`, ...(alternatePort?[`http://127.0.0.1:${port===65535?port-1:port+1}`]:[])]),
    allowLoopbackCleartext:true,
    authenticate:()=>{authentications++;return {id:'alice'};},
    getSession:()=>{lookups++;return {receive:()=>[],attach(){attaches++;},detach(){detaches++;}};}
  });
  return {port,hostA,hostB,gateway,
    counters:()=>({authentications,lookups,attaches,detaches}),
    async close(){gateway.close();await new Promise(resolve=>server.close(resolve));}
  };
}
async function handshake(env,host,origin){
  const socket=net.connect(env.port,'127.0.0.1');
  let response='';
  try {
    await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
    const lines=['GET /live HTTP/1.1',`Host: ${host}`,`Origin: ${origin}`,
      'Upgrade: websocket','Connection: Upgrade',`Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
      'Sec-WebSocket-Version: 13','Sec-WebSocket-Protocol: ores-liveview-v1','',''];
    const replied=new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('WebSocket upgrade timed out')),1500);
      socket.on('data',chunk=>{
        response+=chunk.toString('latin1');
        if(response.includes('\r\n\r\n')){clearTimeout(timeout);resolve(response.split('\r\n')[0]);}
      });
      socket.once('error',error=>{clearTimeout(timeout);reject(error);});
      socket.once('close',()=>{if(!response.includes('\r\n\r\n')){clearTimeout(timeout);reject(new Error('WebSocket upgrade ended without reply'));}});
    });
    socket.write(lines.join('\r\n'));
    return await replied;
  } finally {socket.destroy();}
}

test('real TCP: origin of another allowlisted tenant cannot upgrade before authentication',async()=>{
  const env=await fixture();
  try {
    assert.match(await handshake(env,env.hostA,`http://${env.hostB}`),/400 Rejected/);
    assert.deepEqual(env.counters(),{authentications:0,lookups:0,attaches:0,detaches:0});
    assert.equal(env.gateway.connections,0);
  } finally {await env.close();}
});
test('real TCP: opposite allowlisted tenant mismatch also rejected',async()=>{
  const env=await fixture();
  try {
    assert.match(await handshake(env,env.hostB,`http://${env.hostA}`),/400 Rejected/);
    assert.equal(env.counters().lookups,0);
  } finally {await env.close();}
});
test('real TCP: matching allowlisted Host and Origin still upgrade and detach',async()=>{
  const env=await fixture();
  try {
    assert.match(await handshake(env,env.hostA,`http://${env.hostA}`),/101 Switching Protocols/);
    for(let i=0;i<100&&env.gateway.connections;i++)await new Promise(r=>setTimeout(r,2));
    assert.equal(env.gateway.connections,0);
    assert.deepEqual(env.counters(),{authentications:1,lookups:1,attaches:1,detaches:1});
  } finally {await env.close();}
});
test('real TCP: matching second tenant still upgrades with no cross-tenant policy regression',async()=>{
  const env=await fixture();
  try {
    assert.match(await handshake(env,env.hostB,`http://${env.hostB}`),/101 Switching Protocols/);
    assert.equal(env.counters().attaches,1);
  } finally {await env.close();}
});
test('real TCP: separately allowlisted Origin port cannot cross a tenant authority boundary',async()=>{
  const env=await fixture({alternatePort:true});
  try {
    const other=env.port===65535?env.port-1:env.port+1;
    assert.match(await handshake(env,env.hostA,`http://127.0.0.1:${other}`),/400 Rejected/);
    assert.equal(env.counters().authentications,0);
    assert.equal(env.gateway.connections,0);
  } finally {await env.close();}
});
test('unit: same-origin canonical HTTPS and IPv6 authorities retain valid upgrades',()=>{
  const req=(host,origin)=>({method:'GET',httpVersion:'1.1',url:'/live',
    socket:{encrypted:true,remoteAddress:'::1'},
    rawHeaders:['Host',host,'Origin',origin,'Upgrade','websocket','Connection','Upgrade',
      'Sec-WebSocket-Version','13','Sec-WebSocket-Key','dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Protocol','ores-liveview-v1'],
    headers:{host,origin,upgrade:'websocket',connection:'Upgrade','sec-websocket-version':'13',
      'sec-websocket-key':'dGhlIHNhbXBsZSBub25jZQ==','sec-websocket-protocol':'ores-liveview-v1'}});
  for(const [host,origin] of [['tenant.example','https://tenant.example'],['[::1]','https://[::1]']]){
    const options={hosts:new Set([host]),origins:new Set([origin])};
    assert.equal(typeof validateUpgrade(req(host,origin),options).accept,'string');
  }
});
