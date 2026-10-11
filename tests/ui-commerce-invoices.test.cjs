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

function order(id,invoiceId,extra={}) { return {id,invoiceId,revision:'rev-'+id,grupNama:'SLD003',supplierName:'Supplier A',supplierSnapshot:{id:'supplier-a',nama:'Supplier A'},produkId:'product-'+id,productName:'Model '+id,tanggalOrder:'2026-10-11',items:[{id:'item-'+id,nama:'Hitam',jumlah:10}],hargaSatuan:100,totalQty:10,totalReceived:0,totalHarga:1000,totalPaid:100,balance:900,status:'dp',payments:[],events:[],...extra}; }
function seed(h,orders) { h.seed('pembelian',{suppliers:[],products:[],orders}); }
const actionEl=attrs=>'{getAttribute:function(k){return ('+JSON.stringify(attrs)+')[k]||null;}}';

test('batch identity separates same supplier, date and label; explicit legacy groups are exact and unnamed orders stay separate',()=>{
  const h=harness(),rows=[order('a','batch-one'),order('b','batch-one'),order('c','batch-two'),order('d','batch-two'),order('old-a','',{grupNama:' Lama '}),order('old-b','',{grupNama:'Lama'}),order('case','',{grupNama:'lama'}),order('plain-a','',{grupNama:''}),order('plain-b','',{grupNama:''}),order('foreign','batch-one',{supplierSnapshot:{id:'other'}})];seed(h,rows);
  assert.deepEqual(h.json("commerceOrderGroups(commerceData('pembelian').orders).map(g=>g.orders.map(o=>o.id))"),[['a','b'],['c','d'],['old-a','old-b'],['case'],['plain-a'],['plain-b'],['foreign']]);
  const before=JSON.stringify(rows);h.run("commerceOrderList(commerceData('pembelian').orders)");const page=h.run('S.listFn()');assert.match(page,/data-ids="a,b">Buka invoice/);assert.match(page,/data-ids="c,d">Buka invoice/);assert.doesNotMatch(page,/data-ids="a,b,c,d"/);assert.match(page,/<b>SLD003<\/b>/);assert.ok(!page.includes('batch-one'),'internal identity is not added to every visible named heading');assert.equal(JSON.stringify(h.json("commerceData('pembelian').orders")),before);
});

test('status filtering retains the whole invoice including paid models and preserves closed-history buckets',()=>{
  const h=harness();seed(h,[order('paid','one',{status:'lunas',totalPaid:1000,balance:0}),order('due','one',{totalHarga:2000,totalPaid:500,balance:1500}),order('unrelated','two',{status:'pending'}),order('closed','one',{status:'batal',cancelMode:'inactive',cancelledBy:'owner',cancelKeepsEvents:true})]);h.run("commerceOrderList(commerceData('pembelian').orders)");
  for(const status of ['dp','lunas']){h.run('S.f["commerceStatus-pembelian"]='+JSON.stringify(status));const page=h.run('S.listFn()');assert.match(page,/data-ids="paid,due"/);assert.match(page,/Total Rp3000/);assert.match(page,/DP \/ dibayar Rp1500/);assert.ok(!page.includes('unrelated')&&!page.includes('data-id="closed"'));}
  h.run("S.f['commerceStatus-pembelian']='inactive'");const closed=h.run('S.listFn()');assert.match(closed,/data-id="closed"/);assert.match(closed,/Total Rp1000/);assert.ok(!closed.includes('commerceGroupPayOpen'));
});

