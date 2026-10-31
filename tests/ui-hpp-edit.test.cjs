'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
const block=html.slice(html.indexOf('/* COMMERCE UI START'),html.indexOf('/* COMMERCE UI END */'));
assert.ok(block.length>10000,'native commerce implementation exists');
function harness(){
  const requests=[],context=vm.createContext({console,setTimeout,clearTimeout,request(action,payload){return new Promise((resolve,reject)=>requests.push({action,payload,resolve,reject}));}});
  vm.runInContext(`var A={},C={},R={},VIEWS={},S={token:'session-one',state:{me:{id:'owner',divisi:'owner'},settings:{}},f:{},sub:{},tab:'beranda',img:{}},Api={mode:function(){return 'gas';},div:function(){return '';}},kv={},idbWrites=[],Idb={get:function(s,k,fn){fn(kv[k]);},put:function(s,k,v){kv[k]=v;idbWrites.push(k);},del:function(s,k){delete kv[k];}},UI_VERSION='ui-test',IMG_TOKO='cm.',messages=[],renders=0,drops=0,prints=[],pdfs=[],nextId=0,lastSheet='';
  function me(){return S.state.me;}function isAdmin(){return !!S.state&&['owner','admin'].includes(me().divisi);}function req(a,p){return request(a,p);}function refresh(){renders++;}function render(){renders++;}function toast(t,b){messages.push({text:t,bad:!!b});}function quiet(){}function nf(x){return String(Number(x)||0);}function nfQty(x){return nf(x);}function rp(x){return 'Rp'+String(Number(x)||0);}function tgl(x){return String(x||'');}function todayYmd(){return '2026-10-08';}function newId(){return 'new_'+(++nextId);}function ic(){return '';}function inisial(n){return String(n||'?').charAt(0).toUpperCase();}function hydrateImages(){}function commerceSnapKey(m){return 'pks_cm_'+m+'_pusat';}
  function esc(x){return String(x==null?'':x).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function act(el,p){return Promise.resolve(p).catch(function(e){toast(e.message,true);throw e;});}function emptyBox(x){return '<p>'+esc(x)+'</p>';}function seg(){return '';}function searchBox(){return '';}function cocok(q,a){return !q||a.join(' ').toLowerCase().includes(q.toLowerCase());}function paintList(){}function hid(k,v){return '<input name="'+k+'" value="'+esc(v)+'">';}function fCatatan(x){return '<textarea name="catatan">'+esc(x)+'</textarea>';}function footSave(x){return x;}function sheetHtml(t,b,f){return '<h2>'+esc(t)+'</h2>'+b+(f||'');}
  var currentForm={values:{},rows:[],note:{hidden:true,innerHTML:''},fields:[],sheet:{buttons:[]},getAttribute:function(k){return k==='data-module'?this.module:null;},closest:function(){return this.sheet;}};
  function topForm(){return currentForm;}function formVals(f){return f.values||{};}function $(s,f){if(s==='[data-commerce-note]')return f.note;if(s==='[data-commerce-total]')return f.totalNode||null;if(s==='[data-commerce-import-proof]')return f.proof;if(s==='[data-a="commerceImportApply"]')return f.apply;return null;}function $$(s,f){if(s==='[data-commerce-line]')return f.rows||[];if(s==='.sheet-f button')return f.buttons||[];return f.fields||[];}
  function openSheet(fn){lastSheet=fn();}function dropForm(){drops++;}function slipCetak(models){prints.push(models);return Promise.resolve();}function slipUnduh(action,payload){pdfs.push({action:action,payload:payload});return Promise.resolve();}function coreCommerceSlipModel(m,r){return {reference:r.id,module:m,rows:r.items};}
  var window={scrollTo:function(){}};
  `,context);
  const helperStart=html.indexOf('function fTanggal('),helperEnd=html.indexOf('/* ---------- hitungan PO',helperStart);vm.runInContext(html.slice(helperStart,helperEnd),context);vm.runInContext(block,context);
  const run=code=>vm.runInContext(code,context);const json=code=>JSON.parse(run('JSON.stringify('+code+')'));
  function seed(module,data){run(`var e=commerceEntry(${JSON.stringify(module)});e.data=${JSON.stringify(data)};e.version=10;e.tried=true;`);}
  function form(values,module,rows=[]){run(`currentForm.values=${JSON.stringify(values)};currentForm.module=${JSON.stringify(module)};currentForm._commerceScope=commerceScope();currentForm.rows=${JSON.stringify(rows)}.map(function(r){return {values:r.values,getAttribute:function(){return r.id;}};});`);}
  return {context,requests,run,json,seed,form};
}
function reply(module,data,version=10){return {module,actor:{id:'owner',divisi:'owner'},version,...data};}
const turn=()=>new Promise(r=>setImmediate(r));



