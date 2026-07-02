// Script runner: a program counter with if/else/repeat control flow.
//
// The runner is pure (no chrome APIs) so it can be unit tested. The driver
// (background.js) repeatedly calls next(), which resolves comments, block
// markers, and finished repeat bodies, and returns the next significant step:
//   { type: "exec", cmd }          - run the command, then call advance()
//   { type: "if", cmd }            - evaluate the condition, then call branch(cmd, result)
//   { type: "repeat-counter", cmd }- check the counter, then call
//                                    enterCounterRepeat(cmd) or skipBlock(cmd)
//   null                           - script finished

import { parseScript } from "./parser.js";
import { ACTIONS } from "./commands.js";

function isComment(cmd) {
  return cmd.action === ACTIONS.COMMENT || cmd.action === ACTIONS.UNKNOWN;
}

export class ScriptRunner {
  constructor(commands) {
    this.commands = commands;
    this.pc = 0;
    this.repeatStack = [];
  }

  static fromText(text) {
    return new ScriptRunner(parseScript(text));
  }

  reset() {
    this.pc = 0;
    this.repeatStack = [];
  }

  get current() {
    return this.commands[this.pc] ?? null;
  }

  done() {
    return this.pc >= this.commands.length;
  }

  // First index after `fromIndex` that is outside the block opened at
  // `fromIndex` (i.e. a non-comment command with indent <= baseIndent).
  // Comment lines never terminate a block.
  findBlockEnd(fromIndex, baseIndent) {
    for (let i = fromIndex + 1; i < this.commands.length; i++) {
      const cmd = this.commands[i];
      if (isComment(cmd)) continue;
      if (cmd.indent <= baseIndent) return i;
    }
    return this.commands.length;
  }

  next() {
    for (;;) {
      // Loop or exit repeat bodies whose end we've walked past.
      if (this.repeatStack.length) {
        const frame = this.repeatStack[this.repeatStack.length - 1];
        if (this.pc >= frame.end) {
          this.repeatStack.pop();
          if (frame.counterKey) {
            // Re-check the counter by returning to the repeat line.
            this.pc = frame.repeatIndex;
            continue;
          }
          frame.remaining--;
          if (frame.remaining > 0) {
            this.repeatStack.push(frame);
            this.pc = frame.start;
          }
          continue;
        }
      }

      if (this.pc >= this.commands.length) return null;
      const cmd = this.commands[this.pc];

      if (isComment(cmd)) {
        this.pc++;
        continue;
      }

      // Reaching an ELSE naturally means the true-branch just ran: skip it.
      if (cmd.action === ACTIONS.ELSE) {
        this.pc = this.findBlockEnd(this.pc, cmd.indent);
        continue;
      }

      if (cmd.action === ACTIONS.END) {
        this.pc++;
        continue;
      }

      if (cmd.action === ACTIONS.REPEAT) {
        if (cmd.counterKey) return { type: "repeat-counter", cmd };
        if ((cmd.repeatCount || 0) < 1) {
          this.skipBlock(cmd);
          continue;
        }
        this.repeatStack.push({
          repeatIndex: this.pc,
          start: this.pc + 1,
          end: this.findBlockEnd(this.pc, cmd.indent),
          remaining: cmd.repeatCount,
          counterKey: "",
        });
        this.pc++;
        continue;
      }

      if (cmd.action === ACTIONS.IF) return { type: "if", cmd };

      return { type: "exec", cmd };
    }
  }

  // Called after evaluating an if condition.
  branch(cmd, conditionResult) {
    if (conditionResult) {
      this.pc++;
      return;
    }
    // Skip the body; land after an else (if present at the same indent).
    for (let i = this.pc + 1; i < this.commands.length; i++) {
      const c = this.commands[i];
      if (isComment(c)) continue;
      if (c.indent > cmd.indent) continue;
      if (c.action === ACTIONS.ELSE && c.indent === cmd.indent) {
        this.pc = i + 1;
        return;
      }
      this.pc = i;
      return;
    }
    this.pc = this.commands.length;
  }

  // Called for "repeat with your X" when the counter is still positive.
  enterCounterRepeat(cmd) {
    this.repeatStack.push({
      repeatIndex: this.pc,
      start: this.pc + 1,
      end: this.findBlockEnd(this.pc, cmd.indent),
      remaining: null,
      counterKey: cmd.counterKey,
    });
    this.pc++;
  }

  // Skip a structural command's whole block (repeat with exhausted counter).
  skipBlock(cmd) {
    this.pc = this.findBlockEnd(this.pc, cmd.indent);
  }

  advance() {
    this.pc++;
  }
}
