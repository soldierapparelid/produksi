/* Admin commerce is loaded on demand. Payments and receipts are append-only;
   none of these actions creates, deletes or reallocates production history. */
function coreCommerceHash(value) { return coreLegacyHash(value); }
function coreCommerceKey(module,kind,id) { return 'cm_'+coreCommerceHash([module,kind,String(id)]).slice(0,40); }
function coreCommerceCopy(value) { return JSON.parse(JSON.stringify(value)); }
function coreCommerceRows(value) { return (value instanceof Array ? value : value && typeof value === 'object' ? Object.keys(value).map(function(k){return value[k];}) : []).filter(function(v){return v && typeof v === 'object';}); }
function coreCommerceData(row) { return coreMap(row && row.data); }
/* The original invoice intent, shared with the client for a lost-response check.
   Transport/session fields and later edits are deliberately outside this proof. */
function coreCommerceOrderBatchProof(p) {
  p=p||{};var pay=p.initialPayment;
  var intent={id:p.id,supplierId:p.supplierId,grupNama:p.grupNama===undefined?'':p.grupNama,tanggalOrder:p.tanggalOrder,catatan:p.catatan===undefined?'':p.catatan,
    orders:(p.orders instanceof Array?p.orders:[]).map(function(o){o=o||{};return {id:o.id,produkId:o.produkId,hargaSatuan:o.hargaSatuan,items:(o.items instanceof Array?o.items:[]).map(function(i){i=i||{};return {id:i.id,nama:i.nama,jumlah:i.jumlah};})};}),
    initialPayment:pay?{jumlah:pay.jumlah,tanggal:pay.tanggal||p.tanggalOrder,metode:pay.metode||'transfer',catatan:pay.catatan===undefined?'':pay.catatan}:null};
  if(p.targetInvoiceId){intent.targetInvoiceId=p.targetInvoiceId;intent.expectedGroupRevisions=p.expectedGroupRevisions||{};}
  return coreCommerceHash(intent);
}
/* A merge is one append-only metadata event. Orders and financial/receipt rows
   are never rewritten as a group, so interruption cannot merge only some. */
function coreCommerceInvoiceMergeIndex(events) {
  var out=Object.create(null);
  (events||[]).forEach(function(e){if(e.module!=='pembelian'||e.kind!=='invoiceMerge')return;var d=coreCommerceData(e);
    if(d.version!==1||!d.groupId||!(d.orderIds instanceof Array)||d.orderIds.length<2)return;
    d.orderIds.forEach(function(key){out[key]={id:e.id,data:d,raw:e.data};});
  });return out;
}
function coreCommerceInvoiceKey(value) {
  value=value||{};var supplier=String((value.supplierSnapshot||{}).id||''),group=String(value.invoiceGroupId||value.invoiceId||'').trim(),name=String(value.grupNama||'').trim();
  return JSON.stringify(group?['invoice',supplier,group]:supplier&&name?['legacy',supplier,name]:['order',value.id]);
}
function coreCommerceInvoiceMergeProof(p,actor) {
  var ids=(p.orderIds||[]).slice().sort(),revisions={};ids.forEach(function(key){revisions[key]=(p.expectedRevisions||{})[key]||'';});
  return coreCommerceHash({id:p.id,orderIds:ids,expectedRevisions:revisions,grupNama:String(p.grupNama||'').trim(),actor:actor});
}
/* Removing history is visibility metadata, never a financial cancellation.
   One event covers the whole selection, making invoice hide/restore atomic. */
function coreCommerceHistoryVisibilityIndex(events) {
  var out=Object.create(null);
  (events||[]).forEach(function(e){if(e.kind!=='historyVisibility'||['pembelian','nota'].indexOf(e.module)<0)return;var d=coreCommerceData(e);
    if(d.version!==1||typeof d.hidden!=='boolean'||!(d.ids instanceof Array)||!d.requestId)return;
    d.ids.forEach(function(key){out[e.module+'|'+key]={id:e.id,data:d,raw:e.data,by:e.dibuatOleh,at:e.dibuat};});
  });return out;
}
function coreCommerceHistoryVisibilityProof(p,actor) {
  var ids=(p.ids||[]).slice().sort(),revisions={};ids.forEach(function(key){revisions[key]=(p.expectedRevisions||{})[key]||'';});
  return coreCommerceHash({module:p.module,ids:ids,hidden:p.hidden,requestId:p.requestId,reason:String(p.reason||'').trim(),expectedRevisions:revisions,actor:actor});
}
function coreCommerceHistoryEligible(module,value) {
  if(!value)return false;
  if(value.cancelled||/^(batal|cancelled)$/.test(String(value.status||'')))return true;
  if(module==='nota')return !!value.archived||coreNotaRingkas(value,{}).lunas;
  function valid(n){return n!==undefined&&n!==null&&n!==''&&typeof n!=='boolean'&&Number.isSafeInteger(Number(n))&&Number(n)>=0;}
  return module==='pembelian'&&!value.needsReview&&!value.paymentReview&&!value.receiptReview&&
    [value.totalHarga,value.totalPaid,value.balance,value.totalQty,value.totalReceived].every(valid)&&
    Number(value.balance)===0&&Number(value.totalPaid)===Number(value.totalHarga)&&Number(value.totalQty)>0&&Number(value.totalReceived)===Number(value.totalQty)&&
    (value.items||[]).length>0&&(value.items||[]).every(function(i){return valid(i.jumlah)&&Number(i.jumlah)>0&&Number((value.receivedByItem||{})[i.id]||0)===Number(i.jumlah);});
}
/* One pass over the tables for drawing many records. Without it every order
   parses every product again (photo included) just to find two names. */
function coreCommerceLookup(records, events) {
  var out={products:Object.create(null),suppliers:Object.create(null),events:Object.create(null),invoiceMerges:coreCommerceInvoiceMergeIndex(events),historyVisibility:coreCommerceHistoryVisibilityIndex(events)};
  (records||[]).forEach(function(r){if(r.module!=='pembelian'||r.kind!=='product'&&r.kind!=='supplier')return;var d=coreCommerceData(r),box=r.kind==='product'?out.products:out.suppliers;if(!box[d.id])box[d.id]={id:d.id,nama:d.nama,supplierId:d.supplierId};});
  (events||[]).forEach(function(e){var k=e.module+'|'+e.parentId;(out.events[k]||(out.events[k]=[])).push(e);});
  return out;
}
/* Product photos travel separately (getCommerceImages); lists carry a marker only. */
function coreCommerceLean(value) { if(value&&value.gambar)value.hasPicture=true;if(value)delete value.gambar;return value; }
function coreCommerceRecordView(row, events, records, lookup) {
  var value=coreCommerceCopy(coreCommerceData(row)), embedded=value._initialPayment, own=(lookup?lookup.events[row.module+'|'+value.id]||[]:events||[]).filter(function(e){return e.module===row.module&&e.parentId===value.id;});
  var merge=row.module==='pembelian'&&row.kind==='order'?(lookup?lookup.invoiceMerges:coreCommerceInvoiceMergeIndex(events))[value.id]:null;
  var revisionProof={record:row.revision,events:own.map(function(e){return [e.id,e.data];}).sort(function(a,b){return a[0].localeCompare(b[0]);})};
  if(merge){value.invoiceGroupId=merge.data.groupId;value.invoiceGroupName=merge.data.grupNama;value.invoiceMergedAt=merge.data.createdAt;value.invoiceMergedBy=merge.data.createdBy;value.invoiceMergeProof=merge.data.proof;revisionProof.invoiceMerge=[merge.id,merge.raw];}
  var visibility=(row.kind==='nota'||row.kind==='order')?(lookup?lookup.historyVisibility:coreCommerceHistoryVisibilityIndex(events))[row.module+'|'+value.id]:null;
  if(visibility){value.historyHidden=visibility.data.hidden;value.historyVisibilityRequestId=visibility.data.requestId;value.historyVisibilityProof=visibility.data.proof;value.historyVisibilityBy=visibility.by;value.historyVisibilityAt=visibility.at;value.historyVisibilityReason=visibility.data.reason||'';if(value.historyHidden){value.historyHiddenBy=visibility.by;value.historyHiddenAt=visibility.at;value.historyHiddenReason=visibility.data.reason||'';}revisionProof.historyVisibility=[visibility.id,visibility.raw];}
  var revision=coreCommerceHash(revisionProof);
  value.orderEditCount=(value._orderChanges||[]).length;
  if(value._notaChanges)value.notaEditCount=value._notaChanges.length;
  ['_createHash','_createActor','_lastMutation','_initialPayment','_orderChanges','_notaChanges'].forEach(function(k){delete value[k];});
  value.revision=revision; value.createdBy=row.dibuatOleh;value.createdAt=row.dibuat;value.updatedAt=row.diubah;value.legacy=!!row.sourceHash;
  if(row.kind!=='order'&&row.kind!=='nota')return value;
  var ledger=own.map(function(e){var d=coreCommerceCopy(coreCommerceData(e));d.id=e.id;d.kind=e.kind;d.createdBy=e.dibuatOleh;d.createdAt=e.dibuat;d.legacy=!!e.sourceHash;return d;});
  if(embedded)ledger.unshift(coreCommerceCopy(embedded));
  var voids={};ledger.filter(function(e){return e.kind==='void';}).forEach(function(e){voids[e.eventId]=e;});
  ledger.forEach(function(e){if(voids[e.id]){e.voided=true;e.voidReason=voids[e.id].catatan;}});
  value.events=ledger;value.payments=ledger.filter(function(e){return e.kind==='payment';});value.receipts=ledger.filter(function(e){return e.kind==='receipt';});
  value.totalPaid=0;value.totalReceived=0;var byItem={},ids={},badIds=false;
  (value.items||[]).forEach(function(i){if(!i.id||ids[i.id])badIds=true;else ids[i.id]=true;});
  value.payments.forEach(function(e){if(!e.voided)value.totalPaid+=coreNum(e.jumlah);});
  value.receipts.forEach(function(e){if(e.voided)return;value.totalReceived+=coreNum(e.jumlah);if(!e.itemId||!ids[e.itemId])badIds=true;byItem[e.itemId]=coreNum(byItem[e.itemId])+coreNum(e.jumlah);});
  var rawTotal=row.kind==='nota'?value.total:value.totalHarga,total=coreNum(rawTotal),validTotal=rawTotal!==undefined&&rawTotal!==null&&rawTotal!==''&&typeof rawTotal!=='boolean'&&Number.isSafeInteger(Number(rawTotal))&&Number(rawTotal)>=0,quantity=(value.items||[]).reduce(function(n,i){return n+coreNum(row.kind==='nota'?i.qty:i.jumlah);},0),reasons=[];
  value.balance=Math.max(0,total-value.totalPaid);value.overpaid=Math.max(0,value.totalPaid-total);value.totalQty=quantity;
  value.paymentReview=!validTotal||!(total>=0&&Number.isSafeInteger(total))||value.totalPaid<0||value.overpaid>0||value.payments.some(function(e){return !e.voided&&(!Number.isSafeInteger(e.jumlah)||e.jumlah<0||e.sourceReview);});
  value.receiptReview=row.kind==='order'&&(badIds||value.totalReceived>quantity||value.receipts.some(function(e){return !e.voided&&(!Number.isSafeInteger(e.jumlah)||e.jumlah<0||e.sourceReview);})||(value.items||[]).some(function(i){return !Number.isSafeInteger(Number(i.jumlah))||Number(i.jumlah)<=0||coreNum(byItem[i.id])>coreNum(i.jumlah);}));
  if(value.paymentReview)reasons.push('Nominal pembayaran historis perlu diperiksa; jangan mengubah bukti asli.');
  if(value.receiptReview)reasons.push('Identitas varian atau hubungan penerimaan lama belum cocok. Catatan asli dipertahankan; jangan menebak hubungan dari nama atau urutan.');
  value.needsReview=!!(value.paymentReview||value.receiptReview);value.reviewReasons=reasons;value.receivedByItem=byItem;
  value.status=value.cancelled?'batal':value.needsReview?'review':row.kind==='nota'?(value.balance===0?'lunas':value.totalPaid>0?'dp':'belum'):(value.balance===0&&value.totalReceived>=quantity?'selesai':value.balance===0?'lunas':value.totalReceived>0?'sebagian':value.totalPaid>0?'dp':'pending');
  if(row.kind==='order'){
    var p,s;
    if(lookup){p=lookup.products[value.produkId];if(!p||p.id!==value.produkId)p={};s=lookup.suppliers[p.supplierId];if(!s||s.id!==p.supplierId)s={};}
    else{
      var product=(records||[]).filter(function(r){return r.module==='pembelian'&&r.kind==='product'&&coreCommerceData(r).id===value.produkId;})[0];p=coreCommerceData(product);
      var supplier=(records||[]).filter(function(r){return r.module==='pembelian'&&r.kind==='supplier'&&coreCommerceData(r).id===p.supplierId;})[0];s=coreCommerceData(supplier);
    }
    value.productName=(value.productSnapshot||p).nama||'';value.supplierName=(value.supplierSnapshot||s).nama||'';
  }
  return value;
}
function coreCommerceSlipModel(module,record,context) {
  context=context||{};var nota=module==='nota',money=coreRupiah,productName=String((record.productSnapshot?record.productSnapshot.nama:record.productName)||'').trim()||'Nama produk tidak tersedia',rows=(record.items||[]).map(function(i){return nota?[i.name||'',String(i.size||'')+' '+String(i.color||''),coreRibuan(i.qty),money(i.price),String(coreNum(i.discPercent))+'%',money(i.subtotal)]:[productName,i.nama||'—',coreRibuan(i.jumlah),money(record.hargaSatuan),money(coreNum(i.jumlah)*coreNum(record.hargaSatuan))];});
  var payments=(record.payments||[]).map(function(p){return [p.tanggal||'',p.metode||'',money(p.jumlah),p.tenderedAmount===undefined?'':money(p.tenderedAmount),p.change===undefined?'':money(p.change),p.voided?'Dibatalkan: '+(p.voidReason||''):(p.catatan||'')];});
  var summary=nota?[{label:'Subtotal barang',value:money(record.subtotal)},{label:'Diskon nota ('+coreNum(record.discountPercent)+'%)',value:money(record.discountAmount)},{label:'Ongkir',value:money(record.shipping)}]:[];
  summary=summary.concat([{label:'Total',value:money(nota?record.total:record.totalHarga),emphasis:true},{label:'Dibayar untuk tagihan',value:money(record.totalPaid)},{label:'Sisa',value:money(record.balance),emphasis:true},{label:'Status',value:record.status==='review'?'Perlu diperiksa':record.status}]);
  var sections=payments.length?[{title:'Riwayat pembayaran',columns:['Tanggal','Metode','Tagihan dibayar','Uang diterima','Kembalian','Catatan'].map(function(label){return {label:label};}),rows:payments}]:[];
  if(nota&&record.customer)sections.push({title:'Pelanggan',columns:[{label:'Kontak'},{label:'Alamat'}],rows:[[record.customer.phone||'',record.customer.address||'']]});
  if(record.needsReview)sections.push({title:'Perlu diperiksa',columns:[{label:'Keterangan'}],rows:(record.reviewReasons||[]).map(function(s){return [s];})});
  var note=nota?record.notes:record.catatan;if(note)sections.push({title:'Catatan',columns:[{label:'Keterangan'}],rows:[[note]]});
  return {layout:'weekly-a4',title:nota?'Nota Penjualan':'Pesanan Pembelian Produk',reference:record.noNota||record.id,recipient:nota?(record.customer||{}).name||'':record.supplierName||'',recipientLabel:nota?'Pelanggan':'Supplier',period:nota?String(record.date||'').slice(0,10):record.tanggalOrder||'',columns:(nota?['Barang','Ukuran / Warna','Qty','Harga','Diskon','Subtotal']:['Barang','Varian','Qty','Harga','Subtotal']).map(function(label){return {label:label};}),rows:rows,summary:summary,sections:sections,signatures:[]};
}
/* ---------- nota penjualan: invoice dan struk ---------- */
/* Dokumen untuk pelanggan. Dipakai perangkat (pratinjau cetak) dan server (PDF), jadi susunannya tabel dengan CSS
   sederhana. Tidak ada yang bergantung pada warna latar: pengubah PDF dan cetak browser membuangnya, jadi penegasan
   memakai garis dan huruf tebal. Semua teks dari catatan di-escape; logo hanya diterima sebagai gambar base64 kecil. */
