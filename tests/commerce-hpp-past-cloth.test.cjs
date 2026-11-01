'use strict';
/* 1.5.71: a model with no cloth figure is offered a temporary one from its own past cuts. It is
   only an offer: nothing changes until the owner saves it as kainManual, and data still wins. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const c=vm.createContext({});for(const name of ['core','reconcile-legacy','commerce-hpp'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/'+name+'.js'),'utf8'),c);
const idOf=nama=>vm.runInContext(`coreCommerceLegacyCost.modelId('Fixture',${JSON.stringify(nama)})`,c);
const buy=(id,bahan,harga,extra={})=>({id,jenis:'beli',bahan,qty:25,satuan:'kg',harga,total:25*harga,stockMode:'roll',...extra});
const po=(id,nama,extra={})=>({id,noPO:'PO-'+id,series:'Fixture',nama,status:'aktif',...extra});
const cut=(id,poId,ukuran,kg,bahan,rol,extra={})=>({id,poId,ukuran,total:Object.values(ukuran).reduce((a,b)=>a+b,0),kg,bahan,rol,tarif:1000,...extra});
const base=(PO,Potong,StokBahan,config={})=>({config:{marketplace:{},pajak:0,...config},tables:{PO,Produk:[],Potong,RencanaPotong:[],StokBahan}});
const run=input=>{c.fixtureData=JSON.stringify(input);return JSON.parse(vm.runInContext('JSON.stringify(coreCommerceHpp(JSON.parse(fixtureData)))',c));};
const model=(input,nama='Celana')=>run(input).models.find(m=>m.id===idOf(nama));
const near=(a,b)=>assert.ok(Math.abs(a-b)<0.0001,a+' vs '+b);

test('rolls with no weight stay out: the recorded kg divides only the pcs it belongs to',()=>{
 const m=model(base([po('a','Celana')],[cut('c1','a',{M:108},25.1,'Dryfit Embos Hitam',1,{asal:'lama'}),cut('c2','a',{XXL:108},26.65,'Dryfit Embos Hitam',1,{asal:'lama'}),cut('c3','a',{L:106,XL:106},0,'Dryfit Embos Hitam',2)],[buy('s1','Dryfit Embos Hitam',100000)]));
 const r=m.kainRiwayat;assert.equal(r.totalPcs,216);near(r.perPcs,51.75*100000/216);assert.deepEqual(r.poNo,['PO-a']);assert.deepEqual(r.bahan.map(b=>[b.nama,b.satuan]),[['Dryfit Embos Hitam','kg']]);near(r.bahan[0].qty,51.75);assert.deepEqual(r.tanpaHarga,[]);
});

test('a row naming the cloth with no weight and no rolls of its own shares the weight of its PO',()=>{
 const m=model(base([po('a','Celana')],[cut('c1','a',{M:56},50.34,'Dryfit Embos Putih',2,{asal:'lama'}),cut('c2','a',{L:48},0,'Dryfit Embos Putih',0,{asal:'lama'}),cut('c3','a',{XL:48},0,'Dryfit Embos Putih',0,{asal:'lama'}),cut('c4','a',{XXL:56},0,'Dryfit Embos Putih',0,{asal:'lama'})],[buy('s1','Dryfit Embos Putih',100000)]));
 assert.equal(m.kainRiwayat.totalPcs,208);near(m.kainRiwayat.perPcs,50.34*100000/208);
});

test('a row naming no cloth at all is left out, and a continuation counts',()=>{
 const m=model(base([po('a','Celana')],[cut('c1','a',{M:100},25,'Scuba',1),cut('c2','a',{L:90},0,'',0,{asal:'lama'}),cut('c3','a',{XL:50},0,'',0,{asal:'lanjut'})],[buy('s1','Scuba',100000)]));
 assert.equal(m.kainRiwayat.totalPcs,150);near(m.kainRiwayat.perPcs,25*100000/150);
});

test('a row with two cloths reads both, each at its own price',()=>{
 const m=model(base([po('a','Celana')],[cut('c1','a',{M:100},0,'',2,{bahanList:JSON.stringify([{nama:'Scuba',qty:30,satuan:'kg'},{nama:'Embos',qty:20,satuan:'kg'}])})],[buy('s1','Scuba',60000),buy('s2','Embos',90000)]));
 near(m.kainRiwayat.perPcs,(30*60000+20*90000)/100);assert.equal(m.kainRiwayat.bahan.length,2);
});

test('a row with one cloth weighed and another not is unusable and stays out whole',()=>{
 const m=model(base([po('a','Celana')],[cut('c1','a',{M:100},25,'Scuba',1),cut('c2','a',{L:100},0,'',2,{bahanList:JSON.stringify([{nama:'Scuba',qty:30},{nama:'Embos',qty:0}])})],[buy('s1','Scuba',60000),buy('s2','Embos',90000)]));
 assert.equal(m.kainRiwayat.totalPcs,100);near(m.kainRiwayat.perPcs,25*60000/100);
});

test('a row naming a different cloth with no weight does not share the weight of the PO',()=>{
 let m=model(base([po('a','Celana')],[cut('c1','a',{M:100},25,'Scuba',1),cut('c2','a',{L:100},0,'Embos',0)],[buy('s1','Scuba',100000),buy('s2','Embos',90000)]));
 assert.equal(m.kainRiwayat.totalPcs,100);near(m.kainRiwayat.perPcs,25000);
 m=model(base([po('a','Celana')],[cut('c2','a',{L:100},0,'Drayfit Embos',0),cut('c1','a',{M:100},25,'Dryfit Embos',1)],[buy('s1','Dryfit Embos',100000)]));
 assert.equal(m.kainRiwayat.totalPcs,200,'another spelling of the weighed cloth still shares, whichever row comes first');
});

test('an unnamed weighed entry costs its own row, not the whole PO',()=>{
 const m=model(base([po('a','Celana')],[cut('c1','a',{M:100},0,'',2,{bahanList:JSON.stringify([{nama:'Scuba',qty:20},{nama:'',qty:5}])}),cut('c2','a',{L:100},30,'Scuba',1)],[buy('s1','Scuba',100000)]));
 assert.equal(m.kainRiwayat.totalPcs,100);near(m.kainRiwayat.perPcs,30000);assert.deepEqual(m.kainRiwayat.tanpaHarga,[]);
 assert.deepEqual(model(base([po('a','Celana')],[cut('c1','a',{M:100},0,'',1,{bahanList:JSON.stringify([{qty:5}])})],[buy('s1','Scuba',100000)])).kainRiwayat,null);
});

test('a repeated cut id counts once, and a PO id is read only for its own model',()=>{
 const m=model(base([po('a','Celana'),po('b','Celana'),po('c','Celana')],[cut('c1','a',{M:100},50,'Scuba',2),cut('c1','b',{M:100},50,'Scuba',2),cut('c3','c',{M:100},20,'Scuba',1)],[buy('s1','Scuba',100000)]));
 assert.equal(m.kainRiwayat.totalPcs,200);
 const out=run(base([po('a','Celana'),po('a','Kaos')],[cut('c1','a',{M:100},50,'Scuba',2)],[buy('s1','Scuba',100000)]));
 assert.equal(out.models.filter(x=>x.kainRiwayat).length,1);
});

test('a malformed old cell loses the offer, never the screen',()=>{
 const input=base([po('a','Celana'),po('b','Kaos')],[cut('c1','a',{M:100},0,'',1,{asal:'lama',bahanList:JSON.stringify([{nama:{toString:null},qty:5}])}),cut('c2','b',{M:100},25,'Scuba',1)],[buy('s1','Scuba',100000)]);
 input.legacy={production:[{id:'old',series:'Fixture',namaBarang:'Lain',size:'XL',potong:[{id:'lama',jumlah:10,tarif:900}]}]};
 const out=run(input);assert.ok(out.models.length>=2);assert.equal(out.models.find(x=>x.id===idOf('Celana')).kainRiwayat,null);assert.ok(out.models.find(x=>x.id===idOf('Kaos')).hargaKain>0);
});

test('POs are weighted by pcs, and a cancelled PO or an owner opening gives nothing',()=>{
 const m=model(base([po('a','Celana'),po('b','Celana'),po('x','Celana',{status:'batal'})],[cut('c1','a',{M:100},20,'Scuba',1),cut('c2','b',{M:300},90,'Scuba',3),cut('c3','x',{M:1000},10,'Scuba',1),cut('c4','a',{L:500},5,'Scuba',1,{asal:'koreksi-ukuran'})],[buy('s1','Scuba',100000)]));
 assert.equal(m.kainRiwayat.totalPcs,400);near(m.kainRiwayat.perPcs,110*100000/400);assert.deepEqual(m.kainRiwayat.poNo,['PO-a','PO-b']);
});

test('old spellings reach the purchase name; an exact name wins and an ambiguous one is not guessed',()=>{
 let m=model(base([po('a','Celana')],[cut('c1','a',{M:100},25,'Drayfit Embos Hitam',1)],[buy('s1','Dryfit Embos Hitam',100000)]));
 assert.equal(m.kainRiwayat.bahan[0].nama,'Dryfit Embos Hitam');near(m.kainRiwayat.perPcs,25*100000/100);
 m=model(base([po('a','Celana')],[cut('c1','a',{M:100},25,'Squba Embos Htam',1)],[buy('s1','Scuba Embos Hitam',100000)]));
 assert.equal(m.kainRiwayat.bahan[0].nama,'Scuba Embos Hitam');
 m=model(base([po('a','Celana')],[cut('c1','a',{M:100},25,'Drayfit Puma',1)],[buy('s1','Drayfit Puma',50000),buy('s2','Dryfit Puma',100000)]));
 near(m.kainRiwayat.perPcs,25*50000/100);
 m=model(base([po('a','Celana')],[cut('c1','a',{M:100},25,'Dryfit Htam',1)],[buy('s1','Drayfit Htam',50000),buy('s2','Dryfit Hitam',100000)]));
 assert.equal(m.kainRiwayat.perPcs,null);assert.deepEqual(m.kainRiwayat.tanpaHarga,['Dryfit Htam']);
});

test('a stock correction is no purchase: it neither defeats nor confuses the spelling match',()=>{
 const koreksi=(id,bahan)=>({id,jenis:'koreksi',bahan,qty:25,satuan:'kg'});
 let m=model(base([po('a','Celana')],[cut('c1','a',{M:100},25,'Drayfit Embos Hitam',1)],[buy('s1','Dryfit Embos Hitam',100000),koreksi('k1','Drayfit Embos Hitam')]));
 assert.equal(m.kainRiwayat.bahan[0].nama,'Dryfit Embos Hitam');near(m.kainRiwayat.perPcs,25000);
 m=model(base([po('a','Celana')],[cut('c1','a',{M:100},25,'Dryfit Htam',1)],[buy('s1','Dryfit Hitam',100000),koreksi('k1','Drayfit Hitam')]));
 near(m.kainRiwayat.perPcs,25000);
});

test('rolls detailed past the aggregate purchase do not inflate the price',()=>{
 const stok=[{id:'b1',jenis:'beli',bahan:'Cotton',qty:100,satuan:'kg',harga:50000,total:5000000},{id:'k1',jenis:'koreksi',bahan:'Cotton',qty:30,satuan:'kg'},{id:'r1',jenis:'rinci',bahan:'Cotton',qty:120,satuan:'kg',sourceStockId:'b1',stockMode:'roll'}];
 const m=model(base([po('a','Celana')],[cut('c1','a',{M:100},25,'Cotton',1),cut('c2','a',{L:100},0,'',2)],stok));
 assert.equal(m.hargaKain,null);near(m.kainRiwayat.perPcs,12500);
});

test('a cloth priced by the owner with no purchase row still gives a figure',()=>{
 const stok=[{id:'k1',jenis:'koreksi',alasan:'stok_awal',bahan:'Scuba',qty:50,satuan:'kg'},{id:'h1',jenis:'harga',priceScope:'bahan',bahan:'Scuba',satuan:'kg',qty:0,harga:60000}];
 const m=model(base([po('a','Celana')],[cut('c1','a',{M:100},25,'Scuba',1),cut('c2','a',{L:100},0,'',0)],stok));
 assert.equal(m.kainRiwayat.bahan[0].nama,'Scuba');near(m.kainRiwayat.perPcs,15000);assert.deepEqual(m.kainRiwayat.tanpaHarga,[]);
});

test('a cloth with no purchase is named, its PO skipped, the others still count',()=>{
 const m=model(base([po('a','Celana'),po('b','Celana')],[cut('c1','a',{M:100},25,'Drayfit Puma Merah',1),cut('c2','b',{M:100},20,'Scuba',1)],[buy('s1','Scuba',100000)]));
 assert.equal(m.kainRiwayat.totalPcs,100);near(m.kainRiwayat.perPcs,20*100000/100);assert.deepEqual(m.kainRiwayat.tanpaHarga,['Drayfit Puma Merah']);assert.deepEqual(m.kainRiwayat.poNo,['PO-b']);
 const only=model(base([po('a','Celana')],[cut('c1','a',{M:100},25,'Drayfit Puma Merah',1)],[]));
 assert.equal(only.kainRiwayat.perPcs,null);assert.equal(only.kainRiwayat.totalPcs,0);assert.deepEqual(only.kainRiwayat.tanpaHarga,['Drayfit Puma Merah']);
});

test('receipts with no price do not drag the price down',()=>{
 const m=model(base([po('a','Celana')],[cut('c1','a',{M:100},25,'Scuba',1)],[buy('s1','Scuba',100000),{id:'s2',jenis:'beli',bahan:'Scuba',qty:25,satuan:'kg',harga:0,total:0,stockMode:'roll'}]));
 near(m.kainRiwayat.perPcs,25*100000/100);
});

test('no cut, or no weight anywhere, gives no offer',()=>{
 assert.equal(model(base([po('a','Celana')],[],[buy('s1','Scuba',100000)])).kainRiwayat,null);
 assert.equal(model(base([po('a','Celana')],[cut('c1','a',{M:100},0,'',0,{asal:'lama'}),cut('c2','a',{L:100},0,'Scuba',2)],[buy('s1','Scuba',100000)])).kainRiwayat,null);
});

test('the offer changes nothing by itself: no figure, no HPP, no ready state',()=>{
 const input=base([po('a','Celana')],[cut('c1','a',{M:100},25,'Scuba',1),cut('c2','a',{L:100},0,'',2)],[buy('s1','Scuba',100000)]);
 const m=model(input);assert.equal(m.hargaKain,null);assert.equal(m.sumberKain,'');assert.equal(m.hppTotal,null);assert.equal(m.configured,false);assert.equal(m.kain.complete,false);assert.ok(m.kainRiwayat.perPcs>0);
});

test('saved as a manual figure it fills HPP, and XL data takes over later',()=>{
 const id=idOf('Celana'),value={jahitMode:'manual',hargaJahit:2000,biayaLain:0,targetMargin:30,costSchema:2,costsReviewed:true,kainManual:25000,potongManual:1500};
 const input=base([po('a','Celana')],[cut('c1','a',{M:100},25,'Scuba',1),cut('c2','a',{L:100},0,'',2)],[buy('s1','Scuba',100000)],{modelConfigs:{[id]:value}});
 let m=model(input);assert.equal(m.sumberKain,'manual');assert.equal(m.hppTotal,28500);
 input.tables.Potong=[cut('c9','a',{XL:100},25,'Scuba',1)];m=model(input);assert.equal(m.sumberKain,'data');near(m.hargaKain,25000);assert.equal(m.config.value.kainManual,25000);
});

test('a group without a matched XL pair reports the member parts the server will use',()=>{
 const key='hppg_kaos',ids=[idOf('Celana'),idOf('Kaos')],cfg={hppGroups:{[key]:{id:key,nama:'Kaos',modelIds:ids}}};
 const out=run(base([po('a','Celana'),po('b','Kaos')],[cut('c1','a',{XL:100},0,'',0),cut('c2','b',{M:100},25,'Scuba',1)],[buy('s1','Scuba',100000)],cfg)),g=out.groups[0];
 assert.equal(g.referenceModelIds.length,0);assert.equal(g.potongAnggota,1000);assert.equal(g.kainAnggota,null);assert.equal(g.hargaPotong,null);
 const value={jahitMode:'manual',hargaJahit:2000,biayaLain:0,targetMargin:30,costSchema:2,costsReviewed:true,kainManual:25000};
 cfg.hppGroups[key].config=value;const saved=run(base([po('a','Celana'),po('b','Kaos')],[cut('c1','a',{XL:100},0,'',0),cut('c2','b',{M:100},25,'Scuba',1)],[buy('s1','Scuba',100000)],cfg)).groups[0];
 assert.equal(saved.hargaPotong,g.potongAnggota);assert.equal(saved.sumberPotong,'data');assert.equal(saved.hppTotal,28000);
});

test('a member with recorded XL cloth leaves the group no offer, held or not',()=>{
 const key='hppg_kaos',ids=[idOf('Celana'),idOf('Kaos')],cfg={hppGroups:{[key]:{id:key,nama:'Kaos',modelIds:ids}}};
 const roll=[{stokId:'s1',qty:25,ukuran:'XL'}],bahan=JSON.stringify([{nama:'Scuba',qty:25,satuan:'kg'}]);
 const pos=hold=>[po('a','Celana',hold?{imporReview:'cek'}:{}),po('b','Kaos')];
 const potong=[{id:'c1',poId:'a',ukuran:{XL:100},total:100,tarif:0,rencanaId:'plan1',bahanList:bahan,alokasiBahan:JSON.stringify(roll)},cut('c2','b',{M:100},50,'Scuba',2)];
 const input=hold=>{const x=base(pos(hold),potong,[buy('s1','Scuba',80000)],cfg);x.tables.RencanaPotong=[{id:'plan1',poId:'a',status:'terpakai',bahanList:bahan,alokasiBahan:JSON.stringify(roll)}];return x;};
 for(const hold of [false,true]){const out=run(input(hold)),member=out.models.find(x=>x.id===idOf('Celana')),g=out.groups[0];assert.equal(member.kainData,20000,'member keeps its record');assert.equal(member.kainRiwayat,null,'a recorded figure needs no offer');assert.equal(g.hargaKain,null);assert.equal(g.kainRiwayat,null);}
});

test('a group pools the offers of its members by pcs',()=>{
 const key='hppg_kaos',ids=[idOf('Celana'),idOf('Kaos')];
 const out=run(base([po('a','Celana'),po('b','Kaos'),po('c','Polo')],[cut('c1','a',{M:100},20,'Scuba',1),cut('c2','b',{M:300},90,'Drayfit Embos',3),cut('c3','c',{M:100},90,'Scuba',3)],[buy('s1','Scuba',100000),buy('s2','Dryfit Embos',50000)],{hppGroups:{[key]:{id:key,nama:'Kaos',modelIds:ids}}}));
 const g=out.groups[0],r=g.kainRiwayat;assert.equal(r.totalPcs,400);near(r.perPcs,(20*100000+90*50000)/400);assert.equal(r.bahan.length,2);assert.deepEqual(r.poNo,['PO-a','PO-b']);assert.equal(g.hargaKain,null);
});
