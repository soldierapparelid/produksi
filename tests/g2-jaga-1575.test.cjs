'use strict';
/* 1.5.75 g2-jaga (guards). (a) A PO does not leave 'aktif' while a sewing report waits to be counted, and is not cancelled
   while pieces are still at a tailor. (b) A worker's divisi stays once production or wage rows carry their id; a PO names
   the worker whose divisi no longer fits. (c) An admin's new cut always names an active cutter.
   Real Sheets adapter, cold request objects, invented fixtures only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');

function fixture() {
  const h = harness();
  for (const name of ['bahan-invoice', 'cutting-plans', 'auto-completion', 'reconcile-legacy', 'history-corrections']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src', name + '.js'), 'utf8'), h.context);
  }
  const setup = h.request('setupOwner', { nama: 'Fixture Owner', pin: '1234' });
  assert.equal(setup.ok, true, setup.error);
  const owner = setup.data.token, admin = 'fixture-jaga-admin-token', sewer = 'fixture-jaga-sewer-token', qc = 'fixture-jaga-qc-token';
  h.run(`pkStore_().lock(function(){
    pkStore_().append('Pegawai',{id:'jagaadmin001',nama:'Fixture Admin',divisi:'admin',aktif:true,token:'${admin}'});
    pkStore_().append('Pegawai',{id:'jagasewer001',nama:'Fixture Sewer',divisi:'jahit',aktif:true,token:'${sewer}',pin:'fixture-pin-hash'});
    pkStore_().append('Pegawai',{id:'jagaqc000001',nama:'Fixture QC',divisi:'qc',aktif:true,token:'${qc}',pin:'fixture-pin-hash'});
    pkStore_().append('Pegawai',{id:'jagacutter01',nama:'Fixture Cutter',divisi:'potong',aktif:true});
    pkStore_().append('Pegawai',{id:'jagacutoff01',nama:'Fixture Cutter Lama',divisi:'potong',aktif:false});
    pkStore_().append('Pegawai',{id:'jagabaru0001',nama:'Fixture Baru',divisi:'jahit',aktif:true});
    pkStore_().append('PO',{id:'jaga-po-0001',noPO:'PO-J1',jenis:'stok',nama:'Fixture Jalan',ukuran:'{"L":100}',total:100,status:'aktif',dibuat:'2026-08-01T00:00:00.000Z'});
    pkStore_().append('PO',{id:'jaga-po-0002',noPO:'PO-J2',jenis:'stok',nama:'Fixture Kosong',ukuran:'{"L":10}',total:10,status:'aktif',dibuat:'2026-08-01T00:00:00.000Z'});
    pkStore_().append('PO',{id:'jaga-po-0003',noPO:'PO-J3',jenis:'stok',nama:'Fixture Baru Dipotong',ukuran:'{"L":20}',total:20,status:'aktif',dibuat:'2026-08-01T00:00:00.000Z'});
    pkStore_().append('Potong',{id:'jaga-cut-001',poId:'jaga-po-0001',userId:'jagacutter01',tanggal:'2026-08-02',ukuran:'{"L":100}',total:100,tarif:1000,dibuat:'2026-08-02T00:00:00.000Z'});
    pkStore_().append('SlipKirim',{id:'jaga-send-01',noSlip:'SK-J1',poId:'jaga-po-0001',maklonId:'jagasewer001',tanggal:'2026-08-03',ukuran:'{"L":100}',total:100,upah:9000,dibuat:'2026-08-03T00:00:00.000Z'});
    pkStore_().append('Potong',{id:'jaga-cut-003',poId:'jaga-po-0003',userId:'jagacutter01',tanggal:'2026-08-02',ukuran:'{"L":20}',total:20,tarif:1000,dibuat:'2026-08-02T00:00:00.000Z'});
  });`);
  function call(action, payload = {}, token = owner) { h.cold(); return h.request(action, { token, workflowVersion: 2, ...payload }); }
  function good(action, payload = {}, token = owner) {
    const result = call(action, payload, token); assert.equal(result.ok, true, result.error);
    return result.data && result.data.data !== undefined ? result.data.data : result.data;
  }
  function bad(action, payload, pattern, token = owner) {
    const result = call(action, payload, token); assert.equal(result.ok, false, action + ' must reject');
    if (pattern) assert.match(result.error, pattern); return result;
  }
  function raw(table) { h.cold(); return h.run(`pkStore_().fresh(${JSON.stringify(table)});pkStore_().read(${JSON.stringify(table)})`); }
  const po = id => good('getState').po.find(p => p.id === id);
  const revision = id => good('getState').setor.find(r => r.id === id).revision;
  function report(id, l) { good('createSetor', { setor: { id, poId: 'jaga-po-0001', ukuran: { L: l }, tanggal: '2026-08-10' } }, sewer); return id; }
  function count(id, l) { good('prosesSetor', { id, expectedRevision: revision(id), keputusan: 'terima', ukuran: { L: l }, tanggal: '2026-08-11' }, qc); }
  function reject(id) { good('prosesSetor', { id, expectedRevision: revision(id), keputusan: 'tolak', catatan: 'Salah hitung' }, qc); }
  const rows = () => Object.fromEntries(['PO', 'Pegawai', 'Potong', 'SlipKirim', 'SlipSetor', 'QC', 'Gudang', 'SlipUpah'].map(t => [t, raw(t)]));
  const payroll = () => good('getState').payroll;
  const version = () => h.run('pkStore_().version()');
  return { h, owner, admin, sewer, qc, call, good, bad, raw, po, report, count, reject, rows, payroll, version };
}
const WAITING = /^Masih ada laporan setor yang menunggu dihitung di PO ini\. Hitung atau tolak dulu laporan itu\.$/;

test('(a) a PO whose sewing report waits to be counted cannot be finished or cancelled, by button or edit form', () => {
  const f = fixture();
  f.report('jaga-rep-0001', 60);
  const before = f.rows(), pay = f.payroll(), version = f.version(), snap = f.po('jaga-po-0001');
  for (const token of [f.owner, f.admin]) {
    f.bad('setStatusPO', { id: 'jaga-po-0001', status: 'batal' }, WAITING, token);
    f.bad('setStatusPO', { id: 'jaga-po-0001', status: 'selesai' }, WAITING, token);
    f.bad('savePO', { po: { ...snap, status: 'batal' } }, WAITING, token);
    f.bad('savePO', { po: { ...snap, status: 'selesai' } }, WAITING, token);
  }
  assert.deepEqual(f.rows(), before, 'a refused request writes no row'); assert.equal(f.version(), version);
  assert.deepEqual(f.payroll(), pay, 'wages are unchanged');
  /* the PO stayed active, so the report can still be counted, and other edits still save */
  f.count('jaga-rep-0001', 60);
  assert.equal(f.raw('SlipSetor').find(r => r.id === 'jaga-rep-0001').status, 'diterima');
  f.good('savePO', { po: { ...f.po('jaga-po-0001'), catatan: 'Catatan owner' } });
  assert.equal(f.po('jaga-po-0001').catatan, 'Catatan owner'); assert.equal(f.po('jaga-po-0001').status, 'aktif');
});

