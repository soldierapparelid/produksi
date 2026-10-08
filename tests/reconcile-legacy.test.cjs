const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const code=['core.js','import-backup.js','import-legacy-v1.js','reconcile-legacy.js'].map(f=>fs.readFileSync(path.join(root,'src',f),'utf8')).join('\n');
function fixture(size='M',id='product01') {
  return {id,namaBarang:'Contoh',series:'TEST',size,poAktif:true,
    potong:[{id:'cut_'+id,tanggal:'2026-10-01',jumlah:10,tukangId:'cutworker',tarif:100}],
    assignJahit:[{id:'assign_'+id,tanggal:'2026-10-01',qty:10,tukangId:'worker01'}],
    jahit:[{id:'report_'+id,tanggal:'2026-10-02',jumlah:10,lolos:10,rijek:0,tukangId:'worker01',tarif:1000,assignmentId:'assign_'+id}],
    hitungFisik:[{id:'count_'+id,tanggal:'2026-10-03',jumlah:10,tukangId:'worker01',payroll:{workerId:'worker01',rate:1000},workflowVersion:2,countStage:'verified'}],qc:[],gudang:[]};
}
function run(items,expression,setup='') {
  const backup={produksi:{produksi:items,images:{'TEST|Contoh':'data:image/png;base64,secret-image'}},produksi_meta:{tukang:[{id:'cutworker',nama:'Pemotong',pin:'9999'}],tukangJahit:[{id:'worker01',nama:'Penjahit',pin:'1234',token:'private-token'}]},_meta:{ts:'2026-10-08T00:00:00Z'}};
  const ctx=vm.createContext({payload:JSON.stringify(backup)});
  vm.runInContext(code+'\nvar backup=JSON.parse(payload);var current=convertBackupLegacyV1(backup).rows;current.SlipUpah=[];current.SlipSetor.forEach(function(s){s.upahId="LAMA";});'+setup,ctx);
  return JSON.parse(JSON.stringify(vm.runInContext(expression,ctx)));
}
test('SHA-256 matches standard vectors and canonical key order',()=>{
  const ctx=vm.createContext({});vm.runInContext(code,ctx);
  for(const value of ['', 'abc','漢字🙂','x'.repeat(1000)]) assert.equal(ctx.coreReconcileSha256(value),crypto.createHash('sha256').update(value).digest('hex'));
  assert.equal(vm.runInContext('coreLegacyHash({b:2,a:1})===coreLegacyHash({a:1,b:2})',ctx),true);
});
test('source projector excludes credentials and unrelated data while preserving v1 replay',()=>{
  const out=run([fixture()],`({projected:coreLegacySourceInput(backup),old:convertBackupLegacyV1(backup).rows.PO,replayed:convertBackupLegacyV1(coreLegacySourceInput(backup)).rows.PO})`);
  assert.deepEqual(out.old,out.replayed);const text=JSON.stringify(out.projected);assert(!text.includes('1234'));assert(!text.includes('private-token'));assert(!text.includes('secret-image'));assert(!text.includes('9999'));
});
test('source projection retains exact batch linking and tariff history evidence',()=>{
  const p=fixture();p.hitungFisik[0].inputVia='batch-count';p.hitungFisik[0].inputBy='operator';p.qc=[{id:'legacyqc01',tanggal:'2026-10-03',ok:10,offline:0,perbaikan:0,reject:0,tukangJahit:'Penjahit',inputVia:'batch-qc',keterangan:'Batch QC'}];
  const out=run([p],`(function(){backup.produksi_meta.tukangJahit[0].tarifHistory={'TEST|Contoh':[{effectiveAt:'2026-01-01',rate:1000}]};var minimal=coreLegacySourceInput(backup);return {minimal:minimal,plan:corePlanLegacyReconciliation(minimal,current)};})()`);
  assert.equal(out.minimal.produksi.produksi[0].hitungFisik[0].inputVia,'batch-count');assert.deepEqual(out.minimal.produksi_meta.tukangJahit[0].tarifHistory,{'TEST|Contoh':[{effectiveAt:'2026-01-01',rate:1000}]});assert.equal(out.plan.summary.migratedPO,1);
});
test('preview preserves grouped PO, cut identity and immutable paid source snapshot',()=>{
  const out=run([fixture(),fixture('L','product02')],`({plan:corePlanLegacyReconciliation(backup,current),old:current})`);
  const p=out.plan;assert.equal(p.ready,true);assert.equal(p.summary.migratedPO,1);assert.deepEqual(p.rows.PO.map(p=>p.id),out.old.PO.map(p=>p.id));assert.equal(p.rows.PO[0].noPO,out.old.PO[0].noPO);assert.deepEqual(p.rows.Potong,out.old.Potong);
  assert.equal(p.rows.QC.length,0);assert.equal(p.rows.SlipSetor.length,2);assert.equal(p.rows.LegacySettlement.length,2);assert(!Object.hasOwn(p.rows,'SlipUpah'));assert(!Object.hasOwn(p.rows,'Pegawai'));
  for(const s of p.rows.LegacySettlement){assert.deepEqual(JSON.parse(s.sourceSnapshot),out.old.SlipSetor.find(r=>r.id===s.sourceId));assert.equal(s.resolution,'full');assert.equal(JSON.parse(s.baselineSources).length,1);}
});
test('replay refuses changed production or missing source rows while allowing payment markers',()=>{
  const result=run([fixture()],`corePlanLegacyReconciliation(backup,current)`,`current.SlipSetor[0].total=11;`);assert.equal(result.ready,false);assert.match(result.issues.join(' '),/tidak cocok persis/);assert.deepEqual(result.rows,{});
  const missing=run([fixture()],`corePlanLegacyReconciliation(backup,current)`,`current.Potong=[];`);assert.equal(missing.ready,false);
});
test('before fingerprint includes payment state and preview never mutates SlipUpah',()=>{
  const out=run([fixture()],`(function(){var original=JSON.stringify(current.SlipUpah),a=corePlanLegacyReconciliation(backup,current);current.SlipUpah[0].jumlah=999;var b=corePlanLegacyReconciliation(backup,current);return {a:a.beforeHash,b:b.beforeHash,original:original,afterFirst:original,paymentRef:a.rows.LegacySettlement[0].paymentRef,hasPaymentTable:Object.hasOwnProperty.call(a.rows,'SlipUpah')};})()`,`current.SlipSetor[0].upahId='receipt01';current.SlipUpah=[{id:'receipt01',jenis:'jahit',itemIds:JSON.stringify([current.SlipSetor[0].id]),jumlah:10000}];`);
  assert.notEqual(out.a,out.b);assert.equal(out.paymentRef,'receipt01');assert.equal(out.hasPaymentTable,false);
});
test('unresolved active source retains all original business rows and explicit review hold',()=>{
  const p=fixture();p.hitungFisik[0].jumlah=11;
  const out=run([p],`({plan:corePlanLegacyReconciliation(backup,current),old:current})`);assert.equal(out.plan.summary.heldPO,1);assert.match(out.plan.rows.PO[0].imporReview,/Hitungan/);for(const t of ['Potong','SlipKirim','SlipSetor','QC','Gudang'])assert.deepEqual(out.plan.rows[t],out.old[t]);assert.equal(out.plan.rows.LegacySettlement.length,0);
});
test('archived cycles are preserved read-only rather than merged or rewritten',()=>{
  const p=fixture();p.poAktif=false;
  const out=run([p],`({plan:corePlanLegacyReconciliation(backup,current),old:current})`);assert.equal(out.plan.summary.archivedPO,1);assert.equal(out.plan.rows.PO[0].status,'selesai');assert.match(out.plan.rows.PO[0].imporReview,/Arsip lama/);assert.deepEqual(out.plan.rows.SlipSetor,out.old.SlipSetor);
});
test('multiple report settlement holds use a frozen baseline allowlist',()=>{
  const p=fixture();p.jahit[0].jumlah=p.jahit[0].lolos=6;p.jahit.push({...p.jahit[0],id:'report02',jumlah:4,lolos:4});
  const out=run([p],`corePlanLegacyReconciliation(backup,current)`);assert.equal(out.rows.LegacySettlement.length,2);assert.equal(out.summary.settlementHolds,2);for(const s of out.rows.LegacySettlement){assert.equal(s.resolution,'hold');assert.deepEqual(JSON.parse(s.allocations),[]);assert.equal(JSON.parse(s.baselineSources).length,1);}
});
test('plan is deterministic and reapplying the same source preserves its rows',()=>{
  const out=run([fixture()],`(function(){var a=corePlanLegacyReconciliation(backup,current),b=corePlanLegacyReconciliation(backup,current);var applied=Object.assign({},current,a.rows);var c=corePlanLegacyReconciliation(backup,applied);return {a:a,b:b,c:c};})()`);assert.equal(out.a.planHash,out.b.planHash);assert.equal(out.c.alreadyApplied,true);assert.deepEqual(out.a.rows,out.c.rows);assert.equal(out.c.batchId,out.a.batchId);
});
test('payment credit for the baseline does not settle a future count',()=>{
  const out=run([fixture()],`(function(){var p=corePlanLegacyReconciliation(backup,current);var old=p.rows.SlipSetor[0],fresh=Object.assign({},old,{id:'future-count',imporSumber:'',upahId:''});return corePayroll([],p.rows.SlipSetor.concat([fresh]),p.rows.QC,[],{gudangLama:p.rows.GudangLama,settlements:p.rows.LegacySettlement});})()`);const baseline=out.find(r=>r.sourceId!=='future-count'),future=out.find(r=>r.sourceId==='future-count');assert.equal(baseline.available,0);assert.equal(future.available,10);
});
test('accepting a pending remainder cannot repay its already-paid legacy report',()=>{
  const p=fixture();p.hitungFisik[0].jumlah=6;
  const out=run([p],`(function(){var p=corePlanLegacyReconciliation(backup,current),pending=p.rows.SlipSetor.filter(function(s){return s.status==='diajukan';})[0];var before=JSON.parse(p.rows.LegacySettlement[0].baselineSources);pending.status='diterima';pending.upah=1000;var future=Object.assign({},pending,{id:'genuinely-new-report',imporSumber:''});var pay=corePayroll([],p.rows.SlipSetor.concat([future]),p.rows.QC,[],{gudangLama:p.rows.GudangLama,settlements:p.rows.LegacySettlement});return {pendingId:pending.id,before:before,pay:pay};})()`);
  assert(out.before.some(s=>s.sourceId===out.pendingId&&s.pending));assert.equal(out.pay.find(p=>p.sourceId===out.pendingId).available,0);assert.equal(out.pay.find(p=>p.sourceId==='genuinely-new-report').available,4);
});
test('source rows without IDs retain deterministic ordinal proof and actual credit',()=>{
  const p=fixture();delete p.jahit[0].id;
  const out=run([p],`(function(){var p=corePlanLegacyReconciliation(backup,current);return {p:p,pay:corePayroll([],p.rows.SlipSetor,p.rows.QC,[],{settlements:p.rows.LegacySettlement})};})()`);const s=out.p.rows.LegacySettlement[0];assert.equal(JSON.parse(s.imporSumber).entryId,'index:0');assert.equal(s.resolution,'full');assert.equal(out.pay[0].paidQty,10);assert.equal(out.pay[0].legacySettlementHold,undefined);
});
test('legacy inspection advance remains credit for later repair of the same inspection',()=>{
  const p=fixture();p.qc=[{id:'legacyqc01',hfId:'count_product01',tanggal:'2026-10-04',ok:6,offline:0,perbaikan:4,reject:0,tukangId:'worker01'}];
  const out=run([p],`(function(){var p=corePlanLegacyReconciliation(backup,current),q=p.rows.QC[0],repair=Object.assign({},q,{id:'repair-later',tanggal:'2026-10-05',ukuran:{M:4},total:4,perbaikan:-4,perbaikanUkuran:{M:-4},repairQcId:q.id});return {p:p,pay:corePayroll([],p.rows.SlipSetor,p.rows.QC.concat([repair]),[],{settlements:p.rows.LegacySettlement})};})()`);
  assert.equal(out.p.ready,true);assert.equal(out.p.rows.LegacySettlement[0].resolution,'full');assert.equal(JSON.parse(out.p.rows.LegacySettlement[0].baselineSources)[0].qty,10);assert.equal(out.pay.find(p=>p.qcId==='repair-later').available,0);
});
test('recovered completed repair keeps a separate ID and remaps only its base inspection',()=>{
  const p=fixture();p.qc=[{id:'legacyqc01',hfId:'count_product01',tanggal:'2026-10-04',ok:10,offline:0,perbaikan:0,reject:0,tukangId:'worker01'}];p.gudang=[{id:'repair-evidence',qcId:'legacyqc01',tanggal:'2026-10-05',jumlah:4,status:'ok',payrollStage:'repair'}];
  const out=run([p],`corePlanLegacyReconciliation(backup,current)`);assert.equal(out.ready,true);assert.equal(out.rows.QC.length,2);assert.equal(new Set(out.rows.QC.map(q=>q.id)).size,2);const base=out.rows.QC.find(q=>!q.repairQcId),repair=out.rows.QC.find(q=>q.repairQcId);assert.equal(base.id,'legacyqc01');assert.equal(repair.repairQcId,base.id);
});
