'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = ['core.js', 'auto-completion.js'].map(f => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8')).join('\n');
const owner = 'owner-token-123456789';
const worker = 'worker-token-12345678';

function app() {
  const c = vm.createContext({});
  vm.runInContext(source + `
    var db={}, config={}, revision=1, clock='2026-10-08T08:00:00.000Z', serial=0;
    var writes=[], locks=0, locked=false, beforeLock=null, checks=[], flowCalls=0;
    Object.keys(SCHEMA).forEach(function(s){db[s]=[];});
    db.Pegawai=[
      {id:'owner01',nama:'Owner',divisi:'owner',aktif:true,pin:'1234',token:'${owner}'},
      {id:'worker1',nama:'Pekerja A',divisi:'jahit',aktif:true,token:'${worker}'},
      {id:'worker2',nama:'Pekerja B',divisi:'jahit',aktif:true,token:'worker2-token-1234567'},
      {id:'cutter1',nama:'Potong',divisi:'potong',aktif:true,token:'cutter-token-12345678'}];
    db.PO=[{id:'po00001',noPO:'PO-TEST',nama:'Kaos',jenis:'stok',status:'aktif',ukuran:'{"M":40}',total:40}];
    db.Potong=[{id:'cut0001',poId:'po00001',userId:'cutter1',tanggal:'2026-09-01',ukuran:'{"M":40}',total:40,tarif:500,upahId:'LAMA'}];
    db.SlipKirim=[{id:'send001',poId:'po00001',maklonId:'worker1',tanggal:'2026-09-02',ukuran:'{"M":40}',total:40,upah:2000}];
    db.SlipSetor=[{id:'count01',poId:'po00001',maklonId:'worker1',tanggal:'2026-09-03',ukuran:'{"M":40}',total:40,reject:0,upah:2000,status:'diterima',upahId:'pay0001'}];
    db.QC=[{id:'qc00001',poId:'po00001',maklonId:'worker1',setorId:'count01',tanggal:'2026-09-04',ukuran:'{"M":40}',total:40,offline:0,perbaikan:0,reject:0}];
    db.SlipUpah=[{id:'pay0001',pegawaiId:'worker1',jenis:'jahit',tanggal:'2026-09-03',itemIds:'["setor:count01:M"]',totalQty:40,totalUpah:80000,dibayar:80000,items:'[{"sourceId":"count01","earnedId":"setor:count01:M","ukuran":{"M":40},"total":40,"rate":2000}]'}];
    var realWorkflow=coreWorkflow;
    coreWorkflow=function(){flowCalls++;return realWorkflow.apply(null,arguments);};
    var store={
      read:function(s){return db[s]||[];},getSettings:function(){return config;},setSettings:function(v){config=v;revision++;},
      version:function(){return revision;},
      append:function(s,r){db[s].push(r);writes.push(s);revision++;},
      appendMany:function(s,rows){db[s]=db[s].concat(rows);writes.push(s);revision++;},
      replaceAll:function(s,rows){db[s]=rows;writes.push(s);revision++;},
      update:function(s,id,patch){Object.assign(db[s].filter(function(r){return r.id===id;})[0],patch);writes.push(s);revision++;},
      remove:function(s,id){db[s]=db[s].filter(function(r){return r.id!==id;});writes.push(s);revision++;},
      checkpoint:function(names){checks.push(names);},
      lock:function(fn){if(locked)throw new Error('Nested lock');locks++;locked=true;try{if(beforeLock){var f=beforeLock;beforeLock=null;f();}return fn();}finally{locked=false;}}
    };
    var core=createCore(store,{now:function(){return new Date(clock);},id:function(){return 'newid00'+(++serial);}});
  `, c);
  const run = code => { const encoded = JSON.stringify(vm.runInContext(code, c)); return encoded === undefined ? undefined : JSON.parse(encoded); };
  const call = (action, payload = {}, token = owner) => run(`core.handle(${JSON.stringify(action)},${JSON.stringify({token,workflowVersion:2,...payload})})`);
  return {run, call, state: (token = owner) => call('getState', {}, token), time: iso => run(`clock=${JSON.stringify(iso)};`), po: () => run('db.PO[0]')};
}

test('old complete PO starts from first authenticated observation, preserving paid business rows', () => {
  const a=app(), before=a.run('JSON.stringify(Object.fromEntries(Object.entries(db).filter(function(x){return x[0]!=="PO";})))');
  const first=a.state();
  assert.equal(first.po[0].status,'aktif');
  assert.equal(first.po[0].tuntasPada,'2026-10-08T08:00:00.000Z');
  assert.equal(a.run('locks'),1);
  assert.deepEqual(a.run('writes'),['PO']);
  assert.equal(a.run('JSON.stringify(Object.fromEntries(Object.entries(db).filter(function(x){return x[0]!=="PO";})))'),before);
  a.run('flowCalls=0;checks=[];locks=0;');
  a.state();
  assert.equal(a.run('flowCalls'),1,'ordinary full state computes workflow only once');
  assert.equal(a.run('locks'),0);
  assert.deepEqual(a.run('checks'),[['Pengaturan']],'ordinary state does not checkpoint production tables');
});

