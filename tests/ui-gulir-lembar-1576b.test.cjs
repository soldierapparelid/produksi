'use strict';
/* 1.5.76b: daftar panjang di lembar (mis. Maklon > Tugaskan jahit > "Pilih PO yang dikirim") harus bisa digulir.
   .sheet-b adalah flex kolom yang menggulir; anak langsungnya tidak boleh menyusut. Kotak .card.flush memakai
   overflow hidden, jadi tanpa aturan ini ukuran minimumnya 0 dan daftarnya terpotong tanpa bisa digulir. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..'), html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = html.slice(0, html.indexOf('</style>'));
const rule = sel => { const m = css.match(new RegExp('^' + sel.replace(/[.*+?^$()|[\]\\>]/g, '\\$&') + ' \\{([^}]*)\\}', 'm')); return m ? m[1] : null; };

test('the sheet body scrolls and its direct children keep their full height', () => {
  assert.match(rule('.sheet-b'), /overflow-y: auto;/);
  assert.match(rule('.sheet-b'), /display: flex; flex-direction: column;/);
  assert.match(rule('.sheet-b > *'), /flex-shrink: 0;/, 'no child of the scrolling body may shrink');
  assert.equal(rule('.sheet-b > .search'), null, 'the older search-only rule is covered by the general one');
});

test('the PO picker puts its clipping list card straight in the sheet body, which is why the rule is needed', () => {
  assert.match(rule('.card.flush'), /overflow: hidden;/);
  const pick = html.slice(html.indexOf('function pickPO('), html.indexOf('function pickList('));
  assert.match(pick, /sheetHtml\(S\.pick\.title, '<label class="search">[^]*<\/label><div class="card flush"><div class="list" id="pick-list">/);
});

test('the page build changed together with the service worker', () => {
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.equal(html.match(/window\.PK_BUILD = '([^']+)'/)[1], '20261104-gulir-lembar-1576b');
  assert.equal(worker.match(/var RAKITAN = '([^']+)'/)[1], '20261104-gulir-lembar-1576b');
});
