'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/commerce-hpp.js'),'utf8'),context);
function callPure(name,...args){context.fixtureArgs=JSON.stringify(args);return JSON.parse(JSON.stringify(vm.runInContext(name+'(...JSON.parse(fixtureArgs))',context)));}
function modelId(name){return vm.runInContext('coreCommerceLegacyCost.modelId("Fixture",'+JSON.stringify(name)+')',context);}
const groupId='hppg_fixture-oblong',otherGroupId='hppg_fixture-thick';
const costs=(extra={})=>({jahitMode:'manual',hargaJahit:2500,biayaLain:400,targetMargin:30,costSchema:2,costsReviewed:true,basisPolicy:'complete-legacy-v1',...extra});
function fixtureInput(){
 const specs=[['Red',100,20,10000,900,'XL'],['Blue',300,30,30000,1100,'XL'],['Green',500,50,99999,900,'M'],['Thick',100,40,40000,1400,'XL']];
 return {settings:{upahJahit:2000},config:{modelConfigs:{[modelId('Red')]:costs({hargaJahit:7777})},hppGroups:{[groupId]:{id:groupId,nama:'Oblong reguler',modelIds:specs.slice(0,3).map(x=>modelId(x[0])),config:costs()}},marketplace:{shop:{nama:'Fixture Shop',fee:10,fixedPerPcs:100}},pajak:0},tables:{
  PO:specs.map(([name])=>({id:'po'+name,series:'Fixture',nama:name,ukuranAktif:['M','L','XL'],ukuran:{}})),
  Potong:specs.map(([name,pcs,qty,price,tarif,size])=>({id:'cut'+name,poId:'po'+name,total:pcs,ukuran:{[size]:pcs},tarif,bahanList:[{nama:'Fabric '+name,qty,satuan:'kg'}],alokasiBahan:[{stokId:'roll'+name,qty}]})),
  StokBahan:specs.map(([name,pcs,qty,price])=>({id:'roll'+name,jenis:'beli',bahan:'Fabric '+name,qty,satuan:'kg',harga:price,total:qty*price,stockMode:'roll'})),
  SlipKirim:[{id:'sendRed',poId:'poRed',total:100,upah:1000},{id:'sendBlue',poId:'poBlue',total:300,upah:2000}],RencanaPotong:[],KoreksiRiwayat:[]
 }};
}
function near(actual,expected){assert.ok(Math.abs(actual-expected)<1e-8,actual+' != '+expected);}

test('shared group pools XL costs by pieces, lets other sizes inherit, and leaves thick cloth and source records alone',()=>{
 const input=fixtureInput(),before=JSON.stringify(input),out=callPure('coreCommerceHpp',input),g=out.groups[0];
 assert.equal(out.models.length,4);assert.equal(out.groups.length,1);assert.equal(g.isGroup,true);assert.equal(g.nama,'Oblong reguler');
 assert.deepEqual(g.referenceModelIds,[modelId('Red'),modelId('Blue')]);assert.equal(g.memberModels.length,3);assert.equal(g.kain.totalPcs,400);assert.equal(g.kain.totalCost,1100000);near(g.kain.perPcs,2750);near(g.potong.perPcs,1050);near(g.hppTotal,6700);
 assert.equal(g.configured,true);assert.equal(g.basis.ukuran,'XL');assert.equal(g.kain.observasi.totalKg,50);assert.equal(g.kain.observasi.fullRollCount,2);assert.equal(g.kain.observasi.pcsPerFullRoll,200);assert.deepEqual(g.kain.observasi.sizes,[{size:'XL',jumlah:400}]);
 assert.ok(g.warnings.some(x=>/1 anggota mengikuti/.test(x)));assert.ok(g.prices.shop.valid);assert.equal(out.models.find(m=>m.nama==='Red').hargaJahit,7777);assert.ok(!g.modelIds.includes(modelId('Thick')));assert.equal(JSON.stringify(input),before);
});

