// Keep role-appropriate feature destinations visible even when modules mount late.
(function () {
  "use strict";
  const entries = [
    ["nsEmergencyLaunch", "Emergency Intake & Procedures", "Care"],
    ["siuLaunch", "Incident Reporting & SIU", "Administration"],
    ["nsOpsLaunch", "Operations Center", "Operations"],
    ["nsWorkdeskOpen", "My Shift Tasks", "Care"],
    ["nsPrefsLaunch", "Display Preferences", "Administration"]
  ];
  let scheduled = false;
  function sync() {
    scheduled = false;
    const nav = document.querySelector(".nav-list");
    if (!nav) return;
    // The enterprise module rebuilds navigation groups at boot; do not race it.
    if (!nav.dataset.organized && document.documentElement.dataset.northstarBoot === "loading") return;
    for (const [id, title, group] of entries) {
      const origin = document.getElementById(id);
      let button = document.getElementById("nsNav-" + id);
      if (!origin) {
        if (button) button.hidden = true;
        continue;
      }
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.id = "nsNav-" + id;
        button.className = "nav-item ns-feature-nav";
        button.textContent = title;
        button.addEventListener("click", () => {
          if (!origin.hidden) origin.click();
          document.querySelector(".sidebar")?.classList.remove("open");
        });
      }
      const navGroup = [...nav.querySelectorAll(".nav-group")].find(g =>
        (g.querySelector(".nav-group-title-toggle, .nav-group-title")?.textContent||"").replace(/[▾▸]/g,"").trim() === group
      );
      const target = navGroup?.querySelector(".nav-group-items") || navGroup || nav;
      if (button.parentElement !== target) target.appendChild(button);
      if (button.hidden !== origin.hidden) button.hidden = origin.hidden;
      button.disabled = origin.hidden;
      button.title = origin.hidden ? "Unavailable for this account" : title;
    }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(sync);
  }
  const targets = new Set(entries.map(x => x[0]));
  new MutationObserver(changes => {
    if (changes.some(change =>
      (change.type === "attributes" && (targets.has(change.target.id) ||
        (change.target.classList?.contains("nav-list") && change.attributeName === "data-organized"))) ||
      (change.type === "childList" && [...change.addedNodes].some(node =>
        node.nodeType === 1 && (
          targets.has(node.id) ||
          node.classList?.contains("nav-group") ||
          node.classList?.contains("nav-list")
        )))
    )) schedule();
  }).observe(document.documentElement, {subtree:true,childList:true,attributes:true,attributeFilter:["hidden","data-organized"]});
  window.addEventListener("northstar:boot-complete",schedule);
  document.addEventListener("DOMContentLoaded",schedule);
  schedule();
})();
