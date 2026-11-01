'use strict';
/* 1.5.69: rolls labelled per size are read over every preparation of a PO, so XL cloth
   is detected on its own, and a single preparation never stands in for all of it. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const c=vm.createContext({});for(const name of ['core','reconcile-legacy','commerce-hpp'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/'+name+'.js'),'utf8'),c);
const roll=(id,bahan,harga)=>({id,jenis:'beli',bahan,qty:25,satuan:'kg',harga,total:25*harga,stockMode:'roll'});
const COST=25*90000+50*70000+25*80000;
function fixture(){
 const first=[['e1','M'],['e2','XL'],['s1','M'],['s2','M']].map(([stokId,ukuran])=>({stokId,qty:25,ukuran})),second=[['t1','XL'],['t2','XL'],['t3','XXL']].map(([stokId,ukuran])=>({stokId,qty:25,ukuran}));
 return {config:{marketplace:{}},tables:{
  PO:[{id:'po1',series:'Fixture',nama:'Jacket',status:'aktif',produkId:'p1'}],Produk:[{id:'p1',tarifJahit:2000}],
  Potong:[{id:'cutM',poId:'po1',total:100,ukuran:{M:100},tarif:1000,rencanaId:'plan1',bahanList:JSON.stringify([{nama:'Embos',qty:50,satuan:'kg'},{nama:'Scuba',qty:50,satuan:'kg'}]),alokasiBahan:JSON.stringify(first)},
   {id:'cutXL',poId:'po1',total:80,ukuran:{XL:80},tarif:1100,rencanaId:'plan2',bahanList:JSON.stringify([{nama:'Scuba',qty:50,satuan:'kg'},{nama:'Lain',qty:25,satuan:'kg'}]),alokasiBahan:JSON.stringify(second)}],
  RencanaPotong:[{id:'plan1',poId:'po1',status:'terpakai',bahanList:JSON.stringify([{nama:'Embos',qty:50,satuan:'kg'},{nama:'Scuba',qty:50,satuan:'kg'}]),alokasiBahan:JSON.stringify(first)},{id:'plan2',poId:'po1',status:'terpakai',bahanList:JSON.stringify([{nama:'Scuba',qty:50,satuan:'kg'},{nama:'Lain',qty:25,satuan:'kg'}]),alokasiBahan:JSON.stringify(second)}],
  StokBahan:[roll('e1','Embos',90000),roll('e2','Embos',90000),roll('s1','Scuba',70000),roll('s2','Scuba',70000),roll('t1','Scuba',70000),roll('t2','Scuba',80000),roll('t3','Lain',60000)]}};
}
function legacyXL(input,extra={}){input.legacy={production:[{id:'oldXL',series:'Fixture',namaBarang:'Jacket',size:'XL',potong:[{id:'lamaXL',jumlah:204,tarif:900,...extra}]}]};return input;}
const run=input=>{c.fixtureData=JSON.stringify(input);return JSON.parse(vm.runInContext('JSON.stringify(coreCommerceHpp(JSON.parse(fixtureData)))',c));};
const model=input=>run(input).models[0];
const allo=(input,id)=>JSON.parse(input.tables.Potong.find(r=>r.id===id).alokasiBahan);
function relabel(input,id,change){const row=input.tables.Potong.find(r=>r.id===id),plan=input.tables.RencanaPotong.find(r=>r.id===row.rencanaId),next=change(JSON.parse(row.alokasiBahan));row.alokasiBahan=JSON.stringify(next);plan.alokasiBahan=JSON.stringify(next);}

test('XL rolls from two preparations are added, each at its own material and price',()=>{
 const m=model(fixture());
 assert.equal(m.basis.ukuran,'XL');assert.equal(m.kain.complete,true);assert.equal(m.kain.totalPcs,80);assert.equal(m.kain.observasi.totalKg,75);
 assert.equal(m.kain.totalCost,25*90000+25*70000+25*80000);assert.equal(m.potong.totalPcs,80);assert.equal(m.potong.perPcs,1100);assert.ok(m.xlReferenceCandidate,'a wrong label on a used plan must stay correctable');
 assert.deepEqual(m.kain.observasi.sizes,[{size:'XL',jumlah:80}]);assert.match(m.kain.observasi.notes.join(' '),/rol bertanda ukuran XL/);
});

test('it holds when sizes are recorded as continuations, in any order',()=>{
 const input=fixture();input.tables.Potong.push({id:'cutXXL',poId:'po1',total:20,ukuran:{XXL:20},tarif:1200,asal:'lanjut'});
 let m=model(input);assert.equal(m.basis.ukuran,'XL');assert.equal(m.kain.totalPcs,80);assert.equal(m.kain.observasi.totalKg,75);
 const later=fixture();Object.assign(later.tables.Potong[1],{total:20,ukuran:{XXL:20}});later.tables.Potong.push({id:'lateXL',poId:'po1',total:80,ukuran:{XL:80},tarif:1300,asal:'lanjut'});
 m=model(later);assert.equal(m.basis.ukuran,'XL');assert.equal(m.kain.totalPcs,80);assert.equal(m.kain.observasi.totalKg,75);assert.equal(m.potong.perPcs,1300);
});

test('XL split over two results counts its cloth once and keeps each wage',()=>{
 const input=fixture();input.tables.Potong.push({id:'moreXL',poId:'po1',total:20,ukuran:{XL:20},tarif:1500,asal:'lanjut'});
 const m=model(input);assert.equal(m.kain.totalPcs,100);assert.equal(m.kain.observasi.totalKg,75);assert.equal(m.potong.totalCost,80*1100+20*1500);
});

test('a roll split between two sizes over two preparations counts only its XL part',()=>{
 const input=fixture();relabel(input,'cutM',a=>a.map(x=>x.stokId==='e2'?{...x,qty:10}:x));relabel(input,'cutXL',a=>[...a,{stokId:'e2',qty:15,ukuran:'M'}]);
 const row=input.tables.Potong.find(r=>r.id==='cutM');row.bahanList=JSON.stringify([{nama:'Embos',qty:35,satuan:'kg'},{nama:'Scuba',qty:50,satuan:'kg'}]);
 const cut=input.tables.Potong.find(r=>r.id==='cutXL');cut.bahanList=JSON.stringify([{nama:'Scuba',qty:50,satuan:'kg'},{nama:'Lain',qty:25,satuan:'kg'},{nama:'Embos',qty:15,satuan:'kg'}]);
 const m=model(input);assert.equal(m.kain.complete,true);assert.equal(m.kain.observasi.totalKg,60);
});

test('labels found only on the plan are recovered for an older result row',()=>{
 const input=fixture();const row=input.tables.Potong.find(r=>r.id==='cutXL');row.alokasiBahan=JSON.stringify(JSON.parse(row.alokasiBahan).map(({stokId,qty})=>({stokId,qty})));
 const m=model(input);assert.equal(m.basis.ukuran,'XL');assert.equal(m.kain.observasi.totalKg,75);
});

test('one unlabelled roll stops the automatic sum and the owner is offered the rolls instead',()=>{
 const input=fixture();relabel(input,'cutXL',a=>a.map(x=>x.stokId==='t3'?{stokId:'t3',qty:25}:x));
 const m=model(input);assert.notEqual(m.kain.observasi.totalKg,50,'one preparation must not pass as all of XL');assert.equal(m.basis.ukuran,undefined);assert.ok(m.xlReferenceCandidate);assert.equal(m.xlReferenceCandidate.rolls.length,7);
});

test('XL rolls left in a batch with no XL output never yield a part reference',()=>{
 const input=fixture();relabel(input,'cutXL',a=>a.map(({stokId,qty})=>({stokId,qty})));
 const m=model(input);assert.equal(m.basis.ukuran,undefined);assert.ok(m.xlReferenceCandidate);
});

test('uneven records never unlock the sum',()=>{
 for(const change of [
  i=>{i.tables.Potong[1].total=79;},
  i=>{i.tables.Potong.push({id:'x',poId:'po1',total:5,ukuran:{XXL:5},tarif:1,asal:'lanjut',kg:1});},
  i=>{i.tables.Potong.push({id:'y',poId:'po1',total:5,ukuran:{XXL:5},tarif:1,asal:'lanjut',bahanList:'[{"nama":"Scuba","qty":1,"satuan":"kg"}]'});},
  i=>{i.tables.Potong[1].bahanList=JSON.stringify([{nama:'Scuba',qty:49,satuan:'kg'},{nama:'Lain',qty:25,satuan:'kg'}]);},
  i=>{i.tables.Potong[0].alokasiBahan='[]';i.tables.RencanaPotong[0].alokasiBahan='[]';},
  i=>{delete i.tables.StokBahan.find(r=>r.id==='t1').stockMode;},
  i=>{i.tables.RencanaPotong[1].alokasiBahan=JSON.stringify(JSON.parse(i.tables.RencanaPotong[1].alokasiBahan).map(a=>a.stokId==='t1'?{...a,ukuran:'M'}:a));},
 ]){const input=fixture();change(input);assert.notEqual(model(input).kain.observasi.totalKg,75,change.toString());}
});

test('no XL output yet, or no XL rolls at all, gives no reference and no crash',()=>{
 const pending=fixture();Object.assign(pending.tables.Potong[1],{total:80,ukuran:{XXL:80}});
 assert.equal(model(pending).basis.ukuran,undefined);
 const none=fixture();relabel(none,'cutM',a=>a.map(x=>({...x,ukuran:'M'})));relabel(none,'cutXL',a=>a.map(x=>({...x,ukuran:'XXL'})));Object.assign(none.tables.Potong[1],{ukuran:{XL:80}});
 assert.equal(model(none).basis.ukuran,undefined);
});

test('a PO with one preparation keeps its existing behaviour',()=>{
 const input=fixture();input.tables.Potong=input.tables.Potong.filter(r=>r.id==='cutM');relabel(input,'cutM',a=>a);input.tables.Potong[0].ukuran={M:60,XL:40};input.tables.Potong[0].total=100;
 const m=model(input);assert.equal(m.basis.ukuran,'XL');assert.equal(m.kain.totalPcs,40);assert.equal(m.kain.observasi.totalKg,25);
});

test('labelled XL on a complete record outranks old XL output with no fabric',()=>{
 const input=legacyXL(fixture());const m=model(input);
 assert.equal(m.kain.complete,true);assert.equal(m.kain.totalPcs,80);assert.deepEqual(m.basis.origins,{legacy:0,native:80});assert.match(m.kain.observasi.notes.join(' '),/XL lama 204 pcs/);assert.doesNotMatch(m.warnings.join(' '),/tanpa rincian bahan\./);
});

test('old XL with usable fabric is still blended, and unlabelled XL still waits for it',()=>{
 const blended=legacyXL(fixture(),{kiloan:100,jenisBahan:'Scuba',bahanList:[{jenis:'Scuba',kg:100,unit:'kg'}],rols:[{purchaseId:'oldroll',jenis:'Scuba',kg:100,unit:'kg'}]});blended.legacy.stock={pembelian:[{id:'oldroll',jenisBahan:'Scuba',kg:100,unit:'kg',rol:1,hargaPerKg:50000,total:5000000}]};
 let m=model(blended);assert.equal(m.basis.origins.legacy,204);assert.equal(m.kain.totalPcs,284);
 const plain=legacyXL(fixture());plain.tables.Potong=plain.tables.Potong.filter(r=>r.id==='cutXL');relabel(plain,'cutXL',a=>a.filter(x=>x.ukuran==='XL').map(({stokId,qty})=>({stokId,qty})));plain.tables.Potong[0].bahanList=JSON.stringify([{nama:'Scuba',qty:50,satuan:'kg'}]);
 m=model(plain);assert.equal(m.kain.complete,false);assert.equal(m.basis.origins.legacy,204);
});

test('an archived review stops holding a labelled reference from another PO, never its own',()=>{
 const input=legacyXL(fixture());input.tables.PO.push({id:'old',series:'Fixture',nama:'Jacket',noPO:'PO-OLD',asal:'lama',status:'selesai',catatan:'Arsip PO 28/09/26',imporReview:'Arsip',imporSumber:JSON.stringify({legacyReconciliation:{mode:'archive'}})});
 assert.deepEqual(model(input).sourceWarnings,[]);
 Object.assign(input.tables.PO[0],{asal:'lama',catatan:'Arsip PO 01/10/26',imporReview:'Arsip',imporSumber:JSON.stringify({legacyReconciliation:{mode:'archive'}})});
 const own=model(input);assert.equal(own.kain.complete,false);assert.equal(own.sourceWarnings.length,2);
});

test('a review on a live PO keeps holding',()=>{
 const input=legacyXL(fixture());input.tables.PO[0].imporReview='Periksa';assert.equal(model(input).sourceWarnings.length,1);
});

const withFabric=(extra={})=>{const input=legacyXL(fixture(),{kiloan:100,jenisBahan:'Scuba',bahanList:[{jenis:'Scuba',kg:100,unit:'kg'}],rols:[{purchaseId:'oldroll',jenis:'Scuba',kg:100,unit:'kg'}],...extra});input.legacy.stock={pembelian:[{id:'oldroll',jenisBahan:'Scuba',kg:100,unit:'kg',rol:1,hargaPerKg:50000,total:5000000}]};return input;};

test('old XL with cloth but another fault keeps holding and keeps its warning',()=>{
 const noPrice=withFabric();Object.assign(noPrice.legacy.stock.pembelian[0],{hargaPerKg:0,total:0});
 let m=model(noPrice);assert.equal(m.kain.complete,false);assert.equal(m.basis.origins.legacy,204);assert.equal(m.hppTotal,null);assert.match(m.warnings.join(' '),/belum dapat dicocokkan dengan pembelian/);assert.doesNotMatch(m.kain.observasi.notes.join(' '),/tidak ikut acuan/);
 const planned=withFabric({cuttingPlanId:'oldplan',materialBatchId:'b1',materialAllocation:'owner-plan'});planned.legacy.cuttingPlans=[{id:'oldplan',status:'in_progress',usedBatchId:'b1',products:[{id:'oldXL'}],rolls:[{purchaseId:'oldroll',jenis:'Scuba',kg:100,unit:'kg'}]}];
 m=model(planned);assert.equal(m.kain.complete,false);assert.equal(m.basis.origins.legacy,204);assert.match(m.warnings.join(' '),/Hasil potong bertahap belum selesai/);
 const twin=legacyXL(fixture());twin.legacy.production.push({id:'oldXL',series:'Fixture',namaBarang:'Jacket',size:'XL',potong:[]});
 m=model(twin);assert.equal(m.kain.complete,false);assert.match(m.warnings.join(' '),/Identitas produk ganda/);
 const bad=legacyXL(fixture(),{bahanList:[{jenis:'Scuba',kg:0,unit:'kg'}]});
 m=model(bad);assert.equal(m.kain.complete,false);assert.match(m.warnings.join(' '),/belum valid/);
});

function choose(input,rollIds){const v=model(input).xlReferenceCandidate;assert.ok(v,'rolls must be offered');input.config.xlReferences={[model(input).id]:{planId:v.planId,evidenceRevision:v.evidenceRevision,rollIds,confirmed:true,createdBy:'owner',createdAt:'2026-11-01'}};return v;}

test('labelled rolls stay open to an owner choice, which then decides for that PO',()=>{
 const input=fixture();assert.equal(model(input).kain.observasi.totalKg,75);assert.equal(model(input).xlReferenceCandidate.planId,'native:po1');
 choose(input,['e2','t1']);const m=model(input);assert.equal(m.kain.observasi.totalKg,50);assert.equal(m.kain.totalCost,25*90000+25*70000);assert.match(m.kain.source,/ditentukan owner/);assert.deepEqual(m.xlReference.rollIds,['e2','t1']);assert.ok(m.xlReferenceCandidate);
 delete input.config.xlReferences;assert.equal(model(input).kain.observasi.totalKg,75);
});

test('a saved choice that lapses still asks for a new one on a labelled PO',()=>{
 const input=fixture();choose(input,['e2','t1']);input.tables.Potong.push({id:'late',poId:'po1',total:5,ukuran:{XXL:5},tarif:1,asal:'lanjut'});
 const m=model(input);assert.match(m.sourceWarnings.join(' '),/Tentukan ulang/);assert.equal(m.configured,false);
});

test('a saved choice and a new labelled PO of the same model are both counted',()=>{
 const input=fixture();relabel(input,'cutXL',a=>a.map(x=>x.stokId==='t3'?{stokId:'t3',qty:25}:x));const v=choose(input,['e2','t1','t2']);
 const before=model(input);assert.equal(before.kain.observasi.totalKg,75);
 input.tables.PO.push({id:'po2',series:'Fixture',nama:'Jacket',status:'aktif'});input.tables.StokBahan.push(roll('n1','Scuba',70000));
 const list=[{stokId:'n1',qty:25,ukuran:'XL'}];input.tables.Potong.push({id:'newXL',poId:'po2',total:50,ukuran:{XL:50},tarif:900,rencanaId:'plan3',bahanList:JSON.stringify([{nama:'Scuba',qty:25,satuan:'kg'}]),alokasiBahan:JSON.stringify(list)});input.tables.RencanaPotong.push({id:'plan3',poId:'po2',status:'terpakai',bahanList:JSON.stringify([{nama:'Scuba',qty:25,satuan:'kg'}]),alokasiBahan:JSON.stringify(list)});
 const m=model(input);assert.equal(m.kain.totalPcs,130);assert.equal(m.kain.observasi.totalKg,100);assert.deepEqual(m.sourceWarnings,[]);assert.equal(m.xlReferenceCandidate.evidenceRevision,v.evidenceRevision);
});

test('a cancelled or archived PO cannot be the labelled reference',()=>{
 const gone=legacyXL(fixture());gone.tables.PO[0].status='batal';const m=model(gone);assert.equal(m.kain.complete,false);assert.equal(m.basis.origins.legacy,204);
 const old=fixture();Object.assign(old.tables.PO[0],{asal:'lama',catatan:'Arsip PO 01/10/26',imporSumber:JSON.stringify({legacyReconciliation:{mode:'archive'}})});assert.notEqual(model(old).kain.observasi.totalKg,75);
});

test('one roll listed twice in a cut stops the sum',()=>{
 const input=fixture();relabel(input,'cutXL',a=>[...a,a[0]]);input.tables.Potong[1].bahanList=JSON.stringify([{nama:'Scuba',qty:75,satuan:'kg'},{nama:'Lain',qty:25,satuan:'kg'}]);
 assert.notEqual(model(input).kain.observasi.totalKg,100);
});

test('a plan label that cannot be recovered stops the other batch from standing alone',()=>{
 const input=fixture();const row=input.tables.Potong.find(r=>r.id==='cutM');row.alokasiBahan=JSON.stringify(JSON.parse(row.alokasiBahan).map(({stokId,qty})=>({stokId,qty})));input.tables.RencanaPotong[0].bahanList=JSON.stringify([{nama:'Embos',qty:49,satuan:'kg'},{nama:'Scuba',qty:50,satuan:'kg'}]);
 const m=model(input);assert.equal(m.basis.ukuran,undefined);assert.notEqual(m.kain.observasi.totalKg,50);
});

test('saldo lama in a plan holds the sum but the owner can still choose the rolls',()=>{
 const input=fixture();input.tables.StokBahan.push({id:'lama',jenis:'beli',bahan:'Rib',qty:5,satuan:'kg',harga:10000,total:50000});
 const cut=input.tables.Potong.find(r=>r.id==='cutM');cut.bahanList=JSON.stringify([{nama:'Embos',qty:50,satuan:'kg'},{nama:'Scuba',qty:50,satuan:'kg'},{nama:'Rib',qty:5,satuan:'kg'}]);
 const plan=input.tables.RencanaPotong[0];plan.bahanList=cut.bahanList;plan.legacyBahanList=JSON.stringify([{nama:'Rib',qty:5,satuan:'kg'}]);
 let m=model(input);assert.equal(m.basis.ukuran,undefined);assert.ok(m.xlReferenceCandidate);assert.equal(m.xlReferenceCandidate.rolls.length,7);
 choose(input,['e2','t1','t2']);m=model(input);assert.equal(m.kain.complete,true);assert.equal(m.kain.observasi.totalKg,75);
});

function ownerShape(){const input=fixture();relabel(input,'cutXL',a=>a.map(x=>x.stokId==='t3'?{stokId:'t3',qty:25}:x));choose(input,['e2','t1','t2']);return input;}
function pureXL(input,po){input.tables.PO.push(po);input.tables.StokBahan.push(roll('n1','Scuba',300000));const list=[{stokId:'n1',qty:25,ukuran:'XL'}],bahan=JSON.stringify([{nama:'Scuba',qty:25,satuan:'kg'}]);input.tables.Potong.push({id:'other',poId:po.id,total:40,ukuran:{XL:40},tarif:900,rencanaId:'plan9',bahanList:bahan,alokasiBahan:JSON.stringify(list)});input.tables.RencanaPotong.push({id:'plan9',poId:po.id,status:'terpakai',bahanList:bahan,alokasiBahan:JSON.stringify(list)});return input;}

test('an owner choice never blends an archived PO in, and its review keeps holding',()=>{
 const input=pureXL(ownerShape(),{id:'old',series:'Fixture',nama:'Jacket',noPO:'PO-OLD',asal:'lama',status:'aktif',catatan:'Arsip PO 28/09/26',imporReview:'Arsip',imporSumber:JSON.stringify({legacyReconciliation:{mode:'archive'}})});
 const m=model(input);assert.equal(m.kain.totalPcs,80);assert.equal(m.kain.observasi.totalKg,75);assert.ok(m.kain.details.every(d=>d.cutId!=='other'));
});

test('an owner choice never blends a cancelled PO in, but a live second PO still counts',()=>{
 const gone=model(pureXL(ownerShape(),{id:'po5',series:'Fixture',nama:'Jacket',status:'batal'}));assert.equal(gone.kain.totalPcs,80);
 const live=model(pureXL(ownerShape(),{id:'po5',series:'Fixture',nama:'Jacket',status:'aktif'}));assert.equal(live.kain.totalPcs,120);assert.equal(live.kain.observasi.totalKg,100);
});

test('a cut wholly on saldo lama keeps the selector open',()=>{
 const input=fixture();const first=[['e1','M'],['e2','XL'],['s1','M']].map(([stokId,ukuran])=>({stokId,qty:25,ukuran}));
 input.tables.StokBahan.push({id:'lama',jenis:'beli',bahan:'Rib',qty:50,satuan:'kg',harga:10000,total:500000});
 const cutM=input.tables.Potong.find(r=>r.id==='cutM');cutM.alokasiBahan=JSON.stringify(first);cutM.bahanList=JSON.stringify([{nama:'Embos',qty:50,satuan:'kg'},{nama:'Scuba',qty:25,satuan:'kg'}]);
 Object.assign(input.tables.RencanaPotong[0],{alokasiBahan:JSON.stringify(first),bahanList:cutM.bahanList});
 const cutXL=input.tables.Potong.find(r=>r.id==='cutXL'),bahan=JSON.stringify([{nama:'Rib',qty:50,satuan:'kg'}]);Object.assign(cutXL,{alokasiBahan:'',bahanList:bahan});Object.assign(input.tables.RencanaPotong[1],{alokasiBahan:'',bahanList:bahan,legacyBahanList:bahan});
 let m=model(input);assert.equal(m.basis.ukuran,undefined);assert.equal(m.xlReferenceCandidate.rolls.length,3);
 choose(input,['e2']);m=model(input);assert.equal(m.basis.ukuran,'XL');assert.equal(m.kain.totalPcs,80);assert.equal(m.kain.complete,true);
});

test('saldo lama named by the plan but absent from the cut does not void a choice',()=>{
 const input=fixture();relabel(input,'cutXL',a=>a.map(x=>x.stokId==='t3'?{stokId:'t3',qty:25}:x));input.tables.StokBahan.push({id:'lama',jenis:'beli',bahan:'Rib',qty:5,satuan:'kg',harga:10000,total:50000});
 input.tables.RencanaPotong[1].legacyBahanList=JSON.stringify([{nama:'Scuba',qty:5,satuan:'kg'}]);
 assert.ok(model(input).xlReferenceCandidate);
});

test('when no sum and no selector are possible the model says why',()=>{
 const input=fixture();relabel(input,'cutXL',a=>a.map(({stokId,qty})=>({stokId,qty})));
 input.tables.PO.push({id:'po7',series:'Other',nama:'Other'});input.tables.Potong.push({id:'share',poId:'po7',total:5,ukuran:{M:5},tarif:1,bahanList:'[{"nama":"Scuba","qty":1,"satuan":"kg"}]',alokasiBahan:'[{"stokId":"t1","qty":1}]'});
 const m=model(input);assert.equal(m.xlReferenceCandidate,null);assert.equal(m.basis.ukuran,undefined);assert.match(m.warnings.join(' '),/Rol XL tersebar di beberapa persiapan/);
});

test('a roll cannot count past its own weight over two preparations',()=>{
 const input=fixture();relabel(input,'cutM',a=>[...a,{stokId:'t1',qty:25,ukuran:'XL'}]);input.tables.Potong.find(r=>r.id==='cutM').bahanList=JSON.stringify([{nama:'Embos',qty:50,satuan:'kg'},{nama:'Scuba',qty:75,satuan:'kg'}]);
 assert.notEqual(model(input).kain.observasi.totalKg,100);
});
