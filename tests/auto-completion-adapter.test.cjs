'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');
const moduleSource = fs.readFileSync(path.resolve(__dirname, '../src/auto-completion.js'), 'utf8');
const START = '2026-10-08T01:02:03.000Z';
const WEEK = 7 * 24 * 60 * 60 * 1000;

function fixture() {
  const h = harness();
  vm.runInContext(moduleSource, h.context);
  h.context.AUTO_TEST_NOW = START;
  h.run(`var originalTestEnv=pkEnv_;pkEnv_=function(){var e=originalTestEnv();e.now=function(){return new Date(AUTO_TEST_NOW);};return e;};
    var autoTestWorkflowCalls=0,originalTestWorkflow=coreWorkflow;coreWorkflow=function(){autoTestWorkflowCalls++;return originalTestWorkflow.apply(null,arguments);};void 0;`);
  const owner = h.request('setupOwner', { nama: 'Pemilik Contoh', pin: '1234' });
  assert.equal(owner.ok, true, owner.error);
  const token = owner.data.token;
  h.run(`pkStore_().lock(function(){
    pkStore_().append('Pegawai',{id:'sewer001',nama:'Penjahit Contoh',divisi:'jahit',aktif:true,pin:'1234',token:'worker_session_example_1234'});
    pkStore_().append('Pegawai',{id:'cutter01',nama:'Pemotong Contoh',divisi:'potong',aktif:true});
    pkStore_().append('PO',{id:'po_complete01',noPO:'PO-TEST-001',nama:'Produk Contoh',status:'aktif',ukuran:{M:5},total:5,dibuat:'2025-01-01T00:00:00.000Z',asal:'baru'});
    pkStore_().append('Potong',{id:'cut00001',poId:'po_complete01',userId:'cutter01',ukuran:{M:5},total:5,tarif:100,upahId:'LAMA',tanggal:'2025-01-01'});
    pkStore_().append('SlipKirim',{id:'send0001',poId:'po_complete01',maklonId:'sewer001',ukuran:{M:5},total:5,upah:1000,tanggal:'2025-01-02'});
    pkStore_().append('SlipSetor',{id:'count001',poId:'po_complete01',maklonId:'sewer001',ukuran:{M:5},total:5,upah:1000,upahId:'paid0001',status:'diterima',workflowVersion:2,tanggal:'2025-01-03'});
    pkStore_().append('QC',{id:'qc000001',poId:'po_complete01',maklonId:'sewer001',setorId:'count001',ukuran:{M:5},total:5,workflowVersion:2,tanggal:'2025-01-04'});
    pkStore_().append('SlipUpah',{id:'paid0001',pegawaiId:'sewer001',jenis:'jahit',itemIds:['count001'],items:[{sourceId:'count001',size:'M',total:5,rate:1000}],totalQty:5,totalUpah:5000,dibayar:5000});
  });`);
  function at(ms) { h.context.AUTO_TEST_NOW = new Date(Date.parse(START) + ms).toISOString(); }
  function call(action, payload = {}) { h.cold(); return h.request(action, { token, workflowVersion: 2, ...payload }); }
  function good(action, payload = {}) { const r = call(action, payload); assert.equal(r.ok, true, r.error); return r.data; }
  function row() { h.cold(); return h.run('pkStore_().read("PO")[0]'); }
  function businessSnapshot() { return JSON.stringify(Object.fromEntries(['Potong','SlipKirim','SlipSetor','QC','Gudang','GudangLama','SlipUpah','LegacySettlement','KoreksiRiwayat'].map(n => [n, h.sheets[n].values]))); }
  return { h, token, ownerId: owner.data.state.me.id, at, call, good, row, businessSnapshot };
}

test('real Sheets first sight starts the timer and same-version sync closes exactly seven elapsed days later without rewriting business evidence', () => {
  const f = fixture(), before = f.businessSnapshot();
  const first = f.good('getState');
  assert.equal(first.po[0].workflow.complete, true);
  assert.equal(f.row().status, 'aktif');
  assert.equal(f.row().tuntasPada, START, 'old source dates must not retroactively close existing POs');
  f.at(WEEK - 1);
  const writes = f.h.sheets.PO.writes;
  assert.equal(f.good('sync', { ver: first.ver }).same, true);
  assert.equal(f.h.sheets.PO.writes, writes);
  f.at(WEEK);
  const due = f.good('sync', { ver: first.ver });
  assert.notEqual(due.same, true);
  assert.equal(f.row().status, 'selesai');
  assert.equal(f.row().selesaiPada, '2026-10-15');
  assert.equal(f.row().tuntasPada, START);
  assert.equal(f.h.sheets.PO.writes, writes + 1);
  assert.equal(f.businessSnapshot(), before);
  assert.equal(f.h.isLocked(), false);
});

