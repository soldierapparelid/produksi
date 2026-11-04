'use strict';
/* 1.5.75 review fixes. Invented data only. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');
const core = fs.readFileSync(path.resolve(__dirname, '../src/core.js'), 'utf8');

/* planner-shaped held settlements: two old payments (6 and 4 pcs) share one baseline count of 10 pcs */
const P = JSON.stringify({ baseline: true, skuId: 'k', siklus: 'current', field: 'hitungFisik', entryId: 'h' });
const setor = [{ id: 'cnt', poId: 'po', maklonId: 'w', tanggal: '2026-08-05', ukuran: { M: 10 }, total: 10, status: 'diterima', upah: 2000, workflowVersion: 1, imporSumber: P }];
const base = JSON.stringify([{ sourceId: 'cnt', size: 'M', qty: 10, rate: 2000 }]);
const st = (id, oldId, qty) => ({ id, sourceId: oldId, poId: 'po', maklonId: 'w', size: 'M', paymentRef: 'LAMA',
  sourceSnapshot: JSON.stringify({ id: oldId, poId: 'po', maklonId: 'w', total: qty, ukuran: { M: qty }, upah: 2000, upahId: 'LAMA' }),
  imporSumber: JSON.stringify({ baseline: true, skuId: 'k', siklus: 'current', field: 'jahit', entryId: 'j' + id }),
  baselineSources: base, resolution: 'hold', allocations: '[]', reason: 'Beberapa setoran lama berbagi kelompok hitungan.' });
