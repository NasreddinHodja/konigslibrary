// Stand-ins for real covers and pages: busy, lettered and light or dark, so
// captions and the HUD are judged against something like the real thing.

export const TITLES = [
  'Berserk Flame',
  'Æther Blade (Remastered)',
  '20th Century Journey - Side Story',
  '100 Blade vol. 3',
  'A Very Long Title That Wraps Past Two Lines Easily',
  'Moon',
  'Garden of Knights',
  'X!',
  'Orbit 276'
];

const PALETTES = [
  ['#f4efe6', '#d33', '#111'],
  ['#101820', '#f2aa4c', '#fff'],
  ['#e8e8e8', '#222', '#1a5'],
  ['#2b1b3d', '#e94f9a', '#fde'],
  ['#fafafa', '#0057b8', '#ffd700'],
  ['#c9b79c', '#3b2a1a', '#fff'],
  ['#0d0d0d', '#e8e8e8', '#c00'],
  ['#ffe14d', '#111', '#e33'],
  ['#1e3a5f', '#9fd3ff', '#fff']
];

function random(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function canvas(w: number, h: number) {
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  return [el, el.getContext('2d')!] as const;
}

function drawCover(i: number) {
  const W = 300;
  const H = 450;
  const [el, g] = canvas(W, H);
  const r = random(i * 977 + 13);
  const [bg, a, b] = PALETTES[i % PALETTES.length];
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  for (let k = 0; k < 40; k++) {
    g.strokeStyle = k % 2 ? a : b;
    g.globalAlpha = 0.25 + r() * 0.5;
    g.lineWidth = 1 + r() * 6;
    g.beginPath();
    g.moveTo(r() * W, r() * H);
    g.lineTo(r() * W, r() * H);
    g.stroke();
  }
  g.globalAlpha = 1;
  g.fillStyle = a;
  g.beginPath();
  g.ellipse(W * 0.5, H * 0.62, W * 0.32, H * 0.3, 0, 0, 7);
  g.fill();
  g.fillStyle = b;
  g.beginPath();
  g.ellipse(W * 0.5, H * 0.42, W * 0.13, H * 0.09, 0, 0, 7);
  g.fill();
  g.textAlign = 'center';
  g.font = '900 64px Impact, sans-serif';
  g.fillText(TITLES[i % TITLES.length].split(' ')[0].toUpperCase(), W / 2, 90);
  g.fillStyle = a;
  g.font = 'bold 22px sans-serif';
  g.fillText(`VOL. ${i + 1}`, W / 2, 124);
  return [el, g] as const;
}

export function coverUrl(i: number): string {
  return drawCover(i)[0].toDataURL('image/jpeg', 0.85);
}

export function pageUrl(i: number): string {
  const W = 800;
  const H = 1200;
  const [el, g] = canvas(W, H);
  const r = random(i * 131 + 7);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  const rows = [
    [40, 40, 720, 360],
    [40, 420, 340, 380],
    [420, 420, 340, 380],
    [40, 860, 720, 300]
  ];
  for (const [x, y, w, h] of rows) {
    g.fillStyle = '#f2f2f2';
    g.fillRect(x, y, w, h);
    for (let k = 0; k < 30; k++) {
      g.strokeStyle = '#000';
      g.globalAlpha = 0.15 + r() * 0.4;
      g.lineWidth = 1 + r() * 3;
      g.beginPath();
      g.moveTo(x + r() * w, y + r() * h);
      g.lineTo(x + r() * w, y + r() * h);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.fillStyle = '#222';
    g.beginPath();
    g.ellipse(x + w * (0.3 + r() * 0.4), y + h * 0.6, w * 0.15, h * 0.3, 0, 0, 7);
    g.fill();
    g.fillStyle = '#fff';
    g.strokeStyle = '#000';
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(x + w * 0.75, y + h * 0.25, 70, 45, 0, 0, 7);
    g.fill();
    g.stroke();
    g.lineWidth = 6;
    g.strokeRect(x, y, w, h);
  }
  return el.toDataURL('image/jpeg', 0.85);
}

/// Bayer's 8x8 ordered-dither thresholds, 0 to 1.
const BAYER = (() => {
  const m = [[0]];
  let n = 1;
  while (n < 8) {
    const next: number[][] = [];
    for (let y = 0; y < n * 2; y++) {
      next.push([]);
      for (let x = 0; x < n * 2; x++) {
        const q = [0, 2, 3, 1][(y < n ? 0 : 2) + (x < n ? 0 : 1)];
        next[y].push(4 * m[y % n][x % n] + q);
      }
    }
    m.splice(0, m.length, ...next);
    n *= 2;
  }
  return m.map((row) => row.map((v) => (v + 0.5) / 64));
})();

const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/// Two-colour ordered dither of `lightness` (0 to 1 per pixel) into `dark`
/// and `light`.
function dither(
  w: number,
  h: number,
  lightness: (x: number, y: number) => number,
  dark: string,
  light: string
) {
  const [el, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  const [d, l] = [rgbOf(dark), rgbOf(light)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = lightness(x, y) > BAYER[y % 8][x % 8] ? l : d;
      img.data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
    }
  }
  g.putImageData(img, 0, 0);
  return el.toDataURL('image/png');
}

/// A seamless tile of soft clouds, mostly dark, for behind the panels.
export function textureUrl(dark: string, light: string, size = 256): string {
  const r = random(42);
  const grids = [4, 8, 16].map((n) => ({ n, v: Array.from({ length: n * n }, r) }));
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise = ({ n, v }: { n: number; v: number[] }, x: number, y: number) => {
    const fx = (x / size) * n;
    const fy = (y / size) * n;
    const [x0, y0] = [Math.floor(fx), Math.floor(fy)];
    const [tx, ty] = [smooth(fx - x0), smooth(fy - y0)];
    const at = (i: number, j: number) => v[(j % n) * n + (i % n)];
    const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
    const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  };
  return dither(
    size,
    size,
    (x, y) => {
      const v =
        noise(grids[0], x, y) * 0.55 + noise(grids[1], x, y) * 0.3 + noise(grids[2], x, y) * 0.15;
      return Math.max(0, (v - 0.45) * 1.6) ** 1.5;
    },
    dark,
    light
  );
}

/// Cover `i`, dithered into two colours and shrunk to `width` pixels.
export function ditheredCoverUrl(i: number, dark: string, light: string, width = 150): string {
  const [src] = drawCover(i);
  const h = Math.round((width * src.height) / src.width);
  const [, g] = canvas(width, h);
  g.drawImage(src, 0, 0, width, h);
  const px = g.getImageData(0, 0, width, h).data;
  return dither(
    width,
    h,
    (x, y) => {
      const k = (y * width + x) * 4;
      return (0.2126 * px[k] + 0.7152 * px[k + 1] + 0.0722 * px[k + 2]) / 255;
    },
    dark,
    light
  );
}
