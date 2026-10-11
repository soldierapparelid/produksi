'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
function transport(mode='gas'){
  const timers=new Map(),calls=[];let serial=0,ok,fail,aborted=0;
  const runner={withSuccessHandler(fn){ok=fn;return this;},withFailureHandler(fn){fail=fn;return this;},api(body){calls.push(JSON.parse(body));}};
  function element(){const classes=new Set();return {children:[],disabled:false,classList:{add(c){classes.add(c);},remove(c){classes.delete(c);},contains(c){return classes.has(c);}},setAttribute(k,v){this[k]=v;},appendChild(el){this.children.push(el);},textContent:''};}
  const c=vm.createContext({console,google:{script:{run:runner}},window:mode==='gas'?{google:{script:{run:runner}}}:{},navigator:{onLine:true},location:{hash:'',search:'',origin:'https://example.test',pathname:'/'},fetch(url,opt){return new Promise((resolve,reject)=>{calls.push({url,opt,resolve,reject});ok=resolve;fail=reject;});},AbortController:class{constructor(){this.signal={};}abort(){aborted++;}},setTimeout(fn,ms){const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},document:{createElement:element}});
  vm.runInContext(`var LS={get:function(k){return k==='pk_api'?'deployment_example123456789':'';},set:function(){}},DIV_APP={},DIVISI={},A={},S={busy:0,token:'test_session',state:{workflowVersion:2},seq:0};
    var paints=0,applied=0,refreshed=0,toasts=[],sheets=[],dropped=0;
    function paintSync(){paints++;}function applyState(){applied++;}function refresh(){refreshed++;}function toast(m){toasts.push(m);}function quiet(){}
    function signOutLocal(){}function $(selector,n){return n;}function dropSheet(i){sheets.splice(i,1);dropped++;}
  `,c);
  vm.runInContext(part('var Api = (function () {','/* ---------- state ---------- */'),c);vm.runInContext('Api.init()',c);
  vm.runInContext(part('function req(', 'function signOutLocal('),c);
  vm.runInContext(part('A.confirmOk =','function quiet()'),c);
  const run=code=>vm.runInContext(code,c);
  return {run,timers,calls,ok:value=>ok(value),fail:error=>fail(error),element,aborted:()=>aborted,fire(ms){const entry=[...timers].find(([id,t])=>t.ms===ms);assert.ok(entry,`timer ${ms}`);timers.delete(entry[0]);entry[1].fn();}};
}
test('stalled GAS read releases busy at deadline and ignores a late callback exactly once',async()=>{
  const t=transport();const done=t.run(`req('getState',{}).catch(function(e){return e;})`);
  assert.equal(t.run('S.busy'),1);t.fire(60000);const error=await done;
  assert.equal(error.timeout,true);assert.equal(error.uncertain,false);assert.equal(t.run('S.busy'),0);
  t.ok(JSON.stringify({ok:true,data:{me:{id:'late'}}}));await Promise.resolve();
  assert.equal(t.run('S.busy'),0);assert.equal(t.run('applied'),0);assert.equal(t.calls.length,1);
});
test('stalled mutation marks outcome uncertain without retry, and PWA transport aborts only its wait',async()=>{
  for(const mode of ['gas','remote']){
    const t=transport(mode),done=t.run(`req('deleteRecord',{sheet:'SlipUpah',id:'payment1'}).catch(function(e){return e;})`);
    t.fire(90000);const error=await done;
    assert.equal(error.uncertain,true);assert.match(error.message,/mungkin sudah tersimpan/);assert.equal(t.run('S.busy'),0);assert.equal(t.calls.length,1);
    if(mode==='remote')assert.equal(t.aborted(),1);
  }
});
test('server rejection is certain and clears its deadline; PDF deadlines do not imply payment uncertainty',async()=>{
  const t=transport(),done=t.run(`req('deleteRecord',{sheet:'SlipUpah',id:'paid'}).catch(function(e){return e;})`);
  t.ok(JSON.stringify({ok:false,error:'Slip historis tidak dapat dihapus.'}));const error=await done;
  assert.equal(error.uncertain,undefined);assert.match(error.message,/historis/);assert.equal(t.timers.size,0);assert.equal(t.run('S.busy'),0);
  const pdf=t.run(`req('makeGajiPdf',{periode:'2026-W40'}).catch(function(e){return e;})`);t.fire(60000);assert.equal((await pdf).uncertain,false);
});
test('login timeout offers a manual new PIN attempt and never uses the payment uncertainty message',async()=>{
  const t=transport(),done=t.run(`Api.call('login',{userId:'worker',pin:'1234'}).catch(function(e){return e;})`);
  t.fire(90000);const error=await done;
  assert.equal(error.timeout,true);assert.equal(error.uncertain,false);assert.match(error.message,/masukkan PIN dan coba masuk lagi/);
  assert.doesNotMatch(error.message,/Perubahan|data terbaru|tersimpan/);assert.equal(t.calls.length,1);
  t.ok(JSON.stringify({ok:true,data:{token:'late-session',state:{me:{id:'worker'}}}}));assert.equal(t.calls.length,1);
});
test('confirmation suppresses duplicate cancellation and timeout leaves a clear status-check action rather than a retry',async()=>{
  const t=transport(),button=t.element(),container=t.element();
  t.run(`sheets.push({node:{children:[],appendChild:function(n){this.children.push(n);}}});S.confirm=function(el){return act(el,req('deleteRecord',{sheet:'SlipUpah',id:'payment1'}));};`);
  t.run('var clickButton=null');
  const c=t.run('sheets[0].node');c.appendChild=container.appendChild.bind(container);
  // Pass the real fake button through a callback; no generated DOM controls need to be executed.
  const fn=t.run('A.confirmOk'),done=fn(button);fn(button);
  assert.equal(t.calls.length,1);assert.equal(button.disabled,true);assert.equal(button.classList.contains('loading'),true);
  t.fire(90000);await done;
  assert.equal(button.classList.contains('loading'),false);assert.equal(button.disabled,true);assert.equal(t.run('sheets[0].uncertain'),true);
  assert.match(container.children[0].textContent,/mungkin sudah tersimpan/);
  assert.equal(container.children[0].children[0]['data-a'],'confirmRefresh');fn(button);assert.equal(t.calls.length,1);assert.equal(t.run('dropped'),0);
});
test('status check after an uncertain cancellation only reads current state and closes the confirmation',async()=>{
  const t=transport(),button=t.element();t.run('sheets.push({uncertain:true});');
  const done=t.run('A.confirmRefresh')(button);
  assert.equal(t.calls[0].action,'getState');t.ok(JSON.stringify({ok:true,data:{me:{id:'owner'}}}));await done;
  assert.equal(t.run('applied'),1);assert.equal(t.run('dropped'),1);assert.equal(t.calls.length,1);
});
test('synchronous action failure and transport construction failure never strand loading or busy state',async()=>{
  const t=transport(),button=t.element();t.run(`sheets.push({});S.confirm=function(){throw new Error('Invalid local form');};`);
  t.run('A.confirmOk')(button);assert.equal(t.run('sheets[0].sending'),false);assert.equal(button.disabled,false);
  const done=t.run(`Api.call=function(){throw new Error('serialize failed');};req('getState',{}).catch(function(e){return e;})`);
  assert.match((await done).message,/serialize failed/);assert.equal(t.run('S.busy'),0);
});
/* 1.5.26: jawaban server yang hilang di perjalanan (server sudah selesai, jawabannya tidak sampai) */
const napas=()=>new Promise(r=>setImmediate(r));
const jawab=data=>({ok:true,status:200,json(){return Promise.resolve({ok:true,data});}});
const susulan=t=>[...t.timers.values()].filter(x=>x.ms===5000).length;
test('a lost answer to a read is asked again by itself and the first answer that arrives is used',async()=>{
  const t=transport('remote'),done=t.run("Api.call('getState',{token:'s'})");
  assert.equal(t.calls.length,1);t.calls[0].reject(new TypeError('Failed to fetch'));await napas();
  assert.equal(t.calls.length,2,'asked again without the user');assert.deepEqual(JSON.parse(t.calls[1].opt.body),JSON.parse(t.calls[0].opt.body));
  t.calls[1].resolve({ok:false,status:404,json(){return Promise.reject(new Error('html'));}});await napas();
  assert.equal(t.calls.length,3,'an error page instead of the answer counts as lost');
  t.calls[2].resolve(jawab({me:{id:'owner'}}));assert.equal((await done).me.id,'owner');
  assert.equal(t.timers.size,0);assert.equal(t.calls.length,3);
});
test('a main read that stays silent gets a follow-up request; the late twin is dropped',async()=>{
  const t=transport('remote'),done=t.run("Api.call('sync',{token:'s',ver:7})");
  assert.equal(susulan(t),1);t.fire(5000);assert.equal(t.calls.length,2);
  t.calls[1].resolve(jawab({same:true,ver:7}));assert.equal((await done).same,true);
  assert.equal(t.aborted(),1,'the request still waiting is released');assert.equal(t.timers.size,0);
  t.calls[0].resolve(jawab({same:false}));await napas();assert.equal(t.calls.length,2);
});
test('an answer that has started to arrive stops the follow-up requests',async()=>{
  const t=transport('remote');let isi;const done=t.run("Api.call('getState',{token:'s'})");
  t.calls[0].resolve({ok:true,status:200,json(){return new Promise(r=>{isi=r;});}});await napas();
  assert.equal(susulan(t),0);assert.equal(t.calls.length,1);
  isi({ok:true,data:{me:{id:'owner'}}});assert.equal((await done).me.id,'owner');
});
test('reads stop after their attempts with the ordinary server message',async()=>{
  const t=transport('remote'),done=t.run("Api.call('bootstrap',{}).catch(function(e){return e;})");
  for(let i=0;i<3;i++){assert.equal(t.calls.length,i+1);t.calls[i].reject(new TypeError('Failed to fetch'));await napas();}
  const error=await done;assert.equal(error.net,true);assert.match(error.message,/Server tidak bisa dihubungi/);assert.equal(t.calls.length,3);assert.equal(t.timers.size,0);
  const gambar=transport('remote'),g=gambar.run("Api.call('getGambar',{token:'s',ids:['a']}).catch(function(e){return e;})");
  assert.equal(susulan(gambar),0,'pictures are only asked again after a failure');
  for(let i=0;i<3;i++){gambar.calls[i].reject(new TypeError('Failed to fetch'));await napas();}
  assert.equal((await g).net,true);assert.equal(gambar.calls.length,3);
});
test('a save, a login, a PDF and the warm-up are never sent twice',async()=>{
  for(const [action,pola] of [['deleteRecord',/mungkin sudah tersimpan/],['catatSetor',/mungkin sudah tersimpan/],['login',/masukkan PIN dan coba lagi/],['makeGajiPdf',/Server tidak bisa dihubungi/],['hangat',/Server tidak bisa dihubungi/]]){
    const t=transport('remote'),done=t.run(`Api.call(${JSON.stringify(action)},{token:'s'}).catch(function(e){return e;})`);
    assert.equal(susulan(t),0,action);t.calls[0].reject(new TypeError('Failed to fetch'));await napas();
    const error=await done;assert.match(error.message,pola,action);assert.equal(t.calls.length,1,action);
  }
});
test('a server refusal is an answer: it is shown, not asked again',async()=>{
  const t=transport('remote'),done=t.run("Api.call('getState',{token:'old'}).catch(function(e){return e;})");
  t.calls[0].resolve({ok:true,status:200,json(){return Promise.resolve({ok:false,error:'Sesi berakhir. Silakan login.'});}});
  assert.match((await done).message,/Sesi berakhir/);assert.equal(t.calls.length,1);assert.equal(t.timers.size,0);
});
test('the overall deadline of a read releases every waiting request',async()=>{
  const t=transport('remote'),done=t.run("Api.call('getState',{token:'s'}).catch(function(e){return e;})");
  t.fire(5000);assert.equal(t.calls.length,2);assert.equal(susulan(t),0);t.fire(60000);
  const error=await done;assert.equal(error.timeout,true);assert.equal(t.aborted(),2);assert.equal(t.timers.size,0);
  t.calls[0].reject(new Error('aborted'));await napas();assert.equal(t.calls.length,2,'nothing is sent after the deadline');
});
test('an old request cannot install previous account state or sign out a newer session',async()=>{
  for(const rejected of [false,true]){
    const t=transport(),done=t.run("req('getState',{}).catch(function(e){return e;})");
    t.run("S.token='new_session';S.state={me:{id:'new-user'}};var signouts=0;signOutLocal=function(){signouts++;}");
    if(rejected)t.ok(JSON.stringify({ok:false,error:'Sesi berakhir. Silakan login.'}));
    else t.ok(JSON.stringify({ok:true,data:{state:{me:{id:'previous-user'}},data:{}}}));
    await done;
    assert.equal(t.run('S.token'),'new_session');assert.equal(t.run('S.state.me.id'),'new-user');assert.equal(t.run('applied'),0);assert.equal(t.run('signouts'),0);assert.equal(t.run('S.busy'),0);
  }
});
