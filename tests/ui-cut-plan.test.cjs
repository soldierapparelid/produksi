'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function part(a,b){const start=html.indexOf(a),end=html.indexOf(b,start+a.length);assert.ok(start>=0&&end>start,a);return html.slice(start,end);}
function ui(){
  const c=vm.createContext({console});
  vm.runInContext(fs.readFileSync(path.join(root,'src/core.js'),'utf8'),c);
  vm.runInContext(`
    var A={},C={},R={},VIEWS={},rendered='',calls=[],messages=[],closed=0;
    var actor={id:'worker',divisi:'potong'},S={state:{users:[],potong:[],rencanaPotong:[],bahan:[],settings:{}},f:{q:''},sub:{}},D={po:{},produk:{}};
    var po={id:'po',nama:'Kaos <uji>',status:'aktif',ukuran:{M:50},total:50,workflow:{issues:[]}};D.po.po=po;S.state.po=[po];
    var plan={id:'plan',poId:'po',status:'siap',bahanList:[{nama:'Katun <biru>',qty:5,satuan:'kg'},{nama:'Rib',qty:1,satuan:'yard'}],rol:2,revision:'rev1',dibuat:'2026-10-08',catatan:'Petunjuk <owner>'};S.state.rencanaPotong=[plan];
    var stocks=[{nama:'Katun <biru>',satuan:'kg',saldo:20,tersedia:15},{nama:'Rib',satuan:'yard',saldo:10,tersedia:9}];
    var form={values:{id:'result',poId:'po',rencanaId:'plan',rencanaRevision:'rev1',tanggal:'2026-10-08',catatan:'Selesai',bahan:'INJECT',kg:999,rol:999,tarif:999,userId:'other'},rows:[],nodes:{},children:[],appendChild:function(n){this.children.push(n);}};
    form.nodes['[data-rencana-notice]']={hidden:true,innerHTML:''};
    var el={getAttribute:function(k){return {'data-id':'plan','data-po':'po'}[k];},closest:function(){return form;}};
    var document={createElement:function(){return {className:'',innerHTML:''};}};
    function me(){return actor;}function isAdmin(){return actor.divisi==='owner'||actor.divisi==='admin';}
    function workflowFor(p){return p.workflow||{issues:[]};}function stokTampil(){return stocks;}
    function bahanInfo(n){return stocks.find(function(b){return coreNormBahan(b.nama)===coreNormBahan(n);})||null;}
    function $(s,f){return f.nodes&&f.nodes[s]||null;}function $$(s,f){if(s==='[data-rencana-bahan]')return f.rows;return [];}
    function formVals(f){return Object.assign({},f.values);}function topForm(){return form;}function sizeVals(){return {M:50};}
    function act(el,p){return p;}function quiet(e){messages.push(e&&e.message);}
    function req(action,payload){return new Promise(function(resolve,reject){calls.push({action:action,payload:payload,resolve:resolve,reject:reject});});}
    function toast(s){messages.push(s);}function dropForm(){closed++;}function applyState(){}function refresh(){}
    function newId(){return 'new-plan';}function openSheet(fn){rendered=fn();}function sheetHtml(t,b,f){return t+b+(f||'');}
    function esc(s){return String(s===undefined?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}
    function nf(s){return String(s||0);}function nfQty(s){return String(s||0);}function satuanPendek(s){return s==='yard'?'yd':s;}
    function poHead(p){return esc(p.nama);}function tgl(s){return s;}function ic(){return '';}
    function hid(k,v){return '<input name="'+k+'" value="'+esc(v)+'">';}
    function fNum(t,n,v){return '<label>'+t+'<input name="'+n+'" value="'+esc(v)+'"></label>';}
    function fSelect(t,n){return '<select name="'+n+'"></select>';}function fTanggal(t,n){return '<input name="'+n+'">';}
    function fCatatan(){return '<textarea name="catatan"></textarea>';}function footSave(a){return '<button data-a="'+a+'">Simpan</button>';}
    function emptyBox(s){return s;}function sizesSplit(){return {main:['M'],extra:[]};}function sizeGrid(){return '<input data-size="M">';}
    function sumLine(){return '';}function tarifBawaan(){return 200;}function recalc(){}
    function cocok(q,x){return !q||x.some(function(y){return String(y||'').includes(q);});}function thumb(){return '';}
    function poMeta(p){return p.id;}function sizeChips(){return '';}function todayYmd(){return '2026-10-08';}
    function miniKpi(){return '';}function seg(){return '';}function searchBox(){return '';}
  `,c);
  vm.runInContext(part('/* ---------- bahan potong disiapkan owner ---------- */','/* ---------- kirim ke maklon ---------- */'),c);
  vm.runInContext(part("VIEWS['p-kerja'] =", "VIEWS['p-riwayat'] ="),c);
  return c;
}
function evaluate(c,s){return vm.runInContext(s,c);}
function plain(x){return JSON.parse(JSON.stringify(x));}
test('owner prepares existing-stock materials in PO detail; worker and held PO cannot create plans',()=>{
  const c=ui();
  assert.doesNotMatch(evaluate(c,'rencanaPotongPanel(po)'),/data-a="rencanaPotongOpen"/);
  evaluate(c,"actor.divisi='owner'");
  const owner=evaluate(c,'rencanaPotongPanel(po)');assert.match(owner,/Siapkan bahan/);assert.match(owner,/Katun &lt;biru>/);assert.doesNotMatch(owner,/<owner>/);
  evaluate(c,'A.rencanaPotongOpen(el)');assert.match(c.rendered,/Ubah bahan potong/);assert.match(c.rendered,/name="revision" value="rev1"/);assert.match(c.rendered,/name="rol"/);
  evaluate(c,"po.workflow.issues=['Periksa data lama']");assert.doesNotMatch(evaluate(c,'rencanaPotongPanel(po)'),/data-a="rencanaPotongOpen"/);
});
test('cutter queue shows only prepared active clean work and own consumed work',()=>{
  const c=ui();evaluate(c,`D.po.held={id:'held',status:'aktif',workflow:{issues:['review']}};D.po.closed={id:'closed',status:'selesai'};
    S.state.rencanaPotong.push({...plan,id:'held-plan',poId:'held'},{...plan,id:'closed-plan',poId:'closed'},{...plan,id:'cancel',status:'batal'},{...plan,id:'done',status:'terpakai',potongId:'cut'},{...plan,id:'other-done',status:'terpakai',potongId:'other-cut'});
    S.state.potong=[{id:'cut',userId:'worker',total:50},{id:'other-cut',userId:'other',total:2}];`);
  const ready=evaluate(c,"VIEWS['p-kerja']()");assert.match(ready,/data-rencana="plan"/);assert.doesNotMatch(ready,/data-rencana="(?:held-plan|closed-plan|cancel|done)"/);
  evaluate(c,"S.sub.pkerja='sudah'");const done=evaluate(c,"VIEWS['p-kerja']()");assert.match(done,/Sudah dipotong/);assert.doesNotMatch(done,/data-a="potongOpen"/);
});
test('prepared form has readonly materials and rolls while direct admin path remains available',()=>{
  const c=ui();evaluate(c,"openPotong('po','plan')");assert.match(c.rendered,/5 kg/);assert.match(c.rendered,/2 rol/);assert.match(c.rendered,/data-size="M"/);
  assert.match(c.rendered,/name="rencanaRevision" value="rev1"/);assert.doesNotMatch(c.rendered,/data-bahan(?:-qty)?[ >]|name="rol"|name="tarif"/);
  evaluate(c,"openPotong('po','')");assert.match(c.rendered,/Pilih bahan yang sudah disiapkan owner/);assert.doesNotMatch(c.rendered,/data-a="potongSave"/);
  evaluate(c,"actor.divisi='owner';openPotong('po','')");assert.match(c.rendered,/data-bahan-qty/);assert.match(c.rendered,/name="rol"/);
});
test('worker submission sends only count and frozen plan proof, ignores injected materials, and prevents double tap',async()=>{
  const c=ui();const p=evaluate(c,'A.potongSave(el)');evaluate(c,'A.potongSave(el)');assert.equal(c.calls.length,1);
  const payload=plain(c.calls[0].payload.potong);assert.deepEqual(payload,{id:'result',poId:'po',rencanaId:'plan',expectedRencanaRevision:'rev1',tanggal:'2026-10-08',ukuran:{M:50},catatan:'Selesai'});
  c.calls[0].resolve({});await p;assert.equal(c.closed,1);assert.equal(c.form._potongBusy,false);
});
test('used, mismatched, held, or revised plans cannot be submitted from stale worker form',()=>{
  for(const change of ["plan.status='terpakai'","plan.poId='another'","po.workflow.issues=['review']","plan.revision='rev2'"]){const c=ui();evaluate(c,change);evaluate(c,'A.potongSave(el)');assert.equal(c.calls.length,0,change);assert.ok(c.messages.length);}
});
test('owner payload uses exact units and original revision; duplicate stock and unknown names are rejected',()=>{
  const c=ui();evaluate(c,`actor.divisi='owner';form.values={id:'plan',poId:'po',revision:'rev1',rol:'3',catatan:'Tolong rapi'};form.rows=[{values:{nama:'Katun <biru>',qty:'6'}},{values:{nama:'Rib',qty:'2'}}];`);
  const payload=plain(evaluate(c,"rencanaPotongValues(form,'siap')"));assert.equal(payload.expectedRevision,'rev1');assert.deepEqual(payload.rencana.bahanList,[{nama:'Katun <biru>',qty:6,satuan:'kg'},{nama:'Rib',qty:2,satuan:'yard'}]);
  evaluate(c,"form.rows[1].values.nama='Katun <biru>'");assert.throws(()=>evaluate(c,"rencanaPotongValues(form,'siap')"),/Gabungkan/);
  evaluate(c,"form.rows[1].values.nama='Tidak terdaftar'");assert.throws(()=>evaluate(c,"rencanaPotongValues(form,'siap')"),/Pilih bahan/);
  evaluate(c,"actor.divisi='potong'");assert.throws(()=>evaluate(c,"rencanaPotongValues(form,'siap')"),/owner/);
});
test('plan editing availability adds its own reservation back and cancellation retains original materials',()=>{
  const c=ui();evaluate(c,`actor.divisi='owner';form.values={id:'plan',poId:'po',revision:'rev1',rol:'',catatan:'unsaved'};form.rows=[{values:{nama:'Katun <biru>',qty:'999'},nodes:{'[data-rencana-saldo]':{},'[data-rencana-satuan]':{}}}];R.rencanaPotong(form);`);
  assert.match(c.form.rows[0].nodes['[data-rencana-saldo]'].textContent,/20 kg/);
  const cancel=plain(evaluate(c,"rencanaPotongValues(form,'batal')"));assert.deepEqual(cancel.rencana.bahanList,plain(c.plan.bahanList));assert.equal(cancel.rencana.rol,2);assert.equal(cancel.rencana.status,'batal');
});
test('uncertain plan save requires read-only status check before a new form',async()=>{
  const c=ui();evaluate(c,`actor.divisi='owner';form.values={id:'plan',poId:'po',revision:'rev1',rol:'2'};form.rows=[{values:{nama:'Rib',qty:'1'}}];`);
  const p=evaluate(c,'A.rencanaPotongSave(el)');c.calls[0].reject(Object.assign(new Error('Jawaban belum diterima'),{uncertain:true}));await p;
  assert.equal(c.form._rencanaBusy,false);assert.equal(c.form._rencanaUncertain,true);assert.match(c.form.nodes['[data-rencana-notice]'].innerHTML,/Periksa data terbaru/);
  evaluate(c,'A.rencanaPotongSave(el)');assert.equal(c.calls.length,1);
  const check=evaluate(c,'A.rencanaPotongCheck(el)');assert.equal(c.calls[1].action,'getState');c.calls[1].resolve({});await check;assert.equal(c.closed,1);
});
test('worker uncertain count stops resubmission and retains a status-check action',async()=>{
  const c=ui();const p=evaluate(c,'A.potongSave(el)');c.calls[0].reject(Object.assign(new Error('uncertain'),{uncertain:true}));await p;
  assert.equal(c.form._potongBusy,false);assert.equal(c.form._potongUncertain,true);assert.match(c.form.children[0].innerHTML,/data-a="rencanaPotongCheck"/);
  evaluate(c,'A.potongSave(el)');assert.equal(c.calls.length,1);
});
