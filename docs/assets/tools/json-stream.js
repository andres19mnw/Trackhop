// JSON read a piece at a time. Values are built as they close; the hooks decide what is kept, so
// a file of any size takes the memory of what the caller keeps from it, never of the whole text.
import { ToolError } from './io.js';

const MAX_PENDING = 32 << 20;
const NUMBER = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const NUMBER_CHARS = /[0-9.eE+-]/;
const WORDS = { t: ['true', true], f: ['false', false], n: ['null', null] };

/**
 * hooks.onArrayStart(frame, depth), hooks.onArrayItem(frame, value, depth) (return false not to keep
 * the value in the array) and hooks.onArrayEnd(frame, depth); depth 1 is the outermost container.
 * end() returns the root value and throws ToolError('incomplete') when the text stops before its
 * containers close, ToolError('unreadable') when it is not JSON. A trailing comma is let through.
 */
export class JsonStream {
  constructor(hooks = {}) {
    this.h = hooks;
    this.buf = '';
    this.stack = [];
    this.state = 'value';
    this.root = undefined;
    this.done = false;
  }

  push(chunk) {
    this.buf = this.buf ? this.buf + chunk : chunk;
    this.run(false);
  }

  end() {
    this.run(true);
    if (this.buf.trim().length) throw new ToolError(this.done ? 'unreadable' : 'incomplete');
    if (!this.done || this.stack.length) throw new ToolError('incomplete');
    return this.root;
  }

  bad(i) {
    throw new ToolError('unreadable', 'JSON: unexpected ' + JSON.stringify(this.buf.slice(i, i + 12)));
  }

  emit(value) {
    const top = this.stack[this.stack.length - 1];
    if (!top) { this.root = value; this.done = true; }
    else if (top.array) {
      const keep = this.h.onArrayItem ? this.h.onArrayItem(top, value, this.stack.length) : true;
      if (keep !== false) top.value.push(value);
    } else top.value[top.key] = value;
    this.state = 'after';
  }

  close(array, i) {
    const top = this.stack[this.stack.length - 1];
    if (!top || top.array !== array) this.bad(i);
    if (array && this.h.onArrayEnd) this.h.onArrayEnd(top, this.stack.length);
    this.stack.pop();
    this.emit(top.value);
  }

  // The string that opens at buf[i]; -1 when its end is not here yet.
  string(i) {
    const buf = this.buf;
    let j = i + 1;
    for (;;) {
      const k = buf.indexOf('"', j);
      if (k < 0) return -1;
      let b = k - 1;
      while (b > i && buf.charCodeAt(b) === 92) b--;
      if ((k - 1 - b) % 2 === 1) { j = k + 1; continue; }
      const raw = buf.slice(i + 1, k);
      if (raw.indexOf('\\') < 0) this.text = raw;
      else {
        try { this.text = JSON.parse('"' + raw.replace(/[\u0000-\u001f]/g, ' ') + '"'); } catch (e) { this.bad(i); }
      }
      return k + 1;
    }
  }

  run(final) {
    const buf = this.buf;
    const n = buf.length;
    let i = 0;
    for (;;) {
      let c = buf.charCodeAt(i);
      while (i < n && (c === 32 || c === 10 || c === 13 || c === 9 || c === 0xFEFF)) c = buf.charCodeAt(++i);
      if (i >= n) break;
      if (this.done && !this.stack.length) this.bad(i);
      const state = this.state;
      if (state === 'value') {
        if (c === 123) { this.stack.push({ array: false, value: {}, key: null }); this.state = 'key'; i++; }
        else if (c === 91) {
          const f = { array: true, value: [] };
          this.stack.push(f);
          if (this.h.onArrayStart) this.h.onArrayStart(f, this.stack.length);
          i++;
        }
        else if (c === 93) { this.close(true, i); i++; }
        else if (c === 34) {
          const e = this.string(i);
          if (e < 0) break;
          this.emit(this.text); i = e;
        }
        else if (c === 45 || (c >= 48 && c <= 57)) {
          // To the first character a number cannot hold; one that touches the end of this piece may go on in the next.
          let j = i + 1;
          while (j < n && NUMBER_CHARS.test(buf[j])) j++;
          if (j === n && !final) break;
          const text = buf.slice(i, j);
          if (!NUMBER.test(text)) this.bad(i);
          this.emit(Number(text)); i = j;
        }
        else {
          const w = WORDS[buf[i]];
          if (!w) this.bad(i);
          if (n - i < w[0].length) { if (final || !w[0].startsWith(buf.slice(i))) this.bad(i); break; }
          if (!buf.startsWith(w[0], i)) this.bad(i);
          this.emit(w[1]); i += w[0].length;
        }
      } else if (state === 'key') {
        if (c === 34) {
          const e = this.string(i);
          if (e < 0) break;
          this.stack[this.stack.length - 1].key = this.text; this.state = 'colon'; i = e;
        }
        else if (c === 125) { this.close(false, i); i++; }
        else this.bad(i);
      } else if (state === 'colon') {
        if (c !== 58) this.bad(i);
        this.state = 'value'; i++;
      } else {
        if (c === 44) { this.state = this.stack[this.stack.length - 1].array ? 'value' : 'key'; i++; }
        else if (c === 125) { this.close(false, i); i++; }
        else if (c === 93) { this.close(true, i); i++; }
        else this.bad(i);
      }
    }
    this.buf = i ? buf.slice(i) : buf;
    if (this.buf.length > MAX_PENDING) throw new ToolError('unreadable', 'JSON: a value too long');
  }
}
