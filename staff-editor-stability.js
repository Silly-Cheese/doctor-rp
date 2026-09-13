const nativeInnerHTML = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");

let staffEditorActive = false;
let pendingMarkup = null;
let pendingTarget = null;

function isStaffEditorControl(node) {
  return Boolean(node?.closest?.("#staffAccountManager input, #staffAccountManager select"));
}

function isStaffSave(node) {
  return Boolean(node?.closest?.("[data-save-staff]"));
}

function flushPendingRender() {
  if (!pendingTarget || pendingMarkup == null || staffEditorActive) return;
  const target = pendingTarget;
  const markup = pendingMarkup;
  pendingTarget = null;
  pendingMarkup = null;
  nativeInnerHTML.set.call(target, markup);
}

if (nativeInnerHTML?.get && nativeInnerHTML?.set) {
  Object.defineProperty(Element.prototype, "innerHTML", {
    configurable: nativeInnerHTML.configurable,
    enumerable: nativeInnerHTML.enumerable,
    get: nativeInnerHTML.get,
    set(value) {
      if (this?.id === "staffAccountList" && staffEditorActive) {
        pendingTarget = this;
        pendingMarkup = value;
        return;
      }
      nativeInnerHTML.set.call(this, value);
    }
  });
}

document.addEventListener("focusin", (event) => {
  if (isStaffEditorControl(event.target)) staffEditorActive = true;
}, true);

document.addEventListener("pointerdown", (event) => {
  if (isStaffSave(event.target)) {
    staffEditorActive = false;
    flushPendingRender();
    return;
  }

  if (isStaffEditorControl(event.target)) {
    staffEditorActive = true;
    return;
  }

  if (!event.target.closest?.("#staffAccountManager")) {
    staffEditorActive = false;
    flushPendingRender();
  }
}, true);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && staffEditorActive) {
    staffEditorActive = false;
    queueMicrotask(flushPendingRender);
  }
}, true);

window.addEventListener("northstar:refresh-staff-manager", () => {
  staffEditorActive = false;
  queueMicrotask(flushPendingRender);
});
