/* ===================== 核心：状态/存储/工具 ===================== */
const STORE_KEY='health_app_v1';

const defaultState={
  reports:[],
  treatments:[],
  symptoms:[],
  meds:[],
  markers:[]
};

let state=JSON.parse(JSON.stringify(defaultState));

function load(){
  try{
    const raw=localStorage.getItem(STORE_KEY);
    if(raw){state=Object.assign(JSON.parse(JSON.stringify(defaultState)),JSON.parse(raw));}
  }catch(e){console.error('load failed',e);}
}

function save(){
  try{
    localStorage.setItem(STORE_KEY,JSON.stringify(state));
  }catch(e){
    console.error('save failed',e);
    toast('保存失败，可能存储空间不足');
  }
}

function $(id){return document.getElementById(id);}

function esc(s){
  if(!s)return'';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function toast(msg){
  const el=$('toast');
  if(!el)return;
  el.textContent=msg;
  el.hidden=false;
  clearTimeout(toast._t);
  toast._t=setTimeout(()=>{el.hidden=true;},2500);
}

function openModal(html){
  const mask=$('modal'),body=$('modalBody');
  if(!mask||!body)return;
  body.innerHTML=html;
  mask.hidden=false;
}

function closeModal(){
  const mask=$('modal');
  if(mask)mask.hidden=true;
}

/* 点击遮罩关闭 */
document.addEventListener('DOMContentLoaded',()=>{
  const mask=$('modal');
  if(mask)mask.addEventListener('click',e=>{if(e.target===mask)mask.hidden=true;});
});

/* Service Worker 注册（可选，小米有问题就注释掉） */
if('serviceWorker' in navigator&&location.protocol==='https:'){
  // navigator.serviceWorker.register('sw.js').catch(()=>{});
}
