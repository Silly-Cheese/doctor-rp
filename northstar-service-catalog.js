// Editable simulation charge master. Historic invoices store frozen item prices.
import {mountBulkPricing} from "./northstar-bulk-pricing.js";
import {getApp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {getAuth} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {getFirestore,collection,doc,getDoc,getDocs,query,where,limit,writeBatch,serverTimestamp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
const db=()=>getFirestore(getApp()),auth=()=>getAuth(getApp());
const esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const cash=c=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format((Number(c)||0)/100);
const normalize=s=>String(s??"").toLowerCase().replace(/\s+/g," ").trim();
const readPrice=v=>{if(!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(String(v).trim()))throw Error("Enter a valid price from $0.00 to $9,999,999.99.");return Math.round(Number(v)*100)};
const canEdit=p=>p?.status==="active"&&(p.role==="administrator"||p.permissions?.billingManage===true);
const kindTitle={visit:"Encounter / facility",order:"Clinical orders & diagnostics",procedure:"Procedures",ems:"EMS",room:"Room costs",service:"Hospital services"};
const TEMPLATES={
 visit:["Emergency Visit","Urgent Care Visit","Observation Visit","Trauma Evaluation","Inpatient Consultation","Outpatient Consultation"],
 order:["CBC with Differential","Comprehensive Metabolic Panel","Troponin","Lactate","Blood Cultures","12-Lead ECG","Chest X-Ray — 2 Views","CT Head without Contrast","CT Abdomen/Pelvis with Contrast","Telemetry","Oxygen","Normal Saline","Aspirin","Acetaminophen","Ondansetron","Albuterol","NPO","Fall Precautions"],
 procedure:["Wound Repair","Laceration Repair","Suture Removal","Splint Application","Fracture Reduction","Intubation","Cardiopulmonary Resuscitation","Central Line Placement","Arterial Line Placement","Chest Tube Placement","Lumbar Puncture","Abscess Drainage","IV Access","Urinary Catheter Placement","Blood Transfusion","Sedation","Procedural Ultrasound"],
 ems:["EMS Transport","Advanced Life Support Transport","Basic Life Support Transport","EMS Critical Care Transport"],
 room:["Emergency Room","Trauma Room","Observation Room","Operating Room","Med/Surg Room","ICU Room","Pediatric Room"],
 service:["Med/Surg Services","ICU Services","Pediatric Services","Observation Services","Respiratory Therapy","Physical Therapy","Occupational Therapy","Consultation Services","Patient Transport","Pharmacy Services","Diagnostic Services","Surgical Services","Nursing Services"]
};
const serviceNameOptions=(kind,observed=[])=>[...new Set([...(TEMPLATES[kind]||[]),...observed])].sort((a,b)=>a.localeCompare(b));

export async function listCatalog(){
 const snap=await getDocs(collection(db(),"serviceCatalog"));
 return snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.name.localeCompare(b.name));
}
export function renderServiceCatalog({target,records,profile}){
 if(!target)return;
 if(!canEdit(profile)){target.innerHTML='<article class="panel"><h3>Service pricing is restricted.</h3><p>Ask an administrator for Billing Management permission.</p></article>';return;}
 const rows=records||[];
 target.innerHTML='<section class="nmc-billing-page nmc-catalog"><header><div><p class="eyebrow">Northstar Medical Center · Administration</p><h2>Service Prices & Charge Master</h2><p>Set prices for visits, procedures and clinical orders. Future invoices use the active rates; old invoices keep their original amounts.</p></div></header>'+
 '<div class="nmc-bill-metrics"><article><span>Catalog services</span><strong>'+rows.length+'</strong></article><article><span>Active rates</span><strong>'+rows.filter(r=>r.active!==false).length+'</strong></article></div>'+
 '<form id="nmcCatalogForm" class="nmc-catalog-form"><h3>Add or update service pricing</h3><div class="nmc-bill-two"><label>Service category<select name="kind" id="nmcCatalogKind"><option value="visit">Encounter / facility</option><option value="order">Clinical orders & diagnostics</option><option value="procedure">Procedures</option><option value="ems">EMS</option><option value="room">Room costs</option><option value="service">Hospital services</option></select></label><label>Service name<select name="templateName" id="nmcCatalogTemplate" required></select></label><label id="nmcCatalogCustomWrap" hidden>Custom service name<input name="customName" minlength="2" maxlength="120" placeholder="Name of new service"></label><label>Unit price ($)<input name="price" type="number" min="0" max="9999999.99" step="0.01" required placeholder="125.00"></label><label>Service code (optional)<input name="code" maxlength="40" placeholder="Unique internal service code"></label></div><p>Pick an existing Northstar service; names match its clinical workflows automatically. For a new service not listed, choose Custom service. EMS charges apply to EMS arrivals, room fees to occupied room types, and inpatient services to applicable admissions.</p><button type="submit">Save service price</button><p id="nmcCatalogNotice" role="status"></p></form>'+
'<div class="nmc-bill-tools"><input id="nmcCatalogSearch" type="search" placeholder="Search service rates" aria-label="Search service rates"><select id="nmcCatalogStatus"><option value="all">All rates</option><option value="active">Active only</option><option value="archived">Archived only</option></select></div><div id="nmcCatalogRows"></div></section>';
 const list=target.querySelector("#nmcCatalogRows"),input=target.querySelector("#nmcCatalogSearch"),status=target.querySelector("#nmcCatalogStatus");
 const draw=()=>{
  const needle=input.value.toLowerCase(),filter=status.value;
  const shown=rows.filter(r=>(filter==="all"||(filter==="active"?(r.active!==false):(r.active===false)))&&[r.name,r.code,r.kind].some(x=>String(x||"").toLowerCase().includes(needle)));
  list.replaceChildren();
  if(!shown.length){list.textContent="No services match your search. Add a price above to get started.";return;}
  for(const r of shown){
   const card=document.createElement("article");card.className="nmc-bill-row nmc-catalog-row";
   const info=document.createElement("div");const title=document.createElement("strong");title.textContent=r.name;
   const sub=document.createElement("small");sub.textContent=(kindTitle[r.kind]||r.kind)+" · "+(r.code||"No code")+" · "+(r.active===false?"Archived":"Active");
   info.append(title,sub);
   const price=document.createElement("strong");price.textContent=cash(r.priceCents);
   const actions=document.createElement("div");actions.className="nmc-catalog-actions";
   const edit=document.createElement("button");edit.type="button";edit.textContent="Edit price";edit.onclick=()=>editRate(r);
   const toggle=document.createElement("button");toggle.type="button";toggle.textContent=r.active===false?"Reactivate":"Archive";toggle.onclick=async()=>{toggle.disabled=true;try{await saveChange(r,{active:r.active===false});}catch(e){target.querySelector("#nmcCatalogNotice").textContent=e.message;}finally{toggle.disabled=false}};
   if(profile.role==="administrator"){
     const remove=document.createElement("button");remove.type="button";remove.className="nmc-catalog-delete";remove.textContent="Delete";
     remove.setAttribute("aria-label","Delete service price: "+r.name);
     remove.onclick=()=>confirmRateRemoval(r);
     actions.append(edit,toggle,remove);
   }else actions.append(edit,toggle);
   card.append(info,price,actions);list.append(card);
  }
 };
 input.oninput=draw;status.onchange=draw;draw();
 const form=target.querySelector("#nmcCatalogForm");
 const observed={order:[],procedure:[]};
 // Supplement the curated list with exact names already documented in Northstar.
 Promise.all([
   getDocs(query(collection(db(),"orders"),limit(250))),
   getDocs(query(collection(db(),"procedures"),limit(250)))
 ]).then(([orders,procedures])=>{
   observed.order=[...new Set(orders.docs.map(d=>d.data().name||d.data().orderName||"").filter(Boolean))];
   observed.procedure=[...new Set(procedures.docs.map(d=>d.data().name||"").filter(Boolean))];
   refreshNames();
   mountBulkPricing({target:target.querySelector(".nmc-catalog"),records:rows,observed:[...observed.order.map(name=>({kind:"order",name,group:"other-order"})),...observed.procedure.map(name=>({kind:"procedure",name,group:"procedures"}))]});
 }).catch(err=>{
   const info=target.querySelector("#nmcCatalogNotice");
   if(info&&!info.textContent)info.textContent="Showing standard Northstar services; recorded-name suggestions could not load.";
 });
 const kindControl=form.querySelector("#nmcCatalogKind"),nameControl=form.querySelector("#nmcCatalogTemplate"),customWrap=form.querySelector("#nmcCatalogCustomWrap");
 const refreshNames=()=>{
   const options=serviceNameOptions(kindControl.value,observed[kindControl.value]||[]);
   const previous=nameControl.value;
   nameControl.replaceChildren();
   for(const name of options){const option=document.createElement("option");option.value=name;option.textContent=name;nameControl.append(option)}
   const option=document.createElement("option");option.value="__custom__";option.textContent="Custom service / not listed…";nameControl.append(option);
   customWrap.hidden=nameControl.value!=="__custom__";customWrap.querySelector("input").required=!customWrap.hidden;
 };
 const nameChanged=()=>{customWrap.hidden=nameControl.value!=="__custom__";customWrap.querySelector("input").required=!customWrap.hidden};
 kindControl.addEventListener("change",refreshNames);nameControl.addEventListener("change",nameChanged);refreshNames();
 mountBulkPricing({target:target.querySelector(".nmc-catalog"),records:rows,observed:[]});
 form.onsubmit=async e=>{
  e.preventDefault();const f=new FormData(form);const name=String(f.get("templateName")==="__custom__"?f.get("customName"):f.get("templateName")).trim(),kind=String(f.get("kind")),priceCents=readPrice(f.get("price")),code=String(f.get("code")||"").trim();
  const notice=target.querySelector("#nmcCatalogNotice");
  if(name.length<2){notice.textContent="Choose a service or enter a custom service name.";return;}
  const same=rows.find(r=>r.kind===kind&&(normalize(r.name)===normalize(name)||(code&&normalize(r.code)===normalize(code))));
  if(same){notice.textContent="This service already exists. Edit its price or reactivate its archived entry.";return;}
  const button=form.querySelector('[type="submit"]');button.disabled=true;
  try{const key=kind+"_"+normalize(name).replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,140);if(key.length<4)throw Error("Enter a descriptive service name.");const ref=doc(db(),"serviceCatalog",key);if((await getDoc(ref)).exists())throw Error("This service already exists. Edit its price or reactivate it.");const batch=writeBatch(db());
   batch.set(ref,{name,kind,code,priceCents,active:true,version:1,createdBy:auth().currentUser.uid,createdAt:serverTimestamp(),updatedBy:auth().currentUser.uid,updatedAt:serverTimestamp()});
   batch.set(doc(collection(db(),"serviceCatalog",ref.id,"revisions")),{action:"created",priceCents,name,actorUid:auth().currentUser.uid,at:serverTimestamp()});
   await batch.commit();notice.textContent="Price saved.";form.reset();refreshNames();
  }catch(err){notice.textContent=err.message;}finally{button.disabled=false;}
 };
 function confirmRateRemoval(r){
  if(profile.role!=="administrator")return;
  const dialog=document.createElement("dialog");
  dialog.className="nmc-billing-dialog nmc-catalog-delete-dialog";
  const form=document.createElement("form");form.className="nmc-billing-dialog-inner";form.method="dialog";
  const title=document.createElement("h2");title.textContent="Delete service price?";
  const description=document.createElement("p");
  description.textContent="Delete "+r.name+" ("+cash(r.priceCents)+") permanently from Service Prices? Future encounters will no longer receive this rate. Previously issued invoices and their itemized charges will not be changed.";
  const reasonLabel=document.createElement("label");reasonLabel.textContent="Reason (optional)";
  const reason=document.createElement("input");reason.name="reason";reason.maxLength=250;
  reason.placeholder="e.g. Duplicate or entered by mistake";reasonLabel.append(reason);
  const actions=document.createElement("div");actions.className="nmc-bill-footer";
  const cancel=document.createElement("button");cancel.type="button";cancel.textContent="Keep service";
  const confirm=document.createElement("button");confirm.type="submit";confirm.className="nmc-confirm-delete";confirm.textContent="Delete permanently";
  const notice=document.createElement("p");notice.className="nmc-bill-error";notice.setAttribute("role","status");
  actions.append(cancel,confirm);form.append(title,description,reasonLabel,actions,notice);dialog.append(form);document.body.append(dialog);
  cancel.onclick=()=>dialog.close();
  dialog.addEventListener("close",()=>dialog.remove(),{once:true});
  form.onsubmit=async event=>{
   event.preventDefault();confirm.disabled=true;cancel.disabled=true;notice.textContent="Removing service price…";
   try{
    const user=auth().currentUser;if(!user)throw Error("Sign in again before deleting.");
    const reference=doc(db(),"serviceCatalog",r.id);
    const current=await getDoc(reference);
    if(!current.exists())throw Error("This service has already been deleted.");
    const revisions=await getDocs(collection(db(),"serviceCatalog",r.id,"revisions"));
    if(revisions.size>400)throw Error("Too many price revisions for safe removal. Contact an administrator for assistance.");
    const latest=current.data();
    const batch=writeBatch(db());
    const audit=doc(collection(db(),"serviceCatalogDeletions"));
    batch.set(audit,{serviceId:r.id,name:latest.name,kind:latest.kind,code:latest.code||"",
     priceCents:latest.priceCents,version:latest.version||1,revisionCount:revisions.size,
     reason:reason.value.trim()||"Removed by administrator",actorUid:user.uid,at:serverTimestamp()});
    revisions.forEach(x=>batch.delete(x.ref));
    batch.delete(reference);
    await batch.commit();
    dialog.close();
    const info=target.querySelector("#nmcCatalogNotice");if(info)info.textContent=r.name+" deleted. Existing invoices are unchanged.";
   }catch(err){notice.textContent="Could not delete: "+err.message;confirm.disabled=false;cancel.disabled=false;}
  };
  dialog.showModal();
 }
 async function saveChange(r,changes){
  const batch=writeBatch(db());
  batch.update(doc(db(),"serviceCatalog",r.id),{...changes,version:(r.version||1)+1,updatedBy:auth().currentUser.uid,updatedAt:serverTimestamp()});
  batch.set(doc(collection(db(),"serviceCatalog",r.id,"revisions")),{action:changes.active===false?"archived":changes.active===true?"reactivated":"price-updated",priceCents:changes.priceCents??r.priceCents,name:r.name,actorUid:auth().currentUser.uid,at:serverTimestamp()});
  await batch.commit();
 }
 function editRate(r){
  const modal=document.createElement("dialog");modal.className="nmc-billing-dialog";modal.innerHTML='<form class="nmc-billing-dialog-inner"><h2>Edit price</h2><p>'+esc(r.name)+' · '+esc(kindTitle[r.kind]||"Service")+'</p><label>New rate ($)<input name="price" type="number" min="0" max="9999999.99" step="0.01" required value="'+(r.priceCents/100).toFixed(2)+'"></label><label>Reason for price change<textarea name="reason" minlength="5" maxlength="250" required></textarea></label><div class="nmc-bill-footer"><button type="button" class="nmc-close-rate">Cancel</button><button type="submit">Save updated price</button></div><p class="nmc-rate-error" role="status"></p></form>';
  document.body.append(modal);modal.showModal();modal.addEventListener("close",()=>modal.remove());modal.querySelector(".nmc-close-rate").onclick=()=>modal.close();
  modal.querySelector("form").onsubmit=async ev=>{ev.preventDefault();const priceCents=readPrice(new FormData(ev.target).get("price"));const reason=String(new FormData(ev.target).get("reason")).trim();const button=ev.target.querySelector('[type="submit"]');button.disabled=true;
   try{const batch=writeBatch(db());batch.update(doc(db(),"serviceCatalog",r.id),{priceCents,version:(r.version||1)+1,updatedBy:auth().currentUser.uid,updatedAt:serverTimestamp()});
   batch.set(doc(collection(db(),"serviceCatalog",r.id,"revisions")),{action:"price-updated",priceCents,previousPriceCents:r.priceCents,reason,actorUid:auth().currentUser.uid,at:serverTimestamp()});
   await batch.commit();modal.close();
   }catch(err){modal.querySelector(".nmc-rate-error").textContent=err.message;button.disabled=false;}
  };
 }
}
export function buildCatalogQuote({encounterId,catalog,orders,procedures,encounter={},admissions=[]}){
 const activeRates=catalog.filter(x=>x.active!==false);
 const rate=new Map(activeRates.map(x=>[x.kind+":"+normalize(x.name),x]));
 const codeRate=new Map(activeRates.filter(x=>x.code).map(x=>[x.kind+":"+normalize(x.code),x]));
 const lines=[],unpriced=[];
 const push=(type,name,sourceId,qty=1,code="")=>{
  const item=rate.get(type+":"+normalize(name))||(code?codeRate.get(type+":"+normalize(code)):undefined);
  if(!item){unpriced.push({kind:type,name,sourceId});return;}
  lines.push({serviceId:item.id,serviceName:item.name,description:item.name,sourceType:type,sourceId,quantity:qty,unitPriceCents:item.priceCents,amountCents:item.priceCents*qty,rateVersion:item.version||1});
 };
 const visits=catalog.filter(x=>x.active!==false&&x.kind==="visit");
 const defaultVisit=visits.find(x=>normalize(x.name)==="emergency visit")||(visits.length===1?visits[0]:null);
 if(defaultVisit)push("visit",defaultVisit.name,"visit:"+encounterId);
 else if(visits.length>1)unpriced.push({kind:"visit",name:"Multiple facility rates configured — use a rate named Emergency Visit",sourceId:encounterId});
 const arrival=normalize(encounter.arrivalMethod);
 if(arrival==="ems"||arrival==="ambulance"){
   const ems=activeRates.filter(x=>x.kind==="ems");
   const emsRate=ems.find(x=>normalize(x.name)==="ems transport")||(ems.length===1?ems[0]:null);
   if(emsRate)push("ems",emsRate.name,"arrival:"+encounterId);
   else unpriced.push({kind:"ems",name:"EMS Transport",sourceId:"arrival:"+encounterId});
 }
 const admission=admissions.find(a=>a.data?.status!=="cancelled");
 const department=normalize(admission?.data?.service||encounter.department||"");
 const room=normalize(admission?.data?.bed||encounter.room||"");
 let roomType="";
 if(room.startsWith("or-")||room.includes("operating"))roomType="Operating Room";
 else if(room.startsWith("tr-")||room.includes("trauma"))roomType="Trauma Room";
 else if(room.startsWith("obs-")||room.includes("observ"))roomType="Observation Room";
 else if(room.startsWith("icu")||department==="icu")roomType="ICU Room";
 else if(room.startsWith("ped")||department.includes("pediatr"))roomType="Pediatric Room";
 else if(room.startsWith("er-")||room.startsWith("ed-")||room.includes("emergency"))roomType="Emergency Room";
 else if(room||["med/surg","medical","surgical"].includes(department))roomType="Med/Surg Room";
 if(roomType&&room)push("room",roomType,"room:"+encounterId);
 const deptServices={"med/surg":"Med/Surg Services","icu":"ICU Services","pediatrics":"Pediatric Services","observation":"Observation Services"};
 if(deptServices[department])push("service",deptServices[department],"service:"+encounterId);
 for(const d of orders){const item=d.data||{};if(["cancelled","canceled","void"].includes(String(item.status||"").toLowerCase()))continue;push("order",item.name||item.orderName||"Unnamed order",d.id,1,item.serviceCode||item.orderCode||item.code||"");}
 for(const d of procedures){const item=d.data||{};if(!["complete","completed","done"].includes(String(item.status||"").toLowerCase()))continue;push("procedure",item.name||"Unnamed procedure",d.id,1,item.serviceCode||item.procedureCode||item.code||"");}
 return {lines,unpriced,catalog:catalog.filter(x=>x.active!==false),totalCents:lines.reduce((a,x)=>a+x.amountCents,0)};
}


export async function collectEncounterCharges(encounterId){
 const [catalog,orders,procedures,encounterSnap,admissionsSnap]=await Promise.all([
  listCatalog(),
  getDocs(query(collection(db(),"orders"),where("encounterId","==",encounterId))),
  getDocs(query(collection(db(),"procedures"),where("encounterId","==",encounterId))),
  getDoc(doc(db(),"encounters",encounterId)),
  getDocs(query(collection(db(),"admissions"),where("encounterId","==",encounterId)))
 ]);
 if(!encounterSnap.exists())throw Error("Encounter is missing; cannot calculate charges.");
 return buildCatalogQuote({encounterId,catalog,encounter:encounterSnap.data(),
  admissions:admissionsSnap.docs.map(d=>({id:d.id,data:d.data()})),
  orders:orders.docs.map(d=>({id:d.id,data:d.data()})),
  procedures:procedures.docs.map(d=>({id:d.id,data:d.data()}))
 });
}
