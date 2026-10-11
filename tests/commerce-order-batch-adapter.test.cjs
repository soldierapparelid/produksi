'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
const files=['src/core.js','src/reconcile-legacy.js','src/commerce-hpp.js','src/slip-models.js','src/commerce.js','src/commerce-migration.js','apps-script/Server.gs'];
const source=files.map(p=>fs.readFileSync(path.resolve(__dirname,'..',p),'utf8')).join('\n');
function client(h){
  const context=vm.createContext(Object.fromEntries(['Date','console','PropertiesService','CacheService','SpreadsheetApp','LockService','Utilities'].map(k=>[k,h.context[k]])));vm.runInContext(source,context);
  return {request(action,payload={}){return JSON.parse(vm.runInContext('api('+JSON.stringify(JSON.stringify({action,payload:{clientVersion:vm.runInContext('APP_VERSION',context),workflowVersion:2,...payload}}))+')',context));}};
}
function fixture(){
  const h=harness(),setup=client(h).request('setupOwner',{nama:'Synthetic invoice owner',pin:'1234'});assert.equal(setup.ok,true,setup.error);const token=setup.data.token;
  function call(action,payload={}){return client(h).request(action,{token,...payload});}
  function good(action,payload={}){const result=call(action,payload);assert.equal(result.ok,true,result.error);return result.data;}
  good('saveCommerceSupplier',{record:{id:'source-supplier',nama:'Synthetic supplier'}});
  for(const id of ['model-a','model-b'])good('saveCommerceProduct',{record:{id,supplierId:'source-supplier',nama:id}});
  const invoice={id:'invoice-stable',supplierId:'source-supplier',grupNama:'Synthetic invoice',tanggalOrder:'2026-10-11',catatan:'Independent adapter boundary',orders:[{id:'order-a',produkId:'model-a',hargaSatuan:1000,items:[{id:'a-M',nama:'M',jumlah:7}]},{id:'order-b',produkId:'model-b',hargaSatuan:2000,items:[{id:'b-L',nama:'L',jumlah:5}]}],initialPayment:{jumlah:3333,tanggal:'2026-10-11',metode:'transfer',catatan:'One shared DP'},withState:true};
  return {h,token,call,good,invoice};
}

test('batch order and DP values reach Sheets in one locked marked write and a fresh execution replay makes no new write',()=>{
  const f=fixture(),sheet=f.h.sheets.CommerceRecord,original=sheet.getRange.bind(sheet),observed=[],before=sheet.writes,ver=Number(f.h.properties.ver),eventWrites=f.h.sheets.CommerceEvent.writes;
  sheet.getRange=(...args)=>{const range=original(...args),write=range.setValues.bind(range);range.setValues=rows=>{if(args[0]>1){assert.equal(f.h.isLocked(),true);assert.equal(f.h.properties.pendingWrite,'1');observed.push(rows.map(row=>JSON.parse(row[sheet.values[0].indexOf('data')])));}return write(rows);};return range;};
  const out=f.good('saveCommerceOrderBatch',f.invoice);assert.equal(observed.length,1);assert.equal(observed[0].length,2);assert.equal(observed[0].reduce((n,row)=>n+row._initialPayment.jumlah,0),3333);assert.ok(observed[0].every(row=>row._initialPayment.groupId===f.invoice.id&&row.invoiceOrderIds.length===2));
  assert.equal(sheet.writes,before+1);assert.equal(f.h.sheets.CommerceEvent.writes,eventWrites);assert.equal(Number(f.h.properties.ver),ver+1);assert.equal(f.h.properties.pendingWrite,'');assert.deepEqual(out.orderIds,['order-a','order-b']);
  const frozen=JSON.stringify(sheet.values),replay=f.good('saveCommerceOrderBatch',f.invoice);assert.equal(replay.records.reduce((n,r)=>n+r.totalPaid,0),3333);assert.equal(JSON.stringify(sheet.values),frozen);assert.equal(sheet.writes,before+1);assert.equal(Number(f.h.properties.ver),ver+1);assert.equal(f.h.isLocked(),false);
});

