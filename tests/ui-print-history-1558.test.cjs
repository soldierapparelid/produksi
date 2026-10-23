'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function part(a, b) {
  const start = html.indexOf(a), end = html.indexOf(b, start + a.length);
  assert.ok(start >= 0 && end > start, a);
  return html.slice(start, end);
}
function node(tag) {
  return { tag, style: {}, attributes: {}, children: [], parentNode: null, disabled: false, textContent: '',
    setAttribute(key, value) { this.attributes[key] = value; },
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    removeChild(child) { this.children = this.children.filter(row => row !== child); child.parentNode = null; }
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function ui(saved = []) {
  const events = [], timers = new Map(); let serial = 0, autoLoad = true;
  const document = { body: node('body'), createElement(tag) {
    const el = node(tag);
    if (tag === 'iframe') {
      el.contentDocument = { images: [], querySelector() { return {}; }, querySelectorAll() { return []; } };
      el.contentWindow = { focus() {}, print() { events.push('native-print'); } };
      Object.defineProperty(el, 'srcdoc', { get() { return this.html; }, set(value) { this.html = value; if (autoLoad) queueMicrotask(() => el.onload()); } });
    }
    return el;
  } };
  const context = vm.createContext({ console, Promise, Date, document, window: {},
    setTimeout(fn, ms) { const id = ++serial; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core.js'), 'utf8'), context);
  vm.runInContext(`
    var A={},C={},D={produk:{}},S={token:'owner-session-1',img:{},state:{me:{id:'owner'},po:[],settings:{ukuran:['M','L','XL','XXL']}}},rencana=[],slipPreviews=[],requests=[],persisted=${JSON.stringify(saved)},nextId=0,lostNext=false,failedNext=false,lembar=null,paints=0,messages=[];
    var holdHistory=false,historyPending=[],failHistory=false,imageData={'po-first':'data:image/png;base64,AAAA'},failImages=false,holdImages=false,imagePending=[];
    function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
    function openSheet(fn,opt){lembar={render:fn,opt:opt};}function paintTop(){paints++;}
    function sheetHtml(t,b,f){return '<h2>'+esc(t)+'</h2>'+b+'<footer>'+(f||'')+'</footer>';}
    function emptyBox(s){return '<p>'+esc(s)+'</p>';}function thumb(p,cls){var ref=gambarRef(p);return '<span class="thumb '+esc(cls||'')+'"'+(ref?' data-img="'+esc(ref.id)+'" data-ver="'+esc(ref.ver)+'"':'')+'>'+esc(inisial(p.nama))+'</span>';}function ic(){return '';}
    function nf(n){return String(n||0);}function nfQty(n){return String(n).replace('.',',');}function satuanPendek(u){return u==='yard'?'yd':u==='meter'?'m':'kg';}
    function tgl(s){return String(s);}function inisial(s){return String(s||'?').charAt(0);}function gambarRef(p){if(p&&p.gambar)return {id:p.id,ver:p.gambar};var pr=p&&D.produk[p.produkId];return pr&&pr.gambar?{id:pr.id,ver:pr.gambar}:null;}
    function poUkuranPotong(p){return p._potong||[];}function T(p){return p.agg||{};}function poSeri(p){return p.series||'';}
    function rencanaPotongRows(id){return rencana.filter(function(r){return r.poId===id;});}function rencanaPotongById(id){return rencana.find(function(r){return r.id===id;});}function rencanaPotongBlocked(){return '';}
    function poHarusDipotong(){return S.state.po.slice();}function poDaftar(){return {rows:S.state.po};}function toast(m,e){messages.push([m,!!e]);}function act(el,p){return p;}function quiet(e){messages.push([e.message,true]);}
    function newId(){return 'ui-print-batch-'+(++nextId);}
    function req(action,payload){
      var frozen=JSON.parse(JSON.stringify(payload||{}));requests.push({action:action,payload:frozen});
      if(action==='getPrintHistory'){
        var result={rows:JSON.parse(JSON.stringify(persisted))};
        if(failHistory){failHistory=false;return Promise.reject(new Error('Riwayat sementara tidak tersambung'));}
        if(holdHistory)return new Promise(function(resolve,reject){historyPending.push({resolve:function(){resolve(result);},reject:reject});});
        return Promise.resolve(result);
      }
      if(action==='getGambar'){
        if(failImages){failImages=false;return Promise.reject(new Error('Foto belum dapat dimuat'));}
        var gambar={};frozen.ids.forEach(function(id){if(imageData[id])gambar[id]=imageData[id];});
        if(holdImages)return new Promise(function(resolve){imagePending.push(function(){resolve({gambar:gambar});});});
        return Promise.resolve({gambar:gambar});
      }
      if(action!=='savePrintHistory')return Promise.reject(new Error('Unexpected request '+action));
      if(failedNext){failedNext=false;return Promise.reject(new Error('Bahan berubah sejak pratinjau dibuka'));}
      var rows=frozen.entries.map(function(e,i){var id=frozen.id+'_'+String(i).padStart(3,'0'),old=persisted.find(function(r){return r.id===id;});if(old)return old;
        var row={id:id,poId:e.poId,jenis:frozen.jenis,signature:e.signature,snapshot:e.snapshot,dibuat:'2026-10-22T03:00:00.000Z',dibuatOleh:'owner'};persisted.push(row);return row;});
      if(lostNext){lostNext=false;return Promise.reject(new Error('Koneksi putus setelah menyimpan'));}
      return Promise.resolve({rows:JSON.parse(JSON.stringify(rows))});
    }
  `, context);
  vm.runInContext(part('/* ---------- cetak daftar potong ---------- */', '/* ---------- akhir cetak daftar potong ---------- */'), context);
  const run = code => vm.runInContext(code, context);
  const json = code => JSON.parse(run('JSON.stringify(' + code + ')'));
  run(`S.state.po=[
    {id:'po-first',noPO:'PO-CONTOH-1',nama:'KEMEJA CONTOH',series:'CONTOH',status:'aktif',ukuran:{XL:50},ukuranAktif:['XL'],_potong:['XL'],gambar:'v1',workflow:{internal:'unrelated'},agg:{potong:0}},
    {id:'po-second',noPO:'PO-CONTOH-2',nama:'PO LAIN',series:'LAIN',status:'aktif',ukuran:{M:20},ukuranAktif:['M'],_potong:['M']}
  ];rencana=[{id:'plan-first',poId:'po-first',revision:'r1',status:'siap',rol:1,bahanList:[{nama:'Kain CONTOH',qty:100,satuan:'yard'}],rincianRol:[{bahan:'Kain CONTOH',qty:100,satuan:'yard',ukuran:'XL'}],catatan:'Potong sesuai ukuran',poDraft:{unnecessary:true}}];
  S.img['po-first']={ver:'v1',data:'data:image/png;base64,AAAA'};
  S.state.po.forEach(function(p){p.printSignature=printWorkSignature(p,rencana);});`);
  function overlay() { return document.body.children.at(-1); }
  function button(text) { return overlay().children[0].children.find(el => el.tag === 'button' && el.textContent.includes(text)); }
  function printedHtml() { return overlay().children.find(el => el.tag === 'iframe').srcdoc; }
  return { run, json, context, document, events, timers, overlay, button, printedHtml, setAutoLoad(value) { autoLoad = value; } };
}

test('opening, native printing, canceling and closing previews never save print history', async () => {
  const u = ui();
  await u.run('A.potongCetak(null)');
  assert.deepEqual(u.json('requests.map(function(r){return r.action;})'), ['getPrintHistory']);
  await u.run('A.potongCetakJalan(null)');
  assert.equal(u.events.filter(event => event === 'native-print').length, 1);
  assert.equal(u.json('persisted').length, 0);
  assert.equal(u.json('requests.filter(function(r){return r.action==="savePrintHistory";})').length, 0);
  u.button('Tutup pratinjau').onclick();
  assert.equal(u.document.body.children.length, 0);
  assert.equal(u.run('potongCetakDaftar().length'), 2);
  u.setAutoLoad(false);
  const pending = u.run('A.potongKartuJalan(null)');
  await flush();
  const delayedFrame = u.overlay().children.find(el => el.tag === 'iframe');
  u.button('Tutup pratinjau').onclick();
  delayedFrame.onload();
  await pending; await flush();
  assert.equal(u.run('persisted.length'), 0);
  assert.equal(u.events.filter(event => event === 'native-print').length, 1, 'a preview closed before loading does not print later');
  assert.equal(u.timers.size, 0);
});

test('explicit completion hides only the saved PO signature and new material makes it available again', async () => {
  const u = ui();
  await u.run('A.potongCetak(null)');
  u.run("S.potongCetakPilih={tidak:{'po-second':true}};");
  await u.run('A.potongCetakJalan(null)');
  const complete = u.button('Sudah dicetak');
  assert.equal(complete.disabled, false);
  complete.onclick(); complete.onclick(); await flush();
  assert.equal(complete.disabled, true);
  assert.match(complete.textContent, /Tersimpan/);
  assert.equal(u.run('persisted.length'), 1, 'double tap is disabled while the save is pending');
  assert.deepEqual(u.json('potongCetakDaftar().map(function(x){return x.po.id;})'), ['po-second']);
  const secondDevice = ui(u.json('persisted'));
  await secondDevice.run('A.potongCetak(null)');
  assert.deepEqual(secondDevice.json('potongCetakDaftar().map(function(x){return x.po.id;})'), ['po-second']);
  u.run("rencana.push({id:'plan-extra',poId:'po-first',revision:'r2',status:'siap',rol:1,bahanList:[{nama:'Kain CONTOH',qty:50,satuan:'yard'}],rincianRol:[]});S.state.po[0].printSignature=printWorkSignature(S.state.po[0],rencana);");
  assert.deepEqual(u.json('potongCetakDaftar().map(function(x){return x.po.id;})'), ['po-first', 'po-second']);
  assert.equal(u.run('S.potongPrintHistory.length'), 1, 'the prior snapshot stays in history');
});

test('frozen snapshot and request ID survive a lost-response retry without storing workflow or pictures', async () => {
  const u = ui();
  u.run("S.potongCetakPilih={tidak:{'po-second':true}};S.state.po[0].workflow.giant='x'.repeat(60000);lostNext=true;");
  await u.run('A.potongCetakJalan(null)');
  const preview = u.printedHtml(), complete = u.button('Sudah dicetak');
  u.run("S.state.po[0].nama='NAMA BARU';rencana[0].bahanList[0].qty=200;");
  complete.onclick(); await flush();
  assert.equal(complete.disabled, false);
  assert.equal(u.run('S.potongPrintHistory&&S.potongPrintHistory.length||0'), 0);
  assert.equal(u.run('persisted.length'), 1);
  complete.onclick(); await flush();
  const writes = u.json('requests.filter(function(r){return r.action==="savePrintHistory";})');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].payload, writes[1].payload, 'retry keeps the original ID, proof and frozen print content');
  const snap = writes[0].payload.entries[0].snapshot;
  assert.equal(snap.po.nama, 'KEMEJA CONTOH');
  assert.equal(snap.rencana[0].bahanList[0].qty, 100);
  assert.match(preview, /KEMEJA CONTOH/);
  assert.doesNotMatch(JSON.stringify(snap), /workflow|giant|poDraft|data:image/);
  assert.equal(snap.po.gambar, 'v1');
  assert.equal(snap.gambar, '');
  assert.equal(u.run('persisted.length'), 1);
  assert.equal(u.run('S.potongPrintHistory.length'), 1);
});

test('a refused save leaves the PO available and explains that the preview must be refreshed', async () => {
  const u = ui();
  u.run('failedNext=true;');
  await u.run('A.potongKartuJalan(null)');
  const complete = u.button('Sudah dicetak');
  complete.onclick(); await flush();
  assert.equal(complete.disabled, false);
  assert.equal(u.run('persisted.length'), 0);
  assert.equal(u.run('potongCetakDaftar().length'), 2);
  assert.match(u.overlay().children[0].children.find(el => el.tag === 'span').textContent, /berubah sejak pratinjau/);
});

test('history can reprint both formats after PO archival using its snapshot without another write', async () => {
  const u = ui();
  await u.run("potongCetakSimpan(potongCetakData([S.state.po[0]]),'potong')()");
  const before = u.json('S.potongPrintHistory');
  u.run("S.state.po=[];rencana=[];S.img['po-first']={ver:'v2',data:'data:image/png;base64,BBBB'};requests=[];");
  const id = before[0].id;
  for (const kind of ['potong', 'jalan']) {
    await u.run(`A.potongCetakUlang({getAttribute:function(k){return k==='data-id'?${JSON.stringify(id)}:${JSON.stringify(kind)};}})`);
    const doc = u.printedHtml();
    assert.match(doc, /KEMEJA CONTOH/);
    assert.match(doc, /XL/);
    assert.match(doc, /Kain CONTOH/);
    assert.doesNotMatch(doc, /BBBB/);
    assert.equal(u.button('Sudah dicetak'), undefined);
    u.button('Tutup pratinjau').onclick();
  }
  assert.deepEqual(u.json('requests.map(function(r){return r.action;})'), ['getGambar']);
  assert.deepEqual(u.json('S.potongPrintHistory'), before);
});

test('history escapes names, numbers, sizes and action IDs, and saves the server source proof', async () => {
  const u = ui();
  u.run(`S.state.po[0].printSignature='server-proof-with-released-size';var finish=potongCetakSimpan(potongCetakData([S.state.po[0]]),'jalan');`);
  await u.run('finish()');
  assert.equal(u.json('requests')[0].payload.entries[0].signature, 'server-proof-with-released-size');
  u.run(`var row=S.potongPrintHistory[0];row.id='x" onclick="bad()';row.snapshot.po.nama='<img src=x onerror=bad()>';row.snapshot.po.noPO='<b>PO</b>';row.snapshot.ukuran[0].s='<script>XL</script>';`);
  const rendered = u.run('potongCetakHistorySheet()');
  assert.doesNotMatch(rendered, /<img|<script| onclick="bad/);
  assert.match(rendered, /&lt;img src=x onerror=bad\(\)&gt;/);
  assert.match(rendered, /&lt;script&gt;XL&lt;\/script&gt;/);
  assert.match(rendered, /data-id="x&quot; onclick=&quot;bad\(\)"/);
  assert.match(part('function req(', '/* ---------- gambar:'), /workflowWrite = [^\n]*savePrintHistory/);
});

test('the sheet opens immediately and shows loading rather than previously printed PO choices', async () => {
  const u = ui();
  u.run('holdHistory=true;');
  const pending = u.run('A.potongCetak(null)');
  assert.equal(u.run('!!lembar'), true, 'the dialog opens before the network response');
  const loading = u.run('lembar.render()');
  assert.match(loading, /Memperbarui riwayat|Memuat riwayat/);
  assert.doesNotMatch(loading, /data-a="potongCetakJalan"|KEMEJA CONTOH/);
  const joined = u.run('A.potongCetak(null)');
  assert.equal(pending, joined, 'rapid opens reuse the in-flight request');
  assert.equal(u.run('requests.length'), 1);
  u.run('historyPending.shift().resolve();');
  await pending;
  assert.match(u.run('lembar.render()'), /KEMEJA CONTOH/);
});

test('a warm cache avoids repeated requests until TTL or explicit refresh, while keeping data visible', async () => {
  const u = ui();
  await u.run('A.potongCetak(null)');
  await u.run('A.potongCetak(null)');
  assert.equal(u.run('requests.length'), 1);
  u.run('S.potongPrintCache.at=Date.now()-60001;holdHistory=true;');
  const stale = u.run('A.potongCetak(null)');
  assert.equal(u.run('requests.length'), 2);
  assert.match(u.run('lembar.render()'), /KEMEJA CONTOH/);
  assert.match(u.run('lembar.render()'), /Memperbarui riwayat/);
  assert.equal(u.run('A.potongCetakSegarkan()'), stale, 'manual refresh coalesces while a request is pending');
  u.run('historyPending.shift().resolve();'); await stale;
  u.run('holdHistory=false;');
  await u.run('A.potongCetakSegarkan()');
  assert.equal(u.run('requests.length'), 3, 'manual refresh ignores a still-fresh TTL');
});

test('failed initial history load keeps print choices hidden, provides retry, and recovers without reopening', async () => {
  const u = ui();
  u.run('failHistory=true;');
  await u.run('A.potongCetak(null)');
  const failed = u.run('lembar.render()');
  assert.match(failed, /Riwayat sementara tidak tersambung/);
  assert.match(failed, /data-a="potongCetakSegarkan">Coba lagi/);
  assert.doesNotMatch(failed, /data-a="potongCetakJalan"/);
  assert.equal(u.run('S.potongPrintCache.pending'), null);
  await u.run('A.potongCetakSegarkan()');
  assert.match(u.run('lembar.render()'), /data-a="potongCetakJalan"/);
  assert.equal(u.run('S.potongPrintCache.error'), '');
});

test('a history response from an old login never reaches another account or replaces its pending request', async () => {
  const u = ui();
  await u.run("potongCetakSimpan(potongCetakData([S.state.po[0]]),'potong')()");
  u.run('holdHistory=true;');
  const old = u.run('A.potongCetak(null)');
  u.run("S.token='new-owner-session';S.state.me={id:'different-owner'};persisted=[];");
  const current = u.run('A.potongCetak(null)');
  assert.equal(u.run('S.potongPrintHistory.length'), 0);
  u.run('historyPending.shift().resolve();'); await old;
  assert.equal(u.run('S.potongPrintHistory.length'), 0);
  assert.equal(u.run('S.potongPrintCache.loaded'), false);
  assert.equal(u.run('S.potongPrintCache.pending'), current);
  u.run('historyPending.shift().resolve();'); await current;
  assert.equal(u.run('S.potongPrintCache.loaded'), true);
  assert.equal(u.run('S.potongPrintHistory.length'), 0);
});

test('an older in-flight history response merges with a print saved while it was loading', async () => {
  const u = ui();
  u.run('holdHistory=true;');
  const load = u.run('A.potongCetak(null)');
  await u.run("potongCetakSimpan(potongCetakData([S.state.po[0]]),'jalan')()");
  assert.equal(u.run('S.potongPrintHistory.length'), 1);
  u.run('historyPending.shift().resolve();'); await load;
  assert.equal(u.run('S.potongPrintHistory.length'), 1, 'the empty pre-save response must not erase the successful save');
  assert.deepEqual(u.json('potongCetakDaftar().map(function(x){return x.po.id;})'), ['po-second']);
});

test('mark selected moves only checked POs to history and coalesces a double tap without printing again', async () => {
  const u = ui();
  await u.run('A.potongCetak(null)');
  u.run("S.potongCetakPilih={tidak:{'po-second':true}};");
  assert.match(u.run('lembar.render()'), /Sudah dicetak · pindahkan 1 PO/);
  const first = u.run('A.potongCetakTandai()');
  const second = u.run('A.potongCetakTandai()');
  assert.equal(first, second);
  assert.match(u.run('lembar.render()'), /data-a="potongCetakTandai" disabled/);
  await first;
  assert.equal(u.run('persisted.length'), 1);
  assert.equal(u.run('S.potongPrintTab'), 'riwayat');
  assert.deepEqual(u.json('potongCetakDaftar().map(function(x){return x.po.id;})'), ['po-second']);
  assert.equal(u.run('requests.filter(function(r){return r.action==="savePrintHistory";}).length'), 1);
  assert.deepEqual(u.events, [], 'marking a previous print does not invoke the printer');
  assert.equal(u.document.body.children.length, 0);
});

test('mark-selected retry after a lost reply keeps the same immutable intent and does not duplicate saved rows', async () => {
  const u = ui();
  await u.run('A.potongCetak(null)');
  u.run("S.potongCetakPilih={tidak:{'po-second':true}};lostNext=true;");
  await u.run('A.potongCetakTandai()');
  assert.equal(u.run('persisted.length'), 1);
  assert.equal(u.run('S.potongPrintHistory.length'), 0);
  assert.match(u.json('messages').at(-1)[0], /Koneksi putus/);
  assert.equal(u.run('S.potongPrintCache.saving'), null);
  await u.run('A.potongCetakTandai()');
  const saves = u.json('requests.filter(function(r){return r.action==="savePrintHistory";})');
  assert.equal(saves.length, 2);
  assert.deepEqual(saves[0].payload, saves[1].payload);
  assert.equal(u.run('persisted.length'), 1);
  assert.equal(u.run('S.potongPrintHistory.length'), 1);
});

test('history shows thumbnails and its size badges without recalculating the pending cutting list', async () => {
  const u = ui();
  await u.run("potongCetakSimpan(potongCetakData([S.state.po[0]]),'jalan')()");
  u.run("S.potongPrintTab='riwayat';poDaftar=function(){throw new Error('unnecessary pending calculation');};");
  const rendered = u.run('potongCetakSheet()');
  assert.match(rendered, /class="thumb l" data-img="po-first" data-ver="v1"/);
  assert.match(rendered, /class="sz-aktif potong">XL<\/span>/);
  assert.match(rendered, /KEMEJA CONTOH/);
});

test('a cold history reprint loads the photo before opening and printing, then reuses its warmed cache', async () => {
  const u = ui();
  await u.run("potongCetakSimpan(potongCetakData([S.state.po[0]]),'jalan')()");
  const id = u.json('S.potongPrintHistory')[0].id;
  u.run("S.img={};requests=[];holdImages=true;");
  const reprint = u.run(`A.potongCetakUlang({getAttribute:function(k){return k==='data-id'?${JSON.stringify(id)}:'jalan';}})`);
  await flush();
  assert.equal(u.document.body.children.length, 0, 'a cold image is loaded before creating printable HTML');
  assert.equal(u.events.length, 0);
  assert.deepEqual(u.json('requests'), [{ action: 'getGambar', payload: { ids: ['po-first'] } }]);
  u.run('imagePending.shift()();'); await reprint;
  assert.match(u.printedHtml(), /<img class="foto" src="data:image\/png;base64,AAAA"/);
  assert.equal(u.events.length, 1);
  u.button('Tutup pratinjau').onclick();
  await u.run(`A.potongCetakUlang({getAttribute:function(k){return k==='data-id'?${JSON.stringify(id)}:'potong';}})`);
  assert.equal(u.run('requests.length'), 1, 'the second format reuses the downloaded image');
  assert.match(u.printedHtml(), /data:image\/png;base64,AAAA/);
});

test('a failed photo fetch does not silently print a pictureless card and can be retried', async () => {
  const u = ui();
  u.run("S.img={};failImages=true;S.potongCetakPilih={tidak:{'po-second':true}};");
  await u.run('A.potongKartuJalan(null)');
  assert.equal(u.document.body.children.length, 0);
  assert.deepEqual(u.events, []);
  assert.match(u.json('messages').at(-1)[0], /Foto belum dapat dimuat/);
  await u.run('A.potongKartuJalan(null)');
  assert.match(u.printedHtml(), /data:image\/png;base64,AAAA/);
});

test('a photo arriving after login changes cannot open a print preview in the new session', async () => {
  const u = ui();
  u.run('S.img={};holdImages=true;');
  const pending = u.run('A.potongKartuJalan(null)');
  await flush();
  u.run("S.token='different-session';imagePending.shift()();");
  await pending;
  assert.equal(u.document.body.children.length, 0);
  assert.equal(u.events.length, 0);
  assert.match(u.json('messages').at(-1)[0], /Sesi berubah/);
});

test('history checkboxes select independent rows, select all and clear update both bulk buttons', async () => {
  const u = ui();
  await u.run("potongCetakSimpan(potongCetakData(S.state.po),'jalan')()");
  u.run("S.potongPrintTab='riwayat';");
  let sheet = u.run('potongCetakSheet()');
  assert.equal((sheet.match(/data-c="potongCetakRiwayatCek"/g) || []).length, 2);
  assert.equal((sheet.match(/data-a="potongCetakUlangPilihan" data-v="(?:jalan|potong)" disabled/g) || []).length, 2);
  const ids = u.json('S.potongPrintHistory.map(function(r){return r.id;})');
  u.run(`C.potongCetakRiwayatCek({checked:true,getAttribute:function(){return ${JSON.stringify(ids[1])};}});`);
  assert.deepEqual(u.json('potongCetakHistoryPilihan().map(function(r){return r.id;})'), [ids[1]]);
  sheet = u.run('potongCetakSheet()');
  assert.match(sheet, /Kartu jalan · 1 PO/);
  assert.match(sheet, /Cetak pilihan · 1 PO/);
  assert.equal((sheet.match(/ checked>/g) || []).length, 1);
  u.run(`C.potongCetakRiwayatCek({checked:false,getAttribute:function(){return ${JSON.stringify(ids[1])};}});`);
  assert.equal(u.run('potongCetakHistoryPilihan().length'), 0);
  u.run("A.potongCetakRiwayatSemua({getAttribute:function(){return '1';}});");
  assert.deepEqual(u.json('potongCetakHistoryPilihan().map(function(r){return r.id;})'), ids);
  assert.match(u.run('potongCetakSheet()'), /Cetak pilihan · 2 PO/);
  u.run("A.potongCetakRiwayatSemua({getAttribute:function(){return '0';}});");
  assert.equal(u.run('potongCetakHistoryPilihan().length'), 0);
  assert.deepEqual(u.json('S.potongPrintSelected'), {});
});

test('bulk reprint combines checked frozen snapshots into one preview in either format without saving history', async () => {
  const u = ui();
  u.run("S.state.po[0]._potong=['L','XL'];S.state.po.push({id:'po-excluded',nama:'DO NOT PRINT',noPO:'EXCLUDED',_potong:['M'],ukuran:{},ukuranAktif:['M'],status:'aktif'});");
  await u.run("potongCetakSimpan(potongCetakData(S.state.po),'jalan')()");
  u.run("S.potongPrintHistory.forEach(function(r){if(r.poId!=='po-excluded')C.potongCetakRiwayatCek({checked:true,getAttribute:function(){return r.id;}});});");
  const original = u.json('S.potongPrintHistory');
  u.run("S.state.po.forEach(function(p){p.nama='LIVE NAME MUST NOT LEAK';p._potong=['XXXL'];});rencana[0].bahanList[0].qty=9999;requests=[];");
  for (const kind of ['potong', 'jalan']) {
    const beforeNativePrints = u.events.length;
    await u.run(`A.potongCetakUlangPilihan({getAttribute:function(){return ${JSON.stringify(kind)};}})`);
    assert.equal(u.document.body.children.length, 1, 'selected rows share a single preview');
    assert.equal(u.events.length, beforeNativePrints + 1, 'one print invocation for all selected rows');
    const printed = u.printedHtml();
    assert.match(printed, /KEMEJA CONTOH/);
    assert.match(printed, /PO LAIN/);
    assert.doesNotMatch(printed, /DO NOT PRINT|LIVE NAME|9999|XXXL/);
    if (kind === 'potong') {
      assert.equal((printed.match(/<article class="kartu /g) || []).length, 2);
      assert.match(printed, /100 yd/);
    } else {
      assert.equal((printed.match(/<article class="kj">/g) || []).length, 3, 'one card each for frozen L, XL and M');
      assert.match(printed, /<div class="pil"><span>L<\/span><\/div>/);
      assert.match(printed, /<div class="pil"><span>XL<\/span><\/div>/);
      assert.match(printed, /<div class="pil"><span>M<\/span><\/div>/);
    }
    assert.equal(u.button('Sudah dicetak'), undefined, 'reprints cannot create another print-history receipt');
    u.button('Tutup pratinjau').onclick();
  }
  assert.deepEqual(u.json('requests'), [], 'warm reprints perform no write or history read');
  assert.deepEqual(u.json('S.potongPrintHistory'), original, 'formatting and warmup never mutate frozen history');
});

test('bulk cold-photo reprint batches at most 30 unique images and retains every selected card', async () => {
  const u = ui();
  u.run(`potongCetakCache();S.state.po=[];S.img={};S.potongPrintHistory=[];imageData={};
    for(var i=0;i<32;i++){
      var id='bulk-photo-'+i;imageData[id]='data:image/png;base64,PHOTO'+i;
      S.potongPrintHistory.push({id:'history-'+i,poId:id,jenis:'jalan',snapshot:{po:{id:id,noPO:'PO-BULK-'+i,nama:'BULK '+i,gambar:'v1'},ukuran:[{s:'XL',target:0}],rencana:[],tahap:'tunggu',sudah:0}});
    }
    var duplicate=JSON.parse(JSON.stringify(S.potongPrintHistory[0]));duplicate.id='history-same-photo';S.potongPrintHistory.push(duplicate);
    A.potongCetakRiwayatSemua({getAttribute:function(){return '1';}});`);
  await u.run("A.potongCetakUlangPilihan({getAttribute:function(){return 'jalan';}})");
  const imageRequests = u.json('requests');
  assert.deepEqual(imageRequests.map(r => r.action), ['getGambar', 'getGambar']);
  assert.deepEqual(imageRequests.map(r => r.payload.ids.length), [30, 2]);
  assert.equal(new Set(imageRequests.flatMap(r => r.payload.ids)).size, 32, 'shared photo references are downloaded once');
  const printed = u.printedHtml();
  assert.equal((printed.match(/<article class="kj">/g) || []).length, 33);
  assert.equal((printed.match(/<img class="foto"/g) || []).length, 33);
  assert.match(printed, /data:image\/png;base64,PHOTO31/);
  assert.equal((printed.match(/<section class="lembar">/g) || []).length, 9, 'bulk cards still paginate four per A4');
  assert.equal(u.run('persisted.length'), 0);
});

test('bulk reprint with no current selection is safe even when stale selection IDs remain', async () => {
  const u = ui();
  await u.run("potongCetakSimpan(potongCetakData(S.state.po),'jalan')()");
  u.run("S.potongPrintSelected={'history-no-longer-visible':true};requests=[];");
  for (const kind of ['potong', 'jalan']) {
    await u.run(`A.potongCetakUlangPilihan({getAttribute:function(){return ${JSON.stringify(kind)};}})`);
  }
  assert.equal(u.document.body.children.length, 0);
  assert.deepEqual(u.events, []);
  assert.deepEqual(u.json('requests'), []);
  assert.equal(u.run('persisted.length'), 2);
  assert.equal(u.json('messages').length, 2);
  assert.ok(u.json('messages').every(([text, error]) => error && /Centang PO/.test(text)));
});
