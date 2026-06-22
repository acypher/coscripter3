# CoScripter3

A modern **Chrome (Manifest V3)** remake of [CoScripter](https://en.wikipedia.org/wiki/CoScripter), the IBM Research tool that lets you record actions in your browser, replay them, and read/edit them as plain-English scripts. CoScripter3 brings that "sloppy programming" idea to today's Chrome, written in plain JavaScript with no build step.

It is a modernization of the original [CoScripter Firefox extension](https://github.com/jeffnichols-ibm/coscripter-extension).

## What it does

- **Record** your clicks, typing, menu selections, and page navigations into human-readable steps.
- **Edit** the script as text — it's just readable sentences, one step per line.
- **Replay** the whole script, or one step at a time, with the step about to run highlighted.
- **Save** scripts locally and **import/export** them as files.

Scripts look like this:

```
Search for homes
* go to "google.com"
* enter "Palo Alto homes" into the "Search" textbox
* click the "Google Search" button
```

A line that starts with `*` is an executable step. Any other line is a comment.

### Supported steps (v1)

| Step | Example |
| --- | --- |
| Navigate | `* go to "example.com"` |
| Click | `* click the "Sign in" button` / `... link` |
| Type | `* enter "hello" into the "Search" textbox` |
| Choose | `* select "California" from the "State" listbox` |
| Toggle | `* click the "I agree" checkbox` / `... radio button` |

## Install (load unpacked)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and choose this folder (`coscripter3`).
4. Pin the CoScripter3 icon, then click it to open the side panel.

There is no build step — Chrome loads the source directly.

## How to use

1. Open the **side panel** (click the toolbar icon).
2. Click **Record** and perform a task on the page. Steps appear in the editor as you go.
3. Click **Stop recording** when done.
4. Click **Run** to replay, or **Step** to advance one step at a time. **Stop** halts a run.
5. Give the script a name and click **Save** to keep it. Use **Import**/**Export** to move scripts as `.coscript` files.

> Recording and replay only work on regular `http(s)` pages, not on `chrome://` pages or the Chrome Web Store.

## Architecture

```
sidepanel.html + src/panel/    Side panel UI (script list, editor, controls)
background.js                  Service worker: coordinates recording & playback
src/content/content.js         Injected per page; hosts the recorder + executor
src/core/commands.js           Command model + slop serialization
src/core/parser.js             Sloppy-script parser
src/core/labeler.js            Maps labels <-> DOM elements
src/core/recorder.js           Turns user actions into steps
src/core/executor.js           Runs one step against the page
src/core/storage.js            Local script storage (chrome.storage)
```

The side panel talks only to the background worker, which relays recorded steps
back to the panel and drives playback one command at a time (handling `go to`
navigations itself, then re-injecting the content script on the new page).

## Status / roadmap

This is the v1 end-to-end skeleton. Not yet implemented (planned for later):

- Sharing server / script wiki, accounts, and search.
- Scratch space / data-extraction tables and parameterized variables.
- Cross-frame and cross-window recording, and dialog automation.
- Chrome Web Store packaging.

## Credits

Original CoScripter was created at the IBM Almaden Research Center (led by Allen
Cypher), formerly known as **Koala** — hence the koala mascot. Licensed under the
Mozilla Public License.
