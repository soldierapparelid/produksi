'use strict';
/* 1.5.76: tombol OK pada slip yang sudah dihitung, khusus owner/admin. Hasil QC tercatat dengan aturan Input QC dan,
   untuk PO stok, jumlah OK langsung tercatat masuk BigSeller dalam permintaan yang sama. Upah tetap mengikuti OK QC.
   Server lewat adaptor Apps Script asli (tests/helpers/apps-script-harness.cjs); layar lewat potongan index.html.
   Data karangan saja. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');
const root = path.resolve(__dirname, '..'), html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const plain = x => JSON.parse(JSON.stringify(x));
const sum = u => Object.values(u).reduce((a, b) => a + b, 0);

/* ---------------- server ---------------- */
function fixture() {
  const h = harness();
  for (const name of ['bahan-invoice', 'cutting-plans', 'auto-completion', 'reconcile-legacy', 'history-corrections']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src', name + '.js'), 'utf8'), h.context);
  }
  const setup = h.request('setupOwner', { nama: 'Fixture Owner', pin: '1234' });
  assert.equal(setup.ok, true, setup.error);
  const owner = setup.data.token, admin = 'fixture-okbs-admin-token', sewer = 'fixture-okbs-sewer-token', qc = 'fixture-okbs-qc-token';
  const sizes = { 'okbs-po-stok1': { M: 30, L: 20 }, 'okbs-po-pes01': { M: 10 }, 'okbs-po-lain1': { M: 15 } };
  function count(id, no, poId, tanggal, ukuran) {
    return { id: id, noSlip: no, poId: poId, maklonId: 'okbssewer01', tanggal: tanggal, ukuran: JSON.stringify(ukuran), total: sum(ukuran), upah: 3000, status: 'diterima', workflowVersion: 2, dibuat: tanggal + 'T09:00:00.000Z' };
  }
  const rows = {
    Pegawai: [
      { id: 'okbsadmin01', nama: 'Fixture Admin', divisi: 'admin', aktif: true, token: admin },
      { id: 'okbssewer01', nama: 'Fixture Sewer', divisi: 'jahit', aktif: true, token: sewer, pin: 'fixture-pin-hash' },
      { id: 'okbsqc00001', nama: 'Fixture QC', divisi: 'qc', aktif: true, token: qc, pin: 'fixture-pin-hash' },
      { id: 'okbscut0001', nama: 'Fixture Cutter', divisi: 'potong', aktif: true }
    ],
    PO: [
      { id: 'okbs-po-stok1', noPO: 'PO-OK1', jenis: 'stok', nama: 'Kaos Fixture', ukuran: '{"M":30,"L":20}', total: 50, status: 'aktif', dibuat: '2026-08-01T00:00:00.000Z' },
      { id: 'okbs-po-pes01', noPO: 'PO-OK2', jenis: 'pesanan', pelanggan: 'Toko Fixture', nama: 'Seragam Fixture', ukuran: '{"M":10}', total: 10, status: 'aktif', dibuat: '2026-08-01T00:00:00.000Z' },
      { id: 'okbs-po-lain1', noPO: 'PO-OK3', jenis: 'stok', nama: 'Polo Fixture', ukuran: '{"M":15}', total: 15, status: 'aktif', dibuat: '2026-08-01T00:00:00.000Z' }
    ],
    Potong: Object.keys(sizes).map((poId, i) => ({ id: 'okbs-cut-000' + (i + 1), poId: poId, userId: 'okbscut0001', tanggal: '2026-08-02', ukuran: JSON.stringify(sizes[poId]), total: sum(sizes[poId]), tarif: 1000, dibuat: '2026-08-02T00:00:00.000Z' })),
    SlipKirim: Object.keys(sizes).map((poId, i) => ({ id: 'okbs-send-00' + (i + 1), noSlip: 'SK-OK' + (i + 1), poId: poId, maklonId: 'okbssewer01', tanggal: '2026-08-03', ukuran: JSON.stringify(sizes[poId]), total: sum(sizes[poId]), upah: 3000, dibuat: '2026-08-03T00:00:00.000Z' })),
    SlipSetor: [
      count('okbs-cnt-0001', 'SS-OK1', 'okbs-po-stok1', '2026-08-10', { M: 20, L: 10 }),
      count('okbs-cnt-0002', 'SS-OK2', 'okbs-po-stok1', '2026-08-11', { M: 10, L: 10 }),
      count('okbs-cnt-0003', 'SS-OK3', 'okbs-po-pes01', '2026-08-10', { M: 10 }),
      count('okbs-cnt-0004', 'SS-OK4', 'okbs-po-lain1', '2026-08-10', { M: 15 })
    ]
  };
  h.run('pkStore_().lock(function(){var rows=' + JSON.stringify(rows) + ';Object.keys(rows).forEach(function(t){pkStore_().appendMany(t,rows[t]);});return true;})');
  function call(action, payload = {}, token = owner) { h.cold(); return h.request(action, Object.assign({ token: token, workflowVersion: 2 }, payload)); }
  function good(action, payload = {}, token = owner) { const r = call(action, payload, token); assert.equal(r.ok, true, r.error); return r.data && r.data.data !== undefined ? r.data.data : r.data; }
  function raw(table) { h.cold(); return h.run('pkStore_().fresh(' + JSON.stringify(table) + ');pkStore_().read(' + JSON.stringify(table) + ')'); }
  const isi = { id: 'okbs-req-0001', poId: 'okbs-po-stok1', setorId: 'okbs-cnt-0001', tanggal: '2026-08-12', ukuran: { M: 18, L: 10 }, rejectUkuran: { M: 1 }, reject: 1, perbaikanUkuran: { M: 1 }, perbaikan: 1, catatan: 'Dicek admin' };
  const ok = (extra = {}, token = admin) => call('qcMasukBigSeller', { qc: Object.assign({}, isi, extra) }, token);
  const state = (token = owner) => good('getState', { semua: true }, token);
  const poState = id => state().po.find(p => p.id === id);
  const bsId = id => h.run('coreQcBigSellerId(' + JSON.stringify(id) + ')');
  return { h, owner, admin, sewer, qc, isi, call, good, raw, ok, state, poState, bsId };
}

