'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function part(a,b){const start=html.indexOf(a),end=html.indexOf(b,start+a.length);assert.ok(start>=0&&end>start,a);return html.slice(start,end);}
function ui(){
 const c=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(root,'src/core.js'),'utf8'),c);
 vm.runInContext("var S={state:{settings:{ukuran:['M','L']}}};function pos(n){return Math.max(0,Number(n)||0);}function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');}",c);
 vm.runInContext(part('function projectWorkflow(','function poSizes(')+part('function workflowFor(','function qcEntryButton(')+part('function poTahap(','function stagesHtml(')+part('function poStatusChips(','function poUkuranAktif('),c);
 return {c,run:s=>vm.runInContext(s,c),json:s=>JSON.parse(vm.runInContext('JSON.stringify('+s+')',c))};
}
function po(t={},extra={}){const sizes=Object.keys(t).length?{M:{...t,diterima:t.terima||0,rejectJahit:t.reject||0,maklon:{}}}:{};return Object.assign({id:'p',status:'aktif',agg:{total:t},workflow:{issues:[],blockingIssues:[],complete:false,ukuran:sizes,qcReviewSources:{}}},extra);}
function label(h,p){h.c.po=p;return h.json('poTahap(po)');}

test('already-cut historical 656/603 and 396/396 POs are review records, never uncut or new QC work',()=>{
 const h=ui();for(const [cut,count,qc]of [[656,656,603],[396,297,396]]){
  const p=po();p.workflow={lama:true,issues:['Catatan sumber lama tidak lengkap'],blockingIssues:[],complete:false,qcReviewSources:{old:{M:'Hubungan QC lama belum jelas'}},ukuran:{M:{potong:cut,kirim:count,diterima:count,rejectJahit:0,diajukan:0,sisaMaklon:0,siapQC:0,qcOk:qc,legacyBlockedCount:count,legacyUnlinkedQC:qc,readyQC:true,complete:false,maklon:{}}}};
  const before=JSON.stringify(p.workflow);assert.deepEqual(label(h,p),{k:'review',label:'Catatan lama perlu diperiksa',cls:'warn'});assert.equal(JSON.stringify(p.workflow),before);assert.equal(h.run('T(po).potong'),cut);assert.equal(h.run('T(po).qcOk'),qc);
  const chips=h.run('poStatusChips(po)');assert.match(chips,/PO aktif/);assert.match(chips,/Catatan lama perlu diperiksa/);assert.doesNotMatch(chips,/Belum dipotong|Siap diperiksa QC|Produksi selesai|Selesai otomatis/);assert.equal(h.run('poWarna(po)'),'review');
 }
});

test('ledger-only history with a completed cut and QC is not mislabeled uncut or completed',()=>{
 const h=ui(),p=po({potong:164,kirim:164,terima:164,qcOk:164,siapQC:0,sisaMaklon:0,siapKirim:0});p.workflow.ledgerIssues=['Catatan BigSeller ukuran lain belum cocok'];assert.equal(label(h,p).label,'Catatan lama perlu diperiksa');assert.equal(h.run('po.workflow.complete'),false);
});

test('actionable new work takes priority over a held historical source on the same PO',()=>{
 const h=ui(),p=po({potong:80,kirim:80,terima:80});p.workflow.qcReviewSources={old:{M:'Riwayat lama'}};
 p.workflow.ukuran={M:{potong:80,kirim:80,diterima:80,siapQC:30,readyQC:true,legacyBlockedCount:50,legacyUnlinkedQC:50,maklon:{}}};assert.equal(label(h,p).label,'Siap diperiksa QC');
 p.workflow.ukuran.M.siapQC=0;p.workflow.ukuran.M.diajukan=10;assert.equal(label(h,p).label,'Menunggu hitung fisik');
 p.workflow.ukuran.M.diajukan=0;p.workflow.ukuran.M.sisaMaklon=10;assert.equal(label(h,p).label,'Di maklon');
 p.workflow.ukuran.M.sisaMaklon=0;p.workflow.ukuran.M.qcPerbaikan=5;assert.equal(label(h,p).label,'Dalam perbaikan QC');
});

test('positive work evidence falls back to the furthest recorded stage without inventing ready or complete status',()=>{
 const h=ui(),cases=[
  [{potong:100,kirim:100,terima:100,qcOk:90,qcOffline:10},'qc','Sudah ada catatan QC'],
  [{potong:100,kirim:100,terima:100},'cek','Sudah dihitung'],
  [{potong:100,kirim:100,reject:100},'cek','Sudah dihitung'],
  [{potong:100,kirim:100},'maklon','Sudah ditugaskan'],
  [{potong:100},'kirim','Sudah dipotong']
 ];for(const [t,k,text]of cases){const p=po(t);delete p.workflow;const result=label(h,p);assert.equal(result.k,k);assert.equal(result.label,text);assert.equal(h.run('workflowFor(po).complete'),false);assert.doesNotMatch(h.run('poStatusChips(po)'),/Belum dipotong|Siap diperiksa QC|Produksi selesai|Selesai otomatis/);}
});

test('native zero production, genuine waiting, verified completion and cancellation preserve their existing labels',()=>{
 const h=ui();assert.equal(label(h,po()).label,'Belum dipotong');assert.equal(label(h,po({potong:40,siapKirim:40})).label,'Siap ditugaskan ke maklon');
 const waiting=po();waiting.workflow.ukuran={M:{potong:40,kirim:40,diterima:40,siapQC:40,readyQC:false,maklon:{}}};assert.equal(label(h,waiting).label,'Dihitung · QC tertahan');
 const complete=po({potong:40,kirim:40,terima:40,qcOk:40});complete.workflow.complete=true;assert.equal(label(h,complete).label,'Produksi selesai');
 complete.status='batal';assert.equal(label(h,complete).label,'Batal');
 const blocked=po({potong:40});blocked.workflow.issues=['Periksa jumlah'];blocked.workflow.blockingIssues=['Periksa jumlah'];assert.equal(label(h,blocked).label,'Perlu diperiksa');
});
