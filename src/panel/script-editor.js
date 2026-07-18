// Custom per-line script editor: Dot gutter | prefix (* / -) | editable text.
//
// Item 8: Enter inserts a new line with the same prefix.
// Item 9: drag-select (purple); typing/Delete replaces selection; repair to valid script.
// Paste: multi-line clipboard text is collapsed to a single line.

/**
 * @typedef {{ prefix: string, text: string }} ScriptLine
 * @typedef {{ line: number, offset: number }} TextPos
 * @typedef {{ start: TextPos, end: TextPos }} TextRange
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

  /** @type {TextRange | null} custom multi-line selection (ordered) */
  let customSel = null;
  let dragAnchor = null;
  let dragging = false;

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
    customSel = null;
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

  function textEl(lineIndex) {
    return root.querySelector(`.cs-script-line[data-line="${lineIndex}"] .cs-text`);
  }

  function getCaretOffset(el) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
      return (el.textContent || "").length;
    }
    const range = sel.getRangeAt(0);
    const pre = range.cloneRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.endContainer, range.endOffset);
    return pre.toString().length;
  }

  function setCaret(el, offset) {
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel) return;
    const textNode = el.firstChild && el.firstChild.nodeType === Node.TEXT_NODE
      ? el.firstChild
      : el;
    const len = (el.textContent || "").length;
    const o = Math.max(0, Math.min(offset, len));
    const range = document.createRange();
    if (textNode.nodeType === Node.TEXT_NODE) {
      range.setStart(textNode, o);
      range.collapse(true);
    } else {
      range.selectNodeContents(el);
      range.collapse(o === 0);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function cmpPos(a, b) {
    if (a.line !== b.line) return a.line - b.line;
    return a.offset - b.offset;
  }

  function orderRange(a, b) {
    return cmpPos(a, b) <= 0 ? { start: a, end: b } : { start: b, end: a };
  }

  function clearCustomSel() {
    customSel = null;
    root.querySelectorAll(".cs-text.cs-sel-full, .cs-text .cs-sel-piece").forEach((el) => {
      // cleaned on render
    });
  }

  function syncLineFromDom(lineIndex) {
    const el = textEl(lineIndex);
    if (!el || !lines[lineIndex]) return;
    const cleaned = String(el.textContent || "").replace(/\r?\n/g, " ");
    if (lines[lineIndex].text !== cleaned) {
      lines[lineIndex] = { ...lines[lineIndex], text: cleaned };
      onTextEdit?.();
      onChange?.(lineIndex);
    }
  }

  function updateLineText(lineIndex, text) {
    if (!lines[lineIndex]) return;
    const cleaned = String(text).replace(/\r?\n/g, " ");
    if (lines[lineIndex].text === cleaned) return;
    lines[lineIndex] = { ...lines[lineIndex], text: cleaned };
    onTextEdit?.();
    onChange?.(lineIndex);
  }

  /** Ensure every line has a valid prefix; never leave the editor empty. */
  function repairScript() {
    if (lines.length === 0) {
      lines = [{ prefix: "*", text: "" }];
      return;
    }
    const fixed = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let prefix = line.prefix;
      let text = String(line.text || "").replace(/\r?\n/g, " ");
      if (!prefix || (prefix !== "-" && !/^\*+$/.test(prefix))) {
        const prev = fixed.length ? fixed[fixed.length - 1].prefix : "*";
        prefix = prev === "-" || /^\*+$/.test(prev) ? prev : "*";
      }
      fixed.push({ prefix, text });
    }
    lines = fixed.length ? fixed : [{ prefix: "*", text: "" }];
  }

  /**
   * Replace the ordered range [start, end) in text fields with `replacement`.
   * Merges lines when the selection spans newlines; keeps a valid prefix.
   */
  function replaceRange(start, end, replacement) {
    const s = orderRange(start, end).start;
    const e = orderRange(start, end).end;
    const insert = String(replacement || "").replace(/\r?\n/g, " ");

    if (s.line === e.line) {
      const line = lines[s.line];
      const t = line.text || "";
      const next = t.slice(0, s.offset) + insert + t.slice(e.offset);
      lines[s.line] = { ...line, text: next };
      repairScript();
      customSel = null;
      const focusLine = s.line;
      const focusOff = s.offset + insert.length;
      render();
      setCaret(textEl(focusLine), focusOff);
      onTextEdit?.();
      onChange?.(focusLine);
      return;
    }

    // Multi-line: keep prefix of first line; join leftover text into one or more lines.
    const first = lines[s.line];
    const last = lines[e.line];
    const head = (first.text || "").slice(0, s.offset);
    const tail = (last.text || "").slice(e.offset);
    const merged = head + insert + tail;
    const prefix = first.prefix;
    const before = lines.slice(0, s.line);
    const after = lines.slice(e.line + 1);
    lines = [...before, { prefix, text: merged }, ...after];
    repairScript();
    customSel = null;
    const focusLine = Math.min(s.line, lines.length - 1);
    const focusOff = head.length + insert.length;
    render();
    setCaret(textEl(focusLine), focusOff);
    onTextEdit?.();
    onChange?.(focusLine);
  }

  function hasCustomSelection() {
    return !!(customSel && cmpPos(customSel.start, customSel.end) !== 0);
  }

  /** Native selection within a single .cs-text, if any. */
  function getNativeTextRange() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const anchorEl = sel.anchorNode?.nodeType === Node.TEXT_NODE
      ? sel.anchorNode.parentElement
      : sel.anchorNode;
    const focusEl = sel.focusNode?.nodeType === Node.TEXT_NODE
      ? sel.focusNode.parentElement
      : sel.focusNode;
    const aText = anchorEl?.closest?.(".cs-text");
    const fText = focusEl?.closest?.(".cs-text");
    if (!aText || !fText || aText !== fText || !root.contains(aText)) return null;
    const line = parseInt(aText.closest(".cs-script-line")?.dataset.line || "-1", 10);
    if (line < 0) return null;
    const r = sel.getRangeAt(0);
    const pre = document.createRange();
    pre.selectNodeContents(aText);
    pre.setEnd(r.startContainer, r.startOffset);
    const startOff = pre.toString().length;
    pre.setEnd(r.endContainer, r.endOffset);
    const endOff = pre.toString().length;
    if (startOff === endOff) return null;
    return orderRange(
      { line, offset: Math.min(startOff, endOff) },
      { line, offset: Math.max(startOff, endOff) }
    );
  }

  function getActiveRange() {
    if (hasCustomSelection()) return customSel;
    return getNativeTextRange();
  }

  function posFromPoint(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el || !root.contains(el)) return null;
    const row = el.closest(".cs-script-line");
    if (!row) return null;
    const line = parseInt(row.dataset.line || "-1", 10);
    if (line < 0 || !lines[line]) return null;
    const text = row.querySelector(".cs-text");
    if (!text) return { line, offset: 0 };

    // Click on prefix/dot: treat as start or end of that line's text.
    if (!text.contains(el) && el !== text) {
      const rect = text.getBoundingClientRect();
      const offset = clientX < rect.left ? 0 : (lines[line].text || "").length;
      return { line, offset };
    }

    // Approximate offset from character rectangles.
    const content = lines[line].text || "";
    if (!content) return { line, offset: 0 };
    let best = content.length;
    let bestDist = Infinity;
    for (let i = 0; i <= content.length; i++) {
      const range = document.createRange();
      const node = text.firstChild && text.firstChild.nodeType === Node.TEXT_NODE
        ? text.firstChild
        : text;
      try {
        if (node.nodeType === Node.TEXT_NODE) {
          range.setStart(node, Math.min(i, node.length));
          range.setEnd(node, Math.min(i, node.length));
        } else {
          range.selectNodeContents(text);
          range.collapse(true);
        }
        const r = range.getBoundingClientRect();
        const cx = r.left || text.getBoundingClientRect().left;
        const cy = (r.top + r.bottom) / 2 || text.getBoundingClientRect().top;
        const d = Math.abs(cx - clientX) + Math.abs(cy - clientY) * 0.25;
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      } catch (_) {
        /* ignore */
      }
    }
    return { line, offset: best };
  }

  function applySelHighlights() {
    root.querySelectorAll(".cs-text").forEach((el) => {
      el.classList.remove("cs-sel-full");
      const line = parseInt(el.closest(".cs-script-line")?.dataset.line || "-1", 10);
      const raw = lines[line]?.text || "";
      // Reset content without destroying if no custom sel
      if (!hasCustomSelection()) {
        if (el.textContent !== raw) el.textContent = raw;
        return;
      }
      const { start, end } = customSel;
      if (line < start.line || line > end.line) {
        el.textContent = raw;
        el.classList.remove("cs-sel-full");
        return;
      }
      if (line > start.line && line < end.line) {
        el.textContent = "";
        const mark = document.createElement("span");
        mark.className = "cs-sel-piece";
        mark.textContent = raw || "\u00a0";
        el.appendChild(mark);
        return;
      }
      const from = line === start.line ? start.offset : 0;
      const to = line === end.line ? end.offset : raw.length;
      el.textContent = "";
      if (from > 0) el.appendChild(document.createTextNode(raw.slice(0, from)));
      if (to > from) {
        const mark = document.createElement("span");
        mark.className = "cs-sel-piece";
        mark.textContent = raw.slice(from, to) || "\u00a0";
        el.appendChild(mark);
      }
      if (to < raw.length) el.appendChild(document.createTextNode(raw.slice(to)));
    });
  }

  function insertLineAfter(lineIndex, caretInText) {
    syncLineFromDom(lineIndex);
    const line = lines[lineIndex];
    const t = line.text || "";
    const off = Math.max(0, Math.min(caretInText, t.length));
    const before = t.slice(0, off);
    const after = t.slice(off);
    lines[lineIndex] = { prefix: line.prefix, text: before };
    lines.splice(lineIndex + 1, 0, { prefix: line.prefix, text: after });
    customSel = null;
    repairScript();
    render();
    setCaret(textEl(lineIndex + 1), 0);
    onTextEdit?.();
    onChange?.(lineIndex + 1);
  }

  function normalizePaste(text) {
    return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, " ");
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
        customSel = null;
        setCurrent(i);
      });

      const prefix = document.createElement("span");
      prefix.className = "cs-prefix";
      prefix.textContent = line.prefix;
      prefix.title = "Change indent / comment";
      prefix.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        customSel = null;
        setCurrent(i, { openMenu: true, menuAnchor: prefix });
      });

      const text = document.createElement("span");
      text.className = "cs-text";
      text.contentEditable = "true";
      text.spellcheck = false;
      text.textContent = line.text;

      text.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        // Allow native caret; drag handling is on root for multi-line.
        if (e.detail >= 2) return; // double-click word select: leave to browser
        closeMenu();
      });

      text.addEventListener("input", () => {
        if (hasCustomSelection()) return;
        updateLineText(i, text.textContent || "");
      });

      text.addEventListener("keydown", (e) => {
        const range = getActiveRange();

        if (e.key === "Enter") {
          e.preventDefault();
          if (range) {
            replaceRange(range.start, range.end, "");
            const caretLine = Math.min(range.start.line, lines.length - 1);
            insertLineAfter(caretLine, getCaretOffset(textEl(caretLine)) || 0);
            return;
          }
          insertLineAfter(i, getCaretOffset(text));
          return;
        }

        if (range && (e.key === "Backspace" || e.key === "Delete")) {
          e.preventDefault();
          replaceRange(range.start, range.end, "");
          return;
        }

        if (range && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          replaceRange(range.start, range.end, e.key);
          return;
        }

        // Backspace at start of line: merge with previous (reasonable repair)
        if (e.key === "Backspace" && !range) {
          const off = getCaretOffset(text);
          if (off === 0 && i > 0) {
            e.preventDefault();
            syncLineFromDom(i);
            const prev = lines[i - 1];
            const cur = lines[i];
            const merged = (prev.text || "") + (cur.text || "");
            const focusOff = (prev.text || "").length;
            lines[i - 1] = { prefix: prev.prefix, text: merged };
            lines.splice(i, 1);
            repairScript();
            customSel = null;
            render();
            setCaret(textEl(i - 1), focusOff);
            onTextEdit?.();
            onChange?.(i - 1);
          }
        }
      });

      text.addEventListener("paste", (e) => {
        e.preventDefault();
        const paste = normalizePaste((e.clipboardData || window.clipboardData).getData("text"));
        const range = getActiveRange();
        if (range) {
          replaceRange(range.start, range.end, paste);
          return;
        }
        document.execCommand("insertText", false, paste);
        updateLineText(i, text.textContent || "");
      });

      row.appendChild(dot);
      row.appendChild(prefix);
      row.appendChild(text);
      frag.appendChild(row);
    });
    root.replaceChildren(frag);
    if (hasCustomSelection()) applySelHighlights();
  }

  // Multi-line drag selection across the editor.
  root.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest?.(".cs-prefix-menu")) return;
    if (e.target.closest?.(".cs-prefix") || e.target.closest?.(".cs-dot-slot")) return;
    const pos = posFromPoint(e.clientX, e.clientY);
    if (!pos) return;
    dragging = true;
    dragAnchor = pos;
    customSel = null;
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragging || !dragAnchor) return;
    const pos = posFromPoint(e.clientX, e.clientY);
    if (!pos) return;
    const next = orderRange(dragAnchor, pos);
    if (next.start.line !== next.end.line) {
      customSel = next;
      window.getSelection()?.removeAllRanges();
      applySelHighlights();
    } else {
      // Same line: leave native selection (styled via ::selection).
      customSel = null;
    }
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    dragAnchor = null;
  });

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
