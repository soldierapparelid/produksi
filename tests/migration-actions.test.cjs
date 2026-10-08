const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = fs.readFileSync(path.join(__dirname, '../src/core.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../src/migration-actions.js'), 'utf8');

function fixture() {
  const c = vm.createContext({});
  vm.runInContext(core + '\n' + migration + `
    SCHEMA.MigrasiJournal=['id','batchId','sheet','rowId','before','status','beforeHash','planHash','createdAt'];
    var data={},settings={},failTable='',failOnce=false,invalidTable='',events=[];
    Object.keys(SCHEMA).forEach(function(t){data[t]=[];});
    data.PO=[{id:'po00001',nama:'Sebelum',status:'aktif'}];
    data.SlipSetor=[{id:'oldcount',poId:'po00001',total:20,upahId:'paid001'}];
    data.SlipUpah=[{id:'paid001',itemIds:'["oldcount"]',totalQty:20,totalUpah:40000}];
    var plannerCalls=0;
    function coreLegacyHash(value){return JSON.stringify(value);}
    function corePlanLegacyReconciliation(backup,current){
      plannerCalls++;
      return {ready:backup.ready!==false,alreadyApplied:!!backup.alreadyApplied,batchId:'batch0001',beforeHash:backup.stale?'changed':'before',planHash:'plan',
       issues:backup.ready===false?['Hubungan sumber belum pasti']:[],summary:{po:1},
       rows:{PO:[{id:'po00001',nama:'Sesudah',status:'aktif'}],SlipSetor:[{id:'newcount',poId:'po00001',total:20,upahId:'LAMA'}]}};
    }
    var store={read:function(t){return data[t]||[];},
      replaceAll:function(t,rs){events.push(t);if(failOnce&&t===failTable){failOnce=false;throw Error('Gangguan layanan');}data[t]=JSON.parse(JSON.stringify(rs));},
      update:function(t,id,p){Object.assign(data[t].find(function(r){return r.id===id}),p);},
      getSettings:function(){return settings;},setSettings:function(s){settings=s;},
      validateRows:function(t,rs){if(t===invalidTable)throw Error('Sel terlalu panjang');}
    };
    var actions={};
    coreInstallMigrationActions(actions,{store:store,env:{now:function(){return new Date('2026-10-08T08:00:00Z')}},
      auth:function(p){if(!p.owner)throw Error('Silakan login dulu.');return {divisi:p.role||'owner'};},
      fail:function(s){throw Error(s);}});
  `, c);
  const run = js => JSON.parse(JSON.stringify(vm.runInContext(js, c)));
  const call = (action, p = {}) => run(`actions[${JSON.stringify(action)}](JSON.parse(${JSON.stringify(JSON.stringify({ owner: true, backup: {}, beforeHash: 'before', planHash: 'plan', ...p }))}))`);
  return {run,call};
}

test('preview never writes and apply recomputes plan, ignoring client replacement rows', () => {
  const a=fixture(), receipt=a.run('data.SlipUpah');
  assert.equal(a.call('previewLegacyMigration').ready,true);
  assert.deepEqual(a.run('events'),[]);
  a.call('applyLegacyMigration',{rows:{PO:[]}});
  assert.equal(a.run('plannerCalls'),2);
  assert.equal(a.run('data.PO[0].nama'),'Sesudah');
  assert.deepEqual(a.run('data.SlipUpah'),receipt);
  assert.equal(a.run('settings.legacyMigrationStatus'),false);
  assert.equal(a.run('data.MigrasiJournal.find(r=>r.sheet==="_manifest").status'),'complete');
});

test('stale preview, unsafe plan, non-owner and invalid capacity fail before any write', () => {
  for(const p of [{backup:{stale:true}},{backup:{ready:false}},{role:'qc'}]){
    const a=fixture();assert.throws(()=>a.call('applyLegacyMigration',p));assert.deepEqual(a.run('events'),[]);
  }
  const a=fixture();a.run('invalidTable="SlipSetor"');
  assert.throws(()=>a.call('applyLegacyMigration'),/panjang/);
  assert.deepEqual(a.run('events'),[]);
});

