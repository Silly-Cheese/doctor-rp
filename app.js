import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  writeBatch,
  updateDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBPtNWvmmYl-6hFb7NlmNszapMwQH4Xm7I",
  authDomain: "doctor-rp.firebaseapp.com",
  projectId: "doctor-rp",
  storageBucket: "doctor-rp.firebasestorage.app",
  messagingSenderId: "76025336566",
  appId: "1:76025336566:web:b8507e26ce66d44c6b52d7"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const ROLE_LABELS = {
  administrator: "Administrator",
  physician: "Physician",
  nurse: "Registered Nurse",
  registration: "Registration",
  technician: "Clinical Technician",
  staff: "Clinical Staff"
};

const STATUS_LABELS = {
  waiting: "Waiting",
  triage: "Triage Complete",
  roomed: "Roomed",
  treatment: "In Treatment",
  "awaiting-results": "Awaiting Results",
  "ready-discharge": "Ready for Discharge",
  discharged: "Discharged"
};

const els = {
  authView: document.querySelector("#authView"),
  pendingView: document.querySelector("#pendingView"),
  mainView: document.querySelector("#mainView"),
  signInTab: document.querySelector("#signInTab"),
  registerTab: document.querySelector("#registerTab"),
  signInForm: document.querySelector("#signInForm"),
  registerForm: document.querySelector("#registerForm"),
  authMessage: document.querySelector("#authMessage"),
  signOutButton: document.querySelector("#signOutButton"),
  pendingSignOut: document.querySelector("#pendingSignOut"),
  userName: document.querySelector("#userName"),
  userRole: document.querySelector("#userRole"),
  userInitials: document.querySelector("#userInitials"),
  pageTitle: document.querySelector("#pageTitle"),
  greeting: document.querySelector("#greeting"),
  clock: document.querySelector("#clock"),
  menuButton: document.querySelector("#menuButton"),
  sidebar: document.querySelector(".sidebar"),
  quickPatientSearch: document.querySelector("#quickPatientSearch"),
  pendingStaffList: document.querySelector("#pendingStaffList"),
  patientSearchInput: document.querySelector("#patientSearchInput"),
  patientResults: document.querySelector("#patientResults"),
  waitingRoomList: document.querySelector("#waitingRoomList"),
  activeEncounterList: document.querySelector("#activeEncounterList"),
  dashboardPatients: document.querySelector("#dashboardPatients"),
  patientRegistrationDialog: document.querySelector("#patientRegistrationDialog"),
  patientRegistrationForm: document.querySelector("#patientRegistrationForm"),
  patientChartDialog: document.querySelector("#patientChartDialog"),
  patientChartBody: document.querySelector("#patientChartBody"),
  chartPatientName: document.querySelector("#chartPatientName"),
  checkInDialog: document.querySelector("#checkInDialog"),
  checkInForm: document.querySelector("#checkInForm"),
  checkInPatientLabel: document.querySelector("#checkInPatientLabel"),
  triageDialog: document.querySelector("#triageDialog"),
  triageForm: document.querySelector("#triageForm"),
  triagePatientName: document.querySelector("#triagePatientName"),
  dischargeDialog: document.querySelector("#dischargeDialog"),
  dischargeForm: document.querySelector("#dischargeForm"),
  dischargePatientName: document.querySelector("#dischargePatientName")
};

let currentStaff = null;
let patients = [];
let encounters = [];
let unsubscribePatients = null;
let unsubscribeEncounters = null;
let selectedPatientId = null;
let selectedEncounterId = null;
let toastTimer;

function showView(view) {
  [els.authView, els.pendingView, els.mainView].forEach((node) => node.classList.add("hidden"));
  view.classList.remove("hidden");
}

function setAuthMessage(message = "", type = "") {
  els.authMessage.textContent = message;
  els.authMessage.className = `form-message${type ? ` ${type}` : ""}`;
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function switchAuth(mode) {
  const registering = mode === "register";
  els.registerForm.classList.toggle("hidden", !registering);
  els.signInForm.classList.toggle("hidden", registering);
  els.registerTab.classList.toggle("active", registering);
  els.signInTab.classList.toggle("active", !registering);
  setAuthMessage();
}

function normalizeName(value) {
  return value.trim().replace(/\s+/g, " ");
}

function initials(first, last) {
  return `${first?.[0] || ""}${last?.[0] || ""}`.toUpperCase() || "NS";
}

function formatRole(role) {
  return ROLE_LABELS[role] || "Clinical Staff";
}

function safe(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function friendlyError(error) {
  const code = error?.code || "";
  if (code.includes("email-already-in-use")) return "An account already exists with that email address.";
  if (code.includes("invalid-credential")) return "The email address or password is incorrect.";
  if (code.includes("weak-password")) return "Choose a stronger password with at least six characters.";
  if (code.includes("invalid-email")) return "Enter a valid email address.";
  if (code.includes("too-many-requests")) return "Too many attempts. Try again shortly.";
  if (code.includes("permission-denied")) return "Northstar could not complete that request with the current access level.";
  return "Northstar could not complete that request.";
}

function canRegisterPatients() {
  return ["administrator", "physician", "nurse", "registration"].includes(currentStaff?.role);
}

function canTriagePatients() {
  return ["administrator", "physician", "nurse"].includes(currentStaff?.role);
}

function canDischargePatients() {
  return ["administrator", "physician"].includes(currentStaff?.role);
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

function formatDateOnly(value) {
  if (!value) return "—";
  const parts = String(value).split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return safe(value);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })
    .format(new Date(parts[0], parts[1] - 1, parts[2]));
}

function calculateAge(value) {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "—";
  const now = new Date();
  let age = now.getFullYear() - year;
  const beforeBirthday = now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day);
  if (beforeBirthday) age -= 1;
  return Math.max(age, 0);
}

