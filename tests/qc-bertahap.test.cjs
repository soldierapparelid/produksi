'use strict';
/* 1543d: QC bertahap. Hasil QC boleh disimpan sebagian (sebagian ukuran atau sebagian pcs dari satu ukuran pada satu
   hitungan); yang belum diperiksa tetap siap QC dan upahnya tetap dihitung seperti sebelum QC. Semua data buatan. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');

/* ---- satu slip, lewat inti langsung (seperti core-workflow.test.cjs) ---- */
const inti=['core.js','cutting-plans.js'].map(name=>fs.readFileSync(path.join(__dirname,'../src',name),'utf8')).join('\n');
function app(){
  const context=vm.createContext({});
  vm.runInContext(inti+`
    var db={},version=1,serial=0,config={};Object.keys(SCHEMA).forEach(function(s){db[s]=[];});
    db.Pegawai=[{id:'owner01',nama:'Owner',divisi:'owner',aktif:true,token:'owner-token-123456789'},{id:'worker1',nama:'Ali',divisi:'jahit',aktif:true,token:'worker-token-12345678'},{id:'cutter1',nama:'Cutter',divisi:'potong',aktif:true,token:'cutter-token-12345678'}];
    var store={read:function(s){return db[s]||[];},append:function(s,r){db[s].push(r);version++;},appendMany:function(s,rs){db[s]=db[s].concat(rs);version++;},
      update:function(s,id,p){var r=db[s].filter(function(x){return x.id===id;})[0];Object.assign(r,p);version++;},remove:function(s,id){db[s]=db[s].filter(function(r){return r.id!==id;});version++;},
      replaceAll:function(s,r){db[s]=r;version++;},getSettings:function(){return config;},setSettings:function(s){config=s;version++;},version:function(){return version;},lock:function(fn){return fn();}};
    var core=createCore(store,{now:function(){return new Date('2026-10-08T08:00:00Z');},id:function(){serial++;return 'newid000'+serial;}});
  `,context);
  const run=code=>JSON.parse(JSON.stringify(vm.runInContext(code,context)));
  const call=(action,payload={},token='owner-token-123456789')=>run(`core.handle(${JSON.stringify(action)},JSON.parse(${JSON.stringify(JSON.stringify({token,workflowVersion:2,...payload}))}))`);
  function seed(sizes){
    call('saveStok',{stok:{baru:true,jenis:'beli',bahan:'Fixture cloth',qty:5,satuan:'kg',rol:1,harga:1000}});
    const plan=call('savePOWithRencana',{po:{newId:'po00001',nama:'Kaos',ukuran:{},ukuranAktif:Object.keys(sizes)},rencana:{id:'fixture-plan',bahanList:[{nama:'Fixture cloth',qty:1,satuan:'kg'}],rol:1}}).data.rencana;
    call('createPotong',{potong:{id:'cut0001',poId:'po00001',userId:'cutter1',ukuran:sizes,tarif:500,rencanaId:plan.id,expectedRencanaRevision:plan.revision}});
    call('createKirim',{kirim:{id:'send001',poId:'po00001',maklonId:'worker1',ukuran:sizes,upah:2000}});
    call('createSetor',{setor:{id:'count01',poId:'po00001',maklonId:'worker1',ukuran:sizes,tanggal:'2026-10-02'}});
  }
  const inspect=(id,ukuran,extra={})=>call('createQC',{qc:{id,poId:'po00001',setorId:'count01',ukuran,tanggal:'2026-10-03',...extra}});
  return {run,call,seed,inspect,flow:()=>call('sync').po[0].workflow,upah:size=>run('corePayroll(db.Potong,db.SlipSetor,db.QC,db.SlipUpah)').find(r=>r.jenis==='jahit'&&r.size===size),db:sheet=>run(`db[${JSON.stringify(sheet)}]`)};
}