test('detail and new shared payment use only exact invoice members and reject cross-invoice selections',()=>{
  const h=harness();seed(h,[order('a','one'),order('b','one'),order('c','two')]);h.run("commerceInvoiceShow(['a','b'])");const body=h.run('lastSheet');assert.match(body,/data-ids="a,b" data-nama="Supplier A">Tambah DP/);assert.match(body,/data-ids="a,b">Gambar untuk supplier/);assert.ok(!body.includes('Model c'));assert.match(body,/Rp2000/);
  h.run("commerceInvoiceShow(['a','c'])");assert.deepEqual(h.json('S.invoice.ids'),['a','b']);assert.match(h.json('messages').at(-1).text,/Invoice berbeda/);
  h.run('A.commerceGroupPayOpen('+actionEl({'data-ids':'a,c'})+')');assert.equal(h.requests.length,0);assert.match(h.json('messages').at(-1).text,/Invoice berbeda/);
  h.run('A.commerceGroupPayOpen('+actionEl({'data-ids':'a,b','data-nama':'Supplier A'})+')');assert.match(h.run('lastSheet'),/Bayar invoice — SLD003/);assert.match(h.run('lastSheet'),/Supplier: Supplier A/);h.form({id:'dp-new',tanggal:'2026-10-11',jumlah:'500',metode:'transfer',catatan:'Invoice ini'},'pembelian');h.run('A.commerceGroupPaySave(null)');assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].payload.orderIds)),['a','b']);assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].payload.expectedRevisions)),{a:'rev-a',b:'rev-b'});
});

test('single-model share expansion includes only its invoice, and overflow keeps that invoice context',()=>{
  const h=harness();seed(h,[order('a','one'),order('b','one',{status:'selesai'}),order('c','two')]);h.run("var builds=0;commerceShareBuild=function(){builds++;};commerceShareShow(['a'],false)");assert.deepEqual(h.json('S.share.semua'),['a','b']);assert.match(h.run('lastSheet'),/Semua model invoice ini \(2\)/);assert.doesNotMatch(h.run('lastSheet'),/Semua order supplier/);
  h.run('A.commerceShareMode('+actionEl({'data-mode':'semua'})+')');assert.deepEqual(h.json('S.share.ids'),['a','b']);h.run("commerceShareShow(['a','c'],false)");assert.deepEqual(h.json('S.share.ids'),['a','b']);assert.match(h.json('messages').at(-1).text,/Invoice berbeda/);
  const many=Array.from({length:21},(_,i)=>order('many-'+i,'big'));seed(h,[...many,order('other','different')]);h.run("var wanted='';A.commerceGroupOpen=function(el){wanted=el.getAttribute('data-invoice');};commerceShareShow("+JSON.stringify(many.map(o=>o.id))+",false)");assert.equal(h.run('wanted'),h.run("commerceInvoiceKey(commerceFind('pembelian','orders','many-0'))"));
  h.run("S.share={ids:['many-0'],semua:"+JSON.stringify(many.map(o=>o.id)) +",scope:commerceScope(),key:wanted};commerceData('pembelian').orders=commerceData('pembelian').orders.filter(o=>o.id!=='many-20');");assert.doesNotThrow(()=>h.run('A.commerceShareMode('+actionEl({'data-mode':'semua'})+')'));assert.match(h.json('messages').at(-1).text,/Order berubah/);
});

test('invoice picker never selects another invoice, even under the same supplier and label',()=>{
  const h=harness();seed(h,[order('a','one'),order('b','one',{status:'selesai',balance:0}),order('c','two')]);h.run("var dollar=$;$=function(s,f){if(s==='[data-commerce-group-list]')return f.groupList;if(s==='[data-commerce-group-total]')return f.groupTotal;return dollar(s,f);};currentForm.groupList={};currentForm.groupTotal={};A.commerceGroupOpen(null)");
  assert.deepEqual(h.json('currentForm._commerceGroupIds'),['a','b']);assert.match(h.run('currentForm.groupList.innerHTML'),/data-id="a"/);assert.ok(!h.run('currentForm.groupList.innerHTML').includes('data-id="c"'));
  h.run("var rejected={checked:true,getAttribute:function(){return 'c';},closest:function(){return currentForm;}};C.commerceGroupSelect(rejected)");assert.equal(h.run('rejected.checked'),false);assert.deepEqual(h.json('currentForm._commerceGroupIds'),['a','b']);
  h.run("currentForm._commerceGroupIds=['a','c']");assert.throws(()=>h.run('commerceGroupFormRows(currentForm)'),/satu invoice/);
  h.run("currentForm.values.invoice=commerceInvoiceKey(commerceFind('pembelian','orders','c'));C.commerceGroupSupplier({value:currentForm.values.invoice,closest:function(){return currentForm;}})");assert.deepEqual(h.json('currentForm._commerceGroupIds'),['c']);assert.ok(!h.run('currentForm.groupList.innerHTML').includes('data-id="a"'));
  h.run("currentForm.values={};A.commerceGroupOpen({getAttribute:function(k){return k==='data-invoice'?commerceInvoiceKey(commerceFind('pembelian','orders','a')):null;}})");assert.deepEqual(h.json('currentForm._commerceGroupRows.map(o=>o.id)'),['a','b']);
});

