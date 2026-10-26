// Route sidebar destinations into the real workspace, not overlaid modal windows.
// Detailed record editors and confirmation dialogs remain modal.
(function(){
 const pages=[
  ["siuLaunch","siuDialog","Incident Reporting & SIU"],
  ["nsWorkdeskOpen","nsWorkdeskDialog","My Shift Tasks"],
  ["nsOpsLaunch","nsOpsDialog","Operations Center"],
  ["nsEmergencyLaunch","nsEmergencyDialog","Emergency Intake & Procedures"],
  ["nsPrefsLaunch","nsPrefsDialog","Display Preferences"]
 ];
 const registrations=new Set();
 function install(){
  const main=document.querySelector("main.content");if(!main)return;
  for(const [originId,dialogId,title] of pages){
   const dialog=document.getElementById(dialogId);
   if(!dialog||registrations.has(dialogId))continue;
   registrations.add(dialogId);
   const section=document.createElement("section");
   section.className="content-section hidden nmc-fullpage-section";
   section.id="nmcPage-"+dialogId;
   section.dataset.fullpage=dialogId;
   const heading=document.createElement("header");heading.className="nmc-fullpage-heading";
   const subtitle=document.createElement("p");subtitle.className="eyebrow";subtitle.textContent="Northstar Medical Center";
   const h=document.createElement("h2");h.textContent=title;
   heading.append(subtitle,h);section.append(heading,dialog);main.append(section);
   dialog.showModal=()=>{
    document.querySelectorAll(".content-section").forEach(node=>node.classList.add("hidden"));
    section.classList.remove("hidden");
    const pageTitle=document.getElementById("pageTitle");if(pageTitle)pageTitle.textContent=title;
    document.querySelectorAll(".nav-item").forEach(x=>x.classList.toggle("active",x.id==="nsNav-"+originId));
    document.querySelector(".sidebar")?.classList.remove("open");
    if(!dialog.open)dialog.show();
    window.scrollTo({top:0,behavior:"instant"});
   };
   dialog.addEventListener("close",()=>{
    if(!section.classList.contains("hidden")&&!document.getElementById("mainView")?.classList.contains("hidden")){
     document.querySelector('[data-section="dashboard"]')?.click();
    }
   });
  }
 }
 let pending=false;function schedule(){if(pending)return;pending=true;queueMicrotask(()=>{pending=false;install()});}
 new MutationObserver(changes=>{if(changes.some(r=>r.type==="childList"&&[...r.addedNodes].some(n=>n.nodeType===1&&(pages.some(p=>n.querySelector?.("#"+p[1]))||pages.some(p=>n.id===p[1])))))schedule()}).observe(document.body,{subtree:true,childList:true});
 window.addEventListener("northstar:boot-complete",schedule);
 document.addEventListener("DOMContentLoaded",schedule);
 schedule();
})();
