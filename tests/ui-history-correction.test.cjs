const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function between(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start); return html.slice(a, b);
}
function context() {
  const c = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core.js'), 'utf8'), c);
  vm.runInContext(`var S={state:{me:{divisi:'owner'},potong:[],kirim:[]}},D={po:{p:{id:'p',status:'aktif',imporSumber:JSON.stringify({legacyReconciliation:{mode:'review'}})}},user:{}};
    var A={},calls=[],renders=[],messages=[],closed=0,seq=0,painted=0;
    var form={values:{},inputs:[]};
    function me(){return S.state.me;}function newId(){return 'edit'+(++seq);}
    function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
    function nf(s){return String(s);}function tgl(s){return s;}function poHead(){return '';}
    function sheetHtml(t,h,f){return t+h+(f||'');}function emptyBox(s){return s;}
    function hid(n,v){return '<input name="'+n+'" value="'+esc(v)+'">';}
    function sizeGrid(s,o){return s.map(k=>k+':'+o.val[k]).join(',');}
    function sumLine(){return '';}function footSave(a){return '<button data-a="'+a+'">Simpan</button>';}
    function openSheet(fn,opt){renders.push(fn);}function paintTop(){painted++;}
    function formVals(f){return f.values;}function topForm(){return form;}function dropForm(){closed++;}
    function $$(q,f){return f.inputs;}function toast(s){messages.push(s);}function quiet(){}
    function act(el,p){return p;}function req(action,payload){calls.push({action,payload});return Promise.resolve({});}`, c);
  vm.runInContext(between('function sizeVals(', 'function recalc('), c);
  vm.runInContext(between('/* ---------- koreksi jumlah fisik', '/* ---------- tab Maklon ---------- */'), c);
  vm.runInContext(`var proof={sheet:'Potong',rowId:'cut1',poId:'p',original:{ukuran:{M:114,L:5},total:119},effective:{ukuran:{M:114,L:5},total:119},sourceHash:'proof-source',lastCorrectionId:'prior-id',history:[]};
    var model={id:'edit1',proof:proof,ukuran:{M:114,L:5},reason:'',err:'',busy:false};
    historyCorrectionEdits.edit1=model;
    form.values={correctionId:'edit1',reason:'Bukti slip potong telah diperiksa'};
    form.inputs=[{value:'144',getAttribute:()=> 'M'},{value:'0',getAttribute:()=> 'L'}];`, c);
  return c;
}
function json(c, expression) { return JSON.parse(vm.runInContext('JSON.stringify(' + expression + ')', c)); }

test('history correction entry is restricted to owner and an active reviewed legacy PO', () => {
  const c=context(); assert.equal(vm.runInContext('canCorrectHistory(D.po.p)',c),true);
  for(const change of [`S.state.me.divisi='admin'`,`S.state.me=null`,`S.state.me={divisi:'owner'};D.po.p.status='selesai'`,`D.po.p.status='aktif';D.po.p.imporSumber='bad JSON'`,`D.po.p.imporSumber=JSON.stringify({legacyReconciliation:{mode:'migrated'}})`]) {
    vm.runInContext(change,c);assert.equal(vm.runInContext('canCorrectHistory(D.po.p)',c),false);
  }
  assert.match(html,/canCorrectHistory\(po\)[^\n]*Koreksi jumlah lama/);
  assert.match(between('function req(', 'function signOutLocal('),/saveHistoryCorrection/);
});

test('record chooser includes only old cuts and assignments belonging to the selected PO',()=>{
  const c=context();vm.runInContext(`S.state.potong=[{id:'c1',poId:'p',asal:'lama',tanggal:'2026-08-06'},{id:'c2',poId:'other',asal:'lama'},{id:'c3',poId:'p',asal:'baru'}];S.state.kirim=[{id:'k1',poId:'p',asal:'lama',tanggal:'2026-08-21'}];`,c);
  assert.deepEqual(json(c,`historyCorrectionRows('p').map(x=>({sheet:x.sheet,id:x.row.id}))`),[{sheet:'Potong',id:'c1'},{sheet:'SlipKirim',id:'k1'}]);
});

test('quantity input preserves zero-valued existing sizes and rejects fractional, zero-total, unchanged and missing-reason submissions',()=>{
  const c=context();assert.deepEqual(json(c,'historyCorrectionInput(form,model).ukuran'),{M:144,L:0});
  vm.runInContext(`form.inputs[0].value='1.5'`,c);assert.throws(()=>vm.runInContext('historyCorrectionInput(form,model)',c),/bulat/);
  vm.runInContext(`form.inputs[0].value='0'`,c);assert.throws(()=>vm.runInContext('historyCorrectionInput(form,model)',c),/Total jumlah fisik/);
  vm.runInContext(`form.inputs[0].value='114';form.inputs[1].value='5'`,c);assert.throws(()=>vm.runInContext('historyCorrectionInput(form,model)',c),/belum berubah/);
  vm.runInContext(`form.inputs[0].value='144';form.values.reason=' '` ,c);assert.throws(()=>vm.runInContext('historyCorrectionInput(form,model)',c),/alasan/);
});

