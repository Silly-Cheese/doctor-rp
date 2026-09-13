from pathlib import Path

sim = Path("northstar-simulation.js")
text = sim.read_text()
old = 'function canEmergency(){return state.profile?.status==="active"&&(state.profile.role==="administrator"||state.profile.permissions?.emergencyEvents!==false);}'
new = '''function canEmergency(){
  if(state.profile?.status!=="active")return false;
  if(state.profile.role==="administrator")return true;
  if(Object.prototype.hasOwnProperty.call(state.profile.permissions||{},"emergencyEvents"))return state.profile.permissions.emergencyEvents===true;
  return ["physician","nurse","technician"].includes(state.profile.role);
}'''
if old not in text:
    raise SystemExit("simulation emergency helper not found")
sim.write_text(text.replace(old, new, 1))

rules = Path("firestore.rules")
r = rules.read_text()
old_rule = """    function canEmergency() {
      return isActive() && (currentUser().role == 'administrator' || permission('emergencyEvents', true));
    }"""
new_rule = """    function canEmergency() {
      return isActive() && (
        currentUser().role == 'administrator'
        || permission('emergencyEvents', currentUser().role in ['physician', 'nurse', 'technician'])
      );
    }"""
if old_rule not in r:
    raise SystemExit("rules emergency helper not found")
r = r.replace(old_rule, new_rule, 1)
old_addenda = """    match /noteAddenda/{addendumId} {
      allow read: if isActive();
      allow create: if isProvider() && request.resource.data.authorUid == request.auth.uid;
      allow update: if false;
      allow delete: if isAdministrator();
    }"""
new_addenda = """    match /noteAddenda/{addendumId} {
      allow read: if isActive();
      allow create: if isProvider() && request.resource.data.authorUid == request.auth.uid;
      allow update: if isAdministrator()
                    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['patientId', 'patientName', 'mrn', 'updatedAt']);
      allow delete: if isAdministrator();
    }"""
if old_addenda not in r:
    raise SystemExit("note addenda rules not found")
rules.write_text(r.replace(old_addenda, new_addenda, 1))
