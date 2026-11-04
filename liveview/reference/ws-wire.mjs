// Host-only, dependency-free RFC 6455 wire reference for the native Oreslang port.
// Server receives masked client frames. No negotiated extensions or compression.
import {TextDecoder} from 'node:util';
export const WS_MAX_MESSAGE = 65536;
export class WireError extends Error {
  constructor(message, code=1002) { super(`ORES_WS_WIRE: ${message}`); this.closeCode=code; }
}
const fail=(msg,code)=>{throw new WireError(msg,code);};
const decode = bytes => {try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)} catch{fail('invalid UTF-8',1007)}};
export function encodeServerFrame(opcode,payload=Buffer.alloc(0)) {
  const body=Buffer.isBuffer(payload)?payload:Buffer.from(payload);
  if (![0x1,0x2,0x8,0x9,0xA].includes(opcode)) fail('unsupported server opcode');
  if (body.length>WS_MAX_MESSAGE || (opcode>=8 && body.length>125)) fail('oversized outgoing frame',1009);
  if (opcode===8) {
    if (body.length===1) fail('invalid outgoing close payload');
    if (body.length>=2) {
      if (!closeCodeValid(body.readUInt16BE(0))) fail('invalid outgoing close code');
      decode(body.subarray(2));
    }
  }
  const extra=body.length<126?0:body.length<=65535?2:8;
  const header=Buffer.alloc(2+extra);header[0]=0x80|opcode;header[1]=body.length<126?body.length:extra===2?126:127;
  if(extra===2)header.writeUInt16BE(body.length,2);
  if(extra===8)header.writeBigUInt64BE(BigInt(body.length),2);
  return Buffer.concat([header,body]);
}
export function encodeClientFrame(opcode,payload=Buffer.alloc(0),{fin=true,mask=Buffer.from([1,2,3,4])}={}) {
  const body=Buffer.isBuffer(payload)?payload:Buffer.from(payload);
  if(mask.length!==4)throw new Error('mask length must be 4');
  const extra=body.length<126?0:body.length<=65535?2:8;
  const h=Buffer.alloc(2+extra+4);h[0]=(fin?0x80:0)|opcode;h[1]=0x80|(extra===0?body.length:extra===2?126:127);
  if(extra===2)h.writeUInt16BE(body.length,2);if(extra===8)h.writeBigUInt64BE(BigInt(body.length),2);
  mask.copy(h,2+extra);const masked=Buffer.alloc(body.length);
  for(let i=0;i<body.length;i++)masked[i]=body[i]^mask[i%4];
  return Buffer.concat([h,masked]);
}
function closeCodeValid(code) {
  return code>=1000 && code<5000 && ![1004,1005,1006,1015].includes(code) &&
    (code<1016 || code>=3000); // 1016–2999 reserved
}
export class ClientFrameParser {
  constructor({maxMessage=WS_MAX_MESSAGE,maxBuffer=WS_MAX_MESSAGE+64,maxFragments=64,maxFramesPerFeed=256,maxMessageAgeMs=15000,now=()=>performance.now()}={}) {
    if(!Number.isSafeInteger(maxMessage)||maxMessage<1||
       !Number.isSafeInteger(maxBuffer)||maxBuffer<1||
       !Number.isSafeInteger(maxFragments)||maxFragments<1||
       !Number.isSafeInteger(maxFramesPerFeed)||maxFramesPerFeed<1||
       !Number.isSafeInteger(maxMessageAgeMs)||maxMessageAgeMs<1||typeof now!=='function')fail('invalid parser budgets');
    this.maxMessage=maxMessage;this.maxBuffer=maxBuffer;this.maxFragments=maxFragments;this.maxFramesPerFeed=maxFramesPerFeed;this.pending=Buffer.alloc(0);
    this.fragments=[];this.fragmentBytes=0;this.fragmentOpcode=null;this.closed=false;
    this.maxMessageAgeMs=maxMessageAgeMs;this.now=now;this.messageStartedAt=null;
  }
  feed(bytes) {
    if(this.closed)fail('frame after close');
    if(!Buffer.isBuffer(bytes))bytes=Buffer.from(bytes);
    // A peer must not hold an incomplete frame (or fragmented message)
    // indefinitely by supplying one byte just before each socket idle timeout.
    const checkAge=()=>{
      if(this.messageStartedAt!==null && this.now()-this.messageStartedAt>this.maxMessageAgeMs)
        fail('message assembly deadline exceeded',1008);
    };
    checkAge();
    const arrivalTime=this.now();
    // maxBuffer is the incomplete-frame budget, not the total TCP read size.
    // Parse complete frames before admitting more bytes, so coalesced frames
    // cannot spuriously trip memory limits. Limit per-feed work independently.
    const messages=[];
    let offset=0, frameCount=0;
    while(offset<bytes.length || (offset===0 && bytes.length===0)) {
      if(offset<bytes.length) {
        if(this.messageStartedAt===null)this.messageStartedAt=this.now();
        checkAge();
        const available=this.maxBuffer-this.pending.length;
        if(available<=0)fail('inbound buffer budget exceeded',1009);
        const size=Math.min(available,bytes.length-offset);
        this.pending=Buffer.concat([this.pending,bytes.subarray(offset,offset+size)]);
        offset+=size;
      }
      let progress=false;
      while(this.pending.length>=2) {
      if(this.messageStartedAt===null)this.messageStartedAt=this.now();
      checkAge();
      const a=this.pending[0],b=this.pending[1], opcode=a&15,fin=!!(a&128),masked=!!(b&128),control=opcode>=8;
      if(a&0x70)fail('RSV bits set without extension');
      if(!masked)fail('unmasked client frame');
      if(![0,1,2,8,9,10].includes(opcode))fail('invalid opcode');
      // Binary messages are not part of the first-party protocol. Reject at
      // the header rather than buffering a potentially huge binary payload.
      if(opcode===2)fail('binary data not supported',1003);
      if(control && (!fin || (b&127)>125))fail('invalid control frame');
      const indicator=b&127,extra=indicator===126?2:indicator===127?8:0;
      if(this.pending.length<2+extra+4)break;
      let length=indicator;
      if(extra===2) {
        length=this.pending.readUInt16BE(2);
        if(length<126)fail('non-minimal 16-bit length');
      }
      if(extra===8) {
        const big=this.pending.readBigUInt64BE(2);
        if(big>>63n || big<65536n)fail('invalid 64-bit length');
        if(big>BigInt(this.maxMessage))fail('message too large',1009);
        length=Number(big);
      }
      if(length>this.maxMessage)fail('message too large',1009);
      if(control && length>125)fail('control frame too large');
      const start=2+extra+4;
      if(start+length>this.maxBuffer)fail('frame exceeds input buffer budget',1009);
      if(this.pending.length<start+length)break;
      const mask=this.pending.subarray(start-4,start);
      const data=Buffer.from(this.pending.subarray(start,start+length));
      for(let i=0;i<length;i++)data[i]^=mask[i&3];
      this.pending=this.pending.subarray(start+length);
      progress=true;
      if(++frameCount>this.maxFramesPerFeed)fail('frame count per feed exceeded',1009);
      if(opcode===8) {
        if(length===1)fail('invalid close payload');
        if(length>=2) {const code=data.readUInt16BE(0);if(!closeCodeValid(code))fail('invalid close code');decode(data.subarray(2));}
        // A peer close is terminal. Never emit application messages that
        // were bundled after CLOSE in this TCP read, or silently retain them.
        // This matters when the transport batches several masked frames.
        this.closed=true;
        if(this.pending.length!==0 || offset<bytes.length)
          fail('frame bytes after close');
        messages.push({type:'close',data});break;
      }
      if(opcode===9||opcode===10) {
        messages.push({type:opcode===9?'ping':'pong',data});
        // Standalone heartbeats are frames, not unfinished data messages.
        if(this.fragmentOpcode===null)this.messageStartedAt=null;
        continue;
      }
      if(opcode===0) {
        if(this.fragmentOpcode===null)fail('continuation without starting frame');
      } else {
        if(this.fragmentOpcode!==null)fail('new data frame within fragmented message');
        this.fragmentOpcode=opcode;
      }
      this.fragmentBytes+=length;
      if(this.fragmentBytes>this.maxMessage)fail('fragmented message too large',1009);
      if(this.fragments.length>=this.maxFragments)fail('too many frame fragments',1009);
      this.fragments.push(data);
      if(fin) {
        const full=Buffer.concat(this.fragments,this.fragmentBytes);
        if(this.fragmentOpcode!==1)fail('binary data not supported',1003);
        messages.push({type:'text',data:decode(full)});
        this.fragmentOpcode=null;this.fragmentBytes=0;this.fragments=[];
        this.messageStartedAt=null; // next data message starts a new deadline
      }
      }
      if(offset===bytes.length)break;
      if(!progress && this.pending.length>=this.maxBuffer)fail('inbound buffer budget exceeded',1009);
    }
    // A complete message (or standalone ping/pong) can share a TCP read with
    // the beginning of another frame. Resetting the prior message's deadline
    // must not strand that trailing incomplete header without its own clock.
    // Use the read's arrival time rather than refreshing it after parsing.
    if(this.pending.length>0 && this.messageStartedAt===null)
      this.messageStartedAt=arrivalTime;
    return messages;
  }
}
