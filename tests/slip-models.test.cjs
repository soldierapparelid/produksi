'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ctx=vm.createContext({});
vm.runInContext(['core.js','slip-models.js'].map(f=>fs.readFileSync(path.resolve(__dirname,'../src',f),'utf8')).join('\n'),ctx);
function call(fn,...args){ctx.args=JSON.stringify(args);return JSON.parse(vm.runInContext(`JSON.stringify(${fn}.apply(null,JSON.parse(args)))`,ctx));}
const worker={id:'sewer01',nama:'Penjahit Contoh',divisi:'jahit'};
function earning(patch={}){return {id:'setor:count01:M',earnedId:'setor:count01:M',sourceId:'count01',poId:'po01',pegawaiId:worker.id,jenis:'jahit',tanggal:'2026-10-05',total:2,rate:1000,paidQty:1,available:1,ukuran:{M:2},ref:'SS-001',issues:[],...patch};}
function state(payroll){return {settings:{ukuran:['M','L'],kopSlip:'SOLDIER'},po:[{id:'po01',nama:'Produk Contoh'}],payroll,potong:[],kasbon:[]};}

test('weekly sewing merges sizes only within the same earning event and counts each earned ID once',()=>{
  const one=earning(),two=earning({id:'setor:count01:L',earnedId:'setor:count01:L',total:3,paidQty:2,available:1,ukuran:{L:3}});
  const repair=earning({id:'repair:repair01:M',earnedId:'repair:repair01:M',qcId:'repair01',repairQcId:'base01',total:1,paidQty:0,available:1,ukuran:{M:1},ref:'SS-001 · perbaikan'});
  const result=call('coreWeeklySlipModel',state([one,two,repair,one]),worker,'2026-10-05','2026-10-11');
  assert.equal(result.model.rows.length,2);assert.equal(result.totalQty,6);assert.equal(result.totalGross,6000);
  assert.equal(result.paidAmount,3000);assert.equal(result.unpaidAmount,3000);
  assert.ok(result.model.rows.some(row=>/M\s*:?\s*2/.test(row[1])&&/L\s*:?\s*3/.test(row[1])));
  assert.ok(result.model.rows.some(row=>row[1].includes('Perbaikan')));
});

test('the earned date, worker and review status determine weekly inclusion without turning a hold into unpaid wages',()=>{
  const held=earning({id:'held',earnedId:'held',total:4,available:0,paidQty:0,ukuran:{M:4},needsReview:true,issues:['Bukti sumber belum lengkap.']});
  const over=earning({id:'over',earnedId:'over',total:1,available:0,paidQty:1,overpaidQty:2,needsReview:true,issues:[]});
  const result=call('coreWeeklySlipModel',state([earning(),held,over,earning({id:'next',earnedId:'next',tanggal:'2026-10-12'}),earning({id:'foreign',earnedId:'foreign',pegawaiId:'other'})]),worker,'2026-10-05','2026-10-11');
  assert.equal(result.totalGross,2000);assert.equal(result.unpaidAmount,1000);assert.equal(result.reviewCount,2);
  assert.equal(result.model.sections[0].rows.length,2);
  assert.match(JSON.stringify(result.model),/Bukti sumber belum lengkap/);
  assert.match(JSON.stringify(result.model),/melebihi hak setelah QC/);
});

test('pre-QC payment credit followed by next-week repair is allocated once without redating the original count',()=>{
  const setor=[{id:'count01',poId:'po01',maklonId:worker.id,tanggal:'2026-10-05',status:'diterima',ukuran:{M:10},total:10,upah:1000,workflowVersion:2}];
  const qc=[{id:'base01',poId:'po01',setorId:'count01',maklonId:worker.id,tanggal:'2026-10-06',ukuran:{M:8},total:8,perbaikan:2,perbaikanUkuran:{M:2},workflowVersion:2},
    {id:'repair01',poId:'po01',setorId:'count01',repairQcId:'base01',maklonId:worker.id,tanggal:'2026-10-12',ukuran:{M:2},total:2,perbaikan:-2,perbaikanUkuran:{M:-2},workflowVersion:2}];
  const payment=[{id:'paid01',jenis:'jahit',tanggal:'2026-10-10',items:[{sourceId:'count01',earnedId:'setor:count01:M',size:'M',total:10,rate:1000}]}];
  const payroll=call('corePayroll',[],setor,qc,payment,{});
  const first=call('coreWeeklySlipModel',state(payroll),worker,'2026-10-05','2026-10-11');
  const next=call('coreWeeklySlipModel',state(payroll),worker,'2026-10-12','2026-10-18');
  assert.equal(first.totalQty,8);assert.equal(next.totalQty,2);
  assert.equal(first.paidAmount+next.paidAmount,10000);assert.equal(first.unpaidAmount+next.unpaidAmount,0);
});

