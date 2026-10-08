'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = ['core.js', 'bahan-invoice.js'].map(name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8')).join('\n');
function fixture() {
  const c = vm.createContext({});
  vm.runInContext(source + `
    var db={},config={},events=[],locked=false,serial=0,failAfter=-1,validationError=false,migrationAtLock=false;
    Object.keys(SCHEMA).forEach(function(s){db[s]=[];});
    db.Pegawai=[{id:'owner01',nama:'Owner',divisi:'owner',aktif:true,token:'owner-token-123456789'},
      {id:'admin01',nama:'Admin',divisi:'admin',aktif:true,token:'admin-token-123456789'},
      {id:'worker01',nama:'Worker',divisi:'jahit',aktif:true,token:'worker-token-12345678'},
      {id:'cutter01',nama:'Cutter',divisi:'potong',aktif:true,token:'cutter-token-12345678'},
      {id:'qcuser01',nama:'QC',divisi:'qc',aktif:true,token:'qcuser-token-12345678'}];
    db.StokBahan=[{id:'legacy01',jenis:'beli',tanggal:'2026-01-01',bahan:'Katun Combed',qty:10,satuan:'kg',rol:1,harga:10000,total:100000,invoice:'OLD-1',supplier:'Supplier lama',dibuat:'2026-01-01T00:00:00Z',asal:'lama'},
      {id:'legacy02',jenis:'koreksi',tanggal:'2026-01-02',bahan:'Katun Combed',qty:-1,satuan:'kg',rol:0,harga:0,total:0,alasan:'rusak',asal:'lama'}];
    function clone(v){return JSON.parse(JSON.stringify(v));}
    var store={read:function(s){return db[s]||[];},
      append:function(s,r){events.push({op:'append',sheet:s});db[s].push(clone(r));},
      appendMany:function(s,rs){if(!locked)throw Error('write outside lock');events.push({op:'appendMany',sheet:s,count:rs.length});
        if(failAfter>=0){var n=failAfter;failAfter=-1;db[s]=db[s].concat(clone(rs.slice(0,n)));throw Error('response interrupted');}db[s]=db[s].concat(clone(rs));},
      update:function(s,id,p){events.push({op:'update',sheet:s});Object.assign(db[s].find(function(r){return r.id===id;}),clone(p));},
      remove:function(s,id){events.push({op:'remove',sheet:s});db[s]=db[s].filter(function(r){return r.id!==id;});},
      validateRows:function(s,rs){events.push({op:'validateRows',sheet:s,count:rs.length});if(validationError)throw Error('cell capacity rejected');},
      checkpoint:function(ss){events.push({op:'checkpoint',sheets:ss.slice(),locked:locked});},
      getSettings:function(){return config;},version:function(){return 1;},
      lock:function(fn){if(locked)throw Error('nested lock');locked=true;if(migrationAtLock)config.legacyMigrationStatus={batchId:'pending'};try{return fn();}finally{locked=false;}}};
    var core=createCore(store,{now:function(){return new Date('2026-10-08T08:00:00Z');},id:function(){return 'generated'+(++serial);}});
  `, c);
  const run = js => JSON.parse(JSON.stringify(vm.runInContext(js, c)));
  const call = (invoice, token = 'owner-token-123456789') => run(`core.handle('saveInvoiceBahan',JSON.parse(${JSON.stringify(JSON.stringify({ invoice, token, workflowVersion: 2 }))}))`);
  return { c, run, call, rows: () => run('db.StokBahan'), writes: () => run('events.filter(function(e){return /^(append|appendMany|update|remove)$/.test(e.op);})') };
}
function item(extra = {}) { return { bahan: 'Katun Combed', qty: 1.25, satuan: 'kg', rol: 1, harga: 12000, ...extra }; }
function invoice(items = [item()], extra = {}) {
  return { id: 'invoice001', invoice: 'BON-001', tanggal: '2026-10-08', supplier: 'Supplier contoh', sumber: 'Toko', catatan: 'Pembelian bahan', items, ...extra };
}

