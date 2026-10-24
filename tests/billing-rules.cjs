const fs=require("fs");
const {initializeTestEnvironment,assertFails,assertSucceeds}=require("@firebase/rules-unit-testing");
const {doc,getDoc,setDoc,updateDoc,deleteDoc,serverTimestamp}=require("firebase/firestore");
(async()=>{
 const env=await initializeTestEnvironment({
  projectId:"demo-northstar-billing",
  firestore:{host:"127.0.0.1",port:8080,rules:fs.readFileSync("firestore.rules","utf8")}
 });
 try{
  await env.withSecurityRulesDisabled(async ctx=>{
   const db=ctx.firestore();
   await setDoc(doc(db,"users","billingadmin"),{uid:"billingadmin",role:"administrator",status:"active",permissions:{}});
   await setDoc(doc(db,"users","billingdoctor"),{uid:"billingdoctor",role:"physician",status:"active",permissions:{providerActions:true}});
   await setDoc(doc(db,"users","billingstaff"),{uid:"billingstaff",role:"staff",status:"active",permissions:{}});
   await setDoc(doc(db,"users","billingclerk"),{uid:"billingclerk",role:"registration",status:"active",permissions:{billingManage:true,billingAccess:true}});
   await setDoc(doc(db,"patients","billingpatient"),{firstName:"Sample",lastName:"Patient",vitalStatus:"active"});
   await setDoc(doc(db,"encounters","billingencounter"),{patientId:"billingpatient",patientName:"Sample Patient",status:"discharged"});
  });
  const doctor=env.authenticatedContext("billingdoctor").firestore();
  const admin=env.authenticatedContext("billingadmin").firestore();
  const staff=env.authenticatedContext("billingstaff").firestore();
  const clerk=env.authenticatedContext("billingclerk").firestore();
  const account={
   encounterId:"billingencounter",patientId:"billingpatient",patientName:"Sample Patient",
   invoiceNumber:"NMC-BILLING",
   lineItems:[{description:"Encounter services",quantity:1,unitPriceCents:10000,amountCents:10000}],
   chargeCents:10000,insuranceEstimatedCents:5000,insuranceReceivedCents:0,
   waivedCents:2000,patientPaidCents:0,patientResponsibilityCents:3000,
   patientBalanceCents:3000,insurerBalanceCents:5000,
   insuranceProvider:"Sample Insurance",claimStatus:"not-submitted",
   waiverReason:"Approved hardship",notes:"Simulation",billingMode:"split",status:"insurance-pending",
   createdBy:"billingdoctor",updatedBy:"billingdoctor",
   createdAt:serverTimestamp(),updatedAt:serverTimestamp(),source:"discharge",simulated:true
  };
  await assertSucceeds(setDoc(doc(doctor,"billingAccounts","billingencounter"),account));
  await assertSucceeds(getDoc(doc(clerk,"billingAccounts","billingencounter")));
  await assertFails(getDoc(doc(staff,"billingAccounts","billingencounter")));
  await assertFails(deleteDoc(doc(admin,"billingAccounts","billingencounter")));
  await assertFails(updateDoc(doc(doctor,"billingAccounts","billingencounter"),{waivedCents:10000,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(clerk,"billingAccounts","billingencounter"),{chargeCents:1000,updatedBy:"billingclerk",updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(doc(clerk,"billingAccounts","billingencounter"),{
   patientPaidCents:1000,patientBalanceCents:2000,updatedBy:"billingclerk",updatedAt:serverTimestamp()
  }));
  await assertSucceeds(setDoc(doc(clerk,"billingAccounts","billingencounter","events","paymentone"),{
   action:"patient-payment",amountCents:1000,detail:"Cash (simulated)",reason:"Payment recorded",actorUid:"billingclerk",createdAt:serverTimestamp(),simulated:true
  }));
  await assertFails(deleteDoc(doc(clerk,"billingAccounts","billingencounter","events","paymentone")));
  console.log("Billing simulation security rules passed.");
 } finally {await env.cleanup();}
})().catch(err=>{console.error(err);process.exitCode=1});