test('interrupted multi-table write leaves durable before-image and restores original payment sources', () => {
  const a=fixture(), before=a.run('JSON.parse(JSON.stringify({po:data.PO,setor:data.SlipSetor,pay:data.SlipUpah}))');
  a.run('failTable="SlipSetor";failOnce=true;true');
  assert.throws(()=>a.call('applyLegacyMigration'),/Gangguan/);
  assert.equal(a.run('data.PO[0].nama'),'Sesudah');
  assert.equal(a.run('settings.legacyMigrationStatus.batchId'),'batch0001');
  assert.throws(()=>a.call('applyLegacyMigration'),/sebelumnya/);
  assert.throws(()=>a.call('recoverLegacyMigration',{batchId:'wrong000'}),/tertunda/);
  assert.equal(a.call('recoverLegacyMigration',{batchId:'batch0001'}).dipulihkan,true);
  assert.deepEqual(a.run('({po:data.PO,setor:data.SlipSetor,pay:data.SlipUpah})'),before);
  assert.equal(a.run('settings.legacyMigrationStatus'),false);
  assert.equal(a.call('recoverLegacyMigration',{batchId:'batch0001'}).dipulihkan,false);
});

test('failed recovery remains pending and retry is safe; incomplete journal never replaces production', () => {
  const a=fixture();a.run('failTable="SlipSetor";failOnce=true;true');
  assert.throws(()=>a.call('applyLegacyMigration'));
  a.run('failTable="PO";failOnce=true;true');
  assert.throws(()=>a.call('recoverLegacyMigration',{batchId:'batch0001'}),/Gangguan/);
  assert.equal(a.run('settings.legacyMigrationStatus.batchId'),'batch0001');
  a.call('recoverLegacyMigration',{batchId:'batch0001'});
  assert.equal(a.run('data.PO[0].nama'),'Sebelum');
  const b=fixture();b.run('failTable="SlipSetor";failOnce=true;true');
  assert.throws(()=>b.call('applyLegacyMigration'));
  b.run('data.MigrasiJournal=data.MigrasiJournal.filter(r=>r.sheet!=="PO");events=[];true');
  assert.throws(()=>b.call('recoverLegacyMigration',{batchId:'batch0001'}),/tidak lengkap/);
  assert.deepEqual(b.run('events'),[]);
});

test('a journal row with changed quantity is rejected before recovery writes', () => {
  const a=fixture();a.run('failTable="SlipSetor";failOnce=true;true');
  assert.throws(()=>a.call('applyLegacyMigration'));
  a.run('var j=data.MigrasiJournal.find(r=>r.sheet==="SlipSetor");var old=JSON.parse(j.before);old.total=21;j.before=JSON.stringify(old);events=[];true');
  assert.throws(()=>a.call('recoverLegacyMigration',{batchId:'batch0001'}),/tidak cocok/);
  assert.deepEqual(a.run('events'),[]);
});

test('retry after completed migration does not overwrite the original recovery journal', () => {
  const a=fixture();a.call('applyLegacyMigration');
  const journal=a.run('data.MigrasiJournal');a.run('events=[];true');
  assert.equal(a.call('applyLegacyMigration',{backup:{alreadyApplied:true,stale:true}}).alreadyApplied,true);
  assert.deepEqual(a.run('events'),[]);
  assert.deepEqual(a.run('data.MigrasiJournal'),journal);
});

test('a truncated manifest cannot clear the pending marker or skip a table during recovery', () => {
  const a=fixture();a.run('failTable="SlipSetor";failOnce=true;true');
  assert.throws(()=>a.call('applyLegacyMigration'));
  a.run('data.MigrasiJournal.find(r=>r.sheet==="_manifest").before=JSON.stringify({tables:[]});events=[];true');
  assert.throws(()=>a.call('recoverLegacyMigration',{batchId:'batch0001'}),/tidak cocok/);
  assert.deepEqual(a.run('events'),[]);
  assert.equal(a.run('settings.legacyMigrationStatus.batchId'),'batch0001');
});

