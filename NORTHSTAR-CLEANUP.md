# Northstar 4.1 — Major Cleanup & Reliability

This update is **non-destructive**. It changes presentation, navigation, subscription lifecycle, and diagnostics. There are no Firestore schema migrations, new Cloud Functions, deleted collections, or modified billing calculations.

## Navigation

- Restored late-loading module shortcuts (Emergency Intake, SIU, Operations, Shift Tasks, Preferences) are inserted into their **correct collapsible group content**, rather than floating outside the group.
- Staff can now type directly in the sidebar search box to filter existing links; the search opens relevant groups temporarily, preserves their previous collapsed states, and shows a useful empty state.
- The global quick finder stays available with **Ctrl/Cmd+K** or **Enter in the sidebar search**. It excludes role-restricted workspaces.
- A single `canOpenWorkflow` guard is used by navigation, page opening, and global finder. It reacts to current staff permissions.

## Firebase reliability

- The enterprise controller now tracks base Firestore subscriptions and unsubscribes when the signed-in account changes or signs out.
- The active staff profile is monitored, so role changes or account suspension affect available workspaces without requiring the user to reload.
- Incoming Firestore snapshots schedule one animation-frame redraw instead of rebuilding the same workspace repeatedly in a burst.
- If an active workspace cannot access a collection, a visible **Data may be incomplete** warning appears. It disappears when loading recovers.
- Unrelated patient, billing, and clinical records are not modified.

## Visual cleanup

- `northstar-cleanup.css` provides scoped consistency for the sidebar, metrics, tabs, cards, form controls, hover/focus states, and long work queues.
- Mobile forms display in one column, action controls adapt to narrow screens, and content overflows wrap rather than clipping.
- Departmental forms preserve entered patient/encounter selections, cursor focus and search text during realtime refreshes.
- Layout changes respect reduced-motion settings and keep the existing light/navy Northstar theme.

## Verification

The repository's **Validate Northstar application** action checks JS modules, full-page workspaces, existing billing and clinical UI, Firestore security rules, and the repaired navigation search and feature shortcuts.

## Deployment

GitHub Pages publishes this frontend-only change automatically from `main`. Refresh the browser with **Ctrl + Shift + R** once Pages has finished.

**No new Firestore rules or functions need deploying for the 4.1 cleanup alone.** If Northstar 4.0 backend functions/rules have not already been deployed, the departments still require that separate deployment:

```powershell
git pull origin main
firebase deploy --only "firestore:rules,functions" --project doctor-rp
```

The older application still contains a number of independent UI modules and stylesheets; this cleanup reduces their integration problems but is not an exhaustive rewrite of all modules. Refactoring legacy features should continue incrementally with tests to preserve users' records and operational workflows.
