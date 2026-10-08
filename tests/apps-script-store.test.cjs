'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'src/core.js'), 'utf8');
const adapter = fs.readFileSync(path.join(root, 'apps-script/Server.gs'), 'utf8');

const { harness } = require('./helpers/apps-script-harness.cjs');

test('real store adds new schema columns without shifting reordered columns or user columns', () => {
  const h = harness({ SlipSetor: [['catatan', 'custom', 'id', 'total', 'ukuran'], ['lama', 'keep', 'count01', 5, '{"M":5}']] });
  const oldHeader = h.sheets.SlipSetor.values[0].slice();
  const row = h.run('pkStore_().read("SlipSetor")[0]');
  assert.equal(row.id, 'count01'); assert.equal(row.total, 5); assert.equal(row.ukuran, '{"M":5}');
  assert.deepEqual(h.sheets.SlipSetor.values[0].slice(0, oldHeader.length), oldHeader);
  assert.ok(h.sheets.SlipSetor.values[0].includes('rejectUkuran'));
  h.run('pkStore_().lock(function(){pkStore_().update("SlipSetor","count01",{catatan:"baru",reject:1,rejectUkuran:{M:1}});})');
  assert.equal(h.sheets.SlipSetor.values[1][1], 'keep');
  h.cold();
  assert.deepEqual(h.run('JSON.parse(pkStore_().read("SlipSetor")[0].rejectUkuran)'), { M: 1 });
});

test('replaceAll retains extra values by record id even when incoming row order changes', () => {
  const h = harness({ Potong: [['custom', 'id', 'total'], ['first-note', 'cut001', 2], ['second-note', 'cut002', 3]] });
  h.run('pkStore_().lock(function(){pkStore_().replaceAll("Potong",[{id:"cut002",total:7,ukuran:{L:7}},{id:"cut001",total:4,ukuran:{M:4}}]);})');
  assert.equal(h.sheets.Potong.values[1][0], 'second-note');
  assert.equal(h.sheets.Potong.values[2][0], 'first-note');
  h.cold();
  assert.deepEqual(h.run('pkStore_().read("Potong").map(function(r){return [r.id,r.total,JSON.parse(r.ukuran)];})'), [['cut002', 7, { L: 7 }], ['cut001', 4, { M: 4 }]]);
});

test('JSON snapshots and categories round-trip through actual adapter and cold script cache', () => {
  const h = harness();
  h.run(`pkStore_().lock(function(){
    pkStore_().append('SlipUpah',{id:'pay001',itemIds:['setor:count01:M'],items:[{sourceId:'count01',total:4,rate:2000,ukuran:{M:4},note:'Jahit 🧵'}],totalQty:4,totalUpah:8000});
    pkStore_().append('QC',{id:'qc0001',setorId:'count01',repairQcId:'qcbase',ukuran:{M:4},total:4,perbaikan:-4,perbaikanUkuran:{M:-4},offlineUkuran:{},rejectUkuran:{}});
    pkStore_().setSettings({ukuran:['M','L'],namaUsaha:'=formula as text'});
  });`);
  assert.equal(h.properties.ver, '1'); assert.equal(h.isLocked(), false);
  h.cold();
  assert.deepEqual(h.run('JSON.parse(pkStore_().read("SlipUpah")[0].items)'), [{ sourceId: 'count01', total: 4, rate: 2000, ukuran: { M: 4 }, note: 'Jahit 🧵' }]);
  assert.deepEqual(h.run('JSON.parse(pkStore_().read("QC")[0].perbaikanUkuran)'), { M: -4 });
  assert.equal(h.run('pkStore_().getSettings().namaUsaha'), '=formula as text');
  assert.ok(h.events.some(e => e[0] === 'cache.get' && e.some(k => String(k).startsWith('pk3|'))));
});

