// What the two pages share: their texts, the drop area, the progress line, saving a file.
import { ToolError } from './io.js';

export const strings = JSON.parse(document.getElementById('tool-strings').textContent);

/** "{n} songs" with its values filled in. A pair of texts is one and many. */
export function fmt(text, values = {}) {
  if (Array.isArray(text)) text = values.n === 1 ? text[0] : text[1];
  return text.replace(/\{(\w+)\}/g, (m, k) => (values[k] != null ? String(values[k]) : m));
}

// Always grouped: Italian leaves four-digit numbers whole (9008 beside 53.704), which reads as a mistake in a row of figures.
const numbers = new Intl.NumberFormat(strings.lang, { useGrouping: 'always' });
export const num = (n) => numbers.format(n);

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}

/** What to tell the visitor about an error; null when they cancelled. */
export function message(error, name, wrong) {
  const code = error instanceof ToolError ? error.code : 'unreadable';
  if (code === 'cancelled') return null;
  if (!(error instanceof ToolError)) console.error(error);
  const text = code === 'wrong-file' && wrong ? wrong
    : code === 'too-big' ? strings.err_toobig
      : strings['err_' + code] || strings.err_unreadable;
  return fmt(text, { name });
}

/** A row of tabs (role=tablist): arrows, Home and End move, and onSelect gets the chosen value. */
export function tabs(list, onSelect) {
  const all = () => [...list.querySelectorAll('[role="tab"]')];
  const select = (tab, focus) => {
    for (const t of all()) {
      const on = t === tab;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
    }
    if (focus) tab.focus();
    onSelect(tab.dataset.value);
  };
  list.addEventListener('click', (e) => {
    const t = e.target.closest('[role="tab"]');
    if (t) select(t, false);
  });
  list.addEventListener('keydown', (e) => {
    const t = all(), i = t.indexOf(document.activeElement);
    if (i < 0) return;
    const to = e.key === 'ArrowRight' ? (i + 1) % t.length : e.key === 'ArrowLeft' ? (i + t.length - 1) % t.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? t.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    select(t[to], true);
  });
  return { choose: (value) => { const t = all().find((x) => x.dataset.value === value); if (t) select(t, false); } };
}

/** The drop area: files dropped on it or picked with its button go to onFiles. */
export function dropArea(area, onFiles) {
  const input = area.querySelector('input[type="file"]');
  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    if (files.length) onFiles(files);
  });
  const over = (on) => area.classList.toggle('over', on);
  area.addEventListener('dragover', (e) => { e.preventDefault(); over(true); });
  area.addEventListener('dragleave', () => over(false));
  area.addEventListener('drop', (e) => {
    e.preventDefault();
    over(false);
    const files = [...(e.dataTransfer ? e.dataTransfer.files : [])];
    if (files.length) onFiles(files);
  });
  // A file dropped beside the area would otherwise replace the page.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}

/** The progress line with its Cancel button. start(name) returns the signal that Cancel aborts. */
export function progress(box) {
  const text = box.querySelector('.tool-progress-text'), bar = box.querySelector('progress');
  let controller = null, last = -1, name = '';
  box.querySelector('.tool-cancel').addEventListener('click', () => { if (controller) controller.abort(); });
  const show = (pct) => {
    if (pct === last) return;
    last = pct;
    bar.value = pct / 100;
    text.textContent = fmt(strings.reading, { name, pct });
  };
  return {
    start(fileName) {
      controller = new AbortController();
      name = fileName; last = -1;
      show(0);
      box.hidden = false;
      return controller.signal;
    },
    update(done, total) { show(total > 0 ? Math.min(100, Math.floor(done * 100 / total)) : 0); },
    stop() { box.hidden = true; controller = null; },
  };
}

/** Hands a Blob to the visitor as a file to save: an object URL on a link, clicked, then let go. */
export function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function sizeText(bytes) {
  if (bytes >= 1 << 30) return num(Math.round(bytes / (1 << 30) * 10) / 10) + ' GB';
  if (bytes >= 1 << 20) return num(Math.round(bytes / (1 << 20))) + ' MB';
  if (bytes >= 1024) return num(Math.round(bytes / 1024)) + ' KB';
  return num(bytes) + ' B';
}
