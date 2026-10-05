import { describe, expect, it } from 'vitest';
import { hover, mix } from '.';

describe('mix', () => {
  it('mixes like color-mix in srgb', () => {
    expect(mix('#ff71ce', '#000000', 0.6)).toBe('#99447c');
  });
});

describe('hover', () => {
  it('lightens the ink on a dark background', () => {
    expect(hover({ bg: '#000000', fg: '#d8f6ff', ink: '#ff71ce' })).toBe('#ffaae2');
  });

  it('darkens it on a light one', () => {
    expect(hover({ bg: '#f4f0e8', fg: '#141414', ink: '#ff71ce' })).toBe('#99447c');
  });

  it('moves an ink already at the end back toward the background', () => {
    expect(hover({ bg: '#000000', fg: '#ffffff', ink: '#ffffff' })).toBe('#bfbfbf');
  });
});
