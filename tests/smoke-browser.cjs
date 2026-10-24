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
      "Deletion administration":"#nmcDeleteUi",
      "Navigation recovery":"#nsNav-nsEmergencyLaunch"
    };
    const states = {};
    for(const [name,selector] of Object.entries(expected))
      states[name] = await page.locator(selector).count() > 0;
    console.log("Module presence:",JSON.stringify(states));
    if(errors.length)console.error("Page exceptions:",JSON.stringify(errors));
    if(missing.length)console.error("Failed local asset responses:",JSON.stringify(missing));
    const absent=Object.entries(states).filter(([,ok])=>!ok).map(([name])=>name);
    // Simulate an authorized module becoming visible after authentication.
    // The sidebar should reveal and hide the same destination without reloading.
    const billingPanel=await page.locator("#dischargeForm .nmc-bill-fields").count()>0;
    if(!billingPanel)absent.push("Mandatory discharge billing form");
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
