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

// Since 1.5.3 the adapter keeps a durable hint (script property "mig"). '0' means: the last
// PHYSICAL status read made while holding the script lock found no pending recovery, and the
// settings table has not been written since. Every settings write raises the hint to '1' before
// its first physical write, so a recovery that dies mid-way always leaves it unsure.
test('a durable "nothing pending" hint needs no spreadsheet access; an unsure hint reads Sheets every time without memoizing', () => {
  const { h } = fixture(), m = meter(h);
  assert.equal(h.properties.mig, '0', 'setup established the hint from a locked physical read');
  assert.equal(h.run('pkStore_().getMigrationStatusFresh()'), undefined);
  assert.equal(m.reads.Pengaturan || 0, 0, 'hint 0 must not open the spreadsheet');
  /* What an interrupted recovery leaves behind: the raised hint and a status row that no cache knows about. */
  h.properties.mig = '1'; h.cold();
  h.run('pkStore_().getSettings();');
  const sheet = h.sheets.Pengaturan, key = sheet.values[0].indexOf('key'), value = sheet.values[0].indexOf('value');
  sheet.values.push(sheet.values[0].map((_, col) => col === key ? 'legacyMigrationStatus' : col === value ? '{"batchId":"pending001"}' : ''));
  assert.deepEqual(h.run('pkStore_().getMigrationStatusFresh()'), { batchId: 'pending001' });
  sheet.values.at(-1)[value] = 'false';
  assert.equal(h.run('pkStore_().getMigrationStatusFresh()'), false, 'unlocked calls must not memoize a prior status');
  assert.equal(m.reads.Pengaturan, 2);
  assert.equal(h.properties.mig, '1', 'a reader without the lock never lowers the hint');
  assert.equal(m.flushes(), 0);
  assert.equal(m.invalidations.length, 0);
});

test('an unsure hint costs one physical settings read inside a lock, which then settles it for later locks', () => {
  const { h } = fixture(), m = meter(h);
  h.properties.mig = '1'; h.cold();
  h.run(`pkStore_().lock(function(){
    pkStore_().getMigrationStatusFresh();
    pkStore_().append('Potong',{id:'cut001',total:2});
    pkStore_().getMigrationStatusFresh();
    pkStore_().lock(function(){pkStore_().getMigrationStatusFresh();});
  });`);
  assert.equal(m.reads.Pengaturan, 1);
  assert.equal(m.flushes(), 1, 'only the normal transaction commit flushes');
  assert.equal(m.invalidations.length, 0);
  assert.equal(h.properties.mig, '0', 'a locked physical read that finds nothing pending lowers the hint');
  h.run('pkStore_().lock(function(){pkStore_().getMigrationStatusFresh();});');
  assert.equal(m.reads.Pengaturan, 1, 'a later lock relies on the durable hint until settings are written again');
  assert.equal(h.isLocked(), false);
});

test('every settings write raises the hint before its first physical write, including writes made outside a lock', () => {
  for (const write of [
    `pkStore_().append('Pengaturan',{key:'catatanUji',value:'"a"'});`,
    `pkStore_().setSettings({alamat:'Alamat contoh'});`,
    `pkStore_().replaceAll('Pengaturan',[{key:'namaUsaha',value:'"Contoh"'}]);`,
    `pkStore_().remove('Pengaturan','namaUsaha');`
  ]) {
    const { h } = fixture(); assert.equal(h.properties.mig, '0');
    const sheet = h.sheets.Pengaturan, order = [];
    const props = h.context.PropertiesService.getScriptProperties(), setProperty = props.setProperty.bind(props);
    props.setProperty = (k, v) => { if (k === 'mig') order.push('hint:' + v); return setProperty(k, v); };
    const getRange = sheet.getRange.bind(sheet);
    sheet.getRange = (...args) => { const r = getRange(...args), set = r.setValues.bind(r); r.setValues = rows => { order.push('write'); return set(rows); }; return r; };
    const deleteRow = sheet.deleteRow.bind(sheet); sheet.deleteRow = row => { order.push('write'); return deleteRow(row); };
    h.run(write + 'void 0;');
    assert.equal(order[0], 'hint:1', write);
    assert.ok(order.includes('write'), write);
    assert.equal(h.properties.mig, '1', 'no lock was held, so nothing may lower it again');
  }
  const { h } = fixture();
  props: {
    const failing = h.context.PropertiesService.getScriptProperties();
    failing.setProperty = () => { throw new Error('properties unavailable'); };
    const writes = h.sheets.Pengaturan.writes;
    assert.throws(() => h.run(`pkStore_().lock(function(){pkStore_().setSettings({alamat:'Tidak boleh tersimpan'});});`), /properties unavailable/);
    assert.equal(h.sheets.Pengaturan.writes, writes, 'a settings write is refused when the hint cannot be raised first');
    assert.equal(h.isLocked(), false);
  }
});

