// Printable, self-contained Northstar simulation statements.
// Never copy UI DOM into a blank window: generated documents must own their print styles.
// Values are escaped so patient-entered or staff-entered text cannot inject markup.
const esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const currency=c=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format((Number(c)||0)/100);
function readableDate(input){
 if(!input)return "Not set";
 const date=input?.toDate?.()||(input?.seconds?new Date(input.seconds*1000):new Date(input));
 if(!(date instanceof Date)||Number.isNaN(date.getTime()))return "Not set";
 return date.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
}
function status(s){return String(s||"Open").replaceAll("-"," ").replace(/\b\w/g,c=>c.toUpperCase());}
const CSS=[
 "@page{size:letter;margin:0.65in 0.7in}",
 "*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#e9eff3;color:#19354b;font-size:12px;line-height:1.5}",
 ".toolbar{max-width:860px;margin:22px auto 0;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 20px;background:#102f45;color:white;border-radius:12px 12px 0 0}",
 ".toolbar strong{font-size:14px}.toolbar span{opacity:.8;font-size:12px}.tools{display:flex;gap:8px}.tools button{background:#fff;border:0;border-radius:8px;padding:10px 14px;cursor:pointer;color:#133951;font-weight:700}",
 ".sheet{max-width:860px;margin:0 auto 32px;padding:46px 50px 35px;min-height:1000px;background:#fff;box-shadow:0 10px 36px #10273825}",
 ".brand{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #0d5374;padding-bottom:26px;margin-bottom:28px}",
 ".brand-mark{display:flex;align-items:center;gap:15px}.monogram{width:50px;height:50px;background:#0d324a;border-radius:12px;color:#fff;font:bold 29px Georgia,serif;display:grid;place-items:center}",
 ".brand h1{font-size:18px;letter-spacing:.015em;margin:0}.brand small{display:block;color:#547588;font-size:11px;margin-top:4px;letter-spacing:.12em;text-transform:uppercase}",
 ".doc-heading{text-align:right}.doc-heading h2{margin:0;color:#0e5979;font-size:18px;text-transform:uppercase;letter-spacing:.08em}.doc-heading span{display:block;color:#6b8796;margin-top:5px}",
 ".summary{display:grid;grid-template-columns:1.1fr 1fr;gap:22px;margin-bottom:25px}",
 ".kicker{font-size:10px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:#648293;margin-bottom:7px}.patient-name{font-size:24px;font-weight:800;margin:0 0 5px}",
 ".info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.value{font-weight:700;overflow-wrap:anywhere}.muted{color:#657f8d}",
 ".status{display:inline-block;border-radius:20px;background:#e7f2f5;color:#0d5b79;padding:5px 10px;font-weight:800;font-size:10px;letter-spacing:.045em;text-transform:uppercase}",
 ".balance{display:flex;align-items:center;justify-content:space-between;gap:25px;background:#eff7fa;border:1px solid #cfe4ec;border-radius:13px;padding:18px 22px;margin:8px 0 30px;break-inside:avoid}",
 ".balance strong{display:block;font-size:30px;color:#0b4565;white-space:nowrap}.balance p{margin:4px 0 0;color:#57768a}.balance .kicker{margin-bottom:0}",
 "h3{font-size:15px;margin:26px 0 12px;color:#183d55}table{width:100%;border-collapse:collapse;border-spacing:0}",
 "thead th{background:#edf4f7;color:#356075;font-size:10px;text-transform:uppercase;letter-spacing:.08em;padding:12px 11px;text-align:left;border-bottom:1px solid #cfdee6}",
 "td{padding:12px 11px;border-bottom:1px solid #e3ebef;vertical-align:top;overflow-wrap:anywhere}th.number,td.number{text-align:right;white-space:nowrap}.service{font-weight:700}.sub{color:#6c8594;font-size:10px;margin-top:3px}",
 "tr{break-inside:avoid}tfoot td{font-weight:800;background:#f6fafc;border-bottom:0}",
 ".allocation{margin:18px 0 25px;margin-left:auto;max-width:350px}.allocation .line{display:flex;justify-content:space-between;gap:20px;padding:8px 0;border-bottom:1px solid #e1e9ed}.allocation .line:last-child{border:0;border-top:2px solid #c8dbe4;margin-top:6px;padding-top:12px;font-weight:800;font-size:15px}",
 ".notice{background:#f4f8fa;border-left:3px solid #397fa0;color:#4c7083;padding:13px 17px;border-radius:0 8px 8px 0;margin-top:20px;line-height:1.6}",
 ".audit{margin-top:36px;border-top:2px solid #b9d1dd;padding-top:16px}.audit .sub{max-width:530px}",
 ".footer{display:flex;justify-content:space-between;gap:12px;border-top:1px solid #d7e5ec;margin-top:42px;padding-top:14px;font-size:10px;color:#718994}",
 "@media(max-width:650px){.sheet{padding:24px 18px;min-height:auto}.brand{align-items:flex-start;gap:12px}.brand h1{font-size:15px}.monogram{width:40px;height:40px;font-size:24px}.summary{grid-template-columns:1fr}.doc-heading h2{font-size:14px}.balance strong{font-size:24px}.toolbar{border-radius:0;margin:0}.toolbar span{display:none}}",
 "@media print{@page{margin:0.55in 0.62in}.toolbar{display:none!important}body{background:white;color:#19354b;print-color-adjust:exact;-webkit-print-color-adjust:exact}.sheet{min-height:auto;max-width:none;box-shadow:none;margin:0;padding:0}.brand{margin-bottom:22px}.balance{margin-bottom:22px}.footer{margin-top:26px}.audit{break-before:auto}a{color:inherit;text-decoration:none}}"
].join("\n");

