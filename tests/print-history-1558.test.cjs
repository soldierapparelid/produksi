'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');

function fixture() {
  const h = harness();
  for (const name of ['reconcile-legacy', 'bahan-invoice', 'cutting-plans', 'auto-completion']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src/' + name + '.js'), 'utf8'), h.context);
  }
  const setup = h.request('setupOwner', { nama: 'Owner CONTOH CETAK', pin: '1234' });
  assert.equal(setup.ok, true, setup.error);
  const token = setup.data.token;
  function request(action, payload = {}) {
    h.cold();
    return h.request(action, { token, workflowVersion: 2, ...payload });
  }
  function call(action, payload = {}) {
    const result = request(action, payload);
    assert.equal(result.ok, true, action + ': ' + result.error);
    return result.data && result.data.data !== undefined ? result.data.data : result.data;
  }
  function raw(table) {
    h.cold();
    return h.run(`pkStore_().fresh(${JSON.stringify(table)});pkStore_().read(${JSON.stringify(table)})`);
  }
  function patch(table, id, changes) {
    h.cold();
    h.run(`pkStore_().lock(function(){pkStore_().update(${JSON.stringify(table)},${JSON.stringify(id)},${JSON.stringify(changes)});});`);
  }
  const worker = call('saveUser', { user: { nama: 'Pemotong CONTOH', divisi: 'potong', pin: '2345' } });
  const admin = call('saveUser', { user: { nama: 'Admin CONTOH', divisi: 'admin', pin: '3456' } });
  const workerToken = call('login', { userId: worker.id, pin: '2345', deferState: true }).token;
  const adminToken = call('login', { userId: admin.id, pin: '3456', deferState: true }).token;
  const product = call('saveProduk', { produk: { newId: 'print-product', nama: 'KEMEJA CONTOH', series: 'CONTOH' } });
  const stock = call('saveInvoiceBahan', { invoice: {
    id: 'print-material', tanggal: '2026-10-20', invoice: 'CONTOH-CETAK', supplier: 'Toko CONTOH',
    items: [{ bahan: 'KAIN CONTOH', satuan: 'yard', harga: 33000, rolls: [{ qty: 100 }, { qty: 100 }] }]
  } });
  const po = call('savePO', { deferMaterial: true, po: { newId: 'print-po-first', produkId: product.id, jenis: 'stok', ukuran: {}, ukuranAktif: ['M', 'XL'] } });
  const po2 = call('savePO', { deferMaterial: true, po: { newId: 'print-po-second', produkId: product.id, jenis: 'stok', ukuran: {}, ukuranAktif: ['L'] } });
  const plan = call('saveRencanaPotong', { rencana: { id: 'print-plan-first', poId: po.id, alokasiBahan: [{ stokId: stock.rows[0].id, qty: 100, ukuran: 'XL' }] } });
  function entries(ids = [po.id, po2.id]) {
    const state = call('getState');
    return ids.map(id => {
      const p = state.po.find(row => row.id === id);
      assert.ok(p.printSignature);
      return { poId: id, signature: p.printSignature, snapshot: {
        po: Object.fromEntries(['id', 'noPO', 'nama', 'series', 'pelanggan', 'bahan', 'catatan', 'deadline'].map(key => [key, p[key] || ''])),
        ukuran: p.ukuranAktif.map(s => ({ s, target: 0 })),
        rencana: state.rencanaPotong.filter(row => row.poId === id).map(row => ({ id: row.id, bahanList: row.bahanList, rol: row.rol })),
        tahap: 'Belum dipotong', sudah: false, gambar: ''
      } };
    }).map(entry => ({ ...entry, snapshot: h.run('printWorkSnapshot(' + JSON.stringify(entry.snapshot) + ')') }));
  }
  function production() {
    return JSON.stringify(Object.fromEntries(['PO', 'RencanaPotong', 'StokBahan', 'Potong', 'Pengaturan'].map(table => [table, raw(table)])));
  }
  return { h, call, request, raw, patch, entries, production, po, po2, plan, stock, workerToken, adminToken };
}

test('admin print history persists separately across adapter reloads and never changes production or stock', () => {
  const f = fixture(), entries = f.entries(), before = f.production();
  const result = f.call('savePrintHistory', { id: 'print-batch-one', jenis: 'potong', entries });
  assert.equal(result.saved, 2);
  assert.equal(result.replayed, false);
  assert.deepEqual(result.rows.map(row => row.snapshot), entries.map(row => row.snapshot));
  assert.equal(result.rows[0].id, 'print-batch-one_000');
  assert.equal(f.production(), before);
  f.h.cold();
  const reopened = f.call('getPrintHistory', { token: f.adminToken, jenis: 'potong' });
  assert.deepEqual(reopened.rows, result.rows);
  assert.deepEqual(f.call('getPrintHistory', { jenis: 'jalan' }).rows, []);
  assert.ok(reopened.rows.every(row => !('requestHash' in row) && !('requestId' in row)));
  f.call('savePrintHistory', { id: 'print-batch-jalan', jenis: 'jalan', entries: [entries[0]], token: f.adminToken });
  assert.equal(f.call('getPrintHistory').rows.length, 3);
  assert.equal(f.production(), before);
  assert.ok(f.h.events.some(event => event[0] === 'lock'));
});

