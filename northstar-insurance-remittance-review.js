// Staff-only review of public simulated insurer remittances.
// Accepting a request atomically credits the billing ledger, writes its audit
// event and marks the request accepted. Public clients never credit invoices.
import {getApp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {getAuth} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {getFirestore,doc,collection,query,where,getDocs,runTransaction,serverTimestamp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const currency=c=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format((Number(c)||0)/100);
const el=(tag,className,value)=>{
  const x=document.createElement(tag);if(className)x.className=className;if(value!==undefined)x.textContent=value;return x;
};
const accountStatus=a=>{
  const insurer=Math.max(0,a.insuranceEstimatedCents-a.insuranceReceivedCents);
  const patient=Math.max(0,a.patientResponsibilityCents-a.patientPaidCents);
  if(a.waivedCents===a.chargeCents&&a.chargeCents>0)return "waived";
  if(insurer===0&&patient===0)return "paid";
  if(insurer>0)return "insurance-pending";
  if(a.patientPaidCents>0)return "partially-paid";
  return "open";
};
async function decide({requestId,encounterId,decision,reason}){
  const user=getAuth(getApp()).currentUser;
  if(!user)throw Error("Sign in with billing-management access to review a remittance.");
  if(reason.trim().length<5||reason.trim().length>750)throw Error("Enter a review reason (5–750 characters).");
  const db=getFirestore(getApp());
  const requestRef=doc(db,"insuranceRemittanceRequests",requestId);
  const invoiceRef=doc(db,"billingAccounts",encounterId);
  await runTransaction(db,async tx=>{
    // Read all needed documents before writing.
    const [requestDoc,invoiceDoc]=await Promise.all([tx.get(requestRef),tx.get(invoiceRef)]);
    if(!requestDoc.exists()||!invoiceDoc.exists())throw Error("The remittance or invoice no longer exists.");
    const pending=requestDoc.data();
    if(pending.encounterId!==encounterId||pending.status!=="pending")throw Error("This request has already been reviewed.");
    const review={status:decision,reviewedAt:serverTimestamp(),reviewedBy:user.uid,reviewReason:reason.trim(),receiptEventId:""};
    if(decision==="accepted"){
      const a=invoiceDoc.data();
      const amount=Number(pending.amountCents);
      if(pending.invoiceNumber!==a.invoiceNumber||!Number.isSafeInteger(amount)||amount<1||
         amount>Number(a.insurerBalanceCents))throw Error("Insurer balance has changed or remittance exceeds the remaining amount. Decline and ask for a new request.");
      const insuranceReceivedCents=a.insuranceReceivedCents+amount;
      const insurerBalanceCents=a.insuranceEstimatedCents-insuranceReceivedCents;
      const next={
        ...a,insuranceReceivedCents,insurerBalanceCents,
        claimStatus:insurerBalanceCents===0?"paid":"partially-paid"
      };
      next.status=accountStatus(next);
      const eventRef=doc(collection(db,"billingAccounts",encounterId,"events"));
      review.receiptEventId=eventRef.id;
      tx.update(invoiceRef,{
        insuranceReceivedCents,insurerBalanceCents,
        claimStatus:next.claimStatus,status:next.status,
        updatedAt:serverTimestamp(),updatedBy:user.uid
      });
      tx.set(eventRef,{
        action:"insurance-payment",amountCents:amount,
        detail:("Public insurer remittance "+String(pending.remittanceReference||"")).slice(0,250),
        reason:reason.trim(),actorUid:user.uid,createdAt:serverTimestamp(),simulated:true
      });
    }else if(decision!=="declined")throw Error("Unrecognized review action.");
    tx.update(requestRef,review);
  });
}
export async function mountInsuranceRemittanceReview({encounterId,target,onPosted}){
  target.replaceChildren();
  target.append(el("h3","","Incoming insurer payments"),el("p","nmc-remittance-intro","Simulated remittances submitted without login require billing staff confirmation. No real funds have been transferred."));
  const list=el("div","nmc-remittance-list");
  target.append(list);
  const reload=async()=>{
    list.replaceChildren(el("p","","Loading remittances…"));
    try{
      const db=getFirestore(getApp());
      const result=await getDocs(query(collection(db,"insuranceRemittanceRequests"),where("encounterId","==",encounterId)));
      if(result.empty){list.replaceChildren(el("p","","No external insurer remittances submitted for this invoice."));return;}
      const docs=result.docs.map(s=>({id:s.id,...s.data()}))
        .sort((a,b)=>(b.submittedAt?.seconds||0)-(a.submittedAt?.seconds||0));
      list.replaceChildren();
      for(const r of docs){
        const item=el("article","nmc-remittance");
        item.append(el("strong","",""+currency(r.amountCents)+" · "+(r.status==="pending"?"Awaiting review":r.status==="accepted"?"Posted to invoice":"Declined")));
        item.append(el("p","",String(r.insurerName||"Unknown insurer")+" · "+String(r.method||"other").toUpperCase()+" · Ref: "+String(r.remittanceReference||"")));
        if(r.note)item.append(el("p","nmc-remittance-note",String(r.note)));
        const stamp=r.submittedAt?.toDate?.();
        if(stamp)item.append(el("small","",stamp.toLocaleString()));
        if(r.status==="pending"){
          const tools=el("div","nmc-remittance-actions");
          const reason=el("textarea","","");reason.placeholder="Review reason (required, at least 5 characters)";reason.maxLength=750;reason.rows=2;reason.setAttribute("aria-label","Reason for accepting or declining the remittance");
          const accept=el("button","","Accept & post payment"),decline=el("button","nmc-remittance-decline","Decline");
          accept.type=decline.type="button";
          const feedback=el("p","nmc-remittance-feedback");
          for(const [button,decision] of [[accept,"accepted"],[decline,"declined"]]){
            button.onclick=async()=>{
              accept.disabled=decline.disabled=true;feedback.textContent="";
              try{
                await decide({requestId:r.id,encounterId,decision,reason:reason.value});
                if(decision==="accepted"&&typeof onPosted==="function")await onPosted();
                else await reload();
              }catch(e){feedback.textContent=e.message||"Unable to review this remittance.";accept.disabled=decline.disabled=false;}
            };
          }
          tools.append(reason,accept,decline,feedback);item.append(tools);
        }else if(r.reviewReason)item.append(el("p","nmc-remittance-note","Staff review: "+String(r.reviewReason)));
        list.append(item);
      }
    }catch(e){list.replaceChildren(el("p","nmc-remittance-feedback","Unable to load insurer remittances: "+(e.message||e)));}
  };
  await reload();
}
