// node --test docs/assets/tools/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLink, display, plainTitle, titleKey, sameArtist, pickMatch, searchUrl, queryOf, buildServices, copyText, clock,
  getJson, jsonp, lookup, spotifyBase, spotifyResult, SERVICES } from './link.js';
import { ToolError } from './io.js';

const refuses = (fn, code, detail) => assert.throws(fn, (e) => e instanceof ToolError && e.code === code && (detail == null || e.detail === detail));
const rejects = (p, code, detail) => assert.rejects(p, (e) => e instanceof ToolError && e.code === code && (detail == null || e.detail === detail));

// ---- Links ----

test('Apple Music: a song is an album link with ?i=, or a /song/ link', () => {
  assert.deepEqual(parseLink('https://music.apple.com/us/album/dreams/594061854?i=594061857'),
    { service: 'apple', kind: 'song', id: '594061857', country: 'us', url: 'https://music.apple.com/us/album/dreams/594061854?i=594061857' });
  assert.deepEqual(parseLink('https://music.apple.com/it/song/dreams/594061857'),
    { service: 'apple', kind: 'song', id: '594061857', country: 'it', url: 'https://music.apple.com/it/song/dreams/594061857' });
  const tracked = parseLink('https://music.apple.com/gb/album/dreams/594061854?i=594061857&uo=4&at=abc');
  assert.equal(tracked.url, 'https://music.apple.com/gb/album/dreams/594061854?i=594061857');
  assert.equal(tracked.country, 'gb');
});

test('Apple Music: an album, with or without its name, the storefront, iTunes and geo hosts', () => {
  assert.deepEqual(parseLink('https://music.apple.com/us/album/rumours/594061854'),
    { service: 'apple', kind: 'album', id: '594061854', country: 'us', url: 'https://music.apple.com/us/album/rumours/594061854' });
  assert.equal(parseLink('https://music.apple.com/album/594061854').country, 'us');
  assert.equal(parseLink('https://music.apple.com/album/594061854').id, '594061854');
  assert.equal(parseLink('https://itunes.apple.com/de/album/rumours/id594061854').kind, 'album');
  assert.equal(parseLink('https://itunes.apple.com/de/album/rumours/594061854?i=594061857').kind, 'song');
  assert.equal(parseLink('https://geo.music.apple.com/fr/album/rumours/594061854?app=music').country, 'fr');
  assert.equal(parseLink('music.apple.com/us/album/rumours/594061854').kind, 'album');
});

test('Deezer: track and album, with a language, www or not', () => {
  assert.deepEqual(parseLink('https://www.deezer.com/track/63480987'),
    { service: 'deezer', kind: 'song', id: '63480987', country: null, url: 'https://www.deezer.com/track/63480987' });
  assert.deepEqual(parseLink('https://deezer.com/it/album/6237061?utm_source=x'),
    { service: 'deezer', kind: 'album', id: '6237061', country: null, url: 'https://www.deezer.com/album/6237061' });
  assert.equal(parseLink('https://www.deezer.com/en/track/63480987').id, '63480987');
  assert.equal(parseLink('deezer.com/track/63480987').kind, 'song');
});

