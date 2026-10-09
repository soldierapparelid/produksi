'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
function fixture(opt){opt=opt||{};const c=vm.createContext({console});vm.runInContext(fs.readFileSync(path.join(root,'src/core.js'),'utf8'),c);vm.runInContext(`
var A={},S={state:{settings:{ukuran:['M','L','XL']}}},D={po:{po1:{id:'po1',nama:'Polo',status:'aktif',ukuran:{}}}},rendered='',requests=[],messages=[],closed=0,admin=${opt.admin?'true':'false'};
var lama={id:'pending1',noSlip:'',poId:'po1',maklonId:'maklon1',tanggal:'2026-10-07',ukuran:{M:332},total:332,reject:0,rejectUkuran:{},upah:0,status:'diajukan',asal:'lama',catatan:'Sisa laporan jahit belum dihitung',imporSumber:JSON.stringify({baseline:true,skuId:'sku1',siklus:'current',field:'jahit',entryId:''})};
var baru={id:'native01',noSlip:'',poId:'po1',maklonId:'maklon1',tanggal:'2026-10-08',ukuran:{M:100},total:100,reject:0,rejectUkuran:{},upah:0,status:'diajukan',asal:'',imporSumber:''};
var slips={pending1:lama,native01:baru},form={values:{id:'pending1',tanggal:'2026-10-09',upah:'',catatan:''},sizes:{M:106},rejects:{}},button={};
function findSlip(t,id){return slips[id]||null;}function topForm(){return form;}function formVals(f){return f.values;}function sizeVals(f){return f.sizes;}function rejectValues(f){return f.rejects;}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}function nf(n){return String(n||0);}function tgl(s){return s;}function namaUser(){return 'Mang Atep';}function todayYmd(){return '2026-10-09';}
function openSheet(render){rendered=render();}function sheetHtml(t,b,f){return t+b+(f||'');}function emptyBox(t){return t;}function poHead(p){return esc(p.nama);}function sizesSplit(){return {main:['M','L','XL'],extra:[]};}
function hid(k,v){return '<input name="'+k+'" value="'+esc(v)+'">';}function fNum(l,n){return '<input data-f="'+n+'">';}function fTanggal(l,n){return '<label>'+l+'<input type="date" name="'+n+'" value="'+todayYmd()+'"></label>';}function fCatatan(){return '';}function sumLine(t){return t;}
function rejectGrid(){return '<div>Reject</div>';}function categorySizes(){return {};}function isAdmin(){return admin;}function hargaKiriman(){return 0;}function tarifBawaan(){return 0;}
function toast(t){messages.push(t);}function quiet(e){messages.push(e.message);}function dropForm(){closed++;}function act(el,p){return p;}function req(action,payload){return new Promise(function(resolve,reject){requests.push({action:action,payload:payload,resolve:resolve,reject:reject});});}
`,c);vm.runInContext(part('function sizeGrid(sizes, o)','A.fillMax ='),c);vm.runInContext(part('/* ---------- hitung & terima setoran ---------- */','A.terimaTolak ='),c);return {c,run:s=>vm.runInContext(s,c)};}
const plain=v=>JSON.parse(JSON.stringify(v));

test('the count form has a count date for QC and tells how to count an old report in stages',()=>{
  const f=fixture();f.run("openTerima('pending1')");const out=f.c.rendered;
  assert.match(out,/Tanggal hitung<input type="date" name="tanggal" value="2026-10-09"/);
  assert.match(out,/isi yang sudah Anda hitung saja: sisanya tetap menunggu di daftar ini/);
  assert.match(out,/jangan dimasukkan ke Reject/);
  assert.doesNotMatch(out,/data-f="upah"/,'QC does not see the price');
  f.run("openTerima('native01')");
  assert.match(f.c.rendered,/Angka sudah diisi sesuai laporan maklon/);assert.match(f.c.rendered,/name="tanggal"/);
  const o=fixture({admin:true});o.run("openTerima('pending1')");assert.match(o.c.rendered,/name="tanggal"/);assert.match(o.c.rendered,/data-f="upah"/);
});

test('a partial count of an old report is sent with its date and the message says how much keeps waiting',async()=>{
  const f=fixture();const p=f.run('A.terimaSave(button)');
  assert.equal(f.c.requests.length,1);
  assert.deepEqual(plain(f.c.requests[0].payload),{id:'pending1',keputusan:'terima',ukuran:{M:106},reject:0,rejectUkuran:{},upah:'',catatan:'',tanggal:'2026-10-09'});
  f.c.requests[0].resolve({noSlip:'SS-2610-001'});await p;
  assert.equal(f.c.closed,1);assert.match(f.c.messages.join(' '),/Slip SS-2610-001 terbit\. Sisa 226 pcs tetap menunggu hitungan berikutnya\./);
});

test('counting everything, or good plus real rejects, leaves nothing waiting',async()=>{
  const f=fixture();f.run("form.sizes={M:320};form.rejects={M:12}");const p=f.run('A.terimaSave(button)');
  assert.equal(f.c.requests[0].payload.reject,12);f.c.requests[0].resolve({noSlip:'SS-2610-002'});await p;
  assert.match(f.c.messages.join(' '),/Slip SS-2610-002 terbit\. QC dibuka setelah hitungan ukuran lengkap\./);
});

test('more than the old report, a missing date or a future date is stopped on the device',()=>{
  const f=fixture();f.run("form.sizes={M:332};form.rejects={M:226};A.terimaSave(button)");
  assert.equal(f.c.requests.length,0);assert.match(f.c.messages.join(' '),/Hitungan M melebihi laporan lama \(332 pcs\)/);
  f.run("form.sizes={M:10};form.rejects={};form.values.tanggal='';A.terimaSave(button)");assert.match(f.c.messages.join(' '),/Isi tanggal hitungnya/);
  f.run("form.values.tanggal='2026-10-10';A.terimaSave(button)");assert.match(f.c.messages.join(' '),/tidak boleh melewati hari ini/);
  assert.equal(f.c.requests.length,0);
});

test('a new report from a sewer is counted as before, only with the count date added',async()=>{
  const f=fixture();f.run("form.values.id='native01';form.sizes={M:60};form.values.tanggal='2026-10-08'");const p=f.run('A.terimaSave(button)');
  assert.deepEqual(plain(f.c.requests[0].payload.ukuran),{M:60});assert.equal(f.c.requests[0].payload.tanggal,'2026-10-08');
  f.c.requests[0].resolve({noSlip:'SS-2610-003'});await p;
  assert.match(f.c.messages.join(' '),/Slip SS-2610-003 terbit\. QC dibuka setelah hitungan ukuran lengkap\./);
});
