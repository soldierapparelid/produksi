'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
const block=html.slice(html.indexOf('/* COMMERCE UI START'),html.indexOf('/* COMMERCE UI END */'));

function harness(){
 const c=vm.createContext({console,setTimeout,clearTimeout});
 vm.runInContext(`
 var A={},C={},R={},VIEWS={},S={token:'owner-session',state:{me:{id:'owner',divisi:'owner'},settings:{}},f:{},sub:{},tab:'nota'},Api={mode:function(){return 'gas';},div:function(){return '';}},UI_VERSION='test',IMG_TOKO='cm.',calls=[],messages=[],currentForm,seq=0;
 function me(){return S.state.me;}function isAdmin(){return true;}function topForm(){return currentForm;}function toast(s){messages.push(s);}function newId(){return 'new_'+(++seq);}function nf(n){return String(n);}function nfQty(n){return String(n);}function rp(n){return 'Rp'+n;}function ic(){return '';}function tgl(d){return d||'';}
 function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
 function formVals(el){var v=Object.assign({},el.values||{});Object.keys(el.inputs||{}).forEach(function(k){v[k]=el.inputs[k].value;});return v;}
 function sizeRow(data,line){var r={values:{notaSize:data.size,notaSizeQty:String(data.qty==null?'':data.qty)},inputs:{},closest:function(){return line;},remove:function(){line.sizes=line.sizes.filter(function(x){return x!==r;});}};Object.keys(r.values).forEach(function(k){r.inputs[k]={value:r.values[k],focus:function(){r.focused=true;}};});return r;}
 function line(data,f){var detail=Array.isArray(data.sizeBreakdown)&&data.sizeBreakdown.length>0,l={values:{lineName:data.name||'Polo',color:data.color||'',size:data.size||'',price:String(data.price==null?60000:data.price),discPercent:String(data.discPercent||0)},inputs:{qty:{value:String(data.qty||1)}},sizes:[],toggle:{checked:detail},panel:{hidden:!detail},label:{hidden:detail},hint:{hidden:detail},getAttribute:function(k){return k==='data-id'?data.id:k==='data-had-size-breakdown'?(detail?'1':'0'):null;},closest:function(){return f;}};
 l.sizes=(data.sizeBreakdown||[]).map(function(s){return sizeRow(s,l);});l.box={insertAdjacentHTML:function(){l.sizes.push(sizeRow({size:'',qty:''},l));}};l.toggle.closest=function(){return l;};return l;}
 function makeForm(items,extra){var f={values:Object.assign({id:'note',revision:'opened-revision',date:'2026-10-19',customerName:'Customer',phone:'',address:'',customerType:'walkin',discountPercent:'0',shipping:'0',notes:''},extra||{}),total:{},getAttribute:function(){return 'nota';}};f.lines=items.map(function(x){return line(x,f);});f._commerceOriginal={id:'note',totalPaid:0,items:JSON.parse(JSON.stringify(items)),payments:[{id:'proof',jumlah:10000}]};f._commerceScope=commerceScope();return f;}
 function $(s,f){if(s==='[data-commerce-total]')return f.total;if(s==='[data-commerce-size-toggle]')return f.toggle||null;if(s==='[data-commerce-size-panel]')return f.panel;if(s==='[data-commerce-size-label]')return f.label;if(s==='[data-commerce-size-hint]')return f.hint;if(s==='[data-commerce-size-rows]')return f.box;var m=/^\\[name="([^"]+)"\\]$/.exec(s);if(m)return (f.inputs||{})[m[1]]||null;return null;}
 function $$(s,f){if(s==='[data-commerce-line]')return f.lines||[];if(s==='[data-commerce-size-row]')return f.sizes||[];return [];}
 function emptyBox(s){return s;}function sheetHtml(t,b,f){return t+b+(f||'');}
 `,c);
 const helperStart=html.indexOf('function fTanggal('),helperEnd=html.indexOf('/* ---------- hitungan PO',helperStart);
 vm.runInContext(html.slice(helperStart,helperEnd),c);
 vm.runInContext(block,c);
 vm.runInContext(`commerceMutation=function(module,action,payload){calls.push({module:module,action:action,payload:payload});};`,c);
 const run=s=>vm.runInContext(s,c),json=s=>JSON.parse(run('JSON.stringify('+s+')'));
 return {run,json,form(items,extra={}){run('currentForm=makeForm('+JSON.stringify(items)+','+JSON.stringify(extra)+');');}};
}
const detail=[{size:'M',qty:10},{size:'L',qty:12},{size:'XL',qty:10}];
const item=(id,extra={})=>({id,name:'Polo Basic',color:'Oren',size:'M-XL',qty:32,price:60000,discPercent:0,...extra});

