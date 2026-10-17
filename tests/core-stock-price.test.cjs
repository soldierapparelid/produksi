'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');

function fixture(extra = []) {
  const h = harness();
  for (const name of ['bahan-invoice','cutting-plans']) vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src',name+'.js'),'utf8'),h.context);
  const setup=h.request('setupOwner',{nama:'Fixture Owner',pin:'1234'}); assert.equal(setup.ok,true,setup.error);
  const owner=setup.data.token, admin='fixture-price-admin-token', cutter='fixture-price-cutter-token';
  const stock=[{id:'price-roll-0001',jenis:'beli',tanggal:'2026-09-01',bahan:'Cotton',qty:20,satuan:'kg',rol:1,harga:0,total:0,stockMode:'roll',rollLabel:'Rol lama',asal:'lama'},...extra];
  h.run(`pkStore_().lock(function(){
    pkStore_().append('Pegawai',{id:'price-admin-001',nama:'Admin',divisi:'admin',aktif:true,token:'${admin}'});
    pkStore_().append('Pegawai',{id:'price-cutter-01',nama:'Potong',divisi:'potong',aktif:true,token:'${cutter}'});
    pkStore_().appendMany('StokBahan',${JSON.stringify(stock)});
  });`);
  function call(action,p={},token=owner){h.cold();return h.request(action,{token,workflowVersion:2,...p});}
  function good(action,p={},token=owner){const r=call(action,p,token);assert.equal(r.ok,true,r.error);return r.data&&r.data.data!==undefined?r.data.data:r.data;}
  function bad(action,p,pattern,token=owner){const r=call(action,p,token);assert.equal(r.ok,false,'operation must reject');if(pattern)assert.match(r.error,pattern);return r;}
  function raw(sheet){h.cold();return h.run(`pkStore_().fresh(${JSON.stringify(sheet)});pkStore_().read(${JSON.stringify(sheet)})`);}
  function prices(){return h.run(`coreStockPrices(${JSON.stringify(raw('StokBahan'))})`);}
  function request(stokId='price-roll-0001',harga=80000,id='price-fix-0001'){return {id,stokId,harga,expectedPriceRevision:prices().byId[stokId].priceRevision,catatan:'Koreksi harga dari bon lama'};}
  return {h,owner,admin,cutter,call,good,bad,raw,prices,request};
}

test('an old used roll gets an audited price without altering weight, cut, purchase, reservation or physical correction',()=>{
  const f=fixture();
  f.h.run(`pkStore_().lock(function(){pkStore_().append('Potong',{id:'price-cut-0001',tanggal:'2026-10-01',bahan:'Cotton',kg:5,bahanList:'[{"nama":"Cotton","qty":5}]',alokasiBahan:'[{"stokId":"price-roll-0001","qty":5}]'});pkStore_().append('RencanaPotong',{id:'price-plan-001',status:'siap',alokasiBahan:'[{"stokId":"price-roll-0001","qty":3}]'});});`);
  const before=f.raw('StokBahan')[0],cuts=f.raw('Potong'),plans=f.raw('RencanaPotong');
  const result=f.good('koreksiHargaBahan',f.request());
  assert.equal(result.jenis,'harga');assert.equal(result.qty,0);assert.equal(result.rol,0);assert.equal(result.total,0);
  assert.equal(result.sourceStockId,before.id);assert.equal(result.harga,80000);assert.ok(result.requestHash);
  assert.deepEqual(f.raw('StokBahan')[0],before);assert.deepEqual(f.raw('Potong'),cuts);assert.deepEqual(f.raw('RencanaPotong'),plans);
  const state=f.good('getState'),m=state.stokRingkas[0],r=state.stokRol[0];
  assert.equal(m.beli,20);assert.equal(m.pakai,5);assert.equal(m.saldo,15);assert.equal(m.koreksi,0);assert.equal(m.hpp,80000);assert.equal(m.nilai,1200000);
  assert.equal(r.saldo,15);assert.equal(r.dicadangkan,3);assert.equal(r.tersedia,12);assert.equal(r.harga,80000);assert.equal(r.priceSource,'koreksi');assert.equal(r.correctionId,result.id);
});

test('material average is weighted by kilos and roll correction does not count a second purchase',()=>{
  const f=fixture([{id:'price-roll-0002',jenis:'beli',tanggal:'2026-10-01',bahan:'Cotton',qty:30,satuan:'kg',rol:1,harga:100000,total:3000000,stockMode:'roll',rollLabel:'Rol 2'}]);
  f.good('koreksiHargaBahan',f.request());
  const p=f.prices(),m=f.good('getState').stokRingkas[0];
  assert.equal(p.materialMap.cotton.qty,50);assert.equal(p.materialMap.cotton.total,4600000);assert.equal(p.materialMap.cotton.hpp,92000);
  assert.equal(m.beli,50);assert.equal(m.rol,2);assert.equal(m.nBeli,2);assert.equal(m.hpp,92000);assert.equal(m.nilai,4600000);
});

