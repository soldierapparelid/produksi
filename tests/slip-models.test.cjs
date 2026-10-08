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

test('slip dates reject impossible calendar dates and invalid ISO weeks; PDF markup escapes source text',()=>{
  assert.throws(()=>call('coreWeeklySlipModel',state([]),worker,'2026-02-31','2026-03-03'),/Tanggal slip tidak valid/);
  assert.throws(()=>call('coreWeeklySlipModel',state([]),worker,'2026-01-01','2026-06-01'),/Rentang slip/);
  assert.throws(()=>call('coreGajiSlipModel',{},{id:'daily01'},'2026-W99'),/Periode gaji/);
  const model=call('coreWeeklySlipModel',state([earning()]),{...worker,nama:'<script>alert(1)</script>'},'2026-10-05','2026-10-11').model;
  const html=call('coreSlipModelsHtml',[model],{kopSlip:'SOLDIER & CO'});
  assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('SOLDIER &amp; CO'));assert.ok(!html.includes('<script>'));
});
