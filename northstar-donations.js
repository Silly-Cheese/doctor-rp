// Northstar Medical Center — simulated donations and gifts.
// Separate donation ledger from medical billingAccounts: not a service charge,
// insurance payment, or real card transaction.
import {getApp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {getAuth} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {getFirestore,collection,doc,writeBatch,runTransaction,onSnapshot,query,orderBy,serverTimestamp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {summarizeBilling} from "./northstar-billing-insights.js";

let db,auth;
const esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const money=n=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format((Number(n)||0)/100);
const fmtDate=t=>{const d=t?.toDate?.()||(t?.seconds?new Date(t.seconds*1000):null);return d?.toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"})||"Pending";};
const validMethods=["cash","check","external-transfer","other"];
function toCents(value){
 const x=String(value||"").trim();
 if(!/^(?:[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(x))throw Error("Enter a donation amount from $1 to $999,999.99.");
 const cents=Math.round(Number(x)*100);
 if(!Number.isSafeInteger(cents)||cents<100||cents>99999999)throw Error("Invalid donation amount.");
 return cents;
}
function canManage(p){return p?.status==="active"&&(p.role==="administrator"||p.permissions?.billingManage===true);}
function printAcknowledgment(d){
 const received=d.status==="received";
 const title=received?"Donation receipt":d.status==="reversed"?"Reversed donation statement":d.status==="cancelled"?"Cancelled donation request":"Donation request";
 const detail=received?"The simulated donation below has been recorded as received.":d.status==="reversed"?"This previously received donation was reversed and is excluded from current collected revenue.":d.status==="cancelled"?"The donation request was cancelled and is not collected.":"This donation has not been received or added to collected revenue.";
 const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Northstar '+title+'</title>'+
 '<style>@page{size:letter;margin:.75in}*{box-sizing:border-box}body{font:13px/1.55 Arial,sans-serif;color:#183849;margin:0;background:#eef4f7}main{background:white;max-width:780px;padding:46px 52px;margin:25px auto}header{border-bottom:3px solid #145674;padding-bottom:18px;margin-bottom:28px}h1{margin:0;font-size:22px}h2{font-size:18px;color:#0c5575}.muted{color:#647d8c}.row{display:flex;justify-content:space-between;gap:16px;padding:11px 0;border-bottom:1px solid #e0e8ec}.amount{font-size:30px;color:#135b77;font-weight:800;margin:20px 0}.signature-grid{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:30px}.line{border-bottom:1px solid #708e9e;height:52px}.caption{color:#617989;font-size:11px;margin:6px 0}.sign{break-inside:avoid;margin-top:38px;border-top:1px solid #b7d1dc;padding-top:12px}.notice{border-left:3px solid #4c93a9;padding:12px;background:#f2f8fa;margin-top:20px}.toolbar{display:flex;justify-content:center;gap:12px;margin:15px}.toolbar button{padding:10px 16px;cursor:pointer}@media print{body{background:white}.toolbar{display:none}main{max-width:none;margin:0;padding:0}}</style></head><body><div class="toolbar"><button onclick="window.print()">Print / Save PDF</button><button onclick="window.close()">Close</button></div><main>'+
 '<header><h1>Northstar Medical Center</h1><p class="muted">Donation acknowledgment · DOCTOR-RP SIMULATION</p></header><h2>'+title+'</h2>'+
 '<div class="row"><span>Reference</span><strong>'+esc(d.receiptNumber)+'</strong></div>'+
 '<div class="row"><span>Donor</span><strong>'+esc(d.donorName)+'</strong></div>'+
 '<div class="row"><span>Purpose</span><strong>'+esc(d.purpose)+'</strong></div>'+
 '<div class="row"><span>Status</span><strong>'+esc(d.status)+'</strong></div>'+
 '<div class="row"><span>Date received / requested</span><strong>'+esc(fmtDate(d.receivedAt||d.createdAt))+'</strong></div>'+
 (received?'<div class="row"><span>Recorded method</span><strong>'+esc(d.method.replaceAll("-"," "))+'</strong></div>':"")+
 '<div class="amount">'+money(d.amountCents)+'</div><p>'+esc(detail)+'</p>'+
 '<div class="notice">This is a fictional hospital simulation document. No money was transferred or charged through Northstar. It is not a tax-deductibility determination or official charitable receipt.</div>'+
 '<section class="sign"><h3>Acknowledgment signatures</h3><div class="signature-grid">'+
 '<div><strong>Staff member</strong><div class="line"></div><p class="caption">Signature</p><div class="line"></div><p class="caption">Printed name / date</p></div>'+
 '<div><strong>Donor / patient</strong><div class="line"></div><p class="caption">Signature</p><div class="line"></div><p class="caption">Printed name / date</p></div></div></section>'+
 '</main></body></html>';
 const w=window.open("","_blank","width=880,height=800");
 if(!w)throw Error("Browser blocked the print window. Please allow pop-ups.");
 w.document.open();w.document.write(html);w.document.close();w.focus();
}

function confirmDonationAction(next,gift){
 return new Promise(resolve=>{
  const dialog=document.createElement("dialog");dialog.className="nmc-gift-dialog";
  const label=next==="received"?"Confirm received donation":next==="reversed"?"Reverse donation":"Cancel donation request";
  dialog.innerHTML='<form class="nmc-gift-dialog-content"><header><div><p class="eyebrow">Northstar · Giving ledger</p><h3>'+esc(label)+'</h3><p>'+esc(gift.donorName)+' · '+money(gift.amountCents)+'</p></div><button type="button" class="nmc-gift-close" aria-label="Close dialog">×</button></header>'+
    '<p class="nmc-gift-dialog-hint">'+(next==="received"?"Recording as received will increase collected revenue. This does not actually transfer funds.":"The original entry will remain visible. Your reason is required for the audit trail.")+'</p>'+
    (next==="received"?'<label>Recorded method<select name="method"><option value="cash">Cash</option><option value="check">Check</option><option value="external-transfer">External transfer</option><option value="other">Other</option></select></label>':'<label>Reason<textarea name="reason" minlength="5" maxlength="500" rows="3" required placeholder="Explain the correction"></textarea></label>')+
    '<div class="nmc-gift-actions"><button type="button" class="nmc-gift-dismiss">Back</button><button type="submit" class="primary-button">'+esc(label)+'</button></div></form>';
  const form=dialog.querySelector("form");
  const done=value=>{dialog.close();dialog.remove();resolve(value);};
  dialog.querySelector(".nmc-gift-close").addEventListener("click",()=>done(null));
  dialog.querySelector(".nmc-gift-dismiss").addEventListener("click",()=>done(null));
  dialog.addEventListener("cancel",event=>{event.preventDefault();done(null);},{once:true});
  form.addEventListener("submit",event=>{
   event.preventDefault();const data=new FormData(form);
   const method=next==="received"?String(data.get("method")):"";
   const reason=next==="received"?"":String(data.get("reason")||"").trim();
   if(next==="received"&&!validMethods.includes(method))return;
   if(next!=="received"&&(reason.length<5||reason.length>500))return;
   done({method,reason});
  });
  document.body.append(dialog);dialog.showModal();
 });
}

let stop=null;
export function mountNorthstarDonations({target,records=[],encounters=[],patients=[],profile}){
 db=getFirestore(getApp());auth=getAuth(getApp());
 if(stop){stop();stop=null;}
 const host=target.querySelector("#nmcDonationWorkspace");
 if(!host)return;
 const manage=canManage(profile);
 const names=new Map(patients.map(p=>[p.id,p.displayName||[p.firstName,p.lastName].filter(Boolean).join(" ")]));
 const patientOptions=patients.slice().sort((a,b)=>String(names.get(a.id)).localeCompare(String(names.get(b.id))))
  .map(p=>'<option value="'+esc(p.id)+'">'+esc(names.get(p.id)||"Unknown")+' · '+esc(p.mrn||"No MRN")+'</option>').join("");
 host.innerHTML='<header class="nmc-gifts-header"><div><p class="eyebrow">Giving & Support · Simulation</p><h3>Donations and Gifts</h3><p>Record voluntary donations or requests. Only donations marked received count as collected revenue.</p></div>'+
 '<div class="nmc-gift-header-actions"><button type="button" id="nmcGiftExport">Export CSV</button>'+
 (manage?'<button type="button" class="primary-button" id="nmcGiftNew" aria-expanded="false">Record donation</button>':"")+'</div></header>'+
 '<div class="nmc-gift-metrics"><div><span>Donations received</span><strong id="nmcGiftReceived">$0.00</strong></div><div><span>Requested / pledged</span><strong id="nmcGiftPledged">$0.00</strong></div><div><span>Received gifts</span><strong id="nmcGiftCount">0</strong></div></div>'+
 '<div id="nmcGiftEditor" class="nmc-gift-editor hidden"></div>'+
 '<div class="nmc-gift-controls"><label>Find donor or reference<input id="nmcGiftSearch" type="search" placeholder="Donor, purpose or receipt #"></label><label>Status<select id="nmcGiftFilter"><option value="">All donations</option><option value="received">Received</option><option value="pledged">Requested / pledged</option><option value="reversed">Reversed</option><option value="cancelled">Cancelled</option></select></label></div>'+
 '<div id="nmcGiftList" class="nmc-gift-list" aria-live="polite"><p class="muted">Loading donations…</p></div>';
 const el=id=>host.querySelector("#"+id),edit=el("nmcGiftEditor"),list=el("nmcGiftList");

 // Donation ledger export includes received and reversed history for reconciliation.
 const csv=v=>{
  let value=String(v??"");
  if(/^[=+\-@]/.test(value))value="'"+value;
  return '"'+value.replaceAll('"','""').replaceAll(/\r?\n/g," ")+'"';
 };
 el("nmcGiftExport").addEventListener("click",()=>{
  const fields=["Reference","Donor","Patient ID","Purpose","Amount cents","Status","Received method","Created","Received","Reversal reason","Cancellation reason"];
  const rows=donations.map(d=>[
   d.receiptNumber,d.donorName,d.patientId||"",d.purpose,d.amountCents,d.status,d.method,
   fmtDate(d.createdAt),d.receivedAt?fmtDate(d.receivedAt):"",d.reversalReason||"",d.cancelReason||""
  ]);
  const text=[fields,...rows].map(row=>row.map(csv).join(",")).join("\r\n")+"\r\n";
  const url=URL.createObjectURL(new Blob([text],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download="northstar-donations-ledger.csv";
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
 });

 let donations=[];
 function displayMetrics(){
  const totals=summarizeBilling(records,encounters,new Date(),donations);
  for(const [id,value] of [["nmcBillingCollected",totals.collected],["nmcBillingClinicalCollected",totals.clinicalCollected],["nmcBillingDonationsCollected",totals.donationCollected]]) {
   const node=target.querySelector("#"+id);if(node)node.textContent=money(value);
  }
  el("nmcGiftReceived").textContent=money(totals.donationCollected);
  el("nmcGiftPledged").textContent=money(totals.donationPledged);
  el("nmcGiftCount").textContent=donations.filter(d=>d.status==="received").length;
 }
 function draw(){
  displayMetrics();
  const search=el("nmcGiftSearch").value.trim().toLowerCase(),filter=el("nmcGiftFilter").value;
  const matched=donations.filter(d=>(!filter||d.status===filter)&&(!search||[d.donorName,d.receiptNumber,d.purpose,d.notes].some(x=>String(x||"").toLowerCase().includes(search))));
  list.innerHTML=matched.length?matched.map(d=>'<article class="nmc-gift-record" data-nmc-gift="'+esc(d.id)+'"><div class="nmc-gift-record-top"><div><strong>'+esc(d.donorName)+'</strong><small>'+esc(d.receiptNumber)+' · '+esc(d.purpose)+' · '+esc(fmtDate(d.receivedAt||d.createdAt))+'</small></div><div><strong class="nmc-gift-sum">'+money(d.amountCents)+'</strong><span class="nmc-gift-status nmc-gift-'+esc(d.status)+'">'+esc(d.status)+'</span></div></div>'+
 '<div class="nmc-gift-record-bottom"><span>'+esc(d.patientId?("Patient: "+(names.get(d.patientId)||"Linked patient")):"Community donor")+'</span><div>'+
 '<button type="button" data-nmc-gift-print="'+esc(d.id)+'">Print '+(d.status==="received"?"receipt":"record")+'</button>'+
 (manage&&d.status==="pledged"?'<button type="button" data-nmc-gift-collect="'+esc(d.id)+'">Mark received</button><button type="button" data-nmc-gift-cancel="'+esc(d.id)+'">Cancel request</button>':"")+
 (profile?.role==="administrator"&&d.status==="received"?'<button type="button" data-nmc-gift-reverse="'+esc(d.id)+'">Reverse entry</button>':"")+
 '</div></div></article>').join(""):'<p class="nmc-gift-empty">No donations match the selected filters.</p>';
 }
 const refreshError=message=>{
  list.innerHTML='<p class="nmc-gift-error" role="alert">'+esc(message)+'</p>';
  for(const id of ["nmcBillingCollected","nmcBillingDonationsCollected"]){const node=target.querySelector("#"+id);if(node)node.textContent="Unavailable";}
 };
 const errorMessage=e=>e?.code==="permission-denied"?"Your staff role is not authorized for the donations ledger.":(e?.message||"Donation operation failed.");
 async function transition(id,next){
  if(!manage)return;
  const current=donations.find(d=>d.id===id);if(!current)return;
  // Use an accessible in-app confirmation instead of browser prompts.
  const details=await confirmDonationAction(next,current);
  if(!details)return;
  const {method,reason}=details;
  const actor=auth.currentUser?.uid;if(!actor){alert("Sign in again.");return;}
  try{
   const donationRef=doc(db,"nmcDonations",id),auditRef=doc(collection(db,"auditEvents"));
   await runTransaction(db,async tx=>{
    const snap=await tx.get(donationRef);
    if(!snap.exists())throw Error("Donation no longer exists.");
    const value=snap.data();
    if((next==="received"||next==="cancelled")&&value.status!=="pledged")throw Error("Donation is no longer awaiting receipt.");
    if(next==="reversed"&&value.status!=="received")throw Error("Only a received donation can be reversed.");
    const patch={status:next,updatedAt:serverTimestamp()};
    if(next==="received"){patch.receivedBy=actor;patch.receivedAt=serverTimestamp();patch.method=method;}
    if(next==="cancelled"){patch.cancelReason=reason.trim();patch.cancelledAt=serverTimestamp();patch.cancelledBy=actor;}
    if(next==="reversed"){patch.reversalReason=reason.trim();patch.reversedAt=serverTimestamp();patch.reversedBy=actor;}
    tx.update(donationRef,patch);
    tx.set(auditRef,{type:"donation-"+next,actorUid:actor,donationId:id,amountCents:value.amountCents,at:serverTimestamp()});
   });
  }catch(e){alert("Unable to update donation: "+errorMessage(e));}
 }
 list.addEventListener("click",event=>{
  const btn=event.target.closest("[data-nmc-gift-print],[data-nmc-gift-collect],[data-nmc-gift-cancel],[data-nmc-gift-reverse]");
  if(!btn)return;
  const id=btn.dataset.nmcGiftPrint||btn.dataset.nmcGiftCollect||btn.dataset.nmcGiftCancel||btn.dataset.nmcGiftReverse;
  const gift=donations.find(d=>d.id===id);if(!gift)return;
  if(btn.hasAttribute("data-nmc-gift-print")){try{printAcknowledgment(gift);}catch(e){alert(e.message);}return;}
  if(btn.hasAttribute("data-nmc-gift-collect"))transition(id,"received");
  if(btn.hasAttribute("data-nmc-gift-cancel"))transition(id,"cancelled");
  if(btn.hasAttribute("data-nmc-gift-reverse"))transition(id,"reversed");
 });
 el("nmcGiftSearch").addEventListener("input",draw);
 el("nmcGiftFilter").addEventListener("change",draw);
 if(manage){
  el("nmcGiftNew").addEventListener("click",()=>{
   edit.classList.toggle("hidden");
   el("nmcGiftNew").setAttribute("aria-expanded",String(!edit.classList.contains("hidden")));
   if(!edit.classList.contains("hidden"))edit.querySelector("input[name=donorName]").focus();
  });
  edit.innerHTML='<form id="nmcGiftForm"><div class="nmc-gift-fields"><label>Donor name<input name="donorName" required minlength="2" maxlength="120" placeholder="Name of patient or donor"></label>'+
   '<label>Link to patient (optional)<select name="patientId"><option value="">Community / external donor</option>'+patientOptions+'</select></label>'+
   '<label>Donation amount ($)<input name="amount" type="number" min="1" max="999999.99" step="0.01" required placeholder="50.00"></label>'+
   '<label>Donation purpose<select name="purpose"><option>General support</option><option>Patient care fund</option><option>Equipment fund</option><option>Community outreach</option><option>Other</option></select></label>'+
   '<label>Initial status<select name="status" id="nmcGiftInitialStatus"><option value="received">Received (counts as collected)</option><option value="pledged">Requested / pledged (not collected)</option></select></label>'+
   '<label>How received<select name="method" id="nmcGiftMethod"><option value="cash">Cash</option><option value="check">Check</option><option value="external-transfer">External transfer</option><option value="other">Other</option></select></label></div>'+
   '<label>Internal note (optional)<textarea name="notes" rows="2" maxlength="500" placeholder="Simulation reference or purpose details — no card numbers"></textarea></label>'+
   '<p class="muted">No real money is charged or transferred. A pledge is excluded from collected revenue until marked received.</p>'+
   '<div class="nmc-gift-actions"><button type="button" id="nmcGiftCancelForm">Cancel</button><button type="submit" class="primary-button">Save donation</button></div><p id="nmcGiftFormStatus" role="status"></p></form>';
  const form=edit.querySelector("form"),statusInput=form.elements.namedItem("status"),methodInput=form.elements.namedItem("method");
  statusInput.addEventListener("change",()=>{methodInput.disabled=statusInput.value==="pledged";});
  form.querySelector("#nmcGiftCancelForm").addEventListener("click",()=>{edit.classList.add("hidden");el("nmcGiftNew").setAttribute("aria-expanded","false");});
  form.addEventListener("submit",async event=>{
   event.preventDefault();
   const button=form.querySelector('[type="submit"]'),message=form.querySelector("#nmcGiftFormStatus");
   button.disabled=true;message.textContent="";
   try{
    const f=new FormData(form),status=String(f.get("status")),patientId=String(f.get("patientId")||"");
    const donorName=String(f.get("donorName")||"").trim(),amountCents=toCents(f.get("amount"));
    if(donorName.length<2||donorName.length>120)throw Error("Enter a donor name.");
    if(patientId&&!names.has(patientId))throw Error("Select a valid patient.");
    if(!["received","pledged"].includes(status))throw Error("Invalid status.");
    const method=status==="received"?String(f.get("method")):"pending";
    if(status==="received"&&!validMethods.includes(method))throw Error("Select how the donation was received.");
    const user=auth.currentUser;if(!user)throw Error("Sign in again.");
    const idRef=doc(collection(db,"nmcDonations")),audit=doc(collection(db,"auditEvents"));
    const receiptNumber="NMC-DON-"+idRef.id.slice(0,10).toUpperCase();
    const record={
     simulated:true,receiptNumber,patientId,donorName,donorType:patientId?"patient":"community",
     amountCents,purpose:String(f.get("purpose")),notes:String(f.get("notes")||"").trim(),
     method,status,createdBy:user.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),
     receivedBy:status==="received"?user.uid:"",receivedAt:status==="received"?serverTimestamp():null
    };
    const batch=writeBatch(db);
    batch.set(idRef,record);
    batch.set(audit,{type:"donation-created",actorUid:user.uid,donationId:idRef.id,amountCents,status,at:serverTimestamp()});
    await batch.commit();
    form.reset();methodInput.disabled=false;edit.classList.add("hidden");el("nmcGiftNew").setAttribute("aria-expanded","false");
    message.textContent="Donation recorded.";
   }catch(e){message.textContent=errorMessage(e);}
   finally{button.disabled=false;}
  });
 }
 stop=onSnapshot(query(collection(db,"nmcDonations"),orderBy("createdAt","desc")),snapshot=>{
  if(!host.isConnected)return;
  donations=snapshot.docs.map(d=>({id:d.id,...d.data()}));
  draw();
 },e=>{if(host.isConnected)refreshError("Unable to load donation records. Deploy the donation Firestore rules first. "+errorMessage(e));});
}
