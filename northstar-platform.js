import { getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  EmailAuthProvider,
  reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);

const DEFAULT_ROOMS = [
  ["ER-01", "Emergency"], ["ER-02", "Emergency"], ["ER-03", "Emergency"], ["ER-04", "Emergency"],
  ["ER-05", "Emergency"], ["ER-06", "Emergency"], ["ER-07", "Emergency"], ["ER-08", "Emergency"],
  ["TR-01", "Trauma"], ["TR-02", "Trauma"], ["OBS-01", "Observation"], ["OBS-02", "Observation"]
];

const ROLE_LABELS = {
  administrator: "Administrator",
  physician: "Physician",
  nurse: "Registered Nurse",
  registration: "Registration",
  technician: "Clinical Technician",
  staff: "Clinical Staff"
};

const PERMISSIONS = [
  ["manageRegistration", "Registration", "Register patients and manage arrivals"],
  ["editPatients", "Patient Demographics", "Edit patient identity and demographic information"],
  ["providerActions", "Provider Actions", "Enter diagnoses, notes, orders, and dispositions"],
  ["nursingActions", "Nursing Actions", "Document nursing care and medication administration"],
  ["diagnosticActions", "Diagnostic Services", "Complete diagnostic work and results"],
  ["manageRooms", "Rooms & Census", "Move patients and update room status"],
  ["messages", "Clinical Messaging", "Send and receive Northstar messages"],
  ["emergencyEvents", "Emergency Events", "Start and participate in emergency responses"],
  ["restrictedCases", "Restricted Cases", "Use authorization codes for confidential cases"],
  ["printWristbands", "Patient Wristbands", "Print and scan patient wristbands"]
];

const ROLE_DEFAULTS = {
  administrator: Object.fromEntries(PERMISSIONS.map(([key]) => [key, true])),
  physician: { manageRegistration: true, editPatients: true, providerActions: true, nursingActions: false, diagnosticActions: false, manageRooms: true, messages: true, emergencyEvents: true, restrictedCases: true, printWristbands: true },
  nurse: { manageRegistration: true, editPatients: true, providerActions: false, nursingActions: true, diagnosticActions: false, manageRooms: true, messages: true, emergencyEvents: true, restrictedCases: true, printWristbands: true },
  registration: { manageRegistration: true, editPatients: true, providerActions: false, nursingActions: false, diagnosticActions: false, manageRooms: false, messages: true, emergencyEvents: false, restrictedCases: false, printWristbands: true },
  technician: { manageRegistration: false, editPatients: false, providerActions: false, nursingActions: false, diagnosticActions: true, manageRooms: false, messages: true, emergencyEvents: true, restrictedCases: true, printWristbands: false },
  staff: { manageRegistration: false, editPatients: false, providerActions: false, nursingActions: false, diagnosticActions: false, manageRooms: false, messages: true, emergencyEvents: false, restrictedCases: false, printWristbands: false }
};

const state = {
  profile: null,
  users: [],
  patients: [],
  encounters: [],
  orders: [],
  results: [],
  observations: [],
  administrations: [],
  shifts: [],
  tasks: [],
  rooms: [],
  messages: [],
  alerts: [],
  emergencyEvents: [],
  facility: { mode: "normal", statusText: "Normal Operations" },
  unsubscribers: [],
  selectedRoom: null,
  selectedStaff: null,
  alertFilter: "active",
  renderQueued: false,
  commandQuery: "",
  lastActivity: Date.now(),
  locked: false
};

