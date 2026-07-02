# CoScripter3

A modern **Chrome (Manifest V3)** remake of [CoScripter](https://en.wikipedia.org/wiki/CoScripter), the IBM Research tool that lets you record actions in your browser, replay them, and read/edit them as plain-English scripts. CoScripter3 brings that "sloppy programming" idea to today's Chrome, written in plain JavaScript with no build step.

It is a modernization of the original [CoScripter Firefox extension](https://github.com/jeffnichols-ibm/coscripter-extension).

## What it does

- **Record** clicks, typing, selections, navigations, tab switches, and more into human-readable steps.
- **Edit** scripts as plain text — readable sentences, one step per line.
- **Replay** the whole script or one step at a time, with control flow (`if`/`else`, `repeat`).
- **Personal database** — store `name = value` pairs and reference them as `your "name"` in any step.
- **Mixed-initiative** — `you …` steps pause for manual action, then continue.
- **Save** scripts locally and **import/export** as `.coscript` files.

Scripts look like this:

```
Search for homes
* go to "google.com"
* enter your "city" into the "Search" textbox
* click the "Google Search" button
* pause 2 seconds
* if there is a "Sign in" button
** click the "Sign in" button
* end
* you complete the captcha
* repeat 3 times
** click the "Next" button
```

A line starting with `*` is an executable step. Other lines are comments. Indent with extra `*` for nested blocks (`if`, `repeat`).

### Supported steps

| Category | Examples |
| --- | --- |
| Navigate | `go to`, `go back`, `go forward`, `reload` |
| Click | `click`, `control-click`, `mouseover` the `"Label" button/link/…` |
| Input | `enter`, `put`, `append`, `select`, `turn on/off` |
| Sections | `expand`, `collapse`, `toggle` the `"Section" section` |
| Clipboard | `copy`, `paste`, `clip` |
| Timing | `pause N seconds`, `wait until the "…" button` |
| Control flow | `if there is …`, `else`, `end`, `repeat N times`, `repeat with your "counter"` |
| Variables | `enter your "name" into …`, `increment your "counter" by 1` |
| Tabs | `create a new tab`, `switch to the "…" tab`, `close the tab` |
| Mixed-initiative | `you click the confirmation button` |
| Verify | `verify that the "Success" button` |

Ordinals and disambiguators: `click the second "Search" button`, `the link whose name starts with "Sign"`, `click the third link` (ordinals count in page order). Labels don't have to be quoted — `click the search button` works too.

During Run, a step that can't find its target yet is retried automatically for a few seconds (useful while a page is still loading) before the Retry / Skip / Stop prompt appears. Clicking a link that opens a new tab automatically continues the run in that tab.

## Install (load unpacked)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and choose this folder (`coscripter3`).
4. Pin the CoScripter3 icon, then click it to open the side panel.

There is no build step — Chrome loads the source directly.

## How to use

1. Open the **side panel** (click the toolbar icon).
2. Optional: open the **Your data** tab and add personal values (`name = Allen`).
3. Click **Record** and perform a task. Steps appear in the editor.
4. Click **Stop recording** when done.
5. Click **Run** to replay, or **Step** for one step at a time.
6. On errors during Run: **Retry**, **Skip**, or **Stop**.
7. On `you …` steps: complete the action, then click **Continue**.
8. Save scripts by name; use Import/Export for `.coscript` files.

> Recording and replay work on regular `http(s)` pages, not on `chrome://` or the Web Store.

## Architecture

```
sidepanel.html + src/panel/    Side panel UI (script editor, your data, controls)
background.js                  Service worker: recording, playback, control flow
src/content/content.js         Injected per page/frame; recorder + executor
src/core/commands.js           Command model + slop serialization
src/core/parser.js             ClearScript parser (strict + sloppy fallback)
src/core/labeler.js            Label ↔ DOM matching (ordinals, filters, frames)
src/core/recorder.js           User actions → steps
src/core/executor.js           Runs one step against the page
src/core/runner.js             Control-flow program counter (if/repeat)
src/core/personaldb.js         Personal database (your "X" variables)
src/core/storage.js            Local script storage
```

## Status / roadmap

**Implemented (v0.4):** ClearScript language subset (quoted and unquoted labels, ordinals, name filters), control flow, personal database, mixed-initiative steps, cross-tab recording and playback (runs follow link-opened tabs), automatic wait-and-retry for slow pages, password filtering, step preview/highlighting, error retry/skip.

Unit tests live in `scripts/` — run `node scripts/test-parser.mjs`, `node scripts/test-runner.mjs`, `node scripts/test-nav-logic.mjs`, `node scripts/test-media-label.mjs`.

**Planned (Phase 6 — scratch space):** Spreadsheet tables (Vegemite), data extraction mode, repeat-over-rows.

**Planned (Phase 7 — sharing):** Wiki server / script sharing, accounts, search.

## Credits

Original CoScripter was created at the IBM Almaden Research Center (led by Allen
Cypher), formerly known as **Koala**. Licensed under the Mozilla Public License.
