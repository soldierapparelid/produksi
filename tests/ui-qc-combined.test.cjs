'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),core=fs.readFileSync(path.join(root,'src/core.js'),'utf8');
function harness(){
  const start=html.indexOf('function qcCombinedGroups('),end=html.indexOf('A.qcRepairOpen =',start);
  return new Function(core+`
    var S={state:{setor:[],qc:[]}},D={po:{p:{id:'p',noPO:'PO-1',nama:'Kaos'}}},A={},R={},choices=[],view='',requests=[],toasts=[],activeForm;
    function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
    function nf(n){return String(n);}function tgl(s){return s;}function namaUser(s){return s;}function newId(){return 'batch-1';}
    function antreanQC(){return choices;}function qcBalance(){return {waiting:0};}function poHead(p){return p.nama;}
    function hid(n,v){return '<input name="'+n+'" value="'+v+'">';}function sumLine(){return '';}
    function fTanggal(){return '<input name="tanggal">';}function fCatatan(){return '';}
    function footSave(a,t){return '<button data-a="'+a+'">'+t+'</button>';}
    function sheetHtml(t,b,f){return '<h1>'+t+'</h1>'+b+(f||'');}function emptyBox(s){return s;}
    function openSheet(fn){view=fn();}function topForm(){return activeForm;}function formVals(f){return f.values;}
    function $$(sel,node){return node.find(sel);}function $(sel,node){return node.one(sel);}
    function qcValues(node){return node.maps;}function toast(s){toasts.push(s);}function quiet(e){toasts.push(e.message);}
    function req(a,p){requests.push({a,p});return Promise.resolve({ok:true});}function act(el,p){return p;}function dropForm(f){f.closed=true;}
    function recalc(f){R.qcCombined(f);}
  `+html.slice(start,end)+`
    return {S,D,A,R,groups:qcCombinedGroups,grid:qcCombinedGrid,open:openQC,view:function(){return view;},requests,toasts,
      load:function(rows){choices=rows;S.state.setor=rows.map(function(r){return r.s;});},setForm:function(f){activeForm=f;}};
  `)();
}
function row(id,n,opts={}) {return {s:Object.assign({id,poId:'p',maklonId:'w',noSlip:'SS-'+id,tanggal:'2026-10-01',status:'diterima',ukuran:{L:n},upah:1100},opts),uk:{L:n},sisa:n};}
test('two accepted counts for one PO, worker and rate open directly as one 142-piece size field',()=>{
  const h=harness();h.load([row('a',50),row('b',92)]);h.open('p');const view=h.view();
  assert.equal(h.groups('p').length,1);assert.equal(h.groups('p')[0].ukuran.L,142);
  assert.equal((view.match(/data-qc-row="L"/g)||[]).length,1);assert.match(view,/142 pcs diperiksa/);
  assert.match(view,/2 hitungan fisik digabung/);assert.match(view,/SS-a/);assert.match(view,/SS-b/);
  assert.doesNotMatch(view,/Pilih hitungan atau perbaikan|data-a="qcSlipOpen"/);assert.match(view,/Simpan hasil QC/);
  assert.match(view,/<details[^>]*><summary>2 hitungan/);
});
test('group keys from the server keep different worker or rate pools separate without showing a hidden wage',()=>{
  const h=harness();h.load([row('a',50,{qcGroupKey:'one',upah:0}),row('b',92,{qcGroupKey:'two',upah:0}),row('c',10,{poId:'other'})]);
  const groups=h.groups('p');assert.equal(groups.length,2);assert.equal(groups[0].total,50);assert.equal(groups[1].total,92);
  assert.equal(groups[0].sources[0].setorId,'a');assert.ok(groups[0].sources[0].expectedRevision);
});
test('only actionable size quantities are included, not already checked sizes from source history',()=>{
  const h=harness(),r=row('a',12,{ukuran:{M:40,L:12}});h.load([r]);
  assert.deepEqual(h.groups('p')[0].ukuran,{L:12});h.open('p');assert.doesNotMatch(h.view(),/data-qc-row="M"/);
  assert.match(h.view(),/12 pcs diperiksa/);
});
test('one save sends frozen source revisions and all groups in one request',async()=>{
  const h=harness();
  const sources=[{setorId:'a',expectedRevision:'before-a'},{setorId:'b',expectedRevision:'before-b'}];
  const group={maps:{ok:{L:140},offline:{},perbaikan:{L:2},reject:{}},getAttribute:()=>JSON.stringify(sources),find:()=>[{getAttribute:k=>k==='data-qc-row'?'L':'142'}]};
  const f={values:{id:'batch-1',poId:'p',tanggal:'2026-10-11',catatan:''},find:()=>[group]};h.setForm(f);
  h.S.state.setor=[{id:'a',qcRevision:'newer'}];await h.A.qcCombinedSave({});
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].a,'simpanQCGabungan');
  assert.deepEqual(h.requests[0].p.qc.kelompok[0].sources,sources);assert.equal(h.requests[0].p.qc.kelompok[0].ukuran.L,140);assert.equal(f.closed,true);
});
test('incomplete category totals do not submit or close the form',()=>{
  const h=harness(),group={maps:{ok:{L:100},offline:{},perbaikan:{},reject:{}},getAttribute:()=>JSON.stringify([{setorId:'a',expectedRevision:'r'}]),find:()=>[{getAttribute:k=>k==='data-qc-row'?'L':'142'}]},f={values:{id:'batch-1',poId:'p'},find:()=>[group]};h.setForm(f);h.A.qcCombinedSave({});
  assert.equal(h.requests.length,0);assert.match(h.toasts[0],/142/);assert.equal(f.closed,undefined);
});
test('QC combined writes use the existing workflow connection guard',()=>{
  const workflow=html.match(/var workflowWrite = \/\^\(([^\n]+)\)\$\//);assert.ok(workflow);assert.match(workflow[1],/simpanQCGabungan/);
});
