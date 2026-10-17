'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8'),start=html.indexOf('function commerceHppEvidence(m)'),end=html.indexOf('VIEWS.hpp=',start);assert.ok(start>=0&&end>start);
function draw(m){const c=vm.createContext({m});vm.runInContext(`function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}function nf(v){return String(v);}function nfQty(v){return String(v);}function rp(v){return 'Rp'+v;}function satuanPendek(v){return v;}function tgl(v){return String(v);}`+html.slice(start,end),c);return vm.runInContext('commerceHppEvidence(m)',c);}
function model(){return {basis:{ukuran:'XL',includedPcs:100},kain:{complete:true,totalCost:880000,totalPcs:100,perPcs:8800,details:[{jenis:'Katun',unit:'kg',qty:10,avgHarga:88000,totalCost:880000,priceSource:'koreksi-harga'}],observasi:{sizes:[{size:'XL',jumlah:100}],qtyByUnit:{kg:10},yieldByUnit:{kg:10},verifiedRollCount:1,fullRollPcs:100,fullRollCount:1,pcsPerFullRoll:100,provisional:false,notes:[]}}};}
test('HPP evidence shows the XL weighted cost equation and actual full roll output',()=>{
 const out=draw(model());assert.match(out,/acuan ukuran XL/);assert.match(out,/XL · 100 pcs/);assert.match(out,/Rp880000 ÷ 100 pcs = Rp8800 \/ pcs/);assert.match(out,/10 kg/);assert.match(out,/10 pcs \/ kg/);assert.match(out,/100 pcs \/ rol/);assert.match(out,/100 pcs dari 1 rol/);assert.match(out,/Rp88000 \/ kg/);assert.doesNotMatch(out,/>M ·|>L ·|sementara/);
});
test('partial or shared rolls do not present invented full-roll yield and incomplete prices hide cost equation',()=>{
 const m=model();m.kain.complete=false;m.kain.observasi.provisional=true;delete m.kain.observasi.pcsPerFullRoll;m.kain.observasi.notes=['Rol ini dipakai bersama ukuran lain.'];
 const out=draw(m);assert.match(out,/Lengkapi harga dan pemakaian/);assert.match(out,/Rata-rata pcs per rol tampil setelah/);assert.match(out,/Acuan sementara/);assert.match(out,/dipakai bersama ukuran lain/);assert.doesNotMatch(out,/Hasil rol penuh|Rp880000 ÷/);
});
test('HPP evidence handles absent observations and escapes material and source notes',()=>{
 assert.doesNotThrow(()=>draw({kain:{}}));const m=model();m.kain.details[0].jenis='<img onerror=bad>';m.kain.observasi.notes=['<script>bad</script>'];const out=draw(m);assert.match(out,/&lt;img/);assert.match(out,/&lt;script/);assert.doesNotMatch(out,/<img|<script>/);
});
