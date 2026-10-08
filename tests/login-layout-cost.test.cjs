'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('./helpers/apps-script-harness.cjs');
function fixture(){
  const h=harness(),setup=h.request('setupOwner',{nama:'Synthetic Owner',pin:'1234'});
  assert.equal(setup.ok,true,setup.error);
  const calls={reads:{},formats:0,writes:0,properties:0};
  for(const [name,sheet]of Object.entries(h.sheets)){
    const getRange=sheet.getRange.bind(sheet);
    sheet.getRange=(...args)=>{
      const r=getRange(...args),get=r.getValues.bind(r),set=r.setValues.bind(r),format=r.setNumberFormats.bind(r);
      r.getValues=()=>{calls.reads[name]=(calls.reads[name]||0)+1;return get();};
      r.setValues=rows=>{calls.writes++;return set(rows);};
      r.setNumberFormats=value=>{calls.formats++;return format(value);};return r;
    };
  }
  const props=h.context.PropertiesService.getScriptProperties(),setProps=props.setProperties.bind(props);
  props.setProperties=(...args)=>{calls.properties++;return setProps(...args);};
  h.events.length=0;h.cold();
  return {h,calls,userId:setup.data.state.me.id,login:()=>h.request('login',{userId:setup.data.state.me.id,pin:'1234',deferState:true})};
}
test('a code-only release performs one fresh account read and session commit, not every table header',()=>{
  const f=fixture(),previousMarker=f.h.properties.schema;
  f.h.run("APP_VERSION='9.9.9-code-only';");
  const r=f.login();assert.equal(r.ok,true,r.error);assert.equal(r.data.deferredState,true);assert.equal(r.data.appVersion,'9.9.9-code-only');
  assert.deepEqual(f.calls.reads,{Pegawai:1});assert.equal(f.calls.writes,1);assert.equal(f.calls.formats,1);assert.equal(f.calls.properties,1);
  assert.equal(f.h.events.filter(e=>e[0]==='lock').length,1,'only the actual auth lock is acquired');
  assert.equal(f.h.events.filter(e=>e[0]==='flush').length,1,'session is durably committed before success');
  assert.equal(f.h.properties.schema,previousMarker,'no redundant schema property mutation');
  assert.ok(Object.keys(f.h.cached).some(key=>key.includes('9.9.9-code-only:')),'row caches still belong to the new code version');
});
test('an actual layout change still checks all headers and installs columns before authentication',()=>{
  const f=fixture(),before=f.h.properties.schema;
  f.h.run("SCHEMA.PO.push('syntheticNewColumn');APP_VERSION='9.9.9-layout-change';");
  const r=f.login();assert.equal(r.ok,true,r.error);
  assert.ok(f.calls.reads.PO>=1);assert.ok(Object.keys(f.calls.reads).length>15);
  assert.ok(f.h.sheets.PO.values[0].includes('syntheticNewColumn'));
  assert.notEqual(f.h.properties.schema,before);assert.equal(f.h.properties.schema,f.h.run('pkSchema_()'));
  assert.equal(f.h.events.filter(e=>e[0]==='lock').length,2,'layout and fresh auth both remain locked');
});
test('missing or malformed setup evidence cannot bypass physical schema setup',()=>{
  for(const marker of ['', 'malformed', ':not-a-proof']){
    const f=fixture();f.h.properties.schema=marker;f.h.cold();
    const r=f.login();assert.equal(r.ok,true,r.error);assert.ok(Object.keys(f.calls.reads).length>15);
  }
});
test('layout reuse never accepts a stale PIN, disabled account or cached failed-attempt count',()=>{
  for(const change of ['pin','inactive','locked']){
    const f=fixture();f.h.run("APP_VERSION='9.9.9-code-only';");
    const sheet=f.h.sheets.Pegawai,head=sheet.values[0],row=sheet.values.find(r=>r[head.indexOf('id')]===f.userId);
    if(change==='pin')row[head.indexOf('pin')]='different-hash';
    if(change==='inactive')row[head.indexOf('aktif')]='FALSE';
    if(change==='locked'){row[head.indexOf('gagal')]=5;row[head.indexOf('kunci')]='2999-01-01T00:00:00.000Z';}
    const r=f.login();assert.ok(!r.ok||r.data.salah);assert.equal(r.data?.token,undefined);assert.equal(r.data?.me,undefined);
    assert.deepEqual(f.calls.reads,{Pegawai:1});
  }
});
