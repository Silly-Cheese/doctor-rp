import { getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);

const state = {
  order: null,
  patient: null,
  sourceButton: null,
  stream: null,
  loop: 0,
  scanner: null,
  busy: false
};

function safe(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function ensureUi() {
  if (!document.querySelector('link[href="northstar-med-verification.css"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "northstar-med-verification.css";
    document.head.appendChild(link);
  }
  if (document.querySelector("#medIdentityDialog")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <dialog id="medIdentityDialog" class="modal med-identity-dialog">
      <div class="modal-card med-identity-card">
        <div class="modal-header">
          <div><p class="eyebrow">Medication Safety</p><h3>Verify Patient Identity</h3></div>
          <button class="icon-button" type="button" data-close-med-verify aria-label="Close">×</button>
        </div>
        <div class="modal-body med-identity-body">
          <div id="medIdentityContext" class="med-identity-context"></div>
          <div class="med-identity-warning"><strong>Identity verification is required before administration.</strong><span>Scan the patient's Northstar wristband or enter the exact MRN printed on the wristband.</span></div>
          <div class="med-verify-grid">
            <section class="med-verify-method">
              <div class="med-verify-method-head"><span>Preferred</span><strong>Scan Wristband</strong></div>
              <div class="med-verify-camera"><video id="medVerifyVideo" autoplay playsinline muted></video><div class="med-verify-reticle" aria-hidden="true"></div></div>
              <p id="medVerifyScannerStatus" class="med-verify-status">Camera is ready to start.</p>
              <button id="medVerifyStartCamera" class="secondary-button" type="button">Start Camera</button>
            </section>
            <section class="med-verify-method">
              <div class="med-verify-method-head"><span>Alternative</span><strong>Enter MRN</strong></div>
              <label class="med-mrn-field"><span>Medical Record Number</span><input id="medVerifyMrn" autocomplete="off" autocapitalize="characters" placeholder="NMC-100001"></label>
              <p class="med-verify-copy">The MRN must exactly match the patient attached to this medication order.</p>
              <button id="medVerifyMrnButton" class="primary-button" type="button">Verify MRN</button>
            </section>
          </div>
          <div id="medVerifyError" class="form-message"></div>
        </div>
        <div class="modal-footer"><button class="secondary-button" type="button" data-close-med-verify>Cancel Administration</button></div>
      </div>
    </dialog>`);

  document.querySelectorAll("[data-close-med-verify]").forEach(button => button.addEventListener("click", closeDialog));
  document.querySelector("#medIdentityDialog")?.addEventListener("close", stopCamera);
  document.querySelector("#medVerifyStartCamera")?.addEventListener("click", startCamera);
  document.querySelector("#medVerifyMrnButton")?.addEventListener("click", verifyMrn);
  document.querySelector("#medVerifyMrn")?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      verifyMrn();
    }
  });
}

function setStatus(message, kind = "") {
  const node = document.querySelector("#medVerifyScannerStatus");
  if (!node) return;
  node.textContent = message;
  node.className = `med-verify-status${kind ? ` ${kind}` : ""}`;
}

function setError(message = "") {
  const node = document.querySelector("#medVerifyError");
  if (!node) return;
  node.textContent = message;
  node.className = message ? "form-message error" : "form-message";
}

async function loadMedicationContext(orderId, sourceButton) {
  const orderSnap = await getDoc(doc(db, "orders", orderId));
  if (!orderSnap.exists()) throw new Error("Medication order not found.");
  const order = { id: orderSnap.id, ...orderSnap.data() };
  const patientSnap = await getDoc(doc(db, "patients", order.patientId));
  if (!patientSnap.exists()) throw new Error("Patient record not found.");
  const patient = { id: patientSnap.id, ...patientSnap.data() };
  if (patient.vitalStatus === "deceased" || patient.currentStatus === "deceased") throw new Error("Medication administration is blocked for a deceased patient record.");
  state.order = order;
  state.patient = patient;
  state.sourceButton = sourceButton;
}

async function openVerification(orderId, sourceButton) {
  if (state.busy) return;
  state.busy = true;
  ensureUi();
  try {
    await loadMedicationContext(orderId, sourceButton);
    const patient = state.patient;
    const order = state.order;
    document.querySelector("#medIdentityContext").innerHTML = `<div><span>Patient</span><strong>${safe(patient.lastName || "")}, ${safe(patient.firstName || "")}</strong><small>${safe(patient.dob || "DOB unavailable")} · ${safe(patient.sex || "")}</small></div><div><span>Medication</span><strong>${safe(order.name || "Medication")}</strong><small>${safe([order.dose, order.route, order.frequency].filter(Boolean).join(" · "))}</small></div>`;
    document.querySelector("#medVerifyMrn").value = "";
    setError("");
    setStatus("Camera is ready to start.");
    const dialog = document.querySelector("#medIdentityDialog");
    if (!dialog.open) dialog.showModal();
  } catch (error) {
    showToast(error?.message || "Unable to verify this medication order.");
    resetContext();
  } finally {
    state.busy = false;
  }
}

function resolveQr(value) {
  const raw = String(value || "").trim();
  if (!raw || !state.patient) return false;
  if (raw.startsWith("NORTHSTAR|")) {
    const [, patientId, mrn] = raw.split("|");
    return patientId === state.patient.id && String(mrn || "").toUpperCase() === String(state.patient.mrn || "").toUpperCase();
  }
  return raw.toUpperCase() === String(state.patient.mrn || "").toUpperCase();
}

async function recordVerification(method) {
  if (!state.order || !state.patient || !auth.currentUser) return;
  try {
    const ref = doc(collection(db, "auditEvents"));
    await setDoc(ref, {
      type: "medication-identity-verified",
      orderId: state.order.id,
      encounterId: state.order.encounterId || null,
      patientId: state.patient.id,
      mrn: state.patient.mrn || "",
      medicationName: state.order.name || "",
      verificationMethod: method,
      actorUid: auth.currentUser.uid,
      actorName: auth.currentUser.displayName || auth.currentUser.email || "Northstar Staff",
      at: serverTimestamp()
    });
  } catch (_) {}
}

async function approve(method) {
  const button = state.sourceButton;
  if (!button || !state.order || !state.patient) return;
  await recordVerification(method);
  await stopCamera();
  document.querySelector("#medIdentityDialog")?.close();
  button.dataset.northstarIdentityVerified = "1";
  button.dataset.northstarVerificationMethod = method;
  showToast(method === "wristband-scan" ? "Patient verified by wristband. Administering medication." : "Patient verified by MRN. Administering medication.");
  const nextButton = button;
  resetContext(false);
  queueMicrotask(() => nextButton.click());
}

async function verifyMrn() {
  if (!state.patient) return;
  const entered = String(document.querySelector("#medVerifyMrn")?.value || "").trim().toUpperCase();
  const expected = String(state.patient.mrn || "").trim().toUpperCase();
  if (!entered) { setError("Enter the patient's MRN."); return; }
  if (entered !== expected) {
    setError("MRN does not match this patient. Medication administration remains blocked.");
    showToast("Patient identity mismatch. Medication was not administered.");
    return;
  }
  setError("");
  await approve("mrn-entry");
}

async function startNative(video) {
  if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) return false;
  try {
    const formats = typeof BarcodeDetector.getSupportedFormats === "function" ? await BarcodeDetector.getSupportedFormats() : ["qr_code"];
    if (!formats.includes("qr_code")) return false;
    state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = state.stream;
    await video.play();
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    setStatus("Rear camera active. Center the wristband QR code in the frame.", "scanning");
    let previous = 0;
    const loop = async timestamp => {
      if (!state.stream) return;
      if (timestamp - previous > 260) {
        previous = timestamp;
        try {
          const codes = await detector.detect(video);
          if (codes[0]?.rawValue) {
            if (resolveQr(codes[0].rawValue)) { await approve("wristband-scan"); return; }
            setError("That wristband belongs to a different patient. Medication administration remains blocked.");
          }
        } catch (_) {}
      }
      state.loop = requestAnimationFrame(loop);
    };
    state.loop = requestAnimationFrame(loop);
    return true;
  } catch (_) {
    await stopCamera();
    return false;
  }
}

async function startLibrary(video) {
  if (!navigator.mediaDevices?.getUserMedia) return false;
  try {
    const module = await import("https://cdn.jsdelivr.net/npm/qr-scanner@1.4.2/qr-scanner.min.js");
    const QrScanner = module.default || module;
    state.scanner = new QrScanner(video, async result => {
      const value = result?.data || result;
      if (resolveQr(value)) await approve("wristband-scan");
      else setError("That wristband belongs to a different patient. Medication administration remains blocked.");
    }, { preferredCamera: "environment", maxScansPerSecond: 8, returnDetailedScanResult: true });
    await state.scanner.start();
    setStatus("Rear camera active. Center the wristband QR code in the frame.", "scanning");
    return true;
  } catch (_) {
    try { state.scanner?.destroy(); } catch (_) {}
    state.scanner = null;
    return false;
  }
}

async function startCamera() {
  if (!state.patient) return;
  await stopCamera();
  setError("");
  const video = document.querySelector("#medVerifyVideo");
  if (!video) return;
  if (!window.isSecureContext) { setStatus("Camera scanning requires HTTPS. Enter the MRN instead.", "error"); return; }
  setStatus("Starting rear camera…", "scanning");
  if (await startNative(video)) return;
  if (await startLibrary(video)) return;
  setStatus("Camera scanning is unavailable on this browser. Enter the MRN instead.", "error");
}

async function stopCamera() {
  if (state.scanner) {
    try { state.scanner.stop(); state.scanner.destroy(); } catch (_) {}
    state.scanner = null;
  }
  if (state.loop) cancelAnimationFrame(state.loop);
  state.loop = 0;
  state.stream?.getTracks().forEach(track => track.stop());
  state.stream = null;
  const video = document.querySelector("#medVerifyVideo");
  if (video) { try { video.pause(); } catch (_) {} video.srcObject = null; }
}

function resetContext(clearButton = true) {
  state.order = null;
  state.patient = null;
  if (clearButton) state.sourceButton = null;
}

async function closeDialog() {
  await stopCamera();
  document.querySelector("#medIdentityDialog")?.close();
  resetContext();
}

ensureUi();

document.addEventListener("click", event => {
  const give = event.target.closest?.("[data-mar-give]");
  if (!give) return;
  if (give.dataset.northstarIdentityVerified === "1") {
    delete give.dataset.northstarIdentityVerified;
    delete give.dataset.northstarVerificationMethod;
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  openVerification(give.dataset.marGive, give);
}, true);