test('weekly cutting keeps original wages and labels the corrected physical quantity',()=>{
  const cutter={id:'cutter01',nama:'Pemotong',divisi:'potong'},st=state([{id:'potong:cut01',sourceId:'cut01',poId:'po01',pegawaiId:'cutter01',jenis:'potong',tanggal:'2026-10-05',total:114,rate:100,paidQty:114,available:0,ukuran:{M:114},issues:[]}]);
  st.potong=[{id:'cut01',total:144,ukuran:{M:144},historyCorrection:{original:{total:114,ukuran:{M:114}}},bahanList:[{nama:'Kain Contoh',qty:2}]}];st.stokRingkas=[{nama:'Kain Contoh',satuan:'yard'}];
  const result=call('coreWeeklySlipModel',st,cutter,'2026-10-05','2026-10-11');
  assert.equal(result.totalGross,11400);assert.equal(result.paidAmount,11400);
  assert.match(result.model.rows[0][1],/Fisik setelah koreksi 144 pcs; dasar upah awal tetap 114 pcs/);
  assert.match(JSON.stringify(result.model),/2 yard/);
});

test('weekly loans use only own dated repayments and never subtract payment receipt deductions a second time',()=>{
  const st=state([earning()]);st.upah=[{pegawaiId:worker.id,tanggal:'2026-10-05',potongan:500,dibayar:1500}];
  st.kasbon=[{id:'loan01',tipe:'kasbon',jenis:'maklon',orangId:worker.id,jumlah:1000},{id:'repay01',tipe:'cicilan',kasbonId:'loan01',tanggal:'2026-10-06',jumlah:300},{id:'adjust',tipe:'cicilan',kasbonId:'loan01',tanggal:'2026-10-06',periode:'penyesuaian',jumlah:100}];
  const result=call('coreWeeklySlipModel',st,worker,'2026-10-05','2026-10-11');
  assert.equal(result.bersih,1700);assert.equal(result.paidAmount,1000);assert.equal(result.unpaidAmount,1000);
  assert.equal(result.model.sections[0].rows.length,1);
});

test('daily salary model uses saved amounts and period repayments, never current employee rates or the remaining loan twice',()=>{
  const st={settings:{},gaji:[{karyawanId:'daily01',periode:'2026-W41',tanggal:'2026-10-05',status:'full',gaji:100000,lemburJam:2,lemburTotal:30000}],kasbon:[{id:'loan01',tipe:'kasbon',jenis:'harian',orangId:'daily01',jumlah:300000,tanggal:'2026-10-01'},{id:'repay01',tipe:'cicilan',kasbonId:'loan01',periode:'2026-W41',tanggal:'2026-10-06',jumlah:50000}]};
  const model=call('coreGajiSlipModel',st,{id:'daily01',nama:'Harian',gajiHarian:999999},'2026-W41');
  assert.equal(model.rows.length,7);assert.equal(model.rows[0][2],'Rp 100.000');
  assert.deepEqual(model.summary.find(r=>r.label==='Total diterima'),{label:'Total diterima',value:'Rp 80.000',emphasis:true});
  assert.ok(model.summary.some(r=>r.value==='Rp 250.000'));
});

