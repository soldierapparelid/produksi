'use strict';
/* 1.5.60 Retur paket: aturan impor dan isian, dipindahkan dari pengujian aplikasi "Soldier Retur" (importer.test.ts, domain.test.ts).
   Data sintetis saja. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src/retur.js'), 'utf8'), ctx);
const J = value => JSON.parse(JSON.stringify(value));
const parseCSV = text => J(ctx.coreReturParseCSV(text));
const inspect = (rows, options) => J(ctx.coreReturPeriksa(rows, options));
const initialCase = raw => J(ctx.coreReturKasusBaru(raw));
const patchOf = rec => J(ctx.coreReturPatchSumber(rec));
const patch = raw => J(ctx.coreReturPatch(raw));
const validDate = value => ctx.coreReturTanggalSah(value);
const validate = (rec, n) => ctx.coreReturCekTerima(rec, n);
const options = { platform: 'tiktok', shop: 'Toko Contoh', sourceFile: 'contoh.csv' };

test('CSV parses BOM, delimiters, quoted newlines and escaped quotes without rounding IDs', () => {
  const rows = parseCSV('﻿Order ID;Product Name;Order Status\r\n"123456789012345678\t";"Baju; motif ""A""\nBaris kedua";Dikirim\r\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], '123456789012345678\t');
  assert.equal(rows[1][1], 'Baju; motif "A"\nBaris kedua');
  const result = inspect(rows, options);
  assert.equal(result.cases[0].orderId, '123456789012345678');
  assert.equal(result.cases[0].candidate, false);
  assert.equal(parseCSV('Order ID\tProduct Name\n123\tTopi')[1][1], 'Topi');
});

test('TikTok order export groups SKU lines, uses line-allocated refunds and keeps ordinary transit out', () => {
  const headers = ['Order ID', 'Package ID', 'SKU ID', 'Product Name', 'Quantity', 'Sku Quantity of return', 'Order Status', 'Order Substatus', 'Cancelation/Return Type', 'Cancel Reason', 'Order Amount', 'Order Refund Amount', 'SKU Subtotal After Discount', 'Created Time', 'Shipped Time'];
  const result = inspect([headers,
    ['123456789012345678\t', '9876543210123456789\t', '1111111111111111111\t', 'Produk A', '1', '1', 'Dibatalkan', 'Dibatalkan', 'Cancel', 'Pengiriman paket gagal', '175262', '59847', '59847', '12/10/2026 05:31:28\t', '13/10/2026 18:30:00\t'],
    ['123456789012345678\t', '9876543210123456789\t', '2222222222222222222\t', 'Produk B', '1', '1', 'Dibatalkan', 'Dibatalkan', 'Cancel', 'Pengiriman paket gagal', '175262', '112680', '112680', '12/10/2026 05:31:28\t', '13/10/2026 18:30:00\t'],
    ['123456789012345679\t', '9876543210123456790\t', '1111111111111111111\t', 'Produk A', '1', '0', 'Dikirim', 'Sedang transit', '', '', '100000', '', '100000', '16/10/2026 12:25:02\t', '16/10/2026 20:11:35\t']], options);
  assert.equal(result.cases.length, 2);
  const record = result.cases[0];
  assert.equal(record.items.length, 2);
  assert.equal(record.orderAmount, 175262);
  assert.equal(record.refundAmount, 172527);
  assert.equal(record.orderDate, '2026-10-12T05:31:28');
  assert.equal(record.items[0].sku, '1111111111111111111');
  assert.equal(record.candidate, true);
  assert.equal(record.status, 'perlu_dicek');
  assert.equal(record.receivedAt, '');
  assert.equal(record.receivedQty, 0);
  assert.equal(result.cases[1].candidate, false);
  assert.match(record.warning, /Pengiriman gagal/);
});

test('cancellation alone is not a return; positive return quantity only creates a candidate', () => {
  const result = inspect([['Order ID', 'Order Status', 'Cancelation/Return Type', 'Sku Quantity of return', 'Quantity'], ['A', 'Dibatalkan', 'Cancel', '0', '1'], ['B', 'Dibatalkan', 'Cancel', '1', '1']], options);
  assert.equal(result.cases[0].candidate, false);
  assert.equal(result.cases[1].candidate, true);
  assert.equal(result.cases[1].status, 'perlu_dicek');
});

test('marketplace delivery or refund never records physical receipt or closure', () => {
  const result = inspect([['Order ID', 'Return ID', 'Order Status', 'Return Status', 'Quantity'], ['A', 'R1', 'Delivered', 'Return received', '1'], ['B', 'R2', 'Refunded', 'Refund completed', '1'], ['C', '', 'Selesai', 'Selesai', '1']], options);
  for (const record of result.cases) {
    assert.equal(record.candidate, true); assert.equal(record.status, 'perlu_dicek');
    assert.equal(record.receivedAt, ''); assert.equal(record.receiver, ''); assert.equal(record.receivedQty, 0); assert.equal(record.claimDeadline, '');
  }
});

test('actual return transit and refund-only states stay distinct', () => {
  const result = inspect([['Order ID', 'Return Status', 'Quantity'], ['A', 'Sedang dikembalikan', '1'], ['B', 'Pengembalian dana saja', '1'], ['C', 'No return', '1']], options);
  assert.equal(result.cases[0].status, 'perjalanan');
  assert.equal(result.cases[1].status, 'tanpa_retur');
  assert.equal(result.cases[2].candidate, false);
});

test('unsafe numeric and scientific-notation identifiers stop import with an actionable error', () => {
  assert.throws(() => ctx.coreReturPeriksa([['Order ID'], [123456789012345678]], options), /angka yang tidak aman/);
  assert.throws(() => ctx.coreReturPeriksa([['Order ID'], ['1.23456789012345E+17']], options), /notasi ilmiah/);
  assert.equal(inspect([['Order ID'], ['123456789012345678']], options).cases[0].orderId, '123456789012345678');
  assert.equal(inspect([['Order ID'], [123456789]], options).cases[0].orderId, '123456789', 'a safe number from Excel stays exact');
});

test('header detection skips report preamble and matches Indonesian Shopee aliases', () => {
  const result = inspect([['Laporan pengembalian'], ['Periode', 'Oktober 2026'], [],
    ['No. Pesanan', 'No. Pengembalian', 'No. Resi Pengembalian', 'Nama Produk', 'Jumlah', 'Status Pengembalian', 'Alasan Pengembalian'],
    ['SH-1', 'RR-1', 'RET-1', 'Sepatu', '2', 'Sedang dikembalikan', 'Ukuran tidak sesuai']], { ...options, platform: 'shopee' });
  assert.equal(result.headers[0], 'No. Pesanan');
  assert.equal(result.mapping.trackingReturn, 'No. Resi Pengembalian');
  assert.equal(result.cases[0].trackingOutbound, '');
  assert.equal(result.cases[0].trackingReturn, 'RET-1');
  assert.equal(result.cases[0].status, 'perjalanan');
  assert.equal(result.cases[0].items[0].qty, 2);
});

test('manual mapping supports unfamiliar headers and an explicitly disabled field', () => {
  const result = inspect([['ID transaksi', 'Kode balik', 'Nama item', 'Order Status'], ['X-1', 'RT-1', 'Tas', 'Delivered']], { ...options, mapping: { orderId: 'ID transaksi', trackingReturn: 'Kode balik', product: 'Nama item', status: '' } });
  assert.equal(result.cases[0].orderId, 'X-1');
  assert.equal(result.cases[0].trackingReturn, 'RT-1');
  assert.equal(result.cases[0].sourceStatus, '');
  assert.equal(result.cases[0].productSummary, 'Tas');
});

test('case identity separates return requests and packages and remains deterministic on reordered rows', () => {
  const rows = [['Order ID', 'Return ID', 'Package ID', 'Product Name'], ['A', 'R1', 'P1', 'A'], ['A', 'R2', 'P1', 'B'], ['B', '', 'P1', 'C'], ['B', '', 'P2', 'D']];
  const first = inspect(rows, options), second = inspect([rows[0], ...rows.slice(1).reverse()], options);
  assert.equal(first.cases.length, 4);
  assert.deepEqual(first.cases.map(r => r.key).sort(), second.cases.map(r => r.key).sort());
});

test('exact operational item duplicates are skipped and repeated order refunds are not summed', () => {
  const header = ['Order ID', 'Product Name', 'SKU', 'Quantity', 'Order Amount', 'Refund Amount', 'Return ID'];
  const a = ['A', 'Baju', 'S1', '1', '100000', '100000', 'R1'], b = ['A', 'Topi', 'S2', '1', '100000', '100000', 'R1'];
  const result = inspect([header, a, a, b], options);
  assert.equal(result.skippedRows, 1);
  assert.equal(result.cases[0].items.length, 2);
  assert.equal(result.cases[0].orderAmount, 100000);
  assert.equal(result.cases[0].refundAmount, 100000);
});

test('locale amounts and invalid dates are handled explicitly', () => {
  const result = inspect([['Order ID', 'Order Amount', 'Refund Amount', 'Created Time', 'Quantity'], ['A', 'Rp 1.234.567,50', '1,234,567.50', '31/02/2026 12:00:00', '1']], options);
  assert.equal(result.cases[0].orderAmount, 1234567.5);
  assert.equal(result.cases[0].refundAmount, 1234567.5);
  assert.equal(result.cases[0].orderDate, '');
  assert.match(result.cases[0].warning, /tanggal yang tidak dikenali/);
});

test('an Excel date serial becomes a date', () => {
  assert.equal(inspect([['Order ID', 'Created Time'], ['A', 46307.5]], options).cases[0].orderDate, '2026-10-12T12:00:00');
});

test('canonical report identifiers can be reimported with Excel-protective apostrophes', () => {
  const result = inspect([['orderId', 'returnId', 'trackingOutbound', 'trackingReturn', 'sourceStatus', 'status', 'qty'], ["'123456789012345678", "'RR-1", "'OUT-1", "'RET-1", 'Return requested', 'diterima_baik', '1']], options);
  assert.equal(result.cases[0].orderId, '123456789012345678');
  assert.equal(result.cases[0].returnId, 'RR-1');
  assert.equal(result.cases[0].trackingReturn, 'RET-1');
  assert.equal(result.cases[0].sourceStatus, 'Return requested');
  assert.equal(result.cases[0].status, 'perlu_dicek');
});

test('customer name, phone and address are excluded from inspected cases', () => {
  const s = JSON.stringify(inspect([['Order ID', 'Product Name', 'Recipient', 'Phone #', 'Detail Address'], ['A', 'Produk contoh', 'NAMA-PRIVAT-UNIK', '081234567890', 'ALAMAT-PRIVAT-UNIK']], options).cases);
  assert.ok(!s.includes('NAMA-PRIVAT-UNIK')); assert.ok(!s.includes('081234567890')); assert.ok(!s.includes('ALAMAT-PRIVAT-UNIK'));
});

test('malformed quotes fail instead of silently shifting columns', () => {
  assert.throws(() => ctx.coreReturParseCSV('Order ID,Product Name\n"123,unfinished'), /tanda kutip/);
  assert.throws(() => ctx.coreReturParseCSV('Order ID,Product Name\n123,"unfinished'), /tanda kutip/);
});

test('source presence distinguishes missing, blank and invalid money from explicit zero', () => {
  const absent = inspect([['Order ID', 'Order Status'], ['A', 'Dibatalkan']], options).cases[0];
  assert.equal(absent.orderAmount, 0); assert.equal(absent.refundAmount, 0);
  for (const f of ['orderAmount', 'refundAmount', 'items', 'productSummary']) assert.ok(!absent.sourceFields.includes(f), f);
  const result = inspect([['Order ID', 'Order Amount', 'Refund Amount'], ['B', '', 'not a number'], ['C', '0', '0']], options);
  assert.ok(!result.cases[0].sourceFields.includes('orderAmount')); assert.ok(!result.cases[0].sourceFields.includes('refundAmount'));
  assert.ok(result.cases[1].sourceFields.includes('orderAmount')); assert.ok(result.cases[1].sourceFields.includes('refundAmount'));
});

/* ---------- aturan isian (domain.test.ts) ---------- */
function source() {
  return { platform: 'tiktok', shop: 'Toko Contoh', orderId: '123456789012345678', items: [{ name: 'Produk contoh', variant: 'Biru', sku: 'SKU-1', qty: 2, returnQty: 2 }], orderAmount: 250000, refundAmount: 210000, sourceStatus: 'Dibatalkan', sourceFile: 'contoh.csv' };
}
function received(overrides = {}) {
  return { ...initialCase(source()), id: 'case-1', revision: 7, status: 'diterima_baik', receivedAt: '2026-10-24', receiver: 'Tim Gudang', receivedQty: 2, note: 'Kemasan dan isi sudah diperiksa.',
    courierStatus: 'Paket sudah dibongkar di gudang.', claimRef: 'TIKET-1', claimDeadline: '2026-10-30', claimStatus: 'Menunggu tanggapan', archived: true, createdAt: '2026-10-20T10:00:00Z', updatedAt: '2026-10-24T10:00:00Z', ...overrides };
}

