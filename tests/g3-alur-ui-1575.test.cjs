'use strict';
/* 1.5.75 (g3-alur), page side: "Atur harga" for a zero-rate count after QC appears only where the server accepts it,
   and Stok & PO ulang sees old-PO sizes that were given to a sewer without a cutting row. Invented data only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const core = fs.readFileSync(path.join(root, 'src/core.js'), 'utf8');
function between(a, b) { const p = html.indexOf(a), q = html.indexOf(b, p + a.length); assert.ok(p >= 0 && q > p, a); return html.slice(p, q); }
function json(c, expression) { return JSON.parse(vm.runInContext('JSON.stringify(' + expression + ')', c)); }

function beranda() {
  const c = vm.createContext({});
  vm.runInContext(core, c);
  vm.runInContext(`
    var S={state:{potong:[],kirim:[],setor:[],qc:[],gudang:[],payroll:[],users:[{divisi:'qc',aktif:true},{divisi:'potong',aktif:true},{divisi:'jahit',aktif:true}]},sub:{}};
    function sourcePaid(r){return !!r.upahId;} function poAktif(){return [];} function isAdmin(){return true;}
    function esc(s){return String(s==null?'':s);} function nf(n){return String(n);} function tgl(s){return s||'';} function lalu(){return 'tadi';}
    function namaUser(){return 'Penjahit Contoh';} function poNama(){return 'PO Contoh';} function ic(){return '';} function setorLaporanLama(){return false;}
    function hitung(id,upah,extra){return Object.assign({id:id,noSlip:'SS-'+id,poId:'po-contoh',maklonId:'sewer',status:'diterima',total:5,upah:upah},extra||{});}
    S.state.setor=[hitung('zero-qc',0),hitung('zero-noqc',0),hitung('rated-qc',9000),hitung('zero-oldqc',0),hitung('zero-markqc',0),hitung('zero-autoqc',0),
      hitung('zero-v0qc',0),hitung('zero-settled',0),hitung('zero-paid',0,{upahId:'wage-0001'}),hitung('zero-report',0,{status:'diajukan'})];
    S.state.qc=[{id:'q1',setorId:'zero-qc',ukuran:{L:4}},{id:'q1r',setorId:'zero-qc',repairQcId:'q1',ukuran:{L:1}},{id:'q2',setorId:'rated-qc'},
      {id:'q3',setorId:'zero-oldqc',workflowVersion:1,imporSumber:{baseline:true,skuId:'sku-contoh',siklus:'1',entryId:'entry-contoh',field:'qc'}},
      {id:'q4',setorId:'zero-markqc',upahId:'LUNAS-LAMA'},{id:'q5',setorId:'zero-autoqc',autoFromCount:true},{id:'q6',setorId:'zero-v0qc',asal:'lama',workflowVersion:0},
      {id:'q7',setorId:'zero-settled'},{id:'q8',setorId:'zero-paid'}];
    S.state.payroll=[{sourceId:'zero-settled',legacySettlementHold:true}];
  `, c);
  vm.runInContext(between('function sourceCanEditRate(', 'function payrollNotice('), c);
  vm.runInContext(between('function tindakan() {', 'VIEWS.beranda = function'), c);
  return c;
}

test('Beranda offers a first price for a zero-rate count after QC only when nothing old or paid is tied to it', () => {
  const c = beranda();
  assert.deepEqual(json(c, "tindakan().filter(function(x){return x.k==='harga';}).map(function(x){return [x.id,x.a,x.s,x.btn];})"),
    [['zero-qc', 'hargaOpen', 'SlipSetor', 'Atur harga'], ['zero-noqc', 'hargaOpen', 'SlipSetor', 'Atur harga']]);
  /* the slip sheet uses the same rule for its button */
  assert.deepEqual(json(c, "S.state.setor.filter(function(s){return s.status==='diterima'&&sourceCanEditRate(s,'SlipSetor');}).map(function(s){return s.id;})"), ['zero-qc', 'zero-noqc']);
  /* a set rate stays frozen after QC; a cutting row keeps its own rule */
  assert.equal(json(c, "sourceCanEditRate(S.state.setor[2],'SlipSetor')"), false);
  assert.equal(json(c, "sourceCanEditRate({id:'cut-1',tarif:0},'Potong')"), true);
  assert.equal(json(c, "sourceCanEditRate({id:'cut-2',tarif:0,asal:'koreksi-ukuran'},'Potong')"), false);
  /* after the first price the count leaves the list */
  vm.runInContext("S.state.setor[0].upah=7000", c);
  assert.deepEqual(json(c, "tindakan().filter(function(x){return x.k==='harga';}).map(function(x){return x.id;})"), ['zero-noqc']);
  assert.equal(json(c, "sourceCanEditRate(S.state.setor[0],'SlipSetor')"), false);
});

