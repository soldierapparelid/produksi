'use strict';
/* Layar "Stok & PO ulang" (rakitan 1541b): ekspor Rincian Stok BigSeller dibaca di perangkat dan dicocokkan dengan PO
   yang sedang jalan. Semua data di sini buatan. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}
function ui(){
  const c=vm.createContext({console,TextDecoder,DataView,Uint8Array,ArrayBuffer,Response,Blob,DecompressionStream,Promise,Date,setTimeout});
  vm.runInContext(fs.readFileSync(path.join(root,'src/core.js'),'utf8'),c);
  vm.runInContext(`
    var A={},C={},VIEWS={},messages=[],rendered=0,opened=null,closed=0,sheet='',store={},form={values:{}};
    var S={state:{po:[],produk:[],settings:{ukuran:['M','L','XL','XXL']}},f:{q:''},sub:{}},D={po:{},produk:{}};
    var LS={get:function(k){return store[k]===undefined?null:store[k];},set:function(k,v){store[k]=String(v);return true;}};
    var PO_PITA={potong:'Belum potong',maklon:'Di penjahit'};
    function esc(s){return String(s===undefined?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}
    function nf(n){return String(n||0);}function ic(){return '';}function inisial(s){return String(s||'?').charAt(0);}function lalu(){return 'baru saja';}
    function toast(s,e){messages.push([s,!!e]);}function render(){rendered++;}function emptyBox(s){return s;}function searchBox(){return '';}
    function cocok(q,parts){q=String(q||'').toLowerCase();return !q||parts.join(' ').toLowerCase().indexOf(q)>=0;}
    function seg(k,o,cur){return o.map(function(x){return '['+x[1]+(x[0]===cur?'*':'')+']';}).join('');}
    function poUkuranPotong(po){return po._belum||[];}function poWarna(po){return po._tahap||'maklon';}function T(po){diproyeksi++;return {};}function workflowFor(po){return po.workflow||{ukuran:{}};}var diproyeksi=0;
    function openPO(id,p){opened=p;openedId=id;}var openedId=null,dibuka=null;function $(sel,f){return f&&f.nodes&&f.nodes[sel]||null;}A.poOpen=function(el){dibuka=el.getAttribute('data-id');};function openSheet(fn){sheet=fn();}function sheetHtml(t,b,f){return t+b+(f||'');}function pickList(){return '';}
    function hid(k,v){return '<input name="'+k+'" value="'+esc(v)+'">';}function fNum(l,n,v){return '<input name="'+n+'" value="'+esc(v)+'">';}function footSave(a){return a;}
    function topForm(){return form;}function formVals(){return Object.assign({},form.values);}function dropForm(){closed++;}
    var calls=[],sheetsClosed=0;function closeSheet(){sheetsClosed++;}function newId(){return 'id-baru';}function act(el,p){return p;}function quiet(e){messages.push([e&&e.message,true]);}
    function req(action,payload){return new Promise(function(resolve,reject){calls.push({action:action,payload:payload,resolve:resolve,reject:reject});});}
  `,c);
  vm.runInContext(part('/* ---------------- STOK JUAL & PO ULANG ---------------- */','/* ---------------- TUKANG POTONG ---------------- */'),c);
  return c;
}
function run(c,s){return vm.runInContext(s,c);}
function zip(files){
  const local=[],central=[];let offset=0;
  for(const [name,text,deflate] of files){
    const nb=Buffer.from(name),raw=Buffer.from(text,'utf8'),data=deflate?zlib.deflateRawSync(raw):raw,lh=Buffer.alloc(30),ch=Buffer.alloc(46);
    lh.writeUInt32LE(0x04034b50,0);lh.writeUInt16LE(20,4);lh.writeUInt16LE(deflate?8:0,8);lh.writeUInt32LE(data.length,18);lh.writeUInt32LE(raw.length,22);lh.writeUInt16LE(nb.length,26);
    ch.writeUInt32LE(0x02014b50,0);ch.writeUInt16LE(20,4);ch.writeUInt16LE(20,6);ch.writeUInt16LE(deflate?8:0,10);ch.writeUInt32LE(data.length,20);ch.writeUInt32LE(raw.length,24);ch.writeUInt16LE(nb.length,28);ch.writeUInt32LE(offset,42);
    local.push(lh,nb,data);central.push(ch,nb);offset+=30+nb.length+data.length;
  }
  const cd=Buffer.concat(central),e=Buffer.alloc(22);e.writeUInt32LE(0x06054b50,0);e.writeUInt16LE(files.length,8);e.writeUInt16LE(files.length,10);e.writeUInt32LE(cd.length,12);e.writeUInt32LE(offset,16);
  const all=Buffer.concat([...local,cd,e]);return all.buffer.slice(all.byteOffset,all.byteOffset+all.length);
}
const headers=['Tautan Gambar','Nomor SKU','Judul','Total Stok','Stok Dialokasikan Pesanan','Stok Tersedia Seluruh Gudang','Stok Peringatan'];
const rows=[
  ['https://img.example.test/sku/a.jpg?imageView2/1/w/300/h/300','SA-UJI-KBD-HJ-M','Kaos uji &amp;#8211; adem','5.0','0.0','5.0','20.0'],
  ['https://img.example.test/sku/a.jpg?imageView2/1/w/300/h/300','SA-UJI-KBD-HJ-L','Kaos uji','100.0','2.0','98.0','20.0'],
  ['https://img.example.test/sku/a.jpg?imageView2/1/w/300/h/300','SA-UJI-KBD-HJ-XL','Kaos uji','0.0','0.0','0.0','0.0'],
  ['javascript:alert(1)','SA-UJI-TOP-HT-58','Topi uji','3.0','0.0','3.0','0.0'],
  ['','TANPAUKURAN','Barang satuan','50.0','0.0','50.0','0.0']
];
function sheetXml(){
  const cols='ABCDEFG',cell=(ref,v,num)=>num?`<c r="${ref}" s="2" t="n"><v>${v}</v></c>`:`<c r="${ref}" s="1" t="inlineStr"><is><t>${v}</t></is></c>`;
  return '<?xml version="1.0"?><worksheet><sheetData>'+[headers].concat(rows).map((r,i)=>`<row r="${i+1}" ht="30.0">`+r.map((v,j)=>cell(cols[j]+(i+1),v,i>0&&j>=3)).join('')+'</row>').join('\n')+'</sheetData></worksheet>';
}
function seed(c){
  c.xml=sheetXml();run(c,"S.sj={stok:sjDariBaris(sjBaris(xml,[])),link:{'SA-UJI-KBD-HJ':{p:'p1'}}};");
  run(c,"D.produk.p1={id:'p1',nama:'Kaos Uji Hijau',series:'UJI',aktif:true};S.state.produk=[D.produk.p1];S.state.po=[{id:'po1',status:'aktif',jenis:'stok',produkId:'p1',noPO:'PO-1',agg:{ukuran:{M:{potong:30,bigseller:0},L:{potong:10,qcOk:10}}}}];");
}
function plain(x){return JSON.parse(JSON.stringify(x));}

