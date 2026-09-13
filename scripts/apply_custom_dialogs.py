from pathlib import Path

replacements = {
    "admin-controls.js": [
        (
            'if (!window.confirm(`Restore ${patient.firstName || "this patient"} ${patient.lastName || ""} to active vital status?`)) return;',
            'if (!await window.NorthstarDialog.confirm({title:"Restore Patient Vital Status",message:`Restore ${patient.firstName || "this patient"} ${patient.lastName || ""} to active vital status?`,confirmText:"Restore Active Status",cancelText:"Cancel",tone:"warning"})) return;'
        )
    ],
    "deceased-access.js": [
        (
            'if (!window.confirm(`Restore ${patient.firstName || "this patient"} ${patient.lastName || ""} to active status and remove deceased-record restrictions?`)) return;',
            'if (!await window.NorthstarDialog.confirm({title:"Restore Deceased Record",message:`Restore ${patient.firstName || "this patient"} ${patient.lastName || ""} to active status and remove deceased-record restrictions?`,confirmText:"Restore Record",cancelText:"Cancel",tone:"danger"})) return;'
        )
    ],
    "northstar-scenario-director.js": [
        (
            'const cue=prompt("Observable finding for clinical staff:");',
            'const cue=await window.NorthstarDialog.prompt({title:"Send Clinical Finding",message:"Enter the observable finding that clinical staff should receive.",label:"Observable finding",placeholder:"Describe the change in the patient’s condition",required:true,multiline:true,confirmText:"Send Finding",cancelText:"Cancel"});'
        )
    ],
    "northstar-clinical-plus.js": [
        (
            'if(!isAdmin()||sourceId===targetId)return; const source=patientById(sourceId),target=patientById(targetId); if(!source||!target)return; if(!window.confirm(`Merge ${source.mrn} into ${target.mrn}? The source record will be retired and all linked cases will move to the target patient.`))return;',
            'if(!isAdmin()||sourceId===targetId)return; const source=patientById(sourceId),target=patientById(targetId); if(!source||!target)return; if(!await window.NorthstarDialog.confirm({title:"Merge Patient Records",message:`Merge ${source.mrn} into ${target.mrn}? The source record will be retired and all linked cases will move to the target patient.`,confirmText:"Merge Records",cancelText:"Cancel",tone:"danger"}))return;'
        ),
        (
            'if(items.length&&window.confirm(`Sign ${set.dataset.orderSet} with ${items.length} orders?`))await createOrders(items);return;',
            'if(items.length&&await window.NorthstarDialog.confirm({title:"Sign Order Set",message:`Sign ${set.dataset.orderSet} with ${items.length} orders?`,confirmText:"Sign Orders",cancelText:"Cancel"}))await createOrders(items);return;'
        )
    ],
    "northstar-breakglass.js": [
        (
            'const reason=prompt("Emergency access reason (required):");',
            'const reason=await window.NorthstarDialog.prompt({title:"Emergency Break-Glass Access",message:"Document why emergency access to this confidential case is required. Access will be temporary and audited.",label:"Emergency access reason",placeholder:"Describe the clinical need for emergency access",required:true,minLength:8,multiline:true,confirmText:"Grant Emergency Access",cancelText:"Cancel",tone:"warning"});'
        )
    ],
    "northstar-enterprise.js": [
        (
            'const mrn=prompt(`Enter ${p?.lastName||"patient"}\'s MRN to verify specimen collection:`);',
            'const mrn=await window.NorthstarDialog.prompt({title:"Verify Patient Before Collection",message:`Verify ${p?.lastName||"the patient"} before specimen collection.`,label:"Medical Record Number",placeholder:"NMC-100001",required:true,confirmText:"Verify & Collect",cancelText:"Cancel"});'
        )
    ]
}

for filename, pairs in replacements.items():
    path = Path(filename)
    text = path.read_text()
    for old, new in pairs:
        if old not in text:
            raise SystemExit(f"Expected native-dialog call not found in {filename}: {old[:100]}")
        text = text.replace(old, new, 1)
    path.write_text(text)

print("Replaced all known Northstar native browser dialogs.")