test('oversize JSON fails before append, update or replacement writes and releases the lock', () => {
  const h = harness();
  h.run('pkStore_().lock(function(){pkStore_().append("SlipUpah",{id:"pay001",catatan:"before",items:"[]"});})');
  const before = JSON.stringify(h.sheets.SlipUpah.values), version = h.properties.ver, writes = h.sheets.SlipUpah.writes;
  assert.throws(() => h.run('pkStore_().lock(function(){pkStore_().append("SlipUpah",{id:"pay002",items:"x".repeat(49001)});})'), /terlalu panjang/);
  assert.throws(() => h.run('pkStore_().lock(function(){pkStore_().update("SlipUpah","pay001",{catatan:"changed",items:"x".repeat(49001)});})'), /terlalu panjang/);
  assert.equal(h.run('pkStore_().read("SlipUpah")[0].catatan'), 'before');
  assert.throws(() => h.run('pkStore_().lock(function(){pkStore_().replaceAll("SlipUpah",[{id:"pay002",items:"x".repeat(49001)}]);})'), /terlalu panjang/);
  assert.equal(JSON.stringify(h.sheets.SlipUpah.values), before);
  assert.equal(h.sheets.SlipUpah.writes, writes); assert.equal(h.properties.ver, version); assert.equal(h.isLocked(), false);
});

test('schema fingerprint partitions old caches and changes even when column count stays the same', () => {
  const h = harness({ QC: [['id', 'setorId', 'ukuran', 'total'], ['qc0001', 'count01', '{"M":2}', 2]] });
  h.cached['pk2|0|QC|0'] = '1'; h.cached['pk2|0|QC|0|0'] = '[{"id":"stale"}]';
  assert.equal(h.run('pkStore_().read("QC")[0].id'), 'qc0001');
  const before = h.run('pkSchema_()');
  h.run('SCHEMA.QC[SCHEMA.QC.indexOf("repairQcId")]="repairSource";');
  assert.notEqual(h.run('pkSchema_()'), before);
  h.cold(); h.run('pkSetup_();');
  assert.ok(h.sheets.QC.values[0].includes('repairSource'));
  assert.equal(h.properties.schema, h.run('pkSchema_()'));
  assert.equal(h.run('pkStore_().read("QC")[0].id'), 'qc0001');
});

test('checkpoint reloads physical Sheets despite stale execution and script caches', () => {
  const h = harness();
  h.run('pkStore_().lock(function(){pkStore_().append("Potong",{id:"cut001",total:2,ukuran:{M:2}});});');
  const sheet = h.sheets.Potong, totalColumn = sheet.values[0].indexOf('total');
  sheet.values[1][totalColumn] = 9;
  assert.equal(h.run('pkStore_().read("Potong")[0].total'), 2, 'the existing execution still has its staged rows');
  h.run('pkStore_().checkpoint(["Potong"]);');
  assert.equal(h.run('pkStore_().read("Potong")[0].total'), 9);
  h.cold();
  assert.equal(h.run('pkStore_().read("Potong")[0].total'), 9, 'checkpoint invalidates old metadata even before a version publication');
  h.run('pkStore_().checkpoint(["Potong"]);');
  assert.equal(h.run('pkStore_().read("Potong")[0].total'), 9, 'checkpoint bypasses ScriptCache as well');
});

test('checkpoint keeps dirty table tracking and publishes the verified rows at commit', () => {
  const h = harness();
  h.run('pkStore_().lock(function(){pkStore_().append("Potong",{id:"cut001",total:2});pkStore_().checkpoint(["Potong"]);pkStore_().append("QC",{id:"qc0001",total:1});pkStore_().checkpoint(["QC"]);});');
  assert.equal(h.properties.ver, '1');
  assert.equal(h.properties.v_Potong, '1');
  assert.equal(h.properties.v_QC, '1');
  assert.equal(h.isLocked(), false);
  assert.equal(h.events.filter(e => e[0] === 'flush').length, 3, 'two durable boundaries plus the ordinary transaction commit');
  h.cold();
  assert.equal(h.run('pkStore_().read("Potong")[0].total'), 2);
  assert.equal(h.run('pkStore_().read("QC")[0].total'), 1);
});

test('checkpoint flush failure prevents dependent writes and releases the transaction lock', () => {
  const h = harness();
  h.run('pkStore_().lock(function(){pkStore_().append("Potong",{id:"cut001",total:2});});');
  const before = JSON.stringify(h.sheets.Potong.values), version = h.properties.ver;
  h.context.SpreadsheetApp.flush = () => { throw new Error('Flush gagal'); };
  assert.throws(() => h.run('pkStore_().lock(function(){pkStore_().checkpoint(["Potong"]);pkStore_().replaceAll("Potong",[{id:"newcut",total:9}]);});'), /Flush gagal/);
  assert.equal(JSON.stringify(h.sheets.Potong.values), before);
  assert.equal(h.properties.ver, version);
  assert.equal(h.isLocked(), false);
});

