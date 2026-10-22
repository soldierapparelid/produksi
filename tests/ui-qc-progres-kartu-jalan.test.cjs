'use strict';
/* 1543d: "Progres QC" di Beranda owner dan cetakan "Kartu jalan PO" (empat kartu memanjang per lembar A4). Semua data buatan. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
const esc="function esc(s){return String(s===undefined||s===null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\"/g,'&quot;');}";

function beranda(){
  const c=vm.createContext({console});vm.runInContext(fs.readFileSync(path.join(root,'src/core.js'),'utf8'),c);
  vm.runInContext(esc+`var S={sub:{},state:{settings:{ukuran:['M','L','XL','XXL']}}},D={po:{}},batches=[];function nf(n){return String(n||0);}function qcSourceProgress(){return batches;}`,c);
  vm.runInContext(part('/* Progres QC untuk owner (1543d)','/* Perlu tindakan: semua hal tampil di sini'),c);
  return c;
}
const batch=(poId,date,ukuran,ready,waiting={},review={})=>({s:{id:poId+date,poId,ukuran},date,uk:ready,waitingUkuran:waiting,reviewUkuran:review});

test('the owner sees per PO how much is inspected and which sizes are done, partly done or not started',()=>{
  const c=beranda();
  c.D.po={a:{id:'a',nama:'Polo <b>',noPO:'PO-A'},b:{id:'b',nama:'Kaos',noPO:'PO-B'},beres:{id:'beres',nama:'Sudah',noPO:'PO-C'}};
  c.batches=[batch('b','2026-10-12',{M:30},{M:30}),batch('a','2026-10-10',{M:100,L:100,XL:50},{L:40,XL:50}),batch('a','2026-10-11',{L:20},{},{L:20}),batch('beres','2026-10-09',{M:10},{}),batch('hilang','2026-10-09',{M:10},{M:10})];
  const rows=JSON.parse(JSON.stringify(vm.runInContext('qcProgresPO()',c)));
  assert.deepEqual(rows.map(g=>[g.po.id,g.hitung,g.periksa]),[['a',270,160],['b',30,0]],'the oldest count first; a PO that is fully inspected or unknown is not listed');
  assert.deepEqual(rows[0].uk,{M:{hitung:100,periksa:100},L:{hitung:120,periksa:60},XL:{hitung:50,periksa:0}},'two counts of one PO are added per size; held pieces count as not inspected');
  const view=vm.runInContext('berandaQC()',c);
  assert.match(view,/<h3>Progres QC<\/h3><span class="chip warn">140 pcs belum QC<\/span>/);
  assert.match(view,/<b>Polo &lt;b><\/b> <span class="small muted">PO-A<\/span><\/span><span class="small">Sudah QC 160 dari 270 pcs · belum 110 pcs<\/span>/);
  assert.match(view,/<span class="chip ok"><b>M<\/b> beres<\/span><span class="chip warn"><b>L<\/b> 60\/120<\/span><span class="chip "><b>XL<\/b> 0\/50<\/span>/);
  assert.match(view,/<span class="small">Belum mulai QC · 30 pcs sudah dihitung<\/span>/);assert.match(view,/data-a="poOpen" data-id="a">Lihat<\/button>/);
  /* more than six POs: the rest is behind one tap */
  for(let i=0;i<7;i++){c.D.po['x'+i]={id:'x'+i,nama:'Tambahan '+i,noPO:'PO-X'+i};c.batches.push(batch('x'+i,'2026-10-13',{M:5},{M:5}));}
  let panjang=vm.runInContext('berandaQC()',c);assert.equal(panjang.split('data-a="poOpen"').length-1,6);assert.match(panjang,/data-a="sub" data-k="qcAll" data-v="1">Tampilkan semua · 3 PO lagi/);
  vm.runInContext("S.sub.qcAll='1'",c);panjang=vm.runInContext('berandaQC()',c);assert.equal(panjang.split('data-a="poOpen"').length-1,9);assert.match(panjang,/Ringkas lagi/);
  /* nothing waiting: the section is not shown at all */
  c.batches=[batch('beres','2026-10-09',{M:10},{})];assert.equal(vm.runInContext('berandaQC()',c),'');
  assert.match(html,/kpis \+ berandaDivisi\(todo, k\) \+ berandaQC\(\) \+/,'the section sits under the division report on the owner home');
});

