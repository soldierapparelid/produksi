'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/commerce-hpp.js'),'utf8'),context);
const modelId=vm.runInContext("coreCommerceLegacyCost.modelId('Fixture','Shirt')",context);
function run(input){context.input=JSON.stringify(input);return JSON.parse(vm.runInContext('JSON.stringify(coreCommerceHpp(JSON.parse(input)))',context));}
function fixture(){return {config:{modelConfigs:{[modelId]:{jahitMode:'auto',hargaJahit:0,biayaLain:100,targetMargin:20,costSchema:2,costsReviewed:true}},marketplace:{shop:{fee:0,fixedPerPcs:0}},pajak:0},tables:{
 PO:[{id:'po1',noPO:'FIXTURE-1',series:'Fixture',nama:'Shirt',ukuranAktif:['XL']}],
 Potong:[{id:'cutXL',poId:'po1',total:10,ukuran:{XL:10},tarif:500,bahanList:[{nama:'Cotton',qty:2,satuan:'kg'}],alokasiBahan:[{stokId:'roll1',qty:2}]}],
 SlipKirim:[{id:'sendXL',poId:'po1',total:10,upah:1000}],
 StokBahan:[{id:'roll1',jenis:'beli',bahan:'Cotton',qty:2,satuan:'kg',harga:20000,total:40000,stockMode:'roll'}]
 }};}
function opening(input,size='M'){
 input.tables.Potong.push({id:'openingCut',poId:'po1',asal:'koreksi-ukuran',total:30,ukuran:{[size]:30},tarif:'',bahanList:'',alokasiBahan:''});
 input.tables.SlipKirim.push({id:'openingSend',poId:'po1',asal:'koreksi-ukuran',total:30,ukuran:{[size]:30},upah:''});
}

test('restored opening size preserves real XL fabric, cutting, sewing and roll yield averages',()=>{
 const input=fixture(),before=run(input).models[0];opening(input);const source=JSON.stringify(input),after=run(input).models[0];
 assert.equal(after.configured,true);assert.deepEqual(after.kain,before.kain);assert.deepEqual(after.potong,before.potong);assert.deepEqual(after.jahit,before.jahit);
 assert.equal(after.hppTotal,before.hppTotal);assert.deepEqual(after.prices,before.prices);assert.deepEqual(after.sizes,['M','XL']);
 assert.equal(after.warnings.filter(w=>/keterangan owner/.test(w)).length,1);assert.match(after.warnings.join(' '),/FIXTURE-1.*belum diketahui.*tidak menjadi acuan/);
 assert.equal(JSON.stringify(input),source);
});

test('an opening XL quantity is never accepted as an isolated XL cost sample',()=>{
 const input=fixture();input.tables.Potong[0].ukuran={L:10};input.tables.PO[0].ukuranAktif=['L'];opening(input,'XL');
 const model=run(input).models[0];assert.equal(model.basis.ukuran,undefined);assert.equal(model.kain.totalPcs,10);assert.equal(model.kain.totalCost,40000);
 assert.equal(model.potong.perPcs,500);assert.equal(model.jahit.perPcs,1000);assert.equal(model.configured,false);assert.deepEqual(model.prices,{});
});

test('opening quantities alone keep unknown costs incomplete instead of becoming free production',()=>{
 const input=fixture();input.tables.Potong=[];input.tables.SlipKirim=[];opening(input,'XL');
 const model=run(input).models[0];assert.equal(model.kain.totalPcs,0);assert.equal(model.potong.totalPcs,0);assert.equal(model.jahit.totalPcs,0);
 assert.equal(model.kain.perPcs,null);assert.equal(model.potong.perPcs,null);assert.equal(model.jahit.perPcs,null);assert.equal(model.hppTotal,null);assert.equal(model.configured,false);
 assert.match(model.warnings.join(' '),/belum diketahui/);assert.deepEqual(model.prices,{});
});

test('owner opening costs never dilute a genuine legacy XL reference',()=>{
 const input=fixture();input.tables.Potong=[];input.tables.SlipKirim=[];input.config.modelConfigs[modelId].jahitMode='manual';input.config.modelConfigs[modelId].hargaJahit=1200;
 input.legacy={production:[{id:'skuXL',series:'Fixture',namaBarang:'Shirt',size:'XL',potong:[{id:'oldCut',jumlah:10,tarif:500,bahanList:[{jenis:'Cotton',kg:2,unit:'kg'}],rols:[{purchaseId:'oldBuy',jenis:'Cotton',kg:2,unit:'kg'}]}]}],stock:{pembelian:[{id:'oldBuy',jenisBahan:'Cotton',kg:2,rol:1,hargaPerKg:20000,total:40000,unit:'kg'}]},cuttingPlans:[]};
 const before=run(input).models[0];opening(input);const after=run(input).models[0];
 assert.equal(before.configured,true);assert.equal(after.configured,true);assert.deepEqual(after.kain,before.kain);assert.deepEqual(after.potong,before.potong);assert.equal(after.hppTotal,before.hppTotal);
 assert.deepEqual(after.basis.origins,{legacy:10,native:0});assert.match(after.warnings.join(' '),/keterangan owner/);
});

test('opening warning stays scoped to its model and a dispatch is not a real sewing tariff',()=>{
 const input=fixture();input.tables.PO.push({id:'po2',series:'Fixture',nama:'Other shirt'});
 input.tables.SlipKirim.push({id:'openingSend',poId:'po2',asal:'koreksi-ukuran',total:30,ukuran:{M:30},upah:0});
 const models=run(input).models,original=models.find(m=>m.id===modelId),other=models.find(m=>m.id!==modelId);
 assert.equal(original.configured,true);assert.doesNotMatch(original.warnings.join(' '),/keterangan owner/);
 assert.equal(other.jahit.totalPcs,0);assert.equal(other.jahit.perPcs,null);assert.match(other.warnings.join(' '),/keterangan owner/);assert.deepEqual(other.sizes,['M']);
});
