// Unit tests for private personal-database parsing and encryption.

import {
  decryptString,
  deriveKey,
  encryptString,
  generateSalt,
  verifyPassword,
} from "../src/core/personaldb-crypto.js";

let passed = 0;
let failed = 0;

function check(label, got, want) {
  const ok = got === want;
  if (ok) {
    passed++;
    return;
  }
  failed++;
  console.error(`FAIL: ${label}`);
  console.error(`  got:  ${JSON.stringify(got)}`);
  console.error(`  want: ${JSON.stringify(want)}`);
}

function parseKey(rawKey) {
  const k = (rawKey || "").replace(/\s+/g, " ").trim();
  const m = k.match(/^\*\s*(.+)$/);
  if (m) return { key: m[1].trim(), private: true };
  return { key: k, private: false };
}

check("*password private", parseKey("*password").private, true);
check("*password key", parseKey("*password").key, "password");
check("* password key", parseKey("* password").key, "password");
check("name not private", parseKey("name").private, false);

const salt = await generateSalt();
const key = await deriveKey("test-pass", salt);
const enc = await encryptString("secret-value", key);
const plain = await decryptString(enc, key);
check("encrypt roundtrip", plain, "secret-value");
check("verify good password", await verifyPassword("test-pass", salt, enc), true);
check("verify bad password", await verifyPassword("wrong", salt, enc), false);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
