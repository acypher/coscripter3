// Recorder: watches user actions in the page and turns each one into a
// human-readable step, which it streams to the background worker. This is the
// modern counterpart of YULE + coscripter-command-generator.js.

import { Command, ACTIONS, TYPES } from "./commands.js";
import { describeClickTarget, describeChangeTarget } from "./labeler.js";

export class Recorder {
  constructor(emit) {
    // emit(slop: string) is called for every recorded step.
    this.emit = emit;
    this.active = false;
    this._onClick = this._handleClick.bind(this);
    this._onChange = this._handleChange.bind(this);
    this._lastSlop = null;
    this._lastTime = 0;
  }

  start() {
    if (this.active) return;
    this.active = true;
    // Capture phase so we still see the event even if the page stops propagation.
    document.addEventListener("click", this._onClick, true);
    document.addEventListener("change", this._onChange, true);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    document.removeEventListener("click", this._onClick, true);
    document.removeEventListener("change", this._onChange, true);
  }

  _record(command) {
    const slop = command.toSlop();
    const now = Date.now();
    // Drop exact duplicate steps fired in quick succession (e.g. change + click).
    if (slop === this._lastSlop && now - this._lastTime < 600) return;
    this._lastSlop = slop;
    this._lastTime = now;
    try {
      this.emit(slop);
    } catch (e) {
      // The background worker may be asleep; ignore and let it re-establish.
    }
  }

  _handleClick(event) {
    if (!this.active) return;
    const desc = describeClickTarget(event.target);
    if (!desc) return;
    // Checkboxes/radios also fire change; let the change handler own those so
    // we capture the resulting state, not just the click.
    if (desc.type === TYPES.CHECKBOX || desc.type === TYPES.RADIO) return;
    this._record(
      new Command({ action: desc.action, type: desc.type, label: desc.label })
    );
  }

  _handleChange(event) {
    if (!this.active) return;
    const desc = describeChangeTarget(event.target);
    if (!desc) return;
    if (desc.action === ACTIONS.ENTER) {
      if (!desc.value) return; // skip cleared fields
      this._record(
        new Command({ action: ACTIONS.ENTER, type: TYPES.TEXTBOX, label: desc.label, value: desc.value })
      );
    } else if (desc.action === ACTIONS.SELECT) {
      this._record(
        new Command({ action: ACTIONS.SELECT, type: TYPES.LISTBOX, label: desc.label, value: desc.value })
      );
    } else if (desc.action === ACTIONS.CLICK) {
      // checkbox / radio toggled
      this._record(
        new Command({ action: ACTIONS.CLICK, type: desc.type, label: desc.label })
      );
    }
  }
}
