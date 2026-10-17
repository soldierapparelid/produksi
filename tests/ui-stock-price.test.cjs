'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
function harness(){
 const c=vm.createContext({console});vm.runInContext(fs.readFileSync(path.join(root,'src/core.js'),'utf8'),c);
 vm.runInContext(`
 var A={},R={},owner=true,requests=[],messages=[],closed=0,invalidated=[],rendered='',layers=[],S={state:{me:{id:'owner',divisi:'owner'},stok:[{id:'roll001',jenis:'beli',bahan:'Katun',qty:10,satuan:'kg',harga:0,total:0,stockMode:'roll',rollLabel:'Rol 1',invoice:'BON-1'}]}};
 var form={values:{id:'price001',stokId:'roll001',harga:'88000',catatan:'Harga bon lama'},meta:{'[data-harga-notice]':{hidden:true,innerHTML:''},'[data-harga-total]':{textContent:''}},closest:function(){return sheet;}};
 function field(action){return {disabled:false,getAttribute:function(){return action||'';}};}var controls=[field(),field(),field('hargaBahanCheck')],saveButton=field('hargaBahanSave'),sheet={},button={getAttribute:function(){return 'roll001';},closest:function(){return form;}};
 function $(q,f){return (f||form).meta[q]||null;}function $$(q,f){return f===sheet?[saveButton]:controls;}function formVals(f){return Object.assign({},f.values);}function topForm(){return form;}function poPrepareOwner(){return owner;}
 function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}function nfQty(n){return String(n);}function satuanPendek(s){return s;}function newId(){return 'price001';}function rp(n){return 'Rp'+n;}function tgl(s){return String(s);}function ic(){return '';}
 function hid(k,v){return '<input name="'+k+'" value="'+esc(v)+'">';}function fNum(t,k,v,a){return '<label>'+t+'<input name="'+k+'" value="'+esc(v)+'" '+(a||'')+'></label>';}function fText(t,k,v){return '<label>'+t+'<input name="'+k+'" value="'+esc(v)+'"></label>';}function footSave(a){return '<button data-a="'+a+'">Simpan</button>';}function emptyBox(s){return s;}
 function openSheet(fn,opt){layers.push({render:fn,live:!!(opt&&opt.live)});rendered=fn();}function sheetHtml(t,b,f){return t+b+(f||'');}function dropForm(){closed++;layers.pop();var parent=layers[layers.length-1];if(parent&&parent.live)rendered=parent.render();}function toast(s){messages.push(s);}function refresh(){}function applyState(s){S.state=s;}function commerceInvalidate(m){invalidated.push(m);}
 function act(el,p){return p;}function req(action,payload){return new Promise(function(resolve,reject){requests.push({action:action,payload:payload,resolve:resolve,reject:reject});}).then(function(res){if(res&&res.state){applyState(res.state);return res.data;}return res;});}
 `,c);
 vm.runInContext(part('function hargaBahanSources(nama)','function stokRolById(id)'),c);
 vm.runInContext("form.values.expectedPriceRevision=hargaBahanSource('roll001').priceRevision;",c);
 return {c,run:s=>vm.runInContext(s,c),json:s=>JSON.parse(vm.runInContext('JSON.stringify('+s+')',c))};
}
async function uncertain(h){const done=h.run('A.hargaBahanSave(button)');h.c.requests[0].reject(Object.assign(new Error('Jawaban belum diterima'),{uncertain:true}));await done;return h.json('requests[0].payload');}
function state(h){return {me:{id:'owner',divisi:'owner'},stok:h.json('S.state.stok')};}

test('owner opens source-specific price correction with a frozen price revision and no physical quantity field',()=>{
 const h=harness(),revision=h.run("hargaBahanSource('roll001').priceRevision");h.run('A.hargaBahanOpen(button)');
 assert.match(h.run('rendered'),/Koreksi harga bahan/);assert.match(h.run('rendered'),/Harga belum|Belum diisi/);
 assert.ok(h.run('rendered').includes('name="expectedPriceRevision" value="'+revision+'"'));
 assert.match(h.run('rendered'),/Harga bahan per kg/);assert.match(h.run('rendered'),/step="1" min="1"/);assert.match(h.run('rendered'),/hasil potong ukuran XL/);
 assert.doesNotMatch(h.run('rendered'),/name="(?:qty|fisik|saldo)"/);assert.equal(h.run('requests.length'),0);
 h.run('owner=false;rendered="";A.hargaBahanOpen(button)');assert.equal(h.run('rendered'),'');assert.match(h.json('messages').at(-1),/owner/);
});

test('source picker separates same-material rolls, ignores correction records and handles a missing source',()=>{
 const h=harness();h.run("S.state.stok.push({id:'roll002',jenis:'rinci',bahan:' Katun ',qty:3,satuan:'kg',stockMode:'roll',rollLabel:'Rol 2'}, {id:'other01',jenis:'beli',bahan:'Linen',qty:7,satuan:'kg'}, {id:'adjust1',jenis:'koreksi',bahan:'Katun',qty:-1,satuan:'kg'}, {id:'priceOld',jenis:'harga',bahan:'Katun',qty:0,satuan:'kg',sourceStockId:'roll001',harga:80000});A.hargaBahanSources({getAttribute:function(){return 'katun';}})");
 assert.deepEqual(h.json("hargaBahanSources('KATUN').map(function(r){return r.id;})"),['roll001','roll002']);
 assert.match(h.run('rendered'),/data-id="roll001"/);assert.match(h.run('rendered'),/data-id="roll002"/);assert.doesNotMatch(h.run('rendered'),/data-id="(?:other01|priceOld|adjust1)"/);
 h.run("A.hargaBahanSources({getAttribute:function(){return 'Missing';}})");assert.match(h.run('rendered'),/Belum ada catatan stok/);
});

