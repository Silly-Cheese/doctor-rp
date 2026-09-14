from pathlib import Path

# case-records.js
path = Path('case-records.js')
text = path.read_text()
old = '''function canManageConfidential(encounter) {
  if (!canActAsPhysician() || !isActiveEncounter(encounter) || isPermanentlyLocked(encounter)) return false;
  return !encounter.providerUid || encounter.providerUid === auth.currentUser?.uid;
}'''
new = '''function canManageConfidential(encounter) {
  if (!canActAsPhysician() || isPermanentlyLocked(encounter)) return false;
  if (isAdministrator()) return true;
  if (isActiveEncounter(encounter)) return !encounter.providerUid || encounter.providerUid === auth.currentUser?.uid;
  return encounter.providerUid === auth.currentUser?.uid;
}'''
if old not in text: raise SystemExit('case-records canManageConfidential target missing')
text = text.replace(old, new, 1)
text = text.replace('showToast("Only the assigned physician can manage confidentiality while this case is active.");', 'showToast("Only the assigned physician or an Administrator can manage confidentiality for this case.");', 1)
text = text.replace('if (!encounter.providerUid) {\n      changes.providerUid = auth.currentUser.uid;', 'if (!encounter.providerUid && isActiveEncounter(encounter)) {\n      changes.providerUid = auth.currentUser.uid;', 1)
text = text.replace('showToast(error?.code === "permission-denied" ? "Only the assigned physician can secure this case." : "Unable to update confidential access.");', 'showToast(error?.code === "permission-denied" ? "Only the assigned physician or an Administrator can secure this case." : "Unable to update confidential access.");', 1)
path.write_text(text)

# firestore.rules
path = Path('firestore.rules')
text = path.read_text()
old = '''    function assignedProviderOrUnassigned() {
      return isProvider() && (
        resource.data.get('providerUid', '') == ''
        || resource.data.get('providerUid', '') == request.auth.uid
      );
    }

    function validProviderConfidentialUpdate() {
      return assignedProviderOrUnassigned()
             && resource.data.status != 'discharged'
             && resource.data.get('permanentlyLocked', false) == false'''
new = '''    function canManageEncounterConfidentiality() {
      return isAdministrator()
             || (
               isProvider()
               && (
                 resource.data.get('providerUid', '') == request.auth.uid
                 || (
                   resource.data.get('providerUid', '') == ''
                   && resource.data.status != 'discharged'
                 )
               )
             );
    }

    function validProviderConfidentialUpdate() {
      return canManageEncounterConfidentiality()
             && resource.data.get('permanentlyLocked', false) == false'''
if old not in text: raise SystemExit('firestore confidentiality target missing')
text = text.replace(old, new, 1)
path.write_text(text)

# northstar-breakglass.js: replace function prefix/body up through prompt handling
path = Path('northstar-breakglass.js')
text = path.read_text()
old = '''async function openBreakGlass(){if(!active()||!state.encounterId)return;const eSnap=await getDoc(doc(db,"encounters",state.encounterId));if(!eSnap.exists())return;const enc={id:eSnap.id,...eSnap.data()};const pSnap=await getDoc(doc(db,"patients",enc.patientId));const p=pSnap.exists()?{id:pSnap.id,...pSnap.data()}:null;if(isDeceased(p)){toast("Break-glass access is not available for deceased records.");return;}if(enc.permanentlyLocked){toast("A permanently locked case requires Administrator review.");return;}const reason=await window.NorthstarDialog.prompt({title:"Emergency Break-Glass Access",message:"Document why emergency access to this confidential case is required. Access will be temporary and audited.",label:"Emergency access reason",placeholder:"Describe the clinical need for emergency access",required:true,minLength:8,multiline:true,confirmText:"Grant Emergency Access",cancelText:"Cancel",tone:"warning"});if(!reason||reason.trim().length<8){toast("Emergency access requires a documented reason.");return;}await addDoc(collection(db,"breakGlassEvents"),{encounterId:enc.id,patientId:enc.patientId,mrn:p?.mrn||"",reason:reason.trim(),userUid:auth.currentUser.uid,userName:state.profile.displayName||auth.currentUser.email||"Northstar Staff",grantedAt:serverTimestamp(),expiresAfterMinutes:10});const token=`${enc.authorizationHash||""}:${Number(enc.authorizationEpoch||0)}`;sessionStorage.setItem(accessKey(enc.id),token);sessionStorage.setItem(expiryKey(enc.id),String(Date.now()+10*60*1000));document.querySelector("#caseAuthorizationDialog")?.close();toast("Emergency break-glass access granted for 10 minutes and audited.");document.querySelector(`[data-open-case-record="${CSS.escape(enc.id)}"]`)?.click();scheduleExpiry(enc.id)}'''
new = '''async function openBreakGlass(){
  if(!active()||!state.encounterId)return;
  const eSnap=await getDoc(doc(db,"encounters",state.encounterId));
  if(!eSnap.exists())return;
  const enc={id:eSnap.id,...eSnap.data()};
  const pSnap=await getDoc(doc(db,"patients",enc.patientId));
  const p=pSnap.exists()?{id:pSnap.id,...pSnap.data()}:null;
  if(isDeceased(p)){toast("Break-glass access is not available for deceased records.");return;}
  if(enc.permanentlyLocked){toast("A permanently locked case requires Administrator review.");return;}

  const authorizationDialog=document.querySelector("#caseAuthorizationDialog");
  const reopenAuthorization=Boolean(authorizationDialog?.open);
  if(reopenAuthorization)authorizationDialog.close();

  let reason=null;
  try{
    reason=await window.NorthstarDialog.prompt({title:"Emergency Break-Glass Access",message:"Document why emergency access to this confidential case is required. Access will be temporary and audited.",label:"Emergency access reason",placeholder:"Describe the clinical need for emergency access",required:true,minLength:8,multiline:true,confirmText:"Grant Emergency Access",cancelText:"Cancel",tone:"warning"});
  }catch(error){
    console.error("Northstar break-glass dialog failed",error);
    toast("Unable to open Emergency Access. Please try again.");
  }
  if(!reason||reason.trim().length<8){
    if(reopenAuthorization&&!authorizationDialog?.open)authorizationDialog?.showModal();
    return;
  }

  await addDoc(collection(db,"breakGlassEvents"),{encounterId:enc.id,patientId:enc.patientId,mrn:p?.mrn||"",reason:reason.trim(),userUid:auth.currentUser.uid,userName:state.profile.displayName||auth.currentUser.email||"Northstar Staff",grantedAt:serverTimestamp(),expiresAfterMinutes:10});
  const token=`${enc.authorizationHash||""}:${Number(enc.authorizationEpoch||0)}`;
  sessionStorage.setItem(accessKey(enc.id),token);
  sessionStorage.setItem(expiryKey(enc.id),String(Date.now()+10*60*1000));
  toast("Emergency break-glass access granted for 10 minutes and audited.");
  document.querySelector(`[data-open-case-record="${CSS.escape(enc.id)}"]`)?.click();
  scheduleExpiry(enc.id);
}'''
if old not in text: raise SystemExit('break-glass function target missing')
text = text.replace(old, new, 1)
path.write_text(text)

print('Applied break-glass and historical confidentiality fixes.')
