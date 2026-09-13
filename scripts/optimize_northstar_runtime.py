from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"{label} not found in {path}")
    p.write_text(text.replace(old, new, 1))

# Clinical chart / MAR performance and duplicate-action repair.
path = "northstar-clinical-plus.js"
old = '''  const bannerActions = body.querySelector(".chart-actions");
  if (bannerActions && !bannerActions.querySelector("[data-print-wristband]")) {
    if (canWristband()) bannerActions.insertAdjacentHTML("afterbegin", `<button class="secondary-button" type="button" data-print-wristband="${safe(patient.id)}">Print Wristband</button>`);
    bannerActions.insertAdjacentHTML("afterbegin", `<button class="secondary-button" type="button" data-identity-safety="${safe(patient.id)}">Identity & Safety</button>`);
    const active = activeEncounterForPatient(patient.id); if (active && isProvider()) bannerActions.insertAdjacentHTML("beforeend", `<button class="secondary-button" type="button" data-order-catalog="${safe(active.id)}">Order Catalog</button>`);
  }'''
new = '''  const bannerActions = body.querySelector(".chart-actions");
  if (bannerActions) {
    if (canWristband() && !bannerActions.querySelector("[data-print-wristband]")) {
      bannerActions.insertAdjacentHTML("afterbegin", `<button class="secondary-button" type="button" data-print-wristband="${safe(patient.id)}">Print Wristband</button>`);
    }
    if (!bannerActions.querySelector("[data-identity-safety]")) {
      bannerActions.insertAdjacentHTML("afterbegin", `<button class="secondary-button" type="button" data-identity-safety="${safe(patient.id)}">Identity & Safety</button>`);
    }
    const active = activeEncounterForPatient(patient.id);
    if (active && isProvider() && !bannerActions.querySelector(`[data-order-catalog="${CSS.escape(active.id)}"]`)) {
      bannerActions.insertAdjacentHTML("beforeend", `<button class="secondary-button" type="button" data-order-catalog="${safe(active.id)}">Order Catalog</button>`);
    }
    const identityButtons = [...bannerActions.querySelectorAll("[data-identity-safety]")];
    identityButtons.slice(1).forEach(button => button.remove());
    const wristbandButtons = [...bannerActions.querySelectorAll("[data-print-wristband]")];
    wristbandButtons.slice(1).forEach(button => button.remove());
  }'''
replace_once(path, old, new, "chart action block")

old = '''  const alerts = patient.patientAlerts || "None documented";
  const duplicate = state.patients.find(p => p.id !== patient.id && p.currentStatus !== "merged" && p.dob === patient.dob && (`${p.firstName} ${p.lastName}`.toLowerCase() === `${patient.firstName} ${patient.lastName}`.toLowerCase() || p.lastName?.toLowerCase() === patient.lastName?.toLowerCase()));
  panel.innerHTML = `<div class="chart-section-title identity-title"><div><p class="eyebrow">Identity & Safety</p><h4>Patient Safety Profile</h4></div><div class="identity-badges"><span class="code-status">${safe(patient.codeStatus || "Full Code")}</span>${patient.confidentialFlag ? '<span class="identity-alert">Restricted</span>' : ""}</div></div><div class="identity-grid"><div><span>Alias / Previous Name</span><strong>${safe(patient.alias || "None")}</strong></div><div><span>Primary Physician</span><strong>${safe(patient.primaryPhysician || "Not assigned")}</strong></div><div><span>Preferred Pharmacy</span><strong>${safe(patient.preferredPharmacy || "Not documented")}</strong></div><div class="identity-alert-cell"><span>Patient Alerts</span><strong>${safe(alerts)}</strong></div><div class="identity-wide"><span>Advance Directives</span><strong>${safe(patient.advanceDirectives || "None documented")}</strong></div></div>${duplicate && isAdmin() ? `<div class="duplicate-warning"><div><strong>Possible duplicate record</strong><span>${safe(duplicate.lastName)}, ${safe(duplicate.firstName)} · ${safe(duplicate.mrn)}</span></div><button type="button" class="secondary-button compact" data-merge-records="${safe(patient.id)}" data-merge-target="${safe(duplicate.id)}">Merge Into ${safe(duplicate.mrn)}</button></div>` : ""}`;'''
