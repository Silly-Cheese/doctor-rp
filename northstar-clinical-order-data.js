// The same canonical clinical order names drive provider selection and simulated billing.
import {BULK_GROUPS,normalizePriceName} from "./northstar-pricing-bulk-data.js";
export const ORDER_GROUPS=[
 {id:"laboratory",label:"Laboratory",category:"laboratory",template:"laboratory"},
 {id:"imaging",label:"Imaging & Diagnostics",category:"imaging",template:"imaging"},
 {id:"antibiotics",label:"Antibiotics",category:"medication",template:"antibiotics"},
 {id:"medications",label:"Other Medications",category:"medication",template:"medications"},
 {id:"fluids",label:"IV Fluids",category:"medication",template:"fluids"},
 {id:"monitoring",label:"Monitoring & Safety",category:"monitoring",template:"monitoring"},
 {id:"procedures",label:"Clinical Procedures",category:"procedure",template:"procedures"},
 {id:"consults",label:"Consults & Therapies",category:"consult",template:"services"},
 {id:"other",label:"Other Clinical Orders",category:"other",template:null}
];
const metadata=new Map(ORDER_GROUPS.map(g=>[g.id,g]));
export function buildClinicalChoices(priced=[],extra=[]){
 const result=new Map();
 const add=(group,name,code="",rate=null)=>{
  const cfg=metadata.get(group);if(!cfg||!name||!name.trim())return;
  const key=cfg.category+":"+normalizePriceName(name);
  const prior=result.get(key);
  // Prefer a configured rate/code while keeping a stable clinical category.
  if(!prior||(!prior.catalogId&&rate?.id))result.set(key,{id:key,group,label:cfg.label,category:cfg.category,name:name.trim(),
    serviceCode:code||"",catalogId:rate?.id||"",unitPriceCents:rate?.priceCents??null,priced:!!rate});
 };
 for(const group of ORDER_GROUPS){
  const source=BULK_GROUPS.find(g=>g.id===group.template);
  for(const name of source?.names||[])add(group.id,name);
 }
 for(const row of priced.filter(r=>r.active!==false&&r.kind==="order")){
  const group=ORDER_GROUPS.find(g=>(BULK_GROUPS.find(x=>x.id===g.template)?.names||[]).some(name=>normalizePriceName(name)===normalizePriceName(row.name)))?.id || "other";
  add(group,row.name,row.code,row);
 }
 for(const item of extra){
  const group=ORDER_GROUPS.find(g=>g.id===item.group)?.id||ORDER_GROUPS.find(g=>g.category===item.category)?.id||"other";
  add(group,item.name,item.serviceCode||"",item);
 }
 // Attach prices to the curated choices by normalized name without changing identity.
 const prices=new Map(priced.filter(r=>r.active!==false&&r.kind==="order").map(r=>[normalizePriceName(r.name),r]));
 for(const item of result.values()){
  const rate=prices.get(normalizePriceName(item.name));
  if(rate){item.priced=true;item.catalogId=rate.id;item.serviceCode=rate.code||item.serviceCode;item.unitPriceCents=rate.priceCents;}
 }
 return [...result.values()].sort((a,b)=>ORDER_GROUPS.findIndex(g=>g.id===a.group)-ORDER_GROUPS.findIndex(g=>g.id===b.group)||a.name.localeCompare(b.name));
}
export function selectOrderChoice(items,group,name){
 return items.find(x=>x.group===group&&x.name===name)||null;
}
export function orderStatusLabel(choice){return choice?.priced?"Rate configured":"Price not configured";}