test('starting another invoice retains supplier only, while later save never joins an old open invoice merely by supplier',()=>{
  const h=harness();seed(h,[order('a','one'),order('b','one'),order('new','two')]);h.seed('pembelian',{...h.json("commerceData('pembelian')"),suppliers:[{id:'supplier-a',nama:'Supplier A'}]});
  h.run('A.commerceOrderOpen('+actionEl({'data-tambah':'1','data-supplier':'supplier-a','data-grup':'OLD','data-tanggal':'2025-01-01'})+')');assert.match(h.run('lastSheet'),/name="grupNama"[^>]*value=""/);assert.match(h.run('lastSheet'),/name="tanggalOrder"[^>]*value="2026-10-08"/);assert.match(h.run('lastSheet'),/<option value="supplier-a" selected/);
  h.run("commerceInvoiceShow(['a','b']);var shown=[];commerceShareShow=function(ids){shown.push(ids);};commerceAfterSave({action:'saveCommerceOrder',payload:{record:{id:'new'}}},{record:commerceFind('pembelian','orders','new')})");assert.deepEqual(h.json('S.invoice.ids'),['a','b']);assert.deepEqual(h.json('shown'),[['new']]);
  h.run("commerceAfterSave({action:'saveCommerceOrderBatch',payload:{orders:[{id:'new'}]}},{orderIds:['new']})");assert.deepEqual(h.json('shown').at(-1),['new']);
});

test('a formerly copied unnamed legacy order opens its new identity without leaving an empty old invoice',()=>{
  const h=harness();seed(h,[order('old','',{grupNama:''}),order('copied','',{grupNama:''})]);h.run("commerceInvoiceShow(['old']);commerceAfterSave({action:'salinCommerceOrderLama',payload:{orderId:'old'}},{record:commerceFind('pembelian','orders','copied')})");assert.deepEqual(h.json('S.invoice.ids'),['copied']);assert.equal(h.run('S.invoice.key'),h.run("commerceInvoiceKey(commerceFind('pembelian','orders','copied'))"));assert.match(h.run('lastSheet'),/Model copied/);
});

test('historical payment spanning invoices stays fully scoped for correction and deletion, while invoice totals show only its share',()=>{
  const h=harness(),payment=(id,amount)=>({id,kind:'payment',groupId:'old-group',tanggal:'2026-10-10',metode:'transfer',jumlah:amount,catatan:'Lama'}),a=order('a','one',{totalPaid:300,balance:700,payments:[payment('pa',300)],events:[payment('pa',300)]}),b=order('b','two',{totalPaid:200,balance:800,payments:[payment('pb',200)],events:[payment('pb',200)]});seed(h,[a,b]);const before=h.json("commerceData('pembelian').orders");h.run("commerceInvoiceShow(['a'])");assert.match(h.run('lastSheet'),/Sudah dibayar \(DP\)<\/dt><dd class="b">Rp300/);assert.match(h.run('lastSheet'),/pembayaran lintas invoice/);
  const el=actionEl({'data-m':'pembelian','data-id':'a','data-event':'pa'});h.run('A.commerceEventEdit('+el+')');assert.match(h.run('lastSheet'),/Pembayaran lama mencakup 2 invoice/);assert.match(h.run('lastSheet'),/Rp500/);assert.deepEqual(h.json('currentForm._commerceGrup.map(g=>g.order.id)'),['a','b']);
  h.form({id:'correction',groupId:'old-group',jenis:'grup',tanggal:'2026-10-10',jumlah:'400',metode:'transfer',catatan:'koreksi'},'pembelian');h.run('A.commerceEventEditSave(null)');assert.equal(h.requests[0].action,'gantiCommerceGroupPayment');assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].payload.expectedRevisions)),{a:'rev-a',b:'rev-b'});
  h.run('A.commerceInvoiceHapus('+el+')');assert.match(h.run('lastSheet'),/Pembayaran lama mencakup 2 invoice/);assert.deepEqual(h.json('currentForm._commerceHapus.rev'),{a:'rev-a',b:'rev-b'});assert.deepEqual(h.json("commerceData('pembelian').orders"),before,'opening or preparing a correction never rewrites or reassigns old payments');
});

