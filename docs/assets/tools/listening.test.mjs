// node --test docs/assets/tools/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { readExport, Listening, PLAY_MS } from './listening.js';
import { zipEntries, entryBytes, zipParts, isZip } from './zip.js';
import { crc32, ToolError } from './io.js';

const utc = (d) => [d.getUTCFullYear(), d.getUTCHours()];
const file = (name, data) => Object.assign(new Blob([data]), { name });
const enc = new TextEncoder();

/** A zip as the services send it: deflated entries, written here by hand with node's zlib. */
function deflatedZip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text] of files) {
    const raw = enc.encode(text), packed = deflateRawSync(raw), n = enc.encode(name);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true); head.setUint16(8, 8, true);
    head.setUint32(14, crc32(raw), true); head.setUint32(18, packed.length, true); head.setUint32(22, raw.length, true); head.setUint16(26, n.length, true);
    parts.push(new Uint8Array(head.buffer), n, packed);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 8, true);
    c.setUint32(16, crc32(raw), true); c.setUint32(20, packed.length, true); c.setUint32(24, raw.length, true); c.setUint16(28, n.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), n);
    offset += 30 + n.length + packed.length;
  }
  const size = central.reduce((s, b) => s + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)]);
}

const play = (ts, track, artist, ms) => ({ ts, platform: 'android', ms_played: ms, conn_country: 'IT', master_metadata_track_name: track, master_metadata_album_artist_name: artist, master_metadata_album_album_name: 'x', spotify_track_uri: 'spotify:track:x', episode_name: null, reason_end: 'trackdone', shuffle: false, skipped: false });
const SPOTIFY_2025 = [
  play('2025-03-01T19:10:00Z', 'Nihilist', 'Architects', 240000),
  play('2025-03-01T19:20:00Z', 'Nihilist', 'Architects', 240000),
  play('2025-03-02T08:00:00Z', 'Chaise Longue', 'Wet Leg', 180000),
  play('2025-03-02T08:05:00Z', 'Skipped', 'Wet Leg', 12000),
  { ts: '2025-03-03T10:00:00Z', ms_played: 1800000, master_metadata_track_name: null, master_metadata_album_artist_name: null, episode_name: 'A podcast' },
];
const SPOTIFY_2026 = [
  play('2026-01-05T23:30:00Z', 'Starburster', 'Fontaines D.C.', 200000),
  play('2026-01-06T23:40:00Z', 'nihilist', 'Architects', 60000),
];

test('Spotify: the extended history, per year and in all', async () => {
  const stats = await readExport('spotify', [
    file('Streaming_History_Audio_2025.json', JSON.stringify(SPOTIFY_2025)),
    file('Streaming_History_Audio_2026.json', JSON.stringify(SPOTIFY_2026, null, 2)),
  ], { clock: utc });
  assert.deepEqual(stats.yearList(), [2025, 2026]);
  const y = stats.summary(2025);
  assert.equal(y.minutes, Math.round((240000 * 2 + 180000 + 12000) / 60000));
  assert.equal(y.plays, 3); // the 12-second skip is time, not a play
  assert.equal(y.songs, 2);
  assert.equal(y.artists, 2);
  assert.deepEqual(y.topArtists.map((a) => [a.name, a.minutes, a.plays]), [['Architects', 8, 2], ['Wet Leg', 3, 1]]);
  assert.deepEqual(y.topSongs.map((s) => [s.title, s.artist, s.plays]), [['Nihilist', 'Architects', 2], ['Chaise Longue', 'Wet Leg', 1]]);
  assert.equal(y.loudestHour, 19);
  assert.equal(y.hours[8], 192000);
  assert.deepEqual([y.topSong.title, y.topSong.plays], ['Nihilist', 2]);
  const all = stats.summary();
  assert.equal(all.plays, 5);
  assert.equal(all.songs, 3); // "nihilist" and "Nihilist" are one song
  assert.equal(all.topSongs[0].plays, 3);
  assert.equal(stats.summary(2026).loudestHour, 23);
});

test('Spotify: my_spotify_data.zip as it arrives, only the audio history read', async () => {
  const zip = deflatedZip([
    ['Spotify Extended Streaming History/ReadMeFirst_ExtendedStreamingHistory.pdf', '%PDF'],
    ['Spotify Extended Streaming History/Streaming_History_Audio_2024-2025_0.json', JSON.stringify(SPOTIFY_2025)],
    ['Spotify Extended Streaming History/Streaming_History_Audio_2025-2026_1.json', JSON.stringify(SPOTIFY_2026)],
    ['Spotify Extended Streaming History/Streaming_History_Video_2025.json', JSON.stringify([play('2025-05-01T10:00:00Z', 'A video', 'X', 500000)])],
  ]);
  assert.ok(await isZip(zip));
  const seen = [];
  const stats = await readExport('spotify', [file('my_spotify_data.zip', zip)], { clock: utc, onProgress: (d, t) => seen.push(d / t) });
  assert.equal(stats.summary().plays, 5);
  assert.equal(seen[seen.length - 1], 1);
});

