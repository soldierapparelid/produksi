/** @OnlyCurrentDoc */
/* Adaptor dari project Apps Script Soldier Produksi, diperiksa 8 Oktober 2026. */
var PK_STORE_ = null;
var PK_PROPS_ = null;
function pkProps_() {
  if (!PK_PROPS_) PK_PROPS_ = PropertiesService.getScriptProperties().getProperties() || {};
  return PK_PROPS_;
}
function pkSnapshotKey_(p) { return [String(p.ver || '0'), String(p.ve || '0'), String(p.pendingWrite || '')].join('|'); }
/* A business write may reach Sheets before this execution is interrupted.
   The marker is durable before the first value change and is cleared in the
   same property publication as the committed versions. Recovery invalidates
   every row-cache epoch; it does not undo or repeat any business operation. */
function pkRecoverWriteLocked_(p) {
  if (!p.pendingWrite) return p;
  SpreadsheetApp.flush();
  var next = { ver: String(Number(p.ver || 0) + 1), ve: String(Number(p.ve || 0) + 1), pendingWrite: '', mig: '1' };
  PropertiesService.getScriptProperties().setProperties(next, false);
  for (var key in next) p[key] = next[key];
  return p;
}
function pkRecoverWrite_() {
  if (!pkProps_().pendingWrite) return;
  var lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (e) { throw new Error('Penyimpanan perangkat lain belum selesai. Periksa data terbaru sebentar lagi.'); }
  try {
    PK_PROPS_ = pkRecoverWriteLocked_(PropertiesService.getScriptProperties().getProperties() || {});
    PK_STORE_ = null;
  } finally { lock.releaseLock(); }
}
/* Versioned production rows can survive a work break. Google may evict these
   earlier; cache misses still read Sheets. Keep the account-cache lifetime
   unchanged, and always recheck physical account rows for staged sign-in. */
var PK_CACHE_TTL_ = 21600;
var PK_CACHE_ACCOUNT_TTL_ = 1800;
var PK_CACHE_POTONG_ = 80000;
var PK_CELL_MAX_ = 49000;
function pkSchema_() { return APP_VERSION + ':' + coreHash(JSON.stringify(SCHEMA) + '|' + JSON.stringify(TYPES)); }
/* Code-only releases keep the same physical columns. Retain versioned row
   caches, but do not inspect every sheet header just to verify a PIN after a
   patch release. A missing/different layout digest still performs full setup. */
