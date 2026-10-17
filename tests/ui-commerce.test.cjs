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
  const unitStart=html.indexOf('function satuanPendek('),unitEnd=html.indexOf('/* bahan yang dipakai',unitStart);assert.ok(unitStart>=0&&unitEnd>unitStart,'actual unit helper exists');vm.runInContext(html.slice(unitStart,unitEnd),context);
  const helperStart=html.indexOf('function fTanggal('),helperEnd=html.indexOf('/* ---------- hitungan PO',helperStart);vm.runInContext(html.slice(helperStart,helperEnd),context);vm.runInContext(block,context);
  const run=code=>vm.runInContext(code,context);const json=code=>JSON.parse(run('JSON.stringify('+code+')'));
  function seed(module,data){run(`var e=commerceEntry(${JSON.stringify(module)});e.data=${JSON.stringify(data)};e.version=10;e.tried=true;`);}
  function form(values,module,rows=[]){run(`currentForm.values=${JSON.stringify(values)};currentForm.module=${JSON.stringify(module)};currentForm._commerceScope=commerceScope();currentForm.rows=${JSON.stringify(rows)}.map(function(r){return {values:r.values,getAttribute:function(){return r.id;}};});`);}
  return {context,requests,run,json,seed,form};
}
function reply(module,data,version=10){return {module,actor:{id:'owner',divisi:'owner'},version,...data};}
const turn=()=>new Promise(r=>setImmediate(r));

test('purchase totals use server paid/balance only and never confidently sum held or cancelled orders',()=>{
 const h=harness();h.seed('pembelian',{orders:[{id:'a',status:'dp',totalHarga:10000,totalPaid:3000,balance:7000,dp:999999,payments:[{jumlah:999999}]},{id:'b',status:'lunas',totalHarga:5000,totalPaid:5000,balance:0},{id:'held',status:'review',paymentReview:true,totalHarga:700,totalPaid:0,balance:0},{id:'cancel',status:'batal',totalHarga:90000,totalPaid:90000,balance:0}]});
 assert.deepEqual(h.json("commercePurchaseTotals(commerceData('pembelian').orders)"),{total:15000,paid:8000,balance:7000,count:2,review:1,cancelled:1});
 const markup=h.run("commerceOrderKpi(commerceData('pembelian').orders)");assert.match(markup,/DP \/ sudah dibayar/);assert.match(markup,/Rp8000/);assert.match(markup,/1 order perlu diperiksa dan belum dijumlahkan/);assert.ok(!markup.includes('999999'));
 assert.match(h.run("commercePurchaseSummaryHtml([commerceRecord('pembelian','held')])"),/Perlu diperiksa/);
});
test('payment history keeps settled and corrected evidence, groups only by group ID, and escapes text',()=>{
 const h=harness(),base={status:'lunas',totalHarga:500,totalPaid:500,balance:0,productName:'Topi',totalQty:1,totalReceived:1,items:[],events:[]};
 h.seed('pembelian',{orders:[{...base,id:'a',payments:[{id:'a1',tanggal:'2026-10-10',jumlah:300,groupId:'group-old',voided:true,catatan:'<img src=x onerror=bad>'},{id:'a2',tanggal:'2026-10-11',jumlah:300,groupId:'group-new'},{id:'a3',tanggal:'2026-10-11',jumlah:200,catatan:'same'}]},{...base,id:'b',payments:[{id:'b1',tanggal:'2026-10-10',jumlah:200,groupId:'group-old',voided:true},{id:'b2',tanggal:'2026-10-11',jumlah:200,groupId:'group-new'},{id:'b3',tanggal:'2026-10-11',jumlah:300,catatan:'same'}]}]});
 const rows=h.json("commerceInvoiceBayar(commerceData('pembelian').orders,true)");assert.equal(rows.length,4);const old=rows.find(r=>r.groupId==='group-old'),now=rows.find(r=>r.groupId==='group-new');assert.equal(old.recorded,500);assert.equal(old.active,0);assert.equal(old.voided,true);assert.equal(now.active,500);assert.equal(now.model.length,2);assert.equal(rows.filter(r=>!r.groupId).length,2,'same date/note do not merge distinct payments');
 const markup=h.run("commerceRiwayatBayar(commerceData('pembelian').orders)");assert.match(markup,/Total dibayar <b>Rp1000/);assert.match(markup,/Dikoreksi — tidak dihitung/);assert.match(markup,/&lt;img/);assert.ok(!markup.includes('<img src=x'));
 const card=h.run("commerceOrderCard(commerceRecord('pembelian','a'))");assert.match(card,/Riwayat \/ rincian/);assert.ok(!card.includes('data-a="commercePaymentOpen"'),'fully paid order keeps history without a new payment button');
});
test('group DP opens blank, shows each balance and previews partial versus full payment without writes',()=>{
 const h=harness();h.seed('pembelian',{orders:[{id:'a',revision:'ra',invoiceId:'one-invoice',status:'dp',productName:'A',totalHarga:10000,totalPaid:3000,balance:7000},{id:'b',revision:'rb',invoiceId:'one-invoice',status:'dp',productName:'B',totalHarga:5000,totalPaid:1000,balance:4000}]});
 h.run("var originalDollar=$;$=function(sel,f){return sel==='[data-commerce-group-payment-preview]'?f.preview:originalDollar(sel,f);};currentForm.preview={textContent:''};A.commerceGroupPayOpen({getAttribute:function(k){return k==='data-ids'?'a,b':'Supplier';}})");
 const body=h.run('lastSheet');assert.match(body,/name="jumlah" value=""/);assert.match(body,/Total Rp10000 · sudah dibayar Rp3000/);assert.match(body,/Total Rp5000 · sudah dibayar Rp1000/);assert.match(h.run('currentForm.preview.textContent'),/Rp11000/);
 h.run("currentForm.values={jumlah:'2000'};R.commerce(currentForm)");assert.match(h.run('currentForm.preview.textContent'),/Pembayaran sebagian Rp2000 · Sisa setelah pembayaran Rp9000/);
 h.run("currentForm.values.jumlah='11000';R.commerce(currentForm)");assert.match(h.run('currentForm.preview.textContent'),/Pelunasan Rp11000 · Sisa setelah pembayaran Rp0/);
 h.run("currentForm.values.jumlah='11001';R.commerce(currentForm)");assert.match(h.run('currentForm.preview.textContent'),/melebihi/);assert.equal(h.requests.length,0);
});
test('editing a model from its group refreshes the same invoice and never creates another order or payment',async()=>{
 const h=harness(),o={id:'old1',revision:'r1',legacy:true,status:'dp',produkId:'p1',productName:'Topi',supplierSnapshot:{id:'s1'},supplierName:'Supplier',grupNama:'Invoice',tanggalOrder:'2026-10-01',items:[{id:'i1',nama:'M',jumlah:5}],hargaSatuan:1000,totalQty:5,totalReceived:0,totalHarga:5000,totalPaid:1000,balance:4000,payments:[{id:'dp1',jumlah:1000}],events:[]},other={...o,id:'o2',revision:'r2',legacy:false,totalPaid:0,balance:5000,payments:[]};
 h.seed('pembelian',{suppliers:[],products:[],orders:[o,other]});h.run("commerceInvoiceShow(['old1','o2']);A.commerceOrderOpen({getAttribute:function(){return 'old1';}})");
 h.form({id:'old1',revision:'r1',produkId:'p1',hargaSatuan:'1200',tanggalOrder:'2026-10-02',grupNama:'Invoice',catatan:'Koreksi'},'pembelian',[{id:'i1',values:{lineName:'M',lineQty:'5'}}]);
 const saving=h.run('A.commerceOrderSave(null)'),changed={...o,revision:'r3',hargaSatuan:1200,totalHarga:6000,balance:5000,orderEditCount:1};assert.equal(h.requests.length,1);assert.equal(h.requests[0].action,'saveCommerceOrder');assert.equal(h.requests[0].payload.record.initialPayment,undefined);
 h.requests[0].resolve({record:changed,commerce:reply('pembelian',{suppliers:[],products:[],orders:[changed,other]},11)});await saving;
 assert.deepEqual(h.json('S.invoice.ids'),['old1','o2']);assert.equal(h.run('drops'),1);assert.equal(h.requests.length,1);assert.equal(h.run('commerceData("pembelian").orders.length'),2);assert.match(h.run('commerceInvoiceHtml()'),/Total<\/dt><dd class="b">Rp11000/);assert.match(h.run('commerceInvoiceHtml()'),/Sudah dibayar \(DP\)<\/dt><dd class="b">Rp1000/);assert.match(h.run('commerceInvoiceHtml()'),/data-a="commerceOrderOpen" data-id="old1">Edit/);assert.match(h.run('commerceInvoiceHtml()'),/data-a="commerceTambahModel"/);
});

