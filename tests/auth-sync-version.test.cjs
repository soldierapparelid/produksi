'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('./helpers/apps-script-harness.cjs');
function fixture(){
  const h=harness(),setup=h.request('setupOwner',{nama:'Synthetic owner',pin:'1234'});assert.equal(setup.ok,true,setup.error);
  h.run(`pkStore_().lock(function(){pkStore_().append('Pegawai',{id:'worker001',nama:'Synthetic worker',divisi:'jahit',aktif:true,pin:'4567'});pkStore_().append('PO',{id:'samplepo1',noPO:'SYN-1',nama:'Synthetic PO',status:'aktif',ukuran:{M:10},total:10});});`);
  function call(action,payload){h.cold();return h.request(action,payload);}
  const state=call('getState',{token:setup.data.token});assert.equal(state.ok,true,state.error);
  return {h,call,owner:setup.data.state.me.id,token:setup.data.token,ver:state.data.ver,av:state.data.appVersion};
}
test('another account login keeps business sync small while recording its new durable session outside the account sheet',()=>{
  const f=fixture(),oldTable=Number(f.h.properties.v_Pegawai),accountWrites=f.h.sheets.Pegawai.writes;
  const login=f.call('login',{userId:'worker001',pin:'4567',deferState:true});assert.equal(login.ok,true,login.error);
  assert.equal(Number(f.h.properties.ver),f.ver);assert.equal(Number(f.h.properties.v_Pegawai),oldTable,'a sign-in changes neither the business version nor the account table');
  assert.equal(f.h.sheets.Pegawai.writes,accountWrites);assert.ok(String(f.h.properties.s_worker001).split(',').includes(login.data.token));
  const reads={};for(const [name,sheet]of Object.entries(f.h.sheets)){const range=sheet.getDataRange.bind(sheet);sheet.getDataRange=()=>{reads[name]=(reads[name]||0)+1;return range();};}
  const sync=f.call('sync',{token:f.token,ver:f.ver,av:f.av});assert.equal(sync.ok,true,sync.error);
  assert.deepEqual(sync.data,{same:true,ver:f.ver});assert.equal(sync.data.po,undefined);
  assert.deepEqual(Object.keys(reads),[],'a no-change poll after a colleague signs in opens no spreadsheet at all');
  const worker=f.call('getState',{token:login.data.token});assert.equal(worker.ok,true,worker.error);assert.equal(worker.data.me.id,'worker001');
});
test('wrong PIN counters and lockout update fresh account evidence without a production-version storm',()=>{
  const f=fixture();
  for(let i=0;i<5;i++){const r=f.call('login',{userId:'worker001',pin:'0000',deferState:true});assert.equal(r.ok,true);assert.equal(r.data.salah,true);assert.equal(r.data.token,undefined);assert.equal(Number(f.h.properties.ver),f.ver);}
  const locked=f.call('login',{userId:'worker001',pin:'4567',deferState:true});assert.equal(locked.ok,false);assert.match(locked.error,/Terlalu banyak/);
  const state=f.call('getState',{token:f.token});assert.equal(state.ok,true);
  for(const user of state.data.users)for(const key of ['gagal','kunci','token','pin'])assert.equal(Object.hasOwn(user,key),false);
});
test('logout and session-cap eviction still invalidate a revoked token even when the business version is equal',()=>{
  const f=fixture(),first=f.call('login',{userId:'worker001',pin:'4567',deferState:true});assert.equal(first.ok,true);
  const logout=f.call('logout',{token:first.data.token});assert.equal(logout.ok,true,logout.error);
  const revoked=f.call('sync',{token:first.data.token,ver:f.ver,av:f.av});assert.equal(revoked.ok,false);assert.match(revoked.error,/Sesi berakhir/);
  const oldest=f.call('login',{userId:'worker001',pin:'4567',deferState:true});let newest;
  for(let i=0;i<12;i++)newest=f.call('login',{userId:'worker001',pin:'4567',deferState:true});
  assert.equal(f.call('sync',{token:oldest.data.token,ver:f.ver,av:f.av}).ok,false);
  assert.equal(f.call('sync',{token:newest.data.token,ver:f.ver,av:f.av}).ok,true);
  assert.equal(Number(f.h.properties.ver),f.ver);
});
test('PIN, role, active status and public profile changes always advance the business version',()=>{
  for(const patch of [{pin:'5678',token:'',gagal:0,kunci:''},{divisi:'qc'},{aktif:false},{nama:'New name'},{hp:'Synthetic phone'},{catatan:'Synthetic note'}]){
    const f=fixture();f.h.run(`pkStore_().lock(function(){pkStore_().update('Pegawai','worker001',${JSON.stringify(patch)});});`);
    assert.equal(Number(f.h.properties.ver),f.ver+1);
    const sync=f.call('sync',{token:f.token,ver:f.ver,av:f.av});assert.equal(sync.ok,true,sync.error);assert.notEqual(sync.data.same,true);assert.ok(sync.data.po);
  }
});
test('mixed private-account and production writes advance both table versions and exactly one business version',()=>{
  const f=fixture(),account=Number(f.h.properties.v_Pegawai),po=Number(f.h.properties.v_PO);
  const seen=f.h.run(`pkStore_().lock(function(){var s=pkStore_(),out=[];s.update('Pegawai','worker001',{gagal:1});out.push(s.version());s.update('PO','samplepo1',{nama:'Changed synthetic'});out.push(s.version());s.update('Pegawai','worker001',{token:'synthetic-replacement-token'});out.push(s.version());return out;});`);
  assert.deepEqual(seen,[f.ver,f.ver+1,f.ver+1]);assert.equal(Number(f.h.properties.ver),f.ver+1);
  assert.equal(Number(f.h.properties.v_Pegawai),account+1);assert.equal(Number(f.h.properties.v_PO),po+1);
});
test('a failed private session commit returns no authenticated result and publishes no staged account cache',()=>{
  const f=fixture(),published=[],cache=f.h.context.CacheService.getScriptCache(),put=cache.putAll.bind(cache);
  cache.putAll=(value,ttl)=>{published.push(...Object.keys(value));return put(value,ttl);};
  f.h.context.SpreadsheetApp.flush=()=>{throw new Error('synthetic session flush failure');};
  const r=f.call('login',{userId:'worker001',pin:'4567',deferState:true});assert.equal(r.ok,false);assert.equal(r.data,undefined);
  assert.match(r.error,/flush failure/);assert.equal(Number(f.h.properties.ver),f.ver);
  assert.ok(!published.some(key=>key.includes('|Pegawai|')));assert.equal(f.h.isLocked(),false);
});
