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
    var A={},C={},R={},VIEWS={},rendered='',calls=[],messages=[],closed=0,kpis=[];
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
    function emptyBox(s){return s;}function sizesSplit(){return {main:['M'],extra:[]};}function sizeGrid(sizes){return sizes.map(function(s){return '<input data-size="'+s+'">';}).join('');}
    function sumLine(){return '';}function tarifBawaan(){return 200;}function recalc(){}
    function cocok(q,x){return !q||x.some(function(y){return String(y||'').includes(q);});}function thumb(){return '';}
    function bahanTeks(r){return coreBahanPotong(r).map(function(b){return b.nama+(b.qty?' '+b.qty+' kg':'');}).join(' + ');}function poMeta(p){return p.id;}function sizeChips(){return '';}function todayYmd(){return '2026-10-08';}
    function miniKpi(rows){kpis=rows;return '';}function seg(){return '';}function searchBox(){return '';}
  `,c);
  vm.runInContext(part('/* ---------- bahan potong disiapkan owner ---------- */','/* ---------- kirim ke maklon ---------- */'),c);
  vm.runInContext(part('function projectWorkflow(po)', 'function poSizes(po)'),c);
  vm.runInContext(part('function poSizes(po)', 'function sizesSplit(po)'),c);
  vm.runInContext(html.match(/function catatanDipangkas\(\) \{[^\n]+/)[0],c);
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

test('owner can release a blocked unused reservation without exposing cutting or material edit to workers',async()=>{
 const c=ui();evaluate(c,"plan.legacyBlocked='Ukuran XL sudah dipotong.';plan.legacyUkuran=['XL']");assert.doesNotMatch(evaluate(c,'rencanaPotongPanel(po)'),/data-a="rencanaPotongReview"|data-a="potongOpen"/);evaluate(c,'A.rencanaPotongReview(el)');assert.match(c.messages.at(-1),/Hanya owner/);
 evaluate(c,"actor.divisi='owner'");const panel=evaluate(c,'rencanaPotongPanel(po)');assert.match(panel,/data-a="rencanaPotongReview"/);assert.doesNotMatch(panel,/data-a="potongOpen"/);evaluate(c,'A.rencanaPotongReview(el)');assert.match(c.rendered,/data-a="rencanaPotongCancel"/);assert.match(c.rendered,/name="revision" value="rev1"/);assert.doesNotMatch(c.rendered,/data-a="potongSave"|data-a="rencanaPotongSave"|data-size=|name="qty"/);
 evaluate(c,"form.values={id:'plan',poId:'po',revision:'rev1'};function confirmBox(o,cb){cancelTask=cb(el);}var cancelTask;A.rencanaPotongCancel()");assert.equal(c.calls[0].action,'saveRencanaPotong');assert.equal(c.calls[0].payload.rencana.status,'batal');assert.equal(c.calls[0].payload.expectedRevision,'rev1');assert.deepEqual(plain(c.calls[0].payload.rencana.bahanList),plain(c.plan.bahanList));c.calls[0].resolve({});await c.cancelTask;assert.equal(c.closed,1);
 evaluate(c,"plan.status='terpakai';rendered='';A.rencanaPotongReview(el)");assert.equal(c.rendered,'');assert.match(c.messages.at(-1),/telah dipakai/);assert.doesNotMatch(evaluate(c,'rencanaPotongPanel(po)'),/data-a="rencanaPotongReview"/);
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


test('done work includes old and prepared own cuts once each without exposing another worker',()=>{
  const c=ui();evaluate(c,`S.state.rencanaPotong=[{...plan,status:'terpakai',potongId:'prepared'},{...plan,id:'alias',status:'terpakai',potongId:'prepared'}];S.state.potong=[{id:'old',poId:'po',userId:'worker',tanggal:'2026-10-07',total:15,ukuran:{M:15},bahan:'Katun lama',kg:2},{id:'prepared',poId:'po',userId:'worker',tanggal:'2026-10-08',total:20,ukuran:{M:20},rencanaId:'plan'},{id:'private-other',poId:'po',userId:'other',tanggal:'2026-10-08',total:900,catatan:'PRIVATE'}];S.sub.pkerja='sudah';`);
  const out=evaluate(c,"VIEWS['p-kerja']()");assert.equal((out.match(/data-potong="old"/g)||[]).length,1);assert.equal((out.match(/data-potong="prepared"/g)||[]).length,1);assert.match(out,/15 pcs dipotong/);assert.match(out,/Katun lama 2 kg/);assert.doesNotMatch(out,/PRIVATE|private-other|900|data-a="potongOpen"/);
  assert.equal(c.kpis[2][1],'2');assert.equal(c.kpis[3][1],'20');
});
test('active uncut and partial PO remain waiting without fabricated material or unsafe input, including held PO',()=>{
  const c=ui();evaluate(c,`S.state.rencanaPotong=[];po.agg={total:{potong:20}};D.po.held={id:'held',nama:'Held',status:'aktif',total:0,workflow:{issues:['review']}};D.po.empty={id:'empty',nama:'Empty',status:'aktif',total:0};D.po.full={id:'full',nama:'Full',status:'aktif',total:30,agg:{total:{potong:30}}};D.po.closed={id:'closed',nama:'Closed',status:'selesai',total:99};S.state.po=[po,D.po.held,D.po.empty,D.po.full,D.po.closed];S.state.rencanaPotong=[{...plan,id:'blocked',poId:'held'}];S.state.potong=[{id:'partial',poId:'po',userId:'worker',tanggal:'2026-10-08',total:20}];`);
  const out=evaluate(c,"VIEWS['p-kerja']()");assert.match(out,/Menunggu bahan dari owner/);assert.match(out,/Sudah dipotong untuk PO: 20 dari 50 pcs/);assert.match(out,/Perlu diperiksa owner/);assert.match(out,/Empty/);assert.doesNotMatch(out,/Full|Closed|data-a="potongOpen"|Katun &lt;biru>|data-rencana="blocked"/);assert.equal(c.kpis[0][1],'0');assert.equal(c.kpis[1][1],'3');assert.equal(c.kpis[2][1],'1');
  evaluate(c,"S.sub.pkerja='sudah'");assert.match(evaluate(c,'S.listFn()'),/data-potong="partial"/);
});
test('a held PO that is already fully cut leaves the to-cut list and is shown under already cut; a held PO with work left stays',()=>{
  const c=ui();evaluate(c,`S.state.rencanaPotong=[];D.po.heldDone={id:'heldDone',nama:'HeldDone',status:'aktif',total:0,agg:{total:{potong:432}},workflow:{issues:['review']}};D.po.heldFull={id:'heldFull',nama:'HeldFull',status:'aktif',total:30,agg:{total:{potong:30}},workflow:{issues:['review']}};D.po.heldPart={id:'heldPart',nama:'HeldPart',status:'aktif',total:50,agg:{total:{potong:20}},workflow:{issues:['review']}};D.po.heldSize={id:'heldSize',nama:'HeldSize',status:'aktif',total:30,agg:{total:{potong:30}},cutting:{pendingUkuran:['XL']},workflow:{issues:['review']}};S.state.po=[D.po.heldDone,D.po.heldFull,D.po.heldPart,D.po.heldSize];S.state.potong=[];`);
  const todo=evaluate(c,"VIEWS['p-kerja']()");assert.doesNotMatch(todo,/HeldDone|HeldFull/);assert.match(todo,/HeldPart/);assert.match(todo,/HeldSize/);assert.match(todo,/Perlu diperiksa owner/);assert.equal(c.kpis[1][1],'2');
  evaluate(c,"S.sub.pkerja='sudah'");const cut=evaluate(c,'S.listFn()');assert.match(cut,/HeldDone/);assert.match(cut,/432 pcs sudah dipotong/);assert.match(cut,/HeldFull/);assert.match(cut,/30 dari 30 pcs sudah dipotong/);assert.doesNotMatch(cut,/HeldPart|HeldSize|data-a="potongOpen"/);
});
test('ready plan replaces its waiting placeholder and alone permits recording a result',()=>{
  const c=ui();evaluate(c,"po.agg={total:{potong:10}};D.po.wait={id:'wait',nama:'Menunggu',status:'aktif',total:60};S.state.po.push(D.po.wait)");const out=evaluate(c,"VIEWS['p-kerja']()");assert.equal((out.match(/data-id="po">Detail PO/g)||[]).length,1);assert.equal((out.match(/data-a="potongOpen"/g)||[]).length,1);assert.match(out,/data-rencana="plan"/);assert.equal(c.kpis[0][1],'1');assert.equal(c.kpis[1][1],'1');
});
test('search and existing list callback use the current tab and query for legacy history and pending PO',()=>{
  const c=ui();evaluate(c,`S.state.potong=[{id:'old',poId:'po',userId:'worker',tanggal:'2026-10-03',total:5,bahan:'Legacy Rib'},{id:'other',poId:'po',userId:'other',bahan:'Secret'}];VIEWS['p-kerja']();S.sub.pkerja='sudah';S.f.q='Legacy Rib';`);assert.match(evaluate(c,'S.listFn()'),/data-potong="old"/);evaluate(c,"S.f.q='Secret'");assert.doesNotMatch(evaluate(c,'S.listFn()'),/data-potong=/);evaluate(c,"S.f.q='2026-10-03'");assert.match(evaluate(c,'S.listFn()'),/data-potong="old"/);evaluate(c,"S.sub.pkerja='perlu';S.f.q='Katun <biru>'");assert.match(evaluate(c,'S.listFn()'),/data-rencana="plan"/);assert.doesNotMatch(evaluate(c,'S.listFn()'),/data-potong=/);
});
test('trimmed history always offers explicit old-data loading, including when current done list is empty',()=>{
  const c=ui();evaluate(c,"S.state.trimmed=true;S.sub.pkerja='sudah'");assert.match(evaluate(c,"VIEWS['p-kerja']()"),/data-a="loadAll"/);evaluate(c,"S.state.potong=[{id:'old',poId:'po',userId:'worker',total:2}]");assert.match(evaluate(c,"VIEWS['p-kerja']()"),/data-a="loadAll"/);evaluate(c,"S.state.trimmed=false");assert.doesNotMatch(evaluate(c,"VIEWS['p-kerja']()"),/data-a="loadAll"/);
});


test('verified pending sizes keep a mixed imported PO visible even when aggregate target is already met',()=>{
 const c=ui();evaluate(c,`S.state.rencanaPotong=[];po.total=10;po.ukuran={M:10};po.agg={total:{potong:10}};po.cutting={verified:true,ukuran:['M','XL','XXL'],pendingUkuran:['XL','XXL'],needsReview:false};`);
 let out=evaluate(c,"VIEWS['p-kerja']()");assert.match(out,/Belum dipotong:<\/b> XL · XXL/);assert.match(out,/Menunggu bahan dari owner/);assert.doesNotMatch(out,/data-a="potongOpen"/);assert.equal(c.kpis[1][1],'1');
 evaluate(c,"po.cutting.pendingUkuran=['XXL'];po.agg.total.potong=17");out=evaluate(c,"VIEWS['p-kerja']()");assert.match(out,/Belum dipotong:<\/b> XXL/);assert.doesNotMatch(out,/Belum dipotong:<\/b> XL ·/);
 evaluate(c,"po.cutting.pendingUkuran=[];po.agg.total.potong=22");assert.equal(evaluate(c,"VIEWS['p-kerja']();kpis[1][1]"),'0');
});
test('size picker includes verified source sizes without changing target quantities and ignores unverified additions',()=>{
 const c=ui();evaluate(c,"po.cutting={verified:true,ukuran:['M','XL','XXL'],pendingUkuran:['XL','XXL']}");assert.deepEqual(plain(evaluate(c,'poSizes(po)')),['M','XL','XXL']);assert.deepEqual(plain(c.po.ukuran),{M:50});evaluate(c,"po.cutting={verified:false,ukuran:['INJECT']}");assert.deepEqual(plain(evaluate(c,'poSizes(po)')),['M']);
});

test('legacy single-size preparation shows only its allowed size and held source plans stay visible to owner',()=>{
 const c=ui();evaluate(c,"plan.legacyUkuran=['XL'];openPotong('po','plan')");assert.match(c.rendered,/data-size="XL"/);assert.doesNotMatch(c.rendered,/data-size="M"/);evaluate(c,"A.potongSave(el)");assert.equal(c.calls.length,0);assert.match(c.messages.join(' '),/ukuran pada jatah/);
 evaluate(c,"plan.legacyBlocked='Ukuran sudah dipotong; periksa owner';openPotong('po','plan')");assert.doesNotMatch(c.rendered,/data-a="potongSave"/);assert.match(c.rendered,/periksa owner/);
 evaluate(c,"actor.divisi='owner';po.cutting={reviewPlans:[{ukuran:['XL','XXL'],reason:'Jatah lama mencakup beberapa ukuran dan perlu diperiksa owner sebelum dipakai.'}]}");const panel=evaluate(c,'rencanaPotongPanel(po)');assert.match(panel,/Jatah bahan lama · perlu diperiksa/);assert.match(panel,/Ukuran: XL · XXL/);assert.doesNotMatch(panel,/data-a="potongOpen"/);
});

test('Catat potong on a PO whose material is already prepared opens that preparation, unless other material is asked for',()=>{
 const c=ui();evaluate(c,"actor.divisi='owner';var direct={getAttribute:function(k){return k==='data-id'?'po':'';}};A.potongOpen(direct)");
 assert.match(c.rendered,/name="rencanaId" value="plan"/);assert.match(c.rendered,/Bahan yang disiapkan owner/);assert.match(c.rendered,/5 kg/);assert.match(c.rendered,/data-a="potongUbahBahan"/);assert.match(c.rendered,/data-langsung="1"/);assert.doesNotMatch(c.rendered,/data-bahan-qty/);
 evaluate(c,"var other={getAttribute:function(k){return {'data-id':'po','data-langsung':'1'}[k]||'';}};A.potongOpen(other)");assert.match(c.rendered,/name="rencanaId" value=""/);assert.match(c.rendered,/data-bahan-qty/);
 evaluate(c,"plan.status='terpakai';A.potongOpen(direct)");assert.match(c.rendered,/name="rencanaId" value=""/,'a used preparation is not offered again');
 evaluate(c,"plan.status='siap';actor.divisi='potong';A.potongOpen(direct)");assert.match(c.rendered,/Pilih bahan yang sudah disiapkan owner/);
});
test('owner without a preparation picks rolls from stock: kilos follow the rolls, a leftover can be added, typing by hand stays possible',async()=>{
 const c=ui();vm.runInContext(part('function poPrepareOwner()','function poPendingPlansHtml()'),c);
 evaluate(c,`function jumlahPerSatuan(rows){return rows.reduce(function(n,r){return n+Number(r.qty);},0)+' kg';}
   $$=function(s,f){if(s==='[data-roll-choice]')return f.rollRows||[];if(s==='[data-po-legacy-bahan]')return f.legacyRows||[];if(s==='[data-rencana-bahan]')return f.rows;return [];};
   actor.divisi='owner';S.state.rencanaPotong=[];po.bahan='katun  COMBED';stocks=[{kunci:'katun combed',nama:'Katun Combed',satuan:'kg',saldo:52,tersedia:52,legacyTersedia:3}];
   S.state.stokRol=[{id:'rollA',bahan:'Katun Combed',satuan:'kg',qty:25,tersedia:25,invoice:'BON-1',rollLabel:'Rol 1'},{id:'rollB',bahan:'Katun Combed',satuan:'kg',qty:24,tersedia:24,invoice:'BON-1',rollLabel:'Rol 2'},{id:'rollC',bahan:'Katun Combed',satuan:'kg',qty:20,tersedia:0,invoice:'BON-0',rollLabel:'Rol 9'}];openPotong('po','')`);
 assert.match(c.rendered,/data-potong-bahan/);assert.match(c.rendered,/name="rencanaBaru" value="new-plan_cut"/);assert.match(c.rendered,/Kilonya otomatis mengikuti sisa rol/);
 assert.match(c.rendered,/data-roll-choice="rollA"[\s\S]*?25 kg tersedia[\s\S]*?data-roll-qty value="25"/);assert.match(c.rendered,/data-roll-choice="rollB"[\s\S]*?24 kg tersedia[\s\S]*?data-roll-qty value="24"/);assert.doesNotMatch(c.rendered,/data-roll-choice="rollC"/);
 assert.match(c.rendered,/Tambahkan sisa kiloan/);assert.match(c.rendered,/data-potong-manual hidden/);assert.match(c.rendered,/data-bahan-qty/);
 evaluate(c,`function row(id,qty){return {nodes:{'[data-roll-select]':{checked:true},'[data-roll-qty]':{value:String(qty)}},getAttribute:function(){return id;}};}
   form.values={id:'result',poId:'po',rencanaId:'',rencanaRevision:'',rencanaBaru:'result_cut',prepareMode:'roll',includeLegacy:true,legacyRol:'0',tanggal:'2026-10-08',catatan:'',userId:'cutter',tarif:'200'};
   form.nodes['[data-potong-bahan]']={};form.nodes['[data-roll-picker]']={getAttribute:function(){return '';}};form.rollRows=[row('rollA',25),row('rollB',24)];form.legacyRows=[{values:{legacyBahan:'Katun Combed',legacyQty:'2'}}];`);
 const sent=evaluate(c,'A.potongSave(el)');evaluate(c,'A.potongSave(el)');assert.equal(c.calls.length,1,'a double tap sends once');assert.equal(c.calls[0].action,'createPotong');
 assert.deepEqual(plain(c.calls[0].payload.potong),{id:'result',poId:'po',userId:'cutter',tanggal:'2026-10-08',ukuran:{M:50},rencana:{alokasiBahan:[{stokId:'rollA',qty:25},{stokId:'rollB',qty:24}],legacyBahanList:[{nama:'Katun Combed',qty:2,satuan:'kg'}],legacyRol:0,id:'result_cut'},tarif:'200',catatan:''});
 c.calls[0].resolve({});await sent;assert.equal(c.closed,1);assert.equal(c.form._potongBusy,false);
 /* more than the roll holds is stopped on the device; "ketik sendiri" keeps the old hand-typed path */
 evaluate(c,"form.rollRows=[row('rollA',25.5)];A.potongSave(el)");assert.equal(c.calls.length,1);assert.match(c.messages.join(' '),/tidak melebihi sisa/);
 evaluate(c,"form.values.prepareMode='manual';A.potongSave(el)");assert.equal(c.calls.length,2);assert.equal(c.calls[1].payload.potong.rencana,undefined);assert.deepEqual(plain(c.calls[1].payload.potong.bahanList),[]);
});
