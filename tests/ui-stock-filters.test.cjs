'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
function ui(){const c=vm.createContext({console});vm.runInContext(fs.readFileSync(path.join(root,'src/core.js'),'utf8'),c);vm.runInContext(`
 var S={state:{stokRingkas:[{nama:'Katun habis',status:'habis',satuan:'kg',saldo:0,nilai:0},{nama:'Katun tersedia',status:'aman',satuan:'kg',saldo:20,nilai:200,dicadangkan:5,tersedia:15},{nama:'Rib menipis',status:'menipis',satuan:'kg',saldo:2,nilai:30},{nama:'Linen tersedia',status:'aman',satuan:'meter',saldo:8,nilai:80},{nama:'Selisih',status:'minus',satuan:'kg',saldo:-1,nilai:-10},{nama:'Disembunyikan',status:'aman',satuan:'kg',saldo:999,nilai:999,sembunyi:true}]},f:{q:'',stokFilter:'habis'},sub:{stok:'saldo'}},C={},VIEWS={},paints=0,view='';
 function esc(x){return String(x==null?'':x).replace(/</g,'&lt;');}function nf(n){return String(n);}function rp(n){return 'Rp '+n;}function ic(){return '';}function seg(){return '';}function searchBox(){return '<input data-q="q">';}function emptyBox(s){return s;}
 function cocok(q,words){return !q||words.join(' ').toLowerCase().includes(q.toLowerCase());}function paintList(){paints++;view=S.listFn();}
 `,c);vm.runInContext(part('function stokSemua()','function dalamRentang('),c);vm.runInContext(part('function jumlahPerSatuan(','function pilihRentang('),c);vm.runInContext(part('function stokSaldoRows(','/* ---------- pembelian ---------- */'),c);return {run:s=>vm.runInContext(s,c)};}
test('changing stock dropdown updates captured list and its summary together without recreating view',()=>{
 const h=ui(),first=h.run('VIEWS.stok()');assert.match(first,/Katun habis/);assert.doesNotMatch(first,/Katun tersedia<|Linen tersedia</);assert.match(first,/Saldo fisik/);assert.match(first,/0 kg/);
 h.run("C.stokFilter({value:'ada'})");const next=h.run('view');assert.equal(h.run('paints'),1);assert.match(next,/Katun tersedia/);assert.match(next,/Linen tersedia/);assert.doesNotMatch(next,/Katun habis|Disembunyikan/);assert.match(next,/22 kg · 8 m/);assert.match(next,/Rp 310/);
 h.run("C.stokFilter({value:'habis'})");assert.match(h.run('view'),/Katun habis/);assert.doesNotMatch(h.run('view'),/Katun tersedia/);
});
test('search narrows both cards and mixed-unit summary and empty results show zero',()=>{
 const h=ui();h.run("S.f.stokFilter='all';VIEWS.stok();S.f.q='Linen';paintList()");const found=h.run('view');assert.match(found,/8 m/);assert.doesNotMatch(found,/22 kg|Katun|Rib/);assert.match(found,/Rp 80/);
 h.run("S.f.q='not-found';paintList()");assert.match(h.run('view'),/Tidak ada bahan yang cocok/);assert.match(h.run('view'),/Rp 0/);assert.doesNotMatch(h.run('view'),/999/);
});
test('physical stock labels distinguish reserved quantities without inventing missing roll weights',()=>{
 const h=ui();h.run("S.f.stokFilter='all';VIEWS.stok()");const card=h.run('stokKartu(S.state.stokRingkas[1])');assert.match(card,/Saldo fisik/);assert.match(card,/Dicadangkan 5 kg · Tersedia dipakai 15 kg/);assert.doesNotMatch(card,/Saldo tersedia/);
 const original=h.run('S.state.stokRingkas.map(function(x){return x.nama;}).join()');h.run("stokSaldoRows(stokTampil(),'all','')");assert.equal(h.run('S.state.stokRingkas.map(function(x){return x.nama;}).join()'),original);
});