function formatStatus(status) {
  return STATUS_LABELS[status] || String(status || "Unknown").replaceAll("-", " ");
}

function encounterIsActive(encounter) {
  return encounter.status !== "discharged";
}

function encounterSortValue(encounter) {
  return toDate(encounter.arrivalAt)?.getTime() || 0;
}

function patientSortName(patient) {
  return `${patient.lastName || ""}, ${patient.firstName || ""}`.toLowerCase();
}

function generateMrn() {
  let mrn;
  do {
    const time = String(Date.now()).slice(-6);
    const random = Math.floor(10 + Math.random() * 90);
    mrn = `NMC-${time}${random}`;
  } while (patients.some((patient) => patient.mrn === mrn));
  return mrn;
}

async function writeAudit(type, details = {}) {
  const ref = doc(collection(db, "auditEvents"));
  const batch = writeBatch(db);
  batch.set(ref, {
    type,
    actorUid: auth.currentUser.uid,
    actorName: currentStaff?.displayName || auth.currentUser.displayName || "Northstar Staff",
    at: serverTimestamp(),
    ...details
  });
  await batch.commit();
}

async function registerStaff(event) {
  event.preventDefault();
  setAuthMessage();

  const firstName = normalizeName(document.querySelector("#firstName").value);
  const lastName = normalizeName(document.querySelector("#lastName").value);
  const email = document.querySelector("#registerEmail").value.trim().toLowerCase();
  const password = document.querySelector("#registerPassword").value;
  const requestedRole = document.querySelector("#requestedRole").value;
  const submit = els.registerForm.querySelector("button[type='submit']");

  if (!firstName || !lastName) {
    setAuthMessage("Enter your first and last name.", "error");
    return;
  }

  submit.disabled = true;
  submit.textContent = "Creating Account…";

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    const displayName = `${firstName} ${lastName}`;
    await updateProfile(credential.user, { displayName });

    const setupRef = doc(db, "system", "setup");
    const staffRef = doc(db, "users", credential.user.uid);
    const setupSnapshot = await getDoc(setupRef);

    if (!setupSnapshot.exists()) {
      const batch = writeBatch(db);
      batch.set(setupRef, {
        initialized: true,
        initializedBy: credential.user.uid,
        initializedAt: serverTimestamp(),
        facilityName: "Northstar Medical Center"
      });
      batch.set(staffRef, {
        uid: credential.user.uid,
        firstName,
        lastName,
        displayName,
        email,
        requestedRole,
        role: "administrator",
        status: "active",
        createdAt: serverTimestamp(),
        approvedAt: serverTimestamp(),
        approvedBy: credential.user.uid
      });
      await batch.commit();
      showToast("Northstar administrator account created.");
    } else {
      await setDoc(staffRef, {
        uid: credential.user.uid,
        firstName,
        lastName,
        displayName,
        email,
        requestedRole,
        role: "staff",
        status: "pending",
        createdAt: serverTimestamp()
      });
    }
  } catch (error) {
    setAuthMessage(friendlyError(error), "error");
  } finally {
    submit.disabled = false;
    submit.textContent = "Create Staff Account";
  }
}

async function signInStaff(event) {
  event.preventDefault();
  setAuthMessage();
  const email = document.querySelector("#signInEmail").value.trim().toLowerCase();
  const password = document.querySelector("#signInPassword").value;
  const submit = els.signInForm.querySelector("button[type='submit']");
  submit.disabled = true;
  submit.textContent = "Signing In…";
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    setAuthMessage(friendlyError(error), "error");
  } finally {
    submit.disabled = false;
    submit.textContent = "Sign In";
  }
}

async function loadStaffProfile(user) {
  const snapshot = await getDoc(doc(db, "users", user.uid));
  return snapshot.exists() ? snapshot.data() : null;
}

function renderStaffIdentity(profile) {
  els.userName.textContent = profile.displayName || `${profile.firstName || ""} ${profile.lastName || ""}`.trim() || "Staff Member";
  els.userRole.textContent = formatRole(profile.role);
  els.userInitials.textContent = initials(profile.firstName, profile.lastName);
  document.querySelectorAll(".admin-only").forEach((node) => node.classList.toggle("hidden", profile.role !== "administrator"));
  document.querySelectorAll(".registration-action").forEach((node) => node.classList.toggle("hidden", !canRegisterPatients()));

  const hour = new Date().getHours();
  const salutation = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  els.greeting.textContent = `${salutation}, ${profile.firstName || ""}`.trim();
}

