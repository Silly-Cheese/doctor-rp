import {getApp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {getAuth} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {getFirestore,doc,getDoc,collection,runTransaction,serverTimestamp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {collectEncounterCharges} from "./northstar-service-catalog.js";
import {reconcile,waiveAccount,overrideCharge} from "./northstar-billing-operations.js";
const db=()=>getFirestore(getApp());
const actor=()=>{const user=getAuth(getApp()).currentUser;if(!user)throw Error("Sign in to use administrative billing.");return user.uid;};
const AUDIT_REASON_LIMIT=750;
function reasonText(reason){const r=String(reason||"").trim();if(r.length<5||r.length>AUDIT_REASON_LIMIT)throw Error("A documented reason between 5 and 750 characters is required.");return r;}
function eventFor(ref,uid,action,amount,reason,detail){
 return {action,amountCents:Math.abs(amount),detail:String(detail).slice(0,250),reason,actorUid:uid,createdAt:serverTimestamp(),simulated:true};
}
export async function waiveIssuedInvoice({encounterId,includeInsurance=false,reason}){
 const why=reasonText(reason),uid=actor(),store=db();
 if(!encounterId)throw Error("Missing invoice identifier.");
 return runTransaction(store,async tx=>{
  const ref=doc(store,"billingAccounts",encounterId),snap=await tx.get(ref);
  if(!snap.exists())throw Error("Invoice no longer exists.");
  const old=snap.data(),next=waiveAccount(old,{includeInsurance});
  const patientWaiver=Math.max(0,next.waivedCents-(old.waivedCents||0));
  const payerCleared=Math.max(0,(old.insuranceEstimatedCents||0)-next.insuranceEstimatedCents);
  if(!patientWaiver&&!payerCleared)throw Error("This invoice has no additional unpaid amount to waive.");
  const event=doc(collection(store,"billingAccounts",encounterId,"events"));
  tx.update(ref,{waivedCents:next.waivedCents,waiverReason:why,insuranceEstimatedCents:next.insuranceEstimatedCents,claimStatus:includeInsurance&&payerCleared?"denied":old.claimStatus,
   patientResponsibilityCents:next.patientResponsibilityCents,patientBalanceCents:next.patientBalanceCents,insurerBalanceCents:next.insurerBalanceCents,status:next.status,
   updatedAt:serverTimestamp(),updatedBy:uid,adjustmentAuditId:event.id});
  tx.set(event,eventFor(ref,uid,"bulk-waiver",patientWaiver+payerCleared,why,"Waived patient balance "+patientWaiver+" cents; adjusted insurer estimate "+payerCleared+" cents"));
  return {encounterId,patientWaivedCents:patientWaiver,insurerEstimateClearedCents:payerCleared};
 });
}
export async function waiveUnbilledEncounter({encounter,reason}){
 const why=reasonText(reason),uid=actor(),store=db();
 if(encounter?.status!=="discharged"||!encounter?.id||!encounter?.patientId)throw Error("Only discharged encounters without invoices can be waived retrospectively.");
 const quote=await collectEncounterCharges(encounter.id);
 if(quote.unpriced.length)throw Error("Cannot waive unpriced services: "+quote.unpriced.map(x=>x.name).join(", ")+". Set the prices first.");
 if(!quote.lines.length||quote.lines.length>100)throw Error("No eligible priced services were found for this encounter.");
 if(quote.totalCents<0||quote.totalCents>999999999)throw Error("Encounter charge exceeds supported billing limits.");
 const patientSnap=await getDoc(doc(store,"patients",encounter.patientId));if(!patientSnap.exists())throw Error("Patient record is missing.");
 const ref=doc(store,"billingAccounts",encounter.id);
 return runTransaction(store,async tx=>{
  const existing=await tx.get(ref);if(existing.exists())throw Error("Encounter already has an invoice.");
  const event=doc(collection(store,"billingAccounts",encounter.id,"events"));
  const invoice={
   encounterId:encounter.id,patientId:encounter.patientId,patientName:patientSnap.get("displayName")||encounter.patientName||"Patient",
   invoiceNumber:"NMC-"+encounter.id.slice(0,10).toUpperCase(),
   lineItems:quote.lines,chargeCents:quote.totalCents,insuranceEstimatedCents:0,insuranceReceivedCents:0,
   waivedCents:quote.totalCents,patientPaidCents:0,patientResponsibilityCents:0,patientBalanceCents:0,insurerBalanceCents:0,
   insuranceProvider:"",paymentDueDate:"",claimStatus:"not-applicable",waiverReason:why,
   notes:"Retrospective billing: charges calculated and fully waived by administrator.",billingMode:"waived",status:quote.totalCents>0?"waived":"paid",
   createdBy:uid,updatedBy:uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),source:"retrospective-waiver",simulated:true
  };
  tx.set(ref,invoice);
  tx.set(event,eventFor(ref,uid,"bulk-waiver",quote.totalCents,why,"Full retrospective waiver of discharged encounter"));
  return {encounterId:encounter.id,patientWaivedCents:quote.totalCents,created:true};
 });
}
export async function overrideInvoiceCharges({encounterId,mode="total",itemIndex=0,newAmountCents,reason}){
 const why=reasonText(reason),uid=actor(),store=db();
 if(!encounterId)throw Error("Missing invoice identifier.");
 return runTransaction(store,async tx=>{
  const ref=doc(store,"billingAccounts",encounterId),snap=await tx.get(ref);
  if(!snap.exists())throw Error("Invoice has been deleted.");
  const {account,delta,detail}=overrideCharge(snap.data(),{mode,itemIndex,newAmountCents,reason:why});
  if(account.lineItems.length>100)throw Error("Invoice has reached the line-item limit. Contact an administrator to consolidate corrections.");
  const event=doc(collection(store,"billingAccounts",encounterId,"events"));
  tx.update(ref,{lineItems:account.lineItems,chargeCents:account.chargeCents,insuranceEstimatedCents:account.insuranceEstimatedCents,
   waivedCents:account.waivedCents,patientResponsibilityCents:account.patientResponsibilityCents,patientBalanceCents:account.patientBalanceCents,
   insurerBalanceCents:account.insurerBalanceCents,status:account.status,updatedBy:uid,updatedAt:serverTimestamp(),
   adjustmentAuditId:event.id});
  tx.set(event,eventFor(ref,uid,mode==="line"?"line-override":"charge-override",delta,why,detail));
  return {encounterId,previousCents:snap.data().chargeCents,newCents:account.chargeCents,delta};
 });
}
export async function bulkWaiveSelection({invoiceIds=[],encounters=[],includeInsurance=false,reason,onProgress=()=>{}}){
 const why=reasonText(reason);
 const unique=[...new Set(invoiceIds.filter(Boolean))];
 const unbilled=[...new Map(encounters.filter(x=>x?.id).map(x=>[x.id,x])).values()];
 if(unique.length+unbilled.length===0)throw Error("Select at least one invoice or unbilled discharge.");
 if(unique.length+unbilled.length>100)throw Error("Run bulk waivers in groups of up to 100 records.");
 const report={completed:[],failed:[]};let done=0;
 for(const id of unique){try{report.completed.push(await waiveIssuedInvoice({encounterId:id,includeInsurance,reason:why}));}
  catch(e){report.failed.push({id,message:e.message||String(e)})}onProgress(++done,unique.length+unbilled.length);}
 for(const encounter of unbilled){try{report.completed.push(await waiveUnbilledEncounter({encounter,reason:why}));}
  catch(e){report.failed.push({id:encounter.id,message:e.message||String(e)})}onProgress(++done,unique.length+unbilled.length);}
 return report;
}
