'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function part(startText, endText) {
  const start = html.indexOf(startText), end = html.indexOf(endText, start + startText.length);
  assert.ok(start >= 0 && end > start, `Source section exists: ${startText}`);
  return html.slice(start, end);
}
function evaluate(context, source) { return vm.runInContext(source, context); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function ui() {
  const context = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core.js'), 'utf8'), context);
  evaluate(context, `
    var A={}, opened=[], calls=[], messages=[], dropped=[], rendered='', title='';
    var actor={id:'owner',divisi:'owner'};
    var S={state:{rencanaPotong:[],potong:[],bahan:[],settings:{}}}, D={po:{}};
    var po={id:'po',nama:'Kemeja',status:'aktif',workflow:{issues:[]}};
    D.po.po=po;
    var first={id:'kg-plan',poId:'po',status:'siap',dibuat:'2026-10-12T09:00:00Z',
      rol:2,bahanList:[{nama:'Scuba Hitam',qty:50.2,satuan:'kg'}],
      rincianRol:[{id:'kg-1',ukuran:'XL',qty:25.1},{id:'kg-2',ukuran:'L',qty:25.1}]};
    var second={id:'yard-plan',poId:'po',status:'siap',dibuat:'2026-10-20T09:00:00Z',
      rol:3,bahanList:[{nama:'Bahan Kemeja',qty:200,satuan:'yard'},{nama:'Rib',qty:1.2,satuan:'kg'}],
      rincianRol:[{id:'yard-1',ukuran:'XL',qty:100},{id:'yard-2',ukuran:'XL',qty:100},{id:'rib-1',qty:1.2}]};
    S.state.rencanaPotong=[first,second];
    function isAdmin(){return actor.divisi==='owner'||actor.divisi==='admin';}
    function workflowFor(p){return p.workflow||{issues:[]};}
    function openPotong(poId,rencanaId,lanjut){opened.push({poId:poId,rencanaId:rencanaId,lanjut:lanjut});}
    function openSheet(render){rendered=render();}
    function sheetHtml(t,b,f){title=t;return '<h2>'+t+'</h2>'+b+(f||'');}
    function toast(text){messages.push(text);}
    function dropForm(form){dropped.push(form);}
    function req(action,payload){calls.push({action:action,payload:payload});throw new Error('Opening a picker must not save');}
    function esc(value){return String(value===undefined?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
    function nf(value){return String(Number(value)||0);}
    function nfQty(value){return String(Number(value)||0);}
    function satuanPendek(value){return value==='yard'?'yd':value==='meter'?'m':value;}
    function tgl(value){return value;}
    function element(attributes,form){return {
      getAttribute:function(name){return Object.prototype.hasOwnProperty.call(attributes,name)?attributes[name]:null;},
      closest:function(){return form||null;}
    };}
  `);
  evaluate(context, part('function rencanaPotongById(', 'function rencanaPotongOwner('));
  evaluate(context, part('A.potongOpen = function', 'function openPotong('));
  return context;
}
function pickerButtons(rendered) {
  return [...rendered.matchAll(/<button\b[^>]*data-a="potongOpen"[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]);
}

test('several ready preparations require an explicit choice and show each date, rolls, materials, and unit', () => {
  const c = ui();
  evaluate(c, `A.potongOpen(element({'data-id':'po'}))`);
  assert.equal(c.title, 'Pilih kain yang dipotong');
  assert.deepEqual(plain(c.opened), [], 'No first preparation is silently selected');
  const buttons = pickerButtons(c.rendered);
  assert.equal(buttons.length, 2);
  assert.match(buttons[0], /data-id="po" data-rencana="kg-plan"/);
  assert.match(buttons[0], /Scuba Hitam · 50\.2 kg/);
  assert.match(buttons[0], /2026-10-12 · 2 rol · L, XL/);
  assert.match(buttons[1], /data-id="po" data-rencana="yard-plan"/);
  assert.match(buttons[1], /Bahan Kemeja · 200 yd<br>Rib · 1\.2 kg/);
  assert.match(buttons[1], /2026-10-20 · 3 rol · XL/);
  assert.doesNotMatch(buttons[1], /XL, XL|201\.2/);
  assert.match(c.rendered, /data-a="close">Batal/);
  assert.deepEqual(plain(c.calls), []);
});

test('canceled, consumed, blocked, and other-PO preparations do not enter the picker', () => {
  const c = ui();
  evaluate(c, `
    S.state.rencanaPotong.push(
      Object.assign({},first,{id:'cancelled',status:'batal'}),
      Object.assign({},first,{id:'consumed',status:'terpakai'}),
      Object.assign({},first,{id:'legacy-blocked',legacyBlocked:'Periksa stok'}),
      Object.assign({},first,{id:'not-ready',status:'draft'}),
      Object.assign({},first,{id:'other-po',poId:'different-po'})
    );
    A.potongOpen(element({'data-id':'po'}));
  `);
  assert.equal(pickerButtons(c.rendered).length, 2);
  assert.doesNotMatch(c.rendered, /data-rencana="(?:cancelled|consumed|legacy-blocked|not-ready|other-po)"/);
  assert.deepEqual(plain(c.opened), []);
  evaluate(c, `S.state.rencanaPotong=S.state.rencanaPotong.filter(function(p){return p.id!=='yard-plan';});rendered='';A.potongOpen(element({'data-id':'po'}));`);
  assert.equal(c.rendered, '', 'Exactly one eligible preparation keeps the direct path');
  assert.deepEqual(plain(c.opened), [{ poId: 'po', rencanaId: 'kg-plan', lanjut: false }]);
});

test('choosing a preparation routes that exact ID directly without saving or changing prepared stock', () => {
  const c = ui();
  const before = JSON.stringify(plain({ state: c.S.state, data: c.D }));
  evaluate(c, `A.potongOpen(element({'data-id':'po'}))`);
  assert.deepEqual(plain(c.opened), []);
  const chosen = pickerButtons(c.rendered)[1];
  const poId = chosen.match(/data-id="([^"]+)"/)[1], planId = chosen.match(/data-rencana="([^"]+)"/)[1];
  c.selected = { 'data-id': poId, 'data-rencana': planId };
  evaluate(c, `rendered='';title='';A.potongOpen(element(selected));`);
  assert.deepEqual(plain(c.opened), [{ poId: 'po', rencanaId: 'yard-plan', lanjut: false }]);
  assert.equal(c.rendered, '');
  assert.equal(JSON.stringify(plain({ state: c.S.state, data: c.D })), before);
  assert.deepEqual(plain(c.calls), []);
  assert.deepEqual(plain(c.dropped), []);
});

test('a sole preparation and the existing continuation path remain direct', () => {
  const c = ui();
  evaluate(c, `S.state.rencanaPotong=[second];A.potongOpen(element({'data-id':'po'}));`);
  assert.deepEqual(plain(c.opened), [{ poId: 'po', rencanaId: 'yard-plan', lanjut: false }]);
  assert.equal(c.rendered, '');
  evaluate(c, `opened=[];S.state.rencanaPotong=[];A.potongOpen(element({'data-id':'po'}));`);
  assert.deepEqual(plain(c.opened), [{ poId: 'po', rencanaId: '', lanjut: false }]);
  evaluate(c, `opened=[];po.cutting={lanjut:'consumed-plan',pendingUkuran:['XL']};A.potongOpen(element({'data-id':'po'}));`);
  assert.deepEqual(plain(c.opened), [{ poId: 'po', rencanaId: '', lanjut: true }]);
});

test('the picker retains admin-only routing while workers use an explicit preparation', () => {
  const c = ui();
  evaluate(c, `actor.divisi='admin';A.potongOpen(element({'data-id':'po'}));`);
  assert.equal(c.title, 'Pilih kain yang dipotong');
  evaluate(c, `actor.divisi='potong';rendered='';title='';A.potongOpen(element({'data-id':'po'}));`);
  assert.equal(c.rendered, '');
  assert.deepEqual(plain(c.opened), [{ poId: 'po', rencanaId: '', lanjut: false }]);
  evaluate(c, `opened=[];A.potongOpen(element({'data-id':'po','data-rencana':'yard-plan'}));`);
  assert.deepEqual(plain(c.opened), [{ poId: 'po', rencanaId: 'yard-plan', lanjut: false }]);
  assert.deepEqual(plain(c.calls), []);
});

test('inactive or blocked POs cannot open a multi-preparation picker', () => {
  for (const setup of [
    `po.status='arsip'`,
    `po.workflow.blockingIssues=['Periksa jumlah']`,
    `po.workflow.issues=['Periksa catatan lama']`,
    `delete D.po.po`
  ]) {
    const c = ui();
    evaluate(c, `${setup};A.potongOpen(element({'data-id':'po'}));`);
    assert.equal(c.rendered, '');
    assert.deepEqual(plain(c.opened), []);
    assert.equal(c.messages.length, 1);
    assert.match(c.messages[0], /PO tidak aktif|PO masih perlu pemeriksaan/);
    assert.deepEqual(plain(c.calls), []);
  }
});

test('picker escapes material labels and IDs, including JSON-encoded prepared material lists', () => {
  const c = ui();
  evaluate(c, `
    po.id='po"<tag>';delete D.po.po;D.po[po.id]=po;
    first.poId=po.id;second.poId=po.id;first.id='plan"<unsafe>';
    first.bahanList=JSON.stringify([{nama:'Katun <img src=x onerror=alert(1)> & "biru"',qty:25,satuan:'kg'}]);
    first.rincianRol=JSON.stringify([{ukuran:'XL<script>',qty:25}]);
    A.potongOpen(element({'data-id':po.id}));
  `);
  assert.match(c.rendered, /data-id="po&quot;&lt;tag&gt;"/);
  assert.match(c.rendered, /data-rencana="plan&quot;&lt;unsafe&gt;"/);
  assert.match(c.rendered, /Katun &lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;biru&quot; · 25 kg/);
  assert.match(c.rendered, /XL&lt;script&gt;/);
  assert.doesNotMatch(c.rendered, /<img|<script>|data-id="po"</);
  assert.deepEqual(plain(c.opened), []);
  assert.deepEqual(plain(c.calls), []);
});

test('manual cutting bypasses the picker and preserves unresolved-form guards', () => {
  const c = ui();
  evaluate(c, `var form={};A.potongOpen(element({'data-id':'po','data-langsung':'1'},form));`);
  assert.equal(c.rendered, '');
  assert.deepEqual(plain(c.opened), [{ poId: 'po', rencanaId: '', lanjut: false }]);
  assert.equal(c.dropped.length, 1);
  for (const flag of ['_potongBusy', '_potongUncertain']) {
    evaluate(c, `opened=[];dropped=[];form={};form['${flag}']=true;A.potongOpen(element({'data-id':'po','data-langsung':'1'},form));`);
    assert.deepEqual(plain(c.opened), []);
    assert.deepEqual(plain(c.dropped), []);
  }
  assert.deepEqual(plain(c.calls), []);
});
