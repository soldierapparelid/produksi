'use strict';
/* 1.5.74: the owner's "Tutup sisa PO lama" on the PO sheet. Invented data only. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..'), html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function part(a, b) { const p = html.indexOf(a), q = html.indexOf(b, p + a.length); assert.ok(p >= 0 && q > p, a); return html.slice(p, q); }
function ui() {
  const c = vm.createContext({ console, Promise });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core.js'), 'utf8'), c);
  vm.runInContext(`
    var A = {}, S = { state: { settings: { ukuran: ['M','L','XL'], poTutupSisa: {} }, setor: [] } }, D = { po: {} }, messages = [], sheet = '', calls = [], closed = 0, divisi = 'owner', form = {};
    var sheets = [{ node: {} }];
    function me() { return { divisi: divisi }; }
    function esc(s) { return String(s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
    function nf(n) { return String(n || 0); } function toast(s, e) { messages.push([s, !!e]); }
    function openSheet(fn) { sheet = fn(); } function sheetHtml(t, b, f) { return t + '|' + b + '|' + (f || ''); }
    function hid(k, v) { return '<input type="hidden" name="' + k + '" value="' + esc(v) + '">'; }
    function newId() { return 'req-baru-01'; } function formVals() { return Object.assign({}, form); } function closeSheet() { closed++; }
    function act(el, p) { return p; } function quiet() {} function req(action, payload) { calls.push({ action: action, payload: payload }); return Promise.resolve({}); }
    function namaUser(id) { return id === 'mk1' ? 'Mang Uji' : '—'; }
    function poUkuranPotong(po) { return po._belum || []; }
    function workflowFor(po) { return po.workflow || { issues: [], ukuran: {} }; }
    function T(po) { return po.t || {}; } function qcBalance() { return { ready: 0, waiting: 0 }; }
  `, c);
  vm.runInContext(part('function poTahap(', 'function stagesHtml('), c);
  vm.runInContext(part('A.poStatusSet = function', '/* ---------- ukuran lama yang belum pernah tercatat'), c);
  return c;
}
const run = (c, s) => vm.runInContext(s, c), plain = x => JSON.parse(JSON.stringify(x));
const el = (id, rev) => `({ getAttribute: function (k) { return k === 'data-id' ? '${id}' : k === 'data-revision' ? '${rev || ''}' : k === 'data-v' ? 'selesai' : ''; } })`;

test('a PO closed by the owner reads "Ditutup owner", not an unverified archive; the mark counts only from the same day', () => {
  const c = ui();
  run(c, "var po = { id: 'p1', status: 'selesai', selesaiPada: '2026-11-04' };");
  assert.equal(run(c, 'poTahap(po).label'), 'Arsip belum terverifikasi');
  run(c, "po.tutupSisa = JSON.stringify({ tanggal: '2026-11-04', alasan: 'Barang lama habis' });");
  assert.deepEqual(plain(run(c, 'poTahap(po)')), { k: 'selesai', label: 'Ditutup owner · sisa dilepas', cls: 'warn' });
  run(c, "po.selesaiPada = '2026-11-05';"); assert.equal(run(c, 'poTahap(po).label'), 'Arsip belum terverifikasi', 'an old mark does not label a PO finished on another day');
  run(c, "po.selesaiPada = '2026-11-04'; po.status = 'aktif';"); assert.equal(run(c, 'poTutup(po)'), null, 'an active PO is never closed');
  run(c, "po.status = 'selesai'; po.workflow = { issues: ['Catatan perlu dicek'], ukuran: {} };"); assert.equal(run(c, 'poTahap(po).label'), 'Perlu diperiksa', 'records that need review stay visible on a closed PO');
  run(c, "po.workflow = { issues: [], ukuran: {}, complete: true };"); assert.equal(run(c, 'poTahap(po).label'), 'Produksi selesai', 'a complete PO keeps its normal label');
});

test('the close dialog lists the leftover per stage, needs a reason and a tick, and sends one request id', async () => {
  const c = ui();
  run(c, `D.po.p1 = { id: 'p1', noPO: 'PO-9', nama: 'Kaos Uji', status: 'aktif', _belum: ['XL'],
    agg: { ukuran: { M: { siapKirim: 0 }, L: { qcPerbaikan: 3 } }, maklon: { mk1: { sisa: 40 } } },
    workflow: { issues: [], ukuran: { M: { siapKirim: 20 }, L: { siapQC: 55, legacyBlockedCount: 5 } } } };`);
  /* the assignment projection says 0 once QC has started; the leftover list reads the workflow (cut minus assigned) */
  run(c, "divisi = 'admin'; A.poTutupOpen(" + el('p1', 'rev-1') + ')');
  assert.equal(c.sheet, ''); assert.deepEqual(plain(c.messages.pop()), ['Hanya owner yang boleh menutup sisa PO lama.', true]);
  run(c, "divisi = 'owner'; A.poTutupOpen(" + el('p1', 'rev-1') + ')');
  assert.match(c.sheet, /^Tutup sisa PO lama\|/);
  assert.match(c.sheet, /<b>PO-9<\/b> · Kaos Uji/);
  assert.match(c.sheet, /Sisa ini tidak dihitung lagi:<\/b><br>Belum dipotong: XL<br>Sudah dipotong, belum ke penjahit: M 20<br>Di penjahit Mang Uji: 40 pcs<br>Sudah dihitung, QC belum dicatat: L 60<br>Dalam perbaikan QC: L 3<\/div>/);
  assert.match(c.sheet, /name="reqId" value="req-baru-01"[\s\S]*name="revision" value="rev-1"[\s\S]*name="alasan" maxlength="200"[\s\S]*name="yakin"/);
  assert.match(c.sheet, /data-a="poTutupSave">Tutup PO<\/button>$/);
  /* a report that waits to be counted blocks the button */
  run(c, "S.state.setor = [{ poId: 'p1', status: 'diajukan' }]; A.poTutupOpen(" + el('p1', 'rev-1') + ')');
  assert.match(c.sheet, /Ada 1 laporan setor yang menunggu dihitung/); assert.match(c.sheet, /data-a="poTutupSave" disabled>/);
  /* cutting evidence that needs review keeps the cutting wage on hold, so the PO cannot be closed yet */
  run(c, "S.state.setor = []; D.po.p1.cutting = { needsReview: true }; A.poTutupOpen(" + el('p1', 'rev-1') + ')');
  assert.match(c.sheet, /Bukti ukuran potong PO ini perlu diperiksa owner dulu\. Upah potongnya masih ditahan/); assert.match(c.sheet, /data-a="poTutupSave" disabled>/);
  run(c, "delete D.po.p1.cutting; A.poTutupOpen(" + el('p1', 'rev-1') + ')'); assert.match(c.sheet, /data-a="poTutupSave">Tutup PO/);
  /* save */
  run(c, "form = { id: 'p1', reqId: 'req-baru-01', revision: 'rev-1', alasan: ' ok ', yakin: true }; A.poTutupSave({})");
  assert.equal(c.calls.length, 0); assert.match(c.messages.pop()[0], /minimal 5/);
  run(c, "form.alasan = '  Barang   lama habis  '; form.yakin = false; A.poTutupSave({})");
  assert.equal(c.calls.length, 0); assert.match(c.messages.pop()[0], /Centang/);
  run(c, "form.yakin = true; A.poTutupSave({})");
  assert.deepEqual(plain(c.calls), [{ action: 'tutupSisaPO', payload: { id: 'p1', reqId: 'req-baru-01', alasan: 'Barang lama habis', expectedRevision: 'rev-1' } }]);
  await new Promise(r => setTimeout(r, 5));
  assert.equal(c.closed, 1); assert.deepEqual(plain(c.messages.pop()), ['PO ditutup. Sisanya tidak dihitung lagi.', false]);
});

