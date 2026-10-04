import { describe, it, expect } from 'vitest';
import { withKey } from '$lib/utils/constants';
import { connectLink, parseConnectLink, parseServerInput, shareLink } from './server-connect';

describe('withKey', () => {
  it('adds the key as the first or a further parameter', () => {
    expect(withKey('/api/library', 'abc')).toBe('/api/library?key=abc');
    expect(withKey('/api/library?limit=2', 'abc')).toBe('/api/library?limit=2&key=abc');
  });

  it('leaves the URL alone without a key', () => {
    expect(withKey('/api/library', '')).toBe('/api/library');
  });
});

describe('parseServerInput', () => {
  it('splits the key off a pasted link', () => {
    expect(parseServerInput('http://192.168.1.5:3000/?key=abc')).toEqual({
      url: 'http://192.168.1.5:3000',
      key: 'abc'
    });
  });

  it('takes a bare address, with or without a scheme', () => {
    expect(parseServerInput('192.168.1.5:3000')).toEqual({
      url: 'http://192.168.1.5:3000',
      key: ''
    });
    expect(parseServerInput(' http://host:3000/ ')).toEqual({ url: 'http://host:3000', key: '' });
  });

  it('keeps a path the server sits under', () => {
    expect(parseServerInput('https://example.com/manga/?key=abc')).toEqual({
      url: 'https://example.com/manga',
      key: 'abc'
    });
  });

  it('is empty for empty input', () => {
    expect(parseServerInput('   ')).toEqual({ url: '', key: '' });
  });
});

describe('links', () => {
  it('a connect link round-trips the server and its key', () => {
    const link = connectLink('http://192.168.1.5:3000', 'abc');
    expect(link).toBe('konigslibrary://connect?host=192.168.1.5&port=3000&key=abc');
    expect(parseConnectLink(link)).toEqual({ url: 'http://192.168.1.5:3000', key: 'abc' });
  });

  it('an old connect link without a key still parses', () => {
    expect(parseConnectLink('konigslibrary://connect?host=h&port=1')).toEqual({
      url: 'http://h:1',
      key: ''
    });
  });

  it('a share link pastes back into the server field', () => {
    const link = shareLink('http://192.168.1.5:3000', 'abc');
    expect(link).toBe('http://192.168.1.5:3000/?key=abc');
    expect(parseServerInput(link)).toEqual({ url: 'http://192.168.1.5:3000', key: 'abc' });
  });
});