function pkLayoutMatches_(saved, want) {
  saved = String(saved || ''); want = String(want || '');
  var at = saved.lastIndexOf(':'), expectedAt = want.lastIndexOf(':');
  return at > 0 && expectedAt > 0 && saved.slice(at + 1) === want.slice(expectedAt + 1);
}
function pkStore_() {
  if (PK_STORE_) return PK_STORE_;
  var props = PropertiesService.getScriptProperties();
  var ss = null; var tz = null;
  var cache = {}; var cacheMiss = {}; var depth = 0; var dirty = false; var businessDirty = false; var ver = null; var kotor = {};
  var writeMarked = false; var attemptedBusinessWrite = false;
  var settingsReadInLock = false; var settingsNeedsFlush = false;
  var readCacheBatch = 0; var readCacheQueue = {};
  var sc = null; var scMati = false;
  function versiTab(name) { return String(pkProps_()['v_' + name] || '0'); }
  /* Petunjuk status pemulihan riwayat (properti "mig"), supaya permintaan biasa tidak perlu membuka spreadsheet
     hanya untuk memastikan "tidak ada pemulihan yang tertunda":
       '0' = pemeriksaan terakhir DARI SHEET, di dalam kunci, menyatakan tidak ada yang tertunda, dan sejak itu
             tab Pengaturan belum ditulis lagi;
       selain itu = belum pasti, sheet dibaca seperti sebelumnya.
     Setiap penulisan ke tab Pengaturan mengubahnya menjadi '1' SEBELUM menulis (kalau gagal, penulisan dibatalkan).
     Hanya permintaan yang memegang kunci yang boleh menurunkannya ke '0': permintaan tanpa kunci bisa membaca sheet
     sebelum penulis lain selesai menyimpan. Pengeditan langsung di sheet menaikkannya lewat onEdit. */
  function migHint() { return String(pkProps_().mig || ''); }
  function migBelumPasti() { if (migHint() === '1') return; props.setProperty('mig', '1'); pkProps_().mig = '1'; }
  function migAman() { if (depth <= 0 || migHint() === '0') return; try { props.setProperty('mig', '0'); pkProps_().mig = '0'; } catch (e) {} }
  var skema = null;      /* sidik skema dipakai di setiap kunci cache: dihitung sekali per eksekusi */
  function kunciCache(name, v) { if (!skema) skema = pkSchema_(); return 'pk3|' + skema + '|' + String(pkProps_().ve || '0') + '|' + name + '|' + v; }
  function lemari() {
    if (scMati) return null;
    if (!sc) { try { sc = CacheService.getScriptCache(); } catch (e) { scMati = true; return null; } }
    return sc;
  }
  function dariCache(names) {
    var c = lemari(); if (!c) return;
    names = names.filter(function (n) { return SCHEMA[n] && !cache[n] && !cacheMiss[n] && n !== 'Gambar'; });
    if (!names.length) return;
    try {
      var kunci = {}; names.forEach(function (n) { kunci[n] = kunciCache(n, versiTab(n)); });
      var meta = c.getAll(names.map(function (n) { return kunci[n]; })) || {};
      /* A miss in this batch falls back to Sheets. Do not repeat the same
         metadata RPC for each subsequent load in this execution/lock. */
      names.forEach(function (n) { cacheMiss[n] = true; });
      var bagian = []; var jumlah = {};
      names.forEach(function (n) { var m = Number(meta[kunci[n]]); if (m >= 1 && m <= 40) { jumlah[n] = m; for (var i = 0; i < m; i++) bagian.push(kunci[n] + '|' + i); } });
      if (!bagian.length) return;
      var isi = {};
      for (var s = 0; s < bagian.length; s += 30) { var part = c.getAll(bagian.slice(s, s + 30)) || {}; for (var k in part) isi[k] = part[k]; }
      names.forEach(function (n) {
        if (!jumlah[n]) return;
        var teks = '';
        for (var i = 0; i < jumlah[n]; i++) { var p = isi[kunci[n] + '|' + i]; if (typeof p !== 'string') return; teks += p; }
        var rows; try { rows = JSON.parse(teks); } catch (e) { return; }
        if (rows instanceof Array) cache[n] = { rows: rows, ringan: true };
      });
    } catch (e) {}
  }
  function keCache(name, rows, v, readFill) {
    var c = lemari(); if (!c || name === 'Gambar') return;
    try {
      var teks = JSON.stringify(rows); var m = Math.ceil(teks.length / PK_CACHE_POTONG_) || 1; if (m > 40) return;
      /* A cold state reads many small tables. Publish those optional read-cache
         fills together at the end of this request instead of one RPC per table.
         Transaction commits still publish synchronously below. */
      if (readFill && readCacheBatch) { readCacheQueue[name] = { text: teks, version: String(v), epoch: String(pkProps_().ve || '0') }; return; }
      var k = kunciCache(name, v); var grup = {}; var n = 0;
      var ttl = name === 'Pegawai' ? PK_CACHE_ACCOUNT_TTL_ : PK_CACHE_TTL_;
      for (var i = 0; i < m; i++) {
        grup[k + '|' + i] = teks.substr(i * PK_CACHE_POTONG_, PK_CACHE_POTONG_); n++;
        if (n === 4) { c.putAll(grup, ttl); grup = {}; n = 0; }
      }
      grup[k] = String(m);
      c.putAll(grup, ttl);
    } catch (e) {}
  }
  function flushReadCache() {
    var queued = readCacheQueue; readCacheQueue = {};
    var c = lemari(); if (!c) return;
    var group = {}, parts = 0, groupTtl = PK_CACHE_TTL_;
    function flush() { if (!Object.keys(group).length) return; try { c.putAll(group, groupTtl); } catch (e) {} group = {}; parts = 0; }
    Object.keys(queued).forEach(function (name) {
      var q = queued[name];
      if (q.version !== versiTab(name) || q.epoch !== String(pkProps_().ve || '0')) return;
      var ttl = name === 'Pegawai' ? PK_CACHE_ACCOUNT_TTL_ : PK_CACHE_TTL_;
      if (ttl !== groupTtl) flush();
      groupTtl = ttl;
      var key = kunciCache(name, q.version), count = Math.ceil(q.text.length / PK_CACHE_POTONG_) || 1;
      for (var i = 0; i < count; i++) {
        if (parts === 4) flush();
        group[key + '|' + i] = q.text.substr(i * PK_CACHE_POTONG_, PK_CACHE_POTONG_); parts++;
      }
      group[key] = String(count);
    });
    flush();
  }
  function book() {
    if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) throw new Error('Script ini harus dibuat dari dalam Google Sheets (menu Extensions > Apps Script).');
    return ss;
  }
  function zone() { if (!tz) tz = book().getSpreadsheetTimeZone() || 'Asia/Jakarta'; return tz; }
  function keyOf(name) { return name === 'Pengaturan' ? 'key' : 'id'; }
  function fmtRow(head) { return [head.map(function (h) { return TYPES[h] === 'num' ? '0.###' : '@'; })]; }
  function ensure(name) {
    var cols = SCHEMA[name]; var sh = book().getSheetByName(name);
    if (!sh) {
      sh = book().insertSheet(name);
      sh.getRange(1, 1, 1, cols.length).setNumberFormat('@').setValues([cols]).setFontWeight('bold');
      sh.setFrozenRows(1);
      return sh;
    }
    var last = sh.getLastColumn();
    var head = last > 0 ? sh.getRange(1, 1, 1, last).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
    var missing = cols.filter(function (c) { return head.indexOf(c) < 0; });
    if (missing.length) sh.getRange(1, head.length + 1, 1, missing.length).setNumberFormat('@').setValues([missing]).setFontWeight('bold');
    return sh;
  }
  function fromCell(col, raw) {
    if (raw instanceof Date) raw = Utilities.formatDate(raw, zone(), 'yyyy-MM-dd');
    if (TYPES[col] === 'num') return coreNum(raw);
    if (TYPES[col] === 'bool') return raw === true || /^(true|ya|1)$/i.test(String(raw));
    var s = raw === null || raw === undefined ? '' : String(raw);
    if (s.length > 1 && s.charAt(0) === "'" && '=+@'.indexOf(s.charAt(1)) >= 0) s = s.slice(1);
    return s;
  }
  function toCell(col, v) {
    if (v === null || v === undefined) v = '';
    if (TYPES[col] === 'num') return coreNum(v);
    if (TYPES[col] === 'bool') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'object') v = JSON.stringify(v);
    v = String(v);
    /* Snapshot pembayaran dan rincian JSON harus utuh. Batas sel ditolak, bukan dipotong. */
    if (v.length > PK_CELL_MAX_) throw new Error('Isi kolom ' + col + ' terlalu panjang untuk satu sel. Kurangi jumlah item lalu coba lagi; catatan ini belum disimpan.');
    if (v && '=+@'.indexOf(v.charAt(0)) >= 0) v = "'" + v;
    return v;
  }
  function load(name, penuh) {
    var ada = cache[name];
    if (ada && (!penuh || !ada.ringan)) return ada;
    if (!SCHEMA[name]) throw new Error('Tabel tidak dikenal: ' + name);
    if (!ada && !penuh) { dariCache([name]); if (cache[name]) return cache[name]; }
    var sh = book().getSheetByName(name) || ensure(name);
    /* getDataRange already contains the actual used rows (or one blank cell
       for an empty sheet). Avoid a separate getLastRow RPC on every cold read. */
    var values = sh.getDataRange().getValues();
    var head = values[0].map(function (h) { return String(h).trim(); });
    var cols = SCHEMA[name]; var idx = cols.map(function (c) { return head.indexOf(c); });
    if (idx.some(function (i) { return i < 0; })) {
      sh = ensure(name); values = sh.getDataRange().getValues();
      head = values[0].map(function (h) { return String(h).trim(); }); idx = cols.map(function (c) { return head.indexOf(c); });
    }
    var rows = []; var rowNo = {}; var k = keyOf(name);
    for (var i = 1; i < values.length; i++) {
      var o = {};
      for (var c = 0; c < cols.length; c++) o[cols[c]] = fromCell(cols[c], idx[c] >= 0 ? values[i][idx[c]] : '');
      if (o[k] === '') continue;
      rowNo[o[k]] = i + 1; rows.push(o);
    }
    cache[name] = { sh: sh, head: head, rows: rows, rowNo: rowNo, last: values.length, extra: head.some(function (h) { return h && cols.indexOf(h) < 0; }) };
    if (!penuh) keCache(name, rows, versiTab(name), true);
    return cache[name];
  }
  function toArray(t, obj, base) {
    var out = base ? base.slice() : t.head.map(function () { return ''; });
    while (out.length < t.head.length) out.push('');
    for (var i = 0; i < t.head.length; i++) if (Object.prototype.hasOwnProperty.call(obj, t.head[i])) out[i] = toCell(t.head[i], obj[t.head[i]]);
    return out;
  }
  function writeRows(name, list) {
    if (name === 'Pengaturan') migBelumPasti();
    var t = load(name, true); var k = keyOf(name);
    var data = list.map(function (row) {
      var o = {}; SCHEMA[name].forEach(function (c) { o[c] = fromCell(c, toCell(c, row[c])); });
      return o;
    });
    if (!data.length) return;
    var start = t.last + 1;
    /* Capacity is needed only when appending, never for a read or row update.
       A prior full read/fresh/checkpoint can therefore be reused without it. */
    var values = data.map(function (o) { return toArray(t, o, null); });
    mutate(name, function () {
      if (t.max === undefined) t.max = t.sh.getMaxRows();
      var kurang = start + data.length - 1 - t.max;
      if (kurang > 0) { t.sh.insertRowsAfter(t.max, kurang + 200); t.max += kurang + 200; }
      var range = t.sh.getRange(start, 1, data.length, t.head.length);
      var fmt = fmtRow(t.head)[0];
      range.setNumberFormats(data.map(function () { return fmt; }));
      range.setValues(values);
      data.forEach(function (o, i) { t.rows.push(o); t.rowNo[o[k]] = start + i; });
      t.last += data.length;
    });
  }
  function changed(name, privateAuthOnly) {
    delete readCacheQueue[name];
    dirty = true; kotor[name] = 1;
    if (!privateAuthOnly) businessDirty = true;
    if (name === 'Pengaturan') { settingsReadInLock = false; settingsNeedsFlush = true; }
  }
  /* A Sheets call can persist and then throw (for example a lost response).
     Invalidate this table even when success cannot be confirmed. Never publish
     the in-memory before-image as the new version after an uncertain write. */
  function mutate(name, fn, privateAuthOnly) {
    if (!privateAuthOnly && !writeMarked) {
      /* If the marker cannot be stored, do not begin a physical mutation. */
      props.setProperty('pendingWrite', '1'); pkProps_().pendingWrite = '1'; writeMarked = true;
    }
    changed(name, privateAuthOnly);
    if (!privateAuthOnly) attemptedBusinessWrite = true;
    try { return fn(); }
    catch (err) { delete cache[name]; delete readCacheQueue[name]; if (!privateAuthOnly) err.uncertain = true; throw err; }
  }
  function version() {
    if (ver === null) ver = Number(pkProps_().ver || 0);
    return ver + (businessDirty ? 1 : 0);
  }
  PK_STORE_ = {
    read: function (name) { return load(name).rows; },
    withReadCacheBatch: function (fn) {
      readCacheBatch++;
      try { return fn(); }
      finally { readCacheBatch--; if (!readCacheBatch) flushReadCache(); }
    },
    /* Preflight tanpa akses Sheets: dipakai sebelum operasi yang menulis beberapa tabel. */
    validateRows: function (name, rows) {
      if (!SCHEMA[name]) throw new Error('Tabel tidak dikenal: ' + name);
      rows.forEach(function (row) { SCHEMA[name].forEach(function (col) { toCell(col, row[col]); }); });
    },
    /* Migration boundaries must verify Sheets, not the rows just staged in this
       execution or ScriptCache. Keep dirty/kotor intact for the outer lock's
       version publication after the durable read-back succeeds. */
    checkpoint: function (names) {
      names = names || [];
      names.forEach(function (name) { if (!SCHEMA[name]) throw new Error('Tabel tidak dikenal: ' + name); });
      names.forEach(function (name) { delete readCacheQueue[name]; });
      SpreadsheetApp.flush();
      settingsNeedsFlush = false;
      /* A hard execution timeout may skip lock.finally and its version update.
         Remove the durable tables' old cache metadata now so a cold request
         cannot mistake the pre-migration snapshot for the flushed Sheets. */
      if (names.length) {
        var persistent = lemari();
        if (!persistent) throw new Error('Cache belum dapat disegarkan. Coba pemulihan kembali sebelum melanjutkan.');
        names.forEach(function (name) { persistent.remove(kunciCache(name, versiTab(name))); });
      }
      names.forEach(function (name) { if (name === 'Pengaturan') settingsReadInLock = false; delete cache[name]; load(name, true); });
    },
    /* A migration journal contains schema fields only. Refuse layouts whose
       extra data could otherwise disappear when source IDs are replaced. */
    validateMigrationLayout: function (names) {
      names = names || [];
      names.forEach(function (name) { if (!SCHEMA[name]) throw new Error('Tabel tidak dikenal: ' + name); });
      names.forEach(function (name) {
        var sh = book().getSheetByName(name); if (!sh || !sh.getLastRow()) return;
        var values = sh.getDataRange().getValues(), head = values[0].map(function (value) { return String(value == null ? '' : value).trim(); });
        var seen = Object.create(null);
        head.forEach(function (key, col) {
          if (key && Object.prototype.hasOwnProperty.call(seen, key)) throw new Error('Tabel ' + name + ' memiliki judul kolom ganda. Rapikan judul sebelum pemulihan riwayat.');
          if (key) seen[key] = true;
          if (SCHEMA[name].indexOf(key) >= 0) return;
          for (var row = 1; row < values.length; row++) {
            if (values[row][col] !== '' && values[row][col] !== null && values[row][col] !== undefined)
              throw new Error('Tabel ' + name + ' memiliki data pada kolom tambahan. Simpan dan rapikan kolom tersebut sebelum pemulihan riwayat.');
          }
        });
      });
    },
    append: function (name, row) { writeRows(name, [row]); },
    appendMany: function (name, rows) { writeRows(name, rows); },
    prefetch: function (names) { dariCache(names); },
    update: function (name, id, patch) {
      if (name === 'Pengaturan') migBelumPasti();
      var t = load(name, true); var k = keyOf(name); var r = t.rowNo[id]; if (!r) return;
      var obj = null; for (var i = 0; i < t.rows.length; i++) if (t.rows[i][k] === id) { obj = t.rows[i]; break; }
      if (!obj) return;
      /* Validasi semua kolom patch dahulu, supaya galat panjang tidak mengubah cache separuh. */
      var next = {}; for (var c in obj) next[c] = obj[c];
      for (var p in patch) if (SCHEMA[name].indexOf(p) >= 0) next[p] = fromCell(p, toCell(p, patch[p]));
      var range = t.sh.getRange(r, 1, 1, t.head.length);
      var base = t.extra ? range.getValues()[0] : null;
      var values = [toArray(t, next, base)];
      /* Session tokens and PIN-attempt counters are not part of publicUser.
         Publish their account-table version normally, without forcing every
         colleague to download the full production state after each sign-in. */
      var patchKeys = Object.keys(patch);
      mutate(name, function () {
        range.setNumberFormats(fmtRow(t.head));
        range.setValues(values);
        for (var field in next) obj[field] = next[field];
      }, name === 'Pegawai' && patchKeys.length > 0 && patchKeys.every(function (key) { return ['token','gagal','kunci'].indexOf(key) >= 0; }));
    },
    remove: function (name, id) {
      if (name === 'Pengaturan') migBelumPasti();
      var t = load(name, true); var k = keyOf(name); var r = t.rowNo[id]; if (!r) return;
      mutate(name, function () {
        t.sh.deleteRow(r);
        t.rows = t.rows.filter(function (x) { return x[k] !== id; });
        delete t.rowNo[id];
        for (var key in t.rowNo) if (t.rowNo[key] > r) t.rowNo[key]--;
        t.last--; if (t.max !== undefined) t.max--;
      });
    },
    replaceAll: function (name, list) {
      if (name === 'Pengaturan') migBelumPasti();
      var t = load(name, true); var k = keyOf(name);
      var data = list.map(function (row) { var o = {}; SCHEMA[name].forEach(function (c) { o[c] = fromCell(c, toCell(c, row[c])); }); return o; });
      var lastRow = t.sh.getLastRow(); var lebar = t.head.length; var lamaById = {};
      if (lastRow > 1) {
        var body = t.sh.getRange(2, 1, lastRow - 1, lebar);
        if (t.extra) { var idCol = t.head.indexOf(k); body.getValues().forEach(function (v) { if (v[idCol] !== '') lamaById[String(v[idCol])] = v; }); }
      }
      /* Replace rows and clear the old tail in one value write. Clearing the
         whole body first could lose every row if the following write failed. */
      var values = data.map(function (o) { return toArray(t, o, lamaById[String(o[k])] || null); });
      while (values.length < lastRow - 1) values.push(t.head.map(function () { return ''; }));
      mutate(name, function () {
        var max = t.sh.getMaxRows(), kurang = values.length + 1 - max;
        if (kurang > 0) { t.sh.insertRowsAfter(max, kurang + 200); max += kurang + 200; }
        if (values.length) {
          var range = t.sh.getRange(2, 1, values.length, lebar), fmt = fmtRow(t.head)[0];
          range.setNumberFormats(values.map(function () { return fmt; }));
          range.setValues(values);
        }
        t.rows = data; t.rowNo = {}; data.forEach(function (o, i) { t.rowNo[o[k]] = i + 2; });
        t.last = data.length + 1; t.max = max; t.ringan = false; cache[name] = t;
      });
    },
    getSettings: function () {
      var out = {}; load('Pengaturan').rows.forEach(function (r) { out[r.key] = coreParseJSON(r.value, r.value); });
      return out;
    },
    /* A read-only pending-migration check must bypass ScriptCache, but need not
       flush writes or invalidate that cache. Within one script lock its physical
       read is reusable until a settings mutation. Unlocked requests always read
       Sheets again. Durable migration checkpoints retain their separate contract. */
    getMigrationStatusFresh: function () {
      /* Jalur biasa: petunjuk '0' berarti tidak ada pemulihan yang tertunda, tanpa membuka spreadsheet.
         Kalau tab Pengaturan kebetulan sudah dibaca fisik pada eksekusi ini (mis. oleh checkpoint), isinya tetap dipakai. */
      if (migHint() === '0' && !settingsNeedsFlush) {
        var sudah = cache.Pengaturan;
        return (sudah && !sudah.ringan) ? PK_STORE_.getSettings().legacyMigrationStatus : undefined;
      }
      if (!(depth > 0 && settingsReadInLock)) {
        if (settingsNeedsFlush) { SpreadsheetApp.flush(); settingsNeedsFlush = false; }
        delete cache.Pengaturan;
        load('Pengaturan', true);
        settingsReadInLock = depth > 0;
      }
      var status = PK_STORE_.getSettings().legacyMigrationStatus;
      if (!status) migAman();
      return status;
    },
    setSettings: function (obj) {
      PK_STORE_.validateRows('Pengaturan', Object.keys(obj).map(function (k) { return { key: k, value: JSON.stringify(obj[k]) }; }));
      var t = load('Pengaturan', true);
      for (var k in obj) {
        var val = JSON.stringify(obj[k]);
        if (t.rowNo[k]) { var cur = null; t.rows.forEach(function (r) { if (r.key === k) cur = r; }); if (cur && cur.value === val) continue; PK_STORE_.update('Pengaturan', k, { value: val }); }
        else writeRows('Pengaturan', [{ key: k, value: val }]);
      }
    },
    lock: function (fn) {
      if (depth > 0) return fn();
      var lk = LockService.getScriptLock();
      try { lk.waitLock(25000); } catch (e) { throw new Error('Server sedang sibuk. Coba lagi beberapa detik lagi.'); }
      depth = 1; cache = {}; cacheMiss = {}; dirty = false; businessDirty = false; writeMarked = false; kotor = {}; settingsReadInLock = false; settingsNeedsFlush = false;
      var pv, operationError = null;
      try {
        PK_PROPS_ = null; pv = pkRecoverWriteLocked_(pkProps_());
        ver = Number(pv.ver || 0);
        return fn();
      } catch (error) { operationError = error; throw error; }
      finally {
        var galatSimpan = null;
        try {
          try { SpreadsheetApp.flush(); } catch (e) { galatSimpan = e; }
          if (dirty) {
            dirty = false;
            var nextVer = ver + (businessDirty ? 1 : 0);
            var naik = businessDirty ? { ver: String(nextVer), pendingWrite: '' } : {}; var nama = Object.keys(kotor); var kunciLama = {};
            nama.forEach(function (n) { kunciLama[n] = kunciCache(n, String(pv['v_' + n] || '0')); naik['v_' + n] = String(Number(pv['v_' + n] || 0) + 1); });
            /* A failed flush leaves the durable marker for the next request. */
            if (galatSimpan && businessDirty) delete naik.pendingWrite;
            try { props.setProperties(naik, false); }
            catch (e2) {
              var c = lemari(); if (c) nama.forEach(function (n) { try { c.remove(kunciLama[n]); } catch (e3) {} });
              throw e2;
            }
            ver = nextVer; for (var kk in naik) pv[kk] = naik[kk];
            if (!galatSimpan) nama.forEach(function (n) { var t = cache[n]; if (t && !t.ringan) keCache(n, t.rows, pv['v_' + n]); });
            kotor = {};
          }
          if (galatSimpan) throw galatSimpan;
        }
        catch (commitError) { if (attemptedBusinessWrite) { commitError.uncertain = true; if (operationError) operationError.uncertain = true; } throw operationError || commitError; }
        finally { depth = 0; dirty = false; businessDirty = false; writeMarked = false; settingsReadInLock = false; settingsNeedsFlush = false; lk.releaseLock(); }
      }
    },
    attemptedBusinessWrite: function () { return attemptedBusinessWrite; },
    version: version,
    fresh: function (name) { load(name, true); },
    /* benar kalau semua tabel itu sudah ada di cache (atau sudah dibaca pada eksekusi ini), tanpa membuka spreadsheet */
    cached: function (names) { dariCache(names); return names.every(function (n) { return !!cache[n]; }); },
    /* Sesi masuk tiap orang dicatat di catatan kecil milik script (kunci s_<id pegawai>), bukan di Google Sheets:
       menulisnya jauh lebih cepat daripada membuka spreadsheet, dan tidak mengubah nomor versi data.
       Isinya hanya token acak, bukan PIN. */
    sesi: {
      get: function (id) { return String(pkProps_()['s_' + id] || '').split(',').filter(Boolean); },
      set: function (id, list) {
        var k = 's_' + id; var v = (list || []).filter(Boolean).join(',');
        if (v) { props.setProperty(k, v); pkProps_()[k] = v; }
        else if (pkProps_()[k] !== undefined) { props.deleteProperty(k); delete pkProps_()[k]; }
      }
    },
    ensureAll: function () { Object.keys(SCHEMA).forEach(ensure); cache = {}; cacheMiss = {}; readCacheQueue = {}; settingsReadInLock = false; },
    imgGet: function (ids) {
      var c = lemari(); var out = {}; if (!c || !ids.length) return out;
      try { var awal = 'pkg|' + String(pkProps_().ve || '0') + '|'; var got = c.getAll(ids.map(function (i) { return awal + i; })) || {}; ids.forEach(function (i) { var v = got[awal + i]; if (typeof v === 'string') out[i] = v; }); } catch (e) {}
      return out;
    },
    imgPut: function (obj) {
      var c = lemari(); if (!c) return;
      try { var awal = 'pkg|' + String(pkProps_().ve || '0') + '|'; for (var id in obj) { if (obj[id]) c.put(awal + id, String(obj[id]), 21600); else c.remove(awal + id); } } catch (e) {}
    }
  };
  return PK_STORE_;
}
/* This key never leaves Script Properties. Resolve it before core.handle reads
   production rows; the store lock is reentrant for maintenance callers. A cold
   concurrent initializer rereads the durable property after acquiring the lock. */
