from pathlib import Path

path = Path('case-records.js')
text = path.read_text()

old = '''function hasSessionAccess(encounter) {
  if (!isConfidential(encounter)) return true;
  if (!encounter.authorizationHash || isPermanentlyLocked(encounter)) return false;
  return sessionStorage.getItem(accessKey(encounter)) === encounter.authorizationHash;
}

function grantSessionAccess(encounter) {
  if (encounter.authorizationHash) sessionStorage.setItem(accessKey(encounter), encounter.authorizationHash);
}'''
new = '''function authorizationSessionToken(encounter) {
  return `${encounter.authorizationHash || ""}:${Number(encounter.authorizationEpoch || 0)}`;
}

function hasSessionAccess(encounter) {
  if (!isConfidential(encounter)) return true;
  if (!encounter.authorizationHash || isPermanentlyLocked(encounter)) return false;
  return sessionStorage.getItem(accessKey(encounter)) === authorizationSessionToken(encounter);
}

function grantSessionAccess(encounter) {
  if (encounter.authorizationHash) sessionStorage.setItem(accessKey(encounter), authorizationSessionToken(encounter));
}'''
if old not in text:
    raise SystemExit('session access marker not found')
text = text.replace(old, new, 1)

marker = '''    </dialog>`);

  document.querySelector("#caseAuthorizationForm")?.addEventListener("submit", submitAuthorization);'''
replacement = '''    </dialog>

    <dialog id="caseAdminUnlockDialog" class="modal">
      <form id="caseAdminUnlockForm" class="modal-card">
        <div class="modal-header">
          <div><p class="eyebrow">Administrator Review</p><h3>Unlock Confidential Case</h3></div>
          <button class="icon-button" type="button" data-close-case="caseAdminUnlockDialog" aria-label="Close">×</button>
        </div>
        <div class="modal-body form-grid">
          <div id="caseAdminUnlockContext" class="patient-context"></div>
          <div class="case-lock-warning"><strong>Permanent lock override</strong><br>This resets the failed-attempt counter. The authorization code will still be required, and all previously authorized browser sessions will be revoked.</div>
          <label><span>Unlock reason</span><textarea id="caseAdminUnlockReason" rows="4" minlength="5" required placeholder="Document why the permanent lock is being removed"></textarea></label>
        </div>
        <div class="modal-footer">
          <button class="secondary-button" type="button" data-close-case="caseAdminUnlockDialog">Cancel</button>
          <button class="danger-button" type="submit">Remove Permanent Lock</button>
        </div>
      </form>
    </dialog>`);

  document.querySelector("#caseAuthorizationForm")?.addEventListener("submit", submitAuthorization);'''
if marker not in text:
    raise SystemExit('unlock dialog insertion marker not found')
text = text.replace(marker, replacement, 1)

text = text.replace(
    '  document.querySelector("#caseConfidentialSetupForm")?.addEventListener("submit", submitConfidentialSetup);\n  document.querySelectorAll("[data-close-case]")',
    '  document.querySelector("#caseConfidentialSetupForm")?.addEventListener("submit", submitConfidentialSetup);\n  document.querySelector("#caseAdminUnlockForm")?.addEventListener("submit", submitAdminUnlock);\n  document.querySelectorAll("[data-close-case]")',
    1
)
text = text.replace(
    '  ["caseRecordDialog", "caseAuthorizationDialog", "caseConfidentialSetupDialog"].forEach((id) => {',
    '  ["caseRecordDialog", "caseAuthorizationDialog", "caseConfidentialSetupDialog", "caseAdminUnlockDialog"].forEach((id) => {',
    1
)
text = text.replace(
    '    hash: encounter.authorizationHash || "",\n    updatedAt: encounter.updatedAt?.seconds || 0',
    '    hash: encounter.authorizationHash || "",\n    epoch: Number(encounter.authorizationEpoch || 0),\n    updatedAt: encounter.updatedAt?.seconds || 0',
    1
)

old_secondary = '''  const secondary = confidential && !hasSessionAccess(encounter)
    ? (locked ? "Access disabled pending Administrator unlock" : "Authorization code required to view case contents")
    : `${encounter.chiefComplaint || "No chief complaint entered"}${encounter.finalDiagnosis || encounter.workingDiagnosis ? ` · ${encounter.finalDiagnosis || encounter.workingDiagnosis}` : ""}`;'''
