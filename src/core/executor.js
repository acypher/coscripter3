// Executor: runs a single command against the live page. The counterpart of
// coscripter-execution-engine.js. Navigation (go to) is handled by the
// background worker, not here, because it requires a tab-level reload.

import { ACTIONS, TYPES } from "./commands.js";
import { findElement } from "./labeler.js";

const HIGHLIGHT_CLASS = "__coscripter_highlight__";

function ensureHighlightStyle() {
  if (document.getElementById("__coscripter_style__")) return;
  const style = document.createElement("style");
  style.id = "__coscripter_style__";
  style.textContent = `.${HIGHLIGHT_CLASS}{outline:3px solid #ff5a36 !important;outline-offset:2px !important;transition:outline 0.1s;}`;
  (document.head || document.documentElement).appendChild(style);
}

function flash(el) {
  try {
    ensureHighlightStyle();
    el.classList.add(HIGHLIGHT_CLASS);
    setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), 700);
  } catch (e) {
    /* ignore */
  }
}

function fire(el, type) {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

function setNativeValue(el, value) {
  // React and other frameworks track the value via the property descriptor;
  // setting through the prototype setter makes the change "stick".
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  if (desc && desc.set) {
    desc.set.call(el, value);
  } else {
    el.value = value;
  }
}

// Execute one command. Returns { ok, error?, label? }.
export function execute(command) {
  const el = findElement(command);
  if (!el) {
    return {
      ok: false,
      error: `Could not find ${command.type || "element"} "${command.label || command.value}".`,
    };
  }

  try {
    el.scrollIntoView({ block: "center", inline: "center" });
  } catch (e) {
    /* ignore */
  }
  flash(el);

  switch (command.action) {
    case ACTIONS.CLICK: {
      if (command.type === TYPES.CHECKBOX || command.type === TYPES.RADIO) {
        // Click toggles; only click if needed to reach a checked state.
        if (!el.checked) {
          el.click();
        }
      } else {
        el.focus({ preventScroll: true });
        el.click();
      }
      return { ok: true };
    }

    case ACTIONS.ENTER: {
      el.focus({ preventScroll: true });
      if (el.isContentEditable) {
        el.textContent = command.value;
      } else {
        setNativeValue(el, command.value);
      }
      fire(el, "input");
      fire(el, "change");
      return { ok: true };
    }

    case ACTIONS.SELECT: {
      const target = (command.value || "").trim().toLowerCase();
      let matched = false;
      for (const opt of el.options) {
        const text = (opt.textContent || "").trim().toLowerCase();
        const val = (opt.value || "").trim().toLowerCase();
        if (text === target || val === target) {
          el.value = opt.value;
          matched = true;
          break;
        }
      }
      if (!matched) {
        // Fall back to a contains match.
        for (const opt of el.options) {
          const text = (opt.textContent || "").trim().toLowerCase();
          if (text.includes(target)) {
            el.value = opt.value;
            matched = true;
            break;
          }
        }
      }
      if (!matched) {
        return { ok: false, error: `No option "${command.value}" in list "${command.label}".` };
      }
      fire(el, "input");
      fire(el, "change");
      return { ok: true };
    }

    default:
      return { ok: false, error: `Cannot execute "${command.action}" in the page.` };
  }
}