test('only active owner or admin accounts can read and save print history', () => {
  const f = fixture(), entries = f.entries();
  for (const action of ['getPrintHistory', 'savePrintHistory']) {
    for (const token of ['', f.workerToken]) {
      const result = f.request(action, { token, id: 'print-denied-batch', jenis: 'potong', entries });
      assert.equal(result.ok, false);
      assert.match(result.error, /login|owner\/admin/);
    }
  }
  assert.ok(f.call('getState', { token: f.workerToken }).po.every(row => !('printSignature' in row)));
  const admin = f.raw('Pegawai').find(row => row.divisi === 'admin');
  f.patch('Pegawai', admin.id, { aktif: false });
  assert.match(f.request('getPrintHistory', { token: f.adminToken }).error, /dinonaktifkan/);
  assert.deepEqual(f.raw('RiwayatCetak'), []);
});

test('one request replays after lost acknowledgement even when its PO was subsequently edited', () => {
  const f = fixture(), payload = { id: 'print-retry-batch', jenis: 'potong', entries: f.entries() };
  const first = f.call('savePrintHistory', payload), writes = f.h.sheets.RiwayatCetak.writes;
  f.patch('PO', f.po.id, { catatan: 'Diubah sesudah cetak' });
  const retry = f.call('savePrintHistory', payload);
  assert.equal(retry.saved, 0);
  assert.equal(retry.replayed, true);
  assert.deepEqual(retry.rows, first.rows);
  assert.equal(f.h.sheets.RiwayatCetak.writes, writes);
  assert.equal(f.raw('RiwayatCetak').length, 2);
  const altered = JSON.parse(JSON.stringify(payload)); altered.entries[0].snapshot.tahap = 'siap';
  assert.match(f.request('savePrintHistory', altered).error, /data berbeda/);
  assert.match(f.request('savePrintHistory', { ...payload, token: f.adminToken }).error, /data berbeda/);
  assert.equal(f.raw('RiwayatCetak').length, 2);
});

for (const changed of ['sizes', 'new plan', 'edited plan', 'released sizes']) {
  test('stale preview is refused without partial history after ' + changed, () => {
    const f = fixture(), entries = f.entries();
    if (changed === 'sizes') f.patch('PO', f.po2.id, { ukuranAktif: '["L","XXL"]' });
    if (changed === 'new plan') f.call('saveRencanaPotong', { rencana: { id: 'print-plan-second', poId: f.po.id, alokasiBahan: [{ stokId: f.stock.rows[1].id, qty: 100, ukuran: 'M' }] } });
    if (changed === 'edited plan') f.call('saveRencanaPotong', { expectedRevision: f.plan.revision, rencana: { id: f.plan.id, poId: f.po.id, catatan: 'Tambah label ukuran', alokasiBahan: [{ stokId: f.stock.rows[0].id, qty: 90, ukuran: 'XL' }] } });
    if (changed === 'released sizes') f.call('lepasUkuranPotong', { poId: f.po2.id, ukuran: ['L'] });
    const result = f.request('savePrintHistory', { id: 'print-stale-batch', jenis: 'potong', entries });
    assert.equal(result.ok, false);
    assert.match(result.error, /berubah sejak pratinjau/);
    assert.deepEqual(f.raw('RiwayatCetak'), []);
    const current = f.entries();
    assert.notDeepEqual(current.map(row => row.signature), entries.map(row => row.signature));
  });
}

test('unrelated changes and derived display fields do not invalidate a printable work signature', () => {
  const f = fixture(), entries = f.entries([f.po.id]);
  f.call('saveSettings', { settings: { upahPotong: 1200 } });
  f.call('lepasUkuranPotong', { poId: f.po2.id, ukuran: ['L'] });
  f.patch('PO', f.po2.id, { catatan: 'PO lain berubah' });
  f.patch('StokBahan', f.stock.rows[1].id, { catatan: 'Catatan gudang berubah' });
  assert.equal(f.entries([f.po.id])[0].signature, entries[0].signature);
  const signature = f.h.run(`(function(){var po=pkStore_().read('PO').find(function(r){return r.id==='${f.po.id}';}),plans=pkStore_().read('RencanaPotong');var expected=printWorkSignature(po,plans);po.ukuran=coreParseJSON(po.ukuran,{});po.ukuranAktif=coreParseJSON(po.ukuranAktif,[]);po.agg={potong:900};po.workflow={readyQC:true};var decorated=coreCutPlanRows(plans,[{id:'made-up-display',rencanaId:'${f.plan.id}'}]);return [expected,printWorkSignature(po,decorated)];})()`);
  assert.equal(signature[0], signature[1]);
  assert.equal(f.call('savePrintHistory', { id: 'print-current-batch', jenis: 'potong', entries, expectedVersion: 0 }).saved, 1);
});

