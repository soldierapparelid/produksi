/* ============================================================
   Retur paket (1.5.60) — catatan paket retur marketplace
   Dipindahkan dari aplikasi "Soldier Retur" (paket 24 Okt 2026) ke aplikasi ini: impor ekspor TikTok Shop (CSV)
   dan Shopee (XLSX), status operasional, penerimaan fisik dengan bukti, paket tanpa resi, tindak lanjut klaim,
   dan kronologi. Hanya owner. Data di tab ReturKasus / ReturImpor / ReturEvent / ReturBukti; berkas bukti di
   Google Drive pemilik lewat env.simpanBukti, bukan di Sheet. Nama pembeli, telepon, dan alamat dari file ekspor
   tidak pernah disimpan: hanya kolom operasional yang dipetakan.
   ============================================================ */
var RETUR_STATUS = { perlu_dicek: 'Perlu dicek', perjalanan: 'Dalam perjalanan', diterima_baik: 'Diterima baik', diterima_rusak: 'Diterima rusak', diterima_kurang: 'Diterima kurang',
  diduga_hilang: 'Diduga hilang', hilang: 'Hilang', tanpa_retur: 'Tanpa retur fisik', selesai: 'Selesai' };
var RETUR_DITERIMA = ['diterima_baik', 'diterima_rusak', 'diterima_kurang'];
var RETUR_MASALAH = ['diduga_hilang', 'hilang', 'diterima_rusak', 'diterima_kurang'];
var RETUR_KATEGORI = { label: 'Label / resi', packaging: 'Kemasan paket', contents: 'Isi paket', damage: 'Kerusakan', tracking: 'Bukti pelacakan', other: 'Lainnya' };
var RETUR_PLATFORM = { tiktok: 'TikTok Shop', shopee: 'Shopee', lainnya: 'Lainnya' };
var RETUR_BUKTI_MAKS = 20 * 1024 * 1024;
var RETUR_ALIAS = {
  orderId: ['Order ID', 'Order Number', 'Order No', 'No. Pesanan', 'Nomor Pesanan', 'ID Pesanan', 'No Pesanan Induk'],
  returnId: ['Return ID', 'Return Request ID', 'Return/Refund ID', 'Refund ID', 'ID Pengembalian', 'No. Pengembalian', 'Nomor Pengembalian', 'No. Pengajuan', 'ID Pengajuan Pengembalian', 'Nomor Pengajuan Pengembalian'],
  packageId: ['Package ID', 'ID Paket', 'Nomor Paket', 'No. Paket'],
  trackingOutbound: ['Tracking ID', 'Tracking Number', 'Outbound Tracking Number', 'No. Resi', 'Nomor Resi', 'No Resi Pengiriman', 'Nomor Resi Pengiriman', 'No. Resi Pengiriman'],
  trackingReturn: ['Return Tracking Number', 'Return Tracking ID', 'Return Shipment Tracking Number', 'Nomor Resi Pengembalian', 'No. Resi Pengembalian', 'No Resi Retur', 'Nomor Resi Retur', 'Resi Retur', 'Nomor Pelacakan Pengembalian'],
  courier: ['Shipping Provider Name', 'Shipping Provider', 'Courier', 'Logistics Provider', 'Jasa Kirim', 'Opsi Pengiriman', 'Kurir', 'Jasa Pengiriman', 'Kurir Pengembalian'],
  status: ['Order Status', 'Status Pesanan', 'Status', 'Status Pengembalian', 'Status Pengembalian Dana'],
  substatus: ['Order Substatus', 'Order Sub Status', 'Substatus Pesanan', 'Sub Status'],
  returnStatus: ['Return Status', 'Return/Refund Status', 'Refund Status', 'Status Pengembalian', 'Status Pengembalian Barang', 'Status Pengembalian Dana', 'Status Retur'],
  returnType: ['Cancelation/Return Type', 'Cancellation/Return Type', 'Return Type', 'Request Type', 'Jenis Pengembalian', 'Tipe Pengembalian', 'Jenis Permintaan'],
  reason: ['Return Reason', 'Refund Reason', 'Alasan Pengembalian', 'Alasan Pengembalian Barang', 'Alasan Retur', 'Cancel Reason', 'Alasan Pembatalan', 'Alasan'],
  product: ['Product Name', 'Product', 'Nama Produk', 'Nama Barang', 'Produk', 'productSummary'],
  variant: ['Variation', 'Variation Name', 'Variant', 'Nama Variasi', 'Variasi', 'Varian'],
  sku: ['Seller SKU', 'Seller SKU ID', 'SKU Penjual', 'Nomor Referensi SKU', 'SKU', 'SKU Induk', 'SKU Produk'],
  skuId: ['SKU ID', 'Product ID', 'ID SKU', 'ID Produk'],
  qty: ['Quantity', 'Qty', 'Jumlah', 'Jumlah Produk', 'Jumlah Barang', 'Kuantitas'],
  returnQty: ['Sku Quantity of return', 'Return Quantity', 'Return Qty', 'Refund Quantity', 'Jumlah Produk Dikembalikan', 'Jumlah Barang Dikembalikan', 'Jumlah Pengembalian', 'Jumlah Retur', 'Kuantitas Retur'],
  orderAmount: ['Order Amount', 'Order Total', 'Total Amount', 'Total Pembayaran', 'Total Pesanan', 'Total Harga Produk', 'Total Harga', 'Nilai Pesanan'],
  refundAmount: ['Order Refund Amount', 'Refund Amount', 'Return/Refund Amount', 'Jumlah Pengembalian Dana', 'Nominal Pengembalian Dana', 'Total Pengembalian Dana', 'Dana Dikembalikan', 'Nilai Refund', 'Nilai Pengembalian'],
  lineAmount: ['SKU Subtotal After Discount', 'Subtotal After Discount', 'Subtotal Produk', 'Subtotal Setelah Diskon'],
  orderDate: ['Created Time', 'Order Created Time', 'Order Date', 'Waktu Pesanan Dibuat', 'Waktu Pembuatan Pesanan', 'Tanggal Pesanan', 'Tanggal Pemesanan', 'Tanggal Dibuat'],
  shippedAt: ['Shipped Time', 'Shipped At', 'Waktu Pengiriman', 'Tanggal Pengiriman', 'Waktu Pesanan Dikirim', 'Tanggal Dikirim'],
  sourceUpdatedAt: ['Updated Time', 'Updated At', 'Last Updated Time', 'Cancelled Time', 'Waktu Pembaruan', 'Tanggal Pembaruan', 'Waktu Pembatalan', 'Tanggal Pembatalan'],
  returnRequestedAt: ['Return Requested Time', 'Return Request Time', 'Request Time', 'Application Time', 'Waktu Pengajuan', 'Tanggal Pengajuan', 'Tanggal Pengajuan Pengembalian', 'Waktu Pengajuan Pengembalian', 'Tanggal Retur'],
  purchaseChannel: ['Purchase Channel', 'Sales Channel', 'Marketplace', 'Platform']
};

