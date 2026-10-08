'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness,Sheet}=require('./helpers/apps-script-harness.cjs');
function meter(sheet){
  const count={last:0,max:0,values:0,dataRange:0};let inDataRange=false;
  const last=sheet.getLastRow.bind(sheet),max=sheet.getMaxRows.bind(sheet),dataRange=sheet.getDataRange.bind(sheet),getRange=sheet.getRange.bind(sheet);
  sheet.getLastRow=()=>{if(!inDataRange)count.last++;return last();};sheet.getMaxRows=()=>{count.max++;return max();};
  sheet.getDataRange=()=>{count.dataRange++;inDataRange=true;try{return dataRange();}finally{inDataRange=false;}};
  sheet.getRange=(...args)=>{const r=getRange(...args),values=r.getValues.bind(r);r.getValues=()=>{count.values++;return values();};return r;};
  return count;
}
function setup(){const h=harness();h.run('pkStore_().ensureAll();');h.cold();return h;}
test('physical reads and checkpoints need values but no separate row-count or capacity metadata',()=>{
  const h=setup(),m=meter(h.sheets.Produk);
  assert.deepEqual(h.run('pkStore_().read("Produk")'),[]);assert.deepEqual(m,{last:0,max:0,values:1,dataRange:1});
  h.run('pkStore_().checkpoint(["Produk"]);');assert.deepEqual(m,{last:0,max:0,values:2,dataRange:2});
});
test('first append after a read checks capacity lazily and later appends reuse the measured capacity',()=>{
  const h=setup(),sheet=h.sheets.Produk;sheet.maxRows=1;const m=meter(sheet);
  h.run(`pkStore_().lock(function(){var s=pkStore_();s.read('Produk');s.append('Produk',{id:'prod001',nama:'One'});s.append('Produk',{id:'prod002',nama:'Two'});});`);
  assert.equal(m.max,1);assert.equal(m.last,0);assert.equal(sheet.values.length,3);assert.ok(sheet.maxRows>=3);
  h.cold();assert.deepEqual(h.run('pkStore_().read("Produk").map(function(r){return r.nama;})'),['One','Two']);
});
test('updating a row never needs capacity and preserves reordered and extra columns',()=>{
  const h=harness({Produk:[['memo','nama','id'],['untouched','Before','prod001']]});h.run('pkStore_().read("Produk");');h.cold();const m=meter(h.sheets.Produk);
  h.run(`pkStore_().lock(function(){pkStore_().update('Produk','prod001',{nama:'After'});});`);
  assert.equal(m.max,0);assert.equal(m.last,0);assert.equal(h.sheets.Produk.values[1][0],'untouched');assert.equal(h.sheets.Produk.values[1][1],'After');
});
test('deleting without a previous capacity read still permits a later append to expand safely',()=>{
  const h=setup();h.run(`pkStore_().lock(function(){pkStore_().append('Produk',{id:'prod001',nama:'One'});});`);h.sheets.Produk.maxRows=2;h.cold();const m=meter(h.sheets.Produk);
  h.run(`pkStore_().lock(function(){var s=pkStore_();s.read('Produk');s.remove('Produk','prod001');s.appendMany('Produk',[{id:'prod002',nama:'Two'},{id:'prod003',nama:'Three'}]);});`);
  assert.equal(m.max,1);assert.equal(m.last,0);assert.ok(h.sheets.Produk.maxRows>=3);assert.deepEqual(h.run('pkStore_().read("Produk").map(function(r){return r.id;})'),['prod002','prod003']);
});
test('a fully empty existing sheet gets real headers before the first data append',()=>{
  const h=harness({Produk:[]}),m=meter(h.sheets.Produk);assert.deepEqual(h.run('pkStore_().read("Produk")'),[]);
  assert.deepEqual(h.sheets.Produk.values[0],h.run('SCHEMA.Produk'));assert.equal(m.max,0);
  h.run(`pkStore_().lock(function(){pkStore_().append('Produk',{id:'prod001',nama:'One'});});`);
  assert.equal(h.sheets.Produk.values[1][h.sheets.Produk.values[0].indexOf('id')],'prod001');assert.equal(m.max,1);
});
test('staged PIN verification updates the physical account row without capacity reads',()=>{
  const h=harness(),setup=h.request('setupOwner',{nama:'Fixture',pin:'1234'});h.cold();const m=meter(h.sheets.Pegawai);
  const r=h.request('login',{userId:setup.data.state.me.id,pin:'1234',deferState:true});assert.equal(r.ok,true,r.error);assert.equal(r.data.deferredState,true);assert.deepEqual(m,{last:0,max:0,values:1,dataRange:1});
});
