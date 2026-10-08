'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const coreSource = fs.readFileSync(path.join(root, 'src/core.js'), 'utf8');
const picture = 'data:image/jpeg;base64,/9j/2Q==';
function part(a, b) {
  const start = html.indexOf(a), end = html.indexOf(b, start + a.length);
  assert.ok(start >= 0 && end > start, a);
  return html.slice(start, end);
}
function ui() {
  const c = vm.createContext({ console });
  vm.runInContext(coreSource, c);
  vm.runInContext(`
    var A={}, C={}, calls=[], decodes=[], messages=[], closed=0, quietErrors=[];
    var S={state:{settings:{ukuran:['M']}},tab:''}, D={po:{},produk:{}};
    var form={isConnected:true,nodes:{},closest:function(){return null;},values:{id:'',newId:'draftpo01',rencanaId:'draftplan01',prepareMode:'legacy',produkId:'product01',jenis:'stok',nama:'Desain baru',series:'Seri',pelanggan:'',deadline:'',bahan:'Katun',catatan:'',noPO:'',status:'aktif'}};
    ['data-po-image','data-po-image-preview','data-po-image-label','data-po-image-remove','data-po-image-input','data-po-image-note','data-po-prepared-notice'].forEach(function(key){form.nodes['['+key+']']={hidden:false,disabled:false,value:'',getAttribute:function(){return '';},removeAttribute:function(k){delete this[k];}};});
    var fileInput=form.nodes['[data-po-image-input]'];fileInput.closest=function(){return form;};
    var removeButton=form.nodes['[data-po-image-remove]'];removeButton.closest=function(){return form;};
    function $(selector,scope){return scope.nodes[selector]||null;}
    function $$(selector,scope){if(selector==='[data-po-active-size]:checked')return [{getAttribute:function(){return 'M';}}];if(selector==='input,select,textarea,button')return Object.keys(form.nodes).map(function(k){return form.nodes[k];});return [];}
    function me(){return {id:'owner01',divisi:'owner'};}function poPrepareHtml(){return '';}function poLegacyValues(){return {bahanList:[{nama:'Katun',qty:2,satuan:'kg'}],rol:1};}function applyState(state){S.state=state;}function refresh(){}
    function topForm(){return form;}function formVals(f){return Object.assign({},f.values);}function sizeVals(){return {M:2};}
    function fileToThumb(file){return new Promise(function(resolve,reject){decodes.push({file:file,resolve:resolve,reject:reject});});}
    function req(action,payload){return new Promise(function(resolve,reject){calls.push({action:action,payload:payload,resolve:resolve,reject:reject});});}
    function act(el,p){return p.catch(function(e){toast(e.message,true);throw e;});}
    function toast(message,bad){messages.push({message:message,bad:!!bad});}function quiet(e){quietErrors.push(e.message);}
    function dropForm(){closed++;}function render(){}function openSheet(fn){rendered=fn();}function poSheet(){return '';}
    function newId(){return 'draftpo01';}function sheetHtml(title,body,foot){return title+body+(foot||'');}
    function esc(v){return String(v===undefined?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}
    function ic(){return '';}function hid(k,v){return '<input name="'+k+'" value="'+esc(v)+'">';}
    function thumb(){return '<i>product picture</i>';}function fSelect(){return '';}function fText(){return '';}
    function fTanggal(){return '';}function sizeGrid(){return '';}function sumLine(){return '';}function fCatatan(){return '';}
    function footSave(){return '';}function emptyBox(s){return s;}var rendered='';
  `, c);
  vm.runInContext(part('function poPrepareOwner()', 'function rollStockRows('), c);
  vm.runInContext(part('function openPO(id, produkId)', 'C.poJenisForm ='), c);
  vm.runInContext(part('function poDraftGambarHtml()', 'C.poGambar ='), c);
  vm.runInContext(part('A.poSave = function', 'A.poDelete ='), c);
  return c;
}
function select(c, name) {
  c.fileInput.files = [{ name, type: 'image/png' }];
  return vm.runInContext('C.poDraftGambar(fileInput)', c);
}
function json(value) { return JSON.parse(JSON.stringify(value)); }

