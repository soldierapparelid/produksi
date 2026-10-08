'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const c=vm.createContext({});vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/commerce-hpp.js'),'utf8'),c);
function run(name,input){c.input=JSON.stringify(input);return JSON.parse(JSON.stringify(vm.runInContext(name+'(JSON.parse(input))',c)));}
function id(series='Fixture',name='Shirt'){return vm.runInContext('coreCommerceLegacyCost.modelId('+JSON.stringify(series)+','+JSON.stringify(name)+')',c);}
function config(extra={}){return {modelConfigs:{[id()]:{jahitMode:'manual',hargaJahit:2000,biayaLain:100,targetMargin:20,costSchema:2,costsReviewed:true,...extra}},marketplace:{shop:{fee:10,fixedPerPcs:500}},pajak:1};}
function legacyFixture(){return {config:config(),legacy:{production:[
 {id:'skuM',series:'Fixture',namaBarang:'Shirt',size:'M',potong:[{id:'cutM',tanggal:'2026-10-01',jumlah:10,tarif:500,bahanList:[{jenis:'Cotton',kg:2,unit:'kg'}],rols:[{purchaseId:'oldBuyA',jenis:'Cotton',kg:2,unit:'kg'}]}]},
 {id:'skuL',series:'Fixture',namaBarang:'Shirt',size:'L',potong:[{id:'cutL',tanggal:'2026-10-02',jumlah:20,tarif:1000,bahanList:[{jenis:'Cotton',kg:3,unit:'kg'}],rols:[{purchaseId:'oldBuyB',jenis:'Cotton',kg:3,unit:'kg'}]}]}
 ],stock:{pembelian:[{id:'oldBuyA',jenisBahan:'Cotton',kg:10,hargaPerKg:20000,total:200000,unit:'kg'},{id:'oldBuyB',jenisBahan:'Cotton',kg:10,hargaPerKg:30000,total:300000,unit:'kg'}]},cuttingPlans:[]},tables:{}};}
function nativeFixture(){return {config:config({jahitMode:'auto'}),tables:{
 PO:[{id:'po1',series:'Fixture',nama:'Shirt',ukuran:{},total:0,ukuranAktif:['M','L']}],
 Potong:[{id:'cut1',poId:'po1',tanggal:'2026-10-08',total:10,ukuran:{M:4,L:6},tarif:500,bahanList:[{nama:'Cotton',qty:5}],alokasiBahan:[{stokId:'buyA',qty:2}]}],
 StokBahan:[{id:'buyA',jenis:'beli',bahan:'Cotton',qty:10,satuan:'kg',harga:10000,total:100000,stockMode:'roll'},{id:'buyB',jenis:'beli',bahan:'Cotton',qty:10,satuan:'kg',harga:20000,total:200000}],
 SlipKirim:[{id:'send1',poId:'po1',total:10,upah:1000}],RencanaPotong:[]}};}
function approx(actual,expected){assert.ok(Math.abs(actual-expected)<1e-7,actual+' != '+expected);}

test('legacy model HPP retains per-roll cost, weighted cutting and reviewed config without mutations',()=>{
 const input=legacyFixture(),before=JSON.stringify(input),out=run('coreCommerceHpp',input),m=out.models[0];
 assert.equal(out.models.length,1);assert.equal(m.id,id());assert.equal(m.configured,true);assert.equal(m.kain.totalPcs,30);
 approx(m.kain.perPcs,130000/30);approx(m.potong.perPcs,25000/30);approx(m.hppTotal,130000/30+25000/30+2100);
 assert.deepEqual(m.sizes,['L','M']);assert.equal(m.prices.shop.valid,true);assert.equal(m.prices.shop.recommended,11300);
 assert.equal(JSON.stringify(input),before);assert.ok(!JSON.stringify(out).includes('includedEntries'));assert.ok(!Object.hasOwn(m,'members'));
});

