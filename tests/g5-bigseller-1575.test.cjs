'use strict';
/* 1.5.75 (g5): input BigSeller tidak wajib. Barang OK QC sudah barang jadi; tim mengisi stok langsung di BigSeller.
   Beranda tidak lagi menampilkan "Belum BigSeller" sebagai pekerjaan, dan PO yang produksinya selesai tetap ditawari
   "Tandai selesai" walau barangnya belum diinput ke BigSeller. Invented data only. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..'), html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function part(a, b) { const p = html.indexOf(a), q = html.indexOf(b, p + a.length); assert.ok(p >= 0 && q > p, a); return html.slice(p, q); }
const json = (c, expr) => JSON.parse(vm.runInContext('JSON.stringify(' + expr + ')', c));
function ui() {
  const c = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core.js'), 'utf8'), c);
  vm.runInContext(`var S={state:{},sub:{},f:{}},D={po:{},user:{},produk:{}},VIEWS={},tersimpan={};
    var LS={get:function(k){return tersimpan[k]||'';},set:function(k,v){tersimpan[k]=String(v);}};
    function pos(n){return n>0?n:0;} function esc(s){return String(s==null?'':s);} function nf(n){return String(n);} function rp(n){return 'Rp '+n;}
    function ic(n){return '<i data-ic="'+n+'"></i>';} function tgl(s){return String(s);} function lalu(){return 'tadi';} function todayYmd(){return coreYmd(new Date());}
    function namaUser(id){return (D.user[id]||{}).nama||'?';} function poNama(id){return (D.po[id]||{}).nama||'?';} function selisihHari(){return null;}
    function T(po){return (po.agg&&po.agg.total)||{};} function workflowFor(po){return po&&po.workflow||{ukuran:{},issues:[],complete:false,readyQC:false};}
    function poAktif(){return S.state.po.filter(function(p){return p.status==='aktif';});}
    function emptyBox(t){return '<div class="empty">'+t+'</div>';} function maklonAktif(){return [];} function tglPanjang(){return '';} function inisial(){return 'X';}
    function sumUpah(){return 0;} function unpaidOf(){return [];} function isAdmin(){return true;} function commerceHomeCards(){return '';}
    function sourcePaid(){return false;} function sourceCanEditRate(){return true;} function setorLaporanLama(){return false;}
    function poUkuranPotong(){return [];} function tarifBawaan(){return 1000;} function nfQty(n){return String(n);} function satuanPendek(s){return s;}`, c);
  /* the real stage logic (qcBalance, poTahap, poTutup), home screen and PO stage filter */
  vm.runInContext(part('function qcBalance(', 'function stagesHtml('), c);
  vm.runInContext(part('function tindakan() {', 'function tglPanjang('), c);
  vm.runInContext(part('var TAHAP_OPSI =', 'function poSembunyiList('), c);
  return c;
}
/* PO-J1: cut, sewn, counted and QC'd 40 pcs through the real core; nothing was ever input to BigSeller.
   PO-J2: finished, 40 of 100 input to BigSeller. PO-J3: still at the tailor, 30 pcs QC OK not in BigSeller. */
function isi(c) {
  vm.runInContext(`var hari=todayYmd();
    D.user={mk1:{nama:'Penjahit Uji'},qc1:{nama:'QC Uji'}};
    var pj={id:'pj',noPO:'PO-J1',nama:'Kaos Uji Jadi',status:'aktif',jenis:'stok',ukuran:{M:40}};
    var cuts=[{id:'cut-j1',poId:'pj',userId:'pt1',ukuran:{M:40},total:40,tarif:1000,tanggal:hari,dibuat:hari+'T08:00:00Z'}];
    var sends=[{id:'send-j1',poId:'pj',maklonId:'mk1',ukuran:{M:40},total:40,tanggal:hari,dibuat:hari+'T09:00:00Z'}];
    var counts=[{id:'count-j1',poId:'pj',maklonId:'mk1',status:'diterima',ukuran:{M:40},total:40,upah:9000,noSlip:'ST-J1',tanggal:hari,dibuat:hari+'T10:00:00Z'}];
    var checks=[{id:'qc-j1',poId:'pj',setorId:'count-j1',maklonId:'mk1',userId:'qc1',ukuran:{M:40},total:40,tanggal:hari,dibuat:hari+'T11:00:00Z'}];
    pj.workflow=coreWorkflow([pj],cuts,sends,counts,checks,[]).pj;
    pj.agg=coreAggregate([pj],cuts,sends,counts,checks,[]).pj;
    var ps={id:'ps',noPO:'PO-J2',nama:'Polo Uji',status:'aktif',jenis:'stok',
      agg:{total:{potong:100,kirim:100,terima:100,qcOk:100,bigseller:40,stok:60,siapKirim:0,sisaMaklon:0,diajukan:0,qcPerbaikan:0},maklon:{}},
      workflow:{issues:[],complete:true,ukuran:{M:{siapQC:0,stok:60,complete:true}}}};
    var pm={id:'pm',noPO:'PO-J3',nama:'Celana Uji',status:'aktif',jenis:'stok',
      agg:{total:{potong:80,kirim:80,terima:30,qcOk:30,bigseller:0,stok:30,siapKirim:0,sisaMaklon:50,diajukan:0,qcPerbaikan:0},maklon:{mk1:{sisa:50,diajukan:0,target:''}}},
      workflow:{issues:[],complete:false,ukuran:{M:{siapQC:0,readyQC:false,stok:30}}}};
    D.po={pj:pj,ps:ps,pm:pm};
    S.state={po:[pj,ps,pm],users:[{id:'qc1',aktif:true,divisi:'qc'},{id:'pt1',aktif:true,divisi:'potong'},{id:'mk1',aktif:true,divisi:'jahit'}],stokRingkas:[],
      potong:cuts,kirim:sends,setor:counts,qc:checks,gudang:[{id:'gd-j2',poId:'ps',tanggal:hari,total:40,ukuran:{M:40},dibuat:hari+'T12:00:00Z'}]};`, c);
}