function sectionTitle(section) {
  return {
    dashboard: "Clinical Overview",
    patients: "Patient Search",
    waiting: "Waiting Room",
    encounters: "Active Encounters",
    orders: "Orders",
    results: "Results",
    staff: "Staff Access"
  }[section] || "Clinical Overview";
}

function openSection(section) {
  if (section === "staff" && currentStaff?.role !== "administrator") return;
  document.querySelectorAll(".content-section").forEach((node) => node.classList.add("hidden"));
  document.querySelector(`#${section}Section`)?.classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.section === section));
  els.pageTitle.textContent = sectionTitle(section);
  els.sidebar.classList.remove("open");
  if (section === "staff") loadPendingStaff();
  if (section === "patients") renderPatientSearch();
  if (section === "waiting") renderWaitingRoom();
  if (section === "encounters") renderActiveEncounters();
}

async function loadPendingStaff() {
  els.pendingStaffList.innerHTML = '<div class="panel"><div class="empty-state compact-empty"><p>Loading staff accounts…</p></div></div>';
  try {
    const snapshot = await getDocs(query(collection(db, "users"), where("status", "==", "pending")));
    if (snapshot.empty) {
      els.pendingStaffList.innerHTML = '<div class="panel"><div class="empty-state compact-empty"><h4>No pending accounts</h4><p>There are no staff access requests awaiting review.</p></div></div>';
      return;
    }

    els.pendingStaffList.innerHTML = "";
    snapshot.forEach((staffDoc) => {
      const staff = staffDoc.data();
      const card = document.createElement("article");
      card.className = "staff-card";
      card.innerHTML = `
        <div>
          <h4>${safe(staff.displayName || "Staff Member")}</h4>
          <div class="staff-meta">${safe(staff.email || "")} · Requested: ${safe(formatRole(staff.requestedRole))}</div>
        </div>
        <div class="staff-actions">
          <select aria-label="Assigned role">
            <option value="physician" ${staff.requestedRole === "physician" ? "selected" : ""}>Physician</option>
            <option value="nurse" ${staff.requestedRole === "nurse" ? "selected" : ""}>Registered Nurse</option>
            <option value="registration" ${staff.requestedRole === "registration" ? "selected" : ""}>Registration</option>
            <option value="technician" ${staff.requestedRole === "technician" ? "selected" : ""}>Clinical Technician</option>
            <option value="administrator">Administrator</option>
          </select>
          <button class="primary-button approve-staff" type="button">Approve</button>
        </div>`;
      card.querySelector(".approve-staff").addEventListener("click", () => approveStaff(staffDoc.id, card));
      els.pendingStaffList.appendChild(card);
    });
  } catch (error) {
    els.pendingStaffList.innerHTML = `<div class="panel"><div class="empty-state compact-empty"><h4>Unable to load staff accounts</h4><p>${safe(friendlyError(error))}</p></div></div>`;
  }
}

async function approveStaff(uid, card) {
  const button = card.querySelector(".approve-staff");
  const role = card.querySelector("select").value;
  button.disabled = true;
  button.textContent = "Approving…";
  try {
    await updateDoc(doc(db, "users", uid), {
      role,
      status: "active",
      approvedAt: serverTimestamp(),
      approvedBy: auth.currentUser.uid
    });
    card.remove();
    showToast("Staff access approved.");
    if (!els.pendingStaffList.children.length) loadPendingStaff();
  } catch (error) {
    button.disabled = false;
    button.textContent = "Approve";
    showToast(friendlyError(error));
  }
}

function startClinicalListeners() {
  stopClinicalListeners();

  unsubscribePatients = onSnapshot(collection(db, "patients"), (snapshot) => {
    patients = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    patients.sort((a, b) => patientSortName(a).localeCompare(patientSortName(b)));
    renderClinicalState();
  }, () => showToast("Unable to refresh patient records."));

  unsubscribeEncounters = onSnapshot(collection(db, "encounters"), (snapshot) => {
    encounters = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    encounters.sort((a, b) => encounterSortValue(b) - encounterSortValue(a));
    renderClinicalState();
  }, () => showToast("Unable to refresh encounter records."));
}

function stopClinicalListeners() {
  if (unsubscribePatients) unsubscribePatients();
  if (unsubscribeEncounters) unsubscribeEncounters();
  unsubscribePatients = null;
  unsubscribeEncounters = null;
  patients = [];
  encounters = [];
}

function renderClinicalState() {
  renderDashboard();
  renderPatientSearch();
  renderWaitingRoom();
  renderActiveEncounters();
  if (selectedPatientId && els.patientChartDialog.open) renderPatientChart(selectedPatientId);
}

function emptyPanel(title, text) {
  return `<div class="panel"><div class="empty-state compact-empty"><h4>${safe(title)}</h4><p>${safe(text)}</p></div></div>`;
}

function activeEncounterForPatient(patientId) {
  return encounters.find((encounter) => encounter.patientId === patientId && encounterIsActive(encounter));
}

