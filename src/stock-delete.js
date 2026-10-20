/* Removing stock means recording its remaining physical balance as zero.
   Purchases, prices, usage and invoice evidence are never rewritten. */
function coreInstallStockDeleteActions(actions, ctx) {
  var store = ctx.store, fail = ctx.fail, EPS = 0.000001;
  function round(n) { return Math.round(n * 1000) / 1000; }
  function number(n) { return typeof n === 'number' && isFinite(n); }
  function refresh(p) {
    ['Pegawai','StokBahan','Potong','RencanaPotong','Pengaturan'].forEach(function (name) { if (store.fresh) store.fresh(name); });
    var me = ctx.auth(p);
    if (me.divisi !== 'owner') fail('Hanya owner yang boleh menghapus stok bahan.');
    return me;
  }
  function target(p) {
    var mode = String(p.mode || ''), name = String(p.bahan || '').trim().replace(/\s+/g, ' '), id = String(p.stokId || '');
    if (['bahan','rol','saldo'].indexOf(mode) < 0 || !name || name.length > 200 || mode === 'rol' && !id || mode !== 'rol' && id)
      fail('Pilih bahan atau rol yang akan dihapus dari stok.');
    return { mode:mode, bahan:name, key:coreNormBahan(name), stokId:id };
  }
  function list(value) {
    if (value === '' || value === null || value === undefined) return [];
    var parsed = coreParseJSON(value, null);
    if (!(parsed instanceof Array)) fail('Rincian pemakaian atau cadangan bahan perlu diperiksa sebelum menghapus stok.');
    return parsed;
  }
  function preview(t, stock, cuts, plans, st) {
    var inv = coreRollInventory(cuts, stock, st, plans), material = inv.materials.filter(function (m) { return m.kunci === t.key; })[0];
    var rolls = inv.rolls.filter(function (r) { return coreNormBahan(r.bahan) === t.key; }), pool = inv.legacyMap[t.key], sourceIds = {};
    rolls.forEach(function (r) { sourceIds[r.id] = true; });
    if (!material || !pool || !coreStockPriceUnit(material.satuan)) fail('Bahan tidak ditemukan dalam stok. Muat ulang daftar bahan.');
    if (material.sembunyi) fail('Aktifkan bahan ini terlebih dahulu sebelum menghapus stoknya.');
    var cohortStock = stock.filter(function (r) { return coreNormBahan(r.bahan) === t.key || sourceIds[r.sourceStockId]; }), ids = {};
    cohortStock.forEach(function (r) {
      if (!r.id || ids[r.id]) fail('Identitas catatan stok ganda atau tidak lengkap. Periksa riwayat bahan.');
      ids[r.id] = true;
      if (['beli','rinci','koreksi','harga'].indexOf(r.jenis) < 0 || coreStockPriceUnit(r.satuan || 'kg') !== material.satuan ||
          !number(r.qty) || Math.abs(r.qty) > 1e9 || Math.abs(r.qty * 1000 - Math.round(r.qty * 1000)) > EPS ||
          (r.jenis === 'beli' || r.jenis === 'rinci') && !(r.qty > 0) ||
          r.jenis === 'koreksi' && r.sourceStockId && !sourceIds[r.sourceStockId])
        fail('Jumlah, satuan, atau sumber stok tidak cocok. Periksa riwayat bahan sebelum menghapusnya.');
    });
    function related(r) {
      var allocations = list(r.alokasiBahan), materials = list(r.bahanList), legacy = list(r.legacyBahanList);
      return coreNormBahan(r.bahan) === t.key || materials.concat(legacy).some(function (b) { return b && coreNormBahan(b.nama) === t.key; }) ||
        allocations.some(function (a) { return a && sourceIds[a.stokId]; });
    }
    var cohortCuts = cuts.filter(related), cohortPlans = plans.filter(related);
    cohortCuts.concat(cohortPlans).forEach(function (r) {
      var materials = list(r.bahanList).concat(list(r.legacyBahanList));
      if (!materials.length && coreNormBahan(r.bahan) === t.key) materials.push({nama:r.bahan,qty:r.kg});
      materials.filter(function (b) { return b && coreNormBahan(b.nama) === t.key; }).forEach(function (b) {
        var qty = coreCutPlanNumber(b.qty);
        if (!isFinite(qty) || qty < 0 || qty > 1e9 || b.satuan && coreStockPriceUnit(b.satuan) !== material.satuan)
          fail('Jumlah atau satuan pemakaian bahan tidak cocok. Periksa riwayat potong terlebih dahulu.');
      });
      list(r.alokasiBahan).filter(function (a) { return a && sourceIds[a.stokId]; }).forEach(function (a) {
        var qty = coreCutPlanNumber(a.qty);
        if (!isFinite(qty) || qty <= 0 || qty > 1e9) fail('Jumlah pemakaian atau cadangan rol perlu diperiksa.');
      });
    });
    [material,pool].concat(rolls).forEach(function (r) {
      if (!number(r.saldo) || !number(r.dicadangkan) || !number(r.tersedia) || r.saldo < -EPS || r.dicadangkan < -EPS || r.tersedia < -EPS || r.status === 'periksa')
        fail('Saldo atau cadangan stok tidak cocok. Periksa riwayat bahan sebelum menghapusnya.');
    });
    var reserved = pool.dicadangkan + rolls.reduce(function (sum, r) { return sum + r.dicadangkan; }, 0);
    if (Math.abs(reserved - material.dicadangkan) > EPS) fail('Rincian cadangan bahan tidak cocok. Periksa persiapan potong terlebih dahulu.');
    var selected = t.mode === 'rol' ? rolls.filter(function (r) { return r.id === t.stokId; }) : t.mode === 'bahan' ? rolls.slice() : [];
    if (t.mode === 'rol' && selected.length !== 1) fail('Rol tidak ditemukan pada bahan yang dipilih.');
    if ((t.mode === 'bahan' ? material.dicadangkan : t.mode === 'saldo' ? pool.dicadangkan : selected[0].dicadangkan) > EPS)
      fail('Stok masih dicadangkan untuk PO. Ubah atau batalkan persiapan potong terkait terlebih dahulu.');
    selected.sort(function (a,b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    var items = selected.filter(function (r) { return r.saldo > EPS; }).map(function (r) {
      return { stokId:r.id,bahan:r.bahan,satuan:r.satuan,qty:r.saldo,rollLabel:r.rollLabel || '',invoice:r.invoice || '',
        sourceRevision:r.sourceRevision,previousCorrectionId:r.correctionRevision || '' };
    });
    if (t.mode !== 'rol' && pool.saldo > EPS) items.push({ stokId:'',bahan:material.nama,satuan:material.satuan,qty:pool.saldo,rollLabel:'Saldo belum dirinci',invoice:'',sourceRevision:'',previousCorrectionId:'' });
    if (!items.length) fail('Stok yang dipilih sudah kosong.');
    if (items.length > 1000) fail('Pilih rol secara bertahap; satu penghapusan maksimal 1.000 catatan stok.');
    var revision = coreHash(coreDomainCanonical({
      action:'hapus-stok-v1',mode:t.mode,key:t.key,stokId:t.stokId,stock:cohortStock,cuts:cohortCuts,plans:cohortPlans,
      stokMulai:st.stokMulai || '',sembunyi:!!material.sembunyi
    }));
    return { mode:t.mode,bahan:material.nama,satuan:material.satuan,qty:round(items.reduce(function (n,r) { return n+r.qty; },0)),
      rollCount:items.filter(function (r) { return !!r.stokId; }).length,items:items,revision:revision };
  }
  function response(id, rows, replay) {
    return { id:id,bahan:rows[0].bahan,satuan:rows[0].satuan,qty:round(-rows.reduce(function (n,r) { return n+r.qty; },0)),
      rollCount:rows.filter(function (r) { return !!r.sourceStockId; }).length,rows:rows,alreadyApplied:!!replay };
  }
  actions.getHapusStokBahan = function (p) {
    refresh(p);
    return preview(target(p), store.read('StokBahan'), store.read('Potong'), store.read('RencanaPotong'), ctx.settings());
  };
  actions.hapusStokBahan = function (p) {
    var me = refresh(p), t = target(p), id = String(p.id || ''), proof = String(p.expectedRevision || ''), note = String(p.catatan || '').trim();
    if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) fail('Identitas penghapusan stok tidak sah. Buka ulang formulir.');
    if (!proof) fail('Versi stok tidak tersedia. Muat ulang lalu periksa ringkasan penghapusan.');
    if (!note || note.length > 300) fail('Isi alasan penghapusan stok, maksimal 300 karakter.');
    var hash = coreHash(coreDomainCanonical(['hapus-stok-v1',t.mode,t.key,t.stokId,proof,note,me.id]));
    var stock = store.read('StokBahan'), old = stock.filter(function (r) { return r.invoiceId === id || r.id === id || String(r.id || '').indexOf(id + '-r') === 0; });
    var count = 0, seen = {};
    old.forEach(function (r) {
      var match = /^hapus-stok-v1:(\d+)$/.exec(r.sumber || ''), n = match ? Number(match[1]) : 0;
      var index = r.id === id ? 1 : Number(r.id.slice((id + '-r').length));
      if (!n || n > 1000 || count && count !== n || r.invoiceId !== id || r.alasan !== 'hapus_stok' || r.jenis !== 'koreksi' ||
          r.requestHash !== hash || r.requestActor !== me.id || r.dibuatOleh !== me.id || r.catatan !== note ||
          coreNormBahan(r.bahan) !== t.key || !coreStockPriceUnit(r.satuan) || !number(r.qty) || !(r.qty < 0) ||
          r.saldoAfter !== 0 || r.saldoBefore !== -r.qty || index < 1 || index > n || index !== Math.floor(index) || seen[index] ||
          r.id !== (index === 1 ? id : id + '-r' + index) || t.mode === 'rol' && r.sourceStockId !== t.stokId || t.mode === 'saldo' && r.sourceStockId)
        fail('Identitas penghapusan ini sudah dipakai dengan data berbeda. Periksa riwayat stok.');
      count = n; seen[index] = true;
    });
    if (old.length && old.length === count) return response(id, old, true);
    /* A partial transport failure may have committed a prefix of the one batch.
       Rebuild its original snapshot without our rows; never absorb later stock. */
    var original = stock.filter(function (r) { return old.indexOf(r) < 0; });
    var snapshot = preview(t, original, store.read('Potong'), store.read('RencanaPotong'), ctx.settings());
    if (snapshot.revision !== proof) fail('Stok atau cadangan berubah sejak ringkasan dibuka. Muat ulang lalu periksa lagi.');
    if (count && count !== snapshot.items.length) fail('Rincian penghapusan stok tidak cocok. Periksa riwayat stok.');
    var made = old.length ? old[0].dibuat : ctx.env.now().toISOString(), day = old.length ? old[0].tanggal : coreYmd(ctx.env.now());
    var rows = snapshot.items.map(function (item,index) {
      return { id:index ? id + '-r' + (index+1) : id,jenis:'koreksi',tanggal:day,bahan:item.bahan,qty:-item.qty,satuan:item.satuan,
        rol:0,harga:0,total:0,supplier:'',invoice:item.invoice,sumber:'hapus-stok-v1:' + snapshot.items.length,alasan:'hapus_stok',
        catatan:note,dibuatOleh:me.id,dibuat:made,asal:'',invoiceId:id,sourceStockId:item.stokId,
        saldoBefore:item.qty,saldoAfter:0,previousCorrectionId:item.previousCorrectionId,sourceRevision:item.sourceRevision || proof,
        requestHash:hash,requestActor:me.id };
    });
    var pending = [];
    rows.forEach(function (r) {
      var prior = old.filter(function (x) { return x.id === r.id; })[0];
      if (!prior) { pending.push(r); return; }
      if (Object.keys(r).some(function (k) { return String(prior[k] == null ? '' : prior[k]) !== String(r[k] == null ? '' : r[k]); }))
        fail('Bukti penghapusan yang tersimpan berbeda. Periksa riwayat stok.');
    });
    if (store.validateRows) store.validateRows('StokBahan', pending);
    store.appendMany('StokBahan', pending);
    return response(id, rows, false);
  };
}
