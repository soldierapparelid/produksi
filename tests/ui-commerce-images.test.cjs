'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
const start=html.indexOf('/* ---------- gambar: diambil terpisah'),end=html.indexOf('/* kecilkan gambar',start);
assert.ok(start>0&&end>start,'image loader exists');
function harness(){
  const calls=[],context=vm.createContext({console});
  context.record=(action,payload)=>new Promise((resolve,reject)=>calls.push({action,payload:JSON.parse(JSON.stringify(payload)),resolve,reject}));
  vm.runInContext(`var timers=[],kv={},nodes=[],S={token:'session-one',img:{},imgWait:{}},D={produk:{}};
    function setTimeout(fn){timers.push(fn);return timers.length;}function clearTimeout(id){if(id)timers[id-1]=null;}
    function esc(x){return String(x);}function inisial(){return 'X';}
    var Api={call:function(a,p){return record(a,p);}},Idb={all:function(s,fn){fn({});},put:function(s,k,v){kv[k]=v;}};
    function node(id,ver){var n={id:id,ver:ver,style:{},has:false,getAttribute:function(k){return k==='data-img'?id:ver;},classList:{add:function(){n.has=true;}}};nodes.push(n);return n;}
    function $$(s){return nodes.slice();}function $(s){var m=/data-img="([^"]+)"/.exec(s);return nodes.filter(function(n){return m&&n.id===m[1];})[0]||null;}
    function tick(){var run=timers.filter(Boolean);timers=[];run.forEach(function(fn){fn();});}`,context);
  vm.runInContext(html.slice(start,end),context);
  const run=code=>vm.runInContext(code,context);
  return {calls,run,json:code=>JSON.parse(run('JSON.stringify('+code+')'))};
}
const turn=()=>new Promise(r=>setImmediate(r));
test('purchase product photos are asked from the commerce endpoint in small batches and kept on the device',async()=>{
  const h=harness();h.run("muatGambarTersimpan();for(var i=0;i<14;i++)node('cm.p'+i,'abcdef0123456789');node('prodA','v1');hydrateImages();tick();");
  const shop=h.calls.filter(c=>c.action==='getCommerceImages'),plain=h.calls.filter(c=>c.action==='getGambar');
  assert.equal(shop.length,1);assert.equal(plain.length,1);assert.deepEqual(plain[0].payload.ids,['prodA']);
  assert.equal(shop[0].payload.items.length,12);assert.deepEqual(shop[0].payload.items[0],{id:'p0',rev:'abcdef0123456789'});assert.equal(shop[0].payload.token,'session-one');
  shop[0].resolve({images:{p0:'data:image/jpeg;base64,ZERO'}});await turn();
  assert.equal(h.run("nodes[0].style.backgroundImage"),'url("data:image/jpeg;base64,ZERO")');assert.equal(h.run('nodes[0].has'),true);assert.equal(h.run("kv['cm.p0']"),'abcdef0123456789|data:image/jpeg;base64,ZERO');
  assert.equal(h.run("kv['cm.p1']"),undefined,'a product without a stored photo writes nothing');
  h.run('tick();');const next=h.calls.filter(c=>c.action==='getCommerceImages');assert.equal(next.length,2);assert.deepEqual(next[1].payload.items.map(i=>i.id),['p12','p13'],'the rest follows; nothing is asked twice');
});
test('a refusal is not repeated on every repaint, a lost connection is, and another session never receives the answer',async()=>{
  const refused=harness();refused.run("muatGambarTersimpan();node('cm.p1','abcdef0123456789');hydrateImages();tick();");refused.calls[0].reject(new Error('Aksi tidak dikenal: getCommerceImages'));await turn();
  refused.run('hydrateImages();tick();');assert.equal(refused.calls.length,1);
  const lost=harness();lost.run("muatGambarTersimpan();node('cm.p1','abcdef0123456789');hydrateImages();tick();");lost.calls[0].reject(Object.assign(new Error('offline'),{net:true}));await turn();
  lost.run('hydrateImages();tick();');assert.equal(lost.calls.length,2);
  const other=harness();other.run("muatGambarTersimpan();node('cm.p1','abcdef0123456789');hydrateImages();tick();S.token='someone-else';");other.calls[0].resolve({images:{p1:'data:image/jpeg;base64,PRIV'}});await turn();
  assert.equal(other.run("S.img['cm.p1']"),undefined);assert.equal(other.run("kv['cm.p1']"),undefined);
});
test('a photo already on the device for the same revision is shown without any request; a new revision is fetched again',()=>{
  const h=harness();h.run("S.img['cm.p1']={ver:'abcdef0123456789',data:'data:image/jpeg;base64,HAVE'};muatGambarTersimpan();node('cm.p1','abcdef0123456789');hydrateImages();tick();");
  assert.equal(h.calls.length,0);assert.equal(h.run('nodes[0].has'),true);
  h.run("nodes=[];node('cm.p1','1111111111111111');hydrateImages();tick();");assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].payload.items,[{id:'p1',rev:'1111111111111111'}]);
});
