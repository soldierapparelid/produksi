'use strict';
/* 1543e: "Atur harga" untuk catatan potong memakai findSlip yang asli (bukan tiruan) dan mengirim versi catatannya.
   Sebelumnya findSlip mencari 'potong' di daftar slip upah, sehingga server menjawab "Formulir belum memiliki versi data". */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
function harness(){
  const c=vm.createContext({console,Promise});
  vm.runInContext(`var A={},S={state:{potong:[],setor:[],kirim:[],upah:[]}},sheets=[],nilai={},calls=[],toasts=[],tutup=0,dibuka=0;
    function hid(k,v){nilai[k]=v;return '';}function fNum(){return '';}function sheetHtml(){return '';}function esc(s){return String(s);}function ic(){return '';}
    function coreNum(v){var n=Number(v);return isFinite(n)?n:0;}function openSheet(fn){dibuka++;fn();sheets.push({node:{}});}function formVals(){return Object.assign({},nilai,{harga:'2800'});}
    function req(a,p){calls.push({action:a,payload:p});return Promise.resolve({ok:true});}function act(el,p){return p;}function quiet(){}function closeSheet(){tutup++;}function toast(m,e){toasts.push([m,!!e]);}`,c);
  vm.runInContext(part('function findSlip(type, id) {','function historyOriginalRecord('),c);
  vm.runInContext(part('A.hargaOpen = function','A.slipCopy ='),c);
  return c;
}
const tombol=(sheet,id)=>`{getAttribute:function(k){return {'data-s':${JSON.stringify(sheet)},'data-id':${JSON.stringify(id)},'data-v':'0'}[k];}}`;

test('the price of a cut record is saved with the revision of that cut record',async()=>{
  const c=harness();
  vm.runInContext("S.state.upah=[{id:'cut01',revision:'salah-dari-upah'}];S.state.potong=[{id:'cut01',revision:'potong-rev-7',tarif:0}];",c);
  assert.equal(vm.runInContext("findSlip('potong','cut01').revision",c),'potong-rev-7','a cut record is found among the cut records');
  vm.runInContext(`A.hargaOpen(${tombol('Potong','cut01')})`,c);assert.equal(vm.runInContext('nilai.revision',c),'potong-rev-7');
  await vm.runInContext('A.hargaSave({})',c);
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('calls',c))),[{action:'ubahHarga',payload:{sheet:'Potong',id:'cut01',harga:'2800',expectedRevision:'potong-rev-7'}}]);
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('toasts',c))),[['Harga disimpan.',false]]);
});

test('a sewing slip still works, and a record that is not loaded asks for a reload instead of opening a form that would fail',()=>{
  const c=harness();vm.runInContext("S.state.setor=[{id:'set01',revision:'setor-rev-2'}];",c);
  vm.runInContext(`A.hargaOpen(${tombol('SlipSetor','set01')})`,c);assert.equal(vm.runInContext('nilai.revision',c),'setor-rev-2');
  vm.runInContext(`A.hargaOpen(${tombol('Potong','tidak-ada')})`,c);
  assert.equal(vm.runInContext('dibuka',c),1,'no form for a record that is missing');assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('toasts',c))),[['Catatan ini belum termuat di perangkat. Muat ulang data lalu coba lagi.',true]]);
  assert.equal(vm.runInContext("findSlip('upah','x')",c),null);assert.equal(vm.runInContext("S.state.upah=[{id:'u1'}];findSlip('upah','u1').id",c),'u1','pay slips are still found');
});