function safe(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function timeValue(value) { return toDate(value)?.getTime() || 0; }
function formatTime(value) { const d = toDate(value); return d ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(d) : "—"; }
function formatDateTime(value) { const d = toDate(value); return d ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d) : "—"; }
function label(value) { return String(value || "").replaceAll("-", " ").replace(/\b\w/g, c => c.toUpperCase()); }
function activeEncounters() { return state.encounters.filter(e => e.status !== "discharged"); }
function patientById(id) { return state.patients.find(p => p.id === id) || null; }
function encounterById(id) { return state.encounters.find(e => e.id === id) || null; }
function userById(id) { return state.users.find(u => (u.uid || u.id) === id) || null; }
function orderById(id) { return state.orders.find(o => o.id === id) || null; }
function currentShift() { return state.shifts.filter(s => s.uid === auth.currentUser?.uid && s.status === "active").sort((a,b) => timeValue(b.startedAt) - timeValue(a.startedAt))[0] || null; }
function isAdmin() { return state.profile?.role === "administrator" && state.profile?.status === "active"; }
function permission(key) {
  if (!state.profile || state.profile.status !== "active") return false;
  if (state.profile.role === "administrator") return true;
  if (Object.prototype.hasOwnProperty.call(state.profile.permissions || {}, key)) return state.profile.permissions[key] === true;
  return ROLE_DEFAULTS[state.profile.role]?.[key] === true;
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function ensureStylesheet() {
  if (document.querySelector("link[data-northstar-platform]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.dataset.northstarPlatform = "1";
  link.href = `northstar-platform.css?v=${window.NorthstarBuild || "20260919-1530"}`;
  document.head.appendChild(link);
}

function navButton(id, icon, text, adminOnly = false) {
  const b = document.createElement("button");
  b.className = `nav-item northstar-nav${adminOnly ? " admin-platform-nav hidden" : ""}`;
  b.type = "button";
  b.dataset.northstarSection = id;
  b.innerHTML = `<span>${icon}</span> ${text}`;
  return b;
}

function injectPlatform() {
  if (document.querySelector("#northstarWorkstationSection")) return;
  ensureStylesheet();
  const nav = document.querySelector(".nav-list");
  const first = nav?.firstElementChild;
  const workstationNav = navButton("workstation", "⌂", "My Workstation");
  if (first) nav.insertBefore(workstationNav, first); else nav?.appendChild(workstationNav);
  const operationsNav = document.querySelector("[data-operations-nav]");
  const roomsNav = navButton("rooms", "▦", "Rooms & Census");
  const messagesNav = navButton("messages", "✉", "Messages");
  const alertsNav = navButton("alerts", "!", "Clinical Alerts");
  const controlNav = navButton("control", "◆", "Control Center", true);
  if (operationsNav) {
    operationsNav.after(roomsNav);
    roomsNav.after(messagesNav);
    messagesNav.after(alertsNav);
    alertsNav.after(controlNav);
  } else {
    nav?.append(roomsNav, messagesNav, alertsNav, controlNav);
  }

  const main = document.querySelector("main.content");
  const dashboard = document.querySelector("#dashboardSection");
  const sections = [
    ["northstarWorkstationSection", "workstation"],
    ["northstarRoomsSection", "rooms"],
    ["northstarMessagesSection", "messages"],
    ["northstarAlertsSection", "alerts"],
    ["northstarControlSection", "control"]
  ];
  sections.forEach(([id]) => {
    const section = document.createElement("section");
    section.id = id;
    section.className = "content-section hidden northstar-platform-section";
    if (dashboard) main.insertBefore(section, dashboard); else main.appendChild(section);
  });

  const footer = document.querySelector(".sidebar-footer");
  if (footer && !document.querySelector("#northstarLockButton")) {
    const lock = document.createElement("button");
    lock.id = "northstarLockButton";
    lock.type = "button";
    lock.className = "text-button northstar-lock-button";
    lock.textContent = "Lock Workstation";
    footer.insertBefore(lock, document.querySelector("#signOutButton"));
  }

  injectDialogs();
  injectCommandPalette();
  injectLockScreen();
  bindPlatformEvents();
}

function injectDialogs() {
  if (document.querySelector("#roomAssignmentDialog")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <dialog id="roomAssignmentDialog" class="modal">
      <form id="roomAssignmentForm" class="modal-card">
        <div class="modal-header"><div><p class="eyebrow">Patient Flow</p><h3 id="roomAssignmentTitle">Assign Room</h3></div><button type="button" class="icon-button" data-close-platform="roomAssignmentDialog">×</button></div>
        <div class="modal-body form-grid">
          <label><span>Patient</span><select id="roomAssignmentEncounter" required></select></label>
          <label><span>Room</span><select id="roomAssignmentRoom" required></select></label>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-button" data-close-platform="roomAssignmentDialog">Cancel</button><button type="submit" class="primary-button">Move Patient</button></div>
      </form>
    </dialog>

    <dialog id="messageComposeDialog" class="modal">
      <form id="messageComposeForm" class="modal-card">
        <div class="modal-header"><div><p class="eyebrow">Northstar Messaging</p><h3>New Clinical Message</h3></div><button type="button" class="icon-button" data-close-platform="messageComposeDialog">×</button></div>
        <div class="modal-body form-grid">
          <label><span>Recipient</span><select id="messageRecipient"><option value="department">Emergency Department</option></select></label>
          <label><span>Subject</span><input id="messageSubject" required maxlength="100"></label>
          <label><span>Message</span><textarea id="messageBody" required rows="5"></textarea></label>
          <label class="checkbox-line"><input id="messageUrgent" type="checkbox"> Mark as urgent</label>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-button" data-close-platform="messageComposeDialog">Cancel</button><button type="submit" class="primary-button">Send Message</button></div>
      </form>
    </dialog>

    <dialog id="permissionDialog" class="modal">
      <form id="permissionForm" class="modal-card">
        <div class="modal-header"><div><p class="eyebrow">Access Control</p><h3 id="permissionStaffName">Staff Permissions</h3></div><button type="button" class="icon-button" data-close-platform="permissionDialog">×</button></div>
        <div id="permissionList" class="modal-body permission-list"></div>
        <div class="modal-footer"><button type="button" class="secondary-button" data-reset-permissions>Use Role Defaults</button><button type="submit" class="primary-button">Save Permissions</button></div>
      </form>
    </dialog>
  `);
  document.querySelector("#roomAssignmentForm")?.addEventListener("submit", submitRoomAssignment);
  document.querySelector("#messageComposeForm")?.addEventListener("submit", submitMessage);
  document.querySelector("#permissionForm")?.addEventListener("submit", savePermissions);
  document.querySelectorAll("[data-close-platform]").forEach(b => b.addEventListener("click", () => document.querySelector(`#${b.dataset.closePlatform}`)?.close()));
}

function injectCommandPalette() {
  if (document.querySelector("#northstarCommandPalette")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <div id="northstarCommandPalette" class="northstar-command hidden" role="dialog" aria-modal="true">
      <div class="command-card">
        <div class="command-search"><span>⌕</span><input id="northstarCommandInput" autocomplete="off" placeholder="Search patients, rooms, or commands"></div>
        <div id="northstarCommandResults" class="command-results"></div>
        <div class="command-help"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>Enter</kbd> Open</span><span><kbd>Esc</kbd> Close</span></div>
      </div>
    </div>`);
  const topbarActions = document.querySelector(".topbar-actions");
  if (topbarActions && !document.querySelector("#northstarCommandButton")) {
    const button = document.createElement("button");
    button.id = "northstarCommandButton";
    button.className = "secondary-button compact northstar-command-button";
    button.type = "button";
    button.textContent = "Search /";
    topbarActions.prepend(button);
  }
}

function injectLockScreen() {
  if (document.querySelector("#northstarLockScreen")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <div id="northstarLockScreen" class="northstar-lock-screen hidden">
      <form id="northstarUnlockForm" class="lock-card">
        <div class="brand-mark">N</div>
        <p class="eyebrow">Northstar Medical Center</p>
        <h2>Workstation Locked</h2>
        <p id="lockIdentity" class="muted"></p>
        <label><span>Password</span><input id="unlockPassword" type="password" autocomplete="current-password" required></label>
        <button class="primary-button" type="submit">Unlock Workstation</button>
        <p id="unlockMessage" class="form-message"></p>
      </form>
    </div>`);
  document.querySelector("#northstarUnlockForm")?.addEventListener("submit", unlockWorkstation);
}

function openPlatformSection(name) {
  if (name === "control" && !isAdmin()) return;
  document.querySelectorAll(".content-section").forEach(s => s.classList.add("hidden"));
  const map = {
    workstation: "#northstarWorkstationSection",
    rooms: "#northstarRoomsSection",
    messages: "#northstarMessagesSection",
    alerts: "#northstarAlertsSection",
    control: "#northstarControlSection"
  };
  document.querySelector(map[name])?.classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.querySelector(`[data-northstar-section="${name}"]`)?.classList.add("active");
  const titles = { workstation: "My Workstation", rooms: "Rooms & Census", messages: "Messages", alerts: "Clinical Alerts", control: "Control Center" };
  const title = document.querySelector("#pageTitle");
  if (title) title.textContent = titles[name];
  document.querySelector(".sidebar")?.classList.remove("open");
  renderAll();
}

function assignedEncounters() {
  if (!auth.currentUser) return [];
  const uid = auth.currentUser.uid;
  return activeEncounters().filter(e => e.providerUid === uid || e.nurseUid === uid);
}

function waitingProvider() { return activeEncounters().filter(e => ["triage", "roomed"].includes(e.status) && !e.providerUid); }
function openTasksForMe() { return state.tasks.filter(t => t.status !== "complete" && (!t.assigneeUid || t.assigneeUid === auth.currentUser?.uid)); }
function pendingOrders() { return state.orders.filter(o => !["complete", "administered", "cancelled", "held", "refused"].includes(o.status)); }
function pendingDiagnosticOrders() { return pendingOrders().filter(o => ["laboratory", "imaging", "procedure"].includes(o.category)); }
function unreviewedResults() { return state.results.filter(r => r.status !== "reviewed"); }
function currentMessages() { return state.messages.filter(m => m.recipientType === "department" || m.recipientUid === auth.currentUser?.uid || m.senderUid === auth.currentUser?.uid).sort((a,b) => timeValue(b.createdAt) - timeValue(a.createdAt)); }

function renderWorkstation() {
  const target = document.querySelector("#northstarWorkstationSection");
  if (!target || !state.profile) return;
  const role = state.profile.role;
  const shift = currentShift();
  const assigned = assignedEncounters();
  const roleCopy = role === "physician" || role === "administrator"
    ? "Provider workspace for current patients, results, and clinical decisions."
    : role === "nurse"
      ? "Nursing workspace for assignments, medications, tasks, and patient changes."
      : role === "registration"
        ? "Registration workspace for arrivals, identity, and patient flow."
        : role === "technician"
          ? "Diagnostic workspace for ordered studies and result entry."
          : "Clinical staff workspace.";

  const cards = role === "nurse" ? [
    ["Assigned Patients", assigned.length, "Open your patient assignment list", "operations"],
    ["Open Tasks", openTasksForMe().length, "Tasks requiring attention", "operations"],
    ["Medication Orders", pendingOrders().filter(o => o.category === "medication").length, "Open medication administration", "mar"],
    ["Active Alerts", deriveAlerts().filter(a => !a.acknowledged).length, "Review patient alerts", "alerts"]
  ] : role === "registration" ? [
    ["Waiting", activeEncounters().filter(e => e.status === "waiting").length, "Patients awaiting triage", "waiting"],
    ["Roomed", activeEncounters().filter(e => e.room).length, "Current room occupancy", "rooms"],
    ["Patient Registry", state.patients.length, "Search or register patients", "patients"],
    ["Messages", currentMessages().filter(m => !m.readBy?.includes(auth.currentUser?.uid)).length, "Unread clinical messages", "messages"]
  ] : role === "technician" ? [
    ["Diagnostic Queue", pendingDiagnosticOrders().length, "Orders awaiting completion", "orders"],
    ["Results", unreviewedResults().length, "Finalized results", "results"],
    ["STAT Orders", pendingDiagnosticOrders().filter(o => o.priority === "stat").length, "Immediate diagnostic work", "orders"],
    ["Messages", currentMessages().length, "Department communication", "messages"]
  ] : [
    ["My Patients", assigned.length, "Assigned active encounters", "operations"],
    ["Awaiting Provider", waitingProvider().length, "Patients ready for evaluation", "operations"],
    ["Unreviewed Results", unreviewedResults().length, "Results requiring review", "results"],
    ["Clinical Alerts", deriveAlerts().filter(a => !a.acknowledged).length, "Time-sensitive attention", "alerts"]
  ];

  target.innerHTML = `
    <div class="workstation-head">
      <div><p class="eyebrow">${safe(ROLE_LABELS[role] || "Clinical Staff")}</p><h3>${safe(state.profile.displayName || "Northstar Staff")}</h3><p>${safe(roleCopy)}</p></div>
      <div class="workstation-shift ${shift ? "on" : "off"}"><span class="status-dot"></span><div><strong>${shift ? "On Shift" : "Off Shift"}</strong><small>${shift ? `Since ${safe(formatTime(shift.startedAt))}` : "Start your shift from Department Board"}</small></div></div>
    </div>
    <div class="workstation-metrics">${cards.map(([title,value,copy,dest]) => `<button type="button" data-workstation-open="${safe(dest)}"><span>${safe(title)}</span><strong>${safe(value)}</strong><small>${safe(copy)}</small></button>`).join("")}</div>
    <div class="workstation-layout">
      <article class="platform-panel">
        <div class="platform-panel-head"><div><p class="eyebrow">Priority Queue</p><h4>${role === "nurse" ? "My Nursing Assignment" : role === "registration" ? "Recent Arrivals" : role === "technician" ? "Diagnostic Worklist" : "My Patient List"}</h4></div></div>
        ${workstationQueue(role)}
      </article>
      <aside class="workstation-side">
        <article class="platform-panel"><div class="platform-panel-head"><div><p class="eyebrow">Attention</p><h4>Alerts</h4></div><button class="text-button" data-workstation-open="alerts">View all</button></div>${alertCompact()}</article>
        <article class="platform-panel"><div class="platform-panel-head"><div><p class="eyebrow">Communication</p><h4>Latest Messages</h4></div><button class="text-button" data-compose-message>New</button></div>${messageCompact()}</article>
      </aside>
    </div>`;
}

function workstationQueue(role) {
  let items = [];
  if (role === "registration") items = activeEncounters().sort((a,b) => timeValue(b.arrivalAt) - timeValue(a.arrivalAt)).slice(0,8);
  else if (role === "technician") {
    const orders = pendingDiagnosticOrders().sort((a,b) => (a.priority === "stat" ? -1 : 1));
    if (!orders.length) return empty("Diagnostic queue is clear", "New laboratory, imaging, and procedure orders will appear here.");
    return `<div class="platform-list">${orders.slice(0,10).map(o => `<button class="platform-list-row" data-workstation-open="orders"><span class="priority-bar ${safe(o.priority || "routine")}"></span><div><strong>${safe(o.name)}</strong><small>${safe(o.patientName || o.mrn || "Patient")} · ${safe(label(o.category))}</small></div><span>${safe(String(o.priority || "routine").toUpperCase())}</span></button>`).join("")}</div>`;
  } else items = assignedEncounters();
  if (!items.length) return empty("No patients in this queue", "Patient assignments and arrivals will appear here.");
  return `<div class="platform-list">${items.slice(0,10).map(e => `<button class="platform-list-row" data-open-platform-patient="${safe(e.patientId)}"><span class="room-token">${safe(e.room || "WAIT")}</span><div><strong>${safe(e.patientName || patientById(e.patientId)?.displayName || "Patient")}</strong><small>${safe(e.chiefComplaint || "No complaint entered")} · ${safe(label(e.status))}</small></div><span>${e.triage?.acuity ? `ESI ${safe(e.triage.acuity)}` : ""}</span></button>`).join("")}</div>`;
}

function empty(title, detail) { return `<div class="platform-empty"><strong>${safe(title)}</strong><p>${safe(detail)}</p></div>`; }

function roomRecords() {
  const map = new Map(state.rooms.map(r => [r.name || r.id, r]));
  return DEFAULT_ROOMS.map(([name, zone]) => ({ id: name, name, zone, status: map.get(name)?.status || "available", ...(map.get(name) || {}) }));
}

function roomOccupant(name) {
  return activeEncounters().find(e => String(e.room || e.triage?.room || "").toUpperCase() === name.toUpperCase()) || null;
}

function renderRooms() {
  const target = document.querySelector("#northstarRoomsSection");
  if (!target || !state.profile) return;
  const rooms = roomRecords();
  const occupied = rooms.filter(r => roomOccupant(r.name)).length;
  target.innerHTML = `
    <div class="section-heading"><div><p class="eyebrow">Hospital Census</p><h3>Rooms & Patient Flow</h3><p>Live room occupancy and bed status across Northstar.</p></div>${permission("manageRooms") ? '<button class="primary-button" type="button" data-assign-room>Move Patient</button>' : ""}</div>
    <div class="room-metrics"><article><span>Occupied</span><strong>${occupied}</strong></article><article><span>Available</span><strong>${rooms.filter(r => !roomOccupant(r.name) && r.status === "available").length}</strong></article><article><span>Cleaning</span><strong>${rooms.filter(r => r.status === "cleaning").length}</strong></article><article><span>Closed</span><strong>${rooms.filter(r => r.status === "closed").length}</strong></article></div>
    <div class="room-board">${rooms.map(roomCard).join("")}</div>`;
}

function roomCard(room) {
  const encounter = roomOccupant(room.name);
  const patient = encounter ? patientById(encounter.patientId) : null;
  const effective = encounter ? "occupied" : room.status;
  return `<article class="room-card ${safe(effective)}">
    <div class="room-card-head"><div><strong>${safe(room.name)}</strong><span>${safe(room.zone)}</span></div><span class="room-status ${safe(effective)}">${safe(label(effective))}</span></div>
    ${encounter ? `<button type="button" class="room-patient" data-open-platform-patient="${safe(encounter.patientId)}"><strong>${safe(encounter.patientName || `${patient?.lastName || ""}, ${patient?.firstName || ""}`)}</strong><span>${safe(encounter.chiefComplaint || "Current encounter")}</span><small>${encounter.triage?.acuity ? `ESI ${safe(encounter.triage.acuity)} · ` : ""}${safe(label(encounter.status))}</small></button>` : '<div class="room-empty-copy">No patient assigned</div>'}
    ${permission("manageRooms") && !encounter ? `<div class="room-actions"><button type="button" data-room-status="available" data-room-name="${safe(room.name)}">Available</button><button type="button" data-room-status="cleaning" data-room-name="${safe(room.name)}">Cleaning</button><button type="button" data-room-status="closed" data-room-name="${safe(room.name)}">Closed</button></div>` : ""}
  </article>`;
}

function renderMessages() {
  const target = document.querySelector("#northstarMessagesSection");
  if (!target || !state.profile) return;
  const messages = currentMessages();
  target.innerHTML = `
    <div class="section-heading"><div><p class="eyebrow">Secure Clinical Communication</p><h3>Messages</h3><p>Direct staff and department communication for the current roleplay session.</p></div>${permission("messages") ? '<button class="primary-button" type="button" data-compose-message>New Message</button>' : ""}</div>
    <div class="platform-panel message-panel">${messages.length ? `<div class="message-list">${messages.map(messageRow).join("")}</div>` : empty("No messages", "Clinical messages and pages will appear here.")}</div>`;
}

function messageRow(message) {
  const mine = message.senderUid === auth.currentUser?.uid;
  const unread = !mine && !(message.readBy || []).includes(auth.currentUser?.uid);
  return `<button type="button" class="message-row ${unread ? "unread" : ""} ${message.urgent ? "urgent" : ""}" data-message-id="${safe(message.id)}">
    <div class="message-avatar">${safe((message.senderName || "N").split(/\s+/).map(x => x[0]).slice(0,2).join("").toUpperCase())}</div>
    <div><div class="message-title"><strong>${safe(message.subject || "Clinical Message")}</strong>${message.urgent ? '<span>URGENT</span>' : ""}</div><p>${safe(message.body || "")}</p><small>${safe(mine ? `To ${message.recipientName || "Emergency Department"}` : `From ${message.senderName || "Northstar Staff"}`)} · ${safe(formatDateTime(message.createdAt))}</small></div>
  </button>`;
}

function deriveAlerts() {
  const persisted = new Map(state.alerts.map(a => [a.id, a]));
  const alerts = [];
  for (const e of activeEncounters()) {
    const vitals = e.latestVitals || e.triage || {};
    const acuity = Number(e.triage?.acuity || 9);
    const spo2 = Number(vitals.spo2 || 0);
    const hr = Number(vitals.heartRate || 0);
    if (acuity <= 2) alerts.push(buildAlert(`acuity-${e.id}`, e, acuity === 1 ? "critical" : "urgent", `ESI ${acuity} patient`, e.chiefComplaint || "High-acuity encounter", persisted));
    if (spo2 && spo2 < 92) alerts.push(buildAlert(`spo2-${e.id}`, e, spo2 < 88 ? "critical" : "urgent", `SpO₂ ${spo2}%`, "Low oxygen saturation documented", persisted));
    if (hr && (hr >= 130 || hr <= 45)) alerts.push(buildAlert(`hr-${e.id}`, e, "urgent", `Heart rate ${hr}`, "Marked heart-rate abnormality", persisted));
  }
  for (const order of pendingOrders()) {
    if (order.priority === "stat") alerts.push(buildAlert(`stat-${order.id}`, encounterById(order.encounterId), "urgent", `STAT — ${order.name}`, order.patientName || "Open STAT order", persisted, order.id));
    if (order.category === "medication" && order.dueAt && timeValue(order.dueAt) < Date.now()) alerts.push(buildAlert(`med-overdue-${order.id}`, encounterById(order.encounterId), "urgent", `Medication overdue — ${order.name}`, order.patientName || "Medication administration due", persisted, order.id));
  }
  for (const result of state.results.filter(r => r.abnormal && r.status !== "reviewed")) alerts.push(buildAlert(`result-${result.id}`, encounterById(result.encounterId), "critical", result.summary || "Abnormal result", result.patientName || result.orderName || "Provider review required", persisted, result.orderId));
  for (const event of state.emergencyEvents.filter(e => e.status === "active")) alerts.push(buildAlert(`emergency-${event.id}`, encounterById(event.encounterId), "critical", `${event.type || "Emergency"} active`, event.patientName || "Emergency response underway", persisted));
  return alerts.sort((a,b) => (a.level === "critical" ? -1 : 0) - (b.level === "critical" ? -1 : 0));
}

function alertSignalKey(level, title, detail) {
  return [level || "", title || "", detail || ""].join("|");
}

function alertSource(id) {
  if (id.startsWith("emergency-")) return "Emergency Response";
  if (id.startsWith("result-")) return "Diagnostic Result";
  if (id.startsWith("stat-")) return "STAT Order";
  if (id.startsWith("med-overdue-")) return "Medication";
  if (id.startsWith("spo2-") || id.startsWith("hr-")) return "Patient Monitor";
  if (id.startsWith("acuity-")) return "Triage";
  if (id.startsWith("simulation-") || id.startsWith("vnext-condition-")) return "Simulation";
  return "Clinical Surveillance";
}

function buildAlert(id, encounter, level, title, detail, persisted, orderId = null) {
  const stored = persisted.get(id) || {};
  const signalKey = alertSignalKey(level, title, detail);
  const acknowledged = stored.acknowledged === true && (!stored.signalKey || stored.signalKey === signalKey);
  return {
    id,
    encounterId: encounter?.id || null,
    patientId: encounter?.patientId || null,
    patientName: encounter?.patientName || "",
    room: encounter?.room || encounter?.triage?.room || "",
    orderId,
    level,
    title,
    detail,
    source: alertSource(id),
    signalKey,
    acknowledged,
    acknowledgedAt: stored.acknowledgedAt || null,
    acknowledgedByName: stored.acknowledgedByName || "",
    firstSeenAt: stored.firstSeenAt || null,
    lastSeenAt: stored.lastSeenAt || null
  };
}

function filteredAlerts(alerts) {
  if (state.alertFilter === "critical") return alerts.filter(a => a.level === "critical" && !a.acknowledged);
  if (state.alertFilter === "urgent") return alerts.filter(a => a.level === "urgent" && !a.acknowledged);
  if (state.alertFilter === "acknowledged") return alerts.filter(a => a.acknowledged);
  if (state.alertFilter === "all") return alerts;
  return alerts.filter(a => !a.acknowledged);
}

function renderAlerts() {
  const target = document.querySelector("#northstarAlertsSection");
  if (!target || !state.profile) return;
  const alerts = deriveAlerts();
  const active = alerts.filter(a => !a.acknowledged);
  const visible = filteredAlerts(alerts);
  const critical = active.filter(a => a.level === "critical").length;
  const urgent = active.filter(a => a.level === "urgent").length;
  const acknowledged = alerts.filter(a => a.acknowledged).length;
  target.innerHTML = `
    <div class="alert-center-hero">
      <div>
        <p class="eyebrow">Clinical Surveillance</p>
        <h3>Clinical Alert Center</h3>
        <p>One place for time-sensitive patient changes, emergency events, diagnostic results, and overdue clinical work.</p>
      </div>
      <div class="alert-center-hero-actions">
        <span class="alert-live-indicator"><i></i> Live surveillance</span>
        ${active.length ? `<button class="primary-button compact" type="button" data-ack-all-alerts>Acknowledge Active (${active.length})</button>` : ""}
      </div>
    </div>
    <div class="alert-center-metrics">
      <article class="alert-metric attention"><span>Needs Attention</span><strong>${active.length}</strong><small>unacknowledged</small></article>
      <article class="alert-metric critical"><span>Critical</span><strong>${critical}</strong><small>immediate review</small></article>
      <article class="alert-metric urgent"><span>Urgent</span><strong>${urgent}</strong><small>priority review</small></article>
      <article class="alert-metric acknowledged"><span>Acknowledged</span><strong>${acknowledged}</strong><small>current signals</small></article>
    </div>
    <div class="alert-center-toolbar">
      <div class="alert-filter-group" role="group" aria-label="Filter clinical alerts">
        ${[["active","Active"],["critical","Critical"],["urgent","Urgent"],["acknowledged","Acknowledged"],["all","All"]].map(([id,name]) => `<button type="button" data-alert-filter="${id}" class="${state.alertFilter === id ? "active" : ""}">${name}</button>`).join("")}
      </div>
      <span class="alert-filter-count">${visible.length} ${visible.length === 1 ? "alert" : "alerts"}</span>
    </div>
    <div class="platform-panel alert-center-shell">${visible.length ? `<div class="alert-center-list">${visible.map(alertRow).join("")}</div>` : empty(state.alertFilter === "acknowledged" ? "No acknowledged alerts" : "Active queue is clear", state.alertFilter === "acknowledged" ? "Acknowledged alerts for current conditions will appear here." : "No alerts in this view require attention right now.")}</div>`;
  bindAlertCenterActions(target, alerts);
  persistAlertShells(alerts).catch(() => {});
}

function alertRow(alert) {
  const encounter = encounterById(alert.encounterId);
  const patientLabel = alert.patientName || encounter?.patientName || "Clinical signal";
  const location = alert.room || encounter?.room || "";
  const ackCopy = alert.acknowledged
    ? `Acknowledged by ${safe(alert.acknowledgedByName || "Northstar Staff")}${alert.acknowledgedAt ? ` · ${safe(formatDateTime(alert.acknowledgedAt))}` : ""}`
    : "Acknowledgment required";
  return `<article class="alert-center-row ${safe(alert.level)} ${alert.acknowledged ? "acknowledged" : ""}" data-alert-card="${safe(alert.id)}">
    <div class="alert-center-card-head">
      <span class="alert-center-mark">!</span>
      <div class="alert-center-copy">
        <div class="alert-center-kicker"><span class="alert-source-pill">${safe(alert.source)}</span><span class="alert-severity-pill ${safe(alert.level)}">${safe(alert.level)}</span></div>
        <strong>${safe(alert.title)}</strong>
        <p>${safe(alert.detail)}</p>
      </div>
    </div>
    <div class="alert-center-context">
      <span><b>Patient</b>${safe(patientLabel)}</span>
      ${location ? `<span><b>Location</b>${safe(location)}</span>` : ""}
      <span><b>Status</b>${safe(ackCopy)}</span>
      <span><b>Detected</b>${safe(alert.firstSeenAt ? formatDateTime(alert.firstSeenAt) : "Just now")}</span>
    </div>
    <div class="alert-center-actions">
      ${alert.patientId ? `<button class="secondary-button compact" type="button" data-alert-open-patient="${safe(alert.patientId)}">Open Patient</button>` : ""}
      ${alert.encounterId ? `<button class="secondary-button compact" type="button" data-alert-monitor="${safe(alert.encounterId)}">Live Monitor</button>` : ""}
      ${!alert.acknowledged ? `<button class="primary-button compact" type="button" data-alert-ack="${safe(alert.id)}">Acknowledge</button>` : `<span class="alert-ack-chip">✓ Acknowledged</span>`}
    </div>
  </article>`;
}

function bindAlertCenterActions(target, alerts) {
  target.querySelectorAll("[data-alert-filter]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      state.alertFilter = button.dataset.alertFilter || "active";
      renderAlerts();
    });
  });
  target.querySelectorAll("[data-alert-open-patient]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      openPatient(button.dataset.alertOpenPatient);
    });
  });
  target.querySelectorAll("[data-alert-monitor]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      window.dispatchEvent(new CustomEvent("northstar:open-monitor", { detail: { encounterId: button.dataset.alertMonitor } }));
    });
  });
  target.querySelectorAll("[data-alert-ack]").forEach(button => {
    button.addEventListener("click", async event => {
      event.stopPropagation();
      await acknowledgeAlert(button.dataset.alertAck, button);
    });
  });
  target.querySelector("[data-ack-all-alerts]")?.addEventListener("click", async event => {
    event.stopPropagation();
    const pending = alerts.filter(a => !a.acknowledged);
    if (!pending.length) return;
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Acknowledging…";
    const results = await Promise.all(pending.map(a => acknowledgeAlert(a.id, null, { silent: true, deferRender: true })));
    renderAlerts();
    const success = results.filter(Boolean).length;
    showToast(success === pending.length ? `${success} alerts acknowledged.` : `${success} of ${pending.length} alerts acknowledged.`);
  });
}

