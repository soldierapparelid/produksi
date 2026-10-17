'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');

// Independent verification through the real Sheets adapter, using synthetic
// invoices only. Automatic paid history must never cancel or rewrite a ledger.
function fixture() {
  const h = harness();
  for (const name of ['reconcile-legacy', 'commerce-hpp', 'slip-models', 'commerce', 'commerce-migration']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src', name + '.js'), 'utf8'), h.context);
  }
  const setup = h.request('setupOwner', { nama: 'Nota review fixture', pin: '1234' });
  assert.equal(setup.ok, true, setup.error);
  function call(action, payload = {}) {
    h.cold();
    return h.request(action, { token: setup.data.token, workflowVersion: 2, ...payload });
  }
  function good(action, payload = {}) {
    const r = call(action, payload);
    assert.equal(r.ok, true, r.error);
    return r.data;
  }
  function bad(action, payload, pattern) {
    const r = call(action, payload);
    assert.equal(r.ok, false, 'must reject');
    assert.match(r.error, pattern);
  }
  function raw(table) {
    h.cold();
    return h.run('pkStore_().fresh(' + JSON.stringify(table) + ');pkStore_().read(' + JSON.stringify(table) + ')');
  }
  const note = id => good('getCommerceState', { module: 'nota' }).notes.find(n => n.id === (id || 'nota-review'));
  function pay(id, amount, extra = {}) {
    const n = note();
    return good('appendCommercePayment', { id, module: 'nota', parentId: n.id, expectedRevision: n.revision,
      jumlah: amount, tanggal: '2026-10-17', metode: 'transfer', ...extra }).record;
  }
  return { h, call, good, bad, raw, note, pay };
}

function input(extra = {}) {
  return { id: 'nota-review', date: '2026-10-10', customer: { name: 'Pelanggan fixture' },
    items: [{ id: 'item-review', name: 'Topi fixture', size: 'L', qty: 2, price: 25000 }], ...extra };
}

test('unpaid and partial invoices become paid without changing archive flags, source records or prior payments', () => {
  const f = fixture();
  let n = f.good('saveCommerceNota', { record: input() }).record;
  assert.equal(n.status, 'belum');
  const record = f.raw('CommerceRecord');
  n = f.pay('first-dp', 20000);
  assert.equal(n.status, 'dp');
  assert.equal(n.balance, 30000);
  const dp = f.raw('CommerceEvent')[0];
  n = f.pay('settlement', 30000);
  assert.equal(n.status, 'lunas');
  assert.equal(n.balance, 0);
  assert.equal(n.totalPaid, 50000);
  assert.equal(!!n.cancelled, false);
  assert.equal(!!n.archived, false, 'automatic history is not a manual archive write');
  assert.deepEqual(f.raw('CommerceRecord'), record);
  assert.deepEqual(f.raw('CommerceEvent')[0], dp);
  const events = f.raw('CommerceEvent');
  for (let i = 0; i < 3; i++) assert.equal(f.note().status, 'lunas');
  assert.deepEqual(f.raw('CommerceEvent'), events);
});

test('settlement rejects stale revisions and overpayment; exact response-loss replay never adds a second payment', () => {
  const f = fixture(), original = f.good('saveCommerceNota', { record: input() }).record;
  f.pay('dp-from-other-device', 20000);
  const intent = { id: 'settlement-stable', module: 'nota', parentId: original.id, expectedRevision: original.revision,
    jumlah: 30000, tanggal: '2026-10-17', metode: 'transfer' };
  const before = f.raw('CommerceEvent');
  f.bad('appendCommercePayment', intent, /berubah/);
  assert.deepEqual(f.raw('CommerceEvent'), before);
  intent.expectedRevision = f.note().revision;
  f.bad('appendCommercePayment', { ...intent, jumlah: 30001 }, /melebihi/);
  assert.deepEqual(f.raw('CommerceEvent'), before);
  assert.equal(f.good('appendCommercePayment', intent).record.status, 'lunas');
  const events = f.raw('CommerceEvent');
  assert.equal(f.good('appendCommercePayment', intent).record.status, 'lunas');
  assert.deepEqual(f.raw('CommerceEvent'), events);
  f.bad('appendCommercePayment', { ...intent, jumlah: 29999 }, /berbeda/);
});

