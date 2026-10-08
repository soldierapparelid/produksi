'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');

/* Exercise the real Sheets adapter with cold request objects. Fixtures are
   invented; no production exports, personal data or account credentials. */
function fixture() {
  const h = harness();
  for (const name of ['bahan-invoice', 'cutting-plans', 'auto-completion', 'reconcile-legacy', 'history-corrections']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src', name + '.js'), 'utf8'), h.context);
  }
  const setup = h.request('setupOwner', { nama: 'Fixture Owner', pin: '1234' });
  assert.equal(setup.ok, true, setup.error);
  const owner = setup.data.token, cutter = 'fixture-roll-cutter-token', other = 'fixture-other-cutter-token';
  h.run(`pkStore_().lock(function(){
    pkStore_().append('Pegawai',{id:'rollworker01',nama:'Fixture Cutter',divisi:'potong',aktif:true,token:'${cutter}'});
    pkStore_().append('Pegawai',{id:'rollworker02',nama:'Fixture Other',divisi:'potong',aktif:true,token:'${other}'});
    pkStore_().append('StokBahan',{id:'legacy-stock-001',jenis:'beli',tanggal:'2026-10-01',bahan:'Katun Combed',qty:10,satuan:'kg',rol:2,harga:10000,total:100000,asal:'lama'});
  });`);
  function call(action, payload = {}, token = owner) {
    h.cold(); return h.request(action, { token, workflowVersion: 2, ...payload });
  }
  function good(action, payload = {}, token = owner) {
    const result = call(action, payload, token); assert.equal(result.ok, true, result.error);
    return result.data && result.data.data !== undefined ? result.data.data : result.data;
  }
  function bad(action, payload, pattern, token = owner) {
    const result = call(action, payload, token); assert.equal(result.ok, false, 'operation must reject');
    if (pattern) assert.match(result.error, pattern); return result;
  }
  function raw(table) {
    h.cold(); return h.run(`pkStore_().fresh(${JSON.stringify(table)});pkStore_().read(${JSON.stringify(table)})`);
  }
  function receipt(extra = {}) {
    return { id: 'rollinvoice001', invoice: 'FIXTURE-BON-1', tanggal: '2026-10-08', supplier: 'Fixture Store',
      items: [
        { bahan: ' katun   COMBED ', satuan: 'kg', harga: 12000, rolls: [{ qty: 7.125, rollLabel: 'A-1' }, { qty: 8.375, rollLabel: 'A-2' }] },
        { bahan: 'Rib', satuan: 'kg', harga: 9000, rolls: [{ qty: 2.25, rollLabel: 'R-1' }] }
      ], ...extra };
  }
  function buy(inv = receipt()) {
    good('saveInvoiceBahan', { invoice: inv });
    return raw('StokBahan').filter(row => row.invoiceId === inv.id);
  }
  function bundle(allocations, poId = 'prepared-po-001', planId = 'prepared-plan-001') {
    return { po: { newId: poId, nama: 'Fixture Roll Product', jenis: 'stok', status: 'aktif', ukuran: { M: 8, L: 4 } },
      rencana: { id: planId, alokasiBahan: allocations, catatan: 'Fixture preparation' } };
  }
  function findPlan(id = 'prepared-plan-001') {
    return good('getState').rencanaPotong.find(row => row.id === id);
  }
  function cutPayload(plan, id = 'prepared-cut-001') {
    return { potong: { id, rencanaId: plan.id, expectedRencanaRevision: plan.revision, ukuran: { M: 8, L: 4 }, tanggal: '2026-10-08' } };
  }
  function interruptNextPO(id) {
    h.context.ROLL_INTERRUPT_PO_ID = id;
    h.run(`var interruptPOStore=pkStore_,interruptPOOnce=true;pkStore_=function(){var s=interruptPOStore();if(!s.interruptPOWrapped){var append=s.append;
      s.append=function(name,row){if(name==='PO'&&row.id===ROLL_INTERRUPT_PO_ID&&interruptPOOnce){interruptPOOnce=false;throw new Error('fixture PO write interrupted');}return append(name,row);};s.interruptPOWrapped=true;}return s;};void 0;`);
  }
  return { h, owner, cutter, other, call, good, bad, raw, receipt, buy, bundle, findPlan, cutPayload, interruptNextPO };
}

test('unequal invoice rolls retain individual weights, canonical stock name and stable retry IDs in one batch', () => {
  const f = fixture(), original = f.raw('StokBahan'), writes = f.h.sheets.StokBahan.writes;
  const inv = f.receipt(), rows = f.buy(inv);
  assert.equal(f.h.sheets.StokBahan.writes - writes, 1, 'all receipt rolls use one appendMany write');
  assert.deepEqual(f.raw('StokBahan').slice(0, original.length), original);
  assert.deepEqual(rows.map(r => [r.bahan, r.qty, r.rol, r.rollLabel]), [
    ['Katun Combed', 7.125, 1, 'A-1'], ['Katun Combed', 8.375, 1, 'A-2'], ['Rib', 2.25, 1, 'R-1']
  ]);
  assert.ok(rows.every(r => r.stockMode === 'roll'));
  assert.equal(new Set(rows.map(r => r.id)).size, 3);
  assert.equal(rows.reduce((sum, row) => sum + row.total, 0), 206250);
  const saved = f.raw('StokBahan'), savedWrites = f.h.sheets.StokBahan.writes;
  f.good('saveInvoiceBahan', { invoice: inv });
  assert.deepEqual(f.raw('StokBahan'), saved); assert.equal(f.h.sheets.StokBahan.writes, savedWrites);
  const changed = f.receipt(); changed.items[0].rolls[0].qty = 7.126;
  f.bad('saveInvoiceBahan', { invoice: changed }, /berbeda|berubah/);
  assert.deepEqual(f.raw('StokBahan'), saved);
});