async function persistAlertShells(alerts) {
  if (!state.profile || !alerts.length) return;
  const storedById = new Map(state.alerts.map(a => [a.id, a]));
  const writes = [];

  for (const a of alerts) {
    const stored = storedById.get(a.id);
    const signalChanged = Boolean(stored?.signalKey && stored.signalKey !== a.signalKey);
    const shellChanged = !stored
      || stored.level !== a.level
      || stored.title !== a.title
      || stored.detail !== a.detail
      || (stored.encounterId || null) !== (a.encounterId || null)
      || (stored.patientId || null) !== (a.patientId || null)
      || (stored.orderId || null) !== (a.orderId || null)
      || stored.source !== a.source
      || stored.signalKey !== a.signalKey
      || !stored.firstSeenAt;

    // Do not write on every render. Firestore snapshots trigger renders, so
    // unconditional timestamp writes create a self-sustaining render loop.
    if (!shellChanged) continue;

    const payload = {
      level: a.level,
      title: a.title,
      detail: a.detail,
      encounterId: a.encounterId,
      patientId: a.patientId,
      orderId: a.orderId || null,
      source: a.source,
      signalKey: a.signalKey,
      lastSeenAt: serverTimestamp()
    };
    if (!stored?.firstSeenAt) payload.firstSeenAt = serverTimestamp();
    if (signalChanged) {
      payload.firstSeenAt = serverTimestamp();
      payload.acknowledged = false;
      payload.acknowledgedAt = null;
      payload.acknowledgedBy = null;
      payload.acknowledgedByName = null;
    }
    writes.push(setDoc(doc(db, "clinicalAlerts", a.id), payload, { merge: true }));
  }

  if (writes.length) await Promise.all(writes);
}

