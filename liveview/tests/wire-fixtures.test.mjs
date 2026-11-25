// Portable conformance vectors intended for native Oreslang backends.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ClientFrameParser,WireError} from '../reference/ws-wire.mjs';
const registry=JSON.parse(readFileSync(new URL('../fixtures/liveview-wire-v1.json',import.meta.url),'utf8'));
test('wire conformance fixture registry IDs are unique and every case is classified',()=>{
  assert.equal(registry.schema,'ores-liveview-wire-v1');
  assert.equal(new Set(registry.cases.map(x=>x.id)).size,registry.cases.length);
  assert.equal(registry.cases.length,41);
  for(const c of registry.cases){assert.match(c.id,/^[a-z0-9-]+$/);assert.match(c.frames_hex,/^(?:[a-f0-9]{2})+$/);
    assert.equal(Boolean(c.expected),!Boolean(c.error_code));}
});
for(const entry of registry.cases) {
  test(`native-wire-vector: ${entry.id}`,()=>{
    const raw=Buffer.from(entry.frames_hex,'hex'),parser=new ClientFrameParser();
    const execute=()=>parser.feed(raw).map(x=>x.type==='text'?{type:'text',data:x.data}:{type:x.type,data_hex:x.data.toString('hex')});
    if(entry.error_code)assert.throws(execute,e=>e instanceof WireError&&e.closeCode===entry.error_code);
    else assert.deepEqual(execute(),entry.expected);
  });
}

const partition=(bytes,strategy)=>{
  if(strategy==='whole') return [bytes];
  const chunks=[];let at=0;
  while(at<bytes.length) {
    const size=strategy==='byte'?1:strategy==='fibonacci'?[1,2,3,5,8,13][chunks.length%6]:7;
    chunks.push(bytes.subarray(at,Math.min(bytes.length,at+size)));at+=size;
  }
  return chunks;
};
for(const entry of registry.cases) for(const strategy of ['whole','byte','fibonacci','septets']) {
  test(`segmented-wire-vector: ${entry.id} / ${strategy}`,()=>{
    const parser=new ClientFrameParser();
    const parts=partition(Buffer.from(entry.frames_hex,'hex'),strategy);
    const execute=()=>parts.flatMap(bytes=>parser.feed(bytes)).map(
      msg=>msg.type==='text'?{type:'text',data:msg.data}:{type:msg.type,data_hex:msg.data.toString('hex')}
    );
    if(entry.error_code) assert.throws(execute,e=>e instanceof WireError&&e.closeCode===entry.error_code);
    else assert.deepEqual(execute(),entry.expected);
  });
}
