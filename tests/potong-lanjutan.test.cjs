'use strict';
/* 1.5.41: hasil potong disimpan per ukuran. Potongan pertama memakai persiapan owner dan membawa bahannya;
   ukuran berikutnya dicatat sebagai lanjutan tanpa bahan. Semua data di sini buatan. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
function fixture(){
  const h=harness();
  for(const name of ['cutting-plans','reconcile-legacy','history-corrections','auto-completion'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name+'.js'),'utf8'),h.context);
  const setup=h.request('setupOwner',{nama:'Owner fixture',pin:'1234'});assert.equal(setup.ok,true,setup.error);const token=setup.data.token,cutter='lanjut-cutter-token-123456',cutter2='lanjut-cutter-token-654321';
  h.run(`pkStore_().lock(function(){pkStore_().append('Pegawai',{id:'cutter001',nama:'Cutter',divisi:'potong',aktif:true,token:'${cutter}'});pkStore_().append('Pegawai',{id:'cutter002',nama:'Cutter dua',divisi:'potong',aktif:true,token:'${cutter2}'});pkStore_().append('StokBahan',{id:'lanjut-stock-001',jenis:'beli',bahan:'Katun',qty:25,satuan:'kg',rol:1,stockMode:'roll',rollLabel:'A-1'});});`);
  const call=(action,p={},tk=token)=>{h.cold();return h.request(action,{token:tk,workflowVersion:2,...p});};
  const good=(action,p={},tk=token)=>{const r=call(action,p,tk);assert.equal(r.ok,true,r.error);return r.data?.data??r.data;};
  const raw=name=>{h.cold();return h.run(`pkStore_().fresh('${name}');pkStore_().read('${name}')`);};
  const bundle=()=>({po:{newId:'lanjut-po-001',nama:'Potong lanjutan',jenis:'stok',ukuran:{},ukuranAktif:['M','L','XL']},rencana:{id:'lanjut-plan-001',alokasiBahan:[{stokId:'lanjut-stock-001',qty:4}]}});
  const cut=(plan,sizes,id,tk=cutter)=>good('createPotong',{potong:{id,rencanaId:plan.id,expectedRencanaRevision:plan.revision,tanggal:'2026-10-08',ukuran:sizes}},tk);
  const next=(body,tk=cutter)=>call('createPotong',{potong:{poId:'lanjut-po-001',lanjut:true,...body}},tk);
  return {h,token,cutter,cutter2,call,good,raw,bundle,cut,next};
}
test('one size is saved first; the other sizes follow later without a new preparation and the fabric is counted once',()=>{
  const f=fixture(),plan=f.good('savePOWithRencana',f.bundle()).rencana;
  assert.equal(f.good('getState',{},f.cutter).po[0].cutting.lanjut,undefined,'nothing to continue before the first cut');
  const early=f.next({id:'lanjut-early01',ukuran:{M:5}});assert.equal(early.ok,false);assert.match(early.error,/tidak bisa dilanjutkan/);
  f.cut(plan,{M:7},'lanjut-cut-001');
  const seen=f.good('getState',{},f.cutter2),po=seen.po[0];
  assert.deepEqual(po.cutting.pendingUkuran,['L','XL']);assert.equal(po.cutting.lanjut,plan.id);
  assert.deepEqual(seen.rencanaPotong.map(r=>[r.id,r.status]),[[plan.id,'terpakai']],'another cutter still sees which rolls were taken');
  /* the preparation itself is still used once */
  const twice=f.call('createPotong',{potong:{id:'lanjut-twice01',rencanaId:plan.id,expectedRencanaRevision:plan.revision,ukuran:{L:3}}},f.cutter);assert.equal(twice.ok,false);assert.match(twice.error,/sudah dipakai/);
  for(const [body,pattern] of [[{ukuran:{M:2}},/Ukuran M sudah dicatat dipotong/],[{ukuran:{L:2},bahanList:[{nama:'Katun',qty:1}]},/tidak membawa bahan/],[{ukuran:{L:2},rol:1},/tidak membawa bahan/],[{ukuran:{XXL:2}},/tidak terdaftar/],[{ukuran:{L:2},rencanaId:plan.id},/tidak memakai persiapan/],[{ukuran:{L:2},rencana:{id:'lanjut-plan-009',alokasiBahan:[{stokId:'lanjut-stock-001',qty:1}]}},/tidak memakai persiapan/]]){
    const r=f.next({id:'lanjut-bad-001',...body});assert.equal(r.ok,false,JSON.stringify(body));assert.match(r.error,pattern);
  }
  assert.equal(f.raw('Potong').length,1);
  const saved=f.next({id:'lanjut-cut-002',tanggal:'2026-10-09',ukuran:{L:5}},f.cutter2);assert.equal(saved.ok,true,saved.error);
  const rows=f.raw('Potong');assert.equal(rows.length,2);const row=rows[1];
  assert.deepEqual([row.rencanaId||'',row.asal,row.bahan||'',Number(row.kg)||0,Number(row.rol)||0,row.bahanList||'',row.alokasiBahan||'',row.userId,String(row.tanggal),Number(row.total),JSON.parse(row.ukuran)],['','lanjut','',0,0,'','','cutter002','2026-10-09',5,{L:5}]);
  assert.equal(Number(row.tarif),Number(rows[0].tarif),'the same wage rate as the first cut');assert.ok(!row.upahId);
  /* a resend returns the same record */
  assert.equal(f.next({id:'lanjut-cut-002',tanggal:'2026-10-09',ukuran:{L:5}},f.cutter2).ok,true);assert.equal(f.raw('Potong').length,2);
  const owner=f.good('getState');
  assert.equal(owner.stokRol[0].pakai,4,'the roll is used once');assert.equal(owner.stokRol[0].saldo,21);
  assert.deepEqual(owner.po[0].cutting.pendingUkuran,['XL']);assert.equal(owner.po[0].cutting.lanjut,plan.id);
  assert.equal(owner.po[0].agg.total.potong,12);
  /* the last size closes it */
  assert.equal(f.next({id:'lanjut-cut-003',ukuran:{XL:6}}).ok,true);
  const done=f.good('getState').po[0];assert.deepEqual(done.cutting.pendingUkuran,[]);assert.equal(done.cutting.lanjut,undefined);
  const over=f.next({id:'lanjut-cut-004',ukuran:{XL:1}});assert.equal(over.ok,false);assert.match(over.error,/tidak bisa dilanjutkan/);
  assert.equal(f.raw('Potong').length,3);
});
test('a new preparation takes over from continuing; a continuing cut can be deleted, the first cut cannot; the owner can record for a cutter',()=>{
  const f=fixture(),plan=f.good('savePOWithRencana',f.bundle()).rencana;
  f.cut(plan,{M:7},'lanjut-cut-001');assert.equal(f.next({id:'lanjut-cut-002',ukuran:{L:5}}).ok,true);
  assert.equal(f.call('deleteRecord',{sheet:'Potong',id:'lanjut-cut-001'}).ok,false,'the cut that carries the fabric stays');
  const hapus=f.call('deleteRecord',{sheet:'Potong',id:'lanjut-cut-002'});assert.equal(hapus.ok,true,hapus.error);
  assert.deepEqual(f.good('getState').po[0].cutting.pendingUkuran,['L','XL'],'its size is open again');
  const baru=f.good('saveRencanaPotong',{rencana:{id:'lanjut-plan-002',poId:'lanjut-po-001',alokasiBahan:[{stokId:'lanjut-stock-001',qty:3}]}});
  assert.equal(f.good('getState').po[0].cutting.lanjut,undefined,'new fabric is waiting: the cutter uses that preparation');
  const off=f.next({id:'lanjut-cut-005',ukuran:{L:5}});assert.equal(off.ok,false);assert.match(off.error,/tidak bisa dilanjutkan/);
  f.cut(baru,{L:5},'lanjut-cut-006');
  const state=f.good('getState');assert.equal(state.po[0].cutting.lanjut,'lanjut-plan-002');assert.equal(state.stokRol[0].pakai,7);
  const forCutter=f.call('createPotong',{potong:{id:'lanjut-cut-007',poId:'lanjut-po-001',lanjut:true,userId:'cutter002',tarif:900,ukuran:{XL:4}}});assert.equal(forCutter.ok,true,forCutter.error);
  const last=f.raw('Potong').filter(r=>r.id==='lanjut-cut-007')[0];assert.deepEqual([last.userId,Number(last.tarif),last.asal],['cutter002',900,'lanjut']);
  assert.equal(f.good('getState').stokRol[0].pakai,7);
});
