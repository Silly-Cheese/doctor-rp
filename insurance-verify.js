// Public-only insurer lookup: no Firebase Authentication or access to private records.
import {initializeApp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {getFirestore,doc,getDocFromServer} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {attachInsuranceRemittance} from "./northstar-insurance-remittance.js";

const app=initializeApp({
  apiKey:"AIzaSyBPtNWvmmYl-6hFb7NlmNszapMwQH4Xm7I",
  authDomain:"doctor-rp.firebaseapp.com",
  projectId:"doctor-rp",
  storageBucket:"doctor-rp.firebasestorage.app",
  messagingSenderId:"76025336566",
  appId:"1:76025336566:web:b8507e26ce66d44c6b52d7"
});
const store=getFirestore(app);
const form=document.querySelector("#verificationForm");
const status=document.querySelector("#verificationStatus");
const output=document.querySelector("#verificationResult");
const currency=value=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format((Number(value)||0)/100);
const titleCase=value=>String(value||"Not specified").replaceAll("-"," ").replace(/\b\w/g,match=>match.toUpperCase());
const node=(tag,cls,value)=>{const item=document.createElement(tag);if(cls)item.className=cls;if(value!==undefined)item.textContent=value;return item;};

function renderResult(invoice){
  const fragment=document.createDocumentFragment();
  const heading=node("div","iv-verified");
  heading.append(node("span","iv-check","✓"),node("div","","Verified against current Northstar billing record"));
  fragment.append(heading);
  const grid=node("div","iv-summary");
  const summary=[
    ["Invoice",invoice.invoiceNumber],
    ["Invoice status",titleCase(invoice.status)],
    ["Claim status",titleCase(invoice.claimStatus)],
    ["Total charges",currency(invoice.chargeCents)],
    ["Expected insurance portion",currency(invoice.insuranceEstimatedCents)],
    ["Insurer payments recorded",currency(invoice.insuranceReceivedCents)],
    ["Outstanding insurer portion",currency(invoice.insurerBalanceCents)],
    ["Patient balance",currency(invoice.patientBalanceCents)],
    ["Waived",currency(invoice.waivedCents)],
    ["Listed insurance provider",invoice.insuranceProvider||"Not listed"]
  ];
  for(const [label,value]of summary){
    const cell=node("div","iv-summary-item");
    cell.append(node("span","",label),node("strong","",value));
    grid.append(cell);
  }
  fragment.append(grid);
  fragment.append(node("h3","","Invoice line items"));
  const table=node("table","iv-lines");
  const thead=node("thead"),headrow=node("tr");
  for(const label of ["Description","Qty","Unit","Amount"])headrow.append(node("th","",label));
  thead.append(headrow);table.append(thead);
  const tbody=node("tbody");
  for(const item of invoice.serviceLines||[]){
    const row=node("tr");
    for(const value of [item.description||"Service",String(item.quantity||1),currency(item.unitPriceCents),currency(item.amountCents)])row.append(node("td","",value));
    tbody.append(row);
  }
  table.append(tbody);fragment.append(table);
  fragment.append(node("p","iv-asof","Source last updated: "+(invoice.invoiceUpdatedAt?.toDate?.().toLocaleString()||"Not available")+" · Published: "+(invoice.publishedAt?.toDate?.().toLocaleString()||"Not available")));
  fragment.append(node("p","iv-disclaimer","This simulation verification does not prove insurance coverage, establish medical necessity, or authorize payment. Patient identity and clinical records are not included."));
  output.replaceChildren(fragment);output.hidden=false;
  attachInsuranceRemittance({target:output,store,invoice,verificationId:invoice.invoiceNumber+"-"+invoice.verificationCode});
}

form.addEventListener("submit",async event=>{
  event.preventDefault();output.hidden=true;output.replaceChildren();status.textContent="";
  const invoice=String(form.elements.namedItem("invoiceNumber").value||"").trim().toUpperCase();
  const code=String(form.elements.namedItem("verificationCode").value||"").trim().replace(/[\s-]/g,"").toUpperCase();
  if(!/^NMC-[A-Z0-9]{10}$/.test(invoice)||!/^[A-F0-9]{32}$/.test(code)){
    status.textContent="Enter a complete Northstar invoice number and 32-character verification code.";return;
  }
  const button=form.querySelector('button[type="submit"]');button.disabled=true;button.textContent="Checking invoice…";
  try{
    const record=await getDocFromServer(doc(store,"insuranceInvoiceVerifications",invoice+"-"+code));
    if(!record.exists()||record.get("invoiceNumber")!==invoice)throw Error("Unavailable");
    renderResult(record.data());status.textContent="";
  }catch{
    status.textContent="Invoice could not be verified. Check both values, or contact Northstar Billing for a current code. Revoked, expired, or revised invoices also require a new verification.";
  }finally{button.disabled=false;button.textContent="Verify invoice";}
});
