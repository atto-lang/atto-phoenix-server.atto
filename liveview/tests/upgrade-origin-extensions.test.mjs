// Adversarial RFC6454 Origin and RFC6455 extension admission checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {validateUpgrade,installReferenceGateway} from '../reference/ws-gateway.mjs';

const origin='http://127.0.0.1:23456';
const headers=[
  ['Host','127.0.0.1:23456'],['Origin',origin],['Upgrade','websocket'],
  ['Connection','Upgrade'],['Sec-WebSocket-Version','13'],
  ['Sec-WebSocket-Key','dGhlIHNhbXBsZSBub25jZQ=='],
  ['Sec-WebSocket-Protocol','ores-liveview-v1']
];
const options={hosts:new Set(['127.0.0.1:23456']),origins:new Set([origin]),allowLoopbackCleartext:true};
function mock(extra=[],overrides={}) {
  const rawHeaders=[...headers,...extra].flat();
  const req={method:'GET',httpVersion:'1.1',url:'/live',
    socket:{encrypted:false,remoteAddress:'127.0.0.1'},rawHeaders,
    headers:Object.fromEntries([...headers,...extra].map(([k,v])=>[k.toLowerCase(),v]))};
  Object.assign(req.headers,overrides);return req;
}
const denies=req=>assert.throws(()=>validateUpgrade(req,options));

test('normal WebSocket upgrade with no extension header is accepted',()=>{
  assert.ok(validateUpgrade(mock(),options).accept);
});
test('empty WebSocket extension header is rejected rather than treated as absent',()=>{
  denies(mock([['Sec-WebSocket-Extensions','']]));
});
test('duplicate extension header is rejected, even when both values are empty',()=>{
  denies(mock([['Sec-WebSocket-Extensions',''],['Sec-WebSocket-Extensions','']]));
});
test('compression requests rejected independent of casing',()=>{
  for(const name of ['Sec-WebSocket-Extensions','sEc-WeBsOcKeT-ExTeNsIoNs'])
    denies(mock([[name,'permessage-deflate']]));
});
test('Origin must be the exact serialized origin, without extra URL components',()=>{
  for(const malformed of [origin+'/',origin+'/live',origin+'?token=1',origin+'/#fragment',
    'http://user@127.0.0.1:23456','http://user:pass@127.0.0.1:23456',
    'HTTP://127.0.0.1:23456','http://127.0.0.1:023456']) {
    const req=mock([],{'origin':malformed});req.rawHeaders[3]=malformed;
    // Explicitly allowlist the bad serialization: syntax must reject it
    // independently of the application's configured Origin policy.
    assert.throws(()=>validateUpgrade(req,{...options,origins:new Set([malformed])}));
  }
});

async function serverEnvironment() {
  const server=http.createServer((_req,res)=>res.writeHead(404).end());
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  const gateway=installReferenceGateway(server,{
    hosts:new Set([`127.0.0.1:${port}`]),origins:new Set([`http://127.0.0.1:${port}`]),
    allowLoopbackCleartext:true,authenticate:()=>({id:'alice'}),
    getSession:()=>({attach(){},detach(){},receive:()=>[]})});
  return {port,gateway,close:async()=>{gateway.close();await new Promise(resolve=>server.close(resolve));}};
}
async function attempt(port,extra=[]) {
  const socket=net.createConnection({host:'127.0.0.1',port});
  let response='';
  try {
    await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
    socket.write([
      'GET /live HTTP/1.1',`Host: 127.0.0.1:${port}`,`Origin: http://127.0.0.1:${port}`,
      'Upgrade: websocket','Connection: Upgrade',`Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
      'Sec-WebSocket-Version: 13','Sec-WebSocket-Protocol: ores-liveview-v1',...extra,'',''
    ].join('\r\n'));
    const first=await Promise.race([
      new Promise((resolve,reject)=>{socket.on('data',d=>{response+=d.toString('latin1');
        if(response.includes('\r\n\r\n'))resolve(response.split('\r\n')[0]);});socket.on('error',reject);}),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('no HTTP reply')),1500))]);
    return first;
  }finally{socket.destroy();}
}
test('real TCP: empty extensions offer receives rejection with no actor slot',async()=>{
  const e=await serverEnvironment();try{
    assert.match(await attempt(e.port,['Sec-WebSocket-Extensions:']),/400 Rejected/);
    assert.equal(e.gateway.connections,0);
  }finally{await e.close();}
});
test('real TCP: duplicate extension offers receive rejection with no actor slot',async()=>{
  const e=await serverEnvironment();try{
    assert.match(await attempt(e.port,['Sec-WebSocket-Extensions:','Sec-WebSocket-Extensions:']),/400 Rejected/);
    assert.equal(e.gateway.connections,0);
  }finally{await e.close();}
});
test('real TCP: ordinary non-extension offer still upgrades',async()=>{
  const e=await serverEnvironment();try{
    assert.match(await attempt(e.port),/101 Switching Protocols/);
  }finally{await e.close();}
});
