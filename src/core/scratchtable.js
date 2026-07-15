// Scratchtable data model (Phase 6a / Vegemite).
//
// Named spreadsheet tables stored in chrome.storage.local. Each cell holds
// plain text and an optional link URL (meta), matching the original CoScripter
// ScratchSpaceTable. Row/column indices are 0-based. The first conceptual
// "header" is the columns array; rows are data only.
//
// The ScratchTable class is pure (no Chrome APIs) so it can be unit-tested in
// Node. Persistence helpers use chrome.storage.local when available.

const STORAGE_KEY = "coscripter_scratchtables";

function uid() {
  return "t_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function norm(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function lower(s) {
  return norm(s).toLowerCase();
}

function emptyCell() {
  return { text: "", url: "" };
}

function normalizeCell(cell) {
  if (cell == null) return emptyCell();
  if (typeof cell === "string") return { text: cell, url: "" };
  return {
    text: cell.text != null ? String(cell.text) : "",
    url: cell.url != null ? String(cell.url) : "",
  };
}

/**
 * In-memory spreadsheet table.
 *
 * Serialized shape:
 * {
 *   id: string,
 *   name: string,
 *   columns: string[],
 *   rows: { text: string, url: string }[][],
 *   extraction: null | { sourceUrl, tableXPath?, columns?: [{xpath, label}] },
 *   updated: number
 * }
 */
export class ScratchTable {
  constructor({
    id = "",
    name = "Untitled",
    columns = null,
    rows = null,
    extraction = null,
    updated = 0,
  } = {}) {
    this.id = id || uid();
    this.name = name || "Untitled";
    this.columns = Array.isArray(columns) && columns.length
      ? columns.map((c) => String(c))
      : ["A", "B"];
    this.rows = [];
    this.extraction = extraction || null;
    this.updated = updated || 0;

    if (Array.isArray(rows) && rows.length) {
      for (const row of rows) {
        this.rows.push(this._normalizeRow(row));
      }
    } else {
      // Default: three empty data rows (matches original INITIAL_TABLE).
      for (let i = 0; i < 3; i++) this.addRow();
    }
  }

  static create(name, { columns, rowCount = 3 } = {}) {
    const table = new ScratchTable({
      name: name || "Untitled",
      columns: columns || ["A", "B"],
      rows: [],
    });
    table.rows = [];
    for (let i = 0; i < rowCount; i++) table.addRow();
    return table;
  }

