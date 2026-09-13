import { getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);

const state = { patients: [], unsubscribe: null, qrScanner: null, nativeStream: null, nativeLoop: 0 };

function patientById(id) { return state.patients.find(p => p.id === id) || null; }
function safeText(value) { return String(value ?? ""); }
function showToast(message) { const t = document.querySelector("#toast"); if (!t) return; t.textContent = message; t.classList.add("show"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => t.classList.remove("show"), 3000); }
function canOpen(patient) { return window.NorthstarPatientAccess?.canView ? window.NorthstarPatientAccess.canView(patient) : true; }

function ensureAssets() {
  if (!document.querySelector('link[href="northstar-mobile.css"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "northstar-mobile.css";
    document.head.appendChild(link);
  }
  const dialog = document.querySelector("#wristbandScannerDialog");
  const body = dialog?.querySelector(".scanner-body");
  const video = document.querySelector("#wristbandVideo");
  if (video) { video.setAttribute("autoplay", ""); video.setAttribute("playsinline", ""); video.muted = true; }
  if (body && video && !body.querySelector(".scanner-live")) {
    const wrap = document.createElement("div");
    wrap.className = "scanner-live";
    video.parentNode.insertBefore(wrap, video);
    wrap.appendChild(video);
    wrap.insertAdjacentHTML("beforeend", '<div class="scanner-reticle" aria-hidden="true"></div>');
  }
  if (body && !document.querySelector("#scannerPhotoInput")) {
    const manual = body.querySelector(".scanner-manual");
    const tools = document.createElement("div");
    tools.className = "scanner-mobile-tools";
    tools.innerHTML = '<label class="secondary-button scanner-photo-button">Scan Photo<input id="scannerPhotoInput" type="file" accept="image/*" capture="environment"></label><button id="restartMobileScanner" class="secondary-button" type="button">Restart Camera</button>';
    if (manual) body.insertBefore(tools, manual); else body.appendChild(tools);
    tools.insertAdjacentHTML("afterend", '<p class="scanner-camera-note">On phones and tablets, Northstar will prefer the rear camera. You can also take or choose a photo of the wristband QR code.</p>');
  }
  const button = document.querySelector("#scanWristbandButton");
  if (button && window.matchMedia("(max-width:700px)").matches) button.textContent = "Scan";
}

function setStatus(message, kind = "") {
  const status = document.querySelector("#scannerStatus");
  if (!status) return;
  status.textContent = message;
  status.className = `scanner-status${kind ? ` ${kind}` : ""}`;
}

async function stopScanner() {
  if (state.qrScanner) {
    try { state.qrScanner.stop(); state.qrScanner.destroy(); } catch (_) {}
    state.qrScanner = null;
  }
  if (state.nativeLoop) cancelAnimationFrame(state.nativeLoop);
  state.nativeLoop = 0;
  state.nativeStream?.getTracks().forEach(track => track.stop());
  state.nativeStream = null;
  const video = document.querySelector("#wristbandVideo");
  if (video) { try { video.pause(); } catch (_) {} video.srcObject = null; }
}

function resolvePayload(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.startsWith("NORTHSTAR|")) {
    const [, id, mrn] = raw.split("|");
    return patientById(id) || state.patients.find(p => String(p.mrn || "").toLowerCase() === String(mrn || "").toLowerCase()) || null;
  }
  return state.patients.find(p => String(p.mrn || "").toLowerCase() === raw.toLowerCase()) || null;
}

async function finishScan(value) {
  const patient = resolvePayload(value);
  if (!patient) { setStatus("QR code read, but it does not match a Northstar patient.", "error"); showToast("No matching Northstar patient found."); return; }
  if (!canOpen(patient)) { await stopScanner(); document.querySelector("#wristbandScannerDialog")?.close(); showToast("This deceased patient record is confidential. Administrator-granted access is required."); return; }
  setStatus(`Patient verified: ${safeText(patient.lastName)}, ${safeText(patient.firstName)}.`, "success");
  await stopScanner();
  document.querySelector("#wristbandScannerDialog")?.close();
  window.dispatchEvent(new CustomEvent("northstar:open-patient", { detail: { patientId: patient.id } }));
}

