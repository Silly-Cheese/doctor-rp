// Northstar structured medical-record repository. Fictional RP text metadata only.
// Stored under the established patient master record; no duplicate patient collection.
import { collection, doc, setDoc, getDocs, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const CATEGORIES = ["Intake","Clinical note","Discharge","Referral","Consent","Imaging report","Laboratory report","Other"];
const esc = v => String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const documentPath = (db, patientId) => collection(db,"patients",patientId,"recordDocuments");
const dateLabel = value => {
  const d = value?.toDate?.();
  return d ? d.toLocaleString() : "Recently";
};
export function renderRecordWorkspace({db,patientId,encounters,canEdit,onNotice}) {
  const host=document.getElementById("nmcRecordWorkspace");
  if (!host) return;
  const scopedEncounters=encounters.filter(e=>e.patientId===patientId);
  const options=scopedEncounters.map(e=>`<option value="${esc(e.id)}">${esc(e.chiefComplaint || e.department || "Visit")} — ${esc(e.id.slice(0,9))}</option>`).join("");
  host.innerHTML=`<div class="nmc-record-header"><div><p class="eyebrow">Unified Medical Record</p><h4>Document repository</h4><p>Structured records linked to this patient and their encounters.</p></div>${canEdit?'<button type="button" class="secondary-button" id="nmcNewRecord">Add record</button>':""}</div>
  <div id="nmcRecordEditor" class="nmc-record-editor hidden"></div>
  <div class="nmc-record-toolbar"><label>Category <select id="nmcRecordFilter"><option value="">All categories</option>${CATEGORIES.map(c=>`<option>${esc(c)}</option>`).join("")}</select></label><label>Search <input type="search" id="nmcRecordSearch" placeholder="Find a title or note"></label></div>
  <div id="nmcRecordList" aria-live="polite"><p class="muted">Loading medical records…</p></div>`;
  const editor=host.querySelector("#nmcRecordEditor");
  let amendmentParent=null;
  if (canEdit) {
    host.querySelector("#nmcNewRecord").addEventListener("click",()=>{amendmentParent=null;editor.classList.toggle("hidden");});
    editor.innerHTML=`<form id="nmcRecordForm">
      <div class="nmc-record-fields"><label>Category<select name="category" required>${CATEGORIES.map(c=>`<option>${esc(c)}</option>`).join("")}</select></label>
      <label>Encounter<select name="encounterId"><option value="">Longitudinal / not encounter-specific</option>${options}</select></label></div>
      <label>Record title<input name="title" required maxlength="140" placeholder="e.g. Visit summary"></label>
      <label>Document / clinical narrative<textarea name="body" required minlength="3" maxlength="12000" rows="5" placeholder="Enter fictional RP document text"></textarea></label>
      <div class="nmc-record-actions"><button type="button" class="secondary-button" id="nmcCancelRecord">Cancel</button><button type="submit" class="primary-button">Save record</button></div>
      <p class="muted">Records are archived instead of deleted. Do not enter real patient information in this RP system.</p>
    </form>`;

    const summaryButton=document.createElement("button");
    summaryButton.type="button";summaryButton.className="secondary-button";summaryButton.textContent="Draft visit summary";
    host.querySelector(".nmc-record-header").append(summaryButton);
    summaryButton.addEventListener("click",()=>{
      const latest=[...scopedEncounters].sort((a,b)=>(b.arrivalAt?.seconds||0)-(a.arrivalAt?.seconds||0))[0];
      if(!latest){onNotice?.("No patient visits found to summarize.");return;}
      amendmentParent=null;
      const form=editor.querySelector("form");form.reset();
      form.querySelector('[name="category"]').value=latest.status==="discharged"?"Discharge":"Clinical note";
      form.querySelector('[name="encounterId"]').value=latest.id;
      form.querySelector('[name="title"]').value="Visit summary";
      form.querySelector('[name="body"]').value=[
        "DRAFT FOR REVIEW — fictional RP chart",
        "Department: "+(latest.department||"Unspecified"),
        "Reason for visit: "+(latest.chiefComplaint||"Not recorded"),
        "Arrival: "+dateLabel(latest.arrivalAt),
        "Status: "+(latest.status||"Unknown"),
        "Final diagnosis: "+(latest.finalDiagnosis||"Not documented"),
        "Disposition: "+(latest.disposition||"Not documented"),
        "Discharge instructions: "+(latest.dischargeInstructions||"Not documented")
      ].join("\n");
      editor.classList.remove("hidden");
      editor.scrollIntoView({behavior:"smooth",block:"nearest"});
    });
    editor.querySelector("#nmcCancelRecord").addEventListener("click",()=>{amendmentParent=null;editor.classList.add("hidden");});
    editor.querySelector("form").addEventListener("submit",async event=>{
      event.preventDefault();
      const form=event.currentTarget; const data=new FormData(form);const submit=form.querySelector('[type="submit"]');
      submit.disabled=true;
      try {
        const parent=amendmentParent;
        if(parent&&(parent.category!==data.get("category")||(parent.encounterId||"")!==(data.get("encounterId")||"")))
          throw new Error("An amendment must retain the same category and encounter.");
        const recordRef=doc(documentPath(db,patientId));
        await setDoc(recordRef,{
          patientId, category:data.get("category"),encounterId:data.get("encounterId")||"",
          title:String(data.get("title")||"").trim(),body:String(data.get("body")||"").trim(),
          status:"active",version:parent?(Number(parent.version)||1)+1:1,amendsId:parent?.id||"",createdAt:serverTimestamp(),updatedAt:serverTimestamp()
        });
        amendmentParent=null;form.reset();editor.classList.add("hidden");onNotice?.("Medical record saved. Prior versions remain available.");await refresh();
      } catch(error){onNotice?.("Unable to save record: "+(error?.message||"permission denied"));}
      finally {submit.disabled=false;}
    });
  }
  let docs=[];
  const list=host.querySelector("#nmcRecordList");
  const draw=()=>{
    const category=host.querySelector("#nmcRecordFilter").value;
    const term=host.querySelector("#nmcRecordSearch").value.trim().toLowerCase();
    const matches=docs.filter(d=>(!category||d.category===category)&&(!term||`${d.title} ${d.body}`.toLowerCase().includes(term)));
    list.innerHTML=matches.length?matches.map(d=>`<article class="nmc-record-item${d.status==="archived"?" is-archived":""}">
      <div class="nmc-record-item-head"><div><strong>${esc(d.title)}</strong><p>${esc(d.category)} · ${d.encounterId?"Linked encounter":"Longitudinal"} · ${esc(dateLabel(d.createdAt))}</p></div><span class="nmc-record-tag">${esc(d.status==="archived"?"Archived":"Active")}</span></div>
      <details><summary>View document</summary><p class="nmc-record-body">${esc(d.body)}</p></details>
      ${canEdit&&d.status!=="archived"?`<button type="button" class="text-button" data-archive-record="${esc(d.id)}">Archive record</button>`:""}
      </article>`).join(""):'<div class="chart-empty"><p>No documents match this selection.</p></div>';

    // Append-only amendments and plain text exports keep original records intact.
    [...list.querySelectorAll(".nmc-record-item")].forEach((container,index)=>{
      const item=matches[index];
      if(!item)return;
      const exportBtn=document.createElement("button");
      exportBtn.type="button";exportBtn.className="text-button";exportBtn.textContent="Export TXT";
      exportBtn.addEventListener("click",()=>{
        const content=[item.title,"Category: "+item.category,"Version: "+(item.version||1),"",""+item.body].join("\n");
        const blob=new Blob([content],{type:"text/plain;charset=utf-8"});
        const url=URL.createObjectURL(blob),a=document.createElement("a");
        a.href=url;a.download="Northstar-"+(item.title||"record").replace(/[^a-z0-9_-]/gi,"_").slice(0,55)+".txt";
        document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      });
      container.append(exportBtn);
      if(!canEdit||item.status==="archived")return;
      const amendBtn=document.createElement("button");
      amendBtn.type="button";amendBtn.className="text-button";amendBtn.textContent="Add amendment (v"+((Number(item.version)||1)+1)+")";
      amendBtn.addEventListener("click",()=>{
        amendmentParent=item;
        const form=editor.querySelector("form");form.reset();
        form.querySelector('[name="title"]').value=item.title;
        form.querySelector('[name="category"]').value=item.category;
        form.querySelector('[name="encounterId"]').value=item.encounterId||"";
        form.querySelector('[name="body"]').value="Amendment to version "+(item.version||1)+":\n";
        editor.classList.remove("hidden");
        editor.scrollIntoView({behavior:"smooth",block:"nearest"});
      });
      container.append(amendBtn);
    });
    list.querySelectorAll("[data-archive-record]").forEach(button=>button.addEventListener("click",async()=>{
      if(!window.confirm("Archive this document? It will remain in the record history."))return;
      button.disabled=true;
      try{await updateDoc(doc(db,"patients",patientId,"recordDocuments",button.dataset.archiveRecord),{status:"archived",updatedAt:serverTimestamp()});onNotice?.("Record archived.");await refresh();}
      catch(error){onNotice?.("Archive failed: "+(error?.message||"permission denied"));button.disabled=false;}
    }));
  };
  const refresh=async()=>{
    try{
      const snapshot=await getDocs(documentPath(db,patientId));
      if(!host.isConnected)return;
      docs=snapshot.docs.map(item=>({id:item.id,...item.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
      draw();
    }catch(error){list.innerHTML='<div class="chart-empty"><p>Records could not be loaded. Check your access permissions.</p></div>';}
  };
  host.querySelector("#nmcRecordFilter").addEventListener("change",draw);
  host.querySelector("#nmcRecordSearch").addEventListener("input",draw);
  refresh();
}
