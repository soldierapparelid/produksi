const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/core.js'), 'utf8');

function provenance(field, entryId, siklus = 'cycle1') { return { baseline: true, skuId: 'sku001', siklus, field, entryId }; }
function count(extra = {}) { return { id: 'count01', poId: 'po00001', maklonId: 'worker1', tanggal: '2026-10-02', ukuran: { M: 10 }, total: 10, reject: 0, status: 'diterima', upah: 2000, workflowVersion: 1, imporSumber: provenance('hitungFisik', 'hf001'), ...extra }; }
function quality(extra = {}) { return { id: 'qc00001', poId: 'po00001', maklonId: 'worker1', tanggal: '2026-10-03', ukuran: { M: 8 }, total: 8, offline: 0, perbaikan: 2, perbaikanUkuran: { M: 2 }, reject: 0, setorId: '', workflowVersion: 1, upah: 2000, imporSumber: provenance('qc', 'q001'), ...extra }; }
function warehouse(extra = {}) { return { id: 'oldwh01', poId: 'po00001', maklonId: 'worker1', tanggal: '2026-10-03', ukuran: { M: 10 }, total: 10, status: 'ok', upah: 2000, workflowVersion: 1, imporSumber: provenance('gudang', 'g001'), ...extra }; }
function bridge(extra = {}) {
  const snapshot = { id: 'report01', poId: 'po00001', maklonId: 'worker1', tanggal: '2026-10-01', ukuran: { M: 10 }, total: 10, upah: 2000, upahId: 'LAMA' };
  return { id: 'settle01', batchId: 'batch001', sourceId: snapshot.id, poId: snapshot.poId, maklonId: snapshot.maklonId, size: 'M', paymentRef: 'LAMA', sourceSnapshot: snapshot, imporSumber: provenance('jahit', 'j001'), baselineSources: [{ sourceId: 'count01', size: 'M', qty: 10, rate: 2000 }], resolution: 'full', allocations: [{ sourceId: 'count01', size: 'M', qty: 10 }], reason: '', ...extra };
}
function app(data = {}) {
  const ctx = vm.createContext({});
  vm.runInContext(source + `
    var db={},config={},serial=0,version=1;
    Object.keys(SCHEMA).forEach(function(s){db[s]=[];});
    db.Pegawai=[{id:'owner01',nama:'Owner',divisi:'owner',aktif:true,token:'owner-token-123456789'}, {id:'worker1',nama:'Worker',divisi:'jahit',aktif:true,token:'worker-token-12345678'}];
    db.PO=[{id:'po00001',nama:'Barang',status:'aktif',ukuran:{M:10},total:10}];
    db.Potong=[{id:'cut0001',poId:'po00001',ukuran:{M:10},total:10}];
    db.SlipKirim=[{id:'send001',poId:'po00001',maklonId:'worker1',ukuran:{M:10},total:10,upah:2000}];
    Object.assign(db,JSON.parse(${JSON.stringify(JSON.stringify(data))}));
    var store={read:function(s){return db[s]||[];},append:function(s,r){db[s].push(r);version++;},appendMany:function(s,rs){db[s]=db[s].concat(rs);version++;},update:function(s,id,p){Object.assign(db[s].find(function(r){return r.id===id;}),p);version++;},remove:function(s,id){db[s]=db[s].filter(function(r){return r.id!==id;});version++;},replaceAll:function(s,r){db[s]=r;version++;},getSettings:function(){return config;},setSettings:function(s){config=s;version++;},version:function(){return version;},lock:function(fn){return fn();}};
    var core=createCore(store,{now:function(){return new Date('2026-10-08T08:00:00Z');},id:function(){return 'newid000'+(++serial);}});
    function extras(){return {gudangLama:db.GudangLama,settlements:db.LegacySettlement};}
  `, ctx);
  const run = code => JSON.parse(JSON.stringify(vm.runInContext(code, ctx)));
  return { run, call: (action, payload = {}) => run(`core.handle(${JSON.stringify(action)},JSON.parse(${JSON.stringify(JSON.stringify({ token: 'owner-token-123456789', workflowVersion: 2, ...payload }))}))`),
    pay: () => run('corePayroll(db.Potong,db.SlipSetor,db.QC,db.SlipUpah,extras())'),
    flow: () => run('coreWorkflow(db.PO,db.Potong,db.SlipKirim,db.SlipSetor,db.QC,db.Gudang,extras()).po00001') };
}

