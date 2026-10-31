'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/commerce-hpp.js'),'utf8'),context);
function calculate(input){context.input=JSON.stringify(input);return JSON.parse(JSON.stringify(vm.runInContext('coreCommerceHpp(JSON.parse(input)).models[0]',context)));}
function fixture(){return {tables:{
 PO:[{id:'po1',series:'Fixture',nama:'Shirt',produkId:'product1',ukuran:{XL:20}}],Produk:[{id:'product1',tarifJahit:1700}],
 Potong:[{id:'cut1',poId:'po1',total:20,ukuran:{XL:20},tarif:500,bahanList:[{nama:'Cotton',qty:5,satuan:'kg'}],alokasiBahan:[{stokId:'roll1',qty:5}]}],
 StokBahan:[{id:'roll1',jenis:'beli',bahan:'Cotton',qty:5,satuan:'kg',harga:10000,total:50000,stockMode:'roll'}],
 SlipKirim:[{id:'send1',poId:'po1',maklonId:'worker1',total:6,upah:0},{id:'send2',poId:'po1',maklonId:'worker1',total:14,upah:0}],
 SlipSetor:[{id:'receipt1',noSlip:'SS-FIXTURE-001',poId:'po1',maklonId:'worker1',total:5,ukuran:{XL:5},upah:2500,status:'diterima',diprosesOleh:'owner1',workflowVersion:2}]
}};}

test('accepted counted slip supplies unknown assignment rate without adding receipt pcs or changing stored wages',()=>{
 const input=fixture(),before=JSON.stringify(input),m=calculate(input);
 assert.equal(m.hargaJahit,2500);assert.equal(m.jahit.complete,true);assert.equal(m.jahit.totalPcs,20);assert.equal(m.jahit.totalCost,50000);
 assert.match(m.jahit.source,/slip hitung PO dan maklon yang sama/);
 assert.equal(m.jahit.details[0].source,'tarif-hitung-po-maklon-sama');
 assert.deepEqual(m.jahit.details[0].sourceReceipts,[{id:'receipt1',noSlip:'SS-FIXTURE-001'}]);
 assert.equal(JSON.stringify(input),before);
});

test('newly counted imported report can supply a rate but untouched imports and opening quantities cannot',()=>{
 const input=fixture();input.tables.SlipSetor[0].asal='lama';assert.equal(calculate(input).hargaJahit,2500);
 for(const change of [{workflowVersion:1},{diprosesOleh:''},{asal:'koreksi-ukuran'}]){
  const changed=fixture();Object.assign(changed.tables.SlipSetor[0],change);assert.equal(calculate(changed).hargaJahit,null);
 }
});

test('pending and rejected slips cannot supply a rate even if number and former price remain',()=>{
 for(const status of ['diajukan','ditolak','']){const input=fixture();input.tables.SlipSetor[0].status=status;const m=calculate(input);assert.equal(m.hargaJahit,null);assert.equal(m.jahit.complete,false);}
});

test('accepted slip rate is restricted to the same nonempty PO and maklon',()=>{
 for(const change of [{poId:'other'},{maklonId:'other'},{maklonId:''},{poId:''}]){
  const input=fixture();Object.assign(input.tables.SlipSetor[0],change);assert.equal(calculate(input).hargaJahit,null);
 }
});

test('malformed accepted counts and duplicate receipt ids hold the rate instead of filling unknown assignments',()=>{
 for(const change of [{total:6},{total:0,ukuran:{}},{total:-1},{ukuran:'unreadable'},{ukuran:{XL:-5}},{upah:0},{upah:-1},{upah:'bad'},{id:''},{noSlip:''}]){
  const input=fixture();Object.assign(input.tables.SlipSetor[0],change);const m=calculate(input);assert.equal(m.hargaJahit,null);assert.equal(m.hppTotal,null);
  assert.match(m.warnings.join(' '),/belum dapat dipastikan; periksa slip hitung/);
 }
 const input=fixture();input.tables.SlipSetor.push({...input.tables.SlipSetor[0],maklonId:'other'});
 assert.equal(calculate(input).hargaJahit,null);
});

test('conflicting accepted rates or assignment and accepted rates remain ambiguous',()=>{
 for(const mutate of [input=>{input.tables.SlipSetor.push({...input.tables.SlipSetor[0],id:'receipt2',noSlip:'SS-FIXTURE-002',upah:3000});},input=>{input.tables.SlipKirim[1].upah=3000;}]){
  const input=fixture();mutate(input);const m=calculate(input);assert.equal(m.hargaJahit,null);assert.equal(m.jahit.totalPcs,20);
  assert.ok(m.warnings.join(' ').includes('tarif PO/maklon berbeda'));
 }
});

test('positive recorded assignments retain their exact weighted cost despite a different counted rate',()=>{
 const input=fixture();input.tables.SlipKirim[0].upah=2000;input.tables.SlipKirim[1].upah=3000;
 const m=calculate(input);assert.equal(m.hargaJahit,2700);assert.equal(m.jahit.totalCost,54000);assert.equal(m.jahit.totalPcs,20);
 assert.equal(m.jahit.source,'Tarif jahit tercatat · rata-rata penugasan');
});

test('a validated receipt rate can coexist with weighted legacy sewing evidence without counting the receipt twice',()=>{
 const input=fixture();input.legacy={production:[{id:'old1',series:'Fixture',namaBarang:'Shirt',size:'M',potong:[],jahit:[{id:'oldSew',jumlah:10,tarif:2500}]}]};
 const m=calculate(input);assert.equal(m.hargaJahit,2500);assert.equal(m.jahit.totalCost,75000);assert.equal(m.jahit.totalPcs,30);
});
