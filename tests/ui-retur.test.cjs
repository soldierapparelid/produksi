'use strict';
/* 1.5.60 Retur paket di tampilan: menu untuk owner/admin, halaman menolak peran produksi, sel CSV aman, pembaca Excel multi-lembar. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
function part(html, a, b) { const p = html.indexOf(a), q = html.indexOf(b, p + a.length); assert.ok(p >= 0 && q > p, a); return html.slice(p, q); }

function menu(file, role) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const context = vm.createContext({ role });
  vm.runInContext(`
    var VIEWS = {}, UI_VERSION = '1.5.63', HARI_ARSIP = 30, A = {}, C = {};
    var S = {sub: {lain: 'menu'}, f: {}, state: {settings: {namaUsaha: 'Soldier'}, produk: [], users: [], karyawan: [], trimmed: false}};
    var DIVISI = {owner: {label: 'Owner'}, admin: {label: 'Admin'}, potong: {label: 'Potong'}, jahit: {label: 'Jahit'}, qc: {label: 'QC'}};
    var Api = {mode: function () { return 'hosted'; }}, LS = {get: function () { return ''; }};
    function me() { return {nama: 'Tim uji', divisi: role}; }
    function coreIsAdmin(u) { return u.divisi === 'owner' || u.divisi === 'admin'; }
    function returData() { return {data: null, loading: true, error: ''}; }
    function stokTampil() { return []; } function inisial() { return 'TU'; } function esc(v) { return String(v); } function ic(n) { return '<i data-icon="' + n + '"></i>'; }
    function backHead(t) { return '<h1>' + t + '</h1>'; } function emptyBox(t) { return '<p>' + t + '</p>'; }
  `, context);
  vm.runInContext(part(html, 'VIEWS.lain = function () {', '\nfunction backHead('), context);
  vm.runInContext(part(html, 'function returView() {', 'A.returMenu = function'), context);
  return { html: vm.runInContext('VIEWS.lain()', context), retur: () => vm.runInContext("S.sub.lain = 'retur'; VIEWS.lain()", context) };
}

for (const file of ['index.html', 'apps-script/Index.html']) {
  test(`${file}: owner and admin find Retur paket in the Admin group; production roles cannot open it`, () => {
    const owner = menu(file, 'owner').html;
    const admin = menu(file, 'admin');
    assert.equal((admin.html.match(/data-a="returMenu"/g) || []).length, 1);
    assert.match(admin.retur(), /Memuat data retur/);
    assert.equal((owner.match(/data-a="returMenu"/g) || []).length, 1);
    const label = owner.indexOf('<span class="t">Retur paket</span>');
    assert.ok(label > owner.indexOf('<div class="label">Admin</div>') && label < owner.indexOf('<div class="label">Data induk</div>'));
    assert.ok(!/https?:\/\//.test(owner.slice(label - 300, label + 200)), 'no external site: returns live inside this app');
    for (const role of ['potong', 'jahit', 'qc']) {
      const r = menu(file, role);
      assert.ok(!r.html.includes('returMenu'), role);
      assert.match(r.retur(), /khusus owner/, role + ' cannot open the page by its sub key');
    }
  });
}

test('CSV cells keep long IDs as text and neutralise formulas', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const c = vm.createContext({});
  vm.runInContext(part(html, 'function returCsvSel(v) {', 'A.returCsv = function'), c);
  assert.equal(c.returCsvSel('576000000000000001'), '"=""576000000000000001"""');
  assert.equal(c.returCsvSel('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(c.returCsvSel('-5'), '"\'-5"');
  assert.equal(c.returCsvSel('Kaos "BDU"'), '"Kaos ""BDU"""');
  assert.equal(c.returCsvSel(null), '""');
});

test('the Excel reader keeps cell positions, shared strings and numeric cells', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const c = vm.createContext({});
  vm.runInContext(part(html, 'function sjXmlTeks(s) {', 'function sjBaris('), c);
  vm.runInContext(part(html, 'function returKolom(ref) {', 'function returXlsx(buf) {'), c);
  const xml = '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
    '<row r="2"><c r="A2" t="inlineStr"><is><t>SH-1 &amp; 2</t></is></c><c r="B2"><v>46307.5</v></c><c r="C2" t="str"><v>Sedang dikembalikan</v></c></row><row r="3"/></sheetData>';
  const rows = JSON.parse(JSON.stringify(c.returXlsxBaris(xml, ['No. Pesanan', 'Status Pengembalian'])));
  assert.deepEqual(rows[0], ['No. Pesanan', '', 'Status Pengembalian']);
  assert.deepEqual(rows[1], ['SH-1 & 2', 46307.5, 'Sedang dikembalikan']);
  assert.deepEqual(rows[2], []);
  assert.equal(c.returKolom('AA'), 26);
});

test('the release keeps one shared version and a new page cache', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const core = fs.readFileSync(path.join(root, 'src/core.js'), 'utf8');
  assert.match(html, /var UI_VERSION = '1\.5\.64';/);
  assert.match(core, /var APP_VERSION = '1\.5\.64';/);
  assert.equal(html.match(/window\.PK_BUILD = '([^']+)'/)[1], worker.match(/var RAKITAN = '([^']+)'/)[1]);
  assert.match(html, /getReturState\|getReturDetail\|getReturBukti\)\$\/\.test\(action\)/, 'return reads use the read timeout');
});

function returUi() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8'), c = vm.createContext({ Promise, Date });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/retur.js'), 'utf8'), c);
  vm.runInContext(`
    var A = {}, C = {}, S = {token:'test-session',tab:'lain', sub:{lain:'retur'}, f:{q:''}}, sheets = [], requests = [], notices = [], paints = 0, fields = [];
    var endpoint='test-api', Api={mode:function(){return 'remote';}}, LS={get:function(){return endpoint;}};
    function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function(x){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[x];}); }
    function me() { return {nama:'Admin penerima', divisi:'admin'}; }
    function coreIsAdmin(u) { return u.divisi === 'owner' || u.divisi === 'admin'; }
    function todayYmd() { return '2026-10-30'; }
    function fSelect(label, name, opts, selected, attrs) { fields.push({label:label,name:name,opts:opts,selected:selected}); return '<label>'+label+'<select name="'+name+'" '+(attrs||'')+'>'+opts.map(function(x){return '<option value="'+x[0]+'"'+(x[0]===selected?' selected':'')+'>'+x[1]+'</option>';}).join('')+'</select></label>'; }
    function fText(label,name,value) { return '<label>'+label+'<input name="'+name+'" value="'+esc(value)+'"></label>'; }
    function fNum(label,name,value) { return fText(label,name,value); }
    function fTanggal(label,name,value) { return fText(label,name,value); }
    function nf(v){return String(v);} function rp(v){return String(v);} function tgl(v){return v;} function ic(){return '<i></i>';}
    function emptyBox(v){return '<p>'+v+'</p>';} function sheetHtml(title,body,footer){return title+body+(footer||'');}
    function cocok(q, fields){return !q || fields.some(function(x){return String(x||'').indexOf(q)>=0;});}
    function refresh(){} function paintTop(){paints++;} function quiet(){} function toast(v){notices.push(v);}
    function topNode(){return {};} function $(selector){return selector.indexOf('data-form')>=0 ? {} : null;}
    function formVals(){return draftValues;} function req(action,payload){requests.push({action:action,payload:payload});return Promise.resolve({cases:[],imports:[]});}
    function act(el,p){return p;} function newId(){return 'proof1';} var draftValues = {};
  `, c);
  vm.runInContext(part(html, 'var RETUR_TABS =', '/* ---------- impor file ---------- */'), c);
  vm.runInContext(part(html, 'A.returBuka = function', '/* ---------- bukti ---------- */'), c);
  vm.runInContext(part(html, 'C.returUnggah = function', 'A.returBuktiLihat = function'), c);
  return c;
}

