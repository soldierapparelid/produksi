'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');

// Independent lifecycle review through the Sheets adapter. All fixtures are
// synthetic. A finished invoice is a projection, not a cancellation mutation.
function fixture() {
  const h = harness();
  for (const name of ['reconcile-legacy', 'commerce-hpp', 'slip-models', 'commerce', 'commerce-migration']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src', name + '.js'), 'utf8'), h.context);
  }
  const owner = h.request('setupOwner', { nama: 'Completion fixture', pin: '1234' });
  assert.equal(owner.ok, true, owner.error);
  function call(action, payload = {}) {
    h.cold();
    return h.request(action, { token: owner.data.token, workflowVersion: 2, ...payload });
  }
  function good(action, payload = {}) {
    const r = call(action, payload);
    assert.equal(r.ok, true, r.error);
    return r.data;
  }
  function raw(table) {
    h.cold();
    return h.run('pkStore_().fresh(' + JSON.stringify(table) + ');pkStore_().read(' + JSON.stringify(table) + ')');
  }
  const state = () => good('getCommerceState', { module: 'pembelian' });
  const order = id => state().orders.find(o => o.id === id);
  function receive(id, itemId, jumlah, eventId, tanggal = '2026-10-17') {
    const o = order(id);
    return good('appendCommerceReceipt', { id: eventId, orderId: id, expectedRevision: o.revision, itemId, jumlah, tanggal, kondisi: 'baik' }).record;
  }
  function pay(id, jumlah, eventId) {
    const o = order(id);
    return good('appendCommercePayment', { id: eventId, module: 'pembelian', parentId: id, expectedRevision: o.revision, jumlah, tanggal: '2026-10-17', metode: 'transfer', catatan: 'Pelunasan fixture' }).record;
  }
  function native(extra = {}) {
    good('saveCommerceSupplier', { record: { id: 'supplier', nama: 'Supplier fixture' } });
    good('saveCommerceProduct', { record: { id: 'product', nama: 'Topi fixture', supplierId: 'supplier' } });
    return good('saveCommerceOrder', { record: { id: 'order', produkId: 'product', tanggalOrder: '2026-10-10', hargaSatuan: 1000,
      items: [{ id: 'hitam', nama: 'Hitam', jumlah: 200 }, { id: 'olive', nama: 'Olive', jumlah: 100 }], ...extra } }).record;
  }
  function importBackup(backup) {
    const p = good('previewCommerceImport', { backup });
    good('applyCommerceImport', { backup, sourceHash: p.sourceHash, planHash: p.planHash });
  }
  return { h, call, good, raw, state, order, receive, pay, native, importBackup };
}

test('paid 290 of 300 remains open; final dated delivery completes and reload preserves all evidence', () => {
  const f = fixture();
  f.native();
  f.receive('order', 'hitam', 200, 'received-first', '2026-10-11');
  f.receive('order', 'olive', 90, 'received-second', '2026-10-14');
  let o = f.pay('order', 300000, 'settlement');
  assert.equal(o.status, 'lunas');
  assert.equal(o.balance, 0);
  assert.equal(o.totalReceived, 290);
  o = f.receive('order', 'olive', 10, 'received-last', '2026-10-17');
  assert.equal(o.status, 'selesai');
  assert.equal(o.needsReview, false);
  assert.equal(o.totalReceived, 300);
  assert.deepEqual(o.receivedByItem, { hitam: 200, olive: 100 });
  assert.deepEqual(o.receipts.map(r => [r.tanggal, r.itemId, r.jumlah]), [
    ['2026-10-11', 'hitam', 200], ['2026-10-14', 'olive', 90], ['2026-10-17', 'olive', 10]
  ]);
  const records = f.raw('CommerceRecord'), events = f.raw('CommerceEvent');
  for (let i = 0; i < 3; i++) {
    const loaded = f.order('order');
    assert.equal(loaded.status, 'selesai');
    assert.equal(!!loaded.cancelled, false, 'history is not cancellation');
    assert.deepEqual(loaded.receipts, o.receipts);
  }
  assert.deepEqual(f.raw('CommerceRecord'), records);
  assert.deepEqual(f.raw('CommerceEvent'), events);
});