test('new cuts join model HPP once; mirrored legacy cuts and purchases never double the source history',()=>{
 const input=legacyFixture();input.tables={PO:[{id:'po1',series:'Fixture',nama:'Shirt',asal:'lama',ukuran:{M:30,L:30}}],
 Potong:[{id:'mirrored',poId:'po1',asal:'lama',total:30,ukuran:{M:10,L:20},tarif:500,bahan:'Cotton',kg:5},
 {id:'newCut',poId:'po1',total:10,ukuran:{M:10},tarif:200,bahanList:[{nama:'Cotton',qty:1}],alokasiBahan:[{stokId:'newBuy',qty:1}]}],
 StokBahan:[{id:'newBuy',jenis:'beli',bahan:'Cotton',qty:5,satuan:'kg',harga:10000,total:50000},{id:'legacyMirror',jenis:'beli',asal:'lama',bahan:'Cotton',qty:100,satuan:'kg',harga:999,total:99900}]};
 const m=run('coreCommerceHpp',input).models[0];assert.equal(m.complete,true);assert.equal(m.kain.totalPcs,40);assert.equal(m.kain.totalCost,140000);assert.equal(m.potong.totalCost,27000);approx(m.hppTotal,6275);
 assert.deepEqual(m.basis.origins,{legacy:30,native:10});assert.deepEqual(m.poIds,['po1']);
});

test('mixed identified and aggregate material costs remain distinct without splitting cloth by output size',()=>{
 const m=run('coreCommerceHpp',nativeFixture()).models[0];assert.equal(m.complete,true);assert.equal(m.kain.totalPcs,10);assert.equal(m.kain.totalCost,65000);assert.equal(m.hppTotal,8100);
 assert.deepEqual(m.kain.details.map(d=>[d.qty,d.avgHarga,d.priceSource]),[[2,10000,'rol-pembelian'],[3,15000,'rata-rata-pembelian']]);
 assert.equal(m.jahit.source,'Tarif jahit tercatat · rata-rata penugasan');assert.deepEqual(m.sizes,['L','M']);
});

test('an explicit missing roll, mismatched material or inconsistent money never becomes a valid average fallback',()=>{
 for(const change of [i=>i.tables.Potong[0].alokasiBahan[0].stokId='missing',i=>i.tables.StokBahan[0].bahan='Other',i=>i.tables.StokBahan[0].total=1,i=>i.tables.Potong[0].alokasiBahan[0].qty=6]){
  const input=nativeFixture();change(input);const m=run('coreCommerceHpp',input).models[0];assert.equal(m.complete,false);assert.equal(m.hppTotal,null);assert.deepEqual(m.prices,{});assert.ok(m.warnings.length);
 }
});

test('legacy missing-material exclusion stays explicit and requires the original reviewed basis policy',()=>{
 const input=legacyFixture();input.legacy.production[0].potong.unshift({id:'oldIncomplete',tanggal:'2026-01-01',jumlah:7,tarif:500});
 let m=run('coreCommerceHpp',input).models[0];assert.equal(m.basis.allPcs,37);assert.equal(m.basis.excludedPcs,7);assert.equal(m.basis.includedPcs,30);assert.equal(m.complete,false);assert.deepEqual(m.prices,{});assert.ok(m.hppTotal>0);
 input.config.modelConfigs[id()].basisPolicy='complete-legacy-v1';m=run('coreCommerceHpp',input).models[0];assert.equal(m.complete,true);assert.equal(m.basis.excluded.length,1);
});

test('legacy per-size conflicts and cost-schema review remain unresolved until explicit model configuration',()=>{
 const input=legacyFixture();delete input.config.modelConfigs;input.config.configs={skuM:{hargaJahit:1000,biayaLain:100},skuL:{hargaJahit:2000,biayaLain:100}};
 let m=run('coreCommerceHpp',input).models[0];assert.equal(m.config.source,'legacy-conflict');assert.equal(m.configured,false);assert.deepEqual(m.prices,{});
 input.config.configs.skuL={...input.config.configs.skuM};m=run('coreCommerceHpp',input).models[0];assert.equal(m.config.source,'legacy-compatible');assert.equal(m.configured,false);assert.ok(m.hppTotal>0);
});

