'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function between(start,end){const a=html.indexOf(start),b=html.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return html.slice(a,b);}
function context(){
 const c=vm.createContext({});
 for(const file of ['core.js','reconcile-legacy.js'])vm.runInContext(fs.readFileSync(path.join(root,'src',file),'utf8'),c);
 vm.runInContext(`
  var S={state:{me:{divisi:'owner'},users:[{id:'sewer1',nama:'Sewer <Example>',divisi:'jahit',aktif:true},{id:'inactive',nama:'Inactive example',divisi:'jahit',aktif:false},{id:'cutter',nama:'Cutter example',divisi:'potong',aktif:true}]}},D={po:{}};
  var evidence={version:1,source:'verified-full-backup',snapshotHash:'a'.repeat(64),batchId:'fixture-batch',sizes:[{skuId:'skuXL',cycle:JSON.stringify(['skuXL','']),ukuran:'XL',hadCutAtImport:true}],plans:[]};
  evidence.proofHash=coreLegacyHash({poId:'p',snapshotHash:evidence.snapshotHash,batchId:evidence.batchId,sizes:evidence.sizes,plans:evidence.plans});
  D.po.p={id:'p',status:'aktif',asal:'lama',imporSumber:JSON.stringify({legacyCutting:evidence})};
  var A={},calls=[],renders=[],messages=[],closed=0,painted=0,seq=0,form={values:{}};
  function me(){return S.state.me;}function newId(){return 'edit'+(++seq);}
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function nf(s){return String(s);}function poHead(){return '';}
  function namaUser(id){return (S.state.users.find(u=>u.id===id)||{}).nama||id;}
  function sheetHtml(t,h,f){return t+h+(f||'');}function emptyBox(s){return s;}
  function hid(n,v){return '<input name="'+n+'" value="'+esc(v)+'">';}
  function fSelect(label,name,options,value){return label+'<select name="'+name+'">'+options.map(o=>'<option value="'+esc(o[0])+'"'+(o[0]===value?' selected':'')+'>'+esc(o[1])+'</option>').join('')+'</select>';}
  function fNum(label,name,value,attrs){return label+'<input name="'+name+'" value="'+esc(value)+'" '+attrs+'>';}
  function fText(label,name,value,attrs){return fNum(label,name,value,attrs);}
  function footSave(action,label){return '<button data-a="'+action+'">'+esc(label)+'</button>';}
  function openSheet(fn){renders.push(fn);}function paintTop(){painted++;}
  function formVals(f){return f.values;}function topForm(){return form;}function dropForm(){closed++;}
  function toast(s){messages.push(s);}function quiet(){}function act(el,p){return p;}
  function req(action,payload){calls.push({action,payload});return Promise.resolve({});}
 `,c);
 vm.runInContext(between('/* ---------- ukuran lama yang belum pernah tercatat ---------- */','/* ---------- koreksi jumlah fisik'),c);
 vm.runInContext(`
  var proof={sourceHash:'source-one',availableSizes:['M','L'],pending:[],corrections:[]};
  var model=missingSizeModel('p',proof);missingSizeEdits[model.id]=model;
  form.values={correctionId:model.id,size:'M',initialQty:'12',maklonId:'sewer1',reason:'Original work omitted; returned awaiting count.',acknowledged:true};
 `,c);
 return c;
}
function json(c,expression){return JSON.parse(vm.runInContext('JSON.stringify('+expression+')',c));}

test('missing-size entry requires owner, active legacy PO and intact original evidence',async()=>{
 const c=context();assert.equal(vm.runInContext('canRestoreMissingSize(D.po.p)',c),true);
 for(const change of ["S.state.me.divisi='admin'","S.state.me=null","S.state.me={divisi:'owner'};D.po.p.status='selesai'","D.po.p.status='aktif';D.po.p.asal='baru'","D.po.p.asal='lama';D.po.p.imporSumber='bad JSON'"]){
  vm.runInContext(change,c);assert.equal(vm.runInContext('canRestoreMissingSize(D.po.p)',c),false);
 }
 assert.equal(vm.runInContext('canRestoreMissingSize(null)',c),false);
 await vm.runInContext("A.missingSizeOpen({getAttribute:()=> 'p'})",c);assert.equal(json(c,'calls').length,0);
 assert.match(html,/canRestoreMissingSize\(po\)[^\n]*Tambahkan ukuran yang tertinggal/);
 assert.match(between('function req(','function signOutLocal('),/saveMissingSizeCorrection/);
});

