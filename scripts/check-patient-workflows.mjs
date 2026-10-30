import fs from "node:fs";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
const read=file=>fs.readFileSync(file,"utf8");
const html=read("index.html"),app=read("app.js"),rules=read("firestore.rules"),storage=read("storage.rules");
const ids=["patientsSection","patientResults","nmcReceptionToggle","nmcReceptionDesk","nmcReceptionSearchForm","nmcReceptionSearchMode","nmcReceptionDob","nmcReceptionName","nmcIdentityMethod","nmcVerifyConfirmed","nmcVisitCategory","nmcReceptionNote","nmcContactReviewed","nmcInterpreterRequested","nmcIntegrityPanel","nmcRunIntegrity"];
for(const id of ids){
 const count=(html.match(new RegExp('id="'+id+'"',"g"))||[]).length;
 assert.equal(count,1,"Expected exactly one original-page element: "+id);
}
assert.match(app,/runTransaction\(db,async transaction/,"Check-in must be transaction-safe");
assert.match(app,/verifiedCheckInIdentity\(patient\)/,"Check-in must verify identity");
assert.match(app,/currentCheckInNameSearch/,"Name searches must originate in Reception");
for(const module of ["northstar-medical-records.js","northstar-record-quality.js","northstar-attachments.js"]){
 assert.ok(fs.existsSync(module),"Missing patient module "+module);
 assert.ok(app.includes('"./'+module+'"'),"Module not wired into app.js: "+module);
}
assert.ok(rules.includes("match /patients/{patientId}/attachments/{attachmentId}"),"Attachment metadata rules missing");
assert.ok(rules.includes("match /patientMrns/{mrn}"),"MRN reservation rules missing");
assert.ok(storage.includes("match /rp-patient-documents/{patientId}/{documentId}/file"),"Private Storage rules missing");
assert.equal(JSON.parse(read("firebase.json")).storage.rules,"storage.rules");
for(const file of ["app.js","northstar-medical-records.js","northstar-record-quality.js","northstar-attachments.js"]){
 const result=spawnSync(process.execPath,["--input-type=module","--check"],{input:read(file),encoding:"utf8"});
 assert.equal(result.status,0,file+" syntax error:\n"+result.stderr);
}
console.log("Northstar patient workflow smoke checks passed.");