test('personal cost review and conflicting personal manual rates do not replace the group reference',()=>{
 const input=fixtureInput();input.config.modelConfigs[modelId('Red')].costsReviewed=false;input.config.modelConfigs[modelId('Red')].jahitMode='invalid';
 const out=callPure('coreCommerceHpp',input);assert.equal(out.models.find(m=>m.nama==='Red').configured,false);assert.equal(out.groups[0].configured,true);assert.equal(out.groups[0].hargaJahit,2500);assert.deepEqual(out.groups[0].sourceWarnings,[]);
});

test('an incomplete XL member inherits a complete reference without adding its costs or pieces',()=>{
 for(const mutation of [i=>i.tables.StokBahan[1].harga=0,i=>i.tables.StokBahan[1].total=1,i=>i.tables.Potong[1].alokasiBahan[0].stokId='missing-roll']){
  const input=fixtureInput();mutation(input);if(input.tables.StokBahan[1].harga===0)input.tables.StokBahan[1].total=0;
  const out=callPure('coreCommerceHpp',input),g=out.groups[0];assert.deepEqual(g.referenceModelIds,[modelId('Red')]);assert.equal(g.kain.totalPcs,100);assert.equal(g.kain.totalCost,200000);assert.equal(g.potong.totalPcs,100);assert.equal(g.potong.totalCost,90000);assert.equal(g.kain.complete,true);assert.equal(g.hppTotal,5800);assert.equal(g.configured,true);assert.ok(g.prices.shop.valid);assert.ok(g.warnings.some(x=>x.includes('Blue:')));assert.equal(out.models.find(m=>m.nama==='Blue').kain.complete,false);
 }
});

test('group without isolated XL retains an unavailable reference and never reuses mixed-size fallback costs',()=>{
 const input=fixtureInput();input.tables.Potong[0].ukuran={M:100};input.tables.Potong[1].ukuran={L:300};const g=callPure('coreCommerceHpp',input).groups[0];
 assert.equal(g.referenceModelIds.length,0);assert.equal(g.kain.totalPcs,0);assert.equal(g.hppTotal,null);assert.equal(g.configured,false);assert.equal(g.configSaved,true);assert.match(g.warnings.join(' '),/Belum ada acuan kain XL/);
});

test('structural warnings exclude that XL member while owner opening notes stay separate from costs',()=>{
 const input=fixtureInput();input.tables.KoreksiRiwayat=[{poId:'poRed'}];let g=callPure('coreCommerceHpp',input).groups[0];assert.deepEqual(g.referenceModelIds,[modelId('Blue')]);assert.equal(g.configured,true);assert.equal(g.kain.totalPcs,300);assert.equal(g.hppTotal,7000);assert.deepEqual(g.sourceWarnings,[]);assert.match(g.warnings.join(' '),/Red:.*koreksi fisik/);
 input.tables.KoreksiRiwayat=[];input.tables.Potong.push({id:'opening',poId:'poRed',asal:'koreksi-ukuran',total:150,ukuran:{M:150}});g=callPure('coreCommerceHpp',input).groups[0];assert.equal(g.kain.totalPcs,400);assert.equal(g.configured,true);
});

test('auto group sewing uses assignment quantities and fallback rates only when consistent',()=>{
 const input=fixtureInput();input.config.hppGroups[groupId].config=costs({jahitMode:'auto'});let g=callPure('coreCommerceHpp',input).groups[0];near(g.hargaJahit,1750);near(g.hppTotal,5950);assert.equal(g.jahit.totalPcs,400);
 input.tables.SlipKirim=[];g=callPure('coreCommerceHpp',input).groups[0];assert.equal(g.hargaJahit,2000);assert.equal(g.jahit.totalPcs,0);assert.equal(g.configured,true);
 input.tables.Produk=[{id:'different',tarifJahit:3000}];input.tables.PO[0].produkId='different';g=callPure('coreCommerceHpp',input).groups[0];assert.equal(g.hargaJahit,null);assert.equal(g.hppTotal,null);assert.match(g.warnings.join(' '),/berbeda|manual/);
 input.config.hppGroups[groupId].config=costs();assert.equal(callPure('coreCommerceHpp',input).groups[0].configured,true);
});

