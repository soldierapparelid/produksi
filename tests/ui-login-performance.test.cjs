'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p);return html.slice(p,q);}
function snapshot(mode){
  const c=vm.createContext({console});
  vm.runInContext(`var mode=${JSON.stringify(mode)},division='',UI_VERSION='1.4.2',timers=[],kv={},ls={},snapshotResult;
    var Api={mode:function(){return mode;},div:function(){return division;}};
    var S={token:'session-example',lastSync:100,state:{me:{id:'owner',divisi:'owner'},settings:{},po:[],users:[]}};
    var Idb={get:function(s,k,fn){fn(kv[k]);},put:function(s,k,v){kv[k]=v;},del:function(s,k){delete kv[k];}};
    var LS={set:function(k,v){ls[k]=v;},get:function(k){return ls[k];}};
    var document={addEventListener:function(){}},window={addEventListener:function(){}};
    function setTimeout(fn){timers.push(fn);return timers.length;}function clearTimeout(){}
    function coreParseJSON(s,f){try{return JSON.parse(s);}catch(e){return f;}}
  `,c);
  vm.runInContext(part('var SNAP_SEGAR =','/* dariSimpanan ='),c);
  return c;
}
test('Apps Script and PWA reopen the same authenticated snapshot while demo and other sessions cannot',()=>{
  for(const mode of ['gas','remote']){
    const c=snapshot(mode);
    vm.runInContext('simpanSnap();timers.shift()();bacaSnap(function(v){snapshotResult=v;});',c);
    assert.equal(vm.runInContext('snapshotResult.state.me.id',c),'owner');
    vm.runInContext("S.token='different-session';bacaSnap(function(v){snapshotResult=v;});",c);
    assert.equal(vm.runInContext('snapshotResult',c),null);
    vm.runInContext("S.token='session-example';division='jahit';kv.pks_jahit=kv.pks_pusat;bacaSnap(function(v){snapshotResult=v;});",c);
    assert.equal(vm.runInContext('snapshotResult',c),null,'locked worker division rejects owner snapshot');
    vm.runInContext("division='';UI_VERSION='new-version';bacaSnap(function(v){snapshotResult=v;});",c);
    assert.equal(vm.runInContext('snapshotResult',c),null,'new UI must not reuse incompatible state');
    vm.runInContext('hapusSnap();',c);
    assert.equal(vm.runInContext('kv.pks_pusat',c),undefined);
  }
  const d=snapshot('demo');vm.runInContext('simpanSnap();bacaSnap(function(v){snapshotResult=v;});',d);
  assert.equal(vm.runInContext('timers.length',d),0);assert.equal(vm.runInContext('snapshotResult',d),null);
});
test('login choices are available from local cache in Apps Script without caching tokens or PINs',()=>{
  const c=snapshot('gas');
  vm.runInContext("simpanBoot({needSetup:false,namaUsaha:'Contoh',appVersion:'1.4.2',users:[{id:'x',nama:'Contoh',divisi:'owner'}],token:'not-cached',state:{privateData:true}});var bootResult=bacaBoot();",c);
  assert.equal(vm.runInContext('bootResult.users[0].nama',c),'Contoh');
  assert.equal(vm.runInContext('bootResult.token',c),undefined);assert.equal(vm.runInContext('bootResult.state',c),undefined);
});
function login(){
  const c=vm.createContext({console});
  vm.runInContext(`var A={},APP_VERSION='1.4.2',calls=0,renders=0,synced=0,applied=0,writes={},resolveLogin,rejectLogin,waitTimers={},timerId=0,marks=[];
    var S={token:'',gate:{user:{id:'example'},pin:'1234',err:''}};
    var Api={call:function(){calls++;return new Promise(function(resolve,reject){resolveLogin=resolve;rejectLogin=reject;});}};
    var LS={set:function(k,v){writes[k]=v;}};
    function tokenKey(){return 'token';}function lastKey(){return 'last';}function render(){renders++;}
    function applyState(){applied++;}function startSync(){synced++;}
    function setTimeout(fn,ms){var id=++timerId;waitTimers[id]={fn:fn,ms:ms};return id;}function clearTimeout(id){delete waitTimers[id];}
    function tanda(name){marks.push(name);}`,c);
  vm.runInContext(part('A.pinGo = function','A.setup = function'),c);return c;
}
test('PIN submit starts visible loading immediately, rejects duplicate taps and opens only after server success',async()=>{
  const c=login();const done=vm.runInContext('A.pinGo()',c);
  assert.equal(vm.runInContext('S.gate.sending',c),true);assert.equal(vm.runInContext('renders',c),1);
  vm.runInContext('A.pinGo()',c);assert.equal(vm.runInContext('calls',c),1);
  assert.equal(vm.runInContext('applied',c),0);
  vm.runInContext("resolveLogin({token:'verified-session',state:{me:{id:'example'}}})",c);await done;
  assert.equal(vm.runInContext('S.token',c),'verified-session');assert.equal(vm.runInContext('applied',c),1);
});
test('incorrect PIN resets the loading state and a superseded login cannot restore an old user',async()=>{
  const c=login();const done=vm.runInContext('A.pinGo()',c);
  vm.runInContext("resolveLogin({salah:true,pesan:'PIN salah.'})",c);await done;
  assert.equal(vm.runInContext('S.gate.sending',c),false);assert.equal(vm.runInContext('S.gate.pin',c),'');
  assert.equal(vm.runInContext('S.token',c),'');assert.equal(vm.runInContext('S.gate.err',c),'PIN salah.');
  const d=login();const other=vm.runInContext('A.pinGo()',d);
  vm.runInContext("S.gate={user:null,pin:''};resolveLogin({token:'late-session',state:{}})",d);await other;
  assert.equal(vm.runInContext('S.token',d),'');assert.equal(vm.runInContext('applied',d),0);
});

