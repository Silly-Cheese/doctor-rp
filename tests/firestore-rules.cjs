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
  // Northstar 3.0 operations require an administrator and immutable creator metadata.
  const now=()=>serverTimestamp();
  const base=(status)=>({status,createdBy:"adminstaff",updatedBy:"adminstaff",createdAt:now(),updatedAt:now()});
  const quality={...base("open"),title:"Quality Improvement",category:"operations",priority:"high",summary:"Review delayed handoffs.",dueDate:"2026-11-02"};
  await assertSucceeds(setDoc(doc(admin,"nmcQualityActions","v3quality"),quality));
  await assertFails(setDoc(doc(siu,"nmcQualityActions","unapproved"),{...quality,createdBy:"siumember",updatedBy:"siumember"}));
  await assertFails(getDoc(doc(siu,"nmcQualityActions","v3quality")));
  await assertSucceeds(updateDoc(doc(admin,"nmcQualityActions","v3quality"),{status:"completed",updatedBy:"adminstaff",updatedAt:now()}));
  await assertFails(updateDoc(doc(siu,"nmcQualityActions","v3quality"),{status:"open",updatedBy:"siumember",updatedAt:now()}));
  await assertFails(deleteDoc(doc(admin,"nmcQualityActions","v3quality")));
  await assertSucceeds(setDoc(doc(admin,"nmcEquipment","v3equipment"),{
    ...base("available"),name:"Portable Monitor",assetCode:"MON-01",department:"Emergency",nextServiceDate:"2026-11-04"
  }));
  await assertSucceeds(updateDoc(doc(admin,"nmcEquipment","v3equipment"),{status:"maintenance",updatedBy:"adminstaff",updatedAt:now()}));
  await assertFails(setDoc(doc(siu,"nmcEquipment","staffequipment"),{
    ...base("available"),name:"Personal Monitor",assetCode:"X-1",department:"Emergency",createdBy:"siumember",updatedBy:"siumember"
  }));
  await assertSucceeds(setDoc(doc(admin,"nmcShiftAssignments","v3shift"),{
    ...base("scheduled"),staffUid:"siumember",department:"Emergency",shiftDate:"2026-11-04",startTime:"08:00",endTime:"16:00"
  }));
  await assertFails(setDoc(doc(admin,"nmcShiftAssignments","badshift"),{
    ...base("scheduled"),staffUid:"siumember",department:"Emergency",shiftDate:"2026-11-04",startTime:"18:00",endTime:"08:00"
  }));
  await assertSucceeds(setDoc(doc(admin,"nmcTrainingRecords","v3training"),{
    ...base("assigned"),staffUid:"siumember",module:"emergency",title:"Simulation training",dueDate:"2026-11-15"
  }));
  await assertFails(getDoc(doc(siu,"nmcTrainingRecords","v3training")));
  // Northstar 4.0: audited department records, strict roles and linked encounters.
  const departmentAudit=(collection,recordId,action,to,from="")=>({collection,recordId,action,from,to,actorUid:"adminstaff",createdAt:serverTimestamp()});
  const surgery=writeBatch(admin);
  surgery.set(doc(admin,"nmcSurgicalCases","v4surgery"),{
    patientId:"deceaseddoe",encounterId:"priorvisit",patientName:"Jane Doe",procedureName:"Emergency Surgical Repair",
    room:"OR-01",scheduledDate:"2026-11-05",priority:"emergency",assignedUid:"",status:"scheduled",
    createdBy:"adminstaff",updatedBy:"adminstaff",createdAt:serverTimestamp(),updatedAt:serverTimestamp(),auditEventId:"v4audit-surgery"
  });
  surgery.set(doc(admin,"nmcDepartmentAudit","v4audit-surgery"),departmentAudit("nmcSurgicalCases","v4surgery","created","scheduled"));
  await assertSucceeds(surgery.commit());
  await assertFails(getDoc(doc(siu,"nmcSurgicalCases","v4surgery")));
  await assertFails(updateDoc(doc(admin,"nmcSurgicalCases","v4surgery"),{status:"completed",updatedAt:serverTimestamp(),updatedBy:"adminstaff"}));
  const surgeryUpdate=writeBatch(admin);
  surgeryUpdate.update(doc(admin,"nmcSurgicalCases","v4surgery"),{
    status:"preparing",updatedBy:"adminstaff",updatedAt:serverTimestamp(),auditEventId:"v4audit-surgery-updated"
  });
  surgeryUpdate.set(doc(admin,"nmcDepartmentAudit","v4audit-surgery-updated"),departmentAudit("nmcSurgicalCases","v4surgery","status","preparing","scheduled"));
  await assertSucceeds(surgeryUpdate.commit());
  await assertFails(deleteDoc(doc(admin,"nmcSurgicalCases","v4surgery")));
  await assertFails(deleteDoc(doc(admin,"nmcDepartmentAudit","v4audit-surgery")));
  const infection=writeBatch(admin);
  infection.set(doc(admin,"nmcInfectionReviews","v4isolation"),{
    patientId:"deceaseddoe",encounterId:"priorvisit",patientName:"Jane Doe",
    reason:"Contact isolation review",precautions:"contact",summary:"Precaution assessment",status:"open",
    createdBy:"adminstaff",updatedBy:"adminstaff",createdAt:serverTimestamp(),updatedAt:serverTimestamp(),auditEventId:"v4audit-infection"
  });
  infection.set(doc(admin,"nmcDepartmentAudit","v4audit-infection"),departmentAudit("nmcInfectionReviews","v4isolation","created","open"));
  await assertSucceeds(infection.commit());
  const tray=writeBatch(admin);
  tray.set(doc(admin,"nmcSterileTrays","v4tray"),{
    trayName:"Surgical Instrument Set",trayCode:"TRAY-01",department:"Operating Rooms",status:"available",
    createdBy:"adminstaff",updatedBy:"adminstaff",createdAt:serverTimestamp(),updatedAt:serverTimestamp(),auditEventId:"v4audit-tray"
  });
  tray.set(doc(admin,"nmcDepartmentAudit","v4audit-tray"),departmentAudit("nmcSterileTrays","v4tray","created","available"));
  await assertSucceeds(tray.commit());
  await environment.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),"nmcSterileRequests","surgery_v4surgery"),{
      surgeryId:"v4surgery",patientId:"deceaseddoe",encounterId:"priorvisit",procedureName:"Emergency Surgical Repair",
      status:"requested",createdBy:"system:northstarV4PrepareSurgery"
    });
  });
  const ready=writeBatch(admin);
  ready.update(doc(admin,"nmcSterileRequests","surgery_v4surgery"),{
    status:"ready",updatedBy:"adminstaff",updatedAt:serverTimestamp(),auditEventId:"v4audit-ready"
  });
  ready.set(doc(admin,"nmcDepartmentAudit","v4audit-ready"),departmentAudit("nmcSterileRequests","surgery_v4surgery","status","ready","requested"));
  await assertSucceeds(ready.commit());
  const transport=writeBatch(admin);
  transport.set(doc(admin,"nmcTransportRequests","v4transport"),{
    patientId:"deceaseddoe",encounterId:"priorvisit",patientName:"Jane Doe",
    origin:"ER",destination:"OR-01",priority:"urgent",assignedUid:"",status:"requested",
    createdBy:"adminstaff",updatedBy:"adminstaff",createdAt:serverTimestamp(),updatedAt:serverTimestamp(),auditEventId:"v4audit-transport"
  });
  transport.set(doc(admin,"nmcDepartmentAudit","v4audit-transport"),departmentAudit("nmcTransportRequests","v4transport","created","requested"));
  await assertSucceeds(transport.commit());
  const pharmacyStock=writeBatch(admin);
  pharmacyStock.set(doc(admin,"nmcPharmacyStock","v4stock"),{
    itemName:"Simulation Medication",sku:"RX-TEST",quantity:12,location:"Main Pharmacy",status:"available",
    createdBy:"adminstaff",updatedBy:"adminstaff",createdAt:serverTimestamp(),updatedAt:serverTimestamp(),auditEventId:"v4audit-stock"
  });
  pharmacyStock.set(doc(admin,"nmcDepartmentAudit","v4audit-stock"),departmentAudit("nmcPharmacyStock","v4stock","created","available"));
  await assertSucceeds(pharmacyStock.commit());
  const adjusted=writeBatch(admin);
  adjusted.update(doc(admin,"nmcPharmacyStock","v4stock"),{quantity:9,updatedAt:serverTimestamp(),
    updatedBy:"adminstaff",auditEventId:"v4audit-adjust"});
  adjusted.set(doc(admin,"nmcDepartmentAudit","v4audit-adjust"),{
    ...departmentAudit("nmcPharmacyStock","v4stock","stock-adjustment","9","12"),reason:"Stocktake adjustment"
  });
  await assertSucceeds(adjusted.commit());
  await assertFails(updateDoc(doc(admin,"nmcPharmacyStock","v4stock"),{quantity:200}));
  await assertFails(getDoc(doc(siu,"nmcPharmacyStock","v4stock")));
  console.log("Firestore safety regression tests passed.");
 } finally {await environment.cleanup();}
})().catch(err=>{console.error(err);process.exitCode=1});
