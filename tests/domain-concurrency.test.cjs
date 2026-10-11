'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
 const c=vm.createContext({});
 vm.runInContext(['core.js','cutting-plans.js'].map(n=>fs.readFileSync(path.resolve(__dirname,'../src',n),'utf8')).join('\n')+`
 var db={},serial=0,version=1,locks=0,config={},failImage=false;
 Object.keys(SCHEMA).forEach(function(s){db[s]=[];});
 db.Pegawai=[{id:'owner01',nama:'Owner A',divisi:'owner',aktif:true,token:'owner-token-111111111'},{id:'owner02',nama:'Owner B',divisi:'owner',aktif:true,token:'owner-token-222222222'},{id:'worker1',nama:'Jahit',divisi:'jahit',aktif:true,token:'worker-token-1111111'},{id:'cutter1',nama:'Potong',divisi:'potong',aktif:true,token:'cutter-token-1111111'}];
 db.PO=[{id:'po00001',noPO:'PO-001',nama:'KAOS',jenis:'stok',status:'aktif',asal:'lama',ukuran:'{"M":100}',total:100}];
 db.Potong=[{id:'cutseed',poId:'po00001',userId:'cutter1',tanggal:'2026-10-08',ukuran:'{"M":100}',total:100,tarif:500}];
 var store={read:function(s){return db[s]||[];},fresh:function(){},getSettings:function(){return config;},setSettings:function(s){config=s;version++;},version:function(){return version;},lock:function(fn){locks++;return fn();},
 append:function(s,r){if(s==='Gambar'&&failImage){failImage=false;throw new Error('Image write interrupted');}db[s].push(r);version++;},appendMany:function(s,r){db[s]=db[s].concat(r);version++;},
 update:function(s,id,p){Object.assign(db[s].find(function(r){return r.id===id;}),p);version++;},remove:function(s,id){db[s]=db[s].filter(function(r){return r.id!==id;});version++;},replaceAll:function(s,r){db[s]=r;version++;}};
 var core=createCore(store,{enforceClientVersion:true,now:function(){return new Date('2026-10-11T08:00:00Z');},id:function(){return 'generated'+(++serial);}});
 `,c);
 const run=code=>vm.runInContext(code,c),plain=v=>JSON.parse(JSON.stringify(v));
 function call(action,p={},token='owner-token-111111111'){c.req={token,workflowVersion:2,clientVersion:run('APP_VERSION'),...p};return plain(run(`core.handle(${JSON.stringify(action)},JSON.parse(JSON.stringify(req)))`));}
 function state(){return call('getState');}
 function raw(t){return plain(run(`db[${JSON.stringify(t)}]`));}
 function rev(t,id){return run(`coreDomainRevision(${JSON.stringify(t)},db[${JSON.stringify(t)}].find(function(r){return r.id===${JSON.stringify(id)};}))`);}
 function assign(id='send001',qty=100){return call('createKirim',{kirim:{id,poId:'po00001',maklonId:'worker1',tanggal:'2026-10-08',ukuran:{M:qty},upah:2000}}).data;}
 function count(id='count01',qty=100){return call('createSetor',{setor:{id,poId:'po00001',maklonId:'worker1',tanggal:'2026-10-09',ukuran:{M:qty}}}).data;}
 function payroll(worker){const rows=state().payroll.filter(r=>r.pegawaiId===worker);return {itemIds:rows.map(r=>r.id),expectedRevisions:Object.fromEntries(rows.map(r=>[r.id,r.revision]))};}
 return {c,run,plain,call,state,raw,rev,assign,count,payroll};
}