test('receiving uses three conditions with inline evidence and preserves existing saved status until Save', () => {
  const c = returUi();
  vm.runInContext(`
    var m = {terima:true,kat:'label',unggah:'',data:{case:{id:'r1',status:'perjalanan',items:[{qty:3,returnQty:2}],note:'Sebelumnya'},evidence:[]}};
    returIsiTerima(m); var result = returTerimaHtml(m,m.data.case,[]);
  `, c);
  assert.equal(c.m.data.case.status, 'perjalanan');
  assert.equal(c.m.draf.receivedAt, '2026-10-30');
  assert.equal(c.m.draf.receiver, 'Admin penerima');
  assert.equal(c.m.draf.receivedQty, 2);
  const status = c.fields.find(x => x.name === 'status');
  assert.deepEqual(Array.from(status.opts, x => x[0]), ['diterima_baik','diterima_rusak','diterima_kurang']);
  assert.match(c.result, /data-c="returUnggah"/);
  assert.match(c.result, /<details class="card"><summary class="b">Tindak lanjut \/ klaim/);
  assert.ok(!c.result.includes('<details open'));
});

test('inline upload retains typed receipt fields when progress repaints the form', async () => {
  const c = returUi();
  vm.runInContext(`
    var m = {bagian:'terima',terima:true,kat:'contents',unggah:'',data:{case:{id:'r2'},evidence:[]}};
    sheets.push({returModel:m}); m.node=sheets[0];
    draftValues = {status:'diterima_rusak',receivedAt:'2026-10-29',receiver:'Tim sore',receivedQty:'2',note:'Kemasan sobek'};
    function returSiapkanBerkas(){return Promise.resolve({name:'foto.jpg',data:'data:image/jpeg;base64,abcd'});}
    returDetailMuat = function(){return Promise.resolve();};
    C.returUnggah({files:[{name:'foto.jpg'}]});
  `, c);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(c.m.draf)), JSON.parse(JSON.stringify(c.draftValues)));
  assert.equal(c.requests[0].action, 'unggahReturBukti');
  assert.equal(c.requests[0].payload.category, 'contents');
  assert.ok(c.paints >= 1);
});

