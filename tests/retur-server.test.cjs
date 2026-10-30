'use strict';
/* 1.5.60 Retur paket lewat adaptor Sheets asli dan Google Drive tiruan: owner/admin, impor tanpa menggandakan,
   penerimaan wajib bukti, bukti di Drive, paket tanpa resi dicocokkan. Data sintetis saja. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 1, 0, 72]).toString('base64');
function fixture() {
  const h = harness();
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src/retur.js'), 'utf8'), h.context);
  h.context.__dec = s => Array.from(Buffer.from(s, 'base64'));
  h.context.__enc = a => Buffer.from(a.map(b => (b + 256) % 256)).toString('base64');
  vm.runInContext(`
    var DRIVE = { files: {}, folders: {}, n: 0 };
    function MockFolder(id, name, parent) { this.id = id; this.name = name; this.parent = parent; this.trashed = false; }
    MockFolder.prototype.getId = function () { return this.id; };
    MockFolder.prototype.getName = function () { return this.name; };
    MockFolder.prototype.isTrashed = function () { return this.trashed; };
    MockFolder.prototype.createFolder = function (name) { var f = new MockFolder('folder' + (++DRIVE.n), name, this.id); DRIVE.folders[f.id] = f; return f; };
    MockFolder.prototype.createFile = function (blob) { var id = 'file' + (++DRIVE.n); DRIVE.files[id] = { id: id, folder: this.id, name: blob.name, mime: blob.mime, bytes: blob.bytes, trashed: false }; return { getId: function () { return id; } }; };
    var DriveApp = {
      createFolder: function (name) { var f = new MockFolder('folder' + (++DRIVE.n), name, 'root'); DRIVE.folders[f.id] = f; return f; },
      getFolderById: function (id) { if (!DRIVE.folders[id]) throw new Error('Folder tidak ada'); return DRIVE.folders[id]; },
      getFileById: function (id) { var f = DRIVE.files[id]; if (!f) throw new Error('Berkas tidak ada'); return { getBlob: function () { return { getBytes: function () { return f.bytes; } }; }, setTrashed: function (v) { f.trashed = v; } }; }
    };
    Utilities.base64Decode = __dec; Utilities.base64Encode = __enc;
    Utilities.newBlob = function (bytes, mime, name) { return { bytes: bytes, mime: mime, name: name }; };
  `, h.context);
  const setup = h.request('setupOwner', { nama: 'Fixture Owner', pin: '1234' });
  assert.equal(setup.ok, true, setup.error);
  const owner = setup.data.token, admin = 'fixture-retur-admin-token';
  const workers = ['potong', 'jahit', 'qc'].map(role => ({ role, token: 'fixture-retur-' + role }));
  h.run(`pkStore_().lock(function(){ pkStore_().append('Pegawai',{id:'returadmin01',nama:'Fixture Admin',divisi:'admin',aktif:true,token:'${admin}'}); });`);
  workers.forEach(({role, token}) => h.run(`pkStore_().lock(function(){ pkStore_().append('Pegawai',{id:'retur-${role}',nama:'Fixture ${role}',divisi:'${role}',aktif:true,token:'${token}'}); });`));
  function call(action, payload = {}, token = owner) { h.cold(); return h.request(action, { token, workflowVersion: 2, ...payload }); }
  function good(action, payload = {}, token = owner) { const r = call(action, payload, token); assert.equal(r.ok, true, r.error); return r.data; }
  function bad(action, payload, pattern, token = owner) { const r = call(action, payload, token); assert.equal(r.ok, false, 'operation must reject'); if (pattern) assert.match(r.error, pattern); return r; }
  const drive = () => h.run('DRIVE');
  return { h, owner, admin, workers, call, good, bad, drive };
}
function kasus(orderId, extra = {}) {
  return { orderId, returnId: 'R-' + orderId, trackingReturn: 'RET-' + orderId, productSummary: 'Kaos BDU contoh', items: [{ name: 'Kaos BDU contoh', variant: 'Hitam L', sku: 'SKU-1', qty: 1, returnQty: 1 }],
    sourceStatus: 'Sedang dikembalikan', reason: 'Ukuran tidak sesuai', sourceUpdatedAt: '2026-10-20T10:00:00', sourceFields: ['returnId', 'trackingReturn', 'productSummary', 'items', 'sourceStatus', 'reason', 'sourceUpdatedAt', 'sourceFile'], ...extra };
}
const impor = (f, key, cases, filename = 'ekspor.csv') => f.good('importRetur', { filename, platform: 'tiktok', shop: 'Toko Contoh', importKey: key, cases });

test('an import is idempotent and a newer file updates source data only', () => {
  const f = fixture();
  assert.deepEqual(impor(f, 'kunci-1', [kasus('A1'), kasus('A2')]), { added: 2, updated: 0 });
  assert.deepEqual(impor(f, 'kunci-1', [kasus('A1'), kasus('A2')]), { added: 2, updated: 0, replayed: true }, 'the same batch is not saved twice');
  let st = f.good('getReturState');
  assert.equal(st.cases.length, 2); assert.equal(st.imports.length, 1); assert.equal(st.drive, true);
  const a1 = st.cases.find(c => c.orderId === 'A1');
  assert.equal(a1.status, 'perlu_dicek'); assert.equal(a1.revision, 1); assert.equal(a1.trackingReturn, 'RET-A1');
  f.good('saveRetur', { id: a1.id, revision: 1, patch: { note: 'Dicek gudang', claimRef: 'KLAIM-7' } });
  assert.deepEqual(impor(f, 'kunci-2', [kasus('A1', { sourceStatus: 'Refunded', sourceUpdatedAt: '2026-10-22T10:00:00' })], 'baru.csv'), { added: 0, updated: 1 });
  let after = f.good('getReturState').cases.find(c => c.id === a1.id);
  assert.equal(after.sourceStatus, 'Refunded'); assert.equal(after.note, 'Dicek gudang'); assert.equal(after.claimRef, 'KLAIM-7'); assert.equal(after.sourceFile, 'baru.csv');
  impor(f, 'kunci-3', [kasus('A1', { sourceStatus: 'Lama', sourceUpdatedAt: '2026-10-01T10:00:00' })], 'lama.csv');
  assert.equal(f.good('getReturState').cases.find(c => c.id === a1.id).sourceStatus, 'Refunded', 'an older file never overwrites');
  const detail = f.good('getReturDetail', { id: a1.id });
  assert.deepEqual(detail.events.map(e => e.type).sort(), ['Catatan diperbarui', 'Diimpor', 'Impor diperbarui'].sort(), 'the skipped older file leaves no history entry');
  f.bad('importRetur', { filename: 'x.csv', platform: 'tiktok', shop: 'Toko Contoh', importKey: 'k9', cases: [kasus('B1'), kasus('B1')] }, /ganda/);
  f.bad('deleteRecord', { sheet: 'ReturKasus', id: a1.id }, /tidak dikenal|Tidak bisa dihapus/);
});

test('a received status needs date, receiver, count and evidence stored in Drive; a stale form is refused', () => {
  const f = fixture();
  impor(f, 'k1', [kasus('C1')]);
  const c = f.good('getReturState').cases[0];
  const terima = { status: 'diterima_baik', receivedAt: '2026-10-24', receiver: 'Tim Gudang', receivedQty: 1 };
  f.bad('saveRetur', { id: c.id, revision: 1, patch: terima }, /minimal satu bukti/);
  f.bad('saveRetur', { id: c.id, revision: 1, patch: { ...terima, receiver: '' } }, /tanggal diterima, penerima/);
  f.bad('saveRetur', { id: c.id, revision: 1, patch: { orderId: 'lain' } }, /tidak dapat diubah/);
  f.bad('unggahReturBukti', { caseId: c.id, requestId: 'rb-test-001', name: 'x.txt', category: 'label', base64: Buffer.from('teks biasa').toString('base64') }, /JPG, PNG, WebP, MP4, atau PDF/);
  const up = f.good('unggahReturBukti', { caseId: c.id, requestId: 'rb-test-002', name: 'label.jpg', category: 'label', base64: JPG });
  assert.equal(up.bukti.type, 'image/jpeg'); assert.equal(up.bukti.size, 16); assert.match(up.bukti.url, /^https:\/\/drive\.google\.com\/file\/d\//);
  assert.equal(f.good('unggahReturBukti', { caseId: c.id, requestId: 'rb-test-002', name: 'label.jpg', category: 'label', base64: JPG }).replayed, true, 'a retried upload does not store a second file');
  const d = f.drive();
  assert.equal(Object.keys(d.files).length, 1);
  const file = Object.values(d.files)[0], folder = d.folders[file.folder];
  assert.match(folder.name, /^C1 · TikTok Shop · Toko Contoh$/); assert.equal(d.folders[folder.parent].name, 'Soldier Retur - Bukti');
  assert.equal(f.good('getReturBukti', { id: up.bukti.id }).base64, JPG, 'the stored bytes come back unchanged');
  const detail = f.good('getReturDetail', { id: c.id });
  assert.equal(detail.evidence.length, 1); assert.match(detail.folderUrl, /drive\/folders\//);
  assert.equal(detail.case.revision, 1, 'storing evidence does not invalidate an open form');
  const saved = f.good('saveRetur', { id: c.id, revision: 1, patch: terima });
  assert.equal(saved.case.status, 'diterima_baik'); assert.equal(saved.case.revision, 2);
  f.bad('saveRetur', { id: c.id, revision: 1, patch: { note: 'telat' } }, /sudah berubah/);
  f.good('unggahReturBukti', { caseId: c.id, requestId: 'rb-test-003', name: 'isi.jpg', category: 'contents', base64: JPG });
  assert.equal(Object.values(f.drive().files).filter(x => x.folder === folder.id).length, 2, 'the next evidence goes to the same package folder');
});

test('an unlabelled parcel is recorded once, needs evidence before matching, and moves its evidence and history to the order', () => {
  const f = fixture();
  impor(f, 'k1', [kasus('D1')]);
  const target = f.good('getReturState').cases[0];
  const isian = { requestId: 'rt-test-001', shop: 'Toko Contoh', productSummary: 'Kaos hitam tanpa label', receivedAt: '2026-10-24', receiver: 'Tim Gudang', receivedQty: 1, note: 'Label sobek', courier: 'J&T' };
  const a = f.good('catatReturTanpaResi', isian).case;
  assert.equal(f.good('catatReturTanpaResi', isian).case.id, a.id, 'a retried form does not create a second parcel');
  assert.equal(a.unidentified, true); assert.equal(a.orderId, '');
  f.bad('saveRetur', { id: a.id, revision: a.revision, patch: { status: 'diterima_baik' } }, /Cocokkan paket tanpa resi/);
  f.bad('cocokkanRetur', { id: a.id, revision: a.revision, targetId: target.id, targetRevision: target.revision }, /Unggah bukti/);
  f.good('unggahReturBukti', { caseId: a.id, requestId: 'rb-test-010', name: 'paket.jpg', category: 'packaging', base64: JPG });
  f.bad('cocokkanRetur', { id: a.id, revision: a.revision + 1, targetId: target.id, targetRevision: target.revision }, /Data berubah/);
  const matched = f.good('cocokkanRetur', { id: a.id, revision: a.revision, targetId: target.id, targetRevision: target.revision }).case;
  assert.equal(matched.id, target.id); assert.equal(matched.receivedAt, '2026-10-24'); assert.equal(matched.receiver, 'Tim Gudang'); assert.equal(matched.status, 'perlu_dicek');
  assert.match(matched.note, /Paket tanpa resi dicocokkan oleh Fixture Owner/);
  const td = f.good('getReturDetail', { id: target.id });
  assert.equal(td.evidence.length, 1); assert.ok(td.events.some(e => e.type === 'Paket tanpa resi diterima'), 'history moves with the parcel');
  const from = f.good('getReturDetail', { id: a.id }).case;
  assert.equal(from.archived, true); assert.equal(from.matchedTo, target.id);
  f.bad('unggahReturBukti', { caseId: a.id, requestId: 'rb-test-011', name: 'x.jpg', category: 'other', base64: JPG }, /sudah dicocokkan/);
  f.bad('cocokkanRetur', { id: a.id, revision: from.revision, targetId: target.id, targetRevision: matched.revision }, /belum dicocokkan/);
  const lost = f.good('saveRetur', { id: target.id, revision: matched.revision, patch: { status: 'hilang' } }).case;
  assert.equal(lost.status, 'hilang', 'the merged note is the factual basis for a lost parcel');
});

test('the new tables join the owner backup, and production state stays untouched by return data', () => {
  const f = fixture();
  impor(f, 'k1', [kasus('E1')]);
  const backup = f.good('getCadangan', {});
  for (const t of ['ReturKasus', 'ReturImpor', 'ReturEvent', 'ReturBukti']) assert.ok(backup.tabel.includes(t), t);
  const state = f.good('getState');
  assert.ok(!('retur' in state) && !JSON.stringify(state).includes('E1'), 'returns are loaded only by the owner page');
});

test('production workers cannot read or change returns through any action', () => {
  const f = fixture();
  for (const worker of f.workers) for (const action of ['getReturState', 'getReturDetail', 'getReturBukti', 'importRetur', 'saveRetur', 'catatReturTanpaResi', 'cocokkanRetur', 'unggahReturBukti']) {
    f.bad(action, {}, /hanya untuk owner\/admin/, worker.token);
  }
});

test('admin can import, receive with evidence, match an unlabelled parcel and read its report history', () => {
  const f = fixture(), good = (action, payload) => f.good(action, payload, f.admin);
  good('importRetur', { filename: 'contoh.csv', platform: 'tiktok', shop: 'Toko Contoh', importKey: 'admin-1', cases: [kasus('ADM1'), kasus('ADM2')] });
  const st = good('getReturState'), first = st.cases.find(c => c.orderId === 'ADM1'), second = st.cases.find(c => c.orderId === 'ADM2');
  const received = { status: 'diterima_baik', receivedAt: '2026-10-30', receiver: 'Admin penerima', receivedQty: 1 };
  f.bad('saveRetur', { id: first.id, revision: first.revision, patch: received }, /minimal satu bukti/, f.admin);
  const proof = good('unggahReturBukti', { caseId: first.id, requestId: 'admin-proof-1', name: 'foto.jpg', category: 'label', base64: JPG });
  assert.equal(good('getReturBukti', { id: proof.bukti.id }).base64, JPG);
  good('saveRetur', { id: first.id, revision: first.revision, patch: received });
  const detail = good('getReturDetail', { id: first.id });
  assert.equal(detail.case.status, 'diterima_baik');
  assert.ok(detail.events.every(e => e.actor === 'Fixture Admin'), 'admin activity keeps its own actor');
  const unknown = good('catatReturTanpaResi', { requestId: 'admin-unknown-1', shop: 'Toko Contoh', productSummary: 'Kaos BDU', receivedAt: '2026-10-30', receiver: 'Admin penerima', receivedQty: 1 });
  good('unggahReturBukti', { caseId: unknown.case.id, requestId: 'admin-proof-2', name: 'isi.jpg', category: 'contents', base64: JPG });
  good('cocokkanRetur', { id: unknown.case.id, revision: unknown.case.revision, targetId: second.id, targetRevision: second.revision });
  assert.equal(good('getReturDetail', { id: second.id }).evidence.length, 1);
  f.bad('deleteRecord', { sheet: 'ReturKasus', id: first.id }, /tidak dikenal|Tidak bisa dihapus/, f.admin);
});
