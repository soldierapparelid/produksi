'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
const source=['src/core.js','src/cutting-plans.js','apps-script/Server.gs'].map(f=>fs.readFileSync(path.resolve(__dirname,'..',f),'utf8')).join('\n');
function client(h){
  const c=vm.createContext(Object.fromEntries(['Date','console','PropertiesService','CacheService','SpreadsheetApp','LockService','Utilities'].map(k=>[k,h.context[k]])));vm.runInContext(source,c);
  return {run:s=>vm.runInContext(s,c),request(action,payload={}){return JSON.parse(vm.runInContext('api('+JSON.stringify(JSON.stringify({action,payload:{clientVersion:vm.runInContext('APP_VERSION',c),workflowVersion:2,...payload}}))+')',c));}};
}
function fixture(){
  const h=harness(),owner=client(h).request('setupOwner',{nama:'Synthetic QC owner',pin:'1234'});assert.equal(owner.ok,true,owner.error);const token=owner.data.token;
  h.run(`pkStore_().lock(function(){
    pkStore_().appendMany('Pegawai',[
      {id:'sewer001',nama:'Synthetic sewer A',divisi:'jahit',aktif:true,token:'sewer-session-123456789'},
      {id:'sewer002',nama:'Synthetic sewer B',divisi:'jahit',aktif:true,token:'sewer2-session-12345678'},
      {id:'qcworker',nama:'Synthetic QC',divisi:'qc',aktif:true,token:'qc-session-1234567890'},
      {id:'qcother1',nama:'Synthetic QC B',divisi:'qc',aktif:true,token:'qc-other-session-12345'},
      {id:'cutter01',nama:'Synthetic cutter',divisi:'potong',aktif:true}
    ]);
    pkStore_().append('PO',{id:'po000001',nama:'Synthetic garment',status:'aktif',ukuran:'{"M":10,"L":142}',total:152});
    pkStore_().append('Potong',{id:'cut00001',poId:'po000001',userId:'cutter01',tanggal:'2026-10-01',ukuran:'{"M":10,"L":142}',total:152,tarif:100});
    pkStore_().append('SlipKirim',{id:'send0001',poId:'po000001',maklonId:'sewer001',tanggal:'2026-10-02',ukuran:'{"M":10,"L":142}',total:152,upah:2000});
    pkStore_().appendMany('SlipSetor',[
      {id:'count001',noSlip:'SS-A',poId:'po000001',maklonId:'sewer001',tanggal:'2026-10-06',ukuran:'{"M":10,"L":50}',total:60,upah:2000,status:'diterima',workflowVersion:2},
      {id:'count002',noSlip:'SS-B',poId:'po000001',maklonId:'sewer001',tanggal:'2026-10-07',ukuran:'{"L":92}',total:92,upah:2000,status:'diterima',workflowVersion:2}
    ]);
  });true`);
  function call(action,payload={}){return client(h).request(action,{token,...payload});}
  function good(action,payload={}){const out=call(action,payload);assert.equal(out.ok,true,out.error);return out.data;}
  function rows(table){h.cold();return h.run(`pkStore_().read(${JSON.stringify(table)})`);}
  function change(table,id,patch){h.cold();h.run(`pkStore_().lock(function(){pkStore_().update(${JSON.stringify(table)},${JSON.stringify(id)},${JSON.stringify(patch)});});true`);}
  function state(t=token){return good('getState',{token:t,semua:true});}
  function intent(groups){const st=state();return {qc:{id:'batch-qc-001',poId:'po000001',tanggal:'2026-10-08',catatan:'Synthetic combined inspection',kelompok:groups||[{sources:st.setor.map(s=>({setorId:s.id,expectedRevision:s.qcRevision})),ukuran:{M:10,L:142}}]}};}
  return {h,token,call,good,rows,change,state,intent};
}
function data(out){return out.data||out;}
function noWrite(f,payload,pattern){const before=JSON.stringify(f.h.sheets.QC.values),writes=f.h.sheets.QC.writes,out=f.call('simpanQCGabungan',payload);assert.equal(out.ok,false);assert.match(out.error,pattern);assert.equal(JSON.stringify(f.h.sheets.QC.values),before);assert.equal(f.h.sheets.QC.writes,writes);return out;}

