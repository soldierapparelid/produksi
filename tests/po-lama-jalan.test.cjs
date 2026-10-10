const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = ['core.js', 'reconcile-legacy.js', 'history-corrections.js'].map(f => fs.readFileSync(path.join(root, 'src', f), 'utf8')).join('\n');

/* A PO carried over from the old app whose old records are untidy must not stop new work on it: assigning, receiving,
   counting, QC and BigSeller go on, each within its own quantity limit. Only wages that come from the old records stay
   held. A PO made in this app still stops when its records do not add up. Invented fixtures only. */
const REVIEW = 'M: Impor belum dijalankan: SERI / FIXTURE LAMA / M / aktif. Gudang lama menunjuk QC yang hilang; perlu direkonsiliasi. Periksa catatan asal dahulu; tidak ada jumlah atau pembayaran yang ditebak.';
function app() {
  const ctx = vm.createContext({});
  vm.runInContext(source + `
    var db={}, config={}, version=1, urut=0;
    Object.keys(SCHEMA).forEach(function(s){db[s]=[];});
    db.Pegawai=[{id:'owner01',divisi:'owner',nama:'Owner',aktif:true,token:'owner-token-123456789'},{id:'qcuser1',divisi:'qc',nama:'Pemeriksa',aktif:true,token:'qcuser-token-12345678'},{id:'cutter1',divisi:'potong',nama:'Pemotong',aktif:true,token:'cutter-token-12345678'},{id:'worker1',divisi:'jahit',nama:'Penjahit Satu',aktif:true,token:'worker-token-12345678'},{id:'worker2',divisi:'jahit',nama:'Penjahit Dua',aktif:true,token:'worker-token-22345678'}];
    db.PO=[
      {id:'polama1',noPO:'PO-L1',nama:'Fixture Lama',status:'aktif',ukuran:JSON.stringify({M:100,L:80,XL:60}),total:240,asal:'lama',imporReview:${JSON.stringify(REVIEW)},imporSumber:JSON.stringify({legacyReconciliation:{mode:'review',sourceHash:'fixturehash',batchId:'batch001'}})},
      {id:'pobaru1',noPO:'PO-B1',nama:'Fixture Baru',status:'aktif',ukuran:JSON.stringify({M:50,L:50}),total:100}
    ];
    db.Potong=[
      {id:'cutlama1',poId:'polama1',userId:'cutter1',tanggal:'2026-09-01',ukuran:JSON.stringify({M:100,L:80,XL:60}),total:240,tarif:500,asal:'lama'},
      {id:'cutbaru1',poId:'pobaru1',userId:'cutter1',tanggal:'2026-10-01',ukuran:JSON.stringify({M:50,L:50}),total:100,tarif:500}
    ];
    db.SlipKirim=[
      {id:'sendlamaM',noSlip:'SK-1',poId:'polama1',maklonId:'worker1',tanggal:'2026-09-02',ukuran:JSON.stringify({M:100}),total:100,upah:2000,asal:'lama',dibuat:'2026-09-02T00:00:00.000Z'},
      {id:'sendlamaL',noSlip:'SK-2',poId:'polama1',maklonId:'worker1',tanggal:'2026-09-03',ukuran:JSON.stringify({L:80}),total:80,upah:2000,asal:'lama',dibuat:'2026-09-03T00:00:00.000Z'},
      {id:'sendbaruM',noSlip:'SK-3',poId:'pobaru1',maklonId:'worker1',tanggal:'2026-10-02',ukuran:JSON.stringify({M:50}),total:50,upah:2000,dibuat:'2026-10-02T00:00:00.000Z'}
    ];
    db.SlipSetor=[
      {id:'setorlamaM',noSlip:'SS-1',poId:'polama1',maklonId:'worker1',tanggal:'2026-09-10',ukuran:JSON.stringify({M:30}),total:30,reject:0,rejectUkuran:'{}',upah:2000,status:'diterima',asal:'lama',workflowVersion:2,dibuat:'2026-09-10T00:00:00.000Z'}
    ];
    var store={read:function(s){return db[s]||[];},append:function(s,r){db[s].push(r);version++;},appendMany:function(s,rs){db[s]=db[s].concat(rs);version++;},update:function(s,id,p){Object.assign(db[s].find(function(r){return r.id===id;}),p);version++;},remove:function(s,id){db[s]=db[s].filter(function(r){return r.id!==id;});version++;},replaceAll:function(s,r){db[s]=r;version++;},getSettings:function(){return config;},setSettings:function(s){config=s;version++;},version:function(){return version;},lock:function(fn){return fn();}};
    var core=createCore(store,{now:function(){return new Date('2026-10-10T08:00:00Z');},id:function(){urut++;return 'fixid'+('00000'+urut).slice(-6);},makePdf:function(){return 'mockpdf';}});
  `, ctx);
  const run = code => JSON.parse(JSON.stringify(vm.runInContext(code, ctx)));
  const call = (action, payload = {}, token = 'owner-token-123456789') => run(`core.handle(${JSON.stringify(action)},JSON.parse(${JSON.stringify(JSON.stringify({ token, workflowVersion: 2, ...payload }))}))`);
  const state = () => call('getState', { semua: true });
  const flow = id => state().po.find(p => p.id === id).workflow;
  return { run, call, state, flow };
}

