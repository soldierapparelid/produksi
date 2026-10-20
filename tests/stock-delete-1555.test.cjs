'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./helpers/apps-script-harness.cjs');

function fixture() {
  const h = harness();
  for (const name of ['bahan-invoice','cutting-plans','auto-completion','reconcile-legacy','history-corrections','stock-delete'])
    vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src',name+'.js'),'utf8'),h.context);
  const setup = h.request('setupOwner',{nama:'Owner fixture',pin:'1234'});
  assert.equal(setup.ok,true,setup.error);
  const owner = setup.data.token, cutter = 'stock-delete-cutter-token', admin = 'stock-delete-admin-token';
  h.run(`pkStore_().lock(function(){
    pkStore_().append('Pegawai',{id:'delete-cutter',nama:'Cutter',divisi:'potong',aktif:true,token:'${cutter}'});
    pkStore_().append('Pegawai',{id:'delete-admin',nama:'Admin',divisi:'admin',aktif:true,token:'${admin}'});
    pkStore_().append('CommerceRecord',{id:'paid-invoice-fixture',module:'pembelian',kind:'order',parentId:'supplier-fixture',data:'{"total":100000,"paid":100000}'});
  });`);
  const call = (a,p={},token=owner) => { h.cold(); return h.request(a,{token,workflowVersion:2,...p}); };
  const good = (a,p={},token=owner) => { const r=call(a,p,token); assert.equal(r.ok,true,r.error); return r.data?.data??r.data; };
  const raw = name => { h.cold(); return h.run(`pkStore_().fresh(${JSON.stringify(name)});pkStore_().read(${JSON.stringify(name)})`); };
  const bought = good('saveInvoiceBahan',{invoice:{id:'delete-invoice-fixture',invoice:'FIXTURE-001',tanggal:'2026-10-20',supplier:'Fixture',
    items:[
      {bahan:'Embos Maroon',satuan:'kg',harga:88000,rolls:[{qty:25,rollLabel:'Rol A'},{qty:24.125,rollLabel:'Rol B'}]},
      {bahan:'Embos Maroon',satuan:'kg',harga:88000,qty:100,rol:4},
      {bahan:'Bahan Lain',satuan:'kg',harga:60000,qty:80,rol:3},
      {bahan:'Kemeja Hitam',satuan:'yard',harga:15000,rolls:[{qty:100,rollLabel:'Yard 1'},{qty:100,rollLabel:'Yard 2'}]},
      {bahan:'Kemeja Putih',satuan:'meter',harga:14000,rolls:[{qty:40.5,rollLabel:'Meter 1'}]}
    ]}});
  good('savePO',{deferMaterial:true,po:{newId:'delete-po-fixture',nama:'PO fixture',jenis:'stok',ukuran:{},ukuranAktif:['XL']}});
  const roll = bought.rows.find(r=>r.rollLabel==='Rol A');
  const preview = (mode='bahan',bahan='Embos Maroon',stokId) => good('getHapusStokBahan',{mode,bahan,...(stokId?{stokId}:{})});
  const request = (p,id='delete-stock-fixture') => ({mode:p.mode,bahan:p.bahan,...(p.mode==='rol'?{stokId:p.items[0].stokId}:{}),id,expectedRevision:p.revision,catatan:'Salah jenis bahan'});
  const state = () => good('getState');
  const stock = bahan => state().stokRingkas.find(r=>r.nama===bahan);
  const inject = (table,row) => { const keys=h.run(`SCHEMA[${JSON.stringify(table)}]`); h.sheets[table].values.push(keys.map(k=>row[k]??'')); };
  return {h,owner,cutter,admin,call,good,raw,roll,preview,request,state,stock,inject};
}

