'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
function ui(){const c=vm.createContext({console});vm.runInContext(fs.readFileSync(path.join(root,'src/core.js'),'utf8'),c);vm.runInContext(`
 var A={},C={},R={},actor={id:'owner',divisi:'owner'},requests=[],messages=[],closed=0,rendered='',D={po:{},produk:{product:{id:'product',nama:'Kaos',series:'Seri'}}};
 var stock=[{kunci:'katun',nama:'Katun',satuan:'kg',saldo:30,tersedia:25,legacyTersedia:10},{kunci:'rib',nama:'Rib',satuan:'kg',saldo:4,tersedia:4,legacyTersedia:0}];
 var rolls=[{id:'rollA',bahan:'Katun',satuan:'kg',qty:8,tersedia:5,invoice:'BON-A',rollLabel:'Rol 1'},{id:'rollB',bahan:'Katun',satuan:'kg',qty:10,tersedia:10,invoice:'BON-A',rollLabel:'Rol 2'},{id:'rollC',bahan:'Rib',satuan:'kg',qty:4,tersedia:4,invoice:'BON-B',rollLabel:'Rol 1'}];
 var S={state:{po:[],users:[],produk:[],stokRol:rolls,stokRingkas:stock,rencanaPotong:[],settings:{ukuran:['M']}},tab:'po',f:{},sub:{}},sheet={};
 var form={values:{id:'',newId:'newpo001',rencanaId:'newpo001_cut',produkId:'product',jenis:'stok',nama:'Kaos',series:'Seri',pelanggan:'',deadline:'',bahan:'',catatan:'Catatan',noPO:'',status:'aktif',siapkanPotong:true,prepareMode:'roll',legacyRol:'0'},meta:{},choices:[],legacy:[],controls:[],closest:function(){return sheet;}};
 function element(attrs){return {disabled:false,attributes:attrs||{},getAttribute:function(k){return this.attributes[k]||'';},closest:function(){return form;},classList:{add:function(){},remove:function(){}}};}
 function choice(id,qty,checked){var row={selected:{checked:checked!==false},input:{value:String(qty),disabled:checked===false},getAttribute:function(){return id;}};return row;}
 form.choices=[choice('rollA',5),choice('rollC',2)];form.meta['[data-roll-picker]']={getAttribute:function(){return '';}};form.meta['[data-roll-summary]']={textContent:''};form.meta['[data-po-prepared-notice]']={hidden:true,innerHTML:''};
 var button=element({'data-a':'poSave'}),check=element({'data-a':'poPreparedCheck'}),retry=element({'data-a':'poPreparedRetry'});form.controls=[element(),element()];
 function $(q,scope){scope=scope||form;if(q==='[data-roll-select]')return scope.selected;if(q==='[data-roll-qty]')return scope.input;return scope.meta&&scope.meta[q]||null;}
 function $$(q,scope){scope=scope||form;if(q==='[data-po-active-size]:checked')return (scope.activeSizes||['M']).map(function(s){return element({'data-po-active-size':s});});if(q==='[data-roll-choice]')return scope.choices||[];if(q==='[data-po-legacy-bahan]')return scope.legacy||[];if(q==='input,select,textarea,button')return scope.controls||[];if(q==='[data-a="poSave"]')return [button];return [];}
 function formVals(f){return Object.assign({},f.values);}function sizeVals(){return {M:40};}function topForm(){return form;}function me(){return actor;}function isAdmin(){return actor.divisi==='owner'||actor.divisi==='admin';}function workflowFor(){return {issues:[]};}
 function stokTampil(){return stock;}function bahanInfo(n){return stock.find(function(b){return b.kunci===coreNormBahan(n);});}
 function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}function nf(n){return String(n);}function nfQty(n){return String(n);}function satuanPendek(s){return s;}function rp(n){return 'Rp '+n;}function ic(){return '';}function thumb(){return '';}
 function jumlahPerSatuan(rows){return rows.reduce(function(n,r){return n+Number(r.qty);},0)+' kg';}function todayYmd(){return '2026-10-08';}function hid(k,v){return '<input name="'+k+'" value="'+esc(v)+'">';}
 function fCatatan(v){return '<textarea name="catatan">'+esc(v)+'</textarea>';}function footSave(a){return '<button data-a="'+a+'">Simpan</button>';}function sumLine(){return '';}function sizeGrid(){return '';}function emptyBox(s){return s;}function newId(){return 'newpo001';}
 function sheetHtml(title,body,foot){return title+body+(foot||'');}function openSheet(fn){rendered=fn();}function render(){}function dropForm(){closed++;}function poSheet(){return '';}
 function poPaintDraftGambar(){}function poDraftGambarHtml(){return '<div data-po-image>Desain</div>';}function toast(m){messages.push(m);}function quiet(){}function act(el,p){return p;}function refresh(){}
 function applyState(state){S.state=state;D.po={};state.po.forEach(function(p){D.po[p.id]=p;});}
 function req(action,payload){return new Promise(function(resolve,reject){requests.push({action:action,payload:payload,resolve:resolve,reject:reject});});}
 `,c);vm.runInContext(part('function fTanggal(','/* ---------- hitungan PO'),c);vm.runInContext(part('function rencanaPotongById(','function rencanaPotongPanel('),c);vm.runInContext(part('function poPrepareOwner()','A.poNew ='),c);vm.runInContext(part('function openPO(id, produkId)','C.poJenisForm ='),c);vm.runInContext(part('A.poSave = function','A.poDelete ='),c);return {c,run:s=>vm.runInContext(s,c),json:s=>JSON.parse(vm.runInContext('JSON.stringify('+s+')',c)),resolve(i,v){c.requests[i].resolve(v);},reject(i,msg='Jawaban belum diterima'){c.requests[i].reject(Object.assign(new Error(msg),{uncertain:true}));}};}

