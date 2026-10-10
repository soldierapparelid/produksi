'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');

/* The owner moves a sewer's finish target for one PO; quantities, prices and wages stay untouched.
   Real Sheets adapter, cold request objects, invented fixtures only. */
function fixture() {
  const h = harness();
  for (const name of ['bahan-invoice', 'cutting-plans', 'auto-completion', 'reconcile-legacy', 'history-corrections']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src', name + '.js'), 'utf8'), h.context);
  }
  const setup = h.request('setupOwner', { nama: 'Fixture Owner', pin: '1234' });
  assert.equal(setup.ok, true, setup.error);
  const owner = setup.data.token, sewer = 'fixture-target-sewer-token', admin = 'fixture-target-admin-token';
  h.run(`pkStore_().lock(function(){
    pkStore_().append('Pegawai',{id:'targetsewer01',nama:'Fixture Sewer',divisi:'jahit',aktif:true,token:'${sewer}',pin:'fixture-pin-hash'});
    pkStore_().append('Pegawai',{id:'targetsewer02',nama:'Fixture Sewer Two',divisi:'jahit',aktif:true});
    pkStore_().append('Pegawai',{id:'targetadmin01',nama:'Fixture Admin',divisi:'admin',aktif:true,token:'${admin}'});
    pkStore_().append('PO',{id:'target-po-0001',noPO:'PO-T1',jenis:'stok',nama:'Fixture Target',ukuran:'{"M":100}',total:100,status:'aktif',dibuat:'2026-08-01T00:00:00.000Z'});
    pkStore_().append('Potong',{id:'target-cut-001',poId:'target-po-0001',userId:'targetadmin01',tanggal:'2026-08-02',ukuran:'{"M":100}',total:100,tarif:1000,dibuat:'2026-08-02T00:00:00.000Z'});
    pkStore_().append('SlipKirim',{id:'target-send-01',noSlip:'SK-1',poId:'target-po-0001',maklonId:'targetsewer01',tanggal:'2026-08-03',target:'2026-08-20',ukuran:'{"M":40}',total:40,upah:9000,dibuat:'2026-08-03T00:00:00.000Z'});
    pkStore_().append('SlipKirim',{id:'target-send-02',noSlip:'SK-2',poId:'target-po-0001',maklonId:'targetsewer01',tanggal:'2026-08-10',target:'2026-08-29',ukuran:'{"M":30}',total:30,upah:9000,dibuat:'2026-08-10T00:00:00.000Z'});
    pkStore_().append('SlipKirim',{id:'target-send-03',noSlip:'SK-3',poId:'target-po-0001',maklonId:'targetsewer02',tanggal:'2026-08-10',target:'2026-09-05',ukuran:'{"M":30}',total:30,upah:9000,dibuat:'2026-08-10T00:00:01.000Z'});
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
  const targets = () => Object.fromEntries(raw('SlipKirim').map(r => [r.id, r.target]));
  const shown = id => good('getState').po.find(p => p.id === 'target-po-0001').agg.maklon[id].target;
  return { h, owner, sewer, admin, call, good, bad, raw, targets, shown };
}
const KEY = { poId: 'target-po-0001', maklonId: 'targetsewer01' };

test('a later target replaces the latest one only; an earlier target also pulls back the assignments that were later', () => {
  const f = fixture(), before = f.raw('SlipKirim');
  assert.equal(f.shown('targetsewer01'), '2026-08-29');
  assert.deepEqual(f.good('ubahTargetJahit', { ...KEY, target: '2026-10-20' }), { ok: true, target: '2026-10-20', diubah: 1 });
  assert.deepEqual(f.targets(), { 'target-send-01': '2026-08-20', 'target-send-02': '2026-10-20', 'target-send-03': '2026-09-05' });
  assert.equal(f.shown('targetsewer01'), '2026-10-20'); assert.equal(f.shown('targetsewer02'), '2026-09-05', 'another sewer keeps their own target');
  assert.equal(f.good('ubahTargetJahit', { ...KEY, target: '2026-10-20' }, f.admin).diubah, 0, 'the same date again changes nothing');
  assert.equal(f.good('ubahTargetJahit', { ...KEY, target: '2026-08-15' }).diubah, 2);
  assert.deepEqual(f.targets(), { 'target-send-01': '2026-08-15', 'target-send-02': '2026-08-15', 'target-send-03': '2026-09-05' });
  /* nothing but the target column moved */
  const strip = rows => rows.map(r => ({ ...r, target: '' }));
  assert.deepEqual(strip(f.raw('SlipKirim')), strip(before));
});

test('the target can be cleared, and only an admin may change it for an existing assignment with a sound date', () => {
  const f = fixture();
  f.bad('ubahTargetJahit', { ...KEY, target: '2026-10-20' }, /owner\/admin/, f.sewer);
  f.bad('ubahTargetJahit', { ...KEY, target: '20 Okt' }, /Tanggal target tidak sah/);
  f.bad('ubahTargetJahit', { poId: 'missing-po-0001', maklonId: 'targetsewer01', target: '2026-10-20' }, /PO tidak ditemukan/);
  f.bad('ubahTargetJahit', { poId: 'target-po-0001', maklonId: 'targetadmin01', target: '2026-10-20' }, /Belum ada penugasan/);
  assert.deepEqual(f.targets(), { 'target-send-01': '2026-08-20', 'target-send-02': '2026-08-29', 'target-send-03': '2026-09-05' });
  assert.deepEqual(f.good('ubahTargetJahit', { ...KEY, target: '' }), { ok: true, target: '', diubah: 2 });
  assert.equal(f.shown('targetsewer01'), ''); assert.equal(f.shown('targetsewer02'), '2026-09-05');
  assert.equal(f.good('ubahTargetJahit', { ...KEY, target: '2026-11-01' }).diubah, 1); assert.equal(f.shown('targetsewer01'), '2026-11-01');
});
