// Side panel UI logic. Talks only to the background worker, which coordinates
// recording and playback in the page.

import { listScripts, getScript, saveScript, deleteScript } from "../core/storage.js";

const editor = document.getElementById("editor");
const highlights = document.getElementById("highlights");
const backdrop = document.getElementById("backdrop");
const scriptName = document.getElementById("scriptName");
const scriptList = document.getElementById("scriptList");
const scriptCount = document.getElementById("scriptCount");
const libraryDetails = document.getElementById("libraryDetails");
const statusEl = document.getElementById("status");

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

let state = {
  currentId: null,
  recording: false,
  running: false,
  stepLine: 0, // next editor line index to try in Step mode
};

// ---- helpers ----

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

// Render the highlight backdrop, marking one line by status.
function setActiveLine(lineNumber, status) {
  const lines = editor.value.split("\n");
  const html = lines
    .map((line, i) => {
      const safe = escapeHtml(line) || " ";
      if (i === lineNumber && status) {
        return `<mark class="${status}">${safe}</mark>`;
      }
      return safe;
    })
    .join("\n");
  highlights.innerHTML = html;
  syncScroll();
  scrollLineIntoView(lineNumber);
}

function clearHighlight() {
  highlights.innerHTML = "";
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
  syncScroll();
  editor.scrollTop = editor.scrollHeight;
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
}

// ---- script library ----

function formatDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
  clearHighlight();
  await refreshLibrary();
  setStatus(`Loaded "${s.name}".`);
}

// ---- actions ----

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
  // find next executable line at or after state.stepLine
  let i = state.stepLine;
  while (i < lines.length && !/^\s*\*+\s+\S/.test(lines[i])) i++;
  if (i >= lines.length) {
    state.stepLine = 0;
    setStatus("End of script. Step reset to top.");
    clearHighlight();
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
  const text = editor.value;
  const name = scriptName.value.trim() || "Untitled";
  const saved = await saveScript({ id: state.currentId, name, text });
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
    clearHighlight();
    setStatus(`Imported "${file.name}".`);
  };
  reader.readAsText(file);
}

// ---- messages from the background worker ----

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
        setActiveLine(msg.lineNumber, "ok");
        setStatus(`OK: ${msg.text}`, "ok");
      } else if (msg.status === "error") {
        setActiveLine(msg.lineNumber, "error");
        setStatus(`Error: ${msg.text}`, "error");
      }
      break;
  }
});

// ---- wiring ----

editor.addEventListener("scroll", syncScroll);
editor.addEventListener("input", () => {
  state.stepLine = 0;
  clearHighlight();
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

async function init() {
  await refreshLibrary();
  const st = await send({ type: "GET_STATE" });
  if (st) {
    setRecording(!!st.recording);
    setRunning(!!st.running);
  }
  setStatus("Ready.");
}

init();
