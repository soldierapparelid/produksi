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
  vm.runInContext(`var S={state:{setor:[],qc:[],payroll:[]}},D={po:{},user:{}};
    function findSlip(type,id){return S.state.setor.find(function(r){return r.id===id;});}
    function workflowFor(po){return po.workflow;}`, c);
  vm.runInContext(between('function categorySizes(', "VIEWS['q-qc'] ="), c);
  vm.runInContext(between('function payrollRows(', 'function sumUpah('), c);
  return c;
}
function json(c, expr) { return JSON.parse(vm.runInContext(`JSON.stringify(${expr})`, c)); }
test('QC queue waits until the whole PO has been physically counted', () => {
  const c = context();
  vm.runInContext(`S.state.setor=[{id:'s',poId:'p',status:'diterima',ukuran:{M:40,L:20},total:60,tanggal:'2026-10-08'}];
    D.po.p={status:'aktif',workflow:{issues:[],ukuran:{M:{readyQC:true,target:40,kirim:40,sisaMaklon:0,diajukan:0,diterima:40,rejectJahit:0},L:{readyQC:false,target:40,kirim:40,sisaMaklon:20,diajukan:0,diterima:20,rejectJahit:0}}}};`, c);
  assert.deepEqual(json(c, 'antreanQC().map(x=>({uk:x.uk,sisa:x.sisa,waiting:x.waiting}))'), []);
});

test('historical QC ambiguity holds only its baseline count, while a new source stays selectable', () => {
  const c=context();
  vm.runInContext(`S.state.setor=[
    {id:'baseline',poId:'p',status:'diterima',ukuran:{M:20},total:20,tanggal:'2026-10-01'},
    {id:'fresh',poId:'p',status:'diterima',ukuran:{M:10},total:10,tanggal:'2026-10-08'}];
    D.po.p={status:'aktif',workflow:{issues:[],blockedQcSources:{baseline:['M']},ukuran:{M:{readyQC:true,target:40,kirim:40,sisaMaklon:0,diajukan:0,diterima:40,rejectJahit:0}}}};`,c);
  assert.deepEqual(json(c,'antreanQC().map(x=>({id:x.s.id,qty:x.sisa}))'),[{id:'fresh',qty:10}]);
});

test('dashboard holds all sixty counted pieces while the rest of the PO is still at sewing', () => {
  const c = context();
  vm.runInContext(`function pos(n){return Math.max(0,Number(n)||0);} function T(po){return po.agg.total;}
    function esc(s){return String(s);} function nf(n){return String(n);} function ic(){return '';}
    function rp(n){return String(n);} function sumUpah(){return 0;} function tindakan(){return [];}
    function emptyBox(){return '';} function maklonAktif(){return [];} function tglPanjang(){return '';}
    function namaUser(){return '';} function poNama(){return '';} function lalu(){return '';}
    function poAktif(){return S.state.po;} var VIEWS={};
    var po={id:'p',nama:'Kaos',status:'aktif',jenis:'stok',ukuran:{M:40,L:50}};
    var cuts=[{id:'cut',poId:'p',ukuran:{M:40,L:50},total:90}];
    var assignments=[{id:'send',poId:'p',maklonId:'w',ukuran:{M:40,L:50},total:90}];
    var counts=[{id:'count',poId:'p',maklonId:'w',status:'diterima',ukuran:{M:10,L:50},total:60}];
    po.workflow=coreWorkflow([po],cuts,assignments,counts,[],[]).p;
    po.agg=coreAggregate([po],cuts,assignments,counts,[],[]).p;
    S.state.po=[po];S.state.potong=[];S.state.kirim=[];S.state.setor=counts;S.state.gudang=[];S.state.users=[];
    D.po.p=po;`, c);
  vm.runInContext(between('function qcBalance(', 'function poTahap('), c);
  vm.runInContext(between('function commerceHomeCards(', 'A.commerceGo ='), c);
  vm.runInContext(between('VIEWS.beranda =', 'function tglPanjang('), c);
  assert.deepEqual(json(c, 'qcBalance(po)'), { ready: 0, waiting: 60, readyUkuran: {}, waitingUkuran: { M: 10, L: 50 } });
  const view = vm.runInContext('VIEWS.beranda()', c);
  assert.match(view, /data-id="po:qc"><span class="label">Siap QC<\/span><span class="v">0<\/span>/);
  assert.match(view, /60 pcs menunggu seluruh PO lengkap/);
  assert.match(view, /title="Sebagian dihitung · menunggu jahit lengkap: 60"/);
  assert.doesNotMatch(view, /title="Siap QC: 50"/);
  assert.match(vm.runInContext('qcEntryButton(po)', c), /disabled/);
  vm.runInContext(`S.state.setor[0].ukuran={M:10};S.state.setor[0].total=10;po.workflow=coreWorkflow([po],cuts,assignments,counts,[],[]).p;`, c);
  assert.match(vm.runInContext('qcEntryButton(po)', c), /disabled[^>]*>QC belum siap/);
});

