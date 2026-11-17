// A .zip read and written in the browser, without a library: the central directory is read from
// the end of the file, each entry is inflated with the browser's own DecompressionStream, and a
// new archive is written with the STORE method (no compression).
import { ToolError, blobBytes, check, crc32 } from './io.js';

const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);
const u64 = (v, o) => v.getUint32(o, true) + v.getUint32(o + 4, true) * 4294967296;

async function view(blob, from, to) {
  if (from < 0 || to > blob.size || from > to) throw new ToolError('incomplete', 'zip');
  try { return new DataView(await blob.slice(from, to).arrayBuffer()); } catch (e) { throw new ToolError('unreadable', String(e && e.message || e)); }
}

/** True when the file starts like a zip archive. */
export async function isZip(blob) {
  if (blob.size < 4) return false;
  const v = await view(blob, 0, 4);
  return u32(v, 0) === 0x04034b50 || u32(v, 0) === 0x06054b50;
}

/**
 * The entries of a zip: [{ name, method, crc, csize, size, offset, encrypted }]. An archive cut
 * short has no directory at its end: ToolError('incomplete').
 */
export async function zipEntries(blob) {
  const tailFrom = Math.max(0, blob.size - 65557);
  const tail = await view(blob, tailFrom, blob.size);
  let at = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { at = i; break; }
  if (at < 0) throw new ToolError('incomplete', 'zip');
  let count = u16(tail, at + 10), cdSize = u32(tail, at + 12), cdOffset = u32(tail, at + 16);
  if (count === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) {
    // ZIP64: a locator just before the end record points at the larger one.
    const loc = at - 20;
    if (loc < 0 || u32(tail, loc) !== 0x07064b50) throw new ToolError('unreadable', 'zip64');
    const z = await view(blob, u64(tail, loc + 8), u64(tail, loc + 8) + 56);
    if (u32(z, 0) !== 0x06064b50) throw new ToolError('unreadable', 'zip64');
    count = u64(z, 32); cdSize = u64(z, 40); cdOffset = u64(z, 48);
  }
  const cd = await view(blob, cdOffset, cdOffset + cdSize);
  const bytes = new Uint8Array(cd.buffer);
  const utf8 = new TextDecoder('utf-8');
  const entries = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.byteLength || u32(cd, p) !== 0x02014b50) throw new ToolError('unreadable', 'zip directory');
    const flags = u16(cd, p + 8), nameLen = u16(cd, p + 28), extraLen = u16(cd, p + 30), commentLen = u16(cd, p + 32);
    const e = {
      name: utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen)),
      method: u16(cd, p + 10), crc: u32(cd, p + 16), csize: u32(cd, p + 20), size: u32(cd, p + 24), offset: u32(cd, p + 42),
      encrypted: (flags & 1) === 1,
    };
    // ZIP64 extra field: the sizes and the offset that did not fit in 32 bits, in this order.
    let x = p + 46 + nameLen;
    const xEnd = x + extraLen;
    while (x + 4 <= xEnd) {
      const id = u16(cd, x), len = u16(cd, x + 2);
      if (id === 1) {
        let q = x + 4;
        if (e.size === 0xFFFFFFFF) { e.size = u64(cd, q); q += 8; }
        if (e.csize === 0xFFFFFFFF) { e.csize = u64(cd, q); q += 8; }
        if (e.offset === 0xFFFFFFFF) { e.offset = u64(cd, q); }
      }
      x += 4 + len;
    }
    entries.push(e);
    p = xEnd + commentLen;
  }
  return entries;
}

/** The bytes of one entry, inflated a piece at a time; its CRC and size are checked at the end. */
export async function* entryBytes(blob, entry, { signal, onBytes } = {}) {
  if (entry.encrypted) throw new ToolError('unreadable', 'encrypted zip');
  if (entry.method !== 0 && entry.method !== 8) throw new ToolError('unreadable', 'zip method ' + entry.method);
  const local = await view(blob, entry.offset, entry.offset + 30);
  if (u32(local, 0) !== 0x04034b50) throw new ToolError('unreadable', 'zip entry');
  const start = entry.offset + 30 + u16(local, 26) + u16(local, 28);
  if (start + entry.csize > blob.size) throw new ToolError('incomplete', 'zip');
  const packed = blob.slice(start, start + entry.csize);
  let crc = 0, total = 0;
  const seen = (b) => { crc = crc32(b, crc); total += b.length; if (onBytes) onBytes(b.length); };
  if (entry.method === 0) {
    for await (const b of blobBytes(packed, { signal })) { seen(b); yield b; }
  } else {
    if (typeof DecompressionStream === 'undefined') throw new ToolError('unsupported', 'DecompressionStream');
    const reader = packed.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    try {
      for (;;) {
        check(signal);
        let r;
        try { r = await reader.read(); } catch (e) { throw new ToolError('unreadable', 'zip data'); }
        if (r.done) break;
        seen(r.value);
        yield r.value;
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  }
  if (total !== entry.size || crc !== entry.crc) throw new ToolError('unreadable', 'zip checksum');
}

/**
 * A new archive from [{ name, data: Uint8Array }], stored without compression: the parts of a Blob.
 * Names are written as UTF-8; two files of one name get " (2)", " (3)" before the extension.
 */
export function zipParts(files, now = new Date()) {
  const enc = new TextEncoder();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [], central = [];
  const used = new Set();
  let offset = 0;
  for (const f of files) {
    let name = f.name;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const dot = f.name.lastIndexOf('.');
      name = dot > 0 ? f.name.slice(0, dot) + ' (' + n + ')' + f.name.slice(dot) : f.name + ' (' + n + ')';
    }
    used.add(name.toLowerCase());
    const nameBytes = enc.encode(name);
    const size = f.data.length;
    if (size > 0xFFFFFFFE || offset > 0xFFFFFFFE) throw new ToolError('too-big');
    const crc = crc32(f.data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true);
    head.setUint16(8, 0, true); head.setUint16(10, time, true); head.setUint16(12, date, true);
    head.setUint32(14, crc, true); head.setUint32(18, size, true); head.setUint32(22, size, true);
    head.setUint16(26, nameBytes.length, true); head.setUint16(28, 0, true);
    parts.push(new Uint8Array(head.buffer), nameBytes, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true); c.setUint16(12, time, true); c.setUint16(14, date, true);
    c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true);
    c.setUint16(28, nameBytes.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), nameBytes);
    offset += 30 + nameBytes.length + size;
  }
  const cdSize = central.reduce((s, b) => s + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return [...parts, ...central, new Uint8Array(end.buffer)];
}
