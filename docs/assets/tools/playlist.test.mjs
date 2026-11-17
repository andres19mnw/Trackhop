// node --test docs/assets/tools/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseText, readFile, detect, encode, encodeCsv, dedupe, parseDuration, fromPath, splitArtists, safeName, reader, CsvRows } from './playlist.js';
import { ToolError } from './io.js';

const names = (tracks) => tracks.map((t) => (t.artists.length ? t.artists.join(', ') + ' - ' : '') + t.title);
const file = (name, text) => Object.assign(new Blob([text]), { name });
/** Reads [text] in pieces of [size] characters: what a parser must stand, wherever the cut falls. */
function inPieces(name, text, size) {
  const r = reader(detect(name, text));
  for (let i = 0; i < text.length; i += size) r.push(text.slice(i, i + size));
  return r.end();
}
const refuses = (fn, code) => assert.throws(fn, (e) => e instanceof ToolError && e.code === code);

test('detect: by name and by content, as the app does', () => {
  assert.equal(detect('a.m3u8', 'x'), 'm3u');
  assert.equal(detect('a', '#EXTM3U\n'), 'm3u');
  assert.equal(detect('a', '[Playlist]\nFile1=x'), 'pls');
  assert.equal(detect('a.xml', '<?xml version="1.0"?><playlist xmlns="http://xspf.org/ns/0/">'), 'xspf');
  assert.equal(detect('a.xml', '<?xml version="1.0"?><opml version="2.0">'), 'opml');
  assert.equal(detect('Library.xml', '<?xml version="1.0"?>\n<!DOCTYPE plist>\n<plist version="1.0">'), 'itunes');
  assert.equal(detect('a', ' {"playlist":{}}'), 'json');
  assert.equal(detect('a.txt', 'Shazam Library\nIndex,TagTime,Title,Artist\n'), 'csv');
  assert.equal(detect('a.txt', 'Architects - Nihilist\n'), 'text');
});

test('CSV: our own columns, quotes and a field over two lines', () => {
  const r = parseText('a.csv', 'title,artist,album,duration_ms,isrc\r\n"Hello, ""World""",A & B,"Al\nbum",8000,GBUM71029604\r\n,nobody,,,\r\n');
  assert.deepEqual(r.tracks, [{ title: 'Hello, "World"', artists: ['A', 'B'], album: 'Al\nbum', durationMs: 8000, isrc: 'GBUM71029604', feedUrl: null, itunesId: null }]);
});

test('CSV: Exportify header, semicolons, tabs, no header', () => {
  const ex = parseText('Liked Songs.csv', '"Track URI","Track Name","Album Name","Artist Name(s)","Duration (ms)"\nspotify:track:1,"Nihilist","For Those That Wish to Exist","Architects",230000\n');
  assert.equal(ex.source, 'exportify');
  assert.deepEqual(ex.tracks[0], { title: 'Nihilist', artists: ['Architects'], album: 'For Those That Wish to Exist', durationMs: 230000, isrc: null, feedUrl: null, itunesId: null });
  assert.deepEqual(names(parseText('a.csv', 'Titolo;Artista;Durata\nVolare;Domenico Modugno;3:35\n').tracks), ['Domenico Modugno - Volare']);
  assert.equal(parseText('a.csv', 'Titolo;Artista;Durata\nVolare;Domenico Modugno;3:35\n').tracks[0].durationMs, 215000);
  assert.deepEqual(names(parseText('a.txt', 'Name\tArtist\tTime\nChaise Longue\tWet Leg\t197\n').tracks), ['Wet Leg - Chaise Longue']);
  assert.deepEqual(names(parseText('a.csv', 'Chaise Longue,Wet Leg,Wet Leg,197,\n').tracks), ['Wet Leg - Chaise Longue']);
});

test('CSV: Shazam preamble above the header', () => {
  const r = parseText('shazamlibrary.csv', 'Shazam Library\nIndex,TagTime,Title,Artist,URL,TrackKey\n1,2024-01-01,Starburster,Fontaines D.C.,https://x,1\n');
  assert.equal(r.source, 'shazam');
  assert.deepEqual(names(r.tracks), ['Fontaines D.C. - Starburster']);
});

