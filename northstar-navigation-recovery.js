// Persistent navigation entries for independently loaded feature modules.
(function(){
 const entries=[["nsEmergencyLaunch","Emergency Intake & Procedures","Care"],["siuLaunch","Incident Reporting & SIU","Administration"],["nsOpsLaunch","Operations Center","Operations"],["nsWorkdeskOpen","My Shift Tasks","Care"],["nmcDeleteOpen","Patient Deletion Approvals","Administration"],["nsPrefsLaunch","Display Preferences","Administration"]];
 function sync(){
  const nav=document.querySelector(".nav-list");if(!nav)return;
  for(const [id,title,group]of entries){
   const original=document.getElementById(id),existing=document.getElementById("nsNav-"+id);
   if(!original){if(existing)existing.hidden=true;continue}
   let btn=existing;
   if(!btn){
    btn=document.createElement("button");btn.type="button";btn.className="nav-item ns-feature-nav";btn.id="nsNav-"+id;btn.textContent=title;
    btn.onclick=()=>{original.click();if(window.innerWidth<800)document.querySelector(".sidebar")?.classList.remove("open")};
    const groups=[...nav.querySelectorAll(".nav-group")];
    const target=groups.find(x=>x.querySelector(".nav-group-title")?.textContent?.trim()===group);
    (target||nav).append(btn);
   }
   btn.hidden=original.hidden;
  }
 }
 window.addEventListener("northstar:boot-complete",sync);
 document.addEventListener("DOMContentLoaded",sync);
 let attempts=0;const interval=setInterval(()=>{sync();if(++attempts>=15)clearInterval(interval)},1000);
})();