test('only the owner and admin may press OK; QC staff and tailors are refused, and QC staff keep their own Input QC', () => {
  const f = fixture();
  for (const token of [f.qc, f.sewer]) { const r = f.ok({}, token); assert.equal(r.ok, false, 'must refuse'); assert.match(r.error, /Hanya owner\/admin/); }
  assert.equal(f.raw('QC').length, 0); assert.equal(f.raw('Gudang').length, 0, 'a refused OK writes nothing');
  const byOwner = f.ok({ id: 'okbs-req-own1', setorId: 'okbs-cnt-0002', ukuran: { M: 10, L: 10 }, rejectUkuran: {}, reject: 0, perbaikanUkuran: {}, perbaikan: 0, catatan: '' }, f.owner);
  assert.equal(byOwner.ok, true, byOwner.error);
  const byAdmin = f.ok(); assert.equal(byAdmin.ok, true, byAdmin.error);
  const staff = f.call('createQC', { qc: { id: 'okbs-req-staf', poId: 'okbs-po-lain1', setorId: 'okbs-cnt-0004', tanggal: '2026-08-12', ukuran: { M: 15 } } }, f.qc);
  assert.equal(staff.ok, true, staff.error);
  assert.deepEqual(f.raw('QC').map(q => q.id).sort(), ['okbs-req-0001', 'okbs-req-own1', 'okbs-req-staf']);
  assert.deepEqual(f.raw('Gudang').map(g => g.id).sort(), [f.bsId('okbs-req-0001'), f.bsId('okbs-req-own1')].sort(), 'Input QC by QC staff adds no BigSeller row');
});

test('OK writes the QC row like Input QC and, on a stock PO, one BigSeller row with exactly the OK sizes', () => {
  const f = fixture();
  const res = f.ok(); assert.equal(res.ok, true, res.error);
  const out = res.data.data, qcRows = f.raw('QC'), gd = f.raw('Gudang');
  assert.equal(qcRows.length, 1); assert.equal(gd.length, 1);
  const q = qcRows[0], g = gd[0];
  assert.deepEqual([q.id, q.poId, q.setorId, q.maklonId, q.userId, q.tanggal, q.total, q.reject, q.perbaikan, q.offline, q.repairQcId, q.catatan, q.workflowVersion],
    ['okbs-req-0001', 'okbs-po-stok1', 'okbs-cnt-0001', 'okbssewer01', 'okbsadmin01', '2026-08-12', 28, 1, 1, 0, '', 'Dicek admin', 2]);
  assert.deepEqual([JSON.parse(q.ukuran), JSON.parse(q.rejectUkuran), JSON.parse(q.perbaikanUkuran)], [{ M: 18, L: 10 }, { M: 1 }, { M: 1 }]);
  assert.equal(g.id, f.bsId('okbs-req-0001')); assert.match(g.id, /^qbs_[A-Za-z0-9]{2,14}$/);
  assert.deepEqual([g.poId, g.userId, g.tanggal, JSON.parse(g.ukuran), g.total, g.catatan, g.requestActor, g.requestHash],
    ['okbs-po-stok1', 'okbsadmin01', '2026-08-12', { M: 18, L: 10 }, 28, 'Otomatis dari OK QC', 'okbsadmin01', q.requestHash]);
  assert.deepEqual([out.qc.id, out.gudang.id], ['okbs-req-0001', g.id]);
  /* the same columns that Input BigSeller fills */
  f.good('createQC', { qc: { id: 'okbs-req-lain', poId: 'okbs-po-lain1', setorId: 'okbs-cnt-0004', tanggal: '2026-08-12', ukuran: { M: 15 } } }, f.qc);
  f.good('createGudang', { gudang: { id: 'okbs-gudang-01', poId: 'okbs-po-lain1', tanggal: '2026-08-12', ukuran: { M: 5 }, catatan: 'manual' } }, f.admin);
  const filled = row => Object.keys(row).filter(k => row[k] !== '' && row[k] !== 0).sort();
  assert.deepEqual(filled(g), filled(f.raw('Gudang').find(r => r.id === 'okbs-gudang-01')));
  /* the PO: all 28 OK pieces are in BigSeller; the second slip still waits */
  const p = f.poState('okbs-po-stok1');
  assert.deepEqual([p.agg.total.qcOk, p.agg.total.bigseller, p.agg.total.stok], [28, 28, 0]);
  assert.deepEqual([p.workflow.ukuran.M.stok, p.workflow.ukuran.L.stok, p.workflow.ukuran.M.siapQC, p.workflow.ukuran.L.siapQC, p.workflow.ukuran.M.qcPerbaikan], [0, 0, 10, 10, 1]);
  assert.deepEqual(p.workflow.issues, []);
});

