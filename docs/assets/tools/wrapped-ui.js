// /wrapped: the page around listening.js. The export is read here, in the browser; this script
// makes no request and stores nothing but the tab and the look last chosen (localStorage, on this device).
import { readExport, PARTS } from './listening.js';
import { strings, fmt, num, el, message, tabs, dropArea, progress, save } from './ui.js';
import { drawCard, cardBlob, LOOKS } from './card.js';

const T = strings.wrapped;
const root = document.getElementById('wrapped-tool');
const $ = (sel) => root.querySelector(sel);
const part = (name) => $('[data-t="' + name + '"]');
const empty = $('.wr-empty'), drop = $('.tool-drop'), error = $('.tool-error');
const loaded = $('.wr-loaded'), story = $('.wr-story'), another = $('[data-act="another"]');
const bar = progress($('.tool-progress'));
const cards = { story: $('[data-card="story"]'), square: $('[data-card="square"]') };
const ACCEPT = { spotify: '.zip,.json,application/zip,application/json', apple: '.csv,.zip,text/csv,application/zip', youtube: '.json,.zip,application/json,application/zip' };
const DAY_MS = 24 * 3600 * 1000;
const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let source = 'spotify', stats = null, shown = null, busy = false, look = 'beam', counting = 0;

// ---------------------------------------------------------------- words, numbers, dates

/** A text of tools.yml with its values: a pair is one and many (by n), numbers are written the reader's way. */
function say(text, values = {}) {
  if (Array.isArray(text)) text = values.n === 1 ? text[0] : text[1];
  return text.replace(/\{(\w+)\}/g, (m, k) => (values[k] == null ? m : typeof values[k] === 'number' ? num(values[k]) : String(values[k])));
}
/** The same as nodes, with what is between <b> and </b> in bold. Values are always put in as text. */
function rich(text, values = {}) {
  if (Array.isArray(text)) text = values.n === 1 ? text[0] : text[1];
  return text.split(/(<b>.*?<\/b>)/).filter(Boolean).map((piece) => {
    const bold = /^<b>(.*)<\/b>$/.exec(piece);
    return bold ? el('b', { text: say(bold[1], values) }) : document.createTextNode(say(piece, values));
  });
}
/** Sentences one after the other in [box]: each is a list of nodes, or a text. */
function fill(box, ...sentences) {
  box.replaceChildren();
  for (const s of sentences.filter(Boolean)) {
    if (box.childNodes.length) box.append(' ');
    box.append(...(typeof s === 'string' ? [s] : s));
  }
  box.hidden = !box.childNodes.length;
}
const cap = (s) => s.charAt(0).toLocaleUpperCase(strings.lang) + s.slice(1);

// Days are whole days of the listener's own calendar (listening.js): written as UTC so none moves.
const DATES = strings.lang === 'en' ? 'en-GB' : strings.lang;
const dateFmt = (opts) => { const f = new Intl.DateTimeFormat(DATES, { timeZone: 'UTC', ...opts }); return (day) => f.format(new Date(day * DAY_MS)); };
const dayText = dateFmt({ day: 'numeric', month: 'long' });
const dayYearText = dateFmt({ day: 'numeric', month: 'long', year: 'numeric' });
const weekdayDayText = dateFmt({ weekday: 'long', day: 'numeric', month: 'long' });
const weekdayDayYearText = dateFmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const monthFmt = (month) => new Intl.DateTimeFormat(DATES, { timeZone: 'UTC', month }).format;
const monthLong = monthFmt('long'), monthShort = monthFmt('short');
const monthName = (m, short) => (short ? monthShort : monthLong)(new Date(Date.UTC(2024, m, 1)));
const weekdayFmt = (weekday) => new Intl.DateTimeFormat(DATES, { timeZone: 'UTC', weekday }).format;
const weekdayLong = weekdayFmt('long'), weekdayShort = weekdayFmt('short');
// 1970-01-05 was a Monday.
const weekdayName = (i, short) => (short ? weekdayShort : weekdayLong)(new Date((4 + i) * DAY_MS));
const hourText = (h, minute = 0) => String(h).padStart(2, '0') + ':' + String(minute).padStart(2, '0');

