'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function part(a,b){const start=html.indexOf(a),end=html.indexOf(b,start+a.length);assert.ok(start>=0&&end>start,a);return html.slice(start,end);}
function ui(){
  const c=vm.createContext({console});vm.runInContext(fs.readFileSync(path.join(root,'src/core.js'),'utf8'),c);
  vm.runInContext(`var S={state:{po:[]}},D={po:{}};
    function pos(n){return Math.max(0,Number(n)||0);}function T(p){return p.agg.total;}
    function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}
    function nf(s){return String(s||0);}function thumb(){return '';}
  `,c);
  vm.runInContext(part('function projectWorkflow(', 'function poSizes('),c);
  vm.runInContext(part('function workflowFor(', 'function poTahap('),c);
  vm.runInContext(part('function jahitProgressChip(', '/* ---------------- MAKLON JAHIT ---------------- */'),c);
  vm.runInContext(part('function hitungFisikBelumLengkap()', 'A.setorLangsung ='),c);
  return c;
}
function run(c,s){return vm.runInContext(s,c);}
test('sewing badges distinguish queued, reported, partially counted, fully counted and unassigned work',()=>{
  const c=ui();
  const cases=[
    [{kirim:0},'Belum ditugaskan','chip'],
    [{kirim:100,sisa:100,diajukan:0,terima:0,reject:0},'Antre jahit · belum ada setoran','chip info'],
    [{kirim:100,sisa:100,diajukan:40,terima:0,reject:0},'Menunggu hitung fisik','chip warn'],
    [{kirim:100,sisa:60,diajukan:0,terima:40,reject:0},'Sebagian selesai','chip warn'],
    [{kirim:100,sisa:0,diajukan:0,terima:98,reject:2},'Jahit selesai · sudah dihitung','chip ok'],
    [{kirim:100,sisa:0,diajukan:5,terima:95,reject:0},'Sebagian selesai','chip warn']
  ];
  for(const [x,label,css]of cases){const result=run(c,`jahitProgressChip(${JSON.stringify(x)})`);assert.ok(result.includes(label));assert.ok(result.includes(`class="${css}"`));}
});
test('a partly sewn PO is listed with what is counted and what is still being sewn, and its counted pieces are ready for QC',()=>{
  const c=ui();run(c,`var po={id:'p',noPO:'PO-001',nama:'Kaos <biru>',status:'aktif',ukuran:{M:40,L:50}};
    var cuts=[{id:'cut',poId:'p',ukuran:{M:40,L:50},total:90}];
    var sends=[{id:'send',poId:'p',maklonId:'worker',ukuran:{M:40,L:50},total:90}];
    var counts=[{id:'count',poId:'p',maklonId:'worker',status:'diterima',ukuran:{M:40,L:20},total:60}];
    function recompute(){po.workflow=coreWorkflow([po],cuts,sends,counts,[],[]).p;po.agg=coreAggregate([po],cuts,sends,counts,[],[]).p;}recompute();S.state.po=[po];D.po.p=po;`);
  const partial=run(c,'hitungFisikBelumLengkap()');assert.match(partial,/Jahitan belum lengkap/);assert.match(partial,/60 pcs sudah dihitung/);assert.match(partial,/30 pcs masih dijahit/);assert.match(partial,/Kaos &lt;biru>/);assert.doesNotMatch(partial,/Menunggu seluruh PO/);
  assert.equal(run(c,'qcBalance(po).ready'),60);assert.equal(run(c,'qcBalance(po).waiting'),0);
  run(c,'counts[0].ukuran.L=50;counts[0].total=90;recompute()');
  assert.equal(run(c,'hitungFisikBelumLengkap()'),'');assert.equal(run(c,'qcBalance(po).ready'),90);
});
test('counted work is ready for QC while another cut is still being prepared; only an unusable count is held',()=>{
  const c=ui();run(c,`var po={id:'p',nama:'Kaos',status:'aktif',agg:{total:{sisaMaklon:0,terima:40}},workflow:{pendingCutPlans:true,issues:[],ukuran:{M:{target:40,kirim:40,sisaMaklon:0,diajukan:0,diterima:40,rejectJahit:0,siapQC:40,readyQC:true}}}};S.state.po=[po];`);
  assert.equal(run(c,'qcBalance(po).ready'),40);assert.equal(run(c,'hitungFisikBelumLengkap()'),'');
  run(c,"po.workflow.ukuran.M.readyQC=false");assert.equal(run(c,'qcBalance(po).ready'),0);assert.equal(run(c,'qcBalance(po).waiting'),40);
  run(c,"po.agg.total.sisaMaklon=15;po.status='selesai'");assert.equal(run(c,'hitungFisikBelumLengkap()'),'');
});
test('PO and QC chooser instructions say a counted delivery is inspected without waiting for the whole PO',()=>{
  const detail=part('function poSheet(', 'A.poStatusSet =');const chooser=part('function openQC(', 'A.qcRepairOpen =');
  assert.match(detail,/Setoran yang sudah dihitung bisa langsung di-QC tanpa menunggu sisa jahitan/);
  assert.doesNotMatch(detail+chooser,/seluruh PO selesai dijahit|menunggu seluruh PO|Selesaikan seluruh jahit/);
});
