// Command model shared by the parser, recorder, and executor.
//
// A CoScripter script is a list of human-readable steps ("slop"). Each step is
// one verb followed by quoted arguments, in the spirit of the original
// "sloppy programming" approach.

export const ACTIONS = {
  GOTO: "goto",
  GO_BACK: "go_back",
  GO_FORWARD: "go_forward",
  RELOAD: "reload",
  CLICK: "click",
  CONTROL_CLICK: "control_click",
  MOUSEOVER: "mouseover",
  ENTER: "enter",
  PUT: "put",
  APPEND: "append",
  SELECT: "select",
  TURN_ON: "turn_on",
  TURN_OFF: "turn_off",
  EXPAND: "expand",
  COLLAPSE: "collapse",
  TOGGLE: "toggle",
  COPY: "copy",
  PASTE: "paste",
  CLIP: "clip",
  PAUSE: "pause",
  WAIT: "wait",
  VERIFY: "verify",
  IF: "if",
  ELSE: "else",
  END: "end",
  THERE_IS: "there_is",
  REPEAT: "repeat",
  INCREMENT: "increment",
  DECREMENT: "decrement",
  SWITCH_TAB: "switch_tab",
  CREATE_TAB: "create_tab",
  CLOSE_TAB: "close_tab",
  YOU: "you",
  COMMENT: "comment",
  UNKNOWN: "unknown",
};

export const TYPES = {
  BUTTON: "button",
  LINK: "link",
  TEXTBOX: "textbox",
  LISTBOX: "listbox",
  CHECKBOX: "checkbox",
  RADIO: "radio button",
  TAB: "tab",
  SECTION: "section",
  MENU: "menu",
  MENU_ITEM: "menu item",
  ITEM: "item",
  ELEMENT: "element",
};