function pkQcRevisionKey_() {
  var name = 'qcRevisionSecret', key = pkProps_()[name];
  if (key) return String(key);
  return pkStore_().lock(function () {
    var props = PropertiesService.getScriptProperties();
    var saved = props.getProperty(name);
    if (!saved) {
      saved = Utilities.getUuid() + Utilities.getUuid();
      props.setProperty(name, saved);
    }
    pkProps_()[name] = saved;
    return String(saved);
  });
}
function pkEnv_() {
  var qcKey = pkQcRevisionKey_();
  return {
    enforceClientVersion: true,
    signQcRevision: function (value) {
      return 'qch1_' + Utilities.computeHmacSha256Signature('soldier-qc-source-v1|' + String(value), qcKey).map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
    },
    now: function () { return new Date(); },
    id: function () { return Utilities.getUuid().replace(/-/g, '').slice(0, 16); },
    makePdf: function (html, name) { return Utilities.base64Encode(Utilities.newBlob(html, 'text/html', name).getAs('application/pdf').getBytes()); }
  };
}
function pkSetup_() {
  var want = pkSchema_();
  if (pkLayoutMatches_(pkProps_().schema, want)) return;
  var props = PropertiesService.getScriptProperties();
  var lk = LockService.getScriptLock();
  lk.waitLock(25000);
  try {
    if (!pkLayoutMatches_(props.getProperty('schema'), want)) { pkStore_().ensureAll(); props.setProperty('schema', want); }
    PK_PROPS_ = null;
  } finally { lk.releaseLock(); }
}
function pkRun_(text) {
  try {
    var reqObj = JSON.parse(text);
    /* Apps Script requests normally have fresh globals. Reset explicitly so a
       reused execution can never retain another request's pre-lock rows. */
    PK_PROPS_ = null; PK_STORE_ = null;
    pkRecoverWrite_();
    pkSetup_();
    var store = pkStore_();
    return store.withReadCacheBatch(function () {
      var core = createCore(store, pkEnv_());
      var data = core.handle(String(reqObj.action || ''), reqObj.payload || {});
      /* An unlocked read may straddle a colleague's multi-table commit. Reject
         that response rather than publishing a partial snapshot. Own locked
         commits update pkProps_, so they compare against their final version. */
      var expected = pkSnapshotKey_(pkProps_());
      var latest = PropertiesService.getScriptProperties().getProperties() || {};
      if (latest.pendingWrite || expected !== pkSnapshotKey_(latest)) {
        var stale = new Error('Data berubah saat dimuat. Periksa data terbaru sebelum melanjutkan.');
        stale.retryable = true; if (store.attemptedBusinessWrite()) stale.uncertain = true; throw stale;
      }
      /* aplikasi di GitHub Pages boleh memakai jembatan (lihat pkJembatan_); angka lain atau tidak ada = jangan dipakai */
      if (reqObj.action === 'bootstrap' && data && typeof data === 'object') data.jembatan = PK_JEMBATAN_;
      return { ok: true, data: data };
    });
  } catch (err) {
    var failure = { ok: false, error: String((err && err.message) || err) };
    if (err && err.updateRequired === true) { failure.updateRequired = true; failure.appVersion = APP_VERSION; }
    /* This also covers a late response/fence failure after a physical mutation
       succeeded. A failed response must never imply that nothing was saved. */
    if (err && err.uncertain === true || store && store.attemptedBusinessWrite()) failure.uncertain = true;
    if (err && err.retryable === true) failure.retryable = true;
    return failure;
  }
}
function api(text) { return JSON.stringify(pkRun_(text)); }
/* Jembatan untuk aplikasi di GitHub Pages. Jawaban doPost diantar Google lewat alamat terpisah
   (script.googleusercontent.com/macros/echo); pada 11 Okt 2026 separuh jawaban hilang di sana walau eksekusinya
   selesai. Halaman kecil tanpa tampilan ini dimuat aplikasi di dalam bingkai tersembunyi dan meneruskan permintaan
   lewat google.script.run, yang jawabannya kembali langsung. Hanya pesan dari alamat aplikasi yang dilayani, dan
   balasan hanya dikirim ke alamat itu. Fungsi yang dipanggil tetap api(), sama dengan aplikasi yang dibuka dari Apps Script.
   PK_JEMBATAN_ = 0 mematikan pemakaian jembatan di semua perangkat tanpa mengganti tampilan. */
