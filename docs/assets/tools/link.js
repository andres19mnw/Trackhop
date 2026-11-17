// /link: one song or album link in, a button per service out. Everything here runs in the
// visitor's browser (and in node, for the tests). The only requests are the public catalogue
// lookups named below; nothing is stored and nothing goes to Trackhop.
import { ToolError } from './io.js';

export const TIMEOUT = 8000;
/** Two lengths are the same recording when they are this close. */
export const DURATION_WINDOW_MS = 3000;

// ---------------------------------------------------------------------------------------------
// Reading the pasted link
// ---------------------------------------------------------------------------------------------

/** Short links only the service's own app or a redirect can open: a page cannot follow them. */
const SHORT = new Set(['spotify.link', 'spotify.app.link', 'link.deezer.com', 'deezer.page.link', 'dzr.page.link',
  'apple.co', 'a.co', 'amzn.to', 'amzn.eu', 'bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'is.gd']);
const APPLE = new Set(['music.apple.com', 'itunes.apple.com', 'geo.music.apple.com', 'geo.itunes.apple.com', 'beta.music.apple.com', 'embed.music.apple.com']);
const MANY = { playlist: 'playlist', artist: 'artist', show: 'podcast', episode: 'podcast', podcast: 'podcast' };

const refuse = (code, detail) => { throw new ToolError(code, detail); };
const digits = (s) => /^\d{1,20}$/.test(s || '');

/**
 * What a pasted text points at: { service: 'apple' | 'deezer' | 'spotify', kind: 'song' | 'album', id, country, url }.
 * Anything else throws a ToolError: empty, not-link, short, site, many (detail: playlist, artist, podcast)
 * or other (a page of a known service that is neither a song nor an album).
 */
export function parseLink(input) {
  let text = String(input == null ? '' : input).trim();
  if (!text) refuse('empty');
  const uri = /^spotify:(track|album|playlist|artist|show|episode):([A-Za-z0-9]+)$/.exec(text);
  if (uri) text = 'https://open.spotify.com/' + uri[1] + '/' + uri[2];
  // A share text ("Listen to this https://…") carries the link inside it.
  const inside = /https?:\/\/[^\s<>"']+/i.exec(text);
  if (inside) text = inside[0];
  else if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(text)) text = 'https://' + text;
  else refuse('not-link');
  let u;
  try { u = new URL(text); } catch (e) { refuse('not-link'); }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const parts = u.pathname.split('/').filter(Boolean);
  if (SHORT.has(host)) refuse('short');
  if (host === 'open.spotify.com' || host === 'play.spotify.com') return spotifyLink(parts);
  if (host === 'deezer.com') return deezerLink(parts);
  if (host === 'podcasts.apple.com') refuse('many', 'podcast');
  if (APPLE.has(host)) return appleLink(u, parts);
  return refuse('site');
}

function spotifyLink(parts) {
  let country = null;
  const intl = /^intl-([a-z]{2})$/i.exec(parts[0] || '');
  if (intl) { country = intl[1].toLowerCase(); parts = parts.slice(1); }
  if (parts[0] === 'embed') parts = parts.slice(1);
  if (parts[0] === 'user' && parts[2] === 'playlist') refuse('many', 'playlist');
  const [type, id] = parts;
  if (MANY[type]) refuse('many', MANY[type]);
  if ((type !== 'track' && type !== 'album') || !/^[A-Za-z0-9]{22}$/.test(id || '')) refuse('other');
  return { service: 'spotify', kind: type === 'track' ? 'song' : 'album', id, country, url: 'https://open.spotify.com/' + type + '/' + id };
}

function deezerLink(parts) {
  if (/^[a-z]{2}(-[a-z]{2})?$/i.test(parts[0] || '')) parts = parts.slice(1);
  const [type, id] = parts;
  if (MANY[type]) refuse('many', MANY[type]);
  if ((type !== 'track' && type !== 'album') || !digits(id)) refuse('other');
  return { service: 'deezer', kind: type === 'track' ? 'song' : 'album', id, country: null, url: 'https://www.deezer.com/' + type + '/' + id };
}

function appleLink(u, parts) {
  let country = 'us';
  if (/^[a-z]{2}$/i.test(parts[0] || '')) { country = parts[0].toLowerCase(); parts = parts.slice(1); }
  // Old iTunes links write the number as "id594061854".
  if (parts.length > 1) parts[parts.length - 1] = parts[parts.length - 1].replace(/^id(?=\d)/, '');
  const type = parts[0], last = parts[parts.length - 1];
  if (MANY[type]) refuse('many', MANY[type]);
  const base = 'https://music.apple.com/' + country + '/';
  if (type === 'song' && parts.length > 1 && digits(last)) {
    return { service: 'apple', kind: 'song', id: last, country, url: base + parts.join('/') };
  }
  if (type === 'album' && parts.length > 1 && digits(last)) {
    const track = u.searchParams.get('i');
    const url = base + parts.join('/');
    if (digits(track)) return { service: 'apple', kind: 'song', id: track, country, url: url + '?i=' + track };
    return { service: 'apple', kind: 'album', id: last, country, url };
  }
  return refuse('other');
}

/** The link as the page shows it: without its scheme. */
export const display = (url) => url.replace(/^https?:\/\/(www\.)?/, '');

// ---------------------------------------------------------------------------------------------
// Comparing what two catalogues call the same thing
// ---------------------------------------------------------------------------------------------

const CREDIT = /^(feat|ft|featuring|with)\b/i;
const EDITION = /\b(remaster(ed)?|(album|single|original|lp|studio) version|mono|stereo|deluxe|expanded|anniversary|bonus|edition|explicit|clean)\b/i;
const extra = (s) => CREDIT.test(s.trim()) || EDITION.test(s);

/**
 * The title without what the services add to it: "(feat. X)", "- 2004 Remaster", "(Deluxe Edition)",
 * "- Single". A live take, a remix or a radio edit keeps its words: those are other recordings.
 */
export function plainTitle(title) {
  let t = String(title || '');
  t = t.replace(/\s*[([]([^()[\]]*)[)\]]/g, (all, inner) => (extra(inner) ? '' : all));
  for (;;) {
    const cut = /\s+[-–—]\s+([^-–—]+)$/.exec(t);
    if (!cut || !(extra(cut[1]) || /^(single|ep)$/i.test(cut[1].trim()))) break;
    t = t.slice(0, cut.index);
  }
  t = t.replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/i, '');
  return t.trim() || String(title || '').trim();
}

const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[&+]/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** A title as it is compared: plain, without accents, case and punctuation. */
export const titleKey = (title) => fold(plainTitle(title)) || String(title || '').trim().toLowerCase();

const artistKey = (name) => fold(name).replace(/^the /, '');
const firstArtist = (name) => artistKey(String(name || '').split(/\s*(?:,|;|\/|&|\bfeat\.?|\bft\.?|\bfeaturing\b)\s*/i)[0]);

/** The same artist: the names agree, or the first name of each does ("A & B" and "A feat. B"). */
export function sameArtist(a, b) {
  const ka = artistKey(a), kb = artistKey(b);
  if (!ka || !kb) return false;
  return ka === kb || firstArtist(a) === firstArtist(b);
}

const gap = (want, c) => {
  if (want.kind === 'album') return want.count && c.count ? Math.abs(want.count - c.count) : Infinity;
  return want.durationMs && c.durationMs ? Math.abs(want.durationMs - c.durationMs) : Infinity;
};
const close = (want, c) => (want.kind === 'album' ? gap(want, c) === 0 : gap(want, c) <= DURATION_WINDOW_MS);

/**
 * The candidate that is [want] on another service. Title and artist must agree; among those the
 * closest length wins (for an album, the number of songs). 'exact' only when the length agrees
 * too, otherwise 'guess'. null when no candidate has the title and the artist.
 */
export function pickMatch(want, candidates) {
  const key = titleKey(want.title);
  let best = null;
  for (const c of candidates) {
    if (titleKey(c.title) !== key || !sameArtist(c.artist, want.artist)) continue;
    if (!best || gap(want, c) < gap(want, best)) best = c;
  }
  return best ? { item: best, mark: close(want, best) ? 'exact' : 'guess' } : null;
}

// ---------------------------------------------------------------------------------------------
// The services
// ---------------------------------------------------------------------------------------------

export const SERVICES = [
  { id: 'apple', name: 'Apple Music' },
  { id: 'deezer', name: 'Deezer' },
  { id: 'spotify', name: 'Spotify' },
  { id: 'ytmusic', name: 'YouTube Music' },
  { id: 'youtube', name: 'YouTube' },
  { id: 'tidal', name: 'TIDAL' },
  { id: 'amazon', name: 'Amazon Music' },
  { id: 'soundcloud', name: 'SoundCloud' },
];
export const serviceName = (id) => (SERVICES.find((s) => s.id === id) || { name: id }).name;

const path = (q) => encodeURIComponent(q);
const plus = (q) => encodeURIComponent(q).replace(/%20/g, '+');

/** The service's own search, with [q] already typed in. */
export function searchUrl(id, q) {
  switch (id) {
    case 'apple': return 'https://music.apple.com/search?term=' + plus(q);
    case 'deezer': return 'https://www.deezer.com/search/' + path(q);
    case 'spotify': return 'https://open.spotify.com/search/' + path(q);
    case 'ytmusic': return 'https://music.youtube.com/search?q=' + plus(q);
    case 'youtube': return 'https://www.youtube.com/results?search_query=' + plus(q);
    case 'tidal': return 'https://tidal.com/search?q=' + plus(q);
    case 'amazon': return 'https://music.amazon.com/search/' + path(q);
    case 'soundcloud': return 'https://soundcloud.com/search?q=' + plus(q);
    default: throw new Error('unknown service ' + id);
  }
}

/** What the searches are filled in with: "artist title". */
export const queryOf = (item) => [item.artist, plainTitle(item.title)].filter(Boolean).join(' ');

/**
 * One entry per service, in the order of SERVICES. [found] maps a service to { url, mark, note }
 * for the ones that open the song itself; every other service is a search.
 */
export function buildServices(item, found) {
  const q = queryOf(item);
  return SERVICES.map((s) => (found[s.id]
    ? { id: s.id, name: s.name, ...found[s.id] }
    : { id: s.id, name: s.name, url: searchUrl(s.id, q), mark: 'search', note: null }));
}

/** The plain text "Copy all links" puts on the clipboard. [words] are the page's: { guess, search }. */
export function copyText(result, words) {
  const head = [[result.title, result.artist].filter(Boolean).join(' – ')];
  if (result.kind === 'song' && result.album) head.push(result.album);
  const lines = result.services.map((s) => {
    const tag = s.mark === 'guess' ? ' (' + words.guess + ')' : s.mark === 'search' ? ' (' + words.search + ')' : '';
    return s.name + tag + ': ' + s.url;
  });
  return head.join('\n') + '\n\n' + lines.join('\n');
}

/** 257000 -> "4:17". */
export function clock(ms) {
  const s = Math.round(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// ---------------------------------------------------------------------------------------------
// Asking: fetch for the services that allow it, a script tag (JSONP) for Deezer
// ---------------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * JSON from [url]. 400 and 404 are "not-found"; no answer within [timeout], a network error or a
 * body that is not JSON are "no-answer" with the service's [name]. A 403, 429 or 5xx is asked again
 * up to [retries] times within the same timeout: the iTunes search refuses a request now and then.
 */
export async function getJson(url, { name = '', timeout = TIMEOUT, retries = 0, fetch = globalThis.fetch, wait = sleep } = {}) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeout);
  try {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(url, { signal: control.signal, credentials: 'omit' });
      } catch (e) {
        throw new ToolError('no-answer', name);
      }
      if (res.status === 400 || res.status === 404) throw new ToolError('not-found', name);
      if (res.ok) {
        try { return await res.json(); } catch (e) { throw new ToolError('no-answer', name); }
      }
      if (attempt >= retries) throw new ToolError('no-answer', name);
      await wait(700 * (attempt + 1));
      if (control.signal.aborted) throw new ToolError('no-answer', name);
    }
  } finally {
    clearTimeout(timer);
  }
}

