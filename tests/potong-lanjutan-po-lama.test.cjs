'use strict';
/* 1543c: potong lanjutan juga berlaku untuk PO bawaan aplikasi lama, bila potongan pertamanya memakai persiapan bahan
   yang dibuat di aplikasi ini. Jatah bahan lama (satu ukuran per jatah) tidak membuka lanjutan. Semua data buatan. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
function fixture(planId,links){
 const h=harness();vm.runInContext(['reconcile-legacy.js','history-corrections.js','cutting-plans.js','auto-completion.js'].map(f=>fs.readFileSync(path.resolve(__dirname,'../src',f),'utf8')).join('\n'),h.context);
 const setup=h.request('setupOwner',{nama:'Owner test',pin:'1234'});assert.equal(setup.ok,true,setup.error);const owner=setup.data.token,cutter='cutter_session_lama_000001',other='other_session_lama_0000002';
 h.run(`pkStore_().lock(function(){
  [{id:'cutter1',nama:'Cutter',divisi:'potong',aktif:true,token:'${cutter}'},{id:'cutter2',nama:'Other',divisi:'potong',aktif:true,token:'${other}'}].forEach(function(r){pkStore_().append('Pegawai',r);});
  var p={id:'lamapo01',nama:'PO lama',noPO:'PO-LAMA',status:'aktif',asal:'lama',ukuran:{},total:0};
  var sizes=['M','XL','XXL'].map(function(size,i){return {skuId:'sku'+i,cycle:JSON.stringify({0:'sku'+i,1:'',2:{}}),ukuran:size,hadCutAtImport:false};}),links=${JSON.stringify(links)};
  var evidence={version:1,source:'verified-full-backup',snapshotHash:'a'.repeat(64),batchId:'verified-batch',sizes:sizes,plans:links};evidence.proofHash=coreLegacyHash({poId:p.id,snapshotHash:evidence.snapshotHash,batchId:evidence.batchId,sizes:sizes,plans:links});p.imporSumber=JSON.stringify({legacyCutting:evidence});
  pkStore_().append('PO',p);pkStore_().append('StokBahan',{id:'stock001',jenis:'beli',bahan:'Cotton',qty:20,satuan:'kg',tanggal:'2026-10-01',rol:2});
  pkStore_().append('RencanaPotong',{id:'${planId}',poId:'lamapo01',status:'siap',revision:'rev-${planId}',bahanList:JSON.stringify([{nama:'Cotton',qty:2,satuan:'kg'}]),rol:1});
 });`);
 function call(action,p={},token=owner){h.cold();return h.request(action,{token,workflowVersion:2,...p});}
 function good(action,p={},token=owner){const r=call(action,p,token);assert.equal(r.ok,true,r.error);return r.data?.data??r.data;}
 function raw(sheet){h.cold();return h.run(`pkStore_().fresh('${sheet}');pkStore_().read('${sheet}')`);}
 const first=(sizes,token=cutter)=>good('createPotong',{potong:{id:'pertama01',poId:'lamapo01',rencanaId:planId,expectedRencanaRevision:'rev-'+planId,ukuran:sizes,tanggal:'2026-10-13'}},token);
 const next=(id,sizes,token=cutter)=>call('createPotong',{potong:{id,poId:'lamapo01',lanjut:true,tanggal:'2026-10-14',ukuran:sizes}},token);
 return {h,owner,cutter,other,call,good,raw,first,next};
}

test('an old-app PO cut for one size from a preparation made in this app can be continued for its other sizes',()=>{
 const f=fixture('baru0001',[]);
 let po=f.good('getState',{},f.cutter).po[0];assert.deepEqual(po.cutting.pendingUkuran,['M','XL','XXL']);assert.equal(po.cutting.lanjut,undefined,'nothing to continue before the first cut');
 const early=f.next('awal0001',{XL:3});assert.equal(early.ok,false);assert.match(early.error,/tidak bisa dilanjutkan/);
 f.first({M:272});
 const seen=f.good('getState',{},f.other);po=seen.po[0];
 assert.deepEqual(po.cutting.pendingUkuran,['XL','XXL']);assert.equal(po.cutting.lanjut,'baru0001','the old-app PO is offered for continuation');
 assert.deepEqual(seen.rencanaPotong.map(r=>[r.id,r.status]),[['baru0001','terpakai']],'another cutter still sees the fabric that was taken');
 const lagi=f.next('ulangm01',{M:5});assert.equal(lagi.ok,false);assert.match(lagi.error,/Ukuran M sudah dicatat dipotong/);
 const bahan=f.call('createPotong',{potong:{id:'bahan001',poId:'lamapo01',lanjut:true,ukuran:{XL:3},bahanList:[{nama:'Cotton',qty:1}]}},f.cutter);assert.equal(bahan.ok,false);assert.match(bahan.error,/tidak membawa bahan/);
 const xl=f.next('lanjutxl',{XL:120},f.other);assert.equal(xl.ok,true,xl.error);
 po=f.good('getState',{},f.cutter).po[0];assert.deepEqual(po.cutting.pendingUkuran,['XXL']);assert.equal(po.cutting.lanjut,'baru0001');
 const xxl=f.next('lanjutxx',{XXL:60});assert.equal(xxl.ok,true,xxl.error);
 po=f.good('getState').po[0];assert.deepEqual(po.cutting.pendingUkuran,[]);assert.equal(po.cutting.lanjut,undefined,'nothing left to continue');assert.equal(po.agg.total.potong,452);
 const rows=f.raw('Potong');assert.deepEqual(rows.map(r=>[r.id,r.asal||'',r.rencanaId||'',Number(r.kg)||0,r.bahanList?JSON.parse(r.bahanList).length:0,r.userId]),[['pertama01','','baru0001',2,1,'cutter1'],['lanjutxl','lanjut','',0,0,'cutter2'],['lanjutxx','lanjut','',0,0,'cutter1']],'the fabric is counted on the first cut only');
 assert.equal(Number(rows[1].tarif),Number(rows[0].tarif),'the same wage rate as the first cut');
});

test('an old-app PO cut from an old single-size fabric allotment still waits for fabric for its other sizes',()=>{
 const f=fixture('jatah001',[{sourcePlanId:'source-one',rencanaId:'jatah001',status:'ready',ukuran:['M'],reviewCode:''}]);
 assert.deepEqual(f.good('getState',{},f.cutter).rencanaPotong.find(r=>r.id==='jatah001').legacyUkuran,['M']);
 f.first({M:10});
 const po=f.good('getState',{},f.cutter).po[0];assert.deepEqual(po.cutting.pendingUkuran,['XL','XXL']);assert.equal(po.cutting.lanjut,undefined,'the old allotment covered size M only');
 const r=f.next('tolak001',{XL:5});assert.equal(r.ok,false);assert.match(r.error,/tidak bisa dilanjutkan/);assert.equal(f.raw('Potong').length,1);
});