test('(a) pieces still at a tailor block cancelling and point to Tutup sisa PO lama; the normal finish is unchanged', () => {
  const f = fixture();
  f.count(f.report('jaga-rep-0001', 60), 60);
  const before = f.rows(), pay = f.payroll();
  const atTailor = /^Masih ada 40 pcs di penjahit, jadi PO ini tidak bisa dibatalkan\. Kalau barangnya memang sudah tidak ada, owner bisa memakai Tutup sisa PO lama\.$/;
  for (const token of [f.owner, f.admin]) {
    f.bad('setStatusPO', { id: 'jaga-po-0001', status: 'batal' }, atTailor, token);
    f.bad('savePO', { po: { ...f.po('jaga-po-0001'), status: 'batal' } }, atTailor, token);
  }
  f.bad('setStatusPO', { id: 'jaga-po-0001', status: 'selesai' }, /PO belum selesai/, f.owner);
  assert.deepEqual(f.rows(), before); assert.deepEqual(f.payroll(), pay);
  /* a rejected report brings nothing back from the tailor */
  f.reject(f.report('jaga-rep-0002', 40));
  f.bad('setStatusPO', { id: 'jaga-po-0001', status: 'batal' }, atTailor);
  /* the owner closes the leftover instead; the closed PO is no longer active, so later edits are not held */
  const closed = f.call('tutupSisaPO', { id: 'jaga-po-0001', reqId: 'jaga-req-0001', alasan: 'Sisa di penjahit sudah tidak ada' });
  assert.equal(closed.ok, true, closed.error); assert.equal(f.po('jaga-po-0001').status, 'selesai');
  f.good('savePO', { po: { ...f.po('jaga-po-0001'), catatan: 'Ditutup owner' } });
  assert.equal(f.po('jaga-po-0001').status, 'selesai');
});

