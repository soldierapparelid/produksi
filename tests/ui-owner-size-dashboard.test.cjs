'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function between(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return html.slice(a, b);
}
function context() {
  const c = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core.js'), 'utf8'), c);
  vm.runInContext(`
    var S={state:{potong:[],kirim:[],setor:[],qc:[],gudang:[],users:[{divisi:'qc',aktif:true},{divisi:'potong',aktif:true},{divisi:'jahit',aktif:true}]},sub:{evAll:'1'}};
    function sourcePaid(r){return !!r.upahId;} function poAktif(){return [];} function isAdmin(){return true;}
    function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
    function nf(n){return String(n);} function rp(n){return 'Rp '+n;} function tgl(s){return s||'';} function lalu(){return 'tadi';}
    function namaUser(id){return id==='sewer'?'Penjahit Contoh':'Pemotong Contoh';} function poNama(){return 'PO Contoh';}
    function emptyBox(s){return s;} function ic(){return '';} function setorLaporanLama(r){return r.asal==='koreksi-ukuran';}
    function row(id,opening){return {id:id,poId:'example-po',userId:'cutter',maklonId:'sewer',total:12,tarif:0,asal:opening?'koreksi-ukuran':'',dibuat:id};}
    S.state.potong=[row('opening-cut',true),row('normal-cut',false)];
    S.state.kirim=[row('opening-send',true),row('normal-send',false)];
    S.state.setor=[Object.assign(row('opening-report',true),{status:'diajukan'}),Object.assign(row('opening-count',true),{status:'diterima',noSlip:'SS-EXAMPLE',upah:0})];
  `, c);
  vm.runInContext(between('function sourceCanEditRate(', 'function payrollNotice('), c);
  vm.runInContext(between('function tindakan() {', 'VIEWS.beranda = function'), c);
  vm.runInContext(between('function catatanHapusBtn(', 'function tglPanjang('), c);
  return c;
}
function json(c, expression) { return JSON.parse(vm.runInContext('JSON.stringify('+expression+')', c)); }

test('owner restoration produces a count task without an impossible opening cutting-price task', () => {
  const c = context(), tasks = json(c, 'tindakan()');
  assert.ok(!tasks.some(x => x.id === 'opening-cut'));
  assert.ok(tasks.some(x => x.id === 'normal-cut' && x.a === 'hargaOpen'));
  assert.ok(tasks.some(x => x.id === 'opening-report' && x.a === 'terimaOpen'));
  assert.ok(tasks.some(x => x.id === 'opening-count' && x.a === 'hargaOpen'), 'an actual restored count can receive an explicit sewing rate');
});

test('restored history is labelled as restoration and hides unavailable price, delete and dispatch-slip actions', () => {
  const c = context(), view = vm.runInContext('berandaCatatan()', c);
  assert.match(view, /Riwayat potong dipulihkan: 12 pcs/);
  assert.match(view, /Biaya lama belum diketahui/);
  assert.match(view, /Riwayat jahit dipulihkan: 12 pcs oleh Penjahit Contoh/);
  assert.doesNotMatch(view, /data-a="(?:hargaOpen|del)"[^>]*data-id="opening-cut"/);
  assert.doesNotMatch(view, /data-a="slip"[^>]*data-id="opening-send"/);
  assert.match(view, /data-a="hargaOpen"[^>]*data-id="normal-cut"/);
  assert.match(view, /data-a="del"[^>]*data-id="normal-cut"/);
  assert.match(view, /data-a="slip"[^>]*data-id="normal-send"/);
  assert.match(view, /data-a="terimaOpen" data-id="opening-report"/);
});

test('rate eligibility protects opening cuts while preserving explicit sewing rates and paid/QC locks', () => {
  const c = context();
  assert.equal(vm.runInContext("sourceCanEditRate(row('open',true),'Potong')", c), false);
  assert.equal(vm.runInContext("sourceCanEditRate(row('actual',false),'Potong')", c), true);
  assert.equal(vm.runInContext("sourceCanEditRate(row('open',true),'SlipSetor')", c), true);
  assert.equal(vm.runInContext("sourceCanEditRate(Object.assign(row('paid',false),{upahId:'wage'}),'Potong')", c), false);
  vm.runInContext("S.state.qc.push({setorId:'checked'})", c);
  assert.equal(vm.runInContext("sourceCanEditRate(row('checked',true),'SlipSetor')", c), false);
});