test('incomplete source cost is labeled missing and a fractional inherited rate is not silently rounded into a new price',()=>{
 const h=harness();h.run("S.state.stok[0].harga=80000;S.state.stok[0].total=1;A.hargaBahanOpen(button)");
 assert.match(h.run('rendered'),/Harga sekarang: <b>Belum diisi/);
 h.run("S.state.stok=[{id:'pool001',jenis:'beli',bahan:'Katun',qty:3,satuan:'kg',harga:0,total:100000},{id:'roll001',jenis:'rinci',bahan:'Katun',qty:1,satuan:'kg',stockMode:'roll'}];A.hargaBahanOpen(button)");
 assert.equal(h.run("hargaBahanSource('roll001').harga"),100000/3);
 assert.match(h.run('rendered'),/name="harga" value=""/);
 assert.equal(h.run('requests.length'),0);
});

test('price draft rejects missing, fractional, negative, unsafe costs or reason and previews total without a write',()=>{
 for(const value of ['', '-1', '0', 'NaN', '88000.5', '1000000000001']){
  const h=harness();h.run('form.values.harga='+JSON.stringify(value));assert.throws(()=>h.run('hargaBahanValues(form)'));assert.equal(h.run('requests.length'),0);
 }
 const h=harness();h.run('R.hargaBahan(form)');assert.equal(h.run("form.meta['[data-harga-total]'].textContent"),'Rp880000');assert.equal(h.run('requests.length'),0);
 h.run("form.values.catatan=' '");assert.throws(()=>h.run('hargaBahanValues(form)'));
 h.run("form.values.catatan='Valid';owner=false");assert.throws(()=>h.run('hargaBahanValues(form)'),/owner/);
});

test('save freezes one exact intent, ignores double tap and invalidates HPP only after confirmation',async()=>{
 const h=harness(),done=h.run('A.hargaBahanSave(button)'),intent=h.json('requests[0].payload');
 h.run("form.values.harga='99000';A.hargaBahanSave(button);A.hargaBahanRetry(button)");
 assert.equal(h.run('requests.length'),1);assert.equal(intent.harga,88000);assert.equal(h.run('controls[0].disabled'),true);assert.equal(h.run('saveButton.disabled'),true);assert.equal(h.run('controls[2].disabled'),false);assert.equal(h.run('closed'),0);assert.deepEqual(h.json('invalidated'),[]);
 h.c.requests[0].resolve({id:intent.id});await done;assert.equal(h.run('closed'),1);assert.deepEqual(h.json('invalidated'),['hpp']);
});

test('uncertain save requires a fresh read before exact intent retry despite changed form fields',async()=>{
 const h=harness(),intent=await uncertain(h);h.run("form.values.harga='99000';form.values.catatan='Changed';A.hargaBahanSave(button);A.hargaBahanRetry(button);A.hargaBahanReopen(button)");
 assert.equal(h.run('requests.length'),1);assert.equal(h.run('closed'),0);assert.match(h.json('messages').at(-1),/Periksa status/);
 const checking=h.run('A.hargaBahanCheck(button)');assert.equal(h.run('requests[1].action'),'getState');h.c.requests[1].resolve(state(h));await checking;
 assert.equal(h.run('form._hargaRetryAllowed'),true);
 const retry=h.run('A.hargaBahanRetry(button)');assert.deepEqual(h.json('requests[2].payload'),intent);h.c.requests[2].resolve({id:intent.id});await retry;assert.equal(h.run('closed'),1);
});

test('read confirms only the exact persisted price correction including source revision, actor and reason',async()=>{
 for(const mismatch of [null,'sourceRevision','dibuatOleh','catatan','sourceStockId','harga']){
  const h=harness(),intent=await uncertain(h),fresh=state(h),proof={id:intent.id,jenis:'harga',sourceStockId:intent.stokId,harga:intent.harga,sourceRevision:intent.expectedPriceRevision,catatan:intent.catatan,dibuatOleh:'owner',requestActor:'owner'};
  if(mismatch)proof[mismatch]=mismatch==='harga'?99000:'other';fresh.stok.push(proof);
  const checking=h.run('A.hargaBahanCheck(button)');h.c.requests[1].resolve(fresh);await checking;
  assert.equal(h.run('closed'),mismatch?0:1,mismatch||'exact proof');
  assert.deepEqual(h.json('invalidated'),mismatch?[]:['hpp']);
 }
});

test('concurrent source, unit, quantity or price changes cannot unlock retry of an uncertain correction',async()=>{
 for(const change of [r=>r.qty=11,r=>r.satuan='yard',r=>r.bahan='Linen',r=>r.harga=90000]){
  const h=harness();await uncertain(h);const fresh=state(h);change(fresh.stok[0]);
  const checking=h.run('A.hargaBahanCheck(button)');h.c.requests[1].resolve(fresh);await checking;assert.equal(h.run('form._hargaRetryAllowed'),false);assert.equal(h.run('closed'),0);assert.match(h.run("form.meta['[data-harga-notice]'].innerHTML"),/sudah berubah/);h.run('A.hargaBahanRetry(button)');assert.equal(h.run('requests.length'),2);
 }
});

test('failed or incomplete status read never permits retry or reopens a guessed price',async()=>{
 const h=harness();await uncertain(h);const checking=h.run('A.hargaBahanCheck(button)');h.c.requests[1].resolve({me:{id:'owner',divisi:'owner'}});await checking;
 h.run('A.hargaBahanRetry(button);A.hargaBahanReopen(button)');assert.equal(h.run('requests.length'),2);assert.equal(h.run('closed'),0);assert.equal(h.run('form._hargaChecked'),undefined);
});

