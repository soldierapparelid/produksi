/* Pure reconciliation preview. No store, clock, network, or production writes.
   The authoritative source must replay the original import before any projection
   is proposed. Payment receipts remain immutable in LegacySettlement snapshots. */
function coreReconcileCanonical(value) {
  if (value === undefined) return 'null';
  if (value instanceof Array) return '[' + value.map(coreReconcileCanonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(function (k) { return value[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ':' + coreReconcileCanonical(value[k]); }).join(',') + '}';
  return JSON.stringify(value);
}
/* SHA-256, UTF-8 input, compatible with the browser and Apps Script V8. */
function coreReconcileSha256(text) {
  var bytes = [], s = String(text), i, c, next;
  for (i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { next = s.charCodeAt(i + 1); if (next >= 0xdc00 && next <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + next - 0xdc00; i++; } else c = 0xfffd; }
    else if (c >= 0xdc00 && c <= 0xdfff) c = 0xfffd;
    if (c < 128) bytes.push(c); else if (c < 2048) bytes.push(192 | c >> 6, 128 | c & 63); else if (c < 65536) bytes.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63); else bytes.push(240 | c >> 18, 128 | c >> 12 & 63, 128 | c >> 6 & 63, 128 | c & 63);
  }
  var bitLength = bytes.length * 8; bytes.push(128); while (bytes.length % 64 !== 56) bytes.push(0);
  var high = Math.floor(bitLength / 4294967296), low = bitLength >>> 0;
  for (i = 3; i >= 0; i--) bytes.push(high >>> (i * 8) & 255); for (i = 3; i >= 0; i--) bytes.push(low >>> (i * 8) & 255);
  var k = [1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298];
  var h = [1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225];
  function rotr(v,n) { return v >>> n | v << (32-n); }
  for (var offset = 0; offset < bytes.length; offset += 64) {
    var w = [], j; for (j = 0; j < 16; j++) { var at = offset + j * 4; w[j] = bytes[at] << 24 | bytes[at+1] << 16 | bytes[at+2] << 8 | bytes[at+3]; }
    for (j = 16; j < 64; j++) { var x = w[j-15], y = w[j-2]; w[j] = ((rotr(x,7)^rotr(x,18)^x>>>3) + w[j-16] + (rotr(y,17)^rotr(y,19)^y>>>10) + w[j-7]) | 0; }
    var a=h[0],b=h[1],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7],cc=h[2];
    for (j=0;j<64;j++) { var t1=(hh+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+k[j]+w[j])|0; var t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&cc)^(b&cc)))|0; hh=g;g=f;f=e;e=(d+t1)|0;d=cc;cc=b;b=a;a=(t1+t2)|0; }
    [a,b,cc,d,e,f,g,hh].forEach(function(v,n){h[n]=(h[n]+v)|0;});
  }
  return h.map(function(v){return ('00000000'+(v>>>0).toString(16)).slice(-8);}).join('');
}
function coreLegacyHash(value) { return coreReconcileSha256(coreReconcileCanonical(value)); }
/* Exact production replay needs worker names/IDs and their tariff history, not
   account credentials, images, device metadata, stock purchases or daily wages. */
