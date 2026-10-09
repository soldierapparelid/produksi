'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');

/* Itemising existing stock into rolls, archiving finished POs, and the owner's backup.
   Real Sheets adapter, cold request objects, invented fixtures only. */
function fixture() {
  const h = harness();
  for (const name of ['bahan-invoice', 'cutting-plans', 'auto-completion', 'reconcile-legacy', 'history-corrections']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src', name + '.js'), 'utf8'), h.context);
  }
  const setup = h.request('setupOwner', { nama: 'Fixture Owner', pin: '1234' });
  assert.equal(setup.ok, true, setup.error);
  const owner = setup.data.token, cutter = 'fixture-rinci-cutter-token', admin = 'fixture-rinci-admin-token';
  h.run(`pkStore_().lock(function(){
    pkStore_().append('Pegawai',{id:'rincicutter01',nama:'Fixture Cutter',divisi:'potong',aktif:true,token:'${cutter}',pin:'fixture-pin-hash'});
    pkStore_().append('Pegawai',{id:'rinciadmin001',nama:'Fixture Admin',divisi:'admin',aktif:true,token:'${admin}'});
    pkStore_().append('StokBahan',{id:'old-stock-0001',jenis:'beli',tanggal:'2026-09-01',bahan:'Scuba Hitam',qty:228.05,satuan:'kg',rol:10,harga:78000,total:17787900,asal:'lama'});
    pkStore_().append('StokBahan',{id:'old-stock-0002',jenis:'beli',tanggal:'2026-09-01',bahan:'Furing',qty:40,satuan:'meter',rol:1,harga:10000,total:400000,asal:'lama'});
  });`);
  function call(action, payload = {}, token = owner) { h.cold(); return h.request(action, { token, workflowVersion: 2, ...payload }); }
  function good(action, payload = {}, token = owner) {
    const result = call(action, payload, token); assert.equal(result.ok, true, result.error);
    return result.data && result.data.data !== undefined ? result.data.data : result.data;
  }
  function bad(action, payload, pattern, token = owner) {
    const result = call(action, payload, token); assert.equal(result.ok, false, 'operation must reject');
    if (pattern) assert.match(result.error, pattern); return result;
  }
  function raw(table) { h.cold(); return h.run(`pkStore_().fresh(${JSON.stringify(table)});pkStore_().read(${JSON.stringify(table)})`); }
  const material = name => good('getState').stokRingkas.find(m => m.kunci === name);
  return { h, owner, cutter, admin, call, good, bad, raw, material };
}

