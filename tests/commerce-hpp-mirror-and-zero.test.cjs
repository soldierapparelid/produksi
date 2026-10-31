'use strict';
/* 1.5.67: an imported assignment that was moved is not counted twice, a zero cutting
   rate is unknown, a reject-only count is not damaged, and hidden mirrored cuts are named
   instead of being reported as no cut at all. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/commerce-hpp.js'),'utf8'),context);
function models(input){context.input=JSON.stringify(input);return JSON.parse(JSON.stringify(vm.runInContext('coreCommerceHpp(JSON.parse(input)).models',context)));}
function calculate(input,name='Shirt'){return models(input).find(m=>m.nama===name);}
const cut=(id,qty)=>({id,tanggal:'2026-08-01',jumlah:qty,tarif:500,jenisBahan:'Cotton',kiloan:qty/4});
const stock={pembelian:[{id:'buy1',jenisBahan:'Cotton',kg:1000,hargaPerKg:10000,total:10000000}],rolInfo:{}};

/* Legacy snapshot of 100 pcs with worker w1 at 2000, imported as PO po1 with one mirror row. */
function moved(){return {
 legacy:{production:[{id:'sku1',series:'Fixture',namaBarang:'Shirt',size:'L',potong:[cut('oldcut',100)],assignJahit:[{id:'a1',qty:100,tukangId:'w1'}]}],stock,workers:[{id:'w1',tarif:{'Fixture|Shirt':2000}},{id:'w2',tarif:{'Fixture|Shirt':3000}}],cuttingPlans:[]},
 tables:{PO:[{id:'po1',series:'Fixture',nama:'Shirt',produkId:'p1',asal:'lama',ukuran:{L:100}}],Produk:[{id:'p1'}],
  SlipKirim:[{id:'mirror1',poId:'po1',maklonId:'w1',total:100,upah:0,asal:'lama'}],Potong:[{id:'mirrorcut',poId:'po1',total:100,ukuran:{L:100},tarif:500,asal:'lama'}]}
};}
const sent=(id,maklonId,total,upah)=>({id,poId:'po1',maklonId,total,upah});

test('an imported assignment moved to another maklon counts only the live slip',()=>{
 const input=moved();input.tables.SlipKirim=[sent('new1','w2',100,3000)];
 const m=calculate(input);
 assert.equal(m.hargaJahit,3000);assert.equal(m.jahit.totalPcs,100);assert.equal(m.jahit.totalCost,300000);assert.equal(m.jahit.complete,true);
});

test('re-entering the same maklon at a corrected rate does not average the old rate in',()=>{
 const input=moved();input.tables.SlipKirim=[sent('new1','w1',100,2600)];
 const m=calculate(input);assert.equal(m.hargaJahit,2600);assert.equal(m.jahit.totalPcs,100);
});

test('a partial move keeps the pcs still mirrored and weighs them with the new slip',()=>{
 const input=moved();input.legacy.production[0].assignJahit=[{id:'a1',qty:60,tukangId:'w1'},{id:'a2',qty:40,tukangId:'w1'}];
 input.tables.SlipKirim=[{id:'mirror2',poId:'po1',maklonId:'w1',total:40,upah:0,asal:'lama'},sent('new1','w2',60,3000)];
 const m=calculate(input);assert.equal(m.jahit.totalPcs,100);assert.equal(m.hargaJahit,2600);assert.equal(m.jahit.totalCost,260000);
});

test('a same-rate move shows the true pcs and the same price',()=>{
 const input=moved();input.legacy.production[0].assignJahit=[{id:'a1',qty:60,tukangId:'w1'},{id:'a2',qty:40,tukangId:'w1'}];
 input.tables.SlipKirim=[{id:'mirror2',poId:'po1',maklonId:'w1',total:60,upah:0,asal:'lama'},sent('new1','w1',40,2000)];
 const m=calculate(input);assert.equal(m.jahit.totalPcs,100);assert.equal(m.hargaJahit,2000);
});

test('intact mirrors plus genuinely new pcs still add up',()=>{
 const input=moved();input.tables.SlipKirim.push(sent('new1','w2',100,3000));
 const m=calculate(input);assert.equal(m.jahit.totalPcs,200);assert.equal(m.hargaJahit,2500);
});

