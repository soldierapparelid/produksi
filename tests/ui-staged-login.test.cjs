'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
function harness(){
  const requests=[],timers=new Map();let serial=0;
  const c=vm.createContext({console,setTimeout(fn,ms){const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},call(action,payload){return new Promise((resolve,reject)=>requests.push({action,payload,resolve,reject}));}});
  vm.runInContext(`var A={},APP_VERSION='1.4.4',SNAP_SEGAR=60000,division='',renders=[],marks=[],applied=[],synced=0,signedOut=0,closed=0,toasts=[],writes={},cachedBoot=null,bootSaved=[];
    var S={token:'',state:null,sessionLoad:null,gate:{user:{id:'worker'},pin:'1234',err:''},seq:0,sub:{},f:{q:''},boot:{namaUsaha:'Contoh'},wantAll:false};
    var D={user:{old:{nama:'Previous private account'}},po:{old:{nama:'Old production'}},produk:{}};
    var Api={call:call,div:function(){return division;},mode:function(){return 'gas';}};
    var LS={set:function(k,v){writes[k]=v;},get:function(k){return writes[k];},del:function(k){delete writes[k];}};
    var TABS={admin:[{icon:'home',label:'Beranda'}],jahit:[{icon:'cut',label:'Jahit'}],potong:[{icon:'cut',label:'Potong'}]};
    var window={},snapshotRemoved=0;
    function tokenKey(){return 'token';}function lastKey(){return 'last';}
    function render(){renders.push(S.state?'DATA':S.sessionLoad?sessionLoadingHtml():'GATE');}
    function applyState(st){S.state=st;applied.push(st);}function startSync(){synced++;}function closeAll(){closed++;}
    function tanda(n){marks.push(n);}function toast(n){toasts.push(n);}function coreIsAdmin(u){return u.divisi==='owner'||u.divisi==='admin';}
    function esc(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
    function appLabel(d){return d||'Produksi';}function logoImg(){return '<i>Logo</i>';}function inisial(n){return String(n||'').slice(0,1);}function ic(){return '<i></i>';}
    function signOutLocal(){clearSessionLoad();S.token='';S.state=null;signedOut++;}function hapusSnap(){snapshotRemoved++;}
    function bacaBoot(){return cachedBoot;}function simpanBoot(b){bootSaved.push(b);}function pilihTerakhir(){}function gateDepan(){return false;}function sync(){return Promise.resolve();}function seedDemo(){}
    var warmed=0;function panaskan(){warmed++;}
    var KUNCI_TUNGGU=20000,lockedCopy=null,lockMade=[],lockRemoved=[],forcedSyncs=0;function kunciBuka(){return Promise.resolve(lockedCopy);}function kunciSiapkan(id,pin){lockMade.push(id);return Promise.resolve(null);}function kunciHapus(id){lockRemoved.push(id);}
  `,c);
  vm.runInContext(part('function clearSessionLoad()','A.setup = function'),c);
  vm.runInContext(part('var bootKe = 0;','/* Data contoh'),c);
  const run=code=>vm.runInContext(code,c);
  return {run,c,requests,timers};
}
function deferred(id='worker',divisi='jahit',token='verified-token'){return {deferredState:true,token,me:{id,divisi,nama:'<Worker>'},appVersion:'1.4.4',workflowVersion:2,contractVersion:2};}
function state(id='worker',divisi='jahit'){return {me:{id,divisi,nama:'Worker'},settings:{namaUsaha:'Contoh'},po:[],users:[],produk:[],potong:[],kirim:[],setor:[],qc:[],gudang:[],upah:[],workflowVersion:2};}
async function authenticate(h){const done=h.run('A.pinGo()');h.requests[0].resolve(deferred());await done;return h.run('S.sessionLoad');}

