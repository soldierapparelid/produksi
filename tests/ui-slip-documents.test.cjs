'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
function node(tag){return {tag,style:{},children:[],parentNode:null,disabled:false,attributes:{},textContent:'',classList:{add(){},remove(){}},setAttribute(k,v){this.attributes[k]=v;},appendChild(n){this.children.push(n);n.parentNode=this;return n;},removeChild(n){this.children=this.children.filter(x=>x!==n);n.parentNode=null;}};}
function printDoc(){const button=node('button'),status=node('p');return {html:'',images:[],open(){},write(h){this.html+=h;},close(){},querySelectorAll(){return [];},getElementById(id){return id==='slip-print-button'?button:status;},button,status};}
function ui(mode='normal'){
  const events=[],timers=new Map(),urls=[],revoked=[];let serial=0;
  const doc={body:node('body'),head:node('head'),getElementById(){return null;},createElement(tag){const n=node(tag);if(tag==='a')n.click=function(){events.push('download');};if(tag==='iframe'){n.contentDocument=printDoc();n.contentWindow={focus(){},print(){events.push('frame.print');if(mode==='throw')throw Error('blocked print');}};Object.defineProperty(n,'srcdoc',{set(h){this.html=h;if(mode==='initial-empty'){const actual=n.contentDocument;n.contentDocument={images:[],getElementById(){return null;}};n.onload();n.contentDocument=actual;}n.contentDocument.write(h);queueMicrotask(()=>n.onload());},get(){return this.html;}});}return n;}};
  const popupDoc=printDoc(),popup={document:popupDoc,closed:false,focus(){events.push('focus');},print(){events.push('print');if(mode==='throw')throw Error('blocked print');}};
  const context=vm.createContext({console,Blob,Uint8Array,atob,document:doc,window:{open(){events.push('open');return mode==='blocked'?null:popup;}},URL:{createObjectURL(blob){urls.push(blob);return 'blob:local-pdf';},revokeObjectURL(url){revoked.push(url);}},setTimeout(fn,ms){const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}});
  vm.runInContext(['core.js','slip-models.js'].map(f=>fs.readFileSync(path.join(root,'src',f),'utf8')).join('\n'),context);
  vm.runInContext(`var A={},C={},VIEWS={},sheets=[],S={f:{},sub:{},state:{settings:{ukuran:['M','L'],kopSlip:'Usaha Contoh'},users:[],po:[],potong:[],setor:[],upah:[],payroll:[],kasbon:[]}},D={po:{},user:{}};
    var LOGO_SRC='',requests=[],closed=0,rendered='',resolveRequest,rejectRequest;
    function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
    function ic(){return '';}function nf(n){return coreRibuan(n);}function rp(n){return coreRupiah(n);}function tglSlip(d){return coreSlipDate(d);}
    function me(){return S.state.me||{id:'w',divisi:'jahit'};}function isAdmin(){return me().divisi==='owner';}
    function poNama(id){return D.po[id]&&D.po[id].nama||'PO';}function toast(){}function quiet(){}function act(el,p){return p;}
    var Api={mode:function(){return 'gas';}};
    function sheetHtml(title,body,foot){return title+body+(foot||'');}
    function openSheet(fn,opt){sheets.push({render:fn,opt:opt});rendered=fn();}
    function paintTop(){rendered=sheets[sheets.length-1].render();}
    function req(action,payload){requests.push({action,payload});return new Promise(function(resolve,reject){resolveRequest=resolve;rejectRequest=reject;});}
  `,context);
  vm.runInContext(part('var SLIP_CSS =','/* ---------- periode mingguan'),context);
  const run=code=>vm.runInContext(code,context),json=code=>JSON.parse(run('JSON.stringify('+code+')'));
  run(`var m={layout:'weekly-a4',title:'Slip Upah Jahit',reference:'JHT / contoh',recipient:'Nama <script>x</script>',recipientLabel:'Penjahit',period:'5 — 11 Okt 2026',columns:[{label:'Pekerjaan'},{label:'Upah',align:'right'}],rows:[['Kaos & Celana','Rp 80.000']],summary:[{label:'Tersedia',value:'Rp 10.000',emphasis:true}],sections:[],signatures:[]};`);
  return {context,run,json,events,doc,popupDoc,timers,urls,revoked};
}
test('preview and visible print document contain the same escaped model and preserve four-up grouping',()=>{
  const u=ui();const preview=u.run('slipLembar([m])'),document=u.run('slipDocumentHtml([m])');
  assert.ok(document.includes(preview));assert.doesNotMatch(document,/<script>x/);assert.match(document,/&lt;script&gt;x/);
  assert.match(document,/slip-print-button/);assert.match(document,/@media print\{\.slip-tools\{display:none/);
  const four=u.run(`slipLembar(Array.from({length:5},()=>Object.assign({},m,{layout:'four-up'})))`);
  assert.equal((four.match(/data-layout="four-up"/g)||[]).length,2);assert.equal((four.match(/<article class="sa-slip">/g)||[]).length,5);
});
test('print opens a visible in-app preview synchronously and denied printing leaves two usable retry buttons',async()=>{
  const u=ui('throw'),done=u.run('slipCetak([m])');
  assert.equal(u.doc.body.children.length,1,'visible preview is created before waiting for images or promises');
  assert.deepEqual(u.events,[],'no unobservable popup is needed');
  const overlay=u.doc.body.children[0],frame=overlay.children.find(n=>n.tag==='iframe'),doc=frame.contentDocument;
  await done;
  assert.ok(u.events.includes('frame.print'));assert.equal(doc.button.disabled,false);assert.equal(typeof doc.button.onclick,'function');
  assert.match(doc.status.textContent,/Browser belum membuka dialog/);
  assert.equal(overlay.children[1].textContent,'Cetak / Simpan PDF');assert.equal(overlay.children[1].disabled,false);
  assert.doesNotThrow(()=>overlay.children[1].onclick());assert.equal(u.events.filter(e=>e==='frame.print').length,2);
  assert.equal(u.timers.size,0,'no spinner deadline or hidden document leak');
});
test('embedded browser always retains the visible printable document even if it cannot expose popups',async()=>{
  const u=ui('blocked');await u.run('slipCetak([m])');
  const overlay=u.doc.body.children[0],frame=overlay.children.find(n=>n.tag==='iframe');
  assert.equal(overlay.attributes.role,'dialog');assert.match(frame.srcdoc,/Slip Upah Jahit/);
  assert.doesNotMatch(frame.style.cssText,/hidden|-10000/);assert.ok(u.events.includes('frame.print'));
  assert.equal(u.events.includes('open'),false);
  overlay.children[0].onclick();assert.equal(u.doc.body.children.length,0);
});
test('initial about:blank iframe load is ignored and the real srcdoc load enables printing exactly once',async()=>{
  const u=ui('initial-empty'),pending=u.run('slipCetak([m])');
  assert.equal(u.doc.body.children[0].children[1].disabled,true,'blank load does not expose a premature print action');
  await pending;
  const overlay=u.doc.body.children[0],frame=overlay.children.find(n=>n.tag==='iframe');
  assert.equal(overlay.children[1].disabled,false);assert.equal(frame.contentDocument.button.disabled,false);
  assert.equal(u.events.filter(event=>event==='frame.print').length,1);assert.equal(u.timers.size,0);
  frame.onload();await Promise.resolve();assert.equal(u.events.filter(event=>event==='frame.print').length,1,'duplicate real load cannot print twice');
});

test('closing all account views removes ready and still-loading print previews before a newer login is shown',async()=>{
 for(const ready of [false,true]){
  const u=ui();u.run('function showSheets(){}');vm.runInContext(part('function closeAll()', 'A.close ='),u.context);
  const pending=u.run('slipCetak([m])');if(ready)await pending;
  assert.equal(u.doc.body.children.length,1);u.run('closeAll()');await pending;await Promise.resolve();
  assert.equal(u.doc.body.children.length,0);assert.equal(u.run('slipPreviews.length'),0);assert.equal(u.timers.size,0);
  if(!ready)assert.equal(u.events.filter(e=>e==='frame.print').length,0,'closed preview must not print late after its account has gone');
 }
});
test('PDF download waits for a real PDF then exposes persistent user-clicked download/open links',async()=>{
  const u=ui();vm.runInContext(part('A.slipPdf =','A.slipDel ='),u.context);
  const done=u.run(`slipUnduh('makeWeeklyPdf',{pegawaiId:'w',start:'2026-10-05',end:'2026-10-11'})`);
  assert.match(u.run('rendered'),/Menyiapkan PDF/);assert.equal(u.urls.length,0);
  u.run(`resolveRequest({base64:'${Buffer.from('%PDF-1.4\nfixture').toString('base64')}',nama:'slip "contoh".pdf'});`);await done;
  const ready=u.run('rendered');assert.match(ready,/href="blob:local-pdf" download="slip &quot;contoh&quot;\.pdf"/);assert.match(ready,/>Buka PDF<\/a>/);
  assert.equal(u.urls[0].type,'application/pdf');assert.deepEqual(u.revoked,[]);assert.equal(u.timers.size,0,'URL does not expire while user is reading');
  assert.deepEqual(u.events,['download'],'one automatic download attempt, without opening a delayed popup');
  u.run('sheets[0].opt.onClose()');assert.equal(u.timers.size,1);[...u.timers.values()][0].fn();assert.deepEqual(u.revoked,['blob:local-pdf']);
  assert.equal(u.json('requests')[0].action,'makeWeeklyPdf');
});
test('invalid or failed PDF response settles visibly and closing before a reply creates no leaked URL',async()=>{
  const u=ui();vm.runInContext(part('A.slipPdf =','A.slipDel ='),u.context);
  let done=u.run(`slipUnduh('makePdf',{})`);u.run(`resolveRequest({base64:'YWJj',nama:'wrong.pdf'});`);await done;
  assert.match(u.run('rendered'),/File PDF belum berhasil dibuat/);assert.equal(u.urls.length,0);
  done=u.run(`slipUnduh('makePdf',{})`);u.run('sheets[1].opt.onClose()');
  u.run(`resolveRequest({base64:'${Buffer.from('%PDF-1.4').toString('base64')}',nama:'slip.pdf'});`);await done;assert.equal(u.urls.length,0);
});
test('weekly UI delegates the same immutable model as server PDF, combines sizes, and keeps repairs in their earned week',()=>{
  const u=ui();vm.runInContext(part('function slipUpahMingguan(', 'function upahMingguView('),u.context);
  u.run(`S.state.po=[{id:'p',nama:'Kaos'}];S.state.payroll=[
    {id:'setor:s:M',sourceId:'s',poId:'p',pegawaiId:'w',jenis:'jahit',tanggal:'2026-10-05',total:30,rate:2000,ukuran:{M:30},paidQty:20,available:10,ref:'SS-1',issues:[]},
    {id:'setor:s:L',sourceId:'s',poId:'p',pegawaiId:'w',jenis:'jahit',tanggal:'2026-10-05',total:20,rate:2000,ukuran:{L:20},paidQty:20,available:0,ref:'SS-1',issues:[]},
    {id:'repair:r:M',sourceId:'s',qcId:'r',repairQcId:'q',poId:'p',pegawaiId:'w',jenis:'jahit',tanggal:'2026-10-12',total:4,rate:2000,ukuran:{M:4},paidQty:0,available:4,issues:[]},
    {id:'held',sourceId:'held',poId:'p',pegawaiId:'w',jenis:'jahit',tanggal:'2026-10-06',total:9,rate:2000,ukuran:{M:9},paidQty:0,available:0,needsReview:true,issues:['Periksa sumber']}
  ];S.state.payroll.push(S.state.payroll[0]);`);
  const value=u.json(`slipUpahMingguan({id:'w',nama:'Pekerja',divisi:'jahit'},'2026-10-05','2026-10-11')`);
  assert.equal(value.model.rows.length,1);assert.equal(value.totalQty,50);assert.equal(value.totalGross,100000);assert.equal(value.paidAmount,80000);assert.equal(value.unpaidAmount,20000);assert.equal(value.reviewCount,1);
  assert.match(value.model.sections[0].rows[0][3],/Periksa sumber/);
  assert.deepEqual(value,u.json(`coreWeeklySlipModel(S.state,{id:'w',nama:'Pekerja',divisi:'jahit'},'2026-10-05','2026-10-11')`));
  const next=u.json(`slipUpahMingguan({id:'w',nama:'Pekerja',divisi:'jahit'},'2026-10-12','2026-10-18')`);assert.equal(next.totalQty,4);assert.match(next.model.rows[0][1],/Perbaikan/);
});
test('QC copy requests redaction instead of fabricating a zero wage; owner copy preserves income context',()=>{
  const u=ui();
  vm.runInContext(part('function historyOriginalRecord(', 'function openSlip('),u.context);
  vm.runInContext(part('A.slipCopy =', 'A.slipPdf ='),u.context);
  u.run(`var copied='',captured=null,rec={id:'s',poId:'p',maklonId:'w',total:12,ukuran:{M:12},upah:7500,noSlip:'SS-001',status:'diterima'};
    D.po.p={id:'p',nama:'Kaos'};D.user.w={id:'w',nama:'Penjahit'};S.state.payroll=[{sourceId:'s',total:12,available:12,rate:7500}];
    var realSlipText=coreSlipText;coreSlipText=function(type,row,ctx){captured={type:type,row:row,ctx:ctx};return realSlipText(type,row,ctx);};
    function findSlip(){return rec;}function copyText(text){copied=text;}var trigger={getAttribute:function(k){return k==='data-t'?'setor':'s';}};
    S.state.me={id:'checker',divisi:'qc'};A.slipCopy(trigger);`);
  assert.equal(u.run('captured.ctx.hideMoney'),true);assert.equal(u.run('captured.ctx.payroll'),undefined);
  assert.equal(u.run('rec.upah'),7500,'redaction must not rewrite the original receipt');
  u.run("S.state.me={id:'owner',divisi:'owner'};A.slipCopy(trigger)");
  assert.equal(u.run('captured.ctx.hideMoney'),undefined);assert.equal(u.run('captured.ctx.payroll.length'),1);
});
test('sewing Slip opens weekly by default; both weekly pages and all single slips expose export actions',()=>{
  const u=ui();u.run(`function seg(){return '';}function slipMingguSaya(){return 'WEEKLY_PREVIEW';}`);
  vm.runInContext(part("VIEWS['j-slip'] =", "VIEWS['j-upah'] ="),u.context);
  assert.match(u.run(`VIEWS['j-slip']()`),/WEEKLY_PREVIEW/);
  assert.match(part('function slipSheet(', '/* owner mengatur harga'),/data-a="slipPrint"/);
  assert.match(part('function slipSheet(', '/* owner mengatur harga'),/Unduh PDF/);
  assert.match(part('function upahMingguView(', 'C.umOrang ='),/makeWeeklyPdf/);
  assert.match(part('function slipMingguSaya(', "VIEWS['p-upah'] ="),/makeWeeklyPdf/);
  assert.match(part('function gajiSlipView(', 'C.gajiSlip ='),/makeGajiPdf/);
});
