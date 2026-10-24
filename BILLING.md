# Northstar Medical Center — Billing & Revenue

## Scope
Northstar Billing & Revenue is a **simulation** accounting workflow for the hospital roleplay platform. It **does not** charge payment cards, verify eligibility, submit real insurance claims, move funds, issue tax receipts, or replace a real medical billing application.

## Where to find it
After signing in with an authorized account, select **Administration → Billing & Revenue** in the left sidebar. Permission-controlled roles can search encounter-linked invoices, review outstanding patient/insurer balances, examine itemized charges and audit entries, print a simulated invoice, and discover older discharged encounters that have no invoice.

### At discharge
A provider closing an encounter from the patient chart is prompted for a **required billing disposition**:
- **Patient billed:** total charge is assigned to the patient.
- **Insurance estimate:** expected insurer share is shown as a pending estimate and not marked paid.
- **Split:** expected insurance share, waiver and patient responsibility are apportioned; their sum cannot exceed the encounter charge.
- **Fully waived:** zero patient responsibility with a mandatory documented waiver reason.

The invoice is created in the **same Firestore batch** as the encounter closure and patient status update. The independent Discharge Center's Finalize action also requires the billing dialogue and commits the discharge, plan status and invoice together. Cancelling this dialogue does not close the encounter.

### Billing page
- Search by patient, invoice, insurer and encounter ID.
- Filter invoices by open, insurance pending, partially paid, paid and waived.
- Display total invoiced charges, estimated insurance balance and outstanding patient balances.
- View an itemized invoice and printable summary.
- Record **simulated** patient payments and insurer remittances with amounts and reasons.
- Change expected insurance coverage or mark claim submitted, pending, approved, denied or paid.
- Apply authorized waivers and adjust patient balances.
- Add itemized charges and internal financial notes.
- Review append-only ledger events.
- Generate an invoice for older discharged encounters that lack one.

On an insurer denial, the unreceived estimated coverage is moved into the patient portion. This is a financial **simulation**, not an eligibility or adjudication determination.

## Permissions
- Billing access: active administrators, physicians, registration staff or employees granted `billingAccess`.
- Billing management and adjustments: administrators or users with `billingManage`.
- Initial billing at discharge: authorized providers, or billing managers for retrospective invoices.
- Billing records, collection activity and adjustments are secured with `firestore.rules`.

These settings are exposed in Northstar's staff permissions area. Existing account permissions may need explicit updating to grant billing management.

## Data
`billingAccounts/{encounterId}` tracks the unique invoice, itemized charges, insurer estimate/received amounts, authorized write-offs, patient responsibility, payments, outstanding balances, claim status, waiver authorization and simulated status. `billingAccounts/{encounterId}/events/{eventId}` is the append-only financial activity log. Patient/encounter IDs link the records for full approved patient removal via the server-side cascading deletion flow.

## Deployment
Publishing to GitHub Pages updates the website **only**. You must also deploy new Firestore rules for the billing page to read, create or update records:

```powershell
git pull origin main
firebase deploy --only firestore:rules --project doctor-rp
```

Alternatively use `./scripts/deploy-northstar.ps1` to deploy rules and existing Cloud Functions. This script requires the Firebase CLI and a project account with deployment permissions.

## Test expectations
- JavaScript syntax and browser smoke checks
- Billing calculations for patient, insurer, split and waived amounts
- Firestore emulator checks for authorized invoice creation, forbidden unauthorized reads/changes, and immutable activity events
- Manual signed-in checks for chart discharge, Discharge Center finalization and payment posting

**Never use this simulator for real patient financial obligations or claims without a real secured backend, authorization and regulatory review.**