test('CSV: the same rows whatever the size of the pieces', () => {
  const text = 'title,artist\r\n' + Array.from({ length: 50 }, (_, i) => `"Song ""${i}"", live","Artist ${i}"`).join('\r\n') + '\r\n';
  const whole = parseText('a.csv', text).tracks;
  assert.equal(whole.length, 50);
  assert.equal(whole[7].title, 'Song "7", live');
  for (const size of [1, 2, 3, 7, 64]) assert.deepEqual(inPieces('a.csv', text, size).tracks, whole);
});

test('CSV: a file that ends inside a quoted field is refused', () => {
  refuses(() => parseText('a.csv', 'title,artist\nOne,A\n"Two, cut sh'), 'incomplete');
});

test('M3U: EXTINF labels, durations, bare paths and a library layout', () => {
  const r = parseText('a.m3u', '#EXTM3U\n#EXTINF:215,Architects - Nihilist\nfile.mp3\n#EXTINF:-1,Just a title\nx.mp3\n/home/me/Music/Wet Leg/Wet Leg/01 Being in Love.mp3\nD:\\Stuff\\50 Cent - In da Club.mp3\n');
  assert.deepEqual(names(r.tracks), ['Architects - Nihilist', 'Just a title', 'Wet Leg - Being in Love', '50 Cent - In da Club']);
  assert.equal(r.tracks[0].durationMs, 215000);
  assert.equal(r.tracks[2].album, 'Wet Leg');
});

test('M3U: "Artist - Album - Title" when most names have three parts', () => {
  const r = parseText('a.m3u8', '#EXTM3U\n#EXTINF:1,SAULT - NINE - 01 Haha\na\n#EXTINF:1,SAULT - NINE - 02 Trap Life\nb\n');
  assert.deepEqual(r.tracks.map((t) => [t.artists[0], t.album, t.title]), [['SAULT', 'NINE', 'Haha'], ['SAULT', 'NINE', 'Trap Life']]);
});

test('fromPath: years, disc folders, file: URIs', () => {
  assert.deepEqual(fromPath('Music/Pink Floyd/1977 - Animals/CD1/02 Dogs.flac'), { title: 'Dogs', artists: ['Pink Floyd'], album: 'Animals', durationMs: 0, isrc: null, feedUrl: null, itunesId: null });
  assert.equal(fromPath('file:///C:/Music/Bj%C3%B6rk/Post/03%20Hyperballad.mp3').artists[0], 'Björk');
  assert.equal(fromPath('song.mp3').title, 'song');
});

test('PLS: titles, files and lengths, in the order of their numbers', () => {
  const r = parseText('a.pls', '[playlist]\nFile2=b.mp3\nTitle2=Arlo Parks - Eugene\nLength2=200\nFile1=/music/Idles - Gift Horse.mp3\nNumberOfEntries=2\n');
  assert.deepEqual(names(r.tracks), ['Idles - Gift Horse', 'Arlo Parks - Eugene']);
  assert.equal(r.tracks[1].durationMs, 200000);
});

test('plain text: numbered lists, comments and JSON punctuation skipped', () => {
  const r = parseText('list.txt', '# my list\n1. Architects – Nihilist\n2) Wet Leg - Chaise Longue\n\nJust a title\n[\n```\n');
  assert.deepEqual(names(r.tracks), ['Architects - Nihilist', 'Wet Leg - Chaise Longue', 'Just a title']);
});

const XSPF = '<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/">\n  <title>Mix</title>\n  <trackList>\n' +
  '    <track><title>Tom &amp; Jerry</title><creator>A, B</creator><album>X</album><duration>1000</duration><identifier>isrc:GBUM71029604</identifier></track>\n' +
  '    <track><creator>no title</creator></track>\n    <track><title>Two</title></track>\n  </trackList>\n</playlist>\n';

