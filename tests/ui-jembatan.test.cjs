'use strict';
/* 1.5.27: jembatan — jalur kedua ke server (google.script.run di bingkai tersembunyi) untuk aplikasi di GitHub Pages. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
const ASAL='https://n-abc123def456-0lu-script.googleusercontent.com';
const napas=()=>new Promise(r=>setImmediate(r));
const jawab=data=>({ok:true,status:200,json(){return Promise.resolve({ok:true,data});}});
function alat({bendera='1',dibingkai=false}={}){
  const timers=new Map(),calls=[],pesan=[],ls={pk_api:'deployment_example123456789'};let serial=0,dengar=null,now=1000000,aborted=0;
  if(bendera)ls.pk_jembatan=bendera;
  function element(){return {children:[],setAttribute(k,v){this[k]=v;},appendChild(el){el.parentNode=this;this.children.push(el);},removeChild(el){this.children=this.children.filter(x=>x!==el);el.parentNode=null;}};}
  const body=element(),win={addEventListener(n,fn){if(n==='message')dengar=fn;}};win.self=win;win.top=dibingkai?{}:win;
  class Jam extends Date{static now(){return now;}}
  const c=vm.createContext({console,window:win,navigator:{onLine:true},location:{hash:'',search:'',origin:'https://example.test',pathname:'/'},Date:Jam,JSON,Object,
    fetch(url,opt){return new Promise((resolve,reject)=>{calls.push({url,opt,resolve,reject});});},
    AbortController:class{constructor(){this.signal={};}abort(){aborted++;}},
    setTimeout(fn,ms){const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},
    document:{createElement:element,body},simpanan:ls});
  vm.runInContext("var LS={get:function(k){return simpanan[k]||'';},set:function(k,v){simpanan[k]=String(v);},del:function(k){delete simpanan[k];}},DIV_APP={},DIVISI={};",c);
  vm.runInContext(part('var Api = (function () {','/* ---------- state ---------- */'),c);vm.runInContext('Api.init()',c);
  /* susunan halaman Apps Script: bingkai kita -> bingkai pengaman -> bingkai isi (yang mengirim pesan) */
  function isiBingkai(frame){const w0={parent:win},w1={parent:w0},w2={parent:w1,postMessage(m,asal){pesan.push({m,asal});}};frame.contentWindow=w0;return w2;}
  const t={c,ls,timers,calls,pesan,body,run:code=>vm.runInContext(code,c),aborted:()=>aborted,maju(ms){now+=ms;},
    bingkai:()=>body.children[body.children.length-1],
    terima(data,origin,source){dengar({data,origin,source});},
    siap(){const w=isiBingkai(t.bingkai());t.terima({pk:'jembatan-siap'},ASAL,w);return w;},
    balas(w,d){const p=pesan[pesan.length-1];t.terima(Object.assign({pk:'api',id:p.m.id},d),ASAL,w);},
    ada(ms){return [...timers.values()].some(x=>x.ms===ms);},
    fire(ms){const e=[...timers].find(([id,x])=>x.ms===ms);assert.ok(e,`timer ${ms}`);timers.delete(e[0]);e[1].fn();}};
  return t;
}
const teks=data=>JSON.stringify({ok:true,data});

