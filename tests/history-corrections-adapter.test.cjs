'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
const root=path.resolve(__dirname,'..');
const correctionCode=['reconcile-legacy.js','history-corrections.js'].map(f=>fs.readFileSync(path.join(root,'src',f),'utf8')).join('\n');
function financialRows(rows) { return JSON.stringify(rows.map(({issues,...amounts})=>amounts)); }

function fixture() {
  const h=harness({Potong:[['total','custom column','id','ukuran']],SlipUpah:[['itemIds','id','custom column']],KoreksiRiwayat:[['reason','id','custom column','after']]});
  vm.runInContext(correctionCode,h.context);
  const setup=h.request('setupOwner',{nama:'Pemilik Contoh',pin:'1234'});assert.equal(setup.ok,true,setup.error);
  const token=setup.data.token;
  h.run(`pkStore_().lock(function(){
    pkStore_().append('Pegawai',{id:'admin01',nama:'Admin Contoh',divisi:'admin',aktif:true,token:'admin_fixture_token_1234'});
    pkStore_().append('Pegawai',{id:'worker01',nama:'Penjahit Contoh',divisi:'jahit',aktif:true});
    pkStore_().append('Pegawai',{id:'cutter01',nama:'Pemotong Contoh',divisi:'potong',aktif:true});
    pkStore_().append('PO',{id:'review01',noPO:'PO-TEST-001',nama:'Produk Contoh',status:'aktif',ukuran:JSON.stringify({XXL:144}),total:144,asal:'lama',imporReview:'Jumlah sumber lama perlu diperiksa.',imporSumber:JSON.stringify({legacyReconciliation:{mode:'review',version:1}})});
    pkStore_().append('Potong',{id:'old_cut01',poId:'review01',userId:'cutter01',tanggal:'2026-10-01',ukuran:JSON.stringify({XXL:114}),total:114,tarif:100,upahId:'paid_cut01',catatan:'Catatan asli 🧵',asal:'lama'});
    pkStore_().append('SlipKirim',{id:'old_assign01',poId:'review01',maklonId:'worker01',tanggal:'2026-10-02',ukuran:JSON.stringify({XXL:144}),total:144,upah:1000,asal:'lama'});
    pkStore_().append('SlipUpah',{id:'paid_cut01',noSlip:'UP-TEST-001',pegawaiId:'cutter01',jenis:'potong',tanggal:'2026-10-02',itemIds:JSON.stringify(['old_cut01']),totalQty:114,totalUpah:11400,potongan:0,dibayar:11400,catatan:'Bukti tetap utuh',items:''});
  });`);
  h.sheets.KoreksiRiwayat.maxRows=2;
  function call(action,payload={}) {h.cold();return h.request(action,{workflowVersion:2,token,...payload});}
  function good(action,payload={}) {const result=call(action,payload);assert.equal(result.ok,true,result.error);return result.data?.data??result.data;}
  const target={poId:'review01',sheet:'Potong',rowId:'old_cut01'};
  function payload(preview,id,qty,reason) {return {...target,id,expectedSourceHash:preview.sourceHash,expectedLastCorrectionId:preview.lastCorrectionId,ukuran:{XXL:qty},reason};}
  return {h,call,good,target,payload};
}

