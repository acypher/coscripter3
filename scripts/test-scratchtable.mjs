// Node tests for the ScratchTable data model and persistence.
// Run: node scripts/test-scratchtable.mjs

import {
  ScratchTable,
  listTables,
  getTable,
  getTableByName,
  saveTable,
  deleteTable,
  setScratchTableStorage,
} from "../src/core/scratchtable.js";

let failed = 0;
function check(desc, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log("ok:", desc);
  } else {
    console.error(`FAIL: ${desc}\n  expected ${e}\n  got      ${a}`);
    failed++;
  }
}

function checkTrue(desc, actual) {
  check(desc, !!actual, true);
}

// In-memory storage for persistence tests.
const mem = new Map();
setScratchTableStorage({
  async get(key) {
    return mem.get(key);
  },
  async set(key, value) {
    mem.set(key, value);
  },
});

// --- defaults ---
{
  const t = ScratchTable.create("Homes");
  check("create name", t.name, "Homes");
  check("default columns", t.columns, ["A", "B"]);
  check("default row count", t.getRowCount(), 3);
  check("default col count", t.getColumnCount(), 2);
  check("empty cell text", t.getCellText(0, 0), "");
}

// --- cells with link URL ---
{
  const t = ScratchTable.create("Links", { columns: ["Title", "URL"], rowCount: 1 });
  t.setCell(0, 0, "Walk Score", "https://walkscore.com");
  check("cell text", t.getCellText(0, 0), "Walk Score");
  check("cell url", t.getCellUrl(0, 0), "https://walkscore.com");
  check("cell object", t.getCell(0, 0), { text: "Walk Score", url: "https://walkscore.com" });
}

// --- add/delete column and row ---
{
  const t = ScratchTable.create("T", { columns: ["A"], rowCount: 1 });
  const colIdx = t.addColumn("Score");
  check("addColumn index", colIdx, 1);
  check("addColumn name", t.getColumnName(1), "Score");
  check("addColumn pads rows", t.getCellText(0, 1), "");

  const rowIdx = t.addRow();
  check("addRow index", rowIdx, 1);
  check("addRow size", t.getRowCount(), 2);

  t.setCellText(1, 1, "85");
  check("setCellText", t.getCellText(1, 1), "85");

  checkTrue("deleteRow", t.deleteRow(0));
  check("after deleteRow", t.getRowCount(), 1);
  check("surviving cell", t.getCellText(0, 1), "85");

  checkTrue("deleteColumn", t.deleteColumn(0));
  check("after deleteColumn cols", t.getColumnCount(), 1);
  check("after deleteColumn name", t.getColumnName(0), "Score");
  check("refuse delete last column", t.deleteColumn(0), false);
}

// --- findColumn ---
{
  const t = ScratchTable.create("T", { columns: ["Address", "Walk Score"], rowCount: 0 });
  check("find exact", t.findColumn("Address"), 0);
  check("find case insensitive", t.findColumn("walk score"), 1);
  check("find missing", t.findColumn("Nope"), -1);
}

// --- ensureSize ---
{
  const t = ScratchTable.create("T", { columns: ["A"], rowCount: 1 });
  t.ensureSize(4, 3);
  check("ensureSize cols", t.getColumnCount(), 3);
  check("ensureSize rows", t.getRowCount(), 4);
}

// --- matrix import/export (original CoScripter shape) ---
{
  const t = ScratchTable.create("T", { columns: ["X"], rowCount: 0 });
  t.loadFromMatrix(
    [["City", "Score"], ["San Jose", "72"], ["Palo Alto", "89"]],
    [["", ""], ["", "https://example.com/sj"], ["", ""]]
  );
  check("matrix columns", t.columns, ["City", "Score"]);
  check("matrix rows", t.getRowCount(), 2);
  check("matrix cell", t.getCellText(0, 0), "San Jose");
  check("matrix meta url", t.getCellUrl(0, 1), "https://example.com/sj");
  check("toDataMatrix", t.toDataMatrix(), [
    ["City", "Score"],
    ["San Jose", "72"],
    ["Palo Alto", "89"],
  ]);
  check("toMetaMatrix", t.toMetaMatrix(), [
    ["", ""],
    ["", "https://example.com/sj"],
    ["", ""],
  ]);
}

// --- JSON round-trip ---
{
  const t = ScratchTable.create("Round", { columns: ["A", "B"], rowCount: 1 });
  t.setCell(0, 1, "hi", "https://x.test");
  const again = ScratchTable.fromJSON(t.toJSON());
  check("json name", again.name, "Round");
  check("json cell", again.getCell(0, 1), { text: "hi", url: "https://x.test" });
}

// --- persistence ---
{
  mem.clear();
  const t = ScratchTable.create("Persisted", { columns: ["Name"], rowCount: 1 });
  t.setCellText(0, 0, "Allen");
  const saved = await saveTable(t);
  checkTrue("save returns id", !!saved.id);
  checkTrue("save sets updated", saved.updated > 0);

  const listed = await listTables();
  check("list length", listed.length, 1);
  check("list name", listed[0].name, "Persisted");

  const byId = await getTable(saved.id);
  check("get by id", byId.getCellText(0, 0), "Allen");

  const byName = await getTableByName("persisted");
  check("get by name", byName.id, saved.id);

  await deleteTable(saved.id);
  check("after delete", (await listTables()).length, 0);
  check("get deleted", await getTable(saved.id), null);
}

// --- update existing ---
{
  mem.clear();
  const t = ScratchTable.create("UpdateMe", { columns: ["A"], rowCount: 1 });
  const saved = await saveTable(t);
  saved.setCellText(0, 0, "v2");
  await saveTable(saved);
  check("update in place", (await listTables()).length, 1);
  check("updated value", (await getTable(saved.id)).getCellText(0, 0), "v2");
}

// --- resolveCellRef / ensureCellRef (Phase 6d) ---
{
  const t = ScratchTable.create("Homes", { columns: ["Address", "Score"], rowCount: 2 });
  t.setCellText(0, 0, "San Jose");
  t.setCell(0, 1, "72", "https://example.com/sj");
  t.setCellText(1, 0, "Palo Alto");
  t.setCellText(1, 1, "89");

  check("resolve by label+row", t.resolveCellRef({
    columnLabel: "Address", columnNumber: 0, rowNumber: 1, rowLabel: "", tableName: "",
  }), { row: 0, col: 0 });

  check("resolve by numbers", t.resolveCellRef({
    columnLabel: "", columnNumber: 2, rowNumber: 2, rowLabel: "", tableName: "",
  }), { row: 1, col: 1 });

  check("resolve by row label", t.resolveCellRef({
    columnLabel: "Score", columnNumber: 0, rowNumber: 0, rowLabel: "Palo Alto", tableName: "",
  }), { row: 1, col: 1 });

  check("resolve missing", t.resolveCellRef({
    columnLabel: "Nope", columnNumber: 0, rowNumber: 1, rowLabel: "", tableName: "",
  }), null);

  const grown = ScratchTable.create("G", { columns: ["A"], rowCount: 1 });
  const pos = grown.ensureCellRef({
    columnLabel: "Walk Score", columnNumber: 0, rowNumber: 3, rowLabel: "", tableName: "",
  });
  check("ensure grows", { row: pos.row, col: pos.col, cols: grown.getColumnCount(), rows: grown.getRowCount() }, {
    row: 2, col: 1, cols: 2, rows: 3,
  });
}

process.exit(failed ? 1 : 0);
