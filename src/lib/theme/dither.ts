// Ordered dither: grey levels drawn as two colours, the way the palette's
// texture and the manga page's cover backdrop are made.

/// Bayer's 8x8 thresholds, 0 to 1.
const BAYER = (() => {
  let m = [[0]];
  while (m.length < 8) {
    const n = m.length;
    m = Array.from({ length: n * 2 }, (_, y) =>
      Array.from({ length: n * 2 }, (_, x) => {
        const q = [0, 2, 3, 1][(y < n ? 0 : 2) + (x < n ? 0 : 1)];
        return 4 * m[y % n][x % n] + q;
      })
    );
  }
  return m.map((row) => row.map((v) => (v + 0.5) / 64));
})();

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function canvas(w: number, h: number) {
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  const g = el.getContext('2d');
  return g ? ([el, g] as const) : null;
}

/// `lightness` (0 to 1 per pixel) dithered into `dark` and `light`, as a
/// PNG blob URL (Tauri's CSP has no `data:` images); null where there's no
/// canvas.
function dither(
  w: number,
  h: number,
  lightness: (x: number, y: number) => number,
  dark: string,
  light: string
): Promise<string | null> {
  const c = canvas(w, h);
  if (!c) return Promise.resolve(null);
  const [el, g] = c;
  const img = g.createImageData(w, h);
  const [d, l] = [rgb(dark), rgb(light)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, gr, b] = lightness(x, y) > BAYER[y % 8][x % 8] ? l : d;
      img.data.set([r, gr, b, 255], (y * w + x) * 4);
    }
  }
  g.putImageData(img, 0, 0);
  return new Promise((resolve) =>
    el.toBlob((blob) => resolve(blob && URL.createObjectURL(blob)), 'image/png')
  );
}

function random(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/// A seamless tile of soft clouds, mostly `dark`, for behind the panels.
export function textureUrl(dark: string, light: string, size = 256): Promise<string | null> {
  const r = random(42);
  const grids = [4, 8, 16].map((n) => ({ n, v: Array.from({ length: n * n }, () => r()) }));
  const smooth = (t: number) => t * t * (3 - 2 * t);
  // Value noise on a grid that wraps, so the tile repeats without a seam.
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

/// An image dithered into `dark` and `light` at `width` x `height` pixels,
/// cropped to fill them as `object-fit: cover` does but from the top, where
/// a cover has its title and art, and fading out to `dark` toward the
/// bottom; as a blob URL, null where there's no canvas.
export function ditherImage(
  img: CanvasImageSource & { width: number; height: number },
  dark: string,
  light: string,
  width: number,
  height: number
): Promise<string | null> {
  const c = canvas(width, height);
  if (!c) return Promise.resolve(null);
  const scale = Math.max(width / img.width, height / img.height);
  const [sw, sh] = [width / scale, height / scale];
  c[1].drawImage(img, (img.width - sw) / 2, 0, sw, sh, 0, 0, width, height);
  const px = c[1].getImageData(0, 0, width, height).data;
  return dither(
    width,
    height,
    (x, y) => {
      const k = (y * width + x) * 4;
      const fade = Math.min(1, (2 * (height - y)) / height);
      return ((0.2126 * px[k] + 0.7152 * px[k + 1] + 0.0722 * px[k + 2]) / 255) * fade;
    },
    dark,
    light
  );
}