test('L50 plus L92 saves one prevalidated QC write, keeps source links, and skips M already inspected on the first source',()=>{
  const f=fixture();f.good('createQC',{qc:{id:'qc-M-done',poId:'po000001',setorId:'count001',tanggal:'2026-10-07',ukuran:{M:10}}});
  const input=f.intent();input.qc.kelompok[0].ukuran={L:142};const originalSources=JSON.stringify(f.rows('SlipSetor')),sheet=f.h.sheets.QC,before=sheet.writes,original=sheet.getRange.bind(sheet),batches=[];
  sheet.getRange=(...args)=>{const range=original(...args),set=range.setValues.bind(range);range.setValues=rows=>{if(args[0]>1){assert.equal(f.h.isLocked(),true);assert.equal(f.h.properties.pendingWrite,'1');batches.push(rows);}return set(rows);};return range;};
  const out=data(f.good('simpanQCGabungan',input));assert.equal(sheet.writes,before+1);assert.equal(batches.length,1);assert.equal(batches[0].length,2);assert.equal(out.records.length,2);assert.deepEqual(out.records.map(r=>[r.setorId,r.maklonId,JSON.parse(r.ukuran)]),[['count001','sewer001',{L:50}],['count002','sewer001',{L:92}]]);
  assert.ok(out.ids.every(id=>/^[A-Za-z0-9_-]{6,48}$/.test(id)));assert.ok(out.records.every(r=>r.qcBatchId==='batch-qc-001'&&r.qcBatchSize===2));assert.equal(JSON.stringify(f.rows('SlipSetor')),originalSources);
  const st=f.state();assert.equal(st.po[0].workflow.ukuran.L.siapQC,0);assert.equal(st.po[0].workflow.ukuran.M.qcOk,10);assert.equal(st.warehouse.reduce((n,w)=>n+w.total,0),152);
});

test('QC-role opaque proofs survive rate redaction and deterministic allocation preserves source wages and repair provenance',()=>{
  const f=fixture(),st=f.state('qc-session-1234567890');assert.ok(st.setor.every(r=>r.upah===0&&r.qcRevision&&r.qcGroupKey));assert.equal(st.setor[0].qcGroupKey,st.setor[1].qcGroupKey);
  const payload={token:'qc-session-1234567890',qc:{id:'batch-qc-001',poId:'po000001',tanggal:'2026-10-08',kelompok:[{sources:st.setor.slice().reverse().map(s=>({setorId:s.id,expectedRevision:s.qcRevision})),ukuran:{M:10,L:120},offlineUkuran:{L:5},perbaikanUkuran:{L:10},rejectUkuran:{L:7}}]}};
  const out=data(f.good('simpanQCGabungan',payload)),a=out.records[0],b=out.records[1];assert.equal(a.setorId,'count001');assert.equal(a.total,60);assert.equal(b.setorId,'count002');assert.equal(b.total,70);assert.equal(b.offline,5);assert.equal(b.perbaikan,10);assert.equal(b.reject,7);
  const earned=f.state().payroll.filter(r=>r.jenis==='jahit');assert.equal(earned.reduce((n,r)=>n+r.total*r.rate,0),260000);assert.ok(earned.every(r=>r.rate===2000));
  const repairState=f.state(),base=repairState.qc.find(q=>q.id===b.id);const repaired=data(f.good('simpanQCGabungan',{qc:{id:'batch-repair-01',poId:'po000001',tanggal:'2026-10-10',kelompok:[{sources:[{repairQcId:base.id,expectedRevision:base.qcRevision}],ukuran:{L:4}}]}}));
  assert.equal(repaired.records[0].repairQcId,b.id);assert.equal(repaired.records[0].setorId,'count002');assert.equal(repaired.records[0].perbaikan,-4);assert.equal(f.state().po[0].workflow.ukuran.L.qcPerbaikan,6);
});

