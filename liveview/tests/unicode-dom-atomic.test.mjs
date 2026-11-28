// Browser DOM write boundary: validation must finish before any mutation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPatch,applySnapshot,validateTree} from '../web/liveview.mjs';
const origin='https://example.test';
class Element {
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.parentNode=null;this.children=[];this.attrs={};this.id='';this.textContent='';}
  setAttribute(key,value){this.attrs[key]=value;if(key==='id')this.id=value;}
  getAttribute(key){return this.attrs[key]??null;}
  removeAttribute(key){delete this.attrs[key];}
  appendChild(child){
    if(child.tagName==='#FRAGMENT') {for(const node of [...child.children])this.appendChild(node);return;}
    this.children.push(child);child.parentNode=this;
  }
  replaceChildren(...children){this.children=[];for(const child of children)this.appendChild(child);}
  contains(other){return other===this||this.children.some(child=>child.contains(other));}
}
function mount(){
  const doc={roots:[],createElement(t){return new Element(t,this);},createDocumentFragment(){return new Element('#fragment',this);},
    createTextNode(s){const el=new Element('#text',this);el.textContent=s;return el;},
    getElementById(id){const find=n=>n.id===id?n:n.children.map(find).find(Boolean);return this.roots.map(find).find(Boolean)||null;}};
  const r=doc.createElement('main');r.id='root';doc.roots=[r];return r;
}
const baseline=[{tag:'span',id:'status',attrs:{title:'old'},text:'old'},{tag:'span',id:'other',text:'ok'}];

test('browser rejects malformed snapshot without replacing existing content',()=>{
  const root=mount();applySnapshot(root,baseline,origin);
  for(const bad of [
    [{tag:'span',id:'new',text:'\uD800'}],
    [{tag:'span',id:'new',attrs:{title:'\uDC00'}}],
    [{tag:'span',id:'new',attrs:{href:'https://example.test/\uDFFF'}}]
  ]){
    assert.throws(()=>applySnapshot(root,bad,origin),/Unicode/);
    assert.equal(root.ownerDocument.getElementById('status').textContent,'old');
    assert.equal(root.ownerDocument.getElementById('new'),null);
  }
});

test('browser patch rejects malformed Unicode after earlier valid operations atomically',()=>{
  const root=mount();applySnapshot(root,baseline,origin);
  for(const invalid of ['\uD800','x\uDFFFy']){
    assert.throws(()=>applyPatch(root,[
      {op:'set_attr',id:'status',name:'title',value:'updated'},
      {op:'set_text',id:'other',text:invalid}
    ],origin),/Unicode/);
    assert.equal(root.ownerDocument.getElementById('status').getAttribute('title'),'old');
    assert.equal(root.ownerDocument.getElementById('other').textContent,'ok');
  }
});

test('browser rejects malformed nested replacement children without deleting existing nodes',()=>{
  const root=mount();applySnapshot(root,baseline,origin);
  assert.throws(()=>applyPatch(root,[
    {op:'replace_children',id:'status',children:[{tag:'em',id:'child',text:'bad\uD800'}]}
  ],origin),/Unicode/);
  assert.equal(root.ownerDocument.getElementById('status').textContent,'old');
  assert.equal(root.ownerDocument.getElementById('child'),null);
});

test('browser accepts valid surrogate pairs for text, attributes and URLs',()=>{
  const root=mount();applySnapshot(root,baseline,origin);
  assert.equal(validateTree([{tag:'a',id:'link',attrs:{href:'/hello/🌍',title:'Earth 🌐'},text:'Hi 😃'}],origin),true);
  applyPatch(root,[{op:'set_text',id:'other',text:'Hello 🌐'},
    {op:'set_attr',id:'status',name:'title',value:'Earth 🌍'}],origin);
  assert.equal(root.ownerDocument.getElementById('other').textContent,'Hello 🌐');
  assert.equal(root.ownerDocument.getElementById('status').getAttribute('title'),'Earth 🌍');
});
