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

test('two write answers delivered backwards keep the newest commerce snapshot on screen and on the device',async()=>{
  const h=harness();h.seed('pembelian',{orders:[]});h.form({},'pembelian');
  h.run('var firstForm=Object.assign({},currentForm),secondForm=Object.assign({},currentForm);');
  const first=h.run("commerceMutation('pembelian','appendCommercePayment',{id:'payment-one',parentId:'order-one',jumlah:10},firstForm,null)"),second=h.run("commerceMutation('pembelian','appendCommercePayment',{id:'payment-two',parentId:'order-two',jumlah:20},secondForm,null)");
  assert.equal(h.requests.length,2);
  h.requests[1].resolve({record:{id:'order-two'},commerce:reply('pembelian',{orders:[{id:'order-one',totalPaid:10},{id:'order-two',totalPaid:20}]},12)});await second;
  h.requests[0].resolve({record:{id:'order-one'},commerce:reply('pembelian',{orders:[{id:'order-one',totalPaid:10},{id:'order-two',totalPaid:0}]},11)});await first;
  assert.equal(h.run("commerceEntry('pembelian').version"),12);assert.equal(h.run("commerceRecord('pembelian','order-two').totalPaid"),20);
  assert.equal(JSON.parse(h.run('kv.pks_cm_pembelian_pusat.s')).orders[1].totalPaid,20);assert.equal(h.requests.length,2,'confirmed writes do not trigger redundant reads');
});

function updateHarness(){
  const c=vm.createContext({console});
  vm.runInContext("var A={},S={state:{me:{id:'owner',divisi:'owner'}},gate:{pin:'',sending:false},busy:1,tulis:1},sheets=[],reloads=0,messages=[];var location={reload:function(){reloads++;}},window={sessionStorage:{getItem:function(){return null;},setItem:function(){}}};function inputAktif(){return false;}function render(){}function toast(x){messages.push(x);}",c);
  const start=html.indexOf('function versiBaruSiap('),end=html.indexOf("if (window.PK_HOSTED && 'serviceWorker'",start);assert.ok(start>=0&&end>start);
  vm.runInContext(html.slice(start,end),c);return {run:x=>vm.runInContext(x,c)};
}

test('pressing the new-version banner while a write is in flight must not discard its unresolved intent',()=>{
  const h=updateHarness();h.run('A.muatVersi()');assert.equal(h.run('reloads'),0,'wait for the pending write instead of reloading and losing the form ID');
});

test('an automatic update notice cannot reload the login shell while a write or login is pending',()=>{
  for(const busy of ['S.tulis=1','S.gate.sending=true','S.sessionLoad={}']){const h=updateHarness();h.run('S.state=null;S.busy=0;S.tulis=0;'+busy+';versiBaruSiap()');assert.equal(h.run('reloads'),0,'being on the login screen alone is not evidence that requests have finished');}
});

test('an idle PWA can load a newer release while a visible draft or PIN keeps it on the current page',()=>{
  for(const draft of ['sheets.push({})','S.gate.pin="12"','document={querySelector:function(){return {};}}']){const h=updateHarness();h.run('S.busy=0;S.tulis=0;'+draft+';A.muatVersi()');assert.equal(h.run('reloads'),0);assert.equal(h.run('messages.length'),1);}
  const h=updateHarness();h.run('S.busy=0;S.tulis=0;versiBaruSiap()');assert.equal(h.run('reloads'),1);
});

test('Apps Script update uses an explicit trusted top-level app link and preserves the selected division',()=>{
  const h=updateHarness();h.run('S.busy=0;S.tulis=0;var Api={mode:function(){return "gas";},div:function(){return "potong";}},opened=[];window.open=function(url,target){opened.push([url,target]);};S.state.settings={linkApp:"https://script.google.com/macros/s/synthetic-deployment/exec"};versiBaruSiap()');assert.equal(h.run('opened.length'),0);assert.equal(h.run('reloads'),0);
  h.run('A.muatVersi()');assert.equal(h.run('opened[0][0]'),'https://script.google.com/macros/s/synthetic-deployment/exec?d=potong');assert.equal(h.run('opened[0][1]'),'_top');assert.equal(h.run('reloads'),0);
});

