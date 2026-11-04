'use strict';
/* 1.5.75 (g4-lama), data aplikasi lama. Data karangan saja.
   (a) Hasil perbaikan untuk QC lama yang tidak terhubung ke hitungan asal (baris impor v0) bisa dicatat, terhubung ke
       QC itu dan penjahitnya, tanpa mengubah upah atau alur produksi catatan lama yang sudah ada.
   (b) Owner mencocokkan pembayaran lama yang ditahan: sudah lunas atau belum dibayar. Hanya baris upah pembayaran
       lama itu yang berubah; keputusan dicatat sebagai baris baru (siapa, kapan, pilihan, alasan). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const PROBE = process.env.G4_PROBE === '1';

function server() {
  const h = harness();
  for (const name of ['bahan-invoice', 'cutting-plans', 'auto-completion', 'reconcile-legacy', 'history-corrections']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'src', name + '.js'), 'utf8'), h.context);
  }
  const setup = h.request('setupOwner', { nama: 'Pemilik Uji', pin: '1234' });
  assert.equal(setup.ok, true, setup.error);
  const owner = setup.data.token, admin = 'g4-admin-token-000001', qc = 'g4-qc-token-00000001', sewer = 'g4-sewer-token-000001';
  h.run(`pkStore_().lock(function(){
    pkStore_().append('Pegawai',{id:'g4admin01',nama:'Admin Uji',divisi:'admin',aktif:true,token:'${admin}'});
    pkStore_().append('Pegawai',{id:'g4qc00001',nama:'QC Uji',divisi:'qc',aktif:true,token:'${qc}',pin:'fixture-pin-hash'});
    pkStore_().append('Pegawai',{id:'g4sewer01',nama:'Penjahit Satu',divisi:'jahit',aktif:true,token:'${sewer}',pin:'fixture-pin-hash'});
    pkStore_().append('Pegawai',{id:'g4sewer02',nama:'Penjahit Dua',divisi:'jahit',aktif:true,pin:'fixture-pin-hash'});
  });`);
  function add(table, rows) { h.run(`pkStore_().lock(function(){ ${rows.map(r => `pkStore_().append(${JSON.stringify(table)},${JSON.stringify(r)});`).join(' ')} });`); }
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
  const state = (token = owner) => good('getState', { semua: true }, token);
  return { h, owner, admin, qc, sewer, add, call, good, bad, raw, state };
}

/* ---------------- (a) perbaikan QC lama v0 ---------------- */
const V0 = 'g4-v0-po01';
function fixtureV0() {
  const f = server();
  f.add('PO', [{ id: V0, noPO: 'PO-V0', jenis: 'stok', nama: 'Kaos Lama V0', ukuran: '{"M":30,"L":20}', total: 50, status: 'aktif', asal: 'lama', dibuat: '2026-08-01T00:00:00.000Z' }]);
  f.add('Potong', [{ id: 'g4-v0-cut01', poId: V0, userId: '', tanggal: '2026-08-02', ukuran: '{"M":30,"L":20}', total: 50, tarif: 0, asal: 'lama', dibuat: '2026-08-02T00:00:00.000Z' }]);
  f.add('SlipKirim', [
    { id: 'g4-v0-k01', noSlip: '', poId: V0, maklonId: 'g4sewer01', tanggal: '2026-08-03', ukuran: '{"M":20,"L":20}', total: 40, upah: 2000, asal: 'lama', dibuat: '2026-08-03T00:00:00.000Z' },
    { id: 'g4-v0-k02', noSlip: '', poId: V0, maklonId: 'g4sewer02', tanggal: '2026-08-03', ukuran: '{"M":10}', total: 10, upah: 2500, asal: 'lama', dibuat: '2026-08-03T00:00:00.000Z' }]);
  f.add('SlipSetor', [
    { id: 'g4-v0-s01', noSlip: '', poId: V0, maklonId: 'g4sewer01', tanggal: '2026-08-05', ukuran: '{"M":20,"L":20}', total: 40, reject: 0, upah: 2000, status: 'diterima', asal: 'lama', upahId: '', dibuat: '2026-08-05T00:00:00.000Z' },
    { id: 'g4-v0-s02', noSlip: '', poId: V0, maklonId: 'g4sewer02', tanggal: '2026-08-05', ukuran: '{"M":10}', total: 10, reject: 0, upah: 2500, status: 'diterima', asal: 'lama', upahId: 'LAMA', dibuat: '2026-08-05T00:00:00.000Z' }]);
  f.add('QC', [
    { id: 'g4-v0-q01', poId: V0, userId: '', maklonId: 'g4sewer01', tanggal: '2026-08-06', ukuran: '{"M":15}', total: 15, offline: 0, perbaikan: 5, reject: 0, perbaikanUkuran: '{"M":5}', setorId: '', asal: 'lama', dibuat: '2026-08-06T00:00:00.000Z' },
    { id: 'g4-v0-q02', poId: V0, userId: '', maklonId: 'g4sewer01', tanggal: '2026-08-06', ukuran: '{"L":20}', total: 20, offline: 0, perbaikan: 0, reject: 0, setorId: '', asal: 'lama', dibuat: '2026-08-06T00:00:00.000Z' },
    { id: 'g4-v0-q03', poId: V0, userId: '', maklonId: 'g4sewer02', tanggal: '2026-08-07', ukuran: '{"M":8}', total: 8, offline: 0, perbaikan: 2, reject: 0, perbaikanUkuran: '{"M":2}', setorId: '', asal: 'lama', dibuat: '2026-08-07T00:00:00.000Z' }]);
  return f;
}
const SIZE_FIELDS = ['diterima', 'qcOk', 'qcOffline', 'qcPerbaikan', 'qcReject', 'legacyUnlinkedQC', 'legacyBlockedCount', 'siapQC', 'stok', 'readyQC', 'complete'];
function flowView(po) {
  const w = po.workflow;
  return { issues: w.issues, legacyWarnings: w.legacyWarnings, blockedQcSources: w.blockedQcSources, readyQC: w.readyQC, complete: w.complete,
    ukuran: Object.fromEntries(Object.keys(w.ukuran).sort().map(s => [s, Object.fromEntries(SIZE_FIELDS.map(k => [k, w.ukuran[s][k]]))])) };
}
function payView(rows) {
  return rows.map(r => ({ id: r.id, sourceId: r.sourceId, pegawaiId: r.pegawaiId, total: r.total, available: r.available, paidQty: r.paidQty, rate: r.rate, needsReview: !!r.needsReview, upahId: r.upahId }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
/* Nilai di bawah dihitung dengan rilis 1.5.74 (sebelum perubahan ini) untuk data yang sama. */
const V0_PAY_1574 = [
  { id: 'setor:g4-v0-s01:L', sourceId: 'g4-v0-s01', pegawaiId: 'g4sewer01', total: 20, available: 0, paidQty: 0, rate: 2000, needsReview: true, upahId: '' },
  { id: 'setor:g4-v0-s01:M', sourceId: 'g4-v0-s01', pegawaiId: 'g4sewer01', total: 20, available: 0, paidQty: 0, rate: 2000, needsReview: true, upahId: '' },
  { id: 'setor:g4-v0-s02:M', sourceId: 'g4-v0-s02', pegawaiId: 'g4sewer02', total: 10, available: 0, paidQty: 10, rate: 2500, needsReview: true, upahId: 'LAMA' }];
const V0_FLOW_1574 = {
  issues: ['QC g4-v0-q01 belum terhubung ke hitungan asal yang sah.', 'QC g4-v0-q02 belum terhubung ke hitungan asal yang sah.', 'QC g4-v0-q03 belum terhubung ke hitungan asal yang sah.'],
  legacyWarnings: ['QC lama g4-v0-q01 disimpan tanpa mengarang hitungan asal.', 'QC lama g4-v0-q02 disimpan tanpa mengarang hitungan asal.', 'QC lama g4-v0-q03 disimpan tanpa mengarang hitungan asal.'],
  blockedQcSources: { 'g4-v0-s01': ['M', 'L'], 'g4-v0-s02': ['M'] }, readyQC: false, complete: false,
  ukuran: {
    L: { diterima: 20, qcOk: 20, qcOffline: 0, qcPerbaikan: 0, qcReject: 0, legacyUnlinkedQC: 20, legacyBlockedCount: 20, siapQC: 0, stok: 20, readyQC: true, complete: false },
    M: { diterima: 30, qcOk: 23, qcOffline: 0, qcPerbaikan: 7, qcReject: 0, legacyUnlinkedQC: 30, legacyBlockedCount: 30, siapQC: 0, stok: 23, readyQC: true, complete: false } } };

test('(a) payroll and workflow of existing old v0 QC rows, with and without repair stock, are exactly as in 1.5.74', () => {
  const f = fixtureV0(), st = f.state(), po = st.po.find(p => p.id === V0);
  const pay = payView(st.payroll.filter(r => r.poId === V0)), flow = flowView(po);
  if (PROBE) { console.log('G4PROBE ' + JSON.stringify({ pay, flow })); return; }
  assert.deepEqual(pay, V0_PAY_1574);
  assert.deepEqual(flow, V0_FLOW_1574);
});

test('(a) a repair result for an old QC without a linked count is accepted, linked to that QC and its tailor, and never earns twice', () => {
  if (PROBE) return;
  const f = fixtureV0(), before = f.state(), poBefore = before.po.find(p => p.id === V0);
  const repair = { id: 'g4-v0-r001', poId: V0, setorId: '', repairQcId: 'g4-v0-q01', dariPerbaikan: true, tanggal: '2026-08-10', ukuran: { M: 3 }, reject: 1, rejectUkuran: { M: 1 } };
  f.bad('createQC', { qc: repair }, /Hanya QC atau admin/, f.sewer);
  const saved = f.good('createQC', { qc: repair }, f.qc);
  assert.equal(saved.repairQcId, 'g4-v0-q01'); assert.equal(saved.setorId, ''); assert.equal(saved.maklonId, 'g4sewer01'); assert.equal(saved.workflowVersion, 2);
  const row = f.raw('QC').find(r => r.id === 'g4-v0-r001');
  assert.deepEqual([JSON.parse(row.ukuran), JSON.parse(row.rejectUkuran), JSON.parse(row.perbaikanUkuran), row.perbaikan], [{ M: 3 }, { M: 1 }, { M: -4 }, -4]);
  const after = f.state(), poAfter = after.po.find(p => p.id === V0);
  /* the old sewing report already carries the wage for these pieces: no new earning, every wage row unchanged */
  assert.deepEqual(payView(after.payroll), payView(before.payroll));
  /* only the repaired pieces move: perbaikan becomes OK/reject, nothing else, and no new issue is raised */
  const b = flowView(poBefore), a = flowView(poAfter);
  assert.deepEqual(a.issues, b.issues); assert.deepEqual(a.legacyWarnings, b.legacyWarnings); assert.deepEqual(a.blockedQcSources, b.blockedQcSources);
  assert.deepEqual(a.ukuran.L, b.ukuran.L);
  assert.equal(a.ukuran.M.qcOk, b.ukuran.M.qcOk + 3); assert.equal(a.ukuran.M.qcReject, b.ukuran.M.qcReject + 1); assert.equal(a.ukuran.M.qcPerbaikan, b.ukuran.M.qcPerbaikan - 4);
  assert.equal(a.ukuran.M.stok, b.ukuran.M.stok + 3); assert.equal(a.ukuran.M.siapQC, b.ukuran.M.siapQC); assert.equal(a.ukuran.M.legacyUnlinkedQC, b.ukuran.M.legacyUnlinkedQC);
  assert.ok(poAfter.workflow.warehouse.some(w => w.qcId === 'g4-v0-r001' && w.repairQcId === 'g4-v0-q01' && w.total === 3));
  /* the remaining repair stock is the limit; a QC without repair stock has none */
  f.bad('createQC', { qc: { ...repair, id: 'g4-v0-r002', ukuran: { M: 2 }, reject: 0, rejectUkuran: {} } }, /melebihi sisa/, f.qc);
  f.bad('createQC', { qc: { ...repair, id: 'g4-v0-r003', repairQcId: 'g4-v0-q02', ukuran: { L: 1 }, reject: 0, rejectUkuran: {} } }, /melebihi sisa/, f.qc);
  f.bad('createQC', { qc: { ...repair, id: 'g4-v0-r004', tanggal: '2026-08-05', ukuran: { M: 1 }, reject: 0, rejectUkuran: {} } }, /sebelum QC asal/, f.qc);
  f.good('createQC', { qc: { ...repair, id: 'g4-v0-r005', ukuran: { M: 1 }, reject: 0, rejectUkuran: {} } }, f.qc);
  /* the second tailor's old QC: the owner records it; the tailor comes from that QC */
  const other = f.good('createQC', { qc: { ...repair, id: 'g4-v0-r006', repairQcId: 'g4-v0-q03', ukuran: { M: 2 }, reject: 0, rejectUkuran: {} } });
  assert.equal(other.maklonId, 'g4sewer02');
  const last = f.state();
  assert.deepEqual(payView(last.payroll), payView(before.payroll));
  assert.equal(flowView(last.po.find(p => p.id === V0)).ukuran.M.qcPerbaikan, 0);
  assert.deepEqual(flowView(last.po.find(p => p.id === V0)).issues, b.issues);
});

test('(a) an old QC without a known tailor still stops, and a linked QC still needs its count', () => {
  if (PROBE) return;
  const f = fixtureV0();
  f.h.run(`pkStore_().lock(function(){ pkStore_().update('QC','g4-v0-q03',{maklonId:''}); });`);
  f.bad('createQC', { qc: { id: 'g4-v0-r010', poId: V0, setorId: '', repairQcId: 'g4-v0-q03', dariPerbaikan: true, tanggal: '2026-08-10', ukuran: { M: 1 } } }, /Maklon asal hitungan tidak ditemukan/, f.qc);
  f.h.run(`pkStore_().lock(function(){ pkStore_().update('QC','g4-v0-q01',{setorId:'g4-v0-gone'}); });`);
  f.bad('createQC', { qc: { id: 'g4-v0-r011', poId: V0, setorId: '', repairQcId: 'g4-v0-q01', dariPerbaikan: true, tanggal: '2026-08-10', ukuran: { M: 1 } } }, /slip hitung fisik/, f.qc);
  assert.equal(f.raw('QC').length, 3, 'nothing was written');
});

function part(a, b) { const p = html.indexOf(a), q = html.indexOf(b, p + a.length); assert.ok(p >= 0 && q > p, a); return html.slice(p, q); }

test('(a) the QC screen opens the repair form for an old QC without a count, using the tailor of that QC', () => {
  const c = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core.js'), 'utf8'), c);
  vm.runInContext(`var S = { state: { setor: [], qc: [] } }, D = { po: { p: { id: 'p', status: 'aktif' } } }, renders = [];
    var repairs = [];
    function repairQueue() { return repairs; } function antreanQC() { return []; } function qcSourceProgress() { return []; }
    function findSlip(t, id) { return S.state.setor.filter(function (r) { return r.id === id; })[0] || null; }
    function esc(s) { return String(s === undefined ? '' : s); } function nf(n) { return String(n); } function ic() { return ''; } function tgl(s) { return s; }
    function namaUser(id) { return id === 'w1' ? 'Penjahit Satu' : 'Tanpa nama'; } function emptyBox(s) { return '[kosong] ' + s; }
    function sheetHtml(t, b, f) { return t + '|' + b + '|' + (f || ''); } function openSheet(fn) { renders.push(fn); }
    function newId() { return 'qc-baru-01'; } function hid(k, v) { return '<input type="hidden" name="' + k + '" value="' + esc(v) + '">'; }
    function poHead() { return ''; } function qcGrid(uk) { return '[grid ' + JSON.stringify(uk) + ']'; } function sumLine() { return ''; }
    function fTanggal() { return ''; } function fCatatan() { return ''; } function footSave(a) { return '[' + a + ']'; }`, c);
  vm.runInContext(part('function openQC(', 'A.qcRepairOpen ='), c);
  const open = (q) => { vm.runInContext(`repairs = [{ q: ${JSON.stringify(q)}, uk: { M: 5 }, total: 5 }]; renders = []; openQC('p', ${JSON.stringify(q.setorId || '')}, ${JSON.stringify(q.id)});`, c); return vm.runInContext('renders[0]()', c); };
  const v0 = open({ id: 'q0', poId: 'p', maklonId: 'w1', setorId: '', asal: 'lama', workflowVersion: 0, perbaikan: 5 });
  assert.match(v0, /^Hasil perbaikan\|/); assert.doesNotMatch(v0, /Hubungan ke hitungan asal belum jelas/);
  assert.match(v0, /name="setorId" value=""/); assert.match(v0, /name="repairQcId" value="q0"/); assert.match(v0, /Penjahit Satu\. Isi yang sudah kembali/);
  assert.match(v0, /hanya menambah stok OK\. Upah jahitnya sudah dihitung dari laporan jahit lama\./); assert.match(v0, /\[qcSave\]$/);
  const v1 = open({ id: 'q1', poId: 'p', maklonId: 'w1', setorId: '', workflowVersion: 1, imporSumber: JSON.stringify({ baseline: true, skuId: 's', siklus: 'c', entryId: 'e', field: 'qc' }), perbaikan: 5 });
  assert.match(v1, /name="repairQcId" value="q1"/); assert.doesNotMatch(v1, /hanya menambah stok OK/, 'a proven v1 QC earns its repair at its own rate');
  for (const q of [{ id: 'q2', poId: 'p', maklonId: '', setorId: '', asal: 'lama', workflowVersion: 0 }, { id: 'q3', poId: 'p', maklonId: 'w1', setorId: '', workflowVersion: 2 }, { id: 'q4', poId: 'p', maklonId: 'w1', setorId: 'hilang', asal: 'lama', workflowVersion: 0 }]) {
    assert.match(open(q), /Hubungan ke hitungan asal belum jelas/, q.id + ' still needs its count');
  }
  vm.runInContext(`S.state.setor = [{ id: 's9', noSlip: 'SS-9', maklonId: 'w1', poId: 'p' }];`, c);
  const linked = open({ id: 'q5', poId: 'p', maklonId: 'w1', setorId: 's9', workflowVersion: 2 });
  assert.match(linked, /name="setorId" value="s9"/); assert.match(linked, /Penjahit Satu\. Isi yang sudah kembali/);
});

/* ---------------- (b) mencocokkan pembayaran lama yang ditahan ---------------- */
const LS = 'g4-ls-po01';
const prov = (field, entryId) => JSON.stringify({ baseline: true, skuId: 'sku-g4', siklus: 'current', field, entryId });
function snapshot(id, worker, qty, upah) { return JSON.stringify({ id, poId: LS, maklonId: worker, tanggal: '2026-08-04', ukuran: { M: qty }, total: qty, upah, upahId: 'LAMA' }); }
function settlement(id, extra) {
  return { id, batchId: 'g4-batch', sourceId: 'g4-rep-' + id.slice(-1), poId: LS, maklonId: 'g4sewer01', size: 'M', paymentRef: 'LAMA', poSnapshot: JSON.stringify({ id: LS, noPO: 'PO-LS', nama: 'Kemeja Lama' }),
    imporSumber: prov('jahit', 'j-' + id), resolution: 'hold', allocations: '[]', ...extra };
}
function fixtureLama() {
  const f = server();
  f.add('PO', [{ id: LS, noPO: 'PO-LS', jenis: 'stok', nama: 'Kemeja Lama', ukuran: '{"M":35,"L":10}', total: 45, status: 'aktif', asal: 'lama', dibuat: '2026-08-01T00:00:00.000Z' }]);
  f.add('Potong', [{ id: 'g4-ls-cut01', poId: LS, userId: '', tanggal: '2026-08-02', ukuran: '{"M":35,"L":10}', total: 45, tarif: 0, asal: 'lama', dibuat: '2026-08-02T00:00:00.000Z' }]);
  f.add('SlipKirim', [
    { id: 'g4-ls-k01', noSlip: '', poId: LS, maklonId: 'g4sewer01', tanggal: '2026-08-03', ukuran: '{"M":30}', total: 30, upah: 2000, asal: 'lama', dibuat: '2026-08-03T00:00:00.000Z' },
    { id: 'g4-ls-k02', noSlip: '', poId: LS, maklonId: 'g4sewer02', tanggal: '2026-08-03', ukuran: '{"M":5,"L":10}', total: 15, upah: 2500, asal: 'lama', dibuat: '2026-08-03T00:00:00.000Z' }]);
  const count = (id, worker, uk, extra = {}) => ({ id, noSlip: 'SS-' + id.slice(-1), poId: LS, maklonId: worker, tanggal: '2026-08-05', ukuran: JSON.stringify(uk), total: Object.values(uk).reduce((n, v) => n + v, 0), reject: 0, upah: 2000, status: 'diterima', asal: 'lama', workflowVersion: 1, imporSumber: prov('hitungFisik', 'hf-' + id), dibuat: '2026-08-05T00:00:00.000Z', ...extra });
  f.add('SlipSetor', [
    count('g4-cnt-A', 'g4sewer01', { M: 10 }), count('g4-cnt-B', 'g4sewer01', { M: 8 }), count('g4-cnt-C', 'g4sewer01', { M: 12 }),
    count('g4-pend-D', 'g4sewer02', { M: 5 }, { noSlip: '', status: 'diajukan', upah: 0, imporSumber: prov('jahit', 'pend-D') }),
    count('g4-cnt-N', 'g4sewer02', { L: 10 }, { tanggal: '2026-08-10', upah: 2500, asal: '', workflowVersion: 2, imporSumber: '' })]);
  f.add('LegacySettlement', [
    settlement('ls-A', { sourceSnapshot: snapshot('g4-rep-A', 'g4sewer01', 10, 2000), baselineSources: JSON.stringify([{ sourceId: 'g4-cnt-A', size: 'M', qty: 10, rate: 2000 }]), reason: 'Beberapa setoran lama berbagi kelompok hitungan; pembayaran per sumber belum dapat dipastikan.' }),
    settlement('ls-B', { sourceSnapshot: snapshot('g4-rep-B', 'g4sewer01', 8, 1800), baselineSources: JSON.stringify([{ sourceId: 'g4-cnt-B', size: 'M', qty: 8, rate: 2000 }]), reason: 'Tarif pada pembayaran lama berbeda dari tarif sumber hitungan.' }),
    settlement('ls-C', { sourceSnapshot: snapshot('g4-rep-C', 'g4sewer01', 12, 2000), baselineSources: JSON.stringify([{ sourceId: 'g4-cnt-C', size: 'M', qty: 12, rate: 2000 }]), resolution: 'full', allocations: JSON.stringify([{ sourceId: 'g4-cnt-C', size: 'M', qty: 12 }]), reason: '' }),
    settlement('ls-D', { maklonId: 'g4sewer02', sourceSnapshot: snapshot('g4-rep-D', 'g4sewer02', 5, 2000), baselineSources: JSON.stringify([{ sourceId: 'g4-pend-D', size: 'M', qty: 5, rate: 2000, pending: true }]), reason: 'Setoran lama sudah dibayar tetapi masih ada sisa yang menunggu hitung fisik.' })]);
  const decide = (id, pilihan, extra = {}, token) => f.call('cocokkanPembayaranLama', { id, reqId: 'g4-req-' + id, pilihan, alasan: 'Sudah dicek di buku bayar lama', ...extra }, token);
  const rows = () => Object.fromEntries(['Potong', 'SlipKirim', 'SlipSetor', 'QC', 'Gudang', 'SlipUpah', 'LegacySettlement'].map(t => [t, f.raw(t)]));
  return { ...f, decide, rows };
}
const others = (list, id) => list.filter(r => r.id !== id);
const byId = (list, id) => list.find(r => r.id === id);

test('(b) only the owner may decide, with a choice and a reason, and only for a payment that is really held', () => {
  const f = fixtureLama(), before = f.rows(), version = f.h.run('pkStore_().version()');
  for (const token of [f.admin, f.qc, f.sewer]) assert.match(f.decide('ls-A', 'belum', {}, token).error, /Hanya owner/);
  assert.match(f.decide('ls-A', 'belum', { reqId: '' }).error, /Identitas permintaan/);
  assert.match(f.decide('ls-A', 'mungkin').error, /sudah lunas atau belum dibayar/);
  assert.match(f.decide('ls-A', 'belum', { alasan: ' ok ' }).error, /minimal 5/);
  assert.match(f.decide('ls-A', 'belum', { alasan: 'x'.repeat(201) }).error, /terlalu panjang/);
  assert.match(f.decide('ls-Z', 'belum').error, /tidak ditemukan/);
  assert.match(f.decide('ls-C', 'lunas').error, /tidak ditahan/, 'a matched old payment needs no decision');
  assert.deepEqual(f.raw('CocokBayarLama'), []); assert.deepEqual(f.rows(), before);
  assert.equal(f.h.run('pkStore_().version()'), version, 'refused requests write nothing');
});

test('(b) the owner sees each held old payment; workers, QC and admin do not', () => {
  const f = fixtureLama(), st = f.state();
  assert.deepEqual(st.pembayaranLama.map(b => [b.id, b.maklonId, b.size, b.ditahan, b.dasar, b.bayarPcs, b.bayarRef, b.poNama]),
    [['ls-A', 'g4sewer01', 'M', 10, 10, 10, 'LAMA', 'Kemeja Lama'], ['ls-B', 'g4sewer01', 'M', 8, 8, 8, 'LAMA', 'Kemeja Lama'], ['ls-D', 'g4sewer02', 'M', 0, 5, 5, 'LAMA', 'Kemeja Lama']]);
  assert.match(st.pembayaranLama[1].alasan, /Tarif pada pembayaran lama berbeda/);
  for (const token of [f.admin, f.qc, f.sewer]) assert.equal(f.state(token).pembayaranLama, undefined);
  assert.equal('LegacySettlement' in st, false); assert.equal('CocokBayarLama' in st, false);
  const held = st.payroll.filter(r => r.poId === LS && r.available === 0 && r.needsReview).map(r => r.id).sort();
  assert.deepEqual(held, ['setor:g4-cnt-A:M', 'setor:g4-cnt-B:M']);
});

test('(b) a held source says it is held, not paid; a matched or settled source still says it is paid', () => {
  const f = fixtureLama();
  f.bad('deleteRecord', { sheet: 'SlipSetor', id: 'g4-cnt-B' }, /^Slip ini belum masuk slip upah\. Pembayaran lama masih ditahan; owner perlu mencocokkannya dulu di menu Upah\.$/);
  f.bad('ubahHarga', { sheet: 'SlipSetor', id: 'g4-cnt-B', harga: 2100 }, /^Pembayaran lama masih ditahan; owner perlu mencocokkannya dulu di menu Upah\.$/);
  f.bad('deleteRecord', { sheet: 'SlipSetor', id: 'g4-pend-D' }, /Pembayaran lama masih ditahan; owner perlu mencocokkannya dulu di menu Upah/);
  f.bad('ubahHarga', { sheet: 'SlipSetor', id: 'g4-cnt-C', harga: 2100 }, /^Sudah masuk slip upah/);
  f.bad('deleteRecord', { sheet: 'SlipSetor', id: 'g4-cnt-C' }, /^Slip ini sudah masuk slip upah/);
  assert.equal(f.decide('ls-B', 'lunas').ok, true);
  f.bad('ubahHarga', { sheet: 'SlipSetor', id: 'g4-cnt-B', harga: 2100 }, /^Sudah masuk slip upah/);
  f.bad('deleteRecord', { sheet: 'SlipSetor', id: 'g4-cnt-B' }, /^Slip ini sudah masuk slip upah/);
});

test('(b) "belum dibayar" releases only that payment\'s rows; the decision is kept with who, when, choice and reason', () => {
  const f = fixtureLama(), before = f.state(), rowsBefore = f.rows(), me = before.me.id;
  const done = f.decide('ls-A', 'belum', { alasan: '  Buku bayar lama   tidak mencatat setoran ini ' });
  assert.equal(done.ok, true, done.error);
  const after = f.state(), a = byId(after.payroll, 'setor:g4-cnt-A:M');
  assert.equal(a.available, 10); assert.equal(a.paidQty, 0); assert.equal(a.needsReview, false); assert.deepEqual(a.issues, []);
  assert.deepEqual(others(after.payroll, 'setor:g4-cnt-A:M'), others(before.payroll, 'setor:g4-cnt-A:M'), 'every other wage row is identical');
  assert.deepEqual(f.rows(), rowsBefore, 'no production, slip or old payment row is touched');
  const log = f.raw('CocokBayarLama');
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].id, log[0].settlementId, log[0].pilihan, log[0].alasan, log[0].dibuatOleh, log[0].requestActor], ['g4-req-ls-A', 'ls-A', 'belum', 'Buku bayar lama tidak mencatat setoran ini', me, me]);
  assert.match(log[0].dibuat, /^\d{4}-\d{2}-\d{2}T/); assert.ok(log[0].requestHash);
  assert.deepEqual(after.pembayaranLama.map(b => b.id), ['ls-B', 'ls-D']);
  /* a lost response is retried safely; a different request with the same id, or a second decision, is refused */
  const version = f.h.run('pkStore_().version()');
  const again = f.decide('ls-A', 'belum', { alasan: 'Buku bayar lama tidak mencatat setoran ini' });
  assert.equal(again.ok, true, again.error); assert.equal(again.data.data.replayed, true);
  assert.equal(f.h.run('pkStore_().version()'), version, 'the retry writes nothing');
  assert.match(f.decide('ls-A', 'lunas').error, /isi berbeda/);
  assert.match(f.decide('ls-A', 'lunas', { reqId: 'g4-req-ls-A2' }).error, /sudah dicocokkan/);
  /* the released wage is ordinary unpaid work now: it can be paid, and its rate can still be set */
  const pay = f.good('createUpah', { upah: { id: 'g4-pay-0001', pegawaiId: 'g4sewer01', itemIds: ['setor:g4-cnt-A:M'], expectedRevisions: { 'setor:g4-cnt-A:M': a.revision } } });
  assert.equal(pay.totalQty, 10); assert.equal(pay.totalUpah, 20000);
  assert.equal(byId(f.state().payroll, 'setor:g4-cnt-A:M').available, 0);
});

