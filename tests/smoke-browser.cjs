const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({headless:true,args:["--no-sandbox"]});
  const page = await browser.newPage({viewport:{width:1365,height:900}});
  const errors = [], missing = [];
  page.on("pageerror", err => errors.push(err.message));
  page.on("response", res => {
    if(res.url().startsWith("http://127.0.0.1:8765/") && res.status() >= 400)
      missing.push(res.status()+" "+res.url());
  });
  try {
    await page.goto("http://127.0.0.1:8765/", {waitUntil:"domcontentloaded",timeout:30000});
    await page.waitForTimeout(12000);
    const expected = {
      "SIU":"#northstarSIU",
      "Billing navigation":"#enterprise-billing",
      "Staff workdesk":"#northstarWorkdesk",
      "Workflow navigator":"#northstarExperience",
      "Operations Center":"#nsOperationsRoot",
      "Emergency intake":"#nsEmergency",
      "Navigation recovery":"#nsNav-nsEmergencyLaunch"
    };
    const retiredVisible=await page.locator("#nmcDeleteUi, #nmcDeleteOpen, #nsNav-nmcDeleteOpen").count();
    const states = {};
    for(const [name,selector] of Object.entries(expected))
      states[name] = await page.locator(selector).count() > 0;
    console.log("Module presence:",JSON.stringify(states));
    if(errors.length)console.error("Page exceptions:",JSON.stringify(errors));
    if(missing.length)console.error("Failed local asset responses:",JSON.stringify(missing));
    const absent=Object.entries(states).filter(([,ok])=>!ok).map(([name])=>name);
    if(retiredVisible)absent.push("Retired patient deletion control still exists");
    // Simulate an authorized module becoming visible after authentication.
    // The sidebar should reveal and hide the same destination without reloading.
    const billingPanel=await page.locator("#dischargeForm .nmc-bill-fields").count()>0;
    if(!billingPanel)absent.push("Mandatory discharge billing form");
    const billingModels=await page.evaluate(async ()=>{
      const {billingFieldsMarkup,buildBillingRecord}=await import("./northstar-billing.js");
      function run(mode,charge,insurer="",covered="",waiver="",reason=""){
        const form=document.createElement("form");form.innerHTML=billingFieldsMarkup();
        for(const [name,value] of Object.entries({billingMode:mode,billingCharge:charge,billingInsurer:insurer,billingInsurance:covered,billingWaiver:waiver,billingWaiverReason:reason})){
          const input=form.querySelector('[name="'+name+'"]');if(input)input.value=value;
        }
        const item={serviceId:"visit",description:"Emergency Visit",sourceType:"visit",sourceId:"visit:encounter123",quantity:1,unitPriceCents:Math.round(Number(charge)*100),amountCents:Math.round(Number(charge)*100),rateVersion:1};
        form.dataset.billingReady="yes";form.dataset.billingLines=JSON.stringify([item]);
        return buildBillingRecord(form,{id:"encounter123",patientId:"patient123",patientName:"Example Patient"},"doctor123");
      }
      const patient=run("patient","300");
      const insurer=run("insurance","300","Example Plan");
      const split=run("split","300","Example Plan","150","50","Charity award");
      const waived=run("waived","300","","","","Uninsured assistance");
      let rejected=false;
      try{run("split","300","Example Plan","250","100","Not permitted");}catch(e){rejected=true}
      return patient.patientBalanceCents===30000
        && insurer.insurerBalanceCents===30000 && insurer.patientBalanceCents===0
        && split.patientBalanceCents===10000 && split.waivedCents===5000
        && waived.status==="waived" && waived.patientBalanceCents===0 && rejected;
    });
    if(!billingModels)absent.push("Billing insurance, patient, split and waiver calculation");
    const fullPage=await page.evaluate(()=>{
      const dialog=document.getElementById("nsOpsDialog");
      const section=document.getElementById("nmcPage-nsOpsDialog");
      if(!dialog||!section||typeof dialog.showModal!=="function")return false;
      dialog.showModal();
      const good=!section.classList.contains("hidden")&&dialog.open&&!dialog.matches(":modal");
      dialog.close();
      return good;
    });
    if(!fullPage)absent.push("Operations navigation must open a full page");
    const catalogPage=await page.evaluate(async ()=>{
      const {renderServiceCatalog}=await import("./northstar-service-catalog.js");
      const container=document.createElement("div");document.body.append(container);
      renderServiceCatalog({target:container,records:[{id:"test",name:"Emergency Visit",kind:"visit",priceCents:15000,active:true,version:1}],profile:{role:"administrator",status:"active"}});
      const deleteButton=container.querySelector(".nmc-catalog-delete");
      deleteButton?.click();
      const modal=document.querySelector(".nmc-catalog-delete-dialog");
      const good=!!container.querySelector("#nmcCatalogForm")&&container.textContent.includes("Emergency Visit")
        &&!!deleteButton&&!!modal?.open&&modal.textContent.includes("Previously issued invoices");
      modal?.close();
      container.remove();return good;
    });
    if(!catalogPage)absent.push("Full-page service price editor");
    const catalogQuote=await page.evaluate(async ()=>{
      const {buildCatalogQuote}=await import("./northstar-service-catalog.js");
      const q=buildCatalogQuote({encounterId:"e123",
        catalog:[
          {id:"fee",name:"Emergency Visit",kind:"visit",priceCents:12000,active:true,version:3},
          {id:"lab",name:"CBC",kind:"order",priceCents:4500,active:true,version:2},
          {id:"proc",name:"Wound Repair",kind:"procedure",priceCents:9500,active:true,version:1}
        ],
        orders:[{id:"o1",data:{name:"CBC",status:"ordered"}},{id:"o2",data:{name:"Cancelled Service",status:"cancelled"}}],
        procedures:[{id:"p1",data:{name:"Wound Repair",status:"complete"}},{id:"p2",data:{name:"Not Performed",status:"planned"}}]
      });
      return q.totalCents===26000&&q.unpriced.length===0&&q.lines.length===3&&q.lines.find(x=>x.serviceId==="lab")?.rateVersion===2;
    });
    if(!catalogQuote)absent.push("Automatic line item quote and rate snapshot");
    const extendedPricing=await page.evaluate(async ()=>{
      const {buildCatalogQuote,renderServiceCatalog}=await import("./northstar-service-catalog.js");
      const catalog=[
        {id:"a",kind:"visit",name:"Emergency Visit",priceCents:12000,active:true,version:1},
        {id:"e",kind:"ems",name:"EMS Transport",priceCents:35000,active:true,version:1},
        {id:"r",kind:"room",name:"Trauma Room",priceCents:25000,active:true,version:1},
        {id:"o",kind:"order",name:"CBC with Differential",priceCents:2000,active:true,version:1}
      ];
      const q=buildCatalogQuote({encounterId:"case1",catalog,encounter:{arrivalMethod:"EMS",room:"TR-01",department:"Emergency Department"},
       orders:[{id:"o1",data:{name:"CBC with Differential",status:"ordered"}}],procedures:[],admissions:[]});
      const container=document.createElement("div");document.body.append(container);
      renderServiceCatalog({target:container,records:[],profile:{status:"active",role:"administrator"}});
      const type=container.querySelector("#nmcCatalogKind"),name=container.querySelector("#nmcCatalogTemplate");
      type.value="ems";type.dispatchEvent(new Event("change"));
      const ems=[...name.options].map(x=>x.value);
      type.value="room";type.dispatchEvent(new Event("change"));
      const room=[...name.options].map(x=>x.value);
      type.value="order";type.dispatchEvent(new Event("change"));
      const clinical=[...name.options].map(x=>x.value);
      container.remove();
      return q.totalCents===74000&&q.unpriced.length===0
        && q.lines.length===4&&ems.includes("EMS Transport")
        && room.includes("Trauma Room")&&clinical.includes("CBC with Differential");
    });
    if(!extendedPricing)absent.push("EMS and room automatic charges or service dropdown");
    const bulkPricing=await page.evaluate(async ()=>{
      const {createPriceCandidates,parsePriceCSV,serializePriceCSV,canonicalRateId,validatePriceAmount}=await import("./northstar-pricing-bulk-data.js");
      const {renderServiceCatalog}=await import("./northstar-service-catalog.js");
      const candidates=createPriceCandidates([{id:"rate1",kind:"order",name:"Ceftriaxone",priceCents:3400}],[]);
      if(!candidates.some(x=>x.group==="antibiotics"&&x.name==="Ceftriaxone"))return false;
      if(!candidates.some(x=>x.kind==="order"&&x.name==="CBC with Differential"))return false;
      if(canonicalRateId("order","CBC with Differential")!=="order_cbc-with-differential")return false;
      if(validatePriceAmount("34.50")!==3450)return false;
      const csv=serializePriceCSV([{group:"antibiotics",kind:"order",name:"Trimethoprim-Sulfamethoxazole",price:"41.25",code:"AB-1"},
        {group:"laboratory",kind:"order",name:"CBC, with Differential",price:"31.00",code:"LAB-1"}]);
      const imported=parsePriceCSV(csv);
      if(imported.length!==2||imported[1].name!=="CBC, with Differential"||imported[0].priceCents!==4125)return false;
      const host=document.createElement("div");document.body.append(host);
      renderServiceCatalog({target:host,records:[{id:"rate1",kind:"order",name:"Ceftriaxone",priceCents:3400,active:true,version:1}],
       profile:{role:"administrator",status:"active",permissions:{}}});
      const category=host.querySelector("#nmcBulkGroup");
      const missing=host.querySelector("#nmcBulkMissing");
      if(!category||!missing.checked)return false;
      category.value="antibiotics";category.dispatchEvent(new Event("change"));
      const existing=host.querySelector("#nmcBulkRows")?.textContent||"";
      if(existing.includes("Ceftriaxone"))return false;
      host.querySelector("#nmcBulkSelectGroup").click();
      host.querySelector("#nmcBulkPrice").value="25.25";
      host.querySelector("#nmcBulkApply").click();
      const priced=host.querySelectorAll('#nmcBulkRows input.nmc-bulk-rate');
      const all=[...priced].every(x=>x.value==="25.25");
      const ready=!host.querySelector("#nmcBulkSave").disabled;
      host.remove();
      return all&&ready&&priced.length>10;
    });
    if(!bulkPricing)absent.push("Bulk medication/antibiotic pricing category and CSV workflow");
    const clinicalAndBilling=await page.evaluate(async ()=>{
      const {ORDER_GROUPS,buildClinicalChoices,selectOrderChoice}=await import("./northstar-clinical-order-data.js");
      const {buildCatalogQuote}=await import("./northstar-service-catalog.js");
      const {summarizeBilling,exportBillingCSV}=await import("./northstar-billing-insights.js");
      const rate={id:"order_ceftriaxone",name:"Ceftriaxone",kind:"order",priceCents:7300,code:"AB-CF",active:true,version:5};
      const choices=buildClinicalChoices([rate]);
      const antibiotics=selectOrderChoice(choices,"antibiotics","Ceftriaxone");
      const labs=selectOrderChoice(choices,"laboratory","CBC with Differential");
      const imaging=selectOrderChoice(choices,"imaging","Chest X-Ray — 2 Views");
      const groups=new Set(ORDER_GROUPS.map(g=>g.id));
      if(!antibiotics||antibiotics.category!=="medication"||antibiotics.serviceCode!=="AB-CF"||antibiotics.catalogId!==rate.id)return false;
      if(!labs||!imaging||!groups.has("fluids")||!groups.has("monitoring"))return false;
      const quoted=buildCatalogQuote({encounterId:"testenc",catalog:[rate],encounter:{},
        orders:[{id:"order1",data:{name:"Renamed Service",category:"medication",orderGroup:"antibiotics",serviceCode:"AB-CF",catalogRateId:rate.id,status:"ordered"}}],
        procedures:[],admissions:[]});
      if(quoted.totalCents!==7300||quoted.unpriced.length||quoted.lines[0].clinicalGroup!=="antibiotics")return false;
      const accounts=[{encounterId:"testenc",patientId:"patient",patientName:"Demo",chargeCents:10000,
        patientPaidCents:1200,insuranceReceivedCents:2500,waivedCents:1000,
        patientBalanceCents:2300,insurerBalanceCents:3000,paymentDueDate:"2026-01-01",claimStatus:"pending"}];
      const stats=summarizeBilling(accounts,[{id:"oldenc",patientId:"patient",status:"discharged"}],new Date("2026-10-26T15:00:00"));
      if(stats.overdue!==1||stats.unbilled!==1||stats.claimsToReview!==1||stats.collected!==3700||stats.waived!==1000)return false;
      const csv=exportBillingCSV(accounts,[]);
      if(!csv.includes("invoice")||!csv.includes("testenc"))return false;
      const standard=document.querySelector("#clinicalOrderForm");
      if(standard&&(!standard.querySelector("#orderGroup")||standard.querySelector("#orderName")?.tagName!=="SELECT"))return false;
      const advanced=document.querySelector("#orderCatalogDialog");
      if(advanced&&(!advanced.querySelector("#nmcCatalogOrderGroup")||!advanced.querySelector("#nmcCatalogOrderName")))return false;
      return true;
    });
    if(!clinicalAndBilling)absent.push("Matched clinical order groups and improved billing analytics");
    const printableInvoice=await page.evaluate(async ()=>{
      const {renderNorthstarStatement}=await import("./northstar-invoice-print.js");
      const {canAddManualService}=await import("./northstar-billing.js");
      if(canAddManualService([{serviceId:"ibuprofen",sourceType:"order"}],"ibuprofen"))return false;
      if(!canAddManualService([{serviceId:"ibuprofen"}],"xray"))return false;
      const fake={invoiceNumber:"NMC-TEST-001",encounterId:"test-encounter",patientName:"Example <Patient>",
        status:"open",claimStatus:"not-applicable",chargeCents:23000,insuranceEstimatedCents:0,
        waivedCents:10000,patientResponsibilityCents:13000,patientPaidCents:8000,patientBalanceCents:5000,
        insurerBalanceCents:0,insuranceProvider:"",paymentDueDate:"2026-11-04",createdAt:new Date("2026-10-26T12:00:00"),
        notes:"Internal-only example",waiverReason:"Waiver authorization hidden",
        lineItems:[{description:"Emergency Room",quantity:1,unitPriceCents:20000,amountCents:20000,rateVersion:3,sourceId:"internal-id"},
        {description:"Test <X-Ray>",quantity:1,unitPriceCents:3000,amountCents:3000,rateVersion:1}]};
      const ledger=[{action:"waiver",amountCents:10000,reason:"Internal waiver",actorUid:"staff-uid-123",createdAt:new Date("2026-10-26T12:00:00")}];
      const publicHtml=renderNorthstarStatement({invoice:fake,events:ledger});
      const internalHtml=renderNorthstarStatement({invoice:fake,events:ledger,internal:true});
      if(!publicHtml.includes("Northstar Medical Center")||!publicHtml.includes("@page")||!publicHtml.includes("Print / Save PDF"))return false;
      if(publicHtml.includes("staff-uid-123")||publicHtml.includes("Internal-only example")||publicHtml.includes("Waiver authorization hidden"))return false;
      if(!internalHtml.includes("staff-uid-123")||!internalHtml.includes("Internal billing ledger"))return false;
      if(publicHtml.includes("Test <X-Ray>")||!publicHtml.includes("Test &lt;X-Ray&gt;"))return false;
      const frame=document.createElement("iframe");frame.style.width="900px";frame.style.height="1100px";
      frame.srcdoc=publicHtml;document.body.append(frame);
      await new Promise((resolve,reject)=>{frame.addEventListener("load",resolve,{once:true});setTimeout(()=>reject(new Error("Statement frame did not load")),6000)});
      const body=frame.contentDocument;
      const sheet=body.querySelector(".sheet"),rows=body.querySelectorAll("tbody tr");
      const good=rows.length===2&&!!body.querySelector(".brand")&&!!body.querySelector(".balance")&&
        getComputedStyle(sheet).backgroundColor==="rgb(255, 255, 255)"&&body.querySelector(".balance").textContent.includes("$50.00");
      frame.remove();return good;
    });
    if(!printableInvoice)absent.push("Branded patient statement, internal ledger privacy or duplicate-charge safeguard");
    const billingQueueUI=await page.evaluate(async ()=>{
      const {renderBillingPage}=await import("./northstar-billing.js");
      const root=document.createElement("div");document.body.append(root);
      const accounts=[
       {encounterId:"encA",patientId:"pA",patientName:"Taylor Example",invoiceNumber:"NMC-A",status:"open",claimStatus:"not-applicable",chargeCents:30000,
        patientBalanceCents:17500,insurerBalanceCents:0,waivedCents:3000,patientPaidCents:0,insuranceReceivedCents:0,paymentDueDate:"2026-01-01"},
       {encounterId:"encB",patientId:"pB",patientName:"Morgan Example",invoiceNumber:"NMC-B",status:"insurance-pending",claimStatus:"pending",chargeCents:50000,
        patientBalanceCents:3000,insurerBalanceCents:30000,waivedCents:0,patientPaidCents:0,insuranceReceivedCents:0,paymentDueDate:""}
      ];
      renderBillingPage({target:root,records:accounts,encounters:[{id:"old",patientId:"pC",status:"discharged"}],patients:[],
       profile:{role:"administrator",status:"active",permissions:{}}});
      const cards=root.querySelectorAll(".nmc-bill-queue-actions button");
      const sort=root.querySelector("#nmcAccountSort");
      if(cards.length!==3||!sort||!root.querySelector("#nmcAccountExport"))return false;
      const rows=root.querySelector("#nmcAccountRows");
      if(!rows?.textContent.includes("Taylor Example")||!rows.textContent.includes("Morgan Example"))return false;
      const patientGroups=root.querySelectorAll(".nmc-patient-account");
      if(patientGroups.length!==3)return false;
      root.querySelector('[data-billing-queue="overdue"]').click();
      if(!rows.textContent.includes("Taylor Example")||rows.textContent.includes("Morgan Example"))return false;
      root.querySelector('[data-billing-queue="claim-review"]').click();
      const ok=rows.textContent.includes("Morgan Example")&&!rows.textContent.includes("Taylor Example")
        &&!!root.querySelector("#nmcBulkWaiveOpen");
      root.remove();return ok;
    });
    if(!billingQueueUI)absent.push("Billing work queue, search filters and report controls");
    const billingOps=await page.evaluate(async()=>{
      const {overrideCharge,waiveAccount,groupPatientInvoices,filterBilling}=await import("./northstar-billing-operations.js");
      const example={encounterId:"case1",patientId:"patient1",patientName:"Case Example",chargeCents:100000,
       insuranceEstimatedCents:30000,insuranceReceivedCents:5000,patientPaidCents:20000,waivedCents:10000,
       lineItems:[{description:"Emergency Visit",amountCents:80000,sourceType:"visit"},{description:"Room",amountCents:20000,sourceType:"room"}]};
      const waiver=waiveAccount(example);
      if(waiver.patientBalanceCents!==0||waiver.waivedCents!==50000||waiver.insurerBalanceCents!==25000)return false;
      const full=waiveAccount(example,{includeInsurance:true});
      if(full.waivedCents!==75000||full.insuranceEstimatedCents!==5000||full.patientBalanceCents!==0||full.insurerBalanceCents!==0)return false;
      const changed=overrideCharge(example,{mode:"line",itemIndex:1,newAmountCents:15000,reason:"Correct room charge"});
      if(changed.account.chargeCents!==95000||changed.delta!==-5000||changed.account.lineItems.length!==3)return false;
      const changedTotal=overrideCharge(example,{mode:"total",newAmountCents:150000,reason:"Updated all charges"});
      if(changedTotal.account.chargeCents!==150000||changedTotal.delta!==50000)return false;
      try{overrideCharge(example,{mode:"total",newAmountCents:10000,reason:"Below paid money"});return false;}catch(e){}
      const grouped=groupPatientInvoices([{patientId:"patient1",chargeCents:10000,patientBalanceCents:4000},
         {patientId:"patient1",chargeCents:20000,patientBalanceCents:2000}],[{id:"patient1",displayName:"Case Example"}]);
      if(grouped.length!==1||grouped[0].records.length!==2||grouped[0].patientBalanceCents!==6000)return false;
      const filtered=filterBilling([{encounterId:"1",patientId:"patient1",invoiceNumber:"NMC-1",status:"open",chargeCents:20000,
       patientBalanceCents:2000,paymentDueDate:"2026-01-01",createdAt:new Date("2026-01-01")},
       {encounterId:"2",patientId:"patient2",status:"paid",chargeCents:12000,patientBalanceCents:0,createdAt:new Date("2026-09-01")}],
       {olderThan:"2026-02-01",now:"2026-10-26",overdueOnly:true});
      return filtered.length===1&&filtered[0].encounterId==="1";
    });
    if(!billingOps)absent.push("Admin waiver and line override arithmetic / patient grouping filters");
    // The order catalog contains long medication and diagnostic lists.
    // Verify its scrollable body works without clipping the header at both desktop and mobile sizes.
    const orderScroll=await page.evaluate(()=>{
      const dialog=document.querySelector("#orderCatalogDialog"),body=dialog?.querySelector(".order-catalog-body");
      const rows=dialog?.querySelector("#orderCatalogList");
      if(!dialog||!body||!rows)return false;
      const original=rows.innerHTML;
      rows.innerHTML=Array.from({length:65},(_,i)=>'<article class="order-catalog-row"><div><strong>Order '+(i+1)+'</strong><small>Test catalog entry</small></div><button type="button">Select</button></article>').join("");
      dialog.showModal();
      const header=dialog.querySelector(".modal-header"),before=header.getBoundingClientRect();
      const scrollable=body.scrollHeight>body.clientHeight+150&&getComputedStyle(body).overflowY==="auto";
      body.scrollTop=body.scrollHeight;
      const moved=body.scrollTop>150;
      const after=header.getBoundingClientRect();
      const stable=Math.abs(after.y-before.y)<2;
      window.__nmcOrderScrollCleanup=()=>{dialog.close();rows.innerHTML=original;};
      return scrollable&&moved&&stable;
    });
    if(!orderScroll)absent.push("Desktop order catalog vertical scrolling");
    await page.setViewportSize({width:390,height:650});
    const mobileOrderScroll=await page.evaluate(()=>{
      const dialog=document.querySelector("#orderCatalogDialog"),body=dialog?.querySelector(".order-catalog-body");
      if(!dialog?.open||!body)return false;
      body.scrollTop=0;
      const height=dialog.getBoundingClientRect().height;
      body.scrollTop=700;
      const moved=body.scrollTop>150;
      const withinScreen=height<=window.innerHeight-8;
      window.__nmcOrderScrollCleanup?.();
      delete window.__nmcOrderScrollCleanup;
      return moved&&withinScreen;
    });
    if(!mobileOrderScroll)absent.push("Mobile order catalog vertical scrolling");
    await page.setViewportSize({width:1365,height:900});
    const editableDischargeCharges=await page.evaluate(async()=>{
      const {billingFieldsMarkup,bindBillingPreview,renderDischargeChargeReview,buildBillingRecord}=await import("./northstar-billing.js");
      const form=document.createElement("form");form.innerHTML=billingFieldsMarkup();document.body.append(form);
      form.querySelector('[name="billingMode"]').value="patient";
      bindBillingPreview(form);
      const sample=[
        ["Emergency Visit",77500,"visit"],
        ["EMS Transport",92500,"ems"],
        ["Observation Room",92500,"room"],
        ["Morphine",14000,"order"],
        ["EMERGENCY SURGERY",1650000,"procedure"]
      ].map(([description,price,kind],i)=>({description,serviceId:"srv"+i,sourceId:"source"+i,sourceType:kind,
        unitPriceCents:price,amountCents:price,quantity:1,rateVersion:1}));
      renderDischargeChargeReview(form,{lines:sample,unpriced:[],catalog:[]});
      const initial=1926500,charge=form.querySelector('[name="billingCharge"]');
      if(Number(charge.value)!==initial/100||form.querySelectorAll(".nmc-discharge-charge-row").length!==5)return false;
      // Every automatically added line (not just a manual addition) must have both actions.
      if(form.querySelectorAll(".nmc-discharge-remove").length!==5)return false;
      const remove=form.querySelectorAll(".nmc-discharge-remove")[1];remove.click();
      if(Number(charge.value)!==(initial-92500)/100||form.dataset.billingReady!=="yes")return false;
      const undo=form.querySelector(".nmc-discharge-removed-row button");if(!undo)return false;undo.click();
      if(Number(charge.value)!==initial/100)return false;
      form.querySelectorAll(".nmc-discharge-charge-row")[0].querySelector("button").click();
      const editor=form.querySelector(".nmc-discharge-edit");
      if(!editor)return false;
      editor.querySelector('[name="unitPrice"]').value="500";
      editor.querySelector('[name="quantity"]').value="2";
      editor.querySelector('[name="reason"]').value="Corrected facility billing";
      let accidentalSubmit=false;form.addEventListener("submit",e=>{e.preventDefault();accidentalSubmit=true});
      editor.querySelector(".nmc-discharge-save").click();
      if(accidentalSubmit||Number(charge.value)!==(initial-77500+100000)/100)return false;
      const record=buildBillingRecord(form,{id:"encounter123",patientId:"patient123",patientName:"Example Patient"},"doctor123");
      if(record.chargeCents!==initial-77500+100000||record.lineItems[0].unitPriceCents!==50000||
          record.lineItems[0].quantity!==2||!record.notes.includes("Corrected facility billing"))return false;
      form.querySelectorAll(".nmc-discharge-remove")[3].click();
      const finalRecord=buildBillingRecord(form,{id:"encounter123",patientId:"patient123",patientName:"Example Patient"},"doctor123");
      const ok=finalRecord.lineItems.length===4&&finalRecord.notes.includes("Excluded")&&
        finalRecord.lineItems.every(x=>x.description!=="Morphine");
      form.remove();
      return ok;
    });
    if(!editableDischargeCharges)absent.push("Discharge edit/remove, undo, live recalculation or invoice audit notes");
    const mismatchedServiceRecovery=await page.evaluate(async()=>{
      const {buildCatalogQuote}=await import("./northstar-service-catalog.js");
      const {billingFieldsMarkup,bindBillingPreview,renderDischargeChargeReview,buildBillingRecord}=await import("./northstar-billing.js");
      const catalog=[{id:"surgeryPrice",kind:"service",name:"EMERGENCY SURGERY",priceCents:1650000,active:true,version:1}];
      const matched=buildCatalogQuote({encounterId:"x",catalog,orders:[],procedures:[{id:"procOne",data:{name:"EMERGENCY SURGERY",status:"completed"}}]});
      if(matched.unpriced.length!==0||matched.lines.length!==1||matched.totalCents!==1650000||matched.lines[0].sourceType!=="procedure")throw Error("Cross-category procedure billing still fails");
      const form=document.createElement("form");form.innerHTML=billingFieldsMarkup();document.body.append(form);
      form.querySelector('[name="billingMode"]').value="patient";bindBillingPreview(form);
      const visit={serviceId:"visit",description:"Emergency Visit",sourceType:"visit",sourceId:"v1",quantity:1,unitPriceCents:77500,amountCents:77500,rateVersion:1};
      const procedure={kind:"procedure",name:"EMERGENCY SURGERY",sourceId:"procOne"};
      const manual={serviceId:"surgeryPrice",description:"EMERGENCY SURGERY",sourceType:"manual",sourceId:"manual:surgeryPrice",quantity:1,unitPriceCents:1650000,amountCents:1650000,rateVersion:1};
      renderDischargeChargeReview(form,{lines:[visit,manual],unpriced:[procedure],catalog:[]});
      if(form.dataset.billingReady!=="yes"||form.querySelector(".nmc-discharge-unpriced"))throw Error("An existing manual charge did not resolve clinical unpriced service");
      if(JSON.parse(form.dataset.billingLines).filter(x=>x.description==="EMERGENCY SURGERY").length!==1)throw Error("Double-billed existing surgery charge");
      const remove=form.querySelectorAll(".nmc-discharge-remove")[1];remove.click();
      if(form.dataset.billingReady!=="no"||!form.querySelector(".nmc-discharge-unpriced"))throw Error("Missing item must reappear when its matching charge is removed");
      form.querySelector(".nmc-discharge-removed-row button").click();
      if(form.dataset.billingReady!=="yes")throw Error("Undo did not restore matching charge");
      renderDischargeChargeReview(form,{lines:[visit],unpriced:[procedure],catalog:[]});
      if(form.dataset.billingReady!=="no")throw Error("Unresolved clinical service should require action");
      form.querySelector(".nmc-discharge-unpriced-row button").click();
      const editor=form.querySelector(".nmc-unpriced-editor");
      editor.querySelector('input[type="number"]').value="16500.00";
      editor.querySelector('input[type="text"]').value="One-time procedure correction";
      editor.querySelector(".nmc-discharge-save").click();
      const saved=buildBillingRecord(form,{id:"x",patientId:"p",patientName:"Demo"},"staff");
      if(saved.lineItems.length!==2||saved.chargeCents!==1727500||!saved.notes.includes("One-time procedure correction"))throw Error("One-time clinical service price did not clear missing service or retain reason");
      renderDischargeChargeReview(form,{lines:[visit],unpriced:[procedure],catalog:[]});
      form.querySelector(".nmc-discharge-unpriced-row button:last-child").click();
      const excludeEditor=form.querySelector(".nmc-unpriced-editor");
      excludeEditor.querySelector('input[type="text"]').value="Already included in package";
      excludeEditor.querySelector(".nmc-discharge-save").click();
      const excluded=buildBillingRecord(form,{id:"x",patientId:"p",patientName:"Demo"},"staff");
      if(excluded.lineItems.length!==1||!excluded.notes.includes("Already included in package"))throw Error("Excluded clinical service still blocks discharge or did not record justification");
      form.remove();
      return true;
    });
    if(!mismatchedServiceRecovery)absent.push("Unpriced clinical surgery resolved with existing line, one-time price or exclusion");
    const navSync = await page.evaluate(async () => {
      const launch=document.getElementById("nsEmergencyLaunch");
      const navigation=document.getElementById("nsNav-nsEmergencyLaunch");
      if(!launch||!navigation)return false;
      launch.hidden=false;
      await new Promise(resolve=>setTimeout(resolve,150));
      const shown=!navigation.hidden;
      launch.hidden=true;
      await new Promise(resolve=>setTimeout(resolve,150));
      return shown&&navigation.hidden;
    });
    if(!navSync)absent.push("Sidebar permission visibility synchronization");
    if(absent.length || missing.length || errors.some(x=>/SyntaxError|Unexpected token|is not defined|No Firebase App|Cannot access .* before initialization/i.test(x))) {
      console.error("Smoke test failed",JSON.stringify({absent,missing,errors}));
      process.exitCode=1;
    }
  } finally {await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});