test('without a native slip the snapshot stands even if a mirror is missing',()=>{
 const input=moved();input.tables.SlipKirim=[];
 const m=calculate(input);assert.equal(m.jahit.totalPcs,100);assert.equal(m.hargaJahit,2000);
});

test('a PO that was never imported keeps the old additive behaviour',()=>{
 const input=moved();delete input.tables.PO[0].asal;input.tables.SlipKirim=[sent('new1','w2',100,3000)];
 const m=calculate(input);assert.equal(m.jahit.totalPcs,200);assert.equal(m.hargaJahit,2500);
});

test('mirrors from an archived cycle do not stand in for the current cycle',()=>{
 const input=moved();input.tables.PO.push({id:'po0',series:'Fixture',nama:'Shirt',produkId:'p1',asal:'lama',ukuran:{L:100},imporSumber:JSON.stringify({skuId:'sku1',arsip:true})});
 input.tables.SlipKirim=[{id:'oldmirror',poId:'po0',maklonId:'w1',total:100,upah:0,asal:'lama'},sent('new1','w2',100,3000)];
 const m=calculate(input);assert.equal(m.jahit.totalPcs,100);assert.equal(m.hargaJahit,3000);
});

test('a missing rate only holds the model while its pcs are still live',()=>{
 const input=moved();input.legacy.workers=[{id:'w2',tarif:{}}];input.tables.SlipKirim=[sent('new1','w2',100,3000)];
 let m=calculate(input);assert.equal(m.hargaJahit,3000);assert.deepEqual(m.jahit.warnings,[]);
 const held=moved();held.legacy.workers=[{id:'w2',tarif:{}}];held.tables.SlipKirim.push(sent('new1','w2',100,3000));
 m=calculate(held);assert.equal(m.hargaJahit,null);assert.match(m.jahit.warnings.join(' '),/belum tersedia untuk semua penugasan/);
});

test('internal assignment rows never reach the page',()=>{
 const m=calculate(moved());assert.equal(m.jahit.assigned,undefined);
 const input=moved();input.tables.SlipKirim=[sent('new1','w2',100,3000)];assert.equal(calculate(input).jahit.assigned,undefined);
});

/* Native cut fixture: one XL batch priced from a purchased roll. */
function native(){return {tables:{
 PO:[{id:'po1',series:'Fixture',nama:'Shirt',produkId:'p1',ukuran:{XL:20}}],Produk:[{id:'p1',tarifJahit:1700}],
 Potong:[{id:'cut1',poId:'po1',total:20,ukuran:{XL:20},tarif:500,bahanList:[{nama:'Cotton',qty:5,satuan:'kg'}],alokasiBahan:[{stokId:'roll1',qty:5}]}],
 StokBahan:[{id:'roll1',jenis:'beli',bahan:'Cotton',qty:5,satuan:'kg',harga:10000,total:50000,stockMode:'roll'}],
 SlipKirim:[{id:'send1',poId:'po1',maklonId:'w1',total:20,upah:0}],
 SlipSetor:[{id:'receipt1',noSlip:'SS-1',poId:'po1',maklonId:'w1',total:5,ukuran:{XL:5},upah:2500,status:'diterima',diprosesOleh:'owner1',workflowVersion:2}]
}};}

test('a zero cutting rate is unknown and holds the model instead of free cutting',()=>{
 for(const tarif of [0,'0','']){
  const input=native();input.tables.Potong[0].tarif=tarif;const m=calculate(input);
  assert.equal(m.potong.complete,false);assert.equal(m.hppTotal,null);assert.match(m.warnings.join(' '),/Tarif potong cut1 belum tercatat/);
 }
 const m=calculate(native());assert.equal(m.potong.complete,true);assert.equal(m.potong.perPcs,500);
});

test('one unpriced batch cannot halve the cutting average',()=>{
 const input=native();input.tables.Potong.push({...input.tables.Potong[0],id:'cut2',tarif:0,alokasiBahan:[],bahanList:[{nama:'Cotton',qty:5,satuan:'kg'}]});
 const m=calculate(input);assert.equal(m.potong.complete,false);assert.equal(m.hppTotal,null);
});