test('correcting or voiding settlement reopens an invoice while original payment and its audit evidence remain', () => {
  const f = fixture();
  f.good('saveCommerceNota', { record: input({ initialPayment: { jumlah: 20000, metode: 'transfer' } }) });
  const paid = f.pay('settlement', 30000), original = f.raw('CommerceEvent').find(e => e.id === 'settlement');
  let n = f.good('gantiCommerceEvent', { id: 'corrected-settlement', module: 'nota', parentId: paid.id,
    expectedRevision: paid.revision, eventId: 'settlement', jumlah: 25000, tanggal: '2026-10-16', metode: 'transfer', catatan: 'Koreksi nominal' }).record;
  assert.equal(n.status, 'dp');
  assert.equal(n.balance, 5000);
  assert.equal(n.payments.find(e => e.id === 'settlement').voided, true);
  assert.deepEqual(f.raw('CommerceEvent').find(e => e.id === 'settlement'), original);
  n = f.good('voidCommerceEvent', { id: 'void-correction', module: 'nota', parentId: n.id,
    expectedRevision: n.revision, eventId: 'corrected-settlement', tanggal: '2026-10-17', catatan: 'Pembayaran salah catat' }).record;
  assert.equal(n.totalPaid, 20000);
  assert.equal(n.balance, 30000);
  assert.equal(n.payments.length, 3);
  assert.equal(n.payments.filter(p => !p.voided).length, 1);
  assert.equal(f.pay('new-settlement', 30000).status, 'lunas');
});

test('cash settlement allocates only the debt and retains tender/change without false overpayment review', () => {
  const f = fixture();
  f.good('saveCommerceNota', { record: input({ initialPayment: { jumlah: 20000, metode: 'transfer' } }) });
  const paid = f.pay('cash-settlement', 30000, { metode: 'cash', tenderedAmount: 50000 });
  assert.equal(paid.status, 'lunas');
  assert.equal(paid.totalPaid, 50000);
  assert.equal(paid.overpaid, 0);
  assert.equal(paid.paymentReview, false);
  const cash = paid.payments.find(p => p.id === 'cash-settlement');
  assert.equal(cash.jumlah, 30000);
  assert.equal(cash.tenderedAmount, 50000);
  assert.equal(cash.change, 20000);
  const n = f.good('gantiCommerceEvent', { id: 'cash-correction', module: 'nota', parentId: paid.id,
    expectedRevision: paid.revision, eventId: cash.id, jumlah: 20000, tanggal: '2026-10-17', metode: 'cash' }).record;
  assert.equal(n.balance, 10000);
  assert.equal(n.status, 'dp');
  const old = n.payments.find(p => p.id === cash.id);
  assert.equal(old.voided, true);
  assert.equal(old.tenderedAmount, 50000);
  assert.equal(old.change, 20000);
});

test('editing a paid invoice can reopen debt without changing identity or payments; manual archive stays explicit', () => {
  const f = fixture();
  let n = f.good('saveCommerceNota', { record: input({ initialPayment: { jumlah: 50000, metode: 'transfer' } }) }).record;
  const payments = n.payments, number = n.noNota;
  n = f.good('saveCommerceNota', { record: input({ items: [{ id: 'item-review', name: 'Topi fixture', size: 'XL', qty: 3, price: 25000 }] }), expectedRevision: n.revision }).record;
  assert.equal(n.noNota, number);
  assert.equal(n.status, 'dp');
  assert.equal(n.balance, 25000);
  assert.deepEqual(n.payments, payments);
  assert.equal(!!n.archived, false);
  n = f.good('arsipCommerceNota', { id: n.id, expectedRevision: n.revision, arsip: true }).record;
  assert.equal(n.archived, true);
  assert.equal(n.status, 'dp');
  n = f.pay('settlement-after-edit', 25000);
  assert.equal(n.status, 'lunas');
  assert.equal(n.archived, true, 'manual archive remains distinct from derived completed history');
  n = f.good('arsipCommerceNota', { id: n.id, expectedRevision: n.revision, arsip: false }).record;
  assert.equal(!!n.archived, false);
  assert.equal(n.status, 'lunas', 'removing a manual archive cannot itself reopen paid debt');
});

test('legitimate zero total from full discount is settled without creating a zero payment', () => {
  const f = fixture();
  const n = f.good('saveCommerceNota', { record: input({ discountPercent: 100 }) }).record;
  assert.equal(n.total, 0);
  assert.equal(n.totalQty, 2);
  assert.equal(n.totalPaid, 0);
  assert.equal(n.balance, 0);
  assert.equal(n.paymentReview, false);
  assert.equal(n.status, 'lunas');
  assert.deepEqual(n.payments, []);
  f.bad('appendCommercePayment', { id: 'not-needed', module: 'nota', parentId: n.id, expectedRevision: n.revision,
    jumlah: 1, tanggal: '2026-10-17', metode: 'transfer' }, /melebihi/);
  assert.equal(f.raw('CommerceEvent').length, 0);
});

