// Oreslang LiveView protocol v1 browser reference client.
// Owns only its data-ores-live-root subtree. No innerHTML, eval, or remote scripts.
export const VERSION = 1;
export const MAX_FRAME = 65536;
export const MAX_OPS = 128;
export const MAX_NODES = 512;
export const MAX_DEPTH = 24;
const MAX_STRING = 8192;
const IDENT = /^[A-Za-z][A-Za-z0-9_-]{0,95}$/;
const EVENT = /^[a-z][a-z0-9_]{0,63}$/;
const EVENT_ID = /^[0-9a-fA-F-]{8,128}$/;
const ATTR = /^(?:id|class|title|role|name|type|value|placeholder|tabindex|disabled|checked|for|href|src|alt|method|action|autocomplete|readonly|required|selected|aria-[a-z0-9_-]{1,64}|data-ores-[a-z0-9_-]{1,64})$/;
const TAGS = new Set('div span p strong em b i button input form label ul ol li section article header footer main nav h1 h2 h3 h4 a textarea select option table thead tbody tr td th small pre code br hr img'.split(' '));
const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function fail(message) { throw new Error('ORES_LIVEVIEW_PROTOCOL: ' + message); }
function assert(cond, message) { if (!cond) fail(message); }
function boundedString(value, max=MAX_STRING) { assert(typeof value === 'string' && value.length <= max, 'invalid string'); return value; }
function validId(value) { return typeof value === 'string' && IDENT.test(value); }
function serializableSize(value) {
  let json;
  try { json = JSON.stringify(value); } catch { fail('invalid JSON payload'); }
  assert(typeof json === 'string' && new TextEncoder().encode(json).length <= MAX_FRAME, 'oversized JSON frame');
  return json;
}
function safeUrl(value, name, origin) {
  assert(!/[\u0000-\u001f\u007f]/.test(value), 'URL control characters');
  let url;
  try { url = new URL(value, origin); } catch { fail('invalid URL'); }
  assert(url.protocol === 'https:' || url.protocol === 'http:' || (name === 'href' && url.protocol === 'mailto:'), 'unsafe URL scheme');
  if (name !== 'href') assert(url.origin === origin, 'cross-origin asset/form URL');
  assert(url.username === '' && url.password === '', 'URL credentials disallowed');
}
function validateAttrName(name) { assert(typeof name === 'string' && ATTR.test(name) && !BAD_KEYS.has(name), 'disallowed attribute'); }
function validateAttr(name, value, origin) {
  validateAttrName(name);
  boundedString(value, 2048);
  if (name === 'href' || name === 'src' || name === 'action') safeUrl(value, name, origin);
  if (name === 'method') assert(value === 'get' || value === 'post', 'invalid form method');
  if (name === 'type') assert(['text','email','password','hidden','number','checkbox','radio','submit','button'].includes(value), 'invalid input type');
}
function validateNode(node, origin, ids, count, depth=0) {
  assert(depth <= MAX_DEPTH, 'tree nesting limit');
  if (typeof node === 'string') { boundedString(node); return; }
  assert(node && typeof node === 'object' && !Array.isArray(node), 'invalid node');
  assert(TAGS.has(node.tag), 'disallowed element tag');
  assert(validId(node.id) && !ids.has(node.id), 'invalid or duplicate element ID');
  ids.add(node.id);
  assert(++count.value <= MAX_NODES, 'node count limit');
  if (node.attrs !== undefined) {
    assert(node.attrs && typeof node.attrs === 'object' && !Array.isArray(node.attrs), 'invalid attributes');
    for (const [k,v] of Object.entries(node.attrs)) validateAttr(k,v,origin);
    if (node.attrs.id !== undefined) assert(node.attrs.id === node.id, 'element ID mismatch');
  }
  if (node.children !== undefined) {
    assert(Array.isArray(node.children) && node.children.length <= MAX_NODES, 'invalid children');
    for (const child of node.children) validateNode(child, origin, ids, count, depth+1);
  }
  if (['input','img','br','hr'].includes(node.tag))
    assert(node.text === undefined && (node.children === undefined || node.children.length===0),
      'void elements cannot have content');
  if (node.text !== undefined) {
    boundedString(node.text);
    assert(node.children === undefined, 'text and children are exclusive');
  }
}
export function validateTree(nodes, origin, reservedIds=[]) {
  assert(Array.isArray(nodes) && nodes.length <= MAX_NODES, 'invalid root children');
  const ids = new Set(reservedIds); const count = {value:0};
  for (const node of nodes) validateNode(node, origin, ids, count);
  return true;
}
function treeIds(nodes, ids=[]) { for(const n of nodes) if(typeof n!=='string') {ids.push(n.id);treeIds(n.children||[],ids);} return ids; }
function buildNode(doc, spec) {
  if (typeof spec === 'string') return doc.createTextNode(spec);
  const el = doc.createElement(spec.tag); el.id = spec.id;
  for (const [k,v] of Object.entries(spec.attrs || {})) if (k !== 'id') el.setAttribute(k,v);
  if (spec.text !== undefined) el.textContent = spec.text;
  for (const child of spec.children || []) el.appendChild(buildNode(doc,child));
  return el;
}
function targetFor(root, id) {
  assert(validId(id), 'invalid target id');
  const target = root.ownerDocument.getElementById(id);
  assert(target && (target === root || root.contains(target)), 'patch target outside LiveView root');
  return target;
}
export function applySnapshot(root, nodes, origin) {
  serializableSize(nodes); validateTree(nodes, origin, [root.id]);
  for(const id of treeIds(nodes)) { const existing=root.ownerDocument.getElementById(id); assert(!existing || root.contains(existing), 'duplicate ID outside view'); }
  const frag = root.ownerDocument.createDocumentFragment();
  for (const n of nodes) frag.appendChild(buildNode(root.ownerDocument,n));
  root.replaceChildren(frag);
}
export function applyPatch(root, ops, origin) {
  assert(Array.isArray(ops) && ops.length <= MAX_OPS, 'invalid operations');
  serializableSize(ops);
  // Validate all payloads and existing targets before any DOM writes.
  const replacementIds = new Set();
  const mutations = new Set();
  const prepared = ops.map(op => {
    assert(op && typeof op === 'object' && !Array.isArray(op), 'invalid operation');
    assert(['set_text','set_attr','remove_attr','replace_children'].includes(op.op), 'unknown operation');
    const target = targetFor(root,op.id);
    if (op.op === 'set_text') boundedString(op.text);
    if (op.op === 'set_attr') validateAttr(op.name,op.value,origin);
    if (op.op === 'remove_attr') validateAttrName(op.name);
    if (op.op === 'set_attr' || op.op === 'remove_attr') assert(op.name !== 'id', 'cannot change identity');
    const key=(op.op==='set_attr'||op.op==='remove_attr')
      ? JSON.stringify([op.id,'attr',op.name]) : JSON.stringify([op.id,'struct']);
    assert(!mutations.has(key), 'duplicate patch mutation');
    mutations.add(key);
    if (op.op === 'replace_children') {
      validateTree(op.children,origin,[root.id]); assert(op.children.length <= MAX_NODES,'oversized children');
      for(const id of treeIds(op.children)) {
        assert(!replacementIds.has(id), 'duplicate ID across replacement operations');
        replacementIds.add(id);
        const existing=root.ownerDocument.getElementById(id);
        assert(!existing || target.contains(existing), 'duplicate ID outside replacement subtree');
      }
    }
    return {op,target};
  });
  for(let i=0;i<prepared.length;i++) for(let j=0;j<prepared.length;j++) {
    if(i!==j && ['set_text','replace_children'].includes(prepared[i].op.op))
      assert(!prepared[i].target.contains(prepared[j].target), 'overlapping structural patch operations');
  }
  for (const {op,target} of prepared) {
    if (op.op === 'set_text') target.textContent = op.text;
    if (op.op === 'set_attr') target.setAttribute(op.name,op.value);
    if (op.op === 'remove_attr') target.removeAttribute(op.name);
    if (op.op === 'replace_children') {
      const frag = root.ownerDocument.createDocumentFragment();
      for (const child of op.children) frag.appendChild(buildNode(root.ownerDocument,child));
      target.replaceChildren(frag);
    }
  }
}
export function validateWsUrl(value, browserLocation) {
  const target = new URL(value, browserLocation.href);
  assert(['wss:','ws:'].includes(target.protocol), 'WebSocket scheme required');
  const expected = new URL(browserLocation.href);
  assert(target.host === expected.host, 'cross-origin WebSocket prohibited');
  if (expected.protocol === 'https:') assert(target.protocol === 'wss:', 'TLS required');
  if (expected.protocol === 'http:') {
    const local = ['localhost','127.0.0.1','[::1]'].includes(expected.hostname);
    assert(target.protocol === 'wss:' || local, 'insecure WebSocket prohibited');
  }
  assert(!target.username && !target.password && !target.hash, 'WebSocket URL contains credentials/fragment');
  return target.href;
}
function safePayload(value,depth=0) {
  assert(depth<=8, 'payload too deep');
  if (value===null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (typeof value === 'string') { boundedString(value); return; }
  if (Array.isArray(value)) { assert(value.length <= 64,'payload array limit'); value.forEach(v=>safePayload(v,depth+1)); return; }
  assert(value && typeof value === 'object', 'invalid payload');
  const entries=Object.entries(value);
  assert(entries.length <= 64, 'payload field limit');
  for (const [k,v] of entries) { assert(IDENT.test(k) && !BAD_KEYS.has(k),'invalid payload key'); safePayload(v,depth+1); }
}
export function validateEvent(name,payload) { assert(EVENT.test(name),'invalid event name'); safePayload(payload); serializableSize(payload); }

export class OresLiveView {
  constructor({root,url,sessionId,csrfToken,webSocket=globalThis.WebSocket,randomUUID=()=>globalThis.crypto.randomUUID(),onError=()=>{}}) {
    assert(root && root.ownerDocument && root.getAttribute('data-ores-live-root')!==null,'invalid root');
    assert(typeof sessionId==='string' && sessionId.length>0 && sessionId.length<=256, 'invalid session');
    assert(typeof csrfToken==='string' && csrfToken.length>=16 && csrfToken.length<=256,'invalid CSRF token');
    this.root=root; this.url=validateWsUrl(url,root.ownerDocument.location); this.origin=root.ownerDocument.location.origin;
    this.sessionId=sessionId; this.csrfToken=csrfToken; this.webSocket=webSocket;
    this.uuid=randomUUID; this.onError=onError;
    this.viewId=boundedString(root.getAttribute('data-ores-view-id'),96);
    assert(validId(this.viewId), 'invalid view ID');
    this.clientId=this.uuid(); this.rev=-1; this.ready=false; this.closed=false; this.retry=0;
    this.queue=[]; this.socket=null; this.reconnectTimer=null;
    this._click=e=>this._eventFromDom(e,'click');
    this._submit=e=>this._eventFromDom(e,'submit');
    this._change=e=>this._eventFromDom(e,'change');
    root.addEventListener('click',this._click);
    root.addEventListener('submit',this._submit);
    root.addEventListener('change',this._change);
  }
  start() {
    assert(!this.closed,'client already closed');
    if (this.socket && [0,1].includes(this.socket.readyState)) return;
    // The server requires this explicit subprotocol; the browser must offer it.
    const socket=new this.webSocket(this.url,'ores-liveview-v1'); this.socket=socket;
    socket.addEventListener('open',()=> {
      if (this.closed || this.socket!==socket) return;
      this.ready=false;
      this._send({v:VERSION,type:'join',view_id:this.viewId,session_id:this.sessionId,csrf:this.csrfToken,client_id:this.clientId,resume_rev:this.rev});
    });
    socket.addEventListener('message',event=> {
      if (this.closed || this.socket!==socket) return;
      try { this._receive(event.data); } catch(err) { this.onError(err); this.ready=false; this._requestResync(); }
    });
    socket.addEventListener('close',()=> {
      if(this.socket!==socket) return;
      this.ready=false;
      if (!this.closed) this._reconnect();
    });
    socket.addEventListener('error',()=> { /* close handler performs bounded reconnect */ });
  }
  _send(value) {
    const json=serializableSize(value);
    if (this.socket && this.socket.readyState===1) this.socket.send(json);
  }
  _requestResync() { this._send({v:VERSION,type:'resync',view_id:this.viewId,revision:this.rev}); }
  _receive(raw) {
    assert(typeof raw==='string' && new TextEncoder().encode(raw).length<=MAX_FRAME,'oversized server frame');
    const frame=JSON.parse(raw);
    assert(frame && frame.v===VERSION && typeof frame.type==='string','bad server frame');
    if(frame.type==='snapshot') {
      assert(Number.isSafeInteger(frame.rev) && frame.rev>=0,'invalid revision');
      if(frame.rev<this.rev) {
        // v1 has no epoch-transition handshake. Never silently render an older
        // actor generation as if it were newer. Require a page/bootstrap reload.
        this.close();
        fail('session revision rollback; reload required');
      }
      applySnapshot(this.root,frame.children,this.origin); this.rev=frame.rev;
    } else if(frame.type==='patch') {
      assert(Number.isSafeInteger(frame.rev) && Number.isSafeInteger(frame.prev) && frame.rev===frame.prev+1,'invalid patch revision');
      if(frame.prev!==this.rev) { this._requestResync(); return; }
      applyPatch(this.root,frame.ops,this.origin); this.rev=frame.rev;
    } else if(frame.type==='ready') {
      assert(frame.rev===this.rev,'ready revision mismatch');
      this.ready=true; this.retry=0;
      for (const entry of this.queue) entry.sent=false;
      this._flush();
    } else if(frame.type==='event_ack') {
      assert(typeof frame.event_id==='string' && Number.isSafeInteger(frame.rev) && frame.rev>=0,'invalid event ack');
      const ahead=frame.rev>this.rev;
      const i=this.queue.findIndex(e=>e.id===frame.event_id);
      if(i>=0) this.queue.splice(i,1);
      if(ahead) { this.ready=false; this._requestResync(); }
      else this._flush();
    } else if(frame.type==='event_rejected') {
      // Reject rather than retry a revision-dependent command at a newer base:
      // retrying automatically can apply a command twice after dedup eviction.
      assert(typeof frame.event_id==='string' && frame.code==='stale_revision' &&
        Number.isSafeInteger(frame.rev) && frame.rev>=0,'invalid event rejection');
      const i=this.queue.findIndex(e=>e.id===frame.event_id);
      assert(i>=0,'unrecognized event rejection');
      this.queue.splice(i,1);
      this.ready=false;
      this.onError(new Error('ORES_LIVEVIEW_CONFLICT: stale event rejected'));
      this._requestResync();
    } else if(frame.type==='resync_required') {
      this.ready=false; this._requestResync();
    } else if(frame.type==='error') {
      this.onError(new Error('ORES_LIVEVIEW_SERVER: '+boundedString(frame.code,128)));
      if(frame.fatal===true) this.close();
    } else fail('unknown frame type');
  }
  dispatch(name,payload={}) {
    validateEvent(name,payload);
    assert(this.queue.length<128,'event queue is full');
    const id=this.uuid();
    assert(typeof id==='string' && EVENT_ID.test(id),'invalid event ID');
    assert(!this.queue.some(entry=>entry.id===id),'duplicate queued event ID');
    this.queue.push({id,name,payload,sent:false,base_rev:null});
    this._flush();
    return id;
  }
  _flush() {
    if(!this.ready || !this.socket || this.socket.readyState!==1) return;
    let inflight=this.queue.filter(e=>e.sent).length;
    for(const e of this.queue) {
      if(e.sent) continue;
      if(inflight>=1) return; // one in-flight revision-dependent event; avoids stale writes
      if(e.base_rev===null) e.base_rev=this.rev;
      this._send({v:VERSION,type:'event',event_id:e.id,name:e.name,payload:e.payload,base_rev:e.base_rev});
      e.sent=true; inflight++;
    }
  }
  _eventFromDom(event,kind) {
    try {
      const nameAttr='data-ores-'+kind;
      let node=event.target;
      while(node && node!==this.root && !(node.getAttribute && node.getAttribute(nameAttr))) node=node.parentNode;
      if(!node || !node.getAttribute) return;
      const name=node.getAttribute(nameAttr); if(!name) return;
      if(kind==='submit') event.preventDefault();
      const payload=Object.create(null);
      if(kind==='submit') {
        const data=new FormData(node); let count=0;
        for(const [k,v] of data) {
          assert(++count<=64,'too many form fields');
          assert(IDENT.test(k) && !BAD_KEYS.has(k),'invalid form key');
          assert(typeof v==='string','file uploads require a separate authenticated HTTP endpoint');
          if(Object.hasOwn(payload,k)) {
            if(!Array.isArray(payload[k])) payload[k]=[payload[k]];
            payload[k].push(v);
          } else payload[k]=v;
        }
      } else if(kind==='change') {
        const key=node.getAttribute('name')||'value';
        assert(IDENT.test(key) && !BAD_KEYS.has(key),'invalid changed field');
        payload[key]=node.type==='checkbox' ? !!node.checked : String(node.value||'');
      }
      this.dispatch(name,payload);
    } catch(err) { this.onError(err); }
  }

  _reconnect() {
    if(this.reconnectTimer!==null || this.closed) return;
    const delay=Math.min(30000,500*2**Math.min(this.retry++,6));
    this.reconnectTimer=setTimeout(()=> {this.reconnectTimer=null; if(!this.closed) this.start();},delay);
  }
  close() {
    this.closed=true; this.ready=false;
    if(this.reconnectTimer!==null) clearTimeout(this.reconnectTimer);
    this.root.removeEventListener('click',this._click);
    this.root.removeEventListener('submit',this._submit);
    this.root.removeEventListener('change',this._change);
    if(this.socket) this.socket.close(1000,'leaving view');
    this.queue=[];
  }
}
