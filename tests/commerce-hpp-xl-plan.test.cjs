'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const c=vm.createContext({});
for(const file of ['core','commerce-hpp'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/'+file+'.js'),'utf8'),c);
const id=vm.runInContext("coreCommerceLegacyCost.modelId('Fixture','Shirt')",c);
function run(input){c.input=JSON.stringify(input);return JSON.parse(vm.runInContext('JSON.stringify(coreCommerceHpp(JSON.parse(input)))',c)).models[0];}
function fixture(){
 const bahanList=[{nama:'Cotton',satuan:'kg',qty:51.75}],alokasiBahan=[{stokId:'rollXL',qty:25.75,ukuran:'XL'},{stokId:'rollM',qty:26,ukuran:'M'}];
 return {config:{modelConfigs:{[id]:{jahitMode:'manual',hargaJahit:5000,biayaLain:0,targetMargin:30,costSchema:2,costsReviewed:true}},marketplace:{shop:{fee:10,fixedPerPcs:0}},pajak:0},tables:{
  PO:[{id:'po1',series:'Fixture',nama:'Shirt',ukuranAktif:['M','L','XL']}],
  Potong:[{id:'cut1',poId:'po1',rencanaId:'plan1',total:238,ukuran:{XL:117,M:121},tarif:500,bahanList:structuredClone(bahanList),alokasiBahan:alokasiBahan.map(({stokId,qty})=>({stokId,qty}))}],
  RencanaPotong:[{id:'plan1',poId:'po1',status:'siap',bahanList,alokasiBahan}],
  StokBahan:[{id:'rollXL',jenis:'beli',bahan:'Cotton',satuan:'kg',qty:25.75,harga:88000,total:2266000,stockMode:'roll'},{id:'rollM',jenis:'beli',bahan:'Cotton',satuan:'kg',qty:26,harga:88000,total:2288000,stockMode:'roll'}]
 }};
}
function continuation(input,first={XL:117},later={M:121}){
 input.tables.Potong[0].ukuran=first;input.tables.Potong[0].total=Object.values(first).reduce((a,b)=>a+b,0);
 input.tables.Potong.push({id:'cut2',poId:'po1',rencanaId:'',asal:'lanjut',total:Object.values(later).reduce((a,b)=>a+b,0),ukuran:later,tarif:700,bahanList:'',alokasiBahan:'',bahan:'',kg:0});
}

test('old mixed cut recovers size labels from exactly matched plan and uses only the actual XL roll cost',()=>{
 const input=fixture(),before=JSON.stringify(input),m=run(input);
 assert.equal(m.basis.ukuran,'XL');assert.equal(m.kain.totalPcs,117);assert.equal(m.kain.totalCost,2266000);assert.equal(m.kain.perPcs,2266000/117);assert.equal(m.configSaved,true);assert.equal(m.configured,true);
 assert.deepEqual(m.kain.observasi.sizes,[{size:'XL',jumlah:117}]);assert.equal(m.kain.observasi.totalKg,25.75);assert.equal(m.kain.observasi.pcsPerFullRoll,117);assert.equal(m.kain.details[0].sourceId,'rollXL');assert.equal(JSON.stringify(input),before);
 // Stored tables arrive as JSON strings too; row order is not an identity.
 input.tables.RencanaPotong[0].alokasiBahan.reverse();
 for(const row of [...input.tables.Potong,...input.tables.RencanaPotong])for(const key of ['bahanList','alokasiBahan'])row[key]=JSON.stringify(row[key]);
 assert.equal(run(input).kain.totalCost,2266000);
});

test('plan label recovery never guesses after quantity, material, unit, source, PO or identity mismatch',()=>{
 const mutations=[i=>i.tables.RencanaPotong[0].alokasiBahan[0].qty=25,i=>i.tables.RencanaPotong[0].bahanList[0].qty=51,i=>i.tables.RencanaPotong[0].bahanList[0].nama='Other',i=>i.tables.RencanaPotong[0].bahanList[0].satuan='yard',i=>i.tables.RencanaPotong[0].alokasiBahan[0].stokId='other',i=>i.tables.RencanaPotong[0].poId='other',i=>i.tables.RencanaPotong.push(structuredClone(i.tables.RencanaPotong[0])),i=>i.tables.RencanaPotong[0].status='batal',i=>i.tables.Potong[0].alokasiBahan[0].ukuran='M'];
 for(const mutate of mutations){const input=fixture();mutate(input);const m=run(input);assert.equal(m.basis.ukuran,undefined);assert.equal(m.configured,false);assert.equal(m.kain.totalPcs,238);assert.equal(m.kain.totalCost,4554000);assert.equal(m.configSaved,true);}
});

test('a plan without matching result source IDs cannot create an XL allocation',()=>{
 const input=fixture();input.tables.Potong[0].alokasiBahan=[];
 const m=run(input);assert.equal(m.basis.ukuran,undefined);assert.equal(m.kain.totalPcs,238);assert.equal(m.configured,false);
});

test('mixed-size continuation uses each sized roll once instead of rejecting the entire PO',()=>{
 const input=fixture();continuation(input);const before=JSON.stringify(input),m=run(input);
 assert.equal(m.basis.ukuran,'XL');assert.equal(m.kain.totalPcs,117);assert.equal(m.kain.totalCost,2266000);assert.equal(m.potong.perPcs,500);assert.equal(m.configured,true);assert.equal(m.kain.observasi.pcsPerFullRoll,117);assert.equal(JSON.stringify(input),before);
});

test('XL arriving after M attaches its own material to XL output and keeps actual per-result tariffs',()=>{
 const input=fixture();continuation(input,{M:121},{XL:100});
 input.tables.Potong.push({id:'cut3',poId:'po1',asal:'lanjut',total:17,ukuran:{XL:17},tarif:900});
 const m=run(input);assert.equal(m.basis.ukuran,'XL');assert.equal(m.kain.totalPcs,117);assert.equal(m.kain.totalCost,2266000);assert.equal(m.kain.details.length,1);assert.equal(m.potong.totalCost,85300);assert.equal(m.potong.perPcs,85300/117);assert.equal(m.kain.observasi.pcsPerFullRoll,117);
});

test('unlabelled mixed continuation still remains provisional without inventing XL fabric use',()=>{
 const input=fixture();continuation(input);input.tables.RencanaPotong[0].alokasiBahan.forEach(a=>delete a.ukuran);
 const m=run(input);assert.equal(m.basis.ukuran,undefined);assert.equal(m.kain.totalCost,4554000);assert.equal(m.kain.totalPcs,238);assert.equal(m.kain.perPcs,4554000/238);assert.equal(m.configured,false);assert.equal(m.configSaved,true);assert.deepEqual(m.prices,{});
});

test('unlinked continuation with two initial batches is not assigned by date, order or matching size',()=>{
 const input=fixture();continuation(input);input.tables.Potong.push({id:'other-initial',poId:'po1',rencanaId:'plan2',total:10,ukuran:{XL:10},tarif:500,bahanList:[{nama:'Cotton',satuan:'kg',qty:1}]});
 const m=run(input);assert.equal(m.basis.ukuran,undefined);assert.equal(m.kain.totalPcs,248);assert.equal(m.configured,false);
});

test('explicit continuation plan link isolates its own mixed batch without suppressing independent XL batches',()=>{
 const input=fixture();continuation(input);input.tables.Potong[1].rencanaId='plan1';
 input.tables.Potong.push({id:'other-initial',poId:'po1',rencanaId:'plan2',total:10,ukuran:{XL:10},tarif:500,bahanList:[{nama:'Cotton',satuan:'kg',qty:1}]});
 const m=run(input);assert.equal(m.basis.ukuran,'XL');assert.equal(m.kain.totalPcs,127);assert.equal(m.kain.totalCost,2354000);assert.equal(m.configured,true);
});

test('continuation with extra material or invalid output cannot unlock a separated XL reference',()=>{
 for(const mutate of [i=>i.tables.Potong[1].kg=1,i=>i.tables.Potong[1].bahanList=[{nama:'Cotton',qty:1,satuan:'kg'}],i=>i.tables.Potong[1].total=122,i=>i.tables.Potong[1].ukuran.M=-1]){
  const input=fixture();continuation(input);mutate(input);const m=run(input);assert.equal(m.basis.ukuran,undefined);assert.equal(m.configured,false);
 }
});

test('saved model settings remain saved while missing prices or no XL prevent readiness',()=>{
 const input=fixture();input.tables.StokBahan[0].harga=0;input.tables.StokBahan[0].total=0;
 let m=run(input);assert.equal(m.configSaved,true);assert.equal(m.configured,false);assert.equal(m.hppTotal,null);
 input.tables.Potong=[];m=run(input);assert.equal(m.configSaved,true);assert.equal(m.configured,false);
});

test('configSaved rejects malformed and unreviewed configs and legacy-compatible suggestions',()=>{
 for(const change of [{costsReviewed:false},{costSchema:1},{jahitMode:'bad'},{hargaJahit:''},{biayaLain:-1},{targetMargin:100},{hargaJual:{shop:-1}}]){
  const input=fixture();Object.assign(input.config.modelConfigs[id],change);const m=run(input);assert.equal(m.configSaved,false);assert.equal(m.configured,false);
 }
 const input=fixture();input.config.configs={'native:po1':input.config.modelConfigs[id]};delete input.config.modelConfigs;
 const m=run(input);assert.equal(m.config.source,'legacy-compatible');assert.equal(m.configSaved,false);
});

test('XL supplies its own reference immediately while other explicitly allocated sizes wait for cutting',()=>{
 const input=fixture();input.tables.Potong[0].ukuran={XL:117};input.tables.Potong[0].total=117;
 const before=JSON.stringify(input),pending=run(input);
 assert.equal(pending.basis.ukuran,'XL');assert.equal(pending.kain.totalPcs,117);assert.equal(pending.kain.totalCost,2266000);assert.equal(pending.kain.observasi.totalKg,25.75);assert.equal(pending.potong.totalCost,58500);assert.equal(pending.configured,true);assert.equal(JSON.stringify(input),before);
 assert.deepEqual(pending.kain.details.map(d=>d.sourceId),['rollXL']);assert.deepEqual(pending.kain.observasi.sizes,[{size:'XL',jumlah:117}]);
 input.tables.Potong.push({id:'cutM',poId:'po1',asal:'lanjut',total:121,ukuran:{M:121},tarif:700,bahanList:'',alokasiBahan:'',bahan:'',kg:0});
 const finished=run(input);assert.equal(finished.kain.totalPcs,pending.kain.totalPcs);assert.equal(finished.kain.totalCost,pending.kain.totalCost);assert.equal(finished.potong.totalCost,pending.potong.totalCost);assert.equal(finished.hppTotal,pending.hppTotal);assert.equal(finished.configured,true);
});

test('explicit result roll labels can isolate XL without waiting for another size or a plan lookup',()=>{
 const input=fixture();input.tables.Potong[0].ukuran={XL:117};input.tables.Potong[0].total=117;
 input.tables.Potong[0].alokasiBahan=structuredClone(input.tables.RencanaPotong[0].alokasiBahan);input.tables.RencanaPotong=[];
 const m=run(input);assert.equal(m.basis.ukuran,'XL');assert.equal(m.kain.totalPcs,117);assert.equal(m.kain.totalCost,2266000);assert.equal(m.configured,true);
});

test('pending size reference rejects missing labels and contradictions between explicit result and plan labels',()=>{
 const mutations=[
  i=>{i.tables.Potong[0].alokasiBahan[0].ukuran='';i.tables.RencanaPotong[0].alokasiBahan.forEach(a=>delete a.ukuran);},
  i=>{i.tables.Potong[0].alokasiBahan[0].ukuran='M';i.tables.Potong[0].alokasiBahan[1].ukuran='XL';}
 ];
 for(const change of mutations){
  const input=fixture();input.tables.Potong[0].ukuran={XL:117};input.tables.Potong[0].total=117;input.tables.Potong[0].alokasiBahan=structuredClone(input.tables.RencanaPotong[0].alokasiBahan);change(input);
  const m=run(input);assert.equal(m.basis.ukuran,undefined);assert.equal(m.configured,false);assert.deepEqual(m.prices,{});
 }
});
