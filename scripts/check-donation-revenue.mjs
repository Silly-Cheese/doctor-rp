import fs from "node:fs";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
const read=p=>fs.readFileSync(p,"utf8");
const insights=read("northstar-billing-insights.js");
const {summarizeBilling}=await import("data:text/javascript;base64,"+Buffer.from(insights).toString("base64"));
const bills=[{encounterId:"e1",chargeCents:50000,patientPaidCents:18000,insuranceReceivedCents:11000,patientBalanceCents:21000,insurerBalanceCents:0,waivedCents:0}];
const donations=[
 {id:"d1",amountCents:7500,status:"received"},
 {id:"d2",amountCents:12000,status:"pledged"},
 {id:"d3",amountCents:4500,status:"reversed"},
 {id:"d4",amountCents:8000,status:"cancelled"}
];
const summary=summarizeBilling(bills,[],new Date("2026-10-30T12:00:00Z"),donations);
assert.equal(summary.clinicalCollected,29000);
assert.equal(summary.donationCollected,7500);
assert.equal(summary.donationPledged,12000);
assert.equal(summary.collected,36500);
assert.equal(summary.totalCharges,50000,"Donation must not change medical charges");
assert.equal(summary.patientBalance,21000,"Donation must not pay a medical bill");
assert.equal(summarizeBilling(bills,[]).collected,29000,"Existing callers remain compatible");
const app=read("northstar-billing.js");
const ui=read("northstar-donations.js");
const rules=read("firestore.rules");
const html=read("index.html");
assert.match(app,/mountNorthstarDonations\(\{target,records,encounters,patients,profile\}\)/);
assert.match(app,/id="nmcBillingCollected"/);
assert.match(app,/id="nmcBillingDonationsCollected"/);
assert.match(app,/id="nmcDonationWorkspace"/);
assert.match(ui,/status==="received"/,"Only received status should be included in the collected sum");
assert.match(ui,/runTransaction\(db,async tx/,"Donation status changes must be transactional");
assert.match(ui,/printAcknowledgment/);
assert.match(rules,/match \/nmcDonations\/\{donationId\}/);
assert.match(rules,/resource\.data\.status == 'received'/);
assert.match(rules,/allow delete: if false;/);
assert.match(html,/northstar-donations\.css/);
for(const file of ["northstar-billing.js","northstar-donations.js","northstar-billing-insights.js"]){
 const test=spawnSync(process.execPath,["--input-type=module","--check"],{input:read(file),encoding:"utf8"});
 assert.equal(test.status,0,file+" syntax error: "+test.stderr);
}
console.log("Northstar donation integration checks passed.");
