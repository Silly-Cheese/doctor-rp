from pathlib import Path
p=Path('clinical.js')
text=p.read_text()
text=text.replace('''  selectedEncounterId: null,\n  selectedOrderId: null\n};''','''  selectedEncounterId: null,\n  selectedOrderId: null,\n  renderQueued: false\n};''',1)
old='''function bindCollection(name, key) {\n  const unsubscribe = onSnapshot(collection(db, name), (snapshot) => {\n    state[key] = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));\n    renderClinicalSurfaces();\n  }, () => {\n    state[key] = [];\n    renderClinicalSurfaces();\n  });\n  state.unsubscribers.push(unsubscribe);\n}'''
new='''function bindCollection(name, key) {\n  const unsubscribe = onSnapshot(collection(db, name), (snapshot) => {\n    state[key] = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));\n    scheduleClinicalRender();\n  }, () => {\n    state[key] = [];\n    scheduleClinicalRender();\n  });\n  state.unsubscribers.push(unsubscribe);\n}'''
if old not in text: raise SystemExit('bindCollection block not found')
text=text.replace(old,new,1)
old='''function renderClinicalSurfaces() {\n  renderClinicalWorkspace();\n  renderOrdersPage();\n  renderResultsPage();\n}'''
new='''function renderClinicalSurfaces() {\n  if (document.querySelector("#patientChartDialog")?.open) renderClinicalWorkspace();\n  const orders = document.querySelector("#ordersSection");\n  if (orders && !orders.classList.contains("hidden")) renderOrdersPage();\n  const results = document.querySelector("#resultsSection");\n  if (results && !results.classList.contains("hidden")) renderResultsPage();\n}\n\nfunction scheduleClinicalRender() {\n  if (state.renderQueued) return;\n  state.renderQueued = true;\n  requestAnimationFrame(() => {\n    state.renderQueued = false;\n    renderClinicalSurfaces();\n  });\n}'''
if old not in text: raise SystemExit('renderClinicalSurfaces block not found')
text=text.replace(old,new,1)
text=text.replace('''const chartObserver = new MutationObserver(() => {\n  if (!document.querySelector("#clinicalWorkspace")) renderClinicalWorkspace();\n});''','''const chartObserver = new MutationObserver(() => {\n  if (!document.querySelector("#clinicalWorkspace")) scheduleClinicalRender();\n});''',1)
p.write_text(text)
