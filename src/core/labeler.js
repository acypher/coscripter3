// Labeler: maps between DOM elements and the natural-language labels used in
// scripts. Two directions:
//   describeForRecording(target) -> a Command-shaped description of a user action
//   findElement(command)         -> the best-matching live element for a step
//
// This is the modern counterpart of the original coscripter-labeler.js +
// coscripter-dom-utils.js. It is deliberately heuristic: web pages are messy,
// so we rank candidates rather than demand an exact match.

import { ACTIONS, TYPES } from "./commands.js";

const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "number",
  "password",
  "",
]);

function norm(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function lower(s) {
  return norm(s).toLowerCase();
}

function isVisible(el) {
  if (!el || !(el instanceof Element)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = el.ownerDocument.defaultView.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (parseFloat(style.opacity) === 0) return false;
  return true;
}

// The visible text most users would associate with a control.
function associatedLabelText(el) {
  // <label for="id">
  if (el.id) {
    const lbl = el.ownerDocument.querySelector(`label[for="${cssEscape(el.id)}"]`);
    if (lbl) return norm(lbl.textContent);
  }
  // wrapping <label>
  const wrapping = el.closest("label");
  if (wrapping) {
    // Use only the label's own text, not the control's value.
    const clone = wrapping.cloneNode(true);
    clone.querySelectorAll("input, select, textarea, button").forEach((n) => n.remove());
    const t = norm(clone.textContent);
    if (t) return t;
  }
  // aria-labelledby
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id))
      .filter(Boolean)
      .map((n) => norm(n.textContent));
    if (parts.length) return parts.join(" ");
  }
  return "";
}

function cssEscape(value) {
  if (window.CSS && CSS.escape) return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

// All strings a control might be addressed by, best first.
function candidateLabels(el) {
  const labels = [];
  const push = (s) => {
    const n = norm(s);
    if (n) labels.push(n);
  };

  const tag = el.tagName.toLowerCase();
  push(associatedLabelText(el));
  push(el.getAttribute("aria-label"));

  if (tag === "input" || tag === "textarea" || tag === "select") {
    push(el.getAttribute("placeholder"));
    push(el.getAttribute("title"));
    push(el.getAttribute("name"));
    push(el.getAttribute("id"));
    if (tag === "input" && (el.type === "submit" || el.type === "button" || el.type === "reset")) {
      push(el.value);
    }
  } else {
    // buttons, links, etc.
    push(el.textContent);
    push(el.getAttribute("title"));
    push(el.value);
    push(el.getAttribute("name"));
    push(el.getAttribute("id"));
  }
  return labels;
}

// 0..1 similarity between a wanted label and a candidate string.
function matchScore(wanted, candidate) {
  const w = lower(wanted);
  const c = lower(candidate);
  if (!w || !c) return 0;
  if (w === c) return 1;
  if (c.startsWith(w) || w.startsWith(c)) return 0.85;
  if (c.includes(w) || w.includes(c)) return 0.7;
  // token overlap
  const wt = new Set(w.split(" "));
  const ct = new Set(c.split(" "));
  let common = 0;
  wt.forEach((t) => {
    if (ct.has(t)) common++;
  });
  if (common === 0) return 0;
  return 0.4 * (common / Math.max(wt.size, ct.size));
}

function bestLabelScore(el, wanted) {
  let best = 0;
  for (const cand of candidateLabels(el)) {
    best = Math.max(best, matchScore(wanted, cand));
    if (best === 1) break;
  }
  return best;
}

// Collect candidate elements for a given target type.
function candidatesForType(type, doc) {
  switch (type) {
    case TYPES.BUTTON:
      return doc.querySelectorAll(
        'button, input[type="submit"], input[type="button"], input[type="reset"], [role="button"]'
      );
    case TYPES.LINK:
      return doc.querySelectorAll('a[href], [role="link"]');
    case TYPES.TEXTBOX:
      return doc.querySelectorAll(
        'input:not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="hidden"]), textarea, [contenteditable=""], [contenteditable="true"]'
      );
    case TYPES.LISTBOX:
      return doc.querySelectorAll("select");
    case TYPES.CHECKBOX:
      return doc.querySelectorAll('input[type="checkbox"]');
    case TYPES.RADIO:
      return doc.querySelectorAll('input[type="radio"]');
    default:
      return doc.querySelectorAll(
        "button, a[href], input, textarea, select, [role], [contenteditable]"
      );
  }
}

// Find the live element that best matches a command. Returns the element or null.
export function findElement(command, doc = document) {
  const type = command.type || TYPES.BUTTON;
  const wanted = command.label || command.value || "";
  const candidates = Array.from(candidatesForType(type, doc));

  let best = null;
  let bestScore = 0;
  for (const el of candidates) {
    if (!isVisible(el)) continue;
    const score = bestLabelScore(el, wanted);
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }

  // Require a minimum confidence so we don't click a random element.
  if (best && bestScore >= 0.4) return best;
  return null;
}

// --- Recording direction -------------------------------------------------

function inputType(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea") return TYPES.TEXTBOX;
  if (tag === "select") return TYPES.LISTBOX;
  if (el.isContentEditable) return TYPES.TEXTBOX;
  if (tag === "input") {
    const t = (el.type || "text").toLowerCase();
    if (t === "checkbox") return TYPES.CHECKBOX;
    if (t === "radio") return TYPES.RADIO;
    if (t === "submit" || t === "button" || t === "reset") return TYPES.BUTTON;
    if (TEXT_INPUT_TYPES.has(t)) return TYPES.TEXTBOX;
  }
  return null;
}

// The label string we will write into a recorded step for this element.
export function labelFor(el) {
  const cands = candidateLabels(el);
  return cands[0] || "";
}

// Given a click target, return {action, type, label} or null if not actionable.
export function describeClickTarget(target) {
  const el = target.closest(
    'button, a[href], input[type="submit"], input[type="button"], input[type="reset"], input[type="checkbox"], input[type="radio"], [role="button"], [role="link"]'
  );
  if (!el) return null;
  const tag = el.tagName.toLowerCase();
  let type = TYPES.BUTTON;
  if (tag === "a" || el.getAttribute("role") === "link") type = TYPES.LINK;
  else if (tag === "input") {
    const t = (el.type || "").toLowerCase();
    if (t === "checkbox") type = TYPES.CHECKBOX;
    else if (t === "radio") type = TYPES.RADIO;
  }
  return { action: ACTIONS.CLICK, type, label: labelFor(el), element: el };
}

// Given a changed form control, return {action, type, label, value} or null.
export function describeChangeTarget(target) {
  const type = inputType(target);
  if (!type) return null;
  if (type === TYPES.CHECKBOX || type === TYPES.RADIO) {
    return { action: ACTIONS.CLICK, type, label: labelFor(target), element: target };
  }
  if (type === TYPES.LISTBOX) {
    const selected = target.options[target.selectedIndex];
    const value = selected ? norm(selected.textContent) || selected.value : target.value;
    return { action: ACTIONS.SELECT, type, label: labelFor(target), value, element: target };
  }
  // textbox
  const value = target.isContentEditable ? norm(target.textContent) : target.value;
  return { action: ACTIONS.ENTER, type: TYPES.TEXTBOX, label: labelFor(target), value, element: target };
}

export { isVisible };
