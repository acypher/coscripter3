// Page-table extraction helpers (Phase 6f / 6g).
// Pure DOM utilities used by the content script; no Chrome APIs.
//
// Interactive flow (6f): user clicks first-row cells → column XPaths saved on
// the scratchtable → guess sibling rows → fill the table.
// Replay (6g): re-run extractWithColumns using the saved recipe.

function isVisible(el) {
  if (!(el instanceof Element)) return false;
  const style = el.ownerDocument.defaultView.getComputedStyle(el);
  if (!style || style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function cellText(cell) {
  return (cell.textContent || "").replace(/\s+/g, " ").trim();
}

function cellUrl(cell, baseUri) {
  const a =
    (cell.nodeName === "A" && cell.hasAttribute("href") ? cell : null) ||
    cell.closest?.("a[href]") ||
    cell.querySelector?.("a[href]");
  if (!a) return "";
  try {
    return new URL(a.getAttribute("href"), baseUri || cell.ownerDocument.baseURI).href;
  } catch (e) {
    return a.getAttribute("href") || "";
  }
}

/** Absolute XPath for an element (id-shortcut when present). */
export function xpathFor(el) {
  if (!el || el.nodeType !== 1) return "";
  if (el.id) return `//*[@id="${String(el.id).replace(/"/g, '\\"')}"]`;
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && node !== node.ownerDocument.documentElement) {
    let ix = 1;
    let sib = node.previousElementSibling;
    while (sib) {
      if (sib.tagName === node.tagName) ix++;
      sib = sib.previousElementSibling;
    }
    parts.unshift(`${node.tagName.toLowerCase()}[${ix}]`);
    node = node.parentElement;
  }
  return "/" + parts.join("/");
}

export function evaluateXPath(xpath, doc = document) {
  if (!xpath) return null;
  try {
    const r = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    const node = r.singleNodeValue;
    return node instanceof Element ? node : null;
  } catch (e) {
    return null;
  }
}

/**
 * Scrape an HTML <table> into { headers, rows, urls, tableXPath }.
 * Header row = first row if it contains <th>, else synthetic Col 1..N.
 */
export function scrapeHtmlTable(tableEl) {
  if (!tableEl || tableEl.tagName !== "TABLE") return null;
  const base = tableEl.ownerDocument.baseURI;
  const trs = Array.from(tableEl.querySelectorAll("tr")).filter((tr) => {
    return Array.from(tr.children).some((c) => /^(TD|TH)$/i.test(c.tagName));
  });
  if (!trs.length) return null;

  const firstCells = Array.from(trs[0].querySelectorAll("th,td"));
  const hasHeader = firstCells.some((c) => c.tagName === "TH");
  let headers;
  let dataRows;
  if (hasHeader) {
    headers = firstCells.map((c, i) => cellText(c) || `Col ${i + 1}`);
    dataRows = trs.slice(1);
  } else {
    const width = Math.max(...trs.map((tr) => tr.querySelectorAll("th,td").length), 1);
    headers = Array.from({ length: width }, (_, i) => `Col ${i + 1}`);
    dataRows = trs;
  }

  const width = headers.length;
  const rows = [];
  const urls = [];
  for (const tr of dataRows) {
    const cells = Array.from(tr.querySelectorAll("th,td"));
    if (!cells.length) continue;
    const row = [];
    const urlRow = [];
    for (let c = 0; c < width; c++) {
      const cell = cells[c];
      row.push(cell ? cellText(cell) : "");
      urlRow.push(cell ? cellUrl(cell, base) : "");
    }
    if (row.every((t) => !t)) continue;
    rows.push(row);
    urls.push(urlRow);
  }

  return {
    headers,
    rows,
    urls,
    tableXPath: xpathFor(tableEl),
  };
}

/** Pick the largest visible table on the page (by cell count). */
export function findBestTable(doc = document) {
  const tables = Array.from(doc.querySelectorAll("table")).filter(isVisible);
  let best = null;
  let bestScore = 0;
  for (const t of tables) {
    const cells = t.querySelectorAll("td,th").length;
    if (cells > bestScore) {
      bestScore = cells;
      best = t;
    }
  }
  return best;
}

export function scrapeBestTable(doc = document) {
  const t = findBestTable(doc);
  return t ? scrapeHtmlTable(t) : null;
}

export function scrapeTableByXPath(xpath, doc = document) {
  if (!xpath) return scrapeBestTable(doc);
  const node = evaluateXPath(xpath, doc);
  if (node && node.tagName === "TABLE") return scrapeHtmlTable(node);
  return scrapeBestTable(doc);
}

/** Find the nearest ancestor <table> from a click target. */
export function tableFromEventTarget(target) {
  if (!(target instanceof Element)) return null;
  return target.closest("table");
}

function lowestCommonAncestor(elements) {
  if (!elements.length) return null;
  let node = elements[0];
  while (node && node.nodeType === 1) {
    if (elements.every((el) => node.contains(el))) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Guess data rows from prototype column elements (original Vegemite heuristic).
 * Returns { headers, rows, urls, columns: [{xpath, label}] }.
 */
export function extractWithColumns(columnEls, doc = document) {
  const els = (columnEls || []).filter((el) => el instanceof Element);
  if (!els.length) return null;

  const columns = els.map((el) => ({
    xpath: xpathFor(el),
    label: cellText(el) || "",
  }));

  // Prefer a containing HTML table when every cell lives in one.
  const tables = els.map((el) => el.closest("table"));
  if (tables.every((t) => t) && tables.every((t) => t === tables[0])) {
    const scraped = scrapeHtmlTable(tables[0]);
    if (scraped) {
      // Prefer labels from the clicked prototype cells when they look like headers.
      const labels = columns.map((c, i) => c.label || scraped.headers[i] || `Col ${i + 1}`);
      return {
        ...scraped,
        headers: labels.slice(0, scraped.headers.length).concat(
          scraped.headers.slice(labels.length)
        ),
        columns,
      };
    }
  }

  const common = lowestCommonAncestor(els);
  if (!common) return null;

  // Walk up looking for a parent whose same-named siblings also contain
  // matches for each column's relative XPath snippet.
  let bestParent = null;
  let bestCount = 0;
  let bestSnippets = null;
  let matchParent = common;

  while (matchParent && matchParent !== doc.documentElement) {
    const parentXpath = xpathFor(matchParent);
    const lastBracket = parentXpath.lastIndexOf("[");
    if (lastBracket < 0) break;
    const parentXpathNoIndex = parentXpath.slice(0, lastBracket + 1);
    const index = parseInt(parentXpath.slice(lastBracket + 1, -1), 10) || 1;
    const snippets = columns.map((c) =>
      c.xpath.startsWith(parentXpath) ? c.xpath.slice(parentXpath.length) : null
    );
    if (snippets.some((s) => s == null)) {
      matchParent = matchParent.parentElement;
      continue;
    }

    let count = 0;
    const parentOf = matchParent.parentElement;
    if (!parentOf) break;
    let nodeCount = 0;
    for (const child of parentOf.children) {
      if (child.nodeName !== matchParent.nodeName) continue;
      nodeCount++;
      if (nodeCount < index || child === matchParent) continue;
      const prefix = parentXpathNoIndex + nodeCount + "]";
      for (const snip of snippets) {
        if (evaluateXPath(prefix + snip, doc)) count++;
      }
    }
    if (count > bestCount) {
      bestCount = count;
      bestParent = matchParent;
      bestSnippets = snippets;
    }
    matchParent = matchParent.parentElement;
  }

  const headers = columns.map((c, i) => c.label || `Col ${i + 1}`);
  const rows = [];
  const urls = [];
  const base = doc.baseURI;

  // Prototype row first.
  rows.push(els.map((el) => cellText(el)));
  urls.push(els.map((el) => cellUrl(el, base)));

  if (bestParent && bestSnippets && bestCount > 0) {
    const parentXpath = xpathFor(bestParent);
    const lastBracket = parentXpath.lastIndexOf("[");
    const parentXpathNoIndex = parentXpath.slice(0, lastBracket + 1);
    const index = parseInt(parentXpath.slice(lastBracket + 1, -1), 10) || 1;
    const parentOf = bestParent.parentElement;
    let nodeCount = 0;
    for (const child of parentOf.children) {
      if (child.nodeName !== bestParent.nodeName) continue;
      nodeCount++;
      if (nodeCount < index || child === bestParent) continue;
      const prefix = parentXpathNoIndex + nodeCount + "]";
      const row = [];
      const urlRow = [];
      let any = false;
      for (const snip of bestSnippets) {
        const match = evaluateXPath(prefix + snip, doc);
        row.push(match ? cellText(match) : "");
        urlRow.push(match ? cellUrl(match, base) : "");
        if (match) any = true;
      }
      if (any && !row.every((t) => !t)) {
        rows.push(row);
        urls.push(urlRow);
      }
    }
  }

  return { headers, rows, urls, columns };
}

/**
 * Replay a saved extraction recipe on the current document.
 * recipe: { columns?: [{xpath,label}], tableXPath?: string }
 */
export function extractFromRecipe(recipe, doc = document) {
  if (!recipe) return scrapeBestTable(doc);

  if (Array.isArray(recipe.columns) && recipe.columns.length) {
    const els = recipe.columns
      .map((c) => evaluateXPath(c.xpath, doc))
      .filter(Boolean);
    if (els.length === recipe.columns.length) {
      const scraped = extractWithColumns(els, doc);
      if (scraped) {
        // Restore saved labels when present.
        scraped.headers = recipe.columns.map(
          (c, i) => c.label || scraped.headers[i] || `Col ${i + 1}`
        );
        return scraped;
      }
    }
  }

  if (recipe.tableXPath) {
    return scrapeTableByXPath(recipe.tableXPath, doc);
  }
  return scrapeBestTable(doc);
}