test('new PO from a product or a custom name has an optional per-PO image preview', () => {
  const c = ui();
  for (const product of ['', 'product01']) {
    vm.runInContext("D.produk.product01={id:'product01',nama:'Kaos',series:'Seri'};", c);
    vm.runInContext(`openPO('',${JSON.stringify(product)})`, c);
    assert.match(c.rendered, /data-c="poDraftGambar"/);
    assert.match(c.rendered, /Pratinjau desain PO/);
    assert.match(c.rendered, /Gambar ini hanya untuk PO ini/);
    assert.match(c.rendered, /name="newId" value="draftpo01"/);
  }
  vm.runInContext("D.po.existing={id:'existing',nama:'Kaos',jenis:'stok',status:'aktif',ukuran:{M:2}};openPO('existing','');", c);
  assert.doesNotMatch(c.rendered, /data-c="poDraftGambar"/);
  assert.match(c.rendered, /data-c="poGambar"/);
});

test('replace/remove ignores stale image decoding and never writes a draft to the server', async () => {
  const c = ui();
  const first = select(c, 'first.png'), second = select(c, 'newest.png');
  c.decodes[1].resolve(picture); await second;
  c.decodes[0].resolve('data:image/jpeg;base64,b2xk'); await first;
  assert.equal(c.form._poImage.name, 'newest.png');
  assert.equal(c.form.nodes['[data-po-image-preview]'].src, picture);
  assert.equal(c.calls.length, 0);
  const third = select(c, 'still-loading.png');
  vm.runInContext('A.poDraftGambarRemove(removeButton)', c);
  c.decodes[2].resolve(picture); await third;
  assert.equal(c.form._poImage.data, '');
  assert.equal(c.form.nodes['[data-po-image-preview]'].hidden, true);
  assert.equal(c.form.nodes['[data-po-image-preview]'].src, undefined);
});

test('invalid or unfinished image blocks PO creation until corrected or removed', async () => {
  const c = ui(), loading = select(c, 'invalid.png');
  vm.runInContext('A.poSave({})', c);
  assert.equal(c.calls.length, 0);
  c.decodes[0].reject(new Error('Gambar tidak terbaca.')); await loading;
  vm.runInContext('A.poSave({})', c);
  assert.equal(c.calls.length, 0);
  vm.runInContext('A.poDraftGambarRemove(removeButton)', c);
  const save = vm.runInContext('A.poSave({})', c); await Promise.resolve();
  assert.equal(c.calls.length, 1);
  assert.equal(c.calls[0].payload.gambarData, '');
  c.calls[0].resolve({ po:{id:'draftpo01'},rencana:{id:'draftplan01'},pending:false }); await save;
});

test('save failure retains image and stable PO ID; duplicate taps send one request', async () => {
  const c = ui(), loading = select(c, 'design.png');
  c.decodes[0].resolve(picture); await loading;
  const first = vm.runInContext('A.poSave({})', c);
  vm.runInContext('A.poSave({})', c); await Promise.resolve();
  assert.equal(c.calls.length, 1);
  assert.equal(c.calls[0].action, 'savePOWithRencana');
  assert.equal(c.calls[0].payload.gambarData, picture);
  assert.equal(c.calls[0].payload.po.produkId, 'product01');
  assert.equal(c.form.nodes['[data-po-image-input]'].disabled, true);
  c.calls[0].reject(new Error('Koneksi terputus.')); await first;
  assert.equal(c.closed, 0);
  assert.equal(c.form._poImage.data, picture);
  assert.equal(c.form.nodes['[data-po-image-input]'].disabled, true);
  vm.runInContext('A.poSave({})',c);assert.equal(c.calls.length,1);
  const checking=vm.runInContext('A.poPreparedCheck(fileInput)',c);assert.equal(c.calls[1].action,'getState');c.calls[1].resolve({me:{id:'owner01'},po:[],rencanaPotong:[]});await checking;
  const retry = vm.runInContext('A.poPreparedRetry(fileInput)', c); await Promise.resolve();
  assert.deepEqual(json(c.calls[2].payload), json(c.calls[0].payload));
  c.calls[2].resolve({po:{id:'draftpo01'},rencana:{id:'draftplan01'},pending:false}); await retry;
  assert.equal(c.closed, 1);
});

