import test from 'node:test';
import assert from 'node:assert/strict';
import {ClientFrameParser,encodeClientFrame,encodeServerFrame,WireError} from '../reference/ws-wire.mjs';
const text='{"v":1,"type":"event"}';
const parse=(...frames)=>new ClientFrameParser().feed(Buffer.concat(frames));
test('RFC6455 masked JSON text frame roundtrip',()=>{assert.deepEqual(parse(encodeClientFrame(1,text)),[{type:'text',data:text}]);});
test('parser buffers arbitrary header, mask and payload splits',()=>{const raw=encodeClientFrame(1,text),parser=new ClientFrameParser();const msgs=[];for(const byte of raw)msgs.push(...parser.feed(Buffer.from([byte])));assert.deepEqual(msgs,[{type:'text',data:text}]);});
test('fragmented text reassembles across ping frames',()=>{const frames=[encodeClientFrame(1,'hello ',{fin:false}),encodeClientFrame(9,'a'),encodeClientFrame(0,'world')];assert.deepEqual(parse(...frames),[{type:'ping',data:Buffer.from('a')},{type:'text',data:'hello world'}]);});
test('UTF8 decoded after fragments, not part-way through a code point',()=>{const bytes=Buffer.from('€');assert.deepEqual(parse(encodeClientFrame(1,bytes.subarray(0,2),{fin:false}),encodeClientFrame(0,bytes.subarray(2))),[{type:'text',data:'€'}]);});
test('unmasked client frames are rejected',()=>{assert.throws(()=>parse(encodeServerFrame(1,'abc')),e=>e instanceof WireError && e.closeCode===1002);});
test('invalid UTF8 produces 1007',()=>{assert.throws(()=>parse(encodeClientFrame(1,Buffer.from([0xC3,0x28]))),e=>e.closeCode===1007);});
test('binary frames produce unsupported data close code 1003',()=>{assert.throws(()=>parse(encodeClientFrame(2,'data')),e=>e.closeCode===1003);});
test('reserved opcodes and RSV bits rejected',()=>{for(const first of [0x83,0xC1]){const raw=encodeClientFrame(1,'a');raw[0]=first;assert.throws(()=>parse(raw),WireError);}});
test('reject bare continuation and unexpected new data frame',()=>{assert.throws(()=>parse(encodeClientFrame(0,'a')),WireError);assert.throws(()=>parse(encodeClientFrame(1,'a',{fin:false}),encodeClientFrame(1,'b')),WireError);});
test('control frames must not fragment or exceed 125 bytes',()=>{assert.throws(()=>parse(encodeClientFrame(9,'a',{fin:false})),WireError);assert.throws(()=>parse(encodeClientFrame(9,Buffer.alloc(126))),WireError);});
test('reject non-minimal 16-bit lengths',()=>{const raw=encodeClientFrame(1,'a');const bad=Buffer.concat([Buffer.from([0x81,0xfe,0,1]),raw.subarray(2)]);assert.throws(()=>parse(bad),WireError);});
test('reject high-bit 64-bit lengths and excessive 64-bit lengths without allocating',()=>{for(const len of [0x8000000000000000n,65537n]){const raw=Buffer.alloc(14);raw[0]=0x81;raw[1]=0xff;raw.writeBigUInt64BE(len,2);raw.set([1,2,3,4],10);assert.throws(()=>parse(raw),WireError);}});
test('reject oversized accumulated fragmented message',()=>{const p=new ClientFrameParser({maxMessage:16});p.feed(encodeClientFrame(1,'abcdefghij',{fin:false}));assert.throws(()=>p.feed(encodeClientFrame(0,'abcdefghij')),e=>e.closeCode===1009);});
test('reject oversized pending frame input',()=>{const p=new ClientFrameParser({maxBuffer:12});assert.throws(()=>p.feed(encodeClientFrame(1,'abcdefghij')),e=>e.closeCode===1009);});
test('valid close frame and no additional client frames',()=>{const payload=Buffer.from([0x03,0xE8]);const p=new ClientFrameParser();assert.deepEqual(p.feed(encodeClientFrame(8,payload)),[{type:'close',data:payload}]);assert.throws(()=>p.feed(encodeClientFrame(1,'hi')),WireError);});
test('invalid close codes, lengths and reasons are rejected',()=>{assert.throws(()=>parse(encodeClientFrame(8,Buffer.from([0]))),WireError);assert.throws(()=>parse(encodeClientFrame(8,Buffer.from([0x03,0xee]))),WireError);assert.throws(()=>parse(encodeClientFrame(8,Buffer.from([0x03,0xe8,0xc3]))),e=>e.closeCode===1007);});
test('server sends unmasked text and pong frames',()=>{const f=encodeServerFrame(1,'hi');assert.deepEqual([...f],[0x81,2,104,105]);const p=encodeServerFrame(10,'x');assert.equal(p[0],0x8a);});

test('deny unbounded zero-byte WebSocket fragmentation',()=>{
  const p=new ClientFrameParser({maxFragments:4});
  p.feed(encodeClientFrame(1,'',{fin:false}));
  for(let i=0;i<3;i++)p.feed(encodeClientFrame(0,'',{fin:false}));
  assert.throws(()=>p.feed(encodeClientFrame(0,'',{fin:false})),e=>e.closeCode===1009);
});
test('frame budget accepts exact fragment limit and resets on completed message',()=>{
  const p=new ClientFrameParser({maxFragments:2});
  assert.deepEqual(p.feed(Buffer.concat([encodeClientFrame(1,'a',{fin:false}),encodeClientFrame(0,'b')])),[{type:'text',data:'ab'}]);
  assert.deepEqual(p.feed(encodeClientFrame(1,'ok')),[{type:'text',data:'ok'}]);
});
