import { getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, onSnapshot, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);
let unsubscribe = null;
let processing = false;

async function start(user) {
  unsubscribe?.(); unsubscribe = null; processing = false;
  if (!user) return;
  const profile = await getDoc(doc(db, "users", user.uid));
  if (!profile.exists() || profile.data().status !== "active" || profile.data().role !== "administrator") return;
  unsubscribe = onSnapshot(collection(db, "patients"), async snapshot => {
    if (processing) return;
    const legacy = snapshot.docs.filter(item => {
      const patient = item.data();
      const deceased = patient.vitalStatus === "deceased" || patient.currentStatus === "deceased";
      return deceased && patient.recordConfidential !== true;
    });
    if (!legacy.length) return;
    processing = true;
    try {
      for (let offset = 0; offset < legacy.length; offset += 200) {
        const batch = writeBatch(db);
        legacy.slice(offset, offset + 200).forEach(item => {
          const patient = item.data();
          batch.update(item.ref, {
            recordConfidential: true,
            recordConfidentialReason: "deceased",
            recordConfidentialAt: serverTimestamp(),
            recordConfidentialBy: user.uid,
            recordConfidentialByName: profile.data().displayName || "Administrator",
            deceasedAccessUids: [],
            deceasedAccessUpdatedAt: serverTimestamp(),
            deceasedAccessUpdatedBy: user.uid,
            deceasedAccessUpdatedByName: profile.data().displayName || "Administrator",
            updatedAt: serverTimestamp()
          });
          const audit = doc(collection(db, "auditEvents"));
          batch.set(audit, { type: "legacy-deceased-record-sealed", patientId: item.id, mrn: patient.mrn || "", actorUid: user.uid, actorName: profile.data().displayName || "Administrator", at: serverTimestamp() });
        });
        await batch.commit();
      }
    } finally {
      processing = false;
    }
  });
}

onAuthStateChanged(auth, user => start(user).catch(() => {}));
