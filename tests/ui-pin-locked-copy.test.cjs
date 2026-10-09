'use strict';
/* The locked device copy uses the real Web Crypto of the runtime: nothing here is mocked except storage. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
const start=html.indexOf('var KUNCI_UMUR ='),end=html.indexOf('/* dariSimpanan =',start);
assert.ok(start>0&&end>start,'locked copy module exists');
const MARK='RAHASIA-PRODUKSI-CONTOH',BASE=Date.now()-600000;
function device(){
  const c=vm.createContext({console,crypto:globalThis.crypto,TextEncoder,TextDecoder});
  vm.runInContext(`var mode='remote',division='',UI_VERSION='ui-test',kv={},removed=[];
    var Api={mode:function(){return mode;},div:function(){return division;}};
    var Idb={get:function(s,k,fn){fn(kv[k]);},put:function(s,k,v){kv[k]=v;},del:function(s,k){removed.push(k);delete kv[k];},all:function(s,fn,awalan){var o={};Object.keys(kv).forEach(function(k){if(!awalan||k.indexOf(awalan)===0)o[k]=kv[k];});fn(o);}};
    var S={token:'session-one',lastSync:${BASE},state:{me:{id:'worker',divisi:'jahit'},settings:{namaUsaha:'Contoh'},po:[{id:'po1',nama:'${MARK}'}],users:[],ver:7}};`,c);
  vm.runInContext(html.slice(start,end),c);
  const run=code=>vm.runInContext(code,c);
  return {c,run,open:(id,pin)=>run(`kunciBuka(${JSON.stringify(id)},${JSON.stringify(pin)})`),bytes:buf=>Buffer.from(new Uint8Array(buf)).toString('latin1')};
}
test('the copy opens only with the PIN the server accepted, and nothing readable is stored',async()=>{
  const d=device();const rec=await d.run("kunciSiapkan('worker','4821')");assert.ok(rec&&rec.c&&rec.k,'the copy is written as soon as the lock exists');
  const stored=d.run('kv.pkl_pusat_worker');assert.equal(stored.u,'worker');assert.equal(stored.at,BASE);
  for(const part of [stored.c,stored.k,stored.priv,stored.pub])assert.ok(!d.bytes(part).includes(MARK));assert.ok(!JSON.stringify(Object.keys(stored)).includes('pin'));assert.ok(!d.bytes(stored.priv).includes('4821'));
  const hit=await d.open('worker','4821');assert.equal(hit.at,BASE);assert.equal(hit.state.po[0].nama,MARK);assert.equal(hit.state.ver,7);
  for(const pin of ['4822','0000','48210',''])assert.equal(await d.open('worker',pin),null,'PIN '+pin);
  assert.equal(await d.open('someone-else','4821'),null);
});
test('the copy follows later data without the PIN, and a new PIN replaces the old lock',async()=>{
  const d=device();await d.run("kunciSiapkan('worker','4821')");
  d.run(`S.state=Object.assign({},S.state,{ver:8,po:[{id:'po2',nama:'Baru'}]});S.lastSync=${BASE+2000};`);assert.equal(await d.run('kunciTulis()'),true);
  let hit=await d.open('worker','4821');assert.equal(hit.state.ver,8);assert.equal(hit.at,BASE+2000);
  /* the app is reopened with a saved session: no PIN in memory, the existing lock keeps being used */
  d.run(`kunciAktif=null;kunciLanjut();S.state=Object.assign({},S.state,{ver:9});S.lastSync=${BASE+3000};`);assert.equal(await d.run('kunciTulis()'),true);hit=await d.open('worker','4821');assert.equal(hit.state.ver,9);
  await d.run("kunciSiapkan('worker','7755')");assert.equal(await d.open('worker','4821'),null,'the old PIN no longer opens anything');assert.equal((await d.open('worker','7755')).state.ver,9);
});
test('nothing is written for a signed-out screen, a full-history view, another account, or demo mode',async()=>{
  const d=device();await d.run("kunciSiapkan('worker','4821')");const before=d.run('kv.pkl_pusat_worker.at');
  for(const change of ["S.token=''","S.state=Object.assign({},S.state,{semua:true})","S.state=Object.assign({},S.state,{me:{id:'other',divisi:'jahit'}})","S.state=null"]){const x=device();await x.run("kunciSiapkan('worker','4821')");x.run(change+';S.lastSync='+(BASE+9000)+';');assert.equal(await x.run('kunciTulis()'),false,change);assert.equal(x.run('kv.pkl_pusat_worker.at'),before,change);}
  const demo=device();demo.run("mode='demo'");assert.equal(await demo.run("kunciSiapkan('worker','4821')"),null);assert.equal(demo.run('Object.keys(kv).length'),0);assert.equal(await demo.open('worker','4821'),null);
});
test('an old, foreign, tampered or other-version copy is never opened, and removal is per account and division',async()=>{
  const d=device();await d.run("kunciSiapkan('worker','4821')");
  d.run("UI_VERSION='newer-ui'");assert.equal(await d.open('worker','4821'),null,'another app version');d.run("UI_VERSION='ui-test'");
  d.run("division='potong';kv.pkl_potong_worker=kv.pkl_pusat_worker;");assert.equal(await d.open('worker','4821'),null,'a division window refuses another division’s data');d.run("division=''");
  d.run("kv.pkl_pusat_worker.at=Date.now()-15*86400000");assert.equal(await d.open('worker','4821'),null,'older than fourteen days');d.run('kv.pkl_pusat_worker.at='+BASE);
  assert.ok(await d.open('worker','4821'));d.run("new Uint8Array(kv.pkl_pusat_worker.c)[10]^=255");assert.equal(await d.open('worker','4821'),null,'changed bytes are rejected, not shown');
  d.run("kv.other_app_key='kept';kunciHapus('worker')");assert.equal(d.run('kv.pkl_pusat_worker'),undefined);assert.equal(d.run('kv.other_app_key'),'kept');assert.equal(d.run('kunciAktif'),null);assert.deepEqual(JSON.parse(d.run('JSON.stringify(removed)')),['pkl_pusat_worker']);
});
test('connecting the device to another data source removes every locked copy and nothing else',async()=>{
  const d=device();await d.run("kunciSiapkan('worker','4821')");d.run("kv.pkl_qc_other={v:1};kv.pks_pusat={t:'x'};kv.pk_other='kept';kunciHapusSemua();");
  assert.deepEqual(d.run('Object.keys(kv).sort().join()'),'pk_other,pks_pusat');assert.equal(d.run('kunciAktif'),null);assert.equal(await d.open('worker','4821'),null);
});