test('existing stock is itemised into rolls without changing the stock total, the purchases or the value', () => {
  const f = fixture(), before = f.material('scuba hitam'), rowsBefore = f.raw('StokBahan').length;
  assert.equal(before.saldo, 228.05); assert.equal(before.legacySaldo, 228.05); assert.equal(f.good('getState').stokRol.length, 0, 'old stock has no roll detail');
  const request = { id: 'rinci-batch-0001', bahan: '  scuba   HITAM ', rolls: [{ qty: 25 }, { qty: '24' }, { qty: 23.125 }], catatan: 'timbang ulang' };
  const done = f.good('rinciStokRol', request);
  assert.equal(done.total, 72.125); assert.deepEqual(done.rows.map(r => [r.jenis, r.bahan, r.qty, r.stockMode, r.rollLabel, r.harga, r.total]), [
    ['rinci', 'Scuba Hitam', 25, 'roll', 'Rol 1', 0, 0], ['rinci', 'Scuba Hitam', 24, 'roll', 'Rol 2', 0, 0], ['rinci', 'Scuba Hitam', 23.125, 'roll', 'Rol 3', 0, 0]]);
  assert.match(done.rows[0].invoice, /^Rincian stok \d\d\/\d\d\/\d{4}$/);
  const after = f.material('scuba hitam'), state = f.good('getState');
  for (const key of ['saldo', 'beli', 'pakai', 'koreksi', 'hpp', 'nilai', 'rol', 'nBeli']) assert.equal(after[key], before[key], key + ' is unchanged');
  assert.equal(after.legacySaldo, 155.925); assert.equal(after.legacyTersedia, 155.925);
  assert.deepEqual(state.stokRol.map(r => [r.rollLabel, r.saldo, r.tersedia, r.status, r.rinci]), [['Rol 1', 25, 25, 'tersedia', true], ['Rol 2', 24, 24, 'tersedia', true], ['Rol 3', 23.125, 23.125, 'tersedia', true]]);
  /* a roll that was bought with an invoice is not marked as itemised stock */
  f.good('saveInvoiceBahan', { invoice: { id: 'rinci-invoice-001', invoice: 'FIXTURE-BON-9', tanggal: '2026-10-08', supplier: 'Fixture Store', items: [{ bahan: 'Scuba Hitam', satuan: 'kg', harga: 78000, rolls: [{ qty: 20, rollLabel: 'Rol baru' }] }] } });
  assert.equal(f.good('getState').stokRol.find(r => r.rollLabel === 'Rol baru').rinci, undefined); assert.equal(f.material('scuba hitam').legacySaldo, 155.925, 'a new purchase does not touch the stock without roll detail');
  /* the same form sent again writes nothing; another content under the same id is refused; later rolls continue the numbering */
  assert.equal(f.good('rinciStokRol', request).rows.length, 3); assert.equal(f.raw('StokBahan').length, rowsBefore + 4, 'three itemised rolls and the one bought roll');
  f.bad('rinciStokRol', { ...request, rolls: [{ qty: 25 }, { qty: 24 }, { qty: 23 }] }, /isi berbeda/);
  assert.equal(f.good('rinciStokRol', { id: 'rinci-batch-0002', bahan: 'Scuba Hitam', rolls: [{ qty: 5.925 }] }).rows[0].rollLabel, 'Rol 5');
  assert.equal(f.material('scuba hitam').legacySaldo, 150);
});

test('itemising is the owner\'s, stays within the stock that has no roll detail, and takes only sound kilo weights', () => {
  const f = fixture(), rows = f.raw('StokBahan').length, request = { id: 'rinci-batch-0001', bahan: 'Scuba Hitam', rolls: [{ qty: 25 }] };
  f.bad('rinciStokRol', request, /owner/, f.admin); f.bad('rinciStokRol', request, /owner/, f.cutter);
  f.bad('rinciStokRol', { ...request, rolls: [{ qty: 200 }, { qty: 28.06 }] }, /melebihi stok yang belum dirinci/);
  for (const rolls of [[], [{ qty: 0 }], [{ qty: -1 }], [{ qty: 1.0001 }], [{ qty: 'banyak' }], [{}], Array.from({ length: 101 }, () => ({ qty: 1 }))]) f.bad('rinciStokRol', { ...request, rolls });
  f.bad('rinciStokRol', { ...request, bahan: 'Tidak Ada' }, /belum ada di daftar stok/); f.bad('rinciStokRol', { ...request, bahan: 'Furing' }, /kg/);
  f.bad('rinciStokRol', { ...request, id: 'x' }, /Identitas/);
  assert.equal(f.raw('StokBahan').length, rows);
});

test('an itemised roll is cut like a bought roll; an unused one can be taken back, a used one and its weight stay', () => {
  const f = fixture();
  const rolls = f.good('rinciStokRol', { id: 'rinci-batch-0001', bahan: 'Scuba Hitam', rolls: [{ qty: 25 }, { qty: 24 }] }).rows;
  f.good('savePOWithRencana', { po: { newId: 'rinci-po-0001', nama: 'Fixture Zipper', jenis: 'stok', status: 'aktif', ukuran: {}, ukuranAktif: ['M'] }, rencana: { id: 'rinci-plan-0001', alokasiBahan: [{ stokId: rolls[0].id, qty: 25 }], catatan: '' } });
  const plan = f.good('getState').rencanaPotong.find(r => r.id === 'rinci-plan-0001');
  assert.deepEqual(plan.rincianRol.map(r => [r.rollLabel, r.qty, r.bahan]), [['Rol 1', 25, 'Scuba Hitam']]);
  const cut = f.good('createPotong', { potong: { id: 'rinci-cut-0001', rencanaId: plan.id, expectedRencanaRevision: plan.revision, ukuran: { M: 40 }, tanggal: '2026-10-09' } });
  assert.equal(cut.kg, 25); assert.equal(cut.bahan, 'Scuba Hitam');
  const m = f.material('scuba hitam'); assert.equal(m.saldo, 203.05); assert.equal(m.pakai, 25); assert.equal(m.legacySaldo, 179.05, 'the stock without roll detail is not touched by a roll cut');
  f.bad('saveStok', { stok: { id: rolls[1].id, bahan: 'Scuba Hitam', qty: 30, satuan: 'kg' } }, /Rincian rol tidak dapat diubah/);
  f.bad('deleteRecord', { sheet: 'StokBahan', id: rolls[0].id }, /sudah dipakai/);
  f.good('deleteRecord', { sheet: 'StokBahan', id: rolls[1].id });
  const back = f.material('scuba hitam'); assert.equal(back.saldo, 203.05); assert.equal(back.legacySaldo, 203.05, 'the kilos return to the stock without roll detail');
  assert.deepEqual(f.good('getState').stokRol.map(r => [r.rollLabel, r.saldo]), [['Rol 1', 0]]);
});

