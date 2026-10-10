const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function between(a, b) {
  const start = html.indexOf(a), end = html.indexOf(b, start + a.length);
  assert.ok(start >= 0 && end > start, a);
  return html.slice(start, end);
}
function context() {
  const c = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core.js'), 'utf8'), c);
  vm.runInContext(`var S={state:{},sub:{}},D={po:{},user:{},produk:{}},VIEWS={},dibayar={},tersimpan={};
    var LS={get:function(k){return tersimpan[k]||'';},set:function(k,v){tersimpan[k]=String(v);}};
    function pos(n){return n>0?n:0;} function esc(s){return String(s==null?'':s);} function nf(n){return String(n);} function rp(n){return 'Rp '+n;}
    function ic(n){return '<i data-ic="'+n+'"></i>';} function tgl(s){return String(s);} function lalu(){return 'tadi';} function todayYmd(){return coreYmd(new Date());}
    function namaUser(id){return (D.user[id]||{}).nama||'?';} function poNama(id){return (D.po[id]||{}).nama||'?';}
    function selisihHari(ymd){ if(!ymd) return null; return Math.round((new Date(ymd+'T00:00:00')-new Date(todayYmd()+'T00:00:00'))/86400000); }
    function T(po){return (po.agg&&po.agg.total)||{};} function poAktif(){return S.state.po.filter(function(p){return p.status==='aktif';});}
    function emptyBox(t){return '<div class="empty">'+t+'</div>';} function maklonAktif(){return [];} function tglPanjang(){return '';} function inisial(){return 'X';}
    function sumUpah(){return 0;} function unpaidOf(){return [];} function isAdmin(){return true;} function commerceHomeCards(){return '';}
    function sourcePaid(r){return !!r.upahId||!!dibayar[r.id];} function sourceCanEditRate(r){return !sourcePaid(r);}
    function setorLaporanLama(r){return r.asal==='lama'&&r.status==='diajukan';} function poUkuranPotong(po){return po.perluPotong||[];}
    function tarifBawaan(po,f){var p=D.produk[po.produkId];return p?Number(p[f])||0:0;} function poTahap(po){return {k:po.tahap||'maklon'};}
    function qcBalance(po){return {ready:po.siapQC||0,waiting:po.qcTahan||0};} function nfQty(n){return String(n);} function satuanPendek(s){return s;}`, c);
  vm.runInContext(between('function tindakan() {', 'function tglPanjang('), c);
  return c;
}
/* satu potongan dan satu slip tanpa harga, sembilan setoran baru dan satu laporan lama yang belum dihitung, satu penjahit telat */
function isi(c) {
  vm.runInContext(`var hari=todayYmd(), lama=coreYmd(new Date(Date.now()-45*86400000));
    D.user={ajang:{nama:'Ajang'},atep:{nama:'Atep'},teteh:{nama:'Teteh'}};
    D.produk={kaos:{id:'kaos',nama:'Kaos Loreng',tarifPotong:0,tarifJahit:0},polo:{id:'polo',nama:'Polo',tarifPotong:1000,tarifJahit:9000}};
    var p1={id:'p1',noPO:'PO-1',nama:'Kaos Loreng',status:'aktif',jenis:'stok',produkId:'kaos',perluPotong:['XL'],agg:{total:{potong:141,siapKirim:141,sisaMaklon:0,diajukan:0,stok:0,qcPerbaikan:0},maklon:{}}};
    var p2={id:'p2',noPO:'PO-2',nama:'Polo',status:'aktif',jenis:'stok',produkId:'polo',siapQC:60,agg:{total:{potong:300,siapKirim:0,sisaMaklon:120,diajukan:90,stok:25,qcPerbaikan:5},maklon:{atep:{sisa:120,diajukan:90,target:lama}}}};
    var p3={id:'p3',noPO:'PO-3',nama:'Oblong',status:'aktif',jenis:'stok',produkId:'polo',tahap:'tuntas',agg:{total:{potong:50,stok:0},maklon:{}}};
    D.po={p1:p1,p2:p2,p3:p3};
    var setor=[{id:'s1',noSlip:'ST-1',poId:'p2',maklonId:'atep',status:'diterima',tanggal:hari,total:60,reject:3,upah:0,dibuat:hari+'T11:00:00Z'},
      {id:'s2',noSlip:'ST-2',poId:'p2',maklonId:'teteh',status:'diterima',tanggal:hari,total:30,upah:9000,dibuat:hari+'T11:30:00Z'},
      {id:'tua',noSlip:'L-1',poId:'p2',maklonId:'atep',status:'diajukan',asal:'lama',tanggal:lama,total:500,dibuat:lama+'T08:00:00Z'}];
    for(var i=1;i<=9;i++) setor.push({id:'f'+i,noSlip:'F-'+i,poId:'p2',maklonId:'atep',status:'diajukan',tanggal:hari,total:i*10,dibuat:hari+'T14:0'+i+':00Z'});
    S.state={po:[p1,p2,p3],users:[{id:'ajang',aktif:true,divisi:'potong'},{id:'atep',aktif:true,divisi:'jahit'},{id:'q',aktif:true,divisi:'qc'}],stokRingkas:[],
      potong:[{id:'c1',poId:'p1',userId:'ajang',tanggal:hari,total:141,tarif:0,dibuat:hari+'T09:00:00Z'},{id:'c2',poId:'p2',userId:'ajang',tanggal:hari,total:300,tarif:1000,dibuat:hari+'T08:00:00Z'},
        {id:'c3',poId:'p2',userId:'ajang',tanggal:lama,total:999,tarif:0,dibuat:lama+'T08:00:00Z'}],
      kirim:[{id:'k1',poId:'p2',maklonId:'atep',tanggal:hari,total:210,dibuat:hari+'T10:00:00Z'}], setor:setor,
      qc:[{id:'q1',poId:'p2',tanggal:hari,total:40,reject:2,perbaikan:5,offline:1,dibuat:hari+'T12:00:00Z'}],
      gudang:[{id:'g1',poId:'p2',tanggal:hari,total:15,dibuat:hari+'T13:00:00Z'}]};
    dibayar.c3=1;`, c);
}
function json(c, expr) { return JSON.parse(vm.runInContext(`JSON.stringify(${expr})`, c)); }
function hitung(teks, pola) { return (teks.match(pola) || []).length; }

