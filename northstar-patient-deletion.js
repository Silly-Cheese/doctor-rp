import{getApp}from"https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import{getAuth,onAuthStateChanged}from"https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import{getFunctions,httpsCallable}from"https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";
import{getFirestore,doc,getDoc,collection,getDocs}from"https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
const app=getApp(),auth=getAuth(app),db=getFirestore(app),functions=getFunctions(app,"us-central1");
let uid=null;
const ui=document.createElement("div");ui.id="nmcDeleteUi";ui.innerHTML=`<button id="nmcDeleteOpen" type="button" hidden>Patient Deletion Approvals</button><dialog id="nmcDeleteDialog"><div class="nmc-delete-body"><header><div><small>ADMINISTRATION · RESTRICTED</small><h2>Patient Deletion Requests</h2></div><button id="nmcDeleteClose" type="button">×</button></header><p>Permanent deletion requires approval by a different administrator. Related records will also be deleted. This cannot be undone.</p><form id="nmcDeleteForm"><label>Patient<select id="nmcDeletePatient" required></select></label><label>Reason for deletion<textarea id="nmcDeleteReason" minlength="15" maxlength="1000" required rows="3"></textarea></label><button type="submit">Request deletion</button></form><h3>Missing patient records</h3><p>Detect linked records whose patient document was deleted directly in Firebase.</p><button id="nmcScanOrphans" type="button">Scan for orphan records</button><div id="nmcOrphanResults"></div><h3>Pending approvals</h3><div id="nmcDeleteRequests"></div><p id="nmcDeleteStatus" role="status"></p></div></dialog>`;document.body.append(ui);
const e=id=>document.getElementById(id),message=s=>e("nmcDeleteStatus").textContent=s;
e("nmcDeleteOpen").onclick=()=>{e("nmcDeleteDialog").showModal();refresh()};
e("nmcDeleteClose").onclick=()=>e("nmcDeleteDialog").close();
async function refresh(){try{const [p,r]=await Promise.all([getDocs(collection(db,"patients")),getDocs(collection(db,"patientDeletionRequests"))]);const select=e("nmcDeletePatient");select.replaceChildren();for(const item of p.docs){const x=item.data(),o=document.createElement("option");o.value=item.id;o.textContent=(x.mrn||item.id)+" — "+(x.displayName||[x.firstName,x.lastName].filter(Boolean).join(" "));select.append(o)}const area=e("nmcDeleteRequests");area.replaceChildren();const pending=r.docs.filter(x=>x.get("status")==="pending");if(!pending.length)area.textContent="No pending requests.";for(const x of pending){const d=x.data(),card=document.createElement("article");card.className="nmc-delete-item";const label=document.createElement("div");label.textContent=(d.patientMrn||"")+" · "+(d.patientName||"Patient")+" — "+d.reason;card.append(label);if(d.requestedBy!==uid){const button=document.createElement("button");button.type="button";button.textContent="Approve and permanently delete";button.onclick=async()=>{if(!confirm("Permanently delete this patient and related records? This cannot be undone."))return;button.disabled=true;try{const result=await httpsCallable(functions,"approvePatientDeletion")({requestId:x.id});message("Deletion completed: "+result.data.deletedRecordCount+" records.");await refresh()}catch(err){message(err.message)}finally{button.disabled=false}};card.append(button)}else{const note=document.createElement("small");note.textContent="Awaiting a different administrator's approval";card.append(note)}area.append(card)}}catch(err){message("Unable to load deletion requests: "+err.message)}}
e("nmcDeleteForm").onsubmit=async ev=>{ev.preventDefault();const b=ev.target.querySelector("button");b.disabled=true;try{const result=await httpsCallable(functions,"requestPatientDeletion")({patientId:e("nmcDeletePatient").value,reason:e("nmcDeleteReason").value.trim()});message("Approval requested: "+result.data.requestId);e("nmcDeleteReason").value="";await refresh()}catch(err){message("Request failed: "+err.message)}finally{b.disabled=false}};
onAuthStateChanged(auth,async user=>{uid=null;e("nmcDeleteOpen").hidden=true;if(e("nmcDeleteDialog").open)e("nmcDeleteDialog").close();if(!user)return;try{const p=await getDoc(doc(db,"users",user.uid));if(p.exists()&&p.get("status")==="active"&&p.get("role")==="administrator"){uid=user.uid;e("nmcDeleteOpen").hidden=false}}catch(err){console.warn("Deletion admin lookup",err)}});

document.getElementById("nmcScanOrphans").onclick=async()=>{
 const btn=document.getElementById("nmcScanOrphans"),out=document.getElementById("nmcOrphanResults");
 btn.disabled=true;out.textContent="Scanning related collections…";
 try{
  const data=(await httpsCallable(functions,"scanOrphanPatientRecords")()).data;
  out.replaceChildren();
  const rows=data.orphans||[];
  if(!rows.length){out.textContent="No orphaned patient references found in the scanned collections.";return}
  for(const item of rows){
   const block=document.createElement("article");block.className="nmc-delete-item";
   const heading=document.createElement("strong");heading.textContent="Missing patient: "+item.patientId;
   const info=document.createElement("p");info.textContent=item.recordCount+" related records — "+Object.entries(item.collections||{}).map(([name,count])=>name+": "+count).join(", ");
   const reason=document.createElement("textarea");reason.minLength=15;reason.maxLength=1000;reason.placeholder="Explain why these orphaned records should be permanently removed";
   const request=document.createElement("button");request.type="button";request.textContent="Request orphan cleanup";
   request.onclick=async()=>{request.disabled=true;try{const response=await httpsCallable(functions,"requestOrphanCleanup")({patientId:item.patientId,reason:reason.value.trim()});message("Cleanup request submitted for independent approval: "+response.data.requestId);await refresh()}catch(err){message(err.message)}finally{request.disabled=false}};
   block.append(heading,info,reason,request);out.append(block)
  }
 }catch(err){out.textContent="Scan failed: "+err.message}finally{btn.disabled=false}
};
