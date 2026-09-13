import { getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  onSnapshot,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);

const state = {
  profile: null,
  patients: [],
  selectedPatientId: null,
  unsubscribePatients: null,
  unsubscribeProfile: null
};

function safe(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function canEditPatients() {
  return state.profile?.status === "active" && ["administrator", "physician", "nurse", "registration"].includes(state.profile?.role);
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 3000);
}

function patientById(id) {
  return state.patients.find((patient) => patient.id === id) || null;
}

function injectStyles() {
  if (document.querySelector("#patientEditorStyles")) return;
  const style = document.createElement("style");
  style.id = "patientEditorStyles";
  style.textContent = `
    .patient-edit-context{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 16px;border:1px solid #d8e2e8;border-radius:12px;background:#f7fafc}.patient-edit-context strong{display:block;color:#0c3048}.patient-edit-context span{display:block;margin-top:3px;color:#647986;font-size:.86rem}.patient-edit-note{font-size:.82rem;color:#647986;margin:0}.chart-actions .edit-patient-button{white-space:nowrap}
  `;
  document.head.appendChild(style);
}

function injectDialog() {
  if (document.querySelector("#editPatientDialog")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <dialog id="editPatientDialog" class="modal">
      <form id="editPatientForm" class="modal-card">
        <div class="modal-header">
          <div><p class="eyebrow">Patient Record</p><h3>Edit Patient</h3></div>
          <button class="icon-button" type="button" data-close-patient-editor aria-label="Close">×</button>
        </div>
        <div class="modal-body form-grid">
          <div id="editPatientContext" class="patient-edit-context"></div>
          <div class="field-row">
            <label><span>First name</span><input id="editPatientFirstName" required></label>
            <label><span>Last name</span><input id="editPatientLastName" required></label>
          </div>
          <div class="field-row">
            <label><span>Date of birth</span><input id="editPatientDob" type="date" required></label>
            <label><span>Sex</span><select id="editPatientSex" required><option value="">Select</option><option>Female</option><option>Male</option><option>Other</option><option>Unknown</option></select></label>
          </div>
          <div class="field-row">
            <label><span>Phone</span><input id="editPatientPhone" type="tel" placeholder="Optional"></label>
            <label><span>Emergency contact</span><input id="editPatientEmergencyContact" placeholder="Optional"></label>
          </div>
          <label><span>Allergies</span><input id="editPatientAllergies" placeholder="NKDA or known allergies"></label>
          <label><span>Current medications</span><textarea id="editPatientMedications" rows="2" placeholder="None or current medications"></textarea></label>
          <label><span>Medical history</span><textarea id="editPatientHistory" rows="4" placeholder="Relevant roleplay history"></textarea></label>
          <p class="patient-edit-note">The medical record number and vital status are managed separately and cannot be changed here.</p>
        </div>
        <div class="modal-footer">
          <button class="secondary-button" type="button" data-close-patient-editor>Cancel</button>
          <button class="primary-button" type="submit">Save Patient</button>
        </div>
      </form>
    </dialog>`);

  document.querySelectorAll("[data-close-patient-editor]").forEach((button) => {
    button.addEventListener("click", () => document.querySelector("#editPatientDialog")?.close());
  });
  document.querySelector("#editPatientDialog")?.addEventListener("click", (event) => {
    if (event.target.id === "editPatientDialog") event.target.close();
  });
  document.querySelector("#editPatientForm")?.addEventListener("submit", savePatient);
}

function resolvePatientFromChart() {
  if (state.selectedPatientId && patientById(state.selectedPatientId)) return patientById(state.selectedPatientId);
  const chart = document.querySelector("#patientChartBody");
  if (!chart) return null;
  const mrn = chart.textContent.match(/NMC-\d+/)?.[0];
  if (!mrn) return null;
  const patient = state.patients.find((item) => item.mrn === mrn) || null;
  if (patient) state.selectedPatientId = patient.id;
  return patient;
}

function decorateChart() {
  const dialog = document.querySelector("#patientChartDialog");
  const chart = document.querySelector("#patientChartBody");
  if (!dialog?.open || !chart || !canEditPatients()) return;

  const patient = resolvePatientFromChart();
  if (!patient) return;
  const actions = chart.querySelector(".chart-actions");
  if (!actions || actions.querySelector("[data-edit-patient]")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-button edit-patient-button";
  button.dataset.editPatient = patient.id;
  button.textContent = "Edit Patient";
  actions.prepend(button);
}

function openEditor(patientId) {
  if (!canEditPatients()) return;
  const patient = patientById(patientId);
  if (!patient) {
    showToast("Patient record is not available.");
    return;
  }

  state.selectedPatientId = patientId;
  document.querySelector("#editPatientContext").innerHTML = `<div><strong>${safe(patient.lastName)}, ${safe(patient.firstName)}</strong><span>${safe(patient.mrn || "No MRN")}</span></div>`;
  document.querySelector("#editPatientFirstName").value = patient.firstName || "";
  document.querySelector("#editPatientLastName").value = patient.lastName || "";
  document.querySelector("#editPatientDob").value = patient.dob || "";
  document.querySelector("#editPatientSex").value = patient.sex || "Unknown";
  document.querySelector("#editPatientPhone").value = patient.phone || "";
  document.querySelector("#editPatientEmergencyContact").value = patient.emergencyContact || "";
  document.querySelector("#editPatientAllergies").value = patient.allergies || "";
  document.querySelector("#editPatientMedications").value = patient.medications || "";
  document.querySelector("#editPatientHistory").value = patient.medicalHistory || "";
  document.querySelector("#editPatientDialog").showModal();
}

async function savePatient(event) {
  event.preventDefault();
  if (!canEditPatients() || !state.selectedPatientId || !auth.currentUser) return;
  const patient = patientById(state.selectedPatientId);
  if (!patient) return;

  const submit = event.currentTarget.querySelector("button[type='submit']");
  const firstName = document.querySelector("#editPatientFirstName").value.trim().replace(/\s+/g, " ");
  const lastName = document.querySelector("#editPatientLastName").value.trim().replace(/\s+/g, " ");
  if (!firstName || !lastName) return;

  submit.disabled = true;
  submit.textContent = "Saving…";

  try {
    const batch = writeBatch(db);
    const patientRef = doc(db, "patients", patient.id);
    batch.update(patientRef, {
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`,
      dob: document.querySelector("#editPatientDob").value,
      sex: document.querySelector("#editPatientSex").value,
      phone: document.querySelector("#editPatientPhone").value.trim(),
      emergencyContact: document.querySelector("#editPatientEmergencyContact").value.trim(),
      allergies: document.querySelector("#editPatientAllergies").value.trim() || "NKDA",
      medications: document.querySelector("#editPatientMedications").value.trim() || "None",
      medicalHistory: document.querySelector("#editPatientHistory").value.trim() || "None documented",
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser.uid
    });

    if (patient.activeEncounterId) {
      const encounterRef = doc(db, "encounters", patient.activeEncounterId);
      const encounterSnapshot = await getDoc(encounterRef);
      if (encounterSnapshot.exists() && encounterSnapshot.data().status !== "discharged") {
        batch.update(encounterRef, {
          patientName: `${lastName}, ${firstName}`,
          updatedAt: serverTimestamp()
        });
      }
    }

    batch.set(doc(collection(db, "auditEvents")), {
      type: "patient-record-updated",
      patientId: patient.id,
      mrn: patient.mrn || "",
      actorUid: auth.currentUser.uid,
      actorName: state.profile?.displayName || auth.currentUser.displayName || "Northstar Staff",
      at: serverTimestamp()
    });

    await batch.commit();
    document.querySelector("#editPatientDialog").close();
    showToast("Patient record updated.");
  } catch (error) {
    console.error("Northstar patient update failed", error);
    showToast(error?.code === "permission-denied" ? "Patient changes were blocked by the current Firestore rules." : "Unable to update this patient record.");
  } finally {
    submit.disabled = false;
    submit.textContent = "Save Patient";
  }
}

