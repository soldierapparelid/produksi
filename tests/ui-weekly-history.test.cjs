'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function part(start,end){const a=html.indexOf(start),b=html.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return html.slice(a,b);}
function ui(role='owner'){
  const c=vm.createContext({console});
  vm.runInContext(['core.js','slip-models.js'].map(f=>fs.readFileSync(path.join(root,'src',f),'utf8')).join('\n'),c);
  vm.runInContext(`var A={},C={},VIEWS={},sheets=[],lastSheet='',messages=[],printed=[],pdfs=[],renderCount=0;
    var worker={id:'worker01',nama:'Mang <A>',divisi:'jahit'},cutter={id:'cutter01',nama:'Pemotong',divisi:'potong'},D={user:{worker01:worker,cutter01:cutter}},DIVISI={jahit:{label:'Maklon Jahit'},potong:{label:'Tukang Potong'}};
    var S={token:'session1',f:{umOrang:'worker01',umPeriode:'2026-W41'},sub:{},state:{me:{id:'owner01',divisi:'owner'},settings:{ukuran:['M','L']},users:[worker,cutter],po:[{id:'po01',nama:'Kaos <script>x</script>'}],potong:[],kasbon:[],upah:[],payroll:[]}};
    function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
    function nf(n){return coreRibuan(n);}function rp(n){return coreRupiah(n);}function tglSlip(v){return coreSlipDate(v);}function tgl(v){return v;}function todayYmd(){return '2026-10-08';}function ic(){return '';}
    function me(){return S.state.me;}function isAdmin(){return ['owner','admin'].indexOf(me().divisi)>=0;}function emptyBox(s){return '<p>'+esc(s)+'</p>';}function toast(s){messages.push(s);}function quiet(){}function act(el,p){return p;}
    function seg(k,items,current){return '<nav>'+items.map(function(i){return esc(i[1]);}).join(' · ')+'</nav>';}function render(){renderCount++;}function slipPasangCss(){}
    function payrollRows(u){return S.state.payroll.filter(function(r){return r.pegawaiId===u.id;});}function payrollNotice(){return '<p>Catatan pembayaran mengikuti bukti terverifikasi.</p>';}
    function kasbonSemua(){return coreKasbon(S.state.kasbon);}function daftarPeriode(ids){return ids.map(function(id){return [id,id];});}function labelPeriode(id){return id;}
    function sheetHtml(title,body,foot){return '<h2>'+esc(title)+'</h2>'+body+(foot||'');}function openSheet(fn,opt){sheets.push({fn:fn,opt:opt});lastSheet=fn();}
    function closeSheet(){var s=sheets.pop();if(s&&s.opt&&s.opt.onClose)s.opt.onClose();}
    function slipLembar(models){return '<div data-full-slip>'+esc(JSON.stringify(models))+'</div>';}
    function slipCetak(models){printed.push(JSON.parse(JSON.stringify(models)));return Promise.resolve();}function slipUnduh(action,payload){pdfs.push({action:action,payload:JSON.parse(JSON.stringify(payload))});return Promise.resolve();}
    var Api={mode:function(){return 'gas';}};
  `,c);
  vm.runInContext(part('function slipDocumentActions(', '/* ---------- periode mingguan'),c);
  vm.runInContext(part('function slipUpahMingguan(', 'C.umOrang ='),c);
  vm.runInContext(part('function upahSaya()', "VIEWS['p-upah'] ="),c);
  vm.runInContext(html.match(/^function catatanDipangkas\(\).*$/m)[0],c);
  if(role!=='owner')vm.runInContext(role==='potong'?'S.state.me=cutter;S.f.umOrang=cutter.id;':'S.state.me=worker;',c);
  return {c,run:s=>vm.runInContext(s,c),json:s=>JSON.parse(vm.runInContext('JSON.stringify('+s+')',c))};
}
function earning(extra={}){return {id:'earn01',earnedId:'earn01',sourceId:'source01',poId:'po01',pegawaiId:'worker01',jenis:'jahit',tanggal:'2026-10-06',total:10,rate:2000,paidQty:4,available:6,ukuran:{M:10},ref:'SS-01',issues:[],...extra};}
function setPay(h,rows){h.c.fixture=rows;h.run('S.state.payroll=fixture');}
const trigger="{getAttribute:function(k){return {'data-id':'worker01','data-start':'2026-10-05','data-end':'2026-10-11'}[k];}}";

