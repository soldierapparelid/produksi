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
 h.run(`pkStore_().lock(function(){pkStore_().appendMany('Pegawai',[{id:'adminfixture',nama:'Fixture Admin',divisi:'admin',aktif:true,token:'fixture-admin-token-001'},{id:'cutterfixture',nama:'Fixture Cutter',divisi:'potong',aktif:true,token:'fixture-cutter-token-001'}]);});void 0;`);
 function call(action,p={},token=owner){h.cold();return h.request(action,{token,workflowVersion:2,...p});}
 function good(action,p={},token=owner){const r=call(action,p,token);assert.equal(r.ok,true,r.error);return r.data;}
 function bad(action,p={},regex,token=owner){const r=call(action,p,token);assert.equal(r.ok,false,'must reject');if(regex)assert.match(r.error,regex);return r;}
 function raw(table){h.cold();return h.run(`pkStore_().fresh(${JSON.stringify(table)});pkStore_().read(${JSON.stringify(table)})`);}
 function masters(){good('saveCommerceSupplier',{record:{id:'supplier01',nama:'Supplier Fixture'}});good('saveCommerceProduct',{record:{id:'product01',nama:'Product Fixture',supplierId:'supplier01',kategori:'Atasan'}});}
 function order(extra={}){return {id:'order01',produkId:'product01',grupNama:'Fixture invoice',items:[{id:'size01',nama:'M',jumlah:3},{id:'size02',nama:'L',jumlah:2}],hargaSatuan:10000,tanggalOrder:'2026-10-08',...extra};}
 function state(module='pembelian'){return good('getCommerceState',{module});}
 return {h,owner,call,good,bad,raw,masters,order,state};
}
function backup(){return {
 soldier_pembelian_produk:{suppliers:[{id:'legacySupplier',nama:'Old supplier'}],produk:[{id:'legacyProduct',nama:'Old product',supplierId:'legacySupplier',_hasImg:true}],orders:[{id:'legacyOrder',produkId:'legacyProduct',tanggalOrder:'2026-09-01',items:[{nama:'M',jumlah:5}],hargaSatuan:10000,totalHarga:50000,dp:10000,pembayaran:[{id:'pay-old',tanggal:'2026-09-01',jumlah:10000,metode:'cash'}],penerimaan:[{id:'received-old',tanggal:'2026-09-02',itemId:'missing-item-id',jumlah:3,kondisi:'baik'}]}]},
 soldier_hpp_cache_v1:{configs:{sku01:{hargaJahit:1200}},modelConfigs:{},marketplace:{shopee:{nama:'Shop',fee:10,fixedPerPcs:1000}},pajak:1},
 produksi:{produksi:[{id:'sku01',nama:'Old shirt',size:'M'}],cuttingPlans:[]},
 notaPenjualan_v1:{transactions:[{id:'SA-261001-1',date:'2026-10-01T12:00:00Z',customer:{name:'Fixture customer'},items:[{id:'old-note-line',name:'Shirt',qty:1,price:90000,subtotal:90000}],total:90000,subtotal:90000,payment:{method:'cash',amount:100000,change:10000,status:'lunas'}}]}
};}

test('direct legacy edits retain the same order, frozen supplier, every event and the original source',()=>{
 const f=fixture(),b=backup(),p=f.good('previewCommerceImport',{backup:b});f.good('applyCommerceImport',{backup:b,sourceHash:p.sourceHash,planHash:p.planHash});
 const old=f.state().orders[0],events=JSON.stringify(f.raw('CommerceEvent')),source=JSON.stringify(f.raw('CommerceSource')),before=f.raw('CommerceRecord').find(r=>r.kind==='order');
 const edit={record:{...old,items:[{id:'existing-line-new-key',nama:'M',jumlah:6}],hargaSatuan:12000,tanggalOrder:'2026-09-03',grupNama:'Invoice baru',catatan:'Koreksi jumlah dan harga'},expectedRevision:old.revision};
 f.bad('saveCommerceOrder',edit,/owner/,'fixture-admin-token-001');f.bad('saveCommerceOrder',{...edit,expectedRevision:'stale'},/berubah/);
 const changed=f.good('saveCommerceOrder',edit).record;assert.equal(changed.id,old.id);assert.equal(changed.legacy,true);assert.equal(changed.totalPaid,10000);assert.equal(changed.totalReceived,3);assert.equal(changed.totalHarga,72000);assert.equal(changed.balance,62000);assert.equal(changed.receiptReview,true);assert.equal(changed.orderEditCount,1);assert.equal(changed._orderChanges,undefined);
 assert.equal(JSON.stringify(f.raw('CommerceEvent')),events);assert.equal(JSON.stringify(f.raw('CommerceSource')),source);assert.equal(f.state().orders.length,1);assert.equal(f.state().orders[0].cancelled,false);
 const stored=f.raw('CommerceRecord').find(r=>r.kind==='order'),audit=JSON.parse(stored.data)._orderChanges;assert.equal(stored.id,before.id);assert.equal(stored.sourceHash,before.sourceHash);assert.equal(audit[0].before.hargaSatuan,10000);assert.equal(audit[0].before.items[0].jumlah,5);
 assert.equal(f.good('saveCommerceOrder',edit).record.orderEditCount,1,'same request replay does not append a second audit entry');
 const next=record=>({record:{...changed,...record},expectedRevision:changed.revision});
 f.bad('saveCommerceOrder',next({items:[{id:changed.items[0].id,nama:'M',jumlah:5}]}),/minimum/);
 f.bad('saveCommerceOrder',next({items:[{id:changed.items[0].id,nama:'L',jumlah:6}]}),/Nama|urutan/);
 f.bad('saveCommerceOrder',next({hargaSatuan:1000}),/sudah dibayar/);
 const pr=f.state().products[0],su=f.state().suppliers[0];f.good('saveCommerceProduct',{record:{...pr,nama:'Renamed product',aktif:false},expectedRevision:pr.revision});f.good('saveCommerceSupplier',{record:{...su,nama:'Renamed supplier',aktif:false},expectedRevision:su.revision});
 const revised=f.good('saveCommerceOrder',next({catatan:'Catatan baru'})).record;assert.equal(revised.productName,old.productName);assert.equal(revised.supplierName,old.supplierName);assert.equal(revised.totalPaid,10000);assert.equal(JSON.stringify(f.raw('CommerceEvent')),events);
});
test('editing legacy details cannot fabricate an orphan receipt link or bypass unreadable payment amounts',()=>{
 const f=fixture(),b=backup(),p=f.good('previewCommerceImport',{backup:b});f.good('applyCommerceImport',{backup:b,sourceHash:p.sourceHash,planHash:p.planHash});const old=f.state().orders[0],events=JSON.stringify(f.raw('CommerceEvent'));
 f.bad('saveCommerceOrder',{record:{...old,items:[{id:'missing-item-id',nama:'M',jumlah:5}]},expectedRevision:old.revision},/tidak boleh ditebak/);assert.equal(JSON.stringify(f.raw('CommerceEvent')),events);
 const g=fixture(),bad=backup();bad.soldier_pembelian_produk.orders[0].pembayaran[0].jumlah='unknown';const preview=g.good('previewCommerceImport',{backup:bad});g.good('applyCommerceImport',{backup:bad,sourceHash:preview.sourceHash,planHash:preview.planHash});const held=g.state().orders[0];assert.equal(held.paymentReview,true);
 g.bad('saveCommerceOrder',{record:{...held,items:[{id:'line-1',nama:'M',jumlah:5}]},expectedRevision:held.revision},/Nominal pembayaran/);
});

