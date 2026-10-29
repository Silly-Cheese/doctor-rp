# Northstar 3.0 — Integrated Hospital Operations

This release adds connected, full-page workspaces on top of the existing hospital simulation. Existing patients, invoices, orders, staff, and SIU cases remain in their original collections.

## Phase 1 — Reliability & Integration
- Shared analytics for patient timelines, flow, discharge readiness, revenue, inventory, and record integrity.
- Record Integrity full-page workspace: missing patient/encounter references, mismatches, duplicate MRNs. Findings are advisory; no automatic deletion or merging.
- Two protected callable functions: northstarV3Integrity (administrator only) and northstarV3BillingAudit (administrator or billing manager). These functions read bounded datasets and NEVER modify patient or invoice records. Results indicate when coverage is incomplete.
- New operational Firestore records have explicit allowed fields, role restrictions, timestamps, status transitions, and no client-side deletes.

## Phase 2 — Clinical & Financial Intelligence
- Patient Command Center: patient and encounter selectors, unified timeline of orders, results, notes, procedures, medication administrations, admissions, EMS, and tasks; discharge readiness indicators and billing access controlled by role.
- Hospital Flow 3.0: live encounter census, waiting and critical queues, room occupancy, incoming EMS, and existing module navigation.
- Revenue Intelligence: receivable aging, unbilled discharged encounters, unpriced clinical entries, negative balances and invoice line-item discrepancies. Review flags before financial adjustments. These dashboards are read-only.

## Phase 3 — Hospital Operations
- Quality & Safety: administrator-managed corrective action register (not confidential SIU case storage).
- Staff Scheduling: administrator-assigned simulation shifts for active staff, with department, dates, time and status. Not connected to payroll.
- Equipment & Inventory: equipment lifecycle and maintenance follow-up tied to existing supplies/low-stock summaries.
- Training Academy: administrator-assigned learning tasks and progress alongside existing simulation run counts. No accreditation claims.
- Patient Portal Preview: internal, administrator-only preview of patient visit and statement counts. No patient or guardian external access is provided. A real external portal requires independently secured identities, consent and linked records.

## Deployment
GitHub Pages deploys JavaScript, CSS and HTML but NOT Firebase security rules or Cloud Functions.
From an authenticated PowerShell session in the repository directory, deploy both:

    git pull origin main
    firebase deploy --only "firestore:rules,functions" --project doctor-rp

Until that deployment, the new quality, equipment, staffing, and training writes may report permissions errors and the two server scans will not be callable.

Validate the changes using GitHub Actions: Validate Northstar application (syntax, browser startup, Firestore emulator).

## Boundaries
The new dashboards do not move records or execute destructive changes. The server scans use up to 500 documents per collection, which may not cover the full database. More advanced backend transactional discharge, real patient/family external access, automated medical decision support and complete credentials verification remain future deeper work.
These systems operate only within the hospital roleplay simulation.