test('only explicit source-proven legacy QC works without HF; it never fabricates count readiness', () => {
  const a = app({ QC: [quality()] });
  assert.equal(a.flow().issues.length, 0);
  assert.equal(a.flow().ukuran.M.diterima, 0);
  assert.equal(a.flow().readyQC, false);
  assert.equal(a.flow().warehouse[0].total, 8);
  assert.deepEqual(a.pay().map(r => [r.sourceId, r.total, r.rate, r.tanggal]), [['qc:qc00001', 8, 2000, '2026-10-03']]);
  for (const q of [quality({ workflowVersion: 2 }), quality({ imporSumber: {} }), quality({ workflowVersion: undefined })]) {
    const invalid = app({ QC: [q] });
    assert.match(invalid.flow().issues.join(' '), /hitungan asal/);
    assert.equal(invalid.pay().length, 0);
  }
});

test('manual legacy warehouse earns and supplies stock; a linked mirror cannot earn again', () => {
  const a = app({ GudangLama: [warehouse()] });
  assert.equal(a.flow().ukuran.M.stok, 10);
  assert.equal(a.flow().ukuran.M.qcOk, 0);
  assert.deepEqual(a.pay().map(r => [r.sourceId, r.total]), [['gudanglama:oldwh01', 10]]);
  for (const row of [warehouse({ qcId: 'deletedqc' }), warehouse({ status: 'reject' }), warehouse({ workflowVersion: 2 })]) assert.equal(app({ GudangLama: [row] }).pay().length, 0);
});

test('legacy QC owns linked HF, its own date/rate, and authoritative zero; existing paid HF remains paid', () => {
  const q = quality({ setorId: 'count01', upah: 2500 });
  const a = app({ SlipSetor: [count()], QC: [q] });
  assert.deepEqual(a.pay().map(r => [r.sourceId, r.total, r.rate, r.tanggal]), [['qc:qc00001', 8, 2500, '2026-10-03']]);
  const zero = app({ SlipSetor: [count()], QC: [quality({ setorId: 'count01', ukuran: {}, total: 0, perbaikan: 0, perbaikanUkuran: {}, reject: 10, rejectUkuran: { M: 10 } })] });
  assert.equal(zero.pay().length, 0);
  const paid = app({ SlipSetor: [count({ upahId: 'LAMA' })], QC: [quality({ setorId: 'count01' })] });
  assert.equal(paid.pay()[0].available, 0);
  assert.equal(paid.pay()[0].overpaidQty, 2);
});

test('standalone old QC reserves only same source cohort baseline counts, not new counts or another cycle', () => {
  const a = app({ PO: [{ id: 'po00001', status: 'aktif', ukuran: { M: 20 }, total: 20 }], Potong: [{ id: 'cut0001', poId: 'po00001', ukuran: { M: 20 }, total: 20 }], SlipKirim: [{ id: 'send001', poId: 'po00001', maklonId: 'worker1', ukuran: { M: 20 }, total: 20 }], SlipSetor: [count({ workflowVersion: 2 }), count({ id: 'newhf01', workflowVersion: 2, imporSumber: '' })], QC: [quality()] });
  assert.deepEqual(a.flow().blockedQcSources, { count01: ['M'] });
  assert.equal(a.flow().ukuran.M.siapQC, 10);
  assert.throws(() => a.call('createQC', { qc: { id: 'qcold02', poId: 'po00001', setorId: 'count01', ukuran: { M: 10 } } }), /hubungan pasti/);
  a.call('createQC', { qc: { id: 'qcnew02', poId: 'po00001', setorId: 'newhf01', ukuran: { M: 10 } } });
  assert.equal(a.run('db.QC[1].workflowVersion'), 2);
  const other = app({ SlipSetor: [count({ imporSumber: provenance('hitungFisik', 'hf001', 'cycle2') })], QC: [quality()] });
  assert.deepEqual(other.flow().blockedQcSources, {});
});

