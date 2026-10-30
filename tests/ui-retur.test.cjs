'use strict';
/* 1.5.60 Retur paket di tampilan: menu hanya untuk owner, halaman menolak peran lain, sel CSV aman, pembaca Excel multi-lembar. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
function part(html, a, b) { const p = html.indexOf(a), q = html.indexOf(b, p + a.length); assert.ok(p >= 0 && q > p, a); return html.slice(p, q); }

function menu(file, role) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const context = vm.createContext({ role });
  vm.runInContext(`
    var VIEWS = {}, UI_VERSION = '1.5.62', HARI_ARSIP = 30, A = {}, C = {};
    var S = {sub: {lain: 'menu'}, f: {}, state: {settings: {namaUsaha: 'Soldier'}, produk: [], users: [], karyawan: [], trimmed: false}};
    var DIVISI = {owner: {label: 'Owner'}, admin: {label: 'Admin'}, potong: {label: 'Potong'}, jahit: {label: 'Jahit'}, qc: {label: 'QC'}};
    var Api = {mode: function () { return 'hosted'; }}, LS = {get: function () { return ''; }};
    function me() { return {nama: 'Tim uji', divisi: role}; }
    function stokTampil() { return []; } function inisial() { return 'TU'; } function esc(v) { return String(v); } function ic(n) { return '<i data-icon="' + n + '"></i>'; }
    function backHead(t) { return '<h1>' + t + '</h1>'; } function emptyBox(t) { return '<p>' + t + '</p>'; }
  `, context);
  vm.runInContext(part(html, 'VIEWS.lain = function () {', '\nfunction backHead('), context);
  vm.runInContext(part(html, 'function returView() {', 'A.returMenu = function'), context);
  return { html: vm.runInContext('VIEWS.lain()', context), retur: () => vm.runInContext("S.sub.lain = 'retur'; VIEWS.lain()", context) };
}

for (const file of ['index.html', 'apps-script/Index.html']) {
  test(`${file}: the owner finds Retur paket in the Admin group; other roles never see it`, () => {
    const owner = menu(file, 'owner').html;
    assert.equal((owner.match(/data-a="returMenu"/g) || []).length, 1);
    const label = owner.indexOf('<span class="t">Retur paket</span>');
    assert.ok(label > owner.indexOf('<div class="label">Admin</div>') && label < owner.indexOf('<div class="label">Data induk</div>'));
    assert.ok(!/https?:\/\//.test(owner.slice(label - 300, label + 200)), 'no external site: returns live inside this app');
    for (const role of ['admin', 'potong', 'jahit', 'qc']) {
      const r = menu(file, role);
      assert.ok(!r.html.includes('returMenu'), role);
      assert.match(r.retur(), /khusus owner/, role + ' cannot open the page by its sub key');
    }
  });
}

test('CSV cells keep long IDs as text and neutralise formulas', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const c = vm.createContext({});
  vm.runInContext(part(html, 'function returCsvSel(v) {', 'A.returCsv = function'), c);
  assert.equal(c.returCsvSel('576000000000000001'), '"=""576000000000000001"""');
  assert.equal(c.returCsvSel('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(c.returCsvSel('-5'), '"\'-5"');
  assert.equal(c.returCsvSel('Kaos "BDU"'), '"Kaos ""BDU"""');
  assert.equal(c.returCsvSel(null), '""');
});

test('the Excel reader keeps cell positions, shared strings and numeric cells', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const c = vm.createContext({});
  vm.runInContext(part(html, 'function sjXmlTeks(s) {', 'function sjBaris('), c);
  vm.runInContext(part(html, 'function returKolom(ref) {', 'function returXlsx(buf) {'), c);
  const xml = '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
    '<row r="2"><c r="A2" t="inlineStr"><is><t>SH-1 &amp; 2</t></is></c><c r="B2"><v>46307.5</v></c><c r="C2" t="str"><v>Sedang dikembalikan</v></c></row><row r="3"/></sheetData>';
  const rows = JSON.parse(JSON.stringify(c.returXlsxBaris(xml, ['No. Pesanan', 'Status Pengembalian'])));
  assert.deepEqual(rows[0], ['No. Pesanan', '', 'Status Pengembalian']);
  assert.deepEqual(rows[1], ['SH-1 & 2', 46307.5, 'Sedang dikembalikan']);
  assert.deepEqual(rows[2], []);
  assert.equal(c.returKolom('AA'), 26);
});

test('the release keeps one shared version and a new page cache', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const core = fs.readFileSync(path.join(root, 'src/core.js'), 'utf8');
  assert.match(html, /var UI_VERSION = '1\.5\.62';/);
  assert.match(core, /var APP_VERSION = '1\.5\.62';/);
  assert.equal(html.match(/window\.PK_BUILD = '([^']+)'/)[1], worker.match(/var RAKITAN = '([^']+)'/)[1]);
  assert.match(html, /getReturState\|getReturDetail\|getReturBukti\)\$\/\.test\(action\)/, 'return reads use the read timeout');
});