  static fromJSON(data) {
    return new ScratchTable(data || {});
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      columns: this.columns.slice(),
      rows: this.rows.map((row) => row.map((c) => ({ text: c.text, url: c.url }))),
      extraction: this.extraction ? JSON.parse(JSON.stringify(this.extraction)) : null,
      updated: this.updated,
    };
  }

  getColumnCount() {
    return this.columns.length;
  }

  getRowCount() {
    return this.rows.length;
  }

  getColumnName(index) {
    return this.columns[index] ?? "";
  }

  setColumnName(index, name) {
    if (index < 0 || index >= this.columns.length) return false;
    this.columns[index] = String(name);
    return true;
  }

  /** Case-insensitive column lookup. Returns 0-based index or -1. */
  findColumn(name) {
    const wanted = lower(name);
    if (!wanted) return -1;
    for (let i = 0; i < this.columns.length; i++) {
      if (lower(this.columns[i]) === wanted) return i;
    }
    for (let i = 0; i < this.columns.length; i++) {
      const c = lower(this.columns[i]);
      if (c.startsWith(wanted) || wanted.startsWith(c) || c.includes(wanted)) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Find a data row by label. Prefers an exact match in column 0, then any
   * column. Returns 0-based row index or -1.
   */
  findRow(label) {
    const wanted = lower(label);
    if (!wanted) return -1;
    for (let r = 0; r < this.rows.length; r++) {
      if (lower(this.getCellText(r, 0)) === wanted) return r;
    }
    for (let r = 0; r < this.rows.length; r++) {
      for (let c = 0; c < this.columns.length; c++) {
        if (lower(this.getCellText(r, c)) === wanted) return r;
      }
    }
    return -1;
  }

  /**
   * Resolve a parsed cellRef to 0-based { row, col }.
   * Row/column numbers in cellRef are 1-based (ClearScript "row 2" → index 1).
   * Returns null if the cell cannot be found.
   */
  resolveCellRef(ref) {
    if (!ref) return null;
    let col = -1;
    if (ref.columnLabel) col = this.findColumn(ref.columnLabel);
    else if (ref.columnNumber > 0) col = ref.columnNumber - 1;

    let row = -1;
    if (ref.rowLabel) row = this.findRow(ref.rowLabel);
    else if (ref.rowNumber > 0) row = ref.rowNumber - 1;

    if (row < 0 || col < 0) return null;
    if (row >= this.rows.length || col >= this.columns.length) return null;
    return { row, col };
  }

  /** Ensure the cell exists (growing the table if needed), then return indices. */
  ensureCellRef(ref) {
    if (!ref) return null;
    let col = -1;
    if (ref.columnLabel) {
      col = this.findColumn(ref.columnLabel);
      if (col < 0) col = this.addColumn(ref.columnLabel);
    } else if (ref.columnNumber > 0) {
      this.ensureSize(this.rows.length, ref.columnNumber);
      col = ref.columnNumber - 1;
    }
    let row = -1;
    if (ref.rowLabel) {
      row = this.findRow(ref.rowLabel);
      if (row < 0) {
        row = this.addRow();
        if (this.columns.length) this.setCellText(row, 0, ref.rowLabel);
      }
    } else if (ref.rowNumber > 0) {
      this.ensureSize(ref.rowNumber, this.columns.length);
      row = ref.rowNumber - 1;
    }
    if (row < 0 || col < 0) return null;
    return { row, col };
  }

  getCell(rowIndex, columnIndex) {
    const cell = this.rows[rowIndex]?.[columnIndex];
    return cell ? { text: cell.text, url: cell.url } : emptyCell();
  }

  getCellText(rowIndex, columnIndex) {
    return this.getCell(rowIndex, columnIndex).text;
  }

  getCellUrl(rowIndex, columnIndex) {
    return this.getCell(rowIndex, columnIndex).url;
  }

  setCell(rowIndex, columnIndex, text, url) {
    if (!this._inBounds(rowIndex, columnIndex)) return false;
    const cell = this.rows[rowIndex][columnIndex];
    if (text !== undefined) cell.text = text == null ? "" : String(text);
    if (url !== undefined) cell.url = url == null ? "" : String(url);
    return true;
  }

  setCellText(rowIndex, columnIndex, text) {
    return this.setCell(rowIndex, columnIndex, text, undefined);
  }

  setCellUrl(rowIndex, columnIndex, url) {
    return this.setCell(rowIndex, columnIndex, undefined, url);
  }

  addColumn(columnName) {
    const name = columnName != null ? String(columnName) : String(this.columns.length);
    this.columns.push(name);
    for (const row of this.rows) row.push(emptyCell());
    return this.columns.length - 1;
  }

  addRow() {
    const row = [];
    for (let i = 0; i < this.columns.length; i++) row.push(emptyCell());
    this.rows.push(row);
    return this.rows.length - 1;
  }

  deleteColumn(index) {
    if (index < 0 || index >= this.columns.length) return false;
    if (this.columns.length <= 1) return false;
    this.columns.splice(index, 1);
    for (const row of this.rows) row.splice(index, 1);
    return true;
  }

  deleteRow(index) {
    if (index < 0 || index >= this.rows.length) return false;
    this.rows.splice(index, 1);
    return true;
  }

  /** Grow (never shrink) to at least `rowCount` × `columnCount`. */
  ensureSize(rowCount, columnCount) {
    while (this.columns.length < columnCount) this.addColumn();
    while (this.rows.length < rowCount) this.addRow();
  }

  /**
   * Replace all data from a header+rows matrix like the original:
   * data[0] = column names, data[1..] = cell strings.
   * Optional meta[1..][c] = URL strings.
   */
  loadFromMatrix(data, metaData = null) {
    if (!Array.isArray(data) || data.length === 0) return;
    const headers = data[0].map((h) => String(h ?? ""));
    this.columns = headers.length ? headers : ["A"];
    this.rows = [];
    for (let r = 1; r < data.length; r++) {
      const src = data[r] || [];
      const meta = metaData?.[r] || [];
      const row = [];
      for (let c = 0; c < this.columns.length; c++) {
        row.push({
          text: src[c] != null ? String(src[c]) : "",
          url: meta[c] != null ? String(meta[c]) : "",
        });
      }
      this.rows.push(row);
    }
  }

  /**
   * Load scraped page data ({ headers, rows, urls }) into this table.
   * When append is true, adds rows under the existing columns (padded/truncated).
   */
  loadFromScraped(scraped, { append = false } = {}) {
    if (!scraped || !Array.isArray(scraped.headers)) return false;
    const headers = scraped.headers.map((h) => String(h ?? ""));
    const dataRows = Array.isArray(scraped.rows) ? scraped.rows : [];
    const urlRows = Array.isArray(scraped.urls) ? scraped.urls : [];

    if (!append || this.getRowCount() === 0 || this._isBlank()) {
      const matrix = [headers.length ? headers : ["A"], ...dataRows];
      const meta = [
        (headers.length ? headers : ["A"]).map(() => ""),
        ...urlRows,
      ];
      this.loadFromMatrix(matrix, meta);
      return true;
    }

    for (let i = 0; i < dataRows.length; i++) {
      const src = dataRows[i] || [];
      const meta = urlRows[i] || [];
      const r = this.addRow();
      for (let c = 0; c < this.columns.length; c++) {
        this.setCell(
          r,
          c,
          src[c] != null ? String(src[c]) : "",
          meta[c] != null ? String(meta[c]) : ""
        );
      }
    }
    return true;
  }

  /** True when every cell is empty (initial blank table). */
  _isBlank() {
    return this.rows.every((row) => row.every((c) => !c.text && !c.url));
  }

  /** Export as [headers, ...stringRows] matching original ScratchSpaceTable.data. */
  toDataMatrix() {
    const matrix = [this.columns.slice()];
    for (const row of this.rows) {
      matrix.push(row.map((c) => c.text));
    }
    return matrix;
  }

  /** Export meta URLs as [emptyHeader, ...urlRows]. */
  toMetaMatrix() {
    const header = this.columns.map(() => "");
    const matrix = [header];
    for (const row of this.rows) {
      matrix.push(row.map((c) => c.url));
    }
    return matrix;
  }

  _inBounds(rowIndex, columnIndex) {
    return (
      rowIndex >= 0 &&
      rowIndex < this.rows.length &&
      columnIndex >= 0 &&
      columnIndex < this.columns.length
    );
  }

  _normalizeRow(row) {
    const out = [];
    for (let c = 0; c < this.columns.length; c++) {
      out.push(normalizeCell(row?.[c]));
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Persistence (chrome.storage.local). For Node tests, inject a Map store via
// setScratchTableStorage().
// ---------------------------------------------------------------------------

/** @type {{ get: Function, set: Function } | null} */
let storageOverride = null;

export function setScratchTableStorage(store) {
  storageOverride = store;
}

async function storageGet(key) {
  if (storageOverride) return storageOverride.get(key);
  const data = await chrome.storage.local.get(key);
  return data[key];
}

async function storageSet(key, value) {
  if (storageOverride) {
    await storageOverride.set(key, value);
    return;
  }
  await chrome.storage.local.set({ [key]: value });
}

async function readAll() {
  const list = (await storageGet(STORAGE_KEY)) || [];
  return Array.isArray(list) ? list : [];
}

async function writeAll(list) {
  await storageSet(STORAGE_KEY, list);
}

export async function listTables() {
  const list = await readAll();
  return list
    .map((t) => ScratchTable.fromJSON(t))
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

export async function getTable(id) {
  const list = await readAll();
  const found = list.find((t) => t.id === id);
  return found ? ScratchTable.fromJSON(found) : null;
}

export async function getTableByName(name) {
  const wanted = lower(name);
  if (!wanted) return null;
  const list = await readAll();
  let best = null;
  let bestScore = 0;
  for (const raw of list) {
    const n = lower(raw.name);
    let score = 0;
    if (n === wanted) score = 1;
    else if (n.startsWith(wanted) || wanted.startsWith(n)) score = 0.85;
    else if (n.includes(wanted) || wanted.includes(n)) score = 0.7;
    if (score > bestScore) {
      bestScore = score;
      best = raw;
    }
  }
  return bestScore >= 0.5 ? ScratchTable.fromJSON(best) : null;
}

/**
 * Load the table named in cellRef, or the most recently updated table when
 * the ref has no table name ("the scratchtable").
 */
export async function loadTableForRef(cellRef, preferredId = null) {
  if (cellRef?.tableName) {
    return getTableByName(cellRef.tableName);
  }
  if (preferredId) {
    const t = await getTable(preferredId);
    if (t) return t;
  }
  const list = await listTables();
  return list[0] || null;
}

/** Create or update. Returns the saved ScratchTable. */
export async function saveTable(table) {
  const list = await readAll();
  const json = table instanceof ScratchTable ? table.toJSON() : { ...table };
  json.updated = Date.now();
  if (!json.id) json.id = uid();
  const idx = list.findIndex((t) => t.id === json.id);
  if (idx >= 0) list[idx] = json;
  else list.push(json);
  await writeAll(list);
  return ScratchTable.fromJSON(json);
}

export async function deleteTable(id) {
  const list = await readAll();
  await writeAll(list.filter((t) => t.id !== id));
}