test('a missing price comes first, a paid old record is left out, and old reports wait behind new ones', () => {
  const c = context(); isi(c);
  const todo = json(c, 'tindakan().map(function(x){return {k:x.k,j:x.j,a:x.a,id:x.id,s:x.s,v:x.v,cls:x.cls,t:x.t};})');
  assert.deepEqual(todo.slice(0, 2).map(x => [x.k, x.j, x.a, x.id, x.s]), [['harga', 'potong', 'hargaOpen', 'c1', 'Potong'], ['harga', 'jahit', 'hargaOpen', 's1', 'SlipSetor']]);
  assert.ok(!todo.some(x => x.id === 'c3'), 'potongan lama yang sudah dibayar tidak ditagih harganya');
  const urut = todo.map(x => x.k + (x.id === 'tua' ? ':lama' : ''));
  assert.ok(urut.indexOf('hitung') < urut.indexOf('telat') && urut.indexOf('telat') < urut.indexOf('hitung:lama'));
  assert.equal(todo.filter(x => x.k === 'hitung').length, 10);
  assert.deepEqual(todo.filter(x => x.k === 'tutup').map(x => [x.a, x.id, x.v]), [['poStatusSet', 'p3', 'selesai']]);
  assert.deepEqual(todo.filter(x => x.k === 'upah').map(x => [x.a, x.id, x.t]), [['produkOpen', 'kaos', 'Kaos Loreng belum punya upah potong dan jahit']]);
  assert.deepEqual(todo.filter(x => x.k === 'qc').map(x => x.id), ['p2']);
  assert.deepEqual(todo.filter(x => x.k === 'tugas').map(x => x.id), ['p1']);
});

test('a finished PO whose pieces are not yet in BigSeller is not offered for closing', () => {
  const c = context(); isi(c);
  vm.runInContext('p3.agg.total.stok=12;', c);
  assert.equal(json(c, 'tindakan().filter(function(x){return x.k==="tutup";}).length'), 0);
});

