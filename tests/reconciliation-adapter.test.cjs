'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
const root=path.resolve(__dirname,'..');
const migrationCode=['import-backup.js','import-legacy-v1.js','reconcile-legacy.js','migration-actions.js','cutting-plans.js'].map(f=>fs.readFileSync(path.join(root,'src',f),'utf8')).join('\n');
function sku(id,size,name='Kaos Contoh',active=true) {
  return {id,namaBarang:name,series:'TEST',size,poAktif:active,
    potong:[{id:'cut_'+id,tanggal:'2026-10-01',jumlah:10,tukangId:'cutter01',tarif:100}],
    assignJahit:[{id:'assign_'+id,tanggal:'2026-10-01',qty:10,tukangId:'worker01'}],
    jahit:[{id:'report_'+id,tanggal:'2026-10-02',jumlah:10,lolos:10,rijek:0,tukangId:'worker01',tarif:1000,assignmentId:'assign_'+id}],
    hitungFisik:[{id:'count_'+id,tanggal:'2026-10-03',jumlah:10,tukangId:'worker01',payroll:{workerId:'worker01',rate:1000},workflowVersion:2,countStage:'verified'}],
    qc:[],gudang:[]};
}
function fixture() {
  const h=harness({PO:[['catatan','empty custom','id','nama']],SlipSetor:[['total','id','empty custom','ukuran']],SlipUpah:[['totalUpah','id','itemIds','empty custom']],LegacySettlement:[['empty custom','id']]});
  vm.runInContext(migrationCode,h.context);
  const setup=h.request('setupOwner',{nama:'Pemilik Contoh',pin:'1234'});assert.equal(setup.ok,true,setup.error);
  const token=setup.data.token;
  const held=sku('source004','M','Perlu Tinjau');held.hitungFisik[0].jumlah=11;
  const backup={produksi:{produksi:[sku('source001','M'),sku('source002','L'),sku('source003','XL'),held,sku('source005','M','Arsip Contoh',false)]},produksi_meta:{tukang:[{id:'cutter01',nama:'Pemotong Contoh'}],tukangJahit:[{id:'worker01',nama:'Penjahit Contoh'}]},_meta:{ts:'2026-10-08T00:00:00Z'}};
  h.run(`var backup=JSON.parse(${JSON.stringify(JSON.stringify(backup))});
    var original=convertBackupLegacyV1(backup).rows;
    var paidIds=original.SlipSetor.filter(function(s){return /report_source00[123]$/.test(s.id);}).map(function(s){return s.id;});
    original.SlipSetor.forEach(function(s){s.upahId=paidIds.indexOf(s.id)>=0?'receipt01':'LAMA';});
    original.Potong.forEach(function(p){p.upahId='LAMA';});
    pkStore_().lock(function(){
      ['PO','Potong','SlipKirim','SlipSetor','QC','Gudang','Produk'].forEach(function(t){pkStore_().replaceAll(t,original[t]);});
      original.Pegawai.forEach(function(p){pkStore_().append('Pegawai',p);});
      pkStore_().append('SlipUpah',{id:'receipt01',noSlip:'UP-TEST-001',pegawaiId:'worker01',jenis:'jahit',tanggal:'2026-10-04',itemIds:JSON.stringify(paidIds),totalQty:30,totalUpah:30000,potongan:0,dibayar:30000,catatan:'Contoh 🧵',items:''});
    });`);
  h.sheets.LegacySettlement.maxRows=2;
  h.cold();
  function call(action,payload={}) {h.cold();return h.request(action,{workflowVersion:2,token,...payload});}
  function good(action,payload={}) {const result=call(action,payload);assert.equal(result.ok,true,result.error);return result.data?.data??result.data;}
  return {h,backup,call,good};
}

