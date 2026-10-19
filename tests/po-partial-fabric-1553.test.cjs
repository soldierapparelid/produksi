'use strict';
/* A partial PO keeps its original material charge, then receives only the fabric
   shortfall. These are invented records, exercised through the Sheets adapter. */
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
  const owner = setup.data.token, cutterA = 'partial-fabric-cutter-a-session', cutterB = 'partial-fabric-cutter-b-session';
  const weights = [24.97, 26.2, 24.97, 25.38, 25.43, 25.4, 25.5, 24.72, 24.88, 25.12, 25.18];
  const stock = weights.map((qty, i) => ({ id: 'partial-roll-' + String(i + 1).padStart(2, '0'), jenis: 'beli', tanggal: '2026-10-01', bahan: i < 5 ? 'Scuba Embos Fixture' : 'Scuba Polos Fixture', qty, satuan: 'kg', stockMode: 'roll', rollLabel: 'Fixture ' + (i + 1), rol: 1, harga: 80000, total: Math.round(qty * 80000) }));
  stock.push({ id: 'partial-roll-extra', jenis: 'beli', tanggal: '2026-10-19', bahan: 'Scuba Embos Fixture', qty: 25, satuan: 'kg', stockMode: 'roll', rollLabel: 'Tambahan fixture', rol: 1, harga: 80000, total: 2000000 });
  h.run(`pkStore_().lock(function(){
    pkStore_().append('Pegawai',{id:'partial-cutter-a',nama:'Cutter A',divisi:'potong',aktif:true,token:'${cutterA}'});
    pkStore_().append('Pegawai',{id:'partial-cutter-b',nama:'Cutter B',divisi:'potong',aktif:true,token:'${cutterB}'});
    ${JSON.stringify(stock)}.forEach(function(r){pkStore_().append('StokBahan',r);});
  });`);
  const call = (action, payload = {}, token = owner) => { h.cold(); return h.request(action, { token, workflowVersion: 2, ...payload }); };
  const good = (action, payload = {}, token = owner) => { const r = call(action, payload, token); assert.equal(r.ok, true, r.error); return r.data?.data ?? r.data; };
  const raw = name => { h.cold(); return h.run(`pkStore_().fresh(${JSON.stringify(name)});pkStore_().read(${JSON.stringify(name)})`); };
  const original = good('savePOWithRencana', {
    po: { newId: 'partial-fabric-po', nama: 'Fixture BDU Kerah Tinggi', jenis: 'stok', ukuran: {}, ukuranAktif: ['M', 'XL', 'XXL'] },
    rencana: { id: 'partial-plan-old', alokasiBahan: stock.slice(0, 11).map(r => ({ stokId: r.id, qty: r.qty })) }
  }).rencana;
  const preparedCut = (plan, id, ukuran) => ({ potong: { id, rencanaId: plan.id, expectedRencanaRevision: plan.revision, tanggal: '2026-10-19', ukuran } });
  const continueCut = (id, ukuran) => ({ potong: { id, poId: 'partial-fabric-po', lanjut: true, tanggal: '2026-10-19', ukuran } });
  good('createPotong', preparedCut(original, 'partial-cut-m', { M: 272 }), cutterA);
  const extraRequest = (id = 'partial-plan-extra', qty = 5) => ({ rencana: { id, poId: 'partial-fabric-po', alokasiBahan: [{ stokId: 'partial-roll-extra', qty }] } });
  const poFrom = state => state.po.find(r => r.id === 'partial-fabric-po');
  return { h, owner, cutterA, cutterB, call, good, raw, original, preparedCut, continueCut, extraRequest, poFrom };
}

