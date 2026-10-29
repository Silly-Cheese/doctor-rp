const NORTHSTAR_BUILD = "20261029-northstar-v4.1.0";
const moduleUrl = path => `${path}?v=${NORTHSTAR_BUILD}`;
window.NorthstarBuild = NORTHSTAR_BUILD;
const failedModules = [];

async function loadNorthstarModule(path) {
  try {
    await import(moduleUrl(path));
    return true;
  } catch (error) {
    failedModules.push({ path, error });
    console.error(`Northstar module failed to load: ${path}`, error);
    return false;
  }
}

async function loadGroup(paths) {
  await Promise.allSettled(paths.map(path => loadNorthstarModule(path)));
}

async function bootNorthstar() {
  const startedAt = performance.now();
  document.documentElement.dataset.northstarBoot = "loading";

  // Foundation modules that establish shared UI/state behavior.
  await loadNorthstarModule("./northstar-dialogs.js");
  await loadNorthstarModule("./operations.js");
  await loadNorthstarModule("./operations-polish.js");
  await loadNorthstarModule("./staff-editor-stability.js");

  // Independent feature modules can initialize concurrently.
  await loadGroup([
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
    "./northstar-order-ack.js",
    "./northstar-specimen-verification.js",
    "./northstar-breakglass.js",
    "./northstar-record-lock.js",
    "./northstar-safety-banner.js",
    "./northstar-pwa.js",
    "./session-guard.js"
  ]);

  // Medication guards load after the base verifier.
  await loadGroup([
    "./northstar-legacy-med-guard.js",
    "./northstar-highrisk-med.js"
  ]);

  // Navigation comes last so it can organize every feature that registered a destination.
  await loadNorthstarModule("./northstar-enterprise.js");

  // vNext connects the existing clinical, operational, and simulation surfaces into one command experience.
  await loadNorthstarModule("./northstar-vnext.js");

  // Dynamically loaded modules insert stylesheets after the original document styles.
  // Keep the hospital-wide light theme last so dark module defaults cannot override it.
  const lightTheme = document.querySelector('link[href^="northstar-light-theme.css"]');
  if (lightTheme) {
    lightTheme.href = "northstar-light-theme.css?v=20261022-stable";
    document.head.appendChild(lightTheme);
  }

  // Consolidation styles should be last, after dynamically imported module CSS.
  const cleanupTheme = document.querySelector('link[href^="northstar-cleanup.css"]');
  if (cleanupTheme) document.head.appendChild(cleanupTheme);

  document.documentElement.dataset.northstarBoot = failedModules.length ? "degraded" : "ready";
  document.documentElement.dataset.northstarBootMs = String(Math.round(performance.now() - startedAt));

  window.NorthstarStartupDiagnostics = failedModules.map(item => ({
    module: item.path,
    message: item.error?.message || String(item.error)
  }));

  if (failedModules.length) {
    const toast = document.querySelector("#toast");
    if (toast) {
      toast.textContent = "Northstar loaded with limited features. Open Startup Diagnostics in the console if this persists.";
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 5000);
    }
  }

  window.dispatchEvent(new CustomEvent("northstar:boot-complete", {
    detail: {
      status: failedModules.length ? "degraded" : "ready",
      durationMs: Math.round(performance.now() - startedAt),
      failedModules: window.NorthstarStartupDiagnostics
    }
  }));
}

await bootNorthstar();
