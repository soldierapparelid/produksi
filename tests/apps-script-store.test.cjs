'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'src/core.js'), 'utf8');
const adapter = fs.readFileSync(path.join(root, 'apps-script/Server.gs'), 'utf8');

// Values are copied across reads as in Sheets. Physical columns may be reordered,
// unknown columns coexist with schema columns, and blank ranges remain rectangular.
class Sheet {
  constructor(name, values = []) { this.name = name; this.values = values.map(row => row.slice()); this.maxRows = 1000; this.writes = 0; }
  getName() { return this.name; }
  getLastRow() { for (let i = this.values.length - 1; i >= 0; i--) if (this.values[i].some(v => v !== '' && v != null)) return i + 1; return 0; }
  getLastColumn() { return this.values.reduce((n, row) => { for (let i = row.length - 1; i >= n; i--) if (row[i] !== '' && row[i] != null) return i + 1; return n; }, 0); }
  getMaxRows() { return this.maxRows; }
  setFrozenRows() { return this; }
  insertRowsAfter(at, count) { assert.ok(at <= this.maxRows); this.maxRows += count; return this; }
  deleteRow(row) { this.values.splice(row - 1, 1); this.maxRows--; this.writes++; }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  getRange(row, col, height, width) {
    assert.ok(row >= 1 && col >= 1 && height >= 1 && width >= 1);
    assert.ok(row + height - 1 <= this.maxRows, 'range exceeds allocated rows');
    const sheet = this;
    const range = {
      getValues() { return Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => sheet.values[row + r - 1]?.[col + c - 1] ?? '')); },
      setValues(rows) {
        assert.equal(rows.length, height);
        rows.forEach(values => { assert.equal(values.length, width); values.forEach(value => assert.ok(typeof value !== 'string' || value.length <= 50000, 'Google Sheets cell limit')); });
        rows.forEach((values, r) => {
          const target = sheet.values[row + r - 1] || (sheet.values[row + r - 1] = []);
          values.forEach((value, c) => { target[col + c - 1] = value; });
        });
        sheet.writes++; return range;
      },
      clearContent() { return range.setValues(Array.from({ length: height }, () => Array(width).fill(''))); },
      setNumberFormat() { return range; },
      setNumberFormats(formats) { assert.equal(formats.length, height); formats.forEach(r => assert.equal(r.length, width)); return range; },
      setFontWeight() { return range; },
      getSheet() { return sheet; }
    };
    return range;
  }
}

function harness(initial = {}) {
  const sheets = Object.fromEntries(Object.entries(initial).map(([name, values]) => [name, new Sheet(name, values)]));
  const properties = {}, cached = {}, events = [];
  let serial = 0, held = false;
  const props = {
    getProperties: () => ({ ...properties }), getProperty: key => properties[key] ?? null,
    setProperty(key, value) { properties[key] = String(value); },
    setProperties(values, removeOthers) { if (removeOthers) Object.keys(properties).forEach(k => delete properties[k]); Object.assign(properties, values); },
    deleteProperty(key) { delete properties[key]; }
  };
  const book = {
    getSheetByName: name => sheets[name] || null,
    insertSheet(name) { return sheets[name] = new Sheet(name); },
    getSpreadsheetTimeZone: () => 'Asia/Jakarta'
  };
  const cache = {
    getAll(keys) { events.push(['cache.get', ...keys]); return Object.fromEntries(keys.filter(k => Object.hasOwn(cached, k)).map(k => [k, cached[k]])); },
    putAll(values) { Object.assign(cached, values); }, put(key, value) { cached[key] = value; }, remove(key) { delete cached[key]; }
  };
  const context = vm.createContext({
    Date, console,
    PropertiesService: { getScriptProperties: () => props },
    CacheService: { getScriptCache: () => cache },
    SpreadsheetApp: { getActiveSpreadsheet: () => book, flush: () => events.push(['flush']) },
    LockService: { getScriptLock: () => ({ waitLock() { assert.equal(held, false); held = true; events.push(['lock']); }, releaseLock() { held = false; events.push(['unlock']); } }) },
    Utilities: { getUuid: () => (++serial).toString(16).padStart(16, '0').padEnd(32, '0'), formatDate: date => date.toISOString().slice(0, 10) }
  });
  vm.runInContext(core + '\n' + adapter, context);
  function run(code) { const value = vm.runInContext(code, context); return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function request(action, payload = {}) { return JSON.parse(run(`api(${JSON.stringify(JSON.stringify({ action, payload }))})`)); }
  function cold() { run('PK_STORE_ = null; PK_PROPS_ = null;'); }
  return { context, sheets, properties, cached, events, run, request, cold, isLocked: () => held };
}

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
    const result = h.request('importRows', { token: setup.data.token, ...payload });
    assert.equal(result.ok, false); assert.match(result.error, /terlalu panjang/);
    assert.equal(JSON.stringify(Object.fromEntries(Object.entries(h.sheets).map(([name, sh]) => [name, sh.values]))), before);
    assert.equal(h.properties.ver, version); assert.equal(h.isLocked(), false);
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