test('XSPF: tracks with their fields, whatever the size of the pieces', () => {
  const r = parseText('a.xspf', XSPF);
  assert.deepEqual(r.tracks[0], { title: 'Tom & Jerry', artists: ['A', 'B'], album: 'X', durationMs: 1000, isrc: 'GBUM71029604', feedUrl: null, itunesId: null });
  assert.deepEqual(names(r.tracks), ['A, B - Tom & Jerry', 'Two']);
  for (const size of [1, 5, 9, 33]) assert.deepEqual(inPieces('a.xspf', XSPF, size).tracks, r.tracks);
});

test('XSPF: cut short is refused', () => {
  refuses(() => parseText('a.xspf', XSPF.slice(0, XSPF.indexOf('<track><title>Two'))), 'incomplete');
  refuses(() => parseText('a.xspf', XSPF.slice(0, XSPF.indexOf('</creator><album>'))), 'incomplete');
});

test('OPML: shows with a feed; groups and comments skipped; cut short refused', () => {
  const opml = '<?xml version="1.0"?>\n<opml version="2.0"><body>\n<!-- <outline text="Hidden" xmlUrl="https://h/feed"/> -->\n<outline text="Group">\n' +
    '<outline type="rss" text="Song &amp; Dance" xmlUrl="https://a.example/feed?x=1&amp;y=2" htmlUrl="https://podcasts.apple.com/us/podcast/x/id123456"/>\n' +
    "<outline type='rss' title='Second > one' url='https://b.example/rss' itunes:author='Bee'/>\n</outline>\n</body></opml>\n";
  const r = parseText('subs.opml', opml);
  assert.deepEqual(r.tracks.map((t) => [t.title, t.feedUrl, t.itunesId, t.artists]), [
    ['Song & Dance', 'https://a.example/feed?x=1&y=2', '123456', []],
    ['Second > one', 'https://b.example/rss', null, ['Bee']],
  ]);
  for (const size of [1, 4, 17]) assert.deepEqual(inPieces('subs.opml', opml, size).tracks, r.tracks);
  assert.match(encodeCsv(r.tracks), /^title,artist,album,duration_ms,isrc,feed_url,itunes_id\r\n/);
  refuses(() => parseText('subs.opml', opml.slice(0, opml.indexOf('</body>'))), 'incomplete');
});

test('JSON: the longest array of objects with a title, fields in their shapes', () => {
  const json = JSON.stringify({
    playlists: [{ name: 'Mix', tracks: [
      { trackName: 'One', artists: [{ name: 'A' }, { name: 'B' }], album: { name: 'Alb' }, duration_ms: 230000, isrc: 'GBUM71029604' },
      { title: 'Two', artist: 'C', duration: 'PT3M25S' },
      { noTitle: true },
    ] }],
  });
  const r = parseText('a.json', json);
  assert.deepEqual(r.tracks.map((t) => [t.title, t.artists, t.album, t.durationMs, t.isrc]), [['One', ['A', 'B'], 'Alb', 230000, 'GBUM71029604'], ['Two', ['C'], '', 205000, null]]);
  for (const size of [1, 3, 10]) assert.deepEqual(inPieces('a.json', json, size).tracks, r.tracks);
});

test('JSON: escapes, numbers and words cut between two pieces', () => {
  const json = '[{"title":"A \\"quoted\\" \\u00e8 \\\\","duration":-12.5e1,"x":true,"y":null,"z":false},{"title":"B"} , ]';
  for (const size of [1, 2, 5, 1000]) {
    assert.deepEqual(inPieces('a.json', json, size).tracks.map((t) => t.title), ['A "quoted" è \\', 'B']);
  }
});

test('JSPF: read back with its ISRC', () => {
  const tracks = parseText('a.csv', 'title,artist,album,duration_ms,isrc\nOne,A,Alb,215999,gbum71029604\nTwo,,,,\n').tracks;
  const r = parseText('a.jspf', encode('jspf', 'Mix', tracks));
  assert.equal(r.source, 'jspf');
  assert.deepEqual(r.tracks.map((t) => [t.title, t.artists, t.album, t.durationMs, t.isrc]), [['One', ['A'], 'Alb', 215999, 'GBUM71029604'], ['Two', [], '', 0, null]]);
});

