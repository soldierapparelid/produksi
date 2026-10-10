'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
function fixture(){
  const h=harness();
  for(const name of ['cutting-plans','reconcile-legacy','history-corrections','auto-completion'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name+'.js'),'utf8'),h.context);
  const setup=h.request('setupOwner',{nama:'Owner fixture',pin:'1234'});assert.equal(setup.ok,true,setup.error);const token=setup.data.token,cutter='size-cutter-token-123456';
  h.run(`pkStore_().lock(function(){pkStore_().append('Pegawai',{id:'cutter001',nama:'Cutter',divisi:'potong',aktif:true,token:'${cutter}'});pkStore_().append('Pegawai',{id:'sewer0001',nama:'Sewer',divisi:'jahit',aktif:true});pkStore_().append('StokBahan',{id:'size-stock-001',jenis:'beli',bahan:'Katun',qty:25,satuan:'kg',rol:1,stockMode:'roll',rollLabel:'A-1'});});`);
  const call=(action,p={},tk=token)=>{h.cold();return h.request(action,{token:tk,workflowVersion:2,...p});};
  const good=(action,p={},tk=token)=>{const r=call(action,p,tk);assert.equal(r.ok,true,r.error);return r.data?.data??r.data;};
  const raw=name=>{h.cold();return h.run(`pkStore_().fresh('${name}');pkStore_().read('${name}')`);};
  const bundle=(extra={})=>({po:{newId:'size-po-001',nama:'Native selected sizes',jenis:'stok',ukuran:{},ukuranAktif:['M','L'],...extra},rencana:{id:'size-plan-001',alokasiBahan:[{stokId:'size-stock-001',qty:4}]}});
  const cut=(plan,sizes,id)=>good('createPotong',{potong:{id,rencanaId:plan.id,expectedRencanaRevision:plan.revision,tanggal:'2026-10-08',ukuran:sizes}},cutter);
  return {h,token,cutter,call,good,raw,bundle,cut};
}
test('PO selects exact active sizes without target quantities, reserves registered material, and retries once',()=>{
  const f=fixture(),input=f.bundle(),created=f.good('savePOWithRencana',input),po=f.raw('PO')[0];
  assert.equal(po.ukuran,'{}');assert.equal(po.total,0);assert.deepEqual(JSON.parse(po.ukuranAktif),['M','L']);
  const state=f.good('getState',{},f.cutter),shown=state.po[0];assert.deepEqual(shown.cutting.ukuran,['M','L']);assert.deepEqual(shown.cutting.pendingUkuran,['M','L']);assert.equal(state.rencanaPotong.length,1);
  assert.equal(f.good('getState').stokRol[0].dicadangkan,4);
  f.good('savePOWithRencana',input);assert.equal(f.raw('PO').length,1);assert.equal(f.raw('RencanaPotong').length,1);
  const unknown=f.call('createPotong',{potong:{id:'size-badcut',rencanaId:created.rencana.id,expectedRencanaRevision:created.rencana.revision,ukuran:{XL:3}}},f.cutter);assert.equal(unknown.ok,false);assert.match(unknown.error,/tidak terdaftar/);assert.equal(f.raw('Potong').length,0);
  f.cut(created.rencana,{M:7},'size-cut-001');assert.deepEqual(f.good('getState').po[0].cutting.pendingUkuran,['L']);assert.equal(f.raw('PO')[0].total,0);assert.equal(f.raw('PO')[0].ukuran,'{}');
  f.good('savePOWithRencana',input);assert.equal(f.raw('Potong').length,1);assert.equal(f.raw('RencanaPotong').length,1);
});
test('missing size contract, unlisted sizes, quantities and direct no-material creation fail before either row writes',()=>{
  for(const extra of [{ukuranAktif:undefined},{ukuranAktif:[]},{ukuranAktif:['M','M']},{ukuranAktif:['NOT-SIZE']},{ukuran:{M:9}},{total:9}]){
    const f=fixture(),r=f.call('savePOWithRencana',f.bundle(extra));assert.equal(r.ok,false,JSON.stringify(extra));assert.equal(f.raw('PO').length,0);assert.equal(f.raw('RencanaPotong').length,0);
  }
  const f=fixture();assert.equal(f.call('savePO',{po:f.bundle().po}).ok,false);assert.equal(f.call('savePOWithRencana',{...f.bundle(),rencana:{id:'size-plan-001'}}).ok,false);assert.equal(f.raw('PO').length,0);assert.equal(f.raw('RencanaPotong').length,0);
  assert.equal(f.call('savePOWithRencana',f.bundle(),f.cutter).ok,false);
});
test('customer PO also has selected sizes and no target pcs',()=>{
  const f=fixture();f.good('savePOWithRencana',f.bundle({jenis:'pesanan',pelanggan:'Customer fixture'}));assert.equal(f.raw('PO')[0].total,0);assert.deepEqual(f.good('getState').po[0].cutting.pendingUkuran,['M','L']);
});
test('an uncut selected size blocks close and auto-completion, while the counted first size can already be inspected by QC',()=>{
  const f=fixture(),made=f.good('savePOWithRencana',f.bundle());f.cut(made.rencana,{M:7},'size-cut-001');
  f.h.run(`pkStore_().lock(function(){pkStore_().append('SlipKirim',{id:'size-send001',poId:'size-po-001',maklonId:'sewer0001',tanggal:'2026-10-08',ukuran:{M:7},total:7,upah:1000});pkStore_().append('SlipSetor',{id:'size-setor01',poId:'size-po-001',maklonId:'sewer0001',tanggal:'2026-10-08',ukuran:{M:7},total:7,reject:0,status:'diterima',upah:1000});});`);
  let state=f.good('getState'),po=state.po[0];assert.equal(po.workflow.ukuran.M.readyQC,true);assert.equal(po.workflow.readyQC,true);assert.equal(po.workflow.complete,false);
  const qc=f.call('createQC',{qc:{id:'size-qc001',poId:'size-po-001',setorId:'size-setor01',ukuran:{M:7},tanggal:'2026-10-08'}});assert.equal(qc.ok,true);
  f.h.run(`pkStore_().lock(function(){pkStore_().update('PO','size-po-001',{tuntasPada:'2020-01-01T00:00:00Z'});});`);
  po=f.good('getState').po[0];assert.equal(po.workflow.ukuran.M.complete,true);assert.equal(po.workflow.complete,false);assert.equal(po.status,'aktif');assert.equal(po.tuntasPada,'');assert.equal(f.call('setStatusPO',{id:po.id,status:'selesai'}).ok,false);
  const next=f.good('saveRencanaPotong',{rencana:{id:'size-plan-002',poId:po.id,alokasiBahan:[{stokId:'size-stock-001',qty:3}]}});f.cut(next,{L:5},'size-cut-002');assert.deepEqual(f.good('getState').po[0].cutting.pendingUkuran,[]);
});
test('native sizes cannot be changed after production and legacy edits keep original raw targets',()=>{
  const f=fixture(),input=f.bundle(),made=f.good('savePOWithRencana',input);f.cut(made.rencana,{M:4},'size-cut-001');
  assert.equal(f.call('savePO',{po:{...input.po,id:'size-po-001',ukuranAktif:['M']}}).ok,false);
  f.h.run(`pkStore_().lock(function(){pkStore_().append('PO',{id:'old-size-po',noPO:'PO-OLD',nama:'OLD',jenis:'stok',asal:'lama',status:'aktif',ukuran:'{ "L" : 114 }',total:114});});`);
  f.good('savePO',{po:{id:'old-size-po',nama:'OLD EDITED',jenis:'stok',status:'aktif',ukuran:{L:144},total:144}});const old=f.raw('PO').find(p=>p.id==='old-size-po');assert.equal(old.ukuran,'{ "L" : 114 }');assert.equal(old.total,114);assert.equal(old.ukuranAktif,'');
  assert.equal(f.call('savePO',{po:{id:old.id,nama:old.nama,jenis:'stok',ukuranAktif:['L'],ukuran:{}}}).ok,false);
});
test('old durable pending bundle resumes unchanged while new old-client target requests are rejected',()=>{
  const f=fixture();
  f.h.run(`pkStore_().lock(function(){var owner=pkStore_().read('Pegawai').filter(function(r){return r.divisi==='owner';})[0];var draft={newId:'old-pending-po',noPO:'PO-2610-011',jenis:'stok',produkId:'',nama:'OLD PENDING',series:'',pelanggan:'',deadline:'',total:10,bahan:'',catatan:'',status:'aktif',ukuran:{M:10}};pkStore_().append('RencanaPotong',{id:'old-pending-plan',poId:draft.newId,bahanList:[{nama:'Katun',qty:2,satuan:'kg'}],alokasiBahan:[{stokId:'size-stock-001',qty:2}],legacyBahanList:[],rol:1,status:'siap',revision:'old-revision',catatan:'',dibuatOleh:owner.id,poDraft:draft});});`);
  const raw=f.raw('RencanaPotong')[0],draft=JSON.parse(raw.poDraft);f.good('savePOWithRencana',{po:draft,rencana:{id:raw.id,alokasiBahan:[{stokId:'size-stock-001',qty:2}]}});
  assert.equal(f.raw('PO')[0].total,10);assert.equal(f.raw('PO')[0].ukuranAktif,'');assert.equal(f.raw('RencanaPotong').length,1);
  const r=f.call('savePOWithRencana',{po:{newId:'old-client-new',nama:'OLD CLIENT',ukuran:{M:10}},rencana:{id:'old-client-plan',alokasiBahan:[{stokId:'size-stock-001',qty:2}]}});assert.equal(r.ok,false);assert.match(r.error,/Muat ulang/);assert.equal(f.raw('PO').length,1);
});

