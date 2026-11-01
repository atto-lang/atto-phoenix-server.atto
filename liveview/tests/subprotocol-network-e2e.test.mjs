import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {installReferenceGateway} from '../reference/ws-gateway.mjs';
async function start(){
  const server=http.createServer((_req,res)=>{res.writeHead(404);res.end();});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  const gateway=installReferenceGateway(server,{
    origins:new Set(['http://127.0.0.1:'+port]),hosts:new Set(['127.0.0.1:'+port]),
    allowLoopbackCleartext:true,authenticate:()=>({id:'alice'}),
    getSession:()=>({attach(){},detach(){},receive(){return [];}})
  });
  return {port,gateway,async close(){gateway.close();await new Promise(resolve=>server.close(resolve));}};
}
async function upgrade(port,protocol){
  const socket=net.createConnection({host:'127.0.0.1',port});
  const response=await new Promise((resolve,reject)=>{
    let incoming='';
    const timer=setTimeout(()=>{socket.destroy();reject(new Error('handshake timeout'));},2000);
    socket.once('error',e=>{clearTimeout(timer);reject(e);});
    socket.on('data',d=>{incoming+=d.toString('latin1');
      if(incoming.includes('\r\n\r\n')){clearTimeout(timer);resolve(incoming.split('\r\n')[0]);}
    });
    socket.once('connect',()=>{
      const request='GET /live HTTP/1.1\r\nHost: 127.0.0.1:'+port+
        '\r\nOrigin: http://127.0.0.1:'+port+
        '\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: '+
        randomBytes(16).toString('base64')+
        '\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: '+protocol+'\r\n\r\n';
      socket.write(request);
    });
  });
  socket.destroy();
  return response;
}
test('TCP upgrade denies case-mismatched offered subprotocol',async()=>{
  const s=await start();try{assert.match(await upgrade(s.port,'ORES-LIVEVIEW-V1'),/400 Rejected/);
    assert.equal(s.gateway.connections,0);}finally{await s.close();}
});
test('TCP upgrade denies duplicate offered subprotocol',async()=>{
  const s=await start();try{assert.match(await upgrade(s.port,'ores-liveview-v1, ores-liveview-v1'),/400 Rejected/);
    assert.equal(s.gateway.connections,0);}finally{await s.close();}
});
test('TCP upgrade accepts one exact protocol among distinct offers and cleans up',async()=>{
  const s=await start();try{assert.match(await upgrade(s.port,'other, ores-liveview-v1'),/101 Switching Protocols/);
    for(let i=0;i<100&&s.gateway.connections;i++)await new Promise(r=>setTimeout(r,5));
    assert.equal(s.gateway.connections,0);}finally{await s.close();}
});
