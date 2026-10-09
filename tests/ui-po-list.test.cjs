'use strict';
/* PO tab: grouped by series, every product shown (also the ones without an active PO), one colour per stage,
   and finished POs can be removed from the list (hidden, never erased). */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
function ui(){
  const c=vm.createContext({console});
  vm.runInContext(`
    var A={},C={},VIEWS={},HARI_ARSIP=60,requests=[],messages=[],opened=[],confirmText='',confirmFn=null,renders=0;
    var actor={id:'own',divisi:'owner'},D={po:{},produk:{}};
    var S={f:{q:'',poStatus:'aktif',poTahap:'',poJenis:''},listFn:null,state:{po:[],produk:[],settings:{poSembunyi:[]},trimmed:false}};
    function seed(po,produk,hidden){S.state.po=po;S.state.produk=produk||[];S.state.settings.poSembunyi=hidden||[];D.po={};po.forEach(function(p){D.po[p.id]=p;});D.produk={};S.state.produk.forEach(function(p){D.produk[p.id]=p;});}
    function T(po){return po.t||{};}function workflowFor(po){return po.workflow||{ukuran:{},issues:[],complete:false};}function qcBalance(po){return po.qc||{ready:0,waiting:0};}
    function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}function nf(n){return String(n);}
    function thumb(){return '';}function ic(){return '';}function selisihHari(){return null;}function tgl(s){return s;}function coreSizeOrder(a){return a;}
    function cocok(q,parts){q=String(q||'').toLowerCase();return !q||parts.join(' ').toLowerCase().indexOf(q)>=0;}
    function emptyBox(t){return '<div class="empty">'+t+'</div>';}function searchBox(){return '';}function poPendingPlansHtml(){return '';}
    function isAdmin(){return actor.divisi==='owner'||actor.divisi==='admin';}function me(){return actor;}
    function confirmBox(o,fn){confirmText=o.title+' '+o.text;confirmFn=fn;}function act(el,p){return p;}function quiet(){}
    function req(action,payload){requests.push({action:action,payload:payload});return Promise.resolve(action==='deleteRecord'?{ok:true,disembunyikan:true}:{});}
    function toast(m){messages.push(m);}function render(){renders++;}function paintList(){}function openPO(id,produkId){opened.push(produkId);}
  `,c);
  vm.runInContext(part('function poTahap(po) {','/* sisa di satu maklon'),c);
  vm.runInContext(part('/* ---------- tab PO ---------- */','var loadAllRequest = null;'),c);
  return {c,run:s=>vm.runInContext(s,c),json:s=>JSON.parse(vm.runInContext('JSON.stringify('+s+')',c))};
}
const po=(id,over)=>({id,nama:'Barang '+id,series:'',jenis:'stok',status:'aktif',dibuat:'2026-10-01',t:{},...over});
const el=id=>`{getAttribute:function(){return ${JSON.stringify(id)};}}`;
const at=(text,needle)=>{const i=text.indexOf(needle);assert.ok(i>=0,needle+' is shown');return i;};

