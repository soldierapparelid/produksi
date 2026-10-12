'use strict';
/* 1.5.42: rol persiapan potong boleh ditandai per ukuran, dan hubungan SKU BigSeller disimpan di server.
   Semua data di sini buatan. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./helpers/apps-script-harness.cjs');
function fixture(){
  const h=harness();
  for(const name of ['cutting-plans','reconcile-legacy','history-corrections','auto-completion'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name+'.js'),'utf8'),h.context);
  const setup=h.request('setupOwner',{nama:'Owner fixture',pin:'1234'});assert.equal(setup.ok,true,setup.error);const token=setup.data.token,cutter='ukuran-cutter-token-123456';
  h.run(`pkStore_().lock(function(){pkStore_().append('Pegawai',{id:'cutter001',nama:'Cutter',divisi:'potong',aktif:true,token:'${cutter}'});['001','002','003'].forEach(function(n,i){pkStore_().append('StokBahan',{id:'uk-stock-'+n,jenis:'beli',bahan:'Katun',qty:25,satuan:'kg',rol:1,stockMode:'roll',rollLabel:'Rol '+(i+1)});});});`);
  const call=(action,p={},tk=token)=>{h.cold();return h.request(action,{token:tk,workflowVersion:2,...p});};
  const good=(action,p={},tk=token)=>{const r=call(action,p,tk);assert.equal(r.ok,true,r.error);return r.data?.data??r.data;};
  const raw=name=>{h.cold();return h.run(`pkStore_().fresh('${name}');pkStore_().read('${name}')`);};
  const bundle=(alokasi)=>({po:{newId:'uk-po-00001',nama:'Rol per ukuran',jenis:'stok',ukuran:{},ukuranAktif:['M','L','XL']},rencana:{id:'uk-plan-0001',alokasiBahan:alokasi}});
  return {h,token,cutter,call,good,raw,bundle};
}
test('each prepared roll can carry the size it is meant for; the cutter receives it and stock use is unchanged',()=>{
  const f=fixture();
  const plan=f.good('savePOWithRencana',f.bundle([{stokId:'uk-stock-001',qty:4,ukuran:'M'},{stokId:'uk-stock-002',qty:5,ukuran:' l '},{stokId:'uk-stock-003',qty:3}])).rencana;
  assert.deepEqual(JSON.parse(f.raw('RencanaPotong')[0].alokasiBahan),[{stokId:'uk-stock-001',qty:4,ukuran:'M'},{stokId:'uk-stock-002',qty:5,ukuran:'L'},{stokId:'uk-stock-003',qty:3}],'the size is stored with the roll, tidied; a roll without one is for every size');
  const seen=f.good('getState',{},f.cutter).rencanaPotong[0];
  assert.deepEqual(seen.rincianRol.map(r=>[r.rollLabel,r.qty,r.ukuran]),[['Rol 1',4,'M'],['Rol 2',5,'L'],['Rol 3',3,'']]);assert.equal(seen.rol,3);assert.deepEqual(seen.bahanList,[{nama:'Katun',satuan:'kg',qty:12}]);
  /* the owner changes which roll is for which size: it is a real change of the preparation */
  const ganti=f.good('saveRencanaPotong',{expectedRevision:plan.revision,rencana:{id:plan.id,poId:plan.poId,alokasiBahan:[{stokId:'uk-stock-001',qty:4,ukuran:'XL'},{stokId:'uk-stock-002',qty:5,ukuran:'L'},{stokId:'uk-stock-003',qty:3,ukuran:'XL'}]}});
  assert.notEqual(ganti.revision,plan.revision);assert.deepEqual(JSON.parse(f.raw('RencanaPotong')[0].alokasiBahan).map(a=>a.ukuran),['XL','L','XL']);
  for(const buruk of ['M<b>','UKURAN-TERLALU-PANJANG','-M']){const r=f.call('saveRencanaPotong',{expectedRevision:ganti.revision,rencana:{id:plan.id,poId:plan.poId,alokasiBahan:[{stokId:'uk-stock-001',qty:4,ukuran:buruk}]}});assert.equal(r.ok,false,buruk);assert.match(r.error,/Ukuran untuk rol tidak sah/);}
  /* cutting: the whole preparation is used on the first cut, as before */
  f.good('createPotong',{potong:{id:'uk-cut-00001',rencanaId:plan.id,expectedRencanaRevision:ganti.revision,tanggal:'2026-10-12',ukuran:{L:9}}},f.cutter);
  assert.deepEqual(JSON.parse(f.raw('Potong')[0].alokasiBahan).map(a=>[a.stokId,a.qty,a.ukuran]),[['uk-stock-001',4,'XL'],['uk-stock-002',5,'L'],['uk-stock-003',3,'XL']]);
  const owner=f.good('getState');assert.deepEqual(owner.stokRol.map(r=>r.pakai),[4,5,3]);assert.equal(Number(f.raw('Potong')[0].kg),12);
  assert.deepEqual(owner.rencanaPotong[0].rincianRol.map(r=>r.ukuran),['XL','L','XL'],'still visible while the other sizes are continued');
});
test('the links between BigSeller SKU families and items are kept on the server for owner and admin only',()=>{
  const f=fixture();
  assert.deepEqual(f.good('getState').settings.stokJualLink,{});
  const hasil=f.good('saveStokJualLink',{link:{'AB-CDE-FGH-HT':{p:'prod-uji-1',batas:'30',laku:true,sembunyi:false,lain:'x'},'AB-CDE-FGH-MR':{sembunyi:1},'KOSONG':{},'TOPI 58':{p:'p1',batas:0}}});
  assert.deepEqual(hasil,{ok:true,jumlah:3});
  assert.deepEqual(f.good('getState').settings.stokJualLink,{'AB-CDE-FGH-HT':{p:'prod-uji-1',batas:30,laku:1},'AB-CDE-FGH-MR':{sembunyi:1},'TOPI 58':{p:'p1',batas:0}},'only the known fields are kept; an entry with nothing in it is dropped');
  assert.equal('stokJualLink' in f.good('getState',{},f.cutter).settings,false,'a worker never receives the list');
  assert.equal(JSON.parse(f.raw('Pengaturan').filter(r=>r.key==='stokJualLink')[0].value)['AB-CDE-FGH-MR'].sembunyi,1);
  /* the whole list is sent each time: the last one stands */
  f.good('saveStokJualLink',{link:{'AB-CDE-FGH-HT':{p:'prod-uji-2'}}});assert.deepEqual(f.good('getState').settings.stokJualLink,{'AB-CDE-FGH-HT':{p:'prod-uji-2'}});
  for(const [link,pola] of [[[],/tidak sah/],[{'<x>':{p:'a'}},/Kode SKU tidak sah/],[{'AB-1':{p:'a b'}},/Barang untuk AB-1 tidak sah/],[{'AB-1':{batas:1.5}},/bilangan bulat/],[{'AB-1':{batas:-1}},/bilangan bulat/]]){const r=f.call('saveStokJualLink',{link});assert.equal(r.ok,false,JSON.stringify(link));assert.match(r.error,pola);}
  const besar={};for(let i=0;i<1200;i++)besar['SKU-PANJANG-SEKALI-UNTUK-UJI-'+i]={p:'barang-dengan-id-panjang-'+i};const penuh=f.call('saveStokJualLink',{link:besar});assert.equal(penuh.ok,false);assert.match(penuh.error,/terlalu panjang/);
  const pekerja=f.call('saveStokJualLink',{link:{'AB-1':{p:'a'}}},f.cutter);assert.equal(pekerja.ok,false);
  assert.deepEqual(f.good('getState').settings.stokJualLink,{'AB-CDE-FGH-HT':{p:'prod-uji-2'}},'refused requests change nothing');
});
