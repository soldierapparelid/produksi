'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
test('one invoice funds an owner-prepared cut, two sewing workers, physical count, whole-PO QC and weekly pay without duplicate stock',()=>{
  const h=harness();
  vm.runInContext(['bahan-invoice.js','cutting-plans.js','auto-completion.js','slip-models.js'].map(f=>fs.readFileSync(path.resolve(__dirname,'../src',f),'utf8')).join('\n'),h.context);
  const setup=h.request('setupOwner',{nama:'Owner Fixture',pin:'1234'});assert.equal(setup.ok,true,setup.error);const owner=setup.data.token;
  const cutter='fixture_cutter_token_123',sewerA='fixture_sewer_a_token_123',sewerB='fixture_sewer_b_token_123',qc='fixture_qc_token_12345';
  h.run(`pkStore_().lock(function(){[
    {id:'cutuser1',nama:'Cut fixture',divisi:'potong',aktif:true,token:'${cutter}'},
    {id:'sewuser1',nama:'Sew A fixture',divisi:'jahit',aktif:true,token:'${sewerA}'},
    {id:'sewuser2',nama:'Sew B fixture',divisi:'jahit',aktif:true,token:'${sewerB}'},
    {id:'qcuser01',nama:'QC fixture',divisi:'qc',aktif:true,token:'${qc}'}].forEach(function(r){pkStore_().append('Pegawai',r);});});`);
  function call(action,p={},token=owner){h.cold();return h.request(action,{token,workflowVersion:2,...p});}
  function good(action,p={},token=owner){let r=call(action,p,token);assert.equal(r.ok,true,r.error);return r.data?.data??r.data;}
  const invoice={id:'invoice_team_01',invoice:'TEST-001',tanggal:'2026-10-05',supplier:'Supplier Fixture',items:[{bahan:'Dryfit Hitam',qty:100,rol:4,harga:70000,satuan:'kg'},{bahan:'Rib Hitam',qty:20,rol:2,harga:50000,satuan:'kg'}]};
  const receipt=good('saveInvoiceBahan',{invoice});assert.equal(receipt.total,8000000);good('saveInvoiceBahan',{invoice});
  good('savePO',{po:{newId:'po_team_01',nama:'Team fixture',ukuran:{M:10,L:10}}});
  const prep=good('saveRencanaPotong',{rencana:{id:'plan_team_01',poId:'po_team_01',bahanList:[{nama:' dryfit  hitam ',qty:10,satuan:'kg'},{nama:'Rib Hitam',qty:2,satuan:'kg'}],rol:1}});
  assert.equal(prep.status,'siap');
  const cut={id:'cut_team_01',rencanaId:prep.id,expectedRencanaRevision:prep.revision,poId:'po_team_01',ukuran:{M:10,L:10},tanggal:'2026-10-05'};
  const produced=good('createPotong',{potong:cut},cutter);assert.equal(produced.rol,1);assert.equal(produced.total,20);
  good('createPotong',{potong:cut},cutter);
  const repeat=call('createPotong',{potong:{...cut,id:'cut_team_02'}},cutter);assert.equal(repeat.ok,false);assert.match(repeat.error,/sudah dipakai/);
  const afterCut=good('getState');assert.equal(afterCut.stok.length,2);assert.equal(afterCut.potong.length,1);
  assert.equal(afterCut.stokRingkas.find(r=>r.nama==='Dryfit Hitam').saldo,90);assert.equal(afterCut.stokRingkas.find(r=>r.nama==='Rib Hitam').saldo,18);
  good('createKirim',{kirim:{id:'send_team_a',poId:'po_team_01',maklonId:'sewuser1',ukuran:{M:10,L:5},upah:2000,target:'2026-10-09'}});
  good('createKirim',{kirim:{id:'send_team_b',poId:'po_team_01',maklonId:'sewuser2',ukuran:{L:5},upah:2500,target:'2026-10-09'}});
  const reportA=good('createSetor',{setor:{id:'count_team_a',poId:'po_team_01',ukuran:{M:10,L:5},tanggal:'2026-10-06'}},sewerA);
  assert.equal(reportA.status,'diajukan');assert.equal(reportA.noSlip,'');
  const acceptedA=good('prosesSetor',{id:reportA.id,ukuran:{M:10,L:5},rejectUkuran:{}},qc);assert.ok(acceptedA.noSlip);
  assert.equal(good('getState').po.find(p=>p.id==='po_team_01').workflow.readyQC,false);
  const early=call('createQC',{qc:{id:'earlyqc01',poId:'po_team_01',setorId:reportA.id,ukuran:{M:10},tanggal:'2026-10-08'}},qc);assert.equal(early.ok,false);assert.match(early.error,/PO belum lengkap/);
  const reportB=good('createSetor',{setor:{id:'count_team_b',poId:'po_team_01',ukuran:{L:5},tanggal:'2026-10-06'}},sewerB);
  good('prosesSetor',{id:reportB.id,ukuran:{L:5},rejectUkuran:{}},qc);
  assert.equal(good('getState').po.find(p=>p.id==='po_team_01').workflow.readyQC,true);
  good('createQC',{qc:{id:'qc_team_a',poId:'po_team_01',setorId:reportA.id,ukuran:{M:10,L:5},tanggal:'2026-10-08'}},qc);
  good('createQC',{qc:{id:'qc_team_b',poId:'po_team_01',setorId:reportB.id,ukuran:{L:5},tanggal:'2026-10-08'}},qc);
  const done=good('getState'),po=done.po.find(p=>p.id==='po_team_01');assert.equal(po.workflow.complete,true);assert.ok(po.tuntasPada);
  const ids=done.payroll.filter(r=>r.pegawaiId==='sewuser1'&&r.available>0).map(r=>r.id);
  const wage=good('createUpah',{upah:{id:'wage_team_a',pegawaiId:'sewuser1',tanggal:'2026-10-08',itemIds:ids}});assert.equal(wage.totalQty,15);assert.equal(wage.totalUpah,30000);
  good('createUpah',{upah:{id:'wage_team_a',pegawaiId:'sewuser1',tanggal:'2026-10-08',itemIds:ids}});
  const final=good('getState');assert.equal(final.upah.length,1);assert.equal(final.stokRingkas.find(r=>r.nama==='Dryfit Hitam').saldo,90);
  assert.equal(final.payroll.filter(r=>r.pegawaiId==='sewuser1').reduce((n,r)=>n+r.available,0),0);
  const mine=good('getState',{},sewerA);assert.ok(mine.payroll.every(r=>r.pegawaiId==='sewuser1'));assert.equal(mine.stok,undefined);
});
