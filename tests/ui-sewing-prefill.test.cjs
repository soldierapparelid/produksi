'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
function fixture(){const c=vm.createContext({console});vm.runInContext(fs.readFileSync(path.join(root,'src/core.js'),'utf8'),c);vm.runInContext(`
var A={},S={state:{settings:{ukuran:['M','L','XL']}}},D={po:{}},rendered='',requests=[],messages=[],closed=0,slips=[];
var po={id:'po1',nama:'Kemeja',status:'aktif',ukuran:{M:156,L:150,XL:138}};D.po.po1=po;
var cut={id:'cut1',poId:'po1',ukuran:{M:156,L:150,XL:138},total:444},sent={id:'send1',poId:'po1',maklonId:'maklon1',ukuran:{XL:138},total:138};
function setAssigned(map){sent.ukuran=map;sent.total=coreSumSizes(map);po.workflow=coreWorkflow([po],[cut],[sent],[],[],[],{}).po1;}setAssigned({XL:138});po.agg={ukuran:{M:{siapKirim:1}},total:{siapKirim:1}};
var form={values:{id:'draft1',poId:'po1',maklonId:'maklon1',tanggal:'2026-10-08',upah:1000},sizes:{M:50},getAttribute:function(){return '306';}},button={};
function $(s,n){return null;}function topForm(){return form;}function formVals(f){return f.values;}function sizeVals(f){return f.sizes;}function workflowFor(p){return p.workflow;}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}function nf(n){return String(n||0);}function pos(n){return Math.max(0,coreNum(n));}function newId(){return 'draft1';}
function openSheet(render){rendered=render();}function sheetHtml(t,b,f){return t+b+(f||'');}function emptyBox(t){return t;}function poHead(p){return esc(p.nama);}function maklonAktif(){return [{id:'maklon1',nama:'Maklon'}];}
function hid(k,v){return '<input name="'+k+'" value="'+esc(v)+'">';}function fSelect(){return '';}function fTanggal(){return '';}function fNum(){return '';}function fCatatan(){return '';}function tarifBawaan(){return 1000;}function sumLine(t){return t;}function footSave(a,t){return '<button data-a="'+a+'">'+t+'</button>';}function miniKpi(rows){return rows.map(function(r){return '<div>'+r.join(' ')+'</div>';}).join('');}
function toast(t){messages.push(t);}function quiet(e){messages.push(e.message);}function dropForm(){closed++;}function openSlip(t,id){slips.push(id);}function act(el,p){return p;}function req(action,payload){return new Promise(function(resolve,reject){requests.push({action,payload,resolve,reject});});}
`,c);vm.runInContext(part('function sizeGrid(sizes, o)','A.fillMax ='),c);vm.runInContext(part('function projectWorkflow(po)','function workflowFor(po)'),c);vm.runInContext(part('A.kirimOpen =','/* tutup lembar form tertentu'),c);return {c,run:s=>vm.runInContext(s,c)};}
function value(markup,size){const re=new RegExp('data-size="'+size+'"[^>]*value="([^\"]*)"');const match=markup.match(re);assert.ok(match,size);return match[1];}
test('444 cut minus 138 assigned prefills remaining M156 L150 XL0 and shows per-size context',()=>{
 const f=fixture();f.run("openKirim('po1','')");const out=f.c.rendered;assert.equal(value(out,'M'),'156');assert.equal(value(out,'L'),'150');assert.equal(value(out,'XL'),'0');assert.match(out,/Hasil potong 444 pcs/);assert.match(out,/Sudah ditugaskan 138 pcs/);assert.match(out,/Tersedia 306 pcs/);assert.match(out,/Potong 138 · ditugaskan 138 · sisa 0/);assert.match(out,/membagi ke beberapa maklon/);assert.equal(f.c.requests.length,0);
});
test('one size can be given to one sewer: the size button fills that size and clears the others',()=>{
 const f=fixture();f.run("openKirim('po1','')");const out=f.c.rendered;
 assert.match(out,/Tugaskan hanya ukuran:/);assert.match(out,/data-a="kirimHanya" data-s="M">M \(156\)/);assert.match(out,/data-a="kirimHanya" data-s="L">L \(150\)/);assert.ok(!/data-a="kirimHanya" data-s="XL"/.test(out),'a size with nothing left is not offered');
 f.run(`var picked=[{s:'M',value:'156',max:'156'},{s:'L',value:'150',max:'150'},{s:'XL',value:'0',max:null}].map(function(x){return {value:x.value,getAttribute:function(k){return k==='data-size'?x.s:x.max;}};}),recalced=0;
  var $$=function(sel){return sel==='input[data-size]'?picked:[];},recalc=function(){recalced++;};
  A.kirimHanya({closest:function(){return {};},getAttribute:function(){return 'L';}});`);
 assert.deepEqual(JSON.parse(f.run('JSON.stringify(picked.map(function(i){return String(i.value);}))')),['0','150','0']);assert.equal(f.run('recalced'),1);assert.equal(f.c.requests.length,0);
});test('owner may reduce prefilled quantities to split assignment and duplicate taps send only one request',async()=>{
 const f=fixture();f.run("openKirim('po1','')");const p=f.run('A.kirimSave(button)');f.run('A.kirimSave(button)');assert.equal(f.c.requests.length,1);assert.deepEqual(JSON.parse(JSON.stringify(f.c.requests[0].payload.kirim.ukuran)),{M:50});f.c.requests[0].resolve({id:'saved1'});await p;assert.equal(f.c.closed,1);assert.equal(f.c.slips[0],'saved1');assert.equal(f.c.form._kirimBusy,false);
});
test('fully assigned PO keeps all zero sizes visible and has no active save action',()=>{
 const f=fixture();f.run("setAssigned({M:156,L:150,XL:138});openKirim('po1','')");const out=f.c.rendered;for(const size of ['M','L','XL'])assert.equal(value(out,size),'0');assert.match(out,/Tersedia 0 pcs/);assert.match(out,/disabled>Semua sudah ditugaskan/);assert.doesNotMatch(out,/data-a="kirimSave"/);assert.equal(f.c.requests.length,0);
});
test('reopening uses updated authoritative remaining counts even when aggregate cache was previously rendered',()=>{
 const f=fixture();f.run("openKirim('po1','');setAssigned({M:100,XL:138});openKirim('po1','')");assert.equal(value(f.c.rendered,'M'),'56');assert.equal(value(f.c.rendered,'L'),'150');assert.equal(value(f.c.rendered,'XL'),'0');assert.match(f.c.rendered,/Tersedia 206 pcs/);f.run("form.sizes={M:156,L:150};A.kirimSave(button)");assert.equal(f.c.requests.length,0);assert.match(f.c.messages.join(' '),/melebihi hasil potong/);
});
