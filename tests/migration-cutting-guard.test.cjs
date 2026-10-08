'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
function fixture(helper = true) {
  const c = vm.createContext({});
  vm.runInContext(read('core.js') + '\n' + (helper ? read('cutting-plans.js') : '') + '\n' + read('migration-actions.js') + `
    var db={},config={},events=[],locked=false,failTable='',failOnce=false,freshGuard=null;
    Object.keys(SCHEMA).forEach(function(s){db[s]=[];});
    db.Pegawai=[{id:'owner01',divisi:'owner',nama:'Owner',aktif:true,token:'owner-token-123456789'}];
    db.PO=[{id:'po00001',nama:'Awal',status:'aktif',ukuran:'{"M":10}',total:10}];
    db.SlipSetor=[{id:'source01',poId:'po00001',ukuran:'{"M":10}',total:10,status:'diterima',upahId:'LAMA'}];
    db.SlipUpah=[{id:'receipt01',itemIds:'["cut00001"]',totalQty:10,totalUpah:5000,dibayar:5000}];
    var plannedCut={id:'cut00001',poId:'po00001',userId:'cutter01',tanggal:'2026-10-01',ukuran:'{"M":10}',total:10,bahan:'Katun',bahanList:'[{"nama":"Katun","qty":2}]',kg:2,rol:1,tarif:500,upahId:'LAMA',rencanaId:'plan0001'};
    var prepared={id:'plan0001',poId:'po00001',bahanList:'[{"nama":"Katun","qty":2,"satuan":"kg"}]',rol:1,status:'siap',revision:'revision1'};
    function clone(value){return JSON.parse(JSON.stringify(value));}
    var target={PO:[{id:'po00001',nama:'Sesudah',status:'aktif',ukuran:'{"M":10}',total:10}],SlipSetor:[{id:'source02',poId:'po00001',ukuran:'{"M":10}',total:10,status:'diterima',upahId:'LAMA'}]};
    function coreLegacyHash(value){return JSON.stringify(value);}
    function corePlanLegacyReconciliation(){return {ready:true,batchId:'guardbatch01',beforeHash:'before',planHash:'plan',rows:clone(target),summary:{}};}
    var store={read:function(s){return db[s]||[];},
      checkpoint:function(names){events.push({op:'checkpoint',names:names.slice(),locked:locked});
        if(names.indexOf('RencanaPotong')>=0&&names.indexOf('Potong')>=0&&names.indexOf('PO')>=0&&freshGuard){Object.keys(freshGuard).forEach(function(s){db[s]=clone(freshGuard[s]);});freshGuard=null;}},
      replaceAll:function(s,rs){if(!locked)throw Error('unlocked write');events.push({op:'replaceAll',sheet:s});if(failOnce&&s===failTable){failOnce=false;throw Error('write interrupted');}db[s]=clone(rs);},
      update:function(s,id,p){events.push({op:'update',sheet:s});Object.assign(db[s].find(function(r){return r.id===id;}),clone(p));},
      getSettings:function(){return config;},setSettings:function(s){events.push({op:'settings'});config=clone(s);},
      validateRows:function(){},version:function(){return 1;},
      lock:function(fn){if(locked)throw Error('nested lock');locked=true;try{return fn();}finally{locked=false;}}};
    var core=createCore(store,{now:function(){return new Date('2026-10-08T08:00:00Z');},id:function(){return 'unused001';}});
  `, c);
  const run = code => JSON.parse(JSON.stringify(vm.runInContext(code, c)));
  const call = (action = 'applyLegacyMigration', extra = {}) => run(`core.handle(${JSON.stringify(action)},JSON.parse(${JSON.stringify(JSON.stringify({ token: 'owner-token-123456789', workflowVersion: 2, backup: {}, beforeHash: 'before', planHash: 'plan', batchId: 'guardbatch01', ...extra }))}))`);
  const seed = () => run('db.Potong=[clone(plannedCut)];db.RencanaPotong=[clone(prepared)];true');
  const writes = () => run('events.filter(function(e){return e.op!=="checkpoint";})');
  return { c, run, call, seed, writes };
}

test('apply blocks deletion, mutation or replacement of a planned cut before journal/settings writes', () => {
  for (const change of ['delete', 'quantity', 'rate', 'materials', 'unlink', 'inject']) {
    const a = fixture(); a.seed();
    a.run('target.Potong=[clone(plannedCut)];true');
    if (change === 'delete') a.run('target.Potong=[];true');
    if (change === 'quantity') a.run('target.Potong[0].total=11;true');
    if (change === 'rate') a.run('target.Potong[0].tarif=501;true');
    if (change === 'materials') a.run('target.Potong[0].kg=3;true');
    if (change === 'unlink') a.run("target.Potong[0].rencanaId='';true");
    if (change === 'inject') a.run("target.Potong.push(Object.assign(clone(plannedCut),{id:'newcut01'}));true");
    const original = a.run('({cuts:db.Potong,plans:db.RencanaPotong,po:db.PO,pay:db.SlipUpah,journal:db.MigrasiJournal,config:config})');
    assert.throws(() => a.call(), /persiapan|Persiapan|Hubungan/);
    assert.deepEqual(a.writes(), [], change);
    assert.deepEqual(a.run('({cuts:db.Potong,plans:db.RencanaPotong,po:db.PO,pay:db.SlipUpah,journal:db.MigrasiJournal,config:config})'), original);
  }
});