test('one size of one count is inspected in steps; what is not inspected yet stays ready for QC and keeps its wage basis',()=>{
  const a=app();a.seed({M:40,L:60});
  a.inspect('qc00001',{M:10},{perbaikanUkuran:{M:3},perbaikan:3,rejectUkuran:{M:2},reject:2});                       /* 15 of the 40 M */
  let w=a.flow();
  assert.deepEqual([w.ukuran.M.qcOk,w.ukuran.M.qcPerbaikan,w.ukuran.M.qcReject,w.ukuran.M.siapQC,w.ukuran.L.siapQC],[10,3,2,25,60]);
  assert.equal(w.readyQC,true);assert.equal(w.complete,false);assert.deepEqual(w.issues,[],'a partial inspection is not a problem');
  assert.equal(a.upah('M').total,35,'10 OK plus the 25 that are not inspected yet');assert.equal(a.upah('L').total,60);
  assert.throws(()=>a.inspect('qc00002',{M:26}),/melebihi sisa hitungan slip ini \(25 pcs\)/);assert.equal(a.db('QC').length,1);
  a.inspect('qc00002',{M:20},{rejectUkuran:{M:5},reject:5});                                                          /* the other 25 M */
  w=a.flow();assert.deepEqual([w.ukuran.M.qcOk,w.ukuran.M.qcReject,w.ukuran.M.siapQC],[30,7,0]);assert.deepEqual(w.issues,[]);
  assert.equal(a.upah('M').total,30,'everything inspected: only the OK pieces count');
  assert.throws(()=>a.inspect('qc00003',{M:1}),/sudah di-QC/);
  /* the other size, later and also in two steps */
  a.inspect('qc00004',{L:59});assert.equal(a.flow().ukuran.L.siapQC,1);assert.equal(a.upah('L').total,60);
  a.inspect('qc00005',{},{rejectUkuran:{L:1},reject:1});w=a.flow();assert.equal(w.ukuran.L.siapQC,0);assert.equal(a.upah('L').total,59);assert.deepEqual(w.issues,[]);
  assert.equal(a.db('QC').length,4);
});

test('a size may be left out completely and a QC result may never exceed its count',()=>{
  const a=app();a.seed({M:40,L:60});
  assert.throws(()=>a.inspect('qc00001',{M:41}),/melebihi sisa hitungan slip ini \(40 pcs\)/);
  a.inspect('qc00001',{M:40});let w=a.flow();assert.deepEqual([w.ukuran.M.siapQC,w.ukuran.L.siapQC,w.readyQC],[0,60,true]);assert.deepEqual(w.issues,[]);
  /* a row written around the rules is still reported by the workflow */
  a.run("db.QC.push(Object.assign({},db.QC[0],{id:'qcpalsu1',ukuran:JSON.stringify({M:1}),total:1}));true");
  assert.ok(a.flow().issues.some(s=>/QC qcpalsu1 melebihi hitungan ukuran M/.test(s)));
});

