/* Pure commerce costing. Legacy algorithms copied from soldierapparel-app
   f80e7f6c6a63f29d486f9cfce73b563ee3364bc7; no network, store, or mutations. */
var coreCommerceLegacyCost=(function(){var module={exports:{}};
/* Read-only, model-level costing. This module never rewrites production or legacy HPP data. */
(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HppModelCost=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function rows(v){return (Array.isArray(v)?v:v&&typeof v==='object'?Object.values(v):[]).filter(x=>x&&typeof x==='object'&&!Array.isArray(x));}
  function norm(v){var s=String(v==null?'':v).trim();return (s.normalize?s.normalize('NFKC'):s).replace(/\s+/g,' ').toLowerCase();}
  function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
  function stable(v){return v&&typeof v==='object'?(Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}'):JSON.stringify(v);}
  function flag(v){return v===true||v===1||v==='true';}
  function ignored(v){return flag(v.deleted)||flag(v.isDeleted)||!!v.deletedAt||flag(v.cancelled)||flag(v.canceled)||!!v.cancelledAt||!!v.canceledAt||flag(v.void)||flag(v.voided)||!!v.voidedAt||/^(deleted|cancelled|canceled|dihapus|dibatalkan|batal|void|voided)$/.test(norm(v.status));}
  function number(v){if(v==null||typeof v==='boolean'||String(v).trim()==='')return null;var n=Number(v);return Number.isFinite(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER?n:null;}
  function warn(out,text){if(!out.includes(text))out.push(text);}
  function unit(v){var n=norm(v);return {kg:'kg',kilogram:'kg',yd:'yard',yard:'yard',yards:'yard',m:'meter',meter:'meter',metre:'meter'}[n]||null;}
  function legacyId(p){return p.id!=null?String(p.id):(p.series||'')+'_'+(p.namaBarang||'')+'_'+(p.size||'');}
  // URL-safe UTF-8 base64, without browser/Node dependencies or hash collisions.
  function modelId(series,name){var raw=encodeURIComponent(JSON.stringify([norm(series),norm(name)])),bytes=[],abc='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',out='model_';for(var i=0;i<raw.length;i++){if(raw[i]==='%'){bytes.push(parseInt(raw.slice(i+1,i+3),16));i+=2;}else bytes.push(raw.charCodeAt(i));}for(var j=0;j<bytes.length;j+=3){var a=bytes[j],b=bytes[j+1],c=bytes[j+2];out+=abc[a>>2]+abc[((a&3)<<4)|((b||0)>>4)];if(b!==undefined)out+=abc[((b&15)<<2)|((c||0)>>6)];if(c!==undefined)out+=abc[c&63];}return out;}
  function materialRows(e){if(rows(e.bahanList).length)return rows(e.bahanList);return e.jenisBahan?[{jenis:e.jenisBahan,kg:e.kiloan,unit:e.unit}]:[];}
  function cycles(p){return [{source:'current',value:p}].concat(rows(p.arsip).filter(a=>!ignored(a)).map((a,i)=>({source:'archive:'+i,value:a})));}
  function costSignature(e,field){if(field!=='potong')return stable(e);return stable({tanggal:e.tanggal,jumlah:e.jumlah,tukangId:e.tukangId,cuttingPlanId:e.cuttingPlanId,materialBatchId:e.materialBatchId,materialAllocation:e.materialAllocation,bahan:materialRows(e),rols:rows(e.rols)});}
  function ledger(members,field,warnings,signature){
    var out=[],globalIds=new Map();
    members.forEach(p=>{
      var seen=new Map(),fingerprints=new Map(),history=cycles(p),tombstones=new Set();
      history.forEach(c=>rows(c.value[field]).forEach(e=>{if(ignored(e)&&e.id!=null)tombstones.add(String(e.id));}));
      history.forEach(c=>{
        var source=c.value[field];
        if(source!=null&&(typeof source!=='object'||(Array.isArray(source)?source:Object.values(source)).some(e=>e!=null&&(typeof e!=='object'||Array.isArray(e)))))warn(warnings,'Ada rincian '+field+' yang tidak terbaca lengkap.');
        rows(source).filter(e=>!ignored(e)&&!(e.id!=null&&tombstones.has(String(e.id)))).forEach(e=>{
          var id=e.id!=null&&String(e.id)!==''?String(e.id):'',sig=(signature||costSignature)(e,field),prev=id&&seen.get(id);
          if(prev){if(prev.sig!==sig)warn(warnings,'Ada catatan '+field+' dengan identitas sama tetapi isi berbeda; periksa Laporan Produksi.');return;}
          if(id){seen.set(id,{sig});var owner=globalIds.get(id);if(owner&&owner!==p)warn(warnings,'Identitas catatan '+field+' dipakai pada lebih dari satu ukuran.');globalIds.set(id,p);}
          var fp=fingerprints.get(sig);
          if(fp&&fp.source!==c.source&&(!id||!fp.id))warn(warnings,'Riwayat '+field+' lama mungkin tersalin di arsip tanpa identitas; belum dapat dipastikan.');
          fingerprints.set(sig,{source:c.source,id});out.push({entry:e,product:p,archived:c.source!=='current'});
        });
      });
    });
    return out;
  }
  function groupProducts(input,options){options=options||{};var list=rows(input&&input.produksi?input.produksi:input),plans=rows(options.cuttingPlans||(input&&!Array.isArray(input)&&input.cuttingPlans)),groups=new Map(),ids=new Map();list.filter(p=>!ignored(p)).forEach(p=>{var id=modelId(p.series,p.namaBarang);if(!groups.has(id))groups.set(id,{id,series:String(p.series||'').trim(),namaBarang:String(p.namaBarang||'').trim(),sizes:[],members:[],potong:[],warnings:[],cuttingPlans:plans,plansKnown:options.plansKnown===true||Object.prototype.hasOwnProperty.call(options,'cuttingPlans')||!!(input&&!Array.isArray(input)&&Object.prototype.hasOwnProperty.call(input,'cuttingPlans'))});var m=groups.get(id);m.members.push(p);if(p.size!=null&&!m.sizes.includes(String(p.size)))m.sizes.push(String(p.size));if(p.id!=null){var old=ids.get(String(p.id));if(old)warn(m.warnings,'Identitas produk ganda; periksa daftar produksi.');ids.set(String(p.id),p);}if(!norm(p.namaBarang))warn(m.warnings,'Nama model belum tersedia.');});groups.forEach(m=>{m.ledger=ledger(m.members,'potong',m.warnings);m.potong=m.ledger.map(x=>x.entry);m.sizes.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));var offline=new Map();m.ledger.forEach(x=>{var p=x.product,e=x.entry;if(!p._offlineOrderId||e.materialBatchId)return;var fp=stable([p._offlineOrderId,e.tanggal,e.tukangId,materialRows(e)]);if(!offline.has(fp))offline.set(fp,new Set());offline.get(fp).add(p);});if([...offline.values()].some(set=>set.size>1))warn(m.warnings,'Bahan pada potongan offline lama mungkin disalin ke beberapa ukuran.');});return [...groups.values()].sort((a,b)=>(a.series+' '+a.namaBarang).localeCompare(b.series+' '+b.namaBarang));}
  function stockUnit(stock,name){var key=String(name||'').trim().toLowerCase().replace(/[\/.#$\[\]]/g,'-'),info=stock.rolInfo&&stock.rolInfo[key];return info&&!Array.isArray(info)&&info.unit?(unit(info.unit)||'invalid'):null;}
  function selectedPlanCheck(plan,cuts,warnings,inferUnit){
    var actual=new Map(),positive=[],empty=[],epsilon=0.00001;
    function invalid(text){warn(warnings,text||'Rincian pemakaian bahan per hasil belum cocok dengan jatah; periksa Laporan Produksi.');}
    function readable(value){return value==null||typeof value==='object'&&(Array.isArray(value)?value:Object.values(value)).every(v=>v==null||typeof v==='object'&&!Array.isArray(v));}
    function rollMap(value,receipt){
      var out=new Map();if(!readable(value))invalid();
      rows(value).forEach(r=>{
        var id=String(r.purchaseId==null?'':r.purchaseId).trim(),name=norm(r.jenis||r.jenisBahan),u=inferUnit(r.unit,r.jenis||r.jenisBahan),q=number(receipt&&r.kiloan!=null?r.kiloan:r.kg);
        if(!id||!name||!u||q===null||q<=0||ignored(r)||out.has(id)){invalid();return;}
        if(receipt&&r.kg!=null&&r.kiloan!=null&&(number(r.kg)===null||Math.abs(Number(r.kg)-q)>epsilon))invalid();
        out.set(id,{name,unit:u,qty:q});
      });return out;
    }
    function equal(a,b){return a.size===b.size&&[...a].every(([key,v])=>{var other=b.get(key);return other&&other.name===v.name&&other.unit===v.unit&&Math.abs(other.qty-v.qty)<=epsilon;});}
    var assigned=rollMap(plan.rolls,false),consumed=rollMap(plan.consumedRolls,false);
    if(!assigned.size||!consumed.size)invalid('Pemakaian bahan untuk hasil potong ini belum ditemukan.');
    cuts.forEach(e=>{
      if(e.materialAllocation!=='owner-plan-selected-rolls'||!String(e.materialBatchId||'').trim())invalid('Identitas pemakaian bahan per hasil tidak sesuai.');
      var current=rollMap(e.rols,true),byMaterial=new Map(),listed=new Map();
      current.forEach((r,id)=>{
        var owner=assigned.get(id),previous=actual.get(id),key=r.name+'|'+r.unit;
        if(!owner||owner.name!==r.name||owner.unit!==r.unit)invalid('Rol atau satuan bahan hasil potong tidak sesuai jatah.');
        if(previous&&(previous.name!==r.name||previous.unit!==r.unit))invalid();
        actual.set(id,{name:r.name,unit:r.unit,qty:r.qty+(previous?previous.qty:0)});
        byMaterial.set(key,(byMaterial.get(key)||0)+r.qty);
      });
      if(!readable(e.bahanList))invalid();
      materialRows(e).forEach(b=>{
        var q=number(b.kg),name=norm(b.jenis),u=inferUnit(b.unit,b.jenis);
        if(q===null||!name||!u||ignored(b)){invalid();return;}
        if(q>0){var key=name+'|'+u;listed.set(key,(listed.get(key)||0)+q);}
      });
      if(byMaterial.size!==listed.size||[...byMaterial].some(([key,q])=>Math.abs(q-(listed.get(key)||0))>epsilon))invalid('Rincian rol tidak cocok dengan jumlah bahan pada hasil potong.');
      if(e.kiloan!=null){var kg=number(e.kiloan),totalKg=[...current.values()].reduce((n,r)=>n+(r.unit==='kg'?r.qty:0),0);if(kg===null||Math.abs(kg-totalKg)>epsilon)invalid('Jumlah kilogram hasil potong tidak cocok dengan rincian rol.');}
      if(current.size)positive.push(e);else empty.push(e);
    });
    if(!equal(actual,consumed))invalid('Jumlah bahan tercatat berbeda dari pemakaian jatah per hasil.');
    consumed.forEach((r,id)=>{var owner=assigned.get(id);if(!owner||owner.name!==r.name||owner.unit!==r.unit||r.qty>owner.qty+epsilon)invalid('Pemakaian bahan melebihi atau berbeda dari jatah pemotongan.');});
    empty.forEach(e=>{
      // CuttingPlan enforces save order. Result dates can legitimately be
      // backdated, so costing only checks for a different positive batch.
      if(!positive.some(first=>first.materialBatchId!==e.materialBatchId))invalid('Pemakaian bahan pertama untuk potongan susulan belum ditemukan.');
    });
  }
  function fabric(model,purchasesOrStock){var stock=Array.isArray(purchasesOrStock)?{pembelian:purchasesOrStock}:purchasesOrStock||{},purchases=rows(stock.pembelian).filter(p=>!ignored(p)),warnings=(model.warnings||[]).slice(),detailsMap=new Map(),totalPcs=0,totalCost=0,totalKg=0,plans=new Map(),entries=model.ledger||ledger(model.members||[model],'potong',warnings);
    function inferUnit(raw,name){if(raw!=null&&String(raw).trim())return unit(raw);var declared=stockUnit(stock,name);if(declared)return declared==='invalid'?null:declared;var candidates=new Set(purchases.filter(p=>norm(p.jenisBahan)===norm(name)&&p.unit).map(p=>unit(p.unit)));if(candidates.has(null))return null;if(candidates.size===1)return [...candidates][0];if(candidates.size>1)return null;return 'kg';}
    function purchaseUnit(p){return p.unit?unit(p.unit):stockUnit(stock,p.jenisBahan)||'kg';}
    function price(p){var q=number(p.kg),r=number(p.hargaPerKg),t=number(p.total);if(q===null||q<=0)return null;if(r!==null&&r>0){if(t!==null&&Math.abs(t-q*r)>Math.max(1,q*r*0.000001))return null;return r;}return t!==null&&t>0?t/q:null;}
    function add(name,u,qty,rate,source){if(!(qty>0))return;var key=norm(name)+'|'+u,d=detailsMap.get(key);if(!d){d={jenis:name,unit:u,qty:0,kg:0,avgHarga:0,totalCost:0,priceSources:[]};detailsMap.set(key,d);}d.qty+=qty;d.kg=d.qty;if(rate!==null){d.totalCost+=qty*rate;totalCost+=qty*rate;}if(!d.priceSources.includes(source))d.priceSources.push(source);if(u==='kg')totalKg+=qty;}
    // Validate all rolls, including ones omitted by an old bahanList. Costing
    // only matching materials must not hide an unnamed or additional roll.
    entries.forEach(({entry:e})=>{
      if(e.materialAllocation==='owner-plan-recorded-earlier')return;
      var materials=materialRows(e).filter(b=>!ignored(b)),rolls=rows(e.rols).filter(r=>!ignored(r)),listed=new Map(),actual=new Map();
      function readable(v){return v==null||typeof v==='object'&&(Array.isArray(v)?v:Object.values(v)).every(x=>x==null||typeof x==='object'&&!Array.isArray(x));}
      if(!readable(e.bahanList)||!readable(e.rols))warn(warnings,'Ada rincian bahan atau rol yang tidak terbaca lengkap.');
      materials.forEach(b=>{
        var u=inferUnit(b.unit,b.jenis),q=number(b.kg),name=norm(b.jenis);
        if(!u)warn(warnings,'Satuan bahan belum valid atau tidak dapat dipastikan.');
        if(name&&u&&q!==null&&q>0){var key=name+'|'+u;listed.set(key,(listed.get(key)||0)+q);}
        if(name&&u&&!rolls.some(r=>norm(r.jenis||r.jenisBahan)===name&&r.purchaseId!=null)){
          var found=purchases.filter(p=>norm(p.jenisBahan)===name&&purchaseUnit(p)===u);
          if(!found.length||found.some(p=>price(p)===null))warn(warnings,'Harga pembelian '+String(b.jenis).trim()+' ('+u+') belum lengkap.');
        }
      });
      rolls.forEach(r=>{
        var name=String(r.jenis||r.jenisBahan||'').trim(),u=inferUnit(r.unit,name),q=number(r.kiloan==null?r.kg:r.kiloan);
        if(!name||q===null||q<=0)warn(warnings,'Ada rol tanpa nama atau jumlah bahan yang valid.');
        if(!u)warn(warnings,'Satuan rol belum valid atau tidak dapat dipastikan.');
        if(r.kg!=null&&r.kiloan!=null&&(number(r.kg)===null||number(r.kiloan)===null||Math.abs(Number(r.kg)-Number(r.kiloan))>0.00001))warn(warnings,'Rincian jumlah rol belum konsisten.');
        // A malformed material row must not hide an unresolved purchase link.
        // Validate identity and price before returning for its name/quantity.
        if(r.purchaseId!=null){
          var found=purchases.filter(p=>String(p.id)===String(r.purchaseId)),p=found[0];
          if(found.length!==1||!name||!u||norm(p.jenisBahan)!==norm(name)||purchaseUnit(p)!==u||price(p)===null)warn(warnings,'Harga atau satuan rol '+(name||'tanpa nama')+' belum dapat dicocokkan dengan pembelian.');
        }
        if(!name||!u||q===null||q<=0)return;
        var key=norm(name)+'|'+u;actual.set(key,(actual.get(key)||0)+q);
        // Check prices even when a material mismatch would otherwise return
        // early. A missing price is never an exclusion reason for reference.
        if(r.purchaseId==null&&!listed.has(key)){
          var matching=purchases.filter(p=>norm(p.jenisBahan)===norm(name)&&purchaseUnit(p)===u);
          if(!matching.length||matching.some(p=>price(p)===null))warn(warnings,'Harga pembelian '+name+' ('+u+') belum lengkap.');
        }
      });
      if(rolls.length&&(actual.size!==listed.size||[...actual].some(([key,q])=>Math.abs(q-(listed.get(key)||0))>0.00001)))warn(warnings,'Rincian rol tidak cocok dengan jumlah bahan.');
    });
    entries.forEach(({entry:e})=>{var qty=number(e.jumlah);if(qty===null||!Number.isSafeInteger(qty)||qty<=0){warn(warnings,'Ada jumlah hasil potong yang belum valid.');return;}totalPcs+=qty;if(e.cuttingPlanId){var k=String(e.cuttingPlanId);if(!plans.has(k))plans.set(k,[]);plans.get(k).push(e);}if(e.materialAllocation==='owner-plan-recorded-earlier'){if(materialRows(e).some(b=>Number(b.kg)>0)||rows(e.rols).some(r=>Number(r.kiloan==null?r.kg:r.kiloan)>0))warn(warnings,'Potongan susulan masih memiliki bahan; pemakaian perlu diperiksa.');return;}var materials=materialRows(e).filter(b=>!ignored(b));if(e.materialAllocation==='owner-plan-selected-rolls'&&!e.cuttingPlanId)warn(warnings,'Identitas jatah untuk pemakaian bahan per hasil belum tersedia.');if(e.materialAllocation==='owner-plan-selected-rolls'&&!materials.some(b=>Number(b.kg)>0)&&!rows(e.rols).some(r=>Number(r.kiloan==null?r.kg:r.kiloan)>0))return;if(!materials.length){warn(warnings,'Ada hasil potong tanpa rincian bahan.');return;}var rolls=rows(e.rols).filter(r=>!ignored(r));materials.forEach(b=>{var q=number(b.kg),u=inferUnit(b.unit,b.jenis),name=String(b.jenis||'').trim();if(!name||q===null||q<=0||!u){warn(warnings,'Nama, jumlah, atau satuan bahan belum valid.');return;}var matching=rolls.filter(r=>norm(r.jenis||r.jenisBahan||'')===norm(name));var withLinks=matching.filter(r=>r.purchaseId!=null);if(withLinks.length){var total=matching.reduce((n,r)=>n+(number(r.kiloan==null?r.kg:r.kiloan)||0),0);var matchingMaterialQty=materials.filter(other=>norm(other.jenis)===norm(name)&&(inferUnit(other.unit,other.jenis)===u)).reduce((n,other)=>n+(number(other.kg)||0),0);if(materials.indexOf(b)!==materials.findIndex(other=>norm(other.jenis)===norm(name)&&inferUnit(other.unit,other.jenis)===u))return;if(Math.abs(total-matchingMaterialQty)>0.00001||withLinks.length!==matching.length){warn(warnings,'Rincian rol tidak cocok dengan jumlah bahan '+name+'.');add(name,u,matchingMaterialQty,null,'belum-lengkap');return;}matching.forEach(r=>{var rq=number(r.kiloan==null?r.kg:r.kiloan),ru=inferUnit(r.unit,name),found=purchases.filter(p=>String(p.id)===String(r.purchaseId));var p=found[0],rate=found.length===1?price(p):null;if(!p||found.length!==1||norm(p.jenisBahan)!==norm(name)||purchaseUnit(p)!==u||ru!==u||rq===null||rate===null){warn(warnings,'Harga atau satuan rol '+name+' belum dapat dicocokkan dengan pembelian.');rate=null;}add(name,u,rq||0,rate,'rol-pembelian');});}else{var found=purchases.filter(p=>norm(p.jenisBahan)===norm(name)&&purchaseUnit(p)===u),pq=0,pc=0,invalid=false;found.forEach(p=>{var pr=price(p),amount=number(p.kg);if(pr===null||amount===null){invalid=true;return;}pq+=amount;pc+=amount*pr;});var rate=!invalid&&pq>0?pc/pq:null;if(rate===null)warn(warnings,'Harga pembelian '+name+' ('+u+') belum lengkap.');add(name,u,q,rate,'rata-rata-pembelian');}});});
    plans.forEach((cuts,id)=>{var found=rows(model.cuttingPlans).filter(p=>String(p.id)===id),plan=found[0];if(!plan||found.length!==1){warn(warnings,'Status jatah bahan belum terbaca; tunggu data lengkap sebelum memakai HPP.');return;}if(plan.status!=='used')warn(warnings,plan.status==='in_progress'?'Hasil potong bertahap belum selesai; rata-rata kain masih sementara.':'Status jatah bahan tidak sesuai hasil potong.');if(plan.materialMode==='per-result-v1'){selectedPlanCheck(plan,cuts,warnings,inferUnit);return;}if(cuts.some(e=>e.materialAllocation==='owner-plan-selected-rolls'))warn(warnings,'Mode pemakaian bahan per hasil tidak cocok dengan jatah.');var initial=cuts.filter(e=>e.materialAllocation!=='owner-plan-recorded-earlier');if(!initial.length)warn(warnings,'Pemakaian bahan pertama untuk potongan susulan belum ditemukan.');if(plan.usedBatchId&&initial.some(e=>e.materialBatchId!==plan.usedBatchId))warn(warnings,'Identitas pemakaian bahan jatah tidak sesuai.');var actual=new Map(),wanted=new Map();initial.forEach(e=>rows(e.rols).forEach(r=>{var key=String(r.purchaseId)+'|'+(unit(r.unit)||'kg');actual.set(key,(actual.get(key)||0)+(number(r.kiloan==null?r.kg:r.kiloan)||0));}));rows(plan.rolls).forEach(r=>{var key=String(r.purchaseId)+'|'+(unit(r.unit)||'kg');wanted.set(key,(wanted.get(key)||0)+(number(r.kg)||0));});if(actual.size!==wanted.size||[...wanted].some(([key,value])=>Math.abs(value-(actual.get(key)||0))>0.00001))warn(warnings,'Jumlah bahan tercatat berbeda dari jatah pemotongan.');});
    plans.forEach((cuts,id)=>{var plan=rows(model.cuttingPlans).find(p=>String(p.id)===id);if(!plan||plan.status!=='used')return;var present=new Set(entries.filter(x=>String(x.entry.cuttingPlanId)===id&&number(x.entry.jumlah)>0).map(x=>String(x.product.id)));if(rows(plan.products).some(ref=>!present.has(String(ref.id))))warn(warnings,'Ada ukuran dari jatah selesai yang hasil potongnya belum ditemukan.');});
    if(!totalPcs)warn(warnings,'Belum ada jumlah hasil potong untuk model ini.');if(!detailsMap.size)warn(warnings,'Belum ada biaya kain yang dapat dihitung.');if(!Number.isFinite(totalCost)||totalCost>Number.MAX_SAFE_INTEGER||!Number.isSafeInteger(totalPcs)){warn(warnings,'Nilai biaya atau jumlah pcs melebihi batas perhitungan.');totalCost=0;}
    var details=[...detailsMap.values()].map(d=>Object.assign(d,{avgHarga:d.qty?d.totalCost/d.qty:0,priceSource:d.priceSources.join(', ')}));return {perPcs:totalPcs?totalCost/totalPcs:0,totalCost,totalPcs,totalKg,details,complete:warnings.length===0,warnings};
  }
  function reference(model,stock){
    var warnings=(model.warnings||[]).slice(),entries=model.ledger||ledger(model.members||[model],'potong',warnings),parents=entries.map((_,i)=>i),keys=new Map();
    function find(i){while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;}
    function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
    function linked(e){return [e.cuttingPlanId,e.materialBatchId,e.materialAllocation].some(v=>v!=null&&String(v).trim()!=='');}
    // Plan and material batch form connected components: a zero-material
    // continuation is assessed together with every receipt for its allowance.
    entries.forEach(({entry:e},i)=>['cuttingPlanId','materialBatchId'].forEach(field=>{
      if(e[field]==null||String(e[field]).trim()==='')return;
      var key=field+':'+String(e[field]);if(keys.has(key))parents[find(i)]=find(keys.get(key));else keys.set(key,i);
    }));
    var grouped=new Map();entries.forEach((row,i)=>{var key=find(i);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(row);});
    var components=[...grouped.values()].map(group=>({group,cost:fabric(Object.assign({},model,{ledger:group,warnings:[]}),stock)})),newest='';
    components.forEach(({group,cost})=>{if(cost.complete&&group.every(x=>validDate(x.entry.tanggal)))group.forEach(x=>{if(x.entry.tanggal>newest)newest=x.entry.tanggal;});});
    var materialWarnings=new Set(['Ada hasil potong tanpa rincian bahan.','Belum ada biaya kain yang dapat dihitung.','Nama, jumlah, atau satuan bahan belum valid.','Ada rol tanpa nama atau jumlah bahan yang valid.','Rincian jumlah rol belum konsisten.','Rincian rol tidak cocok dengan jumlah bahan.']);
    function materialOnly(cost){return cost.warnings.length>0&&cost.warnings.every(w=>materialWarnings.has(w)||/^Rincian rol tidak cocok dengan jumlah bahan .+\.$/.test(w));}
    var omitted=new Set(),excluded=[];
    components.forEach(({group,cost})=>{
      if(warnings.length||!newest||group.length!==1||!materialOnly(cost))return;
      var row=group[0],e=row.entry,q=number(e.jumlah);
      if(linked(e)||q===null||!Number.isSafeInteger(q)||q<=0||!validDate(e.tanggal)||e.tanggal>=newest)return;
      omitted.add(row);excluded.push({tanggal:e.tanggal,size:String(row.product.size||''),jumlah:q,reason:cost.warnings.filter(w=>w!=='Belum ada biaya kain yang dapat dihitung.').join(' ')});
    });
    var includedEntries=entries.filter(row=>!omitted.has(row));
    // Preserve original model/ledger warnings and validate the full remaining
    // model again, including completed-plan size coverage and shared batches.
    var result=fabric(Object.assign({},model,{ledger:includedEntries,warnings}),stock),allPcs=entries.reduce((sum,x)=>{var q=number(x.entry.jumlah);return sum+(q!==null&&Number.isSafeInteger(q)&&q>0?q:0);},0);
    return Object.assign(result,{basis:{allPcs,includedPcs:result.totalPcs,excludedPcs:excluded.reduce((sum,x)=>sum+x.jumlah,0),includedCount:includedEntries.length,excluded,policy:'complete-legacy-v1'},includedEntries});
  }
  function config(model,hppData){var data=hppData||{},direct=data.modelConfigs&&data.modelConfigs[model.id];if(direct&&typeof direct==='object')return {value:clone(direct),source:'model',complete:true,warnings:[]};var configs=(model.members||[]).map(p=>data.configs&&data.configs[legacyId(p)]).filter(c=>c&&typeof c==='object');if(!configs.length)return {value:null,source:'none',complete:false,warnings:[]};if(new Set(configs.map(stable)).size>1)return {value:null,source:'legacy-conflict',complete:false,warnings:['Pengaturan HPP lama berbeda antarukuran. Tetapkan biaya model sekali; data lama tetap disimpan.']};return {value:clone(configs[0]),source:'legacy-compatible',complete:true,warnings:[]};}
  function cutting(model,meta,reference){
    var warnings=[],totalCost=0,totalPcs=0,details=[],sources=new Set();
    meta=meta||{};
    // Match Potong Command's precedence exactly: full name, shorter prefixes,
    // then its legacy sanitized/raw series|name override. Never match by size.
    function currentRate(p){
      var name=String(p.namaBarang||'').trim(),words=name.split(/\s+/),keys=name?[name]:[];
      for(var i=words.length-1;i>=1;i--)keys.push(words.slice(0,i).join(' '));
      for(var key of keys){var value=number((meta.tarifJenis||{})[key]);if(value!==null&&value>0)return value;}
      var raw=(p.series||'')+'|'+(p.namaBarang||''),safe=raw.replace(/[.#$\/\[\]]/g,'_');
      var legacy=number((meta.tarif||{})[safe]||(meta.tarif||{})[raw]);
      return legacy!==null&&legacy>0?legacy:null;
    }
    var cuts=ledger(model.members||[model],'potong',warnings,e=>stable({cut:costSignature(e,'potong'),tarif:e.tarif,total:e.total}));
    if(reference){
      (model.warnings||[]).forEach(w=>warn(warnings,w));
      if(!Array.isArray(reference.includedEntries)){warn(warnings,'Acuan hasil potong untuk HPP belum tersedia.');cuts=[];}
      else cuts=cuts.filter(x=>reference.includedEntries.some(r=>r.entry===x.entry&&r.product===x.product));
    }
    cuts.forEach(({entry:e,product:p})=>{
      var q=number(e.jumlah),rate=number(e.tarif),total=number(e.total),cost=null,source='';
      if(q===null||!Number.isSafeInteger(q)||q<=0){warn(warnings,'Jumlah hasil potong belum valid untuk menghitung upah.');return;}
      totalPcs+=q;
      if((e.tarif!=null&&rate===null)||(e.total!=null&&total===null)){
        warn(warnings,'Tarif atau total upah potong tercatat tidak valid; periksa Potong Command.');
      }else if(total!==null&&total>0){
        if(rate!==null&&rate>0&&Math.abs(total-q*rate)>Math.max(1,Math.abs(q*rate)*0.000001))warn(warnings,'Total upah potong berbeda dari jumlah pcs × tarif; periksa Potong Command.');
        else {cost=total;source='total-tercatat';}
      }else if(rate!==null&&rate>0){
        if(total===0)warn(warnings,'Tarif potong ada tetapi total upah tercatat nol; periksa Potong Command.');
        else {cost=q*rate;source='tarif-tercatat';}
      }else{
        var current=currentRate(p);
        if(current!==null){cost=q*current;source='tarif-saat-ini';}
        else warn(warnings,'Tarif potong belum tersedia untuk '+String(p.namaBarang||'model ini')+'. Isi tarif di Potong Command.');
      }
      if(cost!==null){
        if(!Number.isFinite(cost)||cost>Number.MAX_SAFE_INTEGER)warn(warnings,'Nilai upah potong melebihi batas perhitungan.');
        else {totalCost+=cost;sources.add(source);details.push({tanggal:e.tanggal||'',size:p.size||'',jumlah:q,tarif:cost/q,totalCost:cost,source});}
      }
    });
    if(!totalPcs)warn(warnings,'Belum ada hasil potong untuk menghitung rata-rata upah.');
    if(!Number.isSafeInteger(totalPcs)||!Number.isFinite(totalCost)||totalCost>Number.MAX_SAFE_INTEGER){warn(warnings,'Jumlah atau biaya potong melebihi batas perhitungan.');totalCost=0;}
    var source=sources.has('tarif-saat-ini')?(sources.size>1?'Upah tercatat + perkiraan tarif Potong saat ini':'Perkiraan tarif Potong Command saat ini'):
      sources.has('total-tercatat')?'Upah potong tercatat · rata-rata seluruh hasil':sources.has('tarif-tercatat')?'Tarif potong tercatat · rata-rata seluruh hasil':'Belum ada biaya potong';
    if(reference)source=source.replace('rata-rata seluruh hasil','rata-rata acuan HPP')+' · sesuai hasil potong acuan HPP';
    return Object.assign({perPcs:totalPcs?totalCost/totalPcs:0,totalCost,totalPcs,complete:!!totalPcs&&!warnings.length,warnings,source,details},reference?{basis:reference.basis}:{});
  }
  function sewing(model,workers){
    var warnings=[],list=rows(workers&&workers.tukangJahit?workers.tukangJahit:workers).filter(w=>!ignored(w));
    function rate(w,p){if(!w||!w.tarif)return null;var raw=(p.series||'')+'|'+(p.namaBarang||''),safe=raw.replace(/[.#$\/\[\]]/g,'_'),v=number(w.tarif[safe]!==undefined?w.tarif[safe]:w.tarif[raw]);return v!==null&&v>0?v:null;}
    var assignments=[];
    (model.members||[]).filter(p=>p.arsip!==true||flag(p.poAktif)).forEach(p=>{
      var seen=new Map();
      rows(p.assignJahit).filter(a=>!ignored(a)).forEach(a=>{
        var q=number(a.qty),id=a.id!=null?String(a.id):'',previous=id&&seen.get(id);
        if(q===null||!Number.isSafeInteger(q)){warn(warnings,'Jumlah penugasan jahit belum valid.');return;}
        if(previous){if(stable(previous)!==stable(a))warn(warnings,'Identitas penugasan jahit ganda dengan isi berbeda.');return;}
        if(id)seen.set(id,a);
        if(q>0)assignments.push({p,a});
      });
    });
    var totalCost=0,totalPcs=0;
    if(assignments.length){assignments.forEach(({p,a})=>{var matches=list.filter(w=>String(w.id)===String(a.tukangId)),r=matches.length===1?rate(matches[0],p):null,q=number(a.qty);if(r===null)warn(warnings,'Tarif jahit saat ini belum tersedia untuk semua penugasan model.');else totalCost+=r*q;totalPcs+=q;});return {perPcs:totalPcs?totalCost/totalPcs:0,totalCost,totalPcs,complete:!warnings.length,warnings,source:'Tarif jahit saat ini · rata-rata sesuai jumlah penugasan'};}
    var rates=[];list.forEach(w=>{var values=new Set((model.members||[model]).map(p=>rate(w,p)).filter(v=>v!==null));if(values.size>1)warn(warnings,'Tarif nama model yang sama berbeda; periksa tarif jahit.');values.forEach(v=>rates.push(v));});if(rates.length){if(new Set(rates).size>1)warn(warnings,'Tarif berbeda antarpenjahit. Pilih biaya jahit model sebelum memakai rekomendasi.');return {perPcs:warnings.length?0:rates[0],totalCost:0,totalPcs:0,complete:!warnings.length,warnings,source:'Tarif jahit saat ini'};}
    var historic=ledger(model.members||[model],'jahit',warnings);historic.forEach(({entry:e})=>{var q=number(e.jumlah),r=number(e.tarif);if(q===null||q<=0||r===null||r<=0){warn(warnings,'Tarif atau jumlah pada riwayat jahit belum lengkap.');return;}totalCost+=q*r;totalPcs+=q;});if(!totalPcs)warn(warnings,'Tarif jahit belum tersedia; isi biaya jahit per pcs.');return {perPcs:totalPcs?totalCost/totalPcs:0,totalCost,totalPcs,complete:!!totalPcs&&!warnings.length,warnings,source:totalPcs?'Riwayat tarif jahit · bukan tarif terbaru':'Belum ada tarif jahit'};
  }
  return {groupProducts,fabric,reference,config,sewing,cutting,modelId,norm};
});

return module.exports;}());
var coreCommerceLegacyPrice=(function(){var module={exports:{}};
/* Pure price simulation. Tax percentages are user estimates, not filing advice. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HppPrice = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var MAX = Number.MAX_SAFE_INTEGER;
  var labels = { hpp: 'HPP', price: 'Harga jual', margin: 'Target margin', fee: 'Biaya marketplace', tax: 'Estimasi pajak', fixed: 'Biaya tetap per pcs', profit: 'Target untung per pcs' };
  function fields(input, names) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Isian simulasi belum valid.';
    for (var i = 0; i < names.length; i += 1) {
      var name = names[i], value = input[name];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return labels[name] + ' harus angka nol atau lebih yang valid.';
      if (name !== 'fee' && name !== 'tax' && name !== 'margin' && value > MAX) return labels[name] + ' melampaui batas perhitungan rupiah yang aman.';
    }
    return '';
  }
  function money(value) {
    if (!Number.isFinite(value) || Math.abs(value) > MAX) throw new RangeError('Hasil simulasi melampaui batas perhitungan rupiah yang aman.');
    return value === 0 ? 0 : value;
  }
  function roundedPrice(base, divisor) {
    if (!Number.isFinite(divisor) || divisor <= 0) throw new RangeError('Sisa persentase harga harus lebih dari nol.');
    return money(Math.ceil(money(base / divisor) / 100) * 100);
  }
  function invalidQuote(error) {
    return { valid: false, recommended: null, breakEven: null, profit: null, feeAmount: null, taxAmount: null, fixed: null, marginActual: null, error: error };
  }
  // Inputs are per piece. The caller converts any per-order charge to fixed/pcs.
  // HPP and costs may be fractional; only recommended sale prices round up to
  // the next Rp100. Margin is a percentage of selling price, not markup on HPP.
  // At price 0 the signed profit is defined, but marginActual is null.
  function quote(input) {
    var error = fields(input, ['hpp', 'price', 'margin', 'fee', 'tax', 'fixed']);
    if (error) return invalidQuote(error);
    var combined = input.fee + input.tax + input.margin;
    if (!Number.isFinite(combined) || combined >= 100) return invalidQuote('Jumlah biaya marketplace, estimasi pajak, dan target margin harus kurang dari 100%.');
    try {
      var base = money(input.hpp + input.fixed);
      var feeAmount = money(input.price * (input.fee / 100));
      var taxAmount = money(input.price * (input.tax / 100));
      var profit = money(input.price - feeAmount - taxAmount - base);
      var marginActual = input.price === 0 ? null : profit / input.price * 100;
      if (marginActual !== null && !Number.isFinite(marginActual)) throw new RangeError('Persentase hasil simulasi melampaui batas perhitungan yang aman.');
      return {
        valid: true,
        recommended: roundedPrice(base, 1 - input.fee / 100 - input.tax / 100 - input.margin / 100),
        breakEven: roundedPrice(base, 1 - input.fee / 100 - input.tax / 100),
        profit: profit,
        feeAmount: feeAmount,
        taxAmount: taxAmount,
        fixed: input.fixed === 0 ? 0 : input.fixed,
        marginActual: marginActual === 0 ? 0 : marginActual,
        error: ''
      };
    } catch (failure) {
      return invalidQuote(failure.message || 'Hasil simulasi belum dapat dihitung dengan aman.');
    }
  }
  function target(input) {
    var error = fields(input, ['hpp', 'profit', 'fee', 'tax', 'fixed']);
    var invalid = function (message) { return { valid: false, price: null, error: message }; };
    if (error) return invalid(error);
    var combined = input.fee + input.tax;
    if (!Number.isFinite(combined) || combined >= 100) return invalid('Jumlah biaya marketplace dan estimasi pajak harus kurang dari 100%.');
    try {
      var base = money(money(input.hpp + input.fixed) + input.profit);
      return { valid: true, price: roundedPrice(base, 1 - input.fee / 100 - input.tax / 100), error: '' };
    } catch (failure) {
      return invalid(failure.message || 'Harga target belum dapat dihitung dengan aman.');
    }
  }
  return Object.freeze({ quote: quote, target: target });
}));

return module.exports;}());

/* Public contract:
   coreCommerceHpp({config,legacy:{production,stock,meta,workers,cuttingPlans},
     tables:{PO,Produk,Potong,SlipKirim,StokBahan,RencanaPotong,KoreksiRiwayat},settings})
   returns JSON-only {models,warnings}. A model has stable legacy id, series,
   nama/sizes/poIds, kain/potong/jahit evidence, config resolution, basis,
   hargaJahit/biayaLain/targetMargin, hppTotal (estimate or null), configured,
   complete, warnings and prices. Only configured models have recommendations.
   Legacy source cuts and mirrored asal=lama rows are never counted twice.
   Prices and histories are read-only; this is not a stock or payroll ledger. */
function coreCommercePriceQuote(input) { return coreCommerceLegacyPrice.quote(input); }
function coreCommercePriceTarget(input) { return coreCommerceLegacyPrice.target(input); }
function coreCommerceHppConfig(value,model) {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Pengaturan HPP tidak sah.');
  function money(v,label) { if (typeof v!=='number' || !Number.isFinite(v) || v<0 || v>Number.MAX_SAFE_INTEGER) throw new Error(label+' harus angka nol atau lebih yang sah.'); return v; }
  if (value.jahitMode!=='auto' && value.jahitMode!=='manual') throw new Error('Pilih ongkos jahit otomatis atau manual.');
  if (value.costSchema!==2 || value.costsReviewed!==true) throw new Error('Periksa biaya kain, potong, jahit, dan biaya lain sebelum menyimpan.');
  var out={jahitMode:value.jahitMode,hargaJahit:money(value.hargaJahit,'Ongkos jahit'),biayaLain:money(value.biayaLain,'Biaya lain'),targetMargin:money(value.targetMargin,'Target margin'),costSchema:2,costsReviewed:true};
  if (out.targetMargin>=100) throw new Error('Target margin harus kurang dari 100%.');
  out.ketLain=String(value.ketLain || '').trim(); if(out.ketLain.length>300) throw new Error('Keterangan biaya maksimal 300 karakter.');
  if (value.basisPolicy!==undefined && value.basisPolicy!=='complete-legacy-v1') throw new Error('Acuan HPP tidak dikenal.');
  if (model && model.basis && model.basis.excludedPcs>0 && value.basisPolicy!==model.basis.policy) throw new Error('Periksa dan setujui acuan produksi lengkap sebelum menyimpan HPP.');
  if (value.basisPolicy) out.basisPolicy=value.basisPolicy;
  if (value.hargaJual!==undefined) {
    if(!value.hargaJual || typeof value.hargaJual!=='object' || Array.isArray(value.hargaJual) || Object.keys(value.hargaJual).length>20) throw new Error('Harga jual tidak sah.');
    out.hargaJual={}; Object.keys(value.hargaJual).forEach(function(k){ if(!/^[a-zA-Z0-9_-]{1,40}$/.test(k)||['__proto__','constructor','prototype'].indexOf(k)>=0) throw new Error('Marketplace tidak sah.'); out.hargaJual[k]=money(value.hargaJual[k],'Harga jual'); });
  }
  if(model){out.series=String(model.series || '');out.namaBarang=String(model.nama || model.namaBarang || '');}
  return out;
}
function coreCommerceHpp(input) {
  input=input || {}; var C=coreCommerceLegacyCost, cfg=input.config || {}, legacy=input.legacy || {}, tables=input.tables || {}, settings=input.settings || {};
  function rows(v){return (Array.isArray(v)?v:v&&typeof v==='object'?Object.keys(v).map(function(k){return v[k];}):[]).filter(function(r){return r&&typeof r==='object'&&!Array.isArray(r);});}
  function json(v,fallback){if(typeof v!=='string')return v==null?fallback:v;try{return JSON.parse(v);}catch(e){return fallback;}}
  function n(v){if(v==null||typeof v==='boolean'||String(v).trim()==='')return null;var x=Number(v);return Number.isFinite(x)&&x>=0&&x<=Number.MAX_SAFE_INTEGER?x:null;}
  function sum(a){return a.reduce(function(t,v){return t+v;},0);}
  function unique(a){return a.filter(function(v,i){return v && a.indexOf(v)===i;});}
  function unit(v){return {kg:'kg',kilogram:'kg',m:'meter',meter:'meter',metre:'meter',yd:'yard',yard:'yard',yards:'yard'}[C.norm(v)] || null;}
  function evidence(parts){
    parts=parts.filter(Boolean);var pcs=sum(parts.map(function(p){return p.totalPcs || 0;})),cost=sum(parts.map(function(p){return p.totalCost || 0;})),warnings=unique([].concat.apply([],parts.map(function(p){return p.warnings || [];})));
    if(!parts.length)warnings.push('Belum ada hasil potong untuk menghitung HPP.');
    if(!Number.isSafeInteger(pcs)||!Number.isFinite(cost)||cost>Number.MAX_SAFE_INTEGER)warnings.push('Jumlah atau biaya melampaui batas perhitungan yang aman.');
    return {perPcs:pcs?cost/pcs:null,totalPcs:pcs,totalCost:cost,complete:!!parts.length&&parts.every(function(p){return p.complete;})&&!warnings.length,warnings:warnings,details:[].concat.apply([],parts.map(function(p){return p.details || [];})),source:unique(parts.map(function(p){return p.source;})).join(' + ')};
  }
  function summary(component){var out={};Object.keys(component || {}).forEach(function(k){if(k!=='includedEntries')out[k]=component[k];});return out;}
  var originals=rows(legacy.production), legacyModels=C.groupProducts(originals,{cuttingPlans:rows(legacy.cuttingPlans)}), groups=Object.create(null), allWarnings=[];
  legacyModels.forEach(function(m){groups[m.id]={id:m.id,series:m.series,nama:m.namaBarang,sizes:m.sizes.slice(),legacy:m,poIds:[],nativeCuts:[],assignments:[],warnings:[],members:m.members.slice(),rates:[]};});
  var poMap=Object.create(null), stockById=Object.create(null), stockByName=Object.create(null), planById=Object.create(null), productById=Object.create(null);
  rows(tables.Produk).forEach(function(r){productById[r.id]=r;});
  rows(tables.RencanaPotong).forEach(function(r){planById[r.id]=r;});
  rows(tables.StokBahan).filter(function(r){return r.jenis==='beli';}).forEach(function(r){
    if(stockById[r.id])stockById[r.id]=false;else if(stockById[r.id]!==false)stockById[r.id]=r;
    var key=C.norm(r.bahan);(stockByName[key] || (stockByName[key]=[])).push(r);
  });
  rows(tables.PO).forEach(function(p){
    var id=C.modelId(p.series,p.nama), g=groups[id]; if(!g)g=groups[id]={id:id,series:String(p.series || ''),nama:String(p.nama || ''),sizes:[],poIds:[],nativeCuts:[],assignments:[],warnings:[],members:[],rates:[]};
    g.poIds.push(p.id);poMap[p.id]=g;g.sizes=g.sizes.concat(Object.keys(json(p.ukuran,{})));
    var active=json(p.ukuranAktif,[]);if(Array.isArray(active))g.sizes=g.sizes.concat(active);
    g.members.push({id:'native:'+p.id,series:g.series,namaBarang:g.nama});
    var prod=productById[p.produkId],rate=n(prod&&prod.tarifJahit);if(rate===null||rate===0)rate=n(settings.upahJahit);if(rate!==null)g.rates.push(rate);
    if(p.imporReview)g.warnings.push('PO '+String(p.noPO || p.id)+' masih memerlukan pemeriksaan riwayat.');
  });
  var cutSeen=Object.create(null);
  rows(tables.Potong).forEach(function(r){
    if(r.asal==='lama'&&originals.length)return;
    var g=poMap[r.poId];if(!g){allWarnings.push('Ada hasil potong tanpa PO; belum masuk perhitungan HPP.');return;}
    if(r.asal==='lama')g.warnings.push('Sumber asli riwayat lama belum tersedia; tautan biaya lama belum dapat dipastikan.');
    if(cutSeen[r.id]){g.warnings.push('Identitas hasil potong ganda; periksa riwayat.');cutSeen[r.id].warnings.push('Identitas hasil potong ganda; periksa riwayat.');return;}cutSeen[r.id]=g;
    g.nativeCuts.push(r);g.sizes=g.sizes.concat(Object.keys(json(r.ukuran,{})));
  });
  rows(tables.SlipKirim).forEach(function(r){if(r.asal==='lama'&&originals.length)return;var g=poMap[r.poId];if(g)g.assignments.push(r);});
  rows(tables.KoreksiRiwayat).forEach(function(r){var g=poMap[r.poId];if(g)g.warnings.push('Jumlah riwayat memiliki koreksi fisik; cocokkan acuan biaya lama sebelum memakai HPP.');});
  function nativeCosts(g){
    if(!g.nativeCuts.length)return null;
    var pcs=0,fabricCost=0,cutCost=0,warnings=[],cutWarnings=[],details=[],cutDetails=[];
    function warn(s){warnings.push(s);}
    function price(p){var qty=n(p.qty),rate=n(p.harga),total=n(p.total);if(qty===null||qty<=0)return null;if(rate!==null&&rate>0){if(total!==null&&Math.abs(total-qty*rate)>Math.max(1,qty*rate*0.000001))return null;return rate;}return total!==null&&total>0?total/qty:null;}
    function average(name,u){var purchases=(stockByName[C.norm(name)] || []).filter(function(p){return unit(p.satuan)===u;}),qty=0,cost=0;if(!purchases.length)return null;for(var i=0;i<purchases.length;i++){var pr=price(purchases[i]);if(pr===null)return null;qty+=Number(purchases[i].qty);cost+=Number(purchases[i].qty)*pr;}return qty?cost/qty:null;}
    g.nativeCuts.forEach(function(r){
      var q=n(r.total), sizeMap=json(r.ukuran,{}), actual=sum(Object.keys(sizeMap).map(function(k){return n(sizeMap[k]) || 0;}));
      if(q===null||q<=0||!Number.isSafeInteger(q)||q!==actual){warn('Jumlah hasil potong '+r.id+' belum konsisten.');cutWarnings.push('Jumlah hasil potong belum konsisten.');return;}pcs+=q;
      var wage=n(r.tarif);if(wage===null)cutWarnings.push('Tarif potong '+r.id+' belum tercatat.');else{cutCost+=q*wage;cutDetails.push({id:r.id,tanggal:r.tanggal || '',jumlah:q,tarif:wage,totalCost:q*wage,source:'tarif-tercatat'});}
      var list=rows(json(r.bahanList,[]));if(!list.length&&r.bahan)list=[{nama:r.bahan,qty:r.kg}];
      var plan=planById[r.rencanaId], planMaterials=rows(json(plan&&plan.bahanList,[])), declared=Object.create(null), allocated=Object.create(null), allocations=rows(json(r.alokasiBahan,[])), allocSeen=Object.create(null);
      list.forEach(function(b){var key=C.norm(b.nama),amount=n(b.qty);if(!key||amount===null||amount<=0){warn('Rincian bahan hasil potong '+r.id+' belum lengkap.');return;}var units=unique((stockByName[key] || []).map(function(p){return unit(p.satuan);})),planRow=planMaterials.filter(function(p){return C.norm(p.nama)===key;})[0],u=unit(b.satuan || planRow&&planRow.satuan)||(units.length===1?units[0]:null);if(!u){warn('Satuan '+b.nama+' belum dapat dipastikan.');return;}if(declared[key]&&declared[key].unit!==u)warn('Satuan bahan ganda tidak konsisten.');var d=declared[key] || (declared[key]={nama:b.nama,qty:0,unit:u});d.qty+=amount;});
      if(!Object.keys(declared).length)warn('Ada hasil potong tanpa rincian bahan yang sah.');
      allocations.forEach(function(a){
        var receipt=stockById[a.stokId],amount=n(a.qty),key=receipt&&C.norm(receipt.bahan),d=key&&declared[key];
        if(allocSeen[a.stokId]||!receipt||!d||amount===null||amount<=0||unit(receipt.satuan)!==d.unit){warn('Tautan rol '+String(a.stokId || '')+' belum dapat dicocokkan dengan pembelian.');return;}allocSeen[a.stokId]=true;allocated[key]=(allocated[key] || 0)+amount;
        var rate=price(receipt);if(rate===null)warn('Harga rol '+String(receipt.rollLabel || receipt.id)+' belum lengkap.');else fabricCost+=amount*rate;
        details.push({cutId:r.id,jenis:d.nama,unit:d.unit,qty:amount,avgHarga:rate,totalCost:rate===null?null:amount*rate,priceSource:'rol-pembelian',sourceId:receipt.id});
      });
      Object.keys(declared).forEach(function(key){var d=declared[key],left=d.qty-(allocated[key] || 0);if(left< -0.000001){warn('Jumlah rol melebihi bahan pada hasil potong '+r.id+'.');return;}if(left<=0.000001)return;var rate=average(d.nama,d.unit);if(rate===null)warn('Harga rata-rata pembelian '+d.nama+' ('+d.unit+') belum lengkap.');else fabricCost+=left*rate;details.push({cutId:r.id,jenis:d.nama,unit:d.unit,qty:left,avgHarga:rate,totalCost:rate===null?null:left*rate,priceSource:'rata-rata-pembelian'});});
    });
    return {fabric:{perPcs:pcs?fabricCost/pcs:null,totalPcs:pcs,totalCost:fabricCost,complete:pcs>0&&!warnings.length,warnings:unique(warnings),details:details,source:'Catatan bahan Produksi'},cutting:{perPcs:pcs?cutCost/pcs:null,totalPcs:pcs,totalCost:cutCost,complete:pcs>0&&!cutWarnings.length,warnings:unique(cutWarnings),details:cutDetails,source:'Tarif potong tercatat'}};
  }
  function nativeSewing(g){
    var cost=0,pcs=0,warnings=[],seen=Object.create(null);
    g.assignments.forEach(function(r){if(seen[r.id]){warnings.push('Identitas penugasan jahit ganda.');return;}seen[r.id]=true;var q=n(r.total),rate=n(r.upah);if(q===null||q<=0||!Number.isSafeInteger(q)||rate===null){warnings.push('Jumlah atau tarif penugasan jahit belum lengkap.');return;}pcs+=q;cost+=q*rate;});
    if(!Number.isSafeInteger(pcs)||!Number.isFinite(cost)||cost>Number.MAX_SAFE_INTEGER)warnings.push('Jumlah atau biaya jahit melampaui batas perhitungan.');
    if(pcs)return {perPcs:cost/pcs,totalPcs:pcs,totalCost:cost,complete:!warnings.length,warnings:warnings,source:'Tarif jahit tercatat · rata-rata penugasan'};
    var rates=unique(g.rates.map(function(x){return String(x);})).map(Number);if(rates.length===1)return {perPcs:rates[0],totalPcs:0,totalCost:0,complete:!warnings.length,warnings:warnings,source:'Perkiraan tarif jahit saat ini'};
    return {perPcs:null,totalPcs:0,totalCost:0,complete:false,warnings:warnings.concat(rates.length?'Tarif jahit model berbeda; pilih perkiraan manual.':'Tarif jahit belum tersedia.'),source:'Belum ada tarif jahit'};
  }
  var models=Object.keys(groups).sort().map(function(id){
    var g=groups[id],lc=g.legacy?C.reference(g.legacy,legacy.stock || {}):null,lp=lc?C.cutting(g.legacy,legacy.meta || {},lc):null,ls=g.legacy?C.sewing(g.legacy,legacy.workers || []):null,native=nativeCosts(g),ns=nativeSewing(g),kain=evidence([lc,native&&native.fabric]),potong=evidence([lp,native&&native.cutting]);
    var jahit=ns.totalPcs?(ls&&ls.totalPcs?evidence([ls,ns]):ns):(ls || ns),ci=C.config({id:id,members:g.members},cfg),value=ci.value,mode=value&&value.jahitMode || (value?'manual':'auto');
    if(mode!=='auto'&&mode!=='manual')g.warnings.push('Pilihan ongkos jahit tidak valid.');
    var hargaJahit=mode==='auto'?(jahit.complete?jahit.perPcs:null):n(value&&value.hargaJahit),biayaLain=value?n(value.biayaLain===undefined?0:value.biayaLain):0,margin=value?n(value.targetMargin===undefined?30:value.targetMargin):30;
    var basis={policy:'complete-legacy-v1',allPcs:(lc?lc.basis.allPcs:0)+(native?native.fabric.totalPcs:0),includedPcs:kain.totalPcs,excludedPcs:lc?lc.basis.excludedPcs:0,excluded:lc?lc.basis.excluded:[],origins:{legacy:lc?lc.totalPcs:0,native:native?native.fabric.totalPcs:0}};
    var warnings=unique(g.warnings.concat(kain.warnings,potong.warnings,ci.warnings));
    if(hargaJahit===null)warnings=warnings.concat(jahit.warnings,['Isi ongkos jahit atau lengkapi tarif penugasan.']);
    if(ci.source==='legacy-compatible')warnings.push('Biaya lama tetap tersimpan. Periksa dan simpan sekali untuk model ini.');
    if(value&&value.costSchema!==2)warnings.push('Periksa biaya lain agar kain, potong, dan jahit tidak dihitung dua kali.');
    if(!value||value.costsReviewed!==true)warnings.push('Biaya model belum diperiksa dan disimpan.');
    var basisReviewed=!basis.excludedPcs || value&&value.basisPolicy===basis.policy;if(!basisReviewed)warnings.push('Periksa acuan produksi lengkap dan catatan lama yang dipisahkan.');
    var total=kain.complete&&potong.complete&&hargaJahit!==null&&biayaLain!==null?kain.perPcs+potong.perPcs+hargaJahit+biayaLain:null;
    if(total!==null&&(!Number.isFinite(total)||total>Number.MAX_SAFE_INTEGER)){total=null;warnings.push('Total HPP melampaui batas perhitungan.');}
    if(biayaLain===null)warnings.push('Biaya lain belum valid.');if(margin===null||margin>=100)warnings.push('Target margin harus nol sampai kurang dari 100%.');
    var ready=!!value&&ci.source==='model'&&ci.complete&&value.costSchema===2&&value.costsReviewed===true&&basisReviewed&&total!==null&&margin!==null&&margin<100&&!g.warnings.length,prices={};
    Object.keys(cfg.marketplace || {}).forEach(function(key){var mp=cfg.marketplace[key] || {},price=n(value&&value.hargaJual&&value.hargaJual[key]);if(!ready)return;prices[key]=coreCommercePriceQuote({hpp:total,price:price===null?0:price,margin:margin,fee:n(mp.fee),tax:n(cfg.pajak),fixed:mp.fixedPerPcs===undefined?0:n(mp.fixedPerPcs)});});
    kain.basis=basis;
    return {id:id,series:g.series,nama:g.nama,namaBarang:g.nama,sizes:unique(g.sizes).sort(),poIds:unique(g.poIds),kain:summary(kain),potong:summary(potong),jahit:summary(jahit),config:ci,basis:basis,hargaJahit:hargaJahit,biayaLain:biayaLain,targetMargin:margin,hppTotal:total,configured:ready,complete:ready,warnings:unique(warnings),prices:prices};
  });
  return {models:models,warnings:unique(allWarnings)};
}
