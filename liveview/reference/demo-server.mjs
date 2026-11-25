// Local-only executable host reference. NOT native Oreslang and never public-bind.
import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {installReferenceGateway} from './ws-gateway.mjs';
import {LiveViewSession} from './liveview-core.mjs';
const assetRoot = new URL('../web/', import.meta.url);
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Oreslang LiveView reference</title></head><body><h1>Oreslang LiveView – reference only</h1><p>Node WebSocket harness; not native Oreslang execution.</p><main id="root" data-ores-live-root data-ores-view-id="counter" aria-live="polite"></main><script type="module" src="/web/demo-entry.mjs"></script></body></html>`;
export async function launchReferenceDemo({port=0}={}) {
  const sessionId=randomBytes(24).toString('hex'),csrfToken=randomBytes(24).toString('hex');
  const cookie=`ores_session=${sessionId}`;
  const equalCookie=(value)=>{if(typeof value!=='string')return false;const a=Buffer.from(value),b=Buffer.from(cookie);return a.length===b.length&&timingSafeEqual(a,b);};
  const csp="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' ws:; img-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'";
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',csp);
    if(req.method!=='GET'){res.writeHead(405);res.end();return;}
    if(req.url==='/') {res.setHeader('Set-Cookie',cookie+'; HttpOnly; SameSite=Strict; Path=/');res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
    if(req.url==='/bootstrap.json'){
      if(!equalCookie(req.headers.cookie)){res.writeHead(403);res.end();return;}
      res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({session_id:sessionId,csrf:csrfToken}));return;
    }
    const assets=new Map([['/web/liveview.mjs','liveview.mjs'],['/web/demo-entry.mjs','demo-entry.mjs']]);
    if(assets.has(req.url)){res.setHeader('Content-Type','text/javascript; charset=utf-8');try{res.end(await readFile(new URL(assets.get(req.url),assetRoot)))}catch{res.writeHead(500);res.end()}return;}
    res.writeHead(404);res.end();
  });
  server.maxHeadersCount=32;server.headersTimeout=5000;server.requestTimeout=5000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const actualPort=server.address().port,origin=`http://127.0.0.1:${actualPort}`;
  const view=new LiveViewSession({viewId:'counter',sessionId,csrfToken,rootId:'root',origin,initialState:{count:0},
    render:s=>[{tag:'section',id:'counter_panel',children:[
      {tag:'p',id:'counter_label',text:'Count:'},{tag:'strong',id:'count_value',text:String(s.count)},
      {tag:'button',id:'increment_button',attrs:{type:'button','data-ores-click':'increment'},text:'Increment'},
      {tag:'button',id:'decrement_button',attrs:{type:'button','data-ores-click':'decrement'},text:'Decrement'}]}],
    reduce:(state,name)=>{
      if(!['increment','decrement'].includes(name))throw new Error('unregistered event');
      const next=state.count+(name==='increment'?1:-1);
      if(!Number.isSafeInteger(next)||Math.abs(next)>1000000)throw new Error('counter budget');
      return {count:next};
    },authorize:transport=>transport.user==='local-demo'&&transport.origin===origin});
  const gateway=installReferenceGateway(server,{origins:new Set([origin]),hosts:new Set([`127.0.0.1:${actualPort}`]),allowLoopbackCleartext:true,
    authenticate:req=>equalCookie(req.headers.cookie)?{id:'local-demo'}:null,getSession:()=>view,maxConnections:8});
  return {port:actualPort,origin,view,async close(){gateway.close();await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}};
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]){
  const demo=await launchReferenceDemo({port:Number(process.env.PORT||0)});
  console.log('HOST_REFERENCE_ONLY '+demo.origin);
  for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>{demo.close().then(()=>process.exit(0));});
}