test('only a newer main snapshot for the same account marks existing commerce data stale',()=>{
  const h=harness();h.seed('pembelian',{orders:[]});h.seed('nota',{notes:[]});h.seed('hpp',{models:[]});
  for(const args of ['null,{me:{id:"owner"},ver:11}','{me:{id:"owner"},ver:10},{me:{id:"other"},ver:11}','{me:{id:"owner"},ver:10},{me:{id:"owner"},ver:10}','{me:{id:"owner"},ver:10},{me:{id:"owner"},ver:9}'])h.run('commerceStateChanged('+args+')');
  assert.equal(h.run("!!commerceEntry('pembelian').stale"),false);
  h.run('commerceEntry("nota").version=12;commerceStateChanged({me:{id:"owner"},ver:10},{me:{id:"owner"},ver:11})');
  assert.equal(h.run("commerceEntry('pembelian').stale"),true);assert.equal(h.run("commerceEntry('hpp').stale"),true);assert.equal(h.run("!!commerceEntry('nota').stale"),false);assert.equal(h.requests.length,0,'invalidating does not fetch all modules');
});

test('team sync refreshes only the visible stale module and coalesces repeated polls',async()=>{
  const h=harness();h.seed('pembelian',{orders:[]});h.seed('nota',{notes:[]});h.seed('hpp',{models:[]});
  h.run('S.tab="pembelian-produk";S.state.ver=11;commerceStateChanged({me:{id:"owner"},ver:10},S.state);commerceSyncVisible();commerceSyncVisible()');assert.equal(h.requests.length,1);assert.equal(h.requests[0].action,'getCommerceState');assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].payload)),{module:'pembelian'});
  h.requests[0].resolve(reply('pembelian',{orders:[{id:'from-other-device',revision:'r-new'}]},11));await turn();
  assert.equal(h.run("commerceEntry('pembelian').stale"),false);assert.equal(h.run("commerceEntry('nota').stale"),true);assert.equal(h.run("commerceEntry('hpp').stale"),true);assert.equal(h.run("commerceRecord('pembelian','from-other-device').revision"),'r-new');
  h.run('commerceSyncVisible()');assert.equal(h.requests.length,1,'settled latest data does not refetch');
});

test('team sync pauses writes and hidden pages, then updates the list without changing an open form revision',async()=>{
  const h=harness();h.seed('pembelian',{orders:[{id:'order',revision:'r-old'}]});h.form({id:'order',revision:'r-old',catatan:'Unsaved user draft'},'pembelian');
  h.run('S.tab="pembelian-produk";S.state.ver=11;commerceEntry("pembelian").stale=true;S.tulis=1;commerceSyncVisible();S.tulis=0;var document={hidden:true};commerceSyncVisible();document.hidden=false;S.tab="beranda";commerceSyncVisible()');assert.equal(h.requests.length,0);
  h.run('S.tab="pembelian-produk";commerceSyncVisible()');assert.equal(h.requests.length,1);
  h.requests[0].resolve(reply('pembelian',{orders:[{id:'order',revision:'r-new',catatan:'Saved by colleague'}]},11));await turn();
  assert.deepEqual(h.json('currentForm.values'),{id:'order',revision:'r-old',catatan:'Unsaved user draft'});assert.equal(h.run("commerceRecord('pembelian','order').revision"),'r-new');assert.equal(h.run('drops'),0);
});

test('a deferred commerce refresh cannot install another account snapshot after switching sessions',async()=>{
  const h=harness();h.seed('pembelian',{orders:[{id:'old-private-order'}]});h.run('S.tab="pembelian-produk";commerceEntry("pembelian").stale=true;commerceSyncVisible();S.token="different-session";S.state={me:{id:"other-owner",divisi:"owner"},ver:11};commerceEntry("pembelian")');
  h.requests[0].resolve(reply('pembelian',{orders:[{id:'old-private-order'}]},11));await turn();assert.equal(h.run("commerceEntry('pembelian').data"),null);assert.equal(h.run('idbWrites.length'),0);
});