function pay(settlements, decisions) {
  const c = vm.createContext({}); vm.runInContext(core, c);
  c.args = JSON.parse(JSON.stringify({ setor, settlements, decisions }));
  return JSON.parse(JSON.stringify(vm.runInContext('(function(){var r=corePayroll([],args.setor,[],[],{settlements:args.settlements,settlementDecisions:args.decisions,settlementState:{}});return r.map(function(x){return [x.total,x.paidQty,x.available,!!x.needsReview];})[0];})()', c)));
}
test('Sudah lunas credits only the pcs that old payment covered, even when payments share one baseline', () => {
  const two = [st('ls6', 'r6', 6), st('ls4', 'r4', 4)], one = [st('ls6', 'r6', 6)];
  assert.deepEqual(pay(two, []), [10, 0, 0, true], 'without a decision the hold stays as in 1.5.74');
  assert.deepEqual(pay(two, [{ settlementId: 'ls6', pilihan: 'lunas' }, { settlementId: 'ls4', pilihan: 'belum' }]), [10, 6, 4, false]);
  assert.deepEqual(pay(two, [{ settlementId: 'ls4', pilihan: 'lunas' }, { settlementId: 'ls6', pilihan: 'belum' }]), [10, 4, 6, false]);
  assert.deepEqual(pay(two, [{ settlementId: 'ls6', pilihan: 'lunas' }, { settlementId: 'ls4', pilihan: 'lunas' }]), [10, 10, 0, false]);
  assert.deepEqual(pay(two, [{ settlementId: 'ls6', pilihan: 'belum' }, { settlementId: 'ls4', pilihan: 'belum' }]), [10, 0, 10, false]);
  assert.deepEqual(pay(one, [{ settlementId: 'ls6', pilihan: 'lunas' }]), [10, 6, 4, false], 'only the 6 paid pcs are credited; 4 stay payable');
});
test('no first price on a count whose QC was recorded together with another count', () => {
  const c = vm.createContext({}); vm.runInContext(core, c);
  c.s = { id: 'a', status: 'diterima', upah: 0 };
  c.qc = [{ setorId: 'a', maklonId: 'w1', qcBatchId: 'b1' }, { setorId: 'b', maklonId: 'w1', qcBatchId: 'b1' }];
  assert.equal(vm.runInContext('coreSetorHargaPertama(s, qc)', c), false, 'two counts of the same tailor shared one QC split');
  c.qc = [{ setorId: 'a', maklonId: 'w1', qcBatchId: 'b1' }, { setorId: 'b', maklonId: 'w2', qcBatchId: 'b1' }];
  assert.equal(vm.runInContext('coreSetorHargaPertama(s, qc)', c), true, 'another tailor in the same save is a separate group');
  c.qc = [{ setorId: 'a', qcBatchId: 'b2' }, { setorId: 'a', qcBatchId: '' }];
  assert.equal(vm.runInContext('coreSetorHargaPertama(s, qc)', c), true, 'a batch that only holds this count is fine');
});
function fixture() {
  const h = harness();
  for (const name of ['bahan-invoice', 'cutting-plans', 'auto-completion', 'reconcile-legacy', 'history-corrections']) vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src', name + '.js'), 'utf8'), h.context);
  const setup = h.request('setupOwner', { nama: 'Fixture Owner', pin: '1234' });
  assert.equal(setup.ok, true, setup.error);
  const owner = setup.data.token;
  h.run(`pkStore_().lock(function(){
    pkStore_().append('Pegawai',{id:'rvwboth00001',nama:'Fixture Dua Peran',divisi:'potong',aktif:true,token:'fixture-rvw-both-token',pin:'fixture-pin-hash'});
    pkStore_().append('PO',{id:'rvw-po-00001',noPO:'PO-RV1',jenis:'stok',nama:'Fixture',ukuran:'{"L":10}',total:10,status:'aktif',dibuat:'2026-08-01T00:00:00.000Z'});
    pkStore_().append('Potong',{id:'rvw-cut-0001',poId:'rvw-po-00001',userId:'rvwboth00001',tanggal:'2026-08-02',ukuran:'{"L":10}',total:10,tarif:1000,dibuat:'2026-08-02T00:00:00.000Z'});
    pkStore_().append('SlipKirim',{id:'rvw-send-001',noSlip:'SK-RV1',poId:'rvw-po-00001',maklonId:'rvwboth00001',tanggal:'2026-08-03',ukuran:'{"L":10}',total:10,upah:9000,dibuat:'2026-08-03T00:00:00.000Z'});
  });`);
  function call(action, payload = {}) { h.cold(); return h.request(action, { token: owner, workflowVersion: 2, ...payload }); }
  return { h, call };
}
test('a waiting report tied to an old payment does not block Tutup sisa PO lama; a normal waiting report still does', () => {
  const f = fixture();
  f.h.run(`pkStore_().lock(function(){
    pkStore_().update('Pegawai','rvwboth00001',{divisi:'jahit'});
    pkStore_().append('SlipSetor',{id:'rvw-rep-lama1',noSlip:'',poId:'rvw-po-00001',maklonId:'rvwboth00001',tanggal:'2026-08-05',ukuran:'{"L":3}',total:3,reject:0,upah:9000,status:'diajukan',dibuat:'2026-08-05T00:00:00.000Z'});
    pkStore_().append('LegacySettlement',{id:'rvw-ls-0001',sourceId:'rvw-old-pay1',poId:'rvw-po-00001',maklonId:'rvwboth00001',size:'L',paymentRef:'LAMA',baselineSources:JSON.stringify([{sourceId:'rvw-rep-lama1',size:'L',qty:3,rate:9000}]),resolution:'hold',allocations:'[]',reason:'Fixture tahanan lama'});
  });`);
  const st = f.call('getState').data;
  assert.equal(st.setor.find(r => r.id === 'rvw-rep-lama1').terikatBayarLama, true, 'the owner state marks the bound report');
  const po = st.po.find(p => p.id === 'rvw-po-00001');
  const ok = f.call('tutupSisaPO', { id: 'rvw-po-00001', reqId: 'rvw-close-0001', alasan: 'Barang lama sudah habis', expectedRevision: po.revision });
  assert.equal(ok.ok, true, ok.error);
  /* a normal waiting report on another PO still blocks */
  f.h.run(`pkStore_().lock(function(){
    pkStore_().append('PO',{id:'rvw-po-00002',noPO:'PO-RV2',jenis:'stok',nama:'Fixture 2',ukuran:'{"L":10}',total:10,status:'aktif',dibuat:'2026-08-01T00:00:00.000Z'});
    pkStore_().append('Potong',{id:'rvw-cut-0002',poId:'rvw-po-00002',userId:'rvwboth00001',tanggal:'2026-08-02',ukuran:'{"L":10}',total:10,tarif:1000,dibuat:'2026-08-02T00:00:00.000Z'});
    pkStore_().append('SlipKirim',{id:'rvw-send-002',noSlip:'SK-RV2',poId:'rvw-po-00002',maklonId:'rvwboth00001',tanggal:'2026-08-03',ukuran:'{"L":10}',total:10,upah:9000,dibuat:'2026-08-03T00:00:00.000Z'});
    pkStore_().append('SlipSetor',{id:'rvw-rep-baru1',noSlip:'',poId:'rvw-po-00002',maklonId:'rvwboth00001',tanggal:'2026-08-05',ukuran:'{"L":3}',total:3,reject:0,upah:9000,status:'diajukan',dibuat:'2026-08-05T00:00:00.000Z',workflowVersion:2});
  });`);
  const po2 = f.call('getState').data.po.find(p => p.id === 'rvw-po-00002');
  assert.match(f.call('tutupSisaPO', { id: 'rvw-po-00002', reqId: 'rvw-close-0002', alasan: 'Barang lama sudah habis', expectedRevision: po2.revision }).error, /laporan setor yang menunggu dihitung/);
});

