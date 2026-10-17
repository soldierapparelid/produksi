'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
const block=html.slice(html.indexOf('/* COMMERCE UI START'),html.indexOf('/* COMMERCE UI END */'));
function harness(orders){
  const ctx=vm.createContext({console,setTimeout,clearTimeout});
  vm.runInContext(`var A={},C={},R={},VIEWS={},S={state:{me:{id:'owner',divisi:'owner'}},f:{},sub:{},img:{}},IMG_TOKO='cm.',UI_VERSION='test';
    function me(){return S.state.me;}function isAdmin(){return true;}function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
    function rp(n){return 'Rp'+n;}function nf(n){return String(n);}function tgl(d){return d||'';}function ic(){return '';}function inisial(){return 'M';}function emptyBox(s){return '<p>'+s+'</p>';}function cocok(q,a){return !q||a.join(' ').toLowerCase().includes(q.toLowerCase());}
  `,ctx);vm.runInContext(block,ctx);
  const run=s=>vm.runInContext(s,ctx);
  run(`commerceEntry('pembelian').data={orders:${JSON.stringify(orders)},products:[],suppliers:[]};`);
  return {run,json:s=>JSON.parse(run('JSON.stringify('+s+')'))};
}
function order(id,extra={}){return {id,revision:'r1',invoiceId:'invoice-'+id,produkId:'p',productName:'Topi '+id,supplierSnapshot:{id:'s',nama:'Supplier'},supplierName:'Supplier',tanggalOrder:'2026-10-17',status:'pending',totalHarga:30000,totalPaid:0,balance:30000,totalQty:300,totalReceived:0,items:[{id:'i',nama:'Hitam',jumlah:300}],...extra};}
function ids(markup){return [...markup.matchAll(/data-a="commerceInvoiceOpen" data-ids="([^"]+)"/g)].map(m=>m[1]);}
test('finished invoices move to history while paid partial receipts and unpaid complete receipts stay active',()=>{
  const h=harness([order('finished',{status:'selesai',totalPaid:30000,balance:0,totalReceived:300}),order('partial',{status:'lunas',totalPaid:30000,balance:0,totalReceived:290}),order('unpaid',{status:'sebagian',totalReceived:300})]);
  const before=h.json("commerceData('pembelian').orders");
  assert.deepEqual(ids(h.run("commerceOrderList(commerceData('pembelian').orders)")),['partial','unpaid']);
  const history=h.run("commerceOrderList(commerceData('pembelian').orders,true)");assert.deepEqual(ids(history),['finished']);assert.match(history,/>LUNAS</);assert.match(history,/Selesai · Riwayat/);
  assert.deepEqual(h.json("commerceData('pembelian').orders"),before,'view does not cancel or rewrite records');
});
test('completed models remain within a partially completed invoice; search never splits the invoice',()=>{
  const h=harness([order('a',{invoiceId:'same',productName:'Topi spesial',totalPaid:30000,balance:0,totalReceived:300,status:'selesai'}),order('b',{invoiceId:'same',totalReceived:290}),order('c',{totalPaid:30000,balance:0,totalReceived:300,status:'selesai'})]);
  assert.deepEqual(ids(h.run("commerceOrderList(commerceData('pembelian').orders)")),['a,b']);
  assert.deepEqual(ids(h.run("commerceOrderList(commerceData('pembelian').orders,true)")),['c']);
  h.run("S.f.q='spesial'");assert.deepEqual(ids(h.run("commerceOrderList(commerceData('pembelian').orders)")),['a,b']);
});
test('correcting a receipt or payment reopens a finished invoice, and restoring it returns to history',()=>{
  const h=harness([order('a',{invoiceId:'same',totalPaid:30000,balance:0,totalReceived:300,status:'selesai'})]);
  assert.deepEqual(ids(h.run("commerceOrderList(commerceData('pembelian').orders)")),[]);
  h.run("commerceData('pembelian').orders[0].totalReceived=290");assert.deepEqual(ids(h.run("commerceOrderList(commerceData('pembelian').orders)")),['a']);
  assert.deepEqual(ids(h.run("commerceOrderList(commerceData('pembelian').orders,true)")),[]);
  h.run("Object.assign(commerceData('pembelian').orders[0],{totalReceived:300,totalPaid:29000,balance:1000})");assert.deepEqual(ids(h.run("commerceOrderList(commerceData('pembelian').orders)")),['a']);
  h.run("Object.assign(commerceData('pembelian').orders[0],{totalPaid:30000,balance:0})");assert.deepEqual(ids(h.run("commerceOrderList(commerceData('pembelian').orders,true)")),['a']);
});
test('review flags, invalid amounts, empty orders and excess receipt totals cannot silently finish an invoice',()=>{
  const base=order('base',{totalPaid:30000,balance:0,totalReceived:300,status:'selesai'}),cases=[{paymentReview:true},{receiptReview:true},{needsReview:true},{balance:''},{totalPaid:null},{totalHarga:NaN},{totalQty:0,totalReceived:0},{totalReceived:301},{totalReceived:-1},{totalPaid:30001}];
  for(const patch of cases){const h=harness([{...base,...patch}]);assert.equal(h.run("commercePurchaseComplete(commerceData('pembelian').orders[0])"),false,JSON.stringify(patch));}
  const h=harness([{...base,totalHarga:0,totalPaid:0}]);assert.equal(h.run("commercePurchaseComplete(commerceData('pembelian').orders[0])"),true,'free order with positive quantity can complete');
});
test('manual archives remain separate and recoverable; history filters never affect the active filter',()=>{
  const h=harness([order('open'),order('old',{status:'batal',cancelMode:'archived',cancelledBy:'owner',cancelKeepsEvents:true}),order('done',{totalPaid:30000,balance:0,totalReceived:300,status:'selesai'})]);
  assert.deepEqual(ids(h.run("commerceOrderList(commerceData('pembelian').orders)")),['open']);
  h.run("S.f['commerceStatus-pembelianHistory']='archived'");const old=h.run("commerceOrderList(commerceData('pembelian').orders,true)");assert.match(old,/Kembalikan ke daftar/);assert.match(old,/Topi old/);assert.ok(!old.includes('Topi done'));
  assert.deepEqual(ids(h.run("commerceOrderList(commerceData('pembelian').orders)")),['open']);
});