// HPP edit regression: exercise the real form dispatcher and the same save path.
function hppEditFixture(){
  const h=harness();
  const model={id:'hpp-edit',nama:'Fixture',series:'S',sizes:['M'],poIds:['p'],configured:true,hppTotal:89530,hargaJahit:8000,biayaLain:50000,targetMargin:30,
    kain:{complete:true,perPcs:30000},potong:{complete:true,perPcs:1530},jahit:{complete:true,perPcs:9500},
    config:{value:{jahitMode:'manual',hargaJahit:8000,biayaLain:50000,targetMargin:30,ketLain:'Packing'}},warnings:[]};
  h.seed('hpp',{models:[model],config:{marketplace:{},pajak:0},revision:'hpp-edit-before'});
  h.form({modelId:model.id,revision:'hpp-edit-before',reviewed:true,jahitMode:'manual',hargaJahit:'8000',biayaLain:'50000',targetMargin:'30',ketLain:'Packing'},'hpp');
  h.run("currentForm._commerceModel=commerceHppModel('hpp-edit');currentForm.hppCost={innerHTML:'',textContent:''};currentForm.hppPreview={innerHTML:'',textContent:''};currentForm.hppSim={disabled:false};var hppEditSelect=$;$=function(s,f){if(s==='[data-commerce-hpp-cost]')return f.hppCost;if(s==='[data-commerce-hpp-live]')return f.hppPreview;if(s==='[data-a=\"commerceHppSim\"]')return f.hppSim;return hppEditSelect(s,f);};currentForm.getAttribute=function(k){return k==='data-form'?'commerce':k==='data-module'?'hpp':null;};");
  const begin=html.indexOf('function recalc(form) {'),end=html.indexOf('/* kisi isian per ukuran',begin);
  assert.ok(begin>=0&&end>begin);
  vm.runInContext(html.slice(begin,end),h.context);
  return h;
}
test('HPP typing 50000 to 5000 immediately previews 44530 without changing saved 89530 or making a request',()=>{
  const h=hppEditFixture();
  h.run("recalc(currentForm);currentForm.values.biayaLain='5000';recalc(currentForm);");
  assert.match(h.run('currentForm.hppPreview.innerHTML'),/44530/);
  assert.match(h.run('currentForm.hppPreview.innerHTML'),/belum disimpan/);
  assert.match(h.run('currentForm.hppCost.innerHTML'),/Rp5000/);
  assert.equal(h.run("commerceHppModel('hpp-edit').hppTotal"),89530);
  assert.equal(h.run("commerceHppModel('hpp-edit').biayaLain"),50000);
  assert.equal(h.run('currentForm.hppSim.disabled'),true);
  assert.equal(h.requests.length,0);
});
test('invalid HPP draft clears the numeric preview and cannot save while explicit zero remains valid',()=>{
  for(const value of ['', '-1', 'not a number']){
    const h=hppEditFixture();h.run("currentForm.values.biayaLain='5000';recalc(currentForm);");
    h.run('currentForm.values.biayaLain='+JSON.stringify(value)+';recalc(currentForm);A.commerceHppSave(null);');
    assert.match(h.run('currentForm.hppPreview.textContent'),/belum valid/);
    assert.ok(!h.run('currentForm.hppPreview.textContent').includes('44530'));
    assert.equal(h.requests.length,0);
    assert.equal(h.run('currentForm.hppSim.disabled'),true);
  }
  const h=hppEditFixture();h.run("currentForm.values.biayaLain='0';recalc(currentForm);");
  assert.match(h.run('currentForm.hppPreview.innerHTML'),/39530/);
});
test('HPP auto sewing uses its current recorded rate and manual zero is not replaced with the old rate',()=>{
  const h=hppEditFixture();
  h.run("currentForm.values.biayaLain='5000';currentForm.values.jahitMode='auto';recalc(currentForm);");
  assert.match(h.run('currentForm.hppPreview.innerHTML'),/46030/);
  assert.match(h.run('currentForm.hppCost.innerHTML'),/Rp9500/);
  h.run("currentForm.values.jahitMode='manual';currentForm.values.hargaJahit='0';recalc(currentForm);");
  assert.match(h.run('currentForm.hppPreview.innerHTML'),/36530/);
  assert.equal(h.run("commerceHppModel('hpp-edit').hargaJahit"),8000);
});
test('HPP simulator refuses unsaved or uncertain edits and still opens for unchanged saved costs',()=>{
  const h=hppEditFixture(),button="{closest:function(){return currentForm;},getAttribute:function(){return 'hpp-edit';}}";
  h.run("currentForm.values.biayaLain='5000';A.commerceHppSim("+button+");");
  assert.equal(h.run('lastSheet'),'');
  assert.match(h.json('messages').at(-1).text,/Simpan perubahan/);
  h.run("currentForm.values.biayaLain='50000';currentForm._commerceLocked=true;A.commerceHppSim("+button+");");
  assert.equal(h.run('lastSheet'),'');
  assert.match(h.json('messages').at(-1).text,/Tunggu konfirmasi/);
  h.run("currentForm._commerceLocked=false;A.commerceHppSim("+button+");");
  assert.match(h.run('lastSheet'),/Simulasi harga jual/);
  assert.match(h.run('lastSheet'),/89530/);
});
test('HPP corrected draft saves its exact values and revision, then installs only the confirmed fresh summary',async()=>{
  const h=hppEditFixture();
  h.run("currentForm.values.biayaLain='5000';recalc(currentForm);");
  const saved=h.run('A.commerceHppSave(null)');
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].action,'saveCommerceHpp');
  assert.equal(h.requests[0].payload.config.biayaLain,5000);
  assert.equal(h.requests[0].payload.config.hargaJahit,8000);
  assert.equal(h.requests[0].payload.expectedRevision,'hpp-edit-before');
  assert.equal(h.run("commerceHppModel('hpp-edit').hppTotal"),89530);
  h.requests[0].resolve({revision:'hpp-edit-after'});await turn();
  assert.equal(h.requests.length,2);
  assert.equal(h.requests[1].action,'getCommerceState');
  const updated=h.json("commerceHppModel('hpp-edit')");updated.biayaLain=5000;updated.hppTotal=44530;updated.config.value.biayaLain=5000;
  h.requests[1].resolve(reply('hpp',{models:[updated],config:{marketplace:{},pajak:0},revision:'hpp-edit-after'},11));await saved;
  assert.equal(h.run("commerceHppModel('hpp-edit').hppTotal"),44530);
  assert.equal(h.run("commerceHppModel('hpp-edit').biayaLain"),5000);
  assert.equal(h.run('drops'),1);
});

