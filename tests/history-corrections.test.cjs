const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = ['core.js','reconcile-legacy.js','history-corrections.js'].map(f => fs.readFileSync(path.join(root, 'src', f), 'utf8')).join('\n');

function app() {
  const ctx = vm.createContext({});
  vm.runInContext(source + `
    var db={}, config={}, version=1;
    Object.keys(SCHEMA).forEach(function(s){db[s]=[];});
    db.Pegawai=[{id:'owner01',divisi:'owner',nama:'Owner',aktif:true,token:'owner-token-123456789'}, {id:'admin01',divisi:'admin',nama:'Admin',aktif:true,token:'admin-token-123456789'}, {id:'cutter1',divisi:'potong',nama:'Pemotong',aktif:true,token:'cutter-token-12345678'}, {id:'worker1',divisi:'jahit',nama:'Penjahit',aktif:true,token:'worker-token-12345678'}];
    db.PO=[{id:'po00001',nama:'Test',status:'aktif',ukuran:{XXL:114},total:114,imporReview:'Bukti sejarah belum lengkap',imporSumber:JSON.stringify({legacyReconciliation:{mode:'review',sourceHash:'originalbackup',batchId:'batch001'}})}];
    db.Potong=[{id:'cut0001',poId:'po00001',userId:'cutter1',tanggal:'2026-10-01',ukuran:JSON.stringify({XXL:114}),total:114,bahan:'KATUN',kg:20,rol:1,tarif:500,upahId:'LAMA',asal:'lama'}];
    db.SlipKirim=[{id:'send001',noSlip:'SK001',poId:'po00001',maklonId:'worker1',tanggal:'2026-10-02',ukuran:JSON.stringify({XXL:144}),total:144,upah:2000,asal:'lama'}];
    db.SlipUpah=[{id:'receipt1',pegawaiId:'cutter1',jenis:'potong',itemIds:JSON.stringify(['cut0001']),tanggal:'2026-10-02',totalQty:114,totalUpah:57000,potongan:0,dibayar:57000}];
    var store={read:function(s){return db[s]||[];},append:function(s,r){db[s].push(r);version++;},appendMany:function(s,rs){db[s]=db[s].concat(rs);version++;},update:function(s,id,p){Object.assign(db[s].find(function(r){return r.id===id;}),p);version++;},remove:function(s,id){db[s]=db[s].filter(function(r){return r.id!==id;});version++;},replaceAll:function(s,r){db[s]=r;version++;},getSettings:function(){return config;},setSettings:function(s){config=s;version++;},version:function(){return version;},lock:function(fn){return fn();}};
    var pdfHtml='';
    var core=createCore(store,{now:function(){return new Date('2026-10-08T08:00:00Z');},id:function(){return 'unusedid';},makePdf:function(html){pdfHtml=html;return 'mockpdf';}});
  `, ctx);
  const run = code => JSON.parse(JSON.stringify(vm.runInContext(code, ctx)));
  const call = (action, payload = {}, token = 'owner-token-123456789') => run(`core.handle(${JSON.stringify(action)},JSON.parse(${JSON.stringify(JSON.stringify({ token, workflowVersion: 2, ...payload }))}))`);
  const get = (sheet = 'Potong', rowId = 'cut0001') => call('getHistoryCorrection', { poId: 'po00001', sheet, rowId });
  const save = (value, id = 'change01', state = get()) => call('saveHistoryCorrection', { id, poId: state.poId, sheet: state.sheet, rowId: state.rowId, expectedSourceHash: state.sourceHash, expectedLastCorrectionId: state.lastCorrectionId, ukuran: { XXL: value }, reason: 'Koreksi setelah pengecekan catatan fisik' });
  return { run, call, get, save };
}