export const NAME_FILTERS = {
  STARTS_WITH: "starts_with",
  CONTAINS: "contains",
  ENDS_WITH: "ends_with",
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
    ordinal = 0,
    nameFilter = null,
    ctrlKey = false,
    shiftKey = false,
    seconds = 0,
    repeatCount = 0,
    counterKey = "",
    incrementBy = 1,
    condition = null,
    personalKey = "",
    valueIsPersonal = false,
    labelIsPersonal = false,
    locationIsPersonal = false,
    endType = "",
  } = {}) {
    this.action = action;
    this.label = label;
    this.type = type;
    this.value = value;
    this.location = location;
    this.indent = indent;
    this.lineNumber = lineNumber;
    this.raw = raw;
    this.ordinal = ordinal;
    this.nameFilter = nameFilter;
    this.ctrlKey = ctrlKey;
    this.shiftKey = shiftKey;
    this.seconds = seconds;
    this.repeatCount = repeatCount;
    this.counterKey = counterKey;
    this.incrementBy = incrementBy;
    this.condition = condition;
    this.personalKey = personalKey;
    this.valueIsPersonal = valueIsPersonal;
    this.labelIsPersonal = labelIsPersonal;
    this.locationIsPersonal = locationIsPersonal;
    this.endType = endType;
  }

  isExecutable() {
    return (
      this.action !== ACTIONS.COMMENT &&
      this.action !== ACTIONS.UNKNOWN &&
      this.action !== ACTIONS.ELSE &&
      this.action !== ACTIONS.END
    );
  }

  isStructural() {
    return (
      this.action === ACTIONS.IF ||
      this.action === ACTIONS.ELSE ||
      this.action === ACTIONS.END ||
      this.action === ACTIONS.REPEAT
    );
  }

  needsPage() {
    return ![
      ACTIONS.GOTO,
      ACTIONS.GO_BACK,
      ACTIONS.GO_FORWARD,
      ACTIONS.RELOAD,
      ACTIONS.PAUSE,
      ACTIONS.CREATE_TAB,
      ACTIONS.SWITCH_TAB,
      ACTIONS.CLOSE_TAB,
      ACTIONS.YOU,
      ACTIONS.INCREMENT,
      ACTIONS.DECREMENT,
      ACTIONS.COMMENT,
      ACTIONS.UNKNOWN,
      ACTIONS.IF,
      ACTIONS.ELSE,
      ACTIONS.END,
      ACTIONS.THERE_IS,
      ACTIONS.REPEAT,
    ].includes(this.action);
  }

  _ordinalWord() {
    if (!this.ordinal || this.ordinal < 1) return "";
    const words = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
    return words[this.ordinal] || `${this.ordinal}th`;
  }

  _nameFilterPhrase() {
    if (!this.nameFilter) return "";
    const v = this.nameFilter.value;
    switch (this.nameFilter.type) {
      case NAME_FILTERS.STARTS_WITH:
        return ` whose name starts with "${v}"`;
      case NAME_FILTERS.CONTAINS:
        return ` whose name contains "${v}"`;
      case NAME_FILTERS.ENDS_WITH:
        return ` whose name ends with "${v}"`;
      default:
        return "";
    }
  }

  _targetPhrase() {
    const ord = this._ordinalWord();
    const prefix = ord ? `the ${ord} ` : "the ";
    const labelPart = this.labelIsPersonal
      ? `your "${this.personalKey || this.label}"`
      : `"${this.label}"`;
    const filter = this._nameFilterPhrase();
    const typePart = this.type ? ` ${this.type}` : "";
    return `${prefix}${labelPart}${filter}${typePart}`;
  }

  toSlop() {
    switch (this.action) {
      case ACTIONS.GOTO:
        if (this.locationIsPersonal) {
          return `go to your "${this.personalKey || this.location}"`;
        }
        return `go to "${this.location}"`;
      case ACTIONS.GO_BACK:
        return "go back";
      case ACTIONS.GO_FORWARD:
        return "go forward";
      case ACTIONS.RELOAD:
        return "reload";
      case ACTIONS.CLICK:
        return `click ${this._targetPhrase()}`;
      case ACTIONS.CONTROL_CLICK:
        return `control-click ${this._targetPhrase()}`;
      case ACTIONS.MOUSEOVER:
        return `mouseover ${this._targetPhrase()}`;
      case ACTIONS.ENTER:
        if (this.valueIsPersonal) {
          return `enter your "${this.personalKey || this.value}" into ${this._targetPhrase()}`;
        }
        return `enter "${this.value}" into ${this._targetPhrase()}`;
      case ACTIONS.PUT:
        if (this.valueIsPersonal) {
          return `put your "${this.personalKey || this.value}" into ${this._targetPhrase()}`;
        }
        return `put "${this.value}" into ${this._targetPhrase()}`;
      case ACTIONS.APPEND:
        return `append "${this.value}" to ${this._targetPhrase()}`;
      case ACTIONS.SELECT:
        if (this.valueIsPersonal) {
          return `select your "${this.personalKey || this.value}" from ${this._targetPhrase()}`;
        }
        return `select "${this.value}" from ${this._targetPhrase()}`;
      case ACTIONS.TURN_ON:
        return `turn on ${this._targetPhrase()}`;
      case ACTIONS.TURN_OFF:
        return `turn off ${this._targetPhrase()}`;
      case ACTIONS.EXPAND:
        return `expand ${this._targetPhrase()}`;
      case ACTIONS.COLLAPSE:
        return `collapse ${this._targetPhrase()}`;
      case ACTIONS.TOGGLE:
        return `toggle ${this._targetPhrase()}`;
      case ACTIONS.COPY:
        return `copy ${this._targetPhrase()}`;
      case ACTIONS.PASTE:
        return `paste into ${this._targetPhrase()}`;
      case ACTIONS.CLIP:
        return `clip ${this._targetPhrase()}`;
      case ACTIONS.PAUSE:
        return `pause ${this.seconds} seconds`;
      case ACTIONS.WAIT:
        return `wait until ${this._targetPhrase()}`;
      case ACTIONS.VERIFY:
        return `verify that ${this._targetPhrase()}`;
      case ACTIONS.IF:
        return `if ${this.condition?.raw || this.raw.replace(/^if\s+/i, "")}`;
      case ACTIONS.ELSE:
        return "else";
      case ACTIONS.END:
        return this.endType ? `end ${this.endType}` : "end";
      case ACTIONS.THERE_IS:
        return `there is ${this._targetPhrase()}`;
      case ACTIONS.REPEAT:
        if (this.counterKey) {
          return `repeat with your "${this.counterKey}"`;
        }
        return `repeat ${this.repeatCount} times`;
      case ACTIONS.INCREMENT:
        return `increment your "${this.personalKey || this.label}" by ${this.incrementBy}`;
      case ACTIONS.DECREMENT:
        return `decrement your "${this.personalKey || this.label}" by ${this.incrementBy}`;
      case ACTIONS.SWITCH_TAB:
        return `switch to the "${this.label}" tab`;
      case ACTIONS.CREATE_TAB:
        return "create a new tab";
      case ACTIONS.CLOSE_TAB:
        return this.label ? `close the "${this.label}" tab` : "close the tab";
      case ACTIONS.YOU:
        return this.raw.replace(/^\*+\s*/, "");
      case ACTIONS.COMMENT:
      case ACTIONS.UNKNOWN:
      default:
        return this.raw;
    }
  }

  toLine() {
    if (this.action === ACTIONS.COMMENT || this.action === ACTIONS.UNKNOWN) {
      return this.raw;
    }
    const stars = "*".repeat(Math.max(1, this.indent));
    return `${stars} ${this.toSlop()}`;
  }

  describe() {
    const s = this.toSlop();
    return s.length > 60 ? s.slice(0, 57) + "…" : s;
  }
}

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

export function turnOnCommand(label, type = TYPES.CHECKBOX) {
  return new Command({ action: ACTIONS.TURN_ON, label, type });
}

export function turnOffCommand(label, type = TYPES.CHECKBOX) {
  return new Command({ action: ACTIONS.TURN_OFF, label, type });
}

export function switchTabCommand(title) {
  return new Command({ action: ACTIONS.SWITCH_TAB, label: title, type: TYPES.TAB });
}

export function createTabCommand() {
  return new Command({ action: ACTIONS.CREATE_TAB });
}

export function closeTabCommand(title) {
  return new Command({ action: ACTIONS.CLOSE_TAB, label: title, type: TYPES.TAB });
}
