const fs=require("fs");
const {initializeTestEnvironment,assertFails,assertSucceeds}=require("@firebase/rules-unit-testing");
const {doc,getDoc,setDoc,deleteDoc,serverTimestamp}=require("firebase/firestore");
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
  });
  const admin=environment.authenticatedContext("adminstaff").firestore();
  const siu=environment.authenticatedContext("siumember").firestore();
  await assertSucceeds(getDoc(doc(admin,"patients","testpatient")));
  await assertFails(deleteDoc(doc(admin,"patients","testpatient")));
  await assertFails(deleteDoc(doc(siu,"patients","testpatient")));
  await assertFails(setDoc(doc(admin,"patientDeletionRequests","usercreated"),{patientId:"testpatient",status:"approved"}));
  await assertFails(getDoc(doc(siu,"patientDeletionRequests","requestone")));
  await assertFails(setDoc(doc(siu,"northstarOps","opsone"),{
   module:"credentials",title:"Credential Review",department:"Staffing",priority:"high",
   summary:"Check renewal documentation.",dueDate:"",status:"open",createdBy:"siumember",updatedBy:"siumember",
   createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  }));
  console.log("Firestore safety regression tests passed.");
 } finally {await environment.cleanup();}
})().catch(err=>{console.error(err);process.exitCode=1});
