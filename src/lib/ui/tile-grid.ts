// One size for every grid of cover tiles — the library and a manga's
// chapters — so they look like the same thing: as many columns as fit, each
// at least `min` px wide. The CSS grid and VirtualGrid both work it out that
// way. `md` (768px) is where `desktop` takes over, in CSS and in
// `TILE_DESKTOP_QUERY`.
export const TILE = {
  phone: { min: 100, gap: 12 },
  desktop: { min: 180, gap: 16 }
} as const;

export const TILE_DESKTOP_QUERY = '(min-width: 768px)';

/// The same, as classes for a plain CSS grid.
export const TILE_GRID_CLASS =
  'grid gap-3 grid-cols-[repeat(auto-fill,minmax(100px,1fr))] md:gap-4 md:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]';
