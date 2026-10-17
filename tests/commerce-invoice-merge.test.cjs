'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
function fixture(){
 const h=harness();for(const name of ['reconcile-legacy','commerce-hpp','slip-models','commerce','commerce-migration'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src',name+'.js'),'utf8'),h.context);
 const setup=h.request('setupOwner',{nama:'Owner',pin:'1234'});assert.equal(setup.ok,true,setup.error);const owner=setup.data.token;
 h.run("pkStore_().lock(function(){pkStore_().appendMany('Pegawai',[{id:'adminfixture',nama:'Admin',divisi:'admin',aktif:true,token:'fixture-admin-token-001'},{id:'cutterfixture',nama:'Cutter',divisi:'potong',aktif:true,token:'fixture-cutter-token-001'}]);});void 0;");
 function call(action,p={},token=owner){h.cold();return h.request(action,{token,workflowVersion:2,...p});}
 function good(action,p={},token=owner){const r=call(action,p,token);assert.equal(r.ok,true,r.error);return r.data;}
 function bad(action,p={},regex,token=owner){const r=call(action,p,token);assert.equal(r.ok,false,'must reject');if(regex)assert.match(r.error,regex);return r;}
 function raw(table){h.cold();return h.run('pkStore_().fresh('+JSON.stringify(table)+');pkStore_().read('+JSON.stringify(table)+')');}
 function state(){return good('getCommerceState',{module:'pembelian'});}
 function revisions(ids){return Object.fromEntries(state().orders.filter(o=>!ids||ids.includes(o.id)).map(o=>[o.id,o.revision]));}
 function merge(id,orderIds,extra={}){return {id,orderIds,expectedRevisions:revisions(orderIds),grupNama:'Gabungan supplier',withState:true,...extra};}
 for(let i=1;i<=2;i++){good('saveCommerceSupplier',{record:{id:'supplier'+i,nama:'Supplier '+i}});good('saveCommerceProduct',{record:{id:'product'+i,nama:'Model '+i,supplierId:'supplier'+i}});}
 return {h,owner,call,good,bad,raw,state,revisions,merge};
}
function invoice(key,extra={}){return {id:'invoice'+key,supplierId:'supplier1',grupNama:'Invoice '+key,tanggalOrder:'2026-10-11',catatan:'Invoice fixture',orders:[{id:'order'+key+'a',produkId:'product1',hargaSatuan:100,items:[{id:'v1',nama:'M',jumlah:3}]},{id:'order'+key+'b',produkId:'product1',hargaSatuan:200,items:[{id:'v2',nama:'L',jumlah:2}]}],initialPayment:{tanggal:'2026-10-10',jumlah:101,metode:'transfer',catatan:'DP awal'},...extra};}
function setupTwo(f){f.good('saveCommerceOrderBatch',invoice('A'));f.good('saveCommerceOrderBatch',invoice('B',{tanggalOrder:'2026-10-01'}));return f.state().orders.map(o=>o.id);}
function financial(orders){return orders.map(o=>({id:o.id,invoiceId:o.invoiceId,invoiceProof:o.invoiceProof,items:o.items,productSnapshot:o.productSnapshot,supplierSnapshot:o.supplierSnapshot,totalHarga:o.totalHarga,totalQty:o.totalQty,totalPaid:o.totalPaid,totalReceived:o.totalReceived,balance:o.balance,payments:o.payments,receipts:o.receipts,events:o.events}));}
function order(f,id){return f.state().orders.find(o=>o.id===id);}

test('explicit invoice merge is one metadata write and preserves every order, payment and receipt',()=>{
 const f=fixture(),ids=setupTwo(f),first=order(f,ids[0]);
 f.good('appendCommerceReceipt',{id:'receipt1',parentId:first.id,itemId:'v1',jumlah:2,tanggal:'2026-10-12',expectedRevision:first.revision});
 const before=f.state(),rawRecords=JSON.stringify(f.raw('CommerceRecord')),rawEvents=f.raw('CommerceEvent'),writes=f.h.sheets.CommerceEvent.writes,recordWrites=f.h.sheets.CommerceRecord.writes;
 const p=f.merge('combined1',ids),out=f.good('mergeCommerceInvoices',p);
 assert.equal(f.h.sheets.CommerceEvent.writes,writes+1);assert.equal(f.h.sheets.CommerceRecord.writes,recordWrites);assert.equal(JSON.stringify(f.raw('CommerceRecord')),rawRecords);
 assert.deepEqual(f.raw('CommerceEvent').slice(0,-1),rawEvents);assert.equal(f.raw('CommerceEvent').at(-1).kind,'invoiceMerge');assert.deepEqual(financial(out.commerce.orders),financial(before.orders));
 assert.equal(out.groupId,p.id);assert.deepEqual(out.orderIds,ids.slice().sort());
 assert.equal(out.proof,f.h.run('coreCommerceInvoiceMergeProof('+JSON.stringify(p)+','+JSON.stringify(before.orders[0].createdBy)+')'));
 for(const row of out.commerce.orders){assert.equal(row.invoiceGroupId,p.id);assert.equal(row.invoiceGroupName,p.grupNama);assert.equal(row.invoiceMergeProof,out.proof);assert.notEqual(row.revision,before.orders.find(o=>o.id===row.id).revision);}
});

test('owner, client version and workflow gates apply before invoice merges',()=>{
 const f=fixture(),ids=setupTwo(f),p=f.merge('combined1',ids),before=JSON.stringify(f.raw('CommerceEvent'));
 f.bad('mergeCommerceInvoices',p,/owner/,'fixture-admin-token-001');f.bad('mergeCommerceInvoices',p,/owner|admin/,'fixture-cutter-token-001');
 f.bad('mergeCommerceInvoices',{...p,workflowVersion:1},/Versi/);f.bad('mergeCommerceInvoices',{...p,clientVersion:'1.5.32'},/versi|Muat|muat/);
 assert.equal(JSON.stringify(f.raw('CommerceEvent')),before);
});

test('full invoice membership, current revisions and separate invoice identities are mandatory',()=>{
 const f=fixture(),ids=setupTwo(f),p=f.merge('combined1',ids),before=JSON.stringify(f.raw('CommerceEvent'));
 f.bad('mergeCommerceInvoices',f.merge('partial',[ids[0],ids[2]]),/seluruh model/);
 f.bad('mergeCommerceInvoices',f.merge('oneInvoice',ids.slice(0,2)),/satu invoice/);
 f.bad('mergeCommerceInvoices',{...p,orderIds:[...ids,ids[0]]},/lebih dari sekali/);
 f.bad('mergeCommerceInvoices',{...p,expectedRevisions:{...p.expectedRevisions,[ids[3]]:'stale'}},/berubah/);
 f.bad('mergeCommerceInvoices',{...p,orderIds:['missing',ids[0]]},/tidak ditemukan/);
 assert.equal(JSON.stringify(f.raw('CommerceEvent')),before);
 const first=order(f,ids[0]);f.good('appendCommercePayment',{id:'paymentLater',parentId:first.id,jumlah:1,tanggal:'2026-10-13',expectedRevision:first.revision});
 const writes=f.h.sheets.CommerceEvent.writes;f.bad('mergeCommerceInvoices',p,/berubah/);assert.equal(f.h.sheets.CommerceEvent.writes,writes);
});

test('supplier mismatch and cancelled orders cannot be merged; stable legacy identities preserve immutable source',()=>{
 const f=fixture(),ids=setupTwo(f);
 f.good('saveCommerceOrderBatch',invoice('C',{supplierId:'supplier2',orders:[{id:'orderC',produkId:'product2',hargaSatuan:100,items:[{id:'v1',nama:'M',jumlah:3}]}]}));
 f.bad('mergeCommerceInvoices',f.merge('mismatch',[...ids,'orderC']),/supplier yang sama/);
 let first=order(f,ids[0]);f.good('cancelCommerceRecord',{module:'pembelian',id:first.id,mode:'archived',catatan:'Archive',expectedRevision:first.revision});f.bad('mergeCommerceInvoices',f.merge('cancelled',ids),/nonaktif|arsip/);
 first=order(f,ids[0]);f.good('restoreCommerceRecord',{module:'pembelian',id:first.id,expectedRevision:first.revision});
 const row=f.raw('CommerceRecord').find(r=>r.kind==='order'&&JSON.parse(r.data).id===first.id);
 f.h.run('pkStore_().lock(function(){pkStore_().update("CommerceRecord",'+JSON.stringify(row.id)+',{sourceHash:"legacy-source"});});void 0;');
 const original=JSON.stringify(f.raw('CommerceRecord'));f.good('mergeCommerceInvoices',f.merge('legacy',ids));assert.equal(JSON.stringify(f.raw('CommerceRecord')),original);
 const legacy=order(f,first.id);assert.equal(legacy.legacy,true);assert.equal(legacy.invoiceGroupId,'legacy');f.bad('saveCommerceOrder',{record:{...legacy,catatan:'Unauthorized source edit'},expectedRevision:legacy.revision},/owner/,'fixture-admin-token-001');
 f.good('saveCommerceOrderBatch',invoice('D',{targetInvoiceId:'legacy',expectedGroupRevisions:f.revisions(ids)}));assert.equal(order(f,'orderDa').invoiceGroupId,'legacy');
 assert.equal(JSON.stringify(f.raw('CommerceRecord').slice(0,-2)),original);
});

test('same model and supplier stay separate until explicit merge, regardless of matching invoice names',()=>{
 const f=fixture();f.good('saveCommerceOrderBatch',invoice('A',{grupNama:'Nama sama'}));f.good('saveCommerceOrderBatch',invoice('B',{grupNama:'Nama sama'}));
 const rows=f.state().orders,keys=rows.map(o=>f.h.run('coreCommerceInvoiceKey('+JSON.stringify(o)+')'));assert.equal(new Set(keys).size,2);assert.ok(rows.every(o=>!o.invoiceGroupId));
});

test('lost response is recovered without a second write, and exact historical replay never undoes a later merge',()=>{
 const f=fixture(),ids=setupTwo(f),p=f.merge('combined1',ids),sheet=f.h.sheets.CommerceEvent,original=sheet.getRange;let thrown=false;
 sheet.getRange=function(...args){const range=original.apply(this,args),write=range.setValues;range.setValues=function(rows){const result=write.call(this,rows);if(!thrown&&args[0]>1){thrown=true;throw Error('lost merge response after write');}return result;};return range;};
 f.bad('mergeCommerceInvoices',p,/lost merge response/);sheet.getRange=original;
 const count=sheet.writes;f.good('mergeCommerceInvoices',p);assert.equal(sheet.writes,count);
 f.bad('mergeCommerceInvoices',{...p,grupNama:'Different'},/isi atau akun berbeda/);f.bad('mergeCommerceInvoices',{...p,expectedRevisions:{}},/isi atau akun berbeda/);
 f.good('saveCommerceOrderBatch',invoice('C'));const allIds=f.state().orders.map(o=>o.id);f.good('mergeCommerceInvoices',f.merge('combined2',allIds));
 const count2=sheet.writes,replay=f.good('mergeCommerceInvoices',p);assert.equal(sheet.writes,count2);assert.ok(replay.commerce.orders.every(o=>o.invoiceGroupId==='combined2'));assert.equal(replay.groupId,'combined1');
});

test('add-model batch joins selected invoice atomically while preserving original member rows and DP identities',()=>{
 const f=fixture(),ids=setupTwo(f);f.good('mergeCommerceInvoices',f.merge('combined1',ids));
 const original=JSON.stringify(f.raw('CommerceRecord')),p=invoice('C',{targetInvoiceId:'combined1',expectedGroupRevisions:f.revisions(ids),grupNama:'Cannot rename old invoice',withState:true});
 const recordWrites=f.h.sheets.CommerceRecord.writes,eventWrites=f.h.sheets.CommerceEvent.writes,out=f.good('saveCommerceOrderBatch',p);
 assert.equal(f.h.sheets.CommerceRecord.writes,recordWrites+1);assert.equal(f.h.sheets.CommerceEvent.writes,eventWrites);assert.equal(JSON.stringify(f.raw('CommerceRecord').slice(0,-2)),original);
 assert.equal(out.invoiceGroupId,'combined1');assert.ok(out.records.every(o=>o.invoiceGroupId==='combined1'&&o.invoiceId==='invoiceC'&&o.invoiceGroupName==='Gabungan supplier'));
 assert.equal(out.records.reduce((n,o)=>n+o.totalPaid,0),101);assert.ok(out.records.every(o=>o.payments[0].groupId==='invoiceC'));
 assert.equal(new Set(out.commerce.orders.map(o=>f.h.run('coreCommerceInvoiceKey('+JSON.stringify(o)+')'))).size,1);
 f.good('saveCommerceOrderBatch',p);assert.equal(f.h.sheets.CommerceRecord.writes,recordWrites+1);
 const first=out.records[0],edited=f.good('saveCommerceOrder',{record:{...first,catatan:'Edited model'},expectedRevision:first.revision}).record;assert.equal(edited.invoiceGroupId,'combined1');assert.equal(edited.invoiceGroupName,'Gabungan supplier');
 f.good('saveCommerceOrderBatch',invoice('D'));f.bad('mergeCommerceInvoices',f.merge('partialMerge',[...ids,'orderDa','orderDb']),/seluruh model/);
 f.good('mergeCommerceInvoices',f.merge('combined2',f.state().orders.map(o=>o.id)));assert.ok(f.state().orders.every(o=>o.invoiceGroupId==='combined2'));
 const writes=f.h.sheets.CommerceRecord.writes;f.good('saveCommerceOrderBatch',p);assert.equal(f.h.sheets.CommerceRecord.writes,writes);assert.ok(f.state().orders.every(o=>o.invoiceGroupId==='combined2'));
});

test('stale add-model membership, changed payment and remerged target all fail before writing',()=>{
 const f=fixture();f.good('saveCommerceOrderBatch',invoice('A'));const ids=f.state().orders.map(o=>o.id),p=invoice('B',{targetInvoiceId:'invoiceA',expectedGroupRevisions:f.revisions(ids)});
 f.good('saveCommerceOrderBatch',p);const count=f.h.sheets.CommerceRecord.writes;
 f.bad('saveCommerceOrderBatch',invoice('C',{targetInvoiceId:'invoiceA',expectedGroupRevisions:p.expectedGroupRevisions}),/Isi invoice tujuan berubah/);assert.equal(f.h.sheets.CommerceRecord.writes,count);
 const current=f.state().orders.map(o=>o.id),fresh=invoice('C',{targetInvoiceId:'invoiceA',expectedGroupRevisions:f.revisions(current)}),first=order(f,current[0]);
 f.good('appendCommercePayment',{id:'pay1',parentId:first.id,jumlah:1,tanggal:'2026-10-13',expectedRevision:first.revision});f.bad('saveCommerceOrderBatch',fresh,/Invoice tujuan berubah/);
 const remergeStale=invoice('C',{targetInvoiceId:'invoiceA',expectedGroupRevisions:f.revisions(current)});f.good('saveCommerceOrderBatch',invoice('D'));f.good('mergeCommerceInvoices',f.merge('combined1',f.state().orders.map(o=>o.id)));f.bad('saveCommerceOrderBatch',remergeStale,/Invoice tujuan sudah berubah/);
 assert.equal(f.state().orders.some(o=>o.invoiceId==='invoiceC'),false);
});

test('adding to ordinary batch invoice groups uses the same identity namespace and never attaches implicitly',()=>{
 const f=fixture();f.good('saveCommerceOrderBatch',invoice('A'));const p=invoice('B',{targetInvoiceId:'invoiceA',expectedGroupRevisions:f.revisions()});f.good('saveCommerceOrderBatch',p);
 let rows=f.state().orders;assert.equal(new Set(rows.map(o=>f.h.run('coreCommerceInvoiceKey('+JSON.stringify(o)+')'))).size,1);
 f.good('saveCommerceOrderBatch',invoice('C',{grupNama:'Invoice A'}));rows=f.state().orders;assert.equal(new Set(rows.map(o=>f.h.run('coreCommerceInvoiceKey('+JSON.stringify(o)+')'))).size,2);
});

test('merge identities cannot collide with existing invoices or payments',()=>{
 const f=fixture(),ids=setupTwo(f);f.bad('mergeCommerceInvoices',f.merge('invoiceA',ids),/sudah digunakan/);f.bad('mergeCommerceInvoices',f.merge('supplier1',ids),/sudah digunakan/);
 const first=order(f,ids[0]);f.bad('mergeCommerceInvoices',f.merge(first.payments[0].id,ids),/sudah digunakan/);f.good('appendCommercePayment',{id:'payment1',parentId:first.id,jumlah:1,tanggal:'2026-10-13',expectedRevision:first.revision});f.bad('mergeCommerceInvoices',f.merge('payment1',ids),/sudah digunakan/);
});
