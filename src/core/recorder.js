// Recorder: watches user actions and turns them into human-readable steps.

import { Command, ACTIONS, TYPES, turnOnCommand, turnOffCommand, enterCommand } from "./commands.js";
import { clickTargetFromEvent, describeChangeTarget, isPasswordField, isMediaElement } from "./labeler.js";

export class Recorder {
  constructor(emit, emitHistory) {
    this.emit = emit;
    this.emitHistory = emitHistory || (() => {});
    this.active = false;
    this.pdbEntries = [];
    this._onClick = this._handleClick.bind(this);
    this._onChange = this._handleChange.bind(this);
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPopState = this._handlePopState.bind(this);
    this._onPageShow = this._handlePageShow.bind(this);
    this._lastSlop = null;
    this._lastTime = 0;
    this._recentVideoLabel = "";
  }

  setPersonalDB(entries) {
    this.pdbEntries = entries || [];
  }

  _inverseLookup(value) {
    const v = (value || "").trim();
    for (const e of this.pdbEntries) {
      if (e.value === v) return e.key;
    }
    return null;
  }

  start(pdbEntries) {
    if (pdbEntries) this.pdbEntries = pdbEntries;
    if (this.active) return;
    this.active = true;
    this._recentVideoLabel = "";
    document.addEventListener("click", this._onClick, true);
    document.addEventListener("pointerdown", this._onPointerDown, true);
    document.addEventListener("change", this._onChange, true);
    if (window === window.top) {
      window.addEventListener("popstate", this._onPopState);
      window.addEventListener("pageshow", this._onPageShow);
    }
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    document.removeEventListener("click", this._onClick, true);
    document.removeEventListener("pointerdown", this._onPointerDown, true);
    document.removeEventListener("change", this._onChange, true);
    if (window === window.top) {
      window.removeEventListener("popstate", this._onPopState);
      window.removeEventListener("pageshow", this._onPageShow);
    }
  }

  _emitHistoryNav() {
    try {
      this.emitHistory(location.href);
    } catch (e) { /* worker asleep */ }
  }

  _handlePopState() {
    if (!this.active) return;
    this._recentVideoLabel = "";
    this._emitHistoryNav();
  }

  _handlePageShow(event) {
    if (!this.active || !event.persisted) return;
    this._emitHistoryNav();
  }

  _record(command) {
    const slop = command.toSlop();
    const now = Date.now();
    if (slop === this._lastSlop && now - this._lastTime < 600) return;
    this._lastSlop = slop;
    this._lastTime = now;
    try {
      this.emit(slop);
    } catch (e) { /* worker asleep */ }
  }

  _recordClick(event, desc) {
    if (desc.type === TYPES.CHECKBOX || desc.type === TYPES.RADIO) return;
    if (desc.type === TYPES.LINK && desc.label) {
      this._recentVideoLabel = desc.label;
    }
    const cmd = new Command({
      action: event.ctrlKey || event.metaKey ? ACTIONS.CONTROL_CLICK : ACTIONS.CLICK,
      type: desc.type,
      label: desc.label,
      ctrlKey: !!(event.ctrlKey || event.metaKey),
    });
    this._record(cmd);
  }

  _handlePointerDown(event) {
    if (!this.active) return;
    const desc = clickTargetFromEvent(event, this._recentVideoLabel);
    if (!desc || !isMediaElement(desc.element)) return;
    this._recordClick(event, desc);
  }

  _handleClick(event) {
    if (!this.active) return;
    const desc = clickTargetFromEvent(event, this._recentVideoLabel);
    if (!desc) return;
    if (isMediaElement(desc.element)) return;
    this._recordClick(event, desc);
  }

  _handleChange(event) {
    if (!this.active) return;
    const target = event.target;
    const desc = describeChangeTarget(target);
    if (!desc) return;

    if (desc.action === ACTIONS.TURN_ON) {
      this._record(turnOnCommand(desc.label, desc.type));
      return;
    }
    if (desc.action === ACTIONS.TURN_OFF) {
      this._record(turnOffCommand(desc.label, desc.type));
      return;
    }

    if (desc.action === ACTIONS.ENTER) {
      if (!desc.value && !isPasswordField(target)) return;

      if (isPasswordField(target)) {
        const key = this._inverseLookup(desc.value) || "password";
        this._record(new Command({
          action: ACTIONS.ENTER,
          value: key,
          valueIsPersonal: true,
          personalKey: key,
          label: desc.label,
          type: TYPES.TEXTBOX,
        }));
        return;
      }

      const pdbKey = this._inverseLookup(desc.value);
      if (pdbKey) {
        this._record(new Command({
          action: ACTIONS.ENTER,
          value: pdbKey,
          valueIsPersonal: true,
          personalKey: pdbKey,
          label: desc.label,
          type: TYPES.TEXTBOX,
        }));
        return;
      }

      this._record(enterCommand(desc.value, desc.label, TYPES.TEXTBOX));
      return;
    }

    if (desc.action === ACTIONS.SELECT) {
      const pdbKey = this._inverseLookup(desc.value);
      if (pdbKey) {
        this._record(new Command({
          action: ACTIONS.SELECT,
          value: pdbKey,
          valueIsPersonal: true,
          personalKey: pdbKey,
          label: desc.label,
          type: TYPES.LISTBOX,
        }));
      } else {
        this._record(new Command({
          action: ACTIONS.SELECT,
          value: desc.value,
          label: desc.label,
          type: TYPES.LISTBOX,
        }));
      }
    }
  }
}