test('a repayment recorded under a week name still reduces the salary slip whose date range holds it',()=>{
  const custom='custom-2026-10-05-2026-10-10';
  const st={settings:{},gaji:[{karyawanId:'daily01',periode:custom,tanggal:'2026-10-05',status:'full',gaji:132000},{karyawanId:'daily01',periode:custom,tanggal:'2026-10-06',status:'full',gaji:132000}],
    kasbon:[{id:'loan01',tipe:'kasbon',jenis:'harian',orangId:'daily01',jumlah:1600000,tanggal:'2026-07-25'},{id:'old',tipe:'cicilan',kasbonId:'loan01',periode:'2026-W40',tanggal:'2026-10-03',jumlah:100000,asal:'lama'},{id:'repay',tipe:'cicilan',kasbonId:'loan01',periode:'2026-W41',tanggal:'2026-10-10',jumlah:200000}]};
  const model=call('coreGajiSlipModel',st,{id:'daily01',nama:'Harian'},custom);
  assert.deepEqual(model.summary.map(r=>[r.label,r.value]),[['Total gaji harian','Rp 264.000'],['Pendapatan bruto','Rp 264.000'],['Potongan cicilan kasbon periode ini','− Rp 200.000'],['Total diterima','Rp 64.000'],['Sisa kasbon aktif (informasi, tidak dipotong lagi)','Rp 1.300.000']]);
  assert.equal(model.sections[0].rows.length,1);assert.equal(model.sections[0].rows[0][3],'Rp 1.300.000');
  /* the week it was named after is used when that week really has salary rows for the person */
  st.gaji.push({karyawanId:'daily01',periode:'2026-W41',tanggal:'2026-10-07',status:'full',gaji:132000});
  assert.equal(call('coreGajiSlipModel',st,{id:'daily01'},custom).summary.find(r=>r.label==='Total diterima').value,'Rp 264.000');
  assert.equal(call('coreGajiSlipModel',st,{id:'daily01'},'2026-W41').summary.find(r=>r.label==='Potongan cicilan kasbon periode ini').value,'− Rp 200.000');
});

test('which salary slip carries a repayment: its own period, else the period holding its date; old-app rows and adjustments never move',()=>{
  const p=['custom-2026-10-05-2026-10-10','custom-2026-10-01-2026-10-31','2026-W40'];
  assert.equal(call('coreCicilanPeriode',{periode:'2026-W40',tanggal:'2026-10-07'},p),'2026-W40');
  assert.equal(call('coreCicilanPeriode',{periode:'2026-W41',tanggal:'2026-10-07'},p),'custom-2026-10-05-2026-10-10','the range that starts last wins when two ranges hold the date');
  assert.equal(call('coreCicilanPeriode',{periode:'2026-W41',tanggal:'2026-10-20'},p),'custom-2026-10-01-2026-10-31');
  assert.equal(call('coreCicilanPeriode',{periode:'2026-W41',tanggal:'2026-11-20'},p),'2026-W41');
  assert.equal(call('coreCicilanPeriode',{periode:'2026-W41',tanggal:'2026-10-07',asal:'lama'},p),'2026-W41');
  assert.equal(call('coreCicilanPeriode',{periode:'penyesuaian',tanggal:'2026-10-07'},p),'');
  assert.equal(call('coreCicilanPeriode',{periode:'',tanggal:'2026-10-07'},[]),'');
});

test('the weekly wage slip writes the loan like the old app: this week\'s deduction, the net wage and what is still owed at the end of the week',()=>{
  const st=state([earning()]);
  st.kasbon=[{id:'loan01',tipe:'kasbon',jenis:'maklon',orangId:worker.id,jumlah:1000,tanggal:'2026-09-01'},{id:'r1',tipe:'cicilan',kasbonId:'loan01',tanggal:'2026-09-30',jumlah:100},{id:'r2',tipe:'cicilan',kasbonId:'loan01',tanggal:'2026-10-06',jumlah:300},{id:'r3',tipe:'cicilan',kasbonId:'loan01',tanggal:'2026-10-13',jumlah:200},
    {id:'other',tipe:'kasbon',jenis:'maklon',orangId:'someone',jumlah:5000,tanggal:'2026-09-01'},{id:'later',tipe:'kasbon',jenis:'maklon',orangId:worker.id,jumlah:700,tanggal:'2026-10-20'}];
  const week=call('coreWeeklySlipModel',st,worker,'2026-10-05','2026-10-11');
  const line=l=>(week.model.summary.find(r=>r.label===l)||{}).value;
  assert.equal(line('Potongan kasbon periode ini'),'− Rp 300');assert.equal(line('Upah bersih setelah potongan kasbon'),'Rp 1.700');assert.equal(line('Sisa kasbon setelah potongan'),'Rp 600');
  assert.equal(week.potonganKasbon,300);assert.equal(week.sisaKasbon,600);assert.equal(week.bersih,1700);
  assert.equal(week.model.sections[0].title,'Rincian potongan kasbon periode ini');
  const before=call('coreWeeklySlipModel',st,worker,'2026-09-21','2026-09-27');
  assert.equal(before.model.summary.find(r=>/^Sisa kasbon/.test(r.label)).label,'Sisa kasbon (belum dipotong periode ini)');assert.equal(before.sisaKasbon,1000);
  assert.ok(!before.model.summary.some(r=>r.label==='Potongan kasbon periode ini'));
  const none=call('coreWeeklySlipModel',state([earning()]),worker,'2026-10-05','2026-10-11');
  assert.ok(!none.model.summary.some(r=>/kasbon/i.test(r.label)),'a worker without a loan sees no loan line');
});