test('form offers only missing sizes and active sewers, with explicit pending-count acknowledgment',()=>{
 const c=context(),rendered=vm.runInContext('missingSizeForm(model)',c);
 assert.match(rendered,/<option value="M">M<\/option>/);assert.match(rendered,/<option value="L">L<\/option>/);assert.doesNotMatch(rendered,/<option value="XL">/);
 assert.match(rendered,/<option value="sewer1">Sewer &lt;Example&gt;<\/option>/);assert.doesNotMatch(rendered,/Inactive example|Cutter example/);
 assert.match(rendered,/min="1" max="1000000000"/);assert.match(rendered,/type="checkbox" name="acknowledged"/);
 assert.match(rendered,/sudah dijahit dan sudah kembali, tetapi belum dihitung/);assert.match(rendered,/Jumlah bagus dan reject diisi setelah barang dihitung/);
});

test('new input validates size, whole-pcs bounds, active sewer, reason and acknowledgment',()=>{
 const c=context();assert.equal(json(c,'missingSizeInput(model,form.values)').initialQty,12);
 for(const value of ['1','1000000000']){vm.runInContext('form.values.initialQty='+JSON.stringify(value),c);assert.equal(json(c,'missingSizeInput(model,form.values)').initialQty,Number(value));}
 for(const value of ['','0','-1','1.5','NaN','1000000001']){vm.runInContext('form.values.initialQty='+JSON.stringify(value),c);assert.throws(()=>vm.runInContext('missingSizeInput(model,form.values)',c),/pcs bulat/);}
 vm.runInContext("form.values.initialQty='12';form.values.size='XL'",c);assert.throws(()=>vm.runInContext('missingSizeInput(model,form.values)',c),/belum tercatat/);
 vm.runInContext("form.values.size='M'",c);
 for(const value of ['','inactive','cutter']){vm.runInContext('form.values.maklonId='+JSON.stringify(value),c);assert.throws(()=>vm.runInContext('missingSizeInput(model,form.values)',c),/penjahit/);}
 vm.runInContext("form.values.maklonId='sewer1'",c);
 for(const value of [' ','a'.repeat(301)]){vm.runInContext('form.values.reason='+JSON.stringify(value),c);assert.throws(()=>vm.runInContext('missingSizeInput(model,form.values)',c),/alasan/);}
 vm.runInContext("form.values.reason='Checked original work'",c);
 for(const value of [false,'true',null]){vm.runInContext('form.values.acknowledged='+JSON.stringify(value),c);assert.throws(()=>vm.runInContext('missingSizeInput(model,form.values)',c),/menunggu hitung/);}
});

test('opening fetches current proof before constructing an editable correction',async()=>{
 const c=context();vm.runInContext("req=function(action,payload){calls.push({action,payload});return Promise.resolve(proof);}",c);
 await vm.runInContext("A.missingSizeOpen({getAttribute:()=> 'p'})",c);
 assert.deepEqual(json(c,'calls'),[{action:'getMissingSizeCorrection',payload:{poId:'p'}}]);assert.equal(vm.runInContext('renders.length',c),1);
 assert.equal(vm.runInContext('missingSizeEdits.edit2.expectedSourceHash',c),'source-one');assert.match(vm.runInContext('renders[0]()',c),/Simpan ke antrean hitung/);
});

test('save snapshots entered values before repaint, rejects double clicks and invokes no count or QC action',async()=>{
 const c=context();vm.runInContext(`req=function(action,payload){calls.push({action,payload});return new Promise(resolve=>{finish=resolve;});};
  paintTop=function(){painted++;form.values={correctionId:model.id};};`,c);
 const save=vm.runInContext('A.missingSizeSave()',c);await vm.runInContext('A.missingSizeSave()',c);
 assert.equal(json(c,'calls').length,1);assert.equal(vm.runInContext('model.busy',c),true);
 assert.deepEqual(json(c,'calls[0]'),{action:'saveMissingSizeCorrection',payload:{poId:'p',id:'edit1',expectedSourceHash:'source-one',size:'M',initialQty:12,maklonId:'sewer1',reason:'Original work omitted; returned awaiting count.'}});
 assert.equal(vm.runInContext('model.initialQty',c),12);assert.equal(vm.runInContext('model.acknowledged',c),true);
 vm.runInContext('finish({})',c);await save;
 assert.equal(vm.runInContext('closed',c),1);assert.equal(vm.runInContext('missingSizeEdits.edit1',c),undefined);assert.match(json(c,'messages').join(' '),/menunggu Hitung fisik/);
});

