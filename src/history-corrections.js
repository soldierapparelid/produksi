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