test('detailed old roll substitutes its price share and inherits complete aggregate pool price',()=>{
  const f=fixture([{id:'price-pool-0001',jenis:'beli',bahan:'Scuba',qty:100,satuan:'kg',rol:5,harga:80000,total:8000000,asal:'lama'},
    {id:'price-rinci-001',jenis:'rinci',bahan:'Scuba',qty:20,satuan:'kg',rol:1,harga:0,total:0,stockMode:'roll',rollLabel:'Rincian 1'}]);
  assert.equal(f.prices().byId['price-rinci-001'].harga,80000);assert.equal(f.prices().byId['price-rinci-001'].priceComplete,true);
  f.good('koreksiHargaBahan',f.request('price-rinci-001',100000));
  const p=f.prices().materialMap.scuba,m=f.good('getState').stokRingkas.find(r=>r.kunci==='scuba');
  assert.equal(p.qty,100);assert.equal(p.total,8400000);assert.equal(p.hpp,84000);assert.equal(p.missingQty,0);
  assert.equal(m.beli,100);assert.equal(m.saldo,100);assert.equal(m.nBeli,1);assert.equal(m.nilai,8400000);
});

test('opening stock with no purchase can be priced through its positive adjustment or its identified roll',()=>{
  const rows=[{id:'price-opening-01',jenis:'koreksi',bahan:'Drill',qty:10,satuan:'kg',alasan:'stok_awal'},
    {id:'price-rinci-002',jenis:'rinci',bahan:'Drill',qty:10,satuan:'kg',rol:1,stockMode:'roll',rollLabel:'Rol gudang'}];
  const f=fixture(rows);f.good('koreksiHargaBahan',f.request('price-rinci-002',90000));
  let m=f.good('getState').stokRingkas.find(r=>r.kunci==='drill');assert.equal(m.saldo,10);assert.equal(m.beli,0);assert.equal(m.koreksi,10);assert.equal(m.hpp,90000);assert.equal(m.nilai,900000);
  const g=fixture(rows);g.good('koreksiHargaBahan',g.request('price-opening-01',85000));
  assert.equal(g.prices().byId['price-rinci-002'].harga,85000);assert.equal(g.prices().materialMap.drill.qty,10);
});

test('unknown or inconsistent pool prices never become a complete inherited roll price',()=>{
  const f=fixture([{id:'price-pool-001a',jenis:'beli',bahan:'Scuba',qty:10,satuan:'kg',harga:100000,total:1000000},
    {id:'price-pool-001b',jenis:'beli',bahan:'Scuba',qty:10,satuan:'kg',harga:0,total:0},
    {id:'price-rinci-001',jenis:'rinci',bahan:'Scuba',qty:5,satuan:'kg',stockMode:'roll'},
    {id:'price-wrong-001',jenis:'beli',bahan:'Wrong',qty:10,satuan:'kg',harga:10000,total:1,stockMode:'roll'}]);
  let p=f.prices();assert.equal(p.byId['price-rinci-001'].priceComplete,false);assert.equal(p.materialMap.scuba.missingQty,10);assert.equal(p.byId['price-wrong-001'].priceComplete,false);
  f.good('koreksiHargaBahan',f.request('price-wrong-001',10000));p=f.prices();assert.equal(p.byId['price-wrong-001'].priceComplete,true);assert.equal(p.byId['price-wrong-001'].total,100000);
});

test('only owner may correct a price and stale source identity or price revision cannot overwrite newer work',()=>{
  const f=fixture(),request=f.request();f.bad('koreksiHargaBahan',request,/owner/,f.admin);f.bad('koreksiHargaBahan',request,/owner/,f.cutter);
  f.bad('koreksiHargaBahan',{...request,workflowVersion:1},/Versi alur/);
  f.h.run(`pkStore_().lock(function(){pkStore_().update('StokBahan','price-roll-0001',{qty:21});});`);
  f.bad('koreksiHargaBahan',request,/berubah/);
  const next=f.request();f.good('koreksiHargaBahan',next);f.bad('koreksiHargaBahan',{...next,id:'price-fix-0002',harga:85000},/berubah/);
  assert.equal(f.raw('StokBahan').filter(r=>r.jenis==='harga').length,1);
});

