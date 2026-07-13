// Content-script bootstrap. Top frame handles execution; all frames can record.

(() => {
  if (window.__coscripterListener) {
    try {
      chrome.runtime.onMessage.removeListener(window.__coscripterListener);
    } catch (e) { /* invalidated context */ }
  }

  const isTop = window === window.top;
  const base = chrome.runtime.getURL("src/core/");

  const ready = (async () => {
    const [recorderMod, executorMod, commandsMod, labelerMod] = await Promise.all([
      import(base + "recorder.js"),
      import(base + "executor.js"),
      import(base + "commands.js"),
      import(base + "labeler.js"),
    ]);
    const recorder = new recorderMod.Recorder(
      (slop) => {
        chrome.runtime.sendMessage({ type: "RECORDED_STEP", step: slop });
      },
      (url) => {
        chrome.runtime.sendMessage({ type: "RECORDED_HISTORY", url });
      }
    );
    return {
      recorder,
      execute: executorMod.execute,
      checkCondition: executorMod.checkCondition,
      preview: executorMod.preview,
      Command: commandsMod.Command,
      elementExists: labelerMod.elementExists,
      readElementValue: labelerMod.readElementValue,
    };
  })();

  const listener = (msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;

    if (msg.type === "PING") {
      sendResponse({ ok: true, top: isTop });
      return;
    }

    if (msg.type === "START_REC") {
      ready.then(({ recorder }) => recorder.start(msg.pdbEntries || []));
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "STOP_REC") {
      ready.then(({ recorder }) => recorder.stop());
      sendResponse({ ok: true });
      return;
    }

    if (!isTop) return;

    if (msg.type === "EXECUTE") {
      ready
        .then(({ execute, Command }) => execute(new Command(msg.command)))
        .then((result) => sendResponse(result))
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }

    if (msg.type === "CHECK") {
      ready
        .then(({ checkCondition, Command }) => {
          sendResponse({ ok: checkCondition(new Command(msg.command)) });
        })
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (msg.type === "PREVIEW") {
      ready
        .then(({ preview, Command }) => sendResponse(preview(new Command(msg.command))))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (msg.type === "READ_VALUE") {
      ready
        .then(({ readElementValue, Command }) => {
          const value = readElementValue(new Command(msg.command), document);
          sendResponse({ ok: value != null, value: value ?? "" });
        })
        .catch(() => sendResponse({ ok: false, value: "" }));
      return true;
    }
  };

  window.__coscripterListener = listener;
  chrome.runtime.onMessage.addListener(listener);

  ready.then(() => {
    try {
      chrome.runtime.sendMessage({ type: "CONTENT_READY" });
    } catch (e) { /* worker asleep */ }
  });
})();