test('verified PIN opens a data-free shell before the single data request resolves',async()=>{
  const h=harness(),model=await authenticate(h);
  assert.equal(h.requests[0].action,'login');assert.equal(h.requests[0].payload.deferState,true);
  assert.equal(h.requests.length,2);assert.equal(h.requests[1].action,'getState');assert.equal(h.requests[1].payload.token,'verified-token');
  assert.equal(h.run('S.state'),null);assert.equal(h.run('applied.length'),0);assert.equal(h.run('synced'),0);
  const rendered=h.run('renders[renders.length-1]');
  assert.match(rendered,/Sesi terverifikasi/);assert.match(rendered,/Memuat data produksi/);assert.match(rendered,/&lt;Worker&gt;/);
  assert.match(rendered,/<button disabled aria-disabled="true"/);assert.doesNotMatch(rendered,/data-a="tab"|data-a="sessionRetry"|Rp|Previous private|Old production/);
  assert.equal(h.run('Object.keys(D.po).length'),0);assert.equal(h.run('writes.token'),'verified-token');
  h.run('A.sessionRetry();boot()');assert.equal(h.requests.length,2,'duplicate refresh or boot must not duplicate data request');
  h.requests[1].resolve(state());await model.request;
  assert.equal(h.run('S.state.me.id'),'worker');assert.equal(h.run('S.sessionLoad'),null);assert.equal(h.run('applied.length'),1);assert.equal(h.run('synced'),1);
  assert.equal(h.timers.size,0);assert.equal(h.run('renders[renders.length-1]'),'DATA');
});

test('data failure keeps authenticated identity and retries only a read without repeating PIN',async()=>{
  const h=harness(),model=await authenticate(h);
  const timer=[...h.timers.values()].find(x=>x.ms===6000);assert.ok(timer);timer.fn();assert.equal(h.run('S.sessionLoad.slow'),true);
  h.requests[1].reject(new Error('Jaringan terputus'));await model.request;
  assert.equal(h.run('S.token'),'verified-token');assert.equal(h.run('signedOut'),0);assert.equal(h.run('S.state'),null);
  assert.match(h.run('renders[renders.length-1]'),/Coba muat data lagi/);assert.match(h.run('renders[renders.length-1]'),/Jaringan terputus/);
  const done=h.run('A.sessionRetry()');assert.equal(h.requests.length,3);assert.equal(h.requests[2].action,'getState');assert.equal(h.requests[2].payload.pin,undefined);
  h.requests[2].resolve(state());await done;assert.equal(h.run('applied.length'),1);assert.equal(h.requests.filter(r=>r.action==='login').length,1);
});

test('mismatched account and changed role force fresh authentication without exposing production views',async()=>{
  for(const bad of [state('another'),state('worker','owner')]){
    const h=harness(),model=await authenticate(h);h.requests[1].resolve(bad);await model.request;
    assert.equal(h.run('S.state'),null);assert.equal(h.run('applied.length'),0);assert.equal(h.run('signedOut'),1);assert.equal(h.run('S.sessionLoad'),null);assert.equal(h.run('S.token'),'');
  }
});

test('incomplete production data offers a read retry without discarding verified identity',async()=>{
  const h=harness(),model=await authenticate(h);h.requests[1].resolve({me:{id:'worker',divisi:'jahit'}});await model.request;
  assert.equal(h.run('S.state'),null);assert.equal(h.run('applied.length'),0);assert.equal(h.run('signedOut'),0);assert.match(h.run('S.sessionLoad.error'),/belum lengkap/);
});

test('late success or failure after logout never replaces or invalidates a newer session',async()=>{
  for(const fail of [false,true]){
    const h=harness(),model=await authenticate(h);
    h.run("clearSessionLoad();S.token='new-session';S.state={me:{id:'new-user'}};");
    if(fail)h.requests[1].reject(new Error('Sesi berakhir'));else h.requests[1].resolve(state());await model.request;
    assert.equal(h.run('S.token'),'new-session');assert.equal(h.run('S.state.me.id'),'new-user');assert.equal(h.run('applied.length'),0);assert.equal(h.run('signedOut'),0);
  }
});

test('revoked authenticated session returns to login instead of offering endless data retry',async()=>{
  const h=harness(),model=await authenticate(h);h.requests[1].reject(new Error('Sesi berakhir. Silakan login.'));await model.request;
  assert.equal(h.run('signedOut'),1);assert.equal(h.run('S.token'),'');assert.equal(h.run('S.sessionLoad'),null);
});

test('old server full login remains compatible and locked division rejects the wrong shell',async()=>{
  const h=harness(),done=h.run('A.pinGo()');h.requests[0].resolve({token:'legacy-token',state:state()});await done;
  assert.equal(h.requests.length,1);assert.equal(h.run('S.state.me.id'),'worker');assert.equal(h.run('synced'),1);
  const d=harness();d.run("division='potong'");const rejected=d.run('A.pinGo()');d.requests[0].resolve(deferred());await rejected;
  assert.equal(d.run('S.token'),'');assert.equal(d.run('S.sessionLoad'),null);assert.equal(d.requests.length,1);
});