test('JSON: cut short or not JSON gives nothing', () => {
  refuses(() => parseText('a.json', '[{"title":"One"},{"title":"Tw'), 'incomplete');
  refuses(() => parseText('a.json', '{"tracks":[{"title":"One"}]'), 'incomplete');
  refuses(() => parseText('a.json', ''), 'incomplete');
  refuses(() => parseText('a.json', '[{"title":"One"}] trailing'), 'unreadable');
  refuses(() => parseText('a.json', '[{"title" "One"}]'), 'unreadable');
});

const dict = (o) => '<dict>' + Object.entries(o).map(([k, v]) => `<key>${k}</key>` + (v === true ? '<true/>' : v === false ? '<false/>' : typeof v === 'number' ? `<integer>${v}</integer>` : v)).join('') + '</dict>';
const str = (s) => `<string>${s}</string>`;
const items = (ids) => '<array>' + ids.map((id) => dict({ 'Track ID': id })).join('') + '</array>';
const LIBRARY = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n' +
  dict({
    'Major Version': 1,
    Tracks: '<dict>' + [
      [1, { 'Track ID': 1, Name: str('Nihilist'), Artist: str('Architects'), Album: str('For Those That Wish to Exist'), 'Total Time': 230000 }],
      [2, { 'Track ID': 2, Name: str('Tom &#38; Jerry &lt;live&gt;'), 'Album Artist': str('Simon &amp; Garfunkel') }],
      [3, { 'Track ID': 3, Name: str('Chaise Longue'), Artist: str('Wet Leg'), Location: str('file:///x.m4a') }],
      [4, { 'Track ID': 4, Artist: str('no name') }],
    ].map(([id, t]) => `<key>${id}</key>` + dict(t)).join('') + '</dict>',
    Playlists: '<array>' + [
      { Name: str('Library'), Master: true, 'Playlist ID': 10, 'Playlist Items': items([1, 2, 3]) },
      { Name: str('Music'), 'Distinguished Kind': 4, 'Playlist ID': 11, 'Playlist Items': items([1, 2, 3]) },
      { Name: str('Trips'), Folder: true, 'Playlist Persistent ID': str('F0LDER'), 'Playlist ID': 12 },
      { Name: str('Road Trip'), 'Playlist ID': 13, 'Playlist Persistent ID': str('AAA'), 'Parent Persistent ID': str('F0LDER'), 'Playlist Items': items([3, 1, 99]) },
      { Name: str('Most Played'), 'Playlist ID': 14, 'Smart Info': '<data>\nAQEAAwAAAAIAAAAZ\n</data>', 'Smart Criteria': '<data>U0xzdA==</data>', 'Playlist Items': items([2]) },
      { Name: str('Empty'), 'Playlist ID': 15 },
    ].map(dict).join('') + '</array>',
  }) + '\n</plist>\n';

test('iTunes library: songs, playlists and their kinds', () => {
  const { format, library } = parseText('Library.xml', LIBRARY);
  assert.equal(format, 'itunes');
  assert.equal(library.trackCount, 3);
  assert.deepEqual(library.playlists.map((p) => [p.name, p.kind, p.folder, p.trackIds.length]), [
    ['Library', 'system', null, 3], ['Music', 'system', null, 3], ['Trips', 'folder', null, 0],
    ['Road Trip', 'user', 'Trips', 3], ['Most Played', 'smart', null, 1], ['Empty', 'user', null, 0],
  ]);
  assert.ok(library.isLibrary && library.worthPicking);
  assert.deepEqual(library.choices.map((p) => p.name), ['Road Trip', 'Most Played', 'Empty']);
  // In the playlist's order; the item whose song is not in the file is skipped.
  assert.deepEqual(names(library.tracksOf(library.choices[0])), ['Wet Leg - Chaise Longue', 'Architects - Nihilist']);
  assert.deepEqual(library.tracksOf(library.choices[1])[0], { title: 'Tom & Jerry <live>', artists: ['Simon', 'Garfunkel'], album: '', durationMs: 0, isrc: null, feedUrl: null, itunesId: null });
  assert.equal(library.asOneList().length, 3);
});

