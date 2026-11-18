// node --test docs/assets/tools/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { readExport, Listening, PLAY_MS } from './listening.js';
import { zipEntries, entryBytes, zipParts, isZip } from './zip.js';
import { crc32, ToolError } from './io.js';

const utc = (d) => [d.getUTCFullYear(), d.getUTCHours(), d.getUTCMonth(), d.getUTCDate(), d.getUTCMinutes()];
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

// ---------------------------------------------------------------- the year's story: months, days, streaks

const DAY = 24 * 3600 * 1000;
const dayOf = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY);
/** A Listening with one three-minute play of "Song" by "X" at noon UTC on each of [days] (ISO dates). */
function playedOn(days, durations = true) {
  const l = new Listening(durations, utc);
  for (const d of days) l.at('Song', 'X', durations ? 180000 : null, new Date(d + 'T12:00:00Z'));
  return l;
}

test('Listening: minutes and plays per month, the top month, the month still filling up', () => {
  const l = new Listening(true, utc);
  l.at('A', 'X', 600000, new Date('2025-01-31T23:59:00Z'));
  l.at('A', 'X', 120000, new Date('2025-02-01T00:00:00Z'));
  l.at('B', 'X', 180000, new Date('2025-02-10T09:00:00Z'));
  l.at('B', 'X', 10000, new Date('2025-02-11T09:00:00Z')); // a skip: its time counts, not a play, not a day
  l.at('A', 'X', 60000, new Date('2026-03-05T09:00:00Z'));
  const s = l.summary(2025);
  assert.deepEqual(s.months.map((m) => m.minutes), [10, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(s.months.map((m) => m.plays).slice(0, 3), [1, 2, 0]);
  assert.deepEqual([s.topMonth.year, s.topMonth.month, s.topMonth.minutes, s.topMonth.plays], [2025, 0, 10, 1]);
  assert.equal(s.series, null);
  assert.equal(s.partialMonth, -1); // 2025 is not the last year of the history
  // The first year starts at its first play and, another year following, runs to 31 December.
  assert.deepEqual(s.range, { from: dayOf('2025-01-31'), to: dayOf('2025-12-31'), days: 335 });
  assert.equal(s.activeDays, 3);
  const last = l.summary(2026);
  assert.deepEqual(last.range, { from: dayOf('2026-01-01'), to: dayOf('2026-03-05'), days: 64 });
  assert.equal(last.partialMonth, 2);
  const all = l.summary();
  assert.equal(all.months, null);
  assert.deepEqual(all.series.map((y) => [y.year, y.minutes, y.plays]), [[2025, 15, 3], [2026, 1, 1]]);
  assert.deepEqual([all.topMonth.year, all.topMonth.month], [2025, 0]);
  assert.deepEqual(all.range, { from: dayOf('2025-01-31'), to: dayOf('2026-03-05'), days: 399 });
  assert.equal(all.activeDays, 4);
  // A history that stops on the last day of a month has no month still filling up.
  assert.equal(playedOn(['2025-04-30']).summary(2025).partialMonth, -1);
  assert.equal(playedOn(['2024-02-28']).summary(2024).partialMonth, 1); // 2024 had a 29 February
  assert.equal(playedOn(['2025-02-28']).summary(2025).partialMonth, -1);
});

test('Listening: weekdays Monday first, parts of the day and the kind of listener', () => {
  const l = new Listening(true, utc);
  l.at('A', 'X', 60000, new Date('2025-06-02T04:59:00Z')); // a Monday, still night
  l.at('A', 'X', 120000, new Date('2025-06-02T05:00:00Z')); // morning
  l.at('A', 'X', 180000, new Date('2025-06-07T17:59:00Z')); // a Saturday, afternoon
  l.at('A', 'X', 240000, new Date('2025-06-08T22:59:00Z')); // a Sunday, evening
  l.at('A', 'X', 300000, new Date('2025-06-08T23:00:00Z')); // night
  const s = l.summary(2025);
  assert.deepEqual(s.weekdays, [180000, 0, 0, 0, 0, 180000, 540000]);
  assert.equal(s.topWeekday, 6);
  assert.deepEqual(s.parts, [120000, 180000, 240000, 360000]);
  assert.equal(s.topPart, 3);
  assert.equal(s.parts.reduce((a, b) => a + b), s.hours.reduce((a, b) => a + b));
  assert.equal(l.summary().topPart, 3);
});

test('Listening: the most-played day, the days with music and the first and last play', () => {
  const l = playedOn(['2025-03-01', '2025-03-01', '2025-03-01', '2025-03-04', '2025-03-09']);
  l.at('Long', 'Y', 3600000, new Date('2025-03-04T20:00:00Z'));
  const s = l.summary(2025);
  assert.deepEqual(s.topDay, { day: dayOf('2025-03-04'), value: 3780000, minutes: 63, plays: 2 }); // by time, not by plays
  assert.equal(s.activeDays, 3);
  assert.deepEqual(s.range, { from: dayOf('2025-03-01'), to: dayOf('2025-03-09'), days: 9 });
  // Without durations the day with the most plays.
  const y = playedOn(['2025-03-01', '2025-03-01', '2025-03-04'], false).summary(2025);
  assert.deepEqual([y.topDay.day, y.topDay.plays, y.topDay.minutes], [dayOf('2025-03-01'), 2, 0]);
});

test('Listening: the longest streak goes on across the end of a month and of a leap February', () => {
  const s = playedOn(['2024-01-10', '2024-01-30', '2024-01-31', '2024-02-01', '2024-02-02', '2024-02-10',
    '2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02', '2024-03-03']).summary(2024);
  assert.deepEqual(s.streak, { days: 5, from: dayOf('2024-02-28'), to: dayOf('2024-03-03') });
  // In a year without a 29 February the same days are one fewer; of two equal runs the first is kept.
  const t = playedOn(['2025-01-30', '2025-01-31', '2025-02-01', '2025-02-02', '2025-02-27', '2025-02-28', '2025-03-01', '2025-03-02']).summary(2025);
  assert.deepEqual(t.streak, { days: 4, from: dayOf('2025-01-30'), to: dayOf('2025-02-02') });
  assert.deepEqual(playedOn(['2025-05-05']).summary(2025).streak, { days: 1, from: dayOf('2025-05-05'), to: dayOf('2025-05-05') });
});

test('Listening: a streak across New Year is whole in All time and cut at the year in each year', () => {
  const l = playedOn(['2024-12-29', '2024-12-30', '2024-12-31', '2025-01-01', '2025-01-02', '2025-06-01', '2025-06-02', '2025-06-03']);
  assert.deepEqual(l.summary().streak, { days: 5, from: dayOf('2024-12-29'), to: dayOf('2025-01-02') });
  assert.deepEqual(l.summary(2024).streak, { days: 3, from: dayOf('2024-12-29'), to: dayOf('2024-12-31') });
  assert.deepEqual(l.summary(2025).streak, { days: 3, from: dayOf('2025-06-01'), to: dayOf('2025-06-03') });
  // A year with nothing in between breaks the run.
  const gap = playedOn(['2023-12-31', '2025-01-01']);
  assert.equal(gap.summary().streak.days, 1);
  assert.equal(gap.summary().activeDays, 2);
});

test('Listening: the day is the clock\'s day, so the same instants fall on other days in another time zone', () => {
  const tokyo = (d) => { const t = new Date(d.getTime() + 9 * 3600000); return [t.getUTCFullYear(), t.getUTCHours(), t.getUTCMonth(), t.getUTCDate(), t.getUTCMinutes()]; };
  const instants = ['2025-12-30T16:00:00Z', '2025-12-31T16:30:00Z', '2026-01-01T10:00:00Z'];
  const read = (clock) => { const l = new Listening(true, clock); for (const i of instants) l.at('A', 'X', 60000, new Date(i)); return l; };
  const z = read(utc), t = read(tokyo);
  assert.deepEqual(z.yearList(), [2025, 2026]);
  assert.equal(z.summary(2025).plays, 2);
  assert.equal(z.summary().streak.days, 3);
  // In Tokyo the second play is already on 1 January 2026, at 01:30: year, month, day, hour and first song agree.
  assert.equal(t.summary(2025).plays, 1);
  assert.deepEqual(t.summary(2025).range, { from: dayOf('2025-12-31'), to: dayOf('2025-12-31'), days: 1 });
  const y = t.summary(2026);
  assert.deepEqual([y.plays, y.activeDays, y.months[0].plays, y.loudestHour], [2, 1, 2, 1]);
  assert.deepEqual(y.firstSong, { title: 'A', artist: 'X', day: dayOf('2026-01-01'), hour: 1, minute: 30 });
  assert.equal(t.summary().streak.days, 2);
});

test('Listening: the first song of the year is the earliest play, whatever the order of the file', () => {
  const l = new Listening(true, utc);
  l.at('Later', 'X', 60000, new Date('2025-01-01T09:00:00Z'));
  l.at('Skipped', 'X', 5000, new Date('2025-01-01T00:01:00Z')); // not a play
  l.at('First', 'Y', 60000, new Date('2025-01-01T00:07:00Z'));
  l.at('Other year', 'Z', 60000, new Date('2024-06-01T10:30:00Z'));
  assert.deepEqual(l.summary(2025).firstSong, { title: 'First', artist: 'Y', day: dayOf('2025-01-01'), hour: 0, minute: 7 });
  // All time: the first song of the history.
  assert.deepEqual(l.summary().firstSong, { title: 'Other year', artist: 'Z', day: dayOf('2024-06-01'), hour: 10, minute: 30 });
});

test('Listening: the top artist\'s songs, their most-played one and the share of the first five', () => {
  const l = new Listening(true, utc);
  const at = new Date('2025-05-05T10:00:00Z');
  for (let i = 0; i < 3; i++) l.at('Hit', 'Top', 60000, at);
  l.at('Other', 'Top', 60000, at);
  l.at('hit', 'TOP', 60000, at); // the same song, the artist written another way: another artist row, the same song
  l.at('Skip', 'Top', 1000, at); // never played through: not one of their songs
  for (const a of ['B', 'C', 'D', 'E']) l.at('S', a, 120000, at);
  l.at('S', 'F', 60000, at);
  l.at('S', 'G', 60000, at);
  const s = l.summary(2025);
  assert.deepEqual([s.topArtist.name, s.topArtist.plays, s.topArtist.minutes, s.topArtist.songs, s.topArtist.song], ['Top', 4, 4, 2, 'Hit']);
  const total = 4 * 60000 + 1000 + 60000 + 4 * 120000 + 2 * 60000;
  assert.equal(s.topArtist.share, 241000 / total);
  assert.equal(s.topFiveShare, (241000 + 4 * 120000) / total);
  assert.equal(new Listening(true, utc).summary(2025).topArtist, null);
});

test('YouTube Music: every figure is in plays, and the times are kept', async () => {
  const entry = (title, artist, time) => ({ header: 'YouTube Music', title: 'Watched ' + title, subtitles: [{ name: artist + ' - Topic' }], time });
  const history = [
    entry('B', 'Two', '2025-11-03T18:15:00Z'), // newest first, as Takeout writes it
    entry('A', 'One', '2025-11-02T18:05:00Z'),
    entry('A', 'One', '2025-11-02T07:00:00Z'),
    entry('A', 'One', '2025-10-31T23:59:00Z'),
  ];
  const stats = await readExport('youtube', [file('watch-history.json', JSON.stringify(history))], { clock: utc });
  const s = stats.summary(2025);
  assert.equal(s.durations, false);
  assert.equal(s.minutes, 0);
  assert.deepEqual(s.months.slice(9, 11), [{ minutes: 0, plays: 1, value: 1 }, { minutes: 0, plays: 3, value: 3 }]);
  assert.deepEqual([s.topMonth.month, s.topMonth.plays, s.topMonth.minutes], [10, 3, 0]);
  assert.deepEqual(s.topDay, { day: dayOf('2025-11-02'), value: 2, minutes: 0, plays: 2 });
  assert.deepEqual(s.streak, { days: 2, from: dayOf('2025-11-02'), to: dayOf('2025-11-03') });
  assert.deepEqual(s.firstSong, { title: 'A', artist: 'One', day: dayOf('2025-10-31'), hour: 23, minute: 59 });
  assert.deepEqual([s.topArtist.name, s.topArtist.plays, s.topArtist.minutes, s.topArtist.share], ['One', 3, 0, 0.75]);
  assert.equal(s.topFiveShare, 1);
  assert.deepEqual(s.parts, [1, 0, 2, 1]);
  assert.equal(s.topPart, 2);
  assert.deepEqual(s.weekdays, [1, 0, 0, 0, 1, 0, 2]);
  assert.equal(s.loudestHour, 18);
});

test('Apple Music: the listener\'s own day with the offset; the daily summary has days but no first song', async () => {
  const csv = 'Event Type,Song Name,Artist Name,Play Duration Milliseconds,Event Start Timestamp,UTC Offset In Seconds\n' +
    'PLAY_END,Eugene,Arlo Parks,200000,2025-06-30T22:30:00Z,7200\n' + // 00:30 on 1 July for the listener
    'PLAY_END,Eugene,Arlo Parks,200000,2025-07-01T21:00:00Z,7200\n';
  const s = (await readExport('apple', [file(APPLE, csv)], { clock: utc })).summary(2025);
  assert.deepEqual(s.months.map((m) => m.plays).slice(5, 7), [0, 2]);
  assert.deepEqual(s.firstSong, { title: 'Eugene', artist: 'Arlo Parks', day: dayOf('2025-07-01'), hour: 0, minute: 30 });
  assert.deepEqual(s.streak, { days: 1, from: dayOf('2025-07-01'), to: dayOf('2025-07-01') });

  const daily = 'Date Played,Hours,Play Duration Milliseconds,Play Count,Track Description\n' +
    '20240131,"17, 18",480000,2,Architects - Nihilist\n20240201,9,240000,1,Architects - Nihilist\n20240203,,240000,1,Architects - Nihilist\n';
  const d = (await readExport('apple', [file('Apple Music - Play History Daily Tracks.csv', daily)], { clock: utc })).summary(2024);
  assert.equal(d.firstSong, null); // days, not times
  assert.deepEqual(d.streak, { days: 2, from: dayOf('2024-01-31'), to: dayOf('2024-02-01') });
  assert.deepEqual([d.activeDays, d.topDay.day, d.topDay.plays], [3, dayOf('2024-01-31'), 2]);
  assert.deepEqual(d.months.map((m) => m.plays).slice(0, 2), [2, 2]);
  assert.equal(d.hours.reduce((a, b) => a + b), 720000); // the row without an hour is in the totals, not on the clock
  assert.equal(d.minutes, 16);
});

test('Listening: a listen whose day is not known still counts in the totals', () => {
  const l = new Listening(true, utc);
  l.add('A', 'X', 60000, 2025, 10);
  const s = l.summary(2025);
  assert.deepEqual([s.plays, s.minutes, s.activeDays, s.range, s.streak, s.topDay, s.firstSong, s.topMonth, s.topWeekday], [1, 1, 0, null, null, null, null, null, -1]);
  assert.equal(s.loudestHour, 10);
});

test('A file cut short gives no figures at all, in any of the three exports', async () => {
  const many = [];
  for (let d = 1; d <= 28; d++) many.push(play(`2025-02-${String(d).padStart(2, '0')}T10:00:00Z`, 'Song ' + d, 'X', 200000));
  const json = JSON.stringify(many);
  for (const cut of [json.length - 1, json.length >> 1, 20]) {
    await assert.rejects(readExport('spotify', [file('Streaming_History_Audio_2025.json', json.slice(0, cut))], { clock: utc }), (e) => e instanceof ToolError && e.code === 'incomplete');
  }
  // One whole file and one cut one: nothing from the whole one is handed over either.
  await assert.rejects(readExport('spotify', [file('Streaming_History_Audio_2024.json', JSON.stringify(SPOTIFY_2025)), file('Streaming_History_Audio_2025.json', json.slice(0, 900))], { clock: utc }), (e) => e.code === 'incomplete');
  const yt = JSON.stringify([{ header: 'YouTube Music', title: 'Watched A', subtitles: [{ name: 'One' }], time: '2025-11-02T18:05:00Z' }, { header: 'YouTube Music', title: 'Watched B', subtitles: [{ name: 'Two' }], time: '2025-11-03T18:05:00Z' }]);
  await assert.rejects(readExport('youtube', [file('watch-history.json', yt.slice(0, yt.length - 30))], { clock: utc }), (e) => e.code === 'incomplete');
  const zip = deflatedZip([[APPLE, 'Song Name,Play Duration Milliseconds,Event Start Timestamp\nGift Horse,240000,2023-02-03T07:00:00Z\n']]);
  await assert.rejects(readExport('apple', [file('apple.zip', zip.slice(0, zip.size - 25))], { clock: utc }), (e) => e.code === 'incomplete');
});
