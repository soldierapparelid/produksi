'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8'),core=fs.readFileSync(path.resolve(__dirname,'../src/core.js'),'utf8');
function harness(){
  const start=html.indexOf('function categorySizes('),end=html.indexOf('A.qcSlipOpen =',start);
  assert.ok(start>0&&end>start);
  return new Function(core+`
    var S={state:{po:[],setor:[],qc:[]},f:{q:''}},D={po:{},user:{}},VIEWS={},A={},painted='';
    function workflowFor(po){return po.workflow;}
    function findSlip(type,id){return S.state.setor.find(function(s){return s.id===id;});}
    function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
    function pos(v){return Math.max(0,Number(v)||0);} function nf(v){return String(Number(v)||0);}
    function tgl(v){return esc(v);}function ic(){return '';}function thumb(){return '';}function namaUser(id){return D.user[id]||id;}
    function sizeChips(m){return esc(coreSizeText(m));}function emptyBox(v){return esc(v);}
    function cocok(q,values){return !q||values.join(' ').toLowerCase().includes(q.toLowerCase());}
    function todayYmd(){return '2026-10-10';}function searchBox(){return '';}
    function miniKpi(rows){return rows.map(function(r){return r.slice(0,3).join('|');}).join(';');}
    function paintList(){painted=S.listFn();}
  `+html.slice(start,end)+`
    return {S:S,D:D,A:A,VIEWS:VIEWS,groups:qcPoGroups,queue:antreanQC,flow:coreWorkflow,painted:function(){return painted;}};
  `)();
}
function po(id='p',target=40){return {id,noPO:'PO-'+id,nama:'Kaos',status:'aktif',ukuran:{M:target}};}
function receipt(id,qty,date='2026-10-08',poId='p',status='diterima'){return {id,noSlip:status==='diterima'?'SS-'+id:'',poId,maklonId:'w',status,tanggal:date,diprosesPada:'2026-10-10T08:00:00Z',ukuran:{M:qty},total:qty,reject:0};}
function load(h,pos,setor,qc=[]){
  const cuts=pos.map(p=>({id:'cut-'+p.id,poId:p.id,ukuran:p.ukuran,total:Object.values(p.ukuran).reduce((a,b)=>a+b,0)})),kirim=pos.map(p=>({id:'send-'+p.id,poId:p.id,maklonId:'w',ukuran:p.ukuran,total:Object.values(p.ukuran).reduce((a,b)=>a+b,0)}));
  const flow=h.flow(pos,cuts,kirim,setor,qc,[]);
  h.S.state.po=pos;h.S.state.setor=setor;h.S.state.qc=qc;
  for(const p of pos){p.workflow=flow[p.id];h.D.po[p.id]=p;}h.D.user.w='Maklon contoh';
}
function countCards(markup){return (markup.match(/data-qc-po="/g)||[]).length;}

test('multiple counted batches form one PO card with actual count dates, slip IDs and uncounted sewing separate',()=>{
  const h=harness();load(h,[po()],[receipt('a',10),receipt('b',5,'2026-10-09'),receipt('pending',7,'2026-10-10','p','diajukan')]);
  const groups=h.groups();assert.equal(groups.length,1);assert.equal(groups[0].counted,15);assert.equal(groups[0].ready,15);assert.equal(groups[0].pendingCount,7);assert.equal(groups[0].atSewing,18);assert.equal(groups[0].countComplete,false);
  const view=h.VIEWS['q-qc']();assert.equal(countCards(view),1);assert.match(view,/Antrean\|1\|PO · 2 slip siap QC/);assert.match(view,/Dihitung 2026-10-08/);assert.match(view,/Dihitung 2026-10-09/);assert.doesNotMatch(view,/Dihitung 2026-10-10/);assert.match(view,/Hitungan belum lengkap/);
  assert.match(view,/data-qc-batch="a"/);assert.match(view,/data-qc-batch="b"/);assert.doesNotMatch(view,/data-qc-batch="pending"/);
  assert.match(view,/data-a="qcSlipOpen" data-id="a"/);assert.match(view,/data-a="slip" data-t="setor" data-id="b"/);
});
test('a partial PO remains visible after its existing batch is QCed, then admits a later counted batch without calling the PO complete',()=>{
  const h=harness(),source=receipt('a',10),q={id:'q',poId:'p',setorId:'a',maklonId:'w',tanggal:'2026-10-08',ukuran:{M:10},total:10};
  load(h,[po()],[source],[q]);assert.equal(h.groups().length,1);assert.equal(h.groups()[0].ready,0);
  let view=h.VIEWS['q-qc']();assert.match(view,/QC selesai/);assert.match(view,/Tunggu setoran berikutnya; PO belum selesai/);assert.doesNotMatch(view,/data-a="qcSlipOpen"/);
  load(h,[po()],[source,receipt('b',30,'2026-10-09')],[q]);assert.equal(h.groups()[0].countComplete,true);assert.equal(h.groups()[0].ready,30);
  view=h.VIEWS['q-qc']();assert.equal(countCards(view),1);assert.match(view,/Seluruh jahitan sudah dihitung/);assert.match(view,/data-a="qcSlipOpen" data-id="b"/);assert.doesNotMatch(view,/data-a="qcSlipOpen" data-id="a"/);
  load(h,[po()],[source,receipt('b',30,'2026-10-09')],[q,{id:'q2',poId:'p',setorId:'b',maklonId:'w',tanggal:'2026-10-09',ukuran:{M:30},total:30}]);assert.equal(h.groups().length,0);
});
test('unphysical reports never enter QC, held physical sources stay visible without an inspection button, and closed POs stay out',()=>{
  const h=harness();load(h,[po()],[receipt('pending',20,'2026-10-08','p','diajukan')]);assert.equal(h.groups().length,0);
  const held=po('p',5);load(h,[held],[receipt('held',10)]);assert.equal(h.groups()[0].ready,0);assert.equal(h.groups()[0].waiting,10);
  const view=h.VIEWS['q-qc']();assert.match(view,/QC tertahan/);assert.match(view,/Perlu diperiksa/);assert.doesNotMatch(view,/data-a="qcSlipOpen"/);
  held.status='selesai';load(h,[held],[receipt('held',10)]);assert.equal(h.groups().length,0);
});
test('grouping keeps PO identity and reactive search matches any contained slip, worker, or count date',()=>{
  const h=harness();load(h,[po('p'),po('p2')],[receipt('one',10),receipt('two',5,'2026-10-09','p2')]);h.VIEWS['q-qc']();assert.equal(countCards(h.S.listFn()),2);
  h.S.f.q='SS-two';let list=h.S.listFn();assert.equal(countCards(list),1);assert.match(list,/data-qc-po="p2"/);assert.doesNotMatch(list,/data-qc-po="p"/);
  h.S.f.q='2026-10-08';assert.equal(countCards(h.S.listFn()),1);h.S.f.q='Maklon contoh';assert.equal(countCards(h.S.listFn()),2);h.S.f.q='absent';assert.equal(countCards(h.S.listFn()),0);
  assert.match(html,/var antre = qcPoGroups\(\)\.length;/);
});
test('repair receipts stay inside the same PO card and do not create new physical counts or ready-QC quantities',()=>{
  const h=harness(),source=receipt('all',40),q={id:'q',poId:'p',setorId:'all',maklonId:'w',tanggal:'2026-10-08',ukuran:{M:30},total:30,perbaikan:5,perbaikanUkuran:{M:5},reject:5,rejectUkuran:{M:5}};
  load(h,[po()],[source],[q]);let groups=h.groups();assert.equal(groups.length,1);assert.equal(groups[0].counted,40);assert.equal(groups[0].ready,0);assert.equal(groups[0].repairs[0].total,5);
  let view=h.VIEWS['q-qc']();assert.equal(countCards(view),1);assert.match(view,/data-a="qcRepairOpen" data-id="q"/);
  load(h,[po()],[source],[q,{id:'repair',poId:'p',setorId:'all',maklonId:'w',repairQcId:'q',tanggal:'2026-10-09',ukuran:{M:5},total:5,perbaikan:-5,perbaikanUkuran:{M:-5}}]);assert.equal(h.groups().length,0);
});
test('rejects remain physical counts while only good accepted pieces can be inspected',()=>{
  const h=harness(),s=receipt('reject',8);s.reject=2;s.rejectUkuran={M:2};load(h,[po('p',10)],[s]);const group=h.groups()[0];assert.equal(group.counted,10);assert.equal(group.ready,8);assert.equal(group.countComplete,true);assert.match(h.VIEWS['q-qc'](),/8 pcs bagus · reject jahit 2/);
});

test('collapsed repair-only PO cards show the outstanding repair quantity after partial returns',()=>{
  const h=harness(),source=receipt('all',10),q={id:'q',poId:'p',setorId:'all',maklonId:'w',tanggal:'2026-10-08',ukuran:{M:8},total:8,perbaikan:2,perbaikanUkuran:{M:2}};
  load(h,[po('p',10)],[source],[q]);
  let view=h.VIEWS['q-qc'](),summary=view.slice(0,view.indexOf('<details'));
  assert.match(summary,/2 pcs perbaikan · menunggu kembali \/ diperiksa\./);assert.match(summary,/Seluruh jahitan sudah dihitung/);assert.equal(h.groups()[0].ready,0);
  load(h,[po('p',10)],[source],[q,{id:'repair',poId:'p',setorId:'all',maklonId:'w',repairQcId:'q',tanggal:'2026-10-09',ukuran:{M:1},total:1,perbaikan:-1,perbaikanUkuran:{M:-1}}]);
  view=h.VIEWS['q-qc']();summary=view.slice(0,view.indexOf('<details'));
  assert.match(summary,/1 pcs perbaikan · menunggu kembali \/ diperiksa\./);assert.doesNotMatch(summary,/2 pcs perbaikan/);assert.equal(h.groups()[0].ready,0);
});
test('more than eighty grouped POs remain accessible through the explicit next-page control',()=>{
  const h=harness(),pos=Array.from({length:81},(_,i)=>po('p'+i)),counts=pos.map(p=>receipt('s'+p.id,1,'2026-10-08',p.id));load(h,pos,counts);h.VIEWS['q-qc']();assert.equal(countCards(h.S.listFn()),80);assert.match(h.S.listFn(),/qcMorePO/);h.A.qcMorePO();assert.equal(countCards(h.painted()),81);
});

test('the collapsed PO summary shows its latest chosen physical-count date before the batch details',()=>{
  const h=harness();load(h,[po()],[receipt('late',5,'2026-10-09'),receipt('early',10,'2026-10-08')]);
  const view=h.VIEWS['q-qc'](),summary=view.slice(0,view.indexOf('<details'));
  assert.match(summary,/Hitung terakhir 2026-10-09/);assert.doesNotMatch(summary,/Hitung terakhir 2026-10-10/);
});
test('source-only legacy issues do not claim a sewing remainder or ask for another delivery',()=>{
  const h=harness(),p=po();p.imporReview='Hubungan historis perlu ditinjau';
  load(h,[p],[receipt('full',40)],[{id:'q',poId:'p',setorId:'full',maklonId:'w',tanggal:'2026-10-08',ukuran:{M:40},total:40}]);
  const groups=h.groups();assert.equal(groups.length,1);assert.equal(groups[0].atSewing,0);assert.equal(groups[0].pendingCount,0);assert.equal(groups[0].ready,0);
  const view=h.VIEWS['q-qc']();assert.match(view,/Status hitungan perlu diperiksa/);assert.match(view,/Kelengkapan PO belum terverifikasi/);assert.doesNotMatch(view,/Tunggu setoran berikutnya|Hitungan belum lengkap/);
});
test('pending cutting keeps the PO card relevant without incorrectly asking for more sewing deliveries',()=>{
  for(const pending of [{pendingCutPlans:true},{pendingCutSizes:['L']}]){
    const h=harness(),p=po();load(h,[p],[receipt('full',40)],[{id:'q',poId:'p',setorId:'full',maklonId:'w',tanggal:'2026-10-08',ukuran:{M:40},total:40}]);Object.assign(p.workflow,pending);
    assert.equal(h.groups().length,1);const view=h.VIEWS['q-qc']();assert.match(view,/Pekerjaan PO belum lengkap/);assert.match(view,/Masih ada pekerjaan potong atau penugasan/);assert.doesNotMatch(view,/Tunggu setoran berikutnya|Seluruh jahitan sudah dihitung/);
  }
});

test('a source-specific historical hold stays in the PO card without hiding a different valid counted batch',()=>{
  const h=harness(),p=po();load(h,[p],[receipt('baseline',20),receipt('fresh',5,'2026-10-09')]);
  p.workflow.blockedQcSources={baseline:['M']};
  const group=h.groups()[0];assert.equal(group.counted,25);assert.equal(group.ready,5);assert.equal(group.waiting,20);
  const view=h.VIEWS['q-qc']();assert.equal(countCards(view),1);assert.match(view,/data-qc-batch="baseline"/);assert.match(view,/data-a="qcSlipOpen" data-id="fresh"/);assert.doesNotMatch(view,/data-a="qcSlipOpen" data-id="baseline"/);
});
test('a physical receipt whose PO is absent cannot create an actionable queue card',()=>{
  const h=harness();load(h,[],[receipt('orphan',10)]);assert.equal(h.groups().length,0);assert.doesNotMatch(h.VIEWS['q-qc'](),/data-a="qcSlipOpen"/);
});
