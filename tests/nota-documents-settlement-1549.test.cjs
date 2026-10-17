'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function harness(){const context=vm.createContext({console});for(const name of ['core','commerce'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src',name+'.js'),'utf8'),context);const run=code=>vm.runInContext(code,context);return {context,run,json:code=>JSON.parse(run('JSON.stringify('+code+')'))};}
function nota(over={}){return {id:'nota1',noNota:'SA-261017-001',date:'2026-10-17',customer:{name:'Pelanggan Contoh',address:'Alamat contoh'},total:300000,subtotal:300000,totalPaid:300000,balance:0,items:[{name:'Topi',size:'L',color:'Hitam',qty:10,price:30000,subtotal:300000}],payments:[{id:'dp',tanggal:'2026-10-10',jumlah:100000,metode:'transfer',catatan:'DP pertama'},{id:'paid',tanggal:'2026-10-17',jumlah:200000,metode:'cash',catatan:'Sisa tagihan'}],...over};}
function model(h,value){h.context.record=value;return h.json('coreNotaRingkas(record,{kopSlip:"SOLDIER APPAREL"})');}
function docs(h,value){h.context.record=value;return ['coreNotaInvoiceHtml(record,{kopSlip:"SOLDIER APPAREL"})','coreNotaStrukHtml(record,{kopSlip:"SOLDIER APPAREL"})','coreNotaStrukHtml(record,{kopSlip:"SOLDIER APPAREL"},{lebar:80})'].map(h.run);}

test('safe settlement summary rejects missing, malformed and inconsistent balances despite old status',()=>{
 const h=harness();assert.equal(model(h,nota()).lunas,true);
 for(const over of [{total:undefined},{totalPaid:undefined},{balance:undefined},{balance:null},{totalPaid:''},{total:'300000'},{balance:false},{total:NaN},{balance:-1},{totalPaid:300001},{balance:1},{totalPaid:2.5},{total:Number.MAX_SAFE_INTEGER+1},{paymentReview:true},{needsReview:true},{status:'review'}]){
  const value=nota({status:'lunas',...over}),r=model(h,value);assert.equal(r.lunas,false,JSON.stringify(over));assert.equal(r.status,'PERLU DIPERIKSA',JSON.stringify(over));assert.equal(r.tanggalLunas,'');for(const doc of docs(h,value))assert.ok(!/>LUNAS<|\*\* LUNAS \*\*/.test(doc),JSON.stringify(over));
 }
 assert.equal(model(h,nota({cancelled:true})).status,'DIBATALKAN');assert.equal(model(h,nota({status:'batal'})).lunas,false);
 const free=model(h,nota({total:0,totalPaid:0,balance:0,subtotal:0,payments:[]}));assert.equal(free.lunas,true);assert.equal(free.tanggalLunas,'');
});

test('date of settlement comes only from dated current payments; voided evidence cannot move it',()=>{
 const h=harness(),value=nota();value.payments.unshift({id:'wrong',tanggal:'2026-11-12',jumlah:999999,voided:true});const before=JSON.stringify(value),r=model(h,value);assert.equal(r.tanggalLunas,'2026-10-17');assert.equal(r.bayaran.length,2);assert.equal(JSON.stringify(value),before);
 for(const payments of [[],[{id:'p',jumlah:300000}],[{id:'p',tanggal:'2026-02-30',jumlah:300000}],[{id:'p',tanggal:'2026-10-17T00:00:00Z',jumlah:300000}],[{id:'p',tanggal:'2026-10-17',jumlah:200000}]]){
  const old=nota({payments}),s=model(h,old);assert.equal(s.lunas,true);assert.equal(s.tanggalLunas,'');for(const doc of docs(h,old))assert.match(doc,/Tanggal pelunasan belum tercatat/);
 }
 const due=model(h,nota({totalPaid:100000,balance:200000,payments:[value.payments[1]]}));assert.equal(due.lunas,false);assert.equal(due.status,'DP / BELUM LUNAS');assert.equal(due.tanggalLunas,'');
 for(const payment of [{jumlah:-1},{jumlah:'300000'},{jumlah:NaN},{jumlah:300000,sourceReview:true}])assert.equal(model(h,nota({payments:[payment]})).lunas,false);
});

test('invoice PDF markup and both thermal sizes display LUNAS prominently with preserved payment history',()=>{
 const h=harness(),rendered=docs(h,nota());for(const doc of rendered){assert.match(doc,/LUNAS/);assert.match(doc,/Pelunasan 17 Okt 2026/);assert.match(doc,/10 Okt 2026/);assert.match(doc,/17 Okt 2026/);assert.match(doc,/DP pertama/);assert.match(doc,/Sisa tagihan/);assert.match(doc,/100\.000/);assert.match(doc,/200\.000/);assert.ok(!/<script/.test(doc));}
 assert.match(rendered[0],/\.cap\{[^}]*border:3px[^}]*font-size:16pt/);assert.match(rendered[0],/border-color:#2e7d32">LUNAS<\/span>/);assert.match(rendered[0],/Riwayat pembayaran/);
 for(const struk of rendered.slice(1)){assert.match(struk,/class="t b status">\*\* LUNAS \*\*/);assert.match(struk,/\.status\{border:2px solid #000/);assert.match(struk,/RIWAYAT PEMBAYARAN/);}
});

test('long and unbroken customer text and many payments remain complete and can flow across print pages',()=>{
 const h=harness(),long='PANJANG'.repeat(100),payments=Array.from({length:80},(_,i)=>({id:'p'+i,jumlah:1000,tanggal:'2026-10-17',metode:'transfer',catatan:'Bukti '+i+' '+long+' AKHIR_'+i})),value=nota({total:80000,subtotal:80000,totalPaid:80000,customer:{name:long,address:long},notes:'Catatan <script>\n'+long+' AKHIR_NOTA',items:[{name:long,color:long,size:'XL',qty:1,price:80000,subtotal:80000}],payments});
 for(const doc of docs(h,value)){assert.ok(doc.includes(long));assert.ok(doc.includes('AKHIR_NOTA'));assert.ok(!doc.includes('<script>'));assert.ok(doc.includes('&lt;script&gt;'));for(let i=0;i<80;i++)assert.ok(doc.includes('AKHIR_'+i));assert.match(doc,/overflow-wrap:anywhere/);assert.ok(!/max-height:|overflow:hidden/.test(doc));}
 const invoice=docs(h,value)[0];assert.match(invoice,/\.bawah\{margin-top:12px;table-layout:fixed\}/);assert.match(invoice,/thead\{display:table-header-group\}/);assert.match(invoice,/<\/td><\/tr><\/table><div class="riwayat">/,'history is outside the two-column totals table');assert.match(invoice,/\.bayar tr\{page-break-inside:avoid\}/);
});

test('review and cancellation override paid stamp and unknown payment dates are labelled truthfully',()=>{
 const h=harness();for(const bad of [nota({paymentReview:true}),nota({needsReview:true}),nota({cancelled:true})])for(const doc of docs(h,bad)){assert.ok(!/>LUNAS<|\*\* LUNAS \*\*/.test(doc));assert.ok(!doc.includes('Pelunasan 17 Okt 2026'));}
 for(const doc of docs(h,nota({payments:[{id:'p',jumlah:300000,tanggal:'2026-02-30',metode:'<bad>',catatan:'<img src=x>'}]}))){assert.match(doc,/Tanggal belum tercatat/);assert.ok(!doc.includes('30 Feb'));assert.ok(!doc.includes('<img src=x>'));assert.match(doc,/&lt;img src=x&gt;/);assert.match(doc,/&lt;bad&gt;/);}
});
