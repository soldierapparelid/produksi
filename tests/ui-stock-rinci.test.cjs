'use strict';
/* "Rinci rol": the owner types the weight of each roll of stock that is already there. Nothing is bought, the total stays. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
function ui(){
  const c=vm.createContext({console});
  vm.runInContext(`
    var A={},R={},requests=[],messages=[],closed=0,rendered='',refreshed=0,actor={divisi:'owner'},document={};
    var info={nama:'Scuba Hitam',satuan:'kg',saldo:228.05,legacyTersedia:155.925};
    var form={values:{id:'rinci-form-1',bahan:'Scuba Hitam',catatan:'timbang'},inputs:[],nodes:{},attrs:{'data-sisa':'155.925'},getAttribute:function(k){return this.attrs[k];}};
    ['[data-rinci-jumlah]','[data-rinci-total]','[data-rinci-sisa]'].forEach(function(k){form.nodes[k]={textContent:'',style:{}};});
    function isi(list){form.inputs=list.map(function(v){return {value:String(v),label:{textContent:''}};});}
    function me(){return actor;}function bahanInfo(){return info;}function coreNum(x){x=Number(x);return isFinite(x)?x:0;}
    function $(s,f){return f.nodes[s]||null;}function $$(s,f){if(s==='[data-rinci-roll] input'||s==='[data-rinci-roll]')return f.inputs;if(s==='[data-rinci-no]')return f.inputs.map(function(i){return i.label;});return [];}
    function formVals(f){return Object.assign({},f.values);}function topForm(){return form;}function act(el,p){return p;}function quiet(){}
    function req(action,payload){return new Promise(function(resolve,reject){requests.push({action:action,payload:payload,resolve:resolve,reject:reject});});}
    function toast(m){messages.push(m);}function dropForm(){closed++;}function newId(){return 'rinci-form-1';}function openSheet(fn){rendered=fn();}function sheetHtml(t,b,f){return t+b+(f||'');}
    function esc(s){return String(s==null?'':s);}function nf(n){return String(n);}function nfQty(n){return String(Math.round(Number(n)*1000)/1000).replace('.',',');}function ic(){return '';}function emptyBox(s){return s;}
    function hid(k,v){return '<input name="'+k+'" value="'+v+'">';}function fCatatan(){return '';}function footSave(a,l){return '<button data-a="'+a+'">'+l+'</button>';}function recalc(){}
    var confirmText='',confirmFn=null;function confirmBox(o,fn){confirmText=o.title+' '+o.text;confirmFn=fn;}
    var sheets=[],rolls=[];function dropSheet(){}function stokRolById(id){return rolls.filter(function(r){return r.id===id;})[0]||null;}function fNum(l,n,v,a,h){return '<input name="'+n+'" value="'+v+'">'+(h||'');}
  `,c);
  vm.runInContext(part('function rolRinciBebas(','function stokRolBahan('),c);
  vm.runInContext(part('/* Rinci rol: owner mengisi','A.cocokOpen = function (el) {'),c);
  vm.runInContext('rollPilihanSegarkan=function(){refreshed++;};',c);
  return {c,run:s=>vm.runInContext(s,c),json:s=>JSON.parse(vm.runInContext('JSON.stringify('+s+')',c))};
}
const el="{getAttribute:function(){return 'Scuba Hitam';}}";

test('the form shows what has no roll detail yet and says plainly that nothing is bought',()=>{
  const h=ui();h.run(`A.rinciRolOpen(${el})`);const view=h.run('rendered');
  assert.match(view,/Rinci rol/);assert.match(view,/Scuba Hitam/);assert.match(view,/155,925/);assert.match(view,/bukan pembelian baru/);assert.match(view,/Total stok tidak berubah/);
  assert.match(view,/name="id" value="rinci-form-1"/);assert.match(view,/data-sisa="155.925"/);assert.equal((view.match(/data-rinci-roll>/g)||[]).length,2);assert.match(view,/data-a="rinciRolSave">Simpan rol/);
  h.run("info.legacyTersedia=0;A.rinciRolOpen("+el+")");assert.match(h.run('rendered'),/sudah dirinci per rol atau sedang dicadangkan/);assert.doesNotMatch(h.run('rendered'),/rinciRolSave/);
  h.run("info.legacyTersedia=40;info.satuan='meter';A.rinciRolOpen("+el+")");assert.match(h.run('rendered'),/hanya untuk bahan yang dicatat dalam kg/);
  h.run("info.satuan='kg';actor.divisi='admin';rendered='';A.rinciRolOpen("+el+")");assert.equal(h.run('rendered'),'');assert.match(h.run('messages[messages.length-1]'),/owner/);
});

test('each roll is numbered, the total and what is left are shown, and the saved rolls are exactly what was typed',async()=>{
  const h=ui();h.run("isi([25,24,'']);R.rinciRol(form)");
  assert.deepEqual(h.json('form.inputs.map(function(i){return i.label.textContent;})'),['Rol 1','Rol 2','Rol 3']);
  assert.equal(h.run("form.nodes['[data-rinci-jumlah]'].textContent"),'2 rol');assert.equal(h.run("form.nodes['[data-rinci-total]'].textContent"),'49 kg');assert.equal(h.run("form.nodes['[data-rinci-sisa]'].textContent"),'106,925 kg');
  const sent=h.run('A.rinciRolSave(null)');h.run('A.rinciRolSave(null)');assert.equal(h.run('requests.length'),1,'a double tap sends once');
  assert.deepEqual(h.json('requests[0]'),{action:'rinciStokRol',payload:{id:'rinci-form-1',bahan:'Scuba Hitam',rolls:[{qty:25},{qty:24}],catatan:'timbang'}});
  h.run('requests[0].resolve({})');await sent;assert.equal(h.run('closed'),1);assert.equal(h.run('refreshed'),1,'an open PO or cut form shows the new rolls at once');assert.match(h.run('messages[messages.length-1]'),/2 rol tersimpan/);
});

test('a mistyped roll that nobody used yet can be taken back; the list offers it only for such rolls',async()=>{
  const h=ui();h.run("A.rinciRolHapus({getAttribute:function(){return 'rinci-1-r2';}})");assert.match(h.run('confirmText'),/Total stok tidak berubah/);
  const done=h.run('confirmFn(null)');assert.deepEqual(h.json('requests[0]'),{action:'deleteRecord',payload:{sheet:'StokBahan',id:'rinci-1-r2'}});h.run('requests[0].resolve({})');await done;assert.match(h.run('messages[messages.length-1]'),/kembali ke stok tanpa rincian rol/);
  const list=part('A.cocokOpen = function (el) {','function openCocokLegacy(');assert.match(list,/r\.rinci&&!coreNum\(r\.pakai\)&&!coreNum\(r\.koreksi\)&&!coreNum\(r\.dicadangkan\)&&!r\.correctionRevision\?'<button class="btn sm ghost" data-a="rinciRolHapus"/);
});

test('a tapped roll opens its weight for correction; a roll already in use explains why it stays',async()=>{
  const h=ui();h.run("rolls=[{id:'rin-1',bahan:'Scuba Hitam',rollLabel:'Rol 2',qty:48.85,saldo:48.85,rinci:true},{id:'rin-2',bahan:'Scuba Hitam',rollLabel:'Rol 3',qty:20,saldo:5,pakai:15,rinci:true}];info.legacyTersedia=10;form.values={id:'rin-1',lama:'48.85',qty:'24.35'};");
  h.run("A.rinciRolEdit({getAttribute:function(){return 'rin-1';}})");let view=h.run('rendered');assert.match(view,/Ubah rol/);assert.match(view,/Scuba Hitam · Rol 2/);assert.match(view,/name="qty" value="48.85"/);assert.match(view,/Paling banyak 58,85 kg/);assert.match(view,/Total stok tidak berubah/);
  assert.match(view,/data-a="rinciRolHapus" data-id="rin-1"/);assert.match(view,/data-a="rinciEditSave"/);
  const sent=h.run('A.rinciEditSave(null)');h.run('A.rinciEditSave(null)');assert.equal(h.run('requests.length'),1,'a double tap sends once');assert.deepEqual(h.json('requests[0]'),{action:'ubahRinciRol',payload:{id:'rin-1',qty:24.35,expectedQty:48.85}});
  h.run('requests[0].resolve({})');await sent;assert.equal(h.run('closed'),1);assert.equal(h.run('refreshed'),1);assert.match(h.run('messages[messages.length-1]'),/diperbarui/);
  h.run("A.rinciRolEdit({getAttribute:function(){return 'rin-2';}})");view=h.run('rendered');assert.match(view,/sudah dipakai, dicadangkan, atau pernah dikoreksi/);assert.doesNotMatch(view,/rinciEditSave|rinciRolHapus/);
  for(const bad of ['','0','-2','1.0001','abc']){h.run('requests.length=0;form.values.qty='+JSON.stringify(bad)+';A.rinciEditSave(null)');assert.equal(h.run('requests.length'),0,bad);}
  h.run("messages.length=0;A.rinciRolEdit({getAttribute:function(){return 'gone';}})");assert.match(h.run('messages[0]'),/sudah berubah/);
  h.run("actor.divisi='admin';messages.length=0;rendered='';A.rinciRolEdit({getAttribute:function(){return 'rin-1';}})");assert.match(h.run('messages[0]'),/owner/);assert.equal(h.run('rendered'),'');
});

test('more than the stock without roll detail, or an unsound weight, is stopped on the device',()=>{
  const h=ui();
  for(const [list,pattern] of [[[100,60],/melebihi stok yang belum dirinci/],[[25,1.0001],/maksimal 3 angka/],[[0],/lebih dari nol/],[[-3],/lebih dari nol/],[[''],/minimal satu rol/]]){
    h.run('isi('+JSON.stringify(list)+');A.rinciRolSave(null)');assert.equal(h.run('requests.length'),0,JSON.stringify(list));assert.match(h.run('messages[messages.length-1]'),pattern);
  }
  h.run("isi([100,60]);R.rinciRol(form)");assert.equal(h.run("form.nodes['[data-rinci-sisa]'].style.color"),'var(--bad)');
});