test('apply cannot orphan a prepared plan, including when Potong is not among replaced tables', () => {
  const a = fixture(); a.run('db.RencanaPotong=[clone(prepared)];target.PO=[];true');
  assert.throws(() => a.call(), /PO yang harus dipertahankan/);
  assert.deepEqual(a.writes(), []);
});

test('fresh plans and source rows are checked inside the real core write lock, not only planner cache', () => {
  const a = fixture();
  a.run('target.Potong=[];freshGuard={Potong:[clone(plannedCut)],RencanaPotong:[clone(prepared)]};true');
  assert.throws(() => a.call(), /harus dipertahankan/);
  assert.deepEqual(a.writes(), []);
  assert.equal(a.run("events.some(function(e){return e.op==='checkpoint'&&e.locked&&['PO','Potong','RencanaPotong'].every(function(n){return e.names.indexOf(n)>=0;});})"), true);
});

test('unchanged linked cuts and all their plans survive both normal migration and recovery', () => {
  for (const recovery of [false, true]) {
    const a = fixture(); a.seed();
    const before = a.run('({cuts:db.Potong,plans:db.RencanaPotong,pay:db.SlipUpah})');
    a.run('target.Potong=[clone(plannedCut)];true');
    if (recovery) {
      a.run("failTable='SlipSetor';failOnce=true;true");
      assert.throws(() => a.call(), /write interrupted/);
      assert.equal(a.run('config.legacyMigrationStatus.batchId'), 'guardbatch01');
      assert.equal(a.call('recoverLegacyMigration').data.dipulihkan, true);
      assert.equal(a.run('db.PO[0].nama'), 'Awal');
    } else assert.equal(a.call().data.selesai, true);
    const after = a.run('({cuts:db.Potong.map(function(r){var keep={};Object.keys(plannedCut).forEach(function(k){keep[k]=r[k];});return keep;}),plans:db.RencanaPotong,pay:db.SlipUpah})');
    assert.deepEqual(after, before);
    assert.equal(a.run('config.legacyMigrationStatus'), false);
    assert.equal(a.writes().some(e => e.sheet === 'RencanaPotong'), false);
  }
});

test('recovery cannot remove a planned cut added after the journal was prepared', () => {
  const a = fixture();
  a.run("target.Potong=[Object.assign(clone(plannedCut),{rencanaId:''})];failTable='SlipSetor';failOnce=true;true");
  assert.throws(() => a.call(), /write interrupted/);
  a.run("freshGuard={Potong:[clone(plannedCut)],RencanaPotong:[clone(prepared)]};events=[];true");
  const status = a.run('config'), journal = a.run('db.MigrasiJournal');
  assert.throws(() => a.call('recoverLegacyMigration'), /harus dipertahankan/);
  assert.deepEqual(a.writes(), []);
  assert.deepEqual(a.run('config'), status); assert.deepEqual(a.run('db.MigrasiJournal'), journal);
  assert.equal(a.run('db.Potong[0].rencanaId'), 'plan0001');
});

test('recovery cannot orphan a newly prepared plan or rewrite changed paid cutting history', () => {
  const orphan = fixture();
  orphan.run("target.PO.push({id:'po00002',nama:'PO tambahan',status:'aktif'});failTable='SlipSetor';failOnce=true;true");
  assert.throws(() => orphan.call(), /write interrupted/);
  orphan.run("freshGuard={RencanaPotong:[Object.assign(clone(prepared),{poId:'po00002'})]};events=[];true");
  assert.throws(() => orphan.call('recoverLegacyMigration'), /PO yang harus dipertahankan/);
  assert.deepEqual(orphan.writes(), []);
  assert.equal(orphan.run('config.legacyMigrationStatus.batchId'), 'guardbatch01');
  const changed = fixture(); changed.seed();
  changed.run("target.Potong=[clone(plannedCut)];failTable='SlipSetor';failOnce=true;true");
  assert.throws(() => changed.call(), /write interrupted/);
  changed.run('freshGuard={Potong:[Object.assign(clone(plannedCut),{total:11})]};events=[];true');
  assert.throws(() => changed.call('recoverLegacyMigration'), /harus dipertahankan/);
  assert.deepEqual(changed.writes(), []);
  assert.equal(changed.run('db.Potong[0].total'), 11);
});

test('older helper-less packages permit legacy-only migration but fail closed for any cutting plans', () => {
  const legacy = fixture(false); assert.equal(legacy.call().data.selesai, true);
  for (const linked of [false, true]) {
    const a = fixture(false);
    a.run(linked ? 'db.Potong=[clone(plannedCut)];true' : 'db.RencanaPotong=[clone(prepared)];true');
    assert.throws(() => a.call(), /Paket pelindung persiapan potong belum lengkap/);
    assert.deepEqual(a.writes(), []);
  }
  const recovery = fixture(false);
  recovery.run("failTable='SlipSetor';failOnce=true;true");
  assert.throws(() => recovery.call(), /write interrupted/);
  recovery.run('freshGuard={RencanaPotong:[clone(prepared)]};events=[];true');
  assert.throws(() => recovery.call('recoverLegacyMigration'), /Paket pelindung/);
  assert.deepEqual(recovery.writes(), []);
});