test('product and custom new PO share obvious prepared-material choices, while non-owner has no allocation control',()=>{
 const h=ui();for(const product of ['', 'product']){h.run(`openPO('',${JSON.stringify(product)})`);const html=h.run('rendered');assert.match(html,/Bahan potong \(wajib\)/);assert.doesNotMatch(html,/name="siapkanPotong"|siapkan nanti/);assert.match(html,/Saldo lama/);assert.match(html,/data-po-image/);assert.match(html,/data-roll-picker/);assert.match(html,/PO baru harus memiliki bahan dan jumlah yang disiapkan/);}
 h.run("actor.divisi='admin';openPO('','product')");assert.doesNotMatch(h.run('rendered'),/data-roll-picker|siapkanPotong/);
});

test('new PO requires explicitly checked active sizes and sends no target quantity with the same material reservation',async()=>{
 const h=ui();h.run("S.state.settings.ukuran=['S','M','L','XL'];openPO('','product')");const shown=h.run('rendered');assert.match(shown,/Ukuran aktif/);assert.doesNotMatch(shown,/data-po-active-size="[^"]+" checked|data-size=|Target per ukuran/);
 h.run('form.activeSizes=[];A.poSave(button)');assert.equal(h.run('requests.length'),0);assert.match(h.run('messages[messages.length-1]'),/Pilih minimal satu ukuran/);
 h.run("form.activeSizes=['M','XL']");const done=h.run('A.poSave(button)');await Promise.resolve();assert.deepEqual(h.json('requests[0].payload.po.ukuranAktif'),['M','XL']);assert.deepEqual(h.json('requests[0].payload.po.ukuran'),{});assert.equal(h.run('requests[0].payload.po.total'),undefined);assert.equal(h.run('requests[0].action'),'savePOWithRencana');assert.equal(h.run('requests[0].payload.rencana.alokasiBahan.length'),2);h.resolve(0,{po:{id:'newpo001'},rencana:{id:'newpo001_cut'},pending:false});await done;
});

