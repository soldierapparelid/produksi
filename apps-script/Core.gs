// Dibuat oleh scripts/build-core.cjs dari modul logika dalam src/.
// Jangan edit output ini; lihat README untuk memperbarui project Apps Script yang sudah ada.
// Berisi logika murni saja, bukan adaptor Google Sheets atau endpoint web app.

/* ============================================================
   CORE — logika utama aplikasi produksi.
   Dipakai di dua tempat dengan kode yang sama:
   1. Server Google Apps Script (data di Google Sheets)
   2. Browser, untuk mode coba (data di perangkat)
   Tidak memakai API browser maupun API Apps Script.

   Alur: PO -> Potong -> Penugasan jahit -> Setor jahit -> Cek/terima
         -> QC -> Siap jual (input BigSeller) -> Slip upah

   Prinsip anti-tabrakan:
   - Setiap input adalah BARIS BARU. Tidak ada yang menimpa data orang lain.
   - Semua angka progres DIHITUNG dari baris-baris itu, tidak pernah disimpan.
   - Semua penulisan lewat satu kunci (lock) di server, satu per satu.
   - Setiap baris punya id dari perangkat pengirim, jadi kirim ulang tidak dobel.
   ============================================================ */

var APP_VERSION = '1.4.1';
var WORKFLOW_VERSION = 2;

/* Kolom baru selalu ditambahkan di AKHIR daftar: sheet lama mendapat kolom baru di sebelah kanan, isi lama tidak bergeser.
   Kolom "asal" berisi 'lama' untuk baris yang datang dari impor aplikasi lama; baris yang dibuat di aplikasi ini kosong. */
var SCHEMA = {
  Pegawai:   ['id','nama','divisi','pin','token','gagal','kunci','hp','catatan','aktif','dibuat'],
  Produk:    ['id','nama','series','gambar','tarifPotong','tarifJahit','catatan','aktif','dibuat'],
  PO:        ['id','noPO','jenis','produkId','nama','series','pelanggan','deadline','ukuran','total','bahan','catatan','gambar','status','dibuat','dibuatOleh','diubah','selesaiPada','asal','imporVersion','imporReview','imporSumber'],
  Potong:    ['id','poId','userId','tanggal','ukuran','total','bahan','kg','rol','tarif','upahId','catatan','dibuat','bahanList','asal'],
  SlipKirim: ['id','noSlip','poId','maklonId','tanggal','target','ukuran','total','upah','catatan','dibuatOleh','dibuat','asal'],
  SlipSetor: ['id','noSlip','poId','maklonId','tanggal','ukuran','total','reject','upah','catatan','status','dibuatOleh','dibuat','diprosesOleh','diprosesPada','upahId','asal','rejectUkuran','workflowVersion','imporSumber'],
  QC:        ['id','poId','userId','maklonId','tanggal','ukuran','total','offline','perbaikan','reject','catatan','dibuat','setorId','asal','offlineUkuran','perbaikanUkuran','rejectUkuran','repairQcId','workflowVersion','imporSumber','upah','autoFromCount','upahId'],
  Gudang:    ['id','poId','userId','tanggal','ukuran','total','catatan','dibuat','asal','workflowVersion','imporSumber'],
  GudangLama:['id','poId','maklonId','tanggal','ukuran','total','status','upah','qcId','workflowVersion','imporSumber','upahId'],
  SlipUpah:  ['id','noSlip','pegawaiId','jenis','tanggal','itemIds','totalQty','totalUpah','potongan','dibayar','catatan','dibuatOleh','dibuat','items'],
  LegacySettlement:['id','batchId','sourceId','poId','maklonId','size','paymentRef','sourceSnapshot','poSnapshot','imporSumber','baselineSources','resolution','allocations','reason'],
  MigrasiJournal:['id','batchId','sheet','rowId','before','status','beforeHash','planHash','createdAt'],
  KoreksiRiwayat:['id','poId','sheet','rowId','sourceHash','sourceSnapshot','before','after','previousCorrectionId','reason','createdAt','createdBy'],
  Gambar:    ['id','data','diubah'],
  /* stok bahan: satu baris per pembelian (jenis 'beli') atau koreksi stok (jenis 'koreksi', qty boleh minus) */
  StokBahan: ['id','jenis','tanggal','bahan','qty','satuan','rol','harga','total','supplier','invoice','sumber','alasan','catatan','dibuatOleh','dibuat','asal'],
  /* karyawan harian (bukan akun login) dan catatan gaji per orang per hari */
  Karyawan:  ['id','nama','jabatan','gajiHarian','lembur','lemburSabtu','aktif','dibuat','asal'],
  GajiHarian:['id','periode','karyawanId','tanggal','status','gaji','lemburJam','lemburTarif','lemburTotal','sabtuJam','sabtuTarif','sabtuTotal','jumlah','lunas','dibuat','asal'],
  /* kasbon dan cicilannya dalam satu tabel: tipe 'kasbon' atau 'cicilan' (cicilan menunjuk kasbonId) */
  Kasbon:    ['id','tipe','kasbonId','jenis','orangId','nama','tanggal','periode','jumlah','keterangan','dibuatOleh','dibuat','asal'],
  Pengaturan:['key','value']
};

var TYPES = {
  imporVersion: 'num', workflowVersion: 'num', autoFromCount: 'bool',
  total: 'num', reject: 'num', perbaikan: 'num', offline: 'num', upah: 'num', tarif: 'num', kg: 'num', rol: 'num',
  tarifPotong: 'num', tarifJahit: 'num', totalQty: 'num', totalUpah: 'num', potongan: 'num', dibayar: 'num', gagal: 'num',
  qty: 'num', harga: 'num', gajiHarian: 'num', lembur: 'num', lemburSabtu: 'num', gaji: 'num', lemburJam: 'num', lemburTarif: 'num',
  lemburTotal: 'num', sabtuJam: 'num', sabtuTarif: 'num', sabtuTotal: 'num', jumlah: 'num',
  aktif: 'bool', lunas: 'bool'
};

/* tabel yang boleh diisi ulang dari aplikasi lama (lihat aksi gantiImpor) */
var SHEET_IMPOR = ['PO', 'Potong', 'SlipKirim', 'SlipSetor', 'QC', 'Gudang', 'GudangLama', 'StokBahan', 'Karyawan', 'GajiHarian', 'Kasbon'];
var SATUAN_BAHAN = ['kg', 'yard', 'meter'];
var STATUS_HARI = { full: 1, half: 0.5, absent: 0, off: 0 };
/* alasan koreksi stok: kata-katanya sama dengan aplikasi lama */
var ALASAN_KOREKSI = { stok_opname: 'Stok opname (cocokkan fisik)', sudah_dipakai: 'Sudah dipakai, belum tercatat di Potong', rusak: 'Rusak / basah / cacat', hilang: 'Hilang / tidak ketemu',
  sisa_fisik: 'Sisa fisik tambahan', temuan: 'Penemuan', koreksi: 'Koreksi salah input', stok_awal: 'Stok awal', lain: 'Lain-lain' };

var DIVISI = {
  owner:  { label: 'Owner',         admin: true },
  admin:  { label: 'Admin',         admin: true },
  potong: { label: 'Tukang Potong', admin: false },
  jahit:  { label: 'Maklon Jahit',  admin: false },
  qc:     { label: 'QC',            admin: false }
};

var PO_STATUS = ['aktif', 'selesai', 'batal'];
var PO_JENIS = ['stok', 'pesanan'];
var LUNAS_LAMA = 'LAMA';          /* penanda upah data lama yang dianggap sudah lunas */
var MAX_GAMBAR = 48000;           /* batas panjang data gambar (batas sel Google Sheets 50.000) */
var MAX_SESI = 6;                 /* satu orang boleh login di beberapa perangkat sekaligus */
var MAX_GAGAL = 5;                /* salah PIN berturut-turut sebelum dikunci */
var MENIT_KUNCI = 15;
var HARI_ARSIP = 60;              /* PO selesai lebih lama dari ini tidak ikut dikirim ke perangkat kecuali diminta */

var DEFAULT_SETTINGS = {
  namaUsaha: 'Soldier',
  alamat: '',
  ukuran: ['S', 'M', 'L', 'XL', 'XXL'],
  upahPotong: 0,
  upahJahit: 0,
  linkApp: '',
  kopSlip: 'SOLDIER APPAREL',     /* nama di kepala slip cetak */
  kopSub: 'SOLDIERAPPAREL.ID',    /* baris kecil di bawahnya */
  stokKuning: 5,          /* saldo bahan di bawah angka ini: menipis */
  stokMerah: 1,           /* saldo bahan di bawah angka ini: kritis */
  stokMulai: '',          /* pemakaian potong sebelum tanggal ini tidak mengurangi stok (stok pernah dihitung ulang dari nol) */
  bahanSembunyi: []       /* nama bahan yang tidak ditampilkan lagi di daftar stok */
};