test('cold request after checkpoint sees durable migration data even without lock-finally version publication', () => {
  const h = harness();
  h.run('pkStore_().lock(function(){pkStore_().append("Potong",{id:"cut001",total:2});pkStore_().setSettings({legacyMigrationStatus:false});});');
  const version = h.properties.ver, cuttingVersion = h.properties.v_Potong, settingsVersion = h.properties.v_Pengaturan;
  // Stage the middle of a transaction, then discard its runtime as a hard timeout
  // would, deliberately without executing the outer lock's finally block.
  h.run('pkStore_().setSettings({legacyMigrationStatus:{batchId:"batch001"}});pkStore_().checkpoint(["Pengaturan"]);pkStore_().replaceAll("Potong",[{id:"newcut",total:9}]);pkStore_().checkpoint(["Potong"]);');
  h.cold();
  assert.equal(h.properties.ver, version);
  assert.equal(h.properties.v_Potong, cuttingVersion);
  assert.equal(h.properties.v_Pengaturan, settingsVersion);
  assert.equal(h.run('pkStore_().getSettings().legacyMigrationStatus.batchId'), 'batch001');
  assert.equal(h.run('pkStore_().read("Potong")[0].id'), 'newcut');
  assert.equal(h.run('pkStore_().read("Potong")[0].total'), 9);
  h.run('pkStore_().setSettings({legacyMigrationStatus:false});pkStore_().checkpoint(["Pengaturan"]);');
  h.cold();
  assert.equal(h.run('pkStore_().getSettings().legacyMigrationStatus'), false);
  assert.equal(h.run('pkStore_().read("Potong")[0].id'), 'newcut', 'clearing the marker cannot expose stale production caches');
});

test('checkpoint stops on ScriptCache invalidation failure before dependent production writes', () => {
  const h = harness();
  h.run('pkStore_().lock(function(){pkStore_().append("Potong",{id:"cut001",total:2});});');
  const before = JSON.stringify(h.sheets.Potong.values);
  h.context.CacheService.getScriptCache().remove = () => { throw new Error('Cache remove gagal'); };
  assert.throws(() => h.run('pkStore_().lock(function(){pkStore_().checkpoint(["Potong"]);pkStore_().replaceAll("Potong",[{id:"newcut",total:9}]);});'), /Cache remove gagal/);
  assert.equal(JSON.stringify(h.sheets.Potong.values), before);
  assert.equal(h.isLocked(), false);
});

test('migration layout preflight protects nonempty extra columns without changing ordinary replacement', () => {
  for (const extraValue of ['historical note', 0, false]) {
    const h = harness({ SlipSetor: [['id', 'custom', 'total'], ['oldcount', extraValue, 20]] });
    const before = JSON.stringify(h.sheets.SlipSetor.values), writes = h.sheets.SlipSetor.writes;
    assert.throws(() => h.run('pkStore_().validateMigrationLayout(["SlipSetor"]);'), /kolom tambahan/);
    assert.equal(JSON.stringify(h.sheets.SlipSetor.values), before);
    assert.equal(h.sheets.SlipSetor.writes, writes);
    assert.equal(h.properties.ver, undefined);
  }
  const empty = harness({ SlipSetor: [['id', 'custom', 'total'], ['oldcount', '', 20]] });
  assert.doesNotThrow(() => empty.run('pkStore_().validateMigrationLayout(["SlipSetor","QC"]);'));
  assert.equal(empty.sheets.QC, undefined, 'layout checking must not create missing tables');
});

test('migration layout preflight rejects duplicate headings and data below a blank heading', () => {
  for (const values of [
    [['id', 'total', ' id '], ['oldcount', 20, 'oldcount']],
    [['id', 'custom', 'custom'], ['oldcount', '', '']],
    [['id', '__proto__', '__proto__'], ['oldcount', '', '']],
    [['id', '', 'total'], ['oldcount', 'unlabelled note', 20]]
  ]) {
    const h = harness({ SlipSetor: values });
    const before = JSON.stringify(h.sheets.SlipSetor.values);
    assert.throws(() => h.run('pkStore_().validateMigrationLayout(["SlipSetor"]);'), /judul kolom ganda|kolom tambahan/);
    assert.equal(JSON.stringify(h.sheets.SlipSetor.values), before);
  }
});

