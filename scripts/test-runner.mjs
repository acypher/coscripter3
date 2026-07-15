// Node tests for control flow (if/else/repeat) in the script runner.
// Simulates the background.js drive loop with a scriptable condition oracle
// and a fake personal database for counters.
// Run: node scripts/test-runner.mjs

import { ScriptRunner } from "../src/core/runner.js";
import { compareValues } from "../src/core/executor.js";

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

// Drive a script to completion. `conditions` maps if-labels to booleans.
// `compareValues` maps left-side strings to right-side strings for comparison ifs.
// Returns the slop of every executed step, in order.
function run(text, { conditions = {}, counters = {}, selection = false, comparisons = {}, rowCount = 0 } = {}) {
  const runner = ScriptRunner.fromText(text);
  const executed = [];
  const db = { ...counters };
  const options = { rowCount };
  for (let guard = 0; guard < 500; guard++) {
    const step = runner.next();
    if (!step) return executed;
    if (step.type === "if") {
      let result;
      if (step.cmd.conditionSelection) {
        result = !!selection;
        if (step.cmd.conditionPositive === false) result = !result;
      } else if (step.cmd.conditionType === "comparison") {
        const leftKey = step.cmd.compareLeft?.value || step.cmd.compareLeft?.key || "";
        if (comparisons[leftKey] !== undefined) {
          result = comparisons[leftKey];
        } else {
          step.cmd.compareLeftValue = step.cmd.compareLeftValue ?? step.cmd.compareLeft?.value ?? "";
          step.cmd.compareRightValue = step.cmd.compareRightValue ?? step.cmd.compareRight?.value ?? "";
          result = compareValues(
            step.cmd.compareLeftValue,
            step.cmd.compareRightValue,
            step.cmd.compareOp
          );
        }
        if (step.cmd.conditionPositive === false) result = !result;
      } else {
        result = !!conditions[step.cmd.label];
        if (step.cmd.conditionPositive === false) result = !result;
      }
      runner.branch(step.cmd, result);
      continue;
    }
    if (step.type === "repeat-counter") {
      const key = step.cmd.counterKey;
      const val = parseInt(db[key] || "0", 10);
      if (val <= 0) {
        runner.skipBlock(step.cmd);
      } else {
        runner.enterCounterRepeat(step.cmd);
        db[key] = String(val - 1);
      }
      continue;
    }
    if (step.type === "repeat-rows") {
      const n = options.rowCount ?? 0;
      if (n < 1) runner.skipBlock(step.cmd);
      else runner.enterRowRepeat(step.cmd, n);
      continue;
    }
    executed.push(step.cmd.toSlop());
    runner.advance();
  }
  throw new Error("runner did not terminate (infinite loop)");
}

// --- if true executes body exactly once and continues ---
check(
  "if true runs body",
  run('* if there is a "X" button\n** click the "A" button\n* click the "B" button', {
    conditions: { X: true },
  }),
  ['click the "A" button', 'click the "B" button']
);

// --- if false skips body ---
check(
  "if false skips body",
  run('* if there is a "X" button\n** click the "A" button\n* click the "B" button', {
    conditions: { X: false },
  }),
  ['click the "B" button']
);

// --- if/else both directions ---
const ifElse = '* if there is a "X" button\n** click the "T" button\n* else\n** click the "F" button\n* end\n* click the "Z" button';
check("if/else true branch", run(ifElse, { conditions: { X: true } }), [
  'click the "T" button',
  'click the "Z" button',
]);
check("if/else false branch", run(ifElse, { conditions: { X: false } }), [
  'click the "F" button',
  'click the "Z" button',
]);

// --- explicit end without else ---
check(
  "if with end marker",
  run('* if there is a "X" button\n** click the "A" button\n* end if\n* click the "B" button', {
    conditions: { X: true },
  }),
  ['click the "A" button', 'click the "B" button']
);

