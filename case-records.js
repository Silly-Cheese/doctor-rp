import { getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);

const state = {
  profile: null,
  patients: [],
  encounters: [],
  notes: [],
  observations: [],
  orders: [],
  results: [],
  administrations: [],
  procedures: [],
  audits: [],
  selectedPatientId: null,
  selectedEncounterId: null,
  setupMode: "set",
  unsubscribers: [],
  renderQueued: false
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
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatStatus(value) {
  return String(value || "—").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 3300);
}

function patientById(id) {
  return state.patients.find((item) => item.id === id) || null;
}

function encounterById(id) {
  return state.encounters.find((item) => item.id === id) || null;
}

function itemsFor(list, encounterId, timeFields = ["createdAt", "at", "administeredAt", "completedAt"]) {
  return list
    .filter((item) => item.encounterId === encounterId)
    .sort((a, b) => {
      const av = timeFields.map((field) => timeValue(a[field])).find(Boolean) || 0;
      const bv = timeFields.map((field) => timeValue(b[field])).find(Boolean) || 0;
      return bv - av;
    });
}

function isActiveEncounter(encounter) {
  return encounter && encounter.status !== "discharged";
}

function isConfidential(encounter) {
  return encounter?.confidential === true;
}

function isPermanentlyLocked(encounter) {
  return encounter?.permanentlyLocked === true;
}

function isAdministrator() {
  return state.profile?.status === "active" && state.profile?.role === "administrator";
}

function canActAsPhysician() {
  return state.profile?.status === "active" && ["physician", "administrator"].includes(state.profile?.role);
}

function canManageConfidential(encounter) {
  if (!canActAsPhysician() || isPermanentlyLocked(encounter)) return false;
  if (isAdministrator()) return true;
  if (isActiveEncounter(encounter)) return !encounter.providerUid || encounter.providerUid === auth.currentUser?.uid;
  return encounter.providerUid === auth.currentUser?.uid;
}

function accessKey(encounter) {
  return `northstar-case-access:${auth.currentUser?.uid || "anon"}:${encounter.id}`;
}

function authorizationSessionToken(encounter) {
  return `${encounter.authorizationHash || ""}:${Number(encounter.authorizationEpoch || 0)}`;
}

function hasSessionAccess(encounter) {
  if (!isConfidential(encounter)) return true;
  if (!encounter.authorizationHash || isPermanentlyLocked(encounter)) return false;
  return sessionStorage.getItem(accessKey(encounter)) === authorizationSessionToken(encounter);
}

function grantSessionAccess(encounter) {
  if (encounter.authorizationHash) sessionStorage.setItem(accessKey(encounter), authorizationSessionToken(encounter));
}

function revokeSessionAccess(encounter) {
  sessionStorage.removeItem(accessKey(encounter));
}

function ensureAssets() {
  if (!document.querySelector('link[href="case-records.css"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "case-records.css";
    document.head.appendChild(link);
  }
}

function injectDialogs() {
  if (document.querySelector("#caseRecordDialog")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <dialog id="caseRecordDialog" class="case-dialog">
      <div class="case-dialog-card">
        <div class="case-dialog-header">
          <div><p class="eyebrow">Northstar Case Record</p><h3 id="caseRecordTitle">Case Record</h3><div id="caseRecordSubhead" class="case-subhead"></div></div>
          <button class="icon-button" type="button" data-close-case="caseRecordDialog" aria-label="Close">×</button>
        </div>
        <div id="caseRecordBody" class="case-dialog-body"></div>
      </div>
    </dialog>

    <dialog id="caseAuthorizationDialog" class="modal">
      <form id="caseAuthorizationForm" class="modal-card">
        <div class="modal-header">
          <div><p class="eyebrow">Restricted Case</p><h3>Authorization Required</h3></div>
          <button class="icon-button" type="button" data-close-case="caseAuthorizationDialog" aria-label="Close">×</button>
        </div>
        <div class="modal-body form-grid">
          <div id="caseAuthorizationContext" class="patient-context"></div>
          <div class="case-lock-warning"><strong>CONFIDENTIAL</strong> — This case requires the authorization code established by the physician.</div>
          <label><span>Authorization code</span><input id="caseAuthorizationCode" type="password" autocomplete="off" required maxlength="64" placeholder="Enter authorization code"></label>
          <p id="caseAuthorizationAttempts" class="case-code-note"></p>
        </div>
        <div class="modal-footer">
          <button class="secondary-button" type="button" data-close-case="caseAuthorizationDialog">Cancel</button>
          <button class="primary-button" type="submit">Authorize Access</button>
        </div>
      </form>
    </dialog>

    <dialog id="caseConfidentialSetupDialog" class="modal">
      <form id="caseConfidentialSetupForm" class="modal-card">
        <div class="modal-header">
          <div><p class="eyebrow">Case Security</p><h3 id="caseConfidentialSetupTitle">Mark Case Confidential</h3></div>
          <button class="icon-button" type="button" data-close-case="caseConfidentialSetupDialog" aria-label="Close">×</button>
        </div>
        <div class="modal-body form-grid case-code-form">
          <div id="caseConfidentialSetupContext" class="patient-context"></div>
          <div class="case-lock-warning">After three incorrect authorization-code attempts, this case will be permanently locked until an Administrator unlocks it.</div>
          <label><span>Authorization code</span><input id="newCaseAuthorizationCode" type="password" autocomplete="new-password" minlength="4" maxlength="64" required></label>
          <label><span>Confirm authorization code</span><input id="confirmCaseAuthorizationCode" type="password" autocomplete="new-password" minlength="4" maxlength="64" required></label>
          <p class="case-code-note">Codes are case-sensitive. The code itself is not stored in plain text and cannot be displayed later.</p>
        </div>
        <div class="modal-footer">
          <button class="secondary-button" type="button" data-close-case="caseConfidentialSetupDialog">Cancel</button>
          <button class="primary-button" type="submit">Save Confidential Access</button>
        </div>
      </form>
    </dialog>

    <dialog id="caseAdminUnlockDialog" class="modal">
      <form id="caseAdminUnlockForm" class="modal-card">
        <div class="modal-header">
          <div><p class="eyebrow">Administrator Review</p><h3>Unlock Confidential Case</h3></div>
          <button class="icon-button" type="button" data-close-case="caseAdminUnlockDialog" aria-label="Close">×</button>
        </div>
        <div class="modal-body form-grid">
          <div id="caseAdminUnlockContext" class="patient-context"></div>
          <div class="case-lock-warning"><strong>Permanent lock override</strong><br>This resets the failed-attempt counter. The authorization code will still be required, and all previously authorized browser sessions will be revoked.</div>
          <label><span>Unlock reason</span><textarea id="caseAdminUnlockReason" rows="4" minlength="5" required placeholder="Document why the permanent lock is being removed"></textarea></label>
        </div>
        <div class="modal-footer">
          <button class="secondary-button" type="button" data-close-case="caseAdminUnlockDialog">Cancel</button>
          <button class="danger-button" type="submit">Remove Permanent Lock</button>
        </div>
      </form>
    </dialog>`);

  document.querySelector("#caseAuthorizationForm")?.addEventListener("submit", submitAuthorization);
  document.querySelector("#caseConfidentialSetupForm")?.addEventListener("submit", submitConfidentialSetup);
  document.querySelector("#caseAdminUnlockForm")?.addEventListener("submit", submitAdminUnlock);
  document.querySelectorAll("[data-close-case]").forEach((button) => {
    button.addEventListener("click", () => document.querySelector(`#${button.dataset.closeCase}`)?.close());
  });
  ["caseRecordDialog", "caseAuthorizationDialog", "caseConfidentialSetupDialog", "caseAdminUnlockDialog"].forEach((id) => {
    document.querySelector(`#${id}`)?.addEventListener("click", (event) => {
      if (event.target.id === id) event.target.close();
    });
  });
}

