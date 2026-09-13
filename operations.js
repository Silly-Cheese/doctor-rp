import { getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);

const state = {
  profile: null,
  users: [],
  patients: [],
  encounters: [],
  orders: [],
  results: [],
  observations: [],
  shifts: [],
  handoffs: [],
  tasks: [],
  audits: [],
  unsubscribers: [],
  tab: "board",
  search: "",
  renderQueued: false
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
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatTime(value) {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function label(value) {
  return String(value || "")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function activeEncounterList() {
  return state.encounters
    .filter((item) => item.status !== "discharged")
    .sort((a, b) => {
      const aAcuity = Number(a.triage?.acuity || 9);
      const bAcuity = Number(b.triage?.acuity || 9);
      if (aAcuity !== bAcuity) return aAcuity - bAcuity;
      return timeValue(a.arrivalAt) - timeValue(b.arrivalAt);
    });
}

function patientById(id) {
  return state.patients.find((item) => item.id === id) || null;
}

function encounterById(id) {
  return state.encounters.find((item) => item.id === id) || null;
}

function userById(id) {
  return state.users.find((item) => item.id === id || item.uid === id) || null;
}

function currentShift() {
  return state.shifts
    .filter((item) => item.uid === auth.currentUser?.uid && item.status === "active")
    .sort((a, b) => timeValue(b.startedAt) - timeValue(a.startedAt))[0] || null;
}

function canAssignAsProvider() {
  return ["administrator", "physician"].includes(state.profile?.role);
}

function canAssignAsNurse() {
  return ["administrator", "nurse"].includes(state.profile?.role);
}

function canCreateTask() {
  return ["administrator", "physician", "nurse", "technician", "registration"].includes(state.profile?.role);
}

function canAudit() {
  return state.profile?.role === "administrator";
}

function clinicalTitle(profile) {
  if (!profile) return "Clinical Staff";
  if (profile.role === "administrator" && profile.requestedRole && profile.requestedRole !== "administrator") {
    return `Administrator · ${ROLE_LABELS[profile.requestedRole] || label(profile.requestedRole)}`;
  }
  return ROLE_LABELS[profile.role] || "Clinical Staff";
}

function ensureStylesheet() {
  if (document.querySelector('link[href="operations.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "operations.css";
  document.head.appendChild(link);
}

function injectOperations() {
  if (document.querySelector("#operationsSection")) return;
  ensureStylesheet();

  const nav = document.querySelector(".nav-list");
  const staffNav = nav?.querySelector('[data-section="staff"]');
  const button = document.createElement("button");
  button.className = "nav-item";
  button.type = "button";
  button.dataset.operationsNav = "true";
  button.innerHTML = "<span>✦</span> Department Board";
  if (staffNav) nav.insertBefore(button, staffNav);
  else nav?.appendChild(button);

  const main = document.querySelector("main.content");
  const staffSection = document.querySelector("#staffSection");
  const section = document.createElement("section");
  section.id = "operationsSection";
  section.className = "content-section hidden operations-section";
  section.innerHTML = `
    <div class="operations-head">
      <div>
        <p class="eyebrow">Northstar Medical Center</p>
        <h3>Department Board</h3>
        <p>Emergency Department operations and staff coordination.</p>
      </div>
      <div id="operationsShiftBadge" class="ops-shift-badge"></div>
    </div>
    <div class="ops-tabs" role="tablist" aria-label="Department board sections">
      <button type="button" class="ops-tab active" data-ops-tab="board">Board</button>
      <button type="button" class="ops-tab" data-ops-tab="shift">My Shift</button>
      <button type="button" class="ops-tab" data-ops-tab="handoff">Handoff</button>
      <button type="button" class="ops-tab" data-ops-tab="tasks">Tasks</button>
      <button type="button" class="ops-tab ops-audit-tab hidden" data-ops-tab="audit">Audit</button>
    </div>
    <div id="operationsContent"></div>`;
  if (staffSection) main.insertBefore(section, staffSection);
  else main?.appendChild(section);

  injectDialogs();
  bindOperationsEvents();
}

function injectDialogs() {
  if (document.querySelector("#handoffDialog")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <dialog id="handoffDialog" class="ops-modal">
      <form id="handoffForm" class="ops-modal-card">
        <div class="modal-header"><div><p class="eyebrow">Care Transition</p><h3>SBAR Handoff</h3></div><button class="icon-button" type="button" data-close-ops="handoffDialog" aria-label="Close">×</button></div>
        <div class="modal-body form-grid">
          <label><span>Patient / encounter</span><select id="handoffEncounter" required></select></label>
          <label><span>Receiving staff member</span><select id="handoffRecipient"><option value="">General handoff</option></select></label>
          <label><span>Situation</span><textarea id="handoffSituation" rows="2" required placeholder="Current problem and immediate concern"></textarea></label>
          <label><span>Background</span><textarea id="handoffBackground" rows="3" required placeholder="Relevant history and course of care"></textarea></label>
          <label><span>Assessment</span><textarea id="handoffAssessment" rows="3" required placeholder="Current condition and clinical assessment"></textarea></label>
          <label><span>Recommendation</span><textarea id="handoffRecommendation" rows="3" required placeholder="What needs to happen next"></textarea></label>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-button" data-close-ops="handoffDialog">Cancel</button><button type="submit" class="primary-button">Send Handoff</button></div>
      </form>
    </dialog>

    <dialog id="taskDialog" class="ops-modal">
      <form id="taskForm" class="ops-modal-card">
        <div class="modal-header"><div><p class="eyebrow">Clinical Task</p><h3>Create Task</h3></div><button class="icon-button" type="button" data-close-ops="taskDialog" aria-label="Close">×</button></div>
        <div class="modal-body form-grid">
          <label><span>Patient / encounter</span><select id="taskEncounter"><option value="">Department task</option></select></label>
          <label><span>Task</span><input id="taskTitle" required placeholder="What needs to be completed"></label>
          <div class="field-row">
            <label><span>Priority</span><select id="taskPriority"><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="stat">STAT</option></select></label>
            <label><span>Assigned to</span><select id="taskAssignee"><option value="">Unassigned</option></select></label>
          </div>
          <label><span>Due</span><input id="taskDue" type="datetime-local"></label>
          <label><span>Details</span><textarea id="taskDetails" rows="3" placeholder="Instructions or context"></textarea></label>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-button" data-close-ops="taskDialog">Cancel</button><button type="submit" class="primary-button">Create Task</button></div>
      </form>
    </dialog>
  `);

  document.querySelector("#handoffForm")?.addEventListener("submit", submitHandoff);
  document.querySelector("#taskForm")?.addEventListener("submit", submitTask);
  document.querySelectorAll("[data-close-ops]").forEach((button) => {
    button.addEventListener("click", () => document.querySelector(`#${button.dataset.closeOps}`)?.close());
  });
  document.querySelectorAll(".ops-modal").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
}

function openOperations() {
  document.querySelectorAll(".content-section").forEach((section) => section.classList.add("hidden"));
  document.querySelector("#operationsSection")?.classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
  document.querySelector("[data-operations-nav]")?.classList.add("active");
  const title = document.querySelector("#pageTitle");
  if (title) title.textContent = "Department Board";
  document.querySelector(".sidebar")?.classList.remove("open");
  renderOperations();
}

function bindOperationsEvents() {
  document.querySelector("[data-operations-nav]")?.addEventListener("click", openOperations);
  document.querySelector("#operationsSection")?.addEventListener("click", async (event) => {
    const tab = event.target.closest("[data-ops-tab]");
    if (tab) {
      state.tab = tab.dataset.opsTab;
      renderOperations();
      return;
    }
    const provider = event.target.closest("[data-claim-provider]");
    if (provider) { await claimEncounter(provider.dataset.claimProvider, "provider"); return; }
    const nurse = event.target.closest("[data-claim-nurse]");
    if (nurse) { await claimEncounter(nurse.dataset.claimNurse, "nurse"); return; }
    const start = event.target.closest("[data-start-shift]");
    if (start) { await startShift(); return; }
    const end = event.target.closest("[data-end-shift]");
    if (end) { await endShift(); return; }
    const handoff = event.target.closest("[data-new-handoff]");
    if (handoff) { openHandoffDialog(handoff.dataset.newHandoff || ""); return; }
    const accept = event.target.closest("[data-accept-handoff]");
    if (accept) { await acceptHandoff(accept.dataset.acceptHandoff); return; }
    const task = event.target.closest("[data-new-task]");
    if (task) { openTaskDialog(task.dataset.newTask || ""); return; }
    const complete = event.target.closest("[data-complete-task]");
    if (complete) { await completeTask(complete.dataset.completeTask); return; }
    const chart = event.target.closest("[data-ops-patient]");
    if (chart) {
      const existing = document.querySelector(`[data-patient-id="${CSS.escape(chart.dataset.opsPatient)}"]`);
      if (existing) existing.click();
      else {
        const input = document.querySelector("#patientSearchInput");
        const patient = patientById(chart.dataset.opsPatient);
        if (input && patient) {
          input.value = patient.mrn || `${patient.firstName} ${patient.lastName}`;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          document.querySelector('[data-section="patients"]')?.click();
        }
      }
    }
  });

  document.querySelector("#operationsSection")?.addEventListener("input", (event) => {
    if (event.target.id === "opsSearch") {
      state.search = event.target.value.trim().toLowerCase();
      scheduleRender();
    }
  });
}

function startListeners() {
  stopListeners();
  const mappings = [
    ["users", "users"],
    ["patients", "patients"],
    ["encounters", "encounters"],
    ["orders", "orders"],
    ["results", "results"],
    ["observations", "observations"],
    ["shifts", "shifts"],
    ["handoffs", "handoffs"],
    ["tasks", "tasks"],
    ["auditEvents", "audits"]
  ];
  mappings.forEach(([collectionName, key]) => {
    const unsubscribe = onSnapshot(collection(db, collectionName), (snapshot) => {
      state[key] = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      scheduleRender();
    }, () => {
      state[key] = [];
      scheduleRender();
    });
    state.unsubscribers.push(unsubscribe);
  });
}

function stopListeners() {
  state.unsubscribers.forEach((unsubscribe) => {
    try { unsubscribe(); } catch (_) { }
  });
  state.unsubscribers = [];
}

function scheduleRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => {
    state.renderQueued = false;
    renderOperations();
    updateShiftBadge();
  });
}

function renderOperations() {
  const section = document.querySelector("#operationsSection");
  const content = document.querySelector("#operationsContent");
  if (!section || !content || !state.profile) return;
  section.querySelectorAll(".ops-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.opsTab === state.tab));
  section.querySelector(".ops-audit-tab")?.classList.toggle("hidden", !canAudit());
  if (state.tab === "audit" && !canAudit()) state.tab = "board";
  content.innerHTML = state.tab === "board"
    ? boardView()
    : state.tab === "shift"
      ? shiftView()
      : state.tab === "handoff"
        ? handoffView()
        : state.tab === "tasks"
          ? taskView()
          : auditView();
}

function updateShiftBadge() {
  const target = document.querySelector("#operationsShiftBadge");
  if (!target || !state.profile) return;
  const shift = currentShift();
  target.innerHTML = shift
    ? `<span class="ops-dot"></span><div><strong>On Shift</strong><small>${safe(shift.department || "Emergency Department")} · since ${safe(formatTime(shift.startedAt))}</small></div>`
    : `<span class="ops-dot off"></span><div><strong>Off Shift</strong><small>${safe(clinicalTitle(state.profile))}</small></div>`;
}

function boardView() {
  const encounters = filteredEncounters();
  const alerts = deriveAlerts();
  const openTasks = state.tasks.filter((task) => task.status !== "complete");
  return `
    <div class="ops-metrics">
      <article><span>Active Patients</span><strong>${activeEncounterList().length}</strong></article>
      <article><span>High Acuity</span><strong>${activeEncounterList().filter((e) => Number(e.triage?.acuity || 9) <= 2).length}</strong></article>
      <article><span>Open Tasks</span><strong>${openTasks.length}</strong></article>
      <article class="${alerts.length ? "attention" : ""}"><span>Clinical Alerts</span><strong>${alerts.length}</strong></article>
    </div>
    <div class="ops-layout">
      <div class="ops-primary">
        <div class="ops-panel">
          <div class="ops-panel-head">
            <div><p class="eyebrow">Emergency Department</p><h4>Patient Board</h4></div>
            <div class="ops-board-search"><span>⌕</span><input id="opsSearch" value="${safe(state.search)}" placeholder="Search name, MRN, room, complaint, diagnosis"></div>
          </div>
          ${encounters.length ? `<div class="ops-patient-board">${encounters.map(boardPatientCard).join("")}</div>` : emptyBlock("No matching active patients", state.search ? "Try another search term." : "Checked-in patients will appear here.")}
        </div>
      </div>
      <aside class="ops-side">
        <div class="ops-panel">
          <div class="ops-panel-head"><div><p class="eyebrow">Attention</p><h4>Clinical Alerts</h4></div></div>
          ${alerts.length ? `<div class="ops-alert-list">${alerts.slice(0, 8).map(alertCard).join("")}</div>` : emptyBlock("No active alerts", "No urgent clinical flags are currently detected.")}
        </div>
        <div class="ops-panel">
          <div class="ops-panel-head"><div><p class="eyebrow">Work Queue</p><h4>My Tasks</h4></div><button type="button" class="text-button" data-new-task>New</button></div>
          ${myTasks().length ? `<div class="ops-compact-list">${myTasks().slice(0, 6).map(compactTask).join("")}</div>` : emptyBlock("No assigned tasks", "Your open clinical tasks will appear here.")}
        </div>
      </aside>
    </div>`;
}

function filteredEncounters() {
  const query = state.search;
  if (!query) return activeEncounterList();
  return activeEncounterList().filter((encounter) => {
    const patient = patientById(encounter.patientId) || {};
    return [
      encounter.patientName,
      encounter.mrn,
      encounter.room,
      encounter.status,
      encounter.chiefComplaint,
      encounter.workingDiagnosis,
      encounter.providerName,
      encounter.nurseName,
      patient.firstName,
      patient.lastName,
      patient.allergies,
      patient.medicalHistory
    ].some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function boardPatientCard(encounter) {
  const patient = patientById(encounter.patientId) || {};
  const acuity = Number(encounter.triage?.acuity || 0);
  const vital = encounter.latestVitals || encounter.triage || {};
  const providerAction = canAssignAsProvider() && encounter.providerUid !== auth.currentUser?.uid
    ? `<button type="button" class="ops-mini" data-claim-provider="${safe(encounter.id)}">Claim as Provider</button>` : "";
  const nurseAction = canAssignAsNurse() && encounter.nurseUid !== auth.currentUser?.uid
    ? `<button type="button" class="ops-mini" data-claim-nurse="${safe(encounter.id)}">Claim as Nurse</button>` : "";
  return `
    <article class="ops-patient ${acuity && acuity <= 2 ? "high-acuity" : ""}">
      <button type="button" class="ops-patient-main" data-ops-patient="${safe(encounter.patientId)}">
        <div class="ops-room"><strong>${safe(encounter.room || "WAIT")}</strong><span>${acuity ? `ESI ${safe(acuity)}` : "No ESI"}</span></div>
        <div class="ops-patient-name"><strong>${safe(encounter.patientName || `${patient.lastName || ""}, ${patient.firstName || ""}`)}</strong><span>${safe(encounter.mrn || patient.mrn || "")} · ${safe(encounter.chiefComplaint || "No complaint entered")}</span></div>
        <div class="ops-status"><span class="ops-status-pill status-${safe(encounter.status)}">${safe(label(encounter.status))}</span><small>${safe(formatTime(encounter.arrivalAt))}</small></div>
      </button>
      <div class="ops-patient-detail">
        <div><span>Provider</span><strong>${safe(encounter.providerName || "Unassigned")}</strong></div>
        <div><span>Nurse</span><strong>${safe(encounter.nurseName || "Unassigned")}</strong></div>
        <div><span>Diagnosis</span><strong>${safe(encounter.workingDiagnosis || "Not established")}</strong></div>
        <div><span>Latest Vitals</span><strong>HR ${safe(vital.heartRate || "—")} · BP ${safe(vital.bloodPressure || "—")} · SpO₂ ${vital.spo2 ? `${safe(vital.spo2)}%` : "—"}</strong></div>
      </div>
      ${(providerAction || nurseAction) ? `<div class="ops-patient-actions">${providerAction}${nurseAction}<button type="button" class="ops-mini" data-new-handoff="${safe(encounter.id)}">Handoff</button><button type="button" class="ops-mini" data-new-task="${safe(encounter.id)}">Task</button></div>` : `<div class="ops-patient-actions"><button type="button" class="ops-mini" data-new-handoff="${safe(encounter.id)}">Handoff</button><button type="button" class="ops-mini" data-new-task="${safe(encounter.id)}">Task</button></div>`}
    </article>`;
}

function deriveAlerts() {
  const activeIds = new Set(activeEncounterList().map((encounter) => encounter.id));
  const alerts = [];
  activeEncounterList().forEach((encounter) => {
    const acuity = Number(encounter.triage?.acuity || 9);
    const spo2 = Number(encounter.latestVitals?.spo2 || encounter.triage?.spo2 || 0);
    if (acuity <= 2) alerts.push({ encounter, level: acuity === 1 ? "critical" : "urgent", title: `ESI ${acuity} patient`, detail: encounter.chiefComplaint || "High-acuity encounter" });
    if (spo2 > 0 && spo2 < 92) alerts.push({ encounter, level: spo2 < 88 ? "critical" : "urgent", title: `SpO₂ ${spo2}%`, detail: "Low oxygen saturation documented" });
  });
  state.orders.filter((order) => activeIds.has(order.encounterId) && order.priority === "stat" && !["complete", "administered", "cancelled"].includes(order.status)).forEach((order) => {
    alerts.push({ encounter: encounterById(order.encounterId), level: "urgent", title: `STAT: ${order.name}`, detail: order.patientName || "Open STAT order" });
  });
  state.results.filter((result) => activeIds.has(result.encounterId) && result.abnormal && result.status !== "reviewed").forEach((result) => {
    alerts.push({ encounter: encounterById(result.encounterId), level: "critical", title: result.summary || "Abnormal result", detail: result.patientName || result.orderName || "Unreviewed abnormal result" });
  });
  return alerts;
}

function alertCard(alert) {
  return `<button type="button" class="ops-alert ${safe(alert.level)}" ${alert.encounter ? `data-ops-patient="${safe(alert.encounter.patientId)}"` : ""}><span class="ops-alert-mark">!</span><span><strong>${safe(alert.title)}</strong><small>${safe(alert.detail)}</small></span></button>`;
}

function shiftView() {
  const shift = currentShift();
  const activeShifts = state.shifts.filter((item) => item.status === "active").sort((a, b) => timeValue(a.startedAt) - timeValue(b.startedAt));
  return `
    <div class="ops-layout shift-layout">
      <div class="ops-panel">
        <div class="ops-panel-head"><div><p class="eyebrow">Staffing</p><h4>My Shift</h4></div></div>
        <div class="ops-shift-card ${shift ? "active" : ""}">
          <div class="ops-shift-status"><span class="ops-dot ${shift ? "" : "off"}"></span><div><strong>${shift ? "On Shift" : "Not Checked In"}</strong><small>${shift ? `Started ${safe(formatDateTime(shift.startedAt))}` : safe(clinicalTitle(state.profile))}</small></div></div>
          ${shift ? `<button type="button" class="danger-button" data-end-shift>End Shift</button>` : `<button type="button" class="primary-button" data-start-shift>Start Shift</button>`}
        </div>
        <div class="ops-shift-details">
          <div><span>Department</span><strong>${safe(shift?.department || "Emergency Department")}</strong></div>
          <div><span>Role</span><strong>${safe(clinicalTitle(state.profile))}</strong></div>
          <div><span>Assigned Patients</span><strong>${assignedPatientCount()}</strong></div>
        </div>
      </div>
      <div class="ops-panel">
        <div class="ops-panel-head"><div><p class="eyebrow">Current Staffing</p><h4>On Duty</h4></div><span class="ops-count">${activeShifts.length}</span></div>
        ${activeShifts.length ? `<div class="ops-staff-list">${activeShifts.map(shiftRow).join("")}</div>` : emptyBlock("No staff on shift", "Staff check-ins will appear here.")}
      </div>
    </div>`;
}

function assignedPatientCount() {
  if (!auth.currentUser) return 0;
  return activeEncounterList().filter((encounter) => encounter.providerUid === auth.currentUser.uid || encounter.nurseUid === auth.currentUser.uid).length;
}

function shiftRow(shift) {
  const staff = userById(shift.uid);
  return `<div class="ops-staff-row"><div class="ops-avatar">${safe(initials(staff?.firstName, staff?.lastName))}</div><div><strong>${safe(shift.displayName || staff?.displayName || "Northstar Staff")}</strong><span>${safe(shift.roleLabel || clinicalTitle(staff))}</span></div><div class="ops-staff-time"><strong>${safe(formatTime(shift.startedAt))}</strong><span>Start</span></div></div>`;
}

function initials(first, last) {
  return `${first?.[0] || ""}${last?.[0] || ""}`.toUpperCase() || "NS";
}

function handoffView() {
  const list = [...state.handoffs].sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt));
  return `
    <div class="ops-panel">
      <div class="ops-panel-head"><div><p class="eyebrow">Care Transition</p><h4>SBAR Handoffs</h4></div><button type="button" class="primary-button compact" data-new-handoff>New Handoff</button></div>
      ${list.length ? `<div class="ops-handoff-list">${list.slice(0, 30).map(handoffCard).join("")}</div>` : emptyBlock("No handoffs recorded", "Use SBAR to transfer responsibility and important patient information.")}
    </div>`;
}

function handoffCard(item) {
  const encounter = encounterById(item.encounterId);
  const canAccept = item.status === "open" && (!item.recipientUid || item.recipientUid === auth.currentUser?.uid || canAudit());
  return `<article class="ops-handoff-card ${item.status === "accepted" ? "accepted" : ""}">
    <div class="ops-handoff-head"><div><strong>${safe(item.patientName || encounter?.patientName || "Patient")}</strong><span>${safe(item.mrn || encounter?.mrn || "")} · ${safe(item.room || encounter?.room || "No room")}</span></div><span class="ops-status-pill">${safe(label(item.status || "open"))}</span></div>
    <div class="ops-sbar"><div><span>S</span><p>${safe(item.situation)}</p></div><div><span>B</span><p>${safe(item.background)}</p></div><div><span>A</span><p>${safe(item.assessment)}</p></div><div><span>R</span><p>${safe(item.recommendation)}</p></div></div>
    <div class="ops-handoff-foot"><span>From ${safe(item.senderName || "Northstar Staff")} · ${safe(formatDateTime(item.createdAt))}${item.recipientName ? ` · To ${safe(item.recipientName)}` : ""}</span>${canAccept ? `<button type="button" class="ops-mini" data-accept-handoff="${safe(item.id)}">Accept Handoff</button>` : item.acceptedByName ? `<strong>Accepted by ${safe(item.acceptedByName)}</strong>` : ""}</div>
  </article>`;
}

function taskView() {
  const list = [...state.tasks].sort((a, b) => {
    if (a.status !== b.status) return a.status === "complete" ? 1 : -1;
    const priorities = { stat: 0, urgent: 1, routine: 2 };
    return (priorities[a.priority] ?? 9) - (priorities[b.priority] ?? 9) || timeValue(a.dueAt) - timeValue(b.dueAt);
  });
  return `
    <div class="ops-panel">
      <div class="ops-panel-head"><div><p class="eyebrow">Work Queue</p><h4>Clinical Tasks</h4></div><button type="button" class="primary-button compact" data-new-task>New Task</button></div>
      ${list.length ? `<div class="ops-task-list">${list.slice(0, 50).map(taskCard).join("")}</div>` : emptyBlock("No tasks", "Department and patient tasks will appear here.")}
    </div>`;
}

function myTasks() {
  const uid = auth.currentUser?.uid;
  return state.tasks
    .filter((task) => task.status !== "complete" && (!task.assigneeUid || task.assigneeUid === uid))
    .sort((a, b) => ({ stat: 0, urgent: 1, routine: 2 }[a.priority] ?? 9) - ({ stat: 0, urgent: 1, routine: 2 }[b.priority] ?? 9));
}

function compactTask(task) {
  return `<div class="ops-compact-row"><span class="ops-priority ${safe(task.priority)}"></span><div><strong>${safe(task.title)}</strong><small>${safe(task.patientName || "Department")} ${task.dueAt ? `· due ${safe(formatDateTime(task.dueAt))}` : ""}</small></div><button type="button" class="ops-check" data-complete-task="${safe(task.id)}" aria-label="Complete task">✓</button></div>`;
}

function taskCard(task) {
  const canComplete = task.status !== "complete" && (!task.assigneeUid || task.assigneeUid === auth.currentUser?.uid || task.createdBy === auth.currentUser?.uid || canAudit());
  return `<article class="ops-task-card ${task.status === "complete" ? "complete" : ""}"><span class="ops-priority ${safe(task.priority)}"></span><div class="ops-task-copy"><strong>${safe(task.title)}</strong><span>${safe(task.patientName || "Department task")}${task.room ? ` · ${safe(task.room)}` : ""}</span>${task.details ? `<p>${safe(task.details)}</p>` : ""}</div><div class="ops-task-meta"><span>${task.assigneeName ? `Assigned: ${safe(task.assigneeName)}` : "Unassigned"}</span><span>${task.dueAt ? `Due ${safe(formatDateTime(task.dueAt))}` : "No due time"}</span></div>${canComplete ? `<button type="button" class="ops-check large" data-complete-task="${safe(task.id)}" aria-label="Complete task">✓</button>` : `<span class="ops-status-pill">${safe(label(task.status))}</span>`}</article>`;
}

function auditView() {
  if (!canAudit()) return "";
  const events = [...state.audits].sort((a, b) => timeValue(b.at) - timeValue(a.at)).slice(0, 100);
  return `
    <div class="ops-panel">
      <div class="ops-panel-head"><div><p class="eyebrow">Security & Accountability</p><h4>Activity Log</h4></div><span class="ops-count">${events.length}</span></div>
      ${events.length ? `<div class="ops-audit-list">${events.map(auditRow).join("")}</div>` : emptyBlock("No activity recorded", "Clinical activity will appear here as the system is used.")}
    </div>`;
}

function auditRow(item) {
  return `<div class="ops-audit-row"><span class="ops-audit-time">${safe(formatDateTime(item.at))}</span><div><strong>${safe(auditLabel(item.type))}</strong><span>${safe(item.actorName || "Northstar Staff")}${item.mrn ? ` · ${safe(item.mrn)}` : ""}</span></div></div>`;
}

function auditLabel(type) {
  const labels = {
    "patient-created": "Patient record created",
    "patient-checked-in": "Patient checked in",
    "triage-completed": "Triage completed",
    "physician-note-signed": "Physician note signed",
    "nursing-assessment-completed": "Nursing assessment completed",
    "order-entered": "Clinical order entered",
    "order-completed": "Clinical order completed",
    "result-finalized": "Diagnostic result finalized",
    "medication-administered": "Medication administered",
    "encounter-closed": "Encounter closed",
    "shift-started": "Shift started",
    "shift-ended": "Shift ended",
    "patient-assigned": "Patient assignment updated",
    "handoff-created": "SBAR handoff created",
    "handoff-accepted": "SBAR handoff accepted",
    "task-created": "Clinical task created",
    "task-completed": "Clinical task completed"
  };
  return labels[type] || label(type);
}

function emptyBlock(title, detail) {
  return `<div class="ops-empty"><strong>${safe(title)}</strong><p>${safe(detail)}</p></div>`;
}

async function startShift() {
  if (!state.profile || currentShift()) return;
  try {
    const shiftRef = doc(collection(db, "shifts"));
    await setDoc(shiftRef, {
      uid: auth.currentUser.uid,
      displayName: state.profile.displayName,
      role: state.profile.role,
      roleLabel: clinicalTitle(state.profile),
      department: "Emergency Department",
      status: "active",
      startedAt: serverTimestamp()
    });
    await createAudit("shift-started", { shiftId: shiftRef.id });
    showToast("Shift started.");
  } catch (_) {
    showToast("Unable to start shift.");
  }
}

async function endShift() {
  const shift = currentShift();
  if (!shift) return;
  try {
    await updateDoc(doc(db, "shifts", shift.id), {
      status: "ended",
      endedAt: serverTimestamp()
    });
    await createAudit("shift-ended", { shiftId: shift.id });
    showToast("Shift ended.");
  } catch (_) {
    showToast("Unable to end shift.");
  }
}

async function claimEncounter(encounterId, assignmentType) {
  const encounter = encounterById(encounterId);
  if (!encounter || !state.profile) return;
  if (assignmentType === "provider" && !canAssignAsProvider()) return;
  if (assignmentType === "nurse" && !canAssignAsNurse()) return;
  try {
    const payload = assignmentType === "provider"
      ? { providerUid: auth.currentUser.uid, providerName: state.profile.displayName, updatedAt: serverTimestamp() }
      : { nurseUid: auth.currentUser.uid, nurseName: state.profile.displayName, updatedAt: serverTimestamp() };
    await updateDoc(doc(db, "encounters", encounterId), payload);
    await createAudit("patient-assigned", {
      encounterId,
      patientId: encounter.patientId,
      mrn: encounter.mrn,
      assignmentType
    });
    showToast(assignmentType === "provider" ? "Patient assigned to you as provider." : "Patient assigned to you as nurse.");
  } catch (_) {
    showToast("Unable to update assignment.");
  }
}

function fillEncounterSelect(select, selectedId = "", includeBlank = false) {
  if (!select) return;
  const active = activeEncounterList();
  select.innerHTML = `${includeBlank ? '<option value="">Department / no patient</option>' : ""}${active.map((encounter) => `<option value="${safe(encounter.id)}" ${encounter.id === selectedId ? "selected" : ""}>${safe(encounter.room || "WAIT")} — ${safe(encounter.patientName || encounter.mrn)}</option>`).join("")}`;
}

function fillStaffSelect(select, includeBlankLabel) {
  if (!select) return;
  const activeUsers = state.users.filter((user) => user.status === "active").sort((a, b) => String(a.displayName || "").localeCompare(String(b.displayName || "")));
  select.innerHTML = `<option value="">${safe(includeBlankLabel)}</option>${activeUsers.map((user) => `<option value="${safe(user.uid || user.id)}">${safe(user.displayName || "Staff Member")} — ${safe(clinicalTitle(user))}</option>`).join("")}`;
}

function openHandoffDialog(encounterId = "") {
  if (!activeEncounterList().length) {
    showToast("There are no active encounters to hand off.");
    return;
  }
  const form = document.querySelector("#handoffForm");
  form?.reset();
  fillEncounterSelect(document.querySelector("#handoffEncounter"), encounterId);
  fillStaffSelect(document.querySelector("#handoffRecipient"), "General handoff");
  document.querySelector("#handoffDialog")?.showModal();
}

async function submitHandoff(event) {
  event.preventDefault();
  const encounterId = document.querySelector("#handoffEncounter").value;
  const encounter = encounterById(encounterId);
  if (!encounter) return;
  const recipientUid = document.querySelector("#handoffRecipient").value;
  const recipient = userById(recipientUid);
  const button = event.currentTarget.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Sending…";
  try {
    const ref = doc(collection(db, "handoffs"));
    await setDoc(ref, {
      encounterId,
      patientId: encounter.patientId,
      patientName: encounter.patientName,
      mrn: encounter.mrn,
      room: encounter.room || "",
      situation: document.querySelector("#handoffSituation").value.trim(),
      background: document.querySelector("#handoffBackground").value.trim(),
      assessment: document.querySelector("#handoffAssessment").value.trim(),
      recommendation: document.querySelector("#handoffRecommendation").value.trim(),
      senderUid: auth.currentUser.uid,
      senderName: state.profile.displayName,
      recipientUid: recipientUid || null,
      recipientName: recipient?.displayName || "",
      status: "open",
      createdAt: serverTimestamp()
    });
    await createAudit("handoff-created", { handoffId: ref.id, encounterId, patientId: encounter.patientId, mrn: encounter.mrn });
    document.querySelector("#handoffDialog")?.close();
    showToast("Handoff sent.");
  } catch (_) {
    showToast("Unable to send handoff.");
  } finally {
    button.disabled = false;
    button.textContent = "Send Handoff";
  }
}

async function acceptHandoff(id) {
  const handoff = state.handoffs.find((item) => item.id === id);
  if (!handoff || handoff.status !== "open") return;
  try {
    await updateDoc(doc(db, "handoffs", id), {
      status: "accepted",
      acceptedAt: serverTimestamp(),
      acceptedBy: auth.currentUser.uid,
      acceptedByName: state.profile.displayName
    });
    await createAudit("handoff-accepted", { handoffId: id, encounterId: handoff.encounterId, patientId: handoff.patientId, mrn: handoff.mrn });
    showToast("Handoff accepted.");
  } catch (_) {
    showToast("Unable to accept handoff.");
  }
}

function openTaskDialog(encounterId = "") {
  if (!canCreateTask()) return;
  const form = document.querySelector("#taskForm");
  form?.reset();
  fillEncounterSelect(document.querySelector("#taskEncounter"), encounterId, true);
  fillStaffSelect(document.querySelector("#taskAssignee"), "Unassigned");
  document.querySelector("#taskDialog")?.showModal();
}

async function submitTask(event) {
  event.preventDefault();
  const encounterId = document.querySelector("#taskEncounter").value;
  const encounter = encounterById(encounterId);
  const assigneeUid = document.querySelector("#taskAssignee").value;
  const assignee = userById(assigneeUid);
  const dueRaw = document.querySelector("#taskDue").value;
  const button = event.currentTarget.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Creating…";
  try {
    const ref = doc(collection(db, "tasks"));
    await setDoc(ref, {
      encounterId: encounterId || null,
      patientId: encounter?.patientId || null,
      patientName: encounter?.patientName || "",
      mrn: encounter?.mrn || "",
      room: encounter?.room || "",
      title: document.querySelector("#taskTitle").value.trim(),
      priority: document.querySelector("#taskPriority").value,
      details: document.querySelector("#taskDetails").value.trim(),
      assigneeUid: assigneeUid || null,
      assigneeName: assignee?.displayName || "",
      dueAt: dueRaw ? new Date(dueRaw) : null,
      status: "open",
      createdBy: auth.currentUser.uid,
      createdByName: state.profile.displayName,
      createdAt: serverTimestamp()
    });
    await createAudit("task-created", { taskId: ref.id, encounterId: encounterId || null, patientId: encounter?.patientId || null, mrn: encounter?.mrn || "" });
    document.querySelector("#taskDialog")?.close();
    showToast("Task created.");
  } catch (_) {
    showToast("Unable to create task.");
  } finally {
    button.disabled = false;
    button.textContent = "Create Task";
  }
}

async function completeTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task || task.status === "complete") return;
  try {
    await updateDoc(doc(db, "tasks", id), {
      status: "complete",
      completedAt: serverTimestamp(),
      completedBy: auth.currentUser.uid,
      completedByName: state.profile.displayName
    });
    await createAudit("task-completed", { taskId: id, encounterId: task.encounterId || null, patientId: task.patientId || null, mrn: task.mrn || "" });
    showToast("Task completed.");
  } catch (_) {
    showToast("Unable to complete task.");
  }
}

async function createAudit(type, details = {}) {
  const ref = doc(collection(db, "auditEvents"));
  await setDoc(ref, {
    type,
    actorUid: auth.currentUser.uid,
    actorName: state.profile?.displayName || auth.currentUser.displayName || "Northstar Staff",
    at: serverTimestamp(),
    ...details
  });
}

function enhanceIdentity() {
  const labelNode = document.querySelector("#userRole");
  if (labelNode && state.profile) labelNode.textContent = clinicalTitle(state.profile);
}

injectOperations();

onAuthStateChanged(auth, async (user) => {
  stopListeners();
  state.profile = null;
  if (!user) {
    scheduleRender();
    return;
  }
  try {
    const profileSnap = await getDoc(doc(db, "users", user.uid));
    if (!profileSnap.exists()) return;
    const profile = { id: profileSnap.id, ...profileSnap.data() };
    if (profile.status !== "active") return;
    state.profile = profile;
    enhanceIdentity();
    startListeners();
    updateShiftBadge();
  } catch (_) {
    state.profile = null;
  }
});
