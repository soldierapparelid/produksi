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

