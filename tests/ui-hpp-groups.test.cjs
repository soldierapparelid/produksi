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
  vm.runInContext(`var A={},C={},R={},VIEWS={},S={token:'one',state:{settings:{}},f:{},sub:{},tab:'hpp'},actor={id:'owner',divisi:'owner'},entry={data:null,version:1},currentForm=null,lastSheet='',messages=[],requests=[],formOpens=0;
    function me(){return actor;}function isAdmin(){return ['owner','admin'].includes(actor.divisi);}function commerceScope(){return S.token&&isAdmin()?S.token+':'+actor.divisi:'';}function commerceEntry(){return entry;}function commerceData(){return entry.data||{};}
    function nf(v){return String(v||0);}function nfQty(v){return nf(v);}function rp(v){return 'Rp'+v;}function tgl(v){return v;}function satuanPendek(v){return v;}function inisial(v){return String(v).slice(0,1);}function ic(){return '';}function newId(){return 'stable';}
    function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}function cocok(q,a){return !q||a.join(' ').toLowerCase().includes(q.toLowerCase());}
    function hid(k,v){return '<input name="'+k+'" value="'+esc(v)+'">';}function fText(l,k,v,attrs){return '<label>'+esc(l)+'<input name="'+k+'" value="'+esc(v)+'" '+(attrs||'')+'></label>';}function fNum(l,k,v,a){return fText(l,k,v,a);}function fSelect(l,k,opts,v){return fText(l,k,v);}
    function topForm(){return currentForm;}function formVals(f){return f.values||{};}function toast(v,b){messages.push({text:v,bad:b});}function sheetHtml(t,b,f){return '<h2>'+esc(t)+'</h2>'+b+(f||'');}function openSheet(fn){lastSheet=fn();}
    function commerceForm(t,m,b,a,l){formOpens++;lastSheet=sheetHtml(t,b,l);currentForm={values:{},rows:[],note:{hidden:true},_commerceScope:commerceScope(),action:a,label:l};return currentForm;}
    function $(s,f){if(!f)return null;if(s==='[data-hpp-member]')return f.input;if(s==='[data-hpp-member-count]')return f.count;if(s==='[data-hpp-member-empty]')return f.empty;return null;}
    function $$(s,f){if(s==='[data-hpp-member-row]')return f.rows||[];if(s==='[data-hpp-member]')return (f.rows||[]).map(function(r){return r.input;});if(s==='[data-hpp-xl-roll]')return f.xlRolls||[];return [];}
    function commerceNumber(v,l,int,max){var n=Number(v);if(v==null||String(v).trim()===''||!Number.isFinite(n)||n<0||int&&!Number.isSafeInteger(n)||n>(max===undefined?1e12:max))throw Error(l+' belum valid');return n;}
    function commerceRevision(v){return v.revision||undefined;}function commerceMutation(module,action,payload,f){requests.push({module:module,action:action,payload:payload});return Promise.resolve();}
    function commerceLoadView(m,t,sub,draw){return draw(commerceData());}function commerceEmptyActions(){return '';}function searchBox(){return '';}function commerceList(m,rows,draw,parts){return rows.filter(function(r){return cocok(S.f.q,parts(r));}).map(draw).join('');}
  `+source,c);
  const versionStart=html.indexOf('function commerceVersionValid(');if(versionStart>=0)vm.runInContext(html.slice(versionStart,html.indexOf('function commerceApply(',versionStart)),c);
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