test('owner can confirm a missing legacy variant ID only without fabricating receipt links, preserving the same order and DP',()=>{
 const f=fixture(),b=backup();b.soldier_pembelian_produk.orders[0].penerimaan=[];
 const p=f.good('previewCommerceImport',{backup:b});f.good('applyCommerceImport',{backup:b,sourceHash:p.sourceHash,planHash:p.planHash});
 const old=f.state().orders[0],events=JSON.stringify(f.raw('CommerceEvent')),sources=JSON.stringify(f.raw('CommerceSource')),stored=f.raw('CommerceRecord').find(r=>r.kind==='order');
 assert.equal(old.receiptReview,true);assert.equal(old.totalReceived,0);assert.deepEqual(old.receipts,[]);
 const confirm={record:{...old,items:[{...old.items[0],id:'confirmed-original-variant'}]},expectedRevision:old.revision};
 f.bad('saveCommerceOrder',confirm,/owner/,'fixture-admin-token-001');f.bad('saveCommerceOrder',{...confirm,expectedRevision:'stale'},/berubah/);
 f.bad('saveCommerceOrder',{...confirm,record:{...confirm.record,items:[{id:'confirmed-original-variant',nama:'Guessed variant',jumlah:5}]}},/Nama|urutan/);
 const fixed=f.good('saveCommerceOrder',confirm).record;
 assert.equal(fixed.id,old.id);assert.equal(fixed.legacy,true);assert.equal(fixed.receiptReview,false);assert.equal(fixed.totalReceived,0);assert.deepEqual(fixed.receipts,[]);assert.equal(fixed.totalPaid,old.totalPaid);assert.equal(fixed.balance,old.balance);assert.deepEqual(fixed.payments,old.payments);
 assert.equal(JSON.stringify(f.raw('CommerceEvent')),events);assert.equal(JSON.stringify(f.raw('CommerceSource')),sources);assert.equal(f.raw('CommerceRecord').find(r=>r.kind==='order').sourceHash,stored.sourceHash);assert.equal(f.state().orders.length,1);
 assert.equal(f.good('saveCommerceOrder',confirm).record.orderEditCount,1,'repeat confirmation reuses the same order and audit');
 const received=f.good('appendCommerceReceipt',{id:'confirmed-receipt',orderId:fixed.id,expectedRevision:fixed.revision,itemId:'confirmed-original-variant',jumlah:3,tanggal:'2026-10-11',kondisi:'baik'}).record;
 assert.equal(received.totalReceived,3);assert.equal(received.totalPaid,old.totalPaid);assert.equal(received.balance,old.balance);assert.deepEqual(received.payments,old.payments);
 /* A genuine orphan receipt remains review-only even after an owner supplies a new variant ID. */
 const g=fixture(),orphan=backup(),preview=g.good('previewCommerceImport',{backup:orphan});g.good('applyCommerceImport',{backup:orphan,sourceHash:preview.sourceHash,planHash:preview.planHash});
 const held=g.state().orders[0],heldEvents=JSON.stringify(g.raw('CommerceEvent')),safe=g.good('saveCommerceOrder',{record:{...held,items:[{id:'new-unlinked-variant',nama:'M',jumlah:5}]},expectedRevision:held.revision}).record;
 assert.equal(safe.receiptReview,true);assert.equal(safe.receipts[0].itemId,'missing-item-id');
 g.bad('appendCommerceReceipt',{id:'must-not-receive',orderId:safe.id,expectedRevision:safe.revision,itemId:'new-unlinked-variant',jumlah:1},/Hubungan/);
 g.bad('gantiCommerceEvent',{id:'must-not-relink',module:'pembelian',parentId:safe.id,eventId:safe.receipts[0].id,expectedRevision:safe.revision,itemId:'new-unlinked-variant',jumlah:3},/Hubungan|diperiksa/);
 assert.equal(JSON.stringify(g.raw('CommerceEvent')),heldEvents);
});
test('commerce is lazy and all read, PDF, write and import actions require live admin authentication',()=>{
 const f=fixture();f.h.run(`var savedRead=pkStore_,commerceReadLog=[];pkStore_=function(){var s=savedRead();if(!s.traced){var read=s.read;s.read=function(n){commerceReadLog.push(n);return read(n);};s.traced=true;}return s;};void 0;`);
 f.good('getState');assert.equal(f.h.run('commerceReadLog.some(function(n){return /^Commerce/.test(n);})'),false);
 f.bad('getCommerceState',{module:'pembelian'},/owner|admin/,'fixture-cutter-token-001');f.bad('makeCommercePdf',{module:'nota',id:'none'},/owner|admin/,'fixture-cutter-token-001');f.bad('saveCommerceSupplier',{record:{id:'x',nama:'X'}},/owner|admin/,'fixture-cutter-token-001');f.bad('previewCommerceImport',{backup:backup()},/owner/,'fixture-admin-token-001');
 f.bad('saveCommerceSupplier',{record:{id:'x',nama:'X'},workflowVersion:1},/Versi/);f.bad('importRows',{sheet:'CommerceEvent',rows:[]},/Sheet/);
 f.h.run(`pkStore_().lock(function(){pkStore_().update('Pegawai','adminfixture',{aktif:false});});void 0;`);f.bad('getCommerceState',{module:'nota'},/masuk|aktif|sesi/i,'fixture-admin-token-001');
});
test('stable parent creation, initial DP atomically in parent, revisions and actor replay protect native orders',()=>{
 const f=fixture();f.masters();const original=f.order({initialPayment:{jumlah:10000,metode:'transfer',tanggal:'2026-10-08'}});
 const saved=f.good('saveCommerceOrder',{record:original});assert.equal(saved.record.totalPaid,10000);assert.equal(saved.record.balance,40000);assert.equal(saved.state,undefined);assert.equal(f.raw('CommerceEvent').length,0);
 f.good('saveCommerceOrder',{record:original});assert.equal(f.state().orders.length,1);
 f.bad('saveCommerceOrder',{record:original},/berubah/,'fixture-admin-token-001');f.bad('saveCommerceOrder',{record:{...original,hargaSatuan:12000}},/berubah/);
 const rev=saved.record.revision;f.good('appendCommercePayment',{id:'payment01',module:'pembelian',parentId:'order01',expectedRevision:rev,tanggal:'2026-10-08',jumlah:10000,metode:'cash'});
 f.bad('appendCommercePayment',{id:'payment02',parentId:'order01',expectedRevision:rev,jumlah:10000},/berubah/);
 f.good('appendCommercePayment',{id:'payment01',module:'pembelian',parentId:'order01',expectedRevision:rev,tanggal:'2026-10-08',jumlah:10000,metode:'cash'});assert.equal(f.raw('CommerceEvent').length,1);
 f.bad('appendCommercePayment',{id:'payment01',parentId:'order01',expectedRevision:rev,tanggal:'2026-10-08',jumlah:10001,metode:'cash'},/berbeda/);
});
test('payments, item receipts and owner void enforce remaining amounts without mutating immutable events',()=>{
 const f=fixture();f.masters();let r=f.good('saveCommerceOrder',{record:f.order()}).record;
 f.bad('appendCommercePayment',{id:'pay-over',parentId:r.id,expectedRevision:r.revision,jumlah:50001},/melebihi/);
 f.bad('appendCommerceReceipt',{id:'receive-over',orderId:r.id,expectedRevision:r.revision,itemId:'size01',jumlah:4},/melebihi/);
 r=f.good('appendCommerceReceipt',{id:'receive01',orderId:r.id,expectedRevision:r.revision,itemId:'size01',jumlah:3,kondisi:'baik'}).record;
 const frozen=f.raw('CommerceEvent')[0];assert.equal(r.totalReceived,3);assert.equal(r.receipts[0].kondisi,'baik');
 f.bad('voidCommerceEvent',{id:'void01',parentId:r.id,eventId:'receive01',expectedRevision:r.revision,catatan:'Receipt duplicate'},/owner/,'fixture-admin-token-001');
 r=f.good('voidCommerceEvent',{id:'void01',parentId:r.id,eventId:'receive01',expectedRevision:r.revision,catatan:'Receipt duplicate'}).record;assert.equal(r.totalReceived,0);assert.deepEqual(f.raw('CommerceEvent')[0],frozen);
 f.good('voidCommerceEvent',{id:'void01',parentId:r.id,eventId:'receive01',expectedRevision:'old-proof',catatan:'Receipt duplicate'});assert.equal(f.raw('CommerceEvent').length,2);
});
test('cash nota preserves discounts, shipping, applied payment, tender and change in shared document',()=>{
 const f=fixture(),input={id:'nota01',date:'2026-10-08',customer:{name:'Walk in',phone:'000',address:'Fixture'},items:[{id:'line01',name:'Shirt',qty:2,price:50000,discPercent:10}],discountPercent:10,shipping:9000,initialPayment:{jumlah:90000,metode:'cash',tenderedAmount:100000}};
 const r=f.good('saveCommerceNota',{record:input}).record;assert.equal(r.total,90000);assert.equal(r.totalPaid,90000);assert.equal(r.payments[0].change,10000);
 f.h.context.NOTA_FIXTURE=r;const model=f.h.run(`coreCommerceSlipModel('nota',NOTA_FIXTURE,{})`);assert.ok(model.sections.every(s=>s.columns&&s.columns.length));assert.ok(model.summary.some(s=>s.label==='Ongkir'));assert.equal(model.rows[0][4],'10%');
 f.bad('saveCommerceNota',{record:{...input,id:'nota02',initialPayment:{jumlah:90001,metode:'cash'}}},/melebihi/);
 f.bad('saveCommerceNota',{record:{...input,id:'nota03',initialPayment:{jumlah:90000,metode:'transfer',tenderedAmount:100000}}},/tunai/);
});
test('additive migration freezes original snapshots, never counts DP twice, holds unresolved receipt links and recovers exact pictures',()=>{
 const f=fixture(),b=backup(),reference={soldier:{produksi:b.produksi,pembelianProduk:{produk:[{...b.soldier_pembelian_produk.produk[0],gambar:'data:image/png;base64,AAAA'}]},stokBahan:{pembelian:[]},produksi_meta:{tarif:1000,pin:'never-copy'}}};
 const p=f.good('previewCommerceImport',{backup:b,reference});assert.equal(p.summary.receiptReview,1);assert.equal(p.summary.images,1);assert.equal(f.raw('CommerceRecord').length,0);
 const applied=f.good('applyCommerceImport',{backup:b,reference,sourceHash:p.sourceHash,planHash:p.planHash});assert.equal(applied.applied,true);
 const order=f.state().orders[0];assert.equal(order.totalPaid,10000);assert.equal(order.balance,40000);assert.equal(order.receiptReview,true);assert.equal(order.receipts[0].itemId,'missing-item-id');
 assert.equal(f.state('nota').notes[0].totalPaid,90000);assert.equal(JSON.stringify(f.raw('CommerceSource')).includes('never-copy'),false);
 /* The list carries a marker only; the exact picture is stored unchanged and fetched separately. */
 const pictured=f.state().products[0];assert.equal(pictured.hasPicture,true);assert.equal(pictured.gambar,undefined);assert.equal(JSON.parse(f.raw('CommerceRecord').find(r=>r.kind==='product').data).gambar,'data:image/png;base64,AAAA');
 const wanted={items:[{id:pictured.id,rev:pictured.revision.slice(0,16)}]};assert.deepEqual(f.good('getCommerceImages',wanted).images,{[pictured.id]:'data:image/png;base64,AAAA'});
 f.h.run(`var pictureBase=pkStore_,pictureReads=[];pkStore_=function(){var s=pictureBase();if(!s.pictureTracked){var read=s.read;s.read=function(n){pictureReads.push(n);return read(n);};s.pictureTracked=true;}return s;};void 0;`);
 assert.deepEqual(f.good('getCommerceImages',wanted).images,{[pictured.id]:'data:image/png;base64,AAAA'});assert.equal(f.h.run('pictureReads.indexOf("CommerceRecord")'),-1,'a repeated picture comes from the per-image cache');
 f.bad('getCommerceImages',wanted,/owner|admin/,'fixture-cutter-token-001');f.bad('getCommerceImages',{items:[{id:pictured.id,rev:'../x'}]},/tidak sah/);
 const source=f.raw('CommerceSource').find(r=>r.kind==='order');assert.deepEqual(JSON.parse(source.data),b.soldier_pembelian_produk.orders[0]);
 f.bad('appendCommerceReceipt',{id:'manual-new',orderId:order.id,expectedRevision:order.revision,itemId:'guessed',jumlah:1},/Hubungan/);
 const before=f.raw('CommerceSource');f.good('applyCommerceImport',{backup:b,reference,sourceHash:p.sourceHash,planHash:p.planHash});assert.deepEqual(f.raw('CommerceSource'),before);
 assert.equal(f.raw('PO').length,0);assert.equal(f.raw('StokBahan').length,0);
});
test('migration validates every table before writing and a partial append stays locked until exact retry',()=>{
 const f=fixture(),bad=backup();bad.soldier_pembelian_produk.orders[0].catatan='x'.repeat(49001);
 f.bad('previewCommerceImport',{backup:bad},/panjang|batas|49|besar/i);assert.equal(f.raw('CommerceImport').length,0);
 const b=backup(),p=f.good('previewCommerceImport',{backup:b});
 f.h.run(`var savedCommerceStore=pkStore_,interruptCommerce=true;pkStore_=function(){var s=savedCommerceStore();if(!s.failureWrapped){var append=s.appendMany;s.appendMany=function(name,rows){if(name==='CommerceRecord'&&interruptCommerce){interruptCommerce=false;append(name,rows.slice(0,1));throw new Error('fixture interruption');}return append(name,rows);};s.failureWrapped=true;}return s;};void 0;`);
 f.bad('applyCommerceImport',{backup:b,sourceHash:p.sourceHash,planHash:p.planHash},/interruption/);assert.equal(f.raw('CommerceImport')[0].status,'pending');
 f.bad('getCommerceState',{module:'pembelian'},/belum selesai/);f.bad('saveCommerceSupplier',{record:{id:'new',nama:'New'}},/belum selesai/);
 const different=backup();different.soldier_pembelian_produk.suppliers[0].nama='Different';f.bad('previewCommerceImport',{backup:different},/impor lain/);
 f.good('applyCommerceImport',{backup:b,sourceHash:p.sourceHash,planHash:p.planHash});assert.equal(f.raw('CommerceImport')[0].status,'complete');assert.equal(f.state().suppliers.length,1);assert.equal(f.raw('CommerceRecord').length,5);
});
test('purchase identity is frozen at issue and inactive masters or initial backdated payments cannot create a new order',()=>{
 const f=fixture();f.masters();const original=f.good('saveCommerceOrder',{record:f.order()}).record;
 let supplier=f.state().suppliers[0];f.good('saveCommerceSupplier',{record:{...supplier,nama:'Supplier renamed'},expectedRevision:supplier.revision});
 let product=f.state().products[0];f.good('saveCommerceProduct',{record:{...product,nama:'Product renamed'},expectedRevision:product.revision});
 assert.equal(f.state().orders[0].supplierName,original.supplierName);assert.equal(f.state().orders[0].productName,original.productName);
 f.bad('saveCommerceOrder',{record:f.order({id:'early-dp',initialPayment:{jumlah:1000,tanggal:'2026-10-07'}})},/sebelum/);
 supplier=f.state().suppliers[0];f.good('saveCommerceSupplier',{record:{...supplier,aktif:false},expectedRevision:supplier.revision});f.bad('saveCommerceOrder',{record:f.order({id:'inactive-order'})},/tidak aktif/);
});
test('HPP source integrity fails closed after incomplete snapshot and marketplace settings preserve fixed fees and revision',()=>{
 const f=fixture(),b=backup(),p=f.good('previewCommerceImport',{backup:b});f.good('applyCommerceImport',{backup:b,sourceHash:p.sourceHash,planHash:p.planHash});
 const first=f.state('hpp');assert.equal(first.config.marketplace.shopee.fixedPerPcs,1000);
 const request={marketplace:{shop:{nama:'Fixture Shop',fee:10,fixedPerPcs:1250}},pajak:1,expectedRevision:first.revision};f.good('saveCommerceHppSettings',request);f.good('saveCommerceHppSettings',request);assert.equal(f.state('hpp').config.marketplace.shop.fixedPerPcs,1250);
 f.bad('saveCommerceHppSettings',{...request,pajak:2},/berubah/);
 f.h.run(`pkStore_().lock(function(){var rows=pkStore_().read('CommerceSource');pkStore_().replaceAll('CommerceSource',rows.filter(function(r){return r.kind!=='hpp-production';}));});void 0;`);
 f.bad('getCommerceState',{module:'hpp'},/tidak utuh/);
});
test('later device-only nota backup is additive, imported amounts settle once and new daily note numbers are stable',()=>{
 const f=fixture(),b=backup();delete b.notaPenjualan_v1;let p=f.good('previewCommerceImport',{backup:b});f.good('applyCommerceImport',{backup:b,sourceHash:p.sourceHash,planHash:p.planHash});const source=f.raw('CommerceSource'),purchase=f.state();
 const nota=backup().notaPenjualan_v1;nota.transactions[0].id='SA-261008-004';nota.transactions[0].date='2026-10-08';const device={format:'soldier-device-backup-v1',data:{notaPenjualan_v1:nota,sa_roas_analysis_v2:{private:'not-a-commerce-module'}},raw:{secret:'ignored'}};
 p=f.good('previewCommerceImport',{backup:device});assert.equal(p.summary.orders,0);assert.equal(p.summary.notes,1);f.good('applyCommerceImport',{backup:device,sourceHash:p.sourceHash,planHash:p.planHash});assert.deepEqual(f.state(),{...purchase,version:f.state().version});assert.deepEqual(f.raw('CommerceSource').slice(0,source.length),source);assert.equal(JSON.stringify(f.raw('CommerceSource')).includes('not-a-commerce-module'),false);
 const input={id:'random-stable-client-id',date:'2026-10-08',customer:{name:'Fixture'},items:[{id:'line',name:'Shirt',qty:1,price:10000}]};const saved=f.good('saveCommerceNota',{record:input}).record;assert.equal(saved.noNota,'SA-261008-005');assert.equal(f.good('saveCommerceNota',{record:input}).record.noNota,saved.noNota);
});
test('native mutations do not read the large immutable source snapshot and revoked physical account is rejected despite stale cache',()=>{
 const f=fixture();f.masters();f.h.run(`var commerceNoSourceBase=pkStore_,commerceTablesRead=[];pkStore_=function(){var s=commerceNoSourceBase();if(!s.readTracked){var read=s.read;s.read=function(n){commerceTablesRead.push(n);return read(n);};s.readTracked=true;}return s;};void 0;`);
 f.good('saveCommerceOrder',{record:f.order()});assert.equal(f.h.run('commerceTablesRead.indexOf("CommerceSource")'),-1);
 f.good('getCommerceState',{module:'pembelian'},'fixture-admin-token-001');const values=f.h.sheets.Pegawai.values,head=values[0],row=values.find(r=>r[head.indexOf('id')]==='adminfixture');row[head.indexOf('aktif')]=false;
  /* A silent sheet edit (no edit trigger): money writes still recheck the physical account row. Lists follow
    the account cache like every other page, and the edit trigger ends that at once. */
 f.bad('saveCommerceSupplier',{record:{id:'blocked01',nama:'Blocked'}},/nonaktif/,'fixture-admin-token-001');
 f.h.run(`onEdit({range:{getSheet:function(){return {getName:function(){return 'Pegawai';}};}}});void 0;`);
 f.bad('getCommerceState',{module:'nota'},/nonaktif/,'fixture-admin-token-001');f.bad('getCommerceImages',{items:[]},/nonaktif/,'fixture-admin-token-001');
});
test('one answer carries the refreshed page after a save, and lists never carry product photos',()=>{
 const f=fixture();f.masters();const picture='data:image/jpeg;base64,'+'A'.repeat(4000);
 let product=f.state().products[0];
 const saved=f.good('saveCommerceProduct',{record:{...product,gambar:picture},expectedRevision:product.revision,withState:true});
 assert.equal(saved.record.hasPicture,true);assert.equal(saved.record.gambar,undefined);assert.equal(saved.commerce.module,'pembelian');assert.equal(saved.commerce.products[0].revision,saved.record.revision);
 assert.equal(JSON.stringify(saved).includes(picture),false);assert.equal(JSON.stringify(f.state()).includes(picture),false);
 assert.deepEqual(f.good('getCommerceImages',{items:[{id:'product01',rev:saved.record.revision.slice(0,16)}]}).images,{product01:picture});
 /* Editing other fields keeps the stored photo; the lean record never erases it. */
 product=f.state().products[0];const renamed=f.good('saveCommerceProduct',{record:{...product,nama:'Product renamed'},expectedRevision:product.revision,withState:true});
 assert.equal(renamed.record.hasPicture,true);assert.equal(JSON.parse(f.raw('CommerceRecord').find(r=>r.kind==='product').data).gambar,picture);
 /* A stale revision still shows the current photo, but only the exact revision is kept in the per-image cache. */
 assert.deepEqual(f.good('getCommerceImages',{items:[{id:'product01',rev:saved.record.revision.slice(0,16)}]}).images,{product01:picture});
 const order=f.good('saveCommerceOrder',{record:f.order(),withState:true});assert.equal(order.commerce.orders.length,1);assert.equal(order.commerce.orders[0].productName,'Product renamed');assert.equal(order.commerce.version,f.state().version);
 const paid=f.good('appendCommercePayment',{id:'pay01',module:'pembelian',parentId:'order01',expectedRevision:order.record.revision,tanggal:'2026-10-08',jumlah:10000,metode:'cash',withState:true});
 assert.equal(paid.commerce.orders[0].totalPaid,10000);assert.equal(paid.record.revision,paid.commerce.orders[0].revision);
 /* The same request sent again answers with the same record and the current page, without a second payment. */
 const again=f.good('appendCommercePayment',{id:'pay01',module:'pembelian',parentId:'order01',expectedRevision:order.record.revision,tanggal:'2026-10-08',jumlah:10000,metode:'cash',withState:true});
 assert.equal(again.commerce.orders[0].totalPaid,10000);assert.equal(f.raw('CommerceEvent').length,1);
 assert.equal(f.good('saveCommerceSupplier',{record:{id:'supplier02',nama:'No state asked'}}).commerce,undefined);
});
test('many orders reuse one product and supplier index and keep the names the per-record view gives',()=>{
 const f=fixture();f.masters();for(let i=0;i<6;i++)f.good('saveCommerceOrder',{record:f.order({id:'order0'+i})});
 const listed=f.state().orders,single=f.good('saveCommerceOrder',{record:f.order({id:'order00'})}).record;
 assert.equal(listed.length,6);assert.deepEqual(listed.find(o=>o.id==='order00'),single);assert.ok(listed.every(o=>o.productName==='Product Fixture'&&o.supplierName==='Supplier Fixture'));
});
test('the owner turns an old-app order into an ordinary one: contents and live payments are copied with their dates, the old order is archived intact',()=>{
 const f=fixture(),b=backup(),reference={soldier:{produksi:b.produksi,pembelianProduk:{produk:[{...b.soldier_pembelian_produk.produk[0],gambar:'data:image/png;base64,AAAA'}]},stokBahan:{pembelian:[]},produksi_meta:{tarif:1000}}};
 const p=f.good('previewCommerceImport',{backup:b,reference});f.good('applyCommerceImport',{backup:b,reference,sourceHash:p.sourceHash,planHash:p.planHash});
 const lama=f.state().orders[0];assert.equal(lama.legacy,true);assert.equal(lama.needsReview,true);
 f.bad('saveCommerceOrder',{record:{id:lama.id,produkId:lama.produkId,items:[{id:'size01',nama:'M',jumlah:5}],hargaSatuan:9000,tanggalOrder:lama.tanggalOrder},expectedRevision:lama.revision},/owner/,'fixture-admin-token-001');
 const salin={id:'order-salin-01',orderId:lama.id,expectedRevision:lama.revision,grupNama:'Invoice Okt',withState:true};
 f.bad('salinCommerceOrderLama',salin,/owner/,'fixture-admin-token-001');f.bad('salinCommerceOrderLama',{...salin,expectedRevision:'old'},/berubah/);f.bad('salinCommerceOrderLama',{...salin,orderId:'missing-order'},/tidak ditemukan/);
 const catatan=f.raw('CommerceRecord').length,kejadian=f.raw('CommerceEvent').length,asli=f.raw('CommerceRecord').find(r=>r.kind==='order');
 const hasil=f.good('salinCommerceOrderLama',salin),baru=hasil.record;
 assert.equal(baru.id,'order-salin-01');assert.equal(baru.legacy,false);assert.equal(baru.needsReview,false);assert.equal(baru.grupNama,'Invoice Okt');
 assert.equal(baru.totalHarga,50000);assert.equal(baru.totalPaid,10000);assert.equal(baru.balance,40000);assert.equal(baru.status,'dp');assert.match(baru.catatan,/Disalin dari data aplikasi lama/);
 assert.equal(baru.payments.length,1);assert.equal(baru.payments[0].tanggal,'2026-09-01');assert.equal(baru.payments[0].metode,'cash');assert.ok(!baru.payments[0].sourceReview);
 assert.equal(baru.totalReceived,0);assert.equal(hasil.penerimaanDilewati,1,'the old receipt pointed at an unknown variant, so it is not copied');
 /* the old order is archived with its own records untouched */
 const lamaKini=hasil.commerce.orders.find(o=>o.id===lama.id),barisLama=f.raw('CommerceRecord').find(r=>r.id===asli.id);
 assert.equal(lamaKini.status,'batal');assert.equal(lamaKini.totalPaid,10000);assert.equal(lamaKini.receipts.length,1);assert.equal(barisLama.sourceHash,asli.sourceHash);
 assert.equal(f.raw('CommerceRecord').length,catatan+1);assert.equal(f.raw('CommerceEvent').length,kejadian+1);
 /* the same request again writes nothing more */
 assert.equal(f.good('salinCommerceOrderLama',salin).record.totalPaid,10000);assert.equal(f.raw('CommerceRecord').length,catatan+1);assert.equal(f.raw('CommerceEvent').length,kejadian+1);
 /* the copy is an ordinary order: price, quantity and the payment can be changed */
 const edit=f.good('saveCommerceOrder',{record:{id:baru.id,produkId:baru.produkId,items:[{id:baru.items[0].id,nama:'M',jumlah:6}],hargaSatuan:12000,tanggalOrder:'2026-09-02',grupNama:baru.grupNama},expectedRevision:baru.revision}).record;
 assert.equal(edit.totalHarga,72000);assert.equal(edit.tanggalOrder,'2026-09-02');
 const ubah=f.good('gantiCommerceEvent',{id:'pay-edit-09',module:'pembelian',parentId:baru.id,eventId:edit.payments[0].id,expectedRevision:edit.revision,tanggal:'2026-09-03',jumlah:15000,metode:'transfer',catatan:'DP'}).record;
 assert.equal(ubah.totalPaid,15000);assert.equal(ubah.balance,57000);
 f.bad('salinCommerceOrderLama',{id:'order-salin-02',orderId:baru.id,expectedRevision:ubah.revision},/sudah bisa diubah/);
 f.bad('salinCommerceOrderLama',{id:'order-salin-03',orderId:lama.id,expectedRevision:lamaKini.revision},/dibatalkan/);
});
test('the owner changes or removes a whole group payment in one step: every share is corrected and the new total is divided again',()=>{
 const f=fixture();f.masters();const a=f.good('saveCommerceOrder',{record:f.order()}).record,b=f.good('saveCommerceOrder',{record:f.order({id:'order02',items:[{id:'only',nama:'M',jumlah:1}]})}).record;
 const paid=f.good('appendCommerceGroupPayment',{id:'group-pay-01',module:'pembelian',orderIds:['order01','order02'],expectedRevisions:{order01:a.revision,order02:b.revision},tanggal:'2026-10-09',jumlah:600,metode:'transfer',catatan:'DP salah ketik',withState:true});
 const rev=s=>Object.fromEntries(s.commerce.orders.map(o=>[o.id,o.revision])),by=(s,id)=>s.commerce.orders.find(o=>o.id===id);
 assert.equal(by(paid,'order01').totalPaid,500);assert.equal(by(paid,'order02').totalPaid,100);
 const ubah={id:'group-edit-01',module:'pembelian',groupId:'group-pay-01',expectedRevisions:rev(paid),tanggal:'2026-10-10',jumlah:30000,metode:'cash',catatan:'DP yang benar',withState:true};
 f.bad('gantiCommerceGroupPayment',ubah,/owner/,'fixture-admin-token-001');
 f.bad('gantiCommerceGroupPayment',{...ubah,groupId:'missing-group'},/tidak ditemukan/);
 f.bad('gantiCommerceGroupPayment',{...ubah,expectedRevisions:{order01:a.revision,order02:b.revision}},/berubah/);
 f.bad('gantiCommerceGroupPayment',{...ubah,jumlah:60001},/melebihi sisa/);
 assert.equal(f.raw('CommerceEvent').length,2,'a refused change writes nothing');
 const baru=f.good('gantiCommerceGroupPayment',ubah),p1=by(baru,'order01').payments,hidup=p1.find(e=>!e.voided);
 assert.equal(by(baru,'order01').totalPaid,25000);assert.equal(by(baru,'order02').totalPaid,5000);
 assert.equal(p1.filter(e=>e.voided).length,1,'the old share stays as corrected history');assert.equal(hidup.groupId,'group-edit-01');assert.equal(hidup.metode,'cash');assert.equal(hidup.tanggal,'2026-10-10');assert.equal(hidup.catatan,'DP yang benar');
 assert.equal(f.raw('CommerceEvent').length,6);
 /* the same request again changes nothing; the old group cannot be changed a second time */
 assert.equal(by(f.good('gantiCommerceGroupPayment',ubah),'order01').totalPaid,25000);assert.equal(f.raw('CommerceEvent').length,6);
 f.bad('gantiCommerceGroupPayment',{...ubah,id:'group-edit-02',expectedRevisions:rev(baru)},/sudah dikoreksi/);
 /* zero removes the group payment: nothing is paid any more, the ledger keeps every row */
 const hapus=f.good('gantiCommerceGroupPayment',{id:'group-edit-03',module:'pembelian',groupId:'group-edit-01',expectedRevisions:rev(baru),jumlah:0,withState:true});
 assert.ok(hapus.commerce.orders.every(o=>o.totalPaid===0&&o.balance===o.totalHarga));assert.equal(f.raw('CommerceEvent').length,8);
 assert.ok(by(hapus,'order01').payments.every(e=>e.voided));
});
test('a group payment is divided by remaining balance in whole rupiah, written once, and replays without paying twice',()=>{
 const f=fixture();f.masters();const a=f.good('saveCommerceOrder',{record:f.order()}).record,b=f.good('saveCommerceOrder',{record:f.order({id:'order02',items:[{id:'only',nama:'M',jumlah:1}]})}).record;
 assert.equal(a.balance,50000);assert.equal(b.balance,10000);
 const request={id:'group-pay-01',module:'pembelian',orderIds:['order01','order02'],expectedRevisions:{order01:a.revision,order02:b.revision},tanggal:'2026-10-09',jumlah:30001,metode:'transfer',catatan:'DP gabungan',withState:true};
 const paid=f.good('appendCommerceGroupPayment',request),after=id=>paid.commerce.orders.find(o=>o.id===id);
 assert.equal(after('order01').totalPaid,25001);assert.equal(after('order02').totalPaid,5000);assert.equal(after('order01').totalPaid+after('order02').totalPaid,30001);
 assert.equal(after('order01').payments[0].groupId,'group-pay-01');assert.equal(after('order01').payments[0].catatan,'DP gabungan');assert.equal(f.raw('CommerceEvent').length,2);
 /* the same request again: same answer, nothing new written */
 const again=f.good('appendCommerceGroupPayment',request);assert.equal(again.commerce.orders.find(o=>o.id==='order01').totalPaid,25001);assert.equal(f.raw('CommerceEvent').length,2);
 f.bad('appendCommerceGroupPayment',{...request,jumlah:30002},/sudah digunakan/);f.bad('appendCommerceGroupPayment',{...request,orderIds:['order01']},/2 sampai 40/);
 /* a new group payment must carry the current revisions and cannot exceed what is left */
 f.bad('appendCommerceGroupPayment',{...request,id:'group-pay-02'},/berubah/);
 const now={order01:after('order01').revision,order02:after('order02').revision};
 f.bad('appendCommerceGroupPayment',{...request,id:'group-pay-02',expectedRevisions:now,jumlah:30000},/melebihi sisa/);
 f.bad('appendCommerceGroupPayment',{...request,id:'group-pay-02',expectedRevisions:now},/owner|admin/,'fixture-cutter-token-001');f.bad('appendCommerceGroupPayment',{...request,id:'group-pay-02',expectedRevisions:now,orderIds:['order01','order01']},/ganda/);
 const rest=f.good('appendCommerceGroupPayment',{...request,id:'group-pay-02',expectedRevisions:now,jumlah:29999,withState:true});
 assert.ok(rest.commerce.orders.every(o=>o.balance===0&&o.totalPaid===o.totalHarga));assert.equal(f.raw('CommerceEvent').length,4);
 /* each share stays an ordinary payment: the owner can correct one without touching the other */
 const one=rest.commerce.orders.find(o=>o.id==='order02'),share=one.payments.find(e=>e.groupId==='group-pay-02');
 const fixed=f.good('voidCommerceEvent',{id:'void-share',module:'pembelian',parentId:'order02',eventId:share.id,expectedRevision:one.revision,tanggal:'2026-10-09',catatan:'salah catat',withState:true});
 assert.equal(fixed.commerce.orders.find(o=>o.id==='order02').balance,5000);assert.equal(fixed.commerce.orders.find(o=>o.id==='order01').balance,0);
});