test('the report chooser separates parcels not returned from damaged or lost cases', () => {
  const c = returUi();
  vm.runInContext(`
    returData().data = {cases:[{id:'wait',status:'perjalanan'},{id:'lost',status:'hilang'},{id:'good',status:'diterima_baik'},{id:'bad',status:'diterima_rusak'},{id:'unknown',status:'perlu_dicek',unidentified:true},{id:'archive',status:'hilang',archived:true}]};
    var pending = returLaporanPilihan({jenis:'aktif'}), issues = returLaporanPilihan({jenis:'masalah'});
  `, c);
  assert.deepEqual(Array.from(c.pending, x => x.id), ['wait','lost']);
  assert.deepEqual(Array.from(c.issues, x => x.id), ['lost','bad']);
});

test('opening Retur loads once and reuses a recent load instead of queuing a duplicate read', async () => {
  const c = returUi();
  vm.runInContext(`
    var window = {scrollTo:function(){}};
    function render(){var r=returData();if(!r.data&&!r.loading&&!r.error)returFetch().catch(quiet);}
    A.returMenu();
  `, c);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.requests.length, 1);
  vm.runInContext('A.returMenu()', c);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.requests.length, 1, 'recent loaded data is reused');
  vm.runInContext('returData().loadedAt=0; A.returMenu()', c);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.requests.length, 2, 'older cached data is refreshed');
});

test('receipt fields are locked during evidence upload so progress cannot discard newer edits', () => {
  const c = returUi();
  vm.runInContext(`
    var m={terima:true,kat:'contents',unggah:'Menyimpan bukti 1 dari 2…',data:{case:{id:'r-lock',status:'perjalanan',items:[{qty:1}]},evidence:[]}};
    returIsiTerima(m); var result=returTerimaHtml(m,m.data.case,[]);
  `,c);
  assert.match(c.result, /<fieldset[^>]*data-form="returTerima"[^>]* disabled aria-busy="true">/);
  assert.ok(c.result.indexOf('name="status"') > c.result.indexOf('<fieldset'));
  assert.ok(c.result.indexOf('name="receivedQty"') < c.result.indexOf('</fieldset>'));
  assert.match(c.result, /Menyimpan bukti 1 dari 2/);
  c.m.unggah='';
  assert.ok(!c.returTerimaHtml(c.m,c.m.data.case,[]).includes('disabled aria-busy="true"'));
});