test('iTunes library: the same whatever the size of the pieces', () => {
  const whole = parseText('Library.xml', LIBRARY).library;
  for (const size of [1, 2, 3, 11, 200]) {
    const lib = inPieces('Library.xml', LIBRARY, size).library;
    assert.deepEqual(lib.playlists.map((p) => [p.name, p.kind, [...p.trackIds]]), whole.playlists.map((p) => [p.name, p.kind, [...p.trackIds]]));
    assert.deepEqual(lib.asOneList(), whole.asOneList());
  }
});

test('iTunes: one exported playlist is one list, in its order', () => {
  const one = '<plist version="1.0">' + dict({
    Tracks: '<dict><key>1</key>' + dict({ 'Track ID': 1, Name: str('A') }) + '<key>2</key>' + dict({ 'Track ID': 2, Name: str('B') }) + '</dict>',
    Playlists: '<array>' + dict({ Name: str('Mine'), 'Playlist ID': 1, 'Playlist Items': items([2, 1]) }) + '</array>',
  }) + '</plist>';
  const { library } = parseText('Mine.xml', one);
  assert.ok(!library.isLibrary && !library.worthPicking);
  assert.deepEqual(names(library.asOneList()), ['B', 'A']);
});

test('iTunes library: cut short is refused, wherever the cut falls', () => {
  for (const cut of [40, LIBRARY.indexOf('Chaise'), LIBRARY.indexOf('Road Trip'), LIBRARY.lastIndexOf('</dict>')]) {
    refuses(() => parseText('Library.xml', LIBRARY.slice(0, cut)), 'incomplete');
  }
  refuses(() => parseText('Library.xml', '<?xml version="1.0"?>\n<plist version="1.0">\n</plist>'), 'incomplete');
});

test('readFile: a Blob in small pieces, UTF-16 and Windows-1252', async () => {
  const seen = [];
  const r = await readFile(file('Library.xml', LIBRARY), { chunk: 100, onProgress: (done, total) => seen.push(done / total) });
  assert.equal(r.library.trackCount, 3);
  assert.equal(seen[seen.length - 1], 1);
  assert.ok(seen.length > 10);

  const latin = new Uint8Array([...'#EXTM3U\n#EXTINF:1,Beyonc'].map((c) => c.charCodeAt(0)).concat([0xE9], [...' - Halo\nx.mp3\n'].map((c) => c.charCodeAt(0))));
  assert.deepEqual(names((await readFile(file('a.m3u', latin))).tracks), ['Beyoncé - Halo']);

  const text = 'title\tartist\nVolare\tModugno\n';
  const utf16 = new Uint8Array(2 + text.length * 2);
  utf16[0] = 0xFF; utf16[1] = 0xFE;
  for (let i = 0; i < text.length; i++) utf16[2 + i * 2] = text.charCodeAt(i);
  assert.deepEqual(names((await readFile(file('a.txt', utf16))).tracks), ['Modugno - Volare']);

  await assert.rejects(readFile(file('Library.xml', LIBRARY.slice(0, 900)), { chunk: 64 }), (e) => e.code === 'incomplete');
  const stop = new AbortController();
  stop.abort();
  await assert.rejects(readFile(file('Library.xml', LIBRARY), { signal: stop.signal }), (e) => e.code === 'cancelled');
});