test('legacy target editor preserves recorded quantities while selected-size production offers no unselected extras',async()=>{
 const h=ui();h.run("D.po.old={id:'old',nama:'Old',asal:'lama',jenis:'stok',status:'aktif',ukuran:{M:114},total:114};openPO('old','');form.values.id='old'");assert.match(h.run('rendered'),/Ukuran dan jumlah riwayat lama tetap disimpan/);assert.doesNotMatch(h.run('rendered'),/data-po-active-size|data-size=/);const done=h.run('A.poSave(button)');await Promise.resolve();assert.deepEqual(h.json('requests[0].payload.po.ukuran'),{M:114});assert.equal(h.run('requests[0].payload.po.ukuranAktif'),undefined);h.resolve(0,{id:'old'});await done;
 vm.runInContext(part('function poSizes(po)','function workflowFor('),h.c);h.run("S.state.settings.ukuran=['S','M','L','XL'];var selected={ukuran:{},ukuranAktif:['M','L'],cutting:{verified:true,ukuran:['M','L']}};");assert.deepEqual(h.json('sizesSplit(selected)'),{main:['M','L'],extra:[]});assert.deepEqual(h.json("sizesSplit({ukuran:{M:114}})"),{main:['M'],extra:['S','L','XL']});
});
test('roll picker displays actual remaining weight and invoice and never fabricates old-stock roll identities',()=>{
 const h=ui(),view=h.run("rollChoicesHtml('Katun',[],'')");assert.match(view,/BON-A/);assert.match(view,/Rol 1/);assert.match(view,/5 kg tersedia/);assert.match(view,/berat awal 8 kg/);assert.match(view,/Untuk PO \(kg\)/);
 assert.deepEqual(h.json('rollPickerValues(form)'),[{stokId:'rollA',qty:5},{stokId:'rollC',qty:2}]);
 h.run("stock.push({kunci:'lama',nama:'Lama',satuan:'kg',saldo:50,legacyTersedia:50})");assert.match(h.run("rollChoicesHtml('Lama',[],'')"),/Saldo lama tanpa rincian berat tiap rol/);assert.doesNotMatch(h.run("rollChoicesHtml('Lama',[], '')"),/data-roll-choice/);
});

