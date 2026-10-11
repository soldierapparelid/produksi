'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
function fixture(row){
 const requests=[],c=vm.createContext({console,setTimeout,clearTimeout,request(action,payload){return new Promise((resolve,reject)=>requests.push({action,payload,resolve,reject}));}});
 vm.runInContext(`var A={},C={},R={},VIEWS={},S={token:'session',state:{me:{id:'owner',divisi:'owner'},settings:{}},f:{},sub:{},img:{}},Api={mode:function(){return 'demo';}},UI_VERSION='test',IMG_TOKO='cm.',nextId=0,messages=[],lastSheet='',drops=0;
 function me(){return S.state.me;}function isAdmin(){return ['owner','admin'].includes(me().divisi);}function req(a,p){return request(a,p);}function refresh(){}function render(){}function quiet(){}function toast(s){messages.push(s);}function nf(v){return String(Number(v)||0);}function rp(v){return 'Rp'+nf(v);}function tgl(v){return String(v||'');}function ic(){return '';}function inisial(){return 'P';}function todayYmd(){return '2026-10-11';}function newId(){return 'fixed'+(++nextId);}
 function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 function emptyBox(v){return '<p>'+esc(v)+'</p>';}function hid(k,v){return '<input name="'+k+'" value="'+esc(v)+'">';}function fCatatan(v){return '<textarea name="catatan">'+esc(v)+'</textarea>';}function footSave(a){return '<button data-save="'+a+'">Simpan</button>';}function sheetHtml(t,b,f){return '<h2>'+esc(t)+'</h2>'+b+(f||'');}
 var currentForm;
 function openSheet(fn){lastSheet=fn();currentForm={values:{},module:'pembelian',preview:{textContent:'',className:''},note:{hidden:true,innerHTML:''},sheet:{},getAttribute:function(k){return k==='data-module'?this.module:null;},closest:function(){return this.sheet;}};}
 function topForm(){return currentForm;}function formVals(f){return f.values;}function $(sel,f){return sel==='[data-commerce-receipt-preview]'?f.preview:sel==='[data-commerce-note]'?f.note:null;}function $$(){return [];}function dropForm(){drops++;}function act(el,p){return Promise.resolve(p).catch(function(e){toast(e.message);throw e;});}function confirmBox(opts,fn){return fn(null);}
 `,c);
 const h=html.indexOf('function fTanggal(');vm.runInContext(html.slice(h,html.indexOf('/* ---------- hitungan PO',h)),c);
 vm.runInContext(html.slice(html.indexOf('/* COMMERCE UI START'),html.indexOf('/* COMMERCE UI END */')),c);
 const run=code=>vm.runInContext(code,c),plain=v=>JSON.parse(JSON.stringify(v));
 run(`var entry=commerceEntry('pembelian');entry.data={orders:[${JSON.stringify(row)}],products:[],suppliers:[]};entry.version=1;entry.tried=true;`);
 function values(v){c.input=v;run('currentForm.values=input');}
 function open(edit){run(edit?`A.commerceEventEdit({getAttribute:function(k){return k==='data-m'?'pembelian':k==='data-id'?'order':${JSON.stringify(edit)};}})`:`A.commerceReceiptOpen({getAttribute:function(){return 'order';}})`);}
 return {c,run,plain,requests,values,open};
}
function order(extra={}){const receipts=[{id:'r1',kind:'receipt',itemId:'m',tanggal:'2026-10-08',jumlah:200,kondisi:'baik sekali',catatan:'Batch pertama'},{id:'r2',kind:'receipt',itemId:'m',tanggal:'2026-10-10',jumlah:90,kondisi:'ok',catatan:'Batch kedua'}];return {id:'order',revision:'before',status:'sebagian',productName:'Kemeja',totalQty:300,totalReceived:290,items:[{id:'m',nama:'M',jumlah:300}],payments:[],receipts,events:receipts,totalHarga:300000,totalPaid:100000,balance:200000,...extra};}
function result(row){return {record:row,commerce:{module:'pembelian',version:2,actor:{id:'owner',divisi:'owner'},orders:[row],products:[],suppliers:[]}};}

