// Background service worker: coordinator between side panel and content scripts.

import { parseScript, parseLine, getSlop } from "./src/core/parser.js";
import { ACTIONS, Command } from "./src/core/commands.js";
import { ScriptRunner } from "./src/core/runner.js";
import {
  PersonalDB,
  hasStoredCrypto,
  isUnlocked,
  lock,
  setupPassword,
  unlockWithPassword,
} from "./src/core/personaldb.js";
import {
  loadTableForRef,
  saveTable,
  ScratchTable,
  getTableByName,
  getTable,
  listTables,
} from "./src/core/scratchtable.js";

const SESSION_KEY = "coscripter_session";

/** In-memory mirror avoids missing nav events before storage writes complete. */
let liveSession = null;

let runState = {
  running: false,
  abort: false,
  waitingForUser: false,
  waitingForError: false,
  errorResolve: null,
  userResolve: null,
  runner: null,
  tabId: null,
  pendingNewTabId: null,
  scratchTableId: null,
};

/** In-memory clipboard for scratchtable copy/paste within a run. */
let scratchClipboard = "";

// tabId -> { createdAt, openerTabId }; used to suppress spurious recorded
// "switch to tab" steps right after a link opens or closes a tab.
const tabMeta = new Map();
let lastTabRemovedAt = 0;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getSession() {
  const data = await chrome.storage.session.get(SESSION_KEY);
  const s = data[SESSION_KEY] || {};
  const session = {
    recording: false,
    recordingTabIds: [],
    primaryTabId: null,
    lastTransition: null,
    navStacks: {},
    ...s,
  };
  if (session.recordingTabId && !session.recordingTabIds?.length) {
    session.recordingTabIds = [session.recordingTabId];
  }
  if (liveSession) {
    session.recording = liveSession.recording;
    session.recordingTabIds = [...liveSession.recordingTabIds];
    session.navStacks = liveSession.navStacks;
    session.primaryTabId = liveSession.primaryTabId;
    session.lastTransition = liveSession.lastTransition;
  }
  return session;
}

async function setSession(next) {
  liveSession = {
    recording: !!next.recording,
    recordingTabIds: [...(next.recordingTabIds || [])],
    primaryTabId: next.primaryTabId ?? null,
    lastTransition: next.lastTransition ?? null,
    navStacks: structuredClone(next.navStacks || {}),
  };
  await chrome.storage.session.set({ [SESSION_KEY]: next });
}

function trackRecordingTab(tabId) {
  if (!liveSession?.recording || tabId == null) return;
  if (!liveSession.recordingTabIds.includes(tabId)) {
    liveSession.recordingTabIds.push(tabId);
  }
}

function notifyPanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

function pdbEntriesForRecording(db) {
  return db.entries.filter((e) => !e.masked);
}

const TYPED_NAV_TRANSITIONS = [
  "typed", "generated", "keyword", "keyword_generated", "auto_bookmark", "start_page",
];

let lastNavRecord = { tabId: null, step: "", url: "", time: 0 };

function navUrlKey(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    let href = u.href;
    if (href.endsWith("/") && u.pathname !== "/") href = href.slice(0, -1);
    return href;
  } catch (e) {
    return url || "";
  }
}

function isHistoryNavigation(d) {
  return d.transitionQualifiers?.includes("forward_back") || d.transitionType === "back_forward";
}

function emptyNavStack() {
  return { entries: [], index: -1 };
}

function getNavStack(session, tabId) {
  const stacks = session.navStacks || {};
  return stacks[tabId] ? { ...stacks[tabId], entries: [...stacks[tabId].entries] } : emptyNavStack();
}

function setNavStack(session, tabId, stack) {
  return { ...(session.navStacks || {}), [tabId]: stack };
}

function recordNavStep(step, tabId, url) {
  const now = Date.now();
  const key = navUrlKey(url);
  if (
    lastNavRecord.tabId === tabId &&
    lastNavRecord.step === step &&
    lastNavRecord.url === key &&
    now - lastNavRecord.time < 800
  ) {
    return;
  }
  lastNavRecord = { tabId, step, url: key, time: now };
  notifyPanel({ type: "APPEND_STEP", step });
}

function handleHistoryNavigation(stack, url) {
  const key = navUrlKey(url);
  const entries = stack.entries.map(navUrlKey);
  if (stack.index > 0 && entries[stack.index - 1] === key) {
    stack.index -= 1;
    return "go back";
  }
  if (stack.index >= 0 && stack.index < entries.length - 1 && entries[stack.index + 1] === key) {
    stack.index += 1;
    return "go forward";
  }
  return "go back";
}

function pushNavEntry(stack, url) {
  const key = navUrlKey(url);
  const entries = stack.entries.map(navUrlKey);
  if (stack.index >= 0 && entries[stack.index] === key) return stack;
  if (stack.index === -1 && stack.entries.length === 0) {
    stack.entries = [url];
    stack.index = 0;
    return stack;
  }
  stack.entries = stack.entries.slice(0, stack.index + 1);
  stack.entries.push(url);
  stack.index = stack.entries.length - 1;
  return stack;
}