/* ---------- util ---------- */
function corePad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
function coreYmd(d) { return d.getFullYear() + '-' + corePad(d.getMonth() + 1, 2) + '-' + corePad(d.getDate(), 2); }
function coreParseJSON(s, fallback) {
  if (s === null || s === undefined || s === '') return fallback;
  if (typeof s === 'object') return s;
  try { var v = JSON.parse(s); return (v === null || v === undefined) ? fallback : v; } catch (e) { return fallback; }
}
function coreNum(v) { var n = Number(v); return isNaN(n) || !isFinite(n) ? 0 : n; }
function coreInt(v) { return Math.round(coreNum(v)); }
function coreSumSizes(obj) { var t = 0; if (obj && typeof obj === 'object') for (var k in obj) t += coreNum(obj[k]); return t; }
function coreCleanSizes(obj) {
  var out = {};
  if (obj && typeof obj === 'object') for (var k in obj) {
    var n = coreInt(obj[k]); var key = String(k).trim().toUpperCase();
    if (n > 0 && key) out[key] = (out[key] || 0) + n;
  }
  return out;
}
function coreIsAdmin(u) { return !!(u && DIVISI[u.divisi] && DIVISI[u.divisi].admin); }
function coreTitle(s) {
  return String(s || '').toLowerCase().replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); }).trim();
}
function coreRibuan(n) {
  var neg = n < 0; var s = Math.round(Math.abs(coreNum(n))).toString(); var out = '';
  while (s.length > 3) { out = '.' + s.slice(-3) + out; s = s.slice(0, -3); }
  return (neg ? '-' : '') + s + out;
}
function coreRupiah(n) { var r = coreRibuan(n); return r.charAt(0) === '-' ? '-Rp ' + r.slice(1) : 'Rp ' + r; }
function coreTgl(s) { if (!s) return '-'; var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1] : String(s); }
function coreHash(s) {
  var h1 = 0x811c9dc5, h2 = 5381; s = String(s);
  for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = (Math.imul(h2, 33) ^ c) >>> 0; }
  return h1.toString(36) + h2.toString(36);
}
function coreSizeOrder(list, pref) {
  var order = (pref || []).concat(['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'XXXXL', 'XXXXXL', '2XL', '3XL', '4XL', '5XL']);
  return list.slice().sort(function (a, b) {
    var ia = order.indexOf(a), ib = order.indexOf(b); if (ia < 0) ia = 999; if (ib < 0) ib = 999;
    return ia - ib || (a < b ? -1 : a > b ? 1 : 0);
  });
}

/* ---------- tanggal & periode mingguan (tanpa zona waktu: semua dihitung dari teks tahun-bulan-tanggal) ---------- */
function coreTglOk(s) { s = String(s || ''); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; }
function coreUtc(ymd) { var m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN; }
function coreYmdUtc(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + corePad(d.getUTCMonth() + 1, 2) + '-' + corePad(d.getUTCDate(), 2); }
function coreTambahHari(ymd, n) { var t = coreUtc(ymd); return isNaN(t) ? '' : coreYmdUtc(t + n * 86400000); }
function coreHariKe(ymd) { var t = coreUtc(ymd); return isNaN(t) ? -1 : new Date(t).getUTCDay(); }       /* 0 = Minggu ... 6 = Sabtu */
/* minggu kerja = Senin sampai Minggu, bernomor seperti kalender ISO: "2026-W41" (sama dengan aplikasi lama) */
function coreMingguId(ymd) {
  var t = coreUtc(ymd); if (isNaN(t)) return '';
  var d = new Date(t); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  var awal = Date.UTC(d.getUTCFullYear(), 0, 1);
  return d.getUTCFullYear() + '-W' + corePad(Math.ceil(((d.getTime() - awal) / 86400000 + 1) / 7), 2);
}
/* periode: "2026-W41" atau rentang bebas "custom-2026-07-15-2026-07-24" -> { start, end, dates[] } */
function corePeriode(id) {
  id = String(id || ''); var start = '', end = '';
  var w = id.match(/^(\d{4})-W(\d{2})$/); var c = id.match(/^custom-(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})$/);
  if (w) {
    var jan4 = Date.UTC(Number(w[1]), 0, 4); var hari = new Date(jan4).getUTCDay() || 7;
    start = coreYmdUtc(jan4 - (hari - 1) * 86400000 + (Number(w[2]) - 1) * 7 * 86400000); end = coreTambahHari(start, 6);
  } else if (c) { start = c[1]; end = c[2]; }
  if (!start || !end || isNaN(coreUtc(start)) || isNaN(coreUtc(end)) || end < start) return null;
  var dates = []; var n = Math.round((coreUtc(end) - coreUtc(start)) / 86400000);
  if (n > 92) return null;
  for (var i = 0; i <= n; i++) dates.push(coreTambahHari(start, i));
  return { id: id, start: start, end: end, dates: dates };
}

/* ---------- stok bahan (dihitung, tidak disimpan) ----------
   saldo = semua pembelian - pemakaian potong (sejak tanggal mulai) + koreksi. Sama dengan aplikasi lama. */
function coreNormBahan(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function coreBahanPotong(r) {
  var list = coreParseJSON(r.bahanList, null);
  if (list instanceof Array && list.length) return list.filter(function (b) { return b && (b.nama || coreNum(b.qty) > 0); }).map(function (b) { return { nama: String(b.nama || ''), qty: coreNum(b.qty) }; });
  return r.bahan ? [{ nama: String(r.bahan), qty: coreNum(r.kg) }] : [];
}
function coreStatusStok(saldo, st) {
  var kuning = coreNum(st && st.stokKuning), merah = coreNum(st && st.stokMerah);
  if (saldo < -0.0005) return 'minus';
  if (saldo <= 0.0005) return 'habis';
  if (saldo <= merah) return 'kritis';
  if (saldo <= kuning) return 'menipis';
  return 'aman';
}
function coreStok(potong, stok, st) {
  var map = {}; var mulai = coreTglOk(st && st.stokMulai);
  function get(nama, prioritas) {
    var k = coreNormBahan(nama); if (!k) return null;
    if (!map[k]) map[k] = { kunci: k, nama: String(nama).trim(), p: 0, satuan: '', satuanTgl: '', beli: 0, pakai: 0, koreksi: 0, rol: 0, nilai: 0, nBeli: 0 };
    if (prioritas > map[k].p) { map[k].p = prioritas; map[k].nama = String(nama).trim(); }
    return map[k];
  }
  (stok || []).forEach(function (r) {
    if (r.jenis === 'beli') {
      var b = get(r.bahan, 3); if (!b) return;
      b.beli += coreNum(r.qty); b.rol += coreNum(r.rol); b.nilai += coreNum(r.total); b.nBeli++;
      if (r.satuan && String(r.tanggal || '') >= b.satuanTgl) { b.satuan = r.satuan; b.satuanTgl = String(r.tanggal || ''); }
    } else if (r.jenis === 'koreksi') {
      var k = get(r.bahan, 2); if (!k) return;
      k.koreksi += coreNum(r.qty); if (!k.satuan && r.satuan) k.satuan = r.satuan;
    }
  });
  (potong || []).forEach(function (r) {
    if (mulai && String(r.tanggal || '') < mulai) return;
    coreBahanPotong(r).forEach(function (x) { var b = get(x.nama, 1); if (b) b.pakai += x.qty; });
  });
  var sembunyi = {}; ((st && st.bahanSembunyi) || []).forEach(function (n) { sembunyi[coreNormBahan(n)] = 1; });
  var out = [];
  for (var key in map) {
    var m = map[key]; var bulat = function (n) { return Math.round(n * 1000) / 1000; };
    var saldo = bulat(m.beli - m.pakai + m.koreksi); var hpp = m.beli > 0 ? m.nilai / m.beli : 0;
    out.push({ kunci: m.kunci, nama: m.nama, satuan: SATUAN_BAHAN.indexOf(m.satuan) >= 0 ? m.satuan : 'kg', beli: bulat(m.beli), pakai: bulat(m.pakai), koreksi: bulat(m.koreksi),
      saldo: saldo, rol: m.rol, nBeli: m.nBeli, hpp: Math.round(hpp), nilai: Math.round(saldo * hpp), status: coreStatusStok(saldo, st), sembunyi: !!sembunyi[m.kunci] });
  }
  out.sort(function (a, b) { return a.nama.toLowerCase() < b.nama.toLowerCase() ? -1 : 1; });
  return out;
}

/* ---------- gaji harian ---------- */
function coreGajiHari(status, gajiHarian) {
  if (status === 'full') return Math.max(0, coreNum(gajiHarian));
  if (status === 'half') return Math.round(Math.max(0, coreNum(gajiHarian)) / 2);
  return 0;
}
/* kasbon: sisa dihitung dari jumlah pinjaman dikurangi semua cicilannya */
function coreKasbon(rows) {
  var list = []; var byId = {};
  (rows || []).forEach(function (r) { if (r.tipe === 'kasbon') { var k = { id: r.id, jenis: r.jenis, orangId: r.orangId, nama: r.nama, tanggal: r.tanggal, jumlah: coreNum(r.jumlah), keterangan: r.keterangan || '', dibuat: r.dibuat || '', cicilan: [], dicicil: 0 }; byId[r.id] = k; list.push(k); } });
  (rows || []).forEach(function (r) { if (r.tipe === 'cicilan' && byId[r.kasbonId]) { byId[r.kasbonId].cicilan.push({ id: r.id, tanggal: r.tanggal, periode: r.periode || '', jumlah: coreNum(r.jumlah), keterangan: r.keterangan || '', dibuat: r.dibuat || '' }); byId[r.kasbonId].dicicil += coreNum(r.jumlah); } });
  list.forEach(function (k) {
    k.cicilan.sort(function (a, b) { return (String(a.tanggal) + String(a.dibuat)) < (String(b.tanggal) + String(b.dibuat)) ? -1 : 1; });
    k.sisa = Math.max(0, k.jumlah - k.dicicil); k.lunas = k.sisa <= 0;
  });
  return list;
}

/* Workflow v2. All helpers accept stored JSON strings or parsed maps; no browser/server APIs.
   coreWorkflow returns a PO-id map. ukuran[size] is the authoritative SKU/cycle gate.
   warehouse is a projection of QC receipts, never a second mutable transaction table.
   corePayroll returns earned rows, including immutable paid allocation and available qty. */
function coreMap(v) { var o = coreParseJSON(v, {}); return o && typeof o === 'object' && !(o instanceof Array) ? o : {}; }
/* Legacy compatibility is explicit migration evidence, never a fallback for missing v2 fields. */
function coreLegacyInfo(row, field) {
  var p = coreMap(row && row.imporSumber);
  return row && Number(row.workflowVersion) === 1 && p.baseline === true && p.skuId && p.siklus && p.entryId && (!field || p.field === field) ? p : null;
}
function coreLegacySameScope(a, b) {
  var x = coreMap(a && a.imporSumber), y = coreMap(b && b.imporSumber);
  return !!(x.baseline === true && y.baseline === true && x.skuId && x.siklus && String(x.skuId) === String(y.skuId) && String(x.siklus) === String(y.siklus) && a.maklonId === b.maklonId && a.poId === b.poId);
}
function coreLegacyQcBlocked(source, qc, size) {
  var p = coreMap(source && source.imporSumber);
  if (!source || [1, 2].indexOf(Number(source.workflowVersion)) < 0 || p.baseline !== true || p.field !== 'hitungFisik' || !p.skuId || !p.siklus || !p.entryId) return false;
  return (qc || []).some(function (q) {
    if (!coreLegacyInfo(q, 'qc') || q.setorId || q.repairQcId || q.autoFromCount || !coreLegacySameScope(source, q)) return false;
    var maps = coreQcMaps(q, null, []);
    return ['ok','offline','perbaikan','reject'].some(function (f) { return coreNum(maps[f][size]) > 0; });
  });
}
function coreLegacySlipItems(receipt, settlements) {
  var ids = coreParseJSON(receipt.itemIds, []), byId = {};
  (settlements || []).forEach(function (r) { if (r.paymentRef === receipt.id) byId[r.sourceId] = r; });
  if (!ids.length || !ids.every(function (id) { return byId[id]; })) return [];
  return ids.map(function (id) { var s = coreMap(byId[id].sourceSnapshot), item = {}; Object.keys(s).forEach(function (k) { item[k] = s[k]; }); item.sourceId = s.id; item.rate = coreNum(receipt.jenis === 'jahit' ? s.upah : s.tarif); return item; });
}
function coreCategory(row, field, scalar, source, issues) {
  var o = coreMap(row[field]), out = {}, sum = 0;
  Object.keys(o).forEach(function (s) { var n = coreNum(o[s]); if ((n !== Math.floor(n) || (n < 0 && scalar !== 'perbaikan')) && issues) issues.push('Jumlah tidak sah pada ' + row.id + '.'); if (n) { out[s] = n; sum += n; } });
  var n = coreNum(row[scalar]);
  if (Object.keys(out).length) {
    if (sum !== n && issues) issues.push('Rincian ' + scalar + ' tidak cocok pada ' + row.id + '.');
    return out;
  }
  if (!n) return out;
  var keys = Object.keys(coreMap(source)).filter(function (s) { return coreNum(coreMap(source)[s]) > 0; });
  if (keys.length === 1) out[keys[0]] = n;
  else if (issues) issues.push('Tinjau ' + row.id + ': ' + scalar + ' belum dirinci per ukuran.');
  return out;
}
function coreQcMaps(q, setor, issues) {
  var basis = setor ? setor.ukuran : q.ukuran;
  return { ok: coreCategory(q, 'ukuran', 'total', basis, issues), offline: coreCategory(q, 'offlineUkuran', 'offline', basis, issues),
    perbaikan: coreCategory(q, 'perbaikanUkuran', 'perbaikan', basis, issues), reject: coreCategory(q, 'rejectUkuran', 'reject', basis, issues) };
}
function coreWorkflow(poRows, potong, kirim, setor, qc, gudang, extras) {
  extras = extras || {};
  if (typeof coreHistoryPhysicalRows === 'function') { potong = coreHistoryPhysicalRows('Potong', potong, extras.historyCorrections); kirim = coreHistoryPhysicalRows('SlipKirim', kirim, extras.historyCorrections); }
  var out = {}, setById = {}, qcById = {}, inspected = {}, repairUsed = {};
  function blank() { return { potong: 0, kirim: 0, diterima: 0, diajukan: 0, rejectJahit: 0, qcOk: 0, qcOffline: 0, qcPerbaikan: 0, qcReject: 0, legacyUnlinkedQC: 0, legacyBlockedCount: 0, legacyWarehouseOK: 0, legacyBigseller: 0, bigseller: 0, maklon: {}, issues: [] }; }
  function size(p, s) { return p.ukuran[s] || (p.ukuran[s] = blank()); }
  function worker(u, id) { return u.maklon[id] || (u.maklon[id] = { kirim: 0, diterima: 0, reject: 0, diajukan: 0 }); }
  function add(p, map, field, who, wf) { Object.keys(map).forEach(function (s) { var u = size(p, s); u[field] += coreNum(map[s]); if (who) worker(u, who)[wf || field] += coreNum(map[s]); }); }
  (poRows || []).forEach(function (r) { var p = out[r.id] = { ukuran: {}, issues: [], warehouse: [], blockedQcSources: {}, legacyWarnings: [], ledgerIssues: [], readyQC: false, complete: false }; Object.keys(coreMap(r.ukuran)).forEach(function (s) { size(p, s); }); if (r.imporReview) p.issues.push(String(r.imporReview)); });
  (potong || []).forEach(function (r) { var p = out[r.poId]; if (p) { if (r.historyCorrectionError) p.issues.push(r.historyCorrectionError); add(p, coreCategory(r, 'ukuran', 'total', r.ukuran, p.issues), 'potong'); } });
  (kirim || []).forEach(function (r) { var p = out[r.poId]; if (p) { if (r.historyCorrectionError) p.issues.push(r.historyCorrectionError); if (!r.maklonId) p.issues.push('Penugasan ' + r.id + ' belum punya pekerja.'); add(p, coreCategory(r, 'ukuran', 'total', r.ukuran, p.issues), 'kirim', r.maklonId); } });
  (setor || []).forEach(function (r) {
    setById[r.id] = r; var p = out[r.poId]; if (!p || r.status === 'ditolak') return;
    var good = coreCategory(r, 'ukuran', 'total', r.ukuran, p.issues), bad = coreCategory(r, 'rejectUkuran', 'reject', r.ukuran, p.issues);
    if (!r.maklonId) p.issues.push('Setoran ' + r.id + ' belum punya pekerja.');
    if (r.status === 'diterima') { add(p, good, 'diterima', r.maklonId); add(p, bad, 'rejectJahit', r.maklonId, 'reject'); }
    else if (r.status === 'diajukan') { add(p, good, 'diajukan', r.maklonId); add(p, bad, 'diajukan', r.maklonId); }
  });
  (qc || []).forEach(function (q) { qcById[q.id] = q; });
  (qc || []).forEach(function (q) {
    var p = out[q.poId]; if (!p) return; var source = setById[q.setorId]; var maps = coreQcMaps(q, source, p.issues);
    var old = !!coreLegacyInfo(q, 'qc') || !!(q.repairQcId && coreLegacyInfo(qcById[q.repairQcId], 'qc'));
    if (old && q.autoFromCount) { p.legacyWarnings.push('Catatan otomatis ' + q.id + ' bukan bukti pemeriksaan QC.'); return; }
    if ((!old || q.setorId) && (!source || source.status !== 'diterima' || source.poId !== q.poId || source.maklonId !== q.maklonId)) p.issues.push('QC ' + q.id + ' belum terhubung ke hitungan asal yang sah.');
    if (!old && source && String(q.tanggal || '') < String(source.tanggal || '')) p.issues.push('Tanggal QC ' + q.id + ' sebelum hitungan asal.');
    var fields = { ok: 'qcOk', offline: 'qcOffline', perbaikan: 'qcPerbaikan', reject: 'qcReject' };
    Object.keys(fields).forEach(function (f) { add(p, maps[f], fields[f]); });
    p.warehouse.push({ id: 'qc:' + q.id, qcId: q.id, setorId: q.setorId || '', poId: q.poId, maklonId: q.maklonId, tanggal: q.tanggal, ukuran: maps.ok, total: coreSumSizes(maps.ok), offlineUkuran: maps.offline, perbaikanUkuran: maps.perbaikan, rejectUkuran: maps.reject, repairQcId: q.repairQcId || '' });
    var all = {}; Object.keys(maps).forEach(function (f) { Object.keys(maps[f]).forEach(function (s) { all[s] = (all[s] || 0) + maps[f][s]; }); });
    if (old && !source && !q.repairQcId) { add(p, all, 'legacyUnlinkedQC'); p.legacyWarnings.push('QC lama ' + q.id + ' disimpan tanpa mengarang hitungan asal.'); }
    if (q.repairQcId) {
      var base = qcById[q.repairQcId]; if (!base || base.repairQcId || base.poId !== q.poId || base.setorId !== q.setorId || base.maklonId !== q.maklonId) p.issues.push('Asal perbaikan ' + q.id + ' tidak sah.');
      if (base && String(q.tanggal || '') < String(base.tanggal || '')) p.issues.push('Tanggal perbaikan ' + q.id + ' sebelum QC asal.');
      var used = repairUsed[q.repairQcId] || (repairUsed[q.repairQcId] = {});
      Object.keys(all).forEach(function (s) { if (all[s] !== 0 || coreNum(maps.perbaikan[s]) >= 0) p.issues.push('Jumlah hasil perbaikan ' + q.id + ' tidak seimbang.'); used[s] = (used[s] || 0) - coreNum(maps.perbaikan[s]); });
    } else {
      var inspectKey = q.setorId || 'legacy:' + q.id;
      var seen = inspected[inspectKey] || (inspected[inspectKey] = {});
      Object.keys(all).forEach(function (s) {
        if (all[s] <= 0 || coreNum(maps.perbaikan[s]) < 0) p.issues.push('Kategori QC ' + q.id + ' tidak sah.');
        seen[s] = (seen[s] || 0) + all[s];
        if (source && (old ? seen[s] > coreNum(coreMap(source.ukuran)[s]) : seen[s] !== coreNum(coreMap(source.ukuran)[s]))) p.issues.push('QC ' + q.id + ' harus mencakup tepat seluruh hitungan ukuran ' + s + '.');
      });
    }
  });
  Object.keys(repairUsed).forEach(function (id) { var q = qcById[id]; if (!q || !out[q.poId]) return; var available = coreQcMaps(q, setById[q.setorId], out[q.poId].issues).perbaikan; Object.keys(repairUsed[id]).forEach(function (s) { if (repairUsed[id][s] > coreNum(available[s])) out[q.poId].issues.push('Hasil perbaikan melebihi sumber ' + id + ', ukuran ' + s + '.'); }); });
  (extras.gudangLama || []).forEach(function (r) {
    var p = out[r.poId]; if (!p) return;
    if (!coreLegacyInfo(r, 'gudang') || r.qcId) { p.issues.push('Gudang lama ' + r.id + ' tidak memiliki bukti sumber mandiri.'); return; }
    var map = coreCategory(r, 'ukuran', 'total', r.ukuran, p.issues), ok = r.status === 'ok';
    if (ok) add(p, map, 'legacyWarehouseOK');
    p.warehouse.push({ id: 'gudanglama:' + r.id, poId: r.poId, maklonId: r.maklonId, tanggal: r.tanggal, ukuran: ok ? map : {}, total: ok ? coreSumSizes(map) : 0, legacy: true, status: r.status, sourceId: r.id });
  });
  (setor || []).forEach(function (s) { var p = out[s.poId]; if (!p || s.status !== 'diterima') return; Object.keys(coreMap(s.ukuran)).forEach(function (key) { if (coreLegacyQcBlocked(s, qc, key)) { (p.blockedQcSources[s.id] || (p.blockedQcSources[s.id] = [])).push(key); size(p, key).legacyBlockedCount += Math.max(0, coreNum(coreMap(s.ukuran)[key]) - coreNum((inspected[s.id] || {})[key])); } }); });
  (gudang || []).forEach(function (r) { var p = out[r.poId]; if (p) { var map = coreCategory(r, 'ukuran', 'total', r.ukuran, p.issues); add(p, map, 'bigseller'); if (coreLegacyInfo(r, 'bsInputs')) add(p, map, 'legacyBigseller'); } });
  Object.keys(out).forEach(function (id) {
    var p = out[id], keys = Object.keys(p.ukuran); p.complete = keys.length > 0;
    keys.forEach(function (s) {
      var u = p.ukuran[s]; u.target = u.potong || u.kirim; u.targetBaik = u.target - u.rejectJahit;
      u.siapKirim = u.target - u.kirim; u.sisaMaklon = u.kirim - u.diterima - u.rejectJahit;
      var strictQcRemaining = u.diterima - u.qcOk - u.qcOffline - u.qcPerbaikan - u.qcReject + u.legacyUnlinkedQC;
      u.siapQC = Math.max(0, strictQcRemaining - u.legacyBlockedCount); u.stokLedger = u.qcOk + u.legacyWarehouseOK - u.bigseller; u.stok = Math.max(0, u.stokLedger);
      if (u.stokLedger < 0 && u.legacyBigseller > 0) p.ledgerIssues.push(s + ': input BigSeller lama melebihi bukti barang OK; periksa pencatatan, jumlah historis tetap disimpan.');
      Object.keys(u.maklon).forEach(function (w) { var m = u.maklon[w]; m.sisa = m.kirim - m.diterima - m.reject; if (m.sisa < 0 || m.diajukan > m.sisa) u.issues.push('Setoran melebihi penugasan pekerja ' + w + '.'); });
      if (u.kirim > u.target || u.diterima + u.rejectJahit > u.target || strictQcRemaining < 0 || u.qcPerbaikan < 0 || (u.stokLedger < 0 && !u.legacyBigseller)) u.issues.push('Jumlah produksi tidak seimbang.');
      u.readyQC = u.targetBaik > 0 && u.diterima === u.targetBaik && u.sisaMaklon === 0 && u.diajukan === 0 && !u.issues.length && !p.issues.length;
      u.complete = u.readyQC && u.siapQC === 0 && u.qcPerbaikan === 0 && !u.legacyUnlinkedQC;
      if (u.readyQC && u.siapQC > 0) p.readyQC = true;
      if (!u.complete) p.complete = false;
    });
    keys.forEach(function (s) { p.ukuran[s].issues.forEach(function (issue) { p.issues.push(s + ': ' + issue); }); });
    if (p.issues.length) { p.readyQC = false; p.complete = false; keys.forEach(function (s) { p.ukuran[s].readyQC = false; p.ukuran[s].complete = false; }); }
  });
  return out;
}
function corePayroll(potong, setor, qc, slipUpah, extras) {
  extras = extras || {};
  var rows = [], bySource = {}, frozen = {}, legacy = {}, marked = {}, setById = {}, qcById = {}, settlementSeen = {}, legacyCount = {}, sourceAliases = {};
  /* An old automatic mirror is not an inspection. If an actual v2 QC is added
     to its explicit HF, retain its payment pool on that same physical source. */
  (qc || []).forEach(function (q) { if (coreLegacyInfo(q, 'qc') && q.autoFromCount && q.setorId && (qc || []).some(function (peer) { return peer.setorId === q.setorId && !peer.repairQcId && !peer.autoFromCount; })) sourceAliases['qc:' + q.id] = q.setorId; });
  function pool(id, size) { return (sourceAliases[id] || id) + '|' + (size || ''); }
  function add(r) { r.earnedId = r.id; r.available = r.total; r.paidQty = 0; r.paid = false; r.upahId = ''; r.issues = r.issues || []; rows.push(r); var key = pool(r.sourceId, r.size); (bySource[key] || (bySource[key] = [])).push(r); }
  function frozenQty(id, size, qty, payId, earnedId) { var key = pool(id, size), f = frozen[key] || (frozen[key] = { total: 0, refs: [], earned: {} }); f.total += coreNum(qty); if (earnedId) f.earned[earnedId] = (f.earned[earnedId] || 0) + coreNum(qty); if (f.refs.indexOf(payId) < 0) f.refs.push(payId); }
  function markedQty(id, size, qty, payId, earnedId) { var key = pool(id, size), m = marked[key] || (marked[key] = { total: 0, refs: [], earned: {} }); m.total += coreNum(qty); m.earned[earnedId] = coreNum(qty); if (m.refs.indexOf(payId) < 0) m.refs.push(payId); }
  (slipUpah || []).forEach(function (u) {
    var items = coreParseJSON(u.items, []);
    if (items.length) items.forEach(function (it) { var id = it.sourceId; if (!id) return; if (it.size || u.jenis === 'potong') frozenQty(id, it.size, it.total, u.id, it.earnedId || it.id); else { var map = coreMap(it.ukuran); Object.keys(map).forEach(function (s) { frozenQty(id, s, map[s], u.id, it.earnedId || it.id); }); } });
    else coreParseJSON(u.itemIds, []).forEach(function (id) { legacy[id] = u.id; });
  });
  (potong || []).forEach(function (s) { if (!s.userId) return; add({ id: 'potong:' + s.id, sourceId: s.id, poId: s.poId, pegawaiId: s.userId, jenis: 'potong', tanggal: s.tanggal, total: coreNum(s.total), rate: coreNum(s.tarif), ref: 'Potong', ukuran: coreMap(s.ukuran) }); if (s.upahId) legacy[s.id] = s.upahId; });
  (qc || []).forEach(function (q) { qcById[q.id] = q; });
  (setor || []).forEach(function (s) {
    setById[s.id] = s; if (s.status !== 'diterima') return;
    if (s.upahId) legacy[s.id] = s.upahId;
    /* A proven old QC owns its linked count, even when its OK quantity is zero.
       It earns on the original QC/movement date and tariff, never as a second HF. */
    if ((qc || []).some(function (q) { return q.setorId === s.id && !q.repairQcId && coreLegacyInfo(q, 'qc') && (!q.autoFromCount || !(qc || []).some(function (peer) { return peer.setorId === s.id && !peer.repairQcId && !peer.autoFromCount; })); })) return;
    var sourceSizes = coreMap(s.ukuran), inspected = {}, ok = {}, issues = [];
    (qc || []).forEach(function (q) { if (q.setorId !== s.id || q.repairQcId || q.autoFromCount && coreLegacyInfo(q, 'qc')) return; var maps = coreQcMaps(q, s, issues); Object.keys(maps).forEach(function (f) { Object.keys(maps[f]).forEach(function (size) { inspected[size] = true; }); }); Object.keys(maps.ok).forEach(function (size) { ok[size] = (ok[size] || 0) + coreNum(maps.ok[size]); }); });
    if (coreSumSizes(sourceSizes) !== coreNum(s.total)) issues.push('Hitungan belum dirinci per ukuran.');
    Object.keys(sourceSizes).forEach(function (size) { var total = inspected[size] ? (ok[size] || 0) : coreNum(sourceSizes[size]); var uk = {}; uk[size] = total;
      add({ id: 'setor:' + s.id + ':' + size, sourceId: s.id, poId: s.poId, pegawaiId: s.maklonId, jenis: 'jahit', tanggal: s.tanggal, total: total, rate: coreNum(s.upah), ref: s.noSlip, ukuran: uk, size: size, inspected: !!inspected[size], issues: issues.slice(), imporSumber: coreMap(s.imporSumber) }); });
  });
  (qc || []).forEach(function (q) {
    var base = q.repairQcId ? qcById[q.repairQcId] : q, old = coreLegacyInfo(base, 'qc'), s = setById[q.setorId];
    if (old && q.autoFromCount && q.setorId && (qc || []).some(function (peer) { return peer.setorId === q.setorId && !peer.repairQcId && !peer.autoFromCount; })) {
      if (q.upahId) Object.keys(coreMap(q.ukuran)).forEach(function (size) { if (s && coreNum(s.upah) === coreNum(q.upah)) markedQty('qc:' + q.id, size, coreNum(coreMap(q.ukuran)[size]), q.upahId, 'qc:' + q.id + ':' + size); else (bySource[pool(q.setorId, size)] || []).forEach(function (r) { r.issues.push('Tarif QC otomatis yang sudah dibayar berbeda dari hitungan asal.'); }); });
      return;
    }
    if (old && (!q.setorId || s && s.status === 'diterima' && s.poId === q.poId && s.maklonId === q.maklonId)) {
      if (!q.repairQcId && s) {
        if (legacy[s.id]) legacy['qc:' + q.id] = legacy[s.id];
        Object.keys(coreMap(s.ukuran)).forEach(function (size) {
          var from = frozen[pool(s.id, size)], key = pool('qc:' + q.id, size); legacyCount[key] = coreNum(coreMap(s.ukuran)[size]);
          if (from) { var target = frozen[key] || (frozen[key] = { total: 0, refs: [], earned: {} }); target.total += from.total; from.refs.forEach(function (ref) { if (target.refs.indexOf(ref) < 0) target.refs.push(ref); }); }
        });
      }
      var issues = [], maps = coreQcMaps(q, s, issues);
      Object.keys(maps.ok).forEach(function (size) { var total = coreNum(maps.ok[size]), uk = {}; if (!(total > 0)) return; uk[size] = total;
        var earnedId = (q.repairQcId ? 'repair:' : 'qc:') + q.id + ':' + size;
        add({ id: earnedId, sourceId: 'qc:' + base.id, qcId: q.id, repairQcId: q.repairQcId || '', poId: q.poId, pegawaiId: q.maklonId, jenis: 'jahit', tanggal: q.tanggal, total: total, rate: coreNum(base.upah), ref: 'QC lama', ukuran: uk, size: size, inspected: !q.autoFromCount, issues: issues.slice(), imporSumber: coreMap(base.imporSumber) });
        if (q.upahId) markedQty('qc:' + base.id, size, total, q.upahId, earnedId);
      });
      return;
    }
    if (!q.repairQcId || !s || s.status !== 'diterima') return; var maps = coreQcMaps(q, s, []); Object.keys(maps.ok).forEach(function (size) { var total = coreNum(maps.ok[size]), uk = {}; if (!(total > 0)) return; uk[size] = total;
      add({ id: 'repair:' + q.id + ':' + size, sourceId: s.id, qcId: q.id, repairQcId: q.repairQcId, poId: s.poId, pegawaiId: s.maklonId, jenis: 'jahit', tanggal: q.tanggal, total: total, rate: coreNum(s.upah), ref: (s.noSlip || '') + ' · perbaikan', ukuran: uk, size: size, imporSumber: coreMap(s.imporSumber) }); });
  });
  (extras.gudangLama || []).forEach(function (g) {
    if (!coreLegacyInfo(g, 'gudang') || g.qcId || g.status !== 'ok') return;
    var issues = [], map = coreCategory(g, 'ukuran', 'total', g.ukuran, issues);
    Object.keys(map).forEach(function (size) { var uk = {}; uk[size] = map[size]; var earnedId = 'gudanglama:' + g.id + ':' + size; add({ id: earnedId, sourceId: 'gudanglama:' + g.id, poId: g.poId, pegawaiId: g.maklonId, jenis: 'jahit', tanggal: g.tanggal, total: map[size], rate: coreNum(g.upah), ref: 'Gudang lama', ukuran: uk, size: size, issues: issues.slice(), imporSumber: coreMap(g.imporSumber) }); if (g.upahId) markedQty('gudanglama:' + g.id, size, map[size], g.upahId, earnedId); });
  });
  /* Frozen bridge credit is confined to the proven baseline allowlist. A hold is
     an unresolved historic payment, not a paid flag and not credit for new work. */
  (extras.settlements || []).forEach(function (b) {
    var basis = coreParseJSON(b.baselineSources, []), allocations = coreParseJSON(b.allocations, []), snapshot = coreMap(b.sourceSnapshot), provenance = coreMap(b.imporSumber);
    var affected = [], allowed = {}, valid = !!(b.id && b.sourceId && !settlementSeen[b.sourceId] && provenance.baseline === true && provenance.field === 'jahit' && provenance.skuId && provenance.siklus && provenance.entryId && snapshot.id === b.sourceId && snapshot.poId === b.poId && snapshot.maklonId === b.maklonId && b.paymentRef && snapshot.upahId === b.paymentRef);
    settlementSeen[b.sourceId] = true;
    basis.forEach(function (entry) {
      var key = pool(entry.sourceId, entry.size), list = bySource[key] || [];
      if (allowed[key]) valid = false; allowed[key] = entry;
      list.forEach(function (r) { var p = r.imporSumber || {}; affected.push(r); if (r.jenis !== 'jahit' || r.poId !== b.poId || r.pegawaiId !== b.maklonId || r.size !== b.size || p.baseline !== true || String(p.skuId) !== String(provenance.skuId) || String(p.siklus) !== String(provenance.siklus) || r.rate !== coreNum(entry.rate) || r.rate !== coreNum(snapshot.upah)) valid = false; });
    });
    var used = {}, paidQty = 0, paidAmount = 0;
    allocations.forEach(function (a) { var key = pool(a.sourceId, a.size), entry = allowed[key], qty = Number(a.qty); if (!entry || !isFinite(qty) || qty < 0 || qty !== Math.floor(qty)) { valid = false; return; } used[key] = (used[key] || 0) + qty; if (used[key] > coreNum(entry.qty)) valid = false; paidQty += qty; paidAmount += qty * coreNum(entry.rate); });
    if (paidQty > coreNum(snapshot.total) || paidAmount > coreNum(snapshot.total) * coreNum(snapshot.upah)) valid = false;
    if (!valid || ['exact', 'full'].indexOf(b.resolution) < 0) {
      affected.forEach(function (r) { r.issues.push('Pembayaran lama perlu dicocokkan: ' + (b.reason || b.sourceId)); r.legacySettlementHold = true; }); return;
    }
    Object.keys(used).forEach(function (key) { var entry = allowed[key]; frozenQty(entry.sourceId, entry.size, used[key], b.paymentRef, ''); });
    affected.forEach(function (r) { r.legacySettlementId = b.id; r.legacyAdvanceQty = Math.max(0, coreNum(snapshot.total) - paidQty); });
  });
  Object.keys(bySource).forEach(function (key) {
    var list = bySource[key].sort(function (a, b) { if (!!a.qcId !== !!b.qcId) return a.qcId ? 1 : -1; return String(a.tanggal).localeCompare(String(b.tanggal)) || a.id.localeCompare(b.id); });
    var id = list[0].sourceId, f = frozen[key], count = legacyCount[key] !== undefined ? legacyCount[key] : setById[id] ? coreNum(coreMap(setById[id].ukuran)[list[0].size]) : list[0].total;
    var marker = marked[key];
    if (marker) {
      f = f || { total: 0, refs: [], earned: {} }; var identified = 0, overlap = 0;
      list.forEach(function (r) { identified += coreNum(f.earned[r.id]); overlap += Math.min(coreNum(f.earned[r.id]), coreNum(marker.earned[r.id])); });
      f.total += Math.max(0, marker.total - overlap - Math.max(0, f.total - identified));
      Object.keys(marker.earned).forEach(function (earnedId) { f.earned[earnedId] = Math.max(coreNum(f.earned[earnedId]), marker.earned[earnedId]); });
      marker.refs.forEach(function (ref) { if (f.refs.indexOf(ref) < 0) f.refs.push(ref); });
    }
    var paid = Math.max(f ? f.total : 0, legacy[id] ? count : 0), eligible = 0; list.forEach(function (r) { eligible += r.total; });
    var remain = paid;
    /* Honor the selected earned receipt first. Only its excess after QC becomes credit for
       other receipts of the SAME source and size. Paying repair before initial count is valid. */
    list.forEach(function (r) { r.paidQty = Math.min(r.total, f ? coreNum(f.earned[r.id]) : 0); remain -= r.paidQty; });
    list.forEach(function (r) { var credit = Math.min(r.total - r.paidQty, remain); r.paidQty += credit; remain -= credit; r.available = r.total - r.paidQty; r.paid = r.available <= 0; r.upahId = f ? f.refs.join(',') : (legacy[id] || ''); r.legacyPaid = !!legacy[id] || !!(marker && marker.earned[r.id]); r.overpaidQty = 0; r.adjustmentRequired = false; if (!(r.rate > 0)) r.issues.push('Tarif hitungan belum diatur.'); r.needsReview = r.issues.length > 0; if (r.issues.length) r.available = 0; });
    if (paid > eligible) { list[0].overpaidQty = paid - eligible; list[0].adjustmentRequired = true; list[0].needsReview = true; }
  });
  return rows;
}

/* ---------- agregasi progres per PO (dihitung, tidak disimpan) ---------- */
function coreAggregate(poRows, potong, kirim, setor, qc, gudang, extras) {
  var flow = coreWorkflow(poRows, potong, kirim, setor, qc, gudang, extras);
  if (typeof coreHistoryPhysicalRows === 'function') { potong = coreHistoryPhysicalRows('Potong', potong, extras && extras.historyCorrections); kirim = coreHistoryPhysicalRows('SlipKirim', kirim, extras && extras.historyCorrections); }
  var FIELDS = ['potong', 'kirim', 'terima', 'diajukan', 'qcOk', 'bigseller'];
  var byPo = {};
  function blankUk() { var o = {}; FIELDS.forEach(function (f) { o[f] = 0; }); return o; }
  function blankTot() { var o = blankUk(); o.reject = 0; o.qcOffline = 0; o.qcPerbaikan = 0; o.qcReject = 0; return o; }
  poRows.forEach(function (p) { byPo[p.id] = { total: blankTot(), ukuran: {}, maklon: {} }; });
  function uk(a, size) { if (!a.ukuran[size]) a.ukuran[size] = blankUk(); return a.ukuran[size]; }
  function addSizes(a, field, sizes, total) {
    a.total[field] += total;
    var s = coreParseJSON(sizes, {}); var sum = 0;
    for (var k in s) { var n = coreNum(s[k]); if (n > 0) { uk(a, k)[field] += n; sum += n; } }
    if (sum < total) uk(a, '?')[field] += total - sum;
  }
  function mk(a, id) { if (!a.maklon[id]) a.maklon[id] = { kirim: 0, terima: 0, reject: 0, diajukan: 0, sisa: 0, target: '' }; return a.maklon[id]; }
  potong.forEach(function (r) { var a = byPo[r.poId]; if (a) addSizes(a, 'potong', r.ukuran, r.total); });
  kirim.forEach(function (r) {
    var a = byPo[r.poId]; if (!a) return;
    addSizes(a, 'kirim', r.ukuran, r.total); var m = mk(a, r.maklonId); m.kirim += r.total;
    if (r.target && (!m.target || r.target > m.target)) m.target = r.target;
  });
  setor.forEach(function (r) {
    var a = byPo[r.poId]; if (!a) return; var m = mk(a, r.maklonId);
    if (r.status === 'diterima') { addSizes(a, 'terima', r.ukuran, r.total); a.total.reject += r.reject; m.terima += r.total; m.reject += r.reject; }
    else if (r.status === 'diajukan') { addSizes(a, 'diajukan', r.ukuran, r.total); m.diajukan += r.total + r.reject; }
  });
  qc.forEach(function (r) {
    var a = byPo[r.poId]; if (!a) return;
    addSizes(a, 'qcOk', r.ukuran, r.total);
    a.total.qcOffline += coreNum(r.offline); a.total.qcReject += coreNum(r.reject); a.total.qcPerbaikan += coreNum(r.perbaikan);
  });
  gudang.forEach(function (r) { var a = byPo[r.poId]; if (a) addSizes(a, 'bigseller', r.ukuran, r.total); });
  for (var id in byPo) {
    var a = byPo[id]; var t = a.total;
    t.siapKirim = t.potong - t.kirim;                                   /* sudah dipotong, belum ditugaskan ke maklon */
    t.sisaMaklon = 0;
    t.siapQC = t.terima - t.qcOk - t.qcOffline - t.qcPerbaikan - t.qcReject; /* sudah diterima, belum di-QC */
    t.stok = t.qcOk - t.bigseller;                                      /* lolos QC, belum diinput ke BigSeller */
    for (var s in a.ukuran) { var u = a.ukuran[s]; u.siapKirim = u.potong - u.kirim; u.sisaMaklon = u.kirim - u.terima - u.diajukan; u.siapQC = u.terima - u.qcOk; u.stok = u.qcOk - u.bigseller; }
    for (var m in a.maklon) { var x = a.maklon[m]; x.sisa = x.kirim - x.terima - x.reject - x.diajukan; t.sisaMaklon += x.sisa; }
  }
  Object.keys(flow).forEach(function (id) { var a = byPo[id]; Object.keys(flow[id].ukuran).forEach(function (s) { var f = flow[id].ukuran[s], u = uk(a, s); u.siapQC = f.siapQC; u.sisaMaklon = f.sisaMaklon - f.diajukan; u.reject = f.rejectJahit; u.qcOffline = f.qcOffline; u.qcPerbaikan = f.qcPerbaikan; u.qcReject = f.qcReject; u.stok = f.stok; }); });
  return byPo;
}

/* ---------- teks slip untuk disalin ke WhatsApp ---------- */
function coreSizeText(ukuran, sizes) {
  var keys = coreSizeOrder(Object.keys(ukuran || {}), sizes); var parts = [];
  keys.forEach(function (k) { if (ukuran[k]) parts.push(k + ' ' + ukuran[k]); });
  return parts.join(' · ');
}
function coreSlipText(type, rec, ctx) {
  var st = ctx.settings || {}; var po = ctx.po || {}; var L = [];
  var uk = coreParseJSON(rec.ukuran, {});
  if (type === 'kirim' || type === 'setor') {
    var belumSlip = type === 'setor' && !rec.noSlip;
    L.push(type === 'kirim' ? '*SLIP PENUGASAN JAHIT*' : (belumSlip ? '*LAPORAN SETOR HASIL JAHIT*' : '*SLIP SETOR HASIL JAHIT*'));
    L.push(belumSlip ? 'Belum dihitung QC, slip belum terbit' : 'No: ' + rec.noSlip);
    L.push('Tanggal: ' + coreTgl(rec.tanggal));
    L.push('Maklon: ' + ((ctx.maklon && ctx.maklon.nama) || '-'));
    L.push('PO: ' + (po.noPO || '-'));
    L.push('Barang: ' + (po.nama || '-') + (po.series ? ' (' + po.series + ')' : ''));
    if (po.pelanggan) L.push('Pelanggan: ' + po.pelanggan);
    var s = coreSizeText(uk, st.ukuran); if (s) L.push('Ukuran: ' + s);
    L.push('Total: *' + coreRibuan(rec.total) + ' pcs*');
    if (type === 'setor' && rec.reject) L.push('Reject: ' + coreRibuan(rec.reject) + ' pcs');
    if (rec.upah && !belumSlip) L.push('Harga: ' + coreRupiah(rec.upah) + '/pcs');
    if (type === 'setor' && !belumSlip) {
      var earned = (ctx.payroll || []).filter(function (r) { return r.sourceId === rec.id; });
      if (earned.length) { var current = 0, unpaid = 0, over = 0; earned.forEach(function (r) { current += r.total * r.rate; unpaid += r.available * r.rate; over += coreNum(r.overpaidQty); }); L.push('Hak upah saat ini: ' + coreRupiah(current)); L.push('Belum dibayar: ' + coreRupiah(unpaid)); if (over) L.push('Perlu tinjau pembayaran: ' + coreRibuan(over) + ' pcs melebihi hak setelah QC.'); }
      else L.push('Nilai hitungan sebelum QC: ' + coreRupiah(rec.total * rec.upah));
    }
    if (type === 'kirim' && rec.target) L.push('Target selesai: ' + coreTgl(rec.target));
    if (type === 'setor') L.push('Status: ' + ({ diajukan: 'Menunggu dihitung QC', diterima: 'Diterima', ditolak: 'Ditolak' }[rec.status] || rec.status));
    if (rec.catatan) L.push('Catatan: ' + rec.catatan);
  } else {
    L.push('*SLIP UPAH ' + (rec.jenis === 'jahit' ? 'JAHIT' : 'POTONG') + '*');
    L.push('No: ' + rec.noSlip);
    L.push('Tanggal: ' + coreTgl(rec.tanggal));
    L.push('Nama: ' + ((ctx.pegawai && ctx.pegawai.nama) || '-'));
    L.push('');
    (ctx.items || []).forEach(function (it) {
      var p2 = (ctx.poMap && ctx.poMap[it.poId]) || {}; var rate = rec.jenis === 'jahit' ? it.upah : it.tarif;
      L.push('• ' + (p2.nama || 'Barang') + ' — ' + coreRibuan(it.total) + ' pcs x ' + coreRupiah(rate) + ' = ' + coreRupiah(it.total * rate));
    });
    L.push('');
    L.push('Total: ' + coreRibuan(rec.totalQty) + ' pcs = ' + coreRupiah(rec.totalUpah));
    if (rec.potongan) L.push('Potongan: ' + coreRupiah(rec.potongan));
    L.push('*Dibayar: ' + coreRupiah(rec.dibayar) + '*');
    if (rec.catatan) L.push('Catatan: ' + rec.catatan);
  }
  L.push('— ' + (st.kopSlip || st.namaUsaha || '') + (st.kopSub ? ' · ' + st.kopSub : ''));
  return L.join('\n');
}

/* ============================================================ */
function createCore(store, env) {

  function fail(msg) { throw new Error(msg); }
  function nowIso() { return env.now().toISOString(); }
  function today() { return coreYmd(env.now()); }
  function tglOk(s) { s = String(s || ''); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; }
  function idOk(s) { s = String(s || ''); return /^[A-Za-z0-9_-]{6,48}$/.test(s) ? s : ''; }
  function teks(s, max) { return String(s === undefined || s === null ? '' : s).slice(0, max || 500); }

  function nextNo(prefix, rows, field, dateStr) {
    var d = dateStr ? new Date(dateStr + 'T00:00:00') : env.now();
    if (isNaN(d.getTime())) d = env.now();
    var ym = corePad(d.getFullYear() % 100, 2) + corePad(d.getMonth() + 1, 2);
    var pre = prefix + '-' + ym + '-'; var max = 0;
    for (var i = 0; i < rows.length; i++) {
      var v = String(rows[i][field] || '');
      if (v.indexOf(pre) === 0) { var n = parseInt(v.slice(pre.length), 10); if (n > max) max = n; }
    }
    return pre + corePad(max + 1, 3);
  }

  function settings() {
    var s = store.getSettings() || {}; var out = {};
    for (var k in DEFAULT_SETTINGS) out[k] = (s[k] === undefined || s[k] === null || s[k] === '') ? DEFAULT_SETTINGS[k] : s[k];
    if (!(out.ukuran instanceof Array) || !out.ukuran.length) out.ukuran = DEFAULT_SETTINGS.ukuran.slice();
    out.upahPotong = coreNum(out.upahPotong); out.upahJahit = coreNum(out.upahJahit);
    out.stokKuning = Math.max(0, coreNum(out.stokKuning)); out.stokMerah = Math.max(0, coreNum(out.stokMerah));
    out.stokMulai = coreTglOk(out.stokMulai);
    if (!(out.bahanSembunyi instanceof Array)) out.bahanSembunyi = [];
    return out;
  }

  function users() { return store.read('Pegawai'); }
  function findUser(id) { var us = users(); for (var i = 0; i < us.length; i++) if (us[i].id === id) return us[i]; return null; }
  function findRow(sheet, id) { if (!id) return null; var rs = store.read(sheet); for (var i = 0; i < rs.length; i++) if (rs[i].id === id) return rs[i]; return null; }
  function tokensOf(u) { return String(u.token || '').split(',').filter(Boolean); }

  function auth(payload) {
    var token = payload && String(payload.token || '');
    if (!token || token.length < 16) fail('Silakan login dulu.');
    var us = users();
    for (var i = 0; i < us.length; i++) if (tokensOf(us[i]).indexOf(token) >= 0) {
      if (!us[i].aktif) fail('Akun ini sudah dinonaktifkan.');
      return us[i];
    }
    fail('Sesi berakhir, silakan login lagi.');
  }
  function mustAdmin(me) { if (!coreIsAdmin(me)) fail('Hanya owner/admin yang boleh melakukan ini.'); }
  function pinOk(u) { return /^\d{4,6}$/.test(String(u.pin || '')); }
  function adaOwner() { return users().some(function (u) { return u.divisi === 'owner' && u.aktif; }); }
  /* Masa pemasangan = belum ada akun owner. Hanya di masa itu data lama boleh dimasukkan tanpa login,
     supaya sheet bisa diisi dulu sebelum owner membuat akunnya. Begitu owner ada, pintu ini tertutup. */
  function adminAtauPemasangan(p) {
    if (!adaOwner()) return null;
    var me = auth(p); mustAdmin(me); return me;
  }

  function publicUser(u, full) {
    var o = { id: u.id, nama: u.nama, divisi: u.divisi, aktif: !!u.aktif };
    if (full) { o.hp = u.hp || ''; o.catatan = u.catatan || ''; o.dibuat = u.dibuat || ''; o.adaPin = pinOk(u); }
    return o;
  }
  function genToken() { return env.id() + env.id() + env.id(); }
  function withParsed(rows, field, fb) {
    return rows.map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; o[field] = coreParseJSON(r[field], fb); return o; });
  }
  function copy(r) { var o = {}; for (var k in r) o[k] = r[k]; return o; }
  function validateWorkers(wf) {
    store.read('SlipKirim').concat(store.read('SlipSetor')).forEach(function (r) { var worker = findUser(r.maklonId), p = wf[r.poId]; if (p && (!worker || worker.divisi !== 'jahit')) { p.issues.push('Pekerja asal ' + r.id + ' tidak dikenal.'); p.readyQC = false; p.complete = false; Object.keys(p.ukuran).forEach(function (s) { p.ukuran[s].readyQC = false; p.ukuran[s].complete = false; }); } }); return wf;
  }
  function legacyExtras() { return { gudangLama: store.read('GudangLama'), settlements: store.read('LegacySettlement'), historyCorrections: store.read('KoreksiRiwayat') }; }
  function workflow() { return validateWorkers(coreWorkflow(store.read('PO'), store.read('Potong'), store.read('SlipKirim'), store.read('SlipSetor'), store.read('QC'), store.read('Gudang'), legacyExtras())); }
  function payroll() { return corePayroll(store.read('Potong'), store.read('SlipSetor'), store.read('QC'), store.read('SlipUpah'), legacyExtras()); }
  function poClean(po) { var w = workflow()[po.id]; if (w && w.issues.length) fail(w.issues[0]); return w; }
  function strictSizes(raw, po, allowEmpty) {
    var map = coreMap(raw), out = {}, planned = Object.keys(coreMap(po.ukuran)), allowed = planned.length ? planned : settings().ukuran;
    Object.keys(map).forEach(function (s) {
      var n = Number(map[s]); if (!isFinite(n) || n < 0 || n !== Math.floor(n)) fail('Jumlah ukuran harus bilangan bulat tidak negatif.');
      if (!n) return; if (allowed.indexOf(s) < 0) fail('Ukuran ' + s + ' tidak terdaftar pada PO.'); out[s] = n;
    });
    if (!allowEmpty && !Object.keys(out).length) fail('Isi jumlah per ukuran.'); return out;
  }
  function categoryInput(r, field, scalar, po, basis) {
    var map = strictSizes(r[field], po, true), n = coreNum(r[scalar]);
    if (n < 0 || n !== Math.floor(n)) fail('Jumlah ' + scalar + ' harus bilangan bulat tidak negatif.');
    if (!Object.keys(map).length && n) {
      var keys = Object.keys(basis || {}); if (keys.length !== 1) fail('Rinci ' + scalar + ' per ukuran.'); map[keys[0]] = n;
    } else if (r[scalar] !== undefined && r[scalar] !== '' && n !== coreSumSizes(map)) fail('Total ' + scalar + ' tidak cocok dengan rincian ukuran.');
    return map;
  }
  function sumMaps(maps) { var out = {}; maps.forEach(function (m) { Object.keys(m).forEach(function (s) { out[s] = (out[s] || 0) + coreNum(m[s]); }); }); return out; }
  function ensureComplete(po) { var w = workflow()[po.id]; if (!w || !w.complete) fail('PO belum selesai: hitungan, QC, atau perbaikan masih tersisa.'); }
  function ensureSetorCapacity(po, who, good, bad, excludeId) {
    var assigned = {}, used = {}, keys = sumMaps([good, bad]); poClean(po);
    store.read('SlipKirim').forEach(function (r) { if (r.poId === po.id && r.maklonId === who) assigned = sumMaps([assigned, coreMap(r.ukuran)]); });
    store.read('SlipSetor').forEach(function (r) { if (r.id !== excludeId && r.poId === po.id && r.maklonId === who && r.status !== 'ditolak') { var issues = []; var reject = coreCategory(r, 'rejectUkuran', 'reject', r.ukuran, issues); if (issues.length) fail(issues[0]); used = sumMaps([used, coreMap(r.ukuran), reject]); } });
    Object.keys(keys).forEach(function (s) { if (keys[s] > coreNum(assigned[s]) - coreNum(used[s])) fail('Setoran ' + s + ' melebihi sisa penugasan maklon.'); });
  }
  function sourceInLegacySettlement(id) {
    if (!id) return false;
    return store.read('LegacySettlement').some(function (b) { return coreParseJSON(b.baselineSources, []).some(function (s) { return s.sourceId === id; }); });
  }
  function correctedSource(sheet, id) { return store.read('KoreksiRiwayat').some(function (r) { return r.sheet === sheet && r.rowId === id; }); }
  function sourcePaid(id) { return sourceInLegacySettlement(id) || payroll().some(function (r) { return r.sourceId === id && (r.paidQty > 0 || r.overpaidQty > 0 || r.legacyPaid || r.legacySettlementHold || r.legacySettlementId); }); }
  function durableMigrationStatus() { if (store.checkpoint) store.checkpoint(['Pengaturan']); return (store.getSettings() || {}).legacyMigrationStatus; }

  /* ---------- data yang dikirim ke perangkat, disaring menurut divisi ---------- */
  function buildState(me, opt) {
    var migrationStatus = durableMigrationStatus();
    var semua = !!(opt && opt.semua);
    /* tabel yang akan dibaca diambil dari cache dalam satu kali ambil (kalau penyimpanannya mendukung) */
    if (store.prefetch) {
      var perlu = ['Pengaturan', 'Pegawai', 'Produk', 'PO', 'Potong', 'SlipKirim', 'SlipSetor', 'QC', 'Gudang', 'GudangLama', 'SlipUpah', 'LegacySettlement', 'KoreksiRiwayat'];
      if (coreIsAdmin(me)) perlu = perlu.concat(['StokBahan', 'GajiHarian', 'Karyawan', 'Kasbon']);
      else if (me.divisi === 'potong') perlu.push('StokBahan', 'Kasbon');
      else if (me.divisi === 'jahit') perlu.push('Kasbon');
      store.prefetch(perlu);
    }
    var st = settings();
    var allUsers = users();
    var produk = store.read('Produk');
    var po = withParsed(store.read('PO'), 'ukuran', {});
    var potong = withParsed(store.read('Potong'), 'ukuran', {});
    var kirim = withParsed(store.read('SlipKirim'), 'ukuran', {});
    var setor = withParsed(store.read('SlipSetor'), 'ukuran', {});
    var qc = withParsed(store.read('QC'), 'ukuran', {});
    var gudang = withParsed(store.read('Gudang'), 'ukuran', {});
    var upah = withParsed(store.read('SlipUpah'), 'itemIds', []);
    upah = withParsed(upah, 'items', []);
    var extras = legacyExtras();
    var agg = coreAggregate(po, potong, kirim, setor, qc, gudang, extras);
    var wf = validateWorkers(coreWorkflow(po, potong, kirim, setor, qc, gudang, extras));
    var earned = corePayroll(potong, setor, qc, upah, extras);
    /* Hydrate only the response copy for historical receipt rendering. Stored SlipUpah stays unchanged. */
    upah.forEach(function (u) { if (!u.items.length) { var original = coreLegacySlipItems(u, extras.settlements); if (original.length) u.items = original; } });
    po.forEach(function (p) { p.agg = agg[p.id]; p.workflow = wf[p.id]; });
    earned.forEach(function (r) { if (wf[r.poId] && wf[r.poId].issues.length) { r.issues = r.issues.concat(wf[r.poId].issues); r.available = 0; r.needsReview = true; } });

    var admin = coreIsAdmin(me);
    if (me.divisi === 'owner' && migrationStatus) { st.legacyMigrationStatus = {}; ['batchId','beforeHash','planHash','at'].forEach(function (key) { if (migrationStatus[key] !== undefined) st.legacyMigrationStatus[key] = migrationStatus[key]; }); }
    var out = { ver: store.version(), serverTime: nowIso(), appVersion: APP_VERSION, workflowVersion: WORKFLOW_VERSION, contractVersion: WORKFLOW_VERSION, settings: st, me: publicUser(me, true), trimmed: false, semua: semua };
    out.payroll = earned.filter(function (r) { return admin || r.pegawaiId === me.id; });
    /* The projection is made BEFORE history trimming; archived QC cannot turn back into unpaid count. */
    out.warehouse = admin ? Object.keys(wf).reduce(function (a, id) { return a.concat(wf[id].warehouse); }, []) : [];

    /* stok bahan dihitung di sini dari SEMUA catatan potong, sebelum data lama dipangkas untuk perangkat */
    var stokRows = null, stokRingkas = null;
    if (admin || me.divisi === 'potong') {
      stokRows = store.read('StokBahan');
      stokRingkas = coreStok(potong, stokRows, st);
    }
    /* Payroll and material accounting above use untouched source rows. Only the
       physical production display and workflow use audited history corrections. */
    if (typeof coreHistoryPhysicalRows === 'function') {
      potong = withParsed(coreHistoryPhysicalRows('Potong', potong, extras.historyCorrections), 'ukuran', {});
      kirim = withParsed(coreHistoryPhysicalRows('SlipKirim', kirim, extras.historyCorrections), 'ukuran', {});
      [{ sheet: 'Potong', rows: potong }, { sheet: 'SlipKirim', rows: kirim }].forEach(function (group) { group.rows.forEach(function (r) {
        var parent = po.filter(function (p) { return p.id === r.poId; })[0];
        r.historyCorrectionEligible = me.divisi === 'owner' && coreHistoryEligible(parent, r, group.sheet);
        if (r.historyCorrection && me.divisi !== 'owner') r.historyCorrection = { original: r.historyCorrection.original };
      }); });
    }

    /* data lama tidak dikirim supaya aplikasi tetap ringan */
    if (!semua) {
      var cut = coreYmd(new Date(env.now().getTime() - HARI_ARSIP * 86400000));
      var old = {}; var need = {};
      po.forEach(function (p) {
        if (p.status === 'aktif') return;
        var d = p.selesaiPada || String(p.diubah || p.dibuat || '').slice(0, 10);
        if (d && d < cut) old[p.id] = 1;
      });
      var trim = function (rows, payable) {
        return rows.filter(function (r) {
          if (!old[r.poId]) return true;
          if (payable && payable(r)) { need[r.poId] = 1; return true; }
          out.trimmed = true; return false;
        });
      };
      potong = trim(potong, function (r) { return !r.upahId && r.tarif > 0; });
      setor = trim(setor, function (r) { return !r.upahId && r.status !== 'ditolak'; });
      kirim = trim(kirim); qc = trim(qc); gudang = trim(gudang);
      var n0 = po.length;
      po = po.filter(function (p) { return !old[p.id] || need[p.id]; });
      if (po.length < n0) out.trimmed = true;
      var n1 = upah.length;
      upah = upah.filter(function (u) { return String(u.tanggal || '') >= cut; });
      if (upah.length < n1) out.trimmed = true;
    }

    if (admin) {
      out.users = allUsers.map(function (u) { return publicUser(u, true); });
      out.produk = produk;
      out.po = po; out.potong = potong; out.kirim = kirim; out.setor = setor; out.qc = qc; out.gudang = gudang; out.upah = upah;
      out.appUrl = env.appUrl ? env.appUrl() : '';
      /* stok bahan, gaji harian, kasbon: hanya owner/admin */
      out.stokRingkas = stokRingkas;
      var gaji = store.read('GajiHarian'); var stokList = stokRows;
      if (!semua) {
        var cutLama = coreYmd(new Date(env.now().getTime() - 120 * 86400000));
        var g0 = gaji.length; gaji = gaji.filter(function (g) { return String(g.tanggal || '') >= cutLama || !g.lunas; });
        var s0 = stokList.length; stokList = stokList.filter(function (r) { return String(r.tanggal || '') >= cutLama; });
        if (gaji.length < g0 || stokList.length < s0) out.trimmed = true;
      }
      out.stok = stokList; out.karyawan = store.read('Karyawan'); out.gaji = gaji; out.kasbon = store.read('Kasbon');
      return out;
    }

    out.users = allUsers.map(function (u) { return publicUser(u, false); });
    out.produk = produk.map(function (r) {
      var o = { id: r.id, nama: r.nama, series: r.series, gambar: r.gambar, aktif: r.aktif };
      if (me.divisi === 'potong') o.tarifPotong = r.tarifPotong;
      return o;
    });
    out.potong = []; out.kirim = []; out.setor = []; out.qc = []; out.gudang = []; out.upah = [];

    /* slip upah mingguan di aplikasi maklon jahit dan tukang potong memuat potongan kasbon:
       yang dikirim hanya kasbon milik orang itu sendiri beserta cicilannya */
    if (me.divisi === 'jahit' || me.divisi === 'potong') {
      var kbRows = store.read('Kasbon'); var kbSaya = {};
      kbRows.forEach(function (r) { if (r.tipe === 'kasbon' && r.jenis === 'maklon' && r.orangId === me.id) kbSaya[r.id] = 1; });
      out.kasbon = kbRows.filter(function (r) { return kbSaya[r.id] || (r.tipe === 'cicilan' && kbSaya[r.kasbonId]); })
        .map(function (r) { var o = copy(r); o.dibuatOleh = ''; return o; });
    }

    if (me.divisi === 'jahit') {
      var mine = function (r) { return r.maklonId === me.id; };
      /* maklon baru melihat harga di slip setor yang sudah terbit, bukan di slip penugasan */
      out.kirim = kirim.filter(mine).map(function (r) { var o = copy(r); o.upah = 0; return o; });
      out.setor = setor.filter(mine);
      out.upah = upah.filter(function (u) { return u.pegawaiId === me.id; });
      var ids = {}; out.kirim.forEach(function (k) { ids[k.poId] = 1; }); out.setor.forEach(function (s) { ids[s.poId] = 1; });
      out.po = po.filter(function (p) { return ids[p.id]; }).map(function (p) {
        var q = copy(p);
        delete q.workflow;
        q.agg = { total: {}, ukuran: {}, maklon: {}, saya: p.agg.maklon[me.id] || { kirim: 0, terima: 0, reject: 0, diajukan: 0, sisa: 0, target: '' } };
        return q;
      });
    } else if (me.divisi === 'potong') {
      out.potong = potong.filter(function (r) { return r.userId === me.id; });
      /* PO aktif untuk dikerjakan, ditambah PO dari catatan potongnya sendiri supaya riwayat dan slip tetap menampilkan nama barangnya */
      var poSaya = {}; out.potong.forEach(function (r) { poSaya[r.poId] = 1; });
      out.po = po.filter(function (p) { return p.status === 'aktif' || poSaya[p.id]; });
      out.upah = upah.filter(function (u) { return u.pegawaiId === me.id; });
      /* tukang potong memilih bahan dari daftar stok: hanya nama, satuan, dan sisa; tanpa harga */
      out.bahan = (stokRingkas || []).filter(function (b) { return !b.sembunyi; }).map(function (b) { return { nama: b.nama, satuan: b.satuan, saldo: b.saldo }; });
    } else if (me.divisi === 'qc') {
      var pending = {}; setor.forEach(function (s) { if (s.status === 'diajukan') pending[s.poId] = 1; });
      out.po = po.filter(function (p) { return p.status === 'aktif' || pending[p.id]; });
      var shown = {}; out.po.forEach(function (p) { shown[p.id] = 1; });
      var hide = function (r) { var o = copy(r); o.upah = 0; o.upahId = o.upahId ? 'x' : ''; return o; };
      out.setor = setor.filter(function (r) { return shown[r.poId]; }).map(hide);
      out.kirim = kirim.filter(function (r) { return shown[r.poId]; }).map(hide);
      out.qc = qc.filter(function (r) { return shown[r.poId]; });
      out.gudang = gudang.filter(function (r) { return shown[r.poId]; });
    } else {
      out.po = [];
    }
    return out;
  }

  function loginResult(u, opt) {
    var token = genToken();
    var list = tokensOf(u); list.push(token);
    while (list.length > MAX_SESI) list.shift();
    store.update('Pegawai', u.id, { token: list.join(','), gagal: 0, kunci: '' });
    return { token: token, state: buildState(findUser(u.id), opt) };
  }

  /* ---------- aksi ---------- */
  var actions = {};

  actions.bootstrap = function (p) {
    var us = users();
    var st = settings();
    /* aplikasi per divisi hanya menerima daftar nama divisinya sendiri */
    var div = p && DIVISI[p.divisi] && !DIVISI[p.divisi].admin ? String(p.divisi) : '';
    var res = { needSetup: !adaOwner(), namaUsaha: st.namaUsaha, appVersion: APP_VERSION, workflowVersion: WORKFLOW_VERSION, contractVersion: WORKFLOW_VERSION, divisi: div,
      users: us.filter(function (u) { return u.aktif && pinOk(u) && (!div || u.divisi === div); }).map(function (u) { return publicUser(u, false); }) };
    var token = p && String(p.token || '');
    if (token) for (var i = 0; i < us.length; i++) if (us[i].aktif && tokensOf(us[i]).indexOf(token) >= 0) { res.state = buildState(us[i], p); res.token = token; break; }
    return res;
  };

  /* "tidak ada yang berubah" hanya dijawab kalau nomor versi data sama DAN data di perangkat dibuat oleh versi server ini
     (av dikirim perangkat versi baru; perangkat lama tidak mengirimnya). Dengan begitu perangkat yang membuka dari
     salinan data terakhirnya tetap mendapat data baru setelah server diperbarui. */
  actions.sync = function (p) {
    var pendingMigration = durableMigrationStatus();
    if (!pendingMigration && p && p.ver !== undefined && String(p.ver) === String(store.version()) && (p.av === undefined || String(p.av) === APP_VERSION)) return { same: true, ver: store.version() };
    return buildState(auth(p), p);
  };

  actions.getState = function (p) { return buildState(auth(p), p); };

  actions.setupOwner = function (p) {
    if (adaOwner()) fail('Owner sudah dibuat. Silakan login.');
    var nama = teks(p.nama, 60).trim(); if (!nama) fail('Nama wajib diisi.');
    var pin = String(p.pin || '').trim(); if (!/^\d{4,6}$/.test(pin)) fail('PIN harus 4 sampai 6 angka.');
    var u = { id: env.id(), nama: nama, divisi: 'owner', pin: pin, token: '', gagal: 0, kunci: '', hp: '', catatan: '', aktif: true, dibuat: nowIso() };
    store.append('Pegawai', u);
    var st = settings(); if (p.namaUsaha) st.namaUsaha = teks(p.namaUsaha, 60).trim(); store.setSettings(st);
    return loginResult(u, p);
  };

  actions.login = function (p) {
    var u = findUser(String(p.userId || ''));
    if (!u || !u.aktif) fail('Pegawai tidak ditemukan.');
    if (!pinOk(u)) fail('Akun ini belum punya PIN. Minta owner membuatkannya di menu Pegawai.');
    var now = env.now().getTime();
    if (u.kunci) {
      var until = new Date(u.kunci).getTime();
      if (until > now) fail('Terlalu banyak salah PIN. Coba lagi ' + Math.ceil((until - now) / 60000) + ' menit lagi.');
    }
    if (String(u.pin) !== String(p.pin || '')) {
      var g = coreNum(u.gagal) + 1; var patch = { gagal: g };
      if (g >= MAX_GAGAL) { patch.gagal = 0; patch.kunci = new Date(now + MENIT_KUNCI * 60000).toISOString(); }
      store.update('Pegawai', u.id, patch);
      return { salah: true, pesan: g >= MAX_GAGAL ? 'PIN salah ' + MAX_GAGAL + ' kali. Akun dikunci ' + MENIT_KUNCI + ' menit.' : 'PIN salah. Sisa percobaan: ' + (MAX_GAGAL - g) + '.' };
    }
    return loginResult(u, p);
  };

  actions.logout = function (p) {
    var token = String(p.token || ''); if (!token) return { ok: true };
    users().forEach(function (u) {
      var list = tokensOf(u); var i = list.indexOf(token);
      if (i >= 0) { list.splice(i, 1); store.update('Pegawai', u.id, { token: list.join(',') }); }
    });
    return { ok: true };
  };

  actions.changePin = function (p) {
    var me = auth(p);
    /* hanya owner yang memegang PIN: PIN-nya sendiri dan PIN semua pegawai */
    if (me.divisi !== 'owner') fail('PIN hanya bisa diganti oleh owner. Minta owner menggantinya di menu Pegawai.');
    if (String(me.pin) !== String(p.pinLama || '')) fail('PIN lama salah.');
    var pin = String(p.pinBaru || '').trim(); if (!/^\d{4,6}$/.test(pin)) fail('PIN baru harus 4 sampai 6 angka.');
    store.update('Pegawai', me.id, { pin: pin, token: String(p.token) });   /* perangkat lain otomatis keluar */
    return { ok: true };
  };

  actions.saveSettings = function (p) {
    var me = auth(p); mustAdmin(me);
    var st = settings(); var s = p.settings || {};
    if (s.namaUsaha !== undefined) st.namaUsaha = teks(s.namaUsaha, 60).trim() || DEFAULT_SETTINGS.namaUsaha;
    if (s.alamat !== undefined) st.alamat = teks(s.alamat, 200);
    if (s.ukuran !== undefined) {
      var seen = {};
      var arr = (s.ukuran instanceof Array ? s.ukuran : String(s.ukuran).split(',')).map(function (x) { return String(x).trim().toUpperCase(); })
        .filter(function (x) { if (!x || seen[x]) return false; seen[x] = 1; return true; });
      if (!arr.length) fail('Daftar ukuran tidak boleh kosong.');
      st.ukuran = arr;
    }
    if (s.upahPotong !== undefined) st.upahPotong = Math.max(0, coreNum(s.upahPotong));
    if (s.upahJahit !== undefined) st.upahJahit = Math.max(0, coreNum(s.upahJahit));
    if (s.linkApp !== undefined) { var link = teks(s.linkApp, 300).trim(); st.linkApp = /^https:\/\//.test(link) ? link : ''; }
    if (s.kopSlip !== undefined) st.kopSlip = teks(s.kopSlip, 60).trim() || DEFAULT_SETTINGS.kopSlip;
    if (s.kopSub !== undefined) st.kopSub = teks(s.kopSub, 80).trim();
    if (s.stokKuning !== undefined) st.stokKuning = Math.max(0, coreNum(s.stokKuning));
    if (s.stokMerah !== undefined) st.stokMerah = Math.max(0, coreNum(s.stokMerah));
    if (st.stokMerah > st.stokKuning) fail('Batas kritis tidak boleh lebih besar dari batas menipis.');
    if (s.stokMulai !== undefined) st.stokMulai = coreTglOk(s.stokMulai);
    if (s.bahanSembunyi !== undefined) {
      var lihat = {}; st.bahanSembunyi = (s.bahanSembunyi instanceof Array ? s.bahanSembunyi : []).map(function (x) { return teks(x, 80).trim(); })
        .filter(function (x) { var k = coreNormBahan(x); if (!k || lihat[k]) return false; lihat[k] = 1; return true; });
    }
    store.setSettings(st);
    return settings();
  };

  actions.saveUser = function (p) {
    var me = auth(p); mustAdmin(me);
    var u = p.user || {};
    var nama = teks(u.nama, 60).trim(); if (!nama) fail('Nama wajib diisi.');
    var divisi = String(u.divisi || ''); if (!DIVISI[divisi]) fail('Divisi tidak dikenal.');
    if (DIVISI[divisi].admin && me.divisi !== 'owner') fail('Hanya owner yang boleh membuat akun owner/admin.');
    if (u.id) {
      var old = findUser(String(u.id)); if (!old) fail('Pegawai tidak ditemukan.');
      if (DIVISI[old.divisi] && DIVISI[old.divisi].admin && me.divisi !== 'owner' && old.id !== me.id) fail('Admin tidak boleh mengubah akun owner/admin lain.');
      if (old.id === me.id && u.aktif === false) fail('Tidak bisa menonaktifkan akun sendiri.');
      if (old.id === me.id && divisi !== old.divisi) fail('Tidak bisa mengubah divisi akun sendiri.');
      if (old.divisi === 'owner' && (divisi !== 'owner' || u.aktif === false)) {
        var owners = users().filter(function (x) { return x.divisi === 'owner' && x.aktif && x.id !== old.id; });
        if (!owners.length) fail('Harus ada minimal satu owner aktif.');
      }
      var patch = { nama: nama, divisi: divisi, hp: teks(u.hp, 30), catatan: teks(u.catatan, 200), aktif: u.aktif === undefined ? old.aktif : !!u.aktif };
      if (u.pin) { if (me.divisi !== 'owner') fail('Hanya owner yang boleh mengatur PIN.'); if (!/^\d{4,6}$/.test(String(u.pin))) fail('PIN harus 4 sampai 6 angka.'); patch.pin = String(u.pin); patch.gagal = 0; patch.kunci = ''; if (old.id !== me.id) patch.token = ''; }
      if (patch.aktif === false || patch.divisi !== old.divisi) patch.token = '';
      store.update('Pegawai', old.id, patch);
      return publicUser(findUser(old.id), true);
    }
    /* akun baru boleh dibuat tanpa PIN (misalnya oleh admin); pemiliknya baru bisa masuk setelah owner mengisi PIN */
    var pin = String(u.pin || '').trim();
    if (pin && me.divisi !== 'owner') fail('Hanya owner yang boleh mengatur PIN.');
    if (pin && !/^\d{4,6}$/.test(pin)) fail('PIN harus 4 sampai 6 angka.');
    var nu = { id: env.id(), nama: nama, divisi: divisi, pin: pin, token: '', gagal: 0, kunci: '', hp: teks(u.hp, 30), catatan: teks(u.catatan, 200), aktif: true, dibuat: nowIso() };
    store.append('Pegawai', nu);
    return publicUser(nu, true);
  };

  actions.saveProduk = function (p) {
    var me = auth(p); mustAdmin(me);
    var r = p.produk || {};
    var nama = teks(r.nama, 80).trim().toUpperCase(); if (!nama) fail('Nama produk wajib diisi.');
    var series = teks(r.series, 60).trim().toUpperCase();
    var rows = store.read('Produk');
    for (var i = 0; i < rows.length; i++) if (rows[i].nama === nama && rows[i].series === series && rows[i].id !== r.id) fail('Produk ' + nama + (series ? ' (' + series + ')' : '') + ' sudah ada.');
    var patch = { nama: nama, series: series, tarifPotong: Math.max(0, coreNum(r.tarifPotong)), tarifJahit: Math.max(0, coreNum(r.tarifJahit)), catatan: teks(r.catatan, 200) };
    if (r.aktif !== undefined) patch.aktif = !!r.aktif;
    if (r.id) { var old = findRow('Produk', String(r.id)); if (!old) fail('Produk tidak ditemukan.'); store.update('Produk', old.id, patch); return findRow('Produk', old.id); }
    var rec = { id: idOk(r.newId) || env.id(), nama: nama, series: series, gambar: '', tarifPotong: patch.tarifPotong, tarifJahit: patch.tarifJahit, catatan: patch.catatan, aktif: true, dibuat: nowIso() };
    store.append('Produk', rec);
    return rec;
  };

  /* gambar disimpan di sheet Gambar; Produk/PO hanya menyimpan nomor versi */
  function putGambar(id, jenis, dataUrl) {
    var sheet = jenis === 'po' ? 'PO' : 'Produk';
    if (!findRow(sheet, id)) return false;
    dataUrl = String(dataUrl || '');
    var old = findRow('Gambar', id);
    var ganti = {};
    if (!dataUrl) { if (old) store.remove('Gambar', id); store.update(sheet, id, { gambar: '' }); ganti[id] = ''; if (store.imgPut) store.imgPut(ganti); return true; }
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(dataUrl)) fail('File gambar tidak valid.');
    if (dataUrl.length > MAX_GAMBAR) fail('Gambar terlalu besar.');
    var ver = env.now().getTime().toString(36);
    if (old) store.update('Gambar', id, { data: dataUrl, diubah: nowIso() });
    else store.append('Gambar', { id: id, data: dataUrl, diubah: nowIso() });
    store.update(sheet, id, { gambar: ver });
    ganti[id] = dataUrl; if (store.imgPut) store.imgPut(ganti);
    return true;
  }
  actions.saveGambar = function (p) {
    var me = auth(p); mustAdmin(me);
    if (!putGambar(String(p.id || ''), String(p.jenis || 'produk'), p.dataUrl)) fail('Data tidak ditemukan.');
    return { ok: true };
  };
  actions.importGambar = function (p) {
    adminAtauPemasangan(p);
    var n = 0;
    (p.items instanceof Array ? p.items : []).slice(0, 40).forEach(function (it) {
      try { if (putGambar(String(it.id || ''), String(it.jenis || 'produk'), it.dataUrl)) n++; } catch (e) {}
    });
    return { ditambah: n };
  };
  /* dari daftar gambar yang mau dimasukkan, mana yang barangnya ada tetapi gambarnya masih kosong */
  actions.cekGambar = function (p) {
    var me = auth(p); mustAdmin(me);
    var produk = {}, po = {}; store.read('Produk').forEach(function (r) { produk[r.id] = r; }); store.read('PO').forEach(function (r) { po[r.id] = r; });
    var kosong = [];
    (p.items instanceof Array ? p.items : []).slice(0, 3000).forEach(function (it) {
      if (!it) return; var row = it.jenis === 'po' ? po[String(it.id)] : produk[String(it.id)];
      if (row && !row.gambar) kosong.push(row.id);
    });
    return { kosong: kosong };
  };
  actions.getGambar = function (p) {
    var me = auth(p);
    var ids = (p.ids instanceof Array ? p.ids : []).slice(0, 40).map(String).filter(function (i) { return idOk(i); });
    var out = {}; var sisa = ids;
    /* gambar yang pernah diambil disimpan satu per satu di cache server, jadi tab Gambar tidak dibaca berulang-ulang */
    if (store.imgGet && ids.length) { var hit = store.imgGet(ids); sisa = ids.filter(function (i) { if (hit[i]) { out[i] = hit[i]; return false; } return true; }); }
    if (sisa.length) {
      var want = {}; sisa.forEach(function (i) { want[i] = 1; }); var baru = {};
      store.read('Gambar').forEach(function (g) { if (want[g.id]) { out[g.id] = g.data; baru[g.id] = g.data; } });
      if (store.imgPut) store.imgPut(baru);
    }
    return { gambar: out };
  };

  actions.savePO = function (p) {
    var me = auth(p); mustAdmin(me);
    var po = p.po || {};
    var jenis = PO_JENIS.indexOf(po.jenis) >= 0 ? po.jenis : 'stok';
    var produk = po.produkId ? findRow('Produk', String(po.produkId)) : null;
    if (po.produkId && !produk) fail('Produk tidak ditemukan.');
    var nama = teks(po.nama || (produk ? produk.nama : ''), 80).trim().toUpperCase();
    var series = teks(po.series !== undefined && po.series !== '' ? po.series : (produk ? produk.series : ''), 60).trim().toUpperCase();
    if (!nama) fail('Nama barang wajib diisi.');
    var ukuran = coreCleanSizes(po.ukuran);
    var total = coreSumSizes(ukuran) || Math.max(0, coreInt(po.total));
    var pelanggan = teks(po.pelanggan, 80).trim();
    if (jenis === 'pesanan' && !pelanggan) fail('Nama pelanggan wajib diisi untuk pesanan.');
    if (jenis === 'pesanan' && total <= 0) fail('Pesanan harus punya jumlah pcs.');
    var status = PO_STATUS.indexOf(po.status) >= 0 ? po.status : 'aktif';
    var rows = store.read('PO'); var rec;
    var common = { jenis: jenis, produkId: produk ? produk.id : '', nama: nama, series: series, pelanggan: pelanggan,
      deadline: tglOk(po.deadline), ukuran: JSON.stringify(ukuran), total: total, bahan: teks(po.bahan, 120),
      catatan: teks(po.catatan, 300), status: status, diubah: nowIso() };
    if (po.id) {
      rec = findRow('PO', String(po.id)); if (!rec) fail('PO tidak ditemukan.');
      var hasProduction = store.read('Potong').concat(store.read('SlipKirim'), store.read('SlipSetor'), store.read('QC')).some(function (r) { return r.poId === rec.id; });
      if (hasProduction && Object.keys(coreMap(rec.ukuran)).sort().join('|') !== Object.keys(ukuran).sort().join('|')) fail('Ukuran PO yang sudah berjalan tidak boleh diganti.');
      if (status === 'selesai') ensureComplete(rec);
      var noPO = teks(po.noPO, 30).trim() || rec.noPO;
      for (var i = 0; i < rows.length; i++) if (rows[i].noPO === noPO && rows[i].id !== rec.id) fail('Nomor PO ' + noPO + ' sudah dipakai.');
      common.noPO = noPO;
      if (status === 'aktif') common.selesaiPada = '';
      else if (rec.status === 'aktif') common.selesaiPada = today();
      store.update('PO', rec.id, common);
      return findRow('PO', rec.id);
    }
    var nid = idOk(po.newId); if (nid) { var ex = findRow('PO', nid); if (ex) return ex; }
    if (status === 'selesai') fail('PO baru belum mempunyai bukti produksi selesai.');
    var no = teks(po.noPO, 30).trim() || nextNo('PO', rows, 'noPO');
    for (var j = 0; j < rows.length; j++) if (rows[j].noPO === no) fail('Nomor PO ' + no + ' sudah dipakai.');
    rec = common; rec.id = nid || env.id(); rec.noPO = no; rec.gambar = '';
    rec.dibuat = nowIso(); rec.dibuatOleh = me.id; rec.selesaiPada = status === 'aktif' ? '' : today();
    store.append('PO', rec);
    return rec;
  };

  actions.setStatusPO = function (p) {
    var me = auth(p); mustAdmin(me);
    if (PO_STATUS.indexOf(p.status) < 0) fail('Status tidak dikenal.');
    var rec = findRow('PO', String(p.id || '')); if (!rec) fail('PO tidak ditemukan.');
    if (p.status === 'selesai') ensureComplete(rec);
    store.update('PO', rec.id, { status: p.status, diubah: nowIso(), selesaiPada: p.status === 'aktif' ? '' : (rec.status !== 'aktif' && rec.selesaiPada ? rec.selesaiPada : today()) });
    return findRow('PO', rec.id);
  };

  function openPO(id) {
    var po = findRow('PO', String(id || '')); if (!po) fail('PO tidak ditemukan.');
    if (po.status === 'batal') fail('PO ini sudah dibatalkan.');
    if (po.status === 'selesai') fail('PO sudah selesai. Buka kembali PO sebelum menambah atau mengubah produksi.');
    return po;
  }
  function tarifProduk(po, field, fallback) {
    var pr = po.produkId ? findRow('Produk', po.produkId) : null;
    return pr && coreNum(pr[field]) > 0 ? coreNum(pr[field]) : fallback;
  }
  /* kirim ulang dari perangkat (sinyal putus lalu coba lagi) tidak boleh membuat baris dobel */
  function dedupe(sheet, r) {
    /* pemeriksaan "sudah pernah masuk atau belum" selalu memakai isi sheet yang sebenarnya, bukan salinan di cache */
    if (store.fresh) store.fresh(sheet);
    var id = idOk(r && r.id); if (!id) return { id: env.id(), ada: null };
    return { id: id, ada: findRow(sheet, id) };
  }

  actions.createPotong = function (p) {
    var me = auth(p); var admin = coreIsAdmin(me);
    if (!admin && me.divisi !== 'potong') fail('Hanya tukang potong atau admin.');
    var r = p.potong || {}; var d = dedupe('Potong', r); if (d.ada) return d.ada;
    var po = openPO(r.poId);
    poClean(po);
    var ukuran = strictSizes(r.ukuran, po, false);
    var total = coreSumSizes(ukuran);
    store.read('QC').forEach(function (q) { if (q.poId !== po.id) return; var maps = coreQcMaps(q, findRow('SlipSetor', q.setorId), []); var all = sumMaps([maps.ok, maps.offline, maps.perbaikan, maps.reject]); Object.keys(ukuran).forEach(function (s) { if (all[s]) fail('Ukuran ' + s + ' sudah di-QC. Selesaikan siklus ini lalu buat PO baru untuk potongan tambahan.'); }); });
    if (total <= 0) fail('Isi jumlah pcs hasil potong.');
    var userId = me.id;
    if (admin) { var tp = findUser(String(r.userId || '')); if (r.userId && (!tp || tp.divisi !== 'potong')) fail('Pilih tukang potong yang terdaftar.'); userId = tp ? tp.id : ''; }
    var st = settings();
    /* bahan yang dipakai: boleh lebih dari satu jenis. Inilah yang mengurangi stok bahan. */
    var bahanList = bersihBahan(r.bahanList);
    var bahan = teks(r.bahan || (bahanList[0] || {}).nama || po.bahan, 120); var kg = Math.max(0, coreNum(r.kg));
    if (bahanList.length) { bahan = bahanList.map(function (b) { return b.nama; }).join(', ').slice(0, 120); kg = 0; bahanList.forEach(function (b) { kg += b.qty; }); kg = Math.round(kg * 1000) / 1000; }
    var rec = { id: d.id, poId: po.id, userId: userId, tanggal: tglOk(r.tanggal) || today(), ukuran: JSON.stringify(ukuran), total: total,
      bahan: bahan, kg: kg, rol: Math.max(0, coreNum(r.rol)),
      tarif: (admin && r.tarif !== undefined && r.tarif !== '') ? Math.max(0, coreNum(r.tarif)) : tarifProduk(po, 'tarifPotong', st.upahPotong),
      upahId: '', catatan: teks(r.catatan, 300), dibuat: nowIso(), bahanList: bahanList.length ? JSON.stringify(bahanList) : '', asal: '' };
    store.append('Potong', rec);
    return rec;
  };
  function bersihBahan(list) {
    var out = [];
    (list instanceof Array ? list : []).slice(0, 12).forEach(function (b) {
      if (!b) return; var nama = teks(b.nama, 80).trim(); var qty = Math.max(0, coreNum(b.qty));
      if (nama && qty > 0) out.push({ nama: nama, qty: Math.round(qty * 1000) / 1000 });
    });
    return out;
  }

  /* ---------- stok bahan ---------- */
  function namaBahanBaku(nama) {
    /* pakai ejaan yang sudah ada kalau bahan ini pernah dicatat, supaya tidak muncul dua kartu untuk bahan yang sama */
    var k = coreNormBahan(nama); var ada = '';
    store.read('StokBahan').forEach(function (r) { if (!ada && coreNormBahan(r.bahan) === k) ada = r.bahan; });
    return ada || nama;
  }
  function satuanBahan(nama) {
    var k = coreNormBahan(nama); var s = '', tgl = '';
    store.read('StokBahan').forEach(function (r) { if (r.jenis === 'beli' && coreNormBahan(r.bahan) === k && r.satuan && String(r.tanggal || '') >= tgl) { s = r.satuan; tgl = String(r.tanggal || ''); } });
    return s;
  }
  function isiStok(r, lama) {
    var jenis = lama ? lama.jenis : (r.jenis === 'koreksi' ? 'koreksi' : 'beli');
    var bahan = teks(r.bahan, 80).trim(); if (!bahan) fail('Nama bahan wajib diisi.');
    bahan = namaBahanBaku(bahan);
    var tanggal = tglOk(r.tanggal) || today();
    var o = { jenis: jenis, tanggal: tanggal, bahan: bahan, catatan: teks(r.catatan, 300) };
    var punya = satuanBahan(bahan);
    if (jenis === 'beli') {
      var qty = coreNum(r.qty); if (!(qty > 0)) fail('Isi jumlah yang dibeli.');
      var satuan = SATUAN_BAHAN.indexOf(r.satuan) >= 0 ? r.satuan : (punya || 'kg');
      if (punya && satuan !== punya && !(lama && lama.satuan === punya && store.read('StokBahan').filter(function (x) { return x.jenis === 'beli' && coreNormBahan(x.bahan) === coreNormBahan(bahan); }).length <= 1))
        fail('Bahan ' + bahan + ' sudah dicatat dalam ' + punya + '. Satuan tidak bisa diganti. Pakai nama bahan lain kalau satuannya memang berbeda.');
      var harga = Math.max(0, coreNum(r.harga)); var total = r.total !== undefined && r.total !== '' ? Math.max(0, coreNum(r.total)) : Math.round(qty * harga);
      if (!harga && total && qty) harga = Math.round(total / qty);
      o.qty = Math.round(qty * 1000) / 1000; o.satuan = satuan; o.rol = Math.max(0, coreInt(r.rol)); o.harga = harga; o.total = total;
      o.supplier = teks(r.supplier, 80).trim(); o.invoice = teks(r.invoice, 60).trim(); o.sumber = teks(r.sumber, 60).trim(); o.alasan = '';
    } else {
      var k = coreNum(r.qty); if (!k) fail('Isi jumlah koreksi. Pakai tanda minus untuk mengurangi stok.');
      o.qty = Math.round(k * 1000) / 1000; o.satuan = punya || (SATUAN_BAHAN.indexOf(r.satuan) >= 0 ? r.satuan : 'kg'); o.rol = 0; o.harga = 0; o.total = 0;
      o.supplier = ''; o.invoice = ''; o.sumber = ''; o.alasan = ALASAN_KOREKSI[r.alasan] ? r.alasan : 'lain';
    }
    return o;
  }
  actions.saveStok = function (p) {
    var me = auth(p); mustAdmin(me);
    var r = p.stok || {};
    if (r.id && findRow('StokBahan', String(r.id)) && !r.baru) {
      var lama = findRow('StokBahan', String(r.id));
      store.update('StokBahan', lama.id, isiStok(r, lama));
      return findRow('StokBahan', lama.id);
    }
    var d = dedupe('StokBahan', r); if (d.ada) return d.ada;
    var rec = isiStok(r, null); rec.id = d.id; rec.dibuatOleh = me.id; rec.dibuat = nowIso(); rec.asal = '';
    store.append('StokBahan', rec);
    return rec;
  };
  /* "Cocokkan fisik": owner mengisi jumlah hasil hitung gudang, selisihnya dicatat sebagai koreksi */
  actions.cocokkanStok = function (p) {
    var me = auth(p); mustAdmin(me);
    var d = dedupe('StokBahan', { id: p.id }); if (d.ada) return d.ada;
    var nama = teks(p.bahan, 80).trim(); if (!nama) fail('Nama bahan wajib diisi.');
    var fisik = coreNum(p.fisik); if (p.fisik === '' || p.fisik === undefined || fisik < 0) fail('Isi jumlah hasil hitung fisik.');
    var ringkas = coreStok(store.read('Potong'), store.read('StokBahan'), settings()); var b = null;
    ringkas.forEach(function (x) { if (x.kunci === coreNormBahan(nama)) b = x; });
    var saldo = b ? b.saldo : 0; var selisih = Math.round((fisik - saldo) * 1000) / 1000;
    if (!selisih) return { sama: true };
    var rec = { id: d.id, jenis: 'koreksi', tanggal: tglOk(p.tanggal) || today(), bahan: b ? b.nama : nama, qty: selisih, satuan: b ? b.satuan : 'kg', rol: 0, harga: 0, total: 0,
      supplier: '', invoice: '', sumber: '', alasan: 'stok_opname', catatan: teks(p.catatan, 300) || ('Hitung fisik ' + fisik + ', catatan ' + saldo), dibuatOleh: me.id, dibuat: nowIso(), asal: '' };
    store.append('StokBahan', rec);
    return rec;
  };

  /* ---------- karyawan harian & gaji mingguan ---------- */
  actions.saveKaryawan = function (p) {
    var me = auth(p); mustAdmin(me);
    var k = p.karyawan || {};
    var nama = teks(k.nama, 60).trim(); if (!nama) fail('Nama karyawan wajib diisi.');
    var patch = { nama: nama, jabatan: teks(k.jabatan, 60).trim(), gajiHarian: Math.max(0, coreNum(k.gajiHarian)), lembur: Math.max(0, coreNum(k.lembur)), lemburSabtu: Math.max(0, coreNum(k.lemburSabtu)) };
    if (k.aktif !== undefined) patch.aktif = !!k.aktif;
    if (k.id && findRow('Karyawan', String(k.id)) && !k.baru) { store.update('Karyawan', String(k.id), patch); return findRow('Karyawan', String(k.id)); }
    var d = dedupe('Karyawan', k); if (d.ada) return d.ada;
    var rec = patch; rec.id = d.id; rec.aktif = true; rec.dibuat = nowIso(); rec.asal = '';
    store.append('Karyawan', rec);
    return rec;
  };
  function idGaji(periode, karyawanId, tanggal) { return 'gh' + coreHash(periode + '|' + karyawanId + '|' + tanggal) + String(tanggal).replace(/-/g, '').slice(2); }
  /* Simpan isian satu periode. Tiap orang tiap hari satu baris; menyimpan ulang memperbarui baris yang sama.
     Nominal dibekukan saat disimpan, jadi mengubah gaji harian karyawan tidak mengubah minggu yang sudah lunas. */
  actions.saveGaji = function (p) {
    var me = auth(p); mustAdmin(me);
    var per = corePeriode(p.periode); if (!per) fail('Periode tidak valid.');
    var baris = p.baris instanceof Array ? p.baris : []; if (!baris.length) fail('Tidak ada isian.');
    var ada = {}; store.read('GajiHarian').forEach(function (g) { ada[g.id] = g; });
    var tambah = []; var n = 0; var orang = [];
    /* periksa semuanya dulu, baru menulis: tidak boleh ada yang tersimpan separuh */
    baris.slice(0, 80).forEach(function (b) {
      var k = findRow('Karyawan', String(b.karyawanId || '')); if (!k) return;
      var terkunci = store.read('GajiHarian').some(function (g) { return g.periode === per.id && g.karyawanId === k.id && g.lunas; });
      if (terkunci) fail('Gaji ' + k.nama + ' periode ini sudah ditandai dibayar. Batalkan tanda dibayarnya dulu kalau mau diubah.');
      orang.push({ k: k, b: b });
    });
    orang.forEach(function (x) {
      var k = x.k, b = x.b;
      var hari = (b.hari && typeof b.hari === 'object') ? b.hari : {};
      var lemburJam = Math.max(0, coreNum(b.lemburJam)), sabtuJam = Math.max(0, coreNum(b.sabtuJam));
      /* baris impor memakai id dari aplikasi lama: perbarui baris itu, jangan membuat baris kedua untuk hari yang sama */
      var lama = {}; store.read('GajiHarian').forEach(function (g) { if (g.periode === per.id && g.karyawanId === k.id) lama[g.tanggal] = g; });
      per.dates.forEach(function (tg, i) {
        var status = STATUS_HARI[hari[tg]] !== undefined ? hari[tg] : (coreHariKe(tg) === 0 ? 'off' : 'full');
        var gaji = coreGajiHari(status, k.gajiHarian);
        /* jam lembur satu periode dicatat di baris hari pertama */
        var lj = i === 0 ? lemburJam : 0, sj = i === 0 ? sabtuJam : 0;
        var rec = { id: lama[tg] ? lama[tg].id : idGaji(per.id, k.id, tg), periode: per.id, karyawanId: k.id, tanggal: tg, status: status, gaji: gaji,
          lemburJam: lj, lemburTarif: lj ? k.lembur : 0, lemburTotal: Math.round(lj * k.lembur),
          sabtuJam: sj, sabtuTarif: sj ? k.lemburSabtu : 0, sabtuTotal: Math.round(sj * k.lemburSabtu), lunas: false };
        rec.jumlah = rec.gaji + rec.lemburTotal + rec.sabtuTotal;
        if (ada[rec.id]) store.update('GajiHarian', rec.id, rec);
        else { rec.dibuat = nowIso(); rec.asal = ''; tambah.push(rec); }
        n++;
      });
    });
    if (tambah.length) store.appendMany('GajiHarian', tambah);
    return { disimpan: n };
  };
  actions.lunasGaji = function (p) {
    var me = auth(p); mustAdmin(me);
    var per = corePeriode(p.periode); if (!per) fail('Periode tidak valid.');
    var ids = {}; (p.karyawanIds instanceof Array ? p.karyawanIds : []).forEach(function (x) { ids[String(x)] = 1; });
    var lunas = p.lunas !== false; var n = 0;
    store.read('GajiHarian').slice().forEach(function (g) { if (g.periode === per.id && ids[g.karyawanId] && !!g.lunas !== lunas) { store.update('GajiHarian', g.id, { lunas: lunas }); n++; } });
    return { diubah: n };
  };
  actions.hapusGaji = function (p) {
    var me = auth(p); mustAdmin(me);
    var per = corePeriode(p.periode); if (!per) fail('Periode tidak valid.');
    var kid = String(p.karyawanId || '');
    var rows = store.read('GajiHarian').filter(function (g) { return g.periode === per.id && g.karyawanId === kid; });
    if (rows.some(function (g) { return g.lunas; })) fail('Sudah ditandai dibayar. Batalkan tanda dibayarnya dulu.');
    rows.forEach(function (g) { store.remove('GajiHarian', g.id); });
    return { dihapus: rows.length };
  };

  /* ---------- kasbon ---------- */
  function orangKasbon(jenis, id) {
    if (jenis === 'harian') { var k = findRow('Karyawan', id); return k ? k.nama : ''; }
    var u = findUser(id); return u && (u.divisi === 'jahit' || u.divisi === 'potong') ? u.nama : '';
  }
  actions.createKasbon = function (p) {
    var me = auth(p); mustAdmin(me);
    var k = p.kasbon || {}; var d = dedupe('Kasbon', k); if (d.ada) return d.ada;
    var jenis = k.jenis === 'harian' ? 'harian' : 'maklon';
    var orangId = String(k.orangId || ''); var nama = orangKasbon(jenis, orangId); if (!nama) fail('Pilih orangnya.');
    var jumlah = Math.round(coreNum(k.jumlah)); if (!(jumlah > 0)) fail('Isi jumlah kasbon.');
    var rec = { id: d.id, tipe: 'kasbon', kasbonId: '', jenis: jenis, orangId: orangId, nama: nama, tanggal: tglOk(k.tanggal) || today(), periode: '', jumlah: jumlah,
      keterangan: teks(k.keterangan, 200), dibuatOleh: me.id, dibuat: nowIso(), asal: '' };
    store.append('Kasbon', rec);
    return rec;
  };
  actions.createCicilan = function (p) {
    var me = auth(p); mustAdmin(me);
    var c = p.cicilan || {}; var d = dedupe('Kasbon', c); if (d.ada) return d.ada;
    var induk = findRow('Kasbon', String(c.kasbonId || '')); if (!induk || induk.tipe !== 'kasbon') fail('Kasbon tidak ditemukan.');
    var info = null; coreKasbon(store.read('Kasbon')).forEach(function (x) { if (x.id === induk.id) info = x; });
    var jumlah = Math.round(coreNum(c.jumlah)); if (!(jumlah > 0)) fail('Isi jumlah cicilan.');
    if (jumlah > info.sisa) fail('Cicilan melebihi sisa kasbon (' + coreRupiah(info.sisa) + ').');
    var tanggal = tglOk(c.tanggal) || today();
    var periode = corePeriode(c.periode) ? String(c.periode) : coreMingguId(tanggal);
    var rec = { id: d.id, tipe: 'cicilan', kasbonId: induk.id, jenis: induk.jenis, orangId: induk.orangId, nama: induk.nama, tanggal: tanggal, periode: periode, jumlah: jumlah,
      keterangan: teks(c.keterangan, 200), dibuatOleh: me.id, dibuat: nowIso(), asal: '' };
    store.append('Kasbon', rec);
    return rec;
  };

  actions.createKirim = function (p) {
    var me = auth(p); mustAdmin(me);
    var k = p.kirim || {}; var d = dedupe('SlipKirim', k); if (d.ada) return d.ada;
    var po = openPO(k.poId);
    var maklon = findUser(String(k.maklonId || '')); if (!maklon || maklon.divisi !== 'jahit' || !maklon.aktif) fail('Pilih maklon jahit yang aktif.');
    var ukuran = strictSizes(k.ukuran, po, false);
    var total = coreSumSizes(ukuran); var wf = poClean(po);
    Object.keys(ukuran).forEach(function (s) { var u = wf.ukuran[s]; if (!u || ukuran[s] > u.potong - u.kirim) fail('Penugasan ' + s + ' melebihi hasil potong yang belum dikirim.'); if (u.qcOk + u.qcOffline + u.qcReject + u.qcPerbaikan > 0) fail('Ukuran ' + s + ' sudah masuk QC.'); });
    if (total <= 0) fail('Isi jumlah pcs yang dikirim.');
    var tanggal = tglOk(k.tanggal) || today();
    var st = settings();
    var rec = { id: d.id, noSlip: nextNo('SK', store.read('SlipKirim'), 'noSlip', tanggal), poId: po.id, maklonId: maklon.id, tanggal: tanggal,
      target: tglOk(k.target), ukuran: JSON.stringify(ukuran), total: total,
      upah: (k.upah === undefined || k.upah === '') ? tarifProduk(po, 'tarifJahit', st.upahJahit) : Math.max(0, coreNum(k.upah)),
      catatan: teks(k.catatan, 300), dibuatOleh: me.id, dibuat: nowIso() };
    store.append('SlipKirim', rec);
    return rec;
  };

  function upahJahitTerakhir(po, maklonId, st) {
    var best = null;
    store.read('SlipKirim').forEach(function (r) { if (r.poId === po.id && r.maklonId === maklonId && (!best || String(r.dibuat) >= String(best.dibuat))) best = r; });
    return best && coreNum(best.upah) > 0 ? best.upah : tarifProduk(po, 'tarifJahit', st.upahJahit);
  }

  actions.createSetor = function (p) {
    var me = auth(p); var admin = coreIsAdmin(me);
    var s = p.setor || {}; var d = dedupe('SlipSetor', s); if (d.ada) return d.ada;
    var cek = admin || me.divisi === 'qc';   /* admin & QC mencatat barang yang sudah mereka hitung sendiri */
    if (!cek && me.divisi !== 'jahit') fail('Hanya maklon jahit, QC, atau admin yang bisa mencatat setoran.');
    var maklonId = cek ? String(s.maklonId || '') : me.id;
    var maklon = findUser(maklonId); if (!maklon || maklon.divisi !== 'jahit') fail('Pilih maklon jahit.');
    var po = openPO(s.poId);
    var ukuran = strictSizes(s.ukuran, po, true);
    var total = coreSumSizes(ukuran);
    var rejectUkuran = categoryInput(s, 'rejectUkuran', 'reject', po, ukuran), reject = coreSumSizes(rejectUkuran);
    ensureSetorCapacity(po, maklonId, ukuran, rejectUkuran, '');
    if (total <= 0 && reject <= 0) fail('Isi jumlah pcs yang disetor.');
    var tanggal = tglOk(s.tanggal) || today();
    var st = settings();
    var upah = (admin && s.upah !== undefined && s.upah !== '') ? Math.max(0, coreNum(s.upah)) : upahJahitTerakhir(po, maklonId, st);
    /* Laporan dari maklon belum menjadi slip: belum ada nomor dan belum ada harga.
       Slip baru terbit saat QC/owner menghitung dan menerima, dengan harga yang diatur owner. */
    var rec = { id: d.id, noSlip: cek ? nextNo('SS', store.read('SlipSetor'), 'noSlip', tanggal) : '', poId: po.id, maklonId: maklonId, tanggal: tanggal,
      ukuran: JSON.stringify(ukuran), total: total, reject: reject, rejectUkuran: JSON.stringify(rejectUkuran), upah: cek ? upah : 0, catatan: teks(s.catatan, 300),
      status: cek ? 'diterima' : 'diajukan', dibuatOleh: me.id, dibuat: nowIso(),
      diprosesOleh: cek ? me.id : '', diprosesPada: cek ? nowIso() : '', upahId: '', workflowVersion: WORKFLOW_VERSION };
    store.append('SlipSetor', rec);
    return rec;
  };

  actions.prosesSetor = function (p) {
    var me = auth(p); var admin = coreIsAdmin(me);
    if (!admin && me.divisi !== 'qc') fail('Hanya QC atau admin yang bisa menerima setoran.');
    var rec = findRow('SlipSetor', String(p.id || '')); if (!rec) fail('Slip setor tidak ditemukan.');
    if (rec.status !== 'diajukan') {
      if (rec.diprosesOleh === me.id) return rec;          /* kirim ulang dari orang yang sama */
      fail('Slip ini sudah diproses oleh ' + ((findUser(rec.diprosesOleh) || {}).nama || 'orang lain') + '.');
    }
    var activePo = openPO(rec.poId);
    var patch = { diprosesOleh: me.id, diprosesPada: nowIso(), workflowVersion: WORKFLOW_VERSION };
    var frozenPending = sourceInLegacySettlement(rec.id);
    if (frozenPending && p.keputusan === 'tolak') fail('Laporan lama ini terikat pembayaran. Cocokkan riwayat sebelum membatalkan sumbernya.');
    if (p.keputusan === 'tolak') { patch.status = 'ditolak'; if (p.catatan !== undefined) patch.catatan = teks(p.catatan, 300); }
    else {
      patch.status = 'diterima';
      var uk = strictSizes(p.ukuran !== undefined ? p.ukuran : rec.ukuran, activePo, true);
      var rejInput = { rejectUkuran: p.rejectUkuran !== undefined ? p.rejectUkuran : rec.rejectUkuran, reject: p.reject !== undefined ? p.reject : rec.reject };
      var bad = categoryInput(rejInput, 'rejectUkuran', 'reject', activePo, uk);
      if (frozenPending) {
        var originalQty = sumMaps([coreMap(rec.ukuran), coreMap(rec.rejectUkuran)]), proposedQty = sumMaps([uk, bad]);
        Object.keys(sumMaps([originalQty, proposedQty])).forEach(function (size) { if (coreNum(originalQty[size]) !== coreNum(proposedQty[size])) fail('Jumlah laporan lama yang terikat pembayaran harus dipertahankan per ukuran. Rinci hasil baik dan reject atau cocokkan riwayat dahulu.'); });
      }
      patch.ukuran = JSON.stringify(uk); patch.total = coreSumSizes(uk); patch.reject = coreSumSizes(bad); patch.rejectUkuran = JSON.stringify(bad);
      ensureSetorCapacity(activePo, rec.maklonId, uk, bad, rec.id);
      if (p.catatan !== undefined) patch.catatan = teks(p.catatan, 300);
      var tot = patch.total !== undefined ? patch.total : rec.total;
      var rej = patch.reject !== undefined ? patch.reject : rec.reject;
      if (tot <= 0 && rej <= 0) fail('Jumlah pcs tidak boleh 0 semua.');
      /* slip terbit di sini: nomor diberikan, harga diambil dari yang diatur owner (kiriman terakhir, lalu produk, lalu bawaan) */
      var poRec = findRow('PO', rec.poId) || { id: rec.poId, produkId: '' };
      if (admin && p.upah !== undefined && p.upah !== '') patch.upah = Math.max(0, coreNum(p.upah));
      else if (!(rec.upah > 0)) patch.upah = upahJahitTerakhir(poRec, rec.maklonId, settings());
      if (!rec.noSlip) patch.noSlip = nextNo('SS', store.read('SlipSetor'), 'noSlip', today());
    }
    store.update('SlipSetor', rec.id, patch);
    return findRow('SlipSetor', rec.id);
  };

  /* harga per pcs hanya bisa diatur owner/admin, dan hanya selama belum dibayar */
  actions.ubahHarga = function (p) {
    var me = auth(p); mustAdmin(me);
    var sheet = String(p.sheet || ''); var harga = Math.max(0, coreNum(p.harga));
    if (sheet !== 'SlipSetor' && sheet !== 'Potong') fail('Tidak bisa diubah.');
    var rec = findRow(sheet, String(p.id || '')); if (!rec) fail('Data tidak ditemukan.');
    if (correctedSource(sheet, rec.id)) fail('Sumber memiliki riwayat koreksi fisik dan harus tetap utuh.');
    if (rec.upahId || sourcePaid(rec.id)) fail('Sudah masuk slip upah. Batalkan slip upahnya dulu kalau harga mau diubah.');
    if (sheet === 'SlipSetor' && store.read('QC').some(function (q) { return q.setorId === rec.id; })) fail('Tarif hitungan sudah dibekukan saat QC. Hapus QC yang belum dibayar dahulu jika perlu koreksi.');
    if (sheet === 'SlipSetor') {
      if (rec.status !== 'diterima') fail('Slip belum terbit. Harga diatur setelah setoran dihitung.');
      store.update(sheet, rec.id, { upah: harga });
    } else store.update(sheet, rec.id, { tarif: harga });
    return { ok: true };
  };

  actions.createQC = function (p) {
    var me = auth(p); var admin = coreIsAdmin(me);
    if (!admin && me.divisi !== 'qc') fail('Hanya QC atau admin.');
    var r = p.qc || {}; var d = dedupe('QC', r); if (d.ada) return d.ada;
    var po = openPO(r.poId);
    var wf = poClean(po), setorId = String(r.setorId || ''), repairQcId = String(r.repairQcId || '');
    var base = repairQcId ? findRow('QC', repairQcId) : null;
    if (r.dariPerbaikan && !repairQcId) fail('Pilih catatan QC asal perbaikan.');
    if (repairQcId) { if (!base || base.repairQcId || base.poId !== po.id) fail('Asal perbaikan tidak sah.'); if (setorId && setorId !== base.setorId) fail('Hitungan asal perbaikan tidak cocok.'); setorId = base.setorId; }
    var slip = findRow('SlipSetor', setorId);
    var legacyRepair = !!(base && coreLegacyInfo(base, 'qc') && !base.setorId);
    if (!legacyRepair && (!slip || slip.poId !== po.id || slip.status !== 'diterima')) fail('Pilih slip hitung fisik yang sudah diterima.');
    var tanggalQc = tglOk(r.tanggal) || today();
    if (slip && tanggalQc < String(slip.tanggal || '')) fail('Tanggal QC tidak boleh sebelum tanggal hitung fisik.');
    if (base && tanggalQc < String(base.tanggal || '')) fail('Tanggal hasil perbaikan tidak boleh sebelum QC asal.');
    var mk = findUser(legacyRepair ? base.maklonId : slip.maklonId); if (!mk || mk.divisi !== 'jahit') fail('Maklon asal hitungan tidak ditemukan.');
    var ukuran = strictSizes(r.ukuran, po, true), basis = legacyRepair ? coreQcMaps(base, null, []).perbaikan : coreMap(slip.ukuran);
    var off = categoryInput(r, 'offlineUkuran', 'offline', po, basis), rej = categoryInput(r, 'rejectUkuran', 'reject', po, basis);
    var per = categoryInput(r, 'perbaikanUkuran', 'perbaikan', po, basis), inspected = sumMaps([ukuran, off, rej, per]);
    if (!coreSumSizes(inspected)) fail('Isi jumlah pcs hasil QC.');
    if (repairQcId) {
      if (coreSumSizes(per)) fail('Hasil perbaikan harus berupa OK, offline, atau reject.');
      var remain = coreQcMaps(base, slip, []).perbaikan;
      store.read('QC').forEach(function (q) { if (q.repairQcId === repairQcId) { var used = coreQcMaps(q, slip, []).perbaikan; remain = sumMaps([remain, used]); } });
      per = {};
      Object.keys(inspected).forEach(function (s) { if (inspected[s] > coreNum(remain[s])) fail('Hasil perbaikan ' + s + ' melebihi sisa pada QC asal.'); per[s] = -inspected[s]; });
    } else {
      var previous = {};
      store.read('QC').forEach(function (q) { if (q.setorId !== setorId || q.repairQcId || q.autoFromCount && coreLegacyInfo(q, 'qc')) return; var maps = coreQcMaps(q, slip, []); previous = sumMaps([previous, maps.ok, maps.offline, maps.perbaikan, maps.reject]); });
      Object.keys(inspected).forEach(function (s) {
        var u = wf.ukuran[s]; if (!u || !u.readyQC) fail('Ukuran ' + s + ' belum lengkap dihitung atau masih ada penugasan/setoran tertunda.');
        if (coreLegacyQcBlocked(slip, store.read('QC'), s)) fail('Hitungan lama ini memiliki QC tanpa hubungan pasti. Cocokkan sumber historis sebelum memeriksa ulang.');
        if (previous[s]) fail('Hitungan ukuran ' + s + ' pada slip ini sudah di-QC.');
        if (inspected[s] !== coreNum(basis[s])) fail('OK + offline + perbaikan + reject ukuran ' + s + ' harus tepat seluruh hitungan slip (' + coreNum(basis[s]) + ').');
      });
    }
    var rec = { id: d.id, poId: po.id, userId: me.id, maklonId: mk.id, tanggal: tanggalQc, ukuran: JSON.stringify(ukuran),
      total: coreSumSizes(ukuran), offline: coreSumSizes(off), perbaikan: coreSumSizes(per), reject: coreSumSizes(rej), catatan: teks(r.catatan, 300), dibuat: nowIso(), setorId: setorId,
      offlineUkuran: JSON.stringify(off), perbaikanUkuran: JSON.stringify(per), rejectUkuran: JSON.stringify(rej), repairQcId: repairQcId, workflowVersion: WORKFLOW_VERSION };
    store.append('QC', rec);
    return rec;
  };

  actions.createGudang = function (p) {
    var me = auth(p); mustAdmin(me);
    var r = p.gudang || {}; var d = dedupe('Gudang', r); if (d.ada) return d.ada;
    /* BigSeller is an external bookkeeping step; a completed production PO can still be recorded here. */
    var po = findRow('PO', String(r.poId || '')); if (!po || po.status === 'batal') fail('PO tidak tersedia.');
    var ukuran = strictSizes(r.ukuran, po, false), wf = poClean(po);
    var total = coreSumSizes(ukuran);
    Object.keys(ukuran).forEach(function (s) { if (!wf.ukuran[s] || ukuran[s] > wf.ukuran[s].stok) fail('Input BigSeller ' + s + ' melebihi OK QC yang belum dicatat.'); });
    if (total <= 0) fail('Isi jumlah pcs yang diinput ke BigSeller.');
    var rec = { id: d.id, poId: po.id, userId: me.id, tanggal: tglOk(r.tanggal) || today(), ukuran: JSON.stringify(ukuran), total: total,
      catatan: teks(r.catatan, 300), dibuat: nowIso() };
    store.append('Gudang', rec);
    return rec;
  };

  actions.createUpah = function (p) {
    var me = auth(p); mustAdmin(me);
    var u = p.upah || {}; var d = dedupe('SlipUpah', u); if (d.ada) return d.ada;
    var peg = findUser(String(u.pegawaiId || '')); if (!peg) fail('Pegawai tidak ditemukan.');
    var jenis = peg.divisi === 'jahit' ? 'jahit' : (peg.divisi === 'potong' ? 'potong' : '');
    if (!jenis) fail('Slip upah hanya untuk maklon jahit atau tukang potong.');
    var seen = {}; var ids = (u.itemIds instanceof Array ? u.itemIds : []).map(String).filter(function (x) { if (seen[x]) return false; seen[x] = 1; return true; });
    if (!ids.length) fail('Pilih minimal satu item.');
    var tanggal = tglOk(u.tanggal) || today();
    var earned = payroll(), picked = [], wf = workflow();
    ids.forEach(function (id) {
      var s = earned.filter(function (r) { return r.id === id; })[0];
      if (!s) fail('Ada item yang sudah tidak ada. Muat ulang lalu coba lagi.');
      if (s.pegawaiId !== peg.id || s.jenis !== jenis) fail('Ada item yang bukan milik ' + peg.nama + '.');
      if (s.issues.length || (wf[s.poId] && wf[s.poId].issues.length)) fail('Data upah perlu ditinjau sebelum dibayar.');
      if (!(s.available > 0)) fail('Ada item yang sudah dibayar atau tidak mempunyai hak upah. Muat ulang lalu coba lagi.');
      if (!(s.rate > 0)) fail('Atur tarif hitungan sebelum membuat slip upah.');
      var item = copy(s); item.total = s.available; item.upah = s.rate; item.tarif = s.rate; item.earnedTotal = s.total;
      item.ukuran = {}; if (s.size) item.ukuran[s.size] = s.available; else item.ukuran = s.ukuran;
      picked.push(item);
    });
    var totalQty = 0, totalUpah = 0;
    picked.forEach(function (s) { totalQty += s.total; totalUpah += s.total * s.rate; });
    var potongan = Math.max(0, coreNum(u.potongan));
    if (potongan > totalUpah) fail('Potongan tidak boleh melebihi jumlah upah.');
    var rec = { id: d.id, noSlip: nextNo('SU', store.read('SlipUpah'), 'noSlip', tanggal), pegawaiId: peg.id, jenis: jenis, tanggal: tanggal,
      itemIds: JSON.stringify(ids), totalQty: totalQty, totalUpah: totalUpah, potongan: potongan, dibayar: totalUpah - potongan,
      catatan: teks(u.catatan, 300), dibuatOleh: me.id, dibuat: nowIso(), items: JSON.stringify(picked) };
    store.append('SlipUpah', rec);
    return rec;
  };

  /* tandai item lama sebagai sudah lunas tanpa membuat slip (dipakai saat merapikan data impor) */
  actions.tandaiLunas = function (p) {
    var me = auth(p); mustAdmin(me);
    var sampai = tglOk(p.sampai); if (!sampai) fail('Tanggal tidak valid.');
    if (store.read('Potong').some(function (s) { return !s.upahId && String(s.tanggal) <= sampai && correctedSource('Potong', s.id); })) fail('Ada sumber potong dengan koreksi fisik. Pembayaran harus memakai slip upah dari sumber asli.');
    var n = 0;
    store.read('SlipSetor').slice().forEach(function (s) { if (!s.upahId && s.status === 'diterima' && String(s.tanggal) <= sampai) { store.update('SlipSetor', s.id, { upahId: LUNAS_LAMA }); n++; } });
    store.read('Potong').slice().forEach(function (s) { if (!s.upahId && String(s.tanggal) <= sampai) { store.update('Potong', s.id, { upahId: LUNAS_LAMA }); n++; } });
    var qcRows = store.read('QC');
    qcRows.slice().forEach(function (q) { var base = q.repairQcId ? qcRows.filter(function (r) { return r.id === q.repairQcId; })[0] : q; if (coreLegacyInfo(base, 'qc') && !q.upahId && coreNum(q.total) > 0 && String(q.tanggal) <= sampai) { store.update('QC', q.id, { upahId: LUNAS_LAMA }); n++; } });
    store.read('GudangLama').slice().forEach(function (g) { if (coreLegacyInfo(g, 'gudang') && !g.qcId && g.status === 'ok' && !g.upahId && String(g.tanggal) <= sampai) { store.update('GudangLama', g.id, { upahId: LUNAS_LAMA }); n++; } });
    return { ditandai: n };
  };

  actions.deleteRecord = function (p) {
    var me = auth(p); var admin = coreIsAdmin(me);
    var sheet = String(p.sheet || ''); var id = String(p.id || '');
    var rec = findRow(sheet, id); if (!rec) return { ok: true, sudah: true };
    if (sheet === 'KoreksiRiwayat' || correctedSource(sheet, id)) fail('Sumber dan riwayat koreksi fisik tidak dapat dihapus.');
    if (['Potong', 'SlipKirim', 'SlipSetor', 'QC'].indexOf(sheet) >= 0) openPO(rec.poId);
    if (sheet === 'Potong') {
      if (rec.upahId || sourcePaid(rec.id)) fail('Sudah masuk slip upah, tidak bisa dihapus.');
      if (!admin && rec.userId !== me.id) fail('Hanya bisa menghapus catatan sendiri.');
      if (store.read('SlipKirim').some(function (r) { return r.poId === rec.poId && Object.keys(coreMap(rec.ukuran)).some(function (s) { return coreNum(coreMap(r.ukuran)[s]) > 0; }); })) fail('Hasil potong sudah mempunyai penugasan. Hapus tahap berikutnya dahulu.');
    } else if (sheet === 'QC') {
      if (!admin && rec.userId !== me.id) fail('Hanya bisa menghapus catatan sendiri.');
      if (sourcePaid(rec.setorId) || sourcePaid('qc:' + (rec.repairQcId || rec.id))) fail('Hitungan asal QC sudah dibayar atau terikat pembayaran lama. Koreksi perlu pencocokan riwayat.');
      if (store.read('QC').some(function (q) { return q.repairQcId === rec.id; })) fail('QC sudah mempunyai hasil perbaikan. Hapus hasil perbaikan terlebih dahulu.');
      var remainingQC = store.read('QC').filter(function (q) { return q.id !== id; });
      var after = coreWorkflow(store.read('PO'), store.read('Potong'), store.read('SlipKirim'), store.read('SlipSetor'), remainingQC, store.read('Gudang'), legacyExtras())[rec.poId];
      if (after && Object.keys(after.ukuran).some(function (s) { return after.ukuran[s].stokLedger < 0; })) fail('OK QC sudah dicatat ke BigSeller. Koreksi catatan BigSeller terlebih dahulu.');
    } else if (sheet === 'Gudang') {
      if (!admin) fail('Hanya admin.');
    } else if (sheet === 'SlipSetor') {
      if (rec.upahId || sourcePaid(rec.id)) fail('Slip ini sudah masuk slip upah, tidak bisa dihapus.');
      if (!admin && (rec.maklonId !== me.id || rec.status !== 'diajukan')) fail('Slip yang sudah diproses hanya bisa dihapus admin.');
      if (store.read('QC').some(function (q) { return q.setorId === rec.id; })) fail('Hitungan sudah mempunyai QC. Hapus QC terlebih dahulu.');
    } else if (sheet === 'SlipKirim') {
      if (!admin) fail('Hanya admin.');
      if (store.read('SlipSetor').some(function (r) { return r.poId === rec.poId && r.maklonId === rec.maklonId && r.status !== 'ditolak'; })) fail('Penugasan sudah mempunyai laporan/setoran. Hapus tahap berikutnya dahulu.');
    } else if (sheet === 'SlipUpah') {
      if (!admin) fail('Hanya admin.');
      if (store.read('LegacySettlement').some(function (b) { return b.paymentRef === rec.id; })) fail('Slip upah historis dipertahankan sebagai bukti pembayaran dan tidak dapat dihapus.');
      var sh = rec.jenis === 'jahit' ? 'SlipSetor' : 'Potong';
      if (!coreParseJSON(rec.items, []).length) coreParseJSON(rec.itemIds, []).forEach(function (sid) { var src = findRow(sh, sid); if (src && src.upahId === rec.id) store.update(sh, sid, { upahId: '' }); });
    } else if (sheet === 'PO') {
      if (!admin) fail('Hanya admin.');
      var used = ['Potong', 'SlipKirim', 'SlipSetor', 'QC', 'Gudang', 'GudangLama', 'LegacySettlement'].some(function (s) { return store.read(s).some(function (r) { return r.poId === id; }); });
      if (used) fail('PO sudah punya catatan produksi. Ubah statusnya menjadi Batal saja.');
      if (findRow('Gambar', id)) store.remove('Gambar', id);
    } else if (sheet === 'Produk') {
      if (!admin) fail('Hanya admin.');
      if (store.read('PO').some(function (r) { return r.produkId === id; })) fail('Produk sudah dipakai PO. Nonaktifkan saja.');
      if (findRow('Gambar', id)) store.remove('Gambar', id);
    } else if (sheet === 'StokBahan') {
      if (!admin) fail('Hanya admin.');
    } else if (sheet === 'Karyawan') {
      if (!admin) fail('Hanya admin.');
      if (store.read('GajiHarian').some(function (g) { return g.karyawanId === id; }) || store.read('Kasbon').some(function (k) { return k.jenis === 'harian' && k.orangId === id; }))
        fail('Karyawan ini sudah punya catatan gaji atau kasbon. Nonaktifkan saja.');
    } else if (sheet === 'Kasbon') {
      if (!admin) fail('Hanya admin.');
      if (rec.tipe === 'kasbon' && store.read('Kasbon').some(function (k) { return k.tipe === 'cicilan' && k.kasbonId === id; })) fail('Kasbon ini sudah punya cicilan. Hapus cicilannya dulu.');
    } else fail('Tidak bisa dihapus.');
    store.remove(sheet, id);
    return { ok: true };
  };

  /* ---------- impor data lama ---------- */
  actions.importRows = function (p) {
    var me = adminAtauPemasangan(p);
    var sheet = String(p.sheet || ''); if (!SCHEMA[sheet] || ['Pengaturan','Gambar','LegacySettlement','MigrasiJournal','GudangLama','KoreksiRiwayat'].indexOf(sheet) >= 0) fail('Sheet tidak dikenal.');
    var rows = p.rows instanceof Array ? p.rows : [];
    var existing = {}; store.read(sheet).forEach(function (r) { existing[r.id] = 1; });
    var add = []; var nextSettings = null;
    if (p.ukuran instanceof Array && p.ukuran.length) {
      /* pemasangan baru: pakai daftar ukuran dari data lama. Kalau sudah ada PO, gabungkan saja. */
      var st = settings(); var set = {};
      (store.read('PO').length ? st.ukuran : []).concat(p.ukuran).forEach(function (x) { x = String(x).trim().toUpperCase(); if (x) set[x] = 1; });
      st.ukuran = coreSizeOrder(Object.keys(set)); nextSettings = st;
    }
    if (!me && p.linkApp) {
      /* saat pemasangan, alamat aplikasi ikut disimpan supaya tersalin otomatis waktu owner membuat akun pegawai */
      var alamat = teks(p.linkApp, 300).trim();
      if (/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(alamat)) { var st2 = nextSettings || settings(); st2.linkApp = alamat; nextSettings = st2; }
    }
    rows.forEach(function (r) {
      if (!r || !idOk(r.id) || existing[r.id]) return;
      var o = {};
      SCHEMA[sheet].forEach(function (c) {
        var v = r[c]; if (v && typeof v === 'object') v = JSON.stringify(v);
        if (v === undefined || v === null) v = TYPES[c] === 'num' ? 0 : (TYPES[c] === 'bool' ? false : '');
        o[c] = v;
      });
      if (sheet === 'Pegawai') {
        if (!DIVISI[o.divisi] || DIVISI[o.divisi].admin) return;       /* impor tidak boleh membuat akun admin */
        /* pegawai dari impor selalu masuk tanpa PIN dan belum bisa login sampai owner membuatkan PIN */
        o.pin = '';
        o.token = ''; o.gagal = 0; o.kunci = ''; o.aktif = true;
      }
      if (sheet === 'Produk' || sheet === 'PO') o.gambar = '';
      if (SCHEMA[sheet].indexOf('asal') >= 0) o.asal = 'lama';
      existing[o.id] = 1; add.push(o);
    });
    if (store.validateRows) {
      store.validateRows(sheet, add);
      if (nextSettings) store.validateRows('Pengaturan', Object.keys(nextSettings).map(function (k) { return { key: k, value: JSON.stringify(nextSettings[k]) }; }));
    }
    if (nextSettings) store.setSettings(nextSettings);
    if (add.length) store.appendMany(sheet, add);
    return { ditambah: add.length, dilewati: rows.length - add.length, ids: sheet === 'Pegawai' ? add.map(function (r) { return r.id; }) : undefined };
  };

  /* ---------- pindah dari aplikasi lama: isi ulang data impor ----------
     Baris yang datang dari aplikasi lama dibuang lalu diganti data terbaru dari aplikasi lama.
     Baris yang dibuat di aplikasi ini tidak disentuh. Semua diperiksa dulu; kalau ada yang janggal, tidak ada yang ditulis.
     Boleh diulang kapan saja selama divisi masih bekerja di aplikasi lama. */
  function barisLama(sheet, r) {
    if (r.asal === 'lama') return true;
    if (r.asal) return false;
    /* baris impor sebelum versi 1.3 belum punya penanda: dikenali dari pembuatnya yang kosong */
    if (sheet === 'PO' || sheet === 'SlipKirim' || sheet === 'SlipSetor') return !r.dibuatOleh;
    if (sheet === 'QC' || sheet === 'Gudang') return !r.userId;
    if (sheet === 'GudangLama') return !!coreLegacyInfo(r, 'gudang');
    if (sheet === 'Potong') return /^pt[0-9a-z]{6,18}$/.test(String(r.id));
    return false;
  }
  actions.gantiImpor = function (p) {
    var me = auth(p); if (me.divisi !== 'owner') fail('Hanya owner yang boleh memindahkan data dari aplikasi lama.');
    var data = (p.data && typeof p.data === 'object') ? p.data : {};
    var sheets = SHEET_IMPOR.filter(function (s) { return data[s] instanceof Array; });
    if (!sheets.length) fail('Tidak ada data untuk dipindahkan.');
    var next = {}; var hasil = {};
    sheets.forEach(function (sheet) {
      var lama = store.read(sheet); var asli = lama.filter(function (r) { return !barisLama(sheet, r); });
      var idAsli = {}; var nomor = {}; var kolNo = sheet === 'PO' ? 'noPO' : ((sheet === 'SlipKirim' || sheet === 'SlipSetor') ? 'noSlip' : '');
      asli.forEach(function (r) { idAsli[r.id] = 1; if (kolNo && r[kolNo]) nomor[r[kolNo]] = 1; });
      var lamaById = {}; lama.forEach(function (r) { lamaById[r.id] = r; });
      var masuk = []; var seen = {};
      data[sheet].forEach(function (r) {
        if (!r || !idOk(r.id) || idAsli[r.id] || seen[r.id]) return;
        seen[r.id] = 1;
        var o = {};
        SCHEMA[sheet].forEach(function (c) {
          var v = r[c]; if (v && typeof v === 'object') v = JSON.stringify(v);
          if (v === undefined || v === null) v = TYPES[c] === 'num' ? 0 : (TYPES[c] === 'bool' ? false : '');
          o[c] = v;
        });
        o.asal = 'lama';
        var dulu = lamaById[o.id];
        if (sheet === 'PO') o.gambar = dulu ? dulu.gambar : '';
        /* pembayaran yang sudah dicatat di aplikasi ini tetap menempel pada itemnya */
        if (['SlipSetor','Potong','QC','GudangLama'].indexOf(sheet) >= 0 && dulu && dulu.upahId) o.upahId = dulu.upahId;
        if (kolNo && o[kolNo]) { while (nomor[o[kolNo]]) o[kolNo] = o[kolNo] + 'L'; nomor[o[kolNo]] = 1; }
        masuk.push(o);
      });
      next[sheet] = asli.concat(masuk);
      hasil[sheet] = { dibuang: lama.length - asli.length, masuk: masuk.length, tetap: asli.length };
    });
    function isi(sheet) { return next[sheet] || store.read(sheet); }
    store.read('KoreksiRiwayat').forEach(function (correction) {
      var source = isi(correction.sheet).filter(function (r) { return r.id === correction.rowId; })[0];
      if (!source || typeof coreHistorySourceHash !== 'function' || coreHistorySourceHash(correction.sheet, source) !== correction.sourceHash) fail('Tidak jadi dipindahkan: sumber koreksi fisik harus dipertahankan tanpa perubahan.');
    });
    var poIds = {}; isi('PO').forEach(function (r) { poIds[r.id] = 1; });
    ['Potong', 'SlipKirim', 'SlipSetor', 'QC', 'Gudang', 'GudangLama'].forEach(function (sheet) {
      var yatim = isi(sheet).filter(function (r) { return !poIds[r.poId]; }).length;
      if (yatim) fail('Tidak jadi dipindahkan: ' + yatim + ' catatan ' + sheet + ' menunjuk PO yang tidak ada di data baru. Tidak ada yang diubah.');
    });
    var setorIds = {}, potongIds = {}, jahitSources = {};
    isi('SlipSetor').forEach(function (r) { setorIds[r.id] = 1; }); isi('Potong').forEach(function (r) { potongIds[r.id] = 1; });
    Object.keys(setorIds).forEach(function (id) { jahitSources[id] = 1; });
    isi('QC').forEach(function (q) { if (coreLegacyInfo(q, 'qc') && !q.repairQcId) jahitSources['qc:' + q.id] = 1; });
    isi('GudangLama').forEach(function (g) { if (coreLegacyInfo(g, 'gudang') && !g.qcId && g.status === 'ok') jahitSources['gudanglama:' + g.id] = 1; });
    store.read('SlipUpah').forEach(function (u) {
      var src = u.jenis === 'jahit' ? jahitSources : potongIds;
      var snapshots = coreParseJSON(u.items, []), ids = snapshots.length ? snapshots.map(function (r) { return r.sourceId; }) : coreParseJSON(u.itemIds, []);
      ids.forEach(function (id) { if (!src[id]) fail('Tidak jadi dipindahkan: slip upah ' + u.noSlip + ' memuat item yang tidak ada di data baru. Tidak ada yang diubah.'); });
    });
    isi('QC').forEach(function (q) { if (q.setorId && !setorIds[q.setorId]) fail('Tidak jadi dipindahkan: ada hasil QC yang menunjuk slip setor yang tidak ada di data baru. Tidak ada yang diubah.'); });
    /* Re-import cannot rewrite receipts underlying an actual payment (including LAMA markers). */
    var paidSources = {};
    payroll().forEach(function (r) { if (r.paidQty || r.overpaidQty || r.legacyPaid) paidSources[r.sourceId] = true; });
    function sameFields(a, b, fields) {
      return b && fields.every(function (f) {
        if (/Ukuran$/.test(f) || f === 'ukuran') { var ma = coreMap(a[f]), mb = coreMap(b[f]), keys = Object.keys(sumMaps([ma, mb])).sort(); return keys.every(function (s) { return coreNum(ma[s]) === coreNum(mb[s]); }); }
        if (TYPES[f] === 'num') return coreNum(a[f]) === coreNum(b[f]);
        if (TYPES[f] === 'bool') return (a[f] === true || /^(true|ya|1)$/i.test(String(a[f]))) === (b[f] === true || /^(true|ya|1)$/i.test(String(b[f])));
        if (f === 'imporSumber') return JSON.stringify(coreMap(a[f])) === JSON.stringify(coreMap(b[f]));
        return String(a[f] === undefined ? '' : a[f]) === String(b[f] === undefined ? '' : b[f]);
      });
    }
    ['SlipSetor', 'Potong', 'QC', 'GudangLama'].forEach(function (sheet) {
      if (!next[sheet]) return; var indexNext = {}; next[sheet].forEach(function (r) { indexNext[r.id] = r; });
      var fields = sheet === 'QC' ? ['poId','setorId','maklonId','tanggal','ukuran','total','offline','perbaikan','reject','offlineUkuran','perbaikanUkuran','rejectUkuran','repairQcId','upah','workflowVersion','imporSumber','autoFromCount'] :
        (sheet === 'SlipSetor' ? ['poId','maklonId','tanggal','ukuran','total','reject','rejectUkuran','upah','status','workflowVersion','imporSumber'] : sheet === 'GudangLama' ? ['poId','maklonId','tanggal','ukuran','total','status','upah','qcId','workflowVersion','imporSumber'] : ['poId','userId','tanggal','ukuran','total','tarif']);
      store.read(sheet).forEach(function (r) { var src = sheet === 'QC' ? r.setorId : sheet === 'GudangLama' ? 'gudanglama:' + r.id : r.id, typedQc = sheet === 'QC' ? 'qc:' + (r.repairQcId || r.id) : '', frozenBaseline = sourceInLegacySettlement(src) || sourceInLegacySettlement(typedQc); if ((paidSources[src] || paidSources[typedQc] || r.upahId || frozenBaseline) && !sameFields(r, indexNext[r.id], fields)) fail('Tidak jadi dipindahkan: catatan ' + r.id + ' terkait pembayaran yang sudah dicatat. Batalkan pembayaran terkait sebelum koreksi.'); });
    });
    var proposed = coreWorkflow(isi('PO'), isi('Potong'), isi('SlipKirim'), isi('SlipSetor'), isi('QC'), isi('Gudang'), { gudangLama: isi('GudangLama'), settlements: store.read('LegacySettlement'), historyCorrections: store.read('KoreksiRiwayat') });
    var touched = {}; sheets.forEach(function (sheet) { data[sheet].forEach(function (r) { if (sheet === 'PO') touched[r.id] = true; else if (r.poId) touched[r.poId] = true; }); });
    Object.keys(touched).forEach(function (id) { var w = proposed[id]; if (w && w.issues.length) fail('Tidak jadi dipindahkan: ' + w.issues[0]); });
    isi('PO').forEach(function (r) { if (touched[r.id] && r.status === 'selesai' && (!proposed[r.id] || !proposed[r.id].complete)) fail('Tidak jadi dipindahkan: PO ' + r.noPO + ' ditandai selesai tetapi proses produksinya belum lengkap.'); });
    var karIds = {}; isi('Karyawan').forEach(function (k) { karIds[k.id] = 1; });
    if (isi('GajiHarian').some(function (g) { return !karIds[g.karyawanId]; })) fail('Tidak jadi dipindahkan: ada catatan gaji untuk karyawan yang tidak ada di data baru. Tidak ada yang diubah.');
    var s = p.pengaturan; var nextSettings = null;
    if (s && typeof s === 'object') {
      var st = settings();
      if (s.stokKuning !== undefined) st.stokKuning = Math.max(0, coreNum(s.stokKuning));
      if (s.stokMerah !== undefined) st.stokMerah = Math.min(st.stokKuning, Math.max(0, coreNum(s.stokMerah)));
      if (s.stokMulai !== undefined) st.stokMulai = coreTglOk(s.stokMulai);
      if (s.bahanSembunyi instanceof Array) st.bahanSembunyi = s.bahanSembunyi.map(function (x) { return teks(x, 80).trim(); }).filter(Boolean);
      if (s.ukuran instanceof Array && s.ukuran.length) { var set = {}; st.ukuran.concat(s.ukuran).forEach(function (x) { x = String(x).trim().toUpperCase(); if (x) set[x] = 1; }); st.ukuran = coreSizeOrder(Object.keys(set)); }
      nextSettings = st;
    }
    /* Kapasitas adaptor juga dicek untuk SEMUA tabel/pengaturan sebelum penggantian pertama. */
    if (store.validateRows) {
      sheets.forEach(function (sheet) { store.validateRows(sheet, next[sheet]); });
      if (nextSettings) store.validateRows('Pengaturan', Object.keys(nextSettings).map(function (k) { return { key: k, value: JSON.stringify(nextSettings[k]) }; }));
    }
    if (p.coba) return { coba: true, hasil: hasil };
    sheets.forEach(function (sheet) { store.replaceAll(sheet, next[sheet]); });
    if (nextSettings) store.setSettings(nextSettings);
    return { hasil: hasil };
  };

  /* ---------- slip untuk PDF ---------- */
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function sizeTable(ukuranObj, total, sizes) {
    var keys = coreSizeOrder(Object.keys(ukuranObj), sizes).filter(function (k) { return ukuranObj[k]; });
    if (!keys.length) return '<p><b>Total: ' + coreRibuan(total) + ' pcs</b></p>';
    var th = '', td = '';
    keys.forEach(function (k) { th += '<th>' + esc(k) + '</th>'; td += '<td>' + coreRibuan(ukuranObj[k]) + '</td>'; });
    return '<table class="uk"><tr>' + th + '<th>Total</th></tr><tr>' + td + '<td><b>' + coreRibuan(total) + '</b></td></tr></table>';
  }
  function slipHtml(type, rec, ctx) {
    var st = ctx.settings;
    var css = 'body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:24px}h1{font-size:16px;margin:0 0 2px}' +
      '.kop{border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}.kop small{color:#555}.judul{font-size:15px;font-weight:bold;margin:8px 0}' +
      'table{border-collapse:collapse;width:100%}table.info td{padding:3px 6px 3px 0;vertical-align:top}table.info td:first-child{width:110px;color:#555}' +
      'table.uk th,table.uk td{border:1px solid #444;padding:5px;text-align:center}table.uk th{background:#eee}' +
      'table.rinci th,table.rinci td{border:1px solid #444;padding:5px}table.rinci th{background:#eee;text-align:left}' +
      '.ttd{margin-top:36px;width:100%}.ttd td{width:33%;text-align:center;padding-top:48px}.ttd span{display:block;border-top:1px solid #111;padding-top:4px}' +
      '.total{font-size:14px;font-weight:bold;text-align:right;margin-top:10px}.cat{margin-top:10px;color:#333}';
    /* kepala slip sama dengan slip mingguan: nama di kop dan baris kecil di bawahnya (bawaan SOLDIER APPAREL / SOLDIERAPPAREL.ID) */
    var kop = '<div class="kop"><h1>' + esc(st.kopSlip || st.namaUsaha) + '</h1><small>' + esc(st.kopSub || st.alamat || '') + '</small></div>';
    var h = '';
    if (type === 'kirim' || type === 'setor') {
      var po = ctx.po || {}; var maklon = ctx.maklon || {};
      h += '<div class="judul">' + (type === 'kirim' ? 'SLIP PENUGASAN JAHIT' : 'SLIP SETOR HASIL JAHIT') + ' &mdash; ' + esc(rec.noSlip) + '</div>';
      h += '<table class="info"><tr><td>Tanggal</td><td>' + coreTgl(rec.tanggal) + '</td></tr>' +
        (type === 'kirim' && rec.target ? '<tr><td>Target selesai</td><td>' + coreTgl(rec.target) + '</td></tr>' : '') +
        '<tr><td>Maklon</td><td><b>' + esc(maklon.nama || '-') + '</b>' + (maklon.hp ? ' (' + esc(maklon.hp) + ')' : '') + '</td></tr>' +
        '<tr><td>No. PO</td><td>' + esc(po.noPO) + '</td></tr>' +
        '<tr><td>Barang</td><td><b>' + esc(po.nama) + '</b>' + (po.series ? ' &mdash; ' + esc(po.series) : '') + '</td></tr>' +
        (po.pelanggan ? '<tr><td>Pelanggan</td><td>' + esc(po.pelanggan) + '</td></tr>' : '') +
        (po.bahan ? '<tr><td>Bahan</td><td>' + esc(po.bahan) + '</td></tr>' : '') +
        '<tr><td>Upah jahit</td><td>' + coreRupiah(rec.upah) + ' per pcs</td></tr>' +
        (type === 'setor' ? '<tr><td>Status</td><td>' + esc({ diajukan: 'Menunggu dicek', diterima: 'Diterima', ditolak: 'Ditolak' }[rec.status] || rec.status) + '</td></tr>' : '') + '</table><br>';
      h += sizeTable(coreParseJSON(rec.ukuran, {}), rec.total, st.ukuran);
      if (type === 'setor') {
        h += '<div class="cat">Reject: <b>' + coreRibuan(rec.reject) + ' pcs</b></div>';
        var earned = (ctx.payroll || []).filter(function (r) { return r.sourceId === rec.id; });
        if (earned.length) { var current = 0, unpaid = 0, over = 0; earned.forEach(function (r) { current += r.total * r.rate; unpaid += r.available * r.rate; over += coreNum(r.overpaidQty); }); h += '<div class="cat">Hak upah saat ini: <b>' + coreRupiah(current) + '</b> | Belum dibayar: <b>' + coreRupiah(unpaid) + '</b>' + (over ? '<br>Perlu tinjau pembayaran: ' + coreRibuan(over) + ' pcs melebihi hak setelah QC.' : '') + '</div>'; }
        else h += '<div class="cat">Nilai hitungan sebelum QC: <b>' + coreRupiah(rec.total * rec.upah) + '</b></div>';
      }
      if (rec.catatan) h += '<div class="cat">Catatan: ' + esc(rec.catatan) + '</div>';
      h += '<table class="ttd"><tr><td><span>Dibuat oleh</span></td><td><span>Maklon</span></td><td><span>Diterima oleh</span></td></tr></table>';
    } else if (type === 'upah') {
      var peg = ctx.pegawai || {};
      h += '<div class="judul">SLIP UPAH ' + (rec.jenis === 'jahit' ? 'JAHIT' : 'POTONG') + ' &mdash; ' + esc(rec.noSlip) + '</div>';
      h += '<table class="info"><tr><td>Tanggal</td><td>' + coreTgl(rec.tanggal) + '</td></tr>' +
        '<tr><td>Nama</td><td><b>' + esc(peg.nama || '-') + '</b>' + (peg.hp ? ' (' + esc(peg.hp) + ')' : '') + '</td></tr></table><br>';
      h += '<table class="rinci"><tr><th>Ref</th><th>Tanggal</th><th>Barang</th><th>Pcs</th><th>Upah/pcs</th><th>Jumlah</th></tr>';
      (ctx.items || []).forEach(function (s) {
        var po2 = ctx.poMap[s.poId] || {}; var rate = rec.jenis === 'jahit' ? s.upah : s.tarif;
        h += '<tr><td>' + esc(s.noSlip || 'Potong') + '</td><td>' + coreTgl(s.tanggal) + '</td><td>' + esc(po2.noPO) + ' ' + esc(po2.nama) + '</td><td align="right">' + coreRibuan(s.total) + '</td><td align="right">' + coreRupiah(rate) + '</td><td align="right">' + coreRupiah(s.total * rate) + '</td></tr>';
      });
      h += '</table><div class="total">Total ' + coreRibuan(rec.totalQty) + ' pcs = ' + coreRupiah(rec.totalUpah) + '</div>';
      if (rec.potongan) h += '<div class="total">Potongan: ' + coreRupiah(rec.potongan) + '</div>';
      h += '<div class="total">DIBAYAR: ' + coreRupiah(rec.dibayar) + '</div>';
      if (rec.catatan) h += '<div class="cat">Catatan: ' + esc(rec.catatan) + '</div>';
      h += '<table class="ttd"><tr><td><span>Dibayar oleh</span></td><td></td><td><span>Diterima</span></td></tr></table>';
    }
    return '<html><head><meta charset="utf-8"><style>' + css + '</style></head><body>' + kop + h + '</body></html>';
  }

  actions.makePdf = function (p) {
    var me = auth(p);
    var type = String(p.type || ''); var id = String(p.id || '');
    var sheet = { kirim: 'SlipKirim', setor: 'SlipSetor', upah: 'SlipUpah' }[type];
    if (!sheet) fail('Jenis slip tidak dikenal.');
    var rec = findRow(sheet, id); if (!rec) fail('Slip tidak ditemukan.');
    var ownerId = type === 'upah' ? rec.pegawaiId : rec.maklonId;
    if (!coreIsAdmin(me) && ownerId !== me.id) fail('Bukan slip Anda.');
    if (type === 'setor' && rec.status !== 'diterima') fail('Slip terbit setelah QC menghitung setoran ini.');
    if (!env.makePdf) fail('PDF tersedia setelah aplikasi dipasang di Google Sheets. Untuk sekarang pakai "Salin teks".');
    var ctx = { settings: settings(), poMap: {} };
    store.read('PO').forEach(function (po) { ctx.poMap[po.id] = po; });
    if (type === 'upah') {
      ctx.pegawai = findUser(rec.pegawaiId) || {};
      var ids = coreParseJSON(rec.itemIds, []);
      var frozenItems = coreParseJSON(rec.items, []);
      var historicItems = coreLegacySlipItems(rec, store.read('LegacySettlement'));
      ctx.items = frozenItems.length ? frozenItems : historicItems.length ? historicItems : store.read(rec.jenis === 'jahit' ? 'SlipSetor' : 'Potong').filter(function (s) { return ids.indexOf(s.id) >= 0; });
      store.read('LegacySettlement').forEach(function (b) { if (b.paymentRef === rec.id && !ctx.poMap[b.poId]) ctx.poMap[b.poId] = coreMap(b.poSnapshot); });
    } else { ctx.maklon = findUser(rec.maklonId) || {}; ctx.po = ctx.poMap[rec.poId] || {}; if (type === 'setor') ctx.payroll = payroll().filter(function (r) { return r.sourceId === rec.id; }); }
    var b64 = env.makePdf(slipHtml(type, rec, ctx), rec.noSlip + '.pdf');
    if (!b64) fail('Gagal membuat PDF.');
    return { base64: b64, nama: rec.noSlip + '.pdf' };
  };

  /* aksi yang mengubah data dijalankan satu per satu di dalam kunci, lalu mengembalikan data terbaru */
  if (typeof coreInstallMigrationActions === 'function') coreInstallMigrationActions(actions, { store: store, env: env, auth: auth, fail: fail, settings: settings });
  if (typeof coreInstallHistoryCorrections === 'function') coreInstallHistoryCorrections(actions, { store: store, env: env, auth: auth, fail: fail });
  var WRITE = { setupOwner: 1, login: 1, logout: 1, changePin: 1, saveSettings: 1, saveUser: 1, saveProduk: 1, saveGambar: 1, importGambar: 1,
    savePO: 1, setStatusPO: 1, createPotong: 1, createKirim: 1, createSetor: 1, prosesSetor: 1, createQC: 1, createGudang: 1, createUpah: 1,
    tandaiLunas: 1, deleteRecord: 1, importRows: 1, ubahHarga: 1,
    saveStok: 1, cocokkanStok: 1, saveKaryawan: 1, saveGaji: 1, lunasGaji: 1, hapusGaji: 1, createKasbon: 1, createCicilan: 1, gantiImpor: 1, applyLegacyMigration: 1, recoverLegacyMigration: 1, saveHistoryCorrection: 1 };
  var NO_STATE = { setupOwner: 1, login: 1, logout: 1, importRows: 1, importGambar: 1 };

  function handle(action, payload) {
    var fn = actions[action];
    if (!fn) fail('Aksi tidak dikenal: ' + action);
    payload = payload || {};
    var contractAction = { savePO: 1, setStatusPO: 1, createPotong: 1, createKirim: 1, createSetor: 1, prosesSetor: 1, createQC: 1, createGudang: 1, createUpah: 1, tandaiLunas: 1, ubahHarga: 1, deleteRecord: 1, importRows: 1, gantiImpor: 1, applyLegacyMigration: 1, recoverLegacyMigration: 1, getHistoryCorrection: 1, saveHistoryCorrection: 1 };
    if (contractAction[action] && Number(payload.workflowVersion) !== WORKFLOW_VERSION) fail('Versi alur produksi tidak cocok. Muat ulang aplikasi versi terbaru.');
    if (!WRITE[action]) return fn(payload);
    return store.lock(function () {
      if (durableMigrationStatus() && ['applyLegacyMigration','recoverLegacyMigration','login','logout','changePin'].indexOf(action) < 0) fail('Pemulihan riwayat belum selesai. Owner harus memulihkan cadangan jurnal sebelum mengubah data.');
      var data = fn(payload);
      if (NO_STATE[action]) return data;
      var out = { data: data };
      try { out.state = buildState(auth(payload), payload); } catch (e) {}
      return out;
    });
  }
  return { handle: handle, slipHtml: slipHtml, settings: settings };
}

