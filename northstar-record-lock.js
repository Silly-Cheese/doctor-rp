
import { getApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, onSnapshot, setDoc, updateDoc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const ACCESS_MINUTES = 15;
const ROLES = {administrator:"Administrator",physician:"Physician",nurse:"Registered Nurse",registration:"Registration",technician:"Clinical Technician",staff:"Clinical Staff"};
const state = {profile:null,users:[],patients:[],selectedPatientId:null,verifyMode:"general",verifyPatientId:null,scanner:null,stream:null,loop:0,busy:false,unsubs:[],provisioning:new Set(),queued:false};

function safe(v){return String(v==null?"":v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
function toast(m){const n=document.querySelector("#toast");if(!n)return;n.textContent=m;n.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(function(){n.classList.remove("show");},3400);}
function patientById(id){return state.patients.find(function(p){return p.id===id;})||null;}
function userById(id){return state.users.find(function(u){return (u.uid||u.id)===id;})||null;}
function isAdmin(){return state.profile&&state.profile.status==="active"&&state.profile.role==="administrator";}
function roleLabel(u){const k=u&&u.requestedRole&&u.requestedRole!=="staff"?u.requestedRole:u&&u.role;return ROLES[k]||ROLES[u&&u.role]||"Clinical Staff";}
function audit(type,details){if(!auth.currentUser)return Promise.resolve();return setDoc(doc(collection(db,"auditEvents")),Object.assign({type:type,actorUid:auth.currentUser.uid,actorName:state.profile&&state.profile.displayName||"Northstar Staff",at:serverTimestamp()},details||{})).catch(function(){});}

function ensureUi(){
  if(!document.querySelector("link[data-record-lock]")){const l=document.createElement("link");l.rel="stylesheet";l.dataset.recordLock="1";l.href="northstar-record-lock.css?v="+(window.NorthstarBuild||"20260919");document.head.appendChild(l);}
  if(!document.querySelector("#staffIdDialog")){
    document.body.insertAdjacentHTML("beforeend",
      '<dialog id="staffIdDialog" class="modal"><div class="modal-card">'+
      '<div class="modal-header"><div><p class="eyebrow">Northstar Workforce Identity</p><h3>Staff ID Badge</h3></div><button class="icon-button" type="button" data-rl-close="staffIdDialog">x</button></div>'+
      '<div id="staffIdBody" class="modal-body"></div>'+
      '<div class="modal-footer"><button class="secondary-button" type="button" data-rl-close="staffIdDialog">Close</button><button id="printStaffId" class="primary-button" type="button">Print Staff ID</button></div></div></dialog>'+
      '<dialog id="staffVerifyDialog" class="modal"><div class="modal-card record-lock-gate-card">'+
      '<div class="modal-header"><div><p id="staffVerifyEyebrow" class="eyebrow">Workforce Identity</p><h3 id="staffVerifyTitle">Scan Staff ID</h3></div><button class="icon-button" type="button" data-rl-close="staffVerifyDialog">x</button></div>'+
      '<div class="modal-body"><div id="staffVerifyContext"></div><div class="record-lock-methods">'+
      '<section class="record-lock-method"><strong>Scan Staff ID</strong><div class="record-lock-camera"><video id="staffVerifyVideo" autoplay playsinline muted></video><div class="staff-scan-reticle"></div></div>'+
      '<p id="staffVerifyStatus" class="staff-scanner-status">Camera ready.</p><div class="field-row"><button id="startStaffVerifyCamera" class="primary-button" type="button">Start Camera</button><label class="secondary-button" for="staffVerifyPhoto">Scan Photo</label><input id="staffVerifyPhoto" type="file" accept="image/*" capture="environment" hidden></div></section>'+
      '<section class="record-lock-method"><strong>Enter Credential</strong><div class="record-lock-manual"><label><span>Staff ID credential</span><input id="staffVerifyManual" autocomplete="off" placeholder="ABCDE-FGHIJ-KLMNO-PQRST"></label>'+
      '<button id="verifyStaffCredential" class="primary-button" type="button">Verify Credential</button><p class="form-note">The visible Staff ID number is not the access credential. Scan the badge or enter the credential printed on it.</p></div></section>'+
      '</div><div id="staffVerifyResult"></div></div></div></dialog>'+
      '<dialog id="recordLockDialog" class="modal"><form id="recordLockForm" class="modal-card">'+
      '<div class="modal-header"><div><p class="eyebrow">Administrative Record Control</p><h3>Lock Patient Profile</h3></div><button class="icon-button" type="button" data-rl-close="recordLockDialog">x</button></div>'+
      '<div class="modal-body form-grid"><div id="recordLockContext" class="patient-context"></div><p class="form-banner">The profile remains visible in search with the lock reason, but the chart requires the issuing employee Staff ID credential.</p>'+
      '<label><span>Required lock reason</span><textarea id="recordLockReason" rows="4" minlength="5" required placeholder="Explain why this profile is being restricted."></textarea></label></div>'+
      '<div class="modal-footer"><button class="secondary-button" type="button" data-rl-close="recordLockDialog">Cancel</button><button class="danger-button" type="submit">Lock Profile</button></div></form></dialog>'+
      '<dialog id="recordUnlockDialog" class="modal"><form id="recordUnlockForm" class="modal-card">'+
      '<div class="modal-header"><div><p class="eyebrow">Administrative Record Control</p><h3>Remove Profile Lock</h3></div><button class="icon-button" type="button" data-rl-close="recordUnlockDialog">x</button></div>'+
      '<div class="modal-body form-grid"><div id="recordUnlockContext" class="patient-context"></div><label><span>Required removal reason</span><textarea id="recordUnlockReason" rows="4" minlength="5" required></textarea></label></div>'+
      '<div class="modal-footer"><button class="secondary-button" type="button" data-rl-close="recordUnlockDialog">Cancel</button><button class="danger-button" type="submit">Remove Lock</button></div></form></dialog>'
    );
  }
  const footer=document.querySelector(".sidebar-footer");
  if(footer&&!document.querySelector("#myStaffIdButton")){const b=document.createElement("button");b.id="myStaffIdButton";b.type="button";b.className="text-button staff-id-footer-button";b.textContent="My Staff ID";footer.insertBefore(b,document.querySelector("#signOutButton"));}
}

function bindUi(){
  document.querySelectorAll("[data-rl-close]").forEach(function(b){b.addEventListener("click",function(){if(b.dataset.rlClose==="staffVerifyDialog")stopScanner();document.querySelector("#"+b.dataset.rlClose)?.close();});});
  document.querySelector("#myStaffIdButton")?.addEventListener("click",function(){openBadge(auth.currentUser&&auth.currentUser.uid);});
  document.querySelector("#printStaffId")?.addEventListener("click",printBadge);
  document.querySelector("#startStaffVerifyCamera")?.addEventListener("click",startScanner);
  document.querySelector("#verifyStaffCredential")?.addEventListener("click",function(){handleCredential(document.querySelector("#staffVerifyManual")?.value||"","manual");});
  document.querySelector("#staffVerifyPhoto")?.addEventListener("change",scanPhoto);
  document.querySelector("#staffVerifyDialog")?.addEventListener("close",stopScanner);
  document.querySelector("#recordLockForm")?.addEventListener("submit",submitLock);
  document.querySelector("#recordUnlockForm")?.addEventListener("submit",submitUnlock);
}

function rand(n){const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789",bytes=new Uint8Array(n);crypto.getRandomValues(bytes);return Array.from(bytes,function(b){return chars[b%chars.length];}).join("");}
function makeStaffId(){const used=new Set(state.users.map(function(u){return u.staffId;}).filter(Boolean));let id;do{id="NS-"+rand(6);}while(used.has(id));return id;}
function makeCredential(){return rand(20).match(/.{1,5}/g).join("-");}
function canonical(v){return String(v||"").toUpperCase().replace(/[^A-Z0-9]/g,"");}
async function digest(v){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonical(v)));return Array.from(new Uint8Array(d),function(x){return x.toString(16).padStart(2,"0");}).join("");}
function qrPayload(uid,staffId,credential){return "NORTHSTAR-STAFF|"+uid+"|"+staffId+"|"+canonical(credential);}
function parsePayload(v){const p=String(v||"").trim().split("|");return p.length===4&&p[0]==="NORTHSTAR-STAFF"?{uid:p[1],staffId:p[2],credential:p[3]}:null;}

async function issueStaffId(uid,force){
  if(!isAdmin()||!uid)return null;
  const u=userById(uid);if(!u||u.status!=="active"||state.provisioning.has(uid))return null;
  if(!force&&u.staffId&&u.staffCredentialHash)return null;
  state.provisioning.add(uid);
  try{
    const staffId=u.staffId||makeStaffId(),credential=makeCredential(),credentialHash=await digest(credential),batch=writeBatch(db);
    batch.set(doc(db,"staffCredentials",uid),{uid:uid,staffId:staffId,credential:credential,credentialHash:credentialHash,status:"active",issuedAt:serverTimestamp(),issuedBy:auth.currentUser.uid,issuedByName:state.profile.displayName||"Northstar Administrator"});
    batch.update(doc(db,"users",uid),{staffId:staffId,staffCredentialHash:credentialHash,staffIdStatus:"active",staffIdIssuedAt:serverTimestamp(),staffIdIssuedBy:auth.currentUser.uid,staffIdVersion:Number(u.staffIdVersion||0)+1});
    batch.set(doc(collection(db,"auditEvents")),{type:force?"staff-id-reissued":"staff-id-issued",staffUid:uid,staffName:u.displayName||"Northstar Staff",staffId:staffId,actorUid:auth.currentUser.uid,actorName:state.profile.displayName||"Northstar Administrator",at:serverTimestamp()});
    await batch.commit();toast((force?"Staff ID reissued for ":"Staff ID issued for ")+(u.displayName||"Northstar Staff")+".");return credential;
  }catch(_){toast("Unable to issue Staff ID.");return null;}finally{state.provisioning.delete(uid);}
}
async function provisionMissing(){if(!isAdmin())return;const list=state.users.filter(function(u){return u.status==="active"&&(!u.staffId||!u.staffCredentialHash);});for(const u of list)await issueStaffId(u.uid||u.id,false);}
async function getCredential(uid){try{const s=await getDoc(doc(db,"staffCredentials",uid));return s.exists()?s.data():null;}catch(_){return null;}}

async function openBadge(uid){
  if(!uid)return;
  let u=userById(uid)||(uid===(auth.currentUser&&auth.currentUser.uid)?state.profile:null);if(!u)return;
  if((!u.staffId||!u.staffCredentialHash)&&isAdmin()){await issueStaffId(uid,false);u=userById(uid)||u;}
  if(!u.staffId){toast("This staff account does not have a Staff ID yet.");return;}
  const sec=await getCredential(uid);if(!sec||!sec.credential){toast(isAdmin()?"This badge must be reissued before it can be printed.":"Ask an administrator to reissue your Staff ID.");return;}
  let qr="";
  try{const m=await import("https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm"),q=m.default||m;qr=await q.toDataURL(qrPayload(uid,u.staffId,sec.credential),{margin:1,width:220,errorCorrectionLevel:"M"});}catch(_){}
  document.querySelector("#staffIdBody").innerHTML=
    '<div class="staff-id-card"><div class="staff-id-brand"><div class="staff-id-brand-mark">N</div><div><strong>NORTHSTAR MEDICAL CENTER</strong><span>Secure Staff Identification</span></div></div>'+
    '<div class="staff-id-main"><div><h3>'+safe(u.displayName||"Northstar Staff")+'</h3><p>'+safe(roleLabel(u))+'</p><span class="staff-id-number">'+safe(u.staffId)+'</span><div class="staff-id-credential">ACCESS CREDENTIAL / '+safe(sec.credential)+'</div></div>'+
    '<div class="staff-id-qr">'+(qr?'<img src="'+qr+'" alt="Scannable Northstar Staff ID">':'<strong>'+safe(u.staffId)+'</strong>')+'<span>Scan Staff ID</span></div></div><div class="staff-id-card-note">Roleplay credential / Reissue immediately if lost.</div></div>';
  document.querySelector("#staffIdDialog")?.showModal();
}
function printBadge(){const c=document.querySelector("#staffIdDialog .staff-id-card");if(!c)return;const r=document.createElement("div");r.className="staff-id-print-root";r.appendChild(c.cloneNode(true));document.body.appendChild(r);document.body.classList.add("staff-id-printing");window.print();setTimeout(function(){document.body.classList.remove("staff-id-printing");r.remove();},500);}

async function verifyCredential(raw,expectedUid){
  const parsed=parsePayload(raw),credential=parsed?parsed.credential:raw,h=await digest(credential);
  const u=expectedUid?userById(expectedUid):state.users.find(function(x){return x.staffCredentialHash===h;});
  if(!u)return{ok:false,message:expectedUid?"The employee who issued this lock is unavailable in the staff directory.":"No Northstar Staff ID matches that credential."};
  if(expectedUid&&parsed&&parsed.uid!==expectedUid)return{ok:false,message:"That Staff ID belongs to a different employee."};
  if(parsed&&(parsed.uid!==(u.uid||u.id)||parsed.staffId!==u.staffId))return{ok:false,message:"That QR code does not match the current staff directory record."};
  if(u.status!=="active"||u.staffIdStatus==="revoked")return{ok:false,message:"That Staff ID is not active."};
  if(u.staffCredentialHash!==h)return{ok:false,message:"Credential rejected. This record requires the Staff ID of the employee who issued the lock."};
  return{ok:true,user:u};
}
function verifyMessage(message,ok){document.querySelector("#staffVerifyResult").innerHTML='<div class="staff-scan-result '+(ok?"valid":"invalid")+'"><strong>'+(ok?"Staff ID verified":"Not verified")+'</strong><span>'+safe(message)+'</span></div>';}
function verifyStatus(message){const n=document.querySelector("#staffVerifyStatus");if(n)n.textContent=message;}

function openVerifier(mode,patient){
  state.verifyMode=mode;state.verifyPatientId=patient?patient.id:null;document.querySelector("#staffVerifyManual").value="";document.querySelector("#staffVerifyResult").innerHTML="";verifyStatus("Camera ready.");
  if(mode==="lock"&&patient){
    const issuer=userById(patient.profileLockedByUid);
    document.querySelector("#staffVerifyEyebrow").textContent="Restricted Patient Record";
    document.querySelector("#staffVerifyTitle").textContent="Issuing Staff ID Required";
    document.querySelector("#staffVerifyContext").innerHTML=
      '<div class="record-lock-gate-hero"><div class="gate-icon">LOCK</div><div><strong>This patient profile is administratively locked.</strong><span>Registration can see the lock and reason, but opening the chart requires the issuing employee Staff ID credential.</span></div></div>'+
      '<div class="record-lock-detail-grid"><div><span>Patient</span><strong>'+safe((patient.lastName||"")+", "+(patient.firstName||""))+'</strong></div><div><span>MRN</span><strong>'+safe(patient.mrn||"-")+'</strong></div>'+
      '<div><span>Lock reason</span><strong>'+safe(patient.profileLockReason||"Administrative restriction")+'</strong></div><div><span>Issued by</span><strong>'+safe(patient.profileLockedByName||(issuer&&issuer.displayName)||"Northstar Staff")+' / '+safe(patient.profileLockedByStaffId||(issuer&&issuer.staffId)||"Staff ID unavailable")+'</strong></div></div>';
  }else{
    document.querySelector("#staffVerifyEyebrow").textContent="Workforce Identity";document.querySelector("#staffVerifyTitle").textContent="Scan Staff ID";
    document.querySelector("#staffVerifyContext").innerHTML='<p class="form-banner">Scan a Northstar Staff ID to verify the employee and account status.</p>';
  }
  document.querySelector("#staffVerifyDialog")?.showModal();
}
async function handleCredential(raw,method){
  if(state.busy||!canonical((parsePayload(raw)||{}).credential||raw)){verifyMessage("Enter or scan a valid Staff ID credential.",false);return;}
  state.busy=true;
  try{
    const patient=state.verifyMode==="lock"?patientById(state.verifyPatientId):null,result=await verifyCredential(raw,patient&&patient.profileLockedByUid);
    if(!result.ok){verifyMessage(result.message,false);return;}
    if(state.verifyMode==="lock")await grantAccess(patient,result.user,method);
    else{verifyMessage((result.user.displayName||"Northstar Staff")+" / "+roleLabel(result.user)+" / "+result.user.staffId,true);await audit("staff-id-scanned",{staffUid:result.user.uid||result.user.id,staffId:result.user.staffId,verificationMethod:method});await stopScanner();}
  }finally{state.busy=false;}
}
async function startScanner(){
  await stopScanner();const video=document.querySelector("#staffVerifyVideo");if(!video)return;
  if(!window.isSecureContext){verifyStatus("Camera requires HTTPS. Use Scan Photo or enter the credential.");return;}verifyStatus("Starting rear camera...");
  if("BarcodeDetector" in window&&navigator.mediaDevices&&navigator.mediaDevices.getUserMedia){
    try{
      const formats=typeof BarcodeDetector.getSupportedFormats==="function"?await BarcodeDetector.getSupportedFormats():["qr_code"];
      if(formats.includes("qr_code")){
        state.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}},audio:false});video.srcObject=state.stream;await video.play();
        const detector=new BarcodeDetector({formats:["qr_code"]});verifyStatus("Rear camera active. Center the Staff ID QR code.");let last=0;
        const loop=async function(t){if(!state.stream)return;if(t-last>250&&!state.busy){last=t;try{const codes=await detector.detect(video);if(codes[0]&&codes[0].rawValue)await handleCredential(codes[0].rawValue,"badge-scan");}catch(_){}}state.loop=requestAnimationFrame(loop);};state.loop=requestAnimationFrame(loop);return;
      }
    }catch(_){await stopScanner();}
  }
  try{
    const m=await import("https://cdn.jsdelivr.net/npm/qr-scanner@1.4.2/qr-scanner.min.js"),Qr=m.default||m;
    state.scanner=new Qr(video,async function(r){await handleCredential(r&&r.data||r,"badge-scan");},{preferredCamera:"environment",maxScansPerSecond:6,returnDetailedScanResult:true});await state.scanner.start();verifyStatus("Rear camera active. Center the Staff ID QR code.");
  }catch(_){verifyStatus("Live camera unavailable. Use Scan Photo or enter the credential.");}
}
async function scanPhoto(e){const f=e.target.files&&e.target.files[0];if(!f)return;verifyStatus("Reading Staff ID image...");try{const m=await import("https://cdn.jsdelivr.net/npm/qr-scanner@1.4.2/qr-scanner.min.js"),Qr=m.default||m,r=await Qr.scanImage(f,{returnDetailedScanResult:true});await handleCredential(r&&r.data||r,"photo-scan");}catch(_){verifyMessage("No readable Northstar Staff ID QR code was found.",false);}finally{e.target.value="";}}
async function stopScanner(){if(state.scanner){try{state.scanner.stop();state.scanner.destroy();}catch(_){}state.scanner=null;}if(state.loop)cancelAnimationFrame(state.loop);state.loop=0;if(state.stream)state.stream.getTracks().forEach(function(t){t.stop();});state.stream=null;const v=document.querySelector("#staffVerifyVideo");if(v){try{v.pause();}catch(_){}v.srcObject=null;}}