test('Tandai selesai on an unfinished PO points the owner to the close button', () => {
  const c = ui();
  run(c, "D.po.p1 = { id: 'p1', status: 'aktif', workflow: { issues: [], ukuran: {}, complete: false } }; A.poStatusSet(" + el('p1') + ')');
  assert.match(c.messages.pop()[0], /Kalau sisa barangnya sudah tidak ada, pakai Tutup sisa PO lama\./);
  run(c, "divisi = 'admin'; A.poStatusSet(" + el('p1') + ')');
  assert.doesNotMatch(c.messages.pop()[0], /Tutup sisa PO lama/, 'an admin is not offered the owner button');
  assert.equal(c.calls.length, 0);
});

test('the PO sheet shows the button to the owner only on an unfinished active PO, and the closure note on a closed PO', () => {
  const sheetSrc = part('function poSheet(', 'A.poStatusSet =');
  assert.match(sheetSrc, /if \(po\.status === 'aktif' && !flow\.complete && me\(\)\.divisi === 'owner'\) foot = '<button class="btn" data-a="poTutupOpen"' \+ d \+ '>Tutup sisa PO lama<\/button>' \+ foot;/);
  assert.match(sheetSrc, /var tutup = poTutup\(po\);\n  if \(tutup\) h \+= '<div class="note"><b>Ditutup owner ' \+ tgl\(tutup\.tanggal\) \+ '\.<\/b> ' \+ esc\(tutup\.alasan\)/);
  assert.match(sheetSrc, /if \(qc\.waiting && !tutup\)/, 'no "QC tertahan" warning on a closed PO');
  assert.match(part('function maklonSheet(', 'rows.sort('), /jalan = po\.status === 'aktif'; if \(x && \(\(jalan && x\.sisa > 0\) \|\| x\.diajukan > 0\)\)/, 'pieces left on a PO that is not active are not running work at the tailor');
  assert.match(html, /\/\^\(savePO\|savePOWithRencana\|setStatusPO\|tutupSisaPO\|/, 'the client refuses the close against a server without workflow 2');
});