test('dashboard cards do not fetch commerce or include commerce in login',()=>{
  const h=harness(),markup=h.run('commerceHomeCards()');assert.equal(h.requests.length,0);for(const title of ['HPP produk','Pembelian produk','Nota penjualan'])assert.match(markup,new RegExp(title));
  assert.match(html,/berandaCatatan\(\)[^\n]+commerceHomeCards\(\)/);assert.ok(!html.slice(html.indexOf('function beginSessionLoad'),html.indexOf('function beginSessionLoad')+2500).includes('getCommerceState'));
});
test('first view lazily requests only its module and coalesces concurrent taps',async()=>{
  const h=harness();const first=h.run("commerceFetch('pembelian',false)"),second=h.run("commerceFetch('pembelian',true)");assert.equal(first,second);assert.equal(h.requests.length,1);assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].payload)),{module:'pembelian'});h.requests[0].resolve(reply('pembelian',{suppliers:[],products:[],orders:[]}));await first;assert.equal(h.run("commerceData('pembelian').orders.length"),0);assert.equal(h.run("commerceEntry('nota').tried"),false);
});
test('late commerce data cannot survive logout, role change, or another account',async()=>{
  for(const change of ["S.token='other'","S.state.me={id:'owner',divisi:'admin'}","S.state.me={id:'other',divisi:'owner'}"]){const h=harness(),p=h.run("commerceFetch('nota')");h.run(change);h.requests[0].resolve(reply('nota',{notes:[{id:'private'}]}));await assert.rejects(p,/Sesi/);assert.equal(h.run("commerceData('nota').notes"),undefined);}
});
test('wrong actor or incomplete reply does not become ready',async()=>{
  for(const result of [{module:'nota',actor:{id:'other',divisi:'owner'},notes:[],version:1},{module:'nota',actor:{id:'owner',divisi:'owner'},version:1}]){const h=harness(),p=h.run("commerceFetch('nota')");h.requests[0].resolve(result);await assert.rejects(p,/belum lengkap/);assert.equal(h.run("commerceEntry('nota').data"),null);}
});
test('a pre-write lazy read cannot overwrite the post-write snapshot',async()=>{
  const h=harness(),old=h.run("commerceFetch('nota')");h.run("commerceInvalidate('nota')");const newer=h.run("commerceFetch('nota',true)");h.requests[1].resolve(reply('nota',{notes:[{id:'saved'}]},12));await newer;h.requests[0].resolve(reply('nota',{notes:[]},11));await assert.rejects(old,/data berubah/);assert.equal(h.run("commerceData('nota').notes[0].id"),'saved');assert.equal(h.run("commerceEntry('nota').version"),12);
});
test('financial uncertainty freezes the same intent, performs no automatic retry, and verifies by event ID',async()=>{
  const h=harness();h.seed('nota',{notes:[{id:'n',revision:'before',events:[]}]});h.form({},'nota');const p=h.run("commerceMutation('nota','appendCommercePayment',{id:'payment-fixed',module:'nota',parentId:'n',expectedRevision:'before',tanggal:'2026-10-08',jumlah:50,metode:'cash'},currentForm,null)");h.requests[0].reject(Object.assign(new Error('Connection lost'),{uncertain:true}));await p;assert.equal(h.requests.length,1);assert.equal(h.run('currentForm._commerceLocked'),true);assert.equal(h.run('currentForm._commerceIntent.payload.id'),'payment-fixed');
  const check=h.run("A.commerceCheck({closest:function(){return currentForm;}})");h.requests[1].resolve(reply('nota',{notes:[{id:'n',revision:'after',payments:[{id:'payment-fixed',jumlah:50}]}]},11));await check;assert.equal(h.run('drops'),1);assert.equal(h.requests.length,2);
});
test('a write success triggers one fresh commerce read even when an older read is running',async()=>{
  const h=harness();h.form({},'nota');const old=h.run("commerceFetch('nota')"),save=h.run("commerceMutation('nota','saveCommerceNota',{record:{id:'fixed'}},currentForm,null)");h.requests[1].resolve({record:{id:'fixed'}});await turn();assert.equal(h.requests.length,3);assert.equal(h.requests[2].action,'getCommerceState');h.requests[2].resolve(reply('nota',{notes:[{id:'fixed'}]},12));await save;h.requests[0].resolve(reply('nota',{notes:[]},11));await assert.rejects(old);assert.equal(h.run("commerceData('nota').notes[0].id"),'fixed');assert.equal(h.run('drops'),1);
});
test('a save answer that carries the refreshed page needs no second request and still outranks an older read',async()=>{
  const h=harness();h.form({},'nota');const old=h.run("commerceFetch('nota')"),save=h.run("commerceMutation('nota','saveCommerceNota',{record:{id:'fixed'}},currentForm,null)");
  assert.equal(h.requests[1].payload.withState,true);assert.equal(h.run('currentForm._commerceIntent.payload.withState'),undefined,'the kept intent stays exactly what the form sent');
  h.requests[1].resolve({record:{id:'fixed'},commerce:reply('nota',{notes:[{id:'fixed'}]},12)});await save;
  assert.equal(h.requests.length,2,'no second request');assert.equal(h.run('drops'),1);assert.equal(h.run("commerceData('nota').notes[0].id"),'fixed');assert.equal(h.run("commerceEntry('nota').version"),12);
  h.requests[0].resolve(reply('nota',{notes:[]},11));await assert.rejects(old);assert.equal(h.run("commerceData('nota').notes[0].id"),'fixed');
  assert.equal(JSON.parse(h.run("kv.pks_cm_nota_pusat.s")).notes[0].id,'fixed','the device copy follows the saved page');
});
test('a save answer with a foreign or incomplete page falls back to one fresh read; HPP never asks for a page in the answer',async()=>{
  for(const page of [{module:'nota',actor:{id:'other',divisi:'owner'},notes:[],version:12},{module:'pembelian',actor:{id:'owner',divisi:'owner'},orders:[],version:12}]){
    const h=harness();h.form({},'nota');const save=h.run("commerceMutation('nota','saveCommerceNota',{record:{id:'fixed'}},currentForm,null)");h.requests[0].resolve({record:{id:'fixed'},commerce:page});await turn();
    assert.equal(h.requests.length,2);assert.equal(h.requests[1].action,'getCommerceState');h.requests[1].resolve(reply('nota',{notes:[{id:'fixed'}]},12));await save;assert.equal(h.run('drops'),1);
  }
  const h=harness();h.form({},'hpp');h.run("commerceMutation('hpp','saveCommerceHppSettings',{pajak:1},currentForm,null)");assert.equal(h.requests[0].payload.withState,undefined);
});
test('lists mark product photos for separate loading, never fetch them inline, and refuse unsafe picture text',()=>{
  const h=harness(),marked=h.run("commerceThumb({id:'p1',nama:'Kaos Polos',revision:'abcdef0123456789ffff',hasPicture:true})");
  assert.match(marked,/data-img="cm\.p1"/);assert.match(marked,/data-ver="abcdef0123456789"/);assert.ok(!marked.includes('background-image'));
  assert.ok(!h.run("commerceThumb({id:'p2',nama:'Tanpa foto',revision:'abcdef0123456789'})").includes('data-img'));assert.ok(!h.run("commerceThumb(null,'Produk terhapus')").includes('data-img'));
  assert.match(h.run("commerceThumb({gambar:'data:image/jpeg;base64,AAAA'},'Baru','l')"),/class="thumb l has" style="background-image:url\(&quot;data:image\/jpeg;base64,AAAA&quot;\)"/);
  for(const unsafe of ["javascript:alert(1)","data:image/svg+xml;base64,AAAA","data:image/png;base64,AA\"onload=\"x"])assert.ok(!h.run("commerceThumb({gambar:"+JSON.stringify(unsafe)+"},'X')").includes('background-image'));
  h.seed('pembelian',{suppliers:[],products:[{id:'p1',nama:'Kaos Polos',revision:'abcdef0123456789ffff',hasPicture:true}],orders:[{id:'o1',produkId:'p1',productName:'Kaos Polos',tanggalOrder:'2026-10-08',items:[{id:'a',nama:'M',jumlah:2}],totalHarga:10,balance:10,totalReceived:0,events:[]}]});
  h.run("S.listFn=null;S.sub.commercePurchase='orders';var orderPage=VIEWS['pembelian-produk']();S.sub.commercePurchase='products';var productPage=VIEWS['pembelian-produk']();");
  assert.match(h.run('orderPage'),/data-a="commerceInvoiceOpen" data-ids="o1">Buka invoice/);h.run("commerceInvoiceShow(['o1'])");assert.match(h.run('lastSheet'),/<span class="thumb" data-img="cm\.p1" data-ver="abcdef0123456789"/);assert.match(h.run('productPage'),/data-kind="products"[^>]*><span class="thumb" data-img="cm\.p1"/);
  assert.match(h.run("commerceDetail('pembelian','o1')"),/<span class="thumb l" data-img="cm\.p1"/);assert.equal(h.requests.length,0);
});
test('a saved product keeps its photo on the device under the new revision without another download',()=>{
  const h=harness();h.run("currentForm._commerceIntent={action:'saveCommerceProduct',payload:{record:{id:'p1',gambar:'data:image/jpeg;base64,NEW'}}};commerceKeepPicture(currentForm,{record:{id:'p1',revision:'1111111111111111aaaa',hasPicture:true}});");
  assert.deepEqual(h.json("S.img['cm.p1']"),{ver:'1111111111111111',data:'data:image/jpeg;base64,NEW'});assert.equal(h.run("kv['cm.p1']"),'1111111111111111|data:image/jpeg;base64,NEW');
  /* renamed only: the photo the form was opened with moves to the new revision */
  h.run("currentForm._commerceOriginal={revision:'1111111111111111aaaa'};currentForm._commerceIntent={action:'saveCommerceProduct',payload:{record:{id:'p1'}}};commerceKeepPicture(currentForm,{record:{id:'p1',revision:'2222222222222222bbbb',hasPicture:true}});");
  assert.deepEqual(h.json("S.img['cm.p1']"),{ver:'2222222222222222',data:'data:image/jpeg;base64,NEW'});
  /* a photo cached for some other revision is never relabelled */
  h.run("currentForm._commerceOriginal={revision:'9999999999999999cccc'};commerceKeepPicture(currentForm,{record:{id:'p1',revision:'3333333333333333dddd',hasPicture:true}});");
  assert.equal(h.run("S.img['cm.p1'].ver"),'2222222222222222');
});
test('the device copy opens the page at once for the same session only, and any server answer replaces it',async()=>{
  const copy=JSON.stringify({suppliers:[],products:[],orders:[{id:'from-device'}]});
  const h=harness();h.run(`kv.pks_cm_pembelian_pusat={t:'session-one',a:'owner',ui:'ui-test',at:5,v:40,s:${JSON.stringify(copy)}};`);
  const p=h.run("S.tab='pembelian-produk';commerceFetch('pembelian',false)");assert.equal(h.requests.length,1,'the server is still asked');assert.equal(h.run("commerceData('pembelian').orders[0].id"),'from-device');
  assert.match(h.run("commerceLoadView('pembelian','Pembelian produk','x',function(){return 'LIST';})"),/data terakhir di perangkat[\s\S]*LIST/);
  h.requests[0].resolve(reply('pembelian',{suppliers:[],products:[],orders:[{id:'from-server'}]},12));await p;
  assert.equal(h.run("commerceData('pembelian').orders[0].id"),'from-server','a lower server version still replaces a device copy');assert.equal(h.run("commerceEntry('pembelian').lama"),0);assert.equal(JSON.parse(h.run('kv.pks_cm_pembelian_pusat.s')).orders[0].id,'from-server');
  for(const stored of [{t:'someone-else',a:'owner',ui:'ui-test'},{t:'session-one',a:'other',ui:'ui-test'},{t:'session-one',a:'owner',ui:'older-ui'}]){
    const x=harness();x.run(`kv.pks_cm_pembelian_pusat=Object.assign({at:5,v:40,s:${JSON.stringify(copy)}},${JSON.stringify(stored)});commerceFetch('pembelian',false).catch(function(){});`);assert.equal(x.run("commerceEntry('pembelian').data"),null);
  }
  const offline=harness();offline.run(`kv.pks_cm_pembelian_pusat={t:'session-one',a:'owner',ui:'ui-test',at:5,v:40,s:${JSON.stringify(copy)}};`);const failed=offline.run("commerceFetch('pembelian',false)");offline.requests[0].reject(new Error('Server tidak bisa dihubungi.'));await assert.rejects(failed);
  assert.match(offline.run("commerceLoadView('pembelian','Pembelian produk','x',function(){return 'LIST';})"),/belum diperbarui dari pusat[\s\S]*LIST/);
  const hpp=harness();hpp.run("kv.pks_cm_hpp_pusat={t:'session-one',a:'owner',ui:'ui-test',at:5,v:1,s:'{\"models\":[]}'};commerceFetch('hpp',false).catch(function(){});");assert.equal(hpp.run("commerceEntry('hpp').data"),null,'HPP is never opened from a device copy');
});
test('the order list follows the earlier app: four totals, variants and paid amount per card, and quick actions only where allowed',()=>{
  const h=harness(),base={produkId:'p1',productName:'Kaos',productSnapshot:{model:'Oversize',warna:'Hitam'},supplierName:'Supplier A',tanggalOrder:'2026-10-08',hargaSatuan:1000,items:[{id:'a',nama:'M',jumlah:6},{id:'b',nama:'L',jumlah:4}],totalQty:10,totalHarga:10000,events:[]};
  const orders=[{...base,id:'open',status:'dp',totalPaid:4000,balance:6000,totalReceived:3},{...base,id:'done',status:'selesai',totalPaid:10000,balance:0,totalReceived:10},{...base,id:'cancelled',status:'batal',totalPaid:0,balance:10000,totalReceived:0},{...base,id:'held',status:'review',needsReview:true,paymentReview:true,receiptReview:true,totalPaid:99999,balance:0,totalReceived:2}];
  h.seed('pembelian',{suppliers:[],products:[],orders});
  const kpi=h.run("commerceOrderKpi(commerceData('pembelian').orders)");
  assert.match(kpi,/Order aktif<\/span><span class="v">2</);assert.match(kpi,/Belum bayar<\/span><span class="v money">Rp6000</,'cancelled and held amounts are not added');assert.match(kpi,/di luar 1 order yang perlu diperiksa/);assert.match(kpi,/Sudah diterima<\/span><span class="v">15</);assert.match(kpi,/Belum diterima<\/span><span class="v">15</);
  const card=id=>h.run("commerceOrderCard(commerceFind('pembelian','orders',"+JSON.stringify(id)+"))");
  const open=card('open');assert.match(open,/Kaos Oversize Hitam/);assert.match(open,/\(2 varian\)/);assert.match(open,/M \(6\), L \(4\)/);assert.match(open,/Diterima 3\/10 pcs · Sisa 7 pcs/);assert.match(open,/Dibayar Rp4000/);assert.match(open,/Sisa Rp6000/);
  assert.match(open,/data-a="commercePaymentOpen" data-m="pembelian" data-id="open">Tambah DP \/ pembayaran/);assert.match(open,/data-a="commerceReceiptOpen" data-m="pembelian" data-id="open">Terima/);
  for(const id of ['done','cancelled','held']){const c=card(id);assert.ok(!c.includes('commercePaymentOpen'),id+' offers no payment');assert.ok(!c.includes('commerceReceiptOpen'),id+' offers no receipt');}
  h.run("S.listFn=null;S.sub.commercePurchase='orders';var listed=VIEWS['pembelian-produk']();");assert.match(h.run('listed'),/class="grid g-kpi"[\s\S]*class="cgroup"/);assert.match(h.run('listed'),/data-a="commerceInvoiceOpen" data-ids="open"/);
  h.run("S.sub.commercePurchase='products';var masters=VIEWS['pembelian-produk']();");assert.ok(!h.run('masters').includes('g-kpi'));
});
const shopOrders=()=>{const base={invoiceId:'fixture-invoice',produkId:'p1',productName:'Kaos',supplierName:'Supplier A',supplierSnapshot:{id:'s1'},tanggalOrder:'2026-10-08',hargaSatuan:1000,items:[{id:'a',nama:'M',jumlah:6},{id:'b',nama:'L',jumlah:4}],totalQty:10,totalHarga:10000,events:[],payments:[],receivedByItem:{}};
  return [{...base,id:'o1',revision:'r1',status:'dp',totalPaid:4000,balance:6000,totalReceived:6,receivedByItem:{a:6},payments:[{id:'x1',tanggal:'2026-10-08',jumlah:3000,catatan:'DP'},{id:'x2',tanggal:'2026-10-08',jumlah:1000,catatan:'DP'},{id:'x3',tanggal:'2026-10-09',jumlah:500,catatan:'salah',voided:true}]},{...base,id:'o2',revision:'r2',produkId:'p2',productName:'Topi',status:'pending',totalPaid:0,balance:10000,totalReceived:0},{...base,id:'o3',revision:'r3',status:'batal',totalPaid:0,balance:10000,totalReceived:0},{...base,id:'o4',revision:'r4',tanggalOrder:'2026-10-01',status:'pending',totalPaid:0,balance:10000,totalReceived:0},{...base,id:'o5',revision:'r5',supplierSnapshot:{id:'s2'},supplierName:'Supplier B',status:'review',needsReview:true,paymentReview:true,receiptReview:true,totalPaid:0,balance:0,totalReceived:3}];};
