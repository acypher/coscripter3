// Parser for the CoScripter "sloppy" script language (ClearScript subset).
//
// Strict patterns are tried first; if none match, a forgiving fallback parser
// handles the original v1 syntax so existing scripts keep working.

import { Command, ACTIONS, TYPES, NAME_FILTERS } from "./commands.js";

const ORDINALS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

const ORDINAL_RE = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))\b/i;
const FILTER_RE = /whose name (?:starts with|contains|ends with)\s+"[^"]*"/i;

// Leading verb phrases, stripped before deriving an unquoted label.
const VERB_RE = /^\s*(?:double-?click|shift-?click|control-?click|click(?:\s+on)?|press|choose|mouseover(?:\s+over)?|turn\s+(?:on|off)|expand|collapse|toggle|copy|clip|paste(?:\s+into)?|wait\s+until|verify(?:\s+that)?|assert(?:\s+that)?|if|there\s+is(?:\s+an?)?|enter|type|put|append|select|pick|close|switch\s+to|open|find|search\s+for)\b/i;

const TYPE_WORDS_RE = /\b(?:radio button|radio|check ?box|text ?box|text ?area|input field|list ?box|drop[- ]?down|menu item|menu|button|link|textarea|input|field|box|list|tab|section|item|element|video|player|image|icon)\b/gi;

const STOP_WORDS_RE = /\b(?:the|a|an|on|into|in|to|from|that|there|is|are|it|your|appears?|exists?)\b/gi;

export function getSlop(line) {
  const star = line.match(/^\s*(\*+)\s*(.*)$/);
  if (star) return [star[1].length, star[2].trim()];
  // Leading "-" marks an explicit comment (does nothing).
  const dash = line.match(/^\s*-\s?(.*)$/);
  if (dash) return [0, dash[1].trim()];
  return [0, line.trim()];
}

function norm(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function stripQuoted(text) {
  return text.replace(/"[^"]*"/g, " ");
}

function extractQuoted(text) {
  const out = [];
  const re = /"([^"]*)"/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

// Ordinals and type words are only meaningful OUTSIDE quoted labels, so
// callers pass text with quoted segments stripped.
function parseOrdinal(strippedText) {
  const m = strippedText.match(ORDINAL_RE);
  if (!m) return 0;
  const w = m[1].toLowerCase();
  if (ORDINALS[w]) return ORDINALS[w];
  const n = parseInt(w, 10);
  return Number.isFinite(n) ? n : 0;
}

function parseNameFilter(text) {
  let m = text.match(/whose name starts with "([^"]*)"/i);
  if (m) return { type: NAME_FILTERS.STARTS_WITH, value: m[1] };
  m = text.match(/whose name contains "([^"]*)"/i);
  if (m) return { type: NAME_FILTERS.CONTAINS, value: m[1] };
  m = text.match(/whose name ends with "([^"]*)"/i);
  if (m) return { type: NAME_FILTERS.ENDS_WITH, value: m[1] };
  return null;
}

function detectType(strippedText) {
  const s = strippedText.toLowerCase();
  if (/\bradio\b/.test(s)) return TYPES.RADIO;
  if (/\bcheck\s?box\b/.test(s)) return TYPES.CHECKBOX;
  if (/\blink\b/.test(s)) return TYPES.LINK;
  if (/\blistbox\b|\blist\b|\bdrop[- ]?down\b/.test(s)) return TYPES.LISTBOX;
  if (/\btextbox\b|\btext box\b|\btext ?area\b|\binput field\b|\bfield\b/.test(s)) return TYPES.TEXTBOX;
  if (/\btab\b/.test(s)) return TYPES.TAB;
  if (/\bsection\b/.test(s)) return TYPES.SECTION;
  if (/\bmenu item\b/.test(s)) return TYPES.MENU_ITEM;
  if (/\bmenu\b/.test(s)) return TYPES.MENU;
  if (/\bitem\b/.test(s)) return TYPES.ITEM;
  if (/\bbutton\b|\bvideo\b|\bplayer\b/.test(s)) return TYPES.BUTTON;
  return TYPES.ELEMENT;
}

function parseYourRef(text) {
  const m = text.match(/\byour\s+"([^"]*)"/i);
  return m ? m[1] : "";
}