test('a mistyped itemised weight is corrected in place while the roll is untouched; the difference moves to or from the stock without roll detail', () => {
  const f = fixture();
  const rolls = f.good('rinciStokRol', { id: 'rinci-batch-0001', bahan: 'Scuba Hitam', rolls: [{ qty: 25 }, { qty: 48.85 }] }).rows;
  assert.equal(f.material('scuba hitam').legacySaldo, 154.2);
  const fixed = f.good('ubahRinciRol', { id: rolls[1].id, qty: 24.35, expectedQty: 48.85 });
  assert.equal(fixed.qty, 24.35); assert.equal(fixed.rollLabel, 'Rol 2'); assert.equal(fixed.jenis, 'rinci');
  const m = f.material('scuba hitam'); assert.equal(m.saldo, 228.05); assert.equal(m.beli, 228.05); assert.equal(m.legacySaldo, 178.7);
  assert.deepEqual(f.good('getState').stokRol.map(r => [r.rollLabel, r.saldo, r.tersedia]), [['Rol 1', 25, 25], ['Rol 2', 24.35, 24.35]]);
  assert.equal(f.good('ubahRinciRol', { id: rolls[1].id, qty: 24.35, expectedQty: 48.85 }).qty, 24.35, 'the same correction sent again changes nothing');
  f.bad('ubahRinciRol', { id: rolls[1].id, qty: 30, expectedQty: 48.85 }, /sudah berubah/);
  f.bad('ubahRinciRol', { id: rolls[1].id, qty: 203.06, expectedQty: 24.35 }, /melebihi stok yang belum dirinci/);
  assert.equal(f.good('ubahRinciRol', { id: rolls[1].id, qty: 203.05, expectedQty: 24.35 }).qty, 203.05, 'up to everything that has no roll detail');
  assert.equal(f.material('scuba hitam').legacySaldo, 0);
  f.bad('ubahRinciRol', { id: rolls[1].id, qty: 24 }, /owner/, f.admin); f.bad('ubahRinciRol', { id: 'old-stock-0001', qty: 24 }, /tidak ditemukan/); f.bad('ubahRinciRol', { id: 'unknown-roll-01', qty: 24 }, /tidak ditemukan/);
  for (const qty of [0, -1, 1.0001, 'x', '']) f.bad('ubahRinciRol', { id: rolls[1].id, qty }, /lebih dari nol/);
  /* once a roll is set aside for a PO its weight stays */
  f.good('ubahRinciRol', { id: rolls[1].id, qty: 24 });
  f.good('savePOWithRencana', { po: { newId: 'ubah-po-00001', nama: 'Fixture Ubah', jenis: 'stok', status: 'aktif', ukuran: {}, ukuranAktif: ['M'] }, rencana: { id: 'ubah-plan-0001', alokasiBahan: [{ stokId: rolls[0].id, qty: 25 }], catatan: '' } });
  f.bad('ubahRinciRol', { id: rolls[0].id, qty: 26 }, /dipakai, dicadangkan/);
  assert.equal(f.raw('StokBahan').find(r => r.id === rolls[0].id).qty, 25);
});