test('Spotify: track and album, intl-xx, ?si=, a URI, a share text', () => {
  assert.deepEqual(parseLink('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc'),
    { service: 'spotify', kind: 'song', id: '4uLU6hMCjMI75M1A2tKUQC', country: null, url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC' });
  assert.deepEqual(parseLink('https://open.spotify.com/intl-it/album/4LH4d3cOWNNsVw41Gqt2kv'),
    { service: 'spotify', kind: 'album', id: '4LH4d3cOWNNsVw41Gqt2kv', country: 'it', url: 'https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv' });
  assert.equal(parseLink('spotify:track:4uLU6hMCjMI75M1A2tKUQC').url, 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC');
  assert.equal(parseLink('  Listen to this!\nhttps://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=1 so good ').id, '4uLU6hMCjMI75M1A2tKUQC');
  assert.equal(parseLink('https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC').kind, 'song');
});

test('refused: playlists, artists and podcasts are more than one song', () => {
  for (const url of ['https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', 'https://open.spotify.com/user/abc/playlist/37i9dQZF1DXcBWIGoYBM5M',
    'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M', 'https://www.deezer.com/en/playlist/908622995', 'https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb']) {
    refuses(() => parseLink(url), 'many', 'playlist');
  }
  for (const url of ['https://open.spotify.com/artist/08GQAI4eElDnROBrJRGE0X', 'https://www.deezer.com/artist/169', 'https://music.apple.com/us/artist/fleetwood-mac/158038']) {
    refuses(() => parseLink(url), 'many', 'artist');
  }
  for (const url of ['https://open.spotify.com/show/2MAi0BvDc6GTFvKFPXnkCL', 'https://open.spotify.com/episode/0Q86acNRm6V9GYx55SXKwf', 'https://www.deezer.com/show/1234',
    'https://www.deezer.com/episode/1234', 'https://podcasts.apple.com/us/podcast/x/id123']) {
    refuses(() => parseLink(url), 'many', 'podcast');
  }
});

test('refused: short links, other sites, other pages, no link at all', () => {
  for (const url of ['https://spotify.link/abc123', 'https://link.deezer.com/s/abc', 'https://deezer.page.link/abc', 'https://a.co/d/abc', 'https://amzn.to/abc', 'https://apple.co/abc', 'spotify.link/abc']) {
    refuses(() => parseLink(url), 'short');
  }
  for (const url of ['https://example.com/song/123', 'https://music.youtube.com/watch?v=abc', 'https://tidal.com/browse/track/1', 'https://soundcloud.com/a/b',
    'https://music.amazon.com/albums/B0', 'https://spotify.com/', 'https://evil.example/open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC']) {
    refuses(() => parseLink(url), 'site');
  }
  for (const url of ['https://open.spotify.com/', 'https://open.spotify.com/search/dreams', 'https://open.spotify.com/track/short', 'https://www.deezer.com/track/abc',
    'https://www.deezer.com/us/', 'https://music.apple.com/us/browse', 'https://music.apple.com/us/station/x/ra.1', 'https://music.apple.com/us/music-video/x/123',
    'https://music.apple.com/library/albums/l.abc', 'https://music.apple.com/us/album/x/594061854abc']) {
    refuses(() => parseLink(url), 'other');
  }
  refuses(() => parseLink(''), 'empty');
  refuses(() => parseLink('   '), 'empty');
  refuses(() => parseLink(null), 'empty');
  refuses(() => parseLink('dreams fleetwood mac'), 'not-link');
  refuses(() => parseLink('javascript:alert(1)'), 'not-link');
  refuses(() => parseLink('http://'), 'not-link');
});

test('display: the link without its scheme', () => {
  assert.equal(display('https://www.deezer.com/track/1'), 'deezer.com/track/1');
  assert.equal(display('https://open.spotify.com/track/x'), 'open.spotify.com/track/x');
});

// ---- Comparing ----

test('plainTitle: what the services add goes, what makes another recording stays', () => {
  assert.equal(plainTitle('Dreams (2004 Remaster)'), 'Dreams');
  assert.equal(plainTitle('Dreams - 2004 Remaster'), 'Dreams');
  assert.equal(plainTitle('Dreams – Remastered 2011'), 'Dreams');
  assert.equal(plainTitle('Under Pressure (feat. David Bowie) [Remastered]'), 'Under Pressure');
  assert.equal(plainTitle('Stay (with Justin Bieber)'), 'Stay');
  assert.equal(plainTitle('Stay With Me'), 'Stay With Me');
  assert.equal(plainTitle('Lean On feat. MØ'), 'Lean On');
  assert.equal(plainTitle('Space Oddity - 2015 Remaster - Mono'), 'Space Oddity');
  assert.equal(plainTitle('Rumours (Deluxe Edition)'), 'Rumours');
  assert.equal(plainTitle('Flowers - Single'), 'Flowers');
  assert.equal(plainTitle('Dreams (Live)'), 'Dreams (Live)');
  assert.equal(plainTitle('Dreams - Live at the Forum'), 'Dreams - Live at the Forum');
  assert.equal(plainTitle('Blue Monday (Radio Edit)'), 'Blue Monday (Radio Edit)');
  assert.equal(plainTitle("Love Story (Taylor's Version)"), "Love Story (Taylor's Version)");
  assert.equal(plainTitle('(Remastered)'), '(Remastered)');
});

test('titleKey: accents, case and punctuation do not count', () => {
  assert.equal(titleKey('Déjà Vu'), titleKey('DEJA VU'));
  assert.equal(titleKey("Don't Stop"), titleKey('Don’t  Stop'));
  assert.equal(titleKey('Rock & Roll'), titleKey('Rock and Roll'));
  assert.equal(titleKey('Dreams (2004 Remaster)'), 'dreams');
  assert.notEqual(titleKey('Dreams (Live)'), titleKey('Dreams'));
  assert.equal(titleKey('夜に駆ける'), '夜に駆ける');
  assert.equal(titleKey('!!!'), '!!!');
});

test('sameArtist: accents, "The", and the first of several names', () => {
  assert.ok(sameArtist('Beyoncé', 'BEYONCE'));
  assert.ok(sameArtist('The Beatles', 'Beatles'));
  assert.ok(sameArtist('Queen & David Bowie', 'Queen'));
  assert.ok(sameArtist('Major Lazer, DJ Snake', 'Major Lazer feat. MØ'));
  assert.ok(sameArtist('Florence + the Machine', 'Florence and The Machine'));
  assert.ok(sameArtist('Simon & Garfunkel', 'Simon and Garfunkel'));
  assert.ok(!sameArtist('Fleetwood Mac', 'The Cranberries'));
  assert.ok(!sameArtist('', 'Fleetwood Mac'));
  assert.ok(!sameArtist('Fleetwood Mac', null));
});

const song = (title, artist, seconds, more = {}) => ({ kind: 'song', title, artist, durationMs: seconds * 1000, url: 'u:' + title + ':' + artist + ':' + seconds, ...more });

test('pickMatch: exact needs title, artist and a length within 3 seconds', () => {
  const want = song('Dreams', 'Fleetwood Mac', 257.4);
  const list = [song('Dreams', 'The Cranberries', 257), song('Dreams (Live)', 'Fleetwood Mac', 257), song('Dreams (2004 Remaster)', 'Fleetwood Mac', 257), song('Dreams', 'Fleetwood Mac', 254)];
  const m = pickMatch(want, list);
  assert.equal(m.mark, 'exact');
  assert.equal(m.item, list[2]);
  assert.equal(pickMatch(want, [song('Dreams', 'Fleetwood Mac', 260.4)]).mark, 'exact');
  assert.equal(pickMatch(want, [song('Dreams', 'Fleetwood Mac', 254.3)]).mark, 'guess');
  assert.equal(pickMatch(want, [song('Dreams', 'Fleetwood Mac', 260.5)]).mark, 'guess');
});

test('pickMatch: the closest length wins; without title and artist there is nothing', () => {
  const want = song('Dreams', 'Fleetwood Mac', 257);
  const far = song('Dreams', 'Fleetwood Mac', 300), near = song('DREAMS', 'fleetwood mac', 262);
  assert.deepEqual(pickMatch(want, [far, near]), { item: near, mark: 'guess' });
  assert.equal(pickMatch(want, [song('Dreams', 'Beck', 257), song('Dream', 'Fleetwood Mac', 257)]), null);
  assert.equal(pickMatch(want, []), null);
  // A length that is not known cannot make it exact.
  assert.equal(pickMatch(want, [{ kind: 'song', title: 'Dreams', artist: 'Fleetwood Mac', durationMs: null, url: 'x' }]).mark, 'guess');
  assert.equal(pickMatch({ ...want, durationMs: null }, [far]).mark, 'guess');
});

test('pickMatch: an album is exact when the number of songs agrees', () => {
  const want = { kind: 'album', title: 'Rumours', artist: 'Fleetwood Mac', count: 11 };
  const deluxe = { kind: 'album', title: 'Rumours (Deluxe Edition)', artist: 'Fleetwood Mac', count: 31, url: 'd' };
  const plain = { kind: 'album', title: 'Rumours', artist: 'Fleetwood Mac', count: 11, url: 'p' };
  assert.deepEqual(pickMatch(want, [deluxe, plain]), { item: plain, mark: 'exact' });
  assert.deepEqual(pickMatch(want, [deluxe]), { item: deluxe, mark: 'guess' });
});

// ---- Buttons and the copied text ----

test('searchUrl: each service’s own search, filled in', () => {
  const q = 'Fleetwood Mac Dreams';
  assert.equal(searchUrl('spotify', q), 'https://open.spotify.com/search/Fleetwood%20Mac%20Dreams');
  assert.equal(searchUrl('ytmusic', q), 'https://music.youtube.com/search?q=Fleetwood+Mac+Dreams');
  assert.equal(searchUrl('youtube', q), 'https://www.youtube.com/results?search_query=Fleetwood+Mac+Dreams');
  assert.equal(searchUrl('tidal', q), 'https://tidal.com/search?q=Fleetwood+Mac+Dreams');
  assert.equal(searchUrl('amazon', q), 'https://music.amazon.com/search/Fleetwood%20Mac%20Dreams');
  assert.equal(searchUrl('soundcloud', q), 'https://soundcloud.com/search?q=Fleetwood+Mac+Dreams');
  assert.equal(searchUrl('deezer', q), 'https://www.deezer.com/search/Fleetwood%20Mac%20Dreams');
  assert.equal(searchUrl('tidal', 'AC/DC T.N.T. & more?'), 'https://tidal.com/search?q=AC%2FDC+T.N.T.+%26+more%3F');
  assert.equal(searchUrl('spotify', 'AC/DC #1'), 'https://open.spotify.com/search/AC%2FDC%20%231');
});

test('buildServices: exact, best guess and search, in a fixed order', () => {
  const item = { title: 'Dreams (2004 Remaster)', artist: 'Fleetwood Mac' };
  assert.equal(queryOf(item), 'Fleetwood Mac Dreams');
  const list = buildServices(item, { apple: { url: 'A', mark: 'exact', note: 'pasted' }, deezer: { url: 'D', mark: 'guess', note: 'differs' } });
  assert.deepEqual(list.map((s) => s.id), SERVICES.map((s) => s.id));
  assert.deepEqual(list.map((s) => s.mark), ['exact', 'guess', 'search', 'search', 'search', 'search', 'search', 'search']);
  assert.equal(list[2].url, 'https://open.spotify.com/search/Fleetwood%20Mac%20Dreams');
  // Nothing found on Deezer: its button is a search too.
  assert.equal(buildServices(item, {})[1].url, 'https://www.deezer.com/search/Fleetwood%20Mac%20Dreams');
});

test('copyText: the block "Copy all links" copies', () => {
  const services = buildServices({ title: 'Dreams', artist: 'Fleetwood Mac' }, {
    apple: { url: 'https://music.apple.com/us/album/dreams/594061854?i=594061857', mark: 'exact' },
    deezer: { url: 'https://www.deezer.com/track/63480987', mark: 'guess' },
  });
  const text = copyText({ kind: 'song', title: 'Dreams', artist: 'Fleetwood Mac', album: 'Rumours', services }, { guess: 'best guess', search: 'search' });
  assert.equal(text, [
    'Dreams – Fleetwood Mac',
    'Rumours',
    '',
    'Apple Music: https://music.apple.com/us/album/dreams/594061854?i=594061857',
    'Deezer (best guess): https://www.deezer.com/track/63480987',
    'Spotify (search): https://open.spotify.com/search/Fleetwood%20Mac%20Dreams',
    'YouTube Music (search): https://music.youtube.com/search?q=Fleetwood+Mac+Dreams',
    'YouTube (search): https://www.youtube.com/results?search_query=Fleetwood+Mac+Dreams',
    'TIDAL (search): https://tidal.com/search?q=Fleetwood+Mac+Dreams',
    'Amazon Music (search): https://music.amazon.com/search/Fleetwood%20Mac%20Dreams',
    'SoundCloud (search): https://soundcloud.com/search?q=Fleetwood+Mac+Dreams',
  ].join('\n'));
  const album = copyText({ kind: 'album', title: 'Rumours', artist: '', album: null, services: [{ name: 'Spotify', mark: 'exact', url: 'S' }] }, { guess: 'ipotesi', search: 'ricerca' });
  assert.equal(album, 'Rumours\n\nSpotify: S');
});

test('clock', () => {
  assert.equal(clock(257400), '4:17');
  assert.equal(clock(59600), '1:00');
  assert.equal(clock(3000), '0:03');
});

// ---- Asking ----

const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => { if (body === undefined) throw new SyntaxError('no json'); return body; } });
const noWait = () => Promise.resolve();

test('getJson: an answer, not found, and a body that is not JSON', async () => {
  const seen = [];
  const fetch = async (url, init) => { seen.push([url, init.credentials]); return answer(200, { a: 1 }); };
  assert.deepEqual(await getJson('https://x/y', { fetch }), { a: 1 });
  assert.deepEqual(seen, [['https://x/y', 'omit']]);
  await rejects(getJson('u', { name: 'Spotify', fetch: async () => answer(404) }), 'not-found', 'Spotify');
  await rejects(getJson('u', { name: 'Spotify', fetch: async () => answer(400) }), 'not-found');
  await rejects(getJson('u', { name: 'Spotify', fetch: async () => answer(200) }), 'no-answer', 'Spotify');
});

test('getJson: a network error, a refusal, and a refusal that passes when asked again', async () => {
  await rejects(getJson('u', { name: 'Apple Music', fetch: async () => { throw new TypeError('Failed to fetch'); } }), 'no-answer', 'Apple Music');
  let calls = 0;
  await rejects(getJson('u', { name: 'Apple Music', fetch: async () => { calls++; return answer(403); }, wait: noWait }), 'no-answer');
  assert.equal(calls, 1);
  calls = 0;
  await rejects(getJson('u', { retries: 2, fetch: async () => { calls++; return answer(503); }, wait: noWait }), 'no-answer');
  assert.equal(calls, 3);
  calls = 0;
  assert.deepEqual(await getJson('u', { retries: 2, fetch: async () => (++calls < 2 ? answer(403) : answer(200, [1])), wait: noWait }), [1]);
  assert.equal(calls, 2);
});

test('getJson: no answer within the timeout', async () => {
  const hang = (url, { signal }) => new Promise((res, rej) => signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
  const t0 = Date.now();
  await rejects(getJson('u', { name: 'Spotify', timeout: 30, fetch: hang }), 'no-answer', 'Spotify');
  assert.ok(Date.now() - t0 < 1000);
  // The timeout also ends the waiting between two tries.
  await rejects(getJson('u', { timeout: 30, retries: 5, fetch: async () => answer(403), wait: () => new Promise((r) => setTimeout(r, 60)) }), 'no-answer');
});

/** A document that keeps the script tags it is given, and a window for the callbacks. */
function fakePage() {
  const scripts = [];
  const doc = {
    createElement: () => ({ remove() { this.removed = true; } }),
    head: { append: (s) => scripts.push(s) },
  };
  return { doc, scope: {}, scripts, callbackOf: (s) => /callback=(\w+)/.exec(s.src)[1] };
}

test('jsonp: the answer, and the tag and the function gone after it', async () => {
  const page = fakePage();
  const p = jsonp('https://api.deezer.com/track/1', { doc: page.doc, scope: page.scope });
  const s = page.scripts[0];
  assert.match(s.src, /^https:\/\/api\.deezer\.com\/track\/1\?output=jsonp&callback=trackhopLink\d+$/);
  page.scope[page.callbackOf(s)]({ id: 1, title: 'x' });
  assert.deepEqual(await p, { id: 1, title: 'x' });
  assert.ok(s.removed);
  assert.deepEqual(Object.keys(page.scope), []);
  const q = jsonp('https://api.deezer.com/search?q=a', { doc: page.doc, scope: page.scope });
  assert.match(page.scripts[1].src, /search\?q=a&output=jsonp&callback=/);
  page.scope[page.callbackOf(page.scripts[1])]({ data: [] });
  assert.deepEqual(await q, { data: [] });
});

test('jsonp: Deezer’s errors, a script that does not load, and a timeout', async () => {
  const page = fakePage();
  const missing = jsonp('u', { name: 'Deezer', doc: page.doc, scope: page.scope });
  page.scope[page.callbackOf(page.scripts[0])]({ error: { type: 'DataException', message: 'no data', code: 800 } });
  await rejects(missing, 'not-found', 'Deezer');
  const quota = jsonp('u', { name: 'Deezer', doc: page.doc, scope: page.scope });
  page.scope[page.callbackOf(page.scripts[1])]({ error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 } });
  await rejects(quota, 'no-answer', 'Deezer');
  const broken = jsonp('u', { name: 'Deezer', doc: page.doc, scope: page.scope });
  page.scripts[2].onerror();
  await rejects(broken, 'no-answer', 'Deezer');
  assert.ok(page.scripts[2].removed);
  assert.deepEqual(Object.keys(page.scope), []);

  const slow = jsonp('u', { name: 'Deezer', timeout: 20, doc: page.doc, scope: page.scope });
  await rejects(slow, 'no-answer', 'Deezer');
  assert.ok(page.scripts[3].removed);
  // The answer that comes too late finds a function, does nothing, and takes the function away.
  const late = page.callbackOf(page.scripts[3]);
  assert.equal(typeof page.scope[late], 'function');
  page.scope[late]({ id: 1 });
  assert.deepEqual(Object.keys(page.scope), []);
});

// ---- The lookup, with the services played by the test ----

const itunesSong = (id, name, artist, ms, album = 'Rumours') => ({ wrapperType: 'track', kind: 'song', trackId: id, trackName: name, artistName: artist, collectionName: album,
  trackTimeMillis: ms, releaseDate: '1977-02-04T08:00:00Z', artworkUrl100: 'https://is1-ssl.mzstatic.com/a/100x100bb.jpg', trackViewUrl: 'https://music.apple.com/us/album/x/1?i=' + id + '&uo=4' });
const deezerSong = (id, title, artist, seconds) => ({ id, title, duration: seconds, artist: { name: artist }, album: { title: 'Rumours', cover_big: 'https://cdn-images.dzcdn.net/c.jpg' }, isrc: 'USWB10400046' });

/** A net that answers by the first matching piece of the URL, and keeps what it was asked. */
function fakeNet(routes) {
  const asked = [];
  const ask = (via) => async (url, opts) => {
    asked.push(via + ' ' + url);
    for (const [piece, reply] of routes) {
      if (!url.includes(piece)) continue;
      if (reply instanceof Error) throw reply;
      return typeof reply === 'function' ? reply(url, opts) : reply;
    }
    throw new Error('unexpected request ' + url);
  };
  return { json: ask('fetch'), jsonp: ask('jsonp'), asked };
}
const marks = (r) => Object.fromEntries(r.services.map((s) => [s.id, s.mark]));

test('from Apple Music: Deezer is exact when title, artist and length agree', async () => {
  const net = fakeNet([
    ['itunes.apple.com/lookup', { resultCount: 1, results: [itunesSong(594061857, 'Dreams', 'Fleetwood Mac', 257800)] }],
    ['api.deezer.com/search', { data: [deezerSong(1, 'Dreams', 'The Cranberries', 257), deezerSong(63480987, 'Dreams (2004 Remaster)', 'Fleetwood Mac', 257)] }],
  ]);
  const r = await lookup(parseLink('https://music.apple.com/gb/album/dreams/594061854?i=594061857'), net);
  assert.deepEqual(net.asked, [
    'fetch https://itunes.apple.com/lookup?id=594061857&entity=song&country=gb',
    'jsonp https://api.deezer.com/search?q=Fleetwood%20Mac%20Dreams&limit=10',
  ]);
  assert.deepEqual(marks(r), { apple: 'exact', deezer: 'exact', spotify: 'search', ytmusic: 'search', youtube: 'search', tidal: 'search', amazon: 'search', soundcloud: 'search' });
  assert.equal(r.services[0].url, 'https://music.apple.com/gb/album/dreams/594061854?i=594061857');
  assert.equal(r.services[0].note, 'pasted');
  assert.deepEqual(r.services[1], { id: 'deezer', name: 'Deezer', url: 'https://www.deezer.com/track/63480987', mark: 'exact', note: 'same' });
  assert.equal(r.title, 'Dreams');
  assert.equal(r.artist, 'Fleetwood Mac');
  assert.equal(r.album, 'Rumours');
  assert.equal(r.durationMs, 257800);
  assert.equal(r.art, 'https://is1-ssl.mzstatic.com/a/600x600bb.jpg');
  assert.equal(r.query, 'Fleetwood Mac Dreams');
  assert.equal(r.guess, false);
});

test('from Apple Music: another length is a best guess, nothing fitting is a search', async () => {
  const apple = ['itunes.apple.com/lookup', { results: [itunesSong(1, 'Dreams', 'Fleetwood Mac', 257800)] }];
  const guess = await lookup(parseLink('https://music.apple.com/us/song/dreams/1'), fakeNet([apple, ['api.deezer.com/search', { data: [deezerSong(7, 'Dreams', 'Fleetwood Mac', 301)] }]]));
  assert.deepEqual(guess.services[1], { id: 'deezer', name: 'Deezer', url: 'https://www.deezer.com/track/7', mark: 'guess', note: 'differs' });
  const none = await lookup(parseLink('https://music.apple.com/us/song/dreams/1'), fakeNet([apple, ['api.deezer.com/search', { data: [deezerSong(7, 'Dreams', 'Beck', 257)] }]]));
  assert.deepEqual(none.services[1], { id: 'deezer', name: 'Deezer', url: 'https://www.deezer.com/search/Fleetwood%20Mac%20Dreams', mark: 'search', note: null });
  const empty = await lookup(parseLink('https://music.apple.com/us/song/dreams/1'), fakeNet([apple, ['api.deezer.com/search', { data: [] }]]));
  assert.equal(empty.services[1].mark, 'search');
});

test('from Apple Music: an album asks the album search and compares the number of songs', async () => {
  const net = fakeNet([
    ['itunes.apple.com/lookup', { results: [{ wrapperType: 'collection', collectionName: 'Rumours', artistName: 'Fleetwood Mac', trackCount: 11, releaseDate: '1977-02-04T08:00:00Z',
      artworkUrl100: 'https://x/100x100bb.jpg', collectionViewUrl: 'https://music.apple.com/us/album/rumours/594061854?uo=4' }] }],
    ['api.deezer.com/search/album', { data: [{ id: 9, title: 'Rumours (Deluxe Edition)', nb_tracks: 31, artist: { name: 'Fleetwood Mac' } }, { id: 6237061, title: 'Rumours', nb_tracks: 11, artist: { name: 'Fleetwood Mac' }, cover_big: 'c' }] }],
  ]);
  const r = await lookup(parseLink('https://music.apple.com/us/album/rumours/594061854'), net);
  assert.deepEqual(net.asked, ['fetch https://itunes.apple.com/lookup?id=594061854&entity=album&country=us', 'jsonp https://api.deezer.com/search/album?q=Fleetwood%20Mac%20Rumours&limit=10']);
  assert.equal(r.kind, 'album');
  assert.equal(r.count, 11);
  assert.equal(r.year, '1977');
  assert.deepEqual(r.services[1], { id: 'deezer', name: 'Deezer', url: 'https://www.deezer.com/album/6237061', mark: 'exact', note: 'same' });
});

test('from Deezer: Apple Music through the iTunes search', async () => {
  const net = fakeNet([
    ['api.deezer.com/track/63480987', deezerSong(63480987, 'Dreams (2004 Remaster)', 'Fleetwood Mac', 257)],
    ['itunes.apple.com/search', { results: [itunesSong(5, 'Dreams (Live)', 'Fleetwood Mac', 257000), itunesSong(202272624, 'Dreams', 'Fleetwood Mac', 254453), itunesSong(594061857, 'Dreams', 'Fleetwood Mac', 257800)] }],
  ]);
  const r = await lookup(parseLink('https://www.deezer.com/it/track/63480987'), net);
  assert.deepEqual(net.asked, ['jsonp https://api.deezer.com/track/63480987', 'fetch https://itunes.apple.com/search?term=Fleetwood+Mac+Dreams&entity=song&country=us&limit=25']);
  assert.deepEqual(r.services[0], { id: 'apple', name: 'Apple Music', url: 'https://music.apple.com/us/album/x/1?i=594061857', mark: 'exact', note: 'same' });
  assert.deepEqual(r.services[1], { id: 'deezer', name: 'Deezer', url: 'https://www.deezer.com/track/63480987', mark: 'exact', note: 'pasted' });
  assert.equal(r.title, 'Dreams (2004 Remaster)');
  assert.equal(r.durationMs, 257000);
  assert.equal(r.art, 'https://cdn-images.dzcdn.net/c.jpg');
});

test('a song that is not there, a service that does not answer: an error and no result', async () => {
  const link = parseLink('https://music.apple.com/us/song/dreams/1');
  await rejects(lookup(link, fakeNet([['itunes.apple.com/lookup', { resultCount: 0, results: [] }]])), 'not-found', 'Apple Music');
  await rejects(lookup(link, fakeNet([['itunes.apple.com/lookup', new ToolError('no-answer', 'Apple Music')]])), 'no-answer', 'Apple Music');
  // The song was read, but the other catalogue is silent: a whole result, where that button is a search.
  const alone = await lookup(link, fakeNet([['itunes.apple.com/lookup', { results: [itunesSong(1, 'Dreams', 'Fleetwood Mac', 257800)] }], ['api.deezer.com', new ToolError('no-answer', 'Deezer')]]));
  assert.deepEqual(alone.services.slice(0, 2).map((x) => x.mark), ['exact', 'search']);
  await rejects(lookup(link, fakeNet([['itunes.apple.com/lookup', { results: [itunesSong(1, 'Dreams', 'Fleetwood Mac', 257800)] }], ['api.deezer.com', new ToolError('not-found', 'Deezer')]])), 'not-found');
  const deezer = parseLink('https://www.deezer.com/track/5');
  await rejects(lookup(deezer, fakeNet([['api.deezer.com/track/5', new ToolError('not-found', 'Deezer')]])), 'not-found', 'Deezer');
  await rejects(lookup(deezer, fakeNet([['api.deezer.com/track/5', {}]])), 'not-found', 'Deezer');
  const refused = await lookup(deezer, fakeNet([['api.deezer.com/track/5', deezerSong(5, 'Dreams', 'Fleetwood Mac', 257)], ['itunes.apple.com/search', new ToolError('no-answer', 'Apple Music')]]));
  assert.deepEqual(refused.services.slice(0, 2).map((x) => x.mark), ['search', 'exact']);
  assert.equal(refused.services[0].url, 'https://music.apple.com/search?term=Fleetwood+Mac+Dreams');
  await rejects(lookup(deezer, fakeNet([['api.deezer.com/track/5', new ToolError('no-answer', 'Deezer')]])), 'no-answer', 'Deezer');
  await rejects(lookup(parseLink('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'), fakeNet([['open.spotify.com/oembed', new ToolError('not-found', 'Spotify')]])), 'not-found', 'Spotify');
});

const spotifyRoutes = () => [
  ['open.spotify.com/oembed', { title: 'Dreams - 2004 Remaster', thumbnail_url: 'https://image-cdn-fa.spotifycdn.com/image/x' }],
  ['term=Dreams&', { results: [itunesSong(13, 'Dreams', 'The Cranberries', 271000, 'Everybody Else Is Doing It'), itunesSong(11, 'Dreams', 'Fleetwood Mac', 257800), itunesSong(12, 'Dreams (Live)', 'Fleetwood Mac', 250000),
    itunesSong(14, 'Dreams', 'Fleetwood Mac', 254000, 'Greatest Hits'), itunesSong(15, 'Dreams', 'Beck', 297000, 'Colors'), itunesSong(16, 'Sweet Dreams', 'Eurythmics', 216000)] }],
  ['api.deezer.com/search?q=Dreams&', { data: [deezerSong(90, 'Dreams', 'Nobody Famous', 200), deezerSong(63480987, 'Dreams (2004 Remaster)', 'Fleetwood Mac', 257), deezerSong(91, 'Dreams', 'Fleetwood Mac', 300), deezerSong(77, 'Dreams', 'The Cranberries', 271)] }],
  ['term=Beck+Dreams', { results: [] }],
  ['api.deezer.com/search?q=Beck%20Dreams', { data: [deezerSong(55, 'Dreams', 'Beck', 297)] }],
  ['term=Gabrielle+Dreams', { results: [itunesSong(21, 'Dreams', 'Gabrielle', 223000, 'Find Your Way')] }],
  ['api.deezer.com/search?q=Gabrielle%20Dreams', { data: [] }],
  ['term=Nobody+Dreams', { results: [] }],
  ['api.deezer.com/search?q=Nobody%20Dreams', { data: [] }],
];

test('from Spotify: only the title is known, so the artist is a best guess', async () => {
  const net = fakeNet(spotifyRoutes());
  const r = await lookup(parseLink('https://open.spotify.com/intl-it/track/0ofHAoxe9vBkTCp2UQIavz?si=1'), net);
  assert.deepEqual(net.asked, [
    'fetch https://open.spotify.com/oembed?url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F0ofHAoxe9vBkTCp2UQIavz',
    'fetch https://itunes.apple.com/search?term=Dreams&entity=song&country=it&limit=25',
    'jsonp https://api.deezer.com/search?q=Dreams&limit=10',
  ]);
  assert.equal(r.guess, true);
  assert.equal(r.title, 'Dreams - 2004 Remaster');
  // High in both catalogues, and there more than once: before the first of either list.
  assert.equal(r.artist, 'Fleetwood Mac');
  assert.equal(r.album, 'Rumours');
  assert.equal(r.art, 'https://image-cdn-fa.spotifycdn.com/image/x');
  assert.deepEqual(r.alts, ['The Cranberries', 'Nobody Famous', 'Beck']);
  assert.deepEqual(marks(r), { apple: 'guess', deezer: 'guess', spotify: 'exact', ytmusic: 'search', youtube: 'search', tidal: 'search', amazon: 'search', soundcloud: 'search' });
  assert.deepEqual(r.services[2], { id: 'spotify', name: 'Spotify', url: 'https://open.spotify.com/track/0ofHAoxe9vBkTCp2UQIavz', mark: 'exact', note: 'pasted' });
  assert.equal(r.services[0].url, 'https://music.apple.com/us/album/x/1?i=11');
  // Of Deezer's two, the one as long as Apple's.
  assert.deepEqual(r.services[1], { id: 'deezer', name: 'Deezer', url: 'https://www.deezer.com/track/63480987', mark: 'guess', note: 'guessed', label: 'Dreams, Fleetwood Mac' });
  assert.equal(r.services[3].url, 'https://music.youtube.com/search?q=Fleetwood+Mac+Dreams');
});

test('from Spotify: the visitor corrects the artist', async () => {
  const net = fakeNet(spotifyRoutes());
  const base = await spotifyBase(parseLink('https://open.spotify.com/track/0ofHAoxe9vBkTCp2UQIavz'), net);
  assert.equal(base.apple.length, 4);
  assert.equal(base.deezer.length, 4);
  net.asked.length = 0;

  // One of the "Or was it" artists that both catalogues brought up: nothing more is asked.
  const other = await spotifyResult(base, 'the cranberries', net);
  assert.deepEqual(net.asked, []);
  assert.equal(other.artist, 'The Cranberries');
  assert.equal(other.album, 'Everybody Else Is Doing It');
  assert.equal(other.services[0].url, 'https://music.apple.com/us/album/x/1?i=13');
  assert.equal(other.services[1].url, 'https://www.deezer.com/track/77');
  assert.deepEqual(other.alts, ['Fleetwood Mac', 'Nobody Famous', 'Beck']);
  assert.equal(other.query, 'The Cranberries Dreams');

  // One that only Apple brought up: Deezer is asked for it.
  const beck = await spotifyResult(base, 'Beck', net);
  assert.deepEqual(net.asked, ['jsonp https://api.deezer.com/search?q=Beck%20Dreams&limit=10']);
  assert.equal(beck.services[1].url, 'https://www.deezer.com/track/55');

  // An artist the title searches did not bring up: a search with the name, on both sides.
  net.asked.length = 0;
  const typed = await spotifyResult(base, 'Gabrielle', net);
  assert.deepEqual(net.asked, ['fetch https://itunes.apple.com/search?term=Gabrielle+Dreams&entity=song&country=us&limit=25', 'jsonp https://api.deezer.com/search?q=Gabrielle%20Dreams&limit=10']);
  assert.deepEqual(marks(typed), { apple: 'guess', deezer: 'search', spotify: 'exact', ytmusic: 'search', youtube: 'search', tidal: 'search', amazon: 'search', soundcloud: 'search' });
  assert.equal(typed.services[1].url, 'https://www.deezer.com/search/Gabrielle%20Dreams');

  // An artist nobody has: the name is kept for the searches, and nothing pretends to be a song page.
  const nobody = await spotifyResult(base, 'Nobody', net);
  assert.equal(nobody.artist, 'Nobody');
  assert.equal(nobody.album, null);
  assert.deepEqual(marks(nobody), { apple: 'search', deezer: 'search', spotify: 'exact', ytmusic: 'search', youtube: 'search', tidal: 'search', amazon: 'search', soundcloud: 'search' });
  assert.equal(nobody.services[0].url, 'https://music.apple.com/search?term=Nobody+Dreams');
});

test('from Spotify: an album, and an artist only one catalogue has under that title', async () => {
  const album = (id, name, artist, n) => ({ wrapperType: 'collection', collectionName: name, artistName: artist, trackCount: n, collectionViewUrl: 'https://music.apple.com/us/album/x/' + id });
  const net = fakeNet([
    ['open.spotify.com/oembed', { title: 'The Dark Side of the Moon' }],
    ['itunes.apple.com/search', { results: [album(1, 'The Dark Side of the Moon - Single', 'Chimera', 2), album(2, 'The Dark Side of the Moon', 'Pink Floyd', 10)] }],
    ['api.deezer.com/search/album', { data: [{ id: 12114240, title: 'The Dark Side of the Moon', nb_tracks: 10, artist: { name: 'Pink Floyd' } }] }],
  ]);
  const r = await lookup(parseLink('https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv'), net);
  assert.deepEqual(net.asked.slice(1), ['fetch https://itunes.apple.com/search?term=The+Dark+Side+of+the+Moon&entity=album&country=us&limit=25', 'jsonp https://api.deezer.com/search/album?q=The%20Dark%20Side%20of%20the%20Moon&limit=10']);
  assert.equal(r.artist, 'Pink Floyd');
  assert.equal(r.services[0].url, 'https://music.apple.com/us/album/x/2');
  assert.equal(r.services[1].url, 'https://www.deezer.com/album/12114240');
  assert.deepEqual(r.alts, ['Chimera']);
  assert.equal(r.services[0].mark, 'guess');
});

test('from Spotify: one catalogue not answering leaves its button a search; both is an error', async () => {
  const oembed = ['open.spotify.com/oembed', { title: 'Dreams - 2004 Remaster' }];
  const deezer = ['api.deezer.com/search?q=Dreams&', { data: [deezerSong(63480987, 'Dreams (2004 Remaster)', 'Fleetwood Mac', 257), deezerSong(77, 'Dreams', 'The Cranberries', 271), deezerSong(79, 'Dreams', 'Fleetwood Mac', 254)] }];
  const link = parseLink('https://open.spotify.com/track/0ofHAoxe9vBkTCp2UQIavz');
  const net = fakeNet([oembed, ['itunes.apple.com/search', new ToolError('no-answer', 'Apple Music')], deezer]);
  const r = await lookup(link, net);
  assert.equal(net.asked.length, 3);
  assert.equal(r.artist, 'Fleetwood Mac');
  assert.deepEqual(r.alts, ['The Cranberries']);
  assert.deepEqual(marks(r), { apple: 'search', deezer: 'guess', spotify: 'exact', ytmusic: 'search', youtube: 'search', tidal: 'search', amazon: 'search', soundcloud: 'search' });
  assert.equal(r.services[1].url, 'https://www.deezer.com/track/63480987');
  assert.equal(r.services[0].url, 'https://music.apple.com/search?term=Fleetwood+Mac+Dreams');

  const noDeezer = await lookup(link, fakeNet([oembed, ['itunes.apple.com/search', { results: [itunesSong(11, 'Dreams', 'Fleetwood Mac', 257800)] }], ['api.deezer.com', new ToolError('no-answer', 'Deezer')]]));
  assert.deepEqual(marks(noDeezer), { apple: 'guess', deezer: 'search', spotify: 'exact', ytmusic: 'search', youtube: 'search', tidal: 'search', amazon: 'search', soundcloud: 'search' });

  await rejects(lookup(link, fakeNet([oembed, ['itunes.apple.com/search', new ToolError('no-answer', 'Apple Music')], ['api.deezer.com', new ToolError('no-answer', 'Deezer')]])), 'no-answer');

  // Apple answers for the title, then not for the corrected artist: still a whole result, with a search for Apple.
  const flaky = fakeNet([oembed, ['term=Dreams&', { results: [itunesSong(11, 'Dreams', 'Fleetwood Mac', 257800)] }], deezer, ['term=Gabrielle', new ToolError('no-answer', 'Apple Music')], ['api.deezer.com/search?q=Gabrielle', { data: [] }]]);
  const typed = await lookup(link, flaky, { artist: 'Gabrielle' });
  assert.equal(typed.artist, 'Gabrielle');
  assert.equal(typed.services[0].mark, 'search');
});

test('from Spotify: a title no catalogue song has leaves the artist empty', async () => {
  const net = fakeNet([['open.spotify.com/oembed', { title: 'Zzyzx Qwv' }], ['itunes.apple.com/search', { results: [itunesSong(1, 'Something Else', 'Someone', 1000)] }], ['api.deezer.com/search', { data: [] }]]);
  const r = await lookup(parseLink('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'), net);
  assert.equal(net.asked.length, 3);
  assert.equal(r.artist, '');
  assert.deepEqual(r.alts, []);
  assert.equal(r.query, 'Zzyzx Qwv');
  assert.deepEqual(marks(r), { apple: 'search', deezer: 'search', spotify: 'exact', ytmusic: 'search', youtube: 'search', tidal: 'search', amazon: 'search', soundcloud: 'search' });
  await rejects(lookup(parseLink('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'), fakeNet([['open.spotify.com/oembed', {}]])), 'not-found', 'Spotify');
});
