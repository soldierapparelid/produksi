'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');

// Cross-module import/read/write checks through the real Sheets adapter. Each
// request discards request-local state; fixture data is wholly synthetic.
function fixture() {
  const h = harness();
  for (const name of ['reconcile-legacy', 'commerce-hpp', 'slip-models', 'commerce', 'commerce-migration']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', name + '.js'), 'utf8'), h.context);
  }
  const setup = h.request('setupOwner', { nama: 'Fixture Owner', pin: '1234' });
  assert.equal(setup.ok, true, setup.error);
  function call(action, payload = {}) {
    h.cold();
    return h.request(action, { token: setup.data.token, workflowVersion: 2, ...payload });
  }
  function good(action, payload) {
    const r = call(action, payload);
    assert.equal(r.ok, true, r.error);
    return r.data;
  }
  function read(table) {
    h.cold();
    return h.run(`pkStore_().fresh(${JSON.stringify(table)});pkStore_().read(${JSON.stringify(table)})`);
  }
  function importBackup(backup) {
    const proof = good('previewCommerceImport', { backup });
    good('applyCommerceImport', { backup, sourceHash: proof.sourceHash, planHash: proof.planHash });
    return proof;
  }
  return { h, call, good, read, importBackup };
}
function note(payment, total = 10000) {
  return { id: 'note-fixture', date: '2026-10-08', customer: { name: 'Fixture customer' }, total,
    items: [{ id: 'line-fixture', name: 'Shirt', qty: 1, price: 10000, subtotal: 10000 }], payment };
}
function notaBackup(n) { return { notaPenjualan_v1: { transactions: [n] } }; }
function purchaseBackup(extra = {}) {
  return { soldier_pembelian_produk: {
    suppliers: [{ id: 'supplier-fixture', nama: 'Fixture supplier' }],
    produk: [{ id: 'product-fixture', nama: 'Fixture shirt', supplierId: 'supplier-fixture' }],
    orders: [{ id: 'order-fixture', produkId: 'product-fixture', tanggalOrder: '2026-10-08',
      items: [{ id: 'item-fixture', nama: 'M', jumlah: 2 }], hargaSatuan: 5000, totalHarga: 10000, ...extra }]
  } };
}
function assertCannotCollect(f, module, record) {
  const r = f.call('appendCommercePayment', { id: 'new-payment', module, parentId: record.id,
    expectedRevision: record.revision, tanggal: '2026-10-08', jumlah: 1000 });
  assert.equal(r.ok, false, 'ambiguous historical evidence must not create a new payable balance');
  assert.match(r.error, /riwayat|periksa/i);
}

test('unreadable initial nota payment is retained as review evidence and cannot be collected again', () => {
  const f = fixture(), n = note({ method: 'transfer', amount: 'unreadable', status: 'dp' });
  const proof = f.importBackup(notaBackup(n));
  const record = f.good('getCommerceState', { module: 'nota' }).notes[0];
  assert.equal(proof.summary.paymentReview, 1);
  assert.equal(record.paymentReview, true);
  assertCannotCollect(f, 'nota', record);
  assert.deepEqual(JSON.parse(f.read('CommerceSource').find(r => r.kind === 'nota').data), n);
});

test('unreadable historical settlement is held while ordinary numeric legacy amounts still settle exactly', () => {
  const f = fixture(), n = note({ method: 'cash', amount: '2000', change: 0,
    pelunasan: [{ date: '2026-10-08', amount: 'not-known', method: 'transfer' }] });
  f.importBackup(notaBackup(n));
  const record = f.good('getCommerceState', { module: 'nota' }).notes[0];
  assert.equal(record.totalPaid, 2000);
  assert.equal(record.paymentReview, true);
  assertCannotCollect(f, 'nota', record);
  const clean = fixture();
  clean.importBackup(notaBackup(note({ method: 'cash', amount: '10000', change: '0' })));
  const normal = clean.good('getCommerceState', { module: 'nota' }).notes[0];
  assert.equal(normal.paymentReview, false);
  assert.equal(normal.totalPaid, 10000);
  assert.equal(normal.balance, 0);
});

test('missing or nonnumeric historical invoice totals are not silently treated as settled zero', () => {
  for (const value of ['not-known', null]) {
    const f = fixture();
    f.importBackup(purchaseBackup({ totalHarga: value }));
    const record = f.good('getCommerceState', { module: 'pembelian' }).orders[0];
    assert.equal(record.paymentReview, true, 'raw total ' + String(value));
    assert.equal(record.status, 'review', 'unreadable total cannot be displayed as paid');
    assertCannotCollect(f, 'pembelian', record);
  }
});

test('legacy purchase ket is visible in payment and receipt history and the printable model', () => {
  const f = fixture(), backup = purchaseBackup({
    pembayaran: [{ id: 'payment-original', tanggal: '2026-10-08', jumlah: 2000, ket: 'Transfer batch fixture' }],
    penerimaan: [{ id: 'receipt-original', tanggal: '2026-10-08', itemId: 'item-fixture', jumlah: 1, ket: 'Count fixture', kondisi: 'baik' }]
  });
  f.importBackup(backup);
  const record = f.good('getCommerceState', { module: 'pembelian' }).orders[0];
  assert.equal(record.payments[0].catatan, 'Transfer batch fixture');
  assert.equal(record.receipts[0].catatan, 'Count fixture');
  f.h.context.REVIEW_ORDER = record;
  const model = f.h.run(`coreCommerceSlipModel('pembelian', REVIEW_ORDER, {})`);
  assert.ok(model.sections.some(s => s.rows.some(row => row.includes('Transfer batch fixture'))));
});

test('additive admin import preserves populated production, stock and payroll and never restores offline PO drafts', () => {
  const f = fixture();
  f.h.run(`pkStore_().lock(function(){
    pkStore_().append('PO',{id:'production-existing',noPO:'FIX-001',namaBarang:'Fixture',status:'aktif',ukuran:'{"M":2}',total:2});
    pkStore_().append('StokBahan',{id:'stock-existing',bahan:'Fixture fabric',tipe:'masuk',qty:10,satuan:'kg',harga:20000});
    pkStore_().append('SlipUpah',{id:'paid-existing',itemIds:'["source-existing"]',total:12000});
  });void 0;`);
  const before = Object.fromEntries(['PO', 'StokBahan', 'SlipUpah'].map(t => [t, f.read(t)]));
  const b = purchaseBackup();
  b.soldier_pembelian_produk.pesananOffline = Array.from({ length: 8 }, (_, i) => ({ id: 'offline-' + i, nama: 'Offline fixture' }));
  b.produksi = { produksi: [{ id: 'source-sku', nama: 'Fixture source SKU' }], cuttingPlans: [] };
  const proof = f.importBackup(b);
  assert.equal(proof.summary.orders, 1);
  for (const table of Object.keys(before)) assert.deepEqual(f.read(table), before[table], table);
  assert.equal(f.good('getCommerceState', { module: 'pembelian' }).orders.length, 1);
});