async function persistNavStack(session, tabId, stack) {
  const navStacks = setNavStack(session, tabId, stack);
  await setSession({ ...session, navStacks });
}

async function resolveRecordingSession(tabId) {
  let s = await getSession();
  if (!s.recording) return null;
  if (s.recordingTabIds.includes(tabId)) return s;
  try {
    const tab = await chrome.tabs.get(tabId);
    const openerId = tab.openerTabId;
    if (openerId != null && openerId !== -1 && s.recordingTabIds.includes(openerId)) {
      trackRecordingTab(tabId);
      s = { ...s, recordingTabIds: [...liveSession.recordingTabIds] };
      await setSession(s);
      return s;
    }
  } catch (e) { /* tab gone */ }
  return null;
}

async function recordHistoryStep(tabId, url) {
  const s = await resolveRecordingSession(tabId);
  if (!s) return;
  const stack = getNavStack(s, tabId);
  const step = handleHistoryNavigation(stack, url);
  await persistNavStack(s, tabId, stack);
  recordNavStep(step, tabId, url);
}

async function handleRecordedNavigation(d) {
  if (d.frameId !== 0) return;
  const s = await resolveRecordingSession(d.tabId);
  if (!s) return;

  let stack = getNavStack(s, d.tabId);

  if (d.transitionType === "reload") {
    recordNavStep("reload", d.tabId, d.url);
    return;
  }

  if (isHistoryNavigation(d)) {
    const step = handleHistoryNavigation(stack, d.url);
    await persistNavStack(s, d.tabId, stack);
    recordNavStep(step, d.tabId, d.url);
    return;
  }

  stack = pushNavEntry(stack, d.url);
  await persistNavStack(s, d.tabId, stack);

  if (TYPED_NAV_TRANSITIONS.includes(d.transitionType)) {
    recordNavStep(`go to "${d.url}"`, d.tabId, d.url);
  }
}

function plainCommand(cmd) {
  return { ...cmd };
}

async function ensureContentReady(tabId) {
  for (let i = 0; i < 25; i++) {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { type: "PING" });
      if (r && r.ok) return true;
    } catch (e) { /* not injected */ }
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["src/content/content.js"],
      });
    } catch (e) {
      return false;
    }
    await delay(150);
  }
  return false;
}

// Wait for a navigation to settle. Full page loads resolve on onCompleted;
// SPA navigations (pushState back/forward) resolve on onHistoryStateUpdated;
// bfcache restores may only fire onCommitted, so that resolves after a short
// settle delay. Never hangs longer than `timeout`.
function waitForNav(tabId, timeout = 15000) {
  return new Promise((resolve) => {
    let done = false;
    const listeners = [];
    const finish = () => {
      if (done) return;
      done = true;
      for (const [event, fn] of listeners) event.removeListener(fn);
      resolve();
    };
    const listen = (event, fn) => {
      listeners.push([event, fn]);
      event.addListener(fn);
    };
    listen(chrome.webNavigation.onCompleted, (d) => {
      if (d.tabId === tabId && d.frameId === 0) finish();
    });
    listen(chrome.webNavigation.onHistoryStateUpdated, (d) => {
      if (d.tabId === tabId && d.frameId === 0) finish();
    });
    listen(chrome.webNavigation.onCommitted, (d) => {
      if (d.tabId === tabId && d.frameId === 0) setTimeout(finish, 800);
    });
    setTimeout(finish, timeout);
  });
}

async function findTabByTitle(title) {
  const tabs = await chrome.tabs.query({});
  const wanted = (title || "").toLowerCase();
  let best = null;
  for (const tab of tabs) {
    const t = (tab.title || "").toLowerCase();
    if (t === wanted) return tab;
    if (t.includes(wanted) || wanted.includes(t)) {
      if (!best) best = tab;
    }
  }
  return best;
}

async function resolveCommand(cmd, db) {
  const resolved = db.resolve(new Command(cmd));
  return resolved;
}

