from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"{label} not found in {path}")
    p.write_text(text.replace(old, new, 1))

path = "northstar-med-verification.js"
old = '''async function approve(method) {
  const button = state.sourceButton;
  if (!button || !state.order || !state.patient) return;
  await recordVerification(method);
  await stopCamera();'''
new = '''async function approve(method) {
  const button = state.sourceButton;
  if (!button || !state.order || !state.patient) return;
  await recordVerification(method);
  window.NorthstarMedicationVerification = {
    orderId: state.order.id,
    patientId: state.patient.id,
    method,
    verifiedAt: Date.now()
  };
  await stopCamera();'''
replace_once(path, old, new, "verification token creation")

path = "northstar-clinical-plus.js"
old = '''async function marAction(orderId, action) {
  const order = state.orders.find(o => o.id === orderId); if (!order || !isNurse()) return;
  const patient = patientById(order.patientId);
  try {
    const batch = writeBatch(db);
    if (action === "give") {
      const adminRef = doc(collection(db, "medicationAdministrations"));
      batch.set(adminRef, { orderId: order.id, encounterId: order.encounterId, patientId: order.patientId, medicationName: order.name, dose: order.dose || "", route: order.route || "", note: "Medication administered from MAR", administeredBy: auth.currentUser.uid, administeredByName: state.profile.displayName, administeredAt: serverTimestamp(), patientVerified: true, allergyVerified: true });'''
new = '''async function marAction(orderId, action) {
  const order = state.orders.find(o => o.id === orderId); if (!order || !isNurse()) return;
  const patient = patientById(order.patientId);
  const verification = window.NorthstarMedicationVerification;
  if (action === "give") {
    const validVerification = verification
      && verification.orderId === order.id
      && verification.patientId === order.patientId
      && ["wristband-scan", "mrn-entry"].includes(verification.method)
      && Date.now() - Number(verification.verifiedAt || 0) < 90_000;
    if (!validVerification) {
      showToast("Patient identity verification is required. Scan the wristband or enter the exact MRN.");
      return;
    }
  }
  try {
    const batch = writeBatch(db);
    if (action === "give") {
      const adminRef = doc(collection(db, "medicationAdministrations"));
      batch.set(adminRef, { orderId: order.id, encounterId: order.encounterId, patientId: order.patientId, medicationName: order.name, dose: order.dose || "", route: order.route || "", note: "Medication administered from MAR", administeredBy: auth.currentUser.uid, administeredByName: state.profile.displayName, administeredAt: serverTimestamp(), patientVerified: true, patientVerificationMethod: verification.method, patientVerificationAt: new Date(verification.verifiedAt), allergyVerified: true });'''
replace_once(path, old, new, "MAR verification guard")

old = '''    await batch.commit(); showToast(action === "give" ? "Medication administered." : action === "hold" ? "Medication held." : "Medication refusal documented.");'''
new = '''    await batch.commit();
    if (action === "give") window.NorthstarMedicationVerification = null;
    showToast(action === "give" ? "Medication administered." : action === "hold" ? "Medication held." : "Medication refusal documented.");'''
replace_once(path, old, new, "verification token consumption")