test('uncertain save retains submitted values and retries the same id and source hash',async()=>{
 const c=context();vm.runInContext("req=function(action,payload){calls.push({action,payload});return Promise.reject(new Error('Connection interrupted'));}",c);
 await vm.runInContext('A.missingSizeSave()',c);const first=json(c,'calls[0]');
 assert.equal(vm.runInContext('model.busy',c),false);assert.equal(vm.runInContext('model.submitted',c),true);assert.equal(vm.runInContext('closed',c),0);
 assert.match(vm.runInContext('missingSizeForm(model)',c),/Lanjutkan pencatatan/);assert.match(vm.runInContext('model.err',c),/Connection interrupted/);
 vm.runInContext("form.values={correctionId:model.id,size:'L',initialQty:'999',maklonId:'inactive',reason:'tampered',acknowledged:false}",c);
 await vm.runInContext('A.missingSizeSave()',c);assert.deepEqual(json(c,'calls[1]'),first);
});

test('stale rejection reload unlocks preserved draft only after confirming no pending write',async()=>{
 const c=context();vm.runInContext("req=function(action,payload){calls.push({action,payload});return Promise.reject(new Error('Stale source'));}",c);await vm.runInContext('A.missingSizeSave()',c);
 vm.runInContext("req=function(action,payload){calls.push({action,payload});return Promise.resolve({sourceHash:'source-two',availableSizes:['M','L'],pending:[],corrections:[]});}",c);
 await vm.runInContext('A.missingSizeReload({})',c);
 assert.equal(vm.runInContext('model.submitted',c),false);assert.equal(vm.runInContext('model.pending',c),null);assert.equal(vm.runInContext('model.expectedSourceHash',c),'source-two');
 assert.notEqual(vm.runInContext('model.id',c),'edit1');assert.equal(vm.runInContext('model.size',c),'M');assert.equal(vm.runInContext('model.initialQty',c),12);assert.equal(vm.runInContext('model.maklonId',c),'sewer1');
 assert.equal(vm.runInContext('model.reason',c),'Original work omitted; returned awaiting count.');assert.equal(vm.runInContext('model.acknowledged',c),true);
 assert.match(vm.runInContext('missingSizeForm(model)',c),/<select name="size">/);assert.equal(vm.runInContext('missingSizeEdits.edit1',c),undefined);
});

test('reload clears only a size that is no longer available, leaving other draft facts intact',async()=>{
 const c=context();vm.runInContext("Object.assign(model,missingSizeInput(model,form.values));model.submitted=true;model.acknowledged=true;req=()=>Promise.resolve({sourceHash:'source-two',availableSizes:['L'],pending:[],corrections:[]});",c);
 await vm.runInContext('A.missingSizeReload({})',c);
 assert.equal(vm.runInContext('model.size',c),'');assert.equal(vm.runInContext('model.initialQty',c),12);assert.equal(vm.runInContext('model.reason',c),'Original work omitted; returned awaiting count.');
 assert.equal(vm.runInContext('model.submitted',c),false);assert.throws(()=>vm.runInContext('missingSizeInput(model,model)',c),/belum tercatat/);
});

test('pending server operation resumes persisted facts and identity rather than a new local submission',async()=>{
 const c=context();vm.runInContext(`var pending={id:'pending-id',size:'L',initialQty:7,maklonId:'sewer1',reason:'Persisted opening note',expectedSourceHash:'persisted-hash',status:'preparing'};
  req=function(action,payload){calls.push({action,payload});return Promise.resolve({sourceHash:'latest-hash',availableSizes:['M'],pending:[pending],corrections:[]});};`,c);
 await vm.runInContext('A.missingSizeReload({})',c);
 assert.equal(vm.runInContext('model.id',c),'pending-id');assert.equal(vm.runInContext('model.expectedSourceHash',c),'persisted-hash');assert.equal(vm.runInContext('model.acknowledged',c),true);
 assert.match(vm.runInContext('missingSizeForm(model)',c),/Persisted opening note/);assert.doesNotMatch(vm.runInContext('missingSizeForm(model)',c),/<select name="size">/);
 vm.runInContext("form.values={correctionId:model.id};req=function(action,payload){calls.push({action,payload});return Promise.resolve({});}",c);
 await vm.runInContext('A.missingSizeSave()',c);
 assert.deepEqual(json(c,'calls[1]'),{action:'saveMissingSizeCorrection',payload:{poId:'p',id:'pending-id',expectedSourceHash:'persisted-hash',size:'L',initialQty:7,maklonId:'sewer1',reason:'Persisted opening note'}});
});