test('all delivered with outstanding payment stays open; settlement is revision guarded and replay safe', () => {
  const f = fixture();
  f.native({ initialPayment: { jumlah: 100000, tanggal: '2026-10-10', metode: 'transfer' } });
  f.receive('order', 'hitam', 200, 'black-delivery');
  const outdated = f.order('order');
  let o = f.receive('order', 'olive', 100, 'olive-delivery');
  assert.equal(o.status, 'sebagian');
  assert.equal(o.totalReceived, 300);
  assert.equal(o.balance, 200000);
  const payload = { id: 'settlement-final', module: 'pembelian', parentId: 'order', expectedRevision: outdated.revision,
    jumlah: 200000, tanggal: '2026-10-17', metode: 'transfer' };
  const before = f.raw('CommerceEvent');
  const rejected = f.call('appendCommercePayment', payload);
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /berubah/);
  assert.deepEqual(f.raw('CommerceEvent'), before);
  payload.expectedRevision = o.revision;
  o = f.good('appendCommercePayment', payload).record;
  assert.equal(o.status, 'selesai');
  const after = f.raw('CommerceEvent');
  assert.equal(f.good('appendCommercePayment', payload).record.status, 'selesai');
  assert.deepEqual(f.raw('CommerceEvent'), after, 'lost response retry never pays twice');
});

test('owner receipt correction reopens a completed order and keeps original amount, date and payment', () => {
  const f = fixture();
  f.native();
  f.receive('order', 'hitam', 200, 'black-delivery', '2026-10-11');
  f.receive('order', 'olive', 100, 'olive-delivery', '2026-10-12');
  const done = f.pay('order', 300000, 'settlement');
  const original = f.raw('CommerceEvent').find(e => e.id === 'olive-delivery');
  const o = f.good('gantiCommerceEvent', { id: 'receipt-correction', module: 'pembelian', parentId: 'order',
    expectedRevision: done.revision, eventId: 'olive-delivery', itemId: 'olive', jumlah: 90,
    tanggal: '2026-10-14', kondisi: 'baik', catatan: 'Hanya 90 datang' }).record;
  assert.equal(o.status, 'lunas');
  assert.equal(o.totalReceived, 290);
  assert.equal(o.totalPaid, 300000);
  assert.equal(o.receipts.find(e => e.id === 'olive-delivery').voided, true);
  assert.equal(o.receipts.find(e => e.id === 'receipt-correction').tanggal, '2026-10-14');
  assert.deepEqual(f.raw('CommerceEvent').find(e => e.id === 'olive-delivery'), original);
  assert.deepEqual(o.payments, done.payments);
  const finished = f.receive('order', 'olive', 10, 'actual-last-delivery');
  assert.equal(finished.status, 'selesai');
  assert.equal(finished.receipts.length, 4, 'corrected source remains available in history');
});

test('owner settlement correction reopens balance without losing delivered inventory or prior payment evidence', () => {
  const f = fixture();
  f.native();
  f.receive('order', 'hitam', 200, 'black-delivery');
  f.receive('order', 'olive', 100, 'olive-delivery');
  const done = f.pay('order', 300000, 'settlement');
  const original = f.raw('CommerceEvent').find(e => e.id === 'settlement');
  const o = f.good('gantiCommerceEvent', { id: 'payment-correction', module: 'pembelian', parentId: 'order',
    expectedRevision: done.revision, eventId: 'settlement', jumlah: 290000,
    tanggal: '2026-10-17', metode: 'transfer', catatan: 'Koreksi transfer' }).record;
  assert.equal(o.status, 'sebagian');
  assert.equal(o.balance, 10000);
  assert.equal(o.totalReceived, 300);
  assert.deepEqual(o.receipts, done.receipts);
  assert.deepEqual(f.raw('CommerceEvent').find(e => e.id === 'settlement'), original);
  assert.equal(o.payments.find(e => e.id === 'settlement').voided, true);
  assert.equal(f.pay('order', 10000, 'balance-settlement').status, 'selesai');
});