function coreReturTeks(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return isNaN(value.getTime()) ? '' : value.toISOString();
  return String(value).replace(/^﻿/, '').trim();
}
function coreReturNorm(value) {
  return coreReturTeks(value).normalize('NFKC').toLocaleLowerCase('id-ID').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function coreReturBacaCsv(text, delimiter) {
  var rows = [], row = [], value = '', quoted = false, closed = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; } }
      else value += ch;
    } else if (ch === '"' && value === '' && !closed) quoted = true;
    else if (ch === delimiter) { row.push(value); value = ''; closed = false; }
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(value); rows.push(row); row = []; value = ''; closed = false;
    } else {
      if (closed && !/\s/.test(ch)) throw new Error('CSV tidak valid: ada teks setelah tanda kutip penutup. Ekspor ulang file dari marketplace.');
      value += ch;
    }
  }
  if (quoted) throw new Error('CSV tidak valid: tanda kutip belum ditutup. Ekspor ulang file dari marketplace.');
  if (value !== '' || row.length > 0) { row.push(value); rows.push(row); }
  return rows;
}
/* CSV/TSV berkutip; ID tidak pernah diubah menjadi angka. Pemisah dipilih dari 30 baris pertama. */
function coreReturParseCSV(input) {
  var text = String(input || '').replace(/^﻿/, '');
  if (!text.trim()) return [];
  var cands = [',', ';', '\t', '|'], records = [], counts = [0, 0, 0, 0], quoted = false;
  for (var i = 0; i < text.length && records.length < 30; i++) {
    var ch = text[i];
    if (ch === '"') { if (quoted && text[i + 1] === '"') i++; else quoted = !quoted; }
    else if (!quoted && (ch === '\r' || ch === '\n')) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (counts.some(Boolean)) records.push(counts);
      counts = [0, 0, 0, 0];
    } else if (!quoted) { var c = cands.indexOf(ch); if (c >= 0) counts[c]++; }
  }
  if (counts.some(Boolean)) records.push(counts);
  var scores = cands.map(function (_, idx) {
    var freq = {}; records.forEach(function (r) { if (r[idx]) freq[r[idx]] = (freq[r[idx]] || 0) + 1; });
    var best = 0; Object.keys(freq).forEach(function (w) { best = Math.max(best, freq[w] * 100 + Math.min(Number(w), 90)); });
    return best;
  });
  return coreReturBacaCsv(text, cands[scores.indexOf(Math.max.apply(null, scores))]);
}
function coreReturMapping(headers) {
  var map = {}, norm = {};
  (headers || []).forEach(function (h) { var k = coreReturNorm(h); if (!Object.prototype.hasOwnProperty.call(norm, k)) norm[k] = h; });
  Object.keys(RETUR_ALIAS).forEach(function (field) {
    var alias = RETUR_ALIAS[field];
    var canon = field === 'status' ? ['sourceStatus'].concat(alias, [field]) : field === 'substatus' ? ['sourceSubstatus', field].concat(alias) : [field].concat(alias);
    for (var i = 0; i < canon.length; i++) { var k = coreReturNorm(canon[i]); if (Object.prototype.hasOwnProperty.call(norm, k)) { map[field] = norm[k]; break; } }
  });
  return map;
}
function coreReturId(value, label, row) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0))
    throw new Error('Baris ' + row + ': ' + label + ' berupa angka yang tidak aman dan digitnya mungkin berubah. Ekspor ulang sebagai CSV, atau atur kolom ID menjadi teks sebelum membuka Excel.');
  var out = coreReturTeks(value);
  if (/^="[^"]*"$/.test(out)) out = out.slice(2, -1).trim();
  if (out.charAt(0) === "'") out = out.slice(1);
  if (/^[+-]?\d+(?:[.,]\d+)?[eE][+-]?\d+$/.test(out))
    throw new Error('Baris ' + row + ': ' + label + ' memakai notasi ilmiah. Digit ID tidak dapat dipastikan; gunakan ekspor CSV asli dengan ID sebagai teks.');
  return out;
}
function coreReturUang(value) {
  if (typeof value === 'number') return isFinite(value) && value >= 0 ? value : null;
  var t = coreReturTeks(value).replace(/^(?:rp\.?|idr)\s*/i, '').replace(/\s/g, '');
  if (!t || t === '-' || !/^\d[\d.,]*$/.test(t)) return null;
  if (t.indexOf(',') >= 0 && t.indexOf('.') >= 0) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (/^\d{1,3}(?:[.,]\d{3})+$/.test(t)) t = t.replace(/[.,]/g, '');
  else if (t.indexOf(',') >= 0) t = t.replace(',', '.');
  var n = Number(t);
  return isFinite(n) && n >= 0 ? n : null;
}
function coreReturJumlah(value) {
  var raw = coreReturTeks(value);
  if (!/^\d+$/.test(raw)) return null;
  var n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}