function sessionKey(p){return "northstar:record-lock:"+p.id;}
function hasAccess(p){if(!p||p.profileLocked!==true)return true;try{const g=JSON.parse(sessionStorage.getItem(sessionKey(p))||"{}");if(g.epoch!==Number(p.profileLockEpoch||0)||g.issuerUid!==p.profileLockedByUid||Number(g.expiresAt||0)<=Date.now()){sessionStorage.removeItem(sessionKey(p));return false;}return true;}catch(_){return false;}}
function sessionExpiry(p){try{return JSON.parse(sessionStorage.getItem(sessionKey(p))||"{}").expiresAt||0;}catch(_){return 0;}}
async function grantAccess(p,issuer,method){
  if(!p)return;const until=Date.now()+ACCESS_MINUTES*60000;sessionStorage.setItem(sessionKey(p),JSON.stringify({epoch:Number(p.profileLockEpoch||0),issuerUid:p.profileLockedByUid,expiresAt:until}));
  await audit("patient-profile-lock-access",{patientId:p.id,mrn:p.mrn||"",lockIssuerUid:p.profileLockedByUid,lockIssuerName:p.profileLockedByName||(issuer&&issuer.displayName)||"",verificationMethod:method,accessExpiresAt:new Date(until)});
  verifyMessage("Credential accepted. Access granted for "+ACCESS_MINUTES+" minutes.",true);toast("Restricted record access granted for "+ACCESS_MINUTES+" minutes.");await stopScanner();
  setTimeout(function(){document.querySelector("#staffVerifyDialog")?.close();openPatient(p.id);},250);
}
function openPatient(id){
  window.dispatchEvent(new CustomEvent("northstar:open-patient",{detail:{patientId:id}}));const p=patientById(id);
  setTimeout(function(){if(document.querySelector("#patientChartDialog")?.open)return;document.querySelector('[data-section="patients"]')?.click();const input=document.querySelector("#patientSearchInput");if(input&&p){input.value=p.mrn||((p.firstName||"")+" "+(p.lastName||"")).trim();input.dispatchEvent(new Event("input",{bubbles:true}));setTimeout(function(){document.querySelector('.patient-row[data-patient-id="'+CSS.escape(id)+'"]')?.click();},80);}},100);
}