test('size quantities are authoritative during live calculation and save without changing payment evidence',()=>{
 const h=harness(),items=[item('polo',{sizeBreakdown:detail})];h.form(items);
 h.run('currentForm.lines[0].inputs.qty.value="999";R.commerce(currentForm);A.commerceNotaSave(null)');
 assert.equal(h.run('currentForm.lines[0].inputs.qty.value'),32);
 assert.equal(h.run('currentForm.lines[0].inputs.qty.readOnly'),true);
 assert.equal(h.run('currentForm.lines[0].label.hidden'),true);
 assert.equal(h.run('currentForm.total.textContent'),'Total Rp1920000');
 const p=h.json('calls[0].payload');assert.equal(p.expectedRevision,'opened-revision');assert.equal(p.record.items[0].qty,32);assert.deepEqual(p.record.items[0].sizeBreakdown,detail);assert.deepEqual(p.record.payments,[{id:'proof',jumlah:10000}]);assert.deepEqual(h.json('currentForm._commerceOriginal.items'),items);assert.equal(p.record.initialPayment,undefined);
});

test('editing another item preserves each detailed item and simple legacy quantity separately',()=>{
 const h=harness();h.form([item('detailed',{sizeBreakdown:detail}),item('legacy',{qty:215,size:'S-6XL'}),item('other',{qty:5,size:'All size'})]);
 h.run('currentForm.lines[2].values.price="70000";A.commerceNotaSave(null)');
 const rows=h.json('calls[0].payload.record.items');assert.deepEqual(rows[0].sizeBreakdown,detail);assert.equal(rows[1].qty,215);assert.equal(rows[1].size,'S-6XL');assert.equal(rows[1].sizeBreakdown,undefined);assert.equal(rows[2].price,70000);assert.deepEqual(rows.map(x=>x.id),['detailed','legacy','other']);
});

test('an existing range never invents counts and enabling details starts an empty row',()=>{
 const h=harness();h.form([item('legacy')]);h.run('R.commerce(currentForm);A.commerceNotaSave(null)');
 assert.equal(h.json('calls[0].payload.record.items')[0].sizeBreakdown,undefined);assert.equal(h.run('currentForm.lines[0].inputs.qty.value'),'32');
 h.run('currentForm.lines[0].toggle.checked=true;C.commerceNotaSizeToggle(currentForm.lines[0].toggle);A.commerceNotaSave(null)');
 assert.equal(h.run('currentForm.lines[0].sizes.length'),1);assert.equal(h.run('currentForm.lines[0].sizes[0].inputs.notaSize.value'),'');assert.equal(h.run('currentForm.lines[0].sizes[0].inputs.notaSizeQty.value'),'');assert.equal(h.run('calls.length'),1,'unfinished new breakdown is not saved');
 assert.match(h.json('messages').at(-1),/Jumlah per ukuran belum valid/);
 h.run('currentForm.lines[0].toggle.checked=false;C.commerceNotaSizeToggle(currentForm.lines[0].toggle);A.commerceNotaSave(null)');assert.equal(h.run('calls[1].payload.record.items[0].qty'),32,'abandoning an unfinished breakdown retains the earlier manual quantity');
});

test('size names are normalized and duplicate or invalid quantities prevent saving',()=>{
 for(const sizes of [[{size:'M',qty:10},{size:' m ',qty:12}],[{size:'M',qty:0}],[{size:'M',qty:1.5}],[{size:'M',qty:-1}],[{size:'',qty:2}],[{size:'M',qty:100000001}]]){
  const h=harness();h.form([item('polo',{sizeBreakdown:sizes})]);h.run('A.commerceNotaSave(null)');assert.equal(h.run('calls.length'),0);assert.ok(h.json('messages').length);
 }
 const h=harness();h.form([item('polo',{sizeBreakdown:[{size:' xxL ',qty:4},{size:'Extra   Long',qty:3}]})]);h.run('A.commerceNotaSave(null)');assert.deepEqual(h.json('calls[0].payload.record.items[0].sizeBreakdown'),[{size:'XXL',qty:4},{size:'EXTRA LONG',qty:3}]);assert.equal(h.run('calls[0].payload.record.items[0].qty'),7);
});

