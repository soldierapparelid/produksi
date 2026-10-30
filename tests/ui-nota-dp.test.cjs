'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const block = html.slice(html.indexOf('/* COMMERCE UI START'), html.indexOf('/* COMMERCE UI END */'));

function harness() {
  const requests = [], context = vm.createContext({console, setTimeout, clearTimeout, request(action, payload) { return new Promise((resolve, reject) => requests.push({action, payload, resolve, reject})); }});
  for (const name of ['core', 'commerce']) vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src', name + '.js'), 'utf8'), context);
  vm.runInContext(`
    var A={},C={},R={},VIEWS={},S={token:'session-one',state:{ver:10,me:{id:'owner',divisi:'owner'},settings:{kopSlip:'USAHA CONTOH',alamat:'Alamat contoh'}},f:{},sub:{},tab:'nota',img:{}},Api={mode:function(){return 'gas';},div:function(){return '';}},UI_VERSION='ui-test',IMG_TOKO='cm.',messages=[],prints=[],lastSheet='',writes=[],kv={};
    var Idb={get:function(s,k,fn){fn(kv[k]);},put:function(s,k,v){kv[k]=v;},del:function(s,k){delete kv[k];}};
    function me(){return S.state.me;} function isAdmin(){return !!S.state&&['owner','admin'].includes(me().divisi);} function req(a,p){return request(a,p);}
    function refresh(){} function render(){} function quiet(){} function toast(t,b){messages.push({text:t,bad:!!b});}
    function nf(v){return coreRibuan(v);} function nfQty(v){return nf(v);} function rp(v){return coreRupiah(v);} function tgl(v){return v||'';} function todayYmd(){return '2026-10-30';} function newId(){return 'new-id';} function ic(){return '';} function inisial(s){return String(s||'?')[0];}
    function esc(v){return coreNotaEsc(v);} function emptyBox(s){return '<p>'+esc(s)+'</p>';} function hid(k,v){return '<input name="'+k+'" value="'+esc(v)+'">';} function fCatatan(s){return '<textarea name="catatan">'+esc(s)+'</textarea>';}
    function sheetHtml(t,b,f){return '<h2>'+esc(t)+'</h2>'+b+(f||'');} function footSave(a,label){return '<button data-a="'+a+'">'+(label||'Simpan')+'</button>';} function hydrateImages(){} function commerceSnapKey(m){return 'snapshot-'+m;}
    var currentForm={values:{},fields:[],note:{hidden:true,innerHTML:''},sheet:{buttons:[]},getAttribute:function(k){return k==='data-module'?'nota':null;},closest:function(){return this.sheet;}};
    function topForm(){return currentForm;} function formVals(f){return f.values;} function $(s,f){if(s==='[data-commerce-note]')return f.note;return null;} function $$(s,f){return [];}
    function openSheet(fn){lastSheet=fn();} function closeSheet(){} function act(el,p){return Promise.resolve(p).catch(function(e){toast(e.message,true);throw e;});}
    function dokumenCetakBuka(doc,options){prints.push({html:doc,options:options});return Promise.resolve({preview:true});}
    var window={scrollTo:function(){}};
  `, context);
  const helperStart = html.indexOf('function fTanggal('), helperEnd = html.indexOf('/* ---------- hitungan PO', helperStart);
  vm.runInContext(html.slice(helperStart, helperEnd), context);
  vm.runInContext(block, context);
  const run = code => vm.runInContext(code, context), json = code => JSON.parse(run('JSON.stringify(' + code + ')'));
  return {context, requests, run, json,
    seed(rows) { run('var e=commerceEntry("nota");e.data=' + JSON.stringify({notes: rows}) + ';e.version=10;e.tried=true;'); },
    values(values = {}) { run('currentForm.values=' + JSON.stringify({jumlah:'200000', tanggal:'2026-10-30', catatan:'DP untuk produksi', ...values}) + ';'); }
  };
}
const nota = (extra = {}) => ({id:'note', noNota:'SA-CONTOH-001', revision:'rev-one', status:'dp', date:'2026-10-20', customer:{name:'Pelanggan contoh', phone:'081-CONTOH', address:'Alamat pelanggan'}, items:[{id:'item', name:'Kemeja Contoh', color:'Biru', size:'M-L', sizeBreakdown:[{size:'M',qty:5},{size:'L',qty:7}], qty:12, price:100000, subtotal:1200000}], total:1200000, subtotal:1200000, totalPaid:300000, balance:900000, notes:'PRIVATE_ORDER_NOTE_TOTAL_1200000', payments:[{id:'payment',tanggal:'2026-10-21',jumlah:300000,metode:'transfer',catatan:'PRIVATE_PAYMENT_NOTE'}], events:[], ...extra});
const valid = {jumlah:'200000', tanggal:'2026-10-30', catatan:'DP untuk produksi'};
const element = '({getAttribute:function(k){return k==="data-id"?"note":k==="data-m"?"nota":null;}})';
const turn = () => new Promise(resolve => setImmediate(resolve));
function documentHtml(h, row = nota(), options = valid) { h.context.record = row; h.context.options = options; return h.run('commerceNotaDpHtml(record,S.state.settings,options)'); }
async function open(h, row = nota()) { h.seed([row]); await h.run('A.commerceNotaDpOpen(' + element + ')'); }
const reply = (rows, version = 10) => ({module:'nota', actor:{id:'owner',divisi:'owner'}, version, notes:rows});

