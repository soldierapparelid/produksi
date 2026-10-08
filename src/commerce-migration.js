/* Additive admin commerce import. Original business snapshots stay immutable;
   source IDs are preserved and unresolved receipt references are never guessed. */
function coreCommerceImportInput(backup,reference) {
  function root(v){if(typeof v==='string')v=JSON.parse(v);return v&&v.soldier||v||{};}
  function clean(v){if(v===null||typeof v!=='object')return v;if(v instanceof Array)return v.map(clean);var out={};Object.keys(v).sort().forEach(function(k){if(!/^(pin|token|password|secret|apiKey|authDomain|databaseURL|deviceInfo)$/i.test(k))out[k]=clean(v[k]);});return out;}
  function obj(v){return typeof v==='string'?JSON.parse(v):v;}
  var b=root(backup),r=root(reference);if(b.format==='soldier-device-backup-v1')b={notaPenjualan_v1:b.data&&b.data.notaPenjualan_v1};var p=obj(b.soldier_pembelian_produk||b.pembelianProduk||{}),h=obj(b.soldier_hpp_cache_v1||b.hpp||{}),n=obj(b.notaPenjualan_v1||b.notaPenjualan||null),production=b.produksi||{},rp=r.produksi||{};
  if(b.transactions instanceof Array&&!n)n=b;
  var out={purchase:clean(p),hpp:clean(h),nota:n?clean(n):null,production:clean(production.produksi||[]),plans:clean(production.cuttingPlans||[]),stock:clean(b.stokBahan||{}),meta:{},referenceProducts:[],referenceProduction:[],referenceStock:{}};
  var meta=b.produksi_meta||r.produksi_meta||{};['jenisBahan','maklon','tarif','tarifJahit','tarifJenis','tukang','tukangJahit'].forEach(function(k){if(meta[k]!==undefined)out.meta[k]=clean(meta[k]);});
  if(reference){out.referenceProducts=clean((r.pembelianProduk||{}).produk||[]);out.referenceProduction=clean(rp.produksi||[]);out.referenceStock=clean(r.stokBahan||{});}
  return out;
}
function coreCommerceImportPlan(input,current) {
  input=input||{};current=current||{};var sourceHash=coreCommerceHash(input),batchId='commerce_'+sourceHash.slice(0,40),warnings=[],rows={CommerceSource:[],CommerceRecord:[],CommerceEvent:[]},summary={suppliers:0,products:0,orders:0,notes:0,notaCounter:Number.isSafeInteger(Number((input.nota||{}).counter))&&Number((input.nota||{}).counter)>=0?Number(input.nota.counter):0,payments:0,receipts:0,receiptReview:0,paymentReview:0,images:0,hppModels:0,hppProduction:0},seen={};
  function list(v){return coreCommerceRows(v);}
  function ident(v,fallback){var k=v===undefined||v===null?'':String(v);return k||fallback;}
  function validAmount(v){return v!==undefined&&v!==null&&v!==''&&typeof v!=='boolean'&&Number.isSafeInteger(Number(v))&&Number(v)>=0;}
  function push(table,row){var key=table+'|'+row.id;if(seen[key])throw new Error('Identitas catatan sumber ganda: impor tidak diterapkan.');seen[key]=true;rows[table].push(row);}
  function source(module,kind,id,data){push('CommerceSource',{id:coreCommerceKey(module,'source-'+kind,id),module:module,kind:kind,parentId:String(id),data:JSON.stringify(data),sourceHash:sourceHash});}
  function record(module,kind,data,raw){source(module,kind,data.id,raw);if(kind==='order'||kind==='nota')data.cancelled=!!raw.cancelled||raw.status==='batal';push('CommerceRecord',{id:coreCommerceKey(module,kind,data.id),module:module,kind:kind,parentId:'',data:JSON.stringify(data),revision:coreCommerceHash(data),dibuat:'',dibuatOleh:'legacy-import',diubah:'',sourceHash:sourceHash});}
  function event(module,parent,kind,raw,index,data){var originalId=ident(raw&&raw.id,'index:'+index),eventId=coreCommerceKey(module,kind,parent+'|'+originalId);data.sourceId=raw&&raw.id?String(raw.id):'';data.sourceIndex=index;data.sourceSnapshot=raw;push('CommerceEvent',{id:eventId,module:module,parentId:parent,kind:kind,data:JSON.stringify(data),dibuat:'',dibuatOleh:'legacy-import',sourceHash:sourceHash});summary[kind==='payment'?'payments':'receipts']++;}
  function canonical(v){if(v===null||v===undefined)return 'null';if(typeof v!=='object')return JSON.stringify(v);var keys=Object.keys(v).sort(),parts=[];keys.forEach(function(k){var s=canonical(v[k]);if(s!=='null')parts.push(JSON.stringify(k)+':'+s);});return parts.length?'{'+parts.join(',')+'}':'null';}
  var purchase=input.purchase||{},reference={};list(input.referenceProducts).forEach(function(p){if(p.id)reference[p.id]=p;});
  list(purchase.suppliers).forEach(function(raw,i){var data=coreCommerceCopy(raw);data.id=ident(raw.id,'source-supplier-'+i);record('pembelian','supplier',data,raw);summary.suppliers++;});
  list(purchase.produk||purchase.products).forEach(function(raw,i){var data=coreCommerceCopy(raw);data.id=ident(raw.id,'source-product-'+i);var ref=reference[data.id];
    if(!data.gambar&&ref&&ref.gambar){var a=coreCommerceCopy(raw),b=coreCommerceCopy(ref);delete a.gambar;delete b.gambar;delete a._hasImg;delete b._hasImg;if(canonical(a)===canonical(b)){data.gambar=ref.gambar;source('pembelian','product-image',data.id,{id:data.id,gambar:ref.gambar,identityHash:coreCommerceHash(a)});}else warnings.push('Gambar produk asal belum cocok dengan identitas produk terbaru.');}
    if(data.gambar)summary.images++;else if(data._hasImg)warnings.push('Sebagian gambar produk tidak ada di berkas sumber; data teks tetap tersedia.');record('pembelian','product',data,raw);summary.products++;
  });
  list(purchase.orders).forEach(function(raw,i){var data=coreCommerceCopy(raw);data.id=ident(raw.id,'source-order-'+i);delete data.pembayaran;delete data.penerimaan;data.items=list(raw.items).map(coreCommerceCopy);var pd=list(purchase.produk||purchase.products).filter(function(p){return p.id===data.produkId;})[0]||{},sd=list(purchase.suppliers).filter(function(s){return s.id===pd.supplierId;})[0]||{};data.productSnapshot={id:pd.id||'',nama:pd.nama||'',model:pd.model||'',warna:pd.warna||'',supplierId:pd.supplierId||''};data.supplierSnapshot={id:sd.id||'',nama:sd.nama||'',kontak:sd.kontak||'',alamat:sd.alamat||''};record('pembelian','order',data,raw);summary.orders++;
    list(raw.pembayaran).forEach(function(e,index){event('pembelian',data.id,'payment',e,index,{tanggal:String(e.tanggal||''),jumlah:coreNum(e.jumlah),metode:String(e.metode||''),catatan:String(e.catatan||e.ket||''),sourceReview:!validAmount(e.jumlah)});});
    list(raw.penerimaan).forEach(function(e,index){event('pembelian',data.id,'receipt',e,index,{tanggal:String(e.tanggal||''),jumlah:coreNum(e.jumlah),itemId:String(e.itemId||''),kondisi:String(e.kondisi||''),catatan:String(e.catatan||e.ket||''),sourceReview:!validAmount(e.jumlah)});});
  });
  if(input.nota){source('nota','nota-meta','meta',{counter:input.nota.counter});list(input.nota.transactions).forEach(function(raw,i){var data=coreCommerceCopy(raw);data.id=ident(raw.id,'source-nota-'+i);data.noNota=raw.noNota||data.id;delete data.payment;data.items=list(raw.items).map(coreCommerceCopy);record('nota','nota',data,raw);summary.notes++;var payment=raw.payment||{},amount=coreNum(payment.amount),change=coreNum(payment.change),validChange=payment.method==='cash'&&change>=0&&change<=amount;
    var paymentInvalid=Object.prototype.hasOwnProperty.call(payment,'amount')&&!validAmount(payment.amount)||Object.prototype.hasOwnProperty.call(payment,'change')&&!validAmount(payment.change);
    if(amount||change||paymentInvalid)event('nota',data.id,'payment',payment,0,{tanggal:String(raw.date||'').slice(0,10),jumlah:validChange?amount-change:amount,metode:String(payment.method||''),catatan:'Pembayaran awal dari nota asal',tenderedAmount:amount,change:change,sourceReview:paymentInvalid||change>0&&!validChange});
    list(payment.pelunasan).forEach(function(e,index){var v=e.amount===undefined?e.jumlah:e.amount;event('nota',data.id,'payment',e,index+1,{tanggal:String(e.date||e.tanggal||'').slice(0,10),jumlah:coreNum(v),metode:String(e.method||e.metode||''),catatan:String(e.notes||e.catatan||e.ket||''),sourceReview:!validAmount(v)});});
  });}else warnings.push('Berkas ini tidak memuat notaPenjualan_v1. Nota lama belum diimpor; perlu ekspor dari perangkat aplikasi asal.');
  var h=input.hpp||{};if(Object.keys(h).length){var config={id:'config',configs:coreCommerceCopy(h.configs||{}),modelConfigs:coreCommerceCopy(h.modelConfigs||{}),marketplace:coreCommerceCopy(h.marketplace||{}),pajak:coreNum(h.pajak)};record('hpp','config',config,h);summary.hppModels=Object.keys(config.modelConfigs).length;}
  var production=list(input.production),referenceProduction=list(input.referenceProduction),stock=input.stock||{};
  if(!Object.keys(stock).length&&Object.keys(input.referenceStock||{}).length){if(!production.length||canonical(input.production)!==canonical(input.referenceProduction))warnings.push('Sumber bahan HPP referensi tidak dipakai karena produksi belum terbukti identik.');else stock=input.referenceStock;}
  production.forEach(function(raw,i){source('hpp','hpp-production',ident(raw.id,'index:'+i),raw);summary.hppProduction++;});
  list(stock.pembelian).forEach(function(raw,i){source('hpp','hpp-purchase',ident(raw.id,'index:'+i),raw);});
  Object.keys(stock.rolInfo||{}).sort().forEach(function(k){source('hpp','hpp-rollinfo',k,stock.rolInfo[k]);});
  if(Object.keys(input.meta||{}).length)source('hpp','hpp-meta','meta',input.meta);
  list(input.plans).forEach(function(raw,i){source('hpp','hpp-plan',ident(raw.id,'index:'+i),raw);});
  rows.CommerceRecord.filter(function(r){return r.kind==='order'||r.kind==='nota';}).forEach(function(r){var v=coreCommerceRecordView(r,rows.CommerceEvent,rows.CommerceRecord);if(v.receiptReview)summary.receiptReview++;if(v.paymentReview)summary.paymentReview++;});
  if(summary.receiptReview)warnings.push('Penerimaan lama yang belum cocok dengan ID varian ditahan untuk diperiksa; tidak ditautkan berdasarkan nama/urutan.');
  var manifest=(current.CommerceImport||[]).filter(function(r){return r.id===batchId;})[0],others=(current.CommerceImport||[]).filter(function(r){return r.status!=='complete'&&r.id!==batchId;});
  if(others.length)throw new Error('Ada impor lain yang belum selesai. Lanjutkan berkas asal yang sama.');
  var planHash=coreCommerceHash(rows),applied=!!(manifest&&manifest.status==='complete'),pending=!!(manifest&&!applied);
  if(manifest&&(manifest.sourceHash!==sourceHash||manifest.planHash!==planHash))throw new Error('Manifest impor tidak cocok dengan berkas atau konverter saat ini.');
  if(!applied)Object.keys(rows).forEach(function(table){var existing={};(current[table]||[]).forEach(function(r){existing[r.id]=r;});rows[table].forEach(function(r){var old=existing[r.id];if(!old)return;var same=SCHEMA[table].every(function(k){return String(old[k]===undefined?'':old[k])===String(r[k]===undefined?'':r[k]);});if(!same)throw new Error('Catatan dengan ID sumber yang sama sudah memiliki isi berbeda; impor tidak menimpa data saat ini.');});});
  return {ready:true,batchId:batchId,sourceHash:sourceHash,planHash:planHash,summary:summary,warnings:Array.from(new Set(warnings)),rows:rows,applied:applied,pending:pending};
}
function coreInstallCommerceMigration(actions,ctx) {
  var tables=['CommerceSource','CommerceRecord','CommerceEvent','CommerceImport'];
  function current(){var out={};tables.forEach(function(t){out[t]=ctx.store.read(t);});return out;}
  function plan(p){return coreCommerceImportPlan(coreCommerceImportInput(p.backup,p.reference),current());}
  function output(result){return {ready:result.ready,sourceHash:result.sourceHash,planHash:result.planHash,summary:result.summary,warnings:result.warnings,applied:result.applied,pending:result.pending};}
  actions.previewCommerceImport=function(p){ctx.auth(p,true);ctx.fresh(tables);var result=plan(p);Object.keys(result.rows).forEach(function(t){ctx.checkRows(t,result.rows[t]);});return output(result);};
  actions.applyCommerceImport=function(p){var me=ctx.auth(p,true);ctx.fresh(tables);var result=plan(p);if(p.sourceHash!==result.sourceHash||p.planHash!==result.planHash)ctx.fail('Bukti preview berbeda. Periksa berkas dan jalankan preview ulang.');if(result.applied)return output(result);
    var stamp=ctx.env.now().toISOString(),sourceRows=result.rows.CommerceSource.slice().sort(function(a,b){return a.id.localeCompare(b.id);}),manifest={id:result.batchId,sourceHash:result.sourceHash,planHash:result.planHash,status:'pending',data:JSON.stringify({summary:result.summary,warnings:result.warnings,sourceRows:sourceRows.length,sourceDigest:coreCommerceHash(sourceRows)}),dibuat:stamp,dibuatOleh:me.id,diubah:stamp};
    Object.keys(result.rows).forEach(function(t){ctx.checkRows(t,result.rows[t]);});ctx.checkRows('CommerceImport',[manifest]);
    var existing=ctx.store.read('CommerceImport').filter(function(r){return r.id===result.batchId;})[0];if(existing){if(existing.dibuatOleh!==me.id)ctx.fail('Impor harus dilanjutkan oleh owner yang memulainya.');manifest=Object.assign({},existing);}else ctx.store.append('CommerceImport',manifest);
    /* Durable pending marker precedes every business row. A timeout leaves a
       retryable exact manifest, and partial data is not shown as a usable module. */
    if(ctx.store.checkpoint)ctx.store.checkpoint(['CommerceImport']);
    Object.keys(result.rows).forEach(function(t){var ids={};ctx.store.read(t).forEach(function(r){ids[r.id]=true;});var add=result.rows[t].filter(function(r){return !ids[r.id];});if(add.length){if(ctx.store.appendMany)ctx.store.appendMany(t,add);else add.forEach(function(r){ctx.store.append(t,r);});}});
    if(ctx.store.checkpoint)ctx.store.checkpoint(tables.slice(0,3));
    var after=coreCommerceImportPlan(coreCommerceImportInput(p.backup,p.reference),current());if(after.planHash!==result.planHash)ctx.fail('Hasil impor belum cocok; lanjutkan pemulihan dengan berkas yang sama.');
    Object.keys(result.rows).forEach(function(t){var found={};ctx.store.read(t).forEach(function(r){found[r.id]=r;});result.rows[t].forEach(function(row){if(!found[row.id])ctx.fail('Baris impor belum tersimpan seluruhnya. Jalankan ulang dengan berkas yang sama.');});});
    manifest.status='complete';manifest.diubah=ctx.env.now().toISOString();ctx.store.update('CommerceImport',manifest.id,manifest);result.applied=true;result.pending=false;return output(result);
  };
}
