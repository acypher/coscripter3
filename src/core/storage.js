// Local script storage backed by chrome.storage.local. Scripts are stored as a
// list of { id, name, text, updated }. This replaces the original local script
// database and the wiki for the first version.

const KEY = "coscripter_scripts";

function uid() {
  return "s_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

export async function listScripts() {
  const data = await chrome.storage.local.get(KEY);
  const scripts = data[KEY] || [];
  return scripts.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

export async function getScript(id) {
  const scripts = await listScripts();
  return scripts.find((s) => s.id === id) || null;
}

async function writeAll(scripts) {
  await chrome.storage.local.set({ [KEY]: scripts });
}

// Create or update a script. If id is omitted a new one is created. Returns the saved script.
export async function saveScript({ id, name, text }) {
  const data = await chrome.storage.local.get(KEY);
  const scripts = data[KEY] || [];
  const now = Date.now();
  if (id) {
    const idx = scripts.findIndex((s) => s.id === id);
    if (idx >= 0) {
      scripts[idx] = { ...scripts[idx], name, text, updated: now };
      await writeAll(scripts);
      return scripts[idx];
    }
  }
  const script = { id: uid(), name: name || "Untitled", text: text || "", updated: now };
  scripts.push(script);
  await writeAll(scripts);
  return script;
}

export async function deleteScript(id) {
  const data = await chrome.storage.local.get(KEY);
  const scripts = (data[KEY] || []).filter((s) => s.id !== id);
  await writeAll(scripts);
}
