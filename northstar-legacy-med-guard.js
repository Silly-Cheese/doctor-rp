const toast = (message) => {
  const node = document.querySelector("#toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 3200);
};

let pendingLegacyOrderId = null;

document.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-administer-medication]");
  if (!button) return;

  if (button.dataset.legacyMedAuthorized === "pending") {
    const token = window.NorthstarMedicationVerification;
    if (!token || token.orderId !== button.dataset.administerMedication || Date.now() - Number(token.verifiedAt || 0) >= 90000) {
      event.preventDefault();
      event.stopImmediatePropagation();
      delete button.dataset.legacyMedAuthorized;
      delete button.dataset.marGive;
      toast("Patient identity verification expired. Verify the wristband or MRN again.");
      return;
    }
    pendingLegacyOrderId = button.dataset.administerMedication;
    delete button.dataset.legacyMedAuthorized;
    delete button.dataset.marGive;
    queueMicrotask(() => {
      const dialog = document.querySelector("#medicationAdministrationDialog");
      if (dialog) dialog.dataset.identityOrderId = pendingLegacyOrderId || "";
    });
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  button.dataset.legacyMedAuthorized = "pending";
  button.dataset.marGive = button.dataset.administerMedication;
  queueMicrotask(() => button.click());
}, true);

document.addEventListener("submit", (event) => {
  if (event.target?.id !== "medicationAdministrationForm") return;
  const dialog = document.querySelector("#medicationAdministrationDialog");
  const orderId = dialog?.dataset.identityOrderId || pendingLegacyOrderId;
  const token = window.NorthstarMedicationVerification;
  const valid = token
    && token.orderId === orderId
    && ["wristband-scan", "mrn-entry"].includes(token.method)
    && Date.now() - Number(token.verifiedAt || 0) < 90000;

  if (!valid) {
    event.preventDefault();
    event.stopImmediatePropagation();
    toast("Medication administration blocked: verify the patient's wristband or exact MRN.");
    return;
  }

  queueMicrotask(() => {
    window.NorthstarMedicationVerification = null;
    pendingLegacyOrderId = null;
    if (dialog) delete dialog.dataset.identityOrderId;
  });
}, true);
