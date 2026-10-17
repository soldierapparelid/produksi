'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');

// Independent review of derived documents and invoice membership. All data is
// synthetic; hiding history may add metadata only, never rewrite its ledger.
function fixture() {
  const h = harness();
  for (const name of ['reconcile-legacy', 'commerce-hpp', 'slip-models', 'commerce', 'commerce-migration']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src', name + '.js'), 'utf8'), h.context);
  }
  const setup = h.request('setupOwner', { nama: 'History export review', pin: '1234' });
  assert.equal(setup.ok, true, setup.error);
  h.run("var reviewPdfEnv=pkEnv_,reviewPdfCalls=[];pkEnv_=function(){var e=reviewPdfEnv();e.makePdf=function(html,name){reviewPdfCalls.push({html:html,name:name});return 'synthetic-pdf';};return e;};void 0;");
  function call(action, payload = {}) { h.cold(); return h.request(action, { token: setup.data.token, workflowVersion: 2, ...payload }); }
  function good(action, payload = {}) { const r = call(action, payload); assert.equal(r.ok, true, r.error); return r.data; }
  function bad(action, payload, pattern) { const r = call(action, payload); assert.equal(r.ok, false, action + ' must reject'); assert.match(r.error, pattern); return r; }
  function raw(table) { h.cold(); return h.run('pkStore_().fresh(' + JSON.stringify(table) + ');pkStore_().read(' + JSON.stringify(table) + ')'); }
  const state = module => good('getCommerceState', { module: module || 'pembelian' });
  const order = id => state().orders.find(o => o.id === id);
  const revisions = ids => Object.fromEntries(state().orders.filter(o => ids.includes(o.id)).map(o => [o.id, o.revision]));
  let serial = 0;
  function visibility(module, ids, hidden) {
    const rows = module === 'nota' ? state('nota').notes : state().orders;
    return good('setCommerceHistoryVisibility', { module, ids, hidden, requestId: 'visibility-' + (++serial),
      expectedRevisions: Object.fromEntries(rows.filter(r => ids.includes(r.id)).map(r => [r.id, r.revision])), reason: 'Synthetic cleanup', withState: true });
  }
  function createInvoice(key, count = 1) {
    const orders = Array.from({ length: count }, (_, i) => ({ id: key + '-order-' + i, produkId: 'model', hargaSatuan: 100,
      items: [{ id: 'variant', nama: 'Hitam ukuran L', jumlah: 3 }] }));
    good('saveCommerceOrderBatch', { id: key, supplierId: 'supplier', grupNama: 'Invoice ' + key, tanggalOrder: '2026-10-01',
      catatan: 'Synthetic review', orders, initialPayment: { jumlah: count * 300, tanggal: '2026-10-02', metode: 'transfer' } });
    for (const row of orders) good('appendCommerceReceipt', { id: key + '-receipt-' + row.id, parentId: row.id,
      itemId: 'variant', jumlah: 3, tanggal: '2026-10-03', expectedRevision: order(row.id).revision });
    return orders.map(r => r.id);
  }
  good('saveCommerceSupplier', { record: { id: 'supplier', nama: 'Supplier review' } });
  good('saveCommerceProduct', { record: { id: 'model', nama: 'Topi synthetic', supplierId: 'supplier' } });
  return { h, call, good, bad, raw, state, order, revisions, visibility, createInvoice };
}

function accounting(row) {
  const keys = ['id', 'invoiceId', 'invoiceGroupId', 'invoiceGroupName', 'invoiceMergeProof', 'invoiceProof', 'invoiceOrderIds',
    'items', 'total', 'totalHarga', 'totalQty', 'totalPaid', 'totalReceived', 'balance', 'status', 'archived', 'cancelled',
    'paymentReview', 'receiptReview', 'receivedByItem', 'events', 'payments', 'receipts'];
  return Object.fromEntries(keys.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]));
}

test('hiding and restoring a merged invoice keeps every original row, grouping and financial projection intact', () => {
  const f = fixture(), ids = [...f.createInvoice('batch-a', 2), ...f.createInvoice('batch-b')];
  f.good('mergeCommerceInvoices', { id: 'merged-review', orderIds: ids, expectedRevisions: f.revisions(ids), grupNama: 'Invoice bersama' });
  const before = f.state().orders, records = f.raw('CommerceRecord'), events = f.raw('CommerceEvent');
  const hidden = f.visibility('pembelian', ids, true);
  assert.deepEqual(f.raw('CommerceRecord'), records);
  assert.deepEqual(f.raw('CommerceEvent').slice(0, -1), events);
  assert.equal(f.raw('CommerceEvent').at(-1).kind, 'historyVisibility');
  assert.equal(f.raw('CommerceEvent').at(-1).parentId, '');
  assert.deepEqual(hidden.commerce.orders.map(accounting), before.map(accounting));
  assert.ok(hidden.commerce.orders.every(r => r.historyHidden && r.invoiceGroupId === 'merged-review'));
  assert.ok(hidden.commerce.orders.every(r => r.events.every(e => e.kind !== 'historyVisibility')));
  assert.ok(hidden.commerce.orders.every(r => r.revision !== before.find(o => o.id === r.id).revision));
  const restored = f.visibility('pembelian', ids, false);
  assert.deepEqual(f.raw('CommerceRecord'), records);
  assert.deepEqual(restored.commerce.orders.map(accounting), before.map(accounting));
  assert.ok(restored.commerce.orders.every(r => !r.historyHidden));
  assert.equal(f.raw('CommerceEvent').length, events.length + 2);
});

