'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Reuse the commerce UI fixture without registering its unrelated tests.
const fixtureSource=fs.readFileSync(path.join(__dirname,'ui-commerce.test.cjs'),'utf8');
const fixtureContext=vm.createContext({require,__dirname,console,setTimeout,clearTimeout,setImmediate});
vm.runInContext(fixtureSource.slice(0,fixtureSource.indexOf('\ntest('))+'\nglobalThis.fixture=harness;globalThis.pageReply=reply;',fixtureContext);
const harness=fixtureContext.fixture,reply=fixtureContext.pageReply;
const product={id:'p1',nama:'Topi Fixture',supplierId:'s1',revision:'r1',aktif:false,hasPicture:true,model:'Logo',warna:'Hitam',harga:0};
const active={...product,id:'active',nama:'Active Product',aktif:true};
const gone={...product,id:'gone',nama:'Deleted Product',deleted:true,deletedBy:'owner',deletedFromRevision:'old'};
const data=products=>({suppliers:[{id:'s1',nama:'Supplier A'}],products,orders:[]});
function seed(h,products=[product,active,gone]){h.seed('pembelian',data(products));}
function openProduct(h){h.run("A.commerceMasterOpen({getAttribute:function(k){return k==='data-kind'?'products':'p1';}})");}
function deletionForm(h){
 openProduct(h);
 h.run(`var editForm=currentForm;
 function confirmationForm(){return {values:{id:'p1',revision:'r1'},rows:[],note:{hidden:true,innerHTML:''},fields:[],sheet:{buttons:[]},getAttribute:function(k){return k==='data-module'?'pembelian':null;},closest:function(){return this.sheet;}};}
 openSheet=function(fn){lastSheet=fn();currentForm=confirmationForm();};
 dropForm=function(f){drops++;if(f===currentForm)currentForm=f===editForm?null:editForm;};
 function closeSheet(){dropForm(currentForm);}
 A.commerceProductDelete({closest:function(){return editForm;}});`);
}

test('only owner sees and can open product deletion; cancelled confirmation sends no request',()=>{
 const h=harness();seed(h);openProduct(h);assert.match(h.run('lastSheet'),/data-a="commerceProductDelete"/);assert.match(h.run('lastSheet'),/Pesanan, DP, serta riwayat barang/);
 deletionForm(h);assert.match(h.run('lastSheet'),/Hapus produk\?/);assert.match(h.run('lastSheet'),/Topi Fixture/);assert.equal(h.requests.length,0);h.run('closeSheet()');assert.equal(h.run('currentForm===editForm'),true);assert.equal(h.requests.length,0);assert.equal(h.run("commerceFind('pembelian','products','p1').deleted"),undefined);
 for(const role of ['admin','qc']){const x=harness();seed(x);x.run("S.state.me.divisi="+JSON.stringify(role));openProduct(x);assert.doesNotMatch(x.run('lastSheet'),/data-a="commerceProductDelete"/);x.run("A.commerceProductDelete({closest:function(){return currentForm;}})");assert.equal(x.requests.length,0);assert.match(x.json('messages').at(-1).text,/Hanya owner/);}
});

test('deleted products disappear from catalog and new product choices but retain references in old order forms',()=>{
 const h=harness();seed(h);h.run("S.sub.commercePurchase='products';var page=VIEWS['pembelian-produk']()");assert.match(h.run('page'),/Topi Fixture/);assert.match(h.run('page'),/Active Product/);assert.doesNotMatch(h.run('page'),/Deleted Product/);
 const options=h.run("commerceProductOptions('s1','')");assert.match(options,/Active Product/);assert.doesNotMatch(options,/Topi Fixture|Deleted Product/);assert.match(h.run("commerceProductOptions('s1','gone')"),/value="gone" selected/);
 h.run("var beforeSheet=lastSheet;A.commerceMasterOpen({getAttribute:function(k){return k==='data-kind'?'products':'gone';}})");assert.equal(h.run('lastSheet===beforeSheet'),true);assert.match(h.json('messages').at(-1).text,/dihapus/);
 h.run(`var optionText=commerceProductOptions('s1',''),tileBox={innerHTML:''},tileSelect={value:'',style:{},options:Array.from(optionText.matchAll(/value="([^"]*)"/g)).map(function(m){return {value:m[1]};})};var baseDollar=$;$=function(s,f){if(f===tileModel)return s==='[name="produkId"]'?tileSelect:s==='[data-commerce-tiles]'?tileBox:null;return baseDollar(s,f);};var tileModel={};commerceTilesPaint(tileModel);`);
 assert.match(h.run('tileBox.innerHTML'),/data-id="active"/);assert.doesNotMatch(h.run('tileBox.innerHTML'),/data-id="gone"|data-id="p1"/);
});

