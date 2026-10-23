
import {getApps,getApp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {getAuth,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {getFirestore,collection,doc,getDoc,getDocs,addDoc,updateDoc,serverTimestamp,query,where,orderBy,onSnapshot} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
const e=(s)=>document.querySelector(s);
const escape=(s)=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const app=getApps().length?getApp():null;
if(!app) throw Error("Northstar Firebase must initialize first");
const auth=getAuth(app),db=getFirestore(app);
let user=null,staff=null,selected=null,unsub=null;
const investigator=()=>staff&&(staff.role==="administrator"||staff.permissions?.siuInvestigations===true);
const title=(s)=>({open:"Open",triage:"Under triage",investigating:"Investigating",review:"Final review",closed:"Closed"}[s]||s);
const types=["Patient safety","Staff misconduct","Medication discrepancy","Record or privacy concern","Fraud or falsification","Harassment or retaliation","Equipment or facility","Other"];
const ui=document.createElement("div");ui.id="northstarSIU";ui.innerHTML=`
<button id="siuLaunch" class="siu-launch" type="button" hidden>Report an Incident · SIU</button>
<dialog id="siuDialog" class="siu-dialog"><div class="siu-shell">
<header><div><small>NORTHSTAR MEDICAL CENTER</small><h2>Special Investigations Unit</h2><p>Confidential incident reporting and case investigations</p></div><button id="siuClose" type="button" aria-label="Close">✕</button></header>
<div id="siuNotice" role="status"></div>
<div class="siu-tabs"><button id="siuReportTab" class="active" type="button">Submit report</button><button id="siuCasesTab" type="button">My reports</button><button id="siuQueueTab" type="button" hidden>Investigation queue</button></div>
<section id="siuReportPane"><p>Describe what happened using factual details. Reports are visible only to the submitting staff member and authorized SIU personnel. This is not an emergency service.</p><form id="siuReportForm">
<div class="siu-grid"><label>Category<select name="category" required>${types.map(t=>`<option>${t}</option>`).join("")}</select></label><label>Priority<select name="priority"><option>routine</option><option>high</option><option>critical</option></select></label></div>
<label>Report title<input name="title" minlength="5" maxlength="120" required placeholder="Short description of concern"></label>
<label>When did it occur?<input name="occurredAt" type="datetime-local"></label>
<label>Department or location<input name="location" maxlength="120" placeholder="Unit, room, shift, or department"></label>
<label>People involved (only as needed)<textarea name="involved" maxlength="1500" rows="2"></textarea></label>
<label>What happened?<textarea name="description" maxlength="8000" minlength="20" rows="5" required placeholder="Describe what you observed, when, where, and what you know firsthand."></textarea></label>
<label>Immediate actions taken<textarea name="actions" maxlength="3000" rows="2"></textarea></label>
<button type="submit" class="siu-primary">Submit confidential report</button></form></section>
<section id="siuListPane" hidden><div id="siuList"></div></section>
<section id="siuDetailPane" hidden><button id="siuBack" type="button">← Back to cases</button><div id="siuDetail"></div></section>
</div></dialog>`;
document.body.append(ui);
const open=()=>{e("#siuDialog").showModal();switchTab("report")};
e("#siuLaunch").onclick=open;e("#siuClose").onclick=()=>e("#siuDialog").close();
e("#siuDialog").addEventListener("click",event=>{if(event.target===e("#siuDialog"))e("#siuDialog").close()});
const notice=(msg,error=false)=>{const n=e("#siuNotice");n.textContent=msg;n.className=error?"error":"ok"};
function switchTab(tab){
 e("#siuReportPane").hidden=tab!=="report";e("#siuListPane").hidden=tab==="report";e("#siuDetailPane").hidden=true;
 for(const id of ["Report","Cases","Queue"])e("#siu"+id+"Tab").classList.toggle("active",id.toLowerCase()===(tab==="report"?"report":tab==="queue"?"queue":"cases"));
 if(tab!=="report")loadCases(tab==="queue");
}
e("#siuReportTab").onclick=()=>switchTab("report");e("#siuCasesTab").onclick=()=>switchTab("cases");e("#siuQueueTab").onclick=()=>switchTab("queue");
e("#siuBack").onclick=()=>switchTab(investigator()?"queue":"cases");
e("#siuReportForm").onsubmit=async(ev)=>{
 ev.preventDefault();if(!user||!staff)return notice("Sign in with an approved staff account.",true);
 const b=e("#siuReportForm").querySelector("button[type=submit]");b.disabled=true;
 try{const f=new FormData(ev.target),payload={reporterUid:user.uid,reporterName:staff.name||[staff.firstName,staff.lastName].filter(Boolean).join(" ")||user.email,category:f.get("category"),priority:f.get("priority"),title:f.get("title").trim(),occurredAt:f.get("occurredAt")||"",location:f.get("location").trim(),involved:f.get("involved").trim(),description:f.get("description").trim(),actions:f.get("actions").trim(),status:"open",assignedUid:"",finding:"",resolution:"",createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
 const d=await addDoc(collection(db,"siuCases"),payload);
 await addDoc(collection(db,"siuCases",d.id,"timeline"),{kind:"report",message:"Incident report submitted",actorUid:user.uid,createdAt:serverTimestamp()});
 ev.target.reset();notice("Report submitted. Reference: "+d.id);switchTab("cases");
 }catch(err){notice("Submission failed: "+err.message,true)}finally{b.disabled=false}
};
async function loadCases(all){
 const pane=e("#siuList");pane.textContent="Loading cases…";
 try{const q=all&&investigator()?collection(db,"siuCases"):query(collection(db,"siuCases"),where("reporterUid","==",user.uid));
 const snaps=await getDocs(q);const arr=snaps.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
 pane.replaceChildren();if(!arr.length){pane.textContent="No cases found.";return}
 for(const c of arr){const b=document.createElement("button");b.className="siu-case";b.type="button";b.innerHTML=`<strong>${escape(c.title)}</strong><span>${escape(c.category)} · ${escape(title(c.status))} · ${escape(c.priority)}</span><small>${escape(c.id)}</small>`;b.onclick=()=>showCase(c.id);pane.append(b)}
 }catch(err){pane.textContent="Unable to load cases: "+err.message}
}
async function showCase(id){
 try{const ref=doc(db,"siuCases",id),snap=await getDoc(ref);if(!snap.exists())throw Error("Case not found");
 const c=snap.data();selected=id;e("#siuListPane").hidden=true;e("#siuReportPane").hidden=true;e("#siuDetailPane").hidden=false;
 const root=e("#siuDetail");root.innerHTML=`
 <h3>${escape(c.title)}</h3><p><strong>Case:</strong> ${escape(id)} | <strong>Status:</strong> ${escape(title(c.status))} | <strong>Priority:</strong> ${escape(c.priority)}</p>
 <div class="siu-readout"><p><strong>Category:</strong> ${escape(c.category)}</p><p><strong>Location:</strong> ${escape(c.location)}</p><p><strong>Occurred:</strong> ${escape(c.occurredAt)}</p><p><strong>People involved:</strong> ${escape(c.involved)}</p><p><strong>Incident:</strong></p><p class="siu-pre">${escape(c.description)}</p><p><strong>Initial actions:</strong></p><p class="siu-pre">${escape(c.actions)}</p></div>
 ${investigator()?`<form id="siuManage"><h4>Investigation controls</h4><label>Status<select name="status">${["open","triage","investigating","review","closed"].map(v=>`<option value="${v}" ${c.status===v?"selected":""}>${title(v)}</option>`).join("")}</select></label><label>Assigned investigator UID<input name="assignedUid" value="${escape(c.assignedUid)}" placeholder="UID of approved SIU investigator"></label><label>Finding<select name="finding">${["","substantiated","unsubstantiated","inconclusive","referred","withdrawn"].map(v=>`<option ${c.finding===v?"selected":""}>${v}</option>`).join("")}</select></label><label>Resolution / corrective action<textarea name="resolution" rows="3">${escape(c.resolution)}</textarea></label><button class="siu-primary">Save investigation</button></form><form id="siuNote"><h4>Add investigative note / evidence log</h4><label>Entry type<select name="kind"><option value="note">Investigator note</option><option value="interview">Interview summary</option><option value="evidence">Evidence reference / chain of custody</option><option value="action">Investigative action</option></select></label><label>Details<textarea name="message" maxlength="5000" minlength="5" required rows="3"></textarea></label><button class="siu-primary">Append to case timeline</button></form>`:""}
 <h4>Case activity</h4><div id="siuTimeline">Loading timeline…</div>`;
 if(investigator()){
 e("#siuManage").onsubmit=async ev=>{ev.preventDefault();const f=new FormData(ev.target);try{await updateDoc(ref,{status:f.get("status"),assignedUid:f.get("assignedUid").trim(),finding:f.get("finding"),resolution:f.get("resolution").trim(),updatedAt:serverTimestamp()});await addDoc(collection(ref,"timeline"),{kind:"change",message:"Case workflow updated",actorUid:user.uid,createdAt:serverTimestamp()});notice("Investigation updated");showCase(id)}catch(err){notice(err.message,true)}};
 e("#siuNote").onsubmit=async ev=>{ev.preventDefault();const f=new FormData(ev.target);try{await addDoc(collection(ref,"timeline"),{kind:f.get("kind"),message:f.get("message").trim(),actorUid:user.uid,createdAt:serverTimestamp()});notice("Entry appended to case history");showCase(id)}catch(err){notice(err.message,true)}};
 }
 const logs=await getDocs(collection(ref,"timeline"));const div=e("#siuTimeline");div.replaceChildren();
 const entries=logs.docs.map(x=>x.data()).sort((a,b)=>(a.createdAt?.seconds||0)-(b.createdAt?.seconds||0));if(!entries.length)div.textContent="No activity yet.";
 for(const l of entries){const item=document.createElement("article");item.className="siu-log";item.innerHTML=`<strong>${escape(l.kind)}</strong><small>${escape(l.createdAt?.toDate?.().toLocaleString()||"Recent")}</small><p class="siu-pre">${escape(l.message)}</p>`;div.append(item)}
 }catch(err){notice("Unable to open case: "+err.message,true)}
}
onAuthStateChanged(auth,async u=>{
 user=u;staff=null;e("#siuLaunch").hidden=true;
 if(!u)return;
 try{const d=await getDoc(doc(db,"users",u.uid));if(!d.exists()||d.data().status!=="active")return;staff=d.data();e("#siuLaunch").hidden=false;e("#siuQueueTab").hidden=!investigator()}catch(err){console.warn("SIU staff access check failed",err)}
});
