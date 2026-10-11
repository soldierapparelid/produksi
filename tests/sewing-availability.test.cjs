'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function part(a,b){const start=html.indexOf(a),end=html.indexOf(b,start+a.length);assert.ok(start>=0&&end>start,a);return html.slice(start,end);}
function fixture(){
  const c=vm.createContext({console});
  for(const file of ['core.js','reconcile-legacy.js'])vm.runInContext(fs.readFileSync(path.join(root,'src',file),'utf8'),c);
  vm.runInContext(`
    var db={},serial=0,version=1;Object.keys(SCHEMA).forEach(function(s){db[s]=[];});
    db.Pegawai=[{id:'owner01',divisi:'owner',aktif:true,token:'owner-token-123456789'},{id:'worker1',divisi:'jahit',aktif:true}];
    var store={read:function(s){return db[s];},append:function(s,r){db[s].push(r);version++;},getSettings:function(){return {ukuran:['M','L','XL']};},version:function(){return version;},lock:function(f){return f();}};
    var app=createCore(store,{now:function(){return new Date('2026-10-11T00:00:00Z');},id:function(){return 'new-id-'+(++serial);}});
    function evidence(p,sizes){var e={version:1,source:'verified-full-backup',snapshotHash:'a'.repeat(64),batchId:'synthetic-batch',sizes:sizes.map(function(s){return {skuId:'sku-'+s,cycle:JSON.stringify(['sku-'+s,'']),ukuran:s,hadCutAtImport:true};}),plans:[]};e.proofHash=coreLegacyHash({poId:p.id,snapshotHash:e.snapshotHash,batchId:e.batchId,sizes:e.sizes,plans:e.plans});p.imporSumber=JSON.stringify({legacyCutting:e});}
    function seed(sizes){var p={id:'legacy-po',nama:'Synthetic garment',status:'aktif',asal:'lama',ukuran:'{}'};evidence(p,sizes);db.PO=[p];return p;}
    function flow(){return coreWorkflow(db.PO,db.Potong,db.SlipKirim,db.SlipSetor,db.QC,db.Gudang)[db.PO[0].id];}
    function ready(){return coreKirimAvailability(db.PO[0],flow(),['M','L','XL']);}
    function send(size,n){var ukuran={};ukuran[size]=n;return app.handle('createKirim',{token:'owner-token-123456789',workflowVersion:2,kirim:{id:'synthetic-send',poId:db.PO[0].id,maklonId:'worker1',ukuran:ukuran}});}
  `,c);
  return {c,run:s=>vm.runInContext(s,c)};
}
const plain=x=>JSON.parse(JSON.stringify(x));

test('legacy inspected size with a missing dispatch is not advertised or accepted as new sewing work',()=>{
  const f=fixture();f.run(`seed(['L']);db.Potong=[{id:'old-cut',poId:'legacy-po',ukuran:{L:99},total:99,asal:'lama'}];db.QC=[{id:'old-qc',poId:'legacy-po',ukuran:{L:99},total:99,asal:'lama',workflowVersion:0}];`);
  const before=f.run('JSON.stringify(db)');assert.equal(f.run('flow().ukuran.L.siapKirim'),99,'historical gap remains visible in raw workflow');assert.deepEqual(plain(f.run('ready()')),{total:0,ukuran:{}});
  assert.throws(()=>f.run("send('L',99)"),/sudah masuk QC/);assert.equal(f.run('JSON.stringify(db)'),before);
});

test('legacy active L excludes closed M/XL historical cuts, without changing their records',()=>{
  const f=fixture();f.run(`seed(['L']);db.Potong=[{id:'old-M',poId:'legacy-po',ukuran:{M:84},total:84},{id:'active-L',poId:'legacy-po',ukuran:{L:84},total:84},{id:'old-XL',poId:'legacy-po',ukuran:{XL:81},total:81}];db.SlipKirim=[{id:'sent-L',poId:'legacy-po',maklonId:'worker1',ukuran:{L:84},total:84},{id:'sent-XL',poId:'legacy-po',maklonId:'worker1',ukuran:{XL:81},total:81}];`);
  const before=f.run('JSON.stringify(db)');assert.equal(f.run('flow().ukuran.M.siapKirim'),84);assert.deepEqual(plain(f.run('ready()')),{total:0,ukuran:{}});
  assert.throws(()=>f.run("send('M',84)"),/tidak terdaftar/);assert.equal(f.run('JSON.stringify(db)'),before);
  f.run('db.SlipKirim[0].ukuran.L=64;db.SlipKirim[0].total=64');assert.deepEqual(plain(f.run('ready()')),{total:20,ukuran:{L:20}});
  f.run("send('L',20)");assert.equal(f.run('db.SlipKirim.length'),3);assert.equal(f.run('ready().total'),0);
});

