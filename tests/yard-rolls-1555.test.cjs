'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');

function fixture() {
  const h = harness();
  for (const name of ['bahan-invoice','cutting-plans','auto-completion','reconcile-legacy','history-corrections','commerce-hpp']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src',name+'.js'),'utf8'),h.context);
  }
  const setup = h.request('setupOwner',{nama:'Measured roll fixture',pin:'1234'});
  assert.equal(setup.ok,true,setup.error);
  const token = setup.data.token;
  const call = (action,payload={}) => { h.cold(); return h.request(action,{token,workflowVersion:2,...payload}); };
  const good = (action,payload={}) => { const r=call(action,payload); assert.equal(r.ok,true,r.error); return r.data?.data ?? r.data; };
  const bad = (action,payload,pattern) => { const r=call(action,payload); assert.equal(r.ok,false); if(pattern)assert.match(r.error,pattern); return r; };
  const raw = name => { h.cold(); return h.run(`pkStore_().fresh(${JSON.stringify(name)});pkStore_().read(${JSON.stringify(name)})`); };
  const state = () => good('getState');
  const stock = name => state().stokRingkas.find(r=>r.nama===name);
  const roll = id => state().stokRol.find(r=>r.id===id);
  const invoice = (items,id='yard-roll-invoice') => ({id,invoice:'TEST-'+id,tanggal:'2026-10-20',items});
  const buy = (items,id) => good('saveInvoiceBahan',{invoice:invoice(items,id)}).rows;
  const prepare = (allocations,id='yard-roll-plan',poId='yard-roll-po') => {
    if(!raw('PO').some(r=>r.id===poId))good('savePO',{deferMaterial:true,po:{newId:poId,nama:'Yard fixture',series:'Fixture',jenis:'stok',ukuran:{},ukuranAktif:['XL']}});
    return good('saveRencanaPotong',{rencana:{id,poId,alokasiBahan:allocations}});
  };
  const cut = (plan,id='yard-roll-cut') => ({potong:{id,rencanaId:plan.id,expectedRencanaRevision:plan.revision,tanggal:'2026-10-20',ukuran:{XL:50}}});
  const correction = (id,physical,requestId='yard-roll-count') => {
    const r=roll(id); return {id:requestId,stokId:id,fisik:physical,satuan:r.satuan,expectedSaldo:r.saldo,expectedCorrectionId:r.correctionRevision,expectedSourceRevision:r.sourceRevision,catatan:'Count fixture'};
  };
  return {h,call,good,bad,raw,state,stock,roll,invoice,buy,prepare,cut,correction};
}

test('a yard invoice records two explicitly entered 100-yard rolls without averaging or converting them',()=>{
  const f=fixture(), inv=f.invoice([{bahan:'Kemeja',satuan:'yard',harga:33000,rolls:[{qty:100},{qty:100}]}]);
  const rows=f.good('saveInvoiceBahan',{invoice:inv}).rows;
  assert.deepEqual(rows.map(r=>[r.qty,r.satuan,r.rol,r.stockMode,r.rollLabel]),[[100,'yard',1,'roll','Rol 1'],[100,'yard',1,'roll','Rol 2']]);
  assert.equal(f.stock('Kemeja').saldo,200); assert.equal(f.stock('Kemeja').legacySaldo,0);
  assert.equal(f.stock('Kemeja').hpp,33000);
  assert.deepEqual(f.state().stokRol.map(r=>[r.saldo,r.satuan,r.tersedia,r.harga]),[[100,'yard',100,33000],[100,'yard',100,33000]]);
  f.good('saveInvoiceBahan',{invoice:inv});
  assert.equal(f.raw('StokBahan').length,2,'a lost invoice response does not duplicate rolls');
  const changed=structuredClone(inv); changed.items[0].rolls[0].qty=99;
  f.bad('saveInvoiceBahan',{invoice:changed},/berbeda/);
});

test('aggregate 200 yards remains aggregate until owner explicitly enters 100 plus 100; itemising adds no stock or value',()=>{
  const f=fixture();
  f.buy([{bahan:'Kemeja',satuan:'yard',harga:33000,qty:200,rol:2}]);
  const before=f.stock('Kemeja'), original=f.raw('StokBahan')[0];
  assert.equal(f.state().stokRol.length,0,'the old rol count is not evidence of individual lengths');
  const payload={id:'yard-itemise-001',bahan:'Kemeja',satuan:'yard',rolls:[{qty:100},{qty:100}]};
  const result=f.good('rinciStokRol',payload);
  assert.deepEqual(result.rows.map(r=>[r.qty,r.satuan,r.jenis]),[[100,'yard','rinci'],[100,'yard','rinci']]);
  const after=f.stock('Kemeja');
  for(const key of ['saldo','beli','pakai','koreksi','nilai','hpp'])assert.equal(after[key],before[key],key);
  assert.equal(after.legacySaldo,0); assert.deepEqual(f.raw('StokBahan')[0],original);
  assert.ok(f.state().stokRol.every(r=>r.harga===33000 && r.priceComplete));
  f.good('rinciStokRol',payload); assert.equal(f.raw('StokBahan').length,3);
  f.bad('rinciStokRol',{...payload,satuan:'kg'},/berbeda/);
  f.bad('rinciStokRol',{...payload,id:'yard-itemise-002',rolls:[{qty:0.001}]},/melebihi/);
});

