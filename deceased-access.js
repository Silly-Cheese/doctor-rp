import { getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);

const state = { profile: null, patients: [], encounters: [], users: [], selectedPatientId: null, unsubscribers: [], renderQueued: false, deniedPatientId: null };

const ROLE_LABELS = { administrator: "Administrator", physician: "Physician", nurse: "Registered Nurse", registration: "Registration", technician: "Clinical Technician", staff: "Clinical Staff" };

function safe(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function isAdmin() { return state.profile?.role === "administrator" && state.profile?.status === "active"; }
function isDeceased(patient) { return patient?.vitalStatus === "deceased" || patient?.currentStatus === "deceased"; }
function patientById(id) { return state.patients.find(p => p.id === id) || null; }
function activeEncounter(patientId) { return state.encounters.find(e => e.patientId === patientId && e.status !== "discharged") || null; }
function grantedUids(patient) { return Array.isArray(patient?.deceasedAccessUids) ? patient.deceasedAccessUids : []; }
function canView(patient) { if (!patient) return false; if (!isDeceased(patient) || patient.recordConfidential !== true) return true; return isAdmin() || grantedUids(patient).includes(auth.currentUser?.uid); }
function showToast(message) { const t = document.querySelector("#toast"); if (!t) return; t.textContent = message; t.classList.add("show"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => t.classList.remove("show"), 3200); }

window.NorthstarPatientAccess = {
  canView(value) { const patient = typeof value === "string" ? patientById(value) : value; return canView(patient); },
  isRestricted(value) { const patient = typeof value === "string" ? patientById(value) : value; return Boolean(patient && isDeceased(patient) && patient.recordConfidential === true); }
};

function ensureAssets() {
  if (!document.querySelector('link[href="deceased-access.css"]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "deceased-access.css"; document.head.appendChild(l); }
  if (!document.querySelector("#deceasedAccessDialog")) {
    document.body.insertAdjacentHTML("beforeend", `
      <dialog id="deceasedAccessDialog" class="modal">
        <form id="deceasedAccessForm" class="modal-card">
          <div class="modal-header"><div><p class="eyebrow">Confidential Record</p><h3>Deceased Patient Access</h3></div><button class="icon-button" type="button" data-close-deceased-access aria-label="Close">×</button></div>
          <div class="modal-body form-grid">
            <div id="deceasedAccessContext" class="deceased-access-context"></div>
            <p class="form-banner">Administrators always retain access. Select the staff members who may open this deceased patient's record. Access can be revoked at any time.</p>
            <div id="deceasedAccessList" class="deceased-access-list"></div>
          </div>
          <div class="modal-footer"><button class="secondary-button" type="button" data-close-deceased-access>Cancel</button><button class="primary-button" type="submit">Save Record Access</button></div>
        </form>
      </dialog>`);
    document.querySelectorAll("[data-close-deceased-access]").forEach(b => b.addEventListener("click", () => document.querySelector("#deceasedAccessDialog")?.close()));
    document.querySelector("#deceasedAccessForm")?.addEventListener("submit", saveAccess);
  }
  const warning = document.querySelector("#deceasedDialog .deceased-warning");
  if (warning) warning.innerHTML = '<strong>This will close the encounter, block future check-ins, and seal the patient record.</strong><span>The entire patient account becomes confidential. Only Administrators and staff explicitly granted access by an Administrator will be able to open it.</span>';
}

function selectedPatient() { return patientById(state.selectedPatientId); }

function openAccessManager(patientId) {
  if (!isAdmin()) return;
  const patient = patientById(patientId || state.selectedPatientId);
  if (!patient || !isDeceased(patient)) return;
  state.selectedPatientId = patient.id;
  const allowed = new Set(grantedUids(patient));
  document.querySelector("#deceasedAccessContext").innerHTML = `<strong>${safe(patient.lastName)}, ${safe(patient.firstName)}</strong><span>${safe(patient.mrn || "")} · Confidential deceased record</span>`;
  const users = state.users.filter(u => u.status === "active" && u.role !== "administrator" && (u.uid || u.id) !== auth.currentUser?.uid).sort((a,b) => String(a.displayName || "").localeCompare(String(b.displayName || "")));
  document.querySelector("#deceasedAccessList").innerHTML = users.length ? users.map(user => {
    const uid = user.uid || user.id;
    const initials = String(user.displayName || "NS").split(/\s+/).map(x => x[0]).slice(0,2).join("").toUpperCase();
    return `<label class="deceased-access-row"><input type="checkbox" data-deceased-access-user="${safe(uid)}" ${allowed.has(uid) ? "checked" : ""}><span class="deceased-access-avatar">${safe(initials)}</span><span><strong>${safe(user.displayName || "Staff Member")}</strong><span>${safe(ROLE_LABELS[user.role] || user.role || "Clinical Staff")} · ${safe(user.email || "")}</span></span></label>`;
  }).join("") : '<div class="deceased-access-empty">No other active staff accounts are available.</div>';
  document.querySelector("#deceasedAccessDialog")?.showModal();
}

async function saveAccess(event) {
  event.preventDefault();
  if (!isAdmin()) return;
  const patient = selectedPatient();
  if (!patient || !isDeceased(patient)) return;
  const uids = [...document.querySelectorAll("[data-deceased-access-user]:checked")].map(input => input.dataset.deceasedAccessUser);
  const button = event.currentTarget.querySelector("button[type='submit']");
  button.disabled = true; button.textContent = "Saving…";
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "patients", patient.id), { recordConfidential: true, deceasedAccessUids: uids, deceasedAccessUpdatedAt: serverTimestamp(), deceasedAccessUpdatedBy: auth.currentUser.uid, deceasedAccessUpdatedByName: state.profile.displayName, updatedAt: serverTimestamp() });
    batch.set(doc(collection(db, "auditEvents")), { type: "deceased-record-access-updated", patientId: patient.id, mrn: patient.mrn || "", grantedUids: uids, actorUid: auth.currentUser.uid, actorName: state.profile.displayName, at: serverTimestamp() });
    await batch.commit();
    document.querySelector("#deceasedAccessDialog")?.close();
    showToast("Deceased record access updated.");
  } catch (_) { showToast("Unable to update deceased record access."); }
  finally { button.disabled = false; button.textContent = "Save Record Access"; }
}

