'use strict';
/* 1.5.75 (g3-alur): a size whose pieces were all rejected at sewing no longer keeps a PO open, and a counted slip
   without a sewing rate gets its first price after QC. Real Sheets adapter, cold requests, invented fixtures only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');
const root = path.resolve(__dirname, '..');
const NOW = '2026-08-20T03:00:00.000Z';
const WEEK = 7 * 24 * 60 * 60 * 1000;

function fixture() {
  const h = harness();
  for (const name of ['bahan-invoice', 'cutting-plans', 'auto-completion', 'reconcile-legacy', 'history-corrections']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'src', name + '.js'), 'utf8'), h.context);
  }
  h.context.ALUR_NOW = NOW;
  h.run('var alurEnv=pkEnv_;pkEnv_=function(){var e=alurEnv();e.now=function(){return new Date(ALUR_NOW);};return e;};void 0;');
  const setup = h.request('setupOwner', { nama: 'Pemilik Contoh', pin: '1234' });
  assert.equal(setup.ok, true, setup.error);
  const owner = setup.data.token, admin = 'fixture-alur-admin-token', sewer = 'fixture-alur-sewer-token', qc = 'fixture-alur-qc-token';
  h.run(`pkStore_().lock(function(){
    var s = pkStore_();
    s.append('Pegawai',{id:'aluradmin001',nama:'Admin Contoh',divisi:'admin',aktif:true,token:'${admin}'});
    s.append('Pegawai',{id:'alursewer001',nama:'Penjahit Contoh',divisi:'jahit',aktif:true,token:'${sewer}',pin:'fixture-pin-hash'});
    s.append('Pegawai',{id:'alurqc000001',nama:'QC Contoh',divisi:'qc',aktif:true,token:'${qc}',pin:'fixture-pin-hash'});
    s.append('Pegawai',{id:'alurcutter01',nama:'Pemotong Contoh',divisi:'potong',aktif:true});
    s.append('PO',{id:'alur-po-0001',noPO:'PO-A1',jenis:'stok',nama:'Kaos Contoh',ukuran:'{"M":10,"L":20}',total:30,status:'aktif',dibuat:'2026-08-01T00:00:00.000Z'});
    s.append('Potong',{id:'alur-cut-0001',poId:'alur-po-0001',userId:'alurcutter01',tanggal:'2026-08-02',ukuran:'{"M":10,"L":20}',total:30,tarif:1000,dibuat:'2026-08-02T00:00:00.000Z'});
    s.append('SlipKirim',{id:'alur-send-001',noSlip:'SK-A1',poId:'alur-po-0001',maklonId:'alursewer001',tanggal:'2026-08-03',ukuran:'{"M":10,"L":20}',total:30,upah:9000,dibuat:'2026-08-03T00:00:00.000Z'});
    s.append('PO',{id:'alur-po-0002',noPO:'PO-A2',jenis:'stok',nama:'Kemeja Contoh',ukuran:'{"M":10,"XL":5}',total:15,status:'aktif',dibuat:'2026-08-01T00:00:00.000Z'});
    s.append('Potong',{id:'alur-cut-0002',poId:'alur-po-0002',userId:'alurcutter01',tanggal:'2026-08-02',ukuran:'{"M":10}',total:10,tarif:1000,dibuat:'2026-08-02T00:00:00.000Z'});
    s.append('SlipKirim',{id:'alur-send-002',noSlip:'SK-A2',poId:'alur-po-0002',maklonId:'alursewer001',tanggal:'2026-08-03',ukuran:'{"M":10}',total:10,upah:9000,dibuat:'2026-08-03T00:00:00.000Z'});
    s.append('PO',{id:'alur-po-0003',noPO:'PO-A3',jenis:'stok',nama:'Celana Contoh',ukuran:'{"L":20}',total:20,status:'aktif',dibuat:'2026-08-01T00:00:00.000Z'});
    s.append('Potong',{id:'alur-cut-0003',poId:'alur-po-0003',userId:'alurcutter01',tanggal:'2026-08-02',ukuran:'{"L":20}',total:20,tarif:1000,dibuat:'2026-08-02T00:00:00.000Z'});
    s.append('SlipKirim',{id:'alur-send-003',noSlip:'SK-A3',poId:'alur-po-0003',maklonId:'alursewer001',tanggal:'2026-08-03',ukuran:'{"L":20}',total:20,upah:0,dibuat:'2026-08-03T00:00:00.000Z'});
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
  const state = (token = owner) => good('getState', {}, token);
  const po = id => state().po.find(p => p.id === id);
  const row = id => raw('PO').find(p => p.id === id);
  const revision = id => state().setor.find(r => r.id === id).revision;
  function report(id, poId, ukuran) { good('createSetor', { setor: { id, poId, ukuran, tanggal: '2026-08-10' } }, sewer); return id; }
  function count(id, ukuran, rejectUkuran) {
    const reject = rejectUkuran ? { rejectUkuran, reject: Object.values(rejectUkuran).reduce((n, q) => n + q, 0) } : {};
    good('prosesSetor', { id, expectedRevision: revision(id), keputusan: 'terima', ukuran, ...reject, tanggal: '2026-08-11' }, qc);
  }
  function inspect(id, poId, setorId, extra) { good('createQC', { qc: { id, poId, setorId, tanggal: '2026-08-12', ...extra } }, qc); }
  function at(ms) { h.context.ALUR_NOW = new Date(Date.parse(NOW) + ms).toISOString(); }
  return { h, owner, admin, sewer, qc, call, good, bad, raw, state, po, row, report, count, inspect, at };
}
const wage = r => [r.id, r.total, r.rate, r.available, r.paidQty, r.needsReview];

test('a size whose pieces were all rejected at sewing no longer keeps the PO open; it then closes the normal way', () => {
  const f = fixture();
  f.count(f.report('alur-rep-m001', 'alur-po-0001', { M: 10 }), {}, { M: 10 });
  let w = f.po('alur-po-0001').workflow;
  assert.deepEqual([w.ukuran.M.target, w.ukuran.M.rejectJahit, w.ukuran.M.diterima, w.ukuran.M.targetBaik], [10, 10, 0, 0]);
  assert.equal(w.ukuran.M.countComplete, true, 'every M piece came back from sewing and was counted, all as reject');
  assert.equal(w.ukuran.M.complete, true, 'nothing of M is left for QC');
  assert.equal(w.complete, false, 'L is still at the sewer');
  assert.equal(f.row('alur-po-0001').tuntasPada, '');
  f.count(f.report('alur-rep-l001', 'alur-po-0001', { L: 20 }), { L: 20 });
  f.inspect('alur-qc-l0001', 'alur-po-0001', 'alur-rep-l001', { ukuran: { L: 20 } });
  const st = f.state(); w = st.po.find(p => p.id === 'alur-po-0001').workflow;
  assert.equal(w.complete, true, 'the PO is finished: M all rejected at sewing, L sewn and passed QC');
  assert.deepEqual(w.issues, []);
  assert.equal(f.h.run('corePoCountComplete(' + JSON.stringify(w) + ')'), true, 'the PO and QC screens agree that sewing is fully counted');
  /* wages are untouched by the completion: the cutting and the L count are paid as before, the rejected M earns nothing */
  assert.deepEqual(st.payroll.filter(r => r.poId === 'alur-po-0001').map(wage), [['potong:alur-cut-0001', 30, 1000, 30, 0, false], ['setor:alur-rep-l001:L', 20, 9000, 20, 0, false]]);
  /* the normal seven-day automatic close starts at first sight */
  assert.equal(f.row('alur-po-0001').tuntasPada, NOW); assert.equal(f.row('alur-po-0001').status, 'aktif');
  f.at(WEEK - 1000); f.state(); assert.equal(f.row('alur-po-0001').status, 'aktif');
  f.at(WEEK); const closed = f.state();
  assert.equal(f.row('alur-po-0001').status, 'selesai'); assert.equal(f.row('alur-po-0001').selesaiPada, '2026-08-27');
  assert.deepEqual(closed.payroll, st.payroll, 'closing the PO changes no wage');
});

