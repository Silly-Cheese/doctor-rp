import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBPtNWvmmYl-6hFb7NlmNszapMwQH4Xm7I",
  authDomain: "doctor-rp.firebaseapp.com",
  projectId: "doctor-rp",
  storageBucket: "doctor-rp.firebasestorage.app",
  messagingSenderId: "76025336566",
  appId: "1:76025336566:web:b8507e26ce66d44c6b52d7"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const state = {
  profile: null,
  patients: [],
  encounters: [],
  notes: [],
  orders: [],
  results: [],
  administrations: [],
  observations: [],
  audits: [],
  unsubscribers: [],
  activeTab: "notes",
  selectedEncounterId: null,
  selectedOrderId: null
};

const ROLE_LABELS = {
  administrator: "Administrator",
  physician: "Physician",
  nurse: "Registered Nurse",
  registration: "Registration",
  technician: "Clinical Technician",
  staff: "Clinical Staff"
};

function safe(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timeValue(value) {
  return toDate(value)?.getTime() || 0;
}

function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return "Pending";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatStatus(value) {
  return String(value || "unknown")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function canPhysician() {
  return ["administrator", "physician"].includes(state.profile?.role);
}

function canNurse() {
  return ["administrator", "nurse"].includes(state.profile?.role);
}

function canOrder() {
  return ["administrator", "physician"].includes(state.profile?.role);
}

function canEnterResult() {
  return ["administrator", "physician", "technician"].includes(state.profile?.role);
}

function canCompleteOrder() {
  return ["administrator", "physician", "nurse", "technician"].includes(state.profile?.role);
}

function canAdministerMedication() {
  return ["administrator", "nurse"].includes(state.profile?.role);
}

function activeEncounter(patientId) {
  return state.encounters
    .filter((item) => item.patientId === patientId && item.status !== "discharged")
    .sort((a, b) => timeValue(b.arrivalAt) - timeValue(a.arrivalAt))[0] || null;
}

function patientById(patientId) {
  return state.patients.find((item) => item.id === patientId) || null;
}

function encounterById(encounterId) {
  return state.encounters.find((item) => item.id === encounterId) || null;
}

function orderById(orderId) {
  return state.orders.find((item) => item.id === orderId) || null;
}

function currentChartPatient() {
  const body = document.querySelector("#patientChartBody");
  if (!body) return null;
  const text = body.querySelector(".chart-banner")?.textContent || body.textContent || "";
  return state.patients.find((patient) => patient.mrn && text.includes(patient.mrn)) || null;
}

function encounterItems(list, encounterId) {
  return list
    .filter((item) => item.encounterId === encounterId)
    .sort((a, b) => timeValue(b.createdAt || b.at || b.administeredAt || b.completedAt) - timeValue(a.createdAt || a.at || a.administeredAt || a.completedAt));
}

function stopListeners() {
  state.unsubscribers.forEach((unsubscribe) => {
    try { unsubscribe(); } catch (_) { /* no action */ }
  });
  state.unsubscribers = [];
}

function bindCollection(name, key) {
  const unsubscribe = onSnapshot(collection(db, name), (snapshot) => {
    state[key] = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderClinicalSurfaces();
  }, () => {
    state[key] = [];
    renderClinicalSurfaces();
  });
  state.unsubscribers.push(unsubscribe);
}

function startListeners() {
  stopListeners();
  bindCollection("patients", "patients");
  bindCollection("encounters", "encounters");
  bindCollection("clinicalNotes", "notes");
  bindCollection("orders", "orders");
  bindCollection("results", "results");
  bindCollection("medicationAdministrations", "administrations");
  bindCollection("observations", "observations");
  bindCollection("auditEvents", "audits");
}

function injectDialogs() {
  if (document.querySelector("#physicianNoteDialog")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <dialog id="physicianNoteDialog" class="clinical-modal">
      <form id="physicianNoteForm" class="clinical-modal-card">
        <div class="modal-header"><div><p class="eyebrow">Provider Documentation</p><h3>Physician Note</h3></div><button class="icon-button" type="button" data-close-clinical="physicianNoteDialog" aria-label="Close">×</button></div>
        <div class="modal-body form-grid">
          <div id="physicianNotePatient" class="patient-context"></div>
          <label><span>History / HPI</span><textarea id="physicianHpi" rows="4" required placeholder="History of present illness"></textarea></label>
          <label><span>Physical examination</span><textarea id="physicianExam" rows="4" required placeholder="Pertinent examination findings"></textarea></label>
          <label><span>Differential diagnosis</span><textarea id="physicianDifferential" rows="3" placeholder="Working differential"></textarea></label>
          <label><span>Working diagnosis</span><input id="physicianDiagnosis" required placeholder="Primary working diagnosis"></label>
          <label><span>Assessment & plan</span><textarea id="physicianPlan" rows="4" required placeholder="Assessment, treatment plan, follow-up"></textarea></label>
        </div>
        <div class="modal-footer"><button class="secondary-button" type="button" data-close-clinical="physicianNoteDialog">Cancel</button><button class="primary-button" type="submit">Sign Note</button></div>
      </form>
    </dialog>

    <dialog id="nursingAssessmentDialog" class="clinical-modal">
      <form id="nursingAssessmentForm" class="clinical-modal-card">
        <div class="modal-header"><div><p class="eyebrow">Nursing Documentation</p><h3>Focused Assessment</h3></div><button class="icon-button" type="button" data-close-clinical="nursingAssessmentDialog" aria-label="Close">×</button></div>
        <div class="modal-body form-grid">
          <div id="nursingAssessmentPatient" class="patient-context"></div>
          <div class="field-row"><label><span>Mental status</span><select id="assessmentMental"><option>Alert and oriented</option><option>Alert, confused</option><option>Lethargic</option><option>Responds to voice</option><option>Responds to pain</option><option>Unresponsive</option></select></label><label><span>Pain</span><input id="assessmentPain" type="number" min="0" max="10" placeholder="0–10"></label></div>
          <div class="field-row"><label><span>Respiratory</span><select id="assessmentRespiratory"><option>Unlabored</option><option>Labored</option><option>Shallow</option><option>Wheezing</option><option>Diminished</option><option>Other</option></select></label><label><span>Cardiovascular</span><select id="assessmentCardio"><option>Regular</option><option>Irregular</option><option>Tachycardic</option><option>Bradycardic</option><option>Weak pulses</option><option>Other</option></select></label></div>
          <label><span>Skin / general appearance</span><input id="assessmentSkin" placeholder="Warm, dry, pale, diaphoretic, etc."></label>
          <div class="vitals-grid"><label><span>Heart rate</span><input id="assessmentHr" type="number" min="0" max="300" placeholder="bpm"></label><label><span>Blood pressure</span><input id="assessmentBp" placeholder="120/80"></label><label><span>Respirations</span><input id="assessmentRr" type="number" min="0" max="100" placeholder="/min"></label><label><span>SpO₂</span><input id="assessmentSpo2" type="number" min="0" max="100" placeholder="%"></label><label><span>Temperature</span><input id="assessmentTemp" type="number" step="0.1" placeholder="°F"></label></div>
          <label><span>Nursing note</span><textarea id="assessmentNote" rows="4" required placeholder="Focused assessment, interventions, patient response"></textarea></label>
        </div>
        <div class="modal-footer"><button class="secondary-button" type="button" data-close-clinical="nursingAssessmentDialog">Cancel</button><button class="primary-button" type="submit">Save Assessment</button></div>
      </form>
    </dialog>

    <dialog id="clinicalOrderDialog" class="clinical-modal">
      <form id="clinicalOrderForm" class="clinical-modal-card">
        <div class="modal-header"><div><p class="eyebrow">Order Entry</p><h3>New Clinical Order</h3></div><button class="icon-button" type="button" data-close-clinical="clinicalOrderDialog" aria-label="Close">×</button></div>
        <div class="modal-body form-grid">
          <div id="clinicalOrderPatient" class="patient-context"></div>
          <div class="field-row"><label><span>Order type</span><select id="orderCategory" required><option value="laboratory">Laboratory</option><option value="imaging">Imaging</option><option value="medication">Medication</option><option value="procedure">Procedure</option><option value="monitoring">Monitoring</option><option value="consult">Consult</option><option value="other">Other</option></select></label><label><span>Priority</span><select id="orderPriority" required><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="stat">STAT</option></select></label></div>
          <label><span>Order</span><input id="orderName" required placeholder="Test, medication, procedure, or consult"></label>
          <div id="medicationOrderFields" class="clinical-grid hidden"><label><span>Dose</span><input id="orderDose" placeholder="Entered by provider"></label><label><span>Route</span><select id="orderRoute"><option value="">Select route</option><option>PO</option><option>IV</option><option>IM</option><option>Subcutaneous</option><option>Inhaled</option><option>Topical</option><option>Other</option></select></label><label><span>Frequency</span><input id="orderFrequency" placeholder="Once, PRN, etc."></label></div>
          <label><span>Instructions / indication</span><textarea id="orderInstructions" rows="3" placeholder="Clinical instructions or reason for order"></textarea></label>
        </div>
        <div class="modal-footer"><button class="secondary-button" type="button" data-close-clinical="clinicalOrderDialog">Cancel</button><button class="primary-button" type="submit">Sign Order</button></div>
      </form>
    </dialog>

    <dialog id="clinicalResultDialog" class="clinical-modal">
      <form id="clinicalResultForm" class="clinical-modal-card">
        <div class="modal-header"><div><p class="eyebrow">Diagnostic Services</p><h3>Enter Result</h3></div><button class="icon-button" type="button" data-close-clinical="clinicalResultDialog" aria-label="Close">×</button></div>
        <div class="modal-body form-grid">
          <div id="clinicalResultPatient" class="patient-context"></div>
          <label><span>Order</span><select id="resultOrder" required></select></label>
          <label><span>Result summary</span><input id="resultSummary" required placeholder="Concise result"></label>
          <label><span>Details</span><textarea id="resultDetails" rows="5" required placeholder="Full roleplay result"></textarea></label>
          <label class="checkbox-line"><input id="resultAbnormal" type="checkbox"> Flag as abnormal / critical finding</label>
        </div>
        <div class="modal-footer"><button class="secondary-button" type="button" data-close-clinical="clinicalResultDialog">Cancel</button><button class="primary-button" type="submit">Finalize Result</button></div>
      </form>
    </dialog>

    <dialog id="medicationAdministrationDialog" class="clinical-modal">
      <form id="medicationAdministrationForm" class="clinical-modal-card">
        <div class="modal-header"><div><p class="eyebrow">Medication Administration Record</p><h3>Document Administration</h3></div><button class="icon-button" type="button" data-close-clinical="medicationAdministrationDialog" aria-label="Close">×</button></div>
        <div class="modal-body form-grid">
          <div id="medicationPatient" class="patient-context"></div>
          <div id="medicationAllergyAlert" class="allergy-alert"></div>
          <div id="medicationOrderSummary" class="medication-banner"></div>
          <div class="field-row"><label><span>Dose administered</span><input id="administrationDose" required></label><label><span>Route</span><input id="administrationRoute" required></label></div>
          <label class="checkbox-line"><input id="administrationPatientVerified" type="checkbox" required> Patient identity verified</label>
          <label class="checkbox-line"><input id="administrationAllergyVerified" type="checkbox" required> Allergy status reviewed</label>
          <label><span>Administration note</span><textarea id="administrationNote" rows="3" placeholder="Patient response or additional documentation"></textarea></label>
        </div>
        <div class="modal-footer"><button class="secondary-button" type="button" data-close-clinical="medicationAdministrationDialog">Cancel</button><button class="primary-button" type="submit">Document Administration</button></div>
      </form>
    </dialog>
  `);

  document.querySelector("#physicianNoteForm").addEventListener("submit", submitPhysicianNote);
  document.querySelector("#nursingAssessmentForm").addEventListener("submit", submitNursingAssessment);
  document.querySelector("#clinicalOrderForm").addEventListener("submit", submitOrder);
  document.querySelector("#clinicalResultForm").addEventListener("submit", submitResult);
  document.querySelector("#medicationAdministrationForm").addEventListener("submit", submitMedicationAdministration);
  document.querySelector("#orderCategory").addEventListener("change", toggleMedicationOrderFields);
  document.querySelectorAll("[data-close-clinical]").forEach((button) => button.addEventListener("click", () => document.querySelector(`#${button.dataset.closeClinical}`)?.close()));

  document.querySelectorAll(".clinical-modal").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
}

function patientContext(patient, encounter) {
  return `<strong>${safe(patient?.lastName)}, ${safe(patient?.firstName)}</strong><span>${safe(patient?.mrn)} · ${safe(encounter?.room || "Emergency Department")} · ${safe(encounter?.chiefComplaint || "Current encounter")}</span>`;
}

function toggleMedicationOrderFields() {
  document.querySelector("#medicationOrderFields")?.classList.toggle("hidden", document.querySelector("#orderCategory")?.value !== "medication");
}

function openPhysicianNote(encounterId) {
  const encounter = encounterById(encounterId);
  const patient = encounter ? patientById(encounter.patientId) : null;
  if (!encounter || !patient || !canPhysician()) return;
  state.selectedEncounterId = encounter.id;
  const form = document.querySelector("#physicianNoteForm");
  form.reset();
  document.querySelector("#physicianNotePatient").innerHTML = patientContext(patient, encounter);
  document.querySelector("#physicianDiagnosis").value = encounter.workingDiagnosis || "";
  document.querySelector("#physicianDifferential").value = encounter.differential || "";
  document.querySelector("#physicianNoteDialog").showModal();
}

function openNursingAssessment(encounterId) {
  const encounter = encounterById(encounterId);
  const patient = encounter ? patientById(encounter.patientId) : null;
  if (!encounter || !patient || !canNurse()) return;
  state.selectedEncounterId = encounter.id;
  document.querySelector("#nursingAssessmentForm").reset();
  document.querySelector("#nursingAssessmentPatient").innerHTML = patientContext(patient, encounter);
  const latest = encounterItems(state.observations, encounter.id).find((item) => item.type === "nursing-assessment");
  if (latest) {
    document.querySelector("#assessmentMental").value = latest.mentalStatus || "Alert and oriented";
    document.querySelector("#assessmentRespiratory").value = latest.respiratory || "Unlabored";
    document.querySelector("#assessmentCardio").value = latest.cardiovascular || "Regular";
    document.querySelector("#assessmentSkin").value = latest.skin || "";
    document.querySelector("#assessmentPain").value = latest.pain ?? "";
    document.querySelector("#assessmentHr").value = latest.vitals?.heartRate || "";
    document.querySelector("#assessmentBp").value = latest.vitals?.bloodPressure || "";
    document.querySelector("#assessmentRr").value = latest.vitals?.respirations || "";
    document.querySelector("#assessmentSpo2").value = latest.vitals?.spo2 || "";
    document.querySelector("#assessmentTemp").value = latest.vitals?.temperature || "";
  }
  document.querySelector("#nursingAssessmentDialog").showModal();
}

function openOrderDialog(encounterId) {
  const encounter = encounterById(encounterId);
  const patient = encounter ? patientById(encounter.patientId) : null;
  if (!encounter || !patient || !canOrder()) return;
  state.selectedEncounterId = encounter.id;
  document.querySelector("#clinicalOrderForm").reset();
  document.querySelector("#clinicalOrderPatient").innerHTML = patientContext(patient, encounter);
  toggleMedicationOrderFields();
  document.querySelector("#clinicalOrderDialog").showModal();
}

function openResultDialog(encounterId, orderId = "") {
  const encounter = encounterById(encounterId);
  const patient = encounter ? patientById(encounter.patientId) : null;
  if (!encounter || !patient || !canEnterResult()) return;
  state.selectedEncounterId = encounter.id;
  state.selectedOrderId = orderId;
  document.querySelector("#clinicalResultForm").reset();
  document.querySelector("#clinicalResultPatient").innerHTML = patientContext(patient, encounter);
  const select = document.querySelector("#resultOrder");
  const eligible = encounterItems(state.orders, encounter.id).filter((order) => order.status !== "cancelled");
  select.innerHTML = eligible.length
    ? eligible.map((order) => `<option value="${safe(order.id)}" ${order.id === orderId ? "selected" : ""}>${safe(formatStatus(order.category))} — ${safe(order.name)}</option>`).join("")
    : '<option value="">No orders available</option>';
  document.querySelector("#clinicalResultDialog").showModal();
}

function openMedicationAdministration(orderId) {
  const order = orderById(orderId);
  const encounter = order ? encounterById(order.encounterId) : null;
  const patient = order ? patientById(order.patientId) : null;
  if (!order || !encounter || !patient || !canAdministerMedication()) return;
  state.selectedOrderId = order.id;
  state.selectedEncounterId = encounter.id;
  document.querySelector("#medicationAdministrationForm").reset();
  document.querySelector("#medicationPatient").innerHTML = patientContext(patient, encounter);
  document.querySelector("#medicationAllergyAlert").textContent = `Allergies: ${patient.allergies || "NKDA"}`;
  document.querySelector("#medicationOrderSummary").innerHTML = `<div><strong>${safe(order.name)}</strong><span>${safe(order.dose || "Dose not specified")} · ${safe(order.route || "Route not specified")} · ${safe(order.frequency || "No frequency entered")}</span></div><span class="clinical-badge ${safe(order.priority)}">${safe(order.priority || "routine")}</span>`;
  document.querySelector("#administrationDose").value = order.dose || "";
  document.querySelector("#administrationRoute").value = order.route || "";
  document.querySelector("#medicationAdministrationDialog").showModal();
}

async function submitPhysicianNote(event) {
  event.preventDefault();
  const encounter = encounterById(state.selectedEncounterId);
  const patient = encounter ? patientById(encounter.patientId) : null;
  if (!encounter || !patient || !canPhysician()) return;
  const button = event.currentTarget.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Signing…";
  try {
    const workingDiagnosis = document.querySelector("#physicianDiagnosis").value.trim();
    const differential = document.querySelector("#physicianDifferential").value.trim();
    const noteRef = doc(collection(db, "clinicalNotes"));
    const auditRef = doc(collection(db, "auditEvents"));
    const batch = writeBatch(db);
    batch.set(noteRef, {
      patientId: patient.id,
      encounterId: encounter.id,
      type: "physician",
      title: "Physician Progress Note",
      hpi: document.querySelector("#physicianHpi").value.trim(),
      exam: document.querySelector("#physicianExam").value.trim(),
      differential,
      workingDiagnosis,
      plan: document.querySelector("#physicianPlan").value.trim(),
      authorUid: auth.currentUser.uid,
      authorName: state.profile.displayName,
      authorRole: state.profile.role,
      createdAt: serverTimestamp()
    });
    batch.update(doc(db, "encounters", encounter.id), {
      workingDiagnosis,
      differential,
      providerUid: auth.currentUser.uid,
      providerName: state.profile.displayName,
      status: "treatment",
      updatedAt: serverTimestamp()
    });
    batch.update(doc(db, "patients", patient.id), { currentEncounterStatus: "treatment", updatedAt: serverTimestamp() });
    batch.set(auditRef, {
      type: "physician-note-signed",
      patientId: patient.id,
      encounterId: encounter.id,
      actorUid: auth.currentUser.uid,
      actorName: state.profile.displayName,
      at: serverTimestamp()
    });
    await batch.commit();
    document.querySelector("#physicianNoteDialog").close();
    showToast("Physician note signed.");
  } catch (error) {
    showToast("Unable to save physician note.");
  } finally {
    button.disabled = false;
    button.textContent = "Sign Note";
  }
}

async function submitNursingAssessment(event) {
  event.preventDefault();
  const encounter = encounterById(state.selectedEncounterId);
  const patient = encounter ? patientById(encounter.patientId) : null;
  if (!encounter || !patient || !canNurse()) return;
  const button = event.currentTarget.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const observationRef = doc(collection(db, "observations"));
    const auditRef = doc(collection(db, "auditEvents"));
    const batch = writeBatch(db);
    const vitals = {
      heartRate: document.querySelector("#assessmentHr").value.trim(),
      bloodPressure: document.querySelector("#assessmentBp").value.trim(),
      respirations: document.querySelector("#assessmentRr").value.trim(),
      spo2: document.querySelector("#assessmentSpo2").value.trim(),
      temperature: document.querySelector("#assessmentTemp").value.trim()
    };
    batch.set(observationRef, {
      patientId: patient.id,
      encounterId: encounter.id,
      type: "nursing-assessment",
      mentalStatus: document.querySelector("#assessmentMental").value,
      respiratory: document.querySelector("#assessmentRespiratory").value,
      cardiovascular: document.querySelector("#assessmentCardio").value,
      skin: document.querySelector("#assessmentSkin").value.trim(),
      pain: document.querySelector("#assessmentPain").value.trim(),
      vitals,
      note: document.querySelector("#assessmentNote").value.trim(),
      authorUid: auth.currentUser.uid,
      authorName: state.profile.displayName,
      createdAt: serverTimestamp()
    });
    const nextStatus = ["waiting", "triage", "roomed"].includes(encounter.status) ? "treatment" : encounter.status;
    batch.update(doc(db, "encounters", encounter.id), { latestVitals: vitals, status: nextStatus, updatedAt: serverTimestamp() });
    batch.update(doc(db, "patients", patient.id), { currentEncounterStatus: nextStatus, updatedAt: serverTimestamp() });
    batch.set(auditRef, {
      type: "nursing-assessment-completed",
      patientId: patient.id,
      encounterId: encounter.id,
      actorUid: auth.currentUser.uid,
      actorName: state.profile.displayName,
      at: serverTimestamp()
    });
    await batch.commit();
    document.querySelector("#nursingAssessmentDialog").close();
    showToast("Nursing assessment saved.");
  } catch (_) {
    showToast("Unable to save nursing assessment.");
  } finally {
    button.disabled = false;
    button.textContent = "Save Assessment";
  }
}

async function submitOrder(event) {
  event.preventDefault();
  const encounter = encounterById(state.selectedEncounterId);
  const patient = encounter ? patientById(encounter.patientId) : null;
  if (!encounter || !patient || !canOrder()) return;
  const button = event.currentTarget.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Signing…";
  try {
    const category = document.querySelector("#orderCategory").value;
    const orderRef = doc(collection(db, "orders"));
    const auditRef = doc(collection(db, "auditEvents"));
    const batch = writeBatch(db);
    batch.set(orderRef, {
      patientId: patient.id,
      encounterId: encounter.id,
      patientName: `${patient.lastName}, ${patient.firstName}`,
      mrn: patient.mrn,
      category,
      name: document.querySelector("#orderName").value.trim(),
      priority: document.querySelector("#orderPriority").value,
      instructions: document.querySelector("#orderInstructions").value.trim(),
      dose: category === "medication" ? document.querySelector("#orderDose").value.trim() : "",
      route: category === "medication" ? document.querySelector("#orderRoute").value : "",
      frequency: category === "medication" ? document.querySelector("#orderFrequency").value.trim() : "",
      status: "ordered",
      orderedBy: auth.currentUser.uid,
      orderedByName: state.profile.displayName,
      createdAt: serverTimestamp()
    });
    batch.update(doc(db, "encounters", encounter.id), { status: "treatment", updatedAt: serverTimestamp() });
    batch.update(doc(db, "patients", patient.id), { currentEncounterStatus: "treatment", updatedAt: serverTimestamp() });
    batch.set(auditRef, {
      type: "order-entered",
      patientId: patient.id,
      encounterId: encounter.id,
      orderId: orderRef.id,
      actorUid: auth.currentUser.uid,
      actorName: state.profile.displayName,
      at: serverTimestamp()
    });
    await batch.commit();
    document.querySelector("#clinicalOrderDialog").close();
    showToast("Order signed.");
  } catch (_) {
    showToast("Unable to enter order.");
  } finally {
    button.disabled = false;
    button.textContent = "Sign Order";
  }
}

async function submitResult(event) {
  event.preventDefault();
  const encounter = encounterById(state.selectedEncounterId);
  const patient = encounter ? patientById(encounter.patientId) : null;
  const orderId = document.querySelector("#resultOrder").value;
  const order = orderById(orderId);
  if (!encounter || !patient || !order || !canEnterResult()) return;
  const button = event.currentTarget.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Finalizing…";
  try {
    const resultRef = doc(collection(db, "results"));
    const auditRef = doc(collection(db, "auditEvents"));
    const batch = writeBatch(db);
    const abnormal = document.querySelector("#resultAbnormal").checked;
    batch.set(resultRef, {
      patientId: patient.id,
      encounterId: encounter.id,
      orderId: order.id,
      patientName: `${patient.lastName}, ${patient.firstName}`,
      mrn: patient.mrn,
      orderName: order.name,
      category: order.category,
      summary: document.querySelector("#resultSummary").value.trim(),
      details: document.querySelector("#resultDetails").value.trim(),
      abnormal,
      status: "final",
      enteredBy: auth.currentUser.uid,
      enteredByName: state.profile.displayName,
      createdAt: serverTimestamp()
    });
    batch.update(doc(db, "orders", order.id), { status: "complete", completedAt: serverTimestamp(), completedBy: auth.currentUser.uid });
    batch.set(auditRef, {
      type: "result-finalized",
      patientId: patient.id,
      encounterId: encounter.id,
      orderId: order.id,
      resultId: resultRef.id,
      actorUid: auth.currentUser.uid,
      actorName: state.profile.displayName,
      at: serverTimestamp()
    });
    await batch.commit();
    document.querySelector("#clinicalResultDialog").close();
    showToast("Result finalized.");
  } catch (_) {
    showToast("Unable to finalize result.");
  } finally {
    button.disabled = false;
    button.textContent = "Finalize Result";
  }
}

async function submitMedicationAdministration(event) {
  event.preventDefault();
  const order = orderById(state.selectedOrderId);
  const encounter = order ? encounterById(order.encounterId) : null;
  const patient = order ? patientById(order.patientId) : null;
  if (!order || !encounter || !patient || !canAdministerMedication()) return;
  const button = event.currentTarget.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Documenting…";
  try {
    const administrationRef = doc(collection(db, "medicationAdministrations"));
    const auditRef = doc(collection(db, "auditEvents"));
    const batch = writeBatch(db);
    batch.set(administrationRef, {
      patientId: patient.id,
      encounterId: encounter.id,
      orderId: order.id,
      medication: order.name,
      dose: document.querySelector("#administrationDose").value.trim(),
      route: document.querySelector("#administrationRoute").value.trim(),
      note: document.querySelector("#administrationNote").value.trim(),
      patientVerified: true,
      allergyReviewed: true,
      administeredBy: auth.currentUser.uid,
      administeredByName: state.profile.displayName,
      administeredAt: serverTimestamp()
    });
    batch.update(doc(db, "orders", order.id), { status: "administered", lastAdministeredAt: serverTimestamp(), lastAdministeredBy: auth.currentUser.uid });
    batch.set(auditRef, {
      type: "medication-administered",
      patientId: patient.id,
      encounterId: encounter.id,
      orderId: order.id,
      actorUid: auth.currentUser.uid,
      actorName: state.profile.displayName,
      at: serverTimestamp()
    });
    await batch.commit();
    document.querySelector("#medicationAdministrationDialog").close();
    showToast("Medication administration documented.");
  } catch (_) {
    showToast("Unable to document administration.");
  } finally {
    button.disabled = false;
    button.textContent = "Document Administration";
  }
}

async function completeOrder(orderId) {
  const order = orderById(orderId);
  if (!order || !canCompleteOrder() || order.category === "medication") return;
  try {
    await updateDoc(doc(db, "orders", order.id), {
      status: "complete",
      completedAt: serverTimestamp(),
      completedBy: auth.currentUser.uid,
      completedByName: state.profile.displayName
    });
    await setDoc(doc(collection(db, "auditEvents")), {
      type: "order-completed",
      patientId: order.patientId,
      encounterId: order.encounterId,
      orderId: order.id,
      actorUid: auth.currentUser.uid,
      actorName: state.profile.displayName,
      at: serverTimestamp()
    });
    showToast("Order completed.");
  } catch (_) {
    showToast("Unable to complete order.");
  }
}

async function reviewResult(resultId) {
  const result = state.results.find((item) => item.id === resultId);
  if (!result || !canPhysician()) return;
  try {
    await updateDoc(doc(db, "results", result.id), {
      status: "reviewed",
      reviewedAt: serverTimestamp(),
      reviewedBy: auth.currentUser.uid,
      reviewedByName: state.profile.displayName
    });
    showToast("Result marked reviewed.");
  } catch (_) {
    showToast("Unable to review result.");
  }
}

function clinicalToolbar(encounter) {
  if (!encounter) return "";
  const actions = [];
  if (canPhysician()) actions.push(`<button class="secondary-button compact" type="button" data-physician-note="${safe(encounter.id)}">Physician Note</button>`);
  if (canNurse()) actions.push(`<button class="secondary-button compact" type="button" data-nursing-assessment="${safe(encounter.id)}">Nursing Assessment</button>`);
  if (canOrder()) actions.push(`<button class="primary-button compact" type="button" data-new-order="${safe(encounter.id)}">New Order</button>`);
  if (canEnterResult() && encounterItems(state.orders, encounter.id).length) actions.push(`<button class="secondary-button compact" type="button" data-new-result="${safe(encounter.id)}">Enter Result</button>`);
  return actions.join("");
}

function notesPane(encounter) {
  const notes = encounterItems(state.notes, encounter.id);
  const assessments = encounterItems(state.observations, encounter.id).filter((item) => item.type === "nursing-assessment");
  const combined = [
    ...notes.map((item) => ({ ...item, entryType: "note", sortAt: item.createdAt })),
    ...assessments.map((item) => ({ ...item, entryType: "assessment", sortAt: item.createdAt }))
  ].sort((a, b) => timeValue(b.sortAt) - timeValue(a.sortAt));

  if (!combined.length) return '<div class="clinical-empty"><strong>No clinical documentation</strong><p>Signed provider and nursing documentation will appear here.</p></div>';
  return `<div class="clinical-list">${combined.map((item) => {
    if (item.entryType === "assessment") {
      return `<article class="clinical-card"><div class="clinical-card-head"><div><h5>Nursing Focused Assessment</h5><p>${safe(item.authorName)} · ${safe(formatDateTime(item.createdAt))}</p></div><span class="clinical-badge">Nursing</span></div><div class="clinical-card-body"><div class="clinical-grid"><div class="clinical-field-group"><span>Mental Status</span><p>${safe(item.mentalStatus || "—")}</p></div><div class="clinical-field-group"><span>Respiratory</span><p>${safe(item.respiratory || "—")}</p></div><div class="clinical-field-group"><span>Cardiovascular</span><p>${safe(item.cardiovascular || "—")}</p></div><div class="clinical-field-group"><span>Pain</span><p>${safe(item.pain || "0")}/10</p></div></div><p><strong>Assessment:</strong> ${safe(item.note || "—")}</p></div></article>`;
    }
    return `<article class="clinical-card"><div class="clinical-card-head"><div><h5>${safe(item.title || "Physician Note")}</h5><p>${safe(item.authorName)} · ${safe(formatDateTime(item.createdAt))}</p></div><span class="clinical-badge">Provider</span></div><div class="clinical-card-body"><p><strong>HPI:</strong> ${safe(item.hpi || "—")}</p><p><strong>Exam:</strong> ${safe(item.exam || "—")}</p><p><strong>Differential:</strong> ${safe(item.differential || "—")}</p><p><strong>Assessment:</strong> ${safe(item.workingDiagnosis || "—")}</p><p><strong>Plan:</strong> ${safe(item.plan || "—")}</p></div></article>`;
  }).join("")}</div>`;
}

function ordersPane(encounter) {
  const orders = encounterItems(state.orders, encounter.id);
  if (!orders.length) return '<div class="clinical-empty"><strong>No orders entered</strong><p>Provider orders for this encounter will appear here.</p></div>';
  return `<div class="clinical-list">${orders.map((order) => {
    const actions = [];
    if (order.category === "medication" && canAdministerMedication()) actions.push(`<button class="clinical-mini-button" type="button" data-administer-medication="${safe(order.id)}">Administer</button>`);
    if (["laboratory", "imaging"].includes(order.category) && canEnterResult() && order.status !== "complete") actions.push(`<button class="clinical-mini-button" type="button" data-result-order="${safe(order.id)}">Enter Result</button>`);
    if (!["medication", "laboratory", "imaging"].includes(order.category) && canCompleteOrder() && order.status !== "complete") actions.push(`<button class="clinical-mini-button" type="button" data-complete-order="${safe(order.id)}">Complete</button>`);
    return `<article class="clinical-card"><div class="clinical-card-head"><div><h5>${safe(order.name)}</h5><p>${safe(formatStatus(order.category))} · Ordered by ${safe(order.orderedByName || "Northstar Staff")} · ${safe(formatDateTime(order.createdAt))}</p></div><span class="clinical-badge ${safe(order.priority || order.status)}">${safe(order.priority === "stat" ? "STAT" : formatStatus(order.status))}</span></div><div class="clinical-card-body">${order.category === "medication" ? `<p><strong>${safe(order.dose || "Dose not specified")}</strong> · ${safe(order.route || "Route not specified")} · ${safe(order.frequency || "No frequency")}</p>` : ""}${order.instructions ? `<p>${safe(order.instructions)}</p>` : ""}${actions.length ? `<div class="clinical-action-row">${actions.join("")}</div>` : ""}</div></article>`;
  }).join("")}</div>`;
}

function resultsPane(encounter) {
  const results = encounterItems(state.results, encounter.id);
  if (!results.length) return '<div class="clinical-empty"><strong>No finalized results</strong><p>Laboratory, imaging, and diagnostic results will appear here.</p></div>';
  return `<div class="clinical-list">${results.map((result) => `<article class="clinical-card"><div class="clinical-card-head"><div><h5>${safe(result.orderName || "Diagnostic Result")}</h5><p>${safe(result.enteredByName || "Diagnostic Services")} · ${safe(formatDateTime(result.createdAt))}</p></div><span class="clinical-badge ${result.abnormal ? "abnormal" : result.status === "reviewed" ? "reviewed" : "complete"}">${safe(result.abnormal ? "Abnormal" : formatStatus(result.status))}</span></div><div class="clinical-card-body"><p><strong>${safe(result.summary || "Result")}</strong></p><p>${safe(result.details || "—")}</p>${result.status !== "reviewed" && canPhysician() ? `<div class="clinical-action-row"><button class="clinical-mini-button" type="button" data-review-result="${safe(result.id)}">Mark Reviewed</button></div>` : result.reviewedByName ? `<p>Reviewed by ${safe(result.reviewedByName)} · ${safe(formatDateTime(result.reviewedAt))}</p>` : ""}</div></article>`).join("")}</div>`;
}

function marPane(encounter, patient) {
  const medicationOrders = encounterItems(state.orders, encounter.id).filter((order) => order.category === "medication");
  const administrations = encounterItems(state.administrations, encounter.id);
  if (!medicationOrders.length && !administrations.length) return '<div class="clinical-empty"><strong>No medication activity</strong><p>Medication orders and administrations will appear here.</p></div>';
  return `<div class="allergy-alert">Allergies: ${safe(patient.allergies || "NKDA")}</div><div class="clinical-list">${medicationOrders.map((order) => {
    const history = administrations.filter((item) => item.orderId === order.id);
    return `<article class="clinical-card"><div class="clinical-card-head"><div><h5>${safe(order.name)}</h5><p>${safe(order.dose || "Dose not specified")} · ${safe(order.route || "Route not specified")} · ${safe(order.frequency || "No frequency")}</p></div><span class="clinical-badge ${safe(order.status)}">${safe(formatStatus(order.status))}</span></div><div class="clinical-card-body">${canAdministerMedication() ? `<div class="clinical-action-row"><button class="clinical-mini-button" type="button" data-administer-medication="${safe(order.id)}">Document Administration</button></div>` : ""}${history.length ? `<p><strong>Administration history</strong></p>${history.map((item) => `<p>${safe(formatDateTime(item.administeredAt))} — ${safe(item.dose)} ${safe(item.route)} by ${safe(item.administeredByName)}${item.note ? ` · ${safe(item.note)}` : ""}</p>`).join("")}` : '<p>No administrations documented.</p>'}</div></article>`;
  }).join("")}</div>`;
}

function timelinePane(encounter) {
  const events = [];
  encounterItems(state.audits, encounter.id).forEach((item) => events.push({ at: item.at, title: auditTitle(item.type), detail: item.actorName || "Northstar Staff" }));
  encounterItems(state.notes, encounter.id).forEach((item) => events.push({ at: item.createdAt, title: "Physician note signed", detail: item.authorName || "Provider" }));
  encounterItems(state.observations, encounter.id).forEach((item) => events.push({ at: item.createdAt, title: "Nursing assessment documented", detail: item.authorName || "Nursing" }));
  encounterItems(state.orders, encounter.id).forEach((item) => events.push({ at: item.createdAt, title: `Order: ${item.name}`, detail: `${formatStatus(item.category)} · ${item.orderedByName || "Provider"}` }));
  encounterItems(state.results, encounter.id).forEach((item) => events.push({ at: item.createdAt, title: `Result: ${item.orderName}`, detail: item.summary || "Finalized" }));
  encounterItems(state.administrations, encounter.id).forEach((item) => events.push({ at: item.administeredAt, title: `Medication administered: ${item.medication}`, detail: `${item.dose || ""} ${item.route || ""} · ${item.administeredByName || "Nursing"}`.trim() }));
  events.sort((a, b) => timeValue(b.at) - timeValue(a.at));
  if (!events.length) return '<div class="clinical-empty"><strong>No clinical activity recorded</strong><p>Encounter activity will appear here as care is documented.</p></div>';
  return `<div class="timeline">${events.map((item) => `<div class="timeline-item"><strong>${safe(item.title)}</strong><span>${safe(formatDateTime(item.at))}</span>${item.detail ? `<p>${safe(item.detail)}</p>` : ""}</div>`).join("")}</div>`;
}

function auditTitle(type) {
  return {
    "patient-checked-in": "Patient checked in",
    "triage-completed": "Triage completed",
    "physician-note-signed": "Physician note signed",
    "nursing-assessment-completed": "Nursing assessment completed",
    "order-entered": "Clinical order entered",
    "order-completed": "Clinical order completed",
    "result-finalized": "Diagnostic result finalized",
    "medication-administered": "Medication administered",
    "encounter-closed": "Encounter closed"
  }[type] || formatStatus(type);
}

function renderClinicalWorkspace() {
  const dialog = document.querySelector("#patientChartDialog");
  const body = document.querySelector("#patientChartBody");
  if (!dialog?.open || !body) return;
  const patient = currentChartPatient();
  if (!patient) return;
  const encounter = activeEncounter(patient.id);
  let workspace = body.querySelector("#clinicalWorkspace");
  if (!workspace) {
    workspace = document.createElement("section");
    workspace.id = "clinicalWorkspace";
    workspace.className = "clinical-workspace";
    body.appendChild(workspace);
  }

  if (!encounter) {
    workspace.innerHTML = '<div class="clinical-empty"><strong>No active clinical encounter</strong><p>Clinical documentation is available when this patient is checked in.</p></div>';
    return;
  }

  const currentOrders = encounterItems(state.orders, encounter.id);
  const currentResults = encounterItems(state.results, encounter.id);
  const currentNotes = encounterItems(state.notes, encounter.id).length + encounterItems(state.observations, encounter.id).filter((item) => item.type === "nursing-assessment").length;
  const provider = encounter.providerName || "Unassigned";
  const diagnosis = encounter.workingDiagnosis || "Not established";

  workspace.innerHTML = `
    <div class="clinical-toolbar">
      <div class="clinical-toolbar-copy"><p class="eyebrow">Clinical Care</p><h4>Encounter Workspace</h4></div>
      <div class="clinical-toolbar-actions">${clinicalToolbar(encounter)}</div>
    </div>
    <div class="clinical-summary-strip">
      <div><span>Provider</span><strong>${safe(provider)}</strong></div>
      <div><span>Working Diagnosis</span><strong>${safe(diagnosis)}</strong></div>
      <div><span>Encounter Status</span><strong>${safe(formatStatus(encounter.status))}</strong></div>
    </div>
    <div class="clinical-tabs" role="tablist" aria-label="Clinical chart sections">
      <button class="clinical-tab ${state.activeTab === "notes" ? "active" : ""}" type="button" data-clinical-tab="notes">Notes (${currentNotes})</button>
      <button class="clinical-tab ${state.activeTab === "orders" ? "active" : ""}" type="button" data-clinical-tab="orders">Orders (${currentOrders.length})</button>
      <button class="clinical-tab ${state.activeTab === "results" ? "active" : ""}" type="button" data-clinical-tab="results">Results (${currentResults.length})</button>
      <button class="clinical-tab ${state.activeTab === "mar" ? "active" : ""}" type="button" data-clinical-tab="mar">MAR</button>
      <button class="clinical-tab ${state.activeTab === "timeline" ? "active" : ""}" type="button" data-clinical-tab="timeline">Timeline</button>
    </div>
    <div class="clinical-pane">${state.activeTab === "notes" ? notesPane(encounter) : state.activeTab === "orders" ? ordersPane(encounter) : state.activeTab === "results" ? resultsPane(encounter) : state.activeTab === "mar" ? marPane(encounter, patient) : timelinePane(encounter)}</div>`;
}

function renderOrdersPage() {
  const section = document.querySelector("#ordersSection");
  if (!section || !state.profile) return;
  const panel = section.querySelector(".panel");
  if (!panel) return;
  const activeIds = new Set(state.encounters.filter((item) => item.status !== "discharged").map((item) => item.id));
  const orders = state.orders.filter((item) => activeIds.has(item.encounterId)).sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt));
  if (!orders.length) {
    panel.innerHTML = '<div class="empty-state compact-empty"><h4>No active orders</h4><p>Orders for current encounters will appear here.</p></div>';
    return;
  }
  panel.innerHTML = `<div class="clinical-page-list">${orders.map((order) => {
    const actions = [];
    if (order.category === "medication" && canAdministerMedication()) actions.push(`<button class="clinical-mini-button" type="button" data-administer-medication="${safe(order.id)}">Administer</button>`);
    if (["laboratory", "imaging"].includes(order.category) && canEnterResult() && order.status !== "complete") actions.push(`<button class="clinical-mini-button" type="button" data-result-order="${safe(order.id)}">Enter Result</button>`);
    if (!["medication", "laboratory", "imaging"].includes(order.category) && canCompleteOrder() && order.status !== "complete") actions.push(`<button class="clinical-mini-button" type="button" data-complete-order="${safe(order.id)}">Complete</button>`);
    return `<div class="clinical-page-card"><div><p class="clinical-page-label">${safe(order.mrn || "Patient")}</p><strong>${safe(order.patientName || "Patient")}</strong><span>${safe(order.name)}${order.category === "medication" && order.dose ? ` · ${safe(order.dose)} ${safe(order.route || "")}` : ""}</span></div><div><p class="clinical-page-label">Type</p><strong>${safe(formatStatus(order.category))}</strong><span>${safe(order.priority === "stat" ? "STAT" : formatStatus(order.priority))}</span></div><div><p class="clinical-page-label">Status</p><span class="clinical-badge ${safe(order.status)}">${safe(formatStatus(order.status))}</span></div><div class="clinical-action-row">${actions.join("")}</div></div>`;
  }).join("")}</div>`;
}

