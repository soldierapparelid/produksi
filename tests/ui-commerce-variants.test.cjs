'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
const block=html.slice(html.indexOf('/* COMMERCE UI START'),html.indexOf('/* COMMERCE UI END */'));

function harness(){
  const c=vm.createContext({console,setTimeout,clearTimeout});
  vm.runInContext(`
    var A={},C={},R={},VIEWS={},S={token:'owner-session',state:{me:{id:'owner',divisi:'owner'},settings:{}},f:{},sub:{},tab:'beranda'},Api={mode:function(){return 'gas';},div:function(){return '';}},UI_VERSION='test',IMG_TOKO='cm.',calls=[],messages=[],currentForm,seq=0;
    function me(){return S.state.me;}function isAdmin(){return true;}function topForm(){return currentForm;}function formVals(f){return f.values||{};}function toast(s){messages.push(s);}function newId(){return 'new_'+(++seq);}function nf(n){return String(n);}function rp(n){return 'Rp'+n;}function ic(){return '';}function tgl(d){return d||'';}function todayYmd(){return '2026-10-11';}
    function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}function fText(label,name,value){return '<input name="'+name+'" value="'+esc(value)+'">';}function fNum(label,name,value){return fText(label,name,value);}
    function line(row){var l={values:{lineName:row.nama,lineQty:row.jumlah},getAttribute:function(){return row.id;},detail:{open:false}};l.input={focus:function(){l.focused=true;}};return l;}
    function container(rows){var b={lines:rows};b.insertAdjacentHTML=function(at,markup){var id=markup.match(/data-commerce-line data-id="([^"]+)"/)[1],name=markup.match(/name="lineName" value="([^"]*)"/)[1],qty=markup.match(/name="lineQty" value="([^"]*)"/)[1];b.lines.push(line({id:id,nama:name,jumlah:qty}));};return b;}
    function model(row){var m={values:{produkId:row.produkId,hargaSatuan:row.hargaSatuan},lines:row.items.map(line),title:{},subtotal:{},getAttribute:function(){return row.id;}};m.box=container(m.lines);return m;}
    function makeForm(rows,batch){var f={values:{id:'order-existing',revision:'revision-opened',produkId:'p1',supplierPick:'s1',hargaSatuan:'48000',tanggalOrder:'2026-10-11',grupNama:'Invoice',catatan:'tetap',dp:'0',metode:'transfer'},lines:rows.map(line),models:[],total:{},_commerceBatch:!!batch,getAttribute:function(){return 'pembelian';}};f.box=container(f.lines);return f;}
    function $(selector,f){if(selector==='[data-commerce-lines]')return f.box;if(selector==='[data-commerce-total]'||selector==='[data-commerce-batch-total]')return f.total;if(selector==='[data-commerce-model-title]')return f.title;if(selector==='[data-commerce-model-total]')return f.subtotal;if(selector==='details')return f.detail;if(selector==='[name="lineName"]')return f.input;return null;}
    function $$(selector,f){if(selector==='[data-commerce-model]')return f.models||[];if(selector==='[data-commerce-line]')return f.models&&f.models.length?f.models.flatMap(function(m){return m.lines;}):f.lines||[];return [];}
  `,c);
  vm.runInContext(block,c);
  vm.runInContext(`commerceMutation=function(module,action,payload){calls.push({module:module,action:action,payload:payload});};var entry=commerceEntry('pembelian');entry.data={suppliers:[{id:'s1',nama:'Supplier'}],products:[{id:'p1',supplierId:'s1',nama:'Padi',harga:48000},{id:'p2',supplierId:'s1',nama:'Other',harga:1000}],orders:[]};`,c);
  const run=s=>vm.runInContext(s,c),json=s=>JSON.parse(run('JSON.stringify('+s+')'));
  return {run,json,edit(items){run('currentForm=makeForm('+JSON.stringify(items)+',false);');},batch(orders){run('currentForm=makeForm([],true);currentForm.models='+JSON.stringify(orders)+'.map(model);');}};
}
const item=(id,nama,jumlah=300)=>({id,nama,jumlah});
const order=(id,produkId,items,hargaSatuan=48000)=>({id,produkId,items,hargaSatuan});