function alertCompact() {
  const alerts = deriveAlerts().filter(a => !a.acknowledged).slice(0,5);
  if (!alerts.length) return empty("No active alerts", "No urgent patient conditions are currently flagged.");
  return `<div class="compact-alert-list">${alerts.map(a => `<button type="button" class="compact-alert ${safe(a.level)}" data-workstation-open="alerts"><span>!</span><div><strong>${safe(a.title)}</strong><small>${safe(a.detail)}</small></div></button>`).join("")}</div>`;
}

function messageCompact() {
  const messages = currentMessages().slice(0,4);
  if (!messages.length) return empty("No recent messages", "Clinical messages will appear here.");
  return `<div class="compact-message-list">${messages.map(m => `<button type="button" data-workstation-open="messages"><strong>${safe(m.subject || "Message")}</strong><small>${safe(m.senderName || "Northstar Staff")} · ${safe(formatTime(m.createdAt))}</small></button>`).join("")}</div>`;
}

function renderControlCenter() {
  const target = document.querySelector("#northstarControlSection");
  if (!target || !isAdmin()) return;
  const active = activeEncounters();
  const onDuty = state.shifts.filter(s => s.status === "active");
  const locks = state.encounters.filter(e => e.permanentlyLocked).length;
  target.innerHTML = `
    <div class="control-head ${state.facility.mode === "mci" ? "mci" : ""}">
      <div><p class="eyebrow">Northstar Medical Center</p><h3>Control Center</h3><p>Facility operations, access control, and system-wide readiness.</p></div>
      <div class="facility-mode"><span>Facility Status</span><strong>${safe(state.facility.statusText || (state.facility.mode === "mci" ? "Mass Casualty Operations" : "Normal Operations"))}</strong><div><button type="button" class="secondary-button compact" data-facility-normal>Normal</button><button type="button" class="danger-button compact" data-facility-mci>Mass Casualty</button></div></div>
    </div>
    <div class="control-metrics"><article><span>Current Census</span><strong>${active.length}</strong></article><article><span>Staff On Duty</span><strong>${onDuty.length}</strong></article><article><span>Critical Patients</span><strong>${active.filter(e => Number(e.triage?.acuity || 9) <= 2).length}</strong></article><article><span>Restricted Lockouts</span><strong>${locks}</strong></article><article><span>Open Tasks</span><strong>${state.tasks.filter(t => t.status !== "complete").length}</strong></article><article><span>Active Emergencies</span><strong>${state.emergencyEvents.filter(e => e.status === "active").length}</strong></article></div>
    <div class="control-grid">
      <article class="platform-panel"><div class="platform-panel-head"><div><p class="eyebrow">Staffing</p><h4>Staff Permissions</h4></div></div><div class="permission-staff-list">${state.users.filter(u => u.status === "active").map(permissionStaffRow).join("") || '<div class="platform-empty">No active staff accounts.</div>'}</div></article>
      <article class="platform-panel"><div class="platform-panel-head"><div><p class="eyebrow">Operations</p><h4>Department Readiness</h4></div></div><div class="readiness-list"><div><span>Rooms Available</span><strong>${roomRecords().filter(r => !roomOccupant(r.name) && r.status === "available").length}</strong></div><div><span>Pending Orders</span><strong>${pendingOrders().length}</strong></div><div><span>Unreviewed Results</span><strong>${unreviewedResults().length}</strong></div><div><span>Confidential Cases</span><strong>${state.encounters.filter(e => e.confidential).length}</strong></div></div></article>
    </div>`;
}

