// Parser for the CoScripter "sloppy" script language.
//
// The grammar is intentionally forgiving: we look at the leading verb and then
// pull out the quoted arguments, ignoring connector words like "the", "into",
// and "from". A line beginning with one or more "*" is an executable step; the
// number of stars is its indent level. Any other non-blank line is a comment.

import { Command, ACTIONS, TYPES } from "./commands.js";

// Split an editor line into [indent, slop]. Indent 0 means the line is a comment.
export function getSlop(line) {
  const m = line.match(/^\s*(\*+)\s+(.*)$/);
  if (m) {
    return [m[1].length, m[2].trim()];
  }
  return [0, line.trim()];
}

// Return every double-quoted substring in order.
function extractQuoted(text) {
  const out = [];
  const re = /"([^"]*)"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function detectClickType(slop) {
  const s = slop.toLowerCase();
  if (/\bradio\b/.test(s)) return TYPES.RADIO;
  if (/\bcheckbox\b/.test(s)) return TYPES.CHECKBOX;
  if (/\blink\b/.test(s)) return TYPES.LINK;
  if (/\bbutton\b/.test(s)) return TYPES.BUTTON;
  return TYPES.BUTTON;
}

// Parse a single step's slop text into a Command. Indent defaults to 1.
export function parseLine(slop, indent = 1) {
  const trimmed = slop.trim();
  const lower = trimmed.toLowerCase();
  const quoted = extractQuoted(trimmed);

  if (/^go\s+to\b/.test(lower) || /^goto\b/.test(lower)) {
    let url = quoted[0];
    if (url === undefined) {
      url = trimmed.replace(/^go\s+to\s*/i, "").replace(/^goto\s*/i, "").trim();
    }
    return new Command({ action: ACTIONS.GOTO, location: url, indent, raw: slop });
  }

  if (/^click\b/.test(lower) || /^press\b/.test(lower) || /^choose\b/.test(lower)) {
    const type = detectClickType(trimmed);
    return new Command({
      action: ACTIONS.CLICK,
      label: quoted[0] || "",
      type,
      indent,
      raw: slop,
    });
  }

  if (/^enter\b/.test(lower) || /^type\b/.test(lower) || /^put\b/.test(lower)) {
    // enter "value" into the "label" textbox
    const value = quoted[0] || "";
    const label = quoted[1] || "";
    return new Command({
      action: ACTIONS.ENTER,
      value,
      label,
      type: TYPES.TEXTBOX,
      indent,
      raw: slop,
    });
  }

  if (/^select\b/.test(lower) || /^pick\b/.test(lower)) {
    // select "value" from the "label" listbox
    const value = quoted[0] || "";
    const label = quoted[1] || "";
    return new Command({
      action: ACTIONS.SELECT,
      value,
      label,
      type: TYPES.LISTBOX,
      indent,
      raw: slop,
    });
  }

  return new Command({ action: ACTIONS.UNKNOWN, indent, raw: slop });
}

// Parse a whole script. Returns one Command per line so lineNumber maps directly
// to the textarea row (useful for highlighting). Blank lines and comments are
// included but are not executable.
export function parseScript(text) {
  const lines = text.split(/\r?\n/);
  const commands = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const [indent, slop] = getSlop(line);
    let cmd;
    if (slop === "" || indent === 0) {
      cmd = new Command({ action: ACTIONS.COMMENT, indent: 0, raw: line });
    } else {
      cmd = parseLine(slop, indent);
    }
    cmd.lineNumber = i;
    commands.push(cmd);
  }
  return commands;
}