test('290 of 300 is explicit on the card and has a direct per-order receipt history',()=>{
 const f=fixture(order()),card=f.run("commerceOrderCard(commerceRecord('pembelian','order'))");assert.match(card,/Diterima 290\/300 pcs · Sisa 10 pcs/);assert.match(card,/data-a="commerceReceiptHistory" data-m="pembelian" data-id="order"/);
 f.run("A.commerceReceiptHistory({getAttribute:function(){return 'order';}})");const h=f.c.lastSheet;assert.match(h,/Diterima <b>290\/300 pcs/);assert.match(h,/Sisa <b>10 pcs/);assert.match(h,/200 pcs · M/);assert.match(h,/90 pcs · M/);assert.match(h,/2026-10-10/);assert.match(h,/Kondisi: baik sekali/);assert.match(h,/Batch pertama/);assert.equal((h.match(/>Edit penerimaan<\/button>/g)||[]).length,2);assert.match(h,/Tambah penerimaan/);assert.equal(f.requests.length,0);
});

test('incremental receipt preview changes 290 to 300, rejects 11, and carries the captured revision',async()=>{
 const f=fixture(order());f.open();assert.match(f.c.lastSheet,/Diterima kali ini/);assert.match(f.c.lastSheet,/name="jumlah" value=""/);
 f.values({id:'fixed1',parentId:'order',revision:'before',itemId:'m',jumlah:'10',tanggal:'2026-10-11',kondisi:'ok',catatan:' Sisa barang '});f.run('R.commerce(currentForm)');assert.match(f.c.currentForm.preview.textContent,/Setelah disimpan: diterima 300\/300 pcs · sisa 0 pcs/);
 f.c.currentForm.values.jumlah='11';f.run('R.commerce(currentForm);A.commerceReceiptSave(null)');assert.match(f.c.currentForm.preview.textContent,/maksimal 10 pcs/);assert.equal(f.requests.length,0);
 f.c.currentForm.values.jumlah='10';const p=f.run('A.commerceReceiptSave(null)');const req=f.requests[0];assert.equal(req.action,'appendCommerceReceipt');assert.deepEqual(f.plain(req.payload),{id:'fixed1',orderId:'order',expectedRevision:'before',tanggal:'2026-10-11',itemId:'m',jumlah:10,kondisi:'ok',catatan:'Sisa barang',withState:true});
 req.resolve(result(order({revision:'after',totalReceived:300})));await p;assert.equal(f.c.drops,1);assert.match(f.run("commerceReceiptHistoryHtml(commerceRecord('pembelian','order'))"),/Diterima <b>300\/300/);
});

test('editing excludes the old receipt from cumulative totals and preserves date, custom condition, and note',()=>{
 const f=fixture(order());f.open('r1');assert.match(f.c.lastSheet,/Ubah penerimaan/);assert.match(f.c.lastSheet,/name="tanggal" value="2026-10-08"/);assert.match(f.c.lastSheet,/<option value="baik sekali" selected/);assert.match(f.c.lastSheet,/Batch pertama/);assert.match(f.c.lastSheet,/Isian ini bukan tambahan/);
 f.values({id:'fixed1',parentId:'order',revision:'before',eventId:'r1',jenis:'receipt',itemId:'m',jumlah:'190',tanggal:'2026-10-08',kondisi:'baik sekali',catatan:'Batch pertama'});f.run('R.commerce(currentForm)');assert.match(f.c.currentForm.preview.textContent,/penerimaan lain 90 pcs/);assert.match(f.c.currentForm.preview.textContent,/diterima 280\/300 pcs · sisa 20 pcs/);
 f.run('A.commerceEventEditSave(null)');const req=f.requests[0];assert.equal(req.action,'gantiCommerceEvent');assert.equal(req.payload.eventId,'r1');assert.equal(req.payload.jumlah,190);assert.equal(req.payload.expectedRevision,'before');assert.equal(req.payload.kondisi,'baik sekali');assert.equal(req.payload.tanggal,'2026-10-08');assert.equal(req.payload.catatan,'Batch pertama');
});

test('changing the corrected variant removes the original share and validates the chosen variant independently',()=>{
 const row=order({totalQty:400,items:[{id:'m',nama:'M',jumlah:300},{id:'l',nama:'L',jumlah:100}]}),f=fixture(row);f.open('r2');f.values({itemId:'l',jumlah:'60'});f.run('R.commerce(currentForm)');assert.match(f.c.currentForm.preview.textContent,/diterima 60\/100 pcs · sisa 40 pcs/);assert.match(f.c.currentForm.preview.textContent,/Total seluruh varian 260 pcs/);
 f.c.currentForm.values.jumlah='101';f.run('R.commerce(currentForm)');assert.match(f.c.currentForm.preview.textContent,/maksimal 100 pcs/);
});

