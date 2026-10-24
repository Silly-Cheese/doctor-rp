# Northstar deployment and verification

The public website runs on **GitHub Pages**, which deploys HTML, JavaScript and CSS only. **Firebase Firestore rules and Cloud Functions are a separate deployment.**

## Frontend
GitHub Pages automatically deploys commits to the configured publishing branch. Verify **both** workflows under [Actions](https://github.com/Silly-Cheese/doctor-rp/actions): **pages build and deployment** and **Validate Northstar application**. The latter checks JavaScript syntax, asset references, Chromium browser startup and Firestore authorization in the emulator.

## Backend
From a local PowerShell session authenticated with `firebase login`, run:

```powershell
git pull origin main
./scripts/deploy-northstar.ps1
```

The script targets **doctor-rp** explicitly, validates the frontend project ID and deploys Firestore rules and Cloud Functions. It does not upload or alter GitHub Pages assets.

In Northstar, open **System Status** using **Quick actions**. Under **Firebase Functions**, the status should show **Connected** and a server version when the authenticated health function is deployed. If the endpoint cannot be contacted, it displays a diagnostic error instead.

## Patient record protection

Client-side deletion of patient documents remains denied in Firestore. Existing patient records and historical data are unaffected by the removal of retired administration controls. Removing a frontend feature does not automatically remove previously deployed Cloud Functions; follow the deployment instructions for retiring old function endpoints.

## Validation boundaries
Passing browser startup and emulator tests does not prove every authenticated clinical workflow. Verify patient registration, identity resolution, procedures, staff permission editing, SIU submissions and approvals in a staging/demo account.