test('group payments span dates and products within one invoice but reject different supplier identities',()=>{
 const f=fixture();f.masters();
 f.good('saveCommerceProduct',{record:{id:'product02',nama:'Second model',supplierId:'supplier01'}});
 f.good('saveCommerceSupplier',{record:{id:'supplier02',nama:'Supplier Fixture'}});
 f.good('saveCommerceProduct',{record:{id:'foreign-product',nama:'Other supplier model',supplierId:'supplier02'}});
 const a=f.good('saveCommerceOrder',{record:f.order({id:'order-aug',tanggalOrder:'2026-08-31',grupNama:'Invoice lintas tanggal'})}).record;
 const b=f.good('saveCommerceOrder',{record:f.order({id:'order-oct',produkId:'product02',tanggalOrder:'2026-10-11',grupNama:'Invoice lintas tanggal'})}).record;
 const foreign=f.good('saveCommerceOrder',{record:f.order({id:'other-supplier-order',produkId:'foreign-product'})}).record;
 const before=JSON.stringify(f.raw('CommerceEvent'));
 f.bad('appendCommerceGroupPayment',{id:'different-suppliers',orderIds:[a.id,foreign.id],expectedRevisions:{[a.id]:a.revision,[foreign.id]:foreign.revision},tanggal:'2026-10-11',jumlah:10000},/supplier yang sama/);
 assert.equal(JSON.stringify(f.raw('CommerceEvent')),before,'same supplier display name is not evidence of the same identity');
 const request={id:'cross-date-group',orderIds:[a.id,b.id],expectedRevisions:{[a.id]:a.revision,[b.id]:b.revision},tanggal:'2026-10-11',jumlah:10000,metode:'transfer',catatan:'DP beberapa model lintas tanggal',withState:true};
 const paid=f.good('appendCommerceGroupPayment',request),orders=paid.commerce.orders.filter(o=>o.id===a.id||o.id===b.id);
 assert.equal(orders.reduce((n,o)=>n+o.totalPaid,0),10000);assert.equal(orders.reduce((n,o)=>n+o.balance,0),90000);assert.equal(f.raw('CommerceEvent').length,2);assert.ok(orders.every(o=>o.payments[0].groupId===request.id));
 f.good('appendCommerceGroupPayment',request);assert.equal(f.raw('CommerceEvent').length,2);
 f.bad('appendCommerceGroupPayment',{...request,orderIds:[a.id,b.id,foreign.id]},/supplier yang sama/);assert.equal(f.raw('CommerceEvent').length,2,'retry cannot quietly expand the original payment to another supplier');
});

