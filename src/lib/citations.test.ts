import { describe, it, expect } from 'bun:test';
import { findCitationRefs, citationDefPos } from './citations';

describe('findCitationRefs', () => {
  it('finds a reference that follows a word', () => {
    const text = 'deepen umami and body.[6]';
    expect(findCitationRefs(text)).toEqual([{ from: 22, to: 25, num: '6' }]);
  });

  it('finds each of a run of adjacent references', () => {
    const text = 'consommés.[6][7][8]';
    expect(findCitationRefs(text).map((r) => r.num)).toEqual(['6', '7', '8']);
  });

  it('reports offsets that slice back to the exact `[n]` token', () => {
    const text = 'word[42] after';
    const [ref] = findCitationRefs(text);
    expect(text.slice(ref.from, ref.to)).toBe('[42]');
    expect(ref.num).toBe('42');
  });

  it('ignores a `[n]` at the start of a line (a table row / definition)', () => {
    const text = 'body.[6]\n\n[1] The basic tastes and receptor families.';
    expect(findCitationRefs(text).map((r) => r.num)).toEqual(['6']);
  });

  it('ignores an indented line-start `[n]`', () => {
    const text = '   [2] indented definition';
    expect(findCitationRefs(text)).toEqual([]);
  });

  it('ignores a real markdown link `[6](url)`', () => {
    expect(findCitationRefs('see[6](http://x)')).toEqual([]);
  });

  it('ignores a reference-link definition `[6]: url`', () => {
    expect(findCitationRefs('x[6]: http://x')).toEqual([]);
  });

  it('ignores a `[[wikilink]]` fragment', () => {
    expect(findCitationRefs('see [[6]] here')).toEqual([]);
  });

  it('ignores bracketed non-numbers and footnotes', () => {
    expect(findCitationRefs('a[x] b[^6] c[ ]')).toEqual([]);
  });

  it('does not treat a space-preceded `[n]` as a reference', () => {
    expect(findCitationRefs('tail [6]')).toEqual([]);
  });
});

describe('citationDefPos', () => {
  const doc = 'body.[6]\n\n# Citations\n\n[1] first entry\n[6] sixth entry\n';

  it('locates the definition row for a number', () => {
    const pos = citationDefPos(doc, '6');
    expect(pos).not.toBeNull();
    expect(doc.slice(pos as number, (pos as number) + 3)).toBe('[6]');
  });

  it('returns the first row, not the inline reference', () => {
    // The inline `[6]` at offset 5 must not win over the line-start definition.
    expect(citationDefPos(doc, '6')).toBeGreaterThan(10);
  });

  it('finds an indented definition', () => {
    expect(citationDefPos('  [3] x', '3')).toBe(2);
  });

  it('returns null when there is no matching row', () => {
    expect(citationDefPos(doc, '9')).toBeNull();
  });
});