function renderResultsPage() {
  const section = document.querySelector("#resultsSection");
  if (!section || !state.profile) return;
  const panel = section.querySelector(".panel");
  if (!panel) return;
  const results = [...state.results].sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt));
  if (!results.length) {
    panel.innerHTML = '<div class="empty-state compact-empty"><h4>No finalized results</h4><p>Diagnostic results will appear here when finalized.</p></div>';
    return;
  }
  panel.innerHTML = `<div class="clinical-page-list">${results.slice(0, 50).map((result) => `<div class="clinical-page-card"><div><p class="clinical-page-label">${safe(result.mrn || "Patient")}</p><strong>${safe(result.patientName || "Patient")}</strong><span>${safe(result.orderName || "Diagnostic Result")}</span></div><div><p class="clinical-page-label">Finding</p><strong>${safe(result.summary || "Finalized")}</strong><span>${safe(formatDateTime(result.createdAt))}</span></div><div><p class="clinical-page-label">Status</p><span class="clinical-badge ${result.abnormal ? "abnormal" : result.status === "reviewed" ? "reviewed" : "complete"}">${safe(result.abnormal ? "Abnormal" : formatStatus(result.status))}</span></div><div>${result.status !== "reviewed" && canPhysician() ? `<button class="clinical-mini-button" type="button" data-review-result="${safe(result.id)}">Review</button>` : ""}</div></div>`).join("")}</div>`;
}