test('invalid last roll and incompatible units reject the entire receipt without stock writes', () => {
  for (const change of [
    inv => { inv.items[1].rolls[0].qty = 0; },
    inv => { inv.items[1].rolls[0].qty = 1.0001; },
    inv => { inv.items[1].rolls[0].qty = true; },
    inv => { inv.items[1].satuan = 'meter'; },
    inv => { inv.items[1].rolls = []; }
  ]) {
    const f = fixture(), before = f.raw('StokBahan'), writes = f.h.sheets.StokBahan.writes, inv = f.receipt(); change(inv);
    f.bad('saveInvoiceBahan', { invoice: inv });
    assert.deepEqual(f.raw('StokBahan'), before); assert.equal(f.h.sheets.StokBahan.writes, writes);
  }
});

test('seven and eight rolls from separate invoices merge under one canonical material without averaging weights', () => {
  const f = fixture();
  const first = f.receipt({ id: 'seven-roll-invoice', invoice: 'FIXTURE-SEVEN', items: [{ bahan: 'Linen Soft', satuan: 'kg', harga: 10000,
    rolls: Array.from({ length: 7 }, (_, index) => ({ qty: 3 + index / 10, rollLabel: 'Seven-' + (index + 1) })) }] });
  const next = f.receipt({ id: 'eight-roll-invoice', invoice: 'FIXTURE-EIGHT', items: [{ bahan: '  LINEN   soft ', satuan: 'kg', harga: 10000,
    rolls: Array.from({ length: 8 }, (_, index) => ({ qty: 4 + index / 10, rollLabel: 'Eight-' + (index + 1) })) }] });
  f.buy(first); f.buy(next);
  const rows = f.raw('StokBahan').filter(r => r.bahan === 'Linen Soft');
  assert.equal(rows.filter(r => r.invoiceId === first.id).length, 7);
  assert.equal(rows.filter(r => r.invoiceId === next.id).length, 8);
  assert.deepEqual(rows.map(r => r.qty), first.items[0].rolls.concat(next.items[0].rolls).map(r => r.qty));
  const state = f.good('getState'), materials = state.stokRingkas.filter(r => r.kunci === 'linen soft');
  assert.equal(materials.length, 1); assert.equal(materials[0].rol, 15);
  assert.equal(Math.round(materials[0].beli * 1000), 57900);
  assert.equal(state.stokRol.filter(r => rows.some(row => row.id === r.id)).length, 15);
  assert.ok(!state.stokRol.some(r => r.id === 'legacy-stock-001'));
});

test('an interrupted roll invoice retries missing stable rows without re-creating committed rolls', () => {
  for (const committed of [2, 3]) {
    const f = fixture(), original = f.raw('StokBahan'), inv = f.receipt();
    f.h.context.ROLL_INVOICE_COMMITTED = committed;
    f.h.run(`var rollInvoiceStore=pkStore_,rollInvoiceFailOnce=true;pkStore_=function(){var s=rollInvoiceStore();if(!s.rollInvoiceWrapped){
      var appendMany=s.appendMany;s.appendMany=function(name,rows){if(name==='StokBahan'&&rollInvoiceFailOnce){rollInvoiceFailOnce=false;appendMany(name,rows.slice(0,ROLL_INVOICE_COMMITTED));throw new Error('fixture invoice response interrupted');}return appendMany(name,rows);};
      s.rollInvoiceWrapped=true;}return s;};void 0;`);
    f.bad('saveInvoiceBahan', { invoice: inv }, /fixture invoice response interrupted/);
    const partial = f.raw('StokBahan'); assert.equal(partial.length, original.length + committed);
    const stock = f.buy(inv); assert.equal(stock.length, 3); assert.equal(new Set(stock.map(r => r.id)).size, 3);
    assert.deepEqual(f.raw('StokBahan').slice(0, partial.length), partial);
    const complete = f.raw('StokBahan'); f.good('saveInvoiceBahan', { invoice: inv });
    assert.deepEqual(f.raw('StokBahan'), complete);
    assert.deepEqual(stock.map(r => r.qty), [7.125, 8.375, 2.25]);
  }
});