new = '''  const alerts = patient.patientAlerts || "None documented";
  const duplicate = state.patients.find(p => p.id !== patient.id && p.currentStatus !== "merged" && p.dob === patient.dob && (`${p.firstName} ${p.lastName}`.toLowerCase() === `${patient.firstName} ${patient.lastName}`.toLowerCase() || p.lastName?.toLowerCase() === patient.lastName?.toLowerCase()));
  const signature = JSON.stringify([patient.id, patient.alias || "", patient.codeStatus || "Full Code", patient.primaryPhysician || "", patient.preferredPharmacy || "", alerts, patient.advanceDirectives || "", Boolean(patient.confidentialFlag), duplicate?.id || "", isAdmin()]);
  if (panel.dataset.signature === signature) return;
  panel.dataset.signature = signature;
  panel.innerHTML = `<div class="chart-section-title identity-title"><div><p class="eyebrow">Identity & Safety</p><h4>Patient Safety Profile</h4></div><div class="identity-badges"><span class="code-status">${safe(patient.codeStatus || "Full Code")}</span>${patient.confidentialFlag ? '<span class="identity-alert">Restricted</span>' : ""}</div></div><div class="identity-grid"><div><span>Alias / Previous Name</span><strong>${safe(patient.alias || "None")}</strong></div><div><span>Primary Physician</span><strong>${safe(patient.primaryPhysician || "Not assigned")}</strong></div><div><span>Preferred Pharmacy</span><strong>${safe(patient.preferredPharmacy || "Not documented")}</strong></div><div class="identity-alert-cell"><span>Patient Alerts</span><strong>${safe(alerts)}</strong></div><div class="identity-wide"><span>Advance Directives</span><strong>${safe(patient.advanceDirectives || "None documented")}</strong></div></div>${duplicate && isAdmin() ? `<div class="duplicate-warning"><div><strong>Possible duplicate record</strong><span>${safe(duplicate.lastName)}, ${safe(duplicate.firstName)} · ${safe(duplicate.mrn)}</span></div><button type="button" class="secondary-button compact" data-merge-records="${safe(patient.id)}" data-merge-target="${safe(duplicate.id)}">Merge Into ${safe(duplicate.mrn)}</button></div>` : ""}`;'''
replace_once(path, old, new, "identity signature block")

old = '''function renderVitalsTrend(body, patient) {
  let panel = body.querySelector("#vitalsTrendPanel"); if (!panel) { panel = document.createElement("section"); panel.id = "vitalsTrendPanel"; panel.className = "chart-section vitals-trend-panel"; body.appendChild(panel); }
  const p = trendPoints(patient.id);
  panel.innerHTML = `<div class="chart-section-title"><p class="eyebrow">Clinical Trends</p><h4>Vitals Over Time</h4></div><div class="trend-grid"><div><span>Heart Rate</span>${sparkline(p.map(x => x.hr))}</div><div><span>SpO₂</span>${sparkline(p.map(x => x.spo2),80,100)}</div><div><span>Respirations</span>${sparkline(p.map(x => x.rr))}</div><div><span>Temperature</span>${sparkline(p.map(x => x.temp),95,105)}</div><div><span>Pain</span>${sparkline(p.map(x => x.pain),0,10)}</div></div>`;
}'''
new = '''function renderVitalsTrend(body, patient) {
  let panel = body.querySelector("#vitalsTrendPanel"); if (!panel) { panel = document.createElement("section"); panel.id = "vitalsTrendPanel"; panel.className = "chart-section vitals-trend-panel"; body.appendChild(panel); }
  const p = trendPoints(patient.id);
  const signature = JSON.stringify([patient.id, p]);
  if (panel.dataset.signature === signature) return;
  panel.dataset.signature = signature;
  panel.innerHTML = `<div class="chart-section-title"><p class="eyebrow">Clinical Trends</p><h4>Vitals Over Time</h4></div><div class="trend-grid"><div><span>Heart Rate</span>${sparkline(p.map(x => x.hr))}</div><div><span>SpO₂</span>${sparkline(p.map(x => x.spo2),80,100)}</div><div><span>Respirations</span>${sparkline(p.map(x => x.rr))}</div><div><span>Temperature</span>${sparkline(p.map(x => x.temp),95,105)}</div><div><span>Pain</span>${sparkline(p.map(x => x.pain),0,10)}</div></div>`;
}'''
replace_once(path, old, new, "vitals signature block")

old = '''function renderDocumentation(body, patient) {
  let panel = body.querySelector("#signedDocumentationPanel"); if (!panel) { panel = document.createElement("section"); panel.id = "signedDocumentationPanel"; panel.className = "chart-section signed-documentation-panel"; body.appendChild(panel); }
  const notes = state.notes.filter(n => n.patientId === patient.id).sort((a,b) => timeValue(b.createdAt) - timeValue(a.createdAt));
  panel.innerHTML = `<div class="chart-section-title"><p class="eyebrow">Documentation Integrity</p><h4>Signed Clinical Notes</h4></div>${notes.length ? `<div class="signed-note-list">${notes.map(note => signedNote(note)).join("")}</div>` : '<div class="chart-empty"><p>No signed clinical notes.</p></div>'}`;
}'''
new = '''function renderDocumentation(body, patient) {
  let panel = body.querySelector("#signedDocumentationPanel"); if (!panel) { panel = document.createElement("section"); panel.id = "signedDocumentationPanel"; panel.className = "chart-section signed-documentation-panel"; body.appendChild(panel); }
  const notes = state.notes.filter(n => n.patientId === patient.id).sort((a,b) => timeValue(b.createdAt) - timeValue(a.createdAt));
  const addenda = state.addenda.filter(a => a.patientId === patient.id);
  const signature = JSON.stringify([patient.id, isProvider(), notes.map(n => [n.id, n.title, n.workingDiagnosis, n.note, n.plan, timeValue(n.createdAt)]), addenda.map(a => [a.id, a.noteId, a.text, timeValue(a.createdAt)])]);
  if (panel.dataset.signature === signature) return;
  panel.dataset.signature = signature;
  panel.innerHTML = `<div class="chart-section-title"><p class="eyebrow">Documentation Integrity</p><h4>Signed Clinical Notes</h4></div>${notes.length ? `<div class="signed-note-list">${notes.map(note => signedNote(note)).join("")}</div>` : '<div class="chart-empty"><p>No signed clinical notes.</p></div>'}`;
}'''
replace_once(path, old, new, "documentation signature block")

