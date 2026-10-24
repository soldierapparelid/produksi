const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
const code=['reconcile-legacy.js','history-corrections.js'].map(file=>fs.readFileSync(path.join(__dirname,'../src',file),'utf8')).join('\n');

function fixture(){
  const h=harness({PO:[['id','imporSumber','custom column']],Potong:[['id','tarif','custom column']],SlipKirim:[['id','upah','custom column']]});
  vm.runInContext(code,h.context);
  const setup=h.request('setupOwner',{nama:'Owner Example',pin:'1234'});assert.equal(setup.ok,true,setup.error);
  const token=setup.data.token;
  h.run(`pkStore_().lock(function(){
    pkStore_().append('Pegawai',{id:'sewerexample',nama:'Sewer Example',divisi:'jahit',aktif:true});
    var evidence={version:1,source:'verified-full-backup',snapshotHash:'b'.repeat(64),batchId:'examplebatch',sizes:[{skuId:'example-sku',cycle:JSON.stringify(['example-sku','current']),ukuran:'XL',hadCutAtImport:true}],plans:[]};
    evidence.proofHash=coreLegacyHash({poId:'poexample',snapshotHash:evidence.snapshotHash,batchId:evidence.batchId,sizes:evidence.sizes,plans:evidence.plans});
    pkStore_().append('PO',{id:'poexample',noPO:'PO-EXAMPLE',nama:'Example product',status:'aktif',asal:'lama',ukuran:'{}',total:0,imporSumber:JSON.stringify({legacyCutting:evidence})});
    pkStore_().append('Potong',{id:'example-oldcut',poId:'poexample',userId:'example-cutter',tanggal:'2026-01-01',ukuran:'{"XL":8}',total:8,tarif:100,asal:'lama'});
  });`);
  const call=(action,payload={})=>{h.cold();return h.request(action,{token,workflowVersion:2,...payload});};
  const good=(action,payload={})=>{const r=call(action,payload);assert.equal(r.ok,true,r.error);return r.data?.data??r.data;};
  const context=good('getMissingSizeCorrection',{poId:'poexample'});
  const proposal={poId:'poexample',id:'example-restore',size:'S',initialQty:12,maklonId:'sewerexample',reason:'Owner confirms missing initial work, returned awaiting count.',expectedSourceHash:context.sourceHash};
  return {h,call,good,proposal};
}

test('Sheets normalizes numeric blanks while keeping original source and the missing-size audit durable',()=>{
  const {h,good,proposal}=fixture();
  const before=h.run('JSON.stringify(pkStore_().read("Potong")[0])');
  const proof=h.run('JSON.parse(pkStore_().read("PO")[0].imporSumber).legacyCutting.proofHash');
  good('saveMissingSizeCorrection',proposal);
  const state=good('getState',{semua:true});
  assert.deepEqual(state.po[0].cutting.ukuran,['S','XL']);
  assert.equal(state.po[0].workflow.ukuran.S.diajukan,12);assert.equal(state.po[0].workflow.ukuran.S.diterima,0);
  assert.equal(state.payroll.filter(row=>row.sourceId.startsWith('example-restore')).length,0);
  assert.equal(good('saveMissingSizeCorrection',proposal).replayed,true);
  h.cold();assert.equal(h.run('JSON.stringify(pkStore_().read("Potong")[0])'),before);
  assert.equal(h.run('JSON.parse(pkStore_().read("PO")[0].imporSumber).legacyCutting.proofHash'),proof);
  assert.equal(h.run('pkStore_().read("Potong").length'),2);
  assert.equal(h.run('pkStore_().read("SlipKirim")[0].tanggal'),'');
  assert.equal(h.run('pkStore_().read("SlipSetor")[0].diprosesPada'),'');
  assert.equal(h.isLocked(),false);
});

test('a real adapter write interrupted after dispatch resumes from durable PO intent across cold requests',()=>{
  const {h,call,good,proposal}=fixture();
  h.run(`var originalStoreFactory=pkStore_, failOpeningDispatch=true;
    pkStore_=function(){var store=originalStoreFactory();if(!store.exampleWrapped){var append=store.append;store.append=function(table,row){append(table,row);if(table==='SlipKirim'&&row.asal==='koreksi-ukuran'&&failOpeningDispatch){failOpeningDispatch=false;throw new Error('example durable interruption');}};store.exampleWrapped=true;}return store;};true`);
  const failed=call('saveMissingSizeCorrection',proposal);assert.equal(failed.ok,false);assert.match(failed.error,/interruption/);
  const pending=good('getMissingSizeCorrection',{poId:'poexample'}).pending;
  assert.equal(pending.length,1);assert.equal(pending[0].expectedSourceHash,proposal.expectedSourceHash);
  const blocked=call('setStatusPO',{id:'poexample',status:'batal'});assert.equal(blocked.ok,false);assert.match(blocked.error,/Pemulihan ukuran/);
  good('saveMissingSizeCorrection',proposal);
  assert.equal(good('getMissingSizeCorrection',{poId:'poexample'}).pending.length,0);
  h.cold();assert.equal(h.run('pkStore_().read("Potong").length'),2);assert.equal(h.run('pkStore_().read("SlipKirim").length'),1);assert.equal(h.run('pkStore_().read("SlipSetor").length'),1);
  assert.equal(h.isLocked(),false);
});
