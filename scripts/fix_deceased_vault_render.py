from pathlib import Path

path = Path('deceased-access.js')
text = path.read_text()
old = '''  let panel = body.querySelector("#deceasedVaultPanel");
  if (!panel) { panel = document.createElement("section"); panel.id = "deceasedVaultPanel"; body.prepend(panel); }
  const access = grantedUids(patient);
  panel.className = `deceased-vault-panel ${isAdmin() ? "admin" : "authorized"}`;
  panel.innerHTML = `<div class="deceased-vault-head"><div><strong>CONFIDENTIAL DECEASED RECORD</strong><span>${isAdmin() ? "Administrator access · you control which staff members may open this complete patient account." : "Access to this complete deceased patient account was granted by an Administrator."}</span></div><span class="deceased-vault-badge">Restricted</span></div><div class="deceased-vault-actions"><small>${isAdmin() ? `${access.length} non-administrator staff member${access.length === 1 ? "" : "s"} currently authorized` : "Do not share or leave this record unattended."}</small>${isAdmin() ? `<button class="secondary-button compact" type="button" data-manage-deceased-access="${safe(patient.id)}">Manage Record Access</button>` : ""}</div>`;'''
new = '''  let panel = body.querySelector("#deceasedVaultPanel");
  if (!panel) { panel = document.createElement("section"); panel.id = "deceasedVaultPanel"; body.prepend(panel); }
  const access = grantedUids(patient);
  const signature = [patient.id, isAdmin() ? "admin" : "authorized", access.join(","), patient.deceasedAt?.seconds || patient.deceasedAt || ""].join("|");
  if (panel.dataset.signature === signature) return;
  panel.dataset.signature = signature;
  panel.className = `deceased-vault-panel ${isAdmin() ? "admin" : "authorized"}`;
  panel.innerHTML = `<div class="deceased-vault-head"><div><strong>CONFIDENTIAL DECEASED RECORD</strong><span>${isAdmin() ? "Administrator access · you control which staff members may open this complete patient account." : "Access to this complete deceased patient account was granted by an Administrator."}</span></div><span class="deceased-vault-badge">Restricted</span></div><div class="deceased-vault-actions"><small>${isAdmin() ? `${access.length} non-administrator staff member${access.length === 1 ? "" : "s"} currently authorized` : "Do not share or leave this record unattended."}</small>${isAdmin() ? `<button class="secondary-button compact" type="button" data-manage-deceased-access="${safe(patient.id)}">Manage Record Access</button>` : ""}</div>`;'''
if old not in text:
    raise SystemExit('vault render block not found')
path.write_text(text.replace(old, new, 1))
