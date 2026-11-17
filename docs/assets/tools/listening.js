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

class Bucket {
  constructor() {
    this.ms = 0;
    this.plays = 0;
    this.songs = new Map(); // key → [title, artist, plays, ms]
    this.artists = new Map(); // name → [plays, ms]
    this.hourMs = new Float64Array(24);
    this.hourPlays = new Float64Array(24);
  }
  add(title, artist, ms, hour, plays) {
    this.ms += ms;
    this.plays += plays;
    if (hour >= 0) { this.hourMs[hour] += ms; this.hourPlays[hour] += plays; }
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
 * year and the hour of an instant: the visitor's own time zone unless told otherwise.
 */
export class Listening {
  constructor(durations = true, clock = (d) => [d.getFullYear(), d.getHours()]) {
    this.durations = durations;
    this.clock = clock;
    this.all = new Bucket();
    this.years = new Map();
    this.rows = 0;
  }

  /** One listen. ms is null when the export has no durations; plays is how many times (a daily summary may say more than one). */
  add(title, artist, ms, year, hour, plays = 1) {
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
    let y = this.years.get(year);
    if (!y) { y = new Bucket(); this.years.set(year, y); }
    y.add(title, artist, time, hour, count);
    this.all.add(title, artist, time, hour, count);
  }

  /** One listen at an instant (a Date). */
  at(title, artist, ms, date) {
    if (isNaN(date)) return;
    const [year, hour] = this.clock(date);
    this.add(title, artist, ms, year, hour);
  }

  /** The years with something in them, oldest first. */
  yearList() {
    return [...this.years.keys()].filter((y) => this.years.get(y).plays > 0 || this.years.get(y).ms > 0).sort((a, b) => a - b);
  }

  /** The figures of a year, or of all of them (year null): what the page and the cards show. */
  summary(year = null) {
    const b = year == null ? this.all : this.years.get(year) || new Bucket();
    const byTime = this.durations;
    const songs = [...b.songs.values()].filter((s) => s[2] > 0);
    const artists = [...b.artists.entries()].filter((a) => a[1][0] > 0);
    const rank = (plays, ms) => (byTime ? ms : plays);
    const topArtists = artists.sort((x, y) => rank(y[1][0], y[1][1]) - rank(x[1][0], x[1][1]) || y[1][0] - x[1][0]).slice(0, 5)
      .map(([name, v]) => ({ name, plays: v[0], minutes: Math.round(v[1] / 60000), value: byTime ? Math.round(v[1] / 60000) : v[0] }));
    const topSongs = songs.sort((x, y) => y[2] - x[2] || y[3] - x[3]).slice(0, 5)
      .map((s) => ({ title: s[0], artist: s[1], plays: s[2], minutes: Math.round(s[3] / 60000) }));
    const hours = Array.from(byTime ? b.hourMs : b.hourPlays);
    const peak = Math.max(...hours);
    return {
      year,
      durations: byTime,
      minutes: Math.round(b.ms / 60000),
      plays: b.plays,
      songs: songs.length,
      artists: artists.length,
      topArtists,
      topSongs,
      hours,
      loudestHour: peak > 0 ? hours.indexOf(peak) : -1,
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
        stats.add(title, artist, ms, local.getUTCFullYear(), local.getUTCHours());
      } else stats.at(title, artist, ms, new Date(instant));
      return;
    }
    // The daily summary: "20240131", the hours it was played in, how many times.
    const day = cell(row, cols.date).replace(/\D/g, '');
    if (day.length < 8) return;
    const hour = parseInt(cell(row, cols.hours), 10);
    const plays = Math.max(1, parseInt(cell(row, cols.count), 10) || 1);
    stats.add(title, artist, ms, Number(day.slice(0, 4)), hour >= 0 && hour < 24 ? hour : -1, plays);
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
