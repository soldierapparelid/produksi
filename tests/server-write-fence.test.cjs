'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
const source=['src/core.js','apps-script/Server.gs'].map(p=>fs.readFileSync(path.resolve(__dirname,'..',p),'utf8')).join('\n');
function device(h){
  const context=vm.createContext(Object.fromEntries(['Date','console','PropertiesService','CacheService','SpreadsheetApp','LockService','Utilities'].map(k=>[k,h.context[k]])));
  vm.runInContext(source,context);
  function run(code){const result=vm.runInContext(code,context);return result===undefined?undefined:JSON.parse(JSON.stringify(result));}
  return {context,run,request(action,payload={}){return JSON.parse(run(`api(${JSON.stringify(JSON.stringify({action,payload:{clientVersion:run('APP_VERSION'),...payload}}))})`));}};
}
function fixture(){
  const h=harness(),owner=h.request('setupOwner',{nama:'Synthetic owner',pin:'1234'});assert.equal(owner.ok,true,owner.error);
  h.run("pkStore_().lock(function(){pkStore_().append('Produk',{id:'initial',nama:'Original item'});});");
  const state=device(h).request('getState',{token:owner.data.token});assert.equal(state.ok,true,state.error);
  return {h,token:owner.data.token,state:state.data};
}
function failCommit(h){
  const props=h.context.PropertiesService.getScriptProperties(),save=props.setProperties.bind(props);
  props.setProperties=(values,remove)=>{if(Object.hasOwn(values,'ver'))throw new Error('synthetic version publication failure');return save(values,remove);};
  return ()=>{props.setProperties=save;};
}

test('failed version publication after durable Sheets write forces the next device sync to reload, never same:true',()=>{
  const f=fixture(),oldVersion=f.state.ver,epoch=Number(f.h.properties.ve||0),restore=failCommit(f.h);
  assert.throws(()=>device(f.h).run("pkStore_().lock(function(){pkStore_().append('Produk',{id:'durable-new',nama:'Written by another device'});});"),/publication failure/);
  assert.equal(Number(f.h.properties.ver),oldVersion);assert.equal(f.h.properties.pendingWrite,'1');restore();
  const sync=device(f.h).request('sync',{token:f.token,ver:oldVersion,av:f.state.appVersion});assert.equal(sync.ok,true,sync.error);assert.notEqual(sync.data.same,true);assert.ok(sync.data.produk.some(p=>p.id==='durable-new'));
  assert.equal(Number(f.h.properties.ver),oldVersion+1);assert.equal(Number(f.h.properties.ve),epoch+1);assert.equal(f.h.properties.pendingWrite,'');assert.equal(f.h.isLocked(),false);
  const again=device(f.h).request('sync',{token:f.token,ver:sync.data.ver,av:f.state.appVersion});assert.deepEqual(again.data,{same:true,ver:sync.data.ver});
});

test('a failed durable marker prevents every physical business write before it starts',()=>{
  const f=fixture(),sheet=f.h.sheets.Produk,before=JSON.stringify(sheet.values),writes=sheet.writes,version=f.h.properties.ver,props=f.h.context.PropertiesService.getScriptProperties(),save=props.setProperty.bind(props);
  props.setProperty=(key,value)=>{if(key==='pendingWrite')throw new Error('synthetic marker unavailable');return save(key,value);};
  assert.throws(()=>device(f.h).run("pkStore_().lock(function(){pkStore_().append('Produk',{id:'not-written',nama:'Should not exist'});});"),/marker unavailable/);
  assert.equal(sheet.writes,writes);assert.equal(JSON.stringify(sheet.values),before);assert.equal(f.h.properties.ver,version);assert.equal(f.h.isLocked(),false);props.setProperty=save;
});

test('a discarded execution leaves evidence that is recovered before any new request consumes its cached before-image',()=>{
  const f=fixture(),oldVersion=f.state.ver,dead=device(f.h);
  // Deliberately omit lock.finally to model termination after the physical call.
  dead.run("pkStore_().append('Produk',{id:'after-timeout',nama:'Durable timeout row'});");
  assert.equal(f.h.properties.pendingWrite,'1');assert.equal(Number(f.h.properties.ver),oldVersion);
  const current=device(f.h).request('getState',{token:f.token});assert.equal(current.ok,true,current.error);assert.ok(current.data.produk.some(p=>p.id==='after-timeout'));assert.equal(current.data.ver,oldVersion+1);assert.equal(f.h.properties.pendingWrite,'');
});

test('failed recovery blocks read and write success until durable publication is possible',()=>{
  const f=fixture();device(f.h).run("pkStore_().append('Produk',{id:'pending-row',nama:'Durable pending row'});");
  const restore=failCommit(f.h),before=JSON.stringify(f.h.sheets.Produk.values);
  for(const request of [{action:'getState',payload:{token:f.token}},{action:'setupOwner',payload:{nama:'Should not run',pin:'9876'}}]){
    const result=device(f.h).request(request.action,request.payload);assert.equal(result.ok,false);assert.equal(result.data,undefined);assert.match(result.error,/publication failure/);assert.equal(f.h.properties.pendingWrite,'1');assert.equal(f.h.isLocked(),false);
  }
  assert.equal(JSON.stringify(f.h.sheets.Produk.values),before);restore();assert.equal(device(f.h).request('getState',{token:f.token}).ok,true);
});

