/* Northstar Price Manager — curated names are simulation templates,
 * not medication recommendations or an automatically approved clinical formulary.
 * Existing encounter order names are included separately by the host UI.
 */
export const BULK_GROUPS=[
 {id:"laboratory",name:"Laboratory",kind:"order",names:["CBC with Differential","Complete Blood Count","Comprehensive Metabolic Panel","Basic Metabolic Panel","Troponin","Lactate","Blood Cultures","Urinalysis","Urine Culture","Electrolytes","Magnesium","Phosphorus","Liver Function Panel","Lipase","Amylase","Coagulation Panel (PT/INR)","PTT","D-Dimer","ESR","C-Reactive Protein","Procalcitonin","BNP","HbA1c","Lipid Panel","TSH","Free T4","Pregnancy Test","Type & Screen","Arterial Blood Gas","Venous Blood Gas","Wound Culture","Sputum Culture","Strep Test","Influenza Test","COVID-19 Test"]},
 {id:"imaging",name:"Imaging & Diagnostics",kind:"order",names:["12-Lead ECG","Chest X-Ray — 2 Views","Portable Chest X-Ray","CT Head without Contrast","CT Abdomen/Pelvis with Contrast","CT Chest with Contrast","CT Angiography","MRI Brain","MRI Spine","Ultrasound Abdomen","Venous Doppler Ultrasound","Echocardiogram","X-Ray Extremity","Pelvis X-Ray","CT Cervical Spine","EKG Interpretation"]},
 {id:"monitoring",name:"Monitoring & Safety Orders",kind:"order",names:["Telemetry","Oxygen","Pulse Oximetry","Serial Vital Signs","Neurological Checks","Continuous Blood Pressure Monitoring","NPO","Fall Precautions","Fluid Intake/Output Monitoring","Blood Glucose Monitoring","Cardiac Monitoring","Isolation Precautions","Seizure Precautions"]},
 {id:"antibiotics",name:"Antibiotics",kind:"order",names:["Amoxicillin","Amoxicillin-Clavulanate","Azithromycin","Doxycycline","Cephalexin","Cefazolin","Ceftriaxone","Cefepime","Cefdinir","Cefuroxime","Ciprofloxacin","Levofloxacin","Clindamycin","Metronidazole","Vancomycin","Piperacillin-Tazobactam","Meropenem","Ampicillin-Sulbactam","Ampicillin","Penicillin G","Trimethoprim-Sulfamethoxazole","Nitrofurantoin","Linezolid","Gentamicin","Ertapenem","Daptomycin"]},
 {id:"medications",name:"Other Medications",kind:"order",names:["Aspirin","Acetaminophen","Ibuprofen","Ketorolac","Morphine","Fentanyl","Hydromorphone","Ondansetron","Metoclopramide","Diphenhydramine","Albuterol","Ipratropium","Prednisone","Methylprednisolone","Dexamethasone","Epinephrine","Norepinephrine","Nitroglycerin","Heparin","Enoxaparin","Insulin","Glucagon","Dextrose","Lorazepam","Midazolam","Furosemide","Pantoprazole","Famotidine","Lidocaine","Magnesium Sulfate","Potassium Chloride"]},
 {id:"fluids",name:"IV Fluids",kind:"order",names:["Normal Saline","Lactated Ringer's","D5W","Dextrose 5% Normal Saline","Dextrose 10%","Normal Saline Flush","Dextrose 50%"]},
 {id:"procedures",name:"Procedures",kind:"procedure",names:["Wound Repair","Laceration Repair","EMERGENCY SURGERY","Suture Removal","Splint Application","Fracture Reduction","Intubation","Cardiopulmonary Resuscitation","Central Line Placement","Arterial Line Placement","Chest Tube Placement","Lumbar Puncture","Abscess Drainage","IV Access","Urinary Catheter Placement","Blood Transfusion","Sedation","Procedural Ultrasound","Emergency Surgery","Debridement","Incision and Drainage","Endoscopy"]},
 {id:"rooms",name:"Rooms & Beds",kind:"room",names:["Emergency Room","Trauma Room","Observation Room","Operating Room","Med/Surg Room","ICU Room","Pediatric Room"]},
 {id:"ems",name:"EMS & Transport",kind:"ems",names:["EMS Transport","Advanced Life Support Transport","Basic Life Support Transport","EMS Critical Care Transport"]},
 {id:"visits",name:"Facility Visits",kind:"visit",names:["Emergency Visit","Urgent Care Visit","Observation Visit","Trauma Evaluation","Inpatient Consultation","Outpatient Consultation"]},
 {id:"services",name:"Hospital Services",kind:"service",names:["Med/Surg Services","ICU Services","Pediatric Services","Observation Services","Respiratory Therapy","Physical Therapy","Occupational Therapy","Consultation Services","Patient Transport","Pharmacy Services","Diagnostic Services","Surgical Services","Nursing Services"]}
];
export const normalizePriceName=s=>String(s??"").trim().replace(/\s+/g," ").toLowerCase();
export const priceKey=(kind,name)=>String(kind)+":"+normalizePriceName(name);
export const canonicalRateId=(kind,name)=>String(kind)+"_"+normalizePriceName(name).replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,140);
const allowed=new Set(["order","procedure","room","ems","visit","service"]);
const groupById=new Map(BULK_GROUPS.map(g=>[g.id,g]));
export function createPriceCandidates(existing=[],observed=[]){
 const candidates=new Map();
 const put=(item)=>{
  if(!item||!allowed.has(item.kind)||!String(item.name||"").trim())return;
  const key=priceKey(item.kind,item.name);
  const prior=candidates.get(key);
  if(!prior)candidates.set(key,{key,kind:item.kind,name:item.name,group:item.group||"other",code:item.code||""});
  else if(prior.group==="other"&&item.group&&item.group!=="other")prior.group=item.group;
 };
 for(const group of BULK_GROUPS)for(const name of group.names)put({kind:group.kind,name,group:group.id});
 for(const item of observed)put(item);
 for(const item of existing)put({...item,group:findGroup(item.kind,item.name)});
 return [...candidates.values()].sort((a,b)=>a.group.localeCompare(b.group)||a.name.localeCompare(b.name));
}
export function findGroup(kind,name){
 const norm=normalizePriceName(name);
 for(const group of BULK_GROUPS)if(group.kind===kind&&group.names.some(n=>normalizePriceName(n)===norm))return group.id;
 return kind==="order"?"other-order":kind==="procedure"?"procedures":"other";
}
export function validatePriceAmount(v){
 const str=String(v??"").trim();
 if(!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(str))throw Error("Enter a price between $0.00 and $9,999,999.99 with up to two decimals.");
 return Math.round(Number(str)*100);
}
function csvEscape(s){const v=String(s??"");return /[",\r\n]/.test(v)?'"'+v.replaceAll('"','""')+'"':v;}
export function serializePriceCSV(rows){
 return [["category","kind","serviceName","price","code"],...rows.map(r=>[r.group||findGroup(r.kind,r.name),r.kind,r.name,r.price??"",r.code||""])]
  .map(cols=>cols.map(csvEscape).join(",")).join("\r\n")+"\r\n";
}
export function parsePriceCSV(text){
 if(typeof text!=="string"||text.length>2000000)throw Error("CSV is missing or exceeds 2 MB.");
 const records=[],row=[];let field="",quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++}else if(c==='"')quoted=false;else field+=c;}
  else if(c==='"'){if(field.length)throw Error("Invalid quote in CSV");quoted=true;}
  else if(c===","){row.push(field);field="";}
  else if(c==="\n"||c==="\r"){row.push(field);field="";if(row.some(x=>x.trim()))records.push(row.splice(0));else row.length=0;if(c==="\r"&&text[i+1]==="\n")i++;}
  else field+=c;
 }
 if(quoted)throw Error("Unclosed CSV quote.");
 row.push(field);if(row.some(x=>x.trim()))records.push(row);
 if(records.length<2)throw Error("CSV needs a header and at least one service.");
 const header=records.shift().map(x=>x.trim().replace(/^\uFEFF/,""));
 const idx=k=>header.indexOf(k);
 for(const key of ["kind","serviceName","price"])if(idx(key)<0)throw Error("Missing CSV column: "+key);
 if(records.length>1500)throw Error("CSV contains more than 1,500 rows; split the file.");
 const seen=new Set(),out=[];
 for(let n=0;n<records.length;n++){
  const r=records[n],kind=String(r[idx("kind")]||"").trim(),name=String(r[idx("serviceName")]||"").trim();
  const amount=String(r[idx("price")]||"").trim();
  if(!amount)continue; // blank-priced template entries are intentionally skipped
  if(!allowed.has(kind)||name.length<2||name.length>120)throw Error("Invalid service on CSV row "+(n+2));
  const cents=validatePriceAmount(amount),key=priceKey(kind,name);
  if(seen.has(key))throw Error("Duplicate service in CSV: "+name);
  seen.add(key);
  const group=idx("category")>=0?String(r[idx("category")]||"").trim():findGroup(kind,name);
  const code=idx("code")>=0?String(r[idx("code")]||"").trim():"";
  if(code.length>40)throw Error("Service code too long on row "+(n+2));
  out.push({key,kind,name,group:groupById.has(group)?group:findGroup(kind,name),code,priceCents:cents});
 }
 if(!out.length)throw Error("No priced services found. Fill in at least one CSV price.");
 return out;
}
