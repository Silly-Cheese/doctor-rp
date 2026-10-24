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
