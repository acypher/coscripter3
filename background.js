// Background service worker: the coordinator between the side panel and the
// content scripts running in pages. It owns recording state, relays recorded
// steps to the panel, and drives script playback one command at a time
// (handling "go to" navigations itself).

import { parseScript, parseLine, getSlop } from "./src/core/parser.js";
import { ACTIONS } from "./src/core/commands.js";

const SESSION_KEY = "coscripter_session";

// In-memory run state (a single playback at a time). Recording state lives in
// chrome.storage.session so it survives the worker being suspended.
let runState = { running: false, abort: false };

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getSession() {
  const data = await chrome.storage.session.get(SESSION_KEY);
  return data[SESSION_KEY] || { recording: false, recordingTabId: null };
}

async function setSession(next) {
  await chrome.storage.session.set({ [SESSION_KEY]: next });
}

function notifyPanel(message) {
  // Broadcast to extension pages (the side panel). Ignore "no receiver" errors.
  chrome.runtime.sendMessage(message).catch(() => {});
}

function plainCommand(cmd) {
  return {
    action: cmd.action,
    label: cmd.label,
    type: cmd.type,
    value: cmd.value,
    location: cmd.location,
    indent: cmd.indent,
    lineNumber: cmd.lineNumber,
    raw: cmd.raw,
  };
}

// Make sure the content script is present and its modules are loaded.
async function ensureContentReady(tabId) {
  for (let i = 0; i < 25; i++) {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { type: "PING" });
      if (r && r.ok) return true;
    } catch (e) {
      // not injected yet
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["src/content/content.js"],
      });
    } catch (e) {
      // Restricted page (chrome://, web store, etc.) — give up.
      return false;
    }
    await delay(150);
  }
  return false;
}

function waitForLoad(tabId, timeout = 20000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.webNavigation.onCompleted.removeListener(onComplete);
      resolve();
    };
    const onComplete = (d) => {
      if (d.tabId === tabId && d.frameId === 0) finish();
    };
    chrome.webNavigation.onCompleted.addListener(onComplete);
    setTimeout(finish, timeout);
  });
}

