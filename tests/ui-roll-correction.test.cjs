'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
function ui(){const c=vm.createContext({console});vm.runInContext(fs.readFileSync(path.join(root,'src/core.js'),'utf8'),c);vm.runInContext(`
var A={},R={},owner=true,requests=[],messages=[],closed=0,rendered='',layers=[],S={state:{stokRol:[{id:'source',bahan:'Katun',qty:8,saldo:5,dicadangkan:2,correctionRevision:'prior',sourceRevision:'source-v1',invoice:'BON-A',rollLabel:'Rol 1'}]}};
var sheet={},form={values:{id:'adjust01',stokId:'source',expectedSaldo:'5',expectedCorrectionId:'prior',expectedSourceRevision:'source-v1',reserved:'2',fisik:'4',catatan:'Selisih timbang'},meta:{'[data-rol-notice]':{hidden:true,innerHTML:''},'[data-rol-selisih]':{textContent:''}},closest:function(){return sheet;}},button={disabled:false,getAttribute:function(){return 'source';},closest:function(){return form;}};
function $(q,scope){return (scope||form).meta[q]||null;}function $$(q,scope){return [];}function formVals(f){return Object.assign({},f.values);}function topForm(){return form;}function poPrepareOwner(){return owner;}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}function nfQty(n){return String(n);}function satuanPendek(s){return s;}function newId(){return 'adjust01';}
function hid(k,v){return '<input name="'+k+'" value="'+esc(v)+'">';}function fNum(t,k,v){return '<label>'+t+'<input name="'+k+'" value="'+esc(v)+'"></label>';}function fText(t,k,v){return '<label>'+t+'<input name="'+k+'" value="'+esc(v)+'"></label>';}function footSave(a){return '<button data-a="'+a+'">Simpan</button>';}
function fTanggal(){return '';}function fCatatan(){return '';}function emptyBox(s){return s;}function bahanInfo(){return {nama:'Katun',satuan:'kg',saldo:15,legacySaldo:10};}
function openSheet(fn,opt){layers.push({render:fn,live:!!(opt&&opt.live)});rendered=fn();}function sheetHtml(t,b,f){return t+b+(f||'');}function dropForm(){closed++;layers.pop();var parent=layers[layers.length-1];if(parent&&parent.live)rendered=parent.render();}function toast(s){messages.push(s);}function refresh(){}function applyState(state){S.state=state;}
function act(el,p){return p;}function req(action,payload){return new Promise(function(resolve,reject){requests.push({action:action,payload:payload,resolve:resolve,reject:reject});}).then(function(res){if(res&&res.state){applyState(res.state);refresh();return res.data;}return res;});}
`,c);vm.runInContext(part('A.cocokOpen = function','R.cocok = function'),c);return {c,run:s=>vm.runInContext(s,c),json:s=>JSON.parse(vm.runInContext('JSON.stringify('+s+')',c))};}
async function uncertain(h){const done=h.run('A.rolCocokSave(button)');h.c.requests[0].reject(Object.assign(new Error('Jawaban belum diterima'),{uncertain:true}));await done;return h.json('requests[0].payload');}
test('material correction chooses identified rolls and separate legacy delta without whole-material remapping',()=>{
 const h=ui();h.run("A.cocokOpen({getAttribute:function(){return 'Katun';}})");assert.match(h.run('rendered'),/BON-A · Rol 1/);assert.match(h.run('rendered'),/data-a="rolCocokOpen"/);assert.match(h.run('rendered'),/Koreksi saldo lama/);assert.doesNotMatch(h.run('rendered'),/data-form="cocok"/);
 h.run('A.rolCocokOpen(button)');assert.match(h.run('rendered'),/name="expectedSaldo" value="5"/);assert.match(h.run('rendered'),/name="expectedCorrectionId" value="prior"/);assert.match(h.run('rendered'),/name="expectedSourceRevision" value="source-v1"/);assert.match(h.run('rendered'),/sudah dicadangkan 2 kg/);
});
test('correction requires owner, valid precision, reason and quantity at least reserved before writing',()=>{
 const h=ui();for(const field of ["form.values.fisik='1'","form.values.fisik='4.0001'","form.values.fisik='NaN'","form.values.fisik='4';form.values.catatan=''","form.values.catatan='okay';owner=false"]){h.run(field);assert.throws(()=>h.run('rolCocokValues(form)'));}assert.equal(h.run('requests.length'),0);
});
test('uncertain correction stays frozen until a read proves same revision, then retries exact snapshot',async()=>{
 const h=ui(),intent=await uncertain(h);h.run("form.values.fisik='99';A.rolCocokSave(button);A.rolCocokRetry(button)");assert.equal(h.run('requests.length'),1);assert.match(h.run("form.meta['[data-rol-notice]'].innerHTML"),/Periksa status rol/);
 const checking=h.run('A.rolCocokCheck(button)');assert.equal(h.run('requests[1].action'),'getState');h.c.requests[1].resolve({me:{id:'owner'},stokRol:[{id:'source',saldo:5,correctionRevision:'prior',sourceRevision:'source-v1'}]});await checking;assert.equal(h.run('form._rolRetryAllowed'),true);
 const retry=h.run('A.rolCocokRetry(button)');assert.equal(h.run('requests[2].action'),'cocokkanStokRol');assert.deepEqual(h.json('requests[2].payload'),intent);h.c.requests[2].resolve({id:intent.id});await retry;assert.equal(h.run('closed'),1);
});
test('already-applied correction closes on read while a changed roll requires reopening the current form',async()=>{
 for(const changed of [false,true]){const h=ui(),intent=await uncertain(h),check=h.run('A.rolCocokCheck(button)');h.c.requests[1].resolve({me:{id:'owner'},stokRol:[{id:'source',saldo:4,correctionRevision:changed?'another-correction':intent.id}]});await check;assert.equal(h.run('form._rolRetryAllowed'),false);assert.equal(h.run('closed'),changed?0:1);h.run('A.rolCocokRetry(button)');assert.equal(h.run('requests.length'),2);if(changed)assert.match(h.run("form.meta['[data-rol-notice]'].innerHTML"),/Rol sudah berubah/);}
});

