'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
// Reuse the established browser-free UI harness declarations, without registering its tests.
const harnessSource=fs.readFileSync(path.join(__dirname,'ui-nota-settlement.test.cjs'),'utf8').split('\nfunction nota(')[0];
const harness=new Function('require','__dirname',harnessSource+'\nreturn harness;')(require,__dirname);
function order(id,invoice='invoice-A',extra={}){return {id,invoiceId:invoice,grupNama:invoice,revision:'rev-'+id,status:'selesai',tanggalOrder:'2026-10-17',productName:'Model '+id,produkId:'prod-'+id,supplierSnapshot:{id:'supplier',nama:'Supplier'},supplierName:'Supplier',items:[{id:'item-'+id,nama:'Hitam',jumlah:10}],receivedByItem:{['item-'+id]:10},totalQty:10,totalReceived:10,totalHarga:100000,totalPaid:100000,balance:0,payments:[{id:'pay-'+id,jumlah:100000,tanggal:'2026-10-16'}],receipts:[{id:'receipt-'+id,itemId:'item-'+id,jumlah:10,tanggal:'2026-10-17'}],events:[],...extra};}
function nota(id,extra={}){return {id,noNota:'NOTA-'+id,revision:'rev-'+id,date:'2026-10-17',status:'lunas',customer:{name:'Customer '+id},items:[{id:'item-'+id,name:'Topi',qty:10,price:10000,subtotal:100000}],total:100000,totalPaid:100000,balance:0,payments:[{id:'pay-'+id,jumlah:100000,tanggal:'2026-10-17'}],events:[],...extra};}
function el(module,ids,hidden=true){return '({getAttribute:function(k){return '+JSON.stringify({'data-m':module,'data-ids':ids.join(','),'data-hidden':hidden?'1':'0','data-id':ids[0]})+'[k]||null;}})';}
function seed(h,module,rows){h.seed(module,module==='nota'?{notes:rows}:{orders:rows,products:[],suppliers:[]});}
function state(module,rows,version=11){return {module,actor:{id:'owner',divisi:'owner'},version,data:module==='nota'?{notes:rows}:{orders:rows,products:[],suppliers:[]}};}
function hide(h,module,ids,hidden=true){h.run('A.commerceHistoryOpen('+el(module,ids,hidden)+')');}

test('owner sees removable completed invoices and cancelled orders; active invoices have no removal action',()=>{
 const h=harness();seed(h,'pembelian',[order('done'),order('cancel','invoice-old',{status:'batal',cancelled:true}),order('active','invoice-new',{totalPaid:0,balance:100000,totalReceived:0,status:'pending'})]);
 h.run("S.sub.commercePurchase='orders';VIEWS['pembelian-produk']()");assert.doesNotMatch(h.run('S.listFn()'),/commerceHistoryOpen|data-ids="done"/);
 const view=h.run("S.sub.commercePurchase='history';VIEWS['pembelian-produk']()");assert.match(view,/value="sampah">Sampah/);assert.match(h.run('S.listFn()'),/data-ids="done" data-hidden="1">Hapus dari riwayat/);assert.match(h.run('S.listFn()'),/data-ids="cancel" data-hidden="1">Hapus dari riwayat/);assert.doesNotMatch(h.run('S.listFn()'),/data-ids="active"/);assert.equal(h.requests.length,0);
});

test('nota paid, manual archives and already cancelled entries can be hidden by owner without cancelling again',()=>{
 const h=harness();seed(h,'nota',[nota('paid'),nota('manual',{archived:true,totalPaid:0,balance:100000}),nota('cancel',{cancelled:true,status:'batal',totalPaid:0,balance:100000}),nota('active',{totalPaid:0,balance:100000})]);
 h.run("S.sub.commerceNota='history';VIEWS.nota()");const list=h.run('S.listFn()');for(const id of ['paid','manual','cancel'])assert.match(list,new RegExp('data-ids="'+id+'" data-hidden="1">Hapus dari riwayat'));assert.doesNotMatch(list,/data-id="active"/);
 hide(h,'nota',['cancel']);assert.match(h.run('lastSheet'),/Pembayaran, tanggal, jumlah, harga, dan penerimaan barang tetap tersimpan tanpa perubahan/);assert.equal(h.requests.length,0);h.run('A.commerceHistorySave(null)');assert.equal(h.requests[0].action,'setCommerceHistoryVisibility');assert.equal(h.requests[0].payload.hidden,true);assert.equal(h.requests[0].payload.expectedRevisions.cancel,'rev-cancel');
});

