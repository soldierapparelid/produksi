'use strict';
/* 1544c: a purchase model is picked from product photo cards; the select keeps the value. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
function harness(){
  const c=vm.createContext({console});
  vm.runInContext(`var A={},C={},picked=[],hydrated=0;
    var P={p1:{id:'p1',nama:'TPR Saku',model:'Karet Saku',warna:'Hitam',hasPicture:true,revision:'rev1'},p2:{id:'p2',nama:'Label <Polo>',model:'Polo'}};
    function commerceFind(m,k,id){return P[id]||null;}function esc(s){return String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;');}
    function commerceThumb(p){return '<span class="thumb" data-p="'+(p.id||'')+'"></span>';}function hydrateImages(){hydrated++;}
    var opts=[{value:''},{value:'p1'},{value:'p2'}];
    var sel={value:'',options:opts,style:{}},box={innerHTML:''};
    var model={q:function(s){return s==='[name="produkId"]'?sel:s==='[data-commerce-tiles]'?box:null;}};
    function $(s,root){return root.q(s);}
    C.commerceBatchProduct=function(el){picked.push(el.value);commerceTilesPaint(model);};`,c);
  vm.runInContext(part('function commerceTilesPaint(model) {','function commerceBatchPaint(f) {'),c);
  return c;
}
const run=(c,s)=>vm.runInContext(s,c);

test('every product of the supplier is a photo card, the select hides behind them and keeps the value',()=>{
  const c=harness();run(c,'commerceTilesPaint(model)');
  const out=run(c,'box.innerHTML');
  assert.equal((out.match(/data-a="commerceTilePick"/g)||[]).length,2);
  assert.match(out,/data-id="p1" aria-pressed="false"><span class="thumb" data-p="p1"><\/span><span class="pk-tile-n">TPR Saku<\/span><span class="xs muted">Karet Saku · Hitam<\/span>/);
  assert.match(out,/Label &lt;Polo&gt;/,'names are escaped');
  assert.equal(run(c,'sel.style.display'),'none');assert.equal(run(c,'hydrated'),1);
  run(c,"A.commerceTilePick({closest:function(s){return s==='[data-commerce-model]'?model:null;},getAttribute:function(){return 'p2';}})");
  assert.equal(run(c,'sel.value'),'p2');assert.deepEqual(JSON.parse(JSON.stringify(run(c,'picked'))),['p2'],'the usual product handler fills the default price');
  assert.match(run(c,'box.innerHTML'),/class="pk-tile on" data-a="commerceTilePick" data-id="p2" aria-pressed="true"/);
  run(c,'commerceTilesPaint(model)');assert.equal(run(c,'hydrated'),2,'nothing is redrawn while the list and choice stay the same');
});

test('without a supplier the plain select stays visible, and a locked form ignores taps',()=>{
  const c=harness();run(c,"opts.length=0;opts.push({value:''});commerceTilesPaint(model)");
  assert.equal(run(c,'box.innerHTML'),'');assert.equal(run(c,'sel.style.display'),'');
  const c2=harness();run(c2,"A.commerceTilePick({closest:function(s){return s==='[data-form]'?{_commerceLocked:true}:model;},getAttribute:function(){return 'p1';}})");
  assert.equal(run(c2,'sel.value'),'');
});

test('the batch model carries the card box and every repaint draws the cards',()=>{
  assert.match(html,/data-c="commerceBatchProduct">'\+commerceProductOptions\(supplierId,row\.produkId\|\|''\)\+'<\/select><\/label><div data-commerce-tiles><\/div>/);
  assert.match(part('function commerceBatchPaint(f) {','var target='),/commerceBatchModels\(f\)\.forEach\(commerceTilesPaint\);/);
});