test('a saved provisional model stays saved, checked, and clean while simulation waits for XL evidence',()=>{
  const h=hppEditFixture();h.run("var m=commerceHppModel('hpp-edit');m.configured=false;m.configSaved=true;m.basis={policy:'complete-legacy-v1'};m.warnings=['Acuan XL belum lengkap'];recalc(currentForm);");
  assert.equal(h.run('commerceHppDraft(currentForm).dirty'),false);
  assert.match(h.run('currentForm.hppPreview.innerHTML'),/Sesuai biaya yang sudah tersimpan/);
  assert.doesNotMatch(h.run('currentForm.hppPreview.innerHTML'),/perubahan belum disimpan/);
  assert.match(h.run('currentForm.hppPreview.innerHTML'),/Rekomendasi harga menunggu acuan XL/);
  assert.equal(h.run('currentForm.hppSim.disabled'),true);
  assert.match(h.run('VIEWS.hpp()'),/Pengaturan tersimpan/);
  assert.doesNotMatch(h.run('VIEWS.hpp()'),/>Periksa biaya</);
  h.run("A.commerceHppOpen({getAttribute:function(){return 'hpp-edit';}});");
  assert.match(h.run('lastSheet'),/name="reviewed" checked>/);
  assert.match(h.run('lastSheet'),/sudah pernah disimpan/);
  h.run("A.commerceHppSim({getAttribute:function(){return 'hpp-edit';}});");
  assert.match(h.json('messages').at(-1).text,/Lengkapi/);
});

