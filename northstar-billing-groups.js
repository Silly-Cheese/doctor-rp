// Pure helpers for the roleplay billing workspace.
// No Firebase dependency: used by the UI, transactional writes, and browser tests.
const number=v=>Number.isFinite(Number(v))?Number(v):0;
export function dateFromRecord(value){
 if(!value)return null;
 const date=typeof value.toDate==="function"?value.toDate():
  typeof value.seconds==="number"?new Date(value.seconds*1000):
  value instanceof Date?value:new Date(value);
 return Number.isNaN(date?.getTime?.())?null:date;
}
export function invoiceAgeDays(invoice,now=new Date()){
 const issued=dateFromRecord(invoice.createdAt);
 if(!issued)return null;
 return Math.max(0,Math.floor((now.getTime()-issued.getTime())/86400000));
}
export function groupInvoicesByPatient(invoices=[],patients=[]){
 const names=new Map(patients.map(p=>[p.id,p.displayName||[p.firstName,p.lastName].filter(Boolean).join(" ")]));
 const groups=new Map();
 for(const invoice of invoices){
  const patientId=String(invoice.patientId||"");
  const key=patientId||"unknown:"+String(invoice.encounterId||invoice.invoiceNumber||"unknown");
  if(!groups.has(key))groups.set(key,{key,patientId,name:names.get(patientId)||invoice.patientName||"Unknown patient",invoices:[],
   chargedCents:0,patientBalanceCents:0,insurerBalanceCents:0});
  const group=groups.get(key);group.invoices.push(invoice);
  group.chargedCents+=number(invoice.chargeCents);
  group.patientBalanceCents+=number(invoice.patientBalanceCents);
  group.insurerBalanceCents+=number(invoice.insurerBalanceCents);
 }
 return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.key.localeCompare(b.key));
}
export function waiveOutstandingInvoice(invoice,{includeInsurer=false,reason="",actorUid=""}={}){
 if(!invoice?.encounterId||!actorUid)throw Error("A valid invoice and staff account are required.");
 if(reason.trim().length<5||reason.length>750)throw Error("Provide a reason between 5 and 750 characters.");
 const balance=Math.max(0,number(invoice.patientBalanceCents));
 const insurerBalance=Math.max(0,number(invoice.insurerBalanceCents));
 const added=balance+(includeInsurer?insurerBalance:0);
 if(added<=0)throw Error("This invoice has no eligible outstanding balance to waive.");
 const updatedInsurance=includeInsurer?number(invoice.insuranceReceivedCents):number(invoice.insuranceEstimatedCents);
 const updatedWaiver=number(invoice.waivedCents)+added;
 const responsibility=number(invoice.chargeCents)-updatedInsurance-updatedWaiver;
 const paid=number(invoice.patientPaidCents);
 const patientBalance=responsibility-paid,insurerRemaining=updatedInsurance-number(invoice.insuranceReceivedCents);
 if(responsibility<0||patientBalance!==0||insurerRemaining<0||updatedWaiver<0)throw Error("Waiver calculation failed financial checks.");
 const status=insurerRemaining>0?"insurance-pending":updatedWaiver===number(invoice.chargeCents)?"waived":"paid";
 const claimStatus=includeInsurer?updatedInsurance===0?"not-applicable":"paid":invoice.claimStatus;
 return {
  addedWaiverCents:added,
  patch:{waivedCents:updatedWaiver,insuranceEstimatedCents:updatedInsurance,patientResponsibilityCents:responsibility,
   patientBalanceCents:0,insurerBalanceCents:insurerRemaining,status,claimStatus,waiverReason:reason.trim(),updatedBy:actorUid}
 };
}
export function buildAdministrativeWaiverInvoice(encounter,quote,{reason="",actorUid=""}={}){
 if(!encounter?.id||!encounter.patientId||!actorUid)throw Error("A patient encounter and active staff member are required.");
 if(reason.trim().length<5||reason.length>750)throw Error("Provide a documented waiver reason.");
 const priced=(quote?.lines||[]).map(x=>({...x}));
 const unpriced=(quote?.unpriced||[]).map(item=>({
  description:"Unpriced — "+String(item.name||"Clinical service").slice(0,120),
  sourceType:"unpriced",sourceId:item.sourceId||"",clinicalGroup:item.kind||"unknown",
  quantity:1,unitPriceCents:0,amountCents:0,rateVersion:0
 }));
 const lines=[...priced,...unpriced];
 if(!lines.length)lines.push({description:"Administrative no-charge closure (no catalog-priced services)",
  sourceType:"administrative",sourceId:"waiver:"+encounter.id,quantity:1,unitPriceCents:0,amountCents:0,rateVersion:0});
 if(lines.length>100)throw Error("Encounter has too many line items for automatic waiver; review it manually.");
 const charge=priced.reduce((sum,item)=>sum+number(item.amountCents),0);
 if(charge<0||!Number.isInteger(charge))throw Error("Invalid pricing quote.");
 return {
  encounterId:encounter.id,patientId:encounter.patientId,patientName:encounter.patientName||"Patient",
  invoiceNumber:"NMC-"+encounter.id.slice(0,10).toUpperCase(),
  lineItems:lines,chargeCents:charge,insuranceEstimatedCents:0,insuranceReceivedCents:0,
  waivedCents:charge,patientPaidCents:0,patientResponsibilityCents:0,
  patientBalanceCents:0,insurerBalanceCents:0,insuranceProvider:"",
  paymentDueDate:"",claimStatus:"not-applicable",waiverReason:reason.trim(),
  notes:unpriced.length?unpriced.length+" service(s) lacked pricing; listed at $0 and excluded from charges before administrative waiver.":"Administrative full waiver of pre-discharge billing gap.",
  billingMode:"waived",status:"waived",createdBy:actorUid,updatedBy:actorUid,source:"administrative-unbilled-waiver",simulated:true
 };
}
export function selectWaiverCandidates({mode="aged",invoices=[],encounters=[],patients=[],selectedIds=[],patientId="",ageDays=90,now=new Date(),includeInsurer=false,limit=30}={}){
 const allowed=invoice=>!patientId||invoice.patientId===patientId;
 const existing=new Set(invoices.map(x=>x.encounterId));
 let matched;
 if(mode==="unbilled")matched=encounters.filter(e=>e.status==="discharged"&&e.patientId&&!existing.has(e.id)&&allowed(e));
 else if(mode==="selected"){
  const chosen=new Set(selectedIds);
  matched=invoices.filter(x=>chosen.has(x.encounterId)&&allowed(x)&&
   (number(x.patientBalanceCents)>0||(includeInsurer&&number(x.insurerBalanceCents)>0)));
 }else if(mode==="aged")matched=invoices.filter(x=>allowed(x)&&
  invoiceAgeDays(x,now)!==null&&invoiceAgeDays(x,now)>=ageDays&&
  (number(x.patientBalanceCents)>0||(includeInsurer&&number(x.insurerBalanceCents)>0)));
 else throw Error("Unknown waiver target");
 return {total:matched.length,selected:matched.slice(0,limit),remaining:Math.max(0,matched.length-limit),
  estimatedWaiverCents:mode==="unbilled"?null:matched.slice(0,limit).reduce((total,x)=>total+number(x.patientBalanceCents)+(includeInsurer?number(x.insurerBalanceCents):0),0)};
}