test('same full request replays after PO closure without writes; different actor, changed batch, and partial manifest fail closed',()=>{
  const f=fixture(),input=f.intent(),first=data(f.good('simpanQCGabungan',input)),sheet=f.h.sheets.QC,writes=sheet.writes;
  f.change('PO','po000001',{status:'selesai'});const replay=data(f.good('simpanQCGabungan',input));assert.deepEqual(replay.ids,first.ids);assert.equal(sheet.writes,writes);
  noWrite(f,{...input,token:'qc-other-session-12345'},/permintaan berbeda/);
  const changed=JSON.parse(JSON.stringify(input));changed.qc.kelompok[0].sources.pop();changed.qc.kelompok[0].ukuran={M:10,L:50};noWrite(f,changed,/permintaan berbeda/);
  const changedMap=JSON.parse(JSON.stringify(input));changedMap.qc.kelompok[0].ukuran.L=141;changedMap.qc.kelompok[0].rejectUkuran={L:1};noWrite(f,changedMap,/permintaan berbeda/);
  f.h.cold();f.h.run(`pkStore_().lock(function(){pkStore_().remove('QC',${JSON.stringify(first.ids[1])});});true`);noWrite(f,input,/tersimpan sebagian/);
});

test('another device inspecting any source size invalidates frozen QC proof; fresh remaining-size batch still works',()=>{
  const f=fixture(),old=f.intent();f.good('createQC',{qc:{id:'qc-other-M',poId:'po000001',setorId:'count001',tanggal:'2026-10-07',ukuran:{M:10}}});noWrite(f,old,/berubah sejak/);
  const fresh=f.intent();fresh.qc.kelompok[0].ukuran={L:142};assert.equal(data(f.good('simpanQCGabungan',fresh)).records.length,2);
});

test('every source is checked before writing: pending, foreign PO, wrong rate or worker, invalid total and date cannot leave an earlier QC',()=>{
  for(const kind of ['pending','foreign','rate','worker','total','date','fraction','boolean','missing-proof','duplicate']){
    const f=fixture();
    if(kind==='pending')f.change('SlipSetor','count002',{status:'diajukan'});
    if(kind==='foreign')f.change('SlipSetor','count002',{poId:'other-po'});
    if(kind==='rate')f.change('SlipSetor','count002',{upah:3000});
    if(kind==='worker')f.change('SlipSetor','count002',{maklonId:'sewer002'});
    const input=f.intent();if(kind==='total')input.qc.kelompok[0].ukuran.L=141;if(kind==='date')input.qc.tanggal='2026-10-06';if(kind==='fraction')input.qc.kelompok[0].ukuran.L=142.1;if(kind==='boolean')input.qc.kelompok[0].ukuran.L=true;if(kind==='missing-proof')delete input.qc.kelompok[0].sources[1].expectedRevision;if(kind==='duplicate')input.qc.kelompok[0].sources.push(input.qc.kelompok[0].sources[0]);
    noWrite(f,input,/hitungan diterima|PO yang sama|maklon dan tarif|tidak seimbang|Setoran melebihi|tepat|Tanggal QC|bilangan bulat|Versi sumber|lebih dari sekali/);
  }
});

test('same PO sources with different tariffs use separate groups in one write; a later invalid group prevents both',()=>{
  const f=fixture();f.change('SlipSetor','count002',{upah:3000});const st=f.state(),groups=st.setor.map(s=>({sources:[{setorId:s.id,expectedRevision:s.qcRevision}],ukuran:JSON.parse(JSON.stringify(s.ukuran))}));assert.notEqual(st.setor[0].qcGroupKey,st.setor[1].qcGroupKey);
  const invalid=f.intent(groups);invalid.qc.kelompok[1].ukuran.L=91;noWrite(f,invalid,/tepat/);invalid.qc.kelompok[1].ukuran.L=92;const before=f.h.sheets.QC.writes;f.good('simpanQCGabungan',invalid);assert.equal(f.h.sheets.QC.writes,before+1);assert.equal(f.state().payroll.filter(r=>r.jenis==='jahit').reduce((n,r)=>n+r.total*r.rate,0),60*2000+92*3000);
});

