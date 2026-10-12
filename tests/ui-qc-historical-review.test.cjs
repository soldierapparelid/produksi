'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),core=fs.readFileSync(path.join(root,'src/core.js'),'utf8');
function part(a,b){const s=html.indexOf(a),e=html.indexOf(b,s);assert.ok(s>=0&&e>s);return html.slice(s,e);}
function harness(){return new Function(core+`
var S={state:{po:[],setor:[],qc:[]},f:{q:''}},D={po:{}},A={},R={},VIEWS={},view='';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function nf(v){return String(Number(v)||0);}function pos(v){return Math.max(0,Number(v)||0);}function tgl(v){return esc(v);}function ic(){return '';}function thumb(){return '';}
function namaUser(id){return 'Pekerja '+id;}function findSlip(t,id){return S.state.setor.find(function(r){return r.id===id;});}function workflowFor(p){return p.workflow;}
function coreText(v){return esc(coreSizeText(v));}function sizeChips(v){return coreText(v);}function emptyBox(v){return esc(v);}function searchBox(){return '';}
function cocok(q,v){return !q||v.join(' ').toLowerCase().includes(q.toLowerCase());}function todayYmd(){return '2026-10-11';}function paintList(){}
function miniKpi(rows){return rows.map(function(r){return r.slice(0,3).join('|');}).join(';');}
function newId(){return 'request01';}function qcBalance(){return {waiting:0};}function poHead(p){return esc(p.noPO);}
function openSheet(fn){view=fn();}function sheetHtml(t,b,f){return '<h1>'+esc(t)+'</h1>'+b+(f||'');}function hid(n,v){return '<input name="'+n+'" value="'+esc(v)+'">';}
function sumLine(){return '';}function fTanggal(){return '';}function fCatatan(){return '';}function footSave(a){return '<button data-a="'+a+'">Simpan</button>';}
`+part('function categorySizes(','A.qcSlipOpen =')+part('function qcGrid(','A.qcRepairOpen =')+`
return {S,D,A,VIEWS,groups:qcPoGroups,queue:antreanQC,progress:qcSourceProgress,combined:qcCombinedGroups,open:openQC,view:function(){return view;}};
`)();}
function source(id,ukuran,date='2026-10-10'){return {id,poId:'p',noSlip:'SS-'+id,maklonId:'w',status:'diterima',tanggal:date,ukuran,total:Object.values(ukuran).reduce((a,b)=>a+b,0),reject:0};}
function load(h,sources,review={},qc=[]){const sizes={};sources.forEach(s=>Object.keys(s.ukuran).forEach(k=>sizes[k]={readyQC:true,diajukan:0,sisaMaklon:0,diterima:100,kirim:100}));
 const p={id:'p',noPO:'PO-test',nama:'Model <contoh>',status:'aktif',workflow:{ukuran:sizes,issues:[],blockedQcSources:Object.fromEntries(Object.entries(review).map(([id,m])=>[id,Object.keys(m)])),qcReviewSources:review}};
 h.S.state.po=[p];h.S.state.setor=sources;h.S.state.qc=qc;h.D.po.p=p;return p;}