function permissionStaffRow(user) {
  return `<div class="permission-staff-row"><div class="message-avatar">${safe((user.displayName || "NS").split(/\s+/).map(x => x[0]).slice(0,2).join("").toUpperCase())}</div><div><strong>${safe(user.displayName || "Staff Member")}</strong><span>${safe(ROLE_LABELS[user.role] || label(user.role))}</span></div><button type="button" class="secondary-button compact" data-edit-permissions="${safe(user.uid || user.id)}">Permissions</button></div>`;
}

function renderFacilityBanner() {
  let banner = document.querySelector("#facilityModeBanner");
  if (state.facility.mode !== "mci") { banner?.remove(); return; }
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "facilityModeBanner";
    banner.className = "facility-mode-banner";
    document.querySelector("#mainView .workspace")?.prepend(banner);
  }
  banner.innerHTML = `<strong>MASS CASUALTY OPERATIONS</strong><span>${safe(state.facility.statusText || "Northstar is operating under mass-casualty procedures.")}</span>`;
}

function renderAll() {
  if (!state.profile) return;
  const visible = selector => {
    const node = document.querySelector(selector);
    return Boolean(node && !node.classList.contains("hidden"));
  };
  if (visible("#northstarWorkstationSection")) renderWorkstation();
  if (visible("#northstarRoomsSection")) renderRooms();
  if (visible("#northstarMessagesSection")) renderMessages();
  if (visible("#northstarAlertsSection")) renderAlerts();
  if (visible("#northstarControlSection")) renderControlCenter();
  renderFacilityBanner();
  document.querySelectorAll(".admin-platform-nav").forEach(n => n.classList.toggle("hidden", !isAdmin()));
}

function scheduleRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => { state.renderQueued = false; renderAll(); });
}

function openPatient(patientId) {
  const patient = patientById(patientId);
  if (!patient) {
    showToast("Patient record is not available.");
    return;
  }
  document.querySelector('[data-section="patients"]')?.click();
  const input = document.querySelector("#patientSearchInput");
  if (!input) {
    showToast("Patient search is not available.");
    return;
  }
  input.value = patient.mrn || `${patient.firstName} ${patient.lastName}`;
  input.dispatchEvent(new Event("input", { bubbles: true }));

  let attempts = 0;
  const openWhenReady = () => {
    const row = document.querySelector(`[data-patient-id="${CSS.escape(patientId)}"]`);
    if (row) {
      row.click();
      return;
    }
    attempts += 1;
    if (attempts < 5) setTimeout(openWhenReady, 50);
    else showToast("Patient record loaded, but the chart could not be opened automatically.");
  };
  requestAnimationFrame(openWhenReady);
}

function openRoomAssignment(defaultRoom = "") {
  if (!permission("manageRooms")) return;
  const active = activeEncounters();
  if (!active.length) { showToast("There are no active patients to move."); return; }
  const eSelect = document.querySelector("#roomAssignmentEncounter");
  const rSelect = document.querySelector("#roomAssignmentRoom");
  eSelect.innerHTML = active.map(e => `<option value="${safe(e.id)}">${safe(e.room || "WAIT")} — ${safe(e.patientName || e.mrn)}</option>`).join("");
  rSelect.innerHTML = roomRecords().filter(r => !roomOccupant(r.name) || r.name === defaultRoom).map(r => `<option value="${safe(r.name)}" ${r.name === defaultRoom ? "selected" : ""}>${safe(r.name)} — ${safe(label(r.status))}</option>`).join("");
  document.querySelector("#roomAssignmentDialog")?.showModal();
}

async function submitRoomAssignment(event) {
  event.preventDefault();
  const encounter = encounterById(document.querySelector("#roomAssignmentEncounter").value);
  const room = document.querySelector("#roomAssignmentRoom").value;
  if (!encounter || !room || !permission("manageRooms")) return;
  try {
    await updateDoc(doc(db, "encounters", encounter.id), { room, status: encounter.status === "waiting" ? "roomed" : encounter.status, updatedAt: serverTimestamp() });
    await setDoc(doc(db, "rooms", room), { name: room, status: "available", updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid }, { merge: true });
    document.querySelector("#roomAssignmentDialog")?.close();
    showToast(`${encounter.patientName || "Patient"} moved to ${room}.`);
  } catch (_) { showToast("Unable to move that patient."); }
}

async function setRoomStatus(roomName, status) {
  if (!permission("manageRooms") || roomOccupant(roomName)) return;
  try {
    const zone = DEFAULT_ROOMS.find(([name]) => name === roomName)?.[1] || "Emergency";
    await setDoc(doc(db, "rooms", roomName), { name: roomName, zone, status, updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid }, { merge: true });
  } catch (_) { showToast("Unable to update room status."); }
}

function openComposeMessage() {
  if (!permission("messages")) return;
  const form = document.querySelector("#messageComposeForm");
  form?.reset();
  const select = document.querySelector("#messageRecipient");
  select.innerHTML = `<option value="department">Emergency Department</option>${state.users.filter(u => u.status === "active" && (u.uid || u.id) !== auth.currentUser?.uid).map(u => `<option value="${safe(u.uid || u.id)}">${safe(u.displayName || "Staff Member")} — ${safe(ROLE_LABELS[u.role] || label(u.role))}</option>`).join("")}`;
  document.querySelector("#messageComposeDialog")?.showModal();
}

async function submitMessage(event) {
  event.preventDefault();
  if (!permission("messages")) return;
  const recipientValue = document.querySelector("#messageRecipient").value;
  const recipient = userById(recipientValue);
  const ref = doc(collection(db, "messages"));
  const button = event.currentTarget.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    await setDoc(ref, {
      senderUid: auth.currentUser.uid,
      senderName: state.profile.displayName,
      recipientType: recipientValue === "department" ? "department" : "staff",
      recipientUid: recipientValue === "department" ? null : recipientValue,
      recipientName: recipientValue === "department" ? "Emergency Department" : recipient?.displayName || "Staff Member",
      subject: document.querySelector("#messageSubject").value.trim(),
      body: document.querySelector("#messageBody").value.trim(),
      urgent: document.querySelector("#messageUrgent").checked,
      readBy: [auth.currentUser.uid],
      createdAt: serverTimestamp()
    });
    document.querySelector("#messageComposeDialog")?.close();
    showToast("Message sent.");
  } catch (_) { showToast("Unable to send message."); }
  finally { button.disabled = false; }
}

