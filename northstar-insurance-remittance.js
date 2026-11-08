// Unauthenticated, simulated insurer-remittance submission only.
// This page NEVER collects bank, debit-card, credit-card or routing details;
// actual invoice credits require signed-in billing staff review.
import {doc,setDoc,serverTimestamp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const usd=c=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(c/100);
const textNode=(tag,cls,label)=>{
  const n=document.createElement(tag);if(cls)n.className=cls;if(label!==undefined)n.textContent=label;return n;
};
function centsFromInput(value){
  const raw=String(value||"").trim();
  if(!/^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,2})?$/.test(raw))return null;
  const [whole,fraction=""]=raw.split(".");
  const cents=Number(whole)*100+Number(fraction.padEnd(2,"0"));
  return Number.isSafeInteger(cents)?cents:null;
}
export function attachInsuranceRemittance({target,store,invoice,verificationId}){
  const existing=target.querySelector(".iv-remittance");
  if(existing)existing.remove();
  const balance=Number(invoice.insurerBalanceCents);
  const card=textNode("section","iv-remittance");
  const heading=textNode("div","iv-remittance-heading");
  heading.append(textNode("span","iv-step","02 / Insurance remittance"),textNode("h3","","Submit an insurer payment"));
  const intro=textNode("p","",
    "Apply a simulated insurer payment toward this customer's invoice. No account is needed. Billing staff must approve the remittance before it credits the customer's account. No real funds are transferred.");
  card.append(heading,intro);
  if(!Number.isSafeInteger(balance)||balance<=0){
    card.append(textNode("p","iv-payment-note","This invoice has no outstanding insurer balance available for a remittance."));
    target.append(card);return;
  }
  const maximum=textNode("p","iv-balance","Outstanding insurance balance: "+usd(balance));
  const form=document.createElement("form");
  form.className="iv-remittance-form";
  form.autocomplete="off";
  form.innerHTML=
    '<label>Insurance company / payer name<input name="insurer" maxlength="100" minlength="2" placeholder="Insurance company" required></label>'+
    '<label>Payment amount ($)<input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" max="'+(balance/100).toFixed(2)+'" placeholder="0.00" required></label>'+
    '<label>Payment method<select name="method" required><option value="eft">EFT / electronic remittance</option><option value="check">Check</option><option value="ach">ACH (simulated)</option><option value="other">Other</option></select></label>'+
    '<label>Remittance reference<input name="reference" minlength="4" maxlength="80" placeholder="e.g. ERA-2026-1042" autocomplete="off" required></label>'+
    '<label class="iv-full">Payment note (optional)<textarea name="note" maxlength="300" rows="2" placeholder="Remittance information only; do not enter patient or banking details"></textarea></label>'+
    '<label class="iv-confirm iv-full"><input type="checkbox" name="confirm" required><span>I understand this submits a <strong>simulated remittance for staff approval</strong>. It does not transfer money or immediately mark the invoice paid.</span></label>'+
    '<button class="iv-pay-button iv-full" type="submit">Submit payment for review</button>';
  const feedback=textNode("p","iv-payment-feedback");
  feedback.setAttribute("role","status");feedback.setAttribute("aria-live","polite");
  card.append(maximum,form,feedback);
  target.append(card);
  form.addEventListener("submit",async ev=>{
    ev.preventDefault();
    feedback.textContent="";
    const insurer=String(form.elements.namedItem("insurer").value||"").trim();
    const cents=centsFromInput(form.elements.namedItem("amount").value);
    const method=String(form.elements.namedItem("method").value||"");
    const reference=String(form.elements.namedItem("reference").value||"").trim();
    const note=String(form.elements.namedItem("note").value||"").trim();
    if(insurer.length<2||insurer.length>100||cents===null||cents<1||cents>balance||
       !["eft","check","ach","other"].includes(method)||reference.length<4||
       reference.length>80||note.length>300||!form.elements.namedItem("confirm").checked){
      feedback.textContent="Check the insurer, amount, reference and confirmation. The payment cannot exceed the outstanding insurer balance.";
      return;
    }
    const submit=form.querySelector('button[type="submit"]');
    submit.disabled=true;submit.textContent="Submitting…";
    try{
      await setDoc(doc(store,"insuranceRemittanceRequests",verificationId),{
        simulated:true,
        encounterId:String(invoice.encounterId),
        invoiceNumber:String(invoice.invoiceNumber),
        verificationCode:String(invoice.verificationCode),
        amountCents:cents,
        insurerName:insurer,
        method,
        remittanceReference:reference,
        note,
        status:"pending",
        submittedAt:serverTimestamp(),
        reviewedAt:null,
        reviewedBy:"",
        reviewReason:"",
        receiptEventId:""
      });
      form.replaceWith(textNode("div","iv-payment-success",
        "Remittance submitted for Northstar Billing review. Reference: "+reference+". Amount: "+usd(cents)+". This is not a receipt or confirmation of payment; your invoice will be credited only after staff approval."));
      feedback.textContent="";
    }catch{
      feedback.textContent="This remittance could not be submitted. An earlier request may already use this verification code, or the invoice/code may have expired, been revoked or changed. Contact Northstar Billing for a fresh code.";
      submit.disabled=false;submit.textContent="Submit payment for review";
    }
  });
}