test('partial and whole roll reservations consume once, preserve invoice rows and reject manual cutter material', () => {
  const f = fixture(), rows = f.buy(), allocations = [{ stokId: rows[0].id, qty: 2.125 }, { stokId: rows[1].id, qty: 8.375 }];
  const input = f.bundle(allocations); f.good('savePOWithRencana', input);
  const plan = f.findPlan(); assert.equal(plan.status, 'siap');
  const state = f.good('getState'), first = state.stokRol.find(r => r.id === rows[0].id), second = state.stokRol.find(r => r.id === rows[1].id);
  assert.equal(first.tersedia, 5); assert.equal(second.tersedia, 0);
  assert.ok(!state.stokRol.some(r => r.id === 'legacy-stock-001'), 'legacy aggregate weights cannot be split into invented roll identities');
  const worker = f.good('getState', {}, f.cutter);
  assert.equal(worker.stok, undefined); assert.equal(worker.stokRol, undefined);
  assert.ok(worker.rencanaPotong.some(r => r.id === plan.id));
  assert.doesNotMatch(JSON.stringify(worker.rencanaPotong), /"(?:harga|totalHarga|supplier)":/, 'prepared material quantities must not reveal invoice costs');
  f.bad('saveRencanaPotong', { rencana: { id: 'over-plan-001', poId: input.po.newId, alokasiBahan: [{ stokId: rows[1].id, qty: 0.001 }] } }, /stok|tersedia|rol/i);
  f.bad('createPotong', { potong: { id: 'manual-cut-001', poId: input.po.newId, ukuran: { M: 1 }, alokasiBahan: allocations } }, /owner|disiapkan/i, f.cutter);
  f.bad('createPotong', { potong: { ...f.cutPayload(plan).potong, alokasiBahan: [{ stokId: rows[2].id, qty: 1 }] } }, /owner|ditentukan|persiapan/i, f.cutter);
  const beforeStock = f.raw('StokBahan'), beforePlans = f.raw('RencanaPotong');
  const cut = f.good('createPotong', f.cutPayload(plan), f.cutter);
  assert.equal(cut.kg, 10.5); assert.equal(cut.rencanaId, plan.id);
  const savedAllocation = typeof cut.alokasiBahan === 'string' ? JSON.parse(cut.alokasiBahan) : cut.alokasiBahan;
  assert.deepEqual(savedAllocation.map(r => [r.stokId, r.qty]), allocations.map(r => [r.stokId, r.qty]));
  f.good('createPotong', f.cutPayload(plan), f.cutter);
  assert.equal(f.raw('Potong').length, 1); assert.deepEqual(f.raw('StokBahan'), beforeStock); assert.deepEqual(f.raw('RencanaPotong'), beforePlans);
  assert.equal(f.findPlan().status, 'terpakai');
  const after = f.good('getState');
  assert.equal(after.stokRol.find(r => r.id === rows[0].id).tersedia, 5);
  assert.equal(after.stokRol.find(r => r.id === rows[1].id).tersedia, 0);
  f.good('savePOWithRencana', input);
  assert.equal(f.raw('Potong').length, 1); assert.deepEqual(f.raw('RencanaPotong'), beforePlans);
  f.bad('createPotong', f.cutPayload(plan, 'second-cut-001'), /sudah dipakai/, f.other);
});

test('consumed roll allocations cannot be released by plan cancellation, editing the receipt or deleting the cut', () => {
  const f = fixture(), rows = f.buy(); f.good('savePOWithRencana', f.bundle([{ stokId: rows[0].id, qty: 3.125 }]));
  const plan = f.findPlan(), cut = f.good('createPotong', f.cutPayload(plan), f.cutter);
  const beforeStock = f.raw('StokBahan'), beforeCut = f.raw('Potong');
  f.bad('saveRencanaPotong', { expectedRevision: plan.revision, rencana: { id: plan.id, status: 'batal' } }, /dipakai|terpakai/);
  f.bad('saveRencanaPotong', { expectedRevision: plan.revision, rencana: { id: plan.id, poId: plan.poId, alokasiBahan: [{ stokId: rows[0].id, qty: 1 }] } }, /dipakai|terpakai/);
  f.bad('saveStok', { stok: { ...rows[0], qty: 9 } }, /rol|dipakai|terpakai|persiapan/i);
  f.bad('deleteRecord', { sheet: 'StokBahan', id: rows[0].id }, /rol|dipakai|terpakai|persiapan/i);
  f.bad('deleteRecord', { sheet: 'Potong', id: cut.id }, /persiapan/);
  assert.deepEqual(f.raw('StokBahan'), beforeStock); assert.deepEqual(f.raw('Potong'), beforeCut);
  assert.equal(f.good('getState').stokRol.find(r => r.id === rows[0].id).tersedia, 4);
});

test('reserved receipt stays immutable until cancellation explicitly releases its unused roll', () => {
  const f = fixture(), rows = f.buy(); f.good('savePOWithRencana', f.bundle([{ stokId: rows[0].id, qty: 3.125 }]));
  const plan = f.findPlan(), stock = f.raw('StokBahan');
  f.bad('saveStok', { stok: { ...rows[0], qty: 9 } }, /rol|dipakai|terpakai|persiapan|cadang/i);
  f.bad('deleteRecord', { sheet: 'StokBahan', id: rows[0].id }, /rol|dipakai|terpakai|persiapan|cadang/i);
  assert.deepEqual(f.raw('StokBahan'), stock);
  assert.equal(f.good('getState').stokRol.find(r => r.id === rows[0].id).tersedia, 4);
  f.good('saveRencanaPotong', { expectedRevision: plan.revision, rencana: { id: plan.id, status: 'batal' } });
  assert.equal(f.good('getState').stokRol.find(r => r.id === rows[0].id).tersedia, 7.125);
  assert.equal(f.raw('Potong').length, 0);
});

