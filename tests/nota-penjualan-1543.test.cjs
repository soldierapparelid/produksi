'use strict';
/* 1.5.43: nota penjualan boleh diedit walau sudah dibayar, bisa diarsipkan, dihapus (pembayaran ikut dikoreksi) dan
   dikembalikan; invoice dan struk untuk pelanggan. Semua data di sini buatan. */
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
 const notes=()=>good('getCommerceState',{module:'nota'}).notes;
 return {h,good,bad,raw,notes};
}
const input=(over={})=>({id:'nota01',date:'2026-10-13',customer:{name:'Toko Uji',phone:'0800',address:'Jl. Contoh 1'},items:[{id:'a',name:'Oblong',color:'Hitam',size:'L',qty:10,price:5000}],notes:'Ambil sendiri',...over});
const ADMIN='test-admin-token';

test('a nota made in this app can be corrected after a payment; the payment stays and the total may not fall below it',()=>{
 const f=fixture();let n=f.good('saveCommerceNota',{record:input({initialPayment:{jumlah:20000,metode:'transfer'}})}).record;
 assert.equal(n.total,50000);assert.equal(n.totalPaid,20000);assert.equal(n.status,'dp');assert.equal(n.notaEditCount,undefined);
 n=f.good('appendCommercePayment',{id:'pay2',module:'nota',parentId:'nota01',expectedRevision:n.revision,tanggal:'2026-10-14',jumlah:5000,metode:'cash'}).record;
 const events=JSON.stringify(f.raw('CommerceEvent')),payments=JSON.stringify(n.payments);
 /* price, quantity, size and an extra item; the discount and the shipping too */
 const ubah=input({items:[{id:'a',name:'Oblong',color:'Hitam',size:'XL',qty:12,price:4500},{id:'b',name:'Topi',qty:2,price:10000,discPercent:10}],discountPercent:5,shipping:3000});
 f.bad('saveCommerceNota',{record:ubah,expectedRevision:'stale'},/berubah/);
 let e=f.good('saveCommerceNota',{record:ubah,expectedRevision:n.revision}).record;
 assert.equal(e.id,'nota01');assert.equal(e.noNota,n.noNota,'the number stays');assert.equal(e.subtotal,72000);assert.equal(e.discountAmount,3600);assert.equal(e.total,71400);
 assert.equal(e.totalPaid,25000);assert.equal(e.balance,46400);assert.equal(e.status,'dp');assert.equal(e.items[0].size,'XL');assert.equal(e.items.length,2);
 assert.equal(JSON.stringify(e.payments),payments,'payments are untouched');assert.equal(JSON.stringify(f.raw('CommerceEvent')),events);assert.equal(e.notaEditCount,1);
 assert.equal(e._notaChanges,undefined,'the change log stays on the server');
 const stored=JSON.parse(f.raw('CommerceRecord').find(r=>r.kind==='nota').data);assert.equal(stored._notaChanges.length,1);assert.equal(stored._notaChanges[0].before.total,50000);assert.equal(stored._notaChanges[0].before.items[0].size,'L');assert.equal(stored._initialPayment.jumlah,20000);
 assert.equal(f.good('saveCommerceNota',{record:ubah,expectedRevision:n.revision}).record.notaEditCount,1,'the same request again changes nothing');
 /* the limits */
 f.bad('saveCommerceNota',{record:input({items:[{id:'a',name:'Oblong',qty:1,price:24999}]}),expectedRevision:e.revision},/lebih kecil dari yang sudah dibayar/);
 f.bad('saveCommerceNota',{record:{...ubah,date:'2026-10-14'},expectedRevision:e.revision},/sesudah tanggal pembayaran/);
 /* exactly the paid amount is allowed and settles the nota; saving without a change adds no log entry */
 e=f.good('saveCommerceNota',{record:input({items:[{id:'a',name:'Oblong',qty:1,price:25000}]}),expectedRevision:e.revision}).record;assert.equal(e.status,'lunas');assert.equal(e.balance,0);assert.equal(e.notaEditCount,2);
 e=f.good('saveCommerceNota',{record:input({items:[{id:'a',name:'Oblong',qty:1,price:25000}],notes:'Ambil sendiri'}),expectedRevision:e.revision}).record;assert.equal(e.notaEditCount,2);
 f.good('saveCommerceNota',{record:input({items:[{id:'a',name:'Oblong',qty:1,price:26000}]}),expectedRevision:e.revision},ADMIN);
});