test('correcting a partially voided group uses only live parents, never revives a voided share, and binds retries to the exact intent',()=>{
 const f=fixture();f.masters();const orders=['group-o1','group-o2','group-o3'].map(id=>f.good('saveCommerceOrder',{record:f.order({id,items:[{id:'only',nama:'M',jumlah:3}]})}).record);
 const paid=f.good('appendCommerceGroupPayment',{id:'original-group',orderIds:orders.map(o=>o.id),expectedRevisions:Object.fromEntries(orders.map(o=>[o.id,o.revision])),tanggal:'2026-10-09',jumlah:30000,metode:'transfer',withState:true});
 const first=paid.commerce.orders.find(o=>o.id==='group-o1');assert.ok(paid.commerce.orders.every(o=>o.totalPaid===10000));
 f.good('voidCommerceEvent',{id:'void-first-part',parentId:first.id,eventId:first.payments[0].id,expectedRevision:first.revision,tanggal:'2026-10-10',catatan:'Bagian pertama salah'});
 const state=f.state(),active=state.orders.filter(o=>o.id!=='group-o1'),revisions=Object.fromEntries(active.map(o=>[o.id,o.revision])),before=f.raw('CommerceEvent'),firstHistory=JSON.stringify(state.orders.find(o=>o.id==='group-o1').events);
 const correction={id:'correct-live-parts',groupId:'original-group',expectedRevisions:revisions,tanggal:'2026-10-11',jumlah:12000,metode:'cash',catatan:'Koreksi dua bagian aktif',withState:true};
 f.bad('gantiCommerceGroupPayment',correction,/owner/,'fixture-admin-token-001');
 f.bad('gantiCommerceGroupPayment',{...correction,expectedRevisions:{...revisions,'group-o2':'stale'}},/berubah/);
 assert.equal(f.raw('CommerceEvent').length,before.length);
 const fixed=f.good('gantiCommerceGroupPayment',correction),by=id=>fixed.commerce.orders.find(o=>o.id===id);
 assert.equal(by('group-o1').totalPaid,0);assert.equal(by('group-o1').balance,30000);assert.equal(JSON.stringify(by('group-o1').events),firstHistory);
 for(const id of ['group-o2','group-o3']){assert.equal(by(id).totalPaid,6000);assert.equal(by(id).balance,24000);assert.equal(by(id).payments.filter(e=>e.voided).length,1);assert.equal(by(id).payments.find(e=>!e.voided).groupId,'correct-live-parts');}
 const after=f.raw('CommerceEvent');assert.equal(after.length,before.length+4);for(const e of before)assert.deepEqual(after.find(x=>x.id===e.id),e,'original ledger row unchanged');
 f.good('gantiCommerceGroupPayment',correction);assert.equal(f.raw('CommerceEvent').length,after.length);
 for(const change of [{jumlah:12001},{tanggal:'2026-10-12'},{metode:'transfer'},{catatan:'changed'},{expectedRevisions:{...revisions,'group-o2':'changed'}}])f.bad('gantiCommerceGroupPayment',{...correction,...change},/sudah digunakan/);
 assert.equal(f.raw('CommerceEvent').length,after.length);
 const clear={id:'clear-live-group',groupId:'correct-live-parts',expectedRevisions:Object.fromEntries(fixed.commerce.orders.filter(o=>o.id!=='group-o1').map(o=>[o.id,o.revision])),jumlah:0,withState:true};
 const cleared=f.good('gantiCommerceGroupPayment',clear);assert.ok(cleared.commerce.orders.every(o=>o.totalPaid===0));f.good('gantiCommerceGroupPayment',clear);
 f.bad('gantiCommerceGroupPayment',{...clear,jumlah:100},/sudah digunakan/);f.bad('gantiCommerceGroupPayment',{...clear,groupId:'original-group'},/sudah digunakan|sudah dikoreksi/);
});
test('the split never invents or loses a rupiah and never pays an order beyond its balance',()=>{
 const f=fixture(),split=(amount,balances)=>JSON.parse(f.h.run(`JSON.stringify(coreCommerceSplit(${amount},${JSON.stringify(balances)}))`));
 assert.deepEqual(split(60000,[50000,10000]),[50000,10000]);assert.deepEqual(split(1,[50000,10000]),[1,0]);assert.deepEqual(split(10,[3,3,3,1]),[3,3,3,1]);
 for(const [amount,balances] of [[9999,[3333,3333,3334]],[7,[1,1,1,1,1,1,1,0]],[1000001,[999999,1,1,1]],[22580000,[10000000,4637288,382744,3042712,4517256]],[123456789,[987654321,123456789,5]]]){
  const shares=split(amount,balances);assert.equal(shares.reduce((n,s)=>n+s,0),amount);assert.ok(shares.every((s,i)=>Number.isInteger(s)&&s>=0&&s<=balances[i]),JSON.stringify(shares));
 }
 for(const [amount,balances] of [[0,[5,5]],[11,[5,5]],[-1,[5,5]],[1.5,[5,5]],[5,[]],[5,[5,-1]]])assert.equal(split(amount,balances),null);
});test('a purchase order entered here can be corrected after payments and receipts, never against what was paid or received',()=>{
 const f=fixture();f.masters();let o=f.good('saveCommerceOrder',{record:f.order({initialPayment:{jumlah:20000,tanggal:'2026-10-08',metode:'transfer'}})}).record;
 o=f.good('appendCommerceReceipt',{id:'rcv01',orderId:'order01',expectedRevision:o.revision,tanggal:'2026-10-09',itemId:'size01',jumlah:2,kondisi:'ok'}).record;
 assert.equal(o.totalPaid,20000);assert.equal(o.totalReceived,2);
 const edit=(record,rev=o.revision)=>({record:{...o,...record},expectedRevision:rev});
 /* price and quantities may change, a variant may be added, and the payments and receipts stay as they were */
 const fixed=f.good('saveCommerceOrder',edit({hargaSatuan:9000,items:[{id:'size01',nama:'M',jumlah:4},{id:'size02',nama:'L',jumlah:1},{id:'size03',nama:'XL',jumlah:2}],catatan:'harga dikoreksi'})).record;
 assert.equal(fixed.totalHarga,63000);assert.equal(fixed.totalPaid,20000);assert.equal(fixed.balance,43000);assert.equal(fixed.totalReceived,2);assert.equal(fixed.payments.length,1);assert.equal(fixed.receipts.length,1);assert.equal(fixed.productName,'Product Fixture');
 o=fixed;
 f.bad('saveCommerceOrder',edit({items:[{id:'size02',nama:'L',jumlah:5}]}),/sudah diterima/);f.bad('saveCommerceOrder',edit({items:[{id:'size01',nama:'M',jumlah:1},{id:'size02',nama:'L',jumlah:9}]}),/sudah diterima/);
 f.bad('saveCommerceOrder',edit({hargaSatuan:1000}),/sudah dibayar/);
 f.good('saveCommerceProduct',{record:{id:'product02',nama:'Other Product',supplierId:'supplier01'}});f.bad('saveCommerceOrder',edit({produkId:'product02'}),/Produk tidak dapat diganti/);
 f.bad('saveCommerceOrder',edit({catatan:'stale'},'old-revision'),/berubah/);
 /* a renamed master does not rewrite the identity frozen when the order was issued */
 const product=f.state().products.find(p=>p.id==='product01');f.good('saveCommerceProduct',{record:{...product,nama:'Renamed Later'},expectedRevision:product.revision});
 assert.equal(f.good('saveCommerceOrder',edit({catatan:'catatan baru'})).record.productName,'Product Fixture');
});
test('imported and held orders stay fixed, while the owner can remove a native order with its payments and receipts in one step',()=>{
 const f=fixture(),b=backup(),p=f.good('previewCommerceImport',{backup:b});f.good('applyCommerceImport',{backup:b,sourceHash:p.sourceHash,planHash:p.planHash});
 const legacy=f.state().orders.find(o=>o.id==='legacyOrder');f.bad('saveCommerceOrder',{record:{...legacy,catatan:'ubah'},expectedRevision:legacy.revision},/data lama|tidak sah/);f.bad('saveCommerceOrder',{record:{...legacy,items:[{id:'line1',nama:'M',jumlah:5}],catatan:'ubah'},expectedRevision:legacy.revision},/owner/,'fixture-admin-token-001');
 f.bad('cancelCommerceRecord',{module:'pembelian',id:'legacyOrder',expectedRevision:legacy.revision,catatan:'hapus',voidAll:true},/Periksa bukti|data lama|perlu diperiksa/);
 f.masters();let o=f.good('saveCommerceOrder',{record:f.order({initialPayment:{jumlah:20000,tanggal:'2026-10-08',metode:'transfer'}})}).record;
 o=f.good('appendCommercePayment',{id:'pay02',module:'pembelian',parentId:'order01',expectedRevision:o.revision,tanggal:'2026-10-09',jumlah:5000,metode:'cash'}).record;
 o=f.good('appendCommerceReceipt',{id:'rcv01',orderId:'order01',expectedRevision:o.revision,tanggal:'2026-10-09',itemId:'size01',jumlah:2,kondisi:'ok'}).record;
 const request={module:'pembelian',id:'order01',expectedRevision:o.revision,catatan:'tidak jadi order'};
 f.bad('cancelCommerceRecord',request,/terlebih dahulu/);f.bad('cancelCommerceRecord',{...request,voidAll:true},/owner/,'fixture-admin-token-001');
 const events=f.raw('CommerceEvent').length,gone=f.good('cancelCommerceRecord',{...request,voidAll:true,withState:true});
 assert.equal(gone.record.status,'batal');assert.equal(gone.record.totalPaid,0);assert.equal(gone.record.totalReceived,0);assert.equal(gone.record.balance,50000);
 assert.equal(gone.record.payments.length,2,'the payments stay in the ledger');assert.ok(gone.record.payments.every(e=>e.voided&&e.voidReason==='tidak jadi order'));assert.ok(gone.record.receipts.every(e=>e.voided));
 assert.equal(f.raw('CommerceEvent').length,events+3,'one correction per payment and receipt, the embedded first payment included');
 /* sending the same removal again changes nothing; the order cannot be edited or paid any more */
 f.good('cancelCommerceRecord',{...request,voidAll:true});assert.equal(f.raw('CommerceEvent').length,events+3);
 f.bad('saveCommerceOrder',{record:{...gone.record,catatan:'x'},expectedRevision:gone.record.revision},/dibatalkan/);f.bad('appendCommercePayment',{id:'pay03',module:'pembelian',parentId:'order01',expectedRevision:gone.record.revision,tanggal:'2026-10-09',jumlah:1000,metode:'cash'},/dibatalkan/);
});
test('the owner removes an imported or held order from the list with its old ledger untouched, and can bring it back',()=>{
 const f=fixture(),b=backup(),p=f.good('previewCommerceImport',{backup:b});f.good('applyCommerceImport',{backup:b,sourceHash:p.sourceHash,planHash:p.planHash});
 const legacy=f.state().orders.find(o=>o.id==='legacyOrder'),events=f.raw('CommerceEvent').length,request={module:'pembelian',id:'legacyOrder',expectedRevision:legacy.revision,catatan:'dobel dari aplikasi lama',arsip:true};
 f.bad('cancelCommerceRecord',request,/owner/,'fixture-admin-token-001');f.bad('cancelCommerceRecord',{...request,expectedRevision:'stale'},/berubah/);
 const gone=f.good('cancelCommerceRecord',request).record;assert.equal(gone.status,'batal');assert.equal(gone.cancelKeepsEvents,true);assert.equal(gone.totalPaid,legacy.totalPaid);assert.equal(gone.totalReceived,legacy.totalReceived);
 assert.equal(f.raw('CommerceEvent').length,events,'no correction is written against the old ledger');assert.deepEqual(gone.payments,legacy.payments);
 f.good('cancelCommerceRecord',request);assert.equal(f.raw('CommerceEvent').length,events);
 f.bad('restoreCommerceRecord',{module:'pembelian',id:'legacyOrder',expectedRevision:gone.revision},/owner/,'fixture-admin-token-001');f.bad('restoreCommerceRecord',{module:'pembelian',id:'legacyOrder',expectedRevision:'stale'},/berubah/);f.bad('restoreCommerceRecord',{module:'hpp',id:'legacyOrder',expectedRevision:gone.revision},/Modul/);
 const back=f.good('restoreCommerceRecord',{module:'pembelian',id:'legacyOrder',expectedRevision:gone.revision}).record;
 assert.equal(back.cancelled,undefined);assert.equal(back.cancelKeepsEvents,undefined);assert.equal(back.status,legacy.status);assert.equal(back.totalPaid,legacy.totalPaid);assert.equal(back.balance,legacy.balance);assert.equal(back.totalReceived,legacy.totalReceived);
 assert.equal(back.restoredFrom.reason,'dobel dari aplikasi lama');assert.equal(f.raw('CommerceEvent').length,events);assert.equal(f.good('restoreCommerceRecord',{module:'pembelian',id:'legacyOrder',expectedRevision:back.revision}).record.status,legacy.status);
 /* the shortcut is for old or held orders only: a native order with payments still needs voidAll, and comes back without them */
 f.masters();let o=f.good('saveCommerceOrder',{record:f.order({initialPayment:{jumlah:20000,tanggal:'2026-10-08',metode:'transfer'}})}).record;
 f.bad('cancelCommerceRecord',{module:'pembelian',id:'order01',expectedRevision:o.revision,catatan:'salah',arsip:true},/terlebih dahulu/);
 o=f.good('cancelCommerceRecord',{module:'pembelian',id:'order01',expectedRevision:o.revision,catatan:'salah',voidAll:true}).record;assert.equal(o.cancelKeepsEvents,undefined);
 o=f.good('restoreCommerceRecord',{module:'pembelian',id:'order01',expectedRevision:o.revision}).record;assert.equal(o.status,'pending');assert.equal(o.totalPaid,0);assert.equal(o.balance,50000);
});
test('group PDF preserves separate order ledgers and requires matching immutable supplier and selected revisions',()=>{
 const f=fixture();f.masters();let a=f.good('saveCommerceOrder',{record:f.order({catatan:'Print fixture'})}).record,b=f.good('saveCommerceOrder',{record:f.order({id:'order02'})}).record;
 f.h.run(`var originalCommerceEnv=pkEnv_,lastCommercePdf='';pkEnv_=function(){var e=originalCommerceEnv();e.makePdf=function(html){lastCommercePdf=html;return 'fixture-pdf';};return e;};void 0;`);
 const proof={[a.id]:a.revision,[b.id]:b.revision};const pdf=f.good('makeCommercePdf',{module:'pembelian',ids:[a.id,b.id],expectedRevisions:proof});assert.equal(pdf.base64,'fixture-pdf');assert.equal(f.h.run('(lastCommercePdf.match(/<article>/g)||[]).length'),2);assert.equal(f.h.run('lastCommercePdf.includes("Print fixture")'),true);
 f.bad('makeCommercePdf',{module:'pembelian',ids:[a.id,a.id]},/ganda/);f.bad('makeCommercePdf',{module:'nota',ids:[a.id]},/gabungan/);
 a=f.good('appendCommercePayment',{id:'print-payment',parentId:a.id,expectedRevision:a.revision,jumlah:10000}).record;f.bad('makeCommercePdf',{module:'pembelian',ids:[a.id,b.id],expectedRevisions:proof},/berubah/);
 f.good('saveCommerceSupplier',{record:{id:'supplier02',nama:'Supplier two'}});f.good('saveCommerceProduct',{record:{id:'product02',nama:'Product two',supplierId:'supplier02'}});const c=f.good('saveCommerceOrder',{record:f.order({id:'order03',produkId:'product02'})}).record;f.bad('makeCommercePdf',{module:'pembelian',ids:[a.id,c.id]},/supplier/);
});
test('purchase PDF identifies each frozen product independently of its variant and later master renames',()=>{
 const f=fixture();f.masters();const a=f.good('saveCommerceOrder',{record:f.order({items:[{id:'black',nama:'Hitam',jumlah:3}]})}).record;
 const product=f.state().products[0];f.good('saveCommerceProduct',{record:{...product,nama:'Later master rename'},expectedRevision:product.revision});
 f.good('saveCommerceProduct',{record:{id:'product-other',nama:'Second product',supplierId:'supplier01'}});
 const b=f.good('saveCommerceOrder',{record:f.order({id:'order-other',produkId:'product-other',items:[{id:'black-other',nama:'Hitam',jumlah:2}]})}).record;
 f.h.context.FROZEN_ORDER=f.state().orders.find(r=>r.id===a.id);
 const model=f.h.run(`coreCommerceSlipModel('pembelian',FROZEN_ORDER,{})`);
 assert.deepEqual(model.columns.map(c=>c.label),['Barang','Varian','Qty','Harga','Subtotal']);assert.equal(model.rows[0][0],'Product Fixture');assert.equal(model.rows[0][1],'Hitam');assert.equal(model.rows[0][2],'3');
 f.h.run(`var nameTestEnv=pkEnv_,nameTestPdf='';pkEnv_=function(){var e=nameTestEnv();e.makePdf=function(html){nameTestPdf=html;return 'fixture-pdf';};return e;};void 0;`);
 f.good('makeCommercePdf',{module:'pembelian',ids:[a.id,b.id]});const html=f.h.run('nameTestPdf'),articles=html.match(/<article>[\s\S]*?<\/article>/g);
 assert.equal(articles.length,2);assert.match(articles[0],/Product Fixture/);assert.match(articles[0],/Hitam/);assert.match(articles[1],/Second product/);assert.doesNotMatch(html,/Later master rename/);
 const unknown=f.h.run(`coreCommerceSlipModel('pembelian',{id:'legacy-missing',productSnapshot:{},productName:'Unproven current name',items:[{nama:'Hitam',jumlah:1}],hargaSatuan:10},{})`);
 assert.equal(unknown.rows[0][0],'Nama produk tidak tersedia');assert.equal(unknown.rows[0][1],'Hitam');
});

