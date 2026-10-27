import {getApp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {getAuth} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {getFirestore,collection,doc,getDoc,getDocs,writeBatch,serverTimestamp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {BULK_GROUPS,createPriceCandidates,priceKey,canonicalRateId,findGroup,validatePriceAmount,serializePriceCSV,parsePriceCSV} from "./northstar-pricing-bulk-data.js";

const draft=new Map(),selected=new Set(),imported=new Map();
let searchTerm="",groupFilter="all",onlyMissing=true,includeExisting=false,page=0,notice="",saving=false;
const PAGE_SIZE=60;
const usd=n=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n/100);
const normalize=s=>String(s??"").trim().replace(/\s+/g," ").toLowerCase();
const dollar=n=>(n/100).toFixed(2);
const findExisting=(records)=>new Map(records.map(r=>[priceKey(r.kind,r.name),r]));
const showMessage=(msg,node)=>{notice=msg;if(node)node.textContent=msg;};
const csvDownload=(filename,body)=>{
 const blob=new Blob([body],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),anchor=document.createElement("a");
 anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();anchor.remove();
 setTimeout(()=>URL.revokeObjectURL(url),10000);
};
export function mountBulkPricing({target,records=[],observed=[]}){
 if(!target)return;
 const current=findExisting(records);
 const generated=createPriceCandidates(records,observed);
 for(const row of imported.values())if(!generated.some(x=>x.key===row.key))generated.push({key:row.key,kind:row.kind,name:row.name,group:row.group,code:row.code});
 const candidates=generated.sort((a,b)=>a.group.localeCompare(b.group)||a.name.localeCompare(b.name));
 const panel=document.createElement("section");panel.className="nmc-bulk-panel";
 panel.innerHTML='<header><div><p class="eyebrow">Fast setup · Billing Administration</p><h3>Bulk Service Pricing</h3><p>Configure lab tests, antibiotics, medications, procedures, rooms and more in one review. No prices are applied until you explicitly save.</p></div></header>'+
 '<div class="nmc-bulk-toolbar"><label>Category<select id="nmcBulkGroup"><option value="all">All categories</option>'+BULK_GROUPS.map(x=>'<option value="'+x.id+'">'+x.name+'</option>').join("")+'<option value="other-order">Other recorded orders</option><option value="other">Other services</option></select></label>'+
 '<label>Find a service<input type="search" id="nmcBulkSearch" placeholder="Search medications, orders, services…"></label>'+
 '<label class="nmc-bulk-check"><input type="checkbox" id="nmcBulkMissing"> Show missing prices only</label></div>'+
 '<div class="nmc-bulk-controls"><button id="nmcBulkSelectPage" type="button">Select visible</button><button id="nmcBulkSelectGroup" type="button">Select filtered</button><button id="nmcBulkClear" type="button">Clear selection</button>'+
 '<label class="nmc-bulk-check"><input type="checkbox" id="nmcBulkOverwrite"> Explicitly update existing prices</label></div>'+
 '<div class="nmc-bulk-apply"><label>Price for selected services ($)<input id="nmcBulkPrice" type="number" min="0" max="9999999.99" step="0.01" placeholder="e.g. 50.00"></label><button type="button" id="nmcBulkApply">Apply price to selected (preview)</button></div>'+
 '<p id="nmcBulkSummary" class="nmc-bulk-summary" aria-live="polite"></p>'+
 '<div class="nmc-bulk-table-wrap"><table class="nmc-bulk-table"><thead><tr><th>Select</th><th>Clinical service</th><th>Price ($)</th><th>Existing rate</th></tr></thead><tbody id="nmcBulkRows"></tbody></table></div>'+
 '<div class="nmc-bulk-pages"><button id="nmcBulkPrev" type="button">Previous</button><span id="nmcBulkPageNum"></span><button id="nmcBulkNext" type="button">Next</button></div>'+
 '<div class="nmc-bulk-footer"><button id="nmcBulkTemplate" type="button">Download full price template (.csv)</button><button id="nmcBulkExport" type="button">Export current catalog (.csv)</button><label class="nmc-bulk-import">Import completed CSV<input type="file" id="nmcBulkFile" accept=".csv,text/csv"></label><button id="nmcBulkSave" type="button" class="nmc-bulk-primary">Save selected prices</button></div>'+
 '<p id="nmcBulkNotice" class="nmc-bulk-notice" role="status"></p>';
 const existing=target.querySelector(".nmc-bulk-panel");if(existing)existing.replaceWith(panel);else target.insertBefore(panel,target.querySelector(".nmc-bill-tools")||null);
 const el=id=>panel.querySelector("#"+id),body=el("nmcBulkRows"),summary=el("nmcBulkSummary"),alert=el("nmcBulkNotice");
 el("nmcBulkGroup").value=groupFilter;el("nmcBulkSearch").value=searchTerm;el("nmcBulkMissing").checked=onlyMissing;el("nmcBulkOverwrite").checked=includeExisting;
 alert.textContent=notice;
 const eligible=r=>includeExisting||!current.has(r.key);
 const filtered=()=>candidates.filter(r=>(groupFilter==="all"||r.group===groupFilter)&&(!onlyMissing||!current.has(r.key))&&(!searchTerm||[r.name,r.code,r.group].some(x=>String(x||"").toLowerCase().includes(searchTerm))));
 let showing=[];
 const redraw=()=>{
  const rows=filtered(),pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));
  page=Math.max(0,Math.min(page,pages-1));
  showing=rows.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
  body.replaceChildren();
  for(const r of showing){
   const existingRate=current.get(r.key),entry=draft.get(r.key),tr=document.createElement("tr");
   const first=document.createElement("td"),choice=document.createElement("input");choice.type="checkbox";choice.checked=selected.has(r.key);
   choice.disabled=!eligible(r)||saving;choice.setAttribute("aria-label","Select "+r.name);
   choice.onchange=()=>{choice.checked?selected.add(r.key):selected.delete(r.key);updateStats()};
   first.append(choice);
   const name=document.createElement("td"),label=document.createElement("strong"),meta=document.createElement("small");
   label.textContent=r.name;meta.textContent=r.group+" · "+r.kind;
   name.append(label,meta);
   const valueCell=document.createElement("td"),input=document.createElement("input");
   input.type="number";input.min="0";input.max="9999999.99";input.step="0.01";input.inputMode="decimal";input.className="nmc-bulk-rate";
   input.setAttribute("aria-label","Unit price for "+r.name);
   if(entry?.priceCents!==undefined)input.value=dollar(entry.priceCents);
   else if(existingRate)input.value=dollar(existingRate.priceCents);
   input.disabled=!eligible(r)||saving;
   input.onchange=()=>{
    if(!input.value.trim()){draft.delete(r.key);updateStats();return}
    try{const cents=validatePriceAmount(input.value);draft.set(r.key,{...r,priceCents:cents});selected.add(r.key);choice.checked=true;showMessage("",alert)}
    catch(err){showMessage(r.name+": "+err.message,alert);input.focus()}
    updateStats();
   };
   valueCell.append(input);
   const existingCell=document.createElement("td");existingCell.textContent=existingRate?usd(existingRate.priceCents)+" · "+(existingRate.active===false?"Archived":"Active"):"Not priced";
   tr.append(first,name,valueCell,existingCell);body.append(tr);
  }
  el("nmcBulkPageNum").textContent="Page "+(page+1)+" of "+pages+" · "+rows.length+" services";
  el("nmcBulkPrev").disabled=page===0||saving;el("nmcBulkNext").disabled=page+1===pages||saving;
  updateStats();
 };
 const updateStats=()=>{
  const selectedValid=[...selected].filter(k=>candidates.some(x=>x.key===k)&&(!current.has(k)||includeExisting)&&draft.has(k));
  const missing=candidates.filter(x=>!current.has(x.key)).length;
  summary.textContent=candidates.length+" available services · "+missing+" without rates · "+selected.size+" selected · "+selectedValid.length+" selected with new prices.";
  el("nmcBulkSave").disabled=saving||!selectedValid.length;
  el("nmcBulkSave").textContent=saving?"Saving rates…":"Save "+selectedValid.length+" selected price"+(selectedValid.length===1?"":"s");
 };
 el("nmcBulkGroup").onchange=e=>{groupFilter=e.target.value;page=0;redraw()};
 el("nmcBulkSearch").oninput=e=>{searchTerm=e.target.value.trim().toLowerCase();page=0;redraw()};
 el("nmcBulkMissing").onchange=e=>{onlyMissing=e.target.checked;page=0;redraw()};
 el("nmcBulkOverwrite").onchange=e=>{
  includeExisting=e.target.checked;if(!includeExisting)for(const key of [...selected])if(current.has(key))selected.delete(key);
  redraw();
 };
 el("nmcBulkSelectPage").onclick=()=>{for(const r of showing)if(eligible(r))selected.add(r.key);redraw()};
 el("nmcBulkSelectGroup").onclick=()=>{for(const r of filtered())if(eligible(r))selected.add(r.key);redraw()};
 el("nmcBulkClear").onclick=()=>{selected.clear();redraw()};
 el("nmcBulkPrev").onclick=()=>{page--;redraw()};
 el("nmcBulkNext").onclick=()=>{page++;redraw()};
 el("nmcBulkApply").onclick=()=>{
  try{
   const cents=validatePriceAmount(el("nmcBulkPrice").value);
   if(!selected.size)throw Error("Select services first (or use Select filtered).");
   let applied=0;
   for(const key of selected){
    const service=candidates.find(r=>r.key===key);
    if(service&&eligible(service)){draft.set(key,{...service,priceCents:cents});applied++}
   }
   showMessage("Applied "+usd(cents)+" to "+applied+" selected services. Review before saving.",alert);redraw();
  }catch(err){showMessage(err.message,alert)}
 };
 el("nmcBulkTemplate").onclick=()=>csvDownload("northstar-pricing-template.csv",serializePriceCSV(candidates.map(r=>({...r,price:""}))));
 el("nmcBulkExport").onclick=()=>csvDownload("northstar-current-prices.csv",serializePriceCSV(records.map(r=>({...r,group:findGroup(r.kind,r.name),price:dollar(r.priceCents)}))));
 el("nmcBulkFile").onchange=async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
   if(file.size>2000000)throw Error("CSV exceeds the 2 MB limit.");
   const list=parsePriceCSV(await file.text());
   for(const r of list){imported.set(r.key,r);draft.set(r.key,r);if(!current.has(r.key)||includeExisting)selected.add(r.key);}
   showMessage("Imported "+list.length+" priced services into the preview. No Firebase changes yet. Review and save.",alert);
   mountBulkPricing({target,records,observed});
  }catch(err){showMessage("CSV import error: "+err.message,alert)}
  e.target.value="";
 };
 el("nmcBulkSave").onclick=async()=>{
  if(saving)return;
  const requests=[...selected].map(key=>draft.get(key)).filter(Boolean);
  if(!requests.length){showMessage("Select services and enter prices first.",alert);return;}
  if(requests.some(r=>current.has(r.key))&&!includeExisting){showMessage("Existing prices cannot be modified unless explicitly enabled.",alert);return;}
  saving=true;updateStats();
  let created=0,updated=0,skipped=0;
  try{
   const user=getAuth(getApp()).currentUser;if(!user)throw Error("Please sign in again.");
   const store=getFirestore(getApp());
   // Recheck current catalog to protect prior user edits and concurrent sessions.
   const latestSnap=await getDocs(collection(store,"serviceCatalog"));
   const latest=new Map(latestSnap.docs.map(d=>[priceKey(d.get("kind"),d.get("name")),{id:d.id,...d.data()}]));
   for(let offset=0;offset<requests.length;offset+=120){
    const batch=writeBatch(store);let writes=0,chunkCreated=0,chunkUpdated=0,chunkSkipped=0;
    const chunk=requests.slice(offset,offset+120);
    for(const r of chunk){
     const last=latest.get(r.key);
     const deterministic=canonicalRateId(r.kind,r.name);
     if(!last&&latestSnap.docs.some(d=>d.id===deterministic)){chunkSkipped++;continue}
     if(last&&!includeExisting){chunkSkipped++;continue}
     if(last&&last.priceCents===r.priceCents&&last.active!==false){chunkSkipped++;continue}
     const ref=doc(store,"serviceCatalog",last?.id||deterministic),actor=user.uid;
     if(last){
      batch.update(ref,{priceCents:r.priceCents,active:true,version:(last.version||1)+1,updatedBy:actor,updatedAt:serverTimestamp()});
      batch.set(doc(collection(store,"serviceCatalog",ref.id,"revisions")),{
       action:"price-updated",priceCents:r.priceCents,previousPriceCents:last.priceCents,
       name:last.name,reason:"Bulk pricing change",actorUid:actor,at:serverTimestamp()
      });chunkUpdated++;
     }else{
      batch.set(ref,{name:r.name,kind:r.kind,code:r.code||"",priceCents:r.priceCents,active:true,version:1,
       createdBy:actor,createdAt:serverTimestamp(),updatedBy:actor,updatedAt:serverTimestamp()});
      batch.set(doc(collection(store,"serviceCatalog",ref.id,"revisions")),{
       action:"created",priceCents:r.priceCents,name:r.name,actorUid:actor,at:serverTimestamp()
      });chunkCreated++;
     }
     writes+=2;
    }
    if(writes)await batch.commit();
    created+=chunkCreated;updated+=chunkUpdated;skipped+=chunkSkipped;
    showMessage("Saved batch "+(Math.floor(offset/120)+1)+" of "+Math.ceil(requests.length/120)+".",alert);
   }
   for(const r of requests)selected.delete(r.key);
   showMessage("Bulk pricing saved: "+created+" created, "+updated+" updated, "+skipped+" skipped. Existing invoices are unchanged.",alert);
  }catch(err){showMessage("Save stopped: "+err.message+" — "+created+" created, "+updated+" updated so far. Refresh the catalog before retrying.",alert)}
  finally{saving=false;updateStats();window.dispatchEvent(new Event("northstar:prices-saved"))}
 };
 redraw();
}
