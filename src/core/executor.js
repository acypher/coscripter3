// Executor: runs a single command against the live page.

import { ACTIONS, TYPES } from "./commands.js";
import { findElementInFrames, elementExists } from "./labeler.js";

const HIGHLIGHT_CLASS = "__coscripter_highlight__";
let clipboardCache = "";

const PREVIEW_CLASS = "__coscripter_preview__";

function ensureHighlightStyle() {
  let style = document.getElementById("__coscripter_style__");
  if (!style) {
    style = document.createElement("style");
    style.id = "__coscripter_style__";
    (document.head || document.documentElement).appendChild(style);
  }
  style.textContent = `
    .${HIGHLIGHT_CLASS}{outline:3px solid #ff5a36 !important;outline-offset:2px !important;transition:outline 0.1s;}
    .${PREVIEW_CLASS}{outline:4px solid #169a5b !important;outline-offset:2px !important;}
  `;
}

export function clearPreview(doc = document) {
  try {
    doc.querySelectorAll(`.${PREVIEW_CLASS}`).forEach((el) => {
      el.classList.remove(PREVIEW_CLASS);
    });
  } catch (e) { /* ignore */ }
}

function flash(el) {
  try {
    ensureHighlightStyle();
    el.classList.add(HIGHLIGHT_CLASS);
    setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), 700);
  } catch (e) { /* ignore */ }
}

function fire(el, type) {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  if (desc && desc.set) desc.set.call(el, value);
  else el.value = value;
}

function getText(el) {
  if (el.isContentEditable) return (el.textContent || "").trim();
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return el.value || "";
  return (el.textContent || "").trim();
}

function mouseEvent(el, type, opts = {}) {
  const rect = el.getBoundingClientRect();
  const evt = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: el.ownerDocument.defaultView,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    ctrlKey: !!opts.ctrlKey,
    shiftKey: !!opts.shiftKey,
  });
  el.dispatchEvent(evt);
}

function doClick(el, opts = {}) {
  el.focus({ preventScroll: true });
  if (opts.ctrlKey) {
    mouseEvent(el, "mousedown", opts);
    mouseEvent(el, "mouseup", opts);
    mouseEvent(el, "click", opts);
  } else {
    el.click();
  }
}

function setChecked(el, checked) {
  if (el.checked === checked) return;
  el.click();
}

function selectOption(el, value) {
  const target = (value || "").trim().toLowerCase();
  for (const opt of el.options) {
    const text = (opt.textContent || "").trim().toLowerCase();
    const val = (opt.value || "").trim().toLowerCase();
    if (text === target || val === target) {
      el.value = opt.value;
      fire(el, "input");
      fire(el, "change");
      return true;
    }
  }
  for (const opt of el.options) {
    const text = (opt.textContent || "").trim().toLowerCase();
    if (text.includes(target)) {
      el.value = opt.value;
      fire(el, "input");
      fire(el, "change");
      return true;
    }
  }
  return false;
}

function toggleSection(el) {
  if (el.tagName === "DETAILS") {
    el.open = !el.open;
    return;
  }
  const expanded = el.getAttribute("aria-expanded");
  if (expanded !== null) {
    el.setAttribute("aria-expanded", expanded === "true" ? "false" : "true");
  }
  doClick(el);
}

function expandSection(el) {
  if (el.tagName === "DETAILS" && !el.open) el.open = true;
  else if (el.getAttribute("aria-expanded") === "false") doClick(el);
}

function collapseSection(el) {
  if (el.tagName === "DETAILS" && el.open) el.open = false;
  else if (el.getAttribute("aria-expanded") === "true") doClick(el);
}

async function copyToClipboard(text) {
  clipboardCache = text;
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) { /* fallback to cache */ }
}

async function readClipboard() {
  try {
    const t = await navigator.clipboard.readText();
    if (t) return t;
  } catch (e) { /* ignore */ }
  return clipboardCache;
}

export async function setClipboard(text) {
  await copyToClipboard(text ?? "");
}

export async function getClipboard() {
  return readClipboard();
}

function doDoubleClick(el) {
  el.focus({ preventScroll: true });
  mouseEvent(el, "mousedown");
  mouseEvent(el, "mouseup");
  mouseEvent(el, "click");
  mouseEvent(el, "mousedown");
  mouseEvent(el, "mouseup");
  mouseEvent(el, "click");
  mouseEvent(el, "dblclick");
}

export function compareValues(left, right, op) {
  const l = String(left ?? "").trim();
  const r = String(right ?? "").trim();
  const ln = parseFloat(l);
  const rn = parseFloat(r);
  const numeric = Number.isFinite(ln) && Number.isFinite(rn) && l !== "" && r !== "";
  switch (op) {
    case "equals":
      return numeric ? ln === rn : l.toLowerCase() === r.toLowerCase();
    case "contains":
      return l.toLowerCase().includes(r.toLowerCase());
    case "less":
      return numeric ? ln < rn : l < r;
    case "greater":
      return numeric ? ln > rn : l > r;
    default:
      return false;
  }
}

function hasTextSelection(doc = document) {
  const sel = doc.getSelection?.();
  return !!((sel?.toString?.() || "").trim());
}

