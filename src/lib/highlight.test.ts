import { describe, expect, test } from 'bun:test';
import { highlightParts } from './highlight';

describe('highlightParts', () => {
  test('empty query yields a single unmatched run', () => {
    expect(highlightParts('hello world', '')).toEqual([
      { text: 'hello world', match: false },
    ]);
    expect(highlightParts('hello', '   ')).toEqual([{ text: 'hello', match: false }]);
  });

  test('splits around a single match, preserving original casing', () => {
    expect(highlightParts('Hello World', 'world')).toEqual([
      { text: 'Hello ', match: false },
      { text: 'World', match: true },
    ]);
  });

  test('emphasises every occurrence', () => {
    expect(highlightParts('aXaXa', 'x')).toEqual([
      { text: 'a', match: false },
      { text: 'X', match: true },
      { text: 'a', match: false },
      { text: 'X', match: true },
      { text: 'a', match: false },
    ]);
  });

  test('a match at the very start has no leading unmatched run', () => {
    expect(highlightParts('match here', 'match')).toEqual([
      { text: 'match', match: true },
      { text: ' here', match: false },
    ]);
  });

  test('no match yields the whole snippet unmatched', () => {
    expect(highlightParts('nothing', 'zzz')).toEqual([
      { text: 'nothing', match: false },
    ]);
  });
});