async function openLockDialog(id){
  if(!isAdmin())return;let me=userById(auth.currentUser&&auth.currentUser.uid)||state.profile;
  if(!me.staffId||!me.staffCredentialHash){await issueStaffId(auth.currentUser.uid,false);me=userById(auth.currentUser.uid)||state.profile;}
  if(!me.staffId||!me.staffCredentialHash){toast("Your administrator account needs a Staff ID before it can lock a record.");return;}
  const p=patientById(id||state.selectedPatientId);if(!p||p.profileLocked===true)return;state.selectedPatientId=p.id;document.querySelector("#recordLockForm").reset();
  document.querySelector("#recordLockContext").innerHTML="<strong>"+safe(p.lastName)+", "+safe(p.firstName)+"</strong><span>"+safe(p.mrn||"")+" / Lock issuer: "+safe(me.displayName||"Northstar Staff")+" ("+safe(me.staffId)+")</span>";document.querySelector("#recordLockDialog")?.showModal();
}
async function submitLock(e){
  e.preventDefault();if(!isAdmin())return;const p=patientById(state.selectedPatientId),me=userById(auth.currentUser&&auth.currentUser.uid)||state.profile,r=document.querySelector("#recordLockReason").value.trim(),b=e.currentTarget.querySelector("button[type='submit']");
  if(!p||p.profileLocked===true||r.length<5){toast("Enter a meaningful lock reason.");return;}if(!me||!me.staffId||!me.staffCredentialHash){toast("Your Staff ID is required.");return;}b.disabled=true;b.textContent="Locking...";
  try{await updateDoc(doc(db,"patients",p.id),{profileLocked:true,profileLockReason:r,profileLockedByUid:auth.currentUser.uid,profileLockedByName:me.displayName||"Northstar Administrator",profileLockedByStaffId:me.staffId,profileLockedAt:serverTimestamp(),profileLockEpoch:Number(p.profileLockEpoch||0)+1,updatedAt:serverTimestamp()});
    await audit("patient-profile-locked",{patientId:p.id,mrn:p.mrn||"",reason:r,issuerStaffId:me.staffId});sessionStorage.removeItem(sessionKey(p));document.querySelector("#recordLockDialog")?.close();document.querySelector("#patientChartDialog")?.close();toast("Patient profile locked. Issuing Staff ID verification is now required.");
  }catch(_){toast("Unable to lock this patient profile.");}finally{b.disabled=false;b.textContent="Lock Profile";}
}
function openUnlockDialog(id){if(!isAdmin())return;const p=patientById(id||state.selectedPatientId);if(!p||p.profileLocked!==true||!hasAccess(p))return;state.selectedPatientId=p.id;document.querySelector("#recordUnlockForm").reset();document.querySelector("#recordUnlockContext").innerHTML="<strong>"+safe(p.lastName)+", "+safe(p.firstName)+"</strong><span>"+safe(p.mrn||"")+" / Current reason: "+safe(p.profileLockReason||"Administrative restriction")+"</span>";document.querySelector("#recordUnlockDialog")?.showModal();}
async function submitUnlock(e){
  e.preventDefault();if(!isAdmin())return;const p=patientById(state.selectedPatientId),r=document.querySelector("#recordUnlockReason").value.trim(),b=e.currentTarget.querySelector("button[type='submit']");
  if(!p||p.profileLocked!==true||!hasAccess(p)||r.length<5){toast("Verify the issuer Staff ID and enter a removal reason.");return;}b.disabled=true;b.textContent="Removing...";
  try{await updateDoc(doc(db,"patients",p.id),{profileLocked:false,profileLockRemovedAt:serverTimestamp(),profileLockRemovedBy:auth.currentUser.uid,profileLockRemovedByName:state.profile.displayName||"Northstar Administrator",profileLockRemovalReason:r,profileLockEpoch:Number(p.profileLockEpoch||0)+1,updatedAt:serverTimestamp()});
    await audit("patient-profile-unlocked",{patientId:p.id,mrn:p.mrn||"",reason:r,originalIssuerUid:p.profileLockedByUid||null});sessionStorage.removeItem(sessionKey(p));document.querySelector("#recordUnlockDialog")?.close();toast("Patient profile lock removed.");
  }catch(_){toast("Unable to remove this profile lock.");}finally{b.disabled=false;b.textContent="Remove Lock";}
}