test('one completed model must not hide an invoice with another model still outstanding', () => {
  const f = fixture();
  f.native();
  const batch = f.good('saveCommerceOrderBatch', { id: 'invoice-two', supplierId: 'supplier', grupNama: 'Dua model', tanggalOrder: '2026-10-17',
    orders: [{ id: 'model-a', produkId: 'product', hargaSatuan: 1000, items: [{ id: 'a', nama: 'A', jumlah: 50 }] },
      { id: 'model-b', produkId: 'product', hargaSatuan: 2000, items: [{ id: 'b', nama: 'B', jumlah: 50 }] }],
    initialPayment: { jumlah: 150000, tanggal: '2026-10-17', metode: 'transfer' } });
  assert.equal(batch.records.length, 2);
  f.receive('model-a', 'a', 50, 'a-complete');
  f.receive('model-b', 'b', 49, 'b-partial');
  let group = f.state().orders.filter(o => o.invoiceId === 'invoice-two');
  assert.deepEqual(group.map(o => o.status), ['selesai', 'lunas']);
  assert.equal(group.every(o => o.status === 'selesai'), false);
  f.receive('model-b', 'b', 1, 'b-complete');
  group = f.state().orders.filter(o => o.invoiceId === 'invoice-two');
  assert.equal(group.every(o => o.status === 'selesai'), true);
  assert.equal(group.length, 2);
  assert.equal(group.reduce((n, o) => n + o.totalPaid, 0), 150000);
  assert.equal(group.reduce((n, o) => n + o.totalReceived, 0), 100);
});

test('legacy paid and received totals cannot complete if variant linkage or payment evidence needs review', () => {
  const f = fixture();
  const orders = [
    { id: 'clean', pembayaran: [{ id: 'clean-pay', tanggal: '2026-09-01', jumlah: 10000 }], penerimaan: [{ id: 'clean-in', itemId: 'm', tanggal: '2026-09-02', jumlah: 2 }] },
    { id: 'orphan', pembayaran: [{ id: 'orphan-pay', tanggal: '2026-09-01', jumlah: 10000 }], penerimaan: [{ id: 'orphan-in', itemId: 'unknown', tanggal: '2026-09-02', jumlah: 2 }] },
    { id: 'overpaid', pembayaran: [{ id: 'excess-pay', tanggal: '2026-09-01', jumlah: 11000 }], penerimaan: [{ id: 'excess-in', itemId: 'm', tanggal: '2026-09-02', jumlah: 2 }] }
  ].map(o => ({ produkId: 'old-product', tanggalOrder: '2026-08-31', hargaSatuan: 5000, totalHarga: 10000,
    items: [{ id: 'm', nama: 'M', jumlah: 2 }], ...o }));
  f.importBackup({ soldier_pembelian_produk: { suppliers: [{ id: 'old-supplier', nama: 'Supplier lama' }],
    produk: [{ id: 'old-product', nama: 'Topi lama', supplierId: 'old-supplier' }], orders } });
  const sources = f.raw('CommerceSource'), events = f.raw('CommerceEvent');
  assert.equal(f.order('clean').status, 'selesai');
  for (const id of ['orphan', 'overpaid']) {
    const o = f.order(id);
    assert.equal(o.balance, 0);
    assert.equal(o.totalReceived, 2);
    assert.equal(o.needsReview, true);
    assert.equal(o.status, 'review');
  }
  assert.deepEqual(f.raw('CommerceSource'), sources);
  assert.deepEqual(f.raw('CommerceEvent'), events);
});

test('manual archive remains distinct from completed status and restoring preserves settlement and deliveries', () => {
  const f = fixture();
  f.native();
  f.receive('order', 'hitam', 200, 'black-delivery');
  f.receive('order', 'olive', 100, 'olive-delivery');
  const done = f.pay('order', 300000, 'settlement'), events = f.raw('CommerceEvent');
  const archived = f.good('cancelCommerceRecord', { module: 'pembelian', id: done.id, expectedRevision: done.revision,
    mode: 'archived', catatan: 'Arsip manual fixture' }).record;
  assert.equal(archived.status, 'batal');
  assert.equal(archived.cancelMode, 'archived');
  const restored = f.good('restoreCommerceRecord', { module: 'pembelian', id: archived.id, expectedRevision: archived.revision }).record;
  assert.equal(restored.status, 'selesai');
  assert.deepEqual(restored.receipts, done.receipts);
  assert.deepEqual(restored.payments, done.payments);
  assert.deepEqual(f.raw('CommerceEvent'), events);
});
