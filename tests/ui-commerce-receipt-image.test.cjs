'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
const ui=html.slice(html.indexOf('/* COMMERCE UI START'),html.indexOf('/* COMMERCE UI END */'));
function harness(){
 const canvases=[];
 const document={createElement(type){assert.equal(type,'canvas');const canvas={width:300,height:150,texts:[],rects:[],scale:1};const ctx={font:'',textAlign:'left',fillStyle:'',measureText(s){return {width:String(s).length*(parseFloat(this.font.match(/(\d+)px/)?.[1])||12)*.52};},scale(x,y){assert.equal(x,y);canvas.scale=x;},fillText(text,x,y){canvas.texts.push({text,x:x*canvas.scale,y:y*canvas.scale,font:this.font,align:this.textAlign,color:this.fillStyle});},fillRect(x,y,w,h){canvas.rects.push({x:x*canvas.scale,y:y*canvas.scale,w:w*canvas.scale,h:h*canvas.scale});},setLineDash(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},save(){},rect(){},clip(){},drawImage(){},restore(){}};canvas.getContext=()=>ctx;canvases.push(canvas);return canvas;}};
 const context=vm.createContext({console,document});
 vm.runInContext(`var A={},C={},R={},VIEWS={},S={state:{settings:{kopSlip:'Soldier Apparel'},me:{id:'owner',divisi:'owner'}},f:{},sub:{},img:{}},IMG_TOKO='cm.';function todayYmd(){return '2026-10-17';}function tglSlip(v){return v;}function me(){return S.state.me;}function isAdmin(){return true;}`,context);
 vm.runInContext(ui,context);
 vm.runInContext(`commerceFind=function(m,k,id){return k==='suppliers'?{id:'sup',nama:'Supplier Contoh',kontak:'0800',alamat:'Bandung'}:null;};commerceOrderSupplierId=function(){return 'sup';};commerceInvoiceLabel=function(o){return o.invoiceId||'INV';};`,context);
 const run=code=>vm.runInContext(code,context);
 const model=orders=>JSON.parse(run('JSON.stringify(commerceShareModel('+JSON.stringify(orders)+'))'));
 const draw=m=>{context.model=m;return run('commerceShareDraw(model,{})');};
 return {run,model,draw,canvases};
}
function order(extra={}){return {id:'o1',invoiceId:'INV-1',produkId:'p1',productName:'Topi Contoh',tanggalOrder:'2026-10-01',hargaSatuan:1000,items:[{id:'a',nama:'Hitam L',jumlah:200},{id:'b',nama:'Navy XL',jumlah:100}],totalQty:300,totalHarga:300000,totalPaid:100000,balance:200000,totalReceived:290,receivedByItem:{a:200,b:90},payments:[{id:'dp',tanggal:'2026-10-01',jumlah:100000,catatan:'DP'}],receipts:[{id:'r1',itemId:'a',tanggal:'2026-10-04',jumlah:200,catatan:'Kiriman pertama'},{id:'r2',itemId:'b',tanggal:'2026-10-07',jumlah:90,catatan:'Kiriman kedua'}],...extra};}

test('supplier image includes each live arrival date, variant and amount without mutating records',()=>{
 const h=harness(),source=order(),before=JSON.stringify(source);source.receipts.push({id:'wrong',itemId:'b',tanggal:'2026-10-06',jumlah:100,voided:true});const saved=JSON.stringify(source),m=h.model([source]);
 assert.equal(JSON.stringify(source),saved);assert.notEqual(saved,before);
 assert.deepEqual(m.orders[0].penerimaan.map(r=>[r.id,r.tanggal,r.varian,r.jumlah]),[['r1','2026-10-04','Hitam L',200],['r2','2026-10-07','Navy XL',90]]);
 assert.equal(m.orders[0].penerimaanTanpaRincian,0);assert.equal(m.orders[0].beres,false);assert.equal(m.orders[0].baris[1].sisa,10);
 const c=h.draw(m),text=c.texts.map(t=>t.text);for(const s of ['Supplier Contoh','RIWAYAT BARANG DITERIMA','2026-10-04','200 pcs','Hitam L','2026-10-07','90 pcs','Navy XL','Catatan: Kiriman pertama','Catatan: Kiriman kedua','DP / BELUM LUNAS'])assert.ok(text.includes(s),s);
 assert.ok(!text.includes('2026-10-06'));assert.ok(!text.includes('LUNAS'));
});

