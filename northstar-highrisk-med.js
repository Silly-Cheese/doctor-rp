import { getApp, initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const app = getApp(), auth = getAuth(app), db = getFirestore(app);
const state = { order: null, source: null, busy: false };
const HIGH_RISK = /\b(insulin|heparin|enoxaparin|warfarin|morphine|fentanyl|hydromorphone|epinephrine|norepinephrine|vasopressin|potassium|digoxin|alteplase|tenecteplase|thrombolytic|chemotherapy)\b/i;
const safe = v => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

function toast(message) {
  const node = document.querySelector("#toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 3200);
}

function ensureUi() {
  if (document.querySelector("#highRiskVerifyDialog")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <dialog id="highRiskVerifyDialog" class="modal">
      <form id="highRiskVerifyForm" class="modal-card">
        <div class="modal-header"><div><p class="eyebrow">Medication Safety</p><h3>Independent Double Check</h3></div><button type="button" class="icon-button" data-highrisk-close>×</button></div>
        <div class="modal-body form-grid">
          <div id="highRiskContext" class="patient-context"></div>
          <p class="form-banner"><strong>This medication requires an independent second verification.</strong> A different active physician, nurse, or Administrator must sign in below to verify the medication before administration.</p>
          <label><span>Verifier email</span><input id="highRiskEmail" type="email" autocomplete="username" required></label>
          <label><span>Verifier password</span><input id="highRiskPassword" type="password" autocomplete="current-password" required></label>
          <p id="highRiskError" class="form-message"></p>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-button" data-highrisk-close>Cancel</button><button type="submit" class="primary-button">Verify & Continue</button></div>
      </form>
    </dialog>`);
  document.querySelectorAll("[data-highrisk-close]").forEach(button => button.addEventListener("click", () => document.querySelector("#highRiskVerifyDialog")?.close()));
  document.querySelector("#highRiskVerifyForm")?.addEventListener("submit", verifySecondStaff);
}

async function orderForButton(button) {
  const id = button.dataset.marGive || button.dataset.administerMedication;
  if (!id) return null;
  const snap = await getDoc(doc(db, "orders", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

function patientTokenValid(order) {
  const token = window.NorthstarMedicationVerification;
  return token && token.orderId === order.id && token.patientId === order.patientId && Date.now() - Number(token.verifiedAt || 0) < 90000;
}

function passThrough(button) {
  button.dataset.highRiskVerified = "1";
  button.dataset.northstarIdentityVerified = "1";
  queueMicrotask(() => button.click());
}

async function begin(button) {
  if (state.busy) return;
  state.busy = true;
  try {
    const order = await orderForButton(button);
    if (!order) {
      toast("Medication order could not be loaded.");
      return;
    }
    if (!patientTokenValid(order)) {
      toast("Verify the patient's wristband or MRN before medication administration.");
      return;
    }
    if (!HIGH_RISK.test(order.name || "")) {
      passThrough(button);
      return;
    }

    state.order = order;
    state.source = button;
    ensureUi();
    document.querySelector("#highRiskVerifyForm")?.reset();
    document.querySelector("#highRiskError").textContent = "";
    document.querySelector("#highRiskContext").innerHTML = `<strong>${safe(order.name || "High-risk medication")}</strong><span>${safe([order.patientName, order.dose, order.route, order.frequency].filter(Boolean).join(" · "))}</span>`;
    const dialog = document.querySelector("#highRiskVerifyDialog");
    if (dialog && !dialog.open) dialog.showModal();
  } finally {
    state.busy = false;
  }
}

async function verifySecondStaff(event) {
  event.preventDefault();
  if (!state.order || !state.source) return;
  const submit = event.currentTarget.querySelector("button[type='submit']");
  const error = document.querySelector("#highRiskError");
  submit.disabled = true;
  submit.textContent = "Verifying…";
  let secondaryApp = null;
  let secondaryAuth = null;
  try {
    secondaryApp = initializeApp(app.options, `northstar-doublecheck-${Date.now()}`);
    secondaryAuth = getAuth(secondaryApp);
    const credential = await signInWithEmailAndPassword(secondaryAuth, document.querySelector("#highRiskEmail").value.trim(), document.querySelector("#highRiskPassword").value);
    if (credential.user.uid === auth.currentUser?.uid) throw new Error("A different staff member must perform the independent verification.");
    const profileSnap = await getDoc(doc(db, "users", credential.user.uid));
    if (!profileSnap.exists()) throw new Error("Verifier does not have a Northstar staff profile.");
    const profile = profileSnap.data();
    if (profile.status !== "active" || !["administrator", "physician", "nurse"].includes(profile.role)) throw new Error("Verifier must be an active physician, nurse, or Administrator.");

    await addDoc(collection(db, "auditEvents"), {
      type: "high-risk-medication-double-check",
      orderId: state.order.id,
      patientId: state.order.patientId,
      encounterId: state.order.encounterId || null,
      medicationName: state.order.name || "",
      primaryUid: auth.currentUser.uid,
      primaryName: auth.currentUser.email || "Northstar Staff",
      verifierUid: credential.user.uid,
      verifierName: profile.displayName || credential.user.email || "Northstar Staff",
      at: serverTimestamp()
    });

    window.NorthstarHighRiskVerification = {
      orderId: state.order.id,
      verifierUid: credential.user.uid,
      verifierName: profile.displayName || credential.user.email,
      verifiedAt: Date.now()
    };

    const button = state.source;
    button.dataset.highRiskVerified = "1";
    button.dataset.northstarIdentityVerified = "1";
    if (button.dataset.administerMedication) {
      button.dataset.legacyMedAuthorized = "pending";
      button.dataset.marGive = state.order.id;
    }
    document.querySelector("#highRiskVerifyDialog")?.close();
    toast(`Independent double check completed by ${profile.displayName || "second staff member"}.`);
    state.order = null;
    state.source = null;
    queueMicrotask(() => button.click());
  } catch (err) {
    error.textContent = err?.message || "Unable to verify the second staff member.";
    error.className = "form-message error";
  } finally {
    try { if (secondaryAuth) await signOut(secondaryAuth); } catch (_) {}
    try { if (secondaryApp) await deleteApp(secondaryApp); } catch (_) {}
    submit.disabled = false;
    submit.textContent = "Verify & Continue";
  }
}

ensureUi();
document.addEventListener("click", event => {
  const button = event.target.closest?.("[data-mar-give],[data-administer-medication]");
  if (!button) return;
  if (button.dataset.highRiskVerified === "1") {
    delete button.dataset.highRiskVerified;
    return;
  }
  const id = button.dataset.marGive || button.dataset.administerMedication;
  const token = window.NorthstarMedicationVerification;
  if (!token || token.orderId !== id) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  begin(button);
}, true);