test('a person whose rows need both roles can be switched between them, but not to another divisi', () => {
  const f = fixture(), user = () => f.call('getState').data.users.find(u => u.id === 'rvwboth00001');
  const ok = f.call('saveUser', { user: { ...user(), divisi: 'jahit' } }); assert.equal(ok.ok, true, ok.error);
  assert.equal(user().divisi, 'jahit');
  const po = f.call('getState').data.po.find(p => p.id === 'rvw-po-00001');
  assert.equal((po.workflow.blockingIssues || []).length, 0, 'as a tailor again, the PO is not blocked');
  assert.match(f.call('saveUser', { user: { ...user(), divisi: 'qc' } }).error, /tidak bisa diganti/);
  /* moving to Tukang Potong is refused while the person has sewing rows on any PO made in this app, open or closed,
     because those POs (and every wage on them) would be held */
  assert.match(f.call('saveUser', { user: { ...user(), divisi: 'potong' } }).error, /catatan jahit di PO aplikasi ini/);
  f.h.run(`pkStore_().lock(function(){ pkStore_().update('PO','rvw-po-00001',{status:'batal'}); });`);
  assert.match(f.call('saveUser', { user: { ...user(), divisi: 'potong' } }).error, /catatan jahit di PO aplikasi ini/);
  assert.equal(user().divisi, 'jahit');
});

test('an old waiting report is refused while its old payment is held, and can be rejected after the owner decides', () => {
  const f = fixture();
  f.h.run(`pkStore_().lock(function(){
    pkStore_().update('Pegawai','rvwboth00001',{divisi:'jahit'});
    pkStore_().append('SlipSetor',{id:'rvw-rep-lama2',noSlip:'',poId:'rvw-po-00001',maklonId:'rvwboth00001',tanggal:'2026-08-05',ukuran:'{"L":3}',total:3,reject:0,upah:9000,status:'diajukan',dibuat:'2026-08-05T00:00:00.000Z'});
    pkStore_().append('LegacySettlement',{id:'rvw-ls-0002',sourceId:'rvw-old-pay2',poId:'rvw-po-00001',maklonId:'rvwboth00001',size:'L',paymentRef:'LAMA',baselineSources:JSON.stringify([{sourceId:'rvw-rep-lama2',size:'L',qty:3,rate:9000}]),resolution:'hold',allocations:'[]',reason:'Fixture tahanan lama'});
  });`);
  const tolak = () => f.call('prosesSetor', { id: 'rvw-rep-lama2', keputusan: 'tolak', tanggal: '2026-08-10' });
  assert.match(tolak().error, /owner perlu mencocokkannya dulu di menu Upah/);
  const d = f.call('cocokkanPembayaranLama', { id: 'rvw-ls-0002', reqId: 'rvw-cocok-0001', pilihan: 'belum', alasan: 'Belum pernah dibayar' });
  assert.equal(d.ok, true, d.error);
  const r = tolak(); assert.equal(r.ok, true, r.error);
});