test('admin history renders the exact verified model values with dates, escaped detail, quantity and rate instead of inline A4',()=>{
  const h=ui();setPay(h,[earning(),earning({id:'later',earnedId:'later',tanggal:'2026-10-12',total:99}),earning({id:'foreign',earnedId:'foreign',pegawaiId:'other'})]);const before=h.json('S.state'),expected=h.json("coreWeeklySlipModel(S.state,worker,'2026-10-05','2026-10-11')");
  const view=h.run('upahMingguView()');assert.match(view,/Riwayat pekerjaan/);assert.match(view,/6 Okt 2026/);assert.match(view,/10 pcs/);assert.match(view,/Tarif \/ pcs Rp 2\.000/);assert.match(view,/Rp 20\.000/);assert.match(view,/Tersedia untuk dibayar<\/dt><dd class="num b">Rp 12\.000/);assert.match(view,/Alokasi pekerjaan sudah dibayar<\/dt><dd class="num">Rp 8\.000/);
  assert.match(view,/Kaos &lt;script&gt;x&lt;\/script&gt;/);assert.doesNotMatch(view,/<script>|data-full-slip|slip-pratinjau|99 pcs/);assert.match(view,/data-c="umOrang"/);assert.match(view,/data-c="umPeriode"/);assert.match(view,/data-a="weeklySlipOpen"[^>]*>Lihat slip/);assert.deepEqual(h.json('S.slipDok'),[expected.model]);assert.deepEqual(h.json('S.state'),before);
});

test('review-only and missing-rate work remain visible in collapsed notes and contribute no available wages',()=>{
  const h=ui();setPay(h,[earning({needsReview:true,available:0,issues:['Bukti <belum> lengkap']}),earning({id:'no-rate',earnedId:'no-rate',rate:0,available:0,total:3})]);const view=h.run('upahMingguView()');
  assert.match(view,/Belum ada pekerjaan terverifikasi/);assert.match(view,/<details class="card weekly-notes"><summary/);assert.doesNotMatch(view,/<details[^>]*\bopen/);assert.match(view,/Perlu ditinjau — tidak masuk jumlah tersedia untuk dibayar/);assert.match(view,/Bukti &lt;belum&gt; lengkap/);assert.match(view,/Tarif atau bukti pekerjaan perlu diperiksa/);assert.match(view,/Tersedia untuk dibayar<\/dt><dd class="num b">Rp 0/);assert.match(view,/2 catatan/);assert.doesNotMatch(view,/4 catatan/);assert.equal(h.json('S.slipDok[0].rows').length,0);
});

test('staff history preserves corrected cutting wages and material notes while old-data warning stays actionable',()=>{
  const h=ui('potong');setPay(h,[earning({id:'cut01',earnedId:'cut01',sourceId:'cut01',pegawaiId:'cutter01',jenis:'potong',total:114,rate:100,paidQty:114,available:0,ukuran:{M:114}})]);
  h.run("S.state.trimmed=true;S.state.potong=[{id:'cut01',total:144,historyCorrection:{original:{total:114,ukuran:{M:114}}},bahanList:[{nama:'Kain <A>',qty:2}]}]");const view=h.run('upahSaya()');assert.match(view,/Fisik setelah koreksi 144 pcs; dasar upah awal tetap 114 pcs/);assert.match(view,/Kain &lt;A&gt; 2 kg/);assert.match(view,/Rp 11\.400/);assert.match(view,/data-a="loadAll">Muat data lama/);assert.doesNotMatch(view,/data-full-slip|slip-pratinjau/);assert.equal(h.json('S.slipPdfRequest').payload.pegawaiId,'cutter01');
});