test('whole material removal is one ledger write, preserves purchases, prices, usage and paid invoices',()=>{
  const f=fixture(), source=f.raw('StokBahan'), commerce=f.raw('CommerceRecord'), cuts=f.raw('Potong'), beforeOther=f.stock('Bahan Lain');
  const p=f.preview(); assert.equal(p.qty,149.125); assert.equal(p.rollCount,2); assert.equal(p.items.length,3);
  const writes=f.h.sheets.StokBahan.writes, r=f.good('hapusStokBahan',f.request(p));
  assert.equal(f.h.sheets.StokBahan.writes,writes+1); assert.equal(r.qty,149.125); assert.equal(r.rows.length,3);
  assert.equal(f.stock('Embos Maroon').saldo,0); assert.equal(f.stock('Embos Maroon').legacySaldo,0);
  assert.deepEqual(f.stock('Bahan Lain'),beforeOther); assert.deepEqual(f.raw('CommerceRecord'),commerce); assert.deepEqual(f.raw('Potong'),cuts);
  const after=f.raw('StokBahan'); assert.deepEqual(after.filter(r=>source.some(s=>s.id===r.id)),source);
  assert.ok(r.rows.every(r=>r.jenis==='koreksi'&&r.alasan==='hapus_stok'&&r.qty<0&&r.saldoAfter===0));
  assert.ok(f.state().stokRol.filter(r=>r.bahan==='Embos Maroon').every(r=>r.saldo===0));
  assert.ok(f.h.events.some(e=>e[0]==='lock')); assert.equal(f.h.isLocked(),false);
});

test('a partly used roll can be emptied without deleting past cutting or the other rolls and unitemized stock',()=>{
  const f=fixture();
  const plan=f.good('saveRencanaPotong',{rencana:{id:'delete-cut-plan',poId:'delete-po-fixture',alokasiBahan:[{stokId:f.roll.id,qty:5}]}});
  f.good('createPotong',{potong:{id:'delete-cut-result',rencanaId:plan.id,expectedRencanaRevision:plan.revision,tanggal:'2026-10-20',ukuran:{XL:20}}},f.cutter);
  const cuts=f.raw('Potong'), sources=f.raw('StokBahan'), p=f.preview('rol','Embos Maroon',f.roll.id);
  assert.equal(p.qty,20); const r=f.good('hapusStokBahan',f.request(p));
  assert.equal(r.rows[0].sourceStockId,f.roll.id); assert.equal(r.rows[0].saldoBefore,20); assert.equal(r.rows[0].qty,-20);
  assert.equal(f.stock('Embos Maroon').saldo,124.125); assert.equal(f.stock('Embos Maroon').pakai,5); assert.equal(f.stock('Embos Maroon').legacySaldo,100);
  assert.deepEqual(f.raw('Potong'),cuts); assert.deepEqual(f.raw('StokBahan').filter(r=>r.alasan!=='hapus_stok'),sources);
  assert.equal(f.state().stokRol.find(r=>r.id===f.roll.id).saldo,0);
});

test('removing only unitemized stock leaves actual rolls available and its event cannot be edited or deleted generically',()=>{
  const f=fixture(), p=f.preview('saldo');
  assert.equal(p.qty,100); assert.equal(p.rollCount,0);
  const result=f.good('hapusStokBahan',f.request(p)), event=result.rows[0];
  assert.equal(event.sourceStockId,''); assert.equal(f.stock('Embos Maroon').saldo,49.125); assert.equal(f.stock('Embos Maroon').legacySaldo,0);
  const deletion=f.call('deleteRecord',{sheet:'StokBahan',id:event.id,alasan:'test'});
  assert.equal(deletion.ok,false); assert.match(deletion.error,/penghapusan stok/);
  const edit=f.call('saveStok',{stok:{id:event.id,jenis:'koreksi',tanggal:event.tanggal,bahan:event.bahan,qty:-20,satuan:'kg',catatan:'change'}});
  assert.equal(edit.ok,false); assert.match(edit.error,/penghapusan stok/);
  assert.equal(f.stock('Embos Maroon').saldo,49.125);
});

test('reserved targets cannot be removed, while unrelated material reservations do not block deletion',()=>{
  for(const mode of ['bahan','rol','saldo']){
    const f=fixture(), p=f.preview(mode,'Embos Maroon',mode==='rol'?f.roll.id:undefined), payload=mode==='saldo'?
      {bahanList:[{nama:'Embos Maroon',qty:10,satuan:'kg'}]}:{alokasiBahan:[{stokId:f.roll.id,qty:5}]};
    f.good('saveRencanaPotong',{rencana:{id:'delete-reserved-plan',poId:'delete-po-fixture',...payload}});
    const r=f.call('hapusStokBahan',f.request(p)); assert.equal(r.ok,false); assert.match(r.error,/dicadangkan|berubah/);
    assert.equal(f.stock('Embos Maroon').saldo,149.125);
    assert.equal(f.raw('StokBahan').some(r=>r.alasan==='hapus_stok'),false);
  }
  const f=fixture(), p=f.preview();
  f.good('saveRencanaPotong',{rencana:{id:'delete-other-reservation',poId:'delete-po-fixture',bahanList:[{nama:'Bahan Lain',qty:10,satuan:'kg'}]}});
  f.good('hapusStokBahan',f.request(p)); assert.equal(f.stock('Bahan Lain').dicadangkan,10);
});

