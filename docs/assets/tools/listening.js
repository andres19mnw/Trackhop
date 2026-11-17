// A year of listening from the data export each service gives its listeners: Spotify's streaming
// history, Apple Music's Play Activity, YouTube Music's watch history from Google Takeout.
// The files are read a piece at a time on the page; only the counts below are kept.
import { ToolError, blobBytes, streamText, check, own } from './io.js';
import { JsonStream } from './json-stream.js';
import { CsvRows, splitArtistTitle } from './playlist.js';
import { isZip, zipEntries, entryBytes } from './zip.js';

/** A listen shorter than this is a skip: its time counts, the play does not. */
export const PLAY_MS = 30000;
const DAY_MS = 24 * 3600 * 1000;

/** The day of a date on the calendar, as a whole number of days since 1970-01-01. */
export const dayNumber = (year, month, day) => Math.round(Date.UTC(year, month, day) / DAY_MS);
/** The parts of the day, by their first and last hour: morning, afternoon, evening, night. */
export const PARTS = [[5, 11], [12, 17], [18, 22], [23, 4]];

class Bucket {
  /** [year] is the calendar year whose days are kept, or null for the bucket of all the years. */
  constructor(year = null) {
    this.year = year;
    this.ms = 0;
    this.plays = 0;
    this.songs = new Map(); // key → [title, artist, plays, ms]
    this.artists = new Map(); // name → [plays, ms]
    this.hourMs = new Float64Array(24);
    this.hourPlays = new Float64Array(24);
    this.weekMs = new Float64Array(7); // Monday first
    this.weekPlays = new Float64Array(7);
    if (year != null) {
      // A year is 366 days and 12 months at most: these stay this small whatever the export's size.
      this.jan1 = dayNumber(year, 0, 1);
      this.monthMs = new Float64Array(12);
      this.monthPlays = new Float64Array(12);
      this.dayMs = new Float64Array(366);
      this.dayPlays = new Float64Array(366);
      this.first = null; // [minute of the year, title, artist]: the earliest play with a time
    }
  }
  add(title, artist, ms, hour, plays, month, day, minute, year) {
    this.ms += ms;
    this.plays += plays;
    if (hour >= 0) { this.hourMs[hour] += ms; this.hourPlays[hour] += plays; }
    if (day > 0) {
      const n = dayNumber(year, month, day);
      const wd = (((n + 3) % 7) + 7) % 7;
      this.weekMs[wd] += ms; this.weekPlays[wd] += plays;
      if (this.year != null) {
        const i = n - this.jan1;
        if (i >= 0 && i < 366) {
          this.monthMs[month] += ms; this.monthPlays[month] += plays;
          this.dayMs[i] += ms; this.dayPlays[i] += plays;
          if (plays > 0 && hour >= 0 && minute >= 0) {
            const at = (i * 24 + hour) * 60 + minute;
            if (!this.first || at < this.first[0]) this.first = [at, own(title), own(artist)];
          }
        }
      }
    }
    const key = title.toLowerCase() + '\u0001' + artist.toLowerCase();
    const s = this.songs.get(key);
    if (s) { s[2] += plays; s[3] += ms; } else this.songs.set(own(key), [own(title), own(artist), plays, ms]);
    if (artist) {
      const a = this.artists.get(artist);
      if (a) { a[0] += plays; a[1] += ms; } else this.artists.set(own(artist), [plays, ms]);
    }
  }
}

/**
 * What was listened to, by year and in all. [durations] says whether the export tells how long
 * each listen lasted (YouTube's does not: plays are counted, minutes are not). [clock] gives the
 * year, hour, month (0 to 11), day of the month and minute of an instant: the visitor's own time
 * zone unless told otherwise. Days, weekdays, months and streaks all follow that same clock.
 */
export class Listening {
  constructor(durations = true, clock = (d) => [d.getFullYear(), d.getHours(), d.getMonth(), d.getDate(), d.getMinutes()]) {
    this.durations = durations;
    this.clock = clock;
    this.all = new Bucket();
    this.years = new Map();
    this.rows = 0;
  }