test('the bridge starts only when the server allowed it, and is removed when the server no longer does',async()=>{
  const lama=alat({bendera:''});assert.equal(lama.body.children.length,0,'no frame before the server said so');
  let done=lama.run("Api.call('bootstrap',{})");lama.calls[0].resolve(jawab({users:[],jembatan:1}));await done;
  assert.equal(lama.ls.pk_jembatan,'1');assert.equal(lama.body.children.length,1);
  const f=lama.bingkai();assert.match(f.src,/^https:\/\/script\.google\.com\/macros\/s\/deployment_example123456789\/exec\?jembatan=1$/);
  assert.equal(f['aria-hidden'],'true');assert.match(f.style,/width:0;height:0/);
  const baru=alat();assert.equal(baru.body.children.length,1,'remembered on this device: started at once');
  done=baru.run("Api.call('bootstrap',{})");baru.calls[0].resolve(jawab({users:[]}));await done;
  assert.equal(baru.ls.pk_jembatan,undefined);assert.equal(baru.body.children.length,0,'an older server: plain path only');
  const dibingkai=alat({dibingkai:true});assert.equal(dibingkai.body.children.length,0,'never inside another site\'s frame');
});
test('only the bridge page inside our own frame is believed',async()=>{
  const t=alat(),w=t.siap.bind(t);const asing={parent:{parent:{parent:{}}},postMessage(){throw new Error('must not be used');}};
  const frame=t.bingkai(),w0={parent:t.c.window},w2={parent:{parent:w0},postMessage(m,asal){t.pesan.push({m,asal});}};frame.contentWindow=w0;
  t.terima({pk:'jembatan-siap'},ASAL,asing);
  t.terima({pk:'jembatan-siap'},'https://evil.example',w2);
  t.terima({pk:'jembatan-siap'},'https://script.googleusercontent.com.evil.example',w2);
  t.terima('jembatan-siap',ASAL,w2);
  let done=t.run("Api.call('getState',{token:'s'})");assert.equal(t.calls.length,1,'not ready: ordinary path');assert.equal(t.pesan.length,0);
  t.terima({pk:'jembatan-siap'},ASAL,w2);await napas();
  assert.equal(t.pesan.length,1,'ready: the waiting read is also sent over the bridge');assert.equal(t.pesan[0].asal,ASAL);
  t.terima({pk:'api',id:t.pesan[0].m.id,ok:true,s:teks({me:{id:'palsu'}})},ASAL,asing);await napas();
  t.terima({pk:'api',id:t.pesan[0].m.id,ok:true,s:teks({me:{id:'owner'}})},ASAL,w2);
  assert.equal((await done).me.id,'owner');assert.equal(t.aborted(),1,'the ordinary request is released');assert.equal(t.timers.size,0);void w;
});
test('a save goes over the bridge once and never falls back by itself',async()=>{
  const t=alat(),w=t.siap();
  let done=t.run("Api.call('catatSetor',{token:'s',id:'a1'})");
  assert.equal(t.calls.length,0);assert.equal(t.pesan.length,1);assert.deepEqual(JSON.parse(t.pesan[0].m.body),{action:'catatSetor',payload:{token:'s',id:'a1'}});
  assert.equal(t.ada(8000),false,'no second path for a save');
  t.balas(w,{ok:true,s:teks({id:'a1'})});assert.equal((await done).id,'a1');assert.equal(t.timers.size,0);
  done=t.run("Api.call('catatSetor',{token:'s',id:'a2'}).catch(function(e){return e;})");
  t.balas(w,{ok:false,e:'NetworkError'});const galat=await done;
  assert.equal(galat.uncertain,true);assert.match(galat.message,/mungkin sudah tersimpan/);assert.equal(t.calls.length,0,'not sent again');
  const t2=alat(),w2=t2.siap();done=t2.run("Api.call('catatSetor',{token:'s',id:'a3'})");
  t2.balas(w2,{ok:false,belum:true,e:'x'});await napas();
  assert.equal(t2.calls.length,1,'certainly not delivered: ordinary path, once');t2.calls[0].resolve(jawab({id:'a3'}));assert.equal((await done).id,'a3');
  const t3=alat(),w3=t3.siap();done=t3.run("Api.call('login',{userId:'u',pin:'0000'}).catch(function(e){return e;})");
  assert.equal(t3.pesan.length,1);t3.balas(w3,{ok:true,s:JSON.stringify({ok:false,error:'PIN salah.'})});
  assert.match((await done).message,/PIN salah/);assert.equal(t3.calls.length,0);
});
test('a read uses the bridge first; a silent bridge brings in the ordinary path and the first answer wins',async()=>{
  const t=alat(),w=t.siap();
  let done=t.run("Api.call('sync',{token:'s',ver:3})");assert.equal(t.calls.length,0);assert.equal(t.pesan.length,1);
  t.balas(w,{ok:true,s:teks({same:true,ver:3})});assert.equal((await done).same,true);assert.equal(t.timers.size,0);
  done=t.run("Api.call('getState',{token:'s'})");t.fire(8000);assert.equal(t.calls.length,1,'bridge silent for 8 s');
  t.balas(w,{ok:true,s:teks({me:{id:'owner'}})});assert.equal((await done).me.id,'owner');assert.equal(t.aborted(),1);assert.equal(t.timers.size,0);
  const lama=t.bingkai();done=t.run("Api.call('getState',{token:'s'})");t.fire(8000);
  t.calls[1].resolve(jawab({me:{id:'owner'}}));assert.equal((await done).me.id,'owner');
  assert.notEqual(t.bingkai(),lama,'a bridge that did not answer is replaced in the background');assert.equal(t.body.children.length,1);
  const t2=alat(),w2=t2.siap();done=t2.run("Api.call('getState',{token:'s'})");
  t2.balas(w2,{ok:false,e:'NetworkError'});await napas();assert.equal(t2.calls.length,1,'bridge failed: ordinary path at once');
  t2.calls[0].resolve(jawab({me:{id:'owner'}}));assert.equal((await done).me.id,'owner');
});
test('while the bridge is still loading a read does not wait, and a save waits only briefly',async()=>{
  const t=alat();
  let done=t.run("Api.call('catatSetor',{token:'s',id:'b1'})");assert.equal(t.calls.length,0);assert.equal(t.pesan.length,0);assert.equal(t.ada(4000),true);
  const w=t.siap();assert.equal(t.pesan.length,1);assert.equal(t.calls.length,0);assert.equal(t.ada(4000),false);
  t.balas(w,{ok:true,s:teks({id:'b1'})});assert.equal((await done).id,'b1');
  const t2=alat();done=t2.run("Api.call('catatSetor',{token:'s',id:'b2'})");t2.fire(4000);assert.equal(t2.calls.length,1);
  t2.siap();assert.equal(t2.pesan.length,0,'already sent the ordinary way: not sent twice');
  t2.calls[0].resolve(jawab({id:'b2'}));assert.equal((await done).id,'b2');assert.equal(t2.timers.size,0);
  const t3=alat();t3.maju(16000);done=t3.run("Api.call('catatSetor',{token:'s',id:'b3'})");
  assert.equal(t3.calls.length,1,'a bridge that never came up is not waited for');t3.calls[0].resolve(jawab({id:'b3'}));await done;
});
test('an old bridge page is replaced before use, and a bridge that keeps failing is switched off on this device',async()=>{
  const t=alat();let w=t.siap();const lama=t.bingkai();
  t.maju(31*60000);let done=t.run("Api.call('sync',{token:'s',ver:1})");
  assert.notEqual(t.bingkai(),lama);assert.equal(t.calls.length,1,'while the new page loads the ordinary path is used');
  w=t.siap();assert.equal(t.pesan.length,1);t.balas(w,{ok:true,s:teks({same:true})});await done;
  for(let i=0;i<6;i++){
    assert.equal(t.body.children.length,1,'attempt '+i);w=t.siap();const sebelum=t.calls.length;
    done=t.run("Api.call('sync',{token:'s',ver:1})");t.balas(w,{ok:false,e:'NetworkError'});await napas();
    t.calls[sebelum].resolve(jawab({same:true}));await done;
  }
  assert.equal(t.body.children.length,0,'switched off after repeated failures');
  done=t.run("Api.call('sync',{token:'s',ver:1})");assert.equal(t.pesan.length,7);t.calls[t.calls.length-1].resolve(jawab({same:true}));await done;
});
test('server: bootstrap announces the bridge, and the bridge page serves only the app address',()=>{
  const h=harness(),dibuat=[];
  h.context.HtmlService={XFrameOptionsMode:{ALLOWALL:'ALLOWALL'},
    createHtmlOutput(isi){const o={isi,setTitle(v){o.judul=v;return o;},setXFrameOptionsMode(v){o.bingkai=v;return o;},addMetaTag(){return o;}};dibuat.push(o);return o;},
    createHtmlOutputFromFile(){return {getContent(){return '<html>__PK_DIV__</html>';}};}};
  assert.equal(h.request('bootstrap').data.jembatan,1);assert.equal(h.request('hangat').data.jembatan,undefined);
  h.run("doGet({parameter:{jembatan:'1'}});doGet({parameter:{d:'qc'}});doGet({parameter:{jembatan:'0'}});");
  assert.equal(dibuat.length,3);assert.equal(dibuat[0].bingkai,'ALLOWALL');assert.equal(dibuat[1].bingkai,undefined,'the app page keeps the default framing rule');assert.equal(dibuat[2].bingkai,undefined);
  const js=dibuat[0].isi.match(/<script>([\s\S]*)<\/script>/)[1],keAtas=[],dipanggil=[];let dengar,ok,gagal;
  const jalan={withSuccessHandler(fn){ok=fn;return jalan;},withFailureHandler(fn){gagal=fn;return jalan;},api(b){dipanggil.push(b);}};
  vm.runInNewContext(js,{window:{addEventListener(n,fn){if(n==='message')dengar=fn;},top:{postMessage(m,asal){keAtas.push([m,asal]);}}},google:{script:{run:jalan}}});
  assert.deepEqual(JSON.parse(JSON.stringify(keAtas)),[[{pk:'jembatan-siap'},'https://soldierapparelid.github.io']]);
  const balasan=[],sumber={postMessage(m,asal){balasan.push([m,asal]);}};
  dengar({origin:'https://evil.example',source:sumber,data:{pk:'api',id:'j1',body:'{}'}});
  dengar({origin:'https://soldierapparelid.github.io',source:sumber,data:{pk:'lain',id:'j1',body:'{}'}});
  dengar({origin:'https://soldierapparelid.github.io',source:sumber,data:{pk:'api',id:'j1',body:{}}});
  assert.equal(dipanggil.length,0);
  dengar({origin:'https://soldierapparelid.github.io',source:sumber,data:{pk:'api',id:'j2',body:'{"action":"hangat"}'}});
  assert.deepEqual(dipanggil,['{"action":"hangat"}']);ok('{"ok":true}');gagal(new Error('putus'));
  assert.deepEqual(JSON.parse(JSON.stringify(balasan)),[[{ok:true,s:'{"ok":true}',pk:'api',id:'j2'},'https://soldierapparelid.github.io'],[{ok:false,e:'putus',pk:'api',id:'j2'},'https://soldierapparelid.github.io']]);
});
