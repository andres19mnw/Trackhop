// The cards to share, drawn on a <canvas>: 9:16 for stories, square for posts, in four looks.

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function linear(c, w, h, deg, stops, px) {
  const a = deg * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
  const L = Math.abs(w * dx) + Math.abs(h * dy), half = L / 2;
  const g = c.createLinearGradient(w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half);
  for (const [at, color] of stops) g.addColorStop(Math.min(1, Math.max(0, px ? (L - px.edge + at) / L : at)), color);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}

// The brand beam of site.css: its edge crosses the top right corner, the rest stays near black.
function beam(c, w, h) {
  linear(c, w, h, 12, [[-99999, '#000'], [-620, '#000'], [-10, '#400000'], [10, '#421aff'], [100, '#59ffff'], [760, '#fff']], { edge: 250 });
  c.globalCompositeOperation = 'screen';
  linear(c, w, h, 90, [[0, '#000'], [1, '#990000']]);
  c.globalCompositeOperation = 'source-over';
}
const flat = (bg, foot) => (c, w, h) => { c.fillStyle = bg; c.fillRect(0, 0, w, h); c.fillStyle = foot; c.fillRect(0, h - 104, w, 104); };

/** The looks: the colour of the text, of what stands out, how faint the other hours are, and the background. */
export const LOOKS = {
  beam: { fg: '#ffffff', peak: '#59ffff', dim: .5, paint: beam },
  // --grad of site.css
  violet: { fg: '#ffffff', peak: '#ffffff', dim: .45, paint: (c, w, h) => linear(c, w, h, 120, [[0, '#4338ca'], [.5, '#7c3aed'], [1, '#db2777']]) },
  paper: { fg: '#1c1b22', peak: '#5b3fd9', dim: .32, paint: flat('#fbf8ff', '#f0ecf7') },
  night: { fg: '#e6e1ea', peak: '#c8bfff', dim: .4, paint: flat('#131218', '#1c1b22') },
};

// Trackhop's mark: the two arrows and the note (the paths of the site's icon).
const MARK = [['M30.6,40.5 A27,27 0 0 1 77.4,40.5', 5.5], ['M77.4,67.5 A27,27 0 0 1 30.6,67.5', 5.5], ['M81.85,36.2 L71.45,42.2 L81.4,47.4 Z', 0], ['M26.15,71.8 L36.55,65.8 L26.6,60.6 Z', 0]];
const NOTE = [['M54.08,61.11 A7,5.6 -20 1 1 40.92,65.89 A7,5.6 -20 1 1 54.08,61.11 Z', 0], ['M52.6,62.5 L52.6,37.5', 3.6], ['M52.6,37.2 C58.5,38.6 63.4,42.4 63.2,49.6 C61.6,45.2 58,42.9 52.6,42.6 Z', 0]];
function mark(c, x, y, size, color) {
  c.save();
  c.translate(x, y); c.scale(size / 66, size / 66); c.translate(-21, -21);
  c.fillStyle = c.strokeStyle = color; c.lineCap = 'round';
  const run = (list) => list.forEach(([d, sw]) => { const p = new Path2D(d); if (sw) { c.lineWidth = sw; c.stroke(p); } else c.fill(p); });
  run(MARK); c.translate(2.1, 1.5); run(NOTE);
  c.restore();
}

/** A line of text. One too long for [width] gets smaller first (down to [min]), then an ellipsis. */
function text(c, t, x, y, size, weight, alpha, width, min) {
  c.font = weight + ' ' + size + 'px ' + FONT;
  while (width && min && size > min && c.measureText(t).width > width) { size -= 2; c.font = weight + ' ' + size + 'px ' + FONT; }
  if (width && c.measureText(t).width > width) {
    let lo = 0, hi = t.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (c.measureText(t.slice(0, mid).trimEnd() + '…').width <= width) lo = mid; else hi = mid - 1;
    }
    t = t.slice(0, lo).trimEnd() + '…';
  }
  c.globalAlpha = alpha; c.fillText(t, x, y); c.globalAlpha = 1;
}

/** The listening clock: 24 spokes, midnight at the top, the loudest hour in the look's own colour. */
function clock(c, th, s, t, cx, cy, r0, len, sw, big, small) {
  const peak = Math.max(1, ...s.hours);
  c.lineCap = 'round'; c.lineWidth = sw;
  s.hours.forEach((v, h) => {
    const a = (h / 24) * 2 * Math.PI - Math.PI / 2, l = Math.max(2, v / peak * len), top = h === s.loudestHour;
    c.strokeStyle = top ? th.peak : th.fg; c.globalAlpha = top ? 1 : th.dim;
    c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); c.lineTo(cx + Math.cos(a) * (r0 + l), cy + Math.sin(a) * (r0 + l)); c.stroke();
  });
  c.globalAlpha = 1; c.fillStyle = th.fg; c.textAlign = 'center';
  text(c, t.hour, cx, cy + big * .2, big, 800, 1);
  text(c, t.loudest, cx, cy + big * .2 + small * 1.5, small, 600, .8, r0 * 1.7, small - 6);
  c.textAlign = 'left';
}