new_secondary = '''  const authorized = hasSessionAccess(encounter);
  const secondary = confidential && !authorized
    ? (locked ? "Protected case contents unavailable until Administrator unlock" : "Protected encounter details hidden — authorization required")
    : `${encounter.chiefComplaint || "No chief complaint entered"}${encounter.finalDiagnosis || encounter.workingDiagnosis ? ` · ${encounter.finalDiagnosis || encounter.workingDiagnosis}` : ""}`;
  const departmentLabel = confidential && !authorized ? "Restricted Case" : (encounter.department || "Emergency Department");
  const statusLabel = locked ? "Locked" : confidential && !authorized ? "Authorization Required" : (active ? formatStatus(encounter.status) : formatStatus(encounter.disposition || "Closed"));
  const openLabel = locked ? "Review Lock" : confidential && !authorized ? "Authorize & Open" : "Open Full Case";'''
if old_secondary not in text:
    raise SystemExit('archive secondary marker not found')
text = text.replace(old_secondary, new_secondary, 1)
text = text.replace(
    '        <span>${safe(encounter.department || "Emergency Department")}</span>\n        <strong>${safe(active ? formatStatus(encounter.status) : formatStatus(encounter.disposition || "Closed"))}</strong>',
    '        <span>${safe(departmentLabel)}</span>\n        <strong>${safe(statusLabel)}</strong>',
    1
)
text = text.replace(
    '        <button class="primary-button compact" type="button" data-open-case-record="${safe(encounter.id)}">Open Full Case</button>',
    '        <button class="primary-button compact" type="button" data-open-case-record="${safe(encounter.id)}">${safe(openLabel)}</button>',
    1
)
text = text.replace(
    '${isAdministrator() ? \'<button class="danger-button" type="button" data-admin-unlock-case>Unlock Permanent Lock</button>\' : ""}',
    '${isAdministrator() ? \'<button class="danger-button" type="button" data-admin-unlock-case>Administrator Review & Unlock</button>\' : ""}',
    1
)

security_function = r'''function renderCaseSecurity(encounter) {
  if (!isConfidential(encounter)) return "";
  const attempts = Number(encounter.failedAuthorizationAttempts || 0);
  const remaining = Math.max(0, 3 - attempts);
  const securityTypes = new Set([
    "case-marked-confidential",
    "confidential-case-code-changed",
    "confidential-case-access-granted",
    "confidential-case-authorization-failed",
    "confidential-case-permanently-locked",
    "confidential-case-admin-unlocked",
    "confidential-case-session-ended"
  ]);
  const events = state.audits
    .filter((item) => item.encounterId === encounter.id && securityTypes.has(item.type))
    .sort((a, b) => timeValue(b.at) - timeValue(a.at))
    .slice(0, 10);
  const labels = {
    "case-marked-confidential": "Case marked confidential",
    "confidential-case-code-changed": "Authorization code changed",
    "confidential-case-access-granted": "Confidential access granted",
    "confidential-case-authorization-failed": "Incorrect authorization code",
    "confidential-case-permanently-locked": "Permanent lock triggered",
    "confidential-case-admin-unlocked": "Permanent lock removed",
    "confidential-case-session-ended": "Authorized session ended"
  };
  const authorized = hasSessionAccess(encounter);
  return `
    <section class="case-security-panel">
      <div class="case-security-panel-head">
        <div><p class="eyebrow">Case Security</p><h4>Confidential Access Control</h4></div>
        <span class="case-security-state ${isPermanentlyLocked(encounter) ? "locked" : authorized ? "authorized" : "restricted"}">${isPermanentlyLocked(encounter) ? "Permanently Locked" : authorized ? "Authorized This Session" : "Restricted"}</span>
      </div>
      <div class="case-security-grid">
        <div><span>Failed Attempts</span><strong>${attempts} / 3</strong><small>${remaining} remaining before permanent lock</small></div>
        <div><span>Secured By</span><strong>${safe(encounter.confidentialMarkedByName || encounter.providerName || "Physician")}</strong><small>${safe(formatDateTime(encounter.confidentialMarkedAt))}</small></div>
        <div><span>Authorization Version</span><strong>${Number(encounter.authorizationEpoch || 0)}</strong><small>Changes revoke previous sessions</small></div>
        <div><span>Access Mode</span><strong>${authorized ? "Open in this session" : "Code required"}</strong><small>${isPermanentlyLocked(encounter) ? "Administrator intervention required" : "Case-sensitive authorization"}</small></div>
      </div>
      <div class="case-security-toolbar">
        ${canManageConfidential(encounter) ? `<button class="secondary-button compact" type="button" data-change-case-code="${safe(encounter.id)}">Rotate Authorization Code</button>` : ""}
        ${authorized ? '<button class="secondary-button compact" type="button" data-end-case-access>End My Access Session</button>' : ""}
      </div>
      <div class="case-access-history">
        <div class="case-access-history-head"><strong>Security Activity</strong><span>${events.length ? "Latest activity" : "No activity recorded"}</span></div>
        ${events.length ? events.map((item) => `<div class="case-access-event"><time>${safe(formatDateTime(item.at))}</time><div><strong>${safe(labels[item.type] || formatStatus(item.type))}</strong><span>${safe(item.actorName || "Northstar Staff")}${item.attemptNumber ? ` · Attempt ${safe(item.attemptNumber)} of 3` : ""}${item.reason ? ` · ${safe(item.reason)}` : ""}</span></div></div>`).join("") : '<div class="case-empty">No security activity has been recorded for this case.</div>'}
      </div>
    </section>`;
}

'''
if 'function renderCaseSecurity(encounter)' in text:
    raise SystemExit('security panel already installed')