const unit = (n, name) => new Intl.NumberFormat(strings.lang, { style: 'unit', unit: name, unitDisplay: 'long' }).format(n);
/** "29 days, 1 hour and 42 minutes": the largest [most] units of a number of minutes. */
function duration(minutes, most = 3) {
  const bits = [[Math.floor(minutes / 1440), 'day'], [Math.floor(minutes / 60) % 24, 'hour'], [minutes % 60, 'minute']];
  while (bits.length > 1 && !bits[0][0]) bits.shift();
  const said = bits.slice(0, most).filter((b) => b[0] > 0).map((b) => unit(b[0], b[1]));
  if (!said.length) return unit(0, 'minute');
  return said.length === 1 ? said[0] : said.slice(0, -1).join(', ') + ' ' + T.and + ' ' + said[said.length - 1];
}
const minutesText = (n) => say(T.minutes_n, { n });
const playsText = (n) => say(T.plays_n, { n });
/** How much of something: minutes where the export has them, plays where it does not. */
const amount = (s, f) => (s.durations ? minutesText(f.minutes) : playsText(f.plays));
const perDay = (minutes) => (minutes >= 60 ? say(T.hm, { h: Math.floor(minutes / 60), m: minutes % 60 }) : say(T.min_short, { n: minutes }));

// ---------------------------------------------------------------- where the file comes from

function setSource(value) {
  source = value;
  $('.tool-drop-title').textContent = T.sources[source].drop;
  $('.tool-drop-how').textContent = T.sources[source].how;
  drop.querySelector('input').accept = ACCEPT[source];
  try { localStorage.setItem('toolsWrappedSource', source); } catch (e) { /* private window */ }
}
const stored = (key) => { try { return localStorage.getItem(key); } catch (e) { return null; } };

const sourceTabs = tabs($('[data-tabs="source"]'), setSource);
if (T.sources[stored('toolsWrappedSource')]) sourceTabs.choose(stored('toolsWrappedSource')); else setSource('spotify');

const yearTabs = $('[data-tabs="year"]');
tabs(yearTabs, (value) => show(value === 'all' ? null : Number(value)));

// ---------------------------------------------------------------- the charts

/** A column chart as a list: every item says its own value in text, the bars are for the eye. */
function cols(box, rows) {
  const max = Math.max(...rows.map((r) => r.value));
  box.replaceChildren(...rows.map((r, i) => {
    const top = max > 0 && r.value === max;
    const bar = el('span', { class: 'bar', 'aria-hidden': 'true', title: r.long + ': ' + r.text });
    bar.style.height = Math.max(3, max > 0 ? r.value / max * 100 : 0) + '%';
    bar.style.setProperty('--i', i);
    return el('li', { class: top ? 'pk' : null },
      el('span', { class: 'wr-sr', text: r.long + ': ' + (top ? say(T.most, { text: r.text }) : r.text) }),
      top ? el('span', { class: 'val', 'aria-hidden': 'true', text: r.label }) : null,
      bar,
      el('span', { class: 'lab', 'aria-hidden': 'true', text: r.short }));
  }));
}

function rank(box, rows) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  box.replaceChildren(...rows.map((r, i) => {
    const name = el('span', { class: 'nm', text: r.name });
    if (r.sub) name.append(el('small', { text: r.sub }));
    const line = el('i');
    line.style.width = Math.max(2, Math.round(r.value * 100 / max)) + '%';
    line.style.setProperty('--i', i);
    return el('li', {}, el('span', { class: 'n', text: String(i + 1) }), name, el('span', { class: 'v', text: r.text }), el('span', { class: 'b', 'aria-hidden': 'true' }, line));
  }));
}

