import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

describe('serverCoverUrl', () => {
  beforeAll(() => {
    const store = new Map([
      ['kl:serverUrl', 'http://192.168.1.5:3000'],
      ['kl:serverKey', 'abc']
    ]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null });
    vi.resetModules();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('keeps the key and the version as separate parameters', async () => {
    const { serverCoverUrl } = await import('./meta');
    expect(serverCoverUrl('Berserk', 'cover.png', '1:7')).toBe(
      'http://192.168.1.5:3000/api/library/Berserk/cover.png?v=1%3A7&key=abc'
    );
    expect(serverCoverUrl('Berserk', 'cover.png')).toBe(
      'http://192.168.1.5:3000/api/library/Berserk/cover.png?key=abc'
    );
  });
});
