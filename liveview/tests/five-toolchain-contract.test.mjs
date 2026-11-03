import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalToolchain,verifyToolchainContract,loadToolchainContract,
  checkGuestEvidenceShape,gitBlobSha,WIRE_BLOB_SHA,EVENT_FINGERPRINT_BLOB_SHA,TOOLCHAINS} from '../reference/toolchain-parity.mjs';
const registry=loadToolchainContract();
const clone=()=>structuredClone(registry);
const bad=(v)=>assert.throws(v,/ORES_LIVEVIEW_PARITY/);
const receipt=(backend='java')=>({backend,source_sha:'a'.repeat(40),source_tree_sha:'b'.repeat(40),
  compiler_sha:'c'.repeat(40),compiler_tree_sha:'d'.repeat(40),binary_sha:'e'.repeat(40),
  run_id:1,job_id:2,runner_id:3,executed_steps:4,wire_fixture_blob_sha:WIRE_BLOB_SHA,
  observed_wire_cases:41,event_fingerprint_fixture_blob_sha:EVENT_FINGERPRINT_BLOB_SHA,
  observed_fingerprint_cases:8,guest_compiled:true,guest_executed:true,actual_socket_io:true,
  actor_owned_state:true,liveview_app_protocol:'ores-liveview-v1',reconnect_e2e:true,supervisor_e2e:true,
  coalesced_retirement_e2e:true,retired_output_suppression_e2e:true,exactly_once_detach_e2e:true,serial_nonreentrant_actor_e2e:true});
test('all five repository backends have an explicit shared application contract',()=>{
  const p=verifyToolchainContract(registry);assert.equal(p.structural_contract_valid,true);
  assert.equal(p.backend_parity_certified,false);assert.equal(p.guest_execution_authenticated,false);
  assert.deepEqual(TOOLCHAINS,['java','llvm','wasm','forge','net']);
});
test('Cranelift is Forge and aliases are forbidden in signed evidence',()=>{
  assert.equal(canonicalToolchain('cranelift'),'forge');assert.equal(canonicalToolchain('dotnet'),'net');
  bad(()=>canonicalToolchain('rust'));bad(()=>checkGuestEvidenceShape(receipt('cranelift')));
});
test('pure Wasm requires explicit host adapter, not a fabricated listening socket',()=>{
  assert.equal(registry.toolchains.wasm.target,'host-adapter');
  const changed=clone();changed.toolchains.wasm.target='server';bad(()=>verifyToolchainContract(changed));
});
test('profile rejects missing, extra, or reordered toolchains',()=>{
  for(const k of TOOLCHAINS){const c=clone();delete c.toolchains[k];bad(()=>verifyToolchainContract(c));}
  const a=clone();a.toolchains.cranelift=a.toolchains.forge;bad(()=>verifyToolchainContract(a));
  const b=clone();b.all_toolchains_required.reverse();bad(()=>verifyToolchainContract(b));
});
test('reject native-guest certification based on a source-only host codec',()=>{
  for(const k of TOOLCHAINS){const c=clone();c.toolchains[k].guest_liveview_verified=true;bad(()=>verifyToolchainContract(c));}
});
test('wire registry and application revisions must be exactly pinned',()=>{
  for(const [field,v] of [['wire_fixture_blob_sha','f'.repeat(40)],['wire_case_count',40],['event_fingerprint_fixture_blob_sha','f'.repeat(40)],
    ['event_fingerprint_case_count',7],['app_subprotocol','ores.live.v1']]){
    const c=clone();c[field]=v;bad(()=>verifyToolchainContract(c));
  }
});
test('budget, actor ownership, panic and no-host-object invariants are mandatory',()=>{
  for(const [field,v] of [['wire_budget_bytes',1048576],['max_patch_ops',10000],
    ['server_authoritative_revision',false],['isolated_actor_state',false],
    ['supervisor_control_panic',false],['no_host_object_escape',false],
    ['guest_compiler_execution_required',false]]){
    const c=clone();c.shared_application_contract[field]=v;bad(()=>verifyToolchainContract(c));
  }
});
test('receipt shape refuses missing or zero-step runner proof on every backend',()=>{
  for(const k of TOOLCHAINS){const r=receipt(k);assert.equal(checkGuestEvidenceShape(r).certified,false);
    for(const prop of ['run_id','job_id','runner_id','executed_steps']) {const c={...r,[prop]:0};bad(()=>checkGuestEvidenceShape(c));}
  }
});
test('receipt shape refuses unpinned artifact hashes',()=>{
  for(const key of ['source_sha','source_tree_sha','compiler_sha','compiler_tree_sha','binary_sha']){
    for(const val of ['',null,'abcdef','A'.repeat(40)]) {const r=receipt();r[key]=val;bad(()=>checkGuestEvidenceShape(r));}
  }
});
test('receipt shape refuses host codec evidence, absent sockets or actor ownership',()=>{
  for(const key of ['guest_compiled','guest_executed','actual_socket_io','actor_owned_state','reconnect_e2e','supervisor_e2e']){
    const r=receipt();r[key]=false;bad(()=>checkGuestEvidenceShape(r));
  }
});
test('wire or application protocol mismatch invalidates receipt',()=>{
  for(const [key,val] of [['observed_wire_cases',40],['wire_fixture_blob_sha','0'.repeat(40)],
    ['liveview_app_protocol','ores.live.v1'],
    ['event_fingerprint_fixture_blob_sha','0'.repeat(40)],['observed_fingerprint_cases',7]]){const r=receipt();r[key]=val;bad(()=>checkGuestEvidenceShape(r));}
});
test('a fully populated synthetic receipt is NOT proof of execution or parity',()=>{
  const x=checkGuestEvidenceShape(receipt());assert.deepEqual(x,
    {backend:'java',structurally_admissible:true,authenticated:false,certified:false});
});
test('exact blob calculation uses git object format not ordinary file digest',()=>{
  assert.equal(gitBlobSha('test\n'),'9daeafb9864cf43055ae93beb0afd6c7d144bfa4');
});