test('a purchase can be paid before its order date, alone or as a group, while a sales note still cannot be paid before its date',()=>{
 const f=fixture();f.masters();const a=f.good('saveCommerceOrder',{record:f.order({tanggalOrder:'2026-10-12'})}).record,b=f.good('saveCommerceOrder',{record:f.order({id:'order02',tanggalOrder:'2026-10-09',items:[{id:'only',nama:'M',jumlah:1}]})}).record;
 const satu=f.good('appendCommercePayment',{id:'early-pay-01',module:'pembelian',parentId:'order01',expectedRevision:a.revision,tanggal:'2026-10-10',jumlah:10000,metode:'transfer',catatan:'DP'}).record;
 assert.equal(satu.totalPaid,10000);assert.equal(satu.balance,40000);
 const grup=f.good('appendCommerceGroupPayment',{id:'early-group-01',module:'pembelian',orderIds:['order01','order02'],expectedRevisions:{order01:satu.revision,order02:b.revision},tanggal:'2026-10-08',jumlah:25000,metode:'transfer',catatan:'DP gabungan',withState:true});
 const o1=grup.commerce.orders.find(o=>o.id==='order01'),o2=grup.commerce.orders.find(o=>o.id==='order02');assert.equal(o1.totalPaid+o2.totalPaid,35000);
 f.good('appendCommerceReceipt',{id:'early-recv-01',orderId:'order01',expectedRevision:o1.revision,tanggal:'2026-10-10',itemId:'size01',jumlah:1,kondisi:'ok'});
 /* the order itself can still be corrected, also to a later date than its first payment */
 const kini=f.state().orders.find(o=>o.id==='order01');f.good('saveCommerceOrder',{record:f.order({tanggalOrder:'2026-10-13'}),expectedRevision:kini.revision});
 const nota=f.good('saveCommerceNota',{record:{id:'nota-early-1',date:'2026-10-12',customer:{name:'Fixture'},items:[{id:'n1',name:'Shirt',qty:1,price:50000}]}}).record;
 f.bad('appendCommercePayment',{id:'early-pay-02',module:'nota',parentId:'nota-early-1',expectedRevision:nota.revision,tanggal:'2026-10-10',jumlah:10000,metode:'cash'},/sebelum/);
});