test('confirmed deletion sends one immutable intent and closes both confirmation and old edit form',async()=>{
 const h=harness();seed(h);deletionForm(h);const saving=h.run('A.commerceProductDeleteSave(null)');h.run('A.commerceProductDeleteSave(null)');assert.equal(h.requests.length,1);assert.equal(h.requests[0].action,'deleteCommerceProduct');assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].payload)),{id:'p1',expectedRevision:'r1',withState:true});
 const removed={...product,revision:'r2',deleted:true,deletedBy:'owner',deletedFromRevision:'r1'};h.requests[0].resolve({record:removed,commerce:reply('pembelian',data([removed,active,gone]),11)});await saving;
 assert.equal(h.run('drops'),2);assert.equal(h.run('currentForm'),null);assert.match(h.json('messages').at(-1).text,/Produk dihapus/);assert.equal(h.run("commerceFind('pembelian','products','p1').deleted"),true);assert.equal(h.requests.length,1);
});

test('uncertain deletion only closes the editor after matching owner and original revision proof',async()=>{
 for(const proof of [{deletedBy:'owner',deletedFromRevision:'r1',matched:true},{deletedBy:'other',deletedFromRevision:'r1'},{deletedBy:'owner',deletedFromRevision:'wrong'}]){
  const h=harness();seed(h);deletionForm(h);const saving=h.run('A.commerceProductDeleteSave(null)');h.requests[0].reject(Object.assign(new Error('Response lost'),{uncertain:true}));await saving;assert.equal(h.run('currentForm._commerceLocked'),true);assert.equal(h.requests.length,1);
  const check=h.run('A.commerceCheck({closest:function(){return currentForm;}})');const removed={...product,revision:'r2',deleted:true,...proof};delete removed.matched;h.requests[1].resolve(reply('pembelian',data([removed,active,gone]),11));await check;
  assert.equal(h.run('drops'),proof.matched?2:0);assert.equal(h.requests.length,2);if(!proof.matched){assert.equal(h.run('currentForm._commerceRetry'),false);assert.match(h.run('currentForm.note.innerHTML'),/Catatan sumber berubah/);}
 }
});

test('a deletion absent on fresh read offers only exact replay and preserves the original revision',async()=>{
 const h=harness();seed(h);deletionForm(h);const saving=h.run('A.commerceProductDeleteSave(null)');h.requests[0].reject(Object.assign(new Error('Response lost'),{uncertain:true}));await saving;
 const check=h.run('A.commerceCheck({closest:function(){return currentForm;}})');h.requests[1].resolve(reply('pembelian',data([product,active,gone]),11));await check;assert.equal(h.run('currentForm._commerceRetry'),true);assert.equal(h.run('drops'),0);
 h.run("currentForm.values.revision='tampered'");const retry=h.run('A.commerceRetry({closest:function(){return currentForm;}})');assert.deepEqual(JSON.parse(JSON.stringify(h.requests[2].payload)),JSON.parse(JSON.stringify(h.requests[0].payload)));
 const removed={...product,revision:'r2',deleted:true,deletedBy:'owner',deletedFromRevision:'r1'};h.requests[2].resolve({record:removed,commerce:reply('pembelian',data([removed,active,gone]),12)});await retry;assert.equal(h.run('drops'),2);assert.equal(h.run('currentForm'),null);
});

test('confirmed deletion with a failed page refresh still closes both forms after a later successful refresh',async()=>{
 const h=harness();seed(h);deletionForm(h);const saving=h.run('A.commerceProductDeleteSave(null)'),removed={...product,revision:'r2',deleted:true,deletedBy:'owner',deletedFromRevision:'r1'};
 h.requests[0].resolve({record:removed});await new Promise(r=>setImmediate(r));assert.equal(h.requests[1].action,'getCommerceState');h.requests[1].reject(new Error('Refresh offline'));await saving;
 assert.equal(h.run('currentForm._commerceConfirmed'),true);assert.equal(h.run('drops'),0);assert.match(h.run('currentForm.note.innerHTML'),/sudah tersimpan/);
 const check=h.run('A.commerceCheck({closest:function(){return currentForm;}})');h.requests[2].resolve(reply('pembelian',data([removed,active,gone]),11));await check;
 assert.equal(h.run('drops'),2);assert.equal(h.run('currentForm'),null);assert.equal(h.requests.filter(r=>r.action==='deleteCommerceProduct').length,1);
});
