if (!document.querySelector('link[rel="manifest"]')) {
  const manifest = document.createElement("link");
  manifest.rel = "manifest";
  manifest.href = "manifest.webmanifest";
  document.head.appendChild(manifest);
}
if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
  const capable = document.createElement("meta");
  capable.name = "apple-mobile-web-app-capable";
  capable.content = "yes";
  document.head.appendChild(capable);
}
if (!document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')) {
  const status = document.createElement("meta");
  status.name = "apple-mobile-web-app-status-bar-style";
  status.content = "default";
  document.head.appendChild(status);
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js").catch(() => {});
