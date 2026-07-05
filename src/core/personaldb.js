// Personal database: name = value pairs for "your X" variable substitution.
// Keys prefixed with * are private: encrypted at rest and require unlock to use.

import {
  decryptString,
  deriveKey,
  encryptString,
  generateSalt,
  verifyPassword,
} from "./personaldb-crypto.js";

const STORAGE_KEY = "coscripter_personaldb";
const CRYPTO_KEY = "coscripter_personaldb_crypto";

export const MASKED_VALUE = "••••••";

/** @type {CryptoKey | null} */
let unlockKey = null;

function norm(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function lower(s) {
  return norm(s).toLowerCase();
}

function tokenize(s) {
  return lower(s).split(/\s+/).filter(Boolean);
}

function scoreMatch(wanted, candidate) {
  const w = lower(wanted);
  const c = lower(candidate);
  if (!w || !c) return 0;
  if (w === c) return 1;
  if (c.startsWith(w) || w.startsWith(c)) return 0.85;
  if (c.includes(w) || w.includes(c)) return 0.7;
  const wt = new Set(tokenize(w));
  const ct = new Set(tokenize(c));
  let common = 0;
  wt.forEach((t) => { if (ct.has(t)) common++; });
  if (common === 0) return 0;
  return 0.4 * (common / Math.max(wt.size, ct.size));
}

function parseKey(rawKey) {
  const k = norm(rawKey);
  const m = k.match(/^\*\s*(.+)$/);
  if (m) return { key: norm(m[1]), private: true };
  return { key: k, private: false };
}

function displayKey(entry) {
  return entry.private ? `*${entry.key}` : entry.key;
}

export function isUnlocked() {
  return unlockKey != null;
}

export function lock() {
  unlockKey = null;
}

async function loadCryptoMeta() {
  const data = await chrome.storage.local.get(CRYPTO_KEY);
  return data[CRYPTO_KEY] || null;
}

export async function hasStoredCrypto() {
  const meta = await loadCryptoMeta();
  return Boolean(meta?.salt);
}

export async function unlockWithPassword(password) {
  const meta = await loadCryptoMeta();
  if (!meta?.salt) {
    unlockKey = null;
    return { ok: false, error: "No private data saved yet." };
  }
  const sample = (meta.secrets || [])[0];
  const ok = await verifyPassword(password, meta.salt, sample);
  if (!ok) {
    unlockKey = null;
    return { ok: false, error: "Incorrect password." };
  }
  unlockKey = await deriveKey(password, meta.salt);
  return { ok: true };
}

export async function setupPassword(password) {
  const trimmed = (password || "").trim();
  if (!trimmed) return { ok: false, error: "Choose a password." };
  const meta = await loadCryptoMeta();
  const salt = meta?.salt || (await generateSalt());
  unlockKey = await deriveKey(trimmed, salt);
  return { ok: true, salt };
}

export class PersonalDB {
  constructor() {
    this.entries = [];
    this.text = "";
    this._cryptoMeta = null;
  }

  static async load() {
    const db = new PersonalDB();
    const data = await chrome.storage.local.get([STORAGE_KEY, CRYPTO_KEY]);
    db.text = data[STORAGE_KEY] || "";
    db._cryptoMeta = data[CRYPTO_KEY] || null;
    db._parsePublic(db.text);

    const secrets = db._cryptoMeta?.secrets || [];
    if (isUnlocked() && unlockKey) {
      for (const secret of secrets) {
        const value = await decryptString(secret, unlockKey);
        db._upsertEntry({ key: secret.key, value, private: true });
      }
    } else {
      for (const secret of secrets) {
        db._upsertEntry({
          key: secret.key,
          value: MASKED_VALUE,
          private: true,
          masked: true,
        });
      }
    }
    db.text = db.toDisplayText();
    return db;
  }

  _parsePublic(text) {
    this.entries = [];
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([^=]*)=(.*)$/);
      if (!m) continue;
      const { key, private: isPrivate } = parseKey(m[1]);
      if (isPrivate) continue;
      this._upsertEntry({ key, value: norm(m[2]), private: false });
    }
  }

  _upsertEntry(entry) {
    const idx = this.entries.findIndex((e) => lower(e.key) === lower(entry.key));
    if (idx >= 0) this.entries[idx] = entry;
    else this.entries.push(entry);
  }

  hasPrivateEntries() {
    return this.entries.some((e) => e.private) || (this._cryptoMeta?.secrets || []).length > 0;
  }

  isPrivateKey(key) {
    const k = lower(key);
    return this.entries.some((e) => e.private && lower(e.key) === k)
      || (this._cryptoMeta?.secrets || []).some((s) => lower(s.key) === k);
  }

  async save() {
    const publicText = this.entries
      .filter((e) => !e.private)
      .map((e) => `${displayKey(e)} = ${e.value}`)
      .join("\n");

    const privateEntries = this.entries.filter((e) => e.private);
    const existingSecrets = new Map(
      (this._cryptoMeta?.secrets || []).map((s) => [lower(s.key), s])
    );
    let salt = this._cryptoMeta?.salt;
    const secrets = [];

    for (const entry of privateEntries) {
      if (entry.masked) {
        const existing = existingSecrets.get(lower(entry.key));
        if (!existing) {
          throw new Error("Unlock your data to add or edit private values.");
        }
        secrets.push(existing);
        continue;
      }
      if (!unlockKey) {
        throw new Error("Unlock your data to save private values.");
      }
      if (!salt) salt = await generateSalt();
      const enc = await encryptString(entry.value, unlockKey);
      secrets.push({ key: entry.key, iv: enc.iv, data: enc.data });
    }

    await chrome.storage.local.set({ [STORAGE_KEY]: publicText });
    if (secrets.length) {
      await chrome.storage.local.set({
        [CRYPTO_KEY]: { salt, secrets },
      });
      this._cryptoMeta = { salt, secrets };
    } else if (this._cryptoMeta) {
      await chrome.storage.local.remove(CRYPTO_KEY);
      this._cryptoMeta = null;
    }

    this.text = this.toDisplayText();
  }

  updateFromText(text) {
    const prevByKey = new Map(this.entries.map((e) => [lower(e.key), e]));
    this.entries = [];

    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([^=]*)=(.*)$/);
      if (!m) continue;
      const { key, private: isPrivate } = parseKey(m[1]);
      let value = norm(m[2]);

      if (isPrivate && (value === MASKED_VALUE || value === "")) {
        const prev = prevByKey.get(lower(key));
        if (prev?.private && prev.masked) {
          this._upsertEntry({ ...prev });
          continue;
        }
        if (prev?.private && !prev.masked) {
          value = prev.value;
        }
      }

      this._upsertEntry({
        key,
        value,
        private: isPrivate,
        masked: isPrivate && value === MASKED_VALUE,
      });
    }
    this.text = this.toDisplayText();
  }

  toDisplayText() {
    return this.entries.map((e) => {
      const value = e.private && !isUnlocked() ? MASKED_VALUE : e.value;
      return `${displayKey(e)} = ${value}`;
    }).join("\n");
  }

  toString() {
    return this.toDisplayText();
  }

  lookup(key) {
    const entry = this.lookupEntry(key);
    if (!entry) return undefined;
    if (entry.private && (entry.masked || !isUnlocked())) return undefined;
    return entry.value;
  }

  lookupEntry(key) {
    let best = null;
    let bestScore = 0;
    for (const entry of this.entries) {
      const s = scoreMatch(key, entry.key);
      if (s > bestScore) {
        bestScore = s;
        best = entry;
      }
    }
    return bestScore >= 0.5 ? best : null;
  }

  inverseLookup(value) {
    const v = norm(value);
    for (const entry of this.entries) {
      if (entry.private && (entry.masked || !isUnlocked())) continue;
      if (entry.value === v) return entry.key;
    }
    return null;
  }

  changeEntry(key, value) {
    const k = norm(key);
    const found = this.entries.find((e) => lower(e.key) === lower(k));
    if (found) {
      found.value = norm(value);
      found.masked = false;
    } else {
      this.entries.push({ key: k, value: norm(value), private: false });
    }
    this.text = this.toDisplayText();
  }

  increment(key, by = 1) {
    const entry = this.lookupEntry(key);
    const k = entry ? entry.key : norm(key);
    const current = entry ? parseFloat(entry.value) : 0;
    const next = (Number.isFinite(current) ? current : 0) + by;
    this.changeEntry(k, String(next));
    return next;
  }

  decrement(key, by = 1) {
    return this.increment(key, -by);
  }

  resolve(command) {
    const resolved = { ...command };
    const key = command.personalKey || command.value || command.label || command.location;

    const applyPersonal = (field, isPersonal) => {
      if (!isPersonal || !key) return;
      const val = this.lookup(key);
      if (val === undefined && this.isPrivateKey(key)) {
        resolved.lookupBlocked = true;
        resolved.blockedKey = key;
        return;
      }
      resolved[field] = val ?? command[field];
    };

    applyPersonal("value", command.valueIsPersonal);
    applyPersonal("label", command.labelIsPersonal);
    applyPersonal("location", command.locationIsPersonal);
    return resolved;
  }
}

export async function getPersonalDB() {
  return PersonalDB.load();
}