test('real import API preflights every replacement table and settings before the first write', () => {
  const cases = [
    { data: { PO: [{ id: 'po00001', nama: 'Baru', status: 'aktif', ukuran: { M: 10 }, total: 10 }], Potong: [{ id: 'cut0001', poId: 'po00001', ukuran: { M: 10 }, total: 10, catatan: 'x'.repeat(49001) }] } },
    { data: { PO: [{ id: 'po00001', nama: 'Baru', status: 'aktif', ukuran: { M: 10 }, total: 10 }] }, pengaturan: { ukuran: ['X'.repeat(49001)] } }
  ];
  for (const payload of cases) {
    const h = harness();
    const setup = h.request('setupOwner', { nama: 'Owner', pin: '1234' }); assert.equal(setup.ok, true);
    const before = JSON.stringify(Object.fromEntries(Object.entries(h.sheets).map(([name, sh]) => [name, sh.values])));
    const version = h.properties.ver;
    for (const coba of [true, false]) {
      h.cold();
      const result = h.request('gantiImpor', { workflowVersion: 2, token: setup.data.token, ...payload, coba });
      assert.equal(result.ok, false); assert.match(result.error, /terlalu panjang/);
      assert.equal(JSON.stringify(Object.fromEntries(Object.entries(h.sheets).map(([name, sh]) => [name, sh.values]))), before);
      assert.equal(h.properties.ver, version); assert.equal(h.isLocked(), false);
    }
  }
});

test('real importRows preflights rows and pending settings together', () => {
  const cases = [
    { sheet: 'PO', rows: [{ id: 'po00001', catatan: 'x'.repeat(49001) }], ukuran: ['NEW'] },
    { sheet: 'PO', rows: [{ id: 'po00001', nama: 'Baru' }], ukuran: ['X'.repeat(49001)] }
  ];
  for (const payload of cases) {
    const h = harness();
    const setup = h.request('setupOwner', { nama: 'Owner', pin: '1234' }); assert.equal(setup.ok, true);
    const before = JSON.stringify(Object.fromEntries(Object.entries(h.sheets).map(([name, sh]) => [name, sh.values])));
    const version = h.properties.ver;
    h.cold();
    const result = h.request('importRows', { workflowVersion: 2, token: setup.data.token, ...payload });
    assert.equal(result.ok, false); assert.match(result.error, /terlalu panjang/);
    assert.equal(JSON.stringify(Object.fromEntries(Object.entries(h.sheets).map(([name, sh]) => [name, sh.values]))), before);
    assert.equal(h.properties.ver, version); assert.equal(h.isLocked(), false);
  }
});

test('real importRows rejects old clients before writes and accepts v2 during setup and after login', () => {
  for (const configured of [false, true]) {
    const h = harness(); let token;
    if (configured) {
      const setup = h.request('setupOwner', { nama: 'Owner', pin: '1234' }); assert.equal(setup.ok, true); token = setup.data.token;
    } else h.run('pkSetup_();');
    const payload = { token, sheet: 'PO', rows: [{ id: 'po00001', nama: 'Import', ukuran: { M: 10 }, total: 10 }], ukuran: ['M', 'NEW'] };
    const snapshot = () => JSON.stringify(Object.fromEntries(Object.entries(h.sheets).map(([name, sh]) => [name, { values: sh.values, writes: sh.writes }])));
    const before = snapshot(), version = h.properties.ver;
    for (const workflowVersion of [undefined, 1]) {
      h.cold();
      const lockCount = h.events.filter(e => e[0] === 'lock').length;
      const result = h.request('importRows', { ...payload, workflowVersion });
      assert.equal(result.ok, false); assert.match(result.error, /Versi alur produksi tidak cocok/);
      assert.equal(snapshot(), before); assert.equal(h.properties.ver, version);
      assert.equal(h.events.filter(e => e[0] === 'lock').length, lockCount, 'version guard runs before mutation lock');
    }
    h.cold();
    const accepted = h.request('importRows', { ...payload, workflowVersion: 2 });
    assert.equal(accepted.ok, true, accepted.error); assert.equal(accepted.data.ditambah, 1);
    h.cold();
    assert.equal(h.run('pkStore_().read("PO")[0].id'), 'po00001');
    assert.ok(h.run('pkStore_().getSettings().ukuran').includes('NEW'));
  }
});

