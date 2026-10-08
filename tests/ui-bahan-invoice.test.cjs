'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..'), html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function part(a, b) { const p = html.indexOf(a), q = html.indexOf(b, p + a.length); assert.ok(p >= 0 && q > p, a); return html.slice(p, q); }
function ui() {
  const c = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core.js'), 'utf8'), c);
  vm.runInContext(`
    var A={},C={},R={},requests=[],messages=[],closed=0,applied=0,refreshed=0,ids=0,rendered='',sheetRender;
    var S={state:{stok:[{supplier:'Supplier contoh'}],stokRingkas:[{kunci:'katun combed',nama:'Katun Combed',satuan:'kg',saldo:20},{kunci:'linen',nama:'Linen',satuan:'meter',saldo:30}]}};
    function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}
    function ic(){return '';}function nf(n){return String(n);}function rp(n){return 'Rp '+n;}function todayYmd(){return '2026-10-08';}
    function newId(){ids++;return 'invoice-ui-'+ids;}function hid(k,v){return '<input type="hidden" name="'+k+'" value="'+esc(v)+'">';}
    function fCatatan(v){return '<textarea name="catatan">'+esc(v)+'</textarea>';}
    function footSave(a){return '<button data-a="'+a+'">Simpan</button>';}
    function sheetHtml(title,body,footer){return '<h2>'+title+'</h2>'+body+(footer||'');}
    function openSheet(fn){sheetRender=fn;rendered=fn();}function dropForm(){closed++;}
    function toast(message,bad){messages.push({message:message,bad:!!bad});}function applyState(state){applied++;S.state=state;}function refresh(){refreshed++;}
    function field(name,value,action,row){return {name:name||'',value:String(value==null?'':value),type:'text',disabled:false,attributes:action?{'data-a':action}:{},classList:{add:function(){},remove:function(){}},
      getAttribute:function(k){return k==='name'?this.name:(this.attributes[k]||null);},closest:function(selector){if(selector==='[data-invoice-row]')return row;return form;}};}
    var sheet={},form={rows:[],meta:{},closest:function(selector){return selector==='.sheet'?sheet:null;},getAttribute:function(k){return k==='data-form'?'invoiceBahan':null;}};
    form.headers=['invoiceId','invoice','tanggal','supplier','sumber','catatan'].map(function(k){return field(k,({invoiceId:'invoice-ui-1',invoice:' BON-01 ',tanggal:'2026-10-08',supplier:'Supplier contoh',sumber:'Toko',catatan:'Catatan contoh'})[k]);});
    function row(values){var r={fields:[],meta:{},remove:function(){form.rows=form.rows.filter(function(x){return x!==r;});}};
      var defaults={bahan:'',qty:'',satuan:'kg',rol:'1',harga:''};Object.keys(defaults).forEach(function(k){r.fields.push(field(k,values&&values[k]!==undefined?values[k]:defaults[k],'',r));});
      ['[data-invoice-number]','[data-invoice-line-total]','[data-bahan-status]'].forEach(function(k){r.meta[k]={textContent:''};});r.button=field('','','invoiceRemove',r);return r;}
    form.rows=[row({bahan:'Katun Combed',qty:'2',satuan:'kg',rol:'1',harga:'10000'}),row({bahan:'Linen',qty:'3',satuan:'meter',rol:'2',harga:'4000'})];
    var saveButton=field('','','invoiceSave'),addButton=field('','','invoiceAdd'),checkButton=field('','','invoiceCheck'),retryButton=field('','','invoiceRetry');
    form.meta['[data-invoice-total]']={textContent:''};form.meta['[data-invoice-quantity]']={textContent:''};
    form.meta['[data-invoice-notice]']={hidden:true,innerHTML:''};
    form.meta['[data-invoice-rows]']={insertAdjacentHTML:function(_,text){insertedHtml=text;form.rows.push(row());}};var insertedHtml='';
    function names(scope){return scope===form?form.headers.concat.apply(form.headers,form.rows.map(function(r){return r.fields;})):scope.fields||[];}
    function $$(selector,scope){scope=scope||form;
      if(selector==='[name]')return names(scope);
      if(selector==='[data-invoice-row]')return form.rows.slice();
      if(selector==='[data-a="invoiceSave"]')return scope===sheet?[saveButton]:[];
      if(selector==='input,select,textarea,button')return names(scope).concat(form.rows.map(function(r){return r.button;}),[addButton],form.meta['[data-invoice-notice]'].hidden?[]:[checkButton,retryButton]);
      return [];}
    function $(selector,scope){scope=scope||form;var match=selector.match(/^\\[name="([^"]+)"\\]$/);if(match)return names(scope).find(function(f){return f.name===match[1];})||null;return scope.meta&&scope.meta[selector]||null;}
    function topForm(){return form;}function recalc(f){R.invoiceBahan(f);}
    function req(action,payload){return new Promise(function(resolve,reject){requests.push({action:action,payload:payload,resolve:resolve,reject:reject});});}
  `, c);
  for (const [a, b] of [
    ['function act(el, p)', '/* ---------- gambar ulang'],
    ['function formVals(root)', 'function sizeVals(root)'],
    ['function fTanggal(', '/* ---------- hitungan PO'],
    ['function stokSemua()', 'var STATUS_STOK'],
    ['function jumlahPerSatuan(', 'function pilihRentang('],
    ['function daftarIsi(', 'A.invoiceOpen =']
  ]) vm.runInContext(part(a, b), c);
  const run = code => vm.runInContext(code, c);
  const json = code => JSON.parse(run('JSON.stringify(' + code + ')'));
  const resolve = (index, value) => run(`requests[${index}].resolve(JSON.parse(${JSON.stringify(JSON.stringify(value))}))`);
  const reject = (index, message = 'Koneksi terputus.', uncertain = false) => run(`requests[${index}].reject(Object.assign(new Error(${JSON.stringify(message)}),{uncertain:${uncertain}}))`);
  return { c, run, json, resolve, reject };
}
function savedRows(inv) {
  return inv.items.map((r, i) => ({ id: inv.id + '_' + inv.items.length + '_' + (i + 1), invoiceId: inv.id, jenis: 'beli',
    bahan: r.bahan, qty: Number(r.qty), satuan: r.satuan, rol: Number(r.rol), harga: Number(r.harga), total: Math.round(Number(r.qty) * Number(r.harga)),
    tanggal: inv.tanggal, invoice: inv.invoice.trim(), supplier: inv.supplier.trim(), sumber: inv.sumber.trim(), catatan: inv.catatan }));
}
async function uncertain(u) {
  const pending = u.run('A.invoiceSave(saveButton)');
  u.reject(0, 'Respons terputus.', true); await pending;
  return u.json('form._invoiceAttempt');
}

