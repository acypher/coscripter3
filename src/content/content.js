// Content-script bootstrap. Declared as a classic script in the manifest, so it
// cannot use static `import`. Instead it dynamically imports the ES modules in
// src/core (which are web-accessible) and wires them to runtime messages.
//
// Responsibilities:
//   - host the Recorder and the executor in the page
//   - answer PING so the background worker knows the page is ready
//   - execute one command on request and reply with the result
//   - on (re)load, tell the background worker it is ready so recording can resume
//     across navigations

(() => {
  if (window.__coscripterContentLoaded) return;
  window.__coscripterContentLoaded = true;

  const base = chrome.runtime.getURL("src/core/");
  const ready = (async () => {
    const [recorderMod, executorMod, commandsMod] = await Promise.all([
      import(base + "recorder.js"),
      import(base + "executor.js"),
      import(base + "commands.js"),
    ]);
    const recorder = new recorderMod.Recorder((slop) => {
      chrome.runtime.sendMessage({ type: "RECORDED_STEP", step: slop });
    });
    return { recorder, execute: executorMod.execute, Command: commandsMod.Command };
  })();

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;

    if (msg.type === "PING") {
      sendResponse({ ok: true });
      return; // synchronous
    }

    if (msg.type === "START_REC") {
      ready.then(({ recorder }) => recorder.start());
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "STOP_REC") {
      ready.then(({ recorder }) => recorder.stop());
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "EXECUTE") {
      ready
        .then(({ execute, Command }) => {
          const cmd = new Command(msg.command);
          const result = execute(cmd);
          sendResponse(result);
        })
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true; // async response
    }
  });

  // Let the background worker know we are alive (used to resume recording after
  // navigation, and as a readiness signal).
  ready.then(() => {
    try {
      chrome.runtime.sendMessage({ type: "CONTENT_READY" });
    } catch (e) {
      /* worker may be asleep */
    }
  });
})();