async function markMessageRead(id) {
  const message = state.messages.find(m => m.id === id);
  if (!message || (message.readBy || []).includes(auth.currentUser?.uid)) return;
  const readBy = [...new Set([...(message.readBy || []), auth.currentUser.uid])];
  try { await updateDoc(doc(db, "messages", id), { readBy, readAt: serverTimestamp() }); } catch (_) {}
}

async function acknowledgeAlert(id, button = null, options = {}) {
  const current = deriveAlerts().find(a => a.id === id);
  if (!current || !auth.currentUser || !state.profile) {
    if (!options.silent) showToast("That alert is no longer active.");
    return false;
  }
  const existingIndex = state.alerts.findIndex(a => a.id === id);
  const previous = existingIndex >= 0 ? { ...state.alerts[existingIndex] } : null;
  const optimistic = {
    id,
    acknowledged: true,
    acknowledgedAt: new Date(),
    acknowledgedBy: auth.currentUser.uid,
    acknowledgedByName: state.profile.displayName || "Northstar Staff",
    signalKey: current.signalKey,
    level: current.level,
    title: current.title,
    detail: current.detail,
    encounterId: current.encounterId,
    patientId: current.patientId,
    orderId: current.orderId || null,
    source: current.source
  };

  if (button) {
    button.disabled = true;
    button.dataset.originalLabel = button.textContent;
    button.textContent = "Acknowledging…";
  }
  if (existingIndex >= 0) state.alerts[existingIndex] = { ...state.alerts[existingIndex], ...optimistic };
  else state.alerts.push(optimistic);
  if (!options.deferRender) renderAlerts();

  try {
    await setDoc(doc(db, "clinicalAlerts", id), {
      acknowledged: true,
      acknowledgedAt: serverTimestamp(),
      acknowledgedBy: auth.currentUser.uid,
      acknowledgedByName: state.profile.displayName || "Northstar Staff",
      signalKey: current.signalKey,
      level: current.level,
      title: current.title,
      detail: current.detail,
      encounterId: current.encounterId,
      patientId: current.patientId,
      orderId: current.orderId || null,
      source: current.source,
      lastSeenAt: serverTimestamp()
    }, { merge: true });
    const auditRef = doc(collection(db, "auditEvents"));
    await setDoc(auditRef, {
      type: "clinical-alert-acknowledged",
      alertId: id,
      encounterId: current.encounterId,
      patientId: current.patientId,
      alertTitle: current.title,
      actorUid: auth.currentUser.uid,
      actorName: state.profile.displayName || "Northstar Staff",
      at: serverTimestamp()
    }).catch(() => {});
    if (!options.silent) showToast("Alert acknowledged and moved to history.");
    return true;
  } catch (error) {
    if (previous && existingIndex >= 0) state.alerts[existingIndex] = previous;
    else if (!previous) state.alerts = state.alerts.filter(a => a.id !== id);
    if (!options.deferRender) renderAlerts();
    if (!options.silent) showToast(error?.code === "permission-denied" ? "Your account does not have permission to acknowledge alerts." : "Unable to acknowledge alert. Please try again.");
    return false;
  } finally {
    if (button && button.isConnected) {
      button.disabled = false;
      button.textContent = button.dataset.originalLabel || "Acknowledge";
    }
  }
}

async function setFacilityMode(mode) {
  if (!isAdmin()) return;
  const statusText = mode === "mci" ? "Mass Casualty Operations" : "Normal Operations";
  try {
    await setDoc(doc(db, "system", "facility"), { mode, statusText, updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid, updatedByName: state.profile.displayName }, { merge: true });
    showToast(mode === "mci" ? "Mass-casualty operations activated." : "Facility returned to normal operations.");
  } catch (_) { showToast("Unable to change facility status."); }
}

function openPermissionEditor(uid) {
  if (!isAdmin()) return;
  const user = userById(uid);
  if (!user) return;
  state.selectedStaff = uid;
  document.querySelector("#permissionStaffName").textContent = `${user.displayName || "Staff Member"} Permissions`;
  const defaults = ROLE_DEFAULTS[user.role] || ROLE_DEFAULTS.staff;
  const overrides = user.permissions || {};
  document.querySelector("#permissionList").innerHTML = PERMISSIONS.map(([key,title,detail]) => {
    const current = Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : defaults[key];
    return `<label class="permission-item"><input type="checkbox" data-permission-key="${safe(key)}" ${current ? "checked" : ""}><span><strong>${safe(title)}</strong><small>${safe(detail)}</small></span></label>`;
  }).join("");
  document.querySelector("#permissionDialog")?.showModal();
}

async function savePermissions(event) {
  event.preventDefault();
  if (!isAdmin() || !state.selectedStaff) return;
  const permissions = {};
  document.querySelectorAll("[data-permission-key]").forEach(input => { permissions[input.dataset.permissionKey] = input.checked; });
  try {
    await updateDoc(doc(db, "users", state.selectedStaff), { permissions, updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid });
    document.querySelector("#permissionDialog")?.close();
    showToast("Staff permissions updated.");
  } catch (_) { showToast("Unable to update staff permissions."); }
}

async function resetPermissions() {
  if (!isAdmin() || !state.selectedStaff) return;
  try {
    await updateDoc(doc(db, "users", state.selectedStaff), { permissions: {}, updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid });
    document.querySelector("#permissionDialog")?.close();
    showToast("Role-default permissions restored.");
  } catch (_) { showToast("Unable to reset staff permissions."); }
}

function commandItems(query) {
  const q = query.trim().toLowerCase();
  const commands = [
    { type: "command", title: "My Workstation", detail: "Open role-specific workspace", action: "workstation" },
    { type: "command", title: "Patient Search", detail: "Search patient registry", action: "patients" },
    { type: "command", title: "Rooms & Census", detail: "Open live room board", action: "rooms" },
    { type: "command", title: "Department Board", detail: "Open operations board", action: "operations" },
    { type: "command", title: "Clinical Alerts", detail: "Open alert center", action: "alerts" },
    { type: "command", title: "Messages", detail: "Open clinical messaging", action: "messages" },
    { type: "command", title: "Lock Workstation", detail: "Secure this workstation", action: "lock" }
  ];
  if (isAdmin()) commands.push({ type: "command", title: "Control Center", detail: "Open facility command center", action: "control" });
  const patients = state.patients.map(p => ({ type: "patient", title: `${p.lastName}, ${p.firstName}`, detail: `${p.mrn} · ${p.dob || "DOB unavailable"}`, id: p.id }));
  const rooms = roomRecords().map(r => ({ type: "room", title: r.name, detail: `${r.zone} · ${label(roomOccupant(r.name) ? "occupied" : r.status)}`, action: "rooms" }));
  return [...patients, ...rooms, ...commands].filter(item => !q || `${item.title} ${item.detail}`.toLowerCase().includes(q)).slice(0,14);
}

