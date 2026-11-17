// Reading a file a piece at a time, in the browser (and in node, for the tests).
// Nothing here sends anything anywhere: a File is read with Blob.slice, and that is all.

/** An error with a code the pages turn into a sentence: incomplete, unreadable, empty, wrong-file, cancelled. */
export class ToolError extends Error {
  constructor(code, detail) {
    super(detail ? code + ': ' + detail : code);
    this.code = code;
    this.detail = detail || '';
  }
}

export const CHUNK = 4 << 20;

/**
 * A copy of [s] that stands by itself. A piece cut out of a large text keeps the whole text in
 * memory for as long as the piece lives; what is kept from a file (a title, a name) is copied, so
 * the megabytes it was read from can go.
 */
export function own(s) {
  return s.length < 12 ? s : (' ' + s).slice(1);
}

export function check(signal) {
  if (signal && signal.aborted) throw new ToolError('cancelled');
}

/** The bytes of a Blob, [chunk] at a time. onBytes gets the size of each piece as it is read. */
export async function* blobBytes(blob, { signal, onBytes, chunk = CHUNK } = {}) {
  for (let at = 0; at < blob.size; at += chunk) {
    check(signal);
    let buf;
    try {
      buf = new Uint8Array(await blob.slice(at, at + chunk).arrayBuffer());
    } catch (e) {
      throw new ToolError('unreadable', String(e && e.message || e));
    }
    if (onBytes) onBytes(buf.length);
    yield buf;
  }
}

class BadUtf8 extends Error {}

/**
 * Bytes as text, as the app reads a picked file: UTF-8 (a BOM is dropped), UTF-16 with a BOM, and
 * with [fallback] the given encoding. Without a fallback, bytes that are not UTF-8 throw BadUtf8.
 */
export async function* decodeText(bytes, fallback) {
  let dec = null;
  for await (let b of bytes) {
    if (!dec) {
      if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) { dec = new TextDecoder('utf-8'); b = b.subarray(3); }
      else if (b[0] === 0xFF && b[1] === 0xFE) { dec = new TextDecoder('utf-16le'); b = b.subarray(2); }
      else if (b[0] === 0xFE && b[1] === 0xFF) { dec = new TextDecoder('utf-16be'); b = b.subarray(2); }
      else dec = fallback ? new TextDecoder(fallback) : new TextDecoder('utf-8', { fatal: true });
    }
    let s;
    try { s = dec.decode(b, { stream: true }); } catch (e) { throw new BadUtf8(); }
    if (s) yield s;
  }
  if (dec) {
    let s;
    try { s = dec.decode(); } catch (e) { throw new BadUtf8(); }
    if (s) yield s;
  }
}

/**
 * Feeds the text of a file to a sink ({ push(text), end() }) a piece at a time and returns what
 * end() gives. A file that is not UTF-8 is read again from the start as Windows-1252, what Windows
 * players write in a plain .m3u; makeBytes and makeSink are called again for that second reading.
 * With encodings ['utf-8'] the file is read once, a wrong byte becoming a replacement character.
 */
export async function streamText(makeBytes, makeSink, encodings = [null, 'windows-1252']) {
  for (const fallback of encodings) {
    const sink = makeSink();
    try {
      for await (const s of decodeText(makeBytes(), fallback)) sink.push(s);
      return sink.end();
    } catch (e) {
      if (e instanceof BadUtf8 && fallback !== encodings[encodings.length - 1]) continue;
      throw e;
    }
  }
}

/** The first bytes of a file as text, enough to tell its format. */
export async function headText(blob, bytes = 65536) {
  let b;
  try { b = new Uint8Array(await blob.slice(0, bytes).arrayBuffer()); } catch (e) { throw new ToolError('unreadable', String(e && e.message || e)); }
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));
  return new TextDecoder('utf-8').decode(b);
}

/** Text in, lines out (\n, \r\n or \r), whatever way the pieces are cut. */
export class Lines {
  constructor(onLine) { this.onLine = onLine; this.rest = ''; }
  push(s) {
    let buf = this.rest + s;
    let held = '';
    // A \r at the very end may be half of a \r\n: it waits for the next piece.
    if (buf.endsWith('\r')) { held = '\r'; buf = buf.slice(0, -1); }
    const parts = buf.split(/\r\n|\n|\r/);
    this.rest = parts.pop() + held;
    for (const p of parts) this.onLine(p);
  }
  end() {
    const r = this.rest.endsWith('\r') ? this.rest.slice(0, -1) : this.rest;
    this.rest = '';
    if (r.length) this.onLine(r);
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 of [bytes], continuing from [crc] (0 to start). */
export function crc32(bytes, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return ~c >>> 0;
}