test('plan-first PO failure keeps a non-cuttable reservation and retry completes only the missing PO', () => {
  for (const failAfterWrite of [false, true]) {
    const f = fixture(), rows = f.buy(), input = f.bundle([{ stokId: rows[0].id, qty: 4.125 }]);
    f.h.context.ROLL_FAIL_AFTER_WRITE = failAfterWrite;
    f.h.run(`var rollOriginalStore=pkStore_,rollFailOnce=true;pkStore_=function(){var s=rollOriginalStore();if(!s.rollFailureWrapped){
      var append=s.append;s.append=function(name,row){if(name==='PO'&&row.id==='prepared-po-001'&&rollFailOnce){rollFailOnce=false;if(ROLL_FAIL_AFTER_WRITE)append(name,row);throw new Error('fixture PO response interrupted');}return append(name,row);};
      s.rollFailureWrapped=true;}return s;};void 0;`);
    f.bad('savePOWithRencana', input, /fixture PO response interrupted/);
    assert.equal(f.raw('RencanaPotong').length, 1); assert.equal(f.raw('PO').length, failAfterWrite ? 1 : 0);
    const pending = f.findPlan();
    if (!failAfterWrite) {
      assert.equal(pending.status, 'menyiapkan');
      f.bad('createPotong', f.cutPayload(pending), /tersedia|menyiapkan|PO|selesai/i, f.cutter);
    }
    assert.equal(f.good('getState').stokRol.find(r => r.id === rows[0].id).tersedia, 3);
    f.good('savePOWithRencana', input); f.good('savePOWithRencana', input);
    assert.equal(f.raw('PO').length, 1); assert.equal(f.raw('RencanaPotong').length, 1); assert.equal(f.raw('Potong').length, 0);
    assert.equal(f.findPlan().status, 'siap');
    const changed = structuredClone(input); changed.po.nama = 'Different draft';
    f.bad('savePOWithRencana', changed, /berbeda|berubah/);
    assert.equal(f.raw('PO')[0].nama, 'FIXTURE ROLL PRODUCT');
  }
});

test('a large roll receipt uses bounded Sheets reads and a single append rather than per-roll service calls', () => {
  const f = fixture();
  let reads = 0;
  const sheet = f.h.sheets.StokBahan, getDataRange = sheet.getDataRange.bind(sheet);
  sheet.getDataRange = function () { reads++; return getDataRange(); };
  const writes = sheet.writes;
  const inv = f.receipt({ items: [
    { bahan: 'Katun Combed', satuan: 'kg', harga: 12000, rolls: Array.from({ length: 100 }, (_, i) => ({ qty: 1 + i / 1000, rollLabel: 'C-' + (i + 1) })) },
    { bahan: 'Rib', satuan: 'kg', harga: 9000, rolls: Array.from({ length: 100 }, (_, i) => ({ qty: 2 + i / 1000, rollLabel: 'R-' + (i + 1) })) }
  ] });
  f.good('saveInvoiceBahan', { invoice: inv });
  assert.equal(sheet.writes - writes, 1);
  assert.ok(reads <= 2, 'physical stock reads stay bounded for all 200 rolls; got ' + reads);
  assert.equal(sheet.getLastRow(), 202, 'header + existing legacy receipt + 200 new rolls');
  const beforeRetry = sheet.writes; reads = 0;
  f.good('saveInvoiceBahan', { invoice: inv });
  assert.equal(sheet.writes, beforeRetry); assert.ok(reads <= 2);
});

test('taking a prepared roll rechecks physical stock even when cached receipt still has enough weight', () => {
  const f = fixture(), rows = f.buy(); f.good('savePOWithRencana', f.bundle([{ stokId: rows[0].id, qty: 6 }]));
  const plan = f.findPlan(); f.good('getState');
  const sheet = f.h.sheets.StokBahan, header = sheet.values[0];
  const row = sheet.values.find(r => r[header.indexOf('id')] === rows[0].id);
  row[header.indexOf('qty')] = 5;
  f.bad('createPotong', f.cutPayload(plan), /stok|tersedia|rol|berubah/i, f.cutter);
  assert.equal(f.raw('Potong').length, 0);
});

test('new PO material authorization and allocation validation run before either creation table is written', () => {
  for (const kind of ['worker', 'missing-source', 'too-heavy', 'fraction-precision']) {
    const f = fixture(), rows = f.buy(), input = f.bundle([{ stokId: rows[0].id, qty: 1 }]);
    if (kind === 'missing-source') input.rencana.alokasiBahan[0].stokId = 'not-a-stock-row';
    if (kind === 'too-heavy') input.rencana.alokasiBahan[0].qty = 8;
    if (kind === 'fraction-precision') input.rencana.alokasiBahan[0].qty = 1.0001;
    const oldStock = f.raw('StokBahan');
    f.bad('savePOWithRencana', input, undefined, kind === 'worker' ? f.cutter : f.owner);
    assert.equal(f.raw('PO').length, 0); assert.equal(f.raw('RencanaPotong').length, 0);
    assert.deepEqual(f.raw('StokBahan'), oldStock);
  }
});