test('only the last twelve corrections of a nota are kept with it',()=>{
 const f=fixture();let n=f.good('saveCommerceNota',{record:input()}).record;
 for(let i=1;i<=14;i++)n=f.good('saveCommerceNota',{record:input({items:[{id:'a',name:'Oblong',qty:10,price:5000+i}]}),expectedRevision:n.revision}).record;
 assert.equal(n.notaEditCount,12);const log=JSON.parse(f.raw('CommerceRecord').find(r=>r.kind==='nota').data)._notaChanges;assert.equal(log[0].before.items[0].price,5002);assert.equal(log[11].before.items[0].price,5013);
});

test('archiving a nota only hides it: status, money and payments stay, and it survives an edit',()=>{
 const f=fixture();let n=f.good('saveCommerceNota',{record:input({initialPayment:{jumlah:50000,metode:'transfer'}})}).record;assert.equal(n.status,'lunas');
 f.bad('arsipCommerceNota',{id:'nota01',expectedRevision:'stale'},/berubah/);f.bad('arsipCommerceNota',{id:'tidak-ada',expectedRevision:n.revision},/tidak ditemukan/);
 const events=JSON.stringify(f.raw('CommerceEvent'));
 let a=f.good('arsipCommerceNota',{id:'nota01',expectedRevision:n.revision,withState:true},ADMIN);assert.equal(a.commerce.notes[0].archived,true,'the fresh list comes back with the answer');a=a.record;
 assert.equal(a.archived,true);assert.equal(a.archivedBy,'test-admin');assert.equal(a.status,'lunas');assert.equal(a.totalPaid,50000);assert.equal(a.balance,0);assert.equal(a.cancelled,false);assert.notEqual(a.revision,n.revision);
 assert.equal(f.good('arsipCommerceNota',{id:'nota01',expectedRevision:n.revision}).record.revision,a.revision,'archiving an archived nota is a no-op, also with an old revision');
 a=f.good('saveCommerceNota',{record:input({notes:'Diambil kurir'}),expectedRevision:a.revision}).record;assert.equal(a.archived,true,'an edit keeps the archive mark');
 const b=f.good('arsipCommerceNota',{id:'nota01',expectedRevision:a.revision,arsip:false}).record;assert.equal(b.archived,undefined);assert.equal(b.archivedBy,undefined);assert.equal(b.status,'lunas');assert.equal(b.totalPaid,50000);
 assert.equal(JSON.stringify(f.raw('CommerceEvent')),events,'no event is written');
});

test('the owner deletes a wrong nota together with its payments and can bring the nota back',()=>{
 const f=fixture();let n=f.good('saveCommerceNota',{record:input({initialPayment:{jumlah:20000,metode:'cash',tenderedAmount:50000}})}).record;
 n=f.good('appendCommercePayment',{id:'pay2',module:'nota',parentId:'nota01',expectedRevision:n.revision,tanggal:'2026-10-13',jumlah:5000,metode:'transfer'}).record;
 const hapus={module:'nota',id:'nota01',expectedRevision:n.revision,catatan:'Salah input'};
 f.bad('cancelCommerceRecord',hapus,/owner/,ADMIN);f.bad('cancelCommerceRecord',hapus,/terlebih dahulu/);f.bad('cancelCommerceRecord',{...hapus,mode:'archived'},/tidak dikenal/);
 let gone=f.good('cancelCommerceRecord',{...hapus,voidAll:true}).record;
 assert.equal(gone.status,'batal');assert.equal(gone.cancelled,true);assert.equal(gone.cancelReason,'Salah input');assert.equal(gone.totalPaid,0);assert.equal(gone.payments.length,2);assert.ok(gone.payments.every(p=>p.voided&&p.voidReason==='Salah input'),'both payments are corrected, none is erased');
 assert.equal(f.raw('CommerceEvent').filter(e=>e.kind==='void').length,2);
 f.bad('saveCommerceNota',{record:input({notes:'x'}),expectedRevision:gone.revision},/dibatalkan/);f.bad('appendCommercePayment',{id:'pay3',module:'nota',parentId:'nota01',expectedRevision:gone.revision,jumlah:1},/dibatalkan/);
 f.bad('restoreCommerceRecord',{module:'nota',id:'nota01',expectedRevision:gone.revision},/owner/,ADMIN);f.bad('restoreCommerceRecord',{module:'nota',id:'nota01',expectedRevision:'stale'},/berubah/);
 const back=f.good('restoreCommerceRecord',{module:'nota',id:'nota01',expectedRevision:gone.revision}).record;
 assert.equal(back.cancelled,undefined);assert.equal(back.status,'belum');assert.equal(back.totalPaid,0);assert.equal(back.balance,50000);assert.equal(back.restoredFrom.reason,'Salah input');assert.equal(back.noNota,n.noNota);
 /* a nota without payments needs no voidAll */
 const m=f.good('saveCommerceNota',{record:input({id:'nota02'})}).record;assert.equal(f.good('cancelCommerceRecord',{module:'nota',id:'nota02',expectedRevision:m.revision,catatan:'Salah input'}).record.status,'batal');
});