test('models keep one invoice across dates and the compact card opens only its active members',()=>{
  const h=harness();h.seed('pembelian',{suppliers:[{id:'s1',nama:'Supplier A',kontak:'0811',alamat:'Bandung'}],products:[],orders:shopOrders()});
  const groups=h.json("commerceOrderGroups(commerceData('pembelian').orders).map(function(g){return g.orders.map(function(o){return o.id;});})");assert.deepEqual(groups,[['o1','o2','o3','o4'],['o5']]);
  h.run("S.listFn=null;S.sub.commercePurchase='orders';var grouped=VIEWS['pembelian-produk']();");const page=h.run('grouped');
  assert.equal((page.match(/class="cgroup"/g)||[]).length,2);assert.match(page,/data-a="commerceInvoiceOpen" data-ids="o1,o2,o4"/,'active members of the invoice stay together; cancelled member stays out');assert.ok(!page.includes('data-a="commerceGroupPayOpen"'),'payment lives inside the invoice page');assert.ok(!page.includes('data-a="commerceShareOpen"'));assert.match(page,/3 model · 2026-10-01 – 2026-10-08/);assert.match(page,/Diterima 6\/30 pcs · Sisa 24 pcs/);assert.match(page,/Total Rp30000/);assert.match(page,/Sisa Rp26000/);
  h.run("commerceInvoiceShow(['o1','o2','o4'])");assert.match(h.run('lastSheet'),/data-a="commerceGroupPayOpen" data-ids="o1,o2,o4"/,'held amounts still cannot enter the payment group');
  h.run("var named=commerceData('pembelian').orders.map(function(o){return Object.assign({},o);});named[0].grupNama='Paket Topi';named[3].grupNama='Paket Topi';");assert.deepEqual(h.json("commerceOrderGroups(named).map(function(g){return g.orders.map(function(o){return o.id;});})"),[['o1','o2','o3','o4'],['o5']]);
});
test('group payment sends one stable request with every order revision and never more than the group still owes',()=>{
  const h=harness();h.seed('pembelian',{suppliers:[],products:[],orders:shopOrders()});const el=ids=>`{getAttribute:function(k){return k==='data-ids'?${JSON.stringify(ids)}:'Supplier A';}}`;
  h.run(`A.commerceGroupPayOpen(${el('o1,o3')})`);assert.match(h.json('messages').at(-1).text,/tidak ada dua order/);
  h.run(`A.commerceGroupPayOpen(${el('o1,o2,o3')})`);assert.match(h.run('lastSheet'),/Bayar invoice — /);assert.match(h.run('lastSheet'),/Supplier: Supplier A/);assert.match(h.run('lastSheet'),/2 order/);assert.deepEqual(h.json('currentForm._commerceGroupOrders'),[{id:'o1',revision:'r1',balance:6000},{id:'o2',revision:'r2',balance:10000}]);
  h.run("currentForm.values={id:'gp1',tanggal:'2026-10-09',jumlah:'16001',metode:'transfer',catatan:' lunas '};currentForm.module='pembelian';currentForm._commerceScope=commerceScope();A.commerceGroupPaySave(null)");assert.equal(h.requests.length,0);assert.match(h.json('messages').at(-1).text,/melebihi sisa/);
  h.run("currentForm.values.jumlah='9000';A.commerceGroupPaySave(null)");assert.equal(h.requests.length,1);assert.equal(h.requests[0].action,'appendCommerceGroupPayment');
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].payload)),{id:'gp1',module:'pembelian',orderIds:['o1','o2'],expectedRevisions:{o1:'r1',o2:'r2'},tanggal:'2026-10-09',jumlah:9000,metode:'transfer',catatan:'lunas',withState:true});
});
test('an uncertain group payment is recognised by its group ID before any retry is offered',async()=>{
  const h=harness();h.seed('pembelian',{suppliers:[],products:[],orders:shopOrders()});h.form({},'pembelian');
  const p=h.run("commerceMutation('pembelian','appendCommerceGroupPayment',{id:'gp1',module:'pembelian',orderIds:['o1','o2'],expectedRevisions:{o1:'r1',o2:'r2'},tanggal:'2026-10-09',jumlah:9000,metode:'transfer',catatan:''},currentForm,null)");h.requests[0].reject(Object.assign(new Error('lost'),{uncertain:true}));await p;
  const orders=shopOrders();orders[0].payments.push({id:'gp_x',groupId:'gp1',jumlah:3375});const check=h.run("A.commerceCheck({closest:function(){return currentForm;}})");h.requests[1].resolve(reply('pembelian',{suppliers:[],products:[],orders},11));await check;assert.equal(h.run('drops'),1);assert.match(h.json('messages').at(-1).text,/grup sudah tercatat/);
  const again=harness();again.seed('pembelian',{suppliers:[],products:[],orders:shopOrders()});again.form({},'pembelian');const q=again.run("commerceMutation('pembelian','appendCommerceGroupPayment',{id:'gp1',module:'pembelian',orderIds:['o1','o2'],expectedRevisions:{o1:'r1',o2:'r2'},tanggal:'2026-10-09',jumlah:9000,metode:'transfer',catatan:''},currentForm,null)");again.requests[0].reject(Object.assign(new Error('lost'),{uncertain:true}));await q;
  const same=again.run("A.commerceCheck({closest:function(){return currentForm;}})");again.requests[1].resolve(reply('pembelian',{suppliers:[],products:[],orders:shopOrders()},11));await same;assert.equal(again.run('drops'),0);assert.equal(again.run('currentForm._commerceRetry'),true);
});
test('the new invoice form shares supplier and DP while each model keeps quantity and price; product choices stay supplier-scoped',()=>{
  const h=harness();h.seed('pembelian',{suppliers:[{id:'s1',nama:'Supplier A'},{id:'s2',nama:'Supplier B',aktif:false}],products:[{id:'p1',nama:'Kaos',model:'Oversize',supplierId:'s1',harga:45000},{id:'p2',nama:'Topi',supplierId:'s2'},{id:'p3',nama:'Lama',supplierId:'s1',aktif:false}],orders:[]});
  assert.match(h.run("commerceProductOptions('','')"),/Pilih supplier dulu/);const choices=h.run("commerceProductOptions('s1','')");assert.match(choices,/Kaos · Oversize/);assert.ok(!/Topi|Lama/.test(choices));
  assert.ok(!h.run("commerceSupplierOptions('')").includes('Supplier B'),'an inactive supplier is not offered for a new order');assert.match(h.run("commerceSupplierOptions('s2')"),/value="s2" selected/);
  h.run("A.commerceOrderOpen({getAttribute:function(){return null;}})");const form=h.run('lastSheet');for(const part of ['data-commerce-models','Tambah model lain','Warna / ukuran (opsional)','name="supplierPick"','name="produkId"','data-kind="suppliers"','data-kind="products"','DP bersama','commerceBatchSave'])assert.ok(form.includes(part),part);
  assert.equal((form.match(/name="supplierPick"/g)||[]).length,1);assert.equal((form.match(/name="dp"/g)||[]).length,1);assert.equal((form.match(/name="tanggalOrder"/g)||[]).length,1);
});
test('after a save the open order form adopts the new supplier or product, and a new order shows the supplier picture',()=>{
  const h=harness();h.seed('pembelian',{suppliers:[{id:'s1',nama:'Supplier A'}],products:[{id:'p9',nama:'Topi Baru',supplierId:'s1',harga:30000}],orders:[]});
  h.run("var shown=[];commerceShareShow=function(ids,fresh){shown.push([ids,fresh]);};var sup={innerHTML:''},prod={innerHTML:'',value:'p9',closest:function(){return currentForm;}},price={value:''};currentForm.values={hargaSatuan:''};currentForm.hasAttribute=function(k){return k==='data-commerce-order';};var real$=$;$=function(s,f){return s==='[name=\"supplierPick\"]'?sup:s==='[name=\"produkId\"]'?prod:s==='[name=\"hargaSatuan\"]'?price:real$(s,f);};R.commerce=function(){};");
  h.run("commerceAfterSave({action:'saveCommerceProduct',payload:{record:{}}},{record:{id:'p9',supplierId:'s1'}})");assert.match(h.run('sup.innerHTML'),/value="s1" selected/);assert.match(h.run('prod.innerHTML'),/value="p9" selected/);assert.equal(h.run('price.value'),30000,'the product default price is filled in');
  h.run("commerceAfterSave({action:'saveCommerceSupplier',payload:{record:{}}},{record:{id:'s1'}})");assert.match(h.run('prod.innerHTML'),/Pilih produk/);assert.equal(h.run('shown.length'),0);
  h.run("commerceAfterSave({action:'saveCommerceOrder',payload:{record:{id:'new'}}},{record:{id:'new'}});commerceAfterSave({action:'saveCommerceOrder',payload:{record:{id:'old'},expectedRevision:'r'}},{record:{id:'old'}})");assert.deepEqual(h.json('shown'),[[['new'],true]]);
});
test('the supplier picture model shows what was received and what is left per variant, and never guesses unknown links',()=>{
  const h=harness();h.seed('pembelian',{suppliers:[{id:'s1',nama:'Supplier A',kontak:'0811',alamat:'Bandung'}],products:[],orders:shopOrders()});h.run("S.state.settings={kopSlip:'Soldier Apparel'};");
  const m=h.json("commerceShareModel(['o1','o2'].map(function(k){return commerceFind('pembelian','orders',k);}))");
  assert.equal(m.usaha,'SOLDIER APPAREL');assert.equal(m.invoiceLabel,h.run("commerceInvoiceLabel(commerceFind('pembelian','orders','o1'))"));assert.equal(m.judul,m.invoiceLabel+' · 2 model');assert.deepEqual(m.supplier,{nama:'Supplier A',detail:'0811 · Bandung'});
  assert.deepEqual(m.orders[0].baris,[{nama:'M',jumlah:6,diterima:6,sisa:0,subtotal:6000},{nama:'L',jumlah:4,diterima:0,sisa:4,subtotal:4000}]);assert.equal(m.orders[0].beres,false);assert.equal(m.orders[1].diterima,0);
  assert.equal(m.total,20000);assert.equal(m.qty,20);assert.equal(m.diterima,6);assert.equal(m.dibayar,4000);assert.equal(m.sisa,16000);
  assert.deepEqual(m.pembayaran,[{tanggal:'2026-10-08',catatan:'DP',jumlah:4000}],'payments of the same day and note are shown as one line; corrected ones are left out');
  const held=h.json("commerceShareModel([commerceFind('pembelian','orders','o5')])");assert.equal(held.judul,held.invoiceLabel+' · 1 model');assert.equal(held.orders[0].baris[0].diterima,null);assert.equal(held.orders[0].baris[0].sisa,null);assert.equal(held.orders[0].diterima,3);
});
test('purchase and sales pages are fetched quietly once per sign-in after the main data, never for a worker',()=>{
  const h=harness();h.run("var timers=[];setTimeout=function(fn){timers.push(fn);return timers.length;};clearTimeout=function(){};Api.mode=function(){return 'remote';};commercePrefetch();commercePrefetch();");
  assert.equal(h.run('timers.length'),1);assert.equal(h.requests.length,0);h.run('timers[0]()');assert.deepEqual(h.requests.map(r=>r.payload.module),['pembelian','nota']);
  const worker=harness();worker.run("var timers=[];setTimeout=function(fn){timers.push(fn);return 1;};S.state.me={id:'w',divisi:'potong'};commercePrefetch();");assert.equal(worker.run('timers.length'),0);
  const demo=harness();demo.run("var timers=[];setTimeout=function(fn){timers.push(fn);return 1;};Api.mode=function(){return 'demo';};commercePrefetch();");assert.equal(demo.run('timers.length'),0);
});
test('purchase lifecycle actions are central, preserve ledger intent and expose separate inactive and archive filters',()=>{
  const h=harness(),orders=shopOrders();orders.push({...orders[1],id:'old',revision:'ro',legacy:true,status:'dp',totalPaid:1000,balance:9000},{...orders[1],id:'oldclean',revision:'rc',legacy:true});
  h.seed('pembelian',{suppliers:[],products:[],orders});const card=id=>h.run("commerceOrderCard(commerceFind('pembelian','orders',"+JSON.stringify(id)+"))");
  assert.match(card('o1'),/data-a="commerceOrderOpen" data-id="o1">Edit/);assert.doesNotMatch(card('o1'),/commerceCancelOpen/,'supplier cards stay compact');
  for(const id of ['o3','o5']){assert.ok(!card(id).includes('>Edit<'),id+' is not editable');}assert.match(card('oldclean'),/>Edit</);assert.match(card('old'),/>Edit</);
  const detail=h.run("commerceDetail('pembelian','o1')");assert.match(detail,/data-mode="inactive">Nonaktifkan PO/);assert.match(detail,/data-mode="archived">Hapus PO/);
  h.run("commerceInvoiceShow(['o1','o2'])");assert.match(h.run('lastSheet'),/Kelola PO/);assert.equal((h.run('lastSheet').match(/>Nonaktifkan PO</g)||[]).length,2);
  h.run("S.listFn=null;S.sub.commercePurchase='orders';var normal=VIEWS['pembelian-produk']();S.f['commerceStatus-pembelian']='batal';var removed=S.listFn();S.f['commerceStatus-pembelian']='';");
  assert.ok(!h.run('normal').includes('data-id="o3"'),'removed orders are not in the normal list');assert.match(h.run('removed'),/data-id="o3"/);
  const el=(id,mode='archived')=>`{getAttribute:function(k){return k==='data-m'?'pembelian':k==='data-mode'?${JSON.stringify(mode)}:${JSON.stringify(id)};}}`;
  h.run(`A.commerceCancelOpen(${el('o1')})`);assert.match(h.run('lastSheet'),/Hapus PO/);assert.match(h.run('lastSheet'),/bukan dihapus permanen/);assert.match(h.run('lastSheet'),/seluruh riwayat tidak berubah/);assert.match(h.run('lastSheet'),/tidak berarti utang sudah lunas/);assert.equal(h.run('currentForm._commerceCancelMode'),'archived');
  h.run("currentForm.values={id:'o1',revision:'r1',catatan:''};currentForm.module='pembelian';currentForm._commerceScope=commerceScope();A.commerceCancelSave(null)");assert.equal(h.requests.length,0,'a reason is required');
  h.run("currentForm.values.catatan=' tidak jadi ';A.commerceCancelSave(null)");assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].payload)),{module:'pembelian',id:'o1',expectedRevision:'r1',catatan:'tidak jadi',mode:'archived',withState:true});
  const plain=harness();plain.seed('pembelian',{suppliers:[],products:[],orders:shopOrders()});plain.run(`A.commerceCancelOpen(${el('o2','inactive')})`);assert.equal(plain.run('currentForm._commerceCancelMode'),'inactive');assert.match(plain.run('lastSheet'),/Nonaktifkan PO/);
  /* an order from the old data (or one still marked for review) leaves the list with its old payments untouched, and can come back */
  const old=harness(),rows=shopOrders();rows.push({...rows[1],id:'old',revision:'ro',legacy:true,status:'dp',totalPaid:1000,balance:9000},{...rows[1],id:'gone',revision:'rg',legacy:true,status:'batal',cancelledBy:'u',cancelKeepsEvents:true},{...rows[1],id:'oldgone',revision:'rx',legacy:true,status:'batal'});
  old.seed('pembelian',{suppliers:[],products:[],orders:rows});old.run(`A.commerceCancelOpen(${el('old')})`);assert.match(old.run('lastSheet'),/seluruh riwayat tidak berubah/);assert.equal(old.run('currentForm._commerceCancelMode'),'archived');
  old.run("currentForm.values={id:'old',revision:'ro',catatan:'dobel'};currentForm.module='pembelian';currentForm._commerceScope=commerceScope();A.commerceCancelSave(null)");assert.deepEqual(JSON.parse(JSON.stringify(old.requests[0].payload)),{module:'pembelian',id:'old',expectedRevision:'ro',catatan:'dobel',mode:'archived',withState:true});
  const back=id=>old.run("commerceOrderCard(commerceFind('pembelian','orders',"+JSON.stringify(id)+"))");assert.match(back('gone'),/data-a="commerceRestore" data-m="pembelian" data-id="gone">Kembalikan ke daftar/);assert.ok(!back('oldgone').includes('commerceRestore'),'an order cancelled in the old data stays as it came');
  const again=harness();again.seed('pembelian',{suppliers:[],products:[],orders:rows});again.run(`A.commerceRestore(${el('gone')})`);assert.match(again.run('lastSheet'),/lamanya ikut kembali/);
  again.run("currentForm.values={id:'gone',revision:'rg'};currentForm.module='pembelian';currentForm._commerceScope=commerceScope();A.commerceRestoreSave(null)");
  assert.equal(again.requests[0].action,'restoreCommerceRecord');assert.deepEqual(JSON.parse(JSON.stringify(again.requests[0].payload)),{module:'pembelian',id:'gone',expectedRevision:'rg',withState:true});
  const admin=harness();admin.run("S.state.me={id:'adm',divisi:'admin'};");admin.seed('pembelian',{suppliers:[],products:[],orders:shopOrders()});assert.ok(!admin.run("commerceOrderCard(commerceFind('pembelian','orders','o2'))").includes('>Hapus<'));assert.match(admin.run("commerceOrderCard(commerceFind('pembelian','orders','o2'))"),/>Edit</);admin.run(`A.commerceCancelOpen(${el('o2')})`);assert.match(admin.json('messages').at(-1).text,/Hanya owner/);
});
test('inactive and archived PO remain readable and restorable without entering active totals or each others filter',()=>{
  const h=harness(),base=shopOrders()[0],orders=[base,{...base,id:'inactive',status:'batal',cancelled:true,cancelMode:'inactive',cancelledBy:'owner',cancelKeepsEvents:true,cancelReason:'<script>private note</script>'},{...base,id:'archive',status:'batal',cancelled:true,cancelMode:'archived',cancelledBy:'owner',cancelKeepsEvents:true}];
  h.seed('pembelian',{suppliers:[],products:[],orders});h.run("commerceOrderList(commerceData('pembelian').orders)");assert.match(h.run('S.listFn()'),/data-ids="o1"/);assert.doesNotMatch(h.run('S.listFn()'),/data-id="inactive"|data-id="archive"/);
  for(const mode of ['inactive','archived']){h.run("S.f['commerceStatus-pembelian']="+JSON.stringify(mode));const markup=h.run('S.listFn()');assert.match(markup,new RegExp('data-id="'+(mode==='inactive'?'inactive':'archive')+'"'));assert.doesNotMatch(markup,new RegExp('data-id="'+(mode==='inactive'?'archive':'inactive')+'"'));assert.match(markup,mode==='inactive'?/Nonaktif/:/Dihapus \/ arsip/);}
  const detail=h.run("commerceDetail('pembelian','inactive')");assert.match(detail,/Aktifkan kembali/);assert.match(detail,/Hapus PO/);assert.match(detail,/DP, sisa tagihan, dan penerimaan tetap tersimpan/);assert.match(detail,/&lt;script&gt;/);assert.doesNotMatch(detail,/<script>/);assert.doesNotMatch(detail,/data-a="commercePaymentOpen"|data-a="commerceReceiptOpen"/);assert.match(detail,/Rp4000/);
  assert.deepEqual(h.json("commercePurchaseTotals(commerceData('pembelian').orders)"),{total:10000,paid:4000,balance:6000,count:1,review:0,cancelled:2});assert.equal(h.requests.length,0);
});

