const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/core.js'), 'utf8');
function app() {
  const context = vm.createContext({});
  vm.runInContext(source + `
    var db = {}, version = 1, serial = 0, config = {};
    Object.keys(SCHEMA).forEach(function (s) { db[s] = []; });
    db.Pegawai = [
      { id: 'owner01', nama:'Owner', divisi:'owner', aktif:true, token:'owner-token-123456789' },
      { id: 'worker1', nama:'Ali', divisi:'jahit', aktif:true, token:'worker-token-12345678' },
      { id: 'worker2', nama:'Budi', divisi:'jahit', aktif:true, token:'worker2-token-1234567' },
      { id: 'cutter1', nama:'Cutter', divisi:'potong', aktif:true, token:'cutter-token-12345678' },
      { id: 'qcuser1', nama:'QC', divisi:'qc', aktif:true, token:'qcuser-token-12345678' }
    ];
    var store = { read:function(s){return db[s] || [];}, append:function(s,r){db[s].push(r); version++;},
      appendMany:function(s,rs){db[s]=db[s].concat(rs);version++;},
      update:function(s,id,p){var r=db[s].filter(function(x){return x.id===id;})[0]; Object.assign(r,p);version++;},
      remove:function(s,id){db[s]=db[s].filter(function(r){return r.id!==id;});version++;},
      replaceAll:function(s,r){db[s]=r;version++;},
      getSettings:function(){return config;},setSettings:function(s){config=s;version++;},
      version:function(){return version;},lock:function(fn){return fn();} };
    var core=createCore(store,{ now:function(){return new Date('2026-10-08T08:00:00Z');},id:function(){serial++;return 'newid000'+serial;}});
  `, context);
  function run(code) { return JSON.parse(JSON.stringify(vm.runInContext(code, context))); }
  function call(action, payload = {}, token = 'owner-token-123456789') {
    return run(`core.handle(${JSON.stringify(action)},JSON.parse(${JSON.stringify(JSON.stringify({ token, workflowVersion: 2, ...payload }))}))`);
  }
  function seed(sizes = { M: 40, L: 60 }) {
    call('savePO', { po: { newId: 'po00001', nama: 'Kaos', ukuran: sizes } });
    call('createPotong', { potong: { id: 'cut0001', poId: 'po00001', userId: 'cutter1', ukuran: sizes, tarif: 500 } });
    call('createKirim', { kirim: { id: 'send001', poId: 'po00001', maklonId: 'worker1', ukuran: sizes, upah: 2000 } });
  }
  function count(sizes, id = 'count01') { return call('createSetor', { setor: { id, poId: 'po00001', maklonId: 'worker1', ukuran: sizes, tanggal: '2026-10-02' } }); }
  function inspect(ukuran, extra = {}) { return call('createQC', { qc: { id: 'qc00001', poId: 'po00001', setorId: 'count01', ukuran, tanggal: '2026-10-03', ...extra } }); }
  return { run, call, seed, count, inspect, state: token => call('sync', {}, token), pay: () => run('corePayroll(db.Potong,db.SlipSetor,db.QC,db.SlipUpah)'), db: sheet => run(`db[${JSON.stringify(sheet)}]`) };
}

test('QC waits for all sizes of a PO; physical counts and slips remain available earlier', () => {
  const a = app(); a.seed(); a.count({ M: 20 });
  assert.throws(() => a.inspect({ M: 20 }), /belum lengkap/);
  a.count({ M: 20 }, 'count02');
  assert.throws(() => a.inspect({ M: 20 }), /PO belum lengkap/);
  const w = a.state().po[0].workflow;
  assert.equal(w.ukuran.M.readyQC, true);
  assert.equal(w.ukuran.M.siapQC, 40);
  assert.equal(w.ukuran.L.readyQC, false);
  assert.equal(w.readyQC, false);
  a.count({ L: 60 }, 'count03');
  a.inspect({ M: 20 });
  assert.equal(a.state().po[0].workflow.readyQC, true);
  const b = app(); b.seed({ M: 40 });
  b.call('createSetor', { setor: { id: 'report1', poId: 'po00001', ukuran: { M: 40 } } }, 'worker-token-12345678');
  assert.equal(b.db('SlipSetor')[0].status, 'diajukan');
  assert.equal(b.pay().filter(r => r.jenis === 'jahit').length, 0);
  assert.equal(b.state().po[0].workflow.ukuran.M.readyQC, false);
});