test('case and whitespace equivalent variant names cannot save an edit or a new invoice',()=>{
  for(const names of [['Hitam','Hitam'],['Hitam',' hITAM '],['Hitam Corduroy',' hitam\t  corduroy ']]){
    const items=[item('existing-item-1',names[0]),item('different-item-2',names[1])];
    const edit=harness();edit.edit(items);edit.run('R.commerce(currentForm);A.commerceOrderSave(null)');
    assert.equal(edit.run('calls.length'),0);assert.match(edit.json('messages').at(-1),/sudah ada pada model ini/);assert.match(edit.run('currentForm.total.textContent'),/Gabungkan jumlahnya/);
    const batch=harness();batch.batch([order('new-order','p1',items)]);batch.run('commerceBatchPaint(currentForm);A.commerceBatchSave(null)');
    assert.equal(batch.run('calls.length'),0);assert.match(batch.json('messages').at(-1),/sudah ada pada model ini/);assert.match(batch.run('currentForm.models[0].subtotal.textContent'),/sudah ada pada model ini/);
  }
});

test('same color in different models is valid and distinct variants keep their IDs and quantities',()=>{
  const h=harness(),orders=[order('a','p1',[item('a1','Hitam',30),item('a2','Putih',20)]),order('b','p2',[item('b1',' hitam ',50)],1000)];
  h.batch(orders);h.run('A.commerceBatchSave(null)');assert.equal(h.run('calls.length'),1);
  const sent=h.json('calls[0].payload');assert.equal(sent.orders.length,2);assert.deepEqual(sent.orders[0].items,orders[0].items);assert.deepEqual(sent.orders[1].items,[item('b1','hitam',50)]);
});

test('corrected single variant edit keeps the same order, frozen revision and payment evidence',()=>{
  const h=harness();h.edit([item('kept-item','Hitam')]);h.run("currentForm._commerceOriginal={id:'order-existing',payments:[{id:'dp-evidence',jumlah:7000000}],items:[{id:'kept-item',nama:'Hitam',jumlah:300},{id:'removed-item',nama:'Hitam',jumlah:300}]};A.commerceOrderSave(null)");
  const saved=h.json('calls[0]');assert.equal(saved.action,'saveCommerceOrder');assert.equal(saved.payload.record.id,'order-existing');assert.equal(saved.payload.expectedRevision,'revision-opened');assert.deepEqual(saved.payload.record.items,[item('kept-item','Hitam')]);assert.deepEqual(saved.payload.record.payments,[{id:'dp-evidence',jumlah:7000000}]);assert.equal(saved.payload.record.initialPayment,undefined);
  assert.equal(h.run('currentForm._commerceOriginal.items.length'),2,'view does not mutate original history while preparing save');
});

test('metadata-only edit may retain an exact historical duplicate list without changing item or payment evidence',()=>{
  const h=harness(),items=[item('old-first',' Hitam ',300),item('old-second','Hitam',50)];h.edit(items);
  h.run('currentForm._commerceOriginal={id:"order-existing",receiptReview:true,items:'+JSON.stringify(items)+',payments:[{id:"paid",jumlah:700000}]};currentForm.values.catatan="Catatan baru";A.commerceOrderSave(null);');
  assert.equal(h.run('calls.length'),1);const saved=h.json('calls[0].payload');assert.equal(saved.record.catatan,'Catatan baru');assert.deepEqual(saved.record.items,[item('old-first','Hitam',300),item('old-second','Hitam',50)]);assert.deepEqual(saved.record.payments,[{id:'paid',jumlah:700000}]);assert.equal(saved.expectedRevision,'revision-opened');assert.equal(saved.record.initialPayment,undefined);
  assert.deepEqual(h.json('currentForm._commerceOriginal.items'),items,'opening/saving does not mutate the frozen snapshot');
});

