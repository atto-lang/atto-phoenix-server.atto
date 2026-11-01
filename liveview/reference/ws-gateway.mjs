// Network-executable host reference ONLY. NOT an Oreslang-native WS runtime.
import {createHash,randomUUID} from 'node:crypto';
import {ClientFrameParser,encodeServerFrame,WireError,WS_MAX_MESSAGE} from './ws-wire.mjs';
const MAGIC='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const fail=(msg)=>{throw new Error('ORES_WS_UPGRADE: '+msg)};
const tokenList=v=>v.toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
// Protocol offers are case-sensitive RFC 6455 HTTP tokens; unlike Connection
// header values, they must not be case-folded. Duplicates are invalid.
const websocketProtocols=value=>{
  if(typeof value!=='string')fail('missing WebSocket protocol');
  const offers=value.split(',').map(v=>v.trim());
  const token=/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
  if(offers.some(v=>!token.test(v))||new Set(offers).size!==offers.length)
    fail('invalid WebSocket protocol offers');
  return offers;
};
const unique = req => {
  const count=new Map();
  for(let i=0;i<req.rawHeaders.length;i+=2){const key=req.rawHeaders[i].toLowerCase();count.set(key,(count.get(key)||0)+1);}
  for(const name of ['origin','host','sec-websocket-key','sec-websocket-version','sec-websocket-protocol','upgrade','connection','cookie','content-length','transfer-encoding'])
    if((count.get(name)||0)>1)fail('duplicate security-sensitive header');
};
const onLoopback = socket=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(socket.remoteAddress);
export function validateUpgrade(req,{origins,hosts,allowLoopbackCleartext=false,maxHeaderBytes=8192}={}) {
  if(req.method!=='GET'||req.httpVersion!=='1.1')fail('method or HTTP version');
  if(req.url!=='/live')fail('wrong path');
  const headerBytes=req.rawHeaders.reduce((sum,s)=>sum+Buffer.byteLength(s)+4,0);
  if(headerBytes>maxHeaderBytes)fail('oversized headers');
  unique(req);
  const h=req.headers;
  if(h['content-length']!==undefined||h['transfer-encoding']!==undefined)fail('body framing on upgrade');
  if(!hosts?.has(h.host))fail('unknown Host');
  if(!origins?.has(h.origin))fail('untrusted Origin');
  const url=new URL(h.origin);
  if(url.protocol!=='https:' && !(allowLoopbackCleartext && url.protocol==='http:' && onLoopback(req.socket)))fail('TLS required');
  if(!req.socket.encrypted && !(allowLoopbackCleartext && onLoopback(req.socket)))fail('insecure transport');
  if(!tokenList(h.connection||'').includes('upgrade') || (h.upgrade||'').toLowerCase()!=='websocket')fail('invalid Upgrade');
  if(h['sec-websocket-version']!=='13')fail('unsupported WebSocket version');
  if(h['sec-websocket-extensions'])fail('extensions disabled');
  const key=h['sec-websocket-key'];
  if(typeof key!=='string'||!/^[A-Za-z0-9+/]{22}==$/.test(key)||(Buffer.from(key,'base64').length!==16||Buffer.from(key,'base64').toString('base64')!==key))fail('invalid WebSocket key');
  if(!websocketProtocols(h['sec-websocket-protocol']).includes('ores-liveview-v1'))fail('missing protocol');
  return {accept:createHash('sha1').update(key+MAGIC).digest('base64'),origin:h.origin};
}
export function installReferenceGateway(server,{origins,hosts,authenticate,getSession,maxConnections=32,maxPendingBytes=131072,maxMessagesPerWindow=128,messageWindowMs=10000,maxControlFramesPerWindow=32,controlWindowMs=1000,idleTimeoutMs=60000,maxMessageAgeMs=15000,allowLoopbackCleartext=false}={}) {
  if(typeof authenticate!=='function'||typeof getSession!=='function')throw new TypeError('explicit session authentication and lookup required');
  for(const [name,value] of Object.entries({maxConnections,maxPendingBytes,maxMessagesPerWindow,messageWindowMs,maxControlFramesPerWindow,controlWindowMs,idleTimeoutMs,maxMessageAgeMs})) {
    if(!Number.isSafeInteger(value)||value<1)throw new RangeError('invalid transport limit: '+name);
  }
  const sockets=new Map(); // socket -> idempotent detach callback
  const faultCounts={attach:0,detach:0,output:0};
  const reject=(socket,code=403)=>{
    if(!socket.destroyed){socket.end(`HTTP/1.1 ${code} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);}
  };
  const onUpgrade=(req,socket,head)=>{
    let approval;
    try {approval=validateUpgrade(req,{origins,hosts,allowLoopbackCleartext});}catch{reject(socket,400);return;}
    if(sockets.size>=maxConnections){reject(socket,503);return;}
    let principal,session;
    try {principal=authenticate(req);if(!principal || typeof principal.id!=='string' || principal.id.length<1 || principal.id.length>256)throw Error('unauthorized principal');session=getSession(principal);if(!session || typeof session.receive!=='function'||typeof session.detach!=='function')throw Error('session missing');}
    catch {reject(socket,403);return;}
    const connectionId=randomUUID();
    const transport={connectionId,origin:approval.origin,user:principal.id};
    const parser=new ClientFrameParser({maxMessage:WS_MAX_MESSAGE,maxMessageAgeMs});
    let finished=false,pings=0,lastPing=0,controls=0,controlWindowStart=Date.now(),messages=0,windowStart=Date.now();
    // The parser checks elapsed time on feed(), but a silent peer does not
    // generate another feed(). Enforce the same absolute deadline with an
    // independent timer, not the more permissive socket idle timeout.
    let assemblyTimer=null;
    const clearAssemblyTimer=()=>{if(assemblyTimer!==null){clearTimeout(assemblyTimer);assemblyTimer=null;}};
    const cleanup=()=>{
      if(finished)return;
      clearAssemblyTimer();
      finished=true;sockets.delete(socket);
      // A buggy actor teardown must not escape the transport's close event and
      // take down other WebSocket sessions or the Node reference process.
      try {session.detach(connectionId);} catch {faultCounts.detach++;}
    };
    socket.on('close',cleanup);socket.on('error',cleanup);
    socket.on('end',()=>{cleanup();socket.destroy();});
    const write=(buf)=>{
      if(finished||socket.destroyed)return false;
      if(buf.length+socket.writableLength>maxPendingBytes){shutdown(1013,'backpressure');return false;}
      socket.write(buf);return true;
    };
    const shutdown=(code,reason='')=>{
      if(finished||socket.destroyed)return;
      const payload=Buffer.alloc(2+Buffer.byteLength(reason));payload.writeUInt16BE(code,0);payload.write(reason,2);
      try {socket.end(encodeServerFrame(8,payload));}
      catch {socket.destroy();}
      finally {cleanup();}
    };
    const syncAssemblyTimer=()=>{
      clearAssemblyTimer();
      if(finished || parser.messageStartedAt===null)return;
      const remaining=maxMessageAgeMs-(performance.now()-parser.messageStartedAt);
      // A frame may complete exactly on its deadline; tolerate that in the
      // feed parser but never let an incomplete message persist indefinitely.
      assemblyTimer=setTimeout(()=>{
        assemblyTimer=null;
        if(!finished && parser.messageStartedAt!==null)
          shutdown(1008,'message assembly deadline');
      },Math.max(1,Math.ceil(remaining)+1));
      assemblyTimer.unref?.();
    };
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+approval.accept+'\r\nSec-WebSocket-Protocol: ores-liveview-v1\r\n\r\n');
    sockets.set(socket,cleanup);
    socket.setTimeout(idleTimeoutMs,()=>shutdown(1001,'idle timeout'));
    try {
      if(typeof session.attach==='function')session.attach(connectionId,(reply)=>{
        if(finished)return;
        try {
          const bytes=Buffer.from(JSON.stringify(reply));
          if(bytes.length>WS_MAX_MESSAGE){shutdown(1009,'frame too large');return;}
          write(encodeServerFrame(1,bytes));
        } catch {faultCounts.output++;shutdown(1011,'invalid session output');}
      });
    } catch {faultCounts.attach++;shutdown(1011,'session attach failed');return;}
    const receive=(data)=>{
      if(finished)return;
      try {
        for(const message of parser.feed(data)) {
          if(message.type==='close'){shutdown(1000);return;}
          if(message.type==='ping'||message.type==='pong') {
            // Both solicited and unsolicited control frames consume parsing and
            // scheduling work. Apply a shared quota in addition to ping pacing.
            const now=Date.now();
            if(now-controlWindowStart>=controlWindowMs){controlWindowStart=now;controls=0;}
            if(++controls>maxControlFramesPerWindow){shutdown(1008,'control frame flood');return;}
            if(message.type==='ping') {
              if(now-lastPing>=1000){lastPing=now;pings=0;}
              if(++pings>16){shutdown(1008,'ping flood');return;}
              if(!write(encodeServerFrame(10,message.data)))return;
            }
            continue;
          }
          const now=Date.now();
          if(now-windowStart>=messageWindowMs){windowStart=now;messages=0;}
          if(++messages>maxMessagesPerWindow){shutdown(1008,'message rate exceeded');return;}
          let frame;
          try{frame=JSON.parse(message.data);}catch{shutdown(1007,'invalid JSON');return;}
          const replies=session.receive(frame,transport);
          for(const reply of replies){const bytes=Buffer.from(JSON.stringify(reply));if(bytes.length>WS_MAX_MESSAGE){shutdown(1009,'frame too large');return;}if(!write(encodeServerFrame(1,bytes)))return;}
        }
        syncAssemblyTimer();
      }catch(error){shutdown(error instanceof WireError?error.closeCode:1008,'rejected');}
    };
    socket.on('data',receive);
    if(head?.length)receive(head);
  };
  server.on('upgrade',onUpgrade);
  return {close(){
    server.off('upgrade',onUpgrade);
    // Detach synchronously: waiting for Node's future 'close' event can leave
    // actor subscriptions and privileges alive after gateway shutdown.
    for(const [socket,cleanup] of [...sockets]){cleanup();socket.destroy();}
  },get connections(){return sockets.size;},get faults(){return {...faultCounts};}};
}