test('the BigSeller stock export is grouped per item: the last part of the SKU is the size',()=>{
  const c=ui();c.xml=sheetXml();const snap=plain(run(c,'sjDariBaris(sjBaris(xml,[]))'));
  assert.equal(snap.n,5);assert.deepEqual(Object.keys(snap.fam),['SA-UJI-KBD-HJ','SA-UJI-TOP-HT','TANPAUKURAN']);
  assert.deepEqual(snap.fam['SA-UJI-KBD-HJ'],{j:'Kaos uji – adem',g:'https://img.example.test/sku/a.jpg?imageView2/1/w/300/h/300',u:{M:[5,20,0],L:[98,20,2],XL:[0,0,0]}},'available stock, warning level, allocated');
  assert.deepEqual(snap.fam['SA-UJI-TOP-HT'],{j:'Topi uji',g:'',u:{58:[3,0,0]}},'a numeric size groups too; a link that is not a plain https picture is dropped');
  assert.deepEqual(snap.fam.TANPAUKURAN.u,{'-':[50,0,0]});
  assert.throws(()=>run(c,"sjDariBaris([{A:'Nama'},{A:'x'}])"),/Rincian Stok/);
  /* shared strings are read as well */
  c.bersama='<row r="1"><c r="A1" t="s"><v>1</v></c><c r="B1"><v>7</v></c><c r="C1"/></row>';assert.deepEqual(plain(run(c,"sjBaris(bersama,['nol','satu &amp; dua'])")),[{A:'satu & dua',B:'7',C:''}]);
});
test('an .xlsx is opened without a library, deflated or stored',async()=>{
  const c=ui(),xml=sheetXml();c.buf=zip([['xl/sharedStrings.xml','<sst/>',false],['xl/worksheets/sheet1.xml',xml,true]]);
  assert.equal(await run(c,"sjUnzip(buf,'xl/worksheets/sheet1.xml')"),xml);assert.equal(await run(c,"sjUnzip(buf,'xl/sharedStrings.xml')"),'<sst/>');assert.equal(await run(c,"sjUnzip(buf,'xl/tidak-ada.xml')"),'');
  c.bukan=new Uint8Array(64).buffer;await assert.rejects(run(c,'sjUnzip(bukan,"x")'),/bukan Excel/);
  /* choosing the file stores the stock on this device and repaints */
  c.el={files:[{name:'Rincian_Stok.xlsx',arrayBuffer:()=>Promise.resolve(c.buf)}]};run(c,'C.sjFile(el)');await new Promise(r=>setTimeout(r,80));
  assert.deepEqual(plain(c.messages.slice(-1)),[['5 SKU terbaca.',false]]);assert.equal(JSON.parse(c.store.pk_stokjual).n,5);assert.equal(JSON.parse(c.store.pk_stokjual).file,'Rincian_Stok.xlsx');assert.ok(c.rendered>=1);
  assert.deepEqual(Object.keys(c.store),['pk_stokjual'],'nothing else is written');
});
test('each size is red, yellow or green from the stock, the warning level and the production that is running',()=>{
  const c=ui();seed(c);
  const lihat=()=>Object.fromEntries(plain(run(c,'sjHitung()')).map(r=>[r.k,[r.kelas,r.uk.map(u=>u.s+':'+u.st+':'+u.batas).join(' ')]]));
  assert.deepEqual(lihat(),{'SA-UJI-KBD-HJ':['perlu','M:jalan:20 L:aman:20 XL:perlu:10'],'SA-UJI-TOP-HT':['perlu','58:perlu:10'],TANPAUKURAN:['aman','-:aman:10']},'thin and being produced is yellow; thin with nothing running is red; no warning level in BigSeller means 10');
  run(c,"S.state.po[0]._belum=['XL']");assert.equal(lihat()['SA-UJI-KBD-HJ'][0],'jalan','a size that waits to be cut counts as running');
  run(c,"S.state.po[0].jenis='pesanan'");assert.equal(lihat()['SA-UJI-KBD-HJ'][1],'M:perlu:20 L:aman:20 XL:perlu:10','a customer order is not stock production');
  run(c,"S.state.po[0].jenis='stok';S.state.po[0].status='selesai'");assert.equal(lihat()['SA-UJI-KBD-HJ'][0],'perlu','a finished PO no longer counts');
  run(c,"S.state.po[0].status='aktif';S.sj.link['SA-UJI-KBD-HJ'].batas=200");assert.equal(lihat()['SA-UJI-KBD-HJ'][1],'M:jalan:200 L:perlu:200 XL:jalan:200','the owner sets another level for the item; pieces that passed QC are not counted as running');
  /* running = cut and not through QC yet; the BigSeller note plays no part, and a size whose QC is finished is not running */
  run(c,"S.state.po[0].agg.ukuran.L={potong:10,qcOk:4,qcOffline:1,qcReject:1,reject:1,bigseller:0}");assert.equal(plain(run(c,"sjProduksi('p1')")).uk.L.jalan,3);
  run(c,"S.state.po[0].agg.ukuran.L={potong:10,qcOk:0,bigseller:10}");assert.equal(plain(run(c,"sjProduksi('p1')")).uk.L.jalan,10,'a BigSeller note without QC does not finish the size');
  run(c,"S.state.po[0].workflow={ukuran:{L:{complete:true},M:{complete:false}}}");assert.deepEqual(Object.keys(plain(run(c,"sjProduksi('p1')")).uk),['XL','M'],'a size that finished QC is no longer in production');assert.ok(c.diproyeksi>0,'the PO figures are projected before they are read');
  run(c,"S.state.po[0].agg.ukuran.L={potong:10,qcOk:10};delete S.state.po[0].workflow");
  /* a PO without a product id is matched by the item name */
  run(c,"delete S.sj.link['SA-UJI-KBD-HJ'].batas;S.state.po[0].produkId='';S.state.po[0].nama=' kaos uji hijau '");assert.equal(lihat()['SA-UJI-KBD-HJ'][0],'jalan');
});
test('the screen lists what needs a new PO first in short cards, and the owner links, hides, tunes and starts a PO from a card',()=>{
  const c=ui();assert.match(run(c,'VIEWS.stokjual()'),/Belum ada data stok[\s\S]*Rincian Stok/);assert.match(run(c,'VIEWS.stokjual()'),/Unggah stok BigSeller<input type="file" accept="\.xlsx" data-c="sjFile" hidden>/);
  seed(c);let view=run(c,'VIEWS.stokjual()');
  assert.match(view,/\[Perlu PO 2\*\]\[Diproduksi 0\]\[Aman 1\]\[Belum dihubungkan 2\]\[Semua\]/);assert.match(view,/Stok BigSeller baru saja · 3 barang · tersimpan di perangkat ini saja/);
  assert.ok(view.indexOf('Kaos Uji Hijau')>0&&view.indexOf('Kaos Uji Hijau')<view.indexOf('Topi uji'),'the item with more thin sizes comes first');
  /* one small pill per size: size and stock; the colour says the rest */
  assert.match(view,/<span class="sj-sel jalan"><b>M<\/b><span class="sj-n">5<\/span><\/span><span class="sj-sel aman"><b>L<\/b><span class="sj-n">98<\/span><\/span><span class="sj-sel perlu"><b>XL<\/b><span class="sj-n">0<\/span><\/span><\/div>/);
  /* what to do, in words */
  assert.match(view,/<div class="small sj-perlu"><b>Perlu PO:<\/b> XL<\/div><div class="small muted"><b>Sedang diproduksi:<\/b> M 30<\/div>/);
  assert.doesNotMatch(view,/batas \d|Hubungkan dulu ke barangnya|class="chip|Antre potong/,'no level under every size, no helper paragraph, no chips');
  assert.match(view,/background-image:url\(&quot;https:\/\/img\.example\.test\/sku\/a\.jpg\?imageView2\/1\/w\/300\/h\/300&quot;\)/);
  assert.match(view,/class="btn sm pri" data-a="sjPO" data-k="SA-UJI-KBD-HJ">Buat PO<\/button><button class="btn sm ghost" data-a="poOpen" data-id="po1" title="di penjahit">PO-1<\/button><button class="btn sm ghost" data-a="sjAtur" data-k="SA-UJI-KBD-HJ">Atur/);assert.match(html,/qc: 'menunggu QC'/);
  /* an item that is not linked yet: the stock is known, the production is not */
  assert.match(view,/Topi uji<\/div><div class="xs muted">SA-UJI-TOP-HT · warna HT<\/div>[\s\S]*<div class="small sj-perlu"><b>Stok tipis:<\/b> 58<\/div><div class="row wrap gap-s"><button class="btn sm pri" data-a="sjHubung" data-k="SA-UJI-TOP-HT">Hubungkan<\/button><button class="btn sm ghost" data-a="sjSembunyi" data-k="SA-UJI-TOP-HT">Sembunyikan<\/button>/);
  assert.doesNotMatch(view,/Barang satuan|javascript:/);
  run(c,"S.state.po[0]._belum=['XL']");view=run(c,'VIEWS.stokjual()');assert.match(view,/\[Perlu PO 1\*\]\[Diproduksi 1\]/);run(c,"S.sub.sj='jalan'");view=run(c,'VIEWS.stokjual()');
  assert.match(view,/<div class="small muted"><b>Antre potong:<\/b> XL<\/div><div class="small muted"><b>Sedang diproduksi:<\/b> M 30<\/div>/);assert.doesNotMatch(view,/Perlu PO:|data-a="sjPO"/,'nothing to order: no order button');run(c,"delete S.state.po[0]._belum");
  run(c,"S.sub.sj='aman'");view=run(c,'VIEWS.stokjual()');assert.match(view,/Barang satuan[\s\S]*<b>Stok<\/b><span class="sj-n">50<\/span><\/span><\/div><div class="small muted">Stok aman<\/div>/);assert.doesNotMatch(view,/warna /,'a SKU without the usual parts has no colour');
  /* hide with one tap, show again from the hidden tab */
  run(c,"S.sub.sj='perlu';A.sjSembunyi({getAttribute:function(){return 'SA-UJI-TOP-HT';}})");assert.deepEqual(JSON.parse(c.store.pk_stoklink)['SA-UJI-TOP-HT'],{sembunyi:1});assert.match(c.messages.slice(-1)[0][0],/Disembunyikan/);
  view=run(c,'VIEWS.stokjual()');assert.doesNotMatch(view,/data-k="SA-UJI-TOP-HT"/);assert.match(view,/\[Perlu PO 1\*\][\s\S]*\[Disembunyikan 1\]/);
  run(c,"S.sub.sj='sembunyi'");assert.match(run(c,'VIEWS.stokjual()'),/<div class="row wrap gap-s"><button class="btn sm" data-a="sjSembunyi" data-k="SA-UJI-TOP-HT">Tampilkan lagi<\/button><\/div>/);
  run(c,"A.sjSembunyi({getAttribute:function(){return 'SA-UJI-TOP-HT';}});S.sub.sj='perlu'");assert.deepEqual(JSON.parse(c.store.pk_stoklink)['SA-UJI-TOP-HT'],{});assert.match(run(c,'VIEWS.stokjual()'),/data-k="SA-UJI-TOP-HT">Hubungkan/);
  /* start a PO for the linked item */
  run(c,"A.sjPO({getAttribute:function(){return 'SA-UJI-KBD-HJ';}})");assert.equal(c.opened,'p1');assert.deepEqual(plain(c.messages.slice(-1)),[['Ukuran yang perlu: XL',false]]);
  run(c,"opened=null;A.sjPO({getAttribute:function(){return 'SA-UJI-TOP-HT';}})");assert.equal(c.opened,null);assert.equal(c.messages.slice(-1)[0][1],true);
  /* link an item: the choice is stored on this device */
  run(c,"A.sjHubung({getAttribute:function(){return 'SA-UJI-TOP-HT';}});S.pick.cb('p1')");assert.equal(JSON.parse(c.store.pk_stoklink)['SA-UJI-TOP-HT'].p,'p1');
  assert.match(c.sheet,/Barang untuk SA-UJI-TOP-HT[\s\S]*Topi uji<\/div><div class="xs muted">SA-UJI-TOP-HT · warna HT<\/div>[\s\S]*data-a="sjBarangBaru" data-k="SA-UJI-TOP-HT">Belum ada di aplikasi: buat barang baru/,'the sheet shows what BigSeller knows about the item and offers to create it');
  /* tune: the levels in use are shown there; own level, selling well, hidden */
  run(c,"A.sjAtur({getAttribute:function(){return 'SA-UJI-KBD-HJ';}})");assert.match(c.sheet,/Atur SA-UJI-KBD-HJ[\s\S]*Kaos Uji Hijau<\/div><div class="xs muted">Batas sekarang: M 20 · L 20 · XL 10<\/div>[\s\S]*name="laku"[\s\S]*name="sembunyi"[\s\S]*data-a="sjLepas"/);
  run(c,"form.values={k:'SA-UJI-KBD-HJ',batas:'30',laku:true,sembunyi:false};A.sjAturSave()");assert.deepEqual(JSON.parse(c.store.pk_stoklink)['SA-UJI-KBD-HJ'],{p:'p1',batas:30,laku:1});
  run(c,"S.sub.sj='semua'");view=run(c,'VIEWS.stokjual()');assert.match(view,/SA-UJI-KBD-HJ · UJI · lagi laku<\/div>/);assert.match(view,/<b>M<\/b><span class="sj-n">5<\/span>/);
  run(c,"form.values={k:'SA-UJI-KBD-HJ',batas:'',laku:false,sembunyi:true};A.sjAturSave()");assert.deepEqual(JSON.parse(c.store.pk_stoklink)['SA-UJI-KBD-HJ'],{p:'p1',sembunyi:1});
  view=run(c,'VIEWS.stokjual()');assert.doesNotMatch(view,/data-k="SA-UJI-KBD-HJ"/,'a hidden item leaves every list');assert.match(view,/\[Disembunyikan 1\]/);run(c,"S.sub.sj='sembunyi'");assert.match(run(c,'VIEWS.stokjual()'),/data-k="SA-UJI-KBD-HJ">Tampilkan lagi/);
  run(c,"A.sjLepas({getAttribute:function(){return 'SA-UJI-KBD-HJ';},closest:function(){return null;}})");assert.equal(JSON.parse(c.store.pk_stoklink)['SA-UJI-KBD-HJ'].p,undefined);
});
test('the screen is reachable from the owner menu, the PO page and Lainnya; the server is not involved',()=>{
  assert.match(html,/\{ id: 'stokjual', label: 'Stok & PO ulang', icon: 'box', lebih: true \},/);
  assert.match(html,/<button class="btn" data-a="tab" data-id="stokjual">Stok &amp; PO ulang<\/button>/);assert.match(html,/item\('tab', 'box', 'Stok & PO ulang', [^)]*'data-id="stokjual"'\)/);
  const blok=part('/* ---------------- STOK JUAL & PO ULANG ---------------- */','/* ---------------- TUKANG POTONG ---------------- */');
  assert.deepEqual(blok.match(/\breq\('\w+'/g),["req('saveProduk'"],'only creating a missing item reaches the server');assert.doesNotMatch(blok,/Api\.|fetch\(/,'the file and the links stay on the device');assert.deepEqual([...new Set(blok.match(/'pk_[a-z]+'/g))].sort(),["'pk_stokjual'","'pk_stoklink'"]);
});
test('an item that BigSeller has and the app does not is created from the link sheet and linked at once',async()=>{
  const c=ui();seed(c);run(c,"A.sjBarangBaru({getAttribute:function(){return 'SA-UJI-TOP-HT';}})");
  assert.equal(c.sheetsClosed,1,'the product list sheet closes first');assert.match(c.sheet,/Barang baru untuk SA-UJI-TOP-HT[\s\S]*name="newId" value="id-baru"[\s\S]*name="nama"[\s\S]*name="series" list="dl-sj-seri" value="UJI"[\s\S]*<option value="UJI">[\s\S]*sjBarangSave/,'the series is guessed from an item already linked under the same series code');
  run(c,"form.values={k:'SA-UJI-TOP-HT',newId:'id-baru',nama:'  ',series:''};A.sjBarangSave({})");assert.equal(c.calls.length,0);assert.equal(c.messages.slice(-1)[0][1],true);
  run(c,"form.values={k:'SA-UJI-TOP-HT',newId:'id-baru',nama:'Topi Rimba Hitam',series:'UJI'};A.sjBarangSave({});A.sjBarangSave({})");
  assert.equal(c.calls.length,1,'a second tap while saving is ignored');assert.deepEqual(plain(c.calls[0]),{action:'saveProduk',payload:{produk:{newId:'id-baru',nama:'Topi Rimba Hitam',series:'UJI',tarifPotong:0,tarifJahit:0,catatan:''}}});
  run(c,"D.produk['id-baru']={id:'id-baru',nama:'TOPI RIMBA HITAM',series:'UJI',aktif:true};S.state.produk.push(D.produk['id-baru'])");c.calls[0].resolve({id:'id-baru'});await new Promise(r=>setTimeout(r,10));
  assert.equal(JSON.parse(c.store.pk_stoklink)['SA-UJI-TOP-HT'].p,'id-baru');assert.equal(c.closed,1);assert.deepEqual(plain(c.messages.slice(-1)),[['Barang dibuat dan terhubung.',false]]);
  run(c,"S.sub.sj='semua'");assert.match(run(c,'VIEWS.stokjual()'),/TOPI RIMBA HITAM<\/div><div class="xs muted">SA-UJI-TOP-HT · UJI/);
  run(c,"A.sjBarangBaru({getAttribute:function(){return 'SA-XYZ-LAIN-HT';}})");assert.match(c.sheet,/name="series" list="dl-sj-seri" value=""/,'no guess for a series code that was never linked');
  /* a refused save keeps the form and links nothing */
  const g=ui();seed(g);run(g,"form.values={k:'SA-UJI-TOP-HT',newId:'x',nama:'Kaos Uji Hijau',series:'UJI'};A.sjBarangSave({})");g.calls[0].reject(new Error('Produk KAOS UJI HIJAU (UJI) sudah ada.'));await new Promise(r=>setTimeout(r,10));
  assert.equal(g.store.pk_stoklink,undefined);assert.equal(g.closed,0);assert.match(g.messages.slice(-1)[0][0],/sudah ada/);run(g,"A.sjBarangSave({})");assert.equal(g.calls.length,2,'the owner can try again');
});
test('thin sizes join a PO of the same item that is not cut yet instead of becoming a second PO',async()=>{
  const c=ui();seed(c);run(c,"D.po.po1=S.state.po[0];S.state.po[0].agg={ukuran:{}};S.state.po[0]._belum=['M','L']");
  let view=run(c,'VIEWS.stokjual()');
  assert.match(view,/<b>Perlu PO:<\/b> XL<\/div><div class="small muted"><b>Antre potong:<\/b> M · L<\/div>/);
  assert.match(view,/class="btn sm pri" data-a="sjTambah" data-k="SA-UJI-KBD-HJ" data-id="po1">Tambah ke PO-1<\/button>/);assert.doesNotMatch(view,/data-a="sjPO"/,'one button: no second PO for the same item');
  const el="{getAttribute:function(a){return a==='data-k'?'SA-UJI-KBD-HJ':'po1';}}";
  run(c,"form.nodes={'[data-po-active-size=\"XL\"]':{checked:false},'[data-po-active-size=\"M\"]':{checked:true}};A.sjTambah("+el+")");await new Promise(r=>setTimeout(r,120));
  assert.equal(c.openedId,'po1','the edit form of that PO opens');assert.equal(c.opened,'');assert.equal(c.form.nodes['[data-po-active-size="XL"]'].checked,true,'the size is ticked for the owner to check and save');
  assert.deepEqual(plain(c.messages.slice(-1)),[['Ukuran XL sudah dicentang. Periksa, lalu Simpan.',false]]);
  /* a size that was released from that PO is switched back on from the PO sheet */
  run(c,"S.state.po[0].cutting={lepasUkuran:['XL']};openedId=null;A.sjTambah("+el+")");assert.equal(c.dibuka,'po1');assert.equal(c.openedId,null);assert.match(c.messages.slice(-1)[0][0],/pernah dilepas dari PO ini\. Klik "Aktifkan lagi ukuran XL"/);
  run(c,"A.sjTambah({getAttribute:function(a){return a==='data-k'?'SA-UJI-KBD-HJ':'hilang';}})");assert.equal(c.messages.slice(-1)[0][1],true);
  /* once the PO has been cut, a new PO is the way */
  run(c,"delete S.state.po[0].cutting;S.state.po[0].agg={ukuran:{M:{potong:30}}};S.state.po[0]._belum=[]");view=run(c,'VIEWS.stokjual()');assert.match(view,/data-a="sjPO" data-k="SA-UJI-KBD-HJ">Buat PO/);assert.doesNotMatch(view,/sjTambah/);
});
