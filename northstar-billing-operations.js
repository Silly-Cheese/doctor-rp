// Northstar billing operations: preserve issued line items, payments, and
// append-only audit entries. All values are simulated cents, not real money.
export const cents=x=>Number.isInteger(x)?x:0;
export function reconcile(account){
 const a={...account},charged=cents(a.chargeCents),insurance=cents(a.insuranceEstimatedCents),waived=cents(a.waivedCents);
 const insurerReceived=cents(a.insuranceReceivedCents),patientPaid=cents(a.patientPaidCents);
 if([charged,insurance,waived,insurerReceived,patientPaid].some(n=>n<0)||insurance<insurerReceived||charged<insurance+waived+patientPaid)throw Error("Adjustments cannot exceed charges or previously received payments.");
 a.patientResponsibilityCents=charged-insurance-waived;
 a.patientBalanceCents=a.patientResponsibilityCents-patientPaid;
 a.insurerBalanceCents=insurance-insurerReceived;
 a.status=charged>0&&waived===charged?"waived":a.patientBalanceCents===0&&a.insurerBalanceCents===0?"paid":a.insurerBalanceCents>0?"insurance-pending":patientPaid>0?"partially-paid":"open";
 return a;
}
export function waiveAccount(account,{includeInsurance=false}={}){
 const a={...account};
 if(includeInsurance)a.insuranceEstimatedCents=cents(a.insuranceReceivedCents);
 const totalAvailable=cents(a.chargeCents)-cents(a.insuranceEstimatedCents)-cents(a.patientPaidCents);
 a.waivedCents=totalAvailable;
 a.waiverReason="Bulk administrative waiver";
 return reconcile(a);
}
export function overrideCharge(account,{mode="total",itemIndex=0,newAmountCents,reason=""}={}){
 const a={...account};
 if(!Number.isSafeInteger(newAmountCents)||newAmountCents<0||newAmountCents>999999999)throw Error("Enter a valid nonnegative override amount.");
 if(String(reason).trim().length<5)throw Error("An administrative override reason is required.");
 const base=Array.isArray(a.lineItems)?a.lineItems:[];
 if(!base.length)throw Error("Invoice has no itemized charges.");
 const current=cents(a.chargeCents);
 let delta;
 let detail;
 if(mode==="line"){
  if(!Number.isInteger(itemIndex)||itemIndex<0||itemIndex>=base.length)throw Error("Choose an itemized charge.");
  const item=base[itemIndex];
  if(item.sourceType==="correction"||item.sourceType==="override")throw Error("Override an original service line, not a correction entry.");
  const original=cents(item.amountCents);
  const previouslyApplied=base.filter(x=>x.overrideTargetIndex===itemIndex).reduce((n,x)=>n+cents(x.amountCents),0);
  delta=newAmountCents-(original+previouslyApplied);
  detail="Override "+String(item.description||"Charge")+" to "+(newAmountCents/100).toFixed(2);
 }else if(mode==="total"){delta=newAmountCents-current;detail="Administrative invoice-total override to "+(newAmountCents/100).toFixed(2);}
 else throw Error("Unsupported override type.");
 if(!delta)throw Error("The override does not change the current amount.");
 const newTotal=current+delta;
 if(newTotal<cents(a.patientPaidCents)+cents(a.insuranceReceivedCents))throw Error("Cannot reduce charges below money already recorded as received. Record a refund first.");
 a.lineItems=[...base,{description:detail,quantity:1,unitPriceCents:delta,amountCents:delta,sourceType:"override",sourceId:"administrator",overrideTargetIndex:mode==="line"?itemIndex:null}];
 a.chargeCents=newTotal;
 // Reconcile existing allocations without deleting any recorded payments.
 a.insuranceEstimatedCents=Math.min(cents(a.insuranceEstimatedCents),newTotal-cents(a.patientPaidCents));
 a.insuranceEstimatedCents=Math.max(cents(a.insuranceEstimatedCents),cents(a.insuranceReceivedCents));
 a.waivedCents=Math.min(cents(a.waivedCents),newTotal-a.insuranceEstimatedCents-cents(a.patientPaidCents));
 return {account:reconcile(a),delta,detail};
}
export function groupPatientInvoices(records=[],patients=[]){
 const names=new Map(patients.map(p=>[p.id,p.displayName||[p.firstName,p.lastName].filter(Boolean).join(" ")]));
 const group=new Map();
 for(const inv of records){
  const patientId=String(inv.patientId||"missing:"+String(inv.encounterId));
  if(!group.has(patientId))group.set(patientId,{patientId,name:names.get(patientId)||inv.patientName||"Unidentified patient",records:[],patientBalanceCents:0,insurerBalanceCents:0,totalChargesCents:0});
  const p=group.get(patientId);
  p.records.push(inv);p.patientBalanceCents+=cents(inv.patientBalanceCents);p.insurerBalanceCents+=cents(inv.insurerBalanceCents);p.totalChargesCents+=cents(inv.chargeCents);
 }
 return [...group.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
export function filterBilling(records,{search="",status="",patientId="",minChargesCents=0,unpaidOnly=false,olderThan="",overdueOnly=false,now="2026-10-26",sort="balance"}={}){
 const query=String(search).trim().toLowerCase();
 return records.filter(a=>{
  const created=(a.createdAt?.toDate?.()||a.createdAt);
  const createdDate=created instanceof Date?created.toISOString().slice(0,10):created?.seconds?new Date(created.seconds*1000).toISOString().slice(0,10):"";
  return (!patientId||a.patientId===patientId)&&(!status||a.status===status)
   &&(!unpaidOnly||cents(a.patientBalanceCents)+cents(a.insurerBalanceCents)>0)
   &&(!overdueOnly||(a.paymentDueDate&&a.paymentDueDate<now&&cents(a.patientBalanceCents)>0))
   &&(!olderThan||(createdDate&&createdDate<=olderThan))
   &&cents(a.chargeCents)>=minChargesCents
   &&(!query||[a.patientName,a.invoiceNumber,a.insuranceProvider,a.encounterId].some(s=>String(s||"").toLowerCase().includes(query)));
 }).sort((a,b)=>sort==="patient"?String(a.patientName).localeCompare(String(b.patientName)):sort==="due"?String(a.paymentDueDate||"9999").localeCompare(String(b.paymentDueDate||"9999")):sort==="charges"?cents(b.chargeCents)-cents(a.chargeCents):cents(b.patientBalanceCents)-cents(a.patientBalanceCents));
}