test('proven legacy BigSeller discrepancy stays visible without blocking physical QC; new input remains capped', () => {
  const bs = { id: 'bs00001', poId: 'po00001', ukuran: { M: 20 }, total: 20, workflowVersion: 1, imporSumber: provenance('bsInputs', 'b001') };
  const a = app({ SlipSetor: [count({ workflowVersion: 2, imporSumber: '' })], Gudang: [bs] });
  assert.equal(a.flow().issues.length, 0);
  assert.equal(a.flow().ledgerIssues.length, 1);
  assert.equal(a.flow().ukuran.M.bigseller, 20);
  assert.equal(a.flow().ukuran.M.stok, 0);
  a.call('createQC', { qc: { id: 'qcnew01', poId: 'po00001', setorId: 'count01', ukuran: { M: 10 } } });
  assert.throws(() => a.call('createGudang', { gudang: { id: 'bsnew01', poId: 'po00001', ukuran: { M: 1 } } }), /melebihi OK QC/);
  assert.match(app({ SlipSetor: [count()], Gudang: [{ ...bs, workflowVersion: undefined }] }).flow().issues.join(' '), /tidak seimbang/);
});

test('frozen legacy allocation covers only named source/size and keeps excess advance for that same repair', () => {
  const q = quality({ setorId: 'count01', workflowVersion: 2, imporSumber: '' });
  const a = app({ SlipSetor: [count({ workflowVersion: 2 })], QC: [q], LegacySettlement: [bridge()] });
  assert.equal(a.pay()[0].available, 0);
  assert.equal(a.pay()[0].overpaidQty, 2);
  a.call('createQC', { qc: { id: 'repair01', poId: 'po00001', repairQcId: q.id, ukuran: { M: 2 } } });
  assert.equal(a.pay().reduce((n, r) => n + r.available, 0), 0);
  assert.equal(a.pay().reduce((n, r) => n + r.paidQty, 0), 10);
  a.run(`db.SlipSetor.push(${JSON.stringify(count({ id: 'future1', workflowVersion: 2, imporSumber: '' }))})`);
  assert.equal(a.pay().find(r => r.sourceId === 'future1').available, 10);
});

test('hold is not a paid flag; changed scope/rate or excess allocation cannot create spendable credit', () => {
  for (const b of [bridge({ resolution: 'hold', reason: 'Perlu bukti alokasi' }), bridge({ allocations: [{ sourceId: 'count01', size: 'M', qty: 11 }] }), bridge({ imporSumber: provenance('jahit', 'j001', 'othercycle') })]) {
    const a = app({ SlipSetor: [count()], LegacySettlement: [b] });
    const p = a.pay()[0];
    assert.equal(p.available, 0); assert.equal(p.paidQty, 0); assert.equal(p.paid, false); assert.equal(p.needsReview, true);
    assert.throws(() => a.call('createUpah', { upah: { pegawaiId: 'worker1', itemIds: [p.id] } }), /ditinjau/);
  }
});

test('paid legacy pending report stays held after acceptance with a new rate; genuinely new IDs are untouched', () => {
  const pending = count({ id: 'pending1', status: 'diajukan', upah: 0, imporSumber: provenance('jahit', 'pending-worker') });
  const b = bridge({ resolution: 'hold', reason: 'Sisa laporan lama sudah dibayar', baselineSources: [{ sourceId: 'pending1', size: 'M', qty: 10, rate: 2000, pending: true }], allocations: [] });
  const a = app({ SlipSetor: [pending], LegacySettlement: [b] });
  assert.equal(a.pay().length, 0);
  a.call('prosesSetor', { id: 'pending1', ukuran: { M: 10 }, upah: 2500 });
  assert.equal(a.pay()[0].available, 0);
  assert.equal(a.pay()[0].legacySettlementHold, true);
  assert.equal(a.run('db.SlipSetor[0].workflowVersion'), 2);
});