test('same-version sync stays cheap until exactly seven elapsed days and then closes', () => {
  const a=app(), first=a.state(), business=a.run('JSON.stringify([db.Potong,db.SlipKirim,db.SlipSetor,db.QC,db.SlipUpah])');
  a.time('2026-10-15T07:59:59.999Z');a.run('flowCalls=0;locks=0;');
  assert.equal(a.call('sync',{ver:first.ver,av:first.appVersion}).same,true);
  assert.equal(a.run('flowCalls'),0);assert.equal(a.run('locks'),0);
  a.time('2026-10-15T08:00:00.000Z');
  const after=a.call('sync',{ver:first.ver,av:first.appVersion});
  assert.equal(after.po[0].status,'selesai');assert.equal(after.po[0].selesaiPada,'2026-10-15');
  assert.equal(after.po[0].diubah,'2026-10-15T08:00:00.000Z');
  assert.equal(a.run('JSON.stringify([db.Potong,db.SlipKirim,db.SlipSetor,db.QC,db.SlipUpah])'),business);
  a.run('writes=[];');a.state();assert.deepEqual(a.run('writes'),[],'repeat read cannot close again');
});

test('seven days means 168 hours across year and leap-month boundaries', () => {
  const a=app();
  for (const [start,end] of [['2026-12-28T23:30:00.000Z','2027-01-04T23:30:00.000Z'],['2028-02-25T09:00:00.000Z','2028-03-03T09:00:00.000Z']]) {
    a.run(`db.PO[0].status='aktif';db.PO[0].tuntasPada=${JSON.stringify(start)};`);
    a.time(new Date(Date.parse(end)-1).toISOString());assert.equal(a.state().po[0].status,'aktif');
    a.time(end);assert.equal(a.state().po[0].status,'selesai');
  }
});

test('backdated QC starts timer at server receipt time, only after final repairs finish', () => {
  const a=app();a.run('db.QC=[];');a.state();assert.equal(a.po().tuntasPada,undefined);
  a.call('createQC',{qc:{id:'qc00001',poId:'po00001',setorId:'count01',tanggal:'2026-09-04',ukuran:{M:30},perbaikanUkuran:{M:10},perbaikan:10}});
  assert.equal(a.po().tuntasPada,undefined);
  a.time('2026-10-09T10:00:00.000Z');
  a.call('createQC',{qc:{id:'repair1',poId:'po00001',repairQcId:'qc00001',tanggal:'2026-09-05',ukuran:{M:10}}});
  assert.equal(a.po().tuntasPada,'2026-10-09T10:00:00.000Z');
});

test('changed production evidence clears the timer and later completion receives a fresh seven days', () => {
  const a=app();a.state();a.time('2026-10-12T08:00:00.000Z');
  a.run('var savedQC=db.QC;db.QC=[];revision++;');a.state();
  assert.equal(a.po().tuntasPada,'');
  a.time('2026-10-15T08:00:00.000Z');assert.equal(a.state().po[0].status,'aktif');
  a.run('db.QC=savedQC;revision++;');a.state();assert.equal(a.po().tuntasPada,'2026-10-15T08:00:00.000Z');
});

test('held legacy PO and any production issue cannot start or retain an automatic timer', () => {
  const a=app();a.run(`db.PO[0].tuntasPada='2026-09-01T00:00:00.000Z';db.PO[0].imporSumber=JSON.stringify({legacyReconciliation:{mode:'review'}});`);
  assert.equal(a.state().po[0].status,'aktif');assert.equal(a.po().tuntasPada,'');
  a.run(`db.PO[0].imporSumber='';db.PO[0].imporReview='Perlu diperiksa';`);a.state();assert.equal(a.po().tuntasPada,'');
  a.run(`db.PO[0].imporReview='';db.SlipKirim[0].maklonId='missing';`);a.state();assert.equal(a.po().tuntasPada,'');
  assert.equal(a.run(`coreAutoCompletionPlan([{id:'p',status:'aktif'}],{p:{complete:true,issues:[],ukuran:{M:{issues:['size issue']}}}},new Date(clock)).patches.length`),0);
});