test('weekly detail freezes the selected model and export request despite a different page rendering underneath',async()=>{
  const h=ui();setPay(h,[earning()]);h.run('upahMingguView()');const selected=h.json('S.slipDok'),request=h.json('S.slipPdfRequest');h.run('A.weeklySlipOpen('+trigger+')');assert.match(h.run('lastSheet'),/data-full-slip/);assert.match(h.run('lastSheet'),/weeklySlipCetak/);assert.match(h.run('lastSheet'),/weeklySlipPdf/);
  h.run("S.slipDok=[{title:'Different document'}];S.slipPdfRequest={action:'makeGajiPdf',payload:{periode:'different'}};S.f.umPeriode='2026-W42';S.state.payroll=[]");const behind=h.json('S.slipDok'),behindRequest=h.json('S.slipPdfRequest');await h.run('A.weeklySlipCetak(null)');await h.run('A.weeklySlipPdf(null)');assert.deepEqual(h.json('printed[0]'),selected);assert.deepEqual(h.json('pdfs[0]'),request);assert.deepEqual(h.json('S.slipDok'),behind);assert.deepEqual(h.json('S.slipPdfRequest'),behindRequest);h.run('closeSheet()');assert.deepEqual(h.json('S.slipDok'),behind);assert.deepEqual(h.json('S.slipPdfRequest'),behindRequest);assert.equal(h.run('S.weeklySlipPreview'),null);
});

test('closing an unchanged modal restores its original globals; changed sessions cannot export or restore old documents',()=>{
  const h=ui();setPay(h,[earning()]);h.run('upahMingguView();var original=S.slipDok,originalRequest=S.slipPdfRequest');h.run('A.weeklySlipOpen('+trigger+');closeSheet()');assert.equal(h.run('S.slipDok===original && S.slipPdfRequest===originalRequest'),true);
  h.run('A.weeklySlipOpen('+trigger+');S.token="session2";A.weeklySlipCetak(null);A.weeklySlipPdf(null);closeSheet()');assert.equal(h.run('printed.length+pdfs.length'),0);assert.deepEqual(h.json('S.slipDok'),[]);assert.equal(h.run('S.slipPdfRequest'),null);assert.match(h.json('messages').join(' '),/Sesi atau slip berubah/);
});

test('stale period links and a worker opening another person fail before print or PDF',()=>{
  const h=ui();setPay(h,[earning()]);h.run('upahMingguView();S.f.umPeriode="2026-W42";upahMingguView();');h.run('A.weeklySlipOpen('+trigger+')');assert.equal(h.run('sheets.length'),0);assert.equal(h.run('S.weeklySlipSelection'),null);
  h.run('S.f.umPeriode="2026-W41";upahMingguView();S.state.me=cutter;S.weeklySlipSelection.scope=weeklySlipScope();');h.run('A.weeklySlipOpen('+trigger+')');assert.equal(h.run('sheets.length'),0);assert.equal(h.run('printed.length+pdfs.length'),0);
});

test('a valid zero-quantity row stays explicit and an actually empty week clears all weekly export selection',()=>{
  const h=ui('jahit');setPay(h,[earning({total:0,paidQty:0,available:0,ukuran:{M:0}})]);const view=h.run('upahSaya()');assert.match(view,/0 pcs/);assert.match(view,/Rp 0/);assert.match(view,/weeklySlipOpen/);h.run('S.state.payroll=[]');const empty=h.run('upahSaya()');assert.match(empty,/Tidak ada pekerjaan Anda/);assert.doesNotMatch(empty,/weeklySlipOpen/);assert.deepEqual(h.json('S.slipDok'),[]);assert.equal(h.run('S.slipPdfRequest'),null);assert.equal(h.run('S.weeklySlipSelection'),null);
});