let serial = 0;

/**
 * Deezer's API has no CORS headers, so it is called the way it offers: a script tag whose answer
 * calls a function. A script that fails to load, or no call within [timeout], is "no-answer";
 * Deezer's own "no data" is "not-found". The tag and the function are removed either way.
 */
export function jsonp(url, { name = '', timeout = TIMEOUT, doc = globalThis.document, scope = globalThis } = {}) {
  return new Promise((resolve, reject) => {
    const cb = 'trackhopLink' + (++serial);
    const script = doc.createElement('script');
    let done = false;
    const finish = (late) => {
      done = true;
      clearTimeout(timer);
      script.remove();
      // An answer that comes after the timeout must find a function, or it is an error in the console.
      if (late) scope[cb] = () => { delete scope[cb]; }; else delete scope[cb];
    };
    const timer = setTimeout(() => { if (!done) { finish(true); reject(new ToolError('no-answer', name)); } }, timeout);
    scope[cb] = (data) => {
      if (done) return;
      finish(false);
      const err = data && data.error;
      if (err) reject(new ToolError(err.code === 800 ? 'not-found' : 'no-answer', name));
      else resolve(data);
    };
    script.onerror = () => { if (!done) { finish(false); reject(new ToolError('no-answer', name)); } };
    script.async = true;
    script.src = url + (url.includes('?') ? '&' : '?') + 'output=jsonp&callback=' + cb;
    doc.head.append(script);
  });
}

