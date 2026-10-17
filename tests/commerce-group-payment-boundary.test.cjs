'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const fixtureSource=fs.readFileSync(path.join(__dirname,'commerce-invoice-merge.test.cjs'),'utf8');
const fixtureContext=vm.createContext({require,__dirname,console});
vm.runInContext(fixtureSource.slice(0,fixtureSource.indexOf('\ntest('))+'\nglobalThis.fixture=fixture;globalThis.invoiceFixture=invoice;',fixtureContext);
const fixture=fixtureContext.fixture,invoice=fixtureContext.invoiceFixture;
function setup(){const f=fixture();for(const key of ['A','B'])f.good('saveCommerceOrderBatch',invoice(key,{grupNama:'Same visible label'}));return f;}
function payment(f,id,ids,extra={}){return {id,orderIds:ids,expectedRevisions:f.revisions(ids),tanggal:'2026-10-17',jumlah:200,metode:'transfer',catatan:'Payment boundary fixture',...extra};}

test('new same-supplier DP cannot cross invoice identities even when invoice labels and dates match',()=>{
 const f=setup(),request=payment(f,'cross',['orderAa','orderBa']),before=JSON.stringify(f.raw('CommerceEvent')),records=JSON.stringify(f.raw('CommerceRecord'));
 f.bad('appendCommerceGroupPayment',request,/satu invoice/);assert.equal(JSON.stringify(f.raw('CommerceEvent')),before);assert.equal(JSON.stringify(f.raw('CommerceRecord')),records);
 const allowed=payment(f,'within',['orderAa','orderAb']),other=f.state().orders.filter(o=>o.invoiceId==='invoiceB');f.good('appendCommerceGroupPayment',allowed);assert.deepEqual(f.state().orders.filter(o=>o.invoiceId==='invoiceB'),other);
});

test('explicitly merged invoices accept shared DP, and an existing payment retries unchanged after a later merge',()=>{
 const f=setup(),firstPayment=payment(f,'beforeMerge',['orderAa','orderAb']);f.good('appendCommerceGroupPayment',firstPayment);
 const ids=f.state().orders.map(o=>o.id);f.good('mergeCommerceInvoices',f.merge('combined',ids));
 const before=JSON.stringify(f.raw('CommerceEvent'));f.good('appendCommerceGroupPayment',firstPayment);assert.equal(JSON.stringify(f.raw('CommerceEvent')),before,'retry only confirms the existing payment despite newer invoice revisions');
 const shared=payment(f,'afterMerge',['orderAa','orderBa']);f.good('appendCommerceGroupPayment',shared);const saved=f.raw('CommerceEvent').filter(e=>e.kind==='payment'&&JSON.parse(e.data).groupId===shared.id);assert.equal(saved.length,2);assert.equal(saved.reduce((n,e)=>n+JSON.parse(e.data).jumlah,0),200);
 f.good('saveCommerceOrderBatch',invoice('C'));const mixed=payment(f,'stillSeparate',['orderAa','orderCa']),frozen=JSON.stringify(f.raw('CommerceEvent'));f.bad('appendCommerceGroupPayment',mixed,/satu invoice/);assert.equal(JSON.stringify(f.raw('CommerceEvent')),frozen);
});

test('an exact historical cross-invoice retry is recovered and its correction preserves original parent allocations',()=>{
 const f=setup(),ids=['orderAa','orderBa'],original=payment(f,'historicalCross',ids,{jumlah:400}),actor=f.state().orders[0].createdBy;
 const events=ids.map(parentId=>({id:'gp_'+f.h.run('coreCommerceHash('+JSON.stringify([original.id,parentId])+')').slice(0,40),module:'pembelian',parentId,kind:'payment',data:JSON.stringify({tanggal:original.tanggal,catatan:original.catatan,jumlah:200,metode:original.metode,groupId:original.id}),dibuat:'2026-10-17T00:00:00.000Z',dibuatOleh:actor,sourceHash:''}));
 f.h.run('pkStore_().lock(function(){pkStore_().appendMany("CommerceEvent",'+JSON.stringify(events)+');});void 0;');
 const before=JSON.stringify(f.raw('CommerceEvent')),untouched=f.state().orders.filter(o=>!ids.includes(o.id));
 f.good('appendCommerceGroupPayment',original);assert.equal(JSON.stringify(f.raw('CommerceEvent')),before,'old retry is confirmation, not a new cross-invoice write');
 f.bad('appendCommerceGroupPayment',{...original,jumlah:401},/sudah digunakan/);f.bad('appendCommerceGroupPayment',{...original,id:'newCross',expectedRevisions:f.revisions(ids)},/satu invoice/);
 f.good('gantiCommerceGroupPayment',{id:'correctOldCross',groupId:original.id,jumlah:300,tanggal:original.tanggal,metode:'transfer',catatan:'Correct historical payment',expectedRevisions:f.revisions(ids)});
 assert.deepEqual(f.raw('CommerceEvent').slice(0,events.length),events);assert.deepEqual(f.state().orders.filter(o=>!ids.includes(o.id)),untouched);
 const replacements=f.raw('CommerceEvent').filter(e=>e.kind==='payment'&&JSON.parse(e.data).groupId==='correctOldCross');assert.deepEqual(replacements.map(e=>e.parentId).sort(),ids.slice().sort());assert.equal(replacements.reduce((n,e)=>n+JSON.parse(e.data).jumlah,0),300);assert.ok(f.state().orders.every(o=>o.invoiceId===(o.id.startsWith('orderA')?'invoiceA':'invoiceB')));
});