test('legacy aggregate material consumes only its own pool and never invents use of identified invoice rolls', () => {
  const f = fixture(), rows = f.buy();
  f.h.run(`pkStore_().lock(function(){pkStore_().append('PO',{id:'legacy-pool-po',noPO:'FIXTURE-OLD',nama:'Fixture old PO',status:'aktif',ukuran:{M:8,L:4}});});`);
  const plan = f.good('saveRencanaPotong', { rencana: { id: 'legacy-pool-plan', poId: 'legacy-pool-po', bahanList: [{ nama: ' katun combed ', qty: 8, satuan: 'kg' }], rol: 0 } });
  let state = f.good('getState');
  assert.deepEqual(rows.map(r => state.stokRol.find(s => s.id === r.id).tersedia), [7.125, 8.375, 2.25]);
  f.good('createPotong', f.cutPayload(plan, 'legacy-pool-cut'), f.cutter);
  state = f.good('getState');
  assert.deepEqual(rows.map(r => state.stokRol.find(s => s.id === r.id).tersedia), [7.125, 8.375, 2.25]);
  f.bad('saveRencanaPotong', { rencana: { id: 'legacy-overspend', poId: 'legacy-pool-po', bahanList: [{ nama: 'Katun Combed', qty: 3, satuan: 'kg' }], rol: 0 } }, /stok|tersedia|agregat|lama|rol/i);
  assert.equal(f.raw('Potong').length, 1);
  f.good('saveRencanaPotong', { rencana: { id: 'legacy-remainder', poId: 'legacy-pool-po', bahanList: [{ nama: 'Katun Combed', qty: 2, satuan: 'kg' }], rol: 0 } });
});

test('pending PO reservation can resume from its exposed draft or be cancelled without creating a PO', () => {
  for (const cancel of [false, true]) {
    const f = fixture(), rows = f.buy(), input = f.bundle([{ stokId: rows[0].id, qty: 4.125 }]);
    f.interruptNextPO(input.po.newId); f.bad('savePOWithRencana', input, /fixture PO write interrupted/);
    const pending = f.findPlan(); assert.equal(pending.status, 'menyiapkan'); assert.ok(pending.poDraft);
    assert.equal(f.good('getState', {}, f.cutter).rencanaPotong.some(p => p.id === pending.id), false, 'incomplete PO is not a cutter job');
    if (cancel) {
      f.good('saveRencanaPotong', { expectedRevision: pending.revision, rencana: { id: pending.id, status: 'batal' } });
      assert.equal(f.raw('PO').length, 0); assert.equal(f.findPlan().status, 'batal');
      assert.equal(f.good('getState').stokRol.find(r => r.id === rows[0].id).tersedia, 7.125);
      f.bad('savePOWithRencana', input, /dibatalkan|berbeda/);
    } else {
      const po = { ...pending.poDraft }; delete po.noPO;
      f.good('savePOWithRencana', { po, rencana: { id: pending.id, alokasiBahan: pending.alokasiBahan, catatan: pending.catatan } });
      assert.equal(f.raw('PO').length, 1); assert.equal(f.raw('PO')[0].noPO, pending.poDraft.noPO);
      assert.equal(f.findPlan().status, 'siap');
    }
  }
});

test('legacy pool can prepare a new PO upfront and invalid contract, product or image never leaves a reservation', () => {
  const f = fixture();
  const input = f.bundle([]); input.rencana = { id: 'legacy-new-plan', bahanList: [{ nama: 'Katun Combed', qty: 8, satuan: 'kg' }], rol: 0 };
  f.good('savePOWithRencana', input);
  const state = f.good('getState'); assert.equal(state.po.length, 1);
  assert.equal(state.rencanaPotong[0].bahanList[0].qty, 8);
  assert.deepEqual(state.rencanaPotong[0].alokasiBahan, []);
  assert.equal(state.stokRingkas.find(r => r.kunci === 'katun combed').legacyTersedia, 2);
  for (const kind of ['old-contract', 'bad-product', 'bad-image']) {
    const g = fixture(), rolls = g.buy(), payload = g.bundle([{ stokId: rolls[0].id, qty: 1 }]);
    if (kind === 'old-contract') payload.workflowVersion = 1;
    if (kind === 'bad-product') payload.po.produkId = 'missing-product';
    if (kind === 'bad-image') payload.gambarData = 'javascript:invalid-image';
    g.bad('savePOWithRencana', payload);
    assert.equal(g.raw('PO').length, 0); assert.equal(g.raw('RencanaPotong').length, 0);
  }
});

test('replacement preserves an existing prepared PO while tolerating a genuinely pending parent', () => {
  const f = fixture(), rows = f.buy(), input = f.bundle([{ stokId: rows[0].id, qty: 1 }]);
  f.good('savePOWithRencana', input);
  f.h.context.ROLL_REPLACEMENT_PLANS = f.raw('RencanaPotong'); f.h.context.ROLL_REPLACEMENT_BEFORE_PO = f.raw('PO');
  assert.throws(() => f.h.run('coreCutValidateReplacement([],[],ROLL_REPLACEMENT_PLANS,[],ROLL_REPLACEMENT_BEFORE_PO)'), /PO|persiapan/i);
  const g = fixture(), rolls = g.buy(), pending = g.bundle([{ stokId: rolls[0].id, qty: 1 }]);
  g.interruptNextPO(pending.po.newId); g.bad('savePOWithRencana', pending, /fixture PO write interrupted/);
  g.h.context.ROLL_REPLACEMENT_PLANS = g.raw('RencanaPotong');
  assert.equal(g.h.run('coreCutValidateReplacement([],[],ROLL_REPLACEMENT_PLANS,[],[])'), true);
});