test('hidden invoice members cannot leak into PDF, merge selections or add-model targets', () => {
  const f = fixture(), ids = f.createInvoice('batch-a', 2), other = f.createInvoice('batch-b')[0];
  const before = f.state().orders.map(accounting), staleRevisions = f.revisions(ids);
  f.visibility('pembelian', ids, true);
  f.visibility('pembelian', [ids[1]], false);
  const records = f.raw('CommerceRecord'), events = f.raw('CommerceEvent');
  f.bad('makeCommercePdf', { module: 'pembelian', id: ids[0] }, /Sampah/);
  f.bad('makeCommercePdf', { module: 'pembelian', ids, expectedRevisions: staleRevisions }, /Sampah/);
  f.bad('mergeCommerceInvoices', { id: 'merge-hidden', orderIds: [...ids, other], expectedRevisions: f.revisions([...ids, other]) }, /Sampah/);
  f.bad('mergeCommerceInvoices', { id: 'merge-skip-hidden', orderIds: [ids[1], other], expectedRevisions: f.revisions([ids[1], other]) }, /seluruh model/);
  const batch = { id: 'add-to-hidden', supplierId: 'supplier', tanggalOrder: '2026-10-04', targetInvoiceId: 'batch-a',
    expectedGroupRevisions: f.revisions(ids), orders: [{ id: 'new-model', produkId: 'model', hargaSatuan: 100, items: [{ id: 'v', nama: 'XL', jumlah: 2 }] }] };
  f.bad('saveCommerceOrderBatch', batch, /Sampah/);
  f.bad('saveCommerceOrderBatch', { ...batch, expectedGroupRevisions: f.revisions([ids[1]]) }, /Isi invoice tujuan berubah/);
  assert.deepEqual(f.raw('CommerceRecord'), records);
  assert.deepEqual(f.raw('CommerceEvent'), events);
  assert.deepEqual(f.state().orders.map(accounting), before);
  assert.equal(f.h.run('reviewPdfCalls.length'), 0);
  assert.equal(f.good('makeCommercePdf', { module: 'pembelian', id: ids[1] }).base64, 'synthetic-pdf');
  assert.equal(f.h.run('reviewPdfCalls.length'), 1, 'visible sibling can still be read without resurfacing hidden PO');
  f.visibility('pembelian', [ids[0]], false);
  assert.equal(f.good('makeCommercePdf', { module: 'pembelian', ids, expectedRevisions: f.revisions(ids) }).base64, 'synthetic-pdf');
});

test('a historical payment group spanning invoices cannot be partly corrected while one participant is hidden', () => {
  const f = fixture(), first = f.createInvoice('legacy-a')[0], second = f.createInvoice('legacy-b')[0];
  // Older versions allowed a supplier payment across invoices. Preserve that
  // original relationship and test the correction guard against its real ledger.
  for (const row of f.raw('CommerceRecord').filter(r => r.kind === 'order')) {
    const data = JSON.parse(row.data); data._initialPayment.groupId = 'historical-supplier-payment';
    f.h.run('pkStore_().lock(function(){pkStore_().update("CommerceRecord",' + JSON.stringify(row.id) + ',{data:' + JSON.stringify(JSON.stringify(data)) + '});});void 0;');
  }
  const before = f.state().orders.map(accounting);
  f.visibility('pembelian', [first], true);
  const records = f.raw('CommerceRecord'), events = f.raw('CommerceEvent');
  f.bad('gantiCommerceGroupPayment', { id: 'correction-review', groupId: 'historical-supplier-payment', jumlah: 300,
    tanggal: '2026-10-05', metode: 'transfer', expectedRevisions: f.revisions([first, second]) }, /Sampah/);
  f.bad('gantiCommerceGroupPayment', { id: 'correction-visible-only', groupId: 'historical-supplier-payment', jumlah: 300,
    tanggal: '2026-10-05', metode: 'transfer', expectedRevisions: f.revisions([second]) }, /Sampah/);
  assert.deepEqual(f.raw('CommerceRecord'), records);
  assert.deepEqual(f.raw('CommerceEvent'), events);
  assert.deepEqual(f.state().orders.map(accounting), before);
  f.visibility('pembelian', [first], false);
  f.good('gantiCommerceGroupPayment', { id: 'correction-after-restore', groupId: 'historical-supplier-payment', jumlah: 300,
    tanggal: '2026-10-05', metode: 'transfer', expectedRevisions: f.revisions([first, second]) });
  assert.equal(f.state().orders.reduce((sum, r) => sum + r.totalPaid, 0), 300);
  assert.ok(f.state().orders.every(r => r.payments[0].voided), 'correction remains an append-only financial action after restore');
});

test('paid nota remains paid in trash, but printing requires restoration and retains its original payment history', () => {
  const f = fixture();
  let note = f.good('saveCommerceNota', { record: { id: 'nota-history', date: '2026-10-01', customer: { name: 'Pelanggan synthetic' },
    items: [{ id: 'item', name: 'Topi nota review', qty: 2, price: 100 }], initialPayment: { jumlah: 200, metode: 'transfer' } } }).record;
  const before = accounting(note), records = f.raw('CommerceRecord');
  f.good('makeCommercePdf', { module: 'nota', id: note.id });
  const hidden = f.visibility('nota', [note.id], true).records[0];
  assert.deepEqual(accounting(hidden), before);
  f.bad('makeCommercePdf', { module: 'nota', id: note.id }, /Sampah/);
  assert.equal(f.h.run('reviewPdfCalls.length'), 1);
  note = f.visibility('nota', [note.id], false).records[0];
  assert.deepEqual(accounting(note), before);
  assert.deepEqual(f.raw('CommerceRecord'), records);
  f.good('makeCommercePdf', { module: 'nota', id: note.id });
  assert.equal(f.h.run('reviewPdfCalls[0].html'), f.h.run('reviewPdfCalls[1].html'));
  assert.match(f.h.run('reviewPdfCalls[1].html'), /LUNAS/);
});
