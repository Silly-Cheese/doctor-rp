# Northstar Medical Center — Insurance Invoice Verification

This feature adds a standalone, public-facing **verify.html** page for medical insurance invoice checking. Insurance representatives do **not** need a Northstar staff login, customer account, or Firebase Authentication account.

## Required launch steps after merging the pull request

1. Publish the repository's root folder through **GitHub Pages** (Settings → Pages → Deploy from a branch → `main` → `/(root)`) if not already configured. After GitHub Pages publishes, the route is `https://silly-cheese.github.io/doctor-rp/verify.html` unless the project uses a custom domain or different Pages base path.
2. Deploy the updated Firestore security rules from your local repository checkout, using PowerShell:
   ```powershell
   npx.cmd firebase-tools deploy --only firestore:rules --project doctor-rp
   ```
   Firebase **Functions** and Firebase **Hosting** deployments are not needed.
3. Sign in as Northstar billing staff, open **Billing & Revenue**, open an invoice, select **Insurance verification access**, and issue the code.
4. Give the insurance representative the invoice number and code through a secure channel. They enter both on `verify.html`. There is **no login** on the verification page.

## Safety model

- `billingAccounts` and `patients` remain staff-only. Public reads access a separate minimal `insuranceInvoiceVerifications` projection with line items and financial totals but **no patient name, DOB, clinical chart, diagnosis, medical notes, or encounter ID shown in the UI**.
- The public document has an unguessable 128-bit code in its Firestore ID; `list` is denied, and an exact invoice number by itself is insufficient.
- When staff edits the original invoice, the outdated snapshot fails its Firestore verification condition; refreshing reissues it. Rotating or revoking the code immediately invalidates the earlier code.
- Access expires after 30 days. The verification page does **not** submit claims or process payments.
- This software contains simulated records only. Do not put real protected health information into publicly accessible verification snapshots; real-world medical record sharing requires an appropriately designed authenticated, audited compliance solution.

## Test before using it

- Confirm a valid invoice+code returns a result in an incognito browser with no logged-in Firebase user.
- Check an incorrect code, a revoked code, an expired code, and a changed-but-not-refreshed invoice are denied.
- Confirm no anonymous listing or reading of `billingAccounts`, `patients`, or `insuranceInvoiceAccess` is possible.

Deploy and test the rules before relying on the new lookup. The feature is added by this pull request, but merges do not automatically update Firestore rules.
