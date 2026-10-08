const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const modules=['core','import-backup','import-legacy-v1','reconcile-legacy','history-corrections','cutting-plans','legacy-cutting'];
const code=modules.map(f=>fs.readFileSync(path.join(__dirname,'../src',f+'.js'),'utf8')).join('\n');
function run(body,setup=''){
  const c=vm.createContext({});vm.runInContext(code+`
var original={produksi:{produksi:[{id:'source_M',series:'TEST',namaBarang:'Contoh',size:'M',poAktif:true,potong:[{id:'oldcut001',tanggal:'2026-10-01',jumlah:10,kiloan:2,jenisBahan:'Kain A',bahanList:[{jenis:'Kain A',kg:2}],rols:[{purchaseId:'receipt01',kg:2}],tukangId:'cutter01',tarif:100,dibayar:true}]},{id:'source_L',series:'TEST',namaBarang:'Contoh',size:'L',poAktif:true}],cuttingPlans:{}},stokBahan:{pembelian:[{id:'receipt01',tanggal:'2026-09-01',jenisBahan:'Kain A',kg:10,invoice:'INV1'},{id:'receipt02',tanggal:'2026-09-02',jenisBahan:'Kain A',kg:10,invoice:'INV2'}],settings:{resetDate:'2026-09-01'}},produksi_meta:{tukang:[{id:'cutter01',nama:'Pekerja',pin:'PRIVATE-PIN',token:'PRIVATE-TOKEN'}]},produksi_deleted_ids:[]};
function makePlan(id,refs,qty,purchase){return{id:id,status:'ready',stockBaseline:'2026-09-01',createdAt:'2026-10-02T00:00:00Z',products:refs.map(function(p){return{id:p.id,cycle:coreLegacyCuttingCanonical([p.id,'',[]])};}),rolls:[{purchaseId:purchase||'receipt01',jenis:'Kain A',unit:'kg',kg:qty,rolNum:'1'}]};}
original.produksi.cuttingPlans.p1=makePlan('sourceplan1',[original.produksi.produksi[1]],3);
var current=convertBackupLegacyV1(original,{stamp:'2026-10-08'}).rows;
current.PO.forEach(function(po){po.imporSumber=JSON.stringify({legacyReconciliation:{version:1,sourceHash:coreLegacyHash(coreLegacySourceInput(original)),batchId:'lr1_test',mode:'active'}});});
current.Pengaturan=[{key:'stokMulai',value:JSON.stringify('2026-09-01')}];current.RencanaPotong=[];current.KoreksiRiwayat=[];current.LegacySettlement=[{id:'settlement1',sourceSnapshot:'unchanged'}];current.SlipUpah=[{id:'receipt_upah',items:'unchanged',totalUpah:1000}];
var latest={produksi:JSON.parse(JSON.stringify(original.produksi)),soldier_deletedIds:[]};
function refreshProof(){current.PO.forEach(function(po){var p=coreMap(po.imporSumber);p.legacyReconciliation.sourceHash=coreLegacyHash(coreLegacySourceInput(original));po.imporSumber=JSON.stringify(p);});latest.produksi=JSON.parse(JSON.stringify(original.produksi));}
`+setup,c);return JSON.parse(JSON.stringify(vm.runInContext(body,c)));
}
test('additive preview restores pending size and exact ready reservation without rewriting protected data',()=>{
  const x=run(`(function(){var before=JSON.stringify(current),p=corePlanLegacyCutting(latest,current,original);return{p:p,unchanged:before===JSON.stringify(current),proof:coreLegacyCuttingEvidence(p.rows.PO[0]),projection:coreCuttingProjection(p.rows.PO,current.Potong),raw:current};})()`);
  assert.equal(x.p.ready,true);assert.deepEqual(Object.keys(x.p.rows).sort(),['PO','RencanaPotong']);assert.equal(x.p.summary.plansAdded,1);assert.equal(x.p.summary.pendingSizes,1);assert.equal(x.unchanged,true);assert.equal(x.proof.valid,true);assert.deepEqual(Object.values(x.projection)[0].pendingUkuran,['L']);
  const plan=x.p.rows.RencanaPotong[0];assert.deepEqual(JSON.parse(plan.bahanList),[{nama:'Kain A',qty:3,satuan:'kg'}]);assert.equal(plan.alokasiBahan,'');assert.equal(plan.rol,1);assert.equal(x.p.rows.PO[0].total,x.raw.PO[0].total);assert.deepEqual(x.p.rows.PO[0].ukuran,x.raw.PO[0].ukuran);
  assert.equal(Object.hasOwn(x.p.rows,'Potong'),false);assert.equal(Object.hasOwn(x.p.rows,'SlipUpah'),false);assert.equal(Object.hasOwn(x.p.rows,'LegacySettlement'),false);
});
test('replay preserves consumed or owner-cancelled migrated plan and does not reserve twice',()=>{
  const x=run(`(function(){var a=corePlanLegacyCutting(latest,current,original);Object.assign(current,a.rows);var b=corePlanLegacyCutting(latest,current,original);current.RencanaPotong[0].status='batal';var c=corePlanLegacyCutting(latest,current,original);return{a:a,b:b,c:c};})()`);
  assert.equal(x.b.summary.plansAdded,0);assert.equal(x.b.summary.plansExisting,1);assert.equal(x.b.alreadyApplied,true);assert.deepEqual(x.b.patches,[]);assert.equal(x.c.rows.RencanaPotong[0].status,'batal');assert.equal(x.c.summary.plansAdded,0);
});
test('canonical source changes or tombstone changes abort the entire additive preview',()=>{
  const changed=run('corePlanLegacyCutting(latest,current,original)','latest.produksi.produksi[0].potong[0].jumlah++;');assert.equal(changed.ready,false);assert.deepEqual(changed.rows,{});
  const tomb=run('corePlanLegacyCutting(latest,current,original)',"latest.soldier_deletedIds.push('source_L');");assert.equal(tomb.ready,false);
});
test('existing paid source quantity and reconciliation proof are mandatory',()=>{
  const changed=run('corePlanLegacyCutting(latest,current,original)','current.Potong[0].total++;');assert.equal(changed.ready,false);
  const marker=run('corePlanLegacyCutting(latest,current,original)',"current.PO[0].imporSumber=JSON.stringify({legacyReconciliation:{sourceHash:'other'}});");assert.equal(marker.ready,false);
});
test('source identity, hidden material and removed roll detail do not become fabricated stock',()=>{
  const missing=run('corePlanLegacyCutting(latest,current,original)',"original.produksi.cuttingPlans.p1.rolls[0].purchaseId='missing';refreshProof();");assert.equal(missing.ready,true);assert.equal(missing.summary.plansAdded,0);assert.equal(missing.review[0].code,'missing-purchase-proof');
  const hidden=run('corePlanLegacyCutting(latest,current,original)',"current.Pengaturan.push({key:'bahanSembunyi',value:JSON.stringify(['Kain A'])});");assert.equal(hidden.summary.plansAdded,0);
  const removed=run('corePlanLegacyCutting(latest,current,original)',"original.stokBahan.pembelian[0].rolInfoId='deleted-detail';original.stokBahan.rolInfo={'kain a':{unit:'kg',rols:[]}};");assert.equal(removed.summary.plansAdded,0);assert.equal(removed.review[0].code,'source-roll-insufficient');
});
test('shared stock reservations and source remaining roll prevent overspending',()=>{
  const x=run('corePlanLegacyCutting(latest,current,original)',"original.produksi.produksi.push({id:'source_XL',series:'TEST',namaBarang:'Contoh',size:'XL',poAktif:true});original.produksi.cuttingPlans.p2=makePlan('sourceplan2',[original.produksi.produksi[2]],6);refreshProof();");assert.equal(x.summary.plansAdded,1);assert.equal(x.summary.plansReview,1);assert.equal(x.review[0].code,'source-roll-insufficient');
  const reserved=run('corePlanLegacyCutting(latest,current,original)',"current.RencanaPotong=[{id:'nativeplan',poId:current.PO[0].id,status:'siap',bahanList:JSON.stringify([{nama:'Kain A',qty:17}]),legacyBahanList:JSON.stringify([{nama:'Kain A',qty:17}])}];");assert.equal(reserved.summary.plansAdded,0);assert.equal(reserved.review[0].code,'current-material-insufficient');
});
test('multi-size and already-cut ready plans stay visible review instead of consuming twice',()=>{
  const multi=run('corePlanLegacyCutting(latest,current,original)',"original.produksi.produksi.push({id:'source_XL',series:'TEST',namaBarang:'Contoh',size:'XL',poAktif:true});original.produksi.cuttingPlans.p1.products.push({id:'source_XL',cycle:coreLegacyCuttingCanonical(['source_XL','',[]])});refreshProof();");assert.equal(multi.summary.plansAdded,0);assert.equal(multi.review[0].code,'multi-size-plan-needs-batch-review');
  const done=run('corePlanLegacyCutting(latest,current,original)',"original.produksi.cuttingPlans.p1.products=[{id:'source_M',cycle:coreLegacyCuttingCanonical(['source_M','',[]])}];refreshProof();");assert.equal(done.summary.plansAdded,0);assert.equal(done.review[0].code,'already-cut-or-used');
});
test('used and cancelled plans are evidence only, and intentionally absent POs are not recreated',()=>{
  const x=run('corePlanLegacyCutting(latest,current,original)',"original.produksi.cuttingPlans.p1.status='used';refreshProof();");assert.equal(x.summary.plansAdded,0);assert.equal(x.summary.sourceUsedPlans,1);assert.equal(JSON.parse(x.rows.PO[0].imporSumber).legacyCutting.plans[0].status,'used');
  const absent=run('corePlanLegacyCutting(latest,current,original)','current.PO=[];current.Potong=[];original.produksi.produksi[0].potong=[];refreshProof();');assert.equal(absent.ready,true);assert.equal(absent.rows.PO.length,0);assert.equal(absent.summary.missingPO,1);
});
test('hash changes for concurrent business or payment writes and metadata sanitizer excludes credentials',()=>{
  const x=run(`(function(){var a=corePlanLegacyCutting(latest,current,original);current.SlipUpah[0].totalUpah++;var b=corePlanLegacyCutting(latest,current,original);return{a:a.beforeHash,b:b.beforeHash,input:coreLegacyCuttingInput(original),projectedHash:coreLegacyHash(coreLegacySourceInput(coreLegacyCuttingInput(original))),originalHash:coreLegacyHash(coreLegacySourceInput(original))};})()`);assert.notEqual(x.a,x.b);assert.equal(x.projectedHash,x.originalHash);assert(!JSON.stringify(x.input).includes('PRIVATE-PIN'));assert(!JSON.stringify(x.input).includes('PRIVATE-TOKEN'));
});
test('Firebase null pruning preserves canonical proof and unknown stock spelling is never fuzzy merged',()=>{
  const x=run('corePlanLegacyCutting(latest,current,original)',"latest.produksi.produksi[0].unused=null;latest.produksi.produksi[1].qc=[];");assert.equal(x.ready,true);
  const mismatch=run('corePlanLegacyCutting(latest,current,original)',"original.produksi.cuttingPlans.p1.rolls[0].jenis='Kaen A';refreshProof();");assert.equal(mismatch.summary.plansAdded,0);assert.equal(mismatch.review[0].code,'purchase-changed');
});
test('spreadsheet blank defaults and row order produce the same preview hashes as sparse JSON',()=>{
  const x=run(`(function(){var a=corePlanLegacyCutting(latest,current,original),normalized=coreLegacyCuttingFingerprint(current);normalized.Pengaturan.reverse();var b=corePlanLegacyCutting(latest,normalized,original);return{a:a,b:b};})()`);assert.equal(x.a.beforeHash,x.b.beforeHash);assert.equal(x.a.planHash,x.b.planHash);
});
test('replaying a shared-roll plan never releases a held sibling or allocates its reserved source twice',()=>{
  const x=run(`(function(){var a=corePlanLegacyCutting(latest,current,original);Object.assign(current,a.rows);var b=corePlanLegacyCutting(latest,current,original);current.RencanaPotong[0].status='batal';var cancelled=corePlanLegacyCutting(latest,current,original);return {a:a,b:b,cancelled:cancelled};})()`,"original.produksi.produksi.push({id:'source_XL',series:'TEST',namaBarang:'Contoh',size:'XL',poAktif:true});original.produksi.cuttingPlans.p2=makePlan('sourceplan2',[original.produksi.produksi[2]],6);refreshProof();");
  assert.equal(x.a.summary.plansAdded,1);assert.equal(x.a.summary.plansReview,1);assert.equal(x.b.summary.plansAdded,0);assert.equal(x.b.summary.plansReview,1);assert.equal(x.b.rows.RencanaPotong.length,1);assert.equal(x.b.alreadyApplied,true);assert.equal(x.cancelled.summary.plansAdded,0);assert.equal(x.cancelled.rows.RencanaPotong.length,1);
});
