'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('./helpers/apps-script-harness.cjs');

test('longer production cache retains current rows while account cache keeps its existing lifetime',()=>{
  const h=harness(),setup=h.request('setupOwner',{nama:'Owner fixture',pin:'1234'});
  assert.equal(setup.ok,true,setup.error);
  h.run("pkStore_().lock(function(){pkStore_().append('Produk',{id:'prod1',nama:'Original'});});");
  for(const key of Object.keys(h.cached))delete h.cached[key];h.cold();
  const c=h.context.CacheService.getScriptCache(),put=c.putAll.bind(c),published=[];
  c.putAll=(rows,ttl)=>{published.push({keys:Object.keys(rows),ttl});put(rows,ttl);};
  h.run("pkStore_().withReadCacheBatch(function(){pkStore_().read('Pegawai');pkStore_().read('Produk');});");
  const account=published.filter(p=>p.keys.some(k=>k.includes('|Pegawai|')));
  const product=published.filter(p=>p.keys.some(k=>k.includes('|Produk|')));
  assert.ok(account.length);assert.ok(product.length);
  assert.ok(account.every(p=>p.ttl===1800));assert.ok(product.every(p=>p.ttl===21600));
  h.cold();h.run("pkStore_().lock(function(){pkStore_().update('Produk','prod1',{nama:'Changed in app'});});");
  h.cold();assert.equal(h.run("pkStore_().read('Produk')[0].nama"),'Changed in app');
  const sheet=h.sheets.Produk,head=sheet.values[0];sheet.values[1][head.indexOf('nama')]='Changed in Sheets';
  h.context.editedSheet=sheet;h.run('onEdit({range:{getSheet:function(){return editedSheet;}}});');h.cold();
  assert.equal(h.run("pkStore_().read('Produk')[0].nama"),'Changed in Sheets','manual edits invalidate still-retained old cache');
  for(const key of Object.keys(h.cached))if(key.includes('|Produk|')&&/\|\d+\|\d+$/.test(key))delete h.cached[key];
  h.cold();assert.equal(h.run("pkStore_().read('Produk')[0].nama"),'Changed in Sheets','evicted parts must fall back to durable rows');
});