test('a recorded payment or receipt is changed in one step: the old entry stays as corrected history and the new one counts',()=>{
 const f=fixture();f.masters();let o=f.good('saveCommerceOrder',{record:f.order()}).record;
 o=f.good('appendCommercePayment',{id:'pay-edit-01',module:'pembelian',parentId:'order01',expectedRevision:o.revision,tanggal:'2026-10-09',jumlah:20000,metode:'transfer',catatan:'DP'}).record;
 o=f.good('appendCommerceReceipt',{id:'recv-edit-01',orderId:'order01',expectedRevision:o.revision,tanggal:'2026-10-10',itemId:'size01',jumlah:3,kondisi:'ok'}).record;
 const ubah={id:'pay-edit-02',module:'pembelian',parentId:'order01',eventId:'pay-edit-01',expectedRevision:o.revision,tanggal:'2026-10-07',jumlah:35000,metode:'cash',catatan:'DP dikoreksi'};
 f.bad('gantiCommerceEvent',ubah,/owner/,'fixture-admin-token-001');f.bad('gantiCommerceEvent',{...ubah,jumlah:50001},/melebihi sisa/);f.bad('gantiCommerceEvent',{...ubah,eventId:'missing-event'},/tidak ditemukan/);f.bad('gantiCommerceEvent',{...ubah,expectedRevision:'old'},/berubah/);
 let s=f.good('gantiCommerceEvent',ubah).record;assert.equal(s.totalPaid,35000);assert.equal(s.balance,15000);
 assert.deepEqual(s.payments.map(e=>[e.id,e.jumlah,e.tanggal,e.metode,!!e.voided]),[['pay-edit-01',20000,'2026-10-09','transfer',true],['pay-edit-02',35000,'2026-10-07','cash',false]]);
 assert.equal(f.raw('CommerceEvent').length,4,'two entries, one correction and the replacement');
 assert.equal(f.good('gantiCommerceEvent',ubah).record.totalPaid,35000,'the same request again changes nothing');assert.equal(f.raw('CommerceEvent').length,4);
 f.bad('gantiCommerceEvent',{...ubah,id:'pay-edit-03',expectedRevision:s.revision},/tidak ditemukan atau telah dibatalkan/);
 /* a receipt: fewer pieces than first written, and never more than the variant ordered */
 const terima={id:'recv-edit-02',module:'pembelian',parentId:'order01',eventId:'recv-edit-01',expectedRevision:s.revision,tanggal:'2026-10-10',jumlah:2,itemId:'size01',kondisi:'ok',catatan:''};
 f.bad('gantiCommerceEvent',{...terima,jumlah:4},/melebihi sisa varian/);
 s=f.good('gantiCommerceEvent',terima).record;assert.equal(s.totalReceived,2);assert.deepEqual(s.receivedByItem,{size01:2});
 assert.deepEqual(s.receipts.map(e=>[e.id,e.jumlah,!!e.voided]),[['recv-edit-01',3,true],['recv-edit-02',2,false]]);
});

