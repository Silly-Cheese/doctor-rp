# Northstar 4.0 — Integrated Hospital Departments

Northstar 4.0 adds five role-controlled, full-page operational workspaces while retaining all existing patients, encounters, pharmacy records, orders, billing invoices and staff accounts.

## Clean navigation

Existing sidebar links are organized into explicit, collapsible **Care, Diagnostics, Flow, Departments, Operations, Administration** groups. Departments are kept together. Roles determine which links are visible and which collections may be accessed.

Each page has the same summary metrics, **Work queue / New record / Connected work** tabs, filtered lists, inline forms, status selectors and mobile-responsive layout. Incoming Firestore snapshots preserve the active tab and unsaved input.

## New departments

1. **Surgical & Perioperative Center:** Schedule a simulated case against an existing patient + encounter; track room, priority, owner, consent documentation, preoperative readiness, anesthesia consultation, recovery plan and lifecycle status. On creation, the `northstarV4PrepareSurgery` Cloud Function creates exactly one sterile-readiness request and one transport request using deterministic document IDs. The trigger is idempotent and does not administer medications, complete procedures or post charges.
2. **Infection Prevention:** Log patient-linked precaution reviews with category, reason, and follow-up status. Existing lab results are displayed for context. No real pathogen surveillance or clinical decision support is performed.
3. **Central Sterile Processing:** Register instrument trays, track decontamination/sterilization/inspection/availability, and update linked surgical preparation requests.
4. **Transport & Dispatch:** Create and assign patient movements with origin, destination, priority and handoff status; surgery creates a linked request automatically once backend Functions are deployed.
5. **Pharmacy & Dispensing:** Select an existing medication order from the patient's encounter, request dispensing, track verification and dispensing status independently of medication administration. Authorized pharmacy staff can register stock and adjust quantity with a required reason and immutable audit event.

## Security and records

The new Firestore collections are `nmcSurgicalCases`, `nmcInfectionReviews`, `nmcSterileTrays`, `nmcSterileRequests`, `nmcTransportRequests`, `nmcPharmacyDispenses`, `nmcPharmacyStock`, and the append-only `nmcDepartmentAudit`.

Writes are restricted to active roles. Staff operations use an atomic write batch containing the record and a matching immutable audit event. Patient-linked records validate the corresponding patient and encounter. Deletions are not allowed for these operational collections. The **Pharmacist** role is now selectable during account registration and administrator role assignment.

Existing Firestore documents are not moved or overwritten.

## Publishing the release

GitHub Pages only publishes HTML/CSS/JS. **Firestore rules and Cloud Functions must be deployed separately**, using an authenticated terminal inside the repository:

```powershell
git pull origin main
firebase deploy --only "firestore:rules,functions" --project doctor-rp
```

If Functions require a billing-enabled Firebase project or upgraded dependencies, resolve those CLI prerequisites before deploying.

Until rules deploy, the new workspaces will show permission errors when saving; until the function deploys, newly scheduled surgical cases will **not** automatically create sterile and transport requests. No live Firestore writes have been performed by the code changes themselves.

## Validation

GitHub Actions `Validate Northstar application` checks source code, browser startup, five departmental page layouts, narrow-screen behavior, patient/encounter consistency and Firestore emulator permissions.

After deploying, verify with disposable simulation records:

- Register a simulated surgical case and confirm exactly one linked sterile request and transport request;
- Update sterile readiness and transport stage, then review the audit collection;
- Request pharmacy dispensing from a valid medication order; test an invalid mismatched order;
- Register inventory, adjust quantity, confirm reason and immutable audit;
- Confirm unauthorized roles cannot read or change restricted department records;
- Test 390px mobile and desktop views without clipped forms or horizontal scroll;
- Verify the existing discharge, clinical order, billing and patient flows are unchanged.

These features are **simulation workflows**. Real-world patient portals, anesthesia records, surgical safety protocols, dose calculation, real billing/insurance processing and advanced role/guardian verification are not implemented by this release.
