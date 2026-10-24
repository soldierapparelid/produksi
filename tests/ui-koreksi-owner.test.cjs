'use strict';
/* 1544b: the owner corrects every division from the PO history: each row carries its own button. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
function part(a,b){const p=html.indexOf(a),q=html.indexOf(b,p+a.length);assert.ok(p>=0&&q>p,a);return html.slice(p,q);}

test('assignment and sewing report rows get a delete button for owner/admin, paid or prepared rows show why they are locked',()=>{
  const riwayat=part('  /* riwayat */','ev.sort(');
  assert.match(riwayat,/slip: r\.asal === 'koreksi-ukuran' \? null : \['kirim', r\.id\], del: admin && r\.asal !== 'koreksi-ukuran' \? \['SlipKirim', r\.id\] : null/);
  assert.match(riwayat,/del: admin && r\.asal !== 'koreksi-ukuran' && !sourcePaid\(r\) && !\(st\.qc \|\| \[\]\)\.some\(function \(q\) \{ return q\.setorId === r\.id; \}\) \? \['SlipSetor', r\.id\] : null/);
  assert.match(riwayat,/kunci: sourcePaid\(r\) \? sourcePaymentChip\(r\) : \(admin && r\.rencanaId \? '<span class="chip"[^>]*>Dari persiapan<\/span>' : ''\)/);
  const baris=part('    var tail = e.slip ?','return \'<div class="item \' + e.c');
  assert.match(baris,/tail \+= \(e\.kunci \|\| ''\) \+ \(\(e\.del \? '<button class="icon-btn" aria-label="Hapus" data-a="del"/);
  assert.ok(baris.indexOf('data-a="slip"')<baris.indexOf('tail +='),'the delete button follows the Slip button on the same row');
});

test('the confirmation names what a delete does, and the home feed offers the undo of a count',()=>{
  const del=part('A.del = function (el) {','};');
  assert.match(del,/SlipSetor: 'Laporan setor penjahit dan hitungannya ikut terhapus\. Kalau hanya hitungannya yang salah, pakai Batalkan hitungan\.'/);
  assert.match(del,/text: akibat \|\| 'Angka progres PO ikut berubah\.'/);
  assert.match(html,/'">Hitung<\/button>' : \(typeof setorBisaBatal === 'function' && setorBisaBatal\(r\) \? '<button class="btn sm" data-a="setorBatalHitung"/);
  assert.match(html,/Salah input di divisi mana pun\? Hapus catatannya lewat ikon tempat sampah di barisnya/);
});

test('opening evidence offers neither delete nor a made-up cutting wage, while actual counts retain undo',()=>{
  const c=vm.createContext({});
  for(const file of ['core.js','history-corrections.js'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src',file),'utf8'),c);
  vm.runInContext(`var A={},admin=true,id='fixture-po',ev=[],STATUS_SETOR={diajukan:['Menunggu hitung'],diterima:['Dihitung']};
    var st={potong:[],kirim:[],setor:[],qc:[],gudang:[]},S={state:st};
    function nf(n){return String(n);}function namaUser(id){return id||'';}function bahanTeks(){return '';}function rp(n){return String(n);}function tgl(s){return s;}
    function sourceCanEditRate(){return true;}function sourcePaid(){return false;}function sourcePaymentChip(){return '';}function isAdmin(){return admin;}function me(){return {id:'owner'};}
    function row(key,opening){return {id:key,dibuat:key,poId:id,total:12,ukuran:{M:12},asal:opening?'koreksi-ukuran':'',imporSumber:opening?{ownerSizeCorrection:{id:'fixture-correction'}}:{},status:'diterima',maklonId:'sewer',dibuatOleh:opening?'owner':'sewer'};}
    st.potong=[row('opening-cut',true),row('actual-cut',false)];st.kirim=[row('opening-send',true),row('actual-send',false)];st.setor=[row('opening-count',true),row('actual-count',false)];`,c);
  vm.runInContext(part('function setorBisaBatal(r) {','A.del = function'),c);
  vm.runInContext(part('  st.potong.forEach(function (r) { if (r.poId === id) ev.push(', '  ev.sort('),c);
  const events=JSON.parse(vm.runInContext('JSON.stringify(ev)',c)),byId=Object.fromEntries(events.map(e=>[e.at,e]));
  assert.equal(byId['opening-cut'].del,null);assert.equal(byId['opening-cut'].harga,null);assert.match(byId['opening-cut'].t,/Riwayat potong dipulihkan/);
  assert.equal(byId['opening-send'].del,null);assert.equal(byId['opening-send'].slip,null);
  assert.equal(byId['opening-count'].del,null);assert.equal(byId['opening-count'].batal,'opening-count');
  assert.deepEqual(byId['actual-cut'].del,['Potong','actual-cut']);assert.deepEqual(byId['actual-send'].del,['SlipKirim','actual-send']);assert.deepEqual(byId['actual-count'].del,['SlipSetor','actual-count']);
});
