'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=['core','cutting-plans'].map(f=>fs.readFileSync(path.resolve(__dirname,'../src/'+f+'.js'),'utf8')).join('\n');
function fixture(){
 const c=vm.createContext({});vm.runInContext(source+`
 var db={},writes=0,serial=0,config={};Object.keys(SCHEMA).forEach(function(k){db[k]=[];});
 db.Pegawai=[{id:'owner01',nama:'Owner',divisi:'owner',aktif:true,token:'owner-session-12345678'},{id:'worker1',nama:'Worker A',divisi:'jahit',aktif:true},{id:'worker2',nama:'Worker B',divisi:'jahit',aktif:true},{id:'qcuser1',nama:'QC',divisi:'qc',aktif:true,token:'qc-session-1234567890'}];
 db.PO=[{id:'po00001',noPO:'PO-OLD',nama:'Legacy garment',asal:'lama',status:'aktif',ukuran:{L:100,M:20},total:120}];
 db.Potong=[{id:'cut0001',poId:'po00001',ukuran:{L:100,M:20},total:120}];
 db.SlipKirim=[{id:'send001',poId:'po00001',maklonId:'worker1',ukuran:{L:70,M:20},total:90},{id:'send002',poId:'po00001',maklonId:'worker2',ukuran:{L:30},total:30}];
 db.SlipSetor=[
 {id:'oldcount',poId:'po00001',maklonId:'worker1',tanggal:'2026-09-15',ukuran:{L:50,M:20},total:70,reject:0,status:'diterima',asal:'lama',workflowVersion:0,upah:2000,upahId:'LAMA'},
 {id:'newcount',poId:'po00001',maklonId:'worker1',tanggal:'2026-10-11',ukuran:{L:20},total:20,reject:0,status:'diterima',workflowVersion:2,upah:2000},
 {id:'othercount',poId:'po00001',maklonId:'worker2',tanggal:'2026-09-15',ukuran:{L:30},total:30,reject:0,status:'diterima',asal:'lama',workflowVersion:0,upah:2500}];
 db.QC=[{id:'old-qc-1',poId:'po00001',maklonId:'worker1',tanggal:'2026-09-16',ukuran:{L:50},total:50,offline:0,perbaikan:0,reject:0,setorId:'',asal:'lama',workflowVersion:0}];
 db.SlipUpah=[{id:'paid-old1',pegawaiId:'worker1',jenis:'jahit',tanggal:'2026-09-17',itemIds:'["oldcount"]',totalQty:70,totalUpah:140000,dibayar:140000}];
 var store={read:function(t){return db[t]||[];},getSettings:function(){return config;},version:function(){return writes+1;},lock:function(f){return f();},append:function(t,r){db[t].push(r);writes++;},appendMany:function(t,rs){db[t]=db[t].concat(rs);writes++;},update:function(t,id,p){Object.assign(db[t].find(function(r){return r.id===id;}),p);writes++;}};
 var core=createCore(store,{now:function(){return new Date('2026-10-11T08:00:00Z');},id:function(){return 'newid'+(++serial);}});
 `,c);
 const run=s=>{const v=vm.runInContext(s,c);return v===undefined?undefined:JSON.parse(JSON.stringify(v));};
 const call=(action,p={})=>run(`core.handle(${JSON.stringify(action)},${JSON.stringify({token:'owner-session-12345678',workflowVersion:2,...p})})`);
 const state=()=>call('getState',{semua:true});
 const flow=()=>run('coreWorkflow(db.PO,db.Potong,db.SlipKirim,db.SlipSetor,db.QC,db.Gudang).po00001');
 const batch=(ids,ukuran,id='batch-qc-old')=>({qc:{id,poId:'po00001',tanggal:'2026-10-11',kelompok:[{sources:ids.map(id=>({setorId:id,expectedRevision:state().setor.find(r=>r.id===id).qcRevision})),ukuran}]}});
 return{run,call,state,flow,batch};
}

test('v0 ambiguity holds only the old same-worker size and does not subtract unlinked QC twice',()=>{
 const a=fixture(),f=a.flow(),u=f.ukuran.L;
 assert.deepEqual(f.blockedQcSources,{oldcount:['L']});assert.match(f.qcReviewSources.oldcount.L,/hubungan pasti/);assert.equal(f.qcReviewSources.oldcount.M,undefined);
 assert.equal(u.diterima,100);assert.equal(u.qcOk,50);assert.equal(u.legacyUnlinkedQC,50);assert.equal(u.legacyBlockedCount,50);assert.equal(u.siapQC,50);assert.equal(f.ukuran.M.siapQC,20);
 assert.equal(f.readyQC,true);assert.equal(f.complete,false);assert.equal(a.state().po[0].workflow.qcReviewSources.oldcount.L,f.qcReviewSources.oldcount.L);
});