/* Historical v1 conversion replay. Used only to verify lineage before reconciliation.
   Original business conversion is preserved; optional stamp and sidecar tracing do not alter values. */
function convertBackupLegacyV1(backup, options) {
  options=options||{}; var compatLineage={cycles:[],rows:{}};
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
  var rows = { Pegawai: [], Produk: [], PO: [], Potong: [], SlipKirim: [], SlipSetor: [], QC: [], Gudang: [], StokBahan: [], Karyawan: [], GajiHarian: [], Kasbon: [] };
  var info = { duplikat: 0, baris: items.length, catatan: [] };
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
  arr(meta.tukangJahit).forEach(function (t) { regPeg(t.id, t.nama, 'jahit'); });
  arr(meta.tukang).forEach(function (t) { regPeg(t.id, t.nama, 'potong'); });
  function maklonByName(n) { return n ? (nameToId[String(n).trim().toLowerCase()] || '') : ''; }
  /* catatan potong lama sering tanpa nama; kalau tukang potongnya memang cuma satu, itu orangnya */
  var potongIds = Object.keys(peg).filter(function (id) { return peg[id].divisi === 'potong'; });
  var solePotong = potongIds.length === 1 ? potongIds[0] : '';
  var stamp = String((backup && backup._meta && backup._meta.ts) || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stamp)) stamp = options.stamp || coreYmd(new Date());

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

  /* PO + catatan produksi */
  var KEYS = ['potong', 'assignJahit', 'jahit', 'qc', 'hitungFisik', 'bsInputs'];
  function hasData(c) { return KEYS.some(function (k) { return arr(c[k]).length; }); }
  function firstDate(c) { var d = ''; KEYS.forEach(function (k) { arr(c[k]).forEach(function (e) { if (e.tanggal && (!d || e.tanggal < d)) d = e.tanggal; }); }); return d; }
  var poMap = {};
  function getPO(key, init) { if (!poMap[key]) { var po = init(); po.id = gen('po', key); po._tarif = po._tarif || 0; poMap[key] = po; rows.PO.push(po); } return poMap[key]; }
  function basePO(it, pr, extra) {
    var po = { id: '', noPO: '', jenis: 'stok', produkId: pr ? pr.id : '', nama: pr ? pr.nama : up(it.namaBarang), series: pr ? pr.series : '',
      pelanggan: '', deadline: '', ukuran: {}, total: 0, bahan: '', catatan: '', gambar: '', status: 'selesai', dibuat: '', dibuatOleh: '', diubah: '', selesaiPada: '',
      _tarif: pr ? pr.tarifJahit : 0 };
    for (var k in extra) po[k] = extra[k];
    return po;
  }
  function touch(po, c) { var d = firstDate(c); if (d && (!po._first || d < po._first)) po._first = d; }

  function addCycle(it, c, tag, po) {
    var lineage={skuId:String(it.id),siklus:tag,ukuran:up(it.size),poId:po.id};
    compatLineage.cycles.push(lineage);
    var size = up(it.size); var base = String(it.id) + '|' + tag + '|';
    /* id yang sama muncul dua kali di barang yang sama = dobel akibat sinkron lama */
    function dup(kind, e) { if (!e.id) return false; var k = kind + e.id; var g = addCycle.seen[it.id] = addCycle.seen[it.id] || {}; if (g[k]) { info.duplikat++; return true; } g[k] = 1; return false; }
    function uk(n) { var o = {}; if (size && n > 0) o[size] = n; return o; }

    arr(c.potong).forEach(function (e, i) {
      var n = coreInt(e.jumlah); if (n <= 0) return;
      var bahan = e.jenisBahan || (arr(e.bahanList)[0] || {}).jenis || '';
      /* bahan yang dipakai catatan ini (boleh beberapa jenis); inilah yang mengurangi stok bahan */
      var bl = arr(e.bahanList).filter(function (b) { return b.jenis || coreNum(b.kg) > 0; }).map(function (b) { return { nama: String(b.jenis || '').trim(), qty: coreNum(b.kg) }; });
      /* catatan potong yang sama persis dan ber-id sama di siklus aktif dan arsip adalah satu catatan (cermin), bukan dua */
      if (e.id || e.id === 0) {
        var sidik = 'p' + e.id + '|' + [e.tanggal || '', n, e.tukangId || '', JSON.stringify(bl.length ? bl : [{ nama: String(e.jenisBahan || '').trim(), qty: coreNum(e.kiloan) }])].join('|');
        var g = addCycle.seen[it.id] = addCycle.seen[it.id] || {};
        if (g[sidik]) { info.duplikat++; return; }
        g[sidik] = 1;
      }
      rows.Potong.push({ _compat:Object.assign({field:'potong',entryId:e.id==null?'':String(e.id),index:i},lineage), id: gen('pt', base + 'p' + i), poId: po.id, userId: e.tukangId ? String(e.tukangId) : solePotong, tanggal: e.tanggal || '', ukuran: uk(n), total: n,
        bahan: bahan, kg: coreNum(e.kiloan), rol: arr(e.rols).length, tarif: coreNum(e.tarif), upahId: e.dibayar ? LUNAS_LAMA : '', catatan: '', dibuat: iso(e.inputAt, e.tanggal),
        bahanList: bl.length ? bl : '' });
      if (!po.bahan && bahan) po.bahan = bahan;
    });

    var rateByWorker = {};
    arr(c.hitungFisik).forEach(function (e) { var r = coreNum((e.payroll || {}).rate); if (r > 0 && e.tukangId) rateByWorker[e.tukangId] = r; });
    var rateByAssign = {};
    arr(c.jahit).forEach(function (e) { if (e.assignmentId && coreNum(e.tarif) > 0) rateByAssign[e.assignmentId] = coreNum(e.tarif); });

    arr(c.assignJahit).forEach(function (e, i) {
      var n = coreInt(e.qty); if (n <= 0 || !e.tukangId || dup('k', e)) return;
      rows.SlipKirim.push({ _compat:Object.assign({field:'assignJahit',entryId:e.id==null?'':String(e.id),index:i},lineage), id: claim(e.id) || gen('sk', base + 'k' + i), noSlip: '', poId: po.id, maklonId: String(e.tukangId), tanggal: e.tanggal || '', target: e.targetTanggal || '',
        ukuran: uk(n), total: n, upah: rateByAssign[e.id] || rateByWorker[e.tukangId] || po._tarif || 0, catatan: e.ket || '', dibuatOleh: '', dibuat: iso(e.editedAt, e.tanggal) });
    });

    var terima = 0;
    arr(c.jahit).forEach(function (e, i) {
      if (!e.tukangId || dup('s', e)) return;
      var lolos = e.lolos !== undefined && e.lolos !== null ? coreInt(e.lolos) : coreInt(e.jumlah); var rijek = coreInt(e.rijek);
      if (lolos <= 0 && rijek <= 0) return;
      terima += lolos;
      rows.SlipSetor.push({ _compat:Object.assign({field:'jahit',entryId:e.id==null?'':String(e.id),index:i},lineage), id: claim(e.id) || gen('ss', base + 's' + i), noSlip: '', poId: po.id, maklonId: String(e.tukangId), tanggal: e.tanggal || '', ukuran: uk(lolos), total: lolos, reject: rijek,
        upah: coreNum(e.tarif) || rateByWorker[e.tukangId] || po._tarif || 0, catatan: '', status: 'diterima', dibuatOleh: '', dibuat: iso(e.inputAt, e.tanggal),
        diprosesOleh: '', diprosesPada: iso(e.inputAt, e.tanggal), upahId: e.dibayar ? LUNAS_LAMA : '' });
    });

    var qcOk = 0; var qcAll = 0; var sig = {};
    var qcs = arr(c.qc);
    if (qcs.length) {
      qcs.forEach(function (e, i) {
        if (dup('q', e)) return;
        var ok = coreInt(e.ok), off = coreInt(e.offline), rej = coreInt(e.reject), per = coreInt(e.perbaikan) + coreInt(e.kotor);
        var sum = ok + off + rej + per; if (sum <= 0) return;
        var s = [ok, off, rej, per, String(e.tukangJahit || '').toLowerCase()].join('|');
        if (sig[s] && terima > 0 && qcAll + sum > terima) { info.duplikat++; return; }   /* QC kembar yang melebihi jumlah setor */
        sig[s] = 1; qcAll += sum; qcOk += ok;
        rows.QC.push({ _compat:Object.assign({field:'qc',entryId:e.id==null?'':String(e.id),index:i},lineage), id: claim(e.id) || gen('qc', base + 'q' + i), poId: po.id, userId: '', maklonId: e.tukangId ? String(e.tukangId) : maklonByName(e.tukangJahit), tanggal: e.tanggal || '',
          ukuran: uk(ok), total: ok, offline: off, perbaikan: per, reject: rej, catatan: /^(Auto QC|Hitung Fisik|Batch QC|Penyesuaian)/.test(e.keterangan || '') ? '' : (e.keterangan || ''), dibuat: iso(e.inputAt, e.tanggal) });
      });
    } else {
      arr(c.hitungFisik).forEach(function (e, i) {
        var n = coreInt(e.jumlah); if (n <= 0 || dup('h', e)) return;
        qcOk += n;
        rows.QC.push({ _compat:Object.assign({field:'hitungFisik',entryId:e.id==null?'':String(e.id),index:i,synthetic:true},lineage), id: gen('qh', base + 'h' + i), poId: po.id, userId: '', maklonId: e.tukangId ? String(e.tukangId) : maklonByName(e.tukang || e.tukangJahit), tanggal: e.tanggal || '',
          ukuran: uk(n), total: n, offline: 0, perbaikan: 0, reject: 0, catatan: 'Hitung fisik', dibuat: iso(e.inputAt, e.tanggal) });
      });
    }

    var bs = arr(c.bsInputs);
    if (bs.length) {
      bs.forEach(function (e, i) {
        var n = coreInt(e.qty); if (n <= 0 || dup('g', e)) return;
        rows.Gudang.push({ _compat:Object.assign({field:'bsInputs',entryId:e.id==null?'':String(e.id),index:i},lineage), id: claim(e.id) || gen('gd', base + 'g' + i), poId: po.id, userId: '', tanggal: e.tanggal || '', ukuran: uk(n), total: n, catatan: '', dibuat: iso(e.at, e.tanggal) });
      });
    } else if (qcOk > 0 && (tag !== 'cur' || c.bigSeller === true)) {
      /* dulu hanya ditandai "sudah BigSeller" tanpa jumlah; siklus arsip dianggap sudah beres */
      var tg = c.bigSellerDate || c.bigSellerTanggal || c.tanggalArsip || '';
      rows.Gudang.push({ _compat:Object.assign({field:'bigSellerFlag',synthetic:true},lineage), id: gen('gd', base + 'flag'), poId: po.id, userId: '', tanggal: tg, ukuran: uk(qcOk), total: qcOk, catatan: 'Dari data lama', dibuat: iso(c.bigSellerAt, tg) });
    }
  }
  addCycle.seen = {};

  items.forEach(function (it) {
    if (!it || !it.namaBarang) return;
    var key = produkKey(it); var pr = produkMap[key]; var size = up(it.size);
    if (isOffline(it)) {
      var cust = coreTitle(it._offlineCustomer || String(it.series || '').replace(/^OFFLINE-/i, ''));
      var okey = 'OFF|' + (it._offlineOrderId || up(it.series)) + '|' + up(it.namaBarang);
      var po = getPO(okey, function () { return basePO(it, null, { jenis: 'pesanan', pelanggan: cust, deadline: it._offlineDeadline || '', catatan: it.poKet || '', _img: it._offlineGambar || '' }); });
      if (!po._img && it._offlineGambar) po._img = it._offlineGambar;
      var q = coreInt(it._offlineQty); if (q > 0 && size) po.ukuran[size] = (po.ukuran[size] || 0) + q;
      if (it.poAktif) po.status = 'aktif';
      touch(po, it);
      if (hasData(it)) addCycle(it, it, 'cur', po);
      return;
    }
    if (it.poAktif || hasData(it)) {
      var cpo = getPO('CUR|' + key, function () { return basePO(it, pr, { catatan: it.poKet || '' }); });
      if (it.poAktif) cpo.status = 'aktif';
      if (!cpo.catatan && it.poKet) cpo.catatan = it.poKet;
      touch(cpo, it);
      addCycle(it, it, 'cur', cpo);
    }
    (it.arsip instanceof Array ? it.arsip : []).forEach(function (a, i) {
      if (!a || !hasData(a)) return;
      var label = String(a.label || a.tanggalArsip || '');
      var apo = getPO('ARS|' + key + '|' + label, function () { return basePO(it, pr, { catatan: label ? 'Arsip ' + label : 'Arsip', selesaiPada: a.tanggalArsip || '' }); });
      if (a.tanggalArsip && a.tanggalArsip > apo.selesaiPada) apo.selesaiPada = a.tanggalArsip;
      touch(apo, a);
      addCycle(it, a, 'a' + i, apo);
    });
  });

  rows.PO.forEach(function (po) {
    po.total = coreSumSizes(po.ukuran);
    var d = po._first || po.selesaiPada || (po.status === 'aktif' ? '' : po.deadline) || stamp;   /* PO yang belum punya catatan memakai tanggal backup */
    po.dibuat = d + 'T00:00:00.000Z'; po.diubah = po.dibuat;
    if (po.status !== 'aktif' && !po.selesaiPada) po.selesaiPada = d;
    if (po._img && typeof po._img === 'string') imageList.push({ id: po.id, jenis: 'po', dataUrl: po._img });
    delete po._tarif; delete po._img; delete po._first;
  });

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
  numberRows(rows.SlipSetor, 'SS', 'noSlip', 'tanggal');
  for (var pid in peg) rows.Pegawai.push(peg[pid]);
  var ukuran = coreSizeOrder(Object.keys(sizeSet));
  info.adaStok = !!stokSrc; info.adaGaji = !!gajiSrc; info.adaKasbon = !!(gajiSrc || meta.kasbonJahit);
  Object.keys(rows).forEach(function(table){ compatLineage.rows[table]=[];rows[table].forEach(function(row){if(row._compat){compatLineage.rows[table].push({id:row.id,source:row._compat});delete row._compat;}});});
  return { lineage:compatLineage, rows: rows, images: imageList, ukuran: ukuran.length ? ukuran : DEFAULT_SETTINGS.ukuran.slice(), pengaturan: pengaturan, info: info };
}

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