test('(b) "sudah lunas" counts the held pieces as paid by that old payment and changes no other wage row', () => {
  const f = fixtureLama(), before = f.state();
  assert.equal(f.decide('ls-B', 'lunas').ok, true);
  const after = f.state(), b = byId(after.payroll, 'setor:g4-cnt-B:M');
  assert.deepEqual([b.total, b.paidQty, b.available, b.needsReview, b.upahId, b.issues.length], [8, 8, 0, false, 'LAMA', 0]);
  assert.deepEqual(others(after.payroll, 'setor:g4-cnt-B:M'), others(before.payroll, 'setor:g4-cnt-B:M'));
  assert.deepEqual(after.pembayaranLama.map(x => x.id), ['ls-A', 'ls-D']);
  f.bad('createUpah', { upah: { id: 'g4-pay-0002', pegawaiId: 'g4sewer01', itemIds: ['setor:g4-cnt-B:M'], expectedRevisions: { 'setor:g4-cnt-B:M': b.revision } } }, /sudah dibayar/);
});

test('(b) a held report not yet counted: "sudah lunas" covers it once counted; "belum dibayar" lets it be paid', () => {
  for (const pilihan of ['lunas', 'belum']) {
    const f = fixtureLama(), before = f.state();
    assert.equal(f.decide('ls-D', pilihan).ok, true);
    assert.deepEqual(f.state().payroll, before.payroll, 'nothing earned yet, so nothing changes');
    f.good('prosesSetor', { id: 'g4-pend-D', keputusan: 'terima', ukuran: { M: 5 }, upah: 2000, tanggal: '2026-08-11' });
    const after = f.state(), d = byId(after.payroll, 'setor:g4-pend-D:M');
    if (pilihan === 'lunas') assert.deepEqual([d.paidQty, d.available, d.needsReview], [5, 0, false]);
    else assert.deepEqual([d.paidQty, d.available, d.needsReview], [0, 5, false]);
    assert.deepEqual(others(after.payroll, 'setor:g4-pend-D:M'), before.payroll);
  }
  const held = fixtureLama();
  held.good('prosesSetor', { id: 'g4-pend-D', keputusan: 'terima', ukuran: { M: 5 }, upah: 2000, tanggal: '2026-08-11' });
  const d = byId(held.state().payroll, 'setor:g4-pend-D:M');
  assert.deepEqual([d.available, d.needsReview], [0, true], 'without a decision the counted report stays held as before');
});