test('a size never cut or assigned, a size only cut, and a size still at the sewer keep the PO open', () => {
  const f = fixture();
  f.count(f.report('alur-rep-m002', 'alur-po-0002', { M: 10 }), {}, { M: 10 });
  const w = f.po('alur-po-0002').workflow;
  assert.equal(w.ukuran.M.countComplete, true);
  assert.deepEqual([w.ukuran.XL.target, w.ukuran.XL.countComplete, w.ukuran.XL.complete], [0, false, false], 'XL was ordered and never cut');
  assert.equal(w.complete, false); assert.equal(f.row('alur-po-0002').tuntasPada, '');
  f.bad('setStatusPO', { id: 'alur-po-0002', status: 'selesai' }, /PO belum selesai/);
  /* part rejected, the rest still at the sewer */
  f.count(f.report('alur-rep-l002', 'alur-po-0001', { L: 5 }), {}, { L: 5 });
  const l = f.po('alur-po-0001').workflow.ukuran.L;
  assert.deepEqual([l.targetBaik, l.sisaMaklon, l.countComplete, l.complete], [15, 15, false, false]);
  /* the rule on its own: S all rejected and counted; M all rejected but only reported; L cut, never given out; XL nothing */
  const flow = f.h.run(`coreWorkflow([{id:'unit-po-01',status:'aktif',ukuran:'{"S":4,"M":4,"L":4,"XL":4}'}],
    [{id:'unit-cut-01',poId:'unit-po-01',ukuran:'{"S":4,"M":4,"L":4}',total:12}],
    [{id:'unit-send-1',poId:'unit-po-01',maklonId:'w1',ukuran:'{"S":4,"M":4}',total:8}],
    [{id:'unit-cnt-01',poId:'unit-po-01',maklonId:'w1',status:'diterima',ukuran:'{}',total:0,rejectUkuran:'{"S":4}',reject:4},
     {id:'unit-rep-01',poId:'unit-po-01',maklonId:'w1',status:'diajukan',ukuran:'{}',total:0,rejectUkuran:'{"M":4}',reject:4}],[],[])['unit-po-01']`);
  assert.deepEqual(flow.issues, []);
  assert.deepEqual(['S', 'M', 'L', 'XL'].map(s => [s, flow.ukuran[s].countComplete, flow.ukuran[s].complete]), [['S', true, true], ['M', false, false], ['L', false, false], ['XL', false, false]]);
  assert.equal(flow.complete, false);
  assert.equal(f.h.run('corePoCountComplete(' + JSON.stringify(flow) + ')'), false);
});

