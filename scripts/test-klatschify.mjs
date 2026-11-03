// Exercise the real background message handler and macro with in-memory
// extension APIs. No browser, account, publication or network is used.
// Run: node scripts/test-klatschify.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseLine, parseScript } from "../src/core/parser.js";
import { ACTIONS } from "../src/core/commands.js";
import { checkCondition } from "../src/core/executor.js";

const store = {};
const calls = [];
let listener;
let pageDetails = {
  title: "An example article", description: "A publisher's short description.",
  image: "https://example.org/lead.jpg", url: "https://example.org/story",
};
let pageError = "";
const event = () => ({ addListener() {}, removeListener() {} });
const storage = {
  async get(keys) {
    return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, store[key]]));
  },
  async set(data) { Object.assign(store, data); },
  async remove(key) { delete store[key]; },
};
globalThis.chrome = {
  storage: { local: storage, session: storage },
  runtime: {
    onMessage: { addListener(fn) { listener = fn; } },
    onInstalled: event(), onStartup: event(),
    async sendMessage() {},
  },
  webNavigation: { onCommitted: event(), onCompleted: event(), onHistoryStateUpdated: event() },
  tabs: {
    onCreated: event(), onActivated: event(), onRemoved: event(),
    async sendMessage(tabId, msg) {
      calls.push({ tabId, ...msg });
      if (msg.type === "PING") return { ok: true };
      if (msg.type === "READ_PAGE_DETAILS") return pageError
        ? { ok: false, error: pageError } : { ok: true, details: pageDetails };
      if (msg.type === "EXECUTE") return { ok: true };
      if (msg.type === "CHECK") return { ok: checkCondition(msg.command) };
      throw new Error(`Unexpected page message: ${msg.type}`);
    },
  },
  sidePanel: { async setPanelBehavior() {} },
};
await import("../background.js");
const request = (msg) => new Promise((resolve) => listener(msg, {}, resolve));
const step = (line, tabId = 7) => request({ type: "RUN_STEP", line: "* " + line, tabId });
const captureLine = 'capture the page details as "Klatsch"';

assert.equal((await step(captureLine)).ok, true);
assert.match(store.coscripter_personaldb, /Klatsch title = An example article/);
assert.match(store.coscripter_personaldb, /Klatsch url = https:\/\/example.org\/story/);
assert.equal(calls.find((call) => call.type === "READ_PAGE_DETAILS").tabId, 7);

// The new tab reads the captured source values, not its own title/URL.
const macro = await readFile(new URL("../examples/Klatschify.coscript", import.meta.url), "utf8");
const commands = parseScript(macro);
assert.equal(commands.some((command) => command.action === ACTIONS.UNKNOWN), false);
assert.equal(commands.filter((command) => command.action === ACTIONS.CAPTURE_PAGE).length, 1);
const formCommands = commands.filter((command) => [ACTIONS.ENTER, ACTIONS.TURN_ON, ACTIONS.TURN_OFF].includes(command.action));
for (const command of formCommands) {
  const result = await step(command.toSlop(), 8);
  assert.equal(result.ok, true, command.raw);
}
const executed = calls.filter((call) => call.type === "EXECUTE");
const byLabel = (label) => executed.find((call) => call.command.label === label)?.command;
assert.equal(byLabel("Enter article title").value, pageDetails.title);
assert.equal(byLabel("Write a short description of your article").value, pageDetails.description);
assert.equal(byLabel("Source URL").value, pageDetails.url);
assert.equal(byLabel("Article Image or Video").value, pageDetails.image);
assert.equal(byLabel("Author").value, "AC and Comet");
assert.equal(byLabel("Draft").action, ACTIONS.TURN_ON);
assert.equal(byLabel("Private").action, ACTIONS.TURN_OFF);
assert.equal(executed.every((call) => call.tabId === 8), true);
assert.equal(commands.filter((command) => command.action === ACTIONS.CLICK).length, 1);
assert.equal(commands.find((command) => command.action === ACTIONS.CLICK).label, "Save");
assert.equal(commands.at(-2).action, ACTIONS.WAIT);
assert.equal(commands.at(-2).label, "Edit");

// Optional fields must be overwritten with empty values on a subsequent run.
pageDetails = { title: "Next story", description: "", image: "", url: "https://example.org/next" };
assert.equal((await step(captureLine)).ok, true);
assert.match(store.coscripter_personaldb, /Klatsch image = \n/);
assert.equal((await step('enter your "Klatsch image" into the "Article Image or Video" textbox', 8)).ok, true);
assert.equal(calls.at(-1).command.value, "");
const blankDescription = commands.find((command) => command.action === ACTIONS.IF);
const branch = await step(blankDescription.toSlop(), 8);
assert.equal(branch.conditionResult, true);

// Failed capture must leave the existing snapshot intact.
const before = store.coscripter_personaldb;
pageError = "Page capture failed";
assert.equal((await step(captureLine)).ok, false);
assert.equal(store.coscripter_personaldb, before);
pageError = "";
pageDetails.url = "javascript:alert(1)";
assert.equal((await step(captureLine)).ok, false);
assert.equal(store.coscripter_personaldb, before);

// Prefixes cannot corrupt the line-based personal-data format.
pageDetails.url = "https://example.org/next";
assert.equal((await step('capture the page details as "bad=prefix"')).ok, false);
assert.equal((await step('capture the page details as "*private"')).ok, false);
assert.equal(store.coscripter_personaldb, before);

// A locked private key cannot be overwritten or changed to a public key.
store.coscripter_personaldb_crypto = {
  salt: "unused", secrets: [{ key: "Klatsch title", iv: "unused", data: "unused" }],
};
pageDetails.url = "https://example.org/next";
const locked = await step(captureLine);
assert.equal(locked.ok, false);
assert.match(locked.error, /Unlock/);
assert.equal(store.coscripter_personaldb, before);
assert.equal(parseLine(captureLine).toSlop(), captureLine);
console.log("Klatschify capture, cross-tab form data, draft settings, optional fields and failure checks passed.");
