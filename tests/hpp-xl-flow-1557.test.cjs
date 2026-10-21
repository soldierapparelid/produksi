'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');

/* Exact API-produced records, copied through the Sheets adapter between calls.
   No production data or handwritten Potong/RencanaPotong records are used. */
function fixture() {
  const h = harness();
  for (const name of ['reconcile-legacy', 'bahan-invoice', 'cutting-plans', 'auto-completion', 'commerce-hpp', 'slip-models', 'commerce']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src/' + name + '.js'), 'utf8'), h.context);
  }
  const setup = h.request('setupOwner', { nama: 'Owner CONTOH HPP', pin: '1234' });
  assert.equal(setup.ok, true, setup.error);
  const token = setup.data.token;
  function call(action, payload = {}) {
    h.cold();
    const result = h.request(action, { token, workflowVersion: 2, ...payload });
    assert.equal(result.ok, true, action + ': ' + result.error);
    return result.data && result.data.data !== undefined ? result.data.data : result.data;
  }
  function raw(table) {
    h.cold();
    return h.run(`pkStore_().fresh(${JSON.stringify(table)});pkStore_().read(${JSON.stringify(table)})`);
  }
  call('saveSettings', { settings: { ukuran: ['M', 'L', 'XL', 'XXL'], upahPotong: 900, upahJahit: 3000 } });
  const cutter = call('saveUser', { user: { nama: 'Pemotong CONTOH', divisi: 'potong', pin: '1234' } });
  const product = call('saveProduk', { produk: {
    newId: 'fixture-hpp-product', nama: 'CONTOH ACUAN XL', series: 'TERRAIN CAMO', tarifPotong: 900, tarifJahit: 3000
  } });
  const invoice = call('saveInvoiceBahan', { invoice: {
    id: 'fixture-hpp-invoice', invoice: 'CONTOH-HPP', tanggal: '2026-10-18', supplier: 'Toko CONTOH',
    items: [{ bahan: 'KAIN CONTOH', satuan: 'kg', harga: 88000, rolls: [{ qty: 25.75 }, { qty: 26 }] }]
  } });
  const po = call('savePO', { deferMaterial: true, po: {
    newId: 'fixture-hpp-po', produkId: product.id, jenis: 'stok', ukuran: {}, ukuranAktif: ['M', 'XL']
  } });
  const plan = call('saveRencanaPotong', { rencana: {
    id: 'fixture-hpp-plan', poId: po.id,
    alokasiBahan: invoice.rows.map((roll, index) => ({ stokId: roll.id, qty: roll.qty, ukuran: index === 0 ? 'XL' : 'M' }))
  } });
  const first = (sizes) => call('createPotong', { potong: {
    id: 'fixture-hpp-cut', poId: po.id, userId: cutter.id, tanggal: '2026-10-19',
    rencanaId: plan.id, expectedRencanaRevision: plan.revision, ukuran: sizes
  } });
  const next = (sizes) => call('createPotong', { potong: {
    id: 'fixture-hpp-next', poId: po.id, userId: cutter.id, tanggal: '2026-10-20', lanjut: true, ukuran: sizes
  } });
  const state = () => call('getCommerceState', { module: 'hpp' });
  function saveConfig() {
    const current = state(), model = current.models.find(m => m.nama === 'CONTOH ACUAN XL');
    assert.ok(model);
    return call('saveCommerceHpp', { modelId: model.id, expectedRevision: current.revision, config: {
      jahitMode: 'manual', hargaJahit: 3000, biayaLain: 0, targetMargin: 20, costSchema: 2, costsReviewed: true
    } });
  }
  return { h, call, raw, first, next, state, saveConfig, invoice, plan, po };
}
function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`); }
function assertXL(model) {
  assert.equal(model.basis.ukuran, 'XL');
  assert.equal(model.basis.includedPcs, 117);
  assert.equal(model.kain.totalPcs, 117);
  assert.equal(model.kain.totalCost, 2266000);
  near(model.kain.perPcs, 2266000 / 117);
  near(model.potong.perPcs, 900);
  near(model.hppTotal, 2266000 / 117 + 900 + 3000);
  assert.deepEqual(model.sizes, ['M', 'XL']);
}

test('mixed M and XL production writes isolate the real XL roll and survive a saved HPP reopening', () => {
  const f = fixture();
  f.first({ M: 121, XL: 117 });
  const cut = f.raw('Potong')[0], materials = JSON.parse(cut.bahanList), allocations = JSON.parse(cut.alokasiBahan);
  assert.equal(cut.total, 238);
  assert.equal(cut.kg, 51.75);
  assert.equal(cut.rol, 2);
  assert.equal(cut.tarif, 900);
  assert.deepEqual(materials, [{ nama: 'KAIN CONTOH', qty: 51.75, satuan: 'kg' }]);
  assert.deepEqual(allocations.map(r => [r.qty, r.ukuran]), [[25.75, 'XL'], [26, 'M']]);
  const productionBefore = JSON.stringify({ cuts: f.raw('Potong'), plans: f.raw('RencanaPotong'), stock: f.raw('StokBahan') });
  assertXL(f.state().models[0]);
  const saved = f.saveConfig();
  f.h.cold();
  const reopened = f.state(), model = reopened.models[0];
  assertXL(model);
  assert.equal(model.configSaved, true);
  assert.equal(model.configured, true);
  assert.equal(model.complete, true);
  assert.equal(reopened.revision, saved.revision);
  assert.equal(reopened.config.modelConfigs[model.id].hargaJahit, 3000);
  assert.equal(JSON.stringify({ cuts: f.raw('Potong'), plans: f.raw('RencanaPotong'), stock: f.raw('StokBahan') }), productionBefore);
});

for (const [name, initial, continuation] of [
  ['XL first then M', { XL: 117 }, { M: 121 }],
  ['M first then XL', { M: 121 }, { XL: 117 }]
]) {
  test('staged production (' + name + ') charges fabric once and reopens the same XL HPP', () => {
    const f = fixture();
    f.first(initial);
    f.next(continuation);
    const rows = f.raw('Potong');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].kg, 51.75);
    assert.equal(rows[0].rencanaId, f.plan.id);
    assert.equal(rows[1].asal, 'lanjut');
    assert.equal(rows[1].rencanaId, '');
    assert.equal(rows[1].bahanList, '');
    assert.equal(rows[1].alokasiBahan, '');
    assert.equal(rows[1].kg, 0);
    assert.equal(rows.reduce((sum, row) => sum + row.total, 0), 238);
    assert.equal(f.call('getState').stokRingkas.find(r => r.nama === 'KAIN CONTOH').saldo, 0);
    assertXL(f.state().models[0]);
    f.saveConfig();
    f.h.cold();
    const model = f.state().models[0];
    assertXL(model);
    assert.equal(model.complete, true);
    assert.equal(model.configSaved, true);
    assert.equal(f.raw('Potong').length, 2, 'saving or reopening HPP cannot create another cut');
  });
}