test('unresolved legacy nominal never becomes paid history merely because its numeric fallback leaves no balance', () => {
  const f = fixture();
  const backup = { notaPenjualan_v1: { transactions: [
    { id: 'old-missing-total', date: '2026-08-01', customer: { name: 'Asal' }, items: [{ id: 'x', name: 'Topi', qty: 1, price: 50000 }], total: null, payment: {} },
    { id: 'old-ambiguous-extra', date: '2026-08-01', customer: { name: 'Asal' }, items: [{ id: 'x', name: 'Topi', qty: 1, price: 50000 }], total: 50000,
      payment: { amount: 50000, method: 'transfer', pelunasan: [{ id: 'unknown', date: '2026-08-03', amount: 'unknown' }] } },
    { id: 'old-overpaid', date: '2026-08-01', customer: { name: 'Asal' }, items: [{ id: 'x', name: 'Topi', qty: 1, price: 50000 }], total: 50000,
      payment: { amount: 60000, method: 'transfer' } }
  ] } };
  const preview = f.good('previewCommerceImport', { backup });
  f.good('applyCommerceImport', { backup, sourceHash: preview.sourceHash, planHash: preview.planHash });
  const sources = f.raw('CommerceSource'), events = f.raw('CommerceEvent');
  for (const id of backup.notaPenjualan_v1.transactions.map(n => n.id)) {
    const n = f.note(id);
    assert.equal(n.balance, 0);
    assert.equal(n.paymentReview, true);
    assert.equal(n.status, 'review');
    f.bad('appendCommercePayment', { id: 'no-pay-' + id, module: 'nota', parentId: id, expectedRevision: n.revision,
      jumlah: 1, tanggal: '2026-10-17', metode: 'transfer' }, /periksa/);
  }
  assert.deepEqual(f.raw('CommerceSource'), sources);
  assert.deepEqual(f.raw('CommerceEvent'), events);
});

test('cancelling a paid nota is not paid-history archival; restoration keeps void evidence and reopens the invoice', () => {
  const f = fixture();
  const paid = f.good('saveCommerceNota', { record: input({ initialPayment: { jumlah: 50000, metode: 'transfer' } }) }).record;
  const gone = f.good('cancelCommerceRecord', { module: 'nota', id: paid.id, expectedRevision: paid.revision,
    catatan: 'Salah nota fixture', voidAll: true }).record;
  assert.equal(gone.status, 'batal');
  assert.equal(gone.cancelled, true);
  assert.equal(gone.totalPaid, 0);
  assert.equal(gone.payments.length, 1);
  assert.equal(gone.payments[0].voided, true);
  const voids = f.raw('CommerceEvent');
  const back = f.good('restoreCommerceRecord', { module: 'nota', id: gone.id, expectedRevision: gone.revision }).record;
  assert.equal(back.status, 'belum');
  assert.equal(back.balance, 50000);
  assert.equal(back.noNota, paid.noNota);
  assert.deepEqual(back.payments, gone.payments);
  assert.deepEqual(f.raw('CommerceEvent'), voids);
});

test('shared invoice summary follows real settlement corrections and derives date from effective payment evidence', () => {
  const f = fixture();
  const summary = n => f.h.context.coreNotaRingkas(n, {});
  let n = f.good('saveCommerceNota', { record: input({ initialPayment: { jumlah: 20000, metode: 'transfer' } }) }).record;
  assert.equal(summary(n).lunas, false);
  assert.equal(summary(n).tanggalLunas, '');
  n = f.pay('dated-settlement', 30000);
  assert.equal(summary(n).lunas, true);
  assert.equal(summary(n).tanggalLunas, '2026-10-17');
  n = f.good('gantiCommerceEvent', { id: 'dated-correction', module: 'nota', parentId: n.id,
    expectedRevision: n.revision, eventId: 'dated-settlement', jumlah: 25000, tanggal: '2026-10-16', metode: 'transfer', catatan: 'Koreksi bukti' }).record;
  assert.equal(summary(n).lunas, false);
  assert.equal(summary(n).tanggalLunas, '', 'voided settlement cannot leave a stale paid date');
  n = f.pay('earlier-last-payment', 5000, { tanggal: '2026-10-15' });
  assert.equal(summary(n).lunas, true);
  assert.equal(summary(n).tanggalLunas, '2026-10-16', 'date follows the effective dated ledger, not append order or voided evidence');
  const cancelled = f.good('cancelCommerceRecord', { module: 'nota', id: n.id, expectedRevision: n.revision,
    catatan: 'Batal fixture', voidAll: true }).record;
  assert.equal(summary(cancelled).batal, true);
  assert.equal(summary(cancelled).lunas, false);
  assert.equal(summary(cancelled).tanggalLunas, '');
});