test('active POs are grouped by series, ordered by stage, coloured per stage, with the products that have no PO yet',()=>{
  const h=ui();h.c.fixture={po:[po('a3',{series:'zipper',dibuat:'2026-10-03',t:{sisaMaklon:3}}),po('a2',{series:'Zipper',dibuat:'2026-10-02',t:{siapKirim:5,potong:5}}),po('a1',{series:'Zipper'}),po('b1',{produkId:'p3'}),po('c1',{nama:'Lepas'}),po('z9',{series:'Zipper',status:'selesai'})],
    produk:[{id:'p1',nama:'Zipper Hitam',series:'Zipper',aktif:true},{id:'p2',nama:'barang A1',series:'Zipper',aktif:true},{id:'p3',nama:'Tactical Cap',series:'Tactical',aktif:true},{id:'p4',nama:'Polos',series:'',aktif:true},{id:'p5',nama:'Mati',series:'Zipper',aktif:false}]};
  h.run('seed(fixture.po,fixture.produk)');const view=h.run('VIEWS.po()');
  assert.ok(at(view,'<h3>Tactical</h3>')<at(view,'<h3>Zipper</h3>')&&at(view,'<h3>Zipper</h3>')<at(view,'<h3>Tanpa seri</h3>'),'series in name order, items without a series last');
  assert.ok(at(view,'data-id="a1"')<at(view,'data-id="a2"')&&at(view,'data-id="a2"')<at(view,'data-id="a3"'),'not cut, then cut, then at the sewer');
  assert.match(view,/class="po w-potong" data-a="poOpen" data-id="a1"/);assert.match(view,/class="po w-kirim" data-a="poOpen" data-id="a2"/);assert.match(view,/class="po w-maklon" data-a="poOpen" data-id="a3"/);
  assert.match(view,/<span class="po-pita">Sudah potong<\/span>/);assert.match(view,/3 PO · 1 belum di-PO/);
  assert.match(view,/Zipper Hitam[\s\S]*?data-a="poBaruProduk" data-id="p1"/);assert.match(view,/data-a="poBaruProduk" data-id="p4"/);
  for(const gone of ['p2','p3','p5'])assert.ok(!view.includes('data-a="poBaruProduk" data-id="'+gone+'"'),gone+' already has an active PO or is inactive');
  assert.ok(!view.includes('data-id="z9"'),'a finished PO is not in the active tab');assert.ok(!view.includes('data-a="poArsip"'),'an active PO has no archive button');
  assert.match(view,/po-leg w-potong"><i><\/i>Belum dipotong <b>3<\/b>/);assert.match(view,/po-leg w-belum"><i><\/i>Belum di-PO <b>2<\/b>/);
  h.run("S.f.poTahap='kirim'");const cut=h.run('VIEWS.po()');assert.match(cut,/data-id="a2"/);assert.ok(!cut.includes('data-id="a1"')&&!cut.includes('poBaruProduk'));
  h.run("S.f.poTahap='';S.f.q='hitam'");const found=h.run('VIEWS.po()');assert.match(found,/data-id="p1"/);assert.ok(!found.includes('data-id="p4"'));
  h.run(`A.poBaruProduk(${el('p1')})`);assert.deepEqual(h.json('opened'),['p1']);
});

test('"Semua barang" sits in the same row and shows every PO and every product without a PO, grouped by series',()=>{
  const h=ui();h.c.fixture={po:[po('a1',{series:'Zipper'}),po('s1',{series:'Zipper',status:'selesai',workflow:{ukuran:{},issues:[],complete:true}}),po('x1',{series:'Tactical',status:'batal'}),po('s9',{series:'Zipper',status:'selesai'})],
    produk:[{id:'p1',nama:'Zipper Hitam',series:'Zipper',aktif:true},{id:'p2',nama:'Topi Polos',series:'Tactical',aktif:true}]};
  h.run("seed(fixture.po,fixture.produk,['s9']);S.f.poTahap='kirim'");let view=h.run('VIEWS.po()');
  assert.ok(at(view,'data-v="semua"')<at(view,'data-v="aktif"'),'first in the row of Aktif / Selesai / Batal');assert.match(view,/data-v="semua">Semua barang 5</);assert.match(view,/data-v="aktif" class="on">Aktif 1</);
  h.run("A.poStatus({getAttribute:function(){return 'semua';}})");view=h.run('VIEWS.po()');assert.match(view,/data-v="semua" class="on">Semua barang 5</);
  for(const id of ['a1','s1','x1'])assert.match(view,new RegExp('data-a="poOpen" data-id="'+id+'"'));assert.ok(!view.includes('data-id="s9"'),'a PO removed from the list stays out');
  assert.match(view,/data-a="poBaruProduk" data-id="p1"/);assert.match(view,/data-a="poBaruProduk" data-id="p2"/);
  assert.ok(at(view,'<h3>Tactical</h3>')<at(view,'<h3>Zipper</h3>'));assert.ok(at(view,'data-id="a1"')<at(view,'data-id="s1"')&&at(view,'data-id="s1"')<at(view,'data-id="p1"'),'running first, then finished, then not ordered yet');
  assert.match(view,/2 PO · 1 belum di-PO/);assert.match(view,/po-leg w-selesai"><i><\/i>Selesai <b>1<\/b>/);assert.match(view,/po-leg w-batal"><i><\/i>Batal <b>1<\/b>/);
  assert.match(view,/data-v="arsip">Arsip 1</);
  assert.ok(!view.includes('data-a="poArsip"')&&!view.includes('poArsipSemua')&&!view.includes('data-c="poTahap"'),'archiving stays in the Selesai and Batal tabs');
  h.run('A.poArsipSemua()');assert.equal(h.run('requests.length'),0);assert.equal(h.run('confirmFn'),null);
  h.run("S.f.q='tactical'");view=h.run('VIEWS.po()');assert.match(view,/data-id="x1"/);assert.ok(!view.includes('data-id="a1"'));h.run("S.f.q='polos'");assert.match(h.run('VIEWS.po()'),/data-id="p2"/);
});