test('stale save keeps entered correction and old proof; reload obtains fresh proof before another save',async()=>{
  const c=context();vm.runInContext(`req=function(action,payload){calls.push({action,payload});return Promise.reject(new Error('Data berubah sejak dibuka. Muat ulang.'));};`,c);
  await vm.runInContext('A.historyCorrectionSave()',c);
  const first=json(c,'calls[0]'); assert.equal(first.action,'saveHistoryCorrection');
  assert.equal(first.payload.expectedSourceHash,'proof-source');assert.equal(first.payload.expectedLastCorrectionId,'prior-id');
  assert.deepEqual(first.payload.ukuran,{M:144,L:0});
  assert.equal(vm.runInContext('model.proof.sourceHash',c),'proof-source');assert.equal(vm.runInContext('model.ukuran.M',c),144);
  assert.match(vm.runInContext('model.err',c),/Data berubah/);assert.equal(vm.runInContext('closed',c),0);
  assert.match(vm.runInContext('historyCorrectionForm(model)',c),/Muat ulang catatan/);
  vm.runInContext(`req=function(action,payload){calls.push({action,payload});return Promise.resolve(Object.assign({},proof,{sourceHash:'fresh-source',lastCorrectionId:'new-prior',effective:{ukuran:{M:130,L:5},total:135}}));};`,c);
  await vm.runInContext('A.historyCorrectionReload({})',c);
  assert.equal(vm.runInContext('model.proof.sourceHash',c),'fresh-source');assert.equal(vm.runInContext('model.ukuran.M',c),130);
  assert.equal(vm.runInContext('model.reason',c),'');assert.equal(vm.runInContext('model.err',c),'');
});

test('correction form escapes audit author, reason and timestamp and never promises to release the PO',()=>{
  const c=context();vm.runInContext(`model.proof.history=[{id:'c',before:{ukuran:{M:114}},after:{ukuran:{M:144}},createdBy:'<img src=x>',createdAt:'<script>x</script>',reason:'<b>reason</b>'}];`,c);
  const rendered=vm.runInContext('historyCorrectionForm(model)',c);
  assert.doesNotMatch(rendered,/<img|<script>|<b>reason/);assert.match(rendered,/&lt;img/);assert.match(rendered,/114.*→.*144/);
  assert.match(rendered,/Upah dan pembayaran lama tidak berubah/);assert.match(rendered,/belum membuka PO/);
});

test('weekly cutting wages keep the original paid basis after physical quantity correction',()=>{
  const c=context();vm.runInContext(`S.state.settings={ukuran:['M']};S.state.potong=[{id:'cut',poId:'p',userId:'w',tanggal:'2026-10-08',total:144,ukuran:{M:144},tarif:1000,upahId:'LAMA',historyCorrection:{original:{total:114,ukuran:{M:114}}}}];
    function kasbonSemua(){return [];}function sourcePayroll(){return {known:true,available:0,review:false};}
    function tglSlip(s){return s;}function rp(n){return String(n);}function poNama(){return 'Barang';}function slipKop(){return {nama:'Usaha'};}`,c);
  vm.runInContext(between('function slipUpahMingguan(', 'function upahMingguView('),c);
  const result=json(c,`slipUpahMingguan({id:'w',nama:'Pekerja',divisi:'potong'},'2026-10-01','2026-10-31')`);
  assert.equal(result.bersih,114000);assert.equal(result.model.rows[0][2],'114 pcs');assert.equal(result.model.rows[0][4],'114000');
  assert.match(result.model.rows[0][1],/Fisik setelah koreksi 144 pcs; dasar upah awal tetap 114 pcs/);
});

test('historical assignment copy and payment fallback use original quantities without mutating physical state',()=>{
  const c=context();vm.runInContext(between('function historyOriginalRecord(', 'function openSlip('),c);
  vm.runInContext(`var changed={id:'cut',total:144,ukuran:{M:144},tarif:1000,historyCorrection:{original:{total:114,ukuran:{M:114}}}};S.state.potong=[changed];`,c);
  assert.equal(vm.runInContext('historyOriginalRecord(changed).total',c),114);
  assert.equal(vm.runInContext('historyOriginalRecord(changed).historyPhysicalTotal',c),144);
  assert.equal(vm.runInContext('changed.total',c),144);
  assert.deepEqual(json(c,`slipCtx('upah',{jenis:'potong',pegawaiId:'w',itemIds:['cut'],items:[]}).items.map(r=>({total:r.total,ukuran:r.ukuran}))`),[{total:114,ukuran:{M:114}}]);
  assert.match(between('A.slipCopy =', 'A.slipPdf ='),/type === 'kirim'\) rec = historyOriginalRecord\(rec\)/);
});
