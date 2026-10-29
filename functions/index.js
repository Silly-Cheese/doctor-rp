const {onCall,HttpsError}=require("firebase-functions/v2/https");
const admin=require("firebase-admin");
admin.initializeApp();
const db=admin.firestore();
const requireUser=async request=>{
  if(!request.auth)throw new HttpsError("unauthenticated","Please sign in.");
  const uid=request.auth.uid;
  const snap=await db.doc("users/"+uid).get();
  if(!snap.exists||snap.get("status")!=="active")
    throw new HttpsError("permission-denied","An active staff account is required.");
  return {uid,role:snap.get("role"),permissions:snap.get("permissions")||{}};
};
exports.northstarHealth=onCall({region:"us-central1",timeoutSeconds:20},async request=>{
 const actor=await requireUser(request);
 return {service:"northstar-backend",status:"ready",version:"2026-10-22-audit",role:actor.role};
});


/** Northstar 3.0 — server-side read-only integrity diagnostics.
 *  Neither action deletes records, merges identities, or changes an invoice.
 */
const boundedRead=async(name,limit=500)=>{
 const snapshot=await db.collection(name).limit(limit).get();
 return {records:snapshot.docs.map(doc=>({id:doc.id,...doc.data()})),truncated:snapshot.size===limit};
};
const requireAdministrator=async request=>{
 const user=await requireUser(request);
 if(user.role!=="administrator")throw new HttpsError("permission-denied","Administrator clearance required.");
 return user;
};
exports.northstarV3Integrity=onCall({region:"us-central1",timeoutSeconds:45,memory:"512MiB"},async request=>{
 const actor=await requireAdministrator(request);
 const collections=["patients","encounters","orders","results","procedures","medicationAdministrations","admissions","billingAccounts","tasks","emsArrivals"];
 const loaded=await Promise.all(collections.map(name=>boundedRead(name)));
 const data=Object.fromEntries(collections.map((n,i)=>[n,loaded[i].records]));
 const patientIds=new Set(data.patients.map(x=>x.id));
 const encounterIds=new Map(data.encounters.map(x=>[x.id,x]));
 const issues=[];
 const add=(collection,id,reason)=>{if(issues.length<250)issues.push({collection,id,reason});};
 for(const name of collections.slice(1))for(const item of data[name]){
  if(item.patientId&&!patientIds.has(item.patientId))add(name,item.id,"missing-patient");
  if(item.encounterId&&!encounterIds.has(item.encounterId))add(name,item.id,"missing-encounter");
  if(item.patientId&&item.encounterId&&encounterIds.has(item.encounterId)&&encounterIds.get(item.encounterId).patientId!==item.patientId)
   add(name,item.id,"patient-encounter-mismatch");
 }
 const mrns=new Map();
 for(const p of data.patients){const mrn=String(p.mrn||"").trim().toLowerCase();if(!mrn)continue;if(mrns.has(mrn))add("patients",p.id,"duplicate-mrn");else mrns.set(mrn,p.id);}
 return {version:"northstar-3.0",readOnly:true,actorRole:actor.role,checked:Object.fromEntries(collections.map((n,i)=>[n,loaded[i].records.length])),
  incomplete:collections.filter((n,i)=>loaded[i].truncated),issues,issueLimitReached:issues.length===250,
  note:"Read-only bounded diagnostic. No patient records were modified or deleted."};
});
exports.northstarV3BillingAudit=onCall({region:"us-central1",timeoutSeconds:45,memory:"512MiB"},async request=>{
 const actor=await requireUser(request);
 if(actor.role!=="administrator"&&actor.permissions?.billingManage!==true)
  throw new HttpsError("permission-denied","Billing Management access required.");
 const data=await boundedRead("billingAccounts",500);
 const issues=[];
 for(const a of data.records){
  const lines=Array.isArray(a.lineItems)?a.lineItems:[];
  const sum=lines.reduce((n,l)=>n+(Number(l.amountCents)||0),0);
  const charged=Number(a.chargeCents)||0;
  if(sum!==charged)issues.push({invoiceId:a.id,reason:"line-total-mismatch",differenceCents:sum-charged});
  const expectedPatient=charged-(Number(a.waivedCents)||0)-(Number(a.insuranceEstimatedCents)||0)-(Number(a.patientPaidCents)||0);
  if(expectedPatient!==(Number(a.patientBalanceCents)||0))issues.push({invoiceId:a.id,reason:"patient-allocation-mismatch",differenceCents:expectedPatient-(Number(a.patientBalanceCents)||0)});
  const expectedInsurer=(Number(a.insuranceEstimatedCents)||0)-(Number(a.insuranceReceivedCents)||0);
  if(expectedInsurer!==(Number(a.insurerBalanceCents)||0))issues.push({invoiceId:a.id,reason:"insurer-allocation-mismatch",differenceCents:expectedInsurer-(Number(a.insurerBalanceCents)||0)});
  if(issues.length>=200)break;
 }
 return {version:"northstar-3.0",readOnly:true,checked:data.records.length,incomplete:data.truncated,
  issues,issueLimitReached:issues.length>=200,note:"No invoice amounts were changed. Review discrepancies in Billing & Revenue."};
});


/** Northstar 4.0 surgery case preparation (roleplay only).
 * Deterministic IDs + Firestore transaction make duplicate Cloud Function delivery safe.
 * No medications are prescribed/administered; no financial charges are posted.
 */
const {onDocumentCreated}=require("firebase-functions/v2/firestore");
exports.northstarV4PrepareSurgery=onDocumentCreated({
 document:"nmcSurgicalCases/{caseId}",region:"us-central1",retry:false
},async event=>{
 const record=event.data?.data(),caseId=event.params.caseId;
 if(!record||!record.patientId||!record.encounterId||record.status!=="scheduled")return;
 const sterile=db.doc("nmcSterileRequests/surgery_"+caseId),transport=db.doc("nmcTransportRequests/surgery_"+caseId);
 await db.runTransaction(async transaction=>{
  const [sterileSnap,transportSnap]=await Promise.all([transaction.get(sterile),transaction.get(transport)]);
  const shared={surgeryId:caseId,patientId:record.patientId,encounterId:record.encounterId,
   patientName:record.patientName||"",priority:record.priority||"routine",createdAt:admin.firestore.FieldValue.serverTimestamp(),
   updatedAt:admin.firestore.FieldValue.serverTimestamp(),createdBy:"system:northstarV4PrepareSurgery",updatedBy:"system:northstarV4PrepareSurgery",source:"surgical-case"};
  if(!sterileSnap.exists)transaction.create(sterile,{...shared,procedureName:record.procedureName||"Procedure",
   room:record.room||"",status:"requested",note:"Verify available instrument sets and record sterilization readiness before surgery."});
  if(!transportSnap.exists)transaction.create(transport,{...shared,origin:"Current patient location",destination:record.room||"Operating Room",
   assignedUid:"",status:"requested",note:"Verify patient identity and handoff before transport."});
 });
});
