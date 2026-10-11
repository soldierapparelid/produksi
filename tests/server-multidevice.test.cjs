'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
const source=['src/core.js','apps-script/Server.gs'].map(p=>fs.readFileSync(path.resolve(__dirname,'..',p),'utf8')).join('\n');

// Each device has a separate Apps Script execution/global cache, but shares the
// durable book, script properties, ScriptCache and ScriptLock, as real requests do.
function device(h){
 const context=vm.createContext(Object.fromEntries(['Date','console','PropertiesService','CacheService','SpreadsheetApp','LockService','Utilities'].map(k=>[k,h.context[k]])));
 vm.runInContext(source,context);
 return {context,run(code){const value=vm.runInContext(code,context);return value===undefined?undefined:JSON.parse(JSON.stringify(value));}};
}
function fixture(){
 const h=harness();h.run("pkSetup_();pkStore_().lock(function(){pkStore_().appendMany('Produk',[{id:'product-a',nama:'Original A'},{id:'product-b',nama:'Original B'}]);});");
 return h;
}
function failValuesOnce(sheet,after){
 const original=sheet.getRange.bind(sheet);let failed=false;
 sheet.getRange=(...args)=>{
  const r=original(...args),set=r.setValues.bind(r);
  r.setValues=rows=>{if(args[0]>1&&!failed){failed=true;if(after)set(rows);throw new Error('synthetic lost write response');}return set(rows);};
  return r;
 };
 return ()=>{sheet.getRange=original;};
}

test('a waiting device discards pre-lock rows and properties before reading or patching current rows',()=>{
 const h=fixture(),a=device(h),b=device(h);
 assert.equal(a.run("pkStore_().read('Produk')[0].nama"),'Original A');const initial=a.run('pkStore_().version()');
 b.run("pkStore_().lock(function(){pkStore_().update('Produk','product-a',{nama:'Saved by B'});pkStore_().append('Produk',{id:'product-c',nama:'Created by B'});});");
 const latest=a.run("pkStore_().lock(function(){var rows=pkStore_().read('Produk');if(rows[0].nama!=='Saved by B'||rows.length!==3)throw Error('stale lock snapshot');pkStore_().update('Produk','product-a',{catatan:'Patch by A'});return {rows:pkStore_().read('Produk'),ver:pkStore_().version()};});");
 assert.equal(latest.rows[0].nama,'Saved by B');assert.equal(latest.rows[0].catatan,'Patch by A');assert.equal(latest.rows.length,3);assert.equal(latest.ver,initial+2);
 assert.equal(device(h).run("pkStore_().read('Produk')[0].nama"),'Saved by B');assert.equal(h.isLocked(),false);
});

test('replacement never clears the old table before a failed value write and preserves extra columns',()=>{
 const h=fixture(),sheet=h.sheets.Produk;sheet.values[0].push('Owner extra');sheet.values[1].push('Keep A');sheet.values[2].push('Keep B');
 const before=JSON.stringify(sheet.values),restore=failValuesOnce(sheet,false),b=device(h);
 assert.throws(()=>b.run("pkStore_().lock(function(){pkStore_().replaceAll('Produk',[{id:'product-a',nama:'Replacement A'}]);});"),/lost write response/);
 restore();assert.equal(JSON.stringify(sheet.values),before,'no clearContent may precede the single replacement write');
 const cold=device(h);assert.equal(cold.run("pkStore_().read('Produk').length"),2);assert.equal(cold.run("pkStore_().read('Produk')[0].nama"),'Original A');
 const writes=sheet.writes;cold.run("pkStore_().lock(function(){pkStore_().replaceAll('Produk',[{id:'product-a',nama:'Replacement A'}]);});");
 assert.equal(sheet.writes,writes+1,'new rows and the obsolete tail use one setValues');
 assert.equal(sheet.values[1][sheet.values[0].indexOf('Owner extra')],'Keep A');assert.ok(sheet.values[2].every(v=>v===''));
 assert.deepEqual(device(h).run("pkStore_().read('Produk').map(function(r){return r.id;})"),['product-a']);
});