test('real Sheets adapter preserves paid rows while physical corrections survive fresh requests and reversal',()=>{
  const {h,call,good,target,payload}=fixture();
  const originals={cut:JSON.stringify(h.sheets.Potong.values),payment:JSON.stringify(h.sheets.SlipUpah.values),cutWrites:h.sheets.Potong.writes,paymentWrites:h.sheets.SlipUpah.writes,headers:h.sheets.KoreksiRiwayat.values[0].slice()};
  const beforeState=good('getState'),payrollBefore=financialRows(beforeState.payroll);
  const preview=good('getHistoryCorrection',target);
  assert.equal(preview.original.total,114);assert.equal(preview.effective.total,114);assert.equal(preview.history.length,0);
  assert.equal(beforeState.po[0].workflow.ukuran.XXL.potong,114);

  const firstPayload=payload(preview,'correction_first',144,'Contoh verifikasi jumlah fisik');
  const first=good('saveHistoryCorrection',firstPayload);
  assert.equal(first.effective.total,144);assert.equal(first.history.length,1);assert.equal(first.reviewRemains,true);assert.equal(first.payrollUnchanged,true);
  const afterFirst=good('getState');
  assert.equal(afterFirst.potong[0].total,144,'display uses the physical overlay');
  assert.deepEqual(afterFirst.potong[0].ukuran,{XXL:144});
  assert.equal(afterFirst.po[0].workflow.ukuran.XXL.potong,144,'workflow uses the same physical overlay');
  assert.equal(financialRows(afterFirst.payroll),payrollBefore,'paid quantity and payable balance use the immutable original');
  assert.ok(afterFirst.po[0].imporReview);assert.equal(afterFirst.po[0].workflow.complete,false);
  assert.ok(afterFirst.po[0].workflow.issues.includes('Jumlah sumber lama perlu diperiksa.'));
  assert.equal(good('saveHistoryCorrection',firstPayload).replayed,true,'retry does not append another entry');
  const stale=call('saveHistoryCorrection',payload(preview,'stale_correction',120,'Contoh formulir lama'));
  assert.equal(stale.ok,false);assert.match(stale.error,/berubah sejak formulir/);

  const current=good('getHistoryCorrection',target);
  const second=good('saveHistoryCorrection',payload(current,'correction_second',114,'Kembalikan jumlah pengujian'));
  assert.equal(second.effective.total,114);assert.equal(second.history.length,2);assert.equal(second.original.total,114);
  const final=good('getState');
  assert.equal(final.potong[0].total,114);assert.equal(final.po[0].workflow.ukuran.XXL.potong,114);
  assert.equal(financialRows(final.payroll),payrollBefore);assert.ok(final.po[0].imporReview);assert.equal(final.po[0].workflow.complete,false);
  assert.equal(JSON.stringify(h.sheets.Potong.values),originals.cut);assert.equal(JSON.stringify(h.sheets.SlipUpah.values),originals.payment);
  assert.equal(h.sheets.Potong.writes,originals.cutWrites);assert.equal(h.sheets.SlipUpah.writes,originals.paymentWrites);
  assert.deepEqual(h.sheets.KoreksiRiwayat.values[0],originals.headers);
  assert.ok(h.sheets.KoreksiRiwayat.maxRows>=3,'adapter expands ledger capacity');
  h.cold();const ledger=h.run('pkStore_().read("KoreksiRiwayat")');assert.equal(ledger.length,2);
  assert.deepEqual(JSON.parse(ledger[0].before),{ukuran:{XXL:114},total:114});assert.deepEqual(JSON.parse(ledger[0].after),{ukuran:{XXL:144},total:144});
  assert.deepEqual(JSON.parse(ledger[1].before),{ukuran:{XXL:144},total:144});assert.deepEqual(JSON.parse(ledger[1].after),{ukuran:{XXL:114},total:114});
  assert.equal(ledger[1].previousCorrectionId,ledger[0].id);
  assert.ok(ledger.every(r=>JSON.parse(r.sourceSnapshot).total===114&&JSON.parse(r.sourceSnapshot).upahId==='paid_cut01'));
  assert.equal(h.isLocked(),false);
});

test('actual API rejects admin/non-owner and old workflow before any physical correction is appended',()=>{
  const {h,call,good,target,payload}=fixture();
  const preview=good('getHistoryCorrection',target),proposal=payload(preview,'blocked_correction',144,'Contoh verifikasi');
  const physicalBefore=JSON.stringify(h.sheets.Potong.values),paymentBefore=JSON.stringify(h.sheets.SlipUpah.values);
  const ledgerWrites=h.sheets.KoreksiRiwayat.writes;
  const old=call('saveHistoryCorrection',{...proposal,workflowVersion:1});assert.equal(old.ok,false);assert.match(old.error,/Versi alur produksi/);
  const missing=call('saveHistoryCorrection',{...proposal,workflowVersion:undefined});assert.equal(missing.ok,false);assert.match(missing.error,/Versi alur produksi/);
  for (const action of ['getHistoryCorrection','saveHistoryCorrection']) {
    const denied=call(action,{...proposal,token:'admin_fixture_token_1234'});assert.equal(denied.ok,false);assert.match(denied.error,/Hanya owner/);
    const anonymous=call(action,{...proposal,token:''});assert.equal(anonymous.ok,false);assert.match(anonymous.error,/login/);
  }
  h.cold();assert.equal(h.run('pkStore_().read("KoreksiRiwayat").length'),0);
  assert.equal(h.sheets.KoreksiRiwayat.writes,ledgerWrites);assert.equal(JSON.stringify(h.sheets.Potong.values),physicalBefore);assert.equal(JSON.stringify(h.sheets.SlipUpah.values),paymentBefore);
  assert.equal(h.isLocked(),false);
});
