import test from 'node:test';
import assert from 'node:assert/strict';
import {launchReferenceDemo} from '../reference/demo-server.mjs';
test('loopback demo serves authenticated bootstrap, strict CSP, and browser module',async()=>{
  const d=await launchReferenceDemo();try{
    const res=await fetch(d.origin+'/');assert.equal(res.status,200);
    assert.match(res.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    const cookie=res.headers.get('set-cookie').split(';')[0];assert.match(cookie,/^ores_session=/);
    assert.match(await res.text(),/data-ores-live-root/);
    const denied=await fetch(d.origin+'/bootstrap.json');assert.equal(denied.status,403);
    const b=await fetch(d.origin+'/bootstrap.json',{headers:{Cookie:cookie}});assert.equal(b.status,200);
    const data=await b.json();assert.ok(data.csrf.length>=32);assert.ok(data.session_id.length>=32);
    assert.ok((await (await fetch(d.origin+'/web/liveview.mjs')).text()).includes('class OresLiveView'));
    const p=await fetch(d.origin+'/../../../etc/passwd');assert.equal(p.status,404);
  } finally{await d.close();}
});