test('material summary totals allocated roll weights and optional old balance by product material without inventing roll weights',()=>{
 const h=ui();h.run("form.meta['[data-po-material-summary]']={innerHTML:''};form.values.includeLegacy=true;form.legacy=[{values:{legacyBahan:'Katun',legacyQty:'3'}}];poPreparedSummaryRecalc(form)");let summary=h.run("form.meta['[data-po-material-summary]'].innerHTML");assert.match(summary,/Katun · 8 kg/);assert.match(summary,/Rib · 2 kg/);assert.match(summary,/Total: 10 kg/);assert.doesNotMatch(summary,/pcs|per potong/);
 h.run("form.values.prepareMode='legacy';poPreparedSummaryRecalc(form)");summary=h.run("form.meta['[data-po-material-summary]'].innerHTML");assert.match(summary,/Katun · 3 kg/);assert.match(summary,/Total: 3 kg/);assert.doesNotMatch(summary,/Rib|Rol/);
 h.run("form.values.prepareMode='roll';form.values.includeLegacy=false;form.choices[0].input.value='1.5';poPreparedSummaryRecalc(form)");summary=h.run("form.meta['[data-po-material-summary]'].innerHTML");assert.match(summary,/Katun · 1.5 kg/);assert.match(summary,/Total: 3.5 kg/);assert.equal(h.run('requests.length'),0);
});
test('duplicate, stale, excessive or malformed selected roll quantities block submission before writing',()=>{
 const h=ui();for(const code of ["form.choices=[choice('rollA',6)]","form.choices=[choice('rollA',1),choice('rollA',1)]","form.choices=[choice('missing',1)]","form.choices=[choice('rollA',1.0001)]","form.choices=[]"]){h.run(code);assert.throws(()=>h.run('rollPickerValues(form)'));}
 h.run("form.choices=[choice('rollA',5),choice('rollB',10)];stock[0].tersedia=14");assert.throws(()=>h.run('rollPickerValues(form)'),/stok bahan/);assert.equal(h.run('requests.length'),0);
 h.run("actor.divisi='potong'");assert.throws(()=>h.run('rollPickerValues(form)'),/owner/);
});
test('PO and specific rolls submit in one action with stable IDs and image, duplicate tap sends once',async()=>{
 const h=ui();h.run("form.values.siapkanPotong=false;form._poImage={touched:true,data:'data:image/jpeg;base64,example'}");const done=h.run('A.poSave(button)');h.run('A.poSave(button)');await Promise.resolve();
 assert.equal(h.run('requests.length'),1);assert.equal(h.run('requests[0].action'),'savePOWithRencana');assert.equal(h.run('requests[0].payload.po.newId'),'newpo001');assert.equal(h.run('requests[0].payload.rencana.id'),'newpo001_cut');assert.equal(h.run('requests[0].payload.gambarData'),'data:image/jpeg;base64,example');assert.equal(h.run('form._poPreparedFrozen'),true);
 h.resolve(0,{po:{id:'newpo001'},rencana:{id:'newpo001_cut'},pending:false});await done;assert.equal(h.run('closed'),1);
});
test('uncertain prepared PO freezes exact intent, checks only data then resumes missing PO without changed input',async()=>{
 const h=ui(),done=h.run('A.poSave(button)');await Promise.resolve();const original=h.json('requests[0].payload');h.reject(0);await done;
 h.run("form.values.nama='changed';form.choices[0].input.value='1';A.poSave(button);A.poPreparedRetry(retry)");assert.equal(h.run('requests.length'),1);
 const checking=h.run('A.poPreparedCheck(check)');assert.equal(h.run('requests[1].action'),'getState');h.resolve(1,{me:{id:'owner'},po:[],rencanaPotong:[{id:'newpo001_cut',poId:'newpo001',status:'menyiapkan',alokasiBahan:original.rencana.alokasiBahan}]});await checking;
 assert.equal(h.run('form._poPreparedRetryAllowed'),true);const resumed=h.run('A.poPreparedRetry(retry)');await Promise.resolve();assert.deepEqual(h.json('requests[2].payload'),original);h.resolve(2,{po:{id:'newpo001'},rencana:{id:'newpo001_cut'},pending:false});await resumed;
});
test('completed prepared PO is recognized on read while differing or cancelled plans never replay',async()=>{
 for(const status of ['siap','batal','different']){const h=ui(),saving=h.run('A.poSave(button)');await Promise.resolve();const intent=h.json('requests[0].payload');h.reject(0);await saving;const checking=h.run('A.poPreparedCheck(check)');h.resolve(1,{me:{id:'owner'},po:[{id:'newpo001'}],rencanaPotong:[{id:'newpo001_cut',poId:'newpo001',status:status==='different'?'siap':status,alokasiBahan:status==='different'?[{stokId:'other',qty:1}]:intent.rencana.alokasiBahan}]});await checking;assert.equal(h.run('form._poPreparedRetryAllowed'),false);assert.equal(h.run('closed'),status==='siap'?1:0);}
});
test('image-write failure after PO and plan commit can finish the original design without duplicating either record',async()=>{
 const h=ui();h.run("form._poImage={touched:true,data:'data:image/jpeg;base64,design'}");const saving=h.run('A.poSave(button)');await Promise.resolve();const intent=h.json('requests[0].payload');h.reject(0,'Gambar belum tersimpan');await saving;
 const checking=h.run('A.poPreparedCheck(check)');h.resolve(1,{me:{id:'owner'},po:[{id:'newpo001',gambar:''}],rencanaPotong:[{id:'newpo001_cut',poId:'newpo001',status:'siap',alokasiBahan:intent.rencana.alokasiBahan}]});await checking;assert.equal(h.run('closed'),0);assert.equal(h.run('form._poPreparedRetryAllowed'),true);assert.match(h.run("form.meta['[data-po-prepared-notice]'].innerHTML"),/desain belum terlihat/);
 const retrying=h.run('A.poPreparedRetry(retry)');await Promise.resolve();assert.deepEqual(h.json('requests[2].payload'),intent);h.resolve(2,{po:{id:'newpo001',gambar:'saved-image'},rencana:{id:'newpo001_cut'},pending:false});await retrying;assert.equal(h.run('closed'),1);
});
test('known legacy totals use one prepared action with no synthetic roll selection',async()=>{
 const h=ui();h.run("form.values.prepareMode='legacy';form.values.legacyRol='2';form.legacy=[{values:{legacyBahan:'Katun',legacyQty:'6'}}]");const done=h.run('A.poSave(button)');await Promise.resolve();assert.deepEqual(h.json('requests[0].payload.rencana'),{bahanList:[{nama:'Katun',qty:6,satuan:'kg'}],rol:2,id:'newpo001_cut',catatan:''});assert.equal(h.run('requests[0].payload.rencana.alokasiBahan'),undefined);h.resolve(0,{po:{id:'newpo001'},rencana:{id:'newpo001_cut'},pending:false});await done;
 h.run("form.legacy[0].values.legacyQty='11'");assert.throws(()=>h.run('poLegacyValues(form)'),/saldo lama/);
});
test('one prepared PO combines selected body rolls and deliberate legacy collar quantities without losing either intent',async()=>{
 const h=ui();h.run("form.values.includeLegacy=true;form.values.legacyRol='1';form.legacy=[{values:{legacyBahan:'Katun',legacyQty:'3'}}]");const done=h.run('A.poSave(button)');await Promise.resolve();const plan=h.json('requests[0].payload.rencana');assert.deepEqual(plan.alokasiBahan,[{stokId:'rollA',qty:5},{stokId:'rollC',qty:2}]);assert.deepEqual(plan.legacyBahanList,[{nama:'Katun',qty:3,satuan:'kg'}]);assert.equal(plan.legacyRol,1);assert.equal(plan.bahanList,undefined);
 const raw=JSON.parse(JSON.stringify({...plan,poId:'newpo001'}));assert.equal(h.run(`samePreparedMaterials(${JSON.stringify(raw)},${JSON.stringify(plan)})`),true);raw.legacyBahanList[0].qty=4;assert.equal(h.run(`samePreparedMaterials(${JSON.stringify(raw)},${JSON.stringify(plan)})`),false);h.resolve(0,{po:{id:'newpo001'},rencana:{id:plan.id},pending:false});await done;
});
test('orphan prepared plans are visible on owner PO page and retain legacy or specific-roll mode when resumed',async()=>{
 for(const legacy of [false,true]){const h=ui();h.run(`S.state.rencanaPotong=[{id:'pending',poId:'newpo001',status:'menyiapkan',poDraft:{newId:'newpo001',nama:'PO belum selesai'},bahanList:[{nama:'Katun',qty:3,satuan:'kg'}],rol:1,alokasiBahan:${legacy?'[]':"[{stokId:'rollA',qty:3}]"}}];button.attributes['data-id']='pending';`);assert.match(h.run('poPendingPlansHtml()'),/Persiapan PO belum selesai/);h.run('A.poPendingOpen(button)');assert.match(h.run('rendered'),/Lanjutkan PO/);assert.match(h.run('rendered'),/Batalkan persiapan/);
 const done=h.run('A.poPendingContinue(button)');await Promise.resolve();assert.equal(h.run('requests[0].payload.po.newId'),'newpo001');assert.equal(h.run('requests[0].payload.rencana.id'),'pending');assert.equal(h.run('!!requests[0].payload.rencana.alokasiBahan'),!legacy);h.resolve(0,{po:{id:'newpo001'},rencana:{id:'pending'},pending:false});await done;}
});
test('uncertain orphan cancellation exposes a read-only status check and never blindly sends cancellation again',async()=>{
 const h=ui();h.run("S.state.rencanaPotong=[{id:'pending',poId:'newpo001',status:'menyiapkan',revision:'rev',poDraft:{newId:'newpo001',nama:'Kaos'},bahanList:[],rol:0}];button.attributes['data-id']='pending';check.attributes['data-id']='pending';");const cancel=h.run('A.poPendingCancel(button)');assert.equal(h.run('requests[0].action'),'saveRencanaPotong');h.reject(0);await cancel;
 assert.match(h.run("form.meta['[data-po-prepared-notice]'].innerHTML"),/data-a="poPendingRefresh"/);h.run('A.poPendingCancel(button)');assert.equal(h.run('requests.length'),1);
 const verifying=h.run('A.poPendingRefresh(check)');assert.equal(h.run('requests[1].action'),'getState');h.resolve(1,{me:{id:'owner'},po:[],rencanaPotong:[{id:'pending',status:'batal'}]});await verifying;assert.equal(h.run('closed'),1);assert.match(h.run('messages[messages.length-1]'),/Bahan telah dilepas/);
});
test('worker material detail exposes only plan-selected readonly roll evidence and compact cards limit their rows',()=>{
 const h=ui();h.run("var selected={id:'plan123',bahanList:[{nama:'Katun',qty:12,satuan:'kg'}],rol:3,rincianRol:[{stokId:'a',bahan:'Katun',qty:3,satuan:'kg',invoice:'BON-1',rollLabel:'Rol 1'},{stokId:'b',bahan:'Katun',qty:4,satuan:'kg',invoice:'BON-1',rollLabel:'Rol 2'},{stokId:'c',bahan:'Katun',qty:5,satuan:'kg',invoice:'BON-2',rollLabel:'Rol 3'}]};");const brief=h.run('rencanaBahanHtml(selected)');assert.match(brief,/1 rol lainnya/);assert.doesNotMatch(brief,/BON-2/);const detail=h.run('rencanaBahanHtml(selected,true)');assert.match(detail,/BON-2 · Rol 3 · Katun 5 kg/);assert.doesNotMatch(detail,/<input|harga|Rp/);
 h.run("selected.alokasiBahan=[{stokId:'a',qty:3},{stokId:'b',qty:4}];selected.legacyBahanList=[{nama:'Rib',qty:0.5,satuan:'kg'}];selected.legacyRol=0;selected.rol=2");assert.match(h.run('rencanaBahanHtml(selected)'),/Rol yang diketahui/);assert.match(h.run('rencanaBahanHtml(selected)'),/jumlah rolnya belum diketahui/);assert.doesNotMatch(h.run('rencanaBahanHtml(selected)'),/Jumlah rol seluruh bahan/);
});
test('additional prepared work on an existing active PO supports both selected rolls and legacy quantities',()=>{
 const h=ui();h.run("D.po.existing={id:'existing',status:'aktif'};function poHead(){return '';}function poIdEl(){return {getAttribute:function(k){return k==='data-po'?'existing':'';}};}form.values.id='nextplan';form.values.poId='existing';form.values.revision='';");vm.runInContext(part('A.rencanaPotongOpen =','function saveRencanaPotongUI('),h.c);h.run('A.rencanaPotongOpen(poIdEl())');assert.match(h.run('rendered'),/data-roll-picker/);assert.match(h.run('rendered'),/Saldo lama/);assert.match(h.run('rendered'),/pemotongan berikutnya/);assert.deepEqual(h.json("rencanaPotongValues(form,'siap').rencana.alokasiBahan"),[{stokId:'rollA',qty:5},{stokId:'rollC',qty:2}]);
 h.run("form.values.prepareMode='legacy';form.legacy=[{values:{legacyBahan:'Katun',legacyQty:'3'}}]");assert.deepEqual(h.json("rencanaPotongValues(form,'siap').rencana.bahanList"),[{nama:'Katun',qty:3,satuan:'kg'}]);
});