test('stale material receipts, roll identity edits and stock-start changes invalidate the preview without any stock write',()=>{
  for(const change of ['receipt','identity','settings']){
    const f=fixture(), p=f.preview(), req=f.request(p);
    if(change==='receipt') f.inject('StokBahan',{id:'other-phone-stock',jenis:'beli',tanggal:'2026-10-21',bahan:'Embos Maroon',qty:5,satuan:'kg',harga:88000,total:440000});
    if(change==='identity'){
      const columns=f.h.sheets.StokBahan.values[0], row=f.h.sheets.StokBahan.values.find(r=>r[columns.indexOf('id')]===f.roll.id);
      row[columns.indexOf('rollLabel')]='Changed on other phone';
    }
    if(change==='settings'){
      const sheet=f.h.sheets.Pengaturan, columns=sheet.values[0], row=sheet.values.find(r=>r[columns.indexOf('key')]==='stokMulai');
      if(row) row[columns.indexOf('value')]='2026-10-01'; else f.inject('Pengaturan',{key:'stokMulai',value:'2026-10-01'});
    }
    const count=f.raw('StokBahan').length,r=f.call('hapusStokBahan',req);
    assert.equal(r.ok,false,change); assert.match(r.error,/berubah/); assert.equal(f.raw('StokBahan').length,count);
  }
});

test('a lost response replays the exact committed removal, and cannot remove stock replenished afterwards',()=>{
  const f=fixture(), p=f.preview(), req=f.request(p), sheet=f.h.sheets.StokBahan, original=sheet.getRange;
  let failOnce=true;
  sheet.getRange=function(...args){
    const range=original.apply(this,args), write=range.setValues;
    range.setValues=function(rows){const r=write.call(this,rows); if(failOnce&&rows.some(row=>row.includes('hapus_stok'))){failOnce=false;throw new Error('Response lost after commit');} return r;};
    return range;
  };
  const result=f.call('hapusStokBahan',req); assert.equal(result.ok,false); assert.equal(f.stock('Embos Maroon').saldo,0);
  f.good('saveInvoiceBahan',{invoice:{id:'fresh-new-stock-invoice',invoice:'NEW-RECEIPT',tanggal:'2026-10-21',
    items:[{bahan:'Embos Maroon',qty:12,satuan:'kg',harga:88000,rol:0}]}});
  const count=f.raw('StokBahan').length,retry=f.good('hapusStokBahan',req);
  assert.equal(retry.alreadyApplied,true); assert.equal(retry.qty,149.125); assert.equal(f.stock('Embos Maroon').saldo,12); assert.equal(f.raw('StokBahan').length,count);
  for(const changed of [{catatan:'Changed reason'},{mode:'saldo'},{expectedRevision:'different-proof'}]){
    const rejected=f.call('hapusStokBahan',{...req,...changed}); assert.equal(rejected.ok,false); assert.match(rejected.error,/data berbeda/);
  }
});

test('a partial batch interruption can fill only missing original corrections without repeating the already-committed roll',()=>{
  const f=fixture(), p=f.preview(), req=f.request(p), sheet=f.h.sheets.StokBahan, original=sheet.getRange;
  let failOnce=true;
  sheet.getRange=function(...args){
    const range=original.apply(this,args), write=range.setValues;
    range.setValues=function(rows){
      if(failOnce&&rows.some(row=>row.includes('hapus_stok'))){
        failOnce=false; original.call(sheet,args[0],args[1],1,args[3]).setValues([rows[0]]); throw new Error('Partial transport fixture');
      }
      return write.call(this,rows);
    }; return range;
  };
  assert.equal(f.call('hapusStokBahan',req).ok,false);
  assert.equal(f.raw('StokBahan').filter(r=>r.alasan==='hapus_stok').length,1);
  const retry=f.good('hapusStokBahan',req); assert.equal(retry.rows.length,3); assert.equal(f.stock('Embos Maroon').saldo,0);
  assert.equal(f.raw('StokBahan').filter(r=>r.alasan==='hapus_stok').length,3);
});