async function runPageCommand(cmd, tabId) {
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

async function checkCondition(cmd, tabId) {
  const ready = await ensureContentReady(tabId);
  if (!ready) return false;
  try {
    const res = await chrome.tabs.sendMessage(tabId, {
      type: "CHECK",
      command: plainCommand(cmd),
    });
    return !!(res && res.ok);
  } catch (e) {
    return false;
  }
}

async function readElementValueFromPage(cmd, tabId) {
  const ready = await ensureContentReady(tabId);
  if (!ready) return null;
  try {
    const res = await chrome.tabs.sendMessage(tabId, {
      type: "READ_VALUE",
      command: plainCommand(cmd),
    });
    return res?.value ?? null;
  } catch (e) {
    return null;
  }
}

async function evaluateCondition(resolved, tabId) {
  if (resolved.conditionType === "comparison" && resolved.compareRightIsTarget) {
    const side = resolved.compareRight || {};
    const targetCmd = new Command({
      label: side.label,
      type: side.type,
      ordinal: side.ordinal,
      nameFilter: side.nameFilter,
      xpath: side.xpath || "",
    });
    const val = await readElementValueFromPage(targetCmd, tabId);
    resolved.compareRightValue = val ?? "";
  }

  const result = await checkCondition(resolved, tabId);
  return { ok: true, conditionResult: result };
}

function personalLookupError(resolved) {
  if (!resolved.lookupBlocked) return null;
  return `Unlock your data to use private value "${resolved.blockedKey}".`;
}

async function readCellValue(cellRef) {
  const ref = applyRowRepeatOverride(cellRef);
  const table = await loadTableForRef(ref, runState.scratchTableId);
  if (!table) {
    return { ok: false, error: ref.tableName
      ? `No scratchtable named "${ref.tableName}".`
      : "No scratchtable found. Create one in the Tables tab." };
  }
  const pos = table.resolveCellRef(ref);
  if (!pos) {
    return { ok: false, error: `Could not find cell ${Command.formatCellRef(ref)}.` };
  }
  runState.scratchTableId = table.id;
  const cell = table.getCell(pos.row, pos.col);
  return { ok: true, table, pos, text: cell.text, url: cell.url };
}

/** During "repeat" over rows, remap cell refs to the current iteration row. */
function applyRowRepeatOverride(cellRef) {
  if (!cellRef || !runState.runner) return cellRef;
  const rowIndex = runState.runner.getScratchRowIndex?.();
  if (rowIndex == null) return cellRef;
  return {
    ...cellRef,
    rowNumber: rowIndex + 1,
    rowLabel: "",
    rowIsPersonal: false,
  };
}

function looksLikeUrl(s) {
  const t = (s || "").trim();
  return /^https?:\/\//i.test(t) || /^www\./i.test(t);
}

async function executeScratchCellCommand(resolved, tabId) {
  const ref = applyRowRepeatOverride(resolved.cellRef);
  const table = await loadTableForRef(ref, runState.scratchTableId);
  if (!table) {
    return {
      ok: false,
      error: ref.tableName
        ? `No scratchtable named "${ref.tableName}".`
        : "No scratchtable found. Create one in the Tables tab.",
    };
  }
  runState.scratchTableId = table.id;

  const writeActions = [
    ACTIONS.ENTER, ACTIONS.PUT, ACTIONS.APPEND,
    ACTIONS.PASTE, ACTIONS.INCREMENT, ACTIONS.DECREMENT,
  ];
  const pos = writeActions.includes(resolved.action)
    ? table.ensureCellRef(ref)
    : table.resolveCellRef(ref);
  if (!pos) {
    return { ok: false, error: `Could not find cell ${Command.formatCellRef(ref)}.` };
  }

  switch (resolved.action) {
    case ACTIONS.ENTER:
    case ACTIONS.PUT:
      table.setCellText(pos.row, pos.col, resolved.value ?? "");
      await saveTable(table);
      notifyPanel({ type: "SCRATCH_UPDATED", tableId: table.id });
      return { ok: true };

    case ACTIONS.APPEND: {
      const existing = table.getCellText(pos.row, pos.col);
      table.setCellText(pos.row, pos.col, existing + (resolved.value ?? ""));
      await saveTable(table);
      notifyPanel({ type: "SCRATCH_UPDATED", tableId: table.id });
      return { ok: true };
    }

    case ACTIONS.COPY:
    case ACTIONS.CLIP: {
      const text = table.getCellText(pos.row, pos.col);
      scratchClipboard = text;
      try {
        await chrome.tabs.sendMessage(tabId, { type: "SET_CLIPBOARD", text });
      } catch (e) { /* page may be inaccessible */ }
      return { ok: true };
    }

    case ACTIONS.PASTE: {
      let text = scratchClipboard;
      try {
        const res = await chrome.tabs.sendMessage(tabId, { type: "GET_CLIPBOARD" });
        if (res?.text) text = res.text;
      } catch (e) { /* use scratch clipboard */ }
      table.setCellText(pos.row, pos.col, text || "");
      await saveTable(table);
      notifyPanel({ type: "SCRATCH_UPDATED", tableId: table.id });
      return { ok: true };
    }

    case ACTIONS.INCREMENT:
    case ACTIONS.DECREMENT: {
      const by = resolved.incrementBy || 1;
      const delta = resolved.action === ACTIONS.DECREMENT ? -by : by;
      const current = parseFloat(table.getCellText(pos.row, pos.col));
      const next = (Number.isFinite(current) ? current : 0) + delta;
      table.setCellText(pos.row, pos.col, String(next));
      await saveTable(table);
      notifyPanel({ type: "SCRATCH_UPDATED", tableId: table.id });
      return { ok: true };
    }

    case ACTIONS.CLICK:
    case ACTIONS.CONTROL_CLICK:
    case ACTIONS.DOUBLE_CLICK: {
      const cell = table.getCell(pos.row, pos.col);
      let url = (cell.url || "").trim();
      if (!url && looksLikeUrl(cell.text)) url = cell.text.trim();
      if (!url) {
        return { ok: false, error: "Scratchtable cell has no link URL to click." };
      }
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = "https://" + url;
      if (resolved.action === ACTIONS.CONTROL_CLICK) {
        const tab = await chrome.tabs.create({ url, active: true });
        runState.tabId = tab.id;
        await waitForNav(tab.id);
        return { ok: true, tabId: tab.id };
      }
      await chrome.tabs.update(tabId, { url });
      await waitForNav(tabId);
      await delay(350);
      return { ok: true };
    }

    default:
      return { ok: false, error: `Cannot run "${resolved.action}" on a scratchtable cell.` };
  }
}

async function runOne(cmd, tabId, db) {
  const resolved = await resolveCommand(cmd, db);
  const blocked = personalLookupError(resolved);
  if (blocked) return { ok: false, error: blocked };

  // Resolve value from a scratchtable cell when the script says
  // enter the cell … into the "Search" textbox
  if (resolved.valueCellRef) {
    const cellVal = await readCellValue(resolved.valueCellRef);
    if (!cellVal.ok) return cellVal;
    resolved.value = cellVal.text;
    resolved.valueIsPersonal = false;
  }

  // Comparison against a scratchtable cell
  if (
    resolved.conditionType === "comparison" &&
    (resolved.compareLeft?.isCellRef || resolved.compareRight?.isCellRef)
  ) {
    if (resolved.compareLeft?.isCellRef) {
      const left = await readCellValue(resolved.compareLeft.cellRef);
      if (!left.ok) return left;
      resolved.compareLeftValue = left.text;
    }
    if (resolved.compareRight?.isCellRef) {
      const right = await readCellValue(resolved.compareRight.cellRef);
      if (!right.ok) return right;
      resolved.compareRightValue = right.text;
    }
  }

  if (resolved.action === ACTIONS.YOU) {
    runState.waitingForUser = true;
    notifyPanel({
      type: "WAIT_USER",
      lineNumber: resolved.lineNumber,
      text: resolved.raw || resolved.describe(),
    });
    await new Promise((resolve) => { runState.userResolve = resolve; });
    runState.waitingForUser = false;
    runState.userResolve = null;
    if (runState.abort) return { ok: false, error: "Stopped." };
    return { ok: true };
  }

  if (resolved.action === ACTIONS.PAUSE) {
    await delay((resolved.seconds || 1) * 1000);
    return { ok: true };
  }

  if (resolved.action === ACTIONS.INCREMENT) {
    if (resolved.cellRef) return executeScratchCellCommand(resolved, tabId);
    db.increment(resolved.personalKey || resolved.label, resolved.incrementBy || 1);
    await db.save();
    notifyPanel({ type: "PDB_UPDATED", text: db.text });
    return { ok: true };
  }

  if (resolved.action === ACTIONS.DECREMENT) {
    if (resolved.cellRef) return executeScratchCellCommand(resolved, tabId);
    db.decrement(resolved.personalKey || resolved.label, resolved.incrementBy || 1);
    await db.save();
    notifyPanel({ type: "PDB_UPDATED", text: db.text });
    return { ok: true };
  }

  if (resolved.action === ACTIONS.GOTO) {
    let url = (resolved.location || "").trim();
    if (!url) return { ok: false, error: "No URL given." };
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !url.startsWith("about:")) {
      url = "https://" + url;
    }
    try {
      await chrome.tabs.update(tabId, { url });
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
    await waitForNav(tabId);
    await delay(350);
    await ensureContentReady(tabId);
    return { ok: true };
  }

  if (resolved.action === ACTIONS.GO_BACK) {
    try {
      await chrome.tabs.goBack(tabId);
      await waitForNav(tabId, 8000);
      await delay(350);
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
    return { ok: true };
  }

  if (resolved.action === ACTIONS.GO_FORWARD) {
    try {
      await chrome.tabs.goForward(tabId);
      await waitForNav(tabId, 8000);
      await delay(350);
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
    return { ok: true };
  }

  if (resolved.action === ACTIONS.RELOAD) {
    try {
      await chrome.tabs.reload(tabId);
      await waitForNav(tabId);
      await delay(350);
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
    return { ok: true };
  }

  if (resolved.action === ACTIONS.CREATE_TAB) {
    const tab = await chrome.tabs.create({ active: true });
    runState.tabId = tab.id;
    runState.pendingNewTabId = null;
    await delay(300);
    return { ok: true, tabId: tab.id };
  }

  if (resolved.action === ACTIONS.CREATE_WINDOW) {
    const win = await chrome.windows.create({ focused: true });
    const tabs = await chrome.tabs.query({ windowId: win.id, active: true });
    const tab = tabs[0];
    if (tab) {
      runState.tabId = tab.id;
      await delay(300);
      return { ok: true, tabId: tab.id };
    }
    return { ok: true };
  }

  if (resolved.action === ACTIONS.OPEN) {
    let url = (resolved.location || "").trim();
    if (!url) return { ok: false, error: "No URL given." };
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !url.startsWith("about:")) {
      url = "https://" + url;
    }
    if (resolved.openInWindow) {
      const win = await chrome.windows.create({ url, focused: true });
      const tabs = await chrome.tabs.query({ windowId: win.id, active: true });
      const tab = tabs[0];
      if (tab) {
        runState.tabId = tab.id;
        await waitForNav(tab.id);
        await delay(350);
        return { ok: true, tabId: tab.id };
      }
      return { ok: true };
    }
    const tab = await chrome.tabs.create({ url, active: true });
    runState.tabId = tab.id;
    await waitForNav(tab.id);
    await delay(350);
    return { ok: true, tabId: tab.id };
  }

  if (resolved.action === ACTIONS.SWITCH_TAB) {
    const tab = await findTabByTitle(resolved.label);
    if (!tab) return { ok: false, error: `No tab matching "${resolved.label}".` };
    await chrome.tabs.update(tab.id, { active: true });
    runState.tabId = tab.id;
    return { ok: true, tabId: tab.id };
  }

  if (resolved.action === ACTIONS.CLOSE_TAB) {
    const tab = resolved.label ? await findTabByTitle(resolved.label) : await chrome.tabs.get(tabId);
    if (!tab) return { ok: false, error: `No tab matching "${resolved.label}".` };
    await chrome.tabs.remove(tab.id);
    if (tab.id === runState.tabId) {
      // Keep the run going on whichever tab Chrome activates next.
      await delay(200);
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (active) return { ok: true, tabId: active.id };
    }
    return { ok: true };
  }

  if (resolved.action === ACTIONS.IF || resolved.action === ACTIONS.THERE_IS) {
    return evaluateCondition(resolved, tabId);
  }

  if (resolved.action === ACTIONS.BEGIN_EXTRACTION || resolved.action === ACTIONS.END_EXTRACTION) {
    return { ok: true };
  }

  if (resolved.action === ACTIONS.EXTRACT) {
    return executeExtractCommand(resolved, tabId);
  }

  if (resolved.cellRef) {
    return executeScratchCellCommand(resolved, tabId);
  }

  return runPageCommand(resolved, tabId);
}

/**
 * Re-scrape the page into a named (or current) scratchtable using a saved
 * extraction recipe when available (Phase 6g).
 */
async function executeExtractCommand(resolved, tabId) {
  const name = (resolved.extractTableName || resolved.label || "").trim();
  let table = null;
  if (name) {
    table = await getTableByName(name);
    if (!table) table = ScratchTable.create(name, { rowCount: 0 });
  } else if (runState.scratchTableId) {
    table = await getTable(runState.scratchTableId);
  }
  if (!table) {
    const list = await listTables();
    table = list[0] || null;
  }
  if (!table) {
    return {
      ok: false,
      error: name
        ? `No scratchtable named "${name}". Create one in the Tables tab or extract interactively first.`
        : "No scratchtable found. Create one in the Tables tab.",
    };
  }

  const ready = await ensureContentReady(tabId);
  if (!ready) return { ok: false, error: "Page is not accessible." };

  let res;
  try {
    res = await chrome.tabs.sendMessage(tabId, {
      type: "EXTRACT_PAGE",
      recipe: table.extraction || null,
    });
  } catch (e) {
    return { ok: false, error: "No response from page." };
  }
  if (!res?.ok || !res.scraped) {
    return { ok: false, error: res?.error || "No table data found on this page." };
  }

  const overwrite = resolved.extractOverwrite !== false;
  table.loadFromScraped(res.scraped, { append: !overwrite });
  const prev = table.extraction || {};
  table.extraction = {
    sourceUrl: res.sourceUrl || prev.sourceUrl || "",
    tableXPath: prev.tableXPath || res.scraped.tableXPath || "",
    columns: (Array.isArray(prev.columns) && prev.columns.length)
      ? prev.columns
      : (res.scraped.columns || []),
  };
  const saved = await saveTable(table);
  runState.scratchTableId = saved.id;
  notifyPanel({ type: "SCRATCH_UPDATED", tableId: saved.id });
  return { ok: true };
}

async function waitForErrorDecision() {
  runState.waitingForError = true;
  const decision = await new Promise((resolve) => { runState.errorResolve = resolve; });
  runState.waitingForError = false;
  runState.errorResolve = null;
  return decision;
}

// Errors that are usually just "the page isn't ready yet" — worth retrying
// for a while before bothering the user.
function isTransientError(res) {
  const e = res.error || "";
  return (
    e.startsWith("Could not find") ||
    e.startsWith("Verify failed") ||
    e.startsWith("Page is not accessible") ||
    e.startsWith("No response from page")
  );
}

const RETRY_WINDOW_MS = 8000;
const RETRY_INTERVAL_MS = 600;

async function runOneWithRetry(cmd, db) {
  let res = await runOne(cmd, runState.tabId, db);
  const deadline = Date.now() + RETRY_WINDOW_MS;
  while (!res.ok && isTransientError(res) && !runState.abort && Date.now() < deadline) {
    await delay(RETRY_INTERVAL_MS);
    res = await runOne(cmd, runState.tabId, db);
  }
  return res;
}

// If the last step opened a new tab from the run tab (link with
// target=_blank), continue the run in that tab — mirroring how recording
// folds tab creation into the link click.
async function followPendingNewTab() {
  const id = runState.pendingNewTabId;
  runState.pendingNewTabId = null;
  if (id == null) return;
  try {
    await chrome.tabs.get(id);
  } catch (e) {
    return; // already closed
  }
  runState.tabId = id;
  await waitForNav(id, 10000);
  await delay(350);
}

async function runScript(text, tabId, startLine = 0) {
  if (runState.running) return;
  const db = await PersonalDB.load();
  const runner = ScriptRunner.fromText(text);
  // parseScript keeps one command per source line, so pc == lineNumber.
  if (startLine > 0) {
    runner.pc = Math.min(Math.max(0, startLine | 0), runner.commands.length);
  }
  runState = {
    running: true,
    abort: false,
    waitingForUser: false,
    waitingForError: false,
    errorResolve: null,
    userResolve: null,
    runner,
    tabId,
    pendingNewTabId: null,
    scratchTableId: null,
  };
  notifyPanel({ type: "RUN_STATE", running: true });

  while (!runState.abort) {
    const step = runner.next();
    if (!step) break;
    const cmd = step.cmd;

    if (step.type === "repeat-counter") {
      const val = parseInt(db.lookup(cmd.counterKey) || "0", 10);
      if (val <= 0) {
        runner.skipBlock(cmd);
        continue;
      }
      runner.enterCounterRepeat(cmd);
      db.decrement(cmd.counterKey, 1);
      await db.save();
      notifyPanel({ type: "PDB_UPDATED", text: db.text });
      continue;
    }

    if (step.type === "repeat-rows") {
      const table = await loadTableForRef(
        { tableName: cmd.repeatTableName || "" },
        runState.scratchTableId
      );
      if (!table) {
        notifyPanel({
          type: "RUN_PROGRESS",
          lineNumber: cmd.lineNumber,
          status: "error",
          text: cmd.repeatTableName
            ? `No scratchtable named "${cmd.repeatTableName}".`
            : "No scratchtable found for repeat.",
        });
        runner.skipBlock(cmd);
        continue;
      }
      runState.scratchTableId = table.id;
      const n = table.getRowCount();
      if (n < 1) {
        runner.skipBlock(cmd);
        continue;
      }
      runner.enterRowRepeat(cmd, n);
      continue;
    }

    if (step.type === "if") {
      notifyPanel({ type: "RUN_PROGRESS", lineNumber: cmd.lineNumber, status: "running", text: cmd.describe() });
      const res = await runOne(cmd, runState.tabId, db);
      if (runState.abort) break;
      runner.branch(cmd, !!res.conditionResult);
      continue;
    }

    notifyPanel({ type: "RUN_PROGRESS", lineNumber: cmd.lineNumber, status: "running", text: cmd.describe() });
    const res = await runOneWithRetry(cmd, db);
    if (runState.abort) break;

    if (res.tabId) runState.tabId = res.tabId;

    if (!res.ok) {
      notifyPanel({ type: "RUN_PROGRESS", lineNumber: cmd.lineNumber, status: "error", text: res.error });
      notifyPanel({ type: "ERROR_PROMPT", lineNumber: cmd.lineNumber, text: res.error });
      const decision = await waitForErrorDecision();
      if (decision === "retry") continue;
      if (decision === "skip") {
        runner.advance();
        notifyPanel({ type: "RUN_PROGRESS", lineNumber: cmd.lineNumber, status: "skipped", text: "Skipped." });
        continue;
      }
      break;
    }

    notifyPanel({ type: "RUN_PROGRESS", lineNumber: cmd.lineNumber, status: "ok", text: cmd.describe() });
    runner.advance();
    await followPendingNewTab();
    await delay(200);
  }

  runState.running = false;
  notifyPanel({ type: "RUN_STATE", running: false });
}

async function armRecordingTab(tabId) {
  if (tabId == null) return;
  const ready = await ensureContentReady(tabId);
  if (!ready) return;
  const db = await PersonalDB.load();
  chrome.tabs.sendMessage(tabId, {
    type: "START_REC",
    pdbEntries: pdbEntriesForRecording(db),
  }).catch(() => {});
}

async function handle(msg, sender, sendResponse) {
  if (!msg || !msg.type) {
    sendResponse({ ok: false });
    return;
  }

  switch (msg.type) {
    case "CONTENT_READY": {
      const s = await getSession();
      if (s.recording && sender.tab && s.recordingTabIds.includes(sender.tab.id)) {
        const db = await PersonalDB.load();
        chrome.tabs.sendMessage(sender.tab.id, {
          type: "START_REC",
          pdbEntries: pdbEntriesForRecording(db),
        }).catch(() => {});
      }
      sendResponse({ ok: true });
      return;
    }

    case "RECORDED_STEP": {
      if (sender.tab?.id != null) {
        const s = await resolveRecordingSession(sender.tab.id);
        if (s) notifyPanel({ type: "APPEND_STEP", step: msg.step });
      }
      sendResponse({ ok: true });
      return;
    }

    case "RECORDED_HISTORY": {
      if (sender.tab?.id && msg.url) {
        recordHistoryStep(sender.tab.id, msg.url).catch(() => {});
      }
      sendResponse({ ok: true });
      return;
    }

    case "GET_STATE": {
      const s = await getSession();
      sendResponse({ recording: !!s.recording, running: runState.running });
      return;
    }

    case "GET_PDB": {
      const db = await PersonalDB.load();
      sendResponse({
        ok: true,
        text: db.toDisplayText(),
        unlocked: isUnlocked(),
        hasPrivate: db.hasPrivateEntries(),
      });
      return;
    }

    case "SAVE_PDB": {
      const db = await PersonalDB.load();
      db.updateFromText(msg.text || "");
      const wantsNewPrivate = db.entries.some((e) => e.private && !e.masked);
      if (wantsNewPrivate && !(await hasStoredCrypto())) {
        sendResponse({ ok: false, needSetupPassword: true });
        return;
      }
      try {
        await db.save();
        sendResponse({
          ok: true,
          text: db.toDisplayText(),
          unlocked: isUnlocked(),
          hasPrivate: db.hasPrivateEntries(),
        });
      } catch (e) {
        const message = String(e.message || e);
        sendResponse({
          ok: false,
          error: message,
          needUnlock: message.includes("Unlock"),
          needSetupPassword: message.includes("add or edit private"),
        });
      }
      return;
    }

    case "UNLOCK_PDB": {
      const result = await unlockWithPassword(msg.password || "");
      if (!result.ok) {
        sendResponse(result);
        return;
      }
      const db = await PersonalDB.load();
      sendResponse({
        ok: true,
        text: db.toDisplayText(),
        unlocked: true,
        hasPrivate: db.hasPrivateEntries(),
      });
      return;
    }

    case "SETUP_PDB_PASSWORD": {
      const setup = await setupPassword(msg.password || "");
      if (!setup.ok) {
        sendResponse(setup);
        return;
      }
      const db = await PersonalDB.load();
      db.updateFromText(msg.text || "");
      try {
        await db.save();
        sendResponse({
          ok: true,
          text: db.toDisplayText(),
          unlocked: true,
          hasPrivate: db.hasPrivateEntries(),
        });
      } catch (e) {
        lock();
        sendResponse({ ok: false, error: String(e.message || e) });
      }
      return;
    }

    case "LOCK_PDB": {
      lock();
      const db = await PersonalDB.load();
      sendResponse({
        ok: true,
        text: db.toDisplayText(),
        unlocked: false,
        hasPrivate: db.hasPrivateEntries(),
      });
      return;
    }

    case "PDB_AUTH_STATE": {
      const db = await PersonalDB.load();
      sendResponse({
        ok: true,
        unlocked: isUnlocked(),
        hasPrivate: db.hasPrivateEntries(),
      });
      return;
    }

    case "PREVIEW_STEP": {
      const [indent, slop] = getSlop(msg.line || "");
      if (slop === "" || indent === 0) {
        sendResponse({ ok: true, skipped: true });
        return;
      }
      const cmd = parseLine(slop, indent);
      const db = await PersonalDB.load();
      const resolved = await resolveCommand(cmd, db);
      const ready = await ensureContentReady(msg.tabId);
      if (!ready) {
        sendResponse({ ok: false, error: "Page not accessible." });
        return;
      }
      const res = await chrome.tabs.sendMessage(msg.tabId, {
        type: "PREVIEW",
        command: plainCommand(resolved),
      });
      sendResponse(res || { ok: false });
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
      const initialStack = tab.url ? { entries: [tab.url], index: 0 } : emptyNavStack();
      await setSession({
        recording: true,
        recordingTabIds: [tabId],
        primaryTabId: tabId,
        lastTransition: null,
        navStacks: { [tabId]: initialStack },
      });
      if (tab.url && /^https?:\/\//i.test(tab.url)) {
        notifyPanel({ type: "APPEND_STEP", step: `go to "${tab.url}"` });
      }
      const ready = await ensureContentReady(tabId);
      if (ready) {
        const db = await PersonalDB.load();
        chrome.tabs.sendMessage(tabId, {
          type: "START_REC",
          pdbEntries: pdbEntriesForRecording(db),
        }).catch(() => {});
      }
      notifyPanel({ type: "STATE", recording: true });
      sendResponse({ ok: ready, error: ready ? undefined : "Can't record on this page." });
      return;
    }

    case "STOP_RECORDING": {
      const s = await getSession();
      for (const tabId of s.recordingTabIds || []) {
        chrome.tabs.sendMessage(tabId, { type: "STOP_REC" }).catch(() => {});
      }
      await setSession({ recording: false, recordingTabIds: [], primaryTabId: null, navStacks: {} });
      liveSession = null;
      notifyPanel({ type: "STATE", recording: false });
      sendResponse({ ok: true });
      return;
    }

    case "RUN_SCRIPT": {
      sendResponse({ ok: true });
      runScript(msg.script || "", msg.tabId, msg.startLine || 0);
      return;
    }

    case "RUN_STEP": {
      const db = await PersonalDB.load();
      const [indent, slop] = getSlop(msg.line || "");
      if (slop === "" || indent === 0) {
        sendResponse({ ok: true, skipped: true });
        return;
      }
      const cmd = parseLine(slop, indent);
      cmd.lineNumber = msg.lineNumber;
      notifyPanel({ type: "RUN_PROGRESS", lineNumber: msg.lineNumber, status: "running", text: cmd.describe() });
      const res = await runOne(cmd, msg.tabId, db);
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
      if (runState.userResolve) runState.userResolve();
      if (runState.errorResolve) runState.errorResolve("stop");
      sendResponse({ ok: true });
      return;
    }

    case "CONTINUE_USER": {
      if (runState.userResolve) runState.userResolve();
      sendResponse({ ok: true });
      return;
    }

    case "ERROR_DECISION": {
      if (runState.errorResolve) runState.errorResolve(msg.decision);
      sendResponse({ ok: true });
      return;
    }

    case "START_EXTRACT_MODE": {
      let tabId = msg.tabId;
      if (!tabId) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = tab?.id;
      }
      if (!tabId) {
        sendResponse({ ok: false, error: "No active tab." });
        return;
      }
      const ready = await ensureContentReady(tabId);
      if (!ready) {
        sendResponse({ ok: false, error: "Page not accessible." });
        return;
      }
      const res = await chrome.tabs.sendMessage(tabId, { type: "START_EXTRACT_MODE" });
      sendResponse(res || { ok: false });
      return;
    }

    case "EXTRACT_RESULT": {
      notifyPanel({
        type: "EXTRACT_RESULT",
        scraped: msg.scraped,
        columns: msg.columns,
        tableXPath: msg.tableXPath,
        sourceUrl: msg.sourceUrl,
      });
      sendResponse({ ok: true });
      return;
    }

    case "EXTRACT_CANCELLED": {
      notifyPanel({ type: "EXTRACT_CANCELLED" });
      sendResponse({ ok: true });
      return;
    }

    default:
      sendResponse({ ok: false, error: "Unknown message: " + msg.type });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender, sendResponse);
  return true;
});

chrome.webNavigation.onCommitted.addListener((d) => {
  handleRecordedNavigation(d).catch(() => {});
});

chrome.webNavigation.onHistoryStateUpdated.addListener((d) => {
  handleRecordedNavigation(d).catch(() => {});
});

chrome.webNavigation.onCompleted.addListener(async (d) => {
  if (d.frameId !== 0) return;
  const s = await resolveRecordingSession(d.tabId);
  if (s) await armRecordingTab(d.tabId);
});

function tabOpenedByRecordedTab(tab, recordingTabIds) {
  const openerId = tab.openerTabId;
  return openerId != null && openerId !== -1 && recordingTabIds.includes(openerId);
}

// Was this activation caused by a tab being opened/closed rather than the
// user deliberately switching tabs?
function isAutomaticActivation(tabId) {
  const meta = tabMeta.get(tabId);
  const now = Date.now();
  if (meta && now - meta.createdAt < 2500) return true;
  if (now - lastTabRemovedAt < 1200) return true;
  return false;
}

chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.id != null) {
    tabMeta.set(tab.id, { createdAt: Date.now(), openerTabId: tab.openerTabId });
  }

  // During playback, follow tabs opened from the run tab (link clicks that
  // spawn a new tab), just like recording folds them into the click step.
  if (runState.running && tab.openerTabId != null && tab.openerTabId === runState.tabId) {
    runState.pendingNewTabId = tab.id;
  }

  if (!liveSession?.recording && !(await getSession()).recording) return;
  if (tab.id != null) trackRecordingTab(tab.id);

  const s = await getSession();
  if (!s.recording) return;
  const ids = [...new Set([...(s.recordingTabIds || []), tab.id].filter(Boolean))];
  await setSession({ ...s, recordingTabIds: ids });
  if (!tabOpenedByRecordedTab(tab, s.recordingTabIds || [])) {
    notifyPanel({ type: "APPEND_STEP", step: "create a new tab" });
  }
  if (tab.id) await armRecordingTab(tab.id);
});

chrome.tabs.onActivated.addListener(async (info) => {
  const s = await resolveRecordingSession(info.tabId);
  if (!s) return;
  try {
    const tab = await chrome.tabs.get(info.tabId);
    if (tab.title && !isAutomaticActivation(info.tabId)) {
      notifyPanel({ type: "APPEND_STEP", step: `switch to the "${tab.title}" tab` });
    }
    await armRecordingTab(info.tabId);
  } catch (e) { /* tab may be gone */ }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  tabMeta.delete(tabId);
  lastTabRemovedAt = Date.now();
  const s = await getSession();
  if (!s.recording) return;
  if (s.recordingTabIds.includes(tabId)) {
    notifyPanel({ type: "APPEND_STEP", step: `close the tab` });
    const ids = s.recordingTabIds.filter((id) => id !== tabId);
    await setSession({
      ...s,
      recordingTabIds: ids,
      recording: ids.length > 0,
      primaryTabId: ids[0] || null,
    });
    if (ids.length === 0) notifyPanel({ type: "STATE", recording: false });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
