
import { getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, onSnapshot, setDoc, updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);

const state = {
  profile: null,
  patients: [],
  encounters: [],
  orders: [],
  results: [],
  tasks: [],
  handoffs: [],
  messages: [],
  alerts: [],
  events: [],
  shifts: [],
  facility: { mode: "normal", statusText: "Normal Operations" },
  unsubscribers: [],
  dataStarted: false,
  tab: "overview",
  inboxFilter: "all",
  monitorEncounterId: null,
  monitorTimer: null,
  renderQueued: false
};

const PHARMACY_STEPS = ["ordered", "verified", "prepared", "dispensed"];
const CONSULT_SERVICES = ["Cardiology", "General Surgery", "Neurology", "Orthopedics", "Psychiatry", "Pulmonology", "Hospital Medicine", "Critical Care"];

function safe(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function timeValue(value) { const d = toDate(value); return d ? d.getTime() : 0; }
function fmt(value) {
  const d = toDate(value);
  return d ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d) : "—";
}
function clock(value) {
  const d = toDate(value);
  return d ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(d) : "—";
}
function label(value) {
  return String(value || "").replaceAll("-", " ").replace(/\b\w/g, function(c){ return c.toUpperCase(); });
}
function activeEncounters() { return state.encounters.filter(function(e){ return e.status !== "discharged"; }); }
function encounterById(id) { return state.encounters.find(function(e){ return e.id === id; }) || null; }
function patientById(id) { return state.patients.find(function(p){ return p.id === id; }) || null; }
function isAdmin() { return state.profile && state.profile.status === "active" && state.profile.role === "administrator"; }
function isProvider() { return state.profile && state.profile.status === "active" && ["administrator","physician"].includes(state.profile.role); }
function canMedicationWorkflow() { return state.profile && state.profile.status === "active" && ["administrator","physician","nurse","technician"].includes(state.profile.role); }
function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(function(){ toast.classList.remove("show"); }, 3200);
}
function writeAudit(type, details) {
  if (!auth.currentUser) return Promise.resolve();
  const ref = doc(collection(db, "auditEvents"));
  return setDoc(ref, Object.assign({
    type: type,
    actorUid: auth.currentUser.uid,
    actorName: state.profile && state.profile.displayName ? state.profile.displayName : "Northstar Staff",
    at: serverTimestamp()
  }, details || {})).catch(function(){});
}