test('standalone legacy repair keeps real QC identity/rate and uses only its remaining repair stock', () => {
  const q = quality();
  const b = bridge({ baselineSources: [{ sourceId: 'qc:qc00001', size: 'M', qty: 10, rate: 2000 }], allocations: [{ sourceId: 'qc:qc00001', size: 'M', qty: 10 }] });
  const a = app({ QC: [q], LegacySettlement: [b] });
  a.call('createQC', { qc: { id: 'repair01', poId: 'po00001', repairQcId: q.id, ukuran: { M: 2 } } });
  assert.equal(a.run('db.SlipSetor.length'), 0);
  assert.equal(a.run('db.QC[1].workflowVersion'), 2);
  assert.equal(a.flow().issues.length, 0);
  assert.equal(a.flow().ukuran.M.qcPerbaikan, 0);
  assert.equal(a.pay().reduce((n, r) => n + r.available, 0), 0);
  assert.ok(a.pay().every(r => r.sourceId === 'qc:qc00001' && r.rate === 2000));
  assert.throws(() => a.call('createQC', { qc: { id: 'repair02', poId: 'po00001', repairQcId: q.id, ukuran: { M: 1 } } }), /melebihi sisa/);
});

test('historical SlipUpah remains byte-for-byte stored and resolves originals only in response; immutable bridges cannot use generic imports', () => {
  const slip = { id: 'payment1', pegawaiId: 'worker1', jenis: 'jahit', tanggal: '2026-10-01', itemIds: '["report01"]', totalQty: 10, totalUpah: 20000, potongan: 0, dibayar: 20000 };
  const b = bridge({ paymentRef: 'payment1' }); b.sourceSnapshot.upahId = 'payment1';
  const a = app({ SlipSetor: [count()], SlipUpah: [slip], LegacySettlement: [b] });
  const before = a.run('JSON.stringify(db.SlipUpah)');
  const state = a.call('getState', { semua: true });
  assert.equal(state.upah[0].items[0].sourceId, 'report01');
  assert.equal(state.upah[0].items[0].rate, 2000);
  assert.equal(a.run('JSON.stringify(db.SlipUpah)'), before);
  assert.equal('LegacySettlement' in state, false); assert.equal('MigrasiJournal' in state, false);
  assert.throws(() => a.call('deleteRecord', { sheet: 'SlipUpah', id: 'payment1' }), /historis/);
  assert.throws(() => a.call('importRows', { sheet: 'LegacySettlement', rows: [] }), /Sheet/);
  assert.throws(() => a.call('importRows', { sheet: 'MigrasiJournal', rows: [] }), /Sheet/);
});

test('pending migration blocks mutation inside lock and exposes only owner recovery identifiers', () => {
  const a = app();
  a.run(`config.legacyMigrationStatus={batchId:'batch001',beforeHash:'before',planHash:'plan',at:'2026-10-08',secret:'hidden'};true`);
  assert.throws(() => a.call('savePO', { po: { newId: 'po00002', nama: 'New', ukuran: { M: 10 } } }), /Pemulihan riwayat belum selesai/);
  const owner = a.call('getState');
  assert.deepEqual(owner.settings.legacyMigrationStatus, { batchId: 'batch001', beforeHash: 'before', planHash: 'plan', at: '2026-10-08' });
  assert.equal(a.call('getState', { token: 'worker-token-12345678' }).settings.legacyMigrationStatus, undefined);
});

test('automatic legacy QC is not inspection; real QC preserves its proven same-HF payment credit', () => {
  const q = quality({ setorId: 'count01', ukuran: { M: 10 }, total: 10, perbaikan: 0, perbaikanUkuran: {}, autoFromCount: true });
  const b = bridge({ baselineSources: [{ sourceId: 'qc:qc00001', size: 'M', qty: 10, rate: 2000 }], allocations: [{ sourceId: 'qc:qc00001', size: 'M', qty: 10 }] });
  const a = app({ SlipSetor: [count()], QC: [q], LegacySettlement: [b] });
  assert.equal(a.flow().ukuran.M.qcOk, 0);
  assert.equal(a.flow().ukuran.M.siapQC, 10);
  assert.equal(a.pay()[0].available, 0);
  a.call('createQC', { qc: { id: 'realqc1', poId: 'po00001', setorId: 'count01', ukuran: { M: 8 }, rejectUkuran: { M: 2 }, reject: 2 } });
  assert.equal(a.flow().ukuran.M.qcOk, 8);
  assert.equal(a.pay().length, 1);
  assert.equal(a.pay()[0].available, 0);
  assert.equal(a.pay()[0].overpaidQty, 2);
});

