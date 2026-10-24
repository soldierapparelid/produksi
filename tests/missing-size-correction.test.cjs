const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = ['core.js','reconcile-legacy.js','history-corrections.js','auto-completion.js'].map(file => fs.readFileSync(path.join(__dirname,'../src',file),'utf8')).join('\n');

function app() {
  const context = vm.createContext({});
  vm.runInContext(source + `
    var db={},config={},version=1,failAt='',failAfter=false;
    Object.keys(SCHEMA).forEach(function(table){db[table]=[];});
    db.Pegawai=[{id:'owner01',nama:'Owner Example',divisi:'owner',aktif:true,token:'example-owner-token-123'},
      {id:'owner02',nama:'Other Owner',divisi:'owner',aktif:true,token:'example-other-token-123'},
      {id:'admin01',divisi:'admin',aktif:true,token:'example-admin-token-123'},
      {id:'sewer01',nama:'Sewer Example',divisi:'jahit',aktif:true,token:'example-sewer-token-123'}];
    var evidence={version:1,source:'verified-full-backup',snapshotHash:'a'.repeat(64),batchId:'examplebatch',sizes:[{skuId:'example-sku',cycle:JSON.stringify(['example-sku','current']),ukuran:'XL',hadCutAtImport:true}],plans:[]};
    evidence.proofHash=coreLegacyHash({poId:'poexample',snapshotHash:evidence.snapshotHash,batchId:evidence.batchId,sizes:evidence.sizes,plans:evidence.plans});
    db.PO=[{id:'poexample',noPO:'PO-EXAMPLE',nama:'Example garment',status:'aktif',asal:'lama',ukuran:'{}',total:0,imporSumber:JSON.stringify({legacyCutting:evidence,legacyReconciliation:{mode:'migrated'}})}];
    db.Potong=[{id:'oldcut01',poId:'poexample',userId:'cutter01',tanggal:'2026-01-01',ukuran:'{"XL":8}',total:8,tarif:100,kg:4,bahan:'Example fabric',asal:'lama',upahId:'paidold1'}];
    db.SlipKirim=[{id:'oldsend01',poId:'poexample',maklonId:'sewer01',tanggal:'2026-01-02',ukuran:'{"XL":8}',total:8,upah:700,dibuat:'2026-01-02',asal:'lama'}];
    db.SlipSetor=[{id:'oldreport1',poId:'poexample',maklonId:'sewer01',tanggal:'2026-01-03',ukuran:'{"XL":8}',total:8,reject:0,rejectUkuran:'{}',upah:700,status:'diterima',workflowVersion:2}];
    db.SlipUpah=[{id:'paidold1',jenis:'potong',pegawaiId:'cutter01',itemIds:'["oldcut01"]',totalQty:8,totalUpah:800,dibayar:800}];
    function trip(label,after){if(failAt===label&&failAfter===after){failAt='';throw new Error('simulated write interruption');}}
    var store={read:function(t){return db[t];},getSettings:function(){return config;},setSettings:function(s){config=s;},version:function(){return version;},lock:function(fn){return fn();},fresh:function(){},checkpoint:function(){},
      append:function(t,row){trip('append:'+t,false);db[t].push(row);version++;trip('append:'+t,true);},appendMany:function(t,rows){db[t]=db[t].concat(rows);version++;},
      update:function(t,id,patch){var label='update:'+t+(t==='PO'&&patch.imporSumber?':'+JSON.parse(patch.imporSumber).ownerSizeCorrections.slice(-1)[0].status:'');trip(label,false);Object.assign(db[t].find(function(r){return r.id===id;}),patch);version++;trip(label,true);},
      remove:function(t,id){db[t]=db[t].filter(function(r){return r.id!==id;});version++;},replaceAll:function(t,rows){db[t]=rows;version++;}};
    var core=createCore(store,{now:function(){return new Date('2026-02-01T03:00:00Z');},id:function(){return 'example-generated';}});
  `, context);
  const run = code => JSON.parse(JSON.stringify(vm.runInContext(code,context)));
  const call = (action,payload={},token='example-owner-token-123') => run(`core.handle(${JSON.stringify(action)},JSON.parse(${JSON.stringify(JSON.stringify({token,workflowVersion:2,...payload}))}))`);
  const preview = () => call('getMissingSizeCorrection',{poId:'poexample'});
  const proposal = (state=preview()) => ({poId:'poexample',id:'examplecorrection',size:'S',initialQty:12,maklonId:'sewer01',reason:'Initial work omitted from original record; returned awaiting count.',expectedSourceHash:state.sourceHash});
  return {run,call,preview,proposal};
}