function list(c, th, title, rows, x, y, width, size, pitch) {
  if (!rows.length) return;
  c.fillStyle = th.fg;
  text(c, title, x, y, Math.round(size * .78), 600, .8, width);
  rows.forEach((r, i) => {
    const yy = y + pitch * (i + 1) + 6;
    c.fillStyle = i === 0 ? th.peak : th.fg; text(c, String(i + 1), x, yy, size, 800, i === 0 ? 1 : .7);
    c.fillStyle = th.fg; text(c, r, x + size * 1.05, yy, size, 700, 1, width - size * 1.05, size - 10);
  });
}

/**
 * Draws the card of [s] (a summary of listening.js) on [canvas] in the look [look]. [t] are its
 * texts: label ("My 2026 in music"), big (the number) and unit ("minutes listened"), topArtist
 * (the heading) and together ("5,236 minutes together"), artists and songs (the two headings),
 * hour ("22:00") and loudest ("loudest hour"), type ("Evening listener"), tail ("3,214 songs ·
 * 487 artists") and streak. What the export does not have (artists, hours) is left out.
 */
export function drawCard(canvas, s, t, look, square) {
  const th = LOOKS[look] || LOOKS.beam, w = 1080, h = square ? 1080 : 1920;
  canvas.width = w; canvas.height = h;
  const c = canvas.getContext('2d');
  th.paint(c, w, h);
  c.textBaseline = 'alphabetic'; c.textAlign = 'left'; c.fillStyle = th.fg;
  const artists = s.topArtists.map((a) => a.name), songs = s.topSongs.map((x) => x.title);
  const timed = s.loudestHour >= 0;
  if (square) {
    const m = 72, inner = w - m * 2;
    mark(c, m, 196, 50, th.fg); text(c, 'Trackhop', m + 64, 234, 40, 700, 1);
    text(c, t.label, m, 330, 48, 700, .9, timed ? 560 : inner, 34);
    text(c, t.big, m - 6, 478, 168, 800, 1, timed ? 560 : inner, 110);
    text(c, t.unit, m, 556, 40, 600, .9, timed ? 560 : inner, 30);
    if (timed) clock(c, th, s, t, 846, 430, 96, 60, 11, 44, 20);
    const cw = (inner - 40) / 2;
    list(c, th, t.artists, artists, m, 660, cw, 40, 58);
    list(c, th, t.songs, songs, artists.length ? m + cw + 40 : m, 660, artists.length ? cw : inner, 40, 58);
    c.fillStyle = th.fg;
    text(c, 'trackhop.org', m, h - 46, 32, 700, 1);
    c.textAlign = 'right'; text(c, t.tail, w - m, h - 46, 30, 500, .85, inner - 260, 22); c.textAlign = 'left';
    return;
  }
  const m = 84, inner = w - m * 2;
  mark(c, m, 250, 60, th.fg); text(c, 'Trackhop', m + 78, 295, 46, 700, 1);
  text(c, t.label, m, 440, 64, 700, .9, inner, 44);
  text(c, t.big, m - 8, 690, 250, 800, 1, inner, 150);
  text(c, t.unit, m, 806, 54, 600, .9, inner, 40);
  let y = 916;
  if (s.topArtist) {
    text(c, t.topArtist, m, y, 42, 600, .8);
    text(c, s.topArtist.name, m, y + 106, 112, 800, 1, inner, 60);
    text(c, t.together, m, y + 170, 42, 500, .9, inner, 30);
    y += 264;
  }
  const cw = (inner - 48) / 2;
  list(c, th, t.artists, artists, m, y, cw, 44, 66);
  list(c, th, t.songs, songs, artists.length ? m + cw + 48 : m, y, artists.length ? cw : inner, 44, 66);
  c.fillStyle = th.fg;
  let x = m, width = inner;
  if (timed) { clock(c, th, s, t, m + 156, 1704, 90, 62, 11, 42, 19); x = m + 370; width = inner - 370; }
  c.fillStyle = th.fg;
  if (t.type) text(c, t.type, x, 1662, 58, 800, 1, width, 40);
  text(c, t.tail, x, t.type ? 1724 : 1690, 38, 500, .9, width, 28);
  if (t.streak) text(c, t.streak, x, t.type ? 1776 : 1742, 38, 500, .9, width, 26);
  c.textAlign = 'right'; text(c, 'trackhop.org', w - m, h - 52, 38, 700, 1); c.textAlign = 'left';
}

/** The canvas as a PNG Blob. */
export function cardBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas'))), 'image/png'));
}
