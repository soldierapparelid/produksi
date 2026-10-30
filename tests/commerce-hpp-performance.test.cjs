'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {harness}=require('./helpers/apps-script-harness.cjs');
function fixture(){
 const h=harness();for(const file of ['reconcile-legacy','commerce-hpp','slip-models','commerce'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/'+file+'.js'),'utf8'),h.context);
 const setup=h.request('setupOwner',{nama:'Owner Fixture',pin:'1234'});assert.equal(setup.ok,true,setup.error);const token=setup.data.token;
 h.run(`pkStore_().lock(function(){['Red','Blue'].forEach(function(name){pkStore_().append('PO',{id:'po'+name,series:'Fixture',nama:name,ukuranAktif:['M','L','XL'],ukuran:{}});pkStore_().append('Potong',{id:'cut'+name,poId:'po'+name,total:100,ukuran:{XL:100},tarif:900,bahanList:[{nama:'Fabric',qty:20,satuan:'kg'}],alokasiBahan:[{stokId:'roll'+name,qty:20}]});pkStore_().append('StokBahan',{id:'roll'+name,jenis:'beli',bahan:'Fabric',qty:20,satuan:'kg',harga:10000,total:200000,stockMode:'roll'});});});void 0;`);
 vm.runInContext(`var hppCalls=0,lookupCalls=0,originalHpp=coreCommerceHpp,originalLookup=coreCommerceLookup;coreCommerceHpp=function(input){hppCalls++;return originalHpp(input);};coreCommerceLookup=function(r,e){lookupCalls++;return originalLookup(r,e);};`,h.context);
 function call(action,p={}){h.cold();h.events.length=0;h.run('hppCalls=0;lookupCalls=0;void 0;');return h.request(action,{token,workflowVersion:2,...p});}
 function good(action,p={}){const r=call(action,p);assert.equal(r.ok,true,r.error);return r.data;}
 const state=()=>good('getCommerceState',{module:'hpp'});
 return {h,call,good,state};
}
const costs=()=>({jahitMode:'manual',hargaJahit:3000,biayaLain:2000,targetMargin:30,costSchema:2,costsReviewed:true,basisPolicy:'complete-legacy-v1'});
function assertSamePage(f,saved){assert.equal(saved.commerce.revision,saved.revision);assert.equal(saved.commerce.config._lastMutation,undefined);const page=f.state();assert.deepEqual(saved.commerce,page);}

test('warm HPP read batches cache access and skips purchase lookups, without altering data',()=>{
 const f=fixture(),cold=f.state(),warm=f.state();assert.deepEqual(warm,cold);assert.equal(f.h.run('hppCalls'),1);assert.equal(f.h.run('lookupCalls'),0);
 assert.ok(f.h.events.filter(e=>e[0]==='cache.get').length<=4,'at most account and HPP metadata/chunk batches');
 const bad=f.call('getCommerceState',{module:'hpp',token:'invalid'});assert.equal(bad.ok,false);assert.equal(f.h.run('hppCalls'),0);assert.ok(!f.h.events.some(e=>e[0]==='cache.get'&&e.some(k=>String(k).includes('|CommerceSource|'))),'HPP rows are not prefetched before authentication');
});

test('model save returns the committed page from one calculation; replay and old clients remain supported',()=>{
 const f=fixture(),st=f.state(),p={modelId:st.models[0].id,config:costs(),expectedRevision:st.revision,withState:true},saved=f.good('saveCommerceHpp',p);
 assert.equal(f.h.run('hppCalls'),1);assert.equal(saved.commerce.models[0].hppTotal,7900);assert.equal(saved.commerce.models[0].configured,true);assertSamePage(f,saved);
 const again=f.good('saveCommerceHpp',p);assert.equal(f.h.run('hppCalls'),1);assert.deepEqual(again,saved);
 const legacy=f.good('saveCommerceHpp',{modelId:st.models[1].id,config:costs(),expectedRevision:saved.revision});assert.deepEqual(Object.keys(legacy),['revision']);assert.equal(f.h.run('hppCalls'),1);
 const before=JSON.stringify(f.h.sheets.CommerceRecord.values),bad=f.call('saveCommerceHpp',{...p,config:{...costs(),hargaJahit:1}});assert.equal(bad.ok,false);assert.match(bad.error,/berubah/);assert.equal(JSON.stringify(f.h.sheets.CommerceRecord.values),before);
});

test('group create, cost edit, membership edit and removal each return a matching page without recomputing',()=>{
 const f=fixture(),st=f.state(),id='hppg_performance',p={id,nama:'Oblong fixture',modelIds:st.models.map(m=>m.id),expectedRevision:st.revision,withState:true};let saved=f.good('saveCommerceHppGroup',p);
 assert.equal(f.h.run('hppCalls'),1);assert.equal(saved.commerce.groups.length,1);assertSamePage(f,saved);
 saved=f.good('saveCommerceHpp',{modelId:id,config:costs(),expectedRevision:saved.revision,withState:true});assert.equal(f.h.run('hppCalls'),1);assert.equal(saved.commerce.groups[0].configured,true);assertSamePage(f,saved);
 saved=f.good('saveCommerceHppGroup',{...p,nama:'Updated fixture',expectedRevision:saved.revision});assert.equal(f.h.run('hppCalls'),1);assert.equal(saved.commerce.groups[0].nama,'Updated fixture');assertSamePage(f,saved);
 saved=f.good('saveCommerceHppGroup',{id,remove:true,expectedRevision:saved.revision,withState:true});assert.equal(f.h.run('hppCalls'),1);assert.equal(saved.commerce.groups.length,0);assertSamePage(f,saved);
});

test('marketplace settings calculate a page only when requested and reject incomplete imports',()=>{
 const f=fixture(),st=f.state();let saved=f.good('saveCommerceHppSettings',{pajak:2,marketplace:{shop:{nama:'Shop',fee:10,fixedPerPcs:500}},expectedRevision:st.revision,withState:true});assert.equal(f.h.run('hppCalls'),1);assertSamePage(f,saved);
 saved=f.good('saveCommerceHppSettings',{pajak:3,expectedRevision:saved.revision});assert.equal(f.h.run('hppCalls'),0);assert.deepEqual(Object.keys(saved),['revision']);
 f.h.run(`pkStore_().lock(function(){pkStore_().append('CommerceImport',{id:'pending',status:'started'});});void 0;`);const before=JSON.stringify(f.h.sheets.CommerceRecord.values),bad=f.call('saveCommerceHppSettings',{pajak:4,expectedRevision:saved.revision,withState:true});assert.equal(bad.ok,false);assert.match(bad.error,/Impor/);assert.equal(JSON.stringify(f.h.sheets.CommerceRecord.values),before);
});