test('assignment/count reject wrong sizes and cumulative over-capacity including pending reports', () => {
  const a = app(); a.seed({ M: 40 });
  assert.throws(() => a.call('createKirim', { kirim: { poId: 'po00001', maklonId: 'worker2', ukuran: { M: 1 } } }), /melebihi/);
  assert.throws(() => a.count({ XL: 1 }), /tidak terdaftar/);
  a.call('createSetor', { setor: { id: 'report1', poId: 'po00001', ukuran: { M: 25 } } }, 'worker-token-12345678');
  assert.throws(() => a.count({ M: 20 }), /melebihi/);
  a.call('prosesSetor', { id: 'report1', ukuran: { M: 20 }, rejectUkuran: { M: 5 }, reject: 5 });
  a.count({ M: 15 });
  assert.equal(a.state().po[0].workflow.ukuran.M.readyQC, true);
});

test('QC categorizes exactly its entire source size; all-reject is authoritative zero payroll', () => {
  const a = app(); a.seed({ M: 40 }); a.count({ M: 40 });
  assert.equal(a.pay().find(r => r.jenis === 'jahit').total, 40);
  assert.throws(() => a.inspect({ M: 35 }), /tepat seluruh/);
  a.inspect({}, { rejectUkuran: { M: 40 }, reject: 40 });
  const pay = a.pay().find(r => r.jenis === 'jahit'); assert.equal(pay.total, 0); assert.equal(pay.available, 0);
  assert.equal(a.state().po[0].workflow.complete, true);
  assert.throws(() => a.inspect({ M: 40 }, { id: 'qc00002' }), /sudah di-QC/);
});

test('repair is tied to original QC, retains tariff/date, and warehouse never duplicates retry', () => {
  const a = app(); a.seed({ M: 40 }); a.count({ M: 40 }); a.inspect({ M: 30 }, { perbaikanUkuran: { M: 10 }, perbaikan: 10 });
  const repair = { id: 'repair1', poId: 'po00001', repairQcId: 'qc00001', setorId: 'count01', ukuran: { M: 4 }, tanggal: '2026-10-05' };
  a.call('createQC', { qc: repair }); a.call('createQC', { qc: repair });
  assert.equal(a.db('QC').length, 2);
  assert.equal(a.state().warehouse.length, 2);
  assert.equal(a.state().po[0].workflow.ukuran.M.qcPerbaikan, 6);
  const r = a.pay().find(r => r.qcId === 'repair1'); assert.equal(r.total, 4); assert.equal(r.rate, 2000); assert.equal(r.tanggal, '2026-10-05');
  assert.throws(() => a.call('createQC', { qc: { ...repair, id: 'repair2', ukuran: { M: 7 } } }), /melebihi/);
  assert.throws(() => a.call('ubahHarga', { sheet: 'SlipSetor', id: 'count01', harga: 9000 }), /dibekukan/);
});

test('paid physical count is frozen; later QC variance/repair never causes double payment', () => {
  const a = app(); a.seed({ M: 40 }); a.count({ M: 40 });
  a.call('createUpah', { upah: { id: 'pay0001', pegawaiId: 'worker1', itemIds: ['setor:count01:M'] } });
  const original = JSON.stringify(a.db('SlipUpah')[0]);
  a.inspect({ M: 30 }, { perbaikanUkuran: { M: 10 }, perbaikan: 10 });
  assert.equal(a.pay().find(r => r.jenis === 'jahit').overpaidQty, 10);
  a.call('createQC', { qc: { id: 'repair1', poId: 'po00001', repairQcId: 'qc00001', ukuran: { M: 10 }, tanggal: '2026-10-05' } });
  assert.equal(a.pay().filter(r => r.jenis === 'jahit').reduce((n,r) => n + r.available, 0), 0);
  assert.equal(JSON.stringify(a.db('SlipUpah')[0]), original);
  assert.throws(() => a.call('createUpah', { upah: { pegawaiId: 'worker1', itemIds: ['repair:repair1:M'] } }), /sudah dibayar/);
});

test('payment pool is per source AND size; paying L cannot make L payable again', () => {
  const a = app(); a.seed({ M: 50, L: 50 }); a.count({ M: 50, L: 50 });
  a.call('createUpah', { upah: { id: 'pay0001', pegawaiId: 'worker1', itemIds: ['setor:count01:L'] } });
  let pay = a.pay(); assert.equal(pay.find(r => r.id === 'setor:count01:L').available, 0); assert.equal(pay.find(r => r.id === 'setor:count01:M').available, 50);
  assert.throws(() => a.call('createUpah', { upah: { pegawaiId: 'worker1', itemIds: ['setor:count01:L'] } }), /sudah dibayar/);
});

