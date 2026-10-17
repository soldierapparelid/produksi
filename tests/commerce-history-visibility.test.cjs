'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');

function fixture(){
 const h=harness();for(const name of ['reconcile-legacy','commerce-hpp','slip-models','commerce','commerce-migration'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src',name+'.js'),'utf8'),h.context);
 const setup=h.request('setupOwner',{nama:'History fixture',pin:'1234'});assert.equal(setup.ok,true,setup.error);const owner=setup.data.token;
 h.run("pkStore_().lock(function(){pkStore_().appendMany('Pegawai',[{id:'adminfixture',nama:'Admin',divisi:'admin',aktif:true,token:'fixture-admin-token-001'},{id:'workerfixture',nama:'QC',divisi:'qc',aktif:true,token:'fixture-worker-token-001'},{id:'otherowner',nama:'Owner 2',divisi:'owner',aktif:true,token:'fixture-owner2-token-001'}]);});void 0;");
 function call(action,p={},token=owner){h.cold();return h.request(action,{token,workflowVersion:2,...p});}
 function good(action,p={},token=owner){const r=call(action,p,token);assert.equal(r.ok,true,r.error);return r.data;}
 function bad(action,p={},regex,token=owner){const r=call(action,p,token);assert.equal(r.ok,false,'must reject');if(regex)assert.match(r.error,regex);return r;}
 function raw(table){h.cold();return h.run('pkStore_().fresh('+JSON.stringify(table)+');pkStore_().read('+JSON.stringify(table)+')');}
 function state(module){return good('getCommerceState',{module});}
 function row(module,id){return state(module)[module==='nota'?'notes':'orders'].find(r=>r.id===id);}
 function visibility(module,ids,hidden,requestId,extra={}){const expectedRevisions={};ids.forEach(id=>expectedRevisions[id]=row(module,id).revision);return {module,ids,hidden,requestId,expectedRevisions,reason:hidden?'Bersihkan riwayat fixture':'Pulihkan fixture',withState:true,...extra};}
 function note(id='nota',extra={}){return good('saveCommerceNota',{record:{id,date:'2026-10-10',customer:{name:'Fixture'},items:[{id:'line',name:'Topi',qty:2,price:1000}],initialPayment:{jumlah:2000,metode:'transfer'},...extra}}).record;}
 function masters(){good('saveCommerceSupplier',{record:{id:'supplier',nama:'Supplier'}});good('saveCommerceProduct',{record:{id:'product',nama:'Topi',supplierId:'supplier'}});}
 function purchase(id='order',extra={}){return good('saveCommerceOrder',{record:{id,produkId:'product',tanggalOrder:'2026-10-10',hargaSatuan:1000,items:[{id:'item',nama:'Hitam',jumlah:2}],initialPayment:{jumlah:2000,metode:'transfer'},...extra}}).record;}
 function receive(id='order',qty=2){const o=row('pembelian',id);return good('appendCommerceReceipt',{id:'receipt-'+id,orderId:id,expectedRevision:o.revision,itemId:'item',jumlah:qty,tanggal:'2026-10-12'}).record;}
 function financial(){return raw('CommerceEvent').filter(e=>e.kind!=='historyVisibility');}
 return {h,call,good,bad,raw,state,row,visibility,note,masters,purchase,receive,financial};
}

test('completed invoice selection hides atomically with one metadata event and preserves all financial and source records',()=>{
 const f=fixture();f.masters();f.purchase('a',{grupNama:'Invoice completed'});f.purchase('b',{grupNama:'Invoice completed'});f.receive('a');f.receive('b');
 const before={records:f.raw('CommerceRecord'),events:f.financial(),sources:f.raw('CommerceSource'),production:f.raw('PO')};
 const original=f.state('pembelian').orders,intent=f.visibility('pembelian',['b','a'],true,'hide-invoice'),writes=f.h.sheets.CommerceEvent.writes;
 const out=f.good('setCommerceHistoryVisibility',intent);
 assert.equal(f.h.sheets.CommerceEvent.writes,writes+1,'one physical metadata append');assert.equal(out.records.length,2);
 for(const r of out.records){assert.equal(r.historyHidden,true);assert.equal(r.historyVisibilityRequestId,intent.requestId);assert.equal(r.historyVisibilityProof,out.proof);assert.equal(r.historyHiddenBy,out.commerce.actor.id);assert.ok(r.historyHiddenAt);assert.equal(r.historyHiddenReason,intent.reason);assert.equal(r.status,'selesai');assert.notEqual(r.revision,original.find(o=>o.id===r.id).revision);assert.deepEqual(r.payments,original.find(o=>o.id===r.id).payments);assert.deepEqual(r.receipts,original.find(o=>o.id===r.id).receipts);}
 assert.deepEqual(f.raw('CommerceRecord'),before.records);assert.deepEqual(f.financial(),before.events);assert.deepEqual(f.raw('CommerceSource'),before.sources);assert.deepEqual(f.raw('PO'),before.production);
 assert.equal(f.raw('CommerceEvent').filter(e=>e.kind==='historyVisibility').length,1);
 const restored=f.good('setCommerceHistoryVisibility',f.visibility('pembelian',['a','b'],false,'restore-invoice'));
 for(const r of restored.records){assert.equal(r.historyHidden,false);assert.equal(r.status,'selesai');assert.equal(r.totalPaid,2000);assert.equal(r.totalReceived,2);assert.notEqual(r.revision,out.records.find(o=>o.id===r.id).revision);}
 assert.deepEqual(f.raw('CommerceRecord'),before.records);assert.deepEqual(f.financial(),before.events);
});

test('one unfinished, invalid or absent member prevents the entire selection from being hidden',()=>{
 const f=fixture();f.masters();f.purchase('done');f.receive('done');f.purchase('partial');f.receive('partial',1);f.purchase('unpaid',{initialPayment:null});f.receive('unpaid');
 const events=f.raw('CommerceEvent');
 for(const badId of ['partial','unpaid'])f.bad('setCommerceHistoryVisibility',f.visibility('pembelian',['done',badId],true,'hide-'+badId),/riwayat|aktif/);
 f.bad('setCommerceHistoryVisibility',{module:'pembelian',ids:['done','absent'],hidden:true,requestId:'missing',expectedRevisions:{}},/tidak ditemukan/);
 assert.deepEqual(f.raw('CommerceEvent'),events);assert.equal(!!f.row('pembelian','done').historyHidden,false);
 const n=f.note('unpaid-note',{initialPayment:null});f.bad('setCommerceHistoryVisibility',f.visibility('nota',[n.id],true,'hide-unpaid-note'),/riwayat|aktif/);
});

test('visibility changes require active owner, exact workflow, valid identities and a revision for every selected record',()=>{
 const f=fixture(),n=f.note(),intent=f.visibility('nota',[n.id],true,'permissions'),before=f.raw('CommerceEvent');
 for(const token of ['fixture-admin-token-001','fixture-worker-token-001'])f.bad('setCommerceHistoryVisibility',intent,/owner/,token);
 for(const patch of [{ids:[]},{ids:['nota','nota']},{ids:['__proto__']},{module:'hpp'},{hidden:'true'},{requestId:''},{expectedRevisions:{}},{expectedRevisions:{nota:'stale'}},{workflowVersion:1},{clientVersion:'1.5.49'}])f.bad('setCommerceHistoryVisibility',{...intent,...patch});
 f.h.run("pkStore_().lock(function(){pkStore_().update('Pegawai','otherowner',{aktif:false});});void 0;");f.bad('setCommerceHistoryVisibility',intent,/aktif|sesi|masuk/i,'fixture-owner2-token-001');
 assert.deepEqual(f.raw('CommerceEvent'),before);
});

test('response loss after metadata append recovers exactly once; replay cannot overwrite a later restore or reuse another intent',()=>{
 const f=fixture();f.note();const intent=f.visibility('nota',['nota'],true,'lost-response'),sheet=f.h.sheets.CommerceEvent,original=sheet.getRange;let thrown=false;
 sheet.getRange=function(...args){const range=original.apply(this,args),write=range.setValues;range.setValues=function(rows){const result=write.call(this,rows);if(!thrown&&args[0]>1){thrown=true;throw Error('lost visibility response after write');}return result;};return range;};
 f.bad('setCommerceHistoryVisibility',intent,/lost visibility/);sheet.getRange=original;const writes=sheet.writes;
 assert.equal(f.good('setCommerceHistoryVisibility',intent).records[0].historyHidden,true);assert.equal(sheet.writes,writes);
 f.bad('setCommerceHistoryVisibility',{...intent,reason:'Different reason'},/berbeda/);f.bad('setCommerceHistoryVisibility',intent,/berbeda/,'fixture-owner2-token-001');
 const restored=f.good('setCommerceHistoryVisibility',f.visibility('nota',['nota'],false,'restore-after-response'));
 assert.equal(restored.records[0].historyHidden,false);const afterRestore=sheet.writes;
 assert.equal(f.good('setCommerceHistoryVisibility',intent).records[0].historyHidden,false,'old exact replay does not reverse later intent');assert.equal(sheet.writes,afterRestore);
});

test('one visibility commit holds the adapter lock, publishes one version and replaces cached state across cold devices',()=>{
 const f=fixture();f.note();const warm=f.state('nota'),intent=f.visibility('nota',['nota'],true,'cache-hide');
 const globalVersion=Number(f.h.properties.ver),eventVersion=Number(f.h.properties.v_CommerceEvent||0),sheet=f.h.sheets.CommerceEvent,original=sheet.getRange;let checked=0;
 sheet.getRange=function(...args){const range=original.apply(this,args),write=range.setValues;range.setValues=function(rows){assert.equal(f.h.isLocked(),true,'physical metadata write must hold the common commit lock');checked++;return write.call(this,rows);};return range;};
 const out=f.good('setCommerceHistoryVisibility',intent);sheet.getRange=original;
 assert.equal(checked,1);assert.equal(f.h.isLocked(),false);assert.equal(Number(f.h.properties.ver),globalVersion+1);assert.equal(Number(f.h.properties.v_CommerceEvent),eventVersion+1);assert.equal(out.commerce.version,globalVersion+1);
 for(let i=0;i<3;i++){const loaded=f.state('nota');assert.equal(loaded.version,globalVersion+1);assert.equal(loaded.notes[0].historyHidden,true);assert.notEqual(loaded.notes[0].revision,warm.notes[0].revision);}
 const committedVersion=Number(f.h.properties.ver);f.good('setCommerceHistoryVisibility',intent);assert.equal(Number(f.h.properties.ver),committedVersion,'idempotent retry does not publish another change');
 f.good('setCommerceHistoryVisibility',f.visibility('nota',['nota'],false,'cache-restore'));assert.equal(Number(f.h.properties.ver),committedVersion+1);assert.equal(f.state('nota').notes[0].historyHidden,false);
});

test('concurrent financial correction prevents stale hide and hide-restore cycles invalidate earlier edit and restore forms',()=>{
 const f=fixture();let n=f.note();const hide=f.visibility('nota',['nota'],true,'stale-hide');
 n=f.good('gantiCommerceEvent',{id:'corrected',module:'nota',parentId:n.id,eventId:n.payments[0].id,expectedRevision:n.revision,jumlah:1000,tanggal:'2026-10-10',metode:'transfer'}).record;
 f.bad('setCommerceHistoryVisibility',hide,/berubah/);f.bad('setCommerceHistoryVisibility',f.visibility('nota',['nota'],true,'ineligible-hide'),/riwayat|aktif/);
 n=f.good('appendCommercePayment',{id:'settle',module:'nota',parentId:n.id,expectedRevision:n.revision,jumlah:1000,tanggal:'2026-10-17',metode:'transfer'}).record;
 const beforeHide=n;f.good('setCommerceHistoryVisibility',f.visibility('nota',['nota'],true,'fresh-hide'));const oldRestore=f.visibility('nota',['nota'],false,'old-restore');
 f.good('setCommerceHistoryVisibility',f.visibility('nota',['nota'],false,'fresh-restore'));f.good('setCommerceHistoryVisibility',f.visibility('nota',['nota'],true,'second-hide'));
 f.bad('setCommerceHistoryVisibility',oldRestore,/berubah/);f.good('setCommerceHistoryVisibility',f.visibility('nota',['nota'],false,'second-restore'));
 f.bad('saveCommerceNota',{record:{...beforeHide,notes:'stale edit'},expectedRevision:beforeHide.revision},/berubah/);
});

test('hidden nota blocks corrections, payment, edit, archive and cancellation until explicit visibility restore',()=>{
 const f=fixture(),n=f.note();f.good('setCommerceHistoryVisibility',f.visibility('nota',[n.id],true,'hidden-note'));const hidden=f.row('nota',n.id),before=f.raw('CommerceEvent'),records=f.raw('CommerceRecord');
 const actions=[['saveCommerceNota',{record:{...hidden,historyHidden:false,notes:'bypass'},expectedRevision:hidden.revision}],['appendCommercePayment',{id:'extra',module:'nota',parentId:n.id,expectedRevision:hidden.revision,jumlah:1}],['voidCommerceEvent',{id:'void',module:'nota',parentId:n.id,expectedRevision:hidden.revision,eventId:n.payments[0].id,catatan:'wrong'}],['gantiCommerceEvent',{id:'fix',module:'nota',parentId:n.id,expectedRevision:hidden.revision,eventId:n.payments[0].id,jumlah:1000}],['arsipCommerceNota',{id:n.id,expectedRevision:hidden.revision}],['cancelCommerceRecord',{module:'nota',id:n.id,expectedRevision:hidden.revision,catatan:'cancel',voidAll:true}],['restoreCommerceRecord',{module:'nota',id:n.id,expectedRevision:hidden.revision}]];
 for(const [action,p] of actions)f.bad(action,p,/Sampah riwayat/);
 assert.deepEqual(f.raw('CommerceEvent'),before);assert.deepEqual(f.raw('CommerceRecord'),records);
 f.good('setCommerceHistoryVisibility',f.visibility('nota',[n.id],false,'restore-note'));const r=f.row('nota',n.id);
 const fixed=f.good('gantiCommerceEvent',{id:'fix-after-restore',module:'nota',parentId:n.id,expectedRevision:r.revision,eventId:n.payments[0].id,jumlah:1000}).record;
 assert.equal(fixed.status,'dp');assert.equal(fixed.historyHidden,false);assert.equal(fixed.historyVisibilityRequestId,'restore-note');
 const edited=f.good('saveCommerceNota',{record:{...fixed,historyHidden:true,notes:'safe edit'},expectedRevision:fixed.revision}).record;
 assert.equal(edited.historyHidden,false,'client-submitted metadata cannot overwrite persisted visibility');
});

test('manual archived and cancelled notes restore their original lifecycle without voiding additional evidence',()=>{
 const f=fixture();let archived=f.note('archived',{initialPayment:null});archived=f.good('arsipCommerceNota',{id:archived.id,expectedRevision:archived.revision}).record;
 let cancelled=f.note('cancelled',{initialPayment:null});cancelled=f.good('cancelCommerceRecord',{module:'nota',id:cancelled.id,expectedRevision:cancelled.revision,catatan:'Wrong note'}).record;
 const records=f.raw('CommerceRecord'),events=f.financial();
 f.good('setCommerceHistoryVisibility',f.visibility('nota',['archived','cancelled'],true,'hide-special'));
 const restored=f.good('setCommerceHistoryVisibility',f.visibility('nota',['archived','cancelled'],false,'restore-special'));
 assert.equal(restored.records.find(r=>r.id==='archived').archived,true);assert.equal(restored.records.find(r=>r.id==='archived').status,'belum');assert.equal(restored.records.find(r=>r.id==='cancelled').cancelled,true);
 assert.deepEqual(f.raw('CommerceRecord'),records);assert.deepEqual(f.financial(),events);
});

test('hidden purchase blocks group correction, merge, target-invoice additions and single-event mutations',()=>{
 const f=fixture();f.masters();f.good('saveCommerceOrderBatch',{id:'invoice',supplierId:'supplier',grupNama:'INV',tanggalOrder:'2026-10-10',orders:['a','b'].map(id=>({id,produkId:'product',hargaSatuan:1000,items:[{id:'item',nama:'Hitam',jumlah:2}]})),initialPayment:{jumlah:4000,metode:'transfer'}});f.receive('a');f.receive('b');
 f.purchase('other');f.receive('other');f.good('setCommerceHistoryVisibility',f.visibility('pembelian',['a','b'],true,'hide-invoice-members'));f.good('setCommerceHistoryVisibility',f.visibility('pembelian',['b'],false,'restore-one-member'));
 const a=f.row('pembelian','a'),b=f.row('pembelian','b'),other=f.row('pembelian','other'),revisions={a:a.revision,b:b.revision,other:other.revision},before=f.raw('CommerceEvent'),records=f.raw('CommerceRecord');
 const requests=[['gantiCommerceGroupPayment',{id:'group-fix',groupId:'invoice',jumlah:3000,expectedRevisions:revisions}],['appendCommerceGroupPayment',{id:'group-pay',orderIds:['a','b'],jumlah:1,expectedRevisions:revisions}],['mergeCommerceInvoices',{id:'merge',orderIds:['a','b','other'],expectedRevisions:revisions}],['saveCommerceOrderBatch',{id:'addition',supplierId:'supplier',targetInvoiceId:'invoice',expectedGroupRevisions:{a:a.revision,b:b.revision},tanggalOrder:'2026-10-17',orders:[{id:'new',produkId:'product',hargaSatuan:1000,items:[{id:'item',nama:'Hitam',jumlah:1}]}]}],['appendCommerceReceipt',{id:'new-receipt',orderId:'a',expectedRevision:a.revision,itemId:'item',jumlah:1,tanggal:'2026-10-17'}],['gantiCommerceEvent',{id:'fix-receipt',orderId:'a',expectedRevision:a.revision,eventId:'receipt-a',jumlah:1}],['saveCommerceOrder',{record:{...a,catatan:'change'},expectedRevision:a.revision}],['salinCommerceOrderLama',{id:'copy',orderId:'a',expectedRevision:a.revision}]];
 for(const [action,p] of requests)f.bad(action,p,/Sampah riwayat/);
 f.bad('mergeCommerceInvoices',{id:'missing-hidden-member',orderIds:['b','other'],expectedRevisions:revisions},/seluruh model/);
 assert.deepEqual(f.raw('CommerceEvent'),before);assert.deepEqual(f.raw('CommerceRecord'),records);
});

test('legacy review is not automatically eligible, while settled zero-total nota remains legitimate history',()=>{
 const f=fixture();const backup={notaPenjualan_v1:{transactions:[{id:'legacy-review',date:'2026-08-01',customer:{name:'Legacy'},items:[{id:'old',name:'Topi',qty:1,price:2000}],total:null,payment:{}}]}};
 const preview=f.good('previewCommerceImport',{backup});f.good('applyCommerceImport',{backup,sourceHash:preview.sourceHash,planHash:preview.planHash});
 const source=f.raw('CommerceSource');assert.equal(f.row('nota','legacy-review').paymentReview,true);f.bad('setCommerceHistoryVisibility',f.visibility('nota',['legacy-review'],true,'review-hide'),/riwayat|aktif/);
 f.note('free',{initialPayment:null,discountPercent:100});const out=f.good('setCommerceHistoryVisibility',f.visibility('nota',['free'],true,'free-hide'));assert.equal(out.records[0].historyHidden,true);assert.equal(out.records[0].status,'lunas');assert.deepEqual(f.raw('CommerceSource'),source);
});

test('purchase hide requires all effective invoice members and one invoice, but cancelled rows and restoration can be individual',()=>{
 const f=fixture();f.masters();f.purchase('a',{grupNama:'Together'});f.purchase('b',{grupNama:'Together'});f.receive('a');
 f.bad('setCommerceHistoryVisibility',f.visibility('pembelian',['a'],true,'omit-unfinished'),/seluruh model/);
 f.bad('setCommerceHistoryVisibility',f.visibility('pembelian',['a','b'],true,'include-unfinished'),/riwayat|aktif/);
 f.receive('b');f.purchase('other');f.receive('other');
 f.bad('setCommerceHistoryVisibility',f.visibility('pembelian',['a'],true,'omit-complete'),/seluruh model/);
 f.bad('setCommerceHistoryVisibility',f.visibility('pembelian',['a','b','other'],true,'cross-invoice'),/satu invoice/);
 f.good('setCommerceHistoryVisibility',f.visibility('pembelian',['a','b'],true,'full-invoice'));
 f.good('setCommerceHistoryVisibility',f.visibility('pembelian',['a'],false,'partial-restore'));
 f.bad('setCommerceHistoryVisibility',f.visibility('pembelian',['a'],true,'omit-hidden-sibling'),/seluruh model/);
 let cancelled=f.purchase('cancelled',{grupNama:'Together',initialPayment:null});cancelled=f.good('cancelCommerceRecord',{module:'pembelian',id:cancelled.id,expectedRevision:cancelled.revision,catatan:'Wrong order'}).record;
 const out=f.good('setCommerceHistoryVisibility',f.visibility('pembelian',['cancelled'],true,'only-cancelled'));
 assert.equal(out.records[0].historyHidden,true);assert.equal(out.records[0].cancelled,true);
});