test('114→144→114 changes physical projection and keeps raw paid source, receipt, material stock and review intact', () => {
  const a = app(); const before = a.run('JSON.stringify({potong:db.Potong,kirim:db.SlipKirim,upah:db.SlipUpah})');
  const oldState = a.call('getState', { semua: true });
  const first = a.save(144);
  assert.equal(first.data.effective.total, 144); assert.equal(first.data.reviewRemains, true);
  assert.equal(first.state.potong[0].total, 144); assert.equal(first.state.potong[0].historyCorrection.original.total, 114);
  assert.equal(first.state.po[0].workflow.ukuran.XXL.potong, 144); assert.equal(first.state.po[0].agg.total.potong, 144);
  assert.equal(first.state.payroll[0].total, 114); assert.equal(first.state.payroll[0].paidQty, 114);
  assert.deepEqual(first.state.stokRingkas, oldState.stokRingkas);
  assert.equal(first.state.po[0].imporReview, 'Bukti sejarah belum lengkap'); assert.equal(first.state.po[0].workflow.readyQC, false);
  /* the review stays on record, but since 1.5.22 an old-app PO no longer stops new work (see po-lama-jalan.test.cjs) */
  assert.deepEqual(first.state.po[0].workflow.issues, ['Bukti sejarah belum lengkap']); assert.deepEqual(first.state.po[0].workflow.blockingIssues, []); assert.equal(first.state.po[0].workflow.lama, true);
  a.call('makePdf', { type: 'upah', id: 'receipt1' });
  assert.match(a.run('pdfHtml'), /114/); assert.match(a.run('pdfHtml'), /57\.000/);
  const second = a.save(114, 'change02');
  assert.equal(second.data.history.length, 2); assert.equal(second.data.effective.total, 114);
  assert.equal(a.run('JSON.stringify({potong:db.Potong,kirim:db.SlipKirim,upah:db.SlipUpah})'), before);
  assert.equal(a.run('db.KoreksiRiwayat.length'), 2);
});

test('assignment correction uses the same overlay and original signed slip stays unchanged', () => {
  const a = app(), context = a.get('SlipKirim', 'send001');
  const saved = a.save(114, 'changesend', context);
  assert.equal(saved.state.kirim[0].total, 114); assert.equal(saved.state.po[0].workflow.ukuran.XXL.kirim, 114);
  assert.equal(a.run('db.SlipKirim[0].total'), 144);
  a.call('makePdf', { type: 'kirim', id: 'send001' }); assert.match(a.run('pdfHtml'), /144/);
});

test('only owner can edit active review imports; other roles get physical quantity without owner history', () => {
  const a = app(); a.save(144);
  for (const token of ['admin-token-123456789','worker-token-12345678','cutter-token-12345678']) {
    assert.throws(() => a.call('getHistoryCorrection', { poId:'po00001', sheet:'Potong', rowId:'cut0001' }, token), /Hanya owner/);
    const state = a.call('getState', { semua: true }, token), row = (state.potong || [])[0];
    if (row) { assert.equal(row.historyCorrectionEligible, false); assert.deepEqual(Object.keys(row.historyCorrection), ['original']); assert.equal(row.historyCorrection.original.total, 114); }
  }
  const original = a.get();
  a.run("db.PO[0].status='selesai';true"); assert.throws(() => a.save(115, 'change03', original), /PO aktif/);
  a.run("db.PO[0].status='aktif';db.PO[0].imporSumber=JSON.stringify({legacyReconciliation:{mode:'migrated'}});true"); assert.throws(() => a.get(), /PO aktif/);
});

test('source hash and prior correction ID prevent stale writes; exact retries append once', () => {
  const a = app(), first = a.get(); a.save(144, 'change01', first);
  assert.equal(a.save(144, 'change01', first).data.replayed, true);
  assert.equal(a.run('db.KoreksiRiwayat.length'), 1);
  assert.throws(() => a.save(143, 'change01', first), /perubahan lain/);
  assert.throws(() => a.save(143, 'change02', first), /berubah sejak/);
  const fresh = a.get(); a.run("db.Potong[0].tarif=600;true"); assert.throws(() => a.save(143, 'change03', fresh), /tidak cocok/);
  assert.equal(a.run('db.KoreksiRiwayat.length'), 1);
});