/* ---------- Stok & PO ulang ---------- */
const hariLalu = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function stok() {
  const c = vm.createContext({ console, Date, setTimeout });
  vm.runInContext(core, c);
  vm.runInContext(`
    var A={},C={},VIEWS={},messages=[],rendered=0,opened=null,closed=0,sheet='',store={},form={values:{}};
    var S={state:{po:[],produk:[],potong:[],kirim:[],setor:[],qc:[],settings:{ukuran:['M','L','XL']}},f:{q:''},sub:{}},D={po:{},produk:{}};
    var LS={get:function(k){return store[k]===undefined?null:store[k];},set:function(k,v){store[k]=String(v);return true;}};
    var PO_PITA={potong:'Belum potong',maklon:'Di penjahit'};
    function esc(s){return String(s===undefined?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}
    function nf(n){return String(n||0);}function ic(){return '';}function inisial(s){return String(s||'?').charAt(0);}function lalu(){return 'baru saja';}
    function toast(s,e){messages.push([s,!!e]);}function render(){rendered++;}function emptyBox(s){return s;}function searchBox(){return '';}
    function cocok(q,parts){q=String(q||'').toLowerCase();return !q||parts.join(' ').toLowerCase().indexOf(q)>=0;}
    function seg(k,o,cur){return o.map(function(x){return '['+x[1]+(x[0]===cur?'*':'')+']';}).join('');}
    function poUkuranPotong(po){return po._belum||[];}function poWarna(po){return 'maklon';}function T(po){return {};}function workflowFor(po){return po.workflow||{ukuran:{}};}
    function openPO(){}A.poOpen=function(){};function $(){return null;}function openSheet(fn){sheet=fn();}function sheetHtml(t,b,f){return t+b+(f||'');}function pickList(){return '';}
    function hid(k,v){return '';}function fNum(){return '';}function footSave(a){return a;}function topForm(){return form;}function formVals(){return {};}function dropForm(){closed++;}
    function closeSheet(){}function newId(){return 'id-baru';}function act(el,p){return p;}function quiet(){}function req(){return new Promise(function(){});}
    function selisihHari(ymd){var m=String(ymd||'').match(/^(\\d{4})-(\\d{2})-(\\d{2})/);if(!m)return null;var a=new Date(+m[1],+m[2]-1,+m[3]),n=new Date(),b=new Date(n.getFullYear(),n.getMonth(),n.getDate());return Math.round((a-b)/86400000);}
    function tgl(s){return 'tgl:'+s;}
  `, c);
  /* the real projection of the server workflow onto the PO figures, as the page does it */
  vm.runInContext(between('function projectWorkflow(po) {', 'function poSizes(po) {'), c);
  vm.runInContext(between('/* ---------------- STOK JUAL & PO ULANG ---------------- */', '/* ---------------- TUKANG POTONG ---------------- */'), c);
  vm.runInContext(`S.sj={stok:{at:'2026-11-01T00:00:00.000Z',n:3,fam:{'SA-LAMA-KMJ-HT':{j:'Kemeja lama',g:'',u:{M:[2,20,0],L:[3,20,0],XL:[1,20,0]}}}},link:{'SA-LAMA-KMJ-HT':{p:'p1'}}};
    D.produk.p1={id:'p1',nama:'Kemeja Lama Hitam',series:'LAMA',aktif:true};S.state.produk=[D.produk.p1];`, c);
  return c;
}
/* an old-app PO: M and L were given to a sewer without any cutting row; L came back and was counted, no QC entered */
function poLama(c, tanggal) {
  c.TGL = tanggal;
  vm.runInContext(`
    var po={id:'old-po-1',noPO:'PO-LAMA',status:'aktif',jenis:'stok',produkId:'p1',asal:'lama',ukuran:{M:30,L:20},_belum:['M','L']};
    var kirim=[{id:'old-send-1',poId:'old-po-1',maklonId:'w1',tanggal:TGL,ukuran:'{"M":30,"L":20}',total:50}];
    var setor=[{id:'old-cnt-01',poId:'old-po-1',maklonId:'w1',status:'diterima',tanggal:TGL,ukuran:'{"L":20}',total:20}];
    po.workflow=coreWorkflow([po],[],kirim,setor,[],[],{})['old-po-1'];
    S.state.po=[po];S.state.kirim=kirim;S.state.setor=setor;D.po={'old-po-1':po};`, c);
}
const ukuran = (c, s) => json(c, "sjHitung()").filter(r => r.k === 'SA-LAMA-KMJ-HT')[0].uk.filter(u => u.s === s)[0];