test('initial import normalizes text, preserves long identifiers, and strips private or operational fields', () => {
  const result = initialCase({ ...source(), shop: '  Toko Contoh  ', orderId: '123456789012345678\t',
    items: [{ name: '  Produk contoh ', variant: ' Biru ', sku: ' SKU-1\t', qty: 2, returnQty: 2, phone: 'PRIVATE-PHONE' }],
    status: 'diterima_baik', receivedAt: '2026-10-24', receiver: 'Injected', receivedQty: 99, note: 'Injected', archived: true, id: 'Injected', key: 'Injected', revision: 900,
    claimRef: 'Injected', claimStatus: 'Injected', buyerName: 'PRIVATE-NAME', address: 'PRIVATE-ADDRESS' });
  assert.equal(result.orderId, '123456789012345678'); assert.equal(result.shop, 'Toko Contoh');
  assert.equal(result.items[0].name, 'Produk contoh'); assert.equal(result.items[0].sku, 'SKU-1');
  assert.equal(result.status, 'perlu_dicek'); assert.equal(result.receivedAt, ''); assert.equal(result.receiver, ''); assert.equal(result.receivedQty, 0);
  assert.equal(result.claimRef, ''); assert.equal(result.archived, false); assert.equal(result.id, undefined); assert.equal(result.revision, undefined);
  assert.ok(!JSON.stringify(result).includes('PRIVATE-'));
  assert.equal(result.key, initialCase(source()).key);
});