/* Pure reconciliation preview. No store, clock, network, or production writes.
   The authoritative source must replay the original import before any projection
   is proposed. Payment receipts remain immutable in LegacySettlement snapshots. */
function coreReconcileCanonical(value) {
  if (value === undefined) return 'null';
  if (value instanceof Array) return '[' + value.map(coreReconcileCanonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(function (k) { return value[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ':' + coreReconcileCanonical(value[k]); }).join(',') + '}';
  return JSON.stringify(value);
}
/* SHA-256, UTF-8 input, compatible with the browser and Apps Script V8. */
function coreReconcileSha256(text) {
  var bytes = [], s = String(text), i, c, next;
  for (i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { next = s.charCodeAt(i + 1); if (next >= 0xdc00 && next <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + next - 0xdc00; i++; } else c = 0xfffd; }
    else if (c >= 0xdc00 && c <= 0xdfff) c = 0xfffd;
    if (c < 128) bytes.push(c); else if (c < 2048) bytes.push(192 | c >> 6, 128 | c & 63); else if (c < 65536) bytes.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63); else bytes.push(240 | c >> 18, 128 | c >> 12 & 63, 128 | c >> 6 & 63, 128 | c & 63);
  }
  var bitLength = bytes.length * 8; bytes.push(128); while (bytes.length % 64 !== 56) bytes.push(0);
  var high = Math.floor(bitLength / 4294967296), low = bitLength >>> 0;
  for (i = 3; i >= 0; i--) bytes.push(high >>> (i * 8) & 255); for (i = 3; i >= 0; i--) bytes.push(low >>> (i * 8) & 255);
  var k = [1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298];
  var h = [1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225];
  function rotr(v,n) { return v >>> n | v << (32-n); }
  for (var offset = 0; offset < bytes.length; offset += 64) {
    var w = [], j; for (j = 0; j < 16; j++) { var at = offset + j * 4; w[j] = bytes[at] << 24 | bytes[at+1] << 16 | bytes[at+2] << 8 | bytes[at+3]; }
    for (j = 16; j < 64; j++) { var x = w[j-15], y = w[j-2]; w[j] = ((rotr(x,7)^rotr(x,18)^x>>>3) + w[j-16] + (rotr(y,17)^rotr(y,19)^y>>>10) + w[j-7]) | 0; }
    var a=h[0],b=h[1],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7],cc=h[2];
    for (j=0;j<64;j++) { var t1=(hh+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+k[j]+w[j])|0; var t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&cc)^(b&cc)))|0; hh=g;g=f;f=e;e=(d+t1)|0;d=cc;cc=b;b=a;a=(t1+t2)|0; }
    [a,b,cc,d,e,f,g,hh].forEach(function(v,n){h[n]=(h[n]+v)|0;});
  }
  return h.map(function(v){return ('00000000'+(v>>>0).toString(16)).slice(-8);}).join('');
}
function coreLegacyHash(value) { return coreReconcileSha256(coreReconcileCanonical(value)); }
/* Exact production replay needs worker names/IDs and their tariff history, not
   account credentials, images, device metadata, stock purchases or daily wages. */
