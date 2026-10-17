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
  const coreSource=fs.readFileSync(path.resolve(__dirname,'../src/core.js'),'utf8'),notaSource=fs.readFileSync(path.resolve(__dirname,'../src/commerce.js'),'utf8');
  vm.runInContext(coreSource.match(/function coreNum\(v\) \{[^\r\n]+/)[0]+notaSource.slice(notaSource.indexOf('function coreNotaTanggalSah('),notaSource.indexOf('function coreNotaInvoiceHtml(')),context);
  vm.runInContext(html.slice(html.indexOf('function seg('),html.indexOf('function searchBox(')),context);
  const run=code=>vm.runInContext(code,context);const json=code=>JSON.parse(run('JSON.stringify('+code+')'));
  function seed(module,data){run(`var e=commerceEntry(${JSON.stringify(module)});e.data=${JSON.stringify(data)};e.version=10;e.tried=true;`);}
  function form(values,module,rows=[]){run(`currentForm.values=${JSON.stringify(values)};currentForm.module=${JSON.stringify(module)};currentForm._commerceScope=commerceScope();currentForm.rows=${JSON.stringify(rows)}.map(function(r){return {values:r.values,getAttribute:function(){return r.id;}};});`);}
  return {context,requests,run,json,seed,form};
}


function nota(id,extra={}){return {id,noNota:'SA-'+id,revision:'r-'+id,status:'dp',date:'2026-10-17',customer:{name:'Customer '+id},items:[{id:'i-'+id,name:'Topi',qty:10,price:10000,subtotal:100000}],total:100000,totalPaid:40000,balance:60000,payments:[{id:'p-'+id,jumlah:40000,tanggal:'2026-10-15',metode:'transfer'}],events:[],...extra};}
function element(id,extra={}){return '({getAttribute:function(k){return '+JSON.stringify({'data-m':'nota','data-id':id,...extra})+'[k]||null;}})';}
function seed(h,rows){h.seed('nota',{notes:rows});}
function listIds(markup){return [...markup.matchAll(/data-a="commerceNotaDetail" data-id="([^"]+)"/g)].map(m=>m[1]);}
function paid(id,extra={}){return nota(id,{status:'lunas',totalPaid:100000,balance:0,payments:[{id:'dp-'+id,jumlah:40000,tanggal:'2026-10-15'},{id:'settle-'+id,jumlah:60000,tanggal:'2026-10-17'}],...extra});}
function rows(){return [nota('due'),paid('done'),paid('old',{legacy:true,payments:[]}),nota('archived',{archived:true}),nota('deleted',{cancelled:true,status:'batal',cancelledBy:'owner'}),paid('review',{paymentReview:true}),nota('zero',{total:0,totalPaid:0,balance:0,payments:[]}),paid('inconsistent',{totalPaid:50000})];}

test('Nota aktif excludes proven paid, manual archive and deleted notes while uncertain money remains active',()=>{
 const h=harness();seed(h,rows());const before=h.json("commerceData('nota').notes");const view=h.run('VIEWS.nota()');assert.match(view,/data-k="commerceNota" data-v="active" class="on">Nota aktif/);assert.match(view,/data-v="history">Riwayat nota/);assert.deepEqual(listIds(h.run('S.listFn()')).sort(),['due','inconsistent','review']);assert.deepEqual(h.json("commerceData('nota').notes"),before);assert.equal(h.requests.length,0);
});

test('Riwayat nota includes derived paid and preserves distinct manual archive and deleted filters',()=>{
 const h=harness();seed(h,rows());h.run("S.sub.commerceNota='history';VIEWS.nota()");assert.deepEqual(listIds(h.run('S.listFn()')).sort(),['archived','deleted','done','old','zero']);
 h.run("S.f['commerceStatus-notaHistory']='lunas'");assert.deepEqual(listIds(h.run('S.listFn()')).sort(),['done','old','zero']);
 h.run("S.f['commerceStatus-notaHistory']='arsip'");assert.deepEqual(listIds(h.run('S.listFn()')),['archived']);
 h.run("S.f['commerceStatus-notaHistory']='batal'");assert.deepEqual(listIds(h.run('S.listFn()')),['deleted']);assert.equal(h.requests.length,0);
});

test('payment or price correction reopens a derived paid note without changing manual archive status',()=>{
 const h=harness();seed(h,[paid('done'),paid('archived',{archived:true})]);h.run('VIEWS.nota()');assert.deepEqual(listIds(h.run('S.listFn()')),[]);
 seed(h,[nota('done'),nota('archived',{archived:true})]);h.run('VIEWS.nota()');assert.deepEqual(listIds(h.run('S.listFn()')),['done']);h.run("S.sub.commerceNota='history';VIEWS.nota()");assert.deepEqual(listIds(h.run('S.listFn()')),['archived']);assert.equal(h.requests.length,0,'no automatic archive/unarchive or ledger writes');
});

test('nota detail clearly distinguishes DP and LUNAS and only shows a proven settlement date',()=>{
 const h=harness();seed(h,[nota('due'),paid('done'),paid('old',{payments:[]}),paid('invalid-date',{payments:[{id:'p',jumlah:100000,tanggal:'2026-02-31'}]}),paid('inconsistent',{totalPaid:50000})]);
 let s=h.run("commerceNotaRincian('due')");assert.match(s,/DP \/ BELUM LUNAS/);assert.match(s,/data-id="due" data-pelunasan="1">Lunasi sisa Rp60000/);assert.match(s,/Tambah DP \/ pembayaran/);
 s=h.run("commerceNotaRincian('done')");assert.match(s,/<b>LUNAS · 2026-10-17<\/b>/);assert.match(s,/tersimpan di Riwayat nota/);assert.doesNotMatch(s,/commercePaymentOpen/);
 for(const id of ['old','invalid-date']){s=h.run('commerceNotaRincian('+JSON.stringify(id)+')');assert.match(s,/<b>LUNAS<\/b>/);assert.doesNotMatch(s,/<b>LUNAS ·/);}
 s=h.run("commerceNotaRincian('inconsistent')");assert.match(s,/PERLU DIPERIKSA/);assert.doesNotMatch(s,/>LUNAS|commercePaymentOpen/);assert.equal(h.requests.length,0);
});

test('nota DP form stays blank, explicit settlement prefills only the remaining balance and retains revision',()=>{
 const h=harness();seed(h,[nota('due')]);h.run('A.commercePaymentOpen('+element('due')+')');assert.match(h.run('lastSheet'),/name="jumlah" value=""/);assert.match(h.run('lastSheet'),/Tambah DP \/ pembayaran/);
 h.run('A.commercePaymentOpen('+element('due',{'data-pelunasan':'1'})+')');assert.match(h.run('lastSheet'),/<h2>Pelunasan<\/h2>/);assert.match(h.run('lastSheet'),/name="jumlah" value="60000"/);assert.match(h.run('lastSheet'),/name="revision" value="r-due"/);assert.equal(h.requests.length,0);
});

test('nota cash payment preview shows change while save records only the balance and retains tendered money',()=>{
 const h=harness();seed(h,[nota('due')]);h.run("var oldDollar=$;$=function(s,f){return s==='[data-commerce-group-payment-preview]'?f.preview:oldDollar(s,f);};currentForm.preview={textContent:''};");h.run('A.commercePaymentOpen('+element('due',{'data-pelunasan':'1'})+')');h.form({id:'settlement',parentId:'due',revision:'r-due',tanggal:'2026-10-17',jumlah:'100000',metode:'cash',catatan:''},'nota');
 h.run('commerceGroupAmountPaint(currentForm)');assert.match(h.run('currentForm.preview.textContent'),/Pelunasan Rp60000 · Uang diterima Rp100000 · Kembalian Rp40000/);assert.equal(h.requests.length,0);
 h.run('A.commercePaymentSave(null)');assert.equal(h.requests[0].action,'appendCommercePayment');assert.equal(h.requests[0].payload.jumlah,60000);assert.equal(h.requests[0].payload.tenderedAmount,100000);assert.equal(h.requests[0].payload.expectedRevision,'r-due');
});

test('transfer overpayment is explained and completed or uncertain notes cannot open settlement',()=>{
 const h=harness();seed(h,[nota('due'),paid('done'),paid('uncertain',{paymentReview:true})]);h.run("var oldDollar=$;$=function(s,f){return s==='[data-commerce-group-payment-preview]'?f.preview:oldDollar(s,f);};currentForm.preview={textContent:''};");h.run('A.commercePaymentOpen('+element('due')+')');h.form({jumlah:'100000',metode:'transfer'},'nota');h.run('commerceGroupAmountPaint(currentForm)');assert.match(h.run('currentForm.preview.textContent'),/melebihi/);
 for(const id of ['done','uncertain']){h.run("lastSheet=''");h.run('A.commercePaymentOpen('+element(id,{'data-pelunasan':'1'})+')');assert.equal(h.run('lastSheet'),'');}assert.equal(h.requests.length,0);
});
