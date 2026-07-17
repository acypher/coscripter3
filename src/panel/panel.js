// Side panel UI logic.

import { listScripts, getScript, saveScript, deleteScript } from "../core/storage.js";
import { initScratchEditor } from "./scratch-editor.js";
import { initScriptEditor } from "./script-editor.js";

const scriptEditorRoot = document.getElementById("scriptEditor");
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
const tabTables = document.getElementById("tabTables");
const tabData = document.getElementById("tabData");
const panelScript = document.getElementById("panelScript");
const panelTables = document.getElementById("panelTables");
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
};

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = "cs-status" + (kind ? " " + kind : "");
}

let scriptEditor;

function appendStep(slop) {
  scriptEditor.appendStep(slop);
  scriptEditorRoot.scrollTop = scriptEditorRoot.scrollHeight;
}

scriptEditor = initScriptEditor({
  root: scriptEditorRoot,
  onSetCurrent: (lineIndex) => {
    state.stepLine = lineIndex;
    refreshCcPreview(lineIndex);
    setStatus(`Current command: line ${lineIndex + 1}.`);
  },
  onChange: () => {
    // Keep CC; do not reset stepLine on edits.
  },
  onTextEdit: () => {
    // Typing does not change CC or trigger preview.
  },
});

const scratchEditor = initScratchEditor({ setStatus, appendStep });

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

function send(message) {
  return chrome.runtime.sendMessage(message).catch(() => ({ ok: false }));
}

function lineText(lineIndex) {
  const line = scriptEditor.getLine(lineIndex);
  if (!line) return "";
  return scriptEditor.serializeLine(line);
}

/** Set the next Step/Run line (0-based). Snaps forward to an executable step. */
function setCurrentStep(lineNumber) {
  const i = scriptEditor.nextExecutable(lineNumber);
  if (i === -1) {
    state.stepLine = 0;
    scriptEditor.setCurrent(0);
    scriptEditor.clearDot();
    setStatus("No step at or after that line.");
    return;
  }
  state.stepLine = i;
  scriptEditor.setCurrent(i);
  scriptEditor.scrollLineIntoView(i);
  setStatus(`Current command: line ${i + 1}.`);
}

let previewGen = 0;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function highlightUpcomingStep(fromIndex = 0) {
  const i = scriptEditor.nextExecutable(fromIndex);
  if (i === -1) {
    state.stepLine = 0;
    scriptEditor.clearDot();
    if (scriptEditor.lineCount() > 0) scriptEditor.setCurrent(0, { notify: true });
    return;
  }
  state.stepLine = i;
  scriptEditor.setCurrent(i, { notify: true });
  scriptEditor.scrollLineIntoView(i);
}

/**
 * Refresh the CC match Dot / page highlight.
 * Retries help after navigation (e.g. Step on "go to" then preview the next click).
 */
async function refreshCcPreview(lineIndex = state.stepLine, { retries = 8 } = {}) {
  const gen = ++previewGen;
  const line = lineText(lineIndex);
  if (!line || scriptEditor.isComment(lineIndex) || !scriptEditor.isExecutable(lineIndex)) {
    if (gen !== previewGen) return;
    scriptEditor.clearDot();
    const tabId = await getActiveTabId();
    if (tabId != null) await send({ type: "CLEAR_PREVIEW", tabId });
    return;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (gen !== previewGen) return;
    const tabId = await getActiveTabId();
    if (tabId == null) {
      scriptEditor.clearDot();
      return;
    }
    const res = await send({ type: "PREVIEW_STEP", line, tabId });
    if (gen !== previewGen) return;

    if (!res || res.skipped || res.hasTarget === false) {
      scriptEditor.clearDot();
      return;
    }

    // hasTarget (page match, go to, if, etc.): always show green or red
    if (res.found) {
      scriptEditor.setDot("green");
      return;
    }

    // Not found yet — show red, but keep retrying after nav/load
    scriptEditor.setDot("red");
    if (attempt < retries) await delay(400);
  }
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
  tabScript.classList.toggle("active", name === "script");
  tabTables.classList.toggle("active", name === "tables");
  tabData.classList.toggle("active", name === "data");
  panelScript.classList.toggle("hidden", name !== "script");
  panelTables.classList.toggle("hidden", name !== "tables");
  panelData.classList.toggle("hidden", name !== "data");
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
  scriptName.value = s.name;
  scriptEditor.setText(s.text);
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
  const startLine = state.stepLine || 0;
  scriptEditor.clearDot();
  setStatus(startLine > 0 ? `Running from line ${startLine + 1}…` : "Running…", "run");
  await send({ type: "RUN_SCRIPT", script: scriptEditor.getText(), tabId, startLine });
}