test('unavailable old source and an unresolved physical correction are visible evidence holds',()=>{
 const input=nativeFixture();input.tables.Potong[0].asal='lama';let m=run('coreCommerceHpp',input).models[0];assert.equal(m.complete,false);assert.match(m.warnings.join(' '),/Sumber asli/);
 delete input.tables.Potong[0].asal;input.tables.KoreksiRiwayat=[{id:'correction',poId:'po1'}];m=run('coreCommerceHpp',input).models[0];assert.equal(m.complete,false);assert.match(m.warnings.join(' '),/koreksi fisik/);
});

test('zero manual sewing and other costs are explicit choices; malformed/overflow quantities never form a recommendation',()=>{
 const input=nativeFixture();input.config=config({hargaJahit:0,biayaLain:0,targetMargin:0});let m=run('coreCommerceHpp',input).models[0];assert.equal(m.hppTotal,7000);assert.equal(m.complete,true);
 for(const value of [true,-1,1.5,Number.MAX_SAFE_INTEGER+1]){input.tables.Potong[0].total=value;m=run('coreCommerceHpp',input).models[0];assert.equal(m.complete,false);assert.equal(m.hppTotal,null);}
});

test('config validation preserves review semantics and rejects blank, negative, nonnumeric or unsafe costs',()=>{
 const good=config().modelConfigs[id()];assert.equal(run('coreCommerceHppConfig',good).costsReviewed,true);
 for(const change of [{costsReviewed:false},{costSchema:1},{jahitMode:'guess'},{hargaJahit:''},{biayaLain:true},{targetMargin:100},{biayaLain:-1},{biayaLain:Number.MAX_SAFE_INTEGER+1},{basisPolicy:'assume'},{hargaJual:{shop:-1}}])assert.throws(()=>run('coreCommerceHppConfig',{...good,...change}));
});

test('price quote uses margin on selling price, per-piece fixed cost, signed loss and safe rounding',()=>{
 let q=run('coreCommercePriceQuote',{hpp:20000,price:30000,margin:20,fee:10,tax:1,fixed:500});assert.equal(q.valid,true);assert.equal(q.recommended,29800);assert.equal(q.profit,6200);approx(q.marginActual,6200/30000*100);
 q=run('coreCommercePriceQuote',{hpp:20000,price:0,margin:0,fee:0,tax:0,fixed:500});assert.equal(q.profit,-20500);assert.equal(q.marginActual,null);
 assert.equal(run('coreCommercePriceQuote',{hpp:1,price:1,margin:90,fee:10,tax:0,fixed:0}).valid,false);
 assert.equal(run('coreCommercePriceTarget',{hpp:20000,profit:10000,fee:10,tax:0,fixed:500}).price,33900);
});

test('duplicate native source IDs cannot leave the first affected model apparently complete',()=>{
 const input=nativeFixture();input.tables.PO.push({...input.tables.PO[0],id:'po2',nama:'Other shirt'});input.tables.Potong.push({...input.tables.Potong[0],poId:'po2'});
 const models=run('coreCommerceHpp',input).models;assert.equal(models.length,2);models.forEach(m=>{assert.equal(m.complete,false);assert.match(m.warnings.join(' '),/ganda/);});
});

test('unsafe automatic sewing total and unrecognized stored mode cannot unlock a price quote',()=>{
 const input=nativeFixture();input.tables.SlipKirim[0].upah=Number.MAX_SAFE_INTEGER;
 let m=run('coreCommerceHpp',input).models[0];assert.equal(m.complete,false);assert.equal(m.hppTotal,null);assert.match(m.warnings.join(' '),/batas/);
 input.tables.SlipKirim[0].upah=1000;input.config.modelConfigs[id()].jahitMode='guess';m=run('coreCommerceHpp',input).models[0];assert.equal(m.complete,false);assert.match(m.warnings.join(' '),/tidak valid/);
});
