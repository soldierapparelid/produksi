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
  assert.match(h.run('orderPage'),/data-a="commerceOrderDetail"[^>]*><span class="thumb" data-img="cm\.p1"/);assert.match(h.run('productPage'),/data-kind="products"[^>]*><span class="thumb" data-img="cm\.p1"/);
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
  const open=card('open');assert.match(open,/Kaos Oversize Hitam/);assert.match(open,/\(2 varian\)/);assert.match(open,/M \(6\), L \(4\)/);assert.match(open,/3\/10 diterima/);assert.match(open,/Dibayar Rp4000/);assert.match(open,/Sisa Rp6000/);
  assert.match(open,/data-a="commercePaymentOpen" data-m="pembelian" data-id="open">Bayar/);assert.match(open,/data-a="commerceReceiptOpen" data-m="pembelian" data-id="open">Terima/);
  for(const id of ['done','cancelled','held']){const c=card(id);assert.ok(!c.includes('commercePaymentOpen'),id+' offers no payment');assert.ok(!c.includes('commerceReceiptOpen'),id+' offers no receipt');}
  h.run("S.listFn=null;S.sub.commercePurchase='orders';var listed=VIEWS['pembelian-produk']();");assert.match(h.run('listed'),/class="grid g-kpi"[\s\S]*class="corder"/);
  h.run("S.sub.commercePurchase='products';var masters=VIEWS['pembelian-produk']();");assert.ok(!h.run('masters').includes('g-kpi'));
});
const shopOrders=()=>{const base={produkId:'p1',productName:'Kaos',supplierName:'Supplier A',supplierSnapshot:{id:'s1'},tanggalOrder:'2026-10-08',hargaSatuan:1000,items:[{id:'a',nama:'M',jumlah:6},{id:'b',nama:'L',jumlah:4}],totalQty:10,totalHarga:10000,events:[],payments:[],receivedByItem:{}};
  return [{...base,id:'o1',revision:'r1',status:'dp',totalPaid:4000,balance:6000,totalReceived:6,receivedByItem:{a:6},payments:[{id:'x1',tanggal:'2026-10-08',jumlah:3000,catatan:'DP'},{id:'x2',tanggal:'2026-10-08',jumlah:1000,catatan:'DP'},{id:'x3',tanggal:'2026-10-09',jumlah:500,catatan:'salah',voided:true}]},{...base,id:'o2',revision:'r2',produkId:'p2',productName:'Topi',status:'pending',totalPaid:0,balance:10000,totalReceived:0},{...base,id:'o3',revision:'r3',status:'batal',totalPaid:0,balance:10000,totalReceived:0},{...base,id:'o4',revision:'r4',tanggalOrder:'2026-10-01',status:'pending',totalPaid:0,balance:10000,totalReceived:0},{...base,id:'o5',revision:'r5',supplierSnapshot:{id:'s2'},supplierName:'Supplier B',status:'review',needsReview:true,paymentReview:true,receiptReview:true,totalPaid:0,balance:0,totalReceived:3}];};
