'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/commerce-hpp.js'),'utf8'),context);
function calculate(input){context.input=JSON.stringify(input);return JSON.parse(JSON.stringify(vm.runInContext('coreCommerceHpp(JSON.parse(input)).models[0]',context)));}
function fixture(){return {legacy:{production:[
  {id:'oldM',series:'Fixture',namaBarang:'Child set',size:'M',potong:[]},
  {id:'oldXL',series:'Fixture',namaBarang:'Child set',size:'XL',potong:[]}
 ]},tables:{
  PO:[{id:'po1',series:'Fixture',nama:'Child set',produkId:'product1',ukuran:{M:11,XL:9}}],
  Produk:[{id:'product1',tarifJahit:1700}],
  Potong:[{id:'cut1',poId:'po1',total:20,ukuran:{M:11,XL:9},tarif:500,bahanList:[{nama:'Cotton',qty:5,satuan:'kg'}],alokasiBahan:[{stokId:'roll1',qty:5}]}],
  StokBahan:[{id:'roll1',jenis:'beli',bahan:'Cotton',qty:5,satuan:'kg',harga:10000,total:50000,stockMode:'roll'}]
 }};}

test('catalog-only legacy rows cannot mark complete native cutting evidence missing',()=>{
  const input=fixture(),before=JSON.stringify(input),m=calculate(input);
  assert.equal(m.kain.complete,true);assert.equal(m.kain.totalPcs,20);assert.equal(m.kain.totalCost,50000);assert.equal(m.kain.perPcs,2500);
  assert.equal(m.potong.complete,true);assert.equal(m.potong.totalPcs,20);assert.equal(m.potong.perPcs,500);
  assert.equal(m.hargaJahit,1700);assert.equal(m.jahit.source,'Perkiraan tarif jahit saat ini');assert.equal(m.hppTotal,4700);
  assert.deepEqual(m.kain.observasi.sizes,[{size:'M',jumlah:11},{size:'XL',jumlah:9}]);
  assert.deepEqual(m.basis.origins,{legacy:0,native:20});
  assert.doesNotMatch(m.warnings.join(' '),/Belum ada jumlah hasil potong|Belum ada biaya kain|Belum ada hasil potong untuk menghitung rata-rata upah|Tarif jahit belum tersedia/);
  assert.equal(m.configured,false,'mixed cloth is still only a provisional reference');
  assert.match(m.warnings.join(' '),/Belum ada hasil XL dengan bahan terpisah/);
  assert.equal(JSON.stringify(input),before,'costing never repairs production or stock by mutation');
});

test('native XL evidence with empty legacy catalog can be reviewed and recommended',()=>{
  const input=fixture();input.tables.Potong[0].ukuran={XL:20};
  const id=calculate(input).id;input.config={modelConfigs:{[id]:{jahitMode:'auto',hargaJahit:0,biayaLain:100,targetMargin:30,costSchema:2,costsReviewed:true}}};
  const m=calculate(input);assert.equal(m.basis.ukuran,'XL');assert.equal(m.configured,true);assert.equal(m.hppTotal,4800);
});

test('no cutting records in either source still has no HPP',()=>{
  const input=fixture();input.tables.Potong=[];
  const m=calculate(input);assert.equal(m.kain.complete,false);assert.equal(m.potong.complete,false);assert.equal(m.hppTotal,null);
  assert.equal(m.kain.totalPcs,0);assert.equal(m.kain.observasi.sizes.length,0);
  assert.match(m.warnings.join(' '),/Belum ada hasil potong/);
});

test('malformed legacy cutting ledgers are not mistaken for an empty catalog',()=>{
  for(const broken of ['unreadable',[false],[{id:'bad',jumlah:-1}]]){
    const input=fixture();input.legacy.production[0].potong=broken;
    const m=calculate(input);assert.equal(m.kain.complete,false);assert.equal(m.hppTotal,null);assert.equal(m.configured,false);
    assert.match(m.warnings.join(' '),/tidak terbaca lengkap|belum valid/);
  }
});

test('real legacy output with missing material still blocks combined native estimates',()=>{
  const input=fixture();input.legacy.production[0].potong=[{id:'oldcut',jumlah:3,tarif:500}];
  const m=calculate(input);assert.equal(m.kain.totalPcs,23);assert.equal(m.kain.complete,false);assert.equal(m.hppTotal,null);
  assert.match(m.warnings.join(' '),/Ada hasil potong tanpa rincian bahan/);
});

test('legacy sewing evidence retains precedence and invalid evidence cannot become the native rate',()=>{
  const input=fixture();input.legacy.workers=[{id:'worker',tarif:{'Fixture|Child set':2300}}];
  let m=calculate(input);assert.equal(m.hargaJahit,2300);assert.equal(m.jahit.source,'Tarif jahit saat ini');
  delete input.legacy.workers;input.legacy.production[0].jahit=[{id:'oldsew',jumlah:4,tarif:2100}];
  m=calculate(input);assert.equal(m.hargaJahit,2100);assert.equal(m.jahit.totalPcs,4);
  input.legacy.production[0].jahit=[{id:'badsew',jumlah:4,tarif:-1}];
  m=calculate(input);assert.equal(m.hargaJahit,null);assert.match(m.warnings.join(' '),/Tarif atau jumlah pada riwayat jahit/);
  delete input.legacy.production[0].jahit;input.legacy.production[0].assignJahit=[{id:'badassign',qty:-2,tukangId:'worker'}];
  m=calculate(input);assert.equal(m.hargaJahit,null);assert.match(m.warnings.join(' '),/Jumlah penugasan jahit belum valid/);
});

