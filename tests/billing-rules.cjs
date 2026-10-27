const fs=require("fs");
const {initializeTestEnvironment,assertFails,assertSucceeds}=require("@firebase/rules-unit-testing");
const {doc,getDoc,setDoc,updateDoc,deleteDoc,writeBatch,serverTimestamp}=require("firebase/firestore");
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
  const rate={name:"Emergency Visit",kind:"visit",code:"ER-01",priceCents:15000,active:true,version:1,createdBy:"billingadmin",updatedBy:"billingadmin",createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  await assertSucceeds(setDoc(doc(admin,"serviceCatalog","visit_emergency-visit"),rate));
  await assertFails(setDoc(doc(staff,"serviceCatalog","order_x-ray"),{...rate,name:"X-Ray",kind:"order",createdBy:"billingstaff",updatedBy:"billingstaff"}));
  await assertSucceeds(updateDoc(doc(admin,"serviceCatalog","visit_emergency-visit"),{priceCents:18000,version:2,updatedBy:"billingadmin",updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(clerk,"serviceCatalog","visit_emergency-visit"),{priceCents:-25,version:3,updatedBy:"billingclerk",updatedAt:serverTimestamp()}));
  await assertFails(deleteDoc(doc(clerk,"serviceCatalog","visit_emergency-visit")));
  await assertFails(deleteDoc(doc(staff,"serviceCatalog","visit_emergency-visit")));
  await assertSucceeds(setDoc(doc(admin,"serviceCatalog","visit_emergency-visit","revisions","revone"),{
    action:"price-updated",priceCents:18000,previousPriceCents:15000,name:"Emergency Visit",
    actorUid:"billingadmin",at:serverTimestamp(),reason:"Annual price update"
  }));
  await assertFails(deleteDoc(doc(clerk,"serviceCatalog","visit_emergency-visit","revisions","revone")));
  const removal=writeBatch(admin);
  removal.set(doc(admin,"serviceCatalogDeletions","auditone"),{
    serviceId:"visit_emergency-visit",name:"Emergency Visit",kind:"visit",code:"ER-01",
    priceCents:18000,version:2,revisionCount:1,reason:"Duplicate rate",
    actorUid:"billingadmin",at:serverTimestamp()
  });
  removal.delete(doc(admin,"serviceCatalog","visit_emergency-visit","revisions","revone"));
  removal.delete(doc(admin,"serviceCatalog","visit_emergency-visit"));
  await assertSucceeds(removal.commit());
  const afterDelete=await getDoc(doc(admin,"serviceCatalog","visit_emergency-visit"));
  if(afterDelete.exists())throw Error("Deleted service is still present");
  await assertSucceeds(getDoc(doc(admin,"serviceCatalogDeletions","auditone")));
  await assertFails(getDoc(doc(clerk,"serviceCatalogDeletions","auditone")));
  await assertFails(deleteDoc(doc(admin,"serviceCatalogDeletions","auditone")));
  await assertSucceeds(getDoc(doc(admin,"billingAccounts","billingencounter")));
  await assertFails(deleteDoc(doc(admin,"billingAccounts","billingencounter")));
  // Several service prices can be created together, each with a price history.
  const bulk=writeBatch(clerk);
  for(const [id,name,price] of [
    ["order_amoxicillin","Amoxicillin",4200],
    ["order_ceftriaxone","Ceftriaxone",6500],
    ["order_vancomycin","Vancomycin",9700]
  ]){
    bulk.set(doc(clerk,"serviceCatalog",id),{name,kind:"order",code:"",priceCents:price,active:true,
      version:1,createdBy:"billingclerk",createdAt:serverTimestamp(),updatedBy:"billingclerk",updatedAt:serverTimestamp()});
    bulk.set(doc(clerk,"serviceCatalog",id,"revisions","first"),{
      action:"created",priceCents:price,name,actorUid:"billingclerk",at:serverTimestamp()
    });
  }
  await assertSucceeds(bulk.commit());
  const bulkResult=await getDoc(doc(admin,"serviceCatalog","order_ceftriaxone"));
  if(!bulkResult.exists()||bulkResult.data().priceCents!==6500)throw Error("Bulk pricing failed");
  const massUpdate=writeBatch(clerk);
  massUpdate.update(doc(clerk,"serviceCatalog","order_amoxicillin"),{
    priceCents:4800,version:2,updatedBy:"billingclerk",updatedAt:serverTimestamp()
  });
  massUpdate.set(doc(clerk,"serviceCatalog","order_amoxicillin","revisions","bulksecond"),{
    action:"price-updated",priceCents:4800,previousPriceCents:4200,name:"Amoxicillin",
    reason:"Bulk pricing change",actorUid:"billingclerk",at:serverTimestamp()
  });
  await assertSucceeds(massUpdate.commit());
  const unchanged=await getDoc(doc(admin,"serviceCatalog","order_ceftriaxone"));
  if(unchanged.data().priceCents!==6500)throw Error("Other rates should remain unchanged");
  // Administrator override requires a matching, immutable transaction audit event.
  await assertFails(updateDoc(doc(clerk,"billingAccounts","billingencounter"),{
    adjustmentAuditId:"no-audit",updatedBy:"billingclerk",updatedAt:serverTimestamp()
  }));
  const overrideBatch=writeBatch(admin);
  overrideBatch.set(doc(admin,"billingAccounts","billingencounter","events","overrideaudit"),{
    action:"charge-override",amountCents:2000,detail:"Correction to invoice total",reason:"Administrator correction",
    actorUid:"billingadmin",createdAt:serverTimestamp(),simulated:true
  });
  overrideBatch.update(doc(admin,"billingAccounts","billingencounter"),{
    chargeCents:12000,
    lineItems:[{description:"Encounter services",quantity:1,unitPriceCents:10000,amountCents:10000},
      {description:"Administrative charge correction",quantity:1,unitPriceCents:2000,amountCents:2000,sourceType:"override"}],
    patientResponsibilityCents:5000,patientBalanceCents:4000,insurerBalanceCents:5000,
    adjustmentAuditId:"overrideaudit",updatedBy:"billingadmin",updatedAt:serverTimestamp()
  });
  await assertSucceeds(overrideBatch.commit());
  await assertFails(deleteDoc(doc(admin,"billingAccounts","billingencounter","events","overrideaudit")));
  // The existing insurer estimate remains outstanding while patient responsibility is fully waived.
  const waive=writeBatch(admin);
  waive.set(doc(admin,"billingAccounts","billingencounter","events","waiveaudit"),{
    action:"bulk-waiver",amountCents:4000,detail:"Waive remaining patient balance",
    reason:"Administrative hardship waiver",actorUid:"billingadmin",
    createdAt:serverTimestamp(),simulated:true
  });
  waive.update(doc(admin,"billingAccounts","billingencounter"),{
    waivedCents:6000,waiverReason:"Administrative hardship waiver",
    patientResponsibilityCents:1000,patientBalanceCents:0,insurerBalanceCents:5000,status:"insurance-pending",
    adjustmentAuditId:"waiveaudit",updatedBy:"billingadmin",updatedAt:serverTimestamp()
  });
  await assertSucceeds(waive.commit());
  await env.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),"encounters","olderdischarge"),{
      patientId:"billingpatient",patientName:"Sample Patient",status:"discharged"
    });
  });
  const retrospective=writeBatch(admin);
  retrospective.set(doc(admin,"billingAccounts","olderdischarge"),{
    ...account,encounterId:"olderdischarge",invoiceNumber:"NMC-OLD",billingMode:"waived",
    chargeCents:10000,insuranceEstimatedCents:0,insuranceReceivedCents:0,waivedCents:10000,patientPaidCents:0,
    patientResponsibilityCents:0,patientBalanceCents:0,insurerBalanceCents:0,
    insuranceProvider:"",claimStatus:"not-applicable",status:"waived",
    waiverReason:"Administrator retrospective waiver",source:"retrospective-waiver",
    createdBy:"billingadmin",updatedBy:"billingadmin",
    createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  });
  retrospective.set(doc(admin,"billingAccounts","olderdischarge","events","retroWaiver"),{
    action:"bulk-waiver",amountCents:10000,detail:"Retrospective waived invoice",
    reason:"Administrator retrospective waiver",actorUid:"billingadmin",createdAt:serverTimestamp(),simulated:true
  });
  await assertSucceeds(retrospective.commit());
  const retroResult=await getDoc(doc(admin,"billingAccounts","olderdischarge"));
  if(!retroResult.exists()||retroResult.get("patientBalanceCents")!==0)throw Error("Waived retrospective invoice wasn't created");
  console.log("Billing simulation security rules passed.");
 } finally {await env.cleanup();}
})().catch(err=>{console.error(err);process.exitCode=1});
