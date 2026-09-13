import { getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);

const state = {
  order: null,
  patient: null,
  profile: null,
  sourceButton: null,
  stream: null,
  scanLoop: 0,
  scanner: null,
  busy: false,
  collecting: false
};

const safe = value => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

function toast(message) {
  const node = document.querySelector("#toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 3200);
}

function ensureUi() {
  if (!document.querySelector('link[href="northstar-specimen-verification.css"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "northstar-specimen-verification.css";
    document.head.appendChild(link);
  }
  if (document.querySelector("#specimenIdentityDialog")) return;

  document.body.insertAdjacentHTML("beforeend", `
    <dialog id="specimenIdentityDialog" class="modal specimen-verify-dialog">
      <div class="modal-card specimen-verify-card">
        <div class="modal-header">
          <div><p class="eyebrow">Laboratory Safety</p><h3>Verify Patient Before Collection</h3></div>
          <button class="icon-button" type="button" data-close-specimen-verify aria-label="Close">×</button>
        </div>
        <div class="modal-body specimen-verify-body">
          <div id="specimenIdentityContext" class="specimen-context"></div>
          <div class="specimen-warning">
            <strong>Patient identity verification is required before specimen collection.</strong>
            <span>Scan the Northstar wristband or enter the exact MRN printed on it.</span>
          </div>
          <div class="specimen-verify-grid">
            <section class="specimen-method">
              <div class="specimen-method-head"><span>Preferred</span><strong>Scan Wristband</strong></div>
              <div class="specimen-camera-wrap">
                <video id="specimenVerifyVideo" autoplay playsinline muted></video>
                <div class="specimen-reticle" aria-hidden="true"></div>
              </div>
              <p id="specimenScannerStatus" class="specimen-status">Camera is ready to start.</p>
              <div class="specimen-method-actions">
                <button id="specimenStartCamera" class="primary-button" type="button">Start Camera</button>
                <label class="secondary-button specimen-photo-button" for="specimenScanPhoto">Scan Photo</label>
                <input id="specimenScanPhoto" type="file" accept="image/*" capture="environment" hidden>
              </div>
            </section>
            <section class="specimen-method">
              <div class="specimen-method-head"><span>Alternative</span><strong>Enter MRN</strong></div>
              <label class="specimen-mrn-field">
                <span>Medical Record Number</span>
                <input id="specimenVerifyMrn" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="NMC-100001">
              </label>
              <p class="specimen-copy">The MRN must exactly match the patient attached to this laboratory order.</p>
              <button id="specimenVerifyMrnButton" class="primary-button" type="button">Verify MRN & Collect</button>
            </section>
          </div>
          <p id="specimenVerifyError" class="form-message"></p>
        </div>
        <div class="modal-footer"><button class="secondary-button" type="button" data-close-specimen-verify>Cancel Collection</button></div>
      </div>
    </dialog>`);

  document.querySelectorAll("[data-close-specimen-verify]").forEach(button => button.addEventListener("click", closeDialog));
  document.querySelector("#specimenIdentityDialog")?.addEventListener("close", stopCamera);
  document.querySelector("#specimenStartCamera")?.addEventListener("click", startCamera);
  document.querySelector("#specimenVerifyMrnButton")?.addEventListener("click", verifyMrn);
  document.querySelector("#specimenVerifyMrn")?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      verifyMrn();
    }
  });
  document.querySelector("#specimenScanPhoto")?.addEventListener("change", scanPhoto);
}

function setStatus(message, kind = "") {
  const node = document.querySelector("#specimenScannerStatus");
  if (!node) return;
  node.textContent = message;
  node.className = `specimen-status${kind ? ` ${kind}` : ""}`;
}

function setError(message = "") {
  const node = document.querySelector("#specimenVerifyError");
  if (!node) return;
  node.textContent = message;
  node.className = message ? "form-message error" : "form-message";
}

function resetState(clearButton = true) {
  state.order = null;
  state.patient = null;
  state.profile = null;
  if (clearButton) state.sourceButton = null;
  state.busy = false;
  state.collecting = false;
}

