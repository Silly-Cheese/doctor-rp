import { getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);

const state = {
  profile: null,
  patients: [], encounters: [], orders: [], results: [], notes: [], addenda: [], observations: [], administrations: [], tasks: [],
  selectedPatientId: null, selectedEncounterId: null, selectedNoteId: null, unsubscribers: [], cameraStream: null, scanLoop: 0, renderQueued: false,
  orderSearch: ""
};

const CATALOG = [
  { name: "CBC with Differential", category: "laboratory", priority: "routine", instructions: "Complete blood count with differential" },
  { name: "Comprehensive Metabolic Panel", category: "laboratory", priority: "routine", instructions: "CMP" },
  { name: "Troponin", category: "laboratory", priority: "urgent", instructions: "Cardiac biomarker" },
  { name: "Lactate", category: "laboratory", priority: "urgent", instructions: "Serum lactate" },
  { name: "Blood Cultures", category: "laboratory", priority: "urgent", instructions: "Two sets before antibiotics when possible" },
  { name: "12-Lead ECG", category: "procedure", priority: "stat", instructions: "Obtain and route for provider review" },
  { name: "Chest X-Ray — 2 Views", category: "imaging", priority: "routine", instructions: "PA and lateral chest radiographs" },
  { name: "CT Head without Contrast", category: "imaging", priority: "urgent", instructions: "Noncontrast CT head" },
  { name: "CT Abdomen/Pelvis with Contrast", category: "imaging", priority: "urgent", instructions: "CT abdomen and pelvis with IV contrast" },
  { name: "Telemetry", category: "monitoring", priority: "routine", instructions: "Continuous cardiac monitoring" },
  { name: "Oxygen", category: "monitoring", priority: "urgent", instructions: "Titrate for roleplay target saturation" },
  { name: "Normal Saline", category: "medication", priority: "routine", dose: "1000 mL", route: "IV", frequency: "Once", instructions: "IV fluid bolus" },
  { name: "Aspirin", category: "medication", priority: "stat", dose: "324 mg", route: "PO", frequency: "Once", instructions: "Chewable" },
  { name: "Acetaminophen", category: "medication", priority: "routine", dose: "650 mg", route: "PO", frequency: "PRN", instructions: "Pain or fever" },
  { name: "Ondansetron", category: "medication", priority: "routine", dose: "4 mg", route: "IV", frequency: "PRN", instructions: "Nausea" },
  { name: "Albuterol", category: "medication", priority: "urgent", dose: "2.5 mg", route: "Inhaled", frequency: "Once", instructions: "Nebulized treatment" },
  { name: "NPO", category: "other", priority: "routine", instructions: "Nothing by mouth" },
  { name: "Fall Precautions", category: "other", priority: "routine", instructions: "Institute fall-risk precautions" }
];

const ORDER_SETS = {
  "Chest Pain — ED": ["12-Lead ECG", "Troponin", "CBC with Differential", "Comprehensive Metabolic Panel", "Chest X-Ray — 2 Views", "Telemetry", "Aspirin"],
  "Trauma — Initial": ["CBC with Differential", "Comprehensive Metabolic Panel", "Chest X-Ray — 2 Views", "Normal Saline", "NPO"],
  "Respiratory Distress": ["Chest X-Ray — 2 Views", "12-Lead ECG", "Oxygen", "Albuterol", "CBC with Differential", "Comprehensive Metabolic Panel"],
  "Abdominal Pain": ["CBC with Differential", "Comprehensive Metabolic Panel", "CT Abdomen/Pelvis with Contrast", "Ondansetron", "Normal Saline", "NPO"]
};

function safe(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function toDate(value) { if (!value) return null; if (typeof value.toDate === "function") return value.toDate(); if (typeof value.seconds === "number") return new Date(value.seconds * 1000); const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; }
function timeValue(value) { return toDate(value)?.getTime() || 0; }
function formatDateTime(value) { const d = toDate(value); return d ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d) : "—"; }
function label(value) { return String(value || "").replaceAll("-", " ").replace(/\b\w/g, c => c.toUpperCase()); }
function patientById(id) { return state.patients.find(x => x.id === id) || null; }
function encounterById(id) { return state.encounters.find(x => x.id === id) || null; }
function activeEncounterForPatient(id) { return state.encounters.filter(e => e.patientId === id && e.status !== "discharged").sort((a,b) => timeValue(b.arrivalAt) - timeValue(a.arrivalAt))[0] || null; }
function isAdmin() { return state.profile?.role === "administrator"; }
function isProvider() { return ["administrator","physician"].includes(state.profile?.role) && state.profile?.permissions?.providerActions !== false; }
function isNurse() { return ["administrator","nurse"].includes(state.profile?.role) && state.profile?.permissions?.nursingActions !== false; }
function canWristband() { return state.profile?.role === "administrator" || state.profile?.permissions?.printWristbands !== false && ["physician","nurse","registration"].includes(state.profile?.role); }
function showToast(message) { const toast = document.querySelector("#toast"); if (!toast) return; toast.textContent = message; toast.classList.add("show"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 3000); }

function ensureStyles() {
  if (document.querySelector('link[href="northstar-clinical-plus.css"]')) return;
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = "northstar-clinical-plus.css"; document.head.appendChild(link);
}