async function secureMarkDeceased(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
  const patient = selectedPatient();
  if (!patient || isDeceased(patient) || !["administrator","physician"].includes(state.profile?.role)) return;
  const form = event.target;
  const button = form.querySelector("button[type='submit']");
  const raw = document.querySelector("#deceasedAt")?.value;
  const deathAt = raw ? new Date(raw) : new Date();
  const cause = document.querySelector("#deceasedCause")?.value.trim() || "";
  const note = document.querySelector("#deceasedNote")?.value.trim() || "";
  const encounter = activeEncounter(patient.id);
  button.disabled = true; button.textContent = "Sealing Record…";
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "patients", patient.id), {
      vitalStatus: "deceased", currentStatus: "deceased", activeEncounterId: null, currentEncounterStatus: null,
      deceasedAt: deathAt, deceasedCause: cause, deceasedNote: note, deceasedBy: auth.currentUser.uid, deceasedByName: state.profile.displayName,
      recordConfidential: true, recordConfidentialReason: "deceased", recordConfidentialAt: serverTimestamp(), recordConfidentialBy: auth.currentUser.uid, recordConfidentialByName: state.profile.displayName,
      deceasedAccessUids: [], deceasedAccessUpdatedAt: serverTimestamp(), deceasedAccessUpdatedBy: auth.currentUser.uid, deceasedAccessUpdatedByName: state.profile.displayName,
      updatedAt: serverTimestamp()
    });
    if (encounter) batch.update(doc(db, "encounters", encounter.id), { status: "discharged", disposition: "deceased", finalDiagnosis: encounter.workingDiagnosis || encounter.finalDiagnosis || "Deceased", deathPronouncement: note, deceasedAt: deathAt, dischargedAt: serverTimestamp(), dischargedBy: auth.currentUser.uid, dischargedByName: state.profile.displayName, updatedAt: serverTimestamp() });
    batch.set(doc(collection(db, "auditEvents")), { type: "patient-deceased-record-sealed", patientId: patient.id, mrn: patient.mrn || "", encounterId: encounter?.id || null, actorUid: auth.currentUser.uid, actorName: state.profile.displayName, at: serverTimestamp() });
    await batch.commit();
    document.querySelector("#deceasedDialog")?.close();
    document.querySelector("#patientChartDialog")?.close();
    showToast("Patient marked deceased. The complete record is now confidential.");
  } catch (_) { showToast("Unable to mark this patient deceased."); }
  finally { button.disabled = false; button.textContent = "Mark Deceased"; }
}

async function secureRestore(event) {
  event.preventDefault(); event.stopImmediatePropagation();
  if (!isAdmin()) return;
  const patient = selectedPatient();
  if (!patient || !isDeceased(patient)) return;
  if (!window.confirm(`Restore ${patient.firstName || "this patient"} ${patient.lastName || ""} to active status and remove deceased-record restrictions?`)) return;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "patients", patient.id), { vitalStatus: "active", currentStatus: "not-checked-in", activeEncounterId: null, currentEncounterStatus: null, recordConfidential: false, recordConfidentialReason: null, deceasedAccessUids: [], vitalStatusRestoredAt: serverTimestamp(), vitalStatusRestoredBy: auth.currentUser.uid, vitalStatusRestoredByName: state.profile.displayName, updatedAt: serverTimestamp() });
    batch.set(doc(collection(db, "auditEvents")), { type: "patient-deceased-status-reversed", patientId: patient.id, mrn: patient.mrn || "", actorUid: auth.currentUser.uid, actorName: state.profile.displayName, at: serverTimestamp() });
    await batch.commit();
    showToast("Patient restored to active status. Deceased-record restrictions removed.");
  } catch (_) { showToast("Unable to restore this patient record."); }
}

