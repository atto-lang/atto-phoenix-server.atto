// Real loopback TCP/WebSocket adversarial tests. Host reference only.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {installReferenceGateway} from '../reference/ws-gateway.mjs';
import {LiveViewSession} from '../reference/liveview-core.mjs';
import {encodeClientFrame,encodeServerFrame,ClientFrameParser,WireError} from '../reference/ws-wire.mjs';
import {applyPatch,validateTree,OresLiveView} from '../web/liveview.mjs';

const delay=ms=>new Promise(r=>setTimeout(r,ms));
const id=n=>n.toString(16).padStart(8,'0')+'-cafe';
const join=(rev=-1)=>({v:1,type:'join',view_id:'counter',session_id:'session',csrf:'valid-token-12345678',resume_rev:rev});
const event=(n,rev)=>({v:1,type:'event',event_id:id(n),base_rev:rev,name:'increment',payload:{}});

async function makeEnv(options={}) {
  const server=http.createServer((_req,res)=>res.writeHead(404).end());
  await new Promise((res,rej)=>{server.once('error',rej);server.listen(0,'127.0.0.1',res);});
  const port=server.address().port,origin=`http://127.0.0.1:${port}`;
  const session=new LiveViewSession({viewId:'counter',sessionId:'session',csrfToken:'valid-token-12345678',origin,
    initialState:{count:0},render:s=>[{tag:'span',id:'value',text:String(s.count)}],reduce:s=>({count:s.count+1}),
    authorize:t=>t.user==='alice'&&t.origin===origin});
  const gateway=installReferenceGateway(server,{hosts:new Set([`127.0.0.1:${port}`]),origins:new Set([origin]),allowLoopbackCleartext:true,
    authenticate:req=>req.headers.cookie==='session=allow'?{id:'alice'}:null,getSession:()=>session,...options});
  return {port,origin,gateway,session,async stop(){gateway.close();await new Promise(res=>server.close(res));}};
}
function upgrade(env,extra='',overrides={}) {
  const key=randomBytes(16).toString('base64');
  const base={Host:`127.0.0.1:${env.port}`,Upgrade:'websocket',Connection:'Upgrade','Sec-WebSocket-Key':key,
    'Sec-WebSocket-Version':'13','Sec-WebSocket-Protocol':'ores-liveview-v1',Origin:env.origin,Cookie:'session=allow',...overrides};
  return 'GET /live HTTP/1.1\r\n'+Object.entries(base).filter(([,v])=>v!==undefined).map(([k,v])=>`${k}: ${v}\r\n`).join('')+extra+'\r\n';
}
async function connect(env,request=upgrade(env)) {
  const socket=net.createConnection({host:'127.0.0.1',port:env.port});
  socket.setTimeout(3000,()=>socket.destroy(new Error('test timeout')));
  let buffer=Buffer.alloc(0),head=null;
  socket.on('data',data=>{buffer=Buffer.concat([buffer,data]);});
  try {
    await new Promise((res,rej)=>{socket.once('connect',res);socket.once('error',rej);});
    socket.write(request);
    for(let i=0;i<250;i++) {const offset=buffer.indexOf('\r\n\r\n');if(offset>=0){head=buffer.subarray(0,offset+4).toString();buffer=buffer.subarray(offset+4);break;}await delay(3);}
    assert(head!==null,'upgrade HTTP response missing');
    return {socket,head,send:(frame)=>socket.write(encodeClientFrame(1,JSON.stringify(frame))),
      async frames(count=1){const out=[];for(let t=0;t<250;t++){
        let offset=0;
        while(buffer.length-offset>=2){const size=buffer[offset+1]&127;let width=2,length=size;
          if(size===126){if(buffer.length-offset<4)break;length=buffer.readUInt16BE(offset+2);width=4;}
          else if(size===127){if(buffer.length-offset<10)break;length=Number(buffer.readBigUInt64BE(offset+2));width=10;}
          if(buffer.length-offset<width+length)break;
          out.push({opcode:buffer[offset]&15,payload:Buffer.from(buffer.subarray(offset+width,offset+width+length))});offset+=width+length;
        }
        buffer=buffer.subarray(offset);if(out.length>=count)return out;
        await delay(4);
      }throw Error(`frames timeout ${out.length}/${count}`);}};
  }catch(e){socket.destroy();throw e;}
}
const closeCode=frames=>{assert.equal(frames[0].opcode,8);return frames[0].payload.readUInt16BE(0);};
const json=frames=>frames.map(f=>JSON.parse(f.payload.toString()));