function coreLegacySourceInput(backup) {
  var root=backup&&backup.soldier&&typeof backup.soldier==='object'?backup.soldier:(backup||{});
  function list(v) { if(typeof v==='string'){try{v=JSON.parse(v);}catch(e){return [];}}return v instanceof Array?v:v&&typeof v==='object'?Object.keys(v).sort(function(a,b){return Number(a)-Number(b)||a.localeCompare(b);}).map(function(k){return v[k];}):[]; }
  function pick(v,keys) { var o={};keys.forEach(function(k){if(v&&v[k]!==undefined)o[k]=JSON.parse(JSON.stringify(v[k]));});return o; }
  var cycleKeys=['id','cycleId','label','tanggalArsip','namaBarang','series','size','poAktif','poKet','_offlineOrderId','_offlineCustomer','_offlineDeadline','_offlineQty','bigSeller','bigSellerAt','bigSellerDate','bigSellerTanggal','deleted','isDeleted','deletedAt','cancelled','canceled','cancelledAt','canceledAt','status'];
  var eventKeys=['id','tanggal','inputAt','inputVia','inputBy','editedAt','editedBy','restoredFrom','at','createdAt','jumlah','lolos','rijek','qty','total','tarif','upah','tukangId','tukangNama','tukang','tukangJahit','workerId','assignmentId','targetTanggal','dibayar','ket','keterangan','jenisBahan','kiloan','ok','offline','perbaikan','kotor','reject','hfId','qcId','qcBatchId','gudangId','workflowVersion','countStage','autoFromCount','payrollStage','payrollCancelled','status','quantityBasis','deleted','isDeleted','deletedAt','cancelled','canceled','cancelledAt','canceledAt'];
  function event(e) { var o=pick(e,eventKeys);if(e&&e.payroll)o.payroll=pick(e.payroll,['workerId','workerName','rate','rateMissing','stage','version','source','date']);if(e&&e.bahanList)o.bahanList=list(e.bahanList).map(function(b){return pick(b,['jenis','kg']);});if(e&&e.rols)o.rols=list(e.rols).map(function(){return {};});return o; }
  function cycle(c) { var o=pick(c,cycleKeys);['potong','assignJahit','jahit','hitungFisik','qc','gudang','bsInputs','bayarJahit'].forEach(function(k){if(c&&c[k]!==undefined)o[k]=list(c[k]).filter(Boolean).map(event);});if(c&&c.arsip!==undefined)o.arsip=list(c.arsip).map(function(a){return a?cycle(a):a;});return o; }
  var meta=root.produksi_meta||{}, out={produksi:{produksi:list(root.produksi&&root.produksi.produksi).map(function(p){return p?cycle(p):p;})},produksi_meta:{tukang:list(meta.tukang).filter(Boolean).map(function(w){return pick(w,['id','nama']);}),tukangJahit:list(meta.tukangJahit).filter(Boolean).map(function(w){return pick(w,['id','nama','tarif','tarifHistory']);})}};
  if(backup&&backup._meta&&backup._meta.ts)out._meta={ts:backup._meta.ts};return out;
}
function corePlanLegacyReconciliation(backup, currentTables) {
  if(backup&&typeof backup==='object')backup=coreLegacySourceInput(backup);
  var TABLES = ['PO','Potong','SlipKirim','SlipSetor','QC','Gudang','GudangLama','LegacySettlement'];
  var CHECK = {
    PO: ['noPO','jenis','produkId','nama','series','pelanggan','deadline','ukuran','total','bahan','catatan','status','selesaiPada'],
    Potong: ['poId','userId','tanggal','ukuran','total','bahan','kg','rol','tarif','catatan','bahanList'],
    SlipKirim: ['noSlip','poId','maklonId','tanggal','target','ukuran','total','upah','catatan'],
    SlipSetor: ['noSlip','poId','maklonId','tanggal','ukuran','total','reject','upah','catatan','status'],
    QC: ['poId','maklonId','tanggal','ukuran','total','offline','perbaikan','reject','catatan','setorId'],
    Gudang: ['poId','tanggal','ukuran','total','catatan']
  };
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function arr(v) { if (typeof v === 'string') { try { v=JSON.parse(v); } catch(e) { return []; } } return v instanceof Array ? v.filter(Boolean) : v && typeof v === 'object' ? Object.keys(v).sort(function(a,b){return Number(a)-Number(b)||a.localeCompare(b);}).map(function(k){return v[k];}).filter(Boolean) : []; }
  function parsed(v) { return typeof v === 'string' ? coreParseJSON(v,{}) : (v || {}); }
  function semantic(v) { if (v == null || v === '') return ''; if (typeof v === 'string') { try { var p=JSON.parse(v); if (p && typeof p==='object') return coreReconcileCanonical(p); } catch(e){} } if(typeof v==='object')return coreReconcileCanonical(v); return String(v); }
  function hash(v) { return coreReconcileSha256(coreReconcileCanonical(v)); }
  function sortRows(rows) { var out={};Object.keys(rows).sort().forEach(function(t){out[t]=rows[t].slice().sort(function(a,b){return String(a.id).localeCompare(String(b.id));});});return out; }
  var current={}, fingerprintTables={}; TABLES.concat(['SlipUpah','Produk']).forEach(function(t){current[t]=clone(arr((currentTables||{})[t]));fingerprintTables[t]=current[t];});
  var beforeHash=hash(sortRows(fingerprintTables)), sourceHash=hash(backup), batchId='lr1_'+sourceHash.slice(0,24);
  var issues=[], reviews=[], summary={activePO:0,migratedPO:0,heldPO:0,archivedPO:0,settlements:0,settlementHolds:0};
  function result(rows, ready, alreadyApplied) { var out={beforeHash:beforeHash,sourceHash:sourceHash,batchId:batchId,rows:rows,summary:summary,issues:issues,reviews:reviews,ready:ready,alreadyApplied:!!alreadyApplied};out.planHash=hash({beforeHash:beforeHash,sourceHash:sourceHash,batchId:batchId,rows:sortRows(rows),issues:issues,reviews:reviews});return out; }
  function fail(message) { issues.push(message); return result({},false,false); }
  if (!backup || typeof backup !== 'object') return fail('Cadangan sumber belum tersedia.');
  if (!current.PO.length) return fail('Tidak ada PO impor lama untuk direkonsiliasi.');
  var markers=current.PO.map(function(p){return parsed(p.imporSumber).legacyReconciliation;});
  if (markers.every(function(m){return m&&m.sourceHash===sourceHash&&m.batchId===batchId;})) { TABLES.forEach(function(t){fingerprintTables[t]=current[t];});return result(Object.keys(fingerprintTables).filter(function(t){return TABLES.indexOf(t)>=0;}).reduce(function(o,t){o[t]=current[t];return o;},{}),true,true); }
  if (current.LegacySettlement.length || current.GudangLama.length || markers.some(Boolean)) return fail('Data sudah pernah direkonsiliasi atau bercampur versi. Gunakan sumber dan jurnal rekonsiliasi yang sama.');
  var stamp=String(backup._meta&&backup._meta.ts||'').slice(0,10), stamps=[];
  if (/^\d{4}-\d{2}-\d{2}$/.test(stamp)) stamps.push(stamp);
  current.PO.forEach(function(p){var d=String(p.dibuat||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(d)&&stamps.indexOf(d)<0)stamps.push(d);});
  stamps.sort().reverse(); if(!stamps.length)stamps.push('1970-01-01');
  function mismatches(old) { var errs=[];Object.keys(CHECK).forEach(function(t){var map={};old.rows[t].forEach(function(r){map[r.id]=r;});if(old.rows[t].length!==current[t].length)errs.push(t+': jumlah baris berbeda.');current[t].forEach(function(r){var e=map[r.id];if(!e){errs.push(t+': ID baris berbeda.');return;}if(CHECK[t].some(function(k){return semantic(r[k])!==semantic(e[k]);}))errs.push(t+': isi baris berubah.');});});return errs; }
  var replay=null, mismatch=[];
  for(var si=0;si<stamps.length;si++){var trial=convertBackupLegacyV1(backup,{stamp:stamps[si]});mismatch=mismatches(trial);if(!mismatch.length){replay=trial;stamp=stamps[si];break;}}
  if(!replay)return fail('Cadangan tidak cocok persis dengan impor v1 yang sedang tersimpan. '+Array.from(new Set(mismatch)).join(' '));
  var root=backup.soldier&&typeof backup.soldier==='object'?backup.soldier:backup;
  var items=arr(root.produksi&&root.produksi.produksi), bySku={};items.forEach(function(p){bySku[String(p.id)]=p;});
  var output={};TABLES.forEach(function(t){output[t]=[];});
  var oldMaps={}, oldTrace={};Object.keys(CHECK).forEach(function(t){oldMaps[t]={};current[t].forEach(function(r){oldMaps[t][r.id]=r;});(replay.lineage.rows[t]||[]).forEach(function(x){oldTrace[t+'|'+x.id]=x.source;});});
  function sourceKey(s) { return [s.skuId,s.siklus==='cur'?'current':s.siklus,s.field,s.entryId?('id:'+s.entryId):('index:'+s.index)].join('|'); }
  var oldBySource={};Object.keys(replay.lineage.rows).forEach(function(t){(replay.lineage.rows[t]||[]).forEach(function(x){oldBySource[t+'|'+sourceKey(x.source)]=x.id;});});
  function mark(po, mode, reason) { var p=clone(po), src=parsed(p.imporSumber);src.legacyReconciliation={version:1,sourceHash:sourceHash,batchId:batchId,mode:mode};p.imporSumber=JSON.stringify(src);p.imporVersion=2;p.imporReview=reason||'';return p; }
  function preserve(po, reason, mode) { output.PO.push(mark(po,mode,reason));['Potong','SlipKirim','SlipSetor','QC','Gudang'].forEach(function(t){output[t]=output[t].concat(current[t].filter(function(r){return r.poId===po.id;}));});if(mode==='archive')summary.archivedPO++;else{summary.heldPO++;reviews.push({poId:po.id,noPO:po.noPO,reason:reason});} }
  current.PO.forEach(function(po){
    if(po.status!=='aktif'){preserve(po,'Arsip lama dipertahankan sebagai riwayat. Rekonsiliasi diperlukan sebelum membuka kembali.','archive');return;}
    summary.activePO++;
    var cycles=replay.lineage.cycles.filter(function(c){return c.poId===po.id;}), sizeSeen={}, converted=[], problems=[];
    cycles.forEach(function(c){
      if(c.siklus!=='cur'||sizeSeen[c.ukuran]){problems.push('Siklus asal ukuran '+c.ukuran+' bertumpuk.');return;}sizeSeen[c.ukuran]=true;
      var item=bySku[c.skuId];if(!item){problems.push('SKU asal hilang.');return;}
      var p=clone(item);p.arsip=[];p.gambar='';
      var payload={produksi:{produksi:[p]},produksi_meta:root.produksi_meta||{},_meta:{ts:stamp+'T00:00:00Z'}};
      try { var v=convertBackup(payload);if(v.rows.PO.length!==1)throw new Error('Siklus asal tidak tunggal.');converted.push({cycle:c,value:v}); }
      catch(e){problems.push(c.ukuran+': '+String(e.message));}
    });
    if(problems.length){preserve(po,problems.join(' '),'review');return;}
    var next={Potong:[],SlipKirim:[],SlipSetor:[],QC:[],Gudang:[],GudangLama:[]}, provenance={}, remap={};
    converted.forEach(function(cv){var v=cv.value;(v.info.lineage||[]).forEach(function(l){provenance[l.table+'|'+l.id]=l.source;});Object.keys(next).forEach(function(t){arr(v.rows[t]).forEach(function(r){var n=clone(r),src=provenance[t+'|'+r.id]||parsed(r.imporSumber);var oldId=oldBySource[t+'|'+sourceKey(src)];if(oldId&&(t==='Potong'||t==='SlipKirim'||t==='QC'&&!r.repairQcId||t==='Gudang')){remap[r.id]=oldId;n.id=oldId;if(t==='Potong')n=clone(oldMaps.Potong[oldId]);if(t==='SlipKirim')n.noSlip=oldMaps.SlipKirim[oldId].noSlip;}n.poId=po.id;next[t].push(n);provenance[t+'|'+n.id]=src;});});});
    next.QC.forEach(function(q){q.setorId=remap[q.setorId]||q.setorId;q.repairQcId=remap[q.repairQcId]||q.repairQcId;});
    next.GudangLama.forEach(function(g){g.qcId=remap[g.qcId]||g.qcId;});
    var madePo=mark(po,'migrated',''), flow=coreWorkflow([madePo],next.Potong,next.SlipKirim,next.SlipSetor,next.QC,next.Gudang,{gudangLama:next.GudangLama,settlements:[]})[po.id];
    if(flow.issues.length){preserve(po,flow.issues.join(' '),'review');return;}
    var oldSetor=current.SlipSetor.filter(function(r){return r.poId===po.id;}), groups={};
    oldSetor.forEach(function(s){var tr=oldTrace['SlipSetor|'+s.id];if(!tr){problems.push('Asal setoran lama belum pasti.');return;}var k=tr.skuId+'|'+tr.siklus+'|'+s.maklonId+'|'+tr.ukuran;(groups[k]||(groups[k]={trace:tr,worker:s.maklonId,rows:[]})).rows.push(s);});
    if(problems.length){preserve(po,problems.join(' '),'review');return;}
    var earned=corePayroll([],next.SlipSetor,next.QC,[],{gudangLama:next.GudangLama,settlements:[]}), settlements=[];
    Object.keys(groups).sort().forEach(function(key){
      var group=groups[key], tr=group.trace, allowed={}, baseline=[];
      earned.forEach(function(e){if(e.pegawaiId!==group.worker||e.size!==tr.ukuran)return;var r=next.SlipSetor.filter(function(s){return s.id===e.sourceId;})[0];var q=String(e.sourceId).indexOf('qc:')===0?next.QC.filter(function(q){return q.id===e.sourceId.slice(3);})[0]:null;var src=r?parsed(r.imporSumber):provenance['QC|'+String(e.sourceId).replace(/^qc:/,'')]||provenance['GudangLama|'+String(e.sourceId).replace(/^gudanglama:/,'')];if(!src||String(src.skuId)!==String(tr.skuId)||src.siklus!=='current')return;if(allowed[e.sourceId])return;allowed[e.sourceId]=true;var quantity=r?coreNum(coreMap(r.ukuran)[tr.ukuran]):coreNum(e.total);if(q){var linked=next.SlipSetor.filter(function(s){return s.id===q.setorId;})[0];quantity=linked?coreNum(coreMap(linked.ukuran)[tr.ukuran]):coreNum(q.total)+coreNum(q.offline)+coreNum(q.perbaikan)+coreNum(q.reject);}baseline.push({sourceId:e.sourceId,size:tr.ukuran,qty:quantity,rate:coreNum(e.rate),originalHFid:src.field==='hitungFisik'?src.entryId:'',sourceType:src.field});});
      /* An already-paid report can still be awaiting physical counting. Freeze its
         imported pending source ID too, so accepting that SAME receipt cannot make
         the historical payment payable again. New receipt IDs remain unaffected. */
      next.SlipSetor.forEach(function(s){var src=parsed(s.imporSumber);if(s.status!=='diajukan'||s.maklonId!==group.worker||String(src.skuId)!==String(tr.skuId)||src.siklus!=='current'||allowed[s.id])return;allowed[s.id]=true;var rates=Array.from(new Set(group.rows.map(function(r){return coreNum(r.upah);})));baseline.push({sourceId:s.id,size:tr.ukuran,qty:coreNum(coreMap(s.ukuran)[tr.ukuran]),rate:rates.length===1?rates[0]:0,originalHFid:'',sourceType:'jahit',pending:true});});
      baseline.sort(function(a,b){return a.sourceId.localeCompare(b.sourceId);});
      group.rows.forEach(function(s){
        if(!s.upahId)return;
        var quantity=baseline.reduce(function(n,b){return n+b.qty;},0), rate=coreNum(s.upah), exact=group.rows.length===1&&baseline.length>0&&quantity<=coreNum(s.total)&&rate>0&&baseline.every(function(b){return b.rate===rate&&!b.pending;});
        var reasons=[];
        if(group.rows.length>1)reasons.push('Beberapa setoran lama berbagi kelompok hitungan; pembayaran per sumber belum dapat dipastikan.');
        if(!baseline.length)reasons.push('Belum ada sumber hasil hitung atau QC yang dapat dicocokkan.');
        if(baseline.some(function(b){return b.pending;}))reasons.push('Setoran lama sudah dibayar tetapi masih ada sisa yang menunggu hitung fisik.');
        if(!(rate>0)||baseline.some(function(b){return b.rate!==rate;}))reasons.push('Tarif pada pembayaran lama berbeda dari tarif sumber hitungan.');
        if(quantity>coreNum(s.total))reasons.push('Jumlah sumber dasar melebihi jumlah pada setoran pembayaran ini.');
        var reason=exact?(quantity<coreNum(s.total)?'Pembayaran lama melebihi sumber dasar yang tersedia; sisa tidak dialihkan ke hitungan baru.':''):reasons.join(' ');
        var settlement={id:'ls_'+coreReconcileSha256(batchId+'|'+s.id).slice(0,24),batchId:batchId,sourceId:s.id,poId:po.id,maklonId:s.maklonId,size:tr.ukuran,paymentRef:s.upahId,sourceSnapshot:JSON.stringify(s),poSnapshot:JSON.stringify({id:po.id,noPO:po.noPO,nama:po.nama,series:po.series}),imporSumber:JSON.stringify({skuId:tr.skuId,siklus:'current',entryId:tr.entryId||('index:'+tr.index),field:'jahit',baseline:true,index:tr.index}),baselineSources:JSON.stringify(baseline),resolution:exact?'full':'hold',allocations:JSON.stringify(exact?baseline.map(function(b){return {sourceId:b.sourceId,size:b.size,qty:b.qty};}):[]),reason:reason};
        settlements.push(settlement);if(!exact)summary.settlementHolds++;
      });
    });
    output.PO.push(madePo);Object.keys(next).forEach(function(t){output[t]=output[t].concat(next[t]);});output.LegacySettlement=output.LegacySettlement.concat(settlements);summary.migratedPO++;summary.settlements+=settlements.length;
  });
  /* No account/personnel data, settings, product master, or payment slip is replaced. */
  TABLES.forEach(function(t){var seen={};output[t].forEach(function(r){if(!r.id||seen[r.id])issues.push(t+': identitas hasil rekonsiliasi tidak unik.');seen[r.id]=true;});});
  var preservedSources={};output.SlipSetor.forEach(function(s){preservedSources[s.id]=s;});output.LegacySettlement.forEach(function(s){if(preservedSources[s.sourceId])issues.push('Setoran lama tersimpan dua kali dalam hasil rekonsiliasi.');preservedSources[s.sourceId]=parsed(s.sourceSnapshot);});
  current.SlipSetor.filter(function(s){return !!s.upahId;}).forEach(function(s){if(coreReconcileCanonical(preservedSources[s.id])!==coreReconcileCanonical(s))issues.push('Setoran yang sudah dibayar belum dipertahankan secara utuh.');});
  current.Potong.filter(function(p){return !!p.upahId;}).forEach(function(p){var matches=output.Potong.filter(function(n){return n.id===p.id;});if(matches.length!==1||coreReconcileCanonical(matches[0])!==coreReconcileCanonical(p))issues.push('Catatan potong yang sudah dibayar belum dipertahankan secara utuh.');});
  if(issues.length)return result({},false,false);
  return result(output,true,false);
}

