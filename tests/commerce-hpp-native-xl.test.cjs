'use strict';
/* 1.5.68: XL cut from rolls shared with other sizes or spread over two plans. The owner
   names the XL rolls; nothing changes until then, and production records never do. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
const c=vm.createContext({});for(const name of ['core','reconcile-legacy','commerce-hpp'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/'+name+'.js'),'utf8'),c);
const modelId=vm.runInContext("coreCommerceLegacyCost.modelId('Fixture','Jacket')",c),XL=['e2','s3','s4','t1','t2'];
const roll=(id,bahan,harga,label)=>({id,jenis:'beli',bahan,qty:25,satuan:'kg',harga,total:25*harga,stockMode:'roll',rollLabel:label});
function fixture(){
 const first=[['e1','M'],['e2','XL'],['e3','XXL'],['s1','M'],['s2','M'],['s3','XL'],['s4','XL']].map(([stokId,ukuran])=>({stokId,qty:25,ukuran})),second=['t1','t2','t3','t4'].map(stokId=>({stokId,qty:25}));
 return {config:{marketplace:{}},legacy:{production:[{id:'oldM',series:'Fixture',namaBarang:'Jacket',size:'M',potong:[{id:'lamaM',jumlah:268,tarif:900}]},{id:'oldXL',series:'Fixture',namaBarang:'Jacket',size:'XL',potong:[{id:'lamaXL',jumlah:204,tarif:900}]}]},tables:{
  PO:[{id:'old',series:'Fixture',nama:'Jacket',noPO:'PO-OLD',asal:'lama',status:'selesai',catatan:'Arsip PO 28/09/26',imporReview:'Arsip lama dipertahankan.',imporSumber:JSON.stringify({legacyReconciliation:{mode:'archive'}})},
   {id:'po1',series:'Fixture',nama:'Jacket',noPO:'PO-NEW',asal:'lama',status:'aktif',produkId:'p1',imporSumber:JSON.stringify({legacyReconciliation:{mode:'migrated'}})}],
  Produk:[{id:'p1',tarifJahit:2000}],
  Potong:[{id:'lamaM',poId:'old',total:268,ukuran:{M:268},asal:'lama'},{id:'lamaXL',poId:'old',total:204,ukuran:{XL:204},asal:'lama'},
   {id:'cutM',poId:'po1',total:272,ukuran:{M:272},tarif:1000,rencanaId:'plan1',bahanList:JSON.stringify([{nama:'Embos',qty:75},{nama:'Scuba',qty:100}]),alokasiBahan:JSON.stringify(first)},
   {id:'cutXL',poId:'po1',total:201,ukuran:{XL:201},tarif:1100,rencanaId:'plan2',bahanList:JSON.stringify([{nama:'Scuba',qty:100,satuan:'kg'}]),alokasiBahan:JSON.stringify(second)},
   {id:'cutXXL',poId:'po1',total:94,ukuran:{XXL:94},tarif:1100,asal:'lanjut'}],
  RencanaPotong:[{id:'plan1',poId:'po1',status:'terpakai'},{id:'plan2',poId:'po1',status:'terpakai'}],
  StokBahan:[...['e1','e2','e3'].map((id,i)=>roll(id,'Embos',80000,'Rol '+(i+1))),...['s1','s2','s3','s4'].map((id,i)=>roll(id,'Scuba',60000,'Rol '+(i+1))),...['t1','t2','t3','t4'].map((id,i)=>roll(id,'Scuba',70000,'Rol '+(i+1)))]}};
}
function run(input){c.fixtureData=JSON.stringify(input);return JSON.parse(vm.runInContext('JSON.stringify(coreCommerceHpp(JSON.parse(fixtureData)))',c));}
const jacket=input=>run(input).models.find(m=>m.id===modelId);
function choose(input,rollIds=XL){const v=jacket(input).xlReferenceCandidate;assert.ok(v,'fixture must offer its rolls');input.config.xlReferences={[modelId]:{planId:v.planId,evidenceRevision:v.evidenceRevision,rollIds,confirmed:true,createdBy:'owner',createdAt:'2026-11-01'}};return v;}
const reviewed=()=>({jahitMode:'auto',hargaJahit:0,biayaLain:3000,targetMargin:30,costSchema:2,costsReviewed:true,basisPolicy:'complete-legacy-v1'});

test('rolls are only offered: nothing changes until the owner chooses',()=>{
 const input=fixture(),m=jacket(input),v=m.xlReferenceCandidate;
 assert.equal(v.planId,'native:po1');assert.equal(v.totalPcs,201);assert.equal(v.rolls.length,11);
 assert.deepEqual(v.rolls.filter(r=>/jatah XL/.test(r.label)).map(r=>r.id),['e2','s3','s4']);assert.equal(v.rolls.filter(r=>/belum dibagi/.test(r.label)).length,4);
 assert.equal(m.kain.complete,false);assert.equal(m.kain.totalPcs,204);assert.match(m.warnings.join(' '),/tanpa rincian bahan/);assert.deepEqual(m.sourceWarnings,['PO PO-OLD masih memerlukan pemeriksaan riwayat.']);
});

test('a saved choice costs only the XL pcs from the chosen rolls and leaves the records alone',()=>{
 const input=fixture();choose(input);const before=JSON.stringify(input.tables),m=jacket(input);
 assert.equal(m.basis.ukuran,'XL');assert.deepEqual(m.basis.origins,{legacy:0,native:201});assert.equal(m.basis.excludedPcs,0);
 assert.equal(m.kain.complete,true);assert.equal(m.kain.totalPcs,201);assert.equal(m.kain.totalCost,25*80000+50*60000+50*70000);
 assert.equal(m.potong.complete,true);assert.equal(m.potong.totalPcs,201);assert.equal(m.potong.perPcs,1100);
 assert.deepEqual(m.kain.observasi.sizes,[{size:'XL',jumlah:201}]);assert.equal(m.kain.observasi.totalKg,125);
 assert.match(m.kain.observasi.notes.join(' '),/ditentukan owner/);assert.match(m.kain.observasi.notes.join(' '),/XL lama 204 pcs/);
 assert.deepEqual(m.sourceWarnings,[]);assert.doesNotMatch(m.warnings.join(' '),/tanpa rincian bahan yang sah|Belum ada hasil XL/);
 assert.equal(JSON.stringify(input.tables),before);assert.equal(m.xlReferenceCandidate.evidenceRevision,input.config.xlReferences[modelId].evidenceRevision);
});

test('a price correction follows the chosen rolls without voiding the choice',()=>{
 const input=fixture();choose(input);input.tables.StokBahan.push({id:'price',jenis:'harga',priceScope:'bahan',bahan:'Scuba',satuan:'kg',qty:0,harga:90000});
 const m=jacket(input);assert.equal(m.kain.complete,true);assert.equal(m.kain.totalCost,25*80000+100*90000);assert.deepEqual(m.sourceWarnings,[]);
});

test('an XL split over two cuts keeps each cut wage and counts the cloth once',()=>{
 const input=fixture();input.tables.Potong.find(r=>r.id==='cutXXL').ukuran={XL:40,XXL:54};choose(input);
 const m=jacket(input);assert.equal(m.kain.totalPcs,241);assert.equal(m.kain.totalCost,25*80000+50*60000+50*70000);assert.equal(m.potong.totalPcs,241);assert.equal(m.potong.totalCost,241*1100);
});

test('changed evidence or a forged choice cannot stand and asks for a new choice',()=>{
 for(const change of [i=>i.tables.Potong.push({id:'more',poId:'po1',total:5,ukuran:{XL:5},tarif:1100,asal:'lanjut'}),i=>i.config.xlReferences[modelId].rollIds=['e2','e2'],i=>i.config.xlReferences[modelId].rollIds=['outside'],i=>i.config.xlReferences[modelId].rollIds=fixture().tables.StokBahan.map(r=>r.id),i=>i.config.xlReferences[modelId].rollIds=[],i=>i.config.xlReferences[modelId].confirmed=false,i=>i.config.xlReferences[modelId].planId='native:other']){
  const input=fixture();choose(input);change(input);const m=jacket(input);
  assert.equal(m.kain.complete,false);assert.equal(m.configured,false);assert.match(m.sourceWarnings.join(' '),/Tentukan ulang/);assert.match(m.sourceWarnings.join(' '),/PO-OLD/);
 }
});

test('uncertain records never offer a selector',()=>{
 const cut=(i,id)=>i.tables.Potong.find(r=>r.id===id),stock=(i,id)=>i.tables.StokBahan.find(r=>r.id===id);
 for(const change of [
  i=>i.tables.PO[1].status='batal',
  i=>{i.tables.PO[1].catatan='Arsip PO 01/10/26';},
  i=>{i.tables.PO[1].imporReview='Periksa dulu';},
  i=>cut(i,'cutXL').ukuran={L:201},
  i=>cut(i,'cutXL').total=200,
  i=>cut(i,'cutXXL').bahanList=JSON.stringify([{nama:'Scuba',qty:10,satuan:'kg'}]),
  i=>cut(i,'cutM').alokasiBahan='[]',
  i=>cut(i,'cutXL').bahanList=JSON.stringify([{nama:'Scuba',qty:90,satuan:'kg'}]),
  i=>{stock(i,'s3').harga=0;stock(i,'s3').total=0;},
  i=>delete stock(i,'t1').stockMode,
  i=>i.tables.StokBahan.push(structuredClone(stock(i,'e1'))),
  i=>{i.tables.PO.push({id:'po2',series:'Other',nama:'Other'});i.tables.Potong.push({id:'share',poId:'po2',total:5,ukuran:{M:5},tarif:1,bahanList:'[{"nama":"Scuba","qty":1,"satuan":"kg"}]',alokasiBahan:'[{"stokId":"t1","qty":1}]'});},
  i=>{i.tables.PO.push({id:'po3',series:'Fixture',nama:'Jacket',status:'aktif'});i.tables.Potong.push({id:'other',poId:'po3',total:5,ukuran:{XL:5,M:1},tarif:1});},
 ]){const input=fixture();change(input);assert.equal(jacket(input).xlReferenceCandidate,null,change.toString());}
});

test('a pure XL cut stays automatic and never needs a choice',()=>{
 const input=fixture();input.tables.Potong=input.tables.Potong.filter(r=>r.id!=='cutXXL'&&r.id!=='cutM');
 const m=jacket(input);assert.equal(m.xlReferenceCandidate,null);assert.equal(m.basis.ukuran,'XL');assert.equal(m.kain.source.includes('potongan ukuran XL'),true);
});

function grouped(){
 const input=fixture(),groupId='hppg_jacket';
 input.legacy.production.push({id:'sage',series:'Fixture',namaBarang:'Sage',size:'XL',potong:[]});
 input.tables.PO.push({id:'po4',series:'Fixture',nama:'Busy',produkId:'p1',status:'aktif'});input.tables.Potong.push({id:'busycut',poId:'po4',total:100,ukuran:{M:100},tarif:900});
 input.tables.SlipKirim=[{id:'send',poId:'po4',maklonId:'w1',total:100,upah:2500}];
 const ids=run(input).models.map(m=>m.id);input.config.hppGroups={[groupId]:{id:groupId,nama:'Jackets',modelIds:ids,config:reviewed()}};return input;
}

test('one owner choice supplies the group, and a member never produced does not hold the sewing rate',()=>{
 const input=grouped();let g=run(input).groups[0];
 assert.deepEqual(g.referenceModelIds,[]);assert.equal(g.hppTotal,null);assert.equal(g.jahit.complete,true);assert.equal(g.jahit.perPcs,2500);
 choose(input);g=run(input).groups[0];
 assert.deepEqual(g.referenceModelIds,[modelId]);assert.equal(g.kain.totalPcs,201);assert.equal(g.potong.totalPcs,201);assert.equal(g.hargaJahit,2500);assert.equal(g.configured,true);
 assert.equal(g.hppTotal,(25*80000+50*60000+50*70000)/201+1100+2500+3000);
});

test('a produced member with a missing rate still holds the group sewing rate',()=>{
 const input=grouped();input.tables.SlipKirim.push({id:'send2',poId:'po1',maklonId:'w2',total:10,upah:0});
 const g=run(input).groups[0];assert.equal(g.jahit.complete,false);assert.equal(g.hargaJahit,null);assert.match(g.warnings.join(' '),/belum ada tarif pasti/);
});

test('a member with unreadable sewing history is not treated as never produced',()=>{
 const input=grouped();input.legacy.production.find(r=>r.id==='sage').assignJahit=[{id:'bad',qty:-2,tukangId:'w'}];
 const g=run(input).groups[0];assert.equal(g.jahit.complete,false);assert.equal(g.hargaJahit,null);
});

function server(){
 const h=harness();for(const name of ['reconcile-legacy','commerce-hpp','slip-models','commerce','commerce-migration'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/'+name+'.js'),'utf8'),h.context);
 const setup=h.request('setupOwner',{nama:'Owner Fixture',pin:'1234'});assert.equal(setup.ok,true,setup.error);const token=setup.data.token;
 const request=(action,p={},actor=token)=>{h.cold();return h.request(action,{token:actor,workflowVersion:2,...p});};
 const good=(action,p={},actor)=>{const r=request(action,p,actor);assert.equal(r.ok,true,r.error);return r.data;};
 const bad=(action,p,pattern,actor)=>{const r=request(action,p,actor);assert.equal(r.ok,false,'request must fail');assert.match(r.error,pattern);};
 const raw=table=>{h.cold();return h.run(`pkStore_().fresh(${JSON.stringify(table)});pkStore_().read(${JSON.stringify(table)})`);};
 const input=fixture(),backup={soldier_hpp_cache_v1:input.config,produksi:{produksi:input.legacy.production,cuttingPlans:[]},stokBahan:{pembelian:[]}},preview=good('previewCommerceImport',{backup});good('applyCommerceImport',{backup,sourceHash:preview.sourceHash,planHash:preview.planHash});
 h.run(`pkStore_().lock(function(){var t=${JSON.stringify(input.tables)};Object.keys(t).forEach(function(name){t[name].forEach(function(row){pkStore_().append(name,row);});});pkStore_().append('Pegawai',{id:'admin',nama:'Admin Fixture',divisi:'admin',aktif:true,token:'fixture-admin-token-001'});});void 0;`);
 const state=()=>good('getCommerceState',{module:'hpp'}),model=s=>s.models.find(m=>m.id===modelId);
 const payload=()=>{const s=state(),v=model(s).xlReferenceCandidate;return {modelId,planId:v.planId,evidenceRevision:v.evidenceRevision,rollIds:XL,confirmed:true,expectedRevision:s.revision,withState:true};};
 return {good,bad,raw,state,model,payload};
}

test('the server saves a native choice as an HPP setting only and can take it back',()=>{
 const f=server(),p=f.payload(),tables=()=>JSON.stringify(['PO','Potong','StokBahan','SlipKirim','SlipUpah','RencanaPotong'].map(f.raw)),before=tables();
 f.bad('saveCommerceHppXLReference',p,/owner/,'fixture-admin-token-001');f.bad('saveCommerceHppXLReference',{...p,evidenceRevision:'stale'},/acuan berubah/);
 for(const patch of [{confirmed:false},{rollIds:[]},{rollIds:['e2','e2']},{rollIds:['outside']},{rollIds:f.model(f.state()).xlReferenceCandidate.rolls.map(r=>r.id)}])f.bad('saveCommerceHppXLReference',{...p,...patch},/Pastikan|Pilih|dipilih/);
 const out=f.good('saveCommerceHppXLReference',p),saved=f.model(out.commerce);
 assert.equal(saved.kain.complete,true);assert.equal(saved.kain.totalPcs,201);assert.equal(saved.xlReference.planId,'native:po1');assert.equal(out.commerce.config.xlReferenceHistory.length,1);assert.equal(tables(),before);
 assert.equal(f.good('saveCommerceHppXLReference',p).revision,out.revision);
 const removed=f.good('saveCommerceHppXLReference',{modelId,remove:true,expectedRevision:out.revision,withState:true}),back=f.model(removed.commerce);
 assert.equal(back.kain.complete,false);assert.equal(back.kain.totalPcs,204);assert.equal(back.xlReference,null);assert.equal(removed.commerce.config.xlReferenceHistory.length,2);assert.equal(tables(),before);
});