function renderClinicalSurfaces() {
  renderClinicalWorkspace();
  renderOrdersPage();
  renderResultsPage();
}

const chartObserver = new MutationObserver(() => {
  if (!document.querySelector("#clinicalWorkspace")) renderClinicalWorkspace();
});

const chartBody = document.querySelector("#patientChartBody");
if (chartBody) chartObserver.observe(chartBody, { childList: true, subtree: false });

function bindGlobalActions() {
  document.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-clinical-tab]");
    if (tab) {
      state.activeTab = tab.dataset.clinicalTab;
      renderClinicalWorkspace();
      return;
    }
    const physician = event.target.closest("[data-physician-note]");
    if (physician) { openPhysicianNote(physician.dataset.physicianNote); return; }
    const nursing = event.target.closest("[data-nursing-assessment]");
    if (nursing) { openNursingAssessment(nursing.dataset.nursingAssessment); return; }
    const order = event.target.closest("[data-new-order]");
    if (order) { openOrderDialog(order.dataset.newOrder); return; }
    const newResult = event.target.closest("[data-new-result]");
    if (newResult) { openResultDialog(newResult.dataset.newResult); return; }
    const resultOrder = event.target.closest("[data-result-order]");
    if (resultOrder) {
      const selected = orderById(resultOrder.dataset.resultOrder);
      if (selected) openResultDialog(selected.encounterId, selected.id);
      return;
    }
    const medication = event.target.closest("[data-administer-medication]");
    if (medication) { openMedicationAdministration(medication.dataset.administerMedication); return; }
    const complete = event.target.closest("[data-complete-order]");
    if (complete) { completeOrder(complete.dataset.completeOrder); return; }
    const review = event.target.closest("[data-review-result]");
    if (review) reviewResult(review.dataset.reviewResult);
  });

  document.querySelector("#patientChartDialog")?.addEventListener("close", () => {
    state.activeTab = "notes";
  });
}

injectDialogs();
bindGlobalActions();

onAuthStateChanged(auth, async (user) => {
  stopListeners();
  state.profile = null;
  if (!user) {
    renderClinicalSurfaces();
    return;
  }
  try {
    const snapshot = await getDoc(doc(db, "users", user.uid));
    if (!snapshot.exists()) return;
    const profile = snapshot.data();
    if (profile.status !== "active") return;
    state.profile = profile;
    startListeners();
  } catch (_) {
    state.profile = null;
  }
});