test('inactive and archive supplier headers summarise the displayed preserved PO without offering new transactions',()=>{
  const h=harness(),base=shopOrders()[0],closed={...base,id:'closed',status:'batal',cancelled:true,cancelMode:'inactive',cancelledBy:'owner',cancelKeepsEvents:true,productName:'Topi Contoh',tanggalOrder:'2026-10-10',totalQty:300,totalReceived:280,totalHarga:15000000,totalPaid:5000000,balance:10000000,items:[{id:'black',nama:'Hitam',jumlah:300}]};
  h.seed('pembelian',{suppliers:[],products:[],orders:[base,closed]});h.run("commerceOrderList(commerceData('pembelian').orders)");
  for(const mode of ['inactive','archived']){
    h.run("commerceData('pembelian').orders[1].cancelMode="+JSON.stringify(mode)+";S.f['commerceStatus-pembelian']="+JSON.stringify(mode));
    const markup=h.run('S.listFn()'),header=markup.slice(markup.indexOf('class="cgroup-h"'),markup.indexOf('class="corder"'));
    assert.match(header,/1 model · 2026-10-10/);assert.match(header,/Topi Contoh/);assert.match(header,/Diterima 280\/300 pcs · Sisa 20 pcs/);assert.match(header,/Total Rp15000000/);assert.match(header,/DP \/ dibayar Rp5000000/);assert.match(header,/Sisa Rp10000000/);
    assert.doesNotMatch(markup,/data-a="commercePaymentOpen"|data-a="commerceReceiptOpen"|data-a="commerceGroupPayOpen"|data-a="commerceTambahModel"/);
    assert.deepEqual(h.json("commercePurchaseTotals(commerceData('pembelian').orders)"),{total:10000,paid:4000,balance:6000,count:1,review:0,cancelled:1});
  }
  h.run("commerceData('pembelian').orders[1].paymentReview=true;");const held=h.run('S.listFn()');assert.match(held,/Total Perlu diperiksa/);assert.match(held,/DP \/ dibayar Perlu diperiksa/);assert.match(held,/Sisa Perlu diperiksa/);assert.equal(h.requests.length,0);
});

test('an uncertain archive does not falsely confirm success from the preceding inactive status',async()=>{
  const h=harness(),row={...shopOrders()[0],status:'batal',cancelled:true,cancelMode:'inactive',cancelledBy:'owner',cancelKeepsEvents:true,cancelReason:'Tunda'};h.seed('pembelian',{orders:[row],suppliers:[],products:[]});h.form({},'pembelian');
  const saving=h.run("commerceMutation('pembelian','cancelCommerceRecord',{module:'pembelian',id:'o1',expectedRevision:'r1',mode:'archived',catatan:'Arsip'},currentForm,null)");h.requests[0].reject(Object.assign(new Error('Timeout'),{uncertain:true}));await saving;
  const check=h.run("A.commerceCheck({closest:function(){return currentForm;}})");h.requests[1].resolve(reply('pembelian',{orders:[row],suppliers:[],products:[]},11));await check;
  assert.equal(h.run('drops'),0);assert.equal(h.run('currentForm._commerceRetry'),true);assert.match(h.run('currentForm.note.innerHTML'),/belum menunjukkan permintaan/);assert.equal(h.requests.length,2,'status inspection never retries the mutation automatically');
});

test('order save preserves item identity and sends initial DP in the same request',async()=>{
  const h=harness();h.form({id:'order-one',revision:'',produkId:'product-one',hargaSatuan:'100',tanggalOrder:'2026-10-08',catatan:'',dp:'50',metode:'transfer'},'pembelian',[{id:'line-M',values:{lineName:'M',lineQty:'2'}},{id:'line-L',values:{lineName:'L',lineQty:'3'}}]);h.run('A.commerceOrderSave(null)');assert.equal(h.requests.length,1);assert.equal(h.requests[0].action,'saveCommerceOrder');const p=h.requests[0].payload;assert.equal(p.record.initialPayment.jumlah,50);assert.deepEqual(JSON.parse(JSON.stringify(p.record.items)),[{id:'line-M',nama:'M',jumlah:2},{id:'line-L',nama:'L',jumlah:3}]);assert.equal(p.record.id,'order-one');
});
test('invalid fractional quantities and excessive order DP never reach server',()=>{
  for(const invalid of [{qty:'1.5',dp:'0'},{qty:'1',dp:'101'}]){const h=harness();h.form({id:'o',revision:'',produkId:'p',hargaSatuan:'100',tanggalOrder:'2026-10-08',catatan:'',dp:invalid.dp,metode:'cash'},'pembelian',[{id:'i',values:{lineName:'M',lineQty:invalid.qty}}]);h.run('A.commerceOrderSave(null)');assert.equal(h.requests.length,0);assert.equal(h.json('messages').at(-1).bad,true);}
});
test('nota rounding follows item discounts then invoice discount then shipping',()=>{
  const h=harness();assert.deepEqual(h.json('commerceNotaTotals([{qty:3,price:999,discPercent:12.5},{qty:2,price:500,discPercent:0}],10,700)'),{subtotal:3622,discountAmount:362,total:3960});assert.throws(()=>h.run("commerceNumber('101','Diskon',false,100)"));
});
test('cash nota records tendered money separately from applied payment and change',()=>{
  const h=harness();h.form({id:'note-fixed',revision:'',date:'2026-10-08',customerName:'Buyer',customerType:'walkin',phone:'',address:'',discountPercent:'0',shipping:'0',notes:'',dp:'200',metode:'cash'},'nota',[{id:'i',values:{lineName:'Shirt',size:'M',color:'Blue',qty:'1',price:'150',discPercent:'0'}}]);h.run('A.commerceNotaSave(null)');assert.equal(h.requests.length,1);assert.equal(h.requests[0].payload.record.initialPayment.jumlah,150);assert.equal(h.requests[0].payload.record.initialPayment.tenderedAmount,200);
});
test('historic receipt holds remain visible and do not offer fabricated receipt allocation or editing',()=>{
  const h=harness();h.seed('pembelian',{orders:[{id:'old',legacy:true,receiptReview:true,needsReview:true,reviewReasons:['Unknown source item'],productName:'Product',items:[{id:'i',nama:'M',jumlah:10}],events:[{id:'old-receipt'}],payments:[],receipts:[],totalHarga:100,totalPaid:0,balance:100,totalReceived:2}]});const body=h.run("commerceDetail('pembelian','old')");assert.match(body,/Unknown source item/);assert.ok(!body.includes('data-a="commerceReceiptOpen"'));assert.ok(body.includes('data-a="commerceOrderOpen"'));assert.match(body,/commercePaymentOpen/);
});
test('void and cancellation controls are owner-only; admin retains payment entry',()=>{
  const h=harness();h.seed('nota',{notes:[{id:'n',customer:{name:'B'},items:[],payments:[{id:'p',jumlah:1}],events:[{id:'p'}],total:2,totalPaid:1,balance:1}]});let body=h.run("commerceDetail('nota','n')");assert.match(body,/commerceVoidOpen/);h.run("S.state.me.divisi='admin'");h.seed('nota',{notes:[{id:'n',customer:{name:'B'},items:[],payments:[{id:'p',jumlah:1}],events:[{id:'p'}],total:2,totalPaid:1,balance:1}]});body=h.run("commerceDetail('nota','n')");assert.ok(!body.includes('commerceVoidOpen'));assert.match(body,/commercePaymentOpen/);
});
test('print and PDF use the same module and stable record ID; customer text is escaped',async()=>{
  const h=harness();h.seed('nota',{notes:[{id:'n',customer:{name:'<script>oops</script>'},items:[{id:'i',name:'<img onerror=x>',qty:1,price:5}],payments:[],total:5,totalPaid:0,balance:5}]});const el="{getAttribute:function(k){return k==='data-m'?'nota':'n';}}";await h.run('A.commercePrint('+el+')');await h.run('A.commercePdf('+el+')');assert.equal(h.run('prints[0][0].reference'),'n');assert.deepEqual(h.json('pdfs[0]'),{action:'makeCommercePdf',payload:{module:'nota',id:'n'}});const markup=h.run("commerceDetail('nota','n')");assert.ok(!markup.includes('<script>oops'));assert.match(markup,/&lt;script&gt;/);
});
test('incomplete HPP can show evidence but cannot start a pricing simulation',()=>{
  const h=harness();h.seed('hpp',{models:[{id:'m',nama:'Model',series:'Series',sizes:['M'],poIds:['p1'],configured:false,hppTotal:100,config:{value:{}},warnings:['Missing price']}],config:{},revision:'r'});h.run("A.commerceHppSim({getAttribute:function(){return 'm';}})");assert.match(h.json('messages').at(-1).text,/Lengkapi/);const body=h.run('VIEWS.hpp()');assert.match(body,/Periksa biaya/);assert.ok(!body.includes('Rp100 / pcs'));
});
test('HPP explicit review is required and settings use the captured revision',()=>{
  const h=harness();h.form({modelId:'m',revision:'hpp-before',reviewed:false},'hpp');h.run('currentForm._commerceModel={id:"m",kain:{complete:true,perPcs:10},potong:{complete:true,perPcs:2}};A.commerceHppSave(null)');assert.equal(h.requests.length,0);h.run("currentForm.values={modelId:'m',revision:'hpp-before',reviewed:true,jahitMode:'manual',hargaJahit:'5',biayaLain:'2',ketLain:'Packing',targetMargin:'30'};A.commerceHppSave(null)");assert.equal(h.requests.length,1);assert.equal(h.requests[0].payload.expectedRevision,'hpp-before');assert.equal(h.requests[0].payload.config.costSchema,2);assert.equal(h.requests[0].payload.config.costsReviewed,true);
});
test('owner import cannot apply without a verified ready proof or while a source file is still reading',()=>{
  const h=harness();h.form({},'hpp');h.run('currentForm._commerceFiles={backup:{}};currentForm._commerceReads={reference:1};A.commerceImportPreview(null);A.commerceImportApply(null)');assert.equal(h.requests.length,0);assert.match(h.json('messages').at(-1).text,/Tunggu file/);
});
test('read-only commerce actions use read timeout behavior, not uncertain write messages',()=>{
  const line=html.split('\n').find(s=>s.includes('var readOnly ='));assert.match(line,/getCommerceState/);assert.match(line,/makeCommercePdf/);assert.match(line,/previewCommerceImport/);assert.ok(!line.includes('appendCommercePayment'));
});

test('status filtering rereads the current selection and query without another server read',()=>{
  const h=harness();h.seed('nota',{notes:[{id:'open',status:'belum',customer:{name:'First'},items:[],total:10},{id:'paid',status:'lunas',customer:{name:'Second'},items:[],total:20}]});h.run('VIEWS.nota()');assert.match(h.run('S.listFn()'),/open/);h.run("S.f['commerceStatus-nota']='lunas'");let result=h.run('S.listFn()');assert.ok(!result.includes('data-id="open"'));assert.match(result,/data-id="paid"/);h.run("S.f.q='First'");assert.match(h.run('S.listFn()'),/Tidak ada catatan/);assert.equal(h.requests.length,0);
});

test('both import files survive overlapping reads and no preview runs against half-read inputs',()=>{
  const h=harness();h.form({},'hpp');h.run(`currentForm._commerceFiles={};currentForm.proof={textContent:''};currentForm.sheet.apply={disabled:false};var readers=[];function FileReader(){readers.push(this);this.readAsText=function(){};}
    function fileEl(slot){return {files:[{size:20,name:slot+'.json'}],getAttribute:function(){return slot;},closest:function(){return currentForm;}};}
    C.commerceImportFile(fileEl('backup'));C.commerceImportFile(fileEl('reference'));A.commerceImportPreview(null);`);
  assert.equal(h.requests.length,0);h.run("readers[0].result='{}';readers[0].onload();readers[1].result='{}';readers[1].onload();");assert.deepEqual(h.json('Object.keys(currentForm._commerceFiles).sort()'),['backup','reference']);assert.deepEqual(h.json('Object.keys(currentForm._commerceReads)'),[]);
});

test('HPP uses the actual price engine and preserves recommended marketplace prices on save',()=>{
  const h=harness();vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/commerce-hpp.js'),'utf8'),h.context);h.seed('hpp',{models:[],config:{marketplace:{shop:{nama:'Shop',fee:10,fixedPerPcs:1}},pajak:1},revision:'old'});
  h.form({modelId:'m',revision:'old',reviewed:true,jahitMode:'manual',hargaJahit:'5',biayaLain:'2',ketLain:'Packing',targetMargin:'20'},'hpp');h.run('currentForm._commerceModel={id:"m",kain:{complete:true,perPcs:100},potong:{complete:true,perPcs:10}};A.commerceHppSave(null)');assert.equal(h.requests.length,1);assert.equal(h.requests[0].payload.config.hargaJual.shop,200);
  assert.match(h.run("commerceHppEvidence({kain:{details:[{jenis:'Unpriced',qty:2,unit:'kg',avgHarga:null,totalCost:null}]}})"),/Belum diketahui/);
});

test('the actual shared commerce model is accepted by the same print normalizer, including held receipts and note discounts',()=>{
  const h=harness(),source=fs.readFileSync(path.resolve(__dirname,'../src/commerce.js'),'utf8');h.run('var coreRupiah=rp,coreRibuan=nf;function coreNum(n){return Number(n)||0;}');
  vm.runInContext(source.slice(source.indexOf('function coreCommerceSlipModel('),source.indexOf('function coreInstallCommerceActions(')),h.context);
  vm.runInContext(html.slice(html.indexOf('function slipTeks('),html.indexOf('function slipTabel(')),h.context);
  h.run(`var row={id:'n',noNota:'SA-261008-003',date:'2026-10-08',customer:{name:'Customer',phone:'000',address:'Street'},items:[{name:'Product',size:'M',color:'Blue',qty:2,price:100,discPercent:10,subtotal:180}],subtotal:180,discountPercent:10,discountAmount:18,shipping:5,total:167,totalPaid:167,balance:0,status:'lunas',notes:'Handle carefully',payments:[{tanggal:'2026-10-08',metode:'cash',jumlah:167,tenderedAmount:200,change:33}],needsReview:true,reviewReasons:['Source needs review']};var normalized=slipNormal(coreCommerceSlipModel('nota',row,{}));`);
  assert.equal(h.run('normalized.rows[0][4]'),'10%');assert.ok(h.json('normalized.summary').some(r=>r.label==='Ongkir'));assert.ok(h.json('normalized.sections').some(r=>r.title==='Perlu diperiksa'));assert.ok(h.json('normalized.sections').some(r=>r.title==='Riwayat pembayaran'));
});

test('grouped purchase documents require unique orders with the same frozen supplier identity',()=>{
  const h=harness();h.run("var groupRows=[{id:'a',invoiceId:'same',supplierSnapshot:{id:'supplier-1'}},{id:'b',invoiceId:'same',supplierSnapshot:{id:'supplier-1'}},{id:'c',supplierSnapshot:{id:'supplier-2'}},{id:'legacy'}];");
  assert.deepEqual(h.json("commerceGroupSelection(groupRows,['b','a']).map(r=>r.id)"),['b','a']);
  for(const ids of [[],['a','a'],['a','c'],['legacy'],['missing'],Array.from({length:21},(_,i)=>'id'+i)])assert.throws(()=>h.run('commerceGroupSelection(groupRows,'+JSON.stringify(ids)+')'));
  assert.equal(h.requests.length,0);
});

