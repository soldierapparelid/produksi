'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const index=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
assert.ok(index.includes('function commerceSharePrintHtml(m, foto)'), 'supplier print helper is integrated into the shipped UI');
function harness(){
  const context=vm.createContext({console});
  vm.runInContext(`var A={},C={},R={},VIEWS={},S={token:'owner-session',state:{settings:{kopSlip:'Soldier Apparel'},me:{id:'owner',divisi:'owner'}},f:{},sub:{},img:{}},IMG_TOKO='cm.',Api={mode:function(){return 'gas';}},messages=[],prints=[],revoked=[],URL={revokeObjectURL:function(u){revoked.push(u);}};function todayYmd(){return '2026-10-22';}function me(){return S.state.me;}function isAdmin(){return true;}function toast(t){messages.push(t);}function quiet(){}function act(el,p){return Promise.resolve(p);}function slipCetak(models,html,guard){prints.push({models:models,html:html,guard:guard});return Promise.resolve();}`,context);
  vm.runInContext(index.slice(index.indexOf('/* COMMERCE UI START'),index.indexOf('/* COMMERCE UI END */')),context);
  vm.runInContext(`var printOrders=[];commerceFind=function(m,k,id){return k==='suppliers'?{id:'sup',nama:'Supplier Contoh',kontak:'0800',alamat:'Bandung'}:k==='orders'?printOrders.find(function(o){return o.id===id;}):null;};commerceOrderSupplierId=function(){return 'sup';};commerceInvoiceLabel=function(o){return o.invoiceId||'INV';};`,context);
  return {run(code){return vm.runInContext(code,context);},model(orders){context.input=orders;return vm.runInContext('commerceShareModel(input)',context);},print(model,photos={}){context.model=model;context.photos=photos;return vm.runInContext('commerceSharePrintHtml(model,photos)',context);},cache(orders){context.input=orders;vm.runInContext(`printOrders=input;S.share={ids:input.map(function(o){return o.id;}),key:commerceInvoiceKey(input[0]),scope:commerceScope(),url:'blob:current',model:commerceShareModel(input),foto:{},revisions:{}};input.forEach(function(o){S.share.revisions[o.id]=o.revision;});`,context);}};
}
function order(extra={}){return {id:'o1',invoiceId:'INV-1558',produkId:'p1',productName:'Topi Contoh',tanggalOrder:'2026-10-01',hargaSatuan:1000,items:[{id:'a',nama:'Hitam L',jumlah:200},{id:'b',nama:'Navy XL',jumlah:100}],totalQty:300,totalHarga:300000,totalPaid:100000,balance:200000,totalReceived:290,receivedByItem:{a:200,b:90},payments:[{id:'dp',tanggal:'2026-10-01',jumlah:100000,catatan:'DP pertama'}],receipts:[{id:'r1',itemId:'a',tanggal:'2026-10-04',jumlah:200,catatan:'Kiriman pertama'},{id:'r2',itemId:'b',tanggal:'2026-10-07',jumlah:90,catatan:'Kiriman kedua'}],catatan:'Kirim dalam dus',...extra};}
function freeze(value){Object.freeze(value);Object.values(value).forEach(v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v))freeze(v);});return value;}
function body(doc){return doc.slice(doc.indexOf('<body>'));}

