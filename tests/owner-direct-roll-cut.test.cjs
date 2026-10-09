'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');

/* The owner records a cut and picks the stock rolls in the same form, and removes finished POs from the list.
   Real Sheets adapter, cold request objects, invented fixtures only. */
function fixture() {
  const h = harness();
  for (const name of ['bahan-invoice', 'cutting-plans', 'auto-completion', 'reconcile-legacy', 'history-corrections']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src', name + '.js'), 'utf8'), h.context);
  }
  const setup = h.request('setupOwner', { nama: 'Fixture Owner', pin: '1234' });
  assert.equal(setup.ok, true, setup.error);
  const owner = setup.data.token, cutter = 'fixture-direct-cutter-token', admin = 'fixture-direct-admin-token';
  h.run(`pkStore_().lock(function(){
    pkStore_().append('Pegawai',{id:'directcutter1',nama:'Fixture Cutter',divisi:'potong',aktif:true,token:'${cutter}'});
    pkStore_().append('Pegawai',{id:'directadmin01',nama:'Fixture Admin',divisi:'admin',aktif:true,token:'${admin}'});
    pkStore_().append('StokBahan',{id:'legacy-stock-001',jenis:'beli',tanggal:'2026-10-01',bahan:'Katun Combed',qty:10,satuan:'kg',rol:2,harga:10000,total:100000,asal:'lama'});
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
  /* two rolls of unequal weight, as the owner enters them in Stok bahan */
  good('saveInvoiceBahan', { invoice: { id: 'directinvoice1', invoice: 'FIXTURE-BON-1', tanggal: '2026-10-08', supplier: 'Fixture Store',
    items: [{ bahan: 'Katun Combed', satuan: 'kg', harga: 12000, rolls: [{ qty: 25, rollLabel: 'Rol 1' }, { qty: 24, rollLabel: 'Rol 2' }, { qty: 6.5, rollLabel: 'Rol 3' }] }] } });
  const rolls = raw('StokBahan').filter(row => row.invoiceId === 'directinvoice1');
  const roll = label => rolls.find(row => row.rollLabel === label).id;
  good('savePOWithRencana', { po: { newId: 'direct-po-001', nama: 'Fixture Zipper', jenis: 'stok', status: 'aktif', ukuran: {}, ukuranAktif: ['M', 'L'] },
    rencana: { id: 'direct-plan-000', alokasiBahan: [{ stokId: roll('Rol 3'), qty: 6.5 }], catatan: '' } });
  function cut(extra = {}, rencana = {}) {
    return { potong: { id: 'direct-cut-001', poId: 'direct-po-001', userId: 'directcutter1', tanggal: '2026-10-08', ukuran: { M: 8, L: 4 },
      rencana: { id: 'direct-cut-001_cut', alokasiBahan: [{ stokId: roll('Rol 1'), qty: 25 }, { stokId: roll('Rol 2'), qty: 24 }], ...rencana }, ...extra } };
  }
  return { h, owner, cutter, admin, call, good, bad, raw, roll, cut };
}

test('the owner records a cut and picks stock rolls in one step: kilos follow the rolls, a resend writes nothing twice', () => {
  const f = fixture(), plans = f.raw('RencanaPotong').length;
  const rec = f.good('createPotong', f.cut());
  assert.equal(rec.rencanaId, 'direct-cut-001_cut'); assert.equal(rec.kg, 49); assert.equal(rec.rol, 2); assert.equal(rec.total, 12); assert.equal(rec.userId, 'directcutter1');
  assert.deepEqual(JSON.parse(rec.alokasiBahan), [{ stokId: f.roll('Rol 1'), qty: 25 }, { stokId: f.roll('Rol 2'), qty: 24 }]);
  const state = f.good('getState'), plan = state.rencanaPotong.find(r => r.id === 'direct-cut-001_cut');
  assert.equal(plan.status, 'terpakai'); assert.equal(plan.potongId, 'direct-cut-001'); assert.equal(plan.poId, 'direct-po-001');
  for (const label of ['Rol 1', 'Rol 2']) { const r = state.stokRol.find(x => x.id === f.roll(label)); assert.equal(r.saldo, 0); assert.equal(r.tersedia, 0); }
  assert.equal(state.stokRol.find(x => x.id === f.roll('Rol 3')).dicadangkan, 6.5, 'the earlier preparation keeps its own roll');
  assert.equal(f.raw('RencanaPotong').length, plans + 1); assert.equal(f.raw('Potong').length, 1);
  /* the same form sent again returns the saved cut; another material list under the same cut id is refused */
  assert.equal(f.good('createPotong', f.cut()).id, 'direct-cut-001');
  f.bad('createPotong', f.cut({}, { id: 'direct-cut-00X_cut' }), /persiapan lain/);
  assert.equal(f.raw('RencanaPotong').length, plans + 1); assert.equal(f.raw('Potong').length, 1);
});

test('a leftover from the old balance can be added to the picked rolls, and an old-balance-only cut still works', () => {
  const f = fixture();
  const mixed = f.good('createPotong', f.cut({}, { alokasiBahan: [{ stokId: f.roll('Rol 1'), qty: 20 }], legacyBahanList: [{ nama: 'Katun Combed', qty: 1.5 }], legacyRol: 0 }));
  assert.equal(mixed.kg, 21.5); assert.equal(mixed.rol, 1);
  const left = f.good('getState').stokRol.find(x => x.id === f.roll('Rol 1')); assert.equal(left.tersedia, 5, 'the rest of the roll stays in stock for the next cut');
  const old = f.good('createPotong', f.cut({ id: 'direct-cut-002', ukuran: { L: 3 } }, { id: 'direct-cut-002_cut', alokasiBahan: undefined, bahanList: [{ nama: 'Katun Combed', qty: 2 }], rol: 1 }));
  assert.equal(old.kg, 2); assert.equal(old.rol, 1); assert.equal(old.alokasiBahan, '');
  f.bad('createPotong', f.cut({ id: 'direct-cut-003', ukuran: { L: 1 } }, { id: 'direct-cut-003_cut', alokasiBahan: undefined, bahanList: [{ nama: 'Katun Combed', qty: 7 }], rol: 0 }), /melebihi stok/);
});

test('only the owner picks rolls this way, and a refused cut leaves no reserved material behind', () => {
  const f = fixture(), plans = f.raw('RencanaPotong').length;
  f.bad('createPotong', f.cut(), /Hanya owner/, f.admin);
  f.bad('createPotong', f.cut(), /disiapkan owner/, f.cutter);
  f.bad('createPotong', f.cut({}, { alokasiBahan: [{ stokId: f.roll('Rol 1'), qty: 25.5 }] }), /melebihi/);
  f.bad('createPotong', f.cut({}, { alokasiBahan: [{ stokId: f.roll('Rol 3'), qty: 1 }] }), /melebihi/);
  f.bad('createPotong', f.cut({ ukuran: { M: 0 } }), /jumlah/);
  f.bad('createPotong', f.cut({ userId: 'directadmin01' }), /tukang potong/);
  f.bad('createPotong', f.cut({}, { id: 'x' }), /Identitas bahan potong/);
  assert.equal(f.raw('RencanaPotong').length, plans); assert.equal(f.raw('Potong').length, 0);
});

test('a preparation left behind by an interrupted save is used once, never duplicated, and never swapped for other material', () => {
  const f = fixture();
  f.good('saveRencanaPotong', { rencana: { id: 'direct-cut-001_cut', poId: 'direct-po-001', alokasiBahan: [{ stokId: f.roll('Rol 1'), qty: 25 }, { stokId: f.roll('Rol 2'), qty: 24 }], catatan: '' } });
  const plans = f.raw('RencanaPotong').length;
  f.bad('createPotong', f.cut({}, { alokasiBahan: [{ stokId: f.roll('Rol 1'), qty: 10 }] }), /isi berbeda/);
  assert.equal(f.good('createPotong', f.cut()).rencanaId, 'direct-cut-001_cut');
  assert.equal(f.raw('RencanaPotong').length, plans); assert.equal(f.raw('Potong').length, 1);
  f.bad('createPotong', f.cut({ id: 'direct-cut-009' }), /isi berbeda/);
});

test('removing a finished PO only hides it from the list: its production rows stay, and it can be shown again', () => {
  const f = fixture(), id = 'direct-po-001';
  f.good('createPotong', f.cut());
  f.bad('deleteRecord', { sheet: 'PO', id }, /catatan produksi/);
  f.bad('deleteRecord', { sheet: 'PO', id, sembunyikan: true }, /masih aktif/);
  f.good('saveRencanaPotong', { rencana: { id: 'direct-plan-000', status: 'batal' }, expectedRevision: f.good('getState').rencanaPotong.find(r => r.id === 'direct-plan-000').revision });
  f.good('setStatusPO', { id, status: 'batal' });
  f.bad('deleteRecord', { sheet: 'PO', id, sembunyikan: true }, /admin/i, f.cutter);
  const po = f.raw('PO').length, cuts = f.raw('Potong').length;
  assert.deepEqual(f.good('deleteRecord', { sheet: 'PO', id, sembunyikan: true }), { ok: true, disembunyikan: true });
  assert.deepEqual(f.good('deleteRecord', { sheet: 'PO', id, sembunyikan: true }), { ok: true, disembunyikan: true });
  assert.equal(f.raw('PO').length, po); assert.equal(f.raw('Potong').length, cuts);
  assert.deepEqual(f.good('getState').settings.poSembunyi, [id]);
  /* the list only ever holds finished or cancelled POs that exist */
  assert.deepEqual(f.good('saveSettings', { settings: { poSembunyi: ['unknown-po-id', id, id] } }).poSembunyi, [id]);
  assert.deepEqual(f.good('saveSettings', { settings: { poSembunyi: [] } }).poSembunyi, []);
  f.good('setStatusPO', { id, status: 'aktif' });
  assert.deepEqual(f.good('saveSettings', { settings: { poSembunyi: [id] } }).poSembunyi, [], 'an active PO is never hidden');
});
