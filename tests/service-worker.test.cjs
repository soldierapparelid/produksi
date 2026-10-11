'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../sw.js'),'utf8');
const scope='https://example.test/produksi/';
const next=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
  const listeners={},tables=new Map(),calls=[],messages=[],timers=new Map(),deleted=[];let serial=0,claims=0;
  const key=value=>new URL(typeof value==='string'?value:value.url,scope).href;
  const cache=name=>{if(!tables.has(name))tables.set(name,new Map());const rows=tables.get(name);return {async match(k){const r=rows.get(key(k));return r&&r.clone();},async put(k,r){rows.set(key(k),r.clone());}};};
  const caches={open:async n=>cache(n),keys:async()=>[...tables.keys()],delete:async n=>{deleted.push(n);return tables.delete(n);}};
  class RelativeRequest extends Request {constructor(url,options){super(typeof url==='string'?new URL(url,scope).href:url,options);}}
  const c=vm.createContext({URL,Request:RelativeRequest,Response,Promise,caches,fetch(request){return new Promise((resolve,reject)=>calls.push({request,resolve,reject}));},setTimeout(fn,ms){const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},self:{location:new URL('sw.js',scope),addEventListener(k,fn){listeners[k]=fn;},skipWaiting:async()=>{},clients:{claim:async()=>{claims++;},matchAll:async()=>[{url:scope,postMessage:m=>messages.push(m)}]}}});
  vm.runInContext(source,c);
  function event(type,request){const out={waits:[],request,waitUntil(p){this.waits.push(p);},respondWith(p){this.response=p;}};listeners[type](out);return out;}
  return {c,calls,messages,timers,deleted,tables,cache,n:vm.runInContext('CACHE',c),claims:()=>claims,event,async seed(file,text,cacheName){await cache(cacheName||this.n).put(file,new Response(text));},fetch(file,method='GET'){return event('fetch',new RelativeRequest(file,{method}));},tick(ms){const due=[...timers].filter(([,t])=>t.ms===ms);assert.ok(due.length,'timer exists');for(const [id,t]of due){timers.delete(id);t.fn();}}};
}

test('a fast navigation serves the fresh release instead of the existing offline page',async()=>{
  const h=harness();await h.seed('./index.html','old release');const e=h.fetch('./?d=potong');let done=false;e.response.then(()=>done=true);await next();assert.equal(done,false);assert.equal(h.calls.length,1);assert.equal(h.calls[0].request.cache,'no-cache');
  h.calls[0].resolve(new Response('fresh release',{headers:{etag:'fresh'}}));assert.equal(await(await e.response).text(),'fresh release');await Promise.all(e.waits);assert.equal(await(await h.cache(h.n).match('./index.html')).text(),'fresh release');assert.equal(h.timers.size,0);
});

test('a slow navigation opens offline data at the deadline and a late response updates cache once',async()=>{
  const h=harness();await h.seed('./index.html','offline release');const e=h.fetch('./index.html');await next();h.tick(2500);assert.equal(await(await e.response).text(),'offline release');
  h.calls[0].resolve(new Response('new release'));await Promise.all(e.waits);assert.equal(await(await h.cache(h.n).match('./index.html')).text(),'new release');assert.equal(h.messages.length,1);assert.equal(h.messages[0].pk,'versi-baru');
});

test('offline and HTTP errors fall back to the last valid page without caching an error response',async()=>{
  for(const kind of ['offline','http']){const h=harness();await h.seed('./index.html','safe page');const e=h.fetch('./');if(kind==='offline')h.calls[0].reject(new Error('offline'));else h.calls[0].resolve(new Response('server failure',{status:503}));assert.equal(await(await e.response).text(),'safe page');assert.equal(await(await h.cache(h.n).match('./index.html')).text(),'safe page');assert.equal(h.timers.size,0);}
});

test('a first visit without cache waits for the one network request after the deadline',async()=>{
  const h=harness(),e=h.fetch('./');let done=false;e.response.then(()=>done=true);await next();h.tick(2500);await next();assert.equal(done,false);assert.equal(h.calls.length,1);h.calls[0].resolve(new Response('first page'));assert.equal(await(await e.response).text(),'first page');
});

test('static assets are immediate from cache and simultaneous refreshes share one request',async()=>{
  const h=harness();await h.seed('./logo-192.png','cached logo');const a=h.fetch('./logo-192.png'),b=h.fetch('./logo-192.png?version=2');assert.equal(await(await a.response).text(),'cached logo');assert.equal(await(await b.response).text(),'cached logo');assert.equal(h.calls.length,1);h.calls[0].resolve(new Response('new logo'));await Promise.all(a.waits.concat(b.waits));assert.equal(await(await h.cache(h.n).match('./logo-192.png')).text(),'new logo');assert.equal(h.messages.length,0);
});

test('simultaneous cold navigations share the download but each receives a readable response body',async()=>{
  const h=harness(),a=h.fetch('./?d=jahit'),b=h.fetch('./index.html?d=qc');assert.equal(h.calls.length,1);h.calls[0].resolve(new Response('shared latest page'));assert.equal(await(await a.response).text(),'shared latest page');assert.equal(await(await b.response).text(),'shared latest page');assert.equal(h.timers.size,0);
});

test('only allowlisted files inside this app are intercepted, never Apps Script, other paths, POST or user downloads',()=>{
  const h=harness();for(const [url,method]of [['https://script.google.com/macros/s/fake/exec','GET'],['https://example.test/other/index.html','GET'],['https://example.test/produksi-other/index.html','GET'],['./private-backup.json','GET'],['./api','GET'],['./sw.js','GET'],['./','POST']]){const e=h.fetch(url,method);assert.equal(e.response,undefined,url);assert.equal(e.waits.length,0);}assert.equal(h.calls.length,0);
});

test('activation deletes only this app cache family and keeps unrelated caches intact',async()=>{
  const h=harness();for(const n of [h.n,'pk-produksi-app-old-release','another-app-cache','soldier-produksi-202601010101'])await h.seed('./index.html',n,n);const e=h.event('activate');await Promise.all(e.waits);assert.deepEqual(h.deleted,['pk-produksi-app-old-release']);assert.equal(h.tables.has(h.n),true);assert.equal(h.tables.has('another-app-cache'),true);assert.equal(h.tables.has('soldier-produksi-202601010101'),true);assert.equal(h.claims(),1);
});

test('cache storage failure does not discard a valid response from the network',async()=>{
  const h=harness();h.c.caches.open=async()=>{throw new Error('storage unavailable');};const e=h.fetch('./');h.calls[0].resolve(new Response('online page'));assert.equal(await(await e.response).text(),'online page');await Promise.all(e.waits);
});

test('release notifications are sent only to this app pages, not unrelated open windows',async()=>{
  const h=harness(),got=[];h.c.self.clients.matchAll=async()=>[scope,scope+'index.html?d=qc','https://example.test/another-app/','https://script.google.com/macros/s/fake/exec'].map(url=>({url,postMessage:()=>got.push(url)}));
  await vm.runInContext('kabari(RAKITAN)',h.c);assert.deepEqual(got,[scope,scope+'index.html?d=qc']);
});