test('M272 then extra 5kg then XL then XXL preserves the old 11 rolls and charges the extra fabric exactly once', () => {
  const f = fixture(), originalCut = f.raw('Potong')[0], originalPlan = f.raw('RencanaPotong')[0], stockBefore = f.raw('StokBahan');
  const before = f.good('getState'), beforePO = f.poFrom(before);
  assert.equal(beforePO.agg.total.potong, 272);
  assert.deepEqual(beforePO.cutting.pendingUkuran, ['XL', 'XXL']);
  assert.deepEqual(beforePO.cutting.lepasUkuran, [], 'the sizes are active, not marked as canceled');
  assert.equal(beforePO.cutting.lanjut, f.original.id);
  assert.equal(Number(originalCut.kg), 277.75); assert.equal(Number(originalCut.rol), 11);
  assert.ok(before.stokRol.filter(r => r.id !== 'partial-roll-extra').every(r => r.saldo === 0 && r.dicadangkan === 0));

  const extra = f.good('saveRencanaPotong', f.extraRequest());
  assert.equal(f.good('saveRencanaPotong', f.extraRequest()).id, extra.id, 'a resend retains the one additional plan');
  const waiting = f.good('getState'), extraRoll = waiting.stokRol.find(r => r.id === 'partial-roll-extra');
  assert.equal(extraRoll.saldo, 25); assert.equal(extraRoll.dicadangkan, 5); assert.equal(extraRoll.tersedia, 20);
  assert.deepEqual(f.poFrom(waiting).cutting.pendingUkuran, ['XL', 'XXL']);
  assert.equal(f.poFrom(waiting).workflow.pendingCutPlans, true);
  const worker = f.good('getState', {}, f.cutterB);
  assert.equal(worker.potong.length, 0, 'another cutter sees no private rows from Cutter A');
  assert.equal(f.poFrom(worker).agg.total.potong, 272, 'the shared PO total still includes the earlier M cut');
  assert.ok(worker.rencanaPotong.some(r => r.id === extra.id && r.status === 'siap'));
  const bypass = f.call('createPotong', f.continueCut('partial-skip-extra', { XL: 100 }), f.cutterB);
  assert.equal(bypass.ok, false); assert.match(bypass.error, /tidak bisa dilanjutkan/);

  const xlRequest = f.preparedCut(extra, 'partial-cut-xl', { XL: 100 });
  const xl = f.good('createPotong', xlRequest, f.cutterB);
  assert.equal(xl.kg, 5); assert.equal(xl.rol, 1); assert.equal(xl.rencanaId, extra.id);
  assert.equal(f.good('createPotong', xlRequest, f.cutterB).id, xl.id);
  const afterXL = f.good('getState');
  assert.deepEqual(f.poFrom(afterXL).cutting.pendingUkuran, ['XXL']);
  assert.equal(f.poFrom(afterXL).cutting.lanjut, extra.id);
  assert.equal(afterXL.stokRol.find(r => r.id === 'partial-roll-extra').saldo, 20);
  const twice = f.call('createPotong', f.preparedCut(extra, 'partial-cut-extra-twice', { XXL: 80 }), f.cutterA);
  assert.equal(twice.ok, false); assert.match(twice.error, /sudah dipakai/);

  const xxlRequest = f.continueCut('partial-cut-xxl', { XXL: 80 });
  const xxl = f.good('createPotong', xxlRequest, f.cutterB);
  assert.equal(xxl.kg, 0); assert.equal(xxl.rol, 0); assert.equal(xxl.rencanaId, '');
  assert.equal(xxl.bahanList, ''); assert.equal(xxl.alokasiBahan, '');
  assert.equal(f.good('createPotong', xxlRequest, f.cutterB).id, xxl.id);
  const done = f.good('getState');
  assert.deepEqual(f.poFrom(done).cutting.pendingUkuran, []);
  assert.equal(f.poFrom(done).agg.total.potong, 452);
  assert.equal(done.stokRol.find(r => r.id === 'partial-roll-extra').pakai, 5);
  assert.ok(done.stokRol.filter(r => r.id !== 'partial-roll-extra').every(r => r.saldo === 0));
  assert.equal(f.raw('Potong').length, 3); assert.equal(f.raw('RencanaPotong').length, 2);
  assert.deepEqual(f.raw('Potong')[0], originalCut); assert.deepEqual(f.raw('RencanaPotong')[0], originalPlan);
  assert.deepEqual(f.raw('StokBahan'), stockBefore, 'stock purchases are evidence; cuts derive their balance without rewriting them');
});