test('frozen pending sources cannot be deleted, rejected, exceeded, or dropped by re-import before earning', () => {
  const pending = count({ id: 'pending1', status: 'diajukan', upah: 0, asal: 'lama', imporSumber: provenance('jahit', 'pending-worker') });
  const b = bridge({ resolution: 'hold', baselineSources: [{ sourceId: 'pending1', size: 'M', qty: 10, rate: 2000, pending: true }], allocations: [] });
  const a = app({ SlipSetor: [pending], LegacySettlement: [b] });
  assert.equal(a.pay().length, 0);
  const before = a.run('JSON.stringify(db.SlipSetor)');
  assert.throws(() => a.call('deleteRecord', { sheet: 'SlipSetor', id: 'pending1' }), /slip upah/);
  assert.throws(() => a.call('prosesSetor', { id: 'pending1', keputusan: 'tolak' }), /terikat pembayaran/);
  assert.throws(() => a.call('prosesSetor', { id: 'pending1', ukuran: { M: 11 }, upah: 2000 }), /dipertahankan per ukuran/);
  assert.throws(() => a.call('prosesSetor', { id: 'pending1', ukuran: { M: 6, L: 1 }, upah: 2000 }), /dipertahankan per ukuran|tidak terdaftar/);
  assert.throws(() => a.call('gantiImpor', { data: { SlipSetor: [] } }), /terkait pembayaran/);
  assert.equal(a.run('JSON.stringify(db.SlipSetor)'), before);
  a.call('prosesSetor', { id: 'pending1', ukuran: { M: 8 }, rejectUkuran: { M: 2 }, reject: 2, upah: 2000 });
  assert.equal(a.run('db.SlipSetor.length'), 1);
  assert.equal(a.pay()[0].available, 0);
});

test('a frozen pending report can be counted in stages: the counted part is accepted, the rest keeps waiting with the same payment tie', () => {
  const pending = count({ id: 'pending1', status: 'diajukan', upah: 0, asal: 'lama', tanggal: '2026-10-07', catatan: 'Sisa laporan jahit belum dihitung', imporSumber: provenance('jahit', 'pending-worker') });
  const b = bridge({ resolution: 'hold', baselineSources: [{ sourceId: 'pending1', size: 'M', qty: 10, rate: 2000, pending: true }], allocations: [] });
  const a = app({ SlipSetor: [pending], LegacySettlement: [b] });
  const first = a.call('prosesSetor', { id: 'pending1', ukuran: { M: 4 }, upah: 2000, tanggal: '2026-10-08' }).data;
  assert.equal(first.status, 'diterima'); assert.equal(first.total, 4); assert.equal(first.tanggal, '2026-10-08'); assert.ok(first.noSlip);
  const rest = a.run('db.SlipSetor.filter(function(r){return r.id==="pending1s";})[0]');
  assert.equal(rest.status, 'diajukan'); assert.equal(rest.total, 6); assert.deepEqual(JSON.parse(rest.ukuran), { M: 6 });
  assert.equal(rest.tanggal, '2026-10-07'); assert.equal(rest.noSlip, ''); assert.equal(rest.upah, 0); assert.equal(rest.asal, 'lama');
  assert.equal(JSON.parse(rest.imporSumber).sisaDari, 'pending1'); assert.equal(JSON.parse(rest.imporSumber).field, 'jahit');
  /* jumlah laporan tetap utuh dan PO belum dianggap selesai dihitung */
  assert.equal(a.flow().ukuran.M.diterima, 4); assert.equal(a.flow().ukuran.M.diajukan, 6);
  /* bagian yang sudah dihitung tetap ditahan seperti sebelumnya, dan sisanya masih terikat */
  assert.equal(a.pay().length, 1); assert.equal(a.pay()[0].available, 0); assert.equal(a.pay()[0].legacySettlementHold, true);
  assert.throws(() => a.call('prosesSetor', { id: 'pending1s', keputusan: 'tolak' }), /terikat pembayaran/);
  assert.throws(() => a.call('deleteRecord', { sheet: 'SlipSetor', id: 'pending1s' }), /slip upah/);
  assert.throws(() => a.call('prosesSetor', { id: 'pending1s', ukuran: { M: 7 }, upah: 2000 }), /dipertahankan per ukuran/);
  /* hitungan kedua: sebagian lagi, lalu sisanya; baris sisa selalu satu */
  a.call('prosesSetor', { id: 'pending1s', ukuran: { M: 1 }, rejectUkuran: { M: 2 }, reject: 2, upah: 2000 });
  const last = a.run('db.SlipSetor.filter(function(r){return r.id==="pending1ss";})[0]');
  assert.equal(last.total, 3); assert.equal(JSON.parse(last.imporSumber).sisaDari, 'pending1');
  a.call('prosesSetor', { id: 'pending1ss', ukuran: { M: 3 }, upah: 2000 });
  assert.equal(a.run('db.SlipSetor.length'), 3);
  assert.equal(a.run('db.SlipSetor.filter(function(r){return r.status==="diajukan";}).length'), 0);
  assert.equal(a.flow().ukuran.M.diterima, 8); assert.equal(a.flow().ukuran.M.rejectJahit, 2); assert.equal(a.flow().ukuran.M.diajukan, 0);
  const pay = a.pay();
  assert.equal(pay.length, 3); assert.equal(pay.reduce((n, r) => n + r.total, 0), 8);
  assert.ok(pay.every(r => r.available === 0 && r.legacySettlementHold === true));
  assert.throws(() => a.call('createUpah', { upah: { pegawaiId: 'worker1', itemIds: pay.map(r => r.id) } }), /ditinjau/);
});

