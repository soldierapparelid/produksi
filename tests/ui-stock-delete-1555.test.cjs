'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
function ui(){
 const c=vm.createContext({console});
 vm.runInContext(`
 var A={},requests=[],messages=[],rendered='',closed=0,refreshed=0,actor={id:'owner01',divisi:'owner'},sheet={},inputs=[{disabled:false}],save={disabled:false};
 var form={values:{id:'delete01',mode:'bahan',bahan:'Embos Maroon',stokId:'',expectedRevision:'proof01',actor:'owner01',catatan:'Salah jenis bahan'},meta:{'[data-hapus-notice]':{hidden:true,innerHTML:''}},closest:function(){return sheet;}};
 var button={attrs:{'data-mode':'bahan','data-b':'Embos Maroon'},classList:{add:function(){},remove:function(){}},getAttribute:function(k){return this.attrs[k]||'';},closest:function(){return form;}};
 function me(){return actor;}function poPrepareOwner(){return actor.divisi==='owner';}function newId(){return 'delete01';}
 function $(q,f){return f.meta[q];}function $$(q,f){return q==='input,textarea,select'?inputs:q==='[data-a="hapusStokSave"]'?[save]:[];}
 function formVals(f){return Object.assign({},f.values);}function topForm(){return form;}
 function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}function nfQty(n){return String(n);}function satuanPendek(s){return s==='yard'?'yd':s==='meter'?'m':s;}
 function hid(k,v){return '<input name="'+k+'" value="'+esc(v)+'">';}function fText(l,k,v,a){return '<label>'+l+'<input name="'+k+'" '+a+'></label>';}
 function openSheet(fn){rendered=fn();}function sheetHtml(t,b,f){return t+b+(f||'');}function dropForm(){closed++;}function refresh(){refreshed++;}function toast(s){messages.push(s);}
 function req(action,payload){return new Promise(function(resolve,reject){requests.push({action:action,payload:payload,resolve:resolve,reject:reject});});}
 `,c);
 vm.runInContext(part('function act(el, p)','/* ---------- gambar ulang'),c);
 vm.runInContext(part('/* Hapus stok mengurangi stok fisik','/* Owner price corrections'),c);
 return {c,run:s=>vm.runInContext(s,c),json:s=>JSON.parse(vm.runInContext('JSON.stringify('+s+')',c))};
}
function preview(mode='bahan',unit='kg'){return {mode,bahan:'Embos Maroon',satuan:unit,qty:163.88,rollCount:1,items:[{stokId:'roll01',bahan:'Embos Maroon',qty:70.62,satuan:unit,rollLabel:'Rol 1'},{stokId:'',bahan:'Embos Maroon',qty:93.26,satuan:unit}],revision:'proof01'};}

test('each deletion scope requests a server preview only and explicitly shows stock will become zero before confirmation',async()=>{
 for(const mode of ['bahan','rol','saldo']){
  const h=ui();h.run("button.attrs['data-mode']="+JSON.stringify(mode)+";button.attrs['data-id']='roll01'");const opening=h.run('A.hapusStokOpen(button)');h.run('A.hapusStokOpen(button)');
  assert.equal(h.run('requests.length'),1,'double click cannot open duplicate confirmation');
  assert.deepEqual(h.json('requests[0].payload'),{mode,bahan:'Embos Maroon',...(mode==='rol'?{stokId:'roll01'}:{})});assert.equal(h.run('requests[0].action'),'getHapusStokBahan');
  h.c.requests[0].resolve(preview(mode,'yard'));await opening;const view=h.run('rendered');assert.match(view,/163.88 yd/);assert.match(view,/menjadi 0/);assert.match(view,/Konfirmasi hapus stok/);assert.match(view,/name="expectedRevision" value="proof01"/);assert.match(view,/Alasan hapus stok/);assert.doesNotMatch(view,/kg|deleteRecord/);assert.equal(h.run('requests.length'),1,'opening never writes');
 }
});
test('owner, nonempty reason and valid preview are required and reserved-stock errors never open a confirmation',async()=>{
 const h=ui();h.run("actor.divisi='admin';A.hapusStokOpen(button)");assert.equal(h.run('requests.length'),0);
 h.run("actor.divisi='owner';form.values.catatan='';A.hapusStokSave(button)");assert.equal(h.run('requests.length'),0);assert.match(h.run('messages.at(-1)'),/alasan/);
 h.run("form.values.catatan='Salah input';form.values.actor='someone-else';A.hapusStokSave(button)");assert.equal(h.run('requests.length'),0);
 const opening=h.run('A.hapusStokOpen(button)');h.c.requests[0].reject(new Error('Bahan sedang dicadangkan untuk PO.'));await opening;assert.equal(h.run('rendered'),'');assert.match(h.run('messages.at(-1)'),/dicadangkan/);assert.equal(h.run('requests.length'),1);
});
test('confirmed deletion sends exact server revision once; lost response retries identical intent rather than new stock or changed reason',async()=>{
 const h=ui();const saving=h.run('A.hapusStokSave(button)');h.run('A.hapusStokSave(button)');assert.equal(h.run('requests.length'),1);
 const intent=h.json('requests[0].payload');assert.deepEqual(intent,{id:'delete01',mode:'bahan',bahan:'Embos Maroon',expectedRevision:'proof01',catatan:'Salah jenis bahan'});assert.equal(h.run('requests[0].action'),'hapusStokBahan');assert.equal(h.run('inputs[0].disabled'),true);assert.equal(h.run('save.disabled'),true);
 h.c.requests[0].reject(new Error('Koneksi terputus'));await saving;
 h.run("form.values.catatan='changed';form.values.bahan='Bahan baru';form.values.expectedRevision='different';A.hapusStokSave(button)");assert.equal(h.run('requests.length'),1);
 assert.match(h.run("form.meta['[data-hapus-notice]'].innerHTML"),/hapusStokRetry/);
 const retry=h.run('A.hapusStokRetry(button)');h.run('A.hapusStokRetry(button)');assert.equal(h.run('requests.length'),2);assert.deepEqual(h.json('requests[1].payload'),intent);
 h.c.requests[1].resolve({qty:163.88,satuan:'kg',alreadyApplied:true});await retry;assert.equal(h.run('closed'),1);assert.equal(h.run('refreshed'),1);assert.match(h.run('messages.at(-1)'),/163.88 kg/);assert.ok(h.json('requests').every(r=>r.action!=='deleteRecord'));
});
test('a different signed-in owner cannot replay the original owners uncertain deletion',async()=>{
 const h=ui(),saving=h.run('A.hapusStokSave(button)');h.c.requests[0].reject(new Error('Koneksi terputus'));await saving;
 h.run("actor.id='owner02';A.hapusStokRetry(button)");assert.equal(h.run('requests.length'),1);assert.match(h.run('messages.at(-1)'),/Akun telah berubah/);
});
test('stock deletion history is retained and is never exposed as a removable generic correction',()=>{
 const history=part("if (sub === 'koreksi')",'function stokRolBahan(');
 assert.match(history,/r\.alasan==='hapus_stok'\?'<span class="chip">Riwayat hapus stok<\/span>':r\.sourceStockId/);
 assert.match(history,/nfQty\(r\.saldoAfter\)\+' '\+esc\(satuanPendek\(r\.satuan\)\)/);
});