function ensureStyle() {
  if (document.querySelector('link[data-northstar-vnext]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.dataset.northstarVnext = "1";
  link.href = "northstar-vnext.css?v=" + (window.NorthstarBuild || "20260919");
  document.head.appendChild(link);
}

function inject() {
  if (document.querySelector("#northstarCommandSection")) return;
  ensureStyle();

  const nav = document.querySelector(".nav-list");
  if (nav) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nav-item";
    button.dataset.nxCommand = "1";
    button.innerHTML = '<span>✦</span> Command Hub <b class="nx-nav-badge">Open</b>';
    const first = nav.firstElementChild;
    if (first) nav.insertBefore(button, first); else nav.appendChild(button);
  }

  const main = document.querySelector("main.content");
  const dashboard = document.querySelector("#dashboardSection");
  if (main) {
    const section = document.createElement("section");
    section.id = "northstarCommandSection";
    section.className = "content-section hidden nx-command-section";
    if (dashboard) main.insertBefore(section, dashboard); else main.appendChild(section);
  }

  const topActions = document.querySelector(".topbar-actions");
  if (topActions && !document.querySelector("#northstarInboxButton")) {
    const button = document.createElement("button");
    button.id = "northstarInboxButton";
    button.type = "button";
    button.className = "secondary-button compact nx-top-button";
    button.innerHTML = '<span>Command Hub</span><b class="nx-top-badge">Open</b>';
    topActions.appendChild(button);
  }

  injectDialogs();
  bindEvents();
  renderShell();
}

function injectDialogs() {
  if (document.querySelector("#nxMonitorDialog")) return;
  document.body.insertAdjacentHTML("beforeend",
    '<dialog id="nxMonitorDialog" class="nx-monitor-dialog">' +
      '<div class="nx-monitor-shell">' +
        '<div class="nx-monitor-head">' +
          '<div class="nx-monitor-identity"><strong id="nxMonitorPatient">Bedside Monitor</strong><span id="nxMonitorMeta">Select an active patient</span></div>' +
          '<div class="nx-monitor-head-actions"><span class="nx-monitor-live"><i></i> Live Simulation</span><button class="icon-button" type="button" data-nx-close="nxMonitorDialog">×</button></div>' +
        '</div>' +
        '<div id="nxMonitorContent"></div>' +
      '</div>' +
    '</dialog>' +
    '<dialog id="nxConsultDialog" class="modal">' +
      '<form id="nxConsultForm" class="modal-card">' +
        '<div class="modal-header"><div><p class="eyebrow">Consult Center</p><h3>Request Specialty Consult</h3></div><button class="icon-button" type="button" data-nx-close="nxConsultDialog">×</button></div>' +
        '<div class="modal-body form-grid">' +
          '<label><span>Patient / Encounter</span><select id="nxConsultEncounter" required></select></label>' +
          '<div class="field-row"><label><span>Service</span><select id="nxConsultService">' + CONSULT_SERVICES.map(function(s){ return '<option>' + safe(s) + '</option>'; }).join("") + '</select></label>' +
          '<label><span>Urgency</span><select id="nxConsultPriority"><option value="routine">Routine</option><option value="urgent">Urgent</option><option value="stat">STAT</option></select></label></div>' +
          '<label><span>Reason for consult</span><textarea id="nxConsultReason" rows="4" required placeholder="Roleplay reason and question for the consulting service"></textarea></label>' +
          '<p class="form-note">Northstar consult workflows are for roleplay simulation and training only.</p>' +
        '</div>' +
        '<div class="modal-footer"><button class="secondary-button" type="button" data-nx-close="nxConsultDialog">Cancel</button><button class="primary-button" type="submit">Request Consult</button></div>' +
      '</form>' +
    '</dialog>' +
    '<dialog id="nxReportDialog" class="modal">' +
      '<div class="modal-card nx-report-card">' +
        '<div class="modal-header"><div><p class="eyebrow">Emergency Event Review</p><h3 id="nxReportTitle">After-Action Report</h3></div><button class="icon-button" type="button" data-nx-close="nxReportDialog">×</button></div>' +
        '<div id="nxReportBody" class="modal-body"></div>' +
        '<div class="modal-footer"><button class="secondary-button" type="button" data-nx-close="nxReportDialog">Close</button><button class="primary-button" type="button" data-nx-print-report>Print Report</button></div>' +
      '</div>' +
    '</dialog>'
  );
}

function openCommand(tab) {
  state.tab = tab || state.tab || "overview";
  ensureData();
  document.querySelectorAll(".content-section").forEach(function(s){ s.classList.add("hidden"); });
  document.querySelector("#northstarCommandSection")?.classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach(function(n){ n.classList.remove("active"); });
  document.querySelector("[data-nx-command]")?.classList.add("active");
  const title = document.querySelector("#pageTitle");
  const dept = document.querySelector("#departmentLabel");
  if (title) title.textContent = "Northstar Command Hub";
  if (dept) dept.textContent = "Connected Clinical Operations";
  document.querySelector(".sidebar")?.classList.remove("open");
  render();
}

function routeTo(destination) {
  const selectors = {
    patients: '[data-section="patients"]',
    encounters: '[data-section="encounters"]',
    orders: '[data-section="orders"]',
    results: '[data-section="results"]',
    operations: '[data-operations-nav]',
    messages: '[data-northstar-section="messages"]',
    alerts: '[data-northstar-section="alerts"]',
    mar: '[data-northstar-clinical="mar"]',
    emergency: '[data-sim-section="emergency"]',
    rooms: '[data-northstar-section="rooms"]'
  };
  const selector = selectors[destination];
  const button = selector ? document.querySelector(selector) : null;
  if (button) button.click();
}

function bindEvents() {
  document.querySelector("[data-nx-command]")?.addEventListener("click", function(){ openCommand("overview"); });
  document.querySelector("#northstarInboxButton")?.addEventListener("click", function(){ openCommand("inbox"); });

  document.addEventListener("click", function(event) {
    const tab = event.target.closest("[data-nx-tab]");
    if (tab) { state.tab = tab.dataset.nxTab; render(); return; }

    const filter = event.target.closest("[data-nx-filter]");
    if (filter) { state.inboxFilter = filter.dataset.nxFilter; render(); return; }

    const route = event.target.closest("[data-nx-route]");
    if (route) { routeTo(route.dataset.nxRoute); return; }

    const patient = event.target.closest("[data-nx-patient]");
    if (patient) {
      window.dispatchEvent(new CustomEvent("northstar:open-patient", { detail: { patientId: patient.dataset.nxPatient } }));
      return;
    }

    const monitor = event.target.closest("[data-nx-monitor]");
    if (monitor) { openMonitor(monitor.dataset.nxMonitor || ""); return; }

    const consult = event.target.closest("[data-nx-new-consult]");
    if (consult) { openConsult(); return; }

    const consultAction = event.target.closest("[data-nx-consult-action]");
    if (consultAction) {
      updateConsult(consultAction.dataset.nxConsultAction, consultAction.dataset.nxConsultId).catch(function(){});
      return;
    }

    const med = event.target.closest("[data-nx-med-next]");
    if (med) { advanceMedication(med.dataset.nxMedNext).catch(function(){}); return; }

    const response = event.target.closest("[data-nx-response]");
    if (response) { openResponse(response.dataset.nxResponse); return; }

    const report = event.target.closest("[data-nx-report]");
    if (report) { openReport(report.dataset.nxReport); return; }

    const condition = event.target.closest("[data-nx-condition]");
    if (condition) { applyCondition(condition.dataset.nxCondition).catch(function(){}); return; }

    if (event.target.closest("[data-nx-print-report]")) { printReport(); return; }

    const close = event.target.closest("[data-nx-close]");
    if (close) {
      const dialog = document.querySelector("#" + close.dataset.nxClose);
      if (dialog && dialog.id === "nxMonitorDialog") stopMonitorTimer();
      dialog?.close();
    }
  });

  document.querySelector("#nxConsultForm")?.addEventListener("submit", submitConsult);
  document.querySelector("#nxMonitorDialog")?.addEventListener("close", stopMonitorTimer);
  document.addEventListener("change", function(event){
    if (event.target && event.target.id === "nxMonitorEncounter") {
      state.monitorEncounterId = event.target.value;
      renderMonitor();
    }
  });
}

function renderShell() {
  const section = document.querySelector("#northstarCommandSection");
  if (!section || section.innerHTML) return;
  section.innerHTML =
    '<div class="nx-command-head"><div class="nx-command-head-top"><div><p class="eyebrow">Connected Clinical Operations</p><h3>Northstar Command Hub</h3><p>A single live workspace for clinical priorities, patient flow, medications, consults, emergency response, and simulation oversight.</p></div><span class="nx-facility-state"><i></i> Ready</span></div>' +
    '<div class="nx-command-metrics"><article><span>Active Patients</span><strong>—</strong></article><article><span>Needs Attention</span><strong>—</strong></article><article><span>Open Tasks</span><strong>—</strong></article><article><span>Staff On Duty</span><strong>—</strong></article><article><span>Emergencies</span><strong>—</strong></article></div></div>' +
    '<div class="nx-empty"><strong>Command Hub ready</strong><p>Open this workspace to begin live synchronization.</p></div>';
}

function ensureData() {
  if (state.dataStarted || !auth.currentUser || !state.profile || state.profile.status !== "active") return;
  state.dataStarted = true;
  bindCollection("patients", "patients");
  bindCollection("encounters", "encounters");
  bindCollection("orders", "orders");
  bindCollection("results", "results");
  bindCollection("tasks", "tasks");
  bindCollection("handoffs", "handoffs");
  bindCollection("messages", "messages");
  bindCollection("clinicalAlerts", "alerts");
  bindCollection("emergencyEvents", "events");
  bindCollection("shifts", "shifts");
  const facilityUnsub = onSnapshot(doc(db, "system", "facility"), function(snapshot){
    state.facility = snapshot.exists() ? Object.assign({ mode: "normal", statusText: "Normal Operations" }, snapshot.data()) : { mode: "normal", statusText: "Normal Operations" };
    scheduleRender();
  }, function(){});
  state.unsubscribers.push(facilityUnsub);
}

function bindCollection(name, key) {
  const unsub = onSnapshot(collection(db, name), function(snapshot){
    state[key] = snapshot.docs.map(function(d){ return Object.assign({ id: d.id }, d.data()); });
    scheduleRender();
  }, function(){ state[key] = []; scheduleRender(); });
  state.unsubscribers.push(unsub);
}

function stopData() {
  state.unsubscribers.forEach(function(unsub){ try { unsub(); } catch (_) {} });
  state.unsubscribers = [];
  state.dataStarted = false;
  state.patients = []; state.encounters = []; state.orders = []; state.results = [];
  state.tasks = []; state.handoffs = []; state.messages = []; state.alerts = [];
  state.events = []; state.shifts = [];
  stopMonitorTimer();
}

function scheduleRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(function(){
    state.renderQueued = false;
    updateBadges();
    const section = document.querySelector("#northstarCommandSection");
    if (section && !section.classList.contains("hidden")) render();
    if (document.querySelector("#nxMonitorDialog")?.open) renderMonitor();
  });
}

