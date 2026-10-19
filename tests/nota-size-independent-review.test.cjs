'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');

// Synthetic notes through the real Sheets adapter. These checks focus on data
// loss across devices and on the actual server-generated invoice PDF source.
function fixture() {
  const h = harness();
  for (const name of ['reconcile-legacy', 'commerce-hpp', 'slip-models', 'commerce', 'commerce-migration']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src', name + '.js'), 'utf8'), h.context);
  }
  const setup = h.request('setupOwner', { nama: 'Size audit fixture', pin: '1234' });
  assert.equal(setup.ok, true, setup.error);
  function call(action, payload = {}) {
    h.cold();
    return h.request(action, { token: setup.data.token, workflowVersion: 2, ...payload });
  }
  function good(action, payload = {}) {
    const result = call(action, payload);
    assert.equal(result.ok, true, result.error);
    return result.data;
  }
  function raw(table) {
    h.cold();
    return h.run('pkStore_().fresh(' + JSON.stringify(table) + ');pkStore_().read(' + JSON.stringify(table) + ')');
  }
  const note = () => good('getCommerceState', { module: 'nota' }).notes.find(row => row.id === 'size-audit');
  return { h, call, good, raw, note };
}
function input(over = {}) {
  return { id: 'size-audit', date: '2026-10-19', customer: { name: 'Pelanggan contoh' },
    items: [{ id: 'polo', name: 'Polo Basic', size: 'M-XL', color: 'Oren Stabilo', qty: 32, price: 60000,
      sizeBreakdown: [{ size: 'M', qty: 8 }, { size: 'L', qty: 12 }, { size: 'XL', qty: 12 }] }], ...over };
}
function render(f, note) {
  f.h.run('var reviewNota=' + JSON.stringify(note));
  return ['coreNotaInvoiceHtml(reviewNota,{kopSlip:"SOLDIER APPAREL"})',
    'coreNotaStrukHtml(reviewNota,{kopSlip:"SOLDIER APPAREL"},{lebar:58})',
    'coreNotaStrukHtml(reviewNota,{kopSlip:"SOLDIER APPAREL"},{lebar:80})'].map(code => f.h.run(code));
}

test('size quantities survive normalized save and reread, money and payments retain their original totals', () => {
  const f = fixture(), value = input({ initialPayment: { jumlah: 200000, metode: 'transfer' } });
  value.items[0].sizeBreakdown[0].size = '  m  ';
  const created = f.good('saveCommerceNota', { record: value }).record;
  assert.deepEqual(created.items[0].sizeBreakdown, [{ size: 'M', qty: 8 }, { size: 'L', qty: 12 }, { size: 'XL', qty: 12 }]);
  assert.equal(created.items[0].qty, 32);
  assert.equal(created.total, 1920000);
  assert.equal(created.totalPaid, 200000);
  assert.equal(created.balance, 1720000);
  assert.deepEqual(f.note().items, created.items);
  const rows = f.raw('CommerceRecord'), events = f.raw('CommerceEvent');
  assert.equal(f.good('saveCommerceNota', { record: value }).record.id, created.id, 'retry does not duplicate the note');
  assert.deepEqual(f.raw('CommerceRecord'), rows);
  assert.deepEqual(f.raw('CommerceEvent'), events);
});

test('invalid size breakdown fails atomically without touching note, payments or version', () => {
  const f = fixture();
  const saved = f.good('saveCommerceNota', { record: input({ initialPayment: { jumlah: 200000, metode: 'transfer' } }) }).record;
  const rows = f.raw('CommerceRecord'), events = f.raw('CommerceEvent'), version = f.h.run('pkStore_().version()');
  const invalid = [null, {}, 'M8 L12 XL12', [{ size: 'M', qty: 31 }], [{ size: 'M', qty: 0 }, { size: 'L', qty: 32 }],
    [{ size: 'M', qty: -1 }, { size: 'L', qty: 33 }], [{ size: 'M', qty: 0.5 }, { size: 'L', qty: 31.5 }],
    [{ size: 'M', qty: true }, { size: 'L', qty: 31 }], [{ size: '', qty: 32 }], [{ size: 'X'.repeat(31), qty: 32 }],
    [{ size: 'm', qty: 8 }, { size: ' M ', qty: 24 }], Array.from({ length: 41 }, (_, i) => ({ size: 'S' + i, qty: 1 }))];
  for (const breakdown of invalid) {
    const value = input(); value.items[0].sizeBreakdown = breakdown;
    const result = f.call('saveCommerceNota', { record: value, expectedRevision: saved.revision });
    assert.equal(result.ok, false, 'invalid breakdown accepted: ' + JSON.stringify(breakdown));
    assert.deepEqual(f.raw('CommerceRecord'), rows);
    assert.deepEqual(f.raw('CommerceEvent'), events);
    assert.equal(f.h.run('pkStore_().version()'), version);
  }
});