test('non-owner cannot hide, see Sampah filter or restore through stale controls',()=>{
 const h=harness();h.run("S.state.me.divisi='admin';S.sub.commerceNota='history'");seed(h,'nota',[nota('paid'),nota('hidden',{historyHidden:true})]);seed(h,'pembelian',[order('done')]);const note=h.run('VIEWS.nota()');assert.doesNotMatch(note,/commerceHistoryOpen|value="sampah"/);hide(h,'nota',['paid']);hide(h,'nota',['hidden'],false);assert.equal(h.run('lastSheet'),'');assert.equal(h.requests.length,0);
 h.run("S.sub.commercePurchase='history'");assert.doesNotMatch(h.run("VIEWS['pembelian-produk']()"),/commerceHistoryOpen|value="sampah"/);
});

test('hidden history is absent from active, normal history, payment totals, merge and print choices; Sampah only offers restore',()=>{
 const h=harness();const rows=[order('visible','visible'),order('hidden','hidden',{historyHidden:true})];seed(h,'pembelian',rows);const before=h.json("commerceData('pembelian').orders");h.run("S.sub.commercePurchase='history';VIEWS['pembelian-produk']()");assert.doesNotMatch(h.run('S.listFn()'),/Model hidden/);assert.equal(h.json("commercePurchaseTotals(commerceData('pembelian').orders)").total,100000);assert.equal(h.json("commerceRiwayatRows(commerceData('pembelian').orders,true)").length,1);assert.equal(h.json("commerceMergeGroups(commerceData('pembelian').orders)").length,1);assert.throws(()=>h.run("commerceInvoiceSelection(['hidden'])"),/Sampah/);assert.deepEqual(h.json("commerceInvoiceOrders(['hidden'])"),[]);
 h.run("S.f['commerceStatus-pembelianHistory']='sampah'");const trash=h.run('S.listFn()');assert.match(trash,/Model hidden/);assert.match(trash,/Pulihkan riwayat/);assert.doesNotMatch(trash,/commerceInvoiceOpen|commercePaymentOpen|commerceShareOpen|commerceOrderOpen|commerceCancelOpen/);assert.deepEqual(h.json("commerceData('pembelian').orders"),before);assert.equal(h.requests.length,0);
 seed(h,'nota',[nota('hidden',{historyHidden:true}),nota('normal')]);h.run("S.sub.commerceNota='history';VIEWS.nota()");assert.doesNotMatch(h.run('S.listFn()'),/NOTA-hidden/);h.run("S.f['commerceStatus-notaHistory']='sampah'");assert.match(h.run('S.listFn()'),/NOTA-hidden/);assert.doesNotMatch(h.run('S.listFn()'),/commerceNotaDetail|commerceNotaCetak/);
});

test('complete invoice selection must remain whole and invoice-scoped, while a cancelled child can be removed alone',()=>{
 const h=harness();seed(h,'pembelian',[order('a'),order('b'),order('other','invoice-B'),order('cancel','invoice-C',{cancelled:true,status:'batal'}),order('active','invoice-C',{totalPaid:0,balance:100000,status:'pending'})]);
 assert.throws(()=>h.run("commerceHistorySelection('pembelian',['a'],true)"),/lengkap/);assert.throws(()=>h.run("commerceHistorySelection('pembelian',['a','b','other'],true)"),/satu invoice/);assert.throws(()=>h.run("commerceHistorySelection('pembelian',['active'],true)"),/Status/);assert.equal(h.json("commerceHistorySelection('pembelian',['cancel'],true)").length,1);
 hide(h,'pembelian',['a','b']);assert.deepEqual(h.json('currentForm._commerceHistory.ids'),['a','b']);assert.equal(h.requests.length,0);h.run('A.commerceHistorySave(null)');h.run('A.commerceHistorySave(null)');assert.equal(h.requests.length,1);assert.deepEqual(Array.from(h.requests[0].payload.ids),['a','b']);assert.equal(h.requests[0].payload.expectedRevisions.a,'rev-a');assert.equal(h.requests[0].payload.withState,true);
});

test('changed revisions prevent confirmation and per-variant receipt mismatch is not eligible',()=>{
 const h=harness();seed(h,'pembelian',[order('a')]);hide(h,'pembelian',['a']);seed(h,'pembelian',[order('a','invoice-A',{revision:'new-revision'})]);h.run('A.commerceHistorySave(null)');assert.equal(h.requests.length,0);assert.match(h.json('messages').at(-1).text,/berubah sejak/);
 seed(h,'pembelian',[order('bad','invoice-A',{receivedByItem:{'item-bad':9}})]);assert.equal(h.run("commerceHistoryEligible('pembelian',commerceFind('pembelian','orders','bad'))"),false);
});

