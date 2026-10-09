'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('./helpers/apps-script-harness.cjs');
function fixture(){
  const h=harness(),setup=h.request('setupOwner',{nama:'Owner fixture',pin:'1234'});assert.equal(setup.ok,true,setup.error);
  const owner=setup.data.state.me.id;
  h.run(`pkStore_().lock(function(){pkStore_().append('Pegawai',{id:'worker01',nama:'Worker fixture',divisi:'jahit',aktif:true,pin:'4567'});pkStore_().append('PO',{id:'fixturepo',noPO:'PO-FIXTURE',nama:'Fixture production',status:'aktif',ukuran:{M:20},total:20});});`);
  for(const key of Object.keys(h.cached))delete h.cached[key];h.cold();
  const reads={};for(const [name,sheet]of Object.entries(h.sheets)){const range=sheet.getRange.bind(sheet);sheet.getRange=(...args)=>{const r=range(...args),read=r.getValues.bind(r);r.getValues=()=>{reads[name]=(reads[name]||0)+1;return read();};return r;};}
  function call(action,p={}){h.cold();return h.request(action,p);}
  function reset(){for(const key of Object.keys(reads))delete reads[key];h.events.length=0;}
  reset();
  return{h,owner,reads,call,reset};
}
// 1.5.3: the session is recorded in script properties (s_<account id>), not in the account sheet.
// A cold account cache costs one physical account read; nothing is written to any sheet.
test('staged login on a cold cache needs one physical account read, writes no sheet and loads no production table',()=>{
  const f=fixture(),before=Object.fromEntries(Object.entries(f.h.sheets).map(([n,s])=>[n,s.writes]));
  const r=f.call('login',{userId:f.owner,pin:'1234',deferState:true});assert.equal(r.ok,true,r.error);const d=r.data;
  assert.equal(d.deferredState,true);assert.equal(d.state,undefined);assert.equal(d.me.id,f.owner);assert.equal(d.me.divisi,'owner');assert.equal(d.workflowVersion,2);assert.equal(d.contractVersion,2);assert.ok(d.appVersion);assert.ok(d.token.length>=16);
  for(const secret of ['pin','token','gagal','kunci'])assert.equal(Object.hasOwn(d.me,secret),false);
  assert.deepEqual(Object.keys(f.reads),['Pegawai']);assert.equal(f.reads.Pegawai,1);
  for(const name of Object.keys(before))assert.equal(f.h.sheets[name].writes,before[name],name+' must not change');
  assert.ok(String(f.h.properties['s_'+f.owner]).split(',').includes(d.token),'the new session is durable in script properties');
  assert.equal(f.h.events.filter(e=>e[0]==='flush').length,1);assert.equal(f.h.isLocked(),false);assert.ok(Buffer.byteLength(JSON.stringify(d))<1200);
  f.reset();const resumed=f.call('bootstrap',{token:d.token,deferState:true});assert.equal(resumed.ok,true);assert.equal(resumed.data.me.id,f.owner);assert.equal(resumed.data.token,d.token);assert.equal(resumed.data.state,undefined);
  assert.deepEqual(Object.keys(f.reads),[],'resuming a session reads the versioned account cache, not the spreadsheet');
  const state=f.call('getState',{token:d.token});assert.equal(state.ok,true,state.error);assert.equal(state.data.me.id,f.owner);assert.equal(state.data.po[0].id,'fixturepo');
  f.reset();const again=f.call('login',{userId:f.owner,pin:'1234',deferState:true});assert.equal(again.ok,true,again.error);
  assert.deepEqual(Object.keys(f.reads),[],'with the account cached, a correct PIN opens no spreadsheet at all');
});
test('a warmed server sends the production state together with the PIN answer only when the client allows it',()=>{
  const f=fixture(),before=Object.fromEntries(Object.entries(f.h.sheets).map(([n,s])=>[n,s.writes]));
  const coldAllowed=f.call('login',{userId:f.owner,pin:'1234',deferState:true,stateIfWarm:true});assert.equal(coldAllowed.ok,true,coldAllowed.error);
  assert.equal(coldAllowed.data.deferredState,true,'a cold cache never holds the PIN answer back for a full read');assert.equal(coldAllowed.data.state,undefined);
  assert.deepEqual(Object.keys(f.reads),['Pegawai']);
  f.reset();const warm=f.call('hangat',{});assert.equal(warm.ok,true,warm.error);assert.deepEqual(warm.data,{siap:true},'warming returns no data and needs no session');
  assert.ok(Object.keys(f.reads).length>10,'the tables missing from the cache are read once');
  for(const name of Object.keys(before))assert.equal(f.h.sheets[name].writes,before[name],name+' must not change');
  f.reset();assert.deepEqual(f.call('hangat',{}).data,{siap:true});assert.deepEqual(Object.keys(f.reads),[],'a second warm-up finds everything cached');
  f.reset();const r=f.call('login',{userId:f.owner,pin:'1234',deferState:true,stateIfWarm:true});assert.equal(r.ok,true,r.error);
  assert.equal(r.data.deferredState,undefined);assert.ok(r.data.token.length>=16);assert.equal(r.data.state.me.id,f.owner);assert.equal(r.data.state.po[0].id,'fixturepo');
  assert.deepEqual(Object.keys(f.reads),[],'PIN and data in one round trip without opening the spreadsheet');
  for(const name of Object.keys(before))assert.equal(f.h.sheets[name].writes,before[name],name+' must not change');
  f.reset();const resumed=f.call('bootstrap',{token:r.data.token,deferState:true,stateIfWarm:true});assert.equal(resumed.ok,true,resumed.error);
  assert.equal(resumed.data.state.me.id,f.owner);assert.equal(resumed.data.token,r.data.token);assert.equal(resumed.data.deferredState,undefined);assert.deepEqual(Object.keys(f.reads),[]);
  const staged=f.call('login',{userId:f.owner,pin:'1234',deferState:true});assert.equal(staged.data.deferredState,true,'clients that did not ask keep the staged contract');
  const worker=f.call('login',{userId:'worker01',pin:'4567',deferState:true,stateIfWarm:true});assert.equal(worker.ok,true,worker.error);
  assert.equal(worker.data.state.me.divisi,'jahit');assert.equal(worker.data.state.stok,undefined);assert.equal(worker.data.state.gaji,undefined);
});
test('full login remains compatible and public bootstrap never creates a verified shell for invalid tokens',()=>{
  const f=fixture(),full=f.call('login',{userId:f.owner,pin:'1234'});assert.equal(full.ok,true,full.error);assert.ok(full.data.state);assert.equal(full.data.deferredState,undefined);assert.equal(full.data.state.me.id,f.owner);
  for(const token of ['', 'invalid_session_token_123']){f.reset();const r=f.call('bootstrap',{token,deferState:true,divisi:'jahit'});assert.equal(r.ok,true,r.error);assert.equal(r.data.token,undefined);assert.equal(r.data.me,undefined);assert.equal(r.data.state,undefined);assert.equal(r.data.deferredState,undefined);assert.ok(r.data.users.every(u=>u.divisi==='jahit'));assert.ok(Object.keys(f.reads).every(n=>['Pegawai','Pengaturan'].includes(n)));}
});
test('wrong PIN and lockout remain enforced before staged identity or session is returned',()=>{
  const f=fixture();
  for(let i=0;i<5;i++){f.reset();const r=f.call('login',{userId:f.owner,pin:'0000',deferState:true});assert.equal(r.ok,true);assert.equal(r.data.salah,true);assert.equal(r.data.token,undefined);assert.equal(r.data.me,undefined);assert.equal(r.data.deferredState,undefined);assert.deepEqual(Object.keys(f.reads),['Pegawai']);}
  const locked=f.call('login',{userId:f.owner,pin:'1234',deferState:true});assert.equal(locked.ok,false);assert.match(locked.error,/Terlalu banyak salah PIN/);
});
test('a failed session commit cannot return a staged authenticated response',()=>{
  const f=fixture();f.h.context.SpreadsheetApp.flush=()=>{throw new Error('commit unavailable');};
  const r=f.call('login',{userId:f.owner,pin:'1234',deferState:true});assert.equal(r.ok,false);assert.match(r.error,/commit unavailable/);assert.equal(r.data,undefined);assert.equal(f.h.isLocked(),false);
});
test('staged login stays available during recovery but hydration exposes recovery and writes remain blocked',()=>{
  const f=fixture();f.h.run(`pkStore_().lock(function(){pkStore_().setSettings({legacyMigrationStatus:{batchId:'pending_batch',beforeHash:'before',planHash:'plan',at:'2026-10-08'}});});`);f.reset();
  const login=f.call('login',{userId:f.owner,pin:'1234',deferState:true});assert.equal(login.ok,true,login.error);assert.deepEqual(Object.keys(f.reads),['Pegawai']);
  const state=f.call('getState',{token:login.data.token});assert.equal(state.ok,true,state.error);assert.equal(state.data.settings.legacyMigrationStatus.batchId,'pending_batch');
  const denied=f.call('saveProduk',{token:login.data.token,produk:{id:'blocked01',nama:'Must not save'}});assert.equal(denied.ok,false);assert.match(denied.error,/Pemulihan riwayat belum selesai/);
});
test('token revocation, disabled accounts and current role are rechecked between authentication and hydration',()=>{
  const f=fixture(),worker=f.call('login',{userId:'worker01',pin:'4567',deferState:true});assert.equal(worker.ok,true);assert.equal(worker.data.me.divisi,'jahit');
  f.h.run(`pkStore_().lock(function(){pkStore_().update('Pegawai','worker01',{divisi:'qc'});});`);
  const state=f.call('getState',{token:worker.data.token});assert.equal(state.ok,true,state.error);assert.equal(state.data.me.divisi,'qc');assert.equal(state.data.stok,undefined);assert.equal(state.data.gaji,undefined);assert.equal(state.data.upah.length,0);
  /* The owner sets a new PIN for the worker: every session of that worker ends at once. */
  const owner=f.call('login',{userId:f.owner,pin:'1234',deferState:true});assert.equal(owner.ok,true,owner.error);
  const changed=f.call('saveUser',{token:owner.data.token,user:{id:'worker01',nama:'Worker fixture',divisi:'qc',pin:'7890'}});assert.equal(changed.ok,true,changed.error);
  const revoked=f.call('getState',{token:worker.data.token});assert.equal(revoked.ok,false);assert.match(revoked.error,/Sesi berakhir/);
  assert.equal(f.h.properties.s_worker01,undefined);
  f.h.run(`pkStore_().lock(function(){pkStore_().update('Pegawai','worker01',{aktif:false});});`);
  const disabled=f.call('login',{userId:'worker01',pin:'7890',deferState:true});assert.equal(disabled.ok,false);assert.match(disabled.error,/Pegawai tidak ditemukan/);
});
test('staged bootstrap verifies the current session list on every request, and sessions kept in the sheet by older versions stay valid until removed',()=>{
  const f=fixture(),login=f.call('login',{userId:f.owner,pin:'1234',deferState:true});assert.equal(login.ok,true);
  /* Session revoked elsewhere (sign-out, PIN change, "Keluarkan semua perangkat") while this device was closed. */
  delete f.h.properties['s_'+f.owner];
  const r=f.call('bootstrap',{token:login.data.token,deferState:true});assert.equal(r.ok,true);assert.equal(r.data.token,undefined);assert.equal(r.data.me,undefined);assert.equal(r.data.deferredState,undefined);assert.equal(r.data.state,undefined);
  /* A device that signed in before 1.5.3 has its token in the account sheet. */
  const legacy='legacy_session_token_from_sheet_0001';
  f.h.run(`pkStore_().lock(function(){pkStore_().update('Pegawai',${JSON.stringify(f.owner)},{token:${JSON.stringify(legacy)}});});`);
  const kept=f.call('bootstrap',{token:legacy,deferState:true});assert.equal(kept.ok,true,kept.error);assert.equal(kept.data.me.id,f.owner);assert.equal(kept.data.deferredState,true);
  assert.equal(f.call('getState',{token:legacy}).ok,true);
  const out=f.call('logout',{token:legacy});assert.equal(out.ok,true,out.error);
  const sheet=f.h.sheets.Pegawai,head=sheet.values[0],row=sheet.values.find(x=>x[head.indexOf('id')]===f.owner);assert.equal(row[head.indexOf('token')],'');
  const gone=f.call('bootstrap',{token:legacy,deferState:true});assert.equal(gone.data.me,undefined);assert.equal(f.call('getState',{token:legacy}).ok,false);
});