test('payment after QC allows independent repair earnings at frozen source rate', () => {
  const a = app(); a.seed({ M: 40 }); a.count({ M: 40 }); a.inspect({ M: 30 }, { perbaikanUkuran: { M: 10 }, perbaikan: 10 });
  a.call('createUpah', { upah: { id: 'pay0001', pegawaiId: 'worker1', itemIds: ['setor:count01:M'] } });
  a.call('createQC', { qc: { id: 'repair1', poId: 'po00001', repairQcId: 'qc00001', ukuran: { M: 4 }, tanggal: '2026-10-05' } });
  a.call('createUpah', { upah: { id: 'pay0002', pegawaiId: 'worker1', itemIds: ['repair:repair1:M'] } });
  assert.equal(a.db('SlipUpah')[1].totalQty, 4); assert.equal(a.db('SlipUpah')[1].totalUpah, 8000);
  assert.equal(a.pay().find(r => r.qcId === 'repair1').available, 0);
});

test('completion uses production, excludes BigSeller; closed PO requires reopening', () => {
  const a = app(); a.seed({ M: 40 }); a.count({ M: 40 });
  assert.throws(() => a.call('setStatusPO', { id: 'po00001', status: 'selesai' }), /belum selesai/);
  a.inspect({ M: 35 }, { rejectUkuran: { M: 5 }, reject: 5 });
  a.call('setStatusPO', { id: 'po00001', status: 'selesai' });
  assert.throws(() => a.count({ M: 1 }, 'count02'), /Buka kembali/);
  a.call('createGudang', { gudang: { id: 'stock01', poId: 'po00001', ukuran: { M: 35 } } });
  assert.throws(() => a.call('createGudang', { gudang: { id: 'stock02', poId: 'po00001', ukuran: { M: 1 } } }), /melebihi/);
});

test('downstream/paid records prevent destructive upstream deletion and reprice', () => {
  const a = app(); a.seed({ M: 40 }); a.count({ M: 40 });
  assert.throws(() => a.call('deleteRecord', { sheet: 'Potong', id: 'cut0001' }), /penugasan/);
  assert.throws(() => a.call('deleteRecord', { sheet: 'SlipKirim', id: 'send001' }), /setoran/);
  a.inspect({ M: 40 });
  assert.throws(() => a.call('deleteRecord', { sheet: 'SlipSetor', id: 'count01' }), /QC/);
  a.call('createUpah', { upah: { id: 'pay0001', pegawaiId: 'worker1', itemIds: ['setor:count01:M'] } });
  assert.throws(() => a.call('deleteRecord', { sheet: 'QC', id: 'qc00001' }), /sudah dibayar/);
  a.call('deleteRecord', { sheet: 'SlipUpah', id: 'pay0001' });
  assert.equal(a.pay().find(r => r.jenis === 'jahit').available, 40);
});

test('legacy ambiguous scalar categories require review and never unlock new payment', () => {
  const a = app(); a.seed({ M: 20, L: 20 }); a.count({ M: 20, L: 20 });
  a.run(`db.SlipSetor[0].reject=1; db.SlipSetor[0].rejectUkuran=''; true`);
  assert.match(a.state().po[0].workflow.issues.join(' '), /belum dirinci/);
  assert.equal(a.state().payroll.filter(r => r.jenis === 'jahit').reduce((n,r) => n+r.available,0), 0);
  assert.throws(() => a.call('createUpah', { upah: { pegawaiId: 'worker1', itemIds: ['setor:count01:M'] } }), /ditinjau/);
});

test('legacy payment markers stay paid and state projects payroll before archive trimming', () => {
  const a = app(); a.seed({ M: 40 }); a.count({ M: 40 }); a.inspect({ M: 35 }, { rejectUkuran: { M: 5 }, reject: 5 });
  a.run(`db.PO[0].status='selesai'; db.PO[0].selesaiPada='2026-01-01'; true`);
  const state = a.state(); assert.equal(state.qc.length, 0); assert.equal(state.payroll.find(r => r.jenis === 'jahit').total, 35);
  a.run(`db.SlipSetor[0].upahId='LAMA'; true`);
  const p = a.pay().find(r => r.jenis === 'jahit'); assert.equal(p.available, 0); assert.equal(p.overpaidQty, 5);
});

