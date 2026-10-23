// Visible startup diagnostics so missing modules are not mistaken for missing deployments.
const failures=[];const banner=document.createElement("div");banner.id="nmcStartupAlert";banner.hidden=true;banner.setAttribute("role","alert");
banner.innerHTML='<strong>Northstar started with errors</strong><span id="nmcStartupSummary"></span><button type="button" id="nmcStartupDetails">Details</button><button type="button" id="nmcStartupDismiss">Dismiss</button>';
document.body.append(banner);
function report(message){if(!message||failures.includes(message))return;failures.push(String(message).slice(0,300));banner.hidden=false;document.getElementById("nmcStartupSummary").textContent=failures.length+" startup error(s) detected. Some features may not load.";console.error("Northstar startup issue:",message)}
window.addEventListener("error",e=>{if(e.target&&e.target!==window&&e.target.tagName==="SCRIPT")report("A script failed to load: "+(e.target.src||"unknown"));else if(e.message)report(e.message)},true);
window.addEventListener("unhandledrejection",e=>report(e.reason?.message||String(e.reason||"Promise rejected")));
window.addEventListener("northstar:boot-complete",e=>{for(const item of e.detail?.failedModules||[])report("Module: "+item.module+" — "+item.message)});
document.getElementById("nmcStartupDetails").onclick=()=>alert(failures.join("\n\n")||"No detected errors");
document.getElementById("nmcStartupDismiss").onclick=()=>{banner.hidden=true};