function injectAdvancedClinical() {
  if (document.querySelector("#northstarMarSection")) return;
  ensureStyles();
  const nav = document.querySelector(".nav-list");
  const resultsNav = nav?.querySelector('[data-section="results"]');
  const marNav = document.createElement("button");
  marNav.type = "button"; marNav.className = "nav-item"; marNav.dataset.northstarClinical = "mar"; marNav.innerHTML = "<span>Rx</span> Medication Administration";
  if (resultsNav) resultsNav.after(marNav); else nav?.appendChild(marNav);
  const main = document.querySelector("main.content");
  const staffSection = document.querySelector("#staffSection");
  const mar = document.createElement("section");
  mar.id = "northstarMarSection"; mar.className = "content-section hidden";
  if (staffSection) main.insertBefore(mar, staffSection); else main?.appendChild(mar);

  const topbar = document.querySelector(".topbar-actions");
  if (topbar && !document.querySelector("#scanWristbandButton")) {
    const scan = document.createElement("button"); scan.id = "scanWristbandButton"; scan.type = "button"; scan.className = "secondary-button compact scan-wristband-button"; scan.textContent = "Scan Wristband"; topbar.prepend(scan);
  }
  injectDialogs();
  bindEvents();
}

function injectDialogs() {
  if (document.querySelector("#orderCatalogDialog")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <dialog id="orderCatalogDialog" class="clinical-plus-dialog">
      <div class="clinical-plus-card">
        <div class="modal-header"><div><p class="eyebrow">Computerized Provider Order Entry</p><h3>Order Catalog</h3></div><button class="icon-button" type="button" data-close-plus="orderCatalogDialog">×</button></div>
        <div class="order-catalog-body">
          <div id="orderCatalogPatient" class="patient-context"></div>
          <div class="order-catalog-search"><span>⌕</span><input id="orderCatalogSearch" type="search" placeholder="Search orders"></div>
          <div class="order-set-strip">${Object.keys(ORDER_SETS).map(name => `<button type="button" data-order-set="${safe(name)}">${safe(name)}</button>`).join("")}</div>
          <div id="orderCatalogList" class="order-catalog-list"></div>
        </div>
      </div>
    </dialog>

    <dialog id="wristbandScannerDialog" class="modal">
      <div class="modal-card">
        <div class="modal-header"><div><p class="eyebrow">Patient Identification</p><h3>Scan Patient Wristband</h3></div><button class="icon-button" type="button" data-close-plus="wristbandScannerDialog">×</button></div>
        <div class="modal-body scanner-body"><video id="wristbandVideo" playsinline muted></video><div id="scannerStatus" class="scanner-status">Camera scanning is available when supported by this browser.</div><div class="scanner-manual"><label><span>MRN</span><input id="manualScanMrn" placeholder="NMC-100001"></label><button id="manualScanButton" class="primary-button" type="button">Open Patient</button></div></div>
      </div>
    </dialog>

    <dialog id="identitySafetyDialog" class="modal">
      <form id="identitySafetyForm" class="modal-card">
        <div class="modal-header"><div><p class="eyebrow">Patient Identity & Safety</p><h3 id="identitySafetyTitle">Patient Profile</h3></div><button class="icon-button" type="button" data-close-plus="identitySafetyDialog">×</button></div>
        <div class="modal-body form-grid">
          <label><span>Alias / previous name</span><input id="identityAlias"></label>
          <div class="field-row"><label><span>Code status</span><select id="identityCodeStatus"><option>Full Code</option><option>DNR</option><option>DNI</option><option>Comfort Measures</option><option>Unknown</option></select></label><label><span>Primary physician</span><input id="identityPrimaryPhysician"></label></div>
          <label><span>Preferred pharmacy</span><input id="identityPharmacy"></label>
          <label><span>Patient alerts</span><textarea id="identityAlerts" rows="3" placeholder="Fall risk, isolation, safety alerts"></textarea></label>
          <label><span>Advance directives</span><textarea id="identityDirectives" rows="3"></textarea></label>
        </div>
        <div class="modal-footer"><button class="secondary-button" type="button" data-close-plus="identitySafetyDialog">Cancel</button><button class="primary-button" type="submit">Save Identity & Safety</button></div>
      </form>
    </dialog>

    <dialog id="addendumDialog" class="modal">
      <form id="addendumForm" class="modal-card">
        <div class="modal-header"><div><p class="eyebrow">Medical Record Amendment</p><h3>Add Note Addendum</h3></div><button class="icon-button" type="button" data-close-plus="addendumDialog">×</button></div>
        <div class="modal-body form-grid"><div id="addendumContext" class="patient-context"></div><label><span>Addendum</span><textarea id="addendumText" required rows="6" placeholder="Correction, clarification, or additional information"></textarea></label><p class="form-note">The original signed note remains unchanged.</p></div>
        <div class="modal-footer"><button class="secondary-button" type="button" data-close-plus="addendumDialog">Cancel</button><button class="primary-button" type="submit">Sign Addendum</button></div>
      </form>
    </dialog>`);
  document.querySelectorAll("[data-close-plus]").forEach(b => b.addEventListener("click", () => { if (b.dataset.closePlus === "wristbandScannerDialog") stopScanner(); document.querySelector(`#${b.dataset.closePlus}`)?.close(); }));
  document.querySelector("#identitySafetyForm")?.addEventListener("submit", saveIdentitySafety);
  document.querySelector("#addendumForm")?.addEventListener("submit", saveAddendum);
}

function openMar() {
  document.querySelectorAll(".content-section").forEach(s => s.classList.add("hidden"));
  document.querySelector("#northstarMarSection")?.classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.querySelector('[data-northstar-clinical="mar"]')?.classList.add("active");
  const title = document.querySelector("#pageTitle"); if (title) title.textContent = "Medication Administration";
  document.querySelector(".sidebar")?.classList.remove("open");
  renderMar();
}

function medicationOrders() { return state.orders.filter(o => o.category === "medication" && !["cancelled"].includes(o.status)).sort((a,b) => dueTime(a) - dueTime(b)); }
function dueTime(order) { return timeValue(order.dueAt) || timeValue(order.createdAt); }
function medState(order) {
  if (["administered","complete"].includes(order.status)) return "given";
  if (order.status === "held") return "held";
  if (order.status === "refused") return "refused";
  const due = dueTime(order); if (!due) return "due"; const delta = due - Date.now();
  if (delta < -60_000) return "overdue"; if (delta <= 15 * 60_000) return "due"; if (delta <= 45 * 60_000) return "due-soon"; return "scheduled";
}

function renderMar() {
  const target = document.querySelector("#northstarMarSection"); if (!target || !state.profile) return;
  const meds = medicationOrders();
  target.innerHTML = `<div class="section-heading"><div><p class="eyebrow">Medication Administration Record</p><h3>MAR</h3><p>Scheduled, due, overdue, held, refused, and completed medication orders.</p></div></div>
    <div class="mar-metrics"><article><span>Overdue</span><strong>${meds.filter(m => medState(m) === "overdue").length}</strong></article><article><span>Due</span><strong>${meds.filter(m => medState(m) === "due").length}</strong></article><article><span>Due Soon</span><strong>${meds.filter(m => medState(m) === "due-soon").length}</strong></article><article><span>Completed</span><strong>${meds.filter(m => medState(m) === "given").length}</strong></article></div>
    <div class="platform-panel">${meds.length ? `<div class="mar-list">${meds.map(marRow).join("")}</div>` : '<div class="platform-empty"><strong>No medication orders</strong><p>Medication orders will appear here after a provider signs them.</p></div>'}</div>`;
}

function marRow(order) {
  const encounter = encounterById(order.encounterId); const patient = patientById(order.patientId); const status = medState(order);
  return `<article class="mar-row ${safe(status)}"><div class="mar-status"><span>${safe(label(status))}</span><small>${safe(formatDateTime(order.dueAt || order.createdAt))}</small></div><div class="mar-med"><strong>${safe(order.name)}</strong><span>${safe(order.dose || "Dose not specified")} · ${safe(order.route || "Route not specified")} · ${safe(order.frequency || "No frequency")}</span><small>${safe(order.instructions || "")}</small></div><button class="mar-patient" type="button" data-plus-patient="${safe(order.patientId)}"><strong>${safe(order.patientName || `${patient?.lastName || ""}, ${patient?.firstName || ""}`)}</strong><span>${safe(encounter?.room || order.mrn || "")}</span></button>${isNurse() && !["given","held","refused"].includes(status) ? `<div class="mar-actions"><button type="button" class="primary-button compact" data-mar-give="${safe(order.id)}">Give</button><button type="button" class="secondary-button compact" data-mar-hold="${safe(order.id)}">Hold</button><button type="button" class="secondary-button compact" data-mar-refuse="${safe(order.id)}">Refused</button></div>` : `<div class="mar-done">${safe(label(status))}</div>`}</article>`;
}

async function marAction(orderId, action) {
  const order = state.orders.find(o => o.id === orderId); if (!order || !isNurse()) return;
  const patient = patientById(order.patientId);
  try {
    const batch = writeBatch(db);
    if (action === "give") {
      const adminRef = doc(collection(db, "medicationAdministrations"));
      batch.set(adminRef, { orderId: order.id, encounterId: order.encounterId, patientId: order.patientId, medicationName: order.name, dose: order.dose || "", route: order.route || "", note: "Medication administered from MAR", administeredBy: auth.currentUser.uid, administeredByName: state.profile.displayName, administeredAt: serverTimestamp(), patientVerified: true, allergyVerified: true });
      batch.update(doc(db, "orders", order.id), { status: "administered", completedAt: serverTimestamp(), completedBy: auth.currentUser.uid });
      if (/morphine|fentanyl|hydromorphone|oxycodone/i.test(order.name)) {
        const taskRef = doc(collection(db, "tasks"));
        batch.set(taskRef, { encounterId: order.encounterId, patientId: order.patientId, patientName: order.patientName || patient?.displayName || "", mrn: order.mrn || patient?.mrn || "", room: encounterById(order.encounterId)?.room || "", title: "Pain reassessment after analgesic", priority: "routine", details: `Reassess pain after ${order.name}`, assigneeUid: auth.currentUser.uid, assigneeName: state.profile.displayName, dueAt: new Date(Date.now() + 30 * 60_000), status: "open", createdBy: auth.currentUser.uid, createdByName: state.profile.displayName, createdAt: serverTimestamp() });
      }
    } else {
      batch.update(doc(db, "orders", order.id), { status: action === "hold" ? "held" : "refused", statusUpdatedAt: serverTimestamp(), statusUpdatedBy: auth.currentUser.uid });
    }
    batch.set(doc(collection(db, "auditEvents")), { type: action === "give" ? "medication-administered" : `medication-${action === "hold" ? "held" : "refused"}`, orderId: order.id, encounterId: order.encounterId, patientId: order.patientId, actorUid: auth.currentUser.uid, actorName: state.profile.displayName, at: serverTimestamp() });
    await batch.commit(); showToast(action === "give" ? "Medication administered." : action === "hold" ? "Medication held." : "Medication refusal documented.");
  } catch (_) { showToast("Unable to update the medication record."); }
}

function currentChartPatient() {
  const body = document.querySelector("#patientChartBody"); if (!body) return null;
  if (state.selectedPatientId && patientById(state.selectedPatientId)) return patientById(state.selectedPatientId);
  const text = body.textContent || ""; const p = state.patients.find(x => x.mrn && text.includes(x.mrn)) || null; if (p) state.selectedPatientId = p.id; return p;
}

function enhanceChart() {
  const dialog = document.querySelector("#patientChartDialog"); const body = document.querySelector("#patientChartBody"); if (!dialog?.open || !body || !state.profile) return;
  const patient = currentChartPatient(); if (!patient) return; state.selectedPatientId = patient.id;
  const bannerActions = body.querySelector(".chart-actions");
  if (bannerActions) {
    if (canWristband() && !bannerActions.querySelector("[data-print-wristband]")) {
      bannerActions.insertAdjacentHTML("afterbegin", `<button class="secondary-button" type="button" data-print-wristband="${safe(patient.id)}">Print Wristband</button>`);
    }
    if (!bannerActions.querySelector("[data-identity-safety]")) {
      bannerActions.insertAdjacentHTML("afterbegin", `<button class="secondary-button" type="button" data-identity-safety="${safe(patient.id)}">Identity & Safety</button>`);
    }
    const active = activeEncounterForPatient(patient.id);
    if (active && isProvider() && !bannerActions.querySelector(`[data-order-catalog="${CSS.escape(active.id)}"]`)) {
      bannerActions.insertAdjacentHTML("beforeend", `<button class="secondary-button" type="button" data-order-catalog="${safe(active.id)}">Order Catalog</button>`);
    }
    const identityButtons = [...bannerActions.querySelectorAll("[data-identity-safety]")];
    identityButtons.slice(1).forEach(button => button.remove());
    const wristbandButtons = [...bannerActions.querySelectorAll("[data-print-wristband]")];
    wristbandButtons.slice(1).forEach(button => button.remove());
  }
  renderIdentityPanel(body, patient);
  renderVitalsTrend(body, patient);
  renderDocumentation(body, patient);
  if (patient.currentStatus === "merged" || patient.vitalStatus === "merged") {
    let warning = body.querySelector("#mergedRecordWarning"); if (!warning) { warning = document.createElement("div"); warning.id = "mergedRecordWarning"; warning.className = "merged-record-warning"; body.prepend(warning); }
    warning.innerHTML = `<strong>MERGED RECORD</strong><span>This record was merged into another Northstar patient record and should not be used for new encounters.</span>`;
  }
}

function renderIdentityPanel(body, patient) {
  let panel = body.querySelector("#identitySafetyPanel"); if (!panel) { panel = document.createElement("section"); panel.id = "identitySafetyPanel"; panel.className = "chart-section identity-safety-panel"; const grid = body.querySelector(".chart-grid"); grid?.after(panel); }
  const alerts = patient.patientAlerts || "None documented";
  const duplicate = state.patients.find(p => p.id !== patient.id && p.currentStatus !== "merged" && p.dob === patient.dob && (`${p.firstName} ${p.lastName}`.toLowerCase() === `${patient.firstName} ${patient.lastName}`.toLowerCase() || p.lastName?.toLowerCase() === patient.lastName?.toLowerCase()));
  const signature = JSON.stringify([patient.id, patient.alias || "", patient.codeStatus || "Full Code", patient.primaryPhysician || "", patient.preferredPharmacy || "", alerts, patient.advanceDirectives || "", Boolean(patient.confidentialFlag), duplicate?.id || "", isAdmin()]);
  if (panel.dataset.signature === signature) return;
  panel.dataset.signature = signature;
  panel.innerHTML = `<div class="chart-section-title identity-title"><div><p class="eyebrow">Identity & Safety</p><h4>Patient Safety Profile</h4></div><div class="identity-badges"><span class="code-status">${safe(patient.codeStatus || "Full Code")}</span>${patient.confidentialFlag ? '<span class="identity-alert">Restricted</span>' : ""}</div></div><div class="identity-grid"><div><span>Alias / Previous Name</span><strong>${safe(patient.alias || "None")}</strong></div><div><span>Primary Physician</span><strong>${safe(patient.primaryPhysician || "Not assigned")}</strong></div><div><span>Preferred Pharmacy</span><strong>${safe(patient.preferredPharmacy || "Not documented")}</strong></div><div class="identity-alert-cell"><span>Patient Alerts</span><strong>${safe(alerts)}</strong></div><div class="identity-wide"><span>Advance Directives</span><strong>${safe(patient.advanceDirectives || "None documented")}</strong></div></div>${duplicate && isAdmin() ? `<div class="duplicate-warning"><div><strong>Possible duplicate record</strong><span>${safe(duplicate.lastName)}, ${safe(duplicate.firstName)} · ${safe(duplicate.mrn)}</span></div><button type="button" class="secondary-button compact" data-merge-records="${safe(patient.id)}" data-merge-target="${safe(duplicate.id)}">Merge Into ${safe(duplicate.mrn)}</button></div>` : ""}`;
}

function trendPoints(patientId) {
  const points = [];
  state.encounters.filter(e => e.patientId === patientId).forEach(e => {
    const t = e.triage || {}; if (e.triagedAt || t.completedAt || e.arrivalAt) points.push({ at: timeValue(e.triagedAt || t.completedAt || e.arrivalAt), hr: Number(t.heartRate || 0), spo2: Number(t.spo2 || 0), rr: Number(t.respirations || 0), temp: Number(t.temperature || 0), pain: Number(t.pain || 0) });
  });
  state.observations.filter(o => o.patientId === patientId).forEach(o => { const v = o.vitals || {}; points.push({ at: timeValue(o.createdAt), hr: Number(v.heartRate || 0), spo2: Number(v.spo2 || 0), rr: Number(v.respirations || 0), temp: Number(v.temperature || 0), pain: Number(o.pain || 0) }); });
  return points.filter(p => p.at).sort((a,b) => a.at - b.at).slice(-12);
}

function sparkline(values, minOverride = null, maxOverride = null) {
  const clean = values.map(Number).filter(v => Number.isFinite(v) && v !== 0); if (clean.length < 2) return '<div class="trend-empty">Not enough data</div>';
  const min = minOverride ?? Math.min(...clean); const max = maxOverride ?? Math.max(...clean); const span = Math.max(1, max - min);
  const pts = clean.map((v,i) => `${(i/(clean.length-1))*100},${42-((v-min)/span)*34}`).join(" ");
  return `<svg class="trend-svg" viewBox="0 0 100 46" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="trend-last">Latest <strong>${safe(clean.at(-1))}</strong></div>`;
}

function renderVitalsTrend(body, patient) {
  let panel = body.querySelector("#vitalsTrendPanel"); if (!panel) { panel = document.createElement("section"); panel.id = "vitalsTrendPanel"; panel.className = "chart-section vitals-trend-panel"; body.appendChild(panel); }
  const p = trendPoints(patient.id);
  const signature = JSON.stringify([patient.id, p]);
  if (panel.dataset.signature === signature) return;
  panel.dataset.signature = signature;
  panel.innerHTML = `<div class="chart-section-title"><p class="eyebrow">Clinical Trends</p><h4>Vitals Over Time</h4></div><div class="trend-grid"><div><span>Heart Rate</span>${sparkline(p.map(x => x.hr))}</div><div><span>SpO₂</span>${sparkline(p.map(x => x.spo2),80,100)}</div><div><span>Respirations</span>${sparkline(p.map(x => x.rr))}</div><div><span>Temperature</span>${sparkline(p.map(x => x.temp),95,105)}</div><div><span>Pain</span>${sparkline(p.map(x => x.pain),0,10)}</div></div>`;
}

function renderDocumentation(body, patient) {
  let panel = body.querySelector("#signedDocumentationPanel"); if (!panel) { panel = document.createElement("section"); panel.id = "signedDocumentationPanel"; panel.className = "chart-section signed-documentation-panel"; body.appendChild(panel); }
  const notes = state.notes.filter(n => n.patientId === patient.id).sort((a,b) => timeValue(b.createdAt) - timeValue(a.createdAt));
  const addenda = state.addenda.filter(a => a.patientId === patient.id);
  const signature = JSON.stringify([patient.id, isProvider(), notes.map(n => [n.id, n.title, n.workingDiagnosis, n.note, n.plan, timeValue(n.createdAt)]), addenda.map(a => [a.id, a.noteId, a.text, timeValue(a.createdAt)])]);
  if (panel.dataset.signature === signature) return;
  panel.dataset.signature = signature;
  panel.innerHTML = `<div class="chart-section-title"><p class="eyebrow">Documentation Integrity</p><h4>Signed Clinical Notes</h4></div>${notes.length ? `<div class="signed-note-list">${notes.map(note => signedNote(note)).join("")}</div>` : '<div class="chart-empty"><p>No signed clinical notes.</p></div>'}`;
}

function signedNote(note) {
  const adds = state.addenda.filter(a => a.noteId === note.id).sort((a,b) => timeValue(a.createdAt) - timeValue(b.createdAt));
  return `<article class="signed-note"><div class="signed-note-head"><div><strong>${safe(note.title || "Clinical Note")}</strong><span>Signed by ${safe(note.authorName || "Northstar Staff")} · ${safe(formatDateTime(note.createdAt))}</span></div><span class="signed-chip">SIGNED</span></div><div class="signed-note-summary">${safe(note.workingDiagnosis || note.note || note.plan || "Signed clinical documentation")}</div>${adds.length ? `<div class="addendum-list">${adds.map(a => `<div><strong>ADDENDUM · ${safe(formatDateTime(a.createdAt))}</strong><p>${safe(a.text)}</p><span>${safe(a.authorName || "Northstar Staff")}</span></div>`).join("")}</div>` : ""}${isProvider() ? `<button type="button" class="text-button addendum-button" data-addendum-note="${safe(note.id)}">Add Addendum</button>` : ""}</article>`;
}

function openIdentity(patientId) {
  const patient = patientById(patientId); if (!patient) return; state.selectedPatientId = patientId;
  document.querySelector("#identitySafetyTitle").textContent = `${patient.lastName}, ${patient.firstName}`;
  document.querySelector("#identityAlias").value = patient.alias || ""; document.querySelector("#identityCodeStatus").value = patient.codeStatus || "Full Code"; document.querySelector("#identityPrimaryPhysician").value = patient.primaryPhysician || ""; document.querySelector("#identityPharmacy").value = patient.preferredPharmacy || ""; document.querySelector("#identityAlerts").value = patient.patientAlerts || ""; document.querySelector("#identityDirectives").value = patient.advanceDirectives || "";
  document.querySelector("#identitySafetyDialog")?.showModal();
}

async function saveIdentitySafety(event) {
  event.preventDefault(); const patient = patientById(state.selectedPatientId); if (!patient) return;
  try { await updateDoc(doc(db,"patients",patient.id), { alias: document.querySelector("#identityAlias").value.trim(), codeStatus: document.querySelector("#identityCodeStatus").value, primaryPhysician: document.querySelector("#identityPrimaryPhysician").value.trim(), preferredPharmacy: document.querySelector("#identityPharmacy").value.trim(), patientAlerts: document.querySelector("#identityAlerts").value.trim(), advanceDirectives: document.querySelector("#identityDirectives").value.trim(), updatedAt: serverTimestamp() }); document.querySelector("#identitySafetyDialog")?.close(); showToast("Patient safety profile updated."); } catch (_) { showToast("Unable to update patient profile."); }
}

function openAddendum(noteId) {
  const note = state.notes.find(n => n.id === noteId); if (!note || !isProvider()) return; state.selectedNoteId = noteId;
  const patient = patientById(note.patientId); document.querySelector("#addendumForm")?.reset(); document.querySelector("#addendumContext").innerHTML = `<strong>${safe(note.title || "Clinical Note")}</strong><span>${safe(patient?.lastName)}, ${safe(patient?.firstName)} · signed ${safe(formatDateTime(note.createdAt))}</span>`; document.querySelector("#addendumDialog")?.showModal();
}

async function saveAddendum(event) {
  event.preventDefault(); const note = state.notes.find(n => n.id === state.selectedNoteId); if (!note || !isProvider()) return;
  try { const ref = doc(collection(db,"noteAddenda")); await setDoc(ref,{ noteId: note.id, encounterId: note.encounterId, patientId: note.patientId, text: document.querySelector("#addendumText").value.trim(), authorUid: auth.currentUser.uid, authorName: state.profile.displayName, createdAt: serverTimestamp() }); document.querySelector("#addendumDialog")?.close(); showToast("Addendum signed. Original note unchanged."); } catch (_) { showToast("Unable to sign addendum."); }
}

function openOrderCatalog(encounterId) {
  const encounter = encounterById(encounterId); const patient = encounter ? patientById(encounter.patientId) : null; if (!encounter || !patient || !isProvider()) return; state.selectedEncounterId = encounterId; state.orderSearch = "";
  document.querySelector("#orderCatalogPatient").innerHTML = `<strong>${safe(patient.lastName)}, ${safe(patient.firstName)}</strong><span>${safe(patient.mrn)} · ${safe(encounter.room || "Emergency Department")} · ${safe(encounter.chiefComplaint || "Current encounter")}</span>`; document.querySelector("#orderCatalogSearch").value = ""; renderOrderCatalog(); document.querySelector("#orderCatalogDialog")?.showModal();
}

function renderOrderCatalog() {
  const target = document.querySelector("#orderCatalogList"); if (!target) return; const q = state.orderSearch.toLowerCase(); const items = CATALOG.filter(o => !q || `${o.name} ${o.category} ${o.instructions}`.toLowerCase().includes(q));
  target.innerHTML = items.map(o => `<article class="order-catalog-row"><div><span>${safe(label(o.category))} · ${safe(String(o.priority).toUpperCase())}</span><strong>${safe(o.name)}</strong><small>${safe([o.dose,o.route,o.frequency,o.instructions].filter(Boolean).join(" · "))}</small></div><button type="button" class="secondary-button compact" data-add-catalog-order="${safe(o.name)}">Add</button></article>`).join("") || '<div class="platform-empty"><strong>No matching orders</strong></div>';
}

async function createOrders(items) {
  const encounter = encounterById(state.selectedEncounterId); const patient = encounter ? patientById(encounter.patientId) : null; if (!encounter || !patient || !isProvider()) return;
  try { const batch = writeBatch(db); items.forEach(item => { const ref = doc(collection(db,"orders")); batch.set(ref,{ patientId: patient.id, encounterId: encounter.id, patientName: `${patient.lastName}, ${patient.firstName}`, mrn: patient.mrn, category: item.category, name: item.name, priority: item.priority, instructions: item.instructions || "", dose: item.dose || "", route: item.route || "", frequency: item.frequency || "", status: "ordered", dueAt: item.category === "medication" ? new Date(Date.now()+5*60_000) : null, orderedBy: auth.currentUser.uid, orderedByName: state.profile.displayName, createdAt: serverTimestamp() }); }); batch.update(doc(db,"encounters",encounter.id),{ status:"treatment", updatedAt:serverTimestamp() }); await batch.commit(); showToast(items.length === 1 ? "Order signed." : `${items.length} orders signed.`); } catch (_) { showToast("Unable to sign orders."); }
}

async function printWristband(patientId) {
  const patient = patientById(patientId); if (!patient || !canWristband()) return;
  const payload = `NORTHSTAR|${patient.id}|${patient.mrn}`; let qrData = "";
  try { const mod = await import("https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm"); const qr = mod.default || mod; qrData = await qr.toDataURL(payload,{ margin:1, width:180 }); } catch (_) {}
  const popup = window.open("", "northstar-wristband", "width=760,height=540"); if (!popup) { showToast("Allow pop-ups to print a wristband."); return; }
  popup.document.write(`<!doctype html><html><head><title>Northstar Wristband</title><style>body{font-family:Arial,sans-serif;margin:0;padding:30px;color:#0a2940}.band{width:700px;height:180px;border:2px solid #0a2940;display:grid;grid-template-columns:1fr 150px;align-items:center;padding:18px 22px;box-sizing:border-box}.brand{font-size:13px;font-weight:800;letter-spacing:.12em}.name{font-size:28px;font-weight:800;margin:10px 0}.meta{font-size:15px;line-height:1.6}.qr{text-align:center}.qr img{width:125px;height:125px}.qr small{display:block;margin-top:3px}.note{margin-top:20px;font-size:12px;color:#555}@media print{.note{display:none}body{padding:0}.band{margin:0}}</style></head><body><div class="band"><div><div class="brand">NORTHSTAR MEDICAL CENTER</div><div class="name">${safe(patient.lastName)}, ${safe(patient.firstName)}</div><div class="meta">MRN: <strong>${safe(patient.mrn)}</strong><br>DOB: ${safe(patient.dob || "—")} · ${safe(patient.sex || "Unknown")}<br>Allergies: <strong>${safe(patient.allergies || "NKDA")}</strong></div></div><div class="qr">${qrData ? `<img src="${qrData}">` : `<strong>${safe(patient.mrn)}</strong>`}<small>Patient ID</small></div></div><div class="note">Roleplay record only · Use the browser print dialog to print this wristband.</div><script>setTimeout(()=>window.print(),300)</script></body></html>`); popup.document.close();
}

async function openScanner() { if (!canWristband()) return; document.querySelector("#wristbandScannerDialog")?.showModal(); await startScanner(); }
async function startScanner() {
  stopScanner(); const status = document.querySelector("#scannerStatus");
  if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) { status.textContent = "Camera QR scanning is not supported here. Enter the MRN below."; return; }
  try { state.cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); const video = document.querySelector("#wristbandVideo"); video.srcObject = state.cameraStream; await video.play(); const detector = new BarcodeDetector({ formats:["qr_code"] }); status.textContent = "Point the camera at a Northstar wristband."; let last=0; const loop=async ts=>{ if(!state.cameraStream)return; if(ts-last>450){last=ts; try{const codes=await detector.detect(video); if(codes[0]?.rawValue){handleScan(codes[0].rawValue);return;}}catch(_){}} state.scanLoop=requestAnimationFrame(loop);}; state.scanLoop=requestAnimationFrame(loop); } catch (_) { status.textContent = "Camera access was unavailable. Enter the MRN below."; }
}
function stopScanner() { if(state.scanLoop)cancelAnimationFrame(state.scanLoop); state.scanLoop=0; state.cameraStream?.getTracks().forEach(t=>t.stop()); state.cameraStream=null; const video=document.querySelector("#wristbandVideo"); if(video)video.srcObject=null; }
function handleScan(value) { let patient=null; if(value.startsWith("NORTHSTAR|")){const [,id,mrn]=value.split("|"); patient=patientById(id)||state.patients.find(p=>p.mrn===mrn);} else patient=state.patients.find(p=>p.mrn?.toLowerCase()===value.trim().toLowerCase()); if(!patient){showToast("No matching Northstar patient found.");return;} stopScanner(); document.querySelector("#wristbandScannerDialog")?.close(); window.dispatchEvent(new CustomEvent("northstar:open-patient",{detail:{patientId:patient.id}})); }