function renderDashboard() {
  const active = encounters.filter(encounterIsActive);
  const waiting = active.filter((item) => item.status === "waiting").length;
  const roomed = active.filter((item) => item.status === "roomed").length;
  const treatment = active.filter((item) => ["treatment", "awaiting-results", "ready-discharge"].includes(item.status)).length;
  const critical = active.filter((item) => item.initialPriority === "critical" || Number(item.triage?.acuity) <= 2).length;

  document.querySelector("#waitingCount").textContent = waiting;
  document.querySelector("#roomedCount").textContent = roomed;
  document.querySelector("#treatmentCount").textContent = treatment;
  document.querySelector("#criticalCount").textContent = critical;

  if (!active.length) {
    els.dashboardPatients.innerHTML = '<div class="empty-state"><div class="empty-icon">✚</div><h4>No active encounters</h4><p>Checked-in patients will appear here.</p></div>';
    return;
  }

  els.dashboardPatients.innerHTML = `<div class="clinical-list">${active.slice(0, 7).map((encounter) => encounterRow(encounter, true)).join("")}</div>`;
}

function renderPatientSearch() {
  if (!els.patientResults) return;
  const term = (els.patientSearchInput?.value || "").trim().toLowerCase();
  const filtered = patients.filter((patient) => {
    if (!term) return true;
    const haystack = `${patient.firstName || ""} ${patient.lastName || ""} ${patient.lastName || ""}, ${patient.firstName || ""} ${patient.mrn || ""}`.toLowerCase();
    return haystack.includes(term);
  }).slice(0, 50);

  if (!patients.length) {
    els.patientResults.innerHTML = emptyPanel("No patient records", canRegisterPatients() ? "Register the first Northstar patient to begin." : "No patient records are available.");
    return;
  }

  if (!filtered.length) {
    els.patientResults.innerHTML = emptyPanel("No matching patients", "Try a different name or medical record number.");
    return;
  }

  els.patientResults.innerHTML = `<div class="panel table-panel"><div class="patient-table">${filtered.map(patientRow).join("")}</div></div>`;
}

function patientRow(patient) {
  const encounter = activeEncounterForPatient(patient.id);
  const status = encounter ? formatStatus(encounter.status) : patient.currentStatus === "admitted" ? "Admitted" : "Not Checked In";
  return `
    <button class="patient-row" type="button" data-patient-id="${safe(patient.id)}">
      <div class="patient-avatar">${safe(initials(patient.firstName, patient.lastName))}</div>
      <div class="patient-primary"><strong>${safe(patient.lastName)}, ${safe(patient.firstName)}</strong><span>${safe(patient.mrn)} · ${safe(calculateAge(patient.dob))} yrs · ${safe(patient.sex || "Unknown")}</span></div>
      <div class="patient-last"><span>Last check-in</span><strong>${safe(formatDateTime(patient.lastCheckInAt))}</strong></div>
      <span class="status-pill status-${safe(encounter?.status || "inactive")}">${safe(status)}</span>
      <span class="row-chevron">›</span>
    </button>`;
}

function renderWaitingRoom() {
  if (!els.waitingRoomList) return;
  const waiting = encounters.filter((encounter) => encounterIsActive(encounter) && ["waiting", "triage"].includes(encounter.status));
  if (!waiting.length) {
    els.waitingRoomList.innerHTML = emptyPanel("Waiting room is clear", "No patients are currently awaiting triage or room assignment.");
    return;
  }
  els.waitingRoomList.innerHTML = `<div class="encounter-grid">${waiting.map(encounterCard).join("")}</div>`;
}

function renderActiveEncounters() {
  if (!els.activeEncounterList) return;
  const active = encounters.filter(encounterIsActive);
  if (!active.length) {
    els.activeEncounterList.innerHTML = emptyPanel("No active encounters", "No patient visits are currently open.");
    return;
  }
  els.activeEncounterList.innerHTML = `<div class="encounter-grid">${active.map(encounterCard).join("")}</div>`;
}

function encounterRow(encounter, compact = false) {
  const patient = patients.find((item) => item.id === encounter.patientId);
  const patientName = encounter.patientName || (patient ? `${patient.lastName}, ${patient.firstName}` : "Patient");
  const room = encounter.room || encounter.triage?.room || "Waiting";
  return `
    <button class="clinical-row" type="button" data-patient-id="${safe(encounter.patientId)}">
      <div class="room-box">${safe(room)}</div>
      <div><strong>${safe(patientName)}</strong><span>${safe(encounter.chiefComplaint || "No chief complaint entered")}</span></div>
      ${compact ? "" : `<div class="clinical-time"><span>Arrival</span><strong>${safe(formatDateTime(encounter.arrivalAt))}</strong></div>`}
      <span class="status-pill status-${safe(encounter.status)}">${safe(formatStatus(encounter.status))}</span>
    </button>`;
}