const NS = 'http://www.w3.org/2000/svg';
function sv(tag, attrs, text) {
  const e = document.createElementNS(NS, tag);
  for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
}
/** The listening clock: 24 spokes, midnight at the top, clockwise. Its numbers are in the table beside it. */
function dial(svg, s, hourAmount) {
  const title = svg.querySelector('title');
  title.textContent = say(s.durations ? T.dial_minutes : T.dial_plays, { hour: hourText(s.loudestHour) });
  const C = 160, R0 = 62, LEN = 72, peak = Math.max(1, ...s.hours);
  const at = (h, r) => { const a = (h / 24) * 2 * Math.PI - Math.PI / 2; return [(C + Math.cos(a) * r).toFixed(1), (C + Math.sin(a) * r).toFixed(1)]; };
  const out = [title, sv('circle', { class: 'ring', cx: C, cy: C, r: R0 - 8 })];
  s.hours.forEach((v, h) => {
    const len = Math.max(1.5, v / peak * LEN);
    const [x1, y1] = at(h, R0), [x2, y2] = at(h, R0 + len);
    const line = sv('line', { class: h === s.loudestHour ? 'h pk' : 'h', x1, y1, x2, y2, 'stroke-dasharray': (len + 1).toFixed(1) });
    line.style.setProperty('--len', (len + 1).toFixed(1));
    line.style.setProperty('--i', h);
    line.append(sv('title', {}, hourText(h) + ': ' + hourAmount(v)));
    out.push(line);
  });
  for (const h of [0, 6, 12, 18]) {
    if (h === s.loudestHour) continue;
    const [x, y] = at(h, 150);
    out.push(sv('text', { class: 'tick', x, y, 'aria-hidden': 'true' }, String(h).padStart(2, '0')));
  }
  const [x, y] = at(s.loudestHour, 150);
  out.push(sv('text', { class: 'peak', x, y, 'aria-hidden': 'true' }, String(s.loudestHour).padStart(2, '0')));
  out.push(sv('text', { class: 'c1', x: C, y: C + 6, 'aria-hidden': 'true' }, hourText(s.loudestHour)));
  out.push(sv('text', { class: 'c2', x: C, y: C + 26, 'aria-hidden': 'true' }, T.loudest));
  svg.replaceChildren(...out);
}

// ---------------------------------------------------------------- the chapters

const chapter = (name) => $('[data-ch="' + name + '"]');

function heroChapter(s) {
  const a = s.topArtist;
  chapter('artist').hidden = !a;
  if (!a) return;
  part('hero-eyebrow').textContent = s.year == null ? T.hero_all : say(T.hero_year, { year: String(s.year) });
  part('hero-name').textContent = a.name;
  part('hero-name').classList.toggle('long', a.name.length > 18);
  const share = a.share > 0.5 ? T.hero_half
    : a.share > 0 ? say(s.durations ? T.hero_share : T.hero_share_plays, { n: Math.max(2, Math.round(1 / a.share)) }) : null;
  if (s.durations) {
    fill(part('hero-line'), rich(T.hero_time, { minutes: minutesText(a.minutes) }), a.minutes >= 120 ? say(T.hero_days, { duration: duration(a.minutes, 2) }) : null, share);
  } else fill(part('hero-line'), rich(T.hero_plays, { times: say(T.times_n, { n: a.plays }) }), share);
  part('hero-facts').replaceChildren(...[
    s.durations ? rich(T.fact_plays, { n: a.plays }) : null,
    a.songs > 0 ? rich(T.fact_songs, { n: a.songs }) : null,
    a.song ? rich(T.fact_song, { title: a.song }) : null,
  ].filter(Boolean).map((nodes) => el('li', {}, ...nodes)));
}

