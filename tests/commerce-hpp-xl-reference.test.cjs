'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
const c=vm.createContext({});for(const name of ['core','reconcile-legacy','commerce-hpp'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/'+name+'.js'),'utf8'),c);
const modelId=vm.runInContext("coreCommerceLegacyCost.modelId('Fixture','Shirt')",c),groupId='hppg_reference';
const costs=()=>({jahitMode:'manual',hargaJahit:3000,biayaLain:3000,targetMargin:30,costSchema:2,costsReviewed:true,basisPolicy:'complete-legacy-v1'});
function fixture(){
 const rolls=[{purchaseId:'roll1',jenis:'Cotton',kg:25.75,unit:'kg'},{purchaseId:'roll2',jenis:'Cotton',kg:26,unit:'kg'}];
 return {config:{modelConfigs:{[modelId]:costs()},hppGroups:{[groupId]:{id:groupId,nama:'Shared shirts',modelIds:[modelId,'model_other'],config:costs()}},marketplace:{}},legacy:{
  production:[{id:'skuM',series:'Fixture',namaBarang:'Shirt',size:'M',potong:[{id:'cutM',tanggal:'2026-10-01',jumlah:121,tarif:900,cuttingPlanId:'plan1',materialBatchId:'batch1',materialAllocation:'owner-plan',bahanList:[{jenis:'Cotton',kg:51.75,unit:'kg'}],rols:structuredClone(rolls)}]},{id:'skuXL',series:'Fixture',namaBarang:'Shirt',size:'XL',potong:[{id:'cutXL',tanggal:'2026-10-02',jumlah:117,tarif:900,cuttingPlanId:'plan1',materialBatchId:'batch2',materialAllocation:'owner-plan-recorded-earlier',kiloan:0}]}],
  stock:{pembelian:[{id:'roll1',jenisBahan:'Cotton',kg:25.75,unit:'kg',rol:1,hargaPerKg:88000,total:2266000},{id:'roll2',jenisBahan:'Cotton',kg:26,unit:'kg',rol:1,hargaPerKg:88000,total:2288000}]},
  cuttingPlans:[{id:'plan1',status:'used',usedBatchId:'batch1',products:[{id:'skuM'},{id:'skuXL'}],rolls:structuredClone(rolls)}]},tables:{}};
}
function run(input){c.fixtureData=JSON.stringify(input);return JSON.parse(vm.runInContext('JSON.stringify(coreCommerceHpp(JSON.parse(fixtureData)))',c));}
function annotate(input,rollIds=['roll1']){const candidate=run(input).models.find(m=>m.id===modelId).xlReferenceCandidate;assert.ok(candidate,'fixture must expose a reconciled candidate');input.config.xlReferences={[modelId]:{planId:candidate.planId,evidenceRevision:candidate.evidenceRevision,rollIds,confirmed:true,createdBy:'owner',createdAt:'2026-10-30'}};return candidate;}

test('owner-selected legacy roll isolates recorded XL output and leaves production, stock, wages and mixed fallback untouched',()=>{
 const input=fixture();delete input.config.hppGroups;const before=JSON.stringify(input.legacy),initial=run(input).models[0];assert.equal(initial.basis.ukuran,undefined);assert.equal(initial.kain.totalPcs,238);assert.equal(initial.kain.totalCost,4554000);
 const candidate=annotate(input);assert.equal(candidate.totalPcs,117);assert.deepEqual(candidate.rolls.map(r=>r.qty),[25.75,26]);
 const m=run(input).models[0];assert.equal(m.basis.ukuran,'XL');assert.equal(m.kain.totalPcs,117);assert.equal(m.kain.totalCost,2266000);assert.equal(m.kain.perPcs,2266000/117);assert.equal(m.potong.perPcs,900);assert.equal(m.configured,true);
 assert.deepEqual(m.kain.observasi.sizes,[{size:'XL',jumlah:117}]);assert.equal(m.kain.observasi.totalKg,25.75);assert.equal(m.kain.observasi.pcsPerFullRoll,117);assert.match(m.kain.observasi.notes.join(' '),/ditentukan owner/);assert.equal(JSON.stringify(input.legacy),before);assert.ok(!JSON.stringify(m).includes('_hppAssignedEntries'));
});

test('one selected XL reference supplies a 14-member group immediately and uses current material price corrections',()=>{
 const input=fixture();input.tables.PO=Array.from({length:13},(_,i)=>({id:'po'+i,series:'Fixture',nama:'Other '+i}));const other=run(input).models.filter(m=>m.id!==modelId).map(m=>m.id);input.config.hppGroups[groupId].modelIds=[modelId,...other];annotate(input);
 let out=run(input),g=out.groups[0];assert.equal(g.configured,true);assert.equal(g.referenceModelIds.length,1);assert.equal(g.kain.totalPcs,117);assert.equal(g.hppTotal,2266000/117+6900);
 input.tables.StokBahan=[{id:'price',jenis:'harga',priceScope:'bahan',bahan:'Cotton',satuan:'kg',qty:0,harga:90000}];out=run(input);assert.equal(out.groups[0].configured,true);assert.equal(out.groups[0].kain.totalCost,25.75*90000);assert.equal(out.models.find(m=>m.id===modelId).xlReferenceCandidate.evidenceRevision,input.config.xlReferences[modelId].evidenceRevision);
});

test('ambiguous plans, duplicate or shared rolls, missing XL and unresolved prices never expose a selector',()=>{
 const changes=[i=>i.legacy.production[1].size='L',i=>i.legacy.production[1].potong[0].jumlah=0,i=>i.legacy.production[1].potong[0].cuttingPlanId='other',i=>i.legacy.cuttingPlans.push(structuredClone(i.legacy.cuttingPlans[0])),i=>i.legacy.cuttingPlans[0].status='in_progress',i=>i.legacy.production[0].potong[0].rols.push(structuredClone(i.legacy.production[0].potong[0].rols[0])),i=>i.legacy.stock.pembelian.push(structuredClone(i.legacy.stock.pembelian[0])),i=>i.legacy.stock.pembelian[0].total=1,i=>i.legacy.production[0].potong[0].rols[0].ukuran='M',i=>i.legacy.cuttingPlans[0].rolls[0].size='M',i=>i.legacy.production.push({id:'other',series:'Other',namaBarang:'Other',size:'XL',potong:[{id:'othercut',jumlah:1,rols:[{purchaseId:'roll1',jenis:'Cotton',kg:1,unit:'kg'}]}]})];
 for(const change of changes){const input=fixture();change(input);assert.equal(run(input).models.find(m=>m.id===modelId).xlReferenceCandidate,null);}
});

test('changed evidence and forged or duplicate assignments remain blocking references instead of silently inheriting another member',()=>{
 for(const change of [i=>i.legacy.production[1].potong[0].jumlah=118,i=>i.config.xlReferences[modelId].rollIds=['roll1','roll1'],i=>i.config.xlReferences[modelId].rollIds=['roll1','roll2'],i=>i.config.xlReferences[modelId].rollIds=['outside'],i=>i.config.xlReferences[modelId].confirmed=false]){
  const input=fixture();delete input.config.hppGroups;annotate(input);change(input);const m=run(input).models[0];assert.equal(m.configured,false);assert.equal(m.kain.complete,false);assert.equal(m.basis.ukuran,'XL');assert.match(m.sourceWarnings.join(' '),/Tentukan ulang/);
 }
});

function server(){
 const h=harness();for(const name of ['reconcile-legacy','commerce-hpp','slip-models','commerce','commerce-migration'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/'+name+'.js'),'utf8'),h.context);
 const setup=h.request('setupOwner',{nama:'Owner Fixture',pin:'1234'});assert.equal(setup.ok,true,setup.error);const token=setup.data.token;
 function request(action,p={},actor=token){h.cold();return h.request(action,{token:actor,workflowVersion:2,...p});}
 function good(action,p={},actor){const r=request(action,p,actor);assert.equal(r.ok,true,r.error);return r.data;}
 function bad(action,p,pattern,actor){const r=request(action,p,actor);assert.equal(r.ok,false,'request must fail');assert.match(r.error,pattern);}
 function raw(table){h.cold();return h.run(`pkStore_().fresh(${JSON.stringify(table)});pkStore_().read(${JSON.stringify(table)})`);}
 const input=fixture(),backup={soldier_hpp_cache_v1:input.config,produksi:{produksi:input.legacy.production,cuttingPlans:input.legacy.cuttingPlans},stokBahan:input.legacy.stock},preview=good('previewCommerceImport',{backup});good('applyCommerceImport',{backup,sourceHash:preview.sourceHash,planHash:preview.planHash});
 h.run("pkStore_().lock(function(){pkStore_().append('Pegawai',{id:'admin',nama:'Admin Fixture',divisi:'admin',aktif:true,token:'fixture-admin-token-001'});});void 0;");
 const state=()=>good('getCommerceState',{module:'hpp'}),payload=()=>{const s=state(),v=s.models[0].xlReferenceCandidate;return {modelId,planId:v.planId,evidenceRevision:v.evidenceRevision,rollIds:['roll1'],confirmed:true,expectedRevision:s.revision,withState:true};};
 return {h,good,bad,raw,state,payload};
}

test('server saves only HPP settings, enforces owner/revision/evidence, and replays once with a durable audit',()=>{
 const f=server(),p=f.payload(),before=JSON.stringify(['PO','Potong','StokBahan','SlipKirim','SlipUpah','CommerceSource','CommerceEvent','CommerceImport'].map(f.raw));
 f.bad('saveCommerceHppXLReference',p,/owner/,'fixture-admin-token-001');f.bad('saveCommerceHppXLReference',{...p,expectedRevision:'stale'},/berubah/);f.bad('saveCommerceHppXLReference',{...p,evidenceRevision:'stale'},/acuan berubah/);
 for(const patch of [{confirmed:false},{rollIds:[]},{rollIds:['roll1','roll1']},{rollIds:['roll1','roll2']},{rollIds:['outside']},{modelId:'missing'}])f.bad('saveCommerceHppXLReference',{...p,...patch},/Pastikan|Pilih|dipilih|Belum ada/);
 const out=f.good('saveCommerceHppXLReference',p);assert.equal(out.commerce.models[0].kain.totalCost,2266000);assert.equal(out.commerce.models[0].configured,true);assert.equal(out.commerce.config.xlReferenceHistory.length,1);assert.equal(out.commerce.config.xlReferenceHistory[0].before,null);assert.equal(f.good('saveCommerceHppXLReference',p).revision,out.revision);assert.equal(f.state().config.xlReferenceHistory.length,1);assert.equal(JSON.stringify(['PO','Potong','StokBahan','SlipKirim','SlipUpah','CommerceSource','CommerceEvent','CommerceImport'].map(f.raw)),before);
 const edit=f.payload();edit.rollIds=['roll2'];const changed=f.good('saveCommerceHppXLReference',edit);assert.equal(changed.commerce.models[0].kain.totalCost,2288000);assert.equal(changed.commerce.config.xlReferenceHistory.length,2);assert.deepEqual(changed.commerce.config.xlReferenceHistory[1].before.rollIds,['roll1']);
 const removed=f.good('saveCommerceHppXLReference',{modelId,remove:true,expectedRevision:changed.revision,withState:true});assert.equal(removed.commerce.models[0].basis.ukuran,undefined);assert.equal(removed.commerce.models[0].kain.totalPcs,238);assert.equal(removed.commerce.config.xlReferenceHistory.length,3);assert.equal(JSON.stringify(['PO','Potong','StokBahan','SlipKirim','SlipUpah','CommerceSource','CommerceEvent','CommerceImport'].map(f.raw)),before);
});
