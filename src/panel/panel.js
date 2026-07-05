// Side panel UI logic.

import { listScripts, getScript, saveScript, deleteScript } from "../core/storage.js";

const editor = document.getElementById("editor");
const highlights = document.getElementById("highlights");
const backdrop = document.getElementById("backdrop");
const scriptName = document.getElementById("scriptName");
const scriptList = document.getElementById("scriptList");
const scriptCount = document.getElementById("scriptCount");
const statusEl = document.getElementById("status");
const pdbEditor = document.getElementById("pdbEditor");

const recordBtn = document.getElementById("recordBtn");
const recordLabel = document.getElementById("recordLabel");
const runBtn = document.getElementById("runBtn");
const stepBtn = document.getElementById("stepBtn");
const stopBtn = document.getElementById("stopBtn");
const newBtn = document.getElementById("newBtn");
const saveBtn = document.getElementById("saveBtn");
const deleteBtn = document.getElementById("deleteBtn");
const importBtn = document.getElementById("importBtn");
const exportBtn = document.getElementById("exportBtn");
const importFile = document.getElementById("importFile");
const savePdbBtn = document.getElementById("savePdbBtn");
const pdbAuth = document.getElementById("pdbAuth");
const pdbAuthHint = document.getElementById("pdbAuthHint");
const pdbPassword = document.getElementById("pdbPassword");
const pdbUnlockBtn = document.getElementById("pdbUnlockBtn");
const pdbLockBtn = document.getElementById("pdbLockBtn");

let pdbAuthState = { unlocked: false, hasPrivate: false, needsSetup: false };

const tabScript = document.getElementById("tabScript");
const tabData = document.getElementById("tabData");
const panelScript = document.getElementById("panelScript");
const panelData = document.getElementById("panelData");

const userPrompt = document.getElementById("userPrompt");
const userPromptText = document.getElementById("userPromptText");
const continueBtn = document.getElementById("continueBtn");

const errorPrompt = document.getElementById("errorPrompt");
const errorPromptText = document.getElementById("errorPromptText");
const retryBtn = document.getElementById("retryBtn");
const skipBtn = document.getElementById("skipBtn");
const stopErrorBtn = document.getElementById("stopErrorBtn");

let state = {
  currentId: null,
  recording: false,
  running: false,
  stepLine: 0,
  lineStatus: {},
};

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = "cs-status" + (kind ? " " + kind : "");
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