/** The two ways of asking, as lookup() takes them. The tests hand in their own. */
export const browserNet = { json: getJson, jsonp };

// ---------------------------------------------------------------------------------------------
// The catalogues
// ---------------------------------------------------------------------------------------------

const ITUNES = 'https://itunes.apple.com/';
const DEEZER = 'https://api.deezer.com/';
const year = (date) => (/^\d{4}/.exec(date || '') || [null])[0];
const clean = (url) => String(url || '').replace(/[?&]uo=\d+/, '');

function fromItunes(r) {
  const album = r.wrapperType === 'collection';
  return {
    kind: album ? 'album' : 'song',
    title: album ? r.collectionName : r.trackName,
    artist: r.artistName || '',
    album: album ? null : r.collectionName || null,
    durationMs: album ? null : r.trackTimeMillis || null,
    count: album ? r.trackCount || null : null,
    year: year(r.releaseDate),
    art: r.artworkUrl100 ? r.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.') : null,
    url: clean(album ? r.collectionViewUrl : r.trackViewUrl),
  };
}
const itunesItems = (data, kind) => ((data && data.results) || [])
  .filter((r) => (kind === 'album' ? r.wrapperType === 'collection' : r.wrapperType === 'track' && r.kind === 'song'))
  .map(fromItunes).filter((i) => i.title && i.url);

