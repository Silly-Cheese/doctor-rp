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
