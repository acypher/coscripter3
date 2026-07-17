// Custom per-line script editor: Dot gutter | prefix (* / -) | editable text.

/**
 * @typedef {{ prefix: string, text: string }} ScriptLine
 */

/**
 * @param {object} opts
 * @param {HTMLElement} opts.root
 * @param {(lineIndex: number) => void} [opts.onSetCurrent]
 * @param {(lineIndex: number) => void} [opts.onChange]
 * @param {() => void} [opts.onTextEdit]
 */
export function initScriptEditor({ root, onSetCurrent, onChange, onTextEdit }) {
  /** @type {ScriptLine[]} */
  let lines = [{ prefix: "*", text: "" }];
  let currentIndex = 0;
  /** @type {"green" | "red" | "" | null} */
  let dotKind = null;
  let menuEl = null;
  let menuLineIndex = -1;

  function parseLines(text) {
    const raw = String(text || "").split(/\r?\n/);
    if (raw.length === 1 && raw[0] === "") {
      return [{ prefix: "*", text: "" }];
    }
    return raw.map((line) => normalizeLine(line));
  }

  function normalizeLine(line) {
    const star = line.match(/^\s*(\*+)\s*(.*)$/);
    if (star) return { prefix: star[1], text: star[2] };
    const dash = line.match(/^\s*-\s?(.*)$/);
    if (dash) return { prefix: "-", text: dash[1] };
    const trimmed = line.trim();
    if (!trimmed) return { prefix: "-", text: "" };
    return { prefix: "-", text: trimmed };
  }

  function serializeLine(line) {
    const body = line.text == null ? "" : String(line.text);
    if (body === "") return line.prefix;
    return `${line.prefix} ${body}`;
  }

  function getText() {
    return lines.map(serializeLine).join("\n");
  }

  function setText(text) {
    lines = parseLines(text);
    if (lines.length === 0) lines = [{ prefix: "*", text: "" }];
    if (currentIndex >= lines.length) currentIndex = Math.max(0, lines.length - 1);
    render();
  }

  function getLine(i) {
    return lines[i] || null;
  }

  function getLines() {
    return lines.slice();
  }

  function lineCount() {
    return lines.length;
  }

  function getCurrentIndex() {
    return currentIndex;
  }

  function indentOf(prefix) {
    if (!prefix || prefix === "-") return 0;
    const m = String(prefix).match(/^\*+$/);
    return m ? m[0].length : 0;
  }

  function prefixChoicesFor(lineIndex) {
    const prev = lineIndex > 0 ? lines[lineIndex - 1] : null;
    const prevIndent = prev ? indentOf(prev.prefix) : 0;
    const maxStars = Math.max(1, prevIndent + 1);
    const choices = [];
    for (let n = 1; n <= maxStars; n++) choices.push("*".repeat(n));
    choices.push("-");
    return choices;
  }

  function closeMenu() {
    if (menuEl) {
      menuEl.remove();
      menuEl = null;
    }
    menuLineIndex = -1;
  }

  function openPrefixMenu(lineIndex, anchorEl) {
    closeMenu();
    menuLineIndex = lineIndex;
    const choices = prefixChoicesFor(lineIndex);
    menuEl = document.createElement("div");
    menuEl.className = "cs-prefix-menu";
    menuEl.setAttribute("role", "listbox");
    for (const choice of choices) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cs-prefix-menu-item";
      btn.textContent = choice;
      if (choice === lines[lineIndex].prefix) btn.classList.add("selected");
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        lines[lineIndex] = { ...lines[lineIndex], prefix: choice };
        closeMenu();
        setCurrent(lineIndex, { openMenu: false });
        render();
        onChange?.(lineIndex);
      });
      menuEl.appendChild(btn);
    }
    const wrap = root.closest(".cs-editor-wrap") || root;
    wrap.appendChild(menuEl);
    const ar = anchorEl.getBoundingClientRect();
    const wr = wrap.getBoundingClientRect();
    menuEl.style.left = `${ar.left - wr.left}px`;
    menuEl.style.top = `${ar.bottom - wr.top + 2}px`;
  }

  function setDot(kind) {
    dotKind = kind === "green" || kind === "red" ? kind : null;
    const slots = root.querySelectorAll(".cs-dot-slot");
    slots.forEach((slot, i) => {
      slot.className = "cs-dot-slot";
      slot.innerHTML = "";
      if (i === currentIndex && dotKind) {
        slot.classList.add(dotKind);
        const span = document.createElement("span");
        span.className = `cs-match-dot ${dotKind}`;
        slot.appendChild(span);
      }
    });
  }

  function clearDot() {
    setDot(null);
  }

  function setCurrent(lineIndex, { openMenu = false, menuAnchor = null, notify = true } = {}) {
    const i = Math.max(0, Math.min(lineIndex, lines.length - 1));
    const changed = i !== currentIndex;
    currentIndex = i;
    if (changed || openMenu) {
      render({ skipFocus: true });
    } else {
      root.querySelectorAll(".cs-script-line").forEach((el, idx) => {
        el.classList.toggle("cs-cc", idx === currentIndex);
      });
      if (dotKind) setDot(dotKind);
    }
    if (notify) onSetCurrent?.(currentIndex);
    if (openMenu) {
      const prefixEl =
        root.querySelector(`.cs-script-line[data-line="${currentIndex}"] .cs-prefix`) ||
        menuAnchor;
      if (prefixEl) openPrefixMenu(currentIndex, prefixEl);
    }
  }

  function appendStep(slop) {
    const text = String(slop || "").trim();
    const last = lines[lines.length - 1];
    const isBlankStar =
      lines.length === 1 && last.prefix === "*" && last.text === "";
    if (isBlankStar) {
      lines[0] = { prefix: "*", text };
    } else {
      lines.push({ prefix: "*", text });
    }
    render();
    scrollLineIntoView(lines.length - 1);
    onChange?.(lines.length - 1);
  }

  function scrollLineIntoView(lineIndex) {
    const el = root.querySelector(`.cs-script-line[data-line="${lineIndex}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }

  function updateLineText(lineIndex, text) {
    if (!lines[lineIndex]) return;
    // contenteditable may insert newlines; collapse to single line for now
    const cleaned = String(text).replace(/\r?\n/g, " ");
    if (lines[lineIndex].text === cleaned) return;
    lines[lineIndex] = { ...lines[lineIndex], text: cleaned };
    onTextEdit?.();
    onChange?.(lineIndex);
  }

  function render({ skipFocus = false } = {}) {
    closeMenu();
    const frag = document.createDocumentFragment();
    lines.forEach((line, i) => {
      const row = document.createElement("div");
      row.className = "cs-script-line" + (i === currentIndex ? " cs-cc" : "");
      row.dataset.line = String(i);

      const dot = document.createElement("span");
      dot.className = "cs-dot-slot";
      if (i === currentIndex && dotKind) {
        dot.classList.add(dotKind);
        const span = document.createElement("span");
        span.className = `cs-match-dot ${dotKind}`;
        dot.appendChild(span);
      }
      dot.title = "Set current command";
      dot.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setCurrent(i);
      });

      const prefix = document.createElement("span");
      prefix.className = "cs-prefix";
      prefix.textContent = line.prefix;
      prefix.title = "Change indent / comment";
      prefix.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setCurrent(i, { openMenu: true, menuAnchor: prefix });
      });

      const text = document.createElement("span");
      text.className = "cs-text";
      text.contentEditable = "true";
      text.spellcheck = false;
      text.textContent = line.text;
      text.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        // Do not change CC
      });
      text.addEventListener("input", () => {
        updateLineText(i, text.textContent || "");
      });
      text.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          // Deferred (item 8): do not insert a new line yet
        }
      });
      text.addEventListener("paste", (e) => {
        e.preventDefault();
        const paste = (e.clipboardData || window.clipboardData).getData("text");
        const one = String(paste || "").replace(/\r?\n/g, " ");
        document.execCommand("insertText", false, one);
      });

      row.appendChild(dot);
      row.appendChild(prefix);
      row.appendChild(text);
      frag.appendChild(row);
    });
    root.replaceChildren(frag);
  }

  // Capture phase so we still see clicks even when row handlers stopPropagation.
  document.addEventListener(
    "mousedown",
    (e) => {
      if (!menuEl) return;
      if (menuEl.contains(e.target)) return;
      if (e.target.closest?.(".cs-prefix")) return;
      closeMenu();
    },
    true
  );

  document.addEventListener("keydown", (e) => {
    if (!menuEl) return;
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    closeMenu();
  });

  setText("");
  render();

  return {
    getText,
    setText,
    getLine,
    getLines,
    lineCount,
    getCurrentIndex,
    setCurrent,
    setDot,
    clearDot,
    appendStep,
    scrollLineIntoView,
    render,
    /** Expose for panel: serialize a line for runner/preview */
    serializeLine,
    isComment(lineIndex) {
      const line = lines[lineIndex];
      return !line || line.prefix === "-" || !String(line.text || "").trim();
    },
    isExecutable(lineIndex) {
      const line = lines[lineIndex];
      if (!line || line.prefix === "-") return false;
      return /^\*+$/.test(line.prefix) && !!String(line.text || "").trim();
    },
    nextExecutable(fromIndex = 0) {
      for (let i = Math.max(0, fromIndex); i < lines.length; i++) {
        if (this.isExecutable(i)) return i;
      }
      return -1;
    },
  };
}
