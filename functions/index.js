const {onCall,HttpsError}=require("firebase-functions/v2/https");
const admin=require("firebase-admin");
admin.initializeApp();
const db=admin.firestore();
const requireUser=async request=>{
  if(!request.auth)throw new HttpsError("unauthenticated","Please sign in.");
  const uid=request.auth.uid;
  const snap=await db.doc("users/"+uid).get();
  if(!snap.exists||snap.get("status")!=="active")
    throw new HttpsError("permission-denied","An active staff account is required.");
  return {uid,role:snap.get("role"),permissions:snap.get("permissions")||{}};
};
exports.northstarHealth=onCall({region:"us-central1",timeoutSeconds:20},async request=>{
 const actor=await requireUser(request);
 return {service:"northstar-backend",status:"ready",version:"2026-10-22-audit",role:actor.role};
});
