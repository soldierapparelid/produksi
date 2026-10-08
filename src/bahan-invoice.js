/* Invoice receipts remain ordinary stock ledger rows. One batch write, with
   stable row IDs, lets a lost response be checked/retried without double stock. */
function coreBahanInvoiceNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return NaN;
  return Number(value);
}
function coreBahanInvoicePlan(id, rows, existing) {
  if (!/^[A-Za-z0-9_-]{6,42}$/.test(String(id || ''))) throw new Error('Identitas invoice tidak sah. Buka kembali form pembelian.');
  if (!(rows instanceof Array) || !rows.length || rows.length > 200) throw new Error('Isi maksimal 200 rol dalam satu invoice.');
  var fields = ['jenis','tanggal','bahan','qty','satuan','rol','harga','total','supplier','invoice','sumber','catatan','invoiceId','stockMode','rollLabel'];
  var previous = {}, canonical = {}, units = {}, pending = [], all = [];
  (existing || []).forEach(function (r) { previous[r.id] = r; });
  rows.forEach(function (source, index) {
    var row = {}; Object.keys(source).forEach(function (key) { row[key] = source[key]; });
    /* The row count is part of every stable ID. A partial retry can fill missing
       rows, but cannot silently append a newly added line to an existing bill. */
    row.id = id + '_' + rows.length + '_' + (index + 1); row.invoiceId = id;
    var key = coreNormBahan(row.bahan);
    if (!key) throw new Error('Nama bahan wajib diisi pada baris ' + (index + 1) + '.');
    if (units[key] && units[key] !== row.satuan) throw new Error('Satuan bahan ' + row.bahan + ' harus sama pada semua baris.');
    if (canonical[key]) row.bahan = canonical[key]; else canonical[key] = row.bahan;
    units[key] = row.satuan;
    var old = previous[row.id];
    if (old) {
      if (fields.some(function (field) { return String(old[field] == null ? '' : old[field]) !== String(row[field] == null ? '' : row[field]); }))
        throw new Error('Invoice ini sudah tercatat dengan isi berbeda. Periksa daftar pembelian sebelum mengubahnya.');
      all.push(old);
    } else { pending.push(row); all.push(row); }
  });
  (existing || []).forEach(function (row) {
    if (row.invoiceId === id && !all.some(function (r) { return r.id === row.id; }))
      throw new Error('Jumlah baris invoice yang tersimpan berbeda. Periksa daftar pembelian.');
  });
  return { rows: all, pending: pending };
}