test('meter rolls preserve unequal lengths and an explicit mismatched unit is rejected without writes',()=>{
  const f=fixture(), rows=f.buy([{bahan:'Furing',satuan:'meter',harga:9000,rolls:[{qty:42.125},{qty:19.875}]}]);
  assert.deepEqual(f.state().stokRol.map(r=>[r.saldo,r.satuan]),[[42.125,'meter'],[19.875,'meter']]);
  const before=f.raw('StokBahan');
  f.bad('saveStok',{stok:{...rows[0],satuan:'yard',qty:42.125}},/Satuan|satuan/);
  assert.deepEqual(f.raw('StokBahan'),before);
  f.prepare([{stokId:rows[0].id,qty:40}]);
  assert.equal(f.roll(rows[0].id).dicadangkan,40); assert.equal(f.roll(rows[0].id).tersedia,2.125);
});

test('partial yard reservation and cut consume exactly once and retain yard evidence instead of kilogram totals',()=>{
  const f=fixture(), rows=f.buy([{bahan:'Kemeja',satuan:'yard',harga:33000,rolls:[{qty:100},{qty:100}]}]);
  const before=f.raw('StokBahan'), plan=f.prepare([{stokId:rows[0].id,qty:60}]);
  assert.equal(f.stock('Kemeja').saldo,200); assert.equal(f.stock('Kemeja').tersedia,140);
  assert.equal(f.roll(rows[0].id).tersedia,40); assert.equal(f.roll(rows[1].id).tersedia,100);
  assert.deepEqual(plan.bahanList,[{nama:'Kemeja',qty:60,satuan:'yard'}]);
  const payload=f.cut(plan), cut=f.good('createPotong',payload);
  assert.equal(cut.kg,0); assert.deepEqual(JSON.parse(cut.bahanList),[{nama:'Kemeja',qty:60,satuan:'yard'}]);
  f.good('createPotong',payload);
  assert.equal(f.raw('Potong').length,1); assert.equal(f.stock('Kemeja').saldo,140);
  assert.equal(f.roll(rows[0].id).saldo,40); assert.equal(f.roll(rows[0].id).dicadangkan,0);
  assert.deepEqual(f.raw('StokBahan'),before);
  f.bad('createPotong',f.cut(plan,'yard-second-cut'),/sudah dipakai/);
});

test('mixed kg, yard and meter allocations retain separate quantities and use each material price in HPP',()=>{
  const f=fixture(), rows=f.buy([
    {bahan:'Body',satuan:'yard',harga:33000,rolls:[{qty:100}]},
    {bahan:'Sleeve',satuan:'kg',harga:88000,rolls:[{qty:25}]},
    {bahan:'Lining',satuan:'meter',harga:9000,rolls:[{qty:10}]}
  ]);
  const plan=f.prepare(rows.map(r=>({stokId:r.id,qty:r.qty})));
  const cut=f.good('createPotong',f.cut(plan));
  assert.equal(cut.kg,25); assert.equal(cut.rol,3);
  assert.deepEqual(JSON.parse(cut.bahanList).map(b=>[b.satuan,b.qty]),[['yard',100],['kg',25],['meter',10]]);
  for(const name of ['Body','Sleeve','Lining'])assert.equal(f.stock(name).saldo,0);
  const input={tables:{PO:f.raw('PO'),Potong:f.raw('Potong'),StokBahan:f.raw('StokBahan'),RencanaPotong:f.raw('RencanaPotong')},config:{modelConfigs:{},marketplace:{},pajak:0}};
  f.h.context.HPP_ROLL_INPUT=JSON.stringify(input);
  const hpp=f.h.run('coreCommerceHpp(JSON.parse(HPP_ROLL_INPUT))').models[0];
  assert.equal(hpp.kain.totalCost,5590000);
  assert.equal(hpp.kain.perPcs,111800);
  assert.deepEqual(hpp.kain.observasi.qtyByUnit,{yard:100,kg:25,meter:10});
  assert.equal(hpp.kain.observasi.totalKg,25);
});