  /**
   * One listen. ms is null when the export has no durations; plays is how many times (a daily
   * summary may say more than one). month (0 to 11) and day say which day it was; minute is -1
   * when the export gives the day but not the time.
   */
  add(title, artist, ms, year, hour, plays = 1, month = -1, day = 0, minute = -1) {
    title = (title || '').trim();
    if (!title || !(year > 1900 && year < 3000)) return;
    artist = (artist || '').trim();
    this.rows++;
    let time = 0, count = plays;
    if (this.durations) {
      time = ms > 0 && ms < DAY_MS * Math.max(1, plays) ? ms : 0;
      if (time < PLAY_MS) count = 0;
    }
    if (!time && !count) return;
    if (!(month >= 0 && month < 12 && day >= 1 && day <= 31)) { month = -1; day = 0; }
    if (!(hour >= 0 && hour < 24)) hour = -1;
    let y = this.years.get(year);
    if (!y) { y = new Bucket(year); this.years.set(year, y); }
    y.add(title, artist, time, hour, count, month, day, minute, year);
    this.all.add(title, artist, time, hour, count, month, day, minute, year);
  }

  /** One listen at an instant (a Date). */
  at(title, artist, ms, date) {
    if (isNaN(date)) return;
    const [year, hour, month, day, minute] = this.clock(date);
    this.add(title, artist, ms, year, hour, 1, month, day, minute);
  }

  /** The years with something in them, oldest first. */
  yearList() {
    return [...this.years.keys()].filter((y) => this.years.get(y).plays > 0 || this.years.get(y).ms > 0).sort((a, b) => a - b);
  }

  /**
   * The days of a year, or of all of them: the first and last with a play, how many had one, the
   * one with the most, and the longest run of days in a row. A run goes on across the end of a
   * month, and in the figures of all the years across the end of a year too.
   */
  days(year = null) {
    const byTime = this.durations;
    const list = (year == null ? this.yearList() : [year]).map((y) => this.years.get(y)).filter(Boolean);
    let first = null, last = null, active = 0, top = null, run = 0, runFrom = 0, best = null, before = null;
    for (const b of list) {
      for (let i = 0; i < 366; i++) {
        const plays = b.dayPlays[i];
        if (!(plays > 0)) continue;
        const n = b.jan1 + i, ms = b.dayMs[i], value = byTime ? ms : plays;
        if (first == null) first = n;
        last = n;
        active++;
        if (!top || value > top.value) top = { day: n, value, minutes: Math.round(ms / 60000), plays };
        if (before != null && n === before + 1) run++; else { run = 1; runFrom = n; }
        before = n;
        if (!best || run > best.days) best = { days: run, from: runFrom, to: n };
      }
    }
    return { first, last, active, top, streak: best };
  }