test('import paths cannot rewrite receipts or allocations of a locally prepared cut', () => {
  const f = fixture(), rows = f.buy(); f.good('savePOWithRencana', f.bundle([{ stokId: rows[0].id, qty: 3.125 }]));
  const plan = f.findPlan(), cut = f.good('createPotong', f.cutPayload(plan), f.cutter);
  const stock = f.raw('StokBahan'), cuts = f.raw('Potong');
  f.good('importRows', { sheet: 'StokBahan', rows: [{ ...rows[0], qty: 99, bahan: 'Wrong material', stockMode: '' }] });
  f.good('gantiImpor', { data: { StokBahan: [{ ...rows[0], qty: 99, bahan: 'Wrong material', stockMode: '' }], Potong: [] } });
  assert.deepEqual(f.raw('StokBahan').filter(r => r.stockMode === 'roll'), stock.filter(r => r.stockMode === 'roll'));
  assert.deepEqual(f.raw('Potong'), cuts);
  f.bad('importRows', { sheet: 'StokBahan', rows: [{ ...rows[0], id: 'forged-new-roll' }] }, /rol|invoice|impor/i);
  f.bad('gantiImpor', { data: { StokBahan: [{ ...rows[0], id: 'forged-new-roll' }] } }, /rol|impor/i);
  for (const action of ['importRows', 'gantiImpor']) {
    const forged = { ...cut, id: 'forged-cut-001', rencanaId: '', alokasiBahan: [{ stokId: rows[0].id, qty: 4 }] };
    f.bad(action, action === 'importRows' ? { sheet: 'Potong', rows: [forged] } : { data: { Potong: [forged] } }, /persiapan|impor/i);
  }
  assert.deepEqual(f.raw('Potong'), cuts);
});

test('historical quantity correction never alters material accounting or grants correction access to a new rolled cut', () => {
  const f = fixture(), rows = f.buy(); f.good('savePOWithRencana', f.bundle([{ stokId: rows[0].id, qty: 3.125 }]));
  const plan = f.findPlan(), cut = f.good('createPotong', f.cutPayload(plan), f.cutter);
  f.bad('getHistoryCorrection', { sheet: 'Potong', rowId: cut.id, poId: cut.poId }, /catatan lama|tinjau/i);
  f.h.run(`pkStore_().lock(function(){
    pkStore_().append('PO',{id:'old-review-po',noPO:'FIXTURE-REVIEW',nama:'Fixture historical PO',status:'aktif',ukuran:{M:12},total:12,asal:'lama',imporSumber:{legacyReconciliation:{mode:'review'}}});
    pkStore_().append('Potong',{id:'old-review-cut',poId:'old-review-po',userId:'rollworker01',tanggal:'2026-10-01',ukuran:{M:12},total:12,bahan:'Katun Combed',kg:3,rol:0,bahanList:[{nama:'Katun Combed',qty:3}],asal:'lama',upahId:'LAMA'});
  });`);
  const beforeCuts = f.raw('Potong'), beforeStock = f.raw('StokBahan'), inventory = f.good('getState').stokRol;
  const check = f.good('getHistoryCorrection', { sheet: 'Potong', rowId: 'old-review-cut', poId: 'old-review-po' });
  f.good('saveHistoryCorrection', { id: 'roll-history-check', sheet: 'Potong', rowId: 'old-review-cut', poId: 'old-review-po', expectedSourceHash: check.sourceHash,
    expectedLastCorrectionId: check.lastCorrectionId, ukuran: { M: 14 }, reason: 'Fixture verified recount' });
  assert.deepEqual(f.raw('Potong'), beforeCuts); assert.deepEqual(f.raw('StokBahan'), beforeStock);
  const after = f.good('getState'); assert.deepEqual(after.stokRol, inventory);
  assert.equal(after.potong.find(r => r.id === 'old-review-cut').total, 14);
  assert.equal(after.potong.find(r => r.id === 'old-review-cut').kg, 3);
});