function coreNotaEsc(v) { return String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function coreNotaTgl(s) { var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Number(m[3]) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][Number(m[2]) - 1] + ' ' + m[1] : String(s || '-'); }
function coreNotaLogo(v) { return typeof v === 'string' && v.length <= 60000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]+$/.test(v) ? v : ''; }
function coreNotaMetode(m) { return { cash: 'Tunai', transfer: 'Transfer', qris: 'QRIS', lainnya: 'Lainnya' }[m] || String(m || ''); }
function coreNotaTanggalSah(value) {
  var s = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  var d = new Date(s + 'T00:00:00Z');
  return isFinite(d.getTime()) && d.toISOString().slice(0,10) === s ? s : '';
}
function coreNotaRingkas(record, settings) {
  record = record || {}; settings = settings || {};
  var batal = !!record.cancelled || /^(batal|cancelled)$/.test(String(record.status || ''));
  var nilaiSah = [record.total,record.totalPaid,record.balance].every(function(n){return Number.isSafeInteger(n) && n >= 0;});
  var bayaran = (record.payments || []).filter(function(p){return !p.voided;});
  var periksa = !!record.paymentReview || !!record.needsReview || record.status === 'review' || !nilaiSah || record.balance !== record.total-record.totalPaid || bayaran.some(function(p){return !!p.sourceReview || !Number.isSafeInteger(p.jumlah) || p.jumlah < 0;});
  var sisa = coreNum(record.balance), bayar = coreNum(record.totalPaid), lunas = !batal && !periksa && record.balance === 0 && record.totalPaid === record.total, tanggalLunas = '';
  if (lunas && bayar > 0 && bayaran.length && bayaran.reduce(function(n,p){return n+p.jumlah;},0) === bayar) {
    var dated = bayaran.filter(function(p){return p.jumlah > 0;});
    if (dated.length && dated.every(function(p){return !!coreNotaTanggalSah(p.tanggal);})) tanggalLunas = dated.map(function(p){return p.tanggal;}).sort().pop();
  }
  var items = (record.items || []).map(function (i) {
    var qty = coreNum(i.qty), price = coreNum(i.price), disc = coreNum(i.discPercent);
    return { name: i.name || '', color: i.color || '', size: i.size || '', qty: qty, price: price, disc: disc, subtotal: i.subtotal === undefined || i.subtotal === null ? Math.round(qty * price * (100 - disc) / 100) : coreNum(i.subtotal) };
  });
  return { batal: batal, periksa: periksa, lunas: lunas, tanggalLunas: tanggalLunas, total: coreNum(record.total), bayar: bayar, sisa: sisa, items: items, adaDiskon: items.some(function (i) { return i.disc > 0; }),
    status: batal ? 'DIBATALKAN' : periksa ? 'PERLU DIPERIKSA' : lunas ? 'LUNAS' : bayar > 0 ? 'DP / BELUM LUNAS' : 'BELUM DIBAYAR', warna: batal || periksa ? '#8a8f98' : lunas ? '#2e7d32' : '#b26a00',
    bayaran: bayaran, nomor: String(record.noNota || record.number || record.id || ''), pelanggan: record.customer || {},
    subtotal: record.subtotal === undefined || record.subtotal === null ? items.reduce(function (n, i) { return n + i.subtotal; }, 0) : coreNum(record.subtotal),
    usaha: String(settings.kopSlip || settings.namaUsaha || '').trim(), sub: [settings.kopSub, settings.alamat].map(function (x) { return String(x || '').trim(); }).filter(Boolean) };
}
function coreNotaInvoiceHtml(record, settings, opt) {
  opt = opt || {}; var e = coreNotaEsc, rp = coreRupiah, r = coreNotaRingkas(record, settings), logo = coreNotaLogo(opt.logo), c = r.pelanggan;
  var css = '@page{size:A4 portrait;margin:14mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#1b1f24}' +
    'table{border-collapse:collapse;width:100%}td,th{vertical-align:top;padding:0}td,th,div{overflow-wrap:anywhere;word-wrap:break-word}thead{display:table-header-group}' +
    '.kop td{padding-bottom:10px;border-bottom:3px solid #1b1f24}.kop .logo{width:64px}.kop .logo img{width:54px;height:54px;display:block}' +
    '.usaha{font-size:17pt;font-weight:bold;letter-spacing:1px}.kecil{font-size:8.5pt;color:#5b6470}.judul{font-size:22pt;font-weight:bold;letter-spacing:3px}' +
    '.kanan{text-align:right}.tengah{text-align:center}.info td{padding-top:14px}.label{font-size:8pt;letter-spacing:1.5px;text-transform:uppercase;color:#5b6470}' +
    '.nama{font-size:13pt;font-weight:bold}.cap{display:inline-block;padding:7px 14px;border:3px solid #1b1f24;font-size:16pt;font-weight:bold;letter-spacing:1.5px}.pelunasan{margin-top:5px;font-size:9pt}.info td{width:50%}' +
    '.barang{margin-top:16px;table-layout:fixed}.barang th{border-top:2px solid #1b1f24;border-bottom:2px solid #1b1f24;font-size:8.5pt;letter-spacing:1px;text-transform:uppercase;text-align:left;padding:7px 8px}' +
    '.barang td{padding:7px 8px;border-bottom:1px solid #d9dee4}.barang th.kanan,.barang td.kanan{text-align:right}.barang th.tengah,.barang td.tengah{text-align:center}.barang tr{page-break-inside:avoid}' +
    '.bawah{margin-top:12px;table-layout:fixed}.jumlah{page-break-inside:avoid}.jumlah td{padding:4px 8px}.jumlah .total td{border-top:2px solid #1b1f24;border-bottom:2px solid #1b1f24;font-weight:bold;font-size:12.5pt;padding:8px}' +
    '.jumlah .sisa td{font-weight:bold;font-size:12pt;border-top:1px solid #d9dee4}.kotak{border:1px solid #d9dee4;padding:8px 10px;font-size:9.5pt;margin-bottom:10px}' +
    '.riwayat{margin-top:18px}.bayar{table-layout:fixed}.bayar td,.bayar th{padding:5px 8px 5px 0;font-size:9.5pt;border-bottom:1px solid #d9dee4}.bayar th{text-align:left}.bayar th.kanan{text-align:right}.bayar tr{page-break-inside:avoid}.ttd{margin-top:34px;page-break-inside:avoid}.ttd td{width:50%;text-align:center;font-size:9.5pt}.ttd .ruang{height:58px}' +
    '.kaki{margin-top:22px;padding-top:8px;border-top:1px solid #d9dee4;font-size:8.5pt;color:#5b6470;text-align:center}' +
    '@media screen{body{background:#e6eaef;padding:12px}.invoice{background:#fff;max-width:210mm;margin:0 auto;padding:14mm;box-shadow:0 2px 14px rgba(0,0,0,.18)}}';
  var kop = '<table class="kop"><tr>' + (logo ? '<td class="logo"><img src="' + logo + '" alt=""></td>' : '') + '<td><div class="usaha">' + e(r.usaha) + '</div>' + r.sub.map(function (x) { return '<div class="kecil">' + e(x) + '</div>'; }).join('') +
    '</td><td class="kanan"><div class="judul">INVOICE</div><div class="kecil">No. <b>' + e(r.nomor) + '</b></div><div class="kecil">Tanggal ' + e(coreNotaTgl(record.date)) + '</div></td></tr></table>';
  var info = '<table class="info"><tr><td><div class="label">Kepada</div><div class="nama">' + e(c.name || '-') + '</div>' + [c.phone, c.address].filter(Boolean).map(function (x) { return '<div class="kecil">' + e(x) + '</div>'; }).join('') +
    '</td><td class="kanan"><div class="label">Status pembayaran</div><span class="cap" style="color:' + r.warna + ';border-color:' + r.warna + '">' + r.status + '</span>' + (r.lunas ? '<div class="pelunasan">' + (r.tanggalLunas ? 'Pelunasan ' + e(coreNotaTgl(r.tanggalLunas)) : r.total === 0 ? 'Total tagihan Rp 0' : 'Tanggal pelunasan belum tercatat') + '</div>' : '') + '</td></tr></table>';
  var barang = '<table class="barang"><thead><tr><th class="tengah" style="width:7%">No</th><th>Barang</th><th class="tengah" style="width:12%">Ukuran</th><th class="tengah" style="width:9%">Qty</th><th class="kanan" style="width:17%">Harga</th>' +
    (r.adaDiskon ? '<th class="tengah" style="width:9%">Disk.</th>' : '') + '<th class="kanan" style="width:19%">Jumlah</th></tr></thead><tbody>' +
    r.items.map(function (i, n) {
      return '<tr><td class="tengah">' + (n + 1) + '</td><td><b>' + e(i.name) + '</b>' + (i.color ? '<div class="kecil">' + e(i.color) + '</div>' : '') + '</td><td class="tengah">' + e(i.size || '-') + '</td><td class="tengah">' + coreRibuan(i.qty) + '</td><td class="kanan">' + rp(i.price) + '</td>' +
        (r.adaDiskon ? '<td class="tengah">' + (i.disc ? i.disc + '%' : '-') + '</td>' : '') + '<td class="kanan">' + rp(i.subtotal) + '</td></tr>';
    }).join('') + '</tbody></table>';
  var jumlah = '<table class="jumlah"><tr><td>Subtotal</td><td class="kanan">' + rp(r.subtotal) + '</td></tr>' +
    (coreNum(record.discountAmount) ? '<tr><td>Diskon' + (coreNum(record.discountPercent) ? ' (' + coreNum(record.discountPercent) + '%)' : '') + '</td><td class="kanan">-' + rp(record.discountAmount) + '</td></tr>' : '') +
    (coreNum(record.shipping) ? '<tr><td>Ongkir</td><td class="kanan">' + rp(record.shipping) + '</td></tr>' : '') +
    '<tr class="total"><td>TOTAL</td><td class="kanan">' + rp(r.total) + '</td></tr>' +
    '<tr><td>Sudah dibayar</td><td class="kanan">' + (r.periksa ? 'Perlu diperiksa' : rp(r.bayar)) + '</td></tr>' +
    '<tr class="sisa"><td>SISA TAGIHAN</td><td class="kanan">' + (r.periksa ? 'Perlu diperiksa' : rp(r.sisa)) + '</td></tr></table>';
  var kiri = record.notes ? '<div class="label">Catatan</div><div class="kotak">' + e(record.notes).replace(/\n/g, '<br>') + '</div>' : '';
  var riwayat = r.bayaran.length ? '<div class="riwayat"><div class="label">Riwayat pembayaran</div><table class="bayar"><thead><tr><th style="width:25%">Tanggal</th><th style="width:47%">Metode / catatan</th><th class="kanan" style="width:28%">Pembayaran</th></tr></thead><tbody>' + r.bayaran.map(function(p) {
    return '<tr><td>' + e(coreNotaTanggalSah(p.tanggal) ? coreNotaTgl(p.tanggal) : 'Tanggal belum tercatat') + '</td><td>' + e(coreNotaMetode(p.metode)) + (p.catatan ? '<div class="kecil">' + e(p.catatan).replace(/\n/g,'<br>') + '</div>' : '') + '</td><td class="kanan">' + rp(p.jumlah) + '</td></tr>';
  }).join('') + '</tbody></table></div>' : '';
  return '<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice ' + e(r.nomor) + '</title><style>' + css + '</style></head><body><div class="invoice">' + kop + info + barang +
    '<table class="bawah"><tr><td style="width:52%;padding-right:18px">' + kiri + '</td><td style="width:48%">' + jumlah + '</td></tr></table>' + riwayat +
    '<table class="ttd"><tr><td>Hormat kami,<div class="ruang"></div><b>' + e(r.usaha) + '</b></td><td>Penerima,<div class="ruang"></div><b>' + e(c.name || '') + '</b></td></tr></table>' +
    '<div class="kaki">' + (r.batal ? 'Nota ini sudah dibatalkan dan tidak berlaku sebagai tagihan.' : 'Terima kasih atas kepercayaan Anda.') + '</div></div></body></html>';
}
/* Struk untuk printer thermal: kertas 58 mm (isi 48 mm) atau 80 mm (isi 72 mm), huruf rata lebar, tanpa warna. */
function coreNotaStrukHtml(record, settings, opt) {
  opt = opt || {}; var e = coreNotaEsc, uang = coreRibuan, r = coreNotaRingkas(record, settings), lebar = Number(opt.lebar) === 80 ? 80 : 58, isi = lebar === 80 ? 72 : 48, logo = coreNotaLogo(opt.logo), c = r.pelanggan;
  var css = '@page{margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:"Courier New",Consolas,monospace;font-size:' + (lebar === 80 ? '10.5pt' : '9pt') + ';line-height:1.25;color:#000}' +
    '.struk{width:' + isi + 'mm;margin:0 auto;padding:2mm 0 4mm;overflow-wrap:anywhere;word-wrap:break-word}table{width:100%;border-collapse:collapse}td{vertical-align:top;padding:0}.k{text-align:right;white-space:nowrap;padding-left:2mm}.kw{text-align:right;padding-left:2mm;word-break:break-word}' +
    '.t{text-align:center}.b{font-weight:bold}.usaha{font-weight:bold;font-size:1.25em}.besar td{font-weight:bold;font-size:1.15em}.status{border:2px solid #000;padding:2mm 1mm;font-size:1.3em;margin:2mm 0;page-break-inside:avoid}.bayaran{margin-top:2mm}.garis{border-top:1px dashed #000;height:0;margin:1.2mm 0}.logo{display:block;width:14mm;height:14mm;margin:0 auto 1mm}' +
    '@media screen{body{background:#e6eaef;padding:12px 0}.struk{background:#fff;width:' + (isi + 8) + 'mm;padding:4mm;box-shadow:0 2px 14px rgba(0,0,0,.18)}}';
  function baris(kiri, kanan, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + kiri + '</td><td class="k">' + kanan + '</td></tr>'; }
  var tunai = r.bayaran.filter(function (p) { return p.tenderedAmount !== undefined && p.tenderedAmount !== null; }).slice(-1)[0];
  var garis = '<div class="garis"></div>';
  return '<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Struk ' + e(r.nomor) + '</title><style>' + css + '</style></head><body><div class="struk">' +
    (logo ? '<img class="logo" src="' + logo + '" alt="">' : '') + '<div class="t usaha">' + e(r.usaha) + '</div>' + r.sub.map(function (x) { return '<div class="t">' + e(x) + '</div>'; }).join('') + garis +
    '<table><tr><td>No</td><td class="kw">' + e(r.nomor) + '</td></tr><tr><td>Tanggal</td><td class="kw">' + e(coreNotaTgl(record.date)) + '</td></tr><tr><td>Pelanggan</td><td class="kw">' + e(c.name || '-') + '</td></tr></table>' + garis +
    r.items.map(function (i) { return '<div class="b">' + e([i.name, i.color, i.size].filter(Boolean).join(' ')) + '</div><table>' + baris(uang(i.qty) + ' x ' + uang(i.price) + (i.disc ? ' -' + i.disc + '%' : ''), uang(i.subtotal)) + '</table>'; }).join('') + garis +
    '<table>' + (coreNum(record.discountAmount) || coreNum(record.shipping) ? baris('Subtotal', uang(r.subtotal)) : '') +
    (coreNum(record.discountAmount) ? baris('Diskon' + (coreNum(record.discountPercent) ? ' ' + coreNum(record.discountPercent) + '%' : ''), '-' + uang(record.discountAmount)) : '') +
    (coreNum(record.shipping) ? baris('Ongkir', uang(record.shipping)) : '') + baris('TOTAL', uang(r.total), 'besar') +
    (r.periksa ? '' : (tunai ? baris('Tunai', uang(tunai.tenderedAmount)) + baris('Kembali', uang(tunai.change)) : '') + baris('Dibayar', uang(r.bayar)) + (r.sisa > 0 ? baris('SISA', uang(r.sisa), 'besar') : '')) + '</table>' + garis +
    (r.bayaran.length ? '<div class="b">RIWAYAT PEMBAYARAN</div>' + r.bayaran.map(function(p) { return '<div class="bayaran">' + e(coreNotaTanggalSah(p.tanggal) ? coreNotaTgl(p.tanggal) : 'Tanggal belum tercatat') + '<table>' + baris(e(coreNotaMetode(p.metode)),uang(p.jumlah)) + '</table>' + (p.catatan ? '<div>' + e(p.catatan).replace(/\n/g,'<br>') + '</div>' : '') + '</div>'; }).join('') + garis : '') +
    (record.notes ? '<div>Catatan: ' + e(record.notes).replace(/\n/g,'<br>') + '</div>' + garis : '') +
    '<div class="t b status">** ' + r.status + ' **</div>' + (r.lunas ? '<div class="t">' + (r.tanggalLunas ? 'Pelunasan ' + e(coreNotaTgl(r.tanggalLunas)) : r.total === 0 ? 'Total tagihan 0' : 'Tanggal pelunasan belum tercatat') + '</div>' : '') + '<div class="t">' + (r.batal ? 'Nota ini tidak berlaku' : 'Terima kasih') + '</div></div></body></html>';
}
/* One amount paid to a supplier for several orders, as the earlier application
   did it: divided by each order's remaining balance. Whole rupiah only, the
   parts always add up to the amount, and no part exceeds its order's balance. */
