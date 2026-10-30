export function summarizeBilling(accounts=[],encounters=[],now=new Date(),donations=[]){
 const clinicalCollected=accounts.reduce((a,x)=>a+(x.patientPaidCents||0)+(x.insuranceReceivedCents||0),0);
 const donationCollected=donations.filter(x=>x.status==="received").reduce((a,x)=>a+(Number(x.amountCents)||0),0);
 const donationPledged=donations.filter(x=>x.status==="pledged").reduce((a,x)=>a+(Number(x.amountCents)||0),0);
 const pending=new Set(accounts.map(x=>x.encounterId));
 const unbilled=encounters.filter(x=>x.status==="discharged"&&x.patientId&&!pending.has(x.id));
 const today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-");
 const due=accounts.filter(x=>x.patientBalanceCents>0&&/^\d{4}-\d{2}-\d{2}$/.test(x.paymentDueDate||"")&&x.paymentDueDate<today);
 const claimPending=accounts.filter(x=>x.insurerBalanceCents>0);
 return {
  invoices:accounts.length,unbilled:unbilled.length,overdue:due.length,claimsToReview:claimPending.length,
  totalCharges:accounts.reduce((a,x)=>a+(x.chargeCents||0),0),
  clinicalCollected,donationCollected,donationPledged,collected:clinicalCollected+donationCollected,
  waived:accounts.reduce((a,x)=>a+(x.waivedCents||0),0),
  patientBalance:accounts.reduce((a,x)=>a+(x.patientBalanceCents||0),0),
  insuranceBalance:accounts.reduce((a,x)=>a+(x.insurerBalanceCents||0),0),
  unbilledRows:unbilled,overdueRows:due,claimsPendingRows:claimPending
 };
}
const csvEsc=v=>{const s=String(v??"");return /[,"\n\r]/.test(s)?'"'+s.replaceAll('"','""')+'"':s};
export function exportBillingCSV(accounts=[],patients=[]){
 const names=new Map(patients.map(x=>[x.id,x.displayName||x.firstName+" "+x.lastName]));
 const cols=["invoice","encounterId","patientName","status","claimStatus","charges","insurerEstimate","insurerPaid","patientPaid","waived","patientBalance","insurerBalance","dueDate"];
 return [cols.join(","),...accounts.map(a=>[
  a.invoiceNumber,a.encounterId,names.get(a.patientId)||a.patientName,a.status,a.claimStatus,
  a.chargeCents,a.insuranceEstimatedCents,a.insuranceReceivedCents,a.patientPaidCents,
  a.waivedCents,a.patientBalanceCents,a.insurerBalanceCents,a.paymentDueDate||""
 ].map(csvEsc).join(","))].join("\r\n")+"\r\n";
}
