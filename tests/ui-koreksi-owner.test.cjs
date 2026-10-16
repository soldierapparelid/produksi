'use strict';
/* 1544b: the owner corrects every division from the PO history: each row carries its own button. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}

test('assignment and sewing report rows get a delete button for owner/admin, paid or prepared rows show why they are locked',()=>{
  const riwayat=part('  /* riwayat */','ev.sort(');
  assert.match(riwayat,/slip: \['kirim', r\.id\], del: admin \? \['SlipKirim', r\.id\] : null/);
  assert.match(riwayat,/del: admin && !sourcePaid\(r\) && !\(st\.qc \|\| \[\]\)\.some\(function \(q\) \{ return q\.setorId === r\.id; \}\) \? \['SlipSetor', r\.id\] : null/);
  assert.match(riwayat,/kunci: sourcePaid\(r\) \? sourcePaymentChip\(r\) : \(admin && r\.rencanaId \? '<span class="chip"[^>]*>Dari persiapan<\/span>' : ''\)/);
  const baris=part('    var tail = e.slip ?','return \'<div class="item \' + e.c');
  assert.match(baris,/tail \+= \(e\.kunci \|\| ''\) \+ \(\(e\.del \? '<button class="icon-btn" aria-label="Hapus" data-a="del"/);
  assert.ok(baris.indexOf('data-a="slip"')<baris.indexOf('tail +='),'the delete button follows the Slip button on the same row');
});

test('the confirmation names what a delete does, and the home feed offers the undo of a count',()=>{
  const del=part('A.del = function (el) {','};');
  assert.match(del,/SlipSetor: 'Laporan setor penjahit dan hitungannya ikut terhapus\. Kalau hanya hitungannya yang salah, pakai Batalkan hitungan\.'/);
  assert.match(del,/text: akibat \|\| 'Angka progres PO ikut berubah\.'/);
  assert.match(html,/'">Hitung<\/button>' : \(typeof setorBisaBatal === 'function' && setorBisaBatal\(r\) \? '<button class="btn sm" data-a="setorBatalHitung"/);
  assert.match(html,/Salah input di divisi mana pun\? Hapus catatannya lewat ikon tempat sampah di barisnya/);
});
