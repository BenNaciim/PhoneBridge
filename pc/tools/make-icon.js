// Génère l'icône de l'application (écran de PC, téléphone devant, pastille de notification) sans dépendance.
// Écrit le PNG du PC et l'icône vectorielle Android à partir des mêmes formes.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const N = 256;
const SS = 3;
const WHITE = [255, 255, 255];
const MINT = [93, 202, 165];

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Formes dans l'ordre de dessin. fill(x, y) donne la couleur, alpha l'opacité, vec la couleur Android.
const rr = (cx, cy, hw, hh, r, fill, vec, alpha = 1) => ({ kind: 'rr', cx, cy, hw, hh, r, fill, vec, alpha });
const dot = (cx, cy, r, fill, vec) => ({ kind: 'rr', cx, cy, hw: r, hh: r, r, fill, vec, alpha: 1 });
const solid = (c) => () => c;
const screen = (y0, y1, a, b) => (x, y) => mix(hex(a), hex(b), Math.min(1, Math.max(0, (y - y0) / (y1 - y0))));

const shapes = [
  { bg: true, kind: 'rr', cx: 128, cy: 128, hw: 128, hh: 128, r: 58, alpha: 1,
    fill: (x, y) => {
      const t = (x + y) / (2 * N);
      return t < 0.5 ? mix(hex('#1D9E75'), hex('#0C447C'), t * 2) : mix(hex('#0C447C'), hex('#534AB7'), (t - 0.5) * 2);
    } },
  rr(108, 120, 68, 50, 14, solid(WHITE), '#FFFFFF'),
  rr(108, 120, 56, 38, 8, screen(82, 158, '#0C447C', '#26215C'), '#17387A'),
  rr(92, 101, 30, 7, 7, solid(MINT), '#5DCAA5'),
  rr(109, 124, 39, 6, 6, solid(WHITE), '#BFFFFFFF', 0.75),
  rr(100, 142, 30, 6, 6, solid(WHITE), '#80FFFFFF', 0.5),
  rr(108, 180, 10, 10, 2, solid(WHITE), '#FFFFFF'),
  rr(108, 191, 30, 5, 5, solid(WHITE), '#FFFFFF'),
  rr(178, 158, 33, 53, 17, solid(hex('#0C3A70')), '#0C3A70'),
  rr(178, 158, 28, 48, 12, solid(WHITE), '#FFFFFF'),
  rr(178, 158, 22, 41, 8, screen(117, 199, '#12356B', '#26215C'), '#17387A'),
  rr(178, 148, 13, 6, 6, solid(MINT), '#5DCAA5'),
  rr(178, 166, 13, 5, 5, solid(WHITE), '#99FFFFFF', 0.6),
  dot(201, 112, 17, solid(WHITE), '#FFFFFF'),
  dot(201, 112, 13, solid(MINT), '#5DCAA5')
];

const sd = (px, py, s) => {
  const qx = Math.abs(px - s.cx) - (s.hw - s.r);
  const qy = Math.abs(py - s.cy) - (s.hh - s.r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - s.r;
};

function colorAt(x, y) {
  let out = null;
  for (const s of shapes) {
    if (sd(x, y, s) > 0) continue;
    if (s.bg) { out = { c: s.fill(x, y), a: 1 }; continue; }
    if (!out) continue;
    const a = s.alpha;
    out = { c: mix(out.c, s.fill(x, y), a), a: 1 };
  }
  return out;
}

const raw = Buffer.alloc(N * (N * 4 + 1));
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0;
  for (let x = 0; x < N; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const p = colorAt(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        if (p) { r += p.c[0]; g += p.c[1]; b += p.c[2]; n++; }
      }
    }
    const o = y * (N * 4 + 1) + 1 + x * 4;
    if (n) { raw[o] = r / n; raw[o + 1] = g / n; raw[o + 2] = b / n; }
    raw[o + 3] = Math.round((n / (SS * SS)) * 255);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
]);

for (const out of [path.join(__dirname, '..', 'renderer', 'icon.png'), path.join(__dirname, '..', 'assets', 'icon.png')]) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, png);
  console.log('écrit', out, png.length, 'octets');
}

// Icône adaptative Android (108 dp, zone sûre au centre) : mêmes formes, réduites.
const K = 0.37;
const tx = (X) => +(54 + (X - 123) * K).toFixed(2);
const ty = (Y) => +(54 + (Y - 133) * K).toFixed(2);
const rrPath = (s) => {
  const x = tx(s.cx - s.hw), y = ty(s.cy - s.hh), w = +(2 * s.hw * K).toFixed(2), h = +(2 * s.hh * K).toFixed(2), r = +(s.r * K).toFixed(2);
  return `M${x + r},${y}h${(w - 2 * r).toFixed(2)}a${r},${r} 0 0 1 ${r},${r}v${(h - 2 * r).toFixed(2)}a${r},${r} 0 0 1 -${r},${r}h-${(w - 2 * r).toFixed(2)}a${r},${r} 0 0 1 -${r},-${r}v-${(h - 2 * r).toFixed(2)}a${r},${r} 0 0 1 ${r},-${r}z`;
};
const vector = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
${shapes.filter((s) => !s.bg).map((s) => `    <path android:fillColor="${s.vec}" android:pathData="${rrPath(s)}" />`).join('\n')}
</vector>
`;
const res = path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'res');
if (fs.existsSync(res)) {
  fs.writeFileSync(path.join(res, 'drawable', 'ic_fg.xml'), vector);
  fs.writeFileSync(path.join(res, 'drawable', 'ic_bg.xml'), `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <gradient
        android:angle="315"
        android:startColor="#1D9E75"
        android:centerColor="#0C447C"
        android:endColor="#534AB7" />
</shape>
`);
  fs.writeFileSync(path.join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml'), `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_bg" />
    <foreground android:drawable="@drawable/ic_fg" />
</adaptive-icon>
`);
  console.log('icône Android écrite');
}
