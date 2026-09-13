from pathlib import Path
p=Path('firestore.rules')
text=p.read_text()
needle='''    match /auditEvents/{eventId} {
      allow read: if isActive();
      allow create: if isActive();
      allow update, delete: if false;
    }
'''
insert='''    match /labSpecimens/{specimenId} {
      allow read: if isActive();
      allow create, update: if isProvider() || isNurse() || isTechnician();
      allow delete: if isAdministrator();
    }

    match /imagingStudies/{studyId} {
      allow read: if isActive();
      allow create, update: if isProvider() || isNurse() || isTechnician();
      allow delete: if isAdministrator();
    }

    match /admissions/{admissionId} {
      allow read: if isActive();
      allow create: if isProvider();
      allow update: if isProvider() || isNurse() || isAdministrator();
      allow delete: if isAdministrator();
    }

    match /emsArrivals/{arrivalId} {
      allow read, create, update: if isActive();
      allow delete: if isAdministrator();
    }

    match /dischargePlans/{planId} {
      allow read: if isActive();
      allow create, update: if isProvider();
      allow delete: if isAdministrator();
    }

    match /procedures/{procedureId} {
      allow read: if isActive();
      allow create, update: if isProvider() || isNurse();
      allow delete: if isAdministrator();
    }

    match /bloodBankRequests/{requestId} {
      allow read: if isActive();
      allow create, update: if isProvider() || isNurse() || isTechnician();
      allow delete: if isAdministrator();
    }

    match /supplyItems/{itemId} {
      allow read: if isActive();
      allow create, update, delete: if isAdministrator();
    }

    match /breakGlassEvents/{eventId} {
      allow read: if isAdministrator() || (isActive() && resource.data.userUid == request.auth.uid);
      allow create: if isActive() && request.resource.data.userUid == request.auth.uid;
      allow update, delete: if false;
    }

'''+needle
if needle not in text: raise SystemExit('audit rules block not found')
p.write_text(text.replace(needle,insert,1))
