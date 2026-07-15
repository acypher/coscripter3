// Node tests for the ClearScript parser.
// Run: node scripts/test-parser.mjs

import { parseLine, parseScript } from "../src/core/parser.js";
import { ACTIONS, TYPES, NAME_FILTERS } from "../src/core/commands.js";

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

function p(line) {
  return parseLine(line);
}

// --- basic actions ---
check("goto", p('go to "example.com"').action, ACTIONS.GOTO);
check("goto location", p('go to "example.com"').location, "example.com");
check("go back", p("go back").action, ACTIONS.GO_BACK);
check("click action", p('click the "OK" button').action, ACTIONS.CLICK);
check("click label", p('click the "OK" button').label, "OK");
check("click type", p('click the "OK" button').type, TYPES.BUTTON);
check("link type", p('click the "Home" link').type, TYPES.LINK);

// --- keywords inside quoted labels must not leak ---
const tabLabel = p('click the "Open tab settings" button');
check("quoted 'tab' does not change type", tabLabel.type, TYPES.BUTTON);
check("quoted 'tab' label intact", tabLabel.label, "Open tab settings");
const firstBank = p('click the "First National Bank" link');
check("quoted ordinal ignored", firstBank.ordinal, 0);
check("quoted ordinal label intact", firstBank.label, "First National Bank");

// --- ordinals outside quotes ---
const third = p('click the third "Delete" button');
check("ordinal parsed", third.ordinal, 3);
check("ordinal label", third.label, "Delete");
const thirdLink = p("click the third link");
check("ordinal without label: ordinal", thirdLink.ordinal, 3);
check("ordinal without label: empty label", thirdLink.label, "");
check("ordinal without label: type", thirdLink.type, TYPES.LINK);

// --- unquoted labels ---
const sloppy = p("click the search button");
check("unquoted label extracted", sloppy.label, "search");
check("unquoted label type", sloppy.type, TYPES.BUTTON);
const sloppyOn = p("turn on the remember me checkbox");
check("unquoted turn-on label", sloppyOn.label, "remember me");
check("unquoted turn-on action", sloppyOn.action, ACTIONS.TURN_ON);

// --- name filters ---
const filt = p('click the "Add" button whose name contains "cart"');
check("filter type", filt.nameFilter, { type: NAME_FILTERS.CONTAINS, value: "cart" });
check("filter does not steal label", filt.label, "Add");
const filtOnly = p('click the link whose name starts with "Sign"');
check("filter-only label empty", filtOnly.label, "");
check("filter-only filter", filtOnly.nameFilter, { type: NAME_FILTERS.STARTS_WITH, value: "Sign" });

// --- enter/put/select value+target split ---
const enter = p('enter "hello" into the "Search" textbox');
check("enter value", enter.value, "hello");
check("enter label", enter.label, "Search");
const enterOne = p('enter "hello" into the search box');
check("enter unquoted target label", enterOne.label, "search");
check("enter unquoted target value", enterOne.value, "hello");
const enterTricky = p('enter "go into detail" into the "Notes" textbox');
check("quoted 'into' not a separator: value", enterTricky.value, "go into detail");
check("quoted 'into' not a separator: label", enterTricky.label, "Notes");
const sel = p('select "United States" from the "Country" listbox');
check("select value", sel.value, "United States");
check("select label", sel.label, "Country");

// --- personal db references ---
const yourVal = p('enter your "email" into the "Email" textbox');
check("your value is personal", yourVal.valueIsPersonal, true);
check("your value key", yourVal.personalKey, "email");
check("your value target label", yourVal.label, "Email");
check("your value not label-personal", yourVal.labelIsPersonal, false);
const yourGoto = p('go to your "bank"');
check("goto your personal", yourGoto.locationIsPersonal, true);
check("goto your key", yourGoto.personalKey, "bank");

// --- control flow ---
const iff = p('if there is a "Submit" button');
check("if action", iff.action, ACTIONS.IF);
check("if label", iff.label, "Submit");
check("repeat times", p("repeat 3 times").repeatCount, 3);
check("repeat counter", p('repeat with your "counter"').counterKey, "counter");
check("bare repeat over rows", p("repeat").repeatOverRows, true);
check("repeat over named table", p('repeat over the "Homes" scratchtable').repeatTableName, "Homes");
check("else", p("else").action, ACTIONS.ELSE);
check("end", p("end if").endType, "if");
check("you step", p("you solve the captcha").action, ACTIONS.YOU);
check("pause seconds", p("pause 2 seconds").seconds, 2);