test('a reject-only count keeps the rate the app already resolved',()=>{
 const input=native();input.tables.SlipSetor.push({id:'receipt2',noSlip:'SS-2',poId:'po1',maklonId:'w1',total:0,reject:5,ukuran:{},upah:2500,status:'diterima',diprosesOleh:'owner1',workflowVersion:2});
 const m=calculate(input);assert.equal(m.hargaJahit,2500);assert.equal(m.jahit.complete,true);assert.equal(m.jahit.totalPcs,20);
 assert.deepEqual(m.jahit.details[0].sourceReceipts,[{id:'receipt1',noSlip:'SS-1'}]);
});

test('a reject-only count alone proves no rate, and damaged ones still hold',()=>{
 const only=native();Object.assign(only.tables.SlipSetor[0],{total:0,reject:5,ukuran:{}});
 assert.equal(calculate(only).hargaJahit,null);
 for(const change of [{reject:0},{noSlip:''},{id:''}]){
  const input=native();input.tables.SlipSetor.push({id:'receipt2',noSlip:'SS-2',poId:'po1',maklonId:'w1',total:0,reject:5,ukuran:{},upah:2500,status:'diterima',diprosesOleh:'owner1',workflowVersion:2,...change});
  const m=calculate(input);assert.equal(m.hargaJahit,null);assert.match(m.warnings.join(' '),/belum dapat dipastikan; periksa slip hitung/);
 }
 const twin=native();const row={id:'receipt2',noSlip:'SS-2',poId:'po1',maklonId:'w1',total:0,reject:5,ukuran:{},upah:2500,status:'diterima',diprosesOleh:'owner1',workflowVersion:2};
 twin.tables.SlipSetor.push(row,{...row});assert.equal(calculate(twin).hargaJahit,null);
});

test('a mirrored cut stays out of the cost and the model says so instead of no cut',()=>{
 const input=moved();input.tables.PO.push({id:'po2',series:'Fixture',nama:'Pants',produkId:'p1',asal:'lama',ukuran:{L:30}});
 input.tables.Potong.push({id:'mirrorcut2',poId:'po2',total:30,ukuran:{L:30},tarif:900,asal:'lama',bahan:'Cotton',kg:7});
 const pants=calculate(input,'Pants');assert.equal(pants.potong.totalPcs,0);assert.equal(pants.hppTotal,null);
 assert.match(pants.warnings.join(' '),/Ada 30 pcs hasil potong impor/);assert.doesNotMatch(pants.warnings.join(' '),/Belum ada hasil potong/);
 const shirt=calculate(input);assert.equal(shirt.kain.totalPcs,100);assert.doesNotMatch(shirt.warnings.join(' '),/hasil potong impor/);
});

test('a catalog-only snapshot row names its hidden cut without blocking native evidence',()=>{
 const input=moved();input.legacy.production[0].potong=[];input.legacy.production[0].assignJahit=[];
 let m=calculate(input);assert.match(m.warnings.join(' '),/Ada 100 pcs hasil potong impor/);assert.equal(m.sourceWarnings.length,0);
 input.tables.Potong.push({id:'cut9',poId:'po1',total:20,ukuran:{XL:20},tarif:500,bahanList:[{nama:'Cotton',qty:5,satuan:'kg'}],alokasiBahan:[{stokId:'roll1',qty:5}]});
 input.tables.StokBahan=[{id:'roll1',jenis:'beli',bahan:'Cotton',qty:5,satuan:'kg',harga:10000,total:50000,stockMode:'roll'}];
 m=calculate(input);assert.equal(m.potong.totalPcs,20);assert.equal(m.potong.perPcs,500);assert.equal(m.sourceWarnings.length,0);
});

test('a renamed imported PO does not double the sewing it left behind',()=>{
 const input=moved();input.tables.PO[0].nama='Shirt Baru';
 const all=models(input),renamed=all.find(m=>m.nama==='Shirt Baru'),old=all.find(m=>m.nama==='Shirt');
 assert.equal(renamed.jahit.totalPcs,0);assert.equal(old.jahit.totalPcs,100);assert.match(renamed.warnings.join(' '),/hasil potong impor/);
});

