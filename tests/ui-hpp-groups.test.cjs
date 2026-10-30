'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('/* HPP dihitung langsung'),html.indexOf('function commerceImportSummary'));
function fixture(){
  const cfg={jahitMode:'manual',hargaJahit:3000,biayaLain:500,targetMargin:30,costSchema:2,costsReviewed:true};
  const models=['Merah','Biru','Tebal'].map((nama,i)=>({id:'model'+i,nama:'Oblong '+nama,series:'Contoh',sizes:['M','XL'],poIds:['po'+i],kain:{complete:true,perPcs:10000,totalCost:100000,totalPcs:10},potong:{complete:true,perPcs:1000},jahit:{complete:true,perPcs:3000},hargaJahit:3000,biayaLain:500,targetMargin:30,config:{value:cfg},configSaved:true,configured:true,hppTotal:14500,basis:{ukuran:'XL',policy:'complete-legacy-v1'},warnings:[]}));
  const group={...models[0],id:'hppg_example',nama:'Oblong reguler',series:'Kelompok HPP',isGroup:true,modelIds:['model0','model1'],poIds:['po0','po1'],memberModels:models.slice(0,2).map(({id,nama,series,sizes,poIds})=>({id,nama,series,sizes,poIds})),referenceModelIds:['model0']};
  return {revision:'rev1',models,groups:[group],config:{marketplace:{},pajak:0,hppGroups:{hppg_example:{id:group.id,nama:group.nama,modelIds:group.modelIds,config:cfg}}}};
}
function harness(data=fixture()){
  const c=vm.createContext({console});
  vm.runInContext(`var A={},C={},R={},VIEWS={},S={token:'one',state:{settings:{}},f:{},sub:{}},actor={id:'owner',divisi:'owner'},entry={data:null,version:1},currentForm=null,lastSheet='',messages=[],requests=[];
    function me(){return actor;}function isAdmin(){return ['owner','admin'].includes(actor.divisi);}function commerceScope(){return S.token&&isAdmin()?S.token+':'+actor.divisi:'';}function commerceEntry(){return entry;}function commerceData(){return entry.data||{};}
    function nf(v){return String(v||0);}function nfQty(v){return nf(v);}function rp(v){return 'Rp'+v;}function tgl(v){return v;}function satuanPendek(v){return v;}function inisial(v){return String(v).slice(0,1);}function ic(){return '';}function newId(){return 'stable';}
    function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}function cocok(q,a){return !q||a.join(' ').toLowerCase().includes(q.toLowerCase());}
    function hid(k,v){return '<input name="'+k+'" value="'+esc(v)+'">';}function fText(l,k,v,attrs){return '<label>'+esc(l)+'<input name="'+k+'" value="'+esc(v)+'" '+(attrs||'')+'></label>';}function fNum(l,k,v,a){return fText(l,k,v,a);}function fSelect(l,k,opts,v){return fText(l,k,v);}
    function topForm(){return currentForm;}function formVals(f){return f.values||{};}function toast(v,b){messages.push({text:v,bad:b});}function sheetHtml(t,b,f){return '<h2>'+esc(t)+'</h2>'+b+(f||'');}function openSheet(fn){lastSheet=fn();}
    function commerceForm(t,m,b,a,l){lastSheet=sheetHtml(t,b,l);currentForm={values:{},rows:[],note:{hidden:true},_commerceScope:commerceScope(),action:a,label:l};return currentForm;}
    function $(s,f){if(!f)return null;if(s==='[data-hpp-member]')return f.input;if(s==='[data-hpp-member-count]')return f.count;if(s==='[data-hpp-member-empty]')return f.empty;return null;}
    function $$(s,f){if(s==='[data-hpp-member-row]')return f.rows||[];if(s==='[data-hpp-member]')return (f.rows||[]).map(function(r){return r.input;});return [];}
    function commerceNumber(v,l,int,max){var n=Number(v);if(v==null||String(v).trim()===''||!Number.isFinite(n)||n<0||int&&!Number.isSafeInteger(n)||n>(max===undefined?1e12:max))throw Error(l+' belum valid');return n;}
    function commerceRevision(v){return v.revision||undefined;}function commerceMutation(module,action,payload,f){requests.push({module:module,action:action,payload:payload});return Promise.resolve();}
    function commerceLoadView(m,t,sub,draw){return draw(commerceData());}function commerceEmptyActions(){return '';}function searchBox(){return '';}function commerceList(m,rows,draw,parts){return rows.filter(function(r){return cocok(S.f.q,parts(r));}).map(draw).join('');}
  `+source,c);
  c.entry.data=JSON.parse(JSON.stringify(data));
  return {c,run:code=>vm.runInContext(code,c),json:code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',c)),select(ids){c.currentForm.rows=c.currentForm._commerceHppChoices.map(m=>({input:{value:m.id,checked:ids.includes(m.id)},hidden:false}));c.currentForm.count={textContent:''};c.currentForm.empty={hidden:true};}};
}
const trigger=id=>`{getAttribute:function(){return ${JSON.stringify(id)};}}`;

test('HPP list collapses only selected models and search finds a group through its member',()=>{
  const h=harness(),before=JSON.stringify(h.c.entry.data);
  assert.deepEqual(h.json('commerceHppDisplayModels(entry.data).map(function(m){return m.id;})'),['hppg_example','model2']);
  h.run("S.f.q='Biru'");const out=h.run('VIEWS.hpp()');
  assert.match(out,/data-id="hppg_example"/);assert.match(out,/Oblong reguler/);assert.doesNotMatch(out,/data-id="model[012]"/);
  assert.equal(JSON.stringify(h.c.entry.data),before);
});

test('group archive visibility follows each original model, not pooled cutting totals',()=>{
  const h=harness();h.run("S.state.settings={poBuang:['po0'],poSembunyi:['po1']};entry.data.models[1].kain.totalPcs=0;");
  assert.deepEqual(h.json('commerceHppTampil(commerceHppDisplayModels(entry.data)).map(function(m){return m.id;})'),['model2']);
  h.run('entry.data.models[1].kain.totalPcs=1;');
  assert.deepEqual(h.json('commerceHppTampil(commerceHppDisplayModels(entry.data)).map(function(m){return m.id;})'),['hppg_example','model2']);
  h.run("S.sub.hppSemua='1'");assert.match(h.run('VIEWS.hpp()'),/hppg_example/);
});

test('member opens shared HPP with member evidence and saves only the group identifier',()=>{
  const h=harness();h.run('A.commerceHppOpen('+trigger('model1')+');');
  assert.equal(h.c.currentForm._commerceModel.id,'hppg_example');assert.equal(h.c.currentForm.label,'Simpan biaya bersama');
  assert.match(h.c.lastSheet,/name="modelId" value="hppg_example"/);assert.match(h.c.lastSheet,/Acuan XL/);assert.match(h.c.lastSheet,/Mengikuti acuan kelompok/);
  h.c.currentForm.values={modelId:'model1',revision:'rev1',reviewed:true,jahitMode:'manual',hargaJahit:'3000',biayaLain:'700',targetMargin:'30',ketLain:''};
  h.run('A.commerceHppSave(null)');assert.equal(h.c.requests[0].action,'saveCommerceHpp');assert.equal(h.c.requests[0].payload.modelId,'hppg_example');assert.equal(h.c.requests[0].payload.config.biayaLain,700);
  assert.equal(h.c.entry.data.models[1].biayaLain,500);
});

test('new groups require owner, a fresh snapshot and group capability from the server',()=>{
  for(const update of ["actor.divisi='admin'","entry.stale=true","entry.loading={}","entry.error='offline'","entry.lama=true","entry.version=null","delete entry.data.groups"]){
    const h=harness();h.run(update+';A.commerceHppGroupOpen(null);');assert.equal(h.c.currentForm,null,update);assert.ok(h.c.messages.length,update);assert.equal(h.c.requests.length,0);
  }
});

test('membership picker excludes other groups, allows old existing members and preserves checked items during search',()=>{
  const h=harness();h.run("S.state.settings={poBuang:['po1']};A.commerceHppGroupOpen("+trigger('hppg_example')+");");
  assert.match(h.c.lastSheet,/Riwayat PO/);h.select(['model0','model1']);h.c.currentForm.values={nama:'Oblong reguler',groupQuery:'Merah'};h.run('R.commerce(currentForm)');
  assert.equal(h.c.currentForm.count.textContent,'2 model dipilih');assert.equal(h.c.currentForm.rows.filter(r=>!r.hidden).length,1);assert.equal(h.c.currentForm.rows[1].input.checked,true);
  h.run('A.commerceHppGroupOpen(null)');assert.deepEqual(h.json('currentForm._commerceHppChoices.map(function(m){return m.id;})'),['model2']);assert.match(h.c.lastSheet,/2 model sudah mengikuti kelompok lain/);
});

test('membership save sends the chosen models once with stable ID and expected revision',()=>{
  const data=fixture();data.groups=[];data.config.hppGroups={};const h=harness(data),before=JSON.stringify(h.c.entry.data);
  h.run('A.commerceHppGroupOpen(null)');h.select(['model0','model1']);h.c.currentForm.values={nama:'  Oblong reguler  '};h.run('A.commerceHppGroupSave(null)');
  const sent=h.json('requests');sent[0].payload.modelIds.sort();assert.deepEqual(sent,[{module:'hpp',action:'saveCommerceHppGroup',payload:{id:'hppg_stable',nama:'Oblong reguler',modelIds:['model0','model1'],expectedRevision:'rev1'}}]);
  assert.equal(JSON.stringify(h.c.entry.data),before);
});

test('membership refuses fewer than two, forged choices and changed sessions or source snapshots',()=>{
  for(const change of ['currentForm.rows[1].input.checked=false',"currentForm.rows[1].input.value='unknown'","S.token='different'","entry.data=JSON.parse(JSON.stringify(entry.data))","entry.version=2","entry.data.revision='newer'","entry.stale=true"]){
    const h=harness();h.run('A.commerceHppGroupOpen('+trigger('hppg_example')+');');h.select(['model0','model1']);h.c.currentForm.values={nama:'Oblong reguler'};h.run(change+';A.commerceHppGroupSave(null)');assert.equal(h.c.requests.length,0,change);assert.ok(h.c.messages.length,change);
  }
});

test('group removal is explicit and only removes the group with its captured revision',()=>{
  const h=harness(),before=JSON.stringify(h.c.entry.data);h.run('A.commerceHppGroupRemove('+trigger('hppg_example')+');');
  assert.equal(h.c.requests.length,0);assert.match(h.c.lastSheet,/memakai pengaturan biayanya masing-masing/);assert.match(h.c.lastSheet,/PO, stok, dan riwayat produksi tetap tersimpan/);
  h.run('A.commerceHppGroupRemoveSave(null)');assert.deepEqual(h.json('requests[0].payload'),{id:'hppg_example',remove:true,expectedRevision:'rev1'});assert.equal(JSON.stringify(h.c.entry.data),before);
});

test('uncertain membership save recognizes confirmed state, permits same-revision retry and refuses conflicting updates',()=>{
  const h=harness();h.c.payload={id:'hppg_example',nama:'Oblong reguler',modelIds:['model1','model0'],expectedRevision:'rev0'};
  assert.equal(h.run('commerceHppGroupCheck(payload,entry.data).complete'),true);
  h.c.payload.nama='Different';assert.equal(h.run('commerceHppGroupCheck(payload,entry.data).retry'),false);
  h.c.payload.expectedRevision='rev1';assert.equal(h.run('commerceHppGroupCheck(payload,entry.data).retry'),true);
  h.c.payload.remove=true;assert.equal(h.run('commerceHppGroupCheck(payload,entry.data).complete'),false);
  h.run('delete entry.data.config.hppGroups.hppg_example');assert.equal(h.run('commerceHppGroupCheck(payload,entry.data).complete'),true);
});

test('admins can read shared costs but cannot open membership actions or save shared costs',()=>{
  const h=harness();h.run("actor.divisi='admin';A.commerceHppOpen("+trigger('model0')+");");assert.equal(h.c.currentForm,null);assert.match(h.c.lastSheet,/Owner dapat mengubah anggota/);assert.doesNotMatch(h.c.lastSheet,/data-a="commerceHppGroupOpen"|data-a="commerceHppGroupRemove"/);
  h.run('A.commerceHppGroupRemove('+trigger('hppg_example')+');');assert.equal(h.c.currentForm,null);assert.equal(h.c.requests.length,0);
});

test('group labels and member names are escaped in list, membership picker and shared detail',()=>{
  const data=fixture();data.groups[0].nama='<img src=x onerror=bad>';data.models[0].nama='<script>bad</script>';data.groups[0].memberModels[0].nama='<script>bad</script>';
  const h=harness(data);let output=h.run('VIEWS.hpp()');assert.match(output,/&lt;img/);assert.doesNotMatch(output,/<img src=x/);
  h.run('A.commerceHppGroupOpen('+trigger('hppg_example')+');');assert.match(h.c.lastSheet,/&lt;script&gt;bad/);assert.doesNotMatch(h.c.lastSheet,/<script>/);
  h.run('A.commerceHppOpen('+trigger('hppg_example')+');');assert.match(h.c.lastSheet,/&lt;img/);assert.match(h.c.lastSheet,/&lt;script&gt;bad/);
});

test('shared HPP recommendations wait for all production evidence warnings to be resolved',()=>{
  const h=harness();h.run('A.commerceHppOpen('+trigger('hppg_example')+');');
  h.c.currentForm.values={jahitMode:'manual',hargaJahit:'3000',biayaLain:'500',targetMargin:'30',ketLain:''};
  assert.equal(h.run('commerceHppDraft(currentForm).recommendationReady'),true);
  h.c.currentForm._commerceModel.sourceWarnings=['Acuan XL harus diperiksa'];
  assert.equal(h.run('commerceHppDraft(currentForm).recommendationReady'),false);
});

test('an untouched new group can edit membership before saving shared costs',()=>{
  const h=harness();h.run('entry.data.groups[0].configSaved=false;A.commerceHppOpen('+trigger('hppg_example')+');');
  h.c.currentForm.values={jahitMode:'manual',hargaJahit:'3000',biayaLain:'500',targetMargin:'30',ketLain:''};
  assert.equal(h.run('commerceHppDraft(currentForm).dirty'),true);
  assert.equal(h.run('commerceHppDraft(currentForm).changed'),false);
  h.run("A.commerceHppGroupOpen({getAttribute:function(){return 'hppg_example';},closest:function(){return currentForm;}})");
  assert.equal(h.c.currentForm.action,'commerceHppGroupSave');
});

test('uncertain shared-cost saves recognize saved values and stop on conflicting updates',async()=>{
  const h=harness();h.c.payload={modelId:'hppg_example',expectedRevision:'rev0',config:{...fixture().config.hppGroups.hppg_example.config,ketLain:''}};
  assert.equal(h.run('commerceHppCostCheck(payload,entry.data).complete'),true);
  h.c.payload.config.hargaJahit=9999;assert.equal(h.run('commerceHppCostCheck(payload,entry.data).retry'),false);
  h.c.payload.expectedRevision='rev1';assert.equal(h.run('commerceHppCostCheck(payload,entry.data).retry'),true);
  h.c.payload.config.hargaJahit=3000;
  h.run("var dropped=0;function act(el,p){return p;}function commerceFetch(){return Promise.resolve();}function dropForm(){dropped++;}function commerceFormNotice(f,msg,retry){messages.push({text:msg,retry:retry});}function quiet(e){throw e;}");
  vm.runInContext(html.slice(html.indexOf('A.commerceCheck = function'),html.indexOf('A.commerceRetry = function')),h.c);
  h.run("currentForm={_commerceScope:commerceScope(),_commerceIntent:{module:'hpp',action:'saveCommerceHpp',payload:payload}};");
  await h.run('A.commerceCheck({closest:function(){return currentForm;}})');
  assert.equal(h.c.dropped,1);assert.equal(h.c.requests.length,0);
});

test('real request path decorates group writes and refuses an old production workflow',async()=>{
  const requestSource=html.slice(html.indexOf('function req(action, payload)'),html.indexOf('function signOutLocal()'));
  const c=vm.createContext({console});vm.runInContext("var calls=[],S={token:'owner-session',state:{workflowVersion:2},busy:0},Api={mode:function(){return 'remote';},call:function(a,p){calls.push({action:a,payload:p});return Promise.resolve({ok:true});}};function paintSync(){}function refresh(){}function applyState(){}"+requestSource,c);
  await vm.runInContext("req('saveCommerceHppGroup',{id:'hppg_safe',nama:'Oblong',modelIds:['model0','model1'],expectedRevision:'rev1'})",c);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(calls[0])',c)),{action:'saveCommerceHppGroup',payload:{id:'hppg_safe',nama:'Oblong',modelIds:['model0','model1'],expectedRevision:'rev1',token:'owner-session',workflowVersion:2}});
  vm.runInContext('S.state.workflowVersion=1',c);
  await assert.rejects(vm.runInContext("req('saveCommerceHppGroup',{id:'hppg_safe'})",c),/Pembaruan alur produksi/);assert.equal(c.calls.length,1);
});
