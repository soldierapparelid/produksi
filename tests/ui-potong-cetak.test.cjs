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
    var A={},S={img:{},state:{po:[],settings:{ukuran:['M','L','XL','XXL']}}},messages=[],dicetak=[],rencana=[],slipPreviews=[];
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
  await run(c,'A.potongCetak(null)');
  const cetak=plain(run(c,'dicetak'));assert.equal(cetak.length,1);assert.equal(cetak[0].split('<article class="kartu').length-1,4);assert.ok(!cetak[0].includes('Polo Tunggu'),'a PO that is not in the list on screen is not printed');
  run(c,'S.state.po=[];');run(c,'A.potongCetak(null)');
  assert.deepEqual(plain(run(c,'messages')),[['Tidak ada PO yang harus dipotong.',true]]);assert.equal(run(c,'dicetak.length'),1);
});