test('thirty rows use one batch append, canonical material names and exact totals without editing history', () => {
  const a = fixture(), old = a.rows();
  const items = Array.from({ length: 30 }, (_, i) => item({ bahan: i % 2 ? ' katun   COMBED ' : 'KATUN COMBED', qty: 1 + i / 1000, harga: 12000 + i, rol: i % 3 }));
  const saved = a.call(invoice(items));
  assert.deepEqual(a.rows().slice(0, 2), old);
  assert.deepEqual(a.writes(), [{ op: 'appendMany', sheet: 'StokBahan', count: 30 }]);
  assert.equal(saved.data.rows.length, 30);
  assert.equal(saved.data.total, items.reduce((sum, row) => sum + Math.round(row.qty * row.harga), 0));
  assert.ok(saved.data.rows.every((r, i) => r.bahan === 'Katun Combed' && r.invoiceId === 'invoice001' && r.id === 'invoice001_30_' + (i + 1)));
  assert.equal(saved.state.stokRingkas.filter(r => r.kunci === 'katun combed').length, 1);
  assert.ok(a.run('events.some(function(e){return e.op==="checkpoint"&&e.sheets.length===1&&e.sheets[0]==="StokBahan"&&e.locked;})'));
  const writes = a.writes().length;
  assert.deepEqual(a.call(invoice(items)).data, saved.data);
  assert.equal(a.writes().length, writes, 'lost-response retry must not append again');
});

test('new materials with equivalent spacing/case share the first name and preserve decimal quantities', () => {
  const a = fixture();
  const saved = a.call(invoice([
    item({ bahan: 'Linen Soft', qty: '1.250', harga: '100.5', rol: '0', satuan: 'meter' }),
    item({ bahan: ' linen    SOFT ', qty: '0.001', harga: '0', rol: 0, satuan: 'meter' })
  ]));
  assert.deepEqual(saved.data.rows.map(r => [r.bahan, r.qty, r.rol, r.harga, r.total]), [
    ['Linen Soft', 1.25, 0, 100.5, 126], ['Linen Soft', 0.001, 0, 0, 0]
  ]);
  assert.equal(saved.data.total, 126);
});

test('invalid quantity, price or rolls in the last row rejects the whole invoice before any write', () => {
  const cases = {
    qty: [0, -1, '', ' ', null, true, false, [], [2], {}, 'NaN', 'Infinity', '0x10', 100000001, 0.0004, 1.23456],
    harga: ['', ' ', null, true, false, [], [2], {}, -1, 'invalid', 'Infinity', 1000000000001],
    rol: ['', ' ', null, true, false, [], [2], {}, -1, 1.5, 'invalid', 'Infinity', 1000001]
  };
  for (const [field, values] of Object.entries(cases)) {
    for (const value of values) {
      const a = fixture(), old = a.rows();
      assert.throws(() => a.call(invoice([item(), item({ [field]: value })])), /Jumlah|jumlah|harga|Harga|rol|desimal/, field + '=' + JSON.stringify(value));
      assert.deepEqual(a.rows(), old);
      assert.deepEqual(a.writes(), []);
    }
  }
});

test('unit conflicts against history or another invoice row reject all rows', () => {
  for (const items of [
    [item({ bahan: 'Baru', satuan: 'yard' }), item({ bahan: 'katun combed', satuan: 'meter' })],
    [item({ bahan: 'Linen Soft', satuan: 'kg' }), item({ bahan: ' linen  SOFT ', satuan: 'meter' })],
    [item(), item({ satuan: 'roll' })]
  ]) {
    const a = fixture(), old = a.rows();
    assert.throws(() => a.call(invoice(items)), /Satuan|Satuan|satuan/);
    assert.deepEqual(a.rows(), old); assert.deepEqual(a.writes(), []);
  }
});

test('a lost response or a partial persisted batch resumes only missing stable row IDs', () => {
  for (const committed of [0, 2, 3]) {
    const a = fixture(), old = a.rows(), inv = invoice([item(), item({ qty: 2 }), item({ qty: 3 })]);
    a.c.failAfter = committed;
    assert.throws(() => a.call(inv), /response interrupted/);
    assert.equal(a.rows().length, old.length + committed);
    const receipt = a.call(inv).data;
    assert.equal(a.rows().length, old.length + 3);
    assert.deepEqual(a.rows().slice(0, old.length), old);
    assert.equal(new Set(a.rows().map(r => r.id)).size, a.rows().length);
    assert.equal(receipt.total, 75000);
    assert.deepEqual(a.writes().map(e => e.count), committed === 3 ? [3] : [3, 3 - committed]);
    const final = a.rows();
    a.call(inv); assert.deepEqual(a.rows(), final);
  }
});