function coreReturPad(n) { return (n < 10 ? '0' : '') + n; }
function coreReturTanggal(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? '' : value.toISOString();
  if (typeof value === 'number' && isFinite(value) && value >= 1 && value < 100000)
    return new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000)).toISOString().slice(0, 19);
  var t = coreReturTeks(value);
  if (!t || t === '-') return '';
  var local = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  var iso = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:\d{2})?$/);
  if (!local && !iso) return '';
  var m = local || iso;
  var y = Number(local ? local[3] : iso[1]), mo = Number(local ? local[2] : iso[2]), d = Number(local ? local[1] : iso[3]);
  var h = Number(m[4] || 0), mi = Number(m[5] || 0), s = Number(m[6] || 0);
  var cek = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (cek.getUTCFullYear() !== y || cek.getUTCMonth() !== mo - 1 || cek.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return '';
  return y + '-' + coreReturPad(mo) + '-' + coreReturPad(d) + 'T' + coreReturPad(h) + ':' + coreReturPad(mi) + ':' + coreReturPad(s) + ((iso && iso[7]) || '');
}
function coreReturPlatform(options, mapping, channel) {
  if (options.platform !== 'lainnya') return options.platform;
  if (/tiktok|tokopedia/.test(coreReturNorm(channel)) || mapping.returnQty === 'Sku Quantity of return') return 'tiktok';
  if (/shopee/.test(coreReturNorm(channel)) || mapping.orderId === 'No. Pesanan') return 'shopee';
  return 'lainnya';
}
/* Hanya indikasi dari file. Status sumber tidak pernah dianggap bukti barang sudah diterima. */
function coreReturIndikasi(status, substatus, returnStatus, returnType, reason, returnQty, returnId, trackingReturn) {
  var src = coreReturNorm([status, substatus, returnStatus, returnType].join(' '));
  var gagal = /pengiriman.*gagal|gagal.*(?:kirim|antar)|paket.*ditolak|ditolak.*penerima|delivery failed|failed delivery|undeliverable|return to sender|returned to sender/.test(coreReturNorm(src + ' ' + reason));
  var tanpaBarang = /tanpa pengembalian|tanpa retur|refund only|pengembalian dana saja|tidak perlu.*(?:retur|pengembalian)/.test(src);
  var kataRetur = /\b(?:return|returned|returning|refund|refunded|refunding|retur|dikembalikan|pengembalian)\b/.test(src) || !!coreReturTeks(returnStatus);
  var disangkal = /tidak (?:ada|mengajukan|diajukan).*?(?:retur|pengembalian)|no return|not requested/.test(src);
  var kandidat = !!(returnId || trackingReturn || gagal || returnQty > 0 || (kataRetur && !disangkal));
  var jalan = /return(?:ing)? (?:in transit|shipped)|sedang dikembalikan|pengembalian.*(?:perjalanan|dikirim|transit)|retur.*(?:perjalanan|dikirim|transit)/.test(src);
  if (!kandidat) return { candidate: false, status: 'perlu_dicek', warning: 'Tidak ada bukti pengajuan atau pengiriman balik. Pesanan biasa tidak dipilih otomatis.' };
  if (tanpaBarang) return { candidate: true, status: 'tanpa_retur', warning: 'Sumber menyebut pengembalian dana tanpa barang. Verifikasi penyelesaian dana secara terpisah.' };
  if (gagal) return { candidate: true, status: 'perlu_dicek', warning: 'Pengiriman gagal. Verifikasi apakah paket dikirim balik; belum ada bukti penerimaan barang.' };
  if (jalan) return { candidate: true, status: 'perjalanan', warning: 'Sumber menyebut pengiriman balik. Penerimaan dan kondisi barang tetap perlu dicatat sendiri.' };
  return { candidate: true, status: 'perlu_dicek', warning: 'Ada indikasi retur atau refund. Status sumber belum membuktikan barang sudah diterima dan diperiksa.' };
}
function coreReturKey(v) {
  var orderId = coreReturTeks(v.orderId), returnId = coreReturTeks(v.returnId), packageId = coreReturTeks(v.packageId);
  return [v.platform, coreReturNorm(v.shop), orderId, returnId ? 'return:' + returnId : packageId ? 'package:' + packageId : 'order'].map(encodeURIComponent).join('|');
}
function coreReturUnik(list) { var out = []; list.forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); }); return out; }
/* Periksa baris file ekspor: cari baris judul, petakan kolom, kelompokkan per paket, tandai kandidat retur. */
function coreReturPeriksa(input, options) {
  options = options || {};
  var result = { headers: [], mapping: {}, cases: [], warnings: [], skippedRows: 0 };
  if (!input || !input.length) { result.warnings.push('File kosong.'); return result; }
  var headerIndex = -1, best = -1, minta = options.mapping || {};
  for (var i = 0; i < Math.min(20, input.length); i++) {
    var hs = (input[i] || []).map(coreReturTeks), mp = coreReturMapping(hs);
    var adaPesanan = !!(mp.orderId || (minta.orderId && hs.indexOf(minta.orderId) >= 0));
    var skor = (adaPesanan ? 100 : 0) + Object.keys(mp).length;
    if (skor > best && hs.some(Boolean)) { best = skor; headerIndex = i; }
  }
  if (headerIndex < 0) { result.warnings.push('Header tidak ditemukan.'); return result; }
  var headers = result.headers = input[headerIndex].map(function (v, idx) { return coreReturTeks(v) || 'Kolom ' + (idx + 1); });
  var mapping = result.mapping = coreReturMapping(headers);
  Object.keys(minta).forEach(function (k) { if (minta[k] === undefined || minta[k] === null || minta[k] === '') delete mapping[k]; else mapping[k] = minta[k]; });
  Object.keys(mapping).forEach(function (k) {
    if (mapping[k] && headers.indexOf(mapping[k]) < 0) { result.warnings.push('Kolom untuk ' + k + ' tidak ditemukan: ' + mapping[k] + '. Pilih ulang pemetaan kolom.'); delete mapping[k]; }
  });
  if (coreReturUnik(headers.map(coreReturNorm)).length !== headers.length) result.warnings.push('Ada judul kolom berulang. Pemetaan memakai kolom pertama dengan judul tersebut.');
  if (!mapping.orderId) { result.warnings.push('Pilih kolom Nomor Pesanan untuk melanjutkan impor.'); return result; }
  if (!mapping.status && !mapping.returnStatus && !mapping.returnQty && !mapping.returnId) result.warnings.push('Kolom status atau retur belum dikenali. Pilih pemetaan kolom, lalu periksa setiap kandidat.');
  if (headerIndex > 0) result.warnings.push(headerIndex + ' baris keterangan sebelum header dilewati.');
  var kol = {}; Object.keys(mapping).forEach(function (k) { kol[k] = headers.indexOf(mapping[k]); });
  function get(row, field) { var idx = kol[field]; return idx === undefined || idx < 0 ? '' : row[idx]; }
  var groups = {}, urutan = [], duplicates = 0, lebar = 0;
  for (var r = headerIndex + 1; r < input.length; r++) {
    var row = input[r] || [];
    if (!row.some(function (v) { return coreReturTeks(v); })) continue;
    if (row.length > headers.length && row.slice(headers.length).some(function (v) { return coreReturTeks(v); })) { result.skippedRows++; lebar++; continue; }
    if (coreReturNorm(get(row, 'orderId')) === coreReturNorm(mapping.orderId)) { result.skippedRows++; continue; }
    var baris = r + 1;
    var orderId = coreReturId(get(row, 'orderId'), 'Nomor Pesanan', baris);
    if (!orderId) { result.skippedRows++; continue; }
    var returnId = coreReturId(get(row, 'returnId'), 'ID Pengembalian', baris);
    var packageId = coreReturId(get(row, 'packageId'), 'ID Paket', baris);
    var trackingOutbound = coreReturId(get(row, 'trackingOutbound'), 'Resi Kirim', baris);
    var trackingReturn = coreReturId(get(row, 'trackingReturn'), 'Resi Retur', baris);
    var sku = coreReturId(get(row, 'sku'), 'SKU', baris) || coreReturId(get(row, 'skuId'), 'ID SKU', baris);
    var platform = coreReturPlatform(options, mapping, coreReturTeks(get(row, 'purchaseChannel')));
    var shop = coreReturTeks(options.shop);
    var key = coreReturKey({ platform: platform, shop: shop, orderId: orderId, returnId: returnId, packageId: packageId });
    var status = coreReturTeks(get(row, 'status')), substatus = coreReturTeks(get(row, 'substatus')), srcReturn = coreReturTeks(get(row, 'returnStatus')), reason = coreReturTeks(get(row, 'reason'));
    var qty = coreReturJumlah(get(row, 'qty')), returnQty = coreReturJumlah(get(row, 'returnQty'));
    var ind = coreReturIndikasi(status, substatus, srcReturn, coreReturTeks(get(row, 'returnType')), reason, returnQty || 0, returnId, trackingReturn);
    var item = { name: coreReturTeks(get(row, 'product')), variant: coreReturTeks(get(row, 'variant')), sku: sku, qty: qty || 0, returnQty: returnQty || 0 };
    var orderAmount = coreReturUang(get(row, 'orderAmount')), refund = coreReturUang(get(row, 'refundAmount')), lineAmount = coreReturUang(get(row, 'lineAmount'));
    var dates = { orderDate: coreReturTanggal(get(row, 'orderDate')), shippedAt: coreReturTanggal(get(row, 'shippedAt')), sourceUpdatedAt: coreReturTanggal(get(row, 'sourceUpdatedAt')), returnRequestedAt: coreReturTanggal(get(row, 'returnRequestedAt')) };
    var courier = coreReturTeks(get(row, 'courier'));
    var g = groups[key];
    if (!g) {
      g = groups[key] = { record: { key: key, platform: platform, shop: shop, orderId: orderId, returnId: returnId, packageId: packageId, trackingOutbound: trackingOutbound, trackingReturn: trackingReturn,
        courier: courier, productSummary: '', items: [], orderAmount: 0, refundAmount: 0,
        sourceStatus: status || srcReturn, sourceSubstatus: [substatus, srcReturn].filter(function (v, idx, a) { return v && a.indexOf(v) === idx && v !== status; }).join(' · '), reason: reason,
        orderDate: dates.orderDate, shippedAt: dates.shippedAt, sourceUpdatedAt: dates.sourceUpdatedAt, returnRequestedAt: dates.returnRequestedAt,
        sourceFile: coreReturTeks(options.sourceFile), sourceFields: [], status: ind.status,
        receivedAt: '', receiver: '', receivedQty: 0, note: '', claimRef: '', claimDeadline: '', claimStatus: '', archived: false, candidate: ind.candidate, warning: ind.warning },
        warnings: [ind.warning], orderAmounts: [], refunds: [], sidik: {} };
      urutan.push(key);
    }
    var sidik = JSON.stringify([item, orderAmount, refund, lineAmount, status, substatus, srcReturn, reason, dates, trackingOutbound, trackingReturn]);
    if (g.sidik[sidik]) { duplicates++; result.skippedRows++; continue; }
    g.sidik[sidik] = 1;
    g.record.items.push(item);
    var ada = g.record.sourceFields.slice();
    var isian = { platform: platform, shop: shop, orderId: orderId, returnId: returnId, packageId: packageId, trackingOutbound: trackingOutbound, trackingReturn: trackingReturn, courier: courier, reason: reason, sourceFile: coreReturTeks(options.sourceFile),
      orderDate: dates.orderDate, shippedAt: dates.shippedAt, sourceUpdatedAt: dates.sourceUpdatedAt, returnRequestedAt: dates.returnRequestedAt };
    Object.keys(isian).forEach(function (f) { if (isian[f] !== '' && ada.indexOf(f) < 0) ada.push(f); });
    function tambah(f) { if (ada.indexOf(f) < 0) ada.push(f); }
    if (status || srcReturn) tambah('sourceStatus');
    if (substatus || srcReturn) tambah('sourceSubstatus');
    if (item.name) tambah('productSummary');
    if (item.name || item.variant || item.sku || qty !== null || returnQty !== null) tambah('items');
    if (orderAmount !== null) tambah('orderAmount');
    if (refund !== null) tambah('refundAmount');
    g.record.sourceFields = ada;
    g.record.candidate = g.record.candidate || ind.candidate;
    function warn(w) { if (g.warnings.indexOf(w) < 0) g.warnings.push(w); }
    warn(ind.warning);
    if (orderAmount !== null) g.orderAmounts.push(orderAmount);
    if (refund !== null) g.refunds.push({ amount: refund, lineAmount: lineAmount });
    if (qty === null) warn('Jumlah produk kosong atau tidak valid; isi saat verifikasi.');
    if (mapping.returnQty && coreReturTeks(get(row, 'returnQty')) && returnQty === null) warn('Jumlah retur tidak valid; isi saat verifikasi.');
    if (qty !== null && returnQty !== null && returnQty > qty) warn('Jumlah retur melebihi jumlah produk. Periksa sumber.');
    ['orderAmount', 'refundAmount'].forEach(function (f) { if (coreReturTeks(get(row, f)) && coreReturUang(get(row, f)) === null) warn('Nilai ' + (f === 'orderAmount' ? 'pesanan' : 'refund') + ' tidak valid; belum dihitung.'); });
    Object.keys(dates).forEach(function (f) { if (coreReturTeks(get(row, f)) && !dates[f]) warn('Ada tanggal yang tidak dikenali; gunakan format hari/bulan/tahun atau ISO.'); });
    if (g.record.sourceStatus !== (status || srcReturn)) warn('Status berbeda antarbaris dalam kasus yang sama. Periksa status terbaru di marketplace.');
    var beda = { trackingOutbound: trackingOutbound, trackingReturn: trackingReturn, courier: courier, reason: reason };
    Object.keys(beda).forEach(function (f) {
      if (!g.record[f]) g.record[f] = beda[f];
      else if (beda[f] && g.record[f] !== beda[f]) warn('Ada rincian pengiriman atau alasan berbeda dalam kasus yang sama. Periksa sumber.');
    });
    if (dates.sourceUpdatedAt > g.record.sourceUpdatedAt) g.record.sourceUpdatedAt = dates.sourceUpdatedAt;
  }
  urutan.forEach(function (key) {
    var g = groups[key], rec = g.record;
    if (coreReturUnik(g.orderAmounts).length > 1) g.warnings.push('Nilai pesanan berbeda antarbaris. Nilai terbesar ditampilkan sementara; verifikasi sebelum memakai laporan nominal.');
    rec.orderAmount = g.orderAmounts.length ? Math.max.apply(null, g.orderAmounts) : 0;
    if (g.refunds.length) {
      var perItem = !!mapping.lineAmount && g.refunds.every(function (x) { return x.lineAmount !== null && Math.abs(x.amount - x.lineAmount) < 0.005; });
      var beda2 = coreReturUnik(g.refunds.map(function (x) { return x.amount; }));
      if (g.refunds.length === 1 || perItem) rec.refundAmount = g.refunds.reduce(function (s, x) { return s + x.amount; }, 0);
      else if (beda2.length === 1) rec.refundAmount = beda2[0];
      else { rec.refundAmount = Math.max.apply(null, beda2); g.warnings.push('Nominal refund berbeda antarbaris dan pembagian per produk belum terkonfirmasi. Nilai terbesar ditampilkan sementara; verifikasi sebelum memakai laporan nominal.'); }
    }
    rec.productSummary = coreReturUnik(rec.items.map(function (x) { return x.name; }).filter(Boolean)).join(' · ') || 'Produk belum dipetakan';
    rec.warning = g.warnings.join(' ');
    result.cases.push(rec);
  });
  if (duplicates) result.warnings.push(duplicates + ' baris item duplikat dilewati.');
  if (lebar) result.warnings.push(lebar + ' baris memiliki kolom berlebih dan dilewati. Periksa format atau pemisah file.');
  if (result.skippedRows > duplicates + lebar) result.warnings.push((result.skippedRows - duplicates - lebar) + ' baris tanpa ID pesanan atau header berulang dilewati.');
  if (mapping.orderId === 'Order ID' && mapping.returnQty === 'Sku Quantity of return') result.warnings.push('Ini ekspor pesanan TikTok/Tokopedia. Pesanan gagal kirim ditandai perlu dicek; angka refund dan jumlah retur bukan bukti barang telah diterima.');
  return result;
}

