// Node tests for condition evaluation helpers.
// Run: node scripts/test-conditions.mjs

import { compareValues } from "../src/core/executor.js";

let failed = 0;
function check(desc, actual, expected) {
  if (actual === expected) {
    console.log("ok:", desc);
  } else {
    console.error(`FAIL: ${desc}\n  expected ${expected}\n  got      ${actual}`);
    failed++;
  }
}

check("equals string", compareValues("0", "0", "equals"), true);
check("equals case insensitive", compareValues("Yes", "yes", "equals"), true);
check("equals numeric", compareValues("3", "3.0", "equals"), true);
check("contains", compareValues("hello world", "world", "contains"), true);
check("less numeric", compareValues("2", "5", "less"), true);
check("greater numeric", compareValues("9", "5", "greater"), true);

process.exit(failed ? 1 : 0);