test('changed replay content, changed row count and legacy ID collisions never overwrite existing stock', () => {
  const a = fixture(), inv = invoice([item(), item({ qty: 2 })]);
  a.call(inv); const before = a.rows(), writeCount = a.writes().length;
  for (const changed of [
    invoice([item({ qty: 3 }), item({ qty: 2 })]),
    invoice([item()]),
    invoice([item(), item({ qty: 2 }), item({ qty: 3 })]),
    invoice([item(), item({ qty: 2 })], { invoice: 'DIFFERENT-BON' }),
    invoice([item(), item({ qty: 2 })], { supplier: 'Other supplier' })
  ]) {
    assert.throws(() => a.call(changed), /berbeda/);
    assert.deepEqual(a.rows(), before); assert.equal(a.writes().length, writeCount);
  }
  const b = fixture(); b.run("db.StokBahan[0].id='invoice001_1_1';true");
  const original = b.rows();
  assert.throws(() => b.call(invoice()), /berbeda/);
  assert.deepEqual(b.rows(), original); assert.deepEqual(b.writes(), []);
  const partial = fixture(); partial.c.failAfter = 1;
  assert.throws(() => partial.call(inv), /response interrupted/);
  const partlySaved = partial.rows();
  assert.throws(() => partial.call(invoice([item(), item({ qty: 2 }), item({ qty: 3 })])), /berbeda/);
  assert.deepEqual(partial.rows(), partlySaved);
});

test('only owner/admin can save; a migration that starts under the lock blocks every invoice write', () => {
  for (const token of ['worker-token-12345678', 'cutter-token-12345678', 'qcuser-token-12345678', 'invalid-token']) {
    const a = fixture(), old = a.rows();
    assert.throws(() => a.call(invoice(), token), /owner|admin|Sesi|login/);
    assert.deepEqual(a.rows(), old); assert.deepEqual(a.writes(), []);
  }
  const admin = fixture(); admin.call(invoice(), 'admin-token-123456789');
  assert.equal(admin.rows()[2].dibuatOleh, 'admin01');
  for (const mode of ['alreadyPending', 'startsAtLock']) {
    const a = fixture(), old = a.rows();
    if (mode === 'alreadyPending') a.run("config.legacyMigrationStatus={batchId:'pending'};true");
    else a.c.migrationAtLock = true;
    assert.throws(() => a.call(invoice()), /Pemulihan riwayat belum selesai/);
    assert.deepEqual(a.rows(), old); assert.deepEqual(a.writes(), []);
  }
});

test('calendar dates, batch limits, safe money bounds and adapter preflight fail before writes', () => {
  const malformed = [
    invoice([], {}), invoice(Array.from({ length: 31 }, () => item())),
    invoice([item()], { id: 'short' }), invoice([item()], { invoice: ' ' }),
    invoice([item()], { tanggal: '2026-02-29' }), invoice([item()], { tanggal: '2026-04-31' }),
    invoice([item()], { tanggal: '2026-13-01' }), invoice([item()], { tanggal: 'invalid' }),
    invoice([item({ qty: 100000000, harga: 1000000000000 })]),
    invoice([item({ qty: 100000000, harga: 90000000 }), item({ qty: 100000000, harga: 90000000 })])
  ];
  for (const inv of malformed) {
    const a = fixture(), old = a.rows();
    assert.throws(() => a.call(inv)); assert.deepEqual(a.rows(), old); assert.deepEqual(a.writes(), []);
  }
  const validLeap = fixture(); validLeap.call(invoice([item()], { tanggal: '2028-02-29' }));
  assert.equal(validLeap.rows()[2].tanggal, '2028-02-29');
  const capacity = fixture(), old = capacity.rows(); capacity.c.validationError = true;
  assert.throws(() => capacity.call(invoice()), /cell capacity rejected/);
  assert.deepEqual(capacity.rows(), old); assert.deepEqual(capacity.writes(), []);
});
