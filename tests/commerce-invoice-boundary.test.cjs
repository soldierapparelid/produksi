'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
const source=['src/core.js','src/reconcile-legacy.js','src/commerce-hpp.js','src/slip-models.js','src/commerce.js','src/commerce-migration.js','apps-script/Server.gs'].map(file=>fs.readFileSync(path.resolve(__dirname,'..',file),'utf8')).join('\n');
function client(h){const c=vm.createContext(Object.fromEntries(['Date','console','PropertiesService','CacheService','SpreadsheetApp','LockService','Utilities'].map(k=>[k,h.context[k]])));vm.runInContext(source,c);return (action,payload)=>JSON.parse(vm.runInContext('api('+JSON.stringify(JSON.stringify({action,payload:{clientVersion:vm.runInContext('APP_VERSION',c),workflowVersion:2,...payload}}))+')',c));}
function fixture(){
  const h=harness(),setup=client(h)('setupOwner',{nama:'Synthetic owner',pin:'1234'});assert.equal(setup.ok,true,setup.error);const token=setup.data.token;
  function call(action,payload={}){const result=client(h)(action,{token,...payload});assert.equal(result.ok,true,result.error);return result.data;}
  call('saveCommerceSupplier',{record:{id:'same-supplier',nama:'One supplier'}});
  for(const id of ['model-A','model-B'])call('saveCommerceProduct',{record:{id,supplierId:'same-supplier',nama:id}});
  function batch(id){return {id,supplierId:'same-supplier',grupNama:'Repeated visible label',tanggalOrder:'2026-10-11',catatan:'Synthetic invoice boundary',orders:[{id:id+'-A',produkId:'model-A',hargaSatuan:100,items:[{id:id+'-item-A',nama:'M',jumlah:10}]},{id:id+'-B',produkId:'model-B',hargaSatuan:100,items:[{id:id+'-item-B',nama:'L',jumlah:20}]}],initialPayment:{jumlah:300,tanggal:'2026-10-11',metode:'transfer',catatan:'Initial invoice DP'}};}
  const first=batch('invoice-one'),second=batch('invoice-two');call('saveCommerceOrderBatch',first);call('saveCommerceOrderBatch',second);
  function state(){return call('getCommerceState',{module:'pembelian'});}
  function raw(sheet){const table=h.sheets[sheet];return table.values.slice(1).filter(row=>row.some(v=>v!==''&&v!=null)).map(row=>Object.fromEntries(table.values[0].map((key,i)=>[key,row[i]??''])));}
  function frozen(ids){return JSON.stringify({records:raw('CommerceRecord').filter(r=>r.kind==='order'&&ids.includes(JSON.parse(r.data).id)),events:raw('CommerceEvent').filter(r=>ids.includes(r.parentId))});}
  function revisions(ids){return Object.fromEntries(state().orders.filter(o=>ids.includes(o.id)).map(o=>[o.id,o.revision]));}
  return {h,call,state,raw,frozen,revisions,first,second};
}

test('two same-supplier invoices with identical labels/dates retain independent manifests and initial DP after fresh requests and retry',()=>{
  const f=fixture(),orders=f.state().orders;assert.equal(orders.length,4);
  for(const input of [f.first,f.second]){
    const ids=input.orders.map(o=>o.id),members=orders.filter(o=>o.invoiceId===input.id);assert.deepEqual(members.map(o=>o.id).sort(),ids.slice().sort());
    assert.ok(members.every(o=>JSON.stringify(o.invoiceOrderIds)===JSON.stringify(ids)));assert.equal(members.reduce((n,o)=>n+o.totalPaid,0),300);
    assert.ok(members.every(o=>o.payments.length===1&&o.payments[0].groupId===input.id));
  }
  const before=JSON.stringify(f.h.sheets.CommerceRecord.values),writes=f.h.sheets.CommerceRecord.writes;f.call('saveCommerceOrderBatch',f.second);assert.equal(JSON.stringify(f.h.sheets.CommerceRecord.values),before);assert.equal(f.h.sheets.CommerceRecord.writes,writes);
});

test('additional DP and receipt target only selected invoice parents; another invoice stays byte-for-byte unchanged',()=>{
  const f=fixture(),ids=f.first.orders.map(o=>o.id),otherIds=f.second.orders.map(o=>o.id),otherBefore=f.frozen(otherIds);
  f.call('appendCommerceGroupPayment',{id:'first-followup-payment',orderIds:ids,expectedRevisions:f.revisions(ids),jumlah:900,tanggal:'2026-10-11',metode:'transfer',catatan:'Only first invoice'});
  const parent=f.state().orders.find(o=>o.id===ids[0]);f.call('appendCommerceReceipt',{id:'first-receipt',orderId:parent.id,expectedRevision:parent.revision,itemId:parent.items[0].id,jumlah:4,tanggal:'2026-10-11',kondisi:'ok',catatan:'One partial receipt'});
  assert.equal(f.frozen(otherIds),otherBefore);const orders=f.state().orders;
  assert.equal(orders.filter(o=>ids.includes(o.id)).reduce((n,o)=>n+o.totalPaid,0),1200);assert.equal(orders.find(o=>o.id===ids[0]).totalReceived,4);
  assert.ok(orders.filter(o=>otherIds.includes(o.id)).every(o=>o.totalReceived===0));
  const eventParents=f.raw('CommerceEvent').map(e=>e.parentId);assert.ok(eventParents.length>0&&eventParents.every(id=>ids.includes(id)));
});

