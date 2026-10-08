'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');

function fixture() {
  const h = harness();
  vm.runInContext(['slip-models.js','auto-completion.js'].map(f => fs.readFileSync(path.resolve(__dirname,'../src',f),'utf8')).join('\n'), h.context);
  h.context.slipTestLockProbe = h.isLocked;
  h.run(`var slipTestHtml='',slipTestWasLocked=false,slipTestEnv=pkEnv_;pkEnv_=function(){var e=slipTestEnv();e.makePdf=function(html){slipTestWasLocked=slipTestLockProbe();slipTestHtml=html;return 'cGRm';};return e;};void 0;`);
  const setup = h.request('setupOwner', { nama: 'Pemilik Contoh', pin: '1234' });
  assert.equal(setup.ok, true, setup.error);
  const token = setup.data.token;
  h.run(`pkStore_().lock(function(){
    pkStore_().append('Pegawai',{id:'cutter01',nama:'Pemotong Contoh',divisi:'potong',aktif:true,token:'cutter_test_session_1234'});
    pkStore_().append('Pegawai',{id:'sewer001',nama:'Penjahit Contoh',divisi:'jahit',aktif:true,token:'sewer_test_session_1234'});
    pkStore_().append('PO',{id:'test_po01',noPO:'PO-TEST-01',nama:'Produk Contoh',status:'aktif',ukuran:{M:40},total:40});
    var cuts=[];for(var i=0;i<40;i++)cuts.push({id:'test_cut'+String(i).padStart(3,'0'),poId:'test_po01',userId:'cutter01',tanggal:'2026-10-05',ukuran:{M:1},total:1,tarif:100});
    pkStore_().appendMany('Potong',cuts);
  });`);
  function call(action, payload = {}) { h.cold(); return h.request(action, { token, workflowVersion: 2, ...payload }); }
  function good(action, payload = {}) { const r = call(action, payload); assert.equal(r.ok, true, r.error); return r.data?.data ?? r.data; }
  return { h, token, call, good };
}

test('cancelling a modern payment with forty sources performs one receipt deletion and no source-row writes', () => {
  const { h, good } = fixture();
  const ids = Array.from({ length: 40 }, (_, i) => 'potong:test_cut' + String(i).padStart(3, '0'));
  const payment = good('createUpah', { upah: { id: 'modern_payment', pegawaiId: 'cutter01', tanggal: '2026-10-06', itemIds: ids } });
  assert.equal(payment.totalQty, 40); assert.equal(payment.totalUpah, 4000);
  const before = good('getState');
  assert.equal(before.payroll.filter(r => r.pegawaiId === 'cutter01').reduce((sum, r) => sum + r.available, 0), 0);
  const snapshots = Object.fromEntries(Object.entries(h.sheets).map(([name, sheet]) => [name, { rows: JSON.stringify(sheet.values), writes: sheet.writes }]));
  assert.equal(good('deleteRecord', { sheet: 'SlipUpah', id: payment.id }).ok, true);
  assert.equal(h.sheets.SlipUpah.writes, snapshots.SlipUpah.writes + 1);
  for (const [name, old] of Object.entries(snapshots)) if (name !== 'SlipUpah') {
    assert.equal(h.sheets[name].writes, old.writes, name + ' must not be rewritten');
    assert.equal(JSON.stringify(h.sheets[name].values), old.rows, name + ' contents must remain unchanged');
  }
  const after = good('getState');
  assert.equal(after.payroll.filter(r => r.pegawaiId === 'cutter01').reduce((sum, r) => sum + r.available, 0), 40);
  assert.equal(after.upah.some(r => r.id === payment.id), false);
  const writes = h.sheets.SlipUpah.writes;
  assert.deepEqual(good('deleteRecord', { sheet: 'SlipUpah', id: payment.id }), { ok: true, sudah: true });
  assert.equal(h.sheets.SlipUpah.writes, writes, 'repeating a confirmed cancellation must be idempotent');
  assert.equal(h.isLocked(), false);
});

