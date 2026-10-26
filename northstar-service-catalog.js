// Editable simulation charge master. Historic invoices store frozen item prices.
import {getApp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {getAuth} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {getFirestore,collection,doc,getDoc,getDocs,query,where,writeBatch,serverTimestamp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
const db=()=>getFirestore(getApp()),auth=()=>getAuth(getApp());
const esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const cash=c=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format((Number(c)||0)/100);
const normalize=s=>String(s??"").toLowerCase().replace(/\s+/g," ").trim();
const readPrice=v=>{if(!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(String(v).trim()))throw Error("Enter a valid price from $0.00 to $9,999,999.99.");return Math.round(Number(v)*100)};
const canEdit=p=>p?.status==="active"&&(p.role==="administrator"||p.permissions?.billingManage===true);
const kindTitle={visit:"Encounter / facility",order:"Clinical order",procedure:"Procedure"};
export async function listCatalog(){
 const snap=await getDocs(collection(db(),"serviceCatalog"));
 return snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.name.localeCompare(b.name));
}
export function renderServiceCatalog({target,records,profile}){
 if(!target)return;
 if(!canEdit(profile)){target.innerHTML='<article class="panel"><h3>Service pricing is restricted.</h3><p>Ask an administrator for Billing Management permission.</p></article>';return;}
 const rows=records||[];
 target.innerHTML='<section class="nmc-billing-page nmc-catalog"><header><div><p class="eyebrow">Northstar Medical Center · Administration</p><h2>Service Prices & Charge Master</h2><p>Set prices for visits, procedures and clinical orders. Future invoices use the active rates; old invoices keep their original amounts.</p></div></header>'+
 '<div class="nmc-bill-metrics"><article><span>Catalog services</span><strong>'+rows.length+'</strong></article><article><span>Active rates</span><strong>'+rows.filter(r=>r.active!==false).length+'</strong></article></div>'+
 '<form id="nmcCatalogForm" class="nmc-catalog-form"><h3>Add a service price</h3><div class="nmc-bill-two"><label>Service name<input name="name" minlength="2" maxlength="120" required placeholder="e.g. Chest X-Ray"></label><label>Source<select name="kind"><option value="visit">Encounter / facility fee</option><option value="order">Clinical order</option><option value="procedure">Completed procedure</option></select></label><label>Unit price ($)<input name="price" type="number" min="0" max="9999999.99" step="0.01" required placeholder="125.00"></label><label>Service code (optional)<input name="code" maxlength="40" placeholder="XR-001"></label></div><p>Use the exact service name documented in Northstar orders or procedures to match automatic charges. Only one active price per service name and source is allowed.</p><button type="submit">Save service price</button><p id="nmcCatalogNotice" role="status"></p></form>'+
 '<div class="nmc-bill-tools"><input id="nmcCatalogSearch" type="search" placeholder="Search service rates" aria-label="Search service rates"><select id="nmcCatalogStatus"><option value="all">All rates</option><option value="active">Active only</option><option value="archived">Archived only</option></select></div><div id="nmcCatalogRows"></div></section>';
 const list=target.querySelector("#nmcCatalogRows"),input=target.querySelector("#nmcCatalogSearch"),status=target.querySelector("#nmcCatalogStatus");
 const draw=()=>{
  const needle=input.value.toLowerCase(),filter=status.value;
  const shown=rows.filter(r=>(filter==="all"||(filter==="active"?(r.active!==false):(r.active===false)))&&[r.name,r.code,r.kind].some(x=>String(x||"").toLowerCase().includes(needle)));
  list.replaceChildren();
  if(!shown.length){list.textContent="No services match your search. Add a price above to get started.";return;}
  for(const r of shown){
   const card=document.createElement("article");card.className="nmc-bill-row nmc-catalog-row";
   const info=document.createElement("div");const title=document.createElement("strong");title.textContent=r.name;
   const sub=document.createElement("small");sub.textContent=(kindTitle[r.kind]||r.kind)+" · "+(r.code||"No code")+" · "+(r.active===false?"Archived":"Active");
   info.append(title,sub);
   const price=document.createElement("strong");price.textContent=cash(r.priceCents);
   const actions=document.createElement("div");actions.className="nmc-catalog-actions";
   const edit=document.createElement("button");edit.type="button";edit.textContent="Edit price";edit.onclick=()=>editRate(r);
   const toggle=document.createElement("button");toggle.type="button";toggle.textContent=r.active===false?"Reactivate":"Archive";toggle.onclick=async()=>{toggle.disabled=true;try{await saveChange(r,{active:r.active===false});}catch(e){target.querySelector("#nmcCatalogNotice").textContent=e.message;}finally{toggle.disabled=false}};
   actions.append(edit,toggle);card.append(info,price,actions);list.append(card);
  }
 };
 input.oninput=draw;status.onchange=draw;draw();
 const form=target.querySelector("#nmcCatalogForm");
 form.onsubmit=async e=>{
  e.preventDefault();const f=new FormData(form);const name=String(f.get("name")).trim(),kind=String(f.get("kind")),priceCents=readPrice(f.get("price")),code=String(f.get("code")||"").trim();
  const notice=target.querySelector("#nmcCatalogNotice");
  const same=rows.find(r=>r.kind===kind&&normalize(r.name)===normalize(name));
  if(same){notice.textContent="This service already exists. Edit its price or reactivate its archived entry.";return;}
  const button=form.querySelector('[type="submit"]');button.disabled=true;
  try{const ref=doc(collection(db(),"serviceCatalog")),batch=writeBatch(db());
   batch.set(ref,{name,kind,code,priceCents,active:true,version:1,createdBy:auth().currentUser.uid,createdAt:serverTimestamp(),updatedBy:auth().currentUser.uid,updatedAt:serverTimestamp()});
   batch.set(doc(collection(db(),"serviceCatalog",ref.id,"revisions")),{action:"created",priceCents,name,actorUid:auth().currentUser.uid,at:serverTimestamp()});
   await batch.commit();notice.textContent="Price saved.";form.reset();
  }catch(err){notice.textContent=err.message;}finally{button.disabled=false;}
 };
 async function saveChange(r,changes){
  const batch=writeBatch(db());
  batch.update(doc(db(),"serviceCatalog",r.id),{...changes,version:(r.version||1)+1,updatedBy:auth().currentUser.uid,updatedAt:serverTimestamp()});
  batch.set(doc(collection(db(),"serviceCatalog",r.id,"revisions")),{action:changes.active===false?"archived":changes.active===true?"reactivated":"price-updated",priceCents:changes.priceCents??r.priceCents,name:r.name,actorUid:auth().currentUser.uid,at:serverTimestamp()});
  await batch.commit();
 }
 function editRate(r){
  const modal=document.createElement("dialog");modal.className="nmc-billing-dialog";modal.innerHTML='<form class="nmc-billing-dialog-inner"><h2>Edit price</h2><p>'+esc(r.name)+' · '+esc(kindTitle[r.kind]||"Service")+'</p><label>New rate ($)<input name="price" type="number" min="0" max="9999999.99" step="0.01" required value="'+(r.priceCents/100).toFixed(2)+'"></label><label>Reason for price change<textarea name="reason" minlength="5" maxlength="250" required></textarea></label><div class="nmc-bill-footer"><button type="button" class="nmc-close-rate">Cancel</button><button type="submit">Save updated price</button></div><p class="nmc-rate-error" role="status"></p></form>';
  document.body.append(modal);modal.showModal();modal.addEventListener("close",()=>modal.remove());modal.querySelector(".nmc-close-rate").onclick=()=>modal.close();
  modal.querySelector("form").onsubmit=async ev=>{ev.preventDefault();const priceCents=readPrice(new FormData(ev.target).get("price"));const reason=String(new FormData(ev.target).get("reason")).trim();const button=ev.target.querySelector('[type="submit"]');button.disabled=true;
   try{const batch=writeBatch(db());batch.update(doc(db(),"serviceCatalog",r.id),{priceCents,version:(r.version||1)+1,updatedBy:auth().currentUser.uid,updatedAt:serverTimestamp()});
   batch.set(doc(collection(db(),"serviceCatalog",r.id,"revisions")),{action:"price-updated",priceCents,previousPriceCents:r.priceCents,reason,actorUid:auth().currentUser.uid,at:serverTimestamp()});
   await batch.commit();modal.close();
   }catch(err){modal.querySelector(".nmc-rate-error").textContent=err.message;button.disabled=false;}
  };
 }
}
export function buildCatalogQuote({encounterId,catalog,orders,procedures}){
 const rate=new Map(catalog.filter(x=>x.active!==false).map(x=>[x.kind+":"+normalize(x.name),x]));
 const lines=[],unpriced=[];
 const push=(type,name,sourceId,qty=1)=>{
  const item=rate.get(type+":"+normalize(name));
  if(!item){unpriced.push({kind:type,name,sourceId});return;}
  lines.push({serviceId:item.id,serviceName:item.name,description:item.name,sourceType:type,sourceId,quantity:qty,unitPriceCents:item.priceCents,amountCents:item.priceCents*qty,rateVersion:item.version||1});
 };
 const visits=catalog.filter(x=>x.active!==false&&x.kind==="visit");
 const defaultVisit=visits.find(x=>normalize(x.name)==="emergency visit")||(visits.length===1?visits[0]:null);
 if(defaultVisit)push("visit",defaultVisit.name,"visit:"+encounterId);
 else if(visits.length>1)unpriced.push({kind:"visit",name:"Multiple facility rates configured — use a rate named Emergency Visit",sourceId:encounterId});
 for(const d of orders){const item=d.data||{};if(["cancelled","canceled","void"].includes(String(item.status||"").toLowerCase()))continue;push("order",item.name||item.orderName||"Unnamed order",d.id);}
 for(const d of procedures){const item=d.data||{};if(!["complete","completed","done"].includes(String(item.status||"").toLowerCase()))continue;push("procedure",item.name||"Unnamed procedure",d.id);}
 return {lines,unpriced,catalog:catalog.filter(x=>x.active!==false),totalCents:lines.reduce((a,x)=>a+x.amountCents,0)};
}


export async function collectEncounterCharges(encounterId){
 const [catalog,orders,procedures]=await Promise.all([
  listCatalog(),
  getDocs(query(collection(db(),"orders"),where("encounterId","==",encounterId))),
  getDocs(query(collection(db(),"procedures"),where("encounterId","==",encounterId)))
 ]);
 return buildCatalogQuote({encounterId,catalog,
  orders:orders.docs.map(d=>({id:d.id,data:d.data()})),
  procedures:procedures.docs.map(d=>({id:d.id,data:d.data()}))
 });
}
