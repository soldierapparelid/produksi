'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
function fixture(){
  const h=harness();vm.runInContext(['cutting-plans.js','auto-completion.js'].map(f=>fs.readFileSync(path.resolve(__dirname,'../src',f),'utf8')).join('\n'),h.context);
  const setup=h.request('setupOwner',{nama:'Owner fixture',pin:'1234'});assert.equal(setup.ok,true,setup.error);
  const owner=setup.data.token,cutter='fixture_cutter_session_1234',cutter2='fixture_cutter_session_5678',sewer='fixture_sewer_session_1234',admin='fixture_admin_session_1234';
  h.run(`pkStore_().lock(function(){
    [{id:'cutter01',nama:'Cutter A',divisi:'potong',aktif:true,token:'${cutter}'},{id:'cutter02',nama:'Cutter B',divisi:'potong',aktif:true,token:'${cutter2}'},{id:'sewer001',nama:'Sewer',divisi:'jahit',aktif:true,token:'${sewer}'},{id:'admin001',nama:'Admin',divisi:'admin',aktif:true,token:'${admin}'}].forEach(function(r){pkStore_().append('Pegawai',r);});
    pkStore_().append('PO',{id:'planpo01',noPO:'PO-01',nama:'Fixture PO',status:'aktif',ukuran:{M:10,L:5},total:15,dibuatOleh:'owner001'});
    pkStore_().append('StokBahan',{id:'stock001',bahan:'Cotton',qty:20,satuan:'kg',jenis:'beli',tanggal:'2026-10-01',harga:100000,rol:4});
    pkStore_().append('StokBahan',{id:'stock002',bahan:'Rib',qty:5,satuan:'kg',jenis:'beli',tanggal:'2026-10-01',harga:50000,rol:1});
  });`);
  function call(action,p={},token=owner){h.cold();return h.request(action,{token,workflowVersion:2,...p});}
  function good(action,p={},token=owner){const r=call(action,p,token);assert.equal(r.ok,true,r.error);return r.data?.data??r.data;}
  function plan(id='cutplan01',qty=6){return good('saveRencanaPotong',{rencana:{id,poId:'planpo01',bahanList:[{nama:' cotton ',qty,satuan:'kg'}],rol:2,catatan:'Persiapan fixture'}});}
  function payload(r,id='cutout01'){return {potong:{id,rencanaId:r.id,expectedRencanaRevision:r.revision,ukuran:{M:10,L:5},tanggal:'2026-10-08'}};}
  function raw(name){h.cold();return h.run(`pkStore_().fresh(${JSON.stringify(name)});pkStore_().read(${JSON.stringify(name)})`);}
  return {h,owner,cutter,cutter2,sewer,admin,call,good,plan,payload,raw};
}
test('owner reserves prepared materials, workers see quantities without prices, other roles see no plans',()=>{
  const f=fixture(),p=f.plan();assert.equal(p.status,'siap');assert.equal(p.bahanList[0].nama,'Cotton');assert.ok(p.revision);
  const state=f.good('getState'),cotton=state.stokRingkas.find(r=>r.nama==='Cotton');
  assert.equal(cotton.saldo,20);assert.equal(cotton.dicadangkan,6);assert.equal(cotton.tersedia,14);
  assert.equal(state.po[0].workflow.pendingCutPlans,true);assert.equal(state.po[0].workflow.readyQC,false);assert.equal(state.po[0].workflow.complete,false);
  const worker=f.good('getState',{},f.cutter);assert.equal(worker.rencanaPotong.length,1);assert.equal(worker.stok,undefined);assert.equal(worker.stokRingkas,undefined);
  assert.ok(worker.bahan.every(r=>!Object.hasOwn(r,'harga')));assert.equal(worker.bahan.find(r=>r.nama==='Cotton').tersedia,14);
  const sewing=f.good('getState',{},f.sewer);assert.equal(sewing.rencanaPotong,undefined);assert.equal(sewing.bahan,undefined);
  for(const token of [f.cutter,f.admin,f.sewer]){const r=f.call('saveRencanaPotong',{rencana:{id:'foreign01',poId:'planpo01',bahanList:[{nama:'Cotton',qty:1}],rol:0}},token);assert.equal(r.ok,false);assert.match(r.error,/Hanya owner/);}
  assert.equal(f.call('saveRencanaPotong',{workflowVersion:1,rencana:{id:'oldplan01'}}).ok,false);
  for(const status of ['selesai','batal']){const r=f.call('setStatusPO',{id:'planpo01',status});assert.equal(r.ok,false);assert.match(r.error,/bahan potong yang disiapkan/);}
  assert.equal(f.call('savePO',{po:{id:'planpo01',nama:'Fixture PO',ukuran:{M:10,L:5},status:'batal'}}).ok,false);
});
test('shared reservations reject overspending and stale edits; cancellation releases stock',()=>{
  const f=fixture(),p=f.plan();f.plan('cutplan02',13);
  let r=f.call('saveRencanaPotong',{rencana:{id:'cutplan03',poId:'planpo01',bahanList:[{nama:'Cotton',qty:2}],rol:0}});assert.equal(r.ok,false);assert.match(r.error,/melebihi stok/);
  const changed=f.good('saveRencanaPotong',{expectedRevision:p.revision,rencana:{...p,bahanList:[{nama:'Cotton',qty:7}]}});assert.notEqual(changed.revision,p.revision);
  r=f.call('saveRencanaPotong',{expectedRevision:p.revision,rencana:{...p,bahanList:[{nama:'Cotton',qty:5}]}});assert.equal(r.ok,false);assert.match(r.error,/berubah sejak/);
  r=f.call('createPotong',f.payload(p),f.cutter);assert.equal(r.ok,false);assert.match(r.error,/berubah sejak/);assert.equal(f.raw('Potong').length,0);
  f.good('saveRencanaPotong',{expectedRevision:changed.revision,rencana:{id:p.id,status:'batal'}});
  const state=f.good('getState');assert.equal(state.stokRingkas.find(r=>r.nama==='Cotton').tersedia,7);assert.equal(state.rencanaPotong.find(r=>r.id===p.id).status,'batal');
});
test('prepared result consumes once via one authoritative append, retries are idempotent and other cutter cannot take it',()=>{
  const f=fixture(),p=f.plan();const before=f.raw('RencanaPotong'),planWrites=f.h.sheets.RencanaPotong.writes,stockBefore=f.raw('StokBahan');
  const cut=f.good('createPotong',f.payload(p),f.cutter);assert.equal(cut.rencanaId,p.id);assert.equal(cut.kg,6);assert.equal(cut.rol,2);assert.equal(cut.userId,'cutter01');assert.deepEqual(JSON.parse(cut.bahanList),[{nama:'Cotton',qty:6}]);
  f.good('createPotong',f.payload(p),f.cutter);assert.equal(f.raw('Potong').length,1);assert.deepEqual(f.raw('RencanaPotong'),before);assert.deepEqual(f.raw('StokBahan'),stockBefore);assert.equal(f.h.sheets.RencanaPotong.writes,planWrites);
  const second=f.call('createPotong',f.payload(p,'cutout02'),f.cutter2);assert.equal(second.ok,false);assert.match(second.error,/sudah dipakai/);
  const sameid=f.call('createPotong',f.payload(p),f.cutter2);assert.equal(sameid.ok,false);assert.match(sameid.error,/Bukan catatan/);
  const state=f.good('getState'),b=state.stokRingkas.find(r=>r.nama==='Cotton');assert.equal(b.saldo,14);assert.equal(b.dicadangkan,0);assert.equal(b.tersedia,14);assert.equal(state.rencanaPotong[0].status,'terpakai');assert.equal(state.rencanaPotong[0].potongId,cut.id);
  for(const req of [{action:'deleteRecord',p:{sheet:'Potong',id:cut.id}},{action:'deleteRecord',p:{sheet:'RencanaPotong',id:p.id}},{action:'saveRencanaPotong',p:{expectedRevision:p.revision,rencana:{id:p.id,status:'batal'}}}])assert.equal(f.call(req.action,req.p).ok,false);
});
test('cutter cannot type manual materials and failed validation or append leaves plan ready',()=>{
  const f=fixture(),p=f.plan();
  assert.equal(f.call('createPotong',{potong:{...f.payload(p).potong,expectedRencanaRevision:''}},f.cutter).ok,false);
  assert.equal(f.call('createPotong',{potong:{id:'manual01',poId:'planpo01',ukuran:{M:1}}},f.cutter).ok,false);
  for(const value of [{kg:6},{bahan:'Cotton'},{rol:2},{bahanList:[]}]){const r=f.call('createPotong',{potong:{...f.payload(p).potong,...value}},f.cutter);assert.equal(r.ok,false);assert.match(r.error,/ditentukan owner/);}
  let r=f.call('createPotong',{potong:{...f.payload(p).potong,ukuran:{M:1.5}}},f.cutter);assert.equal(r.ok,false);assert.equal(f.raw('Potong').length,0);
  f.h.run(`var oldStoreForCutFail=pkStore_;pkStore_=function(){var s=oldStoreForCutFail();if(!s.testWrapped){var append=s.append;s.append=function(n,r){if(n==='Potong')throw new Error('simulated sheet failure');return append(n,r);};s.testWrapped=true;}return s;};void 0;`);
  r=f.call('createPotong',f.payload(p),f.cutter);assert.equal(r.ok,false);assert.match(r.error,/simulated/);assert.equal(f.raw('Potong').length,0);assert.equal(f.good('getState').rencanaPotong[0].status,'siap');
});
test('stock reductions are allowed but use is revalidated; admin direct cuts respect reservations',()=>{
  const f=fixture(),p=f.plan('cutplan01',16);
  let r=f.call('createPotong',{potong:{id:'manual01',poId:'planpo01',userId:'cutter01',ukuran:{M:1},bahanList:[{nama:'Cotton',qty:5}]}});assert.equal(r.ok,false);assert.match(r.error,/melebihi stok/);
  f.good('createPotong',{potong:{id:'manual02',poId:'planpo01',userId:'cutter01',ukuran:{M:1},bahanList:[{nama:'Cotton',qty:4}]}});
  f.h.run(`pkStore_().lock(function(){pkStore_().update('StokBahan','stock001',{qty:15});});`);
  r=f.call('createPotong',f.payload(p),f.cutter);assert.equal(r.ok,false);assert.match(r.error,/melebihi stok/);assert.equal(f.raw('Potong').length,1);assert.equal(f.good('getState').rencanaPotong[0].status,'siap');
});
test('material validation rejects unknown/hidden/duplicate materials and malformed values without writes',()=>{
  const f=fixture();const bad=[[{nama:'Unknown',qty:1}],[{nama:'Cotton',qty:0}],[{nama:'Cotton',qty:true}],[{nama:'Cotton',qty:1.0001}],[{nama:'Cotton',qty:1,satuan:'m'}],[{nama:'Cotton',qty:1},{nama:' cotton ',qty:1}]];
  for(const bahanList of bad){const r=f.call('saveRencanaPotong',{rencana:{id:'invalid01',poId:'planpo01',bahanList,rol:0}});assert.equal(r.ok,false);}
  for(const rol of [1.5,-1,true,1000001])assert.equal(f.call('saveRencanaPotong',{rencana:{id:'invalid01',poId:'planpo01',bahanList:[{nama:'Cotton',qty:1}],rol}}).ok,false);
  assert.equal(f.raw('RencanaPotong').length,0);
});
test('imports cannot invent plan links or remove referenced PO; local prepared cuts survive reimport',()=>{
  const f=fixture(),p=f.plan();
  assert.equal(f.call('importRows',{sheet:'RencanaPotong',rows:[{...p,id:'fakeplan1'}]}).ok,false);
  assert.equal(f.call('importRows',{sheet:'Potong',rows:[{id:'fakecut1',poId:'planpo01',rencanaId:p.id}]}).ok,false);
  assert.equal(f.call('gantiImpor',{data:{Potong:[{id:'fakecut1',poId:'planpo01',rencanaId:p.id}]}}).ok,false);
  f.h.run(`pkStore_().lock(function(){pkStore_().update('PO','planpo01',{asal:'lama'});});`);
  assert.equal(f.call('gantiImpor',{data:{PO:[]}}).ok,false);
  assert.equal(f.call('gantiImpor',{data:{PO:[{...f.raw('PO')[0],status:'batal'}]}}).ok,false);
  f.good('createPotong',f.payload(p),f.cutter);const before=f.raw('Potong');f.good('gantiImpor',{data:{Potong:[]}});assert.deepEqual(f.raw('Potong'),before);
});
test('a physically consumed link wins over stale cached plan and cuts data',()=>{
  const f=fixture(),p=f.plan();f.good('getState');
  const schema=f.h.run('SCHEMA.Potong'),source={id:'othercut1',poId:'planpo01',rencanaId:p.id,userId:'cutter02',ukuran:'{"M":1}',total:1,kg:6,bahan:'Cotton',bahanList:'[{"nama":"Cotton","qty":6}]',tanggal:'2026-10-08'};
  f.h.sheets.Potong.values.push(schema.map(k=>source[k]??'')); // Hard timeout can leave ScriptCache metadata unchanged.
  const result=f.call('createPotong',f.payload(p),f.cutter);assert.equal(result.ok,false);assert.match(result.error,/sudah dipakai/);assert.equal(f.raw('Potong').length,1);
});
test('current stock unit and account access are revalidated before taking a prepared job',()=>{
  const f=fixture(),p=f.plan();
  f.h.run(`pkStore_().lock(function(){pkStore_().update('StokBahan','stock001',{satuan:'meter'});});`);
  const changedUnit=f.call('createPotong',f.payload(p),f.cutter);assert.equal(changedUnit.ok,false);assert.match(changedUnit.error,/Satuan bahan/);
  const cols=f.h.sheets.Pegawai.values[0],worker=f.h.sheets.Pegawai.values.find(r=>r[cols.indexOf('id')]==='cutter01');worker[cols.indexOf('aktif')]=false;
  const disabled=f.call('createPotong',f.payload(p),f.cutter);assert.equal(disabled.ok,false);assert.match(disabled.error,/dinonaktifkan/);assert.equal(f.raw('Potong').length,0);
});
test('an unseen pending preparation prevents automatic close after the seven-day deadline',()=>{
  const f=fixture();f.h.context.PLAN_TEST_NOW='2026-10-08T00:00:00.000Z';
  f.h.run(`var planTestEnv=pkEnv_;pkEnv_=function(){var e=planTestEnv();e.now=function(){return new Date(PLAN_TEST_NOW);};return e;};
    pkStore_().lock(function(){
      pkStore_().append('Potong',{id:'pastcut01',poId:'planpo01',userId:'cutter01',ukuran:{M:10,L:5},total:15,upahId:'LAMA'});
      pkStore_().append('SlipKirim',{id:'pastsend1',poId:'planpo01',maklonId:'sewer001',ukuran:{M:10,L:5},total:15,upah:1000});
      pkStore_().append('SlipSetor',{id:'pastcount',poId:'planpo01',maklonId:'sewer001',ukuran:{M:10,L:5},total:15,upah:1000,upahId:'LAMA',workflowVersion:2,status:'diterima'});
      pkStore_().append('QC',{id:'pastqc01',poId:'planpo01',setorId:'pastcount',maklonId:'sewer001',ukuran:{M:10,L:5},total:15,workflowVersion:2});
    });`);
  const first=f.good('getState');assert.equal(first.po[0].workflow.complete,true);assert.equal(first.po[0].tuntasPada,f.h.context.PLAN_TEST_NOW);
  const schema=f.h.run('SCHEMA.RencanaPotong'),source={id:'unseenplan',poId:'planpo01',bahanList:'[{"nama":"Cotton","qty":1,"satuan":"kg"}]',rol:1,status:'siap',revision:'revision01'};
  f.h.sheets.RencanaPotong.values.push(schema.map(k=>source[k]??''));
  f.h.context.PLAN_TEST_NOW='2026-10-15T00:00:00.000Z';const next=f.good('sync',{ver:first.ver});
  assert.equal(next.po[0].status,'aktif');assert.equal(next.po[0].tuntasPada,'');assert.equal(next.po[0].workflow.pendingCutPlans,true);assert.equal(next.po[0].workflow.complete,false);
  assert.equal(f.raw('Potong').length,1);assert.equal(f.raw('SlipUpah').length,0);
});
