'use strict';
/* Kasbon di layar: potongan mengurangi total slip gaji, kasbon dan potongannya bisa diubah langsung,
   dan slip upah tukang punya tombol potong kasbon serta keterangan sisanya. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
function ui(){
  const c=vm.createContext({console});
  vm.runInContext(['core.js','slip-models.js'].map(f=>fs.readFileSync(path.join(root,'src',f),'utf8')).join('\n'),c);
  vm.runInContext(`
    var A={},C={},R={},VIEWS={},rendered='',requests=[],messages=[],closed=0,form={values:{}},DIVISI={jahit:{label:'Maklon Jahit'},potong:{label:'Tukang Potong'}};
    var worker={id:'sewer01',nama:'Mang Atep',divisi:'jahit',aktif:true},D={user:{sewer01:worker}};
    var S={f:{umOrang:'sewer01',umPeriode:'2026-W41'},sub:{},state:{settings:{ukuran:['M']},users:[worker],karyawan:[{id:'daily01',nama:'Sandi'}],gaji:[],kasbon:[],upah:[],po:[{id:'po1',nama:'Polo'}],potong:[],
      payroll:[{id:'setor:c1:M',earnedId:'setor:c1:M',sourceId:'c1',poId:'po1',pegawaiId:'sewer01',jenis:'jahit',tanggal:'2026-10-06',total:100,rate:2000,paidQty:0,available:100,ukuran:{M:100},ref:'SS-1',issues:[]}]}};
    function todayYmd(){return '2026-10-10';}function newId(){return 'form0001';}
    function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}function rp(n){return coreRupiah(n);}function tgl(s){return String(s);}function tglSlip(s){return String(s);}function nf(n){return String(n);}function ic(){return '';}
    function emptyBox(t){return '<div class="empty">'+t+'</div>';}function openSheet(fn){rendered=fn();}function sheetHtml(t,b,f){return '<h2>'+t+'</h2>'+b+(f||'');}function hid(k,v){return '<input type="hidden" name="'+k+'" value="'+esc(v)+'">';}
    function fNum(l,n,v,a){return '<label>'+l+'<input name="'+n+'" value="'+esc(v==null?'':v)+'" '+(a||'')+'></label>';}function fTanggal(l,n,v){return '<label>'+l+'<input type="date" name="'+n+'" value="'+esc(v===undefined?todayYmd():v)+'"></label>';}
    function fText(l,n,v){return '<label>'+l+'<input name="'+n+'" value="'+esc(v||'')+'"></label>';}function fSelect(l,n){return '<select name="'+n+'"></select>';}function fCatatan(){return '';}function footSave(a,t){return '<button data-a="'+a+'">'+(t||'Simpan')+'</button>';}
    function topForm(){return form;}function formVals(f){return f.values;}function toast(t){messages.push(t);}function quiet(e){messages.push(e.message);}function dropForm(){closed++;}function act(el,p){return p;}function confirmBox(){}
    function req(action,payload){return new Promise(function(resolve){requests.push({action:action,payload:payload,resolve:resolve});});}
    function orangKasbonOpsi(){return '';}function slipPasangCss(){}function payrollRows(u){return S.state.payroll.filter(function(r){return r.pegawaiId===u.id;});}function payrollNotice(){return '';}
    function labelPeriode(id){return id;}function daftarPeriode(ids){return ids.map(function(id){return [id,id];});}function slipDocumentActions(){return '<button>Cetak A4</button>';}function slipLembar(){return '<div>slip</div>';}function catatanDipangkas(){return '';}
    function slipUpahMingguan(u,start,end){return coreWeeklySlipModel(S.state,u,start,end);}
  `,c);
  vm.runInContext(part('function karyawanById(id)','VIEWS.gaji = function'),c);
  vm.runInContext(part('function kasbonView() {','/* ---------- slip gaji mingguan'),c);
  vm.runInContext(part('/* kasbon tukang (maklon jahit / tukang potong)','C.umOrang ='),c);
  return {c,run:s=>vm.runInContext(s,c),json:s=>JSON.parse(vm.runInContext('JSON.stringify('+s+')',c))};
}
const el=attrs=>'{getAttribute:function(k){return '+JSON.stringify(attrs)+'[k]||null;}}';
const loan=(id,jenis,orangId,jumlah,tanggal)=>({id,tipe:'kasbon',jenis,orangId,nama:orangId,jumlah,tanggal,keterangan:'Modal'});
const repay=(id,kasbonId,tanggal,jumlah,periode)=>({id,tipe:'cicilan',kasbonId,tanggal,jumlah,periode:periode||'',keterangan:''});

test('the weekly salary total goes down by a repayment whose date lies in that pay range, whatever week name it was saved under',()=>{
  const h=ui(),custom='custom-2026-10-05-2026-10-10';
  h.c.fixture={gaji:[{karyawanId:'daily01',periode:custom,tanggal:'2026-10-05',gaji:132000,lemburTotal:375000,sabtuTotal:90000},{karyawanId:'daily01',periode:custom,tanggal:'2026-10-06',gaji:660000}],
    kasbon:[loan('k1','harian','daily01',1600000,'2026-07-25'),repay('c0','k1','2026-10-03',100000,'2026-W40'),repay('c1','k1','2026-10-10',200000,'2026-W41')]};
  h.run('S.state.gaji=fixture.gaji;S.state.kasbon=fixture.kasbon');
  const r=h.json("ringkasGaji('"+custom+"','daily01')");
  assert.equal(r.bruto,1257000);assert.equal(r.potongan,200000);assert.equal(r.terima,1057000);assert.equal(r.cicilan.length,1);
});

test('the loan list offers Potong and Ubah; the detail lets a loan and each repayment be edited without deleting it',async()=>{
  const h=ui();h.c.fixture=[loan('k1','harian','daily01',1600000,'2026-07-25'),repay('c1','k1','2026-10-10',200000,'2026-W41'),{...repay('adj','k1','2026-10-01',50000,'penyesuaian')}];
  h.run('S.state.kasbon=fixture');
  const list=h.run('kasbonView()');assert.match(list,/data-a="cicilOpen" data-id="k1">Potong</);assert.match(list,/data-a="kasbonRinci" data-id="k1">Ubah</);
  h.run('A.kasbonRinci('+el({'data-id':'k1'})+')');let out=h.c.rendered;
  assert.match(out,/data-a="kasbonUbah" data-id="c1" aria-label="Ubah cicilan"/);assert.ok(!/data-a="kasbonUbah" data-id="adj"/.test(out),'an adjustment row from the old app has no edit button');
  assert.match(out,/data-a="kasbonUbah" data-id="k1">Ubah kasbon</);assert.match(out,/data-a="cicilOpen" data-id="k1">Potong kasbon</);
  h.run('A.kasbonUbah('+el({'data-id':'c1'})+')');out=h.c.rendered;
  assert.match(out,/<h2>Ubah potongan daily01<\/h2>/);assert.match(out,/name="jumlah" value="200000"/);assert.match(out,/name="tanggal" value="2026-10-10"/);assert.match(out,/Paling banyak Rp 1\.550\.000/);
  h.run("form.values={id:'c1',jumlah:'150000',tanggal:'2026-10-09',keterangan:'salah ketik',expectedJumlah:'200000'}");const p=h.run('A.kasbonUbahSave({})');
  assert.deepEqual(h.json('requests[0]'),{action:'ubahKasbon',payload:{id:'c1',jumlah:'150000',tanggal:'2026-10-09',keterangan:'salah ketik',expectedJumlah:'200000'}});
  h.c.requests[0].resolve({});await p;assert.equal(h.c.closed,1);assert.match(h.c.messages.join(' '),/Perubahan disimpan/);
  h.run('A.kasbonUbah('+el({'data-id':'k1'})+')');assert.match(h.c.rendered,/<h2>Ubah kasbon daily01<\/h2>/);assert.match(h.c.rendered,/name="jumlah" value="1600000"/);assert.match(h.c.rendered,/Sudah dicicil Rp 250\.000/);
  h.run("form.values={id:'k1',jumlah:'',tanggal:'2026-07-25'};A.kasbonUbahSave({})");assert.match(h.c.messages.join(' '),/Isi jumlahnya/);assert.equal(h.c.requests.length,1);
});

test('the repayment form asks only for amount, date and note, and takes its date from where it was opened',()=>{
  const h=ui();h.c.fixture=[loan('k1','maklon','sewer01',11200000,'2024-05-04')];h.run('S.state.kasbon=fixture');
  h.run('A.cicilOpen('+el({'data-id':'k1','data-tgl':'2026-10-08'})+')');const out=h.c.rendered;
  assert.match(out,/<h2>Potong kasbon sewer01<\/h2>/);assert.match(out,/name="tanggal" value="2026-10-08"/);assert.ok(!out.includes('<select'),'no week to pick');assert.match(out,/slip upah mingguan yang rentangnya memuat tanggal potong/);
  h.run('A.cicilOpen('+el({'data-id':'k1'})+')');assert.match(h.c.rendered,/name="tanggal" value="2026-10-10"/);
});

test('the weekly wage screen of a worker with a loan shows what is still owed and a Potong kasbon button; the slip then carries the deduction',()=>{
  const h=ui();let view=h.run('upahMingguView()');
  assert.ok(!view.includes('Potong kasbon')&&!view.includes('Sisa kasbon'),'no loan, nothing about a loan');assert.match(view,/Catat kasbon/);
  h.c.fixture=[loan('k2','maklon','sewer01',500000,'2026-09-20'),loan('k1','maklon','sewer01',11200000,'2024-05-04'),repay('c1','k1','2026-10-03',100000)];h.run('S.state.kasbon=fixture');
  view=h.run('upahMingguView()');
  assert.match(view,/data-a="cicilOpen" data-id="k1" data-tgl="2026-10-10">Potong kasbon</,'the oldest open loan, dated today inside the week');assert.match(view,/Sisa kasbon Rp 11\.600\.000\./);
  assert.equal(h.json('S.slipDok[0].summary').find(r=>/^Sisa kasbon/.test(r.label)).label,'Sisa kasbon (belum dipotong periode ini)');
  h.run("S.state.kasbon.push({id:'c2',tipe:'cicilan',kasbonId:'k1',tanggal:'2026-10-10',jumlah:100000,periode:'2026-W41',keterangan:''})");view=h.run('upahMingguView()');
  assert.match(view,/Sudah dipotong kasbon Rp 100\.000\. Sisa kasbon Rp 11\.500\.000\./);
  const sum=h.json('S.slipDok[0].summary');assert.equal(sum.find(r=>r.label==='Potongan kasbon periode ini').value,'− Rp 100.000');assert.equal(sum.find(r=>r.label==='Upah bersih setelah potongan kasbon').value,'Rp 100.000');
  /* an older week keeps its own picture and opens the form on that week's last day */
  h.run("S.f.umPeriode='2026-W40';S.state.payroll[0].tanggal='2026-10-01'");view=h.run('upahMingguView()');assert.match(view,/data-tgl="2026-10-04">Potong kasbon</);
});

test('this week\'s loan deduction is proposed once when the wage is paid',()=>{
  const h=ui();h.c.fixture=[loan('k1','maklon','sewer01',1000000,'2026-09-01'),repay('c0','k1','2026-10-03',100000),repay('c1','k1','2026-10-06',150000),repay('c2','k1','2026-10-10',50000),repay('adj','k1','2026-10-07',9000,'penyesuaian')];
  h.run('S.state.kasbon=fixture');assert.equal(h.run('cicilanMingguIni(worker)'),200000);
  h.run("S.state.upah=[{pegawaiId:'sewer01',tanggal:'2026-10-09',potongan:200000}]");assert.equal(h.run('cicilanMingguIni(worker)'),0,'already used on a wage payment this week');
  h.run("S.state.upah=[{pegawaiId:'sewer01',tanggal:'2026-10-02',potongan:100000}]");assert.equal(h.run('cicilanMingguIni(worker)'),200000);
});