/* ---- beberapa slip digabung, lewat adaptor Apps Script (seperti qc-batch.test.cjs) ---- */
const server=['src/core.js','src/cutting-plans.js','apps-script/Server.gs'].map(f=>fs.readFileSync(path.resolve(__dirname,'..',f),'utf8')).join('\n');
function client(h){
  const c=vm.createContext(Object.fromEntries(['Date','console','PropertiesService','CacheService','SpreadsheetApp','LockService','Utilities'].map(k=>[k,h.context[k]])));vm.runInContext(server,c);
  return {request(action,payload={}){return JSON.parse(vm.runInContext('api('+JSON.stringify(JSON.stringify({action,payload:{clientVersion:vm.runInContext('APP_VERSION',c),workflowVersion:2,...payload}}))+')',c));}};
}
function fixture(){
  const h=harness(),owner=client(h).request('setupOwner',{nama:'Synthetic QC owner',pin:'1234'});assert.equal(owner.ok,true,owner.error);const token=owner.data.token;
  h.run(`pkStore_().lock(function(){
    pkStore_().appendMany('Pegawai',[{id:'sewer001',nama:'Synthetic sewer A',divisi:'jahit',aktif:true,token:'sewer-session-123456789'},{id:'cutter01',nama:'Synthetic cutter',divisi:'potong',aktif:true}]);
    pkStore_().append('PO',{id:'po000001',nama:'Synthetic garment',status:'aktif',ukuran:'{"M":10,"L":142}',total:152});
    pkStore_().append('Potong',{id:'cut00001',poId:'po000001',userId:'cutter01',tanggal:'2026-10-01',ukuran:'{"M":10,"L":142}',total:152,tarif:100});
    pkStore_().append('SlipKirim',{id:'send0001',poId:'po000001',maklonId:'sewer001',tanggal:'2026-10-02',ukuran:'{"M":10,"L":142}',total:152,upah:2000});
    pkStore_().appendMany('SlipSetor',[
      {id:'count001',noSlip:'SS-A',poId:'po000001',maklonId:'sewer001',tanggal:'2026-10-06',ukuran:'{"M":10,"L":50}',total:60,upah:2000,status:'diterima',workflowVersion:2},
      {id:'count002',noSlip:'SS-B',poId:'po000001',maklonId:'sewer001',tanggal:'2026-10-07',ukuran:'{"L":92}',total:92,upah:2000,status:'diterima',workflowVersion:2}
    ]);
  });true`);
  const call=(action,payload={})=>client(h).request(action,{token,...payload});
  const good=(action,payload={})=>{const out=call(action,payload);assert.equal(out.ok,true,out.error);return out.data;};
  const state=()=>good('getState',{semua:true});
  const sources=()=>state().setor.map(s=>({setorId:s.id,expectedRevision:s.qcRevision}));
  const simpan=(id,kelompok)=>call('simpanQCGabungan',{qc:{id,poId:'po000001',tanggal:'2026-10-08',catatan:'',kelompok}});
  return {h,call,good,state,sources,simpan,rows:table=>{h.cold();return h.run(`pkStore_().read(${JSON.stringify(table)})`);}};
}
const hasil=out=>(out.data.data||out.data).records.map(r=>[r.setorId,JSON.parse(r.ukuran),JSON.parse(r.rejectUkuran)]);

test('a combined QC may cover part of the counted pieces: the oldest count is filled first and the rest waits',()=>{
  const f=fixture(),lama=f.sources();
  let out=f.simpan('bertahap-001',[{sources:lama,ukuran:{L:58},rejectUkuran:{L:2}}]);assert.equal(out.ok,true,out.error);
  assert.deepEqual(hasil(out),[['count001',{L:50},{}],['count002',{L:8},{L:2}]],'60 of the 142 L: all 50 of the first count, 10 of the second');
  let w=f.state().po[0].workflow;assert.deepEqual([w.ukuran.L.siapQC,w.ukuran.L.qcOk,w.ukuran.L.qcReject,w.ukuran.M.siapQC],[82,58,2,10]);assert.deepEqual(w.issues,[]);
  /* the form opened before that save is refused; so is more than what is left */
  out=f.simpan('bertahap-002',[{sources:lama,ukuran:{L:10}}]);assert.equal(out.ok,false);assert.match(out.error,/berubah sejak formulir dibuka/);
  out=f.simpan('bertahap-002',[{sources:f.sources(),ukuran:{L:83}}]);assert.equal(out.ok,false);assert.match(out.error,/tidak melebihi sisa sumber terpilih \(82 pcs\)/);
  assert.equal(f.rows('QC').length,2);
  /* later: the rest of L and a part of M; the first count has no L left and only takes the M */
  out=f.simpan('bertahap-002',[{sources:f.sources(),ukuran:{L:82,M:4}}]);assert.equal(out.ok,true,out.error);
  assert.deepEqual(hasil(out),[['count001',{M:4},{}],['count002',{L:82},{}]]);
  w=f.state().po[0].workflow;assert.deepEqual([w.ukuran.L.siapQC,w.ukuran.M.siapQC,w.ukuran.M.qcOk],[0,6,4]);assert.deepEqual(w.issues,[]);
  /* only the second count still... nothing: the last 6 M sit on the first count; the second one is simply skipped */
  out=f.simpan('bertahap-003',[{sources:f.sources(),ukuran:{M:6}}]);assert.equal(out.ok,true,out.error);assert.deepEqual(hasil(out),[['count001',{M:6},{}]]);
  w=f.state().po[0].workflow;assert.deepEqual([w.ukuran.M.siapQC,w.ukuran.L.siapQC],[0,0]);assert.equal(f.rows('QC').length,5);
});