test('actual Sheets adapter reconciles, recovers an interrupted apply, and survives fresh requests without changing payment evidence',()=>{
  const {h,backup,call,good}=fixture();
  const paymentBytes=JSON.stringify(h.sheets.SlipUpah.values),paymentWrites=h.sheets.SlipUpah.writes;
  const oldProduction=h.run(`JSON.stringify(['PO','Potong','SlipKirim','SlipSetor','QC','Gudang'].reduce(function(o,t){o[t]=pkStore_().read(t);return o;},{}))`);
  const originalHeaders={po:h.sheets.PO.values[0].slice(),setor:h.sheets.SlipSetor.values[0].slice(),settlement:h.sheets.LegacySettlement.values[0].slice()};
  const preview=good('previewLegacyMigration',{backup});
  assert.deepEqual(preview.summary,{activePO:2,migratedPO:1,heldPO:1,archivedPO:1,settlements:3,settlementHolds:0});

  // Fail a physical Sheets write after the durable journal/marker and earlier
  // replacement tables have been written. Do not mock the store or planner.
  const target=h.sheets.SlipSetor,realGetRange=target.getRange.bind(target);let fail=true;
  target.getRange=function(...args){const range=realGetRange(...args),set=range.setValues.bind(range);range.setValues=function(values){if(fail&&args[0]>1){fail=false;throw Error('Simulated Sheets write failure');}return set(values);};return range;};
  const broken=call('applyLegacyMigration',{backup,beforeHash:preview.beforeHash,planHash:preview.planHash});
  assert.equal(broken.ok,false);assert.match(broken.error,/Simulated Sheets write failure/);assert.equal(h.isLocked(),false);
  target.getRange=realGetRange;
  h.cold();
  assert.equal(h.run('pkStore_().getSettings().legacyMigrationStatus.batchId'),preview.batchId);
  assert.equal(JSON.stringify(h.sheets.SlipUpah.values),paymentBytes);
  const blocked=call('savePO',{po:{newId:'must_not_write',nama:'Tidak boleh'}});assert.equal(blocked.ok,false);assert.match(blocked.error,/belum selesai/);
  const recovery=good('recoverLegacyMigration',{batchId:preview.batchId});assert.equal(recovery.dipulihkan,true);
  h.cold();
  assert.equal(h.run('pkStore_().getSettings().legacyMigrationStatus'),false,'false survives JSON cell decoding; string "null" must never leave all writes blocked');
  assert.equal(h.run(`JSON.stringify(['PO','Potong','SlipKirim','SlipSetor','QC','Gudang'].reduce(function(o,t){o[t]=pkStore_().read(t);return o;},{}))`),oldProduction);

  const retry=good('previewLegacyMigration',{backup});assert.equal(retry.ready,true);
  const applied=good('applyLegacyMigration',{backup,beforeHash:retry.beforeHash,planHash:retry.planHash});assert.equal(applied.selesai,true);
  h.cold();
  assert.equal(h.run('pkStore_().getSettings().legacyMigrationStatus'),false);
  assert.equal(JSON.stringify(h.sheets.SlipUpah.values),paymentBytes);assert.equal(h.sheets.SlipUpah.writes,paymentWrites);
  assert.deepEqual(h.sheets.PO.values[0],originalHeaders.po);assert.deepEqual(h.sheets.SlipSetor.values[0],originalHeaders.setor);assert.deepEqual(h.sheets.LegacySettlement.values[0],originalHeaders.settlement);
  assert.ok(h.sheets.LegacySettlement.maxRows>=4,'adapter grows physical sheet capacity for all settlements');
  assert.equal(h.run('pkStore_().read("LegacySettlement").length'),3);
  assert.equal(h.run(`(function(){var receipt=pkStore_().read('SlipUpah')[0],settlements=pkStore_().read('LegacySettlement'),items=coreLegacySlipItems(receipt,settlements);return items.length===3&&items.every(function(s){var old=original.SlipSetor.filter(function(r){return r.id===s.id;})[0];return old&&s.total===old.total&&s.upah===old.upah&&s.tanggal===old.tanggal&&s.poId===old.poId;});})()`),true);
  const state=good('getState');
  assert.equal(state.payroll.filter(p=>p.jenis==='jahit').every(p=>p.available===0),true);
  assert.equal(h.run(`pkStore_().read('MigrasiJournal').filter(function(r){return r.sheet==='_manifest';})[0].status`),'complete');
  assert.equal(good('applyLegacyMigration',{backup}).alreadyApplied,true,'repeat apply from a fresh request is idempotent');
  assert.equal(good('recoverLegacyMigration',{batchId:retry.batchId}).dipulihkan,false);
  good('saveStok',{stok:{baru:true,jenis:'beli',bahan:'Fixture cloth',qty:5,satuan:'kg',rol:1,harga:1000}});
  good('savePOWithRencana',{po:{newId:'ordinary_after',nama:'Pekerjaan Baru',ukuran:{},ukuranAktif:['M']},rencana:{id:'fixture-plan',bahanList:[{nama:'Fixture cloth',qty:1,satuan:'kg'}],rol:1}});
  assert.ok(good('getState').po.some(p=>p.id==='ordinary_after'),'ordinary production writes reopen after the durable marker is cleared');
});
