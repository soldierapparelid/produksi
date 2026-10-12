'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');

function fixture(){
  const h=harness();
  for(const name of ['cutting-plans','reconcile-legacy','history-corrections','auto-completion'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name+'.js'),'utf8'),h.context);
  const setup=h.request('setupOwner',{nama:'Deferred owner',pin:'1234'});assert.equal(setup.ok,true,setup.error);
  const owner=setup.data.token,cutter='deferred-cutter-token',admin='deferred-admin-token';
  h.run(`pkStore_().lock(function(){pkStore_().append('Pegawai',{id:'defer-cutter',nama:'Cutter',divisi:'potong',aktif:true,token:'${cutter}'});pkStore_().append('Pegawai',{id:'defer-admin',nama:'Admin',divisi:'admin',aktif:true,token:'${admin}'});pkStore_().append('StokBahan',{id:'defer-stock-001',jenis:'beli',bahan:'Katun',qty:12.5,satuan:'kg',rol:1,stockMode:'roll',rollLabel:'R-1'});});`);
  function call(action,p={},token=owner){h.cold();return h.request(action,{token,workflowVersion:2,...p});}
  function good(action,p={},token=owner){const r=call(action,p,token);assert.equal(r.ok,true,r.error);return r.data?.data??r.data;}
  function bad(action,p,pattern,token=owner){const r=call(action,p,token);assert.equal(r.ok,false);if(pattern)assert.match(r.error,pattern);return r;}
  function raw(name){h.cold();return h.run(`pkStore_().fresh('${name}');pkStore_().read('${name}')`);}
  function input(extra={}){return{deferMaterial:true,po:{newId:'defer-po-001',nama:'Barang baru',jenis:'stok',ukuran:{},ukuranAktif:['L','XL'],...extra}};}
  return{h,owner,cutter,admin,call,good,bad,raw,input};
}

test('owner creates a selected-size PO first without a phantom plan, reservation or stock write',()=>{
  const f=fixture(),stock=f.raw('StokBahan'),writes=f.h.sheets.StokBahan.writes;
  const made=f.good('savePO',f.input());assert.equal(made.id,'defer-po-001');assert.equal(made.total,0);assert.equal(made.ukuran,'{}');
  assert.deepEqual(JSON.parse(made.ukuranAktif),['L','XL']);assert.equal(made.status,'aktif');
  assert.deepEqual(f.raw('StokBahan'),stock);assert.equal(f.h.sheets.StokBahan.writes,writes);assert.deepEqual(f.raw('RencanaPotong'),[]);assert.deepEqual(f.raw('Potong'),[]);
  const state=f.good('getState');assert.equal(state.stokRol[0].dicadangkan,0);assert.equal(state.stokRol[0].tersedia,12.5);
  assert.deepEqual(state.po[0].cutting.pendingUkuran,['L','XL']);assert.equal(state.po[0].workflow.complete,false);assert.equal(state.po[0].workflow.readyQC,false);
  assert.equal(f.good('getState',{},f.cutter).rencanaPotong.length,0);
});

test('cold duplicate creation is read-only and changed intent, actor or explicit material mode cannot reuse its ID',()=>{
  const f=fixture(),input=f.input();f.good('savePO',input);const before=f.raw('PO'),writes=f.h.sheets.PO.writes;
  assert.equal(f.good('savePO',input).id,'defer-po-001');assert.deepEqual(f.raw('PO'),before);assert.equal(f.h.sheets.PO.writes,writes);
  for(const po of [{nama:'Berubah'},{ukuranAktif:['L']},{noPO:'PO-DIFFERENT'},{catatan:'changed'}])f.bad('savePO',f.input(po),/berbeda/);
  for(const deferMaterial of [false,undefined])f.bad('savePO',{...input,deferMaterial,gambarData:'data:image/png;base64,BBBB'},/berbeda/);
  assert.equal(f.raw('Gambar').length,0);
  f.bad('savePO',input,/owner/,f.admin);f.bad('savePO',input,/owner|admin/,f.cutter);
  f.bad('savePOWithRencana',{...input,rencana:{id:'defer-plan-001',alokasiBahan:[{stokId:'defer-stock-001',qty:2}]}},/tanpa rencana/);
  assert.deepEqual(f.raw('PO'),before);assert.equal(f.raw('RencanaPotong').length,0);
});

test('a persisted PO with a lost response is safely found once after a cold retry',()=>{
  const f=fixture(),sheet=f.h.sheets.PO,range=sheet.getRange.bind(sheet);let failed=false;
  sheet.getRange=(r,c,h,w)=>{const out=range(r,c,h,w),set=out.setValues;out.setValues=rows=>{const value=set(rows);if(r>1&&!failed){failed=true;throw Error('fixture response interrupted after PO persisted');}return value;};return out;};
  f.bad('savePO',f.input(),/interrupted/);sheet.getRange=range;assert.equal(failed,true);
  f.good('savePO',f.input());assert.equal(f.raw('PO').length,1);assert.equal(f.raw('RencanaPotong').length,0);
  const writes=sheet.writes;f.good('savePO',f.input());assert.equal(sheet.writes,writes);
});