test('an interrupted staged count is repaired by the retry, and a later full count removes the stale remainder', () => {
  const pending = count({ id: 'pending1', status: 'diajukan', upah: 0, asal: 'lama', imporSumber: provenance('jahit', 'pending-worker') });
  const b = bridge({ resolution: 'hold', baselineSources: [{ sourceId: 'pending1', size: 'M', qty: 10, rate: 2000, pending: true }], allocations: [] });
  const stale = count({ id: 'pending1s', status: 'diajukan', upah: 0, asal: 'lama', ukuran: { M: 6 }, total: 6, imporSumber: { ...provenance('jahit', 'pending-worker'), sisaDari: 'pending1' } });
  const a = app({ SlipSetor: [pending, stale], LegacySettlement: [b] });
  a.call('prosesSetor', { id: 'pending1', ukuran: { M: 7 }, upah: 2000 });
  assert.equal(a.run('db.SlipSetor.length'), 2);
  assert.equal(a.run('db.SlipSetor.filter(function(r){return r.id==="pending1s";})[0].total'), 3);
  const c = app({ SlipSetor: [pending, stale], LegacySettlement: [b] });
  c.call('prosesSetor', { id: 'pending1', ukuran: { M: 10 }, upah: 2000 });
  assert.equal(c.run('db.SlipSetor.length'), 1);
  assert.equal(c.flow().ukuran.M.diterima, 10);
});

test('count date is optional, must be a real date, and cannot lie in the future; native reports keep their old behaviour', () => {
  const report = count({ id: 'native01', status: 'diajukan', upah: 0, workflowVersion: 2, imporSumber: '', tanggal: '2026-10-06' });
  const a = app({ SlipSetor: [report] });
  assert.throws(() => a.call('prosesSetor', { id: 'native01', ukuran: { M: 10 }, upah: 2000, tanggal: '2026-02-31' }), /Tanggal hitung tidak valid/);
  assert.throws(() => a.call('prosesSetor', { id: 'native01', ukuran: { M: 10 }, upah: 2000, tanggal: '2026-10-12' }), /melewati hari ini/);
  const kept = app({ SlipSetor: [report] });
  assert.equal(kept.call('prosesSetor', { id: 'native01', ukuran: { M: 10 }, upah: 2000 }).data.tanggal, '2026-10-06');
  /* laporan baru yang dihitung lebih sedikit tidak meninggalkan baris sisa: maklon melapor lagi seperti biasa */
  const fewer = app({ SlipSetor: [report] });
  const got = fewer.call('prosesSetor', { id: 'native01', ukuran: { M: 6 }, upah: 2000, tanggal: '2026-10-08' }).data;
  assert.equal(got.total, 6); assert.equal(got.tanggal, '2026-10-08');
  assert.equal(fewer.run('db.SlipSetor.length'), 1);
  assert.equal(fewer.pay()[0].available, 6);
});