  /** The figures of a year, or of all of them (year null): what the page and the cards show. */
  summary(year = null) {
    const b = year == null ? this.all : this.years.get(year) || new Bucket(year);
    const byTime = this.durations;
    const songs = [...b.songs.values()].filter((s) => s[2] > 0);
    const artists = [...b.artists.entries()].filter((a) => a[1][0] > 0);
    const rank = (plays, ms) => (byTime ? ms : plays);
    const total = byTime ? b.ms : b.plays;
    artists.sort((x, y) => rank(y[1][0], y[1][1]) - rank(x[1][0], x[1][1]) || y[1][0] - x[1][0]);
    const topArtists = artists.slice(0, 5)
      .map(([name, v]) => ({ name, plays: v[0], minutes: Math.round(v[1] / 60000), value: byTime ? Math.round(v[1] / 60000) : v[0] }));
    const topFive = artists.slice(0, 5).reduce((sum, a) => sum + rank(a[1][0], a[1][1]), 0);
    songs.sort((x, y) => y[2] - x[2] || y[3] - x[3]);
    const topSongs = songs.slice(0, 5)
      .map((s) => ({ title: s[0], artist: s[1], plays: s[2], minutes: Math.round(s[3] / 60000) }));
    // The first artist: how many of their songs were played, and which the most (the list is in that order).
    let topArtist = null;
    if (artists.length) {
      const [name, v] = artists[0], low = name.toLowerCase();
      let count = 0, song = null;
      for (const s of songs) if (s[1].toLowerCase() === low) { count++; if (!song) song = s[0]; }
      topArtist = { name, plays: v[0], minutes: Math.round(v[1] / 60000), songs: count, song, share: total > 0 ? rank(v[0], v[1]) / total : 0 };
    }
    const hours = Array.from(byTime ? b.hourMs : b.hourPlays);
    const peak = Math.max(...hours);
    const clocked = hours.reduce((x, y) => x + y, 0);
    const parts = PARTS.map(([from, to]) => { let sum = 0; for (let h = from; ; h = (h + 1) % 24) { sum += hours[h]; if (h === to) break; } return sum; });
    const weekdays = Array.from(byTime ? b.weekMs : b.weekPlays);
    const busiest = Math.max(...weekdays);

    const d = this.days(year);
    const list = this.yearList();
    // The stretch the figures are about: a year in the middle of the history is the whole year,
    // the first one starts at its first play, the last one ends at its last.
    let range = null;
    if (d.first != null) {
      const from = year == null || year === list[0] ? d.first : dayNumber(year, 0, 1);
      const to = year == null || year === list[list.length - 1] ? d.last : dayNumber(year, 11, 31);
      range = { from, to, days: to - from + 1 };
    }
    const fig = (ms, plays) => ({ minutes: Math.round(ms / 60000), plays, value: byTime ? ms : plays });
    const months = year == null ? null : Array.from({ length: 12 }, (_, m) => fig(b.monthMs[m], b.monthPlays[m]));
    const series = year != null ? null : list.map((y) => ({ year: y, ...fig(this.years.get(y).ms, this.years.get(y).plays) }));
    let topMonth = null;
    for (const y of year == null ? list : [year]) {
      const yb = this.years.get(y);
      if (!yb) continue;
      for (let m = 0; m < 12; m++) {
        const f = fig(yb.monthMs[m], yb.monthPlays[m]);
        if (f.value > 0 && (!topMonth || f.value > topMonth.value)) topMonth = { year: y, month: m, ...f };
      }
    }
    // The last month of the history when it stops before that month's end: it is still filling up.
    let partialMonth = -1;
    if (year != null && range && year === list[list.length - 1]) {
      const end = new Date(range.to * DAY_MS);
      if (new Date((range.to + 1) * DAY_MS).getUTCMonth() === end.getUTCMonth()) partialMonth = end.getUTCMonth();
    }
    let firstSong = null;
    const fb = year == null ? this.years.get(list[0]) : b;
    if (fb && fb.first) {
      const at = fb.first[0];
      firstSong = { title: fb.first[1], artist: fb.first[2], day: fb.jan1 + Math.floor(at / 1440), hour: Math.floor(at / 60) % 24, minute: at % 60 };
    }
    return {
      year,
      durations: byTime,
      minutes: Math.round(b.ms / 60000),
      plays: b.plays,
      songs: songs.length,
      artists: artists.length,
      topArtists,
      topSongs,
      topArtist,
      topFiveShare: total > 0 ? topFive / total : 0,
      hours,
      loudestHour: peak > 0 ? hours.indexOf(peak) : -1,
      parts,
      topPart: clocked > 0 ? parts.indexOf(Math.max(...parts)) : -1,
      weekdays,
      topWeekday: busiest > 0 ? weekdays.indexOf(busiest) : -1,
      months,
      series,
      topMonth,
      partialMonth,
      range,
      activeDays: d.active,
      topDay: d.top,
      streak: d.streak,
      firstSong,
      topSong: topSongs[0] || null,
    };
  }
}

// ---------------------------------------------------------------- Spotify

/**
 * One entry of Spotify's history: the extended one (ts, ms_played, master_metadata_track_name,
 * master_metadata_album_artist_name) or the shorter account data (endTime, msPlayed, trackName,
 * artistName). Podcast episodes and videos have no track name and are passed over.
 */
export function spotifyEntry(o, stats) {
  if (o === null || typeof o !== 'object') return;
  if (o.master_metadata_track_name !== undefined || o.ts !== undefined) {
    if (!o.master_metadata_track_name) return;
    stats.at(o.master_metadata_track_name, o.master_metadata_album_artist_name, Number(o.ms_played) || 0, new Date(o.ts));
  } else if (o.trackName !== undefined) {
    // "2021-03-04 12:30", in UTC.
    const t = String(o.endTime || '').trim().replace(' ', 'T');
    stats.at(o.trackName, o.artistName, Number(o.msPlayed) || 0, new Date(/Z$|[+-]\d\d:?\d\d$/.test(t) ? t : t + 'Z'));
  }
}

/** A sink for JSON that is one array of entries: each goes to [each] as it closes and is not kept. */
function entries(each) {
  let root = null, found = 0;
  const stream = new JsonStream({
    onArrayStart: (f, depth) => { if (depth === 1) root = f; },
    onArrayItem: (f, v) => {
      if (f !== root) return f.value.length < 16;
      found++;
      each(v);
      return false;
    },
  });
  // Text that is not JSON at all (a CSV, an HTML page) is another file, not a damaged one.
  const other = (e) => (e instanceof ToolError && e.code === 'unreadable' && !found ? new ToolError('wrong-file') : e);
  return {
    push: (s) => { try { stream.push(s); } catch (e) { throw other(e); } },
    end: () => { try { stream.end(); } catch (e) { throw other(e); } if (!root) throw new ToolError('wrong-file'); return found; },
  };
}

