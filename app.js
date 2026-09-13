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
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBPtNWvmmYl-6hFb7NlmNszapMwQH4Xm7I",
  authDomain: "doctor-rp.firebaseapp.com",
  projectId: "doctor-rp",
  storageBucket: "doctor-rp.firebasestorage.app",
  messagingSenderId: "76025336566",
  appId: "1:76025336566:web:b8507e26ce66d44c6b52d7"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

const ROLE_LABELS = {
  administrator: "Administrator",
  physician: "Physician",
  nurse: "Registered Nurse",
  registration: "Registration",
  technician: "Clinical Technician",
  staff: "Clinical Staff"
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
  pendingStaffList: document.querySelector("#pendingStaffList")
};

let currentStaff = null;
let toastTimer = null;

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

function firebaseErrorMessage(error) {
  const code = error?.code || "";
  if (code.includes("email-already-in-use")) return "An account already exists with that email address.";
  if (code.includes("invalid-credential")) return "The email address or password is incorrect.";
  if (code.includes("weak-password")) return "Choose a stronger password with at least six characters.";
  if (code.includes("invalid-email")) return "Enter a valid email address.";
  if (code.includes("too-many-requests")) return "Too many attempts. Try again shortly.";
  if (code.includes("permission-denied")) return "Northstar could not complete that request with the current access level.";
  return error?.message?.replace(/^Firebase:\s*/i, "") || "Northstar could not complete that request.";
}

async function registerStaff(event) {
  event.preventDefault();
  setAuthMessage();

  const firstName = normalizeName(document.querySelector("#firstName").value);
  const lastName = normalizeName(document.querySelector("#lastName").value);
  const email = document.querySelector("#registerEmail").value.trim().toLowerCase();
  const password = document.querySelector("#registerPassword").value;
  const requestedRole = document.querySelector("#requestedRole").value;

  if (!firstName || !lastName) {
    setAuthMessage("Enter your first and last name.", "error");
    return;
  }

  const submit = els.registerForm.querySelector("button[type='submit']");
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
    setAuthMessage(firebaseErrorMessage(error), "error");
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
    setAuthMessage(firebaseErrorMessage(error), "error");
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

  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  els.greeting.textContent = `${timeGreeting}, ${profile.firstName || ""}`.trim();
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
  document.querySelectorAll(".content-section").forEach((node) => node.classList.add("hidden"));
  document.querySelector(`#${section}Section`)?.classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.section === section));
  els.pageTitle.textContent = sectionTitle(section);
  els.sidebar.classList.remove("open");
  if (section === "staff" && currentStaff?.role === "administrator") loadPendingStaff();
}

async function loadPendingStaff() {
  els.pendingStaffList.innerHTML = '<div class="panel"><div class="empty-state compact-empty"><p>Loading staff accounts…</p></div></div>';
  try {
    const pendingQuery = query(collection(db, "users"), where("status", "==", "pending"));
    const snapshot = await getDocs(pendingQuery);
    if (snapshot.empty) {
      els.pendingStaffList.innerHTML = '<div class="panel"><div class="empty-state compact-empty"><h4>No pending accounts</h4><p>New staff access requests will appear here.</p></div></div>';
      return;
    }

    els.pendingStaffList.innerHTML = "";
    snapshot.forEach((staffDoc) => {
      const staff = staffDoc.data();
      const card = document.createElement("article");
      card.className = "staff-card";
      card.innerHTML = `
        <div>
          <h4>${escapeHtml(staff.displayName || "Staff Member")}</h4>
          <div class="staff-meta">${escapeHtml(staff.email || "")} · Requested: ${escapeHtml(formatRole(staff.requestedRole))}</div>
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
      card.querySelector(".approve-staff").addEventListener("click", async () => {
        const selectedRole = card.querySelector("select").value;
        await approveStaff(staffDoc.id, selectedRole, card);
      });
      els.pendingStaffList.appendChild(card);
    });
  } catch (error) {
    els.pendingStaffList.innerHTML = `<div class="panel"><div class="empty-state compact-empty"><h4>Unable to load staff accounts</h4><p>${escapeHtml(firebaseErrorMessage(error))}</p></div></div>`;
  }
}

async function approveStaff(uid, role, card) {
  const button = card.querySelector(".approve-staff");
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
    showToast(firebaseErrorMessage(error));
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => openSection(item.dataset.section)));
document.querySelectorAll("[data-open]").forEach((item) => item.addEventListener("click", () => openSection(item.dataset.open)));
document.querySelector("#newPatientButton").addEventListener("click", () => showToast("Patient registration is not yet available."));

onAuthStateChanged(auth, async (user) => {
  setAuthMessage();
  if (!user) {
    currentStaff = null;
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
      showView(els.pendingView);
      return;
    }

    renderStaffIdentity(profile);
    showView(els.mainView);
    openSection("dashboard");
  } catch (error) {
    await signOut(auth);
    setAuthMessage(firebaseErrorMessage(error), "error");
  }
});

updateClock();
setInterval(updateClock, 30_000);