text = text.replace('function renderFullCase(encounter) {', security_function + 'function renderFullCase(encounter) {', 1)
text = text.replace(
    '    ${confidentialBanner}\n    ${caseSummary(encounter, patient)}',
    '    ${confidentialBanner}\n    ${renderCaseSecurity(encounter)}\n    ${caseSummary(encounter, patient)}',
    1
)
text = text.replace(
    '      authorizationHash: hash,\n      failedAuthorizationAttempts: 0,',
    '      authorizationHash: hash,\n      authorizationEpoch: Number(encounter.authorizationEpoch || 0) + 1,\n      failedAuthorizationAttempts: 0,',
    1
)

start = text.find('async function adminUnlockSelectedCase() {')
end = text.find('\nfunction stopListeners()', start)
if start == -1 or end == -1:
    raise SystemExit('admin unlock function not found')
new_unlock = r'''function adminUnlockSelectedCase() {
  const encounter = encounterById(state.selectedEncounterId);
  const patient = encounter ? patientById(encounter.patientId) : null;
  if (!encounter || !patient || !isAdministrator() || !isPermanentlyLocked(encounter)) return;
  document.querySelector("#caseAdminUnlockForm")?.reset();
  document.querySelector("#caseAdminUnlockContext").innerHTML = `<strong>${safe(patient.lastName)}, ${safe(patient.firstName)}</strong><span>${safe(patient.mrn || "")} · ${safe(formatDateTime(encounter.arrivalAt))}</span>`;
  document.querySelector("#caseAdminUnlockDialog").showModal();
  setTimeout(() => document.querySelector("#caseAdminUnlockReason")?.focus(), 40);
}

async function submitAdminUnlock(event) {
  event.preventDefault();
  const encounter = encounterById(state.selectedEncounterId);
  if (!encounter || !isAdministrator() || !isPermanentlyLocked(encounter)) return;
  const reason = document.querySelector("#caseAdminUnlockReason").value.trim();
  if (reason.length < 5) {
    showToast("Enter a brief reason for removing the permanent lock.");
    return;
  }
  const button = event.currentTarget.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Unlocking…";
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "encounters", encounter.id), {
      failedAuthorizationAttempts: 0,
      permanentlyLocked: false,
      authorizationEpoch: Number(encounter.authorizationEpoch || 0) + 1,
      unlockedAt: serverTimestamp(),
      unlockedBy: auth.currentUser.uid,
      unlockedByName: state.profile.displayName,
      updatedAt: serverTimestamp()
    });
    batch.set(doc(collection(db, "auditEvents")), {
      type: "confidential-case-admin-unlocked",
      patientId: encounter.patientId,
      encounterId: encounter.id,
      reason,
      actorUid: auth.currentUser.uid,
      actorName: state.profile.displayName,
      at: serverTimestamp()
    });
    await batch.commit();
    revokeSessionAccess(encounter);
    document.querySelector("#caseAdminUnlockDialog").close();
    document.querySelector("#caseRecordDialog").close();
    showToast("Permanent lock removed. Authorization code is still required.");
  } catch (error) {
    console.error("Northstar admin unlock failed", error);
    showToast("Unable to unlock this case.");
  } finally {
    button.disabled = false;
    button.textContent = "Remove Permanent Lock";
  }
}

async function endSelectedCaseAccess() {
  const encounter = encounterById(state.selectedEncounterId);
  if (!encounter || !isConfidential(encounter)) return;
  revokeSessionAccess(encounter);
  try {
    const batch = writeBatch(db);
    batch.set(doc(collection(db, "auditEvents")), {
      type: "confidential-case-session-ended",
      patientId: encounter.patientId,
      encounterId: encounter.id,
      actorUid: auth.currentUser.uid,
      actorName: state.profile.displayName,
      at: serverTimestamp()
    });
    await batch.commit();
  } catch (_) { }
  document.querySelector("#caseRecordDialog").close();
  showToast("Confidential case access ended for this browser session.");
}
'''
text = text[:start] + new_unlock + text[end:]