test('new groups still require an owner before attempting a server refresh',()=>{
  for(const update of ["actor.divisi='admin'","actor.divisi='qc'","S.token=''"]){
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


function xlFixture(){
  const data=fixture();
  data.models[0].xlReferenceCandidate={planId:'plan-mixed',evidenceRevision:'evidence-1',totalPcs:117,rolls:[
    {id:'roll-m',label:'Rol M',bahan:'Loreng contoh',unit:'kg',qty:25.14,harga:88000,totalCost:2212320},
    {id:'roll-xl',label:'Rol XL',bahan:'Loreng contoh',unit:'kg',qty:26.61,harga:88000,totalCost:2341680},
    {id:'roll-body',label:'Rol badan',bahan:'Bahan badan',unit:'yd',qty:10,harga:33000,totalCost:330000}
  ]};
  return data;
}
function selectXLRolls(h,ids){h.c.currentForm.xlRolls=h.c.currentForm._commerceXL.candidate.rolls.map(r=>({value:r.id,checked:ids.includes(r.id)}));}
function xlIntent(){return {modelId:'model0',planId:'plan-mixed',evidenceRevision:'evidence-1',rollIds:['roll-xl','roll-body'],confirmed:true,expectedRevision:'rev1'};}
function installXLRecovery(h){
  h.run("var dropped=0,afterSave=[],notices=[],fetches=0;function act(el,p){return p;}function commerceFetch(){fetches++;return Promise.resolve();}function dropForm(){dropped++;}function commerceAfterSave(intent){afterSave.push(intent);}function commerceFormNotice(f,msg,retry){notices.push({message:msg,retry:retry});}function quiet(e){throw e;}");
  vm.runInContext(html.slice(html.indexOf('A.commerceCheck = function'),html.indexOf('function commerceNumber(value')),h.c);
  h.c.pending=xlIntent();
  h.run("currentForm={_commerceScope:commerceScope(),_commerceLocked:true,_commerceIntent:{module:'hpp',action:'saveCommerceHppXLReference',payload:pending}};");
}

test('XL picker uses the raw member evidence inside a group and never selects a roll automatically',()=>{
  const h=harness(xlFixture()),before=JSON.stringify(h.c.entry.data);
  h.run('A.commerceHppOpen('+trigger('hppg_example')+');');
  assert.match(h.c.lastSheet,/data-a="commerceHppXLOpen" data-id="model0"/);
  assert.doesNotMatch(h.c.lastSheet,/data-a="commerceHppXLOpen" data-id="hppg_example"/);
  h.run('A.commerceHppXLOpen('+trigger('model0')+');');
  assert.equal(h.c.currentForm._commerceXL.modelId,'model0');
  assert.equal(h.c.currentForm._commerceXL.candidate.planId,'plan-mixed');
  assert.equal((h.c.lastSheet.match(/data-hpp-xl-roll/g)||[]).length,3);
  assert.match(h.c.lastSheet,/XL 117 pcs/);assert.match(h.c.lastSheet,/26.61 kg/);assert.match(h.c.lastSheet,/10 yd/);
  assert.match(h.c.lastSheet,/name="xlConfirmed"/);assert.doesNotMatch(h.c.lastSheet,/ checked/);
  assert.equal(h.c.requests.length,0);assert.equal(JSON.stringify(h.c.entry.data),before);
});

test('XL picker preselects only a saved choice from the same evidence and still requires confirmation',()=>{
  for(const evidenceRevision of ['evidence-1','evidence-old']){
    const data=xlFixture();data.models[0].xlReference={...xlIntent(),evidenceRevision,rollIds:['roll-xl']};
    const h=harness(data);h.run('A.commerceHppXLOpen('+trigger('model0')+');');
    assert.match(h.run('commerceHppXLButton(entry.data.models[0])'),/Ubah kain acuan XL/);
    assert.equal((h.c.lastSheet.match(/data-hpp-xl-roll[^>]* checked/g)||[]).length,evidenceRevision==='evidence-1'?1:0);
    assert.doesNotMatch(h.c.lastSheet,/name="xlConfirmed"[^>]* checked/);
    selectXLRolls(h,['roll-xl']);h.run('A.commerceHppXLSave(null)');
    assert.equal(h.c.requests.length,0);assert.match(h.c.messages.at(-1).text,/Centang kepastian/);
  }
});

test('XL save requires a nonempty genuine selection and explicit owner confirmation',()=>{
  for(const scenario of ['empty','forged','duplicate','unconfirmed']){
    const h=harness(xlFixture());h.run('A.commerceHppXLOpen('+trigger('model0')+');');selectXLRolls(h,['roll-xl']);
    h.c.currentForm.values={xlConfirmed:true};
    if(scenario==='empty')h.c.currentForm.xlRolls.forEach(r=>r.checked=false);
    if(scenario==='forged')h.c.currentForm.xlRolls[1].value='different-plan-roll';
    if(scenario==='duplicate')h.c.currentForm.xlRolls.push({value:'roll-xl',checked:true});
    if(scenario==='unconfirmed')h.c.currentForm.values.xlConfirmed=false;
    h.run('A.commerceHppXLSave(null)');assert.equal(h.c.requests.length,0,scenario);assert.ok(h.c.messages.length,scenario);
  }
});

test('XL save sends only explicitly chosen physical rolls and captured evidence for the raw model',()=>{
  const h=harness(xlFixture()),before=JSON.stringify(h.c.entry.data);
  h.run('A.commerceHppXLOpen('+trigger('model0')+');');selectXLRolls(h,['roll-xl','roll-body']);h.c.currentForm.values={xlConfirmed:true};
  h.run('A.commerceHppXLSave(null)');
  assert.deepEqual(h.json('requests'),[{module:'hpp',action:'saveCommerceHppXLReference',payload:xlIntent()}]);
  assert.equal(JSON.stringify(h.c.entry.data),before,'opening and saving cannot edit source rolls, production output or cached HPP locally');
});

test('XL controls reject nonowners before attempting to refresh the server state',()=>{
  for(const change of ["actor.divisi='admin'","actor.divisi='qc'","S.token=''"]){
    const h=harness(xlFixture());h.run(change+';A.commerceHppXLOpen('+trigger('model0')+');');
    assert.equal(h.c.currentForm,null,change);assert.equal(h.c.requests.length,0,change);assert.ok(h.c.messages.length,change);
  }
  const h=harness(xlFixture());h.run("actor.divisi='admin'");
  assert.equal(h.run('commerceHppXLButton(entry.data.models[0])'),'');
  assert.doesNotMatch(h.run('commerceHppGroupMembers(entry.data.groups[0])'),/commerceHppXLOpen/);
});

test('XL save rejects changed source snapshots, sessions and owner permissions',()=>{
  for(const change of ["S.token='new-session'","actor.divisi='admin'","entry.data=JSON.parse(JSON.stringify(entry.data))","entry.version=2","entry.data.revision='rev2'","entry.stale=true","entry.loading={}","entry.error='offline'"]){
    const h=harness(xlFixture());h.run('A.commerceHppXLOpen('+trigger('model0')+');');selectXLRolls(h,['roll-xl']);h.c.currentForm.values={xlConfirmed:true};
    h.run(change+';A.commerceHppXLSave(null)');assert.equal(h.c.requests.length,0,change);assert.ok(h.c.messages.length,change);
  }
  const h=harness(xlFixture());h.run('A.commerceHppXLOpen('+trigger('model0')+');');selectXLRolls(h,['roll-xl']);h.c.currentForm.values={xlConfirmed:true};
  h.run('currentForm._commerceLocked=true;A.commerceHppXLSave(null)');assert.equal(h.c.requests.length,0);
});

test('opening XL evidence cannot discard unsaved shared cost changes',()=>{
  const h=harness(xlFixture());h.run('A.commerceHppOpen('+trigger('hppg_example')+');');
  h.c.currentForm.values={jahitMode:'manual',hargaJahit:'3000',biayaLain:'999',targetMargin:'30',ketLain:''};
  const old=h.c.currentForm;
  h.run("A.commerceHppXLOpen({getAttribute:function(){return 'model0';},closest:function(){return currentForm;}})");
  assert.equal(h.c.currentForm,old);assert.equal(h.c.requests.length,0);assert.match(h.c.messages.at(-1).text,/Simpan perubahan biaya dahulu/);
});

test('removing stale XL evidence is explicit, revision checked, and leaves cached production unchanged',()=>{
  const data=xlFixture();data.models[0].xlReference={...xlIntent()};data.models[0].xlReferenceCandidate=null;
  const h=harness(data),before=JSON.stringify(h.c.entry.data);
  h.run('A.commerceHppXLOpen('+trigger('model0')+');');assert.match(h.c.lastSheet,/Catatan sumber berubah/);assert.match(h.c.lastSheet,/commerceHppXLClear/);
  h.run('A.commerceHppXLSave(null)');assert.equal(h.c.requests.length,0);
  h.run('A.commerceHppXLClear()');assert.equal(h.c.requests.length,0);assert.equal(h.c.currentForm.action,'commerceHppXLClearSave');
  h.run('A.commerceHppXLClearSave(null)');assert.deepEqual(h.json('requests[0].payload'),{modelId:'model0',remove:true,expectedRevision:'rev1'});
  assert.equal(JSON.stringify(h.c.entry.data),before);
  const stale=harness(data);stale.run('A.commerceHppXLOpen('+trigger('model0')+');A.commerceHppXLClear();entry.version=9;A.commerceHppXLClearSave(null)');
  assert.equal(stale.c.requests.length,0);assert.match(stale.c.messages.at(-1).text,/Data HPP berubah/);
});

test('XL timeout recovery recognizes an already committed choice without resending',async()=>{
  const h=harness(xlFixture());installXLRecovery(h);
  h.c.entry.data.config.xlReferences={model0:{...xlIntent(),rollIds:['roll-body','roll-xl']}};h.c.entry.data.revision='rev2';
  await h.run('A.commerceCheck({closest:function(){return currentForm;}})');
  assert.equal(h.c.fetches,1);assert.equal(h.c.dropped,1);assert.equal(h.c.requests.length,0);
  assert.equal(h.c.afterSave[0].action,'saveCommerceHppXLReference');
  assert.equal(h.c.currentForm._commerceRetry,false);
});

test('XL timeout recovery retries the same selection only while the revision is unchanged',async()=>{
  const h=harness(xlFixture());installXLRecovery(h);const original=h.json('pending');
  await h.run('A.commerceCheck({closest:function(){return currentForm;}})');
  assert.equal(h.c.dropped,0);assert.equal(h.c.currentForm._commerceRetry,true);assert.equal(h.c.requests.length,0);
  await h.run('A.commerceRetry({closest:function(){return currentForm;}})');
  assert.deepEqual(h.json('requests[0]'),{module:'hpp',action:'saveCommerceHppXLReference',payload:original});
  assert.equal(h.c.currentForm._commerceRetry,false);
  const conflict=harness(xlFixture());installXLRecovery(conflict);conflict.c.entry.data.revision='rev3';
  await conflict.run('A.commerceCheck({closest:function(){return currentForm;}})');
  await conflict.run('A.commerceRetry({closest:function(){return currentForm;}})');
  assert.equal(conflict.c.requests.length,0);assert.equal(conflict.c.currentForm._commerceRetry,false);assert.match(conflict.c.notices[0].message,/Data acuan berubah/);
  const session=harness(xlFixture());installXLRecovery(session);session.run("S.token='new-session'");
  await session.run('A.commerceCheck({closest:function(){return currentForm;}})');assert.equal(session.c.fetches,0);assert.equal(session.c.requests.length,0);
});

test('XL timeout recovery recognizes completed removal and rejects a different saved allocation',()=>{
  const h=harness(xlFixture());h.c.payload=xlIntent();
  h.c.entry.data.config.xlReferences={model0:{...xlIntent(),rollIds:['roll-m']}};h.c.entry.data.revision='rev2';
  assert.equal(h.run('commerceHppXLCheck(payload,entry.data).complete'),false);assert.equal(h.run('commerceHppXLCheck(payload,entry.data).retry'),false);
  h.c.payload={modelId:'model0',remove:true,expectedRevision:'rev1'};
  assert.equal(h.run('commerceHppXLCheck(payload,entry.data).complete'),false);
  delete h.c.entry.data.config.xlReferences.model0;
  assert.equal(h.run('commerceHppXLCheck(payload,entry.data).complete'),true);
});

test('XL roll labels and material names are escaped, including checkbox attribute values',()=>{
  const data=xlFixture();data.models[0].nama='<svg onload=bad>';data.models[0].xlReferenceCandidate.rolls[0]={id:'roll" onfocus="bad',label:'<img src=x onerror=bad>',bahan:'<script>bad</script>',unit:'kg',qty:1,harga:1,totalCost:1};
  const h=harness(data);h.run('A.commerceHppXLOpen('+trigger('model0')+');');
  assert.match(h.c.lastSheet,/&lt;svg/);assert.match(h.c.lastSheet,/&lt;img/);assert.match(h.c.lastSheet,/&lt;script/);assert.match(h.c.lastSheet,/value="roll&quot; onfocus=&quot;bad"/);
  assert.doesNotMatch(h.c.lastSheet,/<script>|<svg|<img|value="roll" onfocus=/);
});

test('real request path sends the XL choice with session and workflow metadata and rejects old workflow',async()=>{
  const requestSource=html.slice(html.indexOf('function req(action, payload)'),html.indexOf('function signOutLocal()'));
  const c=vm.createContext({console});vm.runInContext("var calls=[],S={token:'owner-session',state:{workflowVersion:2},busy:0},Api={mode:function(){return 'remote';},call:function(a,p){calls.push({action:a,payload:p});return Promise.resolve({ok:true});}};function paintSync(){}function refresh(){}function applyState(){}"+requestSource,c);
  c.payload=xlIntent();await vm.runInContext("req('saveCommerceHppXLReference',payload)",c);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(calls[0])',c)),{action:'saveCommerceHppXLReference',payload:{...xlIntent(),token:'owner-session',workflowVersion:2}});
  vm.runInContext('S.state.workflowVersion=1',c);
  await assert.rejects(vm.runInContext("req('saveCommerceHppXLReference',{modelId:'model0'})",c),/Pembaruan alur produksi/);assert.equal(c.calls.length,1);
});


test('XL timeout keeps the original roll intent locked until refreshed state confirms the save',async()=>{
  const h=harness(xlFixture());h.run('A.commerceHppXLOpen('+trigger('model0')+');');selectXLRolls(h,['roll-xl','roll-body']);h.c.currentForm.values={xlConfirmed:true};
  h.run("var notices=[],dropped=0,afterSave=[];function act(el,p){return p;}function req(action,payload){requests.push({action:action,payload:payload});var e=new Error('timeout');e.timeout=true;return Promise.reject(e);}function commerceHistoryWriteAllowed(){return true;}function commerceFormLock(f,yes){f._commerceLocked=yes;}function commerceFormNotice(f,msg,retry){notices.push({message:msg,retry:retry});}function commerceFetch(){return Promise.resolve();}function dropForm(){dropped++;}function commerceAfterSave(intent){afterSave.push(intent);}function quiet(e){throw e;}");
  vm.runInContext(html.slice(html.indexOf('function commerceMutation(module, action'),html.indexOf('function commerceNumber(value')),h.c);
  await h.run('A.commerceHppXLSave(null)');
  assert.equal(h.c.requests.length,1);assert.equal(h.c.requests[0].payload.withState,true);
  assert.deepEqual(h.json('currentForm._commerceIntent.payload'),xlIntent());
  assert.equal(h.c.currentForm._commerceSending,false);assert.equal(h.c.currentForm._commerceLocked,true);assert.equal(h.c.dropped,0);
  await h.run('A.commerceHppXLSave(null)');assert.equal(h.c.requests.length,1,'a second Save cannot create another request while the outcome is uncertain');
  h.c.entry.data.config.xlReferences={model0:{...xlIntent()}};h.c.entry.data.revision='rev2';
  await h.run('A.commerceCheck({closest:function(){return currentForm;}})');
  assert.equal(h.c.requests.length,1);assert.equal(h.c.dropped,1);assert.deepEqual(h.json('afterSave[0].payload'),xlIntent());
});


test('shared HPP names only the selected XL reference models and their actual quantities before collapsed membership',()=>{
  const data=fixture();data.models[0].kain.totalPcs=120;data.models[1].kain.totalPcs=380;data.models[1].kain.complete=false;
  const h=harness(data),before=JSON.stringify(h.c.entry.data);
  const out=h.run('commerceHppGroupMembers(entry.data.groups[0])'),visible=out.slice(0,out.indexOf('<details'));
  assert.match(visible,/Acuan XL yang dipakai/);assert.match(visible,/Oblong Merah · XL 120 pcs/);
  assert.doesNotMatch(visible,/Oblong Biru|380 pcs|500 pcs/);assert.match(visible,/Semua anggota dan ukuran mengikuti acuan ini/);
  assert.ok(out.includes('<summary>Anggota kelompok · 2 model</summary>'));assert.equal(JSON.stringify(h.c.entry.data),before);
  h.c.entry.data.groups[0].referenceModelIds=['model0','model1'];h.c.entry.data.models[1].kain.complete=true;
  const combined=h.run('commerceHppGroupMembers(entry.data.groups[0])').split('<details')[0];
  assert.match(combined,/Oblong Merah · XL 120 pcs/);assert.match(combined,/Oblong Biru · XL 380 pcs/);
});

test('shared HPP reference summary escapes model names and does not invent a quantity for a missing raw member',()=>{
  const data=fixture();data.models[0].nama='<img src=x onerror=bad>';
  const h=harness(data);const shown=h.run('commerceHppGroupMembers(entry.data.groups[0])').split('<details')[0];
  assert.match(shown,/&lt;img src=x onerror=bad&gt; · XL 10 pcs/);assert.doesNotMatch(shown,/<img/);
  h.c.entry.data.models=h.c.entry.data.models.filter(m=>m.id!=='model0');
  const fallback=h.run('commerceHppGroupMembers(entry.data.groups[0])').split('<details')[0];
  assert.match(fallback,/Oblong Merah · XL/);assert.doesNotMatch(fallback,/0 pcs|10 pcs/);
  h.c.entry.data.groups[0].referenceModelIds=[];
  const missing=h.run('commerceHppGroupMembers(entry.data.groups[0])').split('<details')[0];
  assert.match(missing,/Cukup satu anggota dengan acuan XL lengkap/);assert.doesNotMatch(missing,/Acuan XL yang dipakai/);
});

test('group notes from following members are collapsed while blocking source warnings remain visible',()=>{
  const data=fixture(),g=data.groups[0];
  g.inheritedWarnings=['Oblong Biru: Harga kain belum lengkap.','1 anggota mengikuti acuan XL kelompok.','<script>catatan</script>'];
  g.sourceWarnings=['Ada anggota kelompok yang datanya belum ditemukan.'];
  g.warnings=[...g.sourceWarnings,...g.inheritedWarnings,'Biaya kelompok belum diperiksa dan disimpan.'];
  const h=harness(data),before=JSON.stringify(h.c.entry.data),out=h.run('commerceHppWarnings(entry.data.groups[0])');
  const visible=out.slice(0,out.indexOf('<details')),collapsed=out.slice(out.indexOf('<details'));
  assert.match(visible,/note warn/);assert.match(visible,/datanya belum ditemukan/);assert.match(visible,/Biaya kelompok belum diperiksa/);
  assert.doesNotMatch(visible,/Harga kain belum lengkap|anggota mengikuti|catatan/);
  assert.match(collapsed,/<details class="card"><summary>Catatan anggota yang mengikuti/);assert.doesNotMatch(collapsed,/<details[^>]* open/);
  assert.match(collapsed,/Harga kain belum lengkap/);assert.match(collapsed,/&lt;script&gt;catatan/);assert.doesNotMatch(collapsed,/<script>/);
  assert.equal(JSON.stringify(h.c.entry.data),before,'display never deletes the flat warnings used by exports');
});

test('valid shared HPP does not show a warning wall for incomplete followers and preserves legacy and blocking warnings',()=>{
  const data=fixture(),g=data.groups[0];g.inheritedWarnings=['Oblong Biru: Belum ada hasil XL.'];g.warnings=g.inheritedWarnings.slice();g.sourceWarnings=[];
  const h=harness(data);let out=h.run('commerceHppWarnings(entry.data.groups[0])');assert.doesNotMatch(out,/note warn/);assert.match(out,/<details/);
  h.c.entry.data.groups[0].sourceWarnings=g.inheritedWarnings.slice();out=h.run('commerceHppWarnings(entry.data.groups[0])');
  assert.match(out,/note warn/);assert.doesNotMatch(out,/<details/,'a source blocker cannot be hidden even if duplicated in inherited notes');
  h.run('delete entry.data.groups[0].inheritedWarnings');assert.match(h.run('commerceHppWarnings(entry.data.groups[0])'),/note warn/,'older server responses keep warnings visible');
  h.run("entry.data.models[0].warnings=['Harga belum lengkap'];entry.data.models[0].inheritedWarnings=['Harga belum lengkap']");
  assert.match(h.run('commerceHppWarnings(entry.data.models[0])'),/note warn/,'individual model warnings remain unchanged');
});


function readiness(h){
  h.run("var fetches=[],sheets=[];function commerceFetch(module,force){if(entry.loading)return entry.loading;var p=new Promise(function(resolve,reject){fetches.push({module:module,force:force,resolve:resolve,reject:reject});});entry.loading=p;return p;}");
}
function finishReadiness(h,data=xlFixture(),version=2){
  const pending=h.c.fetches.at(-1);h.c.entry.data=structuredClone(data);h.c.entry.version=version;
  h.c.entry.stale=false;h.c.entry.loading=null;h.c.entry.error='';h.c.entry.lama=0;pending.resolve(h.c.entry.data);
}
const openActions=[
  {code:'A.commerceHppGroupOpen(null)',form:'commerceHppGroupSave'},
  {code:'A.commerceHppGroupRemove('+trigger('hppg_example')+')',form:'commerceHppGroupRemoveSave'},
  {code:'A.commerceHppXLOpen('+trigger('model0')+')',form:'commerceHppXLSave'},
  {code:'A.commerceHppOpen('+trigger('hppg_example')+')',form:'commerceHppSave'}
];

test('stale HPP actions refresh once and open the requested form from the fresh snapshot',async()=>{
  for(const action of openActions){
    const h=harness(xlFixture());readiness(h);h.run('entry.stale=true');
    const first=h.run(action.code),second=h.run(action.code);await Promise.resolve();
    assert.equal(h.c.fetches.length,1,action.code);assert.equal(h.c.fetches[0].module,'hpp');assert.equal(h.c.fetches[0].force,true);
    assert.equal(h.c.currentForm,null);assert.equal(h.c.formOpens,0);assert.equal(h.c.requests.length,0);
    const data=xlFixture();data.revision='fresh-revision';data.groups[0].nama='Fresh group';finishReadiness(h,data);
    await Promise.all([first,second]);assert.equal(h.c.formOpens,1,action.code);assert.equal(h.c.currentForm.action,action.form);assert.equal(h.c.currentForm._commerceHppGroupSnapshot.revision,'fresh-revision');assert.equal(h.c.currentForm._commerceHppGroupSnapshot.version,2);
    assert.equal(h.c.requests.length,0,'opening a form does not write anything');
  }
});

test('HPP opening joins an existing load and recovers stale errors or invalid versions',async()=>{
  for(const state of ['loading','error','invalid-version','old-copy','missing-capability','no-data']){
    const h=harness(xlFixture());readiness(h);
    if(state==='loading')h.run("commerceFetch('hpp',true)");
    if(state==='error')h.run("entry.error='Previous read failed'");
    if(state==='invalid-version')h.run('entry.version=NaN');
    if(state==='old-copy')h.run('entry.lama=123');
    if(state==='missing-capability')h.run('delete entry.data.groups');
    if(state==='no-data')h.run('entry.data=null');
    const pending=h.run('A.commerceHppGroupOpen(null)');await Promise.resolve();assert.equal(h.c.fetches.length,1,state);assert.equal(h.c.currentForm,null,state);
    finishReadiness(h);await pending;assert.equal(h.c.formOpens,1,state);assert.equal(h.c.currentForm.action,'commerceHppGroupSave');
  }
});

test('a failed HPP refresh leaves no modal and permits a later successful retry',async()=>{
  const h=harness(xlFixture());readiness(h);h.run('entry.stale=true');const failed=h.run('A.commerceHppGroupOpen(null)');await Promise.resolve();
  h.c.entry.loading=null;h.c.entry.error='Connection failed';h.c.fetches[0].reject(new Error('Connection failed'));await Promise.allSettled([failed]);
  assert.equal(h.c.currentForm,null);assert.equal(h.c.formOpens,0);assert.ok(h.c.messages.some(m=>m.bad));assert.equal(h.c.requests.length,0);
  const retried=h.run('A.commerceHppGroupOpen(null)');await Promise.resolve();assert.equal(h.c.fetches.length,2);finishReadiness(h);await retried;
  assert.equal(h.c.formOpens,1);assert.equal(h.c.currentForm.action,'commerceHppGroupSave');
  const unsupported=harness(xlFixture());readiness(unsupported);unsupported.run('entry.stale=true');const pending=unsupported.run('A.commerceHppGroupOpen(null)');await Promise.resolve();const data=fixture();delete data.groups;finishReadiness(unsupported,data);await Promise.allSettled([pending]);
  assert.equal(unsupported.c.currentForm,null);assert.ok(unsupported.c.messages.some(m=>m.bad));assert.equal(unsupported.c.requests.length,0);
});

test('late HPP reads cannot open a form after account, role, navigation or modal changes',async()=>{
  for(const change of ["S.token='changed'","actor.divisi='admin'","S.tab='po'","S.navigationRevision=1","var sheetRevision=1","sheets.push({id:'new-modal'})","currentForm={values:{},_commerceScope:commerceScope()}"]){
    for(const action of openActions){
      const h=harness(xlFixture());readiness(h);h.run('entry.stale=true');const pending=h.run(action.code);await Promise.resolve();h.run(change);const current=h.c.currentForm;
      finishReadiness(h);await Promise.allSettled([pending]);assert.equal(h.c.currentForm,current,change+' '+action.code);assert.equal(h.c.formOpens,0);assert.equal(h.c.requests.length,0);
    }
  }
});

test('editing cost fields while a membership refresh waits preserves the current form',async()=>{
  const h=harness(xlFixture());readiness(h);h.run('A.commerceHppOpen('+trigger('hppg_example')+');');
  h.c.currentForm.values={jahitMode:'manual',hargaJahit:'3000',biayaLain:'500',targetMargin:'30',ketLain:''};const old=h.c.currentForm;
  h.run('entry.stale=true');const pending=h.run("A.commerceHppGroupOpen({getAttribute:function(){return 'hppg_example';},closest:function(){return currentForm;}})");
  await Promise.resolve();h.c.currentForm.values.biayaLain='900';finishReadiness(h);await Promise.allSettled([pending]);
  assert.equal(h.c.currentForm,old);assert.equal(h.c.currentForm.values.biayaLain,'900');assert.equal(h.c.formOpens,1);assert.equal(h.c.requests.length,0);assert.match(h.c.messages.at(-1).text,/Simpan perubahan biaya/);
});


test('switching the requested HPP action during one refresh opens only the latest choice',async()=>{
  const h=harness(xlFixture());readiness(h);h.run('entry.stale=true');
  const group=h.run('A.commerceHppGroupOpen(null)');await Promise.resolve();
  const xl=h.run('A.commerceHppXLOpen('+trigger('model0')+')');await Promise.resolve();
  assert.equal(h.c.fetches.length,1);finishReadiness(h);await Promise.all([group,xl]);
  assert.equal(h.c.formOpens,1);assert.equal(h.c.currentForm.action,'commerceHppXLSave');assert.equal(h.c.requests.length,0);
});