test('Spotify: the shorter account history (endTime, msPlayed)', async () => {
  const stats = await readExport('spotify', [file('StreamingHistory_music_0.json', JSON.stringify([
    { endTime: '2024-12-31 23:10', artistName: 'Arlo Parks', trackName: 'Eugene', msPlayed: 200000 },
    { endTime: '2025-01-01 00:10', artistName: 'Arlo Parks', trackName: 'Eugene', msPlayed: 200000 },
  ]))], { clock: utc });
  assert.deepEqual(stats.yearList(), [2024, 2025]);
  assert.equal(stats.summary(2024).loudestHour, 23);
});

test('Spotify: cut short, damaged or the wrong file gives nothing', async () => {
  const json = JSON.stringify(SPOTIFY_2025);
  await assert.rejects(readExport('spotify', [file('Streaming_History_Audio_2025.json', json.slice(0, json.length - 40))]), (e) => e.code === 'incomplete');
  const zip = deflatedZip([['Streaming_History_Audio_2025.json', json]]);
  await assert.rejects(readExport('spotify', [file('my_spotify_data.zip', zip.slice(0, zip.size - 30))]), (e) => e.code === 'incomplete');
  const bytes = new Uint8Array(await zip.arrayBuffer());
  bytes[80] ^= 0xFF; // one byte of the packed data
  await assert.rejects(readExport('spotify', [file('my_spotify_data.zip', bytes)]), (e) => e.code === 'unreadable');
  await assert.rejects(readExport('spotify', [file('other.zip', deflatedZip([['Userdata.json', '{}']]))]), (e) => e.code === 'wrong-file');
  await assert.rejects(readExport('spotify', [file('Userdata.json', '{"username":"x"}')]), (e) => e.code === 'wrong-file');
  await assert.rejects(readExport('spotify', [file('Streaming_History_Audio.json', '[]')]), (e) => e.code === 'empty');
  const stop = new AbortController();
  stop.abort();
  await assert.rejects(readExport('spotify', [file('a.json', json)], { signal: stop.signal }), (e) => e.code === 'cancelled');
});

const APPLE = 'Apple Music Play Activity.csv';

test('Apple Music: Play Activity with Song Name, the listener\'s own hour', async () => {
  const csv = 'Event Type,Song Name,Artist Name,Album Name,Play Duration Milliseconds,Event Start Timestamp,Event End Timestamp,UTC Offset In Seconds,Media Type\r\n' +
    'PLAY_END,Eugene,Arlo Parks,Collapsed in Sunbeams,200000,2025-06-01T21:30:00.000Z,2025-06-01T21:33:20Z,7200,AUDIO\r\n' +
    'PLAY_START,Eugene,Arlo Parks,Collapsed in Sunbeams,,2025-06-01T21:30:00Z,,7200,AUDIO\r\n' +
    'PLAY_END,"Hello, ""World""",Arlo Parks,X,45000,,2025-06-02T10:00:00Z,7200,AUDIO\r\n' +
    'PLAY_END,A video,Someone,X,300000,2025-06-02T11:00:00Z,,7200,VIDEO\r\n' +
    'PLAY_END,Too short,Arlo Parks,X,5000,2025-06-02T12:00:00Z,,7200,AUDIO\r\n' +
    'PLAY_END,Broken,Arlo Parks,X,-5,2025-06-02T12:00:00Z,,7200,AUDIO\r\n';
  const stats = await readExport('apple', [file(APPLE, csv)], { clock: utc });
  const s = stats.summary(2025);
  assert.equal(s.plays, 2);
  assert.equal(s.songs, 2);
  assert.equal(s.loudestHour, 23); // 21:30 UTC, two hours ahead
  assert.deepEqual(s.topSongs.map((t) => t.title), ['Eugene', 'Hello, "World"']);
  assert.equal(s.minutes, Math.round(250000 / 60000));
});

test('Apple Music: older columns (Content Name, Event Received Timestamp), no artist column', async () => {
  const csv = 'Content Name,Container Artist Name,Play Duration Milliseconds,Event Received Timestamp\nGift Horse,Idles,240000,2023-02-03T07:00:00Z\nGift Horse,Idles,240000,2024-02-03T07:00:00Z\n';
  const stats = await readExport('apple', [file(APPLE, csv)], { clock: utc });
  assert.deepEqual(stats.yearList(), [2023, 2024]);
  assert.deepEqual(stats.summary().topArtists.map((a) => [a.name, a.plays]), [['Idles', 2]]);

  const bare = await readExport('apple', [file(APPLE, 'Song Name,Play Duration Milliseconds,Event Start Timestamp\nGift Horse,240000,2023-02-03T07:00:00Z\n')], { clock: utc });
  assert.equal(bare.summary().artists, 0);
  assert.equal(bare.summary().songs, 1);
});

