const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
function between(a,b) { const start=html.indexOf(a),end=html.indexOf(b,start+a.length); assert.ok(start>=0&&end>start,a); return html.slice(start,end); }
function context() {
  const c=vm.createContext({});
  vm.runInContext(`function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
    function T(p){return p.totalStage||{};}function workflowFor(p){return p.workflow;}
    function qcBalance(p){return p.qc||{ready:0,waiting:0};}
    var po={status:'aktif',workflow:{issues:[],complete:false},totalStage:{sisaMaklon:20}};`,c);
  vm.runInContext(between('function poTahap(', 'function stagesHtml('),c);
  vm.runInContext(between('function poStatusChips(', 'function poCard('),c);
  return c;
}
test('PO badges pair lifecycle and process names with color classes',()=>{
  const c=context(); const active=vm.runInContext('poStatusChips(po)',c);
  assert.match(active,/chip info">PO aktif/);assert.match(active,/chip info">Di maklon/);
  vm.runInContext(`po.workflow.issues=['Periksa'];`,c);
  assert.match(vm.runInContext('poStatusChips(po)',c),/chip bad">Perlu diperiksa/);
  vm.runInContext(`po.workflow.issues=[];po.workflow.complete=true;po.status='selesai';`,c);
  const complete=vm.runInContext('poStatusChips(po)',c);assert.match(complete,/chip ok">PO selesai/);assert.match(complete,/chip ok">Produksi selesai/);
});
test('closed but unverified historical PO still displays its review warning',()=>{
  const c=context();vm.runInContext(`po.status='selesai';`,c);
  const rendered=vm.runInContext('poStatusChips(po)',c);
  assert.match(rendered,/PO selesai/);assert.match(rendered,/chip warn">Arsip belum terverifikasi/);
});
test('verified active PO shows seven-day deadline in WIB without exposing a timer on held or closed PO',()=>{
  const c=context();vm.runInContext(`po.workflow.complete=true;po.tuntasPada='2026-10-08T20:00:00.000Z';`,c);
  const rendered=vm.runInContext('poStatusChips(po)',c);
  assert.match(rendered,/Selesai otomatis 16 Okt.*03[.:]00 WIB/i);
  assert.match(rendered,/7 × 24 jam/);assert.match(rendered,/saat aplikasi terhubung ke server/);
  vm.runInContext(`po.workflow.issues=['Review'];`,c);
  assert.doesNotMatch(vm.runInContext('poStatusChips(po)',c),/Selesai otomatis/);
  vm.runInContext(`po.workflow.issues=[];po.status='selesai';`,c);
  assert.doesNotMatch(vm.runInContext('poStatusChips(po)',c),/Selesai otomatis/);
});
test('status chips remain on PO cards and detail, with original assignment navigation restored',()=>{
  assert.match(between('function poCard(', 'function sisaMaklonUk('),/poStatusChips\(po, th\)/);
  assert.match(between('function poSheet(', 'A.poStatusSet ='),/poStatusChips\(po, th\)/);
  assert.match(html,/{ id: 'maklon', label: 'Maklon'/);
  assert.match(between('VIEWS.maklon =', 'C.slipMaklon ='),/S\.sub\.maklon \|\| 'ringkas'/);
  assert.doesNotMatch(html,/sewingAllocation|goAlokasi|alokasiFilter|Atur PO berikutnya/);
});
