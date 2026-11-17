// The card to share, drawn on a <canvas> with the site's gradient: 9:16 for stories, square for posts.

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
// --grad of site.css: linear-gradient(120deg, #4338ca 0%, #7c3aed 50%, #db2777 100%)
const STOPS = [[0, '#4338ca'], [0.5, '#7c3aed'], [1, '#db2777']];

function background(ctx, w, h) {
  const a = 120 * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const g = ctx.createLinearGradient(w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half);
  for (const [at, color] of STOPS) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Text that fits [width]: cut with an ellipsis when it does not. */
function fit(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid).trimEnd() + '…').width <= width) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '…';
}

function line(ctx, text, x, y, size, weight, alpha, width) {
  ctx.font = weight + ' ' + size + 'px ' + FONT;
  ctx.globalAlpha = alpha;
  ctx.fillText(width ? fit(ctx, text, width) : text, x, y);
  ctx.globalAlpha = 1;
}

/**
 * Draws the card of [s] (a summary of listening.js) on [canvas]. [t] are the texts: label ("My
 * 2026"), big (the number) and unit ("minutes"), sub ("6,812 songs · 1,094 artists"), the two
 * headings and the song's line.
 */
export function drawCard(canvas, s, t, square) {
  const w = 1080, h = square ? 1080 : 1920;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  background(ctx, w, h);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  const m = 84, inner = w - m * 2;
  const artists = s.topArtists.slice(0, 5);
  if (square) {
    line(ctx, t.label, m, 176, 96, 800, 1, inner);
    line(ctx, t.big, m, 336, 150, 800, 1, inner);
    line(ctx, t.unit, m, 412, 44, 600, 0.9);
    line(ctx, t.sub, m, 472, 36, 500, 0.85, inner);
    if (artists.length) {
      line(ctx, t.topArtists, m, 560, 34, 600, 0.8);
      artists.forEach((a, i) => {
        line(ctx, String(i + 1), m, 624 + i * 58, 44, 700, 0.7);
        line(ctx, a.name, m + 52, 624 + i * 58, 44, 700, 1, inner - 52);
      });
    }
    if (s.topSong) line(ctx, t.topSong + ': ' + t.song, m, artists.length ? 936 : 600, 34, 500, 0.9, inner);
    line(ctx, 'trackhop.org', m, h - 64, 36, 600, 0.85);
    return;
  }
  line(ctx, 'Trackhop', m, 190, 44, 700, 0.85);
  line(ctx, t.label, m, 420, 150, 800, 1, inner);
  line(ctx, t.big, m, 690, 200, 800, 1, inner);
  line(ctx, t.unit, m, 800, 58, 600, 0.9);
  line(ctx, t.sub, m, 890, 44, 500, 0.85, inner);
  let y = 1040;
  if (artists.length) {
    line(ctx, t.topArtists, m, y, 44, 600, 0.8);
    artists.forEach((a, i) => {
      line(ctx, String(i + 1), m, y + 92 + i * 86, 60, 700, 0.7);
      line(ctx, a.name, m + 70, y + 92 + i * 86, 60, 700, 1, inner - 70);
    });
    y += 92 + artists.length * 86 + 24;
  }
  if (s.topSong) {
    line(ctx, t.topSong, m, y, 44, 600, 0.8);
    line(ctx, s.topSong.title, m, y + 76, 56, 700, 1, inner);
    if (s.topSong.artist) line(ctx, s.topSong.artist, m, y + 132, 42, 500, 0.9, inner);
  }
  line(ctx, 'trackhop.org', m, h - 110, 44, 600, 0.85);
}

/** The canvas as a PNG Blob. */
export function cardBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas'))), 'image/png'));
}