test('source and edit rules reject invalid quantities, money, identity edits, and unknown statuses', () => {
  assert.throws(() => ctx.coreReturKasusBaru({ ...source(), orderId: 123456789012345678 }));
  assert.throws(() => ctx.coreReturKasusBaru({ ...source(), shop: '   ' }));
  assert.throws(() => ctx.coreReturKasusBaru({ ...source(), refundAmount: -1 }));
  assert.throws(() => ctx.coreReturKasusBaru({ ...source(), items: [{ ...source().items[0], qty: 1.5 }] }));
  for (const value of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => ctx.coreReturPatch({ receivedQty: value }));
  assert.throws(() => ctx.coreReturPatch({ orderId: 'another-order' }));
  assert.throws(() => ctx.coreReturPatch({ sourceFields: ['orderAmount'] }));
  assert.throws(() => ctx.coreReturPatch({ status: 'unknown' }));
  assert.deepEqual(patch({ receiver: '  Tim A  ', receivedQty: 0 }), { receiver: 'Tim A', receivedQty: 0 });
});

test('reimport updates marketplace data while preserving physical receipt, claims, notes and identity', () => {
  const stored = received();
  const p = patchOf(initialCase({ ...source(), sourceStatus: 'Refunded', refundAmount: 220000, sourceFile: 'pembaruan.csv', status: 'perjalanan', receivedAt: '', receiver: '', receivedQty: 0, note: '', archived: false }));
  const updated = { ...stored, ...p };
  assert.equal(updated.sourceStatus, 'Refunded'); assert.equal(updated.refundAmount, 220000); assert.equal(updated.sourceFile, 'pembaruan.csv');
  for (const key of ['status', 'receivedAt', 'receiver', 'receivedQty', 'note', 'courierStatus', 'claimRef', 'claimDeadline', 'claimStatus', 'archived', 'id', 'key', 'revision', 'createdAt', 'updatedAt', 'platform', 'shop', 'orderId']) {
    assert.equal(updated[key], stored[key], key); assert.ok(!(key in p), key);
  }
});