test('a retry with the same id and content writes nothing, a lost BigSeller row is added once, other content is refused', () => {
  const f = fixture();
  const first = f.ok(); assert.equal(first.ok, true, first.error);
  const version = f.h.run('pkStore_().version()');
  const again = f.ok(); assert.equal(again.ok, true, again.error);
  assert.deepEqual([again.data.data.qc.id, again.data.data.gudang.id], ['okbs-req-0001', f.bsId('okbs-req-0001')]);
  assert.equal(f.h.run('pkStore_().version()'), version, 'the retry writes nothing');
  assert.equal(f.raw('QC').length, 1); assert.equal(f.raw('Gudang').length, 1);
  /* the QC row was saved but its BigSeller row is missing: the same request adds only that row */
  f.good('deleteRecord', { sheet: 'Gudang', id: f.bsId('okbs-req-0001') }, f.admin);
  assert.equal(f.raw('Gudang').length, 0);
  const repaired = f.ok(); assert.equal(repaired.ok, true, repaired.error);
  assert.equal(f.raw('QC').length, 1, 'no second QC row'); assert.equal(f.raw('Gudang').length, 1, 'the BigSeller row is back once');
  assert.deepEqual([f.raw('Gudang')[0].id, JSON.parse(f.raw('Gudang')[0].ukuran)], [f.bsId('okbs-req-0001'), { M: 18, L: 10 }]);
  assert.equal(f.ok().ok, true); assert.equal(f.raw('Gudang').length, 1);
  /* same id with other content, by another person, or through Input QC: refused */
  assert.match(f.ok({ ukuran: { M: 17, L: 10 } }).error, /permintaan berbeda/);
  assert.match(f.ok({}, f.owner).error, /permintaan berbeda/);
  assert.match(f.call('createQC', { qc: f.isi }, f.admin).error, /permintaan berbeda/);
  assert.equal(f.raw('QC').length, 1); assert.equal(f.raw('Gudang').length, 1);
});

test('an order (pesanan) gets QC only, an all-reject OK writes no BigSeller row, and a fully OK order is finished', () => {
  const f = fixture();
  const order = f.ok({ id: 'okbs-req-pes1', poId: 'okbs-po-pes01', setorId: 'okbs-cnt-0003', ukuran: { M: 10 }, rejectUkuran: {}, reject: 0, perbaikanUkuran: {}, perbaikan: 0 });
  assert.equal(order.ok, true, order.error); assert.equal(order.data.data.gudang, null);
  const rejected = f.ok({ id: 'okbs-req-rej1', setorId: 'okbs-cnt-0002', ukuran: {}, rejectUkuran: { M: 10, L: 10 }, reject: 20, perbaikanUkuran: {}, perbaikan: 0 });
  assert.equal(rejected.ok, true, rejected.error); assert.equal(rejected.data.data.gudang, null);
  assert.equal(f.raw('QC').length, 2); assert.equal(f.raw('Gudang').length, 0);
  assert.equal(f.poState('okbs-po-pes01').workflow.complete, true);
});

test('OK refuses repairs, offline pieces, more than the slip, an empty result, a wrong slip, an early date and an old app', () => {
  const f = fixture();
  const cases = [
    [{ repairQcId: 'okbs-req-xxxx' }, /perbaikan dicatat lewat Input QC/],
    [{ dariPerbaikan: true }, /perbaikan dicatat lewat Input QC/],
    [{ offlineUkuran: { M: 1 }, offline: 1 }, /offline dicatat lewat Input QC/],
    [{ ukuran: { M: 21, L: 10 }, rejectUkuran: {}, reject: 0, perbaikanUkuran: {}, perbaikan: 0 }, /melebihi sisa hitungan slip ini \(20 pcs\)/],
    [{ ukuran: { M: 19, L: 10 } }, /melebihi sisa hitungan slip ini \(20 pcs\)/],
    [{ ukuran: {}, rejectUkuran: {}, reject: 0, perbaikanUkuran: {}, perbaikan: 0 }, /Isi jumlah pcs hasil QC/],
    [{ setorId: 'okbs-cnt-0003' }, /slip hitung fisik yang sudah diterima/],
    [{ tanggal: '2026-08-09' }, /sebelum tanggal hitung fisik/],
    [{ id: 'x' }, /Identitas penyimpanan tidak sah/],
    [{ poId: 'okbs-po-none1' }, /PO tidak ditemukan/]
  ];
  for (const [extra, pattern] of cases) { const r = f.ok(extra); assert.equal(r.ok, false, JSON.stringify(extra)); assert.match(r.error, pattern); }
  const old = f.call('qcMasukBigSeller', { qc: f.isi, workflowVersion: 1 }, f.admin);
  assert.equal(old.ok, false); assert.match(old.error, /Versi alur produksi tidak cocok/);
  assert.equal(f.raw('QC').length, 0); assert.equal(f.raw('Gudang').length, 0);
});

