/* Admin commerce is loaded on demand. Payments and receipts are append-only;
   none of these actions creates, deletes or reallocates production history. */
function coreCommerceHash(value) { return coreLegacyHash(value); }
function coreCommerceKey(module,kind,id) { return 'cm_'+coreCommerceHash([module,kind,String(id)]).slice(0,40); }
function coreCommerceCopy(value) { return JSON.parse(JSON.stringify(value)); }
function coreCommerceRows(value) { return (value instanceof Array ? value : value && typeof value === 'object' ? Object.keys(value).map(function(k){return value[k];}) : []).filter(function(v){return v && typeof v === 'object';}); }
function coreCommerceData(row) { return coreMap(row && row.data); }
function coreCommerceRecordView(row, events, records) {
  var value=coreCommerceCopy(coreCommerceData(row)), embedded=value._initialPayment, own=(events||[]).filter(function(e){return e.module===row.module&&e.parentId===value.id;});
  var revision=coreCommerceHash({record:row.revision,events:own.map(function(e){return [e.id,e.data];}).sort(function(a,b){return a[0].localeCompare(b[0]);})});
  ['_createHash','_createActor','_lastMutation','_initialPayment'].forEach(function(k){delete value[k];});
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
    var product=(records||[]).filter(function(r){return r.module==='pembelian'&&r.kind==='product'&&coreCommerceData(r).id===value.produkId;})[0],p=coreCommerceData(product);
    var supplier=(records||[]).filter(function(r){return r.module==='pembelian'&&r.kind==='supplier'&&coreCommerceData(r).id===p.supplierId;})[0];
    value.productName=(value.productSnapshot||p).nama||'';value.supplierName=(value.supplierSnapshot||coreCommerceData(supplier)).nama||'';
  }
  return value;
}
function coreCommerceSlipModel(module,record,context) {
  context=context||{};var nota=module==='nota',money=coreRupiah,rows=(record.items||[]).map(function(i){return nota?[i.name||'',String(i.size||'')+' '+String(i.color||''),coreRibuan(i.qty),money(i.price),String(coreNum(i.discPercent))+'%',money(i.subtotal)]:[i.nama||record.productName||'',coreRibuan(i.jumlah),money(record.hargaSatuan),money(coreNum(i.jumlah)*coreNum(record.hargaSatuan))];});
  var payments=(record.payments||[]).map(function(p){return [p.tanggal||'',p.metode||'',money(p.jumlah),p.tenderedAmount===undefined?'':money(p.tenderedAmount),p.change===undefined?'':money(p.change),p.voided?'Dibatalkan: '+(p.voidReason||''):(p.catatan||'')];});
  var summary=nota?[{label:'Subtotal barang',value:money(record.subtotal)},{label:'Diskon nota ('+coreNum(record.discountPercent)+'%)',value:money(record.discountAmount)},{label:'Ongkir',value:money(record.shipping)}]:[];
  summary=summary.concat([{label:'Total',value:money(nota?record.total:record.totalHarga),emphasis:true},{label:'Dibayar untuk tagihan',value:money(record.totalPaid)},{label:'Sisa',value:money(record.balance),emphasis:true},{label:'Status',value:record.status==='review'?'Perlu diperiksa':record.status}]);
  var sections=payments.length?[{title:'Riwayat pembayaran',columns:['Tanggal','Metode','Tagihan dibayar','Uang diterima','Kembalian','Catatan'].map(function(label){return {label:label};}),rows:payments}]:[];
  if(nota&&record.customer)sections.push({title:'Pelanggan',columns:[{label:'Kontak'},{label:'Alamat'}],rows:[[record.customer.phone||'',record.customer.address||'']]});
  if(record.needsReview)sections.push({title:'Perlu diperiksa',columns:[{label:'Keterangan'}],rows:(record.reviewReasons||[]).map(function(s){return [s];})});
  var note=nota?record.notes:record.catatan;if(note)sections.push({title:'Catatan',columns:[{label:'Keterangan'}],rows:[[note]]});
  return {layout:'weekly-a4',title:nota?'Nota Penjualan':'Pesanan Pembelian Produk',reference:record.noNota||record.id,recipient:nota?(record.customer||{}).name||'':record.supplierName||'',recipientLabel:nota?'Pelanggan':'Supplier',period:nota?String(record.date||'').slice(0,10):record.tanggalOrder||'',columns:(nota?['Barang','Ukuran / Warna','Qty','Harga','Diskon','Subtotal']:['Varian','Qty','Harga','Subtotal']).map(function(label){return {label:label};}),rows:rows,summary:summary,sections:sections,signatures:[]};
}
function coreInstallCommerceActions(actions,ctx) {
  var store=ctx.store, tables=['CommerceRecord','CommerceEvent','CommerceSource','CommerceImport'];
  function fail(s){ctx.fail(s);}
  function admin(p,owner){if(store.fresh)store.fresh('Pegawai');var me=ctx.auth(p);if(!coreIsAdmin(me)||owner&&me.divisi!=='owner')fail(owner?'Hanya owner yang boleh melakukan tindakan ini.':'Modul ini hanya untuk owner atau admin.');return me;}
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
  function expected(row,p){if(!p.expectedRevision||p.expectedRevision!==view(row).revision)fail('Catatan berubah sejak formulir dibuka. Muat ulang dan periksa lagi.');}
  function checkRows(table,rows){if(store.validateRows)store.validateRows(table,rows);else rows.forEach(function(r){Object.keys(r).forEach(function(k){if(String(r[k]).length>49000)fail('Catatan terlalu panjang untuk disimpan.');});});}
  function sourcePicture(v){if(!v)return '';if(typeof v!=='string'||v.length>48000||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v))fail('Gambar harus JPEG/PNG/WebP berukuran kecil.');return v;}
  function normalize(kind,r,previous){
    var out={id:id(r.id)},old=previous&&coreCommerceData(previous);
    if(kind==='supplier'){out.nama=text(r.nama,100,true);out.kontak=text(r.kontak,80);out.alamat=text(r.alamat,400);out.catatan=text(r.catatan,500);out.aktif=r.aktif!==false;}
    if(kind==='product'){out.nama=text(r.nama,100,true);out.kategori=text(r.kategori,80);out.model=text(r.model,80);out.warna=text(r.warna,80);out.supplierId=id(r.supplierId);if(!find('pembelian','supplier',out.supplierId))fail('Supplier tidak ditemukan.');out.harga=r.harga==null||r.harga===''?0:num(r.harga,1e12,false,true);out.catatan=text(r.catatan,500);out.aktif=r.aktif!==false;out.gambar=r.gambar===undefined&&old?old.gambar||'':sourcePicture(r.gambar);}
    if(kind==='order'||kind==='nota'){
      if(!(r.items instanceof Array)||!r.items.length||r.items.length>100)fail('Isi 1 sampai 100 baris barang.');var seen={};
      out.items=r.items.map(function(i){var x={id:id(i.id)};if(seen[x.id])fail('Identitas baris barang ganda.');seen[x.id]=true;
        if(kind==='order'){x.nama=text(i.nama,120,true);x.jumlah=num(i.jumlah,1e8,true,true);}else{x.name=text(i.name,120,true);x.size=text(i.size,40);x.color=text(i.color,60);x.qty=num(i.qty,1e8,true,true);x.price=num(i.price,1e12,false,true);x.discPercent=num(i.discPercent===undefined?0:i.discPercent,100,false,false);x.subtotal=Math.round(x.qty*x.price*(100-x.discPercent)/100);if(!Number.isSafeInteger(x.subtotal))fail('Subtotal terlalu besar.');}return x;});
      if(kind==='order'){out.produkId=id(r.produkId);var product=find('pembelian','product',out.produkId),pd=coreCommerceData(product),supplier=find('pembelian','supplier',pd.supplierId),sd=coreCommerceData(supplier);if(!product||!supplier||pd.aktif===false||sd.aktif===false)fail('Produk atau supplier pembelian tidak ditemukan atau tidak aktif.');out.productSnapshot={id:pd.id,nama:pd.nama,model:pd.model||'',warna:pd.warna||'',supplierId:pd.supplierId};out.supplierSnapshot={id:sd.id,nama:sd.nama,kontak:sd.kontak||'',alamat:sd.alamat||''};out.grupNama=text(r.grupNama,100);out.hargaSatuan=num(r.hargaSatuan,1e12,false,true);out.tanggalOrder=date(r.tanggalOrder);out.totalHarga=out.items.reduce(function(n,i){return n+i.jumlah*out.hargaSatuan;},0);out.catatan=text(r.catatan,1000);if(!Number.isSafeInteger(out.totalHarga))fail('Total terlalu besar.');}
      else{var c=r.customer||{};out.customer={name:text(c.name,120,true),phone:text(c.phone,60),address:text(c.address,400),type:c.type==='reseller'?'reseller':'walkin'};out.date=date(r.date);out.discountPercent=num(r.discountPercent===undefined?0:r.discountPercent,100,false,false);out.shipping=num(r.shipping===undefined?0:r.shipping,1e12,false,true);out.subtotal=out.items.reduce(function(n,i){return n+i.subtotal;},0);out.discountAmount=Math.round(out.subtotal*out.discountPercent/100);out.total=out.subtotal-out.discountAmount+out.shipping;out.notes=text(r.notes,1000);if(!Number.isSafeInteger(out.total))fail('Total terlalu besar.');}
      out.cancelled=old?!!old.cancelled:false;if(out.cancelled)fail('Catatan yang dibatalkan tidak dapat diubah.');
      if(previous){var current=view(previous);if(current.events.length||previous.sourceHash)fail('Pesanan/nota yang sudah mempunyai riwayat disimpan tetap. Koreksi melalui pembatalan event atau buat catatan baru.');}
    }
    return out;
  }
  function tender(payment,d){if(payment.tenderedAmount===undefined)return d;var amount=num(payment.tenderedAmount,1e15,false,true);if(d.metode!=='cash'||amount<d.jumlah)fail('Uang diterima tunai harus setidaknya sama dengan pembayaran tagihan.');d.tenderedAmount=amount;d.change=amount-d.jumlah;return d;}
  function initial(r,kind,record,me){if(kind!=='nota'&&kind!=='order')return null;var payment=r.initialPayment||r.payment;if(!payment)return null;var amount=payment.jumlah===undefined?payment.amount:payment.jumlah;if(amount===undefined||Number(amount)===0)return null;amount=num(amount,1e15,true,true);var total=kind==='nota'?record.total:record.totalHarga;if(amount>total)fail('Pembayaran tidak boleh melebihi total tagihan.');var parentDate=kind==='nota'?record.date:record.tanggalOrder,payDate=date(payment.tanggal||parentDate);if(payDate<parentDate)fail('Tanggal pembayaran awal tidak boleh sebelum pesanan/nota.');return tender(payment,{id:'initial_'+coreCommerceHash([kind,record.id]).slice(0,32),kind:'payment',tanggal:payDate,jumlah:amount,metode:text(payment.metode||payment.method||'cash',40,true),catatan:text(payment.catatan,300),createdBy:me.id,createdAt:now()});}
  function save(module,kind,p){
    var me=writable(p),r=p.record||{},key=id(r.id),old=find(module,kind,key),actor=me.id;
    var rawIntent=coreCommerceCopy(r);delete rawIntent.revision;var intent=coreCommerceHash({kind:kind,input:rawIntent,before:p.expectedRevision||''});
    if(old){var data=coreCommerceData(old);if(!p.expectedRevision&&data._createHash===intent&&data._createActor===actor)return {record:view(old)};if(data._lastMutation&&data._lastMutation.hash===intent&&data._lastMutation.actor===actor)return {record:view(old)};expected(old,p);}
    else if(p.expectedRevision)fail('Catatan asal tidak ditemukan.');
    var data=normalize(kind,r,old);if(kind==='nota'){if(old)data.noNota=coreCommerceData(old).noNota||key;else{var prefix='SA-'+data.date.replace(/-/g,'').slice(2)+'-',sequence=0;store.read('CommerceImport').forEach(function(row){sequence=Math.max(sequence,coreNum((coreCommerceData(row).summary||{}).notaCounter));});all().filter(function(row){return row.kind==='nota';}).forEach(function(row){var note=coreCommerceData(row),n=String(note.noNota||note.id||''),match=/^SA-\d{6}-(\d+)$/.exec(n);if(match)sequence=Math.max(sequence,Number(match[1]));});if(sequence>=999999)fail('Nomor nota tanggal ini penuh.');data.noNota=prefix+('000'+(sequence+1)).slice(-Math.max(3,String(sequence+1).length));}}
    if(old){var prev=coreCommerceData(old);data._createHash=prev._createHash;data._createActor=prev._createActor;if(prev._initialPayment)data._initialPayment=prev._initialPayment;}else{data._createHash=intent;data._createActor=actor;var pay=initial(r,kind,data,me);if(pay)data._initialPayment=pay;}
    data._lastMutation={hash:intent,actor:actor};var stamp=now(),row={id:coreCommerceKey(module,kind,key),module:module,kind:kind,parentId:'',data:JSON.stringify(data),revision:coreCommerceHash([data,stamp,actor]),dibuat:old?old.dibuat:stamp,dibuatOleh:old?old.dibuatOleh:actor,diubah:stamp,sourceHash:old?old.sourceHash:''};
    checkRows('CommerceRecord',[row]);if(old)store.update('CommerceRecord',old.id,row);else store.append('CommerceRecord',row);return {record:view(row)};
  }
  actions.saveCommerceSupplier=function(p){return save('pembelian','supplier',p);};
  actions.saveCommerceProduct=function(p){return save('pembelian','product',p);};
  actions.saveCommerceOrder=function(p){return save('pembelian','order',p);};
  actions.saveCommerceNota=function(p){return save('nota','nota',p);};
  function event(p,kind){
    var me=writable(p,kind==='void'),module=p.module||'pembelian';if(['pembelian','nota'].indexOf(module)<0)fail('Modul tidak dikenal.');
    var key=id(p.id),parent=id(p.parentId||p.orderId),row=find(module,module==='nota'?'nota':'order',parent),record=view(row);
    var prior=store.read('CommerceEvent').filter(function(e){return e.id===key;})[0];
    var d={tanggal:date(p.tanggal||(prior?coreCommerceData(prior).tanggal:String(ctx.env.now().toISOString()).slice(0,10))),catatan:text(p.catatan,500,kind==='void')};
    if(kind==='payment'){d.jumlah=num(p.jumlah,1e15,true,true);d.metode=text(p.metode||'cash',40,true);tender(p,d);}
    if(kind==='receipt'){if(module!=='pembelian')fail('Penerimaan hanya untuk pembelian.');d.itemId=id(p.itemId);d.jumlah=num(p.jumlah,1e8,true,true);d.kondisi=text(p.kondisi,100);}
    if(kind==='void')d.eventId=id(p.eventId);
    if(prior){if(prior.module!==module||prior.parentId!==parent||prior.kind!==kind||prior.dibuatOleh!==me.id||coreCommerceHash(coreCommerceData(prior))!==coreCommerceHash(d))fail('Identitas transaksi sudah digunakan untuk isi atau akun berbeda.');return {record:view(row)};}
    expected(row,p);if(record.cancelled)fail('Catatan sudah dibatalkan.');if(d.tanggal<String(record.tanggalOrder||record.date||'').slice(0,10))fail('Tanggal transaksi tidak boleh sebelum pesanan/nota.');
    if(kind==='payment'&&(record.paymentReview||d.jumlah>record.balance))fail('Pembayaran melebihi sisa tagihan atau riwayat nominal perlu diperiksa.');
    if(kind==='receipt'){var item=(record.items||[]).filter(function(i){return i.id===d.itemId;})[0];if(record.receiptReview||!item)fail('Hubungan varian penerimaan perlu diperiksa; tidak boleh ditebak.');if(d.jumlah>coreNum(item.jumlah)-coreNum(record.receivedByItem[d.itemId]))fail('Penerimaan melebihi sisa varian pesanan.');}
    if(kind==='void'){var source=record.events.filter(function(e){return e.id===d.eventId;})[0];if(!source||source.kind==='void'||source.voided)fail('Transaksi asal tidak ditemukan atau telah dibatalkan.');}
    var stored={id:key,module:module,parentId:parent,kind:kind,data:JSON.stringify(d),dibuat:now(),dibuatOleh:me.id,sourceHash:''};checkRows('CommerceEvent',[stored]);store.append('CommerceEvent',stored);return {record:view(row)};
  }
  actions.appendCommercePayment=function(p){return event(p,'payment');};actions.appendCommerceReceipt=function(p){return event(p,'receipt');};actions.voidCommerceEvent=function(p){return event(p,'void');};
  actions.cancelCommerceRecord=function(p){var me=writable(p,true),module=p.module;if(['pembelian','nota'].indexOf(module)<0)fail('Modul tidak dikenal.');var row=find(module,module==='nota'?'nota':'order',id(p.id)),v=view(row),reason=text(p.catatan,500,true);if(v.cancelled){if(v.cancelledBy===me.id&&v.cancelReason===reason)return {record:v};fail('Catatan sudah dibatalkan.');}expected(row,p);if(v.paymentReview||v.receipts.some(function(e){return !e.voided&&e.sourceReview;}))fail('Periksa bukti nominal atau jumlah historis sebelum membatalkan catatan.');if(v.totalPaid||v.totalReceived)fail('Batalkan transaksi pembayaran/penerimaan yang masih berlaku terlebih dahulu.');var data=coreCommerceData(row);data.cancelled=true;data.cancelReason=reason;data.cancelledBy=me.id;data.cancelledAt=now();row=Object.assign({},row,{data:JSON.stringify(data),revision:coreCommerceHash(data),diubah:now()});checkRows('CommerceRecord',[row]);store.update('CommerceRecord',row.id,row);return {record:view(row)};};
  function hppInput(config){
    var source=store.read('CommerceSource'),legacy={production:[],stock:{pembelian:[],rolInfo:{}},meta:{},cuttingPlans:[]};
    store.read('CommerceImport').filter(function(r){return r.status==='complete';}).forEach(function(manifest){var proof=coreCommerceData(manifest),subset=source.filter(function(r){return r.sourceHash===manifest.sourceHash;}).map(function(r){var out={};SCHEMA.CommerceSource.forEach(function(k){out[k]=r[k]===undefined?'':r[k];});return out;}).sort(function(a,b){return a.id.localeCompare(b.id);});if(subset.length!==proof.sourceRows||coreCommerceHash(subset)!==proof.sourceDigest)fail('Snapshot HPP asal tidak utuh atau berubah. Periksa cadangan impor sebelum menghitung.');});
    var manifestHashes={};store.read('CommerceImport').filter(function(r){return r.status==='complete';}).forEach(function(r){manifestHashes[r.sourceHash]=true;});if(source.some(function(r){return !manifestHashes[r.sourceHash];}))fail('Ada snapshot HPP tanpa manifest impor lengkap.');
    source.forEach(function(r){var data=coreCommerceData(r);if(r.kind==='hpp-production')legacy.production.push(data);if(r.kind==='hpp-purchase')legacy.stock.pembelian.push(data);if(r.kind==='hpp-rollinfo')legacy.stock.rolInfo[r.parentId]=data;if(r.kind==='hpp-meta')legacy.meta=data;if(r.kind==='hpp-plan')legacy.cuttingPlans.push(data);});
    legacy.workers=coreCommerceRows(legacy.meta.tukangJahit||legacy.meta.maklon||{});var input={config:config,legacy:legacy,tables:{},settings:ctx.settings()};['PO','Produk','Potong','SlipKirim','StokBahan','RencanaPotong','KoreksiRiwayat'].forEach(function(s){input.tables[s]=store.read(s);});return input;
  }
  actions.getCommerceState=function(p){var me=admin(p),module=p.module;if(['pembelian','nota','hpp'].indexOf(module)<0)fail('Modul tidak dikenal.');var waiting=pending();if(waiting.length)fail('Impor modul belum selesai. Owner perlu melanjutkan file yang sama sebelum modul dipakai.');var rows=all(),events=store.read('CommerceEvent'),out={module:module,version:store.version(),actor:{id:me.id,divisi:me.divisi}};
    function list(kind){return rows.filter(function(r){return r.module===module&&r.kind===kind;}).map(function(r){return coreCommerceRecordView(r,events,rows);});}
    if(module==='pembelian'){out.suppliers=list('supplier');out.products=list('product');out.orders=list('order');}
    if(module==='nota')out.notes=list('nota');
    if(module==='hpp'){var row=find('hpp','config','config');out.config=row?coreCommerceCopy(coreCommerceData(row)):{configs:{},modelConfigs:{},marketplace:{},pajak:0};['_lastMutation','_createHash','_createActor'].forEach(function(k){delete out.config[k];});out.revision=row?view(row).revision:'';if(typeof coreCommerceHpp==='function')Object.assign(out,coreCommerceHpp(hppInput(out.config)));else{out.models=[];out.warnings=['Perhitungan HPP belum tersedia.'];}}
    return out;
  };
  function saveHpp(p,settingsOnly){var me=writable(p),row=find('hpp','config','config'),current=row?coreCommerceCopy(coreCommerceData(row)):{id:'config',configs:{},modelConfigs:{},marketplace:{},pajak:0};var intent=coreCommerceHash({modelId:p.modelId,config:p.config,marketplace:p.marketplace,pajak:p.pajak,before:p.expectedRevision||''});if(current._lastMutation&&current._lastMutation.hash===intent&&current._lastMutation.actor===me.id)return {revision:view(row).revision};if(row)expected(row,p);else if(p.expectedRevision)fail('Konfigurasi asal tidak ditemukan.');
    if(settingsOnly){if(p.pajak!==undefined)current.pajak=num(p.pajak,100,false,false);if(p.marketplace!==undefined){if(!p.marketplace||typeof p.marketplace!=='object'||p.marketplace instanceof Array||Object.keys(p.marketplace).length>20)fail('Pengaturan marketplace tidak sah.');current.marketplace={};Object.keys(p.marketplace).forEach(function(k){id(k);var m=p.marketplace[k];current.marketplace[k]={nama:text(m.nama,80,true),fee:num(m.fee,100,false,false),fixedPerPcs:num(m.fixedPerPcs===undefined?0:m.fixedPerPcs,1e12,false,true)};});}}
    else{var modelId=text(p.modelId,500,true),config=p.config;if(typeof coreCommerceHpp!=='function'||typeof coreCommerceHppConfig!=='function')fail('Perhitungan HPP belum tersedia.');var model=coreCommerceHpp(hppInput(current)).models.filter(function(m){return m.id===modelId;})[0];if(!model||['__proto__','constructor','prototype'].indexOf(modelId)>=0)fail('Model HPP tidak ditemukan.');config=coreCommerceHppConfig(config,model);current.modelConfigs=current.modelConfigs||{};current.modelConfigs[modelId]=config;}
    current._lastMutation={hash:intent,actor:me.id};var stamp=now(),saved={id:coreCommerceKey('hpp','config','config'),module:'hpp',kind:'config',parentId:'',data:JSON.stringify(current),revision:coreCommerceHash(current),dibuat:row?row.dibuat:stamp,dibuatOleh:row?row.dibuatOleh:me.id,diubah:stamp,sourceHash:row?row.sourceHash:''};checkRows('CommerceRecord',[saved]);if(row)store.update('CommerceRecord',row.id,saved);else store.append('CommerceRecord',saved);return {revision:view(saved).revision};
  }
  actions.saveCommerceHpp=function(p){return saveHpp(p,false);};actions.saveCommerceHppSettings=function(p){return saveHpp(p,true);};
  actions.makeCommercePdf=function(p){admin(p);if(!ctx.env.makePdf)fail('PDF tersedia setelah aplikasi terpasang.');var module=p.module;if(['pembelian','nota'].indexOf(module)<0)fail('Jenis dokumen tidak dikenal.');if(pending().length)fail('Impor belum selesai.');var grouped=p.ids!==undefined,ids=grouped?p.ids:[p.id];if(!(ids instanceof Array)||!ids.length||ids.length>20||grouped&&module!=='pembelian')fail('Pilih 1 sampai 20 pesanan pembelian untuk PDF gabungan.');var seen={},supplierId='',records=ids.map(function(key){key=id(key);if(seen[key])fail('Pesanan gabungan tidak boleh ganda.');seen[key]=true;var record=view(find(module,module==='nota'?'nota':'order',key));if(p.expectedRevisions&&p.expectedRevisions[key]!==record.revision)fail('Pesanan berubah sejak pilihan cetak dibuka. Muat ulang dan pilih kembali.');if(grouped){var sid=(record.supplierSnapshot||{}).id;if(!sid||supplierId&&sid!==supplierId)fail('PDF gabungan harus memakai identitas supplier yang sama.');supplierId=sid;}return record;});var models=records.map(function(record){return coreCommerceSlipModel(module,record,{});}),name=grouped?'Pembelian-Gabungan.pdf':(module==='nota'?'Nota-':'Pembelian-')+p.id+'.pdf';return {base64:ctx.env.makePdf(coreSlipModelsHtml(models,ctx.settings()),name),nama:name};};
  if(typeof coreInstallCommerceMigration==='function')coreInstallCommerceMigration(actions,{store:store,env:ctx.env,auth:admin,fail:fail,fresh:fresh,pending:pending,checkRows:checkRows});
}