function minutesChapter(s) {
  const all = s.year == null;
  const day = all ? dayYearText : dayText;
  const eyebrow = part('min-eyebrow');
  eyebrow.textContent = s.range ? say(T.min_eyebrow, { range: say(T.range, { from: day(s.range.from), to: day(s.range.to) }) }) : '';
  const total = s.durations ? s.minutes : s.plays;
  setBig(total);
  part('unit').textContent = s.durations ? T.unit_minutes : say(T.unit_plays, { n: total });
  fill(part('as'), s.durations && s.minutes >= 120 ? say(T.as_time, { duration: duration(s.minutes) }) : null);
  const trio = [s.durations ? [T.plays, s.plays] : null, [T.songs, s.songs], s.artists ? [T.artists, s.artists] : null].filter(Boolean);
  part('trio').replaceChildren(...trio.map(([name, n]) => el('div', {}, el('dt', { text: name }), el('dd', { text: num(n) }))));

  const label = (f) => num(s.durations ? f.minutes : f.plays);
  const top = s.topMonth;
  if (all) {
    part('months-h').textContent = T.years_h;
    const short = s.series.length > 8;
    cols(part('months'), s.series.map((f) => ({ value: f.value, long: String(f.year), short: short ? '’' + String(f.year).slice(2) : String(f.year), text: amount(s, f), label: label(f) })));
    const best = s.series.reduce((x, y) => (y.value > x.value ? y : x), s.series[0]);
    fill(part('months-cap'), s.series.length > 1 && best.value > 0 ? rich(T.top_year, { year: String(best.year), amount: amount(s, best) }) : null);
    return;
  }
  part('months-h').textContent = T.months_h;
  const from = s.range ? new Date(s.range.from * DAY_MS).getUTCMonth() : 0, to = s.range ? new Date(s.range.to * DAY_MS).getUTCMonth() : 11;
  const rows = [];
  for (let m = from; m <= to; m++) rows.push({ value: s.months[m].value, long: cap(monthName(m)), short: cap(monthName(m, true)).slice(0, 3), text: amount(s, s.months[m]), label: label(s.months[m]) });
  cols(part('months'), rows);
  let each = null;
  if (top) {
    // The days of that month the history covers: a first or last month may be a part of one.
    const first = Math.max(s.range.from, Date.UTC(s.year, top.month, 1) / DAY_MS), last = Math.min(s.range.to, Date.UTC(s.year, top.month + 1, 0) / DAY_MS);
    const days = Math.max(1, last - first + 1);
    const n = Math.round((s.durations ? top.minutes : top.plays) / days);
    if (n >= 1) each = say(T.per_day, { amount: s.durations ? perDay(n) : playsText(n) });
  }
  fill(part('months-cap'),
    top && rows.length > 1 ? rich(T.top_month, { Month: cap(monthName(top.month)), month: monthName(top.month), amount: amount(s, top) }) : null,
    top && rows.length > 1 ? each : null,
    // Only a history that stops about now: one that ended long ago is not filling up any more.
    s.partialMonth >= 0 && top && s.partialMonth !== top.month && Date.now() / DAY_MS - s.range.to < 45 ? say(T.still, { Month: cap(monthName(s.partialMonth)), month: monthName(s.partialMonth) }) : null);
}

function topChapter(s) {
  const panel = part('artists-panel');
  panel.hidden = !s.topArtists.length;
  panel.parentElement.classList.toggle('one', panel.hidden);
  rank(part('artists'), s.topArtists.map((a) => ({
    name: a.name, value: a.value,
    sub: s.durations ? playsText(a.plays) : null,
    text: s.durations ? say(T.min_short, { n: a.minutes }) : playsText(a.plays),
  })));
  const pct = Math.round(s.topFiveShare * 100);
  fill(part('artists-cap'),
    s.artists > 5 && pct > 0 ? say(T.five_share, { pct }) : null,
    s.artists > 5 && pct > 0 && pct < 100 ? say(T.five_rest, { n: s.artists - 5 }) : null);
  rank(part('songs'), s.topSongs.map((t) => ({ name: t.title, sub: t.artist, value: t.plays, text: playsText(t.plays) })));
  const t = s.topSong;
  let pace = null;
  if (t && s.range) {
    const week = t.plays * 7 / s.range.days, month = t.plays * 30.44 / s.range.days;
    if (Math.round(week) >= 1) pace = say(T.song_week, { n: Math.round(week) });
    else if (Math.round(month) >= 1) pace = say(T.song_month, { n: Math.round(month) });
  }
  fill(part('songs-cap'), t && t.plays > 1 ? say(T.song_times, { title: t.title, times: say(T.times_n, { n: t.plays }) }) : null, t && t.plays > 1 ? pace : null);
}