/* Owner-only reconciliation of an exact legacy import. The planner is pure;
   applying it keeps a durable before-image before replacing any production row. */
function coreInstallMigrationActions(actions, ctx) {
  var store = ctx.store;
  var tables = ['PO', 'Potong', 'SlipKirim', 'SlipSetor', 'QC', 'Gudang', 'GudangLama', 'LegacySettlement'];
  var inputs = tables.concat(['SlipUpah', 'Produk']);
  function fail(message) { ctx.fail(message); }
  function owner(p) { var me = ctx.auth(p); if (me.divisi !== 'owner') fail('Hanya owner yang boleh memulihkan riwayat produksi.'); return me; }
  function checkpoint(names) { if (store.checkpoint) store.checkpoint(names); }
  function current() { checkpoint(inputs); var out = {}; inputs.forEach(function (name) { out[name] = store.read(name); }); return out; }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function normalized(name, rows) {
    return rows.map(function (row) {
      var out = {};
      SCHEMA[name].forEach(function (key) {
        var value = row[key];
        if (TYPES[key] === 'num') value = coreNum(value);
        else if (TYPES[key] === 'bool') value = value === true || /^(true|ya|1)$/i.test(String(value));
        else value = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
        out[key] = value;
      });
      return out;
    });
  }
  function sameRows(name, a, b) {
    function stable(rows) { return normalized(name, rows).sort(function (x, y) { return String(x.id).localeCompare(String(y.id)); }); }
    return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
  }
  function checked(p) {
    if (typeof corePlanLegacyReconciliation !== 'function') fail('Pemulihan riwayat belum tersedia pada server ini.');
    if (!p.backup || typeof p.backup !== 'object') fail('Pilih file backup sumber terlebih dahulu.');
    return corePlanLegacyReconciliation(p.backup, current());
  }
  function publicPlan(plan) {
    return { beforeHash: plan.beforeHash, planHash: plan.planHash, batchId: plan.batchId,
      ready: !!plan.ready, alreadyApplied: !!plan.alreadyApplied, summary: plan.summary || {}, issues: plan.issues || [], reviews: plan.reviews || [] };
  }
  function pending() { checkpoint(['Pengaturan']); return (store.getSettings() || {}).legacyMigrationStatus || null; }
  function status(value) { var settings = copy(store.getSettings() || {}); settings.legacyMigrationStatus = value || false; store.setSettings(settings); }
  function preflight(name, rows) { if (store.validateRows) store.validateRows(name, rows); }
  function readJournal(batchId, expectedManifestHash) {
    var all = store.read('MigrasiJournal').filter(function (r) { return r.batchId === batchId; });
    var control = all.filter(function (r) { return r.sheet === '_manifest'; })[0];
    if (!control) fail('Cadangan pemulihan tidak lengkap. Gunakan salinan spreadsheet sebelum migrasi.');
    var manifest = coreParseJSON(control.before, null);
    if (!manifest || !(manifest.tables instanceof Array)) fail('Daftar cadangan pemulihan tidak sah.');
    if (!expectedManifestHash || coreLegacyHash(manifest) !== expectedManifestHash) fail('Daftar cadangan pemulihan tidak cocok dengan proses yang tercatat.');
    var before = {};
    manifest.tables.forEach(function (item) {
      if (tables.indexOf(item.name) < 0 || before[item.name]) fail('Tabel cadangan pemulihan tidak sah.');
      var entries = all.filter(function (r) { return r.sheet === item.name; });
      if (entries.length !== item.count) fail('Jumlah baris cadangan pemulihan tidak lengkap.');
      before[item.name] = entries.map(function (r) {
        var row = coreParseJSON(r.before, null);
        if (!row || String(row.id) !== String(r.rowId)) fail('Baris cadangan pemulihan tidak sah.');
        return row;
      });
      if (new Set(before[item.name].map(function (r) { return r.id; })).size !== item.count) fail('Cadangan pemulihan memiliki ID ganda.');
      if (item.hash !== coreLegacyHash(normalized(item.name, before[item.name]))) fail('Isi cadangan pemulihan tidak cocok dengan pemeriksaan awal.');
    });
    return { control: control, manifest: manifest, before: before };
  }
  actions.previewLegacyMigration = function (p) {
    owner(p);
    if (pending()) fail('Pemulihan sebelumnya belum selesai. Pulihkan cadangan jurnal terlebih dahulu.');
    return publicPlan(checked(p));
  };
  actions.applyLegacyMigration = function (p) {
    owner(p);
    var active = pending();
    if (active) fail('Pemulihan sebelumnya belum selesai. Pulihkan cadangan jurnal sebelum mencoba kembali.');
    var plan = checked(p);
    if (!plan.ready) fail('Riwayat belum dapat dipulihkan: ' + ((plan.issues || [])[0] || 'ada catatan yang perlu diperiksa.'));
    if (plan.alreadyApplied) return { selesai: true, alreadyApplied: true, batchId: plan.batchId, summary: plan.summary || {} };
    if (!p.beforeHash || !p.planHash || p.beforeHash !== plan.beforeHash || p.planHash !== plan.planHash) fail('Data berubah sejak pratinjau. Periksa kembali sebelum memulihkan.');
    if (!/^[A-Za-z0-9_-]{6,48}$/.test(plan.batchId || '')) fail('Identitas pemulihan tidak sah.');
    var names = Object.keys(plan.rows || {});
    if (!names.length || names.some(function (name) { return tables.indexOf(name) < 0 || !(plan.rows[name] instanceof Array); })) fail('Tabel pemulihan tidak sah.');
    if (store.validateMigrationLayout) store.validateMigrationLayout(names);
    var before = {}, after = {}, manifest = { tables: [] }, journal = [];
    var at = ctx.env.now().toISOString(), serial = 0;
    var paymentBefore = JSON.stringify(store.read('SlipUpah'));
    names.forEach(function (name) {
      before[name] = copy(store.read(name)); after[name] = normalized(name, plan.rows[name]);
      manifest.tables.push({ name: name, count: before[name].length, hash: coreLegacyHash(normalized(name, before[name])) });
      before[name].forEach(function (row) {
        journal.push({ id: plan.batchId + '_' + (++serial).toString(36), batchId: plan.batchId, sheet: name, rowId: row.id,
          before: JSON.stringify(row), status: 'prepared', beforeHash: plan.beforeHash, planHash: plan.planHash, createdAt: at });
      });
      preflight(name, after[name]); preflight(name, before[name]);
    });
    journal.push({ id: plan.batchId + '_manifest', batchId: plan.batchId, sheet: '_manifest', rowId: '',
      before: JSON.stringify(manifest), status: 'prepared', beforeHash: plan.beforeHash, planHash: plan.planHash, createdAt: at });
    var keep = store.read('MigrasiJournal').filter(function (r) { return r.batchId !== plan.batchId; });
    preflight('MigrasiJournal', keep.concat(journal));
    var nextStatus = { batchId: plan.batchId, beforeHash: plan.beforeHash, planHash: plan.planHash, journalHash: coreLegacyHash(manifest), at: at };
    var nextSettings = copy(store.getSettings() || {}); nextSettings.legacyMigrationStatus = nextStatus;
    preflight('Pengaturan', Object.keys(nextSettings).map(function (key) { return { key: key, value: JSON.stringify(nextSettings[key]) }; }));
    store.replaceAll('MigrasiJournal', keep.concat(journal));
    checkpoint(['MigrasiJournal']);
    var saved = readJournal(plan.batchId, nextStatus.journalHash);
    names.forEach(function (name) { if (!sameRows(name, saved.before[name], before[name])) fail('Cadangan sebelum pemulihan belum terverifikasi.'); });
    status(nextStatus);
    checkpoint(['Pengaturan']);
    if (coreLegacyHash((store.getSettings() || {}).legacyMigrationStatus) !== coreLegacyHash(nextStatus)) fail('Penanda pemulihan belum tersimpan. Belum ada data produksi yang diubah.');
    /* From here a failed request deliberately leaves the pending marker. The
       owner can restore the durable before-image; ordinary writes remain closed. */
    names.forEach(function (name) { store.replaceAll(name, after[name]); });
    checkpoint(names.concat(['SlipUpah']));
    names.forEach(function (name) { if (!sameRows(name, store.read(name), after[name])) fail('Hasil pemulihan belum terverifikasi. Pulihkan cadangan jurnal.'); });
    if (JSON.stringify(store.read('SlipUpah')) !== paymentBefore) fail('Riwayat slip pembayaran berubah saat pemulihan. Periksa salinan cadangan.');
    store.update('MigrasiJournal', plan.batchId + '_manifest', { status: 'complete' });
    status(null);
    checkpoint(['MigrasiJournal', 'Pengaturan']);
    return { selesai: true, batchId: plan.batchId, summary: plan.summary || {} };
  };
  actions.recoverLegacyMigration = function (p) {
    owner(p);
    var active = pending();
    if (!active) return { dipulihkan: false, message: 'Tidak ada pemulihan yang tertunda.' };
    if (p.batchId !== active.batchId) fail('Pilih pemulihan yang sedang tertunda.');
    checkpoint(['MigrasiJournal']);
    var journal = readJournal(active.batchId, active.journalHash);
    if (journal.control.beforeHash !== active.beforeHash || journal.control.planHash !== active.planHash) fail('Jurnal pemulihan tidak cocok dengan proses yang tertunda.');
    var names = Object.keys(journal.before);
    if (store.validateMigrationLayout) store.validateMigrationLayout(names);
    names.forEach(function (name) { preflight(name, journal.before[name]); });
    names.forEach(function (name) { store.replaceAll(name, journal.before[name]); });
    checkpoint(names);
    names.forEach(function (name) { if (!sameRows(name, store.read(name), journal.before[name])) fail('Pemulihan cadangan belum lengkap. Coba pemulihan jurnal kembali.'); });
    store.update('MigrasiJournal', active.batchId + '_manifest', { status: 'recovered' });
    status(null);
    checkpoint(['MigrasiJournal', 'Pengaturan']);
    return { dipulihkan: true, batchId: active.batchId };
  };
}