const SPOTIFY_FILE = /(?:^|\/)(?:Streaming_History_Audio_[^/]*|endsong_[^/]*|StreamingHistory(?:_music)?_?\d*)\.json$/i;

// ---------------------------------------------------------------- YouTube Music (Google Takeout)

// "Watched X" in the languages Takeout writes it in most often; a title in another one stays whole.
const WATCHED = [/^Watched\s+/, /^Hai guardato\s+/, /^Has visto\s+/, /^Vous avez regardé\s+/, /^Você assistiu a?\s*/, /^Viu\s+/, /^Obejrzano:?\s+/, /^Je hebt gekeken naar\s+/];
const WATCHED_AFTER = [/\s+angesehen$/];

/**
 * One entry of watch-history.json: only those of YouTube Music (header "YouTube Music"), title
 * "Watched X", the artist in subtitles[0].name ("Artist - Topic"), the instant in time. There is
 * no duration: each entry is a play.
 */
export function youtubeEntry(o, stats) {
  if (o === null || typeof o !== 'object' || o.header !== 'YouTube Music') return;
  if (!Array.isArray(o.subtitles) || !o.subtitles.length || !o.subtitles[0]) return; // a removed video, an ad
  let title = String(o.title || '');
  for (const r of WATCHED) if (r.test(title)) { title = title.replace(r, ''); break; }
  for (const r of WATCHED_AFTER) title = title.replace(r, '');
  const artist = String(o.subtitles[0].name || '').replace(/\s+-\s+Topic$/i, '');
  stats.at(title, artist, null, new Date(o.time));
}

const YOUTUBE_FILE = /(?:^|\/)watch-history[^/]*\.json$/i;

// ---------------------------------------------------------------- Apple Music

const normCol = (h) => h.toLowerCase().replace(/[^a-z0-9]/g, '');
const APPLE_COLS = {
  title: ['songname', 'contentname', 'trackname', 'title'],
  description: ['trackdescription'],
  artist: ['artistname', 'containerartistname', 'artist'],
  ms: ['playdurationmilliseconds'],
  time: ['eventstarttimestamp', 'eventendtimestamp', 'eventreceivedtimestamp', 'eventtimestamp'],
  offset: ['utcoffsetinseconds'],
  type: ['eventtype'],
  media: ['mediatype'],
  date: ['dateplayed'],
  hours: ['hours'],
  count: ['playcount'],
};

/**
 * Apple Music's "Play Activity" CSV (privacy.apple.com), in the shapes it has had: the song in
 * Song Name or Content Name, the artist in Artist Name or Container Artist Name (some exports
 * have none), Play Duration Milliseconds, and the instant in Event Start, End or Received
 * Timestamp, with the listener's own offset from UTC when the file gives it. The daily summary
 * ("Play History Daily Tracks": Track Description, Date Played, Hours, Play Count) is read too.
 * Rows that are not the end of a play (PLAY_START, lyrics shown) and videos are passed over.
 */