test('same balance and correction revision cannot permit retry after source identity changes',async()=>{
 const h=ui(),intent=await uncertain(h);assert.equal(intent.expectedSourceRevision,'source-v1');
 const check=h.run('A.rolCocokCheck(button)');h.c.requests[1].resolve({me:{id:'owner'},stokRol:[{id:'source',saldo:5,correctionRevision:'prior',sourceRevision:'source-v2'}]});await check;
 assert.equal(h.run('form._rolRetryAllowed'),false);assert.equal(h.run('closed'),0);assert.match(h.run("form.meta['[data-rol-notice]'].innerHTML"),/Rol sudah berubah/);h.run('A.rolCocokRetry(button)');assert.equal(h.run('requests.length'),2);
});

test('closing a saved roll correction refreshes the existing parent chooser from the mutation response',async()=>{
 const h=ui();h.run("A.cocokOpen({getAttribute:function(){return 'Katun';}})");assert.match(h.run('rendered'),/Sisa 5 kg/);assert.equal(h.run('layers[0].live'),true);h.run('A.rolCocokOpen(button)');
 const save=h.run('A.rolCocokSave(button)');assert.equal(h.run('requests.length'),1);h.c.requests[0].resolve({data:{id:'adjust01'},state:{me:{id:'owner'},stokRol:[{id:'source',bahan:'Katun',saldo:4,dicadangkan:2,invoice:'BON-A',rollLabel:'Rol 1',correctionRevision:'adjust01',sourceRevision:'source-v1'}]}});await save;
 assert.equal(h.run('layers.length'),1);assert.match(h.run('rendered'),/Cocokkan fisik Katun/);assert.match(h.run('rendered'),/Sisa 4 kg/);assert.doesNotMatch(h.run('rendered'),/Sisa 5 kg/);assert.equal(h.run('requests.length'),1);
});
