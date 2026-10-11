'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
function fixture(){
 const h=harness();for(const name of ['reconcile-legacy','commerce-hpp','slip-models','commerce','commerce-migration'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src',name+'.js'),'utf8'),h.context);
 const setup=h.request('setupOwner',{nama:'Synthetic owner',pin:'1234'});assert.equal(setup.ok,true,setup.error);const token=setup.data.token;
 h.run("pkStore_().lock(function(){pkStore_().append('Pegawai',{id:'test-admin',nama:'Admin',divisi:'admin',aktif:true,token:'test-admin-token'});});void 0;");
 const call=(action,p={},auth=token)=>{h.cold();return h.request(action,{token:auth,workflowVersion:2,...p});};
 const good=(action,p,auth)=>{const r=call(action,p,auth);assert.equal(r.ok,true,r.error);return r.data;};
 const bad=(action,p,re,auth)=>{const r=call(action,p,auth);assert.equal(r.ok,false,'must reject');assert.match(r.error,re);};
 const raw=table=>{h.cold();return h.run('pkStore_().fresh('+JSON.stringify(table)+');pkStore_().read('+JSON.stringify(table)+')');};
 return {h,good,bad,raw};
}
function native(f){
 f.good('saveCommerceSupplier',{record:{id:'supplier',nama:'Supplier'}});f.good('saveCommerceProduct',{record:{id:'product',nama:'Product',supplierId:'supplier'}});
 let row=f.good('saveCommerceOrder',{record:{id:'order',produkId:'product',items:[{id:'m',nama:'M',jumlah:300}],hargaSatuan:1000,tanggalOrder:'2026-10-08',initialPayment:{jumlah:100000,metode:'transfer',tanggal:'2026-10-08'}}}).record;
 return f.good('appendCommerceReceipt',{id:'receipt-290',orderId:row.id,expectedRevision:row.revision,itemId:'m',jumlah:290,tanggal:'2026-10-10',kondisi:'baik'}).record;
}

test('owner inactivates, archives and restores the same purchase PO without voiding DP or partial receipts',()=>{
 const f=fixture(),original=native(f),events=JSON.stringify(f.raw('CommerceEvent'));
 const inactive={module:'pembelian',id:original.id,mode:'inactive',expectedRevision:original.revision,catatan:'Tunda pesanan'};
 f.bad('cancelCommerceRecord',inactive,/owner/,'test-admin-token');f.bad('cancelCommerceRecord',{...inactive,expectedRevision:'stale'},/berubah/);f.bad('cancelCommerceRecord',{...inactive,voidAll:true},/tidak boleh/);f.bad('cancelCommerceRecord',{...inactive,mode:'purge'},/tidak dikenal/);
 const stopped=f.good('cancelCommerceRecord',inactive).record;
 function preserved(row){assert.equal(row.id,original.id);assert.equal(row.totalPaid,100000);assert.equal(row.balance,200000);assert.equal(row.totalReceived,290);assert.deepEqual(row.payments,original.payments);assert.deepEqual(row.receipts,original.receipts);assert.equal(JSON.stringify(f.raw('CommerceEvent')),events);}
 preserved(stopped);assert.equal(stopped.cancelMode,'inactive');assert.equal(stopped.cancelKeepsEvents,true);assert.equal(stopped.cancelled,true);assert.equal(stopped.lifecycleHistory.length,1);
 assert.equal(f.good('cancelCommerceRecord',inactive).record.lifecycleHistory.length,1,'exact retry does not repeat lifecycle evidence');
 f.bad('appendCommercePayment',{id:'blocked-pay',module:'pembelian',parentId:stopped.id,expectedRevision:stopped.revision,jumlah:1},/dibatalkan/);
 f.bad('appendCommerceReceipt',{id:'blocked-receipt',orderId:stopped.id,expectedRevision:stopped.revision,itemId:'m',jumlah:10},/dibatalkan/);
 const archive={...inactive,mode:'archived',expectedRevision:stopped.revision,catatan:'Simpan dalam arsip'};
 f.bad('cancelCommerceRecord',{...archive,expectedRevision:'stale'},/berubah/);
 const archived=f.good('cancelCommerceRecord',archive).record;preserved(archived);assert.equal(archived.cancelMode,'archived');assert.equal(archived.lifecycleHistory.length,2);assert.equal(f.good('cancelCommerceRecord',archive).record.lifecycleHistory.length,2);
 f.bad('cancelCommerceRecord',{...archive,mode:'inactive'},/dibatalkan/);f.bad('cancelCommerceRecord',{...archive,catatan:'Different intent'},/dibatalkan/);
 f.bad('restoreCommerceRecord',{module:'pembelian',id:archived.id,expectedRevision:'stale'},/berubah/);
 const restored=f.good('restoreCommerceRecord',{module:'pembelian',id:archived.id,expectedRevision:archived.revision}).record;preserved(restored);assert.equal(restored.cancelMode,undefined);assert.equal(restored.cancelled,undefined);assert.equal(restored.restoredFrom.mode,'archived');assert.equal(restored.lifecycleHistory.length,3);assert.equal(restored.status,original.status);
 assert.equal(f.raw('CommerceRecord').filter(r=>r.kind==='order').length,1,'no duplicate PO or physical purge');
 const final=f.good('appendCommerceReceipt',{id:'remaining-10',orderId:restored.id,expectedRevision:restored.revision,itemId:'m',jumlah:10,tanggal:'2026-10-11'}).record;assert.equal(final.totalReceived,300);assert.equal(final.totalPaid,100000);assert.equal(final.balance,200000);
});

test('soft archive preserves unresolved legacy evidence, and never applies purchase modes to sales notes',()=>{
 const f=fixture(),backup={soldier_pembelian_produk:{suppliers:[{id:'sup',nama:'Old supplier'}],produk:[{id:'prod',nama:'Old product',supplierId:'sup'}],orders:[{id:'old-order',produkId:'prod',tanggalOrder:'2026-08-31',items:[{nama:'Hitam',jumlah:300}],hargaSatuan:1000,totalHarga:300000,pembayaran:[{id:'old-payment',tanggal:'2026-08-31',jumlah:100000}],penerimaan:[{id:'orphan',tanggal:'2026-09-01',itemId:'unknown-item',jumlah:290}]}]}};
 const preview=f.good('previewCommerceImport',{backup});f.good('applyCommerceImport',{backup,sourceHash:preview.sourceHash,planHash:preview.planHash});
 const old=f.good('getCommerceState',{module:'pembelian'}).orders[0],events=JSON.stringify(f.raw('CommerceEvent')),sources=JSON.stringify(f.raw('CommerceSource'));assert.equal(old.receiptReview,true);
 const gone=f.good('cancelCommerceRecord',{module:'pembelian',id:old.id,mode:'archived',expectedRevision:old.revision,catatan:'Arsip bukti lama'}).record;
 assert.equal(gone.totalPaid,old.totalPaid);assert.equal(gone.totalReceived,old.totalReceived);assert.equal(gone.balance,old.balance);assert.equal(gone.receiptReview,true);assert.equal(JSON.stringify(f.raw('CommerceEvent')),events);assert.equal(JSON.stringify(f.raw('CommerceSource')),sources);
 f.bad('cancelCommerceRecord',{module:'nota',id:'unknown',mode:'inactive',catatan:'Not allowed'},/tidak dikenal/);
});