function fromDeezer(r, kind) {
  const album = kind === 'album';
  const cover = album ? r : r.album || {};
  return {
    kind,
    title: r.title || '',
    artist: (r.artist && r.artist.name) || '',
    album: album ? null : (r.album && r.album.title) || null,
    durationMs: album ? null : r.duration ? r.duration * 1000 : null,
    count: album ? r.nb_tracks || null : null,
    year: year(r.release_date),
    art: cover.cover_big || cover.cover_medium || null,
    url: 'https://www.deezer.com/' + (album ? 'album' : 'track') + '/' + r.id,
    isrc: r.isrc || null,
  };
}

async function appleGet(link, net) {
  const entity = link.kind === 'album' ? 'album' : 'song';
  const data = await net.json(ITUNES + 'lookup?id=' + link.id + '&entity=' + entity + '&country=' + link.country, { name: 'Apple Music', retries: 2 });
  const item = itunesItems(data, link.kind)[0];
  if (!item) throw new ToolError('not-found', 'Apple Music');
  return item;
}

async function deezerGet(link, net) {
  const data = await net.jsonp(DEEZER + (link.kind === 'album' ? 'album/' : 'track/') + link.id, { name: 'Deezer' });
  if (!data || !data.id || !data.title) throw new ToolError('not-found', 'Deezer');
  return fromDeezer(data, link.kind);
}