test('wages follow QC OK exactly like Input QC, and every unrelated wage row stays the same', () => {
  const a = fixture(), b = fixture();
  const before = b.state().payroll;
  a.good('createQC', { qc: a.isi }, a.admin);
  b.good('qcMasukBigSeller', { qc: b.isi }, b.admin);
  const pa = a.state().payroll, pb = b.state().payroll;
  assert.deepEqual(pb, pa, 'the same wage rows as Input QC with the same result');
  const lain = rows => rows.filter(r => r.sourceId !== 'okbs-cnt-0001');
  assert.ok(lain(before).length >= 6, 'cutting and the other slips are in the list');
  assert.deepEqual(lain(pb), lain(before), 'cutting and the other slips are untouched');
  const slip = pb.filter(r => r.sourceId === 'okbs-cnt-0001').map(r => [r.size, r.total, r.rate]).sort();
  assert.deepEqual(slip, [['L', 10, 3000], ['M', 18, 3000]], 'M pays the 18 OK; the reject and the piece in repair wait, as with Input QC');
  assert.deepEqual(before.filter(r => r.sourceId === 'okbs-cnt-0001').map(r => [r.size, r.total]).sort(), [['L', 10], ['M', 20]]);
});

/* ---------------- layar ---------------- */
function part(a, b) { const p = html.indexOf(a), q = html.indexOf(b, p + a.length); assert.ok(p >= 0 && q > p, a); return html.slice(p, q); }
const run = (c, s) => vm.runInContext(s, c);
function ui() {
  const c = vm.createContext({ console, Promise, setTimeout });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core.js'), 'utf8'), c);
  vm.runInContext([
    "var A = {}, R = {}, S = { state: { settings: { ukuran: ['M', 'L', 'XL'] }, po: [], setor: [], qc: [], gudang: [] } }, D = { po: {}, user: { mk1: { nama: 'Mang Uji' } } };",
    "var admin = true, sheet = '', messages = [], calls = [], dropped = 0, current = null, reply = function () { return Promise.resolve({}); };",
    "function isAdmin() { return admin; }",
    "function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\"/g, '&quot;'); }",
    "function nf(n) { return String(n || 0); } function tgl(s) { return String(s); } function ic(n) { return '<i data-ic=\"' + n + '\"></i>'; } function pos(n) { return n > 0 ? n : 0; }",
    "function namaUser(id) { return (D.user[id] || {}).nama || '?'; } function emptyBox(t) { return '<div class=\"empty\">' + t + '</div>'; }",
    "function sizeChips(u) { return coreSizeOrder(Object.keys(u || {}), S.state.settings.ukuran).map(function (k) { return '<span class=\"sz\"><b>' + k + '</b>' + u[k] + '</span>'; }).join(' '); }",
    "function findSlip(t, id) { return S.state.setor.filter(function (r) { return r.id === id; })[0] || null; }",
    "function T(po) { return (po.agg && po.agg.total) || {}; } function workflowFor(po) { return po && po.workflow || { ukuran: {}, issues: [], complete: false, readyQC: false }; }",
    "function repairQueue() { return []; }",
    "function toast(m, e) { messages.push([m, !!e]); } function openSheet(fn) { sheet = fn(); }",
    "function sheetHtml(t, b, f) { return t + '|' + b + '|' + (f || ''); } function hid(k, v) { return '<input type=\"hidden\" name=\"' + k + '\" value=\"' + esc(v) + '\">'; }",
    "function poHead(po) { return '<div class=\"po-head\">' + esc(po.nama) + '</div>'; } function sumLine(l) { return '<div class=\"sum-line\">' + l + '</div>'; }",
    "function fTanggal(l, n) { return '<input type=\"date\" name=\"' + n + '\" value=\"2026-11-04\">'; } function fCatatan() { return '<textarea name=\"catatan\"></textarea>'; }",
    "function footSave(a, l) { return '<button class=\"btn pri\" data-a=\"' + a + '\">' + (l || 'Simpan') + '</button>'; }",
    "function newId() { return 'req-okbs-01'; } function topForm() { return current; } function formVals(f) { return Object.assign({}, f.vals); }",
    "function $$(sel, root) { return sel === '[data-qc-row]' ? root.rows : sel === 'input[data-qc-size]' || sel === '[data-qc-size]' ? root.inputs : []; }",
    "function $(sel, root) { return sel === '[data-okbs-sisa]' ? root.note : null; }",
    "function act(el, p) { return p; } function quiet() {} function dropForm() { dropped++; }",
    "function req(action, payload) { calls.push({ action: action, payload: JSON.parse(JSON.stringify(payload)) }); return reply(); }"
  ].join('\n'), c);
  vm.runInContext(part('function categorySizes(', 'function repairQueue('), c);
  vm.runInContext(part('function qcBalance(', 'function stagesHtml('), c);
  vm.runInContext(part('function qcValues(', 'function qcCombinedGroups('), c);
  vm.runInContext(part('/* ---------- 1.5.76: OK QC & masuk BigSeller', '/* ---------- akhir OK QC & masuk BigSeller'), c);
  vm.runInContext(part('var TAHAP_OPSI =', 'function poMasukTahap('), c);
  return c;
}
/* PO 'p1': two counted slips, SS-1 (M 20, L 10) and SS-2 (M 10, L 10); hitung() recomputes the workflow as the server does */
function seed(c, jenis) {
  run(c, [
    "var po = { id: 'p1', noPO: 'PO-9', nama: 'Kaos Uji', status: 'aktif', jenis: '" + jenis + "', ukuran: { M: 30, L: 20 } };",
    "var cuts = [{ id: 'cut1', poId: 'p1', userId: 'pt1', ukuran: { M: 30, L: 20 }, total: 50, tanggal: '2026-11-01' }];",
    "var sends = [{ id: 'send1', poId: 'p1', maklonId: 'mk1', ukuran: { M: 30, L: 20 }, total: 50, tanggal: '2026-11-01' }];",
    "var counts = [{ id: 'cnt1', noSlip: 'SS-1', poId: 'p1', maklonId: 'mk1', status: 'diterima', ukuran: { M: 20, L: 10 }, total: 30, tanggal: '2026-11-02' },",
    "  { id: 'cnt2', noSlip: 'SS-2', poId: 'p1', maklonId: 'mk1', status: 'diterima', ukuran: { M: 10, L: 10 }, total: 20, tanggal: '2026-11-03' }];",
    "function hitung() { po.workflow = coreWorkflow([po], cuts, sends, counts, S.state.qc, S.state.gudang).p1; po.agg = coreAggregate([po], cuts, sends, counts, S.state.qc, S.state.gudang).p1; }",
    "D.po = { p1: po }; S.state.po = [po]; S.state.setor = counts; S.state.qc = []; S.state.gudang = []; hitung();"
  ].join('\n'));
}
function formFrom(sheet) {
  const vals = { tanggal: '2026-11-04', catatan: '' };
  for (const m of sheet.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) vals[m[1]] = m[2];
  const inputs = [...sheet.matchAll(/value="(\d*)" placeholder="0" data-qc-size="([^"]+)" data-qc-kind="([^"]+)"/g)].map(m => ({ value: m[1], size: m[2], kind: m[3] }));
  inputs.forEach(i => { i.getAttribute = k => k === 'data-qc-size' ? i.size : k === 'data-qc-kind' ? i.kind : null; });
  const rows = [...sheet.matchAll(/data-qc-row="([^"]+)" data-expected="(\d+)"/g)].map(m => {
    const r = { size: m[1], expected: m[2], note: { textContent: '', className: '' } };
    r.inputs = inputs.filter(i => i.size === r.size);
    r.getAttribute = k => k === 'data-qc-row' ? r.size : k === 'data-expected' ? r.expected : null;
    return r;
  });
  return { vals, inputs, rows };
}
const setValue = (form, size, kind, value) => { form.inputs.find(i => i.size === size && i.kind === kind).value = value; };

