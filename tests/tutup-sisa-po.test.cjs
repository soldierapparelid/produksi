'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');

/* 1.5.74: the owner closes an old PO whose leftover no longer exists. Only the PO status changes; every production,
   slip and wage row stays. Real Sheets adapter, cold request objects, invented fixtures only. */
function fixture() {
  const h = harness();
  for (const name of ['bahan-invoice', 'cutting-plans', 'auto-completion', 'reconcile-legacy', 'history-corrections']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src', name + '.js'), 'utf8'), h.context);
  }
  const setup = h.request('setupOwner', { nama: 'Fixture Owner', pin: '1234' });
  assert.equal(setup.ok, true, setup.error);
  const owner = setup.data.token, admin = 'fixture-close-admin-token', sewer = 'fixture-close-sewer-token', qc = 'fixture-close-qc-token';
  h.run(`pkStore_().lock(function(){
    pkStore_().append('Pegawai',{id:'closeadmin01',nama:'Fixture Admin',divisi:'admin',aktif:true,token:'${admin}'});
    pkStore_().append('Pegawai',{id:'closesewer01',nama:'Fixture Sewer',divisi:'jahit',aktif:true,token:'${sewer}',pin:'fixture-pin-hash'});
    pkStore_().append('Pegawai',{id:'closeqc00001',nama:'Fixture QC',divisi:'qc',aktif:true,token:'${qc}',pin:'fixture-pin-hash'});
    pkStore_().append('PO',{id:'close-po-0001',noPO:'PO-T1',jenis:'stok',nama:'Fixture Lama',ukuran:'{"L":100}',total:100,status:'aktif',dibuat:'2026-08-01T00:00:00.000Z'});
    pkStore_().append('Potong',{id:'close-cut-001',poId:'close-po-0001',userId:'closeqc00001',tanggal:'2026-08-02',ukuran:'{"L":100}',total:100,tarif:1000,dibuat:'2026-08-02T00:00:00.000Z'});
    pkStore_().append('SlipKirim',{id:'close-send-01',noSlip:'SK-T1',poId:'close-po-0001',maklonId:'closesewer01',tanggal:'2026-08-03',ukuran:'{"L":100}',total:100,upah:9000,dibuat:'2026-08-03T00:00:00.000Z'});
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
  const po = (token = owner) => good('getState', {}, token).po.find(p => p.id === 'close-po-0001');
  const revision = id => good('getState').setor.find(r => r.id === id).revision;
  function report(id, l) { good('createSetor', { setor: { id, poId: 'close-po-0001', ukuran: { L: l }, tanggal: '2026-08-10' } }, sewer); return id; }
  function count(id, l) { good('prosesSetor', { id, expectedRevision: revision(id), keputusan: 'terima', ukuran: { L: l }, tanggal: '2026-08-11' }, qc); }
  const rows = () => Object.fromEntries(['Potong', 'SlipKirim', 'SlipSetor', 'QC', 'Gudang', 'SlipUpah', 'LegacySettlement', 'KoreksiRiwayat'].map(t => [t, raw(t)]));
  const close = (extra = {}, token = owner) => call('tutupSisaPO', { id: 'close-po-0001', reqId: 'close-req-0001', alasan: 'Barang lama sudah habis terjual', ...extra }, token);
  return { h, owner, admin, sewer, qc, call, good, bad, raw, po, report, count, rows, close };
}

test('only the owner may close, with a reason, and never while a sewing report waits to be counted', () => {
  const f = fixture();
  f.count(f.report('close-rep-0001', 60), 60);
  for (const token of [f.admin, f.sewer, f.qc]) { const r = f.close({}, token); assert.equal(r.ok, false); assert.match(r.error, /Hanya owner/); }
  f.bad('tutupSisaPO', { id: 'missing-po-01', reqId: 'close-req-0001', alasan: 'Barang lama sudah habis' }, /PO tidak ditemukan/);
  assert.match(f.close({ reqId: '' }).error, /Identitas permintaan/);
  assert.match(f.close({ alasan: ' ok ' }).error, /minimal 5/);
  assert.match(f.close({ alasan: 'x'.repeat(201) }).error, /terlalu panjang/);
  assert.match(f.close({ expectedRevision: 'stale-revision' }).error, /Data berubah/);
  f.report('close-rep-0002', 10);
  assert.match(f.close().error, /laporan setor yang menunggu dihitung/);
  assert.equal(f.po().status, 'aktif', 'nothing was closed by a refused request');
  assert.equal(f.po().tutupSisa, '', 'no mark is written by a refused request');
});

test('closing changes only the PO status; production, slips and wages stay, and the PO takes no new production', () => {
  const f = fixture();
  f.count(f.report('close-rep-0001', 60), 60);
  const before = f.rows(), payroll = f.good('getState').payroll, sisa = f.po().agg.maklon.closesewer01.sisa;
  assert.equal(sisa, 40, 'forty pieces are still listed at the sewer');
  const done = f.close();
  assert.equal(done.ok, true, done.error);
  const out = done.data.data;
  assert.equal(out.po.status, 'selesai'); assert.equal(out.tutup.alasan, 'Barang lama sudah habis terjual'); assert.equal(out.tutup.oleh, f.good('getState').me.id);
  assert.deepEqual(f.rows(), before, 'no production, slip, wage or correction row is touched');
  assert.deepEqual(f.good('getState').payroll, payroll, 'every earned and paid wage stays the same');
  const closed = f.po(), mark = JSON.parse(closed.tutupSisa);
  assert.equal(closed.status, 'selesai'); assert.equal(mark.tanggal, closed.selesaiPada); assert.equal(mark.id, 'close-req-0001');
  assert.equal(closed.workflow.complete, false, 'the history still shows what was never recorded');
  assert.equal(f.po(f.sewer).status, 'selesai'); assert.equal(f.po(f.sewer).tutupSisa, undefined, 'the reason is not sent to workers');
  f.bad('createSetor', { setor: { id: 'close-rep-0003', poId: 'close-po-0001', ukuran: { L: 5 }, tanggal: '2026-08-12' } }, /PO sudah selesai/, f.sewer);
  /* a lost response is retried safely; a second, different request is refused */
  const version = f.h.run('pkStore_().version()');
  const again = f.close(); assert.equal(again.ok, true, again.error); assert.equal(again.data.data.replayed, true);
  assert.equal(f.h.run('pkStore_().version()'), version, 'the retry writes nothing');
  assert.match(f.close({ alasan: 'Alasan yang lain sekali' }).error, /isi berbeda/);
  assert.match(f.close({ reqId: 'close-req-0002' }).error, /Hanya PO aktif/);
});

test('a closed PO can still be edited and archived through the form, and reopening brings the leftover back', () => {
  const f = fixture();
  f.count(f.report('close-rep-0001', 60), 60);
  assert.equal(f.close().ok, true);
  /* the edit form sends status selesai again; it no longer asks for complete production */
  const snap = f.po();
  f.good('savePO', { po: { ...snap, catatan: 'Ditutup, catatan owner' } });
  assert.equal(f.po().catatan, 'Ditutup, catatan owner'); assert.equal(f.po().status, 'selesai');
  assert.ok(f.po().tutupSisa, 'editing keeps the closure'); assert.equal(f.po().catatan, 'Ditutup, catatan owner');
  f.good('setStatusPO', { id: 'close-po-0001', status: 'aktif' });
  assert.equal(f.po().status, 'aktif'); assert.equal(f.po().tutupSisa, '', 'reopening drops the closure');
  assert.equal(f.po().agg.maklon.closesewer01.sisa, 40, 'the leftover is live work again');
  f.bad('setStatusPO', { id: 'close-po-0001', status: 'selesai' }, /PO belum selesai/, f.owner);
  /* closed again, then reopened through the edit form */
  assert.equal(f.close({ reqId: 'close-req-0003' }).ok, true);
  f.good('savePO', { po: { ...f.po(), status: 'aktif' } });
  assert.equal(f.po().status, 'aktif'); assert.equal(f.po().tutupSisa, '');
});

test('a PO whose production is complete is closed the normal way', () => {
  const f = fixture();
  f.count(f.report('close-rep-0001', 100), 100);
  f.good('createQC', { qc: { id: 'close-qc-0001', poId: 'close-po-0001', setorId: 'close-rep-0001', ukuran: { L: 100 }, tanggal: '2026-08-12' } }, f.qc);
  assert.equal(f.po().workflow.complete, true);
  assert.match(f.close().error, /Tandai selesai/);
  f.good('setStatusPO', { id: 'close-po-0001', status: 'selesai' });
  assert.equal(f.po().status, 'selesai');
});

test('a PO whose wages are held for review cannot be closed, because closing would release them', () => {
  const f = fixture();
  /* the active-size list is invalid: the cutting evidence needs the owner's review, and that issue only counts while the PO is active */
  f.h.run(`pkStore_().lock(function(){ pkStore_().update('PO','close-po-0001',{ukuranAktif:'["L","L"]'}); });`);
  const st = f.good('getState'), held = st.payroll.filter(r => r.poId === 'close-po-0001');
  assert.ok(held.length && held.every(r => r.available === 0 && r.needsReview), 'the cutting wage is on hold');
  assert.match(f.close().error, /Upah di PO ini masih ditahan sampai catatannya diperiksa owner: Bukti ukuran potong asal perlu diperiksa owner\./);
  assert.equal(f.po().status, 'aktif'); assert.equal(f.po().tutupSisa, '', 'no mark is left behind');
  assert.deepEqual(f.good('getState').payroll, st.payroll, 'the hold stays');
});

test('the mark lives on each PO row, so closing many old POs never fills a shared list', () => {
  const f = fixture();
  f.h.run(`pkStore_().lock(function(){ for (var i = 0; i < 150; i++) pkStore_().append('PO',{id:'close-many-'+(1000+i),noPO:'PO-M'+i,jenis:'stok',nama:'Fixture Banyak '+i,ukuran:'{"L":10}',total:10,status:'aktif',dibuat:'2026-08-01T00:00:00.000Z'}); });`);
  const alasan = 'Barang lama sudah habis terjual dan sisa di penjahit tidak ada lagi. '.repeat(3).slice(0, 200);
  for (let i = 0; i < 150; i++) { const r = f.call('tutupSisaPO', { id: 'close-many-' + (1000 + i), reqId: 'close-many-req-' + (1000 + i), alasan }); assert.equal(r.ok, true, r.error); }
  assert.equal(f.raw('PO').filter(r => r.status === 'selesai' && r.tutupSisa).length, 150);
  assert.equal(f.good('getState').settings.poTutupSisa, undefined, 'nothing is kept in the shared settings');
});

test('a normal finish clears a leftover mark in the same write', () => {
  const f = fixture();
  f.h.run(`pkStore_().lock(function(){
    pkStore_().append('PO',{id:'close-po-0002',noPO:'PO-T2',jenis:'stok',nama:'Fixture Lain',ukuran:'{"L":10}',total:10,status:'aktif',dibuat:'2026-08-01T00:00:00.000Z',tutupSisa:'{"id":"stale-req-003","alasan":"Tanda lama","oleh":"x","pada":"2026-01-01T00:00:00.000Z","tanggal":"2026-01-01"}'});
    pkStore_().append('Potong',{id:'close-cut-002',poId:'close-po-0002',userId:'closeqc00001',tanggal:'2026-08-02',ukuran:'{"L":10}',total:10,tarif:1000,dibuat:'2026-08-02T00:00:00.000Z'});
  });`);
  const sewer = f.sewer, qc = f.qc;
  f.good('createKirim', { kirim: { id: 'close-send-02', poId: 'close-po-0002', maklonId: 'closesewer01', ukuran: { L: 10 }, tanggal: '2026-08-03' } });
  const rev = () => f.good('getState').setor.find(r => r.id === 'close-rep-0009').revision;
  f.good('createSetor', { setor: { id: 'close-rep-0009', poId: 'close-po-0002', ukuran: { L: 10 }, tanggal: '2026-08-10' } }, sewer);
  f.good('prosesSetor', { id: 'close-rep-0009', expectedRevision: rev(), keputusan: 'terima', ukuran: { L: 10 }, tanggal: '2026-08-11' }, qc);
  f.good('createQC', { qc: { id: 'close-qc-0009', poId: 'close-po-0002', setorId: 'close-rep-0009', ukuran: { L: 10 }, tanggal: '2026-08-12' } }, qc);
  f.good('setStatusPO', { id: 'close-po-0002', status: 'selesai' });
  const row = f.raw('PO').find(r => r.id === 'close-po-0002');
  assert.equal(row.status, 'selesai'); assert.equal(row.tutupSisa, '', 'a normally finished PO carries no closure');
});

test('an import never brings a closure mark; only the owner\'s button writes one', () => {
  const f = fixture(), today = new Date().toISOString().slice(0, 10);
  const mark = JSON.stringify({ id: 'forged-mark-01', alasan: 'Sisa sudah habis kata owner', oleh: 'x', pada: new Date().toISOString(), tanggal: today });
  const base = { jenis: 'stok', nama: 'Fixture Impor', ukuran: { L: 10 }, total: 10, status: 'selesai', selesaiPada: today, dibuat: '2026-08-01T00:00:00.000Z' };
  for (const token of [f.admin, f.owner]) f.good('importRows', { sheet: 'PO', rows: [{ id: 'imp-po-' + token.slice(-6).replace(/[^A-Za-z0-9]/g, 'x'), noPO: 'PO-IM-' + token.slice(-4), ...base, tutupSisa: mark }] }, token);
  const imported = f.raw('PO').filter(r => /^imp-po-/.test(r.id));
  assert.equal(imported.length, 2); assert.ok(imported.every(r => r.tutupSisa === ''), 'the mark is dropped on import, for admin and owner alike');
});

test('a closed mark is honoured only while the PO stays finished from that same day', () => {
  const f = fixture();
  assert.equal(f.close().ok, true);
  /* a stale mark from an earlier closing does not excuse a PO finished on another day */
  f.h.run(`pkStore_().lock(function(){ pkStore_().update('PO','close-po-0001',{selesaiPada:'2026-01-01'}); });`);
  f.bad('savePO', { po: { ...f.po(), catatan: 'Tanda lama' } }, /PO belum selesai/);
});