function openCommandPalette() {
  const overlay = document.querySelector("#northstarCommandPalette");
  overlay?.classList.remove("hidden");
  const input = document.querySelector("#northstarCommandInput");
  input.value = "";
  renderCommandResults();
  setTimeout(() => input.focus(), 20);
}
function closeCommandPalette() { document.querySelector("#northstarCommandPalette")?.classList.add("hidden"); }
function renderCommandResults() {
  const target = document.querySelector("#northstarCommandResults");
  if (!target) return;
  const items = commandItems(document.querySelector("#northstarCommandInput")?.value || "");
  target.innerHTML = items.length ? items.map((item,index) => `<button type="button" class="command-result ${index === 0 ? "selected" : ""}" data-command-index="${index}" data-command-type="${safe(item.type)}" ${item.id ? `data-command-patient="${safe(item.id)}"` : ""} ${item.action ? `data-command-action="${safe(item.action)}"` : ""}><span class="command-icon">${item.type === "patient" ? "P" : item.type === "room" ? "R" : "⌘"}</span><div><strong>${safe(item.title)}</strong><small>${safe(item.detail)}</small></div></button>`).join("") : '<div class="platform-empty">No matches.</div>';
}

function executeCommand(button) {
  if (button.dataset.commandPatient) { closeCommandPalette(); openPatient(button.dataset.commandPatient); return; }
  const action = button.dataset.commandAction;
  closeCommandPalette();
  if (["workstation","rooms","messages","alerts","control"].includes(action)) openPlatformSection(action);
  else if (action === "operations") document.querySelector("[data-operations-nav]")?.click();
  else if (action === "patients") document.querySelector('[data-section="patients"]')?.click();
  else if (action === "lock") lockWorkstation();
}

function lockWorkstation() {
  if (!auth.currentUser || state.locked) return;
  state.locked = true;
  document.querySelector("#lockIdentity").textContent = `${state.profile?.displayName || auth.currentUser.email} · ${ROLE_LABELS[state.profile?.role] || "Northstar Staff"}`;
  document.querySelector("#unlockPassword").value = "";
  document.querySelector("#unlockMessage").textContent = "";
  document.querySelector("#northstarLockScreen")?.classList.remove("hidden");
  setTimeout(() => document.querySelector("#unlockPassword")?.focus(), 30);
}

async function unlockWorkstation(event) {
  event.preventDefault();
  const password = document.querySelector("#unlockPassword").value;
  const message = document.querySelector("#unlockMessage");
  try {
    const credential = EmailAuthProvider.credential(auth.currentUser.email, password);
    await reauthenticateWithCredential(auth.currentUser, credential);
    state.locked = false;
    state.lastActivity = Date.now();
    document.querySelector("#northstarLockScreen")?.classList.add("hidden");
  } catch (_) {
    message.textContent = "Password not accepted.";
    message.className = "form-message error";
  }
}

function bindPlatformEvents() {
  document.querySelectorAll("[data-northstar-section]").forEach(b => b.addEventListener("click", () => openPlatformSection(b.dataset.northstarSection)));
  document.querySelector("#northstarCommandButton")?.addEventListener("click", openCommandPalette);
  document.querySelector("#northstarLockButton")?.addEventListener("click", lockWorkstation);
  document.querySelector("#northstarCommandInput")?.addEventListener("input", renderCommandResults);
  document.querySelector("#northstarCommandPalette")?.addEventListener("click", event => { if (event.target.id === "northstarCommandPalette") closeCommandPalette(); const result = event.target.closest(".command-result"); if (result) executeCommand(result); });

  document.addEventListener("click", async event => {
    const open = event.target.closest("[data-workstation-open]");
    if (open) {
      const dest = open.dataset.workstationOpen;
      if (["rooms","messages","alerts","workstation","control"].includes(dest)) openPlatformSection(dest);
      else if (dest === "operations") document.querySelector("[data-operations-nav]")?.click();
      else if (dest === "mar") window.dispatchEvent(new CustomEvent("northstar:open-mar"));
      else document.querySelector(`[data-section="${CSS.escape(dest)}"]`)?.click();
      return;
    }
    const patient = event.target.closest("[data-open-platform-patient]");
    if (patient) { openPatient(patient.dataset.openPlatformPatient); return; }
    if (event.target.closest("[data-assign-room]")) { openRoomAssignment(); return; }
    const roomStatus = event.target.closest("[data-room-status]");
    if (roomStatus) { await setRoomStatus(roomStatus.dataset.roomName, roomStatus.dataset.roomStatus); return; }
    if (event.target.closest("[data-compose-message]")) { openComposeMessage(); return; }
    const message = event.target.closest("[data-message-id]");
    if (message) { await markMessageRead(message.dataset.messageId); return; }
    const ack = event.target.closest("[data-ack-alert]");
    if (ack) { await acknowledgeAlert(ack.dataset.ackAlert); return; }
    if (event.target.closest("[data-facility-normal]")) { await setFacilityMode("normal"); return; }
    if (event.target.closest("[data-facility-mci]")) { await setFacilityMode("mci"); return; }
    const editPerm = event.target.closest("[data-edit-permissions]");
    if (editPerm) { openPermissionEditor(editPerm.dataset.editPermissions); return; }
    if (event.target.closest("[data-reset-permissions]")) { await resetPermissions(); return; }
  });

  document.addEventListener("keydown", event => {
    if (state.locked) return;
    if (event.key === "/" && !["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName)) { event.preventDefault(); openCommandPalette(); return; }
    if (event.key === "Escape") closeCommandPalette();
    if (!document.querySelector("#northstarCommandPalette")?.classList.contains("hidden") && event.key === "Enter") {
      const selected = document.querySelector(".command-result.selected") || document.querySelector(".command-result");
      if (selected) { event.preventDefault(); executeCommand(selected); }
    }
  });

  ["pointerdown","keydown","touchstart","mousemove"].forEach(type => document.addEventListener(type, () => { if (!state.locked) state.lastActivity = Date.now(); }, { passive: true }));
  window.addEventListener("northstar:open-patient", event => openPatient(event.detail?.patientId));
}

function stopListeners() {
  state.unsubscribers.forEach(unsub => { try { unsub(); } catch (_) {} });
  state.unsubscribers = [];
}

function bindCollection(name, key) {
  const unsub = onSnapshot(collection(db, name), snap => { state[key] = snap.docs.map(d => ({ id: d.id, ...d.data() })); scheduleRender(); }, () => { state[key] = []; scheduleRender(); });
  state.unsubscribers.push(unsub);
}

async function start(user) {
  stopListeners();
  state.profile = null;
  if (!user) return;
  const profileSnap = await getDoc(doc(db, "users", user.uid));
  if (!profileSnap.exists()) return;
  state.profile = { id: profileSnap.id, ...profileSnap.data() };
  if (state.profile.status !== "active") return;
  [
    ["users","users"], ["patients","patients"], ["encounters","encounters"], ["orders","orders"], ["results","results"],
    ["observations","observations"], ["medicationAdministrations","administrations"], ["shifts","shifts"], ["tasks","tasks"],
    ["rooms","rooms"], ["messages","messages"], ["clinicalAlerts","alerts"], ["emergencyEvents","emergencyEvents"]
  ].forEach(([name,key]) => bindCollection(name,key));
  const facilityUnsub = onSnapshot(doc(db, "system", "facility"), snap => { state.facility = snap.exists() ? { ...state.facility, ...snap.data() } : state.facility; scheduleRender(); });
  state.unsubscribers.push(facilityUnsub);
  scheduleRender();
}

injectPlatform();
setInterval(() => { if (auth.currentUser && state.profile && !state.locked && Date.now() - state.lastActivity > 10 * 60 * 1000) lockWorkstation(); }, 20_000);
setInterval(() => { if (state.profile) scheduleRender(); }, 30_000);

onAuthStateChanged(auth, user => start(user).catch(() => { state.profile = null; stopListeners(); }));