function shareHarness(){
  const h=harness();seed(h,[order('a','one'),order('b','one'),order('other','two')]);
  h.run("var photos=[],drawn=[],blobs=[],revoked=[],URL={createObjectURL:function(b){return 'blob:'+b.id;},revokeObjectURL:function(u){revoked.push(u);}};commerceSharePhotos=function(){return new Promise(function(resolve,reject){photos.push({resolve:resolve,reject:reject});});};commerceShareDraw=function(model){drawn.push(model);return {toBlob:function(done){blobs.push(done);}};};");
  return h;
}

test('the latest share mode wins when older photo work finishes last, and its image retains the invoice label',async()=>{
  const h=shareHarness();h.run("commerceShareShow(['a'],false)");h.run('A.commerceShareMode('+actionEl({'data-mode':'semua'})+')');
  h.run('photos[1].resolve({})');await turn();h.run("blobs[0]({id:'latest'})");h.run('photos[0].resolve({})');await turn();
  assert.deepEqual(h.json('drawn.map(m=>m.orders.map(o=>o.id))'),[['a','b']]);assert.equal(h.run('drawn[0].invoiceLabel'),'SLD003');assert.equal(h.run('drawn[0].judul'),'SLD003 · 2 model');assert.equal(h.run('S.share.blob.id'),'latest');assert.equal(h.run('S.share.url'),'blob:latest');assert.equal(h.run('S.share.gagal'),'');assert.equal(h.requests.length,0);
});

test('a canvas callback from an older share mode cannot overwrite or revoke the newest image',async()=>{
  const h=shareHarness();h.run("commerceShareShow(['a'],false);photos[0].resolve({})");await turn();
  h.run('A.commerceShareMode('+actionEl({'data-mode':'semua'})+');photos[1].resolve({})');await turn();h.run("blobs[1]({id:'latest'});blobs[0]({id:'older'})");
  assert.deepEqual(h.json('drawn.map(m=>m.orders.map(o=>o.id))'),[['a'],['a','b']]);assert.equal(h.run('S.share.blob.id'),'latest');assert.equal(h.run('S.share.url'),'blob:latest');assert.deepEqual(h.json('revoked'),[]);
});

test('a superseded share error and callbacks from another session cannot change the current image',async()=>{
  const h=shareHarness();h.run("commerceShareShow(['a'],false)");h.run('A.commerceShareMode('+actionEl({'data-mode':'semua'})+');photos[1].resolve({})');await turn();h.run("blobs[0]({id:'latest'});photos[0].reject(new Error('old job failed'))");await turn();
  assert.equal(h.run('S.share.gagal'),'');assert.equal(h.run('S.share.blob.id'),'latest');
  h.run("commerceShareBuild();S.token='another-session';photos[2].reject(new Error('prior session failed'))");await turn();assert.equal(h.run('S.share.gagal'),'');assert.equal(h.run('S.share.blob.id'),'latest');
});

test('download names distinguish invoices of one supplier on the same date and safely include their label',()=>{
  const h=shareHarness();h.run("commerceFind('pembelian','orders','a').grupNama='Invoice / Baru: 002';commerceShareShow(['a'],false)");const first=h.run('S.share.nama');assert.equal(first,'invoice-invoice-baru-002-one-2026-10-08.png');
  h.run("commerceFind('pembelian','orders','other').grupNama='Invoice / Baru: 002';commerceShareShow(['other'],false)");assert.equal(h.run('S.share.nama'),'invoice-invoice-baru-002-two-2026-10-08.png');assert.notEqual(h.run('S.share.nama'),first);assert.equal(h.requests.length,0);
});