function currentChartPatient() {
  if (state.selectedPatientId && patientById(state.selectedPatientId)) return patientById(state.selectedPatientId);
  const body = document.querySelector("#patientChartBody");
  if (!body) return null;
  const text = body.textContent || "";
  const patient = state.patients.find((item) => item.mrn && text.includes(item.mrn)) || null;
  if (patient) state.selectedPatientId = patient.id;
  return patient;
}

function caseArchiveFingerprint(patient, encounters) {
  return JSON.stringify(encounters.map((encounter) => ({
    id: encounter.id,
    status: encounter.status || "",
    confidential: !!encounter.confidential,
    locked: !!encounter.permanentlyLocked,
    attempts: Number(encounter.failedAuthorizationAttempts || 0),
    hash: encounter.authorizationHash || "",
    epoch: Number(encounter.authorizationEpoch || 0),
    updatedAt: encounter.updatedAt?.seconds || 0
  }))) + patient.id;
}

function renderArchive() {
  const chartDialog = document.querySelector("#patientChartDialog");
  const chartBody = document.querySelector("#patientChartBody");
  if (!chartDialog?.open || !chartBody || !state.profile) return;

  const patient = currentChartPatient();
  if (!patient) return;
  const encounters = state.encounters
    .filter((encounter) => encounter.patientId === patient.id)
    .sort((a, b) => timeValue(b.arrivalAt) - timeValue(a.arrivalAt));

  const originalHistory = chartBody.querySelector(".history-section");
  if (originalHistory) originalHistory.style.display = "none";

  let section = chartBody.querySelector("#completeCaseArchive");
  if (!section) {
    section = document.createElement("section");
    section.id = "completeCaseArchive";
    section.className = "chart-section case-archive";
    chartBody.appendChild(section);
  }

  const fingerprint = caseArchiveFingerprint(patient, encounters);
  if (section.dataset.fingerprint === fingerprint) return;
  section.dataset.fingerprint = fingerprint;

  section.innerHTML = `
    <div class="case-archive-head">
      <div><p class="eyebrow">Longitudinal Record</p><h4>Complete Case Archive</h4></div>
      <span class="muted">${encounters.length} case${encounters.length === 1 ? "" : "s"}</span>
    </div>
    ${encounters.length ? `<div class="case-archive-list">${encounters.map((encounter) => archiveRow(encounter)).join("")}</div>` : '<div class="chart-empty"><p>No encounters have been recorded for this patient.</p></div>'}`;
}

function archiveRow(encounter) {
  const confidential = isConfidential(encounter);
  const locked = isPermanentlyLocked(encounter);
  const active = isActiveEncounter(encounter);
  const providerCanManage = canManageConfidential(encounter);
  const className = locked ? "locked" : confidential ? "confidential" : "";
  const security = locked
    ? '<span class="case-security-badge locked">Permanently Locked</span>'
    : confidential
      ? '<span class="case-security-badge confidential">Confidential</span>'
      : '<span class="case-security-badge standard">Standard</span>';
  const authorized = hasSessionAccess(encounter);
  const secondary = confidential && !authorized
    ? (locked ? "Protected case contents unavailable until Administrator unlock" : "Protected encounter details hidden — authorization required")
    : `${encounter.chiefComplaint || "No chief complaint entered"}${encounter.finalDiagnosis || encounter.workingDiagnosis ? ` · ${encounter.finalDiagnosis || encounter.workingDiagnosis}` : ""}`;
  const departmentLabel = confidential && !authorized ? "Restricted Case" : (encounter.department || "Emergency Department");
  const statusLabel = locked ? "Locked" : confidential && !authorized ? "Authorization Required" : (active ? formatStatus(encounter.status) : formatStatus(encounter.disposition || "Closed"));
  const openLabel = locked ? "Review Lock" : confidential && !authorized ? "Authorize & Open" : "Open Full Case";

  return `
    <article class="case-archive-row ${className}">
      <div class="case-archive-primary">
        <div>${security}</div>
        <strong>${safe(formatDateTime(encounter.arrivalAt))}${active ? " · Current Case" : ""}</strong>
        <span>${safe(secondary)}</span>
      </div>
      <div class="case-archive-meta">
        <span>${safe(departmentLabel)}</span>
        <strong>${safe(statusLabel)}</strong>
      </div>
      <div class="case-archive-actions">
        ${providerCanManage && !confidential ? `<button class="secondary-button compact" type="button" data-mark-case-confidential="${safe(encounter.id)}">Mark Confidential</button>` : ""}
        ${providerCanManage && confidential ? `<button class="secondary-button compact" type="button" data-change-case-code="${safe(encounter.id)}">Change Code</button>` : ""}
        <button class="primary-button compact" type="button" data-open-case-record="${safe(encounter.id)}">${safe(openLabel)}</button>
      </div>
    </article>`;
}

function scheduleRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => {
    state.renderQueued = false;
    renderArchive();
  });
}

async function openCaseRecord(encounterId) {
  const encounter = encounterById(encounterId);
  if (!encounter) return;
  state.selectedEncounterId = encounterId;

  if (isConfidential(encounter)) {
    if (isPermanentlyLocked(encounter)) {
      renderLockedCase(encounter);
      return;
    }
    if (!hasSessionAccess(encounter)) {
      openAuthorizationDialog(encounter);
      return;
    }
  }
  renderFullCase(encounter);
}

function openAuthorizationDialog(encounter) {
  const patient = patientById(encounter.patientId);
  state.selectedEncounterId = encounter.id;
  const attempts = Number(encounter.failedAuthorizationAttempts || 0);
  document.querySelector("#caseAuthorizationForm")?.reset();
  document.querySelector("#caseAuthorizationContext").innerHTML = `<strong>${safe(patient?.lastName)}, ${safe(patient?.firstName)}</strong><span>${safe(patient?.mrn || "")} · ${safe(formatDateTime(encounter.arrivalAt))}</span>`;
  document.querySelector("#caseAuthorizationAttempts").textContent = attempts ? `${3 - attempts} authorization attempt${3 - attempts === 1 ? "" : "s"} remaining before permanent lock.` : "Three incorrect attempts will permanently lock this case.";
  document.querySelector("#caseAuthorizationDialog").showModal();
  setTimeout(() => document.querySelector("#caseAuthorizationCode")?.focus(), 50);
}

function renderLockedCase(encounter) {
  const patient = patientById(encounter.patientId);
  document.querySelector("#caseRecordTitle").textContent = `${patient?.lastName || "Patient"}, ${patient?.firstName || ""}`.trim();
  document.querySelector("#caseRecordSubhead").textContent = `${patient?.mrn || ""} · ${formatDateTime(encounter.arrivalAt)}`;
  document.querySelector("#caseRecordBody").innerHTML = `
    <div class="case-gate locked">
      <div class="case-gate-icon">!</div>
      <h4>Case Permanently Locked</h4>
      <p>Three incorrect authorization codes were entered. Case contents are unavailable until an Administrator removes the permanent lock.</p>
      ${isAdministrator() ? '<button class="danger-button" type="button" data-admin-unlock-case>Administrator Review & Unlock</button>' : ""}
    </div>`;
  document.querySelector("#caseRecordDialog").showModal();
}

function caseSummary(encounter, patient) {
  const triage = encounter.triage || {};
  return `
    <div class="case-summary-grid">
      <div class="case-summary-item"><span>Patient</span><strong>${safe(patient?.lastName)}, ${safe(patient?.firstName)}</strong></div>
      <div class="case-summary-item"><span>MRN</span><strong>${safe(patient?.mrn || "—")}</strong></div>
      <div class="case-summary-item"><span>Arrival</span><strong>${safe(formatDateTime(encounter.arrivalAt))}</strong></div>
      <div class="case-summary-item"><span>Disposition</span><strong>${safe(isActiveEncounter(encounter) ? formatStatus(encounter.status) : formatStatus(encounter.disposition || "Closed"))}</strong></div>
      <div class="case-summary-item"><span>Chief Complaint</span><strong>${safe(encounter.chiefComplaint || "—")}</strong></div>
      <div class="case-summary-item"><span>Provider</span><strong>${safe(encounter.providerName || "Not documented")}</strong></div>
      <div class="case-summary-item"><span>Diagnosis</span><strong>${safe(encounter.finalDiagnosis || encounter.workingDiagnosis || "—")}</strong></div>
      <div class="case-summary-item"><span>Acuity / Room</span><strong>${triage.acuity ? `ESI ${safe(triage.acuity)} · ` : ""}${safe(encounter.room || triage.room || "—")}</strong></div>
    </div>`;
}

function renderCaseSecurity(encounter) {
  if (!isConfidential(encounter)) return "";
  const attempts = Number(encounter.failedAuthorizationAttempts || 0);
  const remaining = Math.max(0, 3 - attempts);
  const securityTypes = new Set([
    "case-marked-confidential",
    "confidential-case-code-changed",
    "confidential-case-access-granted",
    "confidential-case-authorization-failed",
    "confidential-case-permanently-locked",
    "confidential-case-admin-unlocked",
    "confidential-case-session-ended"
  ]);
  const events = state.audits
    .filter((item) => item.encounterId === encounter.id && securityTypes.has(item.type))
    .sort((a, b) => timeValue(b.at) - timeValue(a.at))
    .slice(0, 10);
  const labels = {
    "case-marked-confidential": "Case marked confidential",
    "confidential-case-code-changed": "Authorization code changed",
    "confidential-case-access-granted": "Confidential access granted",
    "confidential-case-authorization-failed": "Incorrect authorization code",
    "confidential-case-permanently-locked": "Permanent lock triggered",
    "confidential-case-admin-unlocked": "Permanent lock removed",
    "confidential-case-session-ended": "Authorized session ended"
  };
  const authorized = hasSessionAccess(encounter);
  return `
    <section class="case-security-panel">
      <div class="case-security-panel-head">
        <div><p class="eyebrow">Case Security</p><h4>Confidential Access Control</h4></div>
        <span class="case-security-state ${isPermanentlyLocked(encounter) ? "locked" : authorized ? "authorized" : "restricted"}">${isPermanentlyLocked(encounter) ? "Permanently Locked" : authorized ? "Authorized This Session" : "Restricted"}</span>
      </div>
      <div class="case-security-grid">
        <div><span>Failed Attempts</span><strong>${attempts} / 3</strong><small>${remaining} remaining before permanent lock</small></div>
        <div><span>Secured By</span><strong>${safe(encounter.confidentialMarkedByName || encounter.providerName || "Physician")}</strong><small>${safe(formatDateTime(encounter.confidentialMarkedAt))}</small></div>
        <div><span>Authorization Version</span><strong>${Number(encounter.authorizationEpoch || 0)}</strong><small>Changes revoke previous sessions</small></div>
        <div><span>Access Mode</span><strong>${authorized ? "Open in this session" : "Code required"}</strong><small>${isPermanentlyLocked(encounter) ? "Administrator intervention required" : "Case-sensitive authorization"}</small></div>
      </div>
      <div class="case-security-toolbar">
        ${canManageConfidential(encounter) ? `<button class="secondary-button compact" type="button" data-change-case-code="${safe(encounter.id)}">Rotate Authorization Code</button>` : ""}
        ${authorized ? '<button class="secondary-button compact" type="button" data-end-case-access>End My Access Session</button>' : ""}
      </div>
      <div class="case-access-history">
        <div class="case-access-history-head"><strong>Security Activity</strong><span>${events.length ? "Latest activity" : "No activity recorded"}</span></div>
        ${events.length ? events.map((item) => `<div class="case-access-event"><time>${safe(formatDateTime(item.at))}</time><div><strong>${safe(labels[item.type] || formatStatus(item.type))}</strong><span>${safe(item.actorName || "Northstar Staff")}${item.attemptNumber ? ` · Attempt ${safe(item.attemptNumber)} of 3` : ""}${item.reason ? ` · ${safe(item.reason)}` : ""}</span></div></div>`).join("") : '<div class="case-empty">No security activity has been recorded for this case.</div>'}
      </div>
    </section>`;
}