var PK_JEMBATAN_ = 1;
var PK_ASAL_APLIKASI_ = ['https://soldierapparelid.github.io'];
function pkJembatan_() {
  var js = '(function(){var ASAL=' + JSON.stringify(PK_ASAL_APLIKASI_) + ';' +
    'window.addEventListener("message",function(ev){var d=ev.data;' +
    'if(ASAL.indexOf(ev.origin)<0||!ev.source||!d||d.pk!=="api"||typeof d.body!=="string")return;' +
    'var asal=ev.origin,sumber=ev.source,id=d.id;' +
    'function balas(m){m.pk="api";m.id=id;try{sumber.postMessage(m,asal);}catch(x){}}' +
    'try{google.script.run.withSuccessHandler(function(s){balas({ok:true,s:s});})' +
    '.withFailureHandler(function(er){balas({ok:false,e:String((er&&er.message)||er)});}).api(d.body);}' +
    'catch(x){balas({ok:false,belum:true,e:String((x&&x.message)||x)});}});' +
    'for(var i=0;i<ASAL.length;i++){try{window.top.postMessage({pk:"jembatan-siap"},ASAL[i]);}catch(x){}}})();';
  return HtmlService.createHtmlOutput('<!doctype html><html><head><meta charset="utf-8"></head><body><script>' + js + '<\/script></body></html>')
    .setTitle('Sambungan')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function doGet(e) {
  if (e && e.parameter && String(e.parameter.jembatan || '') === '1') return pkJembatan_();
  var nama = 'Produksi';
  var d = String((e && e.parameter && e.parameter.d) || '').toLowerCase();
  var label = { potong: 'Potong', jahit: 'Jahit', qc: 'QC' }[d];
  if (!label) { d = ''; label = 'Produksi'; }
  try { pkSetup_(); nama = (pkStore_().getSettings().namaUsaha || 'Soldier') + ' ' + label; } catch (err) {}
  var html = HtmlService.createHtmlOutputFromFile('Index').getContent().replace('__PK_DIV__', d);
  return HtmlService.createHtmlOutput(html)
    .setTitle(nama)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .addMetaTag('mobile-web-app-capable', 'yes')
    .addMetaTag('apple-mobile-web-app-capable', 'yes');
}
function doPost(e) {
  var text = (e && e.postData && e.postData.contents) || '{}';
  return ContentService.createTextOutput(JSON.stringify(pkRun_(text))).setMimeType(ContentService.MimeType.JSON);
}
function onEdit(e) {
  var lk = null, acquired = false;
  try {
    /* Share the app's commit lock: two read/increment/write operations on the
       version properties must not publish the same version for different edits. */
    lk = LockService.getScriptLock(); lk.waitLock(25000); acquired = true;
    var props = PropertiesService.getScriptProperties();
    var naik = { ver: String(Number(props.getProperty('ver') || 0) + 1) };
    var nama = ''; try { nama = (e && e.range) ? e.range.getSheet().getName() : ''; } catch (x) {}
    if (nama && SCHEMA[nama]) naik['v_' + nama] = String(Number(props.getProperty('v_' + nama) || 0) + 1);
    else naik.ve = String(Number(props.getProperty('ve') || 0) + 1);
    /* tab Pengaturan (atau tab yang tidak dikenali) diedit langsung: status pemulihan diperiksa lagi dari sheet */
    if (nama === 'Pengaturan' || !SCHEMA[nama]) naik.mig = '1';
    props.setProperties(naik, false);
    PK_PROPS_ = null;
  } catch (err) {}
  finally { if (acquired) { try { lk.releaseLock(); } catch (ignored) {} } }
}
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Aplikasi Produksi')
    .addItem('Siapkan tab data', 'menuSiapkan')
    .addItem('Buka kunci semua akun', 'menuBukaKunci')
    .addItem('Keluarkan semua perangkat', 'menuKeluarkanSemua')
    .addToUi();
}
/* Menghapus semua sesi masuk: setiap perangkat harus memasukkan PIN lagi. PIN tidak berubah. */
function menuKeluarkanSemua() {
  var ui = SpreadsheetApp.getUi();
  var p = PropertiesService.getScriptProperties(); var semua = p.getProperties() || {}; var n = 0;
  for (var k in semua) if (k.indexOf('s_') === 0) { p.deleteProperty(k); n++; }
  PK_PROPS_ = null;
  var store = pkStore_();
  /* menulis kolom token (walau sudah kosong) menaikkan versi tabel akun, sehingga cache akun lama tidak dipakai lagi */
  store.lock(function () { store.read('Pegawai').slice().forEach(function (u) { if (u.token) n++; store.update('Pegawai', u.id, { token: '' }); }); });
  p.setProperty('ver', String(Number(p.getProperty('ver') || 0) + 1)); PK_PROPS_ = null;
  ui.alert(n ? 'Semua perangkat sudah dikeluarkan. Tiap orang masuk lagi dengan PIN-nya.' : 'Tidak ada perangkat yang sedang masuk.');
}
function menuSiapkan() {
  var ui = SpreadsheetApp.getUi();
  var p = PropertiesService.getScriptProperties();
  p.deleteProperty('schema');
  p.setProperties({ ve: String(Number(p.getProperty('ve') || 0) + 1), ver: String(Number(p.getProperty('ver') || 0) + 1), mig: '1' }, false);
  PK_PROPS_ = null;
  pkSetup_();
  ui.alert('Tab data sudah siap. Lanjutkan dengan Deploy > New deployment > Web app.');
}
function menuBukaKunci() {
  var ui = SpreadsheetApp.getUi();
  var store = pkStore_();
  store.lock(function () { store.read('Pegawai').slice().forEach(function (u) { if (u.kunci || u.gagal) store.update('Pegawai', u.id, { gagal: 0, kunci: '' }); }); });
  ui.alert('Semua akun yang terkunci sudah dibuka.');
}
