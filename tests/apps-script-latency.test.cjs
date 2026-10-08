'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers/apps-script-harness.cjs');

// Count actual adapter boundary calls rather than timing the in-memory mock.
// Remote Sheets latency varies; avoiding one getValues and two flushes is the
// measurable optimization, not a promised number of seconds on a live account.
function meter(h) {
  const reads = {}, invalidations = [];
  for (const [name, sheet] of Object.entries(h.sheets)) {
    const getRange = sheet.getRange.bind(sheet);
    sheet.getRange = (...args) => {
      const range = getRange(...args), getValues = range.getValues.bind(range);
      range.getValues = () => { reads[name] = (reads[name] || 0) + 1; return getValues(); };
      return range;
    };
  }
  const cache = h.context.CacheService.getScriptCache(), remove = cache.remove.bind(cache);
  cache.remove = key => { invalidations.push(key); return remove(key); };
  h.events.length = 0;
  return { reads, invalidations, flushes: () => h.events.filter(e => e[0] === 'flush').length };
}

function fixture() {
  const h = harness();
  const setup = h.request('setupOwner', { nama: 'Pemilik Contoh', pin: '1234' });
  assert.equal(setup.ok, true, setup.error);
  h.cold();
  return { h, owner: setup.data.state.me, token: setup.data.token };
}

test('fresh status bypasses stale caches without a flush or cache invalidation on read-only calls', () => {
  const { h } = fixture(), m = meter(h);
  h.run('pkStore_().getSettings();');
  const sheet = h.sheets.Pengaturan, key = sheet.values[0].indexOf('key'), value = sheet.values[0].indexOf('value');
  sheet.values.push(sheet.values[0].map((_, col) => col === key ? 'legacyMigrationStatus' : col === value ? '{"batchId":"pending001"}' : ''));
  assert.deepEqual(h.run('pkStore_().getMigrationStatusFresh()'), { batchId: 'pending001' });
  sheet.values.at(-1)[value] = 'false';
  assert.equal(h.run('pkStore_().getMigrationStatusFresh()'), false, 'unlocked calls must not memoize a prior status');
  assert.equal(m.reads.Pengaturan, 2);
  assert.equal(m.flushes(), 0);
  assert.equal(m.invalidations.length, 0);
});

test('only one physical settings read is reused inside one lock and unrelated writes do not invalidate it', () => {
  const { h } = fixture(), m = meter(h);
  h.run(`pkStore_().lock(function(){
    pkStore_().getMigrationStatusFresh();
    pkStore_().append('Potong',{id:'cut001',total:2});
    pkStore_().getMigrationStatusFresh();
    pkStore_().lock(function(){pkStore_().getMigrationStatusFresh();});
  });`);
  assert.equal(m.reads.Pengaturan, 1);
  assert.equal(m.flushes(), 1, 'only the normal transaction commit flushes');
  assert.equal(m.invalidations.length, 0);
  h.run('pkStore_().lock(function(){pkStore_().getMigrationStatusFresh();});');
  assert.equal(m.reads.Pengaturan, 2, 'a new lock must read durable settings again');
  assert.equal(h.isLocked(), false);
});

test('every settings mutation invalidates the lock memo and is flushed before the next physical status check', () => {
  const { h } = fixture(), m = meter(h);
  const results = h.run(`pkStore_().lock(function(){
    var s=pkStore_(), out=[];
    s.getMigrationStatusFresh();
    s.append('Pengaturan',{key:'legacyMigrationStatus',value:'{"batchId":"a"}'});
    out.push(s.getMigrationStatusFresh());
    s.update('Pengaturan','legacyMigrationStatus',{value:'{"batchId":"b"}'});
    out.push(s.getMigrationStatusFresh());
    s.replaceAll('Pengaturan',[{key:'legacyMigrationStatus',value:'{"batchId":"c"}'}]);
    out.push(s.getMigrationStatusFresh());
    s.remove('Pengaturan','legacyMigrationStatus');
    out.push(s.getMigrationStatusFresh() || false);
    return out;
  });`);
  assert.deepEqual(results, [{ batchId: 'a' }, { batchId: 'b' }, { batchId: 'c' }, false]);
  assert.equal(m.reads.Pengaturan, 5);
  assert.equal(m.flushes(), 5, 'each changed setting has a durable boundary, followed by transaction commit');
  assert.equal(h.isLocked(), false);
});

test('a durable checkpoint remains unconditional and refreshes a prior status memo', () => {
  const { h } = fixture(), m = meter(h);
  h.run(`pkStore_().lock(function(){
    pkStore_().getMigrationStatusFresh();
    pkStore_().checkpoint(['Pengaturan']);
    pkStore_().checkpoint(['Pengaturan']);
    pkStore_().getMigrationStatusFresh();
  });`);
  assert.equal(m.reads.Pengaturan, 4);
  assert.equal(m.flushes(), 3);
  assert.equal(m.invalidations.length, 2);
});

test('a physical status read error fails closed even when execution cache contains an older safe status', () => {
  const { h } = fixture();
  h.run('pkStore_().getSettings();');
  h.sheets.Pengaturan.getDataRange = () => { throw new Error('Sheets sementara tidak tersedia'); };
  assert.throws(() => h.run('pkStore_().getMigrationStatusFresh();'), /Sheets sementara tidak tersedia/);
  assert.throws(() => h.run('pkStore_().lock(function(){pkStore_().getMigrationStatusFresh();pkStore_().append("Potong",{id:"must_not_write"});});'), /Sheets sementara tidak tersedia/);
  assert.equal(h.sheets.Potong.values.length, 1);
  assert.equal(h.isLocked(), false);
});