test('one prepared job can reserve identified rolls and a separate legacy material pool without duplicate consumption', () => {
  const f = fixture(), rows = f.buy();
  const input = f.bundle([{ stokId: rows[2].id, qty: 1.25 }]);
  input.rencana.legacyBahanList = [{ nama: 'Katun Combed', qty: 3, satuan: 'kg' }]; input.rencana.legacyRol = 0;
  f.good('savePOWithRencana', input);
  const plan = f.findPlan(), state = f.good('getState');
  assert.equal(state.stokRol.find(r => r.id === rows[2].id).tersedia, 1);
  assert.equal(state.stokRingkas.find(r => r.kunci === 'katun combed').legacyTersedia, 7);
  const changed = structuredClone(input); changed.rencana.legacyBahanList[0].qty = 4;
  f.bad('savePOWithRencana', changed, /berbeda|berubah/);
  const cut = f.good('createPotong', f.cutPayload(plan), f.cutter);
  assert.equal(cut.kg, 4.25); assert.equal(cut.rol, 1);
  const consumed = JSON.parse(cut.bahanList);
  assert.equal(consumed.find(r => r.nama === 'Rib').qty, 1.25);
  assert.equal(consumed.find(r => r.nama === 'Katun Combed').qty, 3);
  f.good('createPotong', f.cutPayload(plan), f.cutter); f.good('savePOWithRencana', input);
  assert.equal(f.raw('Potong').length, 1);
  const after = f.good('getState');
  assert.equal(after.stokRol.find(r => r.id === rows[2].id).tersedia, 1);
  assert.equal(after.stokRingkas.find(r => r.kunci === 'katun combed').legacySaldo, 7);
  assert.equal(after.stokRingkas.find(r => r.kunci === 'katun combed').legacyTersedia, 7);
});

function rollCount(f, rowId, id, actual) {
  const current = f.good('getState').stokRol.find(row => row.id === rowId);
  assert.ok(current, 'counting requires an identified receipt roll');
  return { id, stokId: rowId, fisik: actual, expectedSaldo: current.saldo,
    expectedCorrectionId: current.correctionRevision || '', expectedSourceRevision: current.sourceRevision,
    catatan: 'Fixture warehouse recount' };
}

test('source roll recount appends evidence, respects reservations and retries without restoring consumed weight', () => {
  const f = fixture(), rows = f.buy(), source = rows[0];
  f.good('savePOWithRencana', f.bundle([{ stokId: source.id, qty: 3 }]));
  const original = f.raw('StokBahan'), plan = f.findPlan();
  f.bad('cocokkanStokRol', rollCount(f, source.id, 'source-count-too-low', 2.999), /cadang|persiapan/i);
  assert.deepEqual(f.raw('StokBahan'), original);
  const payload = rollCount(f, source.id, 'source-count-reserved', 5);
  const correction = f.good('cocokkanStokRol', payload);
  assert.equal(correction.sourceStockId, source.id); assert.equal(correction.qty, -2.125);
  assert.equal(correction.saldoBefore, 7.125); assert.equal(correction.saldoAfter, 5);
  assert.equal(correction.previousCorrectionId, '');
  assert.deepEqual(f.raw('StokBahan').find(row => row.id === source.id), source);
  let current = f.good('getState').stokRol.find(row => row.id === source.id);
  assert.equal(current.saldo, 5); assert.equal(current.tersedia, 2);
  assert.equal(current.correctionRevision, payload.id);
  f.good('createPotong', f.cutPayload(plan), f.cutter);
  const afterCut = f.raw('StokBahan');
  f.good('cocokkanStokRol', payload);
  assert.deepEqual(f.raw('StokBahan'), afterCut, 'same-ID response retry must not apply the difference twice');
  current = f.good('getState').stokRol.find(row => row.id === source.id);
  assert.equal(current.saldo, 2); assert.equal(current.tersedia, 2);
  f.bad('cocokkanStokRol', { ...payload, fisik: 6 }, /berbeda|berubah|sama/i);
  assert.equal(f.raw('StokBahan').filter(row => row.sourceStockId === source.id).length, 1);
});

test('physical source recount rejects stale balance and stale correction lineage across cold requests', () => {
  const f = fixture(), source = f.buy()[0];
  const stale = rollCount(f, source.id, 'source-count-stale', 4);
  f.good('cocokkanStokRol', { ...stale, id: 'source-count-first', fisik: 6 });
  f.bad('cocokkanStokRol', stale, /berubah|terbaru|ulang/i);
  f.good('cocokkanStokRol', rollCount(f, source.id, 'source-count-return', 7.125));
  f.bad('cocokkanStokRol', stale, /berubah|terbaru|ulang/i);
  const beforeCut = rollCount(f, source.id, 'source-count-before-cut', 3);
  f.good('savePOWithRencana', f.bundle([{ stokId: source.id, qty: 1 }]));
  f.good('createPotong', f.cutPayload(f.findPlan()), f.cutter);
  const rows = f.raw('StokBahan');
  f.bad('cocokkanStokRol', beforeCut, /berubah|terbaru|ulang/i);
  assert.deepEqual(f.raw('StokBahan'), rows);
  assert.equal(f.good('getState').stokRol.find(row => row.id === source.id).saldo, 6.125);
});

