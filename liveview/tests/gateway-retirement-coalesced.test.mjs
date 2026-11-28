// Actual loopback TCP/WebSocket exercise: coalesced frames must not escape
// a synchronous actor connection revocation in the middle of one data read.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {encodeClientFrame} from '../reference/ws-wire.mjs';
import {installReferenceGateway} from '../reference/ws-gateway.mjs';

async function run(shutdownOn=1,poisonousReply=false) {
  const server=http.createServer((_req,res)=>res.writeHead(404).end());
  await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
  const port=server.address().port;
  const host='127.0.0.1:'+port,origin='http://'+host;
  const seen=[],detached=[];
  let enumerated=0,gateway;
  const session={
    attach(){},
    detach(id){detached.push(id);},
    receive(frame,transport){
      seen.push({frame,id:transport.connectionId});
      if(seen.length===shutdownOn) {
        gateway.close();
        if(poisonousReply) return {
          [Symbol.iterator](){enumerated++;throw Error('retired output was visited');}
        };
      }
      return [];
    }
  };
  gateway=installReferenceGateway(server,{
    hosts:new Set([host]),origins:new Set([origin]),
    allowLoopbackCleartext:true,authenticate:()=>({id:'alice'}),getSession:()=>session
  });
  const sock=net.connect({host:'127.0.0.1',port});
  sock.setTimeout(3000,()=>sock.destroy());
  let headers='';
  const upgrade=new Promise((resolve,reject)=>{
    sock.once('error',reject);
    sock.on('data',chunk=>{
      headers+=chunk.toString('latin1');
      if(headers.includes('\r\n\r\n'))resolve(headers);
    });
  });
  try {
    await new Promise((resolve,reject)=>{
      sock.once('connect',resolve);sock.once('error',reject);
    });
    sock.write(['GET /live HTTP/1.1','Host: '+host,
      'Connection: Upgrade','Upgrade: websocket',
      'Sec-WebSocket-Key: '+randomBytes(16).toString('base64'),
      'Sec-WebSocket-Version: 13','Sec-WebSocket-Protocol: ores-liveview-v1',
      'Origin: '+origin,'',''].join('\r\n'));
    assert.match(await upgrade,/101 Switching Protocols/);
    sock.write(Buffer.concat([1,2,3].map(index=>
      encodeClientFrame(1,JSON.stringify({type:'event',index})))));
    for(let n=0;n<400 && gateway.connections;n++)
      await new Promise(resolve=>setTimeout(resolve,2));
    assert.equal(gateway.connections,0,'revocation must close connection');
    return {seen,detached,enumerated};
  } finally {
    sock.destroy();gateway.close();
    await new Promise(resolve=>server.close(resolve));
  }
}
test('real TCP: synchronous retirement fences remaining coalesced USER frames',async()=>{
  const r=await run(1);
  assert.deepEqual(r.seen.map(v=>v.frame.index),[1]);
  assert.equal(r.detached.length,1);
  assert.equal(r.detached[0],r.seen[0].id);
});
test('real TCP: no retired output can be enumerated',async()=>{
  const r=await run(1,true);
  assert.equal(r.seen.length,1);
  assert.equal(r.enumerated,0);
  assert.equal(r.detached.length,1);
});
test('real TCP: shutdown on the second message drops only the batch suffix',async()=>{
  const r=await run(2);
  assert.deepEqual(r.seen.map(v=>v.frame.index),[1,2]);
  assert.equal(r.detached.length,1);
});
