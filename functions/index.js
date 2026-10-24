const {onCall,HttpsError}=require("firebase-functions/v2/https");
const admin=require("firebase-admin");
admin.initializeApp();
const db=admin.firestore();
const COLLECTIONS=["encounters","orders","results","clinicalNotes","noteAddenda","observations","medicationAdministrations","handoffs","tasks","messages","clinicalAlerts","emergencyEvents","labSpecimens","imagingStudies","admissions","emsArrivals","dischargePlans","procedures","bloodBankRequests","breakGlassEvents","auditEvents","northstarOps","billingAccounts"];
const requireUser=async request=>{if(!request.auth)throw new HttpsError("unauthenticated","Please sign in.");const uid=request.auth.uid;const snap=await db.doc("users/"+uid).get();if(!snap.exists||snap.get("status")!=="active")throw new HttpsError("permission-denied","An active staff account is required.");return {uid,role:snap.get("role"),permissions:snap.get("permissions")||{}}};
const adminUser=u=>u.role==="administrator";
const validId=x=>typeof x==="string"&&/^[a-zA-Z0-9_-]{8,150}$/.test(x);
const clean=x=>typeof x==="string"?x.trim():"";
exports.requestPatientDeletion=onCall({region:"us-central1",enforceAppCheck:false},async request=>{
 const actor=await requireUser(request);if(!adminUser(actor))throw new HttpsError("permission-denied","Only administrators can request deletion.");
 const id=request.data?.patientId,reason=clean(request.data?.reason);
 if(!validId(id)||reason.length<15||reason.length>1000)throw new HttpsError("invalid-argument","Select a valid patient and provide a detailed deletion reason.");
 const patient=await db.doc("patients/"+id).get();if(!patient.exists)throw new HttpsError("not-found","Patient not found. Use the orphan cleanup request workflow instead.");
 const previous=await db.collection("patientDeletionRequests").where("patientId","==",id).get();
 if(previous.docs.some(x=>["pending","approved","processing"].includes(x.get("status"))))throw new HttpsError("already-exists","A deletion request is already active for this patient.");
 const ref=db.collection("patientDeletionRequests").doc();await ref.create({patientId:id,patientMrn:patient.get("mrn")||"",patientName:patient.get("displayName")||[patient.get("firstName"),patient.get("lastName")].filter(Boolean).join(" "),reason,status:"pending",requestedBy:actor.uid,requestedAt:admin.firestore.FieldValue.serverTimestamp(),approvedBy:null,completedAt:null});
 return {requestId:ref.id,status:"pending"};
});
exports.approvePatientDeletion=onCall({region:"us-central1",timeoutSeconds:540,memory:"1GiB",enforceAppCheck:false},async request=>{
 const actor=await requireUser(request);if(!adminUser(actor))throw new HttpsError("permission-denied","Administrator approval required.");
 const id=request.data?.requestId;if(!validId(id))throw new HttpsError("invalid-argument","Invalid request ID.");
 const ref=db.doc("patientDeletionRequests/"+id);
 const patientId=await db.runTransaction(async tx=>{
  const snap=await tx.get(ref);if(!snap.exists)throw new HttpsError("not-found","Request not found.");
  if(snap.get("status")!=="pending")throw new HttpsError("failed-precondition","Request is not pending.");
  if(snap.get("requestedBy")===actor.uid)throw new HttpsError("permission-denied","A different administrator must approve this deletion.");
  const patientId=snap.get("patientId");
  tx.update(ref,{status:"processing",approvedBy:actor.uid,approvedAt:admin.firestore.FieldValue.serverTimestamp()});
  return patientId;
 });
 try{
  const patientRef=db.doc("patients/"+patientId);
  const encounterSnap=await db.collection("encounters").where("patientId","==",patientId).get();
  const encounterIds=encounterSnap.docs.map(d=>d.id);
  const refs=new Map();const add=s=>{for(const d of s.docs)refs.set(d.ref.path,d.ref)};
  add(encounterSnap);
  for(const name of COLLECTIONS){
    add(await db.collection(name).where("patientId","==",patientId).get());
    for(let start=0;start<encounterIds.length;start+=30){
      add(await db.collection(name).where("encounterId","in",encounterIds.slice(start,start+30)).get());
    }
  }
  // Do not remove audit entries about the deletion request itself; these contain no patient chart payload.
  for(const r of refs.values())await db.recursiveDelete(r);
  await db.recursiveDelete(patientRef);
  await ref.update({status:"completed",completedAt:admin.firestore.FieldValue.serverTimestamp(),recordCount:refs.size+1});
  await db.collection("patientDeletionAudit").add({requestId:id,requestedBy:(await ref.get()).get("requestedBy"),approvedBy:actor.uid,completedAt:admin.firestore.FieldValue.serverTimestamp(),deletedRecordCount:refs.size+1});
  return {status:"completed",deletedRecordCount:refs.size+1};
 }catch(err){await ref.update({status:"failed",failureCode:"partial-deletion-possible",failedAt:admin.firestore.FieldValue.serverTimestamp()});throw new HttpsError("internal","Deletion halted. Some records may already be deleted; contact an administrator before retrying.");}
});
async function orphanInventory(){
 const patients=await db.collection("patients").get();
 const known=new Set(patients.docs.map(x=>x.id));
 const missing=new Map();
 for(const name of COLLECTIONS){
  let cursor=null,scanned=0;
  while(true){
   let query=db.collection(name).orderBy(admin.firestore.FieldPath.documentId()).limit(400);
   if(cursor)query=query.startAfter(cursor);
   const snap=await query.get();if(snap.empty)break;
   for(const item of snap.docs){
    const patientId=item.get("patientId");
    if(typeof patientId==="string"&&patientId&&!known.has(patientId)){
     const entry=missing.get(patientId)||{patientId,recordCount:0,collections:{}};
     entry.recordCount++;entry.collections[name]=(entry.collections[name]||0)+1;
     missing.set(patientId,entry);
    }
   }
   scanned+=snap.size;cursor=snap.docs[snap.docs.length-1];
   if(snap.size<400)break;
   if(scanned>10000)throw new HttpsError("resource-exhausted","Orphan scan exceeds the safe size limit. No deletion requested.");
  }
 }
 return [...missing.values()].sort((a,b)=>b.recordCount-a.recordCount);
}
exports.scanOrphanPatientRecords=onCall({region:"us-central1",timeoutSeconds:540,memory:"1GiB"},async request=>{
 const actor=await requireUser(request);
 if(!adminUser(actor))throw new HttpsError("permission-denied","Administrator access required.");
 return {orphans:await orphanInventory()};
});
exports.requestOrphanCleanup=onCall({region:"us-central1",timeoutSeconds:540,memory:"1GiB"},async request=>{
 const actor=await requireUser(request);if(!adminUser(actor))throw new HttpsError("permission-denied","Administrator access required.");
 const patientId=request.data?.patientId,reason=clean(request.data?.reason);
 if(!validId(patientId)||reason.length<15||reason.length>1000)throw new HttpsError("invalid-argument","Choose an orphan patient ID and explain why it should be deleted.");
 if((await db.doc("patients/"+patientId).get()).exists)throw new HttpsError("failed-precondition","Patient exists: use standard deletion approval.");
 const found=(await orphanInventory()).find(x=>x.patientId===patientId);
 if(!found)throw new HttpsError("not-found","No orphan records found for that patient ID.");
 const existing=await db.collection("patientDeletionRequests").where("patientId","==",patientId).get();
 if(existing.docs.some(x=>["pending","processing"].includes(x.get("status"))))throw new HttpsError("already-exists","An approval request is already active.");
 const ref=db.collection("patientDeletionRequests").doc();
 await ref.create({patientId,patientMrn:"MISSING RECORD",patientName:"Orphaned records",orphan:true,recordSummary:found.collections,recordCount:found.recordCount,reason,status:"pending",requestedBy:actor.uid,requestedAt:admin.firestore.FieldValue.serverTimestamp(),approvedBy:null,completedAt:null});
 return {requestId:ref.id,status:"pending",recordCount:found.recordCount};
});

exports.northstarHealth=onCall({region:"us-central1",timeoutSeconds:20},async request=>{
 const actor=await requireUser(request);
 return {service:"northstar-backend",status:"ready",version:"2026-10-22-audit",role:actor.role};
});
