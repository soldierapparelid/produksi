'use strict';
/* 1.5.76d: membuka Cetak daftar potong hanya membaca riwayat (getPrintHistory). Bila sambungan putus, pesannya tidak
   boleh menyebut "mungkin sudah tersimpan". Aksi simpannya (savePrintHistory) tetap diperlakukan sebagai simpan. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/var readOnly = (\/\^\([^)]*\)\$\/)\.test\(action\);/);
const readOnly = new RegExp(src[1].slice(1, -1));

test('reading the print history counts as a read, saving it still counts as a save', () => {
  assert.equal(readOnly.test('getPrintHistory'), true);
  assert.equal(readOnly.test('savePrintHistory'), false);
  for (const a of ['getState', 'getGambar', 'getCommerceState', 'getReturState']) assert.equal(readOnly.test(a), true, a);
  for (const a of ['qcMasukBigSeller', 'createGudang', 'deleteRecord', 'createUpah']) assert.equal(readOnly.test(a), false, a);
});

test('a read that loses the connection is not reported as a possibly saved change', () => {
  const failure = html.slice(html.indexOf('function failure(error) {'), html.indexOf('function failure(error) {') + 600);
  assert.match(failure, /else if \(!readOnly\) \{ e\.uncertain = true; e\.message = 'Sambungan terputus saat menyimpan\./);
  assert.match(html, /readOnly \? 'Server belum menjawab\. Coba muat ulang data\.'/);
});