test('a persisted write with a lost response replays after a fresh request without duplicating warehouse or payroll',()=>{
  const f=fixture(),input=f.intent(),sheet=f.h.sheets.QC,get=sheet.getRange.bind(sheet);let thrown=false;
  sheet.getRange=(...args)=>{const range=get(...args),set=range.setValues.bind(range);range.setValues=rows=>{const r=set(rows);if(args[0]>1&&!thrown){thrown=true;throw Error('synthetic response lost after QC persisted');}return r;};return range;};
  const fail=f.call('simpanQCGabungan',input);assert.equal(fail.ok,false);assert.equal(fail.uncertain,true);sheet.getRange=get;const writes=sheet.writes;assert.equal(f.rows('QC').length,2);
  assert.equal(data(f.good('simpanQCGabungan',input)).records.length,2);assert.equal(sheet.writes,writes);const st=f.state();assert.equal(st.warehouse.reduce((n,r)=>n+r.total,0),152);assert.equal(st.payroll.filter(r=>r.jenis==='jahit').reduce((n,r)=>n+r.total,0),152);
});

test('worker roles, stale clients, old workflow and recovery status are rejected before a QC batch write',()=>{
  const f=fixture(),input=f.intent();noWrite(f,{...input,token:'sewer-session-123456789'},/Hanya QC/);const old=noWrite(f,{...input,clientVersion:'0.0.1'},/Versi aplikasi/);assert.equal(old.updateRequired,true);noWrite(f,{...input,workflowVersion:1},/Versi alur/);
  f.h.cold();f.h.run("pkStore_().lock(function(){pkStore_().setSettings({legacyMigrationStatus:{batchId:'pending'}});});true");noWrite(f,input,/Pemulihan riwayat/);
});

test('paid source credit and an immutable payment receipt never move to another source after combined QC and repair',()=>{
  const f=fixture(),st=f.state(),items=st.payroll.filter(r=>r.sourceId==='count002'),proof={};items.forEach(r=>proof[r.id]=r.revision);
  f.good('createUpah',{upah:{id:'payment-old1',pegawaiId:'sewer001',itemIds:items.map(r=>r.id),expectedRevisions:proof,tanggal:'2026-10-07'}});
  const receipt=JSON.stringify(f.rows('SlipUpah')),beforeSources=JSON.stringify(f.rows('SlipSetor')),input=f.intent();input.qc.kelompok[0].ukuran={M:10,L:120};input.qc.kelompok[0].perbaikanUkuran={L:22};const out=data(f.good('simpanQCGabungan',input));
  let earned=f.state().payroll.filter(r=>r.jenis==='jahit');assert.equal(earned.filter(r=>r.sourceId==='count001').reduce((n,r)=>n+r.available,0),60);assert.equal(earned.filter(r=>r.sourceId==='count002').reduce((n,r)=>n+r.available,0),0);assert.equal(earned.filter(r=>r.sourceId==='count002').reduce((n,r)=>n+r.overpaidQty,0),22);
  const base=f.state().qc.find(r=>r.id===out.records[1].id);f.good('simpanQCGabungan',{qc:{id:'repair-paid-01',poId:'po000001',tanggal:'2026-10-10',kelompok:[{sources:[{repairQcId:base.id,expectedRevision:base.qcRevision}],ukuran:{L:22}}]}});
  earned=f.state().payroll.filter(r=>r.jenis==='jahit');assert.equal(earned.filter(r=>r.sourceId==='count002').reduce((n,r)=>n+r.available,0),0);assert.equal(earned.filter(r=>r.sourceId==='count001').reduce((n,r)=>n+r.available,0),60);assert.equal(JSON.stringify(f.rows('SlipUpah')),receipt);assert.equal(JSON.stringify(f.rows('SlipSetor')),beforeSources);
});

