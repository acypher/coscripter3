// Unit tests for private personal-database parsing, encryption, and unlock.

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
    console.log("ok:", label);
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

// --- Full PersonalDB setup → save → lock → unlock (catches salt mismatch) ---

const store = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const out = {};
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) {
          if (store.has(k)) out[k] = store.get(k);
        }
        return out;
      },
      async set(obj) {
        for (const [k, v] of Object.entries(obj)) store.set(k, v);
      },
      async remove(key) {
        store.delete(key);
      },
    },
  },
};

const {
  PersonalDB,
  setupPassword,
  unlockWithPassword,
  lock,
  resetPrivateData,
  isUnlocked,
  hasStoredCrypto,
} = await import("../src/core/personaldb.js");

{
  store.clear();
  const setup = await setupPassword("correct-horse");
  check("setup ok", setup.ok, true);

  const db = await PersonalDB.load();
  db.updateFromText('name = Allen\n*password = s3cret\n*token = abc');
  await db.save();

  const meta = store.get("coscripter_personaldb_crypto");
  check("crypto saved", Boolean(meta?.salt && meta.secrets?.length === 2), true);
  check("public text has no secrets", store.get("coscripter_personaldb").includes("*password"), false);
  check("public keeps name", store.get("coscripter_personaldb").includes("Allen"), true);

  lock();
  check("locked", isUnlocked(), false);

  const bad = await unlockWithPassword("wrong-password");
  check("bad unlock fails", bad.ok, false);
  check("bad unlock message", bad.error, "Incorrect password.");

  const good = await unlockWithPassword("correct-horse");
  check("good unlock ok", good.ok, true);
  check("unlocked", isUnlocked(), true);

  const loaded = await PersonalDB.load();
  check("decrypt password", loaded.lookup("password"), "s3cret");
  check("decrypt token", loaded.lookup("token"), "abc");
  check("public still there", loaded.lookup("name"), "Allen");

  // Trailing space should still unlock (trim)
  lock();
  const trimmed = await unlockWithPassword("  correct-horse  ");
  check("trimmed unlock ok", trimmed.ok, true);
}

{
  store.clear();
  await setupPassword("old-pass");
  const db = await PersonalDB.load();
  db.updateFromText("*secret = value");
  await db.save();
  lock();

  const reset = await resetPrivateData();
  check("reset ok", reset.ok, true);
  check("crypto gone", await hasStoredCrypto(), false);
  check("public text empty or public-only", (reset.text || "").includes("*"), false);

  const after = await PersonalDB.load();
  check("no private after reset", after.hasPrivateEntries(), false);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