function decoratePatients(){
  const map=new Map(state.patients.map(function(p){return[p.id,p];}));
  document.querySelectorAll("[data-patient-id]").forEach(function(node){
    const p=map.get(node.dataset.patientId);if(!p)return;const locked=p.profileLocked===true;node.classList.toggle("profile-record-locked",locked);
    const primary=node.querySelector(".patient-primary")||node.querySelector("div:nth-child(2)"),chip=node.querySelector(".record-lock-chip"),reason=node.querySelector(".record-lock-reason");
    if(locked){if(primary&&!chip){const n=document.createElement("span");n.className="record-lock-chip";n.textContent="LOCK Profile Locked";primary.appendChild(n);}if(primary&&!reason){const n=document.createElement("small");n.className="record-lock-reason";n.textContent="Reason: "+(p.profileLockReason||"Administrative restriction");primary.appendChild(n);}else if(reason)reason.textContent="Reason: "+(p.profileLockReason||"Administrative restriction");node.title="LOCKED: "+(p.profileLockReason||"Administrative restriction");}
    else{if(chip)chip.remove();if(reason)reason.remove();if(node.title&&node.title.startsWith("LOCKED:"))node.removeAttribute("title");}
  });
}
function decorateStaff(){
  if(!isAdmin())return;const sub=document.querySelector("#staffSection .staff-admin-subhead");
  if(sub&&!sub.querySelector("[data-scan-staff-id]")){const d=document.createElement("div");d.className="staff-admin-id-tools";d.innerHTML='<button class="secondary-button compact" type="button" data-scan-staff-id>Scan Staff ID</button>';sub.appendChild(d);}
  document.querySelectorAll("[data-managed-staff]").forEach(function(card){const uid=card.dataset.managedStaff,u=userById(uid);if(!u)return;let box=card.querySelector(".northstar-staff-id-tools");if(!box){box=document.createElement("div");box.className="northstar-staff-id-tools";card.querySelector(".managed-staff-identity")?.appendChild(box);}
    box.innerHTML='<div class="staff-id-mini">Staff ID <b>'+safe(u.staffId||"Not issued")+'</b></div><div class="staff-id-actions">'+(u.staffId?'<button class="secondary-button compact" type="button" data-view-staff-id="'+safe(uid)+'">View / Print Badge</button><button class="secondary-button compact" type="button" data-reissue-staff-id="'+safe(uid)+'">Reissue Credential</button>':'<button class="primary-button compact" type="button" data-issue-staff-id="'+safe(uid)+'">Issue Staff ID</button>')+'</div>';
  });
}
function decorateSelf(){const c=document.querySelector(".user-chip-copy"),u=state.profile;if(!c||!u)return;let n=c.querySelector(".staff-id-mini");if(u.staffId){if(!n){n=document.createElement("span");n.className="staff-id-mini";c.appendChild(n);}n.innerHTML="Staff ID <b>"+safe(u.staffId)+"</b>";}else if(n)n.remove();}
function decorateChart(){
  const d=document.querySelector("#patientChartDialog");if(!d||!d.open||!state.selectedPatientId)return;const p=patientById(state.selectedPatientId),body=document.querySelector("#patientChartBody");if(!p||!body)return;
  body.querySelector("#recordLockChartBanner")?.remove();body.querySelector("[data-lock-profile]")?.remove();body.querySelector("[data-remove-profile-lock]")?.remove();
  if(p.profileLocked===true){if(!hasAccess(p)){d.close();openVerifier("lock",p);return;}const x=sessionExpiry(p);
    body.insertAdjacentHTML("afterbegin",'<div id="recordLockChartBanner" class="record-lock-chart-banner"><span class="record-lock-icon">LOCK</span><div><strong>Administratively Locked Profile</strong><span>'+safe(p.profileLockReason||"Administrative restriction")+' / Issued by '+safe(p.profileLockedByName||"Northstar Staff")+' ('+safe(p.profileLockedByStaffId||"Staff ID")+')</span></div><small>Credential session expires '+safe(x?new Date(x).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}):"soon")+'</small></div>');
    if(isAdmin())body.querySelector(".chart-actions")?.insertAdjacentHTML("beforeend",'<button class="secondary-button record-lock-button" type="button" data-remove-profile-lock="'+safe(p.id)+'">Remove Profile Lock</button>');
  }else if(isAdmin())body.querySelector(".chart-actions")?.insertAdjacentHTML("beforeend",'<button class="secondary-button record-lock-button" type="button" data-lock-profile="'+safe(p.id)+'">Lock Profile</button>');
}
function decorate(){if(state.queued)return;state.queued=true;requestAnimationFrame(function(){state.queued=false;decoratePatients();decorateStaff();decorateSelf();decorateChart();});}