test('orders are grouped as in the earlier app and the group offers one payment and one combined note',()=>{
  const h=harness();h.seed('pembelian',{suppliers:[{id:'s1',nama:'Supplier A',kontak:'0811',alamat:'Bandung'}],products:[],orders:shopOrders()});
  const groups=h.json("commerceOrderGroups(commerceData('pembelian').orders).map(function(g){return g.orders.map(function(o){return o.id;});})");assert.deepEqual(groups,[['o1','o2','o3'],['o4'],['o5']]);
  h.run("S.listFn=null;S.sub.commercePurchase='orders';var grouped=VIEWS['pembelian-produk']();");const page=h.run('grouped');
  assert.equal((page.match(/class="cgroup"/g)||[]).length,1);assert.match(page,/data-a="commerceGroupPayOpen" data-ids="o1,o2"/,'only orders that can still be paid');assert.match(page,/data-a="commerceShareOpen" data-ids="o1,o2"/,'a cancelled order is left out of the combined note');assert.match(page,/2 model · 20 pcs · Rp20000/);assert.match(page,/Sisa bayar<\/span><br><b>Rp16000/);
  h.run("var named=commerceData('pembelian').orders.map(function(o){return Object.assign({},o);});named[0].grupNama='Paket Topi';named[3].grupNama='Paket Topi';");assert.deepEqual(h.json("commerceOrderGroups(named).map(function(g){return g.orders.map(function(o){return o.id;});})"),[['o1','o4'],['o2','o3'],['o5']]);
});
test('group payment sends one stable request with every order revision and never more than the group still owes',()=>{
  const h=harness();h.seed('pembelian',{suppliers:[],products:[],orders:shopOrders()});const el=ids=>`{getAttribute:function(k){return k==='data-ids'?${JSON.stringify(ids)}:'Supplier A';}}`;
  h.run(`A.commerceGroupPayOpen(${el('o1,o3')})`);assert.match(h.json('messages').at(-1).text,/tidak ada dua order/);
  h.run(`A.commerceGroupPayOpen(${el('o1,o2,o3,o5')})`);assert.match(h.run('lastSheet'),/Bayar grup — Supplier A/);assert.match(h.run('lastSheet'),/2 order/);assert.deepEqual(h.json('currentForm._commerceGroupOrders'),[{id:'o1',revision:'r1',balance:6000},{id:'o2',revision:'r2',balance:10000}]);
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
test('the new-order form follows supplier, product, variants, details; products are limited to the chosen supplier',()=>{
  const h=harness();h.seed('pembelian',{suppliers:[{id:'s1',nama:'Supplier A'},{id:'s2',nama:'Supplier B',aktif:false}],products:[{id:'p1',nama:'Kaos',model:'Oversize',supplierId:'s1',harga:45000},{id:'p2',nama:'Topi',supplierId:'s2'},{id:'p3',nama:'Lama',supplierId:'s1',aktif:false}],orders:[]});
  assert.match(h.run("commerceProductOptions('','')"),/Pilih supplier dulu/);const choices=h.run("commerceProductOptions('s1','')");assert.match(choices,/Kaos · Oversize/);assert.ok(!/Topi|Lama/.test(choices));
  assert.ok(!h.run("commerceSupplierOptions('')").includes('Supplier B'),'an inactive supplier is not offered for a new order');assert.match(h.run("commerceSupplierOptions('s2')"),/value="s2" selected/);
  h.run("A.commerceOrderOpen({getAttribute:function(){return null;}})");const form=h.run('lastSheet');for(const part of ['1. Supplier','2. Produk dan harga','3. Varian','4. Detail order','name="supplierPick"','name="produkId"','data-kind="suppliers"','data-kind="products"','DP awal'])assert.ok(form.includes(part),part);
  assert.ok(form.indexOf('1. Supplier')<form.indexOf('2. Produk dan harga')&&form.indexOf('3. Varian')<form.indexOf('4. Detail order'));
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
  assert.equal(m.usaha,'SOLDIER APPAREL');assert.equal(m.judul,'ORDER GABUNGAN — 2 PRODUK');assert.deepEqual(m.supplier,{nama:'Supplier A',detail:'0811 · Bandung'});
  assert.deepEqual(m.orders[0].baris,[{nama:'M',jumlah:6,diterima:6,sisa:0,subtotal:6000},{nama:'L',jumlah:4,diterima:0,sisa:4,subtotal:4000}]);assert.equal(m.orders[0].beres,false);assert.equal(m.orders[1].diterima,0);
  assert.equal(m.total,20000);assert.equal(m.qty,20);assert.equal(m.diterima,6);assert.equal(m.dibayar,4000);assert.equal(m.sisa,16000);
  assert.deepEqual(m.pembayaran,[{tanggal:'2026-10-08',catatan:'DP',jumlah:4000}],'payments of the same day and note are shown as one line; corrected ones are left out');
  const held=h.json("commerceShareModel([commerceFind('pembelian','orders','o5')])");assert.equal(held.judul,'ORDER PRODUK');assert.equal(held.orders[0].baris[0].diterima,null);assert.equal(held.orders[0].baris[0].sisa,null);assert.equal(held.orders[0].diterima,3);
});
test('purchase and sales pages are fetched quietly once per sign-in after the main data, never for a worker',()=>{
  const h=harness();h.run("var timers=[];setTimeout=function(fn){timers.push(fn);return timers.length;};clearTimeout=function(){};Api.mode=function(){return 'remote';};commercePrefetch();commercePrefetch();");
  assert.equal(h.run('timers.length'),1);assert.equal(h.requests.length,0);h.run('timers[0]()');assert.deepEqual(h.requests.map(r=>r.payload.module),['pembelian','nota']);
  const worker=harness();worker.run("var timers=[];setTimeout=function(fn){timers.push(fn);return 1;};S.state.me={id:'w',divisi:'potong'};commercePrefetch();");assert.equal(worker.run('timers.length'),0);
  const demo=harness();demo.run("var timers=[];setTimeout=function(fn){timers.push(fn);return 1;};Api.mode=function(){return 'demo';};commercePrefetch();");assert.equal(demo.run('timers.length'),0);
});
test('each order offers Edit and Hapus where allowed; a removed order leaves the normal list; removal with payments is one owner request',()=>{
  const h=harness(),orders=shopOrders();orders.push({...orders[1],id:'old',revision:'ro',legacy:true,status:'dp',totalPaid:1000,balance:9000},{...orders[1],id:'oldclean',revision:'rc',legacy:true});
  h.seed('pembelian',{suppliers:[],products:[],orders});const card=id=>h.run("commerceOrderCard(commerceFind('pembelian','orders',"+JSON.stringify(id)+"))");
  assert.match(card('o1'),/data-a="commerceOrderOpen" data-id="o1">Edit/);assert.match(card('o1'),/data-a="commerceCancelOpen" data-m="pembelian" data-id="o1">Hapus/);
  for(const id of ['o3','o5','old']){assert.ok(!card(id).includes('>Edit<'),id+' is not editable');}assert.match(card('old'),/>Hapus</,'the owner can remove an imported order from the list');assert.match(card('oldclean'),/>Hapus</);assert.ok(!card('oldclean').includes('>Edit<'));
  h.run("S.listFn=null;S.sub.commercePurchase='orders';var normal=VIEWS['pembelian-produk']();S.f['commerceStatus-pembelian']='batal';var removed=S.listFn();S.f['commerceStatus-pembelian']='';");
  assert.ok(!h.run('normal').includes('data-id="o3"'),'removed orders are not in the normal list');assert.match(h.run('removed'),/data-id="o3"/);
  const el=id=>`{getAttribute:function(k){return k==='data-m'?'pembelian':${JSON.stringify(id)};}}`;
  h.run(`A.commerceCancelOpen(${el('o1')})`);assert.match(h.run('lastSheet'),/Hapus order/);assert.match(h.run('lastSheet'),/pembayaran <b>Rp4000<\/b> dan penerimaan <b>6 pcs<\/b>/);assert.equal(h.run('currentForm._commerceVoidAll'),true);
  h.run("currentForm.values={id:'o1',revision:'r1',catatan:''};currentForm.module='pembelian';currentForm._commerceScope=commerceScope();A.commerceCancelSave(null)");assert.equal(h.requests.length,0,'a reason is required');
  h.run("currentForm.values.catatan=' tidak jadi ';A.commerceCancelSave(null)");assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].payload)),{module:'pembelian',id:'o1',expectedRevision:'r1',catatan:'tidak jadi',voidAll:true,withState:true});
  const plain=harness();plain.seed('pembelian',{suppliers:[],products:[],orders:shopOrders()});plain.run(`A.commerceCancelOpen(${el('o2')})`);assert.equal(plain.run('currentForm._commerceVoidAll'),false);
  /* an order from the old data (or one still marked for review) leaves the list with its old payments untouched, and can come back */
  const old=harness(),rows=shopOrders();rows.push({...rows[1],id:'old',revision:'ro',legacy:true,status:'dp',totalPaid:1000,balance:9000},{...rows[1],id:'gone',revision:'rg',legacy:true,status:'batal',cancelledBy:'u',cancelKeepsEvents:true},{...rows[1],id:'oldgone',revision:'rx',legacy:true,status:'batal'});
  old.seed('pembelian',{suppliers:[],products:[],orders:rows});old.run(`A.commerceCancelOpen(${el('old')})`);assert.match(old.run('lastSheet'),/pembayaran dan penerimaan lamanya tidak diubah/);assert.equal(old.run('currentForm._commerceVoidAll'),false);assert.equal(old.run('currentForm._commerceArsip'),true);
  old.run("currentForm.values={id:'old',revision:'ro',catatan:'dobel'};currentForm.module='pembelian';currentForm._commerceScope=commerceScope();A.commerceCancelSave(null)");assert.deepEqual(JSON.parse(JSON.stringify(old.requests[0].payload)),{module:'pembelian',id:'old',expectedRevision:'ro',catatan:'dobel',arsip:true,withState:true});
  const back=id=>old.run("commerceOrderCard(commerceFind('pembelian','orders',"+JSON.stringify(id)+"))");assert.match(back('gone'),/data-a="commerceRestore" data-m="pembelian" data-id="gone">Kembalikan ke daftar/);assert.ok(!back('oldgone').includes('commerceRestore'),'an order cancelled in the old data stays as it came');
  const again=harness();again.seed('pembelian',{suppliers:[],products:[],orders:rows});again.run(`A.commerceRestore(${el('gone')})`);assert.match(again.run('lastSheet'),/lamanya ikut kembali/);
  again.run("currentForm.values={id:'gone',revision:'rg'};currentForm.module='pembelian';currentForm._commerceScope=commerceScope();A.commerceRestoreSave(null)");
  assert.equal(again.requests[0].action,'restoreCommerceRecord');assert.deepEqual(JSON.parse(JSON.stringify(again.requests[0].payload)),{module:'pembelian',id:'gone',expectedRevision:'rg',withState:true});
  const admin=harness();admin.run("S.state.me={id:'adm',divisi:'admin'};");admin.seed('pembelian',{suppliers:[],products:[],orders:shopOrders()});assert.ok(!admin.run("commerceOrderCard(commerceFind('pembelian','orders','o2'))").includes('>Hapus<'));assert.match(admin.run("commerceOrderCard(commerceFind('pembelian','orders','o2'))"),/>Edit</);admin.run(`A.commerceCancelOpen(${el('o2')})`);assert.match(admin.json('messages').at(-1).text,/Hanya owner/);
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
  const h=harness();h.seed('pembelian',{orders:[{id:'old',legacy:true,receiptReview:true,needsReview:true,reviewReasons:['Unknown source item'],productName:'Product',items:[{id:'i',nama:'M',jumlah:10}],events:[{id:'old-receipt'}],payments:[],receipts:[],totalHarga:100,totalPaid:0,balance:100,totalReceived:2}]});const body=h.run("commerceDetail('pembelian','old')");assert.match(body,/Unknown source item/);assert.ok(!body.includes('data-a="commerceReceiptOpen"'));assert.ok(!body.includes('data-a="commerceOrderOpen"'));assert.match(body,/commercePaymentOpen/);
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
  const h=harness();h.run("var groupRows=[{id:'a',supplierSnapshot:{id:'supplier-1'}},{id:'b',supplierSnapshot:{id:'supplier-1'}},{id:'c',supplierSnapshot:{id:'supplier-2'}},{id:'legacy'}];");
  assert.deepEqual(h.json("commerceGroupSelection(groupRows,['b','a']).map(r=>r.id)"),['b','a']);
  for(const ids of [[],['a','a'],['a','c'],['legacy'],['missing'],Array.from({length:21},(_,i)=>'id'+i)])assert.throws(()=>h.run('commerceGroupSelection(groupRows,'+JSON.stringify(ids)+')'));
  assert.equal(h.requests.length,0);
});