function renderFullCase(encounter) {
  const patient = patientById(encounter.patientId);
  const notes = itemsFor(state.notes, encounter.id);
  const observations = itemsFor(state.observations, encounter.id);
  const orders = itemsFor(state.orders, encounter.id);
  const results = itemsFor(state.results, encounter.id);
  const administrations = itemsFor(state.administrations, encounter.id);
  const procedures = itemsFor(state.procedures, encounter.id, ["completedAt", "timeoutAt", "createdAt"]);
  const confidential = isConfidential(encounter);
  const providerCanManage = canManageConfidential(encounter);

  document.querySelector("#caseRecordTitle").textContent = `${patient?.lastName || "Patient"}, ${patient?.firstName || ""}`.trim();
  document.querySelector("#caseRecordSubhead").textContent = `${patient?.mrn || ""} · ${formatDateTime(encounter.arrivalAt)} · ${encounter.department || "Emergency Department"}`;

  const confidentialBanner = confidential ? `
    <div class="case-confidential-banner">
      <div><strong>CONFIDENTIAL CASE</strong><span>Access is controlled by the physician authorization code.</span></div>
      <div class="case-security-actions">${providerCanManage ? `<button class="secondary-button compact" type="button" data-change-case-code="${safe(encounter.id)}">Change Authorization Code</button>` : ""}</div>
    </div>` : "";

  document.querySelector("#caseRecordBody").innerHTML = `
    ${confidentialBanner}
    ${renderCaseSecurity(encounter)}
    ${caseSummary(encounter, patient)}
    ${renderEncounterOverview(encounter)}
    ${renderNotes(notes)}
    ${renderObservations(observations, encounter)}
    ${renderOrdersResults(orders, results)}
    ${renderAdministrations(administrations, orders)}
    ${renderCaseProcedures(procedures)}
    ${renderTimeline(encounter, notes, observations, orders, results, administrations, procedures)}
  `;
  document.querySelector("#caseRecordDialog").showModal();
}

function renderEncounterOverview(encounter) {
  const triage = encounter.triage || {};
  const vitals = triage.heartRate || triage.bloodPressure || triage.respirations || triage.spo2 || triage.temperature || triage.pain != null;
  return `
    <section class="case-section">
      <div class="case-section-head"><h4>Encounter Summary</h4></div>
      <div class="case-doc-grid">
        <div class="case-doc-field"><span>Arrival Method</span><p>${safe(encounter.arrivalMethod || "—")}</p></div>
        <div class="case-doc-field"><span>Initial Priority</span><p>${safe(formatStatus(encounter.initialPriority || "—"))}</p></div>
        <div class="case-doc-field"><span>Differential</span><p>${safe(encounter.differential || "—")}</p></div>
        <div class="case-doc-field"><span>Final Diagnosis</span><p>${safe(encounter.finalDiagnosis || encounter.workingDiagnosis || "—")}</p></div>
        <div class="case-doc-field"><span>Discharge Instructions</span><p>${safe(encounter.dischargeInstructions || "—")}</p></div>
        <div class="case-doc-field"><span>Closed</span><p>${safe(formatDateTime(encounter.dischargedAt))}</p></div>
      </div>
      ${vitals ? `<div class="case-doc" style="margin-top:12px"><div class="case-doc-top"><strong>Triage Vitals</strong><span>${safe(formatDateTime(encounter.triagedAt || encounter.updatedAt))}</span></div><div class="case-doc-grid"><div class="case-doc-field"><span>HR</span><p>${safe(triage.heartRate || "—")}</p></div><div class="case-doc-field"><span>BP</span><p>${safe(triage.bloodPressure || "—")}</p></div><div class="case-doc-field"><span>RR</span><p>${safe(triage.respirations || "—")}</p></div><div class="case-doc-field"><span>SpO₂</span><p>${triage.spo2 ? `${safe(triage.spo2)}%` : "—"}</p></div><div class="case-doc-field"><span>Temperature</span><p>${triage.temperature ? `${safe(triage.temperature)}°F` : "—"}</p></div><div class="case-doc-field"><span>Pain</span><p>${triage.pain !== "" && triage.pain != null ? `${safe(triage.pain)}/10` : "—"}</p></div></div>${triage.note ? `<div class="case-doc-field" style="margin-top:10px"><span>Triage Note</span><p>${safe(triage.note)}</p></div>` : ""}</div>` : ""}
    </section>`;
}

