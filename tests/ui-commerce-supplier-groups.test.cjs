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

function supplierOrder(id,supplier,extra={}) {
  return {id,revision:'rev-'+id,status:'pending',produkId:'product-'+id,productName:'Model '+id,supplierSnapshot:supplier?{id:supplier,nama:'Supplier '+supplier}:{},supplierName:supplier?'Supplier '+supplier:'Same missing name',grupNama:'Invoice common',tanggalOrder:'2026-10-01',items:[{id:'line-'+id,nama:'M',jumlah:10}],hargaSatuan:100,totalQty:10,totalReceived:0,totalHarga:1000,totalPaid:0,balance:1000,events:[],payments:[],...extra};
}
function openGroupIds(markup) {
  return [...markup.matchAll(/data-a="commerceInvoiceOpen" data-ids="([^"]*)"/g)].map(x=>x[1].split(','));
}

test('the same supplier keeps differently named legacy invoices separate without rewriting original orders',()=>{
  const h=harness(),orders=[supplierOrder('first','supplier-a',{tanggalOrder:'2026-01-02',grupNama:'First invoice'}),supplierOrder('second','supplier-a',{tanggalOrder:'2026-10-03',grupNama:'Another invoice'})];
  h.seed('pembelian',{orders});const before=h.json("commerceData('pembelian').orders"),groups=h.json("commerceOrderGroups(commerceData('pembelian').orders)");
  assert.equal(groups.length,2);assert.deepEqual(groups.map(g=>g.orders.map(o=>o.id)),[['first'],['second']]);assert.deepEqual(h.json("commerceData('pembelian').orders"),before);
  const card=h.run("commerceGroupCard(commerceOrderGroups(commerceData('pembelian').orders)[0])");assert.equal((card.match(/<button\b/g)||[]).length,2);assert.match(card,/>Buka invoice<\/button>/);assert.match(card,/>Invoice baru<\/button>/);assert.match(card,/First invoice/);assert.match(card,/2026-01-02/);assert.ok(!card.includes('2026-10-03'));assert.deepEqual(openGroupIds(card),[['first']]);assert.equal(h.requests.length,0);
});

test('identical invoice names and dates never merge different suppliers, even with the same display name',()=>{
  const h=harness(),orders=[supplierOrder('left','s1',{supplierName:'Same name'}),supplierOrder('right','s2',{supplierName:'Same name'})];h.seed('pembelian',{orders});const groups=h.json("commerceOrderGroups(commerceData('pembelian').orders)");
  assert.equal(groups.length,2);assert.deepEqual(groups.map(g=>g.orders.map(o=>o.id)),[['left'],['right']]);assert.notEqual(groups[0].key,groups[1].key);
});

test('missing supplier identity remains a separate order while an explicit product supplier can supply its identity',()=>{
  const h=harness(),orders=[supplierOrder('unknown-1',''),supplierOrder('unknown-2',''),supplierOrder('known','s1'),supplierOrder('from-product','',{produkId:'mapped-product'})];
  h.seed('pembelian',{orders,products:[{id:'mapped-product',supplierId:'s1'}]});const groups=h.json("commerceOrderGroups(commerceData('pembelian').orders)");
  assert.equal(groups.length,3);assert.deepEqual(groups.map(g=>g.orders.map(o=>o.id)),[['unknown-1'],['unknown-2'],['known','from-product']]);
});

test('searching one matching model keeps its whole invoice but excludes another invoice of the same supplier',()=>{
  const h=harness(),orders=[supplierOrder('needle','s1',{productName:'Unique matching model',tanggalOrder:'2026-10-01'}),supplierOrder('sibling','s1',{productName:'Different model',tanggalOrder:'2026-08-02'}),supplierOrder('unrelated','s1',{grupNama:'Different invoice'})];h.seed('pembelian',{orders});
  h.run("S.f.q='unique matching';commerceOrderList(commerceData('pembelian').orders)");const markup=h.run('S.listFn()');assert.deepEqual(openGroupIds(markup),[['needle','sibling']]);assert.match(markup,/Total Rp2000/);assert.ok(!markup.includes('unrelated'));assert.equal(h.requests.length,0);
});

test('pagination counts invoices and never splits a large invoice across pages',()=>{
  const h=harness(),large=Array.from({length:61},(_,i)=>supplierOrder('large-'+i,'same-supplier',{invoiceId:'large-invoice'})),others=Array.from({length:50},(_,i)=>supplierOrder('other-'+i,'same-supplier',{invoiceId:'other-invoice-'+i}));h.seed('pembelian',{orders:[...large,...others]});
  const markup=h.run("commerceOrderList(commerceData('pembelian').orders)"),groups=openGroupIds(markup);assert.equal(groups.length,50);assert.deepEqual(groups[0],large.map(o=>o.id));assert.match(markup,/1 tersisa/);assert.ok(!groups.flat().includes('other-49'));
  h.run("S.f['commerceLimit-pembelian']=100");const all=openGroupIds(h.run('S.listFn()'));assert.equal(all.length,51);assert.equal(new Set(all.flat()).size,111);assert.deepEqual(all[0],large.map(o=>o.id));
});