test('zero-OK legacy QC retains immutable baseline even with no earned row', () => {
  const q = quality({ setorId: 'count01', ukuran: {}, total: 0, perbaikan: 0, perbaikanUkuran: {}, reject: 10, rejectUkuran: { M: 10 }, asal: 'lama' });
  const b = bridge({ resolution: 'hold', baselineSources: [{ sourceId: 'qc:qc00001', size: 'M', qty: 10, rate: 2000 }], allocations: [] });
  const a = app({ SlipSetor: [count()], QC: [q], LegacySettlement: [b] });
  assert.equal(a.pay().length, 0);
  assert.throws(() => a.call('deleteRecord', { sheet: 'QC', id: q.id }), /terikat pembayaran lama/);
  assert.throws(() => a.call('gantiImpor', { data: { QC: [] } }), /terkait pembayaran/);
  assert.equal(a.run('db.QC.length'), 1);
});

test('durable pending marker wins over stale settings cache for writes and same-version sync', () => {
  const a = app();
  a.run(`var durable={batchId:'durable1',beforeHash:'before',planHash:'plan',at:'2026-10-08'};var checkpoints=[];
    store.checkpoint=function(names){checkpoints.push(names.slice());if(names.indexOf('Pengaturan')>=0)config={legacyMigrationStatus:durable};};true`);
  assert.throws(() => a.call('savePO', { po: { newId: 'po00002', nama: 'New', ukuran: { M: 10 } } }), /Pemulihan riwayat belum selesai/);
  a.run('config={};true');
  const state = a.call('sync', { ver: 1, av: '1.4.0' });
  assert.equal(state.same, undefined);
  assert.equal(state.settings.legacyMigrationStatus.batchId, 'durable1');
  assert.equal(a.run('checkpoints.length'), 2, 'write guard and sync each verify the durable marker once');
  a.run('config={};true');
  assert.equal(a.call('getState').settings.legacyMigrationStatus.batchId, 'durable1');
});

test('old clients cannot mark production paid before passing the workflow contract', () => {
  const a = app({ SlipSetor: [count()] });
  const before = a.run('JSON.stringify(db.SlipSetor)');
  for (const workflowVersion of [undefined, 1]) assert.throws(() => a.call('tandaiLunas', { workflowVersion, sampai: '2026-10-08' }), /Versi alur produksi tidak cocok/);
  assert.equal(a.run('JSON.stringify(db.SlipSetor)'), before);
  a.call('tandaiLunas', { sampai: '2026-10-08' });
  assert.equal(a.run('db.SlipSetor[0].upahId'), 'LAMA');
});

test('explicit legacy QC and manual warehouse paid markers close only their actual earned rows', () => {
  const q = quality({ upahId: 'LAMA' });
  const a = app({ QC: [q], GudangLama: [warehouse({ upahId: 'LAMA' })] });
  assert.ok(a.pay().every(r => r.available === 0 && r.legacyPaid));
  a.call('createQC', { qc: { id: 'repair01', poId: 'po00001', repairQcId: q.id, ukuran: { M: 2 }, tanggal: '2026-10-05' } });
  assert.equal(a.pay().find(r => r.qcId === 'repair01').available, 2, 'an old QC marker does not settle future repair');
  a.call('tandaiLunas', { sampai: '2026-10-04' });
  assert.equal(a.pay().find(r => r.qcId === 'repair01').available, 2);
  a.call('tandaiLunas', { sampai: '2026-10-05' });
  assert.ok(a.pay().every(r => r.available === 0));
  const modern = app({ SlipSetor: [count({ workflowVersion: 2, imporSumber: '' })], QC: [quality({ workflowVersion: 2, setorId: 'count01', imporSumber: '', upahId: 'LAMA' })] });
  assert.equal(modern.pay()[0].available, 8, 'unproven modern QC marker cannot replace source payment');
});

