'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers/apps-script-harness.cjs');

// Count actual adapter boundary calls rather than timing the in-memory mock.
// Remote Sheets latency varies; avoiding one getValues and two flushes is the
// measurable optimization, not a promised number of seconds on a live account.
function meter(h) {
  const reads = {}, invalidations = [], cachePuts = [];
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
  const putAll = cache.putAll.bind(cache); cache.putAll = (values, ttl) => { cachePuts.push(Object.keys(values)); return putAll(values, ttl); };
  h.events.length = 0;
  return { reads, invalidations, cachePuts, flushes: () => h.events.filter(e => e[0] === 'flush').length };
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
  assert.equal(cacheReads.length, 1, 'physical account validation plus one batched state prefetch; no per-table miss lookup');
  assert.equal(m.reads.Pegawai,1,'PIN validation and session write share the same physical account read');
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

test('cold login batches independent read-cache fills with fewer cache RPCs and identical authenticated state',()=>{
  function measured(batch){
    const {h,owner}=fixture();for(const key of Object.keys(h.cached))delete h.cached[key];h.cold();
    if(!batch)h.run('pkStore_().withReadCacheBatch=function(fn){return fn();};void 0;');
    const m=meter(h),result=h.request('login',{userId:owner.id,pin:'1234'});assert.equal(result.ok,true,result.error);
    const published=m.cachePuts.length,readNames=Object.keys(m.reads).sort();
    h.cold();const warm=h.request('getState',{token:result.data.token});assert.equal(warm.ok,true,warm.error);assert.equal(warm.data.me.id,result.data.state.me.id);
    return{puts:published,reads:readNames,keys:Object.keys(result.data.state).sort()};
  }
  const individual=measured(false),batched=measured(true);
  assert.ok(individual.puts>=12,'fixture must include a real cold full state');
  assert.ok(batched.puts<=Math.ceil((individual.puts-1)/4)+1,JSON.stringify({old:individual.puts,current:batched.puts}));
  assert.deepEqual(batched.reads,individual.reads);assert.deepEqual(batched.keys,individual.keys);
});

test('login physically rechecks PIN, account state and lockout counters even when ScriptCache is stale',()=>{
  const {h,owner}=fixture();h.run('pkStore_().read("Pegawai");');
  const sheet=h.sheets.Pegawai,cols=sheet.values[0],row=sheet.values.find(r=>r[cols.indexOf('id')]===owner.id),originalTokens=row[cols.indexOf('token')];
  row[cols.indexOf('pin')]='5678';row[cols.indexOf('gagal')]=4;h.cold();
  const stalePIN=h.request('login',{userId:owner.id,pin:'1234'});assert.equal(stalePIN.ok,true);assert.equal(stalePIN.data.salah,true);assert.match(stalePIN.data.pesan,/dikunci/);
  assert.equal(row[cols.indexOf('token')],originalTokens);assert.ok(row[cols.indexOf('kunci')]);
  row[cols.indexOf('kunci')]='';row[cols.indexOf('aktif')]=false;h.cold();
  const disabled=h.request('login',{userId:owner.id,pin:'5678'});assert.equal(disabled.ok,false);assert.match(disabled.error,/Pegawai tidak ditemukan/);
  assert.equal(row[cols.indexOf('token')],originalTokens);
});

test('queued read-cache entries are discarded on checkpoint and cannot resurrect invalidated snapshots',()=>{
  const {h}=fixture();for(const key of Object.keys(h.cached))delete h.cached[key];h.cold();
  h.run(`pkStore_().withReadCacheBatch(function(){pkStore_().read('Produk');pkStore_().checkpoint(['Produk']);});`);
  const productKeys=Object.keys(h.cached).filter(key=>key.includes('|Produk|'));assert.equal(productKeys.length,0);
});

test('same-request changes cancel queued old rows and only publish the committed table version',()=>{
  const {h}=fixture();for(const key of Object.keys(h.cached))delete h.cached[key];h.cold();
  h.run(`pkStore_().withReadCacheBatch(function(){pkStore_().read('Produk');pkStore_().lock(function(){pkStore_().append('Produk',{id:'batched01',nama:'Committed fixture'});});});`);
  const v=h.properties.v_Produk,metadata=Object.keys(h.cached).filter(key=>key.includes('|Produk|')&&!/\|\d+\|\d+$/.test(key));
  assert.ok(metadata.every(key=>key.endsWith('|'+v)));h.cold();assert.equal(h.run('pkStore_().read("Produk")[0].nama'),'Committed fixture');
});

test('failed Sheets flush never publishes a staged mutation through the read-cache batch',()=>{
  const {h}=fixture();for(const key of Object.keys(h.cached))delete h.cached[key];h.cold();
  h.context.SpreadsheetApp.flush=()=>{throw new Error('simulated flush failure');};
  assert.throws(()=>h.run(`pkStore_().withReadCacheBatch(function(){pkStore_().read('Produk');pkStore_().lock(function(){pkStore_().append('Produk',{id:'failed01',nama:'Unconfirmed fixture'});});});`),/flush failure/);
  assert.equal(Object.keys(h.cached).filter(key=>key.includes('|Produk|')).length,0);assert.equal(h.isLocked(),false);
});

