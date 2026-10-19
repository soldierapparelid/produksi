'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
function fixture(){
 const h=harness();for(const name of ['reconcile-legacy','commerce-hpp','slip-models','commerce','commerce-migration'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src',name+'.js'),'utf8'),h.context);
 const setup=h.request('setupOwner',{nama:'Synthetic owner',pin:'1234'});assert.equal(setup.ok,true,setup.error);const token=setup.data.token;
 const call=(action,p={})=>{h.cold();return h.request(action,{token,workflowVersion:2,...p});};
 const good=(action,p)=>{const r=call(action,p);assert.equal(r.ok,true,r.error);return r.data;};
 const bad=(action,p,re)=>{const r=call(action,p);assert.equal(r.ok,false,'must reject');assert.match(r.error,re);};
 const raw=table=>{h.cold();return h.run('pkStore_().fresh('+JSON.stringify(table)+');pkStore_().read('+JSON.stringify(table)+')');};
 return {h,good,bad,raw};
}
const sizes=()=>[{size:'M',qty:10},{size:'L',qty:12},{size:'XL',qty:10}];
const item=over=>({id:'polo',name:'Polo Basic',color:'Oren Stabilo',size:'M-XL',qty:32,price:60000,sizeBreakdown:sizes(),...over});
const input=over=>({id:'nota_sizes',date:'2026-10-19',customer:{name:'Pelanggan Contoh'},items:[item()],notes:'Offline',...over});
const copy=value=>JSON.parse(JSON.stringify(value));

test('size breakdown is stored, normalized, and remains consistent after payments and corrections',()=>{
 const f=fixture(),record=input({items:[item({sizeBreakdown:[{size:' m ',qty:'10'},{size:'l',qty:12},{size:' xl ',qty:10}]})],initialPayment:{jumlah:500000,metode:'transfer'}});
 let saved=f.good('saveCommerceNota',{record}).record;
 assert.deepEqual(saved.items[0].sizeBreakdown,sizes());assert.equal(saved.items[0].qty,32);assert.equal(saved.items[0].subtotal,1920000);assert.equal(saved.balance,1420000);
 const before=JSON.stringify(f.raw('CommerceEvent')),payments=JSON.stringify(saved.payments),number=saved.noNota,revisionBefore=saved.revision;
 const changed=input({items:[item({sizeBreakdown:[{size:'M',qty:9},{size:'L',qty:13},{size:'XL',qty:10}]})]});
 f.bad('saveCommerceNota',{record:changed,expectedRevision:'old'},/berubah/);
 saved=f.good('saveCommerceNota',{record:changed,expectedRevision:saved.revision}).record;
 assert.equal(saved.noNota,number);assert.equal(saved.total,1920000);assert.equal(saved.totalPaid,500000);assert.equal(JSON.stringify(saved.payments),payments);assert.equal(JSON.stringify(f.raw('CommerceEvent')),before);
 assert.equal(saved.items[0].sizeBreakdown[1].qty,13);
 const stored=JSON.parse(f.raw('CommerceRecord').find(r=>r.kind==='nota').data);assert.deepEqual(stored._notaChanges[0].before.items[0].sizeBreakdown,sizes());
 assert.equal(f.good('saveCommerceNota',{record:changed,expectedRevision:revisionBefore}).record.notaEditCount,1,'lost-response retry returns the prior result');
});

test('invalid breakdown is rejected before any nota is written',()=>{
 const f=fixture();
 const cases=[null,{},[{size:'M',qty:0}],[{size:'',qty:32}],[{size:'M',qty:31}],[{size:'M',qty:32.5}],[{size:'M',qty:true}],[{size:'M',qty:32},{size:' m ',qty:1}],Array.from({length:41},(_,i)=>({size:'S'+i,qty:1})),[{size:'X'.repeat(31),qty:32}],[{size:'M',qty:Infinity}],[{size:'M',qty:100000001}]];
 for(const [i,sizeBreakdown] of cases.entries())f.bad('saveCommerceNota',{record:input({id:'bad'+i,items:[item({sizeBreakdown})]})},/ukuran|angka|jumlah|Jumlah|teks/i);
 f.bad('saveCommerceNota',{record:input({items:[item({clearSizeBreakdown:true})]})},/bukan keduanya/);
 assert.equal(f.raw('CommerceRecord').filter(r=>r.kind==='nota').length,0);
});

test('a stale client cannot erase sizes accidentally; explicit clearing keeps the financial evidence',()=>{
 const f=fixture();let n=f.good('saveCommerceNota',{record:input({initialPayment:{jumlah:1920000,metode:'cash'}})}).record;
 const events=JSON.stringify(f.raw('CommerceEvent')),before=JSON.stringify(f.raw('CommerceRecord'));
 for(const sizesValue of [undefined,[]])f.bad('saveCommerceNota',{record:input({items:[item({sizeBreakdown:sizesValue})]}),expectedRevision:n.revision},/tidak boleh hilang/);
 assert.equal(JSON.stringify(f.raw('CommerceRecord')),before);assert.equal(JSON.stringify(f.raw('CommerceEvent')),events);
 n=f.good('saveCommerceNota',{record:input({items:[item({sizeBreakdown:[],clearSizeBreakdown:true})]}),expectedRevision:n.revision}).record;
 assert.equal(n.items[0].sizeBreakdown,undefined);assert.equal(n.items[0].clearSizeBreakdown,undefined);assert.equal(n.totalPaid,1920000);assert.equal(n.status,'lunas');assert.equal(JSON.stringify(f.raw('CommerceEvent')),events);
 const stored=JSON.parse(f.raw('CommerceRecord').find(r=>r.kind==='nota').data);assert.deepEqual(stored._notaChanges[0].before.items[0].sizeBreakdown,sizes());
});

test('legacy size ranges stay usable and never invent a split; adding real details preserves the total',()=>{
 const f=fixture(),legacy=input({items:[item({sizeBreakdown:undefined})]});let n=f.good('saveCommerceNota',{record:legacy}).record;
 f.h.context.record=n;assert.equal(f.h.run('coreNotaSizeText(record.items[0])'),'');assert.ok(!f.h.run('coreNotaInvoiceHtml(record,{})').includes('<b>Ukuran:</b>'));
 n=f.good('saveCommerceNota',{record:input(),expectedRevision:n.revision}).record;
 assert.equal(n.total,1920000);assert.equal(n.balance,1920000);assert.deepEqual(n.items[0].sizeBreakdown,sizes());
});

test('invoice, both thermal widths, and the generic slip render exact sizes safely without changing money',()=>{
 const f=fixture(),n=f.good('saveCommerceNota',{record:input({initialPayment:{jumlah:1920000,metode:'transfer'}})}).record;f.h.context.record=n;
 const docs=['coreNotaInvoiceHtml(record,{kopSlip:"SOLDIER APPAREL"})','coreNotaStrukHtml(record,{},{lebar:58})','coreNotaStrukHtml(record,{},{lebar:80})'].map(code=>f.h.run(code));
 for(const doc of docs){assert.match(doc,/<b>Ukuran:<\/b>/);for(const [size,qty] of [['M',10],['L',12],['XL',10]])assert.ok(doc.includes(size+' <b>'+qty+' pcs</b>'));assert.match(doc,/1\.920\.000/);assert.match(doc,/LUNAS/);assert.match(doc,/19 Okt 2026/);assert.match(doc,/\.ukuran-pcs\{display:inline-block;max-width:100%/);assert.ok(!doc.includes('M-XL'),'structured sizes replace the old range');}
 const generic=f.h.run('coreCommerceSlipModel("nota",record,{})');assert.equal(generic.rows[0][1],'M 10 pcs · L 12 pcs · XL 10 pcs Oren Stabilo');
 f.h.context.record=copy(n);f.h.context.record.items[0].sizeBreakdown=[{size:'<SCRIPT>',qty:32}];
 for(const code of ['coreNotaInvoiceHtml(record,{})','coreNotaStrukHtml(record,{})']){const doc=f.h.run(code);assert.ok(doc.includes('&lt;SCRIPT&gt;'));assert.ok(!doc.includes('<SCRIPT>'));}
 for(const bad of [[{size:'M',qty:31}],[{size:'M',qty:10},{size:' m ',qty:22}],null]){f.h.context.record=copy(n);f.h.context.record.items[0].sizeBreakdown=bad;assert.equal(f.h.run('coreNotaSizeText(record.items[0])'),'');}
});

test('server PDF uses the same exact detail as the local invoice renderer',()=>{
 const f=fixture(),n=f.good('saveCommerceNota',{record:input()}).record;
 f.h.run("var oldPdfEnv=pkEnv_,lastPdf='';pkEnv_=function(){var e=oldPdfEnv();e.makePdf=function(html){lastPdf=html;return 'pdf-test';};return e;};void 0;");
 const pdf=f.good('makeCommercePdf',{module:'nota',id:n.id,expectedRevisions:{[n.id]:n.revision}});assert.equal(pdf.base64,'pdf-test');
 f.h.context.record=n;assert.equal(f.h.run('lastPdf'),f.h.run('coreNotaInvoiceHtml(record,DEFAULT_SETTINGS,{})'));
});

test('A4 uses the wider product column once for detailed sizes and preserves legacy labels in mixed notes',()=>{
 const f=fixture(),n=f.good('saveCommerceNota',{record:input({items:[item({sizeBreakdown:[{size:'XXL PANJANG KHUSUS',qty:32}]}),{id:'lama',name:'Barang lama',size:'M-XL',qty:6,price:10000}]})}).record;
 f.h.context.record=n;const html=f.h.run('coreNotaInvoiceHtml(record,{})');
 assert.ok(!html.includes('>Ukuran</th>'));assert.equal((html.match(/XXL PANJANG KHUSUS/g)||[]).length,1);
 assert.ok(html.includes('<b>Ukuran:</b> M-XL</div>'),'legacy text is printed without invented quantities');
 assert.ok(html.includes('<span class="ukuran-pcs">XXL PANJANG KHUSUS <b>32 pcs</b></span>'));
 f.h.context.record={...n,items:[n.items[1]]};const legacy=f.h.run('coreNotaInvoiceHtml(record,{})');assert.ok(legacy.includes('>Ukuran</th>'));assert.ok(legacy.includes('<td class="tengah">M-XL</td>'));assert.ok(!legacy.includes('<b>Ukuran:</b>'));
});
