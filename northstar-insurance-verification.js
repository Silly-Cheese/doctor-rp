// Billing-management interface for short-lived, sanitized public verification snapshots.
// An invoice number alone does not grant access. No account is needed by the recipient.
import {getApp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {getAuth} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {getFirestore,doc,getDoc,writeBatch,updateDoc,serverTimestamp,Timestamp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const PERIOD_DAYS=30;
const randomCode=()=>{
  const bytes=new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("").toUpperCase();
};
const cents=value=>Math.trunc(Number(value)||0);
const portalURL=()=>new URL("./verify.html",window.location.href).href;
function publicLine(item){
  return {
    description:String(item.description||"Service").slice(0,160),
    quantity:Math.max(1,Math.min(10000,Math.trunc(Number(item.quantity)||1))),
    unitPriceCents:cents(item.unitPriceCents),
    amountCents:cents(item.amountCents)
  };
}
function snapshot(invoice,id,code,expiresAt){
  return {
    simulated:true,
    encounterId:id,
    invoiceNumber:String(invoice.invoiceNumber||""),
    verificationCode:code,
    invoiceUpdatedAt:invoice.updatedAt,
    publishedAt:serverTimestamp(),
    expiresAt,
    status:String(invoice.status||"open"),
    claimStatus:String(invoice.claimStatus||"not-submitted"),
    insuranceProvider:String(invoice.insuranceProvider||"").slice(0,100),
    chargeCents:cents(invoice.chargeCents),
    insuranceEstimatedCents:cents(invoice.insuranceEstimatedCents),
    insuranceReceivedCents:cents(invoice.insuranceReceivedCents),
    waivedCents:cents(invoice.waivedCents),
    patientBalanceCents:cents(invoice.patientBalanceCents),
    insurerBalanceCents:cents(invoice.insurerBalanceCents),
    serviceLines:(invoice.lineItems||[]).map(publicLine)
  };
}
async function publish(encounterId,rotate=false){
  const store=getFirestore(getApp());
  const user=getAuth(getApp()).currentUser;
  if(!user)throw Error("Sign in with billing management access before publishing verification.");
  const invoiceRef=doc(store,"billingAccounts",encounterId);
  const accessRef=doc(store,"insuranceInvoiceAccess",encounterId);
  const [invoiceDoc,accessDoc]=await Promise.all([getDoc(invoiceRef),getDoc(accessRef)]);
  if(!invoiceDoc.exists())throw Error("Invoice no longer exists.");
  const invoice=invoiceDoc.data();
  if(!invoice.updatedAt?.toDate)throw Error("Invoice timestamp is unavailable. Please retry.");
  const access=accessDoc.exists()?accessDoc.data():null;
  const code=!rotate&&access?.active&&/^[A-F0-9]{32}$/.test(access.code||"")?access.code:randomCode();
  const expiresAt=Timestamp.fromDate(new Date(Date.now()+PERIOD_DAYS*86400000));
  const batch=writeBatch(store);
  batch.set(accessRef,{
    code,invoiceNumber:invoice.invoiceNumber,active:true,expiresAt,
    updatedAt:serverTimestamp(),updatedBy:user.uid
  });
  batch.set(
    doc(store,"insuranceInvoiceVerifications",invoice.invoiceNumber+"-"+code),
    snapshot(invoice,encounterId,code,expiresAt)
  );
  await batch.commit();
  return {invoiceNumber:invoice.invoiceNumber,code,expiresAt:expiresAt.toDate(),portal:portalURL()};
}
async function revoke(encounterId){
  const store=getFirestore(getApp());
  const user=getAuth(getApp()).currentUser;
  if(!user)throw Error("Sign in to revoke verification access.");
  const ref=doc(store,"insuranceInvoiceAccess",encounterId);
  const access=await getDoc(ref);
  if(!access.exists()||!access.get("active"))return false;
  await updateDoc(ref,{active:false,updatedAt:serverTimestamp(),updatedBy:user.uid});
  return true;
}
const el=(tag,cls,text)=>{
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(text!==undefined)node.textContent=text;
  return node;
};
export function openInsuranceVerificationManagement(encounterId,invoiceNumber){
  const dialog=el("dialog","niv-dialog");
  const panel=el("div","niv-modal");
  panel.innerHTML='<header><div><p class="niv-eyebrow">Insurance verification</p><h2>Share invoice securely</h2></div><button class="niv-close" type="button" aria-label="Close">×</button></header><p>Insurance representatives do not need an account. Give them the <strong>invoice number and private verification code</strong>. The public view contains charges and billing totals, but not patient names, diagnoses, medical notes, or patient identifiers.</p><p>Codes expire after 30 days. Editing the original invoice immediately makes the published copy unavailable until refreshed.</p><div class="niv-actions"><button data-action="publish" type="button">Issue / refresh code</button><button data-action="rotate" type="button" class="niv-secondary">Rotate code</button><button data-action="revoke" type="button" class="niv-danger">Revoke access</button></div><div class="niv-result" aria-live="polite"></div><p class="niv-disclaimer">Simulation records only. Verification confirms that the displayed financial snapshot matches a current Northstar billing record; it does not establish medical necessity, eligibility, or a real insurance obligation.</p>';
  dialog.append(panel);document.body.append(dialog);dialog.showModal();
  dialog.querySelector(".niv-close").onclick=()=>dialog.close();
  dialog.addEventListener("close",()=>dialog.remove(),{once:true});
  dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close();});
  const result=panel.querySelector(".niv-result");
  const buttons=panel.querySelectorAll("[data-action]");
  for(const button of buttons)button.addEventListener("click",async()=>{
    const action=button.dataset.action;
    if(action==="rotate"&&!confirm("Rotate the code? Previously issued insurance verification codes will stop working."))return;
    if(action==="revoke"&&!confirm("Revoke public access to this invoice?"))return;
    buttons.forEach(item=>item.disabled=true);
    result.replaceChildren(el("p","","Working…"));
    try{
      if(action==="revoke"){
        const did=await revoke(encounterId);
        result.replaceChildren(el("p","niv-success",did?"Insurance verification access revoked.":"No active access code was found."));
      }else{
        const data=await publish(encounterId,action==="rotate");
        const heading=el("strong","","Verification access is ready");
        const one=el("p","","Invoice number: "+data.invoiceNumber);
        const two=el("p","","Verification code: "+data.code);
        const three=el("p","","Expires: "+data.expiresAt.toLocaleDateString());
        const link=el("a","","Open public verification portal");
        link.href=data.portal;link.target="_blank";link.rel="noopener noreferrer";
        const copy=el("button","niv-secondary","Copy invoice number and code");
        copy.type="button";
        copy.onclick=async()=>{
          try{
            await navigator.clipboard.writeText("Invoice: "+data.invoiceNumber+"\nVerification code: "+data.code+"\nPortal: "+data.portal);
            copy.textContent="Copied";
          }catch{copy.textContent="Copy failed; select details above.";}
        };
        result.replaceChildren(heading,one,two,three,link,copy);
      }
    }catch(error){
      result.replaceChildren(el("p","niv-error",error.message||"Unable to manage verification."));
    }finally{buttons.forEach(item=>item.disabled=false);}
  });
}