old = '''function scheduleRender(){if(state.renderQueued)return;state.renderQueued=true;requestAnimationFrame(()=>{state.renderQueued=false;renderMar();enhanceChart();});}'''
new = '''function scheduleRender(){if(state.renderQueued)return;state.renderQueued=true;requestAnimationFrame(()=>{state.renderQueued=false;const mar=document.querySelector("#northstarMarSection");if(mar&&!mar.classList.contains("hidden"))renderMar();if(document.querySelector("#patientChartDialog")?.open)enhanceChart();});}'''
replace_once(path, old, new, "clinical schedule render")

# Platform: render only the platform screen that is actually visible.
path = "northstar-platform.js"
old = '''function renderAll() {
  if (!state.profile) return;
  renderWorkstation();
  renderRooms();
  renderMessages();
  renderAlerts();
  renderControlCenter();
  renderFacilityBanner();
  document.querySelectorAll(".admin-platform-nav").forEach(n => n.classList.toggle("hidden", !isAdmin()));
}'''
new = '''function renderAll() {
  if (!state.profile) return;
  const visible = selector => {
    const node = document.querySelector(selector);
    return Boolean(node && !node.classList.contains("hidden"));
  };
  if (visible("#northstarWorkstationSection")) renderWorkstation();
  if (visible("#northstarRoomsSection")) renderRooms();
  if (visible("#northstarMessagesSection")) renderMessages();
  if (visible("#northstarAlertsSection")) renderAlerts();
  if (visible("#northstarControlSection")) renderControlCenter();
  renderFacilityBanner();
  document.querySelectorAll(".admin-platform-nav").forEach(n => n.classList.toggle("hidden", !isAdmin()));
}'''
replace_once(path, old, new, "platform visible render")

# Staff directory: do not rebuild every account card when nothing changed.
path = "admin-controls.js"
old = '''  const users = [...state.users].sort((a, b) => {
    if ((a.uid || a.id) === auth.currentUser?.uid) return -1;
    if ((b.uid || b.id) === auth.currentUser?.uid) return 1;
    return String(a.displayName || "").localeCompare(String(b.displayName || ""));
  });
  if (count) count.textContent = `${users.length} account${users.length === 1 ? "" : "s"}`;'''
new = '''  const users = [...state.users].sort((a, b) => {
    if ((a.uid || a.id) === auth.currentUser?.uid) return -1;
    if ((b.uid || b.id) === auth.currentUser?.uid) return 1;
    return String(a.displayName || "").localeCompare(String(b.displayName || ""));
  });
  if (count) count.textContent = `${users.length} account${users.length === 1 ? "" : "s"}`;
  const signature = JSON.stringify(users.map(user => [user.uid || user.id, user.displayName || "", user.requestedRole || "", user.role || "", user.status || "", user.email || ""]));
  if (list.dataset.signature === signature) return;
  list.dataset.signature = signature;'''
replace_once(path, old, new, "staff manager render signature")

# Deceased-record layer: avoid listening to staff directory for non-admins and avoid deep chart observation.
path = "deceased-access.js"
old = '''async function start(user) { stopListeners(); state.profile = null; if (!user) return; const p = await getDoc(doc(db,"users",user.uid)); if (!p.exists()) return; state.profile = { id:p.id, ...p.data() }; if (state.profile.status !== "active") return; bind("patients","patients"); bind("encounters","encounters"); bind("users","users"); scheduleRender(); }'''
new = '''async function start(user) { stopListeners(); state.profile = null; if (!user) return; const p = await getDoc(doc(db,"users",user.uid)); if (!p.exists()) return; state.profile = { id:p.id, ...p.data() }; if (state.profile.status !== "active") return; bind("patients","patients"); bind("encounters","encounters"); if (isAdmin()) bind("users","users"); scheduleRender(); }'''
replace_once(path, old, new, "deceased access listeners")

old = '''const chart = document.querySelector("#patientChartBody"); if (chart) new MutationObserver(scheduleRender).observe(chart,{childList:true,subtree:true});'''
new = '''const chart = document.querySelector("#patientChartBody"); if (chart) new MutationObserver(scheduleRender).observe(chart,{childList:true,subtree:false});'''
replace_once(path, old, new, "deceased chart observer")