test('invalid counts, sizes and reasons never append a ledger row', () => {
  const a = app(), c = a.get();
  const base = { id:'change01', poId:c.poId, sheet:c.sheet, rowId:c.rowId, expectedSourceHash:c.sourceHash, expectedLastCorrectionId:c.lastCorrectionId, reason:'Terbukti dari catatan' };
  for (const value of [-1, 1.5, 0, 1000000001, '', null, true]) assert.throws(() => a.call('saveHistoryCorrection', { ...base, ukuran:{XXL:value} }), /Jumlah|Total/);
  for (const ukuran of [{L:144}, {}, {XXL:144,L:0}]) assert.throws(() => a.call('saveHistoryCorrection', {...base, ukuran}), /Ukuran/);
  for (const reason of ['', ' '.repeat(5), 'x'.repeat(301)]) assert.throws(() => a.call('saveHistoryCorrection', {...base, ukuran:{XXL:144}, reason}), /alasan/);
  assert.equal(a.run('db.KoreksiRiwayat.length'), 0);
});

test('correction ledger and raw source cannot be deleted, repriced, imported over or orphaned', () => {
  const a = app(); a.save(144);
  assert.throws(() => a.call('deleteRecord', {sheet:'KoreksiRiwayat',id:'change01'}), /tidak dapat dihapus/);
  assert.throws(() => a.call('deleteRecord', {sheet:'Potong',id:'cut0001'}), /tidak dapat dihapus/);
  assert.throws(() => a.call('ubahHarga', {sheet:'Potong',id:'cut0001',harga:900}), /tetap utuh/);
  assert.throws(() => a.call('importRows', {sheet:'KoreksiRiwayat',rows:[]}), /Sheet/);
  assert.throws(() => a.call('gantiImpor', {data:{Potong:[]}}), /sumber koreksi fisik/);
  assert.equal(a.run('db.KoreksiRiwayat.length'), 1); assert.equal(a.run('db.Potong[0].total'), 114);
});

test('corrupt chains fail closed without clearing review; v1 hashes survive future schema columns', () => {
  const a = app(), originalHash = a.get().sourceHash; a.save(144);
  a.run("SCHEMA.Potong.push('futureColumn');db.Potong[0].futureColumn='new';true");
  assert.equal(a.get().sourceHash, originalHash); assert.equal(a.get().effective.total, 144);
  a.run("db.KoreksiRiwayat[0].before=JSON.stringify({ukuran:{XXL:999},total:999});db.PO[0].imporReview='';true");
  const state = a.call('getState', {semua:true});
  assert.match(state.potong[0].historyCorrectionError, /tidak cocok/); assert.equal(state.potong[0].total, 114);
  assert.match(state.po[0].workflow.issues.join(' '), /tidak cocok/); assert.equal(state.po[0].workflow.readyQC, false);
  assert.throws(() => a.get(), /tidak cocok/);
});

test('old clients and pending migrations cannot save corrections', () => {
  const a = app(), c = a.get();
  const p = {id:'change01',poId:c.poId,sheet:c.sheet,rowId:c.rowId,expectedSourceHash:c.sourceHash,expectedLastCorrectionId:'',ukuran:{XXL:144},reason:'Catatan fisik'};
  assert.throws(() => a.call('saveHistoryCorrection', {...p, workflowVersion:1}), /Versi alur/);
  a.run("config.legacyMigrationStatus={batchId:'pending1'};true");
  assert.throws(() => a.call('saveHistoryCorrection', p), /Pemulihan riwayat belum selesai/);
  assert.equal(a.run('db.KoreksiRiwayat.length'), 0);
});