// --- repeat N times ---
check(
  "repeat 3 times",
  run('* repeat 3 times\n** click the "N" button\n* click the "Done" button'),
  ['click the "N" button', 'click the "N" button', 'click the "N" button', 'click the "Done" button']
);

// --- repeat 0 times skips body ---
check(
  "repeat 0 times",
  run('* repeat 0 times\n** click the "N" button\n* click the "Done" button'),
  ['click the "Done" button']
);

// --- nested repeat ---
check(
  "nested repeat 2x2",
  run('* repeat 2 times\n** repeat 2 times\n*** click the "I" button\n** click the "O" button'),
  [
    'click the "I" button', 'click the "I" button', 'click the "O" button',
    'click the "I" button', 'click the "I" button', 'click the "O" button',
  ]
);

// --- repeat with counter loops until exhausted ---
check(
  "repeat with counter (3)",
  run('* repeat with your "counter"\n** click the "C" button\n* click the "Done" button', {
    counters: { counter: "3" },
  }),
  ['click the "C" button', 'click the "C" button', 'click the "C" button', 'click the "Done" button']
);
check(
  "repeat with counter (0)",
  run('* repeat with your "counter"\n** click the "C" button\n* click the "Done" button', {
    counters: { counter: "0" },
  }),
  ['click the "Done" button']
);

// --- comments and blank lines inside blocks don't break them ---
check(
  "comment inside if body",
  run('* if there is a "X" button\n** click the "A" button\nnote to self\n** click the "B" button\n* click the "C" button', {
    conditions: { X: true },
  }),
  ['click the "A" button', 'click the "B" button', 'click the "C" button']
);
check(
  "blank line inside repeat body",
  run('* repeat 2 times\n** click the "A" button\n\n** click the "B" button\n* click the "C" button'),
  ['click the "A" button', 'click the "B" button', 'click the "A" button', 'click the "B" button', 'click the "C" button']
);

// --- if inside repeat ---
check(
  "if inside repeat",
  run('* repeat 2 times\n** if there is a "X" button\n*** click the "A" button\n** click the "B" button', {
    conditions: { X: true },
  }),
  ['click the "A" button', 'click the "B" button', 'click the "A" button', 'click the "B" button']
);

// --- repeat inside if-false is skipped ---
check(
  "repeat inside skipped if",
  run('* if there is a "X" button\n** repeat 3 times\n*** click the "A" button\n* click the "B" button', {
    conditions: { X: false },
  }),
  ['click the "B" button']
);

// --- negation ---
check(
  "if there is no skips when absent",
  run('* if there is no "Missing" button\n** click the "A" button\n* click the "B" button', {
    conditions: { Missing: false },
  }),
  ['click the "A" button', 'click the "B" button']
);
check(
  "if there is no runs else when present",
  run('* if there is no "Here" button\n** click the "A" button\n* else\n** click the "B" button\n* click the "Z" button', {
    conditions: { Here: true },
  }),
  ['click the "B" button', 'click the "Z" button']
);

// --- comparison if ---
check(
  "if comparison equals true",
  run('* if your "count" equals "0"\n** click the "Zero" button\n* click the "Done" button', {
    comparisons: { count: true },
  }),
  ['click the "Zero" button', 'click the "Done" button']
);
check(
  "if comparison equals false",
  run('* if your "count" equals "0"\n** click the "Zero" button\n* click the "Done" button', {
    comparisons: { count: false },
  }),
  ['click the "Done" button']
);

// --- repeat over scratchtable rows ---
check(
  "repeat over 3 rows",
  run('* repeat\n** click the "Go" button\n* click the "Done" button', { rowCount: 3 }),
  ['click the "Go" button', 'click the "Go" button', 'click the "Go" button', 'click the "Done" button']
);
check(
  "repeat over 0 rows skips",
  run('* repeat\n** click the "Go" button\n* click the "Done" button', { rowCount: 0 }),
  ['click the "Done" button']
);

process.exit(failed ? 1 : 0);