function cetak(){
  const c=vm.createContext({console,Promise,Date,setTimeout,clearTimeout});vm.runInContext(fs.readFileSync(path.join(root,'src/core.js'),'utf8'),c);
  vm.runInContext(esc+`
    var A={},C={},S={img:{},state:{po:[],settings:{ukuran:['M','L','XL','XXL']}}},messages=[],dicetak=[],rencana=[],slipPreviews=[],lembar=null;
    function openSheet(fn,opt){lembar={render:fn,opt:opt};}function paintTop(){}function sheetHtml(t,b,f){return '<h2>'+t+'</h2>'+b+'<footer>'+(f||'')+'</footer>';}
    function emptyBox(s){return s;}function thumb(o){return '';}function ic(){return '';}function nf(n){return String(n||0);}function nfQty(n){return String(n).replace('.',',');}function satuanPendek(u){return u==='yard'?'yd':(u==='meter'?'m':'kg');}
    function tgl(s){return s;}function inisial(s){return String(s||'?').charAt(0).toUpperCase();}function gambarRef(o){return o.gambar?{id:o.id,ver:o.gambar}:null;}
    function poUkuranPotong(po){return po._potong||[];}function poUkuranAktif(po){return po._aktif||po._potong||[];}function T(po){return po.t||{};}function poSeri(po){return po.series||'';}
    function rencanaPotongRows(id){return rencana.filter(function(r){return r.poId===id;});}function rencanaPotongById(id){return null;}function rencanaPotongBlocked(){return '';}
    function poHarusDipotong(){return S.state.po.slice();}function poDaftar(){return {rows:S.state.po};}function toast(m,e){messages.push([m,!!e]);}function act(el,p){return p;}function quiet(){} function req(){return Promise.resolve({rows:[]});}function newId(){return 'print-id';}
  `,c);
  vm.runInContext(part('/* ---------- cetak daftar potong ---------- */','/* ---------- akhir cetak daftar potong ---------- */'),c);
  vm.runInContext("dokumenCetakBuka=function(html,o){dicetak.push({html:html,o:o});return Promise.resolve({preview:true});};",c);
  return c;
}