test('held source and pending migration never cause automatic completion, including from a stale due timer', () => {
  const f = fixture();
  f.good('getState'); f.at(WEEK);
  f.h.run(`pkStore_().lock(function(){pkStore_().update('PO','po_complete01',{imporReview:'Bukti perlu ditinjau',imporSumber:{legacyReconciliation:{mode:'review'}}});});`);
  f.good('getState');
  assert.equal(f.row().status, 'aktif'); assert.equal(f.row().tuntasPada, '');
  f.h.run(`pkStore_().lock(function(){pkStore_().update('PO','po_complete01',{imporReview:'',imporSumber:'',tuntasPada:${JSON.stringify(START)}});pkStore_().setSettings({legacyMigrationStatus:{batchId:'pending001'}});});`);
  const writes = f.h.sheets.PO.writes;
  const state = f.good('sync', { ver: Number(f.h.properties.ver) });
  assert.equal(state.settings.legacyMigrationStatus.batchId, 'pending001');
  assert.equal(f.row().status, 'aktif'); assert.equal(f.row().tuntasPada, START);
  assert.equal(f.h.sheets.PO.writes, writes, 'pending recovery prohibits even timer metadata writes');
});

test('fresh physical evidence under the lock overrules a cached complete candidate', () => {
  const f = fixture(); f.good('getState'); f.at(WEEK);
  const q = f.h.sheets.QC, cols = q.values[0];
  q.values[1][cols.indexOf('ukuran')] = '{"M":4}'; q.values[1][cols.indexOf('total')] = 4;
  q.values[1][cols.indexOf('perbaikan')] = 1; q.values[1][cols.indexOf('perbaikanUkuran')] = '{"M":1}';
  // Deliberately retain cache/version as a timeout or unseen external edit could.
  const before = f.businessSnapshot(), state = f.good('getState');
  assert.equal(state.po[0].workflow.complete, false);
  assert.equal(f.row().status, 'aktif'); assert.equal(f.row().tuntasPada, '');
  assert.equal(f.businessSnapshot(), before);
});

test('reopening a completed PO starts a new full waiting period', () => {
  const f = fixture(); f.good('getState'); f.at(WEEK); f.good('getState');
  f.at(WEEK + 3600000);
  f.good('setStatusPO', { id: 'po_complete01', status: 'aktif' });
  const reopenedAt = new Date(Date.parse(START) + WEEK + 3600000).toISOString();
  assert.equal(f.row().status, 'aktif'); assert.equal(f.row().tuntasPada, reopenedAt); assert.equal(f.row().selesaiPada, '');
  f.at(2 * WEEK + 3600000 - 1); f.good('getState'); assert.equal(f.row().status, 'aktif');
  f.at(2 * WEEK + 3600000); f.good('getState'); assert.equal(f.row().status, 'selesai');
});

test('automatic completion reauthenticates after its lock checkpoint and never exposes owner data to workers', () => {
  const f = fixture(); f.good('getState'); f.at(WEEK);
  const peg = f.h.sheets.Pegawai, cols = peg.values[0], who = peg.values.find(r => r[cols.indexOf('id')] === f.ownerId);
  who[cols.indexOf('token')] = 'replacement_session_not_cached';
  const writes = f.h.sheets.PO.writes, blocked = f.call('getState');
  assert.equal(blocked.ok, false); assert.match(blocked.error, /Sesi berakhir/);
  assert.equal(f.h.sheets.PO.writes, writes);
  const worker = f.good('getState', { token: 'worker_session_example_1234' });
  assert.equal(worker.me.divisi, 'jahit');
  assert.ok(worker.payroll.every(r => r.pegawaiId === 'sewer001'));
  assert.equal(worker.kasbon.every(r => r.orangId === 'sewer001'), true);
  assert.ok(worker.users.every(r => !Object.hasOwn(r, 'pin') && !Object.hasOwn(r, 'token')));
  assert.equal(f.row().status, 'selesai');
});

test('normal state without a due transition computes workflow once and unchanged sync computes none', () => {
  const f = fixture(); f.good('getState');
  f.h.run('autoTestWorkflowCalls=0;');
  const state = f.good('getState');
  assert.equal(f.h.run('autoTestWorkflowCalls'), 1);
  f.h.run('autoTestWorkflowCalls=0;');
  assert.equal(f.good('sync', { ver: state.ver }).same, true);
  assert.equal(f.h.run('autoTestWorkflowCalls'), 0);
});