test('native recorded assignments remain weighted and are not replaced by an empty legacy catalog',()=>{
  const input=fixture();input.tables.SlipKirim=[{id:'send1',poId:'po1',total:6,upah:2000},{id:'send2',poId:'po1',total:14,upah:3000}];
  const m=calculate(input);assert.equal(m.hargaJahit,2700);assert.equal(m.jahit.totalPcs,20);assert.equal(m.jahit.totalCost,54000);
  assert.equal(m.jahit.source,'Tarif jahit tercatat · rata-rata penugasan');
});

test('unreadable legacy sewing assignments cannot fall back to a native default rate',()=>{
  for(const broken of ['unreadable',[false],{broken:false},[[{qty:4}]]]){
    const input=fixture();input.legacy.production[0].assignJahit=broken;
    const m=calculate(input);assert.equal(m.hargaJahit,null);assert.equal(m.jahit.complete,false);assert.equal(m.jahit.hasEvidence,true);
    assert.equal(m.hppTotal,null);assert.equal(m.configured,false);
    assert.match(m.warnings.join(' '),/rincian penugasan jahit yang tidak terbaca lengkap/);
  }
});

function sewingFixture(rates=[0,2500]){
  const input=fixture();input.tables.Potong[0].ukuran={XL:20};
  input.tables.SlipKirim=rates.map((upah,i)=>({id:'send'+i,poId:'po1',maklonId:'worker1',total:i===0?6:14,upah}));
  return input;
}

test('unknown sewing rate follows unanimous recorded rate for the same PO and maklon without diluting HPP',()=>{
  for(const zero of [0,'0','',null,undefined]){
    const input=sewingFixture([zero,2500]),before=JSON.stringify(input),m=calculate(input);
    assert.equal(m.hargaJahit,2500);assert.equal(m.jahit.totalPcs,20);assert.equal(m.jahit.totalCost,50000);assert.equal(m.jahit.complete,true);
    assert.match(m.jahit.source,/tarif kosong mengikuti PO dan maklon yang sama/);
    assert.equal(m.jahit.details[0].source,'tarif-penugasan-po-maklon-sama');assert.equal(m.jahit.details[1].source,'tarif-tercatat');
    assert.equal(JSON.stringify(input),before,'costing never fills the saved assignment or changes wages');
  }
});

test('all unknown assignment rates stay unavailable even with a positive product default',()=>{
  const input=sewingFixture([0,0]),m=calculate(input);
  assert.equal(m.hargaJahit,null);assert.equal(m.jahit.complete,false);assert.equal(m.jahit.totalPcs,20);assert.equal(m.hppTotal,null);
  assert.match(m.warnings.join(' '),/belum ada tarif pasti untuk PO dan maklon yang sama/);
  input.tables.SlipKirim=[];input.tables.Produk[0].tarifJahit=0;input.settings={upahJahit:0};
  assert.equal(calculate(input).hargaJahit,null,'an automatic zero default is unavailable, not free sewing');
});

test('unknown assignment rates never borrow another PO, maklon or missing identity',()=>{
  for(const change of [{maklonId:'worker2'},{poId:'po2'},{maklonId:''}]){
    const input=sewingFixture();input.tables.PO.push({...input.tables.PO[0],id:'po2'});Object.assign(input.tables.SlipKirim[0],change);
    const m=calculate(input);assert.equal(m.hargaJahit,null);assert.equal(m.jahit.complete,false);
    assert.match(m.warnings.join(' '),/belum ada tarif pasti untuk PO dan maklon yang sama/);
  }
});

test('conflicting positive sewing rates cannot fill an unknown assignment',()=>{
  const input=sewingFixture();input.tables.SlipKirim.push({id:'send2',poId:'po1',maklonId:'worker1',total:5,upah:3000});
  const m=calculate(input);assert.equal(m.hargaJahit,null);assert.equal(m.jahit.totalPcs,25);assert.equal(m.hppTotal,null);
  assert.ok(m.warnings.join(' ').includes('tarif PO/maklon berbeda'));
});

test('invalid native assignment amounts and rates stay blocked even with legacy sewing evidence',()=>{
  for(const change of [{upah:-2},{upah:'bad'},{upah:false},{total:-1}]){
    const input=sewingFixture();input.legacy.workers=[{id:'legacyWorker',tarif:{'Fixture|Child set':2300}}];
    input.tables.SlipKirim=[Object.assign(input.tables.SlipKirim[0],change)];
    const m=calculate(input);assert.equal(m.hargaJahit,null);assert.equal(m.jahit.complete,false);assert.equal(m.hppTotal,null);
    assert.match(m.warnings.join(' '),/Jumlah atau tarif penugasan jahit belum lengkap/);
  }
});

test('an explicit reviewed manual zero sewing cost remains an owner choice',()=>{
  const input=sewingFixture([0,0]),id=calculate(input).id;
  input.config={modelConfigs:{[id]:{jahitMode:'manual',hargaJahit:0,biayaLain:100,targetMargin:30,costSchema:2,costsReviewed:true}}};
  const m=calculate(input);assert.equal(m.hargaJahit,0);assert.equal(m.hppTotal,3100);assert.equal(m.configured,true);
});