test('historical exception rejects changed quantities, IDs, names, order or extra duplicate items',()=>{
  const original=[item('old-first','Hitam',300),item('old-second','Hitam',50)];
  const changes=[items=>items[1].jumlah=51,items=>items[1].id='replaced',items=>items[1].nama='HITAM',items=>items.reverse(),items=>items.push(item('third','Hitam',1))];
  for(const change of changes){const h=harness(),items=structuredClone(original);change(items);h.edit(items);h.run('currentForm._commerceOriginal={id:"order-existing",items:'+JSON.stringify(original)+'};A.commerceOrderSave(null)');assert.equal(h.run('calls.length'),0);assert.match(h.json('messages').at(-1),/sudah ada pada model ini/);}
  const batch=harness();batch.batch([order('a','p1',original)]);batch.run('currentForm.models[0]._commerceOriginal={id:"a",items:'+JSON.stringify(original)+'};A.commerceBatchSave(null)');assert.equal(batch.run('calls.length'),0,'batch model cannot borrow existing-record exception');
});

test('adding a variant starts blank and focuses its name without cloning first quantity or identity',()=>{
  for(const batch of [false,true]){
    const h=harness(),first=item('original','Hitam',300);
    if(batch){h.batch([order('a','p1',[first])]);h.run("A.commerceBatchAddLine({closest:function(s){return s==='[data-commerce-model]'?currentForm.models[0]:currentForm;}})");}
    else{h.edit([first]);h.run('A.commerceAddOrderLine(null)');}
    const scope=batch?'currentForm.models[0]':'currentForm';assert.equal(h.run(scope+'.lines.length'),2);assert.deepEqual(h.json(scope+'.lines[0].values'),{lineName:'Hitam',lineQty:300});assert.deepEqual(h.json(scope+'.lines[1].values'),{lineName:'',lineQty:''});assert.equal(h.run(scope+'.lines[1].getAttribute()'),'new_1');assert.equal(h.run(scope+'.lines[1].focused'),true);assert.equal(h.run(scope+'.lines[0].detail.open'),true);
    h.run(batch?'A.commerceBatchSave(null)':'A.commerceOrderSave(null)');assert.equal(h.run('calls.length'),0,'blank added variant must be completed or removed');
  }
});

test('live subtotal clearly sums every distinct variant in edit and new model',()=>{
  const h=harness(),items=[item('a','Hitam',30),item('b','Putih',20)];h.edit(items);h.run('R.commerce(currentForm)');assert.match(h.run('currentForm.total.textContent'),/^Total seluruh varian: 50 pcs · Rp2400000/);
  h.batch([order('a','p1',items)]);h.run('commerceBatchPaint(currentForm)');assert.equal(h.run('currentForm.models[0].subtotal.textContent'),'Total seluruh varian: 50 pcs · Rp2400000');assert.match(h.run('currentForm.total.innerHTML'),/1 model · 50 pcs/);
});

test('share image model renders stored variants once, without silently rewriting past duplicate evidence',()=>{
  const h=harness(),stored={id:'old',productName:'Padi',hargaSatuan:48000,totalHarga:28800000,totalReceived:0,totalPaid:7000000,balance:21800000,items:[item('a','Hitam'),item('b','Hitam')],payments:[]};h.run('var record='+JSON.stringify(stored)+',before=JSON.stringify(record),shared=commerceShareModel([record]);');
  assert.equal(h.run('shared.orders.length'),1);assert.equal(h.run('shared.orders[0].baris.length'),2);assert.equal(h.run('shared.qty'),600);assert.equal(h.run('shared.total'),28800000);assert.equal(h.run('JSON.stringify(record)===before'),true);
  h.run('record.items.pop();record.totalHarga=14400000;record.balance=7400000;shared=commerceShareModel([record]);');assert.equal(h.run('shared.orders[0].baris.length'),1);assert.equal(h.run('shared.qty'),300);assert.equal(h.run('shared.total'),14400000);
});