test('ambiguous baseline QC cannot be inspected through a batch even when another selected source is valid',()=>{
  const f=fixture(),provenance=field=>JSON.stringify({baseline:true,skuId:'old-sku',siklus:'old-cycle',entryId:field+'-1',field});f.change('PO','po000001',{asal:'lama'});f.change('SlipSetor','count002',{asal:'lama',workflowVersion:1,imporSumber:provenance('hitungFisik')});
  f.h.cold();f.h.run(`pkStore_().lock(function(){pkStore_().append('QC',{id:'old-qc-01',poId:'po000001',maklonId:'sewer001',tanggal:'2026-10-07',ukuran:'{"L":10}',total:10,upah:2000,workflowVersion:1,imporSumber:${JSON.stringify(provenance('qc'))}});});true`);
  noWrite(f,f.intent(),/hubungan pasti/);
});

test('several workers can be checked in a single PO submission only as separate source-preserving groups',()=>{
  const f=fixture();f.change('SlipSetor','count002',{maklonId:'sewer002'});f.change('SlipKirim','send0001',{ukuran:'{"M":10,"L":50}',total:60});f.h.cold();f.h.run(`pkStore_().lock(function(){pkStore_().append('SlipKirim',{id:'send0002',poId:'po000001',maklonId:'sewer002',tanggal:'2026-10-02',ukuran:'{"L":92}',total:92,upah:2000});});true`);
  const st=f.state(),groups=st.setor.map(s=>({sources:[{setorId:s.id,expectedRevision:s.qcRevision}],ukuran:s.ukuran})),input=f.intent(groups),before=f.h.sheets.QC.writes;const out=data(f.good('simpanQCGabungan',input));assert.equal(f.h.sheets.QC.writes,before+1);assert.deepEqual(out.records.map(q=>q.maklonId),['sewer001','sewer002']);const pay=f.state().payroll.filter(r=>r.jenis==='jahit');assert.equal(pay.filter(r=>r.pegawaiId==='sewer001').reduce((n,r)=>n+r.total,0),60);assert.equal(pay.filter(r=>r.pegawaiId==='sewer002').reduce((n,r)=>n+r.total,0),92);
});

test('linked legacy repair groups use the original QC tariff, not the different physical-count tariff',()=>{
  const f=fixture();f.change('PO','po000001',{asal:'lama'});f.h.cold();
  f.h.run(`pkStore_().lock(function(){pkStore_().appendMany('QC',[
    {id:'legacy-qc-a',poId:'po000001',maklonId:'sewer001',setorId:'count001',tanggal:'2026-10-07',ukuran:'{"M":10,"L":40}',total:50,perbaikan:10,perbaikanUkuran:'{"L":10}',upah:2500,workflowVersion:1,imporSumber:'{"baseline":true,"skuId":"sku-a","siklus":"cycle-a","entryId":"qc-a","field":"qc"}'},
    {id:'legacy-qc-b',poId:'po000001',maklonId:'sewer001',setorId:'count002',tanggal:'2026-10-07',ukuran:'{"L":82}',total:82,perbaikan:10,perbaikanUkuran:'{"L":10}',upah:3000,workflowVersion:1,imporSumber:'{"baseline":true,"skuId":"sku-a","siklus":"cycle-a","entryId":"qc-b","field":"qc"}'}
  ]);});true`);
  const st=f.state();assert.notEqual(st.qc[0].qcGroupKey,st.qc[1].qcGroupKey);const refs=st.qc.map(q=>({repairQcId:q.id,expectedRevision:q.qcRevision}));
  noWrite(f,{qc:{id:'legacy-repair-1',poId:'po000001',tanggal:'2026-10-08',kelompok:[{sources:refs,ukuran:{L:20}}]}},/maklon dan tarif/);
  f.good('simpanQCGabungan',{qc:{id:'legacy-repair-1',poId:'po000001',tanggal:'2026-10-08',kelompok:refs.map(ref=>({sources:[ref],ukuran:{L:10}}))}});
  const rates=f.state().payroll.filter(r=>r.repairQcId).map(r=>r.rate).sort();assert.deepEqual(rates,[2500,3000]);
});