test('(b) corePayroll applies a decision only to a held payment and leaves every other row as before', () => {
  const c = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core.js'), 'utf8'), c);
  const run = s => JSON.parse(JSON.stringify(vm.runInContext(s, c)));
  const p = JSON.stringify({ baseline: true, skuId: 'k', siklus: 'current', field: 'hitungFisik', entryId: 'h' });
  const s = (id, qty, extra = '') => `{id:'${id}',poId:'po',maklonId:'w',tanggal:'2026-08-05',ukuran:{M:${qty}},total:${qty},status:'diterima',upah:2000,workflowVersion:1,imporSumber:${JSON.stringify(p)}${extra}}`;
  const b = (id, src, qty, extra = '') => `{id:'${id}',sourceId:'r${id}',poId:'po',maklonId:'w',size:'M',paymentRef:'LAMA',sourceSnapshot:{id:'r${id}',poId:'po',maklonId:'w',total:${qty},upah:2000,upahId:'LAMA'},imporSumber:{baseline:true,skuId:'k',siklus:'current',field:'jahit',entryId:'j${id}'},baselineSources:[{sourceId:'${src}',size:'M',qty:${qty},rate:2000}],resolution:'hold',allocations:[],reason:'Perlu bukti'${extra}}`;
  vm.runInContext(`var setor=[${s('s1', 6)},${s('s2', 4)},${s('s3', 3)}], qc=[], upah=[];
    var settlements=[${b('b1', 's1', 6)},${b('b2', 's2', 4)},${b('b3', 's3', 3, ",resolution:'full',allocations:[{sourceId:'s3',size:'M',qty:3}]")}];
    function pay(decisions){ var st={}; var rows=corePayroll([],setor,qc,upah,{settlements:settlements,settlementDecisions:decisions,settlementState:st}); return {rows:rows,state:st}; }`, c);
  const none = run('pay([])'), stray = run("pay([{settlementId:'b3',pilihan:'belum'},{settlementId:'b9',pilihan:'lunas'},{settlementId:'b1',pilihan:'entah'}])");
  assert.deepEqual(stray.rows, none.rows, 'a decision on a matched payment, an unknown payment or an unknown choice changes nothing');
  assert.deepEqual(none.state, { b1: { held: true, keputusan: '', qty: 6, baris: 6 }, b2: { held: true, keputusan: '', qty: 4, baris: 4 }, b3: { held: false, keputusan: '', qty: 3, baris: 3 } });
  const lunas = run("pay([{settlementId:'b1',pilihan:'lunas'},{settlementId:'b1',pilihan:'belum'}])");
  assert.deepEqual(lunas.rows.filter(r => r.sourceId !== 's1'), none.rows.filter(r => r.sourceId !== 's1'));
  const r1 = lunas.rows.find(r => r.sourceId === 's1');
  assert.deepEqual([r1.paidQty, r1.available, r1.needsReview, r1.upahId, r1.legacySettlementId, !!r1.legacySettlementHold], [6, 0, false, 'LAMA', 'b1', false], 'the first decision wins');
  assert.equal(lunas.state.b1.keputusan, 'lunas');
  const belum = run("pay([{settlementId:'b2',pilihan:'belum'}])"), r2 = belum.rows.find(r => r.sourceId === 's2');
  assert.deepEqual([r2.paidQty, r2.available, r2.needsReview, r2.issues], [0, 4, false, []]);
  assert.deepEqual(belum.rows.filter(r => r.sourceId !== 's2'), none.rows.filter(r => r.sourceId !== 's2'));
  /* "lunas" never pays more than the held baseline quantity */
  vm.runInContext(`setor[0].ukuran={M:9};setor[0].total=9;`, c);
  const capped = run("pay([{settlementId:'b1',pilihan:'lunas'}])").rows.find(r => r.sourceId === 's1');
  assert.deepEqual([capped.total, capped.paidQty, capped.available, capped.overpaidQty], [9, 6, 3, 0]);
});