test('an invalid assignment cannot become a zero weighted sewing contribution',()=>{
 const input=fixtureInput();input.config.hppGroups[groupId].config=costs({jahitMode:'auto'});input.tables.SlipKirim[1].upah='bad';const g=callPure('coreCommerceHpp',input).groups[0];assert.equal(g.jahit.complete,false);assert.equal(g.hargaJahit,null);assert.equal(g.configured,false);
});

test('group reader fails visibly for overlapping membership and missing models and never mutates raw model snapshots',()=>{
 const input=fixtureInput(),raw=callPure('coreCommerceHpp',{...input,config:{...input.config,hppGroups:{}}}).models,before=JSON.stringify(raw);
 input.config.hppGroups[otherGroupId]={id:otherGroupId,nama:'Other',modelIds:[modelId('Red'),modelId('Thick')],config:costs()};let out=callPure('coreCommerceHppGroups',raw,input.config);assert.equal(out.groups.length,0);assert.equal(out.warnings.length,2);
 delete input.config.hppGroups[otherGroupId];input.config.hppGroups[groupId].modelIds.push('model_missing');out=callPure('coreCommerceHppGroups',raw,input.config);assert.equal(out.groups[0].configured,false);assert.match(out.groups[0].warnings.join(' '),/belum ditemukan/);assert.equal(JSON.stringify(raw),before);
});

test('unsafe pooled totals block recommendations instead of overflowing',()=>{
 const input=fixtureInput(),raw=callPure('coreCommerceHpp',{...input,config:{...input.config,hppGroups:{}}}).models;raw.filter(m=>m.basis.ukuran==='XL').forEach(m=>{m.kain.totalCost=Number.MAX_SAFE_INTEGER;});const out=callPure('coreCommerceHppGroups',raw,input.config).groups[0];assert.equal(out.kain.complete,false);assert.equal(out.hppTotal,null);assert.equal(out.configured,false);
});