test('the PDF of a nota is the customer invoice, with the logo the device sent',()=>{
 const f=fixture();const n=f.good('saveCommerceNota',{record:input({customer:{name:'<b>Toko</b>'},initialPayment:{jumlah:20000,metode:'transfer'}})}).record;
 f.h.run("var envAsli=pkEnv_,pdfHtml='',pdfNama='';pkEnv_=function(){var e=envAsli();e.makePdf=function(html,name){pdfHtml=html;pdfNama=name;return 'pdf-uji';};return e;};void 0;");
 const logo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
 const pdf=f.good('makeCommercePdf',{module:'nota',id:'nota01',logo},ADMIN);assert.equal(pdf.base64,'pdf-uji');assert.equal(pdf.nama,'Invoice-'+n.noNota+'.pdf');
 const html=f.h.run('pdfHtml');assert.match(html,/<div class="judul">INVOICE<\/div>/);assert.ok(html.includes('<img src="'+logo+'" alt="">'));assert.ok(html.includes('&lt;b&gt;Toko&lt;/b&gt;')&&!html.includes('<b>Toko</b>'));assert.ok(html.includes(n.noNota));
 f.good('makeCommercePdf',{module:'nota',id:'nota01',logo:'javascript:alert(1)'});assert.ok(!f.h.run('pdfHtml').includes('<img'),'anything that is not a small base64 picture is left out');
 f.good('makeCommercePdf',{module:'nota',id:'nota01'});assert.ok(!f.h.run('pdfHtml').includes('<img'));
 f.bad('makeCommercePdf',{module:'nota',id:'tidak-ada'},/tidak ditemukan/);
});

