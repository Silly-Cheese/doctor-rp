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
  runTransaction,
  updateDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

import {billingFieldsMarkup,bindBillingPreview,buildBillingRecord,prepareEncounterBilling} from "./northstar-billing.js";
import {renderRecordWorkspace} from "./northstar-medical-records.js";
import {renderPatientRecordQuality} from "./northstar-record-quality.js";
import {renderAttachmentVault} from "./northstar-attachments.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";

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
let accountProvisioning = false;

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
  accountProvisioning = true;

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

    accountProvisioning = false;
    await routeAuthenticatedUser(credential.user);
  } catch (error) {
    setAuthMessage(friendlyError(error), "error");
  } finally {
    accountProvisioning = false;
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

function accountNameParts(user) {
  const displayName = normalizeName(user.displayName || "");
  if (displayName) {
    const parts = displayName.split(" ");
    return { firstName: parts.shift() || "Staff", lastName: parts.join(" ") || "Member", displayName };
  }
  const localPart = normalizeName((user.email || "staff").split("@")[0].replace(/[._-]+/g, " "));
  const parts = localPart.split(" ").filter(Boolean);
  const firstName = parts.shift() || "Staff";
  const lastName = parts.join(" ") || "Member";
  return { firstName, lastName, displayName: `${firstName} ${lastName}`.trim() };
}

async function ensureStaffProfile(user) {
  const existing = await loadStaffProfile(user);
  if (existing) return existing;

  const setupRef = doc(db, "system", "setup");
  const staffRef = doc(db, "users", user.uid);
  const setupSnapshot = await getDoc(setupRef);
  const names = accountNameParts(user);
  const email = (user.email || "").toLowerCase();

  if (!setupSnapshot.exists()) {
    const batch = writeBatch(db);
    batch.set(setupRef, {
      initialized: true,
      initializedBy: user.uid,
      initializedAt: serverTimestamp(),
      facilityName: "Northstar Medical Center"
    });
    batch.set(staffRef, {
      uid: user.uid,
      firstName: names.firstName,
      lastName: names.lastName,
      displayName: names.displayName,
      email,
      requestedRole: "physician",
      role: "administrator",
      status: "active",
      createdAt: serverTimestamp(),
      approvedAt: serverTimestamp(),
      approvedBy: user.uid
    });
    await batch.commit();
    return loadStaffProfile(user);
  }

  if (setupSnapshot.data()?.initializedBy === user.uid) {
    await setDoc(staffRef, {
      uid: user.uid,
      firstName: names.firstName,
      lastName: names.lastName,
      displayName: names.displayName,
      email,
      requestedRole: "physician",
      role: "administrator",
      status: "active",
      createdAt: serverTimestamp(),
      approvedAt: serverTimestamp(),
      approvedBy: user.uid
    });
    return loadStaffProfile(user);
  }

  await setDoc(staffRef, {
    uid: user.uid,
    firstName: names.firstName,
    lastName: names.lastName,
    displayName: names.displayName,
    email,
    requestedRole: "staff",
    role: "staff",
    status: "pending",
    createdAt: serverTimestamp()
  });
  return loadStaffProfile(user);
}

async function routeAuthenticatedUser(user) {
  setAuthMessage();
  if (!user) {
    currentStaff = null;
    stopClinicalListeners();
    showView(els.authView);
    switchAuth("signin");
    return;
  }

  try {
    const profile = await ensureStaffProfile(user);
    if (!profile) throw new Error("missing-profile");
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
    currentStaff = null;
    stopClinicalListeners();
    showView(els.authView);
    setAuthMessage(friendlyError(error), "error");
  }
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
            <option value="pharmacist" ${staff.requestedRole === "pharmacist" ? "selected" : ""}>Pharmacist</option>
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
  // Keep unfinished chart documents and file selections intact during realtime updates.
  const editingDocument=els.patientChartBody?.querySelector(".nmc-record-editor:not(.hidden)");
  if(selectedPatientId && els.patientChartDialog.open && !editingDocument)renderPatientChart(selectedPatientId);
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
  document.querySelector("#nmcIntegrityToggle").hidden = currentStaff?.role !== "administrator";
  const term = (els.patientSearchInput?.value || "").trim().toLowerCase();
  const filter = document.querySelector("#patientStatusFilter")?.value || "all";
  const sort = document.querySelector("#patientSortBy")?.value || "recent";
  const activeCount = patients.filter(patient => Boolean(activeEncounterForPatient(patient.id))).length;
  const waitingCount = patients.filter(patient => ["waiting", "triage"].includes(activeEncounterForPatient(patient.id)?.status)).length;
  const summary = document.querySelector("#patientRegistrySummary");
  if (summary) summary.innerHTML = [
    ["Total patient records", patients.length],
    ["Active encounters", activeCount],
    ["Waiting / triage", waitingCount]
  ].map(([label, value]) => `<div class="nmc-registry-stat"><strong>${value}</strong><span>${label}</span></div>`).join("");

  const matching = patients.filter(patient => {
    const encounter = activeEncounterForPatient(patient.id);
    const name = `${patient.firstName || ""} ${patient.lastName || ""} ${patient.lastName || ""}, ${patient.firstName || ""}`;
    const haystack = `${name} ${patient.mrn || ""} ${patient.phone || ""} ${patient.dob || ""}`.toLowerCase();
    if (term && !haystack.includes(term)) return false;
    if (filter === "active") return Boolean(encounter);
    if (filter === "waiting") return ["waiting", "triage"].includes(encounter?.status);
    if (filter === "admitted") return encounter?.status === "admitted" || patient.currentStatus === "admitted";
    if (filter === "inactive") return !encounter;
    if (filter === "identity") return /^(john|jane)\s+doe$/i.test(name.trim()) || /unidentified|unknown/i.test(name);
    return true;
  }).sort((a,b) => sort === "name"
    ? `${a.lastName || ""} ${a.firstName || ""}`.localeCompare(`${b.lastName || ""} ${b.firstName || ""}`)
    : sort === "mrn" ? String(a.mrn || "").localeCompare(String(b.mrn || ""))
    : (b.lastCheckInAt?.seconds || b.createdAt?.seconds || 0) - (a.lastCheckInAt?.seconds || a.createdAt?.seconds || 0));
  const count = document.querySelector("#patientRegistryCount");
  if (count) count.textContent = `Showing ${Math.min(matching.length, 75)} of ${matching.length} matching patients${matching.length > 75 ? " · Narrow your search to see more" : ""}`;
  if (!patients.length) {
    els.patientResults.innerHTML = emptyPanel("No patient records", canRegisterPatients() ? "Register the first Northstar patient to begin." : "No patient records are available.");
  } else if (!matching.length) {
    els.patientResults.innerHTML = emptyPanel("No matching patients", "Try a different search or status filter.");
  } else {
    els.patientResults.innerHTML = `<div class="panel table-panel nmc-registry-panel"><div class="patient-table">${matching.slice(0,75).map(patientRow).join("")}</div></div>`;
  }
}

function patientRow(patient) {
  const encounter = activeEncounterForPatient(patient.id);
  const status = patient.vitalStatus === "deceased" || patient.currentStatus === "deceased" ? "Deceased" : encounter ? formatStatus(encounter.status) : patient.currentStatus === "admitted" ? "Admitted" : "Not Checked In";
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

  // Prevent accidental duplicate master records using currently loaded records.
  // Server-side uniqueness must still be implemented for fully concurrent registrations.
  const duplicates = patients.filter(patient =>
    (patient.firstName || "").trim().toLowerCase() === firstName.toLowerCase() &&
    (patient.lastName || "").trim().toLowerCase() === lastName.toLowerCase() &&
    patient.dob === dob
  );
  if (duplicates.length) {
    submit.disabled = false;
    submit.textContent = "Create Patient Record";
    const existing = duplicates[0];
    const proceed = window.confirm(`A patient with this name and date of birth already exists (MRN: ${existing.mrn || "unavailable"}).\n\nSelect Cancel to review their existing chart, or OK to create a separate record if you have verified this is a different person.`);
    if (!proceed) {
      els.patientRegistrationDialog.close();
      openPatientChart(existing.id);
      return;
    }
    submit.disabled = true;
    submit.textContent = "Creating Record…";
  }

  try {
    const patientRef = doc(collection(db, "patients"));
    const auditRef = doc(collection(db, "auditEvents"));
    const mrn = generateMrn();
    // Reservation documents prevent two simultaneous standard registrations
    // from silently receiving the same newly generated medical record number.
    const mrnReservationRef = doc(db, "patientMrns", mrn);
    const batch = writeBatch(db);
    batch.set(mrnReservationRef,{mrn,patientId:patientRef.id,createdAt:serverTimestamp()});

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
      vitalStatus: "active",
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

  const patientEncounters = encounters.filter(encounter => encounter.patientId === patientId);
  const completedCount = patientEncounters.filter(encounter => !encounterIsActive(encounter)).length;
  els.patientChartBody.innerHTML = `
    <div class="nmc-chart-overview" aria-label="Patient record overview">
      <div><span>Medical record</span><strong>${safe(patient.mrn || "Pending")}</strong></div>
      <div><span>Encounters</span><strong>${patientEncounters.length}</strong></div>
      <div><span>Completed visits</span><strong>${completedCount}</strong></div>
      <div><span>Current status</span><strong>${active ? safe(formatStatus(active.status)) : "No active encounter"}</strong></div>
    </div>
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
    </section>
    <section class="chart-section history-section" id="nmcPatientQuality"></section>
    <section class="chart-section history-section" id="nmcRecordWorkspace"></section>
    <section class="chart-section history-section" id="nmcAttachmentVault"></section>`;
  renderRecordWorkspace({db,patientId,encounters,canEdit:canRegisterPatients() && (currentStaff?.role === "administrator" || currentStaff?.permissions?.editPatients !== false),onNotice:showToast});
  renderPatientRecordQuality({db,patient,patients,encounters,canFlag:canRegisterPatients(),canResolve:currentStaff?.role === "administrator",onNotice:showToast});
  renderAttachmentVault({db,patient,encounters,canEdit:canRegisterPatients() && (currentStaff?.role === "administrator" || currentStaff?.permissions?.editPatients !== false),onNotice:showToast});
}

function currentEncounterChart(encounter) {
  const t = encounter.triage || {};
  return `
    <dl class="detail-list">
      <div><dt>Chief Complaint</dt><dd>${safe(encounter.chiefComplaint || "—")}</dd></div>
      <div><dt>Arrival</dt><dd>${safe(formatDateTime(encounter.arrivalAt))}</dd></div>
      <div><dt>Arrival Method</dt><dd>${safe(encounter.arrivalMethod || "—")}</dd></div>
      <div><dt>Visit Category</dt><dd>${safe(encounter.visitCategory || "Emergency")}</dd></div>
      <div><dt>Reception Notes</dt><dd>${safe(encounter.receptionNotes || "None recorded")}</dd></div>
      <div><dt>Contact Reviewed</dt><dd>${encounter.registrationChecklist?.contactReviewed ? "Yes" : "Not documented"}</dd></div>
      <div><dt>Language Assistance</dt><dd>${encounter.registrationChecklist?.interpreterRequested ? "Requested" : "Not requested"}</dd></div>
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

// Reception lookup operates inside the existing Patients page.
const normalizeIdentity = value => String(value || "").trim().toLocaleLowerCase().replace(/\s+/g," ");
let lastReceptionLookup = null;
let currentCheckInNameSearch = false;
function updateReceptionMode() {
  const byName=document.querySelector("#nmcReceptionSearchMode").value==="name";
  document.querySelector("#nmcReceptionNameWrap").classList.toggle("hidden",!byName);
  document.querySelector("#nmcReceptionDobWrap").classList.toggle("hidden",byName);
  document.querySelector("#nmcReceptionResults").innerHTML='<p class="muted">Search by the selected method to find an existing patient.</p>';
  lastReceptionLookup=null;
}
function performReceptionSearch(event) {
  event?.preventDefault();
  const mode=document.querySelector("#nmcReceptionSearchMode").value;
  const value=mode==="dob"?document.querySelector("#nmcReceptionDob").value:normalizeIdentity(document.querySelector("#nmcReceptionName").value);
  const target=document.querySelector("#nmcReceptionResults");
  if(mode==="dob"&&!/^\d{4}-\d{2}-\d{2}$/.test(value)){
    target.innerHTML='<p class="muted">Enter a complete date of birth before searching.</p>';return;
  }
  if(mode==="name"&&value.length<2){
    target.innerHTML='<p class="muted">Enter at least two letters of the patient name.</p>';return;
  }
  lastReceptionLookup={method:mode,value};
  const matches=patients.filter(p=>mode==="dob"
    ?p.dob===value
    :normalizeIdentity(`${p.firstName||""} ${p.lastName||""}`).includes(value)||normalizeIdentity(`${p.lastName||""}, ${p.firstName||""}`).includes(value)).slice(0,30);
  target.innerHTML=matches.length?
    `<p class="muted">${matches.length} possible match${matches.length===1?"":"es"}. Select and confirm the correct patient.</p><div class="nmc-reception-matches">${matches.map(p=>`<button type="button" class="nmc-reception-match" data-nmc-reception-patient="${safe(p.id)}"><span><strong>${safe(p.firstName)} ${safe(p.lastName)}</strong><small>MRN: ${safe(p.mrn||"Unassigned")} · DOB: ${safe(p.dob?formatDateOnly(p.dob):"Unknown")} · ${safe(p.identityStatus==="unidentified"?"Unidentified":"Registered")}</small></span><span>Continue →</span></button>`).join("")}</div>`:
    '<p class="muted">No matching record found. Verify the details before registering a new patient.</p>';
}
function updateCheckInVerificationMode(){
  const mode=document.querySelector("#nmcIdentityMethod").value;
  for(const [kind,id] of [["dob","nmcVerifyDobWrap"],["name","nmcVerifyNameWrap"],["temporary","nmcVerifyTempWrap"]])
    document.getElementById(id).classList.toggle("hidden",mode!==kind);
  document.querySelector("#nmcIdentityMessage").textContent=mode==="temporary"
    ?"Emergency identifier only. This does not establish the patient’s legal identity."
    :"Confirm the supplied value against the selected patient record.";
}
function verifiedCheckInIdentity(patient){
  if(!document.querySelector("#nmcVerifyConfirmed").checked)throw new Error("Confirm the patient's identity before checking in.");
  const mode=document.querySelector("#nmcIdentityMethod").value;
  if(mode==="dob"){
    const dob=document.querySelector("#nmcVerifyDob").value;
    if(!dob||!patient.dob||dob!==patient.dob)throw new Error("Date of birth does not match the selected patient.");
    return "date-of-birth";
  }
  if(mode==="name"){
    if(!currentCheckInNameSearch)throw new Error("Search by patient name in Reception before using name verification.");
    const searched=normalizeIdentity(document.querySelector("#nmcVerifyName").value);
    const expected=normalizeIdentity(`${patient.firstName||""} ${patient.lastName||""}`);
    if(searched.length<3||searched!==expected)throw new Error("Search and confirm the patient's full registered name.");
    return "name-search";
  }
  if(mode==="temporary"&&patient.identityStatus==="unidentified"){
    if(normalizeIdentity(document.querySelector("#nmcVerifyTemp").value)!==normalizeIdentity(patient.mrn))
      throw new Error("Temporary medical record number does not match.");
    return "temporary-emergency-id";
  }
  throw new Error("Choose an accepted patient verification method.");
}

document.querySelector("#nmcIntegrityToggle").addEventListener("click",()=>{
  if(currentStaff?.role!=="administrator")return;
  document.querySelector("#nmcIntegrityPanel").classList.toggle("hidden");
});
document.querySelector("#nmcRunIntegrity").addEventListener("click",async()=>{
  if(currentStaff?.role!=="administrator")return;
  const btn=document.querySelector("#nmcRunIntegrity"),output=document.querySelector("#nmcIntegrityOutput");
  btn.disabled=true;btn.textContent="Scanning…";
  try{
    const result=await httpsCallable(getFunctions(app,"us-central1"),"northstarV3Integrity",{timeout:60000})({});
    const data=result.data||{},issues=Array.isArray(data.issues)?data.issues:[];
    const counts=Object.entries(data.checked||{}).map(([name,n])=>safe(name)+": "+safe(n)).join(" · ");
    const incomplete=(data.incomplete||[]).length?"<p class='nmc-quality-warning'>Partial scan: collection limits reached. Review results carefully.</p>":"";
    const list=issues.length?"<ol>"+issues.slice(0,35).map(item=>"<li><strong>"+safe(item.collection)+"</strong> · "+safe(item.id)+" — "+safe(item.reason)+"</li>").join("")+"</ol>":"<p class='nmc-quality-good'>No issues identified in the records checked.</p>";
    output.innerHTML="<p><strong>"+issues.length+" potential issue(s)</strong> · "+counts+"</p>"+incomplete+list+(issues.length>35?"<p>Additional findings omitted from this view.</p>":"");
  }catch(error){
    output.textContent="Scan unavailable. Deploy the Northstar Cloud Functions and check administrator access. "+(error?.message||"");
  }finally{btn.disabled=false;btn.textContent="Run scan";}
});

document.querySelector("#nmcReceptionToggle").addEventListener("click",()=>{
  const desk=document.querySelector("#nmcReceptionDesk");
  desk.classList.toggle("hidden");
  document.querySelector("#nmcReceptionToggle").setAttribute("aria-expanded",String(!desk.classList.contains("hidden")));
  if(!desk.classList.contains("hidden"))document.querySelector("#nmcReceptionSearchMode").focus();
});
document.querySelector("#nmcReceptionSearchMode").addEventListener("change",updateReceptionMode);
document.querySelector("#nmcReceptionSearchForm").addEventListener("submit",performReceptionSearch);
document.querySelector("#nmcEmergencyShortcut").addEventListener("click",()=>{
  const launch=document.querySelector("#nsEmergencyLaunch");
  if(launch&&!launch.hidden)launch.click();
  else showToast("Emergency intake is not available for this staff account.");
});
document.querySelector("#nmcReceptionResults").addEventListener("click",event=>{
  const btn=event.target.closest("[data-nmc-reception-patient]");
  if(!btn||!canRegisterPatients()||!lastReceptionLookup)return;
  openCheckIn(btn.dataset.nmcReceptionPatient,lastReceptionLookup);
});
document.querySelector("#nmcIdentityMethod").addEventListener("change",updateCheckInVerificationMode);

function openCheckIn(patientId,verification=null) {
  if (!canRegisterPatients()) return;
  const patient = patients.find((item) => item.id === patientId);
  if (!patient) return;
  if (patient.vitalStatus === "deceased" || patient.currentStatus === "deceased") {
    showToast("Check-in blocked: this patient is recorded as deceased.");
    return;
  }
  if (activeEncounterForPatient(patientId)) {
    showToast("This patient already has an active encounter.");
    return;
  }
  selectedPatientId = patientId;
  currentCheckInNameSearch = verification?.method === "name";
  els.checkInPatientLabel.innerHTML = `<strong>${safe(patient.lastName)}, ${safe(patient.firstName)}</strong><span>${safe(patient.mrn)} · DOB ${safe(formatDateOnly(patient.dob))}</span>`;
  els.checkInForm.reset();
  const method=verification?.method==="dob"?"dob":verification?.method==="name"?"name":patient.identityStatus==="unidentified"?"temporary":"dob";
  const select=document.querySelector("#nmcIdentityMethod");
  select.querySelector('[value="temporary"]').hidden=patient.identityStatus!=="unidentified";
  select.value=method;
  if(verification?.method==="dob")document.querySelector("#nmcVerifyDob").value=verification.value;
  if(verification?.method==="name")document.querySelector("#nmcVerifyName").value=`${patient.firstName||""} ${patient.lastName||""}`.trim();
  if(method==="temporary")document.querySelector("#nmcVerifyTemp").value=patient.mrn||"";
  updateCheckInVerificationMode();
  els.checkInDialog.showModal();
}

async function checkInPatient(event){
  event.preventDefault();
  if(!selectedPatientId||!canRegisterPatients())return;
  const patient=patients.find(item=>item.id===selectedPatientId);
  if(!patient)return;
  const submit=els.checkInForm.querySelector('button[type="submit"]');
  submit.disabled=true;submit.textContent="Checking In…";
  try{
    const verificationMethod=verifiedCheckInIdentity(patient);
    const complaint=document.querySelector("#chiefComplaint").value.trim();
    if(!complaint)throw new Error("Enter the reason for the patient's visit.");
    const arrivalMethod=document.querySelector("#arrivalMethod").value;
    const initialPriority=document.querySelector("#initialPriority").value;
    const visitCategory=document.querySelector("#nmcVisitCategory").value;
    const receptionNotes=document.querySelector("#nmcReceptionNote").value.trim().slice(0,500);
    const contactReviewed=document.querySelector("#nmcContactReviewed").checked;
    const interpreterRequested=document.querySelector("#nmcInterpreterRequested").checked;
    const patientRef=doc(db,"patients",patient.id);
    const encounterRef=doc(collection(db,"encounters"));
    const auditRef=doc(collection(db,"auditEvents"));
    await runTransaction(db,async transaction=>{
      const snapshot=await transaction.get(patientRef);
      if(!snapshot.exists())throw new Error("Patient record no longer exists.");
      const live=snapshot.data();
      if(live.vitalStatus==="deceased"||live.currentStatus==="deceased")
        throw new Error("This patient is recorded as deceased.");
      if(live.activeEncounterId||activeEncounterForPatient(patient.id))throw new Error("active-encounter");
      if(verificationMethod==="date-of-birth"&&live.dob!==document.querySelector("#nmcVerifyDob").value)
        throw new Error("Date of birth changed. Verify the patient again.");
      if(verificationMethod==="name-search"&&normalizeIdentity(`${live.firstName||""} ${live.lastName||""}`)!==normalizeIdentity(document.querySelector("#nmcVerifyName").value))
        throw new Error("Name changed. Search the patient again.");
      if(verificationMethod==="temporary-emergency-id"&&(live.identityStatus!=="unidentified"||normalizeIdentity(live.mrn)!==normalizeIdentity(document.querySelector("#nmcVerifyTemp").value)))
        throw new Error("Temporary identity must be verified again.");
      transaction.set(encounterRef,{
        patientId:patient.id,mrn:live.mrn,patientName:`${live.lastName||""}, ${live.firstName||""}`,
        department:"Emergency Department",chiefComplaint:complaint,arrivalMethod,initialPriority,
        visitCategory,receptionNotes,registrationChecklist:{contactReviewed,interpreterRequested},
        status:"waiting",room:null,arrivalAt:serverTimestamp(),
        checkedInBy:auth.currentUser.uid,checkedInByName:currentStaff.displayName,
        identityVerificationMethod:verificationMethod,identityVerifiedBy:auth.currentUser.uid,
        identityVerifiedAt:serverTimestamp(),updatedAt:serverTimestamp()
      });
      transaction.update(patientRef,{
        activeEncounterId:encounterRef.id,currentStatus:"checked-in",
        currentEncounterStatus:"waiting",lastCheckInAt:serverTimestamp(),updatedAt:serverTimestamp()
      });
      transaction.set(auditRef,{
        type:"patient-checked-in",actorUid:auth.currentUser.uid,
        actorName:currentStaff.displayName,patientId:patient.id,encounterId:encounterRef.id,
        verificationMethod,at:serverTimestamp()
      });
    });
    els.checkInDialog.close();
    if(els.patientChartDialog.open)els.patientChartDialog.close();
    showToast("Patient checked in with identity verification.");
    openSection("waiting");
  }catch(error){
    if(error.message==="active-encounter")showToast("This patient already has an active encounter.");
    else if(error?.code)showToast(friendlyError(error));
    else showToast(error.message||"Unable to complete check-in.");
  }finally{submit.disabled=false;submit.textContent="Complete Check-In";}
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

async function openDischarge(encounterId) {
  if (!canDischargePatients()) return;
  const encounter = encounters.find((item) => item.id === encounterId);
  if (!encounter || !encounterIsActive(encounter)) return;
  selectedEncounterId = encounterId;
  els.dischargeForm.reset();
  els.dischargeForm.dispatchEvent(new Event("change",{bubbles:true}));
  els.dischargePatientName.textContent = `Discharge ${encounter.patientName || "Patient"}`;
  els.dischargeDialog.showModal();
  const button=els.dischargeForm.querySelector('[type="submit"]');button.disabled=true;
  try { await prepareEncounterBilling(els.dischargeForm,encounter);button.disabled=false; }
  catch (err) { showToast("Could not load service charges: "+err.message); }

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

    const billing=buildBillingRecord(els.dischargeForm,encounter,auth.currentUser.uid);
    if((await getDoc(doc(db,"billingAccounts",encounter.id))).exists())throw Error("This encounter already has a billing record; review the invoice before attempting discharge.");
    const batch = writeBatch(db);
    batch.set(doc(db,"billingAccounts",encounter.id),billing);
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
["patientStatusFilter","patientSortBy"].forEach(id => document.querySelector(`#${id}`)?.addEventListener("change", renderPatientSearch));
els.patientRegistrationForm.addEventListener("submit", registerPatient);
els.checkInForm.addEventListener("submit", checkInPatient);
els.triageForm.addEventListener("submit", saveTriage);
els.dischargeForm.querySelector(".modal-body").insertAdjacentHTML("beforeend",billingFieldsMarkup());
bindBillingPreview(els.dischargeForm);
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
  if (accountProvisioning) return;
  await routeAuthenticatedUser(user);
});

updateClock();
setInterval(updateClock, 30_000);