test('the PO sheet lists counted slips not yet in BigSeller, each with its own OK button, for owner and admin only', () => {
  const c = ui(); seed(c, 'stok');
  assert.deepEqual(plain(run(c, 'poTahap(po)')), { k: 'qc', label: 'QC · belum masuk BigSeller', cls: 'info' });
  assert.deepEqual(plain(run(c, 'TAHAP_OPSI')).find(o => o[0] === 'qc'), ['qc', 'QC · menunggu OK'], 'the stage filter covers stock and orders');
  let panel = run(c, 'okBsPanel(po)');
  assert.match(panel, /<div class="label">Belum masuk BigSeller · 50 pcs<\/div>/);
  assert.equal(panel.split('data-a="okBsOpen"').length - 1, 2, 'one OK button per counted slip');
  assert.match(panel, /<b>SS-1<\/b> <span class="small muted">Mang Uji · 2026-11-02<\/span>/);
  assert.match(panel, /<span class="sz"><b>M<\/b>20<\/span> <span class="sz"><b>L<\/b>10<\/span><span class="chip warn">Harus catat BigSeller<\/span>/);
  assert.match(panel, /<button class="btn pri sm" data-a="okBsOpen" data-id="p1" data-s="cnt1">OK, sudah QC &amp; masuk BigSeller<\/button>/);
  assert.match(panel, /Barang offline atau hasil perbaikan: pakai Input QC\./);
  assert.doesNotMatch(panel, /Sudah QC/);
  /* SS-2 confirmed with OK (QC row plus its BigSeller row); SS-1 partly checked by QC staff, without BigSeller */
  run(c, "S.state.qc = [{ id: 'qc-ok-2', poId: 'p1', setorId: 'cnt2', maklonId: 'mk1', userId: 'adm', tanggal: '2026-11-04', ukuran: { M: 10, L: 9 }, total: 19, reject: 1, rejectUkuran: JSON.stringify({ L: 1 }), dibuat: '2026-11-04T09:00:00Z' }," +
    " { id: 'qc-staf-1', poId: 'p1', setorId: 'cnt1', maklonId: 'mk1', userId: 'qc1', tanggal: '2026-11-04', ukuran: { M: 5 }, total: 5, dibuat: '2026-11-04T10:00:00Z' }];" +
    " S.state.gudang = [{ id: coreQcBigSellerId('qc-ok-2'), poId: 'p1', tanggal: '2026-11-04', ukuran: { M: 10, L: 9 }, total: 19, catatan: 'Otomatis dari OK QC' }]; hitung();");
  panel = run(c, 'okBsPanel(po)');
  assert.match(panel, /Belum masuk BigSeller · 25 pcs/);
  assert.equal(panel.split('data-a="okBsOpen"').length - 1, 1); assert.match(panel, /data-s="cnt1"/);
  assert.match(panel, /<div class="label">Sudah QC &amp; masuk BigSeller<\/div>/);
  assert.match(panel, /<b>SS-2<\/b> · Mang Uji · 2026-11-04 · OK 19 pcs · reject 1<\/div>/);
  assert.doesNotMatch(panel, /OK 5 pcs/, 'an Input QC entry without BigSeller is not shown as in BigSeller');
  assert.deepEqual([run(c, 'po.agg.total.bigseller'), run(c, 'po.agg.total.qcOk')], [19, 24]);
  /* every slip confirmed: nothing waits and the stage moves on */
  run(c, "S.state.qc.push({ id: 'qc-ok-1', poId: 'p1', setorId: 'cnt1', maklonId: 'mk1', userId: 'adm', tanggal: '2026-11-04', ukuran: { M: 15, L: 10 }, total: 25, dibuat: '2026-11-04T11:00:00Z' });" +
    " S.state.gudang.push({ id: coreQcBigSellerId('qc-ok-1'), poId: 'p1', tanggal: '2026-11-04', ukuran: { M: 15, L: 10 }, total: 25 }); hitung();");
  panel = run(c, 'okBsPanel(po)');
  assert.doesNotMatch(panel, /okBsOpen|Belum masuk BigSeller/);
  assert.equal(panel.split('<div class="small">').length - 1, 2);
  assert.equal(run(c, 'po.workflow.complete'), true); assert.equal(run(c, 'poTahap(po).label'), 'Produksi selesai');
  /* not for QC staff or workers */
  run(c, 'admin = false;'); assert.equal(run(c, 'okBsPanel(po)'), '');
});

