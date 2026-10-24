'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),core=fs.readFileSync(path.join(root,'src/core.js'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
function harness(){
 const calls=[],c=vm.createContext({console,transport(action,payload){return new Promise((resolve,reject)=>calls.push({action,payload:JSON.parse(JSON.stringify(payload)),resolve,reject}));}});
 vm.runInContext(core,c);
 vm.runInContext(fs.readFileSync(path.join(root,'src/history-corrections.js'),'utf8'),c);
 vm.runInContext(`
 var A={},C={},R={},sheets=[],messages=[],S={token:'owner-session',busy:0,displayVersion:10,state:{ver:10,workflowVersion:2,me:{id:'owner01',divisi:'owner'},settings:{ukuran:['M'],poSembunyi:[]},stok:[],kirim:[],setor:[],potong:[],payroll:[]}},D={po:{},produk:{},user:{}};
 var modal={appendChild:function(node){node.parentNode=this;},removeChild:function(node){node.parentNode=null;}},document={body:{classList:{toggle:function(){}}},createElement:function(){return {innerHTML:''};}};
 function decode(s){return String(s||'').replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');}
 function attr(tag,name){var m=tag.match(new RegExp('(?:^|\\\\s)'+name+'="([^"]*)"'));return m?decode(m[1]):null;}
 function readForm(node){if(node.form)return node.form;if(!/data-form=/.test(node.innerHTML))return null;var f={values:{},boxes:[],isConnected:true,closest:function(){return null;}};node.innerHTML.replace(/<input\\b[^>]*>/g,function(tag){var name=attr(tag,'name');if(name)f.values[name]=attr(tag,'value')||'';if(attr(tag,'data-upah'))f.boxes.push({checked:/\\bchecked\\b/.test(tag),getAttribute:function(k){return attr(tag,k);}});});node.form=f;return f;}
 function $(selector,scope){if(selector==='#modal')return modal;if(selector.indexOf('[data-form')===0)return scope?readForm(scope):null;return null;}
 function $$(selector,scope){if(selector==='[data-form]'){var f=readForm(scope);return f?[f]:[];}if(selector==='input[data-upah]')return scope.boxes||[];return [];}
 function esc(v){return String(v===undefined?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
 function hid(k,v){return '<input name="'+k+'" value="'+esc(v)+'">';}function sheetHtml(t,b,f){return t+b+(f||'');}
 function fText(t,k,v){return hid(k,v);}function fNum(t,k,v){return hid(k,v);}function fSelect(t,k,choices,v){return hid(k,v);}function fTanggal(t,k,v){return hid(k,v===undefined?'2026-10-11':v);}function fCatatan(v){return hid('catatan',v||'');}
 function emptyBox(s){return s;}function footSave(){return '';}function ic(){return '';}function thumb(){return '';}function sizeGrid(){return '';}function sumLine(){return '';}function daftarIsi(){return '';}
 function topForm(){return readForm(sheets[sheets.length-1].node);}function formVals(f){return Object.assign({},f.values||readForm(f).values);}function sizeVals(){return {M:10};}function rejectValues(){return {};}
 function recalc(){}function hydrateImages(){}function refresh(){}function paintSync(){}function render(){}function signOutLocal(){}function toast(m){messages.push(m);}function quiet(e){messages.push(e.message);}function act(el,p){return p;}
 function closeSheet(){sheets.pop();}function dropForm(f){sheets=sheets.filter(function(s){return s.node.form!==f;});}function newId(){return 'new-row-0001';}function me(){return S.state.me;}function isAdmin(){return true;}function poPrepareOwner(){return true;}function poPaintDraftGambar(){}
 function applyState(st){S.state=st;}var Api={call:transport,mode:function(){return 'gas';}};
 function findSlip(type,id){return (S.state[type]||[]).find(function(r){return r.id===id;});}function namaUser(id){return id;}function poNama(id){return id;}function tgl(s){return s;}function nf(v){return String(v);}function rp(v){return String(v);}function todayYmd(){return '2026-10-11';}function selisihHari(){return 1;}
 function bahanInfo(){return null;}function stokSemua(){return [];}function unik(rows){return [...new Set(rows)];}function sizesSplit(){return {main:['M'],extra:[]};}function categorySizes(){return {};}function setorLaporanLama(){return false;}function terimaLaporan(){return {M:10};}function poHead(){return '';}function terimaPosisi(){return '';}function rejectGrid(){return '';}function hargaKiriman(){return 100;}function tarifBawaan(){return 100;}
 function unpaidOf(){return S.state.payroll.slice();}function payrollNotice(){return '';}function cicilanMingguIni(){return 0;}function openSlip(){}
 function button(values){return {getAttribute:function(k){return values[k]===undefined?null:values[k];}};}
 `,c);
 vm.runInContext(part('function showSheets()', 'function dropSheet('),c);
 vm.runInContext(part('function confirmBox(', 'A.confirmOk ='),c);
 vm.runInContext(part('function req(', 'function signOutLocal('),c);
 for(const markers of [
  ['A.hargaOpen = function','A.slipCopy ='],['A.targetOpen = function','A.goPegawai ='],['function openBeli(','A.stokDel ='],
  ['function openTerima(','/* Posisi jahitan'],['A.terimaSave = function','/* ---------- QC'],['function openUpah(','R.upah ='],['A.upahSave = function','A.lunasOpen ='],
  ['function openPO(id, produkId)','C.poJenisForm ='],['A.poSave = function','function poPreparedFreeze(']
 ])vm.runInContext(part(...markers),c);
 const run=s=>vm.runInContext(s,c);return {c,calls,run,json:s=>JSON.parse(run('JSON.stringify('+s+')'))};
}
function tick(){return new Promise(resolve=>setImmediate(resolve));}
function sync(h,body=''){h.run('S.state.ver=20;S.displayVersion=20;'+body);}
function seedPO(h){h.run("D.po.po01={id:'po01',revision:'po-rev-1',nama:'Kaos',jenis:'stok',status:'aktif',ukuran:{M:10},bahan:'Kain'};");}