test('a manual edit of the settings sheet raises the hint through onEdit', () => {
  const { h } = fixture(); assert.equal(h.properties.mig, '0');
  h.run(`onEdit({range:{getSheet:function(){return {getName:function(){return 'Potong';}};}}});`);
  assert.equal(h.properties.mig, '0', 'edits of other known tables leave it alone');
  h.run(`onEdit({range:{getSheet:function(){return {getName:function(){return 'Pengaturan';}};}}});`);
  assert.equal(h.properties.mig, '1');
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

test('a durable checkpoint remains unconditional, and a status found by it is honoured even while the hint says nothing is pending', () => {
  const { h } = fixture(), m = meter(h);
  const sheet = h.sheets.Pengaturan, key = sheet.values[0].indexOf('key'), value = sheet.values[0].indexOf('value');
  const seen = h.run(`pkStore_().lock(function(){
    var out=[];
    out.push(pkStore_().getMigrationStatusFresh() || false);
    pkStore_().checkpoint(['Pengaturan']);
    pkStore_().checkpoint(['Pengaturan']);
    out.push(pkStore_().getMigrationStatusFresh() || false);
    return out;
  });`);
  assert.deepEqual(seen, [false, false]);
  assert.equal(m.reads.Pengaturan, 2, 'each checkpoint reads Sheets; the status check reuses that physical read');
  assert.equal(m.flushes(), 3);
  assert.equal(m.invalidations.length, 2);
  sheet.values.push(sheet.values[0].map((_, col) => col === key ? 'legacyMigrationStatus' : col === value ? '{"batchId":"found_by_checkpoint"}' : ''));
  h.cold();
  assert.equal(h.properties.mig, '0');
  assert.deepEqual(h.run(`pkStore_().lock(function(){pkStore_().checkpoint(['Pengaturan']);return pkStore_().getMigrationStatusFresh();});`), { batchId: 'found_by_checkpoint' });
});

test('a physical status read error fails closed whenever the hint is unsure, and is not attempted while it is settled', () => {
  const { h } = fixture();
  h.run('pkStore_().getSettings();');
  h.sheets.Pengaturan.getDataRange = () => { throw new Error('Sheets sementara tidak tersedia'); };
  assert.equal(h.run('pkStore_().getMigrationStatusFresh() || false'), false, 'hint 0: ordinary requests do not depend on a spreadsheet read');
  h.properties.mig = '1'; h.cold(); h.run('pkStore_().getSettings();');
  assert.throws(() => h.run('pkStore_().getMigrationStatusFresh();'), /Sheets sementara tidak tersedia/);
  assert.throws(() => h.run('pkStore_().lock(function(){pkStore_().getMigrationStatusFresh();pkStore_().append("Potong",{id:"must_not_write"});});'), /Sheets sementara tidak tersedia/);
  assert.equal(h.sheets.Potong.values.length, 1);
  assert.equal(h.properties.mig, '1');
  assert.equal(h.isLocked(), false);
});

test('actual login needs no physical settings read and a single commit flush while preserving the authenticated response', () => {
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
  assert.equal(current.reads || 0, 0);
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
  const accountWrites = h.sheets.Pegawai.writes;
  const m = meter(h), result = h.request('login', { userId: owner.id, pin: '1234' });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.data.state.produk[0].id, 'product01');
  assert.equal(m.reads.Produk, 1);
  const cacheReads = h.events.filter(e => e[0] === 'cache.get');
  assert.equal(cacheReads.length, 2, 'one account-cache lookup for the PIN, then one batched state prefetch; no per-table miss lookup');
  assert.equal(m.reads.Pegawai,1,'the account cache miss falls back to exactly one physical account read');
  assert.equal(h.sheets.Pegawai.writes, accountWrites, 'the session itself is not written to Sheets');
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

test('ordinary sync opens no spreadsheet for the recovery status, and a hard-timeout marker still prevents a stale same-version response', () => {
  const { h, token } = fixture(), m = meter(h);
  const fresh = h.request('sync', { token, ver: -1 });
  assert.equal(fresh.ok, true, fresh.error);
  assert.equal(fresh.data.me.divisi, 'owner');
  assert.equal(m.reads.Pengaturan || 0, 0, 'the settled hint replaces the physical status read');
  assert.equal(m.flushes(), 0);
  const version = h.properties.ver;
  const quiet = h.request('sync', { token, ver: Number(version), av: fresh.data.appVersion });
  assert.equal(quiet.ok, true, quiet.error); assert.equal(quiet.data.same, true);
  assert.deepEqual(m.reads, {}, 'a no-change poll never opens the spreadsheet');
  /* A recovery that wrote its marker and then hit the execution limit: no lock.finally, no version bump. */
  h.run(`pkStore_().setSettings({legacyMigrationStatus:{batchId:'recover001',beforeHash:'before',planHash:'plan',at:'2026-10-08'}});pkStore_().checkpoint(['Pengaturan']);`);
  assert.equal(h.properties.mig, '1', 'the marker write raised the hint durably before touching the sheet');
  assert.equal(h.properties.ver, version, 'the interrupted execution never published a new version');
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

// Since 1.5.3 a PIN that matches the versioned account cache signs in without opening the spreadsheet.
// Every other outcome (mismatch, unknown or disabled account, counters, lock) is decided from the physical row.
const editedBy = sheet => `onEdit({range:{getSheet:function(){return {getName:function(){return ${JSON.stringify(sheet)};}};}}});`;
test('login decides every rejection from the physical account row, and manual sheet edits announced by onEdit retire the cached account',()=>{
  const {h,owner}=fixture();h.run('pkStore_().read("Pegawai");');
  const sheet=h.sheets.Pegawai,cols=sheet.values[0],row=sheet.values.find(r=>r[cols.indexOf('id')]===owner.id),originalTokens=row[cols.indexOf('token')];
  const sessions=()=>String(h.properties['s_'+owner.id]||'').split(',').filter(Boolean).length,before=sessions();
  /* A new PIN typed into the sheet works at once, even if the cache still holds the old one: a mismatch is always rechecked physically. */
  row[cols.indexOf('pin')]='5678';h.cold();
  const newPin=h.request('login',{userId:owner.id,pin:'5678',deferState:true});assert.equal(newPin.ok,true,newPin.error);assert.ok(newPin.data.token);assert.equal(sessions(),before+1);
  /* Google runs onEdit for manual edits: the cached account is retired, so the old PIN and old counters are gone. */
  row[cols.indexOf('pin')]='9012';row[cols.indexOf('gagal')]=4;h.run(editedBy('Pegawai'));h.cold();
  const stalePIN=h.request('login',{userId:owner.id,pin:'5678'});assert.equal(stalePIN.ok,true);assert.equal(stalePIN.data.salah,true);assert.match(stalePIN.data.pesan,/dikunci/);
  assert.equal(row[cols.indexOf('token')],originalTokens);assert.ok(row[cols.indexOf('kunci')]);assert.equal(sessions(),before+1,'a rejected attempt issues no session');
  row[cols.indexOf('kunci')]='';row[cols.indexOf('aktif')]=false;h.run(editedBy('Pegawai'));h.cold();
  const disabled=h.request('login',{userId:owner.id,pin:'9012'});assert.equal(disabled.ok,false);assert.match(disabled.error,/Pegawai tidak ditemukan/);
  assert.equal(row[cols.indexOf('token')],originalTokens);assert.equal(sessions(),before+1);
});

test('account changes made through the application always replace the cached account before the next sign-in',()=>{
  const {h,owner,token}=fixture();
  const worker=h.request('saveUser',{token,user:{nama:'Pekerja Contoh',divisi:'jahit',pin:'4567'}});assert.equal(worker.ok,true,worker.error);const id=worker.data.data.id;
  h.cold();const first=h.request('login',{userId:id,pin:'4567',deferState:true});assert.equal(first.ok,true,first.error);
  h.cold();assert.equal(h.request('saveUser',{token,user:{id,nama:'Pekerja Contoh',divisi:'jahit',pin:'8910'}}).ok,true);
  h.cold();const oldPin=h.request('login',{userId:id,pin:'4567',deferState:true});assert.equal(oldPin.ok,true);assert.equal(oldPin.data.salah,true);assert.equal(oldPin.data.token,undefined);
  h.cold();assert.equal(h.request('getState',{token:first.data.token}).ok,false,'changing a PIN signs that person out everywhere');
  h.cold();const second=h.request('login',{userId:id,pin:'8910',deferState:true});assert.equal(second.ok,true,second.error);assert.ok(second.data.token);
  h.cold();assert.equal(h.request('saveUser',{token,user:{id,nama:'Pekerja Contoh',divisi:'jahit',aktif:false}}).ok,true);
  h.cold();const disabled=h.request('login',{userId:id,pin:'8910',deferState:true});assert.equal(disabled.ok,false);assert.match(disabled.error,/Pegawai tidak ditemukan/);
  h.cold();assert.equal(h.request('getState',{token:second.data.token}).ok,false);
  assert.equal(h.properties['s_'+id],undefined,'no session survives deactivation');
  assert.equal(h.request('getState',{token}).ok,true,'the owner session is untouched');assert.ok(owner.id);
});

test('known limit: a sheet change that Google does not announce is honoured once the 30-minute account cache has gone',()=>{
  const {h,owner}=fixture();h.run('pkStore_().read("Pegawai");');
  const sheet=h.sheets.Pegawai,cols=sheet.values[0],row=sheet.values.find(r=>r[cols.indexOf('id')]===owner.id);
  row[cols.indexOf('aktif')]=false;h.cold();
  const cachedAccount=h.request('login',{userId:owner.id,pin:'1234',deferState:true});assert.equal(cachedAccount.ok,true,'the versioned account cache still answers until it expires or the table version moves');
  for(const key of Object.keys(h.cached))if(key.includes('|Pegawai|'))delete h.cached[key];h.cold();
  const afterExpiry=h.request('login',{userId:owner.id,pin:'1234',deferState:true});assert.equal(afterExpiry.ok,false);assert.match(afterExpiry.error,/Pegawai tidak ditemukan/);
  assert.equal(h.run('PK_CACHE_ACCOUNT_TTL_'),1800);
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