test('valid saved session resumes with lightweight bootstrap followed by exactly one authenticated read',async()=>{
  const h=harness();h.run("S.token='saved-session';S.gate={user:null,pin:'',err:''};boot()");
  assert.equal(h.requests[0].action,'bootstrap');assert.equal(h.requests[0].payload.deferState,true);
  h.requests[0].resolve(deferred('worker','jahit','saved-session'));await Promise.resolve();
  assert.equal(h.requests.length,2);assert.equal(h.run('S.state'),null);assert.match(h.run('renders[renders.length-1]'),/Sesi terverifikasi/);
  const model=h.run('S.sessionLoad');h.requests[1].resolve(state());await model.request;assert.equal(h.run('applied.length'),1);
});

test('saved session from another division restarts a public bootstrap rather than reading missing user lists',async()=>{
  const h=harness();h.run("division='potong';S.token='saved-session';S.gate={user:null,pin:'',err:''};boot()");
  h.requests[0].resolve(deferred('worker','jahit','saved-session'));await Promise.resolve();
  assert.equal(h.requests.length,2);assert.equal(h.requests[1].action,'bootstrap');assert.equal(h.requests[1].payload.token,'');assert.equal(h.requests[1].payload.divisi,'potong');
  assert.equal(h.run('S.token'),'');assert.equal(h.run('S.sessionLoad'),null);assert.equal(h.run('snapshotRemoved'),1);
  h.requests[1].resolve({users:[],needSetup:false});await Promise.resolve();assert.equal(h.run('renders[renders.length-1]'),'GATE');
});

test('invalid saved session stays on public login and stale bootstrap cannot overwrite a new login',async()=>{
  const h=harness();h.run("S.token='expired';S.gate={user:null,pin:'',err:''};boot()");h.requests[0].resolve({users:[],needSetup:false});await Promise.resolve();
  assert.equal(h.run('S.token'),'');assert.equal(h.run('S.sessionLoad'),null);assert.equal(h.requests.length,1);
  const d=harness();d.run('boot()');const done=d.run('A.pinGo()');d.requests[1].resolve(deferred());await done;
  assert.equal(d.requests[2].action,'getState');d.requests[0].resolve({users:[],needSetup:false});await Promise.resolve();
  assert.equal(d.run('S.token'),'verified-token');assert.equal(d.run('S.sessionLoad.me.id'),'worker');assert.equal(d.requests.length,3);
  const model=d.run('S.sessionLoad');d.requests[2].resolve(state());await model.request;
});

test('production request is rejected locally while the authenticated state is still loading',async()=>{
  const h=harness();await authenticate(h);
  vm.runInContext(part('function req(', 'function signOutLocal('),h.c);
  const error=await h.run("req('createPotong',{}).catch(function(e){return e;})");assert.match(error.message,/Data akun masih dimuat/);assert.equal(h.requests.length,2);
});

