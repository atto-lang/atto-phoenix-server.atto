// Real TCP/WebSocket regression: renderer output must be Unicode scalar values.
// This is a host-reference test, not proof of an AttoLang guest runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {LiveViewSession} from '../reference/liveview-core.mjs';
import {installReferenceGateway} from '../reference/ws-gateway.mjs';
import {encodeClientFrame} from '../reference/ws-wire.mjs';
import {validateTree} from '../web/liveview.mjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const csrf='valid-token-12345678';
const join={v:1,type:'join',session_id:'session',csrf,resume_rev:-1};
const event={v:1,type:'event',event_id:'aaaabbbb-1111',name:'increment',payload:{},base_rev:0};
async function environment(render){
  const server=http.createServer((_req,res)=>res.writeHead(404).end());
  await new Promise((resolve,reject)=>{
    server.once('error',reject);server.listen(0,'127.0.0.1',resolve);
  });
  const port=server.address().port,origin=`http://127.0.0.1:${port}`;
  const session=new LiveViewSession({viewId:'counter',sessionId:'session',csrfToken:csrf,origin,
    initialState:{count:0},render,reduce:s=>({count:s.count+1}),authorize:t=>t.user==='alice'&&t.origin===origin});
  const gateway=installReferenceGateway(server,{origins:new Set([origin]),hosts:new Set([`127.0.0.1:${port}`]),
    allowLoopbackCleartext:true,authenticate:()=>({id:'alice'}),getSession:()=>session});
  return {server,session,gateway,port,origin,async close(){gateway.close();await new Promise(resolve=>server.close(resolve));}};
}
async function connect(env){
  const socket=net.connect({host:'127.0.0.1',port:env.port});
  socket.setTimeout(2500,()=>socket.destroy());
  let pending=Buffer.alloc(0);
  socket.on('error',()=>{});
  socket.on('data',bytes=>{pending=Buffer.concat([pending,bytes]);});
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
  socket.write(['GET /live HTTP/1.1',`Host: 127.0.0.1:${env.port}`,'Upgrade: websocket',
    'Connection: Upgrade',`Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
    'Sec-WebSocket-Version: 13','Sec-WebSocket-Protocol: ores-liveview-v1',`Origin: ${env.origin}`,'',''].join('\r\n'));
  let upgraded=false;
  for(let i=0;i<250;i++) {
    const idx=pending.indexOf('\r\n\r\n');
    if(idx>=0){assert.match(pending.subarray(0,idx).toString(),/101 Switching Protocols/);
      pending=pending.subarray(idx+4);upgraded=true;break;}
    await pause(3);
  }
  assert.equal(upgraded,true,'missing upgrade response');
  const frames=[];
  const parse=()=>{
    let offset=0;
    while(pending.length-offset>=2){
      const sizeByte=pending[offset+1]&127;
      let length=sizeByte,header=2;
      if(sizeByte===126){if(pending.length-offset<4)break;length=pending.readUInt16BE(offset+2);header=4;}
      if(sizeByte===127){if(pending.length-offset<10)break;length=Number(pending.readBigUInt64BE(offset+2));header=10;}
      if(pending.length-offset<header+length)break;
      frames.push({opcode:pending[offset]&15,payload:Buffer.from(pending.subarray(offset+header,offset+header+length))});
      offset+=header+length;
    }
    pending=pending.subarray(offset);
  };
  return {socket,send:frame=>socket.write(encodeClientFrame(1,JSON.stringify(frame))),
    async take(count=1){for(let i=0;i<250;i++){parse();if(frames.length>=count)return frames.splice(0,count);await pause(3);}
      throw Error(`frame wait timed out: ${frames.length}/${count}`);},
    destroy(){socket.destroy();}};
}
const json=frames=>frames.map(frame=>JSON.parse(frame.payload.toString('utf8')));

for(const [name,renderer] of [
  ['malformed text',s=>[{tag:'span',id:'value',text:s.count?'bad\uD800':'initial'}]],
  ['malformed title attribute',s=>[{tag:'span',id:'value',attrs:{title:s.count?'bad\uDC00':'initial'},text:String(s.count)}]],
  ['malformed nested child',s=>[{tag:'div',id:'panel',children:[{tag:'span',id:'value',text:s.count?'\uDFFF':'initial'}]}]]
]){
  test(`real TCP: ${name} is rejected before actor state and replay commit`,async()=>{
    const env=await environment(renderer);let a,b;
    try{
      a=await connect(env);b=await connect(env);
      a.send(join);b.send(join);
      assert.deepEqual(json(await a.take(2)).map(x=>x.type),['snapshot','ready']);
      assert.deepEqual(json(await b.take(2)).map(x=>x.type),['snapshot','ready']);
      a.send(event);
      const rejected=await a.take();
      assert.equal(rejected[0].opcode,8,'malformed render must close only offending peer');
      assert.equal(rejected[0].payload.readUInt16BE(0),1008);
      assert.equal(env.session.revision,0);
      assert.equal(env.session.state.count,0);
      assert.equal(env.session.seen.size,0);
      b.send({v:1,type:'resync'});
      assert.deepEqual(json(await b.take(2)).map(x=>x.type),['snapshot','ready'],
        'an independent connected subscriber must survive another peer failure');
      assert.equal(env.session.revision,0);
    }finally{a?.destroy();b?.destroy();await env.close();}
  });
}

test('real TCP: valid non-BMP Unicode is preserved in actor patch and ACK',async()=>{
  const env=await environment(s=>[{tag:'span',id:'value',attrs:{title:s.count?'Earth 🌍':'initial'},text:s.count?'Hello 🌐':'initial'}]);
  let client;
  try{
    client=await connect(env);client.send(join);await client.take(2);
    client.send(event);
    const [update,ack]=json(await client.take(2));
    assert.equal(ack.type,'event_ack');
    // Atomic DOM semantics may require a full snapshot when structural and
    // attribute operations overlap; either form must preserve scalar text.
    if(update.type==='patch') {
      assert.ok(update.ops.some(x=>x.op==='set_text'&&x.text==='Hello 🌐'));
      assert.ok(update.ops.some(x=>x.op==='set_attr'&&x.value==='Earth 🌍'));
    } else {
      assert.equal(update.type,'snapshot');
      assert.equal(update.children[0].text,'Hello 🌐');
      assert.equal(update.children[0].attrs.title,'Earth 🌍');
    }
    assert.equal(env.session.revision,1);assert.equal(env.session.state.count,1);
  }finally{client?.destroy();await env.close();}
});

test('invalid Unicode in initial snapshot fails before a session can become active',()=>{
  for(const tree of [
    [{tag:'span',id:'one',text:'\uD800'}],
    [{tag:'span',id:'one',attrs:{title:'\uDC00'}}],
    [{tag:'div',id:'one',children:[{tag:'span',id:'two',text:'A\uD800B'}]}]
  ])assert.throws(()=>validateTree(tree,'https://example.test'),/Unicode|surrogate/);
});