function coreLegacySourceInput(backup) {
  var root=backup&&backup.soldier&&typeof backup.soldier==='object'?backup.soldier:(backup||{});
  function list(v) { if(typeof v==='string'){try{v=JSON.parse(v);}catch(e){return [];}}return v instanceof Array?v:v&&typeof v==='object'?Object.keys(v).sort(function(a,b){return Number(a)-Number(b)||a.localeCompare(b);}).map(function(k){return v[k];}):[]; }
  function pick(v,keys) { var o={};keys.forEach(function(k){if(v&&v[k]!==undefined)o[k]=JSON.parse(JSON.stringify(v[k]));});return o; }
  var cycleKeys=['id','cycleId','label','tanggalArsip','namaBarang','series','size','poAktif','poKet','_offlineOrderId','_offlineCustomer','_offlineDeadline','_offlineQty','bigSeller','bigSellerAt','bigSellerDate','bigSellerTanggal','deleted','isDeleted','deletedAt','cancelled','canceled','cancelledAt','canceledAt','status'];
  var eventKeys=['id','tanggal','inputAt','inputVia','inputBy','editedAt','editedBy','restoredFrom','at','createdAt','jumlah','lolos','rijek','qty','total','tarif','upah','tukangId','tukangNama','tukang','tukangJahit','workerId','assignmentId','targetTanggal','dibayar','ket','keterangan','jenisBahan','kiloan','ok','offline','perbaikan','kotor','reject','hfId','qcId','qcBatchId','gudangId','workflowVersion','countStage','autoFromCount','payrollStage','payrollCancelled','status','quantityBasis','deleted','isDeleted','deletedAt','cancelled','canceled','cancelledAt','canceledAt'];
  function event(e) { var o=pick(e,eventKeys);if(e&&e.payroll)o.payroll=pick(e.payroll,['workerId','workerName','rate','rateMissing','stage','version','source','date']);if(e&&e.bahanList)o.bahanList=list(e.bahanList).map(function(b){return pick(b,['jenis','kg']);});if(e&&e.rols)o.rols=list(e.rols).map(function(){return {};});return o; }
  function cycle(c) { var o=pick(c,cycleKeys);['potong','assignJahit','jahit','hitungFisik','qc','gudang','bsInputs','bayarJahit'].forEach(function(k){if(c&&c[k]!==undefined)o[k]=list(c[k]).filter(Boolean).map(event);});if(c&&c.arsip!==undefined)o.arsip=list(c.arsip).map(function(a){return a?cycle(a):a;});return o; }
  var meta=root.produksi_meta||{}, out={produksi:{produksi:list(root.produksi&&root.produksi.produksi).map(function(p){return p?cycle(p):p;})},produksi_meta:{tukang:list(meta.tukang).filter(Boolean).map(function(w){return pick(w,['id','nama']);}),tukangJahit:list(meta.tukangJahit).filter(Boolean).map(function(w){return pick(w,['id','nama','tarif','tarifHistory']);})}};
  if(backup&&backup._meta&&backup._meta.ts)out._meta={ts:backup._meta.ts};return out;
}
function corePlanLegacyReconciliation(backup, currentTables) {
  if(backup&&typeof backup==='object')backup=coreLegacySourceInput(backup);
  var TABLES = ['PO','Potong','SlipKirim','SlipSetor','QC','Gudang','GudangLama','LegacySettlement'];
  var CHECK = {
    PO: ['noPO','jenis','produkId','nama','series','pelanggan','deadline','ukuran','total','bahan','catatan','status','selesaiPada'],
    Potong: ['poId','userId','tanggal','ukuran','total','bahan','kg','rol','tarif','catatan','bahanList'],
    SlipKirim: ['noSlip','poId','maklonId','tanggal','target','ukuran','total','upah','catatan'],
    SlipSetor: ['noSlip','poId','maklonId','tanggal','ukuran','total','reject','upah','catatan','status'],
    QC: ['poId','maklonId','tanggal','ukuran','total','offline','perbaikan','reject','catatan','setorId'],
    Gudang: ['poId','tanggal','ukuran','total','catatan']
  };
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function arr(v) { if (typeof v === 'string') { try { v=JSON.parse(v); } catch(e) { return []; } } return v instanceof Array ? v.filter(Boolean) : v && typeof v === 'object' ? Object.keys(v).sort(function(a,b){return Number(a)-Number(b)||a.localeCompare(b);}).map(function(k){return v[k];}).filter(Boolean) : []; }
  function parsed(v) { return typeof v === 'string' ? coreParseJSON(v,{}) : (v || {}); }
  function semantic(v) { if (v == null || v === '') return ''; if (typeof v === 'string') { try { var p=JSON.parse(v); if (p && typeof p==='object') return coreReconcileCanonical(p); } catch(e){} } if(typeof v==='object')return coreReconcileCanonical(v); return String(v); }
  function hash(v) { return coreReconcileSha256(coreReconcileCanonical(v)); }
  function sortRows(rows) { var out={};Object.keys(rows).sort().forEach(function(t){out[t]=rows[t].slice().sort(function(a,b){return String(a.id).localeCompare(String(b.id));});});return out; }
  var current={}, fingerprintTables={}; TABLES.concat(['SlipUpah','Produk']).forEach(function(t){current[t]=clone(arr((currentTables||{})[t]));fingerprintTables[t]=current[t];});
  var beforeHash=hash(sortRows(fingerprintTables)), sourceHash=hash(backup), batchId='lr1_'+sourceHash.slice(0,24);
  var issues=[], reviews=[], summary={activePO:0,migratedPO:0,heldPO:0,archivedPO:0,settlements:0,settlementHolds:0};
  function result(rows, ready, alreadyApplied) { var out={beforeHash:beforeHash,sourceHash:sourceHash,batchId:batchId,rows:rows,summary:summary,issues:issues,reviews:reviews,ready:ready,alreadyApplied:!!alreadyApplied};out.planHash=hash({beforeHash:beforeHash,sourceHash:sourceHash,batchId:batchId,rows:sortRows(rows),issues:issues,reviews:reviews});return out; }
  function fail(message) { issues.push(message); return result({},false,false); }
  if (!backup || typeof backup !== 'object') return fail('Cadangan sumber belum tersedia.');
  if (!current.PO.length) return fail('Tidak ada PO impor lama untuk direkonsiliasi.');
  var markers=current.PO.map(function(p){return parsed(p.imporSumber).legacyReconciliation;});
  if (markers.every(function(m){return m&&m.sourceHash===sourceHash&&m.batchId===batchId;})) { TABLES.forEach(function(t){fingerprintTables[t]=current[t];});return result(Object.keys(fingerprintTables).filter(function(t){return TABLES.indexOf(t)>=0;}).reduce(function(o,t){o[t]=current[t];return o;},{}),true,true); }
  if (current.LegacySettlement.length || current.GudangLama.length || markers.some(Boolean)) return fail('Data sudah pernah direkonsiliasi atau bercampur versi. Gunakan sumber dan jurnal rekonsiliasi yang sama.');
  var stamp=String(backup._meta&&backup._meta.ts||'').slice(0,10), stamps=[];
  if (/^\d{4}-\d{2}-\d{2}$/.test(stamp)) stamps.push(stamp);
  current.PO.forEach(function(p){var d=String(p.dibuat||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(d)&&stamps.indexOf(d)<0)stamps.push(d);});
  stamps.sort().reverse(); if(!stamps.length)stamps.push('1970-01-01');
  function mismatches(old) { var errs=[];Object.keys(CHECK).forEach(function(t){var map={};old.rows[t].forEach(function(r){map[r.id]=r;});if(old.rows[t].length!==current[t].length)errs.push(t+': jumlah baris berbeda.');current[t].forEach(function(r){var e=map[r.id];if(!e){errs.push(t+': ID baris berbeda.');return;}if(CHECK[t].some(function(k){return semantic(r[k])!==semantic(e[k]);}))errs.push(t+': isi baris berubah.');});});return errs; }
  var replay=null, mismatch=[];
  for(var si=0;si<stamps.length;si++){var trial=convertBackupLegacyV1(backup,{stamp:stamps[si]});mismatch=mismatches(trial);if(!mismatch.length){replay=trial;stamp=stamps[si];break;}}
  if(!replay)return fail('Cadangan tidak cocok persis dengan impor v1 yang sedang tersimpan. '+Array.from(new Set(mismatch)).join(' '));
  var root=backup.soldier&&typeof backup.soldier==='object'?backup.soldier:backup;
  var items=arr(root.produksi&&root.produksi.produksi), bySku={};items.forEach(function(p){bySku[String(p.id)]=p;});
  var output={};TABLES.forEach(function(t){output[t]=[];});
  var oldMaps={}, oldTrace={};Object.keys(CHECK).forEach(function(t){oldMaps[t]={};current[t].forEach(function(r){oldMaps[t][r.id]=r;});(replay.lineage.rows[t]||[]).forEach(function(x){oldTrace[t+'|'+x.id]=x.source;});});
  function sourceKey(s) { return [s.skuId,s.siklus==='cur'?'current':s.siklus,s.field,s.entryId?('id:'+s.entryId):('index:'+s.index)].join('|'); }
  var oldBySource={};Object.keys(replay.lineage.rows).forEach(function(t){(replay.lineage.rows[t]||[]).forEach(function(x){oldBySource[t+'|'+sourceKey(x.source)]=x.id;});});
  function mark(po, mode, reason) { var p=clone(po), src=parsed(p.imporSumber);src.legacyReconciliation={version:1,sourceHash:sourceHash,batchId:batchId,mode:mode};p.imporSumber=JSON.stringify(src);p.imporVersion=2;p.imporReview=reason||'';return p; }
  function preserve(po, reason, mode) { output.PO.push(mark(po,mode,reason));['Potong','SlipKirim','SlipSetor','QC','Gudang'].forEach(function(t){output[t]=output[t].concat(current[t].filter(function(r){return r.poId===po.id;}));});if(mode==='archive')summary.archivedPO++;else{summary.heldPO++;reviews.push({poId:po.id,noPO:po.noPO,reason:reason});} }
  current.PO.forEach(function(po){
    if(po.status!=='aktif'){preserve(po,'Arsip lama dipertahankan sebagai riwayat. Rekonsiliasi diperlukan sebelum membuka kembali.','archive');return;}
    summary.activePO++;
    var cycles=replay.lineage.cycles.filter(function(c){return c.poId===po.id;}), sizeSeen={}, converted=[], problems=[];
    cycles.forEach(function(c){
      if(c.siklus!=='cur'||sizeSeen[c.ukuran]){problems.push('Siklus asal ukuran '+c.ukuran+' bertumpuk.');return;}sizeSeen[c.ukuran]=true;
      var item=bySku[c.skuId];if(!item){problems.push('SKU asal hilang.');return;}
      var p=clone(item);p.arsip=[];p.gambar='';
      var payload={produksi:{produksi:[p]},produksi_meta:root.produksi_meta||{},_meta:{ts:stamp+'T00:00:00Z'}};
      try { var v=convertBackup(payload);if(v.rows.PO.length!==1)throw new Error('Siklus asal tidak tunggal.');converted.push({cycle:c,value:v}); }
      catch(e){problems.push(c.ukuran+': '+String(e.message));}
    });
    if(problems.length){preserve(po,problems.join(' '),'review');return;}
    var next={Potong:[],SlipKirim:[],SlipSetor:[],QC:[],Gudang:[],GudangLama:[]}, provenance={}, remap={};
    converted.forEach(function(cv){var v=cv.value;(v.info.lineage||[]).forEach(function(l){provenance[l.table+'|'+l.id]=l.source;});Object.keys(next).forEach(function(t){arr(v.rows[t]).forEach(function(r){var n=clone(r),src=provenance[t+'|'+r.id]||parsed(r.imporSumber);var oldId=oldBySource[t+'|'+sourceKey(src)];if(oldId&&(t==='Potong'||t==='SlipKirim'||t==='QC'&&!r.repairQcId||t==='Gudang')){remap[r.id]=oldId;n.id=oldId;if(t==='Potong')n=clone(oldMaps.Potong[oldId]);if(t==='SlipKirim')n.noSlip=oldMaps.SlipKirim[oldId].noSlip;}n.poId=po.id;next[t].push(n);provenance[t+'|'+n.id]=src;});});});
    next.QC.forEach(function(q){q.setorId=remap[q.setorId]||q.setorId;q.repairQcId=remap[q.repairQcId]||q.repairQcId;});
    next.GudangLama.forEach(function(g){g.qcId=remap[g.qcId]||g.qcId;});
    var madePo=mark(po,'migrated',''), flow=coreWorkflow([madePo],next.Potong,next.SlipKirim,next.SlipSetor,next.QC,next.Gudang,{gudangLama:next.GudangLama,settlements:[]})[po.id];
    if(flow.issues.length){preserve(po,flow.issues.join(' '),'review');return;}
    var oldSetor=current.SlipSetor.filter(function(r){return r.poId===po.id;}), groups={};
    oldSetor.forEach(function(s){var tr=oldTrace['SlipSetor|'+s.id];if(!tr){problems.push('Asal setoran lama belum pasti.');return;}var k=tr.skuId+'|'+tr.siklus+'|'+s.maklonId+'|'+tr.ukuran;(groups[k]||(groups[k]={trace:tr,worker:s.maklonId,rows:[]})).rows.push(s);});
    if(problems.length){preserve(po,problems.join(' '),'review');return;}
    var earned=corePayroll([],next.SlipSetor,next.QC,[],{gudangLama:next.GudangLama,settlements:[]}), settlements=[];
    Object.keys(groups).sort().forEach(function(key){
      var group=groups[key], tr=group.trace, allowed={}, baseline=[];
      earned.forEach(function(e){if(e.pegawaiId!==group.worker||e.size!==tr.ukuran)return;var r=next.SlipSetor.filter(function(s){return s.id===e.sourceId;})[0];var q=String(e.sourceId).indexOf('qc:')===0?next.QC.filter(function(q){return q.id===e.sourceId.slice(3);})[0]:null;var src=r?parsed(r.imporSumber):provenance['QC|'+String(e.sourceId).replace(/^qc:/,'')]||provenance['GudangLama|'+String(e.sourceId).replace(/^gudanglama:/,'')];if(!src||String(src.skuId)!==String(tr.skuId)||src.siklus!=='current')return;if(allowed[e.sourceId])return;allowed[e.sourceId]=true;var quantity=r?coreNum(coreMap(r.ukuran)[tr.ukuran]):coreNum(e.total);if(q){var linked=next.SlipSetor.filter(function(s){return s.id===q.setorId;})[0];quantity=linked?coreNum(coreMap(linked.ukuran)[tr.ukuran]):coreNum(q.total)+coreNum(q.offline)+coreNum(q.perbaikan)+coreNum(q.reject);}baseline.push({sourceId:e.sourceId,size:tr.ukuran,qty:quantity,rate:coreNum(e.rate),originalHFid:src.field==='hitungFisik'?src.entryId:'',sourceType:src.field});});
      /* An already-paid report can still be awaiting physical counting. Freeze its
         imported pending source ID too, so accepting that SAME receipt cannot make
         the historical payment payable again. New receipt IDs remain unaffected. */
      next.SlipSetor.forEach(function(s){var src=parsed(s.imporSumber);if(s.status!=='diajukan'||s.maklonId!==group.worker||String(src.skuId)!==String(tr.skuId)||src.siklus!=='current'||allowed[s.id])return;allowed[s.id]=true;var rates=Array.from(new Set(group.rows.map(function(r){return coreNum(r.upah);})));baseline.push({sourceId:s.id,size:tr.ukuran,qty:coreNum(coreMap(s.ukuran)[tr.ukuran]),rate:rates.length===1?rates[0]:0,originalHFid:'',sourceType:'jahit',pending:true});});
      baseline.sort(function(a,b){return a.sourceId.localeCompare(b.sourceId);});
      group.rows.forEach(function(s){
        if(!s.upahId)return;
        var quantity=baseline.reduce(function(n,b){return n+b.qty;},0), rate=coreNum(s.upah), exact=group.rows.length===1&&baseline.length>0&&quantity<=coreNum(s.total)&&rate>0&&baseline.every(function(b){return b.rate===rate&&!b.pending;});
        var reasons=[];
        if(group.rows.length>1)reasons.push('Beberapa setoran lama berbagi kelompok hitungan; pembayaran per sumber belum dapat dipastikan.');
        if(!baseline.length)reasons.push('Belum ada sumber hasil hitung atau QC yang dapat dicocokkan.');
        if(baseline.some(function(b){return b.pending;}))reasons.push('Setoran lama sudah dibayar tetapi masih ada sisa yang menunggu hitung fisik.');
        if(!(rate>0)||baseline.some(function(b){return b.rate!==rate;}))reasons.push('Tarif pada pembayaran lama berbeda dari tarif sumber hitungan.');
        if(quantity>coreNum(s.total))reasons.push('Jumlah sumber dasar melebihi jumlah pada setoran pembayaran ini.');
        var reason=exact?(quantity<coreNum(s.total)?'Pembayaran lama melebihi sumber dasar yang tersedia; sisa tidak dialihkan ke hitungan baru.':''):reasons.join(' ');
        var settlement={id:'ls_'+coreReconcileSha256(batchId+'|'+s.id).slice(0,24),batchId:batchId,sourceId:s.id,poId:po.id,maklonId:s.maklonId,size:tr.ukuran,paymentRef:s.upahId,sourceSnapshot:JSON.stringify(s),poSnapshot:JSON.stringify({id:po.id,noPO:po.noPO,nama:po.nama,series:po.series}),imporSumber:JSON.stringify({skuId:tr.skuId,siklus:'current',entryId:tr.entryId||('index:'+tr.index),field:'jahit',baseline:true,index:tr.index}),baselineSources:JSON.stringify(baseline),resolution:exact?'full':'hold',allocations:JSON.stringify(exact?baseline.map(function(b){return {sourceId:b.sourceId,size:b.size,qty:b.qty};}):[]),reason:reason};
        settlements.push(settlement);if(!exact)summary.settlementHolds++;
      });
    });
    output.PO.push(madePo);Object.keys(next).forEach(function(t){output[t]=output[t].concat(next[t]);});output.LegacySettlement=output.LegacySettlement.concat(settlements);summary.migratedPO++;summary.settlements+=settlements.length;
  });
  /* No account/personnel data, settings, product master, or payment slip is replaced. */
  TABLES.forEach(function(t){var seen={};output[t].forEach(function(r){if(!r.id||seen[r.id])issues.push(t+': identitas hasil rekonsiliasi tidak unik.');seen[r.id]=true;});});
  var preservedSources={};output.SlipSetor.forEach(function(s){preservedSources[s.id]=s;});output.LegacySettlement.forEach(function(s){if(preservedSources[s.sourceId])issues.push('Setoran lama tersimpan dua kali dalam hasil rekonsiliasi.');preservedSources[s.sourceId]=parsed(s.sourceSnapshot);});
  current.SlipSetor.filter(function(s){return !!s.upahId;}).forEach(function(s){if(coreReconcileCanonical(preservedSources[s.id])!==coreReconcileCanonical(s))issues.push('Setoran yang sudah dibayar belum dipertahankan secara utuh.');});
  current.Potong.filter(function(p){return !!p.upahId;}).forEach(function(p){var matches=output.Potong.filter(function(n){return n.id===p.id;});if(matches.length!==1||coreReconcileCanonical(matches[0])!==coreReconcileCanonical(p))issues.push('Catatan potong yang sudah dibayar belum dipertahankan secara utuh.');});
  if(issues.length)return result({},false,false);
  return result(output,true,false);
}
