import test from 'node:test';
import assert from 'node:assert/strict';
import {validateUpgrade} from '../reference/ws-gateway.mjs';
import {verifyToolchainContract,checkGuestEvidenceShape,loadToolchainContract,WIRE_BLOB_SHA} from '../reference/toolchain-parity.mjs';
function request(offer) {
  const headers={'host':'127.0.0.1:23456','origin':'http://127.0.0.1:23456',
    'connection':'Upgrade','upgrade':'websocket','sec-websocket-version':'13',
    'sec-websocket-key':'dGhlIHNhbXBsZSBub25jZQ==','sec-websocket-protocol':offer};
  return {method:'GET',httpVersion:'1.1',url:'/live',headers,
    rawHeaders:Object.entries(headers).flat(),socket:{remoteAddress:'127.0.0.1',encrypted:false}};
}
const opts={hosts:new Set(['127.0.0.1:23456']),origins:new Set(['http://127.0.0.1:23456']),allowLoopbackCleartext:true};
const valid=offer=>validateUpgrade(request(offer),opts);
const invalid=offer=>assert.throws(()=>valid(offer),/ORES_WS_UPGRADE/);
const fresh=()=>structuredClone(loadToolchainContract());
const rejects=reg=>assert.throws(()=>verifyToolchainContract(reg),/ORES_LIVEVIEW_PARITY/);
test('RFC6455 LiveView protocol offers are case-sensitive',()=>{
  assert.ok(valid('ores-liveview-v1').accept);
  assert.ok(valid('another, ores-liveview-v1').accept);
  for(const x of ['ORES-LIVEVIEW-V1','Ores-LiveView-v1','ores-liveview-v1x','xores-liveview-v1'])invalid(x);
});
test('missing, duplicate, malformed or empty offered subprotocols reject',()=>{
  for(const x of ['', ' ', 'ores-liveview-v1,', ',ores-liveview-v1',
    'ores-liveview-v1,,other','ores-liveview-v1,ores-liveview-v1',
    'ores-liveview-v1,other,other','ores-liveview-v1,white space'])invalid(x);
});
test('portable app requires exact lifecycle function contract',()=>{
  assert.equal(verifyToolchainContract(fresh()).backend_parity_certified,false);
  for(const x of ['',null,'mount -> render -> patch']){
    const reg=fresh();reg.shared_application_contract.entrypoint=x;rejects(reg);
  }
});
test('portable app requires exact ordered LiveView frame vocabulary',()=>{
  for(const x of ['missing','duplicate','reverse','unknown','string','empty']){
    const reg=fresh(),frames=reg.shared_application_contract.required_frames;
    if(x==='missing')frames.pop();
    if(x==='duplicate')frames[1]=frames[0];
    if(x==='reverse')frames.reverse();
    if(x==='unknown')frames[0]='execute_js';
    if(x==='string')reg.shared_application_contract.required_frames='join';
    if(x==='empty')reg.shared_application_contract.required_frames=[];
    rejects(reg);
  }
});
test('even complete-looking receipts remain unauthenticated structural assertions',()=>{
  const sha='a'.repeat(40);
  const receipt={backend:'java',source_sha:sha,source_tree_sha:sha,compiler_sha:sha,
    compiler_tree_sha:sha,binary_sha:sha,run_id:1,job_id:2,runner_id:3,executed_steps:4,
    wire_fixture_blob_sha:WIRE_BLOB_SHA,observed_wire_cases:41,
    guest_compiled:true,guest_executed:true,actual_socket_io:true,actor_owned_state:true,
    liveview_app_protocol:'ores-liveview-v1',reconnect_e2e:true,supervisor_e2e:true};
  assert.deepEqual([checkGuestEvidenceShape(receipt).authenticated,
    checkGuestEvidenceShape(receipt).certified],[false,false]);
});