test('a finished PO is archived, not erased: it leaves the lists, its product is "Belum PO" again, and it comes back from the Arsip tab',async()=>{
  const h=ui();h.c.fixture=[po('s1',{status:'selesai',dibuat:'2026-10-02',produkId:'p1',workflow:{ukuran:{},issues:[],complete:true}}),po('s2',{status:'selesai',workflow:{ukuran:{},issues:['periksa'],complete:false}}),po('s3',{status:'selesai'}),po('x1',{status:'batal'}),po('a1')];
  h.run("seed(fixture,[{id:'p1',nama:'Kaos Satu',series:'Seri',aktif:true}],['s3','not-loaded-po']);S.f.poStatus='selesai'");let view=h.run('VIEWS.po()');
  assert.match(view,/data-v="selesai" class="on">Selesai 2</);assert.match(view,/Batal 1</);assert.match(view,/Aktif 1</);assert.match(view,/data-v="arsip">Arsip 1</);
  assert.match(view,/data-a="poArsip" data-id="s1"/);assert.match(view,/data-a="poArsip" data-id="s2"/);assert.ok(!view.includes('data-id="s3"'));assert.match(view,/data-a="poArsipSemua"/);
  assert.match(view,/class="po w-selesai" data-a="poOpen" data-id="s1"/);assert.match(view,/class="po w-review" data-a="poOpen" data-id="s2"/);
  h.run('A.poArsip(' + el('s1') + ')');assert.match(h.run('confirmText'),/Belum PO/);assert.match(h.run('confirmText'),/tetap tersimpan/);await h.run('confirmFn(null)');
  assert.deepEqual(h.json('requests[0]'),{action:'arsipPO',payload:{id:'s1'}});assert.match(h.run('messages[0]'),/diarsipkan/);
  h.run('A.poArsipSemua()');assert.match(h.run('confirmText'),/Arsipkan 2 PO/);await h.run('confirmFn(null)');
  assert.deepEqual(h.json('requests[1]'),{action:'arsipPO',payload:{ids:['s1','s2']}});
  h.run("A.poStatus({getAttribute:function(){return 'arsip';}})");view=h.run('VIEWS.po()');assert.match(view,/data-v="arsip" class="on">Arsip 1</);assert.match(view,/data-a="poKembali" data-id="s3"/);assert.ok(!view.includes('data-id="s1"'));assert.ok(!view.includes('data-a="poArsip"'));
  h.run('A.poKembali(' + el('s3') + ')');assert.deepEqual(h.json('requests[2]'),{action:'arsipPO',payload:{id:'s3',arsip:false}});
  h.run("A.poStatus({getAttribute:function(){return 'batal';}})");assert.match(h.run('VIEWS.po()'),/data-a="poArsip" data-id="x1"/);
  h.run("actor.divisi='qc'");assert.ok(!h.run('VIEWS.po()').includes('data-a="poArsip"'));
  /* the product whose only PO is finished shows as not ordered again, ready for a new PO */
  h.run("actor.divisi='owner';S.f.poStatus='aktif'");assert.match(h.run('VIEWS.po()'),/Kaos Satu[\s\S]*?data-a="poBaruProduk" data-id="p1"/);
  h.run("seed(fixture,[],[]);S.f.poStatus='arsip'");assert.match(h.run('VIEWS.po()'),/Arsip masih kosong/);
});