function stopListeners() {
  if (state.unsubscribePatients) state.unsubscribePatients();
  if (state.unsubscribeProfile) state.unsubscribeProfile();
  state.unsubscribePatients = null;
  state.unsubscribeProfile = null;
  state.profile = null;
  state.patients = [];
}

function start(user) {
  stopListeners();
  if (!user) return;

  state.unsubscribeProfile = onSnapshot(doc(db, "users", user.uid), (snapshot) => {
    state.profile = snapshot.exists() ? snapshot.data() : null;
    queueMicrotask(decorateChart);
  });

  state.unsubscribePatients = onSnapshot(collection(db, "patients"), (snapshot) => {
    state.patients = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    queueMicrotask(decorateChart);
  });
}

injectStyles();
injectDialog();

document.addEventListener("click", (event) => {
  const patientLink = event.target.closest("[data-patient-id]");
  if (patientLink) {
    state.selectedPatientId = patientLink.dataset.patientId;
    setTimeout(decorateChart, 0);
  }

  const editButton = event.target.closest("[data-edit-patient]");
  if (editButton) {
    openEditor(editButton.dataset.editPatient);
  }
});

const chartDialog = document.querySelector("#patientChartDialog");
const chartBody = document.querySelector("#patientChartBody");
if (chartDialog) {
  new MutationObserver(decorateChart).observe(chartDialog, { attributes: true, attributeFilter: ["open"] });
}
if (chartBody) {
  new MutationObserver(decorateChart).observe(chartBody, { childList: true, subtree: true });
}

onAuthStateChanged(auth, start);