test('production version admission rejects obsolete business writes before locks, but keeps login and reads usable',()=>{
 const a=fixture(),before=a.raw('PO'),locks=a.run('locks');
 for(const action of ['savePO','setStatusPO','saveStok','createUpah','changePin','setupOwner']){
   assert.throws(()=>a.call(action,{clientVersion:'old'}),e=>e.updateRequired===true&&e.appVersion===a.run('APP_VERSION')&&/Muat ulang/.test(e.message));
 }
 assert.equal(a.run('locks'),locks);assert.deepEqual(a.raw('PO'),before);assert.ok(a.call('getState',{clientVersion:'old'}).po);
 assert.throws(()=>a.call('notAnAction',{clientVersion:'old'}),/tidak dikenal/);
 assert.throws(()=>a.call('login',{id:'missing',pin:'1234',clientVersion:'old'}),e=>!e.updateRequired);
});

test('two stale PO edit forms cannot overwrite each other; exact lost-response replay writes nothing twice',()=>{
 const a=fixture(),snapshot=a.state().po[0];assert.ok(snapshot.revision);
 const p={expectedRevision:snapshot.revision,po:{...snapshot,catatan:'Saved on phone A'}};
 a.call('savePO',p);const version=a.run('version'),saved=a.raw('PO');a.call('savePO',p);assert.equal(a.run('version'),version);assert.deepEqual(a.raw('PO'),saved);
 assert.throws(()=>a.call('savePO',{...p,po:{...snapshot,catatan:'Stale phone B'}},'owner-token-222222222'),/berubah/);assert.deepEqual(a.raw('PO'),saved);
 assert.throws(()=>a.call('savePO',{po:{...snapshot,catatan:'Missing revision'}}),/versi data/);
});

test('a partially failed image edit resumes the same intent, but a newer photo cannot be overwritten by that replay',()=>{
 const a=fixture(),snapshot=a.state().po[0],p={expectedRevision:snapshot.revision,po:{...snapshot,catatan:'With design'},gambarData:'data:image/png;base64,AAAA'};
 a.run('failImage=true');assert.throws(()=>a.call('savePO',p),/interrupted/);assert.equal(a.raw('PO')[0].catatan,'With design');
 a.call('savePO',p);assert.equal(a.raw('Gambar')[0].data,p.gambarData);const writes=a.run('version');a.call('savePO',p);assert.equal(a.run('version'),writes);
 a.run("db.PO[0].gambar='newer-image';db.Gambar[0].data='data:image/png;base64,BBBB';");assert.throws(()=>a.call('savePO',p),/Gambar PO sudah berubah/);assert.equal(a.raw('Gambar')[0].data,'data:image/png;base64,BBBB');
});

test('PO status changes use captured revision and do not reopen a newer cancellation from a stale phone',()=>{
 const a=fixture(),revision=a.state().po[0].revision,p={id:'po00001',status:'batal',expectedRevision:revision};a.call('setStatusPO',p);const version=a.run('version');a.call('setStatusPO',p);assert.equal(a.run('version'),version);
 assert.throws(()=>a.call('setStatusPO',{id:'po00001',status:'aktif',expectedRevision:revision},'owner-token-222222222'),/berubah/);assert.equal(a.raw('PO')[0].status,'batal');
});

test('stock edits reject stale quantities and recognize the same exact retry',()=>{
 const a=fixture(),stock={id:'stock01',baru:true,jenis:'beli',bahan:'Katun',qty:10,satuan:'kg',rol:1,harga:1000,tanggal:'2026-10-08'};a.call('saveStok',{stok:stock});const row=a.state().stok[0];
 const p={expectedRevision:row.revision,stok:{...row,qty:12,total:12000}};a.call('saveStok',p);const stored=a.raw('StokBahan'),writes=a.run('version');a.call('saveStok',p);assert.equal(a.run('version'),writes);
 assert.throws(()=>a.call('saveStok',{expectedRevision:row.revision,stok:{...row,qty:8,total:8000}},'owner-token-222222222'),/berubah/);assert.deepEqual(a.raw('StokBahan'),stored);
});