test('server scopes worker payroll and validates contract and event dates', () => {
  const a = app(); a.seed({ M: 40 }); a.count({ M: 40 });
  const state = a.state('worker-token-12345678'); assert.ok(state.payroll.every(r => r.pegawaiId === 'worker1')); assert.equal(state.warehouse.length, 0);
  assert.equal(a.state('qcuser-token-12345678').payroll.length, 0);
  assert.throws(() => a.inspect({ M: 40 }, { tanggal: '2026-10-01' }), /sebelum tanggal hitung/);
  assert.throws(() => a.call('createUpah', { workflowVersion: 1, upah: {} }), /Versi alur/);
});

test('re-import preserves paid snapshots and rejects quantity rewrites before any writes', () => {
  const a = app(); a.seed({ M: 40 }); a.count({ M: 40 }); a.inspect({ M: 40 });
  a.call('createUpah', { upah: { id: 'pay0001', pegawaiId: 'worker1', itemIds: ['setor:count01:M'] } });
  const sheets = ['PO','Potong','SlipKirim','SlipSetor','QC','Gudang'];
  a.run(`['PO','Potong','SlipKirim','SlipSetor','QC','Gudang'].forEach(function(s){db[s].forEach(function(r){r.asal='lama';});}); true`);
  const data = Object.fromEntries(sheets.map(s => [s, a.db(s)]));
  a.call('gantiImpor', { data });
  assert.equal(a.pay().find(r => r.id === 'setor:count01:M').available, 0);
  const before = JSON.stringify(a.db('SlipSetor')); data.SlipSetor[0].total = 41; data.SlipSetor[0].ukuran = { M: 41 };
  assert.throws(() => a.call('gantiImpor', { data }), /terkait pembayaran/);
  assert.equal(JSON.stringify(a.db('SlipSetor')), before);
  assert.equal(a.db('SlipUpah').length, 1);
});

test('LAMA marker after a partial snapshot still covers subsequent same-size repair', () => {
  const a = app(); a.seed({ M: 40 }); a.count({ M: 40 }); a.inspect({ M: 30 }, { perbaikanUkuran: { M: 10 }, perbaikan: 10 });
  a.call('createUpah', { upah: { id: 'pay0001', pegawaiId: 'worker1', itemIds: ['setor:count01:M'] } });
  a.call('tandaiLunas', { sampai: '2026-10-08' });
  a.call('createQC', { qc: { id: 'repair1', poId: 'po00001', repairQcId: 'qc00001', ukuran: { M: 10 }, tanggal: '2026-10-05' } });
  assert.equal(a.pay().find(r => r.id === 'repair:repair1:M').available, 0);
});

test('out-of-order repair payments bind their earned IDs before redistributing QC credit', () => {
  const a = app(); a.seed({ M: 40 }); a.count({ M: 40 }); a.inspect({ M: 30 }, { perbaikanUkuran: { M: 10 }, perbaikan: 10 });
  a.call('createQC', { qc: { id: 'repair1', poId: 'po00001', repairQcId: 'qc00001', ukuran: { M: 4 }, tanggal: '2026-10-05' } });
  a.call('createQC', { qc: { id: 'repair2', poId: 'po00001', repairQcId: 'qc00001', ukuran: { M: 3 }, tanggal: '2026-10-06' } });
  a.call('createUpah', { upah: { id: 'pay0001', pegawaiId: 'worker1', itemIds: ['repair:repair2:M'] } });
  let rows = a.pay(); assert.equal(rows.find(r => r.id === 'repair:repair2:M').available, 0); assert.equal(rows.find(r => r.id === 'repair:repair1:M').available, 4); assert.equal(rows.find(r => r.id === 'setor:count01:M').available, 30);
  assert.throws(() => a.call('createUpah', { upah: { pegawaiId: 'worker1', itemIds: ['repair:repair2:M'] } }), /sudah dibayar/);
  a.call('createUpah', { upah: { id: 'pay0002', pegawaiId: 'worker1', itemIds: ['repair:repair1:M'] } });
  assert.equal(a.pay().find(r => r.id === 'repair:repair1:M').available, 0);
});

test('all sewing rejects do not claim a completed QC stage without a positive count target', () => {
  const a = app(); a.seed({ M: 40 });
  a.call('createSetor', { setor: { id: 'count01', poId: 'po00001', maklonId: 'worker1', ukuran: {}, rejectUkuran: { M: 40 }, reject: 40 } });
  assert.equal(a.state().po[0].workflow.ukuran.M.readyQC, false);
  assert.equal(a.state().po[0].workflow.complete, false);
  assert.throws(() => a.call('setStatusPO', { id: 'po00001', status: 'selesai' }), /belum selesai/);
});