export function checkCondition(command) {
  if (command.conditionSelection) {
    const has = hasTextSelection(document);
    return command.conditionPositive !== false ? has : !has;
  }

  if (command.conditionType === "comparison") {
    let result = compareValues(command.compareLeftValue, command.compareRightValue, command.compareOp);
    if (command.conditionPositive === false) result = !result;
    return result;
  }

  const probe = { ...command, action: ACTIONS.THERE_IS };
  const exists = elementExists(probe, document);
  return command.conditionPositive !== false ? exists : !exists;
}

export function preview(command) {
  ensureHighlightStyle();
  clearPreview(document);
  const el = findElementInFrames(command, document);
  if (!el) return { ok: true, found: false };
  try {
    el.scrollIntoView({ block: "center", inline: "nearest" });
    el.classList.add(PREVIEW_CLASS);
  } catch (e) { /* ignore */ }
  return { ok: true, found: true };
}

export async function execute(command) {
  if (command.action === ACTIONS.PAUSE) {
    await new Promise((r) => setTimeout(r, (command.seconds || 1) * 1000));
    return { ok: true };
  }

  if (command.action === ACTIONS.VERIFY) {
    const ok = checkCondition({ ...command, conditionType: command.conditionType || "existence" });
    if (!ok) {
      return { ok: false, error: `Verify failed: ${command.describe()}` };
    }
    return { ok: true };
  }

  if (command.action === ACTIONS.THERE_IS) {
    return { ok: checkCondition(command) };
  }

  if (command.action === ACTIONS.FIND) {
    const term = command.findTerm || "";
    const backwards = command.findDirection === "previous";
    const continueSearch = command.findDirection === "next" || command.findDirection === "previous";
    if (!term && !continueSearch) {
      return { ok: false, error: "No search term given." };
    }
    const found = window.find(
      term,
      false,
      backwards,
      true,
      false,
      true,
      false
    );
    return found
      ? { ok: true }
      : { ok: false, error: `Could not find "${term}".` };
  }

  const el = findElementInFrames(command, document);
  if (!el && command.needsPage !== false) {
    const needsEl = ![
      ACTIONS.PAUSE, ACTIONS.VERIFY, ACTIONS.THERE_IS,
    ].includes(command.action);
    if (needsEl) {
      return {
        ok: false,
        error: `Could not find ${command.type || "element"} "${command.label || command.value}".`,
      };
    }
  }

  if (el) {
    try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch (e) { /* ignore */ }
    // Drop any green match preview; do not flash red/orange on execute.
    clearPreview(document);
  }

  switch (command.action) {
    case ACTIONS.CLICK:
    case ACTIONS.CONTROL_CLICK:
      doClick(el, { ctrlKey: command.ctrlKey || command.action === ACTIONS.CONTROL_CLICK, shiftKey: command.shiftKey });
      return { ok: true };

    case ACTIONS.DOUBLE_CLICK:
      doDoubleClick(el);
      return { ok: true };

    case ACTIONS.MOUSEOVER:
      mouseEvent(el, "mouseover");
      mouseEvent(el, "mouseenter");
      return { ok: true };

    case ACTIONS.TURN_ON:
      if (command.type === TYPES.CHECKBOX || command.type === TYPES.RADIO) setChecked(el, true);
      else doClick(el);
      return { ok: true };

    case ACTIONS.TURN_OFF:
      if (command.type === TYPES.CHECKBOX || command.type === TYPES.RADIO) setChecked(el, false);
      else doClick(el);
      return { ok: true };

    case ACTIONS.TOGGLE:
      if (command.type === TYPES.SECTION) toggleSection(el);
      else if (command.type === TYPES.CHECKBOX || command.type === TYPES.RADIO) doClick(el);
      else doClick(el);
      return { ok: true };

    case ACTIONS.EXPAND:
      expandSection(el);
      return { ok: true };

    case ACTIONS.COLLAPSE:
      collapseSection(el);
      return { ok: true };

    case ACTIONS.ENTER:
    case ACTIONS.PUT:
      el.focus({ preventScroll: true });
      if (el.isContentEditable) el.textContent = command.value;
      else setNativeValue(el, command.value);
      fire(el, "input");
      fire(el, "change");
      return { ok: true };

    case ACTIONS.APPEND: {
      el.focus({ preventScroll: true });
      const existing = getText(el);
      const next = existing + command.value;
      if (el.isContentEditable) el.textContent = next;
      else setNativeValue(el, next);
      fire(el, "input");
      fire(el, "change");
      return { ok: true };
    }

    case ACTIONS.SELECT:
      if (!selectOption(el, command.value)) {
        return { ok: false, error: `No option "${command.value}" in list "${command.label}".` };
      }
      return { ok: true };

    case ACTIONS.COPY:
    case ACTIONS.CLIP: {
      const text = getText(el);
      await copyToClipboard(text);
      return { ok: true };
    }

    case ACTIONS.PASTE: {
      const contents = await readClipboard();
      el.focus({ preventScroll: true });
      if (el.isContentEditable) el.textContent = contents;
      else setNativeValue(el, contents);
      fire(el, "input");
      fire(el, "change");
      return { ok: true };
    }

    case ACTIONS.WAIT: {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (checkCondition(command)) return { ok: true };
        await new Promise((r) => setTimeout(r, 300));
      }
      return { ok: false, error: `Timed out waiting for ${command.label || command.condition?.raw || "condition"}.` };
    }

    default:
      return { ok: false, error: `Cannot execute "${command.action}" in the page.` };
  }
}