function activeAlerts() {
  const activeIds = new Set(activeEncounters().map(function(e){ return e.id; }));
  return state.alerts.filter(function(a){
    if (a.acknowledged === true) return false;
    return !a.encounterId || activeIds.has(a.encounterId);
  });
}

function relevantMessages() {
  const uid = auth.currentUser?.uid;
  return state.messages.filter(function(m){
    return m.recipientType === "department" || m.recipientUid === uid || m.senderUid === uid;
  });
}

function inboxItems() {
  const uid = auth.currentUser?.uid;
  const items = [];
  activeAlerts().forEach(function(a){
    items.push({ kind:"alert", level:a.level === "critical" ? "critical" : "urgent", title:a.title || "Clinical alert", detail:a.detail || "Attention required", at:a.lastSeenAt, route:"alerts" });
  });
  state.tasks.filter(function(t){ return t.status === "open" && (!t.assigneeUid || t.assigneeUid === uid); }).forEach(function(t){
    items.push({ kind:"task", level:t.priority === "stat" ? "critical" : t.priority === "urgent" ? "urgent" : "normal", title:t.title || "Open task", detail:(t.patientName ? t.patientName + " · " : "") + (t.details || "Task requires attention"), at:t.dueAt || t.createdAt, route:"operations" });
  });
  state.handoffs.filter(function(h){ return h.status === "open" && (!h.recipientUid || h.recipientUid === uid); }).forEach(function(h){
    items.push({ kind:"handoff", level:"normal", title:"Handoff: " + (h.patientName || "Patient"), detail:h.situation || "SBAR handoff awaiting acceptance", at:h.createdAt, route:"operations" });
  });
  relevantMessages().filter(function(m){ return !(m.readBy || []).includes(uid) && m.senderUid !== uid; }).forEach(function(m){
    items.push({ kind:"message", level:m.urgent ? "urgent" : "normal", title:m.subject || "Clinical message", detail:(m.senderName || "Northstar Staff") + " · " + (m.body || ""), at:m.createdAt, route:"messages" });
  });
  if (isProvider()) {
    state.results.filter(function(r){ return r.status !== "reviewed"; }).forEach(function(r){
      items.push({ kind:"result", level:r.abnormal ? "critical" : "normal", title:(r.abnormal ? "Abnormal result: " : "Result: ") + (r.orderName || r.summary || "Diagnostic result"), detail:r.patientName || "Provider review required", at:r.createdAt, route:"results" });
    });
  }
  state.orders.filter(function(o){ return o.priority === "stat" && !["complete","administered","cancelled"].includes(o.status); }).forEach(function(o){
    items.push({ kind:"order", level:"urgent", title:"STAT order: " + (o.name || "Order"), detail:o.patientName || "Open STAT order", at:o.createdAt, route:"orders" });
  });
  const weight = { critical:0, urgent:1, normal:2 };
  return items.sort(function(a,b){
    const byLevel = (weight[a.level] || 2) - (weight[b.level] || 2);
    return byLevel !== 0 ? byLevel : timeValue(b.at) - timeValue(a.at);
  });
}

function updateBadges() {
  if (!state.dataStarted) return;
  const count = inboxItems().length;
  document.querySelectorAll(".nx-nav-badge,.nx-top-badge").forEach(function(node){ node.textContent = count > 99 ? "99+" : String(count); });
}

function focusEncounters() {
  const uid = auth.currentUser?.uid;
  const role = state.profile?.role;
  const active = activeEncounters().slice();
  if (role === "registration") return active.filter(function(e){ return ["waiting","triage"].includes(e.status) || !e.room; }).slice(0,8);
  if (role === "nurse") {
    return active.sort(function(a,b){
      const aa = a.nurseUid === uid ? 0 : 1, bb = b.nurseUid === uid ? 0 : 1;
      if (aa !== bb) return aa - bb;
      return Number(a.triage?.acuity || 9) - Number(b.triage?.acuity || 9);
    }).slice(0,8);
  }
  if (role === "technician") {
    const ids = new Set(state.orders.filter(function(o){ return ["laboratory","imaging","procedure"].includes(o.category) && !["complete","cancelled"].includes(o.status); }).map(function(o){ return o.encounterId; }));
    return active.filter(function(e){ return ids.has(e.id); }).slice(0,8);
  }
  return active.sort(function(a,b){
    const aa = a.providerUid === uid ? 0 : !a.providerUid ? 1 : 2;
    const bb = b.providerUid === uid ? 0 : !b.providerUid ? 1 : 2;
    if (aa !== bb) return aa - bb;
    return Number(a.triage?.acuity || 9) - Number(b.triage?.acuity || 9);
  }).slice(0,8);
}

function attentionItems() {
  const items = [];
  state.events.filter(function(e){ return e.status === "active"; }).forEach(function(e){
    items.push({ level:"critical", title:(e.type || "Emergency") + " active", detail:(e.patientName || "Patient") + " · " + (e.room || "Emergency Department"), route:"emergency" });
  });
  activeEncounters().forEach(function(e){
    const v = e.latestVitals || e.triage || {};
    const hr = Number(v.heartRate || 0), spo2 = Number(v.spo2 || 0), acuity = Number(e.triage?.acuity || 9);
    if (acuity <= 2) items.push({ level:acuity === 1 ? "critical" : "urgent", title:"ESI " + acuity + " · " + (e.patientName || "Patient"), detail:e.chiefComplaint || "High-acuity encounter", patientId:e.patientId });
    if (spo2 && spo2 < 90) items.push({ level:"critical", title:"Simulation monitor alert", detail:(e.patientName || "Patient") + " · SpO₂ " + spo2 + "%", monitor:e.id });
    if (hr && (hr >= 135 || hr <= 40)) items.push({ level:"urgent", title:"Simulation monitor alert", detail:(e.patientName || "Patient") + " · HR " + hr, monitor:e.id });
  });
  state.results.filter(function(r){ return r.abnormal && r.status !== "reviewed"; }).forEach(function(r){
    items.push({ level:"critical", title:r.summary || "Abnormal result", detail:r.patientName || r.orderName || "Provider review required", route:"results" });
  });
  return items.slice(0,8);
}