test('QC chooser refreshes source and repair choices when returning after a save', () => {
  const c = context();
  vm.runInContext(`var renders=[], options=[];
    function pos(n){return Math.max(0,Number(n)||0);} function T(){return {};}
    function esc(s){return String(s);} function nf(n){return String(n);} function ic(){return '';}
    function namaUser(){return 'Ali';} function tgl(s){return s;} function emptyBox(s){return s;}
    function sheetHtml(title,html){return title+html;} function openSheet(fn,opt){renders.push(fn);options.push(opt);}
    S.state.setor=[{id:'s',noSlip:'SS-001',poId:'p',maklonId:'w',status:'diterima',ukuran:{M:40},total:40}];
    D.po.p={id:'p',status:'aktif',workflow:{issues:[],ukuran:{M:{readyQC:true,siapQC:40,target:40,kirim:40,sisaMaklon:0,diajukan:0,diterima:40,rejectJahit:0}}}};`, c);
  vm.runInContext(between('function qcBalance(', 'function poTahap('), c);
  vm.runInContext(between('function openQC(', 'A.qcRepairOpen ='), c);
  vm.runInContext(`openQC('p')`, c);
  assert.equal(vm.runInContext('options[0].live', c), true);
  assert.match(vm.runInContext('renders[0]()', c), /data-a="qcSlipOpen"/);
  vm.runInContext(`S.state.qc=[{id:'q',poId:'p',setorId:'s',maklonId:'w',tanggal:'2026-10-08',ukuran:{M:38},total:38,perbaikan:2,perbaikanUkuran:{M:2}}];D.po.p.workflow.ukuran.M.siapQC=0;`, c);
  const refreshed = vm.runInContext('renders[0]()', c);
  assert.doesNotMatch(refreshed, /data-a="qcSlipOpen"/);
  assert.match(refreshed, /data-a="qcRepairOpen" data-id="q"/);
});
test('all-reject QC consumes the count; repaired goods do not reopen its QC queue', () => {
  const c = context();
  vm.runInContext(`S.state.setor=[{id:'s',poId:'p',status:'diterima',ukuran:{M:40},total:40}];
    D.po.p={status:'aktif',workflow:{issues:[],ukuran:{M:{readyQC:true}}}};
    S.state.qc=[{id:'q',poId:'p',setorId:'s',ukuran:{},total:0,reject:40,rejectUkuran:{M:40}}];`, c);
  assert.deepEqual(json(c, 'antreanQC()'), []);
  vm.runInContext(`S.state.qc=[{id:'q',poId:'p',setorId:'s',ukuran:{M:30},total:30,perbaikan:10,perbaikanUkuran:{M:10}},
    {id:'r',poId:'p',setorId:'s',repairQcId:'q',ukuran:{M:4},total:4,perbaikan:-4,perbaikanUkuran:{M:-4}}];`, c);
  assert.deepEqual(json(c, 'antreanQC()'), []);
  assert.deepEqual(json(c, 'repairQueue("p").map(x=>x.uk)'), [{ M: 6 }]);
});
test('payment choices use server available quantities and exclude unresolved rows', () => {
  const c = context();
  vm.runInContext(`S.state.payroll=[
    {id:'a',pegawaiId:'w',total:30,available:5,rate:1000,issues:[]},
    {id:'b',pegawaiId:'w',total:10,available:0,issues:[]},
    {id:'c',pegawaiId:'w',total:10,available:10,needsReview:true,issues:[]},
    {id:'d',pegawaiId:'other',total:10,available:10,issues:[]}];`, c);
  assert.deepEqual(json(c, 'unpaidOf({id:"w"}).map(r=>({id:r.id,total:r.total}))'), [{ id: 'a', total: 5 }]);
});
test('paid slip uses immutable snapshots even when the source has changed or was trimmed', () => {
  const c = context();
  vm.runInContext(between('function slipCtx(', 'function openSlip('), c);
  vm.runInContext(`S.state.settings={};S.state.setor=[{id:'s',total:100,upah:9000}];
    var paid={pegawaiId:'w',jenis:'jahit',itemIds:['setor:s:M'],items:JSON.stringify([{id:'setor:s:M',sourceId:'s',total:35,rate:3000}])};`, c);
  assert.deepEqual(json(c, 'slipCtx("upah",paid).items.map(r=>({total:r.total,upah:r.upah}))'), [{ total: 35, upah: 3000 }]);
});
test('new production UI refuses mutation against an old server before making a request', async () => {
  const c = context();
  vm.runInContext(`var sent=0; S.state.workflowVersion=1; S.token='t'; S.busy=0;
    var Api={mode:function(){return 'remote';},call:function(){sent++;return Promise.resolve({});}};
    function paintSync(){} function refresh(){} function applyState(){} function signOutLocal(){}`, c);
  vm.runInContext(between('function req(', 'function signOutLocal('), c);
  await assert.rejects(vm.runInContext(`req('createQC',{})`, c), /server belum selesai/);
  assert.equal(vm.runInContext('sent', c), 0);
  assert.equal(vm.runInContext('S.busy', c), 0);
});
test('the bundled demo still completes with the same enforced workflow as the server', () => {
  const c = context();
  vm.runInContext(fs.readFileSync(path.join(root,'src/cutting-plans.js'),'utf8'),c);
  vm.runInContext(`var saved={},clock=0,seq=0,booted=0;
    var LS={get:k=>saved[k]||null,set:(k,v)=>{saved[k]=v;return true;},del:k=>{delete saved[k];}};
    function tokenKey(){return 'test-token';} function boot(){booted++;} function newId(){return 'demoid_'+(++seq);}`, c);
  vm.runInContext(between('function createLocalStore(', '/* aplikasi per divisi:'), c);
  vm.runInContext(`var testStore=createLocalStore('test-db');
    var core=createCore(testStore,{now:()=>new Date(Date.now()-clock),id:()=>('testid_'+(++seq))});
    var Api={setClock:ms=>{clock=ms;},local:()=>testStore,localCall:(a,p)=>core.handle(a,p)};`, c);
  vm.runInContext(between('function seedDemo()', '/* Versi baru aplikasi'), c);
  vm.runInContext('seedDemo()', c);
  assert.equal(vm.runInContext('testStore.read("PO").length', c), 6, 'seed must not hit its catch-and-wipe fallback');
  assert.equal(vm.runInContext('testStore.read("QC").length', c), 2);
  assert.equal(vm.runInContext('testStore.read("SlipUpah").length', c), 1);
  assert.equal(vm.runInContext('booted', c), 1);
});