async function stepScript() {
  const tabId = await getActiveTabId();
  if (tabId == null) {
    setStatus("No active tab.", "error");
    return;
  }
  let i = state.stepLine;
  i = scriptEditor.nextExecutable(i);
  if (i === -1) {
    state.stepLine = 0;
    setStatus("End of script. Step reset to top.");
    highlightUpcomingStep(0);
    return;
  }
  scriptEditor.clearDot();
  const res = await send({
    type: "RUN_STEP",
    script: scriptEditor.getText(),
    lineNumber: i,
    tabId,
  });
  if (res && res.ok) {
    if (res.done) {
      highlightUpcomingStep(0);
      setStatus("End of script. Step reset to top.");
      return;
    }
    // If we just evaluated an if, show green/red for the condition before jumping.
    if (typeof res.conditionResult === "boolean") {
      scriptEditor.setCurrent(i, { notify: false });
      scriptEditor.setDot(res.conditionResult ? "green" : "red");
    }
    // nextLine comes from ScriptRunner (if-branch / advance), not i+1.
    let next = typeof res.nextLine === "number" ? res.nextLine : i + 1;
    if (next >= scriptEditor.lineCount()) {
      highlightUpcomingStep(0);
      setStatus("End of script. Step reset to top.");
      return;
    }
    const exec = scriptEditor.nextExecutable(next);
    if (exec === -1) {
      highlightUpcomingStep(0);
      setStatus("End of script. Step reset to top.");
      return;
    }
    state.stepLine = exec;
    scriptEditor.setCurrent(exec, { notify: false });
    scriptEditor.scrollLineIntoView(exec);
    const jumped = exec > i + 1;
    setStatus(
      jumped
        ? `Current command: line ${exec + 1} (jumped after if).`
        : `Current command: line ${exec + 1}.`
    );
    await refreshCcPreview(exec, { retries: 10 });
  } else {
    state.stepLine = i;
    scriptEditor.setCurrent(i, { notify: false });
    scriptEditor.setDot("red");
    setStatus((res && res.error) || "Step failed.", "error");
  }
}

function stopRun() {
  send({ type: "STOP_RUN" });
  setStatus("Stopping…");
}

async function doSave() {
  const saved = await saveScript({
    id: state.currentId,
    name: scriptName.value.trim() || "Untitled",
    text: scriptEditor.getText(),
  });
  state.currentId = saved.id;
  await refreshLibrary();
  setStatus(`Saved "${saved.name}".`, "ok");
}

function doNew() {
  state.currentId = null;
  state.stepLine = 0;
  scriptName.value = "";
  scriptEditor.setText("");
  scriptEditor.setCurrent(0);
  scriptEditor.clearDot();
  refreshLibrary();
  setStatus("New script.");
  scriptEditorRoot.focus();
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
  const blob = new Blob([scriptEditor.getText()], { type: "text/plain" });
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
    scriptEditor.setText(String(reader.result || ""));
    state.currentId = null;
    scriptName.value = file.name.replace(/\.[^.]+$/, "");
    highlightUpcomingStep(0);
    setStatus(`Imported "${file.name}".`);
  };
  reader.readAsText(file);
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
        highlightUpcomingStep(state.stepLine);
      }
      break;
    case "RUN_PROGRESS":
      if (msg.status === "running") {
        setStatus(`Running: ${msg.text}`, "run");
        // Full Run owns CC updates here. Step owns CC in stepScript (avoids
        // out-of-order progress messages clearing the next line's Dot).
        if (state.running) {
          state.stepLine = msg.lineNumber;
          scriptEditor.setCurrent(msg.lineNumber, { notify: false });
          scriptEditor.clearDot();
          scriptEditor.scrollLineIntoView(msg.lineNumber);
        }
      } else if (msg.status === "ok") {
        setStatus(`OK: ${msg.text}`, "ok");
        if (state.running) {
          state.stepLine = msg.lineNumber + 1;
          highlightUpcomingStep(msg.lineNumber + 1);
        }
      } else if (msg.status === "skipped") {
        setStatus("Skipped.", "ok");
        if (state.running) {
          state.stepLine = msg.lineNumber + 1;
          highlightUpcomingStep(msg.lineNumber + 1);
        }
      } else if (msg.status === "error") {
        state.stepLine = msg.lineNumber;
        scriptEditor.setCurrent(msg.lineNumber, { notify: false });
        scriptEditor.setDot("red");
        setStatus(`Error: ${msg.text}`, "error");
      }
      break;
    case "WAIT_USER":
      userPromptText.textContent = msg.text || "Complete the action, then click Continue.";
      userPrompt.classList.remove("hidden");
      errorPrompt.classList.add("hidden");
      state.stepLine = msg.lineNumber;
      scriptEditor.setCurrent(msg.lineNumber, { notify: false });
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
    case "SCRATCH_UPDATED":
      scratchEditor.reloadIf(msg.tableId);
      break;
    case "EXTRACT_RESULT":
      scratchEditor.applyExtraction({
        scraped: msg.scraped,
        columns: msg.columns,
        tableXPath: msg.tableXPath,
        sourceUrl: msg.sourceUrl,
      });
      break;
    case "EXTRACT_CANCELLED":
      setStatus("Extraction cancelled.");
      break;
    case "PDB_AUTH":
      pdbAuthState.unlocked = !!msg.unlocked;
      pdbAuthState.hasPrivate = !!msg.hasPrivate;
      updatePdbAuthUi();
      break;
  }
});

tabScript.addEventListener("click", () => showTab("script"));
tabTables.addEventListener("click", () => showTab("tables"));
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
  await scratchEditor.refresh();
  const st = await send({ type: "GET_STATE" });
  if (st) {
    setRecording(!!st.recording);
    setRunning(!!st.running);
  }
  highlightUpcomingStep(0);
  setStatus("Ready.");
}

init();
