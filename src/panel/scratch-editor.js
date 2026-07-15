// Scratchtable spreadsheet UI for the Tables side-panel tab (Phase 6b).

import {
  ScratchTable,
  listTables,
  getTable,
  saveTable,
  deleteTable,
} from "../core/scratchtable.js";

/**
 * @param {{ setStatus: (text: string, kind?: string) => void }} opts
 */
export function initScratchEditor({ setStatus }) {
  const tableName = document.getElementById("tableName");
  const tableList = document.getElementById("tableList");
  const tableCount = document.getElementById("tableCount");
  const scratchGrid = document.getElementById("scratchGrid");
  const newTableBtn = document.getElementById("newTableBtn");
  const saveTableBtn = document.getElementById("saveTableBtn");
  const deleteTableBtn = document.getElementById("deleteTableBtn");
  const addRowBtn = document.getElementById("addRowBtn");
  const addColBtn = document.getElementById("addColBtn");

  let current = ScratchTable.create("Untitled");
  let dirty = false;

  function markDirty() {
    dirty = true;
  }

  function loadIntoUi(table) {
    current = table;
    dirty = false;
    tableName.value = table.name || "";
    renderGrid();
  }

  function syncFromUi() {
    current.name = tableName.value.trim() || "Untitled";
    // Cell values are already written into `current` as the user edits.
  }

  function escapeAttr(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function renderGrid() {
    const cols = current.getColumnCount();
    const rows = current.getRowCount();

    let html = '<table class="cs-scratch-table"><thead><tr>';
    html += '<th class="cs-scratch-corner" title="Row #"></th>';
    for (let c = 0; c < cols; c++) {
      html += `<th><input class="cs-scratch-header" data-col="${c}" value="${escapeAttr(current.getColumnName(c))}" spellcheck="false" /></th>`;
    }
    html += '<th class="cs-scratch-actions-h"></th></tr></thead><tbody>';

    for (let r = 0; r < rows; r++) {
      html += `<tr><th class="cs-scratch-rownum">${r + 1}</th>`;
      for (let c = 0; c < cols; c++) {
        const cell = current.getCell(r, c);
        const hasUrl = !!cell.url;
        html += `<td class="${hasUrl ? "cs-scratch-has-url" : ""}">`;
        html += `<input class="cs-scratch-cell" data-row="${r}" data-col="${c}" value="${escapeAttr(cell.text)}" spellcheck="false" />`;
        html += `<input class="cs-scratch-url" data-row="${r}" data-col="${c}" value="${escapeAttr(cell.url)}" placeholder="link URL" spellcheck="false" title="Optional link URL" />`;
        html += "</td>";
      }
      html += `<td class="cs-scratch-row-actions"><button type="button" class="cs-scratch-del-row" data-row="${r}" title="Delete row">×</button></td>`;
      html += "</tr>";
    }
    html += "</tbody></table>";

    // Column delete buttons under headers (when >1 column)
    if (cols > 1) {
      html += '<div class="cs-scratch-col-actions">';
      html += '<span class="cs-scratch-col-spacer"></span>';
      for (let c = 0; c < cols; c++) {
        html += `<button type="button" class="cs-scratch-del-col" data-col="${c}" title="Delete column">× col</button>`;
      }
      html += "</div>";
    }

    scratchGrid.innerHTML = html;
  }

  async function refreshLibrary() {
    const tables = await listTables();
    tableCount.textContent = String(tables.length);
    tableList.innerHTML = "";
    if (tables.length === 0) {
      const li = document.createElement("li");
      li.className = "cs-empty";
      li.textContent = "No saved tables yet.";
      tableList.appendChild(li);
      return;
    }
    for (const t of tables) {
      const li = document.createElement("li");
      li.className = "cs-item" + (t.id === current.id ? " active" : "");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cs-item-btn";
      const nameSpan = document.createElement("span");
      nameSpan.className = "cs-item-name";
      nameSpan.textContent = t.name;
      const metaSpan = document.createElement("span");
      metaSpan.className = "cs-item-meta";
      const date = t.updated
        ? new Date(t.updated).toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : "";
      metaSpan.textContent = `${t.getRowCount()}×${t.getColumnCount()}${date ? " · " + date : ""}`;
      btn.appendChild(nameSpan);
      btn.appendChild(metaSpan);
      btn.addEventListener("click", async () => {
        if (dirty && !confirm("Discard unsaved changes to the current table?")) return;
        const loaded = await getTable(t.id);
        if (loaded) {
          loadIntoUi(loaded);
          await refreshLibrary();
          setStatus(`Opened table "${loaded.name}".`);
        }
      });
      li.appendChild(btn);
      tableList.appendChild(li);
    }
  }

  function doNew() {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    loadIntoUi(ScratchTable.create("Untitled"));
    tableName.focus();
    tableName.select();
    refreshLibrary();
    setStatus("New table.");
  }

  async function doSave() {
    syncFromUi();
    try {
      const saved = await saveTable(current);
      current = saved;
      dirty = false;
      tableName.value = saved.name;
      await refreshLibrary();
      setStatus(`Saved table "${saved.name}".`, "ok");
    } catch (e) {
      setStatus(String(e.message || e), "error");
    }
  }

  async function doDelete() {
    if (!current.id) {
      doNew();
      return;
    }
    const name = current.name || "this table";
    if (!confirm(`Delete table "${name}"?`)) return;
    await deleteTable(current.id);
    loadIntoUi(ScratchTable.create("Untitled"));
    await refreshLibrary();
    setStatus(`Deleted "${name}".`);
  }

  scratchGrid.addEventListener("input", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement)) return;
    if (el.classList.contains("cs-scratch-header")) {
      const c = parseInt(el.dataset.col, 10);
      current.setColumnName(c, el.value);
      markDirty();
      return;
    }
    if (el.classList.contains("cs-scratch-cell")) {
      const r = parseInt(el.dataset.row, 10);
      const c = parseInt(el.dataset.col, 10);
      current.setCellText(r, c, el.value);
      markDirty();
      return;
    }
    if (el.classList.contains("cs-scratch-url")) {
      const r = parseInt(el.dataset.row, 10);
      const c = parseInt(el.dataset.col, 10);
      current.setCellUrl(r, c, el.value);
      const td = el.closest("td");
      if (td) td.classList.toggle("cs-scratch-has-url", !!el.value.trim());
      markDirty();
    }
  });

  scratchGrid.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.classList.contains("cs-scratch-del-row")) {
      const r = parseInt(btn.dataset.row, 10);
      if (current.getRowCount() <= 1) {
        setStatus("Keep at least one row.", "error");
        return;
      }
      current.deleteRow(r);
      markDirty();
      renderGrid();
      return;
    }
    if (btn.classList.contains("cs-scratch-del-col")) {
      const c = parseInt(btn.dataset.col, 10);
      if (!current.deleteColumn(c)) {
        setStatus("Keep at least one column.", "error");
        return;
      }
      markDirty();
      renderGrid();
    }
  });

  scratchGrid.addEventListener("keydown", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement)) return;
    if (!el.classList.contains("cs-scratch-cell") && !el.classList.contains("cs-scratch-header")) {
      return;
    }
    if (e.key !== "Tab" && e.key !== "Enter") return;

    const isHeader = el.classList.contains("cs-scratch-header");
    const r = isHeader ? -1 : parseInt(el.dataset.row, 10);
    const c = parseInt(el.dataset.col, 10);
    const cols = current.getColumnCount();
    const rows = current.getRowCount();
    let nr = r;
    let nc = c;

    if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      if (isHeader) {
        nr = 0;
        nc = c;
      } else {
        nc = c + 1;
        if (nc >= cols) {
          nc = 0;
          nr = r + 1;
          if (nr >= rows) {
            current.addRow();
            markDirty();
            renderGrid();
            nr = rows;
          }
        }
      }
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      if (isHeader) return;
      nc = c - 1;
      if (nc < 0) {
        nc = cols - 1;
        nr = r - 1;
        if (nr < 0) {
          const header = scratchGrid.querySelector(`.cs-scratch-header[data-col="${c}"]`);
          header?.focus();
          header?.select();
          return;
        }
      }
    }

    const selector = nr < 0
      ? `.cs-scratch-header[data-col="${nc}"]`
      : `.cs-scratch-cell[data-row="${nr}"][data-col="${nc}"]`;
    const next = scratchGrid.querySelector(selector);
    if (next) {
      next.focus();
      next.select();
    }
  });

  tableName.addEventListener("input", markDirty);
  newTableBtn.addEventListener("click", doNew);
  saveTableBtn.addEventListener("click", doSave);
  deleteTableBtn.addEventListener("click", doDelete);
  addRowBtn.addEventListener("click", () => {
    current.addRow();
    markDirty();
    renderGrid();
  });
  addColBtn.addEventListener("click", () => {
    const n = current.getColumnCount();
    const letter = String.fromCharCode(65 + (n % 26));
    current.addColumn(n < 26 ? letter : `Col ${n + 1}`);
    markDirty();
    renderGrid();
  });

  return {
    async refresh() {
      await refreshLibrary();
      renderGrid();
    },
    async reloadIf(tableId) {
      if (!tableId || tableId !== current.id) {
        await refreshLibrary();
        return;
      }
      if (dirty) return; // don't clobber in-progress edits
      const loaded = await getTable(tableId);
      if (loaded) loadIntoUi(loaded);
      await refreshLibrary();
    },
    getCurrent() {
      return current;
    },
  };
}