async function itunesSearch(term, kind, country, net) {
  const url = ITUNES + 'search?term=' + plus(term) + '&entity=' + (kind === 'album' ? 'album' : 'song') + '&country=' + (country || 'us') + '&limit=25';
  return itunesItems(await net.json(url, { name: 'Apple Music', retries: 2 }), kind);
}

// The plain query: Deezer's artist:"…" track:"…" form came back empty when it was tried.
async function deezerSearch(term, kind, net) {
  const data = await net.jsonp(DEEZER + (kind === 'album' ? 'search/album' : 'search') + '?q=' + path(term) + '&limit=10', { name: 'Deezer' });
  return ((data && data.data) || []).filter((r) => r && r.id && r.title).map((r) => fromDeezer(r, kind));
}

// ---------------------------------------------------------------------------------------------
// The lookup
// ---------------------------------------------------------------------------------------------

const noteOf = (mark) => (mark === 'exact' ? 'same' : 'differs');
const found = (match) => (match ? { url: match.item.url, mark: match.mark, note: noteOf(match.mark) } : null);
const pasted = (link) => ({ url: link.url, mark: 'exact', note: 'pasted' });

const silent = (e) => e instanceof ToolError && e.code === 'no-answer';
/**
 * The other catalogue not answering is lived with: its button becomes a search, and says so. (The
 * iTunes search refuses a request now and then.) The service the link is from must answer.
 */
const quiet = (search) => search.catch((e) => { if (silent(e)) return []; throw e; });

/**
 * Everything the page shows for a link, or a ToolError and nothing: there is no half result.
 * { kind, source, sourceUrl, title, artist, album, durationMs, count, year, art, guess, alts, services, query }.
 * From Spotify only the title is known: the artist is a guess, [artist] (the visitor's
 * correction) replaces it, and [alts] are the other artists with a song of that title.
 */
export async function lookup(link, net = browserNet, { artist } = {}) {
  if (link.service === 'spotify') return spotifyResult(await spotifyBase(link, net), artist, net);
  const services = {};
  let item;
  if (link.service === 'apple') {
    item = await appleGet(link, net);
    const match = found(pickMatch(item, await quiet(deezerSearch(queryOf(item), item.kind, net))));
    services.apple = pasted(link);
    if (match) services.deezer = match;
  } else {
    item = await deezerGet(link, net);
    const match = found(pickMatch(item, await quiet(itunesSearch(queryOf(item), item.kind, 'us', net))));
    services.deezer = pasted(link);
    if (match) services.apple = match;
  }
  return result(link, item, services, { guess: false, alts: [] });
}

function result(link, item, services, more) {
  return {
    kind: link.kind, source: link.service, sourceUrl: link.url,
    title: item.title, artist: item.artist || '', album: item.album || null,
    durationMs: item.durationMs || null, count: item.count || null, year: item.year || null, art: item.art || null,
    ...more,
    services: buildServices(item, services), query: queryOf(item),
  };
}

