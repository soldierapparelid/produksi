'use strict';
/* 1.5.70: a model or group with no complete XL record can carry a manual cloth and cutting
   figure from offline notes. Data always wins, and takes over by itself once it is complete. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const c=vm.createContext({});for(const name of ['core','reconcile-legacy','commerce-hpp'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/'+name+'.js'),'utf8'),c);
const modelId=vm.runInContext("coreCommerceLegacyCost.modelId('Fixture','Kaos')",c),groupId='hppg_kaos';
const roll=(id,bahan,harga)=>({id,jenis:'beli',bahan,qty:25,satuan:'kg',harga,total:25*harga,stockMode:'roll'});
const cost=(extra={})=>({jahitMode:'manual',hargaJahit:2000,biayaLain:3000,targetMargin:30,costSchema:2,costsReviewed:true,...extra});
function bare(){return {config:{marketplace:{shop:{fee:10,fixedPerPcs:0}},pajak:0},tables:{PO:[{id:'po1',series:'Fixture',nama:'Kaos',status:'aktif',produkId:'p1'}],Produk:[{id:'p1',tarifJahit:2000}],Potong:[],RencanaPotong:[],StokBahan:[]}};}
function cut(input){
 const list=[{stokId:'a',qty:25,ukuran:'XL'},{stokId:'b',qty:25,ukuran:'XL'}],bahan=JSON.stringify([{nama:'Scuba',qty:25,satuan:'kg'},{nama:'Embos',qty:25,satuan:'kg'}]);
 input.tables.StokBahan.push(roll('a','Scuba',60000),roll('b','Embos',90000));
 input.tables.Potong.push({id:'cut1',poId:'po1',total:100,ukuran:{XL:100},tarif:1000,rencanaId:'plan1',bahanList:bahan,alokasiBahan:JSON.stringify(list)});
 input.tables.RencanaPotong.push({id:'plan1',poId:'po1',status:'terpakai',bahanList:bahan,alokasiBahan:JSON.stringify(list)});
 return input;
}
const run=input=>{c.fixtureData=JSON.stringify(input);return JSON.parse(vm.runInContext('JSON.stringify(coreCommerceHpp(JSON.parse(fixtureData)))',c));};
const model=input=>run(input).models.find(m=>m.id===modelId);
const KAIN=25*60000/100+25*90000/100;

test('two cloths at two prices reach HPP at their own price, per pcs of XL',()=>{
 const input=cut(bare());input.config.modelConfigs={[modelId]:cost()};const m=model(input);
 assert.equal(m.basis.ukuran,'XL');assert.equal(m.kainData,KAIN);assert.equal(m.hargaKain,KAIN);assert.equal(m.sumberKain,'data');assert.equal(m.potongData,1000);assert.equal(m.hppTotal,KAIN+1000+2000+3000);assert.equal(m.configured,true);
 assert.deepEqual(m.kain.details.map(d=>[d.jenis,d.avgHarga]),[['Scuba',60000],['Embos',90000]]);
});

test('with no data and no manual figure the model simply waits',()=>{
 const input=bare();input.config.modelConfigs={[modelId]:cost()};const m=model(input);
 assert.equal(m.hargaKain,null);assert.equal(m.hargaPotong,null);assert.equal(m.sumberKain,'');assert.equal(m.hppTotal,null);assert.equal(m.configured,false);assert.equal(m.configSaved,true);
});

test('a manual figure gives an HPP and a price while data is missing',()=>{
 const input=bare();input.config.modelConfigs={[modelId]:cost({kainManual:40000,potongManual:1500})};const m=model(input);
 assert.equal(m.hargaKain,40000);assert.equal(m.hargaPotong,1500);assert.equal(m.sumberKain,'manual');assert.equal(m.sumberPotong,'manual');assert.equal(m.hppTotal,46500);assert.equal(m.configured,true);assert.ok(m.prices.shop.valid);
 assert.doesNotMatch(m.warnings.join(' '),/Belum ada hasil potong|Belum ada hasil XL/);
});

test('cloth alone is not enough: the cutting figure is still needed',()=>{
 const input=bare();input.config.modelConfigs={[modelId]:cost({kainManual:40000})};const m=model(input);
 assert.equal(m.hargaKain,40000);assert.equal(m.hargaPotong,null);assert.equal(m.hppTotal,null);assert.equal(m.configured,false);
});

test('data takes over by itself and the manual figure stays saved but unused',()=>{
 const input=bare();input.config.modelConfigs={[modelId]:cost({kainManual:40000,potongManual:1500})};assert.equal(model(input).sumberKain,'manual');
 const m=model(cut(input));assert.equal(m.sumberKain,'data');assert.equal(m.sumberPotong,'data');assert.equal(m.hargaKain,KAIN);assert.equal(m.hargaPotong,1000);assert.equal(m.hppTotal,KAIN+1000+2000+3000);assert.equal(m.configured,true);assert.equal(m.config.value.kainManual,40000);
});

test('a mixed-size estimate does not beat a manual XL figure, but a saved XL record does',()=>{
 const input=cut(bare());input.tables.Potong[0].ukuran={M:50,XL:50};for(const row of [input.tables.Potong[0],input.tables.RencanaPotong[0]])row.alokasiBahan=JSON.stringify(JSON.parse(row.alokasiBahan).map(({stokId,qty})=>({stokId,qty})));
 let m=model(input);assert.equal(m.basis.ukuran,undefined);assert.equal(m.sumberKain,'perkiraan');assert.equal(m.hargaKain,KAIN);
 input.config.modelConfigs={[modelId]:cost({kainManual:40000})};m=model(input);assert.equal(m.sumberKain,'manual');assert.equal(m.hargaKain,40000);assert.equal(m.sumberPotong,'perkiraan');assert.equal(m.hppTotal,40000+1000+2000+3000);assert.equal(m.configured,true);
});

test('old XL with no fabric no longer blocks a manual figure',()=>{
 const input=bare();input.legacy={production:[{id:'oldXL',series:'Fixture',namaBarang:'Kaos',size:'XL',potong:[{id:'lama',jumlah:204,tarif:900}]}]};input.config.modelConfigs={[modelId]:cost({kainManual:40000,potongManual:1500})};
 const m=model(input);assert.equal(m.sumberKain,'manual');assert.equal(m.sumberPotong,'data');assert.equal(m.hppTotal,40000+900+2000+3000);assert.equal(m.configured,true);assert.doesNotMatch(m.warnings.join(' '),/tanpa rincian bahan/);
});

function grouped(extra){const input=bare();input.tables.PO.push({id:'po2',series:'Fixture',nama:'Kaos Dua',status:'aktif',produkId:'p1'});const ids=run(input).models.map(m=>m.id);input.config.hppGroups={[groupId]:{id:groupId,nama:'Kaos',modelIds:ids,config:cost(extra)}};return input;}

test('a group waits, takes a manual figure, then follows data on its own',()=>{
 let g=run(grouped()).groups[0];assert.equal(g.hargaKain,null);assert.equal(g.configured,false);assert.match(g.warnings.join(' '),/Belum ada acuan kain XL/);
 const input=grouped({kainManual:40000,potongManual:1500});g=run(input).groups[0];assert.equal(g.sumberKain,'manual');assert.equal(g.hppTotal,46500);assert.equal(g.configured,true);assert.doesNotMatch(g.warnings.join(' '),/Belum ada acuan kain XL/);
 g=run(cut(input)).groups[0];assert.equal(g.sumberKain,'data');assert.equal(g.hargaKain,KAIN);assert.equal(g.referenceModelIds.length,1);assert.equal(g.hppTotal,KAIN+1000+2000+3000);assert.equal(g.configured,true);
});

test('a group with a missing member still refuses a price',()=>{
 const input=grouped({kainManual:40000,potongManual:1500});input.config.hppGroups[groupId].modelIds.push('model_hilang');const g=run(input).groups[0];assert.equal(g.configured,false);assert.match(g.sourceWarnings.join(' '),/belum ditemukan/);
});

test('config keeps valid figures and refuses zero, negative and text',()=>{
 const valid=c=>vm.runInContext('JSON.stringify(coreCommerceHppConfig('+JSON.stringify(c)+'))',globalThis.ctx);
 globalThis.ctx=c;
 assert.equal(JSON.parse(valid(cost({kainManual:40000,potongManual:1500}))).kainManual,40000);assert.equal(JSON.parse(valid(cost())).kainManual,undefined);
 for(const bad of [{kainManual:0},{potongManual:0},{kainManual:-1},{kainManual:'40000'}])assert.throws(()=>valid(cost(bad)),/Kain manual|Potong manual/,JSON.stringify(bad));
});

test('without manual figures every result field matches the plain record',()=>{
 const input=cut(bare());const m=model(input);assert.equal(m.hargaKain,m.kain.perPcs);assert.equal(m.hargaPotong,m.potong.perPcs);assert.equal(m.hppTotal,m.kain.perPcs+m.potong.perPcs+m.hargaJahit+m.biayaLain);
});

const kaosHold=input=>{input.tables.PO[0].imporReview='Periksa dulu';return input;};
const mixed=input=>{input.tables.Potong[0].ukuran={M:50,XL:50};for(const row of [input.tables.Potong[0],input.tables.RencanaPotong[0]])row.alokasiBahan=JSON.stringify(JSON.parse(row.alokasiBahan).map(({stokId,qty})=>({stokId,qty})));return input;};

test('a hold keeps standing while any part of the total still comes from records',()=>{
 const input=kaosHold(mixed(cut(bare())));input.config.modelConfigs={[modelId]:cost({kainManual:40000})};
 let m=model(input);assert.equal(m.sumberKain,'manual');assert.equal(m.sumberPotong,'perkiraan');assert.equal(m.configured,false);assert.deepEqual(m.prices,{});assert.equal(m.tahanManual,true);
 input.config.modelConfigs[modelId]=cost({kainManual:40000,potongManual:1500,jahitMode:'auto'});assert.equal(model(input).configured,false);
 input.config.modelConfigs[modelId]=cost({kainManual:40000,potongManual:1500});m=model(input);assert.equal(m.configured,true);assert.equal(m.hppTotal,46500);
});

test('a roll losing its price does not turn held records into a ready price',()=>{
 const input=kaosHold(cut(bare()));input.config.modelConfigs={[modelId]:cost({kainManual:40000})};assert.equal(model(input).sumberKain,'data');assert.equal(model(input).configured,false);
 Object.assign(input.tables.StokBahan[0],{harga:0,total:0});const m=model(input);assert.equal(m.sumberKain,'manual');assert.equal(m.configured,false);
});

test('an archived cycle does not hold a typed figure',()=>{
 const input=bare();input.tables.PO.push({id:'old',series:'Fixture',nama:'Kaos',noPO:'PO-OLD',asal:'lama',status:'selesai',catatan:'Arsip PO 28/09/26',imporReview:'Arsip',imporSumber:JSON.stringify({legacyReconciliation:{mode:'archive'}})});
 input.config.modelConfigs={[modelId]:cost({kainManual:40000,potongManual:1500,jahitMode:'auto'})};const m=model(input);assert.equal(m.tahanManual,false);assert.equal(m.configured,true);assert.equal(m.hppTotal,40000+1500+2000+3000);
});

function member(tarif){const input=cut(bare());if(tarif===null)input.tables.Potong[0].tarif=0;input.tables.PO.push({id:'po2',series:'Fixture',nama:'Kaos Dua',status:'aktif',produkId:'p1'});return input;}
test('in a group a member with complete cloth beats the typed cloth when only its cutting rate is missing',()=>{
 const input=member(null);input.config.hppGroups={[groupId]:{id:groupId,nama:'Kaos',modelIds:run(input).models.map(m=>m.id),config:cost({kainManual:90000,potongManual:1500})}};
 const g=run(input).groups[0];assert.deepEqual(g.referenceModelIds,[]);assert.equal(g.sumberKain,'data');assert.equal(g.hargaKain,KAIN);assert.equal(g.sumberPotong,'manual');assert.equal(g.hargaPotong,1500);assert.equal(g.configured,true);assert.equal(g.hppTotal,KAIN+1500+2000+3000);assert.equal(g.kain.complete,true);assert.ok(g.kain.details.length);
 input.config.hppGroups[groupId].config=cost({potongManual:1500});const only=run(input).groups[0];assert.equal(only.sumberKain,'data');assert.equal(only.configured,true);
 input.config.hppGroups[groupId].config=cost();const none=run(input).groups[0];assert.equal(none.hargaKain,null);assert.equal(none.configured,false);
});

test('a group with cloth typed and no cutting figure says what is missing',()=>{
 const g=run(grouped({kainManual:40000})).groups[0];assert.equal(g.hppTotal,null);assert.match(g.warnings.join(' '),/Isi potong \/ pcs/);assert.doesNotMatch(g.warnings.join(' '),/Belum ada acuan kain XL/);
});

test('a prepared plan is reported before any cut',()=>{
 const input=cut(bare());input.tables.Potong=[];input.tables.RencanaPotong[0].status='siap';const m=model(input);assert.equal(m.kain.observasi.rencanaSiap,1);
 input.tables.RencanaPotong[0].status='batal';assert.equal(model(input).kain.observasi.rencanaSiap,0);
 const raw=grouped();raw.tables.RencanaPotong.push({id:'plan9',poId:'po1',status:'siap',bahanList:'[]',alokasiBahan:'[]'});assert.equal(run(raw).groups[0].kain.observasi.rencanaSiap,1);
});
