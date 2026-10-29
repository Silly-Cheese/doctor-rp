// Northstar 3.0: connected, full-page hospital workspaces.
// Existing patient, staff and financial records remain in their original collections.
import {getApp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {getAuth} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {getFirestore,collection,doc,setDoc,updateDoc,serverTimestamp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";
import {patientTimeline,patientLabel,flowSummary,billingReview,integrityReview,dischargeReadiness,supplyReview,trainingReview,dateValue,dollars,notClosed} from "./northstar-v3-core.js";
export const V3_PAGES=[
 ["patient360","Patient Command Center","Care","▦"],
 ["hospitalFlow","Hospital Flow 3.0","Flow","◫"],
 ["revenue360","Revenue Intelligence","Administration","$"],
 ["quality360","Quality & Safety","Operations","◆"],
 ["staff360","Staff Scheduling","Operations","◷"],
 ["equipment360","Equipment & Inventory","Operations","▥"],
 ["academy360","Training Academy","Operations","★"],
 ["identity360","Record Integrity","Administration","◎"],
 ["portal360","Patient Portal Preview","Administration","▧"]
];
export const V3_MODULE_DATA={
 patient360:["orders","results","procedures","medicationAdministrations","admissions","emsArrivals","tasks","clinicalNotes","billingAccounts"],
 hospitalFlow:["rooms","admissions","emsArrivals","tasks","orders","clinicalAlerts","billingAccounts"],
 revenue360:["billingAccounts","orders","procedures","serviceCatalog"],
 quality360:["nmcQualityActions","clinicalAlerts"],
 staff360:["shifts","nmcShiftAssignments"],
 equipment360:["supplyItems","nmcEquipment"],
 academy360:["caseRuns","nmcTrainingRecords"],
 identity360:["orders","results","procedures","medicationAdministrations","admissions","emsArrivals","billingAccounts","tasks"],
 portal360:["billingAccounts","orders","results","admissions"]
};
const escape=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const formatDate=v=>dateValue(v)?new Date(dateValue(v)).toLocaleString("en-US",{dateStyle:"medium",timeStyle:"short"}):"Date not recorded";
const today=()=>new Date().toISOString().slice(0,10);
const admin=ctx=>ctx.profile?.status==="active"&&ctx.profile?.role==="administrator";
const user=()=>getAuth(getApp()).currentUser;
const store=()=>getFirestore(getApp());
let chosenPatient="",chosenEncounter="";
const stateText=items=>items.length?items.join(""):'<div class="n3-empty">Nothing requires attention in this area.</div>';
const stat=(label,value,sub="")=>'<article class="n3-stat"><span>'+escape(label)+'</span><strong>'+escape(value)+'</strong><small>'+escape(sub)+'</small></article>';
const section=(title,content,detail="")=>'<section class="n3-panel"><div class="n3-panel-head"><h3>'+escape(title)+'</h3><span>'+escape(detail)+'</span></div>'+content+'</section>';
const item=(name,subtitle,aside="")=>'<div class="n3-item"><div><strong>'+escape(name)+'</strong><small>'+escape(subtitle)+'</small></div><span>'+escape(aside)+'</span></div>';
const heading=(title,subtitle,phase)=>'<header class="n3-heading"><div><p class="eyebrow">NORTHSTAR 3.0 · '+escape(phase)+'</p><h2>'+escape(title)+'</h2><p>'+escape(subtitle)+'</p></div><span class="n3-simulation">SIMULATION / STAFF ACCESS</span></header>';
const jump=(key,label)=>'<button type="button" class="n3-btn" data-n3-jump="'+escape(key)+'">'+escape(label)+'</button>';
const short=(list,max=12)=>stateText(list.slice(0,max));
const asData=c=>({...c.data,patients:c.patients,encounters:c.encounters,users:c.users});
const canViewBilling=c=>admin(c)||c.profile?.permissions?.billingAccess===true||c.profile?.permissions?.billingManage===true||["physician","registration"].includes(c.profile?.role);
function renderPatient(c){
 const data=asData(c),patients=data.patients||[];
 if(!patients.length)return heading("Patient Command Center","One timeline across encounters, orders, results, medications and discharge.","Phase 2")+section("Patient records",'<div class="n3-empty">No patient records are available for this account.</div>');
 const patient=patients.find(p=>p.id===chosenPatient)||patients[0];chosenPatient=patient.id;
 const visits=(data.encounters||[]).filter(x=>x.patientId===patient.id).sort((a,b)=>dateValue(b.createdAt)-dateValue(a.createdAt));
 if(!visits.some(x=>x.id===chosenEncounter))chosenEncounter=visits[0]?.id||"";
 const visit=visits.find(x=>x.id===chosenEncounter);
 const all=patientTimeline(patient.id,data);
 const events=all.filter(x=>!visit||x.encounterId===visit.id||!x.encounterId);
 const select='<div class="n3-filters"><label>Patient<select id="n3-patient">'+patients.slice().sort((a,b)=>patientLabel(a).localeCompare(patientLabel(b))).map(p=>'<option value="'+escape(p.id)+'" '+(p.id===chosenPatient?"selected":"")+'>'+escape(patientLabel(p))+' · '+escape(p.mrn||p.id.slice(0,7))+'</option>').join("")+'</select></label>'+
 '<label>Encounter<select id="n3-encounter"><option value="">All encounters</option>'+visits.map(e=>'<option value="'+escape(e.id)+'" '+(e.id===chosenEncounter?"selected":"")+'>'+escape(e.status||"Encounter")+' · '+escape(formatDate(e.createdAt||e.arrivalAt))+'</option>').join("")+'</select></label></div>';
 const notes=visit?dischargeReadiness(visit,data):[];
 const clinical=events.map(x=>item(x.type+" · "+x.title,x.encounterId?"Encounter "+x.encounterId.slice(0,9):"Patient-level record",formatDate(x.createdAt)));
 const outstanding=section("Discharge readiness",notes.length?'<div class="n3-alert-list">'+notes.map(x=>item(x.type,x.count+" outstanding","Review")).join("")+'</div>':'<div class="n3-good">No outstanding readiness signals detected in the loaded records. This is not clinical clearance.</div>',
  visit?escape(visit.status||""):"Select an encounter");
 const billed=canViewBilling(c)?(data.billingAccounts||[]).filter(x=>x.patientId===patient.id).map(x=>item(x.invoiceNumber||"Invoice",x.status||"Open",dollars(x.patientBalanceCents||0))):[];
 return heading("Patient Command Center","A longitudinal view of the patient record, with every important step in one place.","Phase 2")+select+
 '<div class="n3-metrics">'+stat("Encounters",visits.length)+stat("Documented events",all.length)+stat("Active encounters",visits.filter(notClosed).length)+stat("Open clinical tasks",(data.tasks||[]).filter(x=>x.patientId===patient.id&&x.status!=="completed").length)+'</div>'+
 '<div class="n3-grid-2">'+section("Clinical timeline",'<div class="n3-timeline">'+short(clinical,80)+'</div>',events.length+" events")+outstanding+'</div>'+
 (canViewBilling(c)?section("Patient account summary",short(billed,15)+jump("billing","Open Billing & Revenue"),"Billing access required"):"");
}
function renderFlow(c){
 const d=asData(c),flow=flowSummary(d);
 return heading("Hospital Flow 3.0","Live encounter census, incoming EMS, bed occupancy and high-priority workflow checks.","Phase 2")+
 '<div class="n3-metrics">'+stat("Active encounters",flow.active)+stat("Waiting / triage",flow.waiting)+stat("Critical",flow.critical)+stat("EMS expected",flow.pendingEms)+stat("Occupied rooms",flow.occupied+" / "+flow.rooms)+'</div>'+
 '<div class="n3-grid-2">'+section("Active encounter board",short(flow.encounters.map(e=>item(e.patientName||e.patientId||"Patient",e.status||"Active",e.room||e.roomNumber||e.acuity||"")),50),flow.active+" records")+
 section("Bed occupancy & readiness",short((d.rooms||[]).map(r=>item(r.name||r.number||r.id,r.department||r.type||"Room",r.status||"Status unknown")),50),flow.rooms+" rooms")+'</div>'+
 '<div class="n3-grid-2">'+section("Incoming EMS",short((d.emsArrivals||[]).map(x=>item(x.patientName||x.callSign||"Arrival",x.details||x.chiefComplaint||"Incoming",x.status||"Pending")),20))+
 section("Operational actions",'<div class="n3-actions">'+jump("admissions","Manage admissions & beds")+jump("ems","Incoming EMS")+jump("discharge","Discharge Center")+jump("inbox","Clinical Inbox")+'</div>')+'</div>';
}
function renderRevenue(c){
 if(!canViewBilling(c))return heading("Revenue Intelligence","This workspace requires Billing access.","Phase 2")+section("Access restricted",'<div class="n3-empty">Ask an administrator to assign Billing Access.</div>');
 const d=asData(c),b=billingReview(d),a=b.aging;
 return heading("Revenue Intelligence","Reconcile clinical charges against invoices without changing or erasing financial records.","Phase 2")+
 '<div class="n3-metrics">'+stat("Patient receivables",dollars(b.patientDue))+stat("Insurer receivables",dollars(b.insurerDue))+stat("Unbilled encounters",b.unbilled.length)+stat("Reconciliation flags",b.issues.length)+stat("Unpriced clinical items",b.unpriced.length)+'</div>'+
 section("Patient receivables aging",'<div class="n3-metrics">'+stat("0–30 days",dollars(a.days0to30))+stat("31–60 days",dollars(a.days31to60))+stat("61–90 days",dollars(a.days61to90))+stat("Over 90 days",dollars(a.over90))+'</div>')+
 '<div class="n3-grid-2">'+section("Invoice reconciliation",short(b.issues.map(x=>item(x.type,"Encounter "+x.id,"Review")),35),b.issues.length+" flags")+
 section("Missing price matches",short(b.unpriced.map(x=>item(x.name,x.collection+" · "+x.encounterId,x.status||"Unpriced")),35),b.unpriced.length+" unpriced")+'</div>'+
 section("Revenue workspaces",'<div class="n3-actions">'+jump("billing","Manage invoices")+jump("catalog","Service Prices")+jump("discharge","Discharge Center")+'</div>')+
 '<p class="n3-hint">Reconciliation is advisory. The same service may legitimately appear more than once; investigate flags before adjusting a charge.</p>';
}
function makeForm(collectionName,fields,label){
 return '<form class="n3-create" data-n3-create="'+escape(collectionName)+'"><h3>'+escape(label)+'</h3><div class="n3-form-grid">'+fields.map(f=>
  '<label>'+escape(f.label)+(f.type==="select"?'<select name="'+escape(f.key)+'" required>'+f.choices.map(x=>'<option value="'+escape(x[0])+'">'+escape(x[1])+'</option>').join("")+'</select>':
  f.type==="textarea"?'<textarea name="'+escape(f.key)+'" minlength="'+(f.min||5)+'" maxlength="'+(f.max||800)+'" required></textarea>':
  '<input name="'+escape(f.key)+'" type="'+escape(f.type||"text")+'" '+(f.min?'minlength="'+f.min+'"':"")+(f.max?'maxlength="'+f.max+'"':"")+(f.type==="date"?"":"")+(f.required===false?"":" required")+' placeholder="'+escape(f.placeholder||"")+'">')+'</label>').join("")+'</div><button class="n3-primary" type="submit">Save '+escape(label.toLowerCase())+'</button><p class="n3-message" role="status"></p></form>';
}
function renderQuality(c){
 if(!admin(c))return renderRestricted("Quality & Safety");
 const records=c.data.nmcQualityActions||[];
 return heading("Quality & Safety","Report corrective actions, manage risk deadlines and track incident prevention in one place.","Phase 3")+
 '<div class="n3-metrics">'+stat("Open actions",records.filter(x=>x.status!=="completed").length)+stat("Critical actions",records.filter(x=>x.priority==="critical"&&x.status!=="completed").length)+stat("Completed",records.filter(x=>x.status==="completed").length)+'</div>'+
 makeForm("nmcQualityActions",[{key:"title",label:"Issue or corrective action",min:4,max:120},{key:"category",label:"Category",type:"select",choices:[["patient-safety","Patient safety"],["medication","Medication reconciliation"],["documentation","Documentation"],["equipment","Equipment"],["operations","Operations"],["training","Training"]]},
 {key:"priority",label:"Priority",type:"select",choices:[["routine","Routine"],["high","High"],["critical","Critical"]]},{key:"dueDate",label:"Target completion date",type:"date",required:false},{key:"summary",label:"Required corrective action",type:"textarea",min:5,max:800}],"Corrective action")+
 section("Corrective action register",short(records.map(x=>recordLine("nmcQualityActions",x,x.title,x.summary,x.priority,c)),90),records.length+" items")+
 '<p class="n3-hint">Use the restricted SIU workflow for confidential investigations. Quality actions are operational follow-ups, not SIU case evidence.</p>';
}
function renderStaff(c){
 if(!admin(c))return renderRestricted("Staff Scheduling");
 const staff=(c.users||[]).filter(x=>x.status==="active"),shifts=c.data.nmcShiftAssignments||[],onShift=c.data.shifts||[];
 return heading("Staff Scheduling","Plan simulated department coverage alongside self-reported on-duty sessions.","Phase 3")+
 '<div class="n3-metrics">'+stat("Active staff",staff.length)+stat("Shift assignments",shifts.length)+stat("On-duty sessions",onShift.filter(x=>x.status==="active").length)+'</div>'+
 makeForm("nmcShiftAssignments",[{key:"staffUid",label:"Assign staff member",type:"select",choices:staff.map(x=>[x.id,patientLabel(x)])},
 {key:"department",label:"Department",type:"select",choices:[["Emergency","Emergency"],["ICU","ICU"],["Surgery","Surgery"],["Laboratory","Laboratory"],["Imaging","Imaging"],["Pharmacy","Pharmacy"],["Registration","Registration"],["Administration","Administration"]]},
 {key:"shiftDate",label:"Shift date",type:"date"},{key:"startTime",label:"Start",type:"time"},{key:"endTime",label:"End",type:"time"}],"Shift assignment")+
 section("Upcoming shift plan",short(shifts.sort((a,b)=>String(a.shiftDate).localeCompare(String(b.shiftDate))).map(x=>recordLine("nmcShiftAssignments",x,(staff.find(y=>y.id===x.staffUid)?.displayName||x.staffName||x.staffUid),x.department+" · "+x.shiftDate+" "+x.startTime+"–"+x.endTime,x.status,c)),80));
}
function renderEquipment(c){
 if(!admin(c))return renderRestricted("Equipment & Inventory");
 const d=asData(c),r=supplyReview(d);
 return heading("Equipment & Inventory","Equipment register, supply alerts and maintenance follow-up integrated with department workflows.","Phase 3")+
 '<div class="n3-metrics">'+stat("Catalogued supplies",r.supplies)+stat("Low stock",r.low.length)+stat("Equipment",r.equipment)+stat("Maintenance required",r.maintenance.length+r.expiring.length)+'</div>'+
 makeForm("nmcEquipment",[{key:"name",label:"Equipment name",min:2,max:120},{key:"assetCode",label:"Asset code",min:2,max:50},{key:"department",label:"Department",min:2,max:80},
 {key:"status",label:"Status",type:"select",choices:[["available","Available"],["in-use","In use"],["maintenance","Maintenance"],["out-of-service","Out of service"]]},
 {key:"nextServiceDate",label:"Next service date",type:"date",required:false}],"Equipment record")+
 '<div class="n3-grid-2">'+section("Maintenance & equipment",short((d.nmcEquipment||[]).map(x=>recordLine("nmcEquipment",x,x.name,x.assetCode+" · "+x.department,x.status,c)),85))+
 section("Low stock",short(r.low.map(x=>item(x.name||x.sku||"Supply",x.category||"Supply",String(x.quantity??x.stock??0)+" in stock")),40))+'</div>'+
 '<div class="n3-actions">'+jump("supplies","Open Supplies")+'</div>';
}
function renderAcademy(c){
 if(!admin(c))return renderRestricted("Training Academy");
 const d=asData(c),stats=trainingReview(d),staff=(c.users||[]).filter(x=>x.status==="active");
 return heading("Training Academy","Assign scenario training, record completion and track learning without rewriting simulation case results.","Phase 3")+
 '<div class="n3-metrics">'+stat("Assigned",stats.assigned)+stat("In progress",stats.inProgress)+stat("Completed",stats.completed)+stat("Simulation runs",(d.caseRuns||[]).length)+'</div>'+
 makeForm("nmcTrainingRecords",[{key:"staffUid",label:"Staff member",type:"select",choices:staff.map(x=>[x.id,patientLabel(x)])},
 {key:"module",label:"Training module",type:"select",choices:[["emergency","Emergency response"],["medication","Medication safety"],["documentation","Clinical documentation"],["billing","Financial workflows"],["privacy","Privacy & records"],["siu","SIU procedures"]]},
 {key:"title",label:"Assignment name",min:4,max:120},{key:"dueDate",label:"Due date",type:"date",required:false}],"Training assignment")+
 section("Training tracker",short(stats.items.map(x=>recordLine("nmcTrainingRecords",x,x.title,x.module+" · "+(staff.find(y=>y.id===x.staffUid)?.displayName||x.staffUid),x.status,c)),85))+
 section("Scenario engine",'<div class="n3-actions">'+jump("dashboard","Clinical Overview")+jump("debrief","Debrief Timeline")+'</div><p class="n3-hint">Existing training scenarios and case runs are retained. Assignments are staff training records, not automatically generated certifications.</p>');
}
function renderIdentity(c){
 if(!admin(c))return renderRestricted("Record Integrity");
 const data=asData(c),findings=integrityReview(data);
 return heading("Record Integrity","Read-only detection of missing patient records, broken encounter references and duplicated identifiers.","Phase 1")+
 '<div class="n3-metrics">'+stat("Patients",data.patients.length)+stat("Encounters",data.encounters.length)+stat("Reference findings",findings.length)+'</div>'+
 section("Local data integrity findings",short(findings.map(x=>item(x.reason,x.collection+" · "+x.id, x.patientId||x.encounterId||"")),150),findings.length+" findings")+
 section("Server-side diagnostics",'<p class="n3-hint">Scan a bounded snapshot on Firebase Cloud Functions to verify referenced patient and encounter IDs. No records are deleted or merged.</p><div class="n3-actions"><button type="button" class="n3-primary" data-n3-call="northstarV3Integrity">Run server integrity scan</button><button type="button" class="n3-btn" data-n3-call="northstarV3BillingAudit">Run financial audit</button></div><pre id="n3-server-result" class="n3-result">Not run. Deploy new Cloud Functions to enable server diagnostics.</pre>')+
 '<p class="n3-hint">A missing record is flagged for administrator review, never automatically purged. Scan counts are bounded for performance and should not be interpreted as a whole-database guarantee.</p>';
}
function renderPortal(c){
 if(!admin(c))return renderRestricted("Patient Portal Preview");
 const p=c.patients||[],selected=p.find(x=>x.id===chosenPatient)||p[0];
 if(selected)chosenPatient=selected.id;
 const visits=(c.encounters||[]).filter(x=>x.patientId===selected?.id);
 const bills=(c.data.billingAccounts||[]).filter(x=>x.patientId===selected?.id);
 return heading("Patient Portal Preview","Internal staff-only preview of a future limited patient-facing experience.","Phase 3")+
 '<div class="n3-hint">NOT PUBLIC. This preview does not grant patient or family access. External identities, guardian consent, and permissions require a separate secure implementation.</div>'+
 (selected?section("Portal card — "+patientLabel(selected),'<div class="n3-metrics">'+stat("Recorded visits",visits.length)+stat("Billing statements",bills.length)+stat("Discharged visits",visits.filter(x=>x.status==="discharged").length)+'</div>'+
 '<p class="n3-hint">Only the patient's own eligible visit summaries and simulated statements would be shown after a separately authenticated, consent-checked portal is built.</p>'):section("Portal",'<div class="n3-empty">No patients found.</div>'));
}
function renderRestricted(name){return heading(name,"Administrator access required for this operational workspace.","Access control")+section("Access restricted",'<p class="n3-hint">An active Northstar administrator account is required.</p>');}
function recordLine(collectionName,x,title,detail,status,c){
 const editable=admin(c);
 return '<div class="n3-record"><div><strong>'+escape(title)+'</strong><small>'+escape(detail||"")+'</small></div><span class="n3-status">'+escape(status||"open")+'</span>'+
 (editable?'<select aria-label="Update '+escape(title)+'" data-n3-status="'+escape(collectionName)+'" data-id="'+escape(x.id)+'">'+(["nmcEquipment"].includes(collectionName)?["available","in-use","maintenance","out-of-service"]:["nmcShiftAssignments"].includes(collectionName)?["scheduled","confirmed","completed","cancelled"]:["assigned","in-progress","completed","cancelled","open"]).map(z=>'<option value="'+z+'" '+(z===status?"selected":"")+'>'+z+'</option>').join("")+'</select>':"")+'</div>';
}
export function renderV3Page(key,c){
 const target=document.querySelector("#enterprise-"+key);if(!target)return;
 if(!c.profile||c.profile.status!=="active"){target.innerHTML=renderRestricted("Northstar 3.0");return;}
 const html=({
  patient360:renderPatient,hospitalFlow:renderFlow,revenue360:renderRevenue,
  quality360:renderQuality,staff360:renderStaff,equipment360:renderEquipment,
  academy360:renderAcademy,identity360:renderIdentity,portal360:renderPortal
 })[key]?.(c);
 target.innerHTML='<div class="n3-workspace">'+(html||"")+'</div>';
 target.querySelector("#n3-patient")?.addEventListener("change",e=>{chosenPatient=e.target.value;chosenEncounter="";renderV3Page(key,c)});
 target.querySelector("#n3-encounter")?.addEventListener("change",e=>{chosenEncounter=e.target.value;renderV3Page(key,c)});
 target.querySelectorAll("[data-n3-jump]").forEach(b=>b.onclick=()=>document.querySelector('[data-enterprise-open="'+b.dataset.n3Jump+'"]')?.click());
 target.querySelectorAll("[data-n3-create]").forEach(form=>form.onsubmit=async e=>{
  e.preventDefault();
  if(!admin(c))return;
  const kind=form.dataset.n3Create,status=form.querySelector(".n3-message"),button=form.querySelector("button[type=submit]");button.disabled=true;
  try{
   const uid=user()?.uid;if(!uid)throw Error("Sign in to continue.");
   const fields=Object.fromEntries(new FormData(form));
   const known={nmcQualityActions:"open",nmcShiftAssignments:"scheduled",nmcEquipment:fields.status,nmcTrainingRecords:"assigned"};
   if(!Object.hasOwn(known,kind))throw Error("Unsupported operation");
   if(fields.staffUid&&!c.users.some(x=>x.id===fields.staffUid&&x.status==="active"))throw Error("Choose an active staff member.");
   if(kind==="nmcShiftAssignments"&&fields.startTime>=fields.endTime)throw Error("Shift end must be after start.");
   if(kind==="nmcShiftAssignments"&&fields.shiftDate<today())throw Error("Choose a current or future shift date.");
   const ref=doc(collection(store(),kind));
   await setDoc(ref,{...fields,status:known[kind],createdBy:uid,updatedBy:uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
   status.textContent="Saved successfully.";form.reset();
  }catch(err){status.textContent="Unable to save: "+(err?.message||err);}
  finally{button.disabled=false;}
 });
 target.querySelectorAll("[data-n3-status]").forEach(sel=>sel.onchange=async()=>{
  if(!admin(c))return;const previous=sel.dataset.previous||"";sel.disabled=true;
  try{await updateDoc(doc(store(),sel.dataset.n3Status,sel.dataset.id),{status:sel.value,updatedBy:user().uid,updatedAt:serverTimestamp()});}
  catch(e){sel.value=previous||"open";const warning=document.createElement("small");warning.className="n3-error";warning.textContent="Update failed: "+e.message;sel.after(warning);}
  finally{sel.disabled=false;}
 });
 target.querySelectorAll("[data-n3-call]").forEach(b=>b.onclick=async()=>{
  if(!admin(c))return;
  const out=target.querySelector("#n3-server-result");out.textContent="Running read-only scan…";b.disabled=true;
  try{const callable=httpsCallable(getFunctions(getApp(),"us-central1"),b.dataset.n3Call);
   const result=await callable({});out.textContent=JSON.stringify(result.data,null,2);}
  catch(e){out.textContent="Backend unavailable or permission denied: "+(e.message||e)+". Deploy the Cloud Functions first.";}
  finally{b.disabled=false;}
 });
}