test('owner can correct a yard roll physical balance and a second phone stale count cannot overwrite it',()=>{
  const f=fixture(), row=f.buy([{bahan:'Kemeja',satuan:'yard',harga:33000,rolls:[{qty:100}]}])[0];
  const first=f.correction(row.id,95), stale=f.correction(row.id,92,'yard-stale-count');
  const saved=f.good('cocokkanStokRol',first);
  assert.equal(saved.qty,-5); assert.equal(saved.satuan,'yard'); assert.equal(f.stock('Kemeja').saldo,95);
  f.good('cocokkanStokRol',first); assert.equal(f.stock('Kemeja').saldo,95);
  f.bad('cocokkanStokRol',stale,/berubah/);
  f.bad('cocokkanStokRol',{...f.correction(row.id,94,'yard-wrong-count'),satuan:'kg'},/Satuan/);
  f.prepare([{stokId:row.id,qty:90}]);
  f.bad('cocokkanStokRol',f.correction(row.id,89,'yard-under-count'),/dicadangkan/);
  assert.equal(f.roll(row.id).saldo,95);
});

test('editing an unused yard purchase preserves its unit; stale edit or reserved roll edit is blocked',()=>{
  const f=fixture(), row=f.buy([{bahan:'Kemeja',satuan:'yard',harga:33000,rolls:[{qty:100}]}])[0];
  const source=f.state().stok.find(r=>r.id===row.id), changed={...row,qty:99,total:3267000};
  f.good('saveStok',{stok:changed,expectedRevision:source.revision});
  assert.equal(f.stock('Kemeja').saldo,99); assert.equal(f.roll(row.id).satuan,'yard');
  f.bad('saveStok',{stok:{...changed,qty:98,total:3234000},expectedRevision:source.revision},/berubah/);
  f.prepare([{stokId:row.id,qty:90}]);
  f.bad('saveStok',{stok:{...changed,qty:98,total:3234000}},/dipakai, dicadangkan/);
  assert.equal(f.stock('Kemeja').saldo,99);
});

test('a stale cut cannot use a different material unit and concurrent preparations cannot over-reserve a yard roll',()=>{
  const f=fixture(), row=f.buy([{bahan:'Kemeja',satuan:'yard',harga:33000,rolls:[{qty:100}]}])[0];
  const plan=f.prepare([{stokId:row.id,qty:60}]);
  f.bad('saveRencanaPotong',{rencana:{id:'yard-over-plan',poId:plan.poId,alokasiBahan:[{stokId:row.id,qty:40.001}]}},/melebihi/);
  const cols=f.h.sheets.StokBahan.values[0], sheetRow=f.h.sheets.StokBahan.values.find(r=>r[cols.indexOf('id')]===row.id);
  sheetRow[cols.indexOf('satuan')]='meter';
  f.bad('createPotong',f.cut(plan),/berubah/);
  assert.equal(f.raw('Potong').length,0);
});

test('rinci yard edits only redistribute the old pool; wrong unit, stale amount, and reserved rolls are rejected',()=>{
  const f=fixture(); f.buy([{bahan:'Kemeja',satuan:'yard',harga:33000,qty:200,rol:2}]);
  const payload={id:'yard-rinci-edit',bahan:'Kemeja',satuan:'yard',rolls:[{qty:100}]};
  const row=f.good('rinciStokRol',payload).rows[0];
  f.good('ubahRinciRol',{id:row.id,qty:90,expectedQty:100,satuan:'yard'});
  assert.equal(f.stock('Kemeja').saldo,200); assert.equal(f.stock('Kemeja').legacySaldo,110);
  f.bad('ubahRinciRol',{id:row.id,qty:80,expectedQty:100,satuan:'yard'},/sudah berubah/);
  f.bad('ubahRinciRol',{id:row.id,qty:80,expectedQty:90,satuan:'kg'},/Satuan/);
  f.prepare([{stokId:row.id,qty:80}]);
  f.bad('ubahRinciRol',{id:row.id,qty:85,expectedQty:90,satuan:'yard'},/dipakai, dicadangkan/);
  f.bad('rinciStokRol',{id:'yard-rinci-too-much',bahan:'Kemeja',satuan:'yard',rolls:[{qty:110.001}]},/melebihi/);
});

test('malformed or mixed units reject the whole invoice with no partial material writes',()=>{
  for(const badItem of [
    {bahan:'Bad',satuan:'yd',harga:1000,rolls:[{qty:100}]},
    {bahan:'Bad',satuan:'liter',harga:1000,rolls:[{qty:100}]},
    {bahan:'Bad',satuan:'yard',harga:1000,rolls:[{qty:100,satuan:'kg'}]},
    {bahan:'Bad',satuan:'yard',harga:1000,rolls:[{qty:true}]},
    {bahan:'Bad',satuan:'yard',harga:1000,rolls:[{qty:100.0001}]},
    {bahan:' Kemeja ',satuan:'kg',harga:1000,rolls:[{qty:25}]}
  ]){
    const f=fixture(),before=f.raw('StokBahan');
    f.bad('saveInvoiceBahan',{invoice:f.invoice([{bahan:'Kemeja',satuan:'yard',harga:33000,rolls:[{qty:100}]},badItem])});
    assert.deepEqual(f.raw('StokBahan'),before);
  }
});
