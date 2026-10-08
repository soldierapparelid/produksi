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
