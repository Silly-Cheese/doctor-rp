# Northstar — Donation & Giving Ledger

**Scope:** Doctor-RP simulation only. Integrates into the existing **Billing & Revenue** page; does not create a new navigation page, contact payment gateways or issue real financial obligations.

## Recording a donation

Open **Billing & Revenue → Donations and Gifts → Record donation**. Select the donor name, optionally link the gift to an existing patient, enter the amount and purpose.

Choose one of the following statuses:

- **Received:** Staff confirm a fictional cash, check, external transfer or other receipt. The gift immediately increases **Total collected** and **Donation revenue**. It does **not** affect medical charges, insurer receipts or patient invoice balances.
- **Requested / pledged:** A planned or requested gift. It appears in **Requested / pledged** but does **not** contribute to collected revenue. Authorized billing staff can later use **Mark received**.

Authorized billing staff can cancel unreceived requests with a reason. Administrators can reverse received gifts with a reason; they then stop contributing to the collected total. Reversals and cancellations retain the original record. A corresponding entry is written to the existing Firestore `auditEvents` collection.

Each donation has a printable statement/receipt with staff and donor signature spaces and a simulation disclaimer. The ledger has a CSV export (all states included for reconciliation).

## Revenue behavior

- Clinical collected = patient payments + insurer receipts from issued medical invoices.
- Received donations = sum of donation records in `nmcDonations` with `status == 'received'`.
- **Total collected = clinical collected + received donations.**
- Requested pledges, cancelled gifts and reversed donations count as $0 collected.
- Medical **Total charges** and individual patient or insurer invoice balances remain unchanged.

## Deployment

Changes are committed to the repository's default branch. Static site updates deploy through the configured GitHub Pages workflow. The new donation collection will be inaccessible until **Firestore rules** are deployed:

```powershell
git pull origin main
firebase use doctor-rp
firebase deploy --only firestore:rules
```

This feature does not require new Cloud Functions or Storage rules.

## Validate

Run:

```powershell
node scripts/check-donation-revenue.mjs
```

The GitHub Actions patient-workflows suite also runs this test on relevant changes.

After deploying Firestore rules, verify with a billing-manager account:

1. Record a simulated **pledge** of $125 and confirm Total collected does not change.
2. Mark it **received** and confirm Total collected and Donation revenue increase by $125.
3. Print its acknowledgment and confirm the donation-specific signature areas and simulation notice.
4. Reverse it as an administrator, provide a reason, and confirm Total collected returns to its previous value.
5. Confirm the patient's existing medical invoices and payment balances did not change.
6. Verify restricted billing staff cannot create or update donations.
7. Export the donations CSV; confirm it includes the received, pledged and reversed statuses.

## Important limitations

This is a roleplay donation ledger. It **does not collect real funds**, assess legal charitable-deduction status, generate a real financial receipt, or guarantee real accounting compliance. Statuses reflect authorized staff-entered simulated receipts. Only administrators can reverse an already received donation. Check-in, patient intake and medical service billing still use their existing systems.

The GitHub commits and static tests do **not** prove the Firebase rules have been deployed or the full web interface has passed live browser testing.