test('(a) a PO with nothing at a tailor still cancels and reopens; a waiting report on an already cancelled PO can be reached again', () => {
  const f = fixture();
  f.good('setStatusPO', { id: 'jaga-po-0002', status: 'batal' }); assert.equal(f.po('jaga-po-0002').status, 'batal');
  f.good('setStatusPO', { id: 'jaga-po-0002', status: 'aktif' }); assert.equal(f.po('jaga-po-0002').status, 'aktif');
  /* cut but not yet sent to a tailor: the edit form cancels it */
  f.good('savePO', { po: { ...f.po('jaga-po-0003'), status: 'batal' } }); assert.equal(f.po('jaga-po-0003').status, 'batal');
  /* every piece came back and was counted */
  f.count(f.report('jaga-rep-0001', 100), 100);
  const pay = f.payroll();
  f.good('setStatusPO', { id: 'jaga-po-0001', status: 'batal' }); assert.equal(f.po('jaga-po-0001').status, 'batal');
  assert.deepEqual(f.payroll(), pay, 'cancelling does not change any wage');
  /* data from before 1.5.75: a cancelled PO that still has a waiting report. Editing it and reopening it are not held,
     and once active again the report is counted as usual. */
  const g = fixture();
  g.report('jaga-rep-0009', 30);
  g.h.run(`pkStore_().lock(function(){ pkStore_().update('PO','jaga-po-0001',{status:'batal',selesaiPada:'2026-08-12'}); });`);
  g.good('savePO', { po: { ...g.po('jaga-po-0001'), catatan: 'Dibatalkan dulu' } });
  assert.equal(g.po('jaga-po-0001').status, 'batal');
  g.bad('prosesSetor', { id: 'jaga-rep-0009', expectedRevision: g.good('getState').setor.find(r => r.id === 'jaga-rep-0009').revision, keputusan: 'terima', ukuran: { L: 30 } }, /sudah dibatalkan/, g.qc);
  g.good('setStatusPO', { id: 'jaga-po-0001', status: 'aktif' });
  g.count('jaga-rep-0009', 30);
  assert.equal(g.raw('SlipSetor').find(r => r.id === 'jaga-rep-0009').status, 'diterima');
});