test('long login shows a waiting explanation without resending PIN, and success clears its timer',async()=>{
  const c=login(),done=vm.runInContext('A.pinGo()',c);
  assert.equal(vm.runInContext('waitTimers[1].ms',c),6000);
  vm.runInContext('waitTimers[1].fn();A.pinGo()',c);
  assert.equal(vm.runInContext('S.gate.waitingLong',c),true);assert.equal(vm.runInContext('calls',c),1);assert.equal(vm.runInContext('applied',c),0);
  assert.match(part('function gateHtml()', 'function connectLink('),/Masih menunggu jawaban server/);
  vm.runInContext("resolveLogin({token:'verified',state:{me:{id:'example'}}})",c);await done;
  assert.equal(vm.runInContext('Object.keys(waitTimers).length',c),0);assert.equal(vm.runInContext('calls',c),1);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(marks)',c)),['pk-pin-kirim','pk-pin-server','pk-pin-tampil']);
});

test('incomplete or wrong-user login response never caches a session and permits a deliberate fresh attempt',async()=>{
  for(const response of [{token:'x'},{token:'x',state:{me:{id:'someone-else'}}},null]){
    const c=login(),done=vm.runInContext('A.pinGo()',c);
    vm.runInContext(`resolveLogin(${JSON.stringify(response)})`,c);await done;
    assert.equal(vm.runInContext('S.token',c),'');assert.equal(vm.runInContext('applied',c),0);assert.equal(vm.runInContext('Object.keys(writes).length',c),0);
    assert.equal(vm.runInContext('S.gate.sending',c),false);assert.match(vm.runInContext('S.gate.err',c),/masukkan PIN dan coba lagi/);
    assert.equal(vm.runInContext('Object.keys(waitTimers).length',c),0);
  }
});

test('a bootstrap change to the selected user cannot accept a stale login in the same gate object',async()=>{
  for(const replacement of ['null',"{id:'another-user'}"]){
    const c=login(),done=vm.runInContext('A.pinGo()',c);
    vm.runInContext(`S.gate.user=${replacement};resolveLogin({token:'old-user-session',state:{me:{id:'example'}}})`,c);
    await done;
    assert.equal(vm.runInContext('S.token',c),'');assert.equal(vm.runInContext('applied',c),0);
    assert.equal(vm.runInContext('S.gate.sending',c),false);
    assert.equal(vm.runInContext('Object.keys(writes).length',c),0);
  }
  const c=login(),done=vm.runInContext('A.pinGo()',c);
  vm.runInContext("S.gate.user={id:'example',nama:'Updated display name'};resolveLogin({token:'valid-session',state:{me:{id:'example'}}})",c);
  await done;
  assert.equal(vm.runInContext('writes.last',c),'example');assert.equal(vm.runInContext('applied',c),1);
});

