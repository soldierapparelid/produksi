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
/* Owner attestations are separate from the immutable imported cutting proof.
   They restore a missing physical trail, never prices, dates or QC results. */
function coreMissingSizeEntries(po) {
  var raw = coreMap(po && po.imporSumber).ownerSizeCorrections;
  if (raw === undefined) return [];
  if (!(raw instanceof Array) || raw.length > 40) throw new Error('Bukti pemulihan ukuran tidak sah.');
  var ids = {}, sizes = {};
  raw.forEach(function (entry) {
    var body = {}; Object.keys(entry || {}).forEach(function (key) { if (key !== 'proofHash' && key !== 'status') body[key] = entry[key]; });
    if (!entry || entry.version !== 1 || !/^[A-Za-z0-9_-]{6,32}$/.test(entry.id || '') || ids[entry.id] || sizes[entry.size] ||
        typeof entry.size !== 'string' || !entry.size.trim() || entry.size !== entry.size.trim() || entry.size.length > 40 || /^(?:__proto__|constructor|prototype)$/.test(entry.size) ||
        !(entry.initialQty > 0) || entry.initialQty !== Math.floor(entry.initialQty) || entry.initialQty > 1000000000 || !entry.maklonId || !entry.reason || !entry.createdBy || !entry.createdAt ||
        !entry.rows || entry.rows.Potong !== entry.id+'_cut' || entry.rows.SlipKirim !== entry.id+'_send' || entry.rows.SlipSetor !== entry.id+'_report' || !/^[a-f0-9]{64}$/.test(entry.expectedSourceHash || '') ||
        ['preparing','complete'].indexOf(entry.status) < 0 || entry.proofHash !== coreLegacyHash(body)) throw new Error('Bukti pemulihan ukuran tidak cocok.');
    ids[entry.id] = true; sizes[entry.size] = true;
  });
  return raw;
}
function coreMissingSizePending(po) { return coreMissingSizeEntries(po).some(function (entry) { return entry.status !== 'complete'; }); }
function coreOwnerReportedSetor(row) { return !!(row && row.asal === 'koreksi-ukuran' && coreMap(row.imporSumber).ownerSizeCorrection); }
function coreEffectiveCuttingEvidence(po) {
  var legacy = coreLegacyCuttingEvidence(po), native = legacy ? null : coreActiveSizes(po), base = legacy || native;
  if (base && !base.valid) return base;
  var entries;
  try { entries = coreMissingSizeEntries(po); } catch (e) { return {valid:false,ukuran:[]}; }
  if (!entries.length) return base;
  var sizes = base ? base.ukuran.slice() : Object.keys(coreMap(po && po.ukuran));
  entries.filter(function (entry) { return entry.status === 'complete'; }).forEach(function (entry) { if (sizes.indexOf(entry.size) < 0) sizes.push(entry.size); });
  return {valid:true,ukuran:coreSizeOrder(sizes),recoveryPending:entries.some(function (entry) { return entry.status !== 'complete'; })};
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

  var openingTables = ['Potong','SlipKirim','SlipSetor'], scopeTables = ['Potong','SlipKirim','SlipSetor','QC','Gudang','GudangLama','RencanaPotong','LegacySettlement','KoreksiRiwayat'];
  function missingContext(p) {
    fresh(['PO','Pegawai','Pengaturan'].concat(scopeTables));
    if ((store.getSettings() || {}).legacyMigrationStatus) ctx.fail('Pemulihan riwayat belum selesai.');
    var po = store.read('PO').filter(function (row) { return row.id === String(p.poId || ''); })[0];
    if (!po || po.status !== 'aktif' || !coreLegacyPO(po)) ctx.fail('Pemulihan ukuran hanya tersedia untuk PO lama yang masih aktif.');
    var evidence = coreLegacyCuttingEvidence(po);
    if (evidence && !evidence.valid) ctx.fail('Bukti ukuran potong asal perlu diperiksa dahulu.');
    var entries = coreMissingSizeEntries(po), sizes = Object.keys(coreMap(po.ukuran));
    if (evidence) sizes = sizes.concat(evidence.ukuran);
    entries.forEach(function (entry) { sizes.push(entry.size); });
    scopeTables.forEach(function (table) { store.read(table).filter(function (row) { return row.poId === po.id; }).forEach(function (row) {
      ['ukuran','rejectUkuran','offlineUkuran','perbaikanUkuran'].forEach(function (key) { sizes = sizes.concat(Object.keys(coreMap(row[key]))); });
      var allocations = coreParseJSON(row.alokasiBahan,[]);
      if (allocations instanceof Array) allocations.forEach(function (allocation) { if (allocation && typeof allocation.ukuran === 'string' && allocation.ukuran) sizes.push(allocation.ukuran); });
    }); });
    sizes = coreSizeOrder(sizes.filter(function (size,index,list) { return list.indexOf(size) === index; }));
    return {po:po,entries:entries,existingSizes:sizes};
  }
  function missingHash(context, omitEntry) {
    var po = {}, source = Object.assign({},coreMap(context.po.imporSumber)); delete source.ownerSizeCorrections;
    Object.keys(context.po).forEach(function (key) { if (key !== 'tuntasPada') po[key] = context.po[key]; }); po.imporSumber = JSON.stringify(source);
    var data = {po:po};
    scopeTables.forEach(function (table) { data[table] = store.read(table).filter(function (row) { return row.poId === po.id && (!omitEntry || row.id !== omitEntry.rows[table]); }).slice().sort(function (a,b) { return String(a.id).localeCompare(String(b.id)); }); });
    return coreLegacyHash(data);
  }
  function missingView(context) {
    var configured = ctx.settings ? ctx.settings().ukuran : (store.getSettings() || {}).ukuran || DEFAULT_SETTINGS.ukuran;
    return {poId:context.po.id,eligible:true,existingSizes:context.existingSizes,availableSizes:configured.filter(function (size) { return context.existingSizes.indexOf(size) < 0; }),
      sourceHash:missingHash(context),corrections:context.entries,pending:context.entries.filter(function (entry) { return entry.status !== 'complete'; })};
  }
  actions.getMissingSizeCorrection = function (p) { owner(p); return missingView(missingContext(p)); };
  actions.saveMissingSizeCorrection = function (p) {
    var me = owner(p), context = missingContext(p), id = String(p.id || ''), size = String(p.size || ''), reason = String(p.reason || '').trim(), qty = Number(p.initialQty), maklonId = String(p.maklonId || '');
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(id)) ctx.fail('Identitas pemulihan tidak sah. Buka kembali formulir.');
    if (p.initialQty === '' || p.initialQty === null || typeof p.initialQty === 'boolean' || !isFinite(qty) || qty <= 0 || qty !== Math.floor(qty) || qty > 1000000000) ctx.fail('Jumlah awal harus bilangan bulat 1 sampai 1.000.000.000 pcs.');
    if (!reason || reason.length > 300) ctx.fail('Isi alasan pemulihan, maksimal 300 karakter.');
    var entry = context.entries.filter(function (old) { return old.id === id; })[0], replayed = !!entry;
    if (entry) {
      if (entry.createdBy !== me.id || entry.size !== size || entry.initialQty !== qty || entry.maklonId !== maklonId || entry.reason !== reason || entry.expectedSourceHash !== p.expectedSourceHash) ctx.fail('Identitas pemulihan sudah dipakai untuk perubahan lain.');
      if (entry.status === 'complete') { var done = missingView(context); done.replayed = true; return done; }
      if (missingHash(context,entry) !== entry.expectedSourceHash) ctx.fail('Riwayat lain berubah selama pemulihan. Periksa bersama owner sebelum melanjutkan.');
    } else {
      if (context.entries.some(function (old) { return old.status !== 'complete'; })) ctx.fail('Selesaikan pemulihan ukuran yang tertunda dahulu.');
      if (missingView(context).availableSizes.indexOf(size) < 0) ctx.fail('Pilih ukuran yang benar-benar belum tercatat pada PO ini.');
      if (!p.expectedSourceHash || p.expectedSourceHash !== missingHash(context)) ctx.fail('Data berubah sejak formulir dibuka. Muat ulang sebelum menyimpan.');
      var worker = store.read('Pegawai').filter(function (row) { return row.id === maklonId; })[0];
      if (!worker || !worker.aktif || worker.divisi !== 'jahit') ctx.fail('Pilih penjahit aktif yang menangani ukuran ini.');
      entry = {version:1,id:id,size:size,initialQty:qty,maklonId:maklonId,reason:reason,expectedSourceHash:p.expectedSourceHash,createdBy:me.id,createdAt:ctx.env.now().toISOString(),rows:{Potong:id+'_cut',SlipKirim:id+'_send',SlipSetor:id+'_report'}};
      entry.proofHash = coreLegacyHash(entry); entry.status = 'preparing';
    }
    var ukuran = {}; ukuran[size] = qty;
    var note = 'Pemulihan ukuran oleh owner. Jumlah awal; barang kembali belum dihitung. Tanggal produksi dan biaya lama belum diketahui. ' + reason;
    var common = {poId:context.po.id,tanggal:'',ukuran:JSON.stringify(ukuran),total:qty,catatan:note.slice(0,300),dibuat:entry.createdAt,asal:'koreksi-ukuran',requestHash:entry.proofHash,requestActor:entry.createdBy};
    var rows = {
      Potong:Object.assign({},common,{id:entry.rows.Potong,userId:'',bahan:'',kg:0,rol:0,tarif:0,upahId:'',bahanList:'[]',alokasiBahan:'[]',rencanaId:''}),
      SlipKirim:Object.assign({},common,{id:entry.rows.SlipKirim,noSlip:'',maklonId:maklonId,target:'',upah:0,dibuatOleh:me.id}),
      SlipSetor:Object.assign({},common,{id:entry.rows.SlipSetor,noSlip:'',maklonId:maklonId,reject:0,rejectUkuran:'{}',upah:0,status:'diajukan',dibuatOleh:me.id,diprosesOleh:'',diprosesPada:'',upahId:'',workflowVersion:WORKFLOW_VERSION,imporSumber:JSON.stringify({ownerSizeCorrection:entry.id,reportedFromInitial:true})})
    };
    openingTables.forEach(function (table) {
      var old = store.read(table).filter(function (row) { return row.id === rows[table].id; })[0];
      if (old && Object.keys(rows[table]).some(function (key) { return String(old[key] == null ? '' : old[key]) !== String(rows[table][key]); })) ctx.fail('Catatan pemulihan sudah berubah. Jangan mengirimnya sebagai transaksi baru.');
      if (store.validateRows) store.validateRows(table,[rows[table]]);
    });
    function saveEntry(status) {
      entry.status = status;
      var source = Object.assign({},coreMap(context.po.imporSumber)); source.ownerSizeCorrections = context.entries.filter(function (old) { return old.id !== entry.id; }).concat([entry]);
      var patch = {imporSumber:JSON.stringify(source)};
      coreMissingSizeEntries(Object.assign({},context.po,patch));
      if (store.validateRows) store.validateRows('PO',[Object.assign({},context.po,patch)]);
      store.update('PO',context.po.id,patch);
      fresh(['PO']); context.po = store.read('PO').filter(function (row) { return row.id === context.po.id; })[0];
    }
    /* Durable intent precedes physical rows. Deterministic child IDs resume a
       failed Sheets write without duplicates; other writes to this PO pause. */
    if (!replayed) saveEntry('preparing');
    openingTables.forEach(function (table) {
      if (!store.read(table).some(function (row) { return row.id === rows[table].id; })) store.append(table,rows[table]);
      fresh([table]);
      var saved = store.read(table).filter(function (row) { return row.id === rows[table].id; })[0];
      if (!saved || Object.keys(rows[table]).some(function (key) { return String(saved[key] == null ? '' : saved[key]) !== String(rows[table][key]); })) ctx.fail('Penyimpanan pemulihan belum pasti. Lanjutkan permintaan yang sama.');
    });
    saveEntry('complete');
    var result = missingView(missingContext(p)); result.replayed = replayed; return result;
  };
}