test('valid manual and other costs can be saved before cloth and cutting evidence are complete',()=>{
  const h=hppEditFixture();h.run("var m=commerceHppModel('hpp-edit');m.configured=false;m.configSaved=true;m.kain={complete:false,perPcs:null};m.potong={complete:false,perPcs:null};m.hppTotal=null;currentForm.values.biayaLain='5000';recalc(currentForm);A.commerceHppSave(null);");
  assert.match(h.run('currentForm.hppPreview.innerHTML'),/HPP belum lengkap/);
  assert.match(h.run('currentForm.hppPreview.innerHTML'),/Pengaturan biaya tetap dapat disimpan/);
  assert.doesNotMatch(h.run('currentForm.hppPreview.innerHTML'),/HPP Rp0/);
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].action,'saveCommerceHpp');
  assert.equal(h.requests[0].payload.config.hargaJahit,8000);assert.equal(h.requests[0].payload.config.biayaLain,5000);
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].payload.config.hargaJual)),{});
  assert.equal(h.requests[0].payload.expectedRevision,'hpp-edit-before');
});

test('unknown automatic sewing cost can retain settings but never becomes an HPP zero or quote',()=>{
  const h=hppEditFixture();h.run("var m=commerceHppModel('hpp-edit');m.configured=false;m.configSaved=true;m.jahit={complete:false,perPcs:null};m.hargaJahit=null;m.config.value.jahitMode='auto';currentForm.values.jahitMode='auto';recalc(currentForm);A.commerceHppSave(null);");
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].payload.config.jahitMode,'auto');assert.equal(h.requests[0].payload.config.hargaJahit,0,'unused manual value is numeric; automatic price stays unknown');
  assert.equal(h.run('commerceHppDraft(currentForm).rate'),null);assert.equal(h.run('commerceHppDraft(currentForm).model.hppTotal'),null);
  assert.match(h.run('currentForm.hppCost.innerHTML'),/Jahit \/ pcs<\/span><span class="v money">Belum lengkap/);
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].payload.config.hargaJual)),{});
});

test('an invalid marketplace quote does not block saving model costs and only valid prices are saved',()=>{
  const h=hppEditFixture();vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/commerce-hpp.js'),'utf8'),h.context);
  h.run("commerceData('hpp').config={marketplace:{valid:{nama:'Toko sehat',fee:10,fixedPerPcs:100},bad:{nama:'Toko <biaya tinggi>',fee:80,fixedPerPcs:0}},pajak:1};currentForm.values.biayaLain='5000';recalc(currentForm);A.commerceHppSave(null);");
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].action,'saveCommerceHpp');
  assert.ok(h.requests[0].payload.config.hargaJual.valid>44530);assert.equal(h.requests[0].payload.config.hargaJual.bad,undefined);
  assert.match(h.run('currentForm.hppPreview.innerHTML'),/Rekomendasi berikut belum tersedia/);
  assert.match(h.run('currentForm.hppPreview.innerHTML'),/Toko &lt;biaya tinggi&gt;/);
  assert.equal(h.requests[0].payload.config.biayaLain,5000);
});

test('checking the review is an explicit step with an inline prompt and focus when it is missing',()=>{
  const h=hppEditFixture();h.run("var hppReviewSelect=$;currentForm.hppReview={hidden:true};currentForm.reviewField={focused:0,focus:function(){this.focused++;}};$=function(s,f){if(s==='[data-commerce-hpp-review]')return f.hppReview;if(s==='[name=\"reviewed\"]')return f.reviewField;return hppReviewSelect(s,f);};currentForm.values.reviewed=false;A.commerceHppSave(null);");
  assert.equal(h.requests.length,0);assert.equal(h.run('currentForm.hppReview.hidden'),false);assert.equal(h.run('currentForm.reviewField.focused'),1);
  assert.match(h.json('messages').at(-1).text,/Centang pemeriksaan biaya/);
  h.run('currentForm.values.reviewed=true;recalc(currentForm);');assert.equal(h.run('currentForm.hppReview.hidden'),true);
});