test('(b) a worker with production or wage rows keeps their divisi; name, phone, note and the active switch still save', () => {
  const f = fixture();
  f.count(f.report('jaga-rep-0001', 60), 60);
  f.h.run(`pkStore_().lock(function(){
    pkStore_().append('Pegawai',{id:'jagadibayar1',nama:'Fixture Dibayar',divisi:'potong',aktif:true});
    pkStore_().append('SlipUpah',{id:'jaga-upah-001',noSlip:'UP-J1',pegawaiId:'jagadibayar1',jenis:'potong',tanggal:'2026-08-20',itemIds:'[]',items:'[]',totalQty:0,totalUpah:0,dibuat:'2026-08-20T00:00:00.000Z'});
    pkStore_().append('Pegawai',{id:'jagaqclama01',nama:'Fixture QC Lama',divisi:'jahit',aktif:true});
    pkStore_().append('PO',{id:'jaga-po-0005',noPO:'PO-J5',jenis:'stok',nama:'Fixture QC',ukuran:'{"L":5}',total:5,status:'selesai',dibuat:'2026-07-01T00:00:00.000Z'});
    pkStore_().append('QC',{id:'jaga-qc-lama1',poId:'jaga-po-0005',userId:'jagaqc000001',maklonId:'jagaqclama01',tanggal:'2026-07-05',ukuran:'{"L":5}',total:5,dibuat:'2026-07-05T00:00:00.000Z'});
  });`);
  const pay = f.payroll(), flow = f.po('jaga-po-0001').workflow, divisi = () => Object.fromEntries(f.raw('Pegawai').map(u => [u.id, u.divisi]));
  const kept = divisi(), refused = /^Pegawai ini sudah punya catatan potong, jahit, QC, atau upah, jadi divisinya tidak bisa diganti\. Nonaktifkan akun ini lalu buat akun baru\.$/;
  for (const [id, nama, to] of [['jagasewer001', 'Fixture Sewer', 'qc'], ['jagasewer001', 'Fixture Sewer', 'potong'], ['jagacutter01', 'Fixture Cutter', 'jahit'],
    ['jagadibayar1', 'Fixture Dibayar', 'jahit'], ['jagaqclama01', 'Fixture QC Lama', 'potong'], ['jagaqclama01', 'Fixture QC Lama', 'admin']]) {
    f.bad('saveUser', { user: { id, nama, divisi: to } }, refused);
  }
  f.bad('saveUser', { user: { id: 'jagasewer001', nama: 'Fixture Sewer', divisi: 'qc' } }, refused, f.admin);
  assert.deepEqual(divisi(), kept, 'no divisi changed');
  /* the same divisi: name, phone, note and the active switch still save */
  f.good('saveUser', { user: { id: 'jagasewer001', nama: 'Fixture Sewer Baru', divisi: 'jahit', hp: '0800', catatan: 'pindah rumah' } });
  f.good('saveUser', { user: { id: 'jagacutter01', nama: 'Fixture Cutter', divisi: 'potong', aktif: false } });
  const users = f.raw('Pegawai');
  assert.equal(users.find(u => u.id === 'jagasewer001').nama, 'Fixture Sewer Baru'); assert.equal(users.find(u => u.id === 'jagacutter01').aktif, false);
  /* a person without any row changes freely, and so does the QC recorder (QC rows carry the tailor as the worker) */
  f.good('saveUser', { user: { id: 'jagabaru0001', nama: 'Fixture Baru', divisi: 'qc' } });
  f.good('saveUser', { user: { id: 'jagaqc000001', nama: 'Fixture QC', divisi: 'admin' } });
  assert.equal(divisi().jagabaru0001, 'qc'); assert.equal(divisi().jagaqc000001, 'admin');
  assert.deepEqual(f.payroll(), pay, 'wages are unchanged'); assert.deepEqual(f.po('jaga-po-0001').workflow, flow, 'the PO stays clean');
});