test('the core finishes a PO on count and QC alone; its QC-OK pieces are stock even with no BigSeller input', () => {
  const c = ui(); isi(c);
  assert.equal(json(c, 'pj.workflow.complete'), true, 'production is complete without any BigSeller row');
  assert.equal(json(c, 'pj.agg.total.qcOk'), 40); assert.equal(json(c, 'pj.agg.total.bigseller'), 0);
  assert.equal(json(c, 'poTahap(pj).k'), 'tuntas');
  assert.equal(json(c, 'poTahap(pj).label'), 'Produksi selesai');
});

test('a finished PO with QC-OK pieces not input to BigSeller shows no BigSeller to-do and is offered Tandai selesai', () => {
  const c = ui(); isi(c);
  const todo = json(c, 'tindakan()');
  const tutup = todo.filter(x => x.k === 'tutup');
  assert.deepEqual(tutup.map(x => [x.id, x.btn, x.a, x.v]), [['pj', 'Tandai selesai', 'poStatusSet', 'selesai'], ['ps', 'Tandai selesai', 'poStatusSet', 'selesai']]);
  assert.equal(tutup[0].d, 'PO-J1 · semua ukuran selesai QC');
  assert.ok(!todo.some(x => /BigSeller/.test(x.t + ' ' + x.d)), 'no pending item asks for a BigSeller input');
  assert.ok(!todo.some(x => x.id === 'pm' && x.k === 'tutup'), 'a PO still at the tailor is not offered for closing');
  /* an order (pesanan) is offered the same way, as before */
  vm.runInContext("ps.jenis='pesanan';", c);
  assert.equal(json(c, 'tindakan().filter(function(x){return x.k==="tutup";}).length'), 2);
});

test('home shows no "Belum BigSeller" work; the tile counts POs that can be closed and the BigSeller history stays', () => {
  const c = ui(); isi(c);
  const view = vm.runInContext('VIEWS.beranda()', c);
  assert.doesNotMatch(view, /Belum BigSeller|Belum diinput|po:jual/);
  assert.match(view, /data-a="kpiGo" data-id="po:tuntas"><span class="label">Bisa ditutup<\/span><span class="v">2<\/span><span class="u">PO produksi selesai<\/span>/);
  assert.match(view, /data-a="todoGo" data-v="tutup">Bisa ditutup <b>2<\/b>/, 'the closing suggestion is on the alert bar');
  assert.match(view, /data-a="poStatusSet" data-id="pj" data-v="selesai"/);
  assert.match(view, /<h3 class="grow">BigSeller<\/h3><\/div><div><div class="dv-n">40<\/div><div class="dv-u">pcs diinput · 1 catatan/, 'BigSeller inputs stay visible as history');
  assert.match(view, /Tidak wajib\. Barang OK QC sudah termasuk barang jadi\./);
  assert.match(view, /<span>Di maklon<\/span><b>50<\/b>/, 'the production flow still shows real pending work');
});

test('the PO stage filter has no BigSeller stage; Tuntas still lists finished POs', () => {
  const c = ui(); isi(c);
  const opsi = json(c, 'TAHAP_OPSI');
  assert.ok(!opsi.some(o => o[0] === 'jual' || /BigSeller/.test(o[1])));
  assert.ok(opsi.some(o => o[0] === 'tuntas'));
  assert.equal(json(c, "poMasukTahap(pj,'tuntas')"), true);
  assert.equal(json(c, "poMasukTahap(pm,'tuntas')"), false);
  assert.equal(json(c, "poMasukTahap(pm,'maklon')"), true);
});

test('the PO sheet keeps Input BigSeller as a normal button and keeps the BigSeller column per size', () => {
  const sheetSrc = part('function poSheet(', 'A.poStatusSet =');
  const all = sheetSrc.split('data-a="gudangOpen"').length - 1, plain = sheetSrc.split('<button class="btn" data-a="gudangOpen"').length - 1;
  assert.ok(all >= 2, 'the button is offered on active and finished POs');
  assert.equal(plain, all, 'never the primary button');
  assert.match(sheetSrc, /if \(po\.jenis !== 'pesanan'\) b \+= '<button class="btn" data-a="gudangOpen"' \+ d \+ '>' \+ ic\('tag'\) \+ 'Input BigSeller<\/button>';/);
  assert.match(sheetSrc, /cols\.push\(\['BigSeller', 'bigseller', t\.bigseller\]\)/);
  assert.match(part('function openGudang(', 'A.gudangSave ='), /Tidak wajib\. Barang OK QC sudah termasuk barang jadi\./);
});