test('invoice form lists existing materials and suppliers and keeps its generated ID across redraws', () => {
  const u = ui(); u.run("openInvoiceBahan('linen')");
  const view = u.run('rendered');
  assert.match(view, /data-form="invoiceBahan"/);
  assert.match(view, /value="Katun Combed"/); assert.match(view, /value="Linen"/);
  assert.match(view, /value="Supplier contoh"/);
  assert.match(view, /value="meter" selected/);
  assert.match(view, /step="0\.001"/); assert.match(view, /data-a="invoiceAdd"/);
  assert.equal((view.match(/data-invoice-row>/g) || []).length, 1);
  assert.equal(u.run('sheetRender()'), view);
  assert.equal(u.run('ids'), 1);
});

test('two materials retain one header, match canonical names/units and recalculate add/remove totals', () => {
  const u = ui();
  u.run(`form.rows[0].fields[0].value=' katun   COMBED ';form.rows[0].fields[2].value='yard';C.invoiceBahan(form.rows[0].fields[0]);
    form.rows[1].fields[0].value=' LINEN ';form.rows[1].fields[2].value='kg';C.invoiceBahan(form.rows[1].fields[0]);`);
  assert.deepEqual(u.json('invoiceBahanValues(form).items').map(r => [r.bahan, r.satuan]), [['Katun Combed', 'kg'], ['Linen', 'meter']]);
  assert.equal(u.run('invoiceBahanValues(form).invoice'), ' BON-01 ');
  assert.equal(u.run("form.meta['[data-invoice-total]'].textContent"), 'Rp 32000');
  assert.match(u.run("form.meta['[data-invoice-quantity]'].textContent"), /2 baris · 3 rol · 2 kg · 3 m/);
  u.run('A.invoiceAdd(addButton)'); assert.equal(u.run('form.rows.length'), 3);
  assert.match(u.run('insertedHtml'), /data-invoice-row/);
  u.run('A.invoiceRemove(form.rows[2].button);A.invoiceRemove(form.rows[0].button)');
  assert.equal(u.run('form.rows.length'), 1);
  assert.equal(u.run("form.rows[0].meta['[data-invoice-number]'].textContent"), 'Bahan 1');
  assert.equal(u.run("form.meta['[data-invoice-total]'].textContent"), 'Rp 12000');
  u.run('A.invoiceRemove(form.rows[0].button)'); assert.equal(u.run('form.rows.length'), 1);
  u.run('for(var i=0;i<35;i++)A.invoiceAdd(addButton)'); assert.equal(u.run('form.rows.length'), 30);
});

