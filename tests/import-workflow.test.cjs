const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/core.js'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'src/import-backup.js'), 'utf8');
function run(items, expression = 'result') {
  const backup = { produksi: { produksi: items }, produksi_meta: { tukangJahit: [{ id: 'worker1', nama: 'Ali' }], tukang: [{ id: 'cutter1', nama: 'Budi' }] }, _meta: { ts: '2026-10-08T00:00:00Z' } };
  const code = source + '\nvar result = convertBackup(' + JSON.stringify(backup) + ');\n' + expression;
  return JSON.parse(JSON.stringify(vm.runInNewContext(code, {}, { timeout: 5000 })));
}
function sku(extra = {}) {
  return { id: 'sku001', namaBarang: 'Kaos', series: 'A', size: 'M', poAktif: true,
    potong: [{ id: 'cut001', tanggal: '2026-10-01', jumlah: 40, tukangId: 'cutter1', tarif: 500 }],
    assignJahit: [{ id: 'assign1', tanggal: '2026-10-01', qty: 40, tukangId: 'worker1' }],
    jahit: [{ id: 'sew001', tanggal: '2026-10-02', jumlah: 40, rijek: 0, lolos: 40, tukangId: 'worker1', assignmentId: 'assign1', tarif: 2000 }],
    hitungFisik: [{ id: 'count1', tanggal: '2026-10-03', jumlah: 40, tukangId: 'worker1', payroll: { workerId: 'worker1', rate: 2500, rateMissing: false }, workflowVersion: 2, countStage: 'verified' }],
    qc: [], gudang: [], ...extra };
}
function inspected(extra = {}) {
  return sku({ qc: [{ id: 'qc001', hfId: 'count1', tanggal: '2026-10-04', tukangId: 'worker1', ok: 35, reject: 5, perbaikan: 0, offline: 0 }], ...extra });
}

test('sewing report remains pending; physical count never becomes QC', () => {
  const a = run([sku({ hitungFisik: [] })]).rows;
  assert.equal(a.SlipSetor.length, 1);
  assert.equal(a.SlipSetor[0].status, 'diajukan');
  assert.equal(a.SlipSetor[0].noSlip, '');
  assert.equal(a.QC.length, 0);
  const b = run([sku()]).rows;
  assert.equal(b.SlipSetor[0].status, 'diterima');
  assert.equal(b.SlipSetor[0].upah, 2500);
  assert.equal(b.SlipSetor[0].tanggal, '2026-10-03');
  assert.equal(b.QC.length, 0);
  assert.equal(b.Gudang.length, 0);
  assert.equal(b.PO[0].status, 'aktif');
});

test('QC keeps physical-count linkage and authoritative payable quantity', () => {
  const r = run([inspected()]);
  assert.equal(r.rows.QC[0].setorId, r.rows.SlipSetor[0].id);
  assert.deepEqual(r.rows.QC[0].rejectUkuran, { M: 5 });
  assert.equal(r.rows.PO[0].status, 'selesai');
  const pay = run([inspected()], 'corePayroll(result.rows.Potong, result.rows.SlipSetor, result.rows.QC, [])');
  const sewing = pay.filter(r => r.jenis === 'jahit');
  assert.equal(sewing.length, 1);
  assert.equal(sewing[0].total, 35);
  assert.equal(sewing[0].rate, 2500);
  assert.equal(sewing[0].tanggal, '2026-10-03');
});

test('all reject QC pays zero; kotor is an alias, never added twice', () => {
  const allReject = inspected({ qc: [{ id: 'qc001', hfId: 'count1', tanggal: '2026-10-04', tukangId: 'worker1', ok: 0, reject: 40 }] });
  const pay = run([allReject], 'corePayroll(result.rows.Potong, result.rows.SlipSetor, result.rows.QC, [])');
  assert.equal(pay.find(r => r.jenis === 'jahit').total, 0);
  const r = run([inspected({ qc: [{ id: 'qc001', hfId: 'count1', tanggal: '2026-10-04', tukangId: 'worker1', ok: 30, perbaikan: 10, kotor: 10 }] })]);
  assert.equal(r.rows.QC[0].perbaikan, 10);
});

test('completed repairs preserve date and frozen tariff, including same-day repair', () => {
  const s = inspected({ qc: [{ id: 'qc001', hfId: 'count1', tanggal: '2026-10-04', tukangId: 'worker1', ok: 34, perbaikan: 6 }],
    gudang: [{ id: 'store01', qcId: 'qc001', status: 'ok', tanggal: '2026-10-04', jumlah: 30, payrollStage: 'initial' },
      { id: 'repair1', qcId: 'qc001', status: 'ok', tanggal: '2026-10-04', jumlah: 4, payrollStage: 'repair' }] });
  const r = run([s]);
  assert.equal(r.rows.QC[0].total, 30);
  assert.equal(r.rows.QC[0].perbaikan, 10);
  assert.equal(r.rows.QC[1].repairQcId, r.rows.QC[0].id);
  assert.deepEqual(r.rows.QC[1].perbaikanUkuran, { M: -4 });
  const pay = run([s], 'corePayroll(result.rows.Potong, result.rows.SlipSetor, result.rows.QC, []).filter(function(r){return r.jenis === "jahit";})');
  assert.deepEqual(pay.map(r => [r.total, r.rate, r.tanggal]), [[30, 2500, '2026-10-03'], [4, 2500, '2026-10-04']]);
});

