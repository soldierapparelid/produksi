const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/core.js'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'src/import-backup.js'), 'utf8');
function run(items, expression = 'result', meta = {}, options = {}) {
  const backup = { produksi: { produksi: items }, produksi_meta: { tukangJahit: [{ id: 'worker1', nama: 'Ali' }], tukang: [{ id: 'cutter1', nama: 'Budi' }], ...meta }, _meta: { ts: '2026-10-08T00:00:00Z' } };
  const code = source + '\nvar result = convertBackup(' + JSON.stringify(backup) + ',' + JSON.stringify(options) + ');\n' + expression;
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
  return sku({ qc: [{ id: 'qc001', hfId: 'count1', workflowVersion: 2, tanggal: '2026-10-04', tukangId: 'worker1', ok: 35, reject: 5, perbaikan: 0, offline: 0 }], ...extra });
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

test('legacy HF without snapshot freezes its worker historical tariff at source input time', () => {
  const item = sku({ namaBarang: 'Kaos/A', hitungFisik: [{ id: 'count1', tanggal: '2026-10-03', inputAt: '2026-10-03T10:00:00Z', jumlah: 40, tukangId: 'worker1' }] });
  const worker = { id: 'worker1', nama: 'Ali', tarif: { 'A|Kaos_A': 9000 }, tarifHistory: { 'A|Kaos_A': {
    old: { effectiveAt: '2026-10-01T00:00:00Z', rate: 2100 }, newer: { effectiveAt: '2026-10-04T00:00:00Z', rate: 3300 }
  } } };
  const result = run([item], 'result', { tukangJahit: [worker] });
  assert.equal(result.rows.SlipSetor.find(r => r.status === 'diterima').upah, 2100);
  item.hitungFisik[0].payroll = { workerId: 'worker1', rate: 2500, rateMissing: false };
  assert.equal(run([item], 'result', { tukangJahit: [worker] }).rows.SlipSetor[0].upah, 2500, 'a valid captured rate must remain authoritative');
  item.hitungFisik[0].payroll.rateMissing = true;
  assert.equal(run([item], 'result', { tukangJahit: [worker] }).rows.SlipSetor[0].upah, 2100, 'missing-rate snapshots follow the same legacy history fallback');
});

test('date-only legacy counts cannot take a rate changed later that workday', () => {
  const item = sku({ hitungFisik: [{ id: 'count1', tanggal: '2026-10-03', jumlah: 40, tukangId: 'worker1' }] });
  const laterThatDay = new Date(2026, 9, 3, 12).toISOString();
  const metadata = { tukangJahit: [{ id: 'worker1', nama: 'Ali', tarif: { 'A|Kaos': 9000 }, tarifHistory: { 'A|Kaos': [
    { effectiveAt: '2026-10-01T00:00:00Z', rate: 2100 }, { effectiveAt: laterThatDay, rate: 3300 }
  ] } }] };
  assert.equal(run([item], 'result', metadata).rows.SlipSetor[0].upah, 2100);
  metadata.tukangJahit[0].tarifHistory['A|Kaos'] = [{ effectiveAt: laterThatDay, rate: 3300 }];
  assert.throws(() => run([item], 'result', metadata), /Tarif asli hitung fisik/, 'available future/current tariffs must not fill a missing past rate');
});

test('legacy tariff fallback requires a unique worker and an explicit positive product rate', () => {
  const item = sku({ hitungFisik: [{ id: 'count1', tanggal: '2026-10-03', jumlah: 40, tukangId: 'worker1' }] });
  const worker = { id: 'worker1', nama: 'Ali', tarif: { 'A|Kaos': 2200 } };
  assert.equal(run([item], 'result', { tukangJahit: [worker] }).rows.SlipSetor[0].upah, 2200);
  assert.throws(() => run([item], 'result', { tukangJahit: [worker, { ...worker, tarif: { 'A|Kaos': 3300 } }] }), /Tarif asli hitung fisik/);
  assert.throws(() => run([item], 'result', { tukangJahit: [{ ...worker, tarif: { 'A|Other': 2200 } }] }), /Tarif asli hitung fisik/);
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
  const allReject = inspected({ qc: [{ id: 'qc001', hfId: 'count1', workflowVersion: 2, tanggal: '2026-10-04', tukangId: 'worker1', ok: 0, reject: 40 }] });
  const pay = run([allReject], 'corePayroll(result.rows.Potong, result.rows.SlipSetor, result.rows.QC, [])');
  assert.equal(pay.find(r => r.jenis === 'jahit').total, 0);
  const r = run([inspected({ qc: [{ id: 'qc001', hfId: 'count1', workflowVersion: 2, tanggal: '2026-10-04', tukangId: 'worker1', ok: 30, perbaikan: 10, kotor: 10 }] })]);
  assert.equal(r.rows.QC[0].perbaikan, 10);
});

test('completed repairs preserve date and frozen tariff, including same-day repair', () => {
  const s = inspected({ qc: [{ id: 'qc001', hfId: 'count1', workflowVersion: 2, tanggal: '2026-10-04', tukangId: 'worker1', ok: 34, perbaikan: 6 }],
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

test('modern QC/count relation requires an explicit link before import', () => {
  const s = inspected(); delete s.qc[0].hfId; s.qc[0].workflowVersion = 2;
  assert.throws(() => run([s]), /tautan hitung fisik yang pasti/);
  const unknown = sku(); unknown.hitungFisik[0].payroll.rate = 0;
  assert.throws(() => run([unknown]), /Tarif asli hitung fisik/);
});

test('legacy batch linkage follows the reference unique worker/date/timestamp/quantity contract', () => {
  const item = sku({
    hitungFisik: [{ id: 'count1', tanggal: '2026-10-03', inputAt: '2026-10-03T10:00:00.000Z', inputVia: 'qc-command-v28-batch', jumlah: 40, tukang: '  ALI  ', payroll: { workerId: 'worker1', rate: 2500 } }],
    qc: [{ id: 'qc001', tanggal: '2026-10-03', inputAt: '2026-10-03T10:00:01.900Z', inputVia: 'qc-command-v28-batch', tukangJahit: 'Ali', ok: 35, reject: 5 }]
  });
  const result = run([item]).rows;
  assert.equal(result.QC.length, 1);
  assert.equal(result.QC[0].setorId, result.SlipSetor[0].id);
  assert.equal(result.QC[0].total, 35);
  assert.equal(run([item], 'corePayroll(result.rows.Potong,result.rows.SlipSetor,result.rows.QC,[]).filter(function(r){return r.jenis==="jahit";})')[0].total, 35);
  item.qc[0].inputAt = '2026-10-03T10:00:02.001Z';
  item.qc[0].workflowVersion = 2;
  assert.throws(() => run([item]), /tautan hitung fisik yang pasti/);
  item.qc[0].inputAt = '2026-10-03T10:00:01.900Z';
  item.qc[0].inputVia = 'qc-command';
  item.qc[0].workflowVersion = 2;
  assert.throws(() => run([item]), /tautan hitung fisik yang pasti/, 'ordinary manual QC cannot borrow a nearby count');
});

test('legacy batch inference never overrides explicit, staged, or nonunique count linkage', () => {
  const item = sku({
    hitungFisik: [{ id: 'count1', tanggal: '2026-10-03', inputAt: '2026-10-03T10:00:00Z', inputVia: 'qc-command-batch', jumlah: 40, tukangId: 'worker1', payroll: { workerId: 'worker1', rate: 2500 } }],
    qc: [{ id: 'qc001', tanggal: '2026-10-03', inputAt: '2026-10-03T10:00:00Z', inputVia: 'qc-command-batch', tukangId: 'worker1', ok: 40 }]
  });
  item.qc[0].hfId = 'missing';
  assert.throws(() => run([item]), /tautan hitung fisik yang pasti/);
  delete item.qc[0].hfId;
  item.hitungFisik[0].workflowVersion = 2; item.hitungFisik[0].countStage = 'verified';
  item.qc[0].workflowVersion = 2;
  assert.throws(() => run([item]), /tautan hitung fisik yang pasti/, 'verified counts require explicit QC relationships');
  delete item.hitungFisik[0].workflowVersion; delete item.hitungFisik[0].countStage;
  delete item.qc[0].workflowVersion;
  item.qc.push({ ...item.qc[0], id: 'qc002' });
  assert.throws(() => run([item]), /tautan hitung fisik yang pasti/, 'two inspections cannot claim the same inferred count');
  item.qc.pop();
  item.hitungFisik.push({ ...item.hitungFisik[0], id: 'count2' });
  item.jahit[0].jumlah = item.jahit[0].lolos = 80;
  item.potong[0].jumlah = item.assignJahit[0].qty = 80;
  assert.throws(() => run([item]), /tautan hitung fisik yang pasti/, 'two equal candidate counts remain ambiguous');
});

test('exact full-cycle mirrors import once and retain every archive alias', () => {
  const s = sku(); s.arsip = [{ ...JSON.parse(JSON.stringify(s)), id: 'archive1' }];
  const result = run([s]);
  assert.equal(result.rows.PO.length, 1);
  assert.equal(result.rows.SlipSetor.length, 1);
  assert.equal(result.rows.SlipSetor[0].total, 40);
  assert.equal(JSON.parse(result.rows.PO[0].imporSumber).aliases[0].siklus, 'archive:archive1');
  assert.equal(JSON.parse(result.rows.SlipSetor[0].imporSumber).aliases.length, 1);
  assert.equal(result.info.duplikat, 1);
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

test('real old BigSeller evidence keeps a separate ledger discrepancy without fabricating inspection', () => {
  const s = sku({ bsInputs: [{ id: 'bs001', tanggal: '2026-10-05', qty: 40 }] });
  const result = run([s]);
  assert.equal(result.rows.Gudang[0].total, 40);
  assert.equal(result.rows.Gudang[0].workflowVersion, 1);
  assert.equal(JSON.parse(result.rows.Gudang[0].imporSumber).field, 'bsInputs');
  assert.equal(result.rows.QC.length, 0);
  const flow = run([s], 'coreWorkflow(result.rows.PO,result.rows.Potong,result.rows.SlipKirim,result.rows.SlipSetor,result.rows.QC,result.rows.Gudang,{gudangLama:result.rows.GudangLama})[result.rows.PO[0].id]');
  assert.equal(flow.issues.length, 0);
  assert.ok(flow.ledgerIssues.length > 0);
});

test('verified imported paid counts remain paid', () => {
  const s = inspected(); s.hitungFisik[0].dibayar = true;
  const pay = run([s], 'corePayroll(result.rows.Potong, result.rows.SlipSetor, result.rows.QC, []).filter(function(r){return r.jenis === "jahit";})');
  assert.equal(pay[0].available, 0);
  assert.equal(pay[0].legacyPaid, true);
});

test('explicitly linked legacy QC cannot reopen a paid count as new earnings', () => {
  const item = inspected(); delete item.qc[0].workflowVersion; delete item.hitungFisik[0].workflowVersion; delete item.hitungFisik[0].countStage;
  item.hitungFisik[0].dibayar = true;
  const pay = run([item], 'corePayroll(result.rows.Potong,result.rows.SlipSetor,result.rows.QC,[],{gudangLama:result.rows.GudangLama}).filter(function(r){return r.jenis==="jahit";})');
  assert.equal(pay.reduce((sum, r) => sum + r.available, 0), 0);
});

test('legacy manual QC remains independent evidence and never creates a physical count', () => {
  const item = sku({ hitungFisik: [], qc: [{ id: 'oldqc01', tanggal: '2026-10-03', tukangId: 'worker1', ok: 35, reject: 5, payroll: { workerId: 'worker1', rate: 2300 } }] });
  const result = run([item]);
  assert.equal(result.rows.QC.length, 1);
  assert.equal(result.rows.QC[0].setorId, '');
  assert.equal(result.rows.QC[0].workflowVersion, 1);
  assert.equal(result.rows.QC[0].upah, 2300);
  assert.equal(JSON.parse(result.rows.QC[0].imporSumber).entryId, 'oldqc01');
  assert.equal(result.rows.SlipSetor.filter(r => r.status === 'diterima').length, 0);
  const pay = run([item], 'corePayroll(result.rows.Potong,result.rows.SlipSetor,result.rows.QC,[],{gudangLama:result.rows.GudangLama}).filter(function(r){return r.jenis==="jahit";})');
  assert.equal(pay.reduce((sum, r) => sum + r.total, 0), 35);
  assert.equal(pay[0].rate, 2300);
  item.qc[0].hfId = 'missing';
  assert.throws(() => run([item]), /tautan hitung fisik yang pasti/, 'an explicit absent count must never become manual QC');
});

test('manual legacy warehouse stays distinct from BigSeller and contributes only its real eligible stock', () => {
  const item = sku({ hitungFisik: [], gudang: [{ id: 'manual01', tanggal: '2026-10-03', tukangJahit: 'Ali', jumlah: 40, status: 'ok', payroll: { workerId: 'worker1', rate: 2300 } }],
    bsInputs: [{ id: 'bs001', tanggal: '2026-10-04', qty: 15 }] });
  const result = run([item]);
  assert.equal(result.rows.GudangLama.length, 1);
  assert.equal(result.rows.GudangLama[0].total, 40);
  assert.equal(result.rows.Gudang[0].total, 15);
  assert.equal(result.rows.QC.length, 0);
  assert.equal(result.rows.SlipSetor.filter(r => r.status === 'diterima').length, 0);
  assert.equal(JSON.parse(result.rows.GudangLama[0].imporSumber).entryId, 'manual01');
  const pay = run([item], 'corePayroll(result.rows.Potong,result.rows.SlipSetor,result.rows.QC,[],{gudangLama:result.rows.GudangLama}).filter(function(r){return r.jenis==="jahit";})');
  assert.equal(pay.reduce((sum, r) => sum + r.total, 0), 40);
  item.gudang[0].qcId = 'missing';
  assert.throws(() => run([item]), /menunjuk QC yang hilang/);
});

test('partial physical counts leave one worker aggregate pending without guessing report attribution', () => {
  const item = sku();
  item.jahit = [{ ...item.jahit[0], jumlah: 20, lolos: 20 }, { ...item.jahit[0], id: 'sew002', tanggal: '2026-10-03', jumlah: 20, lolos: 20 }];
  item.hitungFisik[0].jumlah = 30;
  const result = run([item]);
  const accepted = result.rows.SlipSetor.filter(r => r.status === 'diterima'), pending = result.rows.SlipSetor.filter(r => r.status === 'diajukan');
  assert.equal(accepted.length, 1); assert.equal(accepted[0].total, 30); assert.equal(accepted[0].upah, 2500);
  assert.equal(pending.length, 1); assert.equal(pending[0].total, 10); assert.equal(pending[0].upah, 0); assert.equal(pending[0].upahId, '');
  const provenance = JSON.parse(pending[0].imporSumber);
  assert.deepEqual(provenance.reportIds, ['id:sew001', 'id:sew002']);
  assert.equal(provenance.reportedGood, 40); assert.equal(provenance.counted, 30);
  item.hitungFisik[0].jumlah = 41;
  assert.throws(() => run([item]), /Hitungan melampaui laporan/);
});

test('overlapping archive subsets and conflicting receipts stay out of review-mode valid rows', () => {
  const item = sku();
  item.arsip = [{ ...JSON.parse(JSON.stringify(item)), id: 'archive1', potong: [{ ...item.potong[0], id: 'differentcut' }] }];
  assert.throws(() => run([item]), /muncul dalam beberapa siklus/);
  const reviewed = run([item], 'result', {}, { preserveReview: true });
  assert.equal(reviewed.rows.PO.length, 0);
  assert.equal(reviewed.rows.SlipSetor.length, 0);
  assert.equal(reviewed.info.review.length, 2);
  assert.ok(reviewed.info.requiresReview);
  assert.ok(reviewed.info.review.every(r => r.source.hitungFisik[0].jumlah === 40));
  item.arsip[0].potong = JSON.parse(JSON.stringify(item.potong));
  item.arsip[0].hitungFisik[0].tanggal = '2026-10-02';
  assert.throws(() => run([item]), /muncul dalam beberapa siklus/);
});

test('review planning rolls back a failed cycle completely and preserves its original evidence', () => {
  const bad = sku(), good = sku({ id: 'sku002', size: 'L' }); bad.hitungFisik[0].jumlah = 41;
  assert.throws(() => run([bad, good]), /Hitungan melampaui laporan/);
  const result = run([bad, good], 'result', {}, { preserveReview: true });
  assert.equal(result.rows.PO.length, 1);
  assert.equal(result.rows.PO[0].ukuran.M, undefined);
  assert.equal(result.info.review.length, 1);
  assert.equal(result.info.review[0].source.hitungFisik[0].jumlah, 41);
  assert.ok(result.info.lineage.every(r => r.poId === result.rows.PO[0].id));
  for (const table of ['Potong', 'SlipKirim', 'SlipSetor', 'QC', 'Gudang', 'GudangLama']) assert.ok(result.rows[table].every(r => r.poId === result.rows.PO[0].id));
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