const cards=s=>(s.match(/data-qc-po="/g)||[]).length;

test('all historical ambiguity is folded, not ready, not waiting work, and histories remain intact',()=>{
 const h=harness(),s=source('old',{M:20},'2026-08-01'),before=JSON.stringify(s);load(h,[s],{old:{M:'Hubungan <lama> belum pasti'}});
 assert.equal(h.queue().length,0);assert.equal(h.groups().length,0);const g=h.groups(true)[0];assert.equal(g.review,20);assert.equal(g.waiting,0);assert.equal(g.ready,0);
 const v=h.VIEWS['q-qc']();assert.equal(cards(v),0);assert.match(v,/Antrean\|0\|PO · 0 slip siap QC/);assert.match(v,/<details class="card rj-lipat" data-qc-history><summary>Catatan lama · 1 PO · 20 pcs/);assert.doesNotMatch(v,/<details[^>]*data-qc-history[^>]*\bopen\b/);
 assert.match(v,/Hubungan &lt;lama&gt; belum pasti/);assert.match(v,/belum dinyatakan selesai/);assert.match(v,/data-a="slip" data-t="setor" data-id="old"/);assert.doesNotMatch(v,/data-a="qcSlipOpen"|data-a="qcOpen"|QC selesai/);assert.equal(JSON.stringify(s),before);
});
test('mixed PO keeps a new native source actionable while the old source remains separately reviewable',()=>{
 const h=harness();load(h,[source('old',{M:20},'2026-08-01'),source('new',{M:5})],{old:{M:'Cocokkan hitungan lama'}});
 const g=h.groups()[0];assert.equal(g.ready,5);assert.equal(g.review,20);assert.equal(g.waiting,0);assert.deepEqual(h.queue().map(q=>q.s.id),['new']);
 const v=h.VIEWS['q-qc']();assert.equal(cards(v),1);assert.match(v,/Siap QC\|5\|/);assert.match(v,/20 pcs catatan lama dipisahkan/);assert.match(v,/data-qc-review-source="old"/);assert.doesNotMatch(v,/data-qc-batch="old"/);assert.match(v,/data-a="qcSlipOpen" data-id="new"/);
 const groups=h.combined('p');assert.deepEqual(groups[0].sources.map(s=>s.setorId),['new']);assert.equal(groups[0].total,5);h.open('p');assert.match(h.view(),/5 pcs siap diperiksa/);assert.doesNotMatch(h.view(),/SS-old/);
});
test('one source with mixed sizes exposes only valid sizes in single and combined inputs and their source labels',()=>{
 const h=harness();load(h,[source('mixed',{M:20,L:7})],{mixed:{M:'Ukuran M perlu dicocokkan'}});
 assert.deepEqual(h.queue()[0].uk,{L:7});assert.equal(h.groups()[0].review,20);assert.deepEqual(h.combined('p')[0].ukuran,{L:7});
 h.open('p','mixed');assert.match(h.view(),/data-qc-row="L"/);assert.doesNotMatch(h.view(),/data-qc-row="M"/);
 h.open('p');assert.match(h.view(),/7 pcs siap diperiksa/);assert.doesNotMatch(h.view(),/data-qc-row="M"|M 20/);
});
test('held source cannot be opened directly and a review-only PO picker contains no QC submit control',()=>{
 const h=harness();load(h,[source('old',{M:20})],{old:{M:'Tautan lama perlu diperiksa'}});
 h.open('p','old');assert.match(h.view(),/ada di Catatan lama/);assert.doesNotMatch(h.view(),/data-qc-row|data-a="qcSave"/);
 h.open('p');assert.match(h.view(),/data-qc-history/);assert.match(h.view(),/Lihat slip/);assert.doesNotMatch(h.view(),/data-a="qcSlipOpen"|data-a="qcCombinedSave"/);
});
test('ordinary waiting and actual repairs remain operational, separate from historical review',()=>{
 const h=harness(),p=load(h,[source('wait',{M:9})]);p.workflow.ukuran.M.readyQC=false;
 assert.equal(h.groups()[0].waiting,9);assert.equal(h.groups()[0].review,0);assert.equal(cards(h.VIEWS['q-qc']()),1);assert.doesNotMatch(h.VIEWS['q-qc'](),/data-qc-history|class="total-big">0/);assert.match(h.VIEWS['q-qc'](),/class="total-big">9<\/span><span class="xs muted">pcs tertahan/);
 load(h,[source('old',{L:20}),source('repair',{M:10})],{old:{L:'Lama'}},[{id:'q',poId:'p',setorId:'repair',maklonId:'w',tanggal:'2026-10-10',ukuran:{M:8},perbaikan:2,perbaikanUkuran:{M:2}}]);
 assert.equal(h.groups()[0].ready,0);assert.equal(h.groups()[0].repairs[0].total,2);const v=h.VIEWS['q-qc']();assert.equal(cards(v),1);assert.match(v,/data-a="qcRepairOpen" data-id="q"/);assert.match(v,/Catatan lama/);assert.match(v,/class="total-big">2<\/span><span class="xs muted">pcs perbaikan/);assert.doesNotMatch(v,/class="total-big">0/);
});
test('review classification follows server source map, never dates or model-wide inferred deductions',()=>{
 const h=harness();load(h,[source('dated',{M:12},'2025-01-01')]);assert.equal(h.queue()[0].sisa,12);assert.equal(h.groups()[0].review,0);
 load(h,[source('old',{M:20})],{old:{M:'Review'}},[{id:'done',poId:'p',setorId:'old',ukuran:{M:20},total:20}]);assert.equal(h.groups(true).length,0);assert.equal(h.S.state.qc.length,1);assert.equal(h.S.state.setor.length,1);
});
test('search still reaches historical source details without turning them into work cards',()=>{
 const h=harness();load(h,[source('old',{M:20},'2026-08-01')],{old:{M:'Lama'}});h.VIEWS['q-qc']();h.S.f.q='SS-old';assert.match(h.S.listFn(),/data-qc-review-source="old"/);assert.equal(cards(h.S.listFn()),0);h.S.f.q='missing';assert.doesNotMatch(h.S.listFn(),/data-qc-history/);
});

test('one PO visibly separates L and XL, combines same-size receipts, and removes inspected amounts from its ready summary',()=>{
 const h=harness(),a=source('a',{L:50}),b=source('b',{L:92,XL:20});load(h,[a,b]);
 let v=h.VIEWS['q-qc'](),summary=v.match(/data-qc-size-summary="ready">([\s\S]*?)<\/div><\/div>/)[1];
 assert.equal(cards(v),1);assert.equal(h.groups()[0].ready,162);
 assert.match(summary,/<b>L<\/b> · 142 pcs/);assert.match(summary,/<b>XL<\/b> · 20 pcs/);
 assert.ok(v.indexOf('data-qc-size-summary="ready"')<v.indexOf('<details'),'sizes visible without expanding history');
 load(h,[a,b],{},[{id:'checked',poId:'p',setorId:'a',ukuran:{L:50},total:50}]);
 v=h.VIEWS['q-qc']();summary=v.match(/data-qc-size-summary="ready">([\s\S]*?)<\/div><\/div>/)[1];
 assert.equal(h.groups()[0].ready,112);assert.match(summary,/<b>L<\/b> · 92 pcs/);assert.match(summary,/<b>XL<\/b> · 20 pcs/);assert.doesNotMatch(summary,/142 pcs/);
 load(h,[a,b],{a:{L:'Lama'}});v=h.VIEWS['q-qc']();summary=v.match(/data-qc-size-summary="ready">([\s\S]*?)<\/div><\/div>/)[1];
 assert.match(summary,/<b>L<\/b> · 92 pcs/);assert.doesNotMatch(summary,/142 pcs/);
});