test('an order (pesanan) is labelled QC and OK, without BigSeller', () => {
  const c = ui(); seed(c, 'pesanan');
  assert.equal(run(c, 'poTahap(po).label'), 'QC · menunggu OK');
  const panel = run(c, 'okBsPanel(po)');
  assert.match(panel, /<div class="label">Menunggu OK · 50 pcs<\/div>/);
  assert.match(panel, /data-s="cnt1">OK, sudah QC<\/button>/);
  assert.doesNotMatch(panel, /BigSeller/);
});

test('OK opens a small form with OK filled to what is left, checks the numbers and keeps one request id across retries', async () => {
  const c = ui(); seed(c, 'stok');
  const el = '({ getAttribute: function (k) { return k === "data-id" ? "p1" : k === "data-s" ? "cnt1" : ""; } })';
  run(c, 'admin = false; A.okBsOpen(' + el + ')');
  assert.equal(c.sheet, ''); assert.deepEqual(plain(c.messages.pop()), ['Hanya owner atau admin yang boleh menekan OK.', true]);
  run(c, 'admin = true; A.okBsOpen(' + el + ')');
  const sheet = c.sheet;
  assert.match(sheet, /^OK, sudah QC & masuk BigSeller\|/);
  assert.match(sheet, /name="id" value="req-okbs-01"[\s\S]*name="poId" value="p1"[\s\S]*name="setorId" value="cnt1"/);
  assert.match(sheet, /<b>SS-1<\/b> · Mang Uji · dihitung 2026-11-02<br>/);
  assert.match(sheet, /Jumlah OK langsung tercatat masuk BigSeller\. Upah jahit mengikuti jumlah OK\./);
  assert.match(sheet, /data-a="okBsSave">Simpan OK<\/button>$/);
  const form = formFrom(sheet);
  assert.deepEqual(form.inputs.map(i => [i.size, i.kind, i.value]), [['M', 'ok', '20'], ['M', 'reject', ''], ['M', 'perbaikan', ''], ['L', 'ok', '10'], ['L', 'reject', ''], ['L', 'perbaikan', '']]);
  c.current = form;
  run(c, 'R.okBs(current)'); assert.deepEqual([form.rows[0].note.textContent, form.rows[0].note.className], ['Pas dengan sisa slip.', 'xs ok']);
  setValue(form, 'M', 'reject', '1'); run(c, 'R.okBs(current)');
  assert.deepEqual([form.rows[0].note.textContent, form.rows[0].note.className], ['Lebih 1 pcs dari sisa slip.', 'xs bad']);
  run(c, 'A.okBsSave({})'); assert.equal(c.calls.length, 0);
  assert.deepEqual(plain(c.messages.pop()), ['Ukuran M: OK + reject + perbaikan 21 pcs, lebih dari sisa 20 pcs.', true]);
  setValue(form, 'M', 'ok', '0'); setValue(form, 'M', 'reject', ''); setValue(form, 'L', 'ok', '0');
  run(c, 'A.okBsSave({})'); assert.equal(c.calls.length, 0); assert.deepEqual(plain(c.messages.pop()), ['Isi minimal 1 pcs.', true]);
  setValue(form, 'M', 'ok', '19'); setValue(form, 'M', 'reject', '1'); setValue(form, 'L', 'ok', '9'); run(c, 'R.okBs(current)');
  assert.equal(form.rows[1].note.textContent, '1 pcs belum diperiksa, tetap menunggu.');
  /* the first send is lost; pressing again sends the same id and content */
  run(c, "reply = function () { return Promise.reject(new Error('Sinyal putus')); };");
  await run(c, 'A.okBsSave({})');
  assert.equal(c.dropped, 0, 'the form stays open after a failure');
  run(c, 'reply = function () { return Promise.resolve({}); };');
  await run(c, 'A.okBsSave({})');
  const sent = plain(c.calls);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], { action: 'qcMasukBigSeller', payload: { qc: { id: 'req-okbs-01', poId: 'p1', setorId: 'cnt1', tanggal: '2026-11-04', ukuran: { M: 19, L: 9 }, rejectUkuran: { M: 1 }, reject: 1, perbaikanUkuran: {}, perbaikan: 0, catatan: '' } } });
  assert.deepEqual(sent[1], sent[0], 'one request id per form, kept across retries');
  assert.equal(c.dropped, 1); assert.deepEqual(plain(c.messages.pop()), ['Tersimpan. 28 pcs OK sudah masuk BigSeller.', false]);
  /* a slip that is no longer waiting opens nothing to fill */
  run(c, "counts[0].status = 'ditolak'; A.okBsOpen(" + el + ')');
  assert.match(c.sheet, /Slip ini sudah tidak menunggu QC\. Muat ulang data\./); assert.doesNotMatch(c.sheet, /data-form="okBs"/);
});

