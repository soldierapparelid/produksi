'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
function fixture(){
 const h=harness();for(const name of ['reconcile-legacy','commerce-hpp','slip-models','commerce','commerce-migration'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src',name+'.js'),'utf8'),h.context);
 const setup=h.request('setupOwner',{nama:'Fixture Owner',pin:'1234'});assert.equal(setup.ok,true,setup.error);const owner=setup.data.token;
 h.run("pkStore_().lock(function(){pkStore_().appendMany('Pegawai',[{id:'adminfixture',nama:'Fixture Admin',divisi:'admin',aktif:true,token:'fixture-admin-token-001'},{id:'cutterfixture',nama:'Fixture Cutter',divisi:'potong',aktif:true,token:'fixture-cutter-token-001'}]);});void 0;");
 function call(action,p={},token=owner){h.cold();return h.request(action,{token,workflowVersion:2,...p});}
 function good(action,p={},token=owner){const r=call(action,p,token);assert.equal(r.ok,true,r.error);return r.data;}
 function bad(action,p={},regex,token=owner){const r=call(action,p,token);assert.equal(r.ok,false,'must reject');if(regex)assert.match(r.error,regex);return r;}
 function raw(table){h.cold();return h.run('pkStore_().fresh('+JSON.stringify(table)+');pkStore_().read('+JSON.stringify(table)+')');}
 function state(){return good('getCommerceState',{module:'pembelian'});}
 function revisions(){return Object.fromEntries(state().orders.map(o=>[o.id,o.revision]));}
 function proof(p){return h.run('coreCommerceOrderBatchProof('+JSON.stringify(p)+')');}
 good('saveCommerceSupplier',{record:{id:'supplier01',nama:'Supplier Fixture'}});
 for(let i=1;i<=3;i++)good('saveCommerceProduct',{record:{id:'product0'+i,nama:'Product '+i,supplierId:'supplier01'}});
 return {h,owner,call,good,bad,raw,state,revisions,proof};
}
function invoice(extra={}){return {id:'invoice01',supplierId:'supplier01',grupNama:'Invoice 01',tanggalOrder:'2026-10-11',catatan:'Dua model',orders:[{id:'order01',produkId:'product01',hargaSatuan:100,items:[{id:'m1',nama:'M',jumlah:3}]},{id:'order02',produkId:'product02',hargaSatuan:100,items:[{id:'l2',nama:'L',jumlah:2}]}],initialPayment:{tanggal:'2026-10-10',jumlah:101,metode:'transfer',catatan:'DP supplier'},...extra};}
function recordsOnly(f){return f.raw('CommerceRecord').filter(r=>r.kind==='order');}
function mutatePhysical(f,edit){const sheet=f.h.sheets.CommerceRecord,head=sheet.values[0],column=head.indexOf('data');for(let i=1;i<sheet.values.length;i++){const row=sheet.values[i],data=JSON.parse(row[column]);if(edit(data)){row[column]=JSON.stringify(data);break;}}f.h.cached&&Object.keys(f.h.cached).forEach(k=>delete f.h.cached[k]);f.h.cold();}

test('batch saves all models and exact proportional DP in one physical Record write, without event or production writes',()=>{
 const f=fixture(),p=invoice({withState:true}),before=f.h.sheets.CommerceRecord.writes,production=f.raw('PO');
 const out=f.good('saveCommerceOrderBatch',p);assert.equal(f.h.sheets.CommerceRecord.writes,before+1);assert.equal(f.raw('CommerceEvent').length,0);assert.deepEqual(f.raw('PO'),production);
 assert.equal(out.invoiceId,p.id);assert.equal(out.groupId,p.id);assert.deepEqual(out.orderIds,['order01','order02']);assert.equal(out.commerce.orders.length,2);
 assert.deepEqual(out.records.map(o=>o.totalPaid),[61,40]);assert.equal(out.records.reduce((n,o)=>n+o.totalPaid,0),101);
 for(const o of out.records){assert.equal(o.invoiceId,p.id);assert.deepEqual(o.invoiceOrderIds,out.orderIds);assert.equal(o.invoiceProof,f.proof(p));assert.equal(o.payments[0].groupId,p.id);assert.equal(o.payments[0].tanggal,'2026-10-10');assert.equal(o.needsReview,false);assert.equal(o.status,'dp');}
 assert.equal(f.proof(p),f.proof({...p,withState:false,token:'other',clientVersion:'stale',workflowVersion:1}));
 const frozen=JSON.stringify(recordsOnly(f));f.good('saveCommerceOrderBatch',{...p,withState:false});assert.equal(JSON.stringify(recordsOnly(f)),frozen);assert.equal(f.h.sheets.CommerceRecord.writes,before+1);
});

test('lost response after the complete physical batch write is recovered by exact replay, including DP',()=>{
 const f=fixture(),p=invoice(),sheet=f.h.sheets.CommerceRecord,original=sheet.getRange;let thrown=false;
 sheet.getRange=function(...args){const range=original.apply(this,args),write=range.setValues;range.setValues=function(rows){const result=write.call(this,rows);if(!thrown&&args[0]>1&&rows.length===2){thrown=true;throw Error('simulated response interruption after write');}return result;};return range;};
 f.bad('saveCommerceOrderBatch',p,/interruption/);sheet.getRange=original;
 const count=sheet.writes,out=f.good('saveCommerceOrderBatch',p);assert.equal(out.records.length,2);assert.equal(out.records.reduce((n,o)=>n+o.totalPaid,0),101);assert.equal(sheet.writes,count);assert.equal(f.raw('CommerceEvent').length,0);
});

test('partial physical storage is held, never silently completed or replayed as success',()=>{
 const f=fixture(),p=invoice(),sheet=f.h.sheets.CommerceRecord,original=sheet.getRange;let thrown=false;
 sheet.getRange=function(...args){const range=original.apply(this,args);if(!thrown&&args[0]>1&&args[2]===2){range.setValues=function(rows){original.call(sheet,args[0],args[1],1,args[3]).setValues([rows[0]]);thrown=true;throw Error('simulated partial physical storage');};}return range;};
 f.bad('saveCommerceOrderBatch',p,/partial/);sheet.getRange=original;
 assert.equal(recordsOnly(f).length,1);const count=sheet.writes;f.bad('saveCommerceOrderBatch',p,/sebagian/);assert.equal(sheet.writes,count);assert.equal(recordsOnly(f).length,1);assert.equal(f.raw('CommerceEvent').length,0);
});

test('later invalid model, duplicate identities, supplier mismatch and total bounds all fail before writing',()=>{
 const f=fixture();f.good('saveCommerceSupplier',{record:{id:'supplier02',nama:'Other supplier'}});f.good('saveCommerceProduct',{record:{id:'otherProduct',nama:'Other',supplierId:'supplier02'}});
 const bad=[];let p=invoice();p.orders[1].items[0].jumlah=0;bad.push(p);
 p=invoice();p.orders[1].id=p.orders[0].id;bad.push(p);
 p=invoice();p.orders[1].produkId='otherProduct';bad.push(p);
 p=invoice();p.initialPayment.jumlah=501;bad.push(p);
 p=invoice();p.orders[1].items.push({...p.orders[1].items[0]});bad.push(p);
 p=invoice();p.orders[1].hargaSatuan=0.2;bad.push(p);
 p=invoice();p.orders=p.orders.map(o=>({...o,hargaSatuan:1000000000000,items:[{...o.items[0],jumlah:5000}]}));delete p.initialPayment;bad.push(p);
 p=invoice();p.orders=[...p.orders,...Array.from({length:19},(_,i)=>({...p.orders[0],id:'more'+i}))];bad.push(p);
 p=invoice();p.orders=Array.from({length:3},(_,i)=>({id:'o'+i,produkId:'product01',hargaSatuan:1,items:Array.from({length:100},(_,j)=>({id:'v'+j,nama:'Var'+j,jumlah:1}))}));bad.push(p);
 const count=f.h.sheets.CommerceRecord.writes;for(const b of bad)f.bad('saveCommerceOrderBatch',b);assert.equal(recordsOnly(f).length,0);assert.equal(f.h.sheets.CommerceRecord.writes,count);assert.equal(f.raw('CommerceEvent').length,0);
 const product=f.state().products[0];f.good('saveCommerceProduct',{record:{...product,aktif:false},expectedRevision:product.revision});f.bad('saveCommerceOrderBatch',invoice(),/tidak aktif/);assert.equal(recordsOnly(f).length,0);
});

test('changed payload, another actor and missing DP proof cannot turn the same invoice ID into a new mutation',()=>{
 const f=fixture(),p=invoice();f.good('saveCommerceOrderBatch',p);const frozen=JSON.stringify(recordsOnly(f));
 f.bad('saveCommerceOrderBatch',{...p,catatan:'changed'},/berbeda/);f.bad('saveCommerceOrderBatch',p,/berbeda/,'fixture-admin-token-001');
 f.bad('saveCommerceOrderBatch',{...p,id:'anotherInvoice'},/sudah digunakan/);assert.equal(JSON.stringify(recordsOnly(f)),frozen);
 mutatePhysical(f,d=>{if(d.id==='order02'){delete d._initialPayment;return true;}});f.bad('saveCommerceOrderBatch',p,/Bukti DP/);
});

test('invoice identity and original DP remain through individual edits, archive/restore and later master changes',()=>{
 const f=fixture(),p=invoice(),out=f.good('saveCommerceOrderBatch',p),old=out.records[0],payment=old.payments[0];
 let edited=f.good('saveCommerceOrder',{record:{...old,items:[{...old.items[0],jumlah:4}],hargaSatuan:120,catatan:'Revised later'},expectedRevision:old.revision}).record;
 for(const field of ['invoiceId','invoiceOrderIds','invoiceProof'])assert.deepEqual(edited[field],old[field]);assert.deepEqual(edited.payments[0],payment);
 edited=f.good('cancelCommerceRecord',{module:'pembelian',id:edited.id,mode:'archived',catatan:'Archive while keeping records',expectedRevision:edited.revision}).record;assert.equal(edited.cancelled,true);
 const restored=f.good('restoreCommerceRecord',{module:'pembelian',id:edited.id,expectedRevision:edited.revision}).record;assert.equal(restored.invoiceProof,old.invoiceProof);
 const product=f.state().products[0];f.good('saveCommerceProduct',{record:{...product,aktif:false},expectedRevision:product.revision});
 const writes=f.h.sheets.CommerceRecord.writes,retry=f.good('saveCommerceOrderBatch',p);assert.equal(f.h.sheets.CommerceRecord.writes,writes);assert.equal(retry.records[0].totalHarga,480);assert.equal(retry.records[0].catatan,'Revised later');assert.deepEqual(retry.records[0].payments[0],payment);
});

test('one-model and zero-DP invoices work, and invoice order supplier cannot drift on later no-payment edits',()=>{
 const f=fixture(),p=invoice({orders:[invoice().orders[0]],initialPayment:undefined});const out=f.good('saveCommerceOrderBatch',p);assert.equal(out.groupId,'');assert.deepEqual(out.records[0].payments,[]);assert.equal(out.records[0].status,'pending');f.good('saveCommerceOrderBatch',p);
 f.good('saveCommerceSupplier',{record:{id:'supplier02',nama:'Other supplier'}});f.good('saveCommerceProduct',{record:{id:'otherProduct',nama:'Other',supplierId:'supplier02'}});
 f.bad('saveCommerceOrder',{record:{...out.records[0],produkId:'otherProduct'},expectedRevision:out.records[0].revision},/Supplier invoice tetap/);
});

test('embedded DP groups can be corrected and voided with exact replay while frozen originals stay untouched',()=>{
 const f=fixture(),p=invoice();f.good('saveCommerceOrderBatch',p);const originals=JSON.stringify(recordsOnly(f));
 const change={id:'correction01',groupId:p.id,jumlah:125,tanggal:'2026-10-09',metode:'cash',catatan:'Correct initial DP',expectedRevisions:f.revisions(),withState:true};
 const out=f.good('gantiCommerceGroupPayment',change);assert.equal(out.commerce.orders.reduce((n,o)=>n+o.totalPaid,0),125);assert.equal(JSON.stringify(recordsOnly(f)),originals);assert.equal(f.raw('CommerceEvent').length,4);assert.ok(out.commerce.orders.every(o=>o.payments.find(e=>e.groupId===p.id).voided));
 f.good('gantiCommerceGroupPayment',change);assert.equal(f.raw('CommerceEvent').length,4);
 for(const extra of [{jumlah:126},{tanggal:'2026-10-08'},{expectedRevisions:{}},{groupId:'other'}])f.bad('gantiCommerceGroupPayment',{...change,...extra});f.bad('gantiCommerceGroupPayment',change,/owner/,'fixture-admin-token-001');
 f.good('gantiCommerceGroupPayment',{id:'deleteCorrection',groupId:'correction01',jumlah:0,catatan:'Void corrected payment',expectedRevisions:f.revisions()});assert.equal(f.state().orders.reduce((n,o)=>n+o.totalPaid,0),0);assert.equal(JSON.stringify(recordsOnly(f)),originals);
});

test('a DP part voided individually stays void and is excluded from later shared correction',()=>{
 const f=fixture(),p=invoice(),out=f.good('saveCommerceOrderBatch',p),first=out.records[0];
 f.good('voidCommerceEvent',{module:'pembelian',id:'voidOne',parentId:first.id,eventId:first.payments[0].id,expectedRevision:first.revision,catatan:'One part cancelled'});
 const second=f.state().orders.find(o=>o.id==='order02'),change={id:'correctRemaining',groupId:p.id,jumlah:80,tanggal:'2026-10-11',metode:'cash',catatan:'Remaining only',expectedRevisions:{[second.id]:second.revision}};
 f.good('gantiCommerceGroupPayment',change);const rows=f.state().orders;assert.equal(rows[0].totalPaid,0);assert.equal(rows[1].totalPaid,80);f.good('gantiCommerceGroupPayment',change);assert.equal(f.raw('CommerceEvent').length,3);
});

test('invoice identity cannot collide with an existing group, arbitrary record, or embedded payment identity',()=>{
 const f=fixture(),p=invoice();f.good('saveCommerceOrderBatch',p);
 f.bad('appendCommerceGroupPayment',{id:p.id,orderIds:['order01','order02'],jumlah:10,tanggal:'2026-10-11',expectedRevisions:f.revisions()},/DP awal invoice/);
 f.bad('gantiCommerceGroupPayment',{id:p.id,groupId:p.id,jumlah:100,catatan:'Collision',expectedRevisions:f.revisions()},/berbeda/);
 f.good('appendCommerceGroupPayment',{id:'laterGroup',orderIds:['order01','order02'],jumlah:10,tanggal:'2026-10-11',expectedRevisions:f.revisions()});
 const next=invoice({id:'laterGroup',orders:invoice().orders.map((o,i)=>({...o,id:'next'+i}))});f.bad('saveCommerceOrderBatch',next,/sudah digunakan/);
 f.bad('saveCommerceOrderBatch',{...next,id:'supplier01'},/sudah digunakan/);
 const embedded=f.state().orders[0].payments[0].id;f.bad('saveCommerceOrderBatch',{...next,id:embedded},/sudah digunakan/);
});

test('zero-share models do not get artificial payments and exact replay respects all-member manifest',()=>{
 const f=fixture(),p=invoice();p.orders[0].hargaSatuan=0;p.initialPayment.jumlah=1;const out=f.good('saveCommerceOrderBatch',p);assert.deepEqual(out.records.map(o=>o.totalPaid),[0,1]);assert.deepEqual(out.records[0].payments,[]);assert.equal(out.records[1].payments[0].groupId,p.id);f.good('saveCommerceOrderBatch',p);
});

test('batch action has normal current-client, workflow and worker permission gates',()=>{
 const f=fixture(),p=invoice();f.bad('saveCommerceOrderBatch',p,/owner|admin/,'fixture-cutter-token-001');f.bad('saveCommerceOrderBatch',{...p,workflowVersion:1},/Versi/);f.bad('saveCommerceOrderBatch',{...p,clientVersion:'1.5.32'},/versi|Muat|muat/);assert.equal(recordsOnly(f).length,0);
});


test('the bounded 20-model, 200-variant invoice still uses one physical write and exact DP total',()=>{
 const f=fixture(),p=invoice({orders:Array.from({length:20},(_,i)=>({id:'manyOrder'+i,produkId:'product01',hargaSatuan:100+i,items:Array.from({length:10},(_,j)=>({id:'var'+j,nama:'Varian '+j,jumlah:j+1}))})),initialPayment:{jumlah:12345,tanggal:'2026-10-11',metode:'transfer'}}),before=f.h.sheets.CommerceRecord.writes;
 const out=f.good('saveCommerceOrderBatch',p);assert.equal(out.records.length,20);assert.equal(out.records.reduce((n,o)=>n+o.items.length,0),200);assert.equal(out.records.reduce((n,o)=>n+o.totalPaid,0),12345);assert.equal(f.h.sheets.CommerceRecord.writes,before+1);assert.equal(f.raw('CommerceEvent').length,0);
});