async function mergePatients(sourceId,targetId) {
  if(!isAdmin()||sourceId===targetId)return; const source=patientById(sourceId),target=patientById(targetId); if(!source||!target)return; if(!window.confirm(`Merge ${source.mrn} into ${target.mrn}? The source record will be retired and all linked cases will move to the target patient.`))return;
  try { const batch=writeBatch(db); const collections=[[state.encounters,"encounters"],[state.orders,"orders"],[state.results,"results"],[state.notes,"clinicalNotes"],[state.addenda,"noteAddenda"],[state.observations,"observations"],[state.administrations,"medicationAdministrations"]]; for(const [items,name] of collections){items.filter(x=>x.patientId===sourceId).forEach(item=>batch.update(doc(db,name,item.id),{patientId:targetId,patientName:`${target.lastName}, ${target.firstName}`,mrn:target.mrn,updatedAt:serverTimestamp()}));} batch.update(doc(db,"patients",sourceId),{currentStatus:"merged",vitalStatus:"merged",mergedInto:targetId,mergedIntoMrn:target.mrn,activeEncounterId:null,updatedAt:serverTimestamp()}); batch.set(doc(collection(db,"auditEvents")),{type:"patient-records-merged",sourcePatientId:sourceId,targetPatientId:targetId,sourceMrn:source.mrn,targetMrn:target.mrn,actorUid:auth.currentUser.uid,actorName:state.profile.displayName,at:serverTimestamp()}); await batch.commit(); showToast(`${source.mrn} merged into ${target.mrn}.`); document.querySelector("#patientChartDialog")?.close(); } catch(_){showToast("Unable to merge those patient records.");}
}

