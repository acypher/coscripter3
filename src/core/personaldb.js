// Personal database: name = value pairs for "your X" variable substitution.
// Modeled on the original coscripter-database.js.

const STORAGE_KEY = "coscripter_personaldb";

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

export class PersonalDB {
  constructor() {
    this.entries = [];
    this.text = "";
  }

  static async load() {
    const db = new PersonalDB();
    const data = await chrome.storage.local.get(STORAGE_KEY);
    db.text = data[STORAGE_KEY] || "";
    db._parse(db.text);
    return db;
  }

  async save() {
    this.text = this.toString();
    await chrome.storage.local.set({ [STORAGE_KEY]: this.text });
  }

  _parse(text) {
    this.entries = [];
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^([^=]*)=(.*)$/);
      if (m) {
        this.entries.push({
          key: norm(m[1]),
          value: norm(m[2]),
        });
      }
    }
  }

  updateFromText(text) {
    this.text = text;
    this._parse(text);
  }

  toString() {
    return this.entries.map((e) => `${e.key} = ${e.value}`).join("\n");
  }

  lookup(key) {
    const entry = this.lookupEntry(key);
    return entry ? entry.value : undefined;
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
      if (entry.value === v) return entry.key;
    }
    return null;
  }

  changeEntry(key, value) {
    const k = norm(key);
    const found = this.entries.find((e) => lower(e.key) === lower(k));
    if (found) {
      found.value = norm(value);
    } else {
      this.entries.push({ key: k, value: norm(value) });
    }
    this.text = this.toString();
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
    if (command.valueIsPersonal && key) {
      resolved.value = this.lookup(key) ?? command.value;
    }
    if (command.labelIsPersonal && key) {
      resolved.label = this.lookup(key) ?? command.label;
    }
    if (command.locationIsPersonal && key) {
      resolved.location = this.lookup(key) ?? command.location;
    }
    return resolved;
  }
}

export async function getPersonalDB() {
  return PersonalDB.load();
}