test('owner restores a missing size as uncounted work while preserving original proof, stock and payroll', () => {
  const a=app(), before=a.run('JSON.stringify({po:db.PO[0],cut:db.Potong[0],send:db.SlipKirim[0],report:db.SlipSetor[0],pay:db.SlipUpah})');
  const beforeState=a.call('getState',{semua:true}), result=a.call('saveMissingSizeCorrection',a.proposal());
  assert.equal(result.data.poId,'poexample'); assert.equal(result.data.pending.length,0);
  const po=result.state.po[0], size=po.workflow.ukuran.S;
  assert.deepEqual(po.cutting.ukuran,['S','XL']); assert.deepEqual(po.cutting.pendingUkuran,[]);
  assert.equal(size.potong,12); assert.equal(size.kirim,12); assert.equal(size.diajukan,12);
  assert.equal(size.diterima,0); assert.equal(size.qcOk,0); assert.equal(size.readyQC,false); assert.equal(po.workflow.complete,false);
  assert.deepEqual(result.state.payroll,beforeState.payroll); assert.deepEqual(result.state.stokRingkas,beforeState.stokRingkas);
  assert.equal(a.run('JSON.stringify({po:Object.assign({},db.PO[0],{imporSumber:JSON.stringify((function(){var s=JSON.parse(db.PO[0].imporSumber);delete s.ownerSizeCorrections;return s;})())}),cut:db.Potong[0],send:db.SlipKirim[0],report:db.SlipSetor[0],pay:db.SlipUpah})'),before);
  const rows=a.run('[db.Potong[1],db.SlipKirim[1],db.SlipSetor[1]]');
  assert.ok(rows.every(row=>row.tanggal===''&&row.asal==='koreksi-ukuran'&&row.dibuat==='2026-02-01T03:00:00.000Z'));
  assert.equal(rows[0].userId,''); assert.equal(rows[0].kg,0); assert.equal(rows[0].upahId,'');
  assert.equal(rows[1].noSlip,''); assert.equal(rows[2].noSlip,''); assert.equal(rows[2].status,'diajukan'); assert.equal(rows[2].diprosesPada,'');
});

test('exact replay is durable and altered/stale/other-actor requests cannot duplicate restoration', () => {
  const a=app(), p=a.proposal(); a.call('saveMissingSizeCorrection',p);
  assert.equal(a.call('saveMissingSizeCorrection',p).data.replayed,true);
  for(const patch of [{initialQty:13},{reason:'different'},{size:'L'},{maklonId:'someone'}]) assert.throws(()=>a.call('saveMissingSizeCorrection',{...p,...patch}),/perubahan lain/);
  assert.throws(()=>a.call('saveMissingSizeCorrection',p,'example-other-token-123'),/perubahan lain/);
  assert.throws(()=>a.call('saveMissingSizeCorrection',{...p,id:'anothercorrection',size:'L'}),/berubah sejak/);
  assert.deepEqual(a.run('[db.Potong.length,db.SlipKirim.length,db.SlipSetor.length]'),[2,2,2]);
});

for(const stage of ['update:PO:preparing','append:Potong','append:SlipKirim','append:SlipSetor','update:PO:complete']) for(const after of [false,true]) {
  test(`retry after ${stage} ${after?'durable':'before'} interruption completes exactly once`,()=>{
    const a=app(),p=a.proposal(); a.run(`failAt=${JSON.stringify(stage)};failAfter=${after};true`);
    assert.throws(()=>a.call('saveMissingSizeCorrection',p),/interruption/);
    const pending=a.preview().pending;
    if(pending.length) {
      assert.equal(pending[0].expectedSourceHash,p.expectedSourceHash);
      assert.throws(()=>a.call('createKirim',{kirim:{id:'newdispatch',poId:'poexample',maklonId:'sewer01',ukuran:{S:1}}}),/Pemulihan ukuran/);
      assert.throws(()=>a.call('setStatusPO',{id:'poexample',status:'batal'}),/Pemulihan ukuran/);
      assert.throws(()=>a.call('ubahTargetJahit',{poId:'poexample',maklonId:'sewer01',target:'2026-02-08'}),/Pemulihan ukuran/);
      assert.throws(()=>a.call('ubahHarga',{sheet:'SlipSetor',id:'oldreport1',harga:800}),/Pemulihan ukuran/);
      assert.throws(()=>a.call('lepasUkuranPotong',{poId:'poexample',ukuran:['S'],lepas:false}),/Pemulihan ukuran/);
    }
    a.call('saveMissingSizeCorrection',p);
    assert.equal(a.preview().pending.length,0);
    assert.deepEqual(a.run('[db.Potong.length,db.SlipKirim.length,db.SlipSetor.length]'),[2,2,2]);
  });
}