test('a newly supplied batch can add more M before QC but the old consumed plan cannot be reused for that quantity', () => {
  const f = fixture(), additional = f.good('saveRencanaPotong', f.extraRequest('partial-more-m', 2));
  const saved = f.good('createPotong', f.preparedCut(additional, 'partial-cut-more-m', { M: 30 }), f.cutterB);
  assert.equal(saved.kg, 2); assert.equal(f.poFrom(f.good('getState')).agg.ukuran.M.potong, 302);
  assert.deepEqual(f.poFrom(f.good('getState')).cutting.pendingUkuran, ['XL', 'XXL']);
  const stalePlan = f.call('createPotong', f.preparedCut(f.original, 'partial-reuse-old', { M: 30 }), f.cutterA);
  assert.equal(stalePlan.ok, false); assert.match(stalePlan.error, /sudah dipakai/);
  const noFabric = f.call('createPotong', f.continueCut('partial-repeat-m', { M: 1 }), f.cutterB);
  assert.equal(noFabric.ok, false); assert.match(noFabric.error, /Ukuran M sudah dicatat dipotong/);
  assert.equal(f.raw('Potong').length, 2);
  assert.equal(f.good('getState').stokRol.find(r => r.id === 'partial-roll-extra').pakai, 2);
});

test('another device completing the final size invalidates a stale continuation without consuming any material again', () => {
  const f = fixture(), extra = f.good('saveRencanaPotong', f.extraRequest());
  f.good('createPotong', f.preparedCut(extra, 'partial-cut-xl', { XL: 100 }), f.cutterB);
  assert.deepEqual(f.poFrom(f.good('getState', {}, f.cutterA)).cutting.pendingUkuran, ['XXL']);
  const row = { id: 'partial-other-xxl', poId: 'partial-fabric-po', userId: 'partial-cutter-b', tanggal: '2026-10-19', ukuran: '{"XXL":80}', total: 80, kg: 0, rol: 0, asal: 'lanjut' };
  const schema = f.h.run('SCHEMA.Potong');
  f.h.sheets.Potong.values.push(schema.map(k => row[k] ?? '')); // A different phone committed beyond the cached read.
  const stale = f.call('createPotong', f.continueCut('partial-stale-xxl', { XXL: 80 }), f.cutterA);
  assert.equal(stale.ok, false); assert.match(stale.error, /tidak bisa dilanjutkan/);
  assert.equal(f.raw('Potong').length, 3);
  assert.equal(f.good('getState').stokRol.find(r => r.id === 'partial-roll-extra').pakai, 5);
});

test('explicitly released sizes are not presented as remaining work and can be restored without changing the cut history', () => {
  const f = fixture(), before = f.raw('Potong');
  f.good('lepasUkuranPotong', { poId: 'partial-fabric-po', ukuran: ['XL', 'XXL'], lepas: true });
  const released = f.poFrom(f.good('getState'));
  assert.deepEqual(released.cutting.pendingUkuran, []); assert.deepEqual(released.cutting.lepasUkuran, ['XL', 'XXL']);
  const blocked = f.call('createPotong', f.continueCut('partial-released-xl', { XL: 100 }), f.cutterB);
  assert.equal(blocked.ok, false); assert.match(blocked.error, /tidak bisa dilanjutkan/);
  f.good('lepasUkuranPotong', { poId: 'partial-fabric-po', ukuran: ['XL', 'XXL'], lepas: false });
  assert.deepEqual(f.poFrom(f.good('getState')).cutting.pendingUkuran, ['XL', 'XXL']);
  assert.deepEqual(f.raw('Potong'), before);
});
