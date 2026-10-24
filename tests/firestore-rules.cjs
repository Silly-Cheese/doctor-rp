const fs=require("fs");
const {initializeTestEnvironment,assertFails,assertSucceeds}=require("@firebase/rules-unit-testing");
const {doc,getDoc,setDoc,updateDoc,deleteDoc,writeBatch,serverTimestamp}=require("firebase/firestore");
(async()=>{
 const environment=await initializeTestEnvironment({
  projectId:"demo-northstar",
  firestore:{host:"127.0.0.1",port:8080,rules:fs.readFileSync("firestore.rules","utf8")}
 });
 try{
  await environment.withSecurityRulesDisabled(async ctx=>{
   const firestore=ctx.firestore();
   await setDoc(doc(firestore,"users","adminstaff"),{uid:"adminstaff",role:"administrator",status:"active",permissions:{}});
   await setDoc(doc(firestore,"users","siumember"),{uid:"siumember",role:"staff",status:"active",permissions:{siuInvestigations:true}});
   await setDoc(doc(firestore,"patients","testpatient"),{firstName:"Example",lastName:"Patient",displayName:"Example Patient",mrn:"NMC-TEST",vitalStatus:"active",currentStatus:"not-checked-in"});
   await setDoc(doc(firestore,"users","registrar"),{uid:"registrar",role:"registration",status:"active",permissions:{manageRegistration:true}});
   await setDoc(doc(firestore,"patients","deceaseddoe"),{firstName:"Jane",lastName:"Doe",displayName:"Jane Doe",identityStatus:"unidentified",vitalStatus:"deceased",recordConfidential:true,deceasedAccessUids:[]});
   await setDoc(doc(firestore,"encounters","priorvisit"),{patientId:"deceaseddoe",patientName:"Jane Doe",status:"discharged",recordConfidential:true});
  });
  const admin=environment.authenticatedContext("adminstaff").firestore();
  const siu=environment.authenticatedContext("siumember").firestore();
  const registrar=environment.authenticatedContext("registrar").firestore();
  await assertSucceeds(getDoc(doc(admin,"patients","testpatient")));
  await assertFails(deleteDoc(doc(admin,"patients","testpatient")));
  await assertFails(deleteDoc(doc(siu,"patients","testpatient")));
  await assertFails(setDoc(doc(siu,"northstarOps","opsone"),{
   module:"credentials",title:"Credential Review",department:"Staffing",priority:"high",
   summary:"Check renewal documentation.",dueDate:"",status:"open",createdBy:"siumember",updatedBy:"siumember",
   createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  }));
  const identityBatch=writeBatch(registrar);
  identityBatch.update(doc(registrar,"patients","deceaseddoe"),{
    firstName:"Jane",lastName:"Identified",displayName:"Jane Identified",
    identityStatus:"verified",identityResolvedAt:serverTimestamp(),identityResolvedBy:"registrar",
    identityResolutionReason:"Verified identity using documented records",updatedAt:serverTimestamp()
  });
  identityBatch.update(doc(registrar,"encounters","priorvisit"),{patientName:"Jane Identified",updatedAt:serverTimestamp()});
  await assertSucceeds(identityBatch.commit());
  await assertFails(updateDoc(doc(registrar,"encounters","priorvisit"),{patientName:"Wrong name",updatedAt:serverTimestamp()}));
  console.log("Firestore safety regression tests passed.");
 } finally {await environment.cleanup();}
})().catch(err=>{console.error(err);process.exitCode=1});
