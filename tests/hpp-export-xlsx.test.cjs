'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const marker = /\/\* HPP XLSX START \*\/([\s\S]*?)\/\* HPP XLSX END \*\//;
const source = index.match(marker);
assert.ok(source, 'HPP XLSX function is present');
const context = vm.createContext({ TextEncoder, Uint8Array, Uint32Array, DataView });
vm.runInContext(source[1], context);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function unzip(bytes) {
  const b = Buffer.from(bytes), end = b.length - 22, files = {};
  assert.equal(b.readUInt32LE(end), 0x06054b50, 'ZIP ends with central directory record');
  assert.equal(b.readUInt16LE(end + 8), 6);
  let directory = b.readUInt32LE(end + 16);
  const directoryStart = directory;
  for (let i = 0; i < b.readUInt16LE(end + 10); i++) {
    assert.equal(b.readUInt32LE(directory), 0x02014b50);
    const nameSize = b.readUInt16LE(directory + 28), name = b.toString('utf8', directory + 46, directory + 46 + nameSize);
    const size = b.readUInt32LE(directory + 24), checksum = b.readUInt32LE(directory + 16), local = b.readUInt32LE(directory + 42);
    assert.equal(b.readUInt32LE(local), 0x04034b50);
    assert.equal(b.readUInt16LE(local + 8), 0, 'Stored compression method');
    assert.equal(b.readUInt16LE(local + 6), 0x0800, 'UTF-8 names');
    assert.equal(b.readUInt32LE(local + 14), checksum);
    assert.equal(b.readUInt32LE(local + 18), size);
    assert.equal(b.readUInt32LE(local + 22), size);
    assert.equal(b.toString('utf8', local + 30, local + 30 + nameSize), name);
    const content = b.subarray(local + 30 + nameSize, local + 30 + nameSize + size);
    assert.equal(crc32(content), checksum, name + ' checksum');
    files[name] = content.toString('utf8');
    directory += 46 + nameSize;
  }
  assert.equal(directory, end);
  assert.equal(directory - directoryStart, b.readUInt32LE(end + 12));
  return files;
}

function exportRows(rows, meta = { tanggal: '29 Oktober 2026', lingkup: '2 model aktif', catatan: 'Salinan terakhir; belum diperbarui.' }) {
  const before = JSON.stringify({ rows, meta });
  const result = context.commerceHppXlsx(rows, meta);
  assert.ok(result instanceof Uint8Array);
  assert.equal(JSON.stringify({ rows, meta }), before, 'Export must not mutate source data');
  return unzip(result);
}

test('HPP XLSX is a complete stored ZIP workbook with readable metadata, frozen header and filter', () => {
  const files = exportRows([{ nama: 'Contoh baju', series: 'Fixture', ukuran: 'M · L · XL', kain: 19134.4537815126, potong: 900, jahit: 3000, lain: 0, total: 23034.4537815126, status: 'Perkiraan', acuan: 'XL', hasil: 119, catatan: 'Harga belum diperiksa' }]);
  assert.equal(Object.keys(files).length, 6);
  assert.match(files['[Content_Types].xml'], /PartName="\/xl\/worksheets\/sheet1.xml"/);
  assert.match(files['_rels/.rels'], /Target="xl\/workbook.xml"/);
  assert.match(files['xl/workbook.xml'], /sheet name="Ringkasan HPP"/);
  assert.match(files['xl/_rels/workbook.xml.rels'], /Target="styles.xml"/);
  const sheet = files['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /Tanggal: 29 Oktober 2026/);
  assert.match(sheet, /Lingkup: 2 model aktif/);
  assert.match(sheet, /<c r="A4" s="2" t="inlineStr"><is><t xml:space="preserve">Salinan terakhir; belum diperbarui\./);
  assert.match(sheet, /ySplit="5" topLeftCell="A6"/);
  assert.match(sheet, /autoFilter ref="A5:L6"/);
  assert.match(sheet, /<c r="D6" s="4"><v>19134\.4537815126<\/v>/);
  assert.match(sheet, /<c r="K6" s="5"><v>119<\/v>/);
  assert.match(sheet, /<mergeCell ref="A1:L1"/);
  assert.match(files['xl/styles.xml'], /formatCode="#,##0.00"/);
});

test('HPP XLSX keeps missing and invalid money blank while preserving real zero', () => {
  const files = exportRows([{ nama: 'Kosong', kain: null, potong: undefined, jahit: 0, lain: NaN, total: Infinity, hasil: 0 }]);
  const sheet = files['xl/worksheets/sheet1.xml'];
  for (const col of ['D', 'E', 'G', 'H']) assert.match(sheet, new RegExp('<c r="' + col + '6" s="4"/>'));
  assert.match(sheet, /<c r="F6" s="4"><v>0<\/v><\/c>/);
  assert.match(sheet, /<c r="K6" s="5"><v>0<\/v><\/c>/);
  assert.doesNotMatch(sheet, />NaN<|>Infinity</);
});

test('HPP XLSX writes hostile text only as inline strings and removes invalid XML controls', () => {
  const name = ' =HYPERLINK("https://example.invalid", "klik") <tag> & \u0000\u0001\u000b\ufffe\uffff\ud800 Café 🧵';
  const files = exportRows([{ nama: name, series: '+CMD', ukuran: '-1+2', status: '@SUM(A1)', acuan: "'XL'", catatan: '\t=1+1\nBaris dua', kain: '=SUM(A1)', hasil: '10' }]);
  const sheet = files['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /t="inlineStr"><is><t xml:space="preserve"> =HYPERLINK\(&quot;/);
  assert.match(sheet, /&lt;tag&gt; &amp;/);
  assert.match(sheet, /Café 🧵/);
  assert.match(sheet, /&apos;XL&apos;/);
  assert.match(sheet, /\t=1\+1\nBaris dua/);
  assert.doesNotMatch(sheet, /<f(?:>|\s)|<hyperlinks|\u0000|\u0001|\u000b|\ufffe|\uffff|\ufffd/);
  assert.match(sheet, /<c r="D6" s="4"\/>/);
  assert.match(sheet, /<c r="K6" s="5"\/>/);
});

test('HPP XLSX supports an empty summary and exports every row beyond the UI pagination', () => {
  assert.match(exportRows([])['xl/worksheets/sheet1.xml'], /autoFilter ref="A5:L5"/);
  const rows = Array.from({ length: 151 }, (_, i) => ({ nama: 'Model ' + i, total: i }));
  const sheet = exportRows(rows)['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /autoFilter ref="A5:L156"/);
  assert.match(sheet, /Model 150/);
  assert.equal((sheet.match(/<row /g) || []).length, 156);
});

test('HPP XLSX refuses strings Excel cannot store without silently truncating them', () => {
  assert.throws(() => context.commerceHppXlsx([{ nama: 'x'.repeat(32768) }], {}), /Teks terlalu panjang/);
});