test('the PO sheet drops both Input BigSeller buttons, shows the OK list, keeps BigSeller history, and the page knows the new action', () => {
  const sheetSrc = part('function poSheet(', 'A.poStatusSet =');
  assert.doesNotMatch(sheetSrc, /data-a="gudangOpen"/);
  assert.match(sheetSrc, /b \+= qcEntryButton\(po, true, true\);/, 'the admin keeps Input QC for offline and repairs, as a normal button');
  assert.match(sheetSrc, /h \+= okBsPanel\(po\);/);
  assert.match(sheetSrc, /cols\.push\(\['BigSeller', 'bigseller', t\.bigseller\]\)/);
  assert.match(sheetSrc, /c: 'c-jual', t: 'Input BigSeller ' \+ nf\(r\.total\) \+ ' pcs'/);
  assert.match(sheetSrc, /Catat setoran, OK sudah QC, Input QC\)/);
  assert.match(html, /A\.gudangOpen = function \(el\) \{ openGudang\(el\.getAttribute\('data-id'\)\); \};/, 'the old form stays in place, unused');
  assert.match(html, /var workflowWrite = \/\^\([^\n]*\|simpanQCGabungan\|qcMasukBigSeller\|createGudang\|/);
  const c = ui(); seed(c, 'stok');
  assert.match(run(c, 'qcEntryButton(po, true, true)'), /^<button class="btn" data-a="qcOpen"/);
  assert.match(run(c, 'qcEntryButton(po, true)'), /^<button class="btn pri" data-a="qcOpen"/, 'QC staff keep their primary Input QC');
});

/* ---------------- 1.5.76: perbaikan dari pemeriksaan ---------------- */
test('deleting an OK QC row also removes its automatic BigSeller row, so a redo is counted once', () => {
  const f = fixture();
  f.good('qcMasukBigSeller', { qc: f.isi }, f.admin);
  assert.deepEqual([f.raw('QC').length, f.raw('Gudang').length], [1, 1]);
  const res = f.good('deleteRecord', { sheet: 'QC', id: 'okbs-req-0001' }, f.admin);
  assert.equal(res.bigSellerDihapus, f.bsId('okbs-req-0001'));
  assert.deepEqual([f.raw('QC').length, f.raw('Gudang').length], [0, 0], 'both rows are gone');
  let p = f.poState('okbs-po-stok1');
  assert.deepEqual([p.agg.total.qcOk, p.agg.total.bigseller, p.agg.total.stok], [0, 0, 0]);
  f.good('qcMasukBigSeller', { qc: Object.assign({}, f.isi, { id: 'okbs-req-0002' }) }, f.admin);
  p = f.poState('okbs-po-stok1');
  assert.deepEqual([p.agg.total.qcOk, p.agg.total.bigseller, p.agg.total.stok], [28, 28, 0], 'the redo is in BigSeller once');
  assert.deepEqual(f.raw('Gudang').map(g => g.id), [f.bsId('okbs-req-0002')]);
  assert.deepEqual(p.workflow.issues, []);
});

test('deleting an Input QC row keeps manual BigSeller rows and still refuses when BigSeller would exceed OK', () => {
  const f = fixture();
  f.good('createQC', { qc: { id: 'okbs-req-staf', poId: 'okbs-po-lain1', setorId: 'okbs-cnt-0004', tanggal: '2026-08-12', ukuran: { M: 15 } } }, f.qc);
  assert.equal(f.poState('okbs-po-lain1').workflow.ukuran.M.stok, 15, 'Input QC OK waits as not yet in BigSeller');
  f.good('createGudang', { gudang: { id: 'okbs-gudang-01', poId: 'okbs-po-lain1', tanggal: '2026-08-12', ukuran: { M: 15 }, catatan: '' } }, f.admin);
  assert.equal(f.poState('okbs-po-lain1').workflow.ukuran.M.stok, 0);
  const lebih = f.call('createGudang', { gudang: { id: 'okbs-gudang-02', poId: 'okbs-po-lain1', tanggal: '2026-08-12', ukuran: { M: 1 } } }, f.admin);
  assert.equal(lebih.ok, false); assert.match(lebih.error, /melebihi OK QC yang belum dicatat/);
  const hapus = f.call('deleteRecord', { sheet: 'QC', id: 'okbs-req-staf' }, f.admin);
  assert.equal(hapus.ok, false); assert.match(hapus.error, /OK QC sudah dicatat ke BigSeller/);
  assert.deepEqual([f.raw('QC').length, f.raw('Gudang').length], [1, 1]);
});