test('unchanged roll weight does not permit a recount against an edited source label or material', () => {
  for (const change of [{ rollLabel: 'A-1 revised' }, { bahan: 'Fixture Other Cotton' }]) {
    const f = fixture(), source = f.buy()[0];
    const stale = rollCount(f, source.id, 'source-count-old-identity', 6);
    assert.equal(typeof stale.expectedSourceRevision, 'string');
    assert.ok(stale.expectedSourceRevision.length > 0);
    f.good('saveStok', { stok: { ...source, ...change } });
    const before = f.raw('StokBahan'), fresh = rollCount(f, source.id, 'source-count-new-identity', 6);
    assert.equal(fresh.expectedSaldo, stale.expectedSaldo);
    assert.equal(fresh.expectedCorrectionId, stale.expectedCorrectionId);
    assert.notEqual(fresh.expectedSourceRevision, stale.expectedSourceRevision);
    f.bad('cocokkanStokRol', stale, /identitas|berubah|ulang/i);
    assert.deepEqual(f.raw('StokBahan'), before, 'stale source proof must reject before appending evidence');
    const correction = f.good('cocokkanStokRol', fresh);
    assert.equal(correction.sourceRevision, fresh.expectedSourceRevision);
    const saved = f.raw('StokBahan');
    f.good('cocokkanStokRol', fresh);
    f.bad('cocokkanStokRol', { ...fresh, expectedSourceRevision: stale.expectedSourceRevision }, /berbeda/i);
    assert.deepEqual(f.raw('StokBahan'), saved);
  }
});

test('source recount requires owner, current workflow and explicit valid physical measurements before writes', () => {
  const f = fixture(), source = f.buy()[0], valid = rollCount(f, source.id, 'source-count-invalid', 6);
  const before = f.raw('StokBahan');
  f.bad('cocokkanStokRol', valid, /owner/i, f.cutter);
  f.bad('cocokkanStokRol', { ...valid, workflowVersion: 1 }, /versi|ulang|alur/i);
  for (const change of [{ fisik: '' }, { fisik: null }, { fisik: true }, { fisik: -1 }, { fisik: 1.0001 },
    { fisik: 100000001 }, { catatan: '' }, { catatan: 'x'.repeat(301) }, { stokId: 'legacy-stock-001' }]) {
    f.bad('cocokkanStokRol', { ...valid, ...change });
    assert.deepEqual(f.raw('StokBahan'), before);
  }
});

test('source recount evidence and linked receipt cannot be edited, deleted or forged by import paths', () => {
  const f = fixture(), source = f.buy()[0];
  const byId = rows => rows.slice().sort((a, b) => a.id.localeCompare(b.id));
  f.good('cocokkanStokRol', rollCount(f, source.id, 'source-count-immutable', 5));
  const before = f.raw('StokBahan'), correction = before.find(row => row.id === 'source-count-immutable');
  for (const row of [source, correction]) {
    f.bad('saveStok', { stok: { ...row, qty: 99 } }, /koreksi|rol|ubah|bukti/i);
    f.bad('deleteRecord', { sheet: 'StokBahan', id: row.id }, /koreksi|rol|hapus|bukti/i);
  }
  f.good('importRows', { sheet: 'StokBahan', rows: [{ ...correction, qty: 100, saldoAfter: 107.125 }] });
  f.good('gantiImpor', { data: { StokBahan: before.filter(row => row.asal === 'lama').concat([{ ...correction, qty: 100, saldoAfter: 107.125 }]) } });
  assert.deepEqual(byId(f.raw('StokBahan')), byId(before), 'imports may reorder legacy rows but never rewrite their correction evidence');
  const forged = { ...correction, id: 'source-count-forged' };
  f.bad('importRows', { sheet: 'StokBahan', rows: [forged] }, /koreksi|rol|impor/i);
  f.bad('gantiImpor', { data: { StokBahan: [forged] } }, /koreksi|rol|impor/i);
  f.bad('saveStok', { stok: { ...forged, baru: true } }, /koreksi|rol|sumber/i);
  assert.deepEqual(byId(f.raw('StokBahan')), byId(before));
  assert.equal(f.good('getState').stokRol.find(row => row.id === source.id).saldo, 5);
});

test('aggregate stock correction respects legacy reservations and cannot absorb or fabricate identified roll weight', () => {
  const f = fixture(), rows = f.buy();
  const prepared = f.bundle([], 'legacy-correction-po', 'legacy-correction-plan');
  delete prepared.rencana.alokasiBahan;
  prepared.rencana.bahanList = [{ nama: 'Katun Combed', qty: 6, satuan: 'kg' }]; prepared.rencana.rol = 1;
  f.good('savePOWithRencana', prepared);
  const before = f.raw('StokBahan'), originalRolls = f.good('getState').stokRol;
  f.bad('saveStok', { stok: { id: 'legacy-too-low', jenis: 'koreksi', bahan: 'Katun Combed', qty: -5, alasan: 'stok_opname', catatan: 'Fixture count' } }, /lama|cadang|persiapan|stok/i);
  f.bad('cocokkanStok', { id: 'legacy-count-too-low', bahan: 'Katun Combed', fisik: 15.5, catatan: 'Fixture count' }, /lama|cadang|persiapan|stok/i);
  assert.deepEqual(f.raw('StokBahan'), before);
  f.good('saveStok', { stok: { id: 'legacy-allowed-correction', jenis: 'koreksi', bahan: 'Katun Combed', qty: -4, alasan: 'stok_opname', catatan: 'Fixture count' } });
  const state = f.good('getState'), material = state.stokRingkas.find(row => row.kunci === 'katun combed');
  assert.equal(material.legacySaldo, 6); assert.equal(material.legacyTersedia, 0);
  assert.deepEqual(state.stokRol, originalRolls, 'unknown legacy differences must not silently resize invoice rolls');
  assert.equal(state.stokRol.find(row => row.id === rows[0].id).saldo, 7.125);
});