test('single and combined QC reject held history before writes or payment changes',()=>{
 const a=fixture(),before=a.run('JSON.stringify(db)'),pay=a.run('corePayroll(db.Potong,db.SlipSetor,db.QC,db.SlipUpah)');
 assert.throws(()=>a.call('createQC',{qc:{id:'qc-invalid',poId:'po00001',setorId:'oldcount',tanggal:'2026-10-11',ukuran:{L:50}}}),/hubungan pasti/);
 assert.throws(()=>a.call('simpanQCGabungan',a.batch(['oldcount'],{L:50})),/hubungan pasti/);
 assert.equal(a.run('JSON.stringify(db)'),before);assert.equal(a.run('writes'),0);assert.deepEqual(a.run('corePayroll(db.Potong,db.SlipSetor,db.QC,db.SlipUpah)'),pay);
});

test('one batch can inspect an unblocked size on old receipt and a new native same-PO receipt',()=>{
 const a=fixture(),old=a.run('JSON.stringify(db.SlipSetor[0])'),paid=a.run('JSON.stringify(db.SlipUpah)'),out=a.call('simpanQCGabungan',a.batch(['oldcount','newcount'],{M:20,L:20})).data;
 assert.deepEqual(out.records.map(q=>[q.setorId,JSON.parse(q.ukuran)]),[['oldcount',{M:20}],['newcount',{L:20}]]);
 assert.equal(a.run('writes'),1);assert.equal(a.run('JSON.stringify(db.SlipSetor[0])'),old);assert.equal(a.run('JSON.stringify(db.SlipUpah)'),paid);
 const f=a.flow();assert.equal(f.ukuran.L.siapQC,30);assert.equal(f.ukuran.M.siapQC,0);assert.deepEqual(f.blockedQcSources,{oldcount:['L']});assert.equal(f.complete,false);
 const earnings=a.run('corePayroll(db.Potong,db.SlipSetor,db.QC,db.SlipUpah)');assert.equal(earnings.filter(r=>r.sourceId==='oldcount').reduce((n,r)=>n+r.available,0),0);
});

test('size and worker isolation permit old unrelated source and fully linked real history stays out of review',()=>{
 const a=fixture();a.call('createQC',{qc:{id:'other-qc',poId:'po00001',setorId:'othercount',tanggal:'2026-10-11',ukuran:{L:30}}});
 assert.equal(a.flow().ukuran.L.siapQC,20);assert.equal(a.flow().qcReviewSources.othercount,undefined);
 a.run(`db.QC[0].setorId='oldcount';true`);
 const f=a.flow();assert.equal(f.qcReviewSources.oldcount,undefined);assert.equal(f.ukuran.L.legacyUnlinkedQC,0);assert.equal(f.ukuran.L.siapQC,20);
});

test('automatic v0 mirrors hold uncertain historical reports without declaring inspection or completion',()=>{
 for(const flagged of [false,true]){
  const a=fixture();a.run(`db.QC[0].id='qh-old-mirror';db.QC[0].autoFromCount=${flagged};db.SlipSetor=db.SlipSetor.slice(0,1);db.SlipSetor[0].ukuran={L:50};db.SlipSetor[0].total=50;db.PO[0].ukuran={L:50};db.Potong[0].ukuran={L:50};db.Potong[0].total=50;db.SlipKirim=[{id:'send001',poId:'po00001',maklonId:'worker1',ukuran:{L:50},total:50}];true`);
  const f=a.flow();assert.equal(f.ukuran.L.siapQC,0);assert.equal(f.readyQC,false);assert.equal(f.complete,false);assert.equal(f.ukuran.L.complete,false);assert.match(f.qcReviewSources.oldcount.L,/hubungan pasti/);assert.equal(a.run('db.QC[0].setorId'),'');
 }
});

test('new unlinked historical evidence invalidates the old captured source proof before batch validation',()=>{
 const a=fixture();a.run('db.QC=[];true');const draft=a.batch(['oldcount'],{L:50,M:20});
 a.run(`db.QC.push({id:'late-old-qc',poId:'po00001',maklonId:'worker1',tanggal:'2026-09-16',ukuran:{L:50},total:50,asal:'lama',workflowVersion:0,setorId:''});true`);
 assert.throws(()=>a.call('simpanQCGabungan',draft),/berubah sejak/);assert.equal(a.run('writes'),0);
});

test('known different legacy cycles do not become linked solely through PO, worker and size',()=>{
 const a=fixture();a.run(`db.SlipSetor[0].imporSumber={skuId:'sku-one',siklus:'cycle-one'};db.QC[0].imporSumber={skuId:'sku-one',siklus:'cycle-two'};true`);
 assert.equal(a.flow().qcReviewSources.oldcount,undefined);assert.equal(a.flow().ukuran.L.siapQC,100);
});