/* ---- langsung terbuka setelah PIN (salinan terkunci di perangkat) ---- */
const tick=()=>new Promise(r=>setImmediate(r));
function unlocked(){const h=harness();h.run(`lockedCopy={at:777,state:${JSON.stringify(state())}};sync=function(){forcedSyncs++;return Promise.resolve();};`);return h;}
const lockTimer=h=>[...h.timers.values()].find(t=>t.ms===20000);
test('a PIN that opens the locked device copy shows the last data at once, read-only, while the server still decides',async()=>{
  const h=unlocked(),done=h.run('A.pinGo()');await tick();
  assert.equal(h.run('renders.at(-1)'),'DATA');assert.equal(h.run('S.token'),'','no session exists yet');assert.equal(h.run('!!S.buka'),true);assert.equal(h.run('applied.length'),1);assert.ok(lockTimer(h),'the unconfirmed view has a time limit');assert.ok(h.run('marks').includes('pk-pin-lokal'));
  vm.runInContext(part('function req(', 'function signOutLocal('),h.c);const blocked=await h.run("req('createPotong',{}).catch(function(e){return e;})");assert.match(blocked.message,/PIN masih diperiksa/);assert.equal(h.requests.length,1,'nothing but the PIN check is sent');
  h.requests[0].resolve(deferred());await done;
  assert.equal(h.run('S.token'),'verified-token');assert.equal(h.run('S.buka'),null);assert.equal(h.run('S.sessionLoad'),null,'no waiting screen replaces the data already shown');assert.equal(h.run('forcedSyncs'),1,'fresh data is fetched behind the screen');assert.equal(h.run('synced'),1);assert.deepEqual(JSON.parse(h.run('JSON.stringify(lockMade)')),['worker']);assert.equal(lockTimer(h),undefined);
});
test('a server that already has the data replaces the device copy in the same answer',async()=>{
  const h=unlocked(),done=h.run('A.pinGo()');await tick();const fresh=state();fresh.ver=9;h.requests[0].resolve({token:'verified-token',state:fresh});await done;
  assert.equal(h.run('applied.length'),2);assert.equal(h.run('S.state.ver'),9);assert.equal(h.run('S.token'),'verified-token');assert.equal(h.run('S.buka'),null);
});
test('whatever the device copy showed is closed and removed the moment the server refuses the PIN or the account',async()=>{
  for(const answer of [{salah:true,pesan:'PIN salah.'},{token:'x',deferredState:true,me:{id:'someone-else',divisi:'jahit'}},{deferredState:true,me:{id:'worker',divisi:'jahit'}}]){
    const h=unlocked(),done=h.run('A.pinGo()');await tick();assert.equal(h.run('renders.at(-1)'),'DATA');h.requests[0].resolve(answer);await done;
    assert.equal(h.run('S.state'),null);assert.equal(h.run('S.buka'),null);assert.equal(h.run('S.token'),'');assert.equal(h.run('renders.at(-1)'),'GATE');assert.deepEqual(JSON.parse(h.run('JSON.stringify(lockRemoved)')),['worker']);assert.equal(h.run('S.gate.pin'),'');assert.ok(h.run('S.gate.err'));assert.ok(h.run('closed')>=1);assert.equal(h.run('Object.keys(D.po).length'),0);
  }
  const refused=unlocked(),p=refused.run('A.pinGo()');await tick();refused.requests[0].reject(new Error('Akun dinonaktifkan.'));await p;assert.equal(refused.run('S.state'),null);assert.deepEqual(JSON.parse(refused.run('JSON.stringify(lockRemoved)')),['worker']);
});
test('a lost connection hides the unconfirmed data but keeps the locked copy; no answer at all hides it after the limit',async()=>{
  const h=unlocked(),done=h.run('A.pinGo()');await tick();h.requests[0].reject(Object.assign(new Error('Server tidak bisa dihubungi.'),{net:true}));await done;
  assert.equal(h.run('S.state'),null);assert.equal(h.run('renders.at(-1)'),'GATE');assert.equal(h.run('lockRemoved.length'),0);assert.match(h.run('S.gate.err'),/tidak bisa dihubungi/);
  const slow=unlocked();slow.run('A.pinGo()');await tick();assert.equal(slow.run('renders.at(-1)'),'DATA');lockTimer(slow).fn();
  assert.equal(slow.run('S.state'),null);assert.equal(slow.run('S.buka'),null);assert.equal(slow.run('renders.at(-1)'),'GATE');assert.equal(slow.run('S.gate.sending'),true,'the PIN check itself is still pending');assert.equal(slow.run('lockRemoved.length'),0);
});
test('a mistyped PIN removes nothing; a refused PIN that later proves to open the copy removes it',async()=>{
  const typo=harness(),a=typo.run('A.pinGo()');await tick();typo.requests[0].resolve({salah:true,pesan:'PIN salah.'});await a;assert.equal(typo.run('lockRemoved.length'),0);assert.equal(typo.run('S.gate.err'),'PIN salah.');
  const busy=harness(),b=busy.run('A.pinGo()');await tick();busy.requests[0].reject(new Error('Server sedang sibuk.'));await b;assert.equal(busy.run('lockRemoved.length'),0);
  const stale=harness();stale.run(`var release;kunciBuka=function(){return new Promise(function(ok){release=function(){ok({at:5,state:${JSON.stringify(state())}});};});};`);const c=stale.run('A.pinGo()');stale.requests[0].resolve({salah:true,pesan:'PIN salah.'});await c;stale.run('release()');await tick();
  assert.deepEqual(JSON.parse(stale.run('JSON.stringify(lockRemoved)')),['worker']);assert.equal(stale.run('S.state'),null,'the old data is never shown after the refusal');
});
test('without a locked copy, or when the server answers first, the sign-in behaves exactly as before',async()=>{
  const none=harness(),a=none.run('A.pinGo()');await tick();assert.equal(none.run('renders.at(-1)'),'GATE');none.requests[0].resolve(deferred());await a;assert.ok(none.run('S.sessionLoad'));assert.deepEqual(JSON.parse(none.run('JSON.stringify(lockMade)')),['worker']);
  const late=harness();late.run(`var release;kunciBuka=function(){return new Promise(function(ok){release=function(){ok({at:5,state:${JSON.stringify(state())}});};});};`);const b=late.run('A.pinGo()');late.requests[0].resolve(deferred());await b;const applied=late.run('applied.length');late.run('release()');await tick();
  assert.equal(late.run('applied.length'),applied,'a copy opened after the server answered is ignored');assert.equal(late.run('S.buka'),undefined);
});
test('the sign-in screen warms the server without credentials, at most once per four minutes, and asks for a one-trip answer',async()=>{
  const h=harness();
  /* use the real warm-up function instead of the counting stub */
  h.run("var fakeNow=1000000;var Date={now:function(){return fakeNow;}};");
  vm.runInContext(part('var hangatPada = 0;','var Idb = '),h.c);
  h.run("S.gate={user:null,pin:'',err:''};boot()");
  const kinds=()=>h.requests.map(r=>r.action);
  assert.deepEqual(kinds(),['hangat','bootstrap'],'warming starts while the public sign-in data is still loading');
  assert.equal(JSON.stringify(h.requests[0].payload),'{}','no token, PIN or account id is sent');
  assert.equal(h.requests[1].payload.stateIfWarm,true);
  h.run('panaskan();panaskan()');assert.equal(h.requests.filter(r=>r.action==='hangat').length,1,'repeat calls inside four minutes are dropped');
  h.run('fakeNow+=239000;panaskan()');assert.equal(h.requests.filter(r=>r.action==='hangat').length,1);
  h.run('fakeNow+=2000;panaskan()');assert.equal(h.requests.filter(r=>r.action==='hangat').length,2);
  h.requests.filter(r=>r.action==='hangat').forEach(r=>r.reject(new Error('offline')));await Promise.resolve();await Promise.resolve();
  assert.equal(h.run('S.gate.err||""'),'','a failed warm-up is silent');
  h.run("fakeNow+=600000;S.state={me:{id:'worker'}};panaskan();S.state=null;S.sessionLoad={token:'x'};panaskan();S.sessionLoad=null;");
  assert.equal(h.requests.filter(r=>r.action==='hangat').length,2,'never while signed in or loading an authenticated session');
  h.run("Api.mode=function(){return 'demo';};fakeNow+=600000;panaskan();Api.mode=function(){return 'gas';};");
  assert.equal(h.requests.filter(r=>r.action==='hangat').length,2,'never in the offline trial mode');
  const before=h.requests.length;h.run("S.gate={user:{id:'worker'},pin:'1234',err:''};");const done=h.run('A.pinGo()');
  const login=h.requests[before];assert.equal(login.action,'login');assert.equal(login.payload.deferState,true);assert.equal(login.payload.stateIfWarm,true);
  login.resolve({token:'one-trip-token',state:state()});await done;
  assert.equal(h.run('S.state.me.id'),'worker');assert.equal(h.requests.filter(r=>r.action==='getState').length,0,'a warm server answers PIN and data in one round trip');
});

test('changing the backend while PIN is in flight invalidates both deferred and older full-state replies',async()=>{
  for(const action of ['connectGo','disconnect'])for(const staged of [true,false]){
    const h=harness();
    h.run("Api.connect=function(){return true;};Api.disconnect=function(){};function bootKey(){return 'public-boot';}function $(q){return {value:'new-source'};}");
    vm.runInContext(part('A.connectGo = function','/* tombol pasang:'),h.c);
    vm.runInContext(part('A.disconnect = function','/* ---------- form:'),h.c);
    const done=h.run('A.pinGo()');h.run('A.'+action+'()');
    h.requests[0].resolve(staged?deferred():{token:'old-source-token',state:state()});await done;
    assert.equal(h.run('S.token'),'');assert.equal(h.run('S.state'),null);assert.equal(h.run('S.sessionLoad'),null);assert.equal(h.run('applied.length'),0);
    assert.equal(h.requests.length,2);assert.equal(h.requests[1].action,'bootstrap');assert.equal(h.requests[1].payload.token,'');
  }
});