test('fresh evidence under lock overrides a stale complete candidate', () => {
  const a=app();a.run(`db.PO[0].tuntasPada='2026-09-01T00:00:00.000Z';beforeLock=function(){db.QC=[];};`);
  const state=a.state();assert.equal(state.po[0].status,'aktif');assert.equal(state.po[0].workflow.complete,false);assert.equal(a.po().tuntasPada,'');
});

test('pending migration and migration starting while waiting for lock prevent all timer mutations', () => {
  const a=app();a.run(`config.legacyMigrationStatus={batchId:'hold01'};`);a.state();assert.deepEqual(a.run('writes'),[]);
  const b=app();b.run(`beforeLock=function(){config.legacyMigrationStatus={batchId:'hold02'};};`);b.state();assert.deepEqual(b.run('writes'),[]);
});

test('public bootstrap, invalid token and forbidden worker write cannot trigger automatic changes', () => {
  const a=app();a.call('bootstrap',{},'');assert.deepEqual(a.run('writes'),[]);
  assert.throws(()=>a.state('invalid-token-12345678'),/Sesi berakhir/);
  assert.throws(()=>a.call('setStatusPO',{id:'po00001',status:'selesai'},worker),/Hanya owner/);
  a.call('login',{userId:'owner01',pin:'9999'},'');
  assert.equal(a.po().tuntasPada,undefined);assert.equal(a.po().status,'aktif');
  assert.ok(a.run('writes').every(s=>s==='Pegawai'));
});

test('valid worker read triggers system maintenance but still returns only their payroll and PO', () => {
  const a=app();a.run(`db.PO[0].tuntasPada='2026-09-01T00:00:00.000Z';db.PO.push({id:'poOther',status:'aktif',ukuran:'{"L":12}'});`);
  const state=a.state(worker);assert.equal(a.po().status,'selesai');
  assert.equal(state.me.id,'worker1');assert.deepEqual(state.po.map(p=>p.id),['po00001']);
  assert.ok(state.payroll.every(r=>r.pegawaiId==='worker1'));assert.equal(state.po[0].workflow,undefined);
});

test('revoked user waiting for a maintenance lock cannot cause a transition', () => {
  const a=app();a.run(`beforeLock=function(){db.Pegawai[0].aktif=false;};`);
  assert.throws(()=>a.state(),/dinonaktifkan/);assert.deepEqual(a.run('writes'),[]);
});

test('manual close remains immediate and reopening resets the full seven-day window', () => {
  const a=app();a.state();a.call('setStatusPO',{id:'po00001',status:'selesai'});assert.equal(a.po().status,'selesai');
  a.time('2026-10-20T12:00:00.000Z');a.call('setStatusPO',{id:'po00001',status:'aktif'});
  assert.equal(a.po().status,'aktif');assert.equal(a.po().tuntasPada,'2026-10-20T12:00:00.000Z');
  a.time('2026-10-27T11:59:59.999Z');assert.equal(a.state().po[0].status,'aktif');
  a.time('2026-10-27T12:00:00.000Z');assert.equal(a.state().po[0].status,'selesai');
  a.time('2026-11-01T12:00:00.000Z');a.call('savePO',{po:{id:'po00001',nama:'Kaos',ukuran:{M:40},status:'aktif'}});
  assert.equal(a.po().tuntasPada,'2026-11-01T12:00:00.000Z');
});

test('malformed or future timers restart safely rather than invent an old completion date', () => {
  for(const stamp of ['2026-02-31T00:00:00.000Z','2025-01-01','bad','2099-01-01T00:00:00.000Z']) {
    const a=app();a.run(`db.PO[0].tuntasPada=${JSON.stringify(stamp)};`);
    const state=a.state();assert.equal(state.po[0].status,'aktif');assert.equal(a.po().tuntasPada,'2026-10-08T08:00:00.000Z');
  }
});

test('client PO edits and imported timestamps cannot backdate the server completion timer', () => {
  const a=app();a.call('savePO',{po:{id:'po00001',nama:'Kaos',ukuran:{M:40},status:'aktif',tuntasPada:'2020-01-01T00:00:00.000Z'}});
  assert.equal(a.po().tuntasPada,'2026-10-08T08:00:00.000Z');assert.equal(a.po().status,'aktif');
  a.call('importRows',{sheet:'PO',rows:[{id:'poNew01',nama:'Impor',status:'aktif',ukuran:{M:1},tuntasPada:'2020-01-01T00:00:00.000Z'}]});
  assert.equal(a.run('db.PO[1].tuntasPada'),'');
  a.run(`db.PO[0].asal='lama';`);
  a.call('gantiImpor',{data:{PO:[{...a.po(),tuntasPada:'2020-01-01T00:00:00.000Z'}]}});
  assert.equal(a.po().tuntasPada,'2026-10-08T08:00:00.000Z');assert.equal(a.po().status,'aktif');
});
