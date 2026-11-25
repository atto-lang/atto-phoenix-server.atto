// Optional real Chromium test of the Node host reference; not a native guest.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url));
const child=spawn(process.execPath,['reference/demo-server.mjs'],{cwd:root,stdio:['ignore','pipe','inherit']});
const lines=createInterface({input:child.stdout});
let browser;
try {
  const origin=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('reference startup timeout')),10000);
    lines.once('line',line=>{clearTimeout(timer);if(!/^HOST_REFERENCE_ONLY http:\/\/127\.0\.0\.1:\d+$/.test(line))reject(new Error('unexpected startup: '+line));else resolve(line.split(' ')[1]);});
    child.once('error',e=>{clearTimeout(timer);reject(e)});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error('server exited '+code))});
  });
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  const context=await browser.newContext(),a=await context.newPage(),b=await context.newPage(),errors=[];
  const count=async(page,value)=>page.waitForFunction(v=>document.querySelector('#count_value')?.textContent===v,String(value),{timeout:10000});
  for(const page of [a,b]){page.on('pageerror',e=>errors.push(String(e)));await page.goto(origin);await count(page,0);}
  await a.locator('#increment_button').click();await count(a,1);await count(b,1);
  await b.locator('#increment_button').click();await count(a,2);await count(b,2);
  await a.reload();await count(a,2);
  await a.locator('#decrement_button').click();await count(b,1);
  assert.deepEqual(errors,[]);
  console.log('BROWSER_E2E_PASS: 2 clients + mutations + broadcast + reload');
} finally {
  try {await browser?.close();} finally {
    lines.close();
    if(child.exitCode===null&&child.signalCode===null){
      const exited=once(child,'exit');child.kill('SIGTERM');
      const timeout=setTimeout(()=>child.kill('SIGKILL'),5000);
      try{await exited;}finally{clearTimeout(timeout)}
    }
  }
}
