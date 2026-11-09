// Read-only Northstar diagnostics. These run with the existing signed-in user's
// Firestore permissions and do not require Cloud Functions or CORS configuration.
import {collection,getDocs,limit,query} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {integrityReview} from "./northstar-v3-core.js";

const MAX_RECORDS=500;
const CLINICAL_COLLECTIONS=[
  "patients","encounters","orders","results","procedures",
  "medicationAdministrations","admissions","billingAccounts","tasks","emsArrivals"
];
async function readBounded(db,name){
  try{
    // Fetch one extra document so exactly 500 records is not mislabeled partial.
    const snap=await getDocs(query(collection(db,name),limit(MAX_RECORDS+1)));
    return {
      records:snap.docs.slice(0,MAX_RECORDS).map(record=>({id:record.id,...record.data()})),
      incomplete:snap.size>MAX_RECORDS
    };
  }catch(error){
    const hint=error?.code==="permission-denied"
      ?"Your current role lacks permission to read this collection."
      :error?.message||"Unknown Firestore error.";
    throw new Error("Cannot scan "+name+": "+hint);
  }
}
export async function scanNorthstarIntegrity(db){
  const loaded=await Promise.all(CLINICAL_COLLECTIONS.map(name=>readBounded(db,name)));
  const data=Object.fromEntries(CLINICAL_COLLECTIONS.map((name,i)=>[name,loaded[i].records]));
  const checked=Object.fromEntries(CLINICAL_COLLECTIONS.map((name,i)=>[name,data[name].length]));
  const incomplete=CLINICAL_COLLECTIONS.filter((_,i)=>loaded[i].incomplete);
  // When parent collections are truncated, absence from a 500-row sample
  // must not be reported as a confirmed missing patient or encounter.
  const uncertainPatients=incomplete.includes("patients");
  const uncertainEncounters=incomplete.includes("encounters");
  const findings=integrityReview(data).filter(issue=>!(
    (uncertainPatients&&issue.reason==="Missing patient")||
    (uncertainEncounters&&issue.reason==="Missing encounter")
  ));
  const issues=findings.slice(0,250).map(issue=>({
    collection:issue.collection,id:issue.id,reason:issue.reason
  }));
  return {
    version:"northstar-3.0-firestore",readOnly:true,
    checked,incomplete,issues,issueLimitReached:findings.length>250,
    note:incomplete.length
      ?"Partial read-only diagnostic. Collections were capped at 500 records. Missing-reference findings that require truncated parent collections were suppressed."
      :"Read-only Firestore diagnostic; no records were changed or deleted."
  };
}
export async function scanNorthstarBillingAudit(db){
  const {records,incomplete}=await readBounded(db,"billingAccounts");
  const issues=[];
  const add=(id,reason,differenceCents)=>{if(issues.length<200)issues.push({
    collection:"billingAccounts",id,reason,differenceCents
  });};
  for(const invoice of records){
    const sum=(Array.isArray(invoice.lineItems)?invoice.lineItems:[])
      .reduce((total,line)=>total+(Number(line.amountCents)||0),0);
    const charged=Number(invoice.chargeCents)||0;
    if(sum!==charged)add(invoice.id,"Line-item total mismatch",sum-charged);
    const expectedPatient=charged-(Number(invoice.waivedCents)||0)
      -(Number(invoice.insuranceEstimatedCents)||0)-(Number(invoice.patientPaidCents)||0);
    if(expectedPatient!==(Number(invoice.patientBalanceCents)||0))
      add(invoice.id,"Patient allocation mismatch",expectedPatient-(Number(invoice.patientBalanceCents)||0));
    const expectedInsurer=(Number(invoice.insuranceEstimatedCents)||0)-(Number(invoice.insuranceReceivedCents)||0);
    if(expectedInsurer!==(Number(invoice.insurerBalanceCents)||0))
      add(invoice.id,"Insurance allocation mismatch",expectedInsurer-(Number(invoice.insurerBalanceCents)||0));
  }
  return {
    version:"northstar-3.0-firestore",readOnly:true,
    checked:{billingAccounts:records.length},
    incomplete:incomplete?["billingAccounts"]:[],
    issues,issueLimitReached:issues.length>=200,
    note:"Read-only Firestore financial diagnostic. No invoice amounts were changed."
  };
}