test('one save contains both materials; duplicate clicks cannot submit while inputs and footer are frozen', async () => {
  const u = ui(), pending = u.run('A.invoiceSave(saveButton)');
  u.run('A.invoiceSave(saveButton);A.invoiceAdd(addButton);A.invoiceRemove(form.rows[0].button)');
  assert.equal(u.run('requests.length'), 1);
  assert.equal(u.run('requests[0].action'), 'saveInvoiceBahan');
  assert.equal(u.run('requests[0].payload.invoice.items.length'), 2);
  assert.equal(u.run('saveButton.disabled'), true);
  assert.equal(u.run('names(form).every(function(f){return f.disabled;})'), true);
  assert.equal(u.run('form.rows.length'), 2);
  u.resolve(0, { invoiceId: 'invoice-ui-1' }); await pending;
  assert.equal(u.run('closed'), 1);
});

test('ordinary validation failure preserves values and restores editable fields without changing ID', async () => {
  const u = ui(); u.run("form.headers.find(function(f){return f.name==='sumber';}).disabled=true;");
  const before = u.json('invoiceBahanValues(form)'), pending = u.run('A.invoiceSave(saveButton)');
  u.reject(0, 'Satuan bahan tidak cocok.'); await pending;
  assert.deepEqual(u.json('invoiceBahanValues(form)'), before);
  assert.equal(u.run('form._invoiceFrozen'), false); assert.equal(u.run('saveButton.disabled'), false);
  assert.equal(u.run("form.headers.find(function(f){return f.name==='sumber';}).disabled"), true);
  assert.equal(u.run('form._invoiceAttempt'), null); assert.equal(u.run('closed'), 0);
});

test('uncertain save retains the ID and freezes resubmission until a read-only full-state check proves success', async () => {
  const u = ui(), inv = await uncertain(u);
  u.run('A.invoiceSave(saveButton);A.invoiceRetry(retryButton);A.invoiceAdd(addButton);A.invoiceRemove(form.rows[0].button)');
  assert.equal(u.run('requests.length'), 1); assert.equal(u.run('form.rows.length'), 2);
  assert.equal(u.run('saveButton.disabled'), true); assert.equal(u.run('form._invoiceFrozen'), true);
  assert.equal(u.run('form._invoiceAttempt.id'), inv.id);
  const check = u.run('A.invoiceCheck(checkButton)'); u.run('A.invoiceCheck(checkButton)');
  assert.equal(u.run('requests.length'), 2);
  assert.deepEqual(u.json('requests[1].payload'), { semua: true });
  assert.equal(u.run('requests[1].action'), 'getState');
  const rows = savedRows(inv); rows[0].bahan = ' KATUN  COMBED ';
  u.resolve(1, { me: { id: 'owner', divisi: 'owner' }, stok: rows.reverse() }); await check;
  assert.equal(u.run('closed'), 1); assert.equal(u.run('requests.length'), 2);
  assert.equal(u.run('applied'), 1);
});