test('availability uses positive eligible sizes independently, all QC categories, status and blocking gates',()=>{
  const f=fixture();f.run(`var p=seed(['M','L']);var w={blockingIssues:[],issues:['legacy warning'],ukuran:{M:{potong:10,kirim:15},L:{potong:20,kirim:0}}};`);
  assert.deepEqual(plain(f.run("coreKirimAvailability(p,w,['M','L'])")),{total:20,ukuran:{L:20}},'an unrelated negative historical balance cannot cancel valid work');
  for(const field of ['qcOk','qcOffline','qcReject','qcPerbaikan']){f.run(`w.ukuran.L[${JSON.stringify(field)}]=1`);assert.equal(f.run("coreKirimAvailability(p,w,['M','L']).total"),0,field);f.run(`delete w.ukuran.L[${JSON.stringify(field)}]`);}
  f.run("w.blockingIssues=['bad native proof']");assert.equal(f.run("coreKirimAvailability(p,w,['M','L']).total"),0);
  f.run("w.blockingIssues=[];p.status='selesai'");assert.equal(f.run("coreKirimAvailability(p,w,['M','L']).total"),0);
  f.run("p.status='aktif';p.asal='';p.imporSumber='';p.ukuranAktif='[\"M\"]'");assert.equal(f.run("coreKirimAvailability(p,w,['M','L']).total"),0);
});

test('native selected sizes take precedence over public cutting projection and stale target keys exactly as server validation',()=>{
  const f=fixture();f.run(`db.PO=[{id:'native-po',nama:'Native garment',status:'aktif',ukuranAktif:'["M"]',ukuran:{L:40}}];db.Potong=[{id:'native-cut',poId:'native-po',ukuran:{M:20,L:40},total:60}];`);
  assert.deepEqual(plain(f.run('flow().cutting.ukuran')),['M']);assert.deepEqual(plain(f.run('ready()')),{total:20,ukuran:{M:20}});
  assert.throws(()=>f.run("send('L',1)"),/tidak terdaftar/);assert.equal(f.run('db.SlipKirim.length'),0);
  f.run("send('M',20)");assert.equal(f.run('ready().total'),0);assert.equal(f.run('db.SlipKirim.length'),1);
});

function uiFixture(){
  const f=fixture();f.run(`
    var A={},S={state:{settings:{ukuran:['M','L','XL']},po:[]}},D={po:{}},rendered='',picked=[],requests=[],messages=[],gridSizes=[];
    var form={sizes:{},values:{id:'draft-send',poId:'legacy-po',maklonId:'worker1'},getAttribute:function(){return '999';}};
    function refreshFixture(){var p=db.PO[0];p.workflow=flow();p.agg=coreAggregate(db.PO,db.Potong,db.SlipKirim,db.SlipSetor,db.QC,db.Gudang)[p.id];S.state.po=[p];D.po[p.id]=p;}
    function workflowFor(p){return p&&p.workflow||{ukuran:{},issues:[]};}function poAktif(){return S.state.po.filter(function(p){return p.status==='aktif';});}
    function pos(n){return Math.max(0,coreNum(n));}function nf(n){return String(n||0);}function newId(){return 'draft-send';}
    function pickPO(t,list){picked=list;}function openSheet(f){rendered=f();}function sheetHtml(t,b,f){return t+b+(f||'');}function emptyBox(s){return s;}
    function maklonAktif(){return [{id:'worker1',nama:'Synthetic sewer'}];}function poHead(){return '';}
    function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}function hid(){return '';}
    function miniKpi(rows){return rows.map(function(r){return r.join(' ');}).join('|');}function fSelect(){return '';}function fTanggal(){return '';}function fNum(){return '';}function fCatatan(){return '';}
    function sizeGrid(sizes,o){gridSizes=sizes;return sizes.map(function(s){return '<input data-size="'+esc(s)+'" value="'+o.val[s]+'">';}).join('');}function sumLine(){return '';}function tarifBawaan(){return 0;}function footSave(a,t){return '<button data-a="'+a+'">'+t+'</button>';}
    function topForm(){return form;}function formVals(f){return f.values;}function sizeVals(f){return f.sizes;}function toast(s){messages.push(s);}function req(a,p){requests.push({a,p});return Promise.resolve({});}function act(e,p){return p;}
  `);
  vm.runInContext(part('function projectWorkflow(po)','function poSizes(po)'),f.c);
  vm.runInContext(part('A.kirimPick = function','A.setorPick = function'),f.c);
  vm.runInContext(part('A.kirimOpen =','/* tutup lembar form tertentu'),f.c);
  return f;
}