/* Owner corrections of physical quantities in held legacy history. Original
   production/payment rows are immutable; only an append-only overlay is saved. */
function coreHistoryEligible(po, row, sheet) {
  var marker = coreMap(po && po.imporSumber).legacyReconciliation;
  return !!(po && row && ['Potong','SlipKirim'].indexOf(sheet) >= 0 && row.poId === po.id && row.asal === 'lama' && po.status === 'aktif' && marker && marker.mode === 'review');
}
function coreHistorySourceHash(sheet, row) {
  /* Freeze the v1 fingerprint fields: appending a future sheet column must not
     invalidate an otherwise unchanged historical correction chain. */
  var columns = {
    Potong: ['id','poId','userId','tanggal','ukuran','total','bahan','kg','rol','tarif','upahId','catatan','dibuat','bahanList','asal'],
    SlipKirim: ['id','noSlip','poId','maklonId','tanggal','target','ukuran','total','upah','catatan','dibuatOleh','dibuat','asal']
  }, numeric = ['total','kg','rol','tarif','upah'], normalized = {};
  (columns[sheet] || []).forEach(function (key) {
    var value = row[key];
    if (numeric.indexOf(key) >= 0) value = coreNum(value);
    else if (key === 'ukuran' || key === 'bahanList') value = coreParseJSON(value, key === 'ukuran' ? {} : []);
    else value = value == null ? '' : String(value);
    normalized[key] = value;
  });
  return coreLegacyHash({ sheet: sheet, row: normalized });
}
function coreHistoryQuantity(row) { return { ukuran: coreMap(row.ukuran), total: coreNum(row.total) }; }
function coreHistoryValidateQuantity(raw, original) {
  var map = coreMap(raw), keys = Object.keys(original.ukuran).sort(), supplied = Object.keys(map).sort(), total = 0, out = {};
  if (!keys.length || keys.join('|') !== supplied.join('|')) throw new Error('Ukuran harus sama dengan catatan asli.');
  keys.forEach(function (key) {
    var value = Number(map[key]);
    if (map[key] === '' || map[key] === null || typeof map[key] === 'boolean' || !isFinite(value) || value < 0 || value !== Math.floor(value) || value > 1000000000) throw new Error('Jumlah harus bilangan bulat 0 sampai 1.000.000.000.');
    total += value; out[key] = value;
  });
  if (!(total > 0) || total > 1000000000) throw new Error('Total koreksi harus 1 sampai 1.000.000.000 pcs.');
  return { ukuran: out, total: total };
}
function coreHistoryChain(sheet, row, ledger) {
  var original = coreHistoryQuantity(row), current = coreHistoryValidateQuantity(original.ukuran, original), sourceHash = coreHistorySourceHash(sheet, row);
  if (current.total !== original.total) throw new Error('Rincian ukuran catatan asli tidak cocok dengan totalnya.');
  var entries = (ledger || []).filter(function (r) { return r.sheet === sheet && r.rowId === row.id; }), byPrevious = {}, ids = {}, history = [], last = '';
  entries.forEach(function (r) {
    var previous = String(r.previousCorrectionId || '');
    if (!r.id || ids[r.id] || byPrevious[previous]) throw new Error('Riwayat koreksi bercabang atau memiliki ID ganda.');
    ids[r.id] = true; byPrevious[previous] = r;
  });
  while (byPrevious[last]) {
    var entry = byPrevious[last], snapshot = coreMap(entry.sourceSnapshot), before = coreMap(entry.before), after = coreMap(entry.after);
    if (history.length >= entries.length || entry.poId !== row.poId || entry.sourceHash !== sourceHash || coreHistorySourceHash(sheet, snapshot) !== sourceHash || coreLegacyHash(before) !== coreLegacyHash(current)) throw new Error('Riwayat koreksi tidak cocok dengan sumber asli.');
    var checked = coreHistoryValidateQuantity(after.ukuran, original);
    if (checked.total !== coreNum(after.total) || !String(entry.reason || '').trim() || String(entry.reason).length > 300 || !entry.createdBy || !entry.createdAt) throw new Error('Bukti koreksi tidak lengkap.');
    current = checked; last = entry.id;
    history.push({ id: entry.id, before: before, after: checked, reason: entry.reason, createdAt: entry.createdAt, createdBy: entry.createdBy });
  }
  if (history.length !== entries.length) throw new Error('Ada bagian riwayat koreksi yang tidak tersambung.');
  return { original: original, effective: current, sourceHash: sourceHash, lastCorrectionId: last, history: history };
}
function coreHistoryPhysicalRows(sheet, rows, ledger) {
  return (rows || []).map(function (row) {
    var copy = {}; Object.keys(row).forEach(function (key) { copy[key] = row[key]; });
    if (!(ledger || []).some(function (entry) { return entry.sheet === sheet && entry.rowId === row.id; })) return copy;
    try {
      var chain = coreHistoryChain(sheet, row, ledger), last = chain.history[chain.history.length - 1];
      copy.ukuran = JSON.stringify(chain.effective.ukuran); copy.total = chain.effective.total;
      copy.historyCorrection = { id: last.id, original: chain.original, reason: last.reason, createdAt: last.createdAt, createdBy: last.createdBy };
    } catch (e) { copy.historyCorrectionError = String(e.message); }
    return copy;
  });
}
function coreInstallHistoryCorrections(actions, ctx) {
  var store = ctx.store;
  function owner(p) { var me = ctx.auth(p); if (me.divisi !== 'owner') ctx.fail('Hanya owner yang boleh mengoreksi riwayat fisik.'); return me; }
  function fresh(names) { if (store.checkpoint) store.checkpoint(names); else if (store.fresh) names.forEach(function (name) { store.fresh(name); }); }
  function read(p) {
    var sheet = String(p.sheet || ''), rowId = String(p.rowId || ''), poId = String(p.poId || '');
    if (['Potong','SlipKirim'].indexOf(sheet) < 0) ctx.fail('Koreksi hanya tersedia untuk potong atau penugasan jahit lama.');
    fresh(['PO',sheet,'KoreksiRiwayat']);
    var po = store.read('PO').filter(function (r) { return r.id === poId; })[0], row = store.read(sheet).filter(function (r) { return r.id === rowId; })[0];
    if (!coreHistoryEligible(po, row, sheet)) ctx.fail('Koreksi hanya tersedia pada catatan lama milik PO aktif yang masih perlu tinjau.');
    var chain = coreHistoryChain(sheet, row, store.read('KoreksiRiwayat'));
    return { sheet: sheet, rowId: rowId, poId: poId, original: chain.original, effective: chain.effective, sourceHash: chain.sourceHash, lastCorrectionId: chain.lastCorrectionId, history: chain.history, eligible: true, payrollUnchanged: true, reviewRemains: true };
  }
  actions.getHistoryCorrection = function (p) { owner(p); return read(p); };
  actions.saveHistoryCorrection = function (p) {
    var me = owner(p), state = read(p), id = String(p.id || ''), reason = String(p.reason || '').trim();
    if (!/^[A-Za-z0-9_-]{6,80}$/.test(id)) ctx.fail('Identitas koreksi tidak sah. Muat ulang formulir.');
    if (!reason || reason.length > 300) ctx.fail('Isi alasan koreksi, maksimal 300 karakter.');
    var after = coreHistoryValidateQuantity(p.ukuran, state.original), expectedHash = String(p.expectedSourceHash || ''), previous = String(p.expectedLastCorrectionId || '');
    var old = store.read('KoreksiRiwayat').filter(function (r) { return r.id === id; })[0];
    if (old) {
      if (old.createdBy !== me.id || old.sheet !== state.sheet || old.rowId !== state.rowId || old.poId !== state.poId || old.sourceHash !== expectedHash || old.previousCorrectionId !== previous || old.reason !== reason || coreLegacyHash(coreMap(old.after)) !== coreLegacyHash(after)) ctx.fail('Identitas koreksi sudah dipakai untuk perubahan lain.');
      state.replayed = true; return state;
    }
    if (!expectedHash || expectedHash !== state.sourceHash || p.expectedLastCorrectionId === undefined || previous !== state.lastCorrectionId) ctx.fail('Sumber atau riwayat berubah sejak formulir dibuka. Muat ulang sebelum menyimpan.');
    if (coreLegacyHash(after) === coreLegacyHash(state.effective)) ctx.fail('Jumlah belum berubah.');
    var row = store.read(state.sheet).filter(function (r) { return r.id === state.rowId; })[0];
    var entry = { id: id, poId: state.poId, sheet: state.sheet, rowId: state.rowId, sourceHash: state.sourceHash, sourceSnapshot: JSON.stringify(row), before: JSON.stringify(state.effective), after: JSON.stringify(after), previousCorrectionId: previous, reason: reason, createdAt: ctx.env.now().toISOString(), createdBy: me.id };
    if (store.validateRows) store.validateRows('KoreksiRiwayat', [entry]);
    store.append('KoreksiRiwayat', entry);
    fresh(['KoreksiRiwayat']);
    return read(p);
  };
}