test('paid badge is prominent, settlement date follows only live reconciled payments, arrivals remain separate',()=>{
 const h=harness(),m=h.model([order({totalPaid:300000,balance:0,payments:[{id:'a',tanggal:'2026-10-01',jumlah:100000},{id:'b',tanggal:'2026-10-10',jumlah:200000},{id:'old',tanggal:'2026-10-14',jumlah:200000,voided:true}]})]);
 assert.equal(m.lunas,true);assert.equal(m.lunasTanggal,'2026-10-10');assert.equal(m.orders[0].beres,false);
 const c=h.draw(m),badge=c.texts.find(t=>t.text==='LUNAS');assert.ok(badge);assert.match(badge.font,/bold 21px/);assert.ok(c.texts.some(t=>t.text==='Pelunasan 2026-10-10'));assert.ok(c.texts.some(t=>t.text==='DITERIMA 290 DARI 300 PCS'));assert.ok(!c.texts.some(t=>t.text==='SUDAH DITERIMA SEMUA'));
});

test('invoice is only paid when all orders have trustworthy settled totals',()=>{
 const h=harness(),paid=order({totalPaid:300000,balance:0,payments:[{id:'p',tanggal:'2026-10-11',jumlah:300000}]}),pending=order({id:'o2',totalPaid:0,balance:300000,payments:[]});
 const mixed=h.model([paid,pending]);assert.equal(mixed.lunas,false);assert.equal(mixed.lunasTanggal,'');assert.equal(mixed.orders[0].lunas,true);
 for(const extra of [{paymentReview:true},{totalPaid:undefined},{balance:undefined},{totalHarga:undefined},{totalPaid:310000},{balance:10},{cancelled:true},{status:'batal'},{payments:[{id:'p',tanggal:'2026-10-12',jumlah:300000,sourceReview:true}]}]){
  const m=h.model([{...paid,...extra}]);assert.equal(m.lunas,false,JSON.stringify(extra));assert.ok(!h.draw(m).texts.some(t=>t.text==='LUNAS'),JSON.stringify(extra));
 }
 const both=h.model([paid,{...paid,id:'o2',payments:[{id:'p2',tanggal:'2026-10-15',jumlah:300000}]}]);assert.equal(both.lunas,true);assert.equal(both.lunasTanggal,'2026-10-15');
});

test('legacy and uncertain records do not invent receipt or settlement dates',()=>{
 const h=harness();
 for(const payments of [[],[{id:'p',jumlah:300000}],[{id:'p',tanggal:'2026-02-30',jumlah:300000}],[{id:'p',tanggal:'2026-10-12',jumlah:290000}]]){
  const m=h.model([order({receipts:[],totalPaid:300000,balance:0,payments})]);assert.equal(m.lunas,true);assert.equal(m.lunasTanggal,'');assert.equal(m.orders[0].penerimaanTanpaRincian,290);
  const text=h.draw(m).texts.map(t=>t.text).join(' ');assert.match(text,/Tanggal pelunasan belum tercatat/);assert.match(text,/290 pcs tercatat diterima pada data lama/);assert.match(text,/Tanggal dan rincian kedatangannya belum tercatat/);
 }
 const unknown=h.model([order({receiptReview:true,receipts:[{id:'bad-link',itemId:'deleted',tanggal:'2026-02-30',jumlah:290,sourceReview:true}]})]);
 assert.equal(unknown.orders[0].penerimaan[0].varian,'Varian belum terhubung');assert.equal(unknown.orders[0].penerimaan[0].tanggal,'');assert.equal(unknown.orders[0].beres,false);assert.equal(unknown.orders[0].baris[0].diterima,null);
 const text=h.draw(unknown).texts.map(t=>t.text).join(' ');assert.match(text,/Tanggal belum tercatat/);assert.match(text,/PENERIMAAN PERLU DIPERIKSA/);assert.doesNotMatch(text,/SUDAH DITERIMA SEMUA/);
});