function renderVaultPanel() {
  const dialog = document.querySelector("#patientChartDialog");
  const body = document.querySelector("#patientChartBody");
  if (!dialog?.open || !body) return;
  const patient = selectedPatient();
  if (!patient || !isDeceased(patient) || patient.recordConfidential !== true) { body.querySelector("#deceasedVaultPanel")?.remove(); return; }
  if (!canView(patient)) {
    dialog.close();
    if (state.deniedPatientId !== patient.id) { state.deniedPatientId = patient.id; showToast("This deceased patient record is confidential. Administrator-granted access is required."); }
    return;
  }
  state.deniedPatientId = null;
  let panel = body.querySelector("#deceasedVaultPanel");
  if (!panel) { panel = document.createElement("section"); panel.id = "deceasedVaultPanel"; body.prepend(panel); }
  const access = grantedUids(patient);
  panel.className = `deceased-vault-panel ${isAdmin() ? "admin" : "authorized"}`;
  panel.innerHTML = `<div class="deceased-vault-head"><div><strong>CONFIDENTIAL DECEASED RECORD</strong><span>${isAdmin() ? "Administrator access · you control which staff members may open this complete patient account." : "Access to this complete deceased patient account was granted by an Administrator."}</span></div><span class="deceased-vault-badge">Restricted</span></div><div class="deceased-vault-actions"><small>${isAdmin() ? `${access.length} non-administrator staff member${access.length === 1 ? "" : "s"} currently authorized` : "Do not share or leave this record unattended."}</small>${isAdmin() ? `<button class="secondary-button compact" type="button" data-manage-deceased-access="${safe(patient.id)}">Manage Record Access</button>` : ""}</div>`;
}

function applyVisibility() {
  const uid = auth.currentUser?.uid;
  if (!uid || !state.profile) return;
  document.querySelectorAll("[data-patient-id]").forEach(node => {
    const patient = patientById(node.dataset.patientId);
    const hide = patient && isDeceased(patient) && patient.recordConfidential === true && !canView(patient);
    node.classList.toggle("deceased-record-hidden", Boolean(hide));
  });
  document.querySelectorAll("[data-command-patient]").forEach(node => {
    const patient = patientById(node.dataset.commandPatient);
    node.classList.toggle("deceased-record-hidden", Boolean(patient && isDeceased(patient) && patient.recordConfidential === true && !canView(patient)));
  });
  renderVaultPanel();
}

function blockRestrictedOpen(event) {
  const target = event.target.closest?.("[data-patient-id],[data-open-platform-patient],[data-command-patient]");
  if (!target) return;
  const id = target.dataset.patientId || target.dataset.openPlatformPatient || target.dataset.commandPatient;
  const patient = patientById(id);
  if (!patient) return;
  state.selectedPatientId = id;
  if (canView(patient)) { setTimeout(scheduleRender, 0); return; }
  event.preventDefault(); event.stopImmediatePropagation();
  showToast("This deceased patient record is confidential. An Administrator must grant you access.");
}

function scheduleRender() { if (state.renderQueued) return; state.renderQueued = true; requestAnimationFrame(() => { state.renderQueued = false; ensureAssets(); applyVisibility(); }); }
function stopListeners() { state.unsubscribers.forEach(u => { try { u(); } catch (_) {} }); state.unsubscribers = []; state.patients = []; state.encounters = []; state.users = []; }
function bind(name,key) { const u = onSnapshot(collection(db,name), snap => { state[key] = snap.docs.map(d => ({ id:d.id, ...d.data() })); scheduleRender(); }, () => { state[key] = []; scheduleRender(); }); state.unsubscribers.push(u); }
async function start(user) { stopListeners(); state.profile = null; if (!user) return; const p = await getDoc(doc(db,"users",user.uid)); if (!p.exists()) return; state.profile = { id:p.id, ...p.data() }; if (state.profile.status !== "active") return; bind("patients","patients"); bind("encounters","encounters"); bind("users","users"); scheduleRender(); }

ensureAssets();
document.addEventListener("click", blockRestrictedOpen, true);
document.addEventListener("click", event => {
  const manage = event.target.closest?.("[data-manage-deceased-access]");
  if (manage) { event.preventDefault(); openAccessManager(manage.dataset.manageDeceasedAccess); }
}, true);
document.addEventListener("submit", event => { if (event.target?.id === "deceasedForm") secureMarkDeceased(event); }, true);
document.addEventListener("click", event => { if (event.target.closest?.("[data-restore-patient]")) secureRestore(event); }, true);
const chart = document.querySelector("#patientChartBody"); if (chart) new MutationObserver(scheduleRender).observe(chart,{childList:true,subtree:true});
const chartDialog = document.querySelector("#patientChartDialog"); if (chartDialog) new MutationObserver(scheduleRender).observe(chartDialog,{attributes:true,attributeFilter:["open"]});
const patientResults = document.querySelector("#patientResults"); if (patientResults) new MutationObserver(scheduleRender).observe(patientResults,{childList:true,subtree:true});
const commandResults = document.querySelector("#northstarCommandResults"); if (commandResults) new MutationObserver(scheduleRender).observe(commandResults,{childList:true,subtree:true});
onAuthStateChanged(auth,user => start(user).catch(() => { stopListeners(); state.profile = null; }));