test('A4 supplier print shares the image model and preserves variants, dated arrivals, totals and payment records',()=>{
  const h=harness(),source=freeze([order(),order({id:'o2',produkId:'p2',productName:'Topi Kedua'})]),before=JSON.stringify(source),model=freeze(h.model(source)),snapshot=JSON.stringify(model);
  const photos=freeze({p1:{src:'data:image/png;base64,AAAA'},p2:{currentSrc:'https://example.test/photo.png'}}),doc=h.print(model,photos);
  assert.equal(JSON.stringify(source),before);assert.equal(JSON.stringify(model),snapshot);
  assert.match(doc,/@page\{size:A4 portrait;margin:10mm\}/);assert.match(doc,/column-count:2/);assert.match(doc,/<title>Invoice supplier INV-1558<\/title>/);
  assert.match(doc,/id="slip-print-button" disabled/);assert.match(doc,/id="slip-print-status"/);
  assert.equal((doc.match(/<article class="supplier-card/g)||[]).length,2);
  for(const text of ['Supplier Contoh','0800 · Bandung','1. Topi Contoh','2. Topi Kedua','Hitam L','Navy XL','4 Okt 2026','7 Okt 2026','200 pcs','90 pcs','Kiriman pertama','Kiriman kedua','DP pertama','Kirim dalam dus','Rp 600.000','Rp 200.000','Rp 400.000','580 dari 600 pcs'])assert.ok(doc.includes(text),text);
  assert.match(doc,/<td>Navy XL<\/td><td>100<\/td><td>90<\/td><td>10<\/td><td>Rp 100.000<\/td>/);
  assert.match(doc,/<img class="supplier-photo" src="data:image\/png;base64,AAAA"/);
  assert.match(doc,/\.supplier-product-head>div:not\(\.supplier-photo\)\{min-width:0;flex:1\}/,'photo placeholders retain the same compact width as actual photos');
  assert.match(doc,/<strong>DP \/ BELUM LUNAS<\/strong>/);assert.doesNotMatch(doc,/<strong>LUNAS<\/strong>/);
});

test('LUNAS is prominent only for settled trusted invoices, with settlement distinct from arrival dates',()=>{
  const h=harness(),paid=order({totalPaid:300000,balance:0,payments:[{id:'a',tanggal:'2026-10-01',jumlah:100000},{id:'b',tanggal:'2026-10-19',jumlah:200000}]});
  const doc=h.print(h.model([paid]));
  assert.match(doc,/<div class="supplier-status paid"><strong>LUNAS<\/strong>/);assert.match(doc,/Pelunasan 19 Okt 2026/);assert.match(doc,/DITERIMA 290 DARI 300 PCS/);assert.doesNotMatch(doc,/SUDAH DITERIMA SEMUA/);
  const mixed=h.print(h.model([paid,order({id:'o2',produkId:'p2'})]));assert.doesNotMatch(mixed,/<strong>LUNAS<\/strong>/);assert.match(mixed,/<p class="supplier-good supplier-item-paid">LUNAS · 19 Okt 2026<\/p>/);
  const review=h.print({...h.model([paid]),paymentReview:true});assert.match(review,/<strong>PEMBAYARAN PERLU DIPERIKSA<\/strong>/);assert.doesNotMatch(review,/<strong>LUNAS<\/strong>/);
  const noDate=h.print(h.model([order({totalPaid:300000,balance:0,payments:[]})]));assert.match(noDate,/Tanggal pelunasan belum tercatat/);assert.doesNotMatch(noDate,/Pelunasan 22 Okt/);
});

test('unknown receipt values and legacy receipt inconsistencies remain explicit instead of becoming zero or invented dates',()=>{
  const h=harness();
  const legacy=h.print(h.model([order({receipts:[]})]));assert.match(legacy,/290 pcs tercatat diterima pada data lama/);assert.match(legacy,/Tanggal dan rincian kedatangannya belum tercatat/);assert.doesNotMatch(legacy,/Belum ada barang diterima\./);
  const uncertain=h.print(h.model([order({receiptReview:true,receipts:[{id:'bad',itemId:'missing',tanggal:'2026-02-30',jumlah:290,sourceReview:true}]})]));
  for(const text of ['PENERIMAAN PERLU DIPERIKSA','Tanggal belum tercatat','Varian belum terhubung','Catatan penerimaan ini perlu diperiksa.','Rincian penerimaan perlu diperiksa.'])assert.ok(uncertain.includes(text),text);
  assert.match(uncertain,/<td>Hitam L<\/td><td>200<\/td><td>—<\/td><td>—<\/td>/);assert.doesNotMatch(uncertain,/SUDAH DITERIMA SEMUA/);
  const mismatch=h.print(h.model([order({totalReceived:280})]));assert.match(mismatch,/Jumlah riwayat penerimaan berbeda dari ringkasan/);
});

test('large product and payment histories retain every record and can flow beyond one printed page',()=>{
  const h=harness(),count=180,receipts=Array.from({length:count},(_,i)=>({id:'receipt'+i,itemId:'a',tanggal:'2026-10-04',jumlah:1,catatan:'KIRIMAN_'+i+' '+('isi '.repeat(25))+'AKHIR_'+i}));
  const payments=Array.from({length:70},(_,i)=>({id:'pay'+i,tanggal:'2026-10-05',jumlah:100,catatan:'BAYAR_'+i+' '+('bukti '.repeat(10))+'SELESAI_'+i}));
  const doc=h.print(h.model([order({receipts,payments,catatan:'CATATAN '+('pesan '.repeat(1000))+'AKHIR_CATATAN'})]));
  for(let i=0;i<count;i++)assert.ok(doc.includes('AKHIR_'+i+'</div>'),'arrival '+i+' retained');
  for(let i=0;i<70;i++)assert.ok(doc.includes('SELESAI_'+i+'</td>'),'payment '+i+' retained');
  assert.ok(doc.includes('AKHIR_CATATAN</li>'));
  assert.match(doc,/<article class="supplier-card supplier-flow">/);assert.match(doc,/\.supplier-flow\{break-inside:auto!important;page-break-inside:auto!important\}/);
  assert.doesNotMatch(doc,/overflow\s*:\s*hidden|line-clamp|max-height|height\s*:\s*\d+mm[^}]*supplier-card/);
  assert.match(doc,/thead\{display:table-header-group\}/);assert.match(doc,/class="supplier-receipt"/);
});

test('all user-entered content and photos are escaped, and unsupported photo protocols never enter print HTML',()=>{
  const h=harness(),model=h.model([order()]),payload='<img src=x onerror="bad()"> & "quoted"';
  Object.assign(model,{usaha:payload,invoiceLabel:payload,catatan:[payload],supplier:{nama:payload,detail:payload}});
  Object.assign(model.orders[0],{nama:payload});model.orders[0].baris[0].nama=payload;
  Object.assign(model.orders[0].penerimaan[0],{varian:payload,catatan:payload});model.pembayaran[0].catatan=payload;
  const doc=h.print(model,{p1:{src:'https://example.test/a" onerror="bad()'}});
  assert.ok(doc.includes('&lt;img src=x onerror=&quot;bad()&quot;&gt; &amp; &quot;quoted&quot;'));assert.doesNotMatch(body(doc),/<img src=x|<script| src="[^"]*" onerror=/);
  assert.match(doc,/src="https:\/\/example\.test\/a&quot; onerror=&quot;bad\(\)"/);
  for(const bad of ['javascript:alert(1)','data:text/html;base64,PHNjcmlwdD4=','data:image/svg+xml,<svg onload="bad()">']){
    const result=h.print(model,{p1:{src:bad}});assert.doesNotMatch(result,/<img class="supplier-photo"/);assert.match(result,/Tanpa foto/);assert.ok(!result.includes(bad));
  }
});

test('supplier print uses the current completed share snapshot without changing business records',async()=>{
  const h=harness(),orders=[order({revision:'revision-1'})],before=JSON.stringify(orders);h.cache(orders);
  await h.run('A.commerceSharePrint(null)');
  assert.equal(h.run('prints.length'),1);assert.equal(h.run('prints[0].models.length'),0);assert.match(h.run('prints[0].html'),/<title>Invoice supplier INV-1558<\/title>/);
  assert.equal(h.run('messages.length'),0);assert.equal(JSON.stringify(orders),before);
});

test('supplier print refuses changed, hidden, moved-invoice, different-session or unfinished share snapshots',async()=>{
  for(const change of ["printOrders[0].revision='new-revision'","printOrders[0].historyHidden=true","printOrders[0].invoiceId='other-invoice'","S.token='other-session'","S.share.url=''","S.share.model=null"]){
    const h=harness();h.cache([order({revision:'revision-1'})]);h.run(change);await h.run('A.commerceSharePrint(null)');
    assert.equal(h.run('prints.length'),0,change);assert.ok(h.run('messages.length')>0,change);
    assert.match(h.run('messages[messages.length-1]'),/Invoice berubah|Gambar masih disiapkan/);
  }
});