test('wage-rate editing is revision checked and the prior rate cannot be restored by a stale form',()=>{
 const a=fixture(),revision=a.state().potong[0].revision,p={sheet:'Potong',id:'cutseed',harga:700,expectedRevision:revision};a.call('ubahHarga',p);const writes=a.run('version');a.call('ubahHarga',p);assert.equal(a.run('version'),writes);
 assert.throws(()=>a.call('ubahHarga',{...p,harga:900},'owner-token-222222222'),/berubah/);assert.equal(a.raw('Potong')[0].tarif,700);
});

test('sewing-target edits cover every assignment revision before touching any row and retry safely',()=>{
 const a=fixture();a.assign('send001',40);a.assign('send002',60);const rows=a.state().kirim,expectedRevisions=Object.fromEntries(rows.map(r=>[r.id,r.revision])),p={poId:'po00001',maklonId:'worker1',target:'2026-10-20',expectedRevisions};
 a.call('ubahTargetJahit',p);const saved=a.raw('SlipKirim'),writes=a.run('version');a.call('ubahTargetJahit',p);assert.equal(a.run('version'),writes);
 assert.throws(()=>a.call('ubahTargetJahit',{...p,target:'2026-10-15'},'owner-token-222222222'),/berubah/);assert.deepEqual(a.raw('SlipKirim'),saved);
});

test('physical acceptance binds decision, date and quantity; a changed retry never pretends to accept the new count',()=>{
 const a=fixture();a.assign();a.call('createSetor',{setor:{id:'report01',poId:'po00001',ukuran:{M:100},tanggal:'2026-10-09'}},'worker-token-1111111');const row=a.state().setor[0],p={id:row.id,keputusan:'terima',ukuran:{M:90},tanggal:'2026-10-10',expectedRevision:row.revision};
 a.call('prosesSetor',p);const saved=a.raw('SlipSetor'),writes=a.run('version');a.call('prosesSetor',p);assert.equal(a.run('version'),writes);
 assert.throws(()=>a.call('prosesSetor',{...p,ukuran:{M:100}}),/sudah diproses/);assert.throws(()=>a.call('prosesSetor',{...p,keputusan:'tolak'}),/sudah diproses/);assert.deepEqual(a.raw('SlipSetor'),saved);
});

test('new record IDs are bound to request content and author across production and payroll',()=>{
 for(const kind of ['cut','assignment','count','qc','payment','stock']){
   const a=fixture();let action,body,key,table;
   if(kind==='cut'){action='createPotong';key='potong';table='Potong';body={id:'newcut1',poId:'po00001',userId:'cutter1',tanggal:'2026-10-09',ukuran:{M:5},tarif:500};}
   if(kind==='assignment'){action='createKirim';key='kirim';table='SlipKirim';body={id:'send001',poId:'po00001',maklonId:'worker1',tanggal:'2026-10-08',ukuran:{M:50},upah:2000};}
   if(kind==='count'||kind==='qc'||kind==='payment')a.assign();
   if(kind==='count'){action='createSetor';key='setor';table='SlipSetor';body={id:'count01',poId:'po00001',maklonId:'worker1',tanggal:'2026-10-09',ukuran:{M:50}};}
   if(kind==='qc'||kind==='payment')a.count();
   if(kind==='qc'){action='createQC';key='qc';table='QC';body={id:'qc00001',poId:'po00001',setorId:'count01',tanggal:'2026-10-10',ukuran:{M:100}};}
   if(kind==='payment'){action='createUpah';key='upah';table='SlipUpah';body={id:'pay0001',pegawaiId:'worker1',...a.payroll('worker1'),tanggal:'2026-10-10',potongan:0};}
   if(kind==='stock'){action='saveStok';key='stok';table='StokBahan';body={id:'stock01',baru:true,jenis:'beli',bahan:'Katun',qty:10,satuan:'kg',rol:1,harga:1000,tanggal:'2026-10-08'};}
   const p={[key]:body};a.call(action,p);const saved=a.raw(table),writes=a.run('version');a.call(action,p);assert.deepEqual(a.raw(table),saved,kind);assert.equal(a.run('version'),writes,kind);
   assert.throws(()=>a.call(action,{[key]:{...body,catatan:'Different request'}}),/permintaan berbeda/,kind);assert.throws(()=>a.call(action,p,'owner-token-222222222'),/permintaan berbeda/,kind);
   assert.deepEqual(a.raw(table),saved,kind);
 }
});