test('editing an invoice label/date preserves original invoice identity and does not move orders or embedded DP',()=>{
  const f=fixture(),old=f.state().orders.find(o=>o.id==='invoice-one-A'),otherIds=f.second.orders.map(o=>o.id),otherBefore=f.frozen(otherIds);
  const beforeData=JSON.parse(f.raw('CommerceRecord').find(r=>r.kind==='order'&&JSON.parse(r.data).id===old.id).data);
  f.call('saveCommerceOrder',{expectedRevision:old.revision,record:{id:old.id,produkId:old.produkId,hargaSatuan:old.hargaSatuan,items:old.items,grupNama:'Changed display label',tanggalOrder:'2026-10-10',catatan:'Edit only this model'}});
  const edited=f.state().orders.find(o=>o.id===old.id);assert.equal(edited.invoiceId,old.invoiceId);assert.deepEqual(edited.invoiceOrderIds,old.invoiceOrderIds);assert.equal(edited.invoiceProof,old.invoiceProof);assert.equal(edited.totalPaid,old.totalPaid);assert.equal(f.frozen(otherIds),otherBefore);
  const afterData=JSON.parse(f.raw('CommerceRecord').find(r=>r.kind==='order'&&JSON.parse(r.data).id===old.id).data);assert.deepEqual(afterData._initialPayment,beforeData._initialPayment);assert.equal(afterData._orderChanges.length,(beforeData._orderChanges||[]).length+1);
});

test('historical payment spanning invoices is corrected by its original group ID without regrouping invoice membership or losing history',()=>{
  const f=fixture(),parents=['invoice-one-A','invoice-two-A'],untouched=['invoice-one-B','invoice-two-B'],untouchedBefore=f.frozen(untouched);
  // This payment predates invoice boundaries; seed its immutable stored events,
  // since a new cross-invoice payment must now be rejected by the server.
  const oldPaymentRows=parents.map(parentId=>({id:'legacy-pay-'+parentId,module:'pembelian',parentId,kind:'payment',data:JSON.stringify({groupId:'historical-cross-invoice-payment',jumlah:200,tanggal:'2026-10-11',metode:'transfer',catatan:'Explicit past combined payment'}),dibuat:'2026-10-11T00:00:00.000Z',dibuatOleh:'historical-owner',sourceHash:''}));
  f.h.run('pkStore_().lock(function(){pkStore_().appendMany("CommerceEvent",'+JSON.stringify(oldPaymentRows)+');});void 0;');
  const oldEvents=f.raw('CommerceEvent').filter(e=>JSON.parse(e.data).groupId==='historical-cross-invoice-payment'),oldBytes=JSON.stringify(oldEvents);assert.equal(oldEvents.length,2);
  const payload={id:'correct-historical-payment',groupId:'historical-cross-invoice-payment',expectedRevisions:f.revisions(parents),jumlah:600,tanggal:'2026-10-11',metode:'transfer',catatan:'Correct actual combined amount'};f.call('gantiCommerceGroupPayment',payload);
  const all=f.raw('CommerceEvent');assert.equal(JSON.stringify(all.filter(e=>oldEvents.some(old=>old.id===e.id))),oldBytes);
  const replacements=all.filter(e=>e.kind==='payment'&&JSON.parse(e.data).groupId===payload.id);assert.deepEqual(replacements.map(e=>e.parentId).sort(),parents.slice().sort());assert.equal(replacements.reduce((n,e)=>n+JSON.parse(e.data).jumlah,0),600);
  assert.equal(all.filter(e=>e.kind==='void'&&oldEvents.some(old=>old.id===JSON.parse(e.data).eventId)).length,2);assert.equal(f.frozen(untouched),untouchedBefore);
  const beforeRetry=JSON.stringify(f.h.sheets.CommerceEvent.values);f.call('gantiCommerceGroupPayment',payload);assert.equal(JSON.stringify(f.h.sheets.CommerceEvent.values),beforeRetry);
  assert.ok(f.state().orders.every(o=>o.invoiceId===(o.id.startsWith('invoice-one-')?'invoice-one':'invoice-two')));
});