function render() {
  const section = document.querySelector("#northstarCommandSection");
  if (!section || !state.profile) return;
  const active = activeEncounters();
  const attention = attentionItems();
  const openTasks = state.tasks.filter(function(t){ return t.status === "open"; }).length;
  const onDuty = state.shifts.filter(function(s){ return s.status === "active"; });
  const emergencies = state.events.filter(function(e){ return e.status === "active"; });
  const facilityClass = state.facility.mode === "mci" ? "nx-facility-state mci" : "nx-facility-state";
  const facilityText = state.facility.statusText || (state.facility.mode === "mci" ? "Mass Casualty Operations" : "Normal Operations");

  section.innerHTML =
    '<div class="nx-command-head">' +
      '<div class="nx-command-head-top"><div><p class="eyebrow">Connected Clinical Operations</p><h3>Northstar Command Hub</h3><p>' + safe(roleCopy()) + '</p></div>' +
      '<span class="' + facilityClass + '"><i></i>' + safe(facilityText) + '</span></div>' +
      '<div class="nx-command-metrics">' +
        metric("Active Patients", active.length) + metric("Needs Attention", inboxItems().length) + metric("Open Tasks", openTasks) + metric("Staff On Duty", onDuty.length) + metric("Emergencies", emergencies.length) +
      '</div>' +
    '</div>' +
    '<div class="nx-command-tabs">' +
      tabButton("overview","Overview") + tabButton("inbox","Universal Inbox") + tabButton("pharmacy","Pharmacy") + tabButton("consults","Consults") + tabButton("response","Response & Debrief") +
    '</div>' +
    renderTab();
  updateBadges();
}

function roleCopy() {
  const role = state.profile?.role;
  if (role === "nurse") return "Nursing command view for assigned patients, medication flow, tasks, handoffs, and changing conditions.";
  if (role === "registration") return "Patient-flow view for arrivals, identity, room movement, communication, and hospital status.";
  if (role === "technician") return "Diagnostic command view for active work, priority orders, results, and patient movement.";
  if (role === "physician") return "Provider command view for patient priorities, consults, results, orders, and emergency response.";
  if (role === "administrator") return "Facility-wide command view with simulation oversight, clinical operations, staffing, and emergency response.";
  return "Connected command view for Northstar clinical operations.";
}
function metric(name, value) { return '<article><span>' + safe(name) + '</span><strong>' + safe(value) + '</strong></article>'; }
function tabButton(id, text) { return '<button type="button" data-nx-tab="' + id + '" class="' + (state.tab === id ? "active" : "") + '">' + safe(text) + '</button>'; }

function renderTab() {
  if (state.tab === "inbox") return renderInbox();
  if (state.tab === "pharmacy") return renderPharmacy();
  if (state.tab === "consults") return renderConsults();
  if (state.tab === "response") return renderResponses();
  return renderOverview();
}

function renderOverview() {
  const focus = focusEncounters();
  const attention = attentionItems();
  const staff = state.shifts.filter(function(s){ return s.status === "active"; }).sort(function(a,b){ return timeValue(a.startedAt)-timeValue(b.startedAt); }).slice(0,12);
  return '<div class="nx-command-layout">' +
    '<div class="nx-panel"><div class="nx-panel-head"><div><p class="eyebrow">Role-Aware Focus</p><h4>What needs your attention now</h4></div><div class="nx-panel-head-actions"><button class="nx-action secondary" type="button" data-nx-route="operations">Department Board</button><button class="nx-action" type="button" data-nx-monitor>Open Bedside Monitor</button></div></div>' +
      '<div class="nx-panel-body">' + (focus.length ? '<div class="nx-focus-grid">' + focus.map(focusCard).join("") + '</div>' : empty("No patients in your focus queue","Assignments, arrivals, and diagnostic work will appear here.")) + '</div></div>' +
    '<div class="nx-side-stack">' +
      '<div class="nx-panel"><div class="nx-panel-head"><div><p class="eyebrow">Live Surveillance</p><h4>Attention</h4></div><button class="nx-action secondary" type="button" data-nx-tab="inbox">Inbox</button></div><div class="nx-panel-body">' +
        (attention.length ? '<div class="nx-attention-list">' + attention.map(attentionCard).join("") + '</div>' : empty("No urgent signals","Northstar is not detecting an active urgent condition.")) + '</div></div>' +
      '<div class="nx-panel"><div class="nx-panel-head"><div><p class="eyebrow">Staff Presence</p><h4>On Duty</h4></div><span class="nx-status complete">' + staff.length + ' active</span></div><div class="nx-panel-body">' +
        (staff.length ? '<div class="nx-staff-list">' + staff.map(staffRow).join("") + '</div>' : empty("No active shifts","Staff can start a shift from the Department Board.")) + '</div></div>' +
    '</div>' +
    '<div class="nx-safety-note"><strong>SIMULATION:</strong><span>Northstar Medical Center is a roleplay system. The monitor, condition controls, and workflow tools are not for real patient care or medical decision-making.</span></div>' +
  '</div>';
}
function focusCard(e) {
  const p = patientById(e.patientId);
  const name = e.patientName || (p ? ((p.lastName || "") + ", " + (p.firstName || "")) : "Patient");
  return '<button class="nx-focus-card" type="button" data-nx-patient="' + safe(e.patientId) + '"><span class="nx-room-token">' + safe(e.room || "WAIT") + '</span><div><strong>' + safe(name) + '</strong><small>' + safe(e.chiefComplaint || label(e.status) || "Active encounter") + '</small></div><span class="nx-acuity">' + (e.triage?.acuity ? "ESI " + safe(e.triage.acuity) : "") + '</span></button>';
}
function attentionCard(item) {
  const action = item.monitor ? ' data-nx-monitor="' + safe(item.monitor) + '"' : item.patientId ? ' data-nx-patient="' + safe(item.patientId) + '"' : item.route ? ' data-nx-route="' + safe(item.route) + '"' : "";
  return '<button type="button" class="nx-attention ' + safe(item.level) + '"' + action + '><span class="nx-attention-mark">!</span><div><strong>' + safe(item.title) + '</strong><small>' + safe(item.detail) + '</small></div></button>';
}
function staffRow(s) {
  return '<div class="nx-staff-row"><i class="nx-presence"></i><div><strong>' + safe(s.displayName || "Northstar Staff") + '</strong><span>' + safe(s.roleLabel || label(s.role || "Clinical Staff")) + '</span></div><time>' + safe(fmt(s.startedAt)) + '</time></div>';
}
function empty(title, detail) { return '<div class="nx-empty"><strong>' + safe(title) + '</strong><p>' + safe(detail) + '</p></div>'; }