function clockChapter(s) {
  const timed = s.loudestHour >= 0, weekly = s.topWeekday >= 0;
  chapter('clock').hidden = !timed && !weekly;
  chapter('clock').querySelector('.wr-clock').classList.toggle('one', !timed);
  for (const name of ['dial-box', 'type-box', 'parts', 'numbers']) part(name).hidden = !timed;
  part('weekdays-panel').hidden = !weekly;
  const hourAmount = (v) => (s.durations ? minutesText(Math.round(v / 60000)) : playsText(v));
  const sum = (list) => list.reduce((x, y) => x + y, 0);
  let partLine = null;
  if (timed) {
    dial($('.wr-dial'), s, hourAmount);
    part('type').textContent = T.types[s.topPart];
    const total = sum(s.parts);
    const range = (i) => [hourText(PARTS[i][0]), hourText((PARTS[i][1] + 1) % 24)];
    part('parts').replaceChildren(...PARTS.map((p, i) => {
      const [from, to] = range(i);
      return el('li', { class: i === s.topPart ? 'pk' : null },
        el('b', { text: Math.round(s.parts[i] * 100 / total) + '%' }),
        el('span', { text: i === s.topPart ? say(T.part_most, { name: T.parts[i] }) : T.parts[i] }),
        el('small', { text: say(T.hours_range, { from, to }) }));
    }));
    const [from, to] = range(s.topPart);
    partLine = say(T.part_line, { pct: Math.round(s.parts[s.topPart] * 100 / total), from, to });
    const grid = el('div', { class: 'wr-numbers-grid' });
    for (let q = 0; q < 4; q++) {
      const body = el('tbody');
      for (let h = q * 6; h < q * 6 + 6; h++) body.append(el('tr', {}, el('td', { text: hourText(h) }), el('td', { text: num(s.durations ? Math.round(s.hours[h] / 60000) : s.hours[h]) })));
      grid.append(el('table', {}, el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: T.hour }), el('th', { scope: 'col', text: s.durations ? T.col_minutes : T.col_plays }))), body));
    }
    part('hours-table').replaceChildren(grid);
  }
  if (weekly) {
    const total = sum(s.weekdays);
    cols(part('weekdays'), s.weekdays.map((v, i) => {
      const pct = Math.round(v * 100 / total) + '%';
      return { value: v, long: cap(weekdayName(i)), short: cap(weekdayName(i, true)).slice(0, 3), text: pct, label: pct };
    }));
  }
  fill(part('clock-line'),
    timed ? rich(T.loudest_line, { hour: hourText(s.loudestHour) }) : null,
    partLine,
    weekly ? say(T.weekday_line, { Weekday: cap(weekdayName(s.topWeekday)), weekday: weekdayName(s.topWeekday) }) : null);
}

function moment(name, k, v, d) {
  const box = $('[data-m="' + name + '"]');
  box.hidden = !v;
  if (!v) return;
  box.querySelector('.k').textContent = k;
  box.querySelector('.v').textContent = v;
  box.querySelector('.d').textContent = d || '';
  box.querySelector('.d').hidden = !d;
}

