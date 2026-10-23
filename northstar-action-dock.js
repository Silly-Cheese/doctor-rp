// Consolidated shortcuts replaces overlapping fixed action buttons.
const shortcuts=[["Incident report","siuLaunch"],["Emergency intake & procedures","nsEmergencyLaunch"],["Patient deletion approvals","nmcDeleteOpen"],["Operations Center","nsOpsLaunch"],["My Shift Tasks","nsWorkdeskOpen"],["Navigate","nsxTrigger"],["Display preferences","nsPrefsLaunch"],["System status","nsxHealthButton"]];
const root=document.createElement("div");root.id="nsActionDock";root.innerHTML='<button type="button" id="nsDockToggle" aria-expanded="false" aria-controls="nsDockMenu">＋ <span>Quick actions</span></button><div id="nsDockMenu" hidden role="group" aria-label="Quick actions"></div>';document.body.append(root);
const toggle=root.querySelector("#nsDockToggle"),menu=root.querySelector("#nsDockMenu");
function rebuild(){menu.replaceChildren();let count=0;for(const [label,id]of shortcuts){const origin=document.getElementById(id);if(!origin||origin.hidden)continue;const b=document.createElement("button");b.type="button";b.textContent=label;b.onclick=()=>{close();origin.click()};menu.append(b);count++}if(root.hidden !== (count===0))root.hidden=count===0}
function close(){if(!menu.hidden)menu.hidden=true;if(toggle.getAttribute("aria-expanded")!=="false")toggle.setAttribute("aria-expanded","false")}
toggle.onclick=()=>{if(menu.hidden){rebuild();menu.hidden=false;toggle.setAttribute("aria-expanded","true")}else close()};
document.addEventListener("keydown",e=>{if(e.key==="Escape")close()});
document.addEventListener("click",e=>{if(!root.contains(e.target))close()});
const observer=new MutationObserver(records=>{if(!records.some(r=>shortcuts.some(([,id])=>r.target.id===id)))return;const any=shortcuts.some(([,id])=>{const n=document.getElementById(id);return n&&!n.hidden});if(root.hidden===any)root.hidden=!any;if(root.hidden)close();else if(!menu.hidden)rebuild()});
observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:["hidden"]});
rebuild();
