/* Prepared materials reserve availability; only the linked Potong row consumes
   physical stock. The link is the authoritative use marker, requiring one write. */
function coreCutPlanRows(plans, cuts) {
  var used = {};
  (cuts || []).forEach(function (r) { if (r.rencanaId) { if (!used[r.rencanaId]) used[r.rencanaId] = []; used[r.rencanaId].push(r); } });
  return (plans || []).map(function (r) {
    var out = {}; Object.keys(r).forEach(function (key) { out[key] = r[key]; });
    out.bahanList = coreParseJSON(r.bahanList, []);
    var match = used[r.id] || [];
    out.status = match.length ? 'terpakai' : r.status;
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
  return JSON.stringify({ poId: String(row.poId || ''), bahanList: coreParseJSON(row.bahanList, []).map(function (b) { return { nama: String(b.nama), qty: coreNum(b.qty), satuan: String(b.satuan || '') }; }), rol: coreNum(row.rol), catatan: String(row.catatan || ''), status: row.status || 'siap' });
}
/* Bulk replacements must preserve the authoritative use link and its source,
   including payroll snapshots. Reservations are never imported or recreated. */
function coreCutValidateReplacement(beforeCuts, afterCuts, plans, afterPO) {
  var before = {}, after = {}, poIds = {}, planIds = {}, links = {};
  (beforeCuts || []).forEach(function (r) { before[r.id] = r; });
  (afterCuts || []).forEach(function (r) { after[r.id] = r; });
  (afterPO || []).forEach(function (r) { poIds[r.id] = r; });
  var useIds = {}; (beforeCuts || []).forEach(function (r) { if (r.rencanaId) useIds[r.rencanaId] = true; });
  (plans || []).forEach(function (r) {
    planIds[r.id] = r;
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