test('an older client cannot silently discard saved sizes, even with the latest record revision', () => {
  const f = fixture(), saved = f.good('saveCommerceNota', { record: input() }).record;
  const rows = f.raw('CommerceRecord');
  for (const changeQty of [false, true]) {
    const value = input(); delete value.items[0].sizeBreakdown;
    if (changeQty) value.items[0].qty = 40;
    const result = f.call('saveCommerceNota', { record: value, expectedRevision: saved.revision });
    assert.equal(result.ok, false, 'old client must not erase sizes');
    assert.deepEqual(f.raw('CommerceRecord'), rows);
  }
  const value = input(); value.items[0].sizeBreakdown = [];
  assert.equal(f.call('saveCommerceNota', { record: value, expectedRevision: saved.revision }).ok, false);
  assert.deepEqual(f.raw('CommerceRecord'), rows);
});

test('explicitly clearing sizes preserves quantity, payable amount and payment records', () => {
  const f = fixture(), saved = f.good('saveCommerceNota', { record: input({ initialPayment: { jumlah: 200000, metode: 'transfer' } }) }).record;
  const value = input(); value.items[0].sizeBreakdown = []; value.items[0].clearSizeBreakdown = true;
  const changed = f.good('saveCommerceNota', { record: value, expectedRevision: saved.revision }).record;
  assert.equal((changed.items[0].sizeBreakdown || []).length, 0);
  assert.equal(changed.items[0].qty, 32);
  assert.equal(changed.total, saved.total);
  assert.deepEqual(changed.payments, saved.payments);
  assert.equal(changed.totalPaid, saved.totalPaid);
  assert.equal(changed.balance, saved.balance);
});

test('stale size edit rejects instead of overwriting another device quantities', () => {
  const f = fixture(), saved = f.good('saveCommerceNota', { record: input() }).record;
  const value = input(); value.items[0].sizeBreakdown = [{ size: 'M', qty: 10 }, { size: 'L', qty: 10 }, { size: 'XL', qty: 12 }];
  const changed = f.good('saveCommerceNota', { record: value, expectedRevision: saved.revision }).record;
  assert.equal(f.call('saveCommerceNota', { record: input(), expectedRevision: saved.revision }).ok, false);
  assert.deepEqual(f.note().items, changed.items);
});

test('legacy size ranges do not invent per-size quantities on read, invoice or thermal prints', () => {
  const f = fixture(), value = input(); delete value.items[0].sizeBreakdown;
  const note = f.good('saveCommerceNota', { record: value }).record;
  assert.equal((note.items[0].sizeBreakdown || []).length, 0);
  for (const html of render(f, note)) {
    assert.match(html, /M-XL/);
    assert.match(html, /1\.920\.000/);
    assert.ok(!/M 8 pcs|L 12 pcs|XL 12 pcs/.test(html));
  }
  assert.equal(f.note().items[0].qty, 32);
});

test('A4 and both thermal widths list every size beside its correct model and preserve the total', () => {
  const f = fixture(), value = input();
  value.items.push({ id: 'second', name: 'Celana Panjang', color: 'Hitam', size: '34-36', qty: 5, price: 100000,
    sizeBreakdown: [{ size: '34', qty: 2 }, { size: '36', qty: 3 }] });
  const note = f.good('saveCommerceNota', { record: value }).record, docs = render(f, note);
  for (const html of docs) {
    assert.match(html, /Polo Basic/); assert.match(html, /Celana Panjang/);
    const visibleText = html.replace(/<[^>]+>/g, '');
    for (const text of ['M 8 pcs', 'L 12 pcs', 'XL 12 pcs', '34 2 pcs', '36 3 pcs']) assert.ok(visibleText.includes(text), text);
    assert.match(html, /2\.420\.000/);
    assert.match(html, /overflow-wrap:anywhere/);
    assert.ok(!/max-height:|overflow:hidden/.test(html));
  }
  assert.match(docs[0], /@page\{size:A4 portrait/);
  assert.match(docs[1], /\.struk\{width:48mm/);
  assert.match(docs[2], /\.struk\{width:72mm/);
});

test('server PDF includes persisted breakdown and escaping without requiring the client to re-send sizes', () => {
  const f = fixture(), value = input();
  value.items[0].sizeBreakdown = [{ size: '<b>M</b>', qty: 8 }, { size: 'L', qty: 12 }, { size: 'XL', qty: 12 }];
  f.good('saveCommerceNota', { record: value });
  f.h.run("var originalPdfEnv=pkEnv_,reviewPdfHtml='';pkEnv_=function(){var e=originalPdfEnv();e.makePdf=function(html){reviewPdfHtml=html;return 'test-pdf';};return e;};void 0;");
  const pdf = f.good('makeCommercePdf', { module: 'nota', id: 'size-audit' });
  assert.equal(pdf.base64, 'test-pdf');
  const html = f.h.run('reviewPdfHtml');
  assert.match(html.replace(/<[^>]+>/g, ''), /&lt;B&gt;M&lt;\/B&gt; 8 pcs/);
  assert.ok(!html.includes('<B>M</B>'));
  assert.match(html.replace(/<[^>]+>/g, ''), /XL 12 pcs/);
  assert.match(html, /1\.920\.000/);
});
