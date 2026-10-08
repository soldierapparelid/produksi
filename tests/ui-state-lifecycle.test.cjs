'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
function harness(){
 const requests=[],c=vm.createContext({console,call(action,payload){return new Promise((resolve,reject)=>requests.push({action,payload,resolve,reject}));}});
 vm.runInContext(`var A={},S={token:'worker-session',state:{me:{id:'worker',divisi:'potong'},ver:10,workflowVersion:2,po:[],potong:[],trimmed:true},seq:0,busy:0,wantAll:false},messages=[],refreshes=0,snapshots=0,indexes=0,paints=0,syncCalls=0;
 var Api={call:call,mode:function(){return 'gas';},div:function(){return '';}};var LS={get:function(){},set:function(){}};
 function simpanSnap(){snapshots++;}function index(){indexes++;}function coreIsAdmin(){return false;}function refresh(){refreshes++;}function paintSync(){paints++;}function toast(message,bad){messages.push({message:message,bad:!!bad});}function quiet(){}function signOutLocal(){}function sync(){syncCalls++;return Promise.resolve();}
 `,c);
 vm.runInContext(part('function applyState(', 'function signOutLocal('),c);
 vm.runInContext(part('function act(', '/* ---------- gambar ulang'),c);
 vm.runInContext(part('var loadAllRequest =','/* ---------- detail PO'),c);
 const run=code=>vm.runInContext(code,c);return {c,requests,run,json:code=>JSON.parse(run('JSON.stringify('+code+')'))};
}
function state(ver=11,all=false){return {me:{id:'worker',divisi:'potong'},ver,workflowVersion:2,po:[{id:'current'}],potong:all?[{id:'old-cut'}]:[],semua:all,trimmed:!all};}

test('late mutation snapshots cannot roll back a newer committed version, while both mutation results resolve',async()=>{
 const h=harness(),one=h.run("req('createPotong',{potong:{id:'first'}})"),two=h.run("req('createPotong',{potong:{id:'second'}})");
 h.requests[1].resolve({state:state(12),data:{id:'second'}});assert.equal((await two).id,'second');const seq=h.run('S.seq');
 h.requests[0].resolve({state:state(11),data:{id:'first'}});assert.equal((await one).id,'first');assert.equal(h.run('S.state.ver'),12);assert.equal(h.run('S.seq'),seq);assert.equal(h.run('snapshots'),1);assert.equal(h.run('indexes'),1);assert.equal(h.run('S.busy'),0);
});

test('explicit history load performs one full read despite a light sync and coalesces repeated taps',async()=>{
 const h=harness();h.run('var syncing=true');const first=h.run('A.loadAll(null)'),again=h.run('A.loadAll(null)');assert.equal(first,again);assert.equal(h.requests.length,1);assert.equal(h.requests[0].action,'getState');assert.equal(h.requests[0].payload.semua,true);assert.equal(h.run('syncCalls'),0);assert.equal(h.run('S.wantAll'),false);
 h.requests[0].resolve(state(11,true));await first;assert.equal(h.run('S.wantAll'),true);assert.equal(h.run('S.state.potong[0].id'),'old-cut');assert.equal(h.run('S.busy'),0);assert.match(h.json('messages').at(-1).message,/Semua data lama dimuat/);
});

test('failed and incomplete history reads keep the current snapshot and never claim complete history',async()=>{
 for(const failure of ['network','trimmed','wrong-user']){const h=harness(),done=h.run('A.loadAll(null)');if(failure==='network')h.requests[0].reject(Object.assign(new Error('Server belum menjawab'),{net:true,timeout:true}));else{const incoming=state(11,failure==='wrong-user');if(failure==='wrong-user')incoming.me.id='someone-else';h.requests[0].resolve(incoming);}await done;assert.equal(h.run('S.state.ver'),10);assert.equal(h.run('S.wantAll'),false);assert.equal(h.run('S.busy'),0);assert.equal(h.run('loadAllRequest'),null);assert.ok(h.json('messages').some(m=>m.bad));assert.ok(h.json('messages').every(m=>!m.message.includes('Semua data lama dimuat')));}
});