test('a pending restoration rejects tampered physical rows instead of silently overwriting them',()=>{
  const a=app(),p=a.proposal();a.run("failAt='append:SlipKirim';failAfter=false;true");assert.throws(()=>a.call('saveMissingSizeCorrection',p),/interruption/);
  a.run('db.Potong[1].total=99;true');assert.throws(()=>a.call('saveMissingSizeCorrection',p),/sudah berubah/);
  assert.equal(a.preview().pending.length,1);assert.equal(a.run('db.Potong[1].total'),99);
});

test('invalid facts, existing sizes, nonowners and pending migrations cannot create an intent',()=>{
  const a=app(),p=a.proposal();
  for(const initialQty of [0,-1,1.5,'',null,true,1000000001]) assert.throws(()=>a.call('saveMissingSizeCorrection',{...p,initialQty}),/Jumlah awal/);
  for(const size of ['XL','constructor','unknown']) assert.throws(()=>a.call('saveMissingSizeCorrection',{...p,size}),/benar-benar/);
  assert.throws(()=>a.call('saveMissingSizeCorrection',{...p,maklonId:'admin01'}),/penjahit aktif/);
  assert.throws(()=>a.call('saveMissingSizeCorrection',{...p,reason:''}),/alasan/);
  for(const token of ['example-admin-token-123','example-sewer-token-123']) {
    assert.throws(()=>a.call('getMissingSizeCorrection',{poId:'poexample'},token),/Hanya owner/);
    assert.throws(()=>a.call('saveMissingSizeCorrection',p,token),/Hanya owner/);
  }
  assert.throws(()=>a.call('saveMissingSizeCorrection',{...p,workflowVersion:1}),/Versi alur/);
  a.run("config.legacyMigrationStatus={batchId:'example-pending'};true");
  assert.throws(()=>a.preview(),/Pemulihan riwayat/);assert.throws(()=>a.call('saveMissingSizeCorrection',p),/Pemulihan riwayat/);
  assert.equal(a.run('coreMissingSizeEntries(db.PO[0]).length'),0);
});

test('an existing production size is not missing even when absent from the PO and original size proof',()=>{
  const a=app(); a.run("db.Potong.push({id:'existingS',poId:'poexample',ukuran:'{\"S\":1}',total:1});true");
  assert.ok(a.preview().existingSizes.includes('S')); assert.ok(!a.preview().availableSizes.includes('S'));
  assert.throws(()=>a.call('saveMissingSizeCorrection',a.proposal()),/benar-benar/);
});

test('prepared sizes and invalid proof input are rejected before creating durable intent',()=>{
  const a=app(), p=a.proposal();
  assert.throws(()=>a.call('saveMissingSizeCorrection',{...p,id:'__proto__'}),/Bukti pemulihan/);
  a.run("config.ukuran=['XL','S','Z'.repeat(41)];true");
  assert.throws(()=>a.call('saveMissingSizeCorrection',{...a.proposal(),size:'Z'.repeat(41)}),/Bukti pemulihan/);
  assert.equal(a.run('coreMissingSizeEntries(db.PO[0]).length'),0);
  assert.deepEqual(a.run('[db.Potong.length,db.SlipKirim.length,db.SlipSetor.length]'),[1,1,1]);
  a.run("db.RencanaPotong.push({id:'preparedsize',poId:'poexample',status:'siap',alokasiBahan:'[{\"stokId\":\"example-roll\",\"qty\":3,\"ukuran\":\"S\"}]'});true");
  assert.ok(a.preview().existingSizes.includes('S'));
  assert.throws(()=>a.call('saveMissingSizeCorrection',a.proposal()),/benar-benar/);
});

test('restored pending receipt can be counted partially without losing remaining work or changing old payroll',()=>{
  const a=app();a.call('saveMissingSizeCorrection',a.proposal());
  const counted=a.call('prosesSetor',{id:'examplecorrection_report',keputusan:'terima',ukuran:{S:5},rejectUkuran:{S:1},reject:1,tanggal:'2026-02-01',upah:900});
  assert.equal(counted.state.po[0].workflow.ukuran.S.diterima,5); assert.equal(counted.state.po[0].workflow.ukuran.S.rejectJahit,1); assert.equal(counted.state.po[0].workflow.ukuran.S.diajukan,6);
  assert.equal(counted.state.po[0].workflow.ukuran.S.qcOk,0);
  const residual=a.run("db.SlipSetor.find(function(row){return row.asal==='koreksi-ukuran'&&row.status==='diajukan';})");
  assert.equal(residual.total,6); assert.equal(residual.tanggal,''); assert.equal(residual.noSlip,'');
  a.call('prosesSetor',{id:residual.id,keputusan:'terima',ukuran:{S:6},reject:0,rejectUkuran:{},tanggal:'2026-02-01',upah:900});
  assert.equal(a.call('getState').po[0].workflow.ukuran.S.diajukan,0);
  assert.equal(a.run('db.SlipUpah[0].totalUpah'),800); assert.equal(a.run('db.SlipSetor[0].upah'),700);
});

