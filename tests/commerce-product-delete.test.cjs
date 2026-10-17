'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');

function fixture(){
 const h=harness();for(const name of ['reconcile-legacy','commerce-hpp','slip-models','commerce','commerce-migration'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src',name+'.js'),'utf8'),h.context);
 const setup=h.request('setupOwner',{nama:'Fixture Owner',pin:'1234'});assert.equal(setup.ok,true,setup.error);const owner=setup.data.token;
 h.run("pkStore_().lock(function(){pkStore_().appendMany('Pegawai',[{id:'adminfixture',nama:'Fixture Admin',divisi:'admin',aktif:true,token:'fixture-admin-token-001'},{id:'workerfixture',nama:'Fixture Worker',divisi:'qc',aktif:true,token:'fixture-worker-token-001'},{id:'owner2fixture',nama:'Other Owner',divisi:'owner',aktif:true,token:'fixture-owner2-token-001'}]);});void 0;");
 function call(action,p={},token=owner){h.cold();return h.request(action,{token,workflowVersion:2,...p});}
 function good(action,p={},token=owner){const r=call(action,p,token);assert.equal(r.ok,true,r.error);return r.data;}
 function bad(action,p={},regex,token=owner){const r=call(action,p,token);assert.equal(r.ok,false,'must reject');if(regex)assert.match(r.error,regex);return r;}
 function raw(table){h.cold();return h.run('pkStore_().fresh('+JSON.stringify(table)+');pkStore_().read('+JSON.stringify(table)+')');}
 function state(){return good('getCommerceState',{module:'pembelian'});}
 function masters(){good('saveCommerceSupplier',{record:{id:'supplier',nama:'Supplier'}});return good('saveCommerceProduct',{record:product()}).record;}
 return {h,good,bad,raw,state,masters};
}
function product(extra={}){return {id:'product',nama:'Topi Fixture',supplierId:'supplier',model:'Logo',warna:'Hitam',harga:1000,gambar:'data:image/png;base64,AAAA',...extra};}
function order(extra={}){return {id:'order',produkId:'product',items:[{id:'m',nama:'M',jumlah:300}],hargaSatuan:1000,tanggalOrder:'2026-10-08',...extra};}
function requestDelete(row,extra={}){return {id:row.id,expectedRevision:row.revision,...extra};}

test('owner removes either active or inactive catalog products while preserving their identity and picture',()=>{
 for(const active of [true,false]){
  const f=fixture();let p=f.masters();if(!active)p=f.good('saveCommerceProduct',{record:{...p,aktif:false},expectedRevision:p.revision}).record;
  const source=f.raw('CommerceRecord').find(r=>r.kind==='product'),out=f.good('deleteCommerceProduct',requestDelete(p,{withState:true}));
  assert.equal(out.record.deleted,true);assert.equal(out.record.aktif,false);assert.equal(out.record.deletedFromRevision,p.revision);assert.equal(out.record.deletedBy,out.commerce.actor.id);assert.ok(out.record.deletedAt);assert.notEqual(out.record.revision,p.revision);
  const stored=f.raw('CommerceRecord').find(r=>r.kind==='product');assert.equal(stored.id,source.id);assert.equal(stored.dibuat,source.dibuat);assert.equal(stored.dibuatOleh,source.dibuatOleh);assert.equal(JSON.parse(stored.data).gambar,product().gambar);assert.equal(f.state().products.length,1,'tombstone retains references for historical orders');
  assert.deepEqual(f.good('getCommerceImages',{items:[{id:p.id,rev:out.record.revision.slice(0,16)}]}).images,{product:product().gambar});
 }
});

test('delete requires current owner, current workflow and current product revision',()=>{
 const f=fixture(),p=f.masters(),before=JSON.stringify(f.raw('CommerceRecord'));
 f.bad('deleteCommerceProduct',requestDelete(p),/owner/,'fixture-admin-token-001');f.bad('deleteCommerceProduct',requestDelete(p),/owner/,'fixture-worker-token-001');
 for(const expectedRevision of ['',undefined,'stale'])f.bad('deleteCommerceProduct',requestDelete(p,{expectedRevision}),/berubah/);
 f.bad('deleteCommerceProduct',requestDelete(p,{workflowVersion:1}),/Versi/);f.bad('deleteCommerceProduct',requestDelete(p,{clientVersion:'1.5.32'}),/versi|Muat|muat/);
 f.bad('deleteCommerceProduct',{id:'absent',expectedRevision:p.revision},/tidak ditemukan/);assert.equal(JSON.stringify(f.raw('CommerceRecord')),before);
 f.h.run("pkStore_().lock(function(){pkStore_().update('Pegawai','owner2fixture',{aktif:false});});void 0;");f.bad('deleteCommerceProduct',requestDelete(p),/aktif|sesi|masuk/i,'fixture-owner2-token-001');
});

test('concurrent product edits fence deletion and deleted products cannot be revived by stale edits or creation replay',()=>{
 const f=fixture(),p=f.masters(),edited=f.good('saveCommerceProduct',{record:{...p,nama:'Corrected name'},expectedRevision:p.revision}).record;
 f.bad('deleteCommerceProduct',requestDelete(p),/berubah/);const deletion=requestDelete(edited),removed=f.good('deleteCommerceProduct',deletion).record,before=JSON.stringify(f.raw('CommerceRecord'));
 for(const input of [{record:product()},{record:{...edited,aktif:true},expectedRevision:edited.revision},{record:{...removed,deleted:false,aktif:true},expectedRevision:removed.revision}])f.bad('saveCommerceProduct',input,/sudah dihapus/);
 f.good('deleteCommerceProduct',deletion);f.bad('deleteCommerceProduct',requestDelete(removed),/sudah dihapus/);f.bad('deleteCommerceProduct',deletion,/sudah dihapus/,'fixture-owner2-token-001');assert.equal(JSON.stringify(f.raw('CommerceRecord')),before);
});

test('lost response after deletion recovers by exact retry without a second physical write',()=>{
 const f=fixture(),p=f.masters(),sheet=f.h.sheets.CommerceRecord,original=sheet.getRange;let thrown=false;
 sheet.getRange=function(...args){const range=original.apply(this,args),write=range.setValues;range.setValues=function(rows){const result=write.call(this,rows);if(!thrown&&args[0]>1){thrown=true;throw Error('simulated response interruption after delete');}return result;};return range;};
 const intent=requestDelete(p);f.bad('deleteCommerceProduct',intent,/interruption/);sheet.getRange=original;const writes=sheet.writes;
 const out=f.good('deleteCommerceProduct',intent);assert.equal(out.record.deleted,true);assert.equal(sheet.writes,writes);assert.equal(f.raw('CommerceEvent').length,0);
});

test('deletion does not change orders, DP, receipts, invoice totals, or production records',()=>{
 const f=fixture(),p=f.masters();let o=f.good('saveCommerceOrder',{record:order({initialPayment:{jumlah:100000,tanggal:'2026-10-08',metode:'transfer'}})}).record;
 o=f.good('appendCommerceReceipt',{id:'receive290',orderId:o.id,expectedRevision:o.revision,itemId:'m',jumlah:290,tanggal:'2026-10-10'}).record;
 const before={orders:JSON.stringify(f.state().orders),events:JSON.stringify(f.raw('CommerceEvent')),production:JSON.stringify(f.raw('PO')),sources:JSON.stringify(f.raw('CommerceSource'))};
 f.good('deleteCommerceProduct',requestDelete(p));assert.equal(JSON.stringify(f.state().orders),before.orders);assert.equal(JSON.stringify(f.raw('CommerceEvent')),before.events);assert.equal(JSON.stringify(f.raw('PO')),before.production);assert.equal(JSON.stringify(f.raw('CommerceSource')),before.sources);
 o=f.good('saveCommerceOrder',{record:{...o,catatan:'Correct existing order'},expectedRevision:o.revision}).record;assert.equal(o.productSnapshot.nama,'Topi Fixture');assert.equal(o.totalPaid,100000);assert.equal(o.totalReceived,290);
 o=f.good('appendCommerceReceipt',{id:'receive10',orderId:o.id,expectedRevision:o.revision,itemId:'m',jumlah:10,tanggal:'2026-10-11'}).record;
 o=f.good('appendCommercePayment',{id:'finalPayment',parentId:o.id,expectedRevision:o.revision,jumlah:200000,tanggal:'2026-10-11',metode:'transfer'}).record;assert.equal(o.status,'selesai');assert.equal(o.totalReceived,300);assert.equal(o.balance,0);
});

test('new single and batch orders cannot select a deleted product and a rejected batch writes nothing',()=>{
 const f=fixture(),p=f.masters();f.good('saveCommerceProduct',{record:product({id:'otherProduct',nama:'Other product'})});f.good('deleteCommerceProduct',requestDelete(p));
 const before=JSON.stringify(f.raw('CommerceRecord'));f.bad('saveCommerceOrder',{record:order()},/tidak aktif|dihapus/);
 f.bad('saveCommerceOrderBatch',{id:'batch',supplierId:'supplier',tanggalOrder:'2026-10-10',orders:[{...order({id:'orderA',produkId:'otherProduct'})},{...order({id:'orderB'})}],initialPayment:{jumlah:1000,tanggal:'2026-10-10',metode:'transfer'}},/tidak aktif|dihapus/);
 assert.equal(JSON.stringify(f.raw('CommerceRecord')),before);assert.equal(f.raw('CommerceEvent').length,0);
});

test('an already-created invoice retries safely after catalog deletion without recreating models or DP',()=>{
 const f=fixture(),p=f.masters(),intent={id:'batch',supplierId:'supplier',tanggalOrder:'2026-10-10',orders:[order()],initialPayment:{jumlah:1000,tanggal:'2026-10-10',metode:'transfer'}};
 const initial=f.good('saveCommerceOrderBatch',intent);f.good('deleteCommerceProduct',requestDelete(p));const before=JSON.stringify(f.raw('CommerceRecord')),out=f.good('saveCommerceOrderBatch',intent);assert.deepEqual(out,initial);assert.equal(JSON.stringify(f.raw('CommerceRecord')),before);assert.equal(f.raw('CommerceEvent').length,0);
});

test('legacy product deletion preserves import evidence and allows existing order corrections without snapshots',()=>{
 const f=fixture(),backup={soldier_pembelian_produk:{suppliers:[{id:'legacySupplier',nama:'Legacy supplier'}],produk:[{id:'legacyProduct',nama:'Legacy hat',supplierId:'legacySupplier',gambar:'data:image/png;base64,AAAA'}],orders:[{id:'legacyOrder',produkId:'legacyProduct',tanggalOrder:'2026-09-01',items:[{id:'m',nama:'M',jumlah:5}],hargaSatuan:1000,totalHarga:5000,pembayaran:[{id:'oldPay',tanggal:'2026-09-01',jumlah:1000}]}]}};
 const preview=f.good('previewCommerceImport',{backup});f.good('applyCommerceImport',{backup,sourceHash:preview.sourceHash,planHash:preview.planHash});
 const state=f.state(),p=state.products[0],o=state.orders[0],source=JSON.stringify(f.raw('CommerceSource')),events=JSON.stringify(f.raw('CommerceEvent'));
 const removed=f.good('deleteCommerceProduct',requestDelete(p)).record;assert.equal(removed.legacy,true);assert.equal(f.state().orders[0].productName,'Legacy hat');assert.equal(JSON.stringify(f.raw('CommerceSource')),source);assert.equal(JSON.stringify(f.raw('CommerceEvent')),events);
 // The original importer can leave old orders without product/supplier snapshots.
 const updated=f.good('saveCommerceOrder',{record:{...o,catatan:'Fix old order notes'},expectedRevision:o.revision}).record;assert.equal(updated.productName,'Legacy hat');assert.equal(updated.totalPaid,1000);assert.equal(updated.balance,4000);assert.equal(JSON.stringify(f.raw('CommerceSource')),source);assert.equal(JSON.stringify(f.raw('CommerceEvent')),events);
});