export function renderNorthstarStatement({invoice,events=[],patientName="",internal=false,generatedAt=new Date()}){
 if(!invoice||typeof invoice!=="object")throw Error("A valid invoice is required.");
 const a=invoice,name=patientName||a.patientName||"Patient",lines=Array.isArray(a.lineItems)?a.lineItems:[];
 const created=readableDate(a.createdAt),issued=readableDate(generatedAt),due=a.paymentDueDate?readableDate(a.paymentDueDate+"T12:00:00"):"Not set";
 const invoiceNumber=a.invoiceNumber||("NMC-"+String(a.encounterId||"").slice(0,10).toUpperCase());
 const claimNote=(a.insuranceEstimatedCents||0)>0?"Insurance estimates are provisional and are not proof of coverage or payment.":"No insurer payment is expected on this statement.";
 const table=lines.map((item,i)=>{
  const qty=Math.max(1,Number(item.quantity)||1),group=item.clinicalGroup||item.sourceType||"Service";
  return '<tr><td>'+(i+1)+'</td><td><div class="service">'+esc(item.description||"Service")+'</div><div class="sub">'+esc(status(group))+(internal?" · Rate version "+esc(item.rateVersion||1)+" · Source "+esc(item.sourceId||"manual"):"")+'</div></td>'+
   '<td class="number">'+qty+'</td><td class="number">'+currency(item.unitPriceCents)+'</td><td class="number"><b>'+currency(item.amountCents)+'</b></td></tr>';
 }).join("");
 const audit=internal?'<section class="audit"><h3>Internal financial activity</h3><p class="muted">Restricted staff copy · not part of the patient-facing statement</p>'+
  '<table><thead><tr><th>Date</th><th>Activity</th><th class="number">Amount</th><th>Details / recorded by</th></tr></thead><tbody>'+
  (events.length?events.map(e=>'<tr><td>'+esc(readableDate(e.createdAt))+'</td><td>'+esc(status(e.action))+'</td><td class="number">'+currency(e.amountCents||0)+'</td><td>'+esc([e.detail,e.reason,e.actorUid].filter(Boolean).join(" · "))+'</td></tr>').join(""):'<tr><td colspan="4">No ledger adjustments recorded</td></tr>')+
  '</tbody></table><p class="muted">Internal notes: '+esc(a.notes||"None")+'. Waiver authorization: '+esc(a.waiverReason||"None")+'.</p></section>':"";
 const safeTitle=(internal?"Northstar Internal Ledger":"Northstar Patient Statement")+" - "+invoiceNumber;
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>'+esc(safeTitle)+'</title><style>'+CSS+'</style></head><body>'+
  '<div class="toolbar"><div><strong>Northstar Medical Center</strong><br><span>'+(internal?"Internal billing ledger":"Printable patient statement")+'</span></div><div class="tools"><button type="button" onclick="window.print()">Print / Save PDF</button><button type="button" onclick="window.close()">Close</button></div></div>'+
  '<main class="sheet"><header class="brand"><div class="brand-mark"><div class="monogram" aria-hidden="true">N</div><div><h1>Northstar Medical Center</h1><small>Clinical Information System</small></div></div><div class="doc-heading"><h2>'+(internal?"Internal Billing Ledger":"Patient Statement")+'</h2><span>SIMULATION · NOT A REAL BILL</span></div></header>'+
  '<section class="summary"><div><div class="kicker">Statement for</div><div class="patient-name">'+esc(name)+'</div><span class="status">'+esc(status(a.status))+'</span></div>'+
  '<div class="info-grid"><div><div class="kicker">Invoice number</div><div class="value">'+esc(invoiceNumber)+'</div></div><div><div class="kicker">Created</div><div class="value">'+esc(created)+'</div></div>'+
  '<div><div class="kicker">Statement date</div><div class="value">'+esc(issued)+'</div></div><div><div class="kicker">Due date</div><div class="value">'+esc(due)+'</div></div></div></section>'+
  '<section class="balance"><div><div class="kicker">Current patient responsibility</div><p>'+esc(claimNote)+'</p></div><div><strong>'+currency(a.patientBalanceCents)+'</strong></div></section>'+
  '<h3>Itemized Services</h3><table><thead><tr><th>#</th><th>Service / Description</th><th class="number">Qty</th><th class="number">Unit rate</th><th class="number">Amount</th></tr></thead><tbody>'+
  (table||'<tr><td colspan="5">No itemized services</td></tr>')+
  '</tbody><tfoot><tr><td colspan="4" class="number">Total charges</td><td class="number">'+currency(a.chargeCents)+'</td></tr></tfoot></table>'+
  '<div class="allocation"><div class="line"><span>Estimated insurer portion</span><b>'+currency(a.insuranceEstimatedCents)+'</b></div>'+
  '<div class="line"><span>Adjustments / waived</span><b>−'+currency(a.waivedCents)+'</b></div>'+
  '<div class="line"><span>Patient responsibility</span><b>'+currency(a.patientResponsibilityCents)+'</b></div>'+
  '<div class="line"><span>Recorded patient payments</span><b>−'+currency(a.patientPaidCents)+'</b></div>'+
  '<div class="line"><span>Patient balance</span><b>'+currency(a.patientBalanceCents)+'</b></div></div>'+
  '<div class="notice"><strong>Billing details</strong><div>Insurer: '+esc(a.insuranceEstimatedCents>0?(a.insuranceProvider||"Not specified"):"None / self-pay")+'</div>'+
  (a.insurerBalanceCents>0?'<div>Estimated insurer balance: '+currency(a.insurerBalanceCents)+' (not a payment received)</div>':"")+
  '<div>This statement is part of a hospital simulation. It does not request payment, transmit an insurance claim, or establish a real financial obligation.</div></div>'+
  audit+'<footer class="footer"><span>Northstar Medical Center · '+(internal?"Confidential staff ledger":"Patient statement")+'</span><span>'+esc(invoiceNumber)+'</span></footer></main></body></html>';
}
export function openNorthstarStatement(opts){
 const content=renderNorthstarStatement(opts);
 const windowRef=window.open("","_blank","width=980,height=760");
 if(!windowRef)throw Error("The browser blocked the print window. Allow pop-ups for Northstar and retry.");
 windowRef.document.open();windowRef.document.write(content);windowRef.document.close();windowRef.focus();
 return windowRef;
}