function send(message) {
  return chrome.runtime.sendMessage(message).catch(() => ({ ok: false }));
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderHighlights(activeLine = -1, activeStatus = "") {
  const lines = editor.value.split("\n");
  // One block div per line so bullets can sit in the gutter (absolutely
  // positioned) without shifting the text out of alignment with the textarea.
  const html = lines
    .map((line, i) => {
      const safe = escapeHtml(line) || " ";
      const st = state.lineStatus[i];
      let cls = "";
      if (i === activeLine && activeStatus) cls = activeStatus;
      else if (st) cls = st;
      const isStep = /^\s*\*+\s+\S/.test(line);
      const bullet = isStep && cls ? `<span class="cs-bullet ${cls}"></span>` : "";
      const content = cls ? `<mark class="${cls}">${safe}</mark>` : safe;
      return `<div class="cs-line">${bullet}${content}</div>`;
    })
    .join("");
  highlights.innerHTML = html;
  syncScroll();
}

function setActiveLine(lineNumber, status) {
  renderHighlights(lineNumber, status);
  scrollLineIntoView(lineNumber);
}

function clearHighlight() {
  state.lineStatus = {};
  renderHighlights();
}

function nextExecutableLine(fromIndex) {
  const lines = editor.value.split("\n");
  for (let i = Math.max(0, fromIndex); i < lines.length; i++) {
    if (/^\s*\*+\s+\S/.test(lines[i])) return i;
  }
  return -1;
}

function highlightUpcomingStep(fromIndex = 0) {
  const i = nextExecutableLine(fromIndex);
  if (i === -1) clearHighlight();
  else setActiveLine(i, "next");
}

function syncScroll() {
  backdrop.scrollTop = editor.scrollTop;
  backdrop.scrollLeft = editor.scrollLeft;
}

function scrollLineIntoView(lineNumber) {
  const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 20;
  const top = lineNumber * lineHeight;
  if (top < editor.scrollTop || top > editor.scrollTop + editor.clientHeight - lineHeight * 2) {
    editor.scrollTop = Math.max(0, top - editor.clientHeight / 2);
    syncScroll();
  }
}

function appendStep(slop) {
  const prefix = editor.value.length && !editor.value.endsWith("\n") ? "\n" : "";
  editor.value += `${prefix}* ${slop}\n`;
  renderHighlights();
  editor.scrollTop = editor.scrollHeight;
  syncScroll();
}

function setRecording(on) {
  state.recording = on;
  recordBtn.classList.toggle("recording", on);
  recordLabel.textContent = on ? "Stop recording" : "Record";
  runBtn.disabled = on;
  stepBtn.disabled = on;
}

function setRunning(on) {
  state.running = on;
  stopBtn.disabled = !on;
  runBtn.disabled = on;
  stepBtn.disabled = on;
  recordBtn.disabled = on;
  if (!on) {
    userPrompt.classList.add("hidden");
    errorPrompt.classList.add("hidden");
  }
}

function showTab(name) {
  const isScript = name === "script";
  tabScript.classList.toggle("active", isScript);
  tabData.classList.toggle("active", !isScript);
  panelScript.classList.toggle("hidden", !isScript);
  panelData.classList.toggle("hidden", isScript);
}

function formatDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

async function refreshLibrary() {
  const scripts = await listScripts();
  scriptCount.textContent = String(scripts.length);
  scriptList.innerHTML = "";
  if (scripts.length === 0) {
    const li = document.createElement("li");
    li.className = "cs-empty";
    li.textContent = "No saved scripts yet.";
    scriptList.appendChild(li);
    return;
  }
  for (const s of scripts) {
    const li = document.createElement("li");
    if (s.id === state.currentId) li.classList.add("active");
    const name = document.createElement("span");
    name.className = "cs-script-name";
    name.textContent = s.name;
    const date = document.createElement("span");
    date.className = "cs-script-date";
    date.textContent = formatDate(s.updated);
    li.appendChild(name);
    li.appendChild(date);
    li.addEventListener("click", () => loadScript(s.id));
    scriptList.appendChild(li);
  }
}

async function loadScript(id) {
  const s = await getScript(id);
  if (!s) return;
  state.currentId = s.id;
  state.stepLine = 0;
  scriptName.value = s.name;
  editor.value = s.text;
  highlightUpcomingStep(0);
  await refreshLibrary();
  setStatus(`Loaded "${s.name}".`);
}

function updatePdbAuthUi() {
  const showAuth = pdbAuthState.hasPrivate || pdbAuthState.needsSetup;
  pdbAuth.classList.toggle("hidden", !showAuth);
  pdbEditor.classList.toggle("cs-pdb-locked", pdbAuthState.hasPrivate && !pdbAuthState.unlocked);

  if (pdbAuthState.needsSetup) {
    pdbAuthHint.textContent = "Set a password to encrypt private entries.";
    pdbUnlockBtn.textContent = "Set password";
    pdbLockBtn.classList.add("hidden");
    return;
  }

  if (pdbAuthState.unlocked) {
    pdbAuthHint.textContent = "Private values are unlocked for this session.";
    pdbUnlockBtn.classList.add("hidden");
    pdbLockBtn.classList.remove("hidden");
    return;
  }

  pdbAuthHint.textContent = "Log in to view or use private values in scripts.";
  pdbUnlockBtn.textContent = "Unlock";
  pdbUnlockBtn.classList.remove("hidden");
  pdbLockBtn.classList.add("hidden");
}

function applyPdbResponse(res) {
  if (!res || !res.ok) return;
  if (res.text !== undefined) pdbEditor.value = res.text;
  pdbAuthState.unlocked = !!res.unlocked;
  pdbAuthState.hasPrivate = !!res.hasPrivate;
  pdbAuthState.needsSetup = false;
  updatePdbAuthUi();
}

async function loadPdb() {
  const res = await send({ type: "GET_PDB" });
  if (res && res.ok) {
    pdbEditor.value = res.text || "";
    pdbAuthState = {
      unlocked: !!res.unlocked,
      hasPrivate: !!res.hasPrivate,
      needsSetup: false,
    };
    updatePdbAuthUi();
  }
}

async function toggleRecord() {
  if (state.recording) {
    await send({ type: "STOP_RECORDING" });
    setRecording(false);
    setStatus("Recording stopped.");
    return;
  }
  const tabId = await getActiveTabId();
  if (tabId == null) {
    setStatus("No active tab to record.", "error");
    return;
  }
  const res = await send({ type: "START_RECORDING", tabId });
  if (res && res.ok) {
    setRecording(true);
    setStatus("Recording… act in the page.");
  } else {
    setStatus((res && res.error) || "Could not start recording.", "error");
  }
}

async function runScript() {
  const tabId = await getActiveTabId();
  if (tabId == null) {
    setStatus("No active tab.", "error");
    return;
  }
  state.lineStatus = {};
  clearHighlight();
  setStatus("Running…", "run");
  await send({ type: "RUN_SCRIPT", script: editor.value, tabId });
}

async function stepScript() {
  const tabId = await getActiveTabId();
  if (tabId == null) {
    setStatus("No active tab.", "error");
    return;
  }
  const lines = editor.value.split("\n");
  let i = state.stepLine;
  while (i < lines.length && !/^\s*\*+\s+\S/.test(lines[i])) i++;
  if (i >= lines.length) {
    state.stepLine = 0;
    setStatus("End of script. Step reset to top.");
    highlightUpcomingStep(0);
    return;
  }
  await send({ type: "RUN_STEP", line: lines[i], lineNumber: i, tabId });
  state.stepLine = i + 1;
}

function stopRun() {
  send({ type: "STOP_RUN" });
  setStatus("Stopping…");
}

async function doSave() {
  const saved = await saveScript({
    id: state.currentId,
    name: scriptName.value.trim() || "Untitled",
    text: editor.value,
  });
  state.currentId = saved.id;
  await refreshLibrary();
  setStatus(`Saved "${saved.name}".`, "ok");
}

function doNew() {
  state.currentId = null;
  state.stepLine = 0;
  scriptName.value = "";
  editor.value = "";
  clearHighlight();
  refreshLibrary();
  setStatus("New script.");
  editor.focus();
}

async function doDelete() {
  if (!state.currentId) {
    doNew();
    return;
  }
  await deleteScript(state.currentId);
  doNew();
  setStatus("Script deleted.");
}

function doExport() {
  const name = (scriptName.value.trim() || "coscript").replace(/[^\w.-]+/g, "_");
  const blob = new Blob([editor.value], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.coscript`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function doImport(file) {
  const reader = new FileReader();
  reader.onload = () => {
    editor.value = String(reader.result || "");
    state.currentId = null;
    state.stepLine = 0;
    scriptName.value = file.name.replace(/\.[^.]+$/, "");
    highlightUpcomingStep(0);
    setStatus(`Imported "${file.name}".`);
  };
  reader.readAsText(file);
}

let lastPreviewLine = -1;

async function previewCurrentLine() {
  const pos = editor.selectionStart;
  const lineNumber = editor.value.slice(0, pos).split("\n").length - 1;
  if (lineNumber === lastPreviewLine) return;
  lastPreviewLine = lineNumber;
  const line = editor.value.split("\n")[lineNumber];
  if (!line || !/^\s*\*+\s+\S/.test(line)) return;
  const tabId = await getActiveTabId();
  if (tabId == null) return;
  await send({ type: "PREVIEW_STEP", line, tabId });
}

async function savePdb() {
  const res = await send({ type: "SAVE_PDB", text: pdbEditor.value });
  if (res && res.ok) {
    applyPdbResponse(res);
    setStatus("Your data saved.", "ok");
    return;
  }
  if (res && res.needSetupPassword) {
    pdbAuthState.needsSetup = true;
    pdbAuthState.hasPrivate = true;
    updatePdbAuthUi();
    setStatus("Set a password before saving private entries.", "error");
    pdbPassword.focus();
    return;
  }
  if (res && res.needUnlock) {
    setStatus("Unlock your data to save private values.", "error");
    pdbPassword.focus();
    return;
  }
  setStatus((res && res.error) || "Could not save your data.", "error");
}

async function unlockPdb() {
  const password = pdbPassword.value;
  if (!password) {
    setStatus("Enter your password.", "error");
    return;
  }
  if (pdbAuthState.needsSetup) {
    const res = await send({
      type: "SETUP_PDB_PASSWORD",
      password,
      text: pdbEditor.value,
    });
    pdbPassword.value = "";
    if (res && res.ok) {
      applyPdbResponse(res);
      setStatus("Private data saved and encrypted.", "ok");
      return;
    }
    setStatus((res && res.error) || "Could not set password.", "error");
    return;
  }
  const res = await send({ type: "UNLOCK_PDB", password });
  pdbPassword.value = "";
  if (res && res.ok) {
    applyPdbResponse(res);
    setStatus("Private data unlocked.", "ok");
    return;
  }
  setStatus((res && res.error) || "Could not unlock.", "error");
}

async function lockPdb() {
  const res = await send({ type: "LOCK_PDB" });
  if (res && res.ok) {
    applyPdbResponse(res);
    setStatus("Private data locked.", "ok");
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case "APPEND_STEP":
      appendStep(msg.step);
      break;
    case "STATE":
      setRecording(!!msg.recording);
      break;
    case "RUN_STATE":
      setRunning(!!msg.running);
      if (!msg.running && !statusEl.classList.contains("error")) {
        setStatus("Done.", "ok");
      }
      break;
    case "RUN_PROGRESS":
      if (msg.status === "running") {
        setActiveLine(msg.lineNumber, "run");
        setStatus(`Running: ${msg.text}`, "run");
      } else if (msg.status === "ok") {
        state.lineStatus[msg.lineNumber] = "ok";
        highlightUpcomingStep(msg.lineNumber + 1);
        setStatus(`OK: ${msg.text}`, "ok");
      } else if (msg.status === "skipped") {
        state.lineStatus[msg.lineNumber] = "skipped";
        highlightUpcomingStep(msg.lineNumber + 1);
        setStatus("Skipped.", "ok");
      } else if (msg.status === "error") {
        setActiveLine(msg.lineNumber, "error");
        setStatus(`Error: ${msg.text}`, "error");
      }
      break;
    case "WAIT_USER":
      userPromptText.textContent = msg.text || "Complete the action, then click Continue.";
      userPrompt.classList.remove("hidden");
      errorPrompt.classList.add("hidden");
      setActiveLine(msg.lineNumber, "run");
      setStatus("Waiting for you…", "run");
      break;
    case "ERROR_PROMPT":
      errorPromptText.textContent = msg.text || "Step failed.";
      errorPrompt.classList.remove("hidden");
      userPrompt.classList.add("hidden");
      break;
    case "PDB_UPDATED":
      if (msg.text !== undefined) pdbEditor.value = msg.text;
      break;
    case "PDB_AUTH":
      pdbAuthState.unlocked = !!msg.unlocked;
      pdbAuthState.hasPrivate = !!msg.hasPrivate;
      updatePdbAuthUi();
      break;
  }
});

const PREVIEW_KEYS = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown",
]);

editor.addEventListener("scroll", syncScroll);
editor.addEventListener("input", () => {
  state.stepLine = 0;
  lastPreviewLine = -1; // typing shouldn't trigger a preview on the next keyup
  renderHighlights();
});
editor.addEventListener("click", previewCurrentLine);
editor.addEventListener("keyup", (e) => {
  // Only preview when navigating between lines, not while typing.
  if (PREVIEW_KEYS.has(e.key)) previewCurrentLine();
});

tabScript.addEventListener("click", () => showTab("script"));
tabData.addEventListener("click", () => showTab("data"));

continueBtn.addEventListener("click", () => {
  userPrompt.classList.add("hidden");
  send({ type: "CONTINUE_USER" });
});

retryBtn.addEventListener("click", () => {
  errorPrompt.classList.add("hidden");
  send({ type: "ERROR_DECISION", decision: "retry" });
});
skipBtn.addEventListener("click", () => {
  errorPrompt.classList.add("hidden");
  send({ type: "ERROR_DECISION", decision: "skip" });
});
stopErrorBtn.addEventListener("click", () => {
  errorPrompt.classList.add("hidden");
  send({ type: "ERROR_DECISION", decision: "stop" });
  send({ type: "STOP_RUN" });
});

recordBtn.addEventListener("click", toggleRecord);
runBtn.addEventListener("click", runScript);
stepBtn.addEventListener("click", stepScript);
stopBtn.addEventListener("click", stopRun);
newBtn.addEventListener("click", doNew);
saveBtn.addEventListener("click", doSave);
deleteBtn.addEventListener("click", doDelete);
exportBtn.addEventListener("click", doExport);
importBtn.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", () => {
  if (importFile.files && importFile.files[0]) doImport(importFile.files[0]);
  importFile.value = "";
});
savePdbBtn.addEventListener("click", savePdb);
pdbUnlockBtn.addEventListener("click", unlockPdb);
pdbLockBtn.addEventListener("click", lockPdb);
pdbPassword.addEventListener("keydown", (e) => {
  if (e.key === "Enter") unlockPdb();
});

async function init() {
  await refreshLibrary();
  await loadPdb();
  const st = await send({ type: "GET_STATE" });
  if (st) {
    setRecording(!!st.recording);
    setRunning(!!st.running);
  }
  setStatus("Ready.");
  renderHighlights();
}

init();