test('group print and PDF preserve individual order models and the revisions selected for printing',async()=>{
  const h=harness();h.form({},'pembelian');h.run("currentForm._commerceGroupRows=[{id:'a',revision:'rev-a',invoiceId:'same',supplierSnapshot:{id:'s'},items:[{id:'a-M',jumlah:2}]},{id:'b',revision:'rev-b',invoiceId:'same',supplierSnapshot:{id:'s'},items:[{id:'b-L',jumlah:3}]}];currentForm._commerceGroupIds=['b','a'];");
  await h.run('A.commerceGroupPrint(null)');await h.run('A.commerceGroupPdf(null)');
  assert.deepEqual(h.json('prints[0].map(r=>({id:r.reference,items:r.rows}))'),[{id:'b',items:[{id:'b-L',jumlah:3}]},{id:'a',items:[{id:'a-M',jumlah:2}]}]);
  assert.deepEqual(h.json('pdfs[0]'),{action:'makeCommercePdf',payload:{module:'pembelian',ids:['b','a'],expectedRevisions:{b:'rev-b',a:'rev-a'}}});
  assert.equal(h.requests.length,0,'printing does not create payment or receipt events');
});

test('the invoice picture includes settled members and opens only the chosen invoice models',()=>{
  const h=harness();h.form({},'pembelian');
  h.run("currentForm._commerceGroupRows=[{id:'a',revision:'ra',invoiceId:'one-invoice',status:'dp',balance:5,supplierSnapshot:{id:'s'}},{id:'b',revision:'rb',status:'selesai',balance:0,supplierSnapshot:{id:'s'}},{id:'c',revision:'rc',status:'batal',balance:9,supplierSnapshot:{id:'s'}},{id:'d',revision:'rd',status:'pending',balance:7,supplierSnapshot:{id:'s'}},{id:'e',revision:'re',status:'pending',balance:7,supplierSnapshot:{id:'lain'}},{id:'f',revision:'rf',status:'lunas',balance:0,supplierSnapshot:{id:'s'}},{id:'g',revision:'rg',status:'review',balance:4,needsReview:true,supplierSnapshot:{id:'s'}},{id:'h',revision:'rh',status:'dp',balance:4,paymentReview:true,supplierSnapshot:{id:'s'}}];currentForm._commerceGroupRows.forEach(function(r){r.invoiceId='same';});");
  assert.deepEqual(h.json("commerceGroupAwal(currentForm,commerceInvoiceKey(currentForm._commerceGroupRows[0]))"),['a','b','d','f','g','h'],'all non-cancelled invoice members can appear on the image, including settled and reviewed history');
  h.run("var shown=[];commerceShareShow=function(ids,fresh){shown.push([ids,fresh]);};currentForm._commerceGroupIds=['d','a'];A.commerceGroupShare(null);");
  assert.deepEqual(h.json('shown'),[[['d','a'],false]]);assert.equal(h.requests.length,0,'making the picture records nothing');
  h.run("currentForm._commerceGroupIds=[];A.commerceGroupShare(null);");assert.equal(h.json('shown').length,1);assert.match(h.json('messages').at(-1).text,/Pilih 1 sampai 20 order/);
  h.seed('pembelian',{suppliers:[],products:[],orders:shopOrders()});h.run("commerceInvoiceShow(['o1','o2'])");
  assert.match(h.run('lastSheet'),/data-a="commerceShareOpen" data-ids="o1,o2">Gambar untuk supplier<\/button>/);
  h.run("A.commerceShareOpen({getAttribute:function(k){return k==='data-ids'?'o1,o2':null;}})");assert.deepEqual(h.json('shown').at(-1),[['o1','o2'],false]);assert.equal(h.requests.length,0,'the supplier footer opens the picture without a write');
  assert.match(html,/var rows=\(commerceData\('pembelian'\)\.orders\|\|\[\]\)\.filter\(function\(r\)\{return !commerceBatal\(r\);\}\)\.sort\(/,'orders that were removed are not offered in the group picker');assert.match(html,/class="tools" style="align-items:flex-end">' \+ fSelect\('Status order'/);
  assert.match(html,/\['DP \/ sudah dibayar', uang\(m\.dibayar\), HIJAU\]/);assert.doesNotMatch(html,/Cetak gabungan/);
});
test('a combined down payment is recorded for the ticked orders and the supplier picture follows with the new figures',async()=>{
  const h=harness();h.seed('pembelian',{suppliers:[{id:'s1',nama:'Supplier A'}],products:[],orders:shopOrders()});h.form({},'pembelian');
  h.run("var shown=[],closed=0;commerceShareShow=function(ids,fresh){shown.push([ids,fresh]);};function closeSheet(){closed++;}");
  h.run("currentForm._commerceGroupRows=[{id:'o1',revision:'r1',invoiceId:'fixture-invoice',supplierSnapshot:{id:'s1'}},{id:'o2',revision:'r2',invoiceId:'fixture-invoice',supplierSnapshot:{id:'s1'}}];currentForm._commerceGroupIds=['o1','o2'];A.commerceGroupBayar(null);");
  assert.equal(h.run('closed'),1,'the picker closes before the payment form opens');assert.match(h.run('lastSheet'),/Bayar invoice — /);assert.match(h.run('lastSheet'),/2 order/);assert.deepEqual(h.json('currentForm._commerceGabungIds'),['o1','o2']);
  h.run("currentForm.values={id:'gp9',tanggal:'2026-10-09',jumlah:'5000',metode:'transfer',catatan:'DP'};currentForm.module='pembelian';currentForm._commerceScope=commerceScope();currentForm._commerceIntent=null;A.commerceGroupPaySave(null)");
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].action,'appendCommerceGroupPayment');assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].payload.orderIds)),['o1','o2']);assert.equal(h.requests[0].payload.jumlah,5000);
  h.requests[0].resolve({groupId:'gp9',commerce:reply('pembelian',{suppliers:[{id:'s1',nama:'Supplier A'}],products:[],orders:shopOrders()},11)});await turn();await turn();
  assert.deepEqual(h.json('shown'),[[['o1','o2'],false]],'the picture opens for the same selection');assert.equal(h.run('S.gabungSesudahBayar'),null);
  /* a group payment started from a group card does not open the picture */
  const k=harness();k.seed('pembelian',{suppliers:[{id:'s1',nama:'Supplier A'}],products:[],orders:shopOrders()});k.form({},'pembelian');
  k.run("var shown=[];commerceShareShow=function(ids,fresh){shown.push([ids,fresh]);};A.commerceGroupPayOpen({getAttribute:function(a){return a==='data-ids'?'o1,o2':'Supplier A';}});currentForm.values={id:'gp8',tanggal:'2026-10-09',jumlah:'5000',metode:'transfer',catatan:''};currentForm.module='pembelian';currentForm._commerceScope=commerceScope();A.commerceGroupPaySave(null)");
  k.requests[0].resolve({groupId:'gp8',commerce:reply('pembelian',{suppliers:[{id:'s1',nama:'Supplier A'}],products:[],orders:shopOrders()},11)});await turn();await turn();assert.deepEqual(k.json('shown'),[]);
  /* nothing to pay among the ticked orders */
  const n=harness();n.seed('pembelian',{suppliers:[],products:[],orders:shopOrders()});n.form({},'pembelian');
  n.run("function closeSheet(){}currentForm._commerceGroupRows=[{id:'o3',revision:'r3',supplierSnapshot:{id:'s1'}}];currentForm._commerceGroupIds=['o3'];A.commerceGroupBayar(null);");
  assert.match(n.json('messages').at(-1).text,/sudah lunas atau belum bisa dibayar/);assert.equal(n.requests.length,0);
  assert.match(html,/data-a="commerceGroupBayar">' \+ ic\('wallet'\) \+ 'Bayar DP<\/button>/);
});
test('the HPP list leaves out models whose PO was deleted and shows the automatic cost before it is reviewed',()=>{
  const h=harness(),lengkap={complete:true,perPcs:4000,totalPcs:20},potong={complete:true,perPcs:700,totalPcs:20};
  h.seed('hpp',{models:[{id:'a',nama:'Ada',series:'S',sizes:['XL'],poIds:['p1'],kain:lengkap,potong:potong,hargaJahit:9000,biayaLain:100,configured:false,config:{value:{}},warnings:[]},
    {id:'b',nama:'Dihapus',series:'S',sizes:['M'],poIds:['p2'],kain:lengkap,potong:potong,hargaJahit:9000,configured:false,config:{value:{}},warnings:[]},
    {id:'c',nama:'TanpaPO',series:'S',sizes:['M'],poIds:[],configured:false,config:{value:{}},warnings:[]},
    {id:'d',nama:'ArsipKosong',series:'S',sizes:['M'],poIds:['p3'],kain:{complete:false,perPcs:null,totalPcs:0},configured:false,config:{value:{}},warnings:[]},
    {id:'e',nama:'ArsipAdaPotong',series:'S',sizes:['M'],poIds:['p4'],kain:lengkap,potong:potong,hargaJahit:null,configured:false,config:{value:{}},warnings:[]}],config:{},revision:'r'});
  h.run("S.state.settings={poBuang:['p2'],poSembunyi:['p3','p4']};");
  let body=h.run('VIEWS.hpp()');
  assert.match(body,/<b>Ada<\/b>/);assert.match(body,/<b>ArsipAdaPotong<\/b>/);assert.ok(!body.includes('<b>Dihapus</b>')&&!body.includes('<b>TanpaPO</b>')&&!body.includes('<b>ArsipKosong</b>'));
  assert.match(body,/3 model dari PO yang sudah dihapus atau diarsipkan tidak ditampilkan/);assert.match(body,/<b>± Rp13800 \/ pcs<\/b><br><span class="chip warn">Periksa biaya/,'cloth + cutting + sewing + other costs, before the review');
  h.run("S.sub.hppSemua='1';");body=h.run('VIEWS.hpp()');assert.match(body,/<b>Dihapus<\/b>/);assert.match(body,/Sembunyikan lagi/);
  assert.match(html,/dihitung dari potongan ukuran '\+esc\(basis\.ukuran\)\+' saja/);
});
test('owner edits a legacy order directly with the same ID; no copy or payment write is made',()=>{
  const h=harness(),o={id:'old1',revision:'r1',legacy:true,needsReview:true,receiptReview:true,produkId:'p1',productName:'Topi',supplierSnapshot:{id:'s1'},tanggalOrder:'2026-08-31',items:[{id:'i1',nama:'Hitam',jumlah:10}],totalQty:10,totalHarga:10000,totalPaid:3000,balance:7000,totalReceived:4,hargaSatuan:1000,payments:[{id:'pay1',jumlah:3000}],receipts:[]};
  h.seed('pembelian',{suppliers:[{id:'s1',nama:'S'}],products:[{id:'p1',nama:'Topi',supplierId:'s1'}],orders:[o]});
  const el="{getAttribute:function(){return 'old1';}}";
  assert.match(h.run("commerceOrderCard(commerceRecord('pembelian','old1'))"),/data-a="commerceOrderOpen" data-id="old1">Edit/);
  assert.ok(!h.run("commerceOrderCard(commerceRecord('pembelian','old1'))").includes('Jadikan bisa diedit'));
  h.run("A.commerceOrderOpen("+el+")");const body=h.run('lastSheet');
  assert.match(body,/Edit order produk/);assert.match(body,/order yang sama/);assert.match(body,/Penerimaan lama belum terhubung/);assert.match(body,/name="id" value="old1"/);assert.match(body,/name="revision" value="r1"/);assert.ok(!body.includes('name="dp"'));
  assert.match(body,/name="produkId" value="p1"/);assert.ok(!body.includes('<select name="produkId"'));assert.ok(!body.includes('name="supplierPick"'));assert.ok(!body.includes('Supplier baru'));assert.ok(!body.includes('Produk baru'));assert.match(body,/Supplier dan produk tetap mengikuti order asal/);
  h.form({id:'old1',revision:'r1',produkId:'p1',hargaSatuan:'1100',tanggalOrder:'2026-09-01',grupNama:'Invoice 1',catatan:'Koreksi harga'},'pembelian',[{id:'i1',values:{lineName:'Hitam',lineQty:'10'}}]);
  h.run('A.commerceOrderSave(null)');assert.equal(h.requests.length,1);assert.equal(h.requests[0].action,'saveCommerceOrder');assert.equal(h.requests[0].payload.record.id,'old1');assert.equal(h.requests[0].payload.expectedRevision,'r1');assert.equal(h.requests[0].payload.record.initialPayment,undefined);
  h.run("S.state.me.divisi='admin';lastSheet='';");h.seed('pembelian',{suppliers:[],products:[],orders:[o]});h.run("A.commerceOrderOpen("+el+")");assert.equal(h.run('lastSheet'),'');assert.match(h.json('messages').at(-1).text,/owner/);
});
test('payments are listed as a history with a group payment as one line, and the forms say total, paid and remaining',()=>{
  const h=harness(),order=(id,extra)=>Object.assign({id,revision:'r'+id,supplierName:'Reseller A',supplierSnapshot:{id:'s1',nama:'Reseller A'},status:'dp'},extra);
  h.seed('pembelian',{suppliers:[],products:[],orders:[
    order('o1',{productName:'Topi A',grupNama:'Invoice Okt',totalHarga:10000,totalPaid:1000,balance:9000,payments:[{id:'a',kind:'payment',tanggal:'2026-10-10',jumlah:600,metode:'transfer',catatan:'DP',groupId:'g1'},{id:'b',kind:'payment',tanggal:'2026-10-09',jumlah:400,metode:'cash',catatan:''},{id:'x',kind:'payment',tanggal:'2026-10-08',jumlah:999,metode:'cash',voided:true}]}),
    order('o2',{productName:'Topi B',grupNama:'Invoice Okt',totalHarga:5000,totalPaid:400,balance:4600,payments:[{id:'c',kind:'payment',tanggal:'2026-10-10',jumlah:400,metode:'transfer',catatan:'DP',groupId:'g1'}]}),
    order('o3',{productName:'Topi C',status:'batal',totalHarga:100,totalPaid:0,balance:100,payments:[{id:'d',kind:'payment',tanggal:'2026-10-11',jumlah:50,metode:'cash'}]})]});
  assert.deepEqual(h.json("commerceRiwayatRows(commerceData('pembelian').orders).map(function(r){return [r.tanggal,r.jumlah,r.model.join('+'),r.orderId];})"),[['2026-10-10',1000,'Topi A+Topi B','o1'],['2026-10-09',400,'Topi A','o1']],'corrected payments and removed orders are left out');
  const daftar=h.run("commerceRiwayatBayar(commerceData('pembelian').orders)");
  assert.match(daftar,/3 pembayaran<\/span><span class="right">Total dibayar <b>Rp1400<\/b>/);assert.match(daftar,/Pembayaran gabungan untuk 2 model: Topi A, Topi B/);assert.match(daftar,/Reseller A · Invoice Okt/);
  assert.match(html,/\['orders','Order'\],\['payments','Riwayat bayar'\],\['products','Produk'\]/);
  /* the group card and the payment forms spell out total, paid and what is left */
  const kartu=h.run("commerceGroupCard(commerceOrderGroups(commerceData('pembelian').orders.slice(0,2))[0])");
  assert.match(kartu,/Total Rp15000<\/span><br><span class="small muted">DP \/ dibayar Rp1400<\/span><br><b>Sisa Rp13600<\/b>/);
  h.run("A.commerceGroupPayOpen({getAttribute:function(k){return k==='data-ids'?'o1,o2':'Invoice Okt';}})");
  let form=h.run('lastSheet');assert.match(form,/<dt>Total 2 order<\/dt><dd class="b">Rp15000<\/dd><dt>Sudah dibayar \(DP\)<\/dt><dd class="b">Rp1400<\/dd><dt>Sisa tagihan<\/dt><dd class="b">Rp13600<\/dd>/);assert.match(form,/Total Rp10000 · sudah dibayar Rp1000/);
  h.run("A.commercePaymentOpen({getAttribute:function(k){return k==='data-m'?'pembelian':'o2';}})");
  form=h.run('lastSheet');assert.match(form,/<dt>Total<\/dt><dd class="b">Rp5000<\/dd><dt>Sudah dibayar<\/dt><dd class="b">Rp400<\/dd><dt>Sisa<\/dt><dd class="b">Rp4600<\/dd>/);
});
test('a model whose cost was already saved opens ready to be corrected, and the cost is worked out as the numbers are typed',()=>{
  const h=harness(),model=extra=>Object.assign({id:'m1',nama:'Hoodie',series:'S',sizes:['XL'],kain:{complete:true,perPcs:33430},potong:{complete:true,perPcs:1100},jahit:{complete:true,perPcs:5000},hargaJahit:5000,biayaLain:50000,warnings:[],config:{value:{jahitMode:'auto',hargaJahit:5000,biayaLain:50000,targetMargin:30,ketLain:'salah input'}}},extra);
  h.seed('hpp',{models:[model({configured:true,hppTotal:89530}),model({id:'m2',configured:false,config:{value:{}}})],config:{},revision:'r'});
  h.run("A.commerceHppOpen({getAttribute:function(){return 'm1';}})");let form=h.run('lastSheet');
  assert.match(form,/name="reviewed" checked>/);assert.match(form,/Salah isi\? Ubah angkanya lalu tekan Simpan biaya model/);assert.match(form,/data-commerce-hpp-live/);
  h.run("A.commerceHppOpen({getAttribute:function(){return 'm2';}})");form=h.run('lastSheet');assert.match(form,/name="reviewed">/);assert.ok(!form.includes('Salah isi?'));
  const hitung=values=>h.run(`var kotak={};currentForm._commerceModel=commerceHppModel('m1');currentForm.values=${JSON.stringify(values)};commerceHppLive(currentForm,kotak);kotak.innerHTML||kotak.textContent`);
  let teks=hitung({jahitMode:'auto',hargaJahit:'5000',biayaLain:'5000'});
  assert.match(teks,/<b>HPP Rp44530 \/ pcs<\/b>/);assert.match(teks,/kain Rp33430 \+ potong Rp1100 \+ jahit Rp5000 \+ biaya lain Rp5000/);assert.match(teks,/Yang tersimpan sekarang Rp89530\. Tekan Simpan biaya model untuk menggantinya/);
  teks=hitung({jahitMode:'auto',hargaJahit:'5000',biayaLain:'50000'});assert.match(teks,/<b>HPP Rp89530 \/ pcs<\/b>/);assert.ok(!teks.includes('Yang tersimpan sekarang'));
  teks=hitung({jahitMode:'manual',hargaJahit:'6000',biayaLain:''});assert.match(teks,/Biaya lain belum valid/);assert.ok(!teks.includes('Rp40530'));
});
test('several models go into one invoice: the order form takes an invoice name and "Tambah model" opens it for the same group',()=>{
  const h=harness(),order=(id,extra)=>Object.assign({id,revision:'r'+id,supplierName:'Reseller A',supplierSnapshot:{id:'s1',nama:'Reseller A'},totalPaid:0,totalReceived:0,status:'pending'},extra);
  h.seed('pembelian',{suppliers:[{id:'s1',nama:'Reseller A',aktif:true}],products:[{id:'p1',nama:'Topi A',supplierId:'s1',harga:48000,aktif:true},{id:'p2',nama:'Topi B',supplierId:'s1',harga:50000,aktif:true}],orders:[
    order('o1',{produkId:'p1',productName:'Topi A',grupNama:'Invoice Okt',tanggalOrder:'2026-10-10',items:[{id:'i1',nama:'Hitam',jumlah:25}],totalQty:25,totalHarga:1200000,balance:1200000,hargaSatuan:48000}),
    order('o2',{produkId:'p2',productName:'Topi B',tanggalOrder:'2026-10-11',items:[{id:'i2',nama:'Olive',jumlah:50}],totalQty:50,totalHarga:2500000,balance:2500000,hargaSatuan:50000})]});
  const kartu=h.run("commerceOrderGroups(commerceData('pembelian').orders).map(commerceGroupCard).join('')");
  /* Named legacy invoice and unrelated old order remain separate; starting a new invoice retains only supplier. */
  assert.match(kartu,/class="cgroup-h"><span class="grow"><b>Invoice Okt<\/b>/);
  assert.match(kartu,/data-a="commerceInvoiceOpen" data-ids="o1"/);assert.match(kartu,/data-a="commerceInvoiceOpen" data-ids="o2"/);assert.doesNotMatch(kartu,/data-ids="o1,o2"/);
  assert.match(kartu,/data-a="commerceTambahModel" data-tambah="1" data-supplier="s1" data-grup="" data-tanggal="">Invoice baru/);
  /* existing explicit invoice/date links remain compatible and original invoice fields stay editable */
  const el=attrs=>`{getAttribute:function(k){return (${JSON.stringify(attrs)})[k]||null;}}`;
  h.run(`A.commerceTambahModel(${el({'data-tambah':'1','data-supplier':'s1','data-grup':'Invoice Okt','data-tanggal':''})})`);
  let form=h.run('lastSheet');assert.match(form,/Order produk baru/);assert.match(form,/name="grupNama"[^>]*value=""/);assert.match(form,/<option value="s1" selected>Reseller A<\/option>/);assert.match(form,/<option value="p1">Topi A<\/option><option value="p2">Topi B<\/option>/);
  h.run(`A.commerceTambahModel(${el({'data-tambah':'1','data-supplier':'s1','data-grup':'','data-tanggal':'2026-10-11'})})`);
  form=h.run('lastSheet');assert.match(form,/name="tanggalOrder"[^>]*value="2026-10-08"/);assert.match(form,/name="grupNama"[^>]*value=""/);
  /* a plain "Order baru" stays empty, and an edit keeps the name the order already has */
  h.run("A.commerceOrderOpen({getAttribute:function(){return null;}})");assert.match(h.run('lastSheet'),/name="grupNama"[^>]*value=""/);assert.match(h.run('lastSheet'),/<option value="" selected>Pilih supplier<\/option>|<option value="">Pilih supplier<\/option>/);
  h.run("A.commerceOrderOpen({getAttribute:function(k){return k==='data-id'?'o1':null;}})");assert.match(h.run('lastSheet'),/name="grupNama"[^>]*value="Invoice Okt"/);
  /* the name travels with the order when it is saved; without a name nothing extra is sent */
  h.form({id:'new9',revision:'',produkId:'p2',hargaSatuan:'50000',tanggalOrder:'2026-10-12',catatan:'',dp:'0',metode:'transfer',grupNama:' Invoice Okt '},'pembelian',[{id:'l1',values:{lineName:'Olive',lineQty:'50'}}]);h.run('currentForm._commerceOriginal={};currentForm._commerceIntent=null;A.commerceOrderSave(null)');
  assert.equal(h.requests[0].action,'saveCommerceOrder');assert.equal(h.requests[0].payload.record.grupNama,'Invoice Okt');
  const k=harness();k.form({id:'new8',revision:'',produkId:'p2',hargaSatuan:'50000',tanggalOrder:'2026-10-12',catatan:'',dp:'0',metode:'transfer'},'pembelian',[{id:'l1',values:{lineName:'Olive',lineQty:'50'}}]);k.run('currentForm._commerceOriginal={};currentForm._commerceIntent=null;A.commerceOrderSave(null)');
  assert.ok(!('grupNama' in k.requests[0].payload.record));
});
test('a wrong payment is removed by typing zero, and a payment made for several orders is changed or removed for all of them at once',()=>{
  const data={suppliers:[],products:[],orders:[
    {id:'o1',revision:'r1',productName:'Topi A',items:[{id:'i1',nama:'Hitam',jumlah:10}],balance:9000,totalHarga:10000,events:[{id:'g1a',kind:'payment',tanggal:'2026-10-10',jumlah:600,metode:'transfer',catatan:'DP',groupId:'grp1'},{id:'pay1',kind:'payment',tanggal:'2026-10-09',jumlah:400,metode:'cash',catatan:''}]},
    {id:'o2',revision:'r2',productName:'Topi B',items:[{id:'i2',nama:'Olive',jumlah:5}],balance:4600,totalHarga:5000,events:[{id:'g1b',kind:'payment',tanggal:'2026-10-10',jumlah:400,metode:'transfer',catatan:'DP',groupId:'grp1'}]},
    {id:'o3',revision:'r3',productName:'Topi C',items:[],balance:100,totalHarga:100,events:[{id:'g1c',kind:'payment',tanggal:'2026-10-10',jumlah:50,metode:'transfer',groupId:'grp1',voided:true}]}]};
  const mulai=()=>{const h=harness();h.run('var konfirmasi=null;function confirmBox(o,fn){konfirmasi={o:o,fn:fn};}');h.seed('pembelian',data);return h;};
  const el=(order,id)=>`{getAttribute:function(k){return k==='data-m'?'pembelian':k==='data-id'?'${order}':'${id}';}}`;
  const isi=values=>`currentForm.values=${JSON.stringify(values)};currentForm.module='pembelian';currentForm._commerceScope=commerceScope();currentForm._commerceIntent=null;A.commerceEventEditSave(null)`;
  const kirim=h=>JSON.parse(JSON.stringify(h.requests[0].payload));
  /* an ordinary payment: zero asks once, then goes out as a correction without a replacement */
  const h=mulai();h.run(`A.commerceEventEdit(${el('o1','pay1')})`);assert.match(h.run('lastSheet'),/<h2>Ubah pembayaran<\/h2>/);assert.match(h.run('lastSheet'),/Isi <b>0<\/b> untuk menghapusnya/);
  h.run(isi({id:'new1',parentId:'o1',eventId:'pay1',revision:'r1',jenis:'payment',tanggal:'2026-10-09',jumlah:'0',metode:'cash',catatan:''}));
  assert.equal(h.requests.length,0,'nothing is sent before the owner confirms');assert.equal(h.json('konfirmasi.o').title,'Hapus pembayaran ini?');
  h.run('konfirmasi.fn(null)');assert.equal(h.requests[0].action,'voidCommerceEvent');
  assert.deepEqual(kirim(h),{id:'new1',module:'pembelian',parentId:'o1',eventId:'pay1',expectedRevision:'r1',tanggal:'2026-10-08',catatan:'Dihapus: salah catat',withState:true});
  /* a share of a group payment opens the whole group: the shares still in force are listed, the corrected one is not */
  const g=mulai();g.run(`A.commerceEventEdit(${el('o2','g1b')})`);const lembar=g.run('lastSheet');
  assert.match(lembar,/<h2>Ubah pembayaran gabungan<\/h2>/);assert.match(lembar,/untuk 2 order<\/b>, total <b>Rp1000<\/b>/);assert.match(lembar,/Topi A<br><span class="small muted">Hitam<\/span><\/span><b>Rp600<\/b>/);assert.match(lembar,/Topi B<br><span class="small muted">Olive<\/span><\/span><b>Rp400<\/b>/);assert.ok(!lembar.includes('Topi C'));assert.match(lembar,/name="groupId" value="grp1"/);
  g.run(isi({id:'new2',groupId:'grp1',jenis:'grup',tanggal:'2026-10-10',jumlah:'9000',metode:'transfer',catatan:' DP benar '}));
  assert.equal(g.requests[0].action,'gantiCommerceGroupPayment');
  assert.deepEqual(kirim(g),{id:'new2',module:'pembelian',groupId:'grp1',expectedRevisions:{o1:'r1',o2:'r2'},tanggal:'2026-10-10',jumlah:9000,metode:'transfer',catatan:'DP benar',withState:true});
  /* zero on the group removes it from every order after one question */
  const z=mulai();z.run(`A.commerceEventEdit(${el('o1','g1a')})`);z.run(isi({id:'new3',groupId:'grp1',jenis:'grup',tanggal:'2026-10-10',jumlah:'0',metode:'transfer',catatan:''}));
  assert.equal(z.requests.length,0);assert.equal(z.json('konfirmasi.o').title,'Hapus pembayaran gabungan ini?');assert.match(z.json('konfirmasi.o').text,/Bagiannya di 2 order/);
  z.run('konfirmasi.fn(null)');assert.equal(z.requests[0].action,'gantiCommerceGroupPayment');assert.equal(kirim(z).jumlah,0);assert.deepEqual(kirim(z).expectedRevisions,{o1:'r1',o2:'r2'});
});
test('a recorded payment or receipt opens prefilled for a change and is sent as one replacement',()=>{
  const h=harness();h.seed('pembelian',{suppliers:[],products:[],orders:[{id:'o9',revision:'r9',status:'dp',items:[{id:'i1',nama:'Hitam',jumlah:10}],balance:5000,totalHarga:9000,events:[{id:'pay1',kind:'payment',tanggal:'2026-10-09',jumlah:4000,metode:'cash',catatan:'DP'},{id:'rec1',kind:'receipt',tanggal:'2026-10-10',jumlah:6,itemId:'i1',kondisi:'ok'},{id:'pay0',kind:'payment',tanggal:'2026-10-01',jumlah:100,voided:true}]}]});
  const el=id=>`{getAttribute:function(k){return k==='data-m'?'pembelian':k==='data-id'?'o9':'${id}';}}`;
  h.run(`A.commerceEventEdit(${el('pay1')})`);assert.match(h.run('lastSheet'),/Ubah pembayaran/);assert.match(h.run('lastSheet'),/name="eventId" value="pay1"/);assert.match(h.run('lastSheet'),/Catatan lama <b>Rp4000<\/b>/);
  h.run("currentForm.values={id:'new1',parentId:'o9',eventId:'pay1',revision:'r9',jenis:'payment',tanggal:'2026-10-07',jumlah:'4500',metode:'transfer',catatan:' DP baru '};currentForm.module='pembelian';currentForm._commerceScope=commerceScope();currentForm._commerceIntent=null;A.commerceEventEditSave(null)");
  assert.equal(h.requests[0].action,'gantiCommerceEvent');assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].payload)),{id:'new1',module:'pembelian',parentId:'o9',eventId:'pay1',expectedRevision:'r9',tanggal:'2026-10-07',jumlah:4500,catatan:'DP baru',metode:'transfer',withState:true});
  const k=harness();k.seed('pembelian',{suppliers:[],products:[],orders:[{id:'o9',revision:'r9',items:[{id:'i1',nama:'Hitam',jumlah:10}],events:[{id:'rec1',kind:'receipt',tanggal:'2026-10-10',jumlah:6,itemId:'i1',kondisi:'ok'}]}]});
  k.run(`A.commerceEventEdit(${el('rec1')})`);assert.match(k.run('lastSheet'),/Ubah penerimaan/);assert.match(k.run('lastSheet'),/Catatan lama <b>6 pcs<\/b>/);
  k.run("currentForm.values={id:'new2',parentId:'o9',eventId:'rec1',revision:'r9',jenis:'receipt',tanggal:'2026-10-10',jumlah:'4',itemId:'i1',kondisi:'ok',catatan:''};currentForm.module='pembelian';currentForm._commerceScope=commerceScope();currentForm._commerceIntent=null;A.commerceEventEditSave(null)");
  assert.deepEqual(JSON.parse(JSON.stringify(k.requests[0].payload)),{id:'new2',module:'pembelian',parentId:'o9',eventId:'rec1',expectedRevision:'r9',tanggal:'2026-10-10',jumlah:4,catatan:'',itemId:'i1',kondisi:'ok',withState:true});
  h.run(`S.state.me.divisi='admin';A.commerceEventEdit(${el('pay1')})`);assert.match(h.json('messages').at(-1).text,/Hanya owner/);
  assert.match(html,/data-a="commerceEventEdit"'\+attrs\+'>Ubah<\/button>/);
});
test('an open group-print selection cannot export after the actor or session changes',async()=>{
  for(const change of ["S.token='new-session'","S.state.me={id:'other',divisi:'owner'}","S.state.me.divisi='potong'"]){
    const h=harness();h.form({},'pembelian');h.run("currentForm._commerceGroupRows=[{id:'a',revision:'r',supplierSnapshot:{id:'s'}}];currentForm._commerceGroupIds=['a'];"+change);
    await h.run('A.commerceGroupPrint(null)');await h.run('A.commerceGroupPdf(null)');
    assert.equal(h.run('prints.length'),0);assert.equal(h.run('pdfs.length'),0);assert.match(h.json('messages').at(-1).text,/Sesi berubah/);
  }
});
test('the supplier screen keeps models, payment history and corrections while compact controls open the next action',()=>{
  const h=harness(),order=(id,extra)=>Object.assign({id,revision:'r'+id,supplierName:'Reseller A',supplierSnapshot:{id:'s1',nama:'Reseller A'},tanggalOrder:'2026-10-10',hargaSatuan:1000,items:[{id:id+'i',nama:'Hitam',jumlah:10}],totalQty:10,totalHarga:10000,totalReceived:0,status:'dp',events:[]},extra);
  h.seed('pembelian',{suppliers:[{id:'s1',nama:'Reseller A',kontak:'0811'}],products:[],orders:[
    order('o1',{productName:'Topi A',grupNama:'Invoice Okt',totalPaid:1000,balance:9000,totalReceived:4,payments:[{id:'a',kind:'payment',tanggal:'2026-10-10',jumlah:600,metode:'transfer',catatan:'DP',groupId:'g1'},{id:'b',kind:'payment',tanggal:'2026-10-09',jumlah:400,metode:'cash',catatan:''},{id:'x',kind:'payment',tanggal:'2026-10-08',jumlah:999,metode:'cash',voided:true}]}),
    order('o2',{productName:'Topi B',grupNama:'Invoice Okt',totalPaid:400,balance:9600,payments:[{id:'c',kind:'payment',tanggal:'2026-10-10',jumlah:400,metode:'transfer',catatan:'DP',groupId:'g1'}]}),
    order('o3',{productName:'Topi C',grupNama:'Invoice Okt',legacy:true,totalPaid:0,balance:10000,payments:[]}),
    order('o4',{productName:'Topi D',grupNama:'Invoice Okt',status:'batal',totalPaid:0,balance:10000,payments:[{id:'d',kind:'payment',tanggal:'2026-10-11',jumlah:50,metode:'cash'}]})]});
  h.run("var shown=[],closed=0;commerceShareShow=function(ids,fresh){shown.push([ids,fresh]);};function closeSheet(){closed++;}");
  const el=(id,event)=>`{getAttribute:function(k){return k==='data-id'?${JSON.stringify(id)}:k==='data-event'?${JSON.stringify(event)}:'pembelian';}}`,segar="currentForm._commerceSending=false;currentForm._commerceIntent=null;currentForm._commerceLocked=false;";
  /* the group card leads to it */
  assert.match(h.run("commerceGroupCard(commerceOrderGroups(commerceData('pembelian').orders.slice(0,2))[0])"),/data-a="commerceInvoiceOpen" data-ids="o1,o2">Buka invoice<\/button>/);
  h.run("A.commerceInvoiceOpen({getAttribute:function(){return 'o1,o2,o3,o4';}})");const nota=h.run('lastSheet');
  assert.match(nota,/Rincian invoice/);assert.ok(!nota.includes('Topi D'),'a removed order is left out');
  assert.match(nota,/<dt>Total<\/dt><dd class="b">Rp30000<\/dd><dt>Sudah dibayar \(DP\)<\/dt><dd class="b">Rp1400<\/dd><dt>Sisa bayar<\/dt><dd class="b">Rp28600<\/dd><dt>Barang diterima<\/dt><dd>4 dari 30 pcs · belum datang 26 pcs<\/dd>/);
  /* each model keeps the same edit permission; its title opens the original details */
  assert.match(nota,/data-a="commerceOrderOpen" data-id="o1">Edit<\/button>/);assert.match(nota,/data-a="commerceOrderOpen" data-id="o3">Edit<\/button>/);assert.ok(!nota.includes('Jadikan bisa diedit'));
  assert.match(nota,/data-a="commerceOrderDetail" data-id="o3"><b>Topi C<\/b><\/button>/);assert.match(nota,/Order lama · riwayat tetap disimpan/);assert.match(nota,/data-a="commerceTambahModel" data-tambah="1" data-supplier="s1" data-grup=""/);assert.match(nota,/<details><summary>Riwayat DP \/ pembayaran \(3\)<\/summary>/);
  /* payments: oldest first, a combined payment is one line, corrected ones are gone, each can be changed or deleted */
  assert.deepEqual(h.json("commerceInvoiceBayar(commerceInvoiceOrders(['o1','o2','o3','o4'])).map(function(r){return [r.tanggal,r.jumlah,r.model.length,r.orderId,r.eventId,r.groupId];})"),[['2026-10-09',400,1,'o1','b',''],['2026-10-10',1000,2,'o1','a','g1']]);
  assert.match(nota,/<b>Rp1000<\/b> <span class="small muted">2026-10-10<\/span>[\s\S]*Dibagi ke 2 model/);assert.match(nota,/Rp999/);assert.match(nota,/Dikoreksi — tidak dihitung/);
  assert.match(nota,/data-a="commerceEventEdit" data-m="pembelian" data-id="o1" data-event="b">Ubah<\/button><button class="btn sm ghost" data-a="commerceInvoiceHapus" data-m="pembelian" data-id="o1" data-event="b">Hapus<\/button>/);
  /* the next payment is shared by every order that still owes, and the picture covers the whole note */
  assert.match(nota,/data-a="commerceGroupPayOpen" data-ids="o1,o2,o3" data-nama="Reseller A">Tambah DP \/ pembayaran<\/button>/);assert.match(nota,/data-a="commerceShareOpen" data-ids="o1,o2,o3">Gambar untuk supplier<\/button>/);
  h.run("S.invoice={ids:['o1']}");assert.match(h.run('commerceInvoiceHtml()'),/data-a="commercePaymentOpen" data-m="pembelian" data-id="o1">Tambah DP \/ pembayaran<\/button>/,'one order left to pay: the ordinary payment form');
  h.run("S.invoice={ids:['o4']}");assert.match(h.run('commerceInvoiceHtml()'),/sudah tidak ada di daftar/);
  /* delete one payment */
  h.run(`A.commerceInvoiceHapus(${el('o1','b')})`);assert.match(h.run('lastSheet'),/Hapus pembayaran/);assert.match(h.run('lastSheet'),/Pembayaran <b>Rp400<\/b> tanggal 2026-10-09 dihapus dari hitungan/);
  h.run("currentForm.values={id:'h1'};currentForm.module='pembelian';"+segar+"A.commerceInvoiceHapusSave(null)");
  assert.equal(h.requests[0].action,'voidCommerceEvent');assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].payload)),{id:'h1',module:'pembelian',parentId:'o1',eventId:'b',expectedRevision:'ro1',tanggal:'2026-10-08',catatan:'Dihapus: salah catat',withState:true});
  /* delete a combined payment: gone from every order in one request */
  h.run(segar+`A.commerceInvoiceHapus(${el('o2','c')})`);assert.match(h.run('lastSheet'),/Pembayaran <b>Rp1000<\/b> tanggal 2026-10-10 \(dibagi ke 2 model\)/);
  h.run("currentForm.values={id:'h2'};"+segar+"A.commerceInvoiceHapusSave(null)");
  assert.equal(h.requests[1].action,'gantiCommerceGroupPayment');assert.deepEqual(JSON.parse(JSON.stringify(h.requests[1].payload)),{id:'h2',module:'pembelian',groupId:'g1',expectedRevisions:{o1:'ro1',o2:'ro2'},tanggal:'2026-10-10',jumlah:0,metode:'transfer',catatan:'Dihapus: salah catat',withState:true});
  h.run(`A.commerceInvoiceHapus(${el('o1','x')})`);assert.match(h.json('messages').at(-1).text,/sudah tidak berlaku/);assert.equal(h.requests.length,2);
  /* the payment form points to the note, and closes first so its figures cannot go stale */
  h.run("S.invoice=null;"+segar+"A.commerceGroupPayOpen({getAttribute:function(k){return k==='data-ids'?'o1,o2':'Reseller A';}})");assert.match(h.run('lastSheet'),/data-a="commerceInvoiceDariBayar">Salah DP, jumlah, atau harga\? Buka Nota gabungan<\/button>/);
  h.run("A.commerceInvoiceDariBayar()");assert.equal(h.run('closed'),1);assert.deepEqual(h.json('S.invoice.ids'),['o1','o2']);
  h.run("A.commerceGroupPayOpen({getAttribute:function(k){return k==='data-ids'?'o1,o2':'Reseller A';}})");assert.ok(!h.run('lastSheet').includes('commerceInvoiceDariBayar'),'opened from the note: no way back offered');
  /* from the picker of ticked orders */
  h.run("S.invoice=null;currentForm._commerceGroupRows=[{id:'o1',revision:'ro1',grupNama:'Invoice Okt',supplierSnapshot:{id:'s1'}},{id:'o3',revision:'ro3',grupNama:'Invoice Okt',supplierSnapshot:{id:'s1'}}];currentForm._commerceGroupIds=['o1','o3'];A.commerceGroupInvoice(null);");
  assert.equal(h.run('closed'),2);assert.deepEqual(h.json('S.invoice.ids'),['o1','o3']);
  /* an old-app model made editable from inside the note: the note stays open and follows the new order */
  h.run("commerceData('pembelian').orders.push({id:'n3',grupNama:'Invoice Okt',supplierSnapshot:{id:'s1'}});renders=0;commerceAfterSave({action:'salinCommerceOrderLama',payload:{orderId:'o3'}},{record:{id:'n3',grupNama:'Invoice Okt',supplierSnapshot:{id:'s1'}}})");assert.deepEqual(h.json('S.invoice.ids'),['o1','n3']);assert.equal(h.run('renders'),1);
  /* Only an explicitly matching legacy invoice may gain a model; supplier alone never joins it. */
  h.run("shown=[];renders=0;commerceAfterSave({action:'saveCommerceOrder',payload:{record:{id:'o9'}}},{record:{id:'o9',grupNama:'Invoice Okt',supplierSnapshot:{id:'s1'}}})");assert.deepEqual(h.json('S.invoice.ids'),['o1','n3','o9']);assert.deepEqual(h.json('shown'),[]);assert.equal(h.run('renders'),1);
  h.run("commerceAfterSave({action:'saveCommerceOrder',payload:{record:{id:'o8'}}},{record:{id:'o8',supplierSnapshot:{id:'s1'}}})");assert.deepEqual(h.json('S.invoice.ids'),['o1','n3','o9']);assert.deepEqual(h.json('shown'),[[['o8'],true]],'same supplier but no invoice match: separate picture, original invoice untouched');
  h.run("shown=[];S.invoice=null;commerceAfterSave({action:'saveCommerceOrder',payload:{record:{id:'o7'}}},{record:{id:'o7',supplierSnapshot:{id:'s1'}}})");assert.deepEqual(h.json('shown'),[[['o7'],true]],'no note open: unchanged');
  h.run(`S.state.me.divisi='admin';A.commerceInvoiceHapus(${el('o1','b')})`);assert.match(h.json('messages').at(-1).text,/Hanya owner/);
  assert.match(html,/data-a="commerceGroupInvoice">Buka invoice<\/button>/);
});