test('slip dates reject impossible calendar dates and invalid ISO weeks; PDF markup escapes source text',()=>{
  assert.throws(()=>call('coreWeeklySlipModel',state([]),worker,'2026-02-31','2026-03-03'),/Tanggal slip tidak valid/);
  assert.throws(()=>call('coreWeeklySlipModel',state([]),worker,'2026-01-01','2026-06-01'),/Rentang slip/);
  assert.throws(()=>call('coreGajiSlipModel',{},{id:'daily01'},'2026-W99'),/Periode gaji/);
  const model=call('coreWeeklySlipModel',state([earning()]),{...worker,nama:'<script>alert(1)</script>'},'2026-10-05','2026-10-11').model;
  const html=call('coreSlipModelsHtml',[model],{kopSlip:'SOLDIER & CO'});
  assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('SOLDIER &amp; CO'));assert.ok(!html.includes('<script>'));
});

test('a cutting slip row reads as one tidy entry: sizes on their own line and the same material from several rolls as one total',()=>{
  const cutter={id:'cut01',nama:'Pemotong Contoh',divisi:'potong'};
  const st={settings:{ukuran:['M','L'],kopSlip:'SOLDIER'},po:[{id:'po01',nama:'OBLONG CONTOH'}],kasbon:[],
    potong:[{id:'c1',poId:'po01',userId:'cut01',tanggal:'2026-10-06',total:198,ukuran:{L:198},bahanList:[{nama:'Katun Contoh',qty:25.31},{nama:'Katun Contoh',qty:23.74},{nama:'Rib Contoh',qty:1.5}]}],
    payroll:[{id:'potong:c1',earnedId:'potong:c1',sourceId:'c1',poId:'po01',pegawaiId:'cut01',jenis:'potong',tanggal:'2026-10-06',total:198,rate:900,paidQty:0,available:198,ukuran:{L:198},issues:[]}]};
  const result=call('coreWeeklySlipModel',st,cutter,'2026-10-05','2026-10-11'),row=result.model.rows[0];
  assert.deepEqual(row[1].split('\n'),['OBLONG CONTOH','Ukuran: L 198','Bahan: Katun Contoh 49,05 kg (2 rol) + Rib Contoh 1,5 kg']);
  assert.equal(result.model.summary.find(s=>s.label==='Bahan terpakai').value,'50,55 kg','the material total is unchanged by the tidier wording');
  assert.equal(result.totalGross,178200);assert.deepEqual(result.model.columns.map(c=>c.width),[13,45,11,13,18]);
  ctx.slipModel=JSON.stringify([result.model]);const page=vm.runInContext('coreSlipModelsHtml(JSON.parse(slipModel),{kopSlip:"SOLDIER"})',ctx);
  assert.match(page,/<b>OBLONG CONTOH<\/b><span class="sub">Ukuran: L 198<br>Bahan: Katun Contoh 49,05 kg \(2 rol\) \+ Rib Contoh 1,5 kg<\/span>/);assert.match(page,/\.sub\{display:block/);
  assert.match(page,/<td style="text-align:right">198 pcs<\/td>/,'single-line cells are unchanged');
});