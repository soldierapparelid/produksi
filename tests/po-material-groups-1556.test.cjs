'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
function ui(){
 const c=vm.createContext({});
 vm.runInContext(fs.readFileSync(path.join(root,'src/core.js'),'utf8'),c);
 vm.runInContext(`function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}function nf(n){return String(n);}function nfQty(n){return String(n);}function satuanPendek(s){return s==='yard'?'yd':s==='meter'?'m':s;}function tgl(s){return s;}`,c);
 vm.runInContext(part('function poMaterialGroupUnit(','function rencanaPotongPanel('),c);
 return {c,run(s){return vm.runInContext(s,c);},groups(plans){c.plans=plans;return JSON.parse(JSON.stringify(vm.runInContext('poMaterialGroups(plans)',c)));},render(plans,owner=true,blocked=''){c.plans=plans;return vm.runInContext(`poMaterialGroupsHtml(plans,{id:'po01'},${owner},${JSON.stringify(blocked)})`,c);}};
}
const mat=(nama,qty,satuan='kg')=>({nama,qty,satuan});
function plan(id,status,materials,rolls=[],extra={}){return {id,status,dibuat:status==='terpakai'?'2026-10-12T08:00:00':'2026-10-20T09:00:00',bahanList:materials,rol:rolls.length,alokasiBahan:rolls.map(r=>({stokId:r.stokId,qty:r.qty,ukuran:r.ukuran})),rincianRol:rolls,...extra};}
const roll=(id,bahan,qty,ukuran='',satuan='kg')=>({stokId:id,bahan,qty,ukuran,satuan,rollLabel:'Rol '+id,invoice:'BON-'+id});
function eightRolls(){
 return [
  plan('old','terpakai',[mat('Scuba Hitam',100),mat('Scuba Embos Hitam',60)],[roll('1','Scuba Hitam',25,'M'),roll('2','Scuba Hitam',25,'M'),roll('3','Scuba Hitam',25,'XL'),roll('4','Scuba Hitam',25,'XL'),roll('e1','Scuba Embos Hitam',30,'M'),roll('e2','Scuba Embos Hitam',30,'M')]),
  plan('new','siap',[mat('  scuba   HITAM ',100)],[roll('5','Scuba Hitam',25,'XL'),roll('6','Scuba Hitam',25,'XL'),roll('7','Scuba Hitam',25,'XL'),roll('8','Scuba Hitam',25,'XXL')])
 ];
}
test('date additions share one material card with all eight rolls and size quantities visible, while other fabric stays separate',()=>{
 const h=ui(),plans=eightRolls(),rows=h.groups(plans);
 assert.equal(rows.length,2);const scuba=rows[0];assert.equal(scuba.total,200);assert.equal(scuba.siap,100);assert.equal(scuba.terpakai,100);assert.equal(scuba.rol,8);
 assert.deepEqual(scuba.ukuran,[{ukuran:'M',qty:50,rol:2},{ukuran:'XL',qty:125,rol:5},{ukuran:'XXL',qty:25,rol:1}]);
 assert.equal(rows[1].nama,'Scuba Embos Hitam');assert.equal(rows[1].total,60);assert.equal(rows[1].rol,2);assert.equal(rows[0].sources[0].planId,'new');
 const view=h.render(plans),visible=view.replace(/<details\b[\s\S]*?<\/details>/g,'');
 assert.equal((view.match(/data-po-material-group=/g)||[]).length,2);assert.match(visible,/>8 rol</);assert.match(visible,/Ukuran XL/);assert.match(visible,/5 rol · 125 kg/);assert.match(visible,/Siap dipotong 100 kg/);assert.match(visible,/Tercatat terpakai 100 kg/);
 assert.doesNotMatch(visible,/2026-10-12|2026-10-20|data-a=|Rincian kain|Total kain PO/);assert.doesNotMatch(view,/<details[^>]* open/);
 assert.match(view,/data-id="new">Ubah bahan/);assert.match(view,/data-rencana="new">Catat hasil potong/);assert.match(view,/2026-10-12/);
});
test('a mixed-material source contributes each material once and source actions stay scoped to the original whole preparation',()=>{
 const plans=[plan('mixed','siap',[mat('Badan',50),mat('Tangan',60)],[roll('b1','Badan',25,'L'),roll('b2','Badan',25,'L'),roll('t1','Tangan',60,'XL')],{legacyBahanList:[]})],h=ui(),rows=h.groups(plans),view=h.render(plans);
 assert.deepEqual(rows.map(r=>[r.nama,r.total,r.rol]),[['Badan',50,2],['Tangan',60,1]]);assert.ok(rows.every(r=>r.sources[0].shared));assert.match(view,/Tindakan berlaku untuk seluruh persiapan/);assert.equal((view.match(/data-rencana="mixed"/g)||[]).length,2);
 assert.doesNotMatch(view.replace(/<details\b[\s\S]*?<\/details>/g,''),/data-rencana=/);
});
test('one physical roll used across separate plans is counted once; its quantities are not deduplicated across genuine uses',()=>{
 const h=ui(),old=plan('first','terpakai',[mat('Katun',10)],[roll('same','Katun',10,'M')]),later=plan('later','siap',[mat('katun',15)],[roll('same','Katun',15,'L')]),rows=h.groups([old,{...old},later]);
 assert.equal(rows[0].rol,1);assert.equal(rows[0].total,25);assert.equal(rows[0].sources.length,2);assert.deepEqual(rows[0].ukuran.map(s=>[s.ukuran,s.qty]),[['M',10],['L',15]]);
});
test('yard and meter stay separate from kg; native rolls retain their units and aliases combine only equivalent units',()=>{
 const h=ui(),plans=[plan('a','siap',[mat('Kemeja',200,'yard')],[roll('a','Kemeja',100,'L','yard'),roll('b','Kemeja',100,'XL','yard')]),plan('b','terpakai',[mat('Kemeja',5,'yd')],[roll('c','Kemeja',5,'M','yd')]),plan('m','siap',[mat('Kemeja',30,'meter')]),plan('kg','siap',[mat('Kemeja',25,'kg')])];
 const rows=h.groups(plans);assert.deepEqual(rows.map(r=>[r.satuan,r.total,r.rol]),[['yard',205,3],['meter',30,0],['kg',25,0]]);
 const yard=h.render(plans).split('data-po-material-group="kemeja|meter"')[0];assert.match(yard,/200 yd/);assert.match(yard,/3 rol/);assert.doesNotMatch(yard.replace(/<[^>]+>/g,''),/\bkg\b/);
});
test('legacy multi-material roll totals are never copied into every material or divided by guesswork',()=>{
 const h=ui(),mixed=plan('legacy','terpakai',[mat('Badan',50),mat('Tangan',75)],[],{rol:5}),rows=h.groups([mixed]);
 assert.deepEqual(rows.map(r=>[r.rol,r.rolBelumDirinci]),[[0,true],[0,true]]);assert.ok(rows.every(r=>r.ukuran[0].ukuran===''));
 const single=h.groups([plan('single','terpakai',[mat('Katun',100)],[],{rol:4})])[0];assert.equal(single.rol,4);assert.equal(single.rolBelumDirinci,false);
 const partial=h.groups([plan('partial','siap',[mat('Katun',100)],[roll('known','Katun',25,'M')],{rol:4,alokasiBahan:[],legacyBahanList:[mat('Katun',75)]})])[0];assert.equal(partial.rol,4);assert.equal(partial.total,100);
});
test('canceled stock is omitted, blocked/unfinished quantities are not labeled ready/used, and owner edit restrictions are kept',()=>{
 const plans=[plan('canceled','batal',[mat('Katun',999)]),plan('blocked','siap',[mat('Katun',10)],[],{legacyBlocked:'Periksa ukuran'}),plan('draft','menyiapkan',[mat('Katun',20)])],h=ui(),rows=h.groups(plans);
 assert.equal(rows.length,1);assert.equal(rows[0].total,30);assert.equal(rows[0].siap,0);assert.equal(rows[0].terpakai,0);assert.equal(rows[0].menyiapkan,20);assert.equal(rows[0].perluDiperiksa,10);
 assert.match(h.render(plans),/data-a="rencanaPotongReview"/);assert.doesNotMatch(h.render(plans),/data-rencana=|data-a="rencanaPotongOpen"/);assert.doesNotMatch(h.render(plans,false),/data-a="rencanaPotongReview"|Ubah bahan/);
 assert.doesNotMatch(h.render(eightRolls(),false),/Ubah bahan/);assert.doesNotMatch(h.render(eightRolls(),true,'PO ditahan'),/data-rencana=|data-a="rencanaPotongOpen"/);
});
test('grouping preserves immutable source identities, allocations, revisions and amounts and ignores invalid material amounts',()=>{
 const plans=eightRolls(),before=JSON.stringify(plans);plans.push(plan('invalid','siap',[null,mat('',4),mat('Zero',0),mat('Bad','NaN'),mat('Negative',-1)]));const fullBefore=JSON.stringify(plans);
 function freeze(x){if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}}freeze(plans);
 const h=ui(),rows=h.groups(plans);assert.equal(rows.length,2);h.render(plans);assert.equal(JSON.stringify(plans),fullBefore);assert.deepEqual(h.groups(plans),rows);assert.equal(JSON.stringify(plans.slice(0,2)),before);
});
