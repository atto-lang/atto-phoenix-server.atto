import {OresLiveView} from './liveview.mjs';
const response=await fetch('/bootstrap.json',{credentials:'same-origin',cache:'no-store'});
if(!response.ok)throw new Error('LiveView bootstrap not authenticated');
const {session_id,csrf}=await response.json();
const root=document.getElementById('root');
const live=new OresLiveView({root,url:`${location.protocol==='https:'?'wss':'ws'}://${location.host}/live`,sessionId:session_id,csrfToken:csrf,onError:error=>console.error('LiveView reference:',error)});
live.start();
window.addEventListener('pagehide',()=>live.close(),{once:true});
