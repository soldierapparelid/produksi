'use strict';
/* Rakitan 1541g: PO bawaan aplikasi lama yang belum dipotong disatukan ke PO buatan aplikasi ini (ukurannya di sana bisa
   ditambah), lalu PO lama dibatalkan. Semua data di sini buatan. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
function ui(){
  const c=vm.createContext({console,Promise});
  vm.runInContext(fs.readFileSync(path.join(root,'src/core.js'),'utf8'),c);
  vm.runInContext(`
    var A={},messages=[],calls=[],konfirm=null,konfirmFn=null,ditutup=0,dirender=0,sheet='',plans=[];
    var lama={id:'lama1',noPO:'PO-1',nama:'Polo Uji Hitam',series:'UJI',produkId:'p1',jenis:'stok',status:'aktif',asal:'lama',ukuran:{M:10,L:10,XXL:5},total:25,revision:'rev-lama',dibuat:'2026-10-01',cutting:{pendingUkuran:['M','L','XXL']}};
    var baru={id:'baru1',noPO:'PO-9',nama:'Polo Uji Hitam',series:'UJI',produkId:'p1',jenis:'stok',status:'aktif',ukuranAktif:'["XL"]',ukuran:{},revision:'rev-baru',dibuat:'2026-10-12',cutting:{pendingUkuran:['XL']}};
    var S={state:{po:[lama]},tab:''},D={po:{lama1:lama}};
    function T(po){return po._t||{};}function rencanaPotongBlocked(po){return po._blok||'';}function rencanaPotongRows(id){return plans.filter(function(r){return r.poId===id;});}
    function poAktif(){return S.state.po.filter(function(p){return p.status==='aktif';});}function poUkuranPotong(po){return po.status==='aktif'&&po.cutting&&po.cutting.pendingUkuran||[];}
    function esc(s){return String(s===undefined?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}
    function toast(s,e){messages.push([s,!!e]);}function confirmBox(o,fn){konfirm=o;konfirmFn=fn;}
    function act(btn,p){return Promise.resolve(p).then(function(v){return v;},function(e){messages.push([e.message,true]);throw e;});}
    function req(action,payload){return new Promise(function(resolve,reject){calls.push({action:action,payload:payload,resolve:resolve,reject:reject});});}
    function newId(){return 'po-baru';}function closeAll(){ditutup++;}function render(){dirender++;}function openSheet(fn){sheet=fn();}function poSheet(id){return 'lembar '+id;}
  `,c);
  vm.runInContext(part('/* ---------- satukan PO lama ---------- */','/* ---------- akhir satukan PO lama ---------- */'),c);
  return c;
}
function run(c,s){return vm.runInContext(s,c);}
function plain(x){return JSON.parse(JSON.stringify(x));}
const tunggu=()=>new Promise(r=>setTimeout(r,10));
const el="{getAttribute:function(a){return a==='data-id'?'lama1':null;}}";