function ordinalToNumber(word) {
  if (!word) return 0;
  const w = word.toLowerCase();
  if (ORDINALS[w]) return ORDINALS[w];
  const n = parseInt(w, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse "Address" column / first column / column 3 / number 4 column.
 * Returns { label, number, isPersonal } or null.
 */
function parseAxisSpec(part, axis) {
  const t = norm(part);
  if (!t) return null;
  const axisWord = axis === "column" ? "column" : "row";

  let m = t.match(new RegExp(`^(?:the\\s+)?your\\s+"([^"]*)"\\s+${axisWord}$`, "i"));
  if (m) return { label: m[1], number: 0, isPersonal: true };

  m = t.match(new RegExp(`^(?:the\\s+)?"([^"]*)"\\s+${axisWord}$`, "i"));
  if (m) return { label: m[1], number: 0, isPersonal: false };

  m = t.match(new RegExp(
    `^(?:the\\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\\d+(?:st|nd|rd|th))\\s+${axisWord}$`,
    "i"
  ));
  if (m) return { label: "", number: ordinalToNumber(m[1]), isPersonal: false };

  m = t.match(new RegExp(`^(?:the\\s+)?number\\s+(\\d+)\\s+${axisWord}$`, "i"));
  if (m) return { label: "", number: parseInt(m[1], 10), isPersonal: false };

  m = t.match(new RegExp(`^(?:the\\s+)?${axisWord}\\s+(\\d+)$`, "i"));
  if (m) return { label: "", number: parseInt(m[1], 10), isPersonal: false };

  return null;
}

/**
 * Parse a scratchtable cell reference, e.g.
 *   the cell in the "Address" column of row 2 of the "Homes" scratchtable
 *   the cell in column 3 of row 1 of the scratchtable
 *   the cell in the first column of the second row of the scratchtable
 *
 * Returns a cellRef object or null.
 */
export function parseCellRef(text) {
  if (!text || !/\bcell\b/i.test(text) || !/\bscratch\s*(?:table|space)\b/i.test(text)) {
    return null;
  }

  // Split: cell in/at <col> of <row> of [name] scratchtable
  const m = text.match(
    /(?:the\s+)?cell\s+(?:at|in)\s+(.+?)\s+of\s+(.+?)\s+of\s+(?:the\s+)?(?:(your\s+"[^"]*"|\"[^\"]*\")\s+)?(?:scratch\s*table|scratch\s*space)\b/i
  );
  if (!m) return null;

  const col = parseAxisSpec(m[1], "column");
  const row = parseAxisSpec(m[2], "row");
  if (!col || !row) return null;
  if (!col.label && !col.number) return null;
  if (!row.label && !row.number) return null;

  let tableName = "";
  let tableIsPersonal = false;
  if (m[3]) {
    const personal = m[3].match(/^your\s+"([^"]*)"$/i);
    if (personal) {
      tableName = personal[1];
      tableIsPersonal = true;
    } else {
      const quoted = m[3].match(/^"([^"]*)"$/);
      tableName = quoted ? quoted[1] : norm(m[3]);
    }
  }

  return {
    columnLabel: col.label,
    columnNumber: col.number,
    columnIsPersonal: col.isPersonal,
    rowLabel: row.label,
    rowNumber: row.number,
    rowIsPersonal: row.isPersonal,
    tableName,
    tableIsPersonal,
  };
}

function parseXPath(text) {
  let m = text.match(/\bx"([^"]*)"/i);
  if (m) return m[1];
  m = text.match(/\bx'([^']*)'/i);
  if (m) return m[1];
  return "";
}

function parseCompareSide(text) {
  const trimmed = norm(text);
  if (!trimmed) {
    return { value: "", isPersonal: false, key: "", isTarget: false };
  }
  const cellRef = parseCellRef(trimmed);
  if (cellRef) {
    return {
      value: "",
      isPersonal: false,
      key: "",
      isTarget: false,
      isCellRef: true,
      cellRef,
    };
  }
  const personalKey = parseYourRef(trimmed);
  if (personalKey) {
    return { value: personalKey, isPersonal: true, key: personalKey, isTarget: false };
  }
  if (/^the\b/i.test(trimmed)) {
    const t = parseTarget(trimmed);
    return {
      label: t.label,
      type: t.type,
      ordinal: t.ordinal,
      nameFilter: t.nameFilter,
      labelIsPersonal: t.labelIsPersonal,
      personalKey: t.personalKey,
      cellRef: t.cellRef || null,
      value: "",
      isPersonal: false,
      key: "",
      isTarget: true,
    };
  }
  const quoted = extractQuoted(trimmed);
  if (quoted.length) {
    return { value: quoted[0], isPersonal: false, key: "", isTarget: false };
  }
  return { value: trimmed, isPersonal: false, key: "", isTarget: false };
}