test('generic global-version action list matches the server and retains the displayed snapshot outside forms',async()=>{
 const server=core.match(/var GLOBAL_VERSION_WRITE = \{([^}]+)\}/)[1].split(',').map(s=>s.split(':')[0].trim()).sort();
 const client=part('function req(','function signOutLocal(').match(/if \(\/\^\((saveSettings[^)]+)\)\$\/\.test\(action\)/)[1].split('|').sort();
 assert.deepEqual(client,server);const h=harness();h.run('S.state.ver=20');
 for(const action of server){h.run('req('+JSON.stringify(action)+',{})');assert.equal(h.calls.at(-1).payload.expectedVersion,10,action);h.calls.at(-1).resolve({});}
 await tick();assert.equal(h.run('S.busy'),0);
});

test('a non-live form and nested confirmation keep their original version after another device syncs',async()=>{
 const h=harness();h.run("openSheet(function(){return '<div data-form=\"settings\">'+hid('name','old')+'</div>';});");
 sync(h);h.run("confirmBox({title:'Hapus?'},function(){return req('deleteRecord',{sheet:'Produk',id:'product01'});});S.confirm();");
 assert.deepEqual(h.json('sheets.map(s=>s.dataVersion)'),[10,10]);assert.equal(h.calls[0].payload.expectedVersion,10);h.calls[0].resolve({});await tick();
});

test('a refreshed live sheet uses its visible new version and an explicit proof is never overwritten',async()=>{
 const h=harness();h.run("openSheet(function(){return 'Live daftar';},{live:true});");sync(h);h.run("paintTop();req('saveSettings',{});req('arsipPO',{id:'po01',expectedVersion:31});");
 assert.equal(h.calls[0].payload.expectedVersion,20);assert.equal(h.calls[1].payload.expectedVersion,31);h.calls.forEach(c=>c.resolve({}));await tick();
});

test('PO and purchase-stock edits submit the row revision captured at form opening',async()=>{
 const po=harness();seedPO(po);po.run("openPO('po01','');");assert.equal(po.run('topForm().values.revision'),'po-rev-1');sync(po,"D.po.po01.revision='po-rev-2';D.po.po01.nama='Edited elsewhere';");
 const saved=po.run('A.poSave({})');await tick();assert.equal(po.calls[0].action,'savePO');assert.equal(po.calls[0].payload.expectedRevision,'po-rev-1');assert.equal(po.calls[0].payload.po.nama,'Kaos');po.calls[0].resolve({id:'po01'});await saved;
 const stock=harness();stock.run("S.state.stok=[{id:'stock01',revision:'stock-rev-1',bahan:'Kain',qty:5,satuan:'kg',rol:1,harga:200,total:1000,tanggal:'2026-10-10'}];openBeli('stock01','');");
 sync(stock,"S.state.stok[0].revision='stock-rev-2';S.state.stok[0].qty=9;");stock.run('A.beliSave({})');assert.equal(stock.calls[0].payload.expectedRevision,'stock-rev-1');assert.equal(stock.calls[0].payload.stok.qty,'5');stock.calls[0].resolve({});await tick();
});

test('both cutting and sewing prices keep the displayed source revision rather than re-reading it on save',async()=>{
 for(const [sheet,collection] of [['Potong','potong'],['SlipSetor','setor']]){const h=harness();h.run('S.state.'+collection+"=[{id:'source01',revision:'rate-rev-1'}];A.hargaOpen(button({'data-s':"+JSON.stringify(sheet)+",'data-id':'source01','data-v':'100'}));");
 sync(h,'S.state.'+collection+"[0].revision='rate-rev-2';");h.run("topForm().values.harga='150';A.hargaSave({});");assert.equal(h.calls[0].payload.expectedRevision,'rate-rev-1');assert.equal(h.calls[0].payload.harga,'150');h.calls[0].resolve({});await tick();}
});