function backend() {
  const c = vm.createContext({});
  vm.runInContext(coreSource + fs.readFileSync(path.join(root,'src/cutting-plans.js'),'utf8') + `
    var db={},serial=0,config={},failImageOnce=false;
    Object.keys(SCHEMA).forEach(function(s){db[s]=[];});
    db.Pegawai=[{id:'owner01',nama:'Owner',divisi:'owner',aktif:true,token:'owner-token-123456789'},
      {id:'owner02',nama:'Other',divisi:'owner',aktif:true,token:'other-token-123456789'},
      {id:'worker01',nama:'Worker',divisi:'jahit',aktif:true,token:'worker-token-12345678'}];
    db.Produk=[{id:'product01',nama:'Kaos',series:'Seri',gambar:'product-v1',aktif:true}];
    db.StokBahan=[{id:'stock0001',jenis:'beli',bahan:'Katun',qty:20,satuan:'kg',rol:2}];
    db.Gambar=[{id:'product01',data:'data:image/jpeg;base64,b2xk',diubah:'2026-01-01'}];
    var store={read:function(s){return db[s];},append:function(s,r){if(s==='Gambar'&&failImageOnce){failImageOnce=false;throw new Error('temporary image write failure');}db[s].push(r);},
      update:function(s,id,p){Object.assign(db[s].find(function(r){return r.id===id;}),p);},remove:function(s,id){db[s]=db[s].filter(function(r){return r.id!==id;});},
      getSettings:function(){return config;},version:function(){return 1;},lock:function(fn){return fn();}};
    var core=createCore(store,{now:function(){return new Date('2026-10-08T08:00:00Z');},id:function(){return 'generated'+(++serial);}});
  `, c);
  function call(payload, token = 'owner-token-123456789') {
    const edit=!!payload.po.id,p = { token, workflowVersion: 2, ...payload };
    if(!edit)p.rencana={id:'draftplan01',bahanList:[{nama:'Katun',qty:2,satuan:'kg'}],rol:1};
    return json(vm.runInContext(`core.handle('${edit?'savePO':'savePOWithRencana'}',JSON.parse(${JSON.stringify(JSON.stringify(p))}))`, c));
  }
  return { c, call };
}
function draft() { return { newId: 'draftpo01', nama: 'Desain baru', produkId: 'product01', ukuran: {}, ukuranAktif:['M'] }; }

test('server validates the image before creating PO and attaches it only to that PO', () => {
  const a = backend(), originalProduct = json(a.c.db.Produk), originalImage = json(a.c.db.Gambar[0]);
  for (const gambarData of ['not an image', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg;base64,' + 'a'.repeat(49000)]) {
    assert.throws(() => a.call({ po: draft(), gambarData }), /gambar/i);
    assert.equal(a.c.db.PO.length, 0);
    assert.equal(a.c.db.Gambar.length, 1);
  }
  assert.throws(() => a.call({ po: draft(), gambarData: picture }, 'worker-token-12345678'), /owner|admin|izin/i);
  const result = a.call({ po: draft(), gambarData: picture });
  assert.equal(result.data.po.id, 'draftpo01');
  assert.ok(result.data.po.gambar);
  assert.deepEqual(json(a.c.db.Produk), originalProduct);
  assert.deepEqual(json(a.c.db.Gambar[0]), originalImage);
  assert.equal(a.c.db.Gambar.find(r => r.id === 'draftpo01').data, picture);
});

test('retry after a partial image write completes the same PO and omitted image preserves it', () => {
  const a = backend(); a.c.failImageOnce = true;
  assert.throws(() => a.call({ po: draft(), gambarData: picture }), /temporary image write failure/);
  assert.equal(a.c.db.PO.length, 1);
  a.call({ po: draft(), gambarData: picture });
  assert.equal(a.c.db.PO.length, 1);
  assert.equal(a.c.db.Gambar.filter(r => r.id === 'draftpo01').length, 1);
  a.call({ po: draft() });
  assert.equal(a.c.db.Gambar.find(r => r.id === 'draftpo01').data, picture);
  a.call({ po: { ...draft(), id: 'draftpo01', nama: 'Nama baru' } });
  assert.equal(a.c.db.Gambar.find(r => r.id === 'draftpo01').data, picture);
});

test('an existing newId with another intent or creator cannot overwrite that PO image', () => {
  const a = backend(); a.call({ po: draft(), gambarData: picture });
  assert.throws(() => a.call({ po: { ...draft(), nama: 'Unrelated' }, gambarData: '' }), /berbeda/);
  assert.throws(() => a.call({ po: draft(), gambarData: '' }, 'other-token-123456789'), /berbeda/);
  assert.equal(a.c.db.Gambar.find(r => r.id === 'draftpo01').data, picture);
  assert.equal(a.c.db.PO.length, 1);
  a.call({ po: draft(), gambarData: '' });
  assert.equal(a.c.db.PO[0].gambar, '');
  assert.equal(a.c.db.Gambar.filter(r => r.id === 'draftpo01').length, 0);
});
