// Northstar 3.0 pure selectors. Analysis only: never mutates patients or invoices.
export const dateValue=v=>{if(!v)return 0;const d=typeof v?.toDate==="function"?v.toDate():typeof v?.seconds==="number"?new Date(v.seconds*1000):new Date(v);const n=d?.getTime?.();return Number.isFinite(n)?n:0};
export const dollars=c=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format((Number(c)||0)/100);
export const patientLabel=p=>p?.displayName||[p?.firstName,p?.lastName].filter(Boolean).join(" ")||p?.patientName||"Unidentified patient";
export const notClosed=e=>!["discharged","closed","cancelled","canceled"].includes(String(e.status||"").toLowerCase());
const lower=v=>String(v||"").trim().toLowerCase();
export function patientTimeline(patientId,data){
 const types=[["encounters","Encounter","createdAt"],["orders","Clinical order","createdAt"],["results","Result","createdAt"],["procedures","Procedure","createdAt"],["medicationAdministrations","Medication administration","administeredAt"],["admissions","Admission","createdAt"],["emsArrivals","EMS","createdAt"],["tasks","Task","createdAt"],["clinicalNotes","Note","createdAt"]];
 const items=[];
 for(const [key,type,dateKey] of types)for(const record of data[key]||[]){
  if(record.patientId!==patientId)continue;
  items.push({id:record.id,type,collection:key,createdAt:dateValue(record[dateKey]||record.timestamp||record.updatedAt||record.date),title:record.name||record.title||record.summary||record.reason||record.status||type,status:record.status||"",encounterId:record.encounterId||""});
 }
 return items.sort((a,b)=>b.createdAt-a.createdAt);
}
export function flowSummary(data){
 const active=(data.encounters||[]).filter(notClosed),rooms=data.rooms||[],arrivals=data.emsArrivals||[],admissions=data.admissions||[];
 const occupied=rooms.filter(x=>["occupied","assigned","in-use"].includes(lower(x.status))||x.patientId&&x.status!=="available");
 const waiting=active.filter(x=>["waiting","triage","registered"].includes(lower(x.status)));
 const critical=active.filter(x=>["critical","resuscitation"].includes(lower(x.priority||x.acuity||x.triageLevel)));
 const pendingEms=arrivals.filter(x=>!["arrived","completed","cancelled"].includes(lower(x.status)));
 return {active:active.length,waiting:waiting.length,critical:critical.length,occupied:occupied.length,rooms:rooms.length,pendingEms:pendingEms.length,admitted:admissions.filter(x=>!["discharged","cancelled"].includes(lower(x.status))).length,encounters:active};
}
export function billingReview(data,now=Date.now()){
 const invoices=data.billingAccounts||[],encounters=data.encounters||[],orders=data.orders||[],procedures=data.procedures||[],prices=data.serviceCatalog||[];
 const billed=new Set(invoices.map(x=>x.encounterId)),unbilled=encounters.filter(x=>x.status==="discharged"&&!billed.has(x.id));
 const activeRates=prices.filter(x=>x.active!==false),priceNames=new Set(activeRates.map(x=>lower(x.name)));
 const byId=new Set(activeRates.map(x=>x.id));
 const needPrice=[...orders.map(x=>({...x,collection:"orders"})),...procedures.map(x=>({...x,collection:"procedures"}))].filter(x=>x.encounterId&&x.name&&!priceNames.has(lower(x.name))&&!(x.catalogRateId&&byId.has(x.catalogRateId))&&!["canceled","cancelled","void"].includes(lower(x.status)));
 const issues=[];
 for(const a of invoices){
  const total=(a.lineItems||[]).reduce((n,l)=>n+(Number(l.amountCents)||0),0);
  if(total!==a.chargeCents)issues.push({id:a.encounterId,type:"Line-item total mismatch",differenceCents:total-(a.chargeCents||0)});
  if((a.patientBalanceCents||0)<0||(a.insurerBalanceCents||0)<0)issues.push({id:a.encounterId,type:"Negative balance",differenceCents:0});
  // Do not assume repeated administrations are duplicates; flag for human review.
  const seen=new Map();for(const line of a.lineItems||[]){
   const key=[line.serviceId,line.sourceId].join(":");
   if(seen.has(key)&&line.sourceType!=="override")issues.push({id:a.encounterId,type:"Potential duplicate line",differenceCents:line.amountCents||0});
   seen.set(key,true);
  }
 }
 const aging={days0to30:0,days31to60:0,days61to90:0,over90:0};
 for(const a of invoices.filter(x=>(x.patientBalanceCents||0)>0)){
  const days=Math.max(0,Math.floor((now-dateValue(a.createdAt||a.updatedAt||now))/86400000));
  const key=days<=30?"days0to30":days<=60?"days31to60":days<=90?"days61to90":"over90";
  aging[key]+=(a.patientBalanceCents||0);
 }
 return {invoices:invoices.length,unbilled,unpriced:needPrice,issues,aging,patientDue:invoices.reduce((n,a)=>n+(a.patientBalanceCents||0),0),insurerDue:invoices.reduce((n,a)=>n+(a.insurerBalanceCents||0),0),waived:invoices.reduce((n,a)=>n+(a.waivedCents||0),0)};
}
export function integrityReview(data){
 const patients=new Set((data.patients||[]).map(x=>x.id)),encounters=new Map((data.encounters||[]).map(x=>[x.id,x]));
 const findings=[];
 const collections=["encounters","orders","results","procedures","medicationAdministrations","admissions","emsArrivals","billingAccounts","tasks"];
 for(const name of collections)for(const record of data[name]||[]){
  if(record.patientId&&!patients.has(record.patientId))findings.push({collection:name,id:record.id,reason:"Missing patient",patientId:record.patientId});
  if(name!=="encounters"&&record.encounterId&&!encounters.has(record.encounterId))findings.push({collection:name,id:record.id,reason:"Missing encounter",encounterId:record.encounterId});
  if(record.patientId&&record.encounterId&&encounters.has(record.encounterId)&&encounters.get(record.encounterId).patientId!==record.patientId)
   findings.push({collection:name,id:record.id,reason:"Patient/encounter mismatch",patientId:record.patientId,encounterId:record.encounterId});
 }
 const dupe=new Map();for(const p of data.patients||[]){const key=lower(p.mrn);if(!key)continue;const list=dupe.get(key)||[];list.push(p.id);dupe.set(key,list);}
 for(const [mrn,ids] of dupe)if(ids.length>1)findings.push({collection:"patients",id:ids.join(", "),reason:"Duplicate MRN",mrn});
 return findings;
}
export function dischargeReadiness(encounter,data){
 if(!encounter)return [];
 const id=encounter.id,issues=[];
 const orders=(data.orders||[]).filter(x=>x.encounterId===id&&["ordered","pending","in-progress"].includes(lower(x.status)));
 const results=(data.results||[]).filter(x=>x.encounterId===id&&x.abnormal&&x.status!=="reviewed");
 const tasks=(data.tasks||[]).filter(x=>x.encounterId===id&&!["completed","closed","done"].includes(lower(x.status)));
 const procedures=(data.procedures||[]).filter(x=>x.encounterId===id&&!["completed","cancelled"].includes(lower(x.status)));
 if(orders.length)issues.push({type:"Pending orders",count:orders.length});
 if(results.length)issues.push({type:"Unreviewed abnormal results",count:results.length});
 if(tasks.length)issues.push({type:"Open tasks",count:tasks.length});
 if(procedures.length)issues.push({type:"Unfinished procedures",count:procedures.length});
 if(!(data.billingAccounts||[]).some(x=>x.encounterId===id))issues.push({type:"Invoice not yet issued",count:1});
 return issues;
}
export function supplyReview(data){
 const items=data.supplyItems||[],equipment=data.nmcEquipment||[];
 return {supplies:items.length,low:items.filter(x=>Number(x.quantity??x.stock??0)<=Number(x.reorderLevel??x.minStock??0)),equipment:equipment.length,maintenance:equipment.filter(x=>["maintenance","out-of-service"].includes(lower(x.status))),expiring:equipment.filter(x=>x.nextServiceDate&&x.nextServiceDate<new Date().toISOString().slice(0,10))};
}
export function trainingReview(data){
 const items=data.nmcTrainingRecords||[];
 return {assigned:items.filter(x=>x.status==="assigned").length,inProgress:items.filter(x=>x.status==="in-progress").length,completed:items.filter(x=>x.status==="completed").length,items};
}
