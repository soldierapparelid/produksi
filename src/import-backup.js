/* ============================================================
   KONVERSI BACKUP APLIKASI LAMA -> struktur baru (murni, tanpa store).
   Data lama: satu baris per (barang, series, ukuran) dengan daftar potong /
   assignJahit / jahit / hitungFisik / qc / bsInputs, plus "arsip" siklus lama.
   Data baru: satu PO per SKU/ukuran/siklus agar riwayat tidak saling bercampur.
   Id dibuat tetap (bukan acak), jadi impor ulang tidak membuat dobel.
   ============================================================ */
/* Same legacy tariff resolution as production-payroll.js: immutable snapshot first,
   otherwise the worker's own product tariff history as of the source event. Never use
   a modal product tariff or a different worker's rate to fill missing evidence. */
function importPositiveRate(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return 0;
  if (typeof value === 'string' && !value.trim()) return 0;
  var n = Number(value); return isFinite(n) && n > 0 && n <= 9007199254740991 ? n : 0;
}
function importRateDate(value) {
  if (value == null || value === '') return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return isFinite(value) ? value : NaN;
  var text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    var parts = text.split('-').map(Number), date = new Date(parts[0], parts[1] - 1, parts[2]);
    return date.getFullYear() === parts[0] && date.getMonth() === parts[1] - 1 && date.getDate() === parts[2] ? date.getTime() : NaN;
  }
  return Date.parse(text);
}
function importLegacyRateFor(worker, series, product, date) {
  if (!worker) return 0;
  var rawKey = String(series || '') + '|' + String(product || ''), key = rawKey.replace(/[.#$\/\[\]]/g, '_');
  var current = worker.tarif || {}, histories = worker.tarifHistory || {}, raw = histories[key] || histories[rawKey] || [];
  var entries = (raw instanceof Array ? raw : (typeof raw === 'object' ? Object.keys(raw).map(function (k) { return raw[k]; }) : []));
  var history = entries.filter(function (e) { return e && typeof e === 'object'; }).map(function (e, i) { return { time: importRateDate(e.effectiveAt), rate: importPositiveRate(e.rate), index: i }; }).filter(function (e) { return isFinite(e.time); });
  var at = importRateDate(date);
  if (history.length && isFinite(at)) {
    history.sort(function (a, b) { return b.time - a.time || b.index - a.index; });
    for (var i = 0; i < history.length; i++) if (history[i].time <= at) return history[i].rate;
    return 0;
  }
  return importPositiveRate(current[key] != null ? current[key] : current[rawKey]);
}
function convertBackup(backup, options) {
  options = options || {};
  /* Dua bentuk sumber dikenali: file backup penuh aplikasi lama ({ produksi: {...} }) dan ekspor database
     aplikasi lama ({ soldier: { produksi, stokBahan, gajiHarian, produksi_meta } } atau isi "soldier" langsung). */
  var root = (backup && backup.soldier && typeof backup.soldier === 'object') ? backup.soldier : (backup || {});
  function daftar(v) {
    if (typeof v === 'string') v = coreParseJSON(v, null);
    if (v instanceof Array) return v.filter(Boolean);
    if (v && typeof v === 'object') return Object.keys(v).sort(function (a, b) { return (Number(a) - Number(b)) || (a < b ? -1 : (a > b ? 1 : 0)); }).map(function (k) { return v[k]; }).filter(Boolean);
    return [];
  }
  var src = (root.produksi && typeof root.produksi === 'object') ? root.produksi : {};
  var items = daftar(src.produksi);
  var images = (src.images && typeof src.images === 'object') ? src.images : {};
  var rows = { Pegawai: [], Produk: [], PO: [], Potong: [], SlipKirim: [], SlipSetor: [], QC: [], Gudang: [], GudangLama: [], StokBahan: [], Karyawan: [], GajiHarian: [], Kasbon: [] };
  var info = { duplikat: 0, baris: items.length, catatan: [], lineage: [], review: [], requiresReview: false };
  var used = {};
  function claim(id) { id = String(id); if (!/^[A-Za-z0-9_-]{6,48}$/.test(id) || used[id]) return ''; used[id] = 1; return id; }
  function gen(prefix, key) { var base = prefix + coreHash(key); var id = base, n = 1; while (used[id]) id = base + (n++).toString(36); used[id] = 1; return id; }
  function iso(a, b) { return a || (b ? b + 'T00:00:00.000Z' : ''); }
  function up(s) { return String(s || '').trim().toUpperCase(); }

  /* pegawai */
  var peg = {}; var nameToId = {};
  function regPeg(id, nama, divisi) {
    if (!id) return;
    id = String(id);
    if (!peg[id]) { used[id] = 1; peg[id] = { id: id, nama: coreTitle(nama) || 'Tukang ' + divisi, divisi: divisi, pin: '', token: '', gagal: 0, kunci: '', hp: '', catatan: 'Dari aplikasi lama', aktif: true, dibuat: '' }; }
    else if (nama && peg[id].nama.indexOf('Tukang ') === 0) peg[id].nama = coreTitle(nama);
    nameToId[peg[id].nama.toLowerCase()] = id;
  }
  function eachCycle(it, fn) { fn(it, 'cur'); (it.arsip instanceof Array ? it.arsip : []).forEach(function (a, i) { if (a) fn(a, 'a' + i); }); }
  function arr(v) { return (v instanceof Array ? v : ((v && typeof v === 'object') ? daftar(v) : [])).filter(function (x) { return x && typeof x === 'object'; }); }
  items.forEach(function (it) {
    eachCycle(it, function (c) {
      arr(c.potong).forEach(function (e) { regPeg(e.tukangId, e.tukangNama, 'potong'); });
      arr(c.jahit).forEach(function (e) { regPeg(e.tukangId, e.tukangNama, 'jahit'); });
      arr(c.assignJahit).forEach(function (e) { regPeg(e.tukangId, '', 'jahit'); });
    });
  });
  /* daftar tukang di aplikasi lama: hanya id dan nama yang diambil. PIN lama tidak pernah ikut dipindahkan. */
  var meta = (root.produksi_meta && typeof root.produksi_meta === 'object') ? root.produksi_meta : {};
  var payrollWorkers = arr(meta.tukangJahit);
  arr(meta.tukangJahit).forEach(function (t) { regPeg(t.id, t.nama, 'jahit'); });
  arr(meta.tukang).forEach(function (t) { regPeg(t.id, t.nama, 'potong'); });
  function maklonByName(n) {
    var name = String(n || '').trim().toLowerCase();
    var found = Object.keys(peg).filter(function (id) { return peg[id].divisi === 'jahit' && String(peg[id].nama).trim().toLowerCase() === name; });
    return found.length === 1 ? found[0] : '';
  }
  /* catatan potong lama sering tanpa nama; kalau tukang potongnya memang cuma satu, itu orangnya */
  var potongIds = Object.keys(peg).filter(function (id) { return peg[id].divisi === 'potong'; });
  var solePotong = potongIds.length === 1 ? potongIds[0] : '';
  var stamp = String((backup && backup._meta && backup._meta.ts) || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stamp)) stamp = coreYmd(new Date());

  /* produk + tarif yang paling sering dipakai */
  var produkMap = {}; var sizeSet = {}; var tarifStat = {};
  function isOffline(it) { return !!it._offlineOrderId || up(it.series).indexOf('OFFLINE-') === 0; }
  function produkKey(it) { return up(it.series) + '|' + up(it.namaBarang); }
  function stat(key, field, val) { if (!(val > 0)) return; var t = tarifStat[key] = tarifStat[key] || {}; var f = t[field] = t[field] || {}; f[val] = (f[val] || 0) + 1; }
  function mode(key, field) { var f = tarifStat[key] && tarifStat[key][field]; if (!f) return 0; var best = 0, bc = 0; for (var v in f) if (f[v] > bc) { bc = f[v]; best = Number(v); } return best; }
  items.forEach(function (it) {
    if (!it || !it.namaBarang) return;
    if (it.size) sizeSet[up(it.size)] = 1;
    var key = produkKey(it);
    eachCycle(it, function (c) {
      arr(c.potong).forEach(function (e) { stat(key, 'potong', coreNum(e.tarif)); });
      arr(c.jahit).forEach(function (e) { stat(key, 'jahit', coreNum(e.tarif)); });
      arr(c.hitungFisik).forEach(function (e) { if (e.payroll) stat(key, 'jahit', coreNum(e.payroll.rate)); });
    });
    if (isOffline(it) || produkMap[key]) return;
    produkMap[key] = { id: gen('pr', key), nama: up(it.namaBarang), series: up(it.series), gambar: '', tarifPotong: 0, tarifJahit: 0, catatan: '', aktif: true, dibuat: '' };
  });
  var imageList = [];
  Object.keys(produkMap).forEach(function (key) {
    var pr = produkMap[key];
    pr.tarifPotong = mode(key, 'potong'); pr.tarifJahit = mode(key, 'jahit');
    var img = images[key] || images[pr.series + '|' + pr.nama];
    if (!img) for (var k in images) if (up(k) === key) { img = images[k]; break; }
    if (img && typeof img === 'string') imageList.push({ id: pr.id, jenis: 'produk', dataUrl: img });
    rows.Produk.push(pr);
  });

  /* Production import v2: counts are evidence of receipt; sewing reports are not. */
  var KEYS = ['potong', 'assignJahit', 'jahit', 'qc', 'hitungFisik', 'gudang', 'bsInputs'];
  function hasData(c) { return KEYS.some(function (k) { return arr(c[k]).length; }); }
  function firstDate(c) { var d = ''; KEYS.forEach(function (k) { arr(c[k]).forEach(function (e) { if (e.tanggal && (!d || e.tanggal < d)) d = e.tanggal; }); }); return d; }
  function canonical(v) {
    if (v instanceof Array) return '[' + v.map(canonical).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canonical(v[k]); }).join(',') + '}';
    return JSON.stringify(v);
  }
  function stopped(e) { return e.deleted === true || e.isDeleted === true || !!e.deletedAt || e.cancelled === true || e.canceled === true || !!e.cancelledAt || !!e.canceledAt || /^(deleted|cancelled|canceled|dihapus|dibatalkan|batal)$/i.test(String(e.status || '')); }
  var sourceKeys = {};
  function cycleIdentity(c, archive) { return archive ? 'archive:' + (c.id || c.cycleId || coreHash(canonical(c))) : 'current'; }
  var cycleSources = {};
  function addCycle(it, c, tag, archive, aliases) {
    var size = up(it.size), sourceId = String(it.id || '');
    var label = (it.series || '') + ' / ' + it.namaBarang + ' / ' + (size || 'tanpa ukuran') + ' / ' + (archive ? (c.label || c.tanggalArsip || tag) : 'aktif');
    function problem(msg) { throw new Error('Impor belum dijalankan: ' + label + '. ' + msg + ' Periksa catatan asal dahulu; tidak ada jumlah atau pembayaran yang ditebak.'); }
    function pcs(v, field) {
      if (v === null || v === undefined || v === '') return 0;
      var n = Number(v);
      if (!isFinite(n) || n < 0 || Math.floor(n) !== n || n > 9007199254740991) problem('Jumlah ' + field + ' tidak valid.');
      return n;
    }
    function paid(v) { return v === true || v === 1 || v === 'true'; }
    function active(field) {
      var selected = {}, out = [];
      arr(c[field]).forEach(function (e, i) {
        var key = e.id != null && e.id !== '' ? 'id:' + e.id : 'row:' + i;
        if (selected[key]) {
          if (canonical(selected[key]) !== canonical(e)) problem('ID ganda yang berbeda pada ' + field + ': ' + e.id + '.');
          info.duplikat++; return;
        }
        selected[key] = e; if (!stopped(e)) out.push(e);
      });
      return out;
    }
    function identity(e, i) { return e.id != null && e.id !== '' ? 'id:' + e.id : 'row:' + i + ':' + coreHash(canonical(e)); }
    if (!size) problem('Ukuran SKU belum diisi.');
    if (!sourceId) problem('Identitas SKU belum tersedia.');
    var cycleKey = cycleIdentity(c, archive);
    var key = 'I2|' + sourceId + '|' + size + '|' + cycleKey;
    var cycleContent = canonical(c);
    if (sourceKeys['cycle:' + key]) {
      if (sourceKeys['cycle:' + key] !== cycleContent) problem('Identitas siklus yang sama memuat riwayat berbeda.');
      info.duplikat++; return;
    }
    sourceKeys['cycle:' + key] = cycleContent;
    var pr = produkMap[produkKey(it)];
    var po = { id: gen('po', key), noPO: '', jenis: isOffline(it) ? 'pesanan' : 'stok', produkId: pr ? pr.id : '',
      nama: pr ? pr.nama : up(it.namaBarang), series: pr ? pr.series : up(it.series),
      pelanggan: isOffline(it) ? coreTitle(it._offlineCustomer || String(it.series || '').replace(/^OFFLINE-/i, '')) : '',
      deadline: it._offlineDeadline || '', ukuran: {}, total: 0, bahan: '', catatan: (archive ? 'Arsip ' + (c.label || c.tanggalArsip || '') : it.poKet || ''),
      gambar: '', status: 'aktif', dibuat: '', dibuatOleh: '', diubah: '', selesaiPada: '', asal: 'lama', imporVersion: 2,
      imporReview: '', imporSumber: JSON.stringify({ skuId: sourceId, ukuran: size, siklus: cycleKey, arsip: !!archive, statusAsal: c.poAktif, label: c.label || '', aliases: aliases || [] }) };
    cycleSources[po.id] = { skuId: sourceId, ukuran: size, siklus: cycleKey, aliases: aliases || [], source: c };
    function provenance(field, e, i) { return { skuId: sourceId, ukuran: size, siklus: cycleKey, entryId: e.id != null && e.id !== '' ? String(e.id) : '', field: field, index: i, baseline: true, aliases: aliases || [] }; }
    function pushSource(table, record, field, e, i) {
      var src = provenance(field, e, i);
      if (table === 'SlipSetor' || table === 'QC' || table === 'GudangLama' || table === 'Gudang') record.imporSumber = JSON.stringify(src);
      rows[table].push(record); info.lineage.push({ table: table, id: record.id, poId: po.id, source: src });
    }
    if (isOffline(it)) { po.ukuran[size] = pcs(it._offlineQty, 'pesanan'); po._img = it._offlineGambar || ''; }
    function uk(n) { var o = {}; if (n) o[size] = n; return o; }
    function worker(e) {
      var id = String((e.payroll || {}).workerId || e.tukangId || e.workerId || '');
      if (!id) id = maklonByName(e.tukang || e.tukangJahit || e.tukangNama || (e.payroll || {}).workerName);
      if (!id || !peg[id] || peg[id].divisi !== 'jahit') problem('Tukang jahit pada ' + (e.id || e.tanggal || 'catatan') + ' belum dapat dicocokkan secara pasti.');
      return id;
    }
    function sourceRate(e, wid, required, source) {
      var captured = e.payroll || source && source.payroll || {}, rate = !captured.rateMissing ? importPositiveRate(captured.rate) : 0;
      if (!rate) {
        var matches = payrollWorkers.filter(function (w) { return String(w.id == null ? '' : w.id).trim() === String(wid).trim(); });
        if (matches.length === 1) rate = importLegacyRateFor(matches[0], it.series, it.namaBarang, e.inputAt || e.tanggal || '');
      }
      if (!rate && required) problem('Tarif asli ' + (e.id || e.tanggal || 'catatan') + ' belum tersedia.');
      return rate;
    }
    function uniqueAcrossCycles(field, e) {
      if (e.id == null || e.id === '') return;
      var k = sourceId + '|' + field + '|' + e.id;
      if (sourceKeys[k] && sourceKeys[k] !== key) problem('Catatan ' + field + ' ' + e.id + ' muncul dalam beberapa siklus. Pisahkan sumber aktif/arsip yang tumpang tindih.');
      sourceKeys[k] = key;
    }
    var potong = active('potong'), assignments = active('assignJahit'), sewing = active('jahit'), counts = active('hitungFisik'), quality = active('qc'), stock = active('gudang');
    if (arr(c.bayarJahit).length) problem('Ada catatan pembayaran jahit terpisah yang harus direkonsiliasi sebelum impor.');
    potong.forEach(function (e, i) {
      var n = pcs(e.jumlah, 'potong'); if (!n) return;
      uniqueAcrossCycles('potong', e);
      var bl = arr(e.bahanList).filter(function (b) { return b.jenis || coreNum(b.kg) > 0; }).map(function (b) { return { nama: String(b.jenis || '').trim(), qty: coreNum(b.kg) }; });
      var bahan = e.jenisBahan || (bl[0] || {}).nama || '';
      pushSource('Potong', { id: gen('pt', key + '|potong|' + identity(e, i)), poId: po.id, userId: e.tukangId ? String(e.tukangId) : solePotong,
        tanggal: e.tanggal || '', ukuran: uk(n), total: n, bahan: bahan, kg: coreNum(e.kiloan), rol: arr(e.rols).length,
        tarif: coreNum(e.tarif), upahId: paid(e.dibayar) ? LUNAS_LAMA : '', catatan: e.ket || '', dibuat: iso(e.inputAt, e.tanggal), bahanList: bl.length ? bl : '', asal: 'lama' }, 'potong', e, i);
      if (!po.bahan && bahan) po.bahan = bahan;
    });
    assignments.forEach(function (e, i) {
      var n = pcs(e.qty, 'penugasan'); if (!n) return;
      var wid = worker(e);
      uniqueAcrossCycles('assignJahit', e);
      var linkedRates = {};
      sewing.forEach(function (j) { if (e.id != null && String(j.assignmentId) === String(e.id) && coreNum(j.tarif) > 0) linkedRates[coreNum(j.tarif)] = true; });
      var rates = Object.keys(linkedRates), rate = coreNum(e.tarif || e.upah);
      if (!(rate > 0) && rates.length === 1) rate = Number(rates[0]);
      pushSource('SlipKirim', { id: gen('sk', key + '|assign|' + identity(e, i)), noSlip: '', poId: po.id, maklonId: wid,
        tanggal: e.tanggal || '', target: e.targetTanggal || '', ukuran: uk(n), total: n, upah: rate > 0 ? rate : 0, catatan: e.ket || '', dibuatOleh: '', dibuat: iso(e.editedAt, e.tanggal), asal: 'lama' }, 'assignJahit', e, i);
    });
    var reported = {}, counted = {}, acceptedByHf = {}, countByQc = {};
    function group(id) { return reported[id] || (reported[id] = { good: 0, rejected: 0, entries: [], paid: 0 }); }
    sewing.forEach(function (e, i) {
      var wid = worker(e), total = pcs(e.jumlah, 'laporan jahit'), reject = pcs(e.rijek, 'reject jahit');
      var good = e.lolos != null ? pcs(e.lolos, 'jahit baik') : total - reject;
      if (reject > total || good + reject !== total) problem('Jumlah baik + reject laporan jahit tidak sama dengan jumlahnya.');
      uniqueAcrossCycles('jahit', e);
      var g = group(wid); g.good += good; g.rejected += reject; g.entries.push({ entry: e, index: i, good: good, reject: reject });
      if (paid(e.dibayar)) g.paid += good;
    });
    counts.forEach(function (h, i) {
      var n = pcs(h.jumlah, 'hitung fisik'); if (!n) return;
      if (h.payrollCancelled) problem('Hitungan dibatalkan untuk upah tetapi masih tersimpan: ' + (h.id || h.tanggal) + '.');
      if (h.id == null || h.id === '') problem('Hitung fisik perlu ID tetap untuk hubungan QC.');
      uniqueAcrossCycles('hitungFisik', h);
      var wid = worker(h), g = group(wid), payroll = h.payroll || {};
      var rate = !payroll.rateMissing ? importPositiveRate(payroll.rate) : 0;
      if (!rate) {
        var matches = payrollWorkers.filter(function (w) { return String(w.id == null ? '' : w.id).trim() === String(wid).trim(); });
        if (matches.length === 1) rate = importLegacyRateFor(matches[0], it.series, it.namaBarang, h.inputAt || h.tanggal || '');
      }
      if (!rate) problem('Tarif asli hitung fisik ' + h.id + ' belum tersedia.');
      if (!coreTglOk(h.tanggal)) problem('Tanggal hitung fisik ' + h.id + ' tidak valid.');
      counted[wid] = (counted[wid] || 0) + n;
      if (counted[wid] > g.good) problem('Hitungan melampaui laporan jahit baik milik tukang.');
      if (g.paid > 0 && g.paid !== g.good) problem('Sebagian laporan jahit sudah dibayar; hubungan pembayaran dengan hitungan perlu dipastikan.');
      var rec = { id: gen('ss', key + '|count|' + identity(h, i)), noSlip: '', poId: po.id, maklonId: wid, tanggal: h.tanggal,
        ukuran: uk(n), total: n, reject: 0, rejectUkuran: {}, upah: rate, catatan: 'Hitung fisik asal ' + h.id, status: 'diterima',
        dibuatOleh: '', dibuat: iso(h.inputAt, h.tanggal), diprosesOleh: h.inputBy || '', diprosesPada: iso(h.inputAt, h.tanggal),
        upahId: paid(h.dibayar) || g.paid > 0 ? LUNAS_LAMA : '', asal: 'lama', workflowVersion: Number(h.workflowVersion) === 2 && h.countStage === 'verified' ? 2 : 1 };
      acceptedByHf[String(h.id)] = { record: rec, source: h };
      if (h.qcId != null && h.qcId !== '') {
        if (countByQc[String(h.qcId)]) problem('Satu QC menunjuk beberapa hitungan asal.');
        countByQc[String(h.qcId)] = acceptedByHf[String(h.id)];
      }
      pushSource('SlipSetor', rec, 'hitungFisik', h, i);
    });
    Object.keys(reported).forEach(function (wid) {
      var g = reported[wid], consumed = counted[wid] || 0, pendingTotal = g.good - consumed;
      if (g.paid > 0 && pendingTotal > 0) problem('Laporan sudah dibayar tetapi sebagian belum memiliki hitungan fisik.');
      if (pendingTotal > 0) {
        var reportIds = g.entries.map(function (item) { return identity(item.entry, item.index); }).sort();
        var lastDate = g.entries.reduce(function (d, item) { return item.entry.tanggal > d ? item.entry.tanggal : d; }, '');
        var pendingRow = { id: gen('ss', key + '|pending-worker|' + wid), noSlip: '', poId: po.id, maklonId: wid,
          tanggal: lastDate, ukuran: uk(pendingTotal), total: pendingTotal, reject: 0, rejectUkuran: {}, upah: 0,
          catatan: 'Sisa laporan jahit belum dihitung; agregat tukang, bukan alokasi laporan.', status: 'diajukan',
          dibuatOleh: '', dibuat: iso('', lastDate), diprosesOleh: '', diprosesPada: '', upahId: '', asal: 'lama', workflowVersion: 1 };
        pushSource('SlipSetor', pendingRow, 'jahit', { id: '' }, -1);
        var pendingProvenance = coreParseJSON(pendingRow.imporSumber, {}); pendingProvenance.reportIds = reportIds;
        pendingProvenance.reportedGood = g.good; pendingProvenance.counted = consumed; pendingRow.imporSumber = JSON.stringify(pendingProvenance);
        info.lineage[info.lineage.length - 1].source = pendingProvenance;
      }
      g.entries.forEach(function (item) {
        var e = item.entry;
        if (item.reject) pushSource('SlipSetor', { id: gen('ss', key + '|sewing-reject|' + identity(e, item.index)), noSlip: '', poId: po.id, maklonId: wid,
          tanggal: e.tanggal || '', ukuran: {}, total: 0, reject: item.reject, rejectUkuran: uk(item.reject), upah: 0, catatan: 'Reject laporan jahit asal ' + (e.id || ''), status: 'diterima',
          dibuatOleh: '', dibuat: iso(e.inputAt, e.tanggal), diprosesOleh: '', diprosesPada: iso(e.inputAt, e.tanggal), upahId: paid(e.dibayar) ? LUNAS_LAMA : '', asal: 'lama', workflowVersion: 2 }, 'jahit', e, item.index);
      });
    });
    /* Older batch screens wrote the count and inspection together without IDs
       linking the two. Match only the same unambiguous evidence accepted by
       ProductionPayroll.collectProduct; a timestamp/quantity alone is insufficient. */
    var batchLinks = {}, ambiguousBatch = {}, batchCandidates = [], batchReverse = {}, explicitHf = {};
    function legacyWorkerKey(e) {
      var raw = e.tukangJahit || e.tukang || e.tukangId || '';
      function normalize(v) { return String(v == null ? '' : v).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase(); }
      var value = String(raw).trim(), found = payrollWorkers.filter(function (w) { return String(w.id == null ? '' : w.id).trim() === value; });
      if (!found.length) found = payrollWorkers.filter(function (w) { return normalize(w.nama || w.name) === normalize(value); });
      return found.length === 1 && found[0].id != null && String(found[0].id).trim() ? 'id:' + found[0].id : 'name:' + normalize(raw);
    }
    quality.forEach(function (q) { if (q.hfId != null && q.hfId !== '') explicitHf[String(q.hfId)] = true; });
    quality.forEach(function (q, i) {
      if (Number(q.workflowVersion) === 2 || (q.hfId != null && q.hfId !== '') || countByQc[String(q.id)] || !/batch/.test(q.inputVia || '')) return;
      var at = importRateDate(q.inputAt); if (!isFinite(at)) return;
      var total = pcs(q.ok, 'QC OK') + pcs(q.reject, 'QC reject') + pcs(q.perbaikan == null ? q.kotor : q.perbaikan, 'QC perbaikan') + pcs(q.offline, 'QC offline');
      var near = counts.filter(function (h) {
        var ht = importRateDate(h.inputAt);
        return !(Number(h.workflowVersion) === 2 && h.countStage === 'verified') && !(h.qcId != null && h.qcId !== '') &&
          !explicitHf[String(h.id)] && /batch/.test(h.inputVia || '') && h.tanggal === q.tanggal && legacyWorkerKey(h) === legacyWorkerKey(q) &&
          isFinite(ht) && Math.abs(ht - at) <= 2000;
      });
      var exact = near.filter(function (h) { return total > 0 && pcs(h.jumlah, 'hitung fisik') === total; });
      batchCandidates.push({ index: i, exact: exact, near: near });
      exact.forEach(function (h) { var id = String(h.id); batchReverse[id] = (batchReverse[id] || 0) + 1; });
    });
    batchCandidates.forEach(function (candidate) {
      var h = candidate.exact[0];
      if (candidate.exact.length === 1 && batchReverse[String(h.id)] === 1) batchLinks[candidate.index] = acceptedByHf[String(h.id)];
      else if (candidate.near.length) ambiguousBatch[candidate.index] = true;
    });
    var consumedHf = {}, importedQc = {};
    quality.forEach(function (q, i) {
      if (q.autoFromCount === true || q.autoFromCount === 1 || q.autoFromCount === 'true') {
        info.catatan.push(label + ': catatan QC otomatis dari hitungan diabaikan; tetap menunggu inspeksi.'); return;
      }
      if (q.payrollCancelled) problem('QC dibatalkan untuk upah tetapi masih tersimpan.');
      uniqueAcrossCycles('qc', q);
      var linked = q.hfId != null && q.hfId !== '' ? acceptedByHf[String(q.hfId)] : countByQc[String(q.id)] || batchLinks[i];
      var standalone = !linked && Number(q.workflowVersion) !== 2 && !(q.hfId != null && q.hfId !== '') && q.id != null && q.id !== '';
      /* A manual pre-v2 inspection is independent evidence. An explicit missing
         reference, or an ambiguous batch candidate, is never reclassified as manual. */
      if (standalone && ambiguousBatch[i]) problem('QC batch ' + q.id + ' tidak mempunyai tautan hitung fisik yang pasti.');
      if (!linked && !standalone) problem('QC ' + (q.id || q.tanggal || i) + ' tidak mempunyai tautan hitung fisik yang pasti.');
      if (linked && consumedHf[linked.record.id]) problem('Satu hitungan memiliki lebih dari satu QC.');
      if (q.hfId && countByQc[String(q.id)] && countByQc[String(q.id)] !== linked) problem('Tautan dua arah QC dan hitungan tidak cocok.');
      var sid = linked ? linked.record.id : '', wid = worker(q);
      if (linked && wid !== linked.record.maklonId) problem('Tukang pada QC dan hitungan tidak cocok.');
      var ok = pcs(q.ok, 'QC OK'), off = pcs(q.offline, 'QC offline'), rej = pcs(q.reject, 'QC reject'), repair = pcs(q.perbaikan != null ? q.perbaikan : q.kotor, 'QC perbaikan');
      if (linked && ok + off + rej + repair !== linked.record.total) problem('Jumlah seluruh kategori QC harus tepat hitungan asal.');
      if (!coreTglOk(q.tanggal) || linked && q.tanggal < linked.record.tanggal) problem('Tanggal QC mendahului atau tidak sesuai hitungan.');
      var workflowVersion = Number(q.workflowVersion) === 2 ? 2 : 1;
      var rate = workflowVersion === 2 && linked ? linked.record.upah : sourceRate(q, wid, ok + repair > 0, linked && linked.source);
      var repairMoves = stock.filter(function (g) { return String(g.qcId || '') === String(q.id || '') && String(g.status || '').toLowerCase() === 'ok' &&
        (g.payrollStage === 'repair' || (g.payrollStage !== 'initial' && g.tanggal !== q.tanggal)); });
      var repaired = 0;
      repairMoves.forEach(function (g) {
        var qty = pcs(g.jumlah, 'hasil perbaikan'); repaired += qty;
        if (!coreTglOk(g.tanggal) || g.tanggal < q.tanggal) problem('Tanggal hasil perbaikan tidak valid.');
      });
      if (repaired > ok) problem('Hasil perbaikan melebihi QC OK.');
      var qid = gen('qc', key + '|qc|' + identity(q, i));
      pushSource('QC', { id: qid, poId: po.id, userId: '', maklonId: wid, tanggal: q.tanggal, ukuran: uk(ok - repaired), total: ok - repaired,
        offline: off, offlineUkuran: uk(off), perbaikan: repair + repaired, perbaikanUkuran: uk(repair + repaired), reject: rej, rejectUkuran: uk(rej),
        catatan: q.keterangan || '', dibuat: iso(q.inputAt, q.tanggal), setorId: sid, repairQcId: '', asal: 'lama', workflowVersion: workflowVersion,
        upah: rate, autoFromCount: false }, 'qc', q, i);
      repairMoves.forEach(function (g, j) {
        var qty = pcs(g.jumlah, 'hasil perbaikan'); if (!qty) return;
        uniqueAcrossCycles('gudang', g);
        pushSource('QC', { id: gen('qc', key + '|repair|' + identity(q, i) + '|' + identity(g, j)), poId: po.id, userId: '', maklonId: wid,
          tanggal: g.tanggal, ukuran: uk(qty), total: qty, offline: 0, offlineUkuran: {}, perbaikan: -qty, perbaikanUkuran: uk(-qty),
          reject: 0, rejectUkuran: {}, catatan: 'Perbaikan selesai; sumber gudang ' + (g.id || ''), dibuat: iso(g.inputAt, g.tanggal), setorId: sid, repairQcId: qid, asal: 'lama',
          workflowVersion: workflowVersion, upah: rate, autoFromCount: false }, 'qc', q, i);
        var repairProvenance = coreParseJSON(rows.QC[rows.QC.length - 1].imporSumber, {});
        repairProvenance.gudangId = String(g.id || ''); rows.QC[rows.QC.length - 1].imporSumber = JSON.stringify(repairProvenance);
        info.lineage[info.lineage.length - 1].source = repairProvenance;
      });
      if (sid) consumedHf[sid] = true; importedQc[String(q.id)] = qid;
    });
    counts.forEach(function (h) {
      if (h.qcId && !importedQc[String(h.qcId)] && !quality.some(function (q) { return String(q.id) === String(h.qcId) && q.autoFromCount; }))
        problem('Hitungan menunjuk QC yang hilang.');
    });
    stock.forEach(function (g, i) {
      var amount = pcs(g.jumlah, 'gudang'); if (!amount) return;
      if (g.qcId != null && g.qcId !== '') {
        if (!importedQc[String(g.qcId)]) problem('Gudang lama menunjuk QC yang hilang; perlu direkonsiliasi.');
        return; // Linked warehouse rows are mirrors of the actual QC/repair evidence.
      }
      if (g.payrollCancelled) problem('Gudang lama dibatalkan untuk upah tetapi masih tersimpan.');
      if (g.id == null || g.id === '') problem('Gudang lama perlu ID tetap.');
      if (!coreTglOk(g.tanggal)) problem('Tanggal gudang lama tidak valid.');
      uniqueAcrossCycles('gudang', g);
      var status = String(g.status || '').trim().toLowerCase(), wid = worker(g);
      if (status === 'kotor') status = 'perbaikan';
      if (['ok', 'offline', 'reject', 'perbaikan'].indexOf(status) < 0) problem('Kategori gudang lama belum pasti.');
      pushSource('GudangLama', { id: gen('gl', key + '|gudang|' + identity(g, i)), poId: po.id, maklonId: wid, tanggal: g.tanggal,
        ukuran: uk(amount), total: amount, status: status, upah: sourceRate(g, wid, status === 'ok'), qcId: '', workflowVersion: 1 }, 'gudang', g, i);
    });
    active('bsInputs').forEach(function (e, i) {
      var n = pcs(e.qty, 'BigSeller'); if (!n) return;
      pushSource('Gudang', { id: gen('gd', key + '|bigseller|' + identity(e, i)), poId: po.id, userId: '', tanggal: e.tanggal || '',
        ukuran: uk(n), total: n, catatan: 'Input BigSeller dari data lama', dibuat: iso(e.at, e.tanggal), asal: 'lama', workflowVersion: 1 }, 'bsInputs', e, i);
    });
    /* Archive/BigSeller flags are labels, never inspection or stock evidence. */
    po.total = coreSumSizes(po.ukuran);
    var d = firstDate(c) || c.tanggalArsip || stamp;
    po.dibuat = d + 'T00:00:00.000Z'; po.diubah = po.dibuat;
    if (po._img && typeof po._img === 'string') imageList.push({ id: po.id, jenis: 'po', dataUrl: po._img });
    delete po._img;
    rows.PO.push(po);
  }
  function retainReview(it, c, archive, aliases, error) {
    info.requiresReview = true;
    info.review.push({ skuId: String(it.id || ''), ukuran: up(it.size), siklus: cycleIdentity(c, archive), aliases: aliases || [],
      cause: String(error && error.message || error), source: c });
  }
  function attemptCycle(it, candidate) {
    var lengths = {}, beforeUsed = {}, beforeKeys = {}, beforeLineage = info.lineage.length, beforeNotes = info.catatan.length, beforeImages = imageList.length;
    Object.keys(rows).forEach(function (table) { lengths[table] = rows[table].length; });
    Object.keys(used).forEach(function (id) { beforeUsed[id] = used[id]; });
    Object.keys(sourceKeys).forEach(function (id) { beforeKeys[id] = sourceKeys[id]; });
    try { addCycle(it, candidate.c, candidate.tag, candidate.archive, candidate.aliases); }
    catch (error) {
      if (!options.preserveReview) throw error;
      Object.keys(rows).forEach(function (table) { rows[table].length = lengths[table]; });
      used = beforeUsed; sourceKeys = beforeKeys; info.lineage.length = beforeLineage; info.catatan.length = beforeNotes; imageList.length = beforeImages;
      retainReview(it, candidate.c, candidate.archive, candidate.aliases, error);
    }
  }
  items.forEach(function (it) {
    if (!it || !it.namaBarang || stopped(it)) return;
    var candidates = [], cycleIds = {}, evidence = {}, conflictingCycles = {};
    if (it.poAktif || hasData(it)) candidates.push({ c: it, tag: 'cur', archive: false, aliases: [] });
    arr(it.arsip).forEach(function (c, i) { if (hasData(c)) candidates.push({ c: c, tag: 'a' + i, archive: true, aliases: [] }); });
    /* Full snapshots with exactly the same evidence are archive mirrors. Shared
       subsets do not establish cycle ownership and stay subject to strict checks. */
    candidates.sort(function (a, b) {
      if (a.archive !== b.archive) return a.archive ? 1 : -1;
      var x = cycleIdentity(a.c, a.archive), y = cycleIdentity(b.c, b.archive); return x < y ? -1 : x > y ? 1 : 0;
    });
    var selected = [];
    candidates.forEach(function (candidate) {
      var cid = cycleIdentity(candidate.c, candidate.archive), content = canonical(candidate.c);
      if (cycleIds[cid] && cycleIds[cid] !== content) {
        var error = new Error('Identitas siklus yang sama memuat riwayat berbeda.');
        if (!options.preserveReview) throw error;
        conflictingCycles[cid] = error; retainReview(it, candidate.c, candidate.archive, [], error); return;
      }
      cycleIds[cid] = content;
      var body = {}; KEYS.concat(['bayarJahit']).forEach(function (field) { body[field] = arr(candidate.c[field]).map(canonical).sort(); });
      var signature = canonical(body), previous = evidence[signature];
      if (previous) { previous.aliases.push({ siklus: cid, arsip: candidate.archive, label: candidate.c.label || '' }); info.duplikat++; return; }
      evidence[signature] = candidate; selected.push(candidate);
    });
    var entryOwners = {};
    selected.forEach(function (candidate) {
      KEYS.forEach(function (field) {
        arr(candidate.c[field]).forEach(function (entry) {
          if (entry.id == null || entry.id === '' || stopped(entry)) return;
          var entryKey = field + '|' + entry.id, other = entryOwners[entryKey];
          if (other && other !== candidate) {
            var error = new Error('Catatan ' + field + ' ' + entry.id + ' muncul dalam beberapa siklus dengan bukti yang tidak identik; kepemilikan siklus perlu diperiksa.');
            if (!options.preserveReview) throw error;
            conflictingCycles[cycleIdentity(other.c, other.archive)] = error;
            conflictingCycles[cycleIdentity(candidate.c, candidate.archive)] = error;
          } else entryOwners[entryKey] = candidate;
        });
      });
    });
    selected.forEach(function (candidate) {
      var error = conflictingCycles[cycleIdentity(candidate.c, candidate.archive)];
      if (error) retainReview(it, candidate.c, candidate.archive, candidate.aliases, error);
      else attemptCycle(it, candidate);
    });
  });

  /* Completion follows the same evidence as normal work, including archived cycles. */
  var importedFlow = coreWorkflow(rows.PO, rows.Potong, rows.SlipKirim, rows.SlipSetor, rows.QC, rows.Gudang, { gudangLama: rows.GudangLama });
  var invalidPo = {};
  rows.PO.forEach(function (po) {
    var flow = importedFlow[po.id];
    var problems = flow ? flow.issues.slice() : [];
    if (flow) Object.keys(flow.ukuran).forEach(function (size) { problems = problems.concat(flow.ukuran[size].issues || []); });
    if (problems.length) {
      var origin = coreMap(po.imporSumber);
      var error = new Error('Impor belum dijalankan: ' + po.series + ' / ' + po.nama + ' / ' + (origin.ukuran || '') + ' / ' + (origin.arsip ? 'arsip' : 'aktif') + '. ' + Array.from(new Set(problems)).join(' ') + ' Periksa hubungan potong, penugasan, hitungan, QC, dan BigSeller pada sumber dahulu.');
      if (!options.preserveReview) throw error;
      invalidPo[po.id] = true; var original = cycleSources[po.id];
      info.requiresReview = true; info.review.push({ skuId: original.skuId, ukuran: original.ukuran, siklus: original.siklus, aliases: original.aliases, cause: error.message, source: original.source });
      return;
    }
    if (flow && flow.complete) {
      po.status = 'selesai';
      po.selesaiPada = rows.QC.filter(function (q) { return q.poId === po.id; }).reduce(function (date, q) { return q.tanggal > date ? q.tanggal : date; }, '');
    }
  });
  if (Object.keys(invalidPo).length) {
    Object.keys(rows).forEach(function (table) { rows[table] = rows[table].filter(function (row) { return !invalidPo[table === 'PO' ? row.id : row.poId]; }); });
    info.lineage = info.lineage.filter(function (record) { return !invalidPo[record.poId]; });
    imageList = imageList.filter(function (record) { return !invalidPo[record.id]; });
  }

  /* ---------- stok bahan: pembelian, koreksi, batas peringatan ---------- */
  var pengaturan = null;
  var stokSrc = (root.stokBahan && typeof root.stokBahan === 'object') ? root.stokBahan : null;
  if (stokSrc) {
    var rolInfo = (stokSrc.rolInfo && typeof stokSrc.rolInfo === 'object') ? stokSrc.rolInfo : {};
    var satuanDari = function (nama) {
      var x = rolInfo[String(nama || '').trim().toLowerCase().replace(/[\/\.#\$\[\]]/g, '-')];
      var u = (x && !(x instanceof Array)) ? x.unit : '';
      return SATUAN_BAHAN.indexOf(u) >= 0 ? u : 'kg';
    };
    arr(stokSrc.pembelian).forEach(function (b, i) {
      var nama = String(b.jenisBahan || '').trim(); var qty = coreNum(b.kg); if (!nama || !(qty > 0)) return;
      rows.StokBahan.push({ id: claim(b.id) || gen('sb', 'b|' + i + '|' + nama + '|' + (b.tanggal || '')), jenis: 'beli', tanggal: b.tanggal || '', bahan: nama, qty: qty, satuan: satuanDari(nama), rol: 1,
        harga: coreNum(b.hargaPerKg), total: coreNum(b.total), supplier: String(b.supplier || ''), invoice: String(b.invoice || ''), sumber: String(b.sumberBon || ''), alasan: '',
        catatan: String(b.ket || ''), dibuatOleh: '', dibuat: iso('', b.tanggal) });
    });
    arr(stokSrc.adjustment).forEach(function (a, i) {
      var nama = String(a.jenisBahan || '').trim(); var qty = coreNum(a.kg); if (!nama || !qty) return;
      rows.StokBahan.push({ id: claim(a.id) || gen('sb', 'k|' + i + '|' + nama + '|' + (a.tanggal || '')), jenis: 'koreksi', tanggal: a.tanggal || '', bahan: nama, qty: qty, satuan: satuanDari(nama), rol: 0,
        harga: 0, total: 0, supplier: '', invoice: '', sumber: '', alasan: ALASAN_KOREKSI[a.alasan] ? a.alasan : 'lain', catatan: String(a.ket || ''), dibuatOleh: '', dibuat: iso('', a.tanggal) });
    });
    var ss = (stokSrc.settings && typeof stokSrc.settings === 'object') ? stokSrc.settings : {};
    var batas = function (v, bawaan) { var n = Number(v); return (v !== null && v !== undefined && String(v).trim() !== '' && isFinite(n) && n >= 0) ? n : bawaan; };
    pengaturan = { stokKuning: batas(ss.warnThreshold, 5), stokMerah: batas(ss.dangerThreshold, 1), stokMulai: coreTglOk(ss.resetDate), bahanSembunyi: daftar(ss.hiddenBahan).map(function (x) { return String(x); }) };
    if (pengaturan.stokMerah > pengaturan.stokKuning) pengaturan.stokMerah = pengaturan.stokKuning;
    var nRol = 0; for (var rk in rolInfo) { var ri = rolInfo[rk]; nRol += ((ri && ri.rols) || (ri instanceof Array ? ri : [])).length || 0; }
    if (nRol) info.catatan.push('Rincian berat tiap rol (' + nRol + ' rol) belum ikut dipindahkan. Saldo bahan tetap dihitung dari pembelian, pemakaian, dan koreksi.');
  }

  /* ---------- gaji harian: karyawan, catatan per hari, kasbon ---------- */
  var gajiSrc = (root.gajiHarian && typeof root.gajiHarian === 'object') ? root.gajiHarian : null;
  var kar = {};
  function regKar(id, nama, sumber) {
    id = String(id || ''); if (!id) return '';
    if (!kar[id]) {
      used[id] = 1;
      kar[id] = { id: id, nama: coreTitle(nama) || 'Karyawan', jabatan: String((sumber && sumber.jabatan) || ''), gajiHarian: coreNum(sumber && sumber.gajiHarianDefault), lembur: coreNum(sumber && sumber.tarifLemburPerJam),
        lemburSabtu: coreNum(sumber && sumber.tarifLemburSabtuPerJam), aktif: !!sumber, dibuat: '' };
      rows.Karyawan.push(kar[id]);
    }
    return id;
  }
  function kasbonRows(list, jenis, idField, namaField) {
    arr(list).forEach(function (kb, i) {
      var orangId = String(kb[idField] || ''); var jumlah = Math.round(coreNum(kb.jumlah)); if (!orangId || !(jumlah > 0)) return;
      if (jenis === 'harian') regKar(orangId, kb[namaField], null);
      var kid = claim(kb.id) || gen('kb', jenis + '|' + i + '|' + orangId + '|' + (kb.tanggal || ''));
      var nama = jenis === 'harian' ? kar[orangId].nama : ((peg[orangId] && peg[orangId].nama) || coreTitle(kb[namaField]) || '');
      rows.Kasbon.push({ id: kid, tipe: 'kasbon', kasbonId: '', jenis: jenis, orangId: orangId, nama: nama, tanggal: kb.tanggal || '', periode: '', jumlah: jumlah,
        keterangan: String(kb.keterangan || ''), dibuatOleh: '', dibuat: iso(kb.createdAt, kb.tanggal) });
      var dicicil = 0; var akhir = kb.tanggal || '';
      arr(kb.cicilan).forEach(function (c, j) {
        var n = Math.round(coreNum(c.jumlah)); if (!(n > 0)) return;
        dicicil += n; if (c.tanggal && c.tanggal > akhir) akhir = c.tanggal;
        rows.Kasbon.push({ id: claim(c.id) || gen('kc', kid + '|' + j), tipe: 'cicilan', kasbonId: kid, jenis: jenis, orangId: orangId, nama: nama, tanggal: c.tanggal || '',
          periode: String(c.mingguId || '') || coreMingguId(c.tanggal || ''), jumlah: n, keterangan: String(c.ket || ''), dibuatOleh: '', dibuat: iso(c.createdAt, c.tanggal) });
      });
      /* sisa yang tercatat di aplikasi lama dipertahankan: selisihnya (mis. pelunasan tanpa catatan cicilan)
         masuk sebagai satu baris penyesuaian yang tidak ikut dipotong di slip mana pun */
      var sisaLama = (typeof kb.sisa === 'number') ? Math.max(0, Math.round(kb.sisa)) : (String(kb.status || '') === 'lunas' ? 0 : null);
      if (sisaLama !== null) {
        var selisih = (jumlah - dicicil) - sisaLama;
        if (selisih > 0) rows.Kasbon.push({ id: gen('kc', kid + '|sesuai'), tipe: 'cicilan', kasbonId: kid, jenis: jenis, orangId: orangId, nama: nama, tanggal: String(kb.lunasAt || '').slice(0, 10) || akhir,
          periode: 'penyesuaian', jumlah: selisih, keterangan: 'Penyesuaian sisa dari aplikasi lama', dibuatOleh: '', dibuat: iso(kb.createdAt, akhir) });
        else if (selisih < 0) info.catatan.push('Kasbon ' + nama + ' tanggal ' + (kb.tanggal || '-') + ': sisa di aplikasi lama lebih besar dari hitungan cicilannya. Periksa kasbon ini.');
      }
    });
  }
  if (gajiSrc) {
    arr(gajiSrc.karyawan).forEach(function (k) { regKar(k.id, k.nama, k); });
    arr(gajiSrc.entries).forEach(function (e, i) {
      var kid = regKar(e.karyawanId, e.karyawanNama, null); var tg = coreTglOk(e.tanggal); if (!kid || !tg) return;
      var status = STATUS_HARI[e.hariStatus] !== undefined ? e.hariStatus : (coreNum(e.gajiHari) > 0 ? 'full' : 'off');
      var periode = corePeriode(e.mingguId) ? String(e.mingguId) : coreMingguId(tg);
      var gaji = coreNum(e.gajiHari), lt = coreNum(e.lemburTotal), st = coreNum(e.lemburSabtuTotal);
      rows.GajiHarian.push({ id: claim(e.id) || gen('gh', 'e|' + i + '|' + kid + '|' + tg), periode: periode, karyawanId: kid, tanggal: tg, status: status, gaji: gaji,
        lemburJam: coreNum(e.lemburJam), lemburTarif: coreNum(e.lemburTarif), lemburTotal: lt, sabtuJam: coreNum(e.lemburSabtuJam), sabtuTarif: coreNum(e.lemburSabtuTarif), sabtuTotal: st,
        jumlah: (typeof e.jumlah === 'number' && isFinite(e.jumlah)) ? e.jumlah : gaji + lt + st, lunas: !!e.dibayar, dibuat: iso(e.createdAt, tg) });
    });
    kasbonRows(gajiSrc.kasbon, 'harian', 'karyawanId', 'karyawanNama');
  }
  kasbonRows(meta.kasbonJahit, 'maklon', 'tukangId', 'tukangNama');
  rows.Kasbon = rows.Kasbon.filter(function (k) { return k.jenis === 'harian' || peg[k.orangId]; });

  function numberRows(list, prefix, field, dateField) {
    list.sort(function (a, b) { var x = String(a[dateField] || ''), y = String(b[dateField] || ''); return x < y ? -1 : x > y ? 1 : (a.id < b.id ? -1 : 1); });
    var counters = {};
    list.forEach(function (r) {
      var m = String(r[dateField] || '').match(/^(\d{4})-(\d{2})/); var ym = m ? m[1].slice(2) + m[2] : '0000';
      counters[ym] = (counters[ym] || 0) + 1;
      r[field] = prefix + '-' + ym + '-' + corePad(counters[ym], 3);
    });
  }
  numberRows(rows.PO, 'PO', 'noPO', 'dibuat');
  numberRows(rows.SlipKirim, 'SK', 'noSlip', 'tanggal');
  numberRows(rows.SlipSetor.filter(function (r) { return r.status === 'diterima'; }), 'SS', 'noSlip', 'tanggal');
  for (var pid in peg) rows.Pegawai.push(peg[pid]);
  var ukuran = coreSizeOrder(Object.keys(sizeSet));
  info.adaStok = !!stokSrc; info.adaGaji = !!gajiSrc; info.adaKasbon = !!(gajiSrc || meta.kasbonJahit);
  return { rows: rows, images: imageList, ukuran: ukuran.length ? ukuran : DEFAULT_SETTINGS.ukuran.slice(), pengaturan: pengaturan, info: info };
}