function encounterCard(encounter) {
  const patient = patients.find((item) => item.id === encounter.patientId);
  const patientName = encounter.patientName || (patient ? `${patient.lastName}, ${patient.firstName}` : "Patient");
  const canTriage = canTriagePatients();
  const canDischarge = canDischargePatients();
  const triageText = encounter.status === "waiting" ? "Begin Triage" : "Update Triage";
  return `
    <article class="encounter-card ${encounter.initialPriority === "critical" || Number(encounter.triage?.acuity) <= 2 ? "critical-encounter" : ""}">
      <div class="encounter-card-top">
        <div><p class="eyebrow">${safe(encounter.department || "Emergency Department")}</p><h4>${safe(patientName)}</h4><span>${safe(encounter.mrn || "")}</span></div>
        <span class="status-pill status-${safe(encounter.status)}">${safe(formatStatus(encounter.status))}</span>
      </div>
      <div class="encounter-detail-grid">
        <div><span>Chief Complaint</span><strong>${safe(encounter.chiefComplaint || "—")}</strong></div>
        <div><span>Location</span><strong>${safe(encounter.room || encounter.triage?.room || "Waiting Room")}</strong></div>
        <div><span>Arrival</span><strong>${safe(formatDateTime(encounter.arrivalAt))}</strong></div>
        <div><span>Acuity</span><strong>${encounter.triage?.acuity ? `ESI ${safe(encounter.triage.acuity)}` : "Not assigned"}</strong></div>
      </div>
      <div class="encounter-actions">
        <button class="secondary-button compact" type="button" data-patient-id="${safe(encounter.patientId)}">Open Chart</button>
        ${canTriage ? `<button class="secondary-button compact" type="button" data-triage-id="${safe(encounter.id)}">${triageText}</button>` : ""}
        ${canDischarge ? `<button class="text-danger" type="button" data-discharge-id="${safe(encounter.id)}">Discharge</button>` : ""}
      </div>
    </article>`;
}

