'use strict';
/* "Cetak daftar potong" (rakitan 1542c): pegangan kerja tukang potong di kertas A4, enam PO per lembar. Semua data di sini buatan. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
const blok=part('/* ---------- cetak daftar potong ---------- */','/* ---------- akhir cetak daftar potong ---------- */');
function ui(){
  const c=vm.createContext({console,Promise,Date,setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(path.join(root,'src/core.js'),'utf8'),c);
  vm.runInContext(`
    var A={},C={},S={img:{},state:{po:[],settings:{ukuran:['M','L','XL','XXL']}}},messages=[],dicetak=[],rencana=[],slipPreviews=[],lembar=null,digambar=0;
    function openSheet(fn,opt){lembar={render:fn,opt:opt};}function paintTop(){digambar++;}function sheetHtml(t,b,f){return '<h2>'+t+'</h2>'+b+'<footer>'+(f||'')+'</footer>';}
    function emptyBox(s){return '<div class="empty">'+s+'</div>';}function thumb(o){return '<span class="thumb">'+o.id+'</span>';}function ic(){return '';}
    function esc(s){return String(s===undefined||s===null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}
    function nf(n){return String(n||0);}function nfQty(n){return String(n).replace('.',',');}function satuanPendek(u){return u==='yard'?'yd':(u==='meter'?'m':'kg');}
    function tgl(s){return 'tgl '+s;}function inisial(s){return String(s||'?').charAt(0).toUpperCase();}
    function gambarRef(o){return o.gambar?{id:o.id,ver:o.gambar}:null;}
    function poUkuranPotong(po){return po._potong||[];}function T(po){return po.t||{};}function poSeri(po){return po.series||'';}
    function rencanaPotongRows(id){return rencana.filter(function(r){return r.poId===id;});}function rencanaPotongById(id){return rencana.filter(function(r){return r.id===id;})[0]||null;}
    function rencanaPotongBlocked(po){return po._blok||'';}
    function poHarusDipotong(){return S.state.po.slice();}function poDaftar(){return {rows:S.state.po.filter(function(p){return !p._sembunyi;})};}
    function toast(m,e){messages.push([m,!!e]);}function act(el,p){return p;}function quiet(){}
  `,c);
  vm.runInContext(blok,c);
  vm.runInContext("potongCetakBuka=function(html){dicetak.push(html);return Promise.resolve({preview:true});};",c);
  return c;
}
function run(c,s){return vm.runInContext(s,c);}
const plain=v=>JSON.parse(JSON.stringify(v));
const seed=`
  S.state.po=[
    {id:'a',nama:'Polo Tunggu',noPO:'PO-01',series:'Recon',_potong:['XL']},
    {id:'b',nama:'Polo Siap',noPO:'PO-02',series:'Ghost',gambar:'v2',ukuran:{L:24},_potong:['M','L'],deadline:'2026-10-20',catatan:'Kerah rib'},
    {id:'c',nama:'Polo Lanjut',noPO:'PO-03',series:'Recon',gambar:'v1',cutting:{lanjut:'r-awal'},_potong:['XXL'],t:{potong:40}},
    {id:'d',nama:'Polo Periksa',noPO:'PO-04',_potong:['M'],_blok:'PO masih perlu pemeriksaan catatan produksi.'},
    {id:'e',nama:'Kaos <script>',noPO:'PO-05',_potong:['L'],bahan:'Katun 24s',pelanggan:'Toko A'}
  ];
  S.img={b:{ver:'v2',data:'data:image/png;base64,AAAA'},c:{ver:'lama',data:'data:image/png;base64,BBBB'}};
  rencana=[
    {id:'r-b',poId:'b',status:'siap',bahanList:[{nama:'Katun Combed',qty:67.5,satuan:'kg'}],rol:3,catatan:'Rib ikut bahan',
      rincianRol:[{stokId:'1',bahan:'Katun Combed',qty:22,satuan:'kg',ukuran:'L'},{stokId:'2',bahan:'Katun Combed',qty:22.5,satuan:'kg',ukuran:'M'},{stokId:'3',bahan:'Katun Combed',qty:23,satuan:'kg',ukuran:'M'}]},
    {id:'r-lama',poId:'b',status:'batal',bahanList:[{nama:'Salah',qty:1,satuan:'kg'}],rincianRol:[]},
    {id:'r-awal',poId:'c',status:'dipotong',bahanList:[{nama:'Lacoste',qty:40,satuan:'kg'}],rol:2,rincianRol:[{stokId:'4',bahan:'Lacoste',qty:19,satuan:'kg'},{stokId:'5',bahan:'Lacoste',qty:21,satuan:'kg'}]},
    {id:'r-d',poId:'d',status:'siap',bahanList:[{nama:'Tertahan',qty:9,satuan:'kg'}],rincianRol:[]}
  ];`;

test('the work list puts POs whose fabric is ready first and carries sizes, targets, fabric and the cached picture',()=>{
  const c=ui();run(c,seed);
  const data=plain(run(c,'potongCetakData(S.state.po)'));
  assert.deepEqual(data.map(x=>[x.po.id,x.tahap]),[['b','siap'],['c','lanjut'],['a','tunggu'],['e','tunggu'],['d','periksa']]);
  assert.deepEqual(data[0].ukuran,[{s:'M',target:0},{s:'L',target:24}]);assert.deepEqual(data[0].rencana.map(r=>r.id),['r-b'],'a cancelled preparation is not printed');
  assert.equal(data[0].gambar,'data:image/png;base64,AAAA');assert.equal(data[1].gambar,'','a picture of an older version is not used');
  assert.deepEqual(data[1].rencana.map(r=>r.id),['r-awal'],'a continued cut shows the fabric of its first preparation');assert.equal(data[1].sudah,40);
  assert.deepEqual(data[4].rencana,[],'a PO under review prints no fabric');
});

test('one A4 sheet holds six POs; each card shows picture, sizes to cut, fabric per size and boxes to write the result',()=>{
  const c=ui();run(c,seed);
  run(c,"for(var i=0;i<2;i++)S.state.po.push({id:'x'+i,nama:'Tambahan '+i,noPO:'PO-1'+i,_potong:['M']});");
  const doc=run(c,"potongCetakHtml(potongCetakData(S.state.po),new Date('2026-10-13T02:00:00Z'))");
  assert.match(doc,/^<!doctype html><html lang="id">/);assert.match(doc,/@page\{size:A4 portrait;margin:8mm\}/);assert.ok(!/<script/i.test(doc),'no script in the printed page');
  const lembar=doc.split('<section class="lembar">').slice(1);
  assert.deepEqual(lembar.map(l=>l.split('<article class="kartu').length-1),[6,1],'seven POs: six on the first sheet, one on the second');
  assert.match(lembar[0],/7 PO · 2 bahan siap · 5 belum<br>Dicetak 13 Okt 2026[, ]+09[.:]00 WIB · lembar 1\/2/);assert.match(lembar[1],/lembar 2\/2/);
  const siap=doc.slice(doc.indexOf('<article class="kartu t-siap">'),doc.indexOf('<article class="kartu t-lanjut">'));
  assert.match(siap,/<span class="no">PO-02<\/span><span class="seri">Ghost<\/span><span class="tahap">Bahan siap<\/span>/);
  assert.match(siap,/<img class="foto" src="data:image\/png;base64,AAAA" alt=""><div class="judul"><h2>Polo Siap<\/h2><div class="label">Harus dipotong<\/div><div class="ukuran"><span class="uk">M<\/span><span class="uk">L<small>24 pcs<\/small><\/span><\/div><div class="ket">Deadline tgl 2026-10-20<\/div>/);
  assert.match(siap,/<div class="label">Bahan<\/div><div class="bahan"><div class="bn"><span>Katun Combed · 3 rol<\/span><b>67,5 kg<\/b><\/div><div class="rol"><b>M<\/b><span>22,5<\/span><span>23<\/span><\/div><div class="rol"><b>L<\/b><span>22<\/span><\/div><\/div><div class="cat">Rib ikut bahan<\/div><div class="cat">Catatan PO: Kerah rib<\/div>/);
  assert.match(siap,/<footer><div class="label">Hasil potong \(pcs\)<\/div><div class="hasil"><span><b>M<\/b><\/span><span><b>L<\/b><\/span><\/div><div class="ttd"><span>Tanggal<\/span><i><\/i><span>Pemotong<\/span><i><\/i><\/div><\/footer>/);
  const lanjut=doc.slice(doc.indexOf('<article class="kartu t-lanjut">'),doc.indexOf('<article class="kartu t-tunggu">'));
  assert.match(lanjut,/<span class="foto">P<\/span>/,'no cached picture: the initial instead');assert.match(lanjut,/<span class="uk">XXL<\/span><\/div><div class="ket">Sudah dipotong 40 pcs<\/div>/);
  assert.match(lanjut,/<span>Lacoste · 2 rol<\/span><b>40 kg<\/b><\/div><div class="rol"><span>19<\/span><span>21<\/span><\/div>/,'rolls without a size: one row of weights');
  assert.match(doc,/<h2>Kaos &lt;script><\/h2>/);assert.match(doc,/<span class="seri">Toko A<\/span><span class="tahap">Menunggu bahan<\/span>/);
  assert.match(doc,/<div class="belum">Bahan belum disiapkan owner\. Rencana bahan: Katun 24s<\/div>/);
  assert.match(doc,/<span class="tahap">Perlu diperiksa<\/span>[\s\S]*?<div class="belum">Catatan PO perlu diperiksa owner sebelum dipotong\.<\/div>/);assert.ok(!doc.includes('Tertahan'));
});

test('the button sits in "Harus dipotong" for owner and admin, prints the POs shown there and sends nothing to the server',async()=>{
  assert.match(html,/<div class="po-seri-h alat"><h3>Harus dipotong<\/h3>[^\n]*?' \+ \(admin \? '<button class="btn sm" data-a="potongCetak">' \+ ic\('list', 's'\) \+ 'Cetak daftar potong<\/button>' : ''\) \+ '<\/div>/);
  assert.ok(!/\breq\(|Api\.call\(/.test(blok),'reads only what is already on the device');
  const c=ui();run(c,seed);run(c,"S.state.po[0]._sembunyi=true;");
  run(c,'A.potongCetak(null)');assert.equal(run(c,'dicetak.length'),0,'the button opens the list to tick first');assert.deepEqual(plain(run(c,'lembar.opt')),{live:true,cls:'wide'});
  await run(c,"A.potongCetakJalan(null)");
  const cetak=plain(run(c,'dicetak'));assert.equal(cetak.length,1);assert.equal(cetak[0].split('<article class="kartu').length-1,4);assert.ok(!cetak[0].includes('Polo Tunggu'),'a PO that is not in the list on screen is not printed');
});

test('1542d: the owner ticks which POs are printed; all are ticked at first and the choice is kept while the app is open',async()=>{
  const c=ui();run(c,seed);run(c,'A.potongCetak(null)');
  const el=(id,on)=>`{checked:${on},getAttribute:function(){return ${JSON.stringify(id)};}}`,tombol=v=>`{getAttribute:function(){return ${JSON.stringify(v)};}}`;
  let view=run(c,'lembar.render()');
  assert.match(view,/^<h2>Cetak daftar potong<\/h2>/);assert.equal(view.split('data-c="potongCetakCek"').length-1,5);assert.equal(view.split(' checked>').length-1,5,'everything is ticked at first');
  assert.ok(view.indexOf('data-id="b"')<view.indexOf('data-id="c"')&&view.indexOf('data-id="c"')<view.indexOf('data-id="a"'),'same order as the print: fabric ready first');
  assert.match(view,/<label class="check cetak-baris"><input type="checkbox" data-c="potongCetakCek" data-id="b" checked><span class="thumb">b<\/span><span class="grow col gap-s"><b>Polo Siap<\/b><span class="xs muted">PO-02<\/span><span class="po-ukuran kecil"><span class="sz-aktif potong">M<\/span><span class="sz-aktif potong">L<\/span><\/span><\/span><span class="chip ok">Bahan siap<\/span><\/label>/);
  assert.match(view,/data-id="a" checked>[\s\S]*?<span class="chip warn">Menunggu bahan<\/span>/);assert.match(view,/data-id="d" checked>[\s\S]*?<span class="chip bad">Perlu diperiksa<\/span>/);assert.match(view,/<b>Kaos &lt;script><\/b>/);
  assert.match(view,/data-a="potongCetakSemua" data-v="1">Pilih semua<\/button><button class="btn ghost sm" data-a="potongCetakSemua" data-v="siap">Bahan siap saja<\/button><button class="btn ghost sm" data-a="potongCetakSemua" data-v="0">Kosongkan<\/button>/);
  assert.match(view,/5 PO dipilih · 1 lembar A4 \(6 PO per lembar\)\./);assert.match(view,/<button class="btn pri" data-a="potongCetakJalan">Cetak 5 PO<\/button>/);
  /* untick two: only the rest is printed, and the header of the sheet counts the chosen ones */
  run(c,`C.potongCetakCek(${el('a',false)});C.potongCetakCek(${el('d',false)})`);assert.equal(run(c,'digambar'),2);
  view=run(c,'lembar.render()');assert.match(view,/data-id="a">/);assert.match(view,/data-id="b" checked>/);assert.match(view,/3 PO dipilih · 1 lembar A4/);assert.match(view,/Cetak 3 PO<\/button>/);
  await run(c,'A.potongCetakJalan(null)');
  let doc=run(c,'dicetak[0]');assert.equal(doc.split('<article class="kartu').length-1,3);assert.ok(!doc.includes('Polo Tunggu')&&!doc.includes('Polo Periksa'));assert.match(doc,/3 PO · 2 bahan siap · 1 belum/);
  /* tick one back, then the quick buttons */
  run(c,`C.potongCetakCek(${el('a',true)})`);assert.match(run(c,'lembar.render()'),/4 PO dipilih/);
  run(c,`A.potongCetakSemua(${tombol('siap')})`);view=run(c,'lembar.render()');assert.match(view,/2 PO dipilih/);assert.match(view,/data-id="b" checked>/);assert.match(view,/data-id="c" checked>/);assert.match(view,/data-id="e">/);
  run(c,`A.potongCetakSemua(${tombol('0')})`);view=run(c,'lembar.render()');assert.match(view,/Belum ada PO dipilih\./);assert.match(view,/data-a="potongCetakJalan" disabled>Cetak<\/button>/);
  run(c,'A.potongCetakJalan(null)');assert.deepEqual(plain(run(c,'messages')),[['Centang dulu PO yang mau dicetak.',true]]);assert.equal(run(c,'dicetak.length'),1,'nothing chosen: nothing is printed');
  run(c,`A.potongCetakSemua(${tombol('1')})`);assert.match(run(c,'lembar.render()'),/5 PO dipilih/);
  /* eight chosen POs need two sheets; the choice survives closing and opening the list */
  run(c,"for(var i=0;i<3;i++)S.state.po.push({id:'x'+i,nama:'Tambahan '+i,noPO:'PO-1'+i,_potong:['M']});");run(c,`C.potongCetakCek(${el('x0',false)})`);
  run(c,'lembar=null;A.potongCetak(null)');view=run(c,'lembar.render()');assert.match(view,/7 PO dipilih · 2 lembar A4/);assert.match(view,/data-id="x0">/);
  /* nothing to cut: a plain note, no print button that works */
  run(c,'S.state.po=[];');view=run(c,'lembar.render()');assert.match(view,/Tidak ada PO yang harus dipotong\./);assert.match(view,/data-a="potongCetakJalan" disabled>/);
  assert.match(html,/\.cetak-baris \{ align-items: center;/);
});
