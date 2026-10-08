'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
function fixture(){
 const h=harness();vm.runInContext(['reconcile-legacy.js','history-corrections.js','cutting-plans.js','auto-completion.js'].map(f=>fs.readFileSync(path.resolve(__dirname,'../src',f),'utf8')).join('\n'),h.context);
 const setup=h.request('setupOwner',{nama:'Owner test',pin:'1234'});assert.equal(setup.ok,true,setup.error);const owner=setup.data.token,cutter='cutter_session_123456789',other='other_session_123456789';
 h.run(`pkStore_().lock(function(){
  [{id:'cutter1',nama:'Cutter',divisi:'potong',aktif:true,token:'${cutter}'},{id:'cutter2',nama:'Other',divisi:'potong',aktif:true,token:'${other}'},{id:'sewer001',nama:'Sewer',divisi:'jahit',aktif:true}].forEach(function(r){pkStore_().append('Pegawai',r);});
  var p={id:'mixedpo1',nama:'Mixed sizes',noPO:'PO-SOURCE',status:'aktif',asal:'lama',ukuran:{M:10},total:10};
  var sizes=['M','XL','XXL'].map(function(size,i){return {skuId:'sku'+i,cycle:JSON.stringify({0:'sku'+i,1:'',2:{}}),ukuran:size,hadCutAtImport:size==='M'};});
  var evidence={version:1,source:'verified-full-backup',snapshotHash:'a'.repeat(64),batchId:'verified-batch',sizes:sizes,plans:[]};evidence.proofHash=coreLegacyHash({poId:p.id,snapshotHash:evidence.snapshotHash,batchId:evidence.batchId,sizes:sizes,plans:[]});p.imporSumber=JSON.stringify({legacyCutting:evidence,privateProof:'KEEP OFF WORKER'});
  pkStore_().append('PO',p);pkStore_().append('Potong',{id:'initialcut',poId:p.id,userId:'cutter1',tanggal:'2026-10-01',ukuran:{M:10},total:10,tarif:500,asal:'lama'});
 });`);
 function call(action,p={},token=owner){h.cold();return h.request(action,{token,workflowVersion:2,...p});}
 function good(action,p={},token=owner){const r=call(action,p,token);assert.equal(r.ok,true,r.error);return r.data?.data??r.data;}
 function raw(sheet){h.cold();return h.run(`pkStore_().fresh('${sheet}');pkStore_().read('${sheet}')`);}
 function mutate(expression){h.run(`pkStore_().lock(function(){var p=pkStore_().read('PO')[0],source=coreMap(p.imporSumber);${expression};pkStore_().update('PO',p.id,{imporSumber:JSON.stringify(source)});});`);}
 return {h,owner,cutter,other,call,good,raw,mutate};
}
test('verified missing-size projection reads every worker cut and never exposes raw source evidence to worker',()=>{
 const f=fixture(),before=f.raw('Potong'),state=f.good('getState',{},f.other),po=state.po[0];assert.deepEqual(po.cutting,{verified:true,ukuran:['M','XL','XXL'],pendingUkuran:['XL','XXL'],needsReview:false});assert.equal(state.potong.length,0);assert.equal(po.agg.total.potong,10);assert.equal(po.imporSumber,undefined);assert.doesNotMatch(JSON.stringify(po),/KEEP OFF WORKER|verified-batch|sku0|snapshotHash|proofHash/);assert.deepEqual(f.raw('Potong'),before);assert.ok(f.good('getState').po[0].imporSumber);
});
test('new actual cut clears only its size and trusted overlay permits it without rewriting targets',()=>{
 const f=fixture();let r=f.call('createPotong',{potong:{id:'cutbad01',poId:'mixedpo1',userId:'cutter2',ukuran:{S:1}}});assert.equal(r.ok,false);assert.match(r.error,/tidak terdaftar/);
 r=f.call('createPotong',{potong:{id:'noplan01',poId:'mixedpo1',ukuran:{XL:7}}},f.other);assert.equal(r.ok,false);assert.match(r.error,/bahan|rencana|owner/i);
 f.good('createPotong',{potong:{id:'cutxl001',poId:'mixedpo1',userId:'cutter2',ukuran:{XL:7},tarif:500}});let po=f.good('getState',{},f.cutter).po[0];assert.deepEqual(po.cutting.pendingUkuran,['XXL']);assert.deepEqual(JSON.parse(f.raw('PO')[0].ukuran),{M:10});assert.equal(f.raw('PO')[0].total,10);
 f.good('createPotong',{potong:{id:'cutxxl01',poId:'mixedpo1',userId:'cutter1',ukuran:{XXL:8},tarif:500}});assert.deepEqual(f.good('getState',{},f.other).po[0].cutting.pendingUkuran,[]);
});
test('completed counted size cannot permit QC, completion or auto-close while source sizes are uncut',()=>{
 const f=fixture();f.h.run(`pkStore_().lock(function(){pkStore_().append('SlipKirim',{id:'sendm001',poId:'mixedpo1',maklonId:'sewer001',tanggal:'2026-10-01',ukuran:{M:10},total:10,upah:2000});pkStore_().append('SlipSetor',{id:'countm01',poId:'mixedpo1',maklonId:'sewer001',tanggal:'2026-10-02',ukuran:{M:10},total:10,reject:0,status:'diterima',upah:2000});});`);
 let po=f.good('getState').po[0];assert.equal(po.workflow.ukuran.M.readyQC,true);assert.equal(po.workflow.readyQC,false);assert.equal(po.workflow.complete,false);assert.deepEqual(po.workflow.pendingCutSizes,['XL','XXL']);assert.equal(f.call('createQC',{qc:{id:'qcnow001',poId:'mixedpo1',setorId:'countm01',ukuran:{M:10},tanggal:'2026-10-03'}}).ok,false);
 f.h.run(`pkStore_().lock(function(){pkStore_().append('QC',{id:'existingqc',poId:'mixedpo1',setorId:'countm01',maklonId:'sewer001',tanggal:'2026-10-03',ukuran:{M:10},total:10});pkStore_().update('PO','mixedpo1',{tuntasPada:'2020-01-01T00:00:00Z'});});`);
 po=f.good('getState').po[0];assert.equal(po.workflow.ukuran.M.complete,true);assert.equal(po.workflow.complete,false);assert.equal(po.status,'aktif');assert.equal(po.tuntasPada,'');assert.equal(f.call('setStatusPO',{id:'mixedpo1',status:'selesai'}).ok,false);
});
test('tampered or malformed evidence never adds allowed sizes and marks active source for review',()=>{
 for(const change of ["source.legacyCutting.sizes[1].ukuran='INJECT'","source.legacyCutting.source='generic-import'","source.legacyCutting.sizes[1].cycle=JSON.stringify({0:'different-sku'});source.legacyCutting.proofHash=coreLegacyHash({poId:p.id,snapshotHash:source.legacyCutting.snapshotHash,batchId:source.legacyCutting.batchId,sizes:source.legacyCutting.sizes,plans:source.legacyCutting.plans})"]){const f=fixture();f.mutate(change);const po=f.good('getState').po[0];assert.equal(po.cutting.verified,false);assert.deepEqual(po.cutting.ukuran,[]);assert.equal(po.cutting.needsReview,true);assert.equal(po.workflow.complete,false);assert.match(po.workflow.issues.join(' '),/Bukti ukuran/);assert.equal(f.call('createPotong',{potong:{id:'invalidcut',poId:'mixedpo1',userId:'cutter1',ukuran:{XL:2}}}).ok,false);}
});
test('generic imports cannot create, alter or delete verified evidence; omitted existing marker is preserved',()=>{
 const f=fixture(),po=f.raw('PO')[0],source=JSON.parse(po.imporSumber);const forged={...po,id:'foreignpo',imporSumber:source};assert.equal(f.call('importRows',{sheet:'PO',rows:[forged]}).ok,false);assert.equal(f.call('gantiImpor',{data:{PO:[po,forged]}}).ok,false);
 const altered=JSON.parse(JSON.stringify(source));altered.legacyCutting.sizes[1].ukuran='INJECT';assert.equal(f.call('gantiImpor',{data:{PO:[{...po,imporSumber:altered}]}}).ok,false);assert.equal(f.call('gantiImpor',{data:{PO:[]}}).ok,false);
 f.good('gantiImpor',{data:{PO:[{...po,imporSumber:JSON.stringify({legacyMarker:'separate metadata'})}]}});assert.deepEqual(JSON.parse(f.raw('PO')[0].imporSumber).legacyCutting,source.legacyCutting);
});
test('closed source PO stays closed and ordinary PO size permissions are unchanged',()=>{
 const f=fixture();f.h.run("pkStore_().lock(function(){pkStore_().update('PO','mixedpo1',{status:'selesai',selesaiPada:'2026-10-08'});pkStore_().append('PO',{id:'normalpo',nama:'Ordinary',status:'aktif',ukuran:{M:3},total:3});});");const closed=f.good('getState').po.find(p=>p.id==='mixedpo1');assert.equal(closed.status,'selesai');assert.deepEqual(closed.cutting.pendingUkuran,[]);const result=f.call('createPotong',{potong:{id:'normalbad',poId:'normalpo',userId:'cutter1',ukuran:{XL:3}}});assert.equal(result.ok,false);assert.match(result.error,/tidak terdaftar/);
});