test('a concurrent save makes an older history read visibly retryable rather than replacing current quantities',async()=>{
 const h=harness(),done=h.run('A.loadAll(null)');h.run('applyState('+JSON.stringify(state(13,false))+')');h.requests[0].resolve(state(12,true));await done;assert.equal(h.run('S.state.ver'),13);assert.equal(h.run('S.wantAll'),false);assert.match(h.json('messages').at(-1).message,/Data berubah/);
 const retry=h.run('A.loadAll(null)');h.requests[1].resolve(state(13,true));await retry;assert.equal(h.run('S.state.semua'),true);assert.equal(h.run('S.wantAll'),true);
});

test('logout or a different authenticated account prevents a late history read from becoming visible',async()=>{
 const h=harness(),done=h.run('A.loadAll(null)');h.run("S.token='new-session';S.state={me:{id:'new-user',divisi:'jahit'},ver:1}");h.requests[0].resolve(state(11,true));await done;assert.equal(h.run('S.state.me.id'),'new-user');assert.equal(h.run('S.state.ver'),1);assert.equal(h.run('S.wantAll'),false);assert.equal(h.run('snapshots'),0);
});

test('state version guard allows a different authenticated account and a same-version complete history snapshot',()=>{
 const h=harness();assert.equal(h.run('applyState('+JSON.stringify(state(10,true))+')'),true);assert.equal(h.run('S.state.semua'),true);const other=state(1);other.me.id='other';assert.equal(h.run('applyState('+JSON.stringify(other)+')'),true);assert.equal(h.run('S.state.me.id'),'other');
});

test('an already-running mutation cannot downgrade same-version complete history after loadAll succeeds',async()=>{
 const h=harness(),saving=h.run("req('createPotong',{potong:{id:'inflight'}})"),history=h.run('A.loadAll(null)');
 h.requests[1].resolve({...state(11,true),appVersion:'1.4.7'});await history;const seq=h.run('S.seq');
 h.requests[0].resolve({state:{...state(11,false),appVersion:'1.4.7'},data:{id:'inflight'}});assert.equal((await saving).id,'inflight');
 assert.equal(h.run('S.state.semua'),true);assert.equal(h.run('S.state.potong[0].id'),'old-cut');assert.equal(h.run('S.seq'),seq);assert.equal(h.run('S.wantAll'),true);assert.equal(h.run('S.busy'),0);
});

test('newer business data remains authoritative and the next light sync requests full history without same-version shortcut',async()=>{
 const h=harness();h.run('applyState('+JSON.stringify(state(11,true))+');S.wantAll=true;applyState('+JSON.stringify(state(12,false))+')');assert.equal(h.run('S.state.ver'),12);assert.equal(h.run('S.state.semua'),false);
 h.run("var document={hidden:false},APP_VERSION='1.4.7';function tanda(){}");vm.runInContext(part('var syncTimer =','function startSync()'),h.c);
 const sync=h.run('sync(false)');assert.equal(h.requests[0].action,'sync');assert.equal(h.requests[0].payload.semua,true);assert.equal(h.requests[0].payload.ver,undefined);h.requests[0].resolve(state(12,true));await sync;assert.equal(h.run('S.state.semua'),true);
});

test('a lower-version reply for the same account cannot restore its previous role',()=>{
 const h=harness(),newer={...state(13),me:{id:'worker',divisi:'jahit'}},old={...state(12),me:{id:'worker',divisi:'owner'}};
 h.run('applyState('+JSON.stringify(newer)+')');assert.equal(h.run('applyState('+JSON.stringify(old)+')'),false);assert.equal(h.run('S.state.me.divisi'),'jahit');assert.equal(h.run('S.state.ver'),13);
});
