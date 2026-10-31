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
      var source=p.assignJahit,seen=new Map();
      if(source!=null&&(typeof source!=='object'||(Array.isArray(source)?source:Object.values(source)).some(a=>a!=null&&(typeof a!=='object'||Array.isArray(a)))))warn(warnings,'Ada rincian penugasan jahit yang tidak terbaca lengkap.');
      rows(source).filter(a=>!ignored(a)).forEach(a=>{
        var q=number(a.qty),id=a.id!=null?String(a.id):'',previous=id&&seen.get(id);
        if(q===null||!Number.isSafeInteger(q)){warn(warnings,'Jumlah penugasan jahit belum valid.');return;}
        if(previous){if(stable(previous)!==stable(a))warn(warnings,'Identitas penugasan jahit ganda dengan isi berbeda.');return;}
        if(id)seen.set(id,a);
        if(q>0)assignments.push({p,a});
      });
    });
    var totalCost=0,totalPcs=0;
    if(assignments.length){assignments.forEach(({p,a})=>{var matches=list.filter(w=>String(w.id)===String(a.tukangId)),r=matches.length===1?rate(matches[0],p):null,q=number(a.qty);if(r===null)warn(warnings,'Tarif jahit saat ini belum tersedia untuk semua penugasan model.');else totalCost+=r*q;totalPcs+=q;});return {perPcs:totalPcs?totalCost/totalPcs:0,totalCost,totalPcs,hasEvidence:true,complete:!warnings.length,warnings,source:'Tarif jahit saat ini · rata-rata sesuai jumlah penugasan'};}
    var rates=[];list.forEach(w=>{var values=new Set((model.members||[model]).map(p=>rate(w,p)).filter(v=>v!==null));if(values.size>1)warn(warnings,'Tarif nama model yang sama berbeda; periksa tarif jahit.');values.forEach(v=>rates.push(v));});if(rates.length){if(new Set(rates).size>1)warn(warnings,'Tarif berbeda antarpenjahit. Pilih biaya jahit model sebelum memakai rekomendasi.');return {perPcs:warnings.length?0:rates[0],totalCost:0,totalPcs:0,hasEvidence:true,complete:!warnings.length,warnings,source:'Tarif jahit saat ini'};}
    var historic=ledger(model.members||[model],'jahit',warnings);historic.forEach(({entry:e})=>{var q=number(e.jumlah),r=number(e.tarif);if(q===null||q<=0||r===null||r<=0){warn(warnings,'Tarif atau jumlah pada riwayat jahit belum lengkap.');return;}totalCost+=q*r;totalPcs+=q;});var hasEvidence=historic.length>0||warnings.length>0;if(!totalPcs)warn(warnings,'Tarif jahit belum tersedia; isi biaya jahit per pcs.');return {perPcs:totalPcs?totalCost/totalPcs:0,totalCost,totalPcs,hasEvidence:hasEvidence,complete:!!totalPcs&&!warnings.length,warnings,source:totalPcs?'Riwayat tarif jahit · bukan tarif terbaru':'Belum ada tarif jahit'};
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
  var stockRows=rows(tables.StokBahan),effectivePrices=typeof coreStockPrices==='function'?coreStockPrices(stockRows):null;
  /* A material-wide policy applies to every matching material/unit, including
     receipts only present in the old snapshot. Per-roll corrections still need
     their exact receipt ID. Both paths leave immutable import proofs intact. */
  var legacyStock=Object.assign({},legacy.stock || {});
  function legacyPurchaseUnit(p){var key=String(p.jenisBahan||'').trim().toLowerCase().replace(/[\/.#$\[\]]/g,'-'),info=legacyStock.rolInfo&&legacyStock.rolInfo[key];return p.unit?unit(p.unit):info&&info.unit?unit(info.unit):'kg';}
  legacyStock.pembelian=rows(legacyStock.pembelian).map(function(p){
    var material=effectivePrices&&effectivePrices.materialMap[C.norm(p.jenisBahan)],fixed=material&&material.units[legacyPurchaseUnit(p)],q=n(p.kg);
    if(fixed&&fixed.materialOverride&&fixed.priceComplete&&q!==null&&q>0)return Object.assign({},p,{hargaPerKg:fixed.harga,total:q*fixed.harga,priceCorrectionId:fixed.correctionId,priceScope:'bahan'});
    var same=stockRows.filter(function(s){return String(s.id)===String(p.id)&&s.jenis==='beli';}),s=same[0],price=effectivePrices&&effectivePrices.byId[p.id];
    if(same.length!==1||!price||!price.correctionId||!price.priceComplete||C.norm(s.bahan)!==C.norm(p.jenisBahan)||unit(s.satuan)!==legacyPurchaseUnit(p))return p;
    var q=n(p.kg);if(q===null||q<=0)return p;
    return Object.assign({},p,{hargaPerKg:price.harga,total:q*price.harga,priceCorrectionId:price.correctionId});
  });
  var originals=rows(legacy.production), legacyModels=C.groupProducts(originals,{cuttingPlans:rows(legacy.cuttingPlans)}), groups=Object.create(null), allWarnings=[];
  legacyModels.forEach(function(m){groups[m.id]={id:m.id,series:m.series,nama:m.namaBarang,sizes:m.sizes.slice(),legacy:m,poIds:[],nativeCuts:[],assignments:[],warnings:[],members:m.members.slice(),rates:[]};});
  var poMap=Object.create(null), poRows=Object.create(null), stockById=Object.create(null), stockByName=Object.create(null), planById=Object.create(null), productById=Object.create(null);
  rows(tables.Produk).forEach(function(r){productById[r.id]=r;});
  rows(tables.RencanaPotong).forEach(function(r){if(planById[r.id])planById[r.id]=false;else if(planById[r.id]!==false)planById[r.id]=r;});
  stockRows.filter(function(r){return r.jenis==='beli'||r.jenis==='rinci'||r.jenis==='koreksi'&&!r.sourceStockId&&n(r.qty)>0;}).forEach(function(r){
    if(stockById[r.id])stockById[r.id]=false;else if(stockById[r.id]!==false)stockById[r.id]=r;
    var key=C.norm(r.bahan);if(r.jenis!=='rinci')(stockByName[key] || (stockByName[key]=[])).push(r);
  });
  rows(tables.PO).forEach(function(p){
    var id=C.modelId(p.series,p.nama), g=groups[id]; if(!g)g=groups[id]={id:id,series:String(p.series || ''),nama:String(p.nama || ''),sizes:[],poIds:[],nativeCuts:[],assignments:[],warnings:[],members:[],rates:[]};
    g.poIds.push(p.id);poMap[p.id]=g;poRows[p.id]=p;g.sizes=g.sizes.concat(Object.keys(json(p.ukuran,{})));
    var active=json(p.ukuranAktif,[]);if(Array.isArray(active))g.sizes=g.sizes.concat(active);
    g.members.push({id:'native:'+p.id,series:g.series,namaBarang:g.nama});
    var prod=productById[p.produkId],rate=n(prod&&prod.tarifJahit);if(rate===null||rate===0)rate=n(settings.upahJahit);if(rate!==null)g.rates.push(rate);
    if(p.imporReview)g.warnings.push('PO '+String(p.noPO || p.id)+' masih memerlukan pemeriksaan riwayat.');
  });
  function ownerOpening(r){return r.asal==='koreksi-ukuran';}
  function noteOwnerOpening(g,r){
    var p=poRows[r.poId], notes=g.ownerOpeningWarnings || (g.ownerOpeningWarnings=[]);
    notes.push('PO '+String(p.noPO || p.id)+' memiliki ukuran yang ditambahkan dari keterangan owner. Biaya kain, potong, dan jahitnya belum diketahui; catatan awal tersebut tidak menjadi acuan rata-rata HPP.');
    g.sizes=g.sizes.concat(Object.keys(json(r.ukuran,{})));
  }
  var cutSeen=Object.create(null);
  rows(tables.Potong).forEach(function(r){
    if(r.asal==='lama'&&originals.length)return;
    var g=poMap[r.poId];if(!g){allWarnings.push('Ada hasil potong tanpa PO; belum masuk perhitungan HPP.');return;}
    /* Opening quantities restore workflow identity, not measured cost evidence. */
    if(ownerOpening(r)){noteOwnerOpening(g,r);return;}
    if(r.asal==='lama')g.warnings.push('Sumber asli riwayat lama belum tersedia; tautan biaya lama belum dapat dipastikan.');
    if(cutSeen[r.id]){g.warnings.push('Identitas hasil potong ganda; periksa riwayat.');cutSeen[r.id].warnings.push('Identitas hasil potong ganda; periksa riwayat.');return;}cutSeen[r.id]=g;
    g.nativeCuts.push(r);g.sizes=g.sizes.concat(Object.keys(json(r.ukuran,{})));
  });
  rows(tables.SlipKirim).forEach(function(r){if(r.asal==='lama'&&originals.length)return;var g=poMap[r.poId];if(!g)return;if(ownerOpening(r)){noteOwnerOpening(g,r);return;}g.assignments.push(r);});
  rows(tables.KoreksiRiwayat).forEach(function(r){var g=poMap[r.poId];if(g)g.warnings.push('Jumlah riwayat memiliki koreksi fisik; cocokkan acuan biaya lama sebelum memakai HPP.');});
  function nativeMaterials(r){var list=rows(json(r.bahanList,[]));return !list.length&&r.bahan?[{nama:r.bahan,qty:r.kg}]:list;}
  function materialTotals(list){
    var totals=Object.create(null),valid=!!list.length;
    list.forEach(function(b){var name=C.norm(b.nama),q=n(b.qty),units=unique((stockByName[name]||[]).map(function(p){return unit(p.satuan);})),u=b.satuan?unit(b.satuan):(units.length===1?units[0]:null);if(!name||!u||q===null||q<=0){valid=false;return;}var key=name+'|'+u;totals[key]=(totals[key]||0)+q;});
    return valid?totals:null;
  }
  function sameTotals(a,b){return !!a&&!!b&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(function(key){return b[key]!==undefined&&Math.abs(a[key]-b[key])<0.000001;});}
  function sizedNativeCut(r){
    var allocations=rows(json(r.alokasiBahan,[])),plan=planById[r.rencanaId];
    if(plan&&plan.poId===r.poId&&plan.status!=='batal'){
      var planLabels=rows(json(plan.alokasiBahan,[]));
      if(allocations.some(function(a){var size=String(a.ukuran||'').trim().toUpperCase();return size&&planLabels.some(function(p){var plannedSize=String(p.ukuran||'').trim().toUpperCase();return p.stokId===a.stokId&&plannedSize&&plannedSize!==size;});}))return Object.assign({},r,{_hppPlanSizeMismatch:true});
    }
    if(!allocations.length||allocations.every(function(a){return String(a.ukuran||'').trim();})||!plan||plan.poId!==r.poId||plan.status==='batal')return r;
    /* Old result snapshots may lack size labels. Borrow only the labels from
       the exact plan; never substitute its material quantities or source IDs. */
    var planned=rows(json(plan.alokasiBahan,[])),byId=Object.create(null),seen=Object.create(null),actual=Object.create(null),valid=planned.length===allocations.length;
    if(!planned.some(function(a){return String(a.ukuran||'').trim();}))return r;
    if(rows(tables.Potong).filter(function(c){return c.rencanaId===r.rencanaId&&c.asal!=='lanjut'&&!ownerOpening(c);}).length!==1)valid=false;
    planned.forEach(function(a){if(!a.stokId||byId[a.stokId])valid=false;byId[a.stokId]=a;});
    var recovered=allocations.map(function(a){
      var p=byId[a.stokId],receipt=stockById[a.stokId],q=n(a.qty),u=unit(receipt&&receipt.satuan),size=String(a.ukuran||'').trim().toUpperCase(),planSize=String(p&&p.ukuran||'').trim().toUpperCase();
      if(seen[a.stokId]||!receipt||!u||q===null||q<=0||!p||n(p.qty)===null||Math.abs(q-Number(p.qty))>=0.000001||size&&planSize&&size!==planSize){valid=false;return a;}
      seen[a.stokId]=true;var key=C.norm(receipt.bahan)+'|'+u;actual[key]=(actual[key]||0)+q;
      return Object.assign({},a,{ukuran:size||planSize});
    });
    var declared=materialTotals(nativeMaterials(r)),prepared=materialTotals(nativeMaterials(plan));
    return valid&&sameTotals(declared,prepared)&&sameTotals(declared,actual)?Object.assign({},r,{alokasiBahan:recovered}):Object.assign({},r,{_hppPlanSizeMismatch:true});
  }
  function nativeXLReference(r){
    r=sizedNativeCut(r);
    if(r._hppPlanSizeMismatch)return null;
    var sizes=json(r.ukuran,{}),active=Object.keys(sizes).filter(function(k){return (n(sizes[k])||0)>0;}),xlKey=active.filter(function(k){return String(k).trim().toUpperCase()==='XL';});
    var allocations=rows(json(r.alokasiBahan,[]));
    if(xlKey.length!==1)return null;if(active.length===1&&!allocations.some(function(a){var size=String(a.ukuran||'').trim().toUpperCase();return size&&size!=='XL';}))return r;
    /* Explicit per-size rolls isolate XL even while another assigned size is
       still waiting to be cut. Every material quantity must remain linked and
       sized; unlabelled fabric is never divided by the XL output alone. */
    var list=nativeMaterials(r),declared=materialTotals(list),used=Object.create(null),selected=[],selectedMaterial=Object.create(null),seen=Object.create(null),valid=true;
    if(!allocations.length||!list.length||n(r.total)!==sum(active.map(function(k){return n(sizes[k])||0;})))return null;
    allocations.forEach(function(a){var receipt=stockById[a.stokId],size=String(a.ukuran||'').trim().toUpperCase(),q=n(a.qty),u=unit(receipt&&receipt.satuan),key=receipt&&C.norm(receipt.bahan)+'|'+u;
      if(!receipt||receipt.stockMode!=='roll'||!u||q===null||q<=0||seen[a.stokId]||!size){valid=false;return;}
      seen[a.stokId]=true;used[key]=(used[key]||0)+q;
      if(size==='XL'){selected.push(a);var b=selectedMaterial[key]||(selectedMaterial[key]={nama:receipt.bahan,satuan:u,qty:0});b.qty+=q;}
    });
    if(!valid||!selected.length||!sameTotals(declared,used))return null;
    var sizeQty=n(sizes[xlKey[0]]);if(!Number.isSafeInteger(sizeQty)||sizeQty<=0)return null;
    return Object.assign({},r,{total:sizeQty,ukuran:{XL:sizeQty},bahanList:Object.keys(selectedMaterial).map(function(k){return selectedMaterial[k];}),alokasiBahan:selected});
  }
  function nativeXLReferences(g){
    var byPO=Object.create(null),out=[];
    g.nativeCuts.forEach(function(r){(byPO[r.poId]||(byPO[r.poId]=[])).push(r);});
    Object.keys(byPO).forEach(function(poId){
      var poCuts=byPO[poId],initial=poCuts.filter(function(r){return r.asal!=='lanjut';}),groups=initial.map(function(r){return {first:sizedNativeCut(r),cuts:[r]};}),ambiguous=false;
      poCuts.filter(function(r){return r.asal==='lanjut';}).forEach(function(r){
        var matches=r.rencanaId?groups.filter(function(b){return b.first.rencanaId===r.rencanaId;}):groups;
        /* Current continuation writes have no plan ID. They are attributable
           only when the PO has exactly one initial material batch. */
        if(matches.length!==1){ambiguous=true;return;}matches[0].cuts.push(r);
      });
      if(ambiguous)return;
      groups.forEach(function(b){
        if(b.cuts.length===1){var single=nativeXLReference(b.first);if(single)out.push(single);return;}
        var sizes=Object.create(null),valid=true;
        b.cuts.forEach(function(r){var map=json(r.ukuran,{}),q=n(r.total),actual=0;Object.keys(map).forEach(function(size){var count=n(map[size]);if(count===null||!Number.isSafeInteger(count)){valid=false;return;}actual+=count;var key=String(size).trim().toUpperCase();sizes[key]=(sizes[key]||0)+count;});if(!Number.isSafeInteger(q)||q<=0||actual!==q)valid=false;
          if(r!==b.cuts[0]&&(nativeMaterials(r).length||rows(json(r.alokasiBahan,[])).length||n(r.kg)>0))valid=false;
        });
        if(!valid||!sizes.XL)return;
        var merged=Object.assign({},b.first,{ukuran:sizes,total:sum(Object.keys(sizes).map(function(k){return sizes[k];}))}),selected=nativeXLReference(merged);
        if(!selected)return;
        var materialPlaced=false,batchId=b.first.rencanaId||b.first.id;
        b.cuts.forEach(function(r){var map=json(r.ukuran,{}),q=sum(Object.keys(map).filter(function(k){return String(k).trim().toUpperCase()==='XL';}).map(function(k){return n(map[k])||0;}));if(!q)return;
          /* Attach the XL material once, preserving each output's own tariff.
             The first XL output can itself be a continuation after M. */
          var first=!materialPlaced;materialPlaced=true;
          out.push(Object.assign({},r,{total:q,ukuran:{XL:q},bahanList:first?nativeMaterials(selected):[],alokasiBahan:first?json(selected.alokasiBahan,[]):[],bahan:'',kg:0,asal:first?'':'lanjut',rencanaId:b.first.rencanaId||'',_hppBatchId:batchId}));
        });
      });
    });
    return out;
  }
  function nativeCosts(g){
    if(!g.nativeCuts.length)return null;
    /* A pure XL batch is the model reference. Weight observations by their pcs,
       never average per-batch prices equally or allocate mixed cloth to XL alone.
       Continuations share the material on the first cut and stay together. */
    var acuanXL=nativeXLReferences(g),cuts=acuanXL.length?acuanXL:g.nativeCuts;
    var pcs=0,fabricCost=0,cutCost=0,warnings=[],cutWarnings=[],details=[],cutDetails=[];
    function warn(s){warnings.push(s);}
    function price(p){var effective=effectivePrices&&effectivePrices.byId[p.id];if(effective)return effective.priceComplete&&n(effective.harga)>0?Number(effective.harga):null;var qty=n(p.qty),rate=n(p.harga),total=n(p.total);if(qty===null||qty<=0)return null;if(rate!==null&&rate>0){if(total!==null&&Math.abs(total-qty*rate)>Math.max(1,qty*rate*0.000001))return null;return rate;}return total!==null&&total>0?total/qty:null;}
    function average(name,u){var material=effectivePrices&&effectivePrices.materialMap[C.norm(name)],value=material&&material.units&&material.units[u];if(value)return n(value.missingQty)===0&&n(value.hpp)>0?Number(value.hpp):null;var purchases=(stockByName[C.norm(name)] || []).filter(function(p){return unit(p.satuan)===u;}),qty=0,cost=0;if(!purchases.length)return null;for(var i=0;i<purchases.length;i++){var pr=price(purchases[i]);if(pr===null)return null;qty+=Number(purchases[i].qty);cost+=Number(purchases[i].qty)*pr;}return qty?cost/qty:null;}
    cuts.forEach(function(r){
      var q=n(r.total), sizeMap=json(r.ukuran,{}), actual=sum(Object.keys(sizeMap).map(function(k){return n(sizeMap[k]) || 0;}));
      if(q===null||q<=0||!Number.isSafeInteger(q)||q!==actual){warn('Jumlah hasil potong '+r.id+' belum konsisten.');cutWarnings.push('Jumlah hasil potong belum konsisten.');return;}pcs+=q;
      var wage=n(r.tarif);if(wage===null)cutWarnings.push('Tarif potong '+r.id+' belum tercatat.');else{cutCost+=q*wage;cutDetails.push({id:r.id,tanggal:r.tanggal || '',jumlah:q,tarif:wage,totalCost:q*wage,source:'tarif-tercatat'});}
      var list=rows(json(r.bahanList,[]));if(!list.length&&r.bahan)list=[{nama:r.bahan,qty:r.kg}];
      var plan=planById[r.rencanaId], planMaterials=rows(json(plan&&plan.bahanList,[])), declared=Object.create(null), allocated=Object.create(null), allocations=rows(json(r.alokasiBahan,[])), allocSeen=Object.create(null);
      list.forEach(function(b){var key=C.norm(b.nama),amount=n(b.qty);if(!key||amount===null||amount<=0){warn('Rincian bahan hasil potong '+r.id+' belum lengkap.');return;}var units=unique((stockByName[key] || []).map(function(p){return unit(p.satuan);})),planRow=planMaterials.filter(function(p){return C.norm(p.nama)===key;})[0],u=unit(b.satuan || planRow&&planRow.satuan)||(units.length===1?units[0]:null);if(!u){warn('Satuan '+b.nama+' belum dapat dipastikan.');return;}if(declared[key]&&declared[key].unit!==u)warn('Satuan bahan ganda tidak konsisten.');var d=declared[key] || (declared[key]={nama:b.nama,qty:0,unit:u});d.qty+=amount;});
      if(!Object.keys(declared).length&&r.asal!=='lanjut')warn('Ada hasil potong tanpa rincian bahan yang sah.');
      allocations.forEach(function(a){
        var receipt=stockById[a.stokId],amount=n(a.qty),key=receipt&&C.norm(receipt.bahan),d=key&&declared[key];
        if(allocSeen[a.stokId]||!receipt||!d||amount===null||amount<=0||unit(receipt.satuan)!==d.unit){warn('Tautan rol '+String(a.stokId || '')+' belum dapat dicocokkan dengan pembelian.');return;}allocSeen[a.stokId]=true;allocated[key]=(allocated[key] || 0)+amount;
        var rate=price(receipt);if(rate===null)warn('Harga rol '+String(receipt.rollLabel || receipt.id)+' belum lengkap.');else fabricCost+=amount*rate;
        var effective=effectivePrices&&effectivePrices.byId[receipt.id];details.push({cutId:r.id,jenis:d.nama,unit:d.unit,qty:amount,avgHarga:rate,totalCost:rate===null?null:amount*rate,priceSource:effective&&effective.materialOverride?'harga-jenis-bahan':effective&&effective.correctionId?'koreksi-harga-rol':'rol-pembelian',sourceId:receipt.id,priceCorrectionId:effective&&effective.correctionId || ''});
      });
      Object.keys(declared).forEach(function(key){var d=declared[key],left=d.qty-(allocated[key] || 0);if(left< -0.000001){warn('Jumlah rol melebihi bahan pada hasil potong '+r.id+'.');return;}if(left<=0.000001)return;var rate=average(d.nama,d.unit),material=effectivePrices&&effectivePrices.materialMap[key],fixed=material&&material.units[d.unit];if(rate===null)warn('Harga pembelian '+d.nama+' ('+d.unit+') belum lengkap.');else fabricCost+=left*rate;details.push({cutId:r.id,jenis:d.nama,unit:d.unit,qty:left,avgHarga:rate,totalCost:rate===null?null:left*rate,priceSource:fixed&&fixed.materialOverride?'harga-jenis-bahan':'rata-rata-pembelian',priceCorrectionId:fixed&&fixed.materialOverride?fixed.correctionId:''});});
    });
    return {xl:!!acuanXL.length,includedCuts:cuts,fabric:{perPcs:pcs?fabricCost/pcs:null,totalPcs:pcs,totalCost:fabricCost,complete:pcs>0&&!warnings.length,warnings:unique(warnings),details:details,source:acuanXL.length?'Catatan bahan Produksi, potongan ukuran XL':'Catatan bahan Produksi'},cutting:{perPcs:pcs?cutCost/pcs:null,totalPcs:pcs,totalCost:cutCost,complete:pcs>0&&!cutWarnings.length,warnings:unique(cutWarnings),details:cutDetails,source:'Tarif potong tercatat'}};
  }
  function nativeSewing(g){
    var cost=0,pcs=0,warnings=[],seen=Object.create(null),pairRates=Object.create(null),details=[],inferred=0;
    function pair(r){return String(r.poId||'').trim()&&String(r.maklonId||'').trim()?JSON.stringify([r.poId,r.maklonId]):'';}
    /* Imported assignments use zero for an unknown rate. Reuse only a unanimous
       positive rate recorded for this exact PO and worker, never another PO. */
    g.assignments.forEach(function(r){var key=pair(r),q=n(r.total),rate=n(r.upah);if(key&&Number.isSafeInteger(q)&&q>0&&rate>0){var rates=pairRates[key]||(pairRates[key]=[]);if(rates.indexOf(rate)<0)rates.push(rate);}});
    g.assignments.forEach(function(r){
      if(seen[r.id]){warnings.push('Identitas penugasan jahit ganda.');return;}seen[r.id]=true;
      var q=n(r.total),rate=n(r.upah),source='tarif-tercatat';
      if(q===null||q<=0||!Number.isSafeInteger(q)){warnings.push('Jumlah atau tarif penugasan jahit belum lengkap.');return;}pcs+=q;
      if(rate===0||r.upah==null||typeof r.upah==='string'&&!r.upah.trim()){
        var rates=pairRates[pair(r)]||[];
        if(rates.length===1){rate=rates[0];source='tarif-penugasan-po-maklon-sama';inferred++;}
        else {warnings.push(rates.length?'Tarif jahit penugasan kosong dan tarif PO/maklon berbeda; isi ongkos jahit manual.':'Tarif jahit penugasan kosong; belum ada tarif pasti untuk PO dan maklon yang sama.');return;}
      }
      if(rate===null||rate<=0){warnings.push('Jumlah atau tarif penugasan jahit belum lengkap.');return;}
      var total=q*rate;cost+=total;details.push({id:r.id,poId:r.poId,maklonId:r.maklonId||'',jumlah:q,tarif:rate,totalCost:total,source:source});
    });
    if(!Number.isSafeInteger(pcs)||!Number.isFinite(cost)||cost>Number.MAX_SAFE_INTEGER)warnings.push('Jumlah atau biaya jahit melampaui batas perhitungan.');
    if(pcs||g.assignments.length)return {perPcs:pcs?cost/pcs:null,totalPcs:pcs,totalCost:cost,hasEvidence:true,complete:pcs>0&&!warnings.length,warnings:warnings,details:details,source:'Tarif jahit tercatat · rata-rata penugasan'+(inferred?' · tarif kosong mengikuti PO dan maklon yang sama':'')};
    var rates=unique(g.rates.filter(function(x){return x>0;}).map(function(x){return String(x);})).map(Number);if(rates.length===1)return {perPcs:rates[0],totalPcs:0,totalCost:0,complete:!warnings.length,warnings:warnings,source:'Perkiraan tarif jahit saat ini'};
    return {perPcs:null,totalPcs:0,totalCost:0,complete:false,warnings:warnings.concat(rates.length?'Tarif jahit model berbeda; pilih perkiraan manual.':'Tarif jahit belum tersedia.'),source:'Belum ada tarif jahit'};
  }
  function legacyReference(g){
    /* Imported catalog rows may have no cutting history. They are not missing
       cost evidence; malformed ledgers still participate and keep their holds. */
    if(!g.legacy||!(g.legacy.ledger||[]).length&&!(g.legacy.warnings||[]).length)return {all:null,xl:null};
    var all=C.reference(g.legacy,legacyStock),entries=g.legacy.ledger||[],eligible=entries.filter(function(row){
      if(String(row.product.size||'').trim().toUpperCase()!=='XL')return false;
      /* A plan/material batch can store cloth once before other sizes follow.
         Keep that connected component intact instead of charging it only to XL. */
      var component=[row],changed=true;
      while(changed){changed=false;entries.forEach(function(other){if(component.includes(other))return;if(component.some(function(member){return ['cuttingPlanId','materialBatchId'].some(function(key){return member.entry[key]&&String(member.entry[key])===String(other.entry[key]);});})){component.push(other);changed=true;}});}
      return component.every(function(member){return String(member.product.size||'').trim().toUpperCase()==='XL';});
    });
    return {all:all,xl:eligible.length&&eligible.length===entries.length?all:eligible.length?C.reference(Object.assign({},g.legacy,{ledger:eligible}),legacyStock):null};
  }
  /* Assign recorded rolls to recorded XL output for HPP only. Source ledgers
     stay immutable, and the full original plan must reconcile first. */
  function legacyXLSelection(g,choice){
    var saved=cfg.xlReferences&&Object.prototype.hasOwnProperty.call(cfg.xlReferences,g.id)?cfg.xlReferences[g.id]:null,candidate=null,entries=g.legacy&&g.legacy.ledger||[],xl=entries.filter(function(r){return String(r.product.size||'').trim().toUpperCase()==='XL';}),plans=unique(entries.map(function(r){return String(r.entry.cuttingPlanId||'');})),plan=plans.length===1?rows(legacy.cuttingPlans).filter(function(p){return String(p.id)===plans[0];}):[];
    if(g.legacy&&!choice.xl&&entries.length&&xl.length&&xl.length<entries.length&&plan.length===1&&plan[0].status==='used'&&plan[0].materialMode!=='per-result-v1'&&entries.every(function(r){return String(r.entry.cuttingPlanId||'')===plans[0]&&String(r.entry.id||'')&&String(r.product.size||'').trim()&&Number.isSafeInteger(n(r.entry.jumlah))&&n(r.entry.jumlah)>0;})&&typeof coreLegacyHash==='function'){
      var full=choice.all,first=entries.filter(function(r){return rows(r.entry.rols).length>0;}),seen=Object.create(null),rolls=[],valid=full.complete&&first.length===1&&!g.warnings.length;
      if(valid)rows(first[0].entry.rols).forEach(function(r){
        var id=String(r.purchaseId||''),found=rows(legacyStock.pembelian).filter(function(p){return String(p.id)===id;}),p=found[0],q=n(r.kiloan==null?r.kg:r.kiloan),u=p&&legacyPurchaseUnit(p),rate=p&&n(p.hargaPerKg),total=p&&n(p.total),original=p&&n(p.kg);
        if(!id||seen[id]||found.length!==1||!q||!u||!original||q>original+0.000001||String(r.ukuran||r.size||'').trim()||rows(plan[0].rolls).some(function(a){return String(a.purchaseId)===id&&String(a.ukuran||a.size||'').trim();})||Math.abs((allRollUsage['legacy:'+id]||0)-q)>0.000001){valid=false;return;}
        seen[id]=true;if(!(rate>0)&&total>0)rate=total/original;if(!(rate>0)||!Number.isFinite(q*rate)||q*rate>Number.MAX_SAFE_INTEGER){valid=false;return;}
        rolls.push({id:id,label:String(p.rollLabel||r.label||'Rol '+(rolls.length+1)),bahan:String(p.jenisBahan||''),unit:u,qty:q,harga:rate,totalCost:q*rate});
      });
      if(valid&&rolls.length>1&&unique(entries.map(function(r){return String(r.entry.id);})).length===entries.length){
        var proof={schema:1,modelId:g.id,plan:plan[0],cuts:entries.map(function(r){return {productId:r.product.id,size:r.product.size,entry:r.entry};}),rolls:rolls.map(function(r){return {id:r.id,bahan:r.bahan,unit:r.unit,qty:r.qty};})};
        candidate={planId:plans[0],evidenceRevision:coreLegacyHash(proof),totalPcs:sum(xl.map(function(r){return n(r.entry.jumlah);})),rolls:rolls};
      }
    }
    g.xlReferenceCandidate=candidate;g.xlReference=saved?JSON.parse(JSON.stringify(saved)):null;
    if(!saved)return choice;
    var validSaved=saved&&typeof saved==='object'&&!Array.isArray(saved)&&saved.confirmed===true&&candidate&&saved.planId===candidate.planId&&saved.evidenceRevision===candidate.evidenceRevision&&Array.isArray(saved.rollIds)&&saved.rollIds.length>0&&saved.rollIds.length<candidate.rolls.length&&unique(saved.rollIds).length===saved.rollIds.length&&saved.rollIds.every(function(id){return typeof id==='string'&&candidate.rolls.some(function(r){return r.id===id;});});
    if(!validSaved){
      var warning='Acuan kain XL yang ditentukan owner tidak cocok lagi dengan riwayat. Tentukan ulang kain XL.';
      g.warnings.push(warning);return {all:choice.all,xl:{totalPcs:0,totalCost:0,perPcs:null,complete:false,warnings:[warning],details:[],includedEntries:[],basis:{policy:'complete-legacy-v1',allPcs:0,includedPcs:0,excludedPcs:0,excluded:[]}}};
    }
    var selected=candidate.rolls.filter(function(r){return saved.rollIds.indexOf(r.id)>=0;}),materials=Object.create(null);
    selected.forEach(function(r){var key=C.norm(r.bahan)+'|'+r.unit;if(!materials[key])materials[key]={jenis:r.bahan,unit:r.unit,kg:0};materials[key].kg+=r.qty;});
    var projected=xl.map(function(r,i){var e=Object.assign({},r.entry,{cuttingPlanId:'',materialBatchId:'',kiloan:i===0?sum(selected.filter(function(a){return a.unit==='kg';}).map(function(a){return a.qty;})):0,jenisBahan:'',bahanList:i===0?Object.keys(materials).map(function(k){return materials[k];}):[],rols:i===0?selected.map(function(a){return {purchaseId:a.id,jenis:a.bahan,unit:a.unit,kg:a.qty};}):[],materialAllocation:i===0?'hpp-owner-xl-v1':'owner-plan-recorded-earlier'});return {entry:e,product:r.product,archived:r.archived};});
    var fabric=C.fabric(Object.assign({},g.legacy,{ledger:projected,warnings:[],cuttingPlans:[]}),legacyStock);
    fabric.basis={policy:'complete-legacy-v1',allPcs:fabric.totalPcs,includedPcs:fabric.totalPcs,excludedPcs:0,excluded:[]};fabric.includedEntries=xl;fabric._hppAssignedEntries=projected;fabric.source='Kain XL ditentukan owner dari rol tercatat';
    return {all:choice.all,xl:fabric};
  }
  function observations(g,legacyCost,native,kain,xl){
    var sizes=Object.create(null),qtyByUnit=Object.create(null),rolls=Object.create(null),batches=Object.create(null),notes=[],provisional=false;
    function addSize(size,q){if(!Number.isSafeInteger(q)||q<=0)return;size=String(size||'Belum tercatat').trim().toUpperCase();sizes[size]=(sizes[size]||0)+q;}
    function batch(key){return batches[key]||(batches[key]={totalPcs:0,rollIds:[],complete:true});}
    function addRoll(b,id,receipt,amount,u,label,source){
      if(!receipt||!id||n(amount)===null||amount<=0||!u){b.complete=false;return;}
      var original=n(source==='legacy'?receipt.kg:receipt.qty),identified=receipt.stockMode==='roll'||source==='legacy'&&n(receipt.rol)===1;
      if(!identified||original===null||original<=0){b.complete=false;return;}
      var key=(source==='legacy'?'legacy:':'native:')+id,r=rolls[key];
      if(!r){var effective=source==='native'&&effectivePrices&&effectivePrices.byId[id],rate=source==='legacy'?n(receipt.hargaPerKg):n(receipt.harga);if(effective)rate=effective.priceComplete?n(effective.harga):null;if(!(rate>0))rate=null;r=rolls[key]={id:id,source:source,bahan:String(receipt.bahan||receipt.jenisBahan||''),label:label||String(id),unit:u,originalQty:original,usedQty:0,full:false,harga:rate,totalCost:rate===null?null:original*rate};}
      if(r.unit!==u||r.originalQty!==original){b.complete=false;return;}
      r.usedQty+=amount;if(!b.rollIds.includes(key))b.rollIds.push(key);
    }
    (kain.details||[]).forEach(function(d){var q=n(d.qty),u=unit(d.unit);if(q!==null&&u)qtyByUnit[u]=(qtyByUnit[u]||0)+q;});
    if(legacyCost)(legacyCost._hppAssignedEntries||legacyCost.includedEntries||[]).forEach(function(row){
      var e=row.entry,q=n(e.jumlah);if(q===null||!Number.isSafeInteger(q)||q<=0)return;
      addSize(row.product.size,q);var b=batch('legacy:'+(e.cuttingPlanId||e.materialBatchId||row.product.id+':'+e.id));b.totalPcs+=q;
      var list=rows(e.rols),material=rows(e.bahanList);if(e.materialAllocation==='owner-plan-recorded-earlier')return;
      if(!list.length)b.complete=false;
      var used=0,declared=sum(material.map(function(m){return n(m.kg)||0;}));
      list.forEach(function(a){var found=rows(legacyStock.pembelian).filter(function(p){return String(p.id)===String(a.purchaseId);}),receipt=found.length===1?found[0]:null,amount=n(a.kiloan==null?a.kg:a.kiloan),u=a.unit?unit(a.unit):receipt?legacyPurchaseUnit(receipt):null;used+=amount||0;addRoll(b,a.purchaseId,receipt,amount,u,receipt&&receipt.rollLabel,'legacy');});
      if(material.length&&Math.abs(declared-used)>0.000001)b.complete=false;
      if(e.cuttingPlanId){var plan=rows(legacy.cuttingPlans).filter(function(p){return String(p.id)===String(e.cuttingPlanId);})[0];if(!plan||plan.status!=='used')provisional=true;}
    });
    if(native)(native.includedCuts||[]).forEach(function(r){
      var q=n(r.total),map=json(r.ukuran,{});if(q===null||!Number.isSafeInteger(q)||q<=0||sum(Object.keys(map).map(function(k){return n(map[k])||0;}))!==q)return;
      Object.keys(map).forEach(function(size){addSize(size,n(map[size]));});
      var b=batch('native:'+(r._hppBatchId||r.rencanaId||r.poId));b.totalPcs+=q;
      if(r.asal==='lanjut')return;
      var details=(native.fabric.details||[]).filter(function(d){return d.cutId===r.id;}),alloc=rows(json(r.alokasiBahan,[]));
      if(!details.length||details.some(function(d){return !d.sourceId;})||!alloc.length)b.complete=false;
      alloc.forEach(function(a){var receipt=stockById[a.stokId],amount=n(a.qty);addRoll(b,a.stokId,receipt,amount,unit(receipt&&receipt.satuan),receipt&&receipt.rollLabel,'native');});
    });
    Object.keys(rolls).forEach(function(key){var r=rolls[key],corrections=r.source==='native'&&stockRows.some(function(s){return s.jenis==='koreksi'&&s.sourceStockId===r.id&&n(Math.abs(Number(s.qty)))>0;}),allUsed=allRollUsage[key]||0;
      r.full=!corrections&&Math.abs(r.usedQty-r.originalQty)<0.000001&&Math.abs(allUsed-r.usedQty)<0.000001;
    });
    var rollGroups=[];
    Object.keys(batches).forEach(function(key){var b=batches[key];if(!b.complete||!b.rollIds.length||!kain.complete||!b.rollIds.every(function(id){return rolls[id].full;}))return;
      /* A roll shared across batches has no isolated output attribution. */
      if(b.rollIds.some(function(id){return Object.keys(batches).some(function(other){return other!==key&&batches[other].rollIds.includes(id);});}))return;
      var units=unique(b.rollIds.map(function(id){return rolls[id].unit;})),materials=unique(b.rollIds.map(function(id){return C.norm(rolls[id].bahan);}));if(units.length!==1||materials.length!==1)return;
      var quantities={};b.rollIds.forEach(function(id){var r=rolls[id];quantities[r.unit]=(quantities[r.unit]||0)+r.usedQty;});
      var totalCost=b.rollIds.every(function(id){return rolls[id].totalCost!==null;})?sum(b.rollIds.map(function(id){return rolls[id].totalCost;})):null;
      rollGroups.push({rollCount:b.rollIds.length,totalPcs:b.totalPcs,qtyByUnit:quantities,totalCost:totalCost,costPerRoll:totalCost===null?null:totalCost/b.rollIds.length,pcsPerRoll:b.totalPcs/b.rollIds.length,source:key.indexOf('native:')===0?'Hasil potong tercatat':'Riwayat hasil potong'});
    });
    var units=Object.keys(qtyByUnit).filter(function(u){return qtyByUnit[u]>0;}),yieldByUnit={};
    if(units.length===1&&kain.totalPcs>0)yieldByUnit[units[0]]=kain.totalPcs/qtyByUnit[units[0]];
    if(units.length>1)notes.push('Bahan memakai satuan berbeda; hasil per satuan tidak digabung.');
    if(unique(Object.keys(rolls).map(function(id){return C.norm(rolls[id].bahan);})).length>1)notes.push('Beberapa bahan dipakai bersama dalam satu barang; jumlah hasil tidak dibagi atau disalin sebagai hasil masing-masing rol.');
    var fullRollCount=sum(rollGroups.map(function(b){return b.rollCount;})),fullRollPcs=sum(rollGroups.map(function(b){return b.totalPcs;}));
    if(!fullRollCount)notes.push('Rata-rata pcs per rol belum tersedia: perlu berat rol utuh dan hasil potong yang terhubung lengkap.');
    if(!xl&&Object.keys(sizes).some(function(size){return size!=='XL';})){provisional=true;notes.push('Belum ada acuan bahan khusus XL yang terpisah; acuan sementara memakai seluruh hasil yang tercatat, tanpa menebak pemakaian kain per ukuran.');}
    if(!kain.complete)provisional=true;
    var readyPlans=rows(tables.RencanaPotong).filter(function(p){return g.poIds.includes(p.poId)&&p.status==='siap'&&!rows(tables.Potong).some(function(r){return r.rencanaId===p.id&&!ownerOpening(r);});});
    if(readyPlans.length){provisional=true;notes.push('Masih ada bahan yang disiapkan; rata-rata dapat berubah setelah hasil potong bertambah.');}
    if(legacyCost&&legacyCost._hppAssignedEntries)notes.push('Kain khusus XL ditentukan owner dari rol tercatat; jumlah produksi dan stok tidak diubah.');
    if(provisional)notes.push('Angka ini sementara berdasarkan hasil yang sudah tercatat.');
    return {sizes:Object.keys(sizes).sort().map(function(size){return {size:size,jumlah:sizes[size]};}),totalPcs:kain.totalPcs,totalKg:qtyByUnit.kg||0,qtyByUnit:qtyByUnit,yieldByUnit:yieldByUnit,verifiedRollCount:Object.keys(rolls).length,fullRollCount:fullRollCount,fullRollPcs:fullRollPcs,pcsPerFullRoll:fullRollCount?fullRollPcs/fullRollCount:null,rolls:Object.keys(rolls).map(function(key){return rolls[key];}),rollGroups:rollGroups,provisional:provisional,notes:notes};
  }
  var allRollUsage=Object.create(null);
  rows(tables.Potong).filter(function(c){return !ownerOpening(c);}).forEach(function(c){rows(json(c.alokasiBahan,[])).forEach(function(a){var key='native:'+a.stokId;allRollUsage[key]=(allRollUsage[key]||0)+(n(a.qty)||0);});});
  legacyModels.forEach(function(model){(model.ledger||[]).forEach(function(row){rows(row.entry.rols).forEach(function(a){var key='legacy:'+a.purchaseId;allRollUsage[key]=(allRollUsage[key]||0)+(n(a.kiloan==null?a.kg:a.kiloan)||0);});});});
  var models=Object.keys(groups).sort().map(function(id){
    var g=groups[id],legacyChoice=legacyXLSelection(g,legacyReference(g)),native=nativeCosts(g),pakaiXL=!!(legacyChoice.xl||native&&native.xl),lc=pakaiXL?legacyChoice.xl:legacyChoice.all,nativeReference=pakaiXL&&!(native&&native.xl)?null:native,lp=lc?C.cutting(g.legacy,legacy.meta || {},lc):null,ls=g.legacy?C.sewing(g.legacy,legacy.workers || []):null,ns=nativeSewing(g),kain=evidence([lc,nativeReference&&nativeReference.fabric]),potong=evidence([lp,nativeReference&&nativeReference.cutting]);
    /* A clean catalog-only legacy row must not hide the current native rate. */
    var jahit=ns.totalPcs||ns.hasEvidence?(ls&&ls.totalPcs?evidence([ls,ns]):ns):(ls&&ls.hasEvidence?ls:ns),ci=C.config({id:id,members:g.members},cfg),value=ci.value,mode=value&&value.jahitMode || (value?'manual':'auto');
    var sourceWarnings=g.warnings.slice();
    if(mode!=='auto'&&mode!=='manual')g.warnings.push('Pilihan ongkos jahit tidak valid.');
    var hargaJahit=mode==='auto'?(jahit.complete?jahit.perPcs:null):n(value&&value.hargaJahit),biayaLain=value?n(value.biayaLain===undefined?0:value.biayaLain):0,margin=value?n(value.targetMargin===undefined?30:value.targetMargin):30;
    var basis={policy:'complete-legacy-v1',allPcs:(lc?lc.basis.allPcs:0)+(nativeReference?nativeReference.fabric.totalPcs:0),includedPcs:kain.totalPcs,excludedPcs:lc?lc.basis.excludedPcs:0,excluded:lc?lc.basis.excluded:[],origins:{legacy:lc?lc.totalPcs:0,native:nativeReference?nativeReference.fabric.totalPcs:0}};
    if(pakaiXL)basis.ukuran='XL';
    var warnings=unique(g.warnings.concat(g.ownerOpeningWarnings || [],kain.warnings,potong.warnings,ci.warnings));
    if(hargaJahit===null)warnings=warnings.concat(jahit.warnings,['Isi ongkos jahit atau lengkapi tarif penugasan.']);
    if(ci.source==='legacy-compatible')warnings.push('Biaya lama tetap tersimpan. Periksa dan simpan sekali untuk model ini.');
    if(value&&value.costSchema!==2)warnings.push('Periksa biaya lain agar kain, potong, dan jahit tidak dihitung dua kali.');
    if(!value||value.costsReviewed!==true)warnings.push('Biaya model belum diperiksa dan disimpan.');
    var basisReviewed=!basis.excludedPcs || value&&value.basisPolicy===basis.policy;if(!basisReviewed)warnings.push('Periksa acuan produksi lengkap dan catatan lama yang dipisahkan.');
    var total=kain.complete&&potong.complete&&hargaJahit!==null&&biayaLain!==null?kain.perPcs+potong.perPcs+hargaJahit+biayaLain:null;
    if(total!==null&&(!Number.isFinite(total)||total>Number.MAX_SAFE_INTEGER)){total=null;warnings.push('Total HPP melampaui batas perhitungan.');}
    if(biayaLain===null)warnings.push('Biaya lain belum valid.');if(margin===null||margin>=100)warnings.push('Target margin harus nol sampai kurang dari 100%.');
    if(!pakaiXL)warnings.push('Belum ada hasil XL dengan bahan terpisah. HPP masih perkiraan seluruh hasil; rekomendasi harga menunggu acuan XL.');
    var configSaved=false;if(ci.source==='model'&&ci.complete){try{coreCommerceHppConfig(value);configSaved=true;}catch(invalidConfig){}}
    var ready=pakaiXL&&configSaved&&basisReviewed&&total!==null&&margin!==null&&margin<100&&!g.warnings.length,prices={};
    Object.keys(cfg.marketplace || {}).forEach(function(key){var mp=cfg.marketplace[key] || {},price=n(value&&value.hargaJual&&value.hargaJual[key]);if(!ready)return;prices[key]=coreCommercePriceQuote({hpp:total,price:price===null?0:price,margin:margin,fee:n(mp.fee),tax:n(cfg.pajak),fixed:mp.fixedPerPcs===undefined?0:n(mp.fixedPerPcs)});});
    kain.basis=basis;kain.observasi=observations(g,lc,nativeReference,kain,pakaiXL);basis.provisional=kain.observasi.provisional;
    return {id:id,series:g.series,nama:g.nama,namaBarang:g.nama,sizes:unique(g.sizes).sort(),poIds:unique(g.poIds),xlReferenceCandidate:g.xlReferenceCandidate,xlReference:g.xlReference,kain:summary(kain),potong:summary(potong),jahit:summary(jahit),config:ci,basis:basis,hargaJahit:hargaJahit,biayaLain:biayaLain,targetMargin:margin,hppTotal:total,configSaved:configSaved,configured:ready,complete:ready,sourceWarnings:sourceWarnings,warnings:unique(warnings),prices:prices};
  });
  var grouped=coreCommerceHppGroups(models,cfg);
  return {models:models,groups:grouped.groups,warnings:unique(allWarnings.concat(grouped.warnings))};
}

/* A group shares one costing reference. It never combines stock, PO or payroll
   records; individual model configuration remains available when ungrouped. */
function coreCommerceHppGroups(models,config) {
  config=config||{};models=Array.isArray(models)?models:[];
  function copy(v){return v==null?v:JSON.parse(JSON.stringify(v));}
  function list(v){return Array.isArray(v)?v:[];}
  function unique(v){return v.filter(function(x,i){return x!==undefined&&x!==null&&v.indexOf(x)===i;});}
  function n(v){return typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=Number.MAX_SAFE_INTEGER?v:null;}
  function sum(v){return v.reduce(function(total,x){return total+x;},0);}
  function join(v){return [].concat.apply([],v);}
  function prefixed(m,warnings){return list(warnings).map(function(w){return m.nama+': '+w;});}
  function isXL(m){return (m.basis||(m.kain||{}).basis||{}).ukuran==='XL';}
  function usableXLReference(m){
    var kain=m.kain||{},potong=m.potong||{};
    // Use one matched set of fabric and cutting evidence. Personal sewing or
    // approval settings do not determine whether that evidence is usable.
    return isXL(m)&&kain.complete===true&&potong.complete===true&&
      Number.isSafeInteger(kain.totalPcs)&&kain.totalPcs>0&&
      Number.isSafeInteger(potong.totalPcs)&&potong.totalPcs===kain.totalPcs&&
      n(kain.totalCost)!==null&&n(potong.totalCost)!==null&&!list(m.sourceWarnings).length;
  }
  var groups=config.hppGroups||{},warnings=[],lookup=Object.create(null),claims=Object.create(null),invalid=Object.create(null);
  models.forEach(function(m){lookup[m.id]=m;});
  if(!groups||typeof groups!=='object'||Array.isArray(groups))return {groups:[],warnings:['Data kelompok HPP tidak terbaca. Model tetap ditampilkan sendiri.']};
  var keys=Object.keys(groups);if(keys.length>100)return {groups:[],warnings:['Jumlah kelompok HPP melebihi batas. Periksa pengaturan kelompok.']};
  keys.forEach(function(key){
    var g=groups[key],seen=Object.create(null);
    if(!/^hppg_[A-Za-z0-9_-]{1,100}$/.test(key)||!g||g.id!==key||typeof g.nama!=='string'||!g.nama.trim()||g.nama.length>80||!Array.isArray(g.modelIds)||g.modelIds.length<2||g.modelIds.length>100){invalid[key]=true;return;}
    g.modelIds.forEach(function(id){if(typeof id!=='string'||id.length>500||seen[id])invalid[key]=true;seen[id]=true;if(claims[id]){invalid[key]=true;invalid[claims[id]]=true;}else claims[id]=key;});
  });
  function aggregate(members,field){
    var components=members.map(function(m){return m[field]||{};}),pcs=sum(components.map(function(c){return n(c.totalPcs)||0;})),cost=sum(components.map(function(c){return n(c.totalCost)||0;}));
    var notes=join(members.map(function(m){return prefixed(m,(m[field]||{}).warnings);}));
    var complete=!!members.length&&components.every(function(c){return c.complete===true&&Number.isSafeInteger(c.totalPcs)&&c.totalPcs>0&&n(c.totalCost)!==null;});
    if(!Number.isSafeInteger(pcs)||n(cost)===null){complete=false;notes.push('Jumlah atau biaya kelompok melampaui batas perhitungan.');}
    return {totalPcs:pcs,totalCost:cost,perPcs:pcs&&n(cost)!==null?cost/pcs:null,complete:complete,warnings:unique(notes),details:join(members.map(function(m){return list((m[field]||{}).details).map(function(d){return Object.assign({},copy(d),{modelId:m.id,modelNama:m.nama});});})),source:'Rata-rata tertimbang acuan XL kelompok'};
  }
  function sewing(members){
    var actual=members.filter(function(m){return n((m.jahit||{}).totalPcs)>0;}),out;
    if(actual.length){out=aggregate(actual,'jahit');out.source='Tarif jahit tercatat · rata-rata penugasan kelompok';
      // An uncountable assignment is not a zero-cost contribution. Fallback
      // models without assignments do not acquire artificial quantity weights.
      members.forEach(function(m){if((m.jahit||{}).complete!==true){out.complete=false;out.warnings=out.warnings.concat(prefixed(m,(m.jahit||{}).warnings));}});
      return out;
    }
    var rates=unique(members.map(function(m){return n((m.jahit||{}).perPcs);})),complete=members.length>0&&members.every(function(m){return (m.jahit||{}).complete===true;})&&rates.length===1&&rates[0]!==null;
    return {totalPcs:0,totalCost:0,perPcs:complete?rates[0]:null,complete:complete,warnings:complete?[]:['Tarif jahit anggota belum lengkap atau berbeda. Pilih ongkos jahit kelompok secara manual.'],source:'Tarif jahit seragam seluruh anggota',details:[]};
  }
  var computed=keys.filter(function(key){if(invalid[key]){warnings.push('Kelompok '+String(groups[key]&&groups[key].nama||key)+' tidak sah atau anggotanya bertumpuk. Model tetap ditampilkan sendiri.');return false;}return true;}).map(function(key){
    var g=groups[key],members=g.modelIds.map(function(id){return lookup[id];}).filter(Boolean),missing=g.modelIds.filter(function(id){return !lookup[id];});
    var refs=members.filter(usableXLReference),inherited=members.filter(function(m){return refs.indexOf(m)<0;});
    // Incomplete members follow the complete XL reference. Their evidence is
    // excluded from both costs and quantities, with its warnings still visible.
    var sourceWarnings=[],inheritedWarnings=join(inherited.map(function(m){
      var notes=list(m.sourceWarnings).concat(list((m.kain||{}).warnings),list((m.potong||{}).warnings));
      if(isXL(m))notes.push('Acuan kain dan potong XL belum lengkap atau tidak cocok; belum dipakai dalam rata-rata kelompok.');
      return prefixed(m,unique(notes));
    }));
    if(inherited.length)inheritedWarnings.push(inherited.length+' anggota mengikuti acuan XL kelompok; hanya acuan XL lengkap yang dimasukkan ke rata-rata.');
    inheritedWarnings=unique(inheritedWarnings);
    if(missing.length)sourceWarnings.push('Ada '+missing.length+' anggota kelompok yang datanya belum ditemukan.');
    var kain=aggregate(refs,'kain'),potong=aggregate(refs,'potong'),jahit=sewing(members),value=copy(g.config),mode=value&&value.jahitMode||'auto';
    var basis={policy:'complete-legacy-v1',allPcs:sum(refs.map(function(m){return (m.basis||{}).allPcs||0;})),includedPcs:kain.totalPcs,excludedPcs:sum(refs.map(function(m){return (m.basis||{}).excludedPcs||0;})),excluded:join(refs.map(function(m){return list((m.basis||{}).excluded).map(function(x){return Object.assign({},copy(x),{modelId:m.id,modelNama:m.nama});});})),origins:{legacy:0,native:0}};
    refs.forEach(function(m){var origins=(m.basis||{}).origins||{};basis.origins.legacy+=origins.legacy||0;basis.origins.native+=origins.native||0;});if(refs.length)basis.ukuran='XL';
    var notes=sourceWarnings.concat(inheritedWarnings,kain.warnings,potong.warnings),configSaved=false;
    if(!refs.length)notes.push('Belum ada acuan kain XL yang lengkap. Tentukan kain XL atau lengkapi hasil potong satu anggota.');
    if(value){try{coreCommerceHppConfig(value);configSaved=true;}catch(e){notes.push(e.message);}}
    if(!configSaved)notes.push('Biaya kelompok belum diperiksa dan disimpan.');
    var hargaJahit=mode==='auto'?(jahit.complete?jahit.perPcs:null):mode==='manual'?n(value&&value.hargaJahit):null,other=value?n(value.biayaLain):0,margin=value?n(value.targetMargin):30;
    if(hargaJahit===null)notes=notes.concat(jahit.warnings,['Isi ongkos jahit kelompok atau lengkapi tarif penugasan.']);
    if(other===null)notes.push('Biaya lain kelompok belum sah.');
    var basisReviewed=!basis.excludedPcs||value&&value.basisPolicy===basis.policy;if(!basisReviewed)notes.push('Periksa acuan produksi lengkap dan catatan lama yang dipisahkan.');
    if(kain.totalPcs!==potong.totalPcs){kain.complete=false;potong.complete=false;notes.push('Jumlah acuan kain dan ongkos potong kelompok tidak cocok.');}
    var total=kain.complete&&potong.complete&&hargaJahit!==null&&other!==null?kain.perPcs+potong.perPcs+hargaJahit+other:null;
    if(total!==null&&n(total)===null){total=null;notes.push('Total HPP kelompok melampaui batas perhitungan.');}
    var ready=!!refs.length&&configSaved&&basisReviewed&&total!==null&&margin!==null&&margin<100&&!sourceWarnings.length,prices={};
    Object.keys(config.marketplace||{}).forEach(function(k){if(!ready)return;var mp=config.marketplace[k]||{},price=n(value&&value.hargaJual&&value.hargaJual[k]);prices[k]=coreCommercePriceQuote({hpp:total,price:price===null?0:price,margin:margin,fee:n(mp.fee),tax:n(config.pajak),fixed:mp.fixedPerPcs===undefined?0:n(mp.fixedPerPcs)});});
    var qtyByUnit={},sizes={},rolls=Object.create(null),rollGroups=[],obsNotes=[],provisional=!kain.complete;
    refs.forEach(function(m){var obs=(m.kain||{}).observasi||{};provisional=provisional||!!obs.provisional;Object.keys(obs.qtyByUnit||{}).forEach(function(u){qtyByUnit[u]=(qtyByUnit[u]||0)+(n(obs.qtyByUnit[u])||0);});list(obs.sizes).forEach(function(s){sizes[s.size]=(sizes[s.size]||0)+(n(s.jumlah)||0);});
      list(obs.rolls).forEach(function(r){var id=String(r.source||'')+':'+r.id,old=rolls[id];if(old){old.usedQty+=(n(r.usedQty)||0);old.totalCost=old.harga===null?null:old.usedQty*old.harga;old.full=old.full&&r.full;}else{rolls[id]=copy(r);rolls[id].totalCost=n(r.harga)===null?null:(n(r.usedQty)||0)*r.harga;}});
      rollGroups=rollGroups.concat(list(obs.rollGroups).map(function(x){return Object.assign({},copy(x),{modelId:m.id,modelNama:m.nama});}));obsNotes=obsNotes.concat(prefixed(m,obs.notes));
    });
    var units=Object.keys(qtyByUnit).filter(function(u){return qtyByUnit[u]>0;}),yieldByUnit={};if(units.length===1&&kain.totalPcs>0)yieldByUnit[units[0]]=kain.totalPcs/qtyByUnit[units[0]];if(units.length>1)obsNotes.push('Bahan memakai satuan berbeda; hasil per satuan tidak digabung.');
    var fullRollCount=sum(rollGroups.map(function(x){return n(x.rollCount)||0;})),fullRollPcs=sum(rollGroups.map(function(x){return n(x.totalPcs)||0;}));
    kain.observasi={sizes:Object.keys(sizes).sort().map(function(size){return {size:size,jumlah:sizes[size]};}),totalPcs:kain.totalPcs,totalKg:qtyByUnit.kg||0,qtyByUnit:qtyByUnit,yieldByUnit:yieldByUnit,verifiedRollCount:Object.keys(rolls).length,fullRollCount:fullRollCount,fullRollPcs:fullRollPcs,pcsPerFullRoll:fullRollCount?fullRollPcs/fullRollCount:null,rolls:Object.keys(rolls).map(function(id){return rolls[id];}),rollGroups:rollGroups,provisional:provisional,notes:unique(obsNotes)};
    basis.provisional=provisional;kain.basis=basis;
    var series=unique(members.map(function(m){return m.series;})).join(' · ');
    return {id:key,nama:g.nama,namaBarang:g.nama,series:series,isGroup:true,modelIds:g.modelIds.slice(),memberModels:members.map(function(m){return {id:m.id,nama:m.nama,series:m.series,sizes:copy(m.sizes||[]),poIds:copy(m.poIds||[])};}),referenceModelIds:refs.map(function(m){return m.id;}),sizes:unique(join(members.map(function(m){return list(m.sizes);}))).sort(),poIds:unique(join(members.map(function(m){return list(m.poIds);}))),kain:kain,potong:potong,jahit:jahit,basis:basis,config:{value:value,source:'group',complete:configSaved,warnings:[]},hargaJahit:hargaJahit,biayaLain:other,targetMargin:margin,hppTotal:total,configSaved:configSaved,configured:ready,complete:ready,sourceWarnings:sourceWarnings,inheritedWarnings:inheritedWarnings,warnings:unique(notes),prices:prices};
  });
  return {groups:computed,warnings:unique(warnings)};
}