test('proof reload serializes with retries so an in-flight save cannot acquire a different identity',async()=>{
 const c=context();vm.runInContext(`Object.assign(model,missingSizeInput(model,form.values));model.submitted=true;model.acknowledged=true;
  req=function(action,payload){calls.push({action,payload});return new Promise(resolve=>{finish=resolve;});};`,c);
 const reload=vm.runInContext('A.missingSizeReload({})',c);
 assert.equal(vm.runInContext('model.busy',c),true);await vm.runInContext('A.missingSizeSave()',c);await vm.runInContext('A.missingSizeReload({})',c);
 assert.equal(json(c,'calls').length,1);
 vm.runInContext("finish({sourceHash:'source-two',availableSizes:['M'],pending:[],corrections:[]})",c);await reload;
 assert.equal(vm.runInContext('model.busy',c),false);assert.equal(vm.runInContext('model.expectedSourceHash',c),'source-two');
});

test('failed reload retains submitted identity, facts and proof and releases busy state for retry',async()=>{
 const c=context();vm.runInContext(`Object.assign(model,missingSizeInput(model,form.values));model.submitted=true;model.acknowledged=true;model.err='Earlier save uncertain';
  req=function(action,payload){calls.push({action,payload});return Promise.reject(new Error('Read unavailable'));};`,c);
 const before=json(c,'({id:model.id,size:model.size,initialQty:model.initialQty,maklonId:model.maklonId,reason:model.reason,hash:model.expectedSourceHash})');
 await vm.runInContext('A.missingSizeReload({})',c);
 assert.deepEqual(json(c,'({id:model.id,size:model.size,initialQty:model.initialQty,maklonId:model.maklonId,reason:model.reason,hash:model.expectedSourceHash})'),before);
 assert.equal(vm.runInContext('model.busy',c),false);assert.equal(vm.runInContext('model.submitted',c),true);assert.equal(vm.runInContext('closed',c),0);
 await vm.runInContext('A.missingSizeSave()',c);assert.equal(json(c,'calls[1]').action,'saveMissingSizeCorrection');assert.equal(json(c,'calls[1]').payload.id,before.id);
});

test('completion arriving after navigation never closes an unrelated form',async()=>{
 for(const action of ['save','reload']){
  const c=context();vm.runInContext("req=function(action,payload){calls.push({action,payload});return new Promise(resolve=>{finish=resolve;});}",c);
  const work=vm.runInContext(action==='save'?'A.missingSizeSave()':'A.missingSizeReload({})',c);
  vm.runInContext("form={values:{correctionId:'different-form'}};finish({corrections:[{id:model.id,status:'complete'}]})",c);await work;
  assert.equal(vm.runInContext('closed',c),0,action);assert.equal(vm.runInContext('missingSizeEdits.edit1',c),undefined);
 }
});

test('role or PO changes before save prevent the mutation and invalid inputs never leave the form',async()=>{
 for(const change of ["S.state.me.divisi='admin'","D.po.p.status='selesai'","form.values.acknowledged=false"]){
  const c=context();vm.runInContext(change,c);await vm.runInContext('A.missingSizeSave()',c);
  assert.deepEqual(json(c,'calls'),[]);assert.equal(vm.runInContext('closed',c),0);assert.equal(vm.runInContext('model.busy',c),false);assert.ok(json(c,'messages').length);
 }
});

test('locked values and server errors are escaped in the correction form',()=>{
 const c=context();vm.runInContext("Object.assign(model,{submitted:true,size:'<XL>',initialQty:12,maklonId:'sewer1',reason:'<img src=x>',err:'<script>error</script>'})",c);
 const rendered=vm.runInContext('missingSizeForm(model)',c);assert.doesNotMatch(rendered,/<img|<script>|<XL>/);assert.match(rendered,/&lt;img/);assert.match(rendered,/&lt;script/);assert.match(rendered,/Sewer &lt;Example&gt;/);
});
