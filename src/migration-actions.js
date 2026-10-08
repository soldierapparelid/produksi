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
  function protectCutPlans(replacements) {
    var names = ['Potong', 'PO'];
    if (SCHEMA.RencanaPotong) names.push('RencanaPotong');
    /* apply/recover run inside the write lock. Refresh these together instead
       of trusting the planner snapshot or the recovery journal's older rows. */
    checkpoint(names);
    var beforeCuts = store.read('Potong'), plans = SCHEMA.RencanaPotong ? store.read('RencanaPotong') : [];
    var afterCuts = Object.prototype.hasOwnProperty.call(replacements, 'Potong') ? replacements.Potong : beforeCuts;
    var afterPO = Object.prototype.hasOwnProperty.call(replacements, 'PO') ? replacements.PO : store.read('PO');
    if (typeof coreCutValidateReplacement === 'function') return coreCutValidateReplacement(beforeCuts, afterCuts, plans, afterPO);
    if (plans.length || beforeCuts.concat(afterCuts).some(function (row) { return !!row.rencanaId; })) fail('Paket pelindung persiapan potong belum lengkap. Perbarui server sebelum memulihkan riwayat.');
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