test('a counted slip without a sewing rate gets its first price after QC; only its own wages change', () => {
  const f = fixture();
  f.count(f.report('alur-rep-l009', 'alur-po-0001', { L: 20 }), { L: 20 });
  f.inspect('alur-qc-l0009', 'alur-po-0001', 'alur-rep-l009', { ukuran: { L: 20 } });
  f.count(f.report('alur-rep-z001', 'alur-po-0003', { L: 20 }), { L: 20 });
  assert.equal(f.raw('SlipSetor').find(r => r.id === 'alur-rep-z001').upah, 0, 'no rate on the assignment, the item or the settings');
  f.inspect('alur-qc-z0001', 'alur-po-0003', 'alur-rep-z001', { ukuran: { L: 16 }, perbaikanUkuran: { L: 4 }, perbaikan: 4 });
  f.inspect('alur-qc-z0002', 'alur-po-0003', 'alur-rep-z001', { repairQcId: 'alur-qc-z0001', ukuran: { L: 3 }, rejectUkuran: { L: 1 }, reject: 1 });
  const mine = rows => rows.filter(r => r.sourceId === 'alur-rep-z001'), others = rows => rows.filter(r => r.sourceId !== 'alur-rep-z001');
  const before = f.state();
  assert.deepEqual(mine(before.payroll).map(wage), [['setor:alur-rep-z001:L', 16, 0, 0, 0, true], ['repair:alur-qc-z0002:L', 3, 0, 0, 0, true]], 'held: no rate yet');
  assert.ok(mine(before.payroll).every(r => r.issues.indexOf('Tarif hitungan belum diatur.') >= 0));
  /* nobody but the owner or an admin sets a price */
  f.bad('ubahHarga', { sheet: 'SlipSetor', id: 'alur-rep-z001', harga: 7000 }, null, f.qc);
  f.bad('ubahHarga', { sheet: 'SlipSetor', id: 'alur-rep-z001', harga: 7000 }, null, f.sewer);
  f.bad('ubahHarga', { sheet: 'SlipSetor', id: 'alur-rep-z001', harga: 0 }, /dibekukan saat QC/, f.admin);
  const tables = ['Potong', 'SlipKirim', 'QC', 'Gudang', 'SlipUpah', 'LegacySettlement', 'KoreksiRiwayat'], rowsBefore = tables.map(f.raw);
  const otherCounts = () => f.raw('SlipSetor').filter(r => r.id !== 'alur-rep-z001'), countsBefore = otherCounts();
  f.good('ubahHarga', { sheet: 'SlipSetor', id: 'alur-rep-z001', harga: 7000 }, f.admin);
  assert.equal(f.raw('SlipSetor').find(r => r.id === 'alur-rep-z001').upah, 7000);
  assert.deepEqual(tables.map(f.raw), rowsBefore, 'no production, QC or wage-slip row is touched');
  assert.deepEqual(otherCounts(), countsBefore, 'no other count is touched');
  const after = f.state();
  assert.deepEqual(mine(after.payroll).map(wage), [['setor:alur-rep-z001:L', 16, 7000, 16, 0, false], ['repair:alur-qc-z0002:L', 3, 7000, 3, 0, false]], 'the count and its repair are payable at the new rate');
  assert.deepEqual(others(after.payroll), others(before.payroll), 'no other wage moves');
  assert.deepEqual(after.po.map(p => [p.id, p.workflow]), before.po.map(p => [p.id, p.workflow]), 'production figures do not move');
  /* once set, the rate is frozen like every other counted rate */
  f.bad('ubahHarga', { sheet: 'SlipSetor', id: 'alur-rep-z001', harga: 7500 }, /dibekukan saat QC/);
  f.bad('ubahHarga', { sheet: 'SlipSetor', id: 'alur-rep-l009', harga: 9500 }, /dibekukan saat QC/);
  assert.equal(f.raw('SlipSetor').find(r => r.id === 'alur-rep-l009').upah, 9000);
  /* paid: the slip is cancelled first, as before */
  f.good('createUpah', { upah: { id: 'alur-pay-0001', pegawaiId: 'alursewer001', itemIds: mine(after.payroll).map(r => r.id), expectedRevisions: Object.fromEntries(mine(after.payroll).map(r => [r.id, r.revision])) } });
  f.bad('ubahHarga', { sheet: 'SlipSetor', id: 'alur-rep-z001', harga: 7000 }, /Sudah masuk slip upah/);
});