text = text.replace(
    '["medicationAdministrations", "administrations"]\n  ].forEach',
    '["medicationAdministrations", "administrations"],\n    ["auditEvents", "audits"]\n  ].forEach',
    1
)
text = text.replace(
    '  if (event.target.closest("[data-admin-unlock-case]")) {\n    await adminUnlockSelectedCase();\n  }',
    '  if (event.target.closest("[data-admin-unlock-case]")) {\n    adminUnlockSelectedCase();\n    return;\n  }\n\n  if (event.target.closest("[data-end-case-access]")) {\n    await endSelectedCaseAccess();\n  }',
    1
)
path.write_text(text)

css_path = Path('case-records.css')
css = css_path.read_text()
css += '.case-security-panel{margin:14px 0;padding:16px;border:1px solid #d2dde4;border-radius:14px;background:linear-gradient(180deg,#fff,#f8fbfc)}.case-security-panel-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px}.case-security-panel-head h4{margin:2px 0 0}.case-security-state{display:inline-flex;align-items:center;padding:6px 10px;border-radius:999px;font-size:.75rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.case-security-state.restricted{background:#fff0bf;color:#6d5200}.case-security-state.authorized{background:#e2f4e8;color:#1d6938}.case-security-state.locked{background:#fde2e2;color:#982727}.case-security-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.case-security-grid>div{padding:12px;border:1px solid #dde7ec;border-radius:11px;background:#fff}.case-security-grid span{display:block;color:#6d7f89;font-size:.72rem;text-transform:uppercase;letter-spacing:.04em}.case-security-grid strong{display:block;margin-top:5px;color:#123a51}.case-security-grid small{display:block;margin-top:4px;color:#768994;font-size:.76rem}.case-security-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.case-access-history{margin-top:14px;border-top:1px solid #e2eaee;padding-top:12px}.case-access-history-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:7px}.case-access-history-head span{color:#70838e;font-size:.8rem}.case-access-event{display:grid;grid-template-columns:160px 1fr;gap:12px;padding:8px 0;border-bottom:1px solid #edf1f3}.case-access-event:last-child{border-bottom:0}.case-access-event time{color:#71838e;font-size:.78rem}.case-access-event strong{display:block;color:#173e54;font-size:.86rem}.case-access-event span{display:block;color:#6a7d88;font-size:.78rem;margin-top:2px}@media(max-width:800px){.case-security-panel-head{align-items:flex-start;flex-direction:column}.case-security-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.case-access-event{grid-template-columns:1fr}}@media(max-width:520px){.case-security-grid{grid-template-columns:1fr}}'
css_path.write_text(css)

rules_path = Path('firestore.rules')
rules = rules_path.read_text()
rules = rules.replace("        'authorizationHash',\n        'failedAuthorizationAttempts',", "        'authorizationHash',\n        'authorizationEpoch',\n        'failedAuthorizationAttempts',", 1)
rules = rules.replace(
    "             && request.resource.data.get('authorizationSalt', '') != ''\n             && request.resource.data.get('failedAuthorizationAttempts', 0) == 0",
    "             && request.resource.data.get('authorizationSalt', '') != ''\n             && request.resource.data.get('authorizationEpoch', 0) == resource.data.get('authorizationEpoch', 0) + 1\n             && request.resource.data.get('failedAuthorizationAttempts', 0) == 0",
    1
)
rules = rules.replace("               'authorizationHash',\n               'failedAuthorizationAttempts',", "               'authorizationHash',\n               'authorizationEpoch',\n               'failedAuthorizationAttempts',", 1)
rules = rules.replace(
    "             && request.resource.data.get('failedAuthorizationAttempts', -1) == 0\n             && request.resource.data.diff(resource.data).affectedKeys().hasOnly([",
    "             && request.resource.data.get('failedAuthorizationAttempts', -1) == 0\n             && request.resource.data.get('authorizationEpoch', 0) == resource.data.get('authorizationEpoch', 0) + 1\n             && request.resource.data.diff(resource.data).affectedKeys().hasOnly([",
    1
)
rules = rules.replace("               'permanentlyLocked',\n               'unlockedAt',", "               'permanentlyLocked',\n               'authorizationEpoch',\n               'unlockedAt',", 1)
rules_path.write_text(rules)
