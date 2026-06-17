// Unit tests for the quick-nav fuzzy matcher (pure, no DOM/IPC).
// Run with `bun test src/lib`. Pins subsequence matching, the substring bonus,
// and the ranking order.
import { describe, expect, test } from 'bun:test';
import { fuzzyMatch, fuzzyRank } from './fuzzy';

describe('fuzzyMatch', () => {
  test('empty query matches with a neutral score', () => {
    expect(fuzzyMatch('', 'anything.md')).toEqual({
      target: 'anything.md',
      score: 0,
      positions: [],
    });
  });

  test('non-subsequence returns null', () => {
    expect(fuzzyMatch('xz', 'abc')).toBeNull();
    expect(fuzzyMatch('ba', 'ab')).toBeNull(); // order matters
  });

  test('subsequence match records ascending positions', () => {
    const m = fuzzyMatch('ab', 'xaybz');
    expect(m).not.toBeNull();
    expect(m!.positions).toEqual([1, 3]);
  });

  test('matching is case-insensitive', () => {
    expect(fuzzyMatch('AB', 'cab')).not.toBeNull();
  });

  test('a contiguous substring scores higher than a scattered subsequence', () => {
    const contiguous = fuzzyMatch('foo', 'foobar')!;
    const scattered = fuzzyMatch('foo', 'f_o_o_bar')!;
    expect(contiguous.score).toBeGreaterThan(scattered.score);
  });
});

describe('fuzzyRank', () => {
  test('drops non-matches and ranks the basename substring first', () => {
    const ranked = fuzzyRank('foo', ['nope.md', 'a/foo.md', 'barfoo.md']);
    expect(ranked.map((m) => m.target)).not.toContain('nope.md');
    expect(ranked[0].target).toBe('a/foo.md');
  });

  test('ties break by shorter target then alphabetical', () => {
    const ranked = fuzzyRank('ab', ['abx.md', 'ab.md']);
    expect(ranked.map((m) => m.target)).toEqual(['ab.md', 'abx.md']);
  });
});