function bindGlobal(){
  document.addEventListener("click",function(e){const t=e.target.closest("[data-patient-id]");if(!t)return;const p=patientById(t.dataset.patientId);if(!p)return;state.selectedPatientId=p.id;if(p.profileLocked===true&&!hasAccess(p)){e.preventDefault();e.stopImmediatePropagation();openVerifier("lock",p);return;}setTimeout(decorate,0);},true);
  document.addEventListener("click",async function(e){
    const lock=e.target.closest("[data-lock-profile]");if(lock){await openLockDialog(lock.dataset.lockProfile);return;}
    const unlock=e.target.closest("[data-remove-profile-lock]");if(unlock){openUnlockDialog(unlock.dataset.removeProfileLock);return;}
    const view=e.target.closest("[data-view-staff-id]");if(view){await openBadge(view.dataset.viewStaffId);return;}
    const issue=e.target.closest("[data-issue-staff-id]");if(issue){await issueStaffId(issue.dataset.issueStaffId,false);return;}
    const reissue=e.target.closest("[data-reissue-staff-id]");if(reissue){if(confirm("Reissue this Staff ID credential? Previously printed credentials for this employee will stop working."))await issueStaffId(reissue.dataset.reissueStaffId,true);return;}
    if(e.target.closest("[data-scan-staff-id]"))openVerifier("general",null);
  });
  new MutationObserver(decorate).observe(document.body,{childList:true,subtree:true});
}
function stop(){state.unsubs.forEach(function(u){try{u();}catch(_){}});state.unsubs=[];state.users=[];state.patients=[];state.profile=null;stopScanner();}
async function start(user){
  stop();if(!user)return;const ps=await getDoc(doc(db,"users",user.uid));if(!ps.exists())return;state.profile=Object.assign({id:ps.id},ps.data());if(state.profile.status!=="active")return;
  [["users","users"],["patients","patients"]].forEach(function(pair){const unsub=onSnapshot(collection(db,pair[0]),function(snap){state[pair[1]]=snap.docs.map(function(d){return Object.assign({id:d.id},d.data());});if(pair[1]==="users"){const me=userById(user.uid);if(me)state.profile=Object.assign({},state.profile,me);provisionMissing().catch(function(){});}decorate();},function(){state[pair[1]]=[];decorate();});state.unsubs.push(unsub);});decorate();
}
window.NorthstarRecordLock={canAccess:function(v){const p=typeof v==="string"?patientById(v):v;return !p||p.profileLocked!==true||hasAccess(p);},openGate:function(id){const p=patientById(id);if(p)openVerifier("lock",p);},openStaffBadge:openBadge};

ensureUi();bindUi();bindGlobal();onAuthStateChanged(auth,function(u){start(u).catch(stop);});