test('a snapshot with sewing reports but no assignments keeps hiding imported slips',()=>{
 const input=moved();delete input.legacy.production[0].assignJahit;input.legacy.production[0].jahit=[{id:'s1',jumlah:100,tarif:2000}];input.legacy.workers=[];
 const m=calculate(input);assert.equal(m.jahit.totalPcs,100);assert.equal(m.hargaJahit,2000);
});

test('a mirror under another worker still covers the pcs: nothing was moved',()=>{
 const input=moved();input.tables.SlipKirim=[{id:'mirror1',poId:'po1',maklonId:'w2',total:100,upah:0,asal:'lama'},sent('new1','w2',100,3000)];
 const m=calculate(input);assert.equal(m.jahit.totalPcs,200);assert.equal(m.hargaJahit,2500);
});

test('a full move keeps any other snapshot warning on the model',()=>{
 const input=moved();input.legacy.production[0].assignJahit.push({id:'bad',qty:'',tukangId:'w1'});input.tables.SlipKirim=[sent('new1','w2',100,3000)];
 const m=calculate(input);assert.equal(m.hargaJahit,null);assert.match(m.jahit.warnings.join(' '),/Jumlah penugasan jahit belum valid/);
});

test('mirrors match by worker and size so the moved size is the one dropped',()=>{
 const input=moved();input.legacy.production=[{...input.legacy.production[0],assignJahit:[{id:'a1',qty:100,tukangId:'w1'}]},{id:'sku2',series:'Fixture',namaBarang:'SHIRT',size:'XL',potong:[],assignJahit:[{id:'a2',qty:100,tukangId:'w1'}]}];
 input.legacy.workers=[{id:'w1',tarif:{'Fixture|Shirt':2000,'Fixture|SHIRT':4000}},{id:'w2',tarif:{}}];
 input.tables.SlipKirim=[{id:'mirror2',poId:'po1',maklonId:'w1',ukuran:{XL:100},total:100,upah:0,asal:'lama'},sent('new1','w2',100,4000)];
 const m=calculate(input);assert.equal(m.jahit.totalPcs,200);assert.equal(m.hargaJahit,4000);
});

test('an archive cycle marked only by its note does not stand in for a moved assignment',()=>{
 const input=moved();input.tables.PO.push({id:'po0',series:'Fixture',nama:'Shirt',produkId:'p1',asal:'lama',catatan:'Arsip Lama',ukuran:{L:100}});
 input.tables.SlipKirim=[{id:'oldmirror',poId:'po0',maklonId:'w1',total:100,upah:0,asal:'lama'},sent('new1','w2',100,3000)];
 const m=calculate(input);assert.equal(m.jahit.totalPcs,100);assert.equal(m.hargaJahit,3000);
});

test('a PO recovered by reconciliation counts as imported',()=>{
 const input=moved();delete input.tables.PO[0].asal;input.tables.PO[0].imporSumber=JSON.stringify({legacyReconciliation:{mode:'migrated'}});input.tables.SlipKirim=[sent('new1','w2',100,3000)];
 const m=calculate(input);assert.equal(m.jahit.totalPcs,100);assert.equal(m.hargaJahit,3000);
});

test('a zero total with counted sizes or bad reject figures is still damaged',()=>{
 const base={id:'receipt2',noSlip:'SS-2',poId:'po1',maklonId:'w1',total:0,reject:5,ukuran:{},upah:2500,status:'diterima',diprosesOleh:'owner1',workflowVersion:2};
 for(const change of [{ukuran:{XL:48},upah:3000},{ukuran:'rusak'},{ukuran:{XL:-1}},{reject:2.5},{rejectUkuran:{XL:4}},{rejectUkuran:'rusak'}]){
  const input=native();input.tables.SlipSetor.push({...base,...change});const m=calculate(input);
  assert.equal(m.hargaJahit,null,JSON.stringify(change));assert.match(m.warnings.join(' '),/belum dapat dipastikan; periksa slip hitung/);
 }
 for(const change of [{ukuran:{XL:0}},{rejectUkuran:{XL:5}},{ukuran:{XL:0},rejectUkuran:JSON.stringify({XL:2,L:3})}]){
  const input=native();input.tables.SlipSetor.push({...base,...change});assert.equal(calculate(input).hargaJahit,2500,JSON.stringify(change));
 }
});
