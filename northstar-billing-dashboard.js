import {groupPatientInvoices,filterBilling,waiveAccount} from "./northstar-billing-operations.js";
import {bulkWaiveSelection} from "./northstar-billing-workflows.js";
import {exportBillingCSV} from "./northstar-billing-insights.js";
const fmt=n=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format((Number(n)||0)/100);
const esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const nameOf=(p)=>p.displayName||[p.firstName,p.lastName].filter(Boolean).join(" ");
const authAdmin=p=>p?.status==="active"&&p.role==="administrator";
const readDate=d=>d?.toDate?.()||(d?.seconds?new Date(d.seconds*1000):d instanceof Date?d:null);
const dateFormat=d=>readDate(d)?.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})||"Date not recorded";
function exportRows(records,patients){
 const url=URL.createObjectURL(new Blob([exportBillingCSV(records,patients)],{type:"text/csv;charset=utf-8"}));
 const a=document.createElement("a");a.href=url;a.download="northstar-filtered-invoices.csv";document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),10000);
}
export function mountBillingDashboard({target,records=[],encounters=[],patients=[],profile,onOpenInvoice,onRetrospective,onReload}){
 const isAdmin=authAdmin(profile),names=new Map(patients.map(p=>[p.id,nameOf(p)])),byEncounter=new Map(records.map(a=>[a.encounterId,a]));
 const discharged=encounters.filter(e=>e.status==="discharged"&&e.patientId&&!byEncounter.has(e.id));
 const selected=new Set();
 const panel=target.querySelector(".nmc-billing-workspace");
 if(!panel)throw Error("Billing workspace missing.");
 panel.innerHTML='<div class="nmc-bill-workspace-toolbar"><div class="nmc-bill-heading"><div><p class="eyebrow">Patient account center</p><h3>Invoices by patient</h3><p>Search, filter, review, and manage every encounter from one account.</p></div><div class="nmc-bill-view-tabs"><button type="button" data-view="grouped">By patient</button><button type="button" data-view="flat">All invoices</button></div></div>'+
 '<div class="nmc-bill-filters"><label>Search patient or invoice<input id="nmcAccountSearch" type="search" placeholder="Patient, invoice, insurer, encounter"></label>'+
 '<label>Patient<select id="nmcAccountPatient"><option value="">All patients</option></select></label>'+
 '<label>Status<select id="nmcAccountStatus"><option value="">All statuses</option><option value="overdue">Overdue</option><option value="insurer">Insurer follow-up</option><option value="unbilled">Unbilled discharges</option><option value="open">Open</option><option value="insurance-pending">Insurance pending</option><option value="partially-paid">Partially paid</option><option value="paid">Paid</option><option value="waived">Waived</option></select></label>'+
 '<label>Invoices created on or before<input type="date" id="nmcAccountOlder"></label>'+
 '<label>Minimum charges ($)<input id="nmcAccountMinimum" type="number" min="0" step="0.01" value="0"></label>'+
 '<label>Sort<select id="nmcAccountSort"><option value="balance">Highest patient balance</option><option value="patient">Patient name</option><option value="charges">Highest charges</option><option value="due">Due date</option></select></label>'+
 '<label class="nmc-bill-check"><input id="nmcAccountUnpaid" type="checkbox"> Remaining balance only</label></div>'+
 '<div class="nmc-bill-filter-footer"><span id="nmcAccountCount" aria-live="polite"></span><div><button id="nmcAccountReset" type="button">Reset filters</button><button id="nmcAccountExport" type="button">Export filtered CSV</button><button id="nmcAccountReload" type="button">Reload from database</button></div></div></div>'+
 (isAdmin?'<div class="nmc-bill-bulk-actions"><div><strong>Administrative waiver center</strong><p>Select individual invoices or unbilled discharges, or review all records matching the current filters. Waivers preserve payment history and require a reason.</p></div><button id="nmcBulkWaiveOpen" type="button">Review automatic waivers</button></div>':"")+
 '<div id="nmcAccountRows" class="nmc-bill-account-groups"></div>';
 const el=id=>panel.querySelector("#"+id),list=el("nmcAccountRows");
 let view="grouped",lastInvoices=[],lastUnbilled=[];
 const patientsInData=[...new Map([...records.map(a=>[a.patientId,names.get(a.patientId)||a.patientName||"Unidentified"]),...discharged.map(e=>[e.patientId,names.get(e.patientId)||e.patientName||"Unidentified"])].filter(x=>x[0])).entries()].sort((a,b)=>a[1].localeCompare(b[1]));
 for(const [id,name]of patientsInData){const opt=document.createElement("option");opt.value=id;opt.textContent=name;el("nmcAccountPatient").append(opt);}
 const statuses=new Set(["open","insurance-pending","partially-paid","paid","waived"]);
 function matching(){
  const patientId=el("nmcAccountPatient").value,status=el("nmcAccountStatus").value,
   older=el("nmcAccountOlder").value,min=Math.round(Number(el("nmcAccountMinimum").value||0)*100),
   search=el("nmcAccountSearch").value.trim().toLowerCase(),unpaid=el("nmcAccountUnpaid").checked,sort=el("nmcAccountSort").value;
  const now=new Date(),today=now.toISOString().slice(0,10);
  const base=filterBilling(records,{search,status:statuses.has(status)?status:"",patientId,minChargesCents:min,olderThan:older,unpaidOnly:unpaid,
   overdueOnly:status==="overdue",now:today,sort});
  const invoices=status==="unbilled"?[]:status==="insurer"?base.filter(a=>(a.insurerBalanceCents||0)>0):base;
  const unbilled=discharged.filter(e=>{
   if(status&&!["unbilled"].includes(status))return false;
   if(patientId&&e.patientId!==patientId)return false;
   if(unpaid||min>0)return false;
   const created=readDate(e.dischargedAt||e.createdAt);
   if(older&&(!created||created.toISOString().slice(0,10)>older))return false;
   return !search||[e.patientName,names.get(e.patientId),e.id].some(x=>String(x||"").toLowerCase().includes(search));
  });
  return {invoices,unbilled};
 }
 function invoiceRow(a){
  const checked=selected.has("i:"+a.encounterId),isOld=!!a.paymentDueDate&&a.paymentDueDate<new Date().toISOString().slice(0,10);
  return '<article class="nmc-account-invoice">'+(isAdmin?'<label class="nmc-account-check"><input type="checkbox" data-select-invoice="'+esc(a.encounterId)+'" '+(checked?"checked":"")+' aria-label="Select invoice '+esc(a.invoiceNumber)+'"></label>':"")+
   '<div class="nmc-account-invoice-title"><strong>'+esc(a.invoiceNumber||a.encounterId)+'</strong><small>'+esc(a.patientName||"Patient")+' · '+esc(a.claimStatus||"No insurer claim")+'</small>'+
   '<span class="nmc-bill-invoice-meta">'+esc(a.status||"Open")+(isOld&&a.patientBalanceCents>0?" · OVERDUE":"")+'</span></div>'+
   '<div class="nmc-account-invoice-values"><span>Charged <strong>'+fmt(a.chargeCents)+'</strong></span><span>Patient due <strong>'+fmt(a.patientBalanceCents)+'</strong></span><span>Insurer <strong>'+fmt(a.insurerBalanceCents)+'</strong></span></div>'+
   '<button type="button" data-open-invoice="'+esc(a.encounterId)+'">View / Manage</button></article>';
 }
 function unbilledRow(e){
  return '<article class="nmc-account-invoice nmc-account-unbilled">'+(isAdmin?'<label class="nmc-account-check"><input type="checkbox" data-select-unbilled="'+esc(e.id)+'" '+(selected.has("u:"+e.id)?"checked":"")+' aria-label="Select unbilled encounter"></label>':"")+
  '<div class="nmc-account-invoice-title"><strong>Unbilled encounter</strong><small>'+esc(e.patientName||names.get(e.patientId)||"Patient")+' · '+esc(e.id)+'</small><span class="nmc-bill-invoice-meta">Discharged '+esc(dateFormat(e.dischargedAt))+'</span></div>'+
  '<div class="nmc-account-invoice-values"><span>Invoice not created</span></div>'+
  '<button type="button" data-create-invoice="'+esc(e.id)+'">Create invoice</button></article>';
 }
 function draw(){
  const {invoices,unbilled}=matching();lastInvoices=invoices;lastUnbilled=unbilled;
  const people=groupPatientInvoices(invoices,patients);
  const byPerson=new Map(people.map(p=>[p.patientId,p]));
  for(const e of unbilled){if(!byPerson.has(e.patientId))byPerson.set(e.patientId,{patientId:e.patientId,name:names.get(e.patientId)||e.patientName||"Patient",records:[],patientBalanceCents:0,insurerBalanceCents:0,totalChargesCents:0});}
  const sorted=[...byPerson.values()].sort((a,b)=>a.name.localeCompare(b.name));
  const unbilledFor=id=>unbilled.filter(e=>e.patientId===id);
  list.innerHTML=!invoices.length&&!unbilled.length?'<div class="nmc-bill-empty">No records match your filters.</div>':
   view==="grouped"?sorted.map(p=>'<section class="nmc-patient-account"><header><div><h4>'+esc(p.name)+'</h4><small>'+esc(p.patientId)+' · '+p.records.length+' invoices · '+unbilledFor(p.patientId).length+' unbilled</small></div><div><span>Patient balance <strong>'+fmt(p.patientBalanceCents)+'</strong></span><span>Insurer balance <strong>'+fmt(p.insurerBalanceCents)+'</strong></span></div></header>'+
    '<div class="nmc-patient-account-rows">'+p.records.map(invoiceRow).join("")+unbilledFor(p.patientId).map(unbilledRow).join("")+'</div></section>').join(""):
    '<div class="nmc-account-list-flat">'+invoices.map(invoiceRow).join("")+unbilled.map(unbilledRow).join("")+'</div>';
  el("nmcAccountCount").textContent=sorted.length+" patient"+(sorted.length!==1?"s":"")+" · "+invoices.length+" invoices · "+unbilled.length+" unbilled discharges";
  panel.querySelectorAll("[data-view]").forEach(b=>{b.classList.toggle("active",b.dataset.view===view);b.setAttribute("aria-pressed",String(b.dataset.view===view))});
 }
 for(const id of ["nmcAccountSearch","nmcAccountPatient","nmcAccountStatus","nmcAccountOlder","nmcAccountMinimum","nmcAccountSort","nmcAccountUnpaid"]){
  el(id).addEventListener("input",draw);el(id).addEventListener("change",draw);
 }
 panel.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{view=b.dataset.view;draw()});
 el("nmcAccountReset").onclick=()=>{for(const id of ["nmcAccountSearch","nmcAccountPatient","nmcAccountStatus","nmcAccountOlder"])el(id).value="";el("nmcAccountMinimum").value="0";el("nmcAccountUnpaid").checked=false;el("nmcAccountSort").value="balance";draw()};
 el("nmcAccountExport").onclick=()=>exportRows(lastInvoices,patients);
 el("nmcAccountReload").onclick=()=>onReload();
 panel.addEventListener("change",e=>{
  const i=e.target.closest("[data-select-invoice]"),u=e.target.closest("[data-select-unbilled]");
  const id=i?"i:"+i.dataset.selectInvoice:u?"u:"+u.dataset.selectUnbilled:null;
  if(id)e.target.checked?selected.add(id):selected.delete(id);
 });
 panel.addEventListener("click",e=>{
  const open=e.target.closest("[data-open-invoice]"),create=e.target.closest("[data-create-invoice]");
  if(open)onOpenInvoice(open.dataset.openInvoice);
  if(create)onRetrospective(discharged.find(x=>x.id===create.dataset.createInvoice));
 });
 if(isAdmin)el("nmcBulkWaiveOpen").onclick=()=>openBulkWaiver();
 function openBulkWaiver(){
  const fromSelected=selected.size>0;
  const ids=fromSelected?[...selected].filter(x=>x.startsWith("i:")).map(x=>x.slice(2)):[...lastInvoices.map(x=>x.encounterId)];
  const unbilledIds=fromSelected?[...selected].filter(x=>x.startsWith("u:")).map(x=>x.slice(2)):[...lastUnbilled.map(x=>x.id)];
  const targets=ids.map(x=>records.find(r=>r.encounterId===x)).filter(Boolean),unbilledTargets=unbilledIds.map(x=>discharged.find(r=>r.id===x)).filter(Boolean);
  const total=targets.length+unbilledTargets.length;
  const dialog=document.createElement("dialog");dialog.className="nmc-billing-dialog nmc-waiver-dialog";
  const container=document.createElement("form");container.className="nmc-billing-dialog-inner";container.innerHTML='<header><div><p class="eyebrow">Administrator · financial adjustments</p><h2>Review automatic waivers</h2><small>Bulk processing is irreversible without a separate corrective transaction.</small></div><button type="button" class="nmc-bill-close" aria-label="Close">×</button></header>'+
  '<div class="nmc-waiver-summary"><strong>'+total+' eligible record'+(total===1?"":"s")+'</strong><p>'+targets.length+' issued invoices and '+unbilledTargets.length+' unbilled discharges.</p></div>'+
  '<label class="nmc-waiver-option"><input type="checkbox" name="includeInsurance"> Also clear unreceived insurer estimates on issued invoices (does not change payments received)</label>'+
  '<label>Required administrative reason<textarea name="reason" minlength="5" maxlength="750" required placeholder="Reason for waiving these records"></textarea></label>'+
  '<label>Confirm by typing WAIVE '+total+'<input name="confirm" required autocomplete="off" placeholder="WAIVE '+total+'"></label>'+
  '<p class="nmc-bill-warning">Existing payments are preserved. Missing service prices may prevent retrospective invoices from being created; failed records will be listed.</p>'+
  '<div class="nmc-waiver-preview"></div><div class="nmc-bill-footer"><button type="button" class="nmc-waiver-cancel">Cancel</button><button type="submit" class="nmc-waiver-confirm">Apply waivers</button></div><p class="nmc-waiver-result" role="status"></p>';
  dialog.append(container);document.body.append(dialog);
  const preview=container.querySelector(".nmc-waiver-preview"),include=container.querySelector('[name="includeInsurance"]');
  const renderPreview=()=>{
   let totalPatient=0,totalInsurer=0;
   for(const x of targets){const a=waiveAccount(x,{includeInsurance:include.checked});totalPatient+=Math.max(0,a.waivedCents-(x.waivedCents||0));totalInsurer+=Math.max(0,(x.insuranceEstimatedCents||0)-a.insuranceEstimatedCents);}
   preview.textContent="Preview (issued invoices): "+fmt(totalPatient)+" additional patient waivers"+(include.checked?" · "+fmt(totalInsurer)+" insurer estimates cleared":"")+". Unbilled amounts are calculated when each encounter is processed.";
  };
  include.onchange=renderPreview;renderPreview();
  container.querySelector(".nmc-bill-close").onclick=()=>dialog.close();
  container.querySelector(".nmc-waiver-cancel").onclick=()=>dialog.close();
  dialog.addEventListener("close",()=>dialog.remove());
  container.onsubmit=async e=>{
   e.preventDefault();const f=new FormData(container),result=container.querySelector(".nmc-waiver-result"),button=container.querySelector(".nmc-waiver-confirm");
   if(f.get("confirm")!=="WAIVE "+total){result.textContent="Type WAIVE "+total+" exactly to confirm.";return;}
   if(total>100){result.textContent="Filter or select no more than 100 records per operation.";return;}
   button.disabled=true;container.querySelector(".nmc-waiver-cancel").disabled=true;
   try{
    const report=await bulkWaiveSelection({invoiceIds:ids,encounters:unbilledTargets,includeInsurance:include.checked,reason:f.get("reason"),
     onProgress:(done,total)=>{result.textContent="Processed "+done+" of "+total+" records…"}});
    result.textContent=report.completed.length+" succeeded; "+report.failed.length+" failed. "+report.failed.slice(0,15).map(x=>x.id+": "+x.message).join(" · ");
    if(!report.failed.length){dialog.close();await onReload();}
    else {await onReload();button.disabled=false;}
   }catch(error){result.textContent="Waiver stopped: "+error.message;button.disabled=false;}
  };
  dialog.showModal();
 }
 // Existing work queue cards still navigate to the same filtered account workspace.
 target.querySelectorAll("[data-billing-queue]").forEach(b=>b.addEventListener("click",()=>{
  const key=b.dataset.billingQueue;el("nmcAccountStatus").value=key==="claim-review"?"insurer":key;
  draw();panel.scrollIntoView({behavior:"smooth",block:"start"});
 }));
 draw();
}
