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
  const events = [], timers = new Map(); let serial = 0;
  const document = { body: node('body'), createElement(tag) {
    const el = node(tag);
    if (tag === 'iframe') {
      el.contentDocument = { images: [], querySelector() { return {}; }, querySelectorAll() { return []; } };
      el.contentWindow = { focus() {}, print() { events.push('native-print'); } };
      Object.defineProperty(el, 'srcdoc', { get() { return this.html; }, set(value) { this.html = value; queueMicrotask(() => el.onload()); } });
    }
    return el;
  } };
  const context = vm.createContext({ console, Promise, Date, document, window: {},
    setTimeout(fn, ms) { const id = ++serial; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core.js'), 'utf8'), context);
  vm.runInContext(`
    var A={},C={},S={img:{},state:{po:[],settings:{ukuran:['M','L','XL','XXL']}}},rencana=[],slipPreviews=[],requests=[],persisted=${JSON.stringify(saved)},nextId=0,lostNext=false,failedNext=false,lembar=null,paints=0,messages=[];
    function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
    function openSheet(fn,opt){lembar={render:fn,opt:opt};}function paintTop(){paints++;}
    function sheetHtml(t,b,f){return '<h2>'+esc(t)+'</h2>'+b+'<footer>'+(f||'')+'</footer>';}
    function emptyBox(s){return '<p>'+esc(s)+'</p>';}function thumb(){return '';}function ic(){return '';}
    function nf(n){return String(n||0);}function nfQty(n){return String(n).replace('.',',');}function satuanPendek(u){return u==='yard'?'yd':u==='meter'?'m':'kg';}
    function tgl(s){return String(s);}function inisial(s){return String(s||'?').charAt(0);}function gambarRef(p){return p&&p.gambar?{id:p.id,ver:p.gambar}:null;}
    function poUkuranPotong(p){return p._potong||[];}function T(p){return p.agg||{};}function poSeri(p){return p.series||'';}
    function rencanaPotongRows(id){return rencana.filter(function(r){return r.poId===id;});}function rencanaPotongById(id){return rencana.find(function(r){return r.id===id;});}function rencanaPotongBlocked(){return '';}
    function poHarusDipotong(){return S.state.po.slice();}function poDaftar(){return {rows:S.state.po};}function toast(m,e){messages.push([m,!!e]);}function act(el,p){return p;}function quiet(e){messages.push([e.message,true]);}
    function newId(){return 'ui-print-batch-'+(++nextId);}
    function req(action,payload){
      var frozen=JSON.parse(JSON.stringify(payload||{}));requests.push({action:action,payload:frozen});
      if(action==='getPrintHistory')return Promise.resolve({rows:JSON.parse(JSON.stringify(persisted))});
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
  return { run, json, context, document, events, timers, overlay, button, printedHtml };
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
  const pending = u.run('A.potongKartuJalan(null)');
  u.button('Tutup pratinjau').onclick();
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
  assert.deepEqual(u.json('requests'), []);
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