test('restoring only visibility preserves the source lifecycle and complete ledger payload',async()=>{
 const h=harness(),row=order('old','old-invoice',{historyHidden:true,status:'batal',cancelled:true,cancelMode:'archived',cancelReason:'Lama'});seed(h,'pembelian',[row]);const before=h.json("commerceData('pembelian').orders");hide(h,'pembelian',['old'],false);assert.match(h.run('lastSheet'),/tetap berstatus batal/);const pending=h.run('A.commerceHistorySave(null)');assert.equal(h.requests.length,1);const p=h.requests[0].payload;assert.equal(p.hidden,false);assert.deepEqual(Object.keys(p).sort(),['expectedRevisions','hidden','ids','module','requestId','withState']);assert.deepEqual(h.json("commerceData('pembelian').orders"),before);
 const restored={...row,historyHidden:false,revision:'restored',historyVisibilityRequestId:p.requestId};h.requests[0].resolve({commerce:state('pembelian',[restored])});await pending;assert.equal(h.run('drops'),1);assert.deepEqual(h.json("commerceData('pembelian').orders[0].payments"),row.payments);assert.equal(h.run("commerceData('pembelian').orders[0].cancelled"),true);
});

test('uncertain response checks exact request metadata and retries with the same id only when revisions are unchanged',async()=>{
 const h=harness(),row=nota('old');seed(h,'nota',[row]);hide(h,'nota',['old']);let pending=h.run('A.commerceHistorySave(null)');const original=JSON.stringify(h.requests[0].payload);h.requests[0].reject({message:'timeout',uncertain:true});await pending;assert.equal(h.run('currentForm._commerceLocked'),true);
 pending=h.run('A.commerceCheck({closest:function(){return currentForm;}})');h.requests[1].resolve(state('nota',[row]));await pending;assert.equal(h.run('currentForm._commerceRetry'),true);pending=h.run('A.commerceRetry({closest:function(){return currentForm;}})');assert.equal(JSON.stringify(h.requests[2].payload),original);const requestId=h.requests[2].payload.requestId;h.requests[2].reject({message:'timeout',uncertain:true});await pending;
 pending=h.run('A.commerceCheck({closest:function(){return currentForm;}})');h.requests[3].resolve(state('nota',[{...row,revision:'hidden',historyHidden:true,historyVisibilityRequestId:requestId}],12));await pending;assert.equal(h.run('drops'),1);assert.match(h.json('messages').at(-1).text,/Sampah riwayat/);
});

test('hidden state from another request is not mistaken for confirmation',async()=>{
 const h=harness(),row=nota('old');seed(h,'nota',[row]);hide(h,'nota',['old']);let pending=h.run('A.commerceHistorySave(null)');h.requests[0].reject({message:'timeout',uncertain:true});await pending;pending=h.run('A.commerceCheck({closest:function(){return currentForm;}})');h.requests[1].resolve(state('nota',[{...row,revision:'other',historyHidden:true,historyVisibilityRequestId:'different-request'}]));await pending;assert.equal(h.run('drops'),0);assert.equal(h.run('currentForm._commerceRetry'),false);
});

test('stale edit and grouped-payment controls cannot mutate hidden records or reopen them as a new note',()=>{
 const h=harness();const hidden=order('h','hidden',{historyHidden:true,payments:[{id:'ph',groupId:'g',jumlah:100000}]}),visible=order('v','visible',{payments:[{id:'pv',groupId:'g',jumlah:100000}]});seed(h,'pembelian',[hidden,visible]);seed(h,'nota',[nota('hidden',{historyHidden:true})]);h.run('A.commerceNotaOpen('+el('nota',['hidden'])+')');assert.equal(h.run('lastSheet'),'');assert.equal(h.run("commerceRecord('pembelian','h')"),null);h.form({},'pembelian');
 for(const p of [{parentId:'h'},{orderIds:['v','h']},{targetInvoiceId:'hidden'},{groupId:'g'},{parentId:'v',eventId:'pv'}])h.run('commerceMutation("pembelian","voidCommerceEvent",'+JSON.stringify(p)+',currentForm,null)');assert.equal(h.requests.length,0);
});

test('cached image and frozen group selection stop exporting after hide or revision changes',()=>{
 const h=harness(),row=order('x');seed(h,'pembelian',[row]);h.run("S.share={scope:commerceScope(),ids:['x'],key:commerceInvoiceKey(commerceFind('pembelian','orders','x')),revisions:{x:'rev-x'},url:'blob:old',blob:{}};currentForm._commerceGroupRows=JSON.parse(JSON.stringify(commerceData('pembelian').orders));currentForm._commerceGroupIds=['x'];currentForm._commerceScope=commerceScope();currentForm._commerceGroupInvoiceKey=S.share.key;");seed(h,'pembelian',[{...row,historyHidden:true,revision:'hidden'}]);assert.equal(h.run('commerceShareCurrent(S.share)'),false);assert.equal(h.run('S.share.url'),'');assert.equal(h.run('S.share.blob'),null);assert.throws(()=>h.run('commerceGroupFormRows(currentForm)'),/Sampah/);assert.throws(()=>h.run("commerceShareModel(commerceData('pembelian').orders)"),/Sampah/);h.run('A.commercePdf('+el('pembelian',['x'])+')');assert.equal(h.json('pdfs').length,0);
});