test('an old PO size given to a sewer without a cutting row is in production, not "Perlu PO"', () => {
  const c = stok(); poLama(c, hariLalu(3));
  assert.deepEqual(json(c, "po.workflow.issues"), [], 'the old PO has no open issue');
  const prod = json(c, "sjProduksi('p1')");
  assert.deepEqual(prod.uk.M, { jalan: 30, antre: false }, 'thirty pieces are at the sewer, nothing waits to be cut');
  assert.deepEqual(prod.jadi.L.map(x => [x.po.id, x.pcs]), [['old-po-1', 20]], 'the counted L pieces are finished goods, as in 1.5.74');
  assert.equal(prod.uk.L, undefined, 'L is not running any more');
  assert.deepEqual(prod.po.map(p => p.id), ['old-po-1']);
  const m = ukuran(c, 'M'), l = ukuran(c, 'L');
  assert.equal(m.st, 'jalan'); assert.equal(l.st, 'perlu', 'counted pieces do not hold back a new PO');
  const view = vm.runInContext("S.sub.sj='semua';VIEWS.stokjual()", c);
  assert.match(view, /<b>Perlu PO:<\/b> L · XL<\/div><div class="small muted"><b>Sedang diproduksi:<\/b> M 30<\/div><div class="small muted"><b>Sudah jadi, cek BigSeller:<\/b> L 20 \(PO-LAMA\)<\/div>/);
  assert.doesNotMatch(view, /Antre potong/, 'a size already at the sewer is not waiting to be cut');
  /* the same size outside the to-cut list was invisible before 1.5.75 */
  vm.runInContext("po._belum=[]", c);
  assert.deepEqual(json(c, "sjProduksi('p1')").uk.M, { jalan: 30, antre: false });
});

test('an idle old PO size at the sewer is stuck with its real stage and pieces', () => {
  const c = stok(); poLama(c, hariLalu(45));
  const m = ukuran(c, 'M');
  assert.equal(m.st, 'perlu', 'idle for 45 days: it no longer holds back a new PO');
  assert.deepEqual(m.m.map(x => [x.po.id, x.pcs, x.tahap]), [['old-po-1', 30, 'di penjahit']], 'not "belum dipotong" with no pieces');
  assert.match(vm.runInContext("VIEWS.stokjual()", c), /Macet, cek PO:<\/b> M 30 di penjahit sejak tgl:\d{4}-\d{2}-\d{2} \(PO-LAMA\)/);
});

test('once QC is entered the old size is done, and a PO with cutting rows reads exactly as before', () => {
  const c = stok(); poLama(c, hariLalu(3));
  vm.runInContext(`var qc=[{id:'old-qc-001',poId:'old-po-1',maklonId:'w1',setorId:'old-cnt-01',tanggal:TGL,ukuran:'{"L":20}',total:20,workflowVersion:2}];
    po.workflow=coreWorkflow([po],[],kirim,setor,qc,[],{})['old-po-1'];S.state.qc=qc;`, c);
  let prod = json(c, "sjProduksi('p1')");
  assert.equal(prod.jadi.L, undefined); assert.equal(prod.uk.L, undefined, 'passed QC: stock, not production');
  assert.deepEqual(prod.uk.M, { jalan: 30, antre: false });
  /* a size cut in this app: the cutting row is still the base; cut but not given out is "belum ke penjahit" */
  vm.runInContext(`S.state.po=[{id:'new-po-1',noPO:'PO-BARU',status:'aktif',jenis:'stok',produkId:'p1',_belum:['XL'],agg:{ukuran:{M:{potong:30,kirim:20,sisaMaklon:20},L:{potong:10,kirim:10,terima:10,qcOk:10}}}}];
    S.state.kirim=[];S.state.setor=[];S.state.qc=[];S.state.potong=[{poId:'new-po-1',tanggal:'${hariLalu(40)}',ukuran:{M:30,L:10}}];`, c);
  prod = json(c, "sjProduksi('p1')");
  assert.deepEqual(prod.macet.M.map(x => [x.pcs, x.tahap]), [[30, 'belum ke penjahit, di penjahit']]);
  assert.equal(prod.uk.L, undefined);
  assert.deepEqual(prod.uk.XL, { jalan: 0, antre: true }, 'a size never cut still waits to be cut');
  /* the raw server figures (no projection) give the same base */
  vm.runInContext(`S.state.po[0].agg.ukuran.M={kirim:30,sisaMaklon:30};S.state.potong=[]`, c);
  assert.deepEqual(json(c, "sjProduksi('p1')").uk.M, { jalan: 30, antre: false });
});