test('native-size fields cannot override trusted source pending sizes or enter through a legacy import',()=>{
 const f=fixture(),before=f.raw('PO')[0];
 assert.equal(f.call('gantiImpor',{data:{PO:[{...before,ukuranAktif:['M']}]}}).ok,false);
 assert.equal(f.call('importRows',{sheet:'PO',rows:[{id:'injectedpo',nama:'Injected',status:'aktif',ukuranAktif:['M']}]}).ok,false);
 f.h.run("pkStore_().lock(function(){pkStore_().update('PO','mixedpo1',{ukuranAktif:JSON.stringify(['M','INJECT'])});});");
 const po=f.good('getState').po[0];assert.deepEqual(po.cutting.ukuran,['M','XL','XXL']);assert.deepEqual(po.cutting.pendingUkuran,['XL','XXL']);assert.equal(po.workflow.readyQC,false);assert.equal(po.workflow.complete,false);
 const bad=f.call('createPotong',{potong:{id:'injectedcut',poId:'mixedpo1',userId:'cutter1',ukuran:{INJECT:2}}});assert.equal(bad.ok,false);assert.match(bad.error,/tidak terdaftar/);assert.equal(f.raw('Potong').length,1);
});

function prepareBound(f,links){
 f.h.run(`pkStore_().lock(function(){pkStore_().append('StokBahan',{id:'stock001',jenis:'beli',bahan:'Cotton',qty:20,satuan:'kg',tanggal:'2026-10-01',rol:2});['bound001','bound002','native01'].forEach(function(id){pkStore_().append('RencanaPotong',{id:id,poId:'mixedpo1',status:'siap',revision:'rev-'+id,bahanList:JSON.stringify([{nama:'Cotton',qty:2,satuan:'kg'}]),rol:1});});});`);
 f.mutate('source.legacyCutting.plans='+JSON.stringify(links)+";source.legacyCutting.proofHash=coreLegacyHash({poId:p.id,snapshotHash:source.legacyCutting.snapshotHash,batchId:source.legacyCutting.batchId,sizes:source.legacyCutting.sizes,plans:source.legacyCutting.plans})");
}
test('bound single-size legacy plan allows only its uncut size while native plans keep their existing choices',()=>{
 const f=fixture();prepareBound(f,[{sourcePlanId:'source-one',rencanaId:'bound001',status:'ready',ukuran:['XL'],reviewCode:''},{sourcePlanId:'source-two',rencanaId:'bound002',status:'ready',ukuran:['XL'],reviewCode:''}]);
 const state=f.good('getState',{},f.other),plan=state.rencanaPotong.find(p=>p.id==='bound001');assert.deepEqual(plan.legacyUkuran,['XL']);assert.equal(plan.legacyBlocked,'');assert.equal(state.rencanaPotong.find(p=>p.id==='native01').legacyUkuran,undefined);
 function payload(id,plan,ukuran){return {potong:{id,poId:'mixedpo1',rencanaId:plan,expectedRencanaRevision:'rev-'+plan,ukuran,tanggal:'2026-10-08'}};}
 assert.equal(f.call('createPotong',payload('wrong001','bound001',{M:5}),f.other).ok,false);assert.equal(f.raw('Potong').length,1);
 const original=payload('right001','bound001',{XL:5});f.good('createPotong',original,f.other);f.good('createPotong',original,f.other);assert.equal(f.raw('Potong').length,2);
 assert.match(f.good('getState',{},f.cutter).rencanaPotong.find(p=>p.id==='bound002').legacyBlocked,/sudah dipotong/);assert.equal(f.call('createPotong',payload('second01','bound002',{XL:3}),f.cutter).ok,false);
 f.good('createPotong',payload('nativecut','native01',{M:2,XXL:3}),f.cutter);assert.deepEqual(f.good('getState').po[0].cutting.pendingUkuran,[]);
});
test('multi-size legacy hold remains read-only with owner explanation and cannot be consumed via forged form',()=>{
 const f=fixture();prepareBound(f,[{sourcePlanId:'source-multi',rencanaId:'',status:'ready',ukuran:['XL','XXL'],reviewCode:'multi-size-plan-needs-batch-review'},{sourcePlanId:'bad-multi-binding',rencanaId:'bound001',status:'ready',ukuran:['XL','XXL'],reviewCode:'multi-size-plan-needs-batch-review'}]);const state=f.good('getState');assert.equal(state.po[0].cutting.reviewPlans.length,2);assert.match(state.po[0].cutting.reviewPlans[0].reason,/beberapa ukuran/);assert.match(state.rencanaPotong.find(p=>p.id==='bound001').legacyBlocked,/perlu diperiksa/);assert.equal(f.call('createPotong',{potong:{id:'fakeboth',rencanaId:'bound001',expectedRencanaRevision:'rev-bound001',ukuran:{XL:2,XXL:3}}},f.cutter).ok,false);assert.equal(f.raw('Potong').length,1);
});