test('an old-app PO with untidy old records keeps its note but lets new assignments, deliveries, counting and QC go on', () => {
  const a = app(), w = a.flow('polama1');
  assert.equal(w.lama, true); assert.deepEqual(w.issues, [REVIEW]); assert.deepEqual(w.blockingIssues, []);
  assert.equal(w.ukuran.M.readyQC, true, 'the count already accepted on the old PO can be inspected');
  /* the size that was never assigned can be given to a sewer now */
  const kirim = a.call('createKirim', { kirim: { id: 'kirimbaru01', poId: 'polama1', maklonId: 'worker2', tanggal: '2026-10-10', ukuran: { XL: 60 } } });
  assert.equal(kirim.data.total, 60);
  assert.throws(() => a.call('createKirim', { kirim: { id: 'kirimbaru02', poId: 'polama1', maklonId: 'worker2', tanggal: '2026-10-10', ukuran: { XL: 1 } } }), /melebihi hasil potong/, 'each step keeps its own quantity limit');
  /* a delivery on the very size the old note is about is counted, and the sewer herself can report too */
  const setor = a.call('createSetor', { setor: { id: 'setorbaru01', poId: 'polama1', maklonId: 'worker1', tanggal: '2026-10-10', ukuran: { M: 40 } } });
  assert.equal(setor.data.status, 'diterima');
  const lapor = a.call('createSetor', { setor: { id: 'setorbaru02', poId: 'polama1', tanggal: '2026-10-10', ukuran: { L: 80 } } }, 'worker-token-12345678');
  assert.equal(lapor.data.status, 'diajukan');
  assert.throws(() => a.call('createSetor', { setor: { id: 'setorbaru03', poId: 'polama1', maklonId: 'worker1', tanggal: '2026-10-10', ukuran: { M: 31 } } }), /melebihi sisa penugasan/);
  assert.equal(a.call('prosesSetor', { id: 'setorbaru02', keputusan: 'terima', ukuran: { L: 80 }, tanggal: '2026-10-10' }, 'qcuser-token-12345678').data.status, 'diterima');
  const qc = a.call('createQC', { qc: { id: 'qcbaru0001', poId: 'polama1', setorId: 'setorbaru01', tanggal: '2026-10-10', ukuran: { M: 38 }, rejectUkuran: { M: 2 }, reject: 2 } }, 'qcuser-token-12345678');
  assert.equal(qc.data.total, 38);
  assert.equal(a.call('createGudang', { gudang: { id: 'gudangbaru1', poId: 'polama1', tanggal: '2026-10-10', ukuran: { M: 38 } } }).data.total, 38);
  assert.deepEqual(a.flow('polama1').issues, [REVIEW], 'the old note is still on record');
});

test('on an old-app PO only wages that come from the old records stay held; new work is paid as usual', () => {
  const a = app();
  a.call('createSetor', { setor: { id: 'setorbaru01', poId: 'polama1', maklonId: 'worker1', tanggal: '2026-10-10', ukuran: { M: 40 } } });
  const rows = a.state().payroll.filter(r => r.poId === 'polama1'), by = id => rows.find(r => r.id === id);
  const lama = by('setor:setorlamaM:M'), baru = by('setor:setorbaru01:M'), potong = by('potong:cutlama1');
  assert.equal(lama.available, 0); assert.equal(lama.needsReview, true); assert.deepEqual(lama.issues, [REVIEW]);
  assert.equal(potong.available, 0); assert.equal(potong.needsReview, true);
  assert.equal(baru.available, 40); assert.ok(!baru.needsReview); assert.deepEqual(baru.issues, []);
  assert.throws(() => a.call('createUpah', { upah: { id: 'upahlama001', pegawaiId: 'worker1', itemIds: ['setor:setorlamaM:M'] } }), /perlu ditinjau/);
  const slip = a.call('createUpah', { upah: { id: 'upahbaru001', pegawaiId: 'worker1', itemIds: ['setor:setorbaru01:M'] } });
  assert.equal(slip.data.totalQty, 40); assert.equal(slip.data.totalUpah, 80000);
});