/* ---------- 1.5.43: nota penjualan (invoice, struk, edit, arsip, hapus) dan "Hapus PO" pembelian ---------- */
const notaRows=()=>[
  {id:'n1',noNota:'SA-1',revision:'r1',status:'dp',date:'2026-10-13',customer:{name:'Budi',phone:'08',address:'Jl. A'},items:[{id:'i',name:'Oblong',color:'Hitam',size:'L',qty:10,price:5000,discPercent:0,subtotal:50000}],subtotal:50000,discountAmount:0,shipping:0,total:50000,totalPaid:20000,balance:30000,payments:[{id:'p',jumlah:20000,tanggal:'2026-10-13',metode:'cash'}],events:[{id:'p'}]},
  {id:'n2',noNota:'SA-2',revision:'r2',status:'lunas',date:'2026-10-12',customer:{name:'Ani'},items:[],total:10,totalPaid:10,balance:0,payments:[],events:[],archived:true},
  {id:'n3',noNota:'SA-3',revision:'r3',status:'batal',cancelled:true,cancelledBy:'owner',cancelReason:'Salah input',date:'2026-10-11',customer:{name:'Cici'},items:[],total:10,totalPaid:0,balance:10,payments:[],events:[]},
  {id:'n4',noNota:'SA-4',revision:'r4',status:'lunas',legacy:true,date:'2026-10-01',customer:{name:'Lama'},items:[],total:10,totalPaid:10,balance:0,payments:[{id:'q',jumlah:10}],events:[{id:'q'}]}];