// Unit-level boundaries for transport frames, DOM operations and actor revisions.
test('server-close encoder refuses one-byte close code',()=>assert.throws(()=>encodeServerFrame(8,Buffer.from([3])),WireError));
test('server-close encoder refuses reserved status and invalid UTF-8 reason',()=>{
  for(const body of [Buffer.from([0x03,0xee]),Buffer.from([0x03,0xe8,0xc3])])
    assert.throws(()=>encodeServerFrame(8,body),WireError);
});
test('server-close encoder accepts valid close and reason',()=>{
  const payload=Buffer.from([3,232,...Buffer.from('bye')]);assert.equal(encodeServerFrame(8,payload)[0],0x88);
});
test('binary WebSocket frame is rejected from its header before buffering data',()=>{
  const header=encodeClientFrame(2,Buffer.alloc(100)).subarray(0,2);
  assert.throws(()=>new ClientFrameParser().feed(header),e=>e.closeCode===1003);
});
test('binary fragmented message is rejected at its first header',()=>{
  const header=encodeClientFrame(2,Buffer.alloc(100),{fin:false}).subarray(0,2);
  assert.throws(()=>new ClientFrameParser().feed(header),e=>e.closeCode===1003);
});
test('rendered void elements cannot contain text or children',()=>{
  for(const tag of ['input','img','br','hr']) {
    assert.throws(()=>validateTree([{tag,id:'inputtest',text:'invalid'}],'http://example.test'),/void elements/);
    assert.throws(()=>validateTree([{tag,id:'inputtest',children:[{tag:'span',id:'child'}]}],'http://example.test'),/void elements/);
    assert.equal(validateTree([{tag,id:'inputtest'}],'http://example.test'),true);
  }
});
test('revision overflow refuses the event without state commit',()=>{
  const origin='http://example.test';const s=new LiveViewSession({viewId:'counter',sessionId:'session',csrfToken:'valid-token-12345678',origin,
    initialState:{count:0},render:state=>[{tag:'span',id:'value',text:String(state.count)}],reduce:state=>({count:state.count+1}),authorize:()=>true});
  s.receive(join(),{connectionId:'one',user:'alice',origin});s.revision=Number.MAX_SAFE_INTEGER;
  assert.throws(()=>s.receive(event(1,Number.MAX_SAFE_INTEGER),{connectionId:'one',user:'alice',origin}),/revision exhausted/);
  assert.equal(s.state.count,0);assert.equal(s.revision,Number.MAX_SAFE_INTEGER);
});
test('invalid gateway control budgets are rejected at installation',async()=>{
  const env=await makeEnv();try{
    for(const invalid of [{maxControlFramesPerWindow:0},{controlWindowMs:-1},{maxControlFramesPerWindow:1.5}])
      assert.throws(()=>installReferenceGateway(http.createServer(),{authenticate:()=>true,getSession:()=>env.session,...invalid}),RangeError);
  }finally{await env.stop();}
});