test('OK from Input QC that is not in BigSeller shows on the PO sheet with a button to record it', () => {
  const c = ui(); seed(c, 'stok');
  run(c, "S.state.qc = [{ id: 'qc-staf-1', poId: 'p1', setorId: 'cnt1', maklonId: 'mk1', userId: 'qc1', tanggal: '2026-11-04', ukuran: { M: 5, L: 2 }, total: 7, dibuat: '2026-11-04T10:00:00Z' }]; hitung();");
  const panel = run(c, 'okBsPanel(po)');
  assert.match(panel, /<div class="label">Sudah QC, belum masuk BigSeller · 7 pcs<\/div>/);
  assert.match(panel, /<span class="sz"><b>M<\/b>5<\/span> <span class="sz"><b>L<\/b>2<\/span><\/span><span class="xs muted">Dari Input QC, hasil perbaikan, atau catatan lama\.<\/span>/);
  assert.match(panel, /<button class="btn sm" data-a="gudangOpen" data-id="p1">Catat masuk BigSeller<\/button>/);
  assert.ok(panel.indexOf('Belum masuk BigSeller ·') < panel.indexOf('Sudah QC, belum masuk BigSeller'), 'slips waiting for OK come first');
  /* recorded: the group goes away */
  run(c, "S.state.gudang = [{ id: 'gd-1', poId: 'p1', tanggal: '2026-11-04', ukuran: { M: 5, L: 2 }, total: 7 }]; hitung();");
  assert.doesNotMatch(run(c, 'okBsPanel(po)'), /belum masuk BigSeller|gudangOpen/);
  /* a cancelled PO and non-admins get none */
  run(c, "S.state.gudang = []; hitung(); po.status = 'batal';");
  assert.doesNotMatch(run(c, 'okBsPanel(po)'), /gudangOpen/);
  run(c, "po.status = 'aktif'; admin = false;"); assert.equal(run(c, 'okBsPanel(po)'), '');
  /* an order has no BigSeller */
  const d = ui(); seed(d, 'pesanan');
  run(d, "S.state.qc = [{ id: 'qc-staf-1', poId: 'p1', setorId: 'cnt1', maklonId: 'mk1', userId: 'qc1', tanggal: '2026-11-04', ukuran: { M: 5 }, total: 5, dibuat: '2026-11-04T10:00:00Z' }]; hitung();");
  assert.doesNotMatch(run(d, 'okBsPanel(po)'), /BigSeller|gudangOpen/);
  /* the record form caps the total at the same per-size stock the panel shows (old-app warehouse OK included) */
  assert.match(part('function openGudang(', 'A.gudangSave ='), /data-form="gudang" data-siap="' \+ coreSumSizes\(okBsSisa\(po\)\) \+ '">/);
  run(c, "po.workflow.ukuran.M.stok = 10; po.workflow.ukuran.L.stok = 0; po.agg.total.stok = 0;");
  assert.equal(run(c, 'coreSumSizes(okBsSisa(po))'), 10, 'an old-app PO whose OK sits only in the old warehouse can still be recorded');
  /* the record form explains what it is for */
  assert.match(html, /Untuk OK QC yang dicatat lewat Input QC, hasil perbaikan, atau catatan lama\. Isi jumlah yang sudah dimasukkan ke BigSeller\./);
});

test('deleting an OK QC row warns that its automatic BigSeller row goes too', () => {
  const c = ui();
  run(c, 'var box = null; function confirmBox(o) { box = o; }');
  run(c, html.match(/A\.del = function \(el\) \{[\s\S]*?\n\};/)[0]);
  const el = (s, id) => '({ getAttribute: function (k) { return k === "data-s" ? "' + s + '" : "' + id + '"; } })';
  run(c, "S.state.gudang = [{ id: coreQcBigSellerId('qc-ok-1'), poId: 'p1' }];");
  run(c, 'A.del(' + el('QC', 'qc-ok-1') + ')');
  assert.equal(c.box.text, 'Catatan BigSeller otomatis dari OK ini ikut terhapus. Kalau barangnya sudah dimasukkan ke BigSeller, koreksi juga di BigSeller. Angka progres PO ikut berubah.');
  run(c, 'A.del(' + el('QC', 'qc-staf-1') + ')');
  assert.equal(c.box.text, 'Angka progres PO ikut berubah.');
});

test('the home tile opens the PO list filtered to stock POs, and the stock filter includes POs without a type', () => {
  const c = vm.createContext({});
  vm.runInContext("var A = {}, S = { f: {} }, painted = 0; function render() { painted++; } var window = { scrollTo: function () {} };\n" + part('A.kpiGo = function', 'var TAHAP_OPSI ='), c);
  vm.runInContext("A.kpiGo({ getAttribute: function () { return 'po:qc:stok'; } })", c);
  assert.deepEqual(plain(vm.runInContext('S.f', c)), { poStatus: 'aktif', poTahap: 'qc', poJenis: 'stok', q: '' });
  vm.runInContext("A.kpiGo({ getAttribute: function () { return 'po:maklon'; } })", c);
  assert.equal(vm.runInContext('S.f.poJenis', c), '');
  assert.match(part('function poDaftar(', 'rows.sort('), /\(!f\.poJenis \|\| \(p\.jenis === 'pesanan'\) === \(f\.poJenis === 'pesanan'\)\)/);
});
