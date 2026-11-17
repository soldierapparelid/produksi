'use strict';
/* 1.5.76g: kartu PO yang masih harus dipotong bertanda Bahan siap / Menunggu bahan; judul Harus dipotong menghitung keduanya. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..'), html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function part(a, b) { const p = html.indexOf(a), q = html.indexOf(b, p + a.length); assert.ok(p >= 0 && q > p, a); return html.slice(p, q); }
function ui() {
  const c = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core.js'), 'utf8'), c);
  vm.runInContext("var S = { state: { rencanaPotong: [] } }; function poUkuranPotong(po) { return po._potong || []; }", c);
  vm.runInContext(part('function poMenungguBahan(po) {', 'function poCard(po, extra) {'), c);
  return c;
}
const run = (c, s) => vm.runInContext(s, c);

test('a PO still to cut shows Bahan siap when cloth is prepared and Menunggu bahan when it is not', () => {
  const c = ui();
  run(c, "var po = { id: 'p1', status: 'aktif', ukuranAktif: JSON.stringify(['M', 'L']), _potong: ['M', 'L'] };");
  assert.equal(run(c, 'poTandaBahan(po)'), '<span class="chip warn">Menunggu bahan</span>');
  run(c, "S.state.rencanaPotong = [{ id: 'r1', poId: 'p1', status: 'siap' }];");
  assert.equal(run(c, 'poBahanSiap(po)'), 'siap');
  assert.equal(run(c, 'poTandaBahan(po)'), '<span class="chip ok">Bahan siap</span>');
  /* a cancelled or blocked plan does not count */
  run(c, "S.state.rencanaPotong = [{ id: 'r1', poId: 'p1', status: 'batal' }, { id: 'r2', poId: 'p1', status: 'siap', legacyBlocked: true }];");
  assert.equal(run(c, 'poTandaBahan(po)'), '<span class="chip warn">Menunggu bahan</span>');
  /* continuing a partial cut uses the first preparation */
  run(c, "S.state.rencanaPotong = []; po.cutting = { lanjut: 'r0' };");
  assert.equal(run(c, 'poTandaBahan(po)'), '<span class="chip ok">Bahan ada · lanjut potong</span>');
  /* nothing left to cut, or not active: no mark */
  run(c, "po.cutting = null; S.state.rencanaPotong = [{ id: 'r1', poId: 'p1', status: 'siap' }]; po._potong = [];");
  assert.equal(run(c, 'poTandaBahan(po)'), '');
  run(c, "po._potong = ['M']; po.status = 'selesai';");
  assert.equal(run(c, 'poTandaBahan(po)'), '');
});

test('the card and the Harus dipotong heading use the mark and count both kinds', () => {
  assert.match(part('function poCard(po, extra) {', '/* sisa di satu maklon'), /poStatusChips\(po, th\) \+ poTandaBahan\(po\) \+/);
  assert.match(html, /<h3>Harus dipotong<\/h3><span class="xs muted">' \+ nf\(perluPotong\.length\) \+ ' PO' \+ \(function \(\) \{[^}]*if \(poMenungguBahan\(p\)\) t\+\+; else if \(poBahanSiap\(p\)\) s\+\+;/);
  assert.match(html, /' bahan siap' : ''\) \+ \(t \? ' · ' \+ nf\(t\) \+ ' menunggu bahan' : ''\)/);
});