test('historical receipts with a settlement bridge and worker attempts cannot remove payment evidence', () => {
  const { h, call } = fixture();
  h.run(`pkStore_().lock(function(){
    pkStore_().append('SlipUpah',{id:'historic_payment',jenis:'jahit',pegawaiId:'sewer001',itemIds:['old_report'],totalQty:3,totalUpah:3000,dibayar:3000});
    pkStore_().append('LegacySettlement',{id:'bridge01',sourceId:'old_report',paymentRef:'historic_payment'});
  });`);
  const before = JSON.stringify(Object.fromEntries(Object.entries(h.sheets).map(([n, s]) => [n, s.values])));
  const historic = call('deleteRecord', { sheet: 'SlipUpah', id: 'historic_payment' });
  assert.equal(historic.ok, false); assert.match(historic.error, /historis.*tidak dapat dihapus/);
  const worker = call('deleteRecord', { sheet: 'SlipUpah', id: 'historic_payment', token: 'sewer_test_session_1234' });
  assert.equal(worker.ok, false); assert.match(worker.error, /Hanya admin/);
  assert.equal(JSON.stringify(Object.fromEntries(Object.entries(h.sheets).map(([n, s]) => [n, s.values]))), before);
  assert.equal(h.isLocked(), false);
});

test('payment PDF uses immutable item quantity, price, earned date and sewing reference after source changes', () => {
  const { h, good, call } = fixture();
  h.run(`pkStore_().lock(function(){
    pkStore_().append('SlipSetor',{id:'count001',noSlip:'SS-CHANGED',poId:'test_po01',maklonId:'sewer001',tanggal:'2026-10-08',ukuran:{M:20},total:20,upah:9999,status:'diterima'});
    pkStore_().append('SlipUpah',{id:'frozen_payment',noSlip:'SU-TEST-01',pegawaiId:'sewer001',jenis:'jahit',tanggal:'2026-10-07',itemIds:['setor:count001:M'],items:[{sourceId:'count001',earnedId:'setor:count001:M',poId:'test_po01',tanggal:'2026-10-05',ref:'SS-ORIGINAL',total:3,rate:1000,upah:1000,tarif:1000,ukuran:{M:3}}],totalQty:3,totalUpah:3000,potongan:500,dibayar:2500});
  });`);
  const pdf = good('makePdf', { type: 'upah', id: 'frozen_payment' });
  assert.equal(pdf.base64, 'cGRm');
  const html = h.run('slipTestHtml');
  assert.match(html, /SS-ORIGINAL/); assert.doesNotMatch(html, /SS-CHANGED|9\.999/);
  assert.match(html, /3 pcs = Rp 3\.000/); assert.match(html, /DIBAYAR: Rp 2\.500/);
  const foreign = call('makePdf', { type: 'upah', id: 'frozen_payment', token: 'cutter_test_session_1234' });
  assert.equal(foreign.ok, false); assert.match(foreign.error, /Bukan slip Anda/);
});

test('weekly PDF authenticates its worker scope, includes all earned dates, releases the lock before conversion and never writes timers or payments', () => {
  const { h, good, call } = fixture();
  h.run(`pkStore_().lock(function(){pkStore_().update('PO','test_po01',{tuntasPada:'2020-01-01T00:00:00.000Z'});});`);
  const before = JSON.stringify(Object.fromEntries(Object.entries(h.sheets).map(([n,s])=>[n,s.values])));
  const writes = Object.fromEntries(Object.entries(h.sheets).map(([n,s])=>[n,s.writes]));
  const pdf = good('makeWeeklyPdf', { pegawaiId:'cutter01', start:'2026-10-05', end:'2026-10-11', token:'cutter_test_session_1234' });
  assert.equal(pdf.base64, 'cGRm'); assert.match(pdf.nama, /Slip-potong-2026-10-05-2026-10-11\.pdf/);
  assert.equal(h.run('slipTestWasLocked'), false);
  const html = h.run('slipTestHtml'); assert.match(html,/Slip Upah Potong/); assert.match(html,/40 pcs/); assert.match(html,/Rp 4\.000/);
  assert.equal(JSON.stringify(Object.fromEntries(Object.entries(h.sheets).map(([n,s])=>[n,s.values]))),before);
  for(const [name,count] of Object.entries(writes))assert.equal(h.sheets[name].writes,count,name+' must remain read-only');
  const foreign = call('makeWeeklyPdf', {pegawaiId:'cutter01',start:'2026-10-05',end:'2026-10-11',token:'sewer_test_session_1234'});
  assert.equal(foreign.ok,false);assert.match(foreign.error,/Bukan slip Anda/);
  const invalid = call('makeWeeklyPdf', {pegawaiId:'cutter01',start:'2026-02-31',end:'2026-03-03'});
  assert.equal(invalid.ok,false);assert.match(invalid.error,/Tanggal slip/);
  const anonymous = call('makeWeeklyPdf', {pegawaiId:'cutter01',start:'2026-10-05',end:'2026-10-11',token:''});
  assert.equal(anonymous.ok,false);assert.match(anonymous.error,/login/);
});