function momentsChapter(s) {
  const all = s.year == null;
  const day = all ? dayYearText : dayText;
  part('mom-h').textContent = all ? T.mom_h_all : T.mom_h_year;
  // The first song: only where the export says at what time each one was played.
  const f = s.firstSong;
  if (f) {
    const values = { artist: f.artist, date: day(f.day), Date: cap(day(f.day)), time: hourText(f.hour, f.minute) };
    const opening = new Date(f.day * DAY_MS);
    moment('first', all ? T.first_k_all : T.first_k, f.title, [
      say(f.artist ? T.first_d : T.first_d_bare, values),
      !all && opening.getUTCMonth() === 0 && opening.getUTCDate() === 1 ? T.first_new_year : '',
    ].filter(Boolean).join(' '));
  } else moment('first');
  const top = s.topDay;
  if (top && s.activeDays > 1) {
    moment('day', T.day_k, cap((all ? weekdayDayYearText : weekdayDayText)(top.day)),
      s.durations ? say(T.day_d, { duration: duration(top.minutes), plays: playsText(top.plays) }) : say(T.day_d_plays, { plays: cap(playsText(top.plays)) }));
  } else moment('day');
  const run = s.streak;
  if (run && run.days > 1) moment('streak', T.streak_k, say(T.streak_v, { n: run.days }), say(T.streak_d, { from: day(run.from), to: day(run.to) }));
  else moment('streak');
  const month = s.topMonth;
  if (month && s.range && s.range.days > 31) {
    moment('month', T.month_k, cap(monthName(month.month)) + (all ? ' ' + month.year : ''),
      s.durations ? cap(say(T.month_d, { minutes: minutesText(month.minutes), plays: playsText(month.plays) })) : cap(say(T.month_d_plays, { plays: playsText(month.plays) })));
  } else moment('month');
  if (s.range && s.range.days > 1) {
    const tenth = Math.min(9, Math.max(1, Math.round(s.activeDays * 10 / s.range.days)));
    if (all) moment('days', T.days_k, num(s.activeDays), say(T.days_all_d, { total: s.range.days }));
    else moment('days', T.days_k, say(T.days_v, { n: s.activeDays, total: s.range.days }), s.activeDays === s.range.days ? T.days_every : say(T.days_d, { n: tenth }));
  } else moment('days');
  // Two wide ones on the first row, three on the second; whatever is missing, the rest fill the rows.
  const visible = [...root.querySelectorAll('.wr-moment')].filter((m) => !m.hidden);
  chapter('moments').hidden = !visible.length;
  const n = visible.length;
  visible.forEach((m, i) => m.classList.toggle('wide', n === 5 ? i < 2 : n !== 3));
}

// ---------------------------------------------------------------- the cards

function drawCards() {
  const s = shown;
  if (!s) return;
  const total = s.durations ? s.minutes : s.plays;
  const a = s.topArtist;
  const t = {
    label: s.year == null ? T.card_all : say(T.card_year, { year: String(s.year) }),
    big: num(total),
    unit: s.durations ? T.card_minutes : say(T.card_plays, { n: total }),
    topArtist: T.card_top_artist,
    together: a ? say(T.card_together, { amount: s.durations ? minutesText(a.minutes) : playsText(a.plays) }) : '',
    artists: T.card_top_artists,
    songs: T.card_top_songs,
    hour: s.loudestHour >= 0 ? hourText(s.loudestHour) : '',
    loudest: T.loudest,
    type: s.topPart >= 0 ? T.types[s.topPart] : '',
    tail: [say(T.songs_n, { n: s.songs }), s.artists ? say(T.artists_n, { n: s.artists }) : ''].filter(Boolean).join(' · '),
    streak: s.streak && s.streak.days > 1 ? say(T.card_streak, { n: s.streak.days }) : '',
  };
  const alt = [
    t.label, t.big + ' ' + t.unit,
    a ? T.card_top_artist + ': ' + a.name : '',
    s.topArtists.length ? T.card_top_artists + ': ' + s.topArtists.map((x) => x.name).join(', ') : '',
    s.topSongs.length ? T.card_top_songs + ': ' + s.topSongs.map((x) => x.title).join(', ') : '',
    t.hour ? say(T.card_alt_clock, { hour: t.hour }) : '',
  ].filter(Boolean).join('. ') + '.';
  drawCard(cards.story, s, t, look, false);
  drawCard(cards.square, s, t, look, true);
  cards.story.setAttribute('aria-label', say(T.card_alt_story, { text: alt }));
  cards.square.setAttribute('aria-label', say(T.card_alt_square, { text: alt }));
  for (const b of root.querySelectorAll('[data-save]')) b.disabled = false;
}

