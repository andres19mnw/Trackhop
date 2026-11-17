// /wrapped: the page around listening.js. The export is read here, in the browser; this script
// makes no request and stores nothing but the tab last chosen (localStorage, on this device).
import { readExport } from './listening.js';
import { strings, fmt, num, el, message, tabs, dropArea, progress } from './ui.js';
import { drawCard, cardBlob } from './card.js';

const T = strings.wrapped;
const root = document.getElementById('wrapped-tool');
const $ = (sel) => root.querySelector(sel);
const drop = $('.tool-drop'), error = $('.tool-error'), results = $('.tool-results');
const bar = progress($('.tool-progress'));
const story = $('.tool-story'), square = document.createElement('canvas');
const ACCEPT = { spotify: '.zip,.json,application/zip,application/json', apple: '.csv,.zip,text/csv,application/zip', youtube: '.json,.zip,application/json,application/zip' };

let source = 'spotify', stats = null, busy = false, drawn = 0;
const urls = { story: null, square: null };

function setSource(value) {
  source = value;
  $('.tool-drop-title').textContent = T.sources[source].drop;
  $('.tool-drop-how').textContent = T.sources[source].how;
  drop.querySelector('input').accept = ACCEPT[source];
  try { localStorage.setItem('toolsWrappedSource', source); } catch (e) { /* private window */ }
}

const sourceTabs = tabs($('[data-tabs="source"]'), setSource);
let saved = null;
try { saved = localStorage.getItem('toolsWrappedSource'); } catch (e) { /* private window */ }
if (saved && T.sources[saved]) sourceTabs.choose(saved); else setSource('spotify');

const yearTabs = $('[data-tabs="year"]');
tabs(yearTabs, (value) => show(value === 'all' ? null : Number(value)));

const hourText = (h) => String(h).padStart(2, '0') + ':00';

function bars(box, rows) {
  box.replaceChildren();
  const max = Math.max(1, ...rows.map((r) => r.value));
  rows.forEach((r, i) => {
    const name = el('span', { class: 'nm', title: r.sub ? r.name + ' · ' + r.sub : r.name, text: r.name });
    if (r.sub) name.append(' ', el('small', { text: r.sub }));
    const b = el('span', { class: 'b' });
    b.style.width = Math.max(2, Math.round(r.value * 100 / max)) + '%';
    box.append(el('div', { class: 'tool-bar' }, el('span', { class: 'n', text: String(i + 1) }), name, el('span', { class: 'v', text: r.text }), b));
  });
}

function show(year) {
  const s = stats.summary(year);
  const fig = (name, value, on = true) => {
    const f = $('[data-fig="' + name + '"]');
    f.hidden = !on;
    f.querySelector('b').textContent = num(value);
  };
  fig('minutes', s.minutes, s.durations);
  fig('plays', s.plays);
  fig('songs', s.songs);
  fig('artists', s.artists, s.artists > 0);
  $('.tool-figs').style.gridTemplateColumns = '';
  const shown = root.querySelectorAll('.tool-fig:not([hidden])').length;
  if (shown < 4 && window.matchMedia('(min-width: 561px)').matches) $('.tool-figs').style.gridTemplateColumns = 'repeat(' + shown + ', 1fr)';

  const artists = $('[data-bars="artists"]');
  bars(artists, s.topArtists.map((a, i) => ({
    name: a.name, value: a.value,
    text: s.durations ? num(a.minutes) + (i === 0 ? ' ' + T.min : '') : i === 0 ? fmt(T.plays_n, { n: a.plays }).replace(String(a.plays), num(a.plays)) : num(a.plays),
  })));
  if (!s.topArtists.length) artists.append(el('p', { class: 'tool-muted', text: T.no_artists }));
  bars($('[data-bars="songs"]'), s.topSongs.map((t, i) => ({
    name: t.title, sub: t.artist, value: t.plays,
    text: i === 0 ? plays(t.plays) : num(t.plays),
  })));

  const clock = $('.tool-clock');
  const peak = Math.max(1, ...s.hours);
  clock.replaceChildren(...s.hours.map((v, h) => {
    const i = el('i', { class: h === s.loudestHour ? 'top' : null, title: hourText(h) });
    i.style.height = Math.max(2, Math.round(v * 100 / peak)) + '%';
    return i;
  }));
  const loudest = s.loudestHour >= 0 ? hourText(s.loudestHour) : '';
  clock.setAttribute('aria-label', fmt(T.hours_label, { hour: loudest }));
  $('.tool-loudest').textContent = [
    loudest ? fmt(T.loudest, { hour: loudest }) : '',
    s.topSong ? fmt(T.top_song, { title: s.topSong.title, plays: plays(s.topSong.plays) }) : '',
  ].filter(Boolean).join(' ');

  cards(s);
}

