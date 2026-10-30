// Fictional roleplay attachments, stored privately in Firebase Storage.
// Patient master records remain in the original patients collection.
import { collection, doc, getDocs, setDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getBytes } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";
const allowed = ["application/pdf","image/png","image/jpeg","text/plain"];
const maxBytes=5*1024*1024;
const categories=["Intake","Clinical note","Discharge","Referral","Consent","Imaging report","Laboratory report","Other"];
const safe=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const formatBytes=n=>n>=1048576?(n/1048576).toFixed(1)+" MB":Math.max(1,Math.round(n/1024))+" KB";
export function renderAttachmentVault({db,patient,encounters,canEdit,onNotice}){
 const host=document.querySelector("#nmcAttachmentVault");if(!host)return;
 const patientId=patient.id;
 const folder=collection(db,"patients",patientId,"attachments");
 const visitOptions=encounters.filter(e=>e.patientId===patientId).map(e=>`<option value="${safe(e.id)}">${safe(e.chiefComplaint||e.department||"Visit")} · ${safe(e.id.slice(0,8))}</option>`).join("");
 host.innerHTML=`<div class="nmc-record-header"><div><p class="eyebrow">Protected Record Storage</p><h4>Attachment vault</h4><p>Private fictional RP documents. PDFs, JPG, PNG, TXT; 5 MB per file.</p></div>${canEdit?'<button type="button" class="secondary-button" id="nmcUploadToggle">Upload attachment</button>':""}</div>
 <div id="nmcUploadEditor" class="nmc-record-editor hidden"></div>
 <div class="nmc-record-toolbar"><label>Category <select id="nmcAttachmentCategory"><option value="">All categories</option>${categories.map(c=>`<option>${safe(c)}</option>`).join("")}</select></label><label>Search <input id="nmcAttachmentSearch" type="search" placeholder="Search attached files"></label></div>
 <div id="nmcAttachmentList" aria-live="polite"><p class="muted">Loading attachments…</p></div>`;
 const list=host.querySelector("#nmcAttachmentList");
 const editor=host.querySelector("#nmcUploadEditor");
 let files=[],newVersionOf=null;
 if(canEdit){
   host.querySelector("#nmcUploadToggle").addEventListener("click",()=>{newVersionOf=null;editor.classList.toggle("hidden");});
   editor.innerHTML=`<form id="nmcAttachmentForm">
     <div class="nmc-record-fields"><label>Category <select name="category">${categories.map(c=>`<option>${safe(c)}</option>`).join("")}</select></label>
     <label>Encounter <select name="encounterId"><option value="">Longitudinal record</option>${visitOptions}</select></label></div>
     <label>Document title <input name="title" required maxlength="140" placeholder="e.g. Discharge packet"></label>
     <label>File <input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain" required></label>
     <p id="nmcUploadVersionInfo" class="muted">Documents are append-only; archiving keeps historical versions.</p>
     <div class="nmc-record-actions"><button type="button" class="secondary-button" id="nmcUploadCancel">Cancel</button><button type="submit" class="primary-button">Save attachment</button></div><p class="muted">Use fictional RP documents only. Do not upload real patient files.</p>
   </form>`;
   editor.querySelector("#nmcUploadCancel").addEventListener("click",()=>{newVersionOf=null;editor.classList.add("hidden");});
   editor.querySelector("form").addEventListener("submit",async event=>{
     event.preventDefault();
     const form=event.currentTarget,button=form.querySelector('[type="submit"]'),formData=new FormData(form),file=formData.get("file");
     if(!(file instanceof File)||!file.size||file.size>maxBytes||!allowed.includes(file.type)){
       onNotice?.("Choose a PDF, PNG, JPG, or TXT file smaller than 5 MB.");return;
     }
     if(newVersionOf&&newVersionOf.category!==formData.get("category")){
       onNotice?.("Keep the same category when submitting a new version.");return;
     }
     button.disabled=true;button.textContent="Uploading…";
     const reference=doc(folder),filePath=`rp-patient-documents/${patientId}/${reference.id}/file`;
     let uploaded=false;
     try{
       const storageRef=ref(getStorage(),filePath);
       await uploadBytes(storageRef,file,{contentType:file.type});uploaded=true;
       await setDoc(reference,{
         patientId,category:String(formData.get("category")),encounterId:String(formData.get("encounterId")||""),
         title:String(formData.get("title")||"").trim(),fileName:file.name.slice(0,180),
         mimeType:file.type,fileSize:file.size,storagePath:filePath,status:"active",
         version:newVersionOf?(Number(newVersionOf.version)||1)+1:1,
         supersedesId:newVersionOf?.id||"",createdAt:serverTimestamp(),updatedAt:serverTimestamp()
       });
       newVersionOf=null;form.reset();editor.classList.add("hidden");
       onNotice?.("Attachment stored in the patient record.");await refresh();
     }catch(error){
       onNotice?.((uploaded?"Upload completed but record indexing failed; contact an administrator. ":"Upload failed. ")+(error?.message||"Please check storage permissions."));
     }finally{button.disabled=false;button.textContent="Save attachment";}
   });
 }
 const draw=()=>{
   const cat=host.querySelector("#nmcAttachmentCategory").value;
   const needle=host.querySelector("#nmcAttachmentSearch").value.toLowerCase().trim();
   const visible=files.filter(d=>(!cat||d.category===cat)&&(!needle||(`${d.title} ${d.fileName}`).toLowerCase().includes(needle)));
   list.innerHTML=visible.length?visible.map(d=>{
     const hasNewer=files.some(x=>x.supersedesId===d.id);
     return `<article class="nmc-record-item ${d.status==="archived"?"is-archived":""}">
       <div class="nmc-record-item-head"><div><strong>${safe(d.title)}</strong><p>${safe(d.category)} · ${safe(d.fileName)} · ${formatBytes(d.fileSize||0)} · v${Number(d.version)||1}${hasNewer?" · Earlier version":""}</p></div><span class="nmc-record-tag">${safe(d.status||"active")}</span></div>
       <div class="nmc-record-actions"><button type="button" class="secondary-button" data-nmc-download="${safe(d.id)}">Download</button>
       ${canEdit&&d.status!=="archived"?`<button type="button" class="secondary-button" data-nmc-version="${safe(d.id)}">New version</button><button type="button" class="text-button" data-nmc-archive-attachment="${safe(d.id)}">Archive</button>`:""}</div>
     </article>`;
   }).join(""):'<div class="chart-empty"><p>No attachments found.</p></div>';
   list.querySelectorAll("[data-nmc-download]").forEach(btn=>btn.addEventListener("click",async()=>{
     const record=files.find(d=>d.id===btn.dataset.nmcDownload);if(!record)return;
     btn.disabled=true;btn.textContent="Opening…";
     try{
       const bytes=await getBytes(ref(getStorage(),record.storagePath),maxBytes);
       const url=URL.createObjectURL(new Blob([bytes],{type:record.mimeType}));
       const a=document.createElement("a");a.href=url;a.download=record.fileName||"document";
       document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
     }catch(error){onNotice?.("Unable to retrieve attachment. Check storage access and bucket configuration.");}
     finally{btn.disabled=false;btn.textContent="Download";}
   }));
   list.querySelectorAll("[data-nmc-version]").forEach(btn=>btn.addEventListener("click",()=>{
     const d=files.find(x=>x.id===btn.dataset.nmcVersion);if(!d||!canEdit)return;
     newVersionOf=d;
     const form=editor.querySelector("form");
     form.reset();form.querySelector('[name="title"]').value=d.title||"";
     form.querySelector('[name="category"]').value=d.category||"Other";
     form.querySelector('[name="encounterId"]').value=d.encounterId||"";
     editor.querySelector("#nmcUploadVersionInfo").textContent=`Creating v${(Number(d.version)||1)+1} of ${d.fileName}. The previous version will remain available.`;
     editor.classList.remove("hidden");editor.scrollIntoView({behavior:"smooth",block:"nearest"});
   }));
   list.querySelectorAll("[data-nmc-archive-attachment]").forEach(btn=>btn.addEventListener("click",async()=>{
     if(!window.confirm("Archive attachment metadata? The stored file remains preserved."))return;
     btn.disabled=true;
     try{await updateDoc(doc(folder,btn.dataset.nmcArchiveAttachment),{status:"archived",updatedAt:serverTimestamp()});await refresh();onNotice?.("Attachment archived.");}
     catch(error){btn.disabled=false;onNotice?.("Could not archive attachment.");}
   }));
 };
 const refresh=async()=>{
   try{
     const result=await getDocs(folder);if(!host.isConnected)return;
     files=result.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
     draw();
   }catch(error){list.innerHTML='<div class="chart-empty"><p>Attachment vault unavailable. Check Storage and Firestore permissions.</p></div>';}
 };
 host.querySelector("#nmcAttachmentCategory").addEventListener("change",draw);
 host.querySelector("#nmcAttachmentSearch").addEventListener("input",draw);
 refresh();
}