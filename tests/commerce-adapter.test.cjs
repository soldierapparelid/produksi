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
 function order(extra={}){return {id:'order01',produkId:'product01',items:[{id:'size01',nama:'M',jumlah:3},{id:'size02',nama:'L',jumlah:2}],hargaSatuan:10000,tanggalOrder:'2026-10-08',...extra};}
 function state(module='pembelian'){return good('getCommerceState',{module});}
 return {h,owner,call,good,bad,raw,masters,order,state};
}
function backup(){return {
 soldier_pembelian_produk:{suppliers:[{id:'legacySupplier',nama:'Old supplier'}],produk:[{id:'legacyProduct',nama:'Old product',supplierId:'legacySupplier',_hasImg:true}],orders:[{id:'legacyOrder',produkId:'legacyProduct',tanggalOrder:'2026-09-01',items:[{nama:'M',jumlah:5}],hargaSatuan:10000,totalHarga:50000,dp:10000,pembayaran:[{id:'pay-old',tanggal:'2026-09-01',jumlah:10000,metode:'cash'}],penerimaan:[{id:'received-old',tanggal:'2026-09-02',itemId:'missing-item-id',jumlah:3,kondisi:'baik'}]}]},
 soldier_hpp_cache_v1:{configs:{sku01:{hargaJahit:1200}},modelConfigs:{},marketplace:{shopee:{nama:'Shop',fee:10,fixedPerPcs:1000}},pajak:1},
 produksi:{produksi:[{id:'sku01',nama:'Old shirt',size:'M'}],cuttingPlans:[]},
 notaPenjualan_v1:{transactions:[{id:'SA-261001-1',date:'2026-10-01T12:00:00Z',customer:{name:'Fixture customer'},items:[{id:'old-note-line',name:'Shirt',qty:1,price:90000,subtotal:90000}],total:90000,subtotal:90000,payment:{method:'cash',amount:100000,change:10000,status:'lunas'}}]}
};}
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
 f.bad('appendCommerceGroupPayment',{...request,id:'group-pay-02',expectedRevisions:now,jumlah:30000},/melebihi sisa/);f.bad('appendCommerceGroupPayment',{...request,id:'group-pay-02',expectedRevisions:now,tanggal:'2026-10-01'},/sebelum/);
 f.bad('appendCommerceGroupPayment',{...request,id:'group-pay-02',expectedRevisions:now},/owner|admin/,'fixture-cutter-token-001');f.bad('appendCommerceGroupPayment',{...request,id:'group-pay-02',expectedRevisions:now,orderIds:['order01','order01']},/ganda/);
 const rest=f.good('appendCommerceGroupPayment',{...request,id:'group-pay-02',expectedRevisions:now,jumlah:29999,withState:true});
 assert.ok(rest.commerce.orders.every(o=>o.balance===0&&o.totalPaid===o.totalHarga));assert.equal(f.raw('CommerceEvent').length,4);
 /* each share stays an ordinary payment: the owner can correct one without touching the other */
 const one=rest.commerce.orders.find(o=>o.id==='order02'),share=one.payments.find(e=>e.groupId==='group-pay-02');
 const fixed=f.good('voidCommerceEvent',{id:'void-share',module:'pembelian',parentId:'order02',eventId:share.id,expectedRevision:one.revision,tanggal:'2026-10-09',catatan:'salah catat',withState:true});
 assert.equal(fixed.commerce.orders.find(o=>o.id==='order02').balance,5000);assert.equal(fixed.commerce.orders.find(o=>o.id==='order01').balance,0);
});
test('the split never invents or loses a rupiah and never pays an order beyond its balance',()=>{
 const f=fixture(),split=(amount,balances)=>JSON.parse(f.h.run(`JSON.stringify(coreCommerceSplit(${amount},${JSON.stringify(balances)}))`));
 assert.deepEqual(split(60000,[50000,10000]),[50000,10000]);assert.deepEqual(split(1,[50000,10000]),[1,0]);assert.deepEqual(split(10,[3,3,3,1]),[3,3,3,1]);
 for(const [amount,balances] of [[9999,[3333,3333,3334]],[7,[1,1,1,1,1,1,1,0]],[1000001,[999999,1,1,1]],[22580000,[10000000,4637288,382744,3042712,4517256]],[123456789,[987654321,123456789,5]]]){
  const shares=split(amount,balances);assert.equal(shares.reduce((n,s)=>n+s,0),amount);assert.ok(shares.every((s,i)=>Number.isInteger(s)&&s>=0&&s<=balances[i]),JSON.stringify(shares));
 }
 for(const [amount,balances] of [[0,[5,5]],[11,[5,5]],[-1,[5,5]],[1.5,[5,5]],[5,[]],[5,[5,-1]]])assert.equal(split(amount,balances),null);
});test('group PDF preserves separate order ledgers and requires matching immutable supplier and selected revisions',()=>{
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
