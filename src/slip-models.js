/* Pure slip models shared by browser preview and server PDF. They consume earned
   payroll and saved wages; rendering never changes payment or production rows. */
function coreSlipRange(start, end) {
  start = String(start || ''); end = String(end || '');
  if (!coreTglOk(start) || !coreTglOk(end) || coreYmdUtc(coreUtc(start)) !== start || coreYmdUtc(coreUtc(end)) !== end) throw new Error('Tanggal slip tidak valid.');
  var per = corePeriode('custom-' + start + '-' + end);
  if (!per) throw new Error('Rentang slip tidak valid, paling lama 3 bulan.');
  return per;
}
function coreSlipDate(date) {
  var months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'], m = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Number(m[3]) + ' ' + (months[Number(m[2]) - 1] || '') + ' ' + m[1] : '-';
}
function coreSlipNumber(value) { return String(Math.round(coreNum(value) * 100) / 100).replace('.', ','); }
function coreWeeklySlipModel(state, worker, start, end) {
  var per = coreSlipRange(start, end), st = state || {}, settings = st.settings || {};
  if (!worker || !worker.id || ['jahit','potong'].indexOf(worker.divisi) < 0) throw new Error('Pilih penjahit atau tukang potong.');
  var sewing = worker.divisi === 'jahit', seen = {}, groups = {}, ordered = [], review = [], poMap = {}, cutMap = {};
  (st.po || []).forEach(function (p) { poMap[p.id] = p; });
  (st.potong || []).forEach(function (r) { cutMap[r.id] = r; });
  var totals = { qty: 0, gross: 0, paid: 0, unpaid: 0, review: 0, overpaid: 0, pending: 0, missingRate: 0 };
  function name(r) { var p = poMap[r.poId] || {}; return p.nama || r.poNama || ('PO ' + (p.noPO || r.poNoPO || r.poId || '-')); }
  (st.payroll || []).forEach(function (r) {
    if (r.pegawaiId !== worker.id || r.jenis !== worker.divisi || String(r.tanggal) < per.start || String(r.tanggal) > per.end) return;
    var id = String(r.earnedId || r.id || ''); if (!id || seen['$' + id]) return; seen['$' + id] = true;
    var rate = coreNum(r.rate), qty = Math.max(0, coreNum(r.total)), bad = !!r.needsReview || (r.issues || []).length > 0 || !(rate > 0);
    var paid = Math.min(qty, Math.max(0, coreNum(r.paidQty))), available = bad ? 0 : Math.min(qty - paid, Math.max(0, coreNum(r.available)));
    if (!(rate > 0)) totals.missingRate++;
    totals.overpaid += Math.max(0, coreNum(r.overpaidQty));
    if (bad) { totals.review++; review.push([coreSlipDate(r.tanggal), name(r) + ' · ' + (r.ref || (r.repairQcId ? 'Perbaikan' : 'Pekerjaan')), coreRibuan(qty) + ' pcs', (r.issues || []).join(' · ') || (r.overpaidQty ? 'Pembayaran melebihi hak setelah QC: ' + coreRibuan(r.overpaidQty) + ' pcs.' : 'Tarif atau bukti pekerjaan perlu diperiksa.')]); return; }
    totals.qty += qty; totals.gross += qty * rate; totals.paid += paid * rate; totals.unpaid += available * rate;
    if (available > 0) totals.pending++;
    /* Size lines may merge only within the same actual earning event. Repairs
       retain their own QC receipt even on the same date as the initial count. */
    var event = r.qcId || (r.repairQcId ? r.id : ''), key = sewing ? JSON.stringify([r.tanggal,r.sourceId,r.poId,rate,event,!!r.repairQcId]) : id;
    var g = groups[key];
    if (!g) { g = groups[key] = { tanggal:r.tanggal,poId:r.poId,title:name(r),sourceId:r.sourceId,ref:r.ref || '',repair:!!r.repairQcId,total:0,rate:rate,paid:0,available:0,ukuran:{} }; ordered.push(g); }
    g.total += qty; g.paid += paid; g.available += available;
    var sizes = coreMap(r.ukuran); Object.keys(sizes).forEach(function (size) { g.ukuran[size] = coreNum(g.ukuran[size]) + coreNum(sizes[size]); });
  });
  ordered.sort(function (a, b) { return String(a.tanggal).localeCompare(String(b.tanggal)) || String(a.title).localeCompare(String(b.title)) || String(a.ref).localeCompare(String(b.ref)); });
  var loans = coreKasbon(st.kasbon || []), repayments = [], deduction = 0;
  loans.forEach(function (loan) { if (loan.jenis === 'maklon' && loan.orangId === worker.id) loan.cicilan.forEach(function (r) { if (r.periode !== 'penyesuaian' && String(r.tanggal) >= per.start && String(r.tanggal) <= per.end) { deduction += r.jumlah; repayments.push([coreSlipDate(r.tanggal),r.keterangan || loan.keterangan || 'Cicilan kasbon',coreRupiah(r.jumlah)]); } }); });
  var sections = [];
  if (repayments.length) sections.push({ title:'Rincian cicilan kasbon periode ini',columns:[{label:'Tanggal'},{label:'Keterangan'},{label:'Jumlah',align:'right'}],rows:repayments });
  if (review.length) sections.push({ title:'Perlu ditinjau — tidak masuk jumlah tersedia untuk dibayar',columns:[{label:'Tanggal',width:15},{label:'Pekerjaan',width:35},{label:'Jumlah',width:12},{label:'Catatan',width:38}],rows:review });
  var materials = {}, materialByName = {};
  (st.stokRingkas || st.bahan || []).forEach(function (b) { materialByName[coreNormBahan(b.nama)] = b; });
  var rows = ordered.map(function (g) {
    var sizeText = coreSizeText(g.ukuran, settings.ukuran), details = g.title + (sizeText ? '\n' + sizeText : '');
    if (sewing) details += '\n' + (g.repair ? 'Perbaikan · ' : '') + (g.ref || 'Hitungan/QC');
    else {
      var raw = cutMap[g.sourceId], correction = raw && raw.historyCorrection;
      if (raw) {
        var materialText = coreBahanPotong(raw).filter(function (b) { return b.qty > 0; }).map(function (b) { var unit = (materialByName[coreNormBahan(b.nama)] || {}).satuan || 'kg'; materials[unit] = coreNum(materials[unit]) + b.qty; return b.nama + ' · ' + coreSlipNumber(b.qty) + ' ' + unit; }).join(' + ');
        if (materialText) details += '\n' + materialText;
        if (correction && correction.original) details += '\nFisik setelah koreksi ' + coreRibuan(raw.total) + ' pcs; dasar upah awal tetap ' + coreRibuan(g.total) + ' pcs.';
      }
    }
    return [coreSlipDate(g.tanggal),details,coreRibuan(g.total) + ' pcs',coreRupiah(g.rate),coreRupiah(g.total * g.rate)];
  });
  var summary = [{label:sewing ? 'Jumlah pekerjaan' : 'Jumlah potongan',value:coreRibuan(totals.qty) + ' pcs'}];
  if (!sewing && Object.keys(materials).length) summary.push({label:'Bahan terpakai',value:Object.keys(materials).map(function (u) { return coreSlipNumber(materials[u]) + ' ' + u; }).join(' + ')});
  summary.push({label:'Upah pekerjaan periode ini',value:coreRupiah(totals.gross)});
  summary.push({label:'Alokasi pekerjaan sudah dibayar',value:coreRupiah(totals.paid)});
  summary.push({label:'Tersedia untuk dibayar',value:coreRupiah(totals.unpaid),emphasis:true});
  if (deduction) { summary.push({label:'Cicilan kasbon tercatat pada periode ini',value:coreRupiah(deduction)}); summary.push({label:'Upah periode setelah cicilan (ringkasan)',value:coreRupiah(totals.gross - deduction)}); }
  if (totals.review) summary.push({label:'Catatan yang perlu ditinjau',value:coreRibuan(totals.review)});
  if (totals.overpaid) summary.push({label:'Pembayaran melebihi hak setelah QC',value:coreRibuan(totals.overpaid) + ' pcs'});
  var business = settings.kopSlip || settings.namaUsaha || 'SOLDIER APPAREL';
  return { model:{layout:'weekly-a4',title:'Slip Upah ' + (sewing ? 'Jahit' : 'Potong'),reference:(sewing ? 'JHT' : 'PTG') + ' / ' + start.replace(/-/g,'') + '-' + end.replace(/-/g,'') + ' / ' + String(worker.id).slice(0,8),recipient:worker.nama || '-',recipientLabel:sewing ? 'Nama penjahit' : 'Tukang potong',period:coreSlipDate(start) + ' — ' + coreSlipDate(end),
    columns:[{label:'Tanggal',width:14},{label:'Rincian pekerjaan',width:38},{label:'Jumlah',align:'right',width:12},{label:'Tarif / pcs',align:'right',width:17},{label:'Upah',align:'right',width:19}],rows:rows,summary:summary,sections:sections,signatures:[{label:'Disiapkan oleh',name:business},{label:'Penerima',name:worker.nama || '-'}]},
    n:ordered.length + review.length,belum:totals.pending,tanpaHarga:totals.missingRate,bersih:totals.gross - deduction,totalGross:totals.gross,paidAmount:totals.paid,unpaidAmount:totals.unpaid,reviewCount:totals.review,totalQty:totals.qty };
}
function coreGajiSlipModel(state, employee, period) {
  var st = state || {}, per = corePeriode(period);
  if (!per || /^\d{4}-W/.test(String(period)) && coreMingguId(per.start) !== period) throw new Error('Periode gaji tidak valid.');
  coreSlipRange(per.start, per.end);
  var records = (st.gaji || []).filter(function (g) { return g.periode === period && g.karyawanId === employee.id; }), byDate = {}, salary = 0, overtime = 0, saturday = 0, hours = 0, saturdayHours = 0;
  records.forEach(function (g) { byDate[g.tanggal] = g; salary += coreNum(g.gaji); overtime += coreNum(g.lemburTotal); saturday += coreNum(g.sabtuTotal); hours += coreNum(g.lemburJam); saturdayHours += coreNum(g.sabtuJam); });
  var loans = coreKasbon(st.kasbon || []), repayments = [], deduction = 0, outstanding = 0;
  loans.forEach(function (loan) { if (loan.jenis !== 'harian' || loan.orangId !== employee.id) return; outstanding += loan.sisa; var running = 0; loan.cicilan.forEach(function (r) { running += r.jumlah; if (r.periode !== period) return; deduction += r.jumlah; repayments.push([coreSlipDate(loan.tanggal),(loan.keterangan || 'Kasbon') + ' · Pinjaman ' + coreRupiah(loan.jumlah) + (r.keterangan ? ' · ' + r.keterangan : ''),'− ' + coreRupiah(r.jumlah),coreRupiah(Math.max(0,loan.jumlah-running))]); }); });
  var gross = salary + overtime + saturday, summary = [{label:'Total gaji harian',value:coreRupiah(salary)}];
  if (overtime > 0) summary.push({label:'Lembur biasa (' + hours + ' jam)',value:coreRupiah(overtime)});
  if (saturday > 0) summary.push({label:'Lembur Sabtu (' + saturdayHours + ' jam)',value:coreRupiah(saturday)});
  summary.push({label:'Pendapatan bruto',value:coreRupiah(gross)});
  if (deduction > 0) summary.push({label:'Potongan cicilan kasbon periode ini',value:'− ' + coreRupiah(deduction)});
  summary.push({label:'Total diterima',value:coreRupiah(gross-deduction),emphasis:true});
  if (deduction > 0 && outstanding > 0) summary.push({label:'Sisa kasbon aktif (informasi, tidak dipotong lagi)',value:coreRupiah(outstanding)});
  var weekdays = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'], labels = {full:'Full',half:'½ Hari',absent:'Absen',off:'Libur'};
  return {layout:'four-up',title:'Slip Gaji Mingguan',reference:'GAJI / ' + period + ' / ' + String(employee.id).slice(0,8),recipient:employee.nama || '-',recipientLabel:'Karyawan' + (employee.jabatan ? ' · ' + employee.jabatan : ''),period:coreSlipDate(per.start) + ' — ' + coreSlipDate(per.end),
    columns:[{label:'Hari / tanggal',width:35},{label:'Kehadiran',width:30},{label:'Gaji harian',align:'right',width:35}],
    rows:per.dates.map(function (date) { var g=byDate[date],status=g?g.status:coreHariKe(date)===0?'off':'full',amount=g?coreNum(g.gaji):0;return [weekdays[coreHariKe(date)]+' '+coreSlipDate(date),labels[status]||'—',amount>0?coreRupiah(amount):'—']; }),summary:summary,
    sections:repayments.length?[{title:'Rincian potongan kasbon periode ini',columns:[{label:'Tanggal kasbon',width:20},{label:'Keterangan',width:40},{label:'Cicilan',align:'right',width:20},{label:'Sisa setelah cicilan',align:'right',width:20}],rows:repayments}]:[],signatures:[{label:'Disiapkan oleh',name:(st.settings||{}).kopSlip || (st.settings||{}).namaUsaha || 'SOLDIER APPAREL'},{label:'Penerima',name:employee.nama || '-'}]};
}
function coreSlipModelsHtml(models, settings) {
  if (!(models instanceof Array) || !models.length) throw new Error('Pilih minimal satu slip.');
  settings = settings || {};
  function escape(v) { return String(v == null ? '' : v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}).replace(/\n/g,'<br>'); }
  function table(columns, rows) { return '<table class="detail"><thead><tr>'+columns.map(function(c){return '<th'+(c.width?' style="width:'+Math.max(1,Math.min(100,coreNum(c.width)))+'%"':'')+'>'+escape(c.label)+'</th>';}).join('')+'</tr></thead><tbody>'+rows.map(function(row){return '<tr>'+columns.map(function(c,i){return '<td style="text-align:'+(c.align==='right'?'right':c.align==='center'?'center':'left')+'">'+escape(row[i])+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table>'; }
  function article(m) { return '<article><header><b>'+escape(settings.kopSlip||settings.namaUsaha||'SOLDIER APPAREL')+'</b><small>'+escape(settings.kopSub||settings.alamat||'')+'</small></header><p class="reference">'+escape(m.reference)+'</p><h1>'+escape(m.title)+'</h1><table class="meta"><tr><td>'+escape(m.recipientLabel)+'<br><b>'+escape(m.recipient)+'</b></td><td>Periode<br><b>'+escape(m.period)+'</b></td></tr></table>'+table(m.columns,m.rows)+(m.sections||[]).map(function(s){return '<section><h2>'+escape(s.title)+'</h2>'+table(s.columns,s.rows)+'</section>';}).join('')+'<table class="summary">'+(m.summary||[]).map(function(s){return '<tr'+(s.emphasis?' class="emphasis"':'')+'><td>'+escape(s.label)+'</td><td>'+escape(s.value)+'</td></tr>';}).join('')+'</table><table class="signatures"><tr>'+(m.signatures||[]).map(function(s){return '<td>'+escape(s.label)+'<br><br><br><b>'+escape(s.name)+'</b></td>';}).join('')+'</tr></table></article>'; }
  var pages=[],group=[];
  function flush(){if(!group.length)return;var h='<table class="four"><tr>';group.forEach(function(m,i){if(i===2)h+='</tr><tr>';h+='<td>'+article(m)+'</td>';});if(group.length%2)h+='<td></td>';h+='</tr></table>';pages.push(h);group=[];}
  models.forEach(function(m){if(m.layout==='four-up'&&m.rows.length<=8&&!(m.sections||[]).some(function(s){return s.rows.length>2;})){group.push(m);if(group.length===4)flush();}else{flush();pages.push(article(m));}});flush();
  var css='@page{size:A4;margin:12mm}body{font:10pt Arial,Helvetica,sans-serif;color:#182638;margin:0}h1{font-size:17pt;border-bottom:2px solid #233b55;padding-bottom:8px}h2{font-size:10pt;margin-top:16px}header{border-bottom:1px solid #ddd;padding-bottom:8px}header b{font-size:13pt}small{display:block;font-size:8pt}.reference{font-size:8pt;color:#555}table{width:100%;border-collapse:collapse;table-layout:fixed}.meta{margin:12px 0}.meta td{padding:5px}.detail th{background:#233b55;color:white;text-align:left}.detail th,.detail td{padding:6px;border-bottom:1px solid #ddd;word-wrap:break-word}.detail thead{display:table-header-group}.detail tr{page-break-inside:avoid}.summary{width:75%;margin:16px 0 0 auto;page-break-inside:avoid}.summary td{padding:5px;border-bottom:1px solid #ddd}.summary td:last-child{text-align:right}.emphasis{font-weight:bold;background:#edf1f6}.signatures{margin-top:18px;page-break-inside:avoid}.signatures td{text-align:center}.page{page-break-after:always}.page:last-child{page-break-after:auto}.four>tbody>tr>td{width:50%;vertical-align:top;padding:4mm;border:1px dashed #bbb}.four article{font-size:7.5pt}.four h1{font-size:12pt}.four .detail th,.four .detail td{padding:3px}.four .summary{width:100%}.four .summary td{padding:3px}';
  return '<!doctype html><html><head><meta charset="utf-8"><style>'+css+'</style></head><body>'+pages.map(function(h){return '<div class="page">'+h+'</div>';}).join('')+'</body></html>';
}
