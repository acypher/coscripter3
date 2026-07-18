// Labeler: maps between DOM elements and natural-language labels.
// Supports ordinals, name filters, and spatial heuristics.

import { ACTIONS, TYPES, NAME_FILTERS } from "./commands.js";

const TEXT_INPUT_TYPES = new Set([
  "text", "search", "email", "url", "tel", "number", "password", "",
]);

function norm(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function lower(s) {
  return norm(s).toLowerCase();
}

function isDisplayed(el) {
  if (!el || !(el instanceof Element)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = el.ownerDocument.defaultView.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return true;
}

// MUI/Ant-style switches keep the native input at opacity:0 while the
// surrounding checkbox chrome stays clickable. Treat those inputs as visible
// when a nearby ancestor still paints on screen.
function toggleChromeVisible(el) {
  let n = el.parentElement;
  for (let i = 0; i < 5 && n; i++) {
    if (isDisplayed(n)) {
      const style = n.ownerDocument.defaultView.getComputedStyle(n);
      if (parseFloat(style.opacity) > 0) return true;
    }
    n = n.parentElement;
  }
  return false;
}

export function isVisible(el) {
  if (!el || !(el instanceof Element)) return false;
  const style = el.ownerDocument.defaultView.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  const hasBox = !(rect.width === 0 && rect.height === 0);
  const opaque = parseFloat(style.opacity) > 0;
  if (hasBox && opaque) return true;
  // Native checkbox/radio may be opacity:0 or zero-sized under visible chrome.
  return isToggleControl(el) && toggleChromeVisible(el);
}

function cssEscape(value) {
  if (window.CSS && CSS.escape) return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function associatedLabelText(el) {
  if (el.id) {
    const lbl = el.ownerDocument.querySelector(`label[for="${cssEscape(el.id)}"]`);
    if (lbl) return norm(lbl.textContent);
  }
  const wrapping = el.closest("label");
  if (wrapping) {
    const clone = wrapping.cloneNode(true);
    clone.querySelectorAll("input, select, textarea, button").forEach((n) => n.remove());
    const t = norm(clone.textContent);
    if (t) return t;
  }
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

function parseDocumentTitle(doc) {
  if (!doc) return "";
  const t = norm(doc.title).replace(/\s*[-–—|]\s*YouTube\s*$/i, "");
  if (t && !/^youtube$/i.test(t)) return t;
  return "";
}

function isGenericMediaLabel(s) {
  const l = lower(s);
  return !l || l === "video" || l.includes("video player") || l === "youtube";
}

function watchHeadingTitle(doc) {
  if (!doc) return "";
  const selectors = [
    "h1.ytd-watch-metadata yt-formatted-string",
    "h1.title yt-formatted-string",
    "#title h1 yt-formatted-string",
    "#title h1",
    "h1.title",
    ".ytp-title-text",
    ".ytp-title-link",
  ];
  for (const sel of selectors) {
    const nodes = doc.querySelectorAll(sel);
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const t = norm(el.textContent);
      if (t && t.length <= 120 && !isGenericMediaLabel(t)) return t;
    }
  }
  return "";
}

function pageMediaTitle(doc) {
  return parseDocumentTitle(doc) || watchHeadingTitle(doc);
}

export function mediaLabelFor(el, recentVideoLabel = "") {
  const labels = [];
  const push = (s) => {
    const n = norm(s);
    if (n && !isGenericMediaLabel(n)) labels.push(n);
  };
  push(associatedLabelText(el));
  push(el.getAttribute("aria-label"));
  push(el.getAttribute("title"));
  push(recentVideoLabel);
  push(parseDocumentTitle(el.ownerDocument));
  push(watchHeadingTitle(el.ownerDocument));
  return labels[0] || "video";
}

export function isMediaElement(el) {
  if (!el || !(el instanceof Element)) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "video") return true;
  if (el.id === "movie_player") return true;
  if (el.classList?.contains("html5-video-player")) return true;
  if (el.classList?.contains("html5-video-container")) return true;
  return false;
}

function descendantImageAlts(el) {
  const alts = [];
  for (const img of el.querySelectorAll("img[alt]")) {
    const alt = norm(img.getAttribute("alt"));
    if (alt) alts.push(alt);
  }
  return alts;
}

const ITEM_CONTAINER_SEL =
  "yt-lockup-view-model, ytd-playlist-video-renderer, ytd-compact-video-renderer, ytd-video-renderer, ytd-grid-video-renderer, [class*='lockup-view'], [class*='LockupView']";

function isDurationOnly(s) {
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(norm(s));
}

function isMeaningfulLinkText(s) {
  const t = norm(s);
  return t.length > 0 && /[a-z]/i.test(t) && !isDurationOnly(t);
}

// Nearest list/card row that wraps a video thumbnail + title pair.
function itemContainer(el) {
  const hit = el.closest(ITEM_CONTAINER_SEL);
  if (hit) return hit;
  let n = el.parentElement;
  for (let i = 0; i < 6 && n; i++) {
    const hasWatch = n.querySelector("a[href*='watch'], a[href*='/watch']");
    const hasTitle = n.querySelector("h3, h4, #video-title");
    if (hasWatch && hasTitle) return n;
    n = n.parentElement;
  }
  return null;
}

function stripYouTubeDurationSuffix(s) {
  return norm(s).replace(/\s+\d+\s+(?:minutes?,?\s*)?(?:\d+\s*)?(?:seconds?|secs?).*$/i, "");
}

function extractNowPlayingTitle(text) {
  const t = norm(text);
  const m = t.match(/now playing\s+(.+)$/i);
  if (!m) return "";
  let rest = m[1].replace(/^(\d+\s+)?(\d{1,2}:\d{2}\s*)+/i, "");
  const authorMatch = rest.match(/^(.+?\d(?:min|sec)?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)$/);
  if (authorMatch) return norm(authorMatch[1]);
  return norm(rest);
}

// Normalize link text / aria-label to a short human title (YouTube playlist rows,
// sidebar "Now playing …", duration suffixes on aria-label, etc.).
function cleanLinkLabel(text, aria) {
  const candidates = [];
  const push = (s) => {
    const n = norm(s);
    if (n && isMeaningfulLinkText(n)) candidates.push(n);
  };
  if (isMeaningfulLinkText(text)) push(text);
  if (aria) push(stripYouTubeDurationSuffix(aria));
  push(extractNowPlayingTitle(text));
  push(extractNowPlayingTitle(aria || ""));
  if (!candidates.length) {
    const fallback = norm(text) || stripYouTubeDurationSuffix(aria || "");
    return fallback;
  }
  candidates.sort((a, b) => a.length - b.length);
  return candidates[0];
}

function titleFromItem(item) {
  if (!item) return "";
  const selectors = [
    "a.ytLockupMetadataViewModelTitle",
    "#video-title a[href]",
    "#video-title",
    "h3 a[href*='watch'], h4 a[href*='watch']",
    "h3, h4",
  ];
  for (const sel of selectors) {
    for (const node of item.querySelectorAll(sel)) {
      const label = cleanLinkLabel(node.textContent, node.getAttribute?.("aria-label") || "");
      if (isMeaningfulLinkText(label)) return label;
    }
  }
  for (const a of item.querySelectorAll("a[href*='watch'], a[href*='/watch']")) {
    const label = cleanLinkLabel(a.textContent, a.getAttribute("aria-label") || "");
    if (isMeaningfulLinkText(label)) return label;
  }
  return "";
}

const TITLE_SELECTOR =
  "h1, h2, h3, h4, h5, h6, [id*='title'], [id*='Title'], [class*='title'], [class*='Title'], #video-title";

function rectDistance(ra, rb) {
  const dx = Math.max(0, Math.max(ra.left - rb.right, rb.left - ra.right));
  const dy = Math.max(0, Math.max(ra.top - rb.bottom, rb.top - ra.bottom));
  return dx + dy;
}

// Of the title-ish elements in `scope`, return the text of the one
// geometrically closest to `el` (list items place titles beside/below their
// thumbnails). Returns "" when the closest title is too far to belong to el.
function closestTitleIn(scope, el, maxDist = 300) {
  const rect = el.getBoundingClientRect();
  let best = "";
  let bestDist = Infinity;
  for (const h of scope.querySelectorAll(TITLE_SELECTOR)) {
    if (el.contains(h) || h.contains(el)) continue;
    const t = norm(h.textContent);
    if (!t || t.length > 120) continue;
    const d = rectDistance(rect, h.getBoundingClientRect());
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return bestDist <= maxDist ? best : "";
}

// Label a text-less link (e.g. a thumbnail) from its list item's title.
// Prefer the title link inside the same lockup/list row; fall back to the
// closest title element by geometry within tight ancestor bounds.
function linkContainerLabel(el) {
  const item = itemContainer(el);
  if (item) {
    const title = titleFromItem(item);
    if (title) return title;
  }
  let container = el.parentElement;
  for (let depth = 0; depth < 6 && container; depth++) {
    const t = closestTitleIn(container, el, 200);
    if (t) return t;
    container = container.parentElement;
  }
  const prev = el.previousElementSibling;
  if (prev) {
    const t = norm(prev.textContent);
    if (t && t.length <= 120) return t;
  }
  return "";
}

function spatialLabel(el) {
  const rect = el.getBoundingClientRect();
  const doc = el.ownerDocument;
  const labels = doc.querySelectorAll("label, span, div, td, th, p, legend");
  let best = "";
  let bestDist = Infinity;
  for (const lbl of labels) {
    if (lbl.contains(el) || el.contains(lbl)) continue;
    const t = norm(lbl.textContent);
    if (!t || t.length > 80) continue;
    const lr = lbl.getBoundingClientRect();
    const dx = Math.max(0, Math.max(rect.left - lr.right, lr.left - rect.right));
    const dy = Math.max(0, Math.max(rect.top - lr.bottom, lr.top - rect.bottom));
    const dist = dx + dy * 2;
    if (dist < bestDist && dist < 120) {
      bestDist = dist;
      best = t;
    }
  }
  return best;
}

// Generic aria-labels on MUI/Ant-style checkboxes ("Select", "Toggle", …)
// are not useful recorded labels — prefer nearby row text instead.
function isGenericControlLabel(s) {
  const l = lower(s);
  if (!l) return true;
  return /^(select|selected|checkbox|check ?box|radio|toggle|switch|on|off|checked|unchecked|true|false|input|button|option|item)$/i.test(l);
}

function isToggleControl(el) {
  if (!el || !(el instanceof Element)) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input") {
    const t = (el.type || "").toLowerCase();
    return t === "checkbox" || t === "radio";
  }
  const role = (el.getAttribute("role") || "").toLowerCase();
  return role === "checkbox" || role === "radio" || role === "switch";
}

// List-row checkboxes (e.g. MUI ListItem + Checkbox) often put the human
// name in a sibling ListItemText while the input only has a technical id.
function controlRowLabel(el) {
  const row = el.closest(
    'li, [role="listitem"], [id$="-row-item"], [id$="-row"], [class*="ListItem"], [class*="listItem"], [class*="list-item"]'
  );
  if (!row) return "";
  const primarySelectors = [
    ".MuiListItemText-primary",
    "[class*='ListItemText-primary']",
    "[id$='-name-text']",
    "[class*='listItemText']",
    "[class*='ListItemText']",
  ];
  for (const sel of primarySelectors) {
    for (const node of row.querySelectorAll(sel)) {
      if (node.contains(el)) continue;
      const t = norm(node.textContent);
      if (t && t.length <= 80 && !isGenericControlLabel(t)) return t;
    }
  }
  const clone = row.cloneNode(true);
  clone
    .querySelectorAll(
      "input, button, select, textarea, svg, [role='checkbox'], [role='radio'], [role='switch'], [class*='Checkbox'], [class*='collapseIcon'], [class*='CollapseIcon']"
    )
    .forEach((n) => n.remove());
  const t = norm(clone.textContent);
  if (t && t.length <= 80 && !isGenericControlLabel(t)) return t;
  return "";
}

function candidateLabels(el) {
  const labels = [];
  const push = (s) => {
    const n = norm(s);
    if (n) labels.push(n);
  };
  const pushAria = (s) => {
    if (!isGenericControlLabel(s)) push(s);
  };
  const tag = el.tagName.toLowerCase();
  push(associatedLabelText(el));
  if (tag === "a" || el.getAttribute("role") === "link") {
    const text = norm(el.textContent);
    const aria = el.getAttribute("aria-label") || "";
    const clean = cleanLinkLabel(text, aria);
    if (isMeaningfulLinkText(clean)) {
      push(clean);
    } else {
      push(linkContainerLabel(el));
      push(clean);
      push(text);
    }
    push(stripYouTubeDurationSuffix(aria));
    for (const alt of descendantImageAlts(el)) push(alt);
    push(el.getAttribute("title"));
    if (!isMeaningfulLinkText(clean) && !isMeaningfulLinkText(text)) {
      push(spatialLabel(el));
    }
    push(el.value);
    push(el.getAttribute("name"));
    push(el.getAttribute("id"));
    return labels;
  }
  if (isToggleControl(el)) {
    // Prefer human-visible row / nearby text over aria="Select" or technical ids.
    push(controlRowLabel(el));
    push(spatialLabel(el));
    pushAria(el.getAttribute("aria-label"));
    const wrap = el.closest("[aria-label]");
    if (wrap && wrap !== el) pushAria(wrap.getAttribute("aria-label"));
    push(el.getAttribute("title"));
    push(el.getAttribute("name"));
    push(el.getAttribute("id"));
    return labels;
  }
  push(el.getAttribute("aria-label"));
  if (tag === "input" || tag === "textarea" || tag === "select") {
    push(el.getAttribute("placeholder"));
    push(el.getAttribute("title"));
    push(el.getAttribute("name"));
    push(el.getAttribute("id"));
    push(spatialLabel(el));
    if (tag === "input" && (el.type === "submit" || el.type === "button" || el.type === "reset")) {
      push(el.value);
    }
  } else if (isMediaElement(el)) {
    for (const label of [
      associatedLabelText(el),
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      parseDocumentTitle(el.ownerDocument),
      watchHeadingTitle(el.ownerDocument),
    ]) {
      push(label);
    }
    push("video");
  } else {
    push(el.textContent);
    push(el.getAttribute("title"));
    push(el.value);
    push(el.getAttribute("name"));
    push(el.getAttribute("id"));
  }
  return labels;
}

function matchScore(wanted, candidate) {
  const w = lower(wanted);
  const c = lower(candidate);
  if (!w || !c) return 0;
  if (w === c) return 1;
  if (c.startsWith(w) || w.startsWith(c)) return 0.85;
  if (c.includes(w) || w.includes(c)) return 0.7;
  const wt = new Set(w.split(" "));
  const ct = new Set(c.split(" "));
  let common = 0;
  wt.forEach((t) => { if (ct.has(t)) common++; });
  if (common === 0) return 0;
  return 0.4 * (common / Math.max(wt.size, ct.size));
}

function passesNameFilter(label, filter) {
  if (!filter) return true;
  const l = lower(label);
  const v = lower(filter.value);
  switch (filter.type) {
    case NAME_FILTERS.STARTS_WITH: return l.startsWith(v);
    case NAME_FILTERS.CONTAINS: return l.includes(v);
    case NAME_FILTERS.ENDS_WITH: return l.endsWith(v);
    default: return true;
  }
}

function bestLabelScore(el, wanted, nameFilter) {
  let best = 0;
  for (const cand of candidateLabels(el)) {
    if (!passesNameFilter(cand, nameFilter)) continue;
    best = Math.max(best, matchScore(wanted, cand));
    if (best === 1) break;
  }
  return best;
}

function candidatesForType(type, doc) {
  switch (type) {
    case TYPES.BUTTON:
      return doc.querySelectorAll(
        'button, input[type="submit"], input[type="button"], input[type="reset"], [role="button"], summary, video, #movie_player, .html5-video-player, .html5-video-container'
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
      return doc.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
    case TYPES.RADIO:
      return doc.querySelectorAll('input[type="radio"], [role="radio"]');
    case TYPES.TAB:
      return doc.querySelectorAll('[role="tab"], [role="tablist"] > *, .tab, [data-tab], [aria-selected]');
    case TYPES.SECTION:
      return doc.querySelectorAll("details, [aria-expanded], .accordion, [data-toggle], [role='region']");
    case TYPES.MENU:
      return doc.querySelectorAll('[role="menu"], [role="menubar"], menu, nav[aria-label], .menu');
    case TYPES.MENU_ITEM:
      return doc.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], a[role="menuitem"], li[role="menuitem"]');
    case TYPES.ITEM:
      return doc.querySelectorAll("li, [role='listitem'], [role='option']");
    default:
      return doc.querySelectorAll(
        "button, a[href], input, textarea, select, [role], [contenteditable], details, summary"
      );
  }
}

function rankCandidates(command, doc) {
  const type = command.type || TYPES.BUTTON;
  const wanted = command.label || command.value || "";
  const candidates = Array.from(candidatesForType(type, doc));
  const scored = [];
  for (const el of candidates) {
    if (!isVisible(el)) continue;
    let score;
    if (!wanted) {
      // No label ("click the third link"): every visible candidate of the
      // right type matches, subject to the name filter.
      score = command.nameFilter
        ? (candidateLabels(el).some((c) => passesNameFilter(c, command.nameFilter)) ? 0.5 : 0)
        : 0.5;
    } else {
      score = bestLabelScore(el, wanted, command.nameFilter);
    }
    if (score >= 0.4) scored.push({ el, score });
  }
  // Stable sort: ties keep document order.
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function findByXPath(xpath, doc) {
  if (!xpath) return null;
  try {
    const result = doc.evaluate(
      xpath,
      doc,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    const node = result.singleNodeValue;
    return node instanceof Element ? node : null;
  } catch (e) {
    return null;
  }
}

export function findElement(command, doc = document) {
  if (command.xpath) {
    return findByXPath(command.xpath, doc);
  }
  const scored = rankCandidates(command, doc);
  if (!scored.length) return null;
  if (command.ordinal && command.ordinal > 0) {
    // Ordinals count matches in document order, not score order.
    const els = scored
      .map((s) => s.el)
      .sort((a, b) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      );
    return els[command.ordinal - 1] || null;
  }
  return scored[0].el;
}

export function elementExists(command, doc = document) {
  return !!findElement(command, doc);
}

export function findElementInFrames(command, rootDoc = document) {
  if (command.xpath) {
    const direct = findByXPath(command.xpath, rootDoc);
    if (direct) return direct;
    const iframes = rootDoc.querySelectorAll("iframe, frame");
    for (const frame of iframes) {
      try {
        const fdoc = frame.contentDocument;
        if (!fdoc) continue;
        const found = findByXPath(command.xpath, fdoc);
        if (found) return found;
      } catch (e) {
        /* cross-origin */
      }
    }
    return null;
  }
  const el = findElement(command, rootDoc);
  if (el) return el;
  const iframes = rootDoc.querySelectorAll("iframe, frame");
  for (const frame of iframes) {
    try {
      const fdoc = frame.contentDocument;
      if (!fdoc) continue;
      const found = findElementInFrames(command, fdoc);
      if (found) return found;
    } catch (e) {
      /* cross-origin */
    }
  }
  return null;
}

export function readElementValue(command, doc = document) {
  const el = findElementInFrames(command, doc);
  if (!el) return null;
  if (el.isContentEditable) return (el.textContent || "").trim();
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return (el.value || "").trim();
  return (el.textContent || "").trim();
}

export function previewElement(command, doc = document) {
  const el = findElementInFrames(command, doc);
  if (!el) return false;
  try {
    el.scrollIntoView({ block: "center", inline: "center" });
    el.classList.add("__coscripter_preview__");
    // Match editor preview style (light-blue solid). Cleared by clearPreview / timeout.
    setTimeout(() => el.classList.remove("__coscripter_preview__"), 1200);
  } catch (e) { /* ignore */ }
  return true;
}

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

export function labelFor(el) {
  return candidateLabels(el)[0] || "";
}

function linkDescQuality(desc) {
  const label = desc.label || "";
  if (!isMeaningfulLinkText(label)) return 1;
  if (/now playing/i.test(label)) return 3;
  if (label.length > 80) return 4;
  const el = desc.element;
  if (el?.matches?.("a.ytLockupMetadataViewModelTitle, h3 a[href], h4 a[href], #video-title a")) {
    return 10;
  }
  return 8;
}

export function describeClickTarget(target, recentVideoLabel = "") {
  if (!target || !(target instanceof Element)) return null;
  let el = target.closest(
    'button, a[href], input[type="submit"], input[type="button"], input[type="reset"], input[type="checkbox"], input[type="radio"], [role="button"], [role="link"], summary, details, video, #movie_player, .html5-video-player, .html5-video-container'
  );
  if (!el) {
    const item = itemContainer(target);
    if (item?.contains(target)) {
      el = item.querySelector(
        "a.ytLockupMetadataViewModelTitle, h3 a[href], h4 a[href], #video-title a"
      );
    }
  }
  if (!el && /^H[1-6]$/.test(target.tagName)) {
    el = target.querySelector("a[href]");
  }
  if (!el) return null;
  const parentLink = el.closest("a[href]");
  if (parentLink && parentLink !== el && !labelFor(el) && labelFor(parentLink)) {
    el = parentLink;
  }
  const tag = el.tagName.toLowerCase();
  let type = TYPES.BUTTON;
  if (tag === "a" || el.getAttribute("role") === "link") type = TYPES.LINK;
  else if (tag === "input") {
    const t = (el.type || "").toLowerCase();
    if (t === "checkbox") type = TYPES.CHECKBOX;
    else if (t === "radio") type = TYPES.RADIO;
  } else if (tag === "details" || tag === "summary") type = TYPES.SECTION;
  else if (isMediaElement(el)) type = TYPES.BUTTON;
  const label = isMediaElement(el) ? mediaLabelFor(el, recentVideoLabel) : labelFor(el);
  return { action: ACTIONS.CLICK, type, label, element: el };
}

export function clickTargetFromEvent(event, recentVideoLabel = "") {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
  const linkCandidates = [];
  let mediaDesc = null;
  for (let i = 0; i < path.length; i++) {
    const node = path[i];
    if (!(node instanceof Element)) continue;
    const desc = describeClickTarget(node, recentVideoLabel);
    if (!desc) continue;
    if (desc.type === TYPES.LINK && desc.label) {
      linkCandidates.push({ desc, index: i, quality: linkDescQuality(desc) });
      continue;
    }
    if (desc.label && !isMediaElement(desc.element)) return desc;
    if (isMediaElement(desc.element) && !mediaDesc) mediaDesc = desc;
  }
  if (linkCandidates.length) {
    linkCandidates.sort((a, b) => b.quality - a.quality || a.index - b.index);
    return linkCandidates[0].desc;
  }
  return mediaDesc;
}

export function describeChangeTarget(target) {
  const type = inputType(target);
  if (!type) return null;
  if (type === TYPES.CHECKBOX) {
    const checked = target.checked;
    return {
      action: checked ? ACTIONS.TURN_ON : ACTIONS.TURN_OFF,
      type,
      label: labelFor(target),
      element: target,
    };
  }
  if (type === TYPES.RADIO) {
    return {
      action: target.checked ? ACTIONS.TURN_ON : ACTIONS.TURN_OFF,
      type,
      label: labelFor(target),
      element: target,
    };
  }
  if (type === TYPES.LISTBOX) {
    const selected = target.options[target.selectedIndex];
    const value = selected ? norm(selected.textContent) || selected.value : target.value;
    return { action: ACTIONS.SELECT, type, label: labelFor(target), value, element: target };
  }
  const value = target.isContentEditable ? norm(target.textContent) : target.value;
  return { action: ACTIONS.ENTER, type: TYPES.TEXTBOX, label: labelFor(target), value, element: target };
}

export function isPasswordField(el) {
  return el && el.tagName === "INPUT" && (el.type || "").toLowerCase() === "password";
}
