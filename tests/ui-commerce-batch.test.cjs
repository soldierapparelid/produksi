'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),block=html.slice(html.indexOf('/* COMMERCE UI START'),html.indexOf('/* COMMERCE UI END */'));
function harness(){
 const requests=[],c=vm.createContext({console,setTimeout,clearTimeout,transport(action,payload){return new Promise((resolve,reject)=>requests.push({action,payload:JSON.parse(JSON.stringify(payload)),resolve,reject}));}});
 vm.runInContext(['src/core.js','src/reconcile-legacy.js','src/commerce.js'].map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n'),c);
 vm.runInContext(`var A={},C={},R={},VIEWS={},S={token:'owner-session',state:{me:{id:'owner',divisi:'owner'},settings:{}},f:{},sub:{},tab:'beranda',img:{}},Api={mode:function(){return 'gas';},div:function(){return '';}},UI_VERSION='ui-test',IMG_TOKO='cm.',seq=0,messages=[],drops=0,shown=[],lastSheet='',currentForm;
 function me(){return S.state.me;}function isAdmin(){return me().divisi==='owner'||me().divisi==='admin';}function req(a,p){return transport(a,p);}function refresh(){}function render(){}function toast(s){messages.push(s);}function quiet(){}function nf(x){return String(Number(x)||0);}function rp(x){return 'Rp'+Number(x);}function tgl(x){return x||'';}function todayYmd(){return '2026-10-11';}function newId(){return 'new_'+(++seq);}function ic(){return '';}function inisial(){return '';}function hydrateImages(){}function act(el,p){return Promise.resolve(p);}function emptyBox(s){return s;}function seg(){return '';}function searchBox(){return '';}function cocok(){return true;}function paintList(){}function esc(x){return String(x==null?'':x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}function hid(k,v){return '<input name="'+k+'" value="'+esc(v)+'">';}function fCatatan(x){return '<textarea name="catatan">'+esc(x||'')+'</textarea>';}function footSave(a,label){return label||a;}function sheetHtml(t,b,f){return t+b+(f||'');}function openSheet(fn){lastSheet=fn();}function dropForm(){drops++;}function topForm(){return currentForm;}function formVals(f){return f.values||{};}var window={scrollTo:function(){}},Idb={put:function(){},del:function(){}},LS={};
 function commerceSnapKey(m){return 'pks_cm_'+m+'_pusat';}
 function field(scope,name){var node={closest:function(s){return s==='[data-commerce-model]'?scope:currentForm;},getAttribute:function(k){return null;}};Object.defineProperty(node,'value',{get:function(){return scope.values[name]||'';},set:function(v){scope.values[name]=v;}});Object.defineProperty(node,'innerHTML',{get:function(){return node.markup||'';},set:function(v){node.markup=v;var chosen=v.match(/<option value="([^"]*)" selected/);scope.values[name]=chosen?chosen[1]:'';}});return node;}
 function line(id,name,qty){return {values:{lineName:name,lineQty:qty},getAttribute:function(){return id;},closest:function(){return currentForm;}};}
 function model(row){var m={id:row.id,values:{produkId:row.produkId||'',hargaSatuan:row.hargaSatuan||''},lines:(row.items||[]).map(function(i){return line(i.id,i.nama,i.jumlah);}),title:{},subtotal:{},getAttribute:function(){return row.id;},closest:function(){return currentForm;},remove:function(){currentForm.models=currentForm.models.filter(function(x){return x!==m;});}};m.product=field(m,'produkId');m.price=field(m,'hargaSatuan');m.box={insertAdjacentHTML:function(pos,s){var id=s.match(/data-commerce-line data-id="([^"]+)"/)[1];m.lines.push(line(id,'',''));}};return m;}
 function makeForm(values,rows){var f={values:values||{},models:(rows||[]).map(model),fields:[],sheet:{buttons:[]},note:{hidden:true,innerHTML:''},total:{},getAttribute:function(k){return k==='data-module'?'pembelian':null;},hasAttribute:function(k){return k==='data-commerce-order';},setAttribute:function(){},closest:function(){return this.sheet;}};f.supplier=field(f,'supplierPick');f.box={insertAdjacentHTML:function(pos,s){var id=s.match(/data-commerce-model data-id="([^"]+)"/)[1],itemId=s.match(/data-commerce-line data-id="([^"]+)"/)[1];f.models.push(model({id:id,items:[{id:itemId,nama:'Standar',jumlah:''}]}));}};return f;}
 function $(s,f){if(s==='[data-commerce-note]')return f.note;if(s==='[data-commerce-batch-total]')return f.total;if(s==='[data-commerce-models]')return f.box;if(s==='[data-commerce-lines]')return f.box;if(s==='[data-commerce-model-title]')return f.title;if(s==='[data-commerce-model-total]')return f.subtotal;if(s==='[name="supplierPick"]')return f.supplier;if(s==='[name="produkId"]')return f.product;if(s==='[name="hargaSatuan"]')return f.price;return null;}
 function $$(s,f){if(s==='[data-commerce-model]')return f.models||[];if(s==='[data-commerce-line]')return f.lines||((f.models||[]).flatMap(function(m){return m.lines;}));if(s==='.sheet-f button')return f.buttons||[];return f.fields||[];}
 currentForm=makeForm({},[]);
 function proofRows(p,voided){var proof=coreCommerceOrderBatchProof(p),pay=p.initialPayment||{},ids=p.orders.map(function(o){return o.id;}),totals=p.orders.map(function(o){return o.items.reduce(function(n,i){return n+i.jumlah*o.hargaSatuan;},0);}),shares=pay.jumlah?coreCommerceSplit(pay.jumlah,totals):totals.map(function(){return 0;});return p.orders.map(function(o,i){return Object.assign({},o,{invoiceId:p.id,invoiceProof:proof,invoiceOrderIds:ids,createdBy:'owner',payments:shares[i]?[{id:'gp_'+coreCommerceHash([p.id,o.id]).slice(0,40),kind:'payment',groupId:p.id,jumlah:shares[i],tanggal:pay.tanggal||p.tanggalOrder,metode:pay.metode||'transfer',catatan:pay.catatan||'',createdBy:'owner',voided:!!voided}]:[]});});}
 `,c);
 const start=html.indexOf('function fTanggal('),end=html.indexOf('/* ---------- hitungan PO',start);vm.runInContext(html.slice(start,end)+block,c);
 vm.runInContext("commerceShareShow=function(ids,fresh){shown.push([ids,fresh]);};var entry=commerceEntry('pembelian');entry.data={suppliers:[{id:'s1',nama:'Supplier A'},{id:'s2',nama:'Supplier B'}],products:[{id:'p1',supplierId:'s1',nama:'Model A',harga:1000},{id:'p2',supplierId:'s1',nama:'Model B',harga:2000},{id:'p3',supplierId:'s2',nama:'Other',harga:3000}],orders:[]};entry.version=10;entry.tried=true;",c);
 const run=s=>vm.runInContext(s,c),json=s=>JSON.parse(run('JSON.stringify('+s+')'));
 function form(rows,values={}){run('currentForm=makeForm('+JSON.stringify({id:'invoice01',supplierPick:'s1',grupNama:'Invoice Oktober',tanggalOrder:'2026-10-11',catatan:'Bersama',dp:'50000',metode:'transfer',...values})+','+JSON.stringify(rows)+');currentForm._commerceBatch=true;currentForm._commerceScope=commerceScope();');}
 return {c,run,json,requests,form};
}
const rows=()=>[{id:'order01',produkId:'p1',hargaSatuan:1000,items:[{id:'a1',nama:'Hitam',jumlah:30},{id:'a2',nama:'Putih',jumlah:20}]},{id:'order02',produkId:'p2',hargaSatuan:2000,items:[{id:'b1',nama:'Standar',jumlah:50}]}];
const tick=()=>new Promise(r=>setImmediate(r));
function envelope(orders){return {module:'pembelian',actor:{id:'owner',divisi:'owner'},version:11,suppliers:[],products:[],orders};}

test('two models and their variants save as one invoice request with one shared DP and stable IDs',()=>{
 const h=harness();h.form(rows());h.run('commerceBatchPaint(currentForm);A.commerceBatchSave(null)');assert.equal(h.requests.length,1);const req=h.requests[0];assert.equal(req.action,'saveCommerceOrderBatch');assert.deepEqual(req.payload,{id:'invoice01',supplierId:'s1',grupNama:'Invoice Oktober',tanggalOrder:'2026-10-11',catatan:'Bersama',orders:rows(),initialPayment:{jumlah:50000,tanggal:'2026-10-11',metode:'transfer',catatan:'DP awal invoice'},withState:true});assert.match(h.run('currentForm.total.innerHTML'),/2 model · 100 pcs/);assert.match(h.run('currentForm.total.innerHTML'),/Rp150000/);assert.match(h.run('currentForm.total.innerHTML'),/Rp100000/);h.run('A.commerceBatchSave(null)');assert.equal(h.requests.length,1);
});

test('explicit add-to-invoice includes complete membership proof and refuses a stale target before sending',()=>{
 const h=harness();h.form(rows());h.run("commerceData('pembelian').orders=[{id:'old',invoiceId:'old-invoice',revision:'old-rev',supplierSnapshot:{id:'s1'}}];currentForm._commerceTargetInvoice={id:'old-invoice',supplierId:'s1',key:commerceInvoiceKey(commerceData('pembelian').orders[0]),expectedRevisions:{old:'old-rev'}};A.commerceBatchSave(null)");assert.equal(h.requests[0].payload.targetInvoiceId,'old-invoice');assert.deepEqual(h.requests[0].payload.expectedGroupRevisions,{old:'old-rev'});
 for(const mutation of ["commerceData('pembelian').orders[0].revision='new-rev';","commerceData('pembelian').orders.push({id:'added',invoiceId:'old-invoice',revision:'added-rev',supplierSnapshot:{id:'s1'}});","currentForm._commerceTargetInvoice.supplierId='s2';"]){const h2=harness();h2.form(rows());h2.run("commerceData('pembelian').orders=[{id:'old',invoiceId:'old-invoice',revision:'old-rev',supplierSnapshot:{id:'s1'}}];currentForm._commerceTargetInvoice={id:'old-invoice',supplierId:'s1',key:commerceInvoiceKey(commerceData('pembelian').orders[0]),expectedRevisions:{old:'old-rev'}};"+mutation+'A.commerceBatchSave(null)');assert.equal(h2.requests.length,0,mutation);assert.match(h2.json('messages').at(-1),/Invoice berubah/);}
});

test('add-to-invoice success opens complete target including older models while ordinary new invoice remains independent',()=>{
 const h=harness();h.run("var opened=[];commerceInvoiceShow=function(ids){opened.push(ids);};commerceData('pembelian').orders=[{id:'old',invoiceId:'target',supplierSnapshot:{id:'s1'}},{id:'added',invoiceId:'new-batch',invoiceGroupId:'target',supplierSnapshot:{id:'s1'}},{id:'other',invoiceId:'other-batch',supplierSnapshot:{id:'s1'}}];commerceAfterSave({action:'saveCommerceOrderBatch',payload:{targetInvoiceId:'target',supplierId:'s1',orders:[{id:'added'}]}},{orderIds:['added']});");assert.deepEqual(h.json('opened'),[['old','added']]);assert.deepEqual(h.json('shown'),[]);
});

test('invalid final model, supplier, quantity, price or excessive shared DP blocks the whole request',()=>{
 const cases=[r=>r[1].produkId='p3',r=>r[1].produkId='p1',r=>r[1].items[0].jumlah=0,r=>r[1].items[0].jumlah=1.5,r=>r[1].hargaSatuan=0,r=>r[1].items=[]];
 for(const change of cases){const h=harness(),r=rows();change(r);h.form(r);h.run('A.commerceBatchSave(null)');assert.equal(h.requests.length,0);assert.ok(h.run('messages.length')>0);}
 const h=harness();h.form(rows(),{dp:'150001'});h.run('A.commerceBatchSave(null)');assert.equal(h.requests.length,0);assert.match(h.json('messages').at(-1),/DP melebihi/);
});

test('adding/removing model and variant rows keeps IDs and filled values of every surviving model',()=>{
 const h=harness();h.form(rows());const before=h.json('currentForm.models.map(m=>[m.id,m.values,m.lines.map(l=>l.values)])');
 h.run("A.commerceBatchAddModel({closest:function(){return currentForm;}});A.commerceBatchAddLine({closest:function(s){return s==='[data-commerce-model]'?currentForm.models[0]:currentForm;}})");assert.equal(h.run('currentForm.models.length'),3);assert.equal(h.run('currentForm.models[0].lines.length'),3);assert.equal(h.run('currentForm.models[2].id'),'new_2');
 h.run("var added=currentForm.models[2];A.commerceBatchRemoveModel({closest:function(s){return s==='[data-commerce-model]'?added:currentForm;}})");assert.equal(h.run('currentForm.models.length'),2);const after=h.json('currentForm.models.map(m=>[m.id,m.values,m.lines.slice(0,m.id==="order01"?2:1).map(l=>l.values)])');assert.deepEqual(after,before);
});

test('nested product/supplier creation updates only the intended choice and preserves other models, dates and DP',()=>{
 const h=harness();h.form(rows());h.run("currentForm.models[1].values.produkId='';currentForm.models[1].values.hargaSatuan='';currentForm._commerceBatchMasterTarget=currentForm.models[1];commerceData('pembelian').products.push({id:'newproduct',nama:'Baru',supplierId:'s1',harga:2500});commerceAfterSave({action:'saveCommerceProduct',payload:{}},{record:{id:'newproduct',supplierId:'s1'}})");assert.equal(h.run('currentForm.models[1].values.produkId'),'newproduct');assert.equal(h.run('currentForm.models[1].values.hargaSatuan'),2500);assert.deepEqual(h.json('currentForm.models[0].values'),{produkId:'p1',hargaSatuan:1000});assert.equal(h.run('currentForm.models[0].lines[0].values.lineQty'),30);assert.equal(h.run('currentForm.values.dp'),'50000');
 h.run("commerceData('pembelian').suppliers.push({id:'s3',nama:'New supplier'});commerceAfterSave({action:'saveCommerceSupplier',payload:{}},{record:{id:'s3'}})");assert.equal(h.run('currentForm.values.supplierPick'),'s1');assert.equal(h.run('currentForm.models[1].values.produkId'),'newproduct');assert.equal(h.run('currentForm.values.tanggalOrder'),'2026-10-11');assert.equal(h.requests.length,0);
});

test('successful save opens exactly the newly created invoice even with older supplier orders visible',async()=>{
 const h=harness();h.form(rows());h.run("S.invoice={ids:['older']};commerceData('pembelian').orders=[{id:'older',supplierSnapshot:{id:'s1'}}]");const done=h.run('A.commerceBatchSave(null)');h.requests[0].resolve({invoiceId:'invoice01',orderIds:['order01','order02'],commerce:envelope([{id:'older',supplierSnapshot:{id:'s1'}},...rows()])});await done;assert.deepEqual(h.json('shown'),[[['order01','order02'],true]]);assert.equal(h.run('drops'),1);assert.equal(h.requests.length,1);
});

test('uncertain invoice never confirms from one member and rejects missing or mismatched shared payment evidence',async()=>{
 const h=harness();h.form(rows());const done=h.run('A.commerceBatchSave(null)');h.requests[0].reject(Object.assign(new Error('timeout'),{uncertain:true}));await done;assert.equal(h.run('currentForm._commerceLocked'),true);assert.equal(h.run('drops'),0);assert.equal(h.requests.length,1);
 h.run("var p=currentForm._commerceIntent.payload,verified=proofRows(p);");
 for(const [expr,complete,retry] of [['[]',false,true],['verified.slice(0,1)',false,false],['verified',true,false],['verified.map((r,i)=>i?Object.assign({},r,{payments:[]}):r)',false,false],['verified.map((r,i)=>i?Object.assign({},r,{invoiceProof:"wrong"}):r)',false,false],['verified.map((r,i)=>i?Object.assign({},r,{invoiceOrderIds:["order02"]}):r)',false,false]]){const value=h.json('commerceBatchCheck(p,'+expr+')');assert.equal(value.complete,complete,expr);assert.equal(value.retry,retry,expr);}
 const check=h.run('A.commerceCheck({closest:function(){return currentForm;}})');h.requests[1].resolve(envelope(h.json('verified.slice(0,1)')));await check;assert.equal(h.run('drops'),0);assert.equal(h.run('currentForm._commerceRetry'),false);assert.match(h.run('currentForm.note.innerHTML'),/sebagian model/);
});

test('none-found verification permits only exact frozen retry and full proof later confirms all models and DP',async()=>{
 const h=harness();h.form(rows());let done=h.run('A.commerceBatchSave(null)');const original=h.requests[0].payload;h.requests[0].reject(Object.assign(new Error('timeout'),{net:true}));await done;
 let check=h.run('A.commerceCheck({closest:function(){return currentForm;}})');h.requests[1].resolve(envelope([]));await check;assert.equal(h.run('currentForm._commerceRetry'),true);
 h.run("currentForm.values.dp='999';currentForm.models[0].values.hargaSatuan=999;");done=h.run('A.commerceRetry({closest:function(){return currentForm;}})');assert.deepEqual(h.requests[2].payload,original);h.requests[2].reject(Object.assign(new Error('lost response'),{uncertain:true}));await done;
 h.run("var p=currentForm._commerceIntent.payload,verified=proofRows(p,true);");
 check=h.run('A.commerceCheck({closest:function(){return currentForm;}})');h.requests[3].resolve(envelope(h.json('verified')));await check;assert.equal(h.run('drops'),1);assert.deepEqual(h.json('shown'),[[['order01','order02'],true]]);assert.match(h.json('messages').at(-1),/Semua model dan DP/);
});

test('supplier detail identifies each invoice beside its own date without trusting invoice-name HTML',()=>{
 const h=harness();h.run("commerceData('pembelian').orders=[{id:'o1',invoiceId:'invoice01',grupNama:'Oktober <script>',productName:'A',status:'pending',tanggalOrder:'2026-10-11',totalQty:50,totalReceived:0,totalHarga:50000,totalPaid:0,balance:50000,supplierSnapshot:{id:'s1'},items:[]}];S.invoice={ids:['o1']};");const markup=h.run('commerceInvoiceHtml()');assert.match(markup,/Invoice Oktober &lt;script&gt;/);assert.match(markup,/2026-10-11/);assert.doesNotMatch(markup,/<script>/);
});

test('recovery holds same-total redistributed DP, changed evidence and unrequested invoice members',()=>{
 const h=harness();h.form(rows());h.run('var p=commerceBatchValues(currentForm),good=proofRows(p);');
 const corruptions=["bad[0].payments[0].jumlah++;bad[1].payments[0].jumlah--;","bad[0].payments[0].createdBy='other-owner';","bad[0].createdBy='other-owner';","bad[0].payments[0].tanggal='2026-10-10';","bad[0].payments[0].metode='cash';","bad[0].payments[0].catatan='Different';","bad[0].payments[0].id='another-payment';","bad[0].payments[0].groupId='another-invoice';","bad[0].payments.push(Object.assign({},bad[0].payments[0]));","bad.push(Object.assign({},bad[0],{id:'extra-model'}));","bad[0].invoiceOrderIds.reverse();"];
 for(const change of corruptions){h.run('var bad=JSON.parse(JSON.stringify(good));'+change);const result=h.json('commerceBatchCheck(p,bad)');assert.equal(result.complete,false,change);assert.equal(result.retry,false,change);}
 h.run("var edited=JSON.parse(JSON.stringify(good));edited[0].hargaSatuan=9999;edited[0].items[0].jumlah=999;edited[0].payments[0].voided=true;edited[1].payments[0].voided=true;edited[0].payments.push({id:'replacement',groupId:'later-correction',jumlah:1000});");assert.equal(h.run('commerceBatchCheck(p,edited).complete'),true,'later edits/corrections keep immutable original invoice proof');
});

test('zero-share models need no initial event but an injected zero-share payment is held',()=>{
 const h=harness();h.form(rows(),{dp:'1'});h.run('var p=commerceBatchValues(currentForm),good=proofRows(p),zero=good.findIndex(function(r){return !r.payments.length;});');assert.ok(h.run('zero')>=0);assert.equal(h.run('commerceBatchCheck(p,good).complete'),true);
 h.run("good[zero].payments=[{id:'injected',groupId:p.id,jumlah:0}];");assert.equal(h.run('commerceBatchCheck(p,good).complete'),false);
 const n=harness();n.form(rows(),{dp:'0'});n.run('var p=commerceBatchValues(currentForm),good=proofRows(p);');assert.equal(n.run('commerceBatchCheck(p,good).complete'),true);
});

test('changing a product replaces its untouched default price but preserves a manually negotiated price',()=>{
 const h=harness();h.form(rows());h.run("var model0=currentForm.models[0];model0.price.value='';C.commerceBatchProduct(model0.product);");assert.equal(h.run('model0.price.value'),1000);
 h.run("model0.product.value='p2';C.commerceBatchProduct(model0.product);");assert.equal(h.run('model0.price.value'),2000);
 h.run("model0.price.value='2750';model0.product.value='p1';C.commerceBatchProduct(model0.product);");assert.equal(h.run('model0.price.value'),'2750');
});
