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

var APP_VERSION = '1.5.21';
var WORKFLOW_VERSION = 2;

/* Kolom baru selalu ditambahkan di AKHIR daftar: sheet lama mendapat kolom baru di sebelah kanan, isi lama tidak bergeser.
   Kolom "asal" berisi 'lama' untuk baris yang datang dari impor aplikasi lama; baris yang dibuat di aplikasi ini kosong. */
var SCHEMA = {
  Pegawai:   ['id','nama','divisi','pin','token','gagal','kunci','hp','catatan','aktif','dibuat'],
  Produk:    ['id','nama','series','gambar','tarifPotong','tarifJahit','catatan','aktif','dibuat'],
  PO:        ['id','noPO','jenis','produkId','nama','series','pelanggan','deadline','ukuran','total','bahan','catatan','gambar','status','dibuat','dibuatOleh','diubah','selesaiPada','asal','imporVersion','imporReview','imporSumber','tuntasPada','ukuranAktif'],
  Potong:    ['id','poId','userId','tanggal','ukuran','total','bahan','kg','rol','tarif','upahId','catatan','dibuat','bahanList','asal','rencanaId','alokasiBahan'],
  RencanaPotong:['id','poId','bahanList','rol','catatan','status','dibuat','dibuatOleh','diubah','revision','alokasiBahan','poDraft','legacyBahanList'],
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
  StokBahan: ['id','jenis','tanggal','bahan','qty','satuan','rol','harga','total','supplier','invoice','sumber','alasan','catatan','dibuatOleh','dibuat','asal','invoiceId','stockMode','rollLabel','sourceStockId','saldoBefore','saldoAfter','previousCorrectionId','sourceRevision'],
  /* karyawan harian (bukan akun login) dan catatan gaji per orang per hari */
  Karyawan:  ['id','nama','jabatan','gajiHarian','lembur','lemburSabtu','aktif','dibuat','asal'],
  GajiHarian:['id','periode','karyawanId','tanggal','status','gaji','lemburJam','lemburTarif','lemburTotal','sabtuJam','sabtuTarif','sabtuTotal','jumlah','lunas','dibuat','asal'],
  /* kasbon dan cicilannya dalam satu tabel: tipe 'kasbon' atau 'cicilan' (cicilan menunjuk kasbonId) */
  Kasbon:    ['id','tipe','kasbonId','jenis','orangId','nama','tanggal','periode','jumlah','keterangan','dibuatOleh','dibuat','asal'],
  Pengaturan:['key','value'],
  /* Loaded only by the admin commerce modules, never by production state. */
  CommerceRecord:['id','module','kind','parentId','data','revision','dibuat','dibuatOleh','diubah','sourceHash'],
  CommerceEvent:['id','module','parentId','kind','data','dibuat','dibuatOleh','sourceHash'],
  CommerceSource:['id','module','kind','parentId','data','sourceHash'],
  CommerceImport:['id','sourceHash','planHash','status','data','dibuat','dibuatOleh','diubah']
};

var TYPES = {
  saldoBefore:'num', saldoAfter:'num',
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
  bahanSembunyi: [],      /* nama bahan yang tidak ditampilkan lagi di daftar stok */
  poSembunyi: [],         /* id PO selesai/batal yang diarsipkan (keluar dari daftar, tampil di tab Arsip) */
  poBuang: [],            /* id PO selesai/batal yang dihapus dari aplikasi; barisnya tetap karena punya catatan produksi */
  poUkuranLepas: {}       /* id PO -> ukuran aktif yang tidak jadi dipotong di PO itu (tidak lagi menunggu tukang potong) */
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
  var h1 = 0x811c9dc5, h2 = 5381, multiply = Math.imul; s = String(s);
  for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); h1 = multiply(h1 ^ c, 16777619) >>> 0; h2 = (multiply(h2, 33) ^ c) >>> 0; }
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
    if (mulai && String(r.tanggal || '') < mulai && !coreParseJSON(r.alokasiBahan, []).length) return;
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

/* Identified rolls retain the receipt ID. Older aggregate weights stay in a
   separate pool: no even split or inferred assignment to individual rolls. */
function coreFlattenInvoiceRolls(items) {
  if (!(items instanceof Array) || !items.length || items.length > 30) throw new Error('Isi 1 sampai 30 jenis bahan dalam invoice.');
  var out = [];
  items.forEach(function (item) {
    if (!item || typeof item !== 'object') throw new Error('Baris bahan tidak sah.');
    if (item.rolls === undefined) { if (item.stockMode) throw new Error('Rincian berat setiap rol harus diisi untuk invoice rol.'); out.push(item); return; }
    if (item.satuan !== 'kg') throw new Error('Berat rol harus dicatat dalam kg.');
    if (!(item.rolls instanceof Array) || !item.rolls.length || item.rolls.length > 100) throw new Error('Isi 1 sampai 100 berat rol untuk setiap bahan.');
    item.rolls.forEach(function (roll, index) {
      if (!roll || typeof roll !== 'object') throw new Error('Berat rol tidak sah.');
      var label = roll.rollLabel === undefined ? 'Rol ' + (index + 1) : String(roll.rollLabel).trim();
      if (!label || label.length > 60) throw new Error('Label rol wajib diisi, maksimal 60 karakter.');
      out.push({ bahan:item.bahan,satuan:item.satuan,harga:item.harga,qty:roll.qty,rol:1,stockMode:'roll',rollLabel:label });
    });
  });
  if (out.length > 200) throw new Error('Satu invoice maksimal 200 rol.');
  return out;
}
function coreRollInventory(cuts, stock, st, plans, excludeId, knownMaterials) {
  var byId = {}, usedPlans = {}, reservedLegacy = {}, identified = {}, materialMap = {};
  var materials = knownMaterials || coreCutAvailability(cuts, stock, st, plans, excludeId);
  materials.forEach(function (r) { materialMap[r.kunci] = r; });
  (stock || []).forEach(function (r) {
    /* 'rinci' = rol yang dirinci dari stok yang sudah ada (bukan pembelian baru): coreStok tidak menghitungnya,
       jadi total stok tetap; di sini ia mengurangi saldo lama dan menjadi rol yang bisa dipilih. */
    if ((r.jenis !== 'beli' && r.jenis !== 'rinci') || r.stockMode !== 'roll') return;
    var dirinci = r.jenis === 'rinci';
    byId[r.id] = {id:r.id,invoiceId:r.invoiceId || '',invoice:r.invoice || '',bahan:r.bahan,satuan:r.satuan,rollLabel:r.rollLabel || '',qty:coreNum(r.qty),pakai:0,koreksi:0,correctionRevision:'',sourceRevision:coreHash(JSON.stringify([r.id,String(r.bahan || ''),String(r.satuan || ''),String(r.rollLabel || ''),coreNum(r.qty),String(r.invoiceId || ''),String(r.invoice || '')])),saldo:coreNum(r.qty),dicadangkan:0,tersedia:0,status:'tersedia'};
    if (dirinci) byId[r.id].rinci = true;
  });
  (stock || []).forEach(function (r) { var roll=byId[r.sourceStockId]; if (r.jenis === 'koreksi' && roll) { roll.koreksi += coreNum(r.qty); roll.correctionRevision = r.id; } });
  (cuts || []).forEach(function (r) {
    if (r.rencanaId) usedPlans[r.rencanaId] = true;
    coreParseJSON(r.alokasiBahan, []).forEach(function (a) { if (byId[a.stokId]) byId[a.stokId].pakai += coreNum(a.qty); });
  });
  (plans || []).forEach(function (r) {
    if (r.id === excludeId || r.status !== 'siap' || usedPlans[r.id]) return;
    var allocations = coreParseJSON(r.alokasiBahan, []);
    if (allocations.length) allocations.forEach(function (a) { if (byId[a.stokId]) byId[a.stokId].dicadangkan += coreNum(a.qty); });
    coreParseJSON(r.legacyBahanList, allocations.length ? [] : coreParseJSON(r.bahanList, [])).forEach(function (b) { var k = coreNormBahan(b.nama); reservedLegacy[k] = coreNum(reservedLegacy[k]) + coreNum(b.qty); });
  });
  var rolls = Object.keys(byId).map(function (id) {
    var r = byId[id], key = coreNormBahan(r.bahan);
    r.pakai = Math.round(r.pakai * 1000) / 1000; r.koreksi = Math.round(r.koreksi*1000)/1000; r.saldo = Math.round((r.qty+r.koreksi-r.pakai)*1000)/1000;
    r.dicadangkan = Math.round(r.dicadangkan*1000)/1000; r.tersedia = Math.round((r.saldo-r.dicadangkan)*1000)/1000;
    identified[key] = coreNum(identified[key]) + r.saldo;
    r.status = r.saldo < -0.000001 || r.tersedia < -0.000001 ? 'periksa' : r.saldo <= 0 ? 'habis' : r.tersedia <= 0 ? 'dicadangkan' : 'tersedia';
    return r;
  });
  var legacy = materials.map(function (m) { var r = {}; Object.keys(m).forEach(function (k) { r[k] = m[k]; }); r.saldo = Math.round((m.saldo-coreNum(identified[m.kunci]))*1000)/1000; r.dicadangkan = Math.round(coreNum(reservedLegacy[m.kunci])*1000)/1000; r.tersedia = Math.round((r.saldo-r.dicadangkan)*1000)/1000; return r; });
  var legacyMap = {}; legacy.forEach(function (r) { legacyMap[r.kunci] = r; });
  rolls.forEach(function (r) { var k = coreNormBahan(r.bahan), m = materialMap[k], old = legacyMap[k]; if (!m || m.sembunyi || r.satuan !== 'kg' || m.satuan !== r.satuan || old && old.tersedia < -0.000001) { r.tersedia = 0; r.status = 'periksa'; } });
  return { rolls:rolls,byId:byId,materials:materials,legacy:legacy,legacyMap:legacyMap };
}
function coreRollSelection(input, inventory) {
  if (!(input instanceof Array) || !input.length || input.length > 200) throw new Error('Pilih 1 sampai 200 rol yang tersedia.');
  var seen = {}, materials = {}, order = [];
  var allocations = input.map(function (a) {
    a = a || {}; var id = String(a.stokId || ''), roll = inventory.byId[id], qty = coreCutPlanNumber(a.qty);
    if (!roll || seen[id]) throw new Error('Sumber rol tidak tersedia atau dipilih lebih dari sekali.'); seen[id] = true;
    if (!isFinite(qty) || qty <= 0 || qty > 1e8 || Math.abs(qty*1000-Math.round(qty*1000)) > 0.000001) throw new Error('Berat rol harus lebih dari nol, maksimal 3 angka desimal.');
    qty = Math.round(qty*1000)/1000;
    if (roll.status === 'periksa' || qty > roll.tersedia + 0.000001) throw new Error('Berat ' + roll.rollLabel + ' melebihi stok rol yang tersedia. Periksa cadangan dan riwayat stok.');
    var key = coreNormBahan(roll.bahan); if (!materials[key]) { materials[key] = {nama:roll.bahan,satuan:roll.satuan,qty:0}; order.push(key); }
    materials[key].qty += qty;
    return {stokId:id,qty:qty};
  });
  if (order.length > 20) throw new Error('Satu persiapan maksimal 20 jenis bahan.');
  var list = order.map(function (key) { materials[key].qty = Math.round(materials[key].qty*1000)/1000; return materials[key]; });
  coreCutCheckAvailable(list, inventory.materials);
  return {alokasiBahan:allocations,bahanList:list,rol:allocations.length};
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
  (rows || []).forEach(function (r) { if (r.tipe === 'kasbon') { var k = { id: r.id, jenis: r.jenis, orangId: r.orangId, nama: r.nama, tanggal: r.tanggal, jumlah: coreNum(r.jumlah), keterangan: r.keterangan || '', dibuat: r.dibuat || '', asal: r.asal || '', cicilan: [], dicicil: 0 }; byId[r.id] = k; list.push(k); } });
  (rows || []).forEach(function (r) { if (r.tipe === 'cicilan' && byId[r.kasbonId]) { byId[r.kasbonId].cicilan.push({ id: r.id, tanggal: r.tanggal, periode: r.periode || '', jumlah: coreNum(r.jumlah), keterangan: r.keterangan || '', dibuat: r.dibuat || '', asal: r.asal || '' }); byId[r.kasbonId].dicicil += coreNum(r.jumlah); } });
  list.forEach(function (k) {
    k.cicilan.sort(function (a, b) { return (String(a.tanggal) + String(a.dibuat)) < (String(b.tanggal) + String(b.dibuat)) ? -1 : 1; });
    k.sisa = Math.max(0, k.jumlah - k.dicicil); k.lunas = k.sisa <= 0;
  });
  return list;
}
/* Slip gaji mana yang memuat sebuah cicilan kasbon karyawan harian. Cicilan menyimpan nama periodenya sendiri; kalau
   periode itu memang punya data gaji orangnya, itulah slipnya. Kalau tidak (mis. gaji dicatat dengan rentang 5–10 Okt
   sementara cicilan tersimpan sebagai minggu "2026-W41"), dipakai periode gaji yang rentangnya memuat tanggal potong.
   Cicilan dari aplikasi lama tetap di periode asalnya, supaya slip lama tidak berubah. */
function coreCicilanPeriode(cicilan, periods) {
  var own = String((cicilan && cicilan.periode) || '');
  if (!cicilan || own === 'penyesuaian') return '';
  periods = periods || [];
  if (periods.indexOf(own) >= 0 || cicilan.asal === 'lama') return own;
  var hit = '', mulai = '', tanggal = String(cicilan.tanggal || '');
  periods.forEach(function (id) { var p = corePeriode(id); if (!p || tanggal < p.start || tanggal > p.end) return; if (!hit || p.start > mulai || (p.start === mulai && id < hit)) { hit = id; mulai = p.start; } });
  return hit || own;
}

/* Workflow v2. All helpers accept stored JSON strings or parsed maps; no browser/server APIs.
   coreWorkflow returns a PO-id map. ukuran[size] is the authoritative SKU/cycle gate.
   warehouse is a projection of QC receipts, never a second mutable transaction table.
   corePayroll returns earned rows, including immutable paid allocation and available qty. */
function coreMap(v) { var o = coreParseJSON(v, {}); return o && typeof o === 'object' && !(o instanceof Array) ? o : {}; }
/* Legacy compatibility is explicit migration evidence, never a fallback for missing v2 fields. */
/* Verified source sizes carry identities, never invented target quantities.
   proofHash checks integrity; only the verified migration may create this marker. */
function coreLegacyCuttingEvidence(po) {
  var evidence = coreMap(po && po.imporSumber).legacyCutting;
  if (!evidence) return null;
  var invalid = { valid: false, ukuran: [] };
  if (!po || evidence.version !== 1 || evidence.source !== 'verified-full-backup' || !/^[a-f0-9]{64}$/.test(String(evidence.snapshotHash || '')) || !String(evidence.batchId || '').trim() || !(evidence.sizes instanceof Array) || !evidence.sizes.length || !(evidence.plans instanceof Array) || typeof coreLegacyHash !== 'function') return invalid;
  var proof = { poId: po.id, snapshotHash: evidence.snapshotHash, batchId: evidence.batchId, sizes: evidence.sizes, plans: evidence.plans };
  if (evidence.proofHash !== coreLegacyHash(proof)) return invalid;
  var sizes = [], ids = {};
  for (var i = 0; i < evidence.sizes.length; i++) {
    var r = evidence.sizes[i], cycle = coreParseJSON(r && r.cycle, null), size = r && r.ukuran;
    if (!r || typeof r.skuId !== 'string' || !r.skuId || ids[r.skuId] || typeof r.cycle !== 'string' || !cycle || String(cycle[0]) !== r.skuId || typeof size !== 'string' || !size.trim() || size !== size.trim() || size.length > 40 || /^(?:__proto__|constructor|prototype)$/.test(size) || sizes.indexOf(size) >= 0 || typeof r.hadCutAtImport !== 'boolean') return invalid;
    ids[r.skuId] = true; sizes.push(size);
  }
  return { valid: true, ukuran: coreSizeOrder(sizes) };
}
function coreLegacyCutPlanScope(po, rencanaId, cutting) {
  var evidence = coreMap(po && po.imporSumber).legacyCutting;
  if (!evidence || !(evidence.plans instanceof Array)) return null;
  var links = evidence.plans.filter(function (r) { return r && r.rencanaId === rencanaId; });
  if (!links.length) return null;
  var r = links[0], sizes = r.ukuran instanceof Array ? r.ukuran.slice() : [], valid = coreLegacyCuttingEvidence(po);
  var reason = '';
  if (!valid || !valid.valid || links.length !== 1 || r.status !== 'ready' || r.reviewCode || sizes.length !== 1 || valid.ukuran.indexOf(sizes[0]) < 0) reason = 'Jatah bahan lama perlu diperiksa owner sebelum dipakai.';
  else if (!cutting || (cutting.pendingUkuran || []).indexOf(sizes[0]) < 0) reason = 'Ukuran pada jatah lama sudah dipotong atau PO tidak aktif. Periksa bersama owner.';
  return { ukuran: sizes, blocked: reason };
}
function coreActiveSizes(po) {
  var raw = po && po.ukuranAktif;
  if (raw === undefined || raw === null || raw === '') return null;
  var sizes = coreParseJSON(raw, null), seen = {};
  if (!(sizes instanceof Array) || !sizes.length || sizes.length > 40) return { valid:false, ukuran:[] };
  for (var i=0;i<sizes.length;i++) {
    var s=sizes[i];
    if (typeof s !== 'string' || !s.trim() || s !== s.trim() || s.length > 40 || /^(?:__proto__|constructor|prototype)$/.test(s) || seen[s]) return {valid:false,ukuran:[]};
    seen[s]=true;
  }
  return {valid:true,ukuran:coreSizeOrder(sizes.slice())};
}
function coreCuttingProjection(poRows, physicalCuts, lepas) {
  lepas = coreMap(lepas);
  var totals = {}, out = {};
  (physicalCuts || []).forEach(function (r) { var map = coreMap(r.ukuran), po = totals[r.poId] || (totals[r.poId] = {}); Object.keys(map).forEach(function (size) { if (coreNum(map[size]) > 0) po[size] = coreNum(po[size]) + coreNum(map[size]); }); });
  (poRows || []).forEach(function (p) {
    var native = coreActiveSizes(p), legacy = coreLegacyCuttingEvidence(p), evidence = legacy || native; if (!evidence) return;
    /* ukuran yang dilepas owner ("tidak jadi dipotong di PO ini") tidak lagi menunggu tukang potong dan tidak menahan PO */
    var dilepas = lepas[p.id] instanceof Array ? lepas[p.id] : [], belum = evidence.valid && p.status === 'aktif' ? evidence.ukuran.filter(function (size) { return !(coreNum((totals[p.id] || {})[size]) > 0); }) : [];
    var projection = out[p.id] = { verified: evidence.valid, ukuran: evidence.ukuran, pendingUkuran: belum.filter(function (size) { return dilepas.indexOf(size) < 0; }), lepasUkuran: belum.filter(function (size) { return dilepas.indexOf(size) >= 0; }), needsReview: !evidence.valid };
    if (evidence.valid && legacy) {
      var plans = coreMap(p.imporSumber).legacyCutting.plans;
      var review = plans.filter(function (r) { return r && r.status === 'ready' && (!r.rencanaId || r.reviewCode); }).map(function (r) {
        var reasons = {
          'already-cut-or-used': 'Ukuran jatah ini sudah memiliki hasil potong atau pemakaian bahan. Periksa riwayat; jangan dicatat ulang.',
          'missing-purchase-proof': 'Bukti pembelian rol sumber tidak ditemukan. Owner perlu mencocokkan catatan pembelian sebelum jatah dipakai.',
          'multi-size-plan-needs-batch-review': 'Jatah lama mencakup beberapa ukuran. Pembagian bahan per hasil perlu diperiksa owner sebelum jatah dipakai.'
        };
        return { ukuran: (r.ukuran instanceof Array ? r.ukuran : []).filter(function (size) { return evidence.ukuran.indexOf(size) >= 0; }), reason: reasons[r.reviewCode] || 'Jatah bahan lama perlu diperiksa owner sebelum dipakai.' };
      });
      if (review.length) projection.reviewPlans = review;
    }
  });
  return out;
}

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
  var out = {}, setById = {}, qcById = {}, inspected = {}, repairUsed = {}, cutting = coreCuttingProjection(poRows, potong, extras.ukuranLepas);
  function blank() { return { potong: 0, kirim: 0, diterima: 0, diajukan: 0, rejectJahit: 0, qcOk: 0, qcOffline: 0, qcPerbaikan: 0, qcReject: 0, legacyUnlinkedQC: 0, legacyBlockedCount: 0, legacyWarehouseOK: 0, legacyBigseller: 0, bigseller: 0, maklon: {}, issues: [] }; }
  function size(p, s) { return p.ukuran[s] || (p.ukuran[s] = blank()); }
  function worker(u, id) { return u.maklon[id] || (u.maklon[id] = { kirim: 0, diterima: 0, reject: 0, diajukan: 0 }); }
  function add(p, map, field, who, wf) { Object.keys(map).forEach(function (s) { var u = size(p, s); u[field] += coreNum(map[s]); if (who) worker(u, who)[wf || field] += coreNum(map[s]); }); }
  (poRows || []).forEach(function (r) { var p = out[r.id] = { ukuran: {}, issues: [], warehouse: [], blockedQcSources: {}, legacyWarnings: [], ledgerIssues: [], readyQC: false, complete: false }; Object.keys(coreMap(r.ukuran)).forEach(function (s) { size(p, s); }); if (r.imporReview) p.issues.push(String(r.imporReview)); var c = cutting[r.id]; if (c) { p.cutting = c; if (r.status === 'aktif') { if (c.needsReview) p.issues.push('Bukti ukuran potong asal perlu diperiksa owner.'); p.pendingCutSizes = c.pendingUkuran.slice(); } } });
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
      /* countComplete: seluruh ukuran ini sudah kembali dari jahit dan dihitung. readyQC: hitungan yang sudah diterima
         boleh diperiksa QC sekarang, per slip, tanpa menunggu sisa jahitan (penjahit menyetor bertahap). */
      u.countComplete = u.targetBaik > 0 && u.diterima === u.targetBaik && u.sisaMaklon === 0 && u.diajukan === 0 && !u.issues.length && !p.issues.length;
      u.readyQC = u.diterima > 0 && !u.issues.length && !p.issues.length;
      u.complete = u.countComplete && u.siapQC === 0 && u.qcPerbaikan === 0 && !u.legacyUnlinkedQC;
      if (u.readyQC && u.siapQC > 0) p.readyQC = true;
      if (!u.complete) p.complete = false;
    });
    keys.forEach(function (s) { p.ukuran[s].issues.forEach(function (issue) { p.issues.push(s + ': ' + issue); }); });
    if (p.issues.length) { p.readyQC = false; p.complete = false; keys.forEach(function (s) { p.ukuran[s].readyQC = false; p.ukuran[s].countComplete = false; p.ukuran[s].complete = false; }); }
    if (p.pendingCutSizes && p.pendingCutSizes.length) p.complete = false;
  });
  return out;
}
/* True once the entire PO has returned from sewing and been counted. It no longer gates QC
   (counted receipts are inspected per slip); it still tells the screens whether sewing is finished. */
function corePoCountComplete(flow) {
  if (!flow || (flow.issues || []).length || flow.pendingCutPlans || (flow.pendingCutSizes || []).length) return false;
  var active = Object.keys(flow.ukuran || {}).filter(function (s) { return coreNum(flow.ukuran[s].target) > 0; });
  return active.length > 0 && active.every(function (s) {
    var u = flow.ukuran[s];
    return !(u.issues || []).length && u.kirim === u.target && u.sisaMaklon === 0 && u.diajukan === 0 && u.diterima + u.rejectJahit === u.target;
  });
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
      /* Sisa laporan lama yang dihitung bertahap (imporSumber.sisaDari) tetap mengikuti ikatan sumber asalnya. */
      var key = pool(entry.sourceId, entry.size), list = (bySource[key] || []).concat(rows.filter(function (r) { return r.imporSumber && r.imporSumber.sisaDari === entry.sourceId && r.size === entry.size && r.sourceId !== entry.sourceId; }));
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
function coreAggregate(poRows, potong, kirim, setor, qc, gudang, extras, knownFlow) {
  var flow = knownFlow || coreWorkflow(poRows, potong, kirim, setor, qc, gudang, extras);
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
    if (!ctx.hideMoney && rec.upah && !belumSlip) L.push('Harga: ' + coreRupiah(rec.upah) + '/pcs');
    if (!ctx.hideMoney && type === 'setor' && !belumSlip) {
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
      L.push('• ' + (p2.nama || 'Barang') + ' — ' + coreRibuan(it.total) + ' pcs' + (ctx.hideMoney ? '' : ' x ' + coreRupiah(rate) + ' = ' + coreRupiah(it.total * rate)));
    });
    L.push('');
    L.push('Total: ' + coreRibuan(rec.totalQty) + ' pcs' + (ctx.hideMoney ? '' : ' = ' + coreRupiah(rec.totalUpah)));
    if (!ctx.hideMoney && rec.potongan) L.push('Potongan: ' + coreRupiah(rec.potongan));
    if (!ctx.hideMoney) L.push('*Dibayar: ' + coreRupiah(rec.dibayar) + '*');
    if (rec.catatan) L.push('Catatan: ' + rec.catatan);
  }
  L.push('— ' + (st.kopSlip || st.namaUsaha || '') + (st.kopSub ? ' · ' + st.kopSub : ''));
  return L.join('\n');
}

/* ============================================================ */
function createCore(store, env) {
  var insideWrite = false, skipAutoCompletion = false;

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
    if (!(out.poSembunyi instanceof Array)) out.poSembunyi = [];
    if (!(out.poBuang instanceof Array)) out.poBuang = [];
    if (!out.poUkuranLepas || typeof out.poUkuranLepas !== 'object' || out.poUkuranLepas instanceof Array) out.poUkuranLepas = {};
    return out;
  }

  function users() { return store.read('Pegawai'); }
  function findUser(id) { var us = users(); for (var i = 0; i < us.length; i++) if (us[i].id === id) return us[i]; return null; }
  function findRow(sheet, id) { if (!id) return null; var rs = store.read(sheet); for (var i = 0; i < rs.length; i++) if (rs[i].id === id) return rs[i]; return null; }
  /* Sesi masuk (token). Kalau penyimpanannya menyediakan tempat khusus (store.sesi; di server: catatan kecil milik
     script, bukan Google Sheets), sesi baru dicatat di sana, sehingga masuk dan keluar tidak perlu membuka spreadsheet.
     Token yang masih ada di kolom token (sesi dari versi sebelumnya) tetap berlaku sampai orangnya keluar, PIN-nya
     diganti, atau akunnya dinonaktifkan. */
  function tokenKolom(u) { return String(u.token || '').split(',').filter(Boolean); }
  function tokenSesi(u) { return store.sesi ? store.sesi.get(u.id) : []; }
  function tokensOf(u) { return tokenKolom(u).concat(tokenSesi(u)); }
  function hapusSesi(id) { if (store.sesi) store.sesi.set(id, []); }
  /* tabel yang dibaca buildState untuk satu akun; dipakai juga untuk memanaskan cache dan memeriksa "sudah siap" */
  function stateTables(me) {
    var perlu = ['Pengaturan', 'Pegawai', 'Produk', 'PO', 'Potong', 'RencanaPotong', 'SlipKirim', 'SlipSetor', 'QC', 'Gudang', 'GudangLama', 'SlipUpah', 'LegacySettlement', 'KoreksiRiwayat'];
    if (!me || coreIsAdmin(me)) perlu = perlu.concat(['StokBahan', 'GajiHarian', 'Karyawan', 'Kasbon']);
    else if (me.divisi === 'potong') perlu.push('StokBahan', 'Kasbon');
    else if (me.divisi === 'jahit') perlu.push('Kasbon');
    return perlu;
  }

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
    store.read('SlipKirim').concat(store.read('SlipSetor')).forEach(function (r) { var worker = findUser(r.maklonId), p = wf[r.poId]; if (p && (!worker || worker.divisi !== 'jahit')) { p.issues.push('Pekerja asal ' + r.id + ' tidak dikenal.'); p.readyQC = false; p.complete = false; Object.keys(p.ukuran).forEach(function (s) { p.ukuran[s].readyQC = false; p.ukuran[s].complete = false; }); } });
    if (typeof coreCutPlanRows === 'function') coreCutPlanRows(store.read('RencanaPotong'), store.read('Potong')).forEach(function (r) { var p = wf[r.poId]; if (p && r.status === 'siap') { p.pendingCutPlans = true; p.complete = false; } });
    return wf;
  }
  function legacyExtras() { return { gudangLama: store.read('GudangLama'), settlements: store.read('LegacySettlement'), historyCorrections: store.read('KoreksiRiwayat'), ukuranLepas: settings().poUkuranLepas }; }
  function workflow() { return validateWorkers(coreWorkflow(store.read('PO'), store.read('Potong'), store.read('SlipKirim'), store.read('SlipSetor'), store.read('QC'), store.read('Gudang'), legacyExtras())); }
  function payroll() { return corePayroll(store.read('Potong'), store.read('SlipSetor'), store.read('QC'), store.read('SlipUpah'), legacyExtras()); }
  function poClean(po) { var w = workflow()[po.id]; if (w && w.issues.length) fail(w.issues[0]); return w; }
  function strictSizes(raw, po, allowEmpty) {
    var map = coreMap(raw), out = {}, evidence = coreLegacyCuttingEvidence(po), active = evidence ? null : coreActiveSizes(po), planned = active && active.valid ? active.ukuran.slice() : Object.keys(coreMap(po.ukuran));
    if (active && !active.valid) fail('Ukuran aktif PO perlu diperiksa owner.');
    if (evidence && evidence.valid) evidence.ukuran.forEach(function (size) { if (planned.indexOf(size) < 0) planned.push(size); });
    var allowed = planned.length ? planned : settings().ukuran;
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
    /* sisa laporan lama yang dihitung bertahap mewarisi ikatan pembayaran sumber asalnya */
    var row = String(id).indexOf(':') < 0 ? findRow('SlipSetor', String(id)) : null, akar = row ? String(coreMap(row.imporSumber).sisaDari || '') : '';
    return store.read('LegacySettlement').some(function (b) { return coreParseJSON(b.baselineSources, []).some(function (s) { return s.sourceId === id || (akar && s.sourceId === akar); }); });
  }
  function correctedSource(sheet, id) { return store.read('KoreksiRiwayat').some(function (r) { return r.sheet === sheet && r.rowId === id; }); }
  function sourcePaid(id) { return sourceInLegacySettlement(id) || payroll().some(function (r) { return r.sourceId === id && (r.paidQty > 0 || r.overpaidQty > 0 || r.legacyPaid || r.legacySettlementHold || r.legacySettlementId); }); }
  function durableMigrationStatus() {
    if (store.getMigrationStatusFresh) return store.getMigrationStatusFresh();
    if (store.checkpoint) store.checkpoint(['Pengaturan']);
    return (store.getSettings() || {}).legacyMigrationStatus;
  }

  function advanceCompletion(me, opt) {
    function advance() {
      var pending = durableMigrationStatus();
      if (pending) return buildState(me, opt, pending, true);
      /* Cached candidates are only a hint. Re-read all production evidence and
         the actor before any status transition, including during a write. */
      if (store.checkpoint) store.checkpoint(['PO', 'Potong', 'RencanaPotong', 'SlipKirim', 'SlipSetor', 'QC', 'Gudang', 'GudangLama', 'LegacySettlement', 'KoreksiRiwayat', 'Pegawai']);
      var actor = findUser(me.id);
      if (!actor || !actor.aktif) fail('Akun ini sudah dinonaktifkan.');
      if (!insideWrite && opt && opt.token) actor = auth(opt);
      var freshFlow = workflow();
      var plan = coreAutoCompletionPlan(store.read('PO'), freshFlow, env.now());
      plan.patches.forEach(function (patch) { store.update('PO', patch.id, patch.changes); });
      return buildState(actor, opt, null, true, freshFlow);
    }
    return insideWrite ? advance() : store.lock(advance);
  }

  /* ---------- data yang dikirim ke perangkat, disaring menurut divisi ---------- */
  function buildState(me, opt, migrationStatus, skipAdvance, knownFlow) {
    if (arguments.length < 3) migrationStatus = durableMigrationStatus();
    var semua = !!(opt && opt.semua);
    /* tabel yang akan dibaca diambil dari cache dalam satu kali ambil (kalau penyimpanannya mendukung) */
    if (store.prefetch) store.prefetch(stateTables(me));
    var st = settings();
    var allUsers = users();
    var produk = store.read('Produk');
    var po = withParsed(store.read('PO'), 'ukuran', {});
    po.forEach(function (p) { if (p.ukuranAktif) p.ukuranAktif = coreParseJSON(p.ukuranAktif, p.ukuranAktif); });
    var potong = withParsed(store.read('Potong'), 'ukuran', {});
    var kirim = withParsed(store.read('SlipKirim'), 'ukuran', {});
    var setor = withParsed(store.read('SlipSetor'), 'ukuran', {});
    var qc = withParsed(store.read('QC'), 'ukuran', {});
    var gudang = withParsed(store.read('Gudang'), 'ukuran', {});
    var upah = withParsed(store.read('SlipUpah'), 'itemIds', []);
    upah = withParsed(upah, 'items', []);
    var extras = legacyExtras();
    var wf = knownFlow || validateWorkers(coreWorkflow(po, potong, kirim, setor, qc, gudang, extras));
    if (!skipAdvance && !skipAutoCompletion && !migrationStatus && typeof coreAutoCompletionPlan === 'function' && coreAutoCompletionPlan(po, wf, env.now()).patches.length) return advanceCompletion(me, opt);
    var agg = coreAggregate(po, potong, kirim, setor, qc, gudang, extras, wf);
    var earned = corePayroll(potong, setor, qc, upah, extras);
    /* Hydrate only the response copy for historical receipt rendering. Stored SlipUpah stays unchanged. */
    upah.forEach(function (u) { if (!u.items.length) { var original = coreLegacySlipItems(u, extras.settlements); if (original.length) u.items = original; } });
    po.forEach(function (p) { p.agg = agg[p.id]; p.workflow = wf[p.id]; if (wf[p.id] && wf[p.id].cutting) p.cutting = wf[p.id].cutting; });
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
      stokRingkas = typeof coreCutAvailability === 'function' ? coreCutAvailability(potong, stokRows, st, store.read('RencanaPotong')) : coreStok(potong, stokRows, st);
      if (typeof coreCutPlanRows === 'function') {
        var inventory = coreRollInventory(potong, stokRows, st, store.read('RencanaPotong'), '', stokRingkas);
        stokRingkas.forEach(function (m) { var legacy = inventory.legacyMap[m.kunci]; m.legacySaldo = legacy.saldo; m.legacyTersedia = legacy.tersedia; });
        if (admin) out.stokRol = inventory.rolls;
        out.rencanaPotong = coreCutPlanRows(store.read('RencanaPotong'), potong, store.read('PO')).filter(function (r) { return admin || r.status === 'siap' || r.userId === me.id; });
        out.rencanaPotong.forEach(function (r) { var parent = po.filter(function (p) { return p.id === r.poId; })[0], scope = coreLegacyCutPlanScope(parent, r.id, parent && parent.cutting); if (scope) { r.legacyUkuran = scope.ukuran; r.legacyBlocked = scope.blocked; } r.rincianRol = r.alokasiBahan.map(function (a) { var roll = inventory.byId[a.stokId] || {}; return {stokId:a.stokId,qty:coreNum(a.qty),bahan:roll.bahan || '',satuan:roll.satuan || '',invoice:roll.invoice || '',rollLabel:roll.rollLabel || ''}; }); });
        if (!admin) out.rencanaPotong.forEach(function (r) { delete r.poDraft; });
      }
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

    /* Workers receive only the size projection, never raw source identities or migration evidence. */
    po.forEach(function (p) { delete p.imporSumber; });
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
      out.bahan = (stokRingkas || []).filter(function (b) { return !b.sembunyi; }).map(function (b) { return { nama: b.nama, satuan: b.satuan, saldo: b.saldo, dicadangkan: coreNum(b.dicadangkan), tersedia: b.tersedia === undefined ? b.saldo : b.tersedia }; });
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

  function deferredSession(u, token) {
    return { token: token, me: publicUser(u, true), deferredState: true, appVersion: APP_VERSION, workflowVersion: WORKFLOW_VERSION, contractVersion: WORKFLOW_VERSION };
  }
  function loginResult(u, opt, allowDeferred) {
    var token = genToken();
    if (store.sesi) {
      var s = tokenSesi(u); s.push(token);
      while (s.length > MAX_SESI) s.shift();
      store.sesi.set(u.id, s);
      /* Tab Pegawai hanya ditulis kalau ada hitungan salah PIN atau kunci yang perlu dihapus. Sesi yang terbuang
         karena melebihi batas langsung tidak berlaku: setiap permintaan memeriksa tokennya ke daftar sesi ini. */
      if (coreNum(u.gagal) || u.kunci) store.update('Pegawai', u.id, { gagal: 0, kunci: '' });
    } else {
      var list = tokenKolom(u); list.push(token);
      while (list.length > MAX_SESI) list.shift();
      store.update('Pegawai', u.id, { token: list.join(','), gagal: 0, kunci: '' });
    }
    var actor = findUser(u.id);
    if (allowDeferred && opt && opt.deferState === true) {
      /* Satu kali jalan: kalau semua tabel untuk akun ini sudah ada di cache server, datanya langsung ikut dikirim
         sehingga perangkat tidak perlu bolak-balik kedua. Kalau belum, identitas dikirim dulu seperti biasa dan
         perangkat mengambil datanya sendiri; PIN tidak pernah tertahan oleh pembacaan Google Sheets yang lama. */
      if (opt.stateIfWarm === true && store.cached && store.cached(stateTables(actor))) {
        try { return { token: token, state: buildState(actor, opt) }; } catch (e) {}
      }
      return deferredSession(actor, token);
    }
    return { token: token, state: buildState(actor, opt) };
  }

  /* ---------- aksi ---------- */
  var actions = {};

  actions.bootstrap = function (p) {
    /* Resume only after checking the current account row. The caller can show
       this verified identity while fetching its scoped production state once. */
    if (p && p.deferState === true && p.token) {
      /* Akun dibaca dari cache berversi (versinya naik setiap akun diubah lewat aplikasi atau diedit di sheet).
         Baris fisik baru dibaca kalau sesi itu tidak ditemukan di sana. */
      var resumed = null; try { resumed = auth(p); } catch (e) {}
      if (!resumed && store.fresh) { store.fresh('Pegawai'); try { resumed = auth(p); } catch (e2) {} }
      /* Kalau perangkat meminta dan semua tabel akun ini sudah ada di cache, lanjut ke jalur biasa di bawah yang
         langsung menyertakan datanya (satu kali jalan). Kalau belum, identitas dikirim dulu. */
      var siap = !!(resumed && p.stateIfWarm === true && store.cached && store.cached(stateTables(resumed)));
      if (resumed && !siap) return deferredSession(resumed, String(p.token));
    }
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
    var me = auth(p);
    var pendingMigration = durableMigrationStatus();
    var due = typeof coreAutoCompletionDue === 'function' && coreAutoCompletionDue(store.read('PO'), env.now());
    if (!pendingMigration && !due && p && p.ver !== undefined && String(p.ver) === String(store.version()) && (p.av === undefined || String(p.av) === APP_VERSION)) return { same: true, ver: store.version() };
    return buildState(me, p, pendingMigration);
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
    /* Jalur cepat: akun dari cache berversi di dalam kunci login. Dipakai hanya kalau akunnya aktif, tidak sedang
       dikunci, tidak punya hitungan salah PIN, dan PIN-nya cocok; sesi lalu dicatat tanpa menyentuh Google Sheets.
       Untuk keadaan lain (PIN tidak cocok, akun tidak ditemukan, ada hitungan/kunci) baris fisik dibaca dulu,
       sehingga penolakan dan penghitung salah PIN selalu berdasarkan isi sheet yang terbaru. */
    var u = findUser(String(p.userId || ''));
    var cepat = !!(store.sesi && u && u.aktif && pinOk(u) && !u.kunci && !coreNum(u.gagal) && String(u.pin) === String(p.pin || ''));
    if (!cepat) { if (store.fresh) store.fresh('Pegawai'); u = findUser(String(p.userId || '')); }
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
    return loginResult(u, p, true);
  };

  actions.logout = function (p) {
    var token = String(p.token || ''); if (!token) return { ok: true };
    users().forEach(function (u) {
      var list = tokenKolom(u); var i = list.indexOf(token);
      if (i >= 0) { list.splice(i, 1); store.update('Pegawai', u.id, { token: list.join(',') }); }
      if (store.sesi) { var s = tokenSesi(u); var j = s.indexOf(token); if (j >= 0) { s.splice(j, 1); store.sesi.set(u.id, s); } }
    });
    return { ok: true };
  };

  /* Memanaskan server: tanpa login dan tanpa mengembalikan data apa pun. Tabel yang salinannya sudah tidak ada di
     cache dibaca dari sheet dan disimpan lagi. Aplikasi memanggilnya saat layar masuk tampil, sehingga begitu PIN
     dimasukkan server tidak perlu lagi membuka Google Sheets. */
  actions.hangat = function () {
    var perlu = stateTables(null);
    if (store.prefetch) store.prefetch(perlu);
    perlu.forEach(function (n) { if (n === 'Pengaturan') store.getSettings(); else store.read(n); });
    return { siap: true };
  };

  actions.changePin = function (p) {
    var me = auth(p);
    /* hanya owner yang memegang PIN: PIN-nya sendiri dan PIN semua pegawai */
    if (me.divisi !== 'owner') fail('PIN hanya bisa diganti oleh owner. Minta owner menggantinya di menu Pegawai.');
    if (String(me.pin) !== String(p.pinLama || '')) fail('PIN lama salah.');
    var pin = String(p.pinBaru || '').trim(); if (!/^\d{4,6}$/.test(pin)) fail('PIN baru harus 4 sampai 6 angka.');
    /* perangkat lain otomatis keluar: hanya sesi perangkat ini yang dipertahankan */
    store.update('Pegawai', me.id, { pin: pin, token: store.sesi ? '' : String(p.token) });
    if (store.sesi) store.sesi.set(me.id, [String(p.token)]);
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
    if (s.poSembunyi !== undefined) {
      /* PO selesai/batal yang "dihapus dari daftar" hanya disembunyikan; catatan produksi dan upahnya tetap. */
      var poDiam = {}; store.read('PO').forEach(function (r) { if (r.status !== 'aktif') poDiam[r.id] = 1; });
      var poLihat = {}; st.poSembunyi = (s.poSembunyi instanceof Array ? s.poSembunyi : []).map(function (x) { return String(x || ''); })
        .filter(function (x) { if (!poDiam[x] || poLihat[x]) return false; poLihat[x] = 1; return true; });
      if (JSON.stringify(st.poSembunyi).length > 45000) fail('Daftar PO yang dihapus dari daftar sudah terlalu panjang.');
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
      if (patch.token === '') hapusSesi(old.id);
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
  function checkedGambarData(dataUrl) {
    dataUrl = String(dataUrl || '');
    if (dataUrl && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(dataUrl)) fail('File gambar tidak valid.');
    if (dataUrl.length > MAX_GAMBAR) fail('Gambar terlalu besar.');
    return dataUrl;
  }
  function putGambar(id, jenis, dataUrl) {
    var sheet = jenis === 'po' ? 'PO' : 'Produk';
    if (!findRow(sheet, id)) return false;
    dataUrl = checkedGambarData(dataUrl);
    var old = findRow('Gambar', id);
    var ganti = {};
    if (!dataUrl) { if (old) store.remove('Gambar', id); store.update(sheet, id, { gambar: '' }); ganti[id] = ''; if (store.imgPut) store.imgPut(ganti); return true; }
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

  var previewNewPO = false, legacyPendingPO = false;
  actions.savePO = function (p) {
    var me = auth(p); mustAdmin(me);
    var po = p.po || {};
    var hasGambar = Object.prototype.hasOwnProperty.call(p, 'gambarData');
    var gambarData = hasGambar ? checkedGambarData(p.gambarData) : '';
    function withGambar(row) {
      if (previewNewPO) return copy(row);
      if (hasGambar) putGambar(row.id, 'po', gambarData);
      return findRow('PO', row.id);
    }
    var jenis = PO_JENIS.indexOf(po.jenis) >= 0 ? po.jenis : 'stok';
    var produk = po.produkId ? findRow('Produk', String(po.produkId)) : null;
    if (po.produkId && !produk) fail('Produk tidak ditemukan.');
    var nama = teks(po.nama || (produk ? produk.nama : ''), 80).trim().toUpperCase();
    var series = teks(po.series !== undefined && po.series !== '' ? po.series : (produk ? produk.series : ''), 60).trim().toUpperCase();
    if (!nama) fail('Nama barang wajib diisi.');
    var oldPO = po.id ? findRow('PO',String(po.id)) : po.newId ? findRow('PO',String(po.newId)) : null;
    var activeSizes = coreActiveSizes(po), priorSizes = coreActiveSizes(oldPO);
    if (oldPO && oldPO.asal === 'lama') {
      if (activeSizes) fail('Ukuran aktif data lama mengikuti bukti asal. Gunakan pemeriksaan riwayat.');
    } else if (priorSizes && !activeSizes) activeSizes = priorSizes;
    var ukuran = oldPO && oldPO.asal === 'lama' ? coreMap(oldPO.ukuran) : coreCleanSizes(po.ukuran);
    var total = oldPO && oldPO.asal === 'lama' ? coreNum(oldPO.total) : coreSumSizes(ukuran) || Math.max(0, coreInt(po.total));
    if (!oldPO && !legacyPendingPO && !activeSizes) fail('PO baru harus memilih ukuran aktif tanpa target pcs. Muat ulang aplikasi dan siapkan bahan terlebih dahulu.');
    if (activeSizes) {
      if (!activeSizes.valid) fail('Pilih minimal satu ukuran aktif yang sah, tanpa duplikat.');
      var configured = settings().ukuran, priorAllowed = priorSizes && priorSizes.valid ? priorSizes.ukuran : [];
      if (activeSizes.ukuran.some(function (s) { return configured.indexOf(s) < 0 && priorAllowed.indexOf(s) < 0; })) fail('Ukuran aktif harus dipilih dari daftar ukuran.');
      if (!priorSizes && oldPO) fail('PO lama tetap memakai ukuran yang sudah tercatat.');
      if (Object.keys(ukuran).length || total) fail('PO tanpa target pcs hanya memilih ukuran. Jumlah diisi pada hasil potong.');
      ukuran = {}; total = 0;
    }
    if (!po.id && !oldPO && !previewNewPO) fail('PO baru harus dibuat bersama persiapan bahan oleh owner.');
    var pelanggan = teks(po.pelanggan, 80).trim();
    if (jenis === 'pesanan' && !pelanggan) fail('Nama pelanggan wajib diisi untuk pesanan.');
    if (jenis === 'pesanan' && total <= 0 && !activeSizes) fail('Pesanan harus punya jumlah pcs.');
    var status = PO_STATUS.indexOf(po.status) >= 0 ? po.status : 'aktif';
    var rows = store.read('PO'); var rec;
    var common = { jenis: jenis, produkId: produk ? produk.id : '', nama: nama, series: series, pelanggan: pelanggan,
      deadline: tglOk(po.deadline), ukuran: JSON.stringify(ukuran), total: total, bahan: teks(po.bahan, 120),
      catatan: teks(po.catatan, 300), status: status, diubah: nowIso() };
    if (activeSizes) common.ukuranAktif = JSON.stringify(activeSizes.ukuran);
    if (oldPO && oldPO.asal === 'lama') { common.ukuran = oldPO.ukuran; common.total = oldPO.total; }
    if (po.id) {
      rec = findRow('PO', String(po.id)); if (!rec) fail('PO tidak ditemukan.');
      if (status !== 'aktif') ensureNoPendingCutPlan(rec.id);
      var hasProduction = store.read('Potong').concat(store.read('SlipKirim'), store.read('SlipSetor'), store.read('QC')).some(function (r) { return r.poId === rec.id; });
      if (hasProduction && priorSizes && activeSizes && JSON.stringify(priorSizes.ukuran) !== JSON.stringify(activeSizes.ukuran)) fail('Ukuran aktif PO yang sudah berjalan tidak boleh diganti.');
      if (hasProduction && Object.keys(coreMap(rec.ukuran)).sort().join('|') !== Object.keys(ukuran).sort().join('|')) fail('Ukuran PO yang sudah berjalan tidak boleh diganti.');
      if (status === 'selesai') ensureComplete(rec);
      var noPO = teks(po.noPO, 30).trim() || rec.noPO;
      for (var i = 0; i < rows.length; i++) if (rows[i].noPO === noPO && rows[i].id !== rec.id) fail('Nomor PO ' + noPO + ' sudah dipakai.');
      common.noPO = noPO;
      if (status === 'aktif' && rec.status !== 'aktif') common.tuntasPada = '';
      if (status === 'aktif') common.selesaiPada = '';
      else if (rec.status === 'aktif') common.selesaiPada = today();
      store.update('PO', rec.id, common);
      return withGambar(rec);
    }
    var nid = idOk(po.newId);
    var pendingDrafts = store.read('RencanaPotong').filter(function (r) { return r.status === 'siap' && r.poDraft; });
    if (!previewNewPO && nid && !findRow('PO',nid) && pendingDrafts.some(function (r) { return r.poId === nid; })) fail('PO ini masih menyiapkan bahan. Lanjutkan melalui persiapan tersimpan atau batalkan dahulu.');
    if (nid) {
      var ex = findRow('PO', nid);
      if (ex) {
        var same = ex.dibuatOleh === me.id && Object.keys(common).every(function (k) {
          if (k === 'diubah') return true;
          if (k === 'ukuran') {
            var left = coreMap(ex.ukuran), right = coreMap(common.ukuran);
            return Object.keys(left).sort().join('|') === Object.keys(right).sort().join('|') && Object.keys(right).every(function (s) { return coreNum(left[s]) === coreNum(right[s]); });
          }
          return String(ex[k] === undefined ? '' : ex[k]) === String(common[k]);
        });
        var retryNo = teks(po.noPO, 30).trim();
        if (!same || (retryNo && retryNo !== ex.noPO)) fail('PO dengan ID ini sudah tersimpan dengan data berbeda. Buka PO tersebut untuk mengubahnya.');
        return withGambar(ex);
      }
    }
    if (status === 'selesai') fail('PO baru belum mempunyai bukti produksi selesai.');
    var numbering = rows.slice(); pendingDrafts.forEach(function (r) { if (r.poId !== nid) { var draft = coreParseJSON(r.poDraft,{}); if (draft.noPO) numbering.push({noPO:draft.noPO}); } });
    var no = teks(po.noPO, 30).trim() || nextNo('PO', numbering, 'noPO');
    for (var j = 0; j < numbering.length; j++) if (numbering[j].noPO === no) fail('Nomor PO ' + no + ' sudah dipakai atau disiapkan.');
    rec = common; rec.id = nid || env.id(); rec.noPO = no; rec.gambar = '';
    rec.dibuat = nowIso(); rec.dibuatOleh = me.id; rec.selesaiPada = status === 'aktif' ? '' : today();
    if (previewNewPO) return copy(rec);
    store.append('PO', rec);
    return withGambar(rec);
  };

  actions.setStatusPO = function (p) {
    var me = auth(p); mustAdmin(me);
    if (PO_STATUS.indexOf(p.status) < 0) fail('Status tidak dikenal.');
    var rec = findRow('PO', String(p.id || '')); if (!rec) fail('PO tidak ditemukan.');
    if (p.status !== 'aktif') ensureNoPendingCutPlan(rec.id);
    if (p.status === 'selesai') ensureComplete(rec);
    var patch = { status: p.status, diubah: nowIso(), selesaiPada: p.status === 'aktif' ? '' : (rec.status !== 'aktif' && rec.selesaiPada ? rec.selesaiPada : today()) };
    if (p.status === 'aktif' && rec.status !== 'aktif') patch.tuntasPada = '';
    store.update('PO', rec.id, patch);
    return findRow('PO', rec.id);
  };

  /* Ukuran aktif yang belum dipotong boleh dilepas dari PO ("tidak jadi dipotong di PO ini"): PO tidak lagi menunggu
     tukang potong untuk ukuran itu dan bisa selesai begitu ukuran lainnya beres. Tidak ada baris yang diubah atau
     dihapus; daftarnya disimpan di pengaturan poUkuranLepas. lepas:false mengaktifkannya lagi. */
  actions.lepasUkuranPotong = function (p) {
    var me = auth(p); mustAdmin(me);
    ['PO','Potong','RencanaPotong'].forEach(function (sheet) { if (store.fresh) store.fresh(sheet); });
    var po = findRow('PO', String(p.poId || '')); if (!po) fail('PO tidak ditemukan.');
    var st = settings(), peta = {}, minta = p.ukuran instanceof Array ? p.ukuran.map(function (s) { return String(s); }) : [];
    Object.keys(st.poUkuranLepas).forEach(function (k) { if (st.poUkuranLepas[k] instanceof Array && st.poUkuranLepas[k].length) peta[k] = st.poUkuranLepas[k].slice(); });
    var kini = peta[po.id] || [];
    if (p.lepas === false) kini = minta.length ? kini.filter(function (s) { return minta.indexOf(s) < 0; }) : [];
    else {
      if (po.status !== 'aktif') fail('Hanya PO aktif yang ukurannya bisa dilepas.');
      ensureNoPendingCutPlan(po.id);
      var flow = workflow()[po.id], tunggu = (flow && flow.cutting && flow.cutting.pendingUkuran) || [];
      if (!minta.length) minta = tunggu.slice();
      if (!minta.length) fail('Tidak ada ukuran yang menunggu dipotong di PO ini.');
      minta.forEach(function (s) { if (tunggu.indexOf(s) < 0) fail('Ukuran ' + s + ' tidak sedang menunggu dipotong.'); if (kini.indexOf(s) < 0) kini.push(s); });
    }
    if (kini.length) peta[po.id] = kini; else delete peta[po.id];
    if (JSON.stringify(peta).length > 45000) fail('Daftar ukuran yang dilepas sudah terlalu panjang.');
    st.poUkuranLepas = peta; store.setSettings(st);
    return { ok: true, ukuran: kini };
  };
  function ensureNoPendingCutPlan(poId) {
    if (typeof coreCutPlanRows !== 'function') return;
    ['RencanaPotong','Potong'].forEach(function (sheet) { if (store.fresh) store.fresh(sheet); });
    if (coreCutPlanRows(store.read('RencanaPotong'), store.read('Potong')).some(function (r) { return r.poId === poId && r.status === 'siap'; })) fail('Masih ada bahan potong yang disiapkan. Owner harus membatalkan persiapan atau menyelesaikan hasil potong terlebih dahulu.');
  }
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

  function preparedMaterials(input, id, knownInventory) {
    var inventory = knownInventory || coreRollInventory(store.read('Potong'), store.read('StokBahan'), settings(), store.read('RencanaPotong'), id);
    if (input.alokasiBahan !== undefined && coreParseJSON(input.alokasiBahan, []).length) {
      if (input.bahanList && input.bahanList.length) fail('Tambahan saldo lama harus diisi melalui daftar saldo lama terpisah.');
      var selected = coreRollSelection(coreParseJSON(input.alokasiBahan, []), inventory);
      var legacy = input.legacyBahanList && input.legacyBahanList.length ? coreCutPlanMaterials(input.legacyBahanList,inventory.legacy) : [];
      coreCutCheckAvailable(legacy,inventory.legacy);
      var extraRolls = coreCutPlanNumber(input.legacyRol === undefined ? 0 : input.legacyRol);
      if (!isFinite(extraRolls) || extraRolls < 0 || extraRolls !== Math.floor(extraRolls) || extraRolls > 1000000 || !legacy.length && extraRolls) fail('Jumlah rol saldo lama harus bilangan bulat dan mempunyai bahan saldo lama.');
      var combined = {}, order = [];
      selected.bahanList.concat(legacy).forEach(function (b) { var k = coreNormBahan(b.nama); if (!combined[k]) { order.push(k); combined[k] = {nama:b.nama,qty:0,satuan:b.satuan}; } if (combined[k].satuan !== b.satuan) fail('Satuan bahan harus sama.'); combined[k].qty += b.qty; });
      if (order.length > 20) fail('Satu persiapan maksimal 20 jenis bahan.');
      selected.bahanList = order.map(function (k) { combined[k].qty = Math.round(combined[k].qty*1000)/1000; return combined[k]; });
      coreCutCheckAvailable(selected.bahanList,inventory.materials);
      selected.legacyBahanList = legacy; selected.rol += extraRolls;
      return selected;
    }
    var list = coreCutPlanMaterials(input.bahanList, inventory.legacy);
    coreCutCheckAvailable(list, inventory.legacy);
    var rol = coreCutPlanNumber(input.rol === undefined ? 0 : input.rol);
    if (!isFinite(rol) || rol < 0 || rol !== Math.floor(rol) || rol > 1000000) fail('Jumlah rol harus bilangan bulat nol atau lebih.');
    return {bahanList:list,rol:rol,alokasiBahan:[],legacyBahanList:list};
  }
  function preparedResult(row) { return coreCutPlanRows([row], store.read('Potong'), store.read('PO'))[0]; }
  function prepareRow(input, id, poId, status, previous) {
    var materials = previous && status === 'batal' ? {bahanList:coreParseJSON(previous.bahanList,[]),rol:coreNum(previous.rol),alokasiBahan:coreParseJSON(previous.alokasiBahan,[]),legacyBahanList:coreParseJSON(previous.legacyBahanList,coreParseJSON(previous.alokasiBahan,[]).length ? [] : coreParseJSON(previous.bahanList,[]))} : preparedMaterials(input,id);
    var note = previous && status === 'batal' ? previous.catatan : String(input.catatan || '').trim();
    if (note.length > 300) fail('Catatan persiapan maksimal 300 karakter.');
    return {id:id,poId:poId,bahanList:JSON.stringify(materials.bahanList),alokasiBahan:materials.alokasiBahan.length ? JSON.stringify(materials.alokasiBahan) : '',legacyBahanList:materials.legacyBahanList.length ? JSON.stringify(materials.legacyBahanList) : '',rol:materials.rol,catatan:note,status:status,diubah:nowIso(),revision:env.id()};
  }
  actions.saveRencanaPotong = function (p) {
    if (store.fresh) store.fresh('Pegawai');
    var me = auth(p); if (me.divisi !== 'owner') fail('Hanya owner yang boleh menyiapkan bahan potong.');
    if (typeof coreCutPlanMaterials !== 'function') fail('Paket persiapan potong belum lengkap. Muat ulang aplikasi.');
    ['RencanaPotong','Potong','StokBahan','PO'].forEach(function (sheet) { if (store.fresh) store.fresh(sheet); });
    var input = p.rencana || {}, id = idOk(input.id); if (!id) fail('Identitas persiapan potong tidak valid. Buka kembali formulir.');
    var old = findRow('RencanaPotong', id), consumed = store.read('Potong').some(function (r) { return r.rencanaId === id; });
    var status = input.status === undefined ? 'siap' : String(input.status); if (['siap','batal'].indexOf(status) < 0) fail('Status persiapan tidak valid.');
    var canceled = old && status === 'batal';
    if (consumed) fail('Persiapan ini sudah dipakai. Buat persiapan baru untuk potongan berikutnya.');
    if (old && old.status === 'batal' && status === 'siap') fail('Persiapan yang dibatalkan tidak dapat dibuka kembali. Buat persiapan baru.');
    var poId = String(canceled ? old.poId : input.poId || '');
    if (old && old.poDraft && status !== 'batal' && !findRow('PO',old.poId)) fail('Selesaikan pembuatan PO yang sedang menyiapkan melalui formulir PO atau batalkan persiapan.');
    var next = prepareRow(input,id,poId,status,old);
    if (old && coreCutPlanIntent(old) === coreCutPlanIntent(next) && (String(p.expectedRevision || '') === String(old.revision || '') || old.dibuatOleh === me.id)) return preparedResult(old);
    if (old && String(p.expectedRevision || '') !== String(old.revision || '')) fail('Persiapan berubah sejak formulir dibuka. Muat ulang sebelum menyimpan.');
    if (!old && status !== 'siap') fail('Persiapan baru harus berstatus siap.');
    if (status === 'siap') { var po = openPO(poId); poClean(po); }
    if (old) store.update('RencanaPotong', id, next);
    else { next.dibuat = nowIso(); next.dibuatOleh = me.id; if (store.validateRows) store.validateRows('RencanaPotong',[next]); store.append('RencanaPotong', next); }
    return preparedResult(findRow('RencanaPotong', id));
  };
  /* The reservation is durable before the PO. An interrupted append is shown
     as menyiapkan; a retry fills only missing evidence using the same intent. */
  actions.savePOWithRencana = function (p) {
    ['Pegawai','PO','RencanaPotong','Potong','StokBahan'].forEach(function (sheet) { if (store.fresh) store.fresh(sheet); });
    var me = auth(p); if (me.divisi !== 'owner') fail('Hanya owner yang boleh membuat PO dengan persiapan bahan.');
    var poInput = copy(p.po || {}), input = p.rencana || {}, id = idOk(input.id), poId = idOk(poInput.newId);
    if (!id || !poId || poInput.id) fail('Identitas PO dan persiapan wajib tetap sama saat menyimpan ulang.');
    if (input.poId && input.poId !== poId) fail('Persiapan berasal dari PO lain.');
    if (poInput.status && poInput.status !== 'aktif') fail('PO baru dengan persiapan harus aktif.');
    var old = findRow('RencanaPotong',id), existingPO = findRow('PO',poId);
    var frozen = old && coreParseJSON(old.poDraft,null);
    if (old && (!frozen || old.poId !== poId || old.dibuatOleh !== me.id || old.status !== 'siap')) fail('Persiapan ini sudah tercatat dengan tujuan berbeda atau dibatalkan.');
    if (!old && existingPO) fail('PO ini sudah tersimpan. Siapkan bahan melalui detail PO.');
    if (frozen && !poInput.noPO) poInput.noPO = frozen.noPO;
    var prospective;
    try { previewNewPO = true; legacyPendingPO = !!(frozen && !frozen.ukuranAktif); prospective = actions.savePO(Object.assign({},p,{po:poInput})); }
    finally { previewNewPO = false; legacyPendingPO = false; }
    var draft = {newId:prospective.id};
    ['noPO','jenis','produkId','nama','series','pelanggan','deadline','total','bahan','catatan','status'].forEach(function (k) { draft[k] = prospective[k] === undefined ? '' : prospective[k]; });
    draft.ukuran = coreMap(prospective.ukuran);
    if (prospective.ukuranAktif) draft.ukuranAktif = coreParseJSON(prospective.ukuranAktif,[]);
    if (old && JSON.stringify(frozen) !== JSON.stringify(draft)) fail('PO ini sudah disiapkan dengan isi berbeda. Lanjutkan data awal atau batalkan persiapan.');
    /* Compare frozen material intent even on an already-consumed retry. */
    if (old) {
      var suppliedAlloc = coreParseJSON(input.alokasiBahan,[]), savedAlloc = coreParseJSON(old.alokasiBahan,[]);
      var suppliedList = input.bahanList || [], savedList = coreParseJSON(old.bahanList,[]);
      var suppliedLegacy = input.legacyBahanList || [], savedLegacy = coreParseJSON(old.legacyBahanList,[]);
      if (String(input.catatan || '').trim() !== String(old.catatan || '') || JSON.stringify(suppliedAlloc) !== JSON.stringify(savedAlloc) ||
        (savedAlloc.length && (coreNum(input.legacyRol) !== coreNum(old.rol)-savedAlloc.length || suppliedLegacy.length !== savedLegacy.length || suppliedLegacy.some(function (b,i) { return coreNormBahan(b.nama) !== coreNormBahan(savedLegacy[i].nama) || coreNum(b.qty) !== coreNum(savedLegacy[i].qty); }))) ||
        (!savedAlloc.length && (coreNum(input.rol) !== coreNum(old.rol) || suppliedList.length !== savedList.length || suppliedList.some(function (b,i) { return coreNormBahan(b.nama) !== coreNormBahan(savedList[i].nama) || coreNum(b.qty) !== coreNum(savedList[i].qty); })))) fail('Persiapan ini sudah tercatat dengan bahan berbeda.');
    }
    var plan = old || prepareRow(input,id,poId,'siap',null);
    if (!old) { plan.poDraft = JSON.stringify(draft); plan.dibuat = nowIso(); plan.dibuatOleh = me.id; }
    if (store.validateRows) { store.validateRows('PO',[prospective]); store.validateRows('RencanaPotong',[plan]); }
    if (!old) store.append('RencanaPotong',plan);
    if (!existingPO) store.append('PO',prospective);
    if (Object.prototype.hasOwnProperty.call(p,'gambarData')) putGambar(poId,'po',checkedGambarData(p.gambarData));
    return {po:findRow('PO',poId),rencana:preparedResult(findRow('RencanaPotong',id)),pending:false};
  };
  actions.createPotong = function (p) {
    if (store.fresh) store.fresh('Pegawai');
    var me = auth(p); var admin = coreIsAdmin(me);
    if (!admin && me.divisi !== 'potong') fail('Hanya tukang potong atau admin.');
    var r = p.potong || {}; var d = dedupe('Potong', r);
    var direct = !r.rencanaId && r.rencana && typeof r.rencana === 'object' ? r.rencana : null;
    if (d.ada) { if (!admin && d.ada.userId !== me.id) fail('Bukan catatan potong Anda.'); if (d.ada.rencanaId && String(r.rencanaId || (direct && direct.id) || '') !== d.ada.rencanaId) fail('Catatan potong ini berasal dari persiapan lain.'); return d.ada; }
    var plan = null, planBaru = false;
    if (!admin && !r.rencanaId) fail('Pilih pekerjaan dengan bahan yang sudah disiapkan owner.');
    if (r.rencanaId) {
      if (typeof coreCutAvailability !== 'function') fail('Paket persiapan potong belum lengkap. Muat ulang aplikasi.');
      ['RencanaPotong','StokBahan','PO'].forEach(function (sheet) { if (store.fresh) store.fresh(sheet); });
      plan = findRow('RencanaPotong', String(r.rencanaId));
      if (!plan || plan.status !== 'siap') fail('Persiapan potong tidak tersedia.');
      if (store.read('Potong').some(function (row) { return row.rencanaId === plan.id; })) fail('Persiapan ini sudah dipakai. Muat ulang daftar pekerjaan.');
      if (!plan.revision || String(r.expectedRencanaRevision || p.expectedRencanaRevision || '') !== String(plan.revision)) fail('Persiapan berubah sejak formulir dibuka. Muat ulang pekerjaan sebelum menyimpan hasil.');
      if (r.poId && r.poId !== plan.poId) fail('Persiapan potong berasal dari PO lain.');
      if (!admin && ['bahan','bahanList','kg','rol','alokasiBahan','legacyBahanList','legacyRol'].some(function (key) { return r[key] !== undefined && r[key] !== ''; })) fail('Bahan, kilogram, dan rol ditentukan owner dalam persiapan. Isi hasil potong saja.');
    }
    if (!plan && coreParseJSON(r.alokasiBahan,[]).length) fail('Pilih rol melalui persiapan owner sebelum mencatat hasil potong.');
    /* Owner mencatat hasil potong dan memilih rol dari stok di formulir yang sama: persiapannya ditulis
       bersama hasil potong ini dan langsung terpakai. Kiriman ulang menemukan keduanya lewat id yang sama. */
    if (direct) {
      if (me.divisi !== 'owner') fail('Hanya owner yang boleh memilih rol dari stok saat mencatat hasil potong.');
      if (typeof coreCutPlanMaterials !== 'function') fail('Paket persiapan potong belum lengkap. Muat ulang aplikasi.');
      ['RencanaPotong','Potong','StokBahan','PO'].forEach(function (sheet) { if (store.fresh) store.fresh(sheet); });
      var planId = idOk(direct.id); if (!planId) fail('Identitas bahan potong tidak valid. Buka kembali formulir.');
      var planLama = findRow('RencanaPotong', planId);
      if (planLama && store.read('Potong').some(function (row) { return row.rencanaId === planId; })) fail('Bahan potong ini sudah tercatat dengan isi berbeda. Tutup formulir lalu periksa data terbaru.');
      plan = prepareRow({ alokasiBahan: direct.alokasiBahan, legacyBahanList: direct.legacyBahanList, legacyRol: direct.legacyRol, bahanList: direct.bahanList, rol: direct.rol, catatan: '' }, planId, String(r.poId || ''), 'siap', null);
      if (planLama) {
        if (planLama.status !== 'siap' || planLama.dibuatOleh !== me.id || planLama.poDraft || coreCutPlanIntent(planLama) !== coreCutPlanIntent(plan)) fail('Bahan potong ini sudah tercatat dengan isi berbeda. Tutup formulir lalu periksa data terbaru.');
        plan = planLama;
      } else { plan.dibuat = nowIso(); plan.dibuatOleh = me.id; planBaru = true; }
    }
    var po = openPO(plan ? plan.poId : r.poId);
    var flow = poClean(po);
    var ukuran = strictSizes(r.ukuran, po, false);
    var legacyScope = plan ? coreLegacyCutPlanScope(po, plan.id, flow && flow.cutting) : null;
    if (legacyScope && legacyScope.blocked) fail(legacyScope.blocked);
    if (legacyScope && (Object.keys(ukuran).length !== 1 || !ukuran[legacyScope.ukuran[0]])) fail('Hasil potong harus sesuai ukuran pada jatah bahan lama: ' + legacyScope.ukuran.join(', ') + '.');
    var total = coreSumSizes(ukuran);
    store.read('QC').forEach(function (q) { if (q.poId !== po.id) return; var maps = coreQcMaps(q, findRow('SlipSetor', q.setorId), []); var all = sumMaps([maps.ok, maps.offline, maps.perbaikan, maps.reject]); Object.keys(ukuran).forEach(function (s) { if (all[s]) fail('Ukuran ' + s + ' sudah di-QC. Selesaikan siklus ini lalu buat PO baru untuk potongan tambahan.'); }); });
    if (total <= 0) fail('Isi jumlah pcs hasil potong.');
    var userId = me.id;
    if (admin) { var tp = findUser(String(r.userId || '')); if (r.userId && (!tp || tp.divisi !== 'potong')) fail('Pilih tukang potong yang terdaftar.'); userId = tp ? tp.id : ''; }
    var st = settings();
    /* bahan yang dipakai: boleh lebih dari satu jenis. Inilah yang mengurangi stok bahan. */
    var bahanList = plan ? coreParseJSON(plan.bahanList, []).map(function (b) { return {nama:b.nama,qty:coreNum(b.qty)}; }) : bersihBahan(r.bahanList);
    var bahan = teks(r.bahan || (bahanList[0] || {}).nama || po.bahan, 120); var kg = Math.max(0, coreNum(r.kg));
    if (bahanList.length) { bahan = bahanList.map(function (b) { return b.nama; }).join(', ').slice(0, 120); kg = 0; bahanList.forEach(function (b) { kg += b.qty; }); kg = Math.round(kg * 1000) / 1000; }
    var rec = { id: d.id, poId: po.id, userId: userId, tanggal: tglOk(r.tanggal) || today(), ukuran: JSON.stringify(ukuran), total: total,
      bahan: bahan, kg: kg, rol: plan ? coreNum(plan.rol) : Math.max(0, coreNum(r.rol)),
      tarif: (admin && r.tarif !== undefined && r.tarif !== '') ? Math.max(0, coreNum(r.tarif)) : tarifProduk(po, 'tarifPotong', st.upahPotong),
      upahId: '', catatan: teks(r.catatan, 300), dibuat: nowIso(), bahanList: bahanList.length ? JSON.stringify(bahanList) : '', asal: '', rencanaId: plan ? plan.id : '', alokasiBahan:plan ? plan.alokasiBahan || '' : '' };
    if (plan && st.stokMulai && rec.tanggal < st.stokMulai) fail('Tanggal hasil potong harus berada setelah tanggal awal pencatatan stok.');
    if (typeof coreCutAvailability === 'function') {
      if (!plan) ['RencanaPotong','StokBahan'].forEach(function (sheet) { if (store.fresh) store.fresh(sheet); });
      var plans = store.read('RencanaPotong');
      var inventory = coreRollInventory(store.read('Potong'), store.read('StokBahan'), st, plans, plan ? plan.id : '');
      if (plan && coreParseJSON(plan.alokasiBahan,[]).length) {
        var planAllocations = coreParseJSON(plan.alokasiBahan,[]);
        var selected = preparedMaterials({alokasiBahan:planAllocations,legacyBahanList:coreParseJSON(plan.legacyBahanList,[]),legacyRol:coreNum(plan.rol)-planAllocations.length},plan.id,inventory), frozenMaterials = coreParseJSON(plan.bahanList,[]);
        if (selected.bahanList.length !== frozenMaterials.length || selected.bahanList.some(function (b,i) { var old = frozenMaterials[i]; return coreNormBahan(b.nama) !== coreNormBahan(old.nama) || b.satuan !== old.satuan || b.qty !== coreNum(old.qty); })) fail('Sumber rol berubah sejak persiapan dibuat. Periksa bahan dengan owner.');
      } else if (plan || inventory.rolls.length || coreCutPlanRows(plans, store.read('Potong')).some(function (r) { return r.status === 'siap'; })) {
        if (plan) coreCutPlanMaterials(coreParseJSON(plan.bahanList,[]),inventory.legacy);
        coreCutCheckAvailable(coreBahanPotong(rec),inventory.legacy);
      }
    }
    if (planBaru) { if (store.validateRows) store.validateRows('RencanaPotong',[plan]); store.append('RencanaPotong', plan); }
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
  var invoiceStockLookup = null;
  function namaBahanBaku(nama) {
    /* pakai ejaan yang sudah ada kalau bahan ini pernah dicatat, supaya tidak muncul dua kartu untuk bahan yang sama */
    var k = coreNormBahan(nama); var ada = '';
    if (invoiceStockLookup) return invoiceStockLookup.names[k] || nama;
    store.read('StokBahan').forEach(function (r) { if (!ada && coreNormBahan(r.bahan) === k) ada = r.bahan; });
    return ada || nama;
  }
  function satuanBahan(nama) {
    var k = coreNormBahan(nama); var s = '', tgl = '';
    if (invoiceStockLookup) return invoiceStockLookup.units[k] || '';
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
    ['StokBahan','RencanaPotong','Potong'].forEach(function (sheet) { if (store.fresh) store.fresh(sheet); });
    var r = p.stok || {};
    if (r.sourceStockId) fail('Koreksi rol harus melalui hitung fisik rol, bukan edit catatan stok.');
    if (r.id && findRow('StokBahan', String(r.id)) && !r.baru) {
      var lama = findRow('StokBahan', String(r.id));
      if (lama.jenis === 'rinci') fail('Rincian rol tidak dapat diubah. Hapus rincian yang belum dipakai, lalu rinci ulang.');
      if (lama.sourceStockId) fail('Bukti koreksi rol tidak dapat diubah. Catat hitung fisik baru untuk rol tersebut.');
      ensureRollSourceUnused(lama.id);
      var changes = isiStok(r, lama);
      if (changes.jenis === 'koreksi') ensureAggregateCorrection(changes,lama);
      else if (lama.stockMode !== 'roll') ensureAggregatePurchase(changes,lama);
      if (lama.stockMode === 'roll') {
        if (r.stockMode && r.stockMode !== 'roll' || changes.satuan !== 'kg') fail('Identitas rol dan satuannya tidak dapat diganti.');
        var weight = coreBahanInvoiceNumber(r.qty); if (!isFinite(weight) || weight <= 0 || weight > 1e8 || Math.abs(weight*1000-Math.round(weight*1000)) > 0.000001) fail('Berat rol harus lebih dari nol, maksimal 3 angka desimal.');
        changes.stockMode = 'roll'; changes.rol = 1; changes.rollLabel = r.rollLabel === undefined ? lama.rollLabel : String(r.rollLabel).trim();
        if (!changes.rollLabel || changes.rollLabel.length > 60) fail('Label rol maksimal 60 karakter.');
      } else if (r.stockMode) fail('Gunakan pembelian invoice untuk mencatat identitas rol baru.');
      store.update('StokBahan', lama.id, changes);
      return findRow('StokBahan', lama.id);
    }
    if (r.stockMode) fail('Gunakan pembelian invoice untuk mencatat identitas rol baru.');
    var d = dedupe('StokBahan', r); if (d.ada) return d.ada;
    var rec = isiStok(r, null); rec.id = d.id; rec.dibuatOleh = me.id; rec.dibuat = nowIso(); rec.asal = '';
    if (rec.jenis === 'koreksi') ensureAggregateCorrection(rec,null);
    store.append('StokBahan', rec);
    if (rec.jenis === 'beli' || rec.qty > 0) tampilkanBahan([rec.bahan]);
    return rec;
  };
  actions.saveInvoiceBahan = function (p) {
    var me = auth(p); mustAdmin(me);
    var inv = p.invoice || {}, items = coreFlattenInvoiceRolls(inv.items);
    if (!idOk(inv.id) || String(inv.id).length > 42) fail('Identitas invoice tidak sah. Buka kembali form pembelian.');
    if (items.some(function (r) { return r.stockMode === 'roll'; }) && String(inv.id).length > 40) fail('Identitas invoice rol maksimal 40 karakter.');
    if (!String(inv.invoice || '').trim() || String(inv.invoice).length > 60) fail('Isi nomor invoice / bon, paling banyak 60 karakter.');
    var invoiceDate = new Date(String(inv.tanggal || '') + 'T00:00:00Z');
    if (!coreTglOk(inv.tanggal) || isNaN(invoiceDate.getTime()) || invoiceDate.toISOString().slice(0, 10) !== inv.tanggal) fail('Isi tanggal invoice yang sah.');
    if (store.checkpoint) store.checkpoint(['StokBahan']);
    var created = nowIso();
    invoiceStockLookup = {names:{},units:{},dates:{}};
    store.read('StokBahan').forEach(function (r) { var k = coreNormBahan(r.bahan); if (!invoiceStockLookup.names[k]) invoiceStockLookup.names[k] = r.bahan; if (r.jenis === 'beli' && r.satuan && String(r.tanggal || '') >= String(invoiceStockLookup.dates[k] || '')) { invoiceStockLookup.units[k] = r.satuan; invoiceStockLookup.dates[k] = r.tanggal || ''; } });
    var rows;
    try { rows = items.map(function (item, index) {
      if (!item || !String(item.bahan || '').trim() || String(item.bahan).length > 80) fail('Isi nama bahan pada baris ' + (index + 1) + ', paling banyak 80 karakter.');
      var qty = coreBahanInvoiceNumber(item.qty), price = coreBahanInvoiceNumber(item.harga), rolls = coreBahanInvoiceNumber(item.rol);
      if (!isFinite(qty) || Math.round(qty * 1000) <= 0 || qty > 100000000) fail('Jumlah bahan pada baris ' + (index + 1) + ' harus lebih dari nol.');
      if (qty !== Math.round(qty * 1000) / 1000) fail('Jumlah bahan pada baris ' + (index + 1) + ' paling banyak 3 angka desimal.');
      if (!isFinite(price) || price < 0 || price > 1000000000000 || item.harga === '' || item.harga == null) fail('Isi harga per satuan yang sah pada baris ' + (index + 1) + '.');
      if (!isFinite(rolls) || rolls < 0 || rolls !== Math.floor(rolls) || rolls > 1000000) fail('Jumlah rol harus bilangan bulat nol atau lebih pada baris ' + (index + 1) + '.');
      if (SATUAN_BAHAN.indexOf(item.satuan) < 0) fail('Satuan bahan tidak sah pada baris ' + (index + 1) + '.');
      var row = isiStok({ jenis: 'beli', tanggal: inv.tanggal, bahan: item.bahan, qty: qty, satuan: item.satuan, rol: rolls, harga: price,
        supplier: inv.supplier, invoice: inv.invoice, sumber: inv.sumber, catatan: inv.catatan }, null);
      if (!Number.isSafeInteger(row.total)) fail('Total harga pada baris ' + (index + 1) + ' terlalu besar.');
      row.dibuatOleh = me.id; row.dibuat = created; row.asal = '';
      if (item.stockMode === 'roll') { row.stockMode = 'roll'; row.rollLabel = item.rollLabel; }
      return row;
    }); } finally { invoiceStockLookup = null; }
    var plan = coreBahanInvoicePlan(inv.id, rows, store.read('StokBahan'));
    var total = plan.rows.reduce(function (sum, r) { return sum + Number(r.total); }, 0);
    if (!Number.isSafeInteger(total)) fail('Total invoice terlalu besar.');
    if (store.validateRows) store.validateRows('StokBahan', plan.pending);
    if (plan.pending.length) { store.appendMany('StokBahan', plan.pending); tampilkanBahan(plan.pending.map(function (r) { return r.bahan; })); }
    return { invoiceId: inv.id, rows: plan.rows, total: total };
  };
  /* Merinci stok yang sudah ada menjadi rol. Stok lama hanya mencatat total kg; di sini owner mengisi berat tiap rol
     yang ada di gudang. Total stok, pembelian, dan nilai bahan tidak berubah: yang dirinci hanya berpindah dari
     "saldo lama" ke rol bernama, sehingga bisa dipilih per rol di PO dan Catat potong. */
  actions.rinciStokRol = function (p) {
    ['Pegawai','StokBahan','Potong','RencanaPotong'].forEach(function (name) { if (store.fresh) store.fresh(name); });
    var me = auth(p); if (me.divisi !== 'owner') fail('Hanya owner yang boleh merinci rol stok.');
    if (typeof coreCutAvailability !== 'function') fail('Paket persiapan potong belum lengkap. Muat ulang aplikasi.');
    var id = idOk(p.id); if (!id || id.length > 40) fail('Identitas rincian rol tidak sah. Buka kembali formulir.');
    var input = p.rolls instanceof Array ? p.rolls : []; if (!input.length || input.length > 100) fail('Isi 1 sampai 100 rol.');
    var weights = input.map(function (r, i) {
      var q = coreBahanInvoiceNumber(r && r.qty);
      if (!isFinite(q) || q <= 0 || q > 1e8 || Math.abs(q * 1000 - Math.round(q * 1000)) > 0.000001) fail('Berat rol ' + (i + 1) + ' harus lebih dari nol, maksimal 3 angka desimal.');
      return Math.round(q * 1000) / 1000;
    });
    var total = Math.round(weights.reduce(function (n, q) { return n + q; }, 0) * 1000) / 1000, key = coreNormBahan(p.bahan), note = teks(p.catatan, 300);
    var semua = store.read('StokBahan'), sudah = semua.filter(function (r) { return r.invoiceId === id; });
    if (sudah.length) {
      var sama = sudah.length === weights.length && sudah.every(function (r, i) { return r.jenis === 'rinci' && r.dibuatOleh === me.id && coreNormBahan(r.bahan) === key && coreNum(r.qty) === weights[i]; });
      if (!sama) fail('Identitas rincian ini sudah dipakai dengan isi berbeda.');
      return { rows: sudah, total: total };
    }
    var inventory = coreRollInventory(store.read('Potong'), semua, settings(), store.read('RencanaPotong')), pool = inventory.legacyMap[key];
    if (!pool || pool.sembunyi) fail('Bahan ini belum ada di daftar stok aktif.');
    if (pool.satuan !== 'kg') fail('Rincian rol hanya untuk bahan yang dicatat dalam kg.');
    if (total > pool.tersedia + 0.000001) fail('Jumlah berat rol (' + total + ' kg) melebihi stok yang belum dirinci dan belum dicadangkan (' + pool.tersedia + ' kg). Periksa lagi beratnya, atau cocokkan fisik dahulu.');
    var urut = semua.filter(function (r) { return r.stockMode === 'roll' && coreNormBahan(r.bahan) === key; }).length, hari = today(), dibuat = nowIso();
    var rows = weights.map(function (q, i) {
      return { id: id + '-r' + (i + 1), jenis: 'rinci', tanggal: hari, bahan: pool.nama, qty: q, satuan: 'kg', rol: 1, harga: 0, total: 0, supplier: '', invoice: 'Rincian stok ' + hari.split('-').reverse().join('/'),
        sumber: '', alasan: '', catatan: note, dibuatOleh: me.id, dibuat: dibuat, asal: '', invoiceId: id, stockMode: 'roll', rollLabel: 'Rol ' + (urut + i + 1) };
    });
    if (store.validateRows) store.validateRows('StokBahan', rows);
    store.appendMany('StokBahan', rows);
    return { rows: rows, total: total };
  };
  /* Salah ketik berat saat merinci: berat rol rincian boleh dibetulkan selama rol itu belum dipakai, dicadangkan,
     atau dikoreksi. Selisihnya kembali ke, atau diambil dari, stok yang belum dirinci; total stok tetap. */
  actions.ubahRinciRol = function (p) {
    ['Pegawai','StokBahan','Potong','RencanaPotong'].forEach(function (name) { if (store.fresh) store.fresh(name); });
    var me = auth(p); if (me.divisi !== 'owner') fail('Hanya owner yang boleh mengubah rincian rol.');
    var id = idOk(p.id), row = id ? findRow('StokBahan', id) : null;
    if (!row || row.jenis !== 'rinci' || row.stockMode !== 'roll') fail('Rincian rol tidak ditemukan. Muat data terbaru.');
    var q = coreBahanInvoiceNumber(p.qty);
    if (!isFinite(q) || q <= 0 || q > 1e8 || Math.abs(q * 1000 - Math.round(q * 1000)) > 0.000001) fail('Berat rol harus lebih dari nol, maksimal 3 angka desimal.');
    q = Math.round(q * 1000) / 1000;
    if (coreNum(row.qty) === q) return row;
    if (p.expectedQty !== undefined && p.expectedQty !== '' && coreNum(p.expectedQty) !== coreNum(row.qty)) fail('Berat rol ini sudah berubah sejak formulir dibuka. Muat data terbaru.');
    ensureRollSourceUnused(id);
    var pool = coreRollInventory(store.read('Potong'), store.read('StokBahan'), settings(), store.read('RencanaPotong')).legacyMap[coreNormBahan(row.bahan)];
    var longgar = pool ? coreNum(pool.tersedia) : 0;
    if (q - coreNum(row.qty) > longgar + 0.000001) fail('Berat baru melebihi stok yang belum dirinci. Paling banyak ' + (Math.round((coreNum(row.qty) + Math.max(0, longgar)) * 1000) / 1000) + ' kg untuk rol ini.');
    store.update('StokBahan', id, { qty: q });
    return findRow('StokBahan', id);
  };
  function ensureRollSourceUnused(id) {
    var used = {}, reserved = false;
    store.read('Potong').forEach(function (r) { if (r.rencanaId) used[r.rencanaId] = true; if (coreParseJSON(r.alokasiBahan,[]).some(function (a) { return a.stokId === id; })) reserved = true; });
    store.read('RencanaPotong').forEach(function (r) { if (r.status === 'siap' && !used[r.id] && coreParseJSON(r.alokasiBahan,[]).some(function (a) { return a.stokId === id; })) reserved = true; });
    if (store.read('StokBahan').some(function (r) { return r.sourceStockId === id; })) reserved = true;
    if (reserved) fail('Rol ini sudah dipakai, dicadangkan, atau memiliki riwayat koreksi. Bukti pembeliannya tidak dapat diubah atau dihapus.');
  }
  function ensureAggregateCorrection(next,previous,knownInventory) {
    if (typeof coreCutAvailability !== 'function') return;
    var inventory = knownInventory || coreRollInventory(store.read('Potong'),store.read('StokBahan'),settings(),store.read('RencanaPotong'));
    var delta = {}, name = coreNormBahan(next.bahan); delta[name] = coreNum(next.qty);
    if (previous) { var oldName = coreNormBahan(previous.bahan); delta[oldName] = coreNum(delta[oldName])-coreNum(previous.qty); }
    Object.keys(delta).forEach(function (key) { var pool=inventory.legacyMap[key], available=pool ? pool.tersedia : 0; if (available+delta[key] < -0.000001) fail('Koreksi jumlah bahan akan mengurangi rol tercatat atau cadangan saldo lama. Pilih hitung fisik pada rol yang bersangkutan, atau batalkan cadangan saldo lama terlebih dahulu.'); });
  }
  function ensureAggregatePurchase(next,previous) {
    if (typeof coreCutAvailability !== 'function') return;
    var oldName=coreNormBahan(previous.bahan), name=coreNormBahan(next.bahan), delta={};
    delta[oldName]=-coreNum(previous.qty); delta[name]=coreNum(delta[name])+coreNum(next.qty);
    var unitChanged=name === oldName && next.satuan !== previous.satuan;
    if (!unitChanged && !Object.keys(delta).some(function (key) { return delta[key] < -0.000001; })) return;
    var inventory=coreRollInventory(store.read('Potong'),store.read('StokBahan'),settings(),store.read('RencanaPotong'));
    /* Only free aggregate stock may be removed. Identified rolls cannot cover
       an old pool's shortage; unchanged notes or an increase may repair old data. */
    Object.keys(delta).forEach(function (key) { var pool=inventory.legacyMap[key], available=pool ? pool.tersedia : 0; if (delta[key] < -0.000001 && available+delta[key] < -0.000001) fail('Pembelian ini menopang bahan yang sudah dipakai atau dicadangkan. Jumlah saldo lama tidak boleh dikurangi di bawah pemakaian dan cadangannya.'); });
    var oldPool=inventory.legacyMap[oldName];
    if (unitChanged && oldPool && (oldPool.pakai > 0 || oldPool.dicadangkan > 0)) fail('Satuan bahan yang sudah dipakai atau dicadangkan tidak dapat diubah.');
  }
  function ensureAggregateStockReplacement(stock,cuts,afterSettings) {
    if (typeof coreCutAvailability !== 'function') return;
    var st=settings(), plans=store.read('RencanaPotong');
    var before=coreRollInventory(store.read('Potong'),store.read('StokBahan'),st,plans);
    var after=coreRollInventory(cuts,stock,afterSettings || st,plans);
    var reserved={}; before.materials.forEach(function (m) { reserved[m.kunci]=m.dicadangkan; });
    before.legacy.forEach(function (pool) {
      var next=after.legacyMap[pool.kunci], available=next ? next.tersedia : -pool.dicadangkan;
      if (available < -0.000001 && available < pool.tersedia-0.000001) fail('Impor mengurangi saldo lama di bawah bahan yang sudah dipakai atau dicadangkan. Periksa pembelian dan koreksi bahan sebelum impor.');
      if (next && next.satuan !== pool.satuan && (pool.pakai > 0 || reserved[pool.kunci] > 0)) fail('Impor tidak boleh mengganti satuan bahan yang sudah dipakai atau dicadangkan.');
    });
  }
  actions.cocokkanStokRol = function (p) {
    ['Pegawai','StokBahan','Potong','RencanaPotong'].forEach(function (name) { if (store.fresh) store.fresh(name); });
    var me=auth(p); if (me.divisi !== 'owner') fail('Hanya owner yang boleh mencatat hitung fisik rol.');
    var id=idOk(p.id), stokId=idOk(p.stokId), actual=coreBahanInvoiceNumber(p.fisik), expected=coreBahanInvoiceNumber(p.expectedSaldo), prior=String(p.expectedCorrectionId || ''), sourceProof=String(p.expectedSourceRevision || ''), note=String(p.catatan || '').trim();
    if (!id || !stokId) fail('Identitas hitung fisik rol tidak valid.');
    if (!isFinite(actual) || actual < 0 || actual > 1e8 || Math.abs(actual*1000-Math.round(actual*1000)) > 0.000001 || !isFinite(expected)) fail('Isi sisa fisik rol yang sah, nol atau lebih dan maksimal 3 angka desimal.');
    if (!note || note.length > 300) fail('Isi alasan hitung fisik, maksimal 300 karakter.');
    actual=Math.round(actual*1000)/1000;
    var old=findRow('StokBahan',id);
    if (old) {
      if (old.jenis !== 'koreksi' || old.sourceStockId !== stokId || old.dibuatOleh !== me.id || coreNum(old.saldoAfter) !== actual || coreNum(old.saldoBefore) !== expected || String(old.previousCorrectionId || '') !== prior || String(old.sourceRevision || '') !== sourceProof || String(old.catatan || '') !== note) fail('Identitas hitung fisik ini sudah dipakai dengan data berbeda.');
      return old;
    }
    var inventory=coreRollInventory(store.read('Potong'),store.read('StokBahan'),settings(),store.read('RencanaPotong')), roll=inventory.byId[stokId];
    if (!roll || roll.satuan !== 'kg') fail('Rol sumber tidak ditemukan.');
    if (expected !== roll.saldo || prior !== roll.correctionRevision || !sourceProof || sourceProof !== roll.sourceRevision) fail('Identitas, saldo, atau riwayat rol berubah sejak formulir dibuka. Muat ulang lalu hitung kembali.');
    if (actual+0.000001 < roll.dicadangkan) fail('Sisa fisik tidak boleh di bawah bahan yang dicadangkan. Batalkan atau ubah persiapan terlebih dahulu.');
    var difference=Math.round((actual-roll.saldo)*1000)/1000;
    if (!difference) return {sama:true};
    var rec={id:id,jenis:'koreksi',tanggal:today(),bahan:roll.bahan,qty:difference,satuan:roll.satuan,rol:0,harga:0,total:0,supplier:'',invoice:roll.invoice,sumber:'',alasan:'stok_opname',catatan:note,dibuatOleh:me.id,dibuat:nowIso(),asal:'',sourceStockId:stokId,saldoBefore:roll.saldo,saldoAfter:actual,previousCorrectionId:prior,sourceRevision:sourceProof};
    if (store.validateRows) store.validateRows('StokBahan',[rec]);
    store.append('StokBahan',rec);
    return rec;
  };
  /* "Cocokkan fisik": owner mengisi jumlah hasil hitung gudang, selisihnya dicatat sebagai koreksi */
  actions.cocokkanStok = function (p) {
    var me = auth(p); mustAdmin(me);
    ['StokBahan','Potong','RencanaPotong'].forEach(function (name) { if (store.fresh) store.fresh(name); });
    var d = dedupe('StokBahan', { id: p.id }); if (d.ada) return d.ada;
    var nama = teks(p.bahan, 80).trim(); if (!nama) fail('Nama bahan wajib diisi.');
    var fisik = coreNum(p.fisik); if (p.fisik === '' || p.fisik === undefined || fisik < 0) fail('Isi jumlah hasil hitung fisik.');
    var inventory = typeof coreCutAvailability === 'function' ? coreRollInventory(store.read('Potong'),store.read('StokBahan'),settings(),store.read('RencanaPotong')) : null;
    var ringkas = inventory ? inventory.materials : coreStok(store.read('Potong'), store.read('StokBahan'), settings()); var b = null;
    ringkas.forEach(function (x) { if (x.kunci === coreNormBahan(nama)) b = x; });
    var saldo = b ? b.saldo : 0; var selisih = Math.round((fisik - saldo) * 1000) / 1000;
    if (!selisih) return { sama: true };
    var rec = { id: d.id, jenis: 'koreksi', tanggal: tglOk(p.tanggal) || today(), bahan: b ? b.nama : nama, qty: selisih, satuan: b ? b.satuan : 'kg', rol: 0, harga: 0, total: 0,
      supplier: '', invoice: '', sumber: '', alasan: 'stok_opname', catatan: teks(p.catatan, 300) || ('Hitung fisik ' + fisik + ', catatan ' + saldo), dibuatOleh: me.id, dibuat: nowIso(), asal: '' };
    ensureAggregateCorrection(rec,null,inventory);
    store.append('StokBahan', rec);
    if (fisik > 0) tampilkanBahan([rec.bahan]);
    return rec;
  };
  /* Bahan yang disembunyikan tampil lagi begitu stoknya diisi lagi (pembelian, stok awal, atau hasil hitung fisik). */
  function tampilkanBahan(names) {
    var st = settings(), buka = {}; (names || []).forEach(function (n) { var k = coreNormBahan(n); if (k) buka[k] = 1; });
    var sisa = st.bahanSembunyi.filter(function (n) { return !buka[coreNormBahan(n)]; });
    if (sisa.length !== st.bahanSembunyi.length) { st.bahanSembunyi = sisa; store.setSettings(st); }
  }
  /* "Mulai dari nol": owner mengosongkan seluruh stok bahan sebelum mengisi stok gudang yang sebenarnya.
     Tidak ada riwayat yang dihapus. Urutannya: (1) persiapan potong yang belum dipakai dibatalkan supaya tidak ada
     bahan yang dicadangkan; (2) tanggal mulai hitung pemakaian dipindah ke hari ini, lalu tiap rol dan tiap saldo
     bahan dikoreksi menjadi 0 dan nama bahannya disembunyikan (muncul lagi saat stoknya diisi); (3) PO aktif yang
     belum punya catatan produksi sama sekali dibatalkan dan diarsipkan, sehingga barangnya kembali "belum PO".
     Aman diulang: panggilan berikutnya hanya mengerjakan yang belum selesai, dan selesai:false berarti panggil lagi. */
  var NOL_KATA = 'MULAI DARI NOL', NOL_BATAS = 25;
  function mulaiNol(p, tulis) {
    ['Pegawai','PO','RencanaPotong','Potong','StokBahan','SlipKirim','SlipSetor','QC','Gudang'].forEach(function (name) { if (store.fresh) store.fresh(name); });
    var me = auth(p); if (me.divisi !== 'owner') fail('Hanya owner yang boleh mengosongkan stok.');
    if (typeof coreCutAvailability !== 'function') fail('Paket persiapan potong belum lengkap. Muat ulang aplikasi.');
    if (tulis && String(p.yakin || '') !== NOL_KATA) fail('Ketik ' + NOL_KATA + ' untuk melanjutkan.');
    var out = { pratinjau: !tulis, selesai: true, rencana: 0, rol: 0, bahan: 0, po: 0, lepas: 0, daftarBahan: [], daftarPO: [], daftarLepas: [] };
    var cuts = store.read('Potong'), dipakai = {}; cuts.forEach(function (r) { if (r.rencanaId) dipakai[r.rencanaId] = true; });
    function gantung(r) { return r.status === 'siap' && !dipakai[r.id]; }

    /* 1. persiapan potong yang masih mencadangkan bahan */
    var tunggu = store.read('RencanaPotong').filter(gantung);
    out.rencana = tunggu.length;
    if (tulis && tunggu.length) {
      tunggu.slice(0, NOL_BATAS).forEach(function (r) { store.update('RencanaPotong', r.id, prepareRow({}, r.id, r.poId, 'batal', r)); });
      if (tunggu.length > NOL_BATAS) { out.selesai = false; return out; }
    }

    /* 2. stok: dihitung seolah-olah semua persiapan di atas sudah batal */
    var st = settings(), hari = today(), stNol = {};
    Object.keys(st).forEach(function (k) { stNol[k] = st[k]; });
    if (!stNol.stokMulai || stNol.stokMulai < hari) stNol.stokMulai = hari;
    var rencana = store.read('RencanaPotong').filter(function (r) { return !gantung(r); }), stok = store.read('StokBahan');
    var inv = coreRollInventory(cuts, stok, stNol, rencana), baris = [], dibuat = nowIso(), rolPer = {};
    var catatan = 'Mulai dari nol ' + hari.split('-').reverse().join('/') + ': stok dikosongkan sebelum diisi stok gudang yang sebenarnya';
    function bulat(n) { return Math.round(n * 1000) / 1000; }
    inv.rolls.forEach(function (r) {
      if (Math.abs(r.saldo) < 0.0005) return;
      out.rol++; rolPer[coreNormBahan(r.bahan)] = coreNum(rolPer[coreNormBahan(r.bahan)]) + 1;
      baris.push({ id: env.id(), jenis: 'koreksi', tanggal: hari, bahan: r.bahan, qty: bulat(-r.saldo), satuan: r.satuan, rol: 0, harga: 0, total: 0, supplier: '', invoice: r.invoice, sumber: '', alasan: 'stok_opname',
        catatan: catatan, dibuatOleh: me.id, dibuat: dibuat, asal: '', sourceStockId: r.id, saldoBefore: r.saldo, saldoAfter: 0, previousCorrectionId: r.correctionRevision, sourceRevision: r.sourceRevision });
    });
    inv.legacy.forEach(function (m) {
      if (Math.abs(m.saldo) < 0.0005) return;
      baris.push({ id: env.id(), jenis: 'koreksi', tanggal: hari, bahan: m.nama, qty: bulat(-m.saldo), satuan: m.satuan, rol: 0, harga: 0, total: 0, supplier: '', invoice: '', sumber: '', alasan: 'stok_opname',
        catatan: catatan, dibuatOleh: me.id, dibuat: dibuat, asal: '' });
    });
    inv.materials.forEach(function (m) {
      if (Math.abs(m.saldo) < 0.0005 && !rolPer[m.kunci]) return;
      out.bahan++; if (out.daftarBahan.length < 300) out.daftarBahan.push({ nama: m.nama, saldo: m.saldo, satuan: m.satuan, rol: coreNum(rolPer[m.kunci]) });
    });
    var semuaNama = {}, sembunyi = st.bahanSembunyi.slice();
    sembunyi.forEach(function (n) { semuaNama[coreNormBahan(n)] = 1; });
    inv.materials.forEach(function (m) { if (!semuaNama[m.kunci]) { semuaNama[m.kunci] = 1; sembunyi.push(m.nama); } });
    if (tulis && (baris.length || sembunyi.length !== st.bahanSembunyi.length || st.stokMulai !== stNol.stokMulai)) {
      /* periksa hasilnya dulu: sesudah koreksi, semua rol dan semua bahan harus tepat nol */
      var uji = coreRollInventory(cuts, stok.concat(baris), stNol, rencana);
      if (uji.rolls.some(function (r) { return Math.abs(r.saldo) >= 0.0005; }) || uji.materials.some(function (m) { return Math.abs(m.saldo) >= 0.0005; })) fail('Hitungan pengosongan stok tidak menghasilkan nol. Stok belum diubah; laporkan ke pembuat aplikasi.');
      if (JSON.stringify(sembunyi).length > 45000) fail('Daftar bahan yang disembunyikan terlalu panjang.');
      if (baris.length && store.validateRows) store.validateRows('StokBahan', baris);
      st.stokMulai = stNol.stokMulai; st.bahanSembunyi = sembunyi; store.setSettings(st);
      if (baris.length) store.appendMany('StokBahan', baris);
    }

    /* 3. PO aktif yang belum dipotong, dijahit, atau di-QC sama sekali. Catatan input BigSeller saja tidak dihitung
          sebagai produksi: PO seperti itu tetap belum pernah dipotong. */
    var terpakai = {};
    ['Potong','SlipKirim','SlipSetor','QC'].forEach(function (s) { store.read(s).forEach(function (r) { if (r.poId) terpakai[r.poId] = true; }); });
    var kosong = store.read('PO').filter(function (r) { return r.status === 'aktif' && !terpakai[r.id]; }), ikutArsip = {};
    kosong.forEach(function (r) { ikutArsip[r.id] = true; });
    out.po = kosong.length; out.daftarPO = kosong.slice(0, 300).map(function (r) { return { id: r.id, noPO: r.noPO, nama: r.nama }; });
    /* 4. PO yang sudah berjalan tetap aktif, tetapi ukurannya yang belum dipotong dilepas: tidak lagi menunggu tukang potong */
    var alur = workflow(), petaLepas = {}, stLepas = settings().poUkuranLepas;
    Object.keys(stLepas).forEach(function (k) { if (stLepas[k] instanceof Array && stLepas[k].length) petaLepas[k] = stLepas[k].slice(); });
    out.lepas = 0; out.daftarLepas = [];
    store.read('PO').forEach(function (r) {
      if (r.status !== 'aktif' || ikutArsip[r.id]) return;
      var tunggu = (alur[r.id] && alur[r.id].cutting && alur[r.id].cutting.pendingUkuran) || []; if (!tunggu.length) return;
      out.lepas += tunggu.length; if (out.daftarLepas.length < 300) out.daftarLepas.push({ id: r.id, noPO: r.noPO, nama: r.nama, ukuran: tunggu.slice() });
      var kini = petaLepas[r.id] || (petaLepas[r.id] = []); tunggu.forEach(function (s) { if (kini.indexOf(s) < 0) kini.push(s); });
    });
    if (tulis && kosong.length) {
      var kerja = kosong.slice(0, NOL_BATAS), sekarang = nowIso();
      kerja.forEach(function (r) { store.update('PO', r.id, { status: 'batal', diubah: sekarang, selesaiPada: hari }); });
      var st2 = settings(), arsip = st2.poSembunyi.slice();
      kerja.forEach(function (r) { if (arsip.indexOf(r.id) < 0) arsip.push(r.id); });
      if (JSON.stringify(arsip).length > 45000) fail('Arsip PO sudah terlalu panjang.');
      st2.poSembunyi = arsip; store.setSettings(st2);
      if (kosong.length > NOL_BATAS) out.selesai = false;
    }
    if (tulis && out.lepas) {
      if (JSON.stringify(petaLepas).length > 45000) fail('Daftar ukuran yang dilepas sudah terlalu panjang.');
      var st3 = settings(); st3.poUkuranLepas = petaLepas; store.setSettings(st3);
    }
    return out;
  }
  actions.getPratinjauNol = function (p) { return mulaiNol(p, false); };
  actions.mulaiDariNol = function (p) { return mulaiNol(p, true); };

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
  /* Slip gaji yang memuat cicilan ini sudah ditandai dibayar? Kalau ya, cicilannya tidak boleh diubah. */
  function cicilanTerkunci(rec) {
    if (rec.tipe !== 'cicilan' || rec.jenis !== 'harian') return false;
    var rows = store.read('GajiHarian').filter(function (g) { return g.karyawanId === rec.orangId; }), periods = {};
    rows.forEach(function (g) { if (g.periode) periods[g.periode] = 1; });
    var pid = coreCicilanPeriode(rec, Object.keys(periods));
    return !!pid && rows.some(function (g) { return g.periode === pid && (g.lunas === true || /^(true|ya|1)$/i.test(String(g.lunas))); });
  }
  /* Mengubah jumlah, tanggal, atau keterangan satu kasbon atau satu cicilan, tanpa harus menghapus dan mencatat ulang. */
  actions.ubahKasbon = function (p) {
    var me = auth(p); mustAdmin(me);
    if (store.fresh) store.fresh('Kasbon');
    var rec = findRow('Kasbon', String(p.id || '')); if (!rec) fail('Catatan kasbon tidak ditemukan.');
    if (rec.periode === 'penyesuaian') fail('Baris penyesuaian dari aplikasi lama tidak bisa diubah.');
    if (p.expectedJumlah !== undefined && p.expectedJumlah !== '' && Math.round(coreNum(p.expectedJumlah)) !== Math.round(coreNum(rec.jumlah))) fail('Catatan ini sudah berubah sejak formulir dibuka. Muat ulang lalu coba lagi.');
    var jumlah = Math.round(coreNum(p.jumlah)); if (!(jumlah > 0)) fail('Isi jumlahnya.');
    var tanggal = tglOk(p.tanggal); if (!tanggal || coreTambahHari(tanggal, 0) !== tanggal) fail('Isi tanggal yang benar.');
    var patch = { jumlah: jumlah, tanggal: tanggal, keterangan: teks(p.keterangan, 200) };
    var semua = coreKasbon(store.read('Kasbon'));
    if (rec.tipe === 'kasbon') {
      var info = semua.filter(function (x) { return x.id === rec.id; })[0];
      if (info && jumlah < info.dicicil) fail('Jumlah kasbon tidak boleh kurang dari yang sudah dicicil (' + coreRupiah(info.dicicil) + ').');
    } else if (rec.tipe === 'cicilan') {
      var induk = semua.filter(function (x) { return x.id === rec.kasbonId; })[0]; if (!induk) fail('Kasbon induknya tidak ditemukan.');
      var maks = induk.sisa + Math.round(coreNum(rec.jumlah));
      if (jumlah > maks) fail('Cicilan melebihi sisa kasbon (' + coreRupiah(maks) + ').');
      if (cicilanTerkunci(rec)) fail('Slip gaji minggu itu sudah ditandai dibayar. Batalkan tanda dibayarnya dulu.');
      patch.periode = rec.jenis === 'harian' && corePeriode(p.periode) ? String(p.periode) : coreMingguId(tanggal);
      var nanti = {}; Object.keys(rec).forEach(function (k) { nanti[k] = rec[k]; }); nanti.tanggal = tanggal; nanti.periode = patch.periode; nanti.asal = '';
      if (cicilanTerkunci(nanti)) fail('Slip gaji minggu tujuan sudah ditandai dibayar. Pilih minggu lain atau batalkan tandanya dulu.');
      /* cicilan yang diubah di aplikasi ini mengikuti aturan aplikasi ini (dicari slipnya lewat tanggal bila perlu) */
      patch.asal = '';
    } else fail('Catatan ini tidak bisa diubah.');
    store.update('Kasbon', rec.id, patch);
    return findRow('Kasbon', rec.id);
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
  /* Target selesai jahitan seorang penjahit pada satu PO boleh diubah, misalnya target lama dari aplikasi sebelumnya.
     Target per penjahit adalah tanggal target paling akhir di antara penugasannya: tanggal itu yang diganti, dan
     penugasan lain yang targetnya lebih akhir dari tanggal baru ikut disamakan. target kosong = tanpa target.
     Jumlah, harga, dan upah tidak disentuh. */
  actions.ubahTargetJahit = function (p) {
    var me = auth(p); mustAdmin(me);
    if (store.fresh) store.fresh('SlipKirim');
    var po = findRow('PO', String(p.poId || '')); if (!po) fail('PO tidak ditemukan.');
    var maklonId = String(p.maklonId || ''), kosong = p.target === '' || p.target === undefined || p.target === null, target = kosong ? '' : coreTglOk(p.target);
    if (!kosong && !target) fail('Tanggal target tidak sah.');
    var rows = store.read('SlipKirim').filter(function (r) { return r.poId === po.id && r.maklonId === maklonId; });
    if (!rows.length) fail('Belum ada penugasan jahit untuk penjahit ini di PO tersebut.');
    var utama = rows[0];
    rows.forEach(function (r) { var a = String(r.target || ''), b = String(utama.target || ''); if (a > b || (a === b && String(r.dibuat || '') >= String(utama.dibuat || ''))) utama = r; });
    var diubah = 0;
    rows.forEach(function (r) {
      var kini = String(r.target || ''), baru = r.id === utama.id ? target : (kosong || kini > target ? target : kini);
      if (baru !== kini) { store.update('SlipKirim', r.id, { target: baru }); diubah++; }
    });
    return { ok: true, target: target, diubah: diubah };
  };

  function upahJahitTerakhir(po, maklonId, st) {
    var best = null;
    store.read('SlipKirim').forEach(function (r) { if (r.poId === po.id && r.maklonId === maklonId && (!best || String(r.dibuat) >= String(best.dibuat))) best = r; });
    return best && coreNum(best.upah) > 0 ? best.upah : tarifProduk(po, 'tarifJahit', st.upahJahit);
  }

  actions.createSetor = function (p) {
    var me = auth(p); var admin = coreIsAdmin(me);
    var cek = admin || me.divisi === 'qc';   /* admin & QC mencatat barang yang sudah mereka hitung sendiri */
    if (!cek && me.divisi !== 'jahit') fail('Hanya maklon jahit, QC, atau admin yang bisa mencatat setoran.');
    var s = p.setor || {}; var d = dedupe('SlipSetor', s);
    if (d.ada) {
      if (!cek && d.ada.maklonId !== me.id) fail('Hanya bisa membuka kembali setoran sendiri.');
      return d.ada;
    }
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
      /* Tanggal hitung boleh diisi QC; kalau kosong, tanggal laporan dipertahankan seperti sebelumnya. */
      if (p.tanggal !== undefined && p.tanggal !== '') {
        var tanggalHitung = tglOk(p.tanggal);
        if (!tanggalHitung || coreTambahHari(tanggalHitung, 0) !== tanggalHitung) fail('Tanggal hitung tidak valid.');
        if (tanggalHitung > coreTambahHari(today(), 1)) fail('Tanggal hitung tidak boleh melewati hari ini.');
        patch.tanggal = tanggalHitung;
      }
      /* Laporan jahit lama yang belum dihitung boleh dihitung bertahap: yang sudah dihitung diterima sekarang,
         sisanya tetap menunggu sebagai baris tersendiri dengan asal dan ikatan pembayaran yang sama.
         Jumlah laporan per ukuran tetap utuh: diterima + reject + sisa yang menunggu = laporan semula. */
      var sumberLama = coreMap(rec.imporSumber), sisaLama = null;
      var anakId = idOk(rec.id + 's'), anak = anakId ? findRow('SlipSetor', anakId) : null;
      /* Baris sisa hanya lahir saat laporan asalnya diterima. Kalau laporan asal masih menunggu tetapi baris sisanya
         sudah ada, itu bekas penyimpanan yang terputus: dibuang dulu, lalu ditulis ulang di bawah bila masih ada sisa. */
      if (anak && anak.status === 'diajukan' && !anak.diprosesOleh && coreMap(anak.imporSumber).sisaDari === (sumberLama.sisaDari || rec.id)) { store.remove('SlipSetor', anakId); anak = null; }
      if (frozenPending || (rec.asal === 'lama' && sumberLama.baseline === true && sumberLama.field === 'jahit')) {
        var originalQty = sumMaps([coreMap(rec.ukuran), coreMap(rec.rejectUkuran)]), proposedQty = sumMaps([uk, bad]), sisa = {};
        Object.keys(sumMaps([originalQty, proposedQty])).forEach(function (size) {
          var selisih = coreNum(originalQty[size]) - coreNum(proposedQty[size]);
          if (selisih < 0 && frozenPending) fail('Jumlah laporan lama yang terikat pembayaran harus dipertahankan per ukuran: hitungan ' + size + ' melebihi laporannya (' + coreNum(originalQty[size]) + ' pcs). Catat kelebihannya sebagai setoran baru.');
          if (selisih > 0) sisa[size] = selisih;
        });
        if (Object.keys(sisa).length) { if (!anakId || anak) fail('Sisa laporan lama ini tidak dapat dipisahkan. Hubungi owner.'); sisaLama = sisa; }
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
      /* Sisa ditulis lebih dulu, baru laporan asalnya diterima. Kalau penyimpanan terputus di antaranya, laporan
         asal masih menunggu dan kiriman ulang membuang baris sisa itu dulu (lihat di atas): tidak ada pcs yang hilang. */
      if (sisaLama) {
        var sumberSisa = {}; Object.keys(sumberLama).forEach(function (k) { sumberSisa[k] = sumberLama[k]; }); sumberSisa.sisaDari = sumberLama.sisaDari || rec.id;
        var barisSisa = {}; SCHEMA.SlipSetor.forEach(function (c) { barisSisa[c] = rec[c] === undefined || rec[c] === null ? '' : rec[c]; });
        barisSisa.id = anakId; barisSisa.noSlip = ''; barisSisa.ukuran = JSON.stringify(sisaLama); barisSisa.total = coreSumSizes(sisaLama); barisSisa.reject = 0; barisSisa.rejectUkuran = JSON.stringify({});
        barisSisa.status = 'diajukan'; barisSisa.diprosesOleh = ''; barisSisa.diprosesPada = ''; barisSisa.upahId = ''; barisSisa.imporSumber = JSON.stringify(sumberSisa);
        if (store.validateRows) store.validateRows('SlipSetor', [barisSisa]);
        store.append('SlipSetor', barisSisa);
      }
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
    /* QC dicatat per slip yang sudah dihitung; sisa jahitan PO yang belum disetor tidak menahannya. */
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
        var u = wf.ukuran[s]; if (!u || !u.readyQC) fail('Ukuran ' + s + ' belum punya hitungan fisik yang bisa diperiksa.');
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

  /* Arsip PO: PO selesai/batal keluar dari daftar (id-nya masuk pengaturan poSembunyi) dan barangnya kembali
     "belum di-PO". Tidak ada baris yang dihapus; arsip:false mengembalikannya ke daftar. */
  actions.arsipPO = function (p) {
    var me = auth(p); mustAdmin(me);
    if (store.fresh) store.fresh('PO');
    var ids = (p.ids instanceof Array ? p.ids : [p.id]).map(function (x) { return String(x || ''); }).filter(Boolean);
    if (!ids.length || ids.length > 1000) fail('Pilih PO yang akan diarsipkan.');
    var st = settings(), list = st.poSembunyi.slice();
    if (p.arsip === false) list = list.filter(function (x) { return ids.indexOf(x) < 0; });
    else ids.forEach(function (id) {
      var rec = findRow('PO', id); if (!rec) fail('PO tidak ditemukan. Muat data terbaru.');
      if (rec.status === 'aktif') fail('PO ' + (rec.noPO || rec.nama) + ' masih aktif. Tandai selesai atau batal dahulu, baru diarsipkan.');
      if (list.indexOf(id) < 0) list.push(id);
    });
    if (JSON.stringify(list).length > 45000) fail('Arsip PO sudah terlalu panjang.');
    st.poSembunyi = list; store.setSettings(st);
    return { ok: true, jumlah: list.length };
  };
  /* Hapus PO selesai/batal. PO yang belum punya catatan produksi benar-benar dihapus. PO yang sudah punya catatan
     potong, jahit, QC, atau upah tidak dibuang barisnya (upah dan stok yang sudah tercatat bergantung padanya):
     id-nya masuk pengaturan poBuang sehingga tidak tampil lagi di mana pun, termasuk di Arsip. buang:false membatalkan. */
  actions.buangPO = function (p) {
    var me = auth(p); mustAdmin(me);
    if (store.fresh) store.fresh('PO');
    var ids = (p.ids instanceof Array ? p.ids : [p.id]).map(function (x) { return String(x || ''); }).filter(Boolean);
    if (!ids.length || ids.length > 1000) fail('Pilih PO yang akan dihapus.');
    var st = settings(), list = st.poBuang.slice(), dihapus = 0, disimpan = 0, hilang = {};
    if (p.buang === false) list = list.filter(function (x) { return ids.indexOf(x) < 0; });
    else {
      /* periksa semuanya dulu, supaya satu PO aktif tidak meninggalkan sebagian terhapus */
      var rows = ids.map(function (id) { var rec = findRow('PO', id); if (rec && rec.status === 'aktif') fail('PO ' + (rec.noPO || rec.nama) + ' masih aktif. Tandai selesai atau batal dahulu, baru dihapus.'); return rec; });
      ids.forEach(function (id, i) {
        if (!rows[i]) { hilang[id] = 1; return; }
        if (!poDipakai(id)) { if (findRow('Gambar', id)) store.remove('Gambar', id); store.remove('PO', id); hilang[id] = 1; dihapus++; return; }
        disimpan++; if (list.indexOf(id) < 0) list.push(id);
      });
    }
    list = list.filter(function (x) { return !hilang[x]; });
    if (JSON.stringify(list).length > 45000) fail('Daftar PO yang dihapus sudah terlalu panjang.');
    st.poBuang = list; st.poSembunyi = st.poSembunyi.filter(function (x) { return !hilang[x]; }); store.setSettings(st);
    return { ok: true, dihapus: dihapus, disimpan: disimpan, jumlah: list.length };
  };
  /* Cadangan untuk owner: isi tiap tabel apa adanya, tanpa PIN dan token. Diminta per tabel (dan dipotong per
     bagian) supaya tiap jawaban kecil; perangkat owner yang merangkainya menjadi satu berkas. Hanya membaca. */
  var CADANGAN_RAHASIA = { Pegawai: ['pin', 'token', 'gagal', 'kunci'] };
  actions.getCadangan = function (p) {
    var me = auth(p); if (me.divisi !== 'owner') fail('Hanya owner yang boleh mengunduh cadangan.');
    var daftar = Object.keys(SCHEMA).filter(function (s) { return s !== 'Pengaturan'; });
    if (!p.tabel) return { tabel: daftar, pengaturan: settings(), appVersion: APP_VERSION, dibuat: nowIso() };
    var name = String(p.tabel); if (daftar.indexOf(name) < 0) fail('Tabel tidak dikenal.');
    var hide = CADANGAN_RAHASIA[name] || [], semua = store.read(name), mulai = Math.max(0, coreInt(p.mulai)), rows = [], besar = 0, i = mulai;
    for (; i < semua.length && (besar < 1500000 || !rows.length); i++) {
      var o = {}; SCHEMA[name].forEach(function (c) { if (hide.indexOf(c) < 0) o[c] = semua[i][c] === undefined || semua[i][c] === null ? '' : semua[i][c]; });
      besar += JSON.stringify(o).length; rows.push(o);
    }
    return { tabel: name, mulai: mulai, rows: rows, jumlah: semua.length, lanjut: i < semua.length ? i : null };
  };
  function poDipakai(id) { return ['Potong', 'RencanaPotong', 'SlipKirim', 'SlipSetor', 'QC', 'Gudang', 'GudangLama', 'LegacySettlement'].some(function (s) { return store.read(s).some(function (r) { return r.poId === id; }); }); }
  actions.deleteRecord = function (p) {
    var me = auth(p); var admin = coreIsAdmin(me);
    var sheet = String(p.sheet || ''); var id = String(p.id || '');
    var rec = findRow(sheet, id); if (!rec) return { ok: true, sudah: true };
    /* "Hapus" pada PO selesai/batal yang sudah punya catatan produksi: PO hanya disembunyikan dari daftar.
       Baris PO, hasil potong, setoran, QC, dan upahnya tetap ada supaya riwayat tidak rusak. */
    if (sheet === 'PO' && p.sembunyikan === true && admin && poDipakai(id)) {
      if (rec.status === 'aktif') fail('PO ini masih aktif dan sudah punya catatan produksi. Ubah statusnya menjadi Selesai atau Batal dahulu.');
      var stSembunyi = settings();
      if (stSembunyi.poSembunyi.indexOf(id) < 0) {
        stSembunyi.poSembunyi = stSembunyi.poSembunyi.concat([id]);
        if (JSON.stringify(stSembunyi.poSembunyi).length > 45000) fail('Daftar PO yang dihapus dari daftar sudah terlalu panjang.');
        store.setSettings(stSembunyi);
      }
      return { ok: true, disembunyikan: true };
    }
    if (sheet === 'RencanaPotong') fail('Persiapan potong tidak dapat dihapus. Batalkan persiapan yang belum dipakai.');
    if (sheet === 'KoreksiRiwayat' || correctedSource(sheet, id)) fail('Sumber dan riwayat koreksi fisik tidak dapat dihapus.');
    if (['Potong', 'SlipKirim', 'SlipSetor', 'QC'].indexOf(sheet) >= 0) openPO(rec.poId);
    if (sheet === 'Potong') {
      if (rec.rencanaId) fail('Hasil potong dari persiapan owner tidak dapat dihapus karena pemakaian bahannya sudah tercatat.');
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
      if (poDipakai(id)) fail('PO sudah punya catatan produksi. Ubah statusnya menjadi Batal saja.');
      if (findRow('Gambar', id)) store.remove('Gambar', id);
    } else if (sheet === 'Produk') {
      if (!admin) fail('Hanya admin.');
      if (store.read('PO').some(function (r) { return r.produkId === id; })) fail('Produk sudah dipakai PO. Nonaktifkan saja.');
      if (findRow('Gambar', id)) store.remove('Gambar', id);
    } else if (sheet === 'StokBahan') {
      if (!admin) fail('Hanya admin.');
      ['StokBahan','RencanaPotong','Potong'].forEach(function (name) { if (store.fresh) store.fresh(name); });
      rec = findRow('StokBahan',id); if (!rec) return {ok:true,sudah:true};
      ensureRollSourceUnused(id);
      if (rec.sourceStockId) fail('Bukti koreksi rol tidak dapat dihapus. Catat hitung fisik baru untuk rol tersebut.');
      if (rec.jenis === 'koreksi') ensureAggregateCorrection({bahan:rec.bahan,qty:-coreNum(rec.qty)},null);
      else if (rec.jenis === 'beli' && rec.stockMode !== 'roll') ensureAggregatePurchase({bahan:rec.bahan,qty:0,satuan:rec.satuan},rec);
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
    var sheet = String(p.sheet || ''); if (!SCHEMA[sheet] || ['Pengaturan','Gambar','LegacySettlement','MigrasiJournal','GudangLama','KoreksiRiwayat','RencanaPotong','CommerceRecord','CommerceEvent','CommerceSource','CommerceImport'].indexOf(sheet) >= 0) fail('Sheet tidak dikenal.');
    if (sheet === 'StokBahan') ['StokBahan','Potong','RencanaPotong'].forEach(function (name) { if (store.fresh) store.fresh(name); });
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
      if (sheet === 'PO' && r.ukuranAktif !== undefined && r.ukuranAktif !== null && r.ukuranAktif !== '') fail('Ukuran aktif PO baru hanya dibuat bersama persiapan bahan, bukan melalui impor lama.');
      if (sheet === 'PO' && coreMap(r.imporSumber).legacyCutting) fail('Bukti ukuran potong asal hanya boleh dibuat melalui migrasi terverifikasi.');
      if (sheet === 'Potong' && (r.rencanaId || coreParseJSON(r.alokasiBahan,[]).length)) fail('Hubungan persiapan potong hanya boleh dibuat saat menyimpan hasil potong.');
      if (sheet === 'StokBahan' && (r.stockMode || r.sourceStockId)) fail('Identitas atau koreksi rol baru harus berasal dari pencatatan rol, bukan impor.');
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
      if (sheet === 'PO') o.tuntasPada = ''; /* Completion time is observed by this server, never backdated by import. */
      if (SCHEMA[sheet].indexOf('asal') >= 0) o.asal = 'lama';
      existing[o.id] = 1; add.push(o);
    });
    if (store.validateRows) {
      store.validateRows(sheet, add);
      if (nextSettings) store.validateRows('Pengaturan', Object.keys(nextSettings).map(function (k) { return { key: k, value: JSON.stringify(nextSettings[k]) }; }));
    }
    if (sheet === 'StokBahan' && add.length) ensureAggregateStockReplacement(store.read('StokBahan').concat(add),store.read('Potong'),nextSettings);
    if (nextSettings) store.setSettings(nextSettings);
    if (add.length) store.appendMany(sheet, add);
    return { ditambah: add.length, dilewati: rows.length - add.length, ids: sheet === 'Pegawai' ? add.map(function (r) { return r.id; }) : undefined };
  };

  /* ---------- pindah dari aplikasi lama: isi ulang data impor ----------
     Baris yang datang dari aplikasi lama dibuang lalu diganti data terbaru dari aplikasi lama.
     Baris yang dibuat di aplikasi ini tidak disentuh. Semua diperiksa dulu; kalau ada yang janggal, tidak ada yang ditulis.
     Boleh diulang kapan saja selama divisi masih bekerja di aplikasi lama. */
  function barisLama(sheet, r) {
    if (sheet === 'Potong' && r.rencanaId) return false;
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
    if (sheets.indexOf('StokBahan') >= 0) ['StokBahan','Potong','RencanaPotong'].forEach(function (sheet) { if (store.fresh) store.fresh(sheet); });
    var next = {}; var hasil = {};
    sheets.forEach(function (sheet) {
      var lama = store.read(sheet); var asli = lama.filter(function (r) { return !barisLama(sheet, r); });
      var idAsli = {}; var nomor = {}; var kolNo = sheet === 'PO' ? 'noPO' : ((sheet === 'SlipKirim' || sheet === 'SlipSetor') ? 'noSlip' : '');
      asli.forEach(function (r) { idAsli[r.id] = 1; if (kolNo && r[kolNo]) nomor[r[kolNo]] = 1; });
      var lamaById = {}; lama.forEach(function (r) { lamaById[r.id] = r; });
      var masuk = []; var seen = {};
      data[sheet].forEach(function (r) {
        if (!r || !idOk(r.id) || idAsli[r.id] || seen[r.id]) return;
        if (sheet === 'PO' && r.ukuranAktif !== undefined && r.ukuranAktif !== null && r.ukuranAktif !== '') fail('Ukuran aktif PO tidak boleh ditambahkan atau diganti melalui impor lama.');
        if (sheet === 'Potong' && (r.rencanaId || coreParseJSON(r.alokasiBahan,[]).length)) fail('Hubungan persiapan potong tidak boleh ditambahkan melalui impor.');
        if (sheet === 'StokBahan' && (r.stockMode || r.sourceStockId)) fail('Identitas atau koreksi rol tidak boleh ditambahkan atau diganti melalui impor.');
        seen[r.id] = 1;
        var o = {};
        SCHEMA[sheet].forEach(function (c) {
          var v = r[c]; if (v && typeof v === 'object') v = JSON.stringify(v);
          if (v === undefined || v === null) v = TYPES[c] === 'num' ? 0 : (TYPES[c] === 'bool' ? false : '');
          o[c] = v;
        });
        o.asal = 'lama';
        var dulu = lamaById[o.id];
        if (sheet === 'PO') {
          var source = coreMap(o.imporSumber), priorSource = coreMap(dulu && dulu.imporSumber), incomingEvidence = source.legacyCutting, priorEvidence = priorSource.legacyCutting;
          if (incomingEvidence && (!priorEvidence || typeof coreLegacyHash !== 'function' || coreLegacyHash(incomingEvidence) !== coreLegacyHash(priorEvidence))) fail('Bukti ukuran potong asal tidak boleh ditambahkan atau diubah melalui impor.');
          if (priorEvidence) { source.legacyCutting = priorEvidence; o.imporSumber = JSON.stringify(source); }
          o.gambar = dulu ? dulu.gambar : ''; o.tuntasPada = '';
        }
        /* pembayaran yang sudah dicatat di aplikasi ini tetap menempel pada itemnya */
        if (['SlipSetor','Potong','QC','GudangLama'].indexOf(sheet) >= 0 && dulu && dulu.upahId) o.upahId = dulu.upahId;
        if (kolNo && o[kolNo]) { while (nomor[o[kolNo]]) o[kolNo] = o[kolNo] + 'L'; nomor[o[kolNo]] = 1; }
        masuk.push(o);
      });
      next[sheet] = asli.concat(masuk);
      hasil[sheet] = { dibuang: lama.length - asli.length, masuk: masuk.length, tetap: asli.length };
    });
    function isi(sheet) { return next[sheet] || store.read(sheet); }
    if (next.PO) store.read('PO').forEach(function (p) { if (coreMap(p.imporSumber).legacyCutting && !next.PO.some(function (r) { return r.id === p.id; })) fail('PO dengan bukti ukuran potong asal tidak boleh dihapus melalui impor.'); });
    if (next.StokBahan) {
      var afterStock = {}; next.StokBahan.forEach(function (r) { afterStock[r.id] = r; });
      store.read('StokBahan').forEach(function (r) {
        if (r.stockMode !== 'roll' && !r.sourceStockId) return;
        var after = afterStock[r.id];
        if (!after || SCHEMA.StokBahan.some(function (key) { return String(r[key] == null ? '' : r[key]) !== String(after[key] == null ? '' : after[key]); })) fail('Tidak jadi dipindahkan: bukti sumber rol tercatat harus dipertahankan tanpa perubahan.');
      });
    }
    if (typeof coreCutValidateReplacement === 'function') coreCutValidateReplacement(store.read('Potong'), isi('Potong'), store.read('RencanaPotong'), isi('PO'), store.read('PO'));
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
    var proposed = coreWorkflow(isi('PO'), isi('Potong'), isi('SlipKirim'), isi('SlipSetor'), isi('QC'), isi('Gudang'), { gudangLama: isi('GudangLama'), settlements: store.read('LegacySettlement'), historyCorrections: store.read('KoreksiRiwayat'), ukuranLepas: settings().poUkuranLepas });
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
    if (next.StokBahan) ensureAggregateStockReplacement(next.StokBahan,isi('Potong'),nextSettings);
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
        (ctx.hideMoney ? '' : '<tr><td>Upah jahit</td><td>' + coreRupiah(rec.upah) + ' per pcs</td></tr>') +
        (type === 'setor' ? '<tr><td>Status</td><td>' + esc({ diajukan: 'Menunggu dicek', diterima: 'Diterima', ditolak: 'Ditolak' }[rec.status] || rec.status) + '</td></tr>' : '') + '</table><br>';
      h += sizeTable(coreParseJSON(rec.ukuran, {}), rec.total, st.ukuran);
      if (type === 'setor') {
        h += '<div class="cat">Reject: <b>' + coreRibuan(rec.reject) + ' pcs</b></div>';
        if (!ctx.hideMoney) {
        var earned = (ctx.payroll || []).filter(function (r) { return r.sourceId === rec.id; });
        if (earned.length) { var current = 0, unpaid = 0, over = 0; earned.forEach(function (r) { current += r.total * r.rate; unpaid += r.available * r.rate; over += coreNum(r.overpaidQty); }); h += '<div class="cat">Hak upah saat ini: <b>' + coreRupiah(current) + '</b> | Belum dibayar: <b>' + coreRupiah(unpaid) + '</b>' + (over ? '<br>Perlu tinjau pembayaran: ' + coreRibuan(over) + ' pcs melebihi hak setelah QC.' : '') + '</div>'; }
        else h += '<div class="cat">Nilai hitungan sebelum QC: <b>' + coreRupiah(rec.total * rec.upah) + '</b></div>';
        }
      }
      if (rec.catatan) h += '<div class="cat">Catatan: ' + esc(rec.catatan) + '</div>';
      h += '<table class="ttd"><tr><td><span>Dibuat oleh</span></td><td><span>Maklon</span></td><td><span>Diterima oleh</span></td></tr></table>';
    } else if (type === 'upah') {
      var peg = ctx.pegawai || {};
      h += '<div class="judul">SLIP UPAH ' + (rec.jenis === 'jahit' ? 'JAHIT' : 'POTONG') + ' &mdash; ' + esc(rec.noSlip) + '</div>';
      h += '<table class="info"><tr><td>Tanggal</td><td>' + coreTgl(rec.tanggal) + '</td></tr>' +
        '<tr><td>Nama</td><td><b>' + esc(peg.nama || '-') + '</b>' + (peg.hp ? ' (' + esc(peg.hp) + ')' : '') + '</td></tr></table><br>';
      h += '<table class="rinci"><tr><th>Ref</th><th>Tanggal</th><th>Barang</th><th>Pcs</th>' + (ctx.hideMoney ? '' : '<th>Upah/pcs</th><th>Jumlah</th>') + '</tr>';
      (ctx.items || []).forEach(function (s) {
        var po2 = ctx.poMap[s.poId] || {}; var rate = rec.jenis === 'jahit' ? s.upah : s.tarif;
        h += '<tr><td>' + esc(s.noSlip || s.ref || (rec.jenis === 'jahit' ? 'Setor' : 'Potong')) + '</td><td>' + coreTgl(s.tanggal) + '</td><td>' + esc(po2.noPO) + ' ' + esc(po2.nama) + '</td><td align="right">' + coreRibuan(s.total) + '</td>' + (ctx.hideMoney ? '' : '<td align="right">' + coreRupiah(rate) + '</td><td align="right">' + coreRupiah(s.total * rate) + '</td>') + '</tr>';
      });
      h += '</table><div class="total">Total ' + coreRibuan(rec.totalQty) + ' pcs' + (ctx.hideMoney ? '' : ' = ' + coreRupiah(rec.totalUpah)) + '</div>';
      if (!ctx.hideMoney && rec.potongan) h += '<div class="total">Potongan: ' + coreRupiah(rec.potongan) + '</div>';
      if (!ctx.hideMoney) h += '<div class="total">DIBAYAR: ' + coreRupiah(rec.dibayar) + '</div>';
      if (rec.catatan) h += '<div class="cat">Catatan: ' + esc(rec.catatan) + '</div>';
      h += '<table class="ttd"><tr><td><span>Dibayar oleh</span></td><td></td><td><span>Diterima</span></td></tr></table>';
    }
    return '<html><head><meta charset="utf-8"><style>' + css + '</style></head><body>' + kop + h + '</body></html>';
  }

  actions.makeWeeklyPdf = function (p) {
    if (typeof coreWeeklySlipModel !== 'function' || typeof coreSlipModelsHtml !== 'function') fail('Paket slip belum lengkap. Muat ulang aplikasi.');
    if (!env.makePdf) fail('Unduh PDF tersedia pada aplikasi yang terhubung ke Google Sheets.');
    var prepared = store.lock(function () {
      var me = auth(p), worker = findUser(String(p.pegawaiId || ''));
      if (!worker || ['jahit','potong'].indexOf(worker.divisi) < 0) fail('Pegawai slip tidak ditemukan.');
      if (!coreIsAdmin(me) && worker.id !== me.id) fail('Bukan slip Anda.');
      coreSlipRange(p.start, p.end);
      /* Export uses all earned dates and never starts or closes a PO timer. */
      var state = buildState(me, { semua: true }, durableMigrationStatus(), true);
      var own = {}, known = {}; state.payroll.forEach(function (r) { if (r.pegawaiId === worker.id) own[r.poId] = 1; }); state.po.forEach(function (po) { known[po.id] = 1; });
      store.read('PO').forEach(function (po) { if (own[po.id] && !known[po.id]) state.po.push({ id: po.id, noPO: po.noPO, nama: po.nama, series: po.series }); });
      var result = coreWeeklySlipModel(state, worker, String(p.start), String(p.end));
      if (!result.n) fail('Tidak ada pekerjaan pada rentang tanggal ini.');
      return { html: coreSlipModelsHtml([result.model], state.settings), nama: 'Slip-' + worker.divisi + '-' + String(p.start) + '-' + String(p.end) + '.pdf' };
    });
    /* Google PDF conversion may take time; release the data lock first. */
    var base64 = env.makePdf(prepared.html, prepared.nama); if (!base64) fail('Gagal membuat PDF.');
    return { base64: base64, nama: prepared.nama };
  };
  actions.makeGajiPdf = function (p) {
    if (typeof coreGajiSlipModel !== 'function' || typeof coreSlipModelsHtml !== 'function') fail('Paket slip belum lengkap. Muat ulang aplikasi.');
    if (!env.makePdf) fail('Unduh PDF tersedia pada aplikasi yang terhubung ke Google Sheets.');
    var prepared = store.lock(function () {
      var me = auth(p); mustAdmin(me);
      var period = String(p.periode || ''), per = corePeriode(period);
      if (!per || /^\d{4}-W/.test(period) && coreMingguId(per.start) !== period) fail('Periode gaji tidak valid.');
      coreSlipRange(per.start, per.end);
      var state = { settings: settings(), gaji: store.read('GajiHarian'), kasbon: store.read('Kasbon') }, has = {}, seen = {}, requested = p.karyawanIds;
      state.gaji.forEach(function (g) { if (g.periode === period) has[g.karyawanId] = 1; });
      if (requested !== undefined && !(requested instanceof Array)) fail('Daftar karyawan tidak valid.');
      if (requested instanceof Array && !requested.length) fail('Pilih minimal satu karyawan.');
      var selected = requested instanceof Array ? requested.map(String).filter(function (id) { if (seen[id]) return false; seen[id] = true; return true; }) : Object.keys(has);
      if (!selected.length) fail('Tidak ada catatan gaji pada periode ini.');
      if (selected.length > 100) fail('Pilih paling banyak 100 karyawan per PDF.');
      var employees = {}; store.read('Karyawan').forEach(function (k) { employees[k.id] = k; });
      var models = selected.map(function (id) { if (!employees[id] || !has[id]) fail('Ada karyawan tanpa catatan gaji pada periode ini.'); return coreGajiSlipModel(state, employees[id], period); });
      return { html: coreSlipModelsHtml(models, state.settings), nama: 'Slip-gaji-' + period + '.pdf' };
    });
    var base64 = env.makePdf(prepared.html, prepared.nama); if (!base64) fail('Gagal membuat PDF.');
    return { base64: base64, nama: prepared.nama };
  };
  actions.makePdf = function (p) {
    var me = auth(p);
    var type = String(p.type || ''); var id = String(p.id || '');
    var sheet = { kirim: 'SlipKirim', setor: 'SlipSetor', upah: 'SlipUpah' }[type];
    if (!sheet) fail('Jenis slip tidak dikenal.');
    var rec = findRow(sheet, id); if (!rec) fail('Slip tidak ditemukan.');
    var ownerId = type === 'upah' ? rec.pegawaiId : rec.maklonId;
    var qcSlip = me.divisi === 'qc' && (type === 'kirim' || type === 'setor');
    if (!coreIsAdmin(me) && ownerId !== me.id && !qcSlip) fail('Bukan slip Anda.');
    if (qcSlip) {
      var visiblePO = findRow('PO', rec.poId);
      var hasPending = store.read('SlipSetor').some(function (row) { return row.poId === rec.poId && row.status === 'diajukan'; });
      if (!visiblePO || (visiblePO.status !== 'aktif' && !hasPending)) fail('Slip ini tidak tersedia dalam pekerjaan QC.');
    }
    if (type === 'setor' && rec.status !== 'diterima') fail('Slip terbit setelah QC menghitung setoran ini.');
    if (!env.makePdf) fail('PDF tersedia setelah aplikasi dipasang di Google Sheets. Untuk sekarang pakai "Salin teks".');
    var ctx = { settings: settings(), poMap: {}, hideMoney: qcSlip || (me.divisi === 'jahit' && type === 'kirim') };
    store.read('PO').forEach(function (po) { ctx.poMap[po.id] = po; });
    if (type === 'upah') {
      ctx.pegawai = findUser(rec.pegawaiId) || {};
      var ids = coreParseJSON(rec.itemIds, []);
      var frozenItems = coreParseJSON(rec.items, []);
      var historicItems = coreLegacySlipItems(rec, store.read('LegacySettlement'));
      ctx.items = frozenItems.length ? frozenItems : historicItems.length ? historicItems : store.read(rec.jenis === 'jahit' ? 'SlipSetor' : 'Potong').filter(function (s) { return ids.indexOf(s.id) >= 0; });
      store.read('LegacySettlement').forEach(function (b) { if (b.paymentRef === rec.id && !ctx.poMap[b.poId]) ctx.poMap[b.poId] = coreMap(b.poSnapshot); });
    } else { ctx.maklon = findUser(rec.maklonId) || {}; if (qcSlip) ctx.maklon = { nama: ctx.maklon.nama }; ctx.po = ctx.poMap[rec.poId] || {}; if (type === 'setor' && !ctx.hideMoney) ctx.payroll = payroll().filter(function (r) { return r.sourceId === rec.id; }); }
    var b64 = env.makePdf(slipHtml(type, rec, ctx), rec.noSlip + '.pdf');
    if (!b64) fail('Gagal membuat PDF.');
    return { base64: b64, nama: rec.noSlip + '.pdf' };
  };

  /* aksi yang mengubah data dijalankan satu per satu di dalam kunci, lalu mengembalikan data terbaru */
  if (typeof coreInstallMigrationActions === 'function') coreInstallMigrationActions(actions, { store: store, env: env, auth: auth, fail: fail, settings: settings });
  if (typeof coreInstallHistoryCorrections === 'function') coreInstallHistoryCorrections(actions, { store: store, env: env, auth: auth, fail: fail });
  if (typeof coreInstallCommerceActions === 'function') coreInstallCommerceActions(actions, { store: store, env: env, auth: auth, fail: fail, settings: settings });
  var WRITE = { setupOwner: 1, login: 1, logout: 1, changePin: 1, saveSettings: 1, saveUser: 1, saveProduk: 1, saveGambar: 1, importGambar: 1,
    savePO: 1, savePOWithRencana: 1, setStatusPO: 1, lepasUkuranPotong: 1, saveRencanaPotong: 1, createPotong: 1, createKirim: 1, createSetor: 1, prosesSetor: 1, createQC: 1, createGudang: 1, createUpah: 1,
    tandaiLunas: 1, deleteRecord: 1, importRows: 1, ubahHarga: 1, ubahTargetJahit: 1,
    saveStok: 1, saveInvoiceBahan: 1, rinciStokRol: 1, ubahRinciRol: 1, arsipPO: 1, buangPO: 1, cocokkanStok: 1, cocokkanStokRol: 1, mulaiDariNol: 1, saveKaryawan: 1, saveGaji: 1, lunasGaji: 1, hapusGaji: 1, createKasbon: 1, createCicilan: 1, ubahKasbon: 1, gantiImpor: 1, applyLegacyMigration: 1, recoverLegacyMigration: 1, saveHistoryCorrection: 1 };
  var NO_STATE = { setupOwner: 1, login: 1, logout: 1, importRows: 1, importGambar: 1 };
  var COMMERCE_WRITE = { saveCommerceSupplier:1, saveCommerceProduct:1, saveCommerceOrder:1, saveCommerceNota:1, appendCommercePayment:1, appendCommerceGroupPayment:1, appendCommerceReceipt:1, voidCommerceEvent:1, gantiCommerceEvent:1, cancelCommerceRecord:1, restoreCommerceRecord:1, saveCommerceHpp:1, saveCommerceHppSettings:1, applyCommerceImport:1 };
  Object.keys(COMMERCE_WRITE).forEach(function (name) { WRITE[name]=1; NO_STATE[name]=1; });

  function handle(action, payload) {
    var fn = actions[action];
    if (!fn) fail('Aksi tidak dikenal: ' + action);
    payload = payload || {};
    var contractAction = { savePO: 1, savePOWithRencana: 1, setStatusPO: 1, saveRencanaPotong: 1, saveInvoiceBahan: 1, cocokkanStokRol: 1, createPotong: 1, createKirim: 1, createSetor: 1, prosesSetor: 1, createQC: 1, createGudang: 1, createUpah: 1, tandaiLunas: 1, ubahHarga: 1, deleteRecord: 1, importRows: 1, gantiImpor: 1, applyLegacyMigration: 1, recoverLegacyMigration: 1, getHistoryCorrection: 1, saveHistoryCorrection: 1 };
    if ((contractAction[action] || COMMERCE_WRITE[action]) && Number(payload.workflowVersion) !== WORKFLOW_VERSION) fail('Versi alur produksi tidak cocok. Muat ulang aplikasi versi terbaru.');
    if (!WRITE[action]) return fn(payload);
    return store.lock(function () {
      insideWrite = true;
      /* Migration verifies exact row hashes; register timers on the next normal
         authenticated load rather than altering its verified result response. */
      skipAutoCompletion = action === 'applyLegacyMigration' || action === 'recoverLegacyMigration';
      try {
        /* Login is allowed during recovery; the opt-in authentication response
           needs no production/settings reads. Its subsequent getState still
           checks durable recovery status and all production writes keep it. */
        if (!(action === 'login' && payload.deferState === true) && durableMigrationStatus() && ['applyLegacyMigration','recoverLegacyMigration','login','logout','changePin'].indexOf(action) < 0) fail('Pemulihan riwayat belum selesai. Owner harus memulihkan cadangan jurnal sebelum mengubah data.');
        var data = fn(payload);
        if (NO_STATE[action]) return data;
        var out = { data: data };
        try { out.state = buildState(auth(payload), payload); } catch (e) {}
        return out;
      } finally { insideWrite = false; skipAutoCompletion = false; }
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
  var recoveryTables = tables.concat(['RencanaPotong']);
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
  function protectCutPlans(replacements) {
    var names = ['Potong', 'PO'];
    if (SCHEMA.RencanaPotong) names.push('RencanaPotong');
    /* apply/recover run inside the write lock. Refresh these together instead
       of trusting the planner snapshot or the recovery journal's older rows. */
    checkpoint(names);
    var beforeCuts = store.read('Potong'), plans = SCHEMA.RencanaPotong ? store.read('RencanaPotong') : [];
    var afterPlans = Object.prototype.hasOwnProperty.call(replacements, 'RencanaPotong') ? replacements.RencanaPotong : plans;
    var afterCuts = Object.prototype.hasOwnProperty.call(replacements, 'Potong') ? replacements.Potong : beforeCuts;
    var afterPO = Object.prototype.hasOwnProperty.call(replacements, 'PO') ? replacements.PO : store.read('PO');
    if (afterPlans !== plans) {
      var used = {}; beforeCuts.forEach(function (row) { if (row.rencanaId) used[row.rencanaId] = true; });
      Object.keys(used).forEach(function (id) {
        var before = plans.filter(function (row) { return row.id === id; }), after = afterPlans.filter(function (row) { return row.id === id; });
        if (before.length !== 1 || after.length !== 1 || !sameRows('RencanaPotong', before, after)) fail('Persiapan potong yang sudah dipakai harus dipertahankan tanpa perubahan.');
      });
    }
    if (typeof coreCutValidateReplacement === 'function') return coreCutValidateReplacement(beforeCuts, afterCuts, afterPlans, afterPO, store.read('PO'));
    if (plans.length || afterPlans.length || beforeCuts.concat(afterCuts).some(function (row) { return !!row.rencanaId; })) fail('Paket pelindung persiapan potong belum lengkap. Perbarui server sebelum memulihkan riwayat.');
    return true;
  }
  function readJournal(batchId, expectedManifestHash) {
    var all = store.read('MigrasiJournal').filter(function (r) { return r.batchId === batchId; });
    var control = all.filter(function (r) { return r.sheet === '_manifest'; })[0];
    if (!control) fail('Cadangan pemulihan tidak lengkap. Gunakan salinan spreadsheet sebelum migrasi.');
    var manifest = coreParseJSON(control.before, null);
    if (!manifest || !(manifest.tables instanceof Array)) fail('Daftar cadangan pemulihan tidak sah.');
    if (!expectedManifestHash || coreLegacyHash(manifest) !== expectedManifestHash) fail('Daftar cadangan pemulihan tidak cocok dengan proses yang tercatat.');
    var before = {};
    manifest.tables.forEach(function (item) {
      if (recoveryTables.indexOf(item.name) < 0 || !SCHEMA[item.name] || before[item.name]) fail('Tabel cadangan pemulihan tidak sah.');
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
    protectCutPlans(plan.rows);
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
    protectCutPlans(journal.before);
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

/* Seven elapsed days after verified production completion. This planner never
   mutates source rows or payroll. The caller rechecks fresh evidence under lock
   before applying these PO-only patches. Old complete POs start at first sight. */
var CORE_AUTO_COMPLETE_MS = 7 * 24 * 60 * 60 * 1000;

function coreAutoCompletionTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return NaN;
  var ms = Date.parse(value);
  return isFinite(ms) && new Date(ms).toISOString() === value.replace(/(\d{2}:\d{2}:\d{2})Z$/, '$1.000Z') ? ms : NaN;
}
function coreAutoCompletionEligible(po, flow) {
  var provenance = coreParseJSON(po.imporSumber, {}), reconciliation = provenance.legacyReconciliation || {};
  if (po.status !== 'aktif' || po.imporReview || reconciliation.mode === 'review' || reconciliation.mode === 'archive') return false;
  if (!flow || flow.complete !== true || (flow.issues || []).length) return false;
  return !Object.keys(flow.ukuran || {}).some(function (size) { return (flow.ukuran[size].issues || []).length; });
}
/* Cheap same-version sync check; an unregistered PO is examined on full state,
   including the first authenticated load after deployment and production writes. */
function coreAutoCompletionDue(poRows, now) {
  var ms = now.getTime();
  return (poRows || []).some(function (po) {
    if (po.status !== 'aktif' || !po.tuntasPada) return false;
    var start = coreAutoCompletionTime(po.tuntasPada);
    return !isFinite(start) || start > ms || ms - start >= CORE_AUTO_COMPLETE_MS;
  });
}
function coreAutoCompletionPlan(poRows, workflowById, now) {
  var ms = now.getTime();
  if (!isFinite(ms)) throw new Error('Waktu server tidak sah untuk penutupan PO.');
  var iso = now.toISOString(), patches = [], next = Infinity;
  (poRows || []).forEach(function (po) {
    if (po.status !== 'aktif') return;
    if (!coreAutoCompletionEligible(po, (workflowById || {})[po.id])) {
      if (po.tuntasPada) patches.push({ id: po.id, changes: { tuntasPada: '' }, reason: 'incomplete' });
      return;
    }
    var start = coreAutoCompletionTime(po.tuntasPada);
    if (!isFinite(start) || start > ms) {
      patches.push({ id: po.id, changes: { tuntasPada: iso }, reason: 'started' });
      start = ms;
    } else if (ms - start >= CORE_AUTO_COMPLETE_MS) {
      patches.push({ id: po.id, changes: { status: 'selesai', selesaiPada: coreYmd(now), diubah: iso }, reason: 'completed' });
      return;
    }
    next = Math.min(next, start + CORE_AUTO_COMPLETE_MS);
  });
  return { patches: patches, nextDeadline: isFinite(next) ? new Date(next).toISOString() : '' };
}

/* Pure slip models shared by browser preview and server PDF. They consume earned
   payroll and saved wages; rendering never changes payment or production rows. */
function coreSlipRange(start, end) {
  start = String(start || ''); end = String(end || '');
  if (!coreTglOk(start) || !coreTglOk(end) || coreYmdUtc(coreUtc(start)) !== start || coreYmdUtc(coreUtc(end)) !== end) throw new Error('Tanggal slip tidak valid.');
  var per = corePeriode('custom-' + start + '-' + end);
  if (!per) throw new Error('Rentang slip tidak valid, paling lama 3 bulan.');
  return per;
}
function coreSlipDate(date) {
  var months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'], m = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Number(m[3]) + ' ' + (months[Number(m[2]) - 1] || '') + ' ' + m[1] : '-';
}
function coreSlipNumber(value) { return String(Math.round(coreNum(value) * 100) / 100).replace('.', ','); }
function coreWeeklySlipModel(state, worker, start, end) {
  var per = coreSlipRange(start, end), st = state || {}, settings = st.settings || {};
  if (!worker || !worker.id || ['jahit','potong'].indexOf(worker.divisi) < 0) throw new Error('Pilih penjahit atau tukang potong.');
  var sewing = worker.divisi === 'jahit', seen = {}, groups = {}, ordered = [], review = [], poMap = {}, cutMap = {};
  (st.po || []).forEach(function (p) { poMap[p.id] = p; });
  (st.potong || []).forEach(function (r) { cutMap[r.id] = r; });
  var totals = { qty: 0, gross: 0, paid: 0, unpaid: 0, review: 0, overpaid: 0, pending: 0, missingRate: 0 };
  function name(r) { var p = poMap[r.poId] || {}; return p.nama || r.poNama || ('PO ' + (p.noPO || r.poNoPO || r.poId || '-')); }
  (st.payroll || []).forEach(function (r) {
    if (r.pegawaiId !== worker.id || r.jenis !== worker.divisi || String(r.tanggal) < per.start || String(r.tanggal) > per.end) return;
    var id = String(r.earnedId || r.id || ''); if (!id || seen['$' + id]) return; seen['$' + id] = true;
    var rate = coreNum(r.rate), qty = Math.max(0, coreNum(r.total)), bad = !!r.needsReview || (r.issues || []).length > 0 || !(rate > 0);
    var paid = Math.min(qty, Math.max(0, coreNum(r.paidQty))), available = bad ? 0 : Math.min(qty - paid, Math.max(0, coreNum(r.available)));
    if (!(rate > 0)) totals.missingRate++;
    totals.overpaid += Math.max(0, coreNum(r.overpaidQty));
    if (bad) { totals.review++; review.push([coreSlipDate(r.tanggal), name(r) + ' · ' + (r.ref || (r.repairQcId ? 'Perbaikan' : 'Pekerjaan')), coreRibuan(qty) + ' pcs', (r.issues || []).join(' · ') || (r.overpaidQty ? 'Pembayaran melebihi hak setelah QC: ' + coreRibuan(r.overpaidQty) + ' pcs.' : 'Tarif atau bukti pekerjaan perlu diperiksa.')]); return; }
    totals.qty += qty; totals.gross += qty * rate; totals.paid += paid * rate; totals.unpaid += available * rate;
    if (available > 0) totals.pending++;
    /* Size lines may merge only within the same actual earning event. Repairs
       retain their own QC receipt even on the same date as the initial count. */
    var event = r.qcId || (r.repairQcId ? r.id : ''), key = sewing ? JSON.stringify([r.tanggal,r.sourceId,r.poId,rate,event,!!r.repairQcId]) : id;
    var g = groups[key];
    if (!g) { g = groups[key] = { tanggal:r.tanggal,poId:r.poId,title:name(r),sourceId:r.sourceId,ref:r.ref || '',repair:!!r.repairQcId,total:0,rate:rate,paid:0,available:0,ukuran:{} }; ordered.push(g); }
    g.total += qty; g.paid += paid; g.available += available;
    var sizes = coreMap(r.ukuran); Object.keys(sizes).forEach(function (size) { g.ukuran[size] = coreNum(g.ukuran[size]) + coreNum(sizes[size]); });
  });
  ordered.sort(function (a, b) { return String(a.tanggal).localeCompare(String(b.tanggal)) || String(a.title).localeCompare(String(b.title)) || String(a.ref).localeCompare(String(b.ref)); });
  var loans = coreKasbon(st.kasbon || []), repayments = [], deduction = 0, loanCount = 0, outstanding = 0;
  /* Sisa kasbon ditulis menurut keadaan pada akhir periode slip, supaya slip minggu lalu tidak ikut berubah oleh cicilan minggu ini. */
  loans.forEach(function (loan) {
    if (loan.jenis !== 'maklon' || loan.orangId !== worker.id || (loan.tanggal && String(loan.tanggal) > per.end)) return;
    var repaid = 0; loanCount++;
    loan.cicilan.forEach(function (r) {
      if (String(r.tanggal) <= per.end) repaid += r.jumlah;
      if (r.periode !== 'penyesuaian' && String(r.tanggal) >= per.start && String(r.tanggal) <= per.end) { deduction += r.jumlah; repayments.push([coreSlipDate(r.tanggal),r.keterangan || loan.keterangan || 'Cicilan kasbon',coreRupiah(r.jumlah)]); }
    });
    outstanding += Math.max(0, loan.jumlah - repaid);
  });
  var sections = [];
  if (repayments.length) sections.push({ title:'Rincian potongan kasbon periode ini',columns:[{label:'Tanggal'},{label:'Keterangan'},{label:'Jumlah',align:'right'}],rows:repayments });
  if (review.length) sections.push({ title:'Perlu ditinjau — tidak masuk jumlah tersedia untuk dibayar',columns:[{label:'Tanggal',width:15},{label:'Pekerjaan',width:35},{label:'Jumlah',width:12},{label:'Catatan',width:38}],rows:review });
  var materials = {}, materialByName = {};
  (st.stokRingkas || st.bahan || []).forEach(function (b) { materialByName[coreNormBahan(b.nama)] = b; });
  var rows = ordered.map(function (g) {
    var sizeText = coreSizeText(g.ukuran, settings.ukuran), details = g.title + (sizeText ? '\nUkuran: ' + sizeText : '');
    if (sewing) details += '\n' + (g.repair ? 'Perbaikan · ' : '') + (g.ref || 'Hitungan/QC');
    else {
      var raw = cutMap[g.sourceId], correction = raw && raw.historyCorrection;
      if (raw) {
        /* The same material taken from several rolls is one entry: its total and the number of rolls. */
        var merged = [], byMaterial = {};
        coreBahanPotong(raw).filter(function (b) { return b.qty > 0; }).forEach(function (b) { var key = coreNormBahan(b.nama), unit = (materialByName[key] || {}).satuan || 'kg'; materials[unit] = coreNum(materials[unit]) + b.qty; if (!byMaterial[key]) merged.push(byMaterial[key] = { nama: b.nama, unit: unit, qty: 0, n: 0 }); byMaterial[key].qty += b.qty; byMaterial[key].n++; });
        var materialText = merged.map(function (m) { return m.nama + ' ' + coreSlipNumber(m.qty) + ' ' + m.unit + (m.n > 1 ? ' (' + m.n + ' rol)' : ''); }).join(' + ');
        if (materialText) details += '\nBahan: ' + materialText;
        if (correction && correction.original) details += '\nFisik setelah koreksi ' + coreRibuan(raw.total) + ' pcs; dasar upah awal tetap ' + coreRibuan(g.total) + ' pcs.';
      }
    }
    return [coreSlipDate(g.tanggal),details,coreRibuan(g.total) + ' pcs',coreRupiah(g.rate),coreRupiah(g.total * g.rate)];
  });
  var summary = [{label:sewing ? 'Jumlah pekerjaan' : 'Jumlah potongan',value:coreRibuan(totals.qty) + ' pcs'}];
  if (!sewing && Object.keys(materials).length) summary.push({label:'Bahan terpakai',value:Object.keys(materials).map(function (u) { return coreSlipNumber(materials[u]) + ' ' + u; }).join(' + ')});
  summary.push({label:'Upah pekerjaan periode ini',value:coreRupiah(totals.gross)});
  summary.push({label:'Alokasi pekerjaan sudah dibayar',value:coreRupiah(totals.paid)});
  summary.push({label:'Tersedia untuk dibayar',value:coreRupiah(totals.unpaid),emphasis:true});
  /* Kasbon seperti di aplikasi lama: potongan minggu ini mengurangi upah, dan sisa kasbonnya selalu tertulis. */
  if (deduction) { summary.push({label:'Potongan kasbon periode ini',value:'− ' + coreRupiah(deduction)}); summary.push({label:'Upah bersih setelah potongan kasbon',value:coreRupiah(totals.gross - deduction),emphasis:true}); }
  if (outstanding > 0 || deduction) summary.push({label:'Sisa kasbon' + (deduction ? ' setelah potongan' : ' (belum dipotong periode ini)'),value:coreRupiah(outstanding)});
  if (totals.review) summary.push({label:'Catatan yang perlu ditinjau',value:coreRibuan(totals.review)});
  if (totals.overpaid) summary.push({label:'Pembayaran melebihi hak setelah QC',value:coreRibuan(totals.overpaid) + ' pcs'});
  var business = settings.kopSlip || settings.namaUsaha || 'SOLDIER APPAREL';
  return { model:{layout:'weekly-a4',title:'Slip Upah ' + (sewing ? 'Jahit' : 'Potong'),reference:(sewing ? 'JHT' : 'PTG') + ' / ' + start.replace(/-/g,'') + '-' + end.replace(/-/g,'') + ' / ' + String(worker.id).slice(0,8),recipient:worker.nama || '-',recipientLabel:sewing ? 'Nama penjahit' : 'Tukang potong',period:coreSlipDate(start) + ' — ' + coreSlipDate(end),
    columns:[{label:'Tanggal',width:13},{label:'Rincian pekerjaan',width:45},{label:'Jumlah',align:'right',width:11},{label:'Tarif / pcs',align:'right',width:13},{label:'Upah',align:'right',width:18}],rows:rows,summary:summary,sections:sections,signatures:[{label:'Disiapkan oleh',name:business},{label:'Penerima',name:worker.nama || '-'}]},
    n:ordered.length + review.length,belum:totals.pending,tanpaHarga:totals.missingRate,bersih:totals.gross - deduction,totalGross:totals.gross,paidAmount:totals.paid,unpaidAmount:totals.unpaid,reviewCount:totals.review,totalQty:totals.qty,potonganKasbon:deduction,sisaKasbon:outstanding,jumlahKasbon:loanCount };
}
function coreGajiSlipModel(state, employee, period) {
  var st = state || {}, per = corePeriode(period);
  if (!per || /^\d{4}-W/.test(String(period)) && coreMingguId(per.start) !== period) throw new Error('Periode gaji tidak valid.');
  coreSlipRange(per.start, per.end);
  var records = (st.gaji || []).filter(function (g) { return g.periode === period && g.karyawanId === employee.id; }), byDate = {}, salary = 0, overtime = 0, saturday = 0, hours = 0, saturdayHours = 0;
  records.forEach(function (g) { byDate[g.tanggal] = g; salary += coreNum(g.gaji); overtime += coreNum(g.lemburTotal); saturday += coreNum(g.sabtuTotal); hours += coreNum(g.lemburJam); saturdayHours += coreNum(g.sabtuJam); });
  var loans = coreKasbon(st.kasbon || []), repayments = [], deduction = 0, outstanding = 0, periods = {};
  /* cicilan dipotong di slip periode gajinya; lihat coreCicilanPeriode untuk cicilan yang nama periodenya berbeda */
  (st.gaji || []).forEach(function (g) { if (g.karyawanId === employee.id && g.periode) periods[g.periode] = 1; }); periods[period] = 1; periods = Object.keys(periods);
  loans.forEach(function (loan) { if (loan.jenis !== 'harian' || loan.orangId !== employee.id) return; outstanding += loan.sisa; var running = 0; loan.cicilan.forEach(function (r) { running += r.jumlah; if (coreCicilanPeriode(r, periods) !== period) return; deduction += r.jumlah; repayments.push([coreSlipDate(loan.tanggal),(loan.keterangan || 'Kasbon') + ' · Pinjaman ' + coreRupiah(loan.jumlah) + (r.keterangan ? ' · ' + r.keterangan : ''),'− ' + coreRupiah(r.jumlah),coreRupiah(Math.max(0,loan.jumlah-running))]); }); });
  var gross = salary + overtime + saturday, summary = [{label:'Total gaji harian',value:coreRupiah(salary)}];
  if (overtime > 0) summary.push({label:'Lembur biasa (' + hours + ' jam)',value:coreRupiah(overtime)});
  if (saturday > 0) summary.push({label:'Lembur Sabtu (' + saturdayHours + ' jam)',value:coreRupiah(saturday)});
  summary.push({label:'Pendapatan bruto',value:coreRupiah(gross)});
  if (deduction > 0) summary.push({label:'Potongan cicilan kasbon periode ini',value:'− ' + coreRupiah(deduction)});
  summary.push({label:'Total diterima',value:coreRupiah(gross-deduction),emphasis:true});
  if (deduction > 0 && outstanding > 0) summary.push({label:'Sisa kasbon aktif (informasi, tidak dipotong lagi)',value:coreRupiah(outstanding)});
  var weekdays = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'], labels = {full:'Full',half:'½ Hari',absent:'Absen',off:'Libur'};
  return {layout:'four-up',title:'Slip Gaji Mingguan',reference:'GAJI / ' + period + ' / ' + String(employee.id).slice(0,8),recipient:employee.nama || '-',recipientLabel:'Karyawan' + (employee.jabatan ? ' · ' + employee.jabatan : ''),period:coreSlipDate(per.start) + ' — ' + coreSlipDate(per.end),
    columns:[{label:'Hari / tanggal',width:35},{label:'Kehadiran',width:30},{label:'Gaji harian',align:'right',width:35}],
    rows:per.dates.map(function (date) { var g=byDate[date],status=g?g.status:coreHariKe(date)===0?'off':'full',amount=g?coreNum(g.gaji):0;return [weekdays[coreHariKe(date)]+' '+coreSlipDate(date),labels[status]||'—',amount>0?coreRupiah(amount):'—']; }),summary:summary,
    sections:repayments.length?[{title:'Rincian potongan kasbon periode ini',columns:[{label:'Tanggal kasbon',width:20},{label:'Keterangan',width:40},{label:'Cicilan',align:'right',width:20},{label:'Sisa setelah cicilan',align:'right',width:20}],rows:repayments}]:[],signatures:[{label:'Disiapkan oleh',name:(st.settings||{}).kopSlip || (st.settings||{}).namaUsaha || 'SOLDIER APPAREL'},{label:'Penerima',name:employee.nama || '-'}]};
}
function coreSlipModelsHtml(models, settings) {
  if (!(models instanceof Array) || !models.length) throw new Error('Pilih minimal satu slip.');
  settings = settings || {};
  function escape(v) { return String(v == null ? '' : v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}).replace(/\n/g,'<br>'); }
  /* a cell of several lines: the first line is its heading, the rest small detail below it */
  function cell(v) { var parts = String(v == null ? '' : v).split('\n'); return parts.length < 2 ? escape(parts[0]) : '<b>' + escape(parts[0]) + '</b><span class="sub">' + parts.slice(1).map(escape).join('<br>') + '</span>'; }
  function table(columns, rows) { return '<table class="detail"><thead><tr>'+columns.map(function(c){return '<th'+(c.width?' style="width:'+Math.max(1,Math.min(100,coreNum(c.width)))+'%"':'')+'>'+escape(c.label)+'</th>';}).join('')+'</tr></thead><tbody>'+rows.map(function(row){return '<tr>'+columns.map(function(c,i){return '<td style="text-align:'+(c.align==='right'?'right':c.align==='center'?'center':'left')+'">'+cell(row[i])+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table>'; }
  function article(m) { return '<article><header><b>'+escape(settings.kopSlip||settings.namaUsaha||'SOLDIER APPAREL')+'</b><small>'+escape(settings.kopSub||settings.alamat||'')+'</small></header><p class="reference">'+escape(m.reference)+'</p><h1>'+escape(m.title)+'</h1><table class="meta"><tr><td>'+escape(m.recipientLabel)+'<br><b>'+escape(m.recipient)+'</b></td><td>Periode<br><b>'+escape(m.period)+'</b></td></tr></table>'+table(m.columns,m.rows)+(m.sections||[]).map(function(s){return '<section><h2>'+escape(s.title)+'</h2>'+table(s.columns,s.rows)+'</section>';}).join('')+'<table class="summary">'+(m.summary||[]).map(function(s){return '<tr'+(s.emphasis?' class="emphasis"':'')+'><td>'+escape(s.label)+'</td><td>'+escape(s.value)+'</td></tr>';}).join('')+'</table><table class="signatures"><tr>'+(m.signatures||[]).map(function(s){return '<td>'+escape(s.label)+'<br><br><br><b>'+escape(s.name)+'</b></td>';}).join('')+'</tr></table></article>'; }
  var pages=[],group=[];
  function flush(){if(!group.length)return;var h='<table class="four"><tr>';group.forEach(function(m,i){if(i===2)h+='</tr><tr>';h+='<td>'+article(m)+'</td>';});if(group.length%2)h+='<td></td>';h+='</tr></table>';pages.push(h);group=[];}
  models.forEach(function(m){if(m.layout==='four-up'&&m.rows.length<=8&&!(m.sections||[]).some(function(s){return s.rows.length>2;})){group.push(m);if(group.length===4)flush();}else{flush();pages.push(article(m));}});flush();
  var css='@page{size:A4;margin:12mm}body{font:10pt Arial,Helvetica,sans-serif;color:#182638;margin:0}h1{font-size:17pt;border-bottom:2px solid #233b55;padding-bottom:8px}h2{font-size:10pt;margin-top:16px}header{border-bottom:1px solid #ddd;padding-bottom:8px}header b{font-size:13pt}small{display:block;font-size:8pt}.reference{font-size:8pt;color:#555}table{width:100%;border-collapse:collapse;table-layout:fixed}.meta{margin:12px 0}.meta td{padding:5px}.detail th{background:#233b55;color:white;text-align:left}.detail th,.detail td{padding:6px;border-bottom:1px solid #ddd;word-wrap:break-word}.detail td{vertical-align:top}.sub{display:block;font-size:8.5pt;line-height:1.3;color:#555;margin-top:1px}.detail thead{display:table-header-group}.detail tr{page-break-inside:avoid}.summary{width:75%;margin:16px 0 0 auto;page-break-inside:avoid}.summary td{padding:5px;border-bottom:1px solid #ddd}.summary td:last-child{text-align:right}.emphasis{font-weight:bold;background:#edf1f6}.signatures{margin-top:18px;page-break-inside:avoid}.signatures td{text-align:center}.page{page-break-after:always}.page:last-child{page-break-after:auto}.four>tbody>tr>td{width:50%;vertical-align:top;padding:4mm;border:1px dashed #bbb}.four article{font-size:7.5pt}.four h1{font-size:12pt}.four .detail th,.four .detail td{padding:3px}.four .summary{width:100%}.four .summary td{padding:3px}';
  return '<!doctype html><html><head><meta charset="utf-8"><style>'+css+'</style></head><body>'+pages.map(function(h){return '<div class="page">'+h+'</div>';}).join('')+'</body></html>';
}

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

/* Prepared materials reserve availability; only the linked Potong row consumes
   physical stock. The link is the authoritative use marker, requiring one write. */
function coreCutPlanRows(plans, cuts, poRows) {
  var used = {}, poIds = {};
  (poRows || []).forEach(function (r) { poIds[r.id] = true; });
  (cuts || []).forEach(function (r) { if (r.rencanaId) { if (!used[r.rencanaId]) used[r.rencanaId] = []; used[r.rencanaId].push(r); } });
  return (plans || []).map(function (r) {
    var out = {}; Object.keys(r).forEach(function (key) { out[key] = r[key]; });
    out.bahanList = coreParseJSON(r.bahanList, []);
    out.alokasiBahan = coreParseJSON(r.alokasiBahan, []);
    out.legacyBahanList = coreParseJSON(r.legacyBahanList, out.alokasiBahan.length ? [] : out.bahanList);
    out.legacyRol = Math.max(0,coreNum(r.rol)-out.alokasiBahan.length);
    out.poDraft = coreParseJSON(r.poDraft, null);
    var match = used[r.id] || [];
    out.status = match.length ? 'terpakai' : r.status;
    if (!match.length && r.status === 'siap' && out.poDraft && poRows && !poIds[r.poId]) out.status = 'menyiapkan';
    out.potongId = match.length ? match[0].id : '';
    out.userId = match.length ? match[0].userId : '';
    out.duplicateUse = match.length > 1;
    return out;
  });
}
function coreCutAvailability(cuts, stock, settings, plans, excludeId) {
  var reserved = {};
  coreCutPlanRows(plans, cuts).forEach(function (r) {
    if (r.id === excludeId || r.status !== 'siap') return;
    r.bahanList.forEach(function (b) { var key = coreNormBahan(b.nama); reserved[key] = coreNum(reserved[key]) + coreNum(b.qty); });
  });
  return coreStok(cuts, stock, settings).map(function (r) {
    r.dicadangkan = Math.round(coreNum(reserved[r.kunci]) * 1000) / 1000;
    r.tersedia = Math.round((r.saldo - r.dicadangkan) * 1000) / 1000;
    return r;
  });
}
function coreCutPlanNumber(value) {
  if (typeof value === 'number') return value;
  return typeof value === 'string' && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) ? Number(value) : NaN;
}
function coreCutPlanMaterials(list, stock) {
  if (!(list instanceof Array) || !list.length || list.length > 20) throw new Error('Pilih 1 sampai 20 bahan dari stok yang sudah ada.');
  var byName = {}, seen = {};
  (stock || []).forEach(function (r) { byName[r.kunci || coreNormBahan(r.nama)] = r; });
  return list.map(function (b) {
    b = b || {}; var key = coreNormBahan(b.nama), current = byName[key], qty = coreCutPlanNumber(b.qty);
    if (!current || current.sembunyi) throw new Error('Bahan ' + String(b.nama || '') + ' belum tersedia dalam daftar stok aktif.');
    if (seen[key]) throw new Error('Bahan yang sama cukup satu baris.'); seen[key] = true;
    if (!isFinite(qty) || !(qty > 0) || qty > 1e9 || Math.abs(qty * 1000 - Math.round(qty * 1000)) > 0.000001) throw new Error('Jumlah bahan harus lebih dari nol, maksimal 3 angka desimal.');
    if (b.satuan && b.satuan !== current.satuan) throw new Error('Satuan bahan mengikuti stok yang dipilih.');
    return { nama: current.nama, qty: Math.round(qty * 1000) / 1000, satuan: current.satuan };
  });
}
function coreCutCheckAvailable(list, availability) {
  var byName = {}, requested = {};
  (availability || []).forEach(function (r) { byName[r.kunci || coreNormBahan(r.nama)] = r; });
  (list || []).forEach(function (b) { var key = coreNormBahan(b.nama); requested[key] = coreNum(requested[key]) + coreNum(b.qty); });
  Object.keys(requested).forEach(function (key) {
    var row = byName[key];
    if (!row || requested[key] > coreNum(row.tersedia) + 0.000001) throw new Error('Bahan ' + (row ? row.nama : key) + ' melebihi stok yang tersedia setelah persiapan potong lainnya.');
  });
}
function coreCutPlanIntent(row) {
  var allocations = coreParseJSON(row.alokasiBahan,[]), materials = coreParseJSON(row.bahanList,[]);
  return JSON.stringify({ poId: String(row.poId || ''), bahanList: materials.map(function (b) { return { nama: String(b.nama), qty: coreNum(b.qty), satuan: String(b.satuan || '') }; }), alokasiBahan:allocations, legacyBahanList:coreParseJSON(row.legacyBahanList,allocations.length ? [] : materials), rol: coreNum(row.rol), catatan: String(row.catatan || ''), status: row.status || 'siap' });
}
/* Bulk replacements must preserve the authoritative use link and its source,
   including payroll snapshots. Reservations are never imported or recreated. */
function coreCutValidateReplacement(beforeCuts, afterCuts, plans, afterPO, beforePO) {
  var before = {}, after = {}, poIds = {}, beforePoIds = {}, planIds = {}, links = {};
  (beforePO || []).forEach(function (r) { beforePoIds[r.id] = true; });
  (beforeCuts || []).forEach(function (r) { before[r.id] = r; });
  (afterCuts || []).forEach(function (r) { after[r.id] = r; });
  (afterPO || []).forEach(function (r) { poIds[r.id] = r; });
  var useIds = {}; (beforeCuts || []).forEach(function (r) { if (r.rencanaId) useIds[r.rencanaId] = true; });
  (plans || []).forEach(function (r) {
    planIds[r.id] = r;
    if (!poIds[r.poId] && beforePO && !beforePoIds[r.poId] && coreParseJSON(r.poDraft,null) && !useIds[r.id]) return;
    if (!poIds[r.poId]) throw new Error('Persiapan potong masih menunjuk PO yang harus dipertahankan.');
    if (r.status === 'siap' && !useIds[r.id] && poIds[r.poId].status !== 'aktif') throw new Error('PO dengan persiapan potong yang belum dipakai harus tetap aktif. Batalkan persiapan terlebih dahulu.');
  });
  function same(a, b) {
    return SCHEMA.Potong.every(function (key) {
      var av = a[key], bv = b[key];
      if (av === undefined || av === null) av = TYPES[key] === 'num' ? 0 : '';
      if (bv === undefined || bv === null) bv = TYPES[key] === 'num' ? 0 : '';
      if (av && typeof av === 'object') av = JSON.stringify(av);
      if (bv && typeof bv === 'object') bv = JSON.stringify(bv);
      return String(av) === String(bv);
    });
  }
  Object.keys(before).forEach(function (id) {
    if (before[id].rencanaId && (!after[id] || !same(before[id], after[id]))) throw new Error('Hasil potong dari persiapan owner harus dipertahankan tanpa perubahan.');
  });
  (afterCuts || []).forEach(function (r) {
    if (!r.rencanaId) return;
    var plan = planIds[r.rencanaId];
    if (!before[r.id] || !same(before[r.id], r) || !plan || plan.poId !== r.poId || links[r.rencanaId]) throw new Error('Hubungan persiapan potong tidak sah atau dipakai lebih dari sekali.');
    links[r.rencanaId] = true;
  });
  return true;
}

/* Additive recovery of verified current-cycle cutting evidence. Pure preview:
   only PO metadata and new, capacity-checked reservations may be proposed.
   Production receipts, stock, payments and settlement ledgers are never rewritten. */
function coreLegacyCuttingCanonical(value) {
  if (value == null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  var pairs = Object.keys(value).sort().map(function (key) { return [key, coreLegacyCuttingCanonical(value[key])]; }).filter(function (pair) { return pair[1] !== 'null'; });
  return pairs.length ? '{' + pairs.map(function (pair) { return JSON.stringify(pair[0]) + ':' + pair[1]; }).join(',') + '}' : 'null';
}
/* The maintenance runner can embed this small allowlisted payload instead of
   an account backup. The same projection is always applied inside the planner. */
function coreLegacyCuttingInput(backup) {
  var root = backup && backup.soldier && typeof backup.soldier === 'object' ? backup.soldier : backup || {}, out = {}, production = root.produksi || {};
  function clean(value) {
    if (value == null || typeof value !== 'object') return value;
    if (value instanceof Array) return value.map(clean);
    var result = {}; Object.keys(value).forEach(function (key) { if (!/^(?:pin|token|password|secret|apiKey|authDomain|databaseURL|deviceInfo|images|_offlineGambar)$/i.test(key)) result[key] = clean(value[key]); }); return result;
  }
  out.produksi = {}; ['produksi','cuttingPlans','cuttingMaterialAdditions'].forEach(function (key) { if (production[key] !== undefined) out.produksi[key] = clean(production[key]); });
  if (root.produksi_meta) out.produksi_meta = coreLegacySourceInput(backup).produksi_meta;
  if (root.stokBahan) { out.stokBahan = {}; ['pembelian','adjustment','rolInfo','settings'].forEach(function (key) { if (root.stokBahan[key] !== undefined) out.stokBahan[key] = clean(root.stokBahan[key]); }); }
  ['soldier_deletedIds','produksi_deleted_ids'].forEach(function (key) { if (root[key] !== undefined) out[key] = clean(root[key]); });
  if (backup && backup._meta && backup._meta.ts) out._meta = {ts:backup._meta.ts};
  return out;
}
function coreLegacyCuttingFingerprint(current) {
  var out = {};
  ['PO','Potong','RencanaPotong','StokBahan','SlipKirim','SlipSetor','QC','Gudang','GudangLama','LegacySettlement','KoreksiRiwayat','SlipUpah','Produk','Pengaturan'].forEach(function (table) {
    out[table] = (current[table] || []).map(function (row) {
      var copy = {}; SCHEMA[table].forEach(function (key) { var value = row[key]; copy[key] = TYPES[key] === 'num' ? coreNum(value) : TYPES[key] === 'bool' ? value === true || /^(true|ya|1)$/i.test(String(value)) : value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value); }); return copy;
    }).sort(function (a,b) { return String(a.id || a.kunci || a.key || '').localeCompare(String(b.id || b.kunci || b.key || '')); });
  });
  return out;
}
function corePlanLegacyCutting(backup, current, originalBackup) {
  var hasOriginal = !!originalBackup;
  backup = coreLegacyCuttingInput(backup); originalBackup = coreLegacyCuttingInput(originalBackup);
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function list(value) { if (typeof value === 'string') value = coreParseJSON(value, []); return value instanceof Array ? value.filter(Boolean) : value && typeof value === 'object' ? Object.keys(value).sort(function (a,b) { return Number(a)-Number(b) || a.localeCompare(b); }).map(function (key) { return value[key]; }).filter(Boolean) : []; }
  function root(value) { return value && value.soldier && typeof value.soldier === 'object' ? value.soldier : value || {}; }
  function source(value) { var r = root(value), s = r.produksi || {}; return { produksi:s.produksi, cuttingPlans:s.cuttingPlans, cuttingMaterialAdditions:s.cuttingMaterialAdditions }; }
  function active(p) { return p && (p.poAktif === true || p.poAktif === 1 || p.poAktif === 'true'); }
  function cycle(p) { return coreLegacyCuttingCanonical([String(p.id),p._offlineOrderId || '',list(p.arsip).map(function (a) { return a.id != null ? String(a.id) : a; })]); }
  function map(rows) { var out = {}; rows.forEach(function (r) { if (out[r.id]) throw new Error('Identitas data sekarang tidak unik.'); out[r.id] = r; }); return out; }
  function problem(code, planId, poId) { review.push({code:code,sourcePlanId:planId || '',poId:poId || ''}); }
  var fingerprint = coreLegacyCuttingFingerprint(current || {}), beforeHash = coreLegacyHash(fingerprint);
  var latest = root(backup), original = root(originalBackup), latestSource = source(backup), sourceHash = coreReconcileSha256(coreLegacyCuttingCanonical(latestSource));
  var batchId = 'lc1_' + sourceHash.slice(0,24), issues = [], review = [], patches = [], rows = {};
  var summary = {poUpdated:0,pendingSizes:0,sourceReadyPlans:0,plansAdded:0,plansExisting:0,plansReview:0,sourceUsedPlans:0,sourceCancelledPlans:0,missingPO:0};
  function result(ready) { var value = {ready:ready,alreadyApplied:!!ready && !patches.length,sourceHash:sourceHash,beforeHash:beforeHash,batchId:batchId,rows:ready ? rows : {},patches:ready ? patches : [],summary:summary,issues:issues,review:review}; value.planHash = coreLegacyHash({sourceHash:sourceHash,beforeHash:beforeHash,batchId:batchId,rows:coreLegacyCuttingFingerprint(value.rows),patches:value.patches,issues:issues,review:review}); return value; }
  function stop(message) { issues.push(message); return result(false); }
  if (!hasOriginal || !latestSource.produksi || !source(originalBackup).produksi) return stop('Cadangan utama dan sumber rekonsiliasi sebelumnya wajib tersedia.');
  if (coreLegacyCuttingCanonical(latestSource) !== coreLegacyCuttingCanonical(source(originalBackup))) return stop('Produksi atau jatah sumber berubah; pemulihan tambahan ini hanya menerima bukti yang identik dengan sumber rekonsiliasi.');
  var deleted = list(latest.soldier_deletedIds || latest.produksi_deleted_ids).map(String).sort(), originalDeleted = list(original.produksi_deleted_ids || original.soldier_deletedIds).map(String).sort();
  if (JSON.stringify(deleted) !== JSON.stringify(originalDeleted)) return stop('Daftar penghapusan sumber berubah; perlu pemeriksaan terpisah.');
  var tombstones = {}; deleted.forEach(function (id) { tombstones[id] = true; });
  var baselineHash = coreLegacyHash(coreLegacySourceInput(originalBackup));
  var replay = convertBackupLegacyV1(originalBackup, {stamp:'1970-01-01'}), sourceProducts = list(latestSource.produksi), sourcePlans = list(latestSource.cuttingPlans);
  var bySku, byPO, currentCuts, currentPlans, currentStock;
  try { bySku = map(sourceProducts); byPO = map(current.PO || []); currentCuts = map(current.Potong || []); currentPlans = map(current.RencanaPotong || []); currentStock = map(current.StokBahan || []); map(sourcePlans); } catch (error) { return stop(error.message); }
  var replayCuts = map(replay.rows.Potong), grouped = {}, skuPO = {}, groups = {}, sameCut = true, missingParents = {};
  replay.lineage.cycles.forEach(function (link) { if (link.siklus === 'cur') skuPO[link.skuId] = link.poId; });
  /* Stable v1 cut IDs establish source ownership without rewriting any row. */
  Object.keys(replayCuts).forEach(function (id) {
    var before = replayCuts[id], live = currentCuts[id];
    if (!live || ['poId','userId','tanggal','total','kg','rol','tarif'].some(function (key) { return String(before[key] == null ? '' : before[key]) !== String(live[key] == null ? '' : live[key]); })) sameCut = false;
    if (live && coreLegacyHash(coreMap(before.ukuran)) !== coreLegacyHash(coreMap(live.ukuran))) sameCut = false;
    if (live && coreLegacyHash(coreBahanPotong(before)) !== coreLegacyHash(coreBahanPotong(live))) sameCut = false;
  });
  if (!sameCut) return stop('Bukti hasil potong sumber tidak cocok dengan catatan sekarang. Tidak ada riwayat yang akan diganti.');
  sourceProducts.forEach(function (p) {
    if (!active(p) || tombstones[String(p.id)]) return;
    var poId = skuPO[String(p.id)], live = byPO[poId];
    if (!live) { var missingKey = poId || JSON.stringify([p.series || '',p.namaBarang || '',p._offlineOrderId || '']); if (!missingParents[missingKey]) summary.missingPO++; missingParents[missingKey] = true; return; }
    /* An intentionally closed lower PO is not silently reopened. */
    if (live.status !== 'aktif') return;
    var origin = coreMap(live.imporSumber), reconciliation = origin.legacyReconciliation;
    if (!reconciliation || reconciliation.sourceHash !== baselineHash) { issues.push('PO sumber belum memiliki bukti rekonsiliasi yang cocok.'); return; }
    if (!grouped[poId]) grouped[poId] = [];
    grouped[poId].push({skuId:String(p.id),cycle:cycle(p),ukuran:String(p.size || '').trim().toUpperCase(),hadCutAtImport:list(p.potong).some(function (cut) { return Number(cut.jumlah) > 0; })});
  });
  if (issues.length) return result(false);
  var physical = typeof coreHistoryPhysicalRows === 'function' ? coreHistoryPhysicalRows('Potong', current.Potong || [], current.KoreksiRiwayat || []) : current.Potong || [];
  var totals = {}; physical.forEach(function (cut) { var sizes = coreMap(cut.ukuran), target = totals[cut.poId] = totals[cut.poId] || {}; Object.keys(sizes).forEach(function (size) { target[size] = coreNum(target[size]) + coreNum(sizes[size]); }); });
  Object.keys(grouped).sort().forEach(function (poId) {
    var sizes = grouped[poId].sort(function (a,b) { return a.ukuran.localeCompare(b.ukuran) || a.skuId.localeCompare(b.skuId); }), usedSizes = {}, invalid = false;
    sizes.forEach(function (s) { if (!s.ukuran || usedSizes[s.ukuran]) invalid = true; usedSizes[s.ukuran] = true; });
    if (invalid) { problem('ambiguous-current-size','',poId); return; }
    var old = coreMap(byPO[poId].imporSumber).legacyCutting;
    if (old && (old.snapshotHash !== sourceHash || old.batchId !== batchId || coreLegacyHash(old.sizes) !== coreLegacyHash(sizes) || !coreLegacyCuttingEvidence(byPO[poId]).valid)) { issues.push('Bukti jatah yang sudah tersimpan berasal dari sumber berbeda atau tidak sah.'); return; }
    groups[poId] = {version:1,snapshotHash:sourceHash,batchId:batchId,source:'verified-full-backup',sizes:sizes,plans:[]};
    sizes.forEach(function (s) { if (!(totals[poId] && totals[poId][s.ukuran] > 0)) summary.pendingSizes++; });
  });
  if (issues.length) return result(false);
  var settings = {}; (current.Pengaturan || []).forEach(function (r) { var k = r.kunci || r.key, value = r.nilai === undefined ? r.value : r.nilai; settings[k] = typeof value === 'string' ? coreParseJSON(value,value) : value; });
  var inventory = coreRollInventory(current.Potong || [],current.StokBahan || [],settings,current.RencanaPotong || []);
  var materialRemaining = {}, rollRemaining = {}; inventory.legacy.forEach(function (r) { materialRemaining[r.kunci] = r.tersedia; }); inventory.rolls.forEach(function (r) { rollRemaining[r.id] = r.tersedia; });
  var oldStock = original.stokBahan || {}, oldPurchases = {}, oldPurchaseReplay = map(replay.rows.StokBahan.filter(function (r) { return r.jenis === 'beli'; })), sourceUsed = {};
  list(oldStock.pembelian).forEach(function (r) { oldPurchases[String(r.id)] = r; });
  /* Only source cuts that survived exact v1 replay count as material evidence;
     archive mirrors therefore cannot consume the same source roll twice. */
  (replay.lineage.rows.Potong || []).forEach(function (trace) {
    var link = trace.source, p = bySku[link.skuId], c = p && (link.siklus === 'cur' ? p : list(p.arsip)[Number(String(link.siklus).slice(1))]), entry = c && list(c.potong)[link.index];
    if (!entry || settings.stokMulai && String(entry.tanggal || '') < settings.stokMulai) return;
    list(entry.rols).forEach(function (r) { var id = String(r.purchaseId || ''), qty = Number(r.kiloan == null ? r.kg : r.kiloan); if (id && isFinite(qty) && qty > 0) sourceUsed[id] = coreNum(sourceUsed[id]) + qty; });
  });
  /* Apply the source app's conservative roll-detail cap/FIFO debit to the
     current aggregate pool. Deleted roll-detail identities are not revived. */
  var sourceRemaining = {}, byMaterial = {};
  Object.keys(oldPurchases).forEach(function (id) { var purchase = oldPurchases[id], key = coreNormBahan(purchase.jenisBahan); (byMaterial[key] = byMaterial[key] || []).push(purchase); });
  Object.keys(byMaterial).forEach(function (key) {
    var purchases = byMaterial[key], infoKey = String(purchases[0].jenisBahan || '').trim().toLowerCase().replace(/[\/.#$\[\]]/g,'-'), info = oldStock.rolInfo && oldStock.rolInfo[infoKey], candidates = [];
    if (info) list(info instanceof Array ? info : info.rols).forEach(function (detail) { var linked = purchases.filter(function (p) { return p.rolInfoId != null && String(p.rolInfoId) === String(detail.id); }); if (linked.length === 1) candidates.push({purchase:linked[0],qty:Number(detail.val == null ? detail.kg : detail.val),note:detail.note || ''}); });
    else purchases.filter(function (p) { return !p.rolInfoId; }).forEach(function (p) { candidates.push({purchase:p,qty:Number(p.kg),note:''}); });
    candidates.forEach(function (candidate) { var p = candidate.purchase; candidate.qty = Math.max(0,Math.min(isFinite(candidate.qty) ? candidate.qty : 0,coreNum(p.kg)-coreNum(sourceUsed[p.id]))); candidate.date = p.tanggal || '9999-12-31'; });
    candidates.sort(function (a,b) { return a.date.localeCompare(b.date); });
    var aggregate = inventory.legacyMap[key], debit = Math.max(0,candidates.reduce(function (sum,c) { return sum+c.qty; },0)-Math.max(0,aggregate ? aggregate.saldo : 0));
    candidates.forEach(function (candidate) { var take = Math.min(candidate.qty,debit); debit -= take; sourceRemaining[String(candidate.purchase.id)] = Math.max(0,candidate.qty-take); });
  });
  var newPlans = [], sourceReserved = {};
  /* A repeat preview must account for reservations admitted by its earlier
     application before considering any other source plan, regardless of order.
     Prior review holds are never released automatically by this maintenance. */
  var countedReservations = {}, usedPlanIds = {};
  (current.Potong || []).forEach(function (r) { if (r.rencanaId) usedPlanIds[r.rencanaId] = true; });
  Object.keys(groups).forEach(function (poId) {
    var prior = coreMap(byPO[poId].imporSumber).legacyCutting;
    list(prior && prior.plans).forEach(function (evidence) {
      var plan = currentPlans[evidence.rencanaId];
      if (!plan || countedReservations[plan.id] || plan.poId !== poId || plan.status !== 'siap' || usedPlanIds[plan.id]) return;
      countedReservations[plan.id] = true;
      list(evidence.rolls).forEach(function (roll) { sourceReserved[roll.purchaseId] = coreNum(sourceReserved[roll.purchaseId])+coreNum(roll.qty); });
    });
  });
  sourcePlans.sort(function (a,b) { return String(a.id).localeCompare(String(b.id)); }).forEach(function (plan) {
    if (plan.status === 'ready') summary.sourceReadyPlans++; else if (plan.status === 'used') summary.sourceUsedPlans++; else if (plan.status === 'cancelled') summary.sourceCancelledPlans++;
    var refs = list(plan.products), parents = {}, valid = !!refs.length;
    refs.forEach(function (ref) { var p = bySku[String(ref.id)], poId = skuPO[String(ref.id)]; if (!p || !active(p) || tombstones[String(ref.id)] || cycle(p) !== ref.cycle || !groups[poId]) valid = false; if (poId) parents[poId] = true; });
    var poIds = Object.keys(parents), poId = poIds.length === 1 ? poIds[0] : '', evidence = {sourcePlanId:String(plan.id),status:String(plan.status || ''),rencanaId:'',ukuran:refs.map(function (ref) { return String((bySku[String(ref.id)] || {}).size || '').trim().toUpperCase(); }).sort(),reviewCode:'',rolls:list(plan.rolls).map(function (r) { return {purchaseId:String(r.purchaseId || ''),jenis:String(r.jenis || ''),unit:r.unit || 'kg',qty:coreNum(r.kg),rolNum:String(r.rolNum || '')}; })};
    poIds.forEach(function (id) { if (groups[id]) groups[id].plans.push(evidence); });
    if (plan.status !== 'ready') return;
    function hold(code) { evidence.reviewCode = code; summary.plansReview++; problem(code,String(plan.id),poId); }
    if (!valid || !poId) { hold('source-cycle-or-parent'); return; }
    var planId = 'lcplan_' + coreHash(sourceHash + '|' + String(plan.id)), existing = currentPlans[planId], priorEvidence = coreMap(byPO[poId].imporSumber).legacyCutting;
    var prior = priorEvidence && list(priorEvidence.plans).filter(function (p) { return p.sourcePlanId === String(plan.id); })[0];
    if (prior && prior.reviewCode && !prior.rencanaId) { hold(prior.reviewCode); return; }
    if (existing) {
      if (!prior || prior.rencanaId !== planId || existing.poId !== poId) { hold('plan-id-conflict'); return; }
      evidence.rencanaId = planId; summary.plansExisting++; return;
    }
    if (prior && prior.rencanaId) { hold('previous-plan-missing'); return; }
    if (byPO[poId].imporReview || coreMap(byPO[poId].imporSumber).legacyReconciliation.mode === 'review') { hold('po-review'); return; }
    if (refs.some(function (ref) { var p = bySku[String(ref.id)], size = String(p.size || '').trim().toUpperCase(); return list(p.potong).some(function (r) { return Number(r.jumlah) > 0; }) || totals[poId] && totals[poId][size] > 0; }) || list(plan.completedProductIds).length || list(plan.consumedRolls).length || plan.usedAt || plan.usedBatchId) { hold('already-cut-or-used'); return; }
    if (String(plan.stockBaseline || '') !== String(settings.stokMulai || '')) { hold('stock-baseline-changed'); return; }
    var allocations = [], legacy = {}, combined = {}, reserve = [], failed = '';
    if (!evidence.rolls.length) { hold('missing-rolls'); return; }
    var seen = {};
    evidence.rolls.forEach(function (r) {
      var stock = currentStock[r.purchaseId], originalRow = oldPurchaseReplay[r.purchaseId], key = coreNormBahan(r.jenis), material = inventory.legacyMap[key], qty = r.qty;
      if (seen[r.purchaseId] || !stock || !originalRow || !oldPurchases[r.purchaseId]) { failed = 'missing-purchase-proof'; return; } seen[r.purchaseId] = true;
      if (stock.jenis !== 'beli' || coreNormBahan(stock.bahan) !== key || stock.satuan !== r.unit || ['jenis','tanggal','bahan','qty','satuan','invoice'].some(function (k) { return String(stock[k] == null ? '' : stock[k]) !== String(originalRow[k] == null ? '' : originalRow[k]); })) { failed = 'purchase-changed'; return; }
      if (!(qty > 0) || !isFinite(qty) || qty > 1e8 || Math.abs(qty*1000-Math.round(qty*1000)) > 0.000001 || !material || material.sembunyi) { failed = 'invalid-material-quantity'; return; }
      if (qty > coreNum(sourceRemaining[r.purchaseId])-coreNum(sourceReserved[r.purchaseId])+0.000001) { failed = 'source-roll-insufficient'; return; }
      if (stock.stockMode === 'roll') { var roll = inventory.byId[stock.id]; if (!roll || roll.status === 'periksa' || qty > coreNum(rollRemaining[stock.id])+0.000001) { failed = 'current-roll-insufficient'; return; } allocations.push({stokId:stock.id,qty:qty}); }
      else legacy[key] = coreNum(legacy[key])+qty;
      if (!combined[key]) combined[key] = {nama:stock.bahan,qty:0,satuan:stock.satuan}; combined[key].qty += qty; reserve.push({id:r.purchaseId,qty:qty});
    });
    Object.keys(legacy).forEach(function (key) { if (legacy[key] > coreNum(materialRemaining[key])+0.000001) failed = 'current-material-insufficient'; });
    if (failed) { hold(failed); return; }
    if (refs.length > 1) { hold('multi-size-plan-needs-batch-review'); return; }
    var materials = Object.keys(combined).sort().map(function (key) { var r = combined[key]; r.qty = Math.round(r.qty*1000)/1000; return r; }), legacyList = Object.keys(legacy).sort().map(function (key) { return {nama:combined[key].nama,qty:Math.round(legacy[key]*1000)/1000,satuan:combined[key].satuan}; });
    if (materials.length > 20 || evidence.rolls.length > 200) { hold('too-many-materials'); return; }
    reserve.forEach(function (r) { sourceReserved[r.id] = coreNum(sourceReserved[r.id])+r.qty; }); Object.keys(legacy).forEach(function (key) { materialRemaining[key] -= legacy[key]; }); allocations.forEach(function (a) { rollRemaining[a.stokId] -= a.qty; });
    var made = {id:planId,poId:poId,bahanList:JSON.stringify(materials),rol:evidence.rolls.length,catatan:'Jatah sumber terverifikasi; '+String(plan.note || '').slice(0,240),status:'siap',dibuat:String(plan.createdAt || ''),dibuatOleh:'',diubah:String(plan.createdAt || ''),revision:coreHash(sourceHash+'|'+String(plan.id)+'|'+JSON.stringify(materials)),alokasiBahan:allocations.length ? JSON.stringify(allocations) : '',poDraft:'',legacyBahanList:JSON.stringify(legacyList)};
    newPlans.push(made); evidence.rencanaId = planId; summary.plansAdded++;
  });
  rows.PO = (current.PO || []).map(function (po) {
    var evidence = groups[po.id]; if (!evidence) return clone(po);
    evidence.plans.sort(function (a,b) { return a.sourcePlanId.localeCompare(b.sourcePlanId); });
    evidence.proofHash = coreLegacyHash({poId:po.id,snapshotHash:sourceHash,batchId:batchId,sizes:evidence.sizes,plans:evidence.plans});
    var origin = clone(coreMap(po.imporSumber)); if (origin.legacyCutting && coreLegacyHash(origin.legacyCutting) === coreLegacyHash(evidence)) return clone(po);
    origin.legacyCutting = evidence; var after = clone(po); after.imporSumber = JSON.stringify(origin); if (evidence.sizes.some(function (s) { return !(totals[po.id] && totals[po.id][s.ukuran] > 0); })) after.tuntasPada = '';
    patches.push({sheet:'PO',id:po.id,changes:{imporSumber:after.imporSumber,tuntasPada:after.tuntasPada || ''}}); summary.poUpdated++; return after;
  });
  rows.RencanaPotong = clone(current.RencanaPotong || []).concat(newPlans);
  newPlans.forEach(function (plan) { patches.push({sheet:'RencanaPotong',id:plan.id,append:clone(plan)}); });
  return result(true);
}

/* Pure commerce costing. Legacy algorithms copied from soldierapparel-app
   f80e7f6c6a63f29d486f9cfce73b563ee3364bc7; no network, store, or mutations. */
var coreCommerceLegacyCost=(function(){var module={exports:{}};
/* Read-only, model-level costing. This module never rewrites production or legacy HPP data. */
(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HppModelCost=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function rows(v){return (Array.isArray(v)?v:v&&typeof v==='object'?Object.values(v):[]).filter(x=>x&&typeof x==='object'&&!Array.isArray(x));}
  function norm(v){var s=String(v==null?'':v).trim();return (s.normalize?s.normalize('NFKC'):s).replace(/\s+/g,' ').toLowerCase();}
  function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
  function stable(v){return v&&typeof v==='object'?(Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}'):JSON.stringify(v);}
  function flag(v){return v===true||v===1||v==='true';}
  function ignored(v){return flag(v.deleted)||flag(v.isDeleted)||!!v.deletedAt||flag(v.cancelled)||flag(v.canceled)||!!v.cancelledAt||!!v.canceledAt||flag(v.void)||flag(v.voided)||!!v.voidedAt||/^(deleted|cancelled|canceled|dihapus|dibatalkan|batal|void|voided)$/.test(norm(v.status));}
  function number(v){if(v==null||typeof v==='boolean'||String(v).trim()==='')return null;var n=Number(v);return Number.isFinite(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER?n:null;}
  function warn(out,text){if(!out.includes(text))out.push(text);}
  function unit(v){var n=norm(v);return {kg:'kg',kilogram:'kg',yd:'yard',yard:'yard',yards:'yard',m:'meter',meter:'meter',metre:'meter'}[n]||null;}
  function legacyId(p){return p.id!=null?String(p.id):(p.series||'')+'_'+(p.namaBarang||'')+'_'+(p.size||'');}
  // URL-safe UTF-8 base64, without browser/Node dependencies or hash collisions.
  function modelId(series,name){var raw=encodeURIComponent(JSON.stringify([norm(series),norm(name)])),bytes=[],abc='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',out='model_';for(var i=0;i<raw.length;i++){if(raw[i]==='%'){bytes.push(parseInt(raw.slice(i+1,i+3),16));i+=2;}else bytes.push(raw.charCodeAt(i));}for(var j=0;j<bytes.length;j+=3){var a=bytes[j],b=bytes[j+1],c=bytes[j+2];out+=abc[a>>2]+abc[((a&3)<<4)|((b||0)>>4)];if(b!==undefined)out+=abc[((b&15)<<2)|((c||0)>>6)];if(c!==undefined)out+=abc[c&63];}return out;}
  function materialRows(e){if(rows(e.bahanList).length)return rows(e.bahanList);return e.jenisBahan?[{jenis:e.jenisBahan,kg:e.kiloan,unit:e.unit}]:[];}
  function cycles(p){return [{source:'current',value:p}].concat(rows(p.arsip).filter(a=>!ignored(a)).map((a,i)=>({source:'archive:'+i,value:a})));}
  function costSignature(e,field){if(field!=='potong')return stable(e);return stable({tanggal:e.tanggal,jumlah:e.jumlah,tukangId:e.tukangId,cuttingPlanId:e.cuttingPlanId,materialBatchId:e.materialBatchId,materialAllocation:e.materialAllocation,bahan:materialRows(e),rols:rows(e.rols)});}
  function ledger(members,field,warnings,signature){
    var out=[],globalIds=new Map();
    members.forEach(p=>{
      var seen=new Map(),fingerprints=new Map(),history=cycles(p),tombstones=new Set();
      history.forEach(c=>rows(c.value[field]).forEach(e=>{if(ignored(e)&&e.id!=null)tombstones.add(String(e.id));}));
      history.forEach(c=>{
        var source=c.value[field];
        if(source!=null&&(typeof source!=='object'||(Array.isArray(source)?source:Object.values(source)).some(e=>e!=null&&(typeof e!=='object'||Array.isArray(e)))))warn(warnings,'Ada rincian '+field+' yang tidak terbaca lengkap.');
        rows(source).filter(e=>!ignored(e)&&!(e.id!=null&&tombstones.has(String(e.id)))).forEach(e=>{
          var id=e.id!=null&&String(e.id)!==''?String(e.id):'',sig=(signature||costSignature)(e,field),prev=id&&seen.get(id);
          if(prev){if(prev.sig!==sig)warn(warnings,'Ada catatan '+field+' dengan identitas sama tetapi isi berbeda; periksa Laporan Produksi.');return;}
          if(id){seen.set(id,{sig});var owner=globalIds.get(id);if(owner&&owner!==p)warn(warnings,'Identitas catatan '+field+' dipakai pada lebih dari satu ukuran.');globalIds.set(id,p);}
          var fp=fingerprints.get(sig);
          if(fp&&fp.source!==c.source&&(!id||!fp.id))warn(warnings,'Riwayat '+field+' lama mungkin tersalin di arsip tanpa identitas; belum dapat dipastikan.');
          fingerprints.set(sig,{source:c.source,id});out.push({entry:e,product:p,archived:c.source!=='current'});
        });
      });
    });
    return out;
  }
  function groupProducts(input,options){options=options||{};var list=rows(input&&input.produksi?input.produksi:input),plans=rows(options.cuttingPlans||(input&&!Array.isArray(input)&&input.cuttingPlans)),groups=new Map(),ids=new Map();list.filter(p=>!ignored(p)).forEach(p=>{var id=modelId(p.series,p.namaBarang);if(!groups.has(id))groups.set(id,{id,series:String(p.series||'').trim(),namaBarang:String(p.namaBarang||'').trim(),sizes:[],members:[],potong:[],warnings:[],cuttingPlans:plans,plansKnown:options.plansKnown===true||Object.prototype.hasOwnProperty.call(options,'cuttingPlans')||!!(input&&!Array.isArray(input)&&Object.prototype.hasOwnProperty.call(input,'cuttingPlans'))});var m=groups.get(id);m.members.push(p);if(p.size!=null&&!m.sizes.includes(String(p.size)))m.sizes.push(String(p.size));if(p.id!=null){var old=ids.get(String(p.id));if(old)warn(m.warnings,'Identitas produk ganda; periksa daftar produksi.');ids.set(String(p.id),p);}if(!norm(p.namaBarang))warn(m.warnings,'Nama model belum tersedia.');});groups.forEach(m=>{m.ledger=ledger(m.members,'potong',m.warnings);m.potong=m.ledger.map(x=>x.entry);m.sizes.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));var offline=new Map();m.ledger.forEach(x=>{var p=x.product,e=x.entry;if(!p._offlineOrderId||e.materialBatchId)return;var fp=stable([p._offlineOrderId,e.tanggal,e.tukangId,materialRows(e)]);if(!offline.has(fp))offline.set(fp,new Set());offline.get(fp).add(p);});if([...offline.values()].some(set=>set.size>1))warn(m.warnings,'Bahan pada potongan offline lama mungkin disalin ke beberapa ukuran.');});return [...groups.values()].sort((a,b)=>(a.series+' '+a.namaBarang).localeCompare(b.series+' '+b.namaBarang));}
  function stockUnit(stock,name){var key=String(name||'').trim().toLowerCase().replace(/[\/.#$\[\]]/g,'-'),info=stock.rolInfo&&stock.rolInfo[key];return info&&!Array.isArray(info)&&info.unit?(unit(info.unit)||'invalid'):null;}
  function selectedPlanCheck(plan,cuts,warnings,inferUnit){
    var actual=new Map(),positive=[],empty=[],epsilon=0.00001;
    function invalid(text){warn(warnings,text||'Rincian pemakaian bahan per hasil belum cocok dengan jatah; periksa Laporan Produksi.');}
    function readable(value){return value==null||typeof value==='object'&&(Array.isArray(value)?value:Object.values(value)).every(v=>v==null||typeof v==='object'&&!Array.isArray(v));}
    function rollMap(value,receipt){
      var out=new Map();if(!readable(value))invalid();
      rows(value).forEach(r=>{
        var id=String(r.purchaseId==null?'':r.purchaseId).trim(),name=norm(r.jenis||r.jenisBahan),u=inferUnit(r.unit,r.jenis||r.jenisBahan),q=number(receipt&&r.kiloan!=null?r.kiloan:r.kg);
        if(!id||!name||!u||q===null||q<=0||ignored(r)||out.has(id)){invalid();return;}
        if(receipt&&r.kg!=null&&r.kiloan!=null&&(number(r.kg)===null||Math.abs(Number(r.kg)-q)>epsilon))invalid();
        out.set(id,{name,unit:u,qty:q});
      });return out;
    }
    function equal(a,b){return a.size===b.size&&[...a].every(([key,v])=>{var other=b.get(key);return other&&other.name===v.name&&other.unit===v.unit&&Math.abs(other.qty-v.qty)<=epsilon;});}
    var assigned=rollMap(plan.rolls,false),consumed=rollMap(plan.consumedRolls,false);
    if(!assigned.size||!consumed.size)invalid('Pemakaian bahan untuk hasil potong ini belum ditemukan.');
    cuts.forEach(e=>{
      if(e.materialAllocation!=='owner-plan-selected-rolls'||!String(e.materialBatchId||'').trim())invalid('Identitas pemakaian bahan per hasil tidak sesuai.');
      var current=rollMap(e.rols,true),byMaterial=new Map(),listed=new Map();
      current.forEach((r,id)=>{
        var owner=assigned.get(id),previous=actual.get(id),key=r.name+'|'+r.unit;
        if(!owner||owner.name!==r.name||owner.unit!==r.unit)invalid('Rol atau satuan bahan hasil potong tidak sesuai jatah.');
        if(previous&&(previous.name!==r.name||previous.unit!==r.unit))invalid();
        actual.set(id,{name:r.name,unit:r.unit,qty:r.qty+(previous?previous.qty:0)});
        byMaterial.set(key,(byMaterial.get(key)||0)+r.qty);
      });
      if(!readable(e.bahanList))invalid();
      materialRows(e).forEach(b=>{
        var q=number(b.kg),name=norm(b.jenis),u=inferUnit(b.unit,b.jenis);
        if(q===null||!name||!u||ignored(b)){invalid();return;}
        if(q>0){var key=name+'|'+u;listed.set(key,(listed.get(key)||0)+q);}
      });
      if(byMaterial.size!==listed.size||[...byMaterial].some(([key,q])=>Math.abs(q-(listed.get(key)||0))>epsilon))invalid('Rincian rol tidak cocok dengan jumlah bahan pada hasil potong.');
      if(e.kiloan!=null){var kg=number(e.kiloan),totalKg=[...current.values()].reduce((n,r)=>n+(r.unit==='kg'?r.qty:0),0);if(kg===null||Math.abs(kg-totalKg)>epsilon)invalid('Jumlah kilogram hasil potong tidak cocok dengan rincian rol.');}
      if(current.size)positive.push(e);else empty.push(e);
    });
    if(!equal(actual,consumed))invalid('Jumlah bahan tercatat berbeda dari pemakaian jatah per hasil.');
    consumed.forEach((r,id)=>{var owner=assigned.get(id);if(!owner||owner.name!==r.name||owner.unit!==r.unit||r.qty>owner.qty+epsilon)invalid('Pemakaian bahan melebihi atau berbeda dari jatah pemotongan.');});
    empty.forEach(e=>{
      // CuttingPlan enforces save order. Result dates can legitimately be
      // backdated, so costing only checks for a different positive batch.
      if(!positive.some(first=>first.materialBatchId!==e.materialBatchId))invalid('Pemakaian bahan pertama untuk potongan susulan belum ditemukan.');
    });
  }
  function fabric(model,purchasesOrStock){var stock=Array.isArray(purchasesOrStock)?{pembelian:purchasesOrStock}:purchasesOrStock||{},purchases=rows(stock.pembelian).filter(p=>!ignored(p)),warnings=(model.warnings||[]).slice(),detailsMap=new Map(),totalPcs=0,totalCost=0,totalKg=0,plans=new Map(),entries=model.ledger||ledger(model.members||[model],'potong',warnings);
    function inferUnit(raw,name){if(raw!=null&&String(raw).trim())return unit(raw);var declared=stockUnit(stock,name);if(declared)return declared==='invalid'?null:declared;var candidates=new Set(purchases.filter(p=>norm(p.jenisBahan)===norm(name)&&p.unit).map(p=>unit(p.unit)));if(candidates.has(null))return null;if(candidates.size===1)return [...candidates][0];if(candidates.size>1)return null;return 'kg';}
    function purchaseUnit(p){return p.unit?unit(p.unit):stockUnit(stock,p.jenisBahan)||'kg';}
    function price(p){var q=number(p.kg),r=number(p.hargaPerKg),t=number(p.total);if(q===null||q<=0)return null;if(r!==null&&r>0){if(t!==null&&Math.abs(t-q*r)>Math.max(1,q*r*0.000001))return null;return r;}return t!==null&&t>0?t/q:null;}
    function add(name,u,qty,rate,source){if(!(qty>0))return;var key=norm(name)+'|'+u,d=detailsMap.get(key);if(!d){d={jenis:name,unit:u,qty:0,kg:0,avgHarga:0,totalCost:0,priceSources:[]};detailsMap.set(key,d);}d.qty+=qty;d.kg=d.qty;if(rate!==null){d.totalCost+=qty*rate;totalCost+=qty*rate;}if(!d.priceSources.includes(source))d.priceSources.push(source);if(u==='kg')totalKg+=qty;}
    // Validate all rolls, including ones omitted by an old bahanList. Costing
    // only matching materials must not hide an unnamed or additional roll.
    entries.forEach(({entry:e})=>{
      if(e.materialAllocation==='owner-plan-recorded-earlier')return;
      var materials=materialRows(e).filter(b=>!ignored(b)),rolls=rows(e.rols).filter(r=>!ignored(r)),listed=new Map(),actual=new Map();
      function readable(v){return v==null||typeof v==='object'&&(Array.isArray(v)?v:Object.values(v)).every(x=>x==null||typeof x==='object'&&!Array.isArray(x));}
      if(!readable(e.bahanList)||!readable(e.rols))warn(warnings,'Ada rincian bahan atau rol yang tidak terbaca lengkap.');
      materials.forEach(b=>{
        var u=inferUnit(b.unit,b.jenis),q=number(b.kg),name=norm(b.jenis);
        if(!u)warn(warnings,'Satuan bahan belum valid atau tidak dapat dipastikan.');
        if(name&&u&&q!==null&&q>0){var key=name+'|'+u;listed.set(key,(listed.get(key)||0)+q);}
        if(name&&u&&!rolls.some(r=>norm(r.jenis||r.jenisBahan)===name&&r.purchaseId!=null)){
          var found=purchases.filter(p=>norm(p.jenisBahan)===name&&purchaseUnit(p)===u);
          if(!found.length||found.some(p=>price(p)===null))warn(warnings,'Harga pembelian '+String(b.jenis).trim()+' ('+u+') belum lengkap.');
        }
      });
      rolls.forEach(r=>{
        var name=String(r.jenis||r.jenisBahan||'').trim(),u=inferUnit(r.unit,name),q=number(r.kiloan==null?r.kg:r.kiloan);
        if(!name||q===null||q<=0)warn(warnings,'Ada rol tanpa nama atau jumlah bahan yang valid.');
        if(!u)warn(warnings,'Satuan rol belum valid atau tidak dapat dipastikan.');
        if(r.kg!=null&&r.kiloan!=null&&(number(r.kg)===null||number(r.kiloan)===null||Math.abs(Number(r.kg)-Number(r.kiloan))>0.00001))warn(warnings,'Rincian jumlah rol belum konsisten.');
        // A malformed material row must not hide an unresolved purchase link.
        // Validate identity and price before returning for its name/quantity.
        if(r.purchaseId!=null){
          var found=purchases.filter(p=>String(p.id)===String(r.purchaseId)),p=found[0];
          if(found.length!==1||!name||!u||norm(p.jenisBahan)!==norm(name)||purchaseUnit(p)!==u||price(p)===null)warn(warnings,'Harga atau satuan rol '+(name||'tanpa nama')+' belum dapat dicocokkan dengan pembelian.');
        }
        if(!name||!u||q===null||q<=0)return;
        var key=norm(name)+'|'+u;actual.set(key,(actual.get(key)||0)+q);
        // Check prices even when a material mismatch would otherwise return
        // early. A missing price is never an exclusion reason for reference.
        if(r.purchaseId==null&&!listed.has(key)){
          var matching=purchases.filter(p=>norm(p.jenisBahan)===norm(name)&&purchaseUnit(p)===u);
          if(!matching.length||matching.some(p=>price(p)===null))warn(warnings,'Harga pembelian '+name+' ('+u+') belum lengkap.');
        }
      });
      if(rolls.length&&(actual.size!==listed.size||[...actual].some(([key,q])=>Math.abs(q-(listed.get(key)||0))>0.00001)))warn(warnings,'Rincian rol tidak cocok dengan jumlah bahan.');
    });
    entries.forEach(({entry:e})=>{var qty=number(e.jumlah);if(qty===null||!Number.isSafeInteger(qty)||qty<=0){warn(warnings,'Ada jumlah hasil potong yang belum valid.');return;}totalPcs+=qty;if(e.cuttingPlanId){var k=String(e.cuttingPlanId);if(!plans.has(k))plans.set(k,[]);plans.get(k).push(e);}if(e.materialAllocation==='owner-plan-recorded-earlier'){if(materialRows(e).some(b=>Number(b.kg)>0)||rows(e.rols).some(r=>Number(r.kiloan==null?r.kg:r.kiloan)>0))warn(warnings,'Potongan susulan masih memiliki bahan; pemakaian perlu diperiksa.');return;}var materials=materialRows(e).filter(b=>!ignored(b));if(e.materialAllocation==='owner-plan-selected-rolls'&&!e.cuttingPlanId)warn(warnings,'Identitas jatah untuk pemakaian bahan per hasil belum tersedia.');if(e.materialAllocation==='owner-plan-selected-rolls'&&!materials.some(b=>Number(b.kg)>0)&&!rows(e.rols).some(r=>Number(r.kiloan==null?r.kg:r.kiloan)>0))return;if(!materials.length){warn(warnings,'Ada hasil potong tanpa rincian bahan.');return;}var rolls=rows(e.rols).filter(r=>!ignored(r));materials.forEach(b=>{var q=number(b.kg),u=inferUnit(b.unit,b.jenis),name=String(b.jenis||'').trim();if(!name||q===null||q<=0||!u){warn(warnings,'Nama, jumlah, atau satuan bahan belum valid.');return;}var matching=rolls.filter(r=>norm(r.jenis||r.jenisBahan||'')===norm(name));var withLinks=matching.filter(r=>r.purchaseId!=null);if(withLinks.length){var total=matching.reduce((n,r)=>n+(number(r.kiloan==null?r.kg:r.kiloan)||0),0);var matchingMaterialQty=materials.filter(other=>norm(other.jenis)===norm(name)&&(inferUnit(other.unit,other.jenis)===u)).reduce((n,other)=>n+(number(other.kg)||0),0);if(materials.indexOf(b)!==materials.findIndex(other=>norm(other.jenis)===norm(name)&&inferUnit(other.unit,other.jenis)===u))return;if(Math.abs(total-matchingMaterialQty)>0.00001||withLinks.length!==matching.length){warn(warnings,'Rincian rol tidak cocok dengan jumlah bahan '+name+'.');add(name,u,matchingMaterialQty,null,'belum-lengkap');return;}matching.forEach(r=>{var rq=number(r.kiloan==null?r.kg:r.kiloan),ru=inferUnit(r.unit,name),found=purchases.filter(p=>String(p.id)===String(r.purchaseId));var p=found[0],rate=found.length===1?price(p):null;if(!p||found.length!==1||norm(p.jenisBahan)!==norm(name)||purchaseUnit(p)!==u||ru!==u||rq===null||rate===null){warn(warnings,'Harga atau satuan rol '+name+' belum dapat dicocokkan dengan pembelian.');rate=null;}add(name,u,rq||0,rate,'rol-pembelian');});}else{var found=purchases.filter(p=>norm(p.jenisBahan)===norm(name)&&purchaseUnit(p)===u),pq=0,pc=0,invalid=false;found.forEach(p=>{var pr=price(p),amount=number(p.kg);if(pr===null||amount===null){invalid=true;return;}pq+=amount;pc+=amount*pr;});var rate=!invalid&&pq>0?pc/pq:null;if(rate===null)warn(warnings,'Harga pembelian '+name+' ('+u+') belum lengkap.');add(name,u,q,rate,'rata-rata-pembelian');}});});
    plans.forEach((cuts,id)=>{var found=rows(model.cuttingPlans).filter(p=>String(p.id)===id),plan=found[0];if(!plan||found.length!==1){warn(warnings,'Status jatah bahan belum terbaca; tunggu data lengkap sebelum memakai HPP.');return;}if(plan.status!=='used')warn(warnings,plan.status==='in_progress'?'Hasil potong bertahap belum selesai; rata-rata kain masih sementara.':'Status jatah bahan tidak sesuai hasil potong.');if(plan.materialMode==='per-result-v1'){selectedPlanCheck(plan,cuts,warnings,inferUnit);return;}if(cuts.some(e=>e.materialAllocation==='owner-plan-selected-rolls'))warn(warnings,'Mode pemakaian bahan per hasil tidak cocok dengan jatah.');var initial=cuts.filter(e=>e.materialAllocation!=='owner-plan-recorded-earlier');if(!initial.length)warn(warnings,'Pemakaian bahan pertama untuk potongan susulan belum ditemukan.');if(plan.usedBatchId&&initial.some(e=>e.materialBatchId!==plan.usedBatchId))warn(warnings,'Identitas pemakaian bahan jatah tidak sesuai.');var actual=new Map(),wanted=new Map();initial.forEach(e=>rows(e.rols).forEach(r=>{var key=String(r.purchaseId)+'|'+(unit(r.unit)||'kg');actual.set(key,(actual.get(key)||0)+(number(r.kiloan==null?r.kg:r.kiloan)||0));}));rows(plan.rolls).forEach(r=>{var key=String(r.purchaseId)+'|'+(unit(r.unit)||'kg');wanted.set(key,(wanted.get(key)||0)+(number(r.kg)||0));});if(actual.size!==wanted.size||[...wanted].some(([key,value])=>Math.abs(value-(actual.get(key)||0))>0.00001))warn(warnings,'Jumlah bahan tercatat berbeda dari jatah pemotongan.');});
    plans.forEach((cuts,id)=>{var plan=rows(model.cuttingPlans).find(p=>String(p.id)===id);if(!plan||plan.status!=='used')return;var present=new Set(entries.filter(x=>String(x.entry.cuttingPlanId)===id&&number(x.entry.jumlah)>0).map(x=>String(x.product.id)));if(rows(plan.products).some(ref=>!present.has(String(ref.id))))warn(warnings,'Ada ukuran dari jatah selesai yang hasil potongnya belum ditemukan.');});
    if(!totalPcs)warn(warnings,'Belum ada jumlah hasil potong untuk model ini.');if(!detailsMap.size)warn(warnings,'Belum ada biaya kain yang dapat dihitung.');if(!Number.isFinite(totalCost)||totalCost>Number.MAX_SAFE_INTEGER||!Number.isSafeInteger(totalPcs)){warn(warnings,'Nilai biaya atau jumlah pcs melebihi batas perhitungan.');totalCost=0;}
    var details=[...detailsMap.values()].map(d=>Object.assign(d,{avgHarga:d.qty?d.totalCost/d.qty:0,priceSource:d.priceSources.join(', ')}));return {perPcs:totalPcs?totalCost/totalPcs:0,totalCost,totalPcs,totalKg,details,complete:warnings.length===0,warnings};
  }
  function reference(model,stock){
    var warnings=(model.warnings||[]).slice(),entries=model.ledger||ledger(model.members||[model],'potong',warnings),parents=entries.map((_,i)=>i),keys=new Map();
    function find(i){while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;}
    function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
    function linked(e){return [e.cuttingPlanId,e.materialBatchId,e.materialAllocation].some(v=>v!=null&&String(v).trim()!=='');}
    // Plan and material batch form connected components: a zero-material
    // continuation is assessed together with every receipt for its allowance.
    entries.forEach(({entry:e},i)=>['cuttingPlanId','materialBatchId'].forEach(field=>{
      if(e[field]==null||String(e[field]).trim()==='')return;
      var key=field+':'+String(e[field]);if(keys.has(key))parents[find(i)]=find(keys.get(key));else keys.set(key,i);
    }));
    var grouped=new Map();entries.forEach((row,i)=>{var key=find(i);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(row);});
    var components=[...grouped.values()].map(group=>({group,cost:fabric(Object.assign({},model,{ledger:group,warnings:[]}),stock)})),newest='';
    components.forEach(({group,cost})=>{if(cost.complete&&group.every(x=>validDate(x.entry.tanggal)))group.forEach(x=>{if(x.entry.tanggal>newest)newest=x.entry.tanggal;});});
    var materialWarnings=new Set(['Ada hasil potong tanpa rincian bahan.','Belum ada biaya kain yang dapat dihitung.','Nama, jumlah, atau satuan bahan belum valid.','Ada rol tanpa nama atau jumlah bahan yang valid.','Rincian jumlah rol belum konsisten.','Rincian rol tidak cocok dengan jumlah bahan.']);
    function materialOnly(cost){return cost.warnings.length>0&&cost.warnings.every(w=>materialWarnings.has(w)||/^Rincian rol tidak cocok dengan jumlah bahan .+\.$/.test(w));}
    var omitted=new Set(),excluded=[];
    components.forEach(({group,cost})=>{
      if(warnings.length||!newest||group.length!==1||!materialOnly(cost))return;
      var row=group[0],e=row.entry,q=number(e.jumlah);
      if(linked(e)||q===null||!Number.isSafeInteger(q)||q<=0||!validDate(e.tanggal)||e.tanggal>=newest)return;
      omitted.add(row);excluded.push({tanggal:e.tanggal,size:String(row.product.size||''),jumlah:q,reason:cost.warnings.filter(w=>w!=='Belum ada biaya kain yang dapat dihitung.').join(' ')});
    });
    var includedEntries=entries.filter(row=>!omitted.has(row));
    // Preserve original model/ledger warnings and validate the full remaining
    // model again, including completed-plan size coverage and shared batches.
    var result=fabric(Object.assign({},model,{ledger:includedEntries,warnings}),stock),allPcs=entries.reduce((sum,x)=>{var q=number(x.entry.jumlah);return sum+(q!==null&&Number.isSafeInteger(q)&&q>0?q:0);},0);
    return Object.assign(result,{basis:{allPcs,includedPcs:result.totalPcs,excludedPcs:excluded.reduce((sum,x)=>sum+x.jumlah,0),includedCount:includedEntries.length,excluded,policy:'complete-legacy-v1'},includedEntries});
  }
  function config(model,hppData){var data=hppData||{},direct=data.modelConfigs&&data.modelConfigs[model.id];if(direct&&typeof direct==='object')return {value:clone(direct),source:'model',complete:true,warnings:[]};var configs=(model.members||[]).map(p=>data.configs&&data.configs[legacyId(p)]).filter(c=>c&&typeof c==='object');if(!configs.length)return {value:null,source:'none',complete:false,warnings:[]};if(new Set(configs.map(stable)).size>1)return {value:null,source:'legacy-conflict',complete:false,warnings:['Pengaturan HPP lama berbeda antarukuran. Tetapkan biaya model sekali; data lama tetap disimpan.']};return {value:clone(configs[0]),source:'legacy-compatible',complete:true,warnings:[]};}
  function cutting(model,meta,reference){
    var warnings=[],totalCost=0,totalPcs=0,details=[],sources=new Set();
    meta=meta||{};
    // Match Potong Command's precedence exactly: full name, shorter prefixes,
    // then its legacy sanitized/raw series|name override. Never match by size.
    function currentRate(p){
      var name=String(p.namaBarang||'').trim(),words=name.split(/\s+/),keys=name?[name]:[];
      for(var i=words.length-1;i>=1;i--)keys.push(words.slice(0,i).join(' '));
      for(var key of keys){var value=number((meta.tarifJenis||{})[key]);if(value!==null&&value>0)return value;}
      var raw=(p.series||'')+'|'+(p.namaBarang||''),safe=raw.replace(/[.#$\/\[\]]/g,'_');
      var legacy=number((meta.tarif||{})[safe]||(meta.tarif||{})[raw]);
      return legacy!==null&&legacy>0?legacy:null;
    }
    var cuts=ledger(model.members||[model],'potong',warnings,e=>stable({cut:costSignature(e,'potong'),tarif:e.tarif,total:e.total}));
    if(reference){
      (model.warnings||[]).forEach(w=>warn(warnings,w));
      if(!Array.isArray(reference.includedEntries)){warn(warnings,'Acuan hasil potong untuk HPP belum tersedia.');cuts=[];}
      else cuts=cuts.filter(x=>reference.includedEntries.some(r=>r.entry===x.entry&&r.product===x.product));
    }
    cuts.forEach(({entry:e,product:p})=>{
      var q=number(e.jumlah),rate=number(e.tarif),total=number(e.total),cost=null,source='';
      if(q===null||!Number.isSafeInteger(q)||q<=0){warn(warnings,'Jumlah hasil potong belum valid untuk menghitung upah.');return;}
      totalPcs+=q;
      if((e.tarif!=null&&rate===null)||(e.total!=null&&total===null)){
        warn(warnings,'Tarif atau total upah potong tercatat tidak valid; periksa Potong Command.');
      }else if(total!==null&&total>0){
        if(rate!==null&&rate>0&&Math.abs(total-q*rate)>Math.max(1,Math.abs(q*rate)*0.000001))warn(warnings,'Total upah potong berbeda dari jumlah pcs × tarif; periksa Potong Command.');
        else {cost=total;source='total-tercatat';}
      }else if(rate!==null&&rate>0){
        if(total===0)warn(warnings,'Tarif potong ada tetapi total upah tercatat nol; periksa Potong Command.');
        else {cost=q*rate;source='tarif-tercatat';}
      }else{
        var current=currentRate(p);
        if(current!==null){cost=q*current;source='tarif-saat-ini';}
        else warn(warnings,'Tarif potong belum tersedia untuk '+String(p.namaBarang||'model ini')+'. Isi tarif di Potong Command.');
      }
      if(cost!==null){
        if(!Number.isFinite(cost)||cost>Number.MAX_SAFE_INTEGER)warn(warnings,'Nilai upah potong melebihi batas perhitungan.');
        else {totalCost+=cost;sources.add(source);details.push({tanggal:e.tanggal||'',size:p.size||'',jumlah:q,tarif:cost/q,totalCost:cost,source});}
      }
    });
    if(!totalPcs)warn(warnings,'Belum ada hasil potong untuk menghitung rata-rata upah.');
    if(!Number.isSafeInteger(totalPcs)||!Number.isFinite(totalCost)||totalCost>Number.MAX_SAFE_INTEGER){warn(warnings,'Jumlah atau biaya potong melebihi batas perhitungan.');totalCost=0;}
    var source=sources.has('tarif-saat-ini')?(sources.size>1?'Upah tercatat + perkiraan tarif Potong saat ini':'Perkiraan tarif Potong Command saat ini'):
      sources.has('total-tercatat')?'Upah potong tercatat · rata-rata seluruh hasil':sources.has('tarif-tercatat')?'Tarif potong tercatat · rata-rata seluruh hasil':'Belum ada biaya potong';
    if(reference)source=source.replace('rata-rata seluruh hasil','rata-rata acuan HPP')+' · sesuai hasil potong acuan HPP';
    return Object.assign({perPcs:totalPcs?totalCost/totalPcs:0,totalCost,totalPcs,complete:!!totalPcs&&!warnings.length,warnings,source,details},reference?{basis:reference.basis}:{});
  }
  function sewing(model,workers){
    var warnings=[],list=rows(workers&&workers.tukangJahit?workers.tukangJahit:workers).filter(w=>!ignored(w));
    function rate(w,p){if(!w||!w.tarif)return null;var raw=(p.series||'')+'|'+(p.namaBarang||''),safe=raw.replace(/[.#$\/\[\]]/g,'_'),v=number(w.tarif[safe]!==undefined?w.tarif[safe]:w.tarif[raw]);return v!==null&&v>0?v:null;}
    var assignments=[];
    (model.members||[]).filter(p=>p.arsip!==true||flag(p.poAktif)).forEach(p=>{
      var seen=new Map();
      rows(p.assignJahit).filter(a=>!ignored(a)).forEach(a=>{
        var q=number(a.qty),id=a.id!=null?String(a.id):'',previous=id&&seen.get(id);
        if(q===null||!Number.isSafeInteger(q)){warn(warnings,'Jumlah penugasan jahit belum valid.');return;}
        if(previous){if(stable(previous)!==stable(a))warn(warnings,'Identitas penugasan jahit ganda dengan isi berbeda.');return;}
        if(id)seen.set(id,a);
        if(q>0)assignments.push({p,a});
      });
    });
    var totalCost=0,totalPcs=0;
    if(assignments.length){assignments.forEach(({p,a})=>{var matches=list.filter(w=>String(w.id)===String(a.tukangId)),r=matches.length===1?rate(matches[0],p):null,q=number(a.qty);if(r===null)warn(warnings,'Tarif jahit saat ini belum tersedia untuk semua penugasan model.');else totalCost+=r*q;totalPcs+=q;});return {perPcs:totalPcs?totalCost/totalPcs:0,totalCost,totalPcs,complete:!warnings.length,warnings,source:'Tarif jahit saat ini · rata-rata sesuai jumlah penugasan'};}
    var rates=[];list.forEach(w=>{var values=new Set((model.members||[model]).map(p=>rate(w,p)).filter(v=>v!==null));if(values.size>1)warn(warnings,'Tarif nama model yang sama berbeda; periksa tarif jahit.');values.forEach(v=>rates.push(v));});if(rates.length){if(new Set(rates).size>1)warn(warnings,'Tarif berbeda antarpenjahit. Pilih biaya jahit model sebelum memakai rekomendasi.');return {perPcs:warnings.length?0:rates[0],totalCost:0,totalPcs:0,complete:!warnings.length,warnings,source:'Tarif jahit saat ini'};}
    var historic=ledger(model.members||[model],'jahit',warnings);historic.forEach(({entry:e})=>{var q=number(e.jumlah),r=number(e.tarif);if(q===null||q<=0||r===null||r<=0){warn(warnings,'Tarif atau jumlah pada riwayat jahit belum lengkap.');return;}totalCost+=q*r;totalPcs+=q;});if(!totalPcs)warn(warnings,'Tarif jahit belum tersedia; isi biaya jahit per pcs.');return {perPcs:totalPcs?totalCost/totalPcs:0,totalCost,totalPcs,complete:!!totalPcs&&!warnings.length,warnings,source:totalPcs?'Riwayat tarif jahit · bukan tarif terbaru':'Belum ada tarif jahit'};
  }
  return {groupProducts,fabric,reference,config,sewing,cutting,modelId,norm};
});

return module.exports;}());
var coreCommerceLegacyPrice=(function(){var module={exports:{}};
/* Pure price simulation. Tax percentages are user estimates, not filing advice. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HppPrice = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var MAX = Number.MAX_SAFE_INTEGER;
  var labels = { hpp: 'HPP', price: 'Harga jual', margin: 'Target margin', fee: 'Biaya marketplace', tax: 'Estimasi pajak', fixed: 'Biaya tetap per pcs', profit: 'Target untung per pcs' };
  function fields(input, names) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Isian simulasi belum valid.';
    for (var i = 0; i < names.length; i += 1) {
      var name = names[i], value = input[name];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return labels[name] + ' harus angka nol atau lebih yang valid.';
      if (name !== 'fee' && name !== 'tax' && name !== 'margin' && value > MAX) return labels[name] + ' melampaui batas perhitungan rupiah yang aman.';
    }
    return '';
  }
  function money(value) {
    if (!Number.isFinite(value) || Math.abs(value) > MAX) throw new RangeError('Hasil simulasi melampaui batas perhitungan rupiah yang aman.');
    return value === 0 ? 0 : value;
  }
  function roundedPrice(base, divisor) {
    if (!Number.isFinite(divisor) || divisor <= 0) throw new RangeError('Sisa persentase harga harus lebih dari nol.');
    return money(Math.ceil(money(base / divisor) / 100) * 100);
  }
  function invalidQuote(error) {
    return { valid: false, recommended: null, breakEven: null, profit: null, feeAmount: null, taxAmount: null, fixed: null, marginActual: null, error: error };
  }
  // Inputs are per piece. The caller converts any per-order charge to fixed/pcs.
  // HPP and costs may be fractional; only recommended sale prices round up to
  // the next Rp100. Margin is a percentage of selling price, not markup on HPP.
  // At price 0 the signed profit is defined, but marginActual is null.
  function quote(input) {
    var error = fields(input, ['hpp', 'price', 'margin', 'fee', 'tax', 'fixed']);
    if (error) return invalidQuote(error);
    var combined = input.fee + input.tax + input.margin;
    if (!Number.isFinite(combined) || combined >= 100) return invalidQuote('Jumlah biaya marketplace, estimasi pajak, dan target margin harus kurang dari 100%.');
    try {
      var base = money(input.hpp + input.fixed);
      var feeAmount = money(input.price * (input.fee / 100));
      var taxAmount = money(input.price * (input.tax / 100));
      var profit = money(input.price - feeAmount - taxAmount - base);
      var marginActual = input.price === 0 ? null : profit / input.price * 100;
      if (marginActual !== null && !Number.isFinite(marginActual)) throw new RangeError('Persentase hasil simulasi melampaui batas perhitungan yang aman.');
      return {
        valid: true,
        recommended: roundedPrice(base, 1 - input.fee / 100 - input.tax / 100 - input.margin / 100),
        breakEven: roundedPrice(base, 1 - input.fee / 100 - input.tax / 100),
        profit: profit,
        feeAmount: feeAmount,
        taxAmount: taxAmount,
        fixed: input.fixed === 0 ? 0 : input.fixed,
        marginActual: marginActual === 0 ? 0 : marginActual,
        error: ''
      };
    } catch (failure) {
      return invalidQuote(failure.message || 'Hasil simulasi belum dapat dihitung dengan aman.');
    }
  }
  function target(input) {
    var error = fields(input, ['hpp', 'profit', 'fee', 'tax', 'fixed']);
    var invalid = function (message) { return { valid: false, price: null, error: message }; };
    if (error) return invalid(error);
    var combined = input.fee + input.tax;
    if (!Number.isFinite(combined) || combined >= 100) return invalid('Jumlah biaya marketplace dan estimasi pajak harus kurang dari 100%.');
    try {
      var base = money(money(input.hpp + input.fixed) + input.profit);
      return { valid: true, price: roundedPrice(base, 1 - input.fee / 100 - input.tax / 100), error: '' };
    } catch (failure) {
      return invalid(failure.message || 'Harga target belum dapat dihitung dengan aman.');
    }
  }
  return Object.freeze({ quote: quote, target: target });
}));

return module.exports;}());

/* Public contract:
   coreCommerceHpp({config,legacy:{production,stock,meta,workers,cuttingPlans},
     tables:{PO,Produk,Potong,SlipKirim,StokBahan,RencanaPotong,KoreksiRiwayat},settings})
   returns JSON-only {models,warnings}. A model has stable legacy id, series,
   nama/sizes/poIds, kain/potong/jahit evidence, config resolution, basis,
   hargaJahit/biayaLain/targetMargin, hppTotal (estimate or null), configured,
   complete, warnings and prices. Only configured models have recommendations.
   Legacy source cuts and mirrored asal=lama rows are never counted twice.
   Prices and histories are read-only; this is not a stock or payroll ledger. */
function coreCommercePriceQuote(input) { return coreCommerceLegacyPrice.quote(input); }
function coreCommercePriceTarget(input) { return coreCommerceLegacyPrice.target(input); }
function coreCommerceHppConfig(value,model) {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Pengaturan HPP tidak sah.');
  function money(v,label) { if (typeof v!=='number' || !Number.isFinite(v) || v<0 || v>Number.MAX_SAFE_INTEGER) throw new Error(label+' harus angka nol atau lebih yang sah.'); return v; }
  if (value.jahitMode!=='auto' && value.jahitMode!=='manual') throw new Error('Pilih ongkos jahit otomatis atau manual.');
  if (value.costSchema!==2 || value.costsReviewed!==true) throw new Error('Periksa biaya kain, potong, jahit, dan biaya lain sebelum menyimpan.');
  var out={jahitMode:value.jahitMode,hargaJahit:money(value.hargaJahit,'Ongkos jahit'),biayaLain:money(value.biayaLain,'Biaya lain'),targetMargin:money(value.targetMargin,'Target margin'),costSchema:2,costsReviewed:true};
  if (out.targetMargin>=100) throw new Error('Target margin harus kurang dari 100%.');
  out.ketLain=String(value.ketLain || '').trim(); if(out.ketLain.length>300) throw new Error('Keterangan biaya maksimal 300 karakter.');
  if (value.basisPolicy!==undefined && value.basisPolicy!=='complete-legacy-v1') throw new Error('Acuan HPP tidak dikenal.');
  if (model && model.basis && model.basis.excludedPcs>0 && value.basisPolicy!==model.basis.policy) throw new Error('Periksa dan setujui acuan produksi lengkap sebelum menyimpan HPP.');
  if (value.basisPolicy) out.basisPolicy=value.basisPolicy;
  if (value.hargaJual!==undefined) {
    if(!value.hargaJual || typeof value.hargaJual!=='object' || Array.isArray(value.hargaJual) || Object.keys(value.hargaJual).length>20) throw new Error('Harga jual tidak sah.');
    out.hargaJual={}; Object.keys(value.hargaJual).forEach(function(k){ if(!/^[a-zA-Z0-9_-]{1,40}$/.test(k)||['__proto__','constructor','prototype'].indexOf(k)>=0) throw new Error('Marketplace tidak sah.'); out.hargaJual[k]=money(value.hargaJual[k],'Harga jual'); });
  }
  if(model){out.series=String(model.series || '');out.namaBarang=String(model.nama || model.namaBarang || '');}
  return out;
}
function coreCommerceHpp(input) {
  input=input || {}; var C=coreCommerceLegacyCost, cfg=input.config || {}, legacy=input.legacy || {}, tables=input.tables || {}, settings=input.settings || {};
  function rows(v){return (Array.isArray(v)?v:v&&typeof v==='object'?Object.keys(v).map(function(k){return v[k];}):[]).filter(function(r){return r&&typeof r==='object'&&!Array.isArray(r);});}
  function json(v,fallback){if(typeof v!=='string')return v==null?fallback:v;try{return JSON.parse(v);}catch(e){return fallback;}}
  function n(v){if(v==null||typeof v==='boolean'||String(v).trim()==='')return null;var x=Number(v);return Number.isFinite(x)&&x>=0&&x<=Number.MAX_SAFE_INTEGER?x:null;}
  function sum(a){return a.reduce(function(t,v){return t+v;},0);}
  function unique(a){return a.filter(function(v,i){return v && a.indexOf(v)===i;});}
  function unit(v){return {kg:'kg',kilogram:'kg',m:'meter',meter:'meter',metre:'meter',yd:'yard',yard:'yard',yards:'yard'}[C.norm(v)] || null;}
  function evidence(parts){
    parts=parts.filter(Boolean);var pcs=sum(parts.map(function(p){return p.totalPcs || 0;})),cost=sum(parts.map(function(p){return p.totalCost || 0;})),warnings=unique([].concat.apply([],parts.map(function(p){return p.warnings || [];})));
    if(!parts.length)warnings.push('Belum ada hasil potong untuk menghitung HPP.');
    if(!Number.isSafeInteger(pcs)||!Number.isFinite(cost)||cost>Number.MAX_SAFE_INTEGER)warnings.push('Jumlah atau biaya melampaui batas perhitungan yang aman.');
    return {perPcs:pcs?cost/pcs:null,totalPcs:pcs,totalCost:cost,complete:!!parts.length&&parts.every(function(p){return p.complete;})&&!warnings.length,warnings:warnings,details:[].concat.apply([],parts.map(function(p){return p.details || [];})),source:unique(parts.map(function(p){return p.source;})).join(' + ')};
  }
  function summary(component){var out={};Object.keys(component || {}).forEach(function(k){if(k!=='includedEntries')out[k]=component[k];});return out;}
  var originals=rows(legacy.production), legacyModels=C.groupProducts(originals,{cuttingPlans:rows(legacy.cuttingPlans)}), groups=Object.create(null), allWarnings=[];
  legacyModels.forEach(function(m){groups[m.id]={id:m.id,series:m.series,nama:m.namaBarang,sizes:m.sizes.slice(),legacy:m,poIds:[],nativeCuts:[],assignments:[],warnings:[],members:m.members.slice(),rates:[]};});
  var poMap=Object.create(null), stockById=Object.create(null), stockByName=Object.create(null), planById=Object.create(null), productById=Object.create(null);
  rows(tables.Produk).forEach(function(r){productById[r.id]=r;});
  rows(tables.RencanaPotong).forEach(function(r){planById[r.id]=r;});
  rows(tables.StokBahan).filter(function(r){return r.jenis==='beli';}).forEach(function(r){
    if(stockById[r.id])stockById[r.id]=false;else if(stockById[r.id]!==false)stockById[r.id]=r;
    var key=C.norm(r.bahan);(stockByName[key] || (stockByName[key]=[])).push(r);
  });
  rows(tables.PO).forEach(function(p){
    var id=C.modelId(p.series,p.nama), g=groups[id]; if(!g)g=groups[id]={id:id,series:String(p.series || ''),nama:String(p.nama || ''),sizes:[],poIds:[],nativeCuts:[],assignments:[],warnings:[],members:[],rates:[]};
    g.poIds.push(p.id);poMap[p.id]=g;g.sizes=g.sizes.concat(Object.keys(json(p.ukuran,{})));
    var active=json(p.ukuranAktif,[]);if(Array.isArray(active))g.sizes=g.sizes.concat(active);
    g.members.push({id:'native:'+p.id,series:g.series,namaBarang:g.nama});
    var prod=productById[p.produkId],rate=n(prod&&prod.tarifJahit);if(rate===null||rate===0)rate=n(settings.upahJahit);if(rate!==null)g.rates.push(rate);
    if(p.imporReview)g.warnings.push('PO '+String(p.noPO || p.id)+' masih memerlukan pemeriksaan riwayat.');
  });
  var cutSeen=Object.create(null);
  rows(tables.Potong).forEach(function(r){
    if(r.asal==='lama'&&originals.length)return;
    var g=poMap[r.poId];if(!g){allWarnings.push('Ada hasil potong tanpa PO; belum masuk perhitungan HPP.');return;}
    if(r.asal==='lama')g.warnings.push('Sumber asli riwayat lama belum tersedia; tautan biaya lama belum dapat dipastikan.');
    if(cutSeen[r.id]){g.warnings.push('Identitas hasil potong ganda; periksa riwayat.');cutSeen[r.id].warnings.push('Identitas hasil potong ganda; periksa riwayat.');return;}cutSeen[r.id]=g;
    g.nativeCuts.push(r);g.sizes=g.sizes.concat(Object.keys(json(r.ukuran,{})));
  });
  rows(tables.SlipKirim).forEach(function(r){if(r.asal==='lama'&&originals.length)return;var g=poMap[r.poId];if(g)g.assignments.push(r);});
  rows(tables.KoreksiRiwayat).forEach(function(r){var g=poMap[r.poId];if(g)g.warnings.push('Jumlah riwayat memiliki koreksi fisik; cocokkan acuan biaya lama sebelum memakai HPP.');});
  function nativeCosts(g){
    if(!g.nativeCuts.length)return null;
    /* Acuan biaya memakai potongan ukuran XL saja bila ada: satu barang (M sampai XXL) dihitung dari kebutuhan kain XL.
       Potongan yang memuat beberapa ukuran sekaligus tidak bisa dipisah per ukuran, jadi tidak dihitung sebagai acuan XL. */
    var acuanXL=g.nativeCuts.filter(function(r){var m=json(r.ukuran,{}),ada=Object.keys(m).filter(function(k){return (n(m[k]) || 0)>0;});return ada.length===1&&String(ada[0]).trim().toUpperCase()==='XL';}),cuts=acuanXL.length?acuanXL:g.nativeCuts;
    var pcs=0,fabricCost=0,cutCost=0,warnings=[],cutWarnings=[],details=[],cutDetails=[];
    function warn(s){warnings.push(s);}
    function price(p){var qty=n(p.qty),rate=n(p.harga),total=n(p.total);if(qty===null||qty<=0)return null;if(rate!==null&&rate>0){if(total!==null&&Math.abs(total-qty*rate)>Math.max(1,qty*rate*0.000001))return null;return rate;}return total!==null&&total>0?total/qty:null;}
    function average(name,u){var purchases=(stockByName[C.norm(name)] || []).filter(function(p){return unit(p.satuan)===u;}),qty=0,cost=0;if(!purchases.length)return null;for(var i=0;i<purchases.length;i++){var pr=price(purchases[i]);if(pr===null)return null;qty+=Number(purchases[i].qty);cost+=Number(purchases[i].qty)*pr;}return qty?cost/qty:null;}
    cuts.forEach(function(r){
      var q=n(r.total), sizeMap=json(r.ukuran,{}), actual=sum(Object.keys(sizeMap).map(function(k){return n(sizeMap[k]) || 0;}));
      if(q===null||q<=0||!Number.isSafeInteger(q)||q!==actual){warn('Jumlah hasil potong '+r.id+' belum konsisten.');cutWarnings.push('Jumlah hasil potong belum konsisten.');return;}pcs+=q;
      var wage=n(r.tarif);if(wage===null)cutWarnings.push('Tarif potong '+r.id+' belum tercatat.');else{cutCost+=q*wage;cutDetails.push({id:r.id,tanggal:r.tanggal || '',jumlah:q,tarif:wage,totalCost:q*wage,source:'tarif-tercatat'});}
      var list=rows(json(r.bahanList,[]));if(!list.length&&r.bahan)list=[{nama:r.bahan,qty:r.kg}];
      var plan=planById[r.rencanaId], planMaterials=rows(json(plan&&plan.bahanList,[])), declared=Object.create(null), allocated=Object.create(null), allocations=rows(json(r.alokasiBahan,[])), allocSeen=Object.create(null);
      list.forEach(function(b){var key=C.norm(b.nama),amount=n(b.qty);if(!key||amount===null||amount<=0){warn('Rincian bahan hasil potong '+r.id+' belum lengkap.');return;}var units=unique((stockByName[key] || []).map(function(p){return unit(p.satuan);})),planRow=planMaterials.filter(function(p){return C.norm(p.nama)===key;})[0],u=unit(b.satuan || planRow&&planRow.satuan)||(units.length===1?units[0]:null);if(!u){warn('Satuan '+b.nama+' belum dapat dipastikan.');return;}if(declared[key]&&declared[key].unit!==u)warn('Satuan bahan ganda tidak konsisten.');var d=declared[key] || (declared[key]={nama:b.nama,qty:0,unit:u});d.qty+=amount;});
      if(!Object.keys(declared).length)warn('Ada hasil potong tanpa rincian bahan yang sah.');
      allocations.forEach(function(a){
        var receipt=stockById[a.stokId],amount=n(a.qty),key=receipt&&C.norm(receipt.bahan),d=key&&declared[key];
        if(allocSeen[a.stokId]||!receipt||!d||amount===null||amount<=0||unit(receipt.satuan)!==d.unit){warn('Tautan rol '+String(a.stokId || '')+' belum dapat dicocokkan dengan pembelian.');return;}allocSeen[a.stokId]=true;allocated[key]=(allocated[key] || 0)+amount;
        var rate=price(receipt);if(rate===null)warn('Harga rol '+String(receipt.rollLabel || receipt.id)+' belum lengkap.');else fabricCost+=amount*rate;
        details.push({cutId:r.id,jenis:d.nama,unit:d.unit,qty:amount,avgHarga:rate,totalCost:rate===null?null:amount*rate,priceSource:'rol-pembelian',sourceId:receipt.id});
      });
      Object.keys(declared).forEach(function(key){var d=declared[key],left=d.qty-(allocated[key] || 0);if(left< -0.000001){warn('Jumlah rol melebihi bahan pada hasil potong '+r.id+'.');return;}if(left<=0.000001)return;var rate=average(d.nama,d.unit);if(rate===null)warn('Harga rata-rata pembelian '+d.nama+' ('+d.unit+') belum lengkap.');else fabricCost+=left*rate;details.push({cutId:r.id,jenis:d.nama,unit:d.unit,qty:left,avgHarga:rate,totalCost:rate===null?null:left*rate,priceSource:'rata-rata-pembelian'});});
    });
    return {xl:!!acuanXL.length,fabric:{perPcs:pcs?fabricCost/pcs:null,totalPcs:pcs,totalCost:fabricCost,complete:pcs>0&&!warnings.length,warnings:unique(warnings),details:details,source:acuanXL.length?'Catatan bahan Produksi, potongan ukuran XL':'Catatan bahan Produksi'},cutting:{perPcs:pcs?cutCost/pcs:null,totalPcs:pcs,totalCost:cutCost,complete:pcs>0&&!cutWarnings.length,warnings:unique(cutWarnings),details:cutDetails,source:'Tarif potong tercatat'}};
  }
  function nativeSewing(g){
    var cost=0,pcs=0,warnings=[],seen=Object.create(null);
    g.assignments.forEach(function(r){if(seen[r.id]){warnings.push('Identitas penugasan jahit ganda.');return;}seen[r.id]=true;var q=n(r.total),rate=n(r.upah);if(q===null||q<=0||!Number.isSafeInteger(q)||rate===null){warnings.push('Jumlah atau tarif penugasan jahit belum lengkap.');return;}pcs+=q;cost+=q*rate;});
    if(!Number.isSafeInteger(pcs)||!Number.isFinite(cost)||cost>Number.MAX_SAFE_INTEGER)warnings.push('Jumlah atau biaya jahit melampaui batas perhitungan.');
    if(pcs)return {perPcs:cost/pcs,totalPcs:pcs,totalCost:cost,complete:!warnings.length,warnings:warnings,source:'Tarif jahit tercatat · rata-rata penugasan'};
    var rates=unique(g.rates.map(function(x){return String(x);})).map(Number);if(rates.length===1)return {perPcs:rates[0],totalPcs:0,totalCost:0,complete:!warnings.length,warnings:warnings,source:'Perkiraan tarif jahit saat ini'};
    return {perPcs:null,totalPcs:0,totalCost:0,complete:false,warnings:warnings.concat(rates.length?'Tarif jahit model berbeda; pilih perkiraan manual.':'Tarif jahit belum tersedia.'),source:'Belum ada tarif jahit'};
  }
  var models=Object.keys(groups).sort().map(function(id){
    var g=groups[id],lc=g.legacy?C.reference(g.legacy,legacy.stock || {}):null,lp=lc?C.cutting(g.legacy,legacy.meta || {},lc):null,ls=g.legacy?C.sewing(g.legacy,legacy.workers || []):null,native=nativeCosts(g),ns=nativeSewing(g),pakaiXL=!!(native&&native.xl),kain=evidence(pakaiXL?[native.fabric]:[lc,native&&native.fabric]),potong=evidence(pakaiXL?[native.cutting]:[lp,native&&native.cutting]);
    var jahit=ns.totalPcs?(ls&&ls.totalPcs?evidence([ls,ns]):ns):(ls || ns),ci=C.config({id:id,members:g.members},cfg),value=ci.value,mode=value&&value.jahitMode || (value?'manual':'auto');
    if(mode!=='auto'&&mode!=='manual')g.warnings.push('Pilihan ongkos jahit tidak valid.');
    var hargaJahit=mode==='auto'?(jahit.complete?jahit.perPcs:null):n(value&&value.hargaJahit),biayaLain=value?n(value.biayaLain===undefined?0:value.biayaLain):0,margin=value?n(value.targetMargin===undefined?30:value.targetMargin):30;
    var basis={policy:'complete-legacy-v1',allPcs:(lc?lc.basis.allPcs:0)+(native?native.fabric.totalPcs:0),includedPcs:kain.totalPcs,excludedPcs:pakaiXL?0:(lc?lc.basis.excludedPcs:0),excluded:pakaiXL?[]:(lc?lc.basis.excluded:[]),origins:{legacy:pakaiXL?0:(lc?lc.totalPcs:0),native:native?native.fabric.totalPcs:0}};
    if(pakaiXL)basis.ukuran='XL';
    var warnings=unique(g.warnings.concat(kain.warnings,potong.warnings,ci.warnings));
    if(hargaJahit===null)warnings=warnings.concat(jahit.warnings,['Isi ongkos jahit atau lengkapi tarif penugasan.']);
    if(ci.source==='legacy-compatible')warnings.push('Biaya lama tetap tersimpan. Periksa dan simpan sekali untuk model ini.');
    if(value&&value.costSchema!==2)warnings.push('Periksa biaya lain agar kain, potong, dan jahit tidak dihitung dua kali.');
    if(!value||value.costsReviewed!==true)warnings.push('Biaya model belum diperiksa dan disimpan.');
    var basisReviewed=!basis.excludedPcs || value&&value.basisPolicy===basis.policy;if(!basisReviewed)warnings.push('Periksa acuan produksi lengkap dan catatan lama yang dipisahkan.');
    var total=kain.complete&&potong.complete&&hargaJahit!==null&&biayaLain!==null?kain.perPcs+potong.perPcs+hargaJahit+biayaLain:null;
    if(total!==null&&(!Number.isFinite(total)||total>Number.MAX_SAFE_INTEGER)){total=null;warnings.push('Total HPP melampaui batas perhitungan.');}
    if(biayaLain===null)warnings.push('Biaya lain belum valid.');if(margin===null||margin>=100)warnings.push('Target margin harus nol sampai kurang dari 100%.');
    var ready=!!value&&ci.source==='model'&&ci.complete&&value.costSchema===2&&value.costsReviewed===true&&basisReviewed&&total!==null&&margin!==null&&margin<100&&!g.warnings.length,prices={};
    Object.keys(cfg.marketplace || {}).forEach(function(key){var mp=cfg.marketplace[key] || {},price=n(value&&value.hargaJual&&value.hargaJual[key]);if(!ready)return;prices[key]=coreCommercePriceQuote({hpp:total,price:price===null?0:price,margin:margin,fee:n(mp.fee),tax:n(cfg.pajak),fixed:mp.fixedPerPcs===undefined?0:n(mp.fixedPerPcs)});});
    kain.basis=basis;
    return {id:id,series:g.series,nama:g.nama,namaBarang:g.nama,sizes:unique(g.sizes).sort(),poIds:unique(g.poIds),kain:summary(kain),potong:summary(potong),jahit:summary(jahit),config:ci,basis:basis,hargaJahit:hargaJahit,biayaLain:biayaLain,targetMargin:margin,hppTotal:total,configured:ready,complete:ready,warnings:unique(warnings),prices:prices};
  });
  return {models:models,warnings:unique(allWarnings)};
}

/* Admin commerce is loaded on demand. Payments and receipts are append-only;
   none of these actions creates, deletes or reallocates production history. */
function coreCommerceHash(value) { return coreLegacyHash(value); }
function coreCommerceKey(module,kind,id) { return 'cm_'+coreCommerceHash([module,kind,String(id)]).slice(0,40); }
function coreCommerceCopy(value) { return JSON.parse(JSON.stringify(value)); }
function coreCommerceRows(value) { return (value instanceof Array ? value : value && typeof value === 'object' ? Object.keys(value).map(function(k){return value[k];}) : []).filter(function(v){return v && typeof v === 'object';}); }
function coreCommerceData(row) { return coreMap(row && row.data); }
/* One pass over the tables for drawing many records. Without it every order
   parses every product again (photo included) just to find two names. */
function coreCommerceLookup(records, events) {
  var out={products:Object.create(null),suppliers:Object.create(null),events:Object.create(null)};
  (records||[]).forEach(function(r){if(r.module!=='pembelian'||r.kind!=='product'&&r.kind!=='supplier')return;var d=coreCommerceData(r),box=r.kind==='product'?out.products:out.suppliers;if(!box[d.id])box[d.id]={id:d.id,nama:d.nama,supplierId:d.supplierId};});
  (events||[]).forEach(function(e){var k=e.module+'|'+e.parentId;(out.events[k]||(out.events[k]=[])).push(e);});
  return out;
}
/* Product photos travel separately (getCommerceImages); lists carry a marker only. */
function coreCommerceLean(value) { if(value&&value.gambar)value.hasPicture=true;if(value)delete value.gambar;return value; }
function coreCommerceRecordView(row, events, records, lookup) {
  var value=coreCommerceCopy(coreCommerceData(row)), embedded=value._initialPayment, own=(lookup?lookup.events[row.module+'|'+value.id]||[]:events||[]).filter(function(e){return e.module===row.module&&e.parentId===value.id;});
  var revision=coreCommerceHash({record:row.revision,events:own.map(function(e){return [e.id,e.data];}).sort(function(a,b){return a[0].localeCompare(b[0]);})});
  ['_createHash','_createActor','_lastMutation','_initialPayment'].forEach(function(k){delete value[k];});
  value.revision=revision; value.createdBy=row.dibuatOleh;value.createdAt=row.dibuat;value.updatedAt=row.diubah;value.legacy=!!row.sourceHash;
  if(row.kind!=='order'&&row.kind!=='nota')return value;
  var ledger=own.map(function(e){var d=coreCommerceCopy(coreCommerceData(e));d.id=e.id;d.kind=e.kind;d.createdBy=e.dibuatOleh;d.createdAt=e.dibuat;d.legacy=!!e.sourceHash;return d;});
  if(embedded)ledger.unshift(coreCommerceCopy(embedded));
  var voids={};ledger.filter(function(e){return e.kind==='void';}).forEach(function(e){voids[e.eventId]=e;});
  ledger.forEach(function(e){if(voids[e.id]){e.voided=true;e.voidReason=voids[e.id].catatan;}});
  value.events=ledger;value.payments=ledger.filter(function(e){return e.kind==='payment';});value.receipts=ledger.filter(function(e){return e.kind==='receipt';});
  value.totalPaid=0;value.totalReceived=0;var byItem={},ids={},badIds=false;
  (value.items||[]).forEach(function(i){if(!i.id||ids[i.id])badIds=true;else ids[i.id]=true;});
  value.payments.forEach(function(e){if(!e.voided)value.totalPaid+=coreNum(e.jumlah);});
  value.receipts.forEach(function(e){if(e.voided)return;value.totalReceived+=coreNum(e.jumlah);if(!e.itemId||!ids[e.itemId])badIds=true;byItem[e.itemId]=coreNum(byItem[e.itemId])+coreNum(e.jumlah);});
  var rawTotal=row.kind==='nota'?value.total:value.totalHarga,total=coreNum(rawTotal),validTotal=rawTotal!==undefined&&rawTotal!==null&&rawTotal!==''&&typeof rawTotal!=='boolean'&&Number.isSafeInteger(Number(rawTotal))&&Number(rawTotal)>=0,quantity=(value.items||[]).reduce(function(n,i){return n+coreNum(row.kind==='nota'?i.qty:i.jumlah);},0),reasons=[];
  value.balance=Math.max(0,total-value.totalPaid);value.overpaid=Math.max(0,value.totalPaid-total);value.totalQty=quantity;
  value.paymentReview=!validTotal||!(total>=0&&Number.isSafeInteger(total))||value.totalPaid<0||value.overpaid>0||value.payments.some(function(e){return !e.voided&&(!Number.isSafeInteger(e.jumlah)||e.jumlah<0||e.sourceReview);});
  value.receiptReview=row.kind==='order'&&(badIds||value.totalReceived>quantity||value.receipts.some(function(e){return !e.voided&&(!Number.isSafeInteger(e.jumlah)||e.jumlah<0||e.sourceReview);})||(value.items||[]).some(function(i){return !Number.isSafeInteger(Number(i.jumlah))||Number(i.jumlah)<=0||coreNum(byItem[i.id])>coreNum(i.jumlah);}));
  if(value.paymentReview)reasons.push('Nominal pembayaran historis perlu diperiksa; jangan mengubah bukti asli.');
  if(value.receiptReview)reasons.push('Identitas varian atau hubungan penerimaan lama belum cocok. Catatan asli dipertahankan; jangan menebak hubungan dari nama atau urutan.');
  value.needsReview=!!(value.paymentReview||value.receiptReview);value.reviewReasons=reasons;value.receivedByItem=byItem;
  value.status=value.cancelled?'batal':value.needsReview?'review':row.kind==='nota'?(value.balance===0?'lunas':value.totalPaid>0?'dp':'belum'):(value.balance===0&&value.totalReceived>=quantity?'selesai':value.balance===0?'lunas':value.totalReceived>0?'sebagian':value.totalPaid>0?'dp':'pending');
  if(row.kind==='order'){
    var p,s;
    if(lookup){p=lookup.products[value.produkId];if(!p||p.id!==value.produkId)p={};s=lookup.suppliers[p.supplierId];if(!s||s.id!==p.supplierId)s={};}
    else{
      var product=(records||[]).filter(function(r){return r.module==='pembelian'&&r.kind==='product'&&coreCommerceData(r).id===value.produkId;})[0];p=coreCommerceData(product);
      var supplier=(records||[]).filter(function(r){return r.module==='pembelian'&&r.kind==='supplier'&&coreCommerceData(r).id===p.supplierId;})[0];s=coreCommerceData(supplier);
    }
    value.productName=(value.productSnapshot||p).nama||'';value.supplierName=(value.supplierSnapshot||s).nama||'';
  }
  return value;
}
function coreCommerceSlipModel(module,record,context) {
  context=context||{};var nota=module==='nota',money=coreRupiah,productName=String((record.productSnapshot?record.productSnapshot.nama:record.productName)||'').trim()||'Nama produk tidak tersedia',rows=(record.items||[]).map(function(i){return nota?[i.name||'',String(i.size||'')+' '+String(i.color||''),coreRibuan(i.qty),money(i.price),String(coreNum(i.discPercent))+'%',money(i.subtotal)]:[productName,i.nama||'—',coreRibuan(i.jumlah),money(record.hargaSatuan),money(coreNum(i.jumlah)*coreNum(record.hargaSatuan))];});
  var payments=(record.payments||[]).map(function(p){return [p.tanggal||'',p.metode||'',money(p.jumlah),p.tenderedAmount===undefined?'':money(p.tenderedAmount),p.change===undefined?'':money(p.change),p.voided?'Dibatalkan: '+(p.voidReason||''):(p.catatan||'')];});
  var summary=nota?[{label:'Subtotal barang',value:money(record.subtotal)},{label:'Diskon nota ('+coreNum(record.discountPercent)+'%)',value:money(record.discountAmount)},{label:'Ongkir',value:money(record.shipping)}]:[];
  summary=summary.concat([{label:'Total',value:money(nota?record.total:record.totalHarga),emphasis:true},{label:'Dibayar untuk tagihan',value:money(record.totalPaid)},{label:'Sisa',value:money(record.balance),emphasis:true},{label:'Status',value:record.status==='review'?'Perlu diperiksa':record.status}]);
  var sections=payments.length?[{title:'Riwayat pembayaran',columns:['Tanggal','Metode','Tagihan dibayar','Uang diterima','Kembalian','Catatan'].map(function(label){return {label:label};}),rows:payments}]:[];
  if(nota&&record.customer)sections.push({title:'Pelanggan',columns:[{label:'Kontak'},{label:'Alamat'}],rows:[[record.customer.phone||'',record.customer.address||'']]});
  if(record.needsReview)sections.push({title:'Perlu diperiksa',columns:[{label:'Keterangan'}],rows:(record.reviewReasons||[]).map(function(s){return [s];})});
  var note=nota?record.notes:record.catatan;if(note)sections.push({title:'Catatan',columns:[{label:'Keterangan'}],rows:[[note]]});
  return {layout:'weekly-a4',title:nota?'Nota Penjualan':'Pesanan Pembelian Produk',reference:record.noNota||record.id,recipient:nota?(record.customer||{}).name||'':record.supplierName||'',recipientLabel:nota?'Pelanggan':'Supplier',period:nota?String(record.date||'').slice(0,10):record.tanggalOrder||'',columns:(nota?['Barang','Ukuran / Warna','Qty','Harga','Diskon','Subtotal']:['Barang','Varian','Qty','Harga','Subtotal']).map(function(label){return {label:label};}),rows:rows,summary:summary,sections:sections,signatures:[]};
}
/* One amount paid to a supplier for several orders, as the earlier application
   did it: divided by each order's remaining balance. Whole rupiah only, the
   parts always add up to the amount, and no part exceeds its order's balance. */
function coreCommerceSplit(amount, balances) {
  var total=balances.reduce(function(n,b){return n+b;},0),n=balances.length;
  if(!Number.isSafeInteger(amount)||amount<=0||!n||amount>total||balances.some(function(b){return !Number.isSafeInteger(b)||b<0;}))return null;
  var exact=balances.map(function(b){return amount*b/total;}),shares=exact.map(function(x,i){return Math.min(balances[i],Math.max(0,Math.floor(x)));}),left=amount-shares.reduce(function(a,s){return a+s;},0);
  var order=exact.map(function(x,i){return {i:i,frac:x-Math.floor(x)};}).sort(function(a,b){return b.frac-a.frac||a.i-b.i;});
  for(var guard=0;left!==0&&guard<n*4;guard++){var k=order[left>0?guard%n:n-1-guard%n].i;if(left>0&&shares[k]<balances[k]){shares[k]++;left--;}else if(left<0&&shares[k]>0){shares[k]--;left++;}}
  if(left!==0||shares.some(function(s,i){return s<0||s>balances[i];}))return null;
  return shares;
}
function coreInstallCommerceActions(actions,ctx) {  var store=ctx.store, tables=['CommerceRecord','CommerceEvent','CommerceSource','CommerceImport'];
  function fail(s){ctx.fail(s);}
  /* Writes and imports recheck the physical account row. Lists, photos and PDF
     (reading=true) use the same account check as the rest of the application,
     so opening a page does not open the spreadsheet only to read accounts. */
  function admin(p,owner,reading){if(!reading&&store.fresh)store.fresh('Pegawai');var me=ctx.auth(p);if(!coreIsAdmin(me)||owner&&me.divisi!=='owner')fail(owner?'Hanya owner yang boleh melakukan tindakan ini.':'Modul ini hanya untuk owner atau admin.');return me;}
  function fresh(names){names=names||['CommerceRecord','CommerceEvent','CommerceImport'];if(store.checkpoint)store.checkpoint(names);else if(store.fresh)names.forEach(function(s){store.fresh(s);});}
  function pending(){return store.read('CommerceImport').filter(function(r){return r.status!=='complete';});}
  function writable(p,owner){var me=admin(p,owner);fresh();if(pending().length)fail('Impor modul belum selesai. Owner perlu melanjutkan impor dengan file dan bukti yang sama.');return me;}
  function id(v){if(typeof v!=='string'||!v||v.length>128||!/^[A-Za-z0-9_-]+$/.test(v)||/^(?:__proto__|constructor|prototype)$/.test(v))fail('Identitas catatan tidak sah.');return v;}
  function text(v,max,required){if(v===undefined||v===null)v='';if(typeof v!=='string'||v.length>max||required&&!v.trim())fail('Isi teks wajib dengan panjang yang sesuai.');return v.trim();}
  function num(v,max,positive,integer){if(v===null||v===undefined||v===''||typeof v==='boolean')fail('Isi angka yang sah.');var n=Number(v);if(!isFinite(n)||n<0||positive&&n===0||n>max||integer&&n!==Math.floor(n))fail('Jumlah atau harga tidak sah.');return n;}
  function date(v){v=String(v||'').slice(0,10);var d=new Date(v+'T00:00:00Z');if(!coreTglOk(v)||isNaN(d.getTime())||d.toISOString().slice(0,10)!==v)fail('Tanggal tidak sah.');return v;}
  function now(){return ctx.env.now().toISOString();}
  function all(){return store.read('CommerceRecord');}
  function find(module,kind,key){return all().filter(function(r){return r.module===module&&r.kind===kind&&coreCommerceData(r).id===key;})[0];}
  function view(row){if(!row)fail('Catatan tidak ditemukan.');return coreCommerceRecordView(row,store.read('CommerceEvent'),all());}
  function stateOf(module,me){
    var rows=all(),events=store.read('CommerceEvent'),lookup=coreCommerceLookup(rows,events),out={module:module,version:store.version(),actor:{id:me.id,divisi:me.divisi}};
    function list(kind){return rows.filter(function(r){return r.module===module&&r.kind===kind;}).map(function(r){return coreCommerceRecordView(r,events,rows,lookup);});}
    if(module==='pembelian'){out.suppliers=list('supplier');out.products=list('product').map(coreCommerceLean);out.orders=list('order');}
    if(module==='nota')out.notes=list('nota');
    return out;
  }
  /* A saved form asks for the refreshed page in the same answer (withState),
     so the device does not need a second request after every save. */
  function reply(module,row,p,me){var out={record:coreCommerceLean(view(row))};if(p.withState===true&&(module==='pembelian'||module==='nota'))out.commerce=stateOf(module,me);return out;}
  function expected(row,p){if(!p.expectedRevision||p.expectedRevision!==view(row).revision)fail('Catatan berubah sejak formulir dibuka. Muat ulang dan periksa lagi.');}
  function checkRows(table,rows){if(store.validateRows)store.validateRows(table,rows);else rows.forEach(function(r){Object.keys(r).forEach(function(k){if(String(r[k]).length>49000)fail('Catatan terlalu panjang untuk disimpan.');});});}
  function sourcePicture(v){if(!v)return '';if(typeof v!=='string'||v.length>48000||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v))fail('Gambar harus JPEG/PNG/WebP berukuran kecil.');return v;}
  function normalize(kind,r,previous){
    var out={id:id(r.id)},old=previous&&coreCommerceData(previous);
    if(kind==='supplier'){out.nama=text(r.nama,100,true);out.kontak=text(r.kontak,80);out.alamat=text(r.alamat,400);out.catatan=text(r.catatan,500);out.aktif=r.aktif!==false;}
    if(kind==='product'){out.nama=text(r.nama,100,true);out.kategori=text(r.kategori,80);out.model=text(r.model,80);out.warna=text(r.warna,80);out.supplierId=id(r.supplierId);if(!find('pembelian','supplier',out.supplierId))fail('Supplier tidak ditemukan.');out.harga=r.harga==null||r.harga===''?0:num(r.harga,1e12,false,true);out.catatan=text(r.catatan,500);out.aktif=r.aktif!==false;out.gambar=r.gambar===undefined&&old?old.gambar||'':sourcePicture(r.gambar);}
    if(kind==='order'||kind==='nota'){
      if(!(r.items instanceof Array)||!r.items.length||r.items.length>100)fail('Isi 1 sampai 100 baris barang.');var seen={};
      out.items=r.items.map(function(i){var x={id:id(i.id)};if(seen[x.id])fail('Identitas baris barang ganda.');seen[x.id]=true;
        if(kind==='order'){x.nama=text(i.nama,120,true);x.jumlah=num(i.jumlah,1e8,true,true);}else{x.name=text(i.name,120,true);x.size=text(i.size,40);x.color=text(i.color,60);x.qty=num(i.qty,1e8,true,true);x.price=num(i.price,1e12,false,true);x.discPercent=num(i.discPercent===undefined?0:i.discPercent,100,false,false);x.subtotal=Math.round(x.qty*x.price*(100-x.discPercent)/100);if(!Number.isSafeInteger(x.subtotal))fail('Subtotal terlalu besar.');}return x;});
      if(kind==='order'){out.produkId=id(r.produkId);var product=find('pembelian','product',out.produkId),pd=coreCommerceData(product),supplier=find('pembelian','supplier',pd.supplierId),sd=coreCommerceData(supplier);if(!product||!supplier||pd.aktif===false||sd.aktif===false)fail('Produk atau supplier pembelian tidak ditemukan atau tidak aktif.');out.productSnapshot={id:pd.id,nama:pd.nama,model:pd.model||'',warna:pd.warna||'',supplierId:pd.supplierId};out.supplierSnapshot={id:sd.id,nama:sd.nama,kontak:sd.kontak||'',alamat:sd.alamat||''};out.grupNama=text(r.grupNama,100);out.hargaSatuan=num(r.hargaSatuan,1e12,false,true);out.tanggalOrder=date(r.tanggalOrder);out.totalHarga=out.items.reduce(function(n,i){return n+i.jumlah*out.hargaSatuan;},0);out.catatan=text(r.catatan,1000);if(!Number.isSafeInteger(out.totalHarga))fail('Total terlalu besar.');}
      else{var c=r.customer||{};out.customer={name:text(c.name,120,true),phone:text(c.phone,60),address:text(c.address,400),type:c.type==='reseller'?'reseller':'walkin'};out.date=date(r.date);out.discountPercent=num(r.discountPercent===undefined?0:r.discountPercent,100,false,false);out.shipping=num(r.shipping===undefined?0:r.shipping,1e12,false,true);out.subtotal=out.items.reduce(function(n,i){return n+i.subtotal;},0);out.discountAmount=Math.round(out.subtotal*out.discountPercent/100);out.total=out.subtotal-out.discountAmount+out.shipping;out.notes=text(r.notes,1000);if(!Number.isSafeInteger(out.total))fail('Total terlalu besar.');}
      out.cancelled=old?!!old.cancelled:false;if(out.cancelled)fail('Catatan yang dibatalkan tidak dapat diubah.');
      if(previous){var current=view(previous);
        if(kind==='nota'){if(current.events.length||previous.sourceHash)fail('Pesanan/nota yang sudah mempunyai riwayat disimpan tetap. Koreksi melalui pembatalan event atau buat catatan baru.');}
        /* A purchase order entered in this application may still be corrected after payments or receipts,
           as the earlier application allowed, but never against what was already paid or received.
           Imported orders and orders still held for review stay fixed. */
        else if(previous.sourceHash||current.needsReview)fail('Pesanan dari data lama atau yang masih perlu diperiksa disimpan tetap. Koreksi transaksinya atau buat pesanan baru.');
        else if(current.events.length){
          if(out.produkId!==old.produkId)fail('Produk tidak dapat diganti setelah ada pembayaran atau penerimaan.');
          if(old.productSnapshot)out.productSnapshot=old.productSnapshot;if(old.supplierSnapshot)out.supplierSnapshot=old.supplierSnapshot;
          var got=current.receivedByItem||{};Object.keys(got).forEach(function(k){if(!coreNum(got[k]))return;var kept=out.items.filter(function(i){return i.id===k;})[0];if(!kept||kept.jumlah<coreNum(got[k]))fail('Varian yang sudah diterima tidak boleh dihapus atau dikurangi di bawah jumlah yang diterima.');});
          if(out.totalHarga<current.totalPaid)fail('Total pesanan tidak boleh lebih kecil dari yang sudah dibayar.');
        }
      }
    }
    return out;
  }
  function tender(payment,d){if(payment.tenderedAmount===undefined)return d;var amount=num(payment.tenderedAmount,1e15,false,true);if(d.metode!=='cash'||amount<d.jumlah)fail('Uang diterima tunai harus setidaknya sama dengan pembayaran tagihan.');d.tenderedAmount=amount;d.change=amount-d.jumlah;return d;}
  function initial(r,kind,record,me){if(kind!=='nota'&&kind!=='order')return null;var payment=r.initialPayment||r.payment;if(!payment)return null;var amount=payment.jumlah===undefined?payment.amount:payment.jumlah;if(amount===undefined||Number(amount)===0)return null;amount=num(amount,1e15,true,true);var total=kind==='nota'?record.total:record.totalHarga;if(amount>total)fail('Pembayaran tidak boleh melebihi total tagihan.');var parentDate=kind==='nota'?record.date:record.tanggalOrder,payDate=date(payment.tanggal||parentDate);if(payDate<parentDate)fail('Tanggal pembayaran awal tidak boleh sebelum pesanan/nota.');return tender(payment,{id:'initial_'+coreCommerceHash([kind,record.id]).slice(0,32),kind:'payment',tanggal:payDate,jumlah:amount,metode:text(payment.metode||payment.method||'cash',40,true),catatan:text(payment.catatan,300),createdBy:me.id,createdAt:now()});}
  function save(module,kind,p){
    var me=writable(p),r=p.record||{},key=id(r.id),old=find(module,kind,key),actor=me.id;
    var rawIntent=coreCommerceCopy(r);delete rawIntent.revision;var intent=coreCommerceHash({kind:kind,input:rawIntent,before:p.expectedRevision||''});
    if(old){var data=coreCommerceData(old);if(!p.expectedRevision&&data._createHash===intent&&data._createActor===actor)return reply(module,old,p,me);if(data._lastMutation&&data._lastMutation.hash===intent&&data._lastMutation.actor===actor)return reply(module,old,p,me);expected(old,p);}
    else if(p.expectedRevision)fail('Catatan asal tidak ditemukan.');
    var data=normalize(kind,r,old);if(kind==='nota'){if(old)data.noNota=coreCommerceData(old).noNota||key;else{var prefix='SA-'+data.date.replace(/-/g,'').slice(2)+'-',sequence=0;store.read('CommerceImport').forEach(function(row){sequence=Math.max(sequence,coreNum((coreCommerceData(row).summary||{}).notaCounter));});all().filter(function(row){return row.kind==='nota';}).forEach(function(row){var note=coreCommerceData(row),n=String(note.noNota||note.id||''),match=/^SA-\d{6}-(\d+)$/.exec(n);if(match)sequence=Math.max(sequence,Number(match[1]));});if(sequence>=999999)fail('Nomor nota tanggal ini penuh.');data.noNota=prefix+('000'+(sequence+1)).slice(-Math.max(3,String(sequence+1).length));}}
    if(old){var prev=coreCommerceData(old);data._createHash=prev._createHash;data._createActor=prev._createActor;if(prev._initialPayment)data._initialPayment=prev._initialPayment;}else{data._createHash=intent;data._createActor=actor;var pay=initial(r,kind,data,me);if(pay)data._initialPayment=pay;}
    data._lastMutation={hash:intent,actor:actor};var stamp=now(),row={id:coreCommerceKey(module,kind,key),module:module,kind:kind,parentId:'',data:JSON.stringify(data),revision:coreCommerceHash([data,stamp,actor]),dibuat:old?old.dibuat:stamp,dibuatOleh:old?old.dibuatOleh:actor,diubah:stamp,sourceHash:old?old.sourceHash:''};
    checkRows('CommerceRecord',[row]);if(old)store.update('CommerceRecord',old.id,row);else store.append('CommerceRecord',row);return reply(module,row,p,me);
  }
  actions.saveCommerceSupplier=function(p){return save('pembelian','supplier',p);};
  actions.saveCommerceProduct=function(p){return save('pembelian','product',p);};
  actions.saveCommerceOrder=function(p){return save('pembelian','order',p);};
  actions.saveCommerceNota=function(p){return save('nota','nota',p);};
  function event(p,kind){
    var me=writable(p,kind==='void'),module=p.module||'pembelian';if(['pembelian','nota'].indexOf(module)<0)fail('Modul tidak dikenal.');
    var key=id(p.id),parent=id(p.parentId||p.orderId),row=find(module,module==='nota'?'nota':'order',parent),record=view(row);
    var prior=store.read('CommerceEvent').filter(function(e){return e.id===key;})[0];
    var d={tanggal:date(p.tanggal||(prior?coreCommerceData(prior).tanggal:String(ctx.env.now().toISOString()).slice(0,10))),catatan:text(p.catatan,500,kind==='void')};
    if(kind==='payment'){d.jumlah=num(p.jumlah,1e15,true,true);d.metode=text(p.metode||'cash',40,true);tender(p,d);}
    if(kind==='receipt'){if(module!=='pembelian')fail('Penerimaan hanya untuk pembelian.');d.itemId=id(p.itemId);d.jumlah=num(p.jumlah,1e8,true,true);d.kondisi=text(p.kondisi,100);}
    if(kind==='void')d.eventId=id(p.eventId);
    if(prior){if(prior.module!==module||prior.parentId!==parent||prior.kind!==kind||prior.dibuatOleh!==me.id||coreCommerceHash(coreCommerceData(prior))!==coreCommerceHash(d))fail('Identitas transaksi sudah digunakan untuk isi atau akun berbeda.');return reply(module,row,p,me);}
    expected(row,p);if(record.cancelled)fail('Catatan sudah dibatalkan.');/* pembelian: DP boleh dibayar kapan pun, juga sebelum tanggal order; nota penjualan tetap tidak boleh mendahului notanya */if(module==='nota'&&d.tanggal<String(record.date||'').slice(0,10))fail('Tanggal transaksi tidak boleh sebelum pesanan/nota.');
    if(kind==='payment'&&(record.paymentReview||d.jumlah>record.balance))fail('Pembayaran melebihi sisa tagihan atau riwayat nominal perlu diperiksa.');
    if(kind==='receipt'){var item=(record.items||[]).filter(function(i){return i.id===d.itemId;})[0];if(record.receiptReview||!item)fail('Hubungan varian penerimaan perlu diperiksa; tidak boleh ditebak.');if(d.jumlah>coreNum(item.jumlah)-coreNum(record.receivedByItem[d.itemId]))fail('Penerimaan melebihi sisa varian pesanan.');}
    if(kind==='void'){var source=record.events.filter(function(e){return e.id===d.eventId;})[0];if(!source||source.kind==='void'||source.voided)fail('Transaksi asal tidak ditemukan atau telah dibatalkan.');}
    var stored={id:key,module:module,parentId:parent,kind:kind,data:JSON.stringify(d),dibuat:now(),dibuatOleh:me.id,sourceHash:''};checkRows('CommerceEvent',[stored]);store.append('CommerceEvent',stored);return reply(module,row,p,me);
  }
  actions.appendCommercePayment=function(p){return event(p,'payment');};actions.appendCommerceReceipt=function(p){return event(p,'receipt');};actions.voidCommerceEvent=function(p){return event(p,'void');};
  /* Ubah pembayaran atau penerimaan yang sudah tercatat (owner): catatan lama dikoreksi dan penggantinya ditulis dalam
     satu langkah, sehingga owner tidak perlu mengoreksi lalu mengisi ulang. Catatan lama tetap ada sebagai riwayat. */
  actions.gantiCommerceEvent=function(p){
    var me=writable(p,true),module=p.module||'pembelian';if(['pembelian','nota'].indexOf(module)<0)fail('Modul tidak dikenal.');
    var key=id(p.id),parent=id(p.parentId||p.orderId),sourceId=id(p.eventId),row=find(module,module==='nota'?'nota':'order',parent),record=view(row);
    var sudah=store.read('CommerceEvent').filter(function(e){return e.id===key;})[0];
    if(sudah){if(sudah.module!==module||sudah.parentId!==parent||sudah.dibuatOleh!==me.id)fail('Identitas transaksi sudah digunakan untuk isi atau akun berbeda.');return reply(module,row,p,me);}
    expected(row,p);if(record.cancelled)fail('Catatan sudah dibatalkan.');
    var source=record.events.filter(function(e){return e.id===sourceId;})[0];
    if(!source||source.voided||(source.kind!=='payment'&&source.kind!=='receipt'))fail('Transaksi asal tidak ditemukan atau telah dibatalkan.');
    if(source.sourceReview)fail('Catatan lama yang masih perlu diperiksa tidak dapat diubah.');
    var kind=source.kind,d={tanggal:date(p.tanggal||source.tanggal),catatan:text(p.catatan,500)};
    if(module==='nota'&&d.tanggal<String(record.date||'').slice(0,10))fail('Tanggal transaksi tidak boleh sebelum pesanan/nota.');
    if(kind==='payment'){d.jumlah=num(p.jumlah,1e15,true,true);d.metode=text(p.metode||source.metode||'cash',40,true);
      if(record.paymentReview||d.jumlah>record.balance+coreNum(source.jumlah))fail('Pembayaran melebihi sisa tagihan atau riwayat nominal perlu diperiksa.');}
    else{if(module!=='pembelian')fail('Penerimaan hanya untuk pembelian.');d.itemId=id(p.itemId||source.itemId);d.jumlah=num(p.jumlah,1e8,true,true);d.kondisi=text(p.kondisi===undefined?String(source.kondisi||''):p.kondisi,100);
      var item=(record.items||[]).filter(function(i){return i.id===d.itemId;})[0];if(record.receiptReview||!item)fail('Hubungan varian penerimaan perlu diperiksa; tidak boleh ditebak.');
      var diterima=coreNum(record.receivedByItem[d.itemId])-(source.itemId===d.itemId?coreNum(source.jumlah):0);
      if(d.jumlah>coreNum(item.jumlah)-diterima)fail('Penerimaan melebihi sisa varian pesanan.');}
    var stamp=now(),rows=[{id:'gv_'+coreCommerceHash([key,sourceId]).slice(0,40),module:module,parentId:parent,kind:'void',data:JSON.stringify({tanggal:String(stamp).slice(0,10),catatan:'Diubah menjadi catatan baru',eventId:sourceId}),dibuat:stamp,dibuatOleh:me.id,sourceHash:''},
      {id:key,module:module,parentId:parent,kind:kind,data:JSON.stringify(d),dibuat:stamp,dibuatOleh:me.id,sourceHash:''}];
    checkRows('CommerceEvent',rows);store.appendMany('CommerceEvent',rows);return reply(module,row,p,me);
  };
  /* Bayar grup: one payment event per order, written together, all carrying the same groupId. */
  actions.appendCommerceGroupPayment=function(p){
    var me=writable(p),key=id(p.id),ids=p.orderIds,seen={};if(!(ids instanceof Array)||ids.length<2||ids.length>40)fail('Pilih 2 sampai 40 order untuk pembayaran grup.');
    var rows=ids.map(function(k){k=id(k);if(seen[k])fail('Order ganda dalam pembayaran grup.');seen[k]=true;var row=find('pembelian','order',k);if(!row)fail('Catatan tidak ditemukan.');return row;});
    var d={tanggal:date(p.tanggal||String(ctx.env.now().toISOString()).slice(0,10)),catatan:text(p.catatan,500),metode:text(p.metode||'transfer',40,true)},amount=num(p.jumlah,1e15,true,true);
    function eventId(orderId){return 'gp_'+coreCommerceHash([key,orderId]).slice(0,40);}
    function answer(){var out={groupId:key};if(p.withState===true)out.commerce=stateOf('pembelian',me);return out;}
    var prior=store.read('CommerceEvent').filter(function(e){return e.module==='pembelian'&&e.kind==='payment'&&coreCommerceData(e).groupId===key;});
    if(prior.length){
      var same=prior.every(function(e){var x=coreCommerceData(e);return e.dibuatOleh===me.id&&seen[e.parentId]&&e.id===eventId(e.parentId)&&x.tanggal===d.tanggal&&x.metode===d.metode&&x.catatan===d.catatan;})&&prior.reduce(function(n,e){return n+coreNum(coreCommerceData(e).jumlah);},0)===amount;
      if(!same)fail('Identitas transaksi sudah digunakan untuk isi atau akun berbeda.');return answer();
    }
    var views=rows.map(view);
    views.forEach(function(v){if(!p.expectedRevisions||p.expectedRevisions[v.id]!==v.revision)fail('Catatan berubah sejak formulir dibuka. Muat ulang dan periksa lagi.');if(v.cancelled)fail('Catatan sudah dibatalkan.');if(v.paymentReview)fail('Riwayat nominal salah satu order perlu diperiksa. Keluarkan order itu dari pembayaran grup.');});
    var shares=coreCommerceSplit(amount,views.map(function(v){return v.balance;}));if(!shares)fail('Pembayaran grup harus lebih dari nol dan tidak melebihi sisa tagihan grup.');
    var stamp=now(),stored=[];views.forEach(function(v,i){if(shares[i])stored.push({id:eventId(v.id),module:'pembelian',parentId:v.id,kind:'payment',data:JSON.stringify({tanggal:d.tanggal,catatan:d.catatan,jumlah:shares[i],metode:d.metode,groupId:key}),dibuat:stamp,dibuatOleh:me.id,sourceHash:''});});
    checkRows('CommerceEvent',stored);store.appendMany('CommerceEvent',stored);return answer();
  };
  actions.cancelCommerceRecord=function(p){var me=writable(p,true),module=p.module;if(['pembelian','nota'].indexOf(module)<0)fail('Modul tidak dikenal.');var row=find(module,module==='nota'?'nota':'order',id(p.id)),v=view(row),reason=text(p.catatan,500,true);if(v.cancelled){if(v.cancelledBy===me.id&&v.cancelReason===reason)return reply(module,row,p,me);fail('Catatan sudah dibatalkan.');}expected(row,p);
    /* arsip (owner, purchase orders from the old data or still marked "perlu diperiksa"): the order leaves the list as it is.
       Its old payments and receipts are neither corrected nor recalculated; they stay as evidence and come back with restoreCommerceRecord. */
    var arsip=p.arsip===true&&module==='pembelian'&&(!!row.sourceHash||v.needsReview);
    if(!arsip&&(v.paymentReview||v.receipts.some(function(e){return !e.voided&&e.sourceReview;})))fail('Periksa bukti nominal atau jumlah historis sebelum membatalkan catatan.');/* voidAll (owner, purchase orders entered here): an order that will not happen is removed in one step.
       Every payment and receipt still in force is corrected with the same reason, then the order is cancelled.
       Nothing is erased: the events stay in the ledger with their corrections. */
    if(arsip){}
    else if(p.voidAll===true&&module==='pembelian'&&(v.totalPaid||v.totalReceived)){
      if(row.sourceHash||v.needsReview)fail('Pesanan dari data lama atau yang masih perlu diperiksa tidak dapat dihapus sekaligus. Koreksi transaksinya satu per satu.');
      var voidStamp=now(),voidDate=String(ctx.env.now().toISOString()).slice(0,10),voids=v.events.filter(function(e){return e.kind!=='void'&&!e.voided&&e.id;}).map(function(e){return {id:'vd_'+coreCommerceHash([v.id,e.id]).slice(0,40),module:module,parentId:v.id,kind:'void',data:JSON.stringify({tanggal:voidDate,catatan:reason,eventId:e.id}),dibuat:voidStamp,dibuatOleh:me.id,sourceHash:''};});
      checkRows('CommerceEvent',voids);store.appendMany('CommerceEvent',voids);
    }
    else if(v.totalPaid||v.totalReceived)fail('Batalkan transaksi pembayaran/penerimaan yang masih berlaku terlebih dahulu.');var data=coreCommerceData(row);data.cancelled=true;data.cancelReason=reason;data.cancelledBy=me.id;data.cancelledAt=now();if(arsip)data.cancelKeepsEvents=true;row=Object.assign({},row,{data:JSON.stringify(data),revision:coreCommerceHash(data),diubah:now()});checkRows('CommerceRecord',[row]);store.update('CommerceRecord',row.id,row);return reply(module,row,p,me);};
  /* The owner's undo for "Hapus order": the order returns to the list. Corrections written by the removal stay as they are;
     an order that was already cancelled in the old data (no cancelledBy) is kept as it came. */
  actions.restoreCommerceRecord=function(p){var me=writable(p,true),module=p.module;if(module!=='pembelian')fail('Modul tidak dikenal.');var row=find(module,'order',id(p.id)),v=view(row);if(!v.cancelled)return reply(module,row,p,me);expected(row,p);var data=coreCommerceData(row);if(!data.cancelledBy)fail('Order ini sudah batal sejak data lama dan disimpan tetap.');
    data.restoredFrom={reason:data.cancelReason||'',by:data.cancelledBy,at:data.cancelledAt||''};data.restoredBy=me.id;data.restoredAt=now();['cancelled','cancelReason','cancelledBy','cancelledAt','cancelKeepsEvents'].forEach(function(k){delete data[k];});
    row=Object.assign({},row,{data:JSON.stringify(data),revision:coreCommerceHash(data),diubah:now()});checkRows('CommerceRecord',[row]);store.update('CommerceRecord',row.id,row);return reply(module,row,p,me);};
  function hppInput(config){
    var source=store.read('CommerceSource'),legacy={production:[],stock:{pembelian:[],rolInfo:{}},meta:{},cuttingPlans:[]};
    store.read('CommerceImport').filter(function(r){return r.status==='complete';}).forEach(function(manifest){var proof=coreCommerceData(manifest),subset=source.filter(function(r){return r.sourceHash===manifest.sourceHash;}).map(function(r){var out={};SCHEMA.CommerceSource.forEach(function(k){out[k]=r[k]===undefined?'':r[k];});return out;}).sort(function(a,b){return a.id.localeCompare(b.id);});if(subset.length!==proof.sourceRows||coreCommerceHash(subset)!==proof.sourceDigest)fail('Snapshot HPP asal tidak utuh atau berubah. Periksa cadangan impor sebelum menghitung.');});
    var manifestHashes={};store.read('CommerceImport').filter(function(r){return r.status==='complete';}).forEach(function(r){manifestHashes[r.sourceHash]=true;});if(source.some(function(r){return !manifestHashes[r.sourceHash];}))fail('Ada snapshot HPP tanpa manifest impor lengkap.');
    source.forEach(function(r){var data=coreCommerceData(r);if(r.kind==='hpp-production')legacy.production.push(data);if(r.kind==='hpp-purchase')legacy.stock.pembelian.push(data);if(r.kind==='hpp-rollinfo')legacy.stock.rolInfo[r.parentId]=data;if(r.kind==='hpp-meta')legacy.meta=data;if(r.kind==='hpp-plan')legacy.cuttingPlans.push(data);});
    legacy.workers=coreCommerceRows(legacy.meta.tukangJahit||legacy.meta.maklon||{});var input={config:config,legacy:legacy,tables:{},settings:ctx.settings()};['PO','Produk','Potong','SlipKirim','StokBahan','RencanaPotong','KoreksiRiwayat'].forEach(function(s){input.tables[s]=store.read(s);});return input;
  }
  actions.getCommerceState=function(p){var me=admin(p,false,true),module=p.module;if(['pembelian','nota','hpp'].indexOf(module)<0)fail('Modul tidak dikenal.');var waiting=pending();if(waiting.length)fail('Impor modul belum selesai. Owner perlu melanjutkan file yang sama sebelum modul dipakai.');var out=stateOf(module,me);
    if(module==='hpp'){var row=find('hpp','config','config');out.config=row?coreCommerceCopy(coreCommerceData(row)):{configs:{},modelConfigs:{},marketplace:{},pajak:0};['_lastMutation','_createHash','_createActor'].forEach(function(k){delete out.config[k];});out.revision=row?view(row).revision:'';if(typeof coreCommerceHpp==='function')Object.assign(out,coreCommerceHpp(hppInput(out.config)));else{out.models=[];out.warnings=['Perhitungan HPP belum tersedia.'];}}
    return out;
  };
  /* Photos for the products on screen. Each (product, revision) is kept in the
     small per-image cache, so repeat requests do not load the record table. */
  actions.getCommerceImages=function(p){admin(p,false,true);if(pending().length)fail('Impor modul belum selesai. Owner perlu melanjutkan file yang sama sebelum modul dipakai.');
    var seen={},items=(p.items instanceof Array?p.items:[]).slice(0,12).map(function(i){i=i||{};var rev=String(i.rev||'');if(!/^[a-f0-9]{8,64}$/.test(rev))fail('Identitas catatan tidak sah.');return {id:id(i.id),rev:rev,key:'cm.'+i.id+'.'+rev};}).filter(function(i){if(seen[i.id])return false;seen[i.id]=true;return true;});
    var out={},left=items;if(store.imgGet&&items.length){var hit=store.imgGet(items.map(function(i){return i.key;}));left=items.filter(function(i){if(!hit[i.key])return true;out[i.id]=hit[i.key];return false;});}
    if(left.length){var want={},fresh={},events=store.read('CommerceEvent');left.forEach(function(i){want[i.id]=i;});
      all().forEach(function(r){if(r.module!=='pembelian'||r.kind!=='product')return;var d=coreCommerceData(r),i=Object.prototype.hasOwnProperty.call(want,d.id)?want[d.id]:null;if(!i||!d.gambar||out[d.id])return;out[d.id]=d.gambar;if(coreCommerceRecordView(r,events,[]).revision.indexOf(i.rev)===0)fresh[i.key]=d.gambar;});
      if(store.imgPut)store.imgPut(fresh);}
    return {images:out};
  };  function saveHpp(p,settingsOnly){var me=writable(p),row=find('hpp','config','config'),current=row?coreCommerceCopy(coreCommerceData(row)):{id:'config',configs:{},modelConfigs:{},marketplace:{},pajak:0};var intent=coreCommerceHash({modelId:p.modelId,config:p.config,marketplace:p.marketplace,pajak:p.pajak,before:p.expectedRevision||''});if(current._lastMutation&&current._lastMutation.hash===intent&&current._lastMutation.actor===me.id)return {revision:view(row).revision};if(row)expected(row,p);else if(p.expectedRevision)fail('Konfigurasi asal tidak ditemukan.');
    if(settingsOnly){if(p.pajak!==undefined)current.pajak=num(p.pajak,100,false,false);if(p.marketplace!==undefined){if(!p.marketplace||typeof p.marketplace!=='object'||p.marketplace instanceof Array||Object.keys(p.marketplace).length>20)fail('Pengaturan marketplace tidak sah.');current.marketplace={};Object.keys(p.marketplace).forEach(function(k){id(k);var m=p.marketplace[k];current.marketplace[k]={nama:text(m.nama,80,true),fee:num(m.fee,100,false,false),fixedPerPcs:num(m.fixedPerPcs===undefined?0:m.fixedPerPcs,1e12,false,true)};});}}
    else{var modelId=text(p.modelId,500,true),config=p.config;if(typeof coreCommerceHpp!=='function'||typeof coreCommerceHppConfig!=='function')fail('Perhitungan HPP belum tersedia.');var model=coreCommerceHpp(hppInput(current)).models.filter(function(m){return m.id===modelId;})[0];if(!model||['__proto__','constructor','prototype'].indexOf(modelId)>=0)fail('Model HPP tidak ditemukan.');config=coreCommerceHppConfig(config,model);current.modelConfigs=current.modelConfigs||{};current.modelConfigs[modelId]=config;}
    current._lastMutation={hash:intent,actor:me.id};var stamp=now(),saved={id:coreCommerceKey('hpp','config','config'),module:'hpp',kind:'config',parentId:'',data:JSON.stringify(current),revision:coreCommerceHash(current),dibuat:row?row.dibuat:stamp,dibuatOleh:row?row.dibuatOleh:me.id,diubah:stamp,sourceHash:row?row.sourceHash:''};checkRows('CommerceRecord',[saved]);if(row)store.update('CommerceRecord',row.id,saved);else store.append('CommerceRecord',saved);return {revision:view(saved).revision};
  }
  actions.saveCommerceHpp=function(p){return saveHpp(p,false);};actions.saveCommerceHppSettings=function(p){return saveHpp(p,true);};
  actions.makeCommercePdf=function(p){admin(p,false,true);if(!ctx.env.makePdf)fail('PDF tersedia setelah aplikasi terpasang.');var module=p.module;if(['pembelian','nota'].indexOf(module)<0)fail('Jenis dokumen tidak dikenal.');if(pending().length)fail('Impor belum selesai.');var grouped=p.ids!==undefined,ids=grouped?p.ids:[p.id];if(!(ids instanceof Array)||!ids.length||ids.length>20||grouped&&module!=='pembelian')fail('Pilih 1 sampai 20 pesanan pembelian untuk PDF gabungan.');var seen={},supplierId='',records=ids.map(function(key){key=id(key);if(seen[key])fail('Pesanan gabungan tidak boleh ganda.');seen[key]=true;var record=view(find(module,module==='nota'?'nota':'order',key));if(p.expectedRevisions&&p.expectedRevisions[key]!==record.revision)fail('Pesanan berubah sejak pilihan cetak dibuka. Muat ulang dan pilih kembali.');if(grouped){var sid=(record.supplierSnapshot||{}).id;if(!sid||supplierId&&sid!==supplierId)fail('PDF gabungan harus memakai identitas supplier yang sama.');supplierId=sid;}return record;});var models=records.map(function(record){return coreCommerceSlipModel(module,record,{});}),name=grouped?'Pembelian-Gabungan.pdf':(module==='nota'?'Nota-':'Pembelian-')+p.id+'.pdf';return {base64:ctx.env.makePdf(coreSlipModelsHtml(models,ctx.settings()),name),nama:name};};
  if(typeof coreInstallCommerceMigration==='function')coreInstallCommerceMigration(actions,{store:store,env:ctx.env,auth:admin,fail:fail,fresh:fresh,pending:pending,checkRows:checkRows});
}

/* Additive admin commerce import. Original business snapshots stay immutable;
   source IDs are preserved and unresolved receipt references are never guessed. */
function coreCommerceImportInput(backup,reference) {
  function root(v){if(typeof v==='string')v=JSON.parse(v);return v&&v.soldier||v||{};}
  function clean(v){if(v===null||typeof v!=='object')return v;if(v instanceof Array)return v.map(clean);var out={};Object.keys(v).sort().forEach(function(k){if(!/^(pin|token|password|secret|apiKey|authDomain|databaseURL|deviceInfo)$/i.test(k))out[k]=clean(v[k]);});return out;}
  function obj(v){return typeof v==='string'?JSON.parse(v):v;}
  var b=root(backup),r=root(reference);if(b.format==='soldier-device-backup-v1')b={notaPenjualan_v1:b.data&&b.data.notaPenjualan_v1};var p=obj(b.soldier_pembelian_produk||b.pembelianProduk||{}),h=obj(b.soldier_hpp_cache_v1||b.hpp||{}),n=obj(b.notaPenjualan_v1||b.notaPenjualan||null),production=b.produksi||{},rp=r.produksi||{};
  if(b.transactions instanceof Array&&!n)n=b;
  var out={purchase:clean(p),hpp:clean(h),nota:n?clean(n):null,production:clean(production.produksi||[]),plans:clean(production.cuttingPlans||[]),stock:clean(b.stokBahan||{}),meta:{},referenceProducts:[],referenceProduction:[],referenceStock:{}};
  var meta=b.produksi_meta||r.produksi_meta||{};['jenisBahan','maklon','tarif','tarifJahit','tarifJenis','tukang','tukangJahit'].forEach(function(k){if(meta[k]!==undefined)out.meta[k]=clean(meta[k]);});
  if(reference){out.referenceProducts=clean((r.pembelianProduk||{}).produk||[]);out.referenceProduction=clean(rp.produksi||[]);out.referenceStock=clean(r.stokBahan||{});}
  return out;
}
function coreCommerceImportPlan(input,current) {
  input=input||{};current=current||{};var sourceHash=coreCommerceHash(input),batchId='commerce_'+sourceHash.slice(0,40),warnings=[],rows={CommerceSource:[],CommerceRecord:[],CommerceEvent:[]},summary={suppliers:0,products:0,orders:0,notes:0,notaCounter:Number.isSafeInteger(Number((input.nota||{}).counter))&&Number((input.nota||{}).counter)>=0?Number(input.nota.counter):0,payments:0,receipts:0,receiptReview:0,paymentReview:0,images:0,hppModels:0,hppProduction:0},seen={};
  function list(v){return coreCommerceRows(v);}
  function ident(v,fallback){var k=v===undefined||v===null?'':String(v);return k||fallback;}
  function validAmount(v){return v!==undefined&&v!==null&&v!==''&&typeof v!=='boolean'&&Number.isSafeInteger(Number(v))&&Number(v)>=0;}
  function push(table,row){var key=table+'|'+row.id;if(seen[key])throw new Error('Identitas catatan sumber ganda: impor tidak diterapkan.');seen[key]=true;rows[table].push(row);}
  function source(module,kind,id,data){push('CommerceSource',{id:coreCommerceKey(module,'source-'+kind,id),module:module,kind:kind,parentId:String(id),data:JSON.stringify(data),sourceHash:sourceHash});}
  function record(module,kind,data,raw){source(module,kind,data.id,raw);if(kind==='order'||kind==='nota')data.cancelled=!!raw.cancelled||raw.status==='batal';push('CommerceRecord',{id:coreCommerceKey(module,kind,data.id),module:module,kind:kind,parentId:'',data:JSON.stringify(data),revision:coreCommerceHash(data),dibuat:'',dibuatOleh:'legacy-import',diubah:'',sourceHash:sourceHash});}
  function event(module,parent,kind,raw,index,data){var originalId=ident(raw&&raw.id,'index:'+index),eventId=coreCommerceKey(module,kind,parent+'|'+originalId);data.sourceId=raw&&raw.id?String(raw.id):'';data.sourceIndex=index;data.sourceSnapshot=raw;push('CommerceEvent',{id:eventId,module:module,parentId:parent,kind:kind,data:JSON.stringify(data),dibuat:'',dibuatOleh:'legacy-import',sourceHash:sourceHash});summary[kind==='payment'?'payments':'receipts']++;}
  function canonical(v){if(v===null||v===undefined)return 'null';if(typeof v!=='object')return JSON.stringify(v);var keys=Object.keys(v).sort(),parts=[];keys.forEach(function(k){var s=canonical(v[k]);if(s!=='null')parts.push(JSON.stringify(k)+':'+s);});return parts.length?'{'+parts.join(',')+'}':'null';}
  var purchase=input.purchase||{},reference={};list(input.referenceProducts).forEach(function(p){if(p.id)reference[p.id]=p;});
  list(purchase.suppliers).forEach(function(raw,i){var data=coreCommerceCopy(raw);data.id=ident(raw.id,'source-supplier-'+i);record('pembelian','supplier',data,raw);summary.suppliers++;});
  list(purchase.produk||purchase.products).forEach(function(raw,i){var data=coreCommerceCopy(raw);data.id=ident(raw.id,'source-product-'+i);var ref=reference[data.id];
    if(!data.gambar&&ref&&ref.gambar){var a=coreCommerceCopy(raw),b=coreCommerceCopy(ref);delete a.gambar;delete b.gambar;delete a._hasImg;delete b._hasImg;if(canonical(a)===canonical(b)){data.gambar=ref.gambar;source('pembelian','product-image',data.id,{id:data.id,gambar:ref.gambar,identityHash:coreCommerceHash(a)});}else warnings.push('Gambar produk asal belum cocok dengan identitas produk terbaru.');}
    if(data.gambar)summary.images++;else if(data._hasImg)warnings.push('Sebagian gambar produk tidak ada di berkas sumber; data teks tetap tersedia.');record('pembelian','product',data,raw);summary.products++;
  });
  list(purchase.orders).forEach(function(raw,i){var data=coreCommerceCopy(raw);data.id=ident(raw.id,'source-order-'+i);delete data.pembayaran;delete data.penerimaan;data.items=list(raw.items).map(coreCommerceCopy);var pd=list(purchase.produk||purchase.products).filter(function(p){return p.id===data.produkId;})[0]||{},sd=list(purchase.suppliers).filter(function(s){return s.id===pd.supplierId;})[0]||{};data.productSnapshot={id:pd.id||'',nama:pd.nama||'',model:pd.model||'',warna:pd.warna||'',supplierId:pd.supplierId||''};data.supplierSnapshot={id:sd.id||'',nama:sd.nama||'',kontak:sd.kontak||'',alamat:sd.alamat||''};record('pembelian','order',data,raw);summary.orders++;
    list(raw.pembayaran).forEach(function(e,index){event('pembelian',data.id,'payment',e,index,{tanggal:String(e.tanggal||''),jumlah:coreNum(e.jumlah),metode:String(e.metode||''),catatan:String(e.catatan||e.ket||''),sourceReview:!validAmount(e.jumlah)});});
    list(raw.penerimaan).forEach(function(e,index){event('pembelian',data.id,'receipt',e,index,{tanggal:String(e.tanggal||''),jumlah:coreNum(e.jumlah),itemId:String(e.itemId||''),kondisi:String(e.kondisi||''),catatan:String(e.catatan||e.ket||''),sourceReview:!validAmount(e.jumlah)});});
  });
  if(input.nota){source('nota','nota-meta','meta',{counter:input.nota.counter});list(input.nota.transactions).forEach(function(raw,i){var data=coreCommerceCopy(raw);data.id=ident(raw.id,'source-nota-'+i);data.noNota=raw.noNota||data.id;delete data.payment;data.items=list(raw.items).map(coreCommerceCopy);record('nota','nota',data,raw);summary.notes++;var payment=raw.payment||{},amount=coreNum(payment.amount),change=coreNum(payment.change),validChange=payment.method==='cash'&&change>=0&&change<=amount;
    var paymentInvalid=Object.prototype.hasOwnProperty.call(payment,'amount')&&!validAmount(payment.amount)||Object.prototype.hasOwnProperty.call(payment,'change')&&!validAmount(payment.change);
    if(amount||change||paymentInvalid)event('nota',data.id,'payment',payment,0,{tanggal:String(raw.date||'').slice(0,10),jumlah:validChange?amount-change:amount,metode:String(payment.method||''),catatan:'Pembayaran awal dari nota asal',tenderedAmount:amount,change:change,sourceReview:paymentInvalid||change>0&&!validChange});
    list(payment.pelunasan).forEach(function(e,index){var v=e.amount===undefined?e.jumlah:e.amount;event('nota',data.id,'payment',e,index+1,{tanggal:String(e.date||e.tanggal||'').slice(0,10),jumlah:coreNum(v),metode:String(e.method||e.metode||''),catatan:String(e.notes||e.catatan||e.ket||''),sourceReview:!validAmount(v)});});
  });}else warnings.push('Berkas ini tidak memuat notaPenjualan_v1. Nota lama belum diimpor; perlu ekspor dari perangkat aplikasi asal.');
  var h=input.hpp||{};if(Object.keys(h).length){var config={id:'config',configs:coreCommerceCopy(h.configs||{}),modelConfigs:coreCommerceCopy(h.modelConfigs||{}),marketplace:coreCommerceCopy(h.marketplace||{}),pajak:coreNum(h.pajak)};record('hpp','config',config,h);summary.hppModels=Object.keys(config.modelConfigs).length;}
  var production=list(input.production),referenceProduction=list(input.referenceProduction),stock=input.stock||{};
  if(!Object.keys(stock).length&&Object.keys(input.referenceStock||{}).length){if(!production.length||canonical(input.production)!==canonical(input.referenceProduction))warnings.push('Sumber bahan HPP referensi tidak dipakai karena produksi belum terbukti identik.');else stock=input.referenceStock;}
  production.forEach(function(raw,i){source('hpp','hpp-production',ident(raw.id,'index:'+i),raw);summary.hppProduction++;});
  list(stock.pembelian).forEach(function(raw,i){source('hpp','hpp-purchase',ident(raw.id,'index:'+i),raw);});
  Object.keys(stock.rolInfo||{}).sort().forEach(function(k){source('hpp','hpp-rollinfo',k,stock.rolInfo[k]);});
  if(Object.keys(input.meta||{}).length)source('hpp','hpp-meta','meta',input.meta);
  list(input.plans).forEach(function(raw,i){source('hpp','hpp-plan',ident(raw.id,'index:'+i),raw);});
  rows.CommerceRecord.filter(function(r){return r.kind==='order'||r.kind==='nota';}).forEach(function(r){var v=coreCommerceRecordView(r,rows.CommerceEvent,rows.CommerceRecord);if(v.receiptReview)summary.receiptReview++;if(v.paymentReview)summary.paymentReview++;});
  if(summary.receiptReview)warnings.push('Penerimaan lama yang belum cocok dengan ID varian ditahan untuk diperiksa; tidak ditautkan berdasarkan nama/urutan.');
  var manifest=(current.CommerceImport||[]).filter(function(r){return r.id===batchId;})[0],others=(current.CommerceImport||[]).filter(function(r){return r.status!=='complete'&&r.id!==batchId;});
  if(others.length)throw new Error('Ada impor lain yang belum selesai. Lanjutkan berkas asal yang sama.');
  var planHash=coreCommerceHash(rows),applied=!!(manifest&&manifest.status==='complete'),pending=!!(manifest&&!applied);
  if(manifest&&(manifest.sourceHash!==sourceHash||manifest.planHash!==planHash))throw new Error('Manifest impor tidak cocok dengan berkas atau konverter saat ini.');
  if(!applied)Object.keys(rows).forEach(function(table){var existing={};(current[table]||[]).forEach(function(r){existing[r.id]=r;});rows[table].forEach(function(r){var old=existing[r.id];if(!old)return;var same=SCHEMA[table].every(function(k){return String(old[k]===undefined?'':old[k])===String(r[k]===undefined?'':r[k]);});if(!same)throw new Error('Catatan dengan ID sumber yang sama sudah memiliki isi berbeda; impor tidak menimpa data saat ini.');});});
  return {ready:true,batchId:batchId,sourceHash:sourceHash,planHash:planHash,summary:summary,warnings:Array.from(new Set(warnings)),rows:rows,applied:applied,pending:pending};
}
function coreInstallCommerceMigration(actions,ctx) {
  var tables=['CommerceSource','CommerceRecord','CommerceEvent','CommerceImport'];
  function current(){var out={};tables.forEach(function(t){out[t]=ctx.store.read(t);});return out;}
  function plan(p){return coreCommerceImportPlan(coreCommerceImportInput(p.backup,p.reference),current());}
  function output(result){return {ready:result.ready,sourceHash:result.sourceHash,planHash:result.planHash,summary:result.summary,warnings:result.warnings,applied:result.applied,pending:result.pending};}
  actions.previewCommerceImport=function(p){ctx.auth(p,true);ctx.fresh(tables);var result=plan(p);Object.keys(result.rows).forEach(function(t){ctx.checkRows(t,result.rows[t]);});return output(result);};
  actions.applyCommerceImport=function(p){var me=ctx.auth(p,true);ctx.fresh(tables);var result=plan(p);if(p.sourceHash!==result.sourceHash||p.planHash!==result.planHash)ctx.fail('Bukti preview berbeda. Periksa berkas dan jalankan preview ulang.');if(result.applied)return output(result);
    var stamp=ctx.env.now().toISOString(),sourceRows=result.rows.CommerceSource.slice().sort(function(a,b){return a.id.localeCompare(b.id);}),manifest={id:result.batchId,sourceHash:result.sourceHash,planHash:result.planHash,status:'pending',data:JSON.stringify({summary:result.summary,warnings:result.warnings,sourceRows:sourceRows.length,sourceDigest:coreCommerceHash(sourceRows)}),dibuat:stamp,dibuatOleh:me.id,diubah:stamp};
    Object.keys(result.rows).forEach(function(t){ctx.checkRows(t,result.rows[t]);});ctx.checkRows('CommerceImport',[manifest]);
    var existing=ctx.store.read('CommerceImport').filter(function(r){return r.id===result.batchId;})[0];if(existing){if(existing.dibuatOleh!==me.id)ctx.fail('Impor harus dilanjutkan oleh owner yang memulainya.');manifest=Object.assign({},existing);}else ctx.store.append('CommerceImport',manifest);
    /* Durable pending marker precedes every business row. A timeout leaves a
       retryable exact manifest, and partial data is not shown as a usable module. */
    if(ctx.store.checkpoint)ctx.store.checkpoint(['CommerceImport']);
    Object.keys(result.rows).forEach(function(t){var ids={};ctx.store.read(t).forEach(function(r){ids[r.id]=true;});var add=result.rows[t].filter(function(r){return !ids[r.id];});if(add.length){if(ctx.store.appendMany)ctx.store.appendMany(t,add);else add.forEach(function(r){ctx.store.append(t,r);});}});
    if(ctx.store.checkpoint)ctx.store.checkpoint(tables.slice(0,3));
    var after=coreCommerceImportPlan(coreCommerceImportInput(p.backup,p.reference),current());if(after.planHash!==result.planHash)ctx.fail('Hasil impor belum cocok; lanjutkan pemulihan dengan berkas yang sama.');
    Object.keys(result.rows).forEach(function(t){var found={};ctx.store.read(t).forEach(function(r){found[r.id]=r;});result.rows[t].forEach(function(row){if(!found[row.id])ctx.fail('Baris impor belum tersimpan seluruhnya. Jalankan ulang dengan berkas yang sama.');});});
    manifest.status='complete';manifest.diubah=ctx.env.now().toISOString();ctx.store.update('CommerceImport',manifest.id,manifest);result.applied=true;result.pending=false;return output(result);
  };
}

