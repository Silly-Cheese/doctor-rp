const state = { current: null, queue: [], busy: false };

function ensureStyles() {
  if (document.querySelector('link[href="northstar-dialogs.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "northstar-dialogs.css";
  document.head.appendChild(link);
}

function ensureUi() {
  ensureStyles();
  if (document.querySelector("#northstarDialog")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <dialog id="northstarDialog" class="northstar-dialog">
      <form id="northstarDialogForm" class="northstar-dialog-card" method="dialog">
        <div class="northstar-dialog-head">
          <div><p class="eyebrow" id="northstarDialogEyebrow">Northstar Medical Center</p><h3 id="northstarDialogTitle">Northstar</h3></div>
          <button class="northstar-dialog-close" type="button" data-ns-dialog-cancel aria-label="Close">×</button>
        </div>
        <div class="northstar-dialog-body">
          <p id="northstarDialogMessage" class="northstar-dialog-message"></p>
          <label id="northstarDialogField" class="northstar-dialog-field" hidden>
            <span id="northstarDialogLabel">Value</span>
            <input id="northstarDialogInput" autocomplete="off">
            <textarea id="northstarDialogTextarea" rows="5" hidden></textarea>
          </label>
          <p id="northstarDialogError" class="northstar-dialog-error"></p>
        </div>
        <div class="northstar-dialog-footer">
          <button id="northstarDialogCancel" class="northstar-dialog-cancel" type="button" data-ns-dialog-cancel>Cancel</button>
          <button id="northstarDialogConfirm" class="northstar-dialog-confirm" type="submit">Confirm</button>
        </div>
      </form>
    </dialog>`);

  const dialog = document.querySelector("#northstarDialog");
  document.querySelectorAll("[data-ns-dialog-cancel]").forEach(button => button.addEventListener("click", cancelCurrent));
  document.querySelector("#northstarDialogForm")?.addEventListener("submit", event => {
    event.preventDefault();
    submitCurrent();
  });
  dialog?.addEventListener("cancel", event => {
    event.preventDefault();
    cancelCurrent();
  });
  dialog?.addEventListener("click", event => {
    if (event.target === dialog) cancelCurrent();
  });
}

function setText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value ?? "";
}

function activeInput() {
  const textarea = document.querySelector("#northstarDialogTextarea");
  return textarea && !textarea.hidden ? textarea : document.querySelector("#northstarDialogInput");
}

function open(options = {}) {
  ensureUi();
  return new Promise((resolve, reject) => {
    state.queue.push({ options, resolve, reject });
    pump();
  });
}

function pump() {
  if (state.busy || !state.queue.length) return;
  const item = state.queue.shift();
  state.current = item;
  state.busy = true;

  try {
    const options = item.options || {};
    const mode = options.mode || "confirm";
    const dialog = document.querySelector("#northstarDialog");
    const cancel = document.querySelector("#northstarDialogCancel");
    const field = document.querySelector("#northstarDialogField");
    const input = document.querySelector("#northstarDialogInput");
    const textarea = document.querySelector("#northstarDialogTextarea");

    dialog.className = `northstar-dialog${options.tone ? ` ${options.tone}` : ""}`;
    dialog.dataset.mode = mode;
    setText("#northstarDialogEyebrow", options.eyebrow || "Northstar Medical Center");
    setText("#northstarDialogTitle", options.title || "Northstar");
    setText("#northstarDialogMessage", options.message || "");
    setText("#northstarDialogConfirm", options.confirmText || (mode === "alert" ? "OK" : "Confirm"));
    setText("#northstarDialogCancel", options.cancelText || "Cancel");
    setText("#northstarDialogError", "");

    cancel.hidden = mode === "alert";
    field.hidden = mode !== "prompt";
    input.hidden = mode !== "prompt" || options.multiline === true;
    textarea.hidden = mode !== "prompt" || options.multiline !== true;

    if (mode === "prompt") {
      setText("#northstarDialogLabel", options.label || "Response");
      const control = options.multiline ? textarea : input;
      control.value = options.value ?? "";
      control.placeholder = options.placeholder || "";
      control.dataset.required = options.required ? "1" : "0";
      control.dataset.minLength = String(options.minLength || 0);
      if (control === input) input.type = options.inputType || "text";
    }

    dialog.showModal();
    setTimeout(() => {
      if (mode === "prompt") activeInput()?.focus();
      else document.querySelector("#northstarDialogConfirm")?.focus();
    }, 20);
  } catch (error) {
    const reject = state.current?.reject;
    reset();
    reject?.(error);
    queueMicrotask(pump);
  }
}

function submitCurrent() {
  const mode = document.querySelector("#northstarDialog")?.dataset.mode || "confirm";
  if (mode === "prompt") {
    const control = activeInput();
    const value = String(control?.value ?? "");
    const required = control?.dataset.required === "1";
    const minLength = Number(control?.dataset.minLength || 0);
    if (required && !value.trim()) {
      setText("#northstarDialogError", "This field is required.");
      control?.focus();
      return;
    }
    if (value.trim().length < minLength) {
      setText("#northstarDialogError", `Enter at least ${minLength} characters.`);
      control?.focus();
      return;
    }
    finish(value);
    return;
  }
  finish(true);
}

function cancelCurrent() {
  const mode = document.querySelector("#northstarDialog")?.dataset.mode || "confirm";
  finish(mode === "alert" ? true : null);
}

function finish(value) {
  const dialog = document.querySelector("#northstarDialog");
  if (dialog?.open) dialog.close();
  const resolve = state.current?.resolve;
  reset();
  resolve?.(value);
  queueMicrotask(pump);
}

function reset() {
  state.current = null;
  state.busy = false;
  const dialog = document.querySelector("#northstarDialog");
  if (dialog) delete dialog.dataset.mode;
}

window.NorthstarDialog = {
  alert: (options = {}) => open({ ...options, mode: "alert" }),
  confirm: (options = {}) => open({ ...options, mode: "confirm" }).then(Boolean),
  prompt: (options = {}) => open({ ...options, mode: "prompt" })
};
