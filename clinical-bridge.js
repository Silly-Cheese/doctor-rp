const NORTHSTAR_MODULES = [
  "./northstar-dialogs.js",
  "./operations.js",
  "./operations-polish.js",
  "./staff-editor-stability.js",
  "./admin-controls.js",
  "./staff-edit-fix.js",
  "./patient-editor.js",
  "./case-records.js",
  "./northstar-platform.js",
  "./northstar-clinical-plus.js",
  "./northstar-simulation.js",
  "./northstar-scenario-director.js",
  "./deceased-access.js",
  "./deceased-access-migration.js",
  "./northstar-mobile.js",
  "./northstar-med-verification.js",
  "./northstar-legacy-med-guard.js",
  "./northstar-highrisk-med.js",
  "./northstar-order-ack.js",
  "./northstar-enterprise.js",
  "./northstar-specimen-verification.js",
  "./northstar-breakglass.js",
  "./northstar-safety-banner.js",
  "./northstar-pwa.js",
  "./session-guard.js"
];

const failedModules = [];

async function loadNorthstarModule(path) {
  try {
    await import(path);
    return true;
  } catch (error) {
    failedModules.push({ path, error });
    console.error(`Northstar module failed to load: ${path}`, error);
    return false;
  }
}

async function bootNorthstar() {
  document.documentElement.dataset.northstarBoot = "loading";

  for (const path of NORTHSTAR_MODULES) {
    await loadNorthstarModule(path);
  }

  document.documentElement.dataset.northstarBoot = failedModules.length ? "degraded" : "ready";

  if (failedModules.length) {
    window.NorthstarStartupDiagnostics = failedModules.map(item => ({
      module: item.path,
      message: item.error?.message || String(item.error)
    }));

    const toast = document.querySelector("#toast");
    if (toast) {
      toast.textContent = "Northstar loaded with a limited feature set. Refresh once; if this continues, check Startup Diagnostics.";
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 5000);
    }
  } else {
    window.NorthstarStartupDiagnostics = [];
  }

  window.dispatchEvent(new CustomEvent("northstar:boot-complete", {
    detail: {
      status: failedModules.length ? "degraded" : "ready",
      failedModules: window.NorthstarStartupDiagnostics
    }
  }));
}

bootNorthstar();
