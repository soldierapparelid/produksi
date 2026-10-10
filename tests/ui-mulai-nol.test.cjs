const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function between(a, b) {
  const start = html.indexOf(a), end = html.indexOf(b, start + a.length);
  assert.ok(start >= 0 && end > start, a);
  return html.slice(start, end);
}
function context(role) {
  const c = vm.createContext({ console });
  vm.runInContext(`var A={},S={},LS={get:function(){return '';}},sheets=[{node:{}}],log={req:[],toast:[],tutup:0,buka:0},jawaban=[],isian={yakin:''};
    function esc(s){return String(s==null?'':s);} function nf(n){return String(n);} function nfQty(n){return String(n);} function satuanPendek(s){return s;}
    function tgl(s){return String(s);} function ic(){return '';} function me(){return {divisi:'${role}'};} function quiet(){}
    function fText(label,name){return '<input name="'+name+'" data-label="'+label+'">';}
    function sheetHtml(title,body,foot){return title+'|'+body+'|'+(foot||'');} function formVals(){return isian;}
    function toast(m,bad){log.toast.push((bad?'!':'')+m);} function openSheet(fn){log.buka++;log.lembar=fn();} function closeSheet(){log.tutup++;}
    function req(action,payload){log.req.push([action,JSON.parse(JSON.stringify(payload))]);return Promise.resolve(jawaban.shift());}
    function act(el,p){return Promise.resolve(p);}`, c);
  vm.runInContext(between('/* ---------- Mulai dari nol: owner mengosongkan', 'A.bahanSembunyi = function'), c);
  return c;
}
const get = (c, expr) => JSON.parse(vm.runInContext(`JSON.stringify(${expr})`, c));
const tick = () => new Promise(resolve => setImmediate(resolve));

test('the stock settings page offers the reset to the owner only, and the sheet shows what will change before anything runs', async () => {
  assert.match(html, /data-a="stokAturSave">Simpan<\/button><\/div><\/div>' \+ \(me\(\)\.divisi === 'owner' \? nolKartu\(\) : ''\) \+/);
  const c = context('owner');
  assert.match(vm.runInContext('nolKartu()', c), /class="btn danger" data-a="nolOpen">Lihat yang akan berubah/);
  vm.runInContext(`jawaban.push({pratinjau:true,rencana:2,rol:7,bahan:5,po:3,lepas:4,daftarBahan:[{nama:'Scuba',saldo:12.5,satuan:'kg',rol:2}],daftarPO:[{id:'p1',noPO:'PO-1',nama:'Kaos'}],daftarLepas:[{id:'p7',noPO:'PO-7',nama:'Celana',ukuran:['L','XL']},{id:'p8',noPO:'PO-8',nama:'Polo',ukuran:['M','XXL']}]});A.nolOpen({});`, c);
  await tick();
  assert.deepEqual(get(c, 'log.req'), [['getPratinjauNol', {}]]);
  const lembar = get(c, 'log.lembar');
  assert.match(lembar, /^Mulai dari nol\|/); assert.match(lembar, /5 bahan · 7 rol/); assert.match(lembar, /Persiapan potong dibatalkan<\/dt><dd class="b">2</); assert.match(lembar, /3 PO yang belum dipotong/); assert.match(lembar, /Ukuran belum dipotong dilepas<\/dt><dd class="b">4 ukuran di 2 PO/); assert.match(lembar, /Celana<\/span><br><span class="d">PO-7<\/span><\/span><span class="b">L · XL/);
  assert.match(lembar, /Scuba<\/span><span class="xs muted">2 rol<\/span><span class="n">12.5/); assert.match(lembar, /Kaos<\/span><br><span class="d">PO-1/);
  assert.match(lembar, /name="yakin" data-label="Ketik MULAI DARI NOL untuk melanjutkan"/); assert.match(lembar, /class="btn danger" data-a="nolJalankan">Kosongkan sekarang/);
  assert.match(lembar, /data-a="cadanganUnduh"/); assert.match(lembar, /tidak bisa dibatalkan dengan satu tombol/);
  vm.runInContext('S.nol={pratinjau:true,rencana:0,rol:0,bahan:0,po:0,lepas:1,daftarBahan:[],daftarPO:[],daftarLepas:[{id:"p7",noPO:"PO-7",nama:"Celana",ukuran:["L"]}]};', c);
  assert.match(vm.runInContext('nolSheet()', c), /nolJalankan/, 'a size still waiting for the cutter is enough to offer the run');
  vm.runInContext('S.nol={pratinjau:true,rencana:0,rol:0,bahan:0,po:0,lepas:0,daftarBahan:[],daftarPO:[],daftarLepas:[]};', c);
  const kosong = vm.runInContext('nolSheet()', c);
  assert.match(kosong, /Stok sudah kosong/); assert.doesNotMatch(kosong, /nolJalankan|name="yakin"/);
});

test('nothing is sent until the words are typed; then the server is called again until it answers finished', async () => {
  const c = context('owner');
  vm.runInContext("isian.yakin='ya';A.nolJalankan({});", c); await tick();
  assert.deepEqual(get(c, 'log.req'), []); assert.match(get(c, 'log.toast')[0], /^!Ketik MULAI DARI NOL/);
  vm.runInContext("isian.yakin=' mulai dari nol ';jawaban.push({selesai:false},{selesai:false},{selesai:true});A.nolJalankan({});", c);
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(get(c, 'log.req'), [['mulaiDariNol', { yakin: 'MULAI DARI NOL' }], ['mulaiDariNol', { yakin: 'MULAI DARI NOL' }], ['mulaiDariNol', { yakin: 'MULAI DARI NOL' }]]);
  assert.equal(get(c, 'log.tutup'), 1); assert.match(get(c, 'log.toast').pop(), /^Selesai\. Stok nol/);
});

test('an account that is not the owner cannot open the reset', async () => {
  const c = context('admin');
  vm.runInContext('A.nolOpen({});', c); await tick();
  assert.deepEqual(get(c, 'log.req'), []); assert.match(get(c, 'log.toast')[0], /^!Hanya owner/);
});