test('automatic sewing shows rounded read-only evidence and never presents its raw mean as an editable field',()=>{
  const h=hppEditFixture();h.run("rp=function(x){return 'Rp '+Math.round(x).toLocaleString('id-ID');};var m=commerceHppModel('hpp-edit');m.jahit={complete:true,perPcs:23000/7,totalCost:23000,totalPcs:7,source:'Tarif <maklon> tercatat'};m.hargaJahit=23000/7;m.config.value.jahitMode='auto';m.config.value.hargaJahit=23000/7;A.commerceHppOpen({getAttribute:function(){return 'hpp-edit';}});");
  const form=h.run('lastSheet');
  assert.match(form,/<div data-commerce-hpp-jahit-manual hidden>/);
  assert.match(form,/name="hargaJahit" value="3285.71"/,'only a concise starting value is offered when switching to manual');
  assert.ok(form.includes('<div class="field" data-commerce-hpp-jahit-auto><span>Ongkos jahit otomatis / pcs</span><b class="money">Rp 3.286</b>'));
  assert.match(form,/Tarif &lt;maklon&gt; tercatat/);
  assert.match(form,/Rp 23.000 ÷ 7 pcs/);
  assert.match(form,/dirata-ratakan sesuai jumlah pcs tercatat/);
  assert.doesNotMatch(form,/3285.714285/);
  assert.equal(h.run("commerceHppModel('hpp-edit').jahit.perPcs"),23000/7);
  assert.equal(h.requests.length,0);
});

test('manual sewing draft survives auto and manual switches while auto keeps the exact recorded mean',()=>{
  const h=hppEditFixture();h.run("var m=commerceHppModel('hpp-edit');m.jahit.perPcs=23000/7;currentForm.manualSewing={hidden:false};currentForm.autoSewing={hidden:true};var sewingSelect=$;$=function(s,f){if(s==='[data-commerce-hpp-jahit-manual]')return f.manualSewing;if(s==='[data-commerce-hpp-jahit-auto]')return f.autoSewing;return sewingSelect(s,f);};currentForm.values.hargaJahit='3456.78';recalc(currentForm);");
  assert.equal(h.run('currentForm.manualSewing.hidden'),false);
  assert.equal(h.run('commerceHppDraft(currentForm).rate'),3456.78);
  h.run("currentForm.values.jahitMode='auto';recalc(currentForm);");
  assert.equal(h.run('currentForm.manualSewing.hidden'),true);
  assert.equal(h.run('currentForm.autoSewing.hidden'),false);
  assert.equal(h.run('commerceHppDraft(currentForm).rate'),23000/7);
  assert.equal(h.run('currentForm.values.hargaJahit'),'3456.78');
  h.run("currentForm.values.jahitMode='manual';recalc(currentForm);");
  assert.equal(h.run('currentForm.manualSewing.hidden'),false);
  assert.equal(h.run('currentForm.autoSewing.hidden'),true);
  assert.equal(h.run('commerceHppDraft(currentForm).rate'),3456.78);
  h.run("currentForm.values.hargaJahit='0';currentForm.values.jahitMode='auto';recalc(currentForm);currentForm.values.jahitMode='manual';recalc(currentForm);");
  assert.equal(h.run('commerceHppDraft(currentForm).rate'),0);
  assert.equal(h.requests.length,0);
});

test('incomplete automatic sewing remains unknown and does not reuse a stale stored rate as a manual suggestion',()=>{
  const h=hppEditFixture();h.run("var m=commerceHppModel('hpp-edit');m.jahit={complete:false,perPcs:0,totalCost:0,totalPcs:7,source:'Belum ada tarif jahit'};m.hargaJahit=null;m.config.value={jahitMode:'auto',hargaJahit:9999};A.commerceHppOpen({getAttribute:function(){return 'hpp-edit';}});");
  const form=h.run('lastSheet');
  assert.ok(form.includes('data-commerce-hpp-jahit-auto><span>Ongkos jahit otomatis / pcs</span><b class="money">Belum lengkap'));
  assert.match(form,/name="hargaJahit" value=""/);
  assert.doesNotMatch(form,/dirata-ratakan sesuai jumlah pcs tercatat/);
  assert.doesNotMatch(form,/value="9999"/);
});

test('saving automatic sewing uses the exact evidence despite its rounded manual starting value',()=>{
  const h=hppEditFixture();h.run("currentForm._commerceModel.jahit.perPcs=23000/7;currentForm.values.jahitMode='auto';currentForm.values.hargaJahit='3285.71';A.commerceHppSave(null);");
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].action,'saveCommerceHpp');
  assert.equal(h.requests[0].payload.config.jahitMode,'auto');
  assert.equal(h.requests[0].payload.config.hargaJahit,23000/7);
  assert.equal(h.run("commerceHppModel('hpp-edit').config.value.hargaJahit"),8000,'stored and production data are not changed while the request is pending');
});