async function loadContext(orderId, button) {
  const orderSnap = await getDoc(doc(db, "orders", orderId));
  if (!orderSnap.exists()) throw new Error("Laboratory order not found.");
  const order = { id: orderSnap.id, ...orderSnap.data() };
  if (order.category !== "laboratory") throw new Error("This is not a laboratory order.");

  const patientSnap = await getDoc(doc(db, "patients", order.patientId));
  if (!patientSnap.exists()) throw new Error("Patient record not found.");
  const patient = { id: patientSnap.id, ...patientSnap.data() };
  if (patient.vitalStatus === "deceased" || patient.currentStatus === "deceased") {
    throw new Error("Specimen collection is blocked for a deceased patient record.");
  }

  let profile = null;
  if (auth.currentUser) {
    const profileSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
    if (profileSnap.exists()) profile = { id: profileSnap.id, ...profileSnap.data() };
  }

  state.order = order;
  state.patient = patient;
  state.profile = profile;
  state.sourceButton = button;
}

async function openVerification(orderId, button) {
  if (state.busy || state.collecting) return;
  state.busy = true;
  ensureUi();
  try {
    await loadContext(orderId, button);
    const p = state.patient;
    const o = state.order;
    document.querySelector("#specimenIdentityContext").innerHTML = `
      <div><span>Patient</span><strong>${safe(p.lastName || "")}, ${safe(p.firstName || "")}</strong><small>${safe(p.dob || "DOB unavailable")} · ${safe(p.sex || "")}</small></div>
      <div><span>Laboratory Order</span><strong>${safe(o.name || "Laboratory test")}</strong><small>${safe(o.priority ? o.priority.toUpperCase() : "Routine")} · ${safe(p.mrn || "MRN unavailable")}</small></div>`;
    document.querySelector("#specimenVerifyMrn").value = "";
    const photo = document.querySelector("#specimenScanPhoto");
    if (photo) photo.value = "";
    setError("");
    setStatus("Camera is ready to start.");
    const dialog = document.querySelector("#specimenIdentityDialog");
    if (!dialog.open) dialog.showModal();
  } catch (error) {
    toast(error?.message || "Unable to verify this specimen collection.");
    resetState();
  } finally {
    state.busy = false;
  }
}

function qrMatchesPatient(value) {
  const raw = String(value || "").trim();
  const p = state.patient;
  if (!raw || !p) return false;
  const expectedMrn = String(p.mrn || "").trim().toUpperCase();

  if (raw.startsWith("NORTHSTAR|")) {
    const [, patientId, mrn] = raw.split("|");
    return patientId === p.id && String(mrn || "").trim().toUpperCase() === expectedMrn;
  }

  return raw.toUpperCase() === expectedMrn;
}

