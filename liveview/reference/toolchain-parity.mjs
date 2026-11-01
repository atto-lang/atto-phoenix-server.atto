// Unprivileged host-side capability inventory, never proof of a guest build.
// Backends must present compiler/native execution independently, under a
// source/destination-approved private CI policy. Never infer it from this file.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const TOOLCHAINS=Object.freeze(['java','llvm','wasm','forge','net']);
export const TOOLCHAIN_ALIASES=Object.freeze({cranelift:'forge',graal:'java',dotnet:'net'});
export const WIRE_BLOB_SHA='931f58c1acd40e4c7e1b0b061f1711a0afe3c9b8';
export const APPLICATION_FRAMES=Object.freeze(['join','snapshot','ready','event','patch','event_ack','event_rejected','resync']);
export const APPLICATION_ENTRYPOINT='mount -> event -> reducer -> typed_render -> patch/ack';
const sha=/^[a-f0-9]{40}$/;
const cap= n=>Number.isSafeInteger(n)&&n>0;
function reject(message) {throw new Error('ORES_LIVEVIEW_PARITY: '+message);}
function ensure(ok,message) {if(!ok)reject(message);}
export function canonicalToolchain(value) {
  ensure(typeof value==='string','invalid toolchain');
  const key=TOOLCHAIN_ALIASES[value]||value;
  ensure(TOOLCHAINS.includes(key),'unknown toolchain');
  return key;
}
export function gitBlobSha(content) {
  const bytes=Buffer.isBuffer(content)?content:Buffer.from(content);
  return createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
}
export function verifyToolchainContract(registry) {
  ensure(registry && typeof registry==='object'&&!Array.isArray(registry),'invalid registry');
  ensure(registry.schema==='ores-liveview-toolchain-v1','unknown schema');
  ensure(registry.wire_fixture_blob_sha===WIRE_BLOB_SHA,'wire fixture version drift');
  ensure(registry.wire_case_count===41,'41-case transport gate required');
  ensure(registry.app_subprotocol==='ores-liveview-v1','subprotocol drift');
  ensure(Array.isArray(registry.all_toolchains_required)&&registry.all_toolchains_required.length===5&&
    registry.all_toolchains_required.every((k,i)=>k===TOOLCHAINS[i]),'five-toolchain inventory mismatch');
  ensure(registry.toolchains && Object.keys(registry.toolchains).length===5,'toolchain count mismatch');
  const expected=registry.shared_application_contract;
  ensure(expected && expected.wire_budget_bytes===65536 && expected.max_patch_ops===128,
    'transport limits drift');
  ensure(expected.entrypoint===APPLICATION_ENTRYPOINT,'application entrypoint drift');
  ensure(Array.isArray(expected.required_frames) &&
    expected.required_frames.length===APPLICATION_FRAMES.length &&
    expected.required_frames.every((name,index)=>name===APPLICATION_FRAMES[index]),
    'required LiveView frame vocabulary drift');
  ensure(expected.server_authoritative_revision===true&&expected.isolated_actor_state===true&&
    expected.supervisor_control_panic===true&&expected.no_host_object_escape===true&&
    expected.guest_compiler_execution_required===true,'weakened guest ownership semantics');
  for (const toolchain of TOOLCHAINS) {
    const candidate=registry.toolchains[toolchain];
    ensure(candidate && candidate.repo===`oreslang-source.${toolchain}`,'unexpected backend identity');
    ensure(candidate.target===(toolchain==='wasm'?'host-adapter':'server'),'wrong transport topology');
    ensure(candidate.guest_liveview_verified===false,'unattested guest promotion');
    ensure(typeof candidate.host_adapter==='string' && candidate.host_adapter.length>6,'missing host adapter contract');
  }
  return Object.freeze({structural_contract_valid:true,guest_execution_authenticated:false,backend_parity_certified:false});
}
// Records independent of this structural-only contract must contain exact
// immutable compiler, application, binary and runner provenance. These checks
// reject fake shapes, but an independent runner authority still must validate
// receipts against GitHub/CI records; passing this function never certifies.
export function checkGuestEvidenceShape(receipt) {
  ensure(receipt&&typeof receipt==='object'&&!Array.isArray(receipt),'invalid guest receipt');
  const backend=canonicalToolchain(receipt.backend);
  ensure(receipt.backend===backend,'aliases forbidden in signed guest receipts');
  for(const name of ['source_sha','source_tree_sha','compiler_sha','compiler_tree_sha','binary_sha'])
    ensure(typeof receipt[name]==='string'&&sha.test(receipt[name]),'invalid '+name);
  for(const name of ['run_id','job_id','runner_id','executed_steps'])
    ensure(cap(receipt[name]),'missing stepful '+name);
  ensure(receipt.wire_fixture_blob_sha===WIRE_BLOB_SHA && receipt.observed_wire_cases===41,
    'incomplete or mismatched wire fixture');
  ensure(receipt.guest_compiled===true && receipt.guest_executed===true &&
    receipt.actual_socket_io===true && receipt.actor_owned_state===true,
    'host codec is not guest LiveView');
  ensure(receipt.liveview_app_protocol==='ores-liveview-v1' && receipt.reconnect_e2e===true &&
    receipt.supervisor_e2e===true,'incomplete application protocol checks');
  return {backend,structurally_admissible:true,authenticated:false,certified:false};
}
export function loadToolchainContract(path=new URL('../fixtures/ores-liveview-toolchain-v1.json',import.meta.url)) {
  return JSON.parse(readFileSync(path,'utf8'));
}