async function startNativeScanner(video) {
  if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) return false;
  try {
    const supported = typeof BarcodeDetector.getSupportedFormats === "function" ? await BarcodeDetector.getSupportedFormats() : ["qr_code"];
    if (!supported.includes("qr_code")) return false;
    state.nativeStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = state.nativeStream;
    await video.play();
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    setStatus("Rear camera active. Center the wristband QR code in the frame.", "scanning");
    let last = 0;
    const loop = async ts => {
      if (!state.nativeStream) return;
      if (ts - last > 280) {
        last = ts;
        try { const codes = await detector.detect(video); if (codes[0]?.rawValue) { await finishScan(codes[0].rawValue); return; } } catch (_) {}
      }
      state.nativeLoop = requestAnimationFrame(loop);
    };
    state.nativeLoop = requestAnimationFrame(loop);
    return true;
  } catch (_) {
    await stopScanner();
    return false;
  }
}

async function startLibraryScanner(video) {
  if (!navigator.mediaDevices?.getUserMedia) return false;
  try {
    const module = await import("https://cdn.jsdelivr.net/npm/qr-scanner@1.4.2/qr-scanner.min.js");
    const QrScanner = module.default || module;
    state.qrScanner = new QrScanner(video, result => finishScan(result?.data || result), {
      preferredCamera: "environment",
      maxScansPerSecond: 8,
      highlightScanRegion: true,
      highlightCodeOutline: true,
      returnDetailedScanResult: true
    });
    await state.qrScanner.start();
    setStatus("Rear camera active. Center the wristband QR code in the frame.", "scanning");
    return true;
  } catch (_) {
    try { state.qrScanner?.destroy(); } catch (_) {}
    state.qrScanner = null;
    return false;
  }
}

async function startScanner() {
  ensureAssets();
  await stopScanner();
  const video = document.querySelector("#wristbandVideo");
  if (!video) return;
  if (!window.isSecureContext) { setStatus("Camera scanning requires HTTPS. Use the photo or MRN option below.", "error"); return; }
  setStatus("Starting mobile camera…", "scanning");
  if (await startNativeScanner(video)) return;
  if (await startLibraryScanner(video)) return;
  setStatus("Live camera scanning is unavailable on this browser. Use Scan Photo or enter the MRN below.", "error");
}

async function openScanner() {
  ensureAssets();
  const dialog = document.querySelector("#wristbandScannerDialog");
  if (!dialog) return;
  if (!dialog.open) dialog.showModal();
  await startScanner();
}

async function scanPhoto(file) {
  if (!file) return;
  setStatus("Reading QR code from photo…", "scanning");
  try {
    const module = await import("https://cdn.jsdelivr.net/npm/qr-scanner@1.4.2/qr-scanner.min.js");
    const QrScanner = module.default || module;
    const result = await QrScanner.scanImage(file, { returnDetailedScanResult: true });
    await finishScan(result?.data || result);
  } catch (_) {
    setStatus("No readable Northstar QR code was found in that photo.", "error");
  }
}

function bindEvents() {
  document.addEventListener("click", event => {
    const scan = event.target.closest("#scanWristbandButton");
    if (scan) { event.preventDefault(); event.stopImmediatePropagation(); openScanner(); return; }
    const manual = event.target.closest("#manualScanButton");
    if (manual) { event.preventDefault(); event.stopImmediatePropagation(); finishScan(document.querySelector("#manualScanMrn")?.value || ""); return; }
    if (event.target.closest("#restartMobileScanner")) { event.preventDefault(); startScanner(); }
  }, true);
  document.addEventListener("change", event => { if (event.target.id === "scannerPhotoInput") { scanPhoto(event.target.files?.[0]); event.target.value = ""; } });
  document.querySelector("#wristbandScannerDialog")?.addEventListener("close", stopScanner);
  window.addEventListener("resize", () => { const button = document.querySelector("#scanWristbandButton"); if (button) button.textContent = window.matchMedia("(max-width:700px)").matches ? "Scan" : "Scan Wristband"; });
}

function startPatientListener(user) {
  state.unsubscribe?.(); state.unsubscribe = null; state.patients = [];
  if (!user) return;
  state.unsubscribe = onSnapshot(collection(db, "patients"), snapshot => { state.patients = snapshot.docs.map(d => ({ id: d.id, ...d.data() })); }, () => { state.patients = []; });
}

ensureAssets();
bindEvents();
onAuthStateChanged(auth, startPatientListener);
