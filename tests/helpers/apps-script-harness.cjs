'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
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

module.exports = { Sheet, harness };