test('group print and PDF preserve individual order models and the revisions selected for printing',async()=>{
  const h=harness();h.form({},'pembelian');h.run("currentForm._commerceGroupRows=[{id:'a',revision:'rev-a',supplierSnapshot:{id:'s'},items:[{id:'a-M',jumlah:2}]},{id:'b',revision:'rev-b',supplierSnapshot:{id:'s'},items:[{id:'b-L',jumlah:3}]}];currentForm._commerceGroupIds=['b','a'];");
  await h.run('A.commerceGroupPrint(null)');await h.run('A.commerceGroupPdf(null)');
  assert.deepEqual(h.json('prints[0].map(r=>({id:r.reference,items:r.rows}))'),[{id:'b',items:[{id:'b-L',jumlah:3}]},{id:'a',items:[{id:'a-M',jumlah:2}]}]);
  assert.deepEqual(h.json('pdfs[0]'),{action:'makeCommercePdf',payload:{module:'pembelian',ids:['b','a'],expectedRevisions:{b:'rev-b',a:'rev-a'}}});
  assert.equal(h.requests.length,0,'printing does not create payment or receipt events');
});

test('the combined supplier picture starts from the unfinished orders of the supplier and opens the picture for the chosen ones',()=>{
  const h=harness();h.form({},'pembelian');
  h.run("currentForm._commerceGroupRows=[{id:'a',revision:'ra',status:'dp',balance:5,supplierSnapshot:{id:'s'}},{id:'b',revision:'rb',status:'selesai',balance:0,supplierSnapshot:{id:'s'}},{id:'c',revision:'rc',status:'batal',balance:9,supplierSnapshot:{id:'s'}},{id:'d',revision:'rd',status:'pending',balance:7,supplierSnapshot:{id:'s'}},{id:'e',revision:'re',status:'pending',balance:7,supplierSnapshot:{id:'lain'}},{id:'f',revision:'rf',status:'lunas',balance:0,supplierSnapshot:{id:'s'}},{id:'g',revision:'rg',status:'review',balance:4,needsReview:true,supplierSnapshot:{id:'s'}},{id:'h',revision:'rh',status:'dp',balance:4,paymentReview:true,supplierSnapshot:{id:'s'}}];");
  assert.deepEqual(h.json("commerceGroupAwal(currentForm,'s')"),['a','d'],'only orders that still have something to pay and need no review are ticked');
  h.run("var shown=[];commerceShareShow=function(ids,fresh){shown.push([ids,fresh]);};currentForm._commerceGroupIds=['d','a'];A.commerceGroupShare(null);");
  assert.deepEqual(h.json('shown'),[[['d','a'],false]]);assert.equal(h.requests.length,0,'making the picture records nothing');
  h.run("currentForm._commerceGroupIds=[];A.commerceGroupShare(null);");assert.equal(h.json('shown').length,1);assert.match(h.json('messages').at(-1).text,/Pilih 1 sampai 20 order/);
  assert.match(html,/data-a="commerceGroupOpen">' \+ ic\('img'\) \+ 'Gambar gabungan<\/button>/);assert.match(html,/class="tools" style="align-items:flex-end">' \+ fSelect\('Status order'/);
  assert.match(html,/\['DP \/ sudah dibayar', uang\(m\.dibayar\), HIJAU\]/);assert.doesNotMatch(html,/Cetak gabungan/);
});
test('a combined down payment is recorded for the ticked orders and the supplier picture follows with the new figures',async()=>{
  const h=harness();h.seed('pembelian',{suppliers:[{id:'s1',nama:'Supplier A'}],products:[],orders:shopOrders()});h.form({},'pembelian');
  h.run("var shown=[],closed=0;commerceShareShow=function(ids,fresh){shown.push([ids,fresh]);};function closeSheet(){closed++;}");
  h.run("currentForm._commerceGroupRows=[{id:'o1',revision:'r1',supplierSnapshot:{id:'s1'}},{id:'o2',revision:'r2',supplierSnapshot:{id:'s1'}}];currentForm._commerceGroupIds=['o1','o2'];A.commerceGroupBayar(null);");
  assert.equal(h.run('closed'),1,'the picker closes before the payment form opens');assert.match(h.run('lastSheet'),/Bayar grup — /);assert.match(h.run('lastSheet'),/2 order/);assert.deepEqual(h.json('currentForm._commerceGabungIds'),['o1','o2']);
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