/* ---------- aturan isian (pengganti skema zod aplikasi asal) ---------- */
function coreReturStr(value, max, label, wajib) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new Error('Periksa isian: ' + label + ' harus berupa teks.');
  var t = String(value).trim();
  if (t.length > max) throw new Error('Periksa isian: ' + label + ' terlalu panjang (maksimal ' + max + ' karakter).');
  if (wajib && !t) throw new Error('Periksa isian: ' + label + ' wajib diisi.');
  return t;
}
function coreReturAngka(value, label, bulat) {
  if (value === undefined || value === null || value === '') return 0;
  var n = Number(value);
  if (typeof value === 'boolean' || !isFinite(n) || n < 0 || n > 1e12 || (bulat && !Number.isSafeInteger(n))) throw new Error('Periksa isian: ' + label + ' tidak valid.');
  return n;
}
var RETUR_SUMBER_TEKS = { returnId: 300, packageId: 300, trackingOutbound: 300, trackingReturn: 300, courier: 300, productSummary: 4000, sourceStatus: 300, sourceSubstatus: 300, reason: 2000,
  orderDate: 80, shippedAt: 80, sourceUpdatedAt: 80, returnRequestedAt: 80, sourceFile: 250 };
/* Data sumber dari file (setelah pratinjau di perangkat). Status operasional selalu mulai dari "Perlu dicek". */
function coreReturKasusBaru(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Periksa isian: data paket tidak valid.');
  if (!RETUR_PLATFORM[raw.platform]) throw new Error('Periksa isian: platform tidak dikenal.');
  var c = { platform: raw.platform, shop: coreReturStr(raw.shop, 100, 'nama toko', true), orderId: coreReturStr(raw.orderId, 100, 'nomor pesanan', true) };
  Object.keys(RETUR_SUMBER_TEKS).forEach(function (k) { c[k] = coreReturStr(raw[k], RETUR_SUMBER_TEKS[k], k, false); });
  var items = raw.items === undefined ? [] : raw.items;
  if (!(Array.isArray(items)) || items.length > 300) throw new Error('Periksa isian: daftar produk tidak valid.');
  c.items = items.map(function (it) {
    if (!it || typeof it !== 'object') throw new Error('Periksa isian: produk tidak valid.');
    return { name: coreReturStr(it.name, 1000, 'nama produk'), variant: coreReturStr(it.variant, 500, 'varian'), sku: coreReturStr(it.sku, 200, 'SKU'),
      qty: coreReturAngka(it.qty, 'jumlah produk', true), returnQty: coreReturAngka(it.returnQty, 'jumlah retur', true) };
  });
  c.orderAmount = coreReturAngka(raw.orderAmount, 'nilai pesanan');
  c.refundAmount = coreReturAngka(raw.refundAmount, 'nilai refund');
  var semua = Object.keys(c);
  var dikirim = semua.filter(function (k) { return Object.prototype.hasOwnProperty.call(raw, k) && raw[k] !== undefined && raw[k] !== null; });
  if (raw.sourceFields !== undefined) {
    if (!(Array.isArray(raw.sourceFields)) || raw.sourceFields.length > 50) throw new Error('Periksa isian: daftar kolom sumber tidak valid.');
    var asal = raw.sourceFields.map(function (f) { return coreReturStr(f, 100, 'kolom sumber'); });
    dikirim = dikirim.filter(function (k) { return asal.indexOf(k) >= 0; });
  }
  c.sourceFields = dikirim;
  c.key = coreReturKey(c);
  c.status = 'perlu_dicek'; c.receivedAt = ''; c.receiver = ''; c.receivedQty = 0; c.note = ''; c.courierStatus = '';
  c.claimRef = ''; c.claimDeadline = ''; c.claimStatus = ''; c.archived = false;
  return c;
}
/* Impor ulang hanya memperbarui kolom yang memang ada di file; catatan penerimaan dan bukti tidak tersentuh. */
function coreReturPatchSumber(rec) {
  var patch = {};
  (rec.sourceFields || []).forEach(function (k) {
    if (k === 'orderId' || k === 'platform' || k === 'shop' || k === 'sourceFields' || k === 'key') return;
    if (!Object.prototype.hasOwnProperty.call(rec, k)) return;
    var v = rec[k];
    if (v === '' || (Array.isArray(v) && !v.length)) return;
    patch[k] = v;
  });
  return patch;
}
/* Tanggal ISO atau tanggal-jam lokal, tanpa koreksi kalender otomatis (31 Feb ditolak). */
function coreReturTanggalSah(value) {
  var m = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?$/);
  if (!m) return false;
  var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4] || 0), mi = Number(m[5] || 0), s = Number(m[6] || 0);
  var cal = new Date(0); cal.setUTCFullYear(y, mo - 1, d); cal.setUTCHours(h, mi, s, 0);
  if (y < 1 || cal.getUTCFullYear() !== y || cal.getUTCMonth() !== mo - 1 || cal.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return false;
  if (m[8] && m[8] !== 'Z' && (Number(m[8].slice(1, 3)) > 23 || Number(m[8].slice(4, 6)) > 59)) return false;
  return true;
}
function coreReturCekTerima(rec, jumlahBukti) {
  if (RETUR_DITERIMA.indexOf(rec.status) >= 0) {
    if (rec.unidentified) throw new Error('Cocokkan paket tanpa resi ke pesanan terlebih dahulu.');
    if (!coreReturTanggalSah(rec.receivedAt) || !String(rec.receiver || '').trim() || !Number.isSafeInteger(rec.receivedQty) || rec.receivedQty <= 0)
      throw new Error('Isi tanggal diterima, penerima, dan jumlah barang yang benar-benar diterima.');
    if (!Number.isSafeInteger(jumlahBukti) || jumlahBukti < 1) throw new Error('Unggah minimal satu bukti paket diterima sebelum menyimpan status penerimaan.');
  }
  if (rec.status === 'hilang' && !String(rec.note || '').trim() && !String(rec.claimRef || '').trim()) throw new Error('Isi dasar konfirmasi paket hilang atau nomor laporan.');
  if (rec.claimDeadline && !coreReturTanggalSah(rec.claimDeadline)) throw new Error('Tanggal batas pengaduan tidak valid.');
}
var RETUR_PATCH_TEKS = { receivedAt: 80, receiver: 100, note: 10000, courierStatus: 1000, trackingReturn: 300, trackingOutbound: 300, courier: 300, claimRef: 1000, claimDeadline: 80, claimStatus: 300 };
function coreReturPatch(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Periksa isian: perubahan tidak valid.');
  var out = {};
  Object.keys(raw).forEach(function (k) {
    var v = raw[k];
    if (v === undefined) return;
    if (k === 'status') { if (!RETUR_STATUS[v]) throw new Error('Periksa isian: status tidak dikenal.'); out.status = v; }
    else if (k === 'receivedQty') out.receivedQty = coreReturAngka(v, 'jumlah diterima', true);
    else if (k === 'archived') { if (typeof v !== 'boolean') throw new Error('Periksa isian: arsip tidak valid.'); out.archived = v; }
    else if (Object.prototype.hasOwnProperty.call(RETUR_PATCH_TEKS, k)) out[k] = coreReturStr(v, RETUR_PATCH_TEKS[k], k);
    else throw new Error('Periksa isian: kolom ' + k + ' tidak dapat diubah.');
  });
  return out;
}
/* Jenis berkas dari isi (bukan dari nama): JPG, PNG, WebP, PDF, MP4. Masukan base64. */
function coreReturJenisBerkas(b64) {
  var abjad = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', s = String(b64 || '').slice(0, 24), bytes = [], buf = 0, bits = 0;
  for (var i = 0; i < s.length; i++) { var v = abjad.indexOf(s.charAt(i)); if (v < 0) break; buf = (buf << 6) | v; bits += 6; if (bits >= 8) { bits -= 8; bytes.push((buf >> bits) & 255); } }
  function teks(a, n) { return String.fromCharCode.apply(null, bytes.slice(a, a + n)); }
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes[0] === 137 && teks(1, 3) === 'PNG') return 'image/png';
  if (teks(0, 4) === 'RIFF' && teks(8, 4) === 'WEBP') return 'image/webp';
  if (teks(0, 5) === '%PDF-') return 'application/pdf';
  if (teks(4, 4) === 'ftyp') return 'video/mp4';
  return '';
}
function coreReturUkuranBase64(b64) { var s = String(b64 || ''), pad = /==$/.test(s) ? 2 : /=$/.test(s) ? 1 : 0; return Math.max(0, Math.floor(s.length * 3 / 4) - pad); }