const plays = (n) => fmt(T.plays_n, { n }).replace(String(n), num(n));

async function cards(s) {
  const label = s.year == null ? T.card_all : fmt(T.card_year, { year: s.year });
  const t = {
    label,
    big: num(s.durations ? s.minutes : s.plays),
    unit: s.durations ? T.minutes : T.plays,
    sub: [num(s.songs) + ' ' + T.songs, s.artists ? num(s.artists) + ' ' + T.artists : ''].filter(Boolean).join(' · '),
    topArtists: T.card_top_artists,
    topSong: T.card_top_song,
    song: s.topSong ? s.topSong.title + (s.topSong.artist ? ' · ' + s.topSong.artist : '') : '',
  };
  story.setAttribute('role', 'img');
  story.setAttribute('aria-label', [label, t.big + ' ' + t.unit, ...s.topArtists.map((a, i) => (i + 1) + ' ' + a.name)].join(', '));
  drawCard(story, s, t, false);
  drawCard(square, s, t, true);
  const mine = ++drawn;
  const name = String(s.year == null ? 'all' : s.year);
  for (const [kind, canvas, file] of [['story', story, T.file_story], ['square', square, T.file_square]]) {
    const link = $('[data-save="' + kind + '"]');
    link.removeAttribute('href');
    link.setAttribute('aria-disabled', 'true');
    const blob = await cardBlob(canvas);
    if (mine !== drawn) return; // another year was chosen meanwhile
    if (urls[kind]) URL.revokeObjectURL(urls[kind]);
    urls[kind] = URL.createObjectURL(blob);
    link.href = urls[kind];
    link.download = fmt(file, { label: name });
    link.removeAttribute('aria-disabled');
  }
}

function showYears() {
  const years = stats.yearList();
  yearTabs.replaceChildren(
    ...years.map((y) => el('button', { type: 'button', role: 'tab', class: 'tool-tab', 'data-value': y, 'aria-selected': 'false', tabindex: '-1', text: String(y) })),
    el('button', { type: 'button', role: 'tab', class: 'tool-tab', 'data-value': 'all', 'aria-selected': 'false', tabindex: '-1', text: T.all }),
  );
  // The last year opens first: it is the one a Wrapped is about.
  const first = yearTabs.querySelector('[data-value="' + years[years.length - 1] + '"]');
  first.click();
}

async function read(files) {
  if (busy) return;
  busy = true;
  error.hidden = true;
  const name = files.length === 1 ? files[0].name : files[0].name + ' +' + (files.length - 1);
  const signal = bar.start(name);
  const from = source;
  try {
    const read = await readExport(from, files, { signal, onProgress: (done, total) => bar.update(done, total) });
    stats = read;
    results.hidden = false;
    showYears();
    results.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  } catch (e) {
    // Nothing half-read is shown: what was on the page before stays as it was.
    const text = message(e, name, T.sources[from].wrong);
    if (text) { error.textContent = text; error.hidden = false; }
  } finally {
    bar.stop();
    busy = false;
  }
}

dropArea(drop, read);