test('opening one invoice with more than 20 models retains every model, totals and detail entry',()=>{
  const h=harness(),orders=Array.from({length:45},(_,i)=>supplierOrder('order-'+i,'same-supplier',{invoiceId:'one-large-invoice',productName:'Unique model '+i,tanggalOrder:i%2?'2026-10-02':'2026-09-01'}));h.seed('pembelian',{orders:[...orders,supplierOrder('unrelated','same-supplier',{invoiceId:'another-invoice'})]});
  h.run('commerceInvoiceShow('+JSON.stringify(orders.map(o=>o.id))+')');assert.deepEqual(h.json('S.invoice.ids'),orders.map(o=>o.id));const invoice=h.run('lastSheet');assert.equal((invoice.match(/data-a="commerceOrderDetail"/g)||[]).length,45);assert.match(invoice,/Total<\/dt><dd class="b">Rp45000/);assert.match(invoice,/45 model · 450 pcs/);assert.match(invoice,/Unique model 44/);assert.equal(h.requests.length,0);
});

test('an invoice image above 20 models opens a bounded selection retaining all of that invoice and no other invoice',()=>{
  const h=harness(),orders=Array.from({length:21},(_,i)=>supplierOrder('image-'+i,'wanted-supplier'));
  h.seed('pembelian',{orders:[supplierOrder('other','wanted-supplier',{grupNama:'Other invoice'}),...orders]});
  h.run('commerceGroupPaint=function(){};A.commerceShareOpen({getAttribute:function(){return '+JSON.stringify(orders.map(o=>o.id).join(','))+';}})');
  assert.match(h.run('lastSheet'),/Pilih model invoice/);assert.equal(h.run('currentForm._commerceGroupInvoiceKey'),h.run("commerceInvoiceKey(commerceFind('pembelian','orders','image-0'))"));
  assert.deepEqual(h.json('currentForm._commerceGroupIds'),orders.slice(0,20).map(o=>o.id));assert.deepEqual(h.json('currentForm._commerceGroupRows.map(o=>o.id)'),orders.map(o=>o.id),'the 21st model remains available for an explicit replacement in the selection');
  assert.throws(()=>h.run('commerceGroupSelection(currentForm._commerceGroupRows,'+JSON.stringify(orders.map(o=>o.id))+')'),/20/);assert.equal(h.json('commerceGroupSelection(currentForm._commerceGroupRows,currentForm._commerceGroupIds)').length,20);
  assert.match(h.json('messages').at(-1).text,/maksimal 20 model.*gambar/);assert.equal(h.run('S.share'),undefined);assert.equal(h.requests.length,0);
});

test('payment above 20 or 40 outstanding invoice models requires a bounded subset before entering or submitting an amount',()=>{
  for(const count of [21,41]){
  const h=harness(),orders=Array.from({length:count},(_,i)=>supplierOrder('payment-'+i,'wanted-supplier'));
  h.seed('pembelian',{orders:[supplierOrder('other','wanted-supplier',{grupNama:'Other invoice'}),...orders]});
  h.run('commerceGroupPaint=function(){};A.commerceGroupPayOpen({getAttribute:function(k){return k==="data-ids"?'+JSON.stringify(orders.map(o=>o.id).join(','))+':"Supplier wanted-supplier";}})');
  assert.match(h.run('lastSheet'),/Pilih model invoice/);assert.equal(h.run('currentForm._commerceGroupInvoiceKey'),h.run("commerceInvoiceKey(commerceFind('pembelian','orders','payment-0'))"));
  assert.deepEqual(h.json('currentForm._commerceGroupIds'),orders.slice(0,20).map(o=>o.id));assert.deepEqual(h.json('currentForm._commerceGroupRows.map(o=>o.id)'),orders.map(o=>o.id));
  assert.throws(()=>h.run('commerceGroupSelection(currentForm._commerceGroupRows,'+JSON.stringify(orders.map(o=>o.id))+')'),/20/);
  assert.ok(!h.run('lastSheet').includes('name="jumlah"'),'no payment amount form for an oversized set');assert.equal(h.run('currentForm._commerceGroupOrders'),undefined);assert.match(h.json('messages').at(-1).text,/maksimal 20 model.*pembayaran/);assert.equal(h.requests.length,0);
  }
});
