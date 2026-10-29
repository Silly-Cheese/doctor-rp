// Northstar 4.0 departmental workspaces (hospital simulation).
import {getApp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {getAuth} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {getFirestore,doc,collection,writeBatch,serverTimestamp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {DEPARTMENT_BY_KEY,DEPARTMENTS,mayAccessDepartment,mayCreateDepartment,mayUpdateDepartment,summarizeDepartment,departmentVisibility,validateDepartmentRecord} from "./northstar-v4-registry.js";
const esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const money=v=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format((Number(v)||0)/100);
const time=v=>{const t=v?.toDate?.()||v?.seconds&&new Date(v.seconds*1000);return t instanceof Date&&!isNaN(t)?t.toLocaleString("en-US",{dateStyle:"medium",timeStyle:"short"}):"Not recorded"};
const displayPatient=p=>p?.displayName||[p?.firstName,p?.lastName].filter(Boolean).join(" ")||p?.patientName||"Patient";
const store=()=>getFirestore(getApp()),account=()=>getAuth(getApp()).currentUser;
const priority={routine:"Routine",urgent:"Urgent",emergency:"Emergency",stat:"STAT"};
const describe=(key,x)=>{
 switch(key){
  case "surgery4":return [x.procedureName,x.patientName||x.patientId,x.room+" · "+x.scheduledDate];
  case "infection4":return [x.reason,x.patientName||x.patientId,x.precautions];
  case "sterile4":return [x.trayName,x.trayCode,x.department];
  case "transport4":return [x.origin+" → "+x.destination,x.patientName||x.patientId,x.priority||"Routine"];
  case "pharmacy4":return [x.medicationName,x.patientName||x.patientId,"Order "+String(x.orderId||"").slice(0,9)+" · Quantity "+(x.quantity||"")];
  default:return [x.title||"Record",x.status||"",x.id||""];
 }
};
const stat=(name,value,description="")=>'<article class="n4-stat"><span>'+esc(name)+'</span><strong>'+esc(value)+'</strong><small>'+esc(description)+'</small></article>';
function options(list,placeholder="Select…"){
 return '<option value="">'+esc(placeholder)+'</option>'+list.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join("");
}
function input(name,label,type="text",required=true,extra=""){
 return '<label>'+esc(label)+'<input type="'+type+'" name="'+name+'" '+(required?"required":"")+' '+extra+'></label>';
}
function select(name,label,values,required=true){
 return '<label>'+esc(label)+'<select name="'+name+'" '+(required?"required":"")+'>'+values.map(([id,title])=>'<option value="'+esc(id)+'">'+esc(title)+'</option>').join("")+'</select></label>';
}
function patientFields(context,onlyOrder=false){
 const patients=(context.patients||[]).slice().sort((a,b)=>displayPatient(a).localeCompare(displayPatient(b)));
 return '<label>Patient<select name="patientId" required>'+options(patients.map(p=>({id:p.id,name:displayPatient(p)})),"Choose patient")+'</select></label>'+
 '<label>Encounter<select name="encounterId" required><option value="">Choose a patient first</option></select></label>'+
 (onlyOrder?'<label>Verified medication order<select name="orderId" required><option value="">Choose an encounter first</option></select></label>':'');
}
function formMarkup(key,ctx){
 const patient=patientFields(ctx,key==="pharmacy4");
 switch(key){
  case "surgery4":return patient+input("procedureName","Surgical case / procedure","text",true,'maxlength="140" placeholder="Documented surgical service"')+
   input("room","Operating room / planned room","text",true,'maxlength="50" placeholder="OR-01"')+
   input("scheduledDate","Scheduled date","date")+select("priority","Priority",Object.entries(priority).filter(x=>x[0]!=="stat"))+
   select("assignedUid","Surgeon or case owner",[["","Unassigned"],...(ctx.users||[]).filter(x=>x.status==="active").map(x=>[x.id,x.displayName||x.email||x.id])],false);
  case "infection4":return patient+input("reason","Precaution or infection concern","text",true,'minlength="5" maxlength="160"')+
   select("precautions","Precaution category",[["standard","Standard"],["contact","Contact"],["droplet","Droplet"],["airborne","Airborne"],["review","Pending review"]])+
   input("summary","Review notes","text",false,'maxlength="240" placeholder="No sensitive information beyond the linked simulation record"');
  case "sterile4":return input("trayName","Instrument tray name","text",true,'minlength="3" maxlength="120"')+
   input("trayCode","Unique tray identifier","text",true,'minlength="2" maxlength="50"')+
   input("department","Responsible department","text",true,'maxlength="80" placeholder="Operating Rooms"');
  case "transport4":return patient+input("origin","Pickup location","text",true,'maxlength="100" placeholder="Emergency Department"')+
   input("destination","Destination","text",true,'maxlength="100" placeholder="Operating Room"')+
   select("priority","Priority",[["routine","Routine"],["urgent","Urgent"],["stat","STAT"]])+
   select("assignedUid","Assigned transport staff",[["","Unassigned"],...(ctx.users||[]).filter(x=>x.status==="active").map(x=>[x.id,x.displayName||x.email||x.id])],false);
  case "pharmacy4":return patient+input("medicationName","Order medication (select order to populate)","text",true,'readonly maxlength="120"')+
   input("quantity","Quantity to dispense (simulation units)","number",true,'min="1" max="10000" step="1"')+
   input("note","Dispensing note","text",false,'maxlength="220" placeholder="Verification or supply reference"');
 }
 return "";
}
function filterRows(key,data){
 const dept=DEPARTMENT_BY_KEY[key];
 return (data[dept.collection]||[]).slice().sort((a,b)=>String(b.createdAt?.seconds||"").localeCompare(String(a.createdAt?.seconds||"")));
}
function statusFields(key,record){
 const dept=DEPARTMENT_BY_KEY[key];
 const allowed=dept.statuses;
 return '<label class="n4-status-control"><span>Stage</span><select data-n4-status="'+esc(key)+'" data-record-id="'+esc(record.id)+'" aria-label="Update '+esc(describe(key,record)[0])+'">'+allowed.map(st=>'<option '+(record.status===st?"selected":"")+' value="'+esc(st)+'">'+esc(st.replaceAll("-"," "))+'</option>').join("")+'</select></label>';
}
function renderRelated(key,ctx){
 const d=ctx.data||{};
 if(key==="surgery4"){
  const cases=d.nmcSurgicalCases||[],transport=d.nmcTransportRequests||[],sterile=d.nmcSterileRequests||[];
  return '<div class="n4-panels">'+panel("Surgical preparation",cases.slice(0,20).map(x=>{
   const linkedTransport=transport.some(t=>t.surgeryId===x.id),linkedSterile=sterile.some(t=>t.surgeryId===x.id);
   return mini(x.procedureName||"Case",(linkedSterile?"Sterile request ✓":"Sterile request pending")+" · "+(linkedTransport?"Transport request ✓":"Transport request pending"),x.status);
  }).join(""),"Automatic requests appear when the Firebase trigger is deployed.")+
  panel("Operating rooms",(d.rooms||[]).slice(0,20).map(x=>mini(x.name||x.number||x.id,x.department||x.type||"Operating room",x.status||"Not set")).join(""))+'</div>';
 }
 if(key==="sterile4")return panel("Surgical instrument requests",(d.nmcSterileRequests||[]).map(x=>
  '<div class="n4-mini"><div><strong>'+esc(x.procedureName||x.surgeryId)+'</strong><small>Case '+esc(x.surgeryId||"")+'</small></div>'+
  (mayUpdateDepartment(ctx.profile?.role,key)?'<select data-n4-sterile-request="'+esc(x.id)+'" aria-label="Readiness of '+esc(x.procedureName)+'">'+["requested","preparing","ready","delivered","cancelled"].map(t=>'<option value="'+t+'" '+(x.status===t?"selected":"")+'>'+t+'</option>').join("")+'</select>':'<span>'+esc(x.status||"requested")+'</span>')+'</div>'
 ).join(""),"Linked from surgical cases. Mark readiness after the required checks.");
 if(key==="pharmacy4"){
  const stock=d.nmcPharmacyStock||[];
  const stockForm=mayCreateDepartment(ctx.profile?.role,key)?'<form class="n4-stock-form" data-n4-stock-create><h4>Register medication stock</h4><div class="n4-fields">'+
   input("itemName","Medication or product name","text",true,'minlength="2" maxlength="120"')+
   input("sku","Stock / inventory code","text",true,'minlength="2" maxlength="50"')+
   input("quantity","Available units","number",true,'min="0" max="100000" step="1"')+
   input("location","Stock location","text",true,'maxlength="80" placeholder="Main Pharmacy"')+
   '</div><button class="n4-primary" type="submit">Add stock item</button><p class="n4-message" role="status"></p></form>':"";
  const stockRows=stock.map(x=>'<div class="n4-stock-row"><div><strong>'+esc(x.itemName)+'</strong><small>'+esc(x.sku)+' · '+esc(x.location)+'</small></div>'+
   '<span>'+esc(x.quantity)+' units</span>'+(mayUpdateDepartment(ctx.profile?.role,key)?'<button type="button" data-n4-stock-adjust="'+esc(x.id)+'">Adjust</button>':"")+'</div>').join("");
  return panel("Medication orders awaiting dispense",(d.orders||[]).filter(x=>x.category==="medication"&&!["cancelled","discontinued"].includes(x.status)).slice(0,35).map(x=>mini(x.name,x.patientName||x.patientId,x.status||"Ordered")).join(""),
   "Dispensing is a separate staff action; it does not mark medication as administered.")+
   panel("Pharmacy inventory",stockRows+stockForm,"Independent stock quantities; no automatic consumption from unverified clinical orders.");
 }
 if(key==="infection4")return panel("Existing laboratory results",(d.results||[]).filter(x=>x.abnormal).slice(0,20).map(x=>mini(x.summary||x.name||"Result",x.patientName||"",x.status)).join(""),"Results are displayed for context only; reviews do not make clinical diagnoses.");
 if(key==="transport4")return panel("Patient movement context",(d.admissions||[]).slice(0,20).map(x=>mini(x.patientName||x.patientId,x.bed||x.room||"No bed",x.status)).join(""));
 return "";
}
const mini=(title,sub,status)=>'<div class="n4-mini"><div><strong>'+esc(title||"Untitled")+'</strong><small>'+esc(sub||"")+'</small></div><span>'+esc(status||"")+'</span></div>';
const panel=(title,content="",description="")=>'<section class="n4-panel"><header><h3>'+esc(title)+'</h3><small>'+esc(description)+'</small></header>'+ (content||'<p class="n4-empty">Nothing is pending.</p>')+'</section>';
function populateLinked(form,ctx){
 const p=form.querySelector('[name="patientId"]'),e=form.querySelector('[name="encounterId"]'),order=form.querySelector('[name="orderId"]');
 if(!p||!e)return;
 const loadEncounters=()=>{
  const old=e.value;
  const encounters=(ctx.encounters||[]).filter(x=>x.patientId===p.value).map(x=>({id:x.id,name:(x.status||"Encounter")+" · "+(x.chiefComplaint||x.id.slice(0,10))}));
  e.innerHTML=options(encounters,"Choose encounter");
  if(encounters.some(x=>x.id===old))e.value=old;
  loadOrders();
 };
 const loadOrders=()=>{
  if(!order)return;
  const result=(ctx.data.orders||[]).filter(x=>x.patientId===p.value&&x.encounterId===e.value&&x.category==="medication"&&!["cancelled","discontinued"].includes(x.status));
  order.innerHTML=options(result.map(x=>({id:x.id,name:x.name||"Medication order"})),"Choose medication order");
  const name=form.querySelector('[name="medicationName"]');
  if(name)name.value=result.find(x=>x.id===order.value)?.name||"";
 };
 p.addEventListener("change",loadEncounters);e.addEventListener("change",loadOrders);
 order?.addEventListener("change",()=>{
  const selected=(ctx.data.orders||[]).find(x=>x.id===order.value);
  form.querySelector('[name="medicationName"]').value=selected?.name||"";
 });
 loadEncounters();
}
function auditEnvelope(key,id,action,from,to,user){
 return {collection:DEPARTMENT_BY_KEY[key].collection,recordId:id,action,from:from||"",to:to||"",actorUid:user.uid,createdAt:serverTimestamp()};
}
function bindForm(form,key,ctx){
 const box=form.querySelector(".n4-message"),button=form.querySelector("button[type=submit]");
 populateLinked(form,ctx);
 form.onsubmit=async e=>{
  e.preventDefault();if(!account())return;
  button.disabled=true;box.textContent="Saving…";
  try{
   if(!mayAccessDepartment(ctx.profile?.role,key))throw Error("Department access denied.");
   const payload=validateDepartmentRecord(key,Object.fromEntries(new FormData(form)),{patients:ctx.patients,encounters:ctx.encounters,orders:ctx.data.orders||[]});
   const user=account(),reference=doc(collection(store(),DEPARTMENT_BY_KEY[key].collection));
   const base={...payload,status:key==="sterile4"?"available":"requested",createdAt:serverTimestamp(),updatedAt:serverTimestamp(),createdBy:user.uid,updatedBy:user.uid};
   if(key==="surgery4")base.status="scheduled";
   if(key==="infection4")base.status="open";
   if(key==="pharmacy4")base.status="requested";
   if(key==="transport4")base.status="requested";
   if(key==="surgery4"||key==="infection4"||key==="transport4"||key==="pharmacy4"){
    const patient=ctx.patients.find(x=>x.id===payload.patientId);
    base.patientName=displayPatient(patient);
   }
   const batch=writeBatch(store()),auditRef=doc(collection(store(),"nmcDepartmentAudit"));base.auditEventId=auditRef.id;
   batch.set(reference,base);
   batch.set(auditRef,auditEnvelope(key,reference.id,"created","",base.status,user));
   await batch.commit();
   box.textContent="Saved. New record is linked to the existing hospital data.";
   form.reset();populateLinked(form,ctx);
  }catch(error){box.textContent=error.message||String(error);}
  finally{button.disabled=false;}
 };
}
export function renderDepartment(key,ctx){
 const model=DEPARTMENT_BY_KEY[key],target=document.querySelector("#enterprise-"+key);
 if(!model||!target)return;
 if(!mayAccessDepartment(ctx.profile?.role,key)){
  target.innerHTML='<div class="n4-workspace"><h2>Restricted department</h2><p>Your role does not have permission to view this department.</p></div>';return;
 }
 const records=filterRows(key,ctx.data),summary=summarizeDepartment(key,records);
 const userRole=ctx.profile?.role||"staff";
 const createName={surgery4:"Schedule surgical case",infection4:"Open prevention review",sterile4:"Register instrument tray",transport4:"Request transport",pharmacy4:"Request medication dispensing"}[key];
 const label={surgery4:"Surgical cases",infection4:"Prevention reviews",sterile4:"Instrument trays",transport4:"Transport requests",pharmacy4:"Dispensing requests"}[key];
 const markup='<div class="n4-workspace"><header class="n4-head"><div><p class="eyebrow">NORTHSTAR 4.0 / DEPARTMENTS</p><h2>'+esc(model.title)+'</h2><p>'+esc(model.intro)+'</p></div><span class="n4-role">'+esc(userRole)+'</span></header>'+
  '<div class="n4-stats">'+stat("Total records",summary.total)+stat("Active",summary.open)+stat("Completed / closed",summary.complete)+stat("Priority flags",summary.alerts)+'</div>'+
  '<div class="n4-tools"><button type="button" data-n4-panel="queue" class="n4-selected">Work queue</button>'+(mayCreateDepartment(ctx.profile?.role,key)?'<button type="button" data-n4-panel="new">New record</button>':"")+'<button type="button" data-n4-panel="context">Connected work</button></div>'+
  '<div class="n4-view" data-n4-view="queue"><section class="n4-panel"><header><h3>'+esc(label)+'</h3><label class="n4-search">Search records<input type="search" data-n4-search placeholder="Filter by name, status or location"></label></header><div class="n4-list" data-n4-list></div></section></div>'+
  '<div class="n4-view" data-n4-view="new" hidden><form class="n4-panel n4-form"><header><h3>'+esc(createName)+'</h3><small>Creates a simulated operational record. No clinical procedure or medication administration is automatically performed.</small></header><div class="n4-fields">'+formMarkup(key,ctx)+'</div><button type="submit" class="n4-primary">Save record</button><p class="n4-message" role="status"></p></form></div>'+
  '<div class="n4-view" data-n4-view="context" hidden>'+renderRelated(key,ctx)+'</div>'+
  '<footer class="n4-foot">All records use shared patient/encounter identifiers. State changes have an append-only audit trail. This module does not delete clinical records.</footer></div>';
 const priorForm=target.querySelector(".n4-form");
 const priorValues=priorForm?Object.fromEntries(new FormData(priorForm).entries()):null;
 const priorView=target.querySelector('[data-n4-panel].n4-selected')?.dataset.n4Panel||"queue";
 const priorSearch=target.querySelector("[data-n4-search]")?.value||"";
 target.innerHTML=markup;
 const list=target.querySelector("[data-n4-list]");
 const renderList=()=>{
  const term=target.querySelector("[data-n4-search]").value,visible=departmentVisibility(key,records,term);
  list.innerHTML=visible.length?visible.slice(0,150).map(x=>{
   const [title,sub,detail]=describe(key,x);
   return '<article class="n4-record"><div class="n4-record-main"><h4>'+esc(title)+'</h4><p>'+esc(sub)+' · '+esc(detail)+'</p><small>Created '+esc(time(x.createdAt))+'</small></div>'+(mayUpdateDepartment(ctx.profile?.role,key)?statusFields(key,x):'<span class="n4-role">'+esc(x.status)+'</span>')+'</article>';
  }).join(""):'<p class="n4-empty">No matching records. Create the first one using New record.</p>';
 };
 target.querySelector("[data-n4-search]").addEventListener("input",renderList);renderList();
 target.querySelectorAll("[data-n4-panel]").forEach(button=>button.onclick=()=>{
  const view=button.dataset.n4Panel;
  target.querySelectorAll("[data-n4-view]").forEach(node=>node.hidden=node.dataset.n4View!==view);
  target.querySelectorAll("[data-n4-panel]").forEach(node=>node.classList.toggle("n4-selected",node===button));
 });
 if(mayCreateDepartment(ctx.profile?.role,key)){
  bindForm(target.querySelector(".n4-form"),key,ctx);
  if(priorValues){
   const form=target.querySelector(".n4-form");
   for(const [name,value] of Object.entries(priorValues)){
    const field=form.elements.namedItem(name);if(!field)continue;
    field.value=value;
    if(name==="patientId"||name==="encounterId"||name==="orderId")field.dispatchEvent(new Event("change"));
   }
  }
 }
 if(priorSearch){target.querySelector("[data-n4-search]").value=priorSearch;renderList();}
 if(priorView!=="queue")target.querySelector('[data-n4-panel="'+priorView+'"]')?.click();
 const contextView=target.querySelector('[data-n4-view="context"]');
 if(key==="sterile4"&&mayUpdateDepartment(ctx.profile?.role,key)){
  contextView.addEventListener("change",async event=>{
   const sel=event.target.closest("[data-n4-sterile-request]");if(!sel)return;
   const record=(ctx.data.nmcSterileRequests||[]).find(x=>x.id===sel.dataset.n4SterileRequest);
   if(!record)return;
   const old=record.status,next=sel.value;if(old===next)return;
   sel.disabled=true;
   try{const u=account();if(!u)throw Error("Sign in again.");
    const reference=doc(store(),"nmcSterileRequests",record.id),auditRef=doc(collection(store(),"nmcDepartmentAudit")),batch=writeBatch(store());
    batch.update(reference,{status:next,updatedBy:u.uid,updatedAt:serverTimestamp(),auditEventId:auditRef.id});
    batch.set(auditRef,{collection:"nmcSterileRequests",recordId:record.id,action:"status",from:old,to:next,actorUid:u.uid,createdAt:serverTimestamp()});
    await batch.commit();
   }catch(err){sel.value=old;const p=document.createElement("p");p.className="n4-error";p.textContent=err.message;sel.after(p);}
   finally{sel.disabled=false;}
  });
 }
 if(key==="pharmacy4"){
  const stockForm=contextView.querySelector("[data-n4-stock-create]");
  if(stockForm)stockForm.onsubmit=async event=>{
   event.preventDefault();const message=stockForm.querySelector(".n4-message"),button=stockForm.querySelector("button[type=submit]");button.disabled=true;
   try{
    const payload=Object.fromEntries(new FormData(stockForm));
    if(!payload.itemName||payload.itemName.length<2||!payload.sku||payload.sku.length<2||!payload.location)throw Error("Complete the stock item details.");
    const qty=Number(payload.quantity);if(!Number.isSafeInteger(qty)||qty<0||qty>100000)throw Error("Enter a valid stock count.");
    const u=account(),reference=doc(collection(store(),"nmcPharmacyStock")),auditRef=doc(collection(store(),"nmcDepartmentAudit")),batch=writeBatch(store());
    batch.set(reference,{...payload,quantity:qty,status:"available",createdAt:serverTimestamp(),updatedAt:serverTimestamp(),createdBy:u.uid,updatedBy:u.uid,auditEventId:auditRef.id});
    batch.set(auditRef,{collection:"nmcPharmacyStock",recordId:reference.id,action:"created",from:"",to:"available",actorUid:u.uid,createdAt:serverTimestamp()});
    await batch.commit();message.textContent="Stock item registered.";stockForm.reset();
   }catch(err){message.textContent=err.message;}finally{button.disabled=false;}
  };
  contextView.addEventListener("click",async event=>{
   const button=event.target.closest("[data-n4-stock-adjust]");if(!button||!mayUpdateDepartment(ctx.profile?.role,key))return;
   const item=(ctx.data.nmcPharmacyStock||[]).find(x=>x.id===button.dataset.n4StockAdjust);if(!item)return;
   if(contextView.querySelector(".n4-stock-adjust-editor"))contextView.querySelector(".n4-stock-adjust-editor").remove();
   const panel=document.createElement("div");panel.className="n4-stock-adjust-editor";
   panel.innerHTML='<label>New inventory units<input type="number" name="units" min="0" max="100000" step="1" required></label><label>Reason for adjustment<input name="reason" required minlength="5" maxlength="200"></label><button type="button" class="n4-primary">Save audited adjustment</button><button type="button" class="n4-cancel">Cancel</button><p class="n4-message" role="status"></p>';
   panel.querySelector("[name=units]").value=String(item.quantity);
   panel.querySelector(".n4-cancel").onclick=()=>panel.remove();
   panel.querySelector(".n4-primary").onclick=async()=>{
    const qty=Number(panel.querySelector("[name=units]").value),reason=panel.querySelector("[name=reason]").value.trim(),save=panel.querySelector(".n4-primary");
    try{
     if(!Number.isSafeInteger(qty)||qty<0||qty>100000)throw Error("Invalid stock quantity.");
     if(reason.length<5)throw Error("Adjustment reason must be at least five characters.");
     save.disabled=true;
     const u=account(),auditRef=doc(collection(store(),"nmcDepartmentAudit")),batch=writeBatch(store());
     batch.update(doc(store(),"nmcPharmacyStock",item.id),{quantity:qty,updatedBy:u.uid,updatedAt:serverTimestamp(),auditEventId:auditRef.id});
     batch.set(auditRef,{collection:"nmcPharmacyStock",recordId:item.id,action:"stock-adjustment",from:String(item.quantity),to:String(qty),reason,actorUid:u.uid,createdAt:serverTimestamp()});
     await batch.commit();panel.querySelector(".n4-message").textContent="Stock change saved.";
    }catch(err){panel.querySelector(".n4-message").textContent=err.message;save.disabled=false;}
   };
   button.closest(".n4-stock-row").after(panel);
  });
 }
 list.onchange=async e=>{
  const select=e.target.closest("[data-n4-status]");if(!select)return;
  const model=DEPARTMENT_BY_KEY[select.dataset.n4Status],record=records.find(x=>x.id===select.dataset.recordId);
  if(!record||!model)return;
  const old=record.status,next=select.value;
  if(old===next)return;
  select.disabled=true;
  try{
   const user=account();if(!user)throw Error("Sign in again.");
   const batch=writeBatch(store()),auditRef=doc(collection(store(),"nmcDepartmentAudit"));
   batch.update(doc(store(),model.collection,record.id),{status:next,updatedBy:user.uid,updatedAt:serverTimestamp(),auditEventId:auditRef.id});
   batch.set(auditRef,auditEnvelope(key,record.id,"status",old,next,user));
   await batch.commit();
  }catch(error){select.value=old;const msg=document.createElement("p");msg.className="n4-error";msg.textContent=error.message;select.after(msg);}
  finally{select.disabled=false;}
 };
}