test('SKU sizes and separate archive cycles with the same label never merge', () => {
  const base = sku({ poAktif: false, potong: [], assignJahit: [], jahit: [], hitungFisik: [], arsip: [
    { label: 'PO Lama', potong: [{ id: 'oldcut1', tanggal: '2026-08-01', jumlah: 2, tukangId: 'cutter1' }] },
    { label: 'PO Lama', potong: [{ id: 'oldcut2', tanggal: '2026-09-01', jumlah: 3, tukangId: 'cutter1' }] }
  ] });
  const r = run([sku(), sku({ id: 'sku002', size: 'L' }), base]);
  assert.equal(r.rows.PO.length, 4);
  assert.equal(new Set(r.rows.PO.map(p => p.id)).size, 4);
  assert.ok(r.rows.PO.every(p => p.imporVersion === 2));
});

test('archive label and BigSeller flag do not fabricate QC, storage, or completion', () => {
  const s = sku({ poAktif: false, potong: [], assignJahit: [], jahit: [], hitungFisik: [], arsip: [
    { label: 'Selesai', tanggalArsip: '2026-10-05', bigSeller: true, potong: [{ id: 'oldcut1', jumlah: 10, tanggal: '2026-10-01', tukangId: 'cutter1' }] }
  ] });
  const r = run([s]);
  assert.equal(r.rows.QC.length, 0);
  assert.equal(r.rows.Gudang.length, 0);
  assert.equal(r.rows.PO[0].status, 'aktif');
});

test('ambiguous QC/count relation fails before any import rows are returned', () => {
  const s = inspected(); delete s.qc[0].hfId;
  assert.throws(() => run([s]), /tautan hitung fisik yang pasti/);
  const unknown = sku(); unknown.hitungFisik[0].payroll.rate = 0;
  assert.throws(() => run([unknown]), /Tarif asli hitung fisik/);
});

test('same count repeated across current/archive is rejected rather than paid twice', () => {
  const s = sku(); s.arsip = [{ ...s, id: undefined }];
  assert.throws(() => run([s]), /muncul dalam beberapa siklus/);
});

test('legacy automatic QC remains a count and does not satisfy inspection', () => {
  const s = inspected(); s.qc[0].autoFromCount = true; s.hitungFisik[0].qcId = s.qc[0].id;
  const r = run([s]);
  assert.equal(r.rows.QC.length, 0);
  assert.equal(r.rows.SlipSetor[0].total, 40);
  assert.equal(r.rows.PO[0].status, 'aktif');
  assert.match(r.info.catatan[0], /menunggu inspeksi/);
});

test('sewing rejects are size-specific and reduce the production target', () => {
  const s = sku(); s.jahit[0].rijek = 5; s.jahit[0].lolos = 35; s.hitungFisik[0].jumlah = 35;
  const r = run([s]);
  const rejected = r.rows.SlipSetor.find(s => s.reject > 0);
  assert.deepEqual(rejected.rejectUkuran, { M: 5 });
  const flow = run([s], 'coreWorkflow(result.rows.PO, result.rows.Potong, result.rows.SlipKirim, result.rows.SlipSetor, result.rows.QC, result.rows.Gudang)[result.rows.PO[0].id]');
  assert.equal(flow.ukuran.M.targetBaik, 35);
  assert.equal(flow.readyQC, true);
});

test('old BigSeller amounts without inspection fail with actionable review', () => {
  const s = sku({ bsInputs: [{ id: 'bs001', tanggal: '2026-10-05', qty: 40 }] });
  assert.throws(() => run([s]), /Periksa hubungan potong, penugasan, hitungan, QC, dan BigSeller/);
});

test('verified imported paid counts remain paid', () => {
  const s = inspected(); s.hitungFisik[0].dibayar = true;
  const pay = run([s], 'corePayroll(result.rows.Potong, result.rows.SlipSetor, result.rows.QC, []).filter(function(r){return r.jenis === "jahit";})');
  assert.equal(pay[0].available, 0);
  assert.equal(pay[0].legacyPaid, true);
});

test('stable identities survive repeat conversion and input item ordering', () => {
  const a = sku(), b = sku({ id: 'sku002', size: 'L' });
  function ids(r) { return ['PO','Potong','SlipKirim','SlipSetor'].flatMap(k => r.rows[k].map(x => x.id)).sort(); }
  assert.deepEqual(ids(run([a,b])), ids(run([b,a])));
  assert.deepEqual(run([a]), run([a]));
});

test('conflicting snapshots with the same cycle identity fail instead of losing history', () => {
  const s = sku({ poAktif: false, potong: [], assignJahit: [], jahit: [], hitungFisik: [], arsip: [
    { id: 'archive1', potong: [{ id: 'oldcut1', tanggal: '2026-08-01', jumlah: 2, tukangId: 'cutter1' }] },
    { id: 'archive1', potong: [{ id: 'oldcut2', tanggal: '2026-09-01', jumlah: 3, tukangId: 'cutter1' }] }
  ] });
  assert.throws(() => run([s]), /Identitas siklus yang sama memuat riwayat berbeda/);
});