test('(b) a PO names the tailor whose divisi was already changed, once; only putting the divisi back is allowed', () => {
  const f = fixture();
  f.h.run(`pkStore_().lock(function(){
    pkStore_().append('Pegawai',{id:'jagarusak001',nama:'Fixture Rusak',divisi:'qc',aktif:true});
    pkStore_().append('PO',{id:'jaga-po-0004',noPO:'PO-J4',jenis:'stok',nama:'Fixture Pindah Divisi',ukuran:'{"L":30}',total:30,status:'aktif',dibuat:'2026-08-01T00:00:00.000Z'});
    pkStore_().append('Potong',{id:'jaga-cut-004',poId:'jaga-po-0004',userId:'jagacutter01',tanggal:'2026-08-02',ukuran:'{"L":30}',total:30,tarif:1000,dibuat:'2026-08-02T00:00:00.000Z'});
    pkStore_().append('SlipKirim',{id:'jaga-send-41',noSlip:'SK-J41',poId:'jaga-po-0004',maklonId:'jagarusak001',tanggal:'2026-08-03',ukuran:'{"L":10}',total:10,upah:9000,dibuat:'2026-08-03T00:00:00.000Z'});
    pkStore_().append('SlipKirim',{id:'jaga-send-42',noSlip:'SK-J42',poId:'jaga-po-0004',maklonId:'jagarusak001',tanggal:'2026-08-04',ukuran:'{"L":10}',total:10,upah:9000,dibuat:'2026-08-04T00:00:00.000Z'});
    pkStore_().append('SlipKirim',{id:'jaga-send-43',noSlip:'SK-J43',poId:'jaga-po-0004',maklonId:'jagahantu001',tanggal:'2026-08-05',ukuran:'{"L":10}',total:10,upah:9000,dibuat:'2026-08-05T00:00:00.000Z'});
  });`);
  const named = 'Penjahit Fixture Rusak sekarang bukan divisi Maklon Jahit. Kembalikan divisinya ke Maklon Jahit.', ghost = 'Pekerja asal jaga-send-43 tidak dikenal.';
  let flow = f.po('jaga-po-0004').workflow;
  assert.equal(flow.issues.filter(x => x === named).length, 1, 'one message per tailor, not one per row');
  assert.ok(flow.issues.includes(ghost), 'an unknown account keeps the row id');
  assert.ok(!flow.issues.some(x => /jaga-send-4[12]/.test(x)), 'a known tailor is not shown by row id');
  assert.ok(flow.blockingIssues.includes(named)); assert.equal(flow.complete, false);
  f.bad('createKirim', { kirim: { id: 'jaga-send-44', poId: 'jaga-po-0004', maklonId: 'jagasewer001', ukuran: { L: 1 }, tanggal: '2026-08-06' } }, /Penjahit Fixture Rusak sekarang bukan divisi Maklon Jahit/);
  const held = f.payroll().filter(r => r.poId === 'jaga-po-0004');
  assert.ok(held.length && held.every(r => r.needsReview), 'the cutting wage on this PO is held, as before');
  f.bad('saveUser', { user: { id: 'jagarusak001', nama: 'Fixture Rusak', divisi: 'potong' } }, /tidak bisa diganti/);
  f.good('saveUser', { user: { id: 'jagarusak001', nama: 'Fixture Rusak', divisi: 'jahit' } });
  flow = f.po('jaga-po-0004').workflow;
  assert.ok(!flow.issues.includes(named), 'putting the divisi back clears the message'); assert.ok(flow.issues.includes(ghost));
});

test('(c) an admin\'s new cut must name an active cutter; nothing is written otherwise and existing wages stay', () => {
  const f = fixture();
  const before = f.rows(), pay = f.payroll();
  const cut = (extra = {}) => ({ potong: { id: 'jaga-cut-baru', poId: 'jaga-po-0002', tanggal: '2026-08-05', ukuran: { L: 10 }, tarif: 1200, ...extra } });
  for (const token of [f.owner, f.admin]) {
    f.bad('createPotong', cut(), /^Pilih tukang potongnya\.$/, token);
    f.bad('createPotong', cut({ userId: '' }), /^Pilih tukang potongnya\.$/, token);
    f.bad('createPotong', cut({ userId: 'jagacutoff01' }), /^Tukang potong Fixture Cutter Lama sudah nonaktif\. Pilih tukang potong yang aktif\.$/, token);
    f.bad('createPotong', cut({ userId: 'jagasewer001' }), /^Pilih tukang potong yang terdaftar\.$/, token);
    f.bad('createPotong', cut({ userId: 'tidakada0001' }), /^Pilih tukang potong yang terdaftar\.$/, token);
  }
  assert.deepEqual(f.rows(), before, 'no cut row is written'); assert.deepEqual(f.payroll(), pay);
  const saved = f.good('createPotong', cut({ userId: 'jagacutter01' }), f.admin);
  assert.equal(saved.userId, 'jagacutter01');
  assert.equal(f.good('createPotong', cut({ userId: 'jagacutter01' }), f.admin).id, saved.id, 'a lost response is retried without a second row');
  assert.equal(f.raw('Potong').filter(r => r.id === 'jaga-cut-baru').length, 1);
  const after = f.payroll(), earned = after.filter(r => r.sourceId === 'jaga-cut-baru');
  assert.deepEqual(after.filter(r => r.sourceId !== 'jaga-cut-baru'), pay, 'existing wages are unchanged');
  assert.equal(earned.length, 1); assert.equal(earned[0].pegawaiId, 'jagacutter01'); assert.equal(earned[0].total, 10); assert.equal(earned[0].rate, 1200);
});

