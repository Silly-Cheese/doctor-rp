# Northstar Medical Center — Billing & Revenue

## Scope
Northstar Billing & Revenue is a **simulation** accounting workflow for the hospital roleplay platform. It **does not** charge payment cards, verify eligibility, submit real insurance claims, move funds, issue tax receipts, or replace a real medical billing application.

## Editable service prices and automatic charges

In **Administration → Service Prices**, an authorized billing manager can create, edit, archive or reactivate a catalog service and its unit price. Choose from the category dropdown: Encounter / facility, Clinical orders & diagnostics, Procedures, EMS, Room costs, or Hospital services. Choose an exact Northstar service name from the dropdown, including live names from documented orders/procedures, or choose Custom service. Match rates by existing order/procedure name or code. If multiple visit rates are defined, name the intended default **Emergency Visit**.

At discharge, Northstar reads the encounter's placed non-canceled orders and completed procedures, matches them with current active prices, and generates itemized charges automatically. Unmatched services are identified, and the discharge must not finalize until their missing prices are resolved. Authorized staff can add additional catalog-priced services to the invoice. The total is calculated from item prices, not typed manually.

Each issued invoice freezes the service names, unit prices, original source IDs and pricing versions. Updating prices affects only future invoices. Catalog edits are audited and require reasons for changed prices.

## Categorized Clinical Orders (linked to billing)

Northstar's two order-entry surfaces (the patient chart's **New Clinical Order** and the advanced **Order Catalog**) now use categorized selectors sourced from the same canonical names as Service Prices: **Laboratory, Imaging & Diagnostics, Antibiotics, Other Medications, IV Fluids, Monitoring & Safety, Clinical Procedures, Consults, and Other Clinical Orders**.

Choose the group, then the specific order from the dropdown. The clinical record stores its normalized clinical category, precise service name, and current catalog ID/code if the service has a matching active rate. Clinical users can see whether the billing rate is configured **before signing**. An unpriced service remains orderable but is highlighted during discharge billing review.

Medication selections do not automatically create a prescription: the advanced order entry requests provider-entered dose, route, and frequency before signing. Existing order-set behavior remains in place.

The billing engine resolves charges by stored rate ID first, then by service code or canonical name; billing snapshots preserve the price and version used when the invoice is issued. In Billing & Revenue, staff can review collected and waived totals, overdue balances, claims that need insurer follow-up, and export a filtered-independent invoice ledger as CSV. These are all **simulated** accounting records.

## Bulk Price Setup (Labs, antibiotics, medications and more)

The **Service Prices** page now includes a **Bulk Service Pricing** workspace, above the existing rate list. It offers curated simulation-service templates for labs, imaging, diagnostics, antibiotics, other medications, IV fluids, procedures, EMS, room categories, facility visits, monitoring and general hospital services. It also includes additional exact names observed in Northstar's documented orders and procedures.

To set up a large category quickly:
1. Select a category (for example, **Antibiotics**).
2. Use **Select filtered** to select unpriced services in that category.
3. Enter a category-level unit price and choose **Apply price to selected (preview)**.
4. Adjust individual prices as desired; select **Save selected prices** to write the rates.

Bulk actions **skip existing prices by default**. Existing rates change only when **Explicitly update existing prices** is enabled. Each created or updated rate receives an audit revision. Changes to rates affect future invoices only, since historical invoices contain frozen line-item prices.

**CSV workflow:** Download the full template, enter prices for the services you want to configure, and import it. The columns are `category,kind,serviceName,price,code`. Blank prices are ignored. CSV imports are previews and do not change Firestore until **Save selected prices** is used. You can also export existing service prices for backup or updates. CSV size is limited to 2 MB and 1,500 rows; writes are committed in batches.

Northstar does **not** invent or automatically approve financial prices: staff set their own simulated rates. The medication/antibiotic name list is only a billing reference and does **not** create medication orders, default doses, or prescribing instructions.

## Patient Accounts, Advanced Filters and Administrative Waivers

Billing & Revenue groups **all invoices under each patient** by default, with a toggle for a flat invoice list. Search by patient name, invoice, insurer or encounter; filter by patient, payment status, overdue and insurer follow-up, date cutoff, minimum charges, and whether a remaining balance is owed. You can sort and export filtered invoices to CSV. Unbilled discharged encounters appear under the same patient account instead of in a separate unrelated list.

### Automatic waivers (administrators only)

Select one or more invoices or unbilled discharges with the checkboxes, or apply your filters and use **Review automatic waivers** for the filtered set. Choose whether to clear only patient balances or also unreceived insurer estimates. Review the preview, provide a written reason, and type the exact waiver confirmation shown. The client processes up to **100 records per operation**, each atomically and with an immutable audit event; partial failures are reported individually. Already received patient or insurer payments are never erased.

For a discharged encounter that has no invoice, the waiver workflow first generates a retrospective itemized invoice from its clinical services, then waives its full amount. Encounters lacking a patient record, eligible priced services, or required service catalog rates are **skipped with an explanation**, rather than silently creating invented amounts.

### Charge overrides (administrators only)

Open an invoice and choose **Override invoice charges** to replace the invoice total or correct a particular service line. Corrections appear as additional itemized entries, preserving all original services and rate snapshots. Every override requires an explanation and creates a financial audit event. Reductions below already recorded payments are rejected; recorded insurer/patient receipts are preserved and any estimates/waivers adjusted within the remaining allocated total.