async function registerPatient(event) {
  event.preventDefault();
  if (!canRegisterPatients()) return;

  const submit = els.patientRegistrationForm.querySelector("button[type='submit']");
  submit.disabled = true;
  submit.textContent = "Creating Record…";

  const firstName = normalizeName(document.querySelector("#patientFirstName").value);
  const lastName = normalizeName(document.querySelector("#patientLastName").value);
  const dob = document.querySelector("#patientDob").value;
  const sex = document.querySelector("#patientSex").value;

  try {
    const patientRef = doc(collection(db, "patients"));
    const auditRef = doc(collection(db, "auditEvents"));
    const mrn = generateMrn();
    const batch = writeBatch(db);

    batch.set(patientRef, {
      mrn,
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`,
      dob,
      sex,
      phone: document.querySelector("#patientPhone").value.trim(),
      emergencyContact: document.querySelector("#patientEmergencyContact").value.trim(),
      allergies: document.querySelector("#patientAllergies").value.trim() || "NKDA",
      medications: document.querySelector("#patientMedications").value.trim() || "None",
      medicalHistory: document.querySelector("#patientHistory").value.trim() || "None documented",
      currentStatus: "not-checked-in",
      activeEncounterId: null,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser.uid,
      updatedAt: serverTimestamp()
    });

    batch.set(auditRef, {
      type: "patient-created",
      actorUid: auth.currentUser.uid,
      actorName: currentStaff.displayName,
      patientId: patientRef.id,
      mrn,
      at: serverTimestamp()
    });

    await batch.commit();
    els.patientRegistrationForm.reset();
    els.patientRegistrationDialog.close();
    showToast(`Patient record ${mrn} created.`);
    setTimeout(() => openPatientChart(patientRef.id), 150);
  } catch (error) {
    showToast(friendlyError(error));
  } finally {
    submit.disabled = false;
    submit.textContent = "Create Patient Record";
  }
}

function openPatientChart(patientId) {
  const patient = patients.find((item) => item.id === patientId);
  if (!patient) {
    showToast("Patient record is not available.");
    return;
  }
  selectedPatientId = patientId;
  renderPatientChart(patientId);
  els.patientChartDialog.showModal();
}

function renderPatientChart(patientId) {
  const patient = patients.find((item) => item.id === patientId);
  if (!patient) return;

  const active = activeEncounterForPatient(patientId);
  const history = encounters
    .filter((encounter) => encounter.patientId === patientId && !encounterIsActive(encounter))
    .sort((a, b) => encounterSortValue(b) - encounterSortValue(a));

  els.chartPatientName.textContent = `${patient.lastName}, ${patient.firstName}`;

  const actionButtons = active
    ? `
      ${canTriagePatients() ? `<button class="secondary-button" type="button" data-triage-id="${safe(active.id)}">${active.status === "waiting" ? "Begin Triage" : "Update Triage"}</button>` : ""}
      ${canDischargePatients() ? `<button class="danger-button" type="button" data-discharge-id="${safe(active.id)}">Discharge</button>` : ""}`
    : canRegisterPatients()
      ? `<button class="primary-button" type="button" data-checkin-id="${safe(patient.id)}">Check In Patient</button>`
      : "";

  els.patientChartBody.innerHTML = `
    <div class="chart-banner">
      <div><strong>${safe(patient.firstName)} ${safe(patient.lastName)}</strong><span>${safe(patient.mrn)} · DOB ${safe(formatDateOnly(patient.dob))} · ${safe(calculateAge(patient.dob))} yrs · ${safe(patient.sex || "Unknown")}</span></div>
      <div class="chart-actions">${actionButtons}</div>
    </div>

    <div class="chart-grid">
      <section class="chart-section">
        <div class="chart-section-title"><p class="eyebrow">Patient Information</p><h4>Demographics & History</h4></div>
        <dl class="detail-list">
          <div><dt>Allergies</dt><dd class="allergy-value">${safe(patient.allergies || "NKDA")}</dd></div>
          <div><dt>Medications</dt><dd>${safe(patient.medications || "None")}</dd></div>
          <div><dt>Medical History</dt><dd>${safe(patient.medicalHistory || "None documented")}</dd></div>
          <div><dt>Phone</dt><dd>${safe(patient.phone || "Not provided")}</dd></div>
          <div><dt>Emergency Contact</dt><dd>${safe(patient.emergencyContact || "Not provided")}</dd></div>
          <div><dt>Last Check-In</dt><dd>${safe(formatDateTime(patient.lastCheckInAt))}</dd></div>
        </dl>
      </section>

      <section class="chart-section">
        <div class="chart-section-title"><p class="eyebrow">Current Encounter</p><h4>${active ? safe(formatStatus(active.status)) : "Not Checked In"}</h4></div>
        ${active ? currentEncounterChart(active) : '<div class="chart-empty"><p>No active encounter for this patient.</p></div>'}
      </section>
    </div>

    <section class="chart-section history-section">
      <div class="chart-section-title"><p class="eyebrow">Encounter History</p><h4>Previous Visits</h4></div>
      ${history.length ? `<div class="history-list">${history.map(historyRow).join("")}</div>` : '<div class="chart-empty"><p>No previous encounters recorded.</p></div>'}
    </section>`;
}

function currentEncounterChart(encounter) {
  const t = encounter.triage || {};
  return `
    <dl class="detail-list">
      <div><dt>Chief Complaint</dt><dd>${safe(encounter.chiefComplaint || "—")}</dd></div>
      <div><dt>Arrival</dt><dd>${safe(formatDateTime(encounter.arrivalAt))}</dd></div>
      <div><dt>Arrival Method</dt><dd>${safe(encounter.arrivalMethod || "—")}</dd></div>
      <div><dt>Location</dt><dd>${safe(encounter.room || t.room || "Waiting Room")}</dd></div>
      <div><dt>Acuity</dt><dd>${t.acuity ? `ESI ${safe(t.acuity)}` : "Not assigned"}</dd></div>
    </dl>
    ${encounter.triage ? `
      <div class="vitals-strip">
        <div><span>HR</span><strong>${safe(t.heartRate || "—")}</strong></div>
        <div><span>BP</span><strong>${safe(t.bloodPressure || "—")}</strong></div>
        <div><span>RR</span><strong>${safe(t.respirations || "—")}</strong></div>
        <div><span>SpO₂</span><strong>${t.spo2 ? `${safe(t.spo2)}%` : "—"}</strong></div>
        <div><span>Temp</span><strong>${t.temperature ? `${safe(t.temperature)}°F` : "—"}</strong></div>
        <div><span>Pain</span><strong>${t.pain !== "" && t.pain != null ? `${safe(t.pain)}/10` : "—"}</strong></div>
      </div>
      ${t.note ? `<div class="clinical-note"><span>Triage Note</span><p>${safe(t.note)}</p></div>` : ""}` : ""}`;
}

function historyRow(encounter) {
  return `
    <div class="history-row">
      <div><strong>${safe(formatDateTime(encounter.arrivalAt))}</strong><span>${safe(encounter.department || "Emergency Department")}</span></div>
      <div><span>Chief Complaint</span><strong>${safe(encounter.chiefComplaint || "—")}</strong></div>
      <div><span>Disposition</span><strong>${safe(String(encounter.disposition || "Discharged").replaceAll("-", " "))}</strong></div>
      <div><span>Diagnosis</span><strong>${safe(encounter.finalDiagnosis || "—")}</strong></div>
    </div>`;
}

function openCheckIn(patientId) {
  if (!canRegisterPatients()) return;
  const patient = patients.find((item) => item.id === patientId);
  if (!patient) return;
  if (activeEncounterForPatient(patientId)) {
    showToast("This patient already has an active encounter.");
    return;
  }
  selectedPatientId = patientId;
  els.checkInPatientLabel.innerHTML = `<strong>${safe(patient.lastName)}, ${safe(patient.firstName)}</strong><span>${safe(patient.mrn)} · DOB ${safe(formatDateOnly(patient.dob))}</span>`;
  els.checkInForm.reset();
  els.checkInDialog.showModal();
}

async function checkInPatient(event) {
  event.preventDefault();
  if (!selectedPatientId || !canRegisterPatients()) return;
  const patient = patients.find((item) => item.id === selectedPatientId);
  if (!patient) return;

  const submit = els.checkInForm.querySelector("button[type='submit']");
  submit.disabled = true;
  submit.textContent = "Checking In…";

  try {
    if (activeEncounterForPatient(patient.id)) throw new Error("active-encounter");

    const encounterRef = doc(collection(db, "encounters"));
    const auditRef = doc(collection(db, "auditEvents"));
    const batch = writeBatch(db);
    const complaint = document.querySelector("#chiefComplaint").value.trim();
    const arrivalMethod = document.querySelector("#arrivalMethod").value;
    const initialPriority = document.querySelector("#initialPriority").value;

    batch.set(encounterRef, {
      patientId: patient.id,
      mrn: patient.mrn,
      patientName: `${patient.lastName}, ${patient.firstName}`,
      department: "Emergency Department",
      chiefComplaint: complaint,
      arrivalMethod,
      initialPriority,
      status: "waiting",
      room: null,
      arrivalAt: serverTimestamp(),
      checkedInBy: auth.currentUser.uid,
      checkedInByName: currentStaff.displayName,
      updatedAt: serverTimestamp()
    });

    batch.update(doc(db, "patients", patient.id), {
      activeEncounterId: encounterRef.id,
      currentStatus: "checked-in",
      currentEncounterStatus: "waiting",
      lastCheckInAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    batch.set(auditRef, {
      type: "patient-checked-in",
      actorUid: auth.currentUser.uid,
      actorName: currentStaff.displayName,
      patientId: patient.id,
      encounterId: encounterRef.id,
      at: serverTimestamp()
    });

    await batch.commit();
    els.checkInDialog.close();
    if (els.patientChartDialog.open) els.patientChartDialog.close();
    showToast(`${patient.firstName} ${patient.lastName} checked in.`);
    openSection("waiting");
  } catch (error) {
    showToast(error.message === "active-encounter" ? "This patient already has an active encounter." : friendlyError(error));
  } finally {
    submit.disabled = false;
    submit.textContent = "Complete Check-In";
  }
}

function openTriage(encounterId) {
  if (!canTriagePatients()) return;
  const encounter = encounters.find((item) => item.id === encounterId);
  if (!encounter || !encounterIsActive(encounter)) return;
  selectedEncounterId = encounterId;
  els.triageForm.reset();
  els.triagePatientName.textContent = encounter.patientName || "Triage Patient";

  const t = encounter.triage || {};
  document.querySelector("#triageAcuity").value = String(t.acuity || 3);
  document.querySelector("#triageRoom").value = encounter.room || t.room || "";
  document.querySelector("#triageHr").value = t.heartRate || "";
  document.querySelector("#triageBp").value = t.bloodPressure || "";
  document.querySelector("#triageRr").value = t.respirations || "";
  document.querySelector("#triageSpo2").value = t.spo2 || "";
  document.querySelector("#triageTemp").value = t.temperature || "";
  document.querySelector("#triagePain").value = t.pain ?? "";
  document.querySelector("#triageNote").value = t.note || "";
  els.triageDialog.showModal();
}

async function saveTriage(event) {
  event.preventDefault();
  if (!selectedEncounterId || !canTriagePatients()) return;
  const encounter = encounters.find((item) => item.id === selectedEncounterId);
  if (!encounter) return;

  const submit = els.triageForm.querySelector("button[type='submit']");
  submit.disabled = true;
  submit.textContent = "Saving…";

  try {
    const room = document.querySelector("#triageRoom").value.trim().toUpperCase();
    const acuity = Number(document.querySelector("#triageAcuity").value);
    const status = room ? "roomed" : "triage";
    const triage = {
      acuity,
      room,
      heartRate: document.querySelector("#triageHr").value.trim(),
      bloodPressure: document.querySelector("#triageBp").value.trim(),
      respirations: document.querySelector("#triageRr").value.trim(),
      spo2: document.querySelector("#triageSpo2").value.trim(),
      temperature: document.querySelector("#triageTemp").value.trim(),
      pain: document.querySelector("#triagePain").value.trim(),
      note: document.querySelector("#triageNote").value.trim(),
      completedBy: auth.currentUser.uid,
      completedByName: currentStaff.displayName,
      completedAt: serverTimestamp()
    };

    const batch = writeBatch(db);
    batch.update(doc(db, "encounters", encounter.id), {
      triage,
      room: room || null,
      status,
      updatedAt: serverTimestamp()
    });
    batch.update(doc(db, "patients", encounter.patientId), {
      currentEncounterStatus: status,
      updatedAt: serverTimestamp()
    });
    batch.set(doc(collection(db, "auditEvents")), {
      type: "triage-completed",
      actorUid: auth.currentUser.uid,
      actorName: currentStaff.displayName,
      patientId: encounter.patientId,
      encounterId: encounter.id,
      at: serverTimestamp()
    });

    await batch.commit();
    els.triageDialog.close();
    showToast(room ? `Patient assigned to ${room}.` : "Triage saved.");
  } catch (error) {
    showToast(friendlyError(error));
  } finally {
    submit.disabled = false;
    submit.textContent = "Save Triage";
  }
}

function openDischarge(encounterId) {
  if (!canDischargePatients()) return;
  const encounter = encounters.find((item) => item.id === encounterId);
  if (!encounter || !encounterIsActive(encounter)) return;
  selectedEncounterId = encounterId;
  els.dischargeForm.reset();
  els.dischargePatientName.textContent = `Discharge ${encounter.patientName || "Patient"}`;
  els.dischargeDialog.showModal();
}

async function dischargePatient(event) {
  event.preventDefault();
  if (!selectedEncounterId || !canDischargePatients()) return;
  const encounter = encounters.find((item) => item.id === selectedEncounterId);
  if (!encounter) return;

  const submit = els.dischargeForm.querySelector("button[type='submit']");
  submit.disabled = true;
  submit.textContent = "Closing Encounter…";

  try {
    const disposition = document.querySelector("#disposition").value;
    const finalDiagnosis = document.querySelector("#dischargeDiagnosis").value.trim();
    const dischargeInstructions = document.querySelector("#dischargeInstructions").value.trim();
    const patientStatus = ["admitted", "observation"].includes(disposition) ? disposition : "not-checked-in";

    const batch = writeBatch(db);
    batch.update(doc(db, "encounters", encounter.id), {
      status: "discharged",
      disposition,
      finalDiagnosis,
      dischargeInstructions,
      dischargedAt: serverTimestamp(),
      dischargedBy: auth.currentUser.uid,
      dischargedByName: currentStaff.displayName,
      updatedAt: serverTimestamp()
    });
    batch.update(doc(db, "patients", encounter.patientId), {
      activeEncounterId: null,
      currentStatus: patientStatus,
      currentEncounterStatus: null,
      lastVisitAt: serverTimestamp(),
      lastDisposition: disposition,
      lastDiagnosis: finalDiagnosis,
      updatedAt: serverTimestamp()
    });
    batch.set(doc(collection(db, "auditEvents")), {
      type: "encounter-closed",
      actorUid: auth.currentUser.uid,
      actorName: currentStaff.displayName,
      patientId: encounter.patientId,
      encounterId: encounter.id,
      disposition,
      at: serverTimestamp()
    });

    await batch.commit();
    els.dischargeDialog.close();
    if (els.patientChartDialog.open) els.patientChartDialog.close();
    showToast("Encounter closed.");
  } catch (error) {
    showToast(friendlyError(error));
  } finally {
    submit.disabled = false;
    submit.textContent = "Close Encounter";
  }
}

function updateClock() {
  els.clock.textContent = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date());
}

els.signInTab.addEventListener("click", () => switchAuth("signin"));
els.registerTab.addEventListener("click", () => switchAuth("register"));
els.signInForm.addEventListener("submit", signInStaff);
els.registerForm.addEventListener("submit", registerStaff);
els.signOutButton.addEventListener("click", () => signOut(auth));
els.pendingSignOut.addEventListener("click", () => signOut(auth));
els.menuButton.addEventListener("click", () => els.sidebar.classList.toggle("open"));
els.quickPatientSearch.addEventListener("click", () => openSection("patients"));
els.patientSearchInput.addEventListener("input", renderPatientSearch);
els.patientRegistrationForm.addEventListener("submit", registerPatient);
els.checkInForm.addEventListener("submit", checkInPatient);
els.triageForm.addEventListener("submit", saveTriage);
els.dischargeForm.addEventListener("submit", dischargePatient);
document.querySelector("#newPatientButton").addEventListener("click", () => {
  if (canRegisterPatients()) {
    els.patientRegistrationForm.reset();
    els.patientRegistrationDialog.showModal();
  }
});

document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => openSection(item.dataset.section)));
document.querySelectorAll("[data-open]").forEach((item) => item.addEventListener("click", () => openSection(item.dataset.open)));
document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => document.querySelector(`#${button.dataset.closeDialog}`)?.close()));

document.addEventListener("click", (event) => {
  const patientButton = event.target.closest("[data-patient-id]");
  if (patientButton) {
    openPatientChart(patientButton.dataset.patientId);
    return;
  }

  const checkInButton = event.target.closest("[data-checkin-id]");
  if (checkInButton) {
    if (els.patientChartDialog.open) els.patientChartDialog.close();
    openCheckIn(checkInButton.dataset.checkinId);
    return;
  }

  const triageButton = event.target.closest("[data-triage-id]");
  if (triageButton) {
    if (els.patientChartDialog.open) els.patientChartDialog.close();
    openTriage(triageButton.dataset.triageId);
    return;
  }

  const dischargeButton = event.target.closest("[data-discharge-id]");
  if (dischargeButton) {
    if (els.patientChartDialog.open) els.patientChartDialog.close();
    openDischarge(dischargeButton.dataset.dischargeId);
  }
});

[els.patientRegistrationDialog, els.patientChartDialog, els.checkInDialog, els.triageDialog, els.dischargeDialog].forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});

onAuthStateChanged(auth, async (user) => {
  setAuthMessage();

  if (!user) {
    currentStaff = null;
    stopClinicalListeners();
    showView(els.authView);
    switchAuth("signin");
    return;
  }

  try {
    const profile = await loadStaffProfile(user);
    if (!profile) {
      await signOut(auth);
      setAuthMessage("This account does not have a Northstar staff profile.", "error");
      return;
    }

    currentStaff = profile;
    if (profile.status !== "active") {
      stopClinicalListeners();
      showView(els.pendingView);
      return;
    }

    renderStaffIdentity(profile);
    showView(els.mainView);
    openSection("dashboard");
    startClinicalListeners();
  } catch (error) {
    await signOut(auth);
    setAuthMessage(friendlyError(error), "error");
  }
});

updateClock();
setInterval(updateClock, 30_000);