function renderInbox() {
  const all = inboxItems();
  const filtered = state.inboxFilter === "all" ? all : all.filter(function(i){ return i.kind === state.inboxFilter; });
  const kinds = [["all","All"],["alert","Alerts"],["task","Tasks"],["handoff","Handoffs"],["message","Messages"],["result","Results"],["order","STAT"]];
  return '<div class="nx-panel"><div class="nx-panel-head"><div><p class="eyebrow">Unified Work Queue</p><h4>Universal Inbox</h4></div><span class="nx-status">' + all.length + ' items</span></div>' +
    '<div class="nx-panel-body"><div class="nx-inbox-toolbar"><div class="nx-filter-row">' + kinds.map(function(k){ return '<button type="button" data-nx-filter="' + k[0] + '" class="' + (state.inboxFilter === k[0] ? "active" : "") + '">' + k[1] + '</button>'; }).join("") + '</div></div>' +
    (filtered.length ? '<div class="nx-inbox-list">' + filtered.slice(0,60).map(inboxRow).join("") + '</div>' : empty("Inbox clear","There is nothing in this filter right now.")) + '</div></div>';
}
function inboxRow(item) {
  const icon = { alert:"!",task:"✓",handoff:"↔",message:"✉",result:"◇",order:"☷" }[item.kind] || "•";
  return '<article class="nx-inbox-item ' + safe(item.level) + '"><span class="nx-inbox-icon">' + icon + '</span><div class="nx-inbox-copy"><strong>' + safe(item.title) + '</strong><span>' + safe(item.detail) + '</span></div><div class="nx-inbox-meta"><span>' + safe(item.kind) + ' · ' + safe(fmt(item.at)) + '</span><button type="button" data-nx-route="' + safe(item.route) + '">Open →</button></div></article>';
}

function medicationOrders() {
  return state.orders.filter(function(o){ return o.category === "medication" && !["cancelled"].includes(o.status); }).sort(function(a,b){ return timeValue(b.createdAt)-timeValue(a.createdAt); });
}
function renderPharmacy() {
  const meds = medicationOrders();
  const waiting = meds.filter(function(m){ return (m.pharmacyStatus || "ordered") !== "dispensed" && !["administered","complete"].includes(m.status); }).length;
  return '<div class="nx-panel"><div class="nx-panel-head"><div><p class="eyebrow">Medication Fulfillment</p><h4>Northstar Pharmacy</h4></div><div class="nx-panel-head-actions"><span class="nx-status">' + waiting + ' in workflow</span><button class="nx-action secondary" type="button" data-nx-route="mar">Open MAR</button></div></div>' +
    '<div class="nx-panel-body">' + (meds.length ? '<div class="nx-pharmacy-list">' + meds.slice(0,60).map(medicationRow).join("") + '</div>' : empty("No medication orders","Provider medication orders will appear here.")) + '</div></div>';
}
function medicationRow(order) {
  const status = order.pharmacyStatus || (["administered","complete"].includes(order.status) ? "dispensed" : "ordered");
  const index = Math.max(0, PHARMACY_STEPS.indexOf(status));
  const next = PHARMACY_STEPS[Math.min(index + 1, PHARMACY_STEPS.length - 1)];
  const canAdvance = canMedicationWorkflow() && status !== "dispensed" && !["administered","complete"].includes(order.status);
  const steps = PHARMACY_STEPS.map(function(step,i){ return '<span class="' + (i <= index ? "done" : "") + '" title="' + safe(label(step)) + '"></span>'; }).join("");
  return '<article class="nx-med-row"><div class="nx-med-top"><div><strong>' + safe(order.name || "Medication") + '</strong><small>' + safe(order.patientName || order.mrn || "Patient") + ' · ' + safe(order.dose || "Dose not specified") + ' · ' + safe(order.route || "Route not specified") + '</small></div><span class="nx-status ' + safe(status) + '">' + safe(label(status)) + '</span></div><div class="nx-stepper">' + steps + '</div><div class="nx-row-actions"><span class="nx-status ' + safe(order.priority || "routine") + '">' + safe(String(order.priority || "routine").toUpperCase()) + '</span>' + (canAdvance ? '<button class="nx-action" type="button" data-nx-med-next="' + safe(order.id) + '">Mark ' + safe(label(next)) + '</button>' : '') + '<button class="nx-action secondary" type="button" data-nx-patient="' + safe(order.patientId) + '">Open Patient</button></div></article>';
}
async function advanceMedication(id) {
  const order = state.orders.find(function(o){ return o.id === id; });
  if (!order || !canMedicationWorkflow()) return;
  const current = order.pharmacyStatus || "ordered";
  const index = PHARMACY_STEPS.indexOf(current);
  const next = PHARMACY_STEPS[Math.min((index < 0 ? 0 : index) + 1, PHARMACY_STEPS.length - 1)];
  if (current === next) return;
  try {
    await updateDoc(doc(db, "orders", id), {
      pharmacyStatus: next,
      pharmacyUpdatedAt: serverTimestamp(),
      pharmacyUpdatedBy: auth.currentUser.uid,
      pharmacyUpdatedByName: state.profile.displayName
    });
    await writeAudit("pharmacy-workflow-updated", { orderId:id, patientId:order.patientId || null, encounterId:order.encounterId || null, pharmacyStatus:next });
    showToast("Medication marked " + label(next) + ".");
  } catch (_) { showToast("Unable to update medication workflow."); }
}

