'use strict';
/* Additional fabric for an existing PO. Invented records only; the actual Sheets
   adapter is exercised with a cold request for each device operation. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');

function fixture() {
  const h = harness();
  for (const name of ['cutting-plans', 'auto-completion', 'reconcile-legacy', 'history-corrections']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src', name + '.js'), 'utf8'), h.context);
  }
  const setup = h.request('setupOwner', { nama: 'Owner fixture', pin: '1234' });
  assert.equal(setup.ok, true, setup.error);
  const owner = setup.data.token, cutter = 'fixture-add-fabric-cutter-session', cutter2 = 'fixture-add-fabric-other-session';
  h.run(`pkStore_().lock(function(){
    pkStore_().append('Pegawai',{id:'extra-cutter-01',nama:'Cutter A',divisi:'potong',aktif:true,token:'${cutter}'});
    pkStore_().append('Pegawai',{id:'extra-cutter-02',nama:'Cutter B',divisi:'potong',aktif:true,token:'${cutter2}'});
    pkStore_().append('Pegawai',{id:'extra-sewer-001',nama:'Sewer',divisi:'jahit',aktif:true,token:'fixture-add-fabric-sewer-session'});
    pkStore_().append('StokBahan',{id:'extra-roll-001',jenis:'beli',tanggal:'2026-10-01',bahan:'Katun',qty:25,satuan:'kg',stockMode:'roll',rollLabel:'K-1',rol:1,harga:88000,total:2200000});
    pkStore_().append('StokBahan',{id:'extra-legacy-01',jenis:'beli',tanggal:'2026-10-01',bahan:'Rib',qty:10,satuan:'kg',rol:0,harga:40000,total:400000,asal:'lama'});
  });`);
  const call = (action, payload = {}, token = owner) => { h.cold(); return h.request(action, { token, workflowVersion: 2, ...payload }); };
  const good = (action, payload = {}, token = owner) => { const r = call(action, payload, token); assert.equal(r.ok, true, r.error); return r.data?.data ?? r.data; };
  const raw = name => { h.cold(); return h.run(`pkStore_().fresh(${JSON.stringify(name)});pkStore_().read(${JSON.stringify(name)})`); };
  const first = good('savePOWithRencana', {
    po: { newId: 'extra-po-001', nama: 'Fixture BDU', jenis: 'stok', ukuran: {}, ukuranAktif: ['M', 'XL'] },
    rencana: { id: 'extra-plan-001', alokasiBahan: [{ stokId: 'extra-roll-001', qty: 4 }] }
  }).rencana;
  const cutPayload = (plan, id = 'extra-cut-002', ukuran = { M: 6 }) => ({ potong: { id, rencanaId: plan.id, expectedRencanaRevision: plan.revision, tanggal: '2026-10-19', ukuran } });
  good('createPotong', cutPayload(first, 'extra-cut-001', { M: 10, XL: 8 }), cutter);
  const extra = (id = 'extra-plan-002', qty = 5.25) => ({ rencana: { id, poId: 'extra-po-001', alokasiBahan: [{ stokId: 'extra-roll-001', qty }] } });
  return { h, owner, cutter, cutter2, call, good, raw, first, cutPayload, extra };
}

test('additional fabric creates a separate ready job on the same already-cut PO and preserves the earlier cut', () => {
  const f = fixture(), beforeCuts = f.raw('Potong'), beforePlan = f.raw('RencanaPotong')[0], poBefore = f.raw('PO')[0];
  const added = f.good('saveRencanaPotong', f.extra());
  assert.notEqual(added.id, f.first.id); assert.equal(added.status, 'siap');
  const worker = f.good('getState', {}, f.cutter2), po = worker.po.find(r => r.id === 'extra-po-001');
  assert.ok(po, 'the PO remains visible to a different cutter');
  assert.equal(po.workflow.pendingCutPlans, true);
  assert.ok(worker.rencanaPotong.some(r => r.id === added.id && r.poId === po.id && r.status === 'siap'));
  assert.equal(worker.stok, undefined, 'worker does not receive purchase prices');
  const owner = f.good('getState'), roll = owner.stokRol.find(r => r.id === 'extra-roll-001');
  assert.equal(roll.saldo, 21, 'preparation does not consume stock');
  assert.equal(roll.dicadangkan, 5.25); assert.equal(roll.tersedia, 15.75);
  assert.deepEqual(f.raw('Potong'), beforeCuts);
  assert.deepEqual(f.raw('RencanaPotong')[0], beforePlan);
  assert.equal(f.raw('PO')[0].id, poBefore.id);
  assert.equal(f.raw('PO')[0].ukuranAktif, poBefore.ukuranAktif);
});

test('the added job combines selected rolls and old balance, consumes each once, and retains previous payroll quantities', () => {
  const f = fixture(), beforeCuts = f.raw('Potong'), beforeStock = f.raw('StokBahan');
  const request = f.extra();
  request.rencana.legacyBahanList = [{ nama: 'Rib', qty: 1.5 }]; request.rencana.legacyRol = 0;
  const added = f.good('saveRencanaPotong', request);
  assert.equal(f.good('saveRencanaPotong', request).id, added.id, 'a retry does not create another preparation');
  const requestCut = f.cutPayload(added), result = f.good('createPotong', requestCut, f.cutter2);
  assert.equal(result.kg, 6.75); assert.equal(result.rol, 1); assert.equal(result.total, 6);
  assert.equal(f.good('createPotong', requestCut, f.cutter2).id, result.id);
  assert.equal(f.raw('Potong').length, 2); assert.equal(f.raw('RencanaPotong').length, 2);
  assert.deepEqual(f.raw('Potong')[0], beforeCuts[0]); assert.deepEqual(f.raw('StokBahan'), beforeStock);
  const state = f.good('getState'), roll = state.stokRol.find(r => r.id === 'extra-roll-001');
  assert.equal(roll.pakai, 9.25); assert.equal(roll.saldo, 15.75); assert.equal(roll.dicadangkan, 0);
  assert.equal(state.stokRingkas.find(r => r.nama === 'Rib').saldo, 8.5);
  assert.equal(state.po.find(r => r.id === 'extra-po-001').agg.total.potong, 24);
  const taken = f.call('createPotong', f.cutPayload(added, 'extra-cut-003'), f.cutter);
  assert.equal(taken.ok, false); assert.match(taken.error, /sudah dipakai/);
  assert.equal(f.raw('Potong').length, 2);
});

test('other-device reservations are checked before adding fabric and physical reductions are checked again before cutting', () => {
  const f = fixture();
  f.good('getState');
  const schema = f.h.run('SCHEMA.RencanaPotong');
  const competing = { id: 'competing-plan-01', poId: 'extra-po-001', bahanList: '[{"nama":"Katun","qty":18,"satuan":"kg"}]', alokasiBahan: '[{"stokId":"extra-roll-001","qty":18}]', rol: 1, status: 'siap', revision: 'competing-revision' };
  f.h.sheets.RencanaPotong.values.push(schema.map(k => competing[k] ?? '')); // A different device has saved, without refreshing this device cache.
  const blocked = f.call('saveRencanaPotong', f.extra());
  assert.equal(blocked.ok, false); assert.match(blocked.error, /melebihi/);
  assert.equal(f.raw('RencanaPotong').length, 2, 'no extra reservation is written on failure');
  f.good('saveRencanaPotong', { expectedRevision: competing.revision, rencana: { id: competing.id, status: 'batal' } });
  const added = f.good('saveRencanaPotong', f.extra());
  const cols = f.h.sheets.StokBahan.values[0], row = f.h.sheets.StokBahan.values.find(r => r[cols.indexOf('id')] === 'extra-roll-001');
  row[cols.indexOf('qty')] = 8; // Physical source changed after the owner opened the form.
  const cannotCut = f.call('createPotong', f.cutPayload(added), f.cutter);
  assert.equal(cannotCut.ok, false); assert.match(cannotCut.error, /melebihi/);
  assert.equal(f.raw('Potong').length, 1);
  assert.equal(f.good('getState').rencanaPotong.find(r => r.id === added.id).status, 'siap');
});

test('canceling only the additional fabric releases its reservation without changing used fabric or earlier production', () => {
  const f = fixture(), before = f.raw('Potong'), added = f.good('saveRencanaPotong', f.extra());
  for (const rencana of [{ id: f.first.id, status: 'batal' }, { ...f.extra().rencana, id: f.first.id }]) {
    const r = f.call('saveRencanaPotong', { expectedRevision: f.first.revision, rencana });
    assert.equal(r.ok, false); assert.match(r.error, /sudah dipakai/);
  }
  const workerAttempt = f.call('saveRencanaPotong', f.extra('extra-plan-003', 1), f.cutter);
  assert.equal(workerAttempt.ok, false); assert.match(workerAttempt.error, /Hanya owner/);
  f.good('saveRencanaPotong', { expectedRevision: added.revision, rencana: { id: added.id, status: 'batal' } });
  const state = f.good('getState'), roll = state.stokRol.find(r => r.id === 'extra-roll-001');
  assert.equal(roll.saldo, 21); assert.equal(roll.tersedia, 21); assert.equal(roll.dicadangkan, 0);
  assert.deepEqual(f.raw('Potong'), before);
  assert.equal(state.rencanaPotong.find(r => r.id === f.first.id).status, 'terpakai');
});

test('additional material never bypasses the completed-QC-size protection or creates a second cut from a stale form', () => {
  const f = fixture();
  f.h.run(`pkStore_().lock(function(){
    pkStore_().append('SlipKirim',{id:'extra-send-001',poId:'extra-po-001',maklonId:'extra-sewer-001',ukuran:{M:10},total:10,upah:1000});
    pkStore_().append('SlipSetor',{id:'extra-count-001',poId:'extra-po-001',maklonId:'extra-sewer-001',ukuran:{M:10},total:10,upah:1000,workflowVersion:2,status:'diterima'});
    pkStore_().append('QC',{id:'extra-qc-001',poId:'extra-po-001',setorId:'extra-count-001',maklonId:'extra-sewer-001',ukuran:{M:10},total:10,workflowVersion:2});
  });`);
  const added = f.good('saveRencanaPotong', f.extra());
  const no = f.call('createPotong', f.cutPayload(added, 'extra-cut-002', { M: 1 }), f.cutter);
  assert.equal(no.ok, false); assert.match(no.error, /sudah di-QC/); assert.equal(f.raw('Potong').length, 1);
  const changed = f.good('saveRencanaPotong', { expectedRevision: added.revision, rencana: f.extra('extra-plan-002', 3).rencana });
  const stale = f.call('createPotong', f.cutPayload(added, 'extra-cut-003', { XL: 2 }), f.cutter);
  assert.equal(stale.ok, false); assert.match(stale.error, /berubah sejak/);
  const cut = f.good('createPotong', f.cutPayload(changed, 'extra-cut-004', { XL: 2 }), f.cutter);
  assert.equal(cut.total, 2); assert.equal(cut.kg, 3);
  assert.equal(f.raw('Potong').length, 2);
  assert.equal(f.raw('QC').length, 1);
});
