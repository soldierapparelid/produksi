'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./helpers/apps-script-harness.cjs');

test('state derives workflow once and sync still authenticates unchanged data',()=>{
  const h=harness();
  const setup=h.request('setupOwner',{nama:'Pemilik Contoh',pin:'1234'});
  assert.equal(setup.ok,true,setup.error);
  h.run('var flowCalls=0, savedWorkflow=coreWorkflow; coreWorkflow=function(){flowCalls++;return savedWorkflow.apply(null,arguments);};0;');
  h.cold();
  const state=h.request('getState',{token:setup.data.token});
  assert.equal(state.ok,true,state.error);
  assert.equal(h.run('flowCalls'),1,'aggregate and workflow reuse the same projection');
  const payload={token:setup.data.token,ver:state.data.ver,av:state.data.appVersion};
  h.cold();const same=h.request('sync',payload);
  assert.equal(same.data.same,true);
  h.cold();const denied=h.request('sync',{...payload,token:'invalid-token-12345678'});
  assert.equal(denied.ok,false);
  assert.match(denied.error,/Sesi berakhir/);
  h.run('pkStore_().lock(function(){var u=pkStore_().read("Pegawai")[0];pkStore_().update("Pegawai",u.id,{aktif:false});});');
  h.cold();assert.equal(h.request('sync',payload).ok,false,'inactive user cannot use the fast same-version response');
});