function parseIfCondition(slop) {
  const rest = slop.replace(/^if\s+/i, "").trim();
  const lower = rest.toLowerCase();

  if (!/^there\s+is\b/i.test(lower)) {
    const compPatterns = [
      { re: /^(.+?)\s+(?:does\s+not\s+contain|doesn't\s+contain)\s+(.+)$/i, op: "contains", negate: true },
      { re: /^(.+?)\s+contains\s+(.+)$/i, op: "contains", negate: false },
      { re: /^(.+?)\s+(?:does\s+not\s+equal|doesn't\s+equal)\s+(.+)$/i, op: "equals", negate: true },
      { re: /^(.+?)\s+(?:equals?|=)\s+(.+)$/i, op: "equals", negate: false },
      { re: /^(.+?)\s+less\s+than\s+(.+)$/i, op: "less", negate: false },
      { re: /^(.+?)\s+greater\s+than\s+(.+)$/i, op: "greater", negate: false },
      { re: /^(.+?)\s+<\s+(.+)$/i, op: "less", negate: false },
      { re: /^(.+?)\s+>\s+(.+)$/i, op: "greater", negate: false },
    ];
    for (const { re, op, negate } of compPatterns) {
      const m = rest.match(re);
      if (m) {
        return {
          conditionType: "comparison",
          conditionPositive: !negate,
          compareOp: op,
          compareLeft: parseCompareSide(m[1]),
          compareRight: parseCompareSide(m[2]),
          condition: { type: "comparison", raw: rest, op, positive: !negate },
        };
      }
    }
  }

  if (/^there\s+is\b/i.test(lower)) {
    let body = rest.replace(/^there\s+is\s+/i, "");
    let positive = true;
    if (/^(?:no|not(?:\s+an?)?)\s+/i.test(body)) {
      positive = false;
      body = body.replace(/^(?:no|not(?:\s+an?)?)\s+/i, "");
    }

    if (/^(?:a\s+)?selection\b/i.test(body)) {
      return {
        conditionType: "selection",
        conditionPositive: positive,
        conditionSelection: true,
        condition: { type: "selection", raw: rest, positive },
      };
    }

    body = body.replace(/^(?:a|an)\s+/i, "");
    const xpath = parseXPath(body);
    if (xpath) {
      return {
        conditionType: "existence",
        conditionPositive: positive,
        xpath,
        label: "",
        type: TYPES.ELEMENT,
        condition: { type: "existence", raw: rest, positive },
      };
    }
    const t = parseTarget(body);
    return {
      conditionType: "existence",
      conditionPositive: positive,
      ...t,
      condition: { type: "existence", raw: rest, positive, ...t },
    };
  }

  const t = parseTarget(rest);
  return {
    conditionType: "existence",
    conditionPositive: true,
    ...t,
    condition: { type: "existence", raw: rest, positive: true, ...t },
  };
}

function parseClickFields(slop) {
  const xpath = parseXPath(slop);
  if (xpath) {
    return { label: "", type: TYPES.ELEMENT, ordinal: 0, nameFilter: null, labelIsPersonal: false, personalKey: "", xpath, cellRef: null };
  }
  return { ...parseTarget(slop), xpath: "" };
}

// Derive a label from unquoted words: strip the verb, ordinals, type words,
// filler words; what remains is the label ("click the search button" -> "search").
function unquotedLabel(text) {
  let t = stripQuoted(text.replace(FILTER_RE, " "));
  t = t.replace(VERB_RE, " ");
  t = t.replace(new RegExp(ORDINAL_RE.source, "gi"), " ");
  t = t.replace(TYPE_WORDS_RE, " ");
  t = t.replace(STOP_WORDS_RE, " ");
  return norm(t);
}

// Parse the target portion of a step ("the third "Search" button whose ...").
function parseTarget(text) {
  const cellRef = parseCellRef(text);
  if (cellRef) {
    return {
      label: "",
      type: TYPES.CELL,
      ordinal: 0,
      nameFilter: null,
      labelIsPersonal: false,
      personalKey: "",
      cellRef,
    };
  }
  const nameFilter = parseNameFilter(text);
  const noFilter = text.replace(FILTER_RE, " ");
  const stripped = stripQuoted(noFilter);
  const ordinal = parseOrdinal(stripped);
  const type = detectType(stripped);
  const personalKey = parseYourRef(noFilter);
  const quoted = extractQuoted(noFilter).filter((q) => q !== "");
  const labelIsPersonal = !!personalKey;
  let label = "";
  if (labelIsPersonal) {
    label = personalKey;
  } else if (quoted.length) {
    label = quoted[quoted.length - 1];
  } else {
    label = unquotedLabel(noFilter);
  }
  return { label, type, ordinal, nameFilter, labelIsPersonal, personalKey, cellRef: null };
}

// Replace quoted contents with same-length filler so regex indexes still map
// onto the original text but quoted words can't match keywords.
function maskQuoted(text) {
  return text.replace(/"[^"]*"/g, (m) => '"' + "x".repeat(m.length - 2) + '"');
}

// Split "enter X into Y" style steps into value text and target text.
// Skips the "in" inside "cell in …" so scratchtable cell values parse correctly.
function splitValueTarget(text, separatorRe) {
  const masked = maskQuoted(text);
  const flags = separatorRe.flags.includes("g") ? separatorRe.flags : `${separatorRe.flags}g`;
  const re = new RegExp(separatorRe.source, flags);
  let best = null;
  let m;
  while ((m = re.exec(masked)) !== null) {
    const before = masked.slice(0, m.index);
    if (/^in$/i.test(m[0].trim()) && /\bcell\s+$/i.test(before)) continue;
    best = m;
  }
  if (!best || best.index === undefined) return { valueText: text, targetText: "" };
  return {
    valueText: text.slice(0, best.index),
    targetText: text.slice(best.index + best[0].length),
  };
}

function parseValue(valueText, verbForPersonal) {
  const personalKey = parseYourRef(valueText);
  const valueIsPersonal =
    !!personalKey && new RegExp(`^\\s*${verbForPersonal}\\s+your\\b`, "i").test(valueText);
  if (valueIsPersonal) {
    return {
      value: personalKey,
      valueIsPersonal: true,
      personalKey,
      valueCellRef: null,
    };
  }

  const afterVerb = valueText.replace(new RegExp(`^\\s*(?:${verbForPersonal})\\s+`, "i"), "");
  const valueCellRef = parseCellRef(afterVerb);
  if (valueCellRef) {
    return {
      value: "",
      valueIsPersonal: false,
      personalKey: "",
      valueCellRef,
    };
  }

  const quoted = extractQuoted(valueText);
  return {
    value: quoted[0] ?? "",
    valueIsPersonal: false,
    personalKey: "",
    valueCellRef: null,
  };
}

function inputCommand(slop, indent, action, verbs, separatorRe, defaultType) {
  const { valueText, targetText } = splitValueTarget(slop, separatorRe);
  const v = parseValue(valueText, verbs);
  const t = targetText
    ? parseTarget(targetText)
    : { label: "", type: "", ordinal: 0, nameFilter: null, labelIsPersonal: false, personalKey: "", cellRef: null };
  const type = t.cellRef
    ? TYPES.CELL
    : (t.type && t.type !== TYPES.ELEMENT ? t.type : defaultType);
  return base(slop, indent, {
    action,
    value: v.value,
    valueIsPersonal: v.valueIsPersonal,
    personalKey: v.personalKey || t.personalKey || "",
    valueCellRef: v.valueCellRef || null,
    label: t.label,
    type,
    ordinal: t.ordinal,
    nameFilter: t.nameFilter,
    labelIsPersonal: t.labelIsPersonal,
    cellRef: t.cellRef || null,
  });
}

function base(slop, indent, fields) {
  return new Command({ ...fields, indent, raw: slop });
}

function parseStrict(slop, indent) {
  const lower = slop.toLowerCase();
  const strippedLower = stripQuoted(lower);

  // Mixed-initiative: "you …"
  if (/^you\b/i.test(slop)) {
    return base(slop, indent, { action: ACTIONS.YOU, raw: slop });
  }

  // Navigation
  if (/^go\s+back\b/i.test(lower)) return base(slop, indent, { action: ACTIONS.GO_BACK });
  if (/^go\s+forward\b/i.test(lower)) return base(slop, indent, { action: ACTIONS.GO_FORWARD });
  if (/^reload\b/i.test(lower)) return base(slop, indent, { action: ACTIONS.RELOAD });
  if (/^go\s+to\b/i.test(lower) || /^goto\b/i.test(lower)) {
    const personalKey = parseYourRef(slop);
    const quoted = extractQuoted(slop);
    let location = personalKey || quoted[0];
    if (location === undefined) {
      location = slop.replace(/^go\s+to\s*/i, "").replace(/^goto\s*/i, "").trim();
    }
    return base(slop, indent, {
      action: ACTIONS.GOTO,
      location,
      locationIsPersonal: !!personalKey,
      personalKey: personalKey || "",
    });
  }

  // Tabs (type words checked outside quoted labels)
  if (/^create\s+a\s+new\s+window\b/i.test(lower)) {
    return base(slop, indent, { action: ACTIONS.CREATE_WINDOW });
  }
  if (/^create\s+a\s+new\s+tab\b/i.test(lower)) {
    return base(slop, indent, { action: ACTIONS.CREATE_TAB });
  }
  if (/^close\s+the\b/i.test(lower) && /\btab\b/i.test(strippedLower)) {
    const t = parseTarget(slop);
    return base(slop, indent, { action: ACTIONS.CLOSE_TAB, ...t, type: TYPES.TAB });
  }
  if (/^switch\s+to\s+the\b/i.test(lower) && /\btab\b/i.test(strippedLower)) {
    const t = parseTarget(slop);
    return base(slop, indent, { action: ACTIONS.SWITCH_TAB, ...t, type: TYPES.TAB });
  }

  // Timing / control flow keywords
  if (/^pause\b/i.test(lower)) {
    const m = slop.match(/pause\s+(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)?/i);
    return base(slop, indent, { action: ACTIONS.PAUSE, seconds: m ? parseFloat(m[1]) : 1 });
  }
  if (/^wait\s+until\b/i.test(lower)) {
    if (/^wait\s+until\s+there\s+is\b/i.test(lower)) {
      const cond = parseIfCondition("if " + slop.replace(/^wait\s+until\s+/i, ""));
      return base(slop, indent, {
        action: ACTIONS.WAIT,
        ...cond,
        condition: { ...cond.condition, type: "wait" },
      });
    }
    const t = parseTarget(slop);
    return base(slop, indent, { action: ACTIONS.WAIT, ...t, condition: { type: "wait", raw: slop } });
  }
  if (/^verify\b|^assert\b/i.test(lower)) {
    if (/^(?:verify|assert)(?:\s+that)?\s+there\s+is\b/i.test(lower)) {
      const cond = parseIfCondition(slop.replace(/^(?:verify|assert)(?:\s+that)?\s+/i, "if "));
      return base(slop, indent, { action: ACTIONS.VERIFY, ...cond });
    }
    const t = parseClickFields(slop);
    return base(slop, indent, { action: ACTIONS.VERIFY, ...t });
  }
  if (/^if\b/i.test(lower)) {
    return base(slop, indent, { action: ACTIONS.IF, ...parseIfCondition(slop) });
  }
  if (/^else\b/i.test(lower)) return base(slop, indent, { action: ACTIONS.ELSE });
  if (/^begin\s+extraction\b/i.test(lower)) {
    return base(slop, indent, { action: ACTIONS.BEGIN_EXTRACTION });
  }
  if (/^end\s+extraction\b/i.test(lower)) {
    return base(slop, indent, { action: ACTIONS.END_EXTRACTION });
  }
  if (/^extract\b/i.test(lower)) {
    const append = /\band\s+append\b/i.test(lower);
    const quoted = extractQuoted(slop);
    const tableName = quoted[0] || "";
    return base(slop, indent, {
      action: ACTIONS.EXTRACT,
      extractOverwrite: !append,
      extractTableName: tableName,
      label: tableName,
    });
  }
  if (/^end\b/i.test(lower)) {
    const m = slop.match(/^end\s+(\w+)/i);
    return base(slop, indent, { action: ACTIONS.END, endType: m ? m[1].toLowerCase() : "" });
  }
  if (/^there\s+is\b/i.test(lower)) {
    const cond = parseIfCondition("if " + slop);
    return base(slop, indent, { action: ACTIONS.THERE_IS, ...cond });
  }
  if (/^find\s+next\b/i.test(lower)) {
    return base(slop, indent, { action: ACTIONS.FIND, findDirection: "next" });
  }
  if (/^find\s+previous\b/i.test(lower)) {
    return base(slop, indent, { action: ACTIONS.FIND, findDirection: "previous" });
  }
  if (/^find\b|^search\s+for\b/i.test(lower)) {
    const body = slop.replace(/^search\s+for\s+/i, "").replace(/^find\s+/i, "");
    const personalKey = parseYourRef(body);
    const quoted = extractQuoted(body);
    const term = personalKey || quoted[0] || norm(body);
    return base(slop, indent, {
      action: ACTIONS.FIND,
      findTerm: term,
      valueIsPersonal: !!personalKey,
      personalKey: personalKey || "",
      findDirection: "first",
    });
  }
  if (/^open\b/i.test(lower)) {
    const quoted = extractQuoted(slop);
    const personalKey = parseYourRef(slop);
    const location = personalKey || quoted[0] || "";
    return base(slop, indent, {
      action: ACTIONS.OPEN,
      location,
      locationIsPersonal: !!personalKey,
      personalKey: personalKey || "",
      openInWindow: /\bnew\s+window\b/i.test(lower),
      openInTab: /\bnew\s+tab\b/i.test(lower),
    });
  }
  if (/^repeat\b/i.test(lower)) {
    const counterKey = parseYourRef(slop);
    if (counterKey && /repeat\s+with/i.test(lower)) {
      return base(slop, indent, { action: ACTIONS.REPEAT, counterKey });
    }
    const m = slop.match(/repeat\s+(\d+)\s+times/i);
    if (m) {
      return base(slop, indent, { action: ACTIONS.REPEAT, repeatCount: parseInt(m[1], 10) });
    }
    // Bare "repeat" or "repeat over the "Name" scratchtable" → all rows.
    const over = slop.match(
      /repeat(?:\s+over\s+(?:the\s+)?(?:("([^"]*)")\s+)?)?(?:scratchtable|scratch\s*space)?\s*$/i
    );
    const tableName = over?.[2] || "";
    return base(slop, indent, {
      action: ACTIONS.REPEAT,
      repeatOverRows: true,
      repeatTableName: tableName,
    });
  }
  if (/^increment\b/i.test(lower)) {
    const m = slop.match(/by\s+(\d+)/i);
    const incrementBy = m ? parseInt(m[1], 10) : 1;
    const cellRef = parseCellRef(slop);
    if (cellRef) {
      return base(slop, indent, {
        action: ACTIONS.INCREMENT,
        cellRef,
        type: TYPES.CELL,
        incrementBy,
      });
    }
    const key = parseYourRef(slop) || extractQuoted(slop)[0] || "";
    return base(slop, indent, {
      action: ACTIONS.INCREMENT,
      personalKey: key,
      label: key,
      incrementBy,
    });
  }
  if (/^decrement\b/i.test(lower)) {
    const m = slop.match(/by\s+(\d+)/i);
    const incrementBy = m ? parseInt(m[1], 10) : 1;
    const cellRef = parseCellRef(slop);
    if (cellRef) {
      return base(slop, indent, {
        action: ACTIONS.DECREMENT,
        cellRef,
        type: TYPES.CELL,
        incrementBy,
      });
    }
    const key = parseYourRef(slop) || extractQuoted(slop)[0] || "";
    return base(slop, indent, {
      action: ACTIONS.DECREMENT,
      personalKey: key,
      label: key,
      incrementBy,
    });
  }

  // Mouse / click family
  if (/^control-?click\b/i.test(lower)) {
    const t = parseClickFields(slop);
    return base(slop, indent, { action: ACTIONS.CONTROL_CLICK, ...t, ctrlKey: true });
  }
  if (/^shift-?click\b/i.test(lower)) {
    const t = parseClickFields(slop);
    return base(slop, indent, { action: ACTIONS.CLICK, ...t, shiftKey: true });
  }
  if (/^double-?click\b/i.test(lower)) {
    const t = parseClickFields(slop);
    return base(slop, indent, { action: ACTIONS.DOUBLE_CLICK, ...t });
  }
  if (/^mouseover\b/i.test(lower)) {
    const t = parseClickFields(slop);
    return base(slop, indent, { action: ACTIONS.MOUSEOVER, ...t });
  }
  if (/^click\b|^press\b|^choose\b/i.test(lower)) {
    const t = parseClickFields(slop);
    return base(slop, indent, { action: ACTIONS.CLICK, ...t });
  }

  // Turn on/off
  if (/^turn\s+on\b/i.test(lower)) {
    const t = parseTarget(slop);
    if (!t.type || t.type === TYPES.ELEMENT) t.type = TYPES.CHECKBOX;
    return base(slop, indent, { action: ACTIONS.TURN_ON, ...t });
  }
  if (/^turn\s+off\b/i.test(lower)) {
    const t = parseTarget(slop);
    if (!t.type || t.type === TYPES.ELEMENT) t.type = TYPES.CHECKBOX;
    return base(slop, indent, { action: ACTIONS.TURN_OFF, ...t });
  }

  // Expand/collapse/toggle
  if (/^expand\b/i.test(lower)) {
    const t = parseTarget(slop);
    if (!t.type || t.type === TYPES.ELEMENT) t.type = TYPES.SECTION;
    return base(slop, indent, { action: ACTIONS.EXPAND, ...t });
  }
  if (/^collapse\b/i.test(lower)) {
    const t = parseTarget(slop);
    if (!t.type || t.type === TYPES.ELEMENT) t.type = TYPES.SECTION;
    return base(slop, indent, { action: ACTIONS.COLLAPSE, ...t });
  }
  if (/^toggle\b/i.test(lower)) {
    const t = parseTarget(slop);
    return base(slop, indent, { action: ACTIONS.TOGGLE, ...t });
  }

  // Clipboard
  if (/^copy\b/i.test(lower)) {
    const t = parseTarget(slop);
    return base(slop, indent, { action: ACTIONS.COPY, ...t });
  }
  if (/^paste\b/i.test(lower)) {
    const t = parseTarget(slop);
    return base(slop, indent, { action: ACTIONS.PASTE, ...t, type: t.type && t.type !== TYPES.ELEMENT ? t.type : TYPES.TEXTBOX });
  }
  if (/^clip\b/i.test(lower)) {
    const t = parseTarget(slop);
    return base(slop, indent, { action: ACTIONS.CLIP, ...t });
  }

  // Input
  if (/^enter\b|^type\b/i.test(lower)) {
    return inputCommand(slop, indent, ACTIONS.ENTER, "(?:enter|type)", /\b(?:into|in)\b/i, TYPES.TEXTBOX);
  }
  if (/^put\b/i.test(lower)) {
    return inputCommand(slop, indent, ACTIONS.PUT, "put", /\b(?:into|in)\b/i, TYPES.TEXTBOX);
  }
  if (/^append\b/i.test(lower)) {
    return inputCommand(slop, indent, ACTIONS.APPEND, "append", /\bto\b/i, TYPES.TEXTBOX);
  }
  if (/^select\b|^pick\b/i.test(lower)) {
    return inputCommand(slop, indent, ACTIONS.SELECT, "(?:select|pick)", /\bfrom\b/i, TYPES.LISTBOX);
  }

  return null;
}

function parseFallback(slop, indent) {
  const lower = slop.toLowerCase();
  const quoted = extractQuoted(slop);

  if (/^go\s+to\b/.test(lower) || /^goto\b/.test(lower)) {
    let url = quoted[0];
    if (url === undefined) {
      url = slop.replace(/^go\s+to\s*/i, "").replace(/^goto\s*/i, "").trim();
    }
    return base(slop, indent, { action: ACTIONS.GOTO, location: url });
  }
  if (/^click\b/.test(lower) || /^press\b/.test(lower) || /^choose\b/.test(lower)) {
    const type = detectType(stripQuoted(slop));
    return base(slop, indent, { action: ACTIONS.CLICK, label: quoted[0] || "", type });
  }
  if (/^enter\b/.test(lower) || /^type\b/.test(lower) || /^put\b/.test(lower)) {
    return base(slop, indent, {
      action: ACTIONS.ENTER,
      value: quoted[0] || "",
      label: quoted[1] || "",
      type: TYPES.TEXTBOX,
    });
  }
  if (/^select\b/.test(lower) || /^pick\b/.test(lower)) {
    return base(slop, indent, {
      action: ACTIONS.SELECT,
      value: quoted[0] || "",
      label: quoted[1] || "",
      type: TYPES.LISTBOX,
    });
  }
  return base(slop, indent, { action: ACTIONS.UNKNOWN });
}

export function parseLine(slop, indent = 1) {
  const trimmed = slop.trim();
  if (!trimmed) return base(slop, indent, { action: ACTIONS.COMMENT, raw: slop });
  return parseStrict(trimmed, indent) || parseFallback(trimmed, indent);
}

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
