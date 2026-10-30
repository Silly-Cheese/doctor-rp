import { collection, doc, addDoc, getDocs, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
const esc = x => String(x ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const norm = v => String(v || "").trim().toLowerCase().replace(/\s+/g," ");
const checks = (p, all, encounters) => {
 const missing = [];
 if (!p.dob && p.identityStatus!=="unidentified") missing.push("DOB not entered");
 if (!p.phone && p.identityStatus!=="unidentified") missing.push("Contact number missing");
 if (!p.emergencyContact) missing.push("No emergency contact");
 if (!p.allergies || /^(none documented|unknown)$/i.test(p.allergies)) missing.push("Allergy review needed");
 if (!p.medicalHistory) missing.push("Medical history not documented");
 if (p.identityStatus==="unidentified") missing.push("Identity unresolved — use the emergency identity workflow");
 const dupes = all.filter(other => other.id !== p.id && p.dob && other.dob===p.dob && norm(other.firstName)===norm(p.firstName) && norm(other.lastName)===norm(p.lastName));
 if (dupes.length) missing.push(`Possible duplicate patient: ${dupes.length} matching name/DOB`);
 const active = encounters.filter(e => e.patientId===p.id && e.status!=="discharged");
 if (active.length>1) missing.push(`Data integrity alert: ${active.length} active encounters`);
 if (p.activeEncounterId && !active.some(e=>e.id===p.activeEncounterId)) missing.push("Patient active encounter pointer does not match an open visit");
 return {missing,dupes,score:Math.max(0,100-Math.min(missing.length,6)*15)};
};
export function renderPatientRecordQuality({db,patient,patients,encounters,canFlag,canResolve=false,onNotice}){
 const host=document.getElementById("nmcPatientQuality");
 if(!host)return;
 const quality=checks(patient,patients,encounters);
 host.innerHTML=`<header class="nmc-quality-title"><div><p class="eyebrow">Chart Quality</p><h4>Record integrity & identity</h4></div><span class="nmc-quality-score">Registry check score: ${quality.score}/100</span></header>
 <div class="nmc-quality-items">${quality.missing.length?quality.missing.map(x=>`<div class="nmc-quality-warning"><span aria-hidden="true">!</span><span>${esc(x)}</span></div>`).join(""):'<p class="nmc-quality-good">No missing fields or obvious local conflicts detected. This is not a clinical validation.</p>'}</div>
 ${canFlag&&quality.dupes.length?`<button id="nmcFlagIdentity" type="button" class="secondary-button">Flag possible duplicate for review</button>`:""}
 <div class="nmc-quality-review" id="nmcIdentityReviewHistory"><p class="muted">Loading identity review history…</p></div>`;
 const history=host.querySelector("#nmcIdentityReviewHistory");
 const collectionRef=collection(db,"patients",patient.id,"identityReviews");
 const refresh=async()=>{
  try{
   const result=await getDocs(collectionRef);
   if(!host.isConnected)return;
   const docs=result.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
   history.innerHTML=docs.length?'<details><summary>Identity review history ('+docs.length+')</summary><div id="nmcIdentityCases"></div></details>':'<p class="muted">No identity reviews filed.</p>';
   const cases=history.querySelector("#nmcIdentityCases");
   docs.forEach(d=>{
     const row=document.createElement("div");row.className="nmc-identity-case";
     const label=document.createElement("span");label.textContent=(d.status||"open")+" · "+(d.reason||"Identity review");
     row.append(label);
     if(canResolve&&d.status==="open"){
       for(const status of ["resolved","dismissed"]){
         const btn=document.createElement("button");btn.type="button";btn.className="text-button";btn.textContent=status==="resolved"?"Mark resolved":"Dismiss";
         btn.addEventListener("click",async()=>{
           btn.disabled=true;
           try{
             await updateDoc(doc(db,"patients",patient.id,"identityReviews",d.id),{status});
             onNotice?.("Review marked "+status+". No patient records were merged.");await refresh();
           }catch(error){onNotice?.("Unable to update review status.");btn.disabled=false;}
         });
         row.append(btn);
       }
     }
     cases?.append(row);
   });
  }catch(error){history.innerHTML='<p class="muted">Identity review history unavailable for this staff role.</p>';}
 };
 const btn=host.querySelector("#nmcFlagIdentity");
 btn?.addEventListener("click",async()=>{
  if(!quality.dupes.length)return;
  btn.disabled=true;
  try{
   await addDoc(collectionRef,{patientId:patient.id,candidatePatientIds:quality.dupes.map(p=>p.id).slice(0,10),reason:"Matching full name and date of birth",status:"open",createdAt:serverTimestamp()});
   onNotice?.("Possible duplicate flagged for identity review. Records were not merged.");
   await refresh();
  }catch(error){onNotice?.("Could not flag duplicate: "+(error?.message||"Permission denied"));}finally{btn.disabled=false;}
 });
 refresh();
}