'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const c=vm.createContext({});
for(const file of ['core','commerce-hpp'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/'+file+'.js'),'utf8'),c);
const id=vm.runInContext("coreCommerceLegacyCost.modelId('Fixture','Shirt')",c);
function run(input){c.input=JSON.stringify(input);return JSON.parse(vm.runInContext('JSON.stringify(coreCommerceHpp(JSON.parse(input)))',c));}
function fixture(){return {config:{modelConfigs:{[id]:{jahitMode:'manual',hargaJahit:2000,biayaLain:1000,targetMargin:20,costSchema:2,costsReviewed:true}},marketplace:{},pajak:0},tables:{PO:[{id:'po1',nama:'Shirt',series:'Fixture',ukuranAktif:['M','L','XL']}],Potong:[{id:'cut1',poId:'po1',total:100,ukuran:{XL:100},tarif:500,bahanList:[{nama:'Cotton',satuan:'kg',qty:25}],alokasiBahan:[{stokId:'roll1',qty:25}]}],StokBahan:[{id:'roll1',jenis:'beli',bahan:'Cotton',satuan:'kg',qty:25,harga:0,total:0,stockMode:'roll',rol:1,rollLabel:'Rol lama 1'}]}};}
function correction(input,stokId='roll1',harga=88000){input.tables.StokBahan.push({id:'correction-'+input.tables.StokBahan.length,jenis:'harga',sourceStockId:stokId,qty:0,harga,bahan:'Cotton',satuan:'kg'});}

test('shared material policy updates all XL cost references once while preserving old, current and future receipt prices',()=>{
 const input=fixture();correction(input,'roll1',60000);
 input.tables.StokBahan.push({id:'policy1',jenis:'harga',priceScope:'bahan',bahan:'COTTON',satuan:'kg',qty:0,harga:88000});
 input.tables.StokBahan.push({id:'future2',jenis:'beli',bahan:'Cotton',satuan:'kg',qty:25,harga:69000,total:1725000,stockMode:'roll',rol:1});
 input.tables.Potong.push({id:'cut2',poId:'po1',total:50,ukuran:{XL:50},tarif:500,bahanList:[{nama:'Cotton',satuan:'kg',qty:25}],alokasiBahan:[{stokId:'future2',qty:25}]});
 let before=JSON.stringify(input),m=run(input).models[0];assert.equal(m.kain.totalCost,4400000);assert.equal(m.kain.totalPcs,150);assert.equal(m.kain.perPcs,4400000/150);assert.equal(m.basis.ukuran,'XL');assert.equal(m.complete,true);assert.equal(m.kain.details[0].priceSource,'harga-jenis-bahan');assert.equal(m.kain.details[1].priceSource,'harga-jenis-bahan');assert.equal(JSON.stringify(input),before);
 input.tables.Potong.forEach(r=>r.alokasiBahan=[]);m=run(input).models[0];assert.equal(m.kain.totalCost,4400000);assert.equal(m.kain.details[0].priceSource,'harga-jenis-bahan');
});

test('shared material price reaches snapshot-only legacy receipts by material and unit, never a different unit or fabric',()=>{
 const input=fixture();input.tables.Potong=[];
 input.tables.StokBahan.push({id:'policy1',jenis:'harga',priceScope:'bahan',bahan:'Cotton',satuan:'kg',qty:0,harga:88000});
 input.legacy={production:[{id:'old-xl',series:'Fixture',namaBarang:'Shirt',size:'XL',potong:[{id:'oldcut',tanggal:'2026-08-01',jumlah:100,tarif:500,bahanList:[{jenis:'Cotton',kg:25,unit:'kg'}],rols:[{purchaseId:'snapshot-only',jenis:'Cotton',kg:25,unit:'kg'}]}]}],stock:{pembelian:[{id:'snapshot-only',jenisBahan:'Cotton',kg:25,unit:'kg',hargaPerKg:0,total:0,rol:1}]},cuttingPlans:[]};
 const before=JSON.stringify(input);let m=run(input).models[0];assert.equal(m.kain.totalCost,2200000);assert.equal(m.kain.perPcs,22000);assert.equal(m.complete,true);assert.equal(m.kain.observasi.rolls[0].harga,88000);assert.equal(JSON.stringify(input),before);
 input.tables.StokBahan[1].satuan='yard';assert.equal(run(input).models[0].hppTotal,null);
 input.tables.StokBahan[1].satuan='kg';input.tables.StokBahan[1].bahan='Different';assert.equal(run(input).models[0].hppTotal,null);
});

test('correct old 25kg roll at 88000: 100XL output sets model fabric HPP22000 for M/L/XL without changing any source',()=>{
 const input=fixture();let m=run(input).models[0];assert.equal(m.hppTotal,null);
 correction(input);const before=JSON.stringify(input);m=run(input).models[0];
 assert.equal(m.complete,true);assert.equal(m.kain.totalCost,2200000);assert.equal(m.kain.totalPcs,100);assert.equal(m.kain.perPcs,22000);assert.equal(m.hppTotal,25500);assert.equal(m.basis.ukuran,'XL');
 assert.deepEqual(m.sizes,['L','M','XL']);assert.deepEqual(m.kain.observasi.sizes,[{size:'XL',jumlah:100}]);
 assert.deepEqual(m.kain.observasi.qtyByUnit,{kg:25});assert.deepEqual(m.kain.observasi.yieldByUnit,{kg:4});
 assert.equal(m.kain.observasi.fullRollCount,1);assert.equal(m.kain.observasi.pcsPerFullRoll,100);assert.equal(m.kain.observasi.rolls[0].harga,88000);assert.equal(m.kain.observasi.rolls[0].totalCost,2200000);assert.equal(m.kain.observasi.rollGroups[0].totalCost,2200000);
 assert.equal(m.kain.details[0].priceSource,'koreksi-harga-rol');assert.equal(JSON.stringify(input),before);
});

test('multiple XL results use total material cost / total output, not equal averaging of per-cut rates or M/L output',()=>{
 const input=fixture();correction(input);input.tables.StokBahan.push({id:'roll2',jenis:'beli',bahan:'Cotton',satuan:'kg',qty:25,harga:88000,total:2200000,stockMode:'roll',rol:1});
 input.tables.Potong.push({id:'cut2',poId:'po1',total:50,ukuran:{XL:50},tarif:500,bahanList:[{nama:'Cotton',satuan:'kg',qty:25}],alokasiBahan:[{stokId:'roll2',qty:25}]});
 input.tables.Potong.push({id:'other-size',poId:'po1',total:500,ukuran:{M:250,L:250},tarif:1,bahanList:[{nama:'Cotton',satuan:'kg',qty:1}]});
 const m=run(input).models[0];assert.equal(m.kain.totalPcs,150);assert.equal(m.kain.totalCost,4400000);assert.equal(m.kain.perPcs,4400000/150);assert.notEqual(m.kain.perPcs,(22000+44000)/2);
 assert.equal(m.kain.observasi.fullRollCount,2);assert.equal(m.kain.observasi.pcsPerFullRoll,75);assert.deepEqual(m.kain.observasi.sizes,[{size:'XL',jumlah:150}]);
});

test('rinci inherited and corrected prices affect linked cuts but never add a second purchase weight to average',()=>{
 const input=fixture();input.tables.StokBahan=[{id:'opening',jenis:'beli',bahan:'Cotton',qty:50,satuan:'kg',harga:60000,total:3000000},{id:'roll1',jenis:'rinci',bahan:'Cotton',satuan:'kg',qty:25,harga:0,total:0,stockMode:'roll',rol:1}];
 let m=run(input).models[0];assert.equal(m.kain.totalCost,1500000);
 correction(input);m=run(input).models[0];assert.equal(m.kain.totalCost,2200000);
 input.tables.Potong[0].alokasiBahan=[];m=run(input).models[0];assert.equal(m.kain.totalCost,1850000,'50kg pool averages 25kg@60000 and corrected25kg@88000, not 75kg');
});

test('an unpriced or contradictory pool cannot supply a valid inherited rinci cost',()=>{
 for(const bad of [{id:'opening',jenis:'beli',bahan:'Cotton',qty:50,satuan:'kg',harga:0,total:0},{id:'opening',jenis:'beli',bahan:'Cotton',qty:50,satuan:'kg',harga:60000,total:1}]){
  const input=fixture();input.tables.StokBahan=[bad,{id:'roll1',jenis:'rinci',bahan:'Cotton',qty:25,satuan:'kg',harga:0,total:0,stockMode:'roll'}];assert.equal(run(input).models[0].hppTotal,null);
  correction(input);assert.equal(run(input).models[0].kain.totalCost,2200000,'owner price applies to the specifically corrected roll');
 }
});

test('legacy receipt correction follows stable source ID, material and unit and preserves the original snapshot',()=>{
 const input=fixture();input.tables.Potong=[];input.tables.StokBahan[0].asal='lama';
 input.legacy={production:[{id:'old-xl',series:'Fixture',namaBarang:'Shirt',size:'XL',potong:[{id:'oldcut',tanggal:'2026-08-01',jumlah:100,tarif:500,bahanList:[{jenis:'Cotton',kg:25,unit:'kg'}],rols:[{purchaseId:'roll1',jenis:'Cotton',kg:25,unit:'kg'}]}]}],stock:{pembelian:[{id:'roll1',jenisBahan:'Cotton',kg:25,unit:'kg',hargaPerKg:0,total:0,rol:1}]},cuttingPlans:[]};
 assert.equal(run(input).models[0].hppTotal,null);correction(input);const before=JSON.stringify(input),m=run(input).models[0];assert.equal(m.kain.totalCost,2200000);assert.equal(m.kain.perPcs,22000);assert.equal(JSON.stringify(input),before);
 input.tables.StokBahan[0].bahan='Different fabric';assert.equal(run(input).models[0].hppTotal,null,'matching source ID alone is insufficient');
 input.tables.StokBahan[0].bahan='Cotton';input.tables.StokBahan[0].satuan='yd';assert.equal(run(input).models[0].hppTotal,null,'different source unit cannot transfer price');
});

test('partial or unlinked rolls show used weight and yield but never claim a full-roll output',()=>{
 const input=fixture();correction(input);input.tables.Potong[0].bahanList[0].qty=10;input.tables.Potong[0].alokasiBahan[0].qty=10;input.tables.Potong[0].total=40;input.tables.Potong[0].ukuran={XL:40};
 let m=run(input).models[0];assert.equal(m.kain.observasi.verifiedRollCount,1);assert.equal(m.kain.observasi.totalKg,10);assert.equal(m.kain.observasi.fullRollCount,0);assert.equal(m.kain.observasi.pcsPerFullRoll,null);assert.deepEqual(m.kain.observasi.yieldByUnit,{kg:4});
 input.tables.Potong[0].alokasiBahan=[];m=run(input).models[0];assert.equal(m.kain.observasi.verifiedRollCount,0);assert.equal(m.kain.observasi.pcsPerFullRoll,null);
});

test('mixed units and shared fabric never fabricate XL-only cost or a per-roll attribution',()=>{
 const input=fixture();correction(input);input.tables.StokBahan.push({id:'lining',jenis:'beli',bahan:'Lining',qty:10,satuan:'meter',harga:10000,total:100000});
 input.tables.Potong[0].bahanList.push({nama:'Lining',satuan:'meter',qty:10});input.tables.Potong[0].ukuran={M:30,L:30,XL:40};
 const m=run(input).models[0];assert.equal(m.basis.ukuran,undefined);assert.equal(m.kain.totalPcs,100);assert.equal(m.kain.perPcs,23000);assert.equal(m.kain.observasi.provisional,true);assert.deepEqual(m.kain.observasi.qtyByUnit,{kg:25,meter:10});assert.deepEqual(m.kain.observasi.yieldByUnit,{});assert.equal(m.kain.observasi.pcsPerFullRoll,null);assert.match(m.kain.observasi.notes.join(' '),/tanpa menebak/);
});

test('continuing output shares first material once and incomplete future production stays explicitly provisional',()=>{
 const input=fixture();correction(input);input.tables.Potong.push({id:'later',poId:'po1',total:50,ukuran:{L:50},tarif:500,asal:'lanjut'});
 input.tables.RencanaPotong=[{id:'future',poId:'po1',status:'siap',bahanList:[{nama:'Cotton',qty:5}]}];
 const m=run(input).models[0];assert.equal(m.kain.totalPcs,150);assert.equal(m.kain.totalCost,2200000);assert.equal(m.kain.observasi.totalKg,25);assert.deepEqual(m.kain.observasi.sizes,[{size:'L',jumlah:50},{size:'XL',jumlah:100}]);assert.equal(m.kain.observasi.provisional,true);assert.match(m.kain.observasi.notes.join(' '),/disiapkan/);
});

test('one roll consumed by another model cannot be counted as an isolated full-roll output',()=>{
 const input=fixture();correction(input);input.tables.PO.push({id:'po2',series:'Fixture',nama:'Other'});input.tables.Potong.push({id:'other',poId:'po2',total:1,ukuran:{XL:1},tarif:500,bahanList:[{nama:'Cotton',satuan:'kg',qty:1}],alokasiBahan:[{stokId:'roll1',qty:1}]});
 const m=run(input).models.find(m=>m.nama==='Shirt');assert.equal(m.kain.observasi.fullRollCount,0);assert.equal(m.kain.observasi.pcsPerFullRoll,null);
});

test('two sleeve rolls and one body roll in one M/L/XL batch contribute material cost once without pretending the batch is XL-only',()=>{
 const input=fixture();input.tables.StokBahan=[
  {id:'sleeve1',jenis:'beli',bahan:'Sleeve',satuan:'kg',qty:10,harga:60000,total:600000,stockMode:'roll',rol:1},
  {id:'sleeve2',jenis:'beli',bahan:'Sleeve',satuan:'kg',qty:12,harga:60000,total:720000,stockMode:'roll',rol:1},
  {id:'body1',jenis:'beli',bahan:'Body',satuan:'kg',qty:25,harga:88000,total:2200000,stockMode:'roll',rol:1}];
 input.tables.Potong[0]={id:'three-roll-batch',poId:'po1',total:100,ukuran:{M:30,L:30,XL:40},tarif:500,bahanList:[{nama:'Sleeve',satuan:'kg',qty:22},{nama:'Body',satuan:'kg',qty:25}],alokasiBahan:[{stokId:'sleeve1',qty:10},{stokId:'sleeve2',qty:12},{stokId:'body1',qty:25}]};
 const m=run(input).models[0];assert.equal(m.kain.totalCost,3520000);assert.equal(m.kain.totalPcs,100);assert.equal(m.kain.perPcs,35200);assert.notEqual(m.kain.perPcs,3520000/40);assert.equal(m.basis.ukuran,undefined);assert.equal(m.kain.observasi.provisional,true);assert.equal(m.kain.observasi.verifiedRollCount,3);assert.equal(m.kain.observasi.pcsPerFullRoll,null);assert.deepEqual(m.kain.observasi.sizes,[{size:'L',jumlah:30},{size:'M',jumlah:30},{size:'XL',jumlah:40}]);assert.match(m.kain.observasi.notes.join(' '),/dipakai bersama/);
});

test('isolated legacy XL cuts and native XL cuts share one weighted model basis, while independent M cuts do not change it',()=>{
 const input=fixture();correction(input);
 input.legacy={production:[{id:'old-xl',series:'Fixture',namaBarang:'Shirt',size:'XL',potong:[{id:'legacyXL',tanggal:'2026-08-01',jumlah:50,tarif:500,bahanList:[{jenis:'Cotton',kg:25,unit:'kg'}],rols:[{purchaseId:'legacyroll',jenis:'Cotton',kg:25,unit:'kg'}]}]},{id:'old-m',series:'Fixture',namaBarang:'Shirt',size:'M',potong:[{id:'legacyM',tanggal:'2026-08-01',jumlah:200,tarif:500,bahanList:[{jenis:'Cotton',kg:25,unit:'kg'}],rols:[{purchaseId:'legacyMroll',jenis:'Cotton',kg:25,unit:'kg'}]}]}],stock:{pembelian:[{id:'legacyroll',jenisBahan:'Cotton',kg:25,unit:'kg',hargaPerKg:88000,total:2200000,rol:1},{id:'legacyMroll',jenisBahan:'Cotton',kg:25,unit:'kg',hargaPerKg:88000,total:2200000,rol:1}]},cuttingPlans:[]};
 let m=run(input).models[0];assert.equal(m.basis.ukuran,'XL');assert.equal(m.kain.totalCost,4400000);assert.equal(m.kain.totalPcs,150);assert.equal(m.kain.perPcs,4400000/150);assert.deepEqual(m.kain.observasi.sizes,[{size:'XL',jumlah:150}]);assert.deepEqual(m.basis.origins,{legacy:50,native:100});
 input.tables.Potong=[];m=run(input).models[0];assert.equal(m.basis.ukuran,'XL');assert.equal(m.kain.totalPcs,50);assert.equal(m.kain.perPcs,44000);
});

test('legacy shared material batches spanning XL and M stay together and are labeled provisional instead of charging the whole cloth to XL',()=>{
 const input=fixture();input.tables.Potong=[];
 input.legacy={production:[{id:'old-xl',series:'Fixture',namaBarang:'Shirt',size:'XL',potong:[{id:'legacyXL',tanggal:'2026-08-01',jumlah:50,tarif:500,materialBatchId:'shared',bahanList:[{jenis:'Cotton',kg:25,unit:'kg'}],rols:[{purchaseId:'legacyroll',jenis:'Cotton',kg:25,unit:'kg'}]}]},{id:'old-m',series:'Fixture',namaBarang:'Shirt',size:'M',potong:[{id:'legacyM',tanggal:'2026-08-02',jumlah:150,tarif:500,materialBatchId:'shared',materialAllocation:'owner-plan-recorded-earlier'}]}],stock:{pembelian:[{id:'legacyroll',jenisBahan:'Cotton',kg:25,unit:'kg',hargaPerKg:88000,total:2200000,rol:1}]},cuttingPlans:[]};
 const m=run(input).models[0];assert.equal(m.basis.ukuran,undefined);assert.equal(m.kain.totalPcs,200);assert.equal(m.kain.totalCost,2200000);assert.equal(m.kain.perPcs,11000);assert.equal(m.kain.observasi.provisional,true);assert.match(m.kain.observasi.notes.join(' '),/Belum ada acuan bahan khusus XL/);
 assert.equal(m.configured,false);assert.deepEqual(m.prices,{});
});

test('explicit size assignments isolate XL only when every mixed-batch material is accounted for',()=>{
 const input=fixture();correction(input);input.tables.StokBahan.push({id:'rollM',jenis:'beli',bahan:'Cotton',satuan:'kg',qty:15,harga:88000,total:1320000,stockMode:'roll'});
 input.tables.Potong[0].ukuran={M:60,XL:100};input.tables.Potong[0].total=160;input.tables.Potong[0].bahanList[0].qty=40;input.tables.Potong[0].alokasiBahan=[{stokId:'roll1',qty:25,ukuran:'XL'},{stokId:'rollM',qty:15,ukuran:'M'}];
 let m=run(input).models[0];assert.equal(m.basis.ukuran,'XL');assert.equal(m.complete,true);assert.equal(m.kain.totalCost,2200000);assert.equal(m.kain.totalPcs,100);assert.equal(m.kain.perPcs,22000);assert.deepEqual(m.kain.observasi.sizes,[{size:'XL',jumlah:100}]);
 delete input.tables.Potong[0].alokasiBahan[1].ukuran;m=run(input).models[0];assert.equal(m.basis.ukuran,undefined);assert.equal(m.complete,false);assert.equal(m.kain.totalPcs,160);assert.equal(m.kain.totalCost,3520000);
 input.tables.Potong[0].alokasiBahan[1].ukuran='M';input.tables.Potong[0].bahanList[0].qty=41;m=run(input).models[0];assert.equal(m.basis.ukuran,undefined);assert.equal(m.complete,false);
});

test('legacy correction respects declared yard units when the old receipt has no unit field',()=>{
 const input=fixture();input.tables.Potong=[];correction(input);
 input.legacy={production:[{id:'old-xl',series:'Fixture',namaBarang:'Shirt',size:'XL',potong:[{id:'oldcut',tanggal:'2026-08-01',jumlah:100,tarif:500,bahanList:[{jenis:'Cotton',kg:25}],rols:[{purchaseId:'roll1',jenis:'Cotton',kg:25}]}]}],stock:{pembelian:[{id:'roll1',jenisBahan:'Cotton',kg:25,hargaPerKg:0,total:0,rol:1}],rolInfo:{cotton:{unit:'yard'}}},cuttingPlans:[]};
 assert.equal(run(input).models[0].hppTotal,null,'kg correction cannot silently price a yard receipt');
});

test('XL-only continuation results join the original fabric once in the XL weighted denominator',()=>{
 const input=fixture();correction(input);input.tables.Potong.push({id:'continuedXL',poId:'po1',total:50,ukuran:{XL:50},tarif:500,asal:'lanjut'});
 const m=run(input).models[0];assert.equal(m.basis.ukuran,'XL');assert.equal(m.complete,true);assert.equal(m.kain.totalPcs,150);assert.equal(m.kain.totalCost,2200000);assert.equal(m.kain.perPcs,2200000/150);assert.equal(m.kain.observasi.totalKg,25);assert.equal(m.kain.observasi.pcsPerFullRoll,150);
});
