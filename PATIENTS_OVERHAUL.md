# Northstar Patient Workflow Overhaul — October 2026

This upgrade **keeps the original Patients navigation item and the existing `patientsSection`**. It does not create or replace the patient registry, nor migrate/decommission existing patients or encounters.

## Features implemented

- **Reception check-in:** The existing Patients section contains a collapsible Reception Check-In desk. Search by exact DOB or name, choose a matching patient, and confirm identity before creating an encounter. Normal name-based check-in requires a Reception name search. The existing unidentified-emergency flow is available by shortcut and can use a temporary MRN.
- **Safer encounter creation:** A Firestore transaction checks the current patient, existing active encounter pointer, deceased status, and entered verification data before writing the encounter, patient pointer and audit entry together.
- **Reception checklist:** Records arrival category, optional front-desk note, contact-review status, and interpreter request with the encounter.
- **Registry improvements:** Summary metrics, flexible patient search, status filters, sorting, responsive layout.
- **Contact corrections:** Authorized staff may update phone/emergency contact from inside the patient chart. Audited; no identity fields changed.
- **Medical records:** Text-based encounter notes and longitudinal records live in `patients/{patientId}/recordDocuments`. Append-only amendments preserve older versions. Visit-summary drafts must be reviewed and saved by staff; TXT export available.
- **Attachment vault:** Private roleplay PDFs, PNGs, JPGs and TXT files up to 5 MB stored at `rp-patient-documents/{patientId}/{attachmentId}/file` in Firebase Storage. Metadata lives in `patients/{patientId}/attachments`. New file versions preserve old ones. Archive hides records logically but does not delete stored bytes.
- **Identity quality:** Completeness signals, potential duplicate name/DOB warnings and non-destructive review flags under `patients/{patientId}/identityReviews`. Administrators can resolve or dismiss reviews; **patients are never merged automatically**. The original emergency identity resolution process is preserved.
- **Admin integrity diagnostics:** In-place read-only `northstarV3Integrity` Cloud Function monitor to detect missing parent/encounter links and duplicate MRNs. Existing backend limits scan size and reports incomplete results.
- **New MRN lock:** Standard registration also creates `patientMrns/{mrn}` in the same Firestore batch, with a create-only rule preventing collisions between newly registered standard patients.

## Deployment

After pulling the latest `main` branch:

```powershell
git pull origin main
firebase use doctor-rp
firebase deploy --only firestore:rules,storage,functions
```

Ensure the Firebase Storage bucket for `doctor-rp` is enabled and that the Firebase CLI has permissions to deploy Firestore, Cloud Storage and Cloud Functions. Storage rules call Firestore, and the first cross-service rules deployment might require approval of a Firebase service-account IAM permission. The Firebase CLI will prompt if required.

GitHub Pages publishes static UI/JS/CSS from the repository; Firebase rules, Cloud Functions and bucket configuration require separate deployment.

## Validation

```powershell
node scripts/check-patient-workflows.mjs
```

The GitHub Actions workflow `.github/workflows/northstar-patients-smoke.yml` also checks the original Patients page element IDs, essential modules and JavaScript syntax on applicable pushes and pull requests.

## Integrity and limitations

- Keep all data fictional: this system is for roleplay and **not** actual clinical care, storage of real patient medical records, or real medical decision-making.
- Existing patients, encounters, clinical orders, SIU cases and invoices are not deleted or migrated.
- The original repository has many interacting modules. Static syntax checks do **not** validate the entire live Firebase data model, each staff role, the deployed security rules, or live browser behavior.
- The attachment upload completes before its metadata is written. If metadata indexing fails, an orphaned Storage object may require administrator cleanup.
- The MRN lock protects **new standard patient registrations**; earlier historical records are not backfilled into the lock collection.
- The suspected duplicate review deliberately does not perform an automatic merge, to avoid breaking links across billing, orders, clinical data and confidential charts.
- Confidential patient records remain subject to the existing restrictions. Some staff may see a restricted-record message rather than the document and attachment repository.
- If the Firebase Storage bucket is not provisioned or cross-service permissions are not enabled, uploads and downloads will fail until configured.
- Do not deploy untested changes to a real medical workflow; this project is a Doctor-RP simulation.

## Smoke test checklist

1. Sign in as Registration and open the **existing** Patients page. Confirm only one Patients navigation item exists.
2. Find an existing patient using DOB, select the result, confirm identity and check in. Verify one encounter and one audit record.
3. Repeat with Reception name search. Try a wrong DOB and confirm it is rejected.
4. Test deceased, unidentified and already-checked-in patients through the correct workflows.
5. Check contact updates are saved and audited without changing the patient's identity.
6. Open a patient chart, add a note, amend it, review previous versions and export TXT.
7. Upload/download a fictional file, add a version and archive metadata. Verify unauthorized roles and confidential chart restrictions.
8. Flag a possible duplicate and resolve/dismiss the review as an administrator.
9. Run the read-only integrity scanner and check its limits/incomplete-results notice.
10. Recheck existing orders, discharge, billing, SIU and emergency intake before declaring the entire system verified.