test('partial receipt 290 of 300 can be corrected and completed by 10 with all history retained and DP unchanged',()=>{
 const f=fixture();f.masters();let order=f.good('saveCommerceOrder',{record:f.order({items:[{id:'size-M',nama:'M',jumlah:300}],hargaSatuan:1000,initialPayment:{jumlah:100000,metode:'transfer'}})}).record;
 const payments=JSON.stringify(order.payments),receive={id:'receive-290',orderId:order.id,expectedRevision:order.revision,tanggal:'2026-10-09',itemId:'size-M',jumlah:290,kondisi:'baik',catatan:'Datang sebagian'};
 order=f.good('appendCommerceReceipt',receive).record;assert.equal(order.totalReceived,290);assert.equal(order.totalQty-order.totalReceived,10);assert.equal(order.totalPaid,100000);assert.equal(order.balance,200000);const originalEvents=f.raw('CommerceEvent');
 f.good('appendCommerceReceipt',receive);assert.equal(f.raw('CommerceEvent').length,1);
 f.bad('appendCommerceReceipt',{...receive,id:'too-many',expectedRevision:order.revision,jumlah:11},/melebihi/);
 const correct={id:'receive-correct-285',parentId:order.id,eventId:'receive-290',expectedRevision:order.revision,tanggal:'2026-10-10',itemId:'size-M',jumlah:285,kondisi:'baik',catatan:'Hitung ulang pertama'};
 f.bad('gantiCommerceEvent',correct,/owner/,'fixture-admin-token-001');f.bad('gantiCommerceEvent',{...correct,expectedRevision:'stale'},/berubah/);
 order=f.good('gantiCommerceEvent',correct).record;assert.equal(order.totalReceived,285);assert.equal(order.receivedByItem['size-M'],285);assert.equal(order.totalQty-order.totalReceived,15);assert.equal(order.receipts.find(e=>e.id==='receive-290').voided,true);
 f.good('gantiCommerceEvent',correct);assert.equal(f.raw('CommerceEvent').length,3);
 for(const changed of [{jumlah:286},{itemId:'other-size'},{tanggal:'2026-10-11'},{kondisi:'cacat'},{catatan:'different'},{eventId:'receive-correct-285'}])f.bad('gantiCommerceEvent',{...correct,...changed},/sudah digunakan/);
 const finalCount={id:'receive-correct-290',parentId:order.id,eventId:'receive-correct-285',expectedRevision:order.revision,tanggal:'2026-10-10',itemId:'size-M',jumlah:290,kondisi:'baik',catatan:'Hitungan final'};
 f.bad('gantiCommerceEvent',{...finalCount,jumlah:301},/melebihi/);order=f.good('gantiCommerceEvent',finalCount).record;assert.equal(order.totalReceived,290);
 const rest={id:'receive-last-10',orderId:order.id,expectedRevision:order.revision,tanggal:'2026-10-11',itemId:'size-M',jumlah:10,kondisi:'baik',catatan:'Sisa pesanan'};
 order=f.good('appendCommerceReceipt',rest).record;assert.equal(order.totalReceived,300);assert.equal(order.totalQty-order.totalReceived,0);assert.equal(order.receiptReview,false);assert.deepEqual(order.receivedByItem,{'size-M':300});
 assert.deepEqual(order.receipts.map(e=>[e.id,e.jumlah,!!e.voided]),[['receive-290',290,true],['receive-correct-285',285,true],['receive-correct-290',290,false],['receive-last-10',10,false]]);
 assert.equal(JSON.stringify(order.payments),payments);assert.equal(order.totalPaid,100000);assert.equal(order.balance,200000);const finalEvents=f.raw('CommerceEvent');assert.equal(finalEvents.length,6);assert.deepEqual(finalEvents.find(e=>e.id==='receive-290'),originalEvents[0]);
 f.good('appendCommerceReceipt',rest);f.good('gantiCommerceEvent',finalCount);f.good('gantiCommerceEvent',correct);assert.equal(f.raw('CommerceEvent').length,6,'all original requests replay without receipt duplication');
 f.bad('appendCommerceReceipt',{...rest,id:'one-too-many',expectedRevision:order.revision,jumlah:1},/melebihi/);f.bad('gantiCommerceEvent',{...finalCount,id:'concurrent-correction'},/berubah/);
});

