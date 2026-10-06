import { describe, it, expect } from 'vitest';
import { parseServerUrl, shareLink } from './server-connect';

describe('parseServerUrl', () => {
  it('drops the key a link from before accounts carries', () => {
    expect(parseServerUrl('http://192.168.1.5:3000/?key=abc')).toBe('http://192.168.1.5:3000');
  });

  it('takes a bare address, with or without a scheme', () => {
    expect(parseServerUrl('192.168.1.5:3000')).toBe('http://192.168.1.5:3000');
    expect(parseServerUrl(' http://host:3000/ ')).toBe('http://host:3000');
  });

  it('takes a bare domain for a server on the internet, over HTTPS', () => {
    expect(parseServerUrl('klserver.nassu.online')).toBe('https://klserver.nassu.online');
    expect(parseServerUrl('library.example.com:5511/manga')).toBe(
      'https://library.example.com:5511/manga'
    );
  });

  it('takes a bare local address over HTTP, as Share to LAN serves', () => {
    expect(parseServerUrl('localhost:3000')).toBe('http://localhost:3000');
    expect(parseServerUrl('nas:5511')).toBe('http://nas:5511');
    expect(parseServerUrl('nas.local:5511')).toBe('http://nas.local:5511');
    expect(parseServerUrl('[fe80::1]:3000')).toBe('http://[fe80::1]:3000');
  });

  it('keeps the scheme it is given', () => {
    expect(parseServerUrl('http://klserver.nassu.online')).toBe('http://klserver.nassu.online');
  });

  it('keeps a path the server sits under', () => {
    expect(parseServerUrl('https://example.com/manga/')).toBe('https://example.com/manga');
  });

  it('is empty for empty input', () => {
    expect(parseServerUrl('   ')).toBe('');
  });
});

describe('links', () => {
  it('a share link pastes back into the server field', () => {
    const link = shareLink('http://192.168.1.5:3000');
    expect(link).toBe('http://192.168.1.5:3000/');
    expect(parseServerUrl(link)).toBe('http://192.168.1.5:3000');
  });
});