export function appleSink(stats) {
  let cols = null;
  const header = (row) => {
    const names = row.map(normCol);
    const c = {};
    for (const k of Object.keys(APPLE_COLS)) c[k] = APPLE_COLS[k].map((n) => names.indexOf(n)).filter((i) => i >= 0);
    if ((!c.title.length && !c.description.length) || (!c.time.length && !c.date.length)) throw new ToolError('wrong-file');
    // An export without durations: plays are counted, as for YouTube Music.
    if (!c.ms.length) stats.durations = false;
    cols = c;
  };
  const cell = (row, list) => {
    for (const i of list) { const v = row[i]; if (v != null && v.trim() !== '') return v.trim(); }
    return '';
  };
  const each = (row) => {
    if (!cols) return header(row);
    const type = cell(row, cols.type);
    if (type && type.toUpperCase() !== 'PLAY_END') return;
    if (cell(row, cols.media).toUpperCase() === 'VIDEO') return;
    let title = cell(row, cols.title), artist = cell(row, cols.artist);
    if (!title) {
      const d = cell(row, cols.description);
      if (!d) return;
      const [artists, t] = splitArtistTitle(d);
      title = t;
      if (!artist) artist = artists.join(', ');
    }
    const ms = cols.ms.length ? Number(cell(row, cols.ms)) || 0 : null;
    const when = cell(row, cols.time);
    if (when) {
      const instant = Date.parse(when);
      if (isNaN(instant)) return;
      const offset = cell(row, cols.offset);
      if (offset !== '' && isFinite(Number(offset))) {
        // The hour it was for the listener then, wherever this page is opened now.
        const local = new Date(instant + Number(offset) * 1000);
        stats.add(title, artist, ms, local.getUTCFullYear(), local.getUTCHours(), 1, local.getUTCMonth(), local.getUTCDate(), local.getUTCMinutes());
      } else stats.at(title, artist, ms, new Date(instant));
      return;
    }
    // The daily summary: "20240131", the hours it was played in, how many times.
    const day = cell(row, cols.date).replace(/\D/g, '');
    if (day.length < 8) return;
    const hour = parseInt(cell(row, cols.hours), 10);
    const plays = Math.max(1, parseInt(cell(row, cols.count), 10) || 1);
    stats.add(title, artist, ms, Number(day.slice(0, 4)), hour >= 0 && hour < 24 ? hour : -1, plays, Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)));
  };
  const rows = new CsvRows(each);
  return { push: (s) => rows.push(s), end: () => { rows.end(); if (!cols) throw new ToolError('wrong-file'); } };
}

const APPLE_FILE = /(?:^|\/)[^/]*(?:Play Activity|Play History Daily Tracks)[^/]*\.csv$/i;
const APPLE_INNER_ZIP = /(?:^|\/)Apple[ _]Media[ _]Services[^/]*\.zip$/i;

// ---------------------------------------------------------------- reading an export

export const SOURCES = {
  spotify: { durations: true, pick: SPOTIFY_FILE, sink: (stats) => entries((o) => spotifyEntry(o, stats)) },
  apple: { durations: true, pick: APPLE_FILE, inner: APPLE_INNER_ZIP, sink: (stats) => appleSink(stats) },
  youtube: { durations: false, pick: YOUTUBE_FILE, sink: (stats) => entries((o) => youtubeEntry(o, stats)) },
};

/** The entry of an archive as a Blob (an archive inside the archive, to open in its turn). */
async function entryBlob(blob, entry, signal) {
  const parts = [];
  for await (const b of entryBytes(blob, entry, { signal })) parts.push(b);
  return new Blob(parts);
}

/** The files to read: the picked ones as they are, and for a .zip the entries that are the history. */
async function gather(source, files, signal) {
  const src = SOURCES[source];
  const out = [];
  const open = async (blob, depth) => {
    const all = await zipEntries(blob);
    const wanted = all.filter((e) => src.pick.test(e.name) && !e.name.endsWith('/'));
    for (const e of wanted) out.push({ size: e.size, bytes: (opts) => entryBytes(blob, e, opts) });
    if (!wanted.length && src.inner && depth === 0) {
      for (const e of all.filter((x) => src.inner.test(x.name))) await open(await entryBlob(blob, e, signal), 1);
    }
  };
  for (const f of files) {
    check(signal);
    if (await isZip(f)) await open(f, 0);
    else out.push({ size: f.size, bytes: (opts) => blobBytes(f, opts) });
  }
  return out;
}

/**
 * The listening in an export. [source] is spotify, apple or youtube; [files] the picked files: the
 * .zip as it arrives, or the files inside it. Nothing is returned for a file cut short or of
 * another kind: ToolError incomplete, unreadable, wrong-file (not this export) or empty (no songs).
 */
export async function readExport(source, files, { signal, onProgress, clock } = {}) {
  const src = SOURCES[source];
  const stats = new Listening(src.durations, clock);
  const parts = await gather(source, files, signal);
  if (!parts.length) throw new ToolError('wrong-file');
  const total = parts.reduce((s, p) => s + p.size, 0);
  let before = 0;
  for (const p of parts) {
    await streamText(
      () => {
        let done = 0;
        return p.bytes({ signal, onBytes: (n) => { done += n; if (onProgress) onProgress(before + done, total); } });
      },
      () => src.sink(stats),
      // Read once: these exports are UTF-8, and a second reading would count every listen twice.
      ['utf-8'],
    );
    before += p.size;
  }
  if (!stats.yearList().length) throw new ToolError('empty');
  return stats;
}