test('home lists every pending matter with filters instead of sending the owner to the PO tab', () => {
  const c = context(); isi(c);
  const total = json(c, 'tindakan().length');
  let view = vm.runInContext('VIEWS.beranda()', c);
  assert.doesNotMatch(view, /hal lain ada di tab PO/);
  assert.match(view, /class="siaga bad"/);
  assert.match(view, /14 masalah perlu ditindak<\/b> <span class="small muted">· 3 hal lain menunggu/);
  assert.match(view, /data-a="todoGo" data-v="harga">Harga kosong <b>2<\/b>/);
  assert.equal(hitung(view, /class="item todo /g), 8);
  assert.match(view, new RegExp('Tampilkan semua · ' + (total - 8) + ' lagi'));
  vm.runInContext("S.sub.todoAll='1';", c); view = vm.runInContext('VIEWS.beranda()', c);
  assert.equal(hitung(view, /class="item todo /g), total);
  assert.match(view, /Ringkas lagi/);
  vm.runInContext("S.sub.todoK='harga';", c); view = vm.runInContext('VIEWS.beranda()', c);
  assert.equal(hitung(view, /class="item todo /g), 2);
  assert.match(view, /data-a="sub" data-k="todoK" data-v="harga" class="on">Harga kosong<b>2<\/b>/);
  assert.match(view, /data-a="poStatusSet" data-id="p3" data-v="selesai"|data-k="todoK" data-v="tutup"/);
});

test('division report counts only the chosen period and points at each division problem', () => {
  const c = context(); isi(c);
  vm.runInContext("S.sub.bdP='hari';", c);
  const view = vm.runInContext('VIEWS.beranda()', c);
  assert.match(view, /<h3 class="grow">Potong<\/h3><\/div><div><div class="dv-n">441<\/div><div class="dv-u">pcs dipotong · 2 catatan/);
  assert.match(view, /<h3 class="grow">Jahit maklon<\/h3><\/div><div><div class="dv-n">90<\/div>/);
  assert.match(view, /Ditugaskan<\/span><b>210 pcs<\/b>/);
  assert.match(view, /<h3 class="grow">QC<\/h3><\/div><div><div class="dv-n">40<\/div>/);
  assert.match(view, /Reject<\/span><b>2 pcs<\/b>/);
  assert.match(view, /<h3 class="grow">BigSeller<\/h3><\/div><div><div class="dv-n">15<\/div>/);
  assert.match(view, /data-a="todoGo" data-v="harga"><i data-ic="alert"><\/i><span>1 potongan belum punya harga/);
  assert.match(view, /data-a="todoGo" data-v="hitung"><i data-ic="alert"><\/i><span>10 setoran belum dihitung/);
  assert.match(view, /class="bad" data-a="todoGo" data-v="telat"><i data-ic="alert"><\/i><span>1 telat dari target/);
  assert.match(view, /<span>1 slip belum punya harga/);
  assert.match(view, /data-a="berandaPeriode" data-v="hari" class="on">Hari ini/);
  vm.runInContext("S.sub.bdP='bulan';", c);
  assert.match(vm.runInContext('VIEWS.beranda()', c), /<div class="dv-n">441<\/div>/, 'catatan 45 hari lalu tidak masuk bulan ini');
});

test('recent notes can be acted on from their own row', () => {
  const c = context(); isi(c);
  vm.runInContext("S.sub.evAll='1';", c);
  let view = vm.runInContext('VIEWS.beranda()', c);
  assert.match(view, /class="btn sm perlu" data-a="hargaOpen" data-s="Potong" data-id="c1" data-v="0">Atur harga/);
  assert.match(view, /class="btn sm" data-a="hargaOpen" data-s="Potong" data-id="c2" data-v="1000">Harga/);
  assert.doesNotMatch(view, /data-a="hargaOpen" data-s="Potong" data-id="c3"/);
  assert.match(view, /class="btn sm perlu" data-a="terimaOpen" data-id="f9">Hitung/);
  assert.match(view, /data-a="slip" data-t="setor" data-id="s2">Slip/);
  assert.match(view, /data-a="slip" data-t="kirim" data-id="k1">Slip/);
  vm.runInContext("S.sub.evK='qc';", c); view = vm.runInContext('VIEWS.beranda()', c);
  assert.equal(hitung(view, /class="item ev /g), 1);
  assert.match(view, /QC 40 pcs lolos, 2 reject/);
});

test('a clean day says so, and the page actions exist', () => {
  const c = context(); isi(c);
  vm.runInContext(`S.state.setor=[];S.state.potong=[S.state.potong[1]];p1.agg.total.siapKirim=0;p1.perluPotong=[];p2.agg.maklon={};p2.agg.total.qcPerbaikan=0;p3.tahap='maklon';`, c);
  assert.equal(json(c, 'tindakan().length'), 0);
  const view = vm.runInContext('VIEWS.beranda()', c);
  assert.match(view, /class="siaga ok"/);
  assert.match(view, /Semua beres/);
  assert.match(view, /Tidak ada yang menunggu tindakan\./);
  assert.match(html, /A\.todoGo = function/);
  assert.match(html, /A\.berandaPeriode = function \(el\) \{ S\.sub\.bdP = el\.getAttribute\('data-v'\); LS\.set\('pk_beranda_periode'/);
});

test('a late sewing job can be given a new target from its own row; an order near its deadline opens the PO form', async () => {
  const c = context(); isi(c);
  vm.runInContext(`p2.jenis='pesanan';p2.pelanggan='Komunitas';p2.deadline=coreYmd(new Date(Date.now()+86400000));`, c);
  const telat = json(c, 'tindakan().filter(function(x){return x.k==="telat";}).map(function(x){return [x.btn,x.a,x.id,x.m||"",x.v===undefined?"":x.v,x.lihat];})');
  assert.deepEqual(telat, [['Ubah target', 'targetOpen', 'p2', 'atep', json(c, 'lama'), 'p2'], ['Ubah deadline', 'poEdit', 'p2', '', '', 'p2']]);
  vm.runInContext("S.sub.todoK='telat';", c);
  const view = vm.runInContext('VIEWS.beranda()', c);
  assert.match(view, /<button class="btn sm ghost" data-a="poOpen" data-id="p2">Lihat<\/button><button class="btn sm" data-a="targetOpen" data-id="p2" data-m="atep" data-v="\d{4}-\d\d-\d\d">Ubah target<\/button>/);
  assert.match(view, /<button class="btn sm ghost" data-a="poOpen" data-id="p2">Lihat<\/button><button class="btn sm" data-a="poEdit" data-id="p2">Ubah deadline<\/button>/);
  /* the dialog and what it sends */
  vm.runInContext(`var A={},sheets=[{node:{}}],log={req:[],toast:[],tutup:0},isian={poId:'p2',maklonId:'atep',target:'2026-10-25'};
    function hid(n,v){return '<input type="hidden" name="'+n+'" value="'+v+'">';} function fTanggal(l,n,v){return '<input type="date" name="'+n+'" value="'+v+'" data-label="'+l+'">';}
    function sheetHtml(t,b,f){return t+'|'+b+'|'+f;} function openSheet(fn){log.lembar=fn();} function closeSheet(){log.tutup++;} function formVals(){return isian;} function quiet(){}
    function toast(m,bad){log.toast.push((bad?'!':'')+m);} function act(el,p){return Promise.resolve(p);}
    function req(a,p){log.req.push([a,JSON.parse(JSON.stringify(p))]);return Promise.resolve({ok:true});}`, c);
  vm.runInContext(between('A.targetOpen = function', 'A.goPegawai = function'), c);
  vm.runInContext(`A.targetOpen({getAttribute:function(k){return {'data-id':'p2','data-m':'atep','data-v':lama}[k];}});`, c);
  const lembar = json(c, 'log.lembar');
  assert.match(lembar, /^Target selesai\|/); assert.match(lembar, /<b>Atep<\/b> · Polo · target sekarang /); assert.match(lembar, new RegExp('name="target" value="' + json(c, 'todayYmd()') + '"'), 'a target already in the past is not offered again');
  assert.match(lembar, /data-a="targetSave" data-kosong="1">Tanpa target/); assert.match(lembar, /class="btn pri" data-a="targetSave">Simpan/);
  vm.runInContext(`A.targetSave({getAttribute:function(){return null;}});A.targetSave({getAttribute:function(k){return k==='data-kosong'?'1':null;}});isian.target='';A.targetSave({getAttribute:function(){return null;}});`, c);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(json(c, 'log.req'), [['ubahTargetJahit', { poId: 'p2', maklonId: 'atep', target: '2026-10-25' }], ['ubahTargetJahit', { poId: 'p2', maklonId: 'atep', target: '' }]]);
  assert.equal(json(c, 'log.tutup'), 2); assert.match(json(c, 'log.toast').join('|'), /Target diubah\.\|Target dihapus\.|!Isi tanggal targetnya\./);
  assert.match(html, /data-a="targetOpen" data-id="' \+ esc\(po\.id\) \+ '" data-m="' \+ esc\(mid\) \+ '"/, 'the per-sewer table of a PO offers the same dialog');
});
