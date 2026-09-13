import "./operations.js";
import "./operations-polish.js";
import "./admin-controls.js";

const chartDialog = document.querySelector("#patientChartDialog");
const chartBody = document.querySelector("#patientChartBody");

function refreshClinicalWorkspace() {
  if (!chartDialog?.open || !chartBody) return;
  const marker = document.createComment("northstar-clinical-refresh");
  chartBody.appendChild(marker);
  queueMicrotask(() => marker.remove());
}

if (chartDialog) {
  const observer = new MutationObserver(() => refreshClinicalWorkspace());
  observer.observe(chartDialog, { attributes: true, attributeFilter: ["open"] });
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-patient-id]")) setTimeout(refreshClinicalWorkspace, 0);
});