test('yard and meter rolls retain units and exact remaining quantities when removed',()=>{
  const f=fixture(), yard=f.state().stokRol.find(r=>r.bahan==='Kemeja Hitam'), p=f.preview('rol','Kemeja Hitam',yard.id);
  assert.equal(p.satuan,'yard'); assert.equal(p.qty,100);
  f.good('hapusStokBahan',f.request(p,'delete-yard-roll')); assert.equal(f.stock('Kemeja Hitam').saldo,100); assert.equal(f.stock('Kemeja Hitam').satuan,'yard');
  const meter=f.preview('bahan','Kemeja Putih'); assert.equal(meter.qty,40.5); assert.equal(meter.satuan,'meter');
  f.good('hapusStokBahan',f.request(meter,'delete-meter-stock')); assert.equal(f.stock('Kemeja Putih').saldo,0);
});

test('only owner may preview or remove stock; proof and reason are always mandatory',()=>{
  const f=fixture(), p=f.preview(), req=f.request(p);
  for(const token of [f.cutter,f.admin]){
    for(const [a,payload] of [['getHapusStokBahan',{mode:'bahan',bahan:'Embos Maroon'}],['hapusStokBahan',req]]){
      const r=f.call(a,payload,token); assert.equal(r.ok,false); assert.match(r.error,/Hanya owner/);
    }
  }
  for(const invalid of [{expectedRevision:''},{expectedRevision:undefined},{catatan:''},{id:'bad'},{mode:'rol',stokId:'wrong-source'}]){
    assert.equal(f.call('hapusStokBahan',{...req,...invalid}).ok,false);
  }
  assert.equal(f.stock('Embos Maroon').saldo,149.125);
});

test('mixed-unit, duplicate-source and negative legacy balances are refused instead of guessed',()=>{
  for(const kind of ['unit','duplicate','over-itemized','negative-usage']){
    const f=fixture();
    if(kind==='unit') f.inject('StokBahan',{id:'delete-bad-unit',jenis:'beli',tanggal:'2026-10-21',bahan:'Embos Maroon',qty:10,satuan:'yard'});
    if(kind==='duplicate') f.inject('StokBahan',f.raw('StokBahan').find(r=>r.id===f.roll.id));
    if(kind==='over-itemized') f.inject('StokBahan',{id:'delete-bad-detail',jenis:'rinci',tanggal:'2026-10-21',bahan:'Embos Maroon',qty:200,satuan:'kg',stockMode:'roll',rollLabel:'invalid'});
    if(kind==='negative-usage') f.inject('Potong',{id:'delete-bad-usage',poId:'delete-po-fixture',bahan:'Embos Maroon',kg:-5,tanggal:'2026-10-20'});
    const count=f.raw('StokBahan').length,r=f.call('getHapusStokBahan',{mode:'bahan',bahan:'Embos Maroon'});
    assert.equal(r.ok,false,kind); assert.match(r.error,/cocok|ganda|periksa/i); assert.equal(f.raw('StokBahan').length,count);
  }
});

test('import endpoints cannot fabricate or remove the deletion evidence, including an older event marked as imported',()=>{
  const f=fixture(), result=f.good('hapusStokBahan',f.request(f.preview('saldo'))), event=result.rows[0];
  const forged={...event,id:'delete-forged-import',invoiceId:'delete-forged-import'};
  for(const [action,payload] of [
    ['importRows',{sheet:'StokBahan',rows:[forged]}],
    ['gantiImpor',{data:{StokBahan:[forged]}}]
  ]){
    const r=f.call(action,payload); assert.equal(r.ok,false); assert.match(r.error,/pencatatan|impor/);
  }
  const columns=f.h.sheets.StokBahan.values[0], row=f.h.sheets.StokBahan.values.find(r=>r[columns.indexOf('id')]===event.id);
  row[columns.indexOf('asal')]='lama';
  const r=f.call('gantiImpor',{data:{StokBahan:[]}});
  assert.equal(r.ok,false); assert.match(r.error,/dipertahankan/);
  assert.equal(f.raw('StokBahan').some(r=>r.id===event.id),true); assert.equal(f.stock('Embos Maroon').saldo,49.125);
});