function serverFixture(){
 const h=harness();for(const file of ['reconcile-legacy','commerce-hpp','slip-models','commerce'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/'+file+'.js'),'utf8'),h.context);
 const setup=h.request('setupOwner',{nama:'Owner Fixture',pin:'1234'});assert.equal(setup.ok,true,setup.error);const token=setup.data.token;
 h.context.groupFixtureTables=fixtureInput().tables;h.run(`pkStore_().lock(function(){Object.keys(groupFixtureTables).forEach(function(table){pkStore_().appendMany(table,groupFixtureTables[table]);});pkStore_().appendMany('Pegawai',[{id:'groupAdmin',nama:'Admin Fixture',divisi:'admin',aktif:true,token:'group-admin-token'},{id:'groupCutter',nama:'Cutter Fixture',divisi:'potong',aktif:true,token:'group-cutter-token'}]);});void 0;`);
 function request(action,p={},actor=token){h.cold();return h.request(action,{token:actor,workflowVersion:2,...p});}
 function good(action,p,actor){const r=request(action,p,actor);assert.equal(r.ok,true,r.error);return r.data;}
 function bad(action,p,pattern,actor){const r=request(action,p,actor);assert.equal(r.ok,false,'request must fail');assert.match(r.error,pattern);return r;}
 const state=()=>good('getCommerceState',{module:'hpp'}),raw=table=>{h.cold();return h.run(`pkStore_().fresh(${JSON.stringify(table)});pkStore_().read(${JSON.stringify(table)})`);};
 const group=(extra={})=>({id:groupId,nama:'Oblong reguler',modelIds:[modelId('Red'),modelId('Blue'),modelId('Green')],expectedRevision:state().revision,...extra});
 return {h,request,good,bad,state,raw,group};
}

test('owner creates and edits shared costs atomically, with replay, frozen member costs and unchanged production ledgers',()=>{
 const f=serverFixture();let st=f.state();f.good('saveCommerceHpp',{modelId:modelId('Red'),config:costs({hargaJahit:7777}),expectedRevision:st.revision});
 const before=JSON.stringify(['PO','Potong','StokBahan','SlipKirim','CommerceEvent'].map(f.raw)),request=f.group(),created=f.good('saveCommerceHppGroup',request);assert.equal(f.good('saveCommerceHppGroup',request).revision,created.revision);
 st=f.state();assert.equal(st.groups.length,1);assert.equal(st.groups[0].configSaved,false);assert.equal(st.config.hppGroups[groupId].config,null);
 f.good('saveCommerceHpp',{modelId:groupId,config:costs(),expectedRevision:st.revision});st=f.state();assert.equal(st.groups[0].hppTotal,6700);assert.equal(st.groups[0].configured,true);assert.equal(st.config.modelConfigs[modelId('Red')].hargaJahit,7777);
 f.bad('saveCommerceHpp',{modelId:modelId('Red'),config:costs(),expectedRevision:st.revision},/kelompok/);assert.equal(JSON.stringify(['PO','Potong','StokBahan','SlipKirim','CommerceEvent'].map(f.raw)),before);
});

test('only owner manages membership or shared cost, with revisions and workflow contract enforced',()=>{
 const f=serverFixture(),request=f.group();f.bad('saveCommerceHppGroup',request,/owner/,'group-admin-token');f.bad('saveCommerceHppGroup',request,/owner/,'group-cutter-token');f.bad('saveCommerceHppGroup',{...request,workflowVersion:1},/Versi/);
 f.good('saveCommerceHppGroup',request);f.bad('saveCommerceHppGroup',{...request,nama:'Changed'},/berubah/);const st=f.state();f.bad('saveCommerceHpp',{modelId:groupId,config:costs(),expectedRevision:st.revision},/owner/,'group-admin-token');
 f.good('saveCommerceHpp',{modelId:groupId,config:costs(),expectedRevision:st.revision});f.bad('saveCommerceHpp',{modelId:groupId,config:costs({hargaJahit:1000}),expectedRevision:st.revision},/berubah/);
});

test('group API rejects missing, duplicate, overlapping and excessive membership without partial writes',()=>{
 const f=serverFixture(),initial=JSON.stringify(f.raw('CommerceRecord'));
 for(const [extra,pattern] of [[{id:'__proto__'},/Identitas/],[{modelIds:[modelId('Red')]},/2 sampai/],[{modelIds:[modelId('Red'),modelId('Red')]},/lebih dari sekali/],[{modelIds:[modelId('Red'),'model_unknown']},/tidak ditemukan/],[{modelIds:Array(101).fill(modelId('Red'))},/2 sampai/],[{nama:' '},/teks/],[{remove:'yes'},/hapus/]])f.bad('saveCommerceHppGroup',f.group(extra),pattern);
 assert.equal(JSON.stringify(f.raw('CommerceRecord')),initial);f.good('saveCommerceHppGroup',f.group());const before=JSON.stringify(f.raw('CommerceRecord'));
 f.bad('saveCommerceHppGroup',f.group({id:otherGroupId,nama:'Thick',modelIds:[modelId('Red'),modelId('Thick')]}),/kelompok HPP lain/);assert.equal(JSON.stringify(f.raw('CommerceRecord')),before);
});

test('membership changes require review again; rename preserves approval; removing group restores independent configuration',()=>{
 const f=serverFixture();f.good('saveCommerceHpp',{modelId:modelId('Red'),config:costs({hargaJahit:7777}),expectedRevision:f.state().revision});f.good('saveCommerceHppGroup',f.group());f.good('saveCommerceHpp',{modelId:groupId,config:costs(),expectedRevision:f.state().revision});
 f.good('saveCommerceHppGroup',f.group({nama:'Regular colors'}));let st=f.state();assert.equal(st.groups[0].configSaved,true);
 f.good('saveCommerceHppGroup',f.group({modelIds:[modelId('Red'),modelId('Blue')]}));st=f.state();assert.equal(st.groups[0].configSaved,false);assert.equal(st.groups[0].configured,false);assert.equal(st.groups[0].config.value.hargaJahit,2500);assert.equal(st.groups[0].config.value.costsReviewed,false);
 const remove={id:groupId,remove:true,expectedRevision:st.revision},removed=f.good('saveCommerceHppGroup',remove);assert.equal(f.good('saveCommerceHppGroup',remove).revision,removed.revision);st=f.state();assert.deepEqual(st.groups,[]);assert.equal(st.models.find(m=>m.nama==='Red').hargaJahit,7777);
 f.good('saveCommerceHpp',{modelId:modelId('Red'),config:costs({hargaJahit:1500}),expectedRevision:st.revision});assert.equal(f.state().models.find(m=>m.nama==='Red').hargaJahit,1500);
});

test('one valid XL member supplies all fourteen members before the other models have any cuts',()=>{
 const input=fixtureInput();input.tables.Potong=input.tables.Potong.filter(r=>r.poId==='poRed');
 for(let i=1;i<=11;i++){const name='Waiting '+i;input.tables.PO.push({id:'waiting'+i,series:'Fixture',nama:name,ukuranAktif:['M','L','XL']});input.config.hppGroups[groupId].modelIds.push(modelId(name));}
 delete input.settings.upahJahit;
 const before=JSON.stringify(input),g=callPure('coreCommerceHpp',input).groups[0];
 assert.equal(g.memberModels.length,14);assert.deepEqual(g.referenceModelIds,[modelId('Red')]);assert.equal(g.kain.totalPcs,100);assert.equal(g.kain.totalCost,200000);assert.equal(g.potong.totalCost,90000);assert.equal(g.hppTotal,5800);assert.equal(g.configured,true);assert.ok(g.prices.shop.valid);assert.match(g.warnings.join(' '),/13 anggota mengikuti/);assert.equal(JSON.stringify(input),before);
});

test('a non-reference member retains history warnings without blocking the valid shared XL reference',()=>{
 const input=fixtureInput();input.tables.Potong=input.tables.Potong.filter(r=>r.poId==='poRed');input.tables.PO.find(p=>p.id==='poGreen').imporReview=true;input.tables.KoreksiRiwayat=[{poId:'poGreen'}];
 const out=callPure('coreCommerceHpp',input),g=out.groups[0];
 assert.deepEqual(g.referenceModelIds,[modelId('Red')]);assert.equal(g.configured,true);assert.equal(g.hppTotal,5800);assert.deepEqual(g.sourceWarnings,[]);assert.match(g.warnings.join(' '),/Green: PO poGreen masih memerlukan pemeriksaan/);assert.match(g.warnings.join(' '),/Green: Jumlah riwayat memiliki koreksi fisik/);assert.match(g.inheritedWarnings.join(' '),/Green: PO poGreen masih memerlukan pemeriksaan/);assert.ok(g.inheritedWarnings.every(w=>g.warnings.includes(w)));assert.equal(out.models.find(m=>m.nama==='Green').configured,false);
 input.tables.PO.find(p=>p.id==='poRed').imporReview=true;const blocked=callPure('coreCommerceHpp',input).groups[0];assert.equal(blocked.configured,false);assert.equal(blocked.hppTotal,null);assert.equal(blocked.kain.totalPcs,0);assert.deepEqual(blocked.referenceModelIds,[]);assert.match(blocked.warnings.join(' '),/Red: PO poRed/);assert.deepEqual(blocked.prices,{});
});

test('fabric and cutting counts must match within each member, even if group discrepancies cancel out',()=>{
 const input=fixtureInput(),raw=callPure('coreCommerceHpp',{...input,config:{...input.config,hppGroups:{}}}).models;
 raw.find(m=>m.nama==='Red').potong.totalPcs=101;raw.find(m=>m.nama==='Blue').potong.totalPcs=299;
 const before=JSON.stringify(raw),g=callPure('coreCommerceHppGroups',raw,input.config).groups[0];
 assert.deepEqual(g.referenceModelIds,[]);assert.equal(g.kain.totalPcs,0);assert.equal(g.potong.totalPcs,0);assert.equal(g.hppTotal,null);assert.equal(g.configured,false);assert.deepEqual(g.prices,{});assert.match(g.warnings.join(' '),/Red:|Blue:/);assert.equal(JSON.stringify(raw),before);
});

test('an XL label alone never admits missing, invalid or structurally untrusted costs',()=>{
 const input=fixtureInput(),raw=callPure('coreCommerceHpp',{...input,config:{...input.config,hppGroups:{}}}).models;
 for(const mutate of [m=>m.kain.complete=false,m=>m.potong.complete=false,m=>m.kain.totalCost=null,m=>m.potong.totalCost=-1,m=>m.kain.totalCost=Number.MAX_SAFE_INTEGER+1,m=>m.kain.totalPcs=0,m=>m.potong.totalPcs=1.5,m=>m.sourceWarnings=['Unresolved source']]){
  const changed=structuredClone(raw);mutate(changed.find(m=>m.nama==='Blue'));const before=JSON.stringify(changed),g=callPure('coreCommerceHppGroups',changed,input.config).groups[0];
  assert.deepEqual(g.referenceModelIds,[modelId('Red')]);assert.equal(g.kain.totalPcs,100);assert.equal(g.kain.totalCost,200000);assert.equal(g.potong.totalCost,90000);assert.equal(g.hppTotal,5800);assert.equal(g.configured,true);assert.match(g.warnings.join(' '),/Blue:/);assert.match(g.inheritedWarnings.join(' '),/Blue: Acuan kain dan potong XL/);assert.ok(g.inheritedWarnings.every(w=>g.warnings.includes(w)));assert.equal(JSON.stringify(changed),before);
 }
});

test('valid fabric and cutting evidence does not wait for individual sewing or cost approval',()=>{
 const input=fixtureInput();delete input.settings.upahJahit;input.tables.SlipKirim=[];input.config.modelConfigs={};
 const out=callPure('coreCommerceHpp',input),g=out.groups[0];
 for(const name of ['Red','Blue']){const m=out.models.find(m=>m.nama===name);assert.equal(m.jahit.complete,false);assert.equal(m.configSaved,false);assert.equal(m.configured,false);}
 assert.deepEqual(g.referenceModelIds,[modelId('Red'),modelId('Blue')]);assert.equal(g.kain.totalPcs,400);assert.equal(g.kain.totalCost,1100000);assert.equal(g.hppTotal,6700);assert.equal(g.configured,true);
});


function manyGroupsFixture(count,nearCellLimit=false){
 const f=serverFixture(),config={id:'config',...fixtureInput().config},extraPO=[];
 function nextGroup(i){const names=['Capacity '+i+' A','Capacity '+i+' B'];return {id:'hppg_capacity_'+i,nama:'Capacity group '+i,modelIds:names.map(modelId),config:null};}
 for(let i=1;i<=count;i++){
  const group=nextGroup(i);group.modelIds.forEach((id,j)=>extraPO.push({id:'capacityPO_'+i+'_'+j,series:'Fixture',nama:'Capacity '+i+' '+(j?'B':'A'),ukuranAktif:['M','L','XL']}));
  if(i<count)config.hppGroups[group.id]=group;
 }
 if(nearCellLimit){
  // Existing individual model settings remain stored when their models join a
  // group. Exercise the cell guard with valid saved costs, not a huge request.
  let last;
  for(let i=0;JSON.stringify(config).length<48650;i++){
   last=modelId('Retired model '+i);config.modelConfigs[last]=costs({ketLain:''});
  }
  config.modelConfigs[last].ketLain='x'.repeat(48900-JSON.stringify(config).length);
  assert.ok(config.modelConfigs[last].ketLain.length<=300);
  assert.equal(JSON.stringify(config).length,48900);
 }
 f.h.context.capacityConfig=config;f.h.context.capacityPO=extraPO;
 f.h.run("pkStore_().lock(function(){pkStore_().appendMany('PO',capacityPO);pkStore_().append('CommerceRecord',{id:coreCommerceKey('hpp','config','config'),module:'hpp',kind:'config',parentId:'',data:JSON.stringify(capacityConfig),revision:coreCommerceHash(capacityConfig),dibuat:'2026-10-01',dibuatOleh:'fixture',diubah:'2026-10-01',sourceHash:''});});void 0;");
 return {...f,nextGroup:nextGroup(count)};
}
function groupProductionSnapshot(f){return JSON.stringify(['PO','Potong','StokBahan','SlipKirim','CommerceEvent','CommerceSource','CommerceImport'].map(f.raw));}

for(const total of [21,100])test('HPP group '+total+' is saved and readable after a fresh server request',()=>{
 const f=manyGroupsFixture(total-1),before=groupProductionSnapshot(f),state=f.state();
 assert.equal(state.groups.length,total-1);
 const next=f.nextGroup,saved=f.good('saveCommerceHppGroup',{id:next.id,nama:next.nama,modelIds:next.modelIds,expectedRevision:state.revision,withState:true});
 assert.equal(saved.commerce.groups.length,total);assert.ok(saved.commerce.groups.some(g=>g.id===next.id));
 const fresh=f.state();assert.equal(fresh.groups.length,total);assert.deepEqual(fresh.config.hppGroups[next.id].modelIds,next.modelIds.slice().sort());
 assert.equal(Object.keys(JSON.parse(f.raw('CommerceRecord').find(r=>r.module==='hpp').data).hppGroups).length,total);
 assert.equal(groupProductionSnapshot(f),before);
});

test('HPP group 101 is rejected atomically while rename and removal still work at 100',()=>{
 const f=manyGroupsFixture(100),before=groupProductionSnapshot(f),state=f.state(),records=JSON.stringify(f.raw('CommerceRecord'));
 assert.equal(state.groups.length,100);
 const next=f.nextGroup;f.bad('saveCommerceHppGroup',{id:next.id,nama:next.nama,modelIds:next.modelIds,expectedRevision:state.revision},/Maksimal 100 kelompok HPP/);
 assert.equal(JSON.stringify(f.raw('CommerceRecord')),records);assert.equal(groupProductionSnapshot(f),before);
 const original=state.config.hppGroups[groupId];
 f.good('saveCommerceHppGroup',{id:groupId,nama:'Renamed at capacity',modelIds:original.modelIds,expectedRevision:state.revision});
 const renamed=f.state();assert.equal(renamed.groups.length,100);assert.equal(renamed.config.hppGroups[groupId].nama,'Renamed at capacity');assert.deepEqual(renamed.config.hppGroups[groupId].config,original.config);
 f.good('saveCommerceHppGroup',{id:groupId,remove:true,expectedRevision:renamed.revision});
 const removed=f.state();assert.equal(removed.groups.length,99);assert.equal(removed.config.hppGroups[groupId],undefined);assert.equal(removed.config.modelConfigs[modelId('Red')].hargaJahit,7777);
 assert.equal(groupProductionSnapshot(f),before);
});

test('the existing 49000 character cell guard rejects an oversized HPP config without partial writes',()=>{
 const f=manyGroupsFixture(20,true),before=groupProductionSnapshot(f),state=f.state(),records=JSON.stringify(f.raw('CommerceRecord'));
 assert.equal(state.groups.length,20);const next=f.nextGroup;
 f.bad('saveCommerceHppGroup',{id:next.id,nama:next.nama,modelIds:next.modelIds,expectedRevision:state.revision},/terlalu panjang/);
 assert.equal(JSON.stringify(f.raw('CommerceRecord')),records);assert.equal(groupProductionSnapshot(f),before);
 const after=f.state();assert.equal(after.revision,state.revision);assert.equal(after.groups.length,20);
});
