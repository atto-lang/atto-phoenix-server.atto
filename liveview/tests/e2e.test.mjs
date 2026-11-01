// Real loopback HTTP + RFC6455 wire + authenticated session E2E.
// The browser-automation suite is separate; this is Node transport evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {launchReferenceDemo} from '../reference/demo-server.mjs';
import {encodeClientFrame} from '../reference/ws-wire.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hello=(port,origin,cookie='',extra='')=>[
  'GET /live HTTP/1.1',`Host: 127.0.0.1:${port}`,'Upgrade: websocket','Connection: Upgrade',
  `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,'Sec-WebSocket-Version: 13',
  'Sec-WebSocket-Protocol: ores-liveview-v1',`Origin: ${origin}`,
  ...(cookie?[`Cookie: ${cookie}`]:[]),...(extra?[extra]:[]),'',''
].join('\r\n');
class WSClient {
  constructor(socket){this.socket=socket;this.chunks=Buffer.alloc(0);this.frames=[];this.status=null;
    socket.on('data',bytes=>{this.chunks=Buffer.concat([this.chunks,bytes]);this._parse();});
  }
  static async connect(port,request){
    const socket=net.connect({host:'127.0.0.1',port});
    const client=new WSClient(socket);
    await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
    socket.write(request);
    await client.wait(()=>client.status!==null,'handshake');return client;
  }
  _parse(){
    if(this.status===null){const idx=this.chunks.indexOf('\r\n\r\n');if(idx<0)return;
      this.status=this.chunks.subarray(0,idx+4).toString();this.chunks=this.chunks.subarray(idx+4);
    }
    if(!this.status.includes('101 Switching Protocols'))return;
    while(this.chunks.length>=2){const b=this.chunks[1],n=b&127;let len=n,h=2;
      if(n===126){if(this.chunks.length<4)return;len=this.chunks.readUInt16BE(2);h=4;}
      if(n===127){if(this.chunks.length<10)return;len=Number(this.chunks.readBigUInt64BE(2));h=10;}
      if(this.chunks.length<h+len)return;
      const opcode=this.chunks[0]&15,body=this.chunks.subarray(h,h+len);
      this.frames.push({opcode,data:Buffer.from(body),json:opcode===1?JSON.parse(body.toString()):null});
      this.chunks=this.chunks.subarray(h+len);
    }
  }
  async wait(condition,what){for(let i=0;i<250;i++){if(condition())return;await sleep(4);}throw Error('E2E deadline exceeded: '+what);}
  async take(n){await this.wait(()=>this.frames.length>=n,`frames ${n}, have ${this.frames.length}`);return this.frames.splice(0,n);}
  send(frame){this.socket.write(encodeClientFrame(1,JSON.stringify(frame)));}
  close(){this.socket.destroy();}
}
const join=(boot,resume_rev=-1)=>({v:1,type:'join',view_id:'counter',session_id:boot.session_id,csrf:boot.csrf,resume_rev});
const event=(id,base_rev,name='increment')=>({v:1,type:'event',event_id:id,name,payload:{},base_rev});
async function setup(){const server=await launchReferenceDemo();const page=await fetch(server.origin+'/');
  const cookie=page.headers.get('set-cookie').split(';')[0];
  const boot=await (await fetch(server.origin+'/bootstrap.json',{headers:{Cookie:cookie}})).json();
  return {server,cookie,boot};
}
test('E2E: actual demo upgrades, clicks, broadcasts, reconnects and prevents event replay',async()=>{
  const {server,cookie,boot}=await setup();const clients=[];
  const connect=async()=>{const c=await WSClient.connect(server.port,hello(server.port,server.origin,cookie));clients.push(c);assert.match(c.status,/101 Switching Protocols/);assert.match(c.status,/Sec-WebSocket-Protocol: ores-liveview-v1/);return c;};
  try{
    const a=await connect(),b=await connect();
    a.send(join(boot));b.send(join(boot));
    assert.deepEqual((await a.take(2)).map(x=>x.json.type),['snapshot','ready']);
    assert.deepEqual((await b.take(2)).map(x=>x.json.type),['snapshot','ready']);
    const id='12345678-aaaa-4111-8111-123456789abc';
    a.send(event(id,0));
    const one=(await a.take(2)).map(x=>x.json);
    assert.deepEqual(one.map(x=>x.type),['patch','event_ack']);assert.equal(one[0].rev,1);assert.equal(one[1].event_id,id);
    const subscribed=(await b.take(1))[0].json;
    assert.equal(subscribed.type,'patch');assert.equal(subscribed.rev,1);
    assert.equal(server.view.state.count,1);
    // Duplicate event replay across an authenticated reconnect must never mutate.
    a.close();const c=await connect();c.send(join(boot,0));
    assert.deepEqual((await c.take(2)).map(x=>x.json.type),['patch','ready']);
    c.send(event(id,0));
    assert.equal((await c.take(1))[0].json.type,'event_ack');
    assert.equal(server.view.state.count,1);
    b.send(event('87654321-bbbb-4111-8111-123456789abc',1));
    assert.deepEqual((await b.take(2)).map(x=>x.json.type),['patch','event_ack']);
    const broadcast=(await c.take(1))[0].json;assert.equal(broadcast.rev,2);assert.equal(server.view.state.count,2);
    // Fresh browser gets authoritative snapshot, not stale markup.
    const d=await connect();d.send(join(boot));assert.equal((await d.take(1))[0].json.rev,2);
  }finally{for(const c of clients)c.close();await server.close();}
});
test('E2E: authentication, Origin and CSRF are enforced on actual sockets',async()=>{
  const {server,cookie,boot}=await setup();const clients=[];
  try{
    for(const h of [hello(server.port,server.origin),hello(server.port,'http://evil.invalid',cookie),hello(server.port,server.origin,'ores_session=wrong')]){
      const c=await WSClient.connect(server.port,h);clients.push(c);assert.match(c.status,/HTTP\/1\.1 (400|403)/);
    }
    const c=await WSClient.connect(server.port,hello(server.port,server.origin,cookie));clients.push(c);
    assert.match(c.status,/101 Switching Protocols/);
    c.send({...join(boot),csrf:'bad-csrf-token-12345'});
    const response=await c.take(1);assert.equal(response[0].opcode,8);
    assert.equal(response[0].data.readUInt16BE(0),1008);
    assert.equal(server.view.revision,0);
  }finally{for(const c of clients)c.close();await server.close();}
});
test('E2E: session rejects stale revision without mutating, then resync recovers',async()=>{
  const {server,cookie,boot}=await setup();let c;
  try{
    c=await WSClient.connect(server.port,hello(server.port,server.origin,cookie));
    c.send(join(boot));await c.take(2);
    c.send(event('aaaaaaaa-1111-4111-8111-111111111111',0));await c.take(2);
    c.send(event('bbbbbbbb-2222-4222-8222-222222222222',0));
    assert.equal((await c.take(1))[0].json.type,'event_rejected');
    assert.equal(server.view.state.count,1);
    c.send({v:1,type:'resync',view_id:'counter',revision:0});
    const [snapshot,ready]=(await c.take(2)).map(x=>x.json);assert.equal(snapshot.rev,1);assert.equal(ready.rev,1);
  }finally{c?.close();await server.close();}
});