test('return snapshots and in-flight reads cannot cross a session or API connection', async () => {
  const c=returUi();
  vm.runInContext(`
    var old=returData(); old.data={cases:[{id:'private-old'}]};
    S.token='other-session'; var fresh=returData();
  `,c);
  assert.equal(c.fresh.data,null);
  vm.runInContext(`
    returData().data={cases:[{id:'other-private'}]}; endpoint='other-api'; var next=returData();
    req=function(){return new Promise(function(resolve){pendingRead=resolve;});}; var loading=returFetch();
    S.token='third-session'; pendingRead({cases:[{id:'late-private'}]});
  `,c);
  await assert.rejects(c.loading,/Sesi berubah/);
  assert.equal(c.next.data,null);
  assert.equal(c.returData().data,null);
});

test('a later file in a background upload never redraws another open form', async () => {
  const c=returUi();
  vm.runInContext(`
    var m={bagian:'terima',terima:true,kat:'contents',unggah:'',data:{case:{id:'r3'},evidence:[]}};
    sheets.push({returModel:m});m.node=sheets[0];
    draftValues={status:'diterima_baik',receivedAt:'2026-10-30',receiver:'Admin',receivedQty:'1'};
    var fileResolvers=[];function returSiapkanBerkas(){return new Promise(function(resolve){fileResolvers.push(resolve);});}
    returDetailMuat=function(){return Promise.resolve();};
    C.returUnggah({files:[{name:'a.jpg'},{name:'b.jpg'}]});
    sheets.push({node:{unrelated:true}}); var before=paints;
    fileResolvers[0]({name:'a.jpg',data:'data:image/jpeg;base64,abcd'});
  `,c);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(c.fileResolvers.length,2);
  assert.equal(c.paints,c.before);
  c.fileResolvers[1]({name:'b.jpg',data:'data:image/jpeg;base64,abcd'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(c.paints,c.before);
});

for (const change of ['session','endpoint']) {
  test('a file prepared asynchronously is not uploaded after the '+change+' changes', async () => {
    const c=returUi();
    vm.runInContext(`
      var m={bagian:'terima',terima:true,kat:'contents',unggah:'',data:{case:{id:'private-old-case'},evidence:[]}};
      sheets.push({returModel:m});m.node=sheets[0];
      draftValues={status:'diterima_rusak',receivedAt:'2026-10-30',receiver:'Admin',receivedQty:'1',note:'Physical count'};
      var prepared=[];function returSiapkanBerkas(){return new Promise(function(resolve){prepared.push(resolve);});}
      returDetailMuat=function(){requests.push({action:'detail-refresh'});return Promise.resolve();};
      C.returUnggah({files:[{name:'private.jpg'},{name:'second.jpg'}]});
    `,c);
    assert.equal(c.prepared.length,1);
    assert.equal(c.requests.length,0,'file preparation is still pending');
    vm.runInContext(change==='session' ? "S.token='different-session'" : "endpoint='different-api'",c);
    c.prepared[0]({name:'private.jpg',data:'data:image/jpeg;base64,cHJpdmF0ZQ=='});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(c.requests.length,0,'neither the old private file nor case reads reach the new connection');
    assert.equal(c.prepared.length,1,'remaining files stop with the obsolete session');
    assert.equal(c.m.unggah,'');
    assert.deepEqual(JSON.parse(JSON.stringify(c.m.draf)),JSON.parse(JSON.stringify(c.draftValues)),'unsaved receipt draft remains intact');
    assert.ok(c.notices.some(message=>/Sesi berubah/.test(message)),'the user is told to reopen the case');
  });
}