test('exact retry is idempotent even after a later correction; changed payload or actor cannot reuse an ID',()=>{
  const f=fixture(),one=f.request();f.good('koreksiHargaBahan',one);const two=f.request('price-roll-0001',90000,'price-fix-0002');f.good('koreksiHargaBahan',two);
  f.good('koreksiHargaBahan',one);assert.equal(f.prices().byId['price-roll-0001'].harga,90000);assert.equal(f.raw('StokBahan').length,3);
  f.bad('koreksiHargaBahan',{...one,harga:81000},/data berbeda/);f.bad('koreksiHargaBahan',{...one,catatan:'Alasan berbeda'},/data berbeda/);
  assert.deepEqual(f.prices().byId['price-roll-0001'].history.map(r=>r.id),[one.id,two.id]);
});

test('invalid prices and missing correction evidence reject without writing',()=>{
  const f=fixture(),request=f.request();
  for(const harga of ['',null,true,false,0,-1,1.5,'abc',Infinity,1e13]) f.bad('koreksiHargaBahan',{...request,harga},/harga/i);
  f.bad('koreksiHargaBahan',{...request,catatan:''},/alasan/);f.bad('koreksiHargaBahan',{...request,expectedPriceRevision:''},/Versi/);
  f.bad('koreksiHargaBahan',{...request,stokId:'missing-source'},/tidak ditemukan/);assert.equal(f.raw('StokBahan').length,1);
});

test('generic stock editing/deletion cannot destroy correction evidence or its aggregate source',()=>{
  const f=fixture([{id:'price-oldpool01',jenis:'beli',bahan:'Scuba',qty:10,satuan:'kg',harga:0,total:0,asal:'lama'}]);
  const req=f.request('price-oldpool01',90000);f.good('koreksiHargaBahan',req);
  f.bad('deleteRecord',{sheet:'StokBahan',id:req.id},/koreksi/);f.bad('deleteRecord',{sheet:'StokBahan',id:req.stokId},/koreksi/);
  const source=f.raw('StokBahan').find(r=>r.id===req.stokId),revision=f.h.run(`coreDomainRevision('StokBahan',${JSON.stringify(source)})`);
  f.bad('saveStok',{stok:{...source,harga:1,total:10},expectedRevision:revision},/koreksi/);
  f.bad('gantiImpor',{data:{StokBahan:[]}},/dipertahankan/);
  f.bad('gantiImpor',{data:{StokBahan:[{...source,qty:15}]}},/dipertahankan/);
  f.bad('importRows',{sheet:'StokBahan',rows:[{id:'price-forged01',jenis:'harga',bahan:'Scuba',harga:1}]},/pencatatan/);
  assert.equal(f.prices().byId[req.stokId].harga,90000);assert.equal(f.raw('StokBahan').length,3);
});

test('normal state retains old source and price history so UI proof equals server proof',()=>{
  const f=fixture([{id:'price-ancient01',jenis:'beli',tanggal:'2020-01-01',bahan:'Scuba',qty:10,satuan:'kg',harga:0,total:0,asal:'lama'},
    {id:'price-old-rinci',jenis:'rinci',tanggal:'2020-02-01',bahan:'Scuba',qty:10,satuan:'kg',stockMode:'roll'}]);
  f.good('koreksiHargaBahan',f.request('price-ancient01',85000));
  const state=f.good('getState'),ui=f.h.run(`coreStockPrices(${JSON.stringify(state.stok)})`),server=f.prices();
  assert.ok(state.stok.find(r=>r.id==='price-ancient01'));assert.ok(state.stok.find(r=>r.id==='price-old-rinci'));
  assert.equal(ui.byId['price-ancient01'].priceRevision,server.byId['price-ancient01'].priceRevision);
  assert.equal(ui.byId['price-old-rinci'].priceRevision,server.byId['price-old-rinci'].priceRevision);
  f.good('koreksiHargaBahan',{id:'price-fix-0020',stokId:'price-old-rinci',harga:86000,expectedPriceRevision:ui.byId['price-old-rinci'].priceRevision,catatan:'Timbang bon gudang'});
  const worker=f.good('getState',{},f.cutter);assert.equal(worker.stok,undefined);assert.equal(worker.stokRol,undefined);assert.ok(worker.bahan.every(r=>r.harga===undefined&&r.hpp===undefined));
});

test('malformed legacy price evidence stays incomplete rather than becoming a cheap valid price',()=>{
  const f=fixture();
  for (const row of [
    {qty:10,harga:true},{qty:10,harga:-1,total:100},{qty:10,harga:100,total:true},
    {qty:10,harga:1e30,total:1e31},{qty:10,harga:1,total:-1},
    {qty:1e15,harga:100,total:1e17}
  ]) {
    const p=f.h.run(`coreStockPrices(${JSON.stringify([{id:'price-invalid1',jenis:'beli',bahan:'Wrong',satuan:'kg',...row}])})`);
    assert.equal(p.byId['price-invalid1'].priceComplete,false,JSON.stringify(row));
  }
});
