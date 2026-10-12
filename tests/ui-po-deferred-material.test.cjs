'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Reuse the real preparation form harness, without registering its test cases.
const fixture=fs.readFileSync(path.join(__dirname,'ui-po-roll-preparation.test.cjs'),'utf8');
const ui=new Function('require','__dirname',fixture.slice(0,fixture.indexOf('\ntest('))+'\nreturn ui;')(require,__dirname);
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
function deferred(){const h=ui();h.run("form.values.materialTiming='later';form.choices=[];form.legacy=[];form.activeSizes=['M','XL'];");return h;}
function stored(intent,patch={}){return Object.assign({id:intent.po.newId,dibuatOleh:'owner',produkId:'product',jenis:'stok',nama:'KAOS',series:'SERI',pelanggan:'',deadline:'',bahan:'',catatan:'Catatan',status:'aktif',ukuran:{},ukuranAktif:['M','XL'],total:0,noPO:'PO-2610-001',gambar:''},patch);}
function state(po){return {me:{id:'owner'},po:po?[po]:[],rencanaPotong:[]};}

test('new PO defaults to materials later and toggling now preserves the selected stock inputs',()=>{
 const h=deferred();h.run("openPO('','product')");assert.match(h.run('rendered'),/value="later" selected[^>]*>Siapkan bahan nanti/);assert.match(h.run('rendered'),/data-po-material-now hidden/);
 h.run("var choiceTiming=element();choiceTiming.value='now';form.meta['[data-po-material-now]']={hidden:true};form.meta['[data-po-material-later]']={hidden:false};function recalc(){};form.choices=[choice('rollA',3)];C.poMaterialTiming(choiceTiming)");
 assert.equal(h.run("form.meta['[data-po-material-now]'].hidden"),false);assert.equal(h.run("form.meta['[data-po-material-later]'].hidden"),true);
 h.run("choiceTiming.value='later';C.poMaterialTiming(choiceTiming)");assert.equal(h.run("form.meta['[data-po-material-now]'].hidden"),true);assert.equal(h.run('form.choices[0].input.value'),'3');
 h.run("form._poPreparedFrozen=true;choiceTiming.value='now';C.poMaterialTiming(choiceTiming)");assert.equal(h.run("form.meta['[data-po-material-now]'].hidden"),true);
});

test('deferred PO saves selected sizes without stock, reservations or target pcs and duplicate tap sends once',async()=>{
 const h=deferred();h.run('stock=[];rolls=[];S.state.stokRol=[];');const done=h.run('A.poSave(button)');h.run('A.poSave(button)');await Promise.resolve();
 assert.equal(h.run('requests.length'),1);assert.equal(h.run('requests[0].action'),'savePO');const payload=h.json('requests[0].payload');assert.equal(payload.deferMaterial,true);assert.equal(payload.rencana,undefined);assert.deepEqual(payload.po.ukuranAktif,['M','XL']);assert.deepEqual(payload.po.ukuran,{});assert.equal(payload.po.total,undefined);
 h.resolve(0,stored(payload));await done;assert.equal(h.run('closed'),1);assert.match(h.run('messages[messages.length-1]'),/Bahan dapat disiapkan nanti/);assert.doesNotMatch(h.run('messages[messages.length-1]'),/siap.*mencatat/);
});

test('deferred creation still requires active sizes and owner, while prepare-now still requires actual materials',()=>{
 const h=deferred();h.run('form.activeSizes=[];A.poSave(button)');assert.equal(h.run('requests.length'),0);assert.match(h.run('messages[messages.length-1]'),/ukuran aktif/);
 h.run("form.activeSizes=['M'];actor.divisi='admin';A.poSave(button)");assert.equal(h.run('requests.length'),0);assert.match(h.run('messages[messages.length-1]'),/owner/);
 h.run("actor.divisi='owner';form.values.materialTiming='now';A.poSave(button)");assert.equal(h.run('requests.length'),0);assert.match(h.run('messages[messages.length-1]'),/rol|bahan/i);
});

test('uncertain deferred save checks only state, then retries the entire frozen intent including flag and image',async()=>{
 const h=deferred();h.run("form._poImage={touched:true,data:'data:image/jpeg;base64,design'}");const done=h.run('A.poSave(button)');await Promise.resolve();const original=h.json('requests[0].payload');h.reject(0);await done;
 h.run("form.values.nama='Changed';form.values.materialTiming='now';form.activeSizes=['S'];A.poSave(button);A.poPreparedRetry(retry)");assert.equal(h.run('requests.length'),1);
 const checking=h.run('A.poPreparedCheck(check)');assert.equal(h.run('requests[1].action'),'getState');h.resolve(1,state());await checking;assert.equal(h.run('form._poPreparedRetryAllowed'),true);
 const retry=h.run('A.poPreparedRetry(retry)');await Promise.resolve();assert.equal(h.run('requests[2].action'),'savePO');assert.deepEqual(h.json('requests[2].payload'),original);h.resolve(2,stored(original,{gambar:'saved'}));await retry;assert.equal(h.run('closed'),1);
});