// Network-level independent checks: actual HTTP Upgrade and masked RFC 6455 frames.
test('real TCP rejects unsolicited pong flood with 1008 and cleans actor subscription',async()=>{
  const env=await makeEnv({maxControlFramesPerWindow:4,controlWindowMs:10000});try{
    const a=await connect(env);assert.match(a.head,/101 Switching Protocols/);
    a.socket.write(Buffer.concat(Array.from({length:5},()=>encodeClientFrame(10,'pong'))));
    assert.equal(closeCode(await a.frames()),1008);
    await delay(10);assert.equal(env.gateway.connections,0);assert.equal(env.session.subscribers.size,0);a.socket.destroy();
  }finally{await env.stop();}
});
test('real TCP ping receives matching pong payload without ending session',async()=>{
  const env=await makeEnv();try{
    const a=await connect(env);
    const payload=Buffer.from([0,1,255,100]);a.socket.write(encodeClientFrame(9,payload));
    const out=await a.frames();assert.equal(out[0].opcode,10);assert.deepEqual(out[0].payload,payload);
    assert.equal(env.gateway.connections,1);a.socket.destroy();
  }finally{await env.stop();}
});
test('real TCP rejects a fragmented binary header without accepting 64KiB of attacker data',async()=>{
  const env=await makeEnv();try{
    const a=await connect(env);a.socket.write(encodeClientFrame(2,Buffer.alloc(5000),{fin:false}).subarray(0,2));
    assert.equal(closeCode(await a.frames()),1003);a.socket.destroy();
  }finally{await env.stop();}
});
test('real TCP malformed close code is rejected 1002',async()=>{
  const env=await makeEnv();try{
    const a=await connect(env);a.socket.write(encodeClientFrame(8,Buffer.from([3,238])));
    assert.equal(closeCode(await a.frames()),1002);a.socket.destroy();
  }finally{await env.stop();}
});
test('real TCP invalid JSON returns 1007 and permits fresh session',async()=>{
  const env=await makeEnv();try{
    const a=await connect(env);a.socket.write(encodeClientFrame(1,'{broken'));
    assert.equal(closeCode(await a.frames()),1007);a.socket.destroy();
    const b=await connect(env);assert.match(b.head,/101 Switching Protocols/);b.socket.destroy();
  }finally{await env.stop();}
});
test('real TCP explicitly rejects extension negotiation, then accepts uncompressed connection',async()=>{
  const env=await makeEnv();try{
    const a=await connect(env,upgrade(env,'Sec-WebSocket-Extensions: permessage-deflate\r\n'));
    assert.match(a.head,/400 Rejected/);a.socket.destroy();
    const b=await connect(env);assert.match(b.head,/101 Switching Protocols/);b.socket.destroy();
  }finally{await env.stop();}
});
test('real TCP slow-write budget closes 1013 without committing a view event',async()=>{
  const env=await makeEnv({maxPendingBytes:40});try{
    const a=await connect(env);a.send(join());assert.equal(closeCode(await a.frames()),1013);
    assert.equal(env.session.state.count,0);a.socket.destroy();
  }finally{await env.stop();}
});
test('real TCP command replay with mismatched payload is rejected and cannot mutate state',async()=>{
  const env=await makeEnv();try{
    const a=await connect(env);a.send(join());assert.deepEqual(json(await a.frames(2)).map(x=>x.type),['snapshot','ready']);
    a.send(event(1,0));assert.deepEqual(json(await a.frames(2)).map(x=>x.type),['patch','event_ack']);
    a.send({...event(1,0),payload:{forged:'different'}});
    assert.equal(closeCode(await a.frames()),1008);
    assert.equal(env.session.state.count,1);assert.equal(env.session.revision,1);a.socket.destroy();
  }finally{await env.stop();}
});
test('real TCP one client control flood does not disconnect another subscriber',async()=>{
  const env=await makeEnv({maxControlFramesPerWindow:3,controlWindowMs:10000});try{
    const a=await connect(env),b=await connect(env);a.send(join());b.send(join());await a.frames(2);await b.frames(2);
    a.socket.write(Buffer.concat(Array.from({length:4},()=>encodeClientFrame(10))));
    assert.equal(closeCode(await a.frames()),1008);
    b.send(event(2,0));assert.deepEqual(json(await b.frames(2)).map(x=>x.type),['patch','event_ack']);
    assert.equal(env.session.state.count,1);a.socket.destroy();b.socket.destroy();
  }finally{await env.stop();}
});
test('real TCP repeated disconnect/reconnect leaves no subscribers or socket slots',async()=>{
  const env=await makeEnv({maxConnections:1});try{
    for(let n=0;n<12;n++){
      const c=await connect(env);c.send(join());await c.frames(2);
      c.socket.write(encodeClientFrame(8,Buffer.from([3,232])));assert.equal(closeCode(await c.frames()),1000);
      c.socket.destroy();
      for(let retry=0;retry<100&&env.gateway.connections;retry++)await delay(2);
      assert.equal(env.gateway.connections,0,`leaked gateway slot on cycle ${n}`);
      assert.equal(env.session.subscribers.size,0,`leaked subscription on cycle ${n}`);
      assert.equal(env.session.joined.size,0,`leaked joined session on cycle ${n}`);
    }
  }finally{await env.stop();}
});

// Cross-runtime event dedup must not depend on JSON object member order.
test('real TCP same replay ID with reordered nested JSON receives ACK but does not double-commit',async()=>{
  const env=await makeEnv();try{
    const a=await connect(env);a.send(join());await a.frames(2);
    a.send({...event(31,0),payload:{z:1,nested:{omega:3,alpha:2}}});
    assert.deepEqual(json(await a.frames(2)).map(x=>x.type),['patch','event_ack']);
    a.send({...event(31,0),payload:{nested:{alpha:2,omega:3},z:1}});
    assert.deepEqual(json(await a.frames(1)).map(x=>x.type),['event_ack']);
    assert.equal(env.session.revision,1);assert.equal(env.session.state.count,1);
    a.socket.destroy();
  }finally{await env.stop();}
});
test('real TCP rejects nonportable JSON payload without committing actor revision',async()=>{
  const env=await makeEnv();try{
    const a=await connect(env);a.send(join());await a.frames(2);
    a.send({...event(40,0),payload:{text:'\uD800'}});
    assert.equal(closeCode(await a.frames()),1008);
    assert.equal(env.session.revision,0);assert.equal(env.session.state.count,0);
    a.socket.destroy();
  }finally{await env.stop();}
});
