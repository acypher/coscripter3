# Coscripter3 → Original CoScripter Parity Plan

**Last updated:** July 12, 2026  
**Resume checkpoint:** Coscripter3 is at **v0.8.1** (uncommitted branding rename). Core record/replay is a working MVP (~5,400 lines). Phases 1–5 of the earlier parity plan are done; Phases 6–7 are not. Original source: [jeffnichols-ibm/coscripter-extension](https://github.com/jeffnichols-ibm/coscripter-extension) + [coscripter-server](https://github.com/jeffnichols-ibm/coscripter-server). All unit tests pass.

Use `@PARITY-PLAN.md` in future Cursor sessions to pick up where you left off.

---

## What you've built so far

### Timeline (6 commits, ~3 weeks)

| Version | What shipped |
|---|---|
| **0.2.0** | MV3 skeleton, side panel, step highlighting, ship skill |
| **0.3.x–0.5.0** | Phases 1–5: ClearScript parser, control flow, personal DB, mixed-initiative, cross-tab record/run; major bug fixes (broken `if`, unquoted labels, ordinals, nav stack) |
| **0.6.0** | Quill icon |
| **0.7.0** | Encrypted private PDB (`*password`), stable extension ID via manifest `key` |
| **0.8.0** | Signing key documented outside extension folder |
| **0.8.1** *(uncommitted)* | User-facing rename CoScripter3 → Coscripter3 |

### Architecture (clean, testable)

```
sidepanel.html + src/panel/   → editor, Your data tab, controls
background.js                 → recording session, playback loop, tabs, PDB
src/content/content.js        → injects core modules per frame
src/core/*                    → pure parser/runner; labeler/recorder/executor
```

Design choices that worked well: no build step, pure `runner.js`/`parser.js` unit-testable in Node, dynamic ES module imports via `web_accessible_resources`, session storage for recording state.

### Already at parity (or better than original)

- **ClearScript core:** click, control-click, mouseover, enter/put/append, select, turn on/off, expand/collapse/toggle, copy/paste/clip, pause, wait until, verify, goto/back/forward/reload, tab create/switch/close
- **Control flow:** `if`/`else`/`end`, `repeat N times`, `repeat with your "counter"`, increment/decrement
- **Personal database:** `name = value`, `your "name"` in scripts — **plus encrypted `*private` keys** (original had secret entries but not AES-GCM)
- **Mixed-initiative:** `you …` steps with Continue prompt
- **Recording:** clicks, typing, selects, checkboxes, nav, cross-tab, password filtering, PDB inverse lookup
- **Playback:** Run/Step, auto-retry (8s), error Retry/Skip/Stop, follow link-opened tabs
- **UI:** syntax-highlighted editor, step preview, run progress bullets
- **Persistence:** local script library, `.coscript` import/export
- **Tests:** `test-parser.mjs`, `test-runner.mjs`, `test-nav-logic.mjs`, `test-media-label.mjs`, `test-playlist-label.mjs`, `test-personaldb.mjs`, `test-dom.html`

---

## Gap analysis vs original CoScripter

Original CoScripter had **three sub-extensions + a Rails wiki server**:

| Component | Original | Coscripter3 status |
|---|---|---|
| **YULE** (recorder) | Multi-window/tab event capture, scroll, dblclick, keyboard | Partial — clicks/typing/nav/tabs only |
| **Platform** (parser/executor/labeler) | Full ClearScript + XPath + table/scratchtable refs + comparison `if`s | ~85% of everyday web steps |
| **Extension UI** | Sidebar, welcome page, wiki save/search, related scripts, scratch editor | Side panel + local library only |
| **Server** (Koala wiki) | Browse, search, save, related scripts, accounts | Not started (Export/Import workaround) |
| **Vegemite** | Spreadsheet scratch space, data extraction, repeat-over-rows | Not started (README Phase 6) |

### ClearScript features still missing

From `coscripter-strict-parser.js` / `coscripter-command.js` in the original repo:

1. **Negation:** `if there is no "Sign in" button`
2. **Comparison conditions:** `if your "count" equals 3`, `if … > …`, `if … < …`
3. **Selection conditions:** `if there is a selection`
4. **`find` command** — search within page
5. **`open` command** — open scratchtable, web table, or URL in new context
6. **Scratchtable / table cell targets** — `put "Allen" into the cell in the "name" column of row 3 of the scratchtable`
7. **Data extraction** — `begin extraction` / `end extraction` / `extract the "queue" scratchtable`
8. **`repeat` over all scratchtable rows** (no count — loops entire table)
9. **XPath targets** — `click x"//button[@id='foo']"`
10. **Shift-click, double-click** recording and playback
11. **Create window** (not just tab)
12. **Main window** targeting for goto/switch
13. **Web page table references** — `table 2`, row/column/cell on live pages
14. **Dijit/legacy widget heuristics** (Dojo accordion, menu items, etc.)

### UI / sharing features still missing

- Welcome page with script search
- Save to / load from wiki server
- Related scripts for current URL
- Scratch space spreadsheet editor (Vegemite VegeTable)
- Rich-text script editor (original had richtextbox; plain textarea is fine for v1 parity if scripts work)
- Preferences (server URL, feature toggles)
- Action history tab

---

## Recommended execution plan

Work in order. Each phase is independently shippable. Bump patch version per phase; minor at Phase 6 and 7.

### Phase 5.5 — ClearScript completeness *(~1–2 sessions)* **✅ Done in v0.8.2**

**Goal:** Run scripts written for original CoScripter that don't use scratch tables.

**Read first:** `platform/modules/coscripter-strict-parser.js` (IfCommand, FindCommand) in the original repo; `src/core/parser.js`, `src/core/runner.js`, `src/core/executor.js`

| Task | Files | Acceptance test |
|---|---|---|
| Parse & execute `if there is no …` | `parser.js`, `runner.js`, `executor.js` | `if there is no "404" button` skips body correctly |
| Comparison `if`: equals, `<`, `>` with literals and `your "X"` | `parser.js`, `runner.js`, `personaldb.js` | `if your "count" equals "0"` works |
| `if there is a selection` | `parser.js`, `executor.js` | Checks `window.getSelection()` |
| Shift-click parse + record | `parser.js`, `recorder.js`, `commands.js` | Records `shift-click the "Open" link` |
| Double-click | `parser.js`, `recorder.js`, `executor.js` | dblclick fires on target |
| `open` URL / new window | `parser.js`, `background.js` | `open "example.com" in a new window` |
| XPath fallback targets | `parser.js`, `labeler.js` | `click x"//a[@href='/login']"` finds element |
| Strengthen labeler for ARIA tabs, menus | `labeler.js` | Port key heuristics from `coscripter-labeler.js` |

**Tests to add:** `test-parser.mjs` cases for negation/comparison; `test-dom.html` fixtures for XPath.

---

### Phase 6 — Scratch space / Vegemite *(~3–5 sessions, largest gap)*

**Goal:** Spreadsheet tables integrated with scripts — the feature that made CoScripter a mashup tool, not just a macro recorder.

**Read first:** `extension/xpi/modules/coscripter-scratch-space.js`, `coscripter-scratch-space-editor.js`, `coscripter-data-extraction-mode.js`, `coscripter-vegemite.js` in the original repo

**Architecture proposal for Chrome:**

```
src/core/scratchtable.js     — table model (columns, rows, cells), persistence
src/panel/scratch-editor.*   — spreadsheet UI (bottom panel or second side-panel tab)
src/core/extraction.js       — interactive column picker + XPath save/replay
background.js                — wire repeat-over-rows, extract commands
```

| Task | Notes |
|---|---|
| **6a. Data model** ✅ **Done in v0.9.1** | Named tables in `chrome.storage.local`; columns + rows; cell = string or link URL (`src/core/scratchtable.js`, `scripts/test-scratchtable.mjs`) |
| **6b. Scratch editor UI** ✅ **Done in v0.9.2** | New **Tables** tab: list tables, open editor (`src/panel/scratch-editor.js`) |
| **6c. Cell references in parser** ✅ **Done in v0.9.3** | Extend `parseTarget()` for `cell in the "col" column of row N of the "name" scratchtable` (`parseCellRef` in `parser.js`) |
| **6d. Execute on cells** ✅ **Done in v0.10.1** | `put`, `enter`, `click`, `increment` targeting scratchtable cells |
| **6e. Repeat over rows** ✅ **Done in v0.11.0** | Bare `* repeat` (no count) = loop all data rows; `repeat with your "counter"` already exists |
| **6f. Data extraction mode** ✅ **Done in v0.12.0** | Tables tab **Extract from page…**: click first-row cells (or Alt-click a table) → fill scratchtable + save column XPaths + insert `extract` step |
| **6g. Extract command** | `extract the "homes" scratchtable` / `extract and append to …` — scrape page table into scratchtable |

**Acceptance scenario (from Vegemite paper):** List of house addresses in scratchtable → script loops rows → pastes each address into WalkScore → writes score back to scratchtable column.

---

### Phase 7 — Wiki sharing *(~3–4 sessions + optional server)*

**Goal:** In-extension browse/search/save scripts collaboratively.

**Do NOT port Rails 2.3 as-is.** Options:

| Option | Pros | Cons |
|---|---|---|
| **A. Modern minimal API** (recommended) | Node/FastAPI + SQLite/Postgres; same concepts as original | New server to deploy |
| **B. GitHub-as-wiki** | No server; scripts as gists/repos | Needs GitHub auth, not "Koala" UX |
| **C. Port coscripter-server** | Faithful | Ruby 1.8 / Rails 2.3 unmaintainable |

**If Option A**, implement these endpoints mirroring original controllers (`browse`, `lite`, `api`, `login`):

- `GET /browse/search?q=…` — search scripts
- `GET /lite/find_related?url=…` — related scripts for current page
- `POST /api/procedures` — save script (title, body, author)
- `GET /api/procedures/:id` — load script

**Extension work:**

| Task | Files |
|---|---|
| Server URL preference | `panel.js`, new `src/core/wiki-client.js` |
| Welcome/search UI | Replace empty editor state with search box + results |
| Save to wiki / Load from wiki | Extend save dialog beyond local name |
| Related scripts | Query on tab URL change; show in panel |
| Keep Export/Import | Still works offline |

Original server repo: [jeffnichols-ibm/coscripter-server](https://github.com/jeffnichols-ibm/coscripter-server)

---

### Phase 8 — Recording completeness *(~1–2 sessions)*

**Goal:** Match YULE's event coverage for modern sites.

| Task | Source reference |
|---|---|
| Scroll steps (`scroll down`, etc.) | `yule.js` ScrollEventDescriptor |
| Keyboard shortcuts (Enter in textbox, Tab) | YULE keydown handlers |
| Right-click / context menu | Optional — rare in scripts |
| Record `copy`/`paste` from clipboard events | Original recorded clipboard ops |
| Window create/switch (not just tabs) | `CREATE` command in original |
| Smarter dedup / coalesce rapid typing | Merge keystrokes into single `enter` on blur (partially done) |

---

### Phase 9 — Labeler robustness *(ongoing, site-specific)*

Port high-value heuristics from `platform/modules/coscripter-labeler.js` and `coscripter-utils.js`:

- Dojo Dijit accordion, menu items, toggle buttons
- Table-on-page cell targeting
- `<details>`/`<summary>` (partially in executor)
- Shadow DOM / custom elements (modern sites original didn't handle)
- Contenteditable divs as textboxes

Maintain a **site fixture library** in `scripts/fixtures/` with regression tests — pattern already started with YouTube playlist labeling.

---

### Phase 10 — UI polish *(~1 session)*

| Task | Priority |
|---|---|
| Update README status (still says v0.4) | High |
| Welcome/onboarding when no script loaded | Medium |
| Unsaved-changes warning before closing panel | Medium |
| Run-all-tests script (`scripts/run-all-tests.sh`) | High |
| Optional: GitHub Actions CI running Node tests | Medium |

---

### Phase 11 — Ship to Chrome Web Store *(separate from `ship` skill)*

Not in scope of code parity, but needed for public distribution:

- Chrome Web Store developer account
- Privacy policy (handles page content, personal data)
- Review MV3 permissions justification (`<all_urls>`)
- Use existing signing key workflow

---

## Priority order

If credits are limited, do **this sequence**:

```
1. Phase 5.5  (negation + comparison if)     ← unblocks many real scripts
2. Phase 6a–6e (scratch tables core)         ← biggest differentiator vs iMacros
3. Phase 6f–6g (extraction)                  ← Vegemite mashup workflows
4. Phase 7     (wiki sharing)                ← collaborative scripting
5. Phase 8–9   (recording + labeler)         ← polish on real sites
6. Phase 10    (docs + CI)
```

---

## How to execute each phase (prompt template)

Give Opus/Sonnet this at the start of each session:

```
Project: /Users/acypher/Projects/extensions/coscripter/coscripter3
Goal: Implement Phase X.Y from PARITY-PLAN.md
Rules: bump patch version on code changes; run node scripts/test-*.mjs after edits
Reference: clone jeffnichols-ibm/coscripter-extension and read [specific files]
Do not rewrite working code — extend parser/runner/labeler patterns already in src/core/
Acceptance: [paste acceptance criteria from above]
```

---

## Quick reference

**Run tests:**

```bash
node scripts/test-parser.mjs
node scripts/test-runner.mjs
node scripts/test-nav-logic.mjs
node scripts/test-media-label.mjs
node scripts/test-playlist-label.mjs
node scripts/test-personaldb.mjs
```

**Key original files to consult** (in [coscripter-extension](https://github.com/jeffnichols-ibm/coscripter-extension)):

- Parser: `platform/modules/coscripter-strict-parser.js`
- Commands: `platform/modules/coscripter-command.js`
- Labeler: `platform/modules/coscripter-labeler.js`
- Scratch: `extension/xpi/modules/coscripter-scratch-space.js`
- Extraction: `extension/xpi/chrome/coscripter/content/coscripter-data-extraction-mode.js`
- Wiki UI: `extension/xpi/chrome/coscripter/content/coscripter-sidebar.js`, `coscripter-save-dialog.js`

**Prior chat context:** Phases 1–5 were planned and implemented in an earlier parity session; v0.5 fixes came from a Composer review session that fixed broken `if`, unquoted labels, ordinals, and nav stack bugs.

---

## Bottom line

The **heart** of CoScripter — record, edit, replay, control flow, personal data — is rebuilt in modern Chrome MV3. What's left for full original parity:

1. **Remaining ClearScript** (negation, comparisons, XPath, open/find) — small
2. **Scratch space / Vegemite** — large, distinctive
3. **Wiki sharing** — medium, needs a modern server
4. **Recording/labeler depth** — ongoing site-by-site work

Coscripter3 is already usable for single-user web automation. Phases 6 and 7 restore the original vision of *collaborative, data-driven* web scripting.