function renderNotes(notes) {
  return `
    <section class="case-section">
      <div class="case-section-head"><h4>Provider Documentation</h4><span class="muted">${notes.length} note${notes.length === 1 ? "" : "s"}</span></div>
      ${notes.length ? `<div class="case-doc-list">${notes.map((note) => `
        <article class="case-doc">
          <div class="case-doc-top"><strong>${safe(note.title || "Clinical Note")}</strong><span>${safe(note.authorName || "Northstar Staff")} · ${safe(formatDateTime(note.createdAt))}</span></div>
          <div class="case-doc-grid">
            ${note.hpi ? `<div class="case-doc-field"><span>History / HPI</span><p>${safe(note.hpi)}</p></div>` : ""}
            ${note.exam ? `<div class="case-doc-field"><span>Physical Exam</span><p>${safe(note.exam)}</p></div>` : ""}
            ${note.differential ? `<div class="case-doc-field"><span>Differential</span><p>${safe(note.differential)}</p></div>` : ""}
            ${note.workingDiagnosis ? `<div class="case-doc-field"><span>Working Diagnosis</span><p>${safe(note.workingDiagnosis)}</p></div>` : ""}
            ${note.plan ? `<div class="case-doc-field"><span>Assessment & Plan</span><p>${safe(note.plan)}</p></div>` : ""}
            ${note.note && !note.plan ? `<div class="case-doc-field"><span>Note</span><p>${safe(note.note)}</p></div>` : ""}
          </div>
        </article>`).join("")}</div>` : '<div class="case-empty">No provider notes were recorded for this case.</div>'}
    </section>`;
}

function renderObservations(observations, encounter) {
  return `
    <section class="case-section">
      <div class="case-section-head"><h4>Nursing Assessments</h4><span class="muted">${observations.length} assessment${observations.length === 1 ? "" : "s"}</span></div>
      ${observations.length ? `<div class="case-doc-list">${observations.map((item) => `
        <article class="case-doc">
          <div class="case-doc-top"><strong>${safe(formatStatus(item.type || "Nursing Assessment"))}</strong><span>${safe(item.authorName || "Northstar Staff")} · ${safe(formatDateTime(item.createdAt))}</span></div>
          <div class="case-doc-grid">
            <div class="case-doc-field"><span>Mental Status</span><p>${safe(item.mentalStatus || "—")}</p></div>
            <div class="case-doc-field"><span>Respiratory</span><p>${safe(item.respiratory || "—")}</p></div>
            <div class="case-doc-field"><span>Cardiovascular</span><p>${safe(item.cardiovascular || "—")}</p></div>
            <div class="case-doc-field"><span>Skin / Appearance</span><p>${safe(item.skin || "—")}</p></div>
            <div class="case-doc-field"><span>Pain</span><p>${item.pain !== "" && item.pain != null ? `${safe(item.pain)}/10` : "—"}</p></div>
            <div class="case-doc-field"><span>Vitals</span><p>HR ${safe(item.vitals?.heartRate || "—")} · BP ${safe(item.vitals?.bloodPressure || "—")} · RR ${safe(item.vitals?.respirations || "—")} · SpO₂ ${safe(item.vitals?.spo2 || "—")}${item.vitals?.spo2 ? "%" : ""} · Temp ${safe(item.vitals?.temperature || "—")}</p></div>
            ${item.note ? `<div class="case-doc-field"><span>Nursing Note</span><p>${safe(item.note)}</p></div>` : ""}
          </div>
        </article>`).join("")}</div>` : '<div class="case-empty">No nursing assessments were recorded for this case.</div>'}
    </section>`;
}

function renderOrdersResults(orders, results) {
  const resultByOrder = new Map(results.map((result) => [result.orderId, result]));
  return `
    <section class="case-section">
      <div class="case-section-head"><h4>Orders & Results</h4><span class="muted">${orders.length} order${orders.length === 1 ? "" : "s"}</span></div>
      ${orders.length ? `<table class="case-table"><thead><tr><th>Order</th><th>Priority</th><th>Status</th><th>Result</th></tr></thead><tbody>${orders.map((order) => {
        const result = resultByOrder.get(order.id);
        return `<tr><td><strong>${safe(order.name || "Order")}</strong><br><span>${safe(formatStatus(order.category || "other"))}${order.dose ? ` · ${safe(order.dose)}` : ""}${order.route ? ` · ${safe(order.route)}` : ""}${order.frequency ? ` · ${safe(order.frequency)}` : ""}</span>${order.instructions ? `<br><span>${safe(order.instructions)}</span>` : ""}</td><td>${safe(String(order.priority || "routine").toUpperCase())}</td><td>${safe(formatStatus(order.status || "ordered"))}</td><td>${result ? `<strong>${result.abnormal ? "⚠ " : ""}${safe(result.summary || "Final")}</strong><br><span>${safe(result.details || "")}</span>` : "—"}</td></tr>`;
      }).join("")}</tbody></table>` : '<div class="case-empty">No orders were recorded for this case.</div>'}
      ${results.filter((result) => !orders.some((order) => order.id === result.orderId)).map((result) => `<div class="case-doc"><div class="case-doc-top"><strong>${safe(result.orderName || "Diagnostic Result")}</strong><span>${safe(formatDateTime(result.createdAt))}</span></div><div class="case-doc-field"><span>Result</span><p>${result.abnormal ? "⚠ " : ""}${safe(result.summary || "")}\n${safe(result.details || "")}</p></div></div>`).join("")}
    </section>`;
}

function renderAdministrations(administrations, orders) {
  const orderMap = new Map(orders.map((order) => [order.id, order]));
  return `
    <section class="case-section">
      <div class="case-section-head"><h4>Medication Administration Record</h4><span class="muted">${administrations.length} administration${administrations.length === 1 ? "" : "s"}</span></div>
      ${administrations.length ? `<table class="case-table"><thead><tr><th>Medication</th><th>Dose / Route</th><th>Administered By</th><th>Time / Note</th></tr></thead><tbody>${administrations.map((item) => {
        const order = orderMap.get(item.orderId) || {};
        return `<tr><td><strong>${safe(item.medicationName || item.orderName || order.name || "Medication")}</strong></td><td>${safe(item.dose || item.doseAdministered || order.dose || "—")} · ${safe(item.route || order.route || "—")}</td><td>${safe(item.administeredByName || item.authorName || "Northstar Staff")}</td><td>${safe(formatDateTime(item.administeredAt || item.createdAt))}${item.note || item.administrationNote ? `<br><span>${safe(item.note || item.administrationNote)}</span>` : ""}</td></tr>`;
      }).join("")}</tbody></table>` : '<div class="case-empty">No medication administrations were recorded for this case.</div>'}
    </section>`;
}

