import { getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);

function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 3000);
}

function nameParts(displayName, fallbackFirst = "", fallbackLast = "") {
  const cleaned = String(displayName || "").trim().replace(/\s+/g, " ");
  if (!cleaned) return { firstName: fallbackFirst || "Staff", lastName: fallbackLast || "Member" };
  const parts = cleaned.split(" ");
  return {
    firstName: parts.shift() || fallbackFirst || "Staff",
    lastName: parts.join(" ") || fallbackLast || "Member"
  };
}

async function saveStaff(card, uid, button) {
  const actor = auth.currentUser;
  if (!actor) return;

  const [actorSnapshot, targetSnapshot, setupSnapshot] = await Promise.all([
    getDoc(doc(db, "users", actor.uid)),
    getDoc(doc(db, "users", uid)),
    getDoc(doc(db, "system", "setup"))
  ]);

  if (!actorSnapshot.exists() || actorSnapshot.data().role !== "administrator" || actorSnapshot.data().status !== "active") {
    showToast("Administrator access is required to edit staff accounts.");
    return;
  }
  if (!targetSnapshot.exists()) {
    showToast("That staff account is no longer available.");
    return;
  }

  const current = targetSnapshot.data();
  const founder = setupSnapshot.exists() && setupSnapshot.data().initializedBy === uid;
  const displayName = card.querySelector("[data-staff-name]")?.value.trim() || current.displayName || "Northstar Staff";
  const requestedRole = card.querySelector("[data-staff-title]")?.value || current.requestedRole || "staff";
  const role = founder ? "administrator" : (card.querySelector("[data-staff-role]")?.value || current.role || "staff");
  const status = founder ? "active" : (card.querySelector("[data-staff-status]")?.value || current.status || "pending");
  const names = nameParts(displayName, current.firstName, current.lastName);

  button.disabled = true;
  button.textContent = "Saving…";

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "users", uid), {
      uid,
      displayName,
      firstName: names.firstName,
      lastName: names.lastName,
      requestedRole,
      role,
      status,
      updatedAt: serverTimestamp(),
      updatedBy: actor.uid
    });
    batch.set(doc(collection(db, "auditEvents")), {
      type: "staff-account-updated",
      staffUid: uid,
      staffName: displayName,
      role,
      status,
      actorUid: actor.uid,
      actorName: actorSnapshot.data().displayName || actor.displayName || "Northstar Administrator",
      at: serverTimestamp()
    });
    await batch.commit();
    showToast("Staff account updated.");
  } catch (error) {
    console.error("Northstar staff update failed", error);
    showToast(error?.code === "permission-denied" ? "Staff changes were blocked by the current Firestore rules." : "Unable to update that staff account.");
  } finally {
    button.disabled = false;
    button.textContent = "Save Changes";
  }
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-save-staff]");
  if (!button) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const uid = button.dataset.saveStaff;
  const card = button.closest("[data-managed-staff]");
  if (!uid || !card) return;
  await saveStaff(card, uid, button);
}, true);