test('demo seed uses prepared selected-size POs and completes without its silent wipe fallback',()=>{
  const h=harness();for(const name of ['cutting-plans','reconcile-legacy','history-corrections','auto-completion'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name+'.js'),'utf8'),h.context);
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),start=html.indexOf('function seedDemo()'),end=html.indexOf('/* Versi baru aplikasi',start);assert.ok(start>0&&end>start);
  h.run(`var demoOffset=0,demoSerial=0,demoWiped=false,demoError='',demoBooted=false,S={},saved={};var LS={set:function(k,v){saved[k]=v;},del:function(k){delete saved[k];}};function tokenKey(){return 'test-token';}function newId(){return 'demo-row-'+(++demoSerial);}function boot(){demoBooted=true;}pkSetup_();var Api={setClock:function(n){demoOffset=n;},local:function(){return {wipe:function(){demoWiped=true;}};},localCall:function(action,p){try{var env=pkEnv_();env.now=function(){return new Date(Date.now()-demoOffset);};return createCore(pkStore_(),env).handle(action,p);}catch(e){demoError=action+': '+e.message;throw e;}}};`);
  vm.runInContext(html.slice(start,end),h.context);h.run('seedDemo();');assert.equal(h.run('demoWiped'),false,h.run('demoError'));assert.equal(h.run('demoBooted'),true);
  const data=h.run("({po:pkStore_().read('PO'),plans:pkStore_().read('RencanaPotong'),cuts:pkStore_().read('Potong')})");assert.equal(data.po.length,6);assert.equal(data.plans.length,6);assert.equal(data.cuts.length,5);assert.ok(data.po.every(p=>p.total===0&&JSON.parse(p.ukuranAktif).length===4));assert.ok(data.cuts.every(r=>r.rencanaId));
});