test('removing a size changes only that item and adding size keeps all previous entries',()=>{
 const h=harness();h.form([item('first',{sizeBreakdown:detail}),item('second',{sizeBreakdown:[{size:'XL',qty:6}]})]);
 h.run('A.commerceNotaRemoveSize({closest:function(){return currentForm.lines[0].sizes[1];}});A.commerceNotaAddSize({closest:function(){return currentForm.lines[0];}})');
 assert.deepEqual(h.json('currentForm.lines[0].sizes.map(function(r){return formVals(r);})'),[{notaSize:'M',notaSizeQty:'10'},{notaSize:'XL',notaSizeQty:'10'},{notaSize:'',notaSizeQty:''}]);assert.equal(h.run('currentForm.lines[0].sizes[2].focused'),true);
 h.run('currentForm.lines[0].sizes[2].inputs.notaSize.value="XXL";currentForm.lines[0].sizes[2].inputs.notaSizeQty.value="5";A.commerceNotaSave(null)');
 assert.deepEqual(h.json('calls[0].payload.record.items[0].sizeBreakdown'),[{size:'M',qty:10},{size:'XL',qty:10},{size:'XXL',qty:5}]);assert.deepEqual(h.json('calls[0].payload.record.items[1].sizeBreakdown'),[{size:'XL',qty:6}]);assert.equal(h.run('calls[0].payload.record.items[0].qty'),25);
});

test('disabling saved detail explicitly requests clearing and re-enabling restores the draft rows',()=>{
 const h=harness();h.form([item('polo',{sizeBreakdown:detail})]);h.run('currentForm.lines[0].toggle.checked=false;C.commerceNotaSizeToggle(currentForm.lines[0].toggle);A.commerceNotaSave(null)');
 let saved=h.json('calls[0].payload.record.items[0]');assert.equal(saved.clearSizeBreakdown,true);assert.equal(saved.sizeBreakdown,undefined);assert.equal(saved.qty,32);assert.equal(saved.size,'M-XL');assert.equal(h.run('currentForm.lines[0].inputs.qty.readOnly'),false);
 h.run('currentForm.lines[0].toggle.checked=true;C.commerceNotaSizeToggle(currentForm.lines[0].toggle);A.commerceNotaSave(null)');saved=h.json('calls[1].payload.record.items[0]');assert.equal(saved.clearSizeBreakdown,undefined);assert.deepEqual(saved.sizeBreakdown,detail);
});

test('size changes cannot bypass the paid-total guard and locked controls do not modify drafts',()=>{
 const h=harness();h.form([item('polo',{sizeBreakdown:[{size:'L',qty:2}]})]);h.run('currentForm._commerceOriginal.totalPaid=180000;A.commerceNotaSave(null)');assert.equal(h.run('calls.length'),0);assert.match(h.json('messages').at(-1),/lebih kecil dari yang sudah dibayar/);
 h.run('currentForm._commerceLocked=true;A.commerceNotaAddSize({closest:function(){return currentForm.lines[0];}});A.commerceNotaRemoveSize({closest:function(){return currentForm.lines[0].sizes[0];}});A.commerceNotaSave(null)');assert.equal(h.run('currentForm.lines[0].sizes.length'),1);assert.equal(h.run('calls.length'),0);
});

test('new nota uses sum of size quantities for initial payment and preserves discounts',()=>{
 const h=harness();h.form([item('polo',{sizeBreakdown:detail,discPercent:10})],{id:'new',revision:'',dp:'2000000',metode:'cash',shipping:'10000',discountPercent:'5'});h.run('currentForm._commerceOriginal={};A.commerceNotaSave(null)');
 const r=h.json('calls[0].payload.record');assert.equal(r.items[0].qty,32);assert.equal(r.items[0].discPercent,10);assert.equal(r.initialPayment.jumlah,1651600);assert.equal(r.initialPayment.tenderedAmount,2000000);assert.equal(r.discountPercent,5);assert.equal(r.shipping,10000);
});

test('item form renders saved rows safely while legacy range remains optional without generated quantities',()=>{
 const h=harness(),detailed=h.run('commerceNotaLine('+JSON.stringify(item('safe',{sizeBreakdown:[{size:'<XL>',qty:7}]}))+')');
 assert.match(detailed,/data-commerce-size-toggle[^>]* checked/);assert.match(detailed,/name="notaSize" value="&lt;XL&gt;"/);assert.match(detailed,/name="notaSizeQty" value="7"/);assert.match(detailed,/name="qty"[^>]*readonly/);assert.match(detailed,/aria-label="Hapus ukuran"/);
 const legacy=h.run('commerceNotaLine('+JSON.stringify(item('old'))+')');assert.doesNotMatch(legacy,/data-commerce-size-toggle[^>]* checked/);assert.doesNotMatch(legacy,/name="notaSizeQty"/);assert.match(legacy,/name="size" value="M-XL"/);assert.match(legacy,/Jumlah per ukuran belum tercatat/);
});