test('narrower reimport preserves money, item details and nonblank source data', () => {
  const stored = received({ reason: 'Ukuran tidak sesuai', trackingReturn: 'RET-1' });
  const imported = inspect([['Order ID', 'Order Status'], [stored.orderId, 'Refunded']], { platform: 'tiktok', shop: stored.shop, sourceFile: 'status-saja.csv' }).cases[0];
  const p = patchOf(initialCase(imported)), updated = { ...stored, ...p };
  assert.equal(updated.orderAmount, stored.orderAmount); assert.equal(updated.refundAmount, stored.refundAmount); assert.deepEqual(updated.items, stored.items);
  assert.equal(updated.productSummary, stored.productSummary); assert.equal(updated.reason, stored.reason); assert.equal(updated.trackingReturn, stored.trackingReturn);
  assert.equal(updated.sourceStatus, 'Refunded');
  for (const k of ['orderAmount', 'refundAmount', 'items']) assert.ok(!(k in p), k);
});

test('explicit zero money remains a valid update while absent money cannot erase prior values', () => {
  const imported = inspect([['Order ID', 'Order Amount', 'Refund Amount'], [source().orderId, '0', '0']], { platform: 'tiktok', shop: source().shop, sourceFile: 'nol.csv' }).cases[0];
  const p = patchOf(initialCase(imported));
  assert.equal(p.orderAmount, 0); assert.equal(p.refundAmount, 0);
  const sparse = initialCase({ platform: 'tiktok', shop: source().shop, orderId: source().orderId, items: [], sourceFields: ['orderAmount', 'refundAmount', 'items'] });
  assert.equal(sparse.orderAmount, 0); assert.equal(sparse.refundAmount, 0); assert.deepEqual(patchOf(sparse), {});
  assert.ok(!('orderAmount' in patchOf(initialCase({ platform: 'tiktok', shop: source().shop, orderId: source().orderId, items: [] }))));
});

