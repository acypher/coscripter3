// Interactive data-extraction mode for the content page (Phase 6f).
// User clicks first-row cells to define columns, then Enter/Done extracts.

import {
  extractWithColumns,
  scrapeHtmlTable,
  tableFromEventTarget,
  xpathFor,
} from "./extraction.js";

const HIGHLIGHT = "outline: 2px solid #c9a227 !important; outline-offset: 1px !important; background: rgba(249,255,179,0.45) !important;";
const HOVER = "outline: 2px dashed #5b8def !important; outline-offset: 1px !important;";

/**
 * @param {{ onDone: (result: object) => void, onCancel: () => void }} callbacks
 */
export function startExtractMode(callbacks) {
  stopExtractMode();

  const state = {
    columns: [], // Element[]
    hoverEl: null,
    banner: null,
    onDone: callbacks.onDone,
    onCancel: callbacks.onCancel,
  };
  window.__coscripterExtract = state;

  const banner = document.createElement("div");
  banner.id = "coscripter-extract-banner";
  banner.setAttribute(
    "style",
    [
      "position:fixed",
      "top:0",
      "left:0",
      "right:0",
      "z-index:2147483646",
      "display:flex",
      "align-items:center",
      "gap:10px",
      "padding:8px 12px",
      "font:13px/1.3 system-ui,sans-serif",
      "background:#1a1a1a",
      "color:#f5f5f5",
      "box-shadow:0 2px 8px rgba(0,0,0,.35)",
    ].join(";")
  );
  banner.innerHTML =
    '<span style="flex:1">Extract: click cells in the first row to pick columns. ' +
    "Enter or Done to extract · Esc to cancel. Or click a whole table.</span>";
  const doneBtn = document.createElement("button");
  doneBtn.type = "button";
  doneBtn.textContent = "Done";
  doneBtn.setAttribute(
    "style",
    "cursor:pointer;border:0;border-radius:4px;padding:4px 10px;background:#c9a227;color:#111;font-weight:600"
  );
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.setAttribute(
    "style",
    "cursor:pointer;border:1px solid #666;border-radius:4px;padding:4px 10px;background:transparent;color:#f5f5f5"
  );
  banner.appendChild(doneBtn);
  banner.appendChild(cancelBtn);
  document.documentElement.appendChild(banner);
  state.banner = banner;

  function paintPermanent(el) {
    if (!el || el.dataset.csExtractPainted) return;
    el.dataset.csExtractPainted = "1";
    el.dataset.csExtractPrevStyle = el.getAttribute("style") || "";
    el.setAttribute("style", (el.getAttribute("style") || "") + ";" + HIGHLIGHT);
  }

  function clearPermanent(el) {
    if (!el || !el.dataset.csExtractPainted) return;
    const prev = el.dataset.csExtractPrevStyle;
    if (prev) el.setAttribute("style", prev);
    else el.removeAttribute("style");
    delete el.dataset.csExtractPainted;
    delete el.dataset.csExtractPrevStyle;
  }

  function clearHover() {
    if (!state.hoverEl) return;
    if (!state.hoverEl.dataset.csExtractPainted) {
      const prev = state.hoverEl.dataset.csExtractHoverPrev;
      if (prev != null) {
        if (prev) state.hoverEl.setAttribute("style", prev);
        else state.hoverEl.removeAttribute("style");
        delete state.hoverEl.dataset.csExtractHoverPrev;
      }
    }
    state.hoverEl = null;
  }

  function setHover(el) {
    if (el === state.hoverEl) return;
    clearHover();
    if (!el || state.columns.includes(el) || el.closest?.("#coscripter-extract-banner")) return;
    state.hoverEl = el;
    if (!el.dataset.csExtractPainted) {
      el.dataset.csExtractHoverPrev = el.getAttribute("style") || "";
      el.setAttribute("style", (el.getAttribute("style") || "") + ";" + HOVER);
    }
  }

  function finish(scraped) {
    const columns = state.columns.map((el) => ({
      xpath: xpathFor(el),
      label: (el.textContent || "").replace(/\s+/g, " ").trim(),
    }));
    const table = state.columns[0]?.closest?.("table");
    const result = {
      scraped,
      columns: columns.length ? columns : scraped?.columns || [],
      tableXPath: scraped?.tableXPath || (table ? xpathFor(table) : ""),
      sourceUrl: location.href,
    };
    stopExtractMode();
    state.onDone?.(result);
  }

  function doExtract() {
    let scraped = null;
    if (state.columns.length) {
      scraped = extractWithColumns(state.columns, document);
    }
    if (!scraped || !scraped.rows?.length) {
      // Fallback: if user never clicked cells but we somehow got here empty
      callbacks.onCancel?.();
      stopExtractMode();
      return;
    }
    finish(scraped);
  }

  function onMove(e) {
    const el = e.target instanceof Element ? e.target : null;
    if (!el || el.closest("#coscripter-extract-banner")) {
      clearHover();
      return;
    }
    // Prefer cell / link under cursor for column picking.
    const cell = el.closest("td,th,a,span,div,li,p,h1,h2,h3,h4");
    setHover(cell || el);
  }

  function onClick(e) {
    if (e.target?.closest?.("#coscripter-extract-banner")) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    // Whole-table shortcut: click on table chrome (not a cell we're picking).
    // If user hasn't picked columns yet and clicks inside a table, scrape it.
    const table = tableFromEventTarget(target);
    if (table && state.columns.length === 0) {
      // If they clicked a cell, treat as first column instead of whole table —
      // unless they Alt-click the table (force whole-table scrape).
      const cell = target.closest("td,th");
      if (!cell || e.altKey) {
        const scraped = scrapeHtmlTable(table);
        if (scraped) {
          finish(scraped);
          return;
        }
      }
    }

    const el =
      target.closest("td,th,a") ||
      target.closest("span,div,li,p") ||
      target;
    if (!el || el.closest("#coscripter-extract-banner")) return;

    if (state.columns.includes(el)) return;
    state.columns.push(el);
    clearHover();
    paintPermanent(el);
    updateBanner();
  }

  function updateBanner() {
    const span = banner.querySelector("span");
    if (span) {
      span.textContent =
        `Extract: ${state.columns.length} column(s) selected. ` +
        "Click more cells, then Done/Enter. Esc cancels. Alt-click a table to scrape it whole.";
    }
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      stopExtractMode();
      state.onCancel?.();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (state.columns.length) doExtract();
    }
  }

  doneBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (state.columns.length) doExtract();
  });
  cancelBtn.addEventListener("click", (e) => {
    e.preventDefault();
    stopExtractMode();
    state.onCancel?.();
  });

  state.onMove = onMove;
  state.onClick = onClick;
  state.onKey = onKey;
  state.clearPermanent = clearPermanent;
  state.clearHover = clearHover;

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
}

export function stopExtractMode() {
  const state = window.__coscripterExtract;
  if (!state) return;
  document.removeEventListener("mousemove", state.onMove, true);
  document.removeEventListener("click", state.onClick, true);
  document.removeEventListener("keydown", state.onKey, true);
  state.clearHover?.();
  for (const el of state.columns || []) state.clearPermanent?.(el);
  state.banner?.remove();
  window.__coscripterExtract = null;
}

export function isExtractModeActive() {
  return !!window.__coscripterExtract;
}
