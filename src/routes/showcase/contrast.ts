type Rgb = [number, number, number];

const rgb = (hex: string): Rgb =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;

const channel = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

const luminance = ([r, g, b]: Rgb) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/// `fg` at `amount` over `bg`, as the theme's `color-mix(… transparent)`
/// tokens come out on screen.
function over(fg: Rgb, bg: Rgb, amount: number): Rgb {
  return fg.map((v, i) => v * amount + bg[i] * (1 - amount)) as Rgb;
}

/// WCAG contrast ratio of `fg` (mixed to `amount`) on `bg`.
export function contrast(fg: string, bg: string, amount = 1): number {
  const b = rgb(bg);
  const a = luminance(over(rgb(fg), b, amount));
  const c = luminance(b);
  return (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05);
}
