import {summarizeBilling,exportBillingCSV} from "./northstar-billing-insights.js";
// Northstar billing is a simulation ledger: no payment processing, claims submission, or payer verification.
import {collectEncounterCharges} from "./northstar-service-catalog.js";
import {getApp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {getAuth} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {getFirestore,collection,doc,getDoc,getDocs,query,orderBy,writeBatch,runTransaction,serverTimestamp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const esc=x=>String(x??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const CURRENCY=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"});
export const money=c=>CURRENCY.format((Number(c)||0)/100);
const moneyValue=(v,required=false)=>{
 const x=String(v??"").trim();
 if(!x&&!required)return 0;
 if(!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(x))throw Error("Enter an amount from $0 to $9,999,999.99 with no more than two decimal places.");
 return Math.round(Number(x)*100);
};
const sum=c=>c.reduce((a,x)=>a+(Number(x.amountCents)||0),0);
const getStatus=a=>{
 const insuranceBalance=Math.max(0,a.insuranceEstimatedCents-a.insuranceReceivedCents);
 const patientBalance=Math.max(0,a.chargeCents-a.insuranceEstimatedCents-a.waivedCents-a.patientPaidCents);
 if(a.waivedCents===a.chargeCents&&a.chargeCents>0)return "waived";
 if(insuranceBalance===0&&patientBalance===0)return "paid";
 if(insuranceBalance>0)return "insurance-pending";
 if(a.patientPaidCents>0)return "partially-paid";
 return "open";
};
function recalc(a){
 a.patientResponsibilityCents=a.chargeCents-a.insuranceEstimatedCents-a.waivedCents;
 a.patientBalanceCents=Math.max(0,a.patientResponsibilityCents-a.patientPaidCents);
 a.insurerBalanceCents=Math.max(0,a.insuranceEstimatedCents-a.insuranceReceivedCents);
 a.status=getStatus(a);
 return a;
}
export function billingFieldsMarkup(){
 return '<div class="nmc-bill-fields"><h4>Discharge billing decision <span class="nmc-bill-required">Required</span></h4>'+
 '<p>Simulation only. An insurance estimate is not verified coverage; this form does not charge a card or transmit claims.</p>'+
 '<div class="nmc-bill-two"><label>Billing arrangement<select name="billingMode" required><option value="">Choose how this encounter will be handled</option><option value="patient">Bill patient</option><option value="insurance">Expected insurance coverage</option><option value="split">Insurance + patient / waiver</option><option value="waived">Waive entire bill</option></select></label>'+
 '<label>Automatically calculated charges ($)<input name="billingCharge" inputmode="decimal" type="number" min="0" max="9999999.99" step="0.01" placeholder="0.00" readonly required></label></div>'+
 '<div class="nmc-bill-two"><label>Insurance provider (if applicable)<input name="billingInsurer" maxlength="100" placeholder="e.g. Northstar Mutual"></label>'+
 '<label>Expected insurance payment ($)<input name="billingInsurance" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00"></label>'+
 '<label>Waived amount ($)<input name="billingWaiver" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00"></label>'+
 '<label>Waiver authorization / reason<input name="billingWaiverReason" maxlength="500" placeholder="Required for any waiver"></label></div>'+
 '<label>Billing notes (optional)<textarea name="billingNotes" maxlength="1500" rows="2" placeholder="Internal simulation notes; avoid card and account numbers"></textarea></label>'+
 '<div class="nmc-auto-lines"><strong>Priced encounter services</strong><p>Loading itemized charges…</p></div><div class="nmc-bill-preview" aria-live="polite">Select a billing arrangement to preview balances.</div></div>';
}
export function bindBillingPreview(form){
 if(form.dataset.billingBound==="1")return;form.dataset.billingBound="1";
 const update=()=>{
  const f=new FormData(form),mode=String(f.get("billingMode")||"");
  const insurance=form.querySelector('[name="billingInsurance"]'),waiver=form.querySelector('[name="billingWaiver"]');
  const insurer=form.querySelector('[name="billingInsurer"]');
  const reason=form.querySelector('[name="billingWaiverReason"]');
  if(insurance){insurance.closest("label").hidden=!["insurance","split"].includes(mode);}
  if(insurer){insurer.closest("label").hidden=!["insurance","split"].includes(mode);}
  if(waiver){waiver.closest("label").hidden=!["split","waived"].includes(mode);}
  if(reason){reason.closest("label").hidden=!["split","waived"].includes(mode);}
  const preview=form.querySelector(".nmc-bill-preview");
  if(!preview)return;
  if(!mode){preview.textContent="Choose how the bill should be handled before discharge.";return;}
  try{
   const amount=moneyValue(f.get("billingCharge"),true);
   const covered=mode==="insurance"?amount:mode==="split"?moneyValue(f.get("billingInsurance")):0;
   const waived=mode==="waived"?amount:mode==="split"?moneyValue(f.get("billingWaiver")):0;
   if(covered+waived>amount)throw Error("Insurance and waivers cannot exceed the encounter charge.");
   preview.textContent="Charges: "+money(amount)+" · Insurance estimate: "+money(covered)+" · Waived: "+money(waived)+" · Expected patient portion: "+money(amount-covered-waived);
  }catch(err){preview.textContent=err.message;}
 };
 form.addEventListener("input",update);form.addEventListener("change",update);update();
}

function checkedLines(form){
 if(form.dataset.billingReady!=="yes")throw Error("Service charges have not been loaded. Reopen discharge and resolve the pricing warnings.");
 const lines=JSON.parse(form.dataset.billingLines||"[]");
 if(!Array.isArray(lines)||!lines.length)throw Error("No chargeable services were found. Add an active encounter or clinical service price before discharge.");
 if(lines.length>100)throw Error("Too many line items for one invoice; divide the services into appropriate encounters.");
 return lines;
}
export async function prepareEncounterBilling(form,encounter){
 const box=form.querySelector(".nmc-auto-lines"),charge=form.querySelector('[name="billingCharge"]');
 if(!box||!charge)throw Error("Billing form was not initialized.");
 form.dataset.billingReady="no";
 box.textContent="Loading services and current prices…";
 const quote=await collectEncounterCharges(encounter.id);
 const manual=[];
 const render=()=>{
  const lines=[...quote.lines,...manual],total=lines.reduce((n,x)=>n+x.amountCents,0);
  const missing=quote.unpriced;
  charge.value=(total/100).toFixed(2);
  form.dataset.billingLines=JSON.stringify(lines);
  form.dataset.billingReady=String(lines.length>0&&missing.length===0?"yes":"no");
  box.replaceChildren();
  const title=document.createElement("strong");title.textContent="Itemized services · "+lines.length+" · "+money(total);box.append(title);
  for(const item of lines){
   const row=document.createElement("div");row.className="nmc-priced-row";
   const label=document.createElement("span");label.textContent=item.description+" · "+money(item.unitPriceCents);
   row.append(label);
   if(item.sourceType==="manual"){const remove=document.createElement("button");remove.type="button";remove.textContent="Remove";remove.onclick=()=>{manual.splice(manual.indexOf(item),1);render()};row.append(remove)}
   box.append(row);
  }
  if(!lines.length){const p=document.createElement("p");p.textContent="No chargeable service was found. Define an Encounter / Facility rate under Service Prices, or add a priced service.";box.append(p)}
  if(missing.length){const p=document.createElement("p");p.className="nmc-bill-error";p.textContent=missing.length+" clinical service(s) have no matching active price: "+missing.map(x=>x.name).join(", ")+". Create those rates in Service Prices before closing this encounter.";box.append(p)}
  const options=quote.catalog.filter(x=>x.kind!=="visit");
  if(options.length){
   const bar=document.createElement("div");bar.className="nmc-priced-add";
   const sel=document.createElement("select");sel.setAttribute("aria-label","Add a catalog service");
   for(const item of options){const opt=document.createElement("option");opt.value=item.id;opt.textContent=item.name+" — "+money(item.priceCents);sel.append(opt)}
   const add=document.createElement("button");add.type="button";add.textContent="Add priced service";
   add.onclick=()=>{const item=options.find(x=>x.id===sel.value);if(!item)return;manual.push({serviceId:item.id,serviceName:item.name,description:item.name,sourceType:"manual",sourceId:"manual:"+item.id,quantity:1,unitPriceCents:item.priceCents,amountCents:item.priceCents,rateVersion:item.version||1});render()};
   bar.append(sel,add);box.append(bar);
  }
  form.dispatchEvent(new Event("change",{bubbles:true}));
 };
 render();
 return quote;
}
export function buildBillingRecord(form,encounter,userId,extra={}){
 const f=new FormData(form),mode=String(f.get("billingMode")||"");
 if(!["patient","insurance","split","waived"].includes(mode))throw Error("Choose patient billing, insurance, split payment, or waived.");
 const lineItems=checkedLines(form);
 const charge=lineItems.reduce((n,item)=>n+item.amountCents,0);
 if(charge!==moneyValue(f.get("billingCharge"),true))throw Error("The calculated service total has changed; reload the quote.");
 const insurance=mode==="insurance"?charge:mode==="split"?moneyValue(f.get("billingInsurance")):0;
 const waived=mode==="waived"?charge:mode==="split"?moneyValue(f.get("billingWaiver")):0;
 if(insurance+waived>charge)throw Error("Insurance coverage and waivers cannot exceed the charge.");
 const insurer=String(f.get("billingInsurer")||"").trim();
 const waiverReason=String(f.get("billingWaiverReason")||"").trim();
 if(insurance>0&&!insurer)throw Error("An insurance provider is required when coverage is estimated.");
 if(waived>0&&waiverReason.length<5)throw Error("Enter the waiver reason (at least five characters).");
 const a={
  encounterId:encounter.id,patientId:encounter.patientId,patientName:encounter.patientName||extra.patientName||"Patient",
  invoiceNumber:"NMC-"+encounter.id.slice(0,10).toUpperCase(),
  lineItems,
  chargeCents:charge,insuranceEstimatedCents:insurance,insuranceReceivedCents:0,
  waivedCents:waived,patientPaidCents:0,patientResponsibilityCents:0,patientBalanceCents:0,insurerBalanceCents:0,
  insuranceProvider:insurer,paymentDueDate:"",claimStatus:insurance>0?"not-submitted":"not-applicable",
  waiverReason,notes:String(f.get("billingNotes")||"").trim(),billingMode:mode,
  createdBy:userId,updatedBy:userId,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),
  source:extra.source||"discharge",simulated:true
 };
 return recalc(a);
}
function access(profile){return profile?.status==="active"&&(profile.role==="administrator"||profile.permissions?.billingAccess===true||["physician","registration"].includes(profile.role));}
function manage(profile){return profile?.status==="active"&&(profile.role==="administrator"||profile.permissions?.billingManage===true);}
export function billingCanAccess(profile){return access(profile);}
export function billingCanManage(profile){return manage(profile);}
let current={records:[],encounters:[],patients:[],profile:null,target:null};
function statusLabel(x){return x.replaceAll("-"," ").replace(/\b\w/g,c=>c.toUpperCase());}
export function renderBillingPage({target,records,encounters,patients=[],profile}){
 current={records,encounters,patients,profile,target};
 if(!target)return;
 if(!access(profile)){target.innerHTML='<div class="panel"><h3>Billing access restricted</h3><p>Contact an administrator for billing access.</p></div>';return;}
 const metrics=summarizeBilling(records,encounters);
 target.innerHTML='<section class="nmc-billing-page"><header><div><p class="eyebrow">Financial Operations · Simulation</p><h2>Billing & Revenue</h2><p>Encounter invoices, estimated insurance, waivers, balances and payment history.</p></div><span class="nmc-bill-label">No real payments or insurer claims</span></header>'+
 '<div class="nmc-bill-metrics nmc-bill-expanded-metrics"><article><span>Invoices</span><strong>'+metrics.invoices+'</strong></article><article><span>Total charges</span><strong>'+money(metrics.totalCharges)+'</strong></article><article><span>Collected</span><strong>'+money(metrics.collected)+'</strong></article><article><span>Patient balances</span><strong>'+money(metrics.patientBalance)+'</strong></article><article><span>Insurer balances</span><strong>'+money(metrics.insuranceBalance)+'</strong></article><article><span>Waived</span><strong>'+money(metrics.waived)+'</strong></article><article><span>Overdue invoices</span><strong>'+metrics.overdue+'</strong></article><article><span>Unbilled discharges</span><strong>'+metrics.unbilled+'</strong></article></div>'+
'<div class="nmc-bill-tools"><input id="nmcBillingSearch" placeholder="Find patient, invoice or insurer" aria-label="Search billing records" type="search"><select id="nmcBillingFilter" aria-label="Filter billing status"><option value="">All billing statuses</option><option value="overdue">Overdue</option><option value="claim-review">Insurer follow-up</option>'+["open","insurance-pending","partially-paid","paid","waived"].map(s=>'<option value="'+s+'">'+statusLabel(s)+'</option>').join("")+'</select><button id="nmcBillingRefresh" type="button">Refresh view</button><button id="nmcBillingExport" type="button">Export invoices CSV</button></div>'+
 '<div id="nmcBillingRows"></div><section class="nmc-bill-unbilled"><h3>Discharged encounters without an invoice</h3><p>Complete billing for encounters closed before billing was enabled.</p><div id="nmcUnbilledRows"></div></section></section>';
 const search=target.querySelector("#nmcBillingSearch"),filter=target.querySelector("#nmcBillingFilter");
 const draw=()=>{
  const needle=search.value.trim().toLowerCase(),status=filter.value;
  const matches=records.filter(x=>(!status||(status==="overdue"?metrics.overdueRows.some(y=>y.encounterId===x.encounterId):status==="claim-review"?metrics.claimsPendingRows.some(y=>y.encounterId===x.encounterId):x.status===status))&&[x.patientName,patients.find(p=>p.id===x.patientId)?.displayName,x.invoiceNumber,x.insuranceProvider,x.encounterId].some(v=>String(v||"").toLowerCase().includes(needle)));
  const list=target.querySelector("#nmcBillingRows");
  list.innerHTML=matches.length?matches.map(x=>'<article class="nmc-bill-row"><div><strong>'+esc(patients.find(p=>p.id===x.patientId)?.displayName||x.patientName)+'</strong><small>'+esc(x.invoiceNumber)+' · '+esc(statusLabel(x.status||"open"))+'</small></div><div><span>Charged '+money(x.chargeCents)+'</span><small>Patient '+money(x.patientBalanceCents)+' · Insurer '+money(x.insurerBalanceCents)+'</small></div><button type="button" data-nmc-invoice="'+esc(x.encounterId)+'">View invoice</button></article>').join(""):'<p class="nmc-bill-empty">No matching invoices.</p>';
 };
 search.addEventListener("input",draw);filter.addEventListener("change",draw);draw();
 const existing=new Set(records.map(x=>x.encounterId));
 const unbilled=encounters.filter(x=>x.status==="discharged"&&x.patientId&&!existing.has(x.id));
 target.querySelector("#nmcUnbilledRows").innerHTML=unbilled.length?unbilled.slice(0,50).map(x=>'<article class="nmc-bill-row"><div><strong>'+esc(x.patientName||"Patient")+'</strong><small>Encounter '+esc(x.id)+'</small></div>'+(manage(profile)?'<button data-nmc-retrobill="'+esc(x.id)+'" type="button">Create invoice</button>':'<small>Billing staff required</small>')+'</article>').join(""):'<p class="nmc-bill-empty">No unbilled discharged encounters in the current patient list.</p>';
 target.onclick=async e=>{
  const b=e.target.closest("[data-nmc-invoice]");if(b){await openInvoice(b.dataset.nmcInvoice);return;}
  const a=e.target.closest("[data-nmc-retrobill]");if(a&&manage(profile)){const encounter=current.encounters.find(x=>x.id===a.dataset.nmcRetrobill);if(encounter)await openBillingDialogForEncounter({encounter,retroactive:true});}
 };
 target.querySelector("#nmcBillingRefresh").onclick=()=>draw();
 target.querySelector("#nmcBillingExport").onclick=()=>{
  const body=exportBillingCSV(records,patients),blob=new Blob([body],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob),anchor=document.createElement("a");
  anchor.href=url;anchor.download="northstar-invoices.csv";document.body.append(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
 };
}
async function openInvoice(id){
 const app=getApp(),db=getFirestore(app),auth=getAuth(app),accountRef=doc(db,"billingAccounts",id);
 const snap=await getDoc(accountRef);if(!snap.exists())return alert("Invoice was not found.");
 const a={...snap.data(),encounterId:id};
 const livePatient=await getDoc(doc(db,"patients",a.patientId));if(livePatient.exists())a.patientName=livePatient.get("displayName")||a.patientName;
 const events=await getDocs(query(collection(db,"billingAccounts",id,"events"),orderBy("createdAt","desc")));
 const writable=manage(current.profile);
 const d=document.createElement("dialog");d.className="nmc-billing-dialog";
 d.innerHTML='<div class="nmc-billing-dialog-inner"><header><div><p class="eyebrow">Invoice · '+esc(a.invoiceNumber)+'</p><h2>'+esc(a.patientName)+'</h2><small>'+esc(statusLabel(a.status||"open"))+' · '+esc(a.claimStatus||"")+'</small></div><button type="button" class="nmc-bill-close">×</button></header>'+
 '<div class="nmc-bill-invoice-totals"><div>Charges<strong>'+money(a.chargeCents)+'</strong></div><div>Insurance estimate<strong>'+money(a.insuranceEstimatedCents)+'</strong></div><div>Waived<strong>'+money(a.waivedCents)+'</strong></div><div>Patient portion<strong>'+money(a.patientResponsibilityCents)+'</strong></div><div>Paid by patient<strong>'+money(a.patientPaidCents)+'</strong></div><div>Patient balance<strong>'+money(a.patientBalanceCents)+'</strong></div><div>Expected insurer balance<strong>'+money(a.insurerBalanceCents)+'</strong></div></div>'+
 '<h3>Itemized charges</h3><div class="nmc-bill-lines">'+(a.lineItems||[]).map(x=>'<div><span>'+esc(x.description)+' (×'+Number(x.quantity||1)+')<small>'+esc(x.clinicalGroup||x.sourceType||"Service")+' · Rate version '+Number(x.rateVersion||1)+'</small></span><strong>'+money(x.amountCents)+'</strong></div>').join("")+'</div>'+
 '<p>Insurer: '+esc(a.insuranceProvider||"None")+' · Payment due: '+esc(a.paymentDueDate||"Not set")+' · Waiver reason: '+esc(a.waiverReason||"None")+'</p><p>'+esc(a.notes||"")+'</p>'+
 '<div class="nmc-bill-dialog-actions"><button type="button" class="nmc-bill-print">Print / Save PDF</button></div>'+
 (writable?'<form id="nmcBillingAction"><h3>Post ledger activity</h3><label>Action<select name="action" required><option value="patient-payment">Record simulated patient payment</option><option value="insurance-payment">Record simulated insurer payment</option><option value="patient-refund">Record simulated patient refund</option><option value="insurance-refund">Record simulated insurer refund</option><option value="coverage">Update estimated insurance coverage</option><option value="waiver">Apply/change waiver</option><option value="charge">Add itemized charge</option><option value="charge-correction">Correct / reduce an erroneous charge</option><option value="insurer">Correct insurer name</option><option value="due-date">Set payment due date (YYYY-MM-DD)</option><option value="claim">Update insurance claim status</option><option value="note">Add an internal note</option></select></label><label>Amount ($)<input type="number" name="amount" min="0" step="0.01" placeholder="0.00"></label><label>Detail / reference<input name="detail" maxlength="250" placeholder="Charge description, payment reference, or note"></label><label>Claim decision<select name="claimOutcome"><option value="not-submitted">Not submitted</option><option value="submitted">Submitted</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="denied">Denied</option><option value="paid">Paid</option></select></label><label>Reason / authorization<textarea name="reason" required minlength="5" maxlength="750" rows="2"></textarea></label><button type="submit">Save simulated activity</button><p class="nmc-bill-action-status" role="status"></p></form>':'')+
 '<h3>Audit trail</h3><div class="nmc-bill-history">'+(events.empty?'<p>No adjustment activity yet.</p>':events.docs.map(x=>{const e=x.data();return '<div><strong>'+esc(statusLabel(e.action||"record"))+' · '+money(e.amountCents||0)+'</strong><small>'+esc(e.detail||"")+' · '+esc(e.reason||"")+' · '+esc(e.actorUid||"")+'</small></div>'}).join(""))+'</div><p class="nmc-bill-notice">Simulation invoice only. No actual payment is accepted or insurer claim transmitted.</p></div>';
 document.body.append(d);d.showModal();
 d.querySelector(".nmc-bill-close").onclick=()=>d.close();
 d.addEventListener("close",()=>d.remove());
 d.querySelector(".nmc-bill-print").onclick=()=>{const w=window.open("","_blank");if(!w)return alert("Enable popups to print invoices.");const body=d.querySelector(".nmc-billing-dialog-inner").cloneNode(true);body.querySelectorAll("form,button").forEach(e=>e.remove());w.document.title="Northstar Invoice";w.document.body.append(body);w.print();};
 const form=d.querySelector("#nmcBillingAction");
 if(form){const action=form.querySelector('[name="action"]'),claim=form.querySelector('[name="claimOutcome"]').closest("label");const change=()=>{claim.hidden=action.value!=="claim";};action.addEventListener("change",change);change();}
 if(form)form.onsubmit=async ev=>{
  ev.preventDefault();const button=form.querySelector('[type="submit"]');button.disabled=true;
  try{
   const f=new FormData(form);await postBillingActivity({accountId:id,action:String(f.get("action")),amount:String(f.get("amount")||""),detail:String(f.get("action")==="claim"?f.get("claimOutcome"):f.get("detail")||"").trim(),reason:String(f.get("reason")||"").trim(),actorUid:auth.currentUser?.uid});
   d.close();await openInvoice(id);
  }catch(err){form.querySelector(".nmc-bill-action-status").textContent=err.message;}finally{button.disabled=false;}
 };
}
export async function postBillingActivity({accountId,action,amount,detail,reason,actorUid}){
 if(!actorUid||reason.length<5)throw Error("A signed-in billing user and documented reason are required.");
 const db=getFirestore(getApp()),accountRef=doc(db,"billingAccounts",accountId),eventRef=doc(collection(db,"billingAccounts",accountId,"events"));
 const cents=["claim","note","insurer","due-date"].includes(action)?0:moneyValue(amount,true);
 await runTransaction(db,async tx=>{
  const snap=await tx.get(accountRef);if(!snap.exists())throw Error("Invoice not found.");
  const a={...snap.data()};let changedAmount=cents;
  if(action==="patient-payment"){if(cents<=0||cents>a.patientBalanceCents)throw Error("Payment must be positive and no greater than the patient balance.");a.patientPaidCents+=cents;}
  else if(action==="insurance-payment"){if(cents<=0||cents>a.insurerBalanceCents)throw Error("Insurer payment cannot exceed its expected balance.");a.insuranceReceivedCents+=cents;a.claimStatus=a.insuranceReceivedCents===a.insuranceEstimatedCents?"paid":"partially-paid";}
  else if(action==="patient-refund"){if(cents<=0||cents>a.patientPaidCents)throw Error("Refund cannot exceed simulated patient payments.");a.patientPaidCents-=cents;}
  else if(action==="insurance-refund"){if(cents<=0||cents>a.insuranceReceivedCents)throw Error("Refund cannot exceed simulated insurer receipts.");a.insuranceReceivedCents-=cents;a.claimStatus="partially-paid";}
  else if(action==="coverage"){if(cents<a.insuranceReceivedCents||cents>a.chargeCents-a.waivedCents)throw Error("Coverage cannot be below insurer payments or above remaining charges.");if(!a.insuranceProvider)throw Error("Set the insurer when discharging the patient.");a.insuranceEstimatedCents=cents;}
  else if(action==="waiver"){if(cents>a.chargeCents-a.insuranceEstimatedCents-a.patientPaidCents)throw Error("Waiver exceeds remaining unallocated patient charges.");a.waivedCents=cents;a.waiverReason=reason;}
  else if(action==="charge"){if(cents<=0||!detail||detail.length<3)throw Error("A positive charge and an item description are required.");a.lineItems=[...(a.lineItems||[]),{description:detail,quantity:1,unitPriceCents:cents,amountCents:cents}];a.chargeCents=sum(a.lineItems);}
  else if(action==="charge-correction"){if(cents<=0||detail.length<3||cents>a.chargeCents-a.insuranceEstimatedCents-a.waivedCents-a.patientPaidCents)throw Error("Provide a correction description; reductions cannot exceed unallocated charges.");a.lineItems=[...(a.lineItems||[]),{description:"Correction: "+detail,quantity:1,unitPriceCents:-cents,amountCents:-cents}];a.chargeCents=sum(a.lineItems);}
  else if(action==="insurer"){if(detail.length<2)throw Error("Enter the corrected insurer name.");a.insuranceProvider=detail;}
  else if(action==="due-date"){if(!/^\d{4}-\d{2}-\d{2}$/.test(detail)||Number.isNaN(Date.parse(detail+"T00:00:00")))throw Error("Enter a valid due date in YYYY-MM-DD format.");a.paymentDueDate=detail;}
  else if(action==="claim"){if(!["not-submitted","submitted","pending","approved","denied","paid"].includes(detail))throw Error("Choose a valid claim status.");if(detail==="paid"&&a.insuranceReceivedCents<a.insuranceEstimatedCents)throw Error("Record the full simulated insurer payment before marking its claim paid.");if(detail==="denied"){a.insuranceEstimatedCents=a.insuranceReceivedCents;}a.claimStatus=detail;}
  else if(action==="note"){if(detail.length<3)throw Error("Enter a meaningful note.");}
  else throw Error("Unknown billing activity.");
  if(a.insuranceEstimatedCents+a.waivedCents+a.patientPaidCents>a.chargeCents)throw Error("Billing allocation exceeds charges.");
  recalc(a);a.updatedAt=serverTimestamp();a.updatedBy=actorUid;
  tx.update(accountRef,a);
  tx.set(eventRef,{action,amountCents:changedAmount,detail,reason,actorUid,createdAt:serverTimestamp(),simulated:true});
 });
}
export async function openBillingDialogForEncounter({encounter,plan=null,retroactive=false}){
 if(!encounter?.id||!encounter?.patientId)throw Error("A valid patient encounter is required.");
 const db=getFirestore(getApp()),auth=getAuth(getApp());
 const patientExists=await getDoc(doc(db,"patients",encounter.patientId));if(!patientExists.exists())throw Error("The patient record is missing. Resolve the orphan record before billing.");
 const currentInvoice=await getDoc(doc(db,"billingAccounts",encounter.id));
 if(currentInvoice.exists())throw Error("This encounter already has a billing invoice.");
 const d=document.createElement("dialog");d.className="nmc-billing-dialog";
 d.innerHTML='<form class="nmc-billing-dialog-inner nmc-enterprise-billing"><header><div><p class="eyebrow">Required before '+(retroactive?"creating invoice":"discharge")+'</p><h2>Billing · '+esc(encounter.patientName||"Patient")+'</h2></div><button type="button" class="nmc-bill-close">×</button></header>'+billingFieldsMarkup()+'<div class="nmc-bill-footer"><button type="button" class="nmc-bill-cancel">Cancel</button><button type="submit">'+(retroactive?"Create invoice":"Finalize discharge & billing")+'</button></div><p class="nmc-bill-error" role="status"></p></form>';
 document.body.append(d);const form=d.querySelector("form");bindBillingPreview(form);
 const submitButton=form.querySelector('button[type="submit"]');submitButton.disabled=true;
 try{await prepareEncounterBilling(form,encounter);submitButton.disabled=false;}catch(err){form.querySelector(".nmc-bill-error").textContent="Unable to load service prices: "+err.message;}
 const close=()=>d.close();d.querySelector(".nmc-bill-close").onclick=close;d.querySelector(".nmc-bill-cancel").onclick=close;
 d.addEventListener("close",()=>d.remove());d.showModal();
 return new Promise(resolve=>{
  d.addEventListener("close",()=>resolve(false),{once:true});
  form.addEventListener("submit",async ev=>{
   ev.preventDefault();const btn=form.querySelector('[type="submit"]');btn.disabled=true;
   try{
    if(!auth.currentUser)throw Error("Please sign in again.");
    const record=buildBillingRecord(form,encounter,auth.currentUser.uid,{source:retroactive?"retrospective":"enterprise-discharge"});
    const existing=await getDoc(doc(db,"billingAccounts",encounter.id));if(existing.exists())throw Error("An invoice has already been created.");
    const batch=writeBatch(db);
    batch.set(doc(db,"billingAccounts",encounter.id),record);
    if(!retroactive){
     const currentEncounter=await getDoc(doc(db,"encounters",encounter.id));if(!currentEncounter.exists()||currentEncounter.get("status")==="discharged")throw Error("Encounter is no longer active.");
     const patientSnap=await getDoc(doc(db,"patients",encounter.patientId));if(!patientSnap.exists())throw Error("Patient record is missing.");
     const patientStatus="not-checked-in";
     batch.update(doc(db,"encounters",encounter.id),{status:"discharged",disposition:"discharged-home",finalDiagnosis:plan?.finalDiagnosis||"",dischargedAt:serverTimestamp(),dischargedBy:auth.currentUser.uid,updatedAt:serverTimestamp()});
     batch.update(doc(db,"patients",encounter.patientId),{activeEncounterId:null,currentStatus:patientStatus,currentEncounterStatus:null,lastVisitAt:serverTimestamp(),lastDisposition:"discharged-home",lastDiagnosis:plan?.finalDiagnosis||"",updatedAt:serverTimestamp()});
     if(plan?.id)batch.update(doc(db,"dischargePlans",plan.id),{status:"complete",completedAt:serverTimestamp()});
    }
    batch.set(doc(collection(db,"auditEvents")),{type:retroactive?"billing-created-retrospective":"discharge-with-billing",patientId:encounter.patientId,encounterId:encounter.id,actorUid:auth.currentUser.uid,at:serverTimestamp()});
    await batch.commit();d.close();resolve(true);
   }catch(err){form.querySelector(".nmc-bill-error").textContent=err.message;btn.disabled=false;}
  });
 });
}