test('long receipt and payment histories wrap completely and fit their measured canvas',()=>{
 const h=harness(),count=450,receipts=Array.from({length:count},(_,i)=>({id:'r'+i,itemId:'a',tanggal:'2026-10-'+String(1+i%17).padStart(2,'0'),jumlah:1,catatan:'Kiriman nomor '+i+' '+('rincian '.repeat(15))+'SELESAI_'+i})),source=order({items:[{id:'a',nama:'Hitam L',jumlah:count}],totalQty:count,totalHarga:450000,totalPaid:450000,balance:0,totalReceived:count,receivedByItem:{a:count},receipts,payments:[{id:'payment',tanggal:'2026-10-17',jumlah:450000,catatan:'PELUNASAN TERAKHIR '+('bukti '.repeat(120))+'AKHIR_PEMBAYARAN'}],catatan:'CATATAN INVOICE '+('pesan '.repeat(120))+'AKHIR_CATATAN'}),m=h.model([source]),c=h.draw(m),text=c.texts.map(t=>t.text).join(' ');
 assert.equal(m.orders[0].penerimaan.length,count);for(let i=0;i<count;i++)assert.ok(text.includes('SELESAI_'+i),'receipt '+i+' kept');assert.ok(text.includes('AKHIR_PEMBAYARAN'));assert.ok(text.includes('AKHIR_CATATAN'));assert.ok(c.height<=32761);assert.ok(c.width*c.height<17000000);
 for(const t of c.texts){assert.ok(t.y>0&&t.y<c.height,'text stays within image: '+t.text);assert.ok(t.x>=0&&t.x<c.width);}
 assert.ok(c.rects.every(r=>r.y+r.h<=c.height+.01),'footer and panels fit');assert.equal(h.canvases.length,1,'no cropped second canvas');
});

test('historical aggregate totals remain distinct from real arrival events',()=>{
 const h=harness(),m=h.model([order({totalReceived:295})]);assert.equal(m.orders[0].penerimaan.length,2);assert.equal(m.orders[0].penerimaanTanpaRincian,5);
 const c=h.draw(m),text=c.texts.map(t=>t.text).join(' ');assert.match(text,/5 pcs tercatat diterima pada data lama/);
 const mismatch=h.model([order({totalReceived:280})]);assert.equal(mismatch.orders[0].penerimaanTanpaRincian,0);assert.equal(mismatch.orders[0].penerimaanTidakCocok,true);assert.match(h.draw(mismatch).texts.map(t=>t.text).join(' '),/Jumlah riwayat penerimaan berbeda/);
});

test('supplier image pairs models in two columns and starts the next pair below the taller history',()=>{
 const h=harness(),rows=Array.from({length:5},(_,i)=>order({id:'o'+i,productName:'Model-'+(i+1),receipts:i===0?Array.from({length:9},(_,j)=>({id:'r'+j,itemId:'a',tanggal:'2026-10-04',jumlah:10,catatan:'Kedatangan '+j})):[],totalReceived:i===0?90:0,receivedByItem:{a:i===0?90:0,b:0}}));
 const c=h.draw(h.model(rows)),titles=rows.map((_,i)=>c.texts.find(t=>t.text===(i+1)+'. Model-'+(i+1)));
 assert.equal(c.width/c.scale,1040);assert.equal(titles[0].y,titles[1].y);assert.ok(titles[1].x>c.width/2);
 assert.equal(titles[2].y,titles[3].y);assert.ok(titles[2].y>c.texts.find(t=>t.text==='Catatan: Kedatangan 8').y);assert.ok(titles[4].y>titles[2].y);assert.ok(c.texts.find(t=>t.text.startsWith('GRAND TOTAL')).y>titles[4].y);
 const innerLeft=38*c.scale,innerRight=498*c.scale,rightStart=542*c.scale,rightEnd=1002*c.scale;
 for(const t of c.texts.filter(t=>t.y>=titles[0].y&&t.y<c.texts.find(t=>t.text.startsWith('GRAND TOTAL')).y)){
  const size=Number(t.font.match(/(\d+)px/)[1]),w=t.text.length*size*.52*c.scale,lo=t.align==='right'?t.x-w:t.align==='center'?t.x-w/2:t.x,hi=t.align==='right'?t.x:t.align==='center'?t.x+w/2:t.x+w;
  assert.ok((lo>=innerLeft-.01&&hi<=innerRight+.01)||(lo>=rightStart-.01&&hi<=rightEnd+.01),'text fits its column: '+t.text);
 }
});

test('one model stays full width and multi-model canvas retains the final text of long wrapped fields',()=>{
 const h=harness(),single=h.draw(h.model([order()]));assert.equal(single.width/single.scale,640);
 const a=order({productName:'NAMA '.repeat(25)+'AKHIR_NAMA',items:[{id:'a',nama:'VARIAN '.repeat(20)+'AKHIR_VARIAN',jumlah:300}],receivedByItem:{a:290}}),b=order({id:'o2',productName:'Model kedua'}),c=h.draw(h.model([a,b])),text=c.texts.map(t=>t.text).join(' ');
 assert.match(text,/AKHIR_NAMA/);assert.match(text,/AKHIR_VARIAN/);assert.match(text,/Kiriman kedua/);
 assert.ok(c.texts.every(t=>t.y>0&&t.y<c.height));
});