// --- tabs ---
check("create tab", p("create a new tab").action, ACTIONS.CREATE_TAB);
check("close bare tab", p("close the tab").action, ACTIONS.CLOSE_TAB);
check("close bare tab label", p("close the tab").label, "");
const sw = p('switch to the "Gmail" tab');
check("switch tab", sw.action, ACTIONS.SWITCH_TAB);
check("switch tab label", sw.label, "Gmail");

// --- Phase 5.5: negation, comparison, xpath, shift/dbl-click, open, find ---
const ifNo = p('if there is no "404" button');
check("if negation positive flag", ifNo.conditionPositive, false);
check("if negation label", ifNo.label, "404");

const ifCompare = p('if your "count" equals "0"');
check("if comparison type", ifCompare.conditionType, "comparison");
check("if comparison op", ifCompare.compareOp, "equals");
check("if comparison left personal", ifCompare.compareLeft.isPersonal, true);
check("if comparison right value", ifCompare.compareRight.value, "0");

check("if selection", p("if there is a selection").conditionSelection, true);
check("shift-click", p('shift-click the "Open" link').shiftKey, true);
check("double-click", p('double-click the "Row" link').action, ACTIONS.DOUBLE_CLICK);
check("xpath click", p('click x"//button[@id=\'go\']"').xpath, "//button[@id='go']");
check("create window", p("create a new window").action, ACTIONS.CREATE_WINDOW);
check("open in window", p('open "example.com" in a new window').openInWindow, true);
check("find term", p('find "hello"').findTerm, "hello");
check("find next", p("find next").findDirection, "next");

// --- Phase 6c: scratchtable cell references ---
const cellNamed = p('click the cell in the "Address" column of row 2 of the "Homes" scratchtable');
check("cell click action", cellNamed.action, ACTIONS.CLICK);
check("cell click type", cellNamed.type, TYPES.CELL);
check("cell col label", cellNamed.cellRef.columnLabel, "Address");
check("cell row number", cellNamed.cellRef.rowNumber, 2);
check("cell table name", cellNamed.cellRef.tableName, "Homes");

const cellDefault = p('put "Allen" into the cell in the "first name" column of row 3 of the scratchtable');
check("cell put action", cellDefault.action, ACTIONS.PUT);
check("cell put value", cellDefault.value, "Allen");
check("cell put col", cellDefault.cellRef.columnLabel, "first name");
check("cell put row", cellDefault.cellRef.rowNumber, 3);
check("cell put no table", cellDefault.cellRef.tableName, "");

const cellNums = p('copy the cell in column 3 of row 1 of the scratchtable');
check("cell nums col", cellNums.cellRef.columnNumber, 3);
check("cell nums row", cellNums.cellRef.rowNumber, 1);

const cellOrd = p('click the cell in the first column of the second row of the scratchtable');
check("cell ordinal col", cellOrd.cellRef.columnNumber, 1);
check("cell ordinal row", cellOrd.cellRef.rowNumber, 2);

const cellRowLabel = p('enter "x" into the cell in the "Score" column of the "Palo Alto" row of the "Homes" scratchtable');
check("cell row label", cellRowLabel.cellRef.rowLabel, "Palo Alto");
check("cell row label table", cellRowLabel.cellRef.tableName, "Homes");

const cellAsValue = p('enter the cell in the "Address" column of row 1 of the "Homes" scratchtable into the "Search" textbox');
check("cell as value", !!cellAsValue.valueCellRef, true);
check("cell as value col", cellAsValue.valueCellRef.columnLabel, "Address");
check("cell as value target", cellAsValue.label, "Search");

const cellInc = p('increment the cell in the "quantity" column of row 3 of the scratchtable by 2');
check("cell increment", cellInc.action, ACTIONS.INCREMENT);
check("cell increment by", cellInc.incrementBy, 2);
check("cell increment col", cellInc.cellRef.columnLabel, "quantity");

check(
  "cell round-trip named",
  cellNamed.toSlop(),
  'click the cell in the "Address" column of row 2 of the "Homes" scratchtable'
);
check(
  "cell round-trip put",
  cellDefault.toSlop(),
  'put "Allen" into the cell in the "first name" column of row 3 of the scratchtable'
);

// --- round trip ---
for (const line of [
  'click the "OK" button',
  'enter "hello" into the "Search" textbox',
  'select "Blue" from the "Color" listbox',
  "go back",
  "close the tab",
  'click the second "More" link',
]) {
  check(`round-trip: ${line}`, p(line).toSlop(), line);
}

// --- script-level parse ---
const script = parseScript('Title comment\n* click the "A" button\n** click the "B" button\n');
check("comment indent", script[0].indent, 0);
check("comment action", script[0].action, ACTIONS.COMMENT);
check("step indent 1", script[1].indent, 1);
check("step indent 2", script[2].indent, 2);

process.exit(failed ? 1 : 0);