test('the first-price exception never reaches a count tied to old or marked QC, and Beranda offers exactly what the server accepts', () => {
  const f = fixture();
  /* four zero-rate counts of 5 pcs each in the same PO, and one counted at a rate */
  for (const id of ['alur-zero-qc1', 'alur-zero-nqc', 'alur-zero-mqc', 'alur-zero-pd1']) f.count(f.report(id, 'alur-po-0003', { L: 5 }), { L: 5 });
  f.count(f.report('alur-rate-qc1', 'alur-po-0001', { L: 20 }), { L: 20 });
  f.inspect('alur-qc-zq001', 'alur-po-0003', 'alur-zero-qc1', { ukuran: { L: 5 } });
  f.inspect('alur-qc-zm001', 'alur-po-0003', 'alur-zero-mqc', { ukuran: { L: 5 } });
  f.inspect('alur-qc-rq001', 'alur-po-0001', 'alur-rate-qc1', { ukuran: { L: 20 } });
  /* an old "already paid" mark on one QC row, and an old payment id on one count */
  f.h.run(`pkStore_().lock(function(){ pkStore_().update('QC','alur-qc-zm001',{upahId:'LUNAS-LAMA'}); pkStore_().update('SlipSetor','alur-zero-pd1',{upahId:'alur-old-pay1'}); });`);
  /* the owner's home screen, built from the real state with the real page rules */
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const between = (a, b) => { const p = html.indexOf(a), q = html.indexOf(b, p + a.length); assert.ok(p >= 0 && q > p, a); return html.slice(p, q); };
  const c = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core.js'), 'utf8'), c);
  const st = f.state(); c.STATE_JSON = JSON.stringify(st);
  vm.runInContext(`var S={state:JSON.parse(STATE_JSON),sub:{}};function poAktif(){return [];}function isAdmin(){return true;}function esc(s){return String(s==null?'':s);}
    function nf(n){return String(n);}function tgl(s){return s||'';}function lalu(){return 'tadi';}function namaUser(){return 'Penjahit Contoh';}function poNama(){return 'PO Contoh';}
    function ic(){return '';}function setorLaporanLama(){return false;}function nfQty(n){return String(n);}function satuanPendek(s){return s;}`, c);
  vm.runInContext(between('function sourcePayroll(sourceId) {', 'function payrollNotice('), c);
  vm.runInContext(between('function tindakan() {', 'VIEWS.beranda = function'), c);
  const offered = JSON.parse(vm.runInContext("JSON.stringify(tindakan().filter(function(x){return x.k==='harga'&&x.j==='jahit';}).map(function(x){return x.id;}))", c)).sort();
  /* every counted slip without a rate is tried on the server */
  const accepted = [];
  for (const s of st.setor.filter(s => s.status === 'diterima' && !(s.upah > 0))) if (f.call('ubahHarga', { sheet: 'SlipSetor', id: s.id, harga: 6000 }).ok) accepted.push(s.id);
  assert.deepEqual(accepted.sort(), ['alur-zero-nqc', 'alur-zero-qc1'], 'only the clean zero-rate counts take a first price');
  assert.deepEqual(offered, accepted.sort(), 'Beranda offers "Atur harga" exactly where the server accepts it');
  assert.equal(f.call('ubahHarga', { sheet: 'SlipSetor', id: 'alur-zero-mqc', harga: 6000 }).error, 'Tarif hitungan sudah dibekukan saat QC. Hapus QC yang belum dibayar dahulu jika perlu koreksi.');
  assert.match(f.call('ubahHarga', { sheet: 'SlipSetor', id: 'alur-zero-pd1', harga: 6000 }).error, /Sudah masuk slip upah/);
  /* the shared rule on its own, row by row */
  const rule = (setor, qcRows) => f.h.run('coreSetorHargaPertama(' + JSON.stringify(setor) + ',' + JSON.stringify(qcRows) + ')');
  const count0 = { id: 'unit-count-1', status: 'diterima', upah: 0 }, legacy = { baseline: true, skuId: 'sku-contoh', siklus: '1', entryId: 'entry-contoh', field: 'qc' };
  assert.equal(rule(count0, [{ setorId: 'unit-count-1' }, { setorId: 'other-count' , upahId: 'x' }]), true);
  assert.equal(rule(count0, []), true);
  assert.equal(rule({ ...count0, upah: 500 }, [{ setorId: 'unit-count-1' }]), false, 'a rate that is set stays frozen');
  assert.equal(rule({ ...count0, upahId: 'pay' }, []), false);
  assert.equal(rule({ ...count0, status: 'diajukan' }, []), false);
  assert.equal(rule(count0, [{ setorId: 'unit-count-1', upahId: 'LUNAS-LAMA' }]), false);
  assert.equal(rule(count0, [{ setorId: 'unit-count-1', autoFromCount: true }]), false);
  assert.equal(rule(count0, [{ setorId: 'unit-count-1', workflowVersion: 1, imporSumber: legacy }]), false);
  assert.equal(rule(count0, [{ setorId: 'unit-count-1', asal: 'lama', workflowVersion: 0 }]), false);
});