test('durable batch plus failed version publication is recovered by another device without stale state or duplicated invoice/DP',()=>{
  const f=fixture(),props=f.h.context.PropertiesService.getScriptProperties(),publish=props.setProperties.bind(props),ver=Number(f.h.properties.ver),sheet=f.h.sheets.CommerceRecord;
  props.setProperties=(values,remove)=>{if(Object.hasOwn(values,'ver'))throw new Error('synthetic interrupted invoice publication');return publish(values,remove);};
  const failed=f.call('saveCommerceOrderBatch',f.invoice);assert.equal(failed.ok,false);assert.equal(failed.uncertain,true);assert.equal(failed.data,undefined);assert.equal(f.h.properties.pendingWrite,'1');assert.equal(Number(f.h.properties.ver),ver);const writes=sheet.writes;
  props.setProperties=publish;const state=f.good('getCommerceState',{module:'pembelian'});assert.equal(state.orders.length,2);assert.equal(state.orders.reduce((n,o)=>n+o.totalPaid,0),3333);assert.equal(Number(f.h.properties.ver),ver+1);assert.equal(f.h.properties.pendingWrite,'');
  const replay=f.good('saveCommerceOrderBatch',f.invoice);assert.equal(replay.records.length,2);assert.equal(replay.records.reduce((n,o)=>n+o.totalPaid,0),3333);assert.equal(sheet.writes,writes);assert.equal(f.h.sheets.CommerceEvent.values.length,1,'initial DP remains embedded once, never emitted again');
});

test('a later invalid model and an unavailable durable marker both prevent all batch physical writes',()=>{
  const f=fixture(),sheet=f.h.sheets.CommerceRecord,before=JSON.stringify(sheet.values),writes=sheet.writes,ver=f.h.properties.ver;
  const invalid=JSON.parse(JSON.stringify(f.invoice));invalid.orders[1].produkId='missing-model';const result=f.call('saveCommerceOrderBatch',invalid);assert.equal(result.ok,false);assert.match(result.error,/Produk|tidak ditemukan/);assert.equal(result.uncertain,undefined);assert.equal(sheet.writes,writes);assert.equal(JSON.stringify(sheet.values),before);assert.equal(f.h.properties.ver,ver);
  const props=f.h.context.PropertiesService.getScriptProperties(),set=props.setProperty.bind(props);props.setProperty=(key,value)=>{if(key==='pendingWrite')throw new Error('synthetic marker unavailable');return set(key,value);};
  const blocked=f.call('saveCommerceOrderBatch',f.invoice);assert.equal(blocked.ok,false);assert.equal(blocked.uncertain,undefined);assert.equal(sheet.writes,writes);assert.equal(JSON.stringify(sheet.values),before);assert.equal(f.h.properties.ver,ver);assert.equal(f.h.isLocked(),false);
});

test('the actual adapter rejects stale client and workflow contracts before any batch physical mutation',()=>{
  const f=fixture(),before=JSON.stringify(f.h.sheets.CommerceRecord.values),writes=f.h.sheets.CommerceRecord.writes;
  const old=f.call('saveCommerceOrderBatch',{...f.invoice,clientVersion:'0.0.1'});assert.equal(old.ok,false);assert.equal(old.updateRequired,true);assert.equal(old.uncertain,undefined);
  const workflow=f.call('saveCommerceOrderBatch',{...f.invoice,workflowVersion:1});assert.equal(workflow.ok,false);assert.match(workflow.error,/Versi alur/);
  assert.equal(f.h.sheets.CommerceRecord.writes,writes);assert.equal(JSON.stringify(f.h.sheets.CommerceRecord.values),before);assert.equal(f.h.isLocked(),false);
});
