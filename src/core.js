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

var APP_VERSION = '1.4.0';
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
  var out = {}, setById = {}, qcById = {}, inspected = {}, repairUsed = {};
  function blank() { return { potong: 0, kirim: 0, diterima: 0, diajukan: 0, rejectJahit: 0, qcOk: 0, qcOffline: 0, qcPerbaikan: 0, qcReject: 0, legacyUnlinkedQC: 0, legacyBlockedCount: 0, legacyWarehouseOK: 0, legacyBigseller: 0, bigseller: 0, maklon: {}, issues: [] }; }
  function size(p, s) { return p.ukuran[s] || (p.ukuran[s] = blank()); }
  function worker(u, id) { return u.maklon[id] || (u.maklon[id] = { kirim: 0, diterima: 0, reject: 0, diajukan: 0 }); }
  function add(p, map, field, who, wf) { Object.keys(map).forEach(function (s) { var u = size(p, s); u[field] += coreNum(map[s]); if (who) worker(u, who)[wf || field] += coreNum(map[s]); }); }
  (poRows || []).forEach(function (r) { var p = out[r.id] = { ukuran: {}, issues: [], warehouse: [], blockedQcSources: {}, legacyWarnings: [], ledgerIssues: [], readyQC: false, complete: false }; Object.keys(coreMap(r.ukuran)).forEach(function (s) { size(p, s); }); if (r.imporReview) p.issues.push(String(r.imporReview)); });
  (potong || []).forEach(function (r) { var p = out[r.poId]; if (p) add(p, coreCategory(r, 'ukuran', 'total', r.ukuran, p.issues), 'potong'); });
  (kirim || []).forEach(function (r) { var p = out[r.poId]; if (p) { if (!r.maklonId) p.issues.push('Penugasan ' + r.id + ' belum punya pekerja.'); add(p, coreCategory(r, 'ukuran', 'total', r.ukuran, p.issues), 'kirim', r.maklonId); } });
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
  var flow = coreWorkflow(poRows, potong, kirim, setor, qc, gudang, extras);
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
  function legacyExtras() { return { gudangLama: store.read('GudangLama'), settlements: store.read('LegacySettlement') }; }
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
  function sourcePaid(id) { return sourceInLegacySettlement(id) || payroll().some(function (r) { return r.sourceId === id && (r.paidQty > 0 || r.overpaidQty > 0 || r.legacyPaid || r.legacySettlementHold || r.legacySettlementId); }); }
  function durableMigrationStatus() { if (store.checkpoint) store.checkpoint(['Pengaturan']); return (store.getSettings() || {}).legacyMigrationStatus; }

  /* ---------- data yang dikirim ke perangkat, disaring menurut divisi ---------- */
  function buildState(me, opt) {
    var migrationStatus = durableMigrationStatus();
    var semua = !!(opt && opt.semua);
    /* tabel yang akan dibaca diambil dari cache dalam satu kali ambil (kalau penyimpanannya mendukung) */
    if (store.prefetch) {
      var perlu = ['Pengaturan', 'Pegawai', 'Produk', 'PO', 'Potong', 'SlipKirim', 'SlipSetor', 'QC', 'Gudang', 'GudangLama', 'SlipUpah', 'LegacySettlement'];
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
    var sheet = String(p.sheet || ''); if (!SCHEMA[sheet] || ['Pengaturan','Gambar','LegacySettlement','MigrasiJournal','GudangLama'].indexOf(sheet) >= 0) fail('Sheet tidak dikenal.');
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
    var proposed = coreWorkflow(isi('PO'), isi('Potong'), isi('SlipKirim'), isi('SlipSetor'), isi('QC'), isi('Gudang'), { gudangLama: isi('GudangLama'), settlements: store.read('LegacySettlement') });
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
  var WRITE = { setupOwner: 1, login: 1, logout: 1, changePin: 1, saveSettings: 1, saveUser: 1, saveProduk: 1, saveGambar: 1, importGambar: 1,
    savePO: 1, setStatusPO: 1, createPotong: 1, createKirim: 1, createSetor: 1, prosesSetor: 1, createQC: 1, createGudang: 1, createUpah: 1,
    tandaiLunas: 1, deleteRecord: 1, importRows: 1, ubahHarga: 1,
    saveStok: 1, cocokkanStok: 1, saveKaryawan: 1, saveGaji: 1, lunasGaji: 1, hapusGaji: 1, createKasbon: 1, createCicilan: 1, gantiImpor: 1, applyLegacyMigration: 1, recoverLegacyMigration: 1 };
  var NO_STATE = { setupOwner: 1, login: 1, logout: 1, importRows: 1, importGambar: 1 };

  function handle(action, payload) {
    var fn = actions[action];
    if (!fn) fail('Aksi tidak dikenal: ' + action);
    payload = payload || {};
    var contractAction = { savePO: 1, setStatusPO: 1, createPotong: 1, createKirim: 1, createSetor: 1, prosesSetor: 1, createQC: 1, createGudang: 1, createUpah: 1, tandaiLunas: 1, ubahHarga: 1, deleteRecord: 1, importRows: 1, gantiImpor: 1, applyLegacyMigration: 1, recoverLegacyMigration: 1 };
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

