'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');

function fixture(){
 const h=harness();for(const name of ['bahan-invoice','cutting-plans','commerce-hpp'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/'+name+'.js'),'utf8'),h.context);
 const setup=h.request('setupOwner',{nama:'Review Owner',pin:'1234'});assert.equal(setup.ok,true,setup.error);const token=setup.data.token;
 h.run(`pkStore_().lock(function(){pkStore_().appendMany('StokBahan',[
  {id:'review-old-roll1',jenis:'beli',tanggal:'2020-01-01',bahan:'Cotton',qty:25,satuan:'kg',rol:1,harga:60000,total:1500000,stockMode:'roll',rollLabel:'Rol lama'},
  {id:'review-old-roll2',jenis:'beli',tanggal:'2020-01-01',bahan:' cotton ',qty:20,satuan:'kg',rol:1,harga:0,total:0,stockMode:'roll',rollLabel:'Rol belum dihargai'}
 ]);});`);
 function call(action,p={}){h.cold();return h.request(action,{token,workflowVersion:2,...p});}
 function good(action,p={}){const r=call(action,p);assert.equal(r.ok,true,r.error);return r.data&&r.data.data!==undefined?r.data.data:r.data;}
 function raw(){h.cold();return h.run("pkStore_().fresh('StokBahan');pkStore_().read('StokBahan')");}
 function prices(){return h.run(`coreStockPrices(${JSON.stringify(raw())})`);}
 function intent(id='review-material-1',harga=88000){return {id,bahan:'Cotton',satuan:'kg',harga,expectedPriceRevision:prices().materialMap.cotton.units.kg.priceRevision,catatan:'Harga per jenis bahan disamakan'};}
 return {h,call,good,raw,prices,intent};
}

test('material price survives a later invoice, keeps original bill totals, and applies to every new roll exactly once',()=>{
 const f=fixture(),before=f.raw();f.good('koreksiHargaJenisBahan',f.intent());
 const inv={id:'review-invoice-1',invoice:'BON-NEW',tanggal:'2026-10-17',supplier:'Review Supplier',items:[{bahan:'COTTON',satuan:'kg',harga:90000,rolls:[{qty:26},{qty:24}]}]};
 f.good('saveInvoiceBahan',{invoice:inv});f.good('saveInvoiceBahan',{invoice:inv});
 const stock=f.raw(),p=f.prices(),state=f.good('getState');
 assert.deepEqual(stock.slice(0,2),before,'historical receipts are untouched');
 const created=stock.filter(r=>r.invoiceId===inv.id);assert.equal(created.length,2);assert.equal(created.reduce((n,r)=>n+r.total,0),4500000,'bill retains its actual entered price');
 created.forEach(r=>{assert.equal(r.harga,90000);assert.equal(p.byId[r.id].harga,88000);assert.equal(p.byId[r.id].priceComplete,true);});
 assert.equal(p.materialMap.cotton.units.kg.qty,95);assert.equal(p.materialMap.cotton.units.kg.total,8360000);
 assert.equal(state.stokRingkas[0].saldo,95);assert.equal(state.stokRingkas[0].rol,4);assert.equal(state.stokRingkas[0].hpp,88000);assert.equal(state.stokRingkas[0].nilai,8360000);
});

test('owner response has the same material proof as server across old history and fresh app instances',()=>{
 const f=fixture(),initial=f.intent();f.good('koreksiHargaJenisBahan',initial);
 const state=f.good('getState'),ui=f.h.run(`coreStockPrices(${JSON.stringify(state.stok)})`),server=f.prices();
 assert.equal(ui.materialMap.cotton.units.kg.priceRevision,server.materialMap.cotton.units.kg.priceRevision);
 const second={...initial,id:'review-material-2',harga:89000,expectedPriceRevision:ui.materialMap.cotton.units.kg.priceRevision};f.good('koreksiHargaJenisBahan',second);
 const stale=f.call('koreksiHargaJenisBahan',{...second,id:'review-material-stale',harga:70000});assert.equal(stale.ok,false);assert.match(stale.error,/berubah/);
 f.good('koreksiHargaJenisBahan',initial);assert.equal(f.prices().materialMap.cotton.units.kg.hpp,89000,'old exact retry does not become latest');
 assert.equal(f.raw().filter(r=>r.jenis==='harga').length,2);
});

test('single price does not cross materials or units and legacy-only receipts use that material price without rewriting the snapshot',()=>{
 const f=fixture();f.good('koreksiHargaJenisBahan',f.intent());
 const stock=f.raw();stock.push({id:'yard-roll',jenis:'beli',bahan:'Cotton',satuan:'yard',qty:10,harga:30000,total:300000},{id:'other-roll',jenis:'beli',bahan:'Linen',satuan:'kg',qty:10,harga:40000,total:400000});
 const p=f.h.run(`coreStockPrices(${JSON.stringify(stock)})`);assert.equal(p.byId['yard-roll'].harga,30000);assert.equal(p.byId['other-roll'].harga,40000);
 const input={tables:{StokBahan:stock},legacy:{production:[{id:'legacyXL',series:'Review',namaBarang:'Shirt',size:'XL',potong:[{id:'cutXL',tanggal:'2020-01-01',jumlah:100,tarif:1000,bahanList:[{jenis:'Cotton',kg:25,unit:'kg'}],rols:[{purchaseId:'only-in-legacy',jenis:'Cotton',kg:25,unit:'kg'}]}]}],stock:{pembelian:[{id:'only-in-legacy',jenisBahan:'Cotton',kg:25,unit:'kg',hargaPerKg:0,total:0,rol:1}]},cuttingPlans:[]}};
 const before=JSON.stringify(input),result=f.h.run(`coreCommerceHpp(${JSON.stringify(input)})`),m=result.models[0];
 assert.equal(m.kain.totalCost,2200000);assert.equal(m.kain.totalPcs,100);assert.equal(m.kain.perPcs,22000);assert.equal(m.kain.complete,true);assert.equal(JSON.stringify(input),before);
});

test('generic stock paths cannot remove or replace the material price policy',()=>{
 const f=fixture(),req=f.intent();f.good('koreksiHargaJenisBahan',req);const before=f.raw(),policy=before.find(r=>r.id===req.id);
 let result=f.call('deleteRecord',{sheet:'StokBahan',id:req.id});assert.equal(result.ok,false);assert.match(result.error,/harga|koreksi/i);
 result=f.call('saveStok',{stok:{...policy,harga:1,total:1},expectedRevision:f.h.run(`coreDomainRevision('StokBahan',${JSON.stringify(policy)})`)});assert.equal(result.ok,false);assert.match(result.error,/harga|koreksi/i);
 result=f.call('importRows',{sheet:'StokBahan',rows:[{...policy,id:'forged-policy-1'}]});assert.equal(result.ok,false);
 f.call('gantiImpor',{data:{StokBahan:before.map(r=>({...r,...(r.id===req.id?{harga:1}:{})}))}});
 assert.deepEqual(f.raw(),before);
});