test('invoice and thermal receipt show the items, the totals and what is still owed',()=>{
 const f=fixture(),c=f.h.context;
 const record={noNota:'SA-261013-007',date:'2026-10-13',customer:{name:'Toko & Uji',phone:'0800',address:'Jl. Contoh 1'},status:'dp',total:71400,subtotal:72000,discountPercent:5,discountAmount:3600,shipping:3000,totalPaid:25000,balance:46400,notes:'Baris satu\nBaris dua',
  items:[{id:'a',name:'Oblong',color:'Hitam',size:'XL',qty:12,price:4500,discPercent:0,subtotal:54000},{id:'b',name:'Topi <x>',qty:2,price:10000,discPercent:10,subtotal:18000}],
  payments:[{id:'p1',tanggal:'2026-10-13',metode:'cash',jumlah:20000,tenderedAmount:50000,change:30000},{id:'p2',tanggal:'2026-10-14',metode:'transfer',jumlah:5000},{id:'p3',tanggal:'2026-10-14',metode:'qris',jumlah:999,voided:true}]};
 c.rec=record;c.st={kopSlip:'SOLDIER APPAREL',kopSub:'SOLDIERAPPAREL.ID',alamat:'Jl. Usaha 9'};
 const inv=vm.runInContext('coreNotaInvoiceHtml(rec,st,{})',c);
 assert.match(inv,/^<!doctype html><html lang="id">/);assert.match(inv,/@page\{size:A4 portrait;margin:14mm\}/);assert.ok(!/<script|<img/i.test(inv));
 assert.ok(!/color:#fff|background:#1b1f24/.test(inv),'nothing depends on a printed background: PDF and browser print drop it');assert.match(inv,/\.jumlah \.total td\{border-top:2px solid #1b1f24;border-bottom:2px solid #1b1f24;font-weight:bold/);
 assert.match(inv,/<div class="usaha">SOLDIER APPAREL<\/div><div class="kecil">SOLDIERAPPAREL\.ID<\/div><div class="kecil">Jl\. Usaha 9<\/div>/);assert.match(inv,/No\. <b>SA-261013-007<\/b><\/div><div class="kecil">Tanggal 13 Okt 2026<\/div>/);
 assert.match(inv,/<div class="nama">Toko &amp; Uji<\/div><div class="kecil">0800<\/div><div class="kecil">Jl\. Contoh 1<\/div>/);assert.match(inv,/border-color:#b26a00">DP \/ BELUM LUNAS<\/span>/);
 assert.match(inv,/<tr><td class="tengah">1<\/td><td><b>Oblong<\/b><div class="kecil">Hitam<\/div><\/td><td class="tengah">XL<\/td><td class="tengah">12<\/td><td class="kanan">Rp 4\.500<\/td><td class="tengah">-<\/td><td class="kanan">Rp 54\.000<\/td><\/tr>/);
 assert.match(inv,/<td><b>Topi &lt;x&gt;<\/b><\/td><td class="tengah">-<\/td><td class="tengah">2<\/td><td class="kanan">Rp 10\.000<\/td><td class="tengah">10%<\/td><td class="kanan">Rp 18\.000<\/td>/);
 assert.match(inv,/<td>Subtotal<\/td><td class="kanan">Rp 72\.000<\/td><\/tr><tr><td>Diskon \(5%\)<\/td><td class="kanan">-Rp 3\.600<\/td><\/tr><tr><td>Ongkir<\/td><td class="kanan">Rp 3\.000<\/td><\/tr><tr class="total"><td>TOTAL<\/td><td class="kanan">Rp 71\.400<\/td><\/tr><tr><td>Sudah dibayar<\/td><td class="kanan">Rp 25\.000<\/td><\/tr><tr class="sisa"><td>SISA TAGIHAN<\/td><td class="kanan">Rp 46\.400<\/td>/);
 assert.match(inv,/<div class="kotak">Baris satu<br>Baris dua<\/div>/);assert.match(inv,/<td>13 Okt 2026<\/td><td>Tunai<\/td><td class="kanan">Rp 20\.000<\/td><\/tr><tr><td>14 Okt 2026<\/td><td>Transfer<\/td><td class="kanan">Rp 5\.000<\/td>/);assert.ok(!inv.includes('Rp 999'),'a corrected payment is not printed');
 /* without any discount the column is left out; a paid nota says LUNAS; a deleted one says so */
 c.rec={...record,items:[record.items[0]],discountPercent:0,discountAmount:0,shipping:0,subtotal:54000,total:54000,totalPaid:54000,balance:0,status:'lunas'};
 const lunas=vm.runInContext('coreNotaInvoiceHtml(rec,st,{})',c);assert.ok(!lunas.includes('Disk.')&&!lunas.includes('Diskon')&&!lunas.includes('Ongkir'));assert.match(lunas,/border-color:#2e7d32">LUNAS<\/span>/);
 c.rec={...record,status:'batal',cancelled:true};assert.match(vm.runInContext('coreNotaInvoiceHtml(rec,st,{})',c),/>DIBATALKAN<\/span>[\s\S]*tidak berlaku sebagai tagihan/);
 /* thermal receipt */
 c.rec=record;const s58=vm.runInContext('coreNotaStrukHtml(rec,st,{})',c),s80=vm.runInContext("coreNotaStrukHtml(rec,st,{lebar:80,logo:'data:image/png;base64,AAAA'})",c);
 assert.match(s58,/\.struk\{width:48mm;/);assert.match(s80,/\.struk\{width:72mm;/);assert.ok(!s58.includes('<img'));assert.match(s80,/<img class="logo" src="data:image\/png;base64,AAAA" alt="">/);
 assert.match(s58,/<div class="t usaha">SOLDIER APPAREL<\/div>/);assert.match(s58,/<td>No<\/td><td class="kw">SA-261013-007<\/td>/);assert.match(s58,/<td>Pelanggan<\/td><td class="kw">Toko &amp; Uji<\/td>/);
 assert.match(s58,/<div class="b">Oblong Hitam XL<\/div><table><tr><td>12 x 4\.500<\/td><td class="k">54\.000<\/td><\/tr><\/table><div class="b">Topi &lt;x&gt;<\/div><table><tr><td>2 x 10\.000 -10%<\/td><td class="k">18\.000<\/td>/);
 assert.match(s58,/<td>Subtotal<\/td><td class="k">72\.000<\/td><\/tr><tr><td>Diskon 5%<\/td><td class="k">-3\.600<\/td><\/tr><tr><td>Ongkir<\/td><td class="k">3\.000<\/td><\/tr><tr class="besar"><td>TOTAL<\/td><td class="k">71\.400<\/td><\/tr><tr><td>Tunai<\/td><td class="k">50\.000<\/td><\/tr><tr><td>Kembali<\/td><td class="k">30\.000<\/td><\/tr><tr><td>Dibayar<\/td><td class="k">25\.000<\/td><\/tr><tr class="besar"><td>SISA<\/td><td class="k">46\.400<\/td>/);
 assert.match(s58,/\*\* DP \/ BELUM LUNAS \*\*<\/div><div class="t">Terima kasih<\/div>/);
});