test('different IDs from stale screens cannot overassign, inspect twice, or pay the same earned work twice',()=>{
 const a=fixture();a.assign('send001',70);assert.throws(()=>a.assign('send002',70),/melebihi/);a.assign('send003',30);a.count();
 const q={poId:'po00001',setorId:'count01',tanggal:'2026-10-10',ukuran:{M:100}};a.call('createQC',{qc:{id:'qc00001',...q}});assert.throws(()=>a.call('createQC',{qc:{id:'qc00002',...q}}),/sudah di-QC/);
 const u={pegawaiId:'worker1',...a.payroll('worker1'),tanggal:'2026-10-10'};a.call('createUpah',{upah:{id:'pay0001',...u}});assert.throws(()=>a.call('createUpah',{upah:{id:'pay0002',...u}}),/upah berubah/);assert.equal(a.raw('SlipUpah').length,1);
});

test('a payroll form cannot silently pay a newer rate or newer QC eligible quantity',()=>{
 const a=fixture(),cutPreview=a.payroll('cutter1');
 a.call('ubahHarga',{sheet:'Potong',id:'cutseed',harga:700,expectedRevision:a.state().potong[0].revision});
 assert.throws(()=>a.call('createUpah',{upah:{id:'paycut1',pegawaiId:'cutter1',...cutPreview,tanggal:'2026-10-11'}}),/upah berubah/);
 assert.equal(a.raw('SlipUpah').length,0);
 a.assign();a.count();const countPreview=a.payroll('worker1');
 a.call('createQC',{qc:{id:'qc00001',poId:'po00001',setorId:'count01',tanggal:'2026-10-10',ukuran:{M:90},perbaikanUkuran:{M:10}}});
 assert.throws(()=>a.call('createUpah',{upah:{id:'paysew1',pegawaiId:'worker1',...countPreview,tanggal:'2026-10-11'}}),/upah berubah/);
 assert.equal(a.raw('SlipUpah').length,0);
 a.call('createUpah',{upah:{id:'paysew2',pegawaiId:'worker1',...a.payroll('worker1'),tanggal:'2026-10-11'}});
 assert.equal(a.raw('SlipUpah')[0].totalQty,90);
});

test('remaining master and attendance overwrites require a form version and refuse old snapshots or lost-response resubmission',()=>{
 const a=fixture(),version=a.state().ver;
 const settings={settings:{namaUsaha:'Current business'},expectedVersion:version};
 assert.throws(()=>a.call('saveSettings',{settings:{namaUsaha:'Missing proof'}}),/versi data/);
 a.call('saveSettings',settings);const saved=a.run('JSON.stringify(config)'),writes=a.run('version');
 for(const action of ['saveSettings','saveUser','saveProduk','saveGambar','saveKaryawan','saveGaji','lunasGaji','hapusGaji','ubahKasbon','cocokkanStok','tandaiLunas','deleteRecord','arsipPO','buangPO','mulaiDariNol','lepasUkuranPotong','ubahRinciRol']) {
   assert.throws(()=>a.call(action,{expectedVersion:version}),/berubah/,action);
 }
 assert.throws(()=>a.call('saveSettings',settings),/berubah/);assert.equal(a.run('JSON.stringify(config)'),saved);assert.equal(a.run('version'),writes);
 assert.throws(()=>a.call('saveSettings',{...settings,expectedVersion:version},'invalid-token-111111111'),/masuk|sesi/i);
});

