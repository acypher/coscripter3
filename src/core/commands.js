// Command model shared by the parser, recorder, and executor.
//
// A CoScripter script is a list of human-readable steps ("slop"). Each step is
// one verb followed by one or two quoted arguments, in the spirit of the
// original "sloppy programming" approach: extra words are ignored, so the same
// command object round-trips to and from readable text.

export const ACTIONS = {
  GOTO: "goto",
  CLICK: "click",
  ENTER: "enter",
  SELECT: "select",
  COMMENT: "comment",
  UNKNOWN: "unknown",
};

// Target types as they appear in the slop ("the ... button", "the ... textbox").
export const TYPES = {
  BUTTON: "button",
  LINK: "link",
  TEXTBOX: "textbox",
  LISTBOX: "listbox",
  CHECKBOX: "checkbox",
  RADIO: "radio button",
  ELEMENT: "element",
};

export class Command {
  constructor({
    action = ACTIONS.UNKNOWN,
    label = "",
    type = "",
    value = "",
    location = "",
    indent = 1,
    lineNumber = 0,
    raw = "",
  } = {}) {
    this.action = action;
    this.label = label;
    this.type = type;
    this.value = value;
    this.location = location;
    this.indent = indent;
    this.lineNumber = lineNumber;
    this.raw = raw;
  }

  isExecutable() {
    return (
      this.action !== ACTIONS.COMMENT &&
      this.action !== ACTIONS.UNKNOWN
    );
  }

  // Render this command as a single human-readable step (without the leading bullet).
  toSlop() {
    switch (this.action) {
      case ACTIONS.GOTO:
        return `go to "${this.location}"`;
      case ACTIONS.CLICK:
        return `click the "${this.label}" ${this.type || TYPES.BUTTON}`;
      case ACTIONS.ENTER:
        return `enter "${this.value}" into the "${this.label}" ${this.type || TYPES.TEXTBOX}`;
      case ACTIONS.SELECT:
        return `select "${this.value}" from the "${this.label}" ${this.type || TYPES.LISTBOX}`;
      case ACTIONS.COMMENT:
      case ACTIONS.UNKNOWN:
      default:
        return this.raw;
    }
  }

  // Render as an editor line, including the bullet prefix for executable steps.
  toLine() {
    if (this.action === ACTIONS.COMMENT || this.action === ACTIONS.UNKNOWN) {
      return this.raw;
    }
    const stars = "*".repeat(Math.max(1, this.indent));
    return `${stars} ${this.toSlop()}`;
  }

  // A short label for status messages, e.g. 'click "Search"'.
  describe() {
    switch (this.action) {
      case ACTIONS.GOTO:
        return `go to ${this.location}`;
      case ACTIONS.CLICK:
        return `click "${this.label}"`;
      case ACTIONS.ENTER:
        return `enter "${this.value}" into "${this.label}"`;
      case ACTIONS.SELECT:
        return `select "${this.value}" from "${this.label}"`;
      default:
        return this.raw || "(comment)";
    }
  }
}

// Convenience factories used by the recorder.
export function gotoCommand(url) {
  return new Command({ action: ACTIONS.GOTO, location: url });
}

export function clickCommand(label, type = TYPES.BUTTON) {
  return new Command({ action: ACTIONS.CLICK, label, type });
}

export function enterCommand(value, label, type = TYPES.TEXTBOX) {
  return new Command({ action: ACTIONS.ENTER, value, label, type });
}

export function selectCommand(value, label, type = TYPES.LISTBOX) {
  return new Command({ action: ACTIONS.SELECT, value, label, type });
}