test('salary PDF selects saved employees and period amounts, supports a group and remains admin-only and read-only', () => {
  const { h, good, call } = fixture();
  h.run(`pkStore_().lock(function(){
    pkStore_().appendMany('Karyawan',[{id:'daily001',nama:'Harian Satu',aktif:true,gajiHarian:999999},{id:'daily002',nama:'Harian Dua',aktif:true,gajiHarian:999999}]);
    pkStore_().appendMany('GajiHarian',[{id:'gaji0001',karyawanId:'daily001',periode:'2026-W41',tanggal:'2026-10-05',status:'full',gaji:100000},{id:'gaji0002',karyawanId:'daily002',periode:'2026-W41',tanggal:'2026-10-05',status:'half',gaji:50000}]);
  });`);
  const before = JSON.stringify(Object.fromEntries(Object.entries(h.sheets).map(([n,s])=>[n,s.values])));
  const pdf = good('makeGajiPdf',{periode:'2026-W41'}); assert.equal(pdf.base64,'cGRm');
  let html = h.run('slipTestHtml'); assert.match(html,/Harian Satu/);assert.match(html,/Harian Dua/);assert.match(html,/Rp 100\.000/);assert.match(html,/Rp 50\.000/);assert.doesNotMatch(html,/999\.999/);
  assert.equal(h.run('slipTestWasLocked'),false);
  good('makeGajiPdf',{periode:'2026-W41',karyawanIds:['daily002','daily002']});
  html = h.run('slipTestHtml'); assert.doesNotMatch(html,/Harian Satu/);assert.equal((html.match(/Slip Gaji Mingguan/g)||[]).length,1);
  for(const payload of [{periode:'2026-W41',token:'cutter_test_session_1234'},{periode:'2026-W41',karyawanIds:[]},{periode:'2026-W99'},{periode:'2026-W41',karyawanIds:['missing']}])assert.equal(call('makeGajiPdf',payload).ok,false);
  assert.equal(JSON.stringify(Object.fromEntries(Object.entries(h.sheets).map(([n,s])=>[n,s.values]))),before);
  assert.equal(h.isLocked(),false);
});

