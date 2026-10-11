'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
function fixture(){
 const h=harness();for(const name of ['reconcile-legacy','commerce-hpp','slip-models','commerce','commerce-migration'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src',name+'.js'),'utf8'),h.context);
 const setup=h.request('setupOwner',{nama:'Fixture Owner',pin:'1234'});assert.equal(setup.ok,true,setup.error);const token=setup.data.token;
 function call(action,p={}){h.cold();return h.request(action,{token,workflowVersion:2,...p});}
 function good(action,p={}){const r=call(action,p);assert.equal(r.ok,true,r.error);return r.data;}
 function bad(action,p={}){const r=call(action,p);assert.equal(r.ok,false,'must reject');return r.error;}
 function raw(table){h.cold();return h.run('pkStore_().fresh('+JSON.stringify(table)+');pkStore_().read('+JSON.stringify(table)+')');}
 function state(){return good('getCommerceState',{module:'pembelian'});}
 good('saveCommerceSupplier',{record:{id:'supplier01',nama:'Fixture Supplier'}});
 for(const id of ['product01','product02'])good('saveCommerceProduct',{record:{id,nama:id,supplierId:'supplier01'}});
 return {h,call,good,bad,raw,state};
}
function order(items){return {id:'order01',produkId:'product01',items:items||[{id:'black',nama:'Hitam',jumlah:300}],hargaSatuan:48000,tanggalOrder:'2026-10-11'};}
function batch(orders){return {id:'invoice01',supplierId:'supplier01',tanggalOrder:'2026-10-11',orders,initialPayment:{tanggal:'2026-10-11',jumlah:700000,metode:'transfer'}};}
function makeHistoricalDuplicate(f){
 f.h.run("pkStore_().lock(function(){var store=pkStore_(),r=store.read('CommerceRecord').filter(function(r){return r.kind==='order';})[0],d=JSON.parse(r.data);d.items[1].nama='  HITAM  ';r.data=JSON.stringify(d);r.revision=coreCommerceHash(d);store.update('CommerceRecord',r.id,r);});void 0;");
 return f.state().orders[0];
}

test('new order rejects equal variant names with different IDs and case or repeated whitespace before any write',()=>{
 const f=fixture(),before=JSON.stringify(f.raw('CommerceRecord')),writes=f.h.sheets.CommerceRecord.writes;
 for(const names of [['Hitam','hitam'],['Hitam','  HITAM  '],['Abu Tua','abu  tua'],['Abu Tua','Abu\tTua'],['Abu Tua','Abu\u00a0Tua']]){
  assert.match(f.bad('saveCommerceOrder',{record:order(names.map((nama,i)=>({id:'item'+i,nama,jumlah:300})))}),/Nama varian ganda/);
 }
 assert.equal(JSON.stringify(f.raw('CommerceRecord')),before);assert.equal(f.h.sheets.CommerceRecord.writes,writes);assert.deepEqual(f.raw('CommerceEvent'),[]);
});

test('a duplicate variant in the last model aborts the whole invoice and initial DP; same names across models remain valid',()=>{
 const f=fixture(),first=order(),second={...order([{id:'b1',nama:'Hitam',jumlah:300},{id:'b2',nama:' HITAM ',jumlah:300}]),id:'order02',produkId:'product02'},writes=f.h.sheets.CommerceRecord.writes;
 assert.match(f.bad('saveCommerceOrderBatch',batch([first,second])),/Nama varian ganda/);assert.equal(f.state().orders.length,0);assert.equal(f.h.sheets.CommerceRecord.writes,writes);assert.deepEqual(f.raw('CommerceEvent'),[]);
 second.items=[{id:'b1',nama:'Hitam',jumlah:300}];const out=f.good('saveCommerceOrderBatch',batch([first,second]));assert.equal(out.records.length,2);assert.deepEqual(out.records.map(o=>o.totalQty),[300,300]);assert.equal(out.records.reduce((n,o)=>n+o.totalPaid,0),700000);
});

test('editing cannot add a second name-equivalent item or rewrite the original payment and receipt history',()=>{
 const f=fixture();let row=f.good('saveCommerceOrder',{record:{...order(),initialPayment:{jumlah:700000,tanggal:'2026-10-11',metode:'transfer'}}}).record;
 row=f.good('appendCommerceReceipt',{id:'receipt01',orderId:row.id,expectedRevision:row.revision,itemId:'black',jumlah:290,tanggal:'2026-10-11',kondisi:'Baik'}).record;
 const records=JSON.stringify(f.raw('CommerceRecord')),events=JSON.stringify(f.raw('CommerceEvent'));
 assert.match(f.bad('saveCommerceOrder',{record:{...row,items:[...row.items,{id:'black-again',nama:' hitam ',jumlah:300}]},expectedRevision:row.revision}),/Nama varian ganda/);
 assert.equal(JSON.stringify(f.raw('CommerceRecord')),records);assert.equal(JSON.stringify(f.raw('CommerceEvent')),events);const saved=f.state().orders[0];assert.equal(saved.totalQty,300);assert.equal(saved.totalReceived,290);assert.equal(saved.totalPaid,700000);assert.equal(saved.totalHarga,14400000);
});

test('an existing duplicate can be corrected by removing the unused row, retaining IDs, quantities received and every ledger entry',()=>{
 const f=fixture();let row=f.good('saveCommerceOrder',{record:{...order([{id:'black',nama:'Hitam',jumlah:300},{id:'old-extra',nama:'Other',jumlah:300}]),initialPayment:{jumlah:700000,tanggal:'2026-10-11',metode:'transfer'}}}).record;
 row=f.good('appendCommerceReceipt',{id:'receipt01',orderId:row.id,expectedRevision:row.revision,itemId:'black',jumlah:290,tanggal:'2026-10-11',kondisi:'Baik'}).record;
 row=makeHistoricalDuplicate(f);assert.equal(row.totalQty,600);const events=JSON.stringify(f.raw('CommerceEvent')),payments=JSON.stringify(row.payments);
 const payload={record:{...row,items:[row.items[0]]},expectedRevision:row.revision},fixed=f.good('saveCommerceOrder',payload).record;
 assert.equal(fixed.id,row.id);assert.equal(fixed.items.length,1);assert.equal(fixed.items[0].id,'black');assert.equal(fixed.totalQty,300);assert.equal(fixed.totalHarga,14400000);assert.equal(fixed.totalReceived,290);assert.equal(fixed.totalPaid,700000);assert.equal(JSON.stringify(fixed.payments),payments);assert.equal(JSON.stringify(f.raw('CommerceEvent')),events);
 const audit=JSON.parse(f.raw('CommerceRecord').find(r=>r.kind==='order').data)._orderChanges;assert.equal(audit.length,1);assert.equal(audit[0].before.items.length,2);assert.equal(f.good('saveCommerceOrder',payload).record.orderEditCount,1);
});

test('correcting a duplicate never discards a variant that has its own receipt or merges receipt identities',()=>{
 const f=fixture();let row=f.good('saveCommerceOrder',{record:order([{id:'black',nama:'Hitam',jumlah:300},{id:'old-extra',nama:'Other',jumlah:300}])}).record;
 row=f.good('appendCommerceReceipt',{id:'receipt-extra',orderId:row.id,expectedRevision:row.revision,itemId:'old-extra',jumlah:10,tanggal:'2026-10-11'}).record;row=makeHistoricalDuplicate(f);
 const events=JSON.stringify(f.raw('CommerceEvent')),records=JSON.stringify(f.raw('CommerceRecord'));
 assert.match(f.bad('saveCommerceOrder',{record:{...row,items:[row.items[0]]},expectedRevision:row.revision}),/sudah diterima/);assert.equal(JSON.stringify(f.raw('CommerceEvent')),events);assert.equal(JSON.stringify(f.raw('CommerceRecord')),records);
 const kept=f.good('saveCommerceOrder',{record:{...row,items:[row.items[1]]},expectedRevision:row.revision}).record;assert.equal(kept.items[0].id,'old-extra');assert.equal(kept.totalReceived,10);assert.equal(kept.receivedByItem['old-extra'],10);assert.equal(JSON.stringify(f.raw('CommerceEvent')),events);
});


test('metadata and price edits preserve an unchanged historical duplicate list even with unresolved receipts',()=>{
 const f=fixture();let row=f.good('saveCommerceOrder',{record:{...order([{id:'black',nama:'Hitam',jumlah:300},{id:'old-extra',nama:'Other',jumlah:300}]),initialPayment:{jumlah:700000,tanggal:'2026-10-11',metode:'transfer'}}}).record;
 f.h.run("pkStore_().lock(function(){var s=pkStore_(),r=s.read('CommerceRecord').filter(function(r){return r.kind==='order';})[0],d=JSON.parse(r.data);d.items[1].nama='Hitam';r.data=JSON.stringify(d);r.revision=coreCommerceHash(d);r.sourceHash='historical-fixture';s.update('CommerceRecord',r.id,r);s.append('CommerceEvent',{id:'orphan-receipt',module:'pembelian',parentId:d.id,kind:'receipt',data:JSON.stringify({tanggal:'2026-10-11',itemId:'unresolved-old-id',jumlah:10,kondisi:'Baik'}),dibuat:'2026-10-11',dibuatOleh:'legacy',sourceHash:'historical-fixture'});});void 0;");
 row=f.state().orders[0];assert.equal(row.receiptReview,true);const events=JSON.stringify(f.raw('CommerceEvent')),payments=JSON.stringify(row.payments),itemSnapshot=JSON.stringify(row.items);
 const changed=f.good('saveCommerceOrder',{record:{...row,hargaSatuan:50000,catatan:'Keterangan baru',grupNama:'Invoice lama'},expectedRevision:row.revision}).record;
 assert.equal(JSON.stringify(changed.items),itemSnapshot);assert.equal(changed.totalQty,600);assert.equal(changed.totalHarga,30000000);assert.equal(changed.totalPaid,700000);assert.equal(changed.totalReceived,10);assert.equal(changed.receiptReview,true);assert.equal(changed.receipts[0].itemId,'unresolved-old-id');assert.equal(JSON.stringify(changed.payments),payments);assert.equal(JSON.stringify(f.raw('CommerceEvent')),events);
 const frozen=JSON.stringify(f.raw('CommerceRecord'));
 for(const items of [[{...changed.items[0],jumlah:301},changed.items[1]],changed.items.slice().reverse(),[changed.items[0],{...changed.items[1],nama:'HITAM'}],[...changed.items,{id:'new-row',nama:'Hitam',jumlah:1}]])assert.match(f.bad('saveCommerceOrder',{record:{...changed,items},expectedRevision:changed.revision}),/Nama varian ganda/);
 assert.equal(JSON.stringify(f.raw('CommerceRecord')),frozen);assert.equal(JSON.stringify(f.raw('CommerceEvent')),events);
 assert.match(f.bad('saveCommerceOrder',{record:{...changed,items:[changed.items[0]]},expectedRevision:changed.revision}),/Penerimaan lama belum terhubung/,'compatibility does not invent a solution for orphan receipts');
});

test('unchanged-list comparison trims outer source-label whitespace only and still enforces payment floor',()=>{
 const f=fixture();let row=f.good('saveCommerceOrder',{record:{...order([{id:'black',nama:'Hitam',jumlah:300},{id:'old-extra',nama:'Other',jumlah:300}]),initialPayment:{jumlah:700000,tanggal:'2026-10-11',metode:'transfer'}}}).record;
 row=makeHistoricalDuplicate(f);const events=JSON.stringify(f.raw('CommerceEvent'));
 const changed=f.good('saveCommerceOrder',{record:{...row,catatan:'Metadata only'},expectedRevision:row.revision}).record;
 assert.equal(changed.items[1].nama,'HITAM');assert.equal(changed.items[1].id,'old-extra');assert.equal(changed.items[1].jumlah,300);assert.equal(changed.totalQty,600);assert.equal(changed.totalPaid,700000);assert.equal(JSON.stringify(f.raw('CommerceEvent')),events);
 assert.match(f.bad('saveCommerceOrder',{record:{...changed,hargaSatuan:1},expectedRevision:changed.revision}),/lebih kecil.*dibayar/);
});
