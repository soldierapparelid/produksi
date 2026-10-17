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

function order(id,extra={}){return {id,revision:'rev-'+id,status:'pending',supplierId:'s1',supplierSnapshot:{id:'s1',nama:'Supplier A'},supplierName:'Supplier A',invoiceId:'invoice',grupNama:'SLD001',produkId:'p-'+id,productName:'Topi '+id,items:[{id:'i-'+id,nama:'Hitam',jumlah:100}],totalQty:100,totalReceived:0,hargaSatuan:1000,totalHarga:100000,totalPaid:40000,balance:60000,payments:[],receipts:[],events:[],...extra};}
function element(attrs){return '({getAttribute:function(k){return '+JSON.stringify(attrs)+'[k]||null;}})';}
function invoice(h,orders){h.seed('pembelian',{orders});h.run('S.invoice={ids:'+JSON.stringify(orders.map(o=>o.id))+'}');return h.run('commerceInvoiceHtml()');}
function installPaymentFields(h){h.run("var nativeDollar=$;$=function(s,f){if(s==='[name=\"jumlah\"]')return f.amountField;if(s==='[data-commerce-group-payment-preview]')return f.preview;return nativeDollar(s,f);};currentForm.preview={textContent:''};currentForm.amountField={get value(){return currentForm.values.jumlah||'';},set value(x){currentForm.values.jumlah=x;},focus:function(){currentForm.focused=true;}};");}

test('invoice shows clear LUNAS independently of remaining goods, and complete message only when everything is received',()=>{
 const h=harness();let out=invoice(h,[order('a',{balance:0,totalPaid:100000,totalReceived:90})]);
 assert.match(out,/>LUNAS<\/span>/);assert.match(out,/Menunggu barang lengkap/);assert.doesNotMatch(out,/Sudah dibayar \(DP\)|data-pelunasan|Tersimpan di Riwayat/);
 out=invoice(h,[order('a',{balance:0,totalPaid:100000,totalReceived:100})]);assert.match(out,/SELESAI · Tersimpan di Riwayat/);assert.doesNotMatch(out,/data-a="commercePaymentOpen"|data-a="commerceGroupPayOpen"/);
 assert.equal(h.requests.length,0);
});

test('invoice with a remaining balance offers a separate explicit settlement action without filling DP automatically',()=>{
 const h=harness();let out=invoice(h,[order('a')]);assert.match(out,/>DP \/ CICILAN<\/span>/);assert.match(out,/data-a="commercePaymentOpen" data-m="pembelian" data-id="a" data-pelunasan="1">Lunasi sisa Rp60000/);
 h.run('A.commercePaymentOpen('+element({'data-m':'pembelian','data-id':'a'})+')');assert.match(h.run('lastSheet'),/name="jumlah" value=""/);
 h.run('A.commercePaymentOpen('+element({'data-m':'pembelian','data-id':'a','data-pelunasan':'1'})+')');assert.match(h.run('lastSheet'),/<h2>Pelunasan<\/h2>/);assert.match(h.run('lastSheet'),/name="jumlah" value="60000"/);assert.match(h.run('lastSheet'),/name="revision" value="rev-a"/);
 assert.equal(h.requests.length,0,'opening settlement never records a business payment');
});

test('multi-model settlement uses the sum of outstanding amounts and excludes already paid models',()=>{
 const h=harness();const out=invoice(h,[order('a'),order('b',{balance:20000,totalPaid:80000}),order('c',{balance:0,totalPaid:100000})]);
 assert.match(out,/data-a="commerceGroupPayOpen" data-ids="a,b" data-pelunasan="1">Lunasi sisa Rp80000/);
 h.run('A.commerceGroupPayOpen('+element({'data-ids':'a,b','data-pelunasan':'1'})+')');assert.match(h.run('lastSheet'),/Pelunasan invoice — SLD001/);assert.match(h.run('lastSheet'),/name="jumlah" value="80000"/);assert.deepEqual(h.json('currentForm._commerceGroupOrders'),[{id:'a',revision:'rev-a',balance:60000},{id:'b',revision:'rev-b',balance:20000}]);
 h.run('A.commerceGroupPayOpen('+element({'data-ids':'a,b'})+')');assert.match(h.run('lastSheet'),/name="jumlah" value=""/);assert.equal(h.requests.length,0);
});

test('Isi sisa updates only the unlocked draft and the preview, never submits a payment',()=>{
 const h=harness();h.seed('pembelian',{orders:[order('a')]});installPaymentFields(h);h.run('A.commercePaymentOpen('+element({'data-m':'pembelian','data-id':'a'})+')');
 h.run('A.commercePayRemaining()');assert.equal(h.run('currentForm.values.jumlah'),'60000');assert.match(h.run('currentForm.preview.textContent'),/Pelunasan Rp60000 · Sisa setelah pembayaran Rp0/);assert.equal(h.run('currentForm.focused'),true);assert.equal(h.requests.length,0);
 h.run("currentForm.values.jumlah='5000';currentForm._commerceLocked=true;A.commercePayRemaining()");assert.equal(h.run('currentForm.values.jumlah'),'5000');
});

test('settlement save retains the same revision guarded mutation and rejects group overpayment',()=>{
 const h=harness();h.seed('pembelian',{orders:[order('a'),order('b')]});h.run('A.commerceGroupPayOpen('+element({'data-ids':'a,b','data-pelunasan':'1'})+')');
 h.form({id:'pay1',tanggal:'2026-10-17',jumlah:'120001',metode:'transfer',catatan:''},'pembelian');h.run('A.commerceGroupPaySave(null)');assert.equal(h.requests.length,0);assert.match(h.json('messages').at(-1).text,/melebihi/);
 h.form({id:'pay1',tanggal:'2026-10-17',jumlah:'120000',metode:'transfer',catatan:''},'pembelian');h.run('A.commerceGroupPaySave(null)');assert.equal(h.requests[0].action,'appendCommerceGroupPayment');assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].payload.expectedRevisions)),{a:'rev-a',b:'rev-b'});assert.equal(h.requests[0].payload.jumlah,120000);assert.equal(h.requests[0].payload.id,'pay1');
});

test('unknown and inconsistent payment data never display LUNAS or completed archive status',()=>{
 for(const changed of [{paymentReview:true,balance:0,totalPaid:100000},{balance:0,totalPaid:40000},{balance:null,totalPaid:100000}]){const h=harness(),out=invoice(h,[order('a',{totalReceived:100,...changed})]);assert.doesNotMatch(out,/>LUNAS<\/span>|Tersimpan di Riwayat/);assert.equal(h.requests.length,0);}
});

test('already paid or review-held order cannot open a new settlement form',()=>{
 for(const changed of [{balance:0,totalPaid:100000},{paymentReview:true},{balance:null}]){const h=harness();h.seed('pembelian',{orders:[order('a',changed)]});h.run('A.commercePaymentOpen('+element({'data-m':'pembelian','data-id':'a','data-pelunasan':'1'})+')');assert.equal(h.run('lastSheet'),'');assert.equal(h.requests.length,0);assert.equal(h.json('messages').length,1);}
});