/**
 * What Spotify gives (the title and a cover), and what the two open catalogues have under that
 * title: the candidates for the artist. One catalogue not answering is lived with (its button
 * becomes a search, and says so); both silent is an error.
 */
export async function spotifyBase(link, net = browserNet) {
  const data = await net.json('https://open.spotify.com/oembed?url=' + encodeURIComponent(link.url), { name: 'Spotify' });
  if (!data || !data.title) throw new ToolError('not-found', 'Spotify');
  const key = titleKey(data.title), term = plainTitle(data.title);
  const ask = async (search) => {
    try { return (await search()).filter((c) => titleKey(c.title) === key); } catch (e) { if (silent(e)) return null; throw e; }
  };
  const [apple, deezer] = await Promise.all([
    ask(() => itunesSearch(term, link.kind, link.country, net)),
    ask(() => deezerSearch(term, link.kind, net)),
  ]);
  if (!apple && !deezer) throw new ToolError('no-answer', 'Apple Music');
  return { link, title: data.title, art: data.thumbnail_url || null, apple, deezer };
}

/**
 * The artists a title alone may mean, the likeliest first. Both catalogues list what is played
 * most near the top, and a well-known song is there more than once (the album, a best-of, a
 * remaster): each release counts for more the higher it stands, and the counts add up.
 */
function ranked(base) {
  const apple = base.apple || [], deezer = base.deezer || [];
  const names = [];
  for (const c of [...deezer, ...apple]) if (c.artist && !names.some((n) => sameArtist(n, c.artist))) names.push(c.artist);
  const weight = (list, name) => list.reduce((sum, c, at) => (sameArtist(c.artist, name) ? sum + 1 / (at + 1) : sum), 0);
  // Apple's spelling of the name where it has one: it is the one shown.
  const shown = (name) => (apple.find((c) => sameArtist(c.artist, name)) || { artist: name }).artist;
  return names.map((name, at) => ({ name: shown(name), score: weight(apple, name) + weight(deezer, name), at }))
    .sort((x, y) => y.score - x.score || x.at - y.at).map((x) => x.name);
}

/** The result for a Spotify link with [artist], or with the most likely artist when none is given. */
export async function spotifyResult(base, artist, net = browserNet) {
  const { link, title } = base;
  const order = ranked(base);
  const typed = String(artist || '').trim();
  const name = typed || order[0] || '';
  const services = { spotify: pasted(link) };
  const by = (list) => (name && list ? list.find((c) => sameArtist(c.artist, name)) || null : null);
  let apple = by(base.apple), deezer = null;
  if (name) {
    const first = apple || by(base.deezer);
    // The catalogue's spelling of the name, when it has one.
    const want = { kind: link.kind, title, artist: first ? first.artist : name, durationMs: apple && apple.durationMs, count: apple && apple.count };
    const q = queryOf(want);
    const match = (list) => (pickMatch(want, list) || {}).item || null;
    // An artist the title searches did not bring up gets a search of its own, where the catalogue answers.
    if (!apple && base.apple) apple = match(await quiet(itunesSearch(q, link.kind, link.country, net)));
    deezer = match(base.deezer || []);
    if (!deezer && base.deezer) deezer = match(await quiet(deezerSearch(q, link.kind, net)));
  }
  // Both are real pages of a song with this title by the guessed artist: a guess, never "exact".
  const guessed = (c) => ({ url: c.url, mark: 'guess', note: 'guessed', label: plainTitle(c.title) + ', ' + c.artist });
  if (apple) services.apple = guessed(apple);
  if (deezer) services.deezer = guessed(deezer);
  const known = apple || deezer || {};
  const item = {
    title, artist: known.artist || name,
    album: known.album, durationMs: known.durationMs, count: known.count, year: known.year, art: base.art || known.art,
  };
  const alts = order.filter((n) => !sameArtist(n, item.artist)).slice(0, 4);
  return result(link, item, services, { guess: true, alts });
}