test('settings validates the whole object before updating any existing key', () => {
  const h = harness();
  h.run('pkStore_().lock(function(){pkStore_().setSettings({namaUsaha:"Before",ukuran:["M"]});})');
  const before = JSON.stringify(h.sheets.Pengaturan.values), version = h.properties.ver;
  assert.throws(() => h.run('pkStore_().lock(function(){pkStore_().setSettings({namaUsaha:"Changed",ukuran:["x".repeat(49001)]});})'), /terlalu panjang/);
  assert.equal(JSON.stringify(h.sheets.Pengaturan.values), before);
  assert.equal(h.properties.ver, version); assert.equal(h.isLocked(), false);
});

test('real API core+Sheets adapter completes count/QC/payroll and preserves payment after cold reload', () => {
  const h = harness();
  const setup = h.request('setupOwner', { nama: 'Owner', pin: '1234' }); assert.equal(setup.ok, true);
  const token = setup.data.token;
  function call(action, payload = {}) {
    h.cold(); const res = h.request(action, { workflowVersion: 2, token, ...payload });
    assert.equal(res.ok, true, res.error); return res.data?.data ?? res.data;
  }
  const worker = call('saveUser', { user: { nama: 'Penjahit', divisi: 'jahit' } });
  const cutter = call('saveUser', { user: { nama: 'Potong', divisi: 'potong' } });
  call('savePO', { po: { newId: 'po00001', nama: 'Kaos', ukuran: { M: 10 } } });
  call('createPotong', { potong: { id: 'cut0001', poId: 'po00001', userId: cutter.id, ukuran: { M: 10 }, tarif: 500 } });
  call('createKirim', { kirim: { id: 'send001', poId: 'po00001', maklonId: worker.id, ukuran: { M: 10 }, upah: 2000 } });
  call('createSetor', { setor: { id: 'count01', poId: 'po00001', maklonId: worker.id, ukuran: { M: 10 } } });
  call('createQC', { qc: { id: 'qc00001', poId: 'po00001', setorId: 'count01', ukuran: { M: 8 }, offline: 2, offlineUkuran: { M: 2 } } });
  const slip = call('createUpah', { upah: { id: 'pay0001', pegawaiId: worker.id, itemIds: ['setor:count01:M'] } });
  assert.equal(slip.totalQty, 8); assert.equal(slip.totalUpah, 16000);
  const state = call('getState');
  assert.equal(state.payroll.find(r => r.sourceId === 'count01').available, 0);
  assert.equal(state.upah[0].items[0].total, 8); assert.equal(state.po[0].workflow.complete, true);
  assert.equal(state.warehouse[0].total, 8);
  const savedCount = h.sheets.SlipUpah.getLastRow();
  call('createUpah', { upah: { id: 'pay0001', pegawaiId: worker.id, itemIds: ['setor:count01:M'] } });
  assert.equal(h.sheets.SlipUpah.getLastRow(), savedCount, 'dedupe must read real sheet after lock');
  assert.equal(h.isLocked(), false);
});

test('generated Apps Script HTML has the observed Index contract and valid inline JavaScript', () => {
  const html = fs.readFileSync(path.join(root, 'apps-script/Index.html'), 'utf8');
  assert.match(html, /<base target="_top">/);
  assert.match(html, /window\.PK_DIV = '__PK_DIV__'/);
  assert.match(html, /window\.PK_HOSTED = false/);
  assert.doesNotMatch(html, /rel="manifest"|getElementById\('pk-manifest'\)|serviceWorker\.register\('sw\.js'\)/);
  assert.doesNotMatch(html, /<link[^>]+href="logo-/);
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length >= 1); scripts.forEach((s, i) => new vm.Script(s[1], { filename: 'Index-inline-' + i }));
  new vm.Script(fs.readFileSync(path.join(root, 'apps-script/Core.gs'), 'utf8') + '\n' + adapter);
});
