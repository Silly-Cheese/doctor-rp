// Northstar Experience 2026: accessible navigation, compact workflow switcher and runtime health.
import {getApp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {getAuth,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {getFirestore,doc,getDoc} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";
const auth=getAuth(getApp()),db=getFirestore(getApp());
let active=false,profile=null,mode="all";
const esc=s=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("\'","&#39;");
const markup=`<button id="nsxTrigger" class="nsx-trigger" type="button" hidden aria-haspopup="dialog" aria-controls="nsxDialog" title="Quick navigation (Ctrl+Shift+K)">⌘ <span>Navigate</span></button>
<dialog id="nsxDialog" class="nsx-dialog" aria-label="Northstar quick navigation"><div class="nsx-panel">
<div class="nsx-searchline"><span>⌕</span><input id="nsxSearch" type="search" aria-label="Search accessible workflows" placeholder="Find a workspace or tool…" autocomplete="off"><button id="nsxClose" type="button" aria-label="Close">×</button></div>
<div class="nsx-chips"><button data-nsx-mode="all" class="active">All workflows</button><button data-nsx-mode="favorites">Favorites</button><button data-nsx-mode="recent">Recent</button></div>
<div id="nsxResults" class="nsx-results" role="listbox" aria-label="Navigation results"></div>
<footer><span><kbd>↑</kbd> <kbd>↓</kbd> navigate · <kbd>Enter</kbd> open · <kbd>Esc</kbd> close</span><span id="nsxCount"></span></footer>
</div></dialog>
<button id="nsxHealthButton" class="nsx-health-button" type="button" hidden aria-haspopup="dialog">System status</button>
<dialog id="nsxHealthDialog" class="nsx-health-dialog"><div class="nsx-health-inner"><header><h2>Northstar System Status</h2><button type="button" id="nsxHealthClose" aria-label="Close">×</button></header><div id="nsxHealthDetails"></div><p>Connection and startup checks are informational. They do not verify clinical correctness or server-side security.</p><button id="nsxHealthRefresh" type="button">Refresh status</button></div></dialog>`;
const root=document.createElement("div");root.id="northstarExperience";root.innerHTML=markup;document.body.append(root);
const el=id=>document.getElementById(id);
const panel=el("nsxDialog"),search=el("nsxSearch"),results=el("nsxResults");
let lastFocus=null,selected=0,displayed=[];
const favorites=new Set();
const recents=[];
function entries(){const nav=document.querySelector(".nav-list");if(!nav)return [];const seen=new Set();return [...nav.querySelectorAll("button.nav-item")].filter(b=>{if(b.hidden||b.classList.contains("hidden")||b.closest("[hidden],.hidden"))return false;return true}).map(b=>{const key=b.dataset.section?"section:"+b.dataset.section:b.dataset.enterpriseOpen?"enterprise:"+b.dataset.enterpriseOpen:b.dataset.nxCommand?"command":b.id?"id:"+b.id:null;const label=b.textContent.replace(/\s+/g," ").trim();return {key,label,node:b}}).filter(x=>x.key&&x.label&&!seen.has(x.key)&&seen.add(x.key));}
function render(){const needle=search.value.toLowerCase().trim();const all=entries().filter(x=>x.label.toLowerCase().includes(needle)&& (mode==="all"||mode==="favorites"&&favorites.has(x.key)||mode==="recent"&&recents.includes(x.key)));displayed=all;selected=Math.max(0,Math.min(selected,all.length-1));results.replaceChildren();el("nsxCount").textContent=all.length+" destinations";if(!all.length){results.textContent="No matching destinations available for this account.";return}all.forEach((x,i)=>{const b=document.createElement("div");b.className="nsx-result"+(i===selected?" focused":"");b.setAttribute("role","option");b.setAttribute("aria-selected",String(i===selected));const action=document.createElement("button");action.type="button";action.className="nsx-result-main";action.textContent=x.label;action.onclick=()=>navigate(x);const favorite=document.createElement("button");favorite.type="button";favorite.className="nsx-star";favorite.setAttribute("aria-label",(favorites.has(x.key)?"Remove favorite: ":"Add favorite: ")+x.label);favorite.textContent=favorites.has(x.key)?"★":"☆";favorite.onclick=()=>{favorites.has(x.key)?favorites.delete(x.key):favorites.add(x.key);render()};b.append(action,favorite);results.append(b)})}
function navigate(x){panel.close();recents.unshift(x.key);if(recents.length>8)recents.pop();x.node.click();x.node.focus({preventScroll:true})}
function open(){if(!active||!el("mainView")||el("mainView").classList.contains("hidden"))return;lastFocus=document.activeElement;mode="all";search.value="";panel.showModal();render();search.focus()}
el("nsxTrigger").onclick=open;el("nsxClose").onclick=()=>panel.close();
panel.addEventListener("close",()=>{if(lastFocus&&lastFocus.isConnected)lastFocus.focus({preventScroll:true})});
search.addEventListener("input",()=>{selected=0;render()});search.addEventListener("keydown",e=>{if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();selected=Math.max(0,Math.min(displayed.length-1,selected+(e.key==="ArrowDown"?1:-1)));render()}if(e.key==="Enter"&&displayed[selected]){e.preventDefault();navigate(displayed[selected])}});
root.querySelectorAll("[data-nsx-mode]").forEach(b=>b.onclick=()=>{mode=b.dataset.nsxMode;root.querySelectorAll("[data-nsx-mode]").forEach(x=>x.classList.toggle("active",x===b));selected=0;render()});
document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==="k"){e.preventDefault();panel.open?panel.close():open()}});
const health=el("nsxHealthDialog");
el("nsxHealthButton").onclick=()=>{health.showModal();refreshHealth()};
el("nsxHealthClose").onclick=()=>health.close();el("nsxHealthRefresh").onclick=refreshHealth;
async function refreshHealth(){const target=el("nsxHealthDetails");target.replaceChildren();const failures=window.NorthstarStartupDiagnostics||[];const rows=[["Authentication",active?"Signed in":"Not signed in"],["Account",profile?profile.role:"Unavailable"],["Internet",navigator.onLine?"Online":"Offline"],["Startup",document.documentElement.dataset.northstarBoot||"Pending"],["Module issues",String(failures.length)],["Build",String(window.NorthstarBuild||"Unknown")]];rows.forEach(([k,v])=>{const row=document.createElement("div");row.className="nsx-health-row";const label=document.createElement("strong");label.textContent=k;const value=document.createElement("span");value.textContent=v;row.append(label,value);target.append(row)});if(failures.length){const head=document.createElement("h3");head.textContent="Modules that failed to initialize";target.append(head);for(const f of failures){const item=document.createElement("p");item.textContent=f.module+" — "+f.message;target.append(item)}}
 const row=document.createElement("div");row.className="nsx-health-row";const label=document.createElement("strong"),value=document.createElement("span");label.textContent="Firebase Functions";value.textContent="Checking server…";row.append(label,value);target.append(row);
 if(!auth.currentUser){value.textContent="Sign in to check backend";return;}
 try{const fn=httpsCallable(getFunctions(getApp(),"us-central1"),"northstarHealth",{timeout:12000});const result=await fn({});value.textContent=result.data?.status==="ready"?"Connected · "+result.data.version:"Unexpected server response";}catch(err){value.textContent="Not verified — "+(err.code||err.message||"connection error");}
}
onAuthStateChanged(auth,async user=>{active=false;profile=null;el("nsxTrigger").hidden=true;el("nsxHealthButton").hidden=true;if(panel.open)panel.close();if(health.open)health.close();if(!user)return;try{const d=await getDoc(doc(db,"users",user.uid));if(!d.exists()||d.data().status!=="active")return;profile=d.data();active=true;el("nsxTrigger").hidden=false;el("nsxHealthButton").hidden=false}catch(err){console.warn("Experience authorization",err)}});