Bulk waiver and charge override permissions require updated Firestore rules. A backend security check also links privileged adjustments to their immutable audit events. This is only simulation accounting, not actual medical debt adjustment.

## Printable patient statements and internal financial reports

The invoice's **Print patient statement** action now opens a self-contained, letter-sized branded statement with itemized services, quantities, rates, total charges, insurer estimate, waiver adjustment, recorded payments, and current patient responsibility. It can be printed or saved as PDF from the browser. The patient copy intentionally excludes internal notes, user IDs, and waiver-authorization reasons.

**Print internal ledger** opens a separate, clearly marked staff copy that also includes the financial adjustment history, reasons, and audit actor identifiers. Both are simulated documents and explicitly state they are not real bills.

Billing & Revenue now also includes an attention queue for overdue balances, insurer follow-up and unbilled discharged encounters; account sorting, true database reload and export to CSV. Invoice adjustments show the fields appropriate to the chosen action. Service prices configured in the charge master remain snapshots on issued invoices.

For manual additions during discharge, Northstar blocks adding a service already present in the automatically generated line items. Repeated clinical administrations should be documented as separate clinical orders rather than silently billed twice.

## Where to find it
After signing in with an authorized account, select **Administration → Billing & Revenue** in the left sidebar. Permission-controlled roles can search encounter-linked invoices, review outstanding patient/insurer balances, examine itemized charges and audit entries, print a simulated invoice, and discover older discharged encounters that have no invoice.

### Resolving unpriced clinical services without double charges

If a clinical order or procedure was documented under a different category from its billing price, Northstar now matches the **unique active rate by service name or code** across categories instead of falsely declaring it unpriced. If that service is already on the current discharge invoice as a manual charge, the system recognizes the existing entry and **does not add a duplicate**.

If no suitable price truly exists, the discharge charge-review area offers two encounter-specific options: **Set one-time charge** (with a reason and quantity one) or **Exclude from bill** (with a reason). Both resolve the warning for that clinical record without modifying the clinical chart or hospital-wide pricing catalog. Excluded services remain available for review and can be restored before discharge. The invoice preserves adjustment and exclusion reasons in its internal billing notes.

### Edit and remove individual discharge charges

Every item in the **Priced encounter services** list now has an **Edit** and **Remove** action, including automatically matched emergency visit, EMS, room, medication, and procedure charges. Edit changes the unit price and/or quantity **for this encounter only** and requires a short adjustment reason. Remove excludes the line from that patient's invoice without deleting the original clinical order or the hospital-wide price. Removed lines remain visible with **Undo** until the discharge is finalized.

The form recalculates the encounter charge, insurance estimate preview, waived amount and expected patient balance after each change. Adjustments and exclusions are preserved in the invoice's internal billing notes, with original line prices kept in item metadata. Existing issued invoices are not modified from the discharge page. At least one service line is required for a valid invoice; to reduce a single remaining charge to zero, use Edit.

### At discharge
A provider closing an encounter from the patient chart is prompted for a **required billing disposition**:
- **Patient billed:** total charge is assigned to the patient.
- **Insurance estimate:** expected insurer share is shown as a pending estimate and not marked paid.
- **Split:** expected insurance share, waiver and patient responsibility are apportioned; their sum cannot exceed the encounter charge.
- **Fully waived:** zero patient responsibility with a mandatory documented waiver reason.

The itemized invoice is created in the **same Firestore batch** as the encounter closure and patient status update. The independent Discharge Center's Finalize action also requires the billing dialogue and commits the discharge, plan status and invoice together. Cancelling this dialogue does not close the encounter.

### Billing page
- Search by patient, invoice, insurer and encounter ID.
- Filter invoices by open, insurance pending, partially paid, paid and waived.
- Display total invoiced charges, estimated insurance balance and outstanding patient balances.
- View an itemized invoice and printable summary.
- Record **simulated** patient payments and insurer remittances with amounts and reasons.
- Change expected insurance coverage or mark claim submitted, pending, approved, denied or paid.
- Apply authorized waivers and adjust patient balances.
- Add itemized charges, reverse erroneous charges with an audited correction, and add internal financial notes.
- Correct the insurer name and set a patient payment due date.
- Record simulated insurer/patient refunds, without permitting refunds larger than recorded receipts.
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
`billingAccounts/{encounterId}` tracks the unique invoice, itemized charges, insurer estimate/received amounts, authorized write-offs, patient responsibility, payments, outstanding balances, claim status, waiver authorization and simulated status. `billingAccounts/{encounterId}/events/{eventId}` is the append-only financial activity log. Patient and encounter IDs link records for accurate invoice and clinical history. Direct patient deletion remains restricted.

## Full-page navigation

Primary navigation destinations open as full-page workspaces, including Billing & Revenue, Service Prices, SIU, Operations Center, Emergency Intake, Shift Tasks and Display Preferences. Modals remain only for discrete actions such as editing prices or individual invoice details.

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

Administrators can permanently delete individual service prices with confirmation. The application also removes the rate's revisions, retains a deletion audit, and preserves previously issued invoice snapshots.