for (const b of root.querySelectorAll('[data-save]')) {
  b.addEventListener('click', async () => {
    if (!shown) return;
    const kind = b.dataset.save, name = String(shown.year == null ? 'all' : shown.year);
    save(await cardBlob(cards[kind]), fmt(kind === 'story' ? T.file_story : T.file_square, { label: name }));
  });
}
const looks = $('.wr-themes');
if (LOOKS[stored('toolsWrappedLook')]) {
  look = stored('toolsWrappedLook');
  looks.querySelector('input[value="' + look + '"]').checked = true;
}
looks.addEventListener('change', () => {
  look = looks.querySelector('input:checked').value;
  try { localStorage.setItem('toolsWrappedLook', look); } catch (e) { /* private window */ }
  drawCards();
});

// ---------------------------------------------------------------- motion: once per chapter

// A chapter plays when it first comes into view and is then at rest for good: another year puts
// new figures in it without moving anything. With reduced motion nothing plays at all.
const big = part('big');
const seen = (ch) => ch.classList.contains('in') || ch.classList.contains('seen');
function rest() {
  counting++;
  for (const ch of root.querySelectorAll('.wr-chapter.in')) ch.classList.replace('in', 'seen');
}
function setBig(n) {
  big.dataset.value = n;
  big.classList.toggle('long', num(n).length > 7);
  big.textContent = num(n);
}
function countUp() {
  const end = Number(big.dataset.value), mine = ++counting, t0 = performance.now();
  const step = (t) => {
    if (mine !== counting) return;
    const p = Math.min(1, (t - t0) / 1100);
    big.textContent = num(Math.round(end * (1 - Math.pow(1 - p, 3))));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
const watcher = !calm && 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting || seen(en.target)) continue;
    watcher.unobserve(en.target);
    en.target.classList.add('in');
    if (en.target.contains(big)) countUp();
  }
}, { threshold: 0.2 }) : null;

// ---------------------------------------------------------------- a year on the page

function show(year) {
  const s = stats.summary(year);
  rest();
  shown = s;
  heroChapter(s);
  minutesChapter(s);
  topChapter(s);
  clockChapter(s);
  momentsChapter(s);
  drawCards();
}

function showYears(fileName, from) {
  const years = stats.yearList();
  part('file').textContent = fileName;
  part('file-sub').textContent = years.length > 1
    ? say(T.loaded_range, { source: T.sources[from].name, from: String(years[0]), to: String(years[years.length - 1]) })
    : say(T.loaded_one, { source: T.sources[from].name, year: String(years[0]) });
  yearTabs.replaceChildren(
    ...years.map((y) => el('button', { type: 'button', role: 'tab', class: 'tool-tab', 'data-value': y, 'aria-selected': 'false', tabindex: '-1', text: String(y) })),
    years.length > 1 ? el('button', { type: 'button', role: 'tab', class: 'tool-tab', 'data-value': 'all', 'aria-selected': 'false', tabindex: '-1', text: T.all }) : null,
  );
  // The last year opens first: it is the one a Wrapped is about.
  yearTabs.querySelector('[data-value="' + years[years.length - 1] + '"]').click();
}

function openDrop(open) {
  empty.hidden = !open;
  another.setAttribute('aria-expanded', String(open));
}
another.addEventListener('click', () => {
  openDrop(empty.hidden);
  if (!empty.hidden) drop.querySelector('input').focus();
});

async function read(files) {
  if (busy) return;
  busy = true;
  error.hidden = true;
  const name = files.length === 1 ? files[0].name : files[0].name + ' +' + (files.length - 1);
  const signal = bar.start(name);
  const from = source;
  try {
    const result = await readExport(from, files, { signal, onProgress: (done, total) => bar.update(done, total) });
    // Everything was read: only now does the page change.
    stats = result;
    for (const ch of root.querySelectorAll('.wr-chapter')) { ch.classList.remove('in', 'seen'); if (watcher) watcher.unobserve(ch); }
    openDrop(false);
    loaded.hidden = false; yearTabs.hidden = false; story.hidden = false;
    showYears(name, from);
    if (watcher) for (const ch of root.querySelectorAll('.wr-chapter')) watcher.observe(ch);
    loaded.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
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
