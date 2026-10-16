'use strict';
/* 1.5.44: "Batalkan hitungan" only shows for owner/admin on a sewer's counted report without QC or payment,
   sits above the slip preview, and sends the record revision. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
function harness(admin){
  const c=vm.createContext({console,Promise});
  vm.runInContext(`var A={},S={state:{setor:[],kirim:[],upah:[],potong:[],qc:[],payroll:[]}},calls=[],toasts=[],confirms=[],ADMIN=${admin?'true':'false'};
    function isAdmin(){return ADMIN;}function esc(s){return String(s);}function ic(n){return '['+n+']';}function nf(n){return String(n);}function namaUser(id){return 'Nama '+id;}function poNama(id){return 'PO '+id;}
    function coreParseJSON(s,f){if(s===null||s===undefined||s==='')return f;if(typeof s==='object')return s;try{return JSON.parse(s);}catch(e){return f;}}function coreNum(v){var n=Number(v);return isFinite(n)?n:0;}
    function sourcePayroll(id){var paid=(S.state.payroll||[]).some(function(r){return r.sourceId===id&&r.paidQty>0;});return {hasPayment:paid};}
    function sourcePaid(r){return !!r.upahId||sourcePayroll(r.id).hasPayment;}
    function toast(m,e){toasts.push([m,!!e]);}function req(a,p){calls.push({action:a,payload:p});return Promise.resolve({ok:true});}function act(b,p){return p;}
    function confirmBox(o,fn){confirms.push(o);return fn({});}`,c);
  vm.runInContext(part('function findSlip(type, id) {','function historyOriginalRecord('),c);
  vm.runInContext(part('function setorBisaBatal(r) {','A.del = function'),c);
  return c;
}
const run=(c,s)=>vm.runInContext(s,c);
const REC="{id:'set01',noSlip:'SS-1',status:'diterima',maklonId:'m1',dibuatOleh:'m1',poId:'p1',total:76,revision:'rev-5',asal:'',imporSumber:''}";

test('only a counted sewer report without QC or payment can be undone, and only by owner/admin',()=>{
  const c=harness(true);run(c,'S.state.setor=['+REC+']');
  assert.equal(run(c,"setorBisaBatal(findSlip('setor','set01'))"),true);
  assert.equal(run(c,"setorBisaBatal(Object.assign({},findSlip('setor','set01'),{status:'diajukan'}))"),false,'a report that is not counted');
  assert.equal(run(c,"setorBisaBatal(Object.assign({},findSlip('setor','set01'),{dibuatOleh:'qc1'}))"),false,'recorded directly by QC');
  assert.equal(run(c,"setorBisaBatal(Object.assign({},findSlip('setor','set01'),{asal:'lama'}))"),false,'old app data');
  assert.equal(run(c,"setorBisaBatal(Object.assign({},findSlip('setor','set01'),{imporSumber:'{\"baseline\":true}'}))"),false,'imported data');
  assert.equal(run(c,"setorBisaBatal(Object.assign({},findSlip('setor','set01'),{upahId:'u1'}))"),false,'in a wage slip');
  assert.equal(run(c,"S.state.payroll=[{sourceId:'set01',paidQty:3}];var x=setorBisaBatal(findSlip('setor','set01'));S.state.payroll=[];x"),false,'partly paid');
  assert.equal(run(c,"S.state.qc=[{setorId:'set01'}];var y=setorBisaBatal(findSlip('setor','set01'));S.state.qc=[];y"),false,'already inspected');
  assert.equal(run(harness(false),'setorBisaBatal('+REC+')'),false,'not for QC or sewers');
});

test('the action asks first, then sends the id with the record revision',async()=>{
  const c=harness(true);run(c,'S.state.setor=['+REC+']');
  await run(c,"A.setorBatalHitung({getAttribute:function(){return 'set01';}})");
  assert.match(run(c,'confirms[0].text'),/Nama m1 76 pcs \(SS-1\) di PO p1 kembali ke Hitung fisik/);
  assert.deepEqual(JSON.parse(JSON.stringify(run(c,'calls'))),[{action:'batalHitungSetor',payload:{id:'set01',expectedRevision:'rev-5'}}]);
  run(c,"toasts.length=0;calls.length=0;S.state.qc=[{setorId:'set01'}]");
  await run(c,"A.setorBatalHitung({getAttribute:function(){return 'set01';}})");
  assert.equal(run(c,'calls.length'),0);assert.match(run(c,'toasts[0][0]'),/tidak bisa dibatalkan/);
});

test('the slip sheet shows its buttons above the preview and the PO history row offers the undo directly',()=>{
  const slip=part('function slipSheet(type, id) {','return sheetHtml(model.title, h, foot);');
  assert.ok(slip.indexOf("data-a=\"setorBatalHitung\"")>0);
  assert.ok(slip.indexOf("h = (h ? '<div class=\"row wrap\" data-slip-aksi>' + h + '</div>' : '') + '<div class=\"slip-pratinjau\">'")>slip.indexOf('bisaHapus'),'buttons are put before the preview');
  assert.match(html,/batal: setorBisaBatal\(r\) \? r\.id : null/);
  assert.match(html,/e\.batal \? '<button class="btn sm" data-a="setorBatalHitung"/);
});