test('weekly attendance cannot overwrite another phone edits; refresh permits a deliberate revision',()=>{
 const a=fixture();a.call('saveKaryawan',{expectedVersion:a.state().ver,karyawan:{id:'staff001',baru:true,nama:'Staff',gajiHarian:100000}});
 const version=a.state().ver,period='2026-W41',original={periode:period,expectedVersion:version,baris:[{karyawanId:'staff001',hari:{'2026-10-05':'full'},lemburJam:2}]};
 a.call('saveGaji',original);const saved=a.raw('GajiHarian');assert.ok(saved.length);
 assert.throws(()=>a.call('saveGaji',{...original,baris:[{karyawanId:'staff001',hari:{'2026-10-05':'off'},lemburJam:0}]},'owner-token-222222222'),/berubah/);
 assert.deepEqual(a.raw('GajiHarian'),saved);
 a.call('saveGaji',{...original,expectedVersion:a.state().ver,baris:[{karyawanId:'staff001',hari:{'2026-10-05':'off'},lemburJam:0}]});
 assert.equal(a.raw('GajiHarian').find(r=>r.tanggal==='2026-10-05').status,'off');
});

test('loan and repayment IDs bind amount and author while exact retries write once',()=>{
 const a=fixture(),loan={id:'loan001',jenis:'maklon',orangId:'worker1',jumlah:100000,tanggal:'2026-10-11'};
 a.call('createKasbon',{kasbon:loan});a.call('createKasbon',{kasbon:loan});assert.equal(a.raw('Kasbon').length,1);
 assert.throws(()=>a.call('createKasbon',{kasbon:{...loan,jumlah:200000}}),/permintaan berbeda/);
 assert.throws(()=>a.call('createCicilan',{cicilan:loan}),/permintaan berbeda/);
 assert.throws(()=>a.call('createKasbon',{kasbon:loan},'owner-token-222222222'),/permintaan berbeda/);
 const pay={id:'loanpay1',kasbonId:loan.id,jumlah:30000,tanggal:'2026-10-11'};a.call('createCicilan',{cicilan:pay});const saved=a.raw('Kasbon'),writes=a.run('version');
 a.call('createCicilan',{cicilan:pay});assert.equal(a.run('version'),writes);
 assert.throws(()=>a.call('createCicilan',{cicilan:{...pay,jumlah:60000}}),/permintaan berbeda/);assert.deepEqual(a.raw('Kasbon'),saved);
 assert.equal(a.state().kasbon.some(r=>r.requestHash||r.requestActor),false);
});

test('cold Sheets requests preserve captured PO revision and exact retry evidence across separate phones',()=>{
 const {harness}=require('./helpers/apps-script-harness.cjs'),h=harness();
 const setup=h.request('setupOwner',{nama:'Owner A',pin:'1234'});assert.equal(setup.ok,true,setup.error);const token=setup.data.token;
 h.run(`pkStore_().lock(function(){pkStore_().append('Pegawai',{id:'ownerphone2',nama:'Owner B',divisi:'owner',aktif:true,token:'second-phone-token'});pkStore_().append('PO',{id:'coldpo1',noPO:'PO-COLD',nama:'COLD',status:'aktif',asal:'lama',ukuran:'{"M":10}',total:10});});`);
 function call(action,p={}){h.cold();return h.request(action,{token,workflowVersion:2,...p});}
 const snapshot=call('getState').data.po[0],payload={expectedRevision:snapshot.revision,po:{...snapshot,catatan:'First device'}};
 const first=call('savePO',payload);assert.equal(first.ok,true,first.error);const stored=JSON.stringify(h.sheets.PO.values),writes=h.sheets.PO.writes;
 const replay=call('savePO',payload);assert.equal(replay.ok,true,replay.error);assert.equal(h.sheets.PO.writes,writes);
 const stale=call('savePO',{...payload,token:'second-phone-token',po:{...snapshot,catatan:'Second stale device'}});assert.equal(stale.ok,false);assert.match(stale.error,/berubah/);
 assert.equal(JSON.stringify(h.sheets.PO.values),stored);assert.equal(h.isLocked(),false);
});

