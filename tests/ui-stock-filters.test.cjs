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

test('a stock card lists the recorded rolls and the kilos that have no roll detail yet; only the owner can itemise them',()=>{
 const h=ui();h.run(`var actor={divisi:'owner'};function me(){return actor;}function nfQty2(){return '';}
  S.state.stokRol=[{id:'r1',bahan:'katun  TERSEDIA',rollLabel:'Rol 1',saldo:25,dicadangkan:0,invoice:'BON-1'},{id:'r2',bahan:'Katun tersedia',rollLabel:'Rol 2',saldo:24,dicadangkan:4,invoice:'BON-1'},{id:'r3',bahan:'Katun tersedia',rollLabel:'Rol 3',saldo:0,dicadangkan:0},{id:'x',bahan:'Rib menipis',rollLabel:'Rol 9',saldo:2,dicadangkan:0}];
  S.state.stokRingkas[1].legacySaldo=7.5;S.f.stokFilter='all';VIEWS.stok()`);
 const card=h.run('stokKartu(S.state.stokRingkas[1])');assert.match(card,/<span class="rol-pil">2 rol tercatat<\/span>49 kg/,'the roll count stands out, with the kilos those rolls hold');assert.match(card,/<span class="chip info"[^>]*>Rol 1 · 25 kg<\/span>/);assert.match(card,/<span class="chip warn"[^>]*dicadangkan 4 kg[^>]*>Rol 2 · 24 kg<\/span>/);assert.doesNotMatch(card,/Rol 3|Rol 9/);
 assert.match(card,/Belum dirinci per rol: <b>7,5 kg<\/b>/);assert.match(card,/data-a="rinciRolOpen" data-b="Katun tersedia">Rinci rol/);
 h.run("S.state.stokRol=[];");const old=h.run('stokKartu(S.state.stokRingkas[1])');assert.match(old,/Belum ada rincian berat tiap rol: <b>7,5 kg<\/b>/);assert.doesNotMatch(old,/rol tercatat/);
 h.run("actor.divisi='admin'");assert.doesNotMatch(h.run('stokKartu(S.state.stokRingkas[1])'),/rinciRolOpen/);
 h.run("S.state.stokRingkas[3].legacySaldo=8");assert.doesNotMatch(h.run('stokKartu(S.state.stokRingkas[3])'),/stok-rol/,'only kg materials have rolls');assert.doesNotMatch(h.run('stokKartu(S.state.stokRingkas[0])'),/stok-rol/);
});
test('an itemised roll that nobody used yet can be tapped on the card to correct or remove it; other rolls stay plain',()=>{
 const h=ui();h.run("var actor={divisi:'owner'};function me(){return actor;}S.state.stokRol=[{id:'r1',bahan:'Katun tersedia',rollLabel:'Rol 1',saldo:25.5,rinci:true},{id:'r2',bahan:'Katun tersedia',rollLabel:'Rol 2',saldo:48.85,rinci:true,dicadangkan:10},{id:'r3',bahan:'Katun tersedia',rollLabel:'Rol 3',saldo:20},{id:'r4',bahan:'Katun tersedia',rollLabel:'Rol 4',saldo:9,rinci:true,pakai:1}];S.f.stokFilter='all';VIEWS.stok()");
 let card=h.run('stokKartu(S.state.stokRingkas[1])');assert.match(card,/<button type="button" class="chip info" data-a="rinciRolEdit" data-id="r1"[^>]*>Rol 1 · 25,5 kg /);assert.match(card,/Ketuk rol untuk mengubah berat atau menghapusnya/);
 for(const id of ['r2','r3','r4'])assert.ok(!card.includes('data-a="rinciRolEdit" data-id="'+id+'"'),id+' is reserved, bought, or already used');assert.match(card,/<span class="chip warn"[^>]*>Rol 2 · 48,85 kg<\/span>/);assert.match(card,/<span class="chip info"[^>]*>Rol 3 · 20 kg<\/span>/);
 h.run("actor.divisi='admin'");card=h.run('stokKartu(S.state.stokRingkas[1])');assert.doesNotMatch(card,/rinciRolEdit|Ketuk rol/);assert.match(card,/<span class="chip info"[^>]*>Rol 1 · 25,5 kg<\/span>/);
});
test('finished materials are listed last; anything that needs attention stays above what is simply available',()=>{
 const h=ui(),order=h.run("JSON.stringify(stokSaldoRows([{nama:'B habis',status:'habis'},{nama:'A aman',status:'aman'},{nama:'A habis',status:'habis'},{nama:'Z minus',status:'minus'},{nama:'M menipis',status:'menipis'},{nama:'K kritis',status:'kritis'}],'all','').map(function(b){return b.nama;}))");
 assert.deepEqual(JSON.parse(order),['Z minus','K kritis','M menipis','A aman','A habis','B habis']);
});