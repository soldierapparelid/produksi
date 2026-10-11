'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function part(start,end){const a=html.indexOf(start),b=html.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return html.slice(a,b);}
function ui(admin=false){
 const c=vm.createContext({console});vm.runInContext(fs.readFileSync(path.join(root,'src/core.js'),'utf8'),c);
 vm.runInContext(`var A={},R={},admin=${admin},rendered='',requests=[],messages=[],closed=0;
 var S={state:{settings:{ukuran:['L','XL','XXL','3XL']}}},D={po:{p1:{id:'p1',nama:'Polo <Contoh>',ukuran:{L:50,XL:60,XXL:80},workflow:{ukuran:{
 L:{maklon:{sewer1:{kirim:50,diterima:50,reject:0,diajukan:0}}},XL:{maklon:{sewer1:{kirim:60,diterima:58,reject:2,diajukan:0}}},XXL:{maklon:{sewer1:{kirim:80,diterima:0,reject:0,diajukan:72}}},'3XL':{maklon:{other:{kirim:90,diterima:0,reject:0,diajukan:90}}}}}}}};
 var rec={id:'pending01',revision:'original-revision',poId:'p1',maklonId:'sewer1',status:'diajukan',tanggal:'2026-10-10',ukuran:{L:0,XL:0,XXL:72},reject:0,rejectUkuran:{},upah:2100,catatan:'Bukti impor <asal> tetap utuh',asal:'lama',imporSumber:{baseline:true,field:'jahit'}};
 var form={values:{},sizes:[],rejects:[],lapor:null,getAttribute:function(k){return k==='data-lapor'?this.lapor:null;}},ringkas={hidden:true,textContent:'',className:''};
 function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}function decode(v){return String(v||'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');}
 function attribute(tag,key){var m=tag.match(new RegExp('(?:^|\\\\s)'+key+'="([^"]*)"'));return m?decode(m[1]):null;}
 function readInputs(){form.values={};form.sizes=[];form.rejects=[];var main=rendered.match(/<div[^>]*data-form="terima"[^>]*>/);form.lapor=main?attribute(main[0],'data-lapor'):null;rendered.replace(/<input\\b[^>]*>/g,function(tag){var name=attribute(tag,'name'),size=attribute(tag,'data-size'),reject=attribute(tag,'data-reject-size');if(name)form.values[name]=attribute(tag,'value')||'';if(size||reject){var input={value:attribute(tag,'value')||'',getAttribute:function(k){return attribute(tag,k);}};(size?form.sizes:form.rejects).push(input);}});var note=rendered.match(/<textarea name="catatan">([\\s\\S]*?)<\\/textarea>/);form.values.catatan=note?decode(note[1]):'';}
 function openSheet(fn){rendered=fn();readInputs();}function sheetHtml(t,b,f){return '<h2>'+esc(t)+'</h2>'+b+(f||'');}function emptyBox(s){return esc(s);}function findSlip(type,id){return id===rec.id?rec:null;}
 function workflowFor(p){return p.workflow||{ukuran:{}};}function poSizes(){return ['L','XL','XXL','3XL'];}function sizesSplit(){return {main:['L','XL','XXL'],extra:['3XL']};}function poHead(p){return '<b>'+esc(p.nama)+'</b>';}function namaUser(){return 'Mang <A>';}
 function hid(k,v){return '<input name="'+k+'" value="'+esc(v)+'">';}function fTanggal(l,k){return '<label>'+l+hid(k,'2026-10-11')+'</label>';}function fNum(l,k,v){return '<label>'+l+hid(k,v)+'</label>';}function fCatatan(v){return '<textarea name="catatan">'+esc(v)+'</textarea>';}function sumLine(t){return '<div>'+t+'<b data-sum>0</b></div>';}
 function nf(n){return String(n);}function tgl(d){return String(d||'');}function isAdmin(){return admin;}function categorySizes(r){return coreMap(r.rejectUkuran);}function hargaKiriman(){return 0;}function tarifBawaan(){return 0;}function todayYmd(){return '2026-10-11';}
 function $(s){return s==='[data-terima-ringkas]'?ringkas:null;}function $$(s,f){return s==='input[data-size]'?f.sizes:s==='[data-reject-size]'?f.rejects:[];}function topForm(){return form;}function formVals(f){return Object.assign({},f.values);}function act(el,p){return p;}function toast(s){messages.push(s);}function quiet(e){messages.push(e.message);}function dropForm(){closed++;}function confirmBox(opt,fn){S.confirm=fn;}
 function req(action,payload){return new Promise(function(resolve,reject){requests.push({action:action,payload:payload,resolve:resolve,reject:reject});});}
 function value(size,n,reject){var inputs=reject?form.rejects:form.sizes;inputs.find(function(el){return el.getAttribute(reject?'data-reject-size':'data-size')===size;}).value=String(n);}
 `,c);
 vm.runInContext(part('function sizeVals(root)', 'function recalc(form)'),c);
 vm.runInContext(part('function rejectGrid(po, values)', 'function setorGrid('),c);
 vm.runInContext(part('/* ---------- hitung & terima setoran ---------- */','/* ---------- QC ---------- */'),c);
 const run=s=>vm.runInContext(s,c);return {c,run,json:s=>JSON.parse(run('JSON.stringify('+s+')'))};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('only the positive reported size opens as an input; completed sizes are available separately without a wide table',()=>{
 const h=ui();h.run("openTerima('pending01')");const out=h.run('rendered'),main=out.slice(out.indexOf('<div data-terima-main>'),out.indexOf('<details class="rj-lipat" data-terima-extra>'));
 assert.match(main,/data-size="XXL" value="72"/);assert.match(main,/Laporan ini 72 pcs/);assert.doesNotMatch(main,/data-size="L"|data-size="XL"|data-size="3XL"/);assert.match(out,/<details class="rj-lipat" data-terima-extra><summary>Ukuran lain bila hitungan berbeda/);assert.match(out,/data-size="L" value=""/);assert.match(out,/data-size="XL" value=""/);assert.match(out,/aria-label="Pcs bagus ukuran XXL"/);assert.doesNotMatch(out,/<table|tbl-wrap/);
 assert.match(out,/Sudah dilaporkan selesai 72 dari 80 pcs/);assert.match(out,/Menunggu dihitung<\/dt><dd class="num">72 pcs/);assert.match(out,/Belum dilaporkan<\/dt><dd class="num">8 pcs/);assert.match(out,/Sisa penugasan belum dihitung<\/dt><dd class="b num">80 pcs/);assert.match(out,/<details class="rj-lipat" data-terima-posisi-lain>/);assert.equal((out.match(/>Hitungan selesai<\/span>/g)||[]).length,2);assert.doesNotMatch(out,/data-terima-posisi="3XL"/);assert.match(out,/Sudah dihitung belum berarti sudah lolos QC/);
});

test('source notes stay preserved and escaped in optional details; QC never sees owner rates',()=>{
 const h=ui();h.run("openTerima('pending01')");const out=h.run('rendered');assert.match(out,/<details class="rj-lipat"><summary>Catatan laporan \/ hitungan \(opsional\)<\/summary><textarea name="catatan">Bukti impor &lt;asal&gt; tetap utuh/);assert.doesNotMatch(out,/name="upah"/);assert.equal(h.run('form.values.catatan'),'Bukti impor <asal> tetap utuh');assert.match(out,/Mang &lt;A&gt;/);assert.match(out,/Belum terbit slip/);
 const owner=ui(true);owner.run("openTerima('pending01')");assert.equal(owner.run('form.values.upah'),'2100');assert.equal(owner.run('form.values.tanggal'),'2026-10-11');assert.equal(owner.run('form.values.revision'),'original-revision');
});

test('the 72 reported, 275 counted and 8 unreported pieces are visible above input while full progress starts collapsed',()=>{
 const h=ui();h.run("D.po.p1.workflow.ukuran.L.maklon.sewer1={kirim:150,diterima:150,reject:0,diajukan:0};D.po.p1.workflow.ukuran.XL.maklon.sewer1={kirim:125,diterima:123,reject:2,diajukan:0};openTerima('pending01')");
 const out=h.run('rendered'),summary=out.slice(out.indexOf('data-terima-summary'),out.indexOf('<div data-terima-main>'));
 assert.match(summary,/Laporan ini<\/span><b class="num">72 pcs/);assert.match(summary,/Sudah dihitung<\/span><b class="num">275 pcs/);assert.match(summary,/Belum dilaporkan<\/span><b class="num">8 pcs/);assert.ok(out.indexOf('data-terima-summary')<out.indexOf('data-size="XXL"'));
 assert.match(out,/<details class="rj-lipat" data-terima-progress><summary>Rincian progres jahit<\/summary>/);assert.doesNotMatch(out,/<details[^>]*data-terima-progress[^>]*\bopen/);assert.equal(h.run('form.values.revision'),'original-revision');assert.equal(h.run('requests.length'),0);
});

test('72 of an 80-piece assignment sends the actual report only and preserves the captured revision, date and source note',async()=>{
 const h=ui();h.run("openTerima('pending01');rec.revision='other-phone';A.terimaSave({})");const sent=h.json('requests[0].payload');assert.deepEqual(sent,{id:'pending01',expectedRevision:'original-revision',keputusan:'terima',ukuran:{XXL:72},reject:0,rejectUkuran:{},catatan:'Bukti impor <asal> tetap utuh',tanggal:'2026-10-11'});
 assert.equal(h.run('rec.ukuran.XXL'),72);h.run("requests[0].resolve({noSlip:'SS-001'})");await tick();assert.equal(h.run('closed'),1);assert.match(h.json('messages').join(' '),/SS-001/);assert.doesNotMatch(h.json('messages').join(' '),/Sisa 8 pcs tetap menunggu/,'8 is not part of this report and must not become its residual');
});

test('partial good plus real rejects leaves only this report remainder waiting, not the unreported assignment',async()=>{
 const h=ui();h.run("openTerima('pending01');value('XXL',60);value('XXL',2,true);R.terima(form)");assert.match(h.run('ringkas.textContent'),/laporan 72 · dihitung 60 · reject 2 · sisa menunggu 10/);h.run('A.terimaSave({})');assert.deepEqual(h.json('requests[0].payload.ukuran'),{XXL:60});assert.deepEqual(h.json('requests[0].payload.rejectUkuran'),{XXL:2});h.run("requests[0].resolve({noSlip:'SS-002'})");await tick();assert.match(h.json('messages').join(' '),/Sisa 10 pcs tetap menunggu/);assert.equal(h.run('rec.ukuran.XXL'),72);
});

test('fractional or oversized input and an unreported legacy size are rejected without writes',()=>{
 const h=ui();h.run("openTerima('pending01');value('XXL',72.5);A.terimaSave({})");assert.equal(h.run('requests.length'),0);assert.match(h.json('messages').at(-1),/pcs bulat/);
 h.run("value('XXL',72);value('XXL',1,true);R.terima(form);A.terimaSave({})");assert.equal(h.run('requests.length'),0);assert.equal(h.run('ringkas.className'),'note bad');assert.match(h.json('messages').at(-1),/lebih dari laporan 72/);
 h.run("value('XXL',0,true);value('L',1);A.terimaSave({})");assert.equal(h.run('requests.length'),0);assert.match(h.json('messages').at(-1),/Hitungan L/);
});

test('native report corrections and already processed report behavior remain unchanged',()=>{
 const h=ui();h.run("rec.asal='';rec.imporSumber={};openTerima('pending01');value('XXL',60);value('L',1);A.terimaSave({})");assert.deepEqual(h.json('requests[0].payload.ukuran'),{XXL:60,L:1});assert.doesNotMatch(h.run('rendered'),/data-lapor=/);assert.match(h.run('rendered'),/Angka sudah diisi sesuai laporan maklon/);
 h.run("rec.status='diterima';openTerima('pending01')");assert.match(h.run('rendered'),/sudah diproses/);assert.doesNotMatch(h.run('rendered'),/data-form="terima"|data-size=/);
});