test('an exact target retry cannot undo a later direct-sheet correction that retains old retry metadata',()=>{
 const a=fixture();a.assign();const expectedRevisions=Object.fromEntries(a.state().kirim.map(r=>[r.id,r.revision]));
 const payload={poId:'po00001',maklonId:'worker1',target:'2026-10-20',expectedRevisions};a.call('ubahTargetJahit',payload);
 a.run("store.update('SlipKirim','send001',{target:'2026-10-25'});");const saved=a.raw('SlipKirim'),version=a.run('version');
 assert.throws(()=>a.call('ubahTargetJahit',payload),/Target jahit berubah/);assert.deepEqual(a.raw('SlipKirim'),saved);assert.equal(a.run('version'),version);
});

test('cold image-edit retry finishes marker and cache after a durable image or marker loses its response',()=>{
 const {harness}=require('./helpers/apps-script-harness.cjs');
 for(const stage of ['image','marker','newer-image']) {
  const h=harness(),setup=h.request('setupOwner',{nama:'Owner fixture',pin:'1234'}),token=setup.data.token;assert.equal(setup.ok,true,setup.error);
  h.run(`pkStore_().lock(function(){pkStore_().append('PO',{id:'imagepo1',nama:'IMAGE',status:'aktif',asal:'lama',ukuran:'{"M":10}',total:10,gambar:'old-photo'});pkStore_().append('Gambar',{id:'imagepo1',data:'data:image/png;base64,T0xE'});pkStore_().imgPut({imagepo1:'data:image/png;base64,T0xE'});});`);
  function call(action,p={}){h.cold();return h.request(action,{token,workflowVersion:2,...p});}
  const po=call('getState').data.po[0],payload={po,expectedRevision:po.revision,gambarData:'data:image/png;base64,TkVX'};
  const sheet=h.sheets[stage==='marker'?'PO':'Gambar'],original=sheet.getRange.bind(sheet);let failed=false;
  sheet.getRange=(...args)=>{const range=original(...args),set=range.setValues.bind(range);range.setValues=rows=>{
    const match=args[0]>1&&(stage!=='marker'||rows[0][sheet.values[0].indexOf('gambar')]!=='old-photo');
    if(match&&!failed){failed=true;if(stage!=='newer-image')set(rows);throw Error('synthetic lost image response');}return set(rows);};return range;};
  const interrupted=call('savePO',payload);sheet.getRange=original;assert.equal(interrupted.ok,false);assert.equal(interrupted.uncertain,true);assert.ok(failed);
  if(stage==='newer-image') {
    // Another save persisted a different image but was interrupted before its PO marker.
    h.run(`pkStore_().lock(function(){pkStore_().update('Gambar','imagepo1',{data:'data:image/png;base64,T1RIRVI='});});`);
    const before=JSON.stringify({po:h.sheets.PO.values,images:h.sheets.Gambar.values}),retry=call('savePO',payload);
    assert.equal(retry.ok,false);assert.match(retry.error,/Gambar PO sudah berubah/);assert.equal(JSON.stringify({po:h.sheets.PO.values,images:h.sheets.Gambar.values}),before);continue;
  }
  const retry=call('savePO',payload);assert.equal(retry.ok,true,retry.error);assert.notEqual(call('getState').data.po[0].gambar,'old-photo');
  assert.equal(call('getGambar',{ids:['imagepo1']}).data.gambar.imagepo1,payload.gambarData);
  const writes=h.sheets.PO.writes+h.sheets.Gambar.writes;assert.equal(call('savePO',payload).ok,true);assert.equal(h.sheets.PO.writes+h.sheets.Gambar.writes,writes);
 }
});