function consultOrders() {
  return state.orders.filter(function(o){ return o.category === "consult"; }).sort(function(a,b){ return timeValue(b.createdAt)-timeValue(a.createdAt); });
}
function renderConsults() {
  const rows = consultOrders();
  return '<div class="nx-panel"><div class="nx-panel-head"><div><p class="eyebrow">Specialty Coordination</p><h4>Consult Center</h4></div>' + (isProvider() ? '<button class="nx-action" type="button" data-nx-new-consult>Request Consult</button>' : '') + '</div><div class="nx-panel-body">' +
    (rows.length ? '<div class="nx-consult-list">' + rows.slice(0,50).map(consultRow).join("") + '</div>' : empty("No consult requests","Provider specialty consult requests will appear here.")) + '</div></div>';
}
function consultRow(order) {
  const cs = order.consultStatus || (order.status === "complete" ? "complete" : "requested");
  let buttons = '<button class="nx-action secondary" type="button" data-nx-patient="' + safe(order.patientId) + '">Open Patient</button>';
  if (isProvider() && cs === "requested") buttons = '<button class="nx-action" type="button" data-nx-consult-action="accept" data-nx-consult-id="' + safe(order.id) + '">Accept Consult</button>' + buttons;
  if (isProvider() && cs === "accepted") buttons = '<button class="nx-action" type="button" data-nx-consult-action="complete" data-nx-consult-id="' + safe(order.id) + '">Complete Consult</button>' + buttons;
  return '<article class="nx-consult-row"><div class="nx-consult-top"><div><strong>' + safe(order.consultService || order.name || "Consult") + '</strong><small>' + safe(order.patientName || "Patient") + ' · ' + safe(order.instructions || "No reason entered") + '</small></div><span class="nx-status ' + safe(cs) + '">' + safe(label(cs)) + '</span></div><div class="nx-row-actions" style="margin-top:12px"><span class="nx-status ' + safe(order.priority || "routine") + '">' + safe(String(order.priority || "routine").toUpperCase()) + '</span>' + buttons + '</div></article>';
}
function openConsult() {
  if (!isProvider()) return;
  ensureData();
  const select = document.querySelector("#nxConsultEncounter");
  const active = activeEncounters();
  if (!active.length) { showToast("There are no active encounters."); return; }
  select.innerHTML = active.map(function(e){ return '<option value="' + safe(e.id) + '">' + safe(e.room || "WAIT") + ' — ' + safe(e.patientName || e.mrn || "Patient") + '</option>'; }).join("");
  document.querySelector("#nxConsultForm")?.reset();
  document.querySelector("#nxConsultDialog")?.showModal();
}
async function submitConsult(event) {
  event.preventDefault();
  if (!isProvider()) return;
  const encounter = encounterById(document.querySelector("#nxConsultEncounter").value);
  if (!encounter) return;
  const patient = patientById(encounter.patientId);
  const service = document.querySelector("#nxConsultService").value;
  const priority = document.querySelector("#nxConsultPriority").value;
  const reason = document.querySelector("#nxConsultReason").value.trim();
  const ref = doc(collection(db, "orders"));
  try {
    await setDoc(ref, {
      patientId: encounter.patientId,
      encounterId: encounter.id,
      patientName: encounter.patientName || (patient ? (patient.lastName + ", " + patient.firstName) : "Patient"),
      mrn: encounter.mrn || patient?.mrn || "",
      category: "consult",
      name: service + " Consultation",
      consultService: service,
      consultStatus: "requested",
      priority: priority,
      instructions: reason,
      status: "ordered",
      orderedBy: auth.currentUser.uid,
      orderedByName: state.profile.displayName,
      createdAt: serverTimestamp()
    });
    await writeAudit("consult-requested", { orderId:ref.id, encounterId:encounter.id, patientId:encounter.patientId, consultService:service });
    document.querySelector("#nxConsultDialog")?.close();
    showToast(service + " consult requested.");
  } catch (_) { showToast("Unable to request consult."); }
}
async function updateConsult(action, id) {
  if (!isProvider()) return;
  const order = state.orders.find(function(o){ return o.id === id; });
  if (!order) return;
  try {
    if (action === "accept") {
      await updateDoc(doc(db, "orders", id), { consultStatus:"accepted", consultAcceptedAt:serverTimestamp(), consultAcceptedBy:auth.currentUser.uid, consultAcceptedByName:state.profile.displayName });
      await writeAudit("consult-accepted", { orderId:id, encounterId:order.encounterId || null, patientId:order.patientId || null });
      showToast("Consult accepted.");
    } else if (action === "complete") {
      await updateDoc(doc(db, "orders", id), { consultStatus:"complete", status:"complete", completedAt:serverTimestamp(), completedBy:auth.currentUser.uid, completedByName:state.profile.displayName });
      await writeAudit("consult-completed", { orderId:id, encounterId:order.encounterId || null, patientId:order.patientId || null });
      showToast("Consult completed.");
    }
  } catch (_) { showToast("Unable to update consult."); }
}