function bindEvents() {
  document.querySelector('[data-northstar-clinical="mar"]')?.addEventListener("click",openMar); document.querySelector("#scanWristbandButton")?.addEventListener("click",openScanner);
  document.querySelector("#orderCatalogSearch")?.addEventListener("input",e=>{state.orderSearch=e.target.value.trim();renderOrderCatalog();});
  document.querySelector("#manualScanButton")?.addEventListener("click",()=>handleScan(document.querySelector("#manualScanMrn").value));
  document.addEventListener("click",async e=>{
    const patientLink=e.target.closest("[data-patient-id]"); if(patientLink){state.selectedPatientId=patientLink.dataset.patientId;setTimeout(enhanceChart,0);}
    const plusPatient=e.target.closest("[data-plus-patient]"); if(plusPatient){window.dispatchEvent(new CustomEvent("northstar:open-patient",{detail:{patientId:plusPatient.dataset.plusPatient}}));return;}
    const wrist=e.target.closest("[data-print-wristband]"); if(wrist){await printWristband(wrist.dataset.printWristband);return;}
    const identity=e.target.closest("[data-identity-safety]"); if(identity){openIdentity(identity.dataset.identitySafety);return;}
    const catalog=e.target.closest("[data-order-catalog]"); if(catalog){openOrderCatalog(catalog.dataset.orderCatalog);return;}
    const add=e.target.closest("[data-add-catalog-order]"); if(add){const item=CATALOG.find(o=>o.name===add.dataset.addCatalogOrder);if(item)await createOrders([item]);return;}
    const set=e.target.closest("[data-order-set]"); if(set){const items=(ORDER_SETS[set.dataset.orderSet]||[]).map(name=>CATALOG.find(o=>o.name===name)).filter(Boolean);if(items.length&&window.confirm(`Sign ${set.dataset.orderSet} with ${items.length} orders?`))await createOrders(items);return;}
    const addendum=e.target.closest("[data-addendum-note]"); if(addendum){openAddendum(addendum.dataset.addendumNote);return;}
    const give=e.target.closest("[data-mar-give]"); if(give){await marAction(give.dataset.marGive,"give");return;} const hold=e.target.closest("[data-mar-hold]"); if(hold){await marAction(hold.dataset.marHold,"hold");return;} const refuse=e.target.closest("[data-mar-refuse]"); if(refuse){await marAction(refuse.dataset.marRefuse,"refuse");return;}
    const merge=e.target.closest("[data-merge-records]"); if(merge){await mergePatients(merge.dataset.mergeRecords,merge.dataset.mergeTarget);return;}
  });
  window.addEventListener("northstar:open-mar",openMar); window.addEventListener("northstar:order-catalog",e=>openOrderCatalog(e.detail?.encounterId));
  document.addEventListener("click",e=>{const check=e.target.closest("[data-checkin-id]"); if(!check)return; const p=patientById(check.dataset.checkinId); if(p&&(p.currentStatus==="merged"||p.vitalStatus==="merged")){e.preventDefault();e.stopImmediatePropagation();showToast("Check-in blocked: this patient record was merged into another record.");}},true);
}