test('a deferred PO already committed is recognized from matching owner and normalized fields without another write',async()=>{
 const h=deferred(),done=h.run('A.poSave(button)');await Promise.resolve();const payload=h.json('requests[0].payload');h.reject(0);await done;
 const check=h.run('A.poPreparedCheck(check)');h.resolve(1,state(stored(payload)));await check;assert.equal(h.run('closed'),1);assert.equal(h.run('requests.length'),2);assert.equal(h.run('form._poPreparedRetryAllowed'),false);
});

test('partial image failure resumes the same deferred PO and stale, foreign or changed records cannot be confirmed',async()=>{
 const h=deferred();h.run("form._poImage={touched:true,data:'data:image/jpeg;base64,design'}");const done=h.run('A.poSave(button)');await Promise.resolve();const payload=h.json('requests[0].payload');h.reject(0);await done;
 const check=h.run('A.poPreparedCheck(check)');h.resolve(1,state(stored(payload)));await check;assert.equal(h.run('closed'),0);assert.equal(h.run('form._poPreparedRetryAllowed'),true);assert.match(h.run("form.meta['[data-po-prepared-notice]'].innerHTML"),/desain belum terlihat/);
 const retry=h.run('A.poPreparedRetry(retry)');await Promise.resolve();assert.deepEqual(h.json('requests[2].payload'),payload);h.resolve(2,stored(payload,{gambar:'saved'}));await retry;assert.equal(h.run('closed'),1);
 for(const patch of [{nama:'OTHER'},{dibuatOleh:'other'},{ukuranAktif:['M']},{status:'batal'}]){
  const x=deferred(),saving=x.run('A.poSave(button)');await Promise.resolve();const intent=x.json('requests[0].payload');x.reject(0);await saving;const checking=x.run('A.poPreparedCheck(check)');x.resolve(1,state(stored(intent,patch)));await checking;assert.equal(x.run('closed'),0);assert.equal(x.run('form._poPreparedRetryAllowed'),false);x.run('A.poPreparedRetry(retry)');assert.equal(x.run('requests.length'),2);
 }
});

test('changing account after a read check cannot replay the previous owner draft',async()=>{
 const h=deferred(),done=h.run('A.poSave(button)');await Promise.resolve();h.reject(0);await done;const check=h.run('A.poPreparedCheck(check)');h.resolve(1,state());await check;
 h.run("actor.id='other';A.poPreparedRetry(retry)");assert.equal(h.run('requests.length'),2);assert.match(h.run('messages[messages.length-1]'),/Akun sudah berubah/);
});

test('deferred PO appears as waiting on card and cutter queue; only an actual ready plan enables cutter input',()=>{
 const h=deferred();vm.runInContext(part('function poUkuranAktif(po)','/* sisa di satu maklon'),h.c);
 h.run("var VIEWS={};function T(po){return po.agg||{potong:0};}function poTahap(){return {k:'potong'};}function poWarna(){return 'potong';}var PO_PITA={potong:'Belum potong'};function poMeta(p){return esc(p.noPO||'');}function poStatusChips(){return '';}function stagesHtml(){return '';}function cocok(){return true;}function miniKpi(){return '';}function seg(){return '';}function searchBox(){return '';}function catatanDipangkas(){return '';}function sizeChips(){return '';}var po={id:'newpo001',nama:'BARU <aman>',status:'aktif',jenis:'stok',ukuran:{},ukuranAktif:['M','XL'],agg:{potong:0},cutting:{verified:true,ukuran:['M','XL'],pendingUkuran:['M','XL']}};S.state.po=[po];D.po[po.id]=po;S.state.potong=[];S.sub.pkerja='perlu';");
 assert.match(h.run('poCard(po)'),/Menunggu bahan/);assert.match(h.run('poCard(po)'),/BARU &lt;aman>/);assert.match(part('function poSheet(id)','A.lepasUkuran'),/poMenungguBahan\(po\).*Menunggu bahan potong/);
 vm.runInContext(part("VIEWS['p-kerja'] =", "VIEWS['p-riwayat'] ="),h.c);h.run("actor.divisi='potong'");let shown=h.run("VIEWS['p-kerja']()");assert.match(shown,/Menunggu bahan dari owner/);assert.doesNotMatch(shown,/data-a="potongOpen"/);assert.match(shown,/M · XL/);
 h.run("S.state.rencanaPotong=[{id:'plan001',poId:'newpo001',status:'siap',bahanList:[{nama:'Katun',qty:2,satuan:'kg'}],rol:1}]");assert.equal(h.run('poMenungguBahan(po)'),false);shown=h.run("VIEWS['p-kerja']()");assert.match(shown,/Bahan siap dipotong/);assert.match(shown,/data-a="potongOpen"[^>]*data-rencana="plan001"/);assert.doesNotMatch(h.run('poCard(po)'),/Menunggu bahan/);
 h.run("S.state.rencanaPotong[0].status='batal'");assert.equal(h.run('poMenungguBahan(po)'),true);h.run("po.status='selesai'");assert.equal(h.run('poMenungguBahan(po)'),false);
});
