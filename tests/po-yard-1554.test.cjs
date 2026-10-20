'use strict';
/* Yard stock is an aggregate material balance, even when its invoice records
   one physical roll. Exercise public requests against the Sheets test adapter. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');

function fixture() {
  const h = harness();
  for (const name of ['bahan-invoice', 'cutting-plans', 'auto-completion', 'reconcile-legacy', 'history-corrections']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src', name + '.js'), 'utf8'), h.context);
  }
  const setup = h.request('setupOwner', { nama: 'Owner fixture', pin: '1234' });
  assert.equal(setup.ok, true, setup.error);
  const owner = setup.data.token, cutter = 'yard-fixture-cutter-session';
  h.run(`pkStore_().lock(function(){
    pkStore_().append('Pegawai',{id:'yard-cutter-01',nama:'Cutter fixture',divisi:'potong',aktif:true,token:'${cutter}'});
  });`);
  const call = (action, payload = {}, token = owner) => { h.cold(); return h.request(action, { token, workflowVersion: 2, ...payload }); };
  const good = (action, payload = {}, token = owner) => { const r = call(action, payload, token); assert.equal(r.ok, true, r.error); return r.data?.data ?? r.data; };
  const raw = name => { h.cold(); return h.run(`pkStore_().fresh(${JSON.stringify(name)});pkStore_().read(${JSON.stringify(name)})`); };
  const purchased = good('saveInvoiceBahan', { invoice: {
    id: 'yard-invoice-001', invoice: 'FIXTURE-YARD-001', tanggal: '2026-10-20', supplier: 'Supplier fixture',
    items: [
      { bahan: 'Bahan Kemeja Fixture', qty: 200, satuan: 'yard', rol: 1, harga: 15000 },
      { bahan: 'Katun Fixture', satuan: 'kg', harga: 88000, rolls: [{ qty: 25, rollLabel: 'Katun 1' }] }
    ]
  } });
  for (const id of ['yard-po-001', 'yard-po-002']) {
    good('savePO', { deferMaterial: true, po: { newId: id, nama: 'Kemeja fixture ' + id, jenis: 'stok', ukuran: {}, ukuranAktif: ['M', 'XL'] } });
  }
  const yardRow = purchased.rows.find(r => r.satuan === 'yard'), kgRow = purchased.rows.find(r => r.satuan === 'kg');
  const request = (id = 'yard-plan-001', qty = 60, poId = 'yard-po-001') => ({ rencana: {
    id, poId, bahanList: [{ nama: 'Bahan Kemeja Fixture', qty, satuan: 'yard' }], rol: 0
  } });
  const cut = (plan, id = 'yard-cut-001') => ({ potong: {
    id, rencanaId: plan.id, expectedRencanaRevision: plan.revision, tanggal: '2026-10-20', ukuran: { M: 30, XL: 20 }
  } });
  const stock = () => good('getState').stokRingkas.find(r => r.nama === 'Bahan Kemeja Fixture');
  return { h, owner, cutter, call, good, raw, yardRow, kgRow, request, cut, stock };
}

test('200 yard can reserve 60, appear in the cutter job, and consume exactly once to leave 140 yard', () => {
  const f = fixture(), sources = f.raw('StokBahan'), initial = f.stock();
  assert.equal(initial.satuan, 'yard'); assert.equal(initial.saldo, 200); assert.equal(initial.legacyTersedia, 200);
  assert.equal(f.good('getState').stokRol.some(r => r.id === f.yardRow.id), false, 'a yard purchase does not become a kilogram roll');
  const payload = f.request(), plan = f.good('saveRencanaPotong', payload);
  assert.deepEqual(plan.bahanList, [{ nama: 'Bahan Kemeja Fixture', qty: 60, satuan: 'yard' }]);
  assert.equal(f.good('saveRencanaPotong', payload).id, plan.id, 'a repeated save retains the existing reservation');
  const reserved = f.stock();
  assert.equal(reserved.saldo, 200); assert.equal(reserved.dicadangkan, 60); assert.equal(reserved.tersedia, 140);
  assert.equal(reserved.legacyTersedia, 140);
  const worker = f.good('getState', {}, f.cutter);
  const work = worker.rencanaPotong.find(r => r.id === plan.id);
  assert.equal(work.status, 'siap'); assert.equal(work.bahanList[0].satuan, 'yard'); assert.equal(work.bahanList[0].qty, 60);
  assert.equal(worker.bahan.find(r => r.nama === 'Bahan Kemeja Fixture').satuan, 'yard');
  const cutPayload = f.cut(plan), saved = f.good('createPotong', cutPayload, f.cutter);
  assert.equal(saved.total, 50);
  assert.equal(f.good('createPotong', cutPayload, f.cutter).id, saved.id, 'a lost response cannot consume another 60 yard');
  const after = f.stock();
  assert.equal(after.satuan, 'yard'); assert.equal(after.pakai, 60); assert.equal(after.saldo, 140);
  assert.equal(after.dicadangkan, 0); assert.equal(after.tersedia, 140);
  assert.equal(f.raw('Potong').length, 1); assert.deepEqual(f.raw('StokBahan'), sources);
  const duplicate = f.call('createPotong', f.cut(plan, 'yard-cut-duplicate'), f.cutter);
  assert.equal(duplicate.ok, false); assert.match(duplicate.error, /sudah dipakai/);
  assert.equal(f.stock().saldo, 140);
});

test('editing a yard reservation credits only its own amount and invalidates an already-open cutter form', () => {
  const f = fixture(), first = f.good('saveRencanaPotong', f.request('yard-plan-001', 120));
  const second = f.good('saveRencanaPotong', f.request('yard-plan-002', 50, 'yard-po-002'));
  const edited = f.good('saveRencanaPotong', { ...f.request('yard-plan-001', 150), expectedRevision: first.revision });
  assert.notEqual(edited.revision, first.revision); assert.equal(f.stock().dicadangkan, 200); assert.equal(f.stock().tersedia, 0);
  const staleCut = f.call('createPotong', f.cut(first), f.cutter);
  assert.equal(staleCut.ok, false); assert.match(staleCut.error, /berubah sejak/);
  const staleEdit = f.call('saveRencanaPotong', { ...f.request('yard-plan-001', 140), expectedRevision: first.revision });
  assert.equal(staleEdit.ok, false); assert.match(staleEdit.error, /berubah sejak/);
  const over = f.call('saveRencanaPotong', { ...f.request('yard-plan-001', 151), expectedRevision: edited.revision });
  assert.equal(over.ok, false); assert.match(over.error, /melebihi/);
  assert.equal(f.raw('RencanaPotong').length, 2); assert.equal(f.raw('Potong').length, 0);
  f.good('saveRencanaPotong', { expectedRevision: second.revision, rencana: { id: second.id, status: 'batal' } });
  assert.equal(f.stock().dicadangkan, 150); assert.equal(f.stock().tersedia, 50);
  f.good('createPotong', f.cut(edited), f.cutter);
  assert.equal(f.stock().saldo, 50); assert.equal(f.stock().dicadangkan, 0);
});

test('another phone reserving yard stock is refreshed before a stale owner form can over-reserve it', () => {
  const f = fixture();
  f.good('getState');
  const schema = f.h.run('SCHEMA.RencanaPotong');
  const concurrent = { id: 'yard-other-phone', poId: 'yard-po-002', bahanList: '[{"nama":"Bahan Kemeja Fixture","qty":150,"satuan":"yard"}]',
    legacyBahanList: '[{"nama":"Bahan Kemeja Fixture","qty":150,"satuan":"yard"}]', rol: 0, status: 'siap', revision: 'yard-other-revision' };
  f.h.sheets.RencanaPotong.values.push(schema.map(key => concurrent[key] ?? ''));
  const rejected = f.call('saveRencanaPotong', f.request());
  assert.equal(rejected.ok, false); assert.match(rejected.error, /melebihi/);
  assert.equal(f.raw('RencanaPotong').length, 1);
  const exact = f.good('saveRencanaPotong', f.request('yard-plan-001', 50));
  assert.equal(exact.bahanList[0].qty, 50); assert.equal(f.stock().tersedia, 0);
});

test('a reduction or unit change after preparing yard stock cannot be silently accepted by the cutter', () => {
  for (const change of [{ field: 'qty', value: 50, error: /melebihi/ }, { field: 'satuan', value: 'meter', error: /Satuan|satuan/ }]) {
    const f = fixture(), plan = f.good('saveRencanaPotong', f.request());
    f.good('getState', {}, f.cutter);
    const columns = f.h.sheets.StokBahan.values[0], row = f.h.sheets.StokBahan.values.find(r => r[columns.indexOf('id')] === f.yardRow.id);
    row[columns.indexOf(change.field)] = change.value; // Another device committed after the cutter opened the form.
    const result = f.call('createPotong', f.cut(plan), f.cutter);
    assert.equal(result.ok, false); assert.match(result.error, change.error);
    assert.equal(f.raw('Potong').length, 0);
    assert.equal(f.good('getState').rencanaPotong.find(r => r.id === plan.id).status, 'siap');
  }
});

test('one preparation can combine a kilogram roll and yard fabric without merging their stock balances or units', () => {
  const f = fixture(), before = f.raw('StokBahan');
  const payload = { rencana: { id: 'yard-mixed-plan', poId: 'yard-po-001', alokasiBahan: [{ stokId: f.kgRow.id, qty: 5 }],
    legacyBahanList: [{ nama: 'Bahan Kemeja Fixture', qty: 60, satuan: 'yard' }], legacyRol: 0 } };
  const plan = f.good('saveRencanaPotong', payload), waiting = f.good('getState');
  assert.deepEqual(plan.bahanList, [
    { nama: 'Katun Fixture', qty: 5, satuan: 'kg' },
    { nama: 'Bahan Kemeja Fixture', qty: 60, satuan: 'yard' }
  ]);
  assert.equal(waiting.stokRol.find(r => r.id === f.kgRow.id).dicadangkan, 5);
  assert.equal(f.stock().dicadangkan, 60);
  const payloadCut = f.cut(plan), saved = f.good('createPotong', payloadCut, f.cutter);
  assert.equal(f.good('createPotong', payloadCut, f.cutter).id, saved.id);
  const after = f.good('getState'), kg = after.stokRingkas.find(r => r.nama === 'Katun Fixture'), yard = f.stock();
  assert.equal(kg.satuan, 'kg'); assert.equal(kg.saldo, 20); assert.equal(kg.pakai, 5); assert.equal(kg.dicadangkan, 0);
  assert.equal(yard.satuan, 'yard'); assert.equal(yard.saldo, 140); assert.equal(yard.pakai, 60); assert.equal(yard.dicadangkan, 0);
  assert.equal(after.stokRol.find(r => r.id === f.kgRow.id).saldo, 20);
  assert.deepEqual(f.raw('StokBahan'), before); assert.equal(f.raw('Potong').length, 1);
});

test('yard decimals are retained while incompatible units and conversion to kilogram rolls are rejected', () => {
  const f = fixture();
  const wrongUnit = f.request(); wrongUnit.rencana.bahanList[0].satuan = 'kg';
  const result = f.call('saveRencanaPotong', wrongUnit);
  assert.equal(result.ok, false); assert.match(result.error, /Satuan bahan mengikuti stok/);
  assert.equal(f.raw('RencanaPotong').length, 0);
  const plan = f.good('saveRencanaPotong', f.request('yard-decimal-plan', 60.125));
  assert.equal(plan.bahanList[0].qty, 60.125); assert.equal(f.stock().tersedia, 139.875);
  f.good('createPotong', f.cut(plan), f.cutter);
  assert.equal(f.stock().saldo, 139.875); assert.equal(f.stock().satuan, 'yard');
  const badInvoice = f.call('saveInvoiceBahan', { invoice: { id: 'yard-wrong-roll-invoice', invoice: 'YARD-ROLL-INVALID',
    tanggal: '2026-10-20', items: [{ bahan: 'Bahan Kemeja Fixture', satuan: 'yard', harga: 15000, rolls: [{ qty: 200 }] }] } });
  assert.equal(badInvoice.ok, false); assert.match(badInvoice.error, /Berat rol harus dicatat dalam kg/);
  assert.equal(f.raw('StokBahan').length, 2);
});