function upahUi(divisi) {
  const c = vm.createContext({ console, Promise });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core.js'), 'utf8'), c);
  vm.runInContext(`
    var A = {}, D = { po: { po1: { id: 'po1', nama: 'Kemeja Lama' } } }, messages = [], sheet = '', calls = [], closed = 0, form = {}, sheets = [{ node: {} }];
    var S = { state: { me: { id: 'own1', divisi: '${divisi}' }, payroll: [], pembayaranLama: [
      { id: 'ls-A', poId: 'po1', poNama: 'Kemeja Lama', maklonId: 'w1', size: 'M', alasan: 'Tarif berbeda', ditahan: 10, dasar: 10, bayarPcs: 10, bayarRef: 'LAMA', noSlip: '' },
      { id: 'ls-D', poId: 'po-hilang', poNama: 'Kaos Arsip', maklonId: 'w2', size: 'L', alasan: '', ditahan: 0, dasar: 5, bayarPcs: 5, bayarRef: 'su01', noSlip: 'SU-0001' }] } };
    function me() { return S.state.me; }
    function esc(s) { return String(s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
    function nf(n) { return String(n || 0); } function toast(s, e) { messages.push([s, !!e]); }
    function namaUser(id) { return id === 'w1' ? 'Penjahit Satu' : 'Penjahit Dua'; } function poNama(id) { return D.po[id] ? D.po[id].nama : '—'; }
    function openSheet(fn) { sheet = fn(); } function sheetHtml(t, b, f) { return t + '|' + b + '|' + (f || ''); }
    function hid(k, v) { return '<input type="hidden" name="' + k + '" value="' + esc(v) + '">'; }
    function newId() { return 'req-baru-01'; } function formVals() { return Object.assign({}, form); } function closeSheet() { closed++; }
    function act(el, p) { return p; } function quiet() {} function req(action, payload) { calls.push({ action: action, payload: payload }); return Promise.resolve({}); }
  `, c);
  vm.runInContext(part('function payrollRows(', 'function unpaidOf('), c);
  vm.runInContext(part('/* 1.5.75: cocokkan pembayaran lama', '/* ---------- slip upah ---------- */'), c);
  return c;
}

