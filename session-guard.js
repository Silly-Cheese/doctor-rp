import { getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);

let unsubscribeProfile = null;
let initialFingerprint = null;

function stopProfileListener() {
  if (unsubscribeProfile) unsubscribeProfile();
  unsubscribeProfile = null;
  initialFingerprint = null;
}

function fingerprint(profile) {
  return JSON.stringify({
    displayName: profile.displayName || "",
    role: profile.role || "",
    requestedRole: profile.requestedRole || "",
    status: profile.status || ""
  });
}

onAuthStateChanged(auth, (user) => {
  stopProfileListener();
  if (!user) return;

  unsubscribeProfile = onSnapshot(doc(db, "users", user.uid), async (snapshot) => {
    if (!snapshot.exists()) return;
    const profile = snapshot.data();

    if (profile.status === "suspended") {
      await signOut(auth);
      return;
    }

    const nextFingerprint = fingerprint(profile);
    if (initialFingerprint === null) {
      initialFingerprint = nextFingerprint;
      return;
    }

    if (profile.status === "active" && nextFingerprint !== initialFingerprint) {
      window.location.reload();
    }
  });
});