function scheduleRender(){if(state.renderQueued)return;state.renderQueued=true;requestAnimationFrame(()=>{state.renderQueued=false;const mar=document.querySelector("#northstarMarSection");if(mar&&!mar.classList.contains("hidden"))renderMar();if(document.querySelector("#patientChartDialog")?.open)enhanceChart();});}
function stopListeners(){state.unsubscribers.forEach(u=>{try{u();}catch(_){}});state.unsubscribers=[];state.profile=null;}
function bindCollection(name,key){const u=onSnapshot(collection(db,name),s=>{state[key]=s.docs.map(d=>({id:d.id,...d.data()}));scheduleRender();},()=>{state[key]=[];scheduleRender();});state.unsubscribers.push(u);}
async function start(user){stopListeners();if(!user)return;const p=await getDoc(doc(db,"users",user.uid));if(!p.exists())return;state.profile={id:p.id,...p.data()};if(state.profile.status!=="active")return;[["patients","patients"],["encounters","encounters"],["orders","orders"],["results","results"],["clinicalNotes","notes"],["noteAddenda","addenda"],["observations","observations"],["medicationAdministrations","administrations"],["tasks","tasks"]].forEach(([n,k])=>bindCollection(n,k));scheduleRender();}

injectAdvancedClinical();
const chartBody=document.querySelector("#patientChartBody");if(chartBody)new MutationObserver(scheduleRender).observe(chartBody,{childList:true,subtree:false});const chartDialog=document.querySelector("#patientChartDialog");if(chartDialog)new MutationObserver(scheduleRender).observe(chartDialog,{attributes:true,attributeFilter:["open"]});
onAuthStateChanged(auth,user=>start(user).catch(()=>stopListeners()));