test('(c) an old cut stored without a cutter stays as it was; its id is still found before the cutter is asked for', () => {
  const f = fixture();
  f.h.run(`pkStore_().lock(function(){ pkStore_().append('Potong',{id:'jaga-cut-tanpa',poId:'jaga-po-0002',userId:'',tanggal:'2026-08-04',ukuran:'{"L":10}',total:10,tarif:1000,dibuat:'2026-08-04T00:00:00.000Z'}); });`);
  const pay = f.payroll(), rows = f.raw('Potong');
  assert.ok(!pay.some(r => r.sourceId === 'jaga-cut-tanpa'), 'a cut without a cutter earned no wage before and still earns none');
  /* the stored row is matched by id first (the existing duplicate guard answers), so the new cutter rule never rewrites it */
  f.bad('createPotong', { potong: { id: 'jaga-cut-tanpa', poId: 'jaga-po-0002', ukuran: { L: 10 } } }, /^ID ini sudah tercatat dengan permintaan berbeda/);
  assert.deepEqual(f.raw('Potong'), rows); assert.deepEqual(f.payroll(), pay);
  assert.equal(f.po('jaga-po-0002').workflow.ukuran.L.potong, 10, 'the old cut still counts as cut');
});

/* ---------- UI: the refusals reach the owner as normal error toasts ---------- */
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
function part(a, b) { const p = html.indexOf(a), q = html.indexOf(b, p + a.length); assert.ok(p >= 0 && q > p, a); return html.slice(p, q); }

test('UI: a refused status change is shown as an error toast; the forms already send through act and ask for a cutter', async () => {
  const c = vm.createContext({ console, Promise });
  vm.runInContext(`var A = {}, messages = [], D = { po: { p1: { id: 'p1', status: 'aktif', workflow: { complete: true, issues: [], ukuran: {} } } } };
    function toast(s, e) { messages.push([s, !!e]); } function me() { return { divisi: 'owner' }; } function workflowFor(po) { return po.workflow; }
    function req() { return Promise.reject(new Error('Masih ada laporan setor yang menunggu dihitung di PO ini. Hitung atau tolak dulu laporan itu.')); }`, c);
  vm.runInContext(part('function act(el, p) {', 'function quiet() {}') + 'function quiet() {}', c);
  vm.runInContext(part('A.poStatusSet = function', '/* 1.5.74: Tutup sisa PO lama'), c);
  vm.runInContext(`A.poStatusSet({ disabled: false, classList: { add: function () {}, remove: function () {} }, getAttribute: function (k) { return k === 'data-id' ? 'p1' : k === 'data-v' ? 'selesai' : ''; } })`, c);
  await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(JSON.parse(JSON.stringify(c.messages)), [['Masih ada laporan setor yang menunggu dihitung di PO ini. Hitung atau tolak dulu laporan itu.', true]]);
  const potongSave = part('A.potongSave = function', '/* ---------- kirim ke maklon');
  assert.ok(potongSave.indexOf("if (isAdmin() && !v.userId) return toast('Pilih tukang potongnya.', true);") >= 0 && potongSave.indexOf("if (isAdmin() && !v.userId)") < potongSave.indexOf("req('createPotong'"), 'the admin form asks for the cutter before sending');
  assert.match(html, /act\(el, req\('saveUser', \{ user: u \}\)\)\.then\(/, 'the account form shows server refusals as toasts');
  assert.match(html, /return act\(el, Promise\.resolve\(\)\.then\(function \(\) \{ return req\('savePO', payload\); \}\)/, 'the PO edit form shows server refusals as toasts');
});