test('sewing target freezes exactly the applicable assignment revisions, even if another device adds an assignment',async()=>{
 const h=harness();seedPO(h);h.run("S.state.kirim=[{id:'send01',poId:'po01',maklonId:'sewer01',revision:'send-rev-1'},{id:'unrelated',poId:'po01',maklonId:'other',revision:'other-rev'}];A.targetOpen(button({'data-id':'po01','data-m':'sewer01','data-v':'2026-10-12'}));");
 sync(h,"S.state.kirim[0].revision='send-rev-2';S.state.kirim.push({id:'send02',poId:'po01',maklonId:'sewer01',revision:'new-rev'});");h.run("topForm().values.target='2026-10-13';A.targetSave(button({}));");
 assert.deepEqual(h.calls[0].payload.expectedRevisions,{send01:'send-rev-1'});h.calls[0].resolve({});await tick();
});

test('accepting and rejecting a sewing report keep its displayed revision through sync and a confirmation',async()=>{
 for(const action of ['accept','reject']){const h=harness();seedPO(h);h.run("S.state.setor=[{id:'setor01',poId:'po01',maklonId:'sewer01',status:'diajukan',ukuran:{M:10},revision:'count-rev-1'}];openTerima('setor01');");
 sync(h,"S.state.setor[0].revision='count-rev-2';");h.run(action==='accept'?'A.terimaSave({})':'A.terimaTolak();S.confirm({});');assert.equal(h.calls[0].action,'prosesSetor');assert.equal(h.calls[0].payload.expectedRevision,'count-rev-1');assert.equal(h.calls[0].payload.keputusan,action==='accept'?'terima':'tolak');h.calls[0].resolve({});await tick();}
});

test('payroll submission binds only checked earned rows and their original displayed revisions',async()=>{
 const h=harness();h.run("D.user.worker01={id:'worker01',nama:'Pemotong',divisi:'potong'};S.state.payroll=[{id:'earned01',revision:'pay-rev-1',tanggal:'2026-10-10',total:10,rate:100},{id:'earned02',revision:'pay-rev-b',tanggal:'2026-10-10',total:20,rate:100}];openUpah('worker01');topForm().boxes[1].checked=false;");
 sync(h,"S.state.payroll[0].revision='pay-rev-2';S.state.payroll[0].rate=999;S.state.payroll.push({id:'earned03',revision:'pay-rev-new'});");h.run('A.upahSave({})');assert.deepEqual(h.calls[0].payload.upah.itemIds,['earned01']);assert.deepEqual(h.calls[0].payload.upah.expectedRevisions,{earned01:'pay-rev-1'});h.calls[0].resolve({});await tick();
});

test('saving a PO before archiving uses the newly confirmed business version for the second action',async()=>{
 const h=harness();seedPO(h);h.run("openPO('po01','');topForm().values.status='arsip';");sync(h,"D.po.po01.revision='remote-rev';");
 const saving=h.run('A.poSave({})');await tick();assert.equal(h.calls[0].payload.expectedRevision,'po-rev-1');
 h.calls[0].resolve({data:{id:'po01'},state:{...h.json('S.state'),ver:21}});await tick();assert.equal(h.calls[1].action,'arsipPO');assert.equal(h.calls[1].payload.expectedVersion,21);assert.equal(h.run('sheets[0].dataVersion'),10);h.calls[1].resolve({});await saving;
});

test('a PO image selected before sync keeps its initial proof even if decoding finishes after the form closes',async()=>{
 const h=harness();seedPO(h);vm.runInContext(part('C.poGambar = function','A.poSave = function'),h.c);
 h.run("var decoded;function fileToThumb(){return new Promise(function(resolve){decoded=resolve;});}openPO('po01','');var file=button({'data-id':'po01'});file.files=[{name:'image.png'}];file.closest=function(){return topForm();};C.poGambar(file);closeSheet();");
 sync(h);h.run("decoded('data:image/png;base64,eA==');");await tick();assert.equal(h.calls.length,1);assert.equal(h.calls[0].action,'saveGambar');assert.equal(h.calls[0].payload.expectedVersion,10);h.calls[0].resolve({});await tick();
});

test('changing the authenticated session during image decoding cannot submit the old form as the new account',async()=>{
 const h=harness();seedPO(h);vm.runInContext(part('C.poGambar = function','A.poSave = function'),h.c);
 h.run("var decoded;function fileToThumb(){return new Promise(function(resolve){decoded=resolve;});}openPO('po01','');var file=button({'data-id':'po01'});file.files=[{name:'image.png'}];file.closest=function(){return topForm();};C.poGambar(file);S.token='different-owner-session';S.state.me.id='owner02';decoded('data:image/png;base64,eA==');");
 await tick();assert.equal(h.calls.length,0);
});