test('deferred design upload recovers after the PO persisted, binds the image intent and never rewrites a later image',()=>{
  const f=fixture(),input={...f.input(),gambarData:'data:image/png;base64,AAAA'},sheet=f.h.sheets.Gambar,range=sheet.getRange.bind(sheet);let failed=false;
  sheet.getRange=(r,c,h,w)=>{const out=range(r,c,h,w),set=out.setValues;out.setValues=rows=>{if(r>1&&!failed){failed=true;throw Error('fixture image interrupted');}return set(rows);};return out;};
  f.bad('savePO',input,/interrupted/);sheet.getRange=range;assert.equal(f.raw('PO').length,1);assert.equal(f.raw('Gambar').length,0);
  f.bad('savePO',{...input,gambarData:'data:image/png;base64,BBBB'},/berbeda/);
  f.good('savePO',input);assert.equal(f.raw('Gambar')[0].data,input.gambarData);assert.equal(f.raw('PO').length,1);
  const writes=sheet.writes+f.h.sheets.PO.writes;f.good('savePO',input);assert.equal(sheet.writes+f.h.sheets.PO.writes,writes);
  f.good('saveGambar',{id:'defer-po-001',jenis:'po',dataUrl:''});f.bad('savePO',input,/Gambar PO sudah berubah/);assert.equal(f.raw('Gambar').length,0);
});

test('invalid creation contracts fail before PO, plan or image writes',()=>{
  const cases=[{deferMaterial:undefined},{deferMaterial:'true'},{po:{newId:''}},{po:{id:'defer-po-001'}},{po:{status:'selesai'}},{po:{ukuranAktif:[]}},{po:{ukuranAktif:['BOGUS']}},{po:{ukuran:{L:10}}},{po:{total:10}},{rencana:{id:'defer-plan-001'}},{gambarData:'not an image'},{workflowVersion:1},{clientVersion:'1.0.0'}];
  for(const extra of cases){const f=fixture(),p={...f.input(),...extra,po:{...f.input().po,...extra.po}};f.bad('savePO',p);assert.equal(f.raw('PO').length,0);assert.equal(f.raw('RencanaPotong').length,0);assert.equal(f.raw('Gambar').length,0);}
});

test('a reservation-first creation in progress cannot be bypassed by switching to deferred creation',()=>{
  const f=fixture();f.h.run(`pkStore_().lock(function(){pkStore_().append('RencanaPotong',{id:'defer-pending-plan',poId:'defer-po-001',status:'siap',poDraft:{newId:'defer-po-001',noPO:'PO-PENDING'},bahanList:[{nama:'Katun',qty:2,satuan:'kg'}],alokasiBahan:[{stokId:'defer-stock-001',qty:2}],rol:1,revision:'pending-revision'});});`);
  const plans=f.raw('RencanaPotong');f.bad('savePO',f.input(),/masih menyiapkan/);assert.equal(f.raw('PO').length,0);assert.deepEqual(f.raw('RencanaPotong'),plans);
});

test('deferred zero-cut POs never finish automatically or allow bare cutting, and later prepared stock stays integrated',()=>{
  const f=fixture();f.good('savePO',f.input());
  f.h.run(`pkStore_().lock(function(){pkStore_().update('PO','defer-po-001',{tuntasPada:'2020-01-01T00:00:00Z'});});`);
  const state=f.good('getState');assert.equal(state.po[0].status,'aktif');assert.equal(state.po[0].tuntasPada,'');assert.equal(state.po[0].workflow.complete,false);
  f.bad('setStatusPO',{id:'defer-po-001',status:'selesai'},/belum|selesai|potong/);
  for(const token of [f.owner,f.admin,f.cutter])f.bad('createPotong',{potong:{id:'defer-cut-001',poId:'defer-po-001',ukuran:{L:8}}},/bahan|persiapan/,token);
  assert.equal(f.raw('Potong').length,0);
  const plan=f.good('saveRencanaPotong',{rencana:{id:'defer-plan-001',poId:'defer-po-001',alokasiBahan:[{stokId:'defer-stock-001',qty:2.5}]}});
  assert.equal(f.good('getState').stokRol[0].dicadangkan,2.5);
  const cut=f.good('createPotong',{potong:{id:'defer-cut-001',rencanaId:plan.id,expectedRencanaRevision:plan.revision,ukuran:{L:8},tanggal:'2026-10-12'}},f.cutter);
  assert.equal(cut.rencanaId,plan.id);assert.equal(cut.kg,2.5);assert.equal(f.good('getState').stokRol[0].saldo,10);assert.equal(f.good('getState').stokRol[0].dicadangkan,0);
  assert.deepEqual(f.good('getState').po[0].cutting.pendingUkuran,['XL']);assert.equal(f.raw('PO')[0].total,0);
});
