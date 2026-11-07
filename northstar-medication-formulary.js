// Shared, role-managed medication formulary for the Northstar hospital simulation.
// This catalogs products; it does not prescribe, administer, or create stock automatically.
import {getApp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {getAuth} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {getFirestore,collection,doc,serverTimestamp,writeBatch} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const escapeHtml=value=>String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const clean=value=>String(value??"").trim().replace(/\s+/g," ");
const allowedGroups=new Set(["antibiotics","medications","fluids"]);
const allowedForms=new Set(["Tablet","Capsule","Oral liquid","Injection","IV fluid","Nebulizer","Topical","Other"]);
export const medicationDisplayName=med=>clean(med.name)+(med.strength?" — "+clean(med.strength):"")+(med.form?" ("+clean(med.form)+")":"");
const medicationId=med=>encodeURIComponent([med.name,med.strength,med.form].map(x=>clean(x).toLowerCase()).join("|"));
const mayManage=role=>role==="administrator"||role==="pharmacist";

export function renderMedicationFormulary(ctx){
 const medications=(ctx.data?.nmcMedicationCatalog||[]).slice().sort((a,b)=>medicationDisplayName(a).localeCompare(medicationDisplayName(b)));
 const active=medications.filter(x=>x.status==="active").length;
 const manage=mayManage(ctx.profile?.role);
 const rows=medications.map(med=>`<article class="n4-med-entry" data-nmc-med-entry="${escapeHtml(med.id)}">
   <div><strong>${escapeHtml(medicationDisplayName(med))}</strong><small>${escapeHtml(med.group==="antibiotics"?"Antibiotic":med.group==="fluids"?"IV fluid":"Other medication")} · ${med.status==="active"?"Available for new orders":"Inactive"}</small>${med.notes?`<small>${escapeHtml(med.notes)}</small>`:""}</div>
   ${manage?`<button type="button" class="secondary-button compact" data-nmc-med-toggle="${escapeHtml(med.id)}">${med.status==="active"?"Deactivate":"Reactivate"}</button>`:""}
 </article>`).join("");
 return `<section class="n4-panel n4-med-formulary" aria-label="Medication catalog">
   <header><h3>Medication Catalog & Formulary</h3><small>${active} active · ${medications.length} total. Active entries appear in the provider order dropdown. Existing orders are not changed.</small></header>
   <label class="n4-med-filter">Search catalog<input type="search" data-nmc-med-filter placeholder="Search medication, strength or form"></label>
   <div class="n4-med-list" data-nmc-med-list>${rows||'<p class="n4-empty">No custom medications yet. Add the first one below.</p>'}</div>
   ${manage?`<form class="n4-stock-form n4-med-add-form" data-nmc-med-add>
     <h4>Add a new medication</h4>
     <div class="n4-fields">
       <label>Medication name<input name="name" required minlength="2" maxlength="120" placeholder="e.g. Amoxicillin" autocomplete="off"></label>
       <label>Strength / concentration<input name="strength" maxlength="60" placeholder="e.g. 500 mg or 10 mg/mL"></label>
       <label>Form<select name="form" required><option value="">Choose a form</option>${[...allowedForms].map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("")}</select></label>
       <label>Order category<select name="group" required><option value="medications">Other medications</option><option value="antibiotics">Antibiotics</option><option value="fluids">IV fluids</option></select></label>
       <label class="n4-med-wide">Catalog note (optional)<textarea name="notes" maxlength="240" rows="2" placeholder="RP description or inventory notes"></textarea></label>
     </div>
     <button class="n4-primary" type="submit">Add to medication catalog</button>
     <p class="n4-message" role="status" aria-live="polite"></p>
   </form>`:'<p class="n4-med-help">An administrator or pharmacist can add, deactivate, or reactivate medications.</p>'}
   <p class="n4-med-help">The formulary controls what can be newly ordered in the RP. Physical stock quantities are tracked separately in Pharmacy Inventory. A medication order still requires a provider to enter dose, route, and frequency.</p>
 </section>`;
}

export function bindMedicationFormulary(target,ctx){
 if(!target)return;
 const rows=[...target.querySelectorAll("[data-nmc-med-entry]")];
 const filter=target.querySelector("[data-nmc-med-filter]");
 if(filter)filter.addEventListener("input",()=>{
  const query=filter.value.trim().toLowerCase();
  for(const row of rows)row.hidden=!!query&&!row.textContent.toLowerCase().includes(query);
 });
 if(!mayManage(ctx.profile?.role))return;
 const form=target.querySelector("[data-nmc-med-add]");
 if(form)form.addEventListener("submit",async event=>{
  event.preventDefault();
  const status=form.querySelector(".n4-message");
  const submit=form.querySelector('button[type="submit"]');
  const data=Object.fromEntries(new FormData(form));
  const med={name:clean(data.name),strength:clean(data.strength),form:clean(data.form),group:clean(data.group),notes:clean(data.notes)};
  if(med.name.length<2||med.name.length>120||med.strength.length>60||!allowedForms.has(med.form)||!allowedGroups.has(med.group)||med.notes.length>240){
   status.textContent="Check the medication name, form, category, and field lengths.";return;
  }
  const key=medicationId(med);
  if((ctx.data?.nmcMedicationCatalog||[]).some(x=>x.id===key)){
   status.textContent="This medication, strength, and form already exists. Reactivate it below if needed.";return;
  }
  submit.disabled=true;
  try{
   const user=getAuth(getApp()).currentUser;
   if(!user)throw Error("Sign in again.");
   const db=getFirestore(getApp()),audit=doc(collection(db,"nmcDepartmentAudit")),record=doc(db,"nmcMedicationCatalog",key),batch=writeBatch(db);
   batch.set(record,{...med,status:"active",createdBy:user.uid,updatedBy:user.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),auditEventId:audit.id});
   batch.set(audit,{collection:"nmcMedicationCatalog",recordId:key,action:"created",from:"",to:"active",reason:"New medication added to formulary",actorUid:user.uid,createdAt:serverTimestamp()});
   await batch.commit();
   status.textContent="Medication added. It is now available in new provider orders.";
   form.reset();
  }catch(error){status.textContent=error?.message||"Unable to add medication.";}
  finally{submit.disabled=false;}
 });
 target.addEventListener("click",async event=>{
  const button=event.target.closest("[data-nmc-med-toggle]");
  if(!button||!target.contains(button))return;
  const med=(ctx.data?.nmcMedicationCatalog||[]).find(x=>x.id===button.dataset.nmcMedToggle);
  if(!med)return;
  const next=med.status==="active"?"inactive":"active";
  if(next==="inactive"&&window.NorthstarDialog?.confirm){
   const ok=await window.NorthstarDialog.confirm({title:"Deactivate medication?",message:"This will remove it from new medication orders, but preserve existing orders and history.",confirmText:"Deactivate",cancelText:"Cancel"});
   if(!ok)return;
  }
  button.disabled=true;
  try{
   const user=getAuth(getApp()).currentUser;if(!user)throw Error("Sign in again.");
   const db=getFirestore(getApp()),audit=doc(collection(db,"nmcDepartmentAudit")),batch=writeBatch(db);
   batch.update(doc(db,"nmcMedicationCatalog",med.id),{status:next,updatedAt:serverTimestamp(),updatedBy:user.uid,auditEventId:audit.id});
   batch.set(audit,{collection:"nmcMedicationCatalog",recordId:med.id,action:"status",from:med.status,to:next,actorUid:user.uid,createdAt:serverTimestamp()});
   await batch.commit();
  }catch(error){
   const message=target.querySelector(".n4-med-add-form .n4-message")||target.querySelector(".n4-med-help");
   if(message)message.textContent=error?.message||"Unable to update medication.";
   button.disabled=false;
  }
 });
}