test('opening history cannot be deleted or repriced and original proof remains independently validated',()=>{
  const a=app();a.call('saveMissingSizeCorrection',a.proposal());
  for(const [sheet,id] of [['Potong','examplecorrection_cut'],['SlipKirim','examplecorrection_send'],['SlipSetor','examplecorrection_report']]) assert.throws(()=>a.call('deleteRecord',{sheet,id}),/tidak dapat dihapus/);
  assert.throws(()=>a.call('ubahHarga',{sheet:'Potong',id:'examplecorrection_cut',harga:200}),/belum diketahui/);
  a.run("var src=JSON.parse(db.PO[0].imporSumber);src.legacyCutting.proofHash='broken';db.PO[0].imporSumber=JSON.stringify(src);true");
  assert.throws(()=>a.preview(),/Bukti ukuran potong/); assert.equal(a.run('coreEffectiveCuttingEvidence(db.PO[0]).valid'),false);
});

test('undoing and recounting a restored partial count preserves earlier residuals and resets unverified reject classification',()=>{
  const a=app();a.call('saveMissingSizeCorrection',a.proposal());
  a.call('prosesSetor',{id:'examplecorrection_report',ukuran:{S:5},rejectUkuran:{S:1},reject:1,tanggal:'2026-02-01',upah:900});
  const residual=a.run("db.SlipSetor.find(function(row){return row.asal==='koreksi-ukuran'&&row.status==='diajukan';}).id");
  const undone=a.call('batalHitungSetor',{id:'examplecorrection_report'});
  assert.equal(undone.state.po[0].workflow.ukuran.S.diajukan,12);assert.equal(undone.state.po[0].workflow.ukuran.S.diterima,0);assert.equal(undone.state.po[0].workflow.ukuran.S.rejectJahit,0);
  assert.equal(undone.data.tanggal,'');assert.equal(undone.data.total,6);assert.deepEqual(JSON.parse(undone.data.rejectUkuran),{});
  a.call('prosesSetor',{id:'examplecorrection_report',ukuran:{S:4},rejectUkuran:{},reject:0,tanggal:'2026-02-01',upah:900});
  assert.equal(a.run(`db.SlipSetor.find(function(row){return row.id===${JSON.stringify(residual)};}).total`),6);
  const state=a.call('getState');assert.equal(state.po[0].workflow.ukuran.S.diterima,4);assert.equal(state.po[0].workflow.ukuran.S.diajukan,8);
  a.run("db.QC.push({id:'exampleqc',setorId:'examplecorrection_report',poId:'poexample',maklonId:'sewer01',ukuran:'{\"S\":4}',total:4});true");
  assert.throws(()=>a.call('batalHitungSetor',{id:'examplecorrection_report'}),/di-QC/);
});

test('undo restores reject-only counted quantity while retaining provenance and paid-count protections',()=>{
  const a=app();a.call('saveMissingSizeCorrection',a.proposal());
  a.call('prosesSetor',{id:'examplecorrection_report',ukuran:{},rejectUkuran:{S:12},reject:12,tanggal:'2026-02-01',upah:900});
  const undone=a.call('batalHitungSetor',{id:'examplecorrection_report'});
  assert.equal(undone.data.total,12); assert.deepEqual(JSON.parse(undone.data.ukuran),{S:12}); assert.equal(undone.data.reject,0);
  assert.equal(JSON.parse(undone.data.imporSumber).ownerSizeCorrection,'examplecorrection');
  a.call('prosesSetor',{id:'examplecorrection_report',ukuran:{S:12},rejectUkuran:{},reject:0,tanggal:'2026-02-01',upah:900});
  a.run("db.SlipSetor.find(function(row){return row.id==='examplecorrection_report';}).upahId='examplepaid';true");
  assert.throws(()=>a.call('batalHitungSetor',{id:'examplecorrection_report'}),/pembayaran upah/);
});

test('counting restored work does not assume a historical wage from another size',()=>{
  const a=app();a.call('saveMissingSizeCorrection',a.proposal());
  const result=a.call('prosesSetor',{id:'examplecorrection_report',ukuran:{S:12},rejectUkuran:{},reject:0,tanggal:'2026-02-01'});
  assert.equal(result.data.upah,0); assert.equal(a.run('db.SlipSetor[0].upah'),700);
  a.call('ubahHarga',{sheet:'SlipSetor',id:'examplecorrection_report',harga:900});
  assert.equal(a.run("db.SlipSetor.find(function(row){return row.id==='examplecorrection_report';}).upah"),900);
});