const notaEl=(id,extra={})=>`{disabled:false,classList:{add:function(){},remove:function(){}},getAttribute:function(k){var x=${JSON.stringify({'data-m':'nota','data-id':id,...extra})};return x[k]===undefined?null:x[k];}}`;

test('1.5.43: the nota list opens with active notas; archived and deleted ones have their own filters',()=>{
  const h=harness();h.seed('nota',{notes:notaRows()});const view=h.run('VIEWS.nota()');
  assert.match(view,/Nota aktif/);assert.match(view,/Arsip \(1\)/);assert.match(view,/Dihapus \/ dibatalkan \(1\)/);
  let list=h.run('S.listFn()');assert.match(list,/data-id="n1"/);assert.match(list,/data-id="n4"/);assert.ok(!list.includes('data-id="n2"')&&!list.includes('data-id="n3"'));
  h.run("S.f['commerceStatus-nota']='arsip'");list=h.run('S.listFn()');assert.match(list,/data-id="n2"/);assert.match(list,/<span class="chip info">Arsip<\/span>/);assert.ok(!list.includes('data-id="n1"'));
  h.run("S.f['commerceStatus-nota']='batal'");list=h.run('S.listFn()');assert.match(list,/data-id="n3"/);assert.match(list,/<span class="chip">Dihapus<\/span>/);assert.ok(!list.includes('data-id="n2"'));
  h.run("S.f['commerceStatus-nota']='lunas'");list=h.run('S.listFn()');assert.match(list,/data-id="n4"/);assert.ok(!list.includes('data-id="n2"'),'an archived paid nota stays in the archive');
  assert.equal(h.requests.length,0);
});