function renderCaseProcedures(procedures) {
  return `
    <section class="case-section">
      <div class="case-section-head"><h4>Procedures</h4><span class="muted">${procedures.length} procedure${procedures.length === 1 ? "" : "s"}</span></div>
      ${procedures.length ? `<div class="case-doc-list">${procedures.map((item) => `
        <article class="case-doc">
          <div class="case-doc-top"><strong>${safe(item.name || "Procedure")}</strong><span>${safe(formatStatus(item.status || "planned"))} · ${safe(formatDateTime(item.completedAt || item.timeoutAt || item.createdAt))}</span></div>
          <div class="case-doc-grid">
            <div class="case-doc-field"><span>Indication</span><p>${safe(item.indication || "—")}</p></div>
            <div class="case-doc-field"><span>Site / Side</span><p>${safe(item.site || "—")}</p></div>
            <div class="case-doc-field"><span>Consent</span><p>${item.consentObtained ? "Obtained" : "Not documented"}</p></div>
            <div class="case-doc-field"><span>Safety Timeout</span><p>${item.timeoutComplete ? `Completed by ${safe(item.timeoutByName || "Northstar Staff")} · ${safe(formatDateTime(item.timeoutAt))}` : "Not completed"}</p></div>
            ${item.outcome ? `<div class="case-doc-field"><span>Outcome</span><p>${safe(formatStatus(item.outcome))}</p></div>` : ""}
            ${item.completedByName ? `<div class="case-doc-field"><span>Completed By</span><p>${safe(item.completedByName)} · ${safe(formatDateTime(item.completedAt))}</p></div>` : ""}
            ${item.procedureNote ? `<div class="case-doc-field"><span>Procedure Note</span><p>${safe(item.procedureNote)}</p></div>` : ""}
            ${item.findings ? `<div class="case-doc-field"><span>Findings</span><p>${safe(item.findings)}</p></div>` : ""}
            ${item.complications ? `<div class="case-doc-field"><span>Complications</span><p>${safe(item.complications)}</p></div>` : ""}
            ${item.estimatedBloodLoss ? `<div class="case-doc-field"><span>Estimated Blood Loss</span><p>${safe(item.estimatedBloodLoss)}</p></div>` : ""}
            ${item.specimens ? `<div class="case-doc-field"><span>Specimens</span><p>${safe(item.specimens)}</p></div>` : ""}
            ${item.aftercare ? `<div class="case-doc-field"><span>Aftercare</span><p>${safe(item.aftercare)}</p></div>` : ""}
          </div>
        </article>`).join("")}</div>` : '<div class="case-empty">No procedures were recorded for this case.</div>'}
    </section>`;
}

function renderTimeline(encounter, notes, observations, orders, results, administrations, procedures = []) {
  const events = [];
  if (encounter.arrivalAt) events.push({ at: encounter.arrivalAt, title: "Patient checked in", detail: encounter.chiefComplaint || "Encounter opened" });
  if (encounter.triagedAt || encounter.triage?.completedAt) events.push({ at: encounter.triagedAt || encounter.triage?.completedAt, title: "Triage completed", detail: encounter.room || encounter.triage?.room || "Emergency Department" });
  notes.forEach((item) => events.push({ at: item.createdAt, title: item.title || "Clinical note signed", detail: item.authorName || "Northstar Staff" }));
  observations.forEach((item) => events.push({ at: item.createdAt, title: "Nursing assessment documented", detail: item.authorName || "Northstar Staff" }));
  orders.forEach((item) => events.push({ at: item.createdAt, title: `${formatStatus(item.category || "Clinical")} order entered`, detail: item.name || "Order" }));
  results.forEach((item) => events.push({ at: item.createdAt, title: "Diagnostic result finalized", detail: item.summary || item.orderName || "Result" }));
  administrations.forEach((item) => events.push({ at: item.administeredAt || item.createdAt, title: "Medication administered", detail: item.medicationName || item.orderName || "Medication" }));
  procedures.forEach((item) => {
    if (item.createdAt) events.push({ at: item.createdAt, title: "Procedure planned", detail: item.name || "Procedure" });
    if (item.timeoutAt) events.push({ at: item.timeoutAt, title: "Procedure safety timeout completed", detail: item.name || "Procedure" });
    if (item.completedAt) events.push({ at: item.completedAt, title: "Procedure completed", detail: `${item.name || "Procedure"} · ${formatStatus(item.outcome || "completed")}` });
  });
  if (encounter.dischargedAt) events.push({ at: encounter.dischargedAt, title: "Encounter closed", detail: formatStatus(encounter.disposition || "Discharged") });
  events.sort((a, b) => timeValue(a.at) - timeValue(b.at));
  return `
    <section class="case-section">
      <div class="case-section-head"><h4>Case Timeline</h4></div>
      ${events.length ? `<div class="case-timeline">${events.map((event) => `<div class="case-timeline-row"><time>${safe(formatDateTime(event.at))}</time><div><strong>${safe(event.title)}</strong><span>${safe(event.detail)}</span></div></div>`).join("")}</div>` : '<div class="case-empty">No timeline events are available.</div>'}
    </section>`;
}

function openConfidentialSetup(encounterId, mode = "set") {
  const encounter = encounterById(encounterId);
  const patient = encounter ? patientById(encounter.patientId) : null;
  if (!encounter || !patient || !canManageConfidential(encounter)) {
    showToast("Only the assigned physician or an Administrator can manage confidentiality for this case.");
    return;
  }
  state.selectedEncounterId = encounterId;
  state.setupMode = mode;
  document.querySelector("#caseConfidentialSetupForm")?.reset();
  document.querySelector("#caseConfidentialSetupTitle").textContent = mode === "change" ? "Change Authorization Code" : "Mark Case Confidential";
  document.querySelector("#caseConfidentialSetupContext").innerHTML = `<strong>${safe(patient.lastName)}, ${safe(patient.firstName)}</strong><span>${safe(patient.mrn)} · ${safe(formatDateTime(encounter.arrivalAt))}</span>`;
  document.querySelector("#caseConfidentialSetupDialog").showModal();
}

