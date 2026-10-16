'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');

/* 1.5.44: owner/admin returns a wrongly counted sewing report to Hitung fisik. Nothing is deleted.
   Real Sheets adapter, cold request objects, invented fixtures only. */
function fixture() {
  const h = harness();
  for (const name of ['bahan-invoice', 'cutting-plans', 'auto-completion', 'reconcile-legacy', 'history-corrections']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src', name + '.js'), 'utf8'), h.context);
  }
  const setup = h.request('setupOwner', { nama: 'Fixture Owner', pin: '1234' });
  assert.equal(setup.ok, true, setup.error);
  const owner = setup.data.token, sewer = 'fixture-undo-sewer-token', qc = 'fixture-undo-qc-token';
  h.run(`pkStore_().lock(function(){
    pkStore_().append('Pegawai',{id:'undosewer01',nama:'Fixture Sewer',divisi:'jahit',aktif:true,token:'${sewer}',pin:'fixture-pin-hash'});
    pkStore_().append('Pegawai',{id:'undoqc00001',nama:'Fixture QC',divisi:'qc',aktif:true,token:'${qc}',pin:'fixture-pin-hash'});
    pkStore_().append('PO',{id:'undo-po-00001',noPO:'PO-U1',jenis:'stok',nama:'Fixture Undo',ukuran:'{"L":100}',total:100,status:'aktif',dibuat:'2026-08-01T00:00:00.000Z'});
    pkStore_().append('Potong',{id:'undo-cut-0001',poId:'undo-po-00001',userId:'undoqc00001',tanggal:'2026-08-02',ukuran:'{"L":100}',total:100,tarif:1000,dibuat:'2026-08-02T00:00:00.000Z'});
    pkStore_().append('SlipKirim',{id:'undo-send-001',noSlip:'SK-U1',poId:'undo-po-00001',maklonId:'undosewer01',tanggal:'2026-08-03',ukuran:'{"L":100}',total:100,upah:9000,dibuat:'2026-08-03T00:00:00.000Z'});
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
  const row = id => raw('SlipSetor').find(r => r.id === id);
  const revision = id => good('getState').setor.find(r => r.id === id).revision;
  function report(id, l = 76, catatan = '') { good('createSetor', { setor: { id, poId: 'undo-po-00001', ukuran: { L: l }, tanggal: '2026-08-10', catatan } }, sewer); return id; }
  function count(id, l = 76) { good('prosesSetor', { id, expectedRevision: revision(id), keputusan: 'terima', ukuran: { L: l }, tanggal: '2026-08-11' }, qc); return row(id); }
  return { h, owner, sewer, qc, call, good, bad, raw, row, revision, report, count };
}

test('the owner returns a counted report to Hitung fisik; count, slip number and price stay, nothing is deleted, and QC can count it again', () => {
  const f = fixture(), id = f.report('undo-report-0001', 76, 'barang putih');
  const counted = f.count(id);
  assert.equal(counted.status, 'diterima'); assert.ok(counted.noSlip); assert.ok(Number(counted.upah) > 0);
  const before = f.raw('SlipSetor').length;
  f.good('batalHitungSetor', { id, expectedRevision: f.revision(id) });
  const back = f.row(id);
  assert.equal(back.status, 'diajukan'); assert.equal(back.diprosesOleh, ''); assert.equal(back.diprosesPada, '');
  assert.equal(back.noSlip, counted.noSlip); assert.equal(Number(back.upah), Number(counted.upah)); assert.equal(back.tanggal, counted.tanggal);
  assert.deepEqual(JSON.parse(back.ukuran), { L: 76 }); assert.equal(Number(back.total), 76);
  assert.match(back.catatan, /^barang putih Â· Hitungan .+ dibatalkan Fixture Owner \d{4}-\d{2}-\d{2}$/);
  assert.equal(f.raw('SlipSetor').length, before, 'no row is added or removed');
  const state = f.good('getState');
  assert.equal(state.setor.find(r => r.id === id).status, 'diajukan', 'the report waits in Hitung fisik again');
  assert.equal((state.payroll || []).filter(r => r.sourceId === id).length, 0, 'no wage is owed for a report that is not counted');
  const again = f.count(id, 70);
  assert.equal(again.status, 'diterima'); assert.equal(again.noSlip, counted.noSlip, 'the slip keeps its number'); assert.equal(Number(again.total), 70);
});

test('a repeated request is answered once, and only owner/admin may undo a count that has no QC, no payment and came from the sewer', () => {
  const f = fixture(), id = f.report('undo-report-0002');
  f.bad('batalHitungSetor', { id, expectedRevision: f.revision(id) }, /belum dihitung/);
  f.count(id);
  const rev = f.revision(id);
  f.bad('batalHitungSetor', { id, expectedRevision: rev }, /owner\/admin/, f.qc);
  f.bad('batalHitungSetor', { id, expectedRevision: rev }, /owner\/admin/, f.sewer);
  f.bad('batalHitungSetor', { id: 'missing-report-01', expectedRevision: rev }, /tidak ditemukan/);
  f.good('batalHitungSetor', { id, expectedRevision: rev });
  f.good('batalHitungSetor', { id, expectedRevision: rev });
  assert.equal(f.row(id).status, 'diajukan'); assert.equal((f.row(id).catatan.match(/dibatalkan/g) || []).length, 1, 'the note is written once');
  f.count(id);
  f.bad('batalHitungSetor', { id, expectedRevision: rev }, /berubah sejak formulir dibuka/);

  const paid = f.report('undo-report-0003', 10); f.count(paid, 10);
  f.h.run(`pkStore_().lock(function(){pkStore_().update('SlipSetor','${paid}',{upahId:'fixture-wage-slip'});});`);
  f.bad('batalHitungSetor', { id: paid, expectedRevision: f.revision(paid) }, /pembayaran upah/);

  f.good('createSetor', { setor: { id: 'undo-direct-0001', poId: 'undo-po-00001', maklonId: 'undosewer01', ukuran: { L: 5 }, tanggal: '2026-08-12' } }, f.qc);
  f.bad('batalHitungSetor', { id: 'undo-direct-0001', expectedRevision: f.revision('undo-direct-0001') }, /dicatat langsung/);
  assert.equal(f.row('undo-direct-0001').status, 'diterima');
  f.h.run(`pkStore_().lock(function(){pkStore_().append('QC',{id:'undo-qc-000001',poId:'undo-po-00001',setorId:'${id}',userId:'undoqc00001',tanggal:'2026-08-12',ukuran:'{"L":76}',total:76,dibuat:'2026-08-12T00:00:00.000Z'});});`);
  f.bad('batalHitungSetor', { id, expectedRevision: f.revision(id) }, /sudah di-QC/);
  assert.equal(f.row(id).status, 'diterima');
});
