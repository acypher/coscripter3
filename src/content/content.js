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
    const [recorderMod, executorMod, commandsMod, labelerMod, extractModeMod, extractionMod] =
      await Promise.all([
        import(base + "recorder.js"),
        import(base + "executor.js"),
        import(base + "commands.js"),
        import(base + "labeler.js"),
        import(base + "extract-mode.js"),
        import(base + "extraction.js"),
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
      clearPreview: executorMod.clearPreview,
      Command: commandsMod.Command,
      elementExists: labelerMod.elementExists,
      readElementValue: labelerMod.readElementValue,
      setClipboard: executorMod.setClipboard,
      getClipboard: executorMod.getClipboard,
      startExtractMode: extractModeMod.startExtractMode,
      stopExtractMode: extractModeMod.stopExtractMode,
      extractFromRecipe: extractionMod.extractFromRecipe,
      scrapeBestTable: extractionMod.scrapeBestTable,
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

    if (msg.type === "START_EXTRACT_MODE") {
      ready
        .then(({ startExtractMode, stopExtractMode }) => {
          stopExtractMode();
          startExtractMode({
            onDone: (result) => {
              chrome.runtime.sendMessage({ type: "EXTRACT_RESULT", ...result });
            },
            onCancel: () => {
              chrome.runtime.sendMessage({ type: "EXTRACT_CANCELLED" });
            },
          });
          sendResponse({ ok: true });
        })
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }

    if (msg.type === "STOP_EXTRACT_MODE") {
      ready
        .then(({ stopExtractMode }) => {
          stopExtractMode();
          sendResponse({ ok: true });
        })
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (msg.type === "EXTRACT_PAGE") {
      ready
        .then(({ extractFromRecipe, scrapeBestTable }) => {
          const scraped = msg.recipe
            ? extractFromRecipe(msg.recipe, document)
            : scrapeBestTable(document);
          if (!scraped || !scraped.rows?.length) {
            sendResponse({ ok: false, error: "No table data found on this page." });
            return;
          }
          sendResponse({
            ok: true,
            scraped,
            sourceUrl: location.href,
          });
        })
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }

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
        .catch(() => sendResponse({ ok: false, found: false }));
      return true;
    }

    if (msg.type === "CLEAR_PREVIEW") {
      ready
        .then(({ clearPreview }) => {
          clearPreview(document);
          sendResponse({ ok: true });
        })
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

    if (msg.type === "SET_CLIPBOARD") {
      ready
        .then(async ({ setClipboard }) => {
          await setClipboard(msg.text || "");
          sendResponse({ ok: true });
        })
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (msg.type === "GET_CLIPBOARD") {
      ready
        .then(async ({ getClipboard }) => {
          const text = await getClipboard();
          sendResponse({ ok: true, text: text || "" });
        })
        .catch(() => sendResponse({ ok: false, text: "" }));
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