async function collectSpecimen(method) {
  if (state.collecting || !state.order || !state.patient || !auth.currentUser) return;
  state.collecting = true;
  const order = state.order;
  const patient = state.patient;
  const profile = state.profile;
  try {
    const specimen = await addDoc(collection(db, "labSpecimens"), {
      orderId: order.id,
      patientId: patient.id,
      patientName: order.patientName || `${patient.lastName || ""}, ${patient.firstName || ""}`.trim(),
      mrn: order.mrn || patient.mrn || "",
      testName: order.name || "Laboratory test",
      status: "collected",
      identityVerified: true,
      identityVerificationMethod: method,
      identityVerifiedAt: serverTimestamp(),
      collectedBy: auth.currentUser.uid,
      collectedByName: profile?.displayName || auth.currentUser.displayName || auth.currentUser.email || "Northstar Staff",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    await addDoc(collection(db, "auditEvents"), {
      type: "specimen-identity-verified-and-collected",
      specimenId: specimen.id,
      orderId: order.id,
      encounterId: order.encounterId || null,
      patientId: patient.id,
      mrn: patient.mrn || "",
      testName: order.name || "",
      verificationMethod: method,
      actorUid: auth.currentUser.uid,
      actorName: profile?.displayName || auth.currentUser.displayName || auth.currentUser.email || "Northstar Staff",
      at: serverTimestamp()
    });

    await stopCamera();
    document.querySelector("#specimenIdentityDialog")?.close();
    toast(method === "wristband-scan" ? "Wristband verified. Specimen collected and labeled." : "MRN verified. Specimen collected and labeled.");
    resetState();
  } catch (error) {
    setError("Unable to record specimen collection. Check your access and try again.");
    toast("Specimen collection could not be saved.");
    state.collecting = false;
  }
}

async function verifyMrn() {
  if (!state.patient || state.collecting) return;
  const entered = String(document.querySelector("#specimenVerifyMrn")?.value || "").trim().toUpperCase();
  const expected = String(state.patient.mrn || "").trim().toUpperCase();
  if (!entered) {
    setError("Enter the patient's MRN.");
    return;
  }
  if (entered !== expected) {
    setError("MRN does not match this patient. Specimen collection remains blocked.");
    toast("Patient identity mismatch. Specimen was not collected.");
    return;
  }
  setError("");
  await collectSpecimen("mrn-entry");
}

async function handleScannedValue(value) {
  if (!state.patient || state.collecting) return;
  if (!qrMatchesPatient(value)) {
    setError("That wristband belongs to a different patient. Specimen collection remains blocked.");
    toast("Wrong patient wristband. Specimen was not collected.");
    return;
  }
  setError("");
  await collectSpecimen("wristband-scan");
}

async function startNative(video) {
  if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) return false;
  try {
    const formats = typeof BarcodeDetector.getSupportedFormats === "function"
      ? await BarcodeDetector.getSupportedFormats()
      : ["qr_code"];
    if (!formats.includes("qr_code")) return false;

    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = state.stream;
    await video.play();

    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    setStatus("Rear camera active. Center the wristband QR code in the frame.", "scanning");
    let previous = 0;
    const loop = async timestamp => {
      if (!state.stream || state.collecting) return;
      if (timestamp - previous > 250) {
        previous = timestamp;
        try {
          const codes = await detector.detect(video);
          if (codes[0]?.rawValue) {
            await handleScannedValue(codes[0].rawValue);
            if (state.collecting) return;
          }
        } catch (_) {}
      }
      state.scanLoop = requestAnimationFrame(loop);
    };
    state.scanLoop = requestAnimationFrame(loop);
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
      await handleScannedValue(result?.data || result);
    }, {
      preferredCamera: "environment",
      maxScansPerSecond: 8,
      returnDetailedScanResult: true
    });
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
  if (!state.patient || state.collecting) return;
  await stopCamera();
  setError("");
  const video = document.querySelector("#specimenVerifyVideo");
  if (!video) return;
  if (!window.isSecureContext) {
    setStatus("Camera scanning requires HTTPS. Enter the MRN instead.", "error");
    return;
  }
  setStatus("Starting rear camera…", "scanning");
  if (await startNative(video)) return;
  if (await startLibrary(video)) return;
  setStatus("Live camera scanning is unavailable on this browser. Use Scan Photo or enter the MRN.", "error");
}

async function scanPhoto(event) {
  if (!state.patient || state.collecting) return;
  const file = event.target.files?.[0];
  if (!file) return;
  setError("");
  setStatus("Reading wristband image…", "scanning");
  try {
    const module = await import("https://cdn.jsdelivr.net/npm/qr-scanner@1.4.2/qr-scanner.min.js");
    const QrScanner = module.default || module;
    const result = await QrScanner.scanImage(file, { returnDetailedScanResult: true });
    await handleScannedValue(result?.data || result);
  } catch (_) {
    setStatus("No readable Northstar QR code was found in that image.", "error");
    setError("Try another photo, use the live camera, or enter the MRN.");
  }
}

async function stopCamera() {
  if (state.scanner) {
    try { state.scanner.stop(); state.scanner.destroy(); } catch (_) {}
    state.scanner = null;
  }
  if (state.scanLoop) cancelAnimationFrame(state.scanLoop);
  state.scanLoop = 0;
  state.stream?.getTracks().forEach(track => track.stop());
  state.stream = null;
  const video = document.querySelector("#specimenVerifyVideo");
  if (video) {
    try { video.pause(); } catch (_) {}
    video.srcObject = null;
  }
}

async function closeDialog() {
  await stopCamera();
  document.querySelector("#specimenIdentityDialog")?.close();
  resetState();
}

ensureUi();

document.addEventListener("click", event => {
  const button = event.target.closest?.("[data-lab-order]");
  if (!button) return;

  // Only the first Collection step requires patient identification.
  if (button.textContent.trim().toLowerCase() !== "collect") return;

  event.preventDefault();
  event.stopImmediatePropagation();
  openVerification(button.dataset.labOrder, button);
}, true);
