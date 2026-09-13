const section = document.querySelector("#operationsSection");
const content = document.querySelector("#operationsContent");
let boardQuery = "";

function applyBoardFilter() {
  if (!section) return;
  const input = section.querySelector("#opsSearch");
  if (input && input.value !== boardQuery) input.value = boardQuery;
  const query = boardQuery.trim().toLowerCase();
  section.querySelectorAll(".ops-patient").forEach((card) => {
    card.hidden = Boolean(query) && !card.textContent.toLowerCase().includes(query);
  });
}

section?.addEventListener("input", (event) => {
  if (event.target.id !== "opsSearch") return;
  boardQuery = event.target.value;
  event.stopPropagation();
  applyBoardFilter();
}, true);

if (content) {
  const observer = new MutationObserver(() => {
    if (!boardQuery) return;
    queueMicrotask(applyBoardFilter);
  });
  observer.observe(content, { childList: true, subtree: true });
}