test('the travel card of a PO: four long cards on one A4 sheet, each with the item, its sizes and a box for every division',async()=>{
  const c=cetak();
  vm.runInContext(`S.state.po=[{id:'a',nama:'Polo <i>',noPO:'PO-01',series:'Recon',pelanggan:'Toko A',gambar:'v1',_potong:['L','XL'],_aktif:['M','L','XL']},{id:'b',nama:'Kaos',noPO:'PO-02',_potong:['M'],bahan:'Katun 24s'}];
    for(var i=0;i<3;i++)S.state.po.push({id:'x'+i,nama:'Tambahan '+i,noPO:'PO-1'+i,_potong:['M']});
    S.img={a:{ver:'v1',data:'data:image/png;base64,AAAA'}};rencana=[{id:'r1',poId:'a',status:'siap',bahanList:[{nama:'Scuba',qty:25.5,satuan:'kg'},{nama:'Rib',qty:2,satuan:'kg'}],rincianRol:[]}];`,c);
  const doc=vm.runInContext('kartuJalanHtml(potongCetakData(S.state.po))',c);
  assert.match(doc,/^<!doctype html><html lang="id">/);assert.match(doc,/@page\{size:A4 portrait;margin:8mm\}/);assert.match(doc,/grid-template-rows:repeat\(4,minmax\(0,1fr\)\)/);assert.ok(!/<script/i.test(doc));
  assert.ok(!/background:#1|color:#fff/.test(doc),'nothing depends on printed backgrounds');
  assert.deepEqual(doc.split('<section class="lembar">').slice(1).map(l=>l.split('<article class="kj">').length-1),[4,2],'five POs and six size cards: four cards on the first sheet');
  const kartu=doc.slice(doc.indexOf('<article class="kj">'),doc.indexOf('</article>'));
  assert.match(kartu,/<img class="foto" src="data:image\/png;base64,AAAA" alt=""><div><div class="merek">Kartu jalan PO<\/div><div class="no">PO-01<\/div><\/div><\/div><h2>Polo &lt;i><\/h2><div class="seri">Recon · Toko A<\/div>/);
  assert.match(kartu,/<div class="pil"><span>L<\/span><\/div><div class="bhn">Bahan: Scuba, Rib \(bersama PO\)<\/div>/,'one pending size per card; unallocated fabric is not repeated as a size allocation');
  assert.deepEqual([...kartu.matchAll(/<h3><b>(\d)<\/b>([^<]+)<\/h3>/g)].map(m=>m[1]+' '+m[2]),['1 Potong','2 Jahit','3 Hitung','4 QC','5 Gudang']);
  assert.match(kartu,/<h3><b>1<\/b>Potong<\/h3><div class="f"><span>Tgl<\/span><i><\/i><\/div><div class="uk"><span><b>L<\/b><i><\/i><\/span><\/div><div class="f"><span>Total<\/span><i><\/i><\/div><div class="f"><span>Paraf<\/span><i><\/i><\/div><\/section>/);
  assert.match(kartu,/<h3><b>4<\/b>QC<\/h3><div class="f"><span>Tgl<\/span><i><\/i><\/div><div class="f"><span>OK<\/span><i><\/i><\/div><div class="f"><span>Perbaikan<\/span><i><\/i><\/div><div class="f"><span>Reject<\/span><i><\/i><\/div><div class="f"><span>Paraf<\/span>/);
  assert.match(doc,/<span class="foto">K<\/span>[\s\S]*?<div class="bhn">Bahan: Katun 24s<\/div>/,'no picture and no prepared fabric: the initial and the fabric note of the PO');
  /* the button sits in the same print sheet and prints the ticked POs only; the cut list itself is unchanged */
  await vm.runInContext('A.potongCetak(null)',c);let view=vm.runInContext('lembar.render()',c);
  assert.match(view,/<button class="btn" data-a="close">Tutup<\/button><button class="btn" data-a="potongKartuJalan">Kartu jalan PO<\/button><button class="btn pri" data-a="potongCetakJalan">Cetak 5 PO<\/button>/);
  assert.match(view,/5 PO dipilih · 1 lembar A4 \(6 PO per lembar\)\.<\/div><div class="xs muted">Kartu jalan PO: [^<]*4 kartu memanjang per lembar A4 \(2 lembar\)\.<\/div>/);
  vm.runInContext("C.potongCetakCek({checked:false,getAttribute:function(){return 'b';}})",c);
  await vm.runInContext('A.potongKartuJalan(null)',c);
  const hasil=JSON.parse(JSON.stringify(vm.runInContext('dicetak',c)));assert.equal(hasil.length,1);assert.deepEqual(hasil[0].o,{nama:'kartu jalan PO',tanda:'.lembar'});
  assert.equal(hasil[0].html.split('<article class="kj">').length-1,5);assert.ok(!hasil[0].html.includes('PO-02'));
  await vm.runInContext('A.potongCetakJalan(null)',c);const daftar=JSON.parse(JSON.stringify(vm.runInContext('dicetak[1]',c)));
  assert.equal(daftar.o.nama,'daftar potong');assert.equal(daftar.html.split('<article class="kartu').length-1,4,'the cut list still prints as before');assert.ok(!daftar.html.includes('class="kj"'));
  vm.runInContext("A.potongCetakSemua({getAttribute:function(){return '0';}})",c);view=vm.runInContext('lembar.render()',c);assert.match(view,/data-a="potongKartuJalan" disabled>Kartu jalan PO/);
  vm.runInContext('A.potongKartuJalan(null)',c);assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('messages',c))).at(-1),['Centang dulu PO yang mau dicetak.',true]);
  assert.match(part('/* Kartu jalan PO (1543d)','/* ---------- akhir cetak daftar potong ---------- */'),/selesai:potongCetakSimpan\(data,'jalan'\)/,'records history only through the completed-print callback');
});