test('(b) the Upah screen shows the owner a "Cocokkan pembayaran lama" button where held wages appear', () => {
  const c = upahUi('owner'), run = s => vm.runInContext(s, c);
  const notice = run("payrollNotice({ id: 'w1' })");
  assert.match(notice, /data-bayar-lama/); assert.match(notice, /Pembayaran lama ditahan/);
  assert.match(notice, /Penjahit Satu · Kemeja Lama · M/); assert.match(notice, /10 pcs upah ditahan · Tanda lunas aplikasi lama · 10 pcs/);
  assert.match(notice, /<button class="btn sm" data-a="bayarLamaOpen" data-id="ls-A">Cocokkan pembayaran lama<\/button>/);
  assert.doesNotMatch(notice, /ls-D/, 'only this worker\'s held payments');
  const all = run("bayarLamaHtml('')");
  assert.match(all, /data-id="ls-A"/); assert.match(all, /Penjahit Dua · Kaos Arsip · L/); assert.match(all, /5 pcs laporan lama belum dihitung · Slip SU-0001 · 5 pcs/);
  assert.equal(run("payrollNotice({ id: 'w3' })"), '', 'no held payment, no rows: nothing shown');
  for (const divisi of ['admin', 'jahit']) assert.equal(vm.runInContext("payrollNotice({ id: 'w1' })", upahUi(divisi)), '', divisi + ' gets no button');
  const view = part('VIEWS.upah = function', 'function upahRow(');
  assert.match(view, /Tandai lunas data lama<\/button><\/div>' \+ bayarLamaHtml\(''\) \+/);
  assert.match(html, /\|ubahHarga\|tandaiLunas\|cocokkanPembayaranLama\|importRows\|/, 'the client refuses the action against a server without workflow 2');
});

test('(b) the dialog offers two choices, needs a reason, and sends one request id', async () => {
  const c = upahUi('owner'), run = s => vm.runInContext(s, c), plain = x => JSON.parse(JSON.stringify(x));
  const el = id => `({ getAttribute: function (k) { return k === 'data-id' ? '${id}' : ''; } })`;
  run('A.bayarLamaOpen(' + el('ls-Z') + ')');
  assert.equal(c.sheet, ''); assert.match(plain(c.messages.pop())[0], /sudah dicocokkan/);
  run('A.bayarLamaOpen(' + el('ls-A') + ')');
  assert.match(c.sheet, /^Cocokkan pembayaran lama\|/);
  assert.match(c.sheet, /name="id" value="ls-A"[\s\S]*name="reqId" value="req-baru-01"/);
  assert.match(c.sheet, /<input type="radio" name="pilihan" value="lunas">[\s\S]*Sudah lunas[\s\S]*<input type="radio" name="pilihan" value="belum">[\s\S]*Belum dibayar/);
  assert.match(c.sheet, /name="alasan" maxlength="200"/); assert.match(c.sheet, /Tarif berbeda/);
  assert.match(c.sheet, /data-a="bayarLamaSave">Simpan<\/button>$/);
  run("form = { id: 'ls-A', reqId: 'req-baru-01', alasan: 'Sudah dicek di buku bayar' }; A.bayarLamaSave({})");
  assert.equal(c.calls.length, 0); assert.match(c.messages.pop()[0], /Pilih dulu/);
  run("form.pilihan = 'lunas'; form.alasan = ' ok '; A.bayarLamaSave({})");
  assert.equal(c.calls.length, 0); assert.match(c.messages.pop()[0], /minimal 5/);
  run("form.alasan = '  Sudah dicek   di buku bayar '; A.bayarLamaSave({})");
  assert.deepEqual(plain(c.calls), [{ action: 'cocokkanPembayaranLama', payload: { id: 'ls-A', reqId: 'req-baru-01', pilihan: 'lunas', alasan: 'Sudah dicek di buku bayar' } }]);
  await new Promise(r => setTimeout(r, 5));
  assert.equal(c.closed, 1); assert.deepEqual(plain(c.messages.pop()), ['Dicatat sudah lunas sebanyak pcs yang dibayar waktu itu. Sisanya, kalau ada, masuk Belum dibayar.', false]);
  const admin = upahUi('admin');
  vm.runInContext('A.bayarLamaOpen(' + el('ls-A') + ')', admin);
  assert.equal(admin.sheet, ''); assert.match(admin.messages.pop()[0], /Hanya owner/);
});