test('QC role gets representative groups and HMAC proofs, never accepted-receipt tariff fingerprints',()=>{
  const f=fixture();f.change('SlipSetor','count002',{upah:3000});
  const st=f.state('qc-session-1234567890'),sources=st.setor;
  assert.notEqual(sources[0].qcGroupKey,sources[1].qcGroupKey);
  for(const source of sources){
    assert.equal(source.upah,0);assert.equal(Object.hasOwn(source,'revision'),false);
    assert.match(source.qcGroupKey,/^qc-group:count:count00[12]$/);assert.match(source.qcRevision,/^qch1_[a-f0-9]{64}$/);
    const raw=f.rows('SlipSetor').find(r=>r.id===source.id);
    const guesses=f.h.run(`(function(){var r=${JSON.stringify(raw)},out=[];for(var rate=0;rate<=10000;rate++){r.upah=rate;if(coreQcSourceRevision(r,[],false)===${JSON.stringify(source.qcRevision)}||coreQcGroupKey(r,false,[])===${JSON.stringify(source.qcGroupKey)})out.push(rate);}return out;})()`);
    assert.deepEqual(guesses,[]);
  }
  assert.equal(JSON.stringify(st).includes(f.h.properties.qcRevisionSecret),false);
  assert.ok(f.state().setor.every(s=>s.revision),'owner still has receipt edit revision');
  f.change('SlipSetor','count002',{status:'diajukan',upah:0});
  assert.ok(f.state('qc-session-1234567890').setor.find(s=>s.id==='count002').revision,'pending physical count retains its acceptance proof');
});

test('HMAC proof survives cold requests and unrelated writes but rejects a changed source tariff',()=>{
  const f=fixture(),input=f.intent(),before=f.state().setor.map(s=>s.qcRevision),key=f.h.properties.qcRevisionSecret;
  f.change('Potong','cut00001',{catatan:'Unrelated note from another phone'});
  assert.deepEqual(f.state('qc-session-1234567890').setor.map(s=>s.qcRevision),before);
  assert.equal(f.h.properties.qcRevisionSecret,key);
  const modified=fixture(),old=modified.intent();modified.change('SlipSetor','count002',{upah:3000});noWrite(modified,old,/berubah sejak/);
  assert.equal(data(f.good('simpanQCGabungan',input)).records.length,2);
});

test('QC signing key creation double-checks under the store lock, supports nesting, and stays cached per request',()=>{
  const h=harness(),props=h.context.PropertiesService.getScriptProperties(),oldLock=h.context.LockService.getScriptLock;
  let generated=0;h.context.Utilities.getUuid=()=>{generated++;return 'unused-new-key';};
  h.context.LockService.getScriptLock=()=>{const lock=oldLock();return {waitLock(){lock.waitLock();props.setProperty('qcRevisionSecret','synthetic-key-from-competing-request');},releaseLock(){lock.releaseLock();}};};
  const first=client(h),signed=first.run(`var environment=pkEnv_(); environment.signQcRevision('same source')`);
  assert.equal(generated,0);assert.equal(h.events.filter(e=>e[0]==='lock').length,1);
  first.run(`environment.signQcRevision('another source')`);assert.equal(h.events.filter(e=>e[0]==='lock').length,1);
  assert.equal(client(h).run(`pkEnv_().signQcRevision('same source')`),signed);
  const nested=harness();assert.match(client(nested).run(`pkStore_().lock(function(){return pkEnv_().signQcRevision('nested');})`),/^qch1_[a-f0-9]{64}$/);assert.equal(nested.events.filter(e=>e[0]==='lock').length,1);
});