test('host adapters are pinned per backend and cannot silently change transport topology',()=>{
  for(const backend of TOOLCHAINS) {
    for(const altered of ['',null,'host-only shim','an unaudited network import']) {
      const candidate=clone();candidate.toolchains[backend].host_adapter=altered;
      bad(()=>verifyToolchainContract(candidate));
    }
  }
});

test('all five backends require the canonical event fingerprint fixture in guest receipts',()=>{
  for(const k of TOOLCHAINS) {
    const r=receipt(k);assert.equal(checkGuestEvidenceShape(r).certified,false);
    for(const [key,value] of [['observed_fingerprint_cases',0],
      ['observed_fingerprint_cases',7],['event_fingerprint_fixture_blob_sha','0'.repeat(40)]]) {
      const tampered={...r,[key]:value};bad(()=>checkGuestEvidenceShape(tampered));
    }
  }
});
test('toolchain inventory requires application fingerprint fixture pinned by exact Git blob SHA',()=>{
  const c=clone();c.event_fingerprint_fixture_blob_sha=null;bad(()=>verifyToolchainContract(c));
  const mismatch=clone();mismatch.event_fingerprint_case_count=9;bad(()=>verifyToolchainContract(mismatch));
});

// A synthetic receipt remains unauthenticated, and every backend has to prove
// the same terminal connection retirement semantics with a compiled guest.
test('retirement invariants are mandatory in the portable application contract',()=>{
  for(const field of ['retirement_fences_coalesced_frames','retirement_suppresses_actor_output','exactly_once_detach_on_retirement']) {
    for(const invalid of [undefined,false,null,'true']){
      const c=clone();c.shared_application_contract[field]=invalid;
      bad(()=>verifyToolchainContract(c));
    }
  }
});
for(const backend of TOOLCHAINS) {
  test(backend+': guest retirement evidence cannot be omitted or forged',()=>{
    for(const field of ['coalesced_retirement_e2e','retired_output_suppression_e2e','exactly_once_detach_e2e']) {
      for(const invalid of [undefined,false,0,'true']) {
        const c=receipt(backend);c[field]=invalid;
        bad(()=>checkGuestEvidenceShape(c));
      }
    }
    assert.equal(checkGuestEvidenceShape(receipt(backend)).certified,false);
  });
}

// Source-only structural assertions: native guest evidence still requires authenticated CI.
test('nonreentrant actor sessions are mandatory in the shared application contract',()=>{
  for(const invalid of [undefined,false,null,'true',1]) {
    const c=clone();c.shared_application_contract.serial_actor_operations_nonreentrant=invalid;
    bad(()=>verifyToolchainContract(c));
  }
});
for(const backend of TOOLCHAINS) {
  test(`${backend}: native guest evidence must execute actor reentrancy adversaries`,()=>{
    for(const invalid of [undefined,false,null,'true',1]) {
      const c=receipt(backend);c.serial_nonreentrant_actor_e2e=invalid;
      bad(()=>checkGuestEvidenceShape(c));
    }
    assert.equal(checkGuestEvidenceShape(receipt(backend)).certified,false);
  });
}
