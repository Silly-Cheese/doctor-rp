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

const state = {
  profile: null,
  founderUid: null,
  users: [],
  patients: [],
  encounters: [],
  selectedPatientId: null,
  unsubscribers: [],
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

const STATUS_LABELS = {
  active: "Active",
  pending: "Pending Approval",
  suspended: "Suspended"
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

function isDeceased(patient) {
  return patient?.vitalStatus === "deceased" || patient?.currentStatus === "deceased";
}

function canPronounce() {
  return ["administrator", "physician"].includes(state.profile?.role);
}

function isAdministrator() {
  return state.profile?.role === "administrator";
}

function patientById(id) {
  return state.patients.find((patient) => patient.id === id) || null;
}

function activeEncounter(patientId) {
  return state.encounters.find((encounter) => encounter.patientId === patientId && encounter.status !== "discharged") || null;
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 3000);
}

function ensureAssets() {
  if (!document.querySelector('link[href="admin-controls.css"]')) {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "admin-controls.css";
    document.head.appendChild(stylesheet);
  }

  if (!document.querySelector('link[rel~="icon"]')) {
    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.type = "image/svg+xml";
    icon.href = "favicon.svg";
    document.head.appendChild(icon);
  }
}

function injectDeathDialog() {
  if (document.querySelector("#deceasedDialog")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <dialog id="deceasedDialog" class="modal">
      <form id="deceasedForm" class="modal-card">
        <div class="modal-header">
          <div><p class="eyebrow">Patient Status</p><h3 id="deceasedPatientName">Mark Patient Deceased</h3></div>
          <button class="icon-button" type="button" data-close-deceased aria-label="Close">×</button>
        </div>
        <div class="modal-body form-grid">
          <div class="deceased-warning">
            <strong>This will block all future check-ins.</strong>
            <span>If an encounter is currently open, it will be closed with a deceased disposition.</span>
          </div>
          <label><span>Date and time of death</span><input id="deceasedAt" type="datetime-local" required></label>
          <label><span>Cause / circumstance</span><input id="deceasedCause" placeholder="Optional roleplay detail"></label>
          <label><span>Pronouncement note</span><textarea id="deceasedNote" rows="4" required placeholder="Document the roleplay circumstances and pronouncement"></textarea></label>
        </div>
        <div class="modal-footer">
          <button class="secondary-button" type="button" data-close-deceased>Cancel</button>
          <button class="danger-button" type="submit">Mark Deceased</button>
        </div>
      </form>
    </dialog>`);

  document.querySelectorAll("[data-close-deceased]").forEach((button) => {
    button.addEventListener("click", () => document.querySelector("#deceasedDialog")?.close());
  });
  document.querySelector("#deceasedDialog")?.addEventListener("click", (event) => {
    if (event.target.id === "deceasedDialog") event.target.close();
  });
  document.querySelector("#deceasedForm")?.addEventListener("submit", markPatientDeceased);
}

function localDateTimeValue(date = new Date()) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

function roleOptions(selected) {
  return Object.entries(ROLE_LABELS).map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

function clinicalRoleOptions(selected) {
  return ["physician", "nurse", "registration", "technician", "staff"]
    .map((value) => `<option value="${value}" ${value === selected ? "selected" : ""}>${ROLE_LABELS[value]}</option>`)
    .join("");
}

function statusOptions(selected) {
  return Object.entries(STATUS_LABELS).map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

function ensureStaffManager() {
  const section = document.querySelector("#staffSection");
  if (!section || !isAdministrator()) return;

  const heading = section.querySelector(".section-heading h3");
  if (heading) heading.textContent = "Staff Administration";
  const description = section.querySelector(".section-heading p:last-child");
  if (description) description.textContent = "Approve access, update staff profiles, change roles, and suspend accounts.";

  const pending = document.querySelector("#pendingStaffList");
  if (pending && !document.querySelector("#pendingAccountsLabel")) {
    pending.insertAdjacentHTML("beforebegin", `
      <div id="pendingAccountsLabel" class="staff-admin-subhead">
        <div><p class="eyebrow">Access Requests</p><h4>Pending Accounts</h4></div>
      </div>`);
  }

  if (!document.querySelector("#staffAccountManager")) {
    section.insertAdjacentHTML("beforeend", `
      <div id="staffAccountManager" class="staff-account-manager">
        <div class="staff-admin-subhead">
          <div><p class="eyebrow">Directory</p><h4>Staff Accounts</h4></div>
          <span id="staffAccountCount" class="staff-count"></span>
        </div>
        <div id="staffAccountList" class="managed-staff-list"></div>
      </div>`);
  }
}

function renderStaffManager() {
  if (!isAdministrator()) return;
  ensureStaffManager();
  const list = document.querySelector("#staffAccountList");
  const count = document.querySelector("#staffAccountCount");
  if (!list) return;

  const users = [...state.users].sort((a, b) => {
    if ((a.uid || a.id) === auth.currentUser?.uid) return -1;
    if ((b.uid || b.id) === auth.currentUser?.uid) return 1;
    return String(a.displayName || "").localeCompare(String(b.displayName || ""));
  });
  if (count) count.textContent = `${users.length} account${users.length === 1 ? "" : "s"}`;
  const signature = JSON.stringify(users.map(user => [user.uid || user.id, user.displayName || "", user.requestedRole || "", user.role || "", user.status || "", user.email || ""]));
  if (list.dataset.signature === signature) return;
  list.dataset.signature = signature;

  if (!users.length) {
    list.innerHTML = '<div class="managed-empty">No staff accounts are available.</div>';
    return;
  }

  list.innerHTML = users.map((user) => {
    const uid = user.uid || user.id;
    const self = uid === auth.currentUser?.uid;
    const founder = uid === state.founderUid;
    const lockAccess = founder;
    const title = user.requestedRole || (user.role === "administrator" ? "physician" : user.role) || "staff";
    return `
      <article class="managed-staff-card" data-managed-staff="${safe(uid)}">
        <div class="managed-staff-identity">
          <div class="managed-avatar">${safe((user.firstName?.[0] || "N") + (user.lastName?.[0] || "S"))}</div>
          <div>
            <div class="managed-name-line"><strong>${safe(user.displayName || "Northstar Staff")}</strong>${founder ? '<span class="founder-badge">Founding Administrator</span>' : self ? '<span class="founder-badge">Current Account</span>' : ""}</div>
            <span>${safe(user.email || "")}</span>
          </div>
        </div>
        <div class="managed-staff-fields">
          <label><span>Display name</span><input data-staff-name value="${safe(user.displayName || "")}" maxlength="80"></label>
          <label><span>Clinical title</span><select data-staff-title>${clinicalRoleOptions(title)}</select></label>
          <label><span>Access role</span><select data-staff-role ${lockAccess ? "disabled" : ""}>${roleOptions(user.role || "staff")}</select></label>
          <label><span>Account status</span><select data-staff-status ${lockAccess ? "disabled" : ""}>${statusOptions(user.status || "pending")}</select></label>
        </div>
        <div class="managed-staff-footer">
          <div>
            <span class="account-status status-${safe(user.status || "pending")}">${safe(STATUS_LABELS[user.status] || user.status || "Pending")}</span>
            ${lockAccess ? '<small>Administrator access is protected on the founding account.</small>' : ""}
          </div>
          <button class="primary-button compact" type="button" data-save-staff="${safe(uid)}">Save Changes</button>
        </div>
      </article>`;
  }).join("");
}

async function saveStaffAccount(uid, button) {
  if (!isAdministrator()) return;
  const card = document.querySelector(`[data-managed-staff="${CSS.escape(uid)}"]`);
  const existing = state.users.find((user) => (user.uid || user.id) === uid);
  if (!card || !existing) return;

  const founder = uid === state.founderUid;
  const displayName = card.querySelector("[data-staff-name]").value.trim() || existing.displayName || "Northstar Staff";
  const requestedRole = card.querySelector("[data-staff-title]").value;
  const role = founder ? "administrator" : card.querySelector("[data-staff-role]").value;
  const status = founder ? "active" : card.querySelector("[data-staff-status]").value;

  button.disabled = true;
  button.textContent = "Saving…";
  try {
    await updateDoc(doc(db, "users", uid), {
      displayName,
      requestedRole,
      role,
      status,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser.uid
    });
    await writeAudit("staff-account-updated", {
      staffUid: uid,
      staffName: displayName,
      role,
      status
    });
    showToast("Staff account updated.");
  } catch (_) {
    showToast("Unable to update that staff account.");
  } finally {
    button.disabled = false;
    button.textContent = "Save Changes";
  }
}

async function writeAudit(type, details = {}) {
  const auditRef = doc(collection(db, "auditEvents"));
  const batch = writeBatch(db);
  batch.set(auditRef, {
    type,
    actorUid: auth.currentUser.uid,
    actorName: state.profile?.displayName || auth.currentUser.displayName || "Northstar Staff",
    at: serverTimestamp(),
    ...details
  });
  await batch.commit();
}

function renderPatientDecorations() {
  const patientMap = new Map(state.patients.map((patient) => [patient.id, patient]));

  document.querySelectorAll("[data-patient-id]").forEach((node) => {
    const patient = patientMap.get(node.dataset.patientId);
    const deceased = isDeceased(patient);
    node.classList.toggle("deceased-record", deceased);
    if (deceased) {
      const pill = node.querySelector(".status-pill");
      if (pill) {
        pill.textContent = "Deceased";
        pill.className = "status-pill status-deceased";
      }
    }
  });

  document.querySelectorAll("[data-checkin-id]").forEach((button) => {
    const patient = patientMap.get(button.dataset.checkinId);
    if (!isDeceased(patient)) return;
    button.disabled = true;
    button.classList.add("checkin-blocked");
    button.textContent = "Check-In Unavailable";
    button.title = "This patient is recorded as deceased.";
  });

  renderVitalStatusPanel();
}

function renderVitalStatusPanel() {
  const chart = document.querySelector("#patientChartBody");
  const dialog = document.querySelector("#patientChartDialog");
  if (!chart || !dialog?.open) return;

  let patientId = state.selectedPatientId;
  if (!patientId || !patientById(patientId)) {
    patientId = chart.querySelector("[data-checkin-id]")?.dataset.checkinId || null;
  }
  const patient = patientById(patientId);
  if (!patient) return;
  state.selectedPatientId = patientId;

  const deceased = isDeceased(patient);
  const signature = [patient.id, deceased, patient.deceasedAt?.seconds || patient.deceasedAt || "", state.profile?.role].join("|");
  let panel = chart.querySelector("#vitalStatusPanel");
  if (panel?.dataset.signature === signature) return;
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "vitalStatusPanel";
    chart.prepend(panel);
  }
  panel.dataset.signature = signature;
  panel.className = `vital-status-panel ${deceased ? "deceased" : "living"}`;

  if (deceased) {
    panel.innerHTML = `
      <div class="vital-status-main">
        <span class="vital-status-chip deceased">Deceased</span>
        <div><strong>Patient is recorded as deceased</strong><p>All new check-ins are blocked for this record.</p></div>
      </div>
      <div class="deceased-detail-grid">
        <div><span>Date / time</span><strong>${safe(formatDateTime(patient.deceasedAt))}</strong></div>
        <div><span>Recorded by</span><strong>${safe(patient.deceasedByName || "Northstar Staff")}</strong></div>
        ${patient.deceasedCause ? `<div><span>Cause / circumstance</span><strong>${safe(patient.deceasedCause)}</strong></div>` : ""}
      </div>
      ${patient.deceasedNote ? `<p class="deceased-note">${safe(patient.deceasedNote)}</p>` : ""}
      ${isAdministrator() ? '<div class="vital-status-actions"><button class="secondary-button compact" type="button" data-restore-patient>Restore Active Status</button></div>' : ""}`;
  } else {
    panel.innerHTML = `
      <div class="vital-status-main">
        <span class="vital-status-chip living">Living</span>
        <div><strong>Vital status active</strong><p>This patient is eligible for registration and check-in.</p></div>
      </div>
      ${canPronounce() ? '<div class="vital-status-actions"><button class="text-danger" type="button" data-mark-deceased>Mark Patient Deceased</button></div>' : ""}`;
  }
}

function openDeceasedDialog() {
  if (!canPronounce()) return;
  const patient = patientById(state.selectedPatientId);
  if (!patient || isDeceased(patient)) return;
  const form = document.querySelector("#deceasedForm");
  form.reset();
  document.querySelector("#deceasedPatientName").textContent = `Mark ${patient.firstName || "Patient"} ${patient.lastName || ""} Deceased`.trim();
  document.querySelector("#deceasedAt").value = localDateTimeValue();
  document.querySelector("#deceasedDialog").showModal();
}

async function markPatientDeceased(event) {
  event.preventDefault();
  if (!canPronounce()) return;
  const patient = patientById(state.selectedPatientId);
  if (!patient || isDeceased(patient)) return;

  const submit = event.currentTarget.querySelector("button[type='submit']");
  const deathAtRaw = document.querySelector("#deceasedAt").value;
  const deathAt = deathAtRaw ? new Date(deathAtRaw) : new Date();
  const cause = document.querySelector("#deceasedCause").value.trim();
  const note = document.querySelector("#deceasedNote").value.trim();
  const encounter = activeEncounter(patient.id);

  submit.disabled = true;
  submit.textContent = "Saving…";
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "patients", patient.id), {
      vitalStatus: "deceased",
      currentStatus: "deceased",
      activeEncounterId: null,
      currentEncounterStatus: null,
      deceasedAt: deathAt,
      deceasedCause: cause,
      deceasedNote: note,
      deceasedBy: auth.currentUser.uid,
      deceasedByName: state.profile.displayName,
      updatedAt: serverTimestamp()
    });

    if (encounter) {
      batch.update(doc(db, "encounters", encounter.id), {
        status: "discharged",
        disposition: "deceased",
        finalDiagnosis: encounter.workingDiagnosis || encounter.finalDiagnosis || "Deceased",
        deathPronouncement: note,
        deceasedAt: deathAt,
        dischargedAt: serverTimestamp(),
        dischargedBy: auth.currentUser.uid,
        dischargedByName: state.profile.displayName,
        updatedAt: serverTimestamp()
      });
    }

    const auditRef = doc(collection(db, "auditEvents"));
    batch.set(auditRef, {
      type: "patient-deceased",
      patientId: patient.id,
      mrn: patient.mrn || "",
      encounterId: encounter?.id || null,
      actorUid: auth.currentUser.uid,
      actorName: state.profile.displayName,
      at: serverTimestamp()
    });

    await batch.commit();
    document.querySelector("#deceasedDialog").close();
    showToast("Patient marked deceased. Future check-ins are blocked.");
  } catch (_) {
    showToast("Unable to update the patient's vital status.");
  } finally {
    submit.disabled = false;
    submit.textContent = "Mark Deceased";
  }
}

async function restorePatientStatus() {
  if (!isAdministrator()) return;
  const patient = patientById(state.selectedPatientId);
  if (!patient || !isDeceased(patient)) return;
  if (!await window.NorthstarDialog.confirm({title:"Restore Patient Vital Status",message:`Restore ${patient.firstName || "this patient"} ${patient.lastName || ""} to active vital status?`,confirmText:"Restore Active Status",cancelText:"Cancel",tone:"warning"})) return;

  try {
    await updateDoc(doc(db, "patients", patient.id), {
      vitalStatus: "active",
      currentStatus: "not-checked-in",
      activeEncounterId: null,
      currentEncounterStatus: null,
      vitalStatusRestoredAt: serverTimestamp(),
      vitalStatusRestoredBy: auth.currentUser.uid,
      vitalStatusRestoredByName: state.profile.displayName,
      updatedAt: serverTimestamp()
    });
    await writeAudit("patient-deceased-status-reversed", {
      patientId: patient.id,
      mrn: patient.mrn || ""
    });
    showToast("Patient vital status restored. Check-in is available again.");
  } catch (_) {
    showToast("Unable to restore this patient record.");
  }
}

function scheduleRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => {
    state.renderQueued = false;
    renderStaffManager();
    renderPatientDecorations();
    renderCurrentIdentity();
  });
}

function renderCurrentIdentity() {
  if (!state.profile) return;
  const roleNode = document.querySelector("#userRole");
  if (!roleNode) return;
  const clinicalTitle = state.profile.requestedRole && state.profile.requestedRole !== "staff"
    ? ROLE_LABELS[state.profile.requestedRole]
    : null;
  roleNode.textContent = state.profile.role === "administrator" && clinicalTitle
    ? `Administrator · ${clinicalTitle}`
    : ROLE_LABELS[state.profile.role] || "Clinical Staff";
}

function stopListeners() {
  state.unsubscribers.forEach((unsubscribe) => {
    try { unsubscribe(); } catch (_) { }
  });
  state.unsubscribers = [];
  state.users = [];
  state.patients = [];
  state.encounters = [];
}

async function startForUser(user) {
  stopListeners();
  state.profile = null;
  state.founderUid = null;
  if (!user) return;

  const profileSnapshot = await getDoc(doc(db, "users", user.uid));
  if (!profileSnapshot.exists()) return;
  state.profile = { id: profileSnapshot.id, ...profileSnapshot.data() };
  if (state.profile.status !== "active") return;

  const setupSnapshot = await getDoc(doc(db, "system", "setup"));
  state.founderUid = setupSnapshot.exists() ? setupSnapshot.data().initializedBy || null : null;

  const mappings = [
    ["patients", "patients"],
    ["encounters", "encounters"]
  ];
  if (isAdministrator()) mappings.push(["users", "users"]);

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

  scheduleRender();
}

ensureAssets();
injectDeathDialog();

const patientResults = document.querySelector("#patientResults");
const chartBody = document.querySelector("#patientChartBody");
const staffSection = document.querySelector("#staffSection");
[patientResults, chartBody].filter(Boolean).forEach((target) => {
  const observer = new MutationObserver(scheduleRender);
  observer.observe(target, { childList: true, subtree: true });
});

document.addEventListener("click", async (event) => {
  const patientTarget = event.target.closest("[data-patient-id]");
  if (patientTarget) {
    state.selectedPatientId = patientTarget.dataset.patientId;
    setTimeout(scheduleRender, 0);
  }

  const saveStaff = event.target.closest("[data-save-staff]");
  if (saveStaff) {
    await saveStaffAccount(saveStaff.dataset.saveStaff, saveStaff);
    return;
  }

  if (event.target.closest("[data-mark-deceased]")) {
    openDeceasedDialog();
    return;
  }

  if (event.target.closest("[data-restore-patient]")) {
    await restorePatientStatus();
  }
}, false);

document.addEventListener("click", (event) => {
  const checkIn = event.target.closest("[data-checkin-id]");
  if (!checkIn) return;
  const patient = patientById(checkIn.dataset.checkinId);
  if (!isDeceased(patient)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  showToast("Check-in blocked: this patient is recorded as deceased.");
}, true);

onAuthStateChanged(auth, (user) => {
  startForUser(user).catch(() => {
    stopListeners();
    state.profile = null;
  });
});