test('UI projection, picker and direct form exclude both legacy false-ready structures while retaining all physical totals',()=>{
  for(const kind of ['inspected','inactive-size']){
    const f=uiFixture();f.run(`seed(['L']);db.Potong=[{id:'c',poId:'legacy-po',ukuran:${kind==='inspected'?'{L:99}':'{M:84,L:84}'},total:${kind==='inspected'?'99':'168'}}];`);
    if(kind==='inspected')f.run("db.QC=[{id:'qc',poId:'legacy-po',ukuran:{L:99},total:99,workflowVersion:0}]");
    else f.run("db.SlipKirim=[{id:'send',poId:'legacy-po',maklonId:'worker1',ukuran:{L:84},total:84}]");
    f.run("refreshFixture();var raw=JSON.stringify(db.Potong);var rawFlow=JSON.stringify(db.PO[0].workflow);A.kirimPick({getAttribute:function(){return '';}});openKirim('legacy-po','')");
    assert.equal(f.c.picked.length,0);assert.equal(f.c.gridSizes.length,0);assert.match(f.c.rendered,/Tersedia 0/);assert.doesNotMatch(f.c.rendered,/data-a="kirimSave"/);
    assert.equal(f.run('T(db.PO[0]).potong'),kind==='inspected'?99:168);assert.equal(f.run('JSON.stringify(db.Potong)===raw'),true);assert.equal(f.run('JSON.stringify(db.PO[0].workflow)===rawFlow'),true);
  }
});

test('direct assignment form offers only eligible remaining sizes and blocks stale or injected unavailable sizes before transport',()=>{
  const f=uiFixture();f.run(`seed(['L']);db.Potong=[{id:'old',poId:'legacy-po',ukuran:{M:84,L:84},total:168}];db.SlipKirim=[{id:'sent',poId:'legacy-po',maklonId:'worker1',ukuran:{L:64},total:64}];refreshFixture();openKirim('legacy-po','');`);
  assert.deepEqual(Array.from(f.c.gridSizes),['L']);assert.match(f.c.rendered,/data-size="L" value="20"/);assert.doesNotMatch(f.c.rendered,/data-size="M"/);
  f.run("form.sizes={M:1};A.kirimSave({})");assert.equal(f.c.requests.length,0);assert.match(f.c.messages.join(' '),/tidak lagi tersedia/);
  f.run("db.SlipKirim[0].ukuran.L=84;db.SlipKirim[0].total=84;refreshFixture();form.sizes={L:20};A.kirimSave({})");assert.equal(f.c.requests.length,0);assert.match(f.c.messages.join(' '),/tidak lagi tersedia/);
});

test('real getState redacts worker provenance without restoring inactive historical sizes in UI availability',()=>{
  for(const role of ['owner','qc','potong']){
    const f=uiFixture();f.run(`seed(['L']);db.Pegawai.push({id:'viewer01',divisi:${JSON.stringify(role)},aktif:true,token:'viewer-token-123456789'});db.Potong=[{id:'cut',poId:'legacy-po',userId:'viewer01',ukuran:{M:84,L:84},total:168}];db.SlipKirim=[{id:'sent',poId:'legacy-po',maklonId:'worker1',ukuran:{L:64},total:64}];
      var serverReady=ready();var publicState=app.handle('getState',{token:'viewer-token-123456789',workflowVersion:2,semua:true});S.state=publicState;D.po={};publicState.po.forEach(function(p){D.po[p.id]=p;});var publicPO=publicState.po[0];`);
    assert.equal(f.run('!!publicPO.imporSumber'),role==='owner',role+' provenance policy');assert.deepEqual(plain(f.run('publicPO.cutting.ukuran')),['L']);
    assert.deepEqual(plain(f.run('coreKirimAvailability(publicPO,publicPO.workflow,publicState.settings.ukuran)')),plain(f.run('serverReady')));
    assert.equal(f.run('T(publicPO).siapKirim'),20);assert.equal(f.run('publicPO.agg.ukuran.M.potong'),84);assert.equal(f.run('publicPO.agg.ukuran.M.siapKirim'),0);
    f.run("openKirim('legacy-po','')");assert.deepEqual(Array.from(f.c.gridSizes),['L']);assert.match(f.c.rendered,/value="20"/);
    f.run("db.SlipKirim[0].ukuran.L=84;db.SlipKirim[0].total=84;publicState=app.handle('getState',{token:'viewer-token-123456789',workflowVersion:2,semua:true});S.state=publicState;D.po['legacy-po']=publicState.po[0];A.kirimPick({getAttribute:function(){return '';}})");assert.equal(f.c.picked.length,0);
  }
});