for (const status of ['diterima_baik', 'diterima_rusak', 'diterima_kurang']) {
  test(`${status} requires a valid receipt date, receiver, integer count and evidence`, () => {
    const valid = received({ status });
    assert.doesNotThrow(() => validate(valid, 1));
    for (const partial of [{ receivedAt: '' }, { receivedAt: '2026-02-31' }, { receivedAt: 'not-a-date' }, { receiver: ' \t ' }, { receivedQty: 0 }, { receivedQty: -1 }, { receivedQty: 1.5 }, { receivedQty: Number.POSITIVE_INFINITY }])
      assert.throws(() => validate({ ...valid, ...partial }, 1), /tanggal diterima, penerima, dan jumlah/);
    for (const n of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => validate(valid, n), /minimal satu bukti/);
  });
}

test('unidentified parcels must be matched before assigning a received condition', () => {
  assert.throws(() => validate(received({ unidentified: true }), 5), /Cocokkan paket tanpa resi/);
  assert.doesNotThrow(() => validate(received({ unidentified: false }), 1));
  assert.doesNotThrow(() => validate({ ...initialCase(source()), unidentified: true }, 0));
});

test('confirmed lost parcels require a factual note or claim reference', () => {
  const lost = received({ status: 'hilang', note: ' \t ', claimRef: '  ', receivedAt: '', receiver: '', receivedQty: 0 });
  assert.throws(() => validate(lost, 0), /dasar konfirmasi paket hilang atau nomor laporan/);
  assert.doesNotThrow(() => validate({ ...lost, note: 'Kurir mengonfirmasi kehilangan pada tiket pemeriksaan.' }, 0));
  assert.doesNotThrow(() => validate({ ...lost, claimRef: 'KLAIM-100' }, 0));
  assert.doesNotThrow(() => validate({ ...lost, status: 'diduga_hilang' }, 0));
});

test('strict date validation accepts real leap days and ISO times while rejecting overflow dates', () => {
  for (const value of ['2024-02-29', '2026-10-24', '2026-10-24T23:59', '2026-10-24T23:59:59.999Z', '2026-10-24T23:59:00+07:00']) assert.equal(validDate(value), true, value);
  for (const value of ['', '2026-02-29', '2026-02-31', '2026-04-31', '2026-13-01', '2026-00-01', '2026-10-00', '2026-10-24junk', '2026-10-24T24:00', '2026-10-24T23:60', '2026-10-24T12:00+24:00', '0000-01-01']) assert.equal(validDate(value), false, value);
  assert.throws(() => validate(received({ claimDeadline: '2026-02-31' }), 1), /batas pengaduan/);
  assert.doesNotThrow(() => validate(received({ claimDeadline: '' }), 1));
});

test('evidence type is read from the file content, not from its name', () => {
  const b64 = bytes => Buffer.from(bytes).toString('base64');
  assert.equal(ctx.coreReturJenisBerkas(b64([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])), 'image/jpeg');
  assert.equal(ctx.coreReturJenisBerkas(b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(ctx.coreReturJenisBerkas(b64([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')])), 'image/webp');
  assert.equal(ctx.coreReturJenisBerkas(b64(Buffer.from('%PDF-1.7 test'))), 'application/pdf');
  assert.equal(ctx.coreReturJenisBerkas(b64([0, 0, 0, 0x18, ...Buffer.from('ftypmp42')])), 'video/mp4');
  assert.equal(ctx.coreReturJenisBerkas(b64(Buffer.from('<html>bukan bukti</html>'))), '');
  assert.equal(ctx.coreReturUkuranBase64(b64(Buffer.alloc(1000, 7))), 1000);
});
