// Host-side reference encoder for a SEPARATE HTMX WebSocket endpoint.
// HTMX's ws extension expects OOB HTML, not ores-liveview-v1 JSON frames.
import {validateTree,validateEvent,MAX_FRAME} from '../web/liveview.mjs';
const IDENT=/^[A-Za-z][A-Za-z0-9_-]{0,95}$/;
const EVENT_ID=/^[0-9a-fA-F-]{8,128}$/;
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
const VOID=new Set(['input','img','br','hr']);
function encodeNode(node) {
  if(typeof node==='string')return escapeHtml(node);
  const attrs={...(node.attrs||{}),id:node.id};
  let result='<'+node.tag;
  for(const [k,v] of Object.entries(attrs))result+=' '+k+'="'+escapeHtml(v)+'"';
  result+='>';
  if(VOID.has(node.tag))return result;
  if(node.text!==undefined)result+=escapeHtml(node.text);
  for(const child of node.children||[])result+=encodeNode(child);
  result+='</'+node.tag+'>';
  return result;
}
export function encodeHtmxSnapshot(rootId,children,origin) {
  if(!IDENT.test(rootId))throw new Error('HTMX_BRIDGE: invalid root id');
  validateTree(children,origin,[rootId]);
  const html='<div id="'+escapeHtml(rootId)+'" hx-swap-oob="innerHTML">'+children.map(encodeNode).join('')+'</div>';
  if(new TextEncoder().encode(html).length>MAX_FRAME)throw new Error('HTMX_BRIDGE: outgoing payload too large');
  return html;
}
// A constrained OOB subset; fall back to a complete snapshot for attribute changes.
export function encodeHtmxPatch(ops,origin) {
  if(!Array.isArray(ops) || ops.length>128)throw new Error('HTMX_BRIDGE: invalid patch');
  const frames=[];
  for(const op of ops) {
    if(!IDENT.test(op.id) || !['set_text','replace_children'].includes(op.op))return null;
    let body;
    if(op.op==='set_text') {if(typeof op.text!=='string'||op.text.length>8192)throw new Error('HTMX_BRIDGE: text limit');body=escapeHtml(op.text);}
    else {validateTree(op.children,origin,[op.id]);body=op.children.map(encodeNode).join('');}
    frames.push('<div id="'+escapeHtml(op.id)+'" hx-swap-oob="innerHTML">'+body+'</div>');
  }
  const result=frames.join('');
  if(new TextEncoder().encode(result).length>MAX_FRAME)throw new Error('HTMX_BRIDGE: outgoing payload too large');
  return result;
}
export function parseHtmxWsForm(raw) {
  if(typeof raw!=='string' || new TextEncoder().encode(raw).length>MAX_FRAME)throw new Error('HTMX_BRIDGE: frame budget');
  const obj=JSON.parse(raw);
  if(!obj || typeof obj!=='object'||Array.isArray(obj))throw new Error('HTMX_BRIDGE: invalid form');
  const {event,event_id,base_rev,csrf,...other}=obj;
  if(!EVENT_ID.test(event_id||'') || !Number.isSafeInteger(base_rev)||base_rev<0 || typeof csrf!=='string'||csrf.length<16)throw new Error('HTMX_BRIDGE: invalid replay/CSRF fields');
  const payload=Object.create(null);
  for(const [k,v] of Object.entries(other)) {
    if(k==='HEADERS')continue; // Untrusted client-supplied HX headers are not authentication.
    if(k==='__proto__'||k==='constructor'||k==='prototype')throw new Error('HTMX_BRIDGE: unsafe field');
    payload[k]=v;
  }
  validateEvent(event,payload);
  // Server must compare csrf to a session-bound secret AND verify HTTP upgrade Origin/auth.
  return {v:1,type:'event',event_id,name:event,payload,base_rev,csrf};
}