test('historical corrections stay visible and escaped; voided events never increase current receipt totals',()=>{
 const row=order(),old={...row.receipts[0],id:'old',jumlah:999,voided:true,voidReason:'<img onerror=bad>',catatan:'<script>bad</script>'};row.receipts.push(old);row.events.push(old);const f=fixture(row),h=f.run("commerceReceiptHistoryHtml(commerceRecord('pembelian','order'))");assert.match(h,/Dikoreksi — tidak dihitung/);assert.match(h,/&lt;img/);assert.match(h,/&lt;script/);assert.doesNotMatch(h,/<script>|<img onerror/);assert.doesNotMatch(h,/data-event="old">Edit/);
 const p=f.run("commerceReceiptProgress(commerceRecord('pembelian','order'),'m',10,'')");assert.equal(p.after,300);
});

test('held legacy receipts offer only existing order review, while admin history has no owner correction actions',()=>{
 const f=fixture(order({legacy:true,needsReview:true,receiptReview:true}));const h=f.run("commerceReceiptHistoryHtml(commerceRecord('pembelian','order'))");assert.match(h,/Periksa varian order/);assert.doesNotMatch(h,/Edit penerimaan/);f.open();assert.equal(f.requests.length,0);assert.match(f.c.messages.join(' '),/Periksa hubungan/);
 f.open('r1');assert.match(f.c.messages.join(' '),/Periksa status/);assert.equal(f.requests.length,0);
 const a=fixture(order());a.run("var scopedRow=commerceRecord('pembelian','order');S.state.me.divisi='admin';commerceEntry('pembelian').data={orders:[scopedRow]}");assert.doesNotMatch(a.run("commerceReceiptHistoryHtml(commerceRecord('pembelian','order'))"),/Edit penerimaan/);a.open('r1');assert.match(a.c.messages.join(' '),/Hanya owner/);
});

test('a lost receipt response keeps one stable ID, freezes the form, and makes no automatic retry',async()=>{
 const f=fixture(order());f.open();f.values({id:'receipt-fixed',parentId:'order',revision:'before',itemId:'m',jumlah:'10',tanggal:'2026-10-11',kondisi:'ok',catatan:''});const p=f.run('A.commerceReceiptSave(null)');f.requests[0].reject(Object.assign(new Error('Timeout'),{uncertain:true}));await p;
 assert.equal(f.c.currentForm._commerceLocked,true);assert.equal(f.c.currentForm._commerceIntent.payload.id,'receipt-fixed');f.run('A.commerceReceiptSave(null)');assert.equal(f.requests.length,1);assert.match(f.c.currentForm.note.innerHTML,/Periksa data terbaru/);
});

test('zero in an edit voids the original receipt only and never appends a negative or duplicate receipt',()=>{
 const f=fixture(order());f.open('r1');f.values({id:'void-fixed',parentId:'order',revision:'before',eventId:'r1',jenis:'receipt',itemId:'m',jumlah:'0',tanggal:'2026-10-08',kondisi:'baik sekali',catatan:'Salah catat'});f.run('R.commerce(currentForm)');assert.match(f.c.currentForm.preview.textContent,/diterima 90\/300 pcs/);f.run('A.commerceEventEditSave(null)');assert.equal(f.requests.length,1);assert.equal(f.requests[0].action,'voidCommerceEvent');assert.equal(f.requests[0].payload.eventId,'r1');assert.equal(f.requests[0].payload.id,'void-fixed');assert.equal(f.requests[0].payload.jumlah,undefined);
});

test('new receipts start on a variant with a real remainder and cancelled orders keep read-only history',()=>{
 const row=order({items:[{id:'m',nama:'M',jumlah:290},{id:'l',nama:'L',jumlah:10}]}),f=fixture(row);f.open();assert.match(f.c.lastSheet,/<option value="l" selected>L · sisa 10 pcs/);
 const cancelled=fixture(order({status:'batal',cancelled:true}));cancelled.run("A.commerceReceiptHistory({getAttribute:function(){return 'order';}})");assert.match(cancelled.c.lastSheet,/200 pcs · M/);assert.doesNotMatch(cancelled.c.lastSheet,/Edit penerimaan|Tambah penerimaan/);cancelled.open();assert.match(cancelled.c.messages.join(' '),/Periksa status/);assert.equal(cancelled.requests.length,0);
});