test('an append that persists but loses its response invalidates old cache and a second device retries without duplication',()=>{
 const h=fixture(),a=device(h),b=device(h);a.run("pkStore_().read('Produk');");const ver=Number(h.properties.ver),restore=failValuesOnce(h.sheets.Produk,true);
 assert.throws(()=>b.run("pkStore_().lock(function(){pkStore_().append('Produk',{id:'request-stable',nama:'New durable row'});});"),/lost write response/);restore();
 assert.equal(Number(h.properties.ver),ver+1);assert.equal(h.isLocked(),false);
 const records=device(h).run("pkStore_().read('Produk')");assert.equal(records.length,3);assert.equal(records[2].id,'request-stable');
 a.run("pkStore_().lock(function(){if(!pkStore_().read('Produk').some(function(r){return r.id==='request-stable';}))pkStore_().append('Produk',{id:'request-stable',nama:'Duplicate'});});");
 assert.equal(device(h).run("pkStore_().read('Produk').filter(function(r){return r.id==='request-stable';}).length"),1);
});

test('uncertain update, replacement and removal never publish stale in-memory rows as the committed version',()=>{
 for(const operation of ['update','replaceAll','remove']){
  const h=fixture(),b=device(h);device(h).run("pkStore_().read('Produk');");let restore;
  if(operation==='remove'){
   const old=h.sheets.Produk.deleteRow.bind(h.sheets.Produk);h.sheets.Produk.deleteRow=row=>{old(row);throw new Error('synthetic lost write response');};restore=()=>{h.sheets.Produk.deleteRow=old;};
  }else restore=failValuesOnce(h.sheets.Produk,true);
  const command={update:"pkStore_().update('Produk','product-a',{nama:'Durable update'});",replaceAll:"pkStore_().replaceAll('Produk',[{id:'product-a',nama:'Durable replacement'}]);",remove:"pkStore_().remove('Produk','product-a');"}[operation];
  assert.throws(()=>b.run('pkStore_().lock(function(){'+command+'});'),/lost write response/);restore();
  const rows=device(h).run("pkStore_().read('Produk')");
  if(operation==='update'){assert.equal(rows.length,2);assert.equal(rows[0].nama,'Durable update');}
  if(operation==='replaceAll'){assert.equal(rows.length,1);assert.equal(rows[0].nama,'Durable replacement');}
  if(operation==='remove')assert.deepEqual(rows.map(r=>r.id),['product-b']);
 }
});

test('direct-sheet invalidation acquires the commit lock and invalidates the latest table version',()=>{
 const h=fixture(),b=device(h);b.run("pkStore_().lock(function(){pkStore_().update('Produk','product-a',{nama:'Saved in app'});});");
 const ver=Number(h.properties.ver),tab=Number(h.properties.v_Produk),before=h.events.length;
 h.sheets.Produk.values[1][h.sheets.Produk.values[0].indexOf('nama')]='Direct sheet edit';
 h.context.editedSheet=h.sheets.Produk;h.run('onEdit({range:{getSheet:function(){return editedSheet;}}});');
 assert.equal(Number(h.properties.ver),ver+1);assert.equal(Number(h.properties.v_Produk),tab+1);
 assert.deepEqual(h.events.slice(before).filter(e=>e[0]==='lock'||e[0]==='unlock'),[['lock'],['unlock']]);
 assert.equal(device(h).run("pkStore_().read('Produk')[0].nama"),'Direct sheet edit');
});

test('production adapter admits current clients and exposes only the safe update-required error fields',()=>{
 const h=harness();assert.equal(h.run('pkEnv_().enforceClientVersion'),true);
 const version=h.run('APP_VERSION');
 for(const clientVersion of [undefined,'old-client']){
  const payload={nama:'Synthetic Owner',pin:'1234'};if(clientVersion!==undefined)payload.clientVersion=clientVersion;
  const result=JSON.parse(h.run(`api(${JSON.stringify(JSON.stringify({action:'setupOwner',payload}))})`));assert.equal(result.ok,false);assert.equal(result.updateRequired,true);assert.equal(result.appVersion,version);
  assert.deepEqual(Object.keys(result).sort(),['appVersion','error','ok','updateRequired']);
  assert.equal(device(h).run("pkStore_().read('Pegawai').length"),0);
 }
 const success=h.request('setupOwner',{nama:'Synthetic Owner',pin:'1234',clientVersion:version});assert.equal(success.ok,true,success.error);
 h.run("createCore=function(){return {handle:function(){var e=new Error('Synthetic version refusal');e.updateRequired=true;e.appVersion='untrusted';e.token='must-not-leak';e.sourceSnapshot={private:true};throw e;}};};void 0;");
 const failure=h.request('synthetic');assert.deepEqual(Object.keys(failure).sort(),['appVersion','error','ok','updateRequired']);assert.equal(failure.appVersion,version);assert.equal(failure.token,undefined);
});