function renderResponses() {
  const events = state.events.slice().sort(function(a,b){ return timeValue(b.startedAt)-timeValue(a.startedAt); });
  const active = events.filter(function(e){ return e.status === "active"; });
  const closed = events.filter(function(e){ return e.status !== "active"; }).slice(0,15);
  return '<div class="nx-command-layout">' +
    '<div class="nx-panel"><div class="nx-panel-head"><div><p class="eyebrow">Emergency Operations</p><h4>Active Responses</h4></div><button class="nx-action danger" type="button" data-nx-route="emergency">Emergency Recorder</button></div><div class="nx-panel-body">' +
      (active.length ? '<div class="nx-response-list">' + active.map(responseRow).join("") + '</div>' : empty("No active emergency responses","Code Blue, Rapid Response, Trauma, and Stroke events will appear here.")) + '</div></div>' +
    '<div class="nx-panel"><div class="nx-panel-head"><div><p class="eyebrow">After-Action Review</p><h4>Recent Events</h4></div><span class="nx-status">' + closed.length + ' recent</span></div><div class="nx-panel-body">' +
      (closed.length ? '<div class="nx-response-list">' + closed.map(closedResponseRow).join("") + '</div>' : empty("No closed events","Completed emergency events will be available for debrief.")) + '</div></div>' +
    '</div>';
}
function elapsed(event) {
  const start = timeValue(event.startedAt);
  const end = event.status === "active" ? Date.now() : timeValue(event.endedAt);
  if (!start || !end) return "—";
  const sec = Math.max(0, Math.floor((end-start)/1000));
  return String(Math.floor(sec/60)).padStart(2,"0") + ":" + String(sec%60).padStart(2,"0");
}
function responseRow(e) {
  return '<article class="nx-response-row"><div class="nx-response-top"><div><strong>' + safe(e.type || "Emergency Response") + '</strong><small>' + safe(e.patientName || "Patient") + ' · ' + safe(e.room || "Emergency Department") + '</small></div><span class="nx-status critical">ACTIVE · ' + safe(elapsed(e)) + '</span></div><div class="nx-row-actions" style="margin-top:12px"><button class="nx-action danger" type="button" data-nx-response="' + safe(e.id) + '">Open Response Board</button><button class="nx-action secondary" type="button" data-nx-monitor="' + safe(e.encounterId) + '">Monitor</button></div></article>';
}
function closedResponseRow(e) {
  return '<article class="nx-response-row"><div class="nx-response-top"><div><strong>' + safe(e.type || "Emergency Response") + '</strong><small>' + safe(e.patientName || "Patient") + ' · ' + safe(fmt(e.startedAt)) + '</small></div><span class="nx-status">' + safe(elapsed(e)) + '</span></div><div class="nx-row-actions" style="margin-top:12px"><button class="nx-action secondary" type="button" data-nx-report="' + safe(e.id) + '">After-Action Report</button></div></article>';
}
function openResponse(id) {
  routeTo("emergency");
}
function openReport(id) {
  const event = state.events.find(function(e){ return e.id === id; });
  if (!event) return;
  document.querySelector("#nxReportTitle").textContent = (event.type || "Emergency") + " After-Action Report";
  const actions = (event.actions || []).slice();
  const timeline = [{ time:clock(event.startedAt), label:"Response activated", actor:event.startedByName || "Northstar Staff" }]
    .concat(actions.map(function(a){ return { time:a.time || clock(a.at), label:a.label || "Event action", actor:a.actorName || "Northstar Staff" }; }))
    .concat(event.endedAt ? [{ time:clock(event.endedAt), label:"Response closed", actor:event.endedByName || "Northstar Staff" }] : []);
  document.querySelector("#nxReportBody").innerHTML =
    '<div class="nx-report-summary"><div><span>Patient</span><strong>' + safe(event.patientName || "Patient") + '</strong></div><div><span>Location</span><strong>' + safe(event.room || "Emergency Department") + '</strong></div><div><span>Duration</span><strong>' + safe(elapsed(event)) + '</strong></div><div><span>Actions</span><strong>' + actions.length + '</strong></div></div>' +
    '<div class="nx-event-timeline">' + timeline.map(function(t){ return '<div><time>' + safe(t.time) + '</time><span>' + safe(t.label) + '</span><small>' + safe(t.actor) + '</small></div>'; }).join("") + '</div>' +
    '<div class="nx-safety-note"><strong>ROLEPLAY:</strong><span>This event report documents simulation activity inside Northstar Medical Center and is not a real medical record.</span></div>';
  document.querySelector("#nxReportDialog")?.showModal();
}
function printReport() {
  const card = document.querySelector("#nxReportDialog .nx-report-card");
  if (!card) return;
  const root = document.createElement("div");
  root.className = "nx-print-root";
  root.appendChild(card.cloneNode(true));
  document.body.appendChild(root);
  document.body.classList.add("nx-printing");
  window.print();
  setTimeout(function(){ document.body.classList.remove("nx-printing"); root.remove(); }, 500);
}

