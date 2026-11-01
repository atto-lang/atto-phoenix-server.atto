// Host-only reference model of a serial, actor-owned Oreslang LiveView session.
// It does NOT implement a WebSocket listener, authenticate cookies, or execute .ores.
import {validateTree, validateEvent, MAX_FRAME, VERSION} from '../web/liveview.mjs';
import {timingSafeEqual} from 'node:crypto';
const EVENT_ID=/^[0-9a-fA-F-]{8,128}$/;
const freeze = value => structuredClone(value);
function assert(cond,msg) { if(!cond) throw new Error('ORES_LIVEVIEW_SERVER: '+msg); }
function indexNodes(nodes,map=new Map()) {
  for(const n of nodes) if(typeof n!=='string') {map.set(n.id,n);indexNodes(n.children||[],map);}
  return map;
}
function same(a,b) { return JSON.stringify(a)===JSON.stringify(b); }
export function diffView(previous,next,rootId='root') {
  const ops=[];
  function walk(parentId,oldList,newList) {
    if(oldList.length!==newList.length || oldList.some((n,i)=>typeof n!==typeof newList[i] || (typeof n==='string'?n!==newList[i]:n.id!==newList[i].id || n.tag!==newList[i].tag))) {
      ops.push({op:'replace_children',id:parentId,children:newList}); return;
    }
    for(let i=0;i<oldList.length;i++) {
      const old=oldList[i],cur=newList[i];
      if(typeof old==='string') continue;
      const oldAttrs=old.attrs||{}, newAttrs=cur.attrs||{};
      for(const [key,value] of Object.entries(newAttrs)) if(oldAttrs[key]!==value && key!=='id') ops.push({op:'set_attr',id:cur.id,name:key,value});
      for(const key of Object.keys(oldAttrs)) if(!(key in newAttrs) && key!=='id') ops.push({op:'remove_attr',id:cur.id,name:key});
      if(old.text!==cur.text) {
        if(cur.text!==undefined) ops.push({op:'set_text',id:cur.id,text:cur.text});
        else ops.push({op:'replace_children',id:cur.id,children:cur.children||[]});
      } else if(cur.text===undefined) walk(cur.id,old.children||[],cur.children||[]);
    }
  }
  walk(rootId,previous,next);
  return ops;
}
export class LiveViewSession {
  constructor({viewId,sessionId,csrfToken,rootId='root',origin,initialState,render,reduce,authorize,maxHistory=32,maxDedup=256}) {
    assert(typeof viewId==='string' && typeof sessionId==='string' && typeof csrfToken==='string' && csrfToken.length>=16,'identity/CSRF required');
    assert(typeof render==='function' && typeof reduce==='function','callbacks required');
    assert(typeof authorize==='function','authenticated transport guard required');
    assert(Number.isSafeInteger(maxHistory) && maxHistory>=1 && maxHistory<=256,'invalid replay history bound');
    assert(Number.isSafeInteger(maxDedup) && maxDedup>=1 && maxDedup<=4096,'invalid event replay bound');
    this.viewId=viewId; this.sessionId=sessionId; this.csrfToken=csrfToken; this.rootId=rootId; this.origin=origin; this.joined=new Set();
    this.state=freeze(initialState); this.render=render; this.reduce=reduce;
    this.authorize=authorize; this.maxHistory=maxHistory; this.maxDedup=maxDedup;
    this.revision=0; this.history=[]; this.seen=new Map(); this.subscribers=new Map();
    this.tree=render(freeze(this.state));validateTree(this.tree,origin,[rootId]);
    this._packet(this._snapshot()); // initial state must fit a complete wire snapshot
    // The root ID used by diffView is the DOM mount ID. Callers may configure it.
  }
  // Only the authenticated WebSocket transport can install a subscriber.
  // Publish after a successful state/revision commit; a slow peer must never
  // roll back an already committed event or block another session.
  attach(connectionId, send) {
    assert(typeof connectionId==='string' && connectionId.length>0 && typeof send==='function', 'invalid subscription');
    this.subscribers.set(connectionId,send);
  }
  detach(connectionId) { this.joined.delete(connectionId); this.subscribers.delete(connectionId); }
  _broadcast(senderId, frame) {
    for(const [id,send] of this.subscribers) {
      if(id===senderId || !this.joined.has(id))continue;
      try {send(frame);} catch {this.detach(id);}
    }
  }
  _snapshot() { return {v:VERSION,type:'snapshot',rev:this.revision,children:freeze(this.tree)}; }
  _ready() { return {v:VERSION,type:'ready',rev:this.revision}; }
  _packet(frame) { assert(new TextEncoder().encode(JSON.stringify(frame)).length<=MAX_FRAME,'outgoing frame too large'); return frame; }
  receive(frame,transport) {
    assert(frame && typeof frame==='object' && !Array.isArray(frame) && frame.v===VERSION,'unsupported protocol');
    assert(new TextEncoder().encode(JSON.stringify(frame)).length<=MAX_FRAME,'incoming frame too large');
    // Auth must be bound to the actual HTTP-upgraded connection, not user-provided envelope fields.
    assert(transport && typeof transport.connectionId==='string' && transport.connectionId.length>0,'connection identity required');
    assert(this.authorize(transport,frame)===true,'unauthorized transport');
    assert(frame.view_id===undefined || frame.view_id===this.viewId,'wrong view');
    if(frame.type==='join') {
      assert(frame.session_id===this.sessionId && typeof frame.csrf==='string','session mismatch');
      const supplied=Buffer.from(frame.csrf), expected=Buffer.from(this.csrfToken);
      assert(supplied.length===expected.length && timingSafeEqual(supplied,expected),'CSRF mismatch');
      assert(transport.origin===this.origin,'origin mismatch');
      assert(Number.isSafeInteger(frame.resume_rev) && frame.resume_rev>=-1,'invalid resume revision');
      this.joined.add(transport.connectionId);
      if(frame.resume_rev===this.revision) return [this._packet(this._ready())];
      const chain=[]; let rev=frame.resume_rev;
      for(const item of this.history) if(item.prev===rev) {chain.push(item);rev=item.rev;}
      if(rev===this.revision && chain.length>0) return [...chain.map(x=>this._packet(x)),this._packet(this._ready())];
      return [this._packet(this._snapshot()),this._packet(this._ready())];
    }
    assert(this.joined.has(transport.connectionId),'join required before messages');
    if(frame.type==='resync') return [this._packet(this._snapshot()),this._packet(this._ready())];
    if(frame.type!=='event') throw new Error('ORES_LIVEVIEW_SERVER: unsupported event frame');
    assert(EVENT_ID.test(frame.event_id||''),'invalid event ID');
    validateEvent(frame.name,frame.payload);
    if(this.seen.has(frame.event_id)) return [{v:VERSION,type:'event_ack',event_id:frame.event_id,rev:this.seen.get(frame.event_id)}];
    if(!Number.isSafeInteger(frame.base_rev) || frame.base_rev!==this.revision) return [{v:VERSION,type:'resync_required'}];
    const next=this.reduce(freeze(this.state),frame.name,freeze(frame.payload),transport);
    assert(next!==undefined,'reducer returned undefined');
    const tree=this.render(freeze(next));validateTree(tree,this.origin,[this.rootId]);
    const ops=diffView(this.tree,tree,this.rootId);
    // Patch is rejected before committing if it cannot fit; use snapshot when needed.
    const rev=this.revision+1;
    let patch={v:VERSION,type:'patch',prev:this.revision,rev,ops};
    if(new TextEncoder().encode(JSON.stringify(patch)).length>MAX_FRAME || ops.length>128) patch=null;
    const snapshot={v:VERSION,type:'snapshot',rev,children:tree};
    this._packet(patch||snapshot); // check size before state commit
    this.state=freeze(next);this.tree=tree;this.revision=rev;
    this.seen.set(frame.event_id,rev);
    if(this.seen.size>this.maxDedup) this.seen.delete(this.seen.keys().next().value);
    if(patch) {this.history.push(patch);if(this.history.length>this.maxHistory) this.history.shift();}
    else this.history=[];
    this._broadcast(transport.connectionId,patch||snapshot);
    return [patch||snapshot,{v:VERSION,type:'event_ack',event_id:frame.event_id,rev}];
  }
}