test('outputs: the columns and shapes the app writes', () => {
  const tracks = parseText('a.csv', 'title,artist,album,duration_ms,isrc\n"Hello, World",A; B,Alb,215999,gbum71029604\nSolo <&>,,,,\n').tracks;
  assert.equal(encode('csv', 'Mix', tracks), 'title,artist,album,duration_ms,isrc\r\n"Hello, World","A, B",Alb,215999,gbum71029604\r\nSolo <&>,,,,\r\n');
  assert.equal(encode('m3u8', 'Mix', tracks), '#EXTM3U\r\n#EXTINF:215,A, B - Hello, World\r\nA, B - Hello, World\r\n#EXTINF:-1,Solo <&>\r\nSolo <&>\r\n');
  assert.equal(encode('text', 'Mix', tracks), 'A, B - Hello, World\nSolo <&>\n');
  assert.equal(encode('xspf', 'M & M', tracks), '<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/">\n  <title>M &amp; M</title>\n  <trackList>\n' +
    '    <track><title>Hello, World</title><creator>A, B</creator><album>Alb</album><duration>215999</duration><identifier>isrc:GBUM71029604</identifier></track>\n' +
    '    <track><title>Solo &lt;&amp;&gt;</title></track>\n  </trackList>\n</playlist>\n');
  assert.deepEqual(JSON.parse(encode('jspf', 'Mix', tracks)), { playlist: { title: 'Mix', track: [
    { title: 'Hello, World', creator: 'A, B', album: 'Alb', duration: 215999, identifier: ['isrc:GBUM71029604'] }, { title: 'Solo <&>' }] } });
});

test('outputs: every one reads back to the same songs', () => {
  const tracks = parseText('a.csv', 'title,artist,album,duration_ms,isrc\nNihilist,Architects,For Those That Wish to Exist,230000,\nSolo <&>,,,,\n').tracks;
  for (const [out, name] of [['csv', 'a.csv'], ['m3u8', 'a.m3u8'], ['xspf', 'a.xspf'], ['jspf', 'a.jspf'], ['text', 'a.txt']]) {
    const back = parseText(name, encode(out, 'Mix', tracks)).tracks;
    assert.deepEqual(back.map((t) => [t.title, t.artists]), [['Nihilist', ['Architects']], ['Solo <&>', []]], out);
  }
});

test('dedupe: same title and artists, whatever the capitals and spaces', () => {
  const tracks = parseText('a.txt', 'Wet Leg - Chaise Longue\nWET LEG -  chaise  longue\nWet Leg - Chaise Longue (Live)\nOther - Chaise Longue\nwet leg - Chaise Longue\n').tracks;
  assert.deepEqual(names(dedupe(tracks)), ['Wet Leg - Chaise Longue', 'Wet Leg - Chaise Longue (Live)', 'Other - Chaise Longue']);
});

test('small rules: durations, artists, file names', () => {
  assert.equal(parseDuration('3:35'), 215000);
  assert.equal(parseDuration('1:02:03'), 3723000);
  assert.equal(parseDuration('215'), 215000);
  assert.equal(parseDuration('215000'), 215000);
  assert.equal(parseDuration('PT1H2M'), 3720000);
  assert.equal(parseDuration('abc'), 0);
  assert.deepEqual(splitArtists('A, B; C / D & E'), ['A', 'B', 'C', 'D', 'E']);
  assert.equal(safeName(' a/b:c?. '), 'a_b_c_');
  assert.equal(safeName('...'), 'playlist');
});

test('CsvRows: the separator is read off the first lines', () => {
  const rows = [];
  const r = new CsvRows((row) => rows.push(row));
  r.push('a;b,c;d\n1;"2;3";4\n');
  r.end();
  assert.deepEqual(rows, [['a', 'b,c', 'd'], ['1', '2;3', '4']]);
});

test('XSPF: entities are unescaped once, and a mention of xspf.org in a title is not the namespace', () => {
  const x = '<?xml version="1.0"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/"><trackList>' +
    '<track><title>A &amp;lt;b&amp;gt; &amp; &#38; C</title><creator>X</creator></track></trackList></playlist>';
  assert.equal(parseText('a.xspf', x).tracks[0].title, 'A &lt;b&gt; & & C');
  assert.notEqual(detect('a.xml', '<?xml version="1.0"?><note>see xspf.org</note>'), 'xspf');
});