function openMonitor(encounterId) {
  ensureData();
  const active = activeEncounters();
  if (!active.length) { showToast("There are no active encounters to monitor."); return; }
  state.monitorEncounterId = encounterId && encounterById(encounterId) ? encounterId : (state.monitorEncounterId && encounterById(state.monitorEncounterId) ? state.monitorEncounterId : active[0].id);
  renderMonitor();
  const dialog = document.querySelector("#nxMonitorDialog");
  if (dialog && !dialog.open) dialog.showModal();
  startMonitorTimer();
}
function startMonitorTimer() {
  stopMonitorTimer();
  state.monitorTimer = setInterval(function(){
    if (!document.hidden && document.querySelector("#nxMonitorDialog")?.open) renderMonitorWaveOnly();
  }, 1000);
}
function stopMonitorTimer() {
  if (state.monitorTimer) clearInterval(state.monitorTimer);
  state.monitorTimer = null;
}
function monitorVitals(encounter) {
  const v = encounter?.latestVitals || encounter?.triage || {};
  return {
    heartRate:Number(v.heartRate || v.hr || 0),
    bloodPressure:v.bloodPressure || v.bp || "—",
    respirations:Number(v.respirations || v.rr || 0),
    spo2:Number(v.spo2 || 0),
    temperature:Number(v.temperature || v.temp || 0),
    pain:Number(v.pain || 0)
  };
}
function monitorStatus(v) {
  if ((v.spo2 && v.spo2 < 88) || (v.heartRate && (v.heartRate >= 140 || v.heartRate <= 38))) return { level:"critical", text:"Critical simulation values detected" };
  if ((v.spo2 && v.spo2 < 93) || (v.heartRate && (v.heartRate >= 120 || v.heartRate <= 48))) return { level:"warning", text:"Simulation values require attention" };
  return { level:"ok", text:"Simulation monitor within configured range" };
}
function renderMonitor() {
  const active = activeEncounters();
  if (!active.length) return;
  let encounter = encounterById(state.monitorEncounterId);
  if (!encounter || encounter.status === "discharged") { encounter = active[0]; state.monitorEncounterId = encounter.id; }
  const patient = patientById(encounter.patientId);
  const v = monitorVitals(encounter);
  const status = monitorStatus(v);
  const name = encounter.patientName || (patient ? (patient.lastName + ", " + patient.firstName) : "Patient");
  document.querySelector("#nxMonitorPatient").textContent = name;
  document.querySelector("#nxMonitorMeta").innerHTML =
    '<select id="nxMonitorEncounter">' + active.map(function(e){ return '<option value="' + safe(e.id) + '"' + (e.id === encounter.id ? " selected" : "") + '>' + safe(e.room || "WAIT") + ' — ' + safe(e.patientName || e.mrn || "Patient") + '</option>'; }).join("") + '</select> · ' + safe(encounter.mrn || patient?.mrn || "") + (encounter.simulationActive ? ' · <strong>Scenario Active</strong>' : '');
  const controls = isAdmin() ?
    '<div class="nx-monitor-controls"><div class="nx-monitor-controls-head"><strong>Scenario Director Condition Controls</strong><span>Changes update this encounter simulation only</span></div><div class="nx-preset-row"><button type="button" data-nx-condition="stable">Stable</button><button type="button" data-nx-condition="deteriorating">Deteriorating</button><button type="button" data-nx-condition="critical">Critical</button><button type="button" data-nx-condition="improving">Improving</button></div></div>' :
    '<div class="nx-monitor-controls"><div class="nx-monitor-controls-head"><strong>Live roleplay monitor</strong><span>Condition controls are available to administrators.</span></div></div>';
  document.querySelector("#nxMonitorContent").innerHTML =
    '<div class="nx-monitor-body"><div class="nx-wave-stack">' +
      waveRow("ECG","ecg",wavePoints(v.heartRate || 82, 1)) + waveRow("SpO₂","spo",wavePoints(v.spo2 || 98, 2)) + waveRow("RESP","resp",wavePoints(v.respirations || 16, 3)) +
    '</div><div class="nx-monitor-vitals">' +
      vital("HR",v.heartRate || "—","bpm","ecg") + vital("SpO₂",v.spo2 || "—","%","spo") + vital("RESP",v.respirations || "—","/min","resp") + vital("NIBP",v.bloodPressure || "—","","bp") + vital("TEMP",v.temperature ? v.temperature.toFixed(1) : "—","°F","temp") +
      '<div class="nx-monitor-alert ' + (status.level === "ok" ? "ok" : "") + '">' + safe(status.text) + '</div>' +
    '</div></div>' + controls +
    '<div class="nx-safety-note"><strong>SIMULATION:</strong><span>Displayed values are roleplay data and must not be used for real medical care.</span></div>';
}
function renderMonitorWaveOnly() {
  const encounter = encounterById(state.monitorEncounterId);
  if (!encounter) return;
  const v = monitorVitals(encounter);
  const rows = document.querySelectorAll("#nxMonitorDialog .nx-wave-svg polyline");
  const values = [v.heartRate || 82, v.spo2 || 98, v.respirations || 16];
  rows.forEach(function(line,i){ line.setAttribute("points", wavePoints(values[i], i+1)); });
}
function waveRow(name, cls, points) {
  const color = cls === "ecg" ? "#86efac" : cls === "spo" ? "#7dd3fc" : "#fde68a";
  return '<div class="nx-wave-row"><span class="nx-wave-label ' + cls + '">' + safe(name) + '</span><svg class="nx-wave-svg" viewBox="0 0 900 150" preserveAspectRatio="none" style="color:' + color + '"><polyline fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" points="' + points + '"></polyline></svg></div>';
}
function wavePoints(value, seed) {
  const points = [];
  const t = Date.now()/850;
  const rate = Math.max(4, Math.min(18, Number(value || 80)/9));
  for (let x=0; x<=900; x+=10) {
    const phase = ((x/900)*rate + t + seed*.77) % 1;
    let y = 75 + Math.sin((x/900)*Math.PI*8 + seed)*3;
    if (seed === 1) {
      if (phase < .05) y -= phase/.05*13;
      else if (phase < .09) y += (phase-.05)/.04*18;
      else if (phase < .12) y -= (phase-.09)/.03*58;
      else if (phase < .15) y += (phase-.12)/.03*43;
      else if (phase < .24) y -= Math.sin((phase-.15)/.09*Math.PI)*8;
    } else if (seed === 2) y -= Math.max(0, Math.sin(phase*Math.PI))*26;
    else y -= Math.sin(phase*Math.PI*2)*12;
    points.push(x + "," + Math.round(y));
  }
  return points.join(" ");
}
function vital(name, value, unit, cls) {
  return '<div class="nx-vital ' + cls + '"><span>' + safe(name) + '</span><strong>' + safe(value) + '</strong><small>' + safe(unit) + '</small></div>';
}
async function applyCondition(kind) {
  if (!isAdmin()) return;
  const encounter = encounterById(state.monitorEncounterId);
  if (!encounter) return;
  const presets = {
    stable:{ heartRate:84, bloodPressure:"122/78", respirations:16, spo2:98, temperature:98.6, pain:2 },
    deteriorating:{ heartRate:118, bloodPressure:"96/62", respirations:24, spo2:91, temperature:99.1, pain:6 },
    critical:{ heartRate:142, bloodPressure:"78/48", respirations:32, spo2:84, temperature:99.4, pain:8 },
    improving:{ heartRate:92, bloodPressure:"112/72", respirations:18, spo2:96, temperature:98.8, pain:3 }
  };
  const vitals = presets[kind];
  if (!vitals) return;
  try {
    await updateDoc(doc(db, "encounters", encounter.id), {
      latestVitals:vitals,
      simulationActive:true,
      simulationCue:"Condition preset: " + label(kind),
      simulationCondition:kind,
      simulationConditionUpdatedAt:serverTimestamp(),
      updatedAt:serverTimestamp()
    });
    if (kind === "critical" || kind === "deteriorating") {
      await setDoc(doc(db, "clinicalAlerts", "vnext-condition-" + encounter.id), {
        level:kind === "critical" ? "critical" : "urgent",
        title:"Patient condition changed",
        detail:(encounter.patientName || "Patient") + " · " + label(kind) + " simulation state",
        encounterId:encounter.id,
        patientId:encounter.patientId,
        lastSeenAt:serverTimestamp()
      }, { merge:true });
    } else {
      await setDoc(doc(db, "clinicalAlerts", "vnext-condition-" + encounter.id), {
        acknowledged:true,
        acknowledgedByName:state.profile.displayName,
        acknowledgedAt:serverTimestamp(),
        lastSeenAt:serverTimestamp()
      }, { merge:true });
    }
    await writeAudit("simulation-condition-updated", { encounterId:encounter.id, patientId:encounter.patientId, condition:kind });
    showToast("Simulation condition set to " + label(kind) + ".");
  } catch (_) { showToast("Unable to update simulation condition."); }
}

onAuthStateChanged(auth, async function(user){
  stopData();
  state.profile = null;
  if (!user) { updateSignedOutBadges(); return; }
  try {
    const snapshot = await getDoc(doc(db, "users", user.uid));
    if (!snapshot.exists()) return;
    state.profile = Object.assign({ id:snapshot.id }, snapshot.data());
    if (state.profile.status !== "active") return;
    renderShell();
  } catch (_) {}
});
function updateSignedOutBadges() {
  document.querySelectorAll(".nx-nav-badge,.nx-top-badge").forEach(function(node){ node.textContent = "Open"; });
}

inject();