test('signing-key persistence failure blocks QC writes, and an uncertain persisted key is reused without rotation',()=>{
  for(const persistFirst of [false,true]){
    const f=fixture(),input=f.intent(),props=f.h.context.PropertiesService.getScriptProperties(),set=props.setProperty.bind(props),before=f.h.sheets.QC.writes;
    props.deleteProperty('qcRevisionSecret');
    props.setProperty=(name,value)=>{if(name==='qcRevisionSecret'){if(persistFirst)set(name,value);throw new Error('Synthetic secret property interruption');}return set(name,value);};
    const result=f.call('simpanQCGabungan',input);assert.equal(result.ok,false);assert.match(result.error,/secret property interruption/);assert.equal(f.h.sheets.QC.writes,before);assert.equal(f.h.isLocked(),false);
    const saved=f.h.properties.qcRevisionSecret;assert.equal(Boolean(saved),persistFirst);props.setProperty=set;
    f.state();assert.ok(f.h.properties.qcRevisionSecret);if(persistFirst)assert.equal(f.h.properties.qcRevisionSecret,saved);
  }
});

test('production core cannot silently emit unsigned QC proofs when paired with an older adapter',()=>{
  const f=fixture(),c=client(f.h);
  assert.throws(()=>c.run(`var noSigner=pkEnv_();delete noSigner.signQcRevision;createCore(pkStore_(),noSigner).handle('getState',{token:${JSON.stringify(f.token)},clientVersion:APP_VERSION})`),/Server perlu diperbarui/);
});

test('QC response hides assignment tariff fingerprints and legacy QC wages without changing signed source proofs',()=>{
  const f=fixture();f.h.cold();f.h.run(`pkStore_().lock(function(){pkStore_().append('QC',{
    id:'legacy-qc-money',poId:'po000001',maklonId:'sewer001',setorId:'count001',tanggal:'2026-10-07',ukuran:'{"M":10,"L":40}',total:50,perbaikan:10,perbaikanUkuran:'{"L":10}',upah:2500,upahId:'LAMA',workflowVersion:1,imporSumber:'{"baseline":true,"skuId":"sku-a","siklus":"cycle-a","entryId":"qc-a","field":"qc"}'
  });});true`);
  const owner=f.state(),qc=f.state('qc-session-1234567890'),visible=qc.qc.find(q=>q.id==='legacy-qc-money'),original=owner.qc.find(q=>q.id===visible.id);
  assert.equal(qc.kirim[0].upah,0);assert.equal(Object.hasOwn(qc.kirim[0],'revision'),false);
  assert.equal(visible.upah,0);assert.equal(visible.upahId,'x');assert.equal(original.upah,2500);assert.equal(original.upahId,'LAMA');
  assert.equal(visible.qcRevision,original.qcRevision);assert.equal(visible.qcGroupKey,original.qcGroupKey);assert.deepEqual(visible.ukuran,original.ukuran);assert.deepEqual(visible.perbaikanUkuran,original.perbaikanUkuran);
  assert.equal(f.rows('QC')[0].upah,2500);assert.equal(f.rows('QC')[0].upahId,'LAMA');
});

test('a repair proof binds its linked count snapshot, including a physical-sheet tariff change',()=>{
  const f=fixture(),input=f.intent();input.qc.kelompok[0].ukuran={M:10,L:132};input.qc.kelompok[0].perbaikanUkuran={L:10};
  const inspected=data(f.good('simpanQCGabungan',input)),base=f.state('qc-session-1234567890').qc.find(q=>q.id===inspected.records[1].id);
  const repair={token:'qc-session-1234567890',qc:{id:'repair-frozen-1',poId:'po000001',tanggal:'2026-10-10',kelompok:[{sources:[{repairQcId:base.id,expectedRevision:base.qcRevision}],ukuran:{L:10}}]}};
  // The ordinary app forbids repricing an inspected source. An announced
  // physical-sheet correction must nevertheless invalidate an open repair form.
  f.change('SlipSetor','count002',{upah:3500});
  noWrite(f,repair,/berubah sejak/);
  const refreshed=f.state('qc-session-1234567890').qc.find(q=>q.id===base.id);assert.notEqual(refreshed.qcRevision,base.qcRevision);
  repair.qc.kelompok[0].sources[0].expectedRevision=refreshed.qcRevision;
  assert.equal(data(f.good('simpanQCGabungan',repair)).records.length,1);
});