test('a reader straddling another device commit returns no mixed snapshot',()=>{
  const f=fixture(),reader=device(f.h),writer=device(f.h);let fired=false;
  reader.context.concurrentWrite=()=>{if(fired)return;fired=true;writer.run("pkStore_().lock(function(){pkStore_().update('Produk','initial',{nama:'New item'});pkStore_().append('PO',{id:'new-po',status:'aktif',nama:'New PO',ukuran:{M:1},total:1});});");};
  reader.run("createCore=function(store){return {handle:function(){var old=store.read('Produk')[0].nama;concurrentWrite();return {before:old,after:store.read('PO')};}};};void 0;");
  const result=reader.request('syntheticRead');assert.equal(result.ok,false);assert.equal(result.retryable,true);assert.equal(result.uncertain,undefined);assert.equal(result.data,undefined);assert.equal(f.h.isLocked(),false);
});

test('a reader encountering an in-flight marker also refuses success before the writer publishes its version',()=>{
  const f=fixture(),reader=device(f.h),abandoned=device(f.h);
  reader.context.concurrentWrite=()=>abandoned.run("pkStore_().append('Produk',{id:'in-progress',nama:'Not yet published'});");
  reader.run("createCore=function(store){return {handle:function(){store.read('Produk');concurrentWrite();return {ver:store.version()};}};};void 0;");
  const result=reader.request('syntheticRead');assert.equal(result.ok,false);assert.equal(result.retryable,true);assert.equal(result.data,undefined);assert.equal(f.h.properties.pendingWrite,'1');
});

test('ordinary multi-table commit marks once, clears with its versions, and preserves the current-client response',()=>{
  const f=fixture(),d=device(f.h),props=f.h.context.PropertiesService.getScriptProperties(),calls=[],set=props.setProperty.bind(props),many=props.setProperties.bind(props);
  props.setProperty=(k,v)=>{calls.push([k,v]);return set(k,v);};props.setProperties=(v,r)=>{calls.push(v);return many(v,r);};
  d.run("createCore=function(store){return {handle:function(){return store.lock(function(){store.append('Produk',{id:'one',nama:'One'});store.append('PO',{id:'two',status:'aktif',nama:'Two'});return {ver:store.version(),count:store.read('Produk').length};});}};};void 0;");
  const result=d.request('syntheticWrite');assert.equal(result.ok,true,result.error);assert.equal(result.data.count,2);assert.equal(result.data.ver,Number(f.h.properties.ver));assert.equal(f.h.properties.pendingWrite,'');assert.equal(calls.filter(c=>Array.isArray(c)&&c[0]==='pendingWrite').length,1);assert.ok(calls.some(c=>!Array.isArray(c)&&c.pendingWrite===''&&c.ver&&c.v_Produk&&c.v_PO));
});

test('an uncertain Sheets response retains the original error and explicit uncertainty without leaking partial data',()=>{
  const f=fixture(),d=device(f.h),sheet=f.h.sheets.Produk,range=sheet.getRange.bind(sheet);
  sheet.getRange=(...args)=>{const r=range(...args),set=r.setValues.bind(r);r.setValues=rows=>{set(rows);throw new Error('original lost Sheets response');};return r;};
  d.run("createCore=function(store){return {handle:function(){return store.lock(function(){store.append('Produk',{id:'unknown-result',nama:'Actually durable'});return {secret:'never-return'};});}};};void 0;");
  const result=d.request('syntheticWrite');assert.equal(result.ok,false);assert.equal(result.error,'original lost Sheets response');assert.equal(result.uncertain,true);assert.equal(result.data,undefined);assert.equal(f.h.properties.pendingWrite,'');
  sheet.getRange=range;const latest=device(f.h).request('getState',{token:f.token});assert.ok(latest.data.produk.some(p=>p.id==='unknown-result'));
});

test('private PIN attempts and normal sign-in do not create a business marker or invalidate colleagues data',()=>{
  const f=fixture(),props=f.h.context.PropertiesService.getScriptProperties(),set=props.setProperty.bind(props),markers=[];props.setProperty=(k,v)=>{if(k==='pendingWrite')markers.push(v);return set(k,v);};
  const id=f.state.me.id,wrong=device(f.h).request('login',{userId:id,pin:'0000',deferState:true});assert.equal(wrong.ok,true,wrong.error);assert.equal(wrong.data.salah,true);
  const login=device(f.h).request('login',{userId:id,pin:'1234',deferState:true});assert.equal(login.ok,true,login.error);assert.deepEqual(markers,[]);assert.equal(Number(f.h.properties.ver),f.state.ver);
});

test('failure after a successful mutation still reports an uncertain result while a pre-write validation error does not',()=>{
  for(const write of [false,true]){
    const f=fixture(),d=device(f.h);
    d.run("createCore=function(store){return {handle:function(){return store.lock(function(){"+(write?"store.append('Produk',{id:'before-late-error',nama:'Committed'});":"")+"throw new Error('late application failure');});}};};void 0;");
    const result=d.request('syntheticWrite');assert.equal(result.ok,false);assert.equal(result.error,'late application failure');assert.equal(result.uncertain,write?true:undefined);assert.equal(result.data,undefined);
    const current=device(f.h).request('getState',{token:f.token});assert.equal(current.data.produk.some(p=>p.id==='before-late-error'),write);
  }
});