async function runOne(cmd, tabId) {
  if (cmd.action === ACTIONS.GOTO) {
    let url = (cmd.location || "").trim();
    if (!url) return { ok: false, error: "No URL given." };
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !url.startsWith("about:")) {
      url = "https://" + url;
    }
    try {
      await chrome.tabs.update(tabId, { url });
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
    await waitForLoad(tabId);
    await delay(350);
    await ensureContentReady(tabId);
    return { ok: true };
  }

  const ready = await ensureContentReady(tabId);
  if (!ready) {
    return { ok: false, error: "Page is not accessible (try an http/https page)." };
  }
  try {
    const res = await chrome.tabs.sendMessage(tabId, {
      type: "EXECUTE",
      command: plainCommand(cmd),
    });
    return res || { ok: false, error: "No response from page." };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

async function runScript(text, tabId) {
  if (runState.running) return;
  const commands = parseScript(text).filter((c) => c.isExecutable());
  runState = { running: true, abort: false };
  notifyPanel({ type: "RUN_STATE", running: true });

  for (const cmd of commands) {
    if (runState.abort) break;
    notifyPanel({ type: "RUN_PROGRESS", lineNumber: cmd.lineNumber, status: "running", text: cmd.describe() });
    const res = await runOne(cmd, tabId);
    if (runState.abort) break;
    if (!res.ok) {
      notifyPanel({ type: "RUN_PROGRESS", lineNumber: cmd.lineNumber, status: "error", text: res.error });
      break;
    }
    notifyPanel({ type: "RUN_PROGRESS", lineNumber: cmd.lineNumber, status: "ok", text: cmd.describe() });
    await delay(250);
  }

  runState.running = false;
  notifyPanel({ type: "RUN_STATE", running: false });
}

async function handle(msg, sender, sendResponse) {
  if (!msg || !msg.type) {
    sendResponse({ ok: false });
    return;
  }

  switch (msg.type) {
    // ---- from content scripts ----
    case "CONTENT_READY": {
      if (sender.tab) {
        const s = await getSession();
        if (s.recording && sender.tab.id === s.recordingTabId) {
          chrome.tabs.sendMessage(sender.tab.id, { type: "START_REC" }).catch(() => {});
        }
      }
      sendResponse({ ok: true });
      return;
    }
    case "RECORDED_STEP": {
      if (sender.tab) {
        const s = await getSession();
        if (s.recording && sender.tab.id === s.recordingTabId) {
          notifyPanel({ type: "APPEND_STEP", step: msg.step });
        }
      }
      sendResponse({ ok: true });
      return;
    }

    // ---- from the side panel ----
    case "GET_STATE": {
      const s = await getSession();
      sendResponse({ recording: !!s.recording, running: runState.running });
      return;
    }
    case "START_RECORDING": {
      const tabId = msg.tabId;
      let tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch (e) {
        sendResponse({ ok: false, error: "No active tab." });
        return;
      }
      await setSession({ recording: true, recordingTabId: tabId });
      if (tab.url && /^https?:\/\//i.test(tab.url)) {
        notifyPanel({ type: "APPEND_STEP", step: `go to "${tab.url}"` });
      }
      const ready = await ensureContentReady(tabId);
      if (ready) {
        chrome.tabs.sendMessage(tabId, { type: "START_REC" }).catch(() => {});
      }
      notifyPanel({ type: "STATE", recording: true });
      sendResponse({ ok: ready, error: ready ? undefined : "Can't record on this page." });
      return;
    }
    case "STOP_RECORDING": {
      const s = await getSession();
      if (s.recordingTabId != null) {
        chrome.tabs.sendMessage(s.recordingTabId, { type: "STOP_REC" }).catch(() => {});
      }
      await setSession({ recording: false, recordingTabId: null });
      notifyPanel({ type: "STATE", recording: false });
      sendResponse({ ok: true });
      return;
    }
    case "RUN_SCRIPT": {
      sendResponse({ ok: true });
      runScript(msg.script || "", msg.tabId);
      return;
    }
    case "RUN_STEP": {
      const [indent, slop] = getSlop(msg.line || "");
      if (slop === "" || indent === 0) {
        sendResponse({ ok: true, skipped: true });
        return;
      }
      const cmd = parseLine(slop, indent);
      cmd.lineNumber = msg.lineNumber;
      notifyPanel({ type: "RUN_PROGRESS", lineNumber: msg.lineNumber, status: "running", text: cmd.describe() });
      const res = await runOne(cmd, msg.tabId);
      notifyPanel({
        type: "RUN_PROGRESS",
        lineNumber: msg.lineNumber,
        status: res.ok ? "ok" : "error",
        text: res.ok ? cmd.describe() : res.error,
      });
      sendResponse(res);
      return;
    }
    case "STOP_RUN": {
      runState.abort = true;
      sendResponse({ ok: true });
      return;
    }
    default:
      sendResponse({ ok: false, error: "Unknown message: " + msg.type });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender, sendResponse);
  return true; // responses are sent asynchronously
});

// Record top-level address-bar navigations as "go to" steps while recording.
chrome.webNavigation.onCommitted.addListener(async (d) => {
  if (d.frameId !== 0) return;
  const s = await getSession();
  if (!s.recording || d.tabId !== s.recordingTabId) return;
  const typedTransitions = ["typed", "generated", "keyword", "keyword_generated", "auto_bookmark", "start_page"];
  if (typedTransitions.includes(d.transitionType)) {
    notifyPanel({ type: "APPEND_STEP", step: `go to "${d.url}"` });
  }
});

// Re-arm the recorder after each navigation in the recording tab.
chrome.webNavigation.onCompleted.addListener(async (d) => {
  if (d.frameId !== 0) return;
  const s = await getSession();
  if (s.recording && d.tabId === s.recordingTabId) {
    const ready = await ensureContentReady(d.tabId);
    if (ready) chrome.tabs.sendMessage(d.tabId, { type: "START_REC" }).catch(() => {});
  }
});

// Stop recording if the recording tab goes away.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const s = await getSession();
  if (s.recordingTabId === tabId) {
    await setSession({ recording: false, recordingTabId: null });
    notifyPanel({ type: "STATE", recording: false });
  }
});

// Clicking the toolbar icon opens the side panel.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
// Also set it as soon as the worker loads, in case the events above already fired.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