test('event correction retry must match both the immutable source and complete void/replacement pair',()=>{
 const f=fixture();f.masters();let order=f.good('saveCommerceOrder',{record:f.order()}).record;
 order=f.good('appendCommercePayment',{id:'original-DP',parentId:order.id,expectedRevision:order.revision,tanggal:'2026-10-09',jumlah:10000,metode:'transfer'}).record;
 const correct={id:'corrected-DP',parentId:order.id,eventId:'original-DP',expectedRevision:order.revision,tanggal:'2026-10-10',jumlah:12000,metode:'cash',catatan:'Koreksi bukti'};
 f.good('gantiCommerceEvent',correct);for(const change of [{jumlah:13000},{metode:'transfer'},{tanggal:'2026-10-11'},{catatan:'different'},{eventId:'corrected-DP'}])f.bad('gantiCommerceEvent',{...correct,...change},/sudah digunakan/);
 assert.equal(f.raw('CommerceEvent').length,3);f.good('gantiCommerceEvent',correct);assert.equal(f.raw('CommerceEvent').length,3);
 /* A standalone payment that happens to have this ID is not evidence that a correction finished. */
 f.bad('gantiCommerceEvent',{...correct,id:'original-DP',eventId:'corrected-DP',jumlah:10000,metode:'transfer',tanggal:'2026-10-09',catatan:''},/sudah digunakan/);
 f.h.run("pkStore_().lock(function(){var s=pkStore_();s.replaceAll('CommerceEvent',s.read('CommerceEvent').filter(function(e){return e.kind!=='void';}));});void 0;");
 const incomplete=JSON.stringify(f.raw('CommerceEvent'));f.bad('gantiCommerceEvent',correct,/sudah digunakan/);assert.equal(JSON.stringify(f.raw('CommerceEvent')),incomplete,'an incomplete correction never returns a false successful retry or writes another receipt');
});