test('missing source, duplicate PO, invalid snapshot and oversized snapshots fail before writing history', () => {
  const f = fixture(), base = { id: 'print-invalid-batch', jenis: 'potong', entries: f.entries() };
  const bad = [];
  bad.push({ ...base, entries: [] });
  bad.push({ ...base, entries: [base.entries[0], base.entries[0]] });
  bad.push({ ...base, jenis: 'lain' });
  bad.push({ ...base, entries: [{ ...base.entries[0], signature: '' }] });
  bad.push({ ...base, entries: [{ ...base.entries[0], snapshot: {} }] });
  bad.push({ ...base, entries: [{ ...base.entries[0], snapshot: { po: { id: f.po.id }, note: 'x'.repeat(45000) } }] });
  bad.push({ ...base, entries: [base.entries[0], { poId: 'missing-po', signature: base.entries[1].signature, snapshot: { po: { id: 'missing-po' } } }] });
  bad.push({ ...base, workflowVersion: 1 });
  bad.push({ ...base, clientVersion: '1.0.0' });
  for (const payload of bad) {
    const result = f.request('savePrintHistory', payload);
    assert.equal(result.ok, false, JSON.stringify(payload).slice(0, 200));
    assert.deepEqual(f.raw('RiwayatCetak'), []);
  }
  const imported = f.request('importRows', { sheet: 'RiwayatCetak', rows: [{ id: 'forged-print', poId: f.po.id }] });
  assert.equal(imported.ok, false);
  assert.match(imported.error, /Sheet tidak dikenal/);
  assert.deepEqual(f.raw('RiwayatCetak'), []);
});

test('server stores only printable snapshot fields and excludes workflow objects and image URLs', () => {
  const f = fixture(), entries = f.entries([f.po.id]);
  entries[0].snapshot.po.workflow = { privatePayment: 12345 };
  entries[0].snapshot.po.gambar = 'https://example.invalid/private-picture.png';
  entries[0].snapshot.gambar = 'data:image/png;base64,AAAA';
  entries[0].snapshot.extra = { token: 'must-not-be-stored' };
  entries[0].snapshot.rencana[0].poDraft = { stale: true };
  const saved = f.call('savePrintHistory', { id: 'print-clean-snapshot', jenis: 'potong', entries });
  const stored = JSON.stringify(saved.rows[0].snapshot);
  assert.doesNotMatch(stored, /privatePayment|example\.invalid|base64|must-not-be-stored|poDraft/);
  assert.equal(saved.rows[0].snapshot.po.gambar, '');
  assert.equal(saved.rows[0].snapshot.gambar, '');
  assert.equal(saved.rows[0].snapshot.rencana[0].bahanList[0].qty, 100);
});

for (const partial of [false, true]) {
  test('retry does not duplicate history after ' + (partial ? 'an interrupted batch prefix' : 'a successful write with a lost response'), () => {
    const f = fixture(), payload = { id: 'print-lost-response', jenis: 'potong', entries: f.entries() };
    f.raw('RiwayatCetak');
    const sheet = f.h.sheets.RiwayatCetak, original = sheet.getRange.bind(sheet);
    let armed = true;
    sheet.getRange = function (row, col, height, width) {
      const range = original(row, col, height, width), set = range.setValues.bind(range);
      range.setValues = function (values) {
        if (armed && row > 1 && values.length === 2) {
          armed = false;
          if (partial) original(row, col, 1, width).setValues([values[0]]);
          else set(values);
          throw new Error('Injected lost history write response');
        }
        return set(values);
      };
      return range;
    };
    const failed = f.request('savePrintHistory', payload);
    assert.equal(failed.ok, false);
    assert.match(failed.error, /Injected lost history/);
    const persisted = f.raw('RiwayatCetak');
    assert.equal(persisted.length, partial ? 1 : 2);
    f.patch('PO', f.po.id, { catatan: 'Pekerjaan baru setelah cetak pertama' });
    const restored = f.call('savePrintHistory', payload);
    assert.equal(restored.saved, partial ? 1 : 0);
    assert.equal(restored.replayed, true);
    const rows = f.raw('RiwayatCetak');
    assert.equal(rows.length, 2);
    assert.equal(new Set(rows.map(row => row.id)).size, 2);
    assert.ok(rows.every(row => row.dibuat === persisted[0].dibuat));
    assert.deepEqual(restored.rows.map(row => row.snapshot), payload.entries.map(row => row.snapshot));
  });
}