/* ---------- aksi server (owner) ---------- */
function coreInstallReturActions(actions, ctx) {
  var store = ctx.store, env = ctx.env, fail = ctx.fail;
  function owner(p) { var me = ctx.auth(p); if (me.divisi !== 'owner') fail('Retur paket hanya untuk owner.'); return me; }
  function fresh(names) { if (store.checkpoint) store.checkpoint(names); else if (store.fresh) names.forEach(function (n) { store.fresh(n); }); }
  function now() { return env.now().toISOString(); }
  function idBaru() { return env.id ? String(env.id()) : Math.random().toString(36).slice(2) + Date.now().toString(36); }
  function periksa(fn) { try { return fn(); } catch (e) { fail(e && e.message || String(e)); } }
  function unpack(r) { var c = coreParseJSON(r.data, {}) || {}; c.id = r.id; c.revision = coreNum(r.revision) || 1; c.createdAt = r.dibuat; c.updatedAt = r.diubah; return c; }
  function pack(c) {
    var o = {}; Object.keys(c).forEach(function (k) { if (['id', 'revision', 'createdAt', 'updatedAt', 'candidate', 'warning'].indexOf(k) < 0) o[k] = c[k]; });
    var s = JSON.stringify(o); if (s.length > 45000) fail('Data paket ' + (c.orderId || '') + ' terlalu panjang untuk disimpan. Kurangi baris produk dalam file.');
    return s;
  }
  function gabung(a, b) { var o = {}; Object.keys(a).forEach(function (k) { o[k] = a[k]; }); Object.keys(b).forEach(function (k) { o[k] = b[k]; }); return o; }
  function baris(id) { var r = store.read('ReturKasus').filter(function (x) { return x.id === String(id || ''); })[0]; if (!r) fail('Paket tidak ditemukan.'); return r; }
  function kejadian(caseId, type, actor, detail, stamp) { return { id: idBaru(), caseId: caseId, type: type, actor: actor, detail: String(detail || '').slice(0, 4000), dibuat: stamp }; }
  function buktiDari(caseId) { return store.read('ReturBukti').filter(function (b) { return b.caseId === caseId; }); }
  function cekBaris(name, rows) { if (store.validateRows) store.validateRows(name, rows); }
  function terbaru(a, b) { return String(a) < String(b) ? 1 : String(a) > String(b) ? -1 : 0; }
  function folderNama(c) { return (c.orderId || 'Tanpa resi ' + String(c.createdAt || '').slice(0, 10)) + ' · ' + (RETUR_PLATFORM[c.platform] || '') + ' · ' + c.shop; }
  function buktiView(b) { return { id: b.id, name: b.name, type: b.type, size: coreNum(b.size), category: b.category, createdAt: b.dibuat, url: env.alamatBukti ? env.alamatBukti(b.fileId) : '' }; }

  actions.getReturState = function (p) {
    owner(p); fresh(['ReturKasus', 'ReturImpor']);
    var rows = store.read('ReturKasus').slice().sort(function (a, b) { return terbaru(a.diubah, b.diubah); });
    var imports = store.read('ReturImpor').slice().sort(function (a, b) { return terbaru(a.dibuat, b.dibuat); }).slice(0, 30)
      .map(function (i) { return { id: i.id, filename: i.filename, createdAt: i.dibuat, added: coreNum(i.added), updated: coreNum(i.updated) }; });
    return { cases: rows.slice(0, 5000).map(unpack), imports: imports, truncated: rows.length > 5000, drive: !!env.simpanBukti };
  };
  actions.getReturDetail = function (p) {
    owner(p); fresh(['ReturKasus', 'ReturEvent', 'ReturBukti']);
    var r = baris(p.id), c = unpack(r);
    var events = store.read('ReturEvent').filter(function (e) { return e.caseId === r.id; }).sort(function (a, b) { return terbaru(a.dibuat, b.dibuat); }).slice(0, 500)
      .map(function (e) { return { id: e.id, type: e.type, actor: e.actor, detail: e.detail, createdAt: e.dibuat }; });
    var bukti = buktiDari(r.id).sort(function (a, b) { return terbaru(a.dibuat, b.dibuat); }).map(buktiView);
    return { case: c, events: events, evidence: bukti, folderUrl: c.folderId && env.alamatFolder ? env.alamatFolder(c.folderId) : '' };
  };
  actions.importRetur = function (p) {
    var me = owner(p), actor = me.nama || 'Owner';
    var filename = coreReturStr(p.filename, 250, 'nama file'), shop = coreReturStr(p.shop, 100, 'nama toko', true), importKey = coreReturStr(p.importKey, 200, 'kunci impor', true);
    if (!RETUR_PLATFORM[p.platform]) fail('Platform tidak dikenal.');
    if (!(Array.isArray(p.cases)) || !p.cases.length || p.cases.length > 200) fail('Kirim 1 sampai 200 paket per tahap impor.');
    fresh(['ReturKasus', 'ReturImpor', 'ReturEvent']);
    var prior = store.read('ReturImpor').filter(function (i) { return i.importKey === importKey; })[0];
    if (prior) return { added: coreNum(prior.added), updated: coreNum(prior.updated), replayed: true };
    var incoming = periksa(function () { return p.cases.map(function (c) { return coreReturKasusBaru(gabung(c && typeof c === 'object' ? c : {}, { shop: shop, platform: p.platform, sourceFile: filename })); }); });
    if (coreReturUnik(incoming.map(function (c) { return c.key; })).length !== incoming.length) fail('Ada paket ganda dalam pilihan impor.');
    var all = store.read('ReturKasus').map(function (r) { return { row: r, c: unpack(r) }; });
    var stamp = now(), dipakai = {}, added = 0, updated = 0, baru = [], ubah = [], events = [];
    incoming.forEach(function (c) {
      var ex = all.filter(function (x) { return x.row.caseKey === c.key; })[0];
      if (!ex) {
        var cocokan = all.filter(function (x) {
          return !x.c.unidentified && x.c.platform === c.platform && String(x.c.shop || '').trim().toLowerCase() === c.shop.trim().toLowerCase() && x.c.orderId === c.orderId &&
            (!x.c.returnId || !c.returnId || x.c.returnId === c.returnId) && (!x.c.packageId || !c.packageId || x.c.packageId === c.packageId);
        });
        if (cocokan.length > 1) fail('Pesanan ' + c.orderId + ' memiliki beberapa paket. Sertakan ID paket/retur agar tidak salah digabung.');
        ex = cocokan[0];
      }
      if (ex) {
        if (dipakai[ex.row.id]) fail('Beberapa paket cocok ke satu pesanan lama. Lengkapi ID paket/retur sebelum mengimpor agar paket tidak tertimpa.');
        dipakai[ex.row.id] = 1;
        var lama = Date.parse(ex.c.sourceUpdatedAt), kini = Date.parse(c.sourceUpdatedAt);
        if (isFinite(lama) && isFinite(kini) && kini < lama) return;   /* file lebih tua dari data tersimpan: dilewati */
        var next = gabung(ex.c, coreReturPatchSumber(c));
        ubah.push({ id: ex.row.id, patch: { data: pack(next), revision: coreNum(ex.row.revision) + 1, diubah: stamp } });
        events.push(kejadian(ex.row.id, 'Impor diperbarui', actor, 'Data seller dari ' + filename + '. Catatan penerimaan dan bukti tetap disimpan.', stamp));
        updated++;
      } else {
        var id = idBaru();
        baru.push({ id: id, caseKey: c.key, data: pack(c), revision: 1, dibuat: stamp, diubah: stamp });
        events.push(kejadian(id, 'Diimpor', actor, 'Sumber ' + filename + ' · ' + (c.sourceStatus || 'tanpa status') + (c.reason ? ' · ' + c.reason : ''), stamp));
        added++;
      }
    });
    var tanda = { id: idBaru(), importKey: importKey, filename: filename, dibuat: stamp, added: added, updated: updated };
    cekBaris('ReturKasus', baru); cekBaris('ReturEvent', events); cekBaris('ReturImpor', [tanda]);
    if (baru.length) store.appendMany('ReturKasus', baru);
    ubah.forEach(function (u) { store.update('ReturKasus', u.id, u.patch); });
    if (events.length) store.appendMany('ReturEvent', events);
    store.append('ReturImpor', tanda);   /* terakhir: impor yang terputus diulang aman dengan kunci yang sama */
    return { added: added, updated: updated };
  };
  actions.saveRetur = function (p) {
    var me = owner(p), actor = me.nama || 'Owner';
    var revisi = Number(p.revision); if (!Number.isSafeInteger(revisi) || revisi < 1) fail('Versi paket tidak valid. Muat ulang paket.');
    var patch = periksa(function () { return coreReturPatch(p.patch); });
    fresh(['ReturKasus', 'ReturEvent', 'ReturBukti']);
    var r = baris(p.id); if (coreNum(r.revision) !== revisi) fail('Data sudah berubah. Muat ulang paket sebelum menyimpan.');
    var current = unpack(r), next = gabung(current, patch);
    periksa(function () { coreReturCekTerima(next, buktiDari(r.id).length); });
    var detail = Object.keys(patch).filter(function (k) { return patch[k] !== current[k]; }).map(function (k) { var a = current[k]; return k + ': ' + (a === undefined || a === null || a === '' ? '—' : String(a)) + ' → ' + String(patch[k]); }).join('\n');
    if (!detail) return { case: current };
    var stamp = now(), ev = kejadian(r.id, 'Catatan diperbarui', actor, detail, stamp);
    cekBaris('ReturEvent', [ev]);
    store.update('ReturKasus', r.id, { data: pack(next), revision: revisi + 1, diubah: stamp });
    store.append('ReturEvent', ev);
    return { case: unpack(baris(r.id)) };
  };
  actions.catatReturTanpaResi = function (p) {
    var me = owner(p), actor = me.nama || 'Owner';
    var reqId = coreReturStr(p.requestId, 60, 'kunci permintaan', true);
    if (!/^[A-Za-z0-9_-]{6,60}$/.test(reqId)) fail('Kunci permintaan tidak valid. Buka ulang formulir.');
    var shop = coreReturStr(p.shop, 100, 'nama toko', true), produk = coreReturStr(p.productSummary, 4000, 'produk / ciri paket', true);
    var receivedAt = coreReturStr(p.receivedAt, 80, 'tanggal tiba', true), receiver = coreReturStr(p.receiver, 100, 'nama penerima', true);
    var qty = Number(p.receivedQty); if (!Number.isSafeInteger(qty) || qty < 1 || qty > 100000) fail('Jumlah barang harus bilangan bulat minimal 1.');
    if (!coreReturTanggalSah(receivedAt)) fail('Tanggal diterima tidak valid.');
    var note = coreReturStr(p.note, 10000, 'catatan'), courier = coreReturStr(p.courier, 300, 'kurir');
    fresh(['ReturKasus', 'ReturEvent']);
    var key = 'manual|' + reqId, lama = store.read('ReturKasus').filter(function (r) { return r.caseKey === key; })[0];
    if (lama) return { case: unpack(lama) };
    var c = coreReturKasusBaru({ platform: 'lainnya', shop: shop, orderId: 'sementara', items: [] });
    c.orderId = ''; c.key = key; c.unidentified = true; c.productSummary = produk; c.receivedAt = receivedAt; c.receiver = receiver; c.receivedQty = qty; c.note = note; c.courier = courier;
    var id = idBaru(), stamp = now();
    var row = { id: id, caseKey: key, data: pack(c), revision: 1, dibuat: stamp, diubah: stamp }, ev = kejadian(id, 'Paket tanpa resi diterima', actor, produk + ' · ' + qty + ' barang · penerima ' + receiver, stamp);
    cekBaris('ReturKasus', [row]); cekBaris('ReturEvent', [ev]);
    store.append('ReturKasus', row); store.append('ReturEvent', ev);
    return { case: unpack(row) };
  };
  actions.cocokkanRetur = function (p) {
    var me = owner(p), actor = me.nama || 'Owner';
    fresh(['ReturKasus', 'ReturEvent', 'ReturBukti']);
    var from = baris(p.id), to = baris(p.targetId), a = unpack(from), t = unpack(to);
    if (!a.unidentified || a.matchedTo || t.unidentified || from.id === to.id) fail('Pilih paket tanpa resi yang belum dicocokkan dan pesanan tujuan yang jelas.');
    if (coreNum(from.revision) !== Number(p.revision) || coreNum(to.revision) !== Number(p.targetRevision)) fail('Data berubah. Muat ulang sebelum mencocokkan.');
    if (t.receivedAt) fail('Pesanan tujuan sudah memiliki penerimaan. Periksa rincian sebelum menggabungkan paket.');
    var bukti = buktiDari(from.id); if (!bukti.length) fail('Unggah bukti paket tanpa resi sebelum mencocokkan.');
    var stamp = now();
    var tujuan = gabung(t, { receivedAt: a.receivedAt, receiver: a.receiver, receivedQty: a.receivedQty, status: 'perlu_dicek', note: [t.note, a.note, 'Paket tanpa resi dicocokkan oleh ' + actor].filter(Boolean).join('\n') });
    if (!t.folderId && a.folderId) tujuan.folderId = a.folderId;
    var asal = gabung(a, { archived: true, matchedTo: to.id });
    var salin = store.read('ReturEvent').filter(function (e) { return e.caseId === from.id; }).map(function (e) { return { id: idBaru(), caseId: to.id, type: e.type, actor: e.actor, detail: e.detail, dibuat: e.dibuat }; });
    var events = salin.concat([
      kejadian(to.id, 'Paket tanpa resi dicocokkan', actor, 'Penerimaan ' + a.receivedAt + ' oleh ' + a.receiver + ' · ' + a.receivedQty + ' barang. Asal ' + from.id + '. ' + (a.note || ''), stamp),
      kejadian(from.id, 'Dicocokkan ke pesanan', actor, t.orderId, stamp)]);
    cekBaris('ReturEvent', events);
    store.update('ReturKasus', to.id, { data: pack(tujuan), revision: coreNum(to.revision) + 1, diubah: stamp });
    store.update('ReturKasus', from.id, { data: pack(asal), revision: coreNum(from.revision) + 1, diubah: stamp });
    bukti.forEach(function (b) { store.update('ReturBukti', b.id, { caseId: to.id }); });
    store.appendMany('ReturEvent', events);
    return { case: unpack(baris(to.id)) };
  };
  actions.unggahReturBukti = function (p) {
    var me = owner(p), actor = me.nama || 'Owner';
    var reqId = coreReturStr(p.requestId, 60, 'kunci permintaan', true);
    if (!/^[A-Za-z0-9_-]{6,60}$/.test(reqId)) fail('Kunci permintaan tidak valid. Pilih ulang berkasnya.');
    var kategori = String(p.category || 'other'); if (!RETUR_KATEGORI[kategori]) fail('Jenis bukti tidak valid.');
    var b64 = String(p.base64 || ''); if (!b64 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) fail('Berkas bukti kosong atau rusak. Pilih ulang berkasnya.');
    var size = coreReturUkuranBase64(b64); if (!size || size > RETUR_BUKTI_MAKS) fail('Pilih foto, video, atau PDF maksimal 20 MB.');
    var mime = coreReturJenisBerkas(b64); if (!mime) fail('Format bukti harus JPG, PNG, WebP, MP4, atau PDF.');
    var name = String(p.name || '').replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').trim().slice(0, 180) || 'bukti';
    fresh(['ReturKasus', 'ReturBukti', 'ReturEvent']);
    var ada = store.read('ReturBukti').filter(function (b) { return b.requestId === reqId; })[0];
    if (ada) return { bukti: buktiView(ada), replayed: true };
    var r = baris(p.caseId), c = unpack(r);
    if (c.matchedTo) fail('Paket ini sudah dicocokkan ke pesanan lain. Unggah bukti di pesanan tujuan.');
    if (!env.simpanBukti) fail('Penyimpanan bukti belum tersedia di server.');
    var simpan = env.simpanBukti({ folderId: c.folderId || '', folder: folderNama(c), name: name, mime: mime, base64: b64 });
    if (!simpan || !simpan.fileId) fail('Bukti belum tersimpan di Google Drive. Coba lagi.');
    var stamp = now();
    var row = { id: idBaru(), caseId: r.id, fileId: simpan.fileId, name: name, type: mime, size: size, category: kategori, dibuat: stamp, requestId: reqId };
    try {
      cekBaris('ReturBukti', [row]);
      store.append('ReturBukti', row);
      store.append('ReturEvent', kejadian(r.id, 'Bukti ditambahkan', actor, name + ' · ' + RETUR_KATEGORI[kategori], stamp));
      /* folder Drive paket dicatat sekali; versi paket tidak naik karena isian penerimaan tidak berubah */
      if (!c.folderId && simpan.folderId) store.update('ReturKasus', r.id, { data: pack(gabung(c, { folderId: simpan.folderId })) });
    } catch (e) { if (env.buangBukti) { try { env.buangBukti(simpan.fileId); } catch (x) {} } throw e; }
    return { bukti: buktiView(row) };
  };
  actions.getReturBukti = function (p) {
    owner(p); fresh(['ReturBukti']);
    var b = store.read('ReturBukti').filter(function (x) { return x.id === String(p.id || ''); })[0]; if (!b) fail('Bukti tidak ditemukan.');
    var out = buktiView(b);
    if (out.size <= 8 * 1024 * 1024 && env.ambilBukti) out.base64 = env.ambilBukti(b.fileId);
    return out;
  };
}
