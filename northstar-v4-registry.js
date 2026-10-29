// Northstar 4.0 department registry and pure workflow helpers.
export const DEPARTMENTS=[
 {key:"surgery4",title:"Surgical & Perioperative",icon:"✚",collection:"nmcSurgicalCases",roles:["administrator","physician","nurse"],data:["nmcSurgicalCases","nmcSterileRequests","nmcTransportRequests","rooms","procedures"],intro:"Surgical case scheduling, operating rooms, PACU and linked preparation tasks.",statuses:["scheduled","preparing","in-progress","recovery","completed","cancelled"]},
 {key:"infection4",title:"Infection Prevention",icon:"◈",collection:"nmcInfectionReviews",roles:["administrator","physician","nurse"],data:["nmcInfectionReviews","orders","results","rooms"],intro:"Isolation reviews, precaution tracking and infection-prevention follow-up.",statuses:["open","precautions","review","resolved","closed"]},
 {key:"sterile4",title:"Sterile Processing",icon:"▦",collection:"nmcSterileTrays",roles:["administrator","technician","nurse"],data:["nmcSterileTrays","nmcSterileRequests"],intro:"Instrument trays, sterilization work queues and surgical readiness.",statuses:["available","in-use","decontamination","sterilizing","inspection","quarantined"]},
 {key:"transport4",title:"Transport & Dispatch",icon:"⇄",collection:"nmcTransportRequests",roles:["administrator","nurse","technician","registration"],data:["nmcTransportRequests","admissions","rooms"],intro:"Patient transport requests, dispatch assignments and handoff status.",statuses:["requested","assigned","en-route","arrived","completed","cancelled"]},
 {key:"pharmacy4",title:"Pharmacy & Dispensing",icon:"▤",collection:"nmcPharmacyDispenses",roles:["administrator","pharmacist","physician","nurse"],data:["nmcPharmacyDispenses","nmcPharmacyStock","orders","medicationAdministrations"],intro:"Medication dispensing requests, verification, stock and reconciliation.",statuses:["requested","verified","dispensed","returned","cancelled"]}
];
export const DEPARTMENT_DATA=Object.fromEntries(DEPARTMENTS.map(x=>[x.key,x.data]));
export const DEPARTMENT_BY_KEY=Object.fromEntries(DEPARTMENTS.map(x=>[x.key,x]));
export const DEPARTMENT_BY_COLLECTION=Object.fromEntries(DEPARTMENTS.map(x=>[x.collection,x]));
export const ROLE_LABELS={administrator:"Administrator",physician:"Provider",nurse:"Nursing",technician:"Technician",registration:"Registration",pharmacist:"Pharmacy"};
export function mayAccessDepartment(role,key,permissions={}){
 const department=DEPARTMENT_BY_KEY[key];
 return !!department&&(role==="administrator"||department.roles.includes(role));
}
const NEW_RECORD_ROLES={surgery4:["administrator","physician"],infection4:["administrator","physician","nurse"],sterile4:["administrator","technician"],transport4:["administrator","nurse","technician","registration"],pharmacy4:["administrator","pharmacist","physician"]};
const STATUS_ROLES={surgery4:["administrator","physician","nurse"],infection4:["administrator","physician","nurse"],sterile4:["administrator","technician"],transport4:["administrator","nurse","technician","registration"],pharmacy4:["administrator","pharmacist"]};
export const mayCreateDepartment=(role,key)=>!!NEW_RECORD_ROLES[key]?.includes(role);
export const mayUpdateDepartment=(role,key)=>!!STATUS_ROLES[key]?.includes(role);
export const normalizeLabel=v=>String(v??"").trim().replace(/\s+/g," ");
export function summarizeDepartment(key,records=[]){
 const model=DEPARTMENT_BY_KEY[key];if(!model)return {total:0,open:0,complete:0,alerts:0};
 const closed=new Set(["completed","cancelled","closed","resolved","available","returned","dispensed"]);
 const done=records.filter(x=>closed.has(x.status)).length;
 return {total:records.length,open:records.length-done,complete:done,alerts:records.filter(x=>["quarantined","high","critical","precautions"].includes(x.status)||x.priority==="critical").length};
}
export function validateDepartmentRecord(key,input,context={}){
 const department=DEPARTMENT_BY_KEY[key];if(!department)throw Error("Unknown Northstar department.");
 const result={};
 for(const [field,value] of Object.entries(input||{}))result[field]=normalizeLabel(value);
 const requiredFields={
  surgery4:["patientId","encounterId","procedureName","room","scheduledDate","priority"],
  infection4:["patientId","encounterId","reason","precautions"],
  sterile4:["trayName","trayCode","department"],
  transport4:["patientId","encounterId","origin","destination","priority"],
  pharmacy4:["patientId","encounterId","orderId","medicationName","quantity"]
 };
 for(const name of requiredFields[key])if(!result[name])throw Error("Please provide "+name.replace(/[A-Z]/g,c=>" "+c.toLowerCase())+".");
 for(const [field,value] of Object.entries(result))if(typeof value!=="string"||value.length>240)throw Error("Invalid "+field+" value.");
 if(result.patientId){
  const patient=context.patients?.find(x=>x.id===result.patientId);
  const encounter=context.encounters?.find(x=>x.id===result.encounterId);
  if(!patient||!encounter||encounter.patientId!==patient.id)throw Error("Choose an encounter belonging to the selected patient.");
 }
 if(key==="pharmacy4"){
  const order=context.orders?.find(x=>x.id===result.orderId);
  if(!order||order.patientId!==result.patientId||order.encounterId!==result.encounterId||order.category!=="medication")throw Error("Select an existing medication order for this patient's encounter.");
  if(normalizeLabel(order.name).toLowerCase()!==result.medicationName.toLowerCase())throw Error("Medication must match the selected order.");
  const qty=Number(result.quantity);
  if(!Number.isSafeInteger(qty)||qty<1||qty>10000)throw Error("Dispensing quantity must be 1–10,000.");
  result.quantity=String(qty);
 }
 if(key==="surgery4"&&!/^\d{4}-\d\d-\d\d$/.test(result.scheduledDate))throw Error("Enter a valid scheduled date.");
 if(key==="surgery4"&&!["routine","urgent","emergency"].includes(result.priority))throw Error("Invalid surgical priority.");
 if(key==="transport4"&&!["routine","urgent","stat"].includes(result.priority))throw Error("Invalid transport priority.");
 return result;
}
export function departmentVisibility(key,records,term=""){
 const q=normalizeLabel(term).toLowerCase();
 return (records||[]).filter(record=>!q||[record.title,record.name,record.procedureName,record.medicationName,record.reason,record.status,record.room,record.destination,record.trayName,record.patientName].some(x=>String(x||"").toLowerCase().includes(q)));
}