test('QC exports only visible physical slips without money, payroll reads or source mutation',()=>{
  const {h,good,call}=fixture();const token='qc_test_session_example_1234';
  h.run(`pkStore_().lock(function(){
    pkStore_().append('Pegawai',{id:'qcuser01',nama:'QC fixture',divisi:'qc',aktif:true,token:'${token}'});
    pkStore_().update('Pegawai','sewer001',{hp:'PRIVATE_CONTACT_123'});
    pkStore_().append('SlipKirim',{id:'qcsend01',noSlip:'SK-QC-01',poId:'test_po01',maklonId:'sewer001',tanggal:'2026-10-05',ukuran:{M:5},total:5,upah:987654,target:'2026-10-09'});
    [{id:'qccount1',noSlip:'SS-QC-01',status:'diterima'},{id:'qccount2',status:'diajukan'},{id:'qccount3',status:'ditolak'}].forEach(function(r){r.poId='test_po01';r.maklonId='sewer001';r.tanggal='2026-10-06';r.ukuran={M:5};r.total=5;r.upah=987654;pkStore_().append('SlipSetor',r);});
    pkStore_().append('PO',{id:'closedpo1',noPO:'PO-CLOSED',nama:'Closed fixture',status:'selesai'});
    pkStore_().append('SlipSetor',{id:'closedss1',noSlip:'SS-CLOSED',poId:'closedpo1',maklonId:'sewer001',status:'diterima',ukuran:{M:1},total:1,upah:987654});
    pkStore_().append('SlipUpah',{id:'foreignpay',pegawaiId:'sewer001',jenis:'jahit',totalQty:5,totalUpah:4938270});
  });`);
  const before=JSON.stringify(Object.fromEntries(Object.entries(h.sheets).map(([n,s])=>[n,s.values])));
  h.run(`var qcReadTables=[],qcReadStore=pkStore_;pkStore_=function(){var s=qcReadStore();if(!s.qcReadWrapped){var read=s.read;s.read=function(name){qcReadTables.push(name);return read(name);};s.qcReadWrapped=true;}return s;};void 0;`);
  for(const [type,id] of [['kirim','qcsend01'],['setor','qccount1']]){
    h.run('qcReadTables=[];');const pdf=good('makePdf',{type,id,token});assert.equal(pdf.base64,'cGRm');const html=h.run('slipTestHtml');
    assert.match(html,/SLIP (PENUGASAN|SETOR)/);assert.match(html,/Maklon/);assert.match(html,/>5</);assert.doesNotMatch(html,/Rp |Upah jahit|Hak upah|Belum dibayar|Nilai hitungan|987\.654|4\.938\.270|PRIVATE_CONTACT/);
    const reads=h.run('qcReadTables');for(const name of ['Potong','QC','SlipUpah','LegacySettlement'])assert.equal(reads.includes(name),false,name+' must not be loaded for a redacted physical slip');
  }
  for(const id of ['qccount2','qccount3']){const r=call('makePdf',{type:'setor',id,token});assert.equal(r.ok,false);assert.match(r.error,/setelah QC menghitung/);}
  const closed=call('makePdf',{type:'setor',id:'closedss1',token});assert.equal(closed.ok,false);assert.match(closed.error,/pekerjaan QC/);
  const pay=call('makePdf',{type:'upah',id:'foreignpay',token});assert.equal(pay.ok,false);assert.match(pay.error,/Bukan slip/);
  const weekly=call('makeWeeklyPdf',{pegawaiId:'sewer001',start:'2026-10-05',end:'2026-10-11',token});assert.equal(weekly.ok,false);assert.match(weekly.error,/Bukan slip/);
  assert.equal(JSON.stringify(Object.fromEntries(Object.entries(h.sheets).map(([n,s])=>[n,s.values]))),before);
  const text=h.run(`coreSlipText('setor',pkStore_().read('SlipSetor')[0],{hideMoney:true,settings:{},po:{},payroll:[{sourceId:'qccount1',total:5,available:5,rate:987654}]})`);
  assert.match(text,/5 pcs/);assert.doesNotMatch(text,/Rp |Harga:|Hak upah|Belum dibayar|Nilai hitungan/);
  good('makePdf',{type:'setor',id:'qccount1'});assert.match(h.run('slipTestHtml'),/Rp 987\.654/,'owner keeps the financial rendering');
  good('makePdf',{type:'kirim',id:'qcsend01',token:'sewer_test_session_1234'});assert.doesNotMatch(h.run('slipTestHtml'),/Rp |Upah jahit/,'sewing assignment follows its existing state redaction');
});

test('old clients cannot save material invoices before any backend write',()=>{
  const {h,call}=fixture();vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/bahan-invoice.js'),'utf8'),h.context);
  const before=JSON.stringify(Object.fromEntries(Object.entries(h.sheets).map(([n,s])=>[n,s.values])));
  const result=call('saveInvoiceBahan',{workflowVersion:1,invoice:{id:'oldinvoice',tanggal:'2026-10-08',items:[{bahan:'Cotton',qty:5,satuan:'kg',rol:1,harga:100}]}});
  assert.equal(result.ok,false);assert.match(result.error,/Versi alur/);assert.equal(JSON.stringify(Object.fromEntries(Object.entries(h.sheets).map(([n,s])=>[n,s.values]))),before);
});