test('Apple Music: the daily summary, and the archive inside the archive', async () => {
  const daily = 'Country,Track Identifier,Media type,Date Played,Hours,Play Duration Milliseconds,End Reason Type,Source Type,Play Count,Skip Count,Ignore For Recommendations,Track Reference,Track Description\n' +
    'IT,1,AUDIO,20240131,"17, 18",480000,NATURAL,IPHONE,2,0,,1,Architects - Nihilist\n';
  const inner = deflatedZip([['Apple_Media_Services/Apple Music Activity/Apple Music - Play History Daily Tracks.csv', daily]]);
  const outer = new Blob(zipParts([{ name: 'Apple_Media_Services.zip', data: new Uint8Array(await inner.arrayBuffer()) }]));
  const stats = await readExport('apple', [file('archive.zip', outer)], { clock: utc });
  const s = stats.summary(2024);
  assert.deepEqual([s.plays, s.minutes, s.loudestHour], [2, 8, 17]);
  assert.deepEqual(s.topArtists.map((a) => a.name), ['Architects']);
});

test('Apple Music: another CSV is not taken for it; a cut one is refused', async () => {
  await assert.rejects(readExport('apple', [file('x.csv', 'title,artist\nA,B\n')]), (e) => e.code === 'wrong-file');
  await assert.rejects(readExport('apple', [file(APPLE, 'Song Name,Artist Name,Play Duration Milliseconds,Event Start Timestamp\n"Cut sho')]), (e) => e.code === 'incomplete');
});

test('YouTube Music: watch-history.json, plays counted, no minutes', async () => {
  const history = [
    { header: 'YouTube Music', title: 'Watched Starburster', titleUrl: 'https://music.youtube.com/watch?v=1', subtitles: [{ name: 'Fontaines D.C. - Topic', url: 'x' }], time: '2025-11-02T18:05:00.123Z', products: ['YouTube'] },
    { header: 'YouTube Music', title: 'Hai guardato Starburster', subtitles: [{ name: 'Fontaines D.C.' }], time: '2025-11-03T18:15:00Z' },
    { header: 'YouTube Music', title: 'Watched Eugene', subtitles: [{ name: 'Arlo Parks - Topic' }], time: '2025-11-03T09:00:00Z' },
    { header: 'YouTube', title: 'Watched a cat video', subtitles: [{ name: 'Cats' }], time: '2025-11-03T09:00:00Z' },
    { header: 'YouTube Music', title: 'Watched https://music.youtube.com/watch?v=gone', time: '2025-11-03T09:00:00Z' },
  ];
  const stats = await readExport('youtube', [file('watch-history.json', JSON.stringify(history))], { clock: utc });
  const s = stats.summary(2025);
  assert.equal(s.durations, false);
  assert.deepEqual([s.minutes, s.plays, s.songs, s.artists], [0, 3, 2, 2]);
  assert.deepEqual(s.topArtists.map((a) => [a.name, a.value]), [['Fontaines D.C.', 2], ['Arlo Parks', 1]]);
  assert.equal(s.loudestHour, 18);

  const zip = deflatedZip([['Takeout/YouTube and YouTube Music/history/watch-history.json', JSON.stringify(history)], ['Takeout/archive_browser.html', '<html>']]);
  assert.equal((await readExport('youtube', [file('takeout.zip', zip)], { clock: utc })).summary().plays, 3);
  await assert.rejects(readExport('youtube', [file('watch-history.json', JSON.stringify(history.slice(3)))]), (e) => e.code === 'empty');
  await assert.rejects(readExport('youtube', [file('watch-history.html', '<html><body>Watched</body></html>')]), (e) => e.code === 'wrong-file');
});

test('Listening: a skip counts its time, a play needs thirty seconds', () => {
  const l = new Listening(true, utc);
  l.at('A', 'X', PLAY_MS - 1, new Date('2025-01-01T00:00:00Z'));
  l.at('A', 'X', PLAY_MS, new Date('2025-01-01T01:00:00Z'));
  l.at('B', 'X', 1e12, new Date('2025-01-01T01:00:00Z')); // not a length a song can have
  l.at('C', 'X', 60000, new Date('not a date'));
  const s = l.summary(2025);
  assert.deepEqual([s.plays, s.songs, s.artists, s.minutes], [1, 1, 1, 1]);
});

test('zip: what is written reads back; names twice get a number', async () => {
  const blob = new Blob(zipParts([
    { name: 'Corsa.m3u8', data: enc.encode('#EXTM3U\r\n') },
    { name: 'Più ascoltati.m3u8', data: enc.encode('uno') },
    { name: 'corsa.m3u8', data: enc.encode('due') },
    { name: 'empty.txt', data: new Uint8Array(0) },
  ]));
  const entries = await zipEntries(blob);
  assert.deepEqual(entries.map((e) => [e.name, e.method, e.size]), [['Corsa.m3u8', 0, 9], ['Più ascoltati.m3u8', 0, 3], ['corsa (2).m3u8', 0, 3], ['empty.txt', 0, 0]]);
  const text = async (e) => { let s = ''; for await (const b of entryBytes(blob, e)) s += new TextDecoder().decode(b); return s; };
  assert.equal(await text(entries[1]), 'uno');
  assert.equal(await text(entries[2]), 'due');
  assert.equal(crc32(enc.encode('123456789')), 0xCBF43926);
  await assert.rejects(zipEntries(new Blob(['PK\u0003\u0004 not a zip at all'])), (e) => e instanceof ToolError && e.code === 'incomplete');
});