test('actual login saves one settings read and two flushes while preserving the authenticated response', () => {
  function measured(legacy) {
    const { h, owner } = fixture();
    if (legacy) h.run(`pkStore_().getMigrationStatusFresh=function(){this.checkpoint(['Pengaturan']);return this.getSettings().legacyMigrationStatus;};void 0;`);
    const m = meter(h), result = h.request('login', { userId: owner.id, pin: '1234' });
    assert.equal(result.ok, true, result.error);
    assert.ok(result.data.token);
    assert.equal(result.data.state.me.id, owner.id);
    assert.equal(result.data.state.me.divisi, 'owner');
    assert.equal(h.isLocked(), false);
    return { result, reads: m.reads.Pengaturan, flushes: m.flushes(), invalidations: m.invalidations.length };
  }
  const old = measured(true), current = measured(false);
  assert.equal(old.reads, 2);
  assert.equal(current.reads, 1);
  assert.equal(old.flushes, 3);
  assert.equal(current.flushes, 1);
  assert.equal(current.invalidations, 0);
  assert.deepEqual(Object.keys(current.result.data.state).sort(), Object.keys(old.result.data.state).sort());
});

test('optimized login still rejects wrong PIN and disabled accounts without issuing a new session', () => {
  const { h, owner } = fixture();
  const oldToken = h.run('pkStore_().read("Pegawai")[0].token');
  const wrong = h.request('login', { userId: owner.id, pin: '9999' });
  assert.equal(wrong.ok, true, wrong.error);
  assert.equal(wrong.data.salah, true);
  assert.equal(wrong.data.token, undefined);
  assert.equal(h.run('pkStore_().read("Pegawai")[0].token'), oldToken);
  assert.equal(h.run('pkStore_().read("Pegawai")[0].gagal'), 1);
  h.run(`pkStore_().lock(function(){pkStore_().update('Pegawai',${JSON.stringify(owner.id)},{aktif:false});});`);
  h.cold();
  const disabled = h.request('login', { userId: owner.id, pin: '1234' });
  assert.equal(disabled.ok, false);
  assert.match(disabled.error, /Pegawai tidak ditemukan/);
  assert.equal(h.run('pkStore_().read("Pegawai")[0].token'), oldToken);
  assert.equal(h.isLocked(), false);
});

test('a cold-cache login checks metadata once per table and still loads physical production rows', () => {
  const { h, owner } = fixture();
  h.run(`pkStore_().lock(function(){pkStore_().append('Produk',{id:'product01',nama:'Contoh'});});`);
  for (const key of Object.keys(h.cached)) delete h.cached[key];
  h.cold();
  const m = meter(h), result = h.request('login', { userId: owner.id, pin: '1234' });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.data.state.produk[0].id, 'product01');
  assert.equal(m.reads.Produk, 1);
  const cacheReads = h.events.filter(e => e[0] === 'cache.get');
  assert.equal(cacheReads.length, 2, 'one Pegawai lookup and one batched state prefetch; no repeated per-table miss lookup');
  const keys = cacheReads.flatMap(event => event.slice(1));
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(m.reads.Pengaturan, 1);
  assert.equal(m.flushes(), 1);
});

test('memoized metadata misses still fall back to Sheets when cached parts are evicted and reset for new locks', () => {
  const { h } = fixture();
  h.run(`pkStore_().lock(function(){pkStore_().append('Produk',{id:'product01',nama:'Contoh'});});`);
  for (const key of Object.keys(h.cached)) if (key.includes('|Produk|') && /\|\d+\|\d+$/.test(key)) delete h.cached[key];
  h.cold();
  const m = meter(h);
  assert.equal(h.run(`pkStore_().lock(function(){pkStore_().prefetch(['Produk']);return pkStore_().read('Produk')[0].id;});`), 'product01');
  assert.equal(m.reads.Produk, 1);
  assert.equal(h.events.filter(e => e[0] === 'cache.get').length, 2, 'metadata and missing-part batch, without a redundant retry');
  assert.equal(h.run(`pkStore_().lock(function(){pkStore_().prefetch(['Produk']);return pkStore_().read('Produk')[0].id;});`), 'product01');
  assert.equal(m.reads.Produk, 1, 'new lock can use the cache populated after physical fallback');
  assert.equal(h.events.filter(e => e[0] === 'cache.get').length, 4);
});

test('changed sync reads durable status once and a hard-timeout marker prevents a stale same-version response', () => {
  const { h, token } = fixture(), m = meter(h);
  const fresh = h.request('sync', { token, ver: -1 });
  assert.equal(fresh.ok, true, fresh.error);
  assert.equal(fresh.data.me.divisi, 'owner');
  assert.equal(m.reads.Pengaturan, 1);
  assert.equal(m.flushes(), 0);
  const version = h.properties.ver;
  h.run(`pkStore_().setSettings({legacyMigrationStatus:{batchId:'recover001',beforeHash:'before',planHash:'plan',at:'2026-10-08'}});pkStore_().checkpoint(['Pengaturan']);`);
  h.cold();
  const recovery = h.request('sync', { token, ver: Number(version) });
  assert.equal(recovery.ok, true, recovery.error);
  assert.notEqual(recovery.data.same, true);
  assert.equal(recovery.data.settings.legacyMigrationStatus.batchId, 'recover001');
  const writes = h.sheets.Produk.writes;
  const blocked = h.request('saveProduk', { token, produk: { id: 'blocked01', nama: 'Tidak disimpan' } });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /Pemulihan riwayat belum selesai/);
  assert.equal(h.sheets.Produk.writes, writes);
});