test('a PO made in this app still stops, wages included, when its records do not add up', () => {
  const a = app();
  a.run(`db.SlipSetor.push({id:'setorrusak1',noSlip:'SS-9',poId:'pobaru1',maklonId:'worker1',tanggal:'2026-10-05',ukuran:JSON.stringify({M:60}),total:60,reject:0,rejectUkuran:'{}',upah:2000,status:'diterima',workflowVersion:2,dibuat:'2026-10-05T00:00:00.000Z'});version++;0`);
  const w = a.flow('pobaru1');
  assert.equal(w.lama, false); assert.ok(w.issues.length > 0); assert.deepEqual(w.blockingIssues, w.issues); assert.equal(w.ukuran.M.readyQC, false);
  assert.throws(() => a.call('createKirim', { kirim: { id: 'kirimbaru03', poId: 'pobaru1', maklonId: 'worker2', tanggal: '2026-10-10', ukuran: { L: 50 } } }), /Setoran melebihi penugasan|tidak seimbang/);
  assert.throws(() => a.call('createSetor', { setor: { id: 'setorbaru04', poId: 'pobaru1', maklonId: 'worker1', tanggal: '2026-10-10', ukuran: { M: 1 } } }), /Setoran melebihi penugasan|tidak seimbang/);
  const row = a.state().payroll.find(r => r.id === 'setor:setorrusak1:M');
  assert.equal(row.available, 0); assert.equal(row.needsReview, true);
});

test('an assignment can be removed when the sewer has delivered other sizes only, so it can go to another sewer', () => {
  const a = app();
  /* worker1 has delivered size M on the old PO; the size L assignment has no delivery yet */
  assert.throws(() => a.call('deleteRecord', { sheet: 'SlipKirim', id: 'sendlamaM' }), /Penugasan ukuran M sudah mempunyai laporan\/setoran/);
  assert.deepEqual(a.call('deleteRecord', { sheet: 'SlipKirim', id: 'sendlamaL' }).data, { ok: true });
  assert.equal(a.run('db.SlipKirim.some(function(r){return r.id==="sendlamaL";})'), false);
  const pindah = a.call('createKirim', { kirim: { id: 'kirimpindah1', poId: 'polama1', maklonId: 'worker2', tanggal: '2026-10-03', target: '2026-10-10', ukuran: { L: 80 } } });
  assert.equal(pindah.data.maklonId, 'worker2');
  assert.equal(a.call('createSetor', { setor: { id: 'setorpindah1', poId: 'polama1', maklonId: 'worker2', tanggal: '2026-10-10', ukuran: { L: 75 } } }).data.total, 75);
  /* two assignments of the same size: one may go as long as the other still covers what was delivered */
  a.run(`db.SlipKirim.push({id:'sendbaruM2',noSlip:'SK-4',poId:'pobaru1',maklonId:'worker1',tanggal:'2026-10-03',ukuran:JSON.stringify({L:50}),total:50,upah:2000,dibuat:'2026-10-03T00:00:00.000Z'});version++;0`);
  a.call('createSetor', { setor: { id: 'setorbaruL1', poId: 'pobaru1', maklonId: 'worker1', tanggal: '2026-10-10', ukuran: { L: 20 } } });
  assert.throws(() => a.call('deleteRecord', { sheet: 'SlipKirim', id: 'sendbaruM2' }), /Penugasan ukuran L sudah mempunyai laporan\/setoran/);
  assert.deepEqual(a.call('deleteRecord', { sheet: 'SlipKirim', id: 'sendbaruM' }).data, { ok: true }, 'size M has no delivery');
  assert.throws(() => a.call('deleteRecord', { sheet: 'SlipKirim', id: 'kirimpindah1' }, 'worker-token-22345678'), /Hanya admin/);
});