test('1.5.43: the nota sheet offers edit, invoice, receipt, PDF, archive and delete as plain buttons',()=>{
  const h=harness();h.seed('nota',{notes:notaRows()});let s=h.run("commerceNotaRincian('n1')");
  assert.match(s,/<h2>Nota SA-1<\/h2>/);assert.match(s,/<b>Oblong<\/b> <span class="small muted">Hitam · L<\/span><br><span class="small muted">10 pcs × Rp5000<\/span><\/span><b>Rp50000<\/b>/);
  assert.match(s,/<dt>Total<\/dt><dd class="b">Rp50000<\/dd><dt>Sudah dibayar<\/dt><dd class="b">Rp20000<\/dd><dt>Sisa<\/dt><dd class="b">Rp30000<\/dd>/);assert.ok(!s.includes('Subtotal'),'no discount or shipping: no extra lines');
  assert.match(s,/data-a="commercePaymentOpen" data-m="nota" data-id="n1">Catat pembayaran/);assert.match(s,/data-a="commerceNotaOpen" data-id="n1">Edit nota/,'a nota with a payment can still be edited');
  assert.match(s,/data-a="commerceNotaArsip" data-m="nota" data-id="n1" data-v="1">Arsipkan/);assert.match(s,/data-a="commerceCancelOpen" data-m="nota" data-id="n1">Hapus nota/);
  assert.match(s,/data-a="commerceNotaCetak" data-m="nota" data-id="n1">Cetak invoice<\/button><button class="btn" data-a="commerceNotaStruk" data-m="nota" data-id="n1">Struk thermal<\/button><button class="btn pri" data-a="commerceNotaPdf" data-m="nota" data-id="n1">Unduh PDF/);
  s=h.run("commerceNotaRincian('n2')");assert.match(s,/data-v="0">Keluarkan dari arsip/);assert.match(s,/<span class="chip info">Arsip<\/span>/);
  s=h.run("commerceNotaRincian('n3')");assert.match(s,/sudah dihapus dan tidak dihitung\. Alasan: Salah input/);assert.match(s,/data-a="commerceRestore" data-m="nota" data-id="n3">Kembalikan nota/);assert.ok(!s.includes('Edit nota')&&!s.includes('Arsipkan')&&!s.includes('Hapus nota')&&!s.includes('Catat pembayaran'));assert.match(s,/commerceNotaCetak/,'a deleted nota can still be printed');
  s=h.run("commerceNotaRincian('n4')");assert.match(s,/Nota dari data lama disimpan tetap\./);assert.ok(!s.includes('Edit nota')&&!s.includes('Hapus nota'),'an old paid nota is neither edited nor deleted here');assert.match(s,/>Arsipkan</);
  h.run('A.commerceNotaDetail('+notaEl('n1')+')');assert.match(h.run('lastSheet'),/<h2>Nota SA-1<\/h2>/);
  const admin=harness();admin.run("S.state.me={id:'adm',divisi:'admin'};");admin.seed('nota',{notes:notaRows()});s=admin.run("commerceNotaRincian('n1')");assert.ok(!s.includes('Hapus nota'));assert.match(s,/Edit nota/);assert.match(s,/>Arsipkan</);assert.ok(!admin.run("commerceNotaRincian('n3')").includes('Kembalikan nota'));
  assert.match(h.run("commerceNotaRincian('tidak-ada')"),/belum tersedia/);
});

test('1.5.43: invoice, thermal receipt and PDF are made from the saved nota',async()=>{
  const h=harness();h.seed('nota',{notes:notaRows()});
  h.run("var cetakan=[],tutup=0,ls={},LS={get:function(k){return ls[k]===undefined?null:ls[k];},set:function(k,v){ls[k]=String(v);}};function closeSheet(){tutup++;}function dokumenCetakBuka(html,o){cetakan.push({html:html,o:o});return Promise.resolve({preview:true});}function coreNotaInvoiceHtml(r,s,o){return 'INV '+r.id+' '+(o.logo||'tanpa-logo');}function coreNotaStrukHtml(r,s,o){return 'STRUK '+r.id+' '+o.lebar;}var LOGO_SRC='data:image/webp;base64,AAAA';");
  await h.run('A.commerceNotaCetak('+notaEl('n1')+')');assert.equal(h.run('cetakan[0].html'),'INV n1 data:image/webp;base64,AAAA');assert.deepEqual(h.json('[cetakan[0].o.nama,cetakan[0].o.tanda]'),['invoice','.invoice']);
  h.run('A.commerceNotaStruk('+notaEl('n1')+')');assert.match(h.run('lastSheet'),/<h2>Struk thermal<\/h2>/);
  assert.match(h.run('lastSheet'),/<button class="btn pri" data-a="commerceNotaStrukCetak" data-m="nota" data-id="n1" data-w="58">Kertas 58 mm<\/button><button class="btn" data-a="commerceNotaStrukCetak" data-m="nota" data-id="n1" data-w="80">Kertas 80 mm/);
  await h.run('A.commerceNotaStrukCetak('+notaEl('n1',{'data-w':'80'})+')');assert.equal(h.run('cetakan[1].html'),'STRUK n1 80');assert.equal(h.run('ls.pk_struk_lebar'),'80');assert.equal(h.run('tutup'),1);
  /* the page of a receipt is as long as the receipt itself */
  h.run("var gaya=[],dok={querySelector:function(){return {getBoundingClientRect:function(){return {height:378};}};},createElement:function(){return {};},head:{appendChild:function(x){gaya.push(x.textContent);}}};cetakan[1].o.siap(dok);");assert.deepEqual(h.json('gaya'),['@page{size:80mm 107mm;margin:0}']);
  h.run('A.commerceNotaStruk('+notaEl('n1')+')');assert.match(h.run('lastSheet'),/<button class="btn" data-a="commerceNotaStrukCetak" data-m="nota" data-id="n1" data-w="58">Kertas 58 mm<\/button><button class="btn pri"[^>]*data-w="80">/,'the last width is the marked one');
  await h.run('A.commerceNotaPdf('+notaEl('n1')+')');assert.deepEqual(h.json('pdfs[0]'),{action:'makeCommercePdf',payload:{module:'nota',id:'n1'}},'no picture tools in this test: the PDF is asked for without a logo');
  h.run("commerceNotaLogoPng.hasil='data:image/png;base64,BBBB'");await h.run('A.commerceNotaPdf('+notaEl('n1')+')');assert.deepEqual(h.json('pdfs[1].payload'),{module:'nota',id:'n1',logo:'data:image/png;base64,BBBB'});
  h.run("Api.mode=function(){return 'demo';}");h.seed('nota',{notes:notaRows()});await h.run('A.commerceNotaPdf('+notaEl('n1')+')');assert.equal(h.run('cetakan.length'),3,'the demo has no server PDF: it prints');assert.equal(h.run('pdfs.length'),2);
  h.run('A.commerceNotaCetak('+notaEl('tidak-ada')+')');assert.match(h.json('messages').at(-1).text,/belum tersedia/);
});

test('1.5.43: archive is one tap; deleting a paid nota also corrects its payments; a deleted nota can come back',async()=>{
  const h=harness();h.seed('nota',{notes:notaRows()});h.run("var tutup=0;function closeSheet(){tutup++;}");
  const tunggu=h.run('A.commerceNotaArsip('+notaEl('n1',{'data-v':'1'})+')');assert.equal(h.requests[0].action,'arsipCommerceNota');assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].payload)),{id:'n1',expectedRevision:'r1',arsip:true,withState:true});
  const baru=notaRows();baru[0].archived=true;baru[0].revision='r1b';h.requests[0].resolve({record:baru[0],commerce:reply('nota',{notes:baru},11)});await tunggu;await turn();
  assert.equal(h.run("commerceRecord('nota','n1').archived"),true,'the list in the answer is used at once');assert.equal(h.run('tutup'),1);assert.match(h.json('messages').at(-1).text,/masuk arsip/);
  const lepas=h.run('A.commerceNotaArsip('+notaEl('n1',{'data-v':'0'})+')');assert.deepEqual(JSON.parse(JSON.stringify(h.requests[1].payload)),{id:'n1',expectedRevision:'r1b',arsip:false,withState:true});
  h.requests[1].resolve({record:notaRows()[0],commerce:reply('nota',{notes:notaRows()},12)});await lepas;await turn();assert.equal(h.run("commerceRecord('nota','n1').archived"),undefined);assert.equal(h.run('tutup'),1,'taking a nota out of the archive keeps its sheet open');
  /* delete: the reason is already filled in; a paid nota asks the server to correct the payments too */
  const d=harness();d.seed('nota',{notes:notaRows()});d.run('A.commerceCancelOpen('+notaEl('n1')+')');
  assert.match(d.run('lastSheet'),/<h2>Hapus nota<\/h2>/);assert.match(d.run('lastSheet'),/<b>Nota SA-1<\/b> dihapus dari daftar/);assert.match(d.run('lastSheet'),/Pembayaran yang sudah dicatat \(Rp20000\) ikut dikoreksi/);assert.match(d.run('lastSheet'),/<textarea name="catatan">Salah input<\/textarea>/);
  d.run("currentForm.values={id:'n1',revision:'r1',catatan:'Salah input'};currentForm.module='nota';currentForm._commerceScope=commerceScope();A.commerceCancelSave(null)");
  assert.equal(d.requests[0].action,'cancelCommerceRecord');assert.deepEqual(JSON.parse(JSON.stringify(d.requests[0].payload)),{module:'nota',id:'n1',expectedRevision:'r1',catatan:'Salah input',voidAll:true,withState:true});
  const u=harness(),belum=notaRows();belum[0].totalPaid=0;belum[0].payments=[];belum[0].events=[];u.seed('nota',{notes:belum});u.run('A.commerceCancelOpen('+notaEl('n1')+')');assert.ok(!u.run('lastSheet').includes('ikut dikoreksi'));
  u.run("currentForm.values={id:'n1',revision:'r1',catatan:'Salah input'};currentForm.module='nota';currentForm._commerceScope=commerceScope();A.commerceCancelSave(null)");assert.deepEqual(JSON.parse(JSON.stringify(u.requests[0].payload)),{module:'nota',id:'n1',expectedRevision:'r1',catatan:'Salah input',withState:true});
  /* bring a deleted nota back */
  const k=harness();k.seed('nota',{notes:notaRows()});k.run('A.commerceRestore('+notaEl('n3')+')');assert.match(k.run('lastSheet'),/<h2>Kembalikan nota<\/h2>/);assert.match(k.run('lastSheet'),/tidak kembali otomatis/);
  k.run("currentForm.values={id:'n3',revision:'r3'};currentForm.module='nota';currentForm._commerceScope=commerceScope();A.commerceRestoreSave(null)");assert.equal(k.requests[0].action,'restoreCommerceRecord');assert.deepEqual(JSON.parse(JSON.stringify(k.requests[0].payload)),{module:'nota',id:'n3',expectedRevision:'r3',withState:true});
});

test('1.5.43: editing a paid nota explains the limit and refuses a total below what was paid',()=>{
  const h=harness();h.seed('nota',{notes:notaRows()});h.run('A.commerceNotaOpen('+notaEl('n1')+')');assert.match(h.run('lastSheet'),/Nota ini sudah dibayar <b>Rp20000<\/b>/);
  h.form({id:'n1',revision:'r1',date:'2026-10-13',customerName:'Budi',customerType:'walkin',phone:'',address:'',discountPercent:'0',shipping:'0',notes:''},'nota',[{id:'i',values:{lineName:'Oblong',size:'L',color:'Hitam',qty:'1',price:'19999',discPercent:'0'}}]);
  h.run("currentForm._commerceOriginal=commerceRecord('nota','n1');A.commerceNotaSave(null)");assert.equal(h.requests.length,0);assert.match(h.json('messages').at(-1).text,/lebih kecil dari yang sudah dibayar Rp20000/);
  h.run("currentForm.rows[0].values.price='20000';A.commerceNotaSave(null)");assert.equal(h.requests.length,1);assert.equal(h.requests[0].action,'saveCommerceNota');assert.equal(h.requests[0].payload.expectedRevision,'r1');assert.equal(h.requests[0].payload.record.items[0].price,20000);
  const baru=harness();baru.seed('nota',{notes:[]});baru.run("A.commerceNotaOpen({getAttribute:function(){return null;}})");assert.ok(!baru.run('lastSheet').includes('sudah dibayar'));
});

test('1.5.43: "Hapus PO" is a plain button in the purchase invoice, outside "Kelola PO", with the reason filled in',()=>{
  const h=harness();h.seed('pembelian',{suppliers:[],products:[],orders:[{id:'o9',revision:'r9',status:'dp',productName:'Kaos',items:[],totalHarga:10,totalPaid:1,balance:9}]});
  const tombol=h.run("commerceOrderLifecycle(commerceRecord('pembelian','o9'))");
  assert.match(tombol,/^<button class="btn sm ghost" style="color:var\(--bad\)" data-a="commerceCancelOpen" data-m="pembelian" data-id="o9" data-mode="archived">Hapus PO<\/button><details class="small"><summary>Kelola PO<\/summary><div class="row wrap"><button class="btn sm" data-a="commerceCancelOpen" data-m="pembelian" data-id="o9" data-mode="inactive">Nonaktifkan PO<\/button><\/div><\/details>$/);
  h.run("A.commerceCancelOpen({getAttribute:function(k){return k==='data-m'?'pembelian':k==='data-mode'?'archived':'o9';}})");assert.match(h.run('lastSheet'),/<h2>Hapus PO<\/h2>/);assert.match(h.run('lastSheet'),/<textarea name="catatan">Salah input<\/textarea>/);assert.equal(h.run('currentForm._commerceVoidAll'),false);
  h.run("A.commerceCancelOpen({getAttribute:function(k){return k==='data-m'?'pembelian':k==='data-mode'?'inactive':'o9';}})");assert.match(h.run('lastSheet'),/<textarea name="catatan"><\/textarea>/,'pausing a PO still asks for its own reason');
  h.run("S.state.me={id:'adm',divisi:'admin'};");assert.equal(h.run("commerceOrderLifecycle({id:'o9',status:'dp'})"),'','an admin gets neither button');
});
