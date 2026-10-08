'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function core() {
  const context = vm.createContext({});
  for (const file of ['core.js','cutting-plans.js','bahan-invoice.js']) vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src',file),'utf8'),context);
  return function run(code) { const result = vm.runInContext(code,context); return result === undefined ? undefined : JSON.parse(JSON.stringify(result)); };
}
test('cached multiply preserves every source and cache fingerprint exactly', () => {
  const run=core();
  function original(s) { let h1=0x811c9dc5,h2=5381;s=String(s);for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);h1=Math.imul(h1^c,16777619)>>>0;h2=(Math.imul(h2,33)^c)>>>0;}return h1.toString(36)+h2.toString(36); }
  for(const value of ['',null,0,'Cotton / Rol 1','Kain é 棉 🧵','x'.repeat(10000)]) assert.equal(run(`coreHash(${JSON.stringify(value)})`),original(value));
});
test('individual weights are never inferred from aggregate counts or flat marked rows', () => {
  const run = core();
  assert.deepEqual(run(`coreFlattenInvoiceRolls([{bahan:'Cotton',satuan:'kg',qty:21,rol:5,harga:10}])`),[{bahan:'Cotton',satuan:'kg',qty:21,rol:5,harga:10}]);
  for (const items of [
    [{bahan:'Cotton',satuan:'kg',qty:21,rol:5,stockMode:'roll'}],
    [{bahan:'Cotton',satuan:'meter',rolls:[{qty:4}]}],
    [{bahan:'Cotton',satuan:'kg',rolls:[]}]
  ]) assert.throws(() => run(`coreFlattenInvoiceRolls(${JSON.stringify(items)})`));
});
test('changing a legacy cutoff cannot restore already consumed identified roll weight', () => {
  const run = core();
  const result = run(`var stock=[{id:'roll001',jenis:'beli',stockMode:'roll',bahan:'Cotton',qty:5,satuan:'kg',rol:1}];
    var cuts=[{tanggal:'2026-01-01',bahanList:[{nama:'Cotton',qty:2}],alokasiBahan:[{stokId:'roll001',qty:2}]}];
    coreRollInventory(cuts,stock,{stokMulai:'2026-10-01'},[])`);
  assert.equal(result.materials[0].saldo,3);
  assert.equal(result.rolls[0].saldo,3);
  assert.equal(result.legacy[0].saldo,0);
});
test('unmapped negative aggregate correction holds source selection without inventing affected roll', () => {
  const run = core();
  const result = run(`var stock=[{id:'roll001',jenis:'beli',stockMode:'roll',bahan:'Cotton',qty:5,satuan:'kg',rol:1},
    {id:'count001',jenis:'koreksi',bahan:'Cotton',qty:-1,satuan:'kg'}];
    var inventory=coreRollInventory([],stock,{},[]);inventory`);
  assert.equal(result.rolls[0].saldo,5,'original receipt evidence stays intact');
  assert.equal(result.rolls[0].status,'periksa');
  assert.equal(result.rolls[0].tersedia,0);
  assert.equal(result.legacy[0].saldo,-1);
  assert.throws(() => run(`coreRollSelection([{stokId:'roll001',qty:1}],inventory)`),/stok/);
});
test('cancelled reservations release source quantities while consumed plan link wins over raw status', () => {
  const run = core();
  const result = run(`coreRollInventory([{rencanaId:'plan001',alokasiBahan:[{stokId:'roll001',qty:2}],bahanList:[{nama:'Cotton',qty:2}]}],
    [{id:'roll001',jenis:'beli',stockMode:'roll',bahan:'Cotton',qty:5,satuan:'kg',rol:1}],{},
    [{id:'plan001',status:'siap',alokasiBahan:[{stokId:'roll001',qty:2}],bahanList:[{nama:'Cotton',qty:2}]},
    {id:'plan002',status:'batal',alokasiBahan:[{stokId:'roll001',qty:3}],bahanList:[{nama:'Cotton',qty:3}]}])`);
  assert.equal(result.rolls[0].pakai,2);
  assert.equal(result.rolls[0].dicadangkan,0);
  assert.equal(result.rolls[0].tersedia,3);
});
test('an unfinished creation is a permitted preexisting orphan, not permission to delete its saved PO', () => {
  const run = core();
  run(`var plan={id:'plan001',poId:'po00001',status:'siap',poDraft:{newId:'po00001'}};`);
  assert.equal(run(`coreCutValidateReplacement([],[],[plan],[],[])`),true);
  assert.throws(() => run(`coreCutValidateReplacement([],[],[plan],[],[{id:'po00001'}])`),/dipertahankan/);
  assert.throws(() => run(`coreCutValidateReplacement([],[],[plan],[])`),/dipertahankan/);
});
