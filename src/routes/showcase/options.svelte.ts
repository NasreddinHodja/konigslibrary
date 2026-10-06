/// A preset: background, text, and the ink for borders, links and the
/// current thing. The ink's two darker steps (shadows, visited) are mixed
/// toward the background.
export type Palette = { id: string; name: string; bg: string; fg: string; ink: string };

export const PALETTES: Palette[] = [
  { id: 'pink', name: 'meth pink', bg: '#000000', fg: '#ddccff', ink: '#cc44ee' },
  { id: 'hot', name: 'hot pink', bg: '#000000', fg: '#ffd6ec', ink: '#ff3ea5' },
  { id: 'bubblegum', name: 'bubblegum', bg: '#000000', fg: '#ffe0f0', ink: '#ff8fc8' },
  { id: 'magenta', name: 'magenta', bg: '#000000', fg: '#ffccff', ink: '#ff00ff' },
  { id: 'sakura', name: 'sakura', bg: '#000000', fg: '#fff0f5', ink: '#f4a7c0' },
  { id: 'rose', name: 'rose', bg: '#000000', fg: '#f2d4dc', ink: '#e0457b' },
  { id: 'vapor', name: 'vapor', bg: '#000000', fg: '#d8f6ff', ink: '#ff71ce' },
  { id: 'dusk', name: 'dusk', bg: '#12001a', fg: '#f0d0ff', ink: '#e040a0' },
  { id: 'white', name: 'white', bg: '#000000', fg: '#ffffff', ink: '#ffffff' },
  { id: 'paper', name: 'paper', bg: '#f4f0e8', fg: '#141414', ink: '#141414' },
  { id: 'onebark', name: 'one bark', bg: '#282c34', fg: '#dcdfe4', ink: '#c678dd' }
];

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c: number[]) =>
  '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/// `a` at `amount` over `b`.
export const mix = (a: string, b: string, amount: number) => {
  const [x, y] = [rgb(a), rgb(b)];
  return hex(x.map((v, i) => v * amount + y[i] * (1 - amount)));
};

const lightness = (c: string) => {
  const [r, g, b] = rgb(c);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

/// Hover: the ink moved away from the background, so it stands out more. An
/// ink already at that end (white on black) moves back toward the
/// background instead.
function hover(p: Palette) {
  const away = mix(p.ink, lightness(p.bg) < 0.5 ? '#ffffff' : '#000000', 0.6);
  return Math.abs(lightness(away) - lightness(p.ink)) < 0.08 ? mix(p.ink, p.bg, 0.75) : away;
}

export function tokens(p: Palette) {
  return {
    bg: p.bg,
    fg: p.fg,
    dim: mix(p.fg, p.bg, 0.67),
    ink: p.ink,
    hi: hover(p),
    ink2: mix(p.ink, p.bg, 0.6),
    ink3: mix(p.ink, p.bg, 0.3)
  };
}

/// The showcase's switches, read by its parts.
export const opts = $state({
  /// Decided: grid9.
  iconSet: 'grid9',
  iconScale: 'app' as 1 | 2 | 3 | 'app',
  /// Decided: banded.
  caption: 'band' as 'band' | 'under',
  /// Decided: on.
  texture: 'on' as 'on' | 'off'
});

/// Raised: the ink's two darker steps, stacked down and right.
export const RAISED = 'shadow-[2px_2px_0_var(--ink2),4px_4px_0_var(--ink3)]';

/// The proposed focus ring: dotted, in the hover ink. Important, to beat
/// the app's own `:focus-visible` rule while it's still there.
export const FOCUS =
  'focus-visible:outline-1! focus-visible:outline-dotted! focus-visible:outline-offset-2! focus-visible:outline-(--hi)!';