test('only an old-app stock PO with nothing recorded on it can be moved; a PO made in this app that is not cut yet is the place to join',()=>{
  const c=ui();assert.deepEqual(plain(run(c,'poLamaPindah(lama)')),{ke:null,ukuran:['M','L','XXL']});
  run(c,"S.state.po.push(baru);D.po.baru1=baru");assert.equal(run(c,'poLamaPindah(lama).ke.id'),'baru1');assert.equal(run(c,'poLamaPindah(baru)'),null,'a PO of this app edits its own sizes');
  for(const [ubah,alasan] of [["baru._t={potong:5}",'already cut'],["baru.jenis='pesanan'",'a customer order'],["baru.status='batal'",'cancelled'],["baru.produkId='p2'",'another item'],["baru.asal='lama'",'old-app too']]){const d=ui();run(d,"S.state.po.push(baru);D.po.baru1=baru;"+ubah);assert.equal(run(d,'poLamaPindah(lama).ke'),null,alasan);}
  for(const [ubah,alasan] of [["lama._t={potong:1}",'cut'],["lama._t={kirim:1}",'assigned'],["lama._t={qcOk:1}",'checked'],["lama.status='selesai'",'finished'],["lama.jenis='pesanan'",'customer order'],["lama.cutting.pendingUkuran=[]",'nothing waiting'],["lama._blok='periksa'",'under review'],["lama.cutting.reviewPlans=[{}]",'old fabric allotment'],["plans=[{poId:'lama1',status:'siap'}]",'fabric prepared']]){const d=ui();run(d,ubah);assert.equal(run(d,'poLamaPindah(lama)'),null,alasan);}
  const d=ui();run(d,"plans=[{poId:'lama1',status:'batal'}]");assert.ok(run(d,'poLamaPindah(lama)'),'a cancelled preparation does not block');
  /* the edit form of the old PO says so and offers the button */
  assert.match(run(c,'poLamaPindahHtml(lama)'),/Ukuran PO bawaan aplikasi lama terkunci\. Barang ini juga punya PO-9 yang belum dipotong[\s\S]*data-a="poSatukan" data-id="lama1">Satukan dengan PO-9<\/button>/);
  const s=ui();assert.match(run(s,'poLamaPindahHtml(lama)'),/Pindahkan ukuran M · L · XXL ke PO baru[\s\S]*data-a="poSatukan" data-id="lama1">Pindahkan ke PO baru<\/button>/);assert.equal(run(s,"lama._t={potong:1};poLamaPindahHtml(lama)"),'');
  assert.match(html,/pemeriksaan riwayat\.<\/div>' \+ \(typeof poLamaPindahHtml === 'function' \? poLamaPindahHtml\(po\) : ''\) :/,'shown under the note of an old-app PO in Ubah PO');
});
test('joining adds the waiting sizes to the newer PO first and cancels the old PO after that',async()=>{
  const c=ui();run(c,"S.state.po.push(baru);D.po.baru1=baru;A.poSatukan("+el+")");
  assert.equal(c.konfirm.title,'Satukan dengan PO-9?');assert.match(c.konfirm.text,/Ukuran M · L · XXL dari PO-1 masuk ke PO-9\. Lalu PO-1 dibatalkan/);assert.equal(c.konfirm.ok,'Satukan');assert.equal(c.calls.length,0,'nothing is sent before the owner agrees');
  const selesai=run(c,'konfirmFn({})');
  assert.deepEqual(plain(c.calls[0]),{action:'savePO',payload:{expectedRevision:'rev-baru',po:{id:'baru1',produkId:'p1',jenis:'stok',nama:'Polo Uji Hitam',series:'UJI',pelanggan:'',deadline:'',ukuran:{},bahan:'',catatan:'',noPO:'PO-9',status:'aktif',ukuranAktif:['XL','M','L','XXL']}}});
  assert.equal(c.calls.length,1,'the old PO is not touched until the sizes are safe');
  c.calls[0].resolve({id:'baru1',noPO:'PO-9'});await tunggu();
  assert.deepEqual(plain(c.calls[1]),{action:'savePO',payload:{expectedRevision:'rev-lama',po:{id:'lama1',produkId:'p1',jenis:'stok',nama:'Polo Uji Hitam',series:'UJI',pelanggan:'',deadline:'',ukuran:{M:10,L:10,XXL:5},bahan:'',catatan:'',noPO:'PO-1',status:'batal'}}},'the old row is only cancelled: no sizes are sent for it');
  c.calls[1].resolve({id:'lama1'});await selesai;
  assert.deepEqual(plain(c.messages.slice(-1)),[['PO-1 disatukan ke PO-9.',false]]);assert.equal(c.ditutup,1);assert.equal(c.sheet,'lembar baru1');assert.equal(run(c,'S.tab'),'po');
});
test('without a newer PO the sizes move to a new PO of this app, together with sizes asked for from the stock screen',async()=>{
  const c=ui();run(c,"A.poSatukan({getAttribute:function(a){return a==='data-id'?'lama1':a==='data-tambah'?'XL,M':null;}})");
  assert.equal(c.konfirm.title,'Pindahkan ke PO baru?');assert.match(c.konfirm.text,/masuk ke PO baru, bersama ukuran XL\./);
  const selesai=run(c,'konfirmFn({})');
  assert.deepEqual(plain(c.calls[0]),{action:'savePO',payload:{deferMaterial:true,po:{newId:'po-baru',produkId:'p1',jenis:'stok',nama:'Polo Uji Hitam',series:'UJI',pelanggan:'',deadline:'',ukuran:{},bahan:'',catatan:'',noPO:'',status:'aktif',ukuranAktif:['M','L','XXL','XL']}}});
  run(c,"D.po['po-baru']={id:'po-baru',noPO:'PO-10'}");c.calls[0].resolve({id:'po-baru',noPO:'PO-10'});await tunggu();
  assert.equal(c.calls[1].payload.po.status,'batal');assert.equal(c.calls[1].payload.po.id,'lama1');c.calls[1].resolve({});await selesai;
  assert.deepEqual(plain(c.messages.slice(-1)),[['PO-1 disatukan ke PO-10.',false]]);assert.equal(c.sheet,'lembar po-baru');
});
test('a failure is said plainly: nothing is cancelled when the sizes were not saved, and a failed cancel names what is left to do',async()=>{
  const c=ui();run(c,"A.poSatukan("+el+")");let p=run(c,'konfirmFn({})');c.calls[0].reject(new Error('Hanya owner yang boleh membuat PO sebelum menyiapkan bahan.'));await assert.rejects(p,/Hanya owner/);
  assert.equal(c.calls.length,1,'the old PO stays as it was');assert.equal(c.ditutup,0);
  const d=ui();run(d,"A.poSatukan("+el+")");p=run(d,'konfirmFn({})');d.calls[0].resolve({id:'po-baru',noPO:'PO-10'});await tunggu();d.calls[1].reject(new Error('Data berubah sejak formulir dibuka.'));
  await assert.rejects(p,/Ukuran sudah masuk PO-10, tetapi PO-1 belum terbatalkan \(Data berubah sejak formulir dibuka\.\)\. Batalkan PO-1 lewat Ubah\./);assert.equal(d.ditutup,0);
  /* a PO that changed meanwhile is refused before anything is sent */
  const e=ui();run(e,"lama._t={potong:3};A.poSatukan("+el+")");assert.equal(e.konfirm,null);assert.equal(e.messages.slice(-1)[0][1],true);
});