test('verified absent, prefix, or non-prefix partial invoice only offers explicit retry using the original snapshot', async () => {
  for (const committed of [[], [0], [1]]) {
    const u = ui(), inv = await uncertain(u), check = u.run('A.invoiceCheck(checkButton)');
    const saved = savedRows(inv);
    u.resolve(1, { me: { id: 'owner' }, stok: committed.map(index => saved[index]) }); await check;
    assert.equal(u.run('requests.length'), 2, 'checking must not automatically write');
    assert.equal(u.run('form._invoiceRetryAllowed'), true); assert.equal(u.run('form._invoiceFrozen'), true);
    assert.equal(u.run('saveButton.disabled'), true);
    assert.match(u.run("form.meta['[data-invoice-notice]'].innerHTML"), /data-a="invoiceRetry"/);
    u.run("form.rows[0].fields[1].value='999';");
    const retry = u.run('A.invoiceRetry(retryButton)'); u.run('A.invoiceRetry(retryButton);A.invoiceSave(saveButton)');
    assert.equal(u.run('requests.length'), 3);
    assert.deepEqual(u.json('requests[2].payload.invoice'), inv, 'retry must not read edited DOM values');
    u.resolve(2, { invoiceId: inv.id }); await retry;
    assert.equal(u.run('closed'), 1);
  }
});

test('different values/IDs, duplicate IDs or unknown partial rows never confirm success', async () => {
  for (const change of ['price', 'id', 'duplicate', 'unknown-partial', 'partial-price', 'no-stock']) {
    const u = ui(), inv = await uncertain(u); let rows = savedRows(inv);
    if (change === 'price') rows[0].harga++;
    if (change === 'id') rows[0].id = inv.id + '_3_1';
    if (change === 'duplicate') rows[1] = { ...rows[0] };
    if (change === 'unknown-partial') { rows = rows.slice(1); rows[0].id = inv.id + '_2_3'; }
    if (change === 'partial-price') { rows = rows.slice(1); rows[0].harga++; }
    const check = u.run('A.invoiceCheck(checkButton)');
    u.resolve(1, change === 'no-stock' ? { me: { id: 'owner' } } : { me: { id: 'owner' }, stok: rows }); await check;
    u.run('A.invoiceRetry(retryButton);A.invoiceSave(saveButton)');
    assert.equal(u.run('requests.length'), 2, change);
    assert.equal(u.run('closed'), 0, change); assert.equal(u.run('form._invoiceFrozen'), true, change);
    assert.equal(u.run('form._invoiceRetryAllowed'), false, change);
    assert.doesNotMatch(u.run("form.meta['[data-invoice-notice]'].innerHTML"), /data-a="invoiceRetry"/);
  }
});

test('failed recheck or failed explicit retry retains the frozen snapshot and requires checking again', async () => {
  const u = ui(), inv = await uncertain(u);
  const check = u.run('A.invoiceCheck(checkButton)'); u.reject(1, 'Server belum menjawab.'); await check;
  u.run('A.invoiceRetry(retryButton)'); assert.equal(u.run('requests.length'), 2);
  const next = u.run('A.invoiceCheck(checkButton)');
  u.resolve(2, { me: { id: 'owner' }, stok: savedRows(inv).slice(0, 1) }); await next;
  const retry = u.run('A.invoiceRetry(retryButton)'); u.reject(3, 'Penyimpanan gagal.'); await retry;
  assert.equal(u.run('form._invoiceFrozen'), true); assert.equal(u.run('form._invoiceRetryAllowed'), false);
  assert.deepEqual(u.json('form._invoiceAttempt'), inv);
  u.run('A.invoiceRetry(retryButton);A.invoiceSave(saveButton)'); assert.equal(u.run('requests.length'), 4);
});

test('invoice grouping keeps old purchases independent even when their printed invoice number is the same', () => {
  const u = ui();
  const groups = u.json(`stokInvoiceGroups([{id:'old1',invoice:'BON',total:10,rol:1},{id:'old2',invoice:'BON',total:20,rol:2},
    {id:'new1',invoiceId:'batch1',invoice:'BON',total:30,rol:3},{id:'new2',invoiceId:'batch1',invoice:'BON',total:40,rol:4}])`);
  assert.deepEqual(groups.map(g => [g.id, g.rows.length, g.total, g.rol]), [['', 1, 10, 1], ['', 1, 20, 2], ['batch1', 2, 70, 7]]);
});