test('DP invoice prints only the requested charge and never leaks order totals, prices or payment history', () => {
  const h=harness(), row=nota(), before=JSON.stringify(row), doc=documentHtml(h,row);
  assert.match(doc,/INVOICE DP/); assert.match(doc,/TAGIHAN DP/); assert.match(doc,/SA-CONTOH-001/); assert.match(doc,/Pelanggan contoh/); assert.match(doc,/200\.000/); assert.match(doc,/DP untuk produksi/);
  for(const forbidden of ['1.200.000','900.000','300.000','100.000','PRIVATE_ORDER_NOTE','PRIVATE_PAYMENT_NOTE','Riwayat pembayaran','SISA TAGIHAN','Sudah dibayar'])assert.ok(!doc.includes(forbidden),forbidden);
  assert.doesNotMatch(doc,/>LUNAS<|DP telah diterima|DP SUDAH DIBAYAR/);
  assert.match(doc,/@page\{[^}]*A4/); assert.equal(JSON.stringify(row),before); assert.equal(h.requests.length,0);
  const full=h.run('coreNotaInvoiceHtml(record,S.state.settings)');assert.match(full,/1\.200\.000/);assert.match(full,/900\.000/);assert.match(full,/PRIVATE_ORDER_NOTE/);
});

test('dedicated DP fields and customer text are escaped without borrowing the original invoice note', () => {
  const h=harness(), row=nota({customer:{name:'<img src=x onerror=alert(1)>',address:'A & B'},notes:'ORIGINAL_ONLY'}), doc=documentHtml(h,row,{...valid,catatan:'<script>alert(1)</script>\nBaris kedua & terakhir'});
  assert.match(doc,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.match(doc,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);assert.match(doc,/Baris kedua &amp; terakhir/);assert.match(doc,/A &amp; B/);assert.doesNotMatch(doc,/<script|onerror="|ORIGINAL_ONLY/);
});

test('DP amount must be a positive whole rupiah within current outstanding balance and date must exist', () => {
  const h=harness();h.context.record=nota();
  for(const jumlah of ['', ' ', '0', '-1', '0.5', 'NaN', 'Infinity', '900001', '9007199254740992']){
    h.context.options={...valid,jumlah};assert.throws(()=>h.run('commerceNotaDpValues(record,options)'),undefined,jumlah);
  }
  for(const tanggal of ['', '2026-02-30', '2026-13-01', '2026-10-30T00:00:00Z', '30/10/2026']){
    h.context.options={...valid,tanggal};assert.throws(()=>h.run('commerceNotaDpValues(record,options)'),undefined,tanggal);
  }
  h.context.options={...valid,catatan:'x'.repeat(501)};assert.throws(()=>h.run('commerceNotaDpValues(record,options)'));
  h.context.options={...valid,jumlah:'900000',tanggal:'2028-02-29'};assert.equal(h.json('commerceNotaDpValues(record,options)').jumlah,900000);
});

test('cancelled, hidden, paid, malformed or review-held notes cannot issue a new DP invoice', async () => {
  for(const extra of [{cancelled:true},{status:'batal'},{historyHidden:true},{totalPaid:1200000,balance:0,status:'lunas'},{paymentReview:true},{needsReview:true},{balance:null},{total:'1200000'},{totalPaid:300001},{payments:[{jumlah:300000,sourceReview:true}]}]){
    const h=harness(), row=nota(extra);h.context.record=row;h.context.options=valid;
    assert.throws(()=>h.run('commerceNotaDpValues(record,options)'),undefined,JSON.stringify(extra));
    await open(h,row);assert.equal(h.run('lastSheet'),'');assert.equal(h.run('prints.length'),0);assert.equal(h.requests.length,0);
  }
});

test('opening Invoice DP leaves the amount blank and printing A4/PDF creates no payment or business edit', async () => {
  const h=harness();await open(h);const sheet=h.run('lastSheet');
  assert.match(sheet,/name="jumlah"[^>]*value=""/);assert.match(sheet,/name="tanggal"[^>]*value="2026-10-30"/);assert.doesNotMatch(sheet,/PRIVATE_ORDER_NOTE/);assert.match(sheet,/Cetak.*PDF/);
  const before=h.json('commerceData("nota")');h.values();await h.run('A.commerceNotaDpCetak(null)');
  assert.equal(h.run('prints.length'),1);assert.match(h.run('prints[0].html'),/200\.000/);assert.match(h.run('prints[0].options.tanda'),/invoice/);
  assert.deepEqual(h.json('commerceData("nota")'),before);assert.equal(h.requests.length,0,'fresh print does not write a payment, nota, or server PDF request');
  assert.match(h.run('commerceNotaRincian("note")'),/data-a="commerceNotaDpOpen"/);
});

test('a bad draft cannot print and the owner can correct it without reopening the note', async () => {
  const h=harness();await open(h);h.values({jumlah:'900001'});await h.run('A.commerceNotaDpCetak(null)');assert.equal(h.run('prints.length'),0);assert.ok(h.json('messages').length);
  h.values();await h.run('A.commerceNotaDpCetak(null)');assert.equal(h.run('prints.length'),1);assert.equal(h.requests.length,0);
});

test('printing refuses changes to session, actor, note contents, source version or settings after the form opened', async () => {
  for(const change of ["S.token='changed'", "S.state.me.id='another-owner'", "S.state.me.divisi='potong'", "commerceData('nota').notes[0].revision='new-revision'", "commerceData('nota').notes[0].customer.name='Someone else'", "commerceEntry('nota').data=JSON.parse(JSON.stringify(commerceEntry('nota').data))", "commerceEntry('nota').version=11", "S.state.settings.kopSlip='Changed business'", "commerceData('nota').notes[0].historyHidden=true", "commerceData('nota').notes[0].cancelled=true"]){
    const h=harness();await open(h);h.values();h.run(change);await h.run('A.commerceNotaDpCetak(null)');assert.equal(h.run('prints.length'),0,change);assert.equal(h.requests.length,0,change);assert.ok(h.json('messages').length,change);
  }
});

test('a stale, loading, failed or outdated snapshot cannot be printed from an already open DP form', async () => {
  for(const change of ["commerceEntry('nota').stale=true", "commerceEntry('nota').lama=1", "commerceEntry('nota').error='network failed'", "commerceEntry('nota').loading=Promise.resolve()", "S.state.ver=11"]){
    const h=harness();await open(h);h.values();h.run(change);await h.run('A.commerceNotaDpCetak(null)');assert.equal(h.run('prints.length'),0,change);assert.ok(h.json('messages').length,change);
  }
});

test('opening from an unready snapshot waits for current server data and failure cannot expose the old form', async () => {
  for(const change of ["commerceEntry('nota').stale=true", "commerceEntry('nota').tried=false", "commerceEntry('nota').version=null", "commerceEntry('nota').version='invalid'", "commerceEntry('nota').error='Earlier failure'", "S.state.ver=11"]){
    const h=harness();h.seed([nota()]);h.run(change);const pending=h.run('A.commerceNotaDpOpen('+element+')');assert.equal(h.run('lastSheet'),'');assert.equal(h.requests.length,1,change);assert.equal(h.requests[0].action,'getCommerceState');
    h.requests[0].resolve(reply([nota({revision:'fresh',customer:{name:'Latest customer'}})],11));await pending;assert.match(h.run('lastSheet'),/Latest customer/,change);assert.equal(h.run('currentForm._commerceNotaDp.revision'),'fresh');
  }
  const k=harness();k.seed([nota()]);k.run("commerceEntry('nota').lama=1");const failed=k.run('A.commerceNotaDpOpen('+element+')');k.requests[0].reject(new Error('Network down'));await failed;assert.equal(k.run('lastSheet'),'');assert.equal(k.run('prints.length'),0);assert.ok(k.json('messages').length);
});

test('a late refresh belonging to a previous login cannot open a DP invoice in the new session', async () => {
  const h=harness();h.seed([nota()]);h.run("commerceEntry('nota').stale=true");const pending=h.run('A.commerceNotaDpOpen('+element+')');h.run("S.token='new-login'");h.requests[0].resolve(reply([nota()]));await pending;await turn();assert.equal(h.run('lastSheet'),'');assert.equal(h.run('prints.length'),0);
});