function coreCommerceSplit(amount, balances) {
  var total=balances.reduce(function(n,b){return n+b;},0),n=balances.length;
  if(!Number.isSafeInteger(amount)||amount<=0||!n||amount>total||balances.some(function(b){return !Number.isSafeInteger(b)||b<0;}))return null;
  var exact=balances.map(function(b){return amount*b/total;}),shares=exact.map(function(x,i){return Math.min(balances[i],Math.max(0,Math.floor(x)));}),left=amount-shares.reduce(function(a,s){return a+s;},0);
  var order=exact.map(function(x,i){return {i:i,frac:x-Math.floor(x)};}).sort(function(a,b){return b.frac-a.frac||a.i-b.i;});
  for(var guard=0;left!==0&&guard<n*4;guard++){var k=order[left>0?guard%n:n-1-guard%n].i;if(left>0&&shares[k]<balances[k]){shares[k]++;left--;}else if(left<0&&shares[k]>0){shares[k]--;left++;}}
  if(left!==0||shares.some(function(s,i){return s<0||s>balances[i];}))return null;
  return shares;
}
function coreInstallCommerceActions(actions,ctx) {  var store=ctx.store, tables=['CommerceRecord','CommerceEvent','CommerceSource','CommerceImport'];
  function fail(s){ctx.fail(s);}
  /* Writes and imports recheck the physical account row. Lists, photos and PDF
     (reading=true) use the same account check as the rest of the application,
     so opening a page does not open the spreadsheet only to read accounts. */
  function admin(p,owner,reading){if(!reading&&store.fresh)store.fresh('Pegawai');var me=ctx.auth(p);if(!coreIsAdmin(me)||owner&&me.divisi!=='owner')fail(owner?'Hanya owner yang boleh melakukan tindakan ini.':'Modul ini hanya untuk owner atau admin.');return me;}
  function fresh(names){names=names||['CommerceRecord','CommerceEvent','CommerceImport'];if(store.checkpoint)store.checkpoint(names);else if(store.fresh)names.forEach(function(s){store.fresh(s);});}
  function pending(){return store.read('CommerceImport').filter(function(r){return r.status!=='complete';});}
  function writable(p,owner){var me=admin(p,owner);fresh();if(pending().length)fail('Impor modul belum selesai. Owner perlu melanjutkan impor dengan file dan bukti yang sama.');return me;}
  function id(v){if(typeof v!=='string'||!v||v.length>128||!/^[A-Za-z0-9_-]+$/.test(v)||/^(?:__proto__|constructor|prototype)$/.test(v))fail('Identitas catatan tidak sah.');return v;}
  function text(v,max,required){if(v===undefined||v===null)v='';if(typeof v!=='string'||v.length>max||required&&!v.trim())fail('Isi teks wajib dengan panjang yang sesuai.');return v.trim();}
  function num(v,max,positive,integer){if(v===null||v===undefined||v===''||typeof v==='boolean')fail('Isi angka yang sah.');var n=Number(v);if(!isFinite(n)||n<0||positive&&n===0||n>max||integer&&n!==Math.floor(n))fail('Jumlah atau harga tidak sah.');return n;}
  function date(v){v=String(v||'').slice(0,10);var d=new Date(v+'T00:00:00Z');if(!coreTglOk(v)||isNaN(d.getTime())||d.toISOString().slice(0,10)!==v)fail('Tanggal tidak sah.');return v;}
  function now(){return ctx.env.now().toISOString();}
  function all(){return store.read('CommerceRecord');}
  function find(module,kind,key){return all().filter(function(r){return r.module===module&&r.kind===kind&&coreCommerceData(r).id===key;})[0];}
  function view(row){if(!row)fail('Catatan tidak ditemukan.');return coreCommerceRecordView(row,store.read('CommerceEvent'),all());}
  function stateOf(module,me){
    var rows=all(),events=store.read('CommerceEvent'),lookup=coreCommerceLookup(rows,events),out={module:module,version:store.version(),actor:{id:me.id,divisi:me.divisi}};
    function list(kind){return rows.filter(function(r){return r.module===module&&r.kind===kind;}).map(function(r){return coreCommerceRecordView(r,events,rows,lookup);});}
    if(module==='pembelian'){out.suppliers=list('supplier');out.products=list('product').map(coreCommerceLean);out.orders=list('order');}
    if(module==='nota')out.notes=list('nota');
    return out;
  }
  /* A saved form asks for the refreshed page in the same answer (withState),
     so the device does not need a second request after every save. */
  function reply(module,row,p,me){var out={record:coreCommerceLean(view(row))};if(p.withState===true&&(module==='pembelian'||module==='nota'))out.commerce=stateOf(module,me);return out;}
  function historyEditable(value){if(value&&value.historyHidden)fail('Catatan ada di Sampah riwayat. Pulihkan terlebih dahulu sebelum mengubah atau mencetaknya.');return value;}
  function expected(row,p){var value=historyEditable(view(row));if(!p.expectedRevision||p.expectedRevision!==value.revision)fail('Catatan berubah sejak formulir dibuka. Muat ulang dan periksa lagi.');}
  function checkRows(table,rows){if(store.validateRows)store.validateRows(table,rows);else rows.forEach(function(r){Object.keys(r).forEach(function(k){if(String(r[k]).length>49000)fail('Catatan terlalu panjang untuk disimpan.');});});}
  actions.setCommerceHistoryVisibility=function(p){
    var me=writable(p,true),module=p.module;if(['pembelian','nota'].indexOf(module)<0)fail('Modul tidak dikenal.');
    if(typeof p.hidden!=='boolean')fail('Pilih hapus atau pulihkan riwayat.');
    if(!(p.ids instanceof Array)||!p.ids.length||p.ids.length>100)fail('Pilih 1 sampai 100 catatan riwayat.');
    var requestId=id(p.requestId),reason=text(p.reason,500),seen=Object.create(null),ids=p.ids.map(function(k){k=id(k);if(seen[k])fail('Catatan riwayat dipilih lebih dari sekali.');seen[k]=true;return k;}).sort();
    var proof=coreCommerceHistoryVisibilityProof(p,me.id),eventId='hv_'+coreCommerceHash(requestId).slice(0,40),events=store.read('CommerceEvent'),prior=events.filter(function(e){return e.id===eventId;})[0];
    var rows=ids.map(function(k){var row=find(module,module==='nota'?'nota':'order',k);if(!row)fail('Catatan riwayat tidak ditemukan. Muat ulang daftar.');return row;});
    function answer(){var out={requestId:requestId,ids:ids.slice(),hidden:p.hidden,proof:proof,records:rows.map(function(r){return coreCommerceLean(view(r));})};if(p.withState===true)out.commerce=stateOf(module,me);return out;}
    if(prior){var previous=coreCommerceData(prior);if(prior.module!==module||prior.kind!=='historyVisibility'||prior.dibuatOleh!==me.id||previous.requestId!==requestId||previous.proof!==proof)fail('Identitas tindakan riwayat sudah digunakan untuk isi atau akun berbeda.');return answer();}
    var views=rows.map(view);views.forEach(function(v){
      if(!p.expectedRevisions||!Object.prototype.hasOwnProperty.call(p.expectedRevisions,v.id)||p.expectedRevisions[v.id]!==v.revision)fail('Catatan berubah sejak dipilih. Muat ulang dan periksa riwayat lagi.');
      if(p.hidden){if(v.historyHidden)fail('Catatan sudah ada di Sampah riwayat. Muat ulang daftar.');if(!coreCommerceHistoryEligible(module,v))fail('Hanya catatan yang sudah masuk riwayat dapat dihapus. Selesaikan pembayaran dan penerimaan yang masih aktif terlebih dahulu.');}
      else if(!v.historyHidden)fail('Catatan sudah dipulihkan atau tidak ada di Sampah riwayat. Muat ulang daftar.');
    });
    if(module==='pembelian'){
      var invoiceKey=coreCommerceInvoiceKey(views[0]);
      if(views.some(function(v){return coreCommerceInvoiceKey(v)!==invoiceKey;}))fail('Pilih catatan dari satu invoice untuk menghapus atau memulihkan riwayat.');
      if(p.hidden&&views.some(function(v){return !v.cancelled;})){
        var records=all(),lookup=coreCommerceLookup(records,events);
        records.forEach(function(r){if(r.module!=='pembelian'||r.kind!=='order')return;var v=coreCommerceRecordView(r,events,records,lookup);
          if(!v.cancelled&&coreCommerceInvoiceKey(v)===invoiceKey){
            if(!seen[v.id])fail('Pilih seluruh model yang masih berlaku pada invoice agar riwayat tidak terpisah.');
            if(!coreCommerceHistoryEligible(module,v))fail('Seluruh model dalam invoice harus selesai dibayar dan diterima sebelum dihapus dari riwayat.');
          }
        });
      }
    }
    var stamp=now(),data={version:1,requestId:requestId,ids:ids,hidden:p.hidden,reason:reason,proof:proof,before:views.map(function(v){return {id:v.id,revision:v.revision,hidden:!!v.historyHidden,status:v.status,archived:!!v.archived};})};
    var event={id:eventId,module:module,parentId:'',kind:'historyVisibility',data:JSON.stringify(data),dibuat:stamp,dibuatOleh:me.id,sourceHash:''};
    checkRows('CommerceEvent',[event]);store.append('CommerceEvent',event);return answer();
  };
  function sourcePicture(v){if(!v)return '';if(typeof v!=='string'||v.length>48000||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v))fail('Gambar harus JPEG/PNG/WebP berukuran kecil.');return v;}
  function normalize(kind,r,previous){
    var out={id:id(r.id)},old=previous&&coreCommerceData(previous);
    if(kind==='supplier'){out.nama=text(r.nama,100,true);out.kontak=text(r.kontak,80);out.alamat=text(r.alamat,400);out.catatan=text(r.catatan,500);out.aktif=r.aktif!==false;}
    if(kind==='product'){out.nama=text(r.nama,100,true);out.kategori=text(r.kategori,80);out.model=text(r.model,80);out.warna=text(r.warna,80);out.supplierId=id(r.supplierId);if(!find('pembelian','supplier',out.supplierId))fail('Supplier tidak ditemukan.');out.harga=r.harga==null||r.harga===''?0:num(r.harga,1e12,false,true);out.catatan=text(r.catatan,500);out.aktif=r.aktif!==false;out.gambar=r.gambar===undefined&&old?old.gambar||'':sourcePicture(r.gambar);}
    if(kind==='order'||kind==='nota'){
      if(!(r.items instanceof Array)||!r.items.length||r.items.length>100)fail('Isi 1 sampai 100 baris barang.');var seen={};
      out.items=r.items.map(function(i){var x={id:id(i.id)};if(seen[x.id])fail('Identitas baris barang ganda.');seen[x.id]=true;
        if(kind==='order'){x.nama=text(i.nama,120,true);x.jumlah=num(i.jumlah,1e8,true,true);}else{x.name=text(i.name,120,true);x.size=text(i.size,40);x.color=text(i.color,60);x.qty=num(i.qty,1e8,true,true);x.price=num(i.price,1e12,false,true);x.discPercent=num(i.discPercent===undefined?0:i.discPercent,100,false,false);x.subtotal=Math.round(x.qty*x.price*(100-x.discPercent)/100);if(!Number.isSafeInteger(x.subtotal))fail('Subtotal terlalu besar.');}return x;});
      if(kind==='order'){var names=Object.create(null),duplicate=false;out.items.forEach(function(i){var name=i.nama.replace(/\s+/g,' ').toLowerCase();if(names[name])duplicate=true;names[name]=true;});
        /* An unchanged historical list may still receive metadata/price edits. Never
           add, reorder, rename or increase duplicate rows, nor guess receipt links. */
        var unchanged=old&&old.items instanceof Array&&old.items.length===out.items.length&&out.items.every(function(i,n){var prior=old.items[n];return prior&&i.id===prior.id&&i.nama===String(prior.nama==null?'':prior.nama).trim()&&i.jumlah===Number(prior.jumlah);});
        if(duplicate&&!unchanged)fail('Nama varian ganda dalam satu model. Gabungkan jumlah pada varian yang sama atau gunakan nama yang berbeda.');
      }
      if(kind==='order'){out.produkId=id(r.produkId);var product=find('pembelian','product',out.produkId),pd=coreCommerceData(product),supplier=find('pembelian','supplier',pd.supplierId),sd=coreCommerceData(supplier),sameProduct=old&&old.produkId===out.produkId;if(!sameProduct&&(!product||!supplier||pd.aktif===false||pd.deleted||sd.aktif===false))fail('Produk atau supplier pembelian tidak ditemukan atau tidak aktif.');out.productSnapshot=sameProduct&&old.productSnapshot?old.productSnapshot:{id:pd.id,nama:pd.nama,model:pd.model||'',warna:pd.warna||'',supplierId:pd.supplierId};out.supplierSnapshot=sameProduct&&old.supplierSnapshot?old.supplierSnapshot:{id:sd.id,nama:sd.nama,kontak:sd.kontak||'',alamat:sd.alamat||''};out.grupNama=text(r.grupNama,100);out.hargaSatuan=num(r.hargaSatuan,1e12,false,true);out.tanggalOrder=date(r.tanggalOrder);out.totalHarga=out.items.reduce(function(n,i){return n+i.jumlah*out.hargaSatuan;},0);out.catatan=text(r.catatan,1000);if(!Number.isSafeInteger(out.totalHarga))fail('Total terlalu besar.');}
      else{var c=r.customer||{};out.customer={name:text(c.name,120,true),phone:text(c.phone,60),address:text(c.address,400),type:c.type==='reseller'?'reseller':'walkin'};out.date=date(r.date);out.discountPercent=num(r.discountPercent===undefined?0:r.discountPercent,100,false,false);out.shipping=num(r.shipping===undefined?0:r.shipping,1e12,false,true);out.subtotal=out.items.reduce(function(n,i){return n+i.subtotal;},0);out.discountAmount=Math.round(out.subtotal*out.discountPercent/100);out.total=out.subtotal-out.discountAmount+out.shipping;out.notes=text(r.notes,1000);if(!Number.isSafeInteger(out.total))fail('Total terlalu besar.');}
      out.cancelled=old?!!old.cancelled:false;if(out.cancelled)fail('Catatan yang dibatalkan tidak dapat diubah.');
      if(previous){var current=view(previous);
        /* Nota buatan aplikasi ini boleh diperbaiki walau sudah ada pembayaran: pembayarannya tidak disentuh, jadi total
           baru tidak boleh di bawah yang sudah dibayar. Nota dari data lama tetap disimpan apa adanya. */
        if(kind==='nota'){
          if(previous.sourceHash)fail('Nota dari data lama disimpan tetap. Koreksi melalui pembatalan event atau buat catatan baru.');
          if(current.events.length){
            if(current.paymentReview)fail('Nominal pembayaran nota perlu diperiksa sebelum rinciannya dapat diedit.');
            if(out.total<current.totalPaid)fail('Total nota tidak boleh lebih kecil dari yang sudah dibayar. Koreksi pembayarannya terlebih dahulu.');
            if(current.payments.some(function(e){return !e.voided&&String(e.tanggal||'').slice(0,10)<out.date;}))fail('Tanggal nota tidak boleh sesudah tanggal pembayaran yang sudah tercatat.');
          }
        }
        /* Editing keeps the same order and immutable payment/receipt events. An unresolved receipt never
           becomes a guessed variant link: its existing lines may only be retained or increased. */
        else if(current.paymentReview)fail('Nominal pembayaran lama perlu diperiksa sebelum rincian order dapat diedit.');
        else if(current.events.length||previous.sourceHash||current.receiptReview){
          if(out.produkId!==old.produkId)fail('Produk tidak dapat diganti setelah ada pembayaran atau penerimaan.');
          if(old.productSnapshot)out.productSnapshot=old.productSnapshot;if(old.supplierSnapshot)out.supplierSnapshot=old.supplierSnapshot;
          if(current.receiptReview){
            if(out.items.length!==(old.items||[]).length)fail('Penerimaan lama belum terhubung. Pertahankan varian yang ada; jangan menambah atau menghapus varian.');
            (old.items||[]).forEach(function(i,n){var kept=out.items[n];if(!kept||kept.nama!==i.nama||(i.id&&kept.id!==i.id)||kept.jumlah<coreNum(i.jumlah))fail('Penerimaan lama belum terhubung. Nama, urutan, dan jumlah minimum varian lama harus dipertahankan.');});
          }
          var got=current.receivedByItem||{};Object.keys(got).forEach(function(k){if(!coreNum(got[k]))return;var kept=out.items.filter(function(i){return i.id===k;})[0],known=(old.items||[]).some(function(i){return i.id===k;});if(current.receiptReview&&!known){if(kept)fail('Hubungan penerimaan lama tidak boleh ditebak dengan mengganti identitas varian.');return;}if(!kept||kept.jumlah<coreNum(got[k]))fail('Varian yang sudah diterima tidak boleh dihapus atau dikurangi di bawah jumlah yang diterima.');});
          if(out.totalHarga<current.totalPaid)fail('Total pesanan tidak boleh lebih kecil dari yang sudah dibayar.');
        }
      }
    }
    return out;
  }
  function tender(payment,d){if(payment.tenderedAmount===undefined)return d;var amount=num(payment.tenderedAmount,1e15,false,true);if(d.metode!=='cash'||amount<d.jumlah)fail('Uang diterima tunai harus setidaknya sama dengan pembayaran tagihan.');d.tenderedAmount=amount;d.change=amount-d.jumlah;return d;}
  function initial(r,kind,record,me){if(kind!=='nota'&&kind!=='order')return null;var payment=r.initialPayment||r.payment;if(!payment)return null;var amount=payment.jumlah===undefined?payment.amount:payment.jumlah;if(amount===undefined||Number(amount)===0)return null;amount=num(amount,1e15,true,true);var total=kind==='nota'?record.total:record.totalHarga;if(amount>total)fail('Pembayaran tidak boleh melebihi total tagihan.');var parentDate=kind==='nota'?record.date:record.tanggalOrder,payDate=date(payment.tanggal||parentDate);if(payDate<parentDate)fail('Tanggal pembayaran awal tidak boleh sebelum pesanan/nota.');return tender(payment,{id:'initial_'+coreCommerceHash([kind,record.id]).slice(0,32),kind:'payment',tanggal:payDate,jumlah:amount,metode:text(payment.metode||payment.method||'cash',40,true),catatan:text(payment.catatan,300),createdBy:me.id,createdAt:now()});}
  function save(module,kind,p){
    var me=writable(p),r=p.record||{},key=id(r.id),old=find(module,kind,key),actor=me.id;
    var rawIntent=coreCommerceCopy(r);delete rawIntent.revision;var intent=coreCommerceHash({kind:kind,input:rawIntent,before:p.expectedRevision||''});
    if(old){historyEditable(view(old));var data=coreCommerceData(old);if(kind==='product'&&data.deleted)fail('Produk sudah dihapus dari daftar. Buat produk baru jika masih diperlukan.');if(!p.expectedRevision&&data._createHash===intent&&data._createActor===actor)return reply(module,old,p,me);if(data._lastMutation&&data._lastMutation.hash===intent&&data._lastMutation.actor===actor)return reply(module,old,p,me);expected(old,p);}
    else if(p.expectedRevision)fail('Catatan asal tidak ditemukan.');
    if(old&&kind==='order'&&(old.sourceHash||view(old).needsReview)&&me.divisi!=='owner')fail('Hanya owner yang dapat mengedit rincian order dari data lama atau yang perlu diperiksa.');
    var data=normalize(kind,r,old);if(kind==='nota'){if(old)data.noNota=coreCommerceData(old).noNota||key;else{var prefix='SA-'+data.date.replace(/-/g,'').slice(2)+'-',sequence=0;store.read('CommerceImport').forEach(function(row){sequence=Math.max(sequence,coreNum((coreCommerceData(row).summary||{}).notaCounter));});all().filter(function(row){return row.kind==='nota';}).forEach(function(row){var note=coreCommerceData(row),n=String(note.noNota||note.id||''),match=/^SA-\d{6}-(\d+)$/.exec(n);if(match)sequence=Math.max(sequence,Number(match[1]));});if(sequence>=999999)fail('Nomor nota tanggal ini penuh.');data.noNota=prefix+('000'+(sequence+1)).slice(-Math.max(3,String(sequence+1).length));}}
    if(old&&kind==='order'){
      var previousData=coreCommerceData(old),fields=['produkId','productSnapshot','supplierSnapshot','items','hargaSatuan','totalHarga','tanggalOrder','grupNama','catatan'],before={},after={};
      fields.forEach(function(k){if(previousData[k]!==undefined)before[k]=previousData[k];if(data[k]!==undefined)after[k]=data[k];});
      data._orderChanges=(previousData._orderChanges||[]).slice();
      if(coreCommerceHash(before)!==coreCommerceHash(after))data._orderChanges.push({at:now(),by:actor,before:before,afterHash:coreCommerceHash(after)});
      if(previousData._salinDari)data._salinDari=previousData._salinDari;
      if(previousData.invoiceId){
        if(!data.supplierSnapshot||data.supplierSnapshot.id!==(previousData.supplierSnapshot||{}).id)fail('Supplier invoice tetap. Buat invoice lain untuk supplier berbeda.');
        ['invoiceId','invoiceOrderIds','invoiceProof'].forEach(function(k){data[k]=previousData[k];});
      }
      if(view(old).invoiceGroupId){
        if((data.supplierSnapshot||{}).id!==(previousData.supplierSnapshot||{}).id)fail('Supplier invoice gabungan tetap. Buat invoice lain untuk supplier berbeda.');
        ['invoiceGroupId','invoiceGroupName'].forEach(function(k){if(previousData[k]!==undefined)data[k]=previousData[k];});
      }
    }
    if(old&&kind==='nota'){
      /* jejak perubahan nota: isi sebelum diubah ikut disimpan (12 perubahan terakhir); tanda arsip tidak hilang saat diedit */
      var notaLama=coreCommerceData(old),kolomNota=['customer','date','items','discountPercent','shipping','subtotal','discountAmount','total','notes'],dulu={},kini={};
      kolomNota.forEach(function(k){if(notaLama[k]!==undefined)dulu[k]=notaLama[k];if(data[k]!==undefined)kini[k]=data[k];});
      data._notaChanges=(notaLama._notaChanges||[]).slice();
      if(coreCommerceHash(dulu)!==coreCommerceHash(kini))data._notaChanges.push({at:now(),by:actor,before:dulu,afterHash:coreCommerceHash(kini)});
      while(data._notaChanges.length>12||(data._notaChanges.length>1&&JSON.stringify(data._notaChanges).length>30000))data._notaChanges.shift();
      if(!data._notaChanges.length)delete data._notaChanges;
      ['archived','archivedBy','archivedAt','restoredFrom','restoredBy','restoredAt'].forEach(function(k){if(notaLama[k]!==undefined)data[k]=notaLama[k];});
    }
    if(old){var prev=coreCommerceData(old);data._createHash=prev._createHash;data._createActor=prev._createActor;if(prev._initialPayment)data._initialPayment=prev._initialPayment;}else{data._createHash=intent;data._createActor=actor;var pay=initial(r,kind,data,me);if(pay)data._initialPayment=pay;}
    data._lastMutation={hash:intent,actor:actor};var stamp=now(),row={id:coreCommerceKey(module,kind,key),module:module,kind:kind,parentId:'',data:JSON.stringify(data),revision:coreCommerceHash([data,stamp,actor]),dibuat:old?old.dibuat:stamp,dibuatOleh:old?old.dibuatOleh:actor,diubah:stamp,sourceHash:old?old.sourceHash:''};
    checkRows('CommerceRecord',[row]);if(old)store.update('CommerceRecord',old.id,row);else store.append('CommerceRecord',row);return reply(module,row,p,me);
  }
  actions.saveCommerceSupplier=function(p){return save('pembelian','supplier',p);};
  actions.saveCommerceProduct=function(p){return save('pembelian','product',p);};
  /* Keep the product identity and picture for existing orders. A removed catalog
     entry cannot be restored accidentally by a stale form on another device. */
  actions.deleteCommerceProduct=function(p){
    var me=writable(p,true),row=find('pembelian','product',id(p.id)),current=view(row),data=coreCommerceCopy(coreCommerceData(row));
    if(data.deleted){
      if(data.deletedBy===me.id&&data.deletedFromRevision===p.expectedRevision)return reply('pembelian',row,p,me);
      fail('Produk sudah dihapus dari daftar. Muat ulang data.');
    }
    expected(row,p);var stamp=now();
    data.deleted=true;data.aktif=false;data.deletedAt=stamp;data.deletedBy=me.id;data.deletedFromRevision=current.revision;
    var updated=Object.assign({},row,{data:JSON.stringify(data),revision:coreCommerceHash([data,stamp,me.id]),diubah:stamp});
    checkRows('CommerceRecord',[updated]);store.update('CommerceRecord',row.id,updated);return reply('pembelian',updated,p,me);
  };
  actions.saveCommerceOrder=function(p){return save('pembelian','order',p);};
  actions.mergeCommerceInvoices=function(p){
    var me=writable(p,true),key=id(p.id),name=text(p.grupNama,100),selected=p.orderIds,revisions=p.expectedRevisions||{};
    if(!(selected instanceof Array)||selected.length<2||selected.length>100)fail('Pilih seluruh model dari 2 atau lebih invoice, maksimal 100 model.');
    var seen=Object.create(null),ids=selected.map(function(k){k=id(k);if(seen[k])fail('Model dipilih lebih dari sekali.');seen[k]=true;return k;}).sort();
    var proof=coreCommerceInvoiceMergeProof(p,me.id),events=store.read('CommerceEvent'),eventId='merge_'+coreCommerceHash(key).slice(0,40);
    function answer(){var out={groupId:key,orderIds:ids.slice(),proof:proof};if(p.withState===true)out.commerce=stateOf('pembelian',me);return out;}
    var prior=events.filter(function(e){return e.id===eventId;})[0];
    if(prior){var priorData=coreCommerceData(prior);if(prior.module!=='pembelian'||prior.kind!=='invoiceMerge'||priorData.groupId!==key||priorData.proof!==proof||prior.dibuatOleh!==me.id)fail('Identitas penggabungan sudah dipakai untuk isi atau akun berbeda.');return answer();}
    var records=all(),lookup=coreCommerceLookup(records,events),orders=records.filter(function(r){return r.module==='pembelian'&&r.kind==='order';}),byId=Object.create(null),groups=Object.create(null),supplier='';
    orders.forEach(function(r){var v=coreCommerceRecordView(r,events,records,lookup);byId[v.id]={row:r,value:v};});
    ids.forEach(function(k){var entry=byId[k],v=entry&&entry.value;if(!entry)fail('Order tidak ditemukan. Muat ulang daftar.');historyEditable(v);if(v.cancelled)fail('Order nonaktif atau arsip tidak dapat digabung.');
      var sid=String((v.supplierSnapshot||{}).id||'');if(!sid||supplier&&sid!==supplier)fail('Hanya invoice dari supplier yang sama dapat digabung.');supplier=sid;
      if(!revisions[k]||revisions[k]!==v.revision)fail('Invoice berubah sejak dipilih. Muat ulang lalu pilih kembali.');groups[coreCommerceInvoiceKey(v)]=true;
    });
    if(Object.keys(groups).length<2)fail('Model yang dipilih sudah berada dalam satu invoice.');
    orders.forEach(function(r){var v=byId[coreCommerceData(r).id].value;if(!v.cancelled&&groups[coreCommerceInvoiceKey(v)]&&!seen[v.id])fail('Pilih seluruh model pada setiap invoice agar tidak terpisah. Muat ulang daftar.');});
    if(records.some(function(r){var d=coreCommerceData(r),pay=d._initialPayment;return r.id===key||d.id===key||d.invoiceId===key||d.invoiceGroupId===key||pay&&(pay.id===key||pay.groupId===key);})||events.some(function(e){var d=coreCommerceData(e);return e.id===key||d.groupId===key||d.correctionId===key;}))fail('Identitas gabungan sudah digunakan. Buka kembali formulir.');
    var stamp=now(),data={version:1,groupId:key,grupNama:name,orderIds:ids,proof:proof,createdBy:me.id,createdAt:stamp,before:ids.map(function(k){var v=byId[k].value;return {id:k,revision:v.revision,invoiceId:v.invoiceId||'',invoiceGroupId:v.invoiceGroupId||'',invoiceGroupName:v.invoiceGroupName||'',grupNama:v.grupNama||''};})};
    var event={id:eventId,module:'pembelian',parentId:key,kind:'invoiceMerge',data:JSON.stringify(data),dibuat:stamp,dibuatOleh:me.id,sourceHash:''};
    checkRows('CommerceEvent',[event]);store.append('CommerceEvent',event);return answer();
  };
  /* A supplier invoice is one physical Record append. Its initial DP is frozen
     in each parent row, so no second table can leave money without the orders. */
  actions.saveCommerceOrderBatch=function(p){
    var me=writable(p),key=id(p.id),supplierId=id(p.supplierId),group=text(p.grupNama,100),orderDate=date(p.tanggalOrder),note=text(p.catatan,1000),orders=p.orders;
    if(!(orders instanceof Array)||!orders.length||orders.length>20)fail('Isi 1 sampai 20 model dalam satu invoice.');
    var ids=[],seen=Object.create(null),variantCount=0,totals=[];
    orders.forEach(function(o){if(!o||typeof o!=='object')fail('Rincian model tidak sah.');var oid=id(o.id);id(o.produkId);if(oid===key||seen[oid])fail('Identitas model invoice ganda.');seen[oid]=true;ids.push(oid);
      if(!(o.items instanceof Array)||!o.items.length||o.items.length>100)fail('Isi 1 sampai 100 varian pada setiap model.');variantCount+=o.items.length;var itemIds=Object.create(null),price=num(o.hargaSatuan,1e12,false,true),total=0;
      o.items.forEach(function(i){if(!i||typeof i!=='object')fail('Rincian varian tidak sah.');var iid=id(i.id);if(itemIds[iid])fail('Identitas baris barang ganda.');itemIds[iid]=true;text(i.nama,120,true);total+=num(i.jumlah,1e8,true,true)*price;});
      if(!Number.isSafeInteger(total))fail('Total terlalu besar.');totals.push(total);
    });
    if(variantCount>200)fail('Satu invoice paling banyak 200 varian.');
    var total=totals.reduce(function(n,v){return n+v;},0);if(!Number.isSafeInteger(total))fail('Total invoice terlalu besar.');
    var payment=p.initialPayment,amount=payment?num(payment.jumlah,1e15,false,true):0,payDate=payment?date(payment.tanggal||orderDate):orderDate,payMethod=payment?text(payment.metode||'transfer',40,true):'transfer',payNote=payment?text(payment.catatan,300):'';
    if(amount>total)fail('DP tidak boleh melebihi total invoice.');var shares=amount?coreCommerceSplit(amount,totals):totals.map(function(){return 0;});if(!shares)fail('Pembagian DP invoice tidak sah.');
    var proof=coreCommerceOrderBatchProof(p),records=all(),events=store.read('CommerceEvent'),existing=records.filter(function(r){return r.module==='pembelian'&&r.kind==='order'&&coreCommerceData(r).invoiceId===key;});
    function paymentId(oid){return 'gp_'+coreCommerceHash([key,oid]).slice(0,40);}
    function answer(rows){var out={invoiceId:key,orderIds:ids.slice(),groupId:amount?key:'',records:rows.map(function(r){return coreCommerceLean(view(r));})};if(p.targetInvoiceId)out.invoiceGroupId=p.targetInvoiceId;if(p.withState===true)out.commerce=stateOf('pembelian',me);return out;}
    if(existing.length){
      if(existing.length!==ids.length)fail('Invoice tersimpan sebagian. Periksa seluruh model dan DP; jangan membuat invoice pengganti.');
      var byId=Object.create(null);existing.forEach(function(r){var d=coreCommerceData(r);if(byId[d.id])fail('Identitas model invoice ganda.');byId[d.id]=r;});
      var ordered=ids.map(function(oid,i){var row=byId[oid],d=coreCommerceData(row),pay=d._initialPayment;
        if(!row||d.invoiceProof!==proof||d._createActor!==me.id||coreCommerceHash(d.invoiceOrderIds)!==coreCommerceHash(ids))fail('Identitas invoice sudah digunakan untuk isi atau akun berbeda.');
        if(shares[i]?!pay||pay.id!==paymentId(oid)||pay.groupId!==key||pay.kind!=='payment'||pay.jumlah!==shares[i]||pay.tanggal!==payDate||pay.metode!==payMethod||pay.catatan!==payNote||pay.createdBy!==me.id:!!pay)fail('Bukti DP awal invoice tidak lengkap. Periksa riwayat sebelum melanjutkan.');
        return row;
      });return answer(ordered);
    }
    var targetInvoice=p.targetInvoiceId?id(p.targetInvoiceId):'',targetName='';
    if(targetInvoice){
      if(targetInvoice===key)fail('Identitas penambahan model harus berbeda dari invoice tujuan.');
      var lookup=coreCommerceLookup(records,events),members=records.filter(function(r){return r.module==='pembelian'&&r.kind==='order';}).map(function(r){return coreCommerceRecordView(r,events,records,lookup);}).filter(function(v){return !v.cancelled&&(v.invoiceGroupId||v.invoiceId)===targetInvoice;});
      if(!members.length)fail('Invoice tujuan sudah berubah atau tidak tersedia. Buka kembali invoice.');
      if(members.length+orders.length>100)fail('Satu gabungan paling banyak 100 model.');
      var expectedMembers=p.expectedGroupRevisions||{},expectedIds=Object.keys(expectedMembers).sort(),memberIds=members.map(function(v){return v.id;}).sort();
      if(coreCommerceHash(expectedIds)!==coreCommerceHash(memberIds))fail('Isi invoice tujuan berubah. Muat ulang sebelum menambah model.');
      members.forEach(function(v){historyEditable(v);if(String((v.supplierSnapshot||{}).id||'')!==supplierId)fail('Invoice tujuan harus mempunyai identitas supplier yang sama.');if(!expectedMembers[v.id]||expectedMembers[v.id]!==v.revision)fail('Invoice tujuan berubah. Muat ulang sebelum menambah model.');});
      targetName=String(members[0].invoiceGroupId?members[0].invoiceGroupName||'':members[0].grupNama||'');
    }else if(p.expectedGroupRevisions)fail('Pilih invoice tujuan untuk menambah model.');
    var reserved=Object.create(null);reserved[key]=true;ids.forEach(function(oid){reserved[oid]=true;reserved[paymentId(oid)]=true;});
    if(records.some(function(r){var d=coreCommerceData(r),pay=d._initialPayment;return reserved[r.id]||reserved[d.id]||reserved[d.invoiceId]||pay&&(reserved[pay.id]||reserved[pay.groupId]);})||events.some(function(e){var d=coreCommerceData(e);return reserved[e.id]||reserved[d.groupId]||reserved[d.correctionId];}))fail('Identitas invoice atau model sudah digunakan. Muat ulang dan periksa riwayat.');
    var supplier=find('pembelian','supplier',supplierId);if(!supplier||coreCommerceData(supplier).aktif===false)fail('Supplier pembelian tidak ditemukan atau tidak aktif.');
    var stamp=now(),rows=orders.map(function(o,i){var data=normalize('order',{id:o.id,produkId:o.produkId,hargaSatuan:o.hargaSatuan,items:o.items,grupNama:group,tanggalOrder:orderDate,catatan:note});
      if(targetInvoice){data.invoiceGroupId=targetInvoice;data.invoiceGroupName=targetName;}
      if(data.supplierSnapshot.id!==supplierId)fail('Semua model invoice harus berasal dari supplier yang sama.');
      data.invoiceId=key;data.invoiceOrderIds=ids.slice();data.invoiceProof=proof;data._createHash=proof;data._createActor=me.id;
      if(shares[i])data._initialPayment={id:paymentId(o.id),kind:'payment',groupId:key,tanggal:payDate,jumlah:shares[i],metode:payMethod,catatan:payNote,createdBy:me.id,createdAt:stamp};
      return {id:coreCommerceKey('pembelian','order',o.id),module:'pembelian',kind:'order',parentId:'',data:JSON.stringify(data),revision:coreCommerceHash([data,stamp,me.id]),dibuat:stamp,dibuatOleh:me.id,diubah:stamp,sourceHash:''};
    });
    checkRows('CommerceRecord',rows);store.appendMany('CommerceRecord',rows);return answer(rows);
  };
  actions.saveCommerceNota=function(p){return save('nota','nota',p);};
  function event(p,kind){
    var me=writable(p,kind==='void'),module=p.module||'pembelian';if(['pembelian','nota'].indexOf(module)<0)fail('Modul tidak dikenal.');
    var key=id(p.id),parent=id(p.parentId||p.orderId),row=find(module,module==='nota'?'nota':'order',parent),record=historyEditable(view(row));
    var prior=store.read('CommerceEvent').filter(function(e){return e.id===key;})[0];
    var d={tanggal:date(p.tanggal||(prior?coreCommerceData(prior).tanggal:String(ctx.env.now().toISOString()).slice(0,10))),catatan:text(p.catatan,500,kind==='void')};
    if(kind==='payment'){d.jumlah=num(p.jumlah,1e15,true,true);d.metode=text(p.metode||'cash',40,true);tender(p,d);}
    if(kind==='receipt'){if(module!=='pembelian')fail('Penerimaan hanya untuk pembelian.');d.itemId=id(p.itemId);d.jumlah=num(p.jumlah,1e8,true,true);d.kondisi=text(p.kondisi,100);}
    if(kind==='void')d.eventId=id(p.eventId);
    if(prior){if(prior.module!==module||prior.parentId!==parent||prior.kind!==kind||prior.dibuatOleh!==me.id||coreCommerceHash(coreCommerceData(prior))!==coreCommerceHash(d))fail('Identitas transaksi sudah digunakan untuk isi atau akun berbeda.');return reply(module,row,p,me);}
    expected(row,p);if(record.cancelled)fail('Catatan sudah dibatalkan.');/* pembelian: DP boleh dibayar kapan pun, juga sebelum tanggal order; nota penjualan tetap tidak boleh mendahului notanya */if(module==='nota'&&d.tanggal<String(record.date||'').slice(0,10))fail('Tanggal transaksi tidak boleh sebelum pesanan/nota.');
    if(kind==='payment'&&(record.paymentReview||d.jumlah>record.balance))fail('Pembayaran melebihi sisa tagihan atau riwayat nominal perlu diperiksa.');
    if(kind==='receipt'){var item=(record.items||[]).filter(function(i){return i.id===d.itemId;})[0];if(record.receiptReview||!item)fail('Hubungan varian penerimaan perlu diperiksa; tidak boleh ditebak.');if(d.jumlah>coreNum(item.jumlah)-coreNum(record.receivedByItem[d.itemId]))fail('Penerimaan melebihi sisa varian pesanan.');}
    if(kind==='void'){var source=record.events.filter(function(e){return e.id===d.eventId;})[0];if(!source||source.kind==='void'||source.voided)fail('Transaksi asal tidak ditemukan atau telah dibatalkan.');}
    var stored={id:key,module:module,parentId:parent,kind:kind,data:JSON.stringify(d),dibuat:now(),dibuatOleh:me.id,sourceHash:''};checkRows('CommerceEvent',[stored]);store.append('CommerceEvent',stored);return reply(module,row,p,me);
  }
  actions.appendCommercePayment=function(p){return event(p,'payment');};actions.appendCommerceReceipt=function(p){return event(p,'receipt');};actions.voidCommerceEvent=function(p){return event(p,'void');};
  /* Ubah pembayaran atau penerimaan yang sudah tercatat (owner): catatan lama dikoreksi dan penggantinya ditulis dalam
     satu langkah, sehingga owner tidak perlu mengoreksi lalu mengisi ulang. Catatan lama tetap ada sebagai riwayat. */
  actions.gantiCommerceEvent=function(p){
    var me=writable(p,true),module=p.module||'pembelian';if(['pembelian','nota'].indexOf(module)<0)fail('Modul tidak dikenal.');
    var key=id(p.id),parent=id(p.parentId||p.orderId),sourceId=id(p.eventId),row=find(module,module==='nota'?'nota':'order',parent),record=historyEditable(view(row));
    var allEvents=store.read('CommerceEvent'),sudah=allEvents.filter(function(e){return e.id===key;})[0];
    var source=record.events.filter(function(e){return e.id===sourceId;})[0];
    if(!source||(source.kind!=='payment'&&source.kind!=='receipt'))fail(sudah?'Identitas transaksi sudah digunakan untuk isi atau akun berbeda.':'Transaksi asal tidak ditemukan atau telah dibatalkan.');
    var kind=source.kind,d={tanggal:date(p.tanggal||source.tanggal),catatan:text(p.catatan,500)};
    if(kind==='payment'){d.jumlah=num(p.jumlah,1e15,true,true);d.metode=text(p.metode||source.metode||'cash',40,true);}
    else{if(module!=='pembelian')fail('Penerimaan hanya untuk pembelian.');d.itemId=id(p.itemId||source.itemId);d.jumlah=num(p.jumlah,1e8,true,true);d.kondisi=text(p.kondisi===undefined?String(source.kondisi||''):p.kondisi,100);}
    if(sudah){
      var correction=allEvents.filter(function(e){return e.id==='gv_'+coreCommerceHash([key,sourceId]).slice(0,40);})[0];
      if(sudah.module!==module||sudah.parentId!==parent||sudah.kind!==kind||sudah.dibuatOleh!==me.id||coreCommerceHash(coreCommerceData(sudah))!==coreCommerceHash(d)||!correction||correction.module!==module||correction.parentId!==parent||correction.kind!=='void'||correction.dibuatOleh!==me.id||coreCommerceData(correction).eventId!==sourceId)fail('Identitas transaksi sudah digunakan untuk isi atau akun berbeda.');
      return reply(module,row,p,me);
    }
    expected(row,p);if(record.cancelled)fail('Catatan sudah dibatalkan.');
    if(source.voided)fail('Transaksi asal tidak ditemukan atau telah dibatalkan.');
    if(source.sourceReview)fail('Catatan lama yang masih perlu diperiksa tidak dapat diubah.');
    if(module==='nota'&&d.tanggal<String(record.date||'').slice(0,10))fail('Tanggal transaksi tidak boleh sebelum pesanan/nota.');
    if(kind==='payment'){
      if(record.paymentReview||d.jumlah>record.balance+coreNum(source.jumlah))fail('Pembayaran melebihi sisa tagihan atau riwayat nominal perlu diperiksa.');}
    else{
      var item=(record.items||[]).filter(function(i){return i.id===d.itemId;})[0];if(record.receiptReview||!item)fail('Hubungan varian penerimaan perlu diperiksa; tidak boleh ditebak.');
      var diterima=coreNum(record.receivedByItem[d.itemId])-(source.itemId===d.itemId?coreNum(source.jumlah):0);
      if(d.jumlah>coreNum(item.jumlah)-diterima)fail('Penerimaan melebihi sisa varian pesanan.');}
    var stamp=now(),rows=[{id:'gv_'+coreCommerceHash([key,sourceId]).slice(0,40),module:module,parentId:parent,kind:'void',data:JSON.stringify({tanggal:String(stamp).slice(0,10),catatan:'Diubah menjadi catatan baru',eventId:sourceId}),dibuat:stamp,dibuatOleh:me.id,sourceHash:''},
      {id:key,module:module,parentId:parent,kind:kind,data:JSON.stringify(d),dibuat:stamp,dibuatOleh:me.id,sourceHash:''}];
    checkRows('CommerceEvent',rows);store.appendMany('CommerceEvent',rows);return reply(module,row,p,me);
  };
  /* Bayar grup: one payment event per order, written together, all carrying the same groupId. */
  function groupedEmbeddedPayments(){return all().filter(function(r){return r.module==='pembelian'&&r.kind==='order';}).map(function(r){var d=coreCommerceData(r),e=d._initialPayment;if(!e||!e.groupId)return null;return {id:e.id,module:'pembelian',parentId:d.id,kind:'payment',data:JSON.stringify(e),dibuat:e.createdAt,dibuatOleh:e.createdBy,sourceHash:''};}).filter(function(r){return !!r;});}
  actions.appendCommerceGroupPayment=function(p){
    var me=writable(p),key=id(p.id),ids=p.orderIds,seen={};if(!(ids instanceof Array)||ids.length<2||ids.length>40)fail('Pilih 2 sampai 40 order untuk pembayaran grup.');
    var rows=ids.map(function(k){k=id(k);if(seen[k])fail('Order ganda dalam pembayaran grup.');seen[k]=true;var row=find('pembelian','order',k);if(!row)fail('Catatan tidak ditemukan.');return row;});
    var d={tanggal:date(p.tanggal||String(ctx.env.now().toISOString()).slice(0,10)),catatan:text(p.catatan,500),metode:text(p.metode||'transfer',40,true)},amount=num(p.jumlah,1e15,true,true);
    function eventId(orderId){return 'gp_'+coreCommerceHash([key,orderId]).slice(0,40);}
    function answer(){var out={groupId:key};if(p.withState===true)out.commerce=stateOf('pembelian',me);return out;}
    var views=rows.map(view),supplierId='';views.forEach(function(v){historyEditable(v);var sid=(v.supplierSnapshot||{}).id;if(!sid||supplierId&&sid!==supplierId)fail('Pembayaran grup harus memakai identitas supplier yang sama.');supplierId=sid;});
    var prior=store.read('CommerceEvent').filter(function(e){return e.module==='pembelian'&&e.kind==='payment'&&coreCommerceData(e).groupId===key;});
    if(groupedEmbeddedPayments().some(function(e){return coreCommerceData(e).groupId===key;}))fail('Identitas pembayaran sudah digunakan oleh DP awal invoice.');
    if(prior.length){
      var same=prior.every(function(e){var x=coreCommerceData(e);return e.dibuatOleh===me.id&&seen[e.parentId]&&e.id===eventId(e.parentId)&&x.tanggal===d.tanggal&&x.metode===d.metode&&x.catatan===d.catatan;})&&prior.reduce(function(n,e){return n+coreNum(coreCommerceData(e).jumlah);},0)===amount;
      if(!same)fail('Identitas transaksi sudah digunakan untuk isi atau akun berbeda.');return answer();
    }
    /* New DP belongs to the invoice currently selected. An exact retry above
       must still recover an older payment even if its orders were regrouped. */
    var invoiceKey=coreCommerceInvoiceKey(views[0]);
    if(views.some(function(v){return coreCommerceInvoiceKey(v)!==invoiceKey;}))fail('Pembayaran grup harus untuk satu invoice. Gabungkan PO yang dipilih terlebih dahulu.');
    views.forEach(function(v){if(!p.expectedRevisions||p.expectedRevisions[v.id]!==v.revision)fail('Catatan berubah sejak formulir dibuka. Muat ulang dan periksa lagi.');if(v.cancelled)fail('Catatan sudah dibatalkan.');if(v.paymentReview)fail('Riwayat nominal salah satu order perlu diperiksa. Keluarkan order itu dari pembayaran grup.');});
    var shares=coreCommerceSplit(amount,views.map(function(v){return v.balance;}));if(!shares)fail('Pembayaran grup harus lebih dari nol dan tidak melebihi sisa tagihan grup.');
    var stamp=now(),stored=[];views.forEach(function(v,i){if(shares[i])stored.push({id:eventId(v.id),module:'pembelian',parentId:v.id,kind:'payment',data:JSON.stringify({tanggal:d.tanggal,catatan:d.catatan,jumlah:shares[i],metode:d.metode,groupId:key}),dibuat:stamp,dibuatOleh:me.id,sourceHash:''});});
    checkRows('CommerceEvent',stored);store.appendMany('CommerceEvent',stored);return answer();
  };
  /* Ubah atau hapus satu pembayaran gabungan (owner). Semua bagiannya di tiap order dikoreksi sekaligus, lalu total yang
     baru dibagi ulang menurut sisa tagihan tiap order (sisa dihitung seolah pembayaran lama belum ada). jumlah 0 berarti
     pembayaran gabungan itu dihapus. Tidak ada baris yang dibuang: bagian lama tetap ada sebagai riwayat yang dikoreksi. */
  actions.gantiCommerceGroupPayment=function(p){
    var me=writable(p,true),key=id(p.id),groupId=id(p.groupId),amount=num(p.jumlah,1e15,false,true);
    function answer(){var out={groupId:key};if(p.withState===true)out.commerce=stateOf('pembelian',me);return out;}
    function voidId(eventId){return 'gg_'+coreCommerceHash([key,eventId]).slice(0,40);}
    var semua=store.read('CommerceEvent').filter(function(e){return e.module==='pembelian';});
    var embedded=groupedEmbeddedPayments(),lama=semua.concat(embedded).filter(function(e){return e.kind==='payment'&&coreCommerceData(e).groupId===groupId;});
    var sourceIds=Object.create(null);lama.forEach(function(e){if(sourceIds[e.id])fail('Bukti pembayaran gabungan ganda; periksa riwayat.');sourceIds[e.id]=true;});
    if(!lama.length)fail('Pembayaran gabungan tidak ditemukan.');
    var awal=coreCommerceData(lama[0]),d={tanggal:date(p.tanggal||awal.tanggal),catatan:text(p.catatan,500),metode:text(p.metode||awal.metode||'transfer',40,true)};
    var requestHash=coreCommerceHash({groupId:groupId,amount:amount,data:d,expectedRevisions:p.expectedRevisions||{}});
    var bekas={};lama.forEach(function(e){bekas[voidId(e.id)]=true;});
    var sudah=semua.filter(function(e){return bekas[e.id];});
    if(sudah.length){
      if(sudah.some(function(e){var x=coreCommerceData(e);return e.dibuatOleh!==me.id||x.requestHash!==requestHash||x.correctionId!==key;}))fail('Identitas transaksi sudah digunakan untuk isi atau akun berbeda.');
      var parentDone={};sudah.forEach(function(e){parentDone[e.parentId]=true;});
      var replacements=semua.filter(function(e){return e.kind==='payment'&&coreCommerceData(e).groupId===key;});
      if(sudah.some(function(e){return coreCommerceData(e).correctionCount!==sudah.length;})||replacements.some(function(e){var x=coreCommerceData(e);return !parentDone[e.parentId]||e.dibuatOleh!==me.id||x.tanggal!==d.tanggal||x.metode!==d.metode||x.catatan!==d.catatan;})||replacements.reduce(function(n,e){return n+coreNum(coreCommerceData(e).jumlah);},0)!==amount)fail('Penyimpanan koreksi grup belum lengkap. Periksa riwayat sebelum membuat pembayaran lain.');
      return answer();
    }
    if(semua.concat(embedded).some(function(e){var x=coreCommerceData(e);return x.groupId===key||x.correctionId===key;}))fail('Identitas transaksi sudah digunakan untuk isi atau akun berbeda.');
    var voided={};semua.forEach(function(e){if(e.kind==='void')voided[JSON.stringify([e.parentId,coreCommerceData(e).eventId])]=true;});
    var active=lama.filter(function(e){return !voided[JSON.stringify([e.parentId,e.id])];});
    if(!active.length)fail('Pembayaran gabungan ini sudah dikoreksi.');
    var seen={},rows=[];active.forEach(function(e){if(seen[e.parentId])return;seen[e.parentId]=true;rows.push(find('pembelian','order',e.parentId));});
    var views=rows.map(view),bagian={};
    views.forEach(function(v){
      historyEditable(v);
      if(!p.expectedRevisions||p.expectedRevisions[v.id]!==v.revision)fail('Catatan berubah sejak formulir dibuka. Muat ulang dan periksa lagi.');
      if(v.cancelled)fail('Catatan sudah dibatalkan.');if(v.paymentReview)fail('Riwayat nominal salah satu order perlu diperiksa.');
      bagian[v.id]=v.events.filter(function(e){return e.kind==='payment'&&!e.voided&&e.groupId===groupId;});
    });
    var hidup=0;views.forEach(function(v){bagian[v.id].forEach(function(e){hidup+=coreNum(e.jumlah);});});
    if(!hidup)fail('Pembayaran gabungan ini sudah dikoreksi.');
    var shares=amount?coreCommerceSplit(amount,views.map(function(v){return v.balance+bagian[v.id].reduce(function(n,e){return n+coreNum(e.jumlah);},0);})):views.map(function(){return 0;});
    if(!shares)fail('Pembayaran gabungan melebihi sisa tagihan order-ordernya.');
    var stamp=now(),hari=String(stamp).slice(0,10),stored=[];
    views.forEach(function(v){bagian[v.id].forEach(function(e){stored.push({id:voidId(e.id),module:'pembelian',parentId:v.id,kind:'void',data:JSON.stringify({tanggal:hari,catatan:amount?'Pembayaran gabungan diubah':'Pembayaran gabungan dihapus',eventId:e.id,correctionId:key,requestHash:requestHash,correctionCount:active.length}),dibuat:stamp,dibuatOleh:me.id,sourceHash:''});});});
    views.forEach(function(v,i){if(shares[i])stored.push({id:'gp_'+coreCommerceHash([key,v.id]).slice(0,40),module:'pembelian',parentId:v.id,kind:'payment',data:JSON.stringify({tanggal:d.tanggal,catatan:d.catatan,jumlah:shares[i],metode:d.metode,groupId:key}),dibuat:stamp,dibuatOleh:me.id,sourceHash:''});});
    checkRows('CommerceEvent',stored);store.appendMany('CommerceEvent',stored);return answer();
  };
  /* Order dari data lama (atau yang masih "perlu diperiksa") rinciannya terkunci. "Jadikan order biasa" (owner): isinya
     disalin menjadi order baru buatan aplikasi ini (produk, varian, harga, tanggal, nama invoice), dan pembayaran serta
     penerimaan yang masih berlaku ikut disalin dengan tanggal aslinya sebagai catatan biasa yang bisa diubah. Order lamanya
     tidak dihapus dan isinya tidak diubah: ia diarsipkan utuh bersama catatan aslinya sebagai bukti, dan bisa dikembalikan.
     Penerimaan lama yang variannya tidak dikenali tidak disalin (jumlahnya dilaporkan), supaya tidak ada hubungan yang ditebak. */
  actions.salinCommerceOrderLama=function(p){
    var me=writable(p,true),key=id(p.id),sourceKey=id(p.orderId),row=find('pembelian','order',sourceKey);if(!row)fail('Catatan tidak ditemukan.');
    var v=historyEditable(view(row)),old=coreCommerceData(row),sudah=find('pembelian','order',key);
    function jawab(baru,dilewati){var out=reply('pembelian',baru,p,me);out.penerimaanDilewati=dilewati;return out;}
    function rencana(total,items){
      var batas={},terima={},paid=0,rows=[],dilewati=0;items.forEach(function(i){batas[i.id]=coreNum(i.jumlah);});
      v.events.forEach(function(e){
        if(e.voided||(e.kind!=='payment'&&e.kind!=='receipt'))return;
        var n=coreNum(e.jumlah),d;
        if(e.kind==='payment'){
          if(!Number.isSafeInteger(n)||n<=0)fail('Nominal pembayaran lama tidak sah. Order ini belum bisa disalin otomatis.');
          paid+=n;if(paid>total)fail('Pembayaran lama melebihi total order. Order ini belum bisa disalin otomatis; buat order baru lalu isi pembayarannya.');
          d={tanggal:date(e.tanggal),catatan:text(String(e.catatan||'').slice(0,500),500),jumlah:n,metode:text(String(e.metode||'lainnya').slice(0,40),40,true)};
        }else{
          if(!e.itemId||batas[e.itemId]===undefined||!Number.isSafeInteger(n)||n<=0||coreNum(terima[e.itemId])+n>batas[e.itemId]){dilewati++;return;}
          terima[e.itemId]=coreNum(terima[e.itemId])+n;d={tanggal:date(e.tanggal),catatan:text(String(e.catatan||'').slice(0,500),500),itemId:e.itemId,jumlah:n,kondisi:text(String(e.kondisi||'').slice(0,100),100)};
        }
        rows.push({id:'sl_'+coreCommerceHash([key,e.id||[e.kind,e.tanggal,n]]).slice(0,40),module:'pembelian',parentId:key,kind:e.kind,data:JSON.stringify(d),dibuat:'',dibuatOleh:me.id,sourceHash:''});
      });
      return {rows:rows,dilewati:dilewati};
    }
    function tulis(rows){if(!rows.length)return;var st=now();rows.forEach(function(e){e.dibuat=st;});checkRows('CommerceEvent',rows);store.appendMany('CommerceEvent',rows);}
    function arsipkan(){var r=find('pembelian','order',sourceKey),d=coreCommerceData(r);if(d.cancelled)return;d.cancelled=true;d.cancelReason='Disalin menjadi order baru yang bisa diedit';d.cancelledBy=me.id;d.cancelledAt=now();d.cancelKeepsEvents=true;r=Object.assign({},r,{data:JSON.stringify(d),revision:coreCommerceHash(d),diubah:now()});checkRows('CommerceRecord',[r]);store.update('CommerceRecord',r.id,r);}
    if(sudah){
      /* kiriman ulang: lengkapi yang belum sempat tertulis, tidak ada yang ditulis dua kali */
      var sd=coreCommerceData(sudah);if(sd._salinDari!==sourceKey||sudah.dibuatOleh!==me.id)fail('Identitas transaksi sudah digunakan untuk isi atau akun berbeda.');
      var ulang=rencana(coreNum(sd.totalHarga),sd.items||[]),ada={};store.read('CommerceEvent').forEach(function(e){ada[e.id]=true;});
      tulis(ulang.rows.filter(function(e){return !ada[e.id];}));arsipkan();return jawab(find('pembelian','order',key),ulang.dilewati);
    }
    expected(row,p);if(v.cancelled)fail('Catatan sudah dibatalkan.');
    if(!row.sourceHash&&!v.needsReview)fail('Order ini sudah bisa diubah lewat tombol Edit.');
    /* varian lama yang tidak punya identitas (atau identitasnya ganda) diberi identitas baru; penerimaan lama yang menunjuk
       varian tak dikenal memang tidak ikut disalin */
    var pakai={},barang=(v.items||[]).map(function(i,n){var iid=typeof i.id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(i.id)&&!pakai[i.id]?i.id:'it_'+coreCommerceHash([key,n]).slice(0,24);pakai[iid]=true;return {id:iid,nama:i.nama,jumlah:i.jumlah};});
    var data=normalize('order',{id:key,produkId:old.produkId,items:barang,hargaSatuan:old.hargaSatuan,tanggalOrder:old.tanggalOrder,grupNama:p.grupNama===undefined?String(old.grupNama||''):p.grupNama,catatan:[String(old.catatan||'').trim(),'Disalin dari data aplikasi lama'].filter(Boolean).join(' · ').slice(0,1000)},null);
    var plan=rencana(data.totalHarga,data.items),stamp=now(),tanda=coreCommerceHash({kind:'order',salin:sourceKey,key:key});
    data._createHash=tanda;data._createActor=me.id;data._lastMutation={hash:tanda,actor:me.id};data._salinDari=sourceKey;
    var baru={id:coreCommerceKey('pembelian','order',key),module:'pembelian',kind:'order',parentId:'',data:JSON.stringify(data),revision:coreCommerceHash([data,stamp,me.id]),dibuat:stamp,dibuatOleh:me.id,diubah:stamp,sourceHash:''};
    checkRows('CommerceRecord',[baru]);store.append('CommerceRecord',baru);tulis(plan.rows);arsipkan();
    return jawab(baru,plan.dilewati);
  };
  actions.cancelCommerceRecord=function(p){var me=writable(p,true),module=p.module;if(['pembelian','nota'].indexOf(module)<0)fail('Modul tidak dikenal.');var mode=p.mode===undefined?'':text(p.mode,20,true);if(mode&&(module!=='pembelian'||['inactive','archived'].indexOf(mode)<0))fail('Jenis penonaktifan tidak dikenal.');if(mode&&p.voidAll===true)fail('Nonaktifkan atau arsipkan PO tidak boleh membatalkan transaksi.');var row=find(module,module==='nota'?'nota':'order',id(p.id)),v=historyEditable(view(row)),reason=text(p.catatan,500,true);if(v.cancelled){if(v.cancelledBy===me.id&&v.cancelReason===reason&&(v.cancelMode||'')===mode)return reply(module,row,p,me);if(!(mode==='archived'&&v.cancelMode==='inactive'&&v.cancelKeepsEvents))fail('Catatan sudah dibatalkan.');}expected(row,p);
    /* Explicit inactive/archive modes preserve every purchase ledger entry.
       The older arsip flag retains its original legacy/review-only scope. */
    var arsip=module==='pembelian'&&(!!mode||p.arsip===true&&(!!row.sourceHash||v.needsReview));
    if(!arsip&&(v.paymentReview||v.receipts.some(function(e){return !e.voided&&e.sourceReview;})))fail('Periksa bukti nominal atau jumlah historis sebelum membatalkan catatan.');/* voidAll (owner, purchase orders entered here): an order that will not happen is removed in one step.
       Every payment and receipt still in force is corrected with the same reason, then the order is cancelled.
       Nothing is erased: the events stay in the ledger with their corrections. */
    if(arsip){}
    else if(p.voidAll===true&&(v.totalPaid||v.totalReceived)){
      if(row.sourceHash||v.needsReview)fail('Pesanan dari data lama atau yang masih perlu diperiksa tidak dapat dihapus sekaligus. Koreksi transaksinya satu per satu.');
      var voidStamp=now(),voidDate=String(ctx.env.now().toISOString()).slice(0,10),voids=v.events.filter(function(e){return e.kind!=='void'&&!e.voided&&e.id;}).map(function(e){return {id:'vd_'+coreCommerceHash([v.id,e.id]).slice(0,40),module:module,parentId:v.id,kind:'void',data:JSON.stringify({tanggal:voidDate,catatan:reason,eventId:e.id}),dibuat:voidStamp,dibuatOleh:me.id,sourceHash:''};});
      checkRows('CommerceEvent',voids);store.appendMany('CommerceEvent',voids);
    }
    else if(v.totalPaid||v.totalReceived)fail('Batalkan transaksi pembayaran/penerimaan yang masih berlaku terlebih dahulu.');var data=coreCommerceData(row);data.cancelled=true;data.cancelReason=reason;data.cancelledBy=me.id;data.cancelledAt=now();if(arsip)data.cancelKeepsEvents=true;if(mode){data.cancelMode=mode;data.lifecycleHistory=(data.lifecycleHistory||[]).concat([{mode:mode,reason:reason,by:me.id,at:data.cancelledAt}]);}row=Object.assign({},row,{data:JSON.stringify(data),revision:coreCommerceHash(data),diubah:now()});checkRows('CommerceRecord',[row]);store.update('CommerceRecord',row.id,row);return reply(module,row,p,me);};
  /* The owner's undo for "Hapus order": the order returns to the list. Corrections written by the removal stay as they are;
     an order that was already cancelled in the old data (no cancelledBy) is kept as it came. */
  actions.restoreCommerceRecord=function(p){var me=writable(p,true),module=p.module;if(['pembelian','nota'].indexOf(module)<0)fail('Modul tidak dikenal.');var row=find(module,module==='nota'?'nota':'order',id(p.id)),v=historyEditable(view(row));if(!v.cancelled)return reply(module,row,p,me);expected(row,p);var data=coreCommerceData(row);if(!data.cancelledBy)fail('Order ini sudah batal sejak data lama dan disimpan tetap.');
    data.restoredFrom={reason:data.cancelReason||'',by:data.cancelledBy,at:data.cancelledAt||''};if(data.cancelMode)data.restoredFrom.mode=data.cancelMode;data.restoredBy=me.id;data.restoredAt=now();if(data.cancelMode)data.lifecycleHistory=(data.lifecycleHistory||[]).concat([{mode:'restored',reason:data.cancelReason||'',by:me.id,at:data.restoredAt}]);['cancelled','cancelReason','cancelledBy','cancelledAt','cancelKeepsEvents','cancelMode'].forEach(function(k){delete data[k];});
    row=Object.assign({},row,{data:JSON.stringify(data),revision:coreCommerceHash(data),diubah:now()});checkRows('CommerceRecord',[row]);store.update('CommerceRecord',row.id,row);return reply(module,row,p,me);};
  /* Arsip nota: hanya menyembunyikan nota dari daftar utama. Status, pembayaran, dan isinya tidak berubah. */
  actions.arsipCommerceNota=function(p){var me=writable(p),row=find('nota','nota',id(p.id)),v=historyEditable(view(row)),arsip=p.arsip!==false;if(!!v.archived===arsip)return reply('nota',row,p,me);expected(row,p);
    var data=coreCommerceData(row),stamp=now();if(arsip){data.archived=true;data.archivedBy=me.id;data.archivedAt=stamp;}else['archived','archivedBy','archivedAt'].forEach(function(k){delete data[k];});
    row=Object.assign({},row,{data:JSON.stringify(data),revision:coreCommerceHash([data,stamp,me.id]),diubah:stamp});checkRows('CommerceRecord',[row]);store.update('CommerceRecord',row.id,row);return reply('nota',row,p,me);};
  function hppInput(config){
    var source=store.read('CommerceSource'),legacy={production:[],stock:{pembelian:[],rolInfo:{}},meta:{},cuttingPlans:[]};
    store.read('CommerceImport').filter(function(r){return r.status==='complete';}).forEach(function(manifest){var proof=coreCommerceData(manifest),subset=source.filter(function(r){return r.sourceHash===manifest.sourceHash;}).map(function(r){var out={};SCHEMA.CommerceSource.forEach(function(k){out[k]=r[k]===undefined?'':r[k];});return out;}).sort(function(a,b){return a.id.localeCompare(b.id);});if(subset.length!==proof.sourceRows||coreCommerceHash(subset)!==proof.sourceDigest)fail('Snapshot HPP asal tidak utuh atau berubah. Periksa cadangan impor sebelum menghitung.');});
    var manifestHashes={};store.read('CommerceImport').filter(function(r){return r.status==='complete';}).forEach(function(r){manifestHashes[r.sourceHash]=true;});if(source.some(function(r){return !manifestHashes[r.sourceHash];}))fail('Ada snapshot HPP tanpa manifest impor lengkap.');
    source.forEach(function(r){var data=coreCommerceData(r);if(r.kind==='hpp-production')legacy.production.push(data);if(r.kind==='hpp-purchase')legacy.stock.pembelian.push(data);if(r.kind==='hpp-rollinfo')legacy.stock.rolInfo[r.parentId]=data;if(r.kind==='hpp-meta')legacy.meta=data;if(r.kind==='hpp-plan')legacy.cuttingPlans.push(data);});
    legacy.workers=coreCommerceRows(legacy.meta.tukangJahit||legacy.meta.maklon||{});var input={config:config,legacy:legacy,tables:{},settings:ctx.settings()};['PO','Produk','Potong','SlipKirim','StokBahan','RencanaPotong','KoreksiRiwayat'].forEach(function(s){input.tables[s]=store.read(s);});return input;
  }
  actions.getCommerceState=function(p){var me=admin(p,false,true),module=p.module;if(['pembelian','nota','hpp'].indexOf(module)<0)fail('Modul tidak dikenal.');var waiting=pending();if(waiting.length)fail('Impor modul belum selesai. Owner perlu melanjutkan file yang sama sebelum modul dipakai.');var out=stateOf(module,me);
    if(module==='hpp'){var row=find('hpp','config','config');out.config=row?coreCommerceCopy(coreCommerceData(row)):{configs:{},modelConfigs:{},marketplace:{},pajak:0};['_lastMutation','_createHash','_createActor'].forEach(function(k){delete out.config[k];});out.revision=row?view(row).revision:'';if(typeof coreCommerceHpp==='function')Object.assign(out,coreCommerceHpp(hppInput(out.config)));else{out.models=[];out.warnings=['Perhitungan HPP belum tersedia.'];}}
    return out;
  };
  /* Photos for the products on screen. Each (product, revision) is kept in the
     small per-image cache, so repeat requests do not load the record table. */
  actions.getCommerceImages=function(p){admin(p,false,true);if(pending().length)fail('Impor modul belum selesai. Owner perlu melanjutkan file yang sama sebelum modul dipakai.');
    var seen={},items=(p.items instanceof Array?p.items:[]).slice(0,12).map(function(i){i=i||{};var rev=String(i.rev||'');if(!/^[a-f0-9]{8,64}$/.test(rev))fail('Identitas catatan tidak sah.');return {id:id(i.id),rev:rev,key:'cm.'+i.id+'.'+rev};}).filter(function(i){if(seen[i.id])return false;seen[i.id]=true;return true;});
    var out={},left=items;if(store.imgGet&&items.length){var hit=store.imgGet(items.map(function(i){return i.key;}));left=items.filter(function(i){if(!hit[i.key])return true;out[i.id]=hit[i.key];return false;});}
    if(left.length){var want={},fresh={},events=store.read('CommerceEvent');left.forEach(function(i){want[i.id]=i;});
      all().forEach(function(r){if(r.module!=='pembelian'||r.kind!=='product')return;var d=coreCommerceData(r),i=Object.prototype.hasOwnProperty.call(want,d.id)?want[d.id]:null;if(!i||!d.gambar||out[d.id])return;out[d.id]=d.gambar;if(coreCommerceRecordView(r,events,[]).revision.indexOf(i.rev)===0)fresh[i.key]=d.gambar;});
      if(store.imgPut)store.imgPut(fresh);}
    return {images:out};
  };  function saveHpp(p,settingsOnly){var me=writable(p),row=find('hpp','config','config'),current=row?coreCommerceCopy(coreCommerceData(row)):{id:'config',configs:{},modelConfigs:{},marketplace:{},pajak:0};var intent=coreCommerceHash({modelId:p.modelId,config:p.config,marketplace:p.marketplace,pajak:p.pajak,before:p.expectedRevision||''});if(current._lastMutation&&current._lastMutation.hash===intent&&current._lastMutation.actor===me.id)return {revision:view(row).revision};if(row)expected(row,p);else if(p.expectedRevision)fail('Konfigurasi asal tidak ditemukan.');
    if(settingsOnly){if(p.pajak!==undefined)current.pajak=num(p.pajak,100,false,false);if(p.marketplace!==undefined){if(!p.marketplace||typeof p.marketplace!=='object'||p.marketplace instanceof Array||Object.keys(p.marketplace).length>20)fail('Pengaturan marketplace tidak sah.');current.marketplace={};Object.keys(p.marketplace).forEach(function(k){id(k);var m=p.marketplace[k];current.marketplace[k]={nama:text(m.nama,80,true),fee:num(m.fee,100,false,false),fixedPerPcs:num(m.fixedPerPcs===undefined?0:m.fixedPerPcs,1e12,false,true)};});}}
    else{var modelId=text(p.modelId,500,true),config=p.config;if(typeof coreCommerceHpp!=='function'||typeof coreCommerceHppConfig!=='function')fail('Perhitungan HPP belum tersedia.');var model=coreCommerceHpp(hppInput(current)).models.filter(function(m){return m.id===modelId;})[0];if(!model||['__proto__','constructor','prototype'].indexOf(modelId)>=0)fail('Model HPP tidak ditemukan.');config=coreCommerceHppConfig(config,model);current.modelConfigs=current.modelConfigs||{};current.modelConfigs[modelId]=config;}
    current._lastMutation={hash:intent,actor:me.id};var stamp=now(),saved={id:coreCommerceKey('hpp','config','config'),module:'hpp',kind:'config',parentId:'',data:JSON.stringify(current),revision:coreCommerceHash(current),dibuat:row?row.dibuat:stamp,dibuatOleh:row?row.dibuatOleh:me.id,diubah:stamp,sourceHash:row?row.sourceHash:''};checkRows('CommerceRecord',[saved]);if(row)store.update('CommerceRecord',row.id,saved);else store.append('CommerceRecord',saved);return {revision:view(saved).revision};
  }
  actions.saveCommerceHpp=function(p){return saveHpp(p,false);};actions.saveCommerceHppSettings=function(p){return saveHpp(p,true);};
  actions.makeCommercePdf=function(p){admin(p,false,true);if(!ctx.env.makePdf)fail('PDF tersedia setelah aplikasi terpasang.');var module=p.module;if(['pembelian','nota'].indexOf(module)<0)fail('Jenis dokumen tidak dikenal.');if(pending().length)fail('Impor belum selesai.');var grouped=p.ids!==undefined,ids=grouped?p.ids:[p.id];if(!(ids instanceof Array)||!ids.length||ids.length>20||grouped&&module!=='pembelian')fail('Pilih 1 sampai 20 pesanan pembelian untuk PDF gabungan.');var seen={},supplierId='',records=ids.map(function(key){key=id(key);if(seen[key])fail('Pesanan gabungan tidak boleh ganda.');seen[key]=true;var record=historyEditable(view(find(module,module==='nota'?'nota':'order',key)));if(p.expectedRevisions&&p.expectedRevisions[key]!==record.revision)fail('Pesanan berubah sejak pilihan cetak dibuka. Muat ulang dan pilih kembali.');if(grouped){var sid=(record.supplierSnapshot||{}).id;if(!sid||supplierId&&sid!==supplierId)fail('PDF gabungan harus memakai identitas supplier yang sama.');supplierId=sid;}return record;});/* nota penjualan: invoice untuk pelanggan (logo dikirim perangkat sebagai gambar kecil); pembelian tetap memakai slip */
    if(module==='nota'){var invoiceName='Invoice-'+String(records[0].noNota||p.id).replace(/[^A-Za-z0-9_-]/g,'')+'.pdf';return {base64:ctx.env.makePdf(coreNotaInvoiceHtml(records[0],ctx.settings(),{logo:p.logo}),invoiceName),nama:invoiceName};}
    var models=records.map(function(record){return coreCommerceSlipModel(module,record,{});}),name=grouped?'Pembelian-Gabungan.pdf':'Pembelian-'+p.id+'.pdf';return {base64:ctx.env.makePdf(coreSlipModelsHtml(models,ctx.settings()),name),nama:name};};
  if(typeof coreInstallCommerceMigration==='function')coreInstallCommerceMigration(actions,{store:store,env:ctx.env,auth:admin,fail:fail,fresh:fresh,pending:pending,checkRows:checkRows});
}