function randomSalt() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashAuthorizationCode(code, salt) {
  const data = new TextEncoder().encode(`${salt}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function submitConfidentialSetup(event) {
  event.preventDefault();
  const encounter = encounterById(state.selectedEncounterId);
  const patient = encounter ? patientById(encounter.patientId) : null;
  if (!encounter || !patient || !canManageConfidential(encounter)) return;

  const code = document.querySelector("#newCaseAuthorizationCode").value;
  const confirmation = document.querySelector("#confirmCaseAuthorizationCode").value;
  if (code.length < 4) {
    showToast("Authorization code must contain at least four characters.");
    return;
  }
  if (code !== confirmation) {
    showToast("Authorization codes do not match.");
    return;
  }

  const button = event.currentTarget.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Securing…";
  try {
    const salt = randomSalt();
    const hash = await hashAuthorizationCode(code, salt);
    const batch = writeBatch(db);
    const changes = {
      confidential: true,
      authorizationSalt: salt,
      authorizationHash: hash,
      authorizationEpoch: Number(encounter.authorizationEpoch || 0) + 1,
      failedAuthorizationAttempts: 0,
      permanentlyLocked: false,
      confidentialMarkedAt: encounter.confidentialMarkedAt || serverTimestamp(),
      confidentialMarkedBy: encounter.confidentialMarkedBy || auth.currentUser.uid,
      confidentialMarkedByName: encounter.confidentialMarkedByName || state.profile.displayName,
      authorizationUpdatedAt: serverTimestamp(),
      authorizationUpdatedBy: auth.currentUser.uid,
      updatedAt: serverTimestamp()
    };
    if (!encounter.providerUid && isActiveEncounter(encounter)) {
      changes.providerUid = auth.currentUser.uid;
      changes.providerName = state.profile.displayName;
    }
    batch.update(doc(db, "encounters", encounter.id), changes);
    batch.set(doc(collection(db, "auditEvents")), {
      type: state.setupMode === "change" ? "confidential-case-code-changed" : "case-marked-confidential",
      patientId: patient.id,
      encounterId: encounter.id,
      actorUid: auth.currentUser.uid,
      actorName: state.profile.displayName,
      at: serverTimestamp()
    });
    await batch.commit();
    const refreshed = { ...encounter, ...changes, authorizationHash: hash, authorizationSalt: salt, confidential: true, permanentlyLocked: false };
    grantSessionAccess(refreshed);
    document.querySelector("#caseConfidentialSetupDialog").close();
    showToast(state.setupMode === "change" ? "Authorization code changed." : "Case marked confidential.");
  } catch (error) {
    console.error("Northstar confidential case setup failed", error);
    showToast(error?.code === "permission-denied" ? "Only the assigned physician or an Administrator can secure this case." : "Unable to update confidential access.");
  } finally {
    button.disabled = false;
    button.textContent = "Save Confidential Access";
  }
}

async function submitAuthorization(event) {
  event.preventDefault();
  const encounter = encounterById(state.selectedEncounterId);
  if (!encounter || !isConfidential(encounter)) return;
  if (isPermanentlyLocked(encounter)) {
    document.querySelector("#caseAuthorizationDialog").close();
    renderLockedCase(encounter);
    return;
  }

  const code = document.querySelector("#caseAuthorizationCode").value;
  const button = event.currentTarget.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Authorizing…";
  try {
    const hash = await hashAuthorizationCode(code, encounter.authorizationSalt || "");
    if (hash === encounter.authorizationHash) {
      grantSessionAccess(encounter);
      const batch = writeBatch(db);
      batch.set(doc(collection(db, "auditEvents")), {
        type: "confidential-case-access-granted",
        patientId: encounter.patientId,
        encounterId: encounter.id,
        actorUid: auth.currentUser.uid,
        actorName: state.profile.displayName,
        at: serverTimestamp()
      });
      await batch.commit();
      document.querySelector("#caseAuthorizationDialog").close();
      renderFullCase(encounter);
      return;
    }

    const attemptResult = await recordFailedAttempt(encounter);
    document.querySelector("#caseAuthorizationCode").value = "";
    if (attemptResult.locked) {
      revokeSessionAccess(encounter);
      document.querySelector("#caseAuthorizationDialog").close();
      const lockedEncounter = { ...encounter, failedAuthorizationAttempts: attemptResult.attempts, permanentlyLocked: true };
      renderLockedCase(lockedEncounter);
      showToast("Third incorrect code entered. Case permanently locked.");
    } else {
      document.querySelector("#caseAuthorizationAttempts").textContent = `${3 - attemptResult.attempts} authorization attempt${3 - attemptResult.attempts === 1 ? "" : "s"} remaining before permanent lock.`;
      showToast("Incorrect authorization code.");
      document.querySelector("#caseAuthorizationCode").focus();
    }
  } catch (error) {
    console.error("Northstar authorization failed", error);
    showToast("Unable to verify authorization at this time.");
  } finally {
    button.disabled = false;
    button.textContent = "Authorize Access";
  }
}

async function recordFailedAttempt(encounter) {
  const encounterRef = doc(db, "encounters", encounter.id);
  const result = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(encounterRef);
    if (!snapshot.exists()) throw new Error("missing-case");
    const data = snapshot.data();
    if (data.permanentlyLocked === true) return { attempts: Number(data.failedAuthorizationAttempts || 3), locked: true };
    const attempts = Number(data.failedAuthorizationAttempts || 0) + 1;
    const locked = attempts >= 3;
    const update = {
      failedAuthorizationAttempts: attempts,
      permanentlyLocked: locked,
      lastFailedAuthorizationAt: serverTimestamp(),
      lastFailedAuthorizationBy: auth.currentUser.uid,
      updatedAt: serverTimestamp()
    };
    if (locked) {
      update.lockedAt = serverTimestamp();
      update.lockedByAttemptUid = auth.currentUser.uid;
      update.lockedByAttemptName = state.profile.displayName;
    }
    transaction.update(encounterRef, update);
    return { attempts, locked };
  });

  const batch = writeBatch(db);
  batch.set(doc(collection(db, "auditEvents")), {
    type: result.locked ? "confidential-case-permanently-locked" : "confidential-case-authorization-failed",
    patientId: encounter.patientId,
    encounterId: encounter.id,
    attemptNumber: result.attempts,
    actorUid: auth.currentUser.uid,
    actorName: state.profile.displayName,
    at: serverTimestamp()
  });
  await batch.commit();
  return result;
}

function adminUnlockSelectedCase() {
  const encounter = encounterById(state.selectedEncounterId);
  const patient = encounter ? patientById(encounter.patientId) : null;
  if (!encounter || !patient || !isAdministrator() || !isPermanentlyLocked(encounter)) return;
  document.querySelector("#caseAdminUnlockForm")?.reset();
  document.querySelector("#caseAdminUnlockContext").innerHTML = `<strong>${safe(patient.lastName)}, ${safe(patient.firstName)}</strong><span>${safe(patient.mrn || "")} · ${safe(formatDateTime(encounter.arrivalAt))}</span>`;
  document.querySelector("#caseAdminUnlockDialog").showModal();
  setTimeout(() => document.querySelector("#caseAdminUnlockReason")?.focus(), 40);
}

async function submitAdminUnlock(event) {
  event.preventDefault();
  const encounter = encounterById(state.selectedEncounterId);
  if (!encounter || !isAdministrator() || !isPermanentlyLocked(encounter)) return;
  const reason = document.querySelector("#caseAdminUnlockReason").value.trim();
  if (reason.length < 5) {
    showToast("Enter a brief reason for removing the permanent lock.");
    return;
  }
  const button = event.currentTarget.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Unlocking…";
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "encounters", encounter.id), {
      failedAuthorizationAttempts: 0,
      permanentlyLocked: false,
      authorizationEpoch: Number(encounter.authorizationEpoch || 0) + 1,
      unlockedAt: serverTimestamp(),
      unlockedBy: auth.currentUser.uid,
      unlockedByName: state.profile.displayName,
      updatedAt: serverTimestamp()
    });
    batch.set(doc(collection(db, "auditEvents")), {
      type: "confidential-case-admin-unlocked",
      patientId: encounter.patientId,
      encounterId: encounter.id,
      reason,
      actorUid: auth.currentUser.uid,
      actorName: state.profile.displayName,
      at: serverTimestamp()
    });
    await batch.commit();
    revokeSessionAccess(encounter);
    document.querySelector("#caseAdminUnlockDialog").close();
    document.querySelector("#caseRecordDialog").close();
    showToast("Permanent lock removed. Authorization code is still required.");
  } catch (error) {
    console.error("Northstar admin unlock failed", error);
    showToast("Unable to unlock this case.");
  } finally {
    button.disabled = false;
    button.textContent = "Remove Permanent Lock";
  }
}

async function endSelectedCaseAccess() {
  const encounter = encounterById(state.selectedEncounterId);
  if (!encounter || !isConfidential(encounter)) return;
  revokeSessionAccess(encounter);
  try {
    const batch = writeBatch(db);
    batch.set(doc(collection(db, "auditEvents")), {
      type: "confidential-case-session-ended",
      patientId: encounter.patientId,
      encounterId: encounter.id,
      actorUid: auth.currentUser.uid,
      actorName: state.profile.displayName,
      at: serverTimestamp()
    });
    await batch.commit();
  } catch (_) { }
  document.querySelector("#caseRecordDialog").close();
  showToast("Confidential case access ended for this browser session.");
}

function stopListeners() {
  state.unsubscribers.forEach((unsubscribe) => {
    try { unsubscribe(); } catch (_) { }
  });
  state.unsubscribers = [];
  state.profile = null;
}

function bindCollection(name, key) {
  const unsubscribe = onSnapshot(collection(db, name), (snapshot) => {
    state[key] = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    scheduleRender();
  }, () => {
    state[key] = [];
    scheduleRender();
  });
  state.unsubscribers.push(unsubscribe);
}

async function start(user) {
  stopListeners();
  if (!user) return;
  const profileSnapshot = await getDoc(doc(db, "users", user.uid));
  if (!profileSnapshot.exists()) return;
  state.profile = profileSnapshot.data();
  if (state.profile.status !== "active") return;

  [
    ["patients", "patients"],
    ["encounters", "encounters"],
    ["clinicalNotes", "notes"],
    ["observations", "observations"],
    ["orders", "orders"],
    ["results", "results"],
    ["medicationAdministrations", "administrations"],
    ["procedures", "procedures"],
    ["auditEvents", "audits"]
  ].forEach(([name, key]) => bindCollection(name, key));
}

ensureAssets();
injectDialogs();

const chartBody = document.querySelector("#patientChartBody");
if (chartBody) {
  const observer = new MutationObserver(scheduleRender);
  observer.observe(chartBody, { childList: true, subtree: false });
}

const chartDialog = document.querySelector("#patientChartDialog");
if (chartDialog) {
  const observer = new MutationObserver(scheduleRender);
  observer.observe(chartDialog, { attributes: true, attributeFilter: ["open"] });
}

document.addEventListener("click", async (event) => {
  const patientLink = event.target.closest("[data-patient-id]");
  if (patientLink) {
    state.selectedPatientId = patientLink.dataset.patientId;
    setTimeout(scheduleRender, 0);
  }

  const openCase = event.target.closest("[data-open-case-record]");
  if (openCase) {
    await openCaseRecord(openCase.dataset.openCaseRecord);
    return;
  }

  const markConfidential = event.target.closest("[data-mark-case-confidential]");
  if (markConfidential) {
    openConfidentialSetup(markConfidential.dataset.markCaseConfidential, "set");
    return;
  }

  const changeCode = event.target.closest("[data-change-case-code]");
  if (changeCode) {
    openConfidentialSetup(changeCode.dataset.changeCaseCode, "change");
    return;
  }

  if (event.target.closest("[data-admin-unlock-case]")) {
    adminUnlockSelectedCase();
    return;
  }

  if (event.target.closest("[data-end-case-access]")) {
    await endSelectedCaseAccess();
  }
});

onAuthStateChanged(auth, (user) => {
  start(user).catch((error) => {
    console.error("Northstar case archive failed to initialize", error);
    stopListeners();
  });
});