test('archiving a finished PO keeps every row and only moves it out of the lists; it can be brought back', () => {
  const f = fixture(), id = 'arsip-po-0001';
  f.good('savePOWithRencana', { po: { newId: id, nama: 'Fixture Arsip', jenis: 'stok', status: 'aktif', ukuran: {}, ukuranAktif: ['M'] }, rencana: { id: 'arsip-plan-0001', bahanList: [{ nama: 'Scuba Hitam', qty: 10 }], rol: 1, catatan: '' } });
  f.bad('arsipPO', { id }, /masih aktif/); f.bad('arsipPO', { id: 'unknown-po-0001' }, /tidak ditemukan/); f.bad('arsipPO', {}, /Pilih PO/); f.bad('arsipPO', { id }, /admin/i, f.cutter);
  f.good('saveRencanaPotong', { rencana: { id: 'arsip-plan-0001', status: 'batal' }, expectedRevision: f.good('getState').rencanaPotong.find(r => r.id === 'arsip-plan-0001').revision });
  f.good('setStatusPO', { id, status: 'batal' });
  const po = f.raw('PO').length, plans = f.raw('RencanaPotong').length;
  assert.deepEqual(f.good('arsipPO', { id }), { ok: true, jumlah: 1 }); assert.deepEqual(f.good('arsipPO', { ids: [id] }, f.admin), { ok: true, jumlah: 1 });
  assert.deepEqual(f.good('getState').settings.poSembunyi, [id]); assert.equal(f.raw('PO').length, po); assert.equal(f.raw('RencanaPotong').length, plans);
  assert.equal(f.raw('PO').find(r => r.id === id).status, 'batal', 'the PO keeps its own status');
  assert.deepEqual(f.good('arsipPO', { id, arsip: false }), { ok: true, jumlah: 0 }); assert.deepEqual(f.good('getState').settings.poSembunyi, []);
});

test('the backup hands the owner every table as it is, without PINs or session tokens', () => {
  const f = fixture(), first = f.good('getCadangan');
  assert.equal(first.appVersion, f.good('bootstrap').appVersion); assert.ok(first.tabel.includes('PO') && first.tabel.includes('Pegawai') && first.tabel.includes('StokBahan') && first.tabel.includes('CommerceRecord'));
  assert.ok(!first.tabel.includes('Pengaturan')); assert.equal(typeof first.pengaturan.namaUsaha, 'string');
  const staff = f.good('getCadangan', { tabel: 'Pegawai' });
  assert.equal(staff.jumlah, f.raw('Pegawai').length); assert.equal(staff.rows.length, staff.jumlah); assert.equal(staff.lanjut, null);
  assert.ok(staff.rows.some(r => r.nama === 'Fixture Cutter' && r.divisi === 'potong'));
  for (const row of staff.rows) for (const secret of ['pin', 'token', 'kunci', 'gagal']) assert.ok(!(secret in row), secret + ' is not in the backup');
  assert.ok(!JSON.stringify(staff).includes(f.cutter) && !JSON.stringify(staff).includes('fixture-pin-hash'));
  const stock = f.good('getCadangan', { tabel: 'StokBahan' }); assert.deepEqual(stock.rows.map(r => [r.id, r.bahan, r.qty, r.total]), f.raw('StokBahan').map(r => [r.id, r.bahan, r.qty, r.total]));
  assert.deepEqual(f.good('getCadangan', { tabel: 'StokBahan', mulai: 1 }).rows.map(r => r.id), ['old-stock-0002']); assert.deepEqual(f.good('getCadangan', { tabel: 'StokBahan', mulai: 99 }).rows, []);
  f.bad('getCadangan', {}, /owner/, f.admin); f.bad('getCadangan', { tabel: 'Pegawai' }, /owner/, f.cutter); f.bad('getCadangan', { tabel: 'Pengaturan' }, /tidak dikenal/); f.bad('getCadangan', { tabel: 'Rahasia' }, /tidak dikenal/);
  const writes = f.h.sheets.StokBahan.writes; f.good('getCadangan', { tabel: 'StokBahan' }); assert.equal(f.h.sheets.StokBahan.writes, writes, 'a backup only reads');
});