test('a delayed login error does not clear the newly selected user PIN',async()=>{
  const c=login(),done=vm.runInContext('A.pinGo()',c);
  vm.runInContext("S.gate.user={id:'another-user'};S.gate.pin='5678';rejectLogin(new Error('Old request failed'))",c);
  await done;
  assert.equal(vm.runInContext('S.gate.sending',c),false);
  assert.equal(vm.runInContext('S.gate.pin',c),'5678');assert.equal(vm.runInContext('S.gate.err',c),'');
});

function indexedDb(){
  const timers=new Map(),transactions=[],received=[];let serial=0;
  const opened={},db={transaction(){
    const get={},cursor={},tx={objectStore(){return {get:()=>get,openCursor:()=>cursor};}};
    transactions.push({get,cursor,tx});return tx;
  }};
  opened.result=db;
  const c=vm.createContext({console,received,
    window:{indexedDB:{open:()=>opened}},
    setTimeout(fn,delay){const id=++serial;timers.set(id,{fn,delay});return id;},
    clearTimeout(id){timers.delete(id);}
  });
  vm.runInContext(part('var Idb = (function () {','var LS = (function () {'),c);
  function expire(){for(const [id,timer] of [...timers]){timers.delete(id);timer.fn();}}
  return {c,opened,transactions,received,timers,expire};
}

test('a stalled IndexedDB snapshot read falls back within the transaction deadline and ignores late success',()=>{
  const h=indexedDb();
  vm.runInContext("Idb.get('kv','pks_pusat',function(v){received.push(v);});",h.c);
  h.opened.onsuccess();
  assert.equal(h.received.length,0);assert.equal(h.transactions.length,1);
  assert.equal([...h.timers.values()][0].delay,1500);
  h.expire();
  assert.deepEqual(h.received,[undefined]);assert.equal(h.timers.size,0);
  const rq=h.transactions[0].get;rq.result={stale:true};rq.onsuccess();
  assert.deepEqual(h.received,[undefined],'a late snapshot cannot start a second boot');
});

test('a stalled IndexedDB startup cursor releases startup once and does not mutate its result later',()=>{
  const h=indexedDb();let continued=0;
  vm.runInContext("Idb.all('kv',function(v){received.push(v);},'pk_');",h.c);
  h.opened.onsuccess();
  const rq=h.transactions[0].cursor;
  rq.result={key:'pk_last',value:'example',continue(){continued++;}};rq.onsuccess();
  assert.equal(h.received.length,0);assert.equal(continued,1);
  h.expire();
  assert.equal(h.received.length,1);assert.equal(h.received[0].pk_last,'example');
  rq.result={key:'pk_token',value:'late-token',continue(){continued++;}};rq.onsuccess();
  assert.equal(h.received.length,1);assert.equal(h.received[0].pk_token,undefined);assert.equal(continued,1);
});

test('IndexedDB success and transaction errors settle once and cancel fallback timers',()=>{
  const h=indexedDb();
  vm.runInContext("Idb.get('kv','pks_pusat',function(v){received.push(v);});",h.c);
  h.opened.onsuccess();
  const first=h.transactions[0];first.get.result={valid:true};first.get.onsuccess();
  assert.equal(h.received[0].valid,true);assert.equal(h.timers.size,0);
  first.tx.onerror();assert.equal(h.received.length,1);
  vm.runInContext("Idb.get('kv','missing',function(v){received.push(v);});",h.c);
  h.transactions[1].tx.onerror();
  assert.equal(h.received.length,2);assert.equal(h.received[1],undefined);assert.equal(h.timers.size,0);
  vm.runInContext("Idb.all('kv',function(v){received.push(v);});",h.c);
  h.transactions[2].cursor.result=null;h.transactions[2].cursor.onsuccess();
  assert.equal(h.received.length,3);assert.equal(h.timers.size,0);
  h.expire();assert.equal(h.received.length,3);
});