test('QC marker and an existing paid snapshot overlap once, while a separately paid repair adds its own earnings', () => {
  const a = app({ QC: [quality()] });
  a.call('createQC', { qc: { id: 'repair01', poId: 'po00001', repairQcId: 'qc00001', ukuran: { M: 2 }, tanggal: '2026-10-05' } });
  a.call('createUpah', { upah: { id: 'receipt01', pegawaiId: 'worker1', itemIds: ['repair:repair01:M'] } });
  a.call('tandaiLunas', { sampai: '2026-10-04' });
  assert.equal(a.pay().reduce((n, r) => n + r.paidQty, 0), 10);
  assert.equal(a.pay().reduce((n, r) => n + r.overpaidQty, 0), 0);
  a.call('tandaiLunas', { sampai: '2026-10-05' });
  assert.equal(a.pay().reduce((n, r) => n + r.paidQty, 0), 10);
  assert.equal(a.pay().reduce((n, r) => n + r.overpaidQty, 0), 0);
});

test('marking both linked physical count and legacy QC never adds a second payment', () => {
  const a = app({ SlipSetor: [count()], QC: [quality({ setorId: 'count01' })] });
  a.call('tandaiLunas', { sampai: '2026-10-05' });
  assert.equal(a.pay()[0].available, 0);
  assert.equal(a.pay()[0].paidQty, 8);
  assert.equal(a.pay()[0].overpaidQty, 2, 'only the physical-count advance survives');
});

test('generic import includes marked legacy warehouse, preserves its paid marker and rejects rewrites', () => {
  const a = app();
  a.call('gantiImpor', { data: { GudangLama: [warehouse({ upahId: 'LAMA' })] } });
  assert.equal(a.run('db.GudangLama.length'), 1);
  assert.equal(a.pay()[0].available, 0);
  a.call('gantiImpor', { data: { GudangLama: [warehouse()] } });
  assert.equal(a.run('db.GudangLama[0].upahId'), 'LAMA');
  assert.equal(a.pay()[0].available, 0);
  const before = a.run('JSON.stringify(db.GudangLama)');
  assert.throws(() => a.call('gantiImpor', { data: { GudangLama: [warehouse({ total: 11, ukuran: { M: 11 } })] } }), /terkait pembayaran/);
  assert.throws(() => a.call('gantiImpor', { data: { GudangLama: [] } }), /terkait pembayaran/);
  assert.equal(a.run('JSON.stringify(db.GudangLama)'), before);
});

test('actual paid legacy QC/warehouse typed sources survive unchanged generic re-import', () => {
  const a = app({ QC: [quality()], GudangLama: [warehouse()] });
  const ids = a.pay().map(r => r.id);
  a.call('createUpah', { upah: { id: 'receipt01', pegawaiId: 'worker1', itemIds: ids } });
  const receipt = a.run('JSON.stringify(db.SlipUpah)');
  a.call('gantiImpor', { data: { QC: [quality()], GudangLama: [warehouse()] } });
  assert.equal(a.run('JSON.stringify(db.SlipUpah)'), receipt);
  assert.ok(a.pay().every(r => r.available === 0));
  assert.throws(() => a.call('gantiImpor', { data: { QC: [quality({ upah: 2100 })] } }), /terkait pembayaran/);
  assert.throws(() => a.call('gantiImpor', { data: { GudangLama: [warehouse({ upah: 2100 })] } }), /terkait pembayaran/);
  assert.throws(() => a.call('gantiImpor', { data: { GudangLama: [] } }), /slip upah.*item/);
});

test('generic import rejects warehouse without explicit legacy provenance before writing', () => {
  const a = app();
  assert.throws(() => a.call('gantiImpor', { data: { GudangLama: [warehouse({ imporSumber: '' })] } }), /bukti sumber mandiri/);
  assert.equal(a.run('db.GudangLama.length'), 0);
});
