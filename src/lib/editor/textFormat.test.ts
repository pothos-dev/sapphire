// Unit tests for the pure markdown formatting transforms (Ctrl+B / Ctrl+I / …).
// Run with `bun test src/lib`. Pins the toggle behaviour: wrapping, unwrapping
// (markers outside vs inside the selection), the empty-selection cursor park,
// and heading set / toggle-off across single and multi-line selections.
import { describe, expect, test } from 'bun:test';
import { headingFormatEdit, setHeadingLevel, toggleInlineWrap } from './textFormat';

describe('toggleInlineWrap', () => {
  test('wraps a non-empty selection and selects the inner text', () => {
    // "foo bar" — select "bar" (4..7), bold it.
    expect(toggleInlineWrap('foo bar', 4, 7, '**')).toEqual({
      changes: [
        { from: 4, to: 4, insert: '**' },
        { from: 7, to: 7, insert: '**' },
      ],
      selection: { anchor: 6, head: 9 },
    });
  });

  test('unwraps when the markers sit outside the selection (inner text selected)', () => {
    // "**bar**" — select the inner "bar" (2..5).
    expect(toggleInlineWrap('**bar**', 2, 5, '**')).toEqual({
      changes: [
        { from: 0, to: 2, insert: '' },
        { from: 5, to: 7, insert: '' },
      ],
      selection: { anchor: 0, head: 3 },
    });
  });

  test('unwraps when the markers are included in the selection (whole run selected)', () => {
    // "**bar**" — select the whole thing (0..7).
    expect(toggleInlineWrap('**bar**', 0, 7, '**')).toEqual({
      changes: [
        { from: 0, to: 2, insert: '' },
        { from: 5, to: 7, insert: '' },
      ],
      selection: { anchor: 0, head: 3 },
    });
  });

  test('empty selection inserts an empty pair and parks the cursor between', () => {
    expect(toggleInlineWrap('foo', 1, 1, '*')).toEqual({
      changes: [{ from: 1, to: 1, insert: '**' }],
      selection: { anchor: 2, head: 2 },
    });
  });

  test('single-char markers (inline code) work the same way', () => {
    expect(toggleInlineWrap('a b', 2, 3, '`')).toEqual({
      changes: [
        { from: 2, to: 2, insert: '`' },
        { from: 3, to: 3, insert: '`' },
      ],
      selection: { anchor: 3, head: 4 },
    });
  });

  test('strikethrough uses the ~~ marker', () => {
    expect(toggleInlineWrap('done', 0, 4, '~~')).toEqual({
      changes: [
        { from: 0, to: 0, insert: '~~' },
        { from: 4, to: 4, insert: '~~' },
      ],
      selection: { anchor: 2, head: 6 },
    });
  });
});

describe('setHeadingLevel', () => {
  test('adds a prefix to a plain line', () => {
    expect(setHeadingLevel('foo', 2)).toBe('## foo');
  });

  test('moves an existing heading to another level', () => {
    expect(setHeadingLevel('### bar', 1)).toBe('# bar');
  });

  test('level 0 strips the heading prefix', () => {
    expect(setHeadingLevel('## foo', 0)).toBe('foo');
    expect(setHeadingLevel('plain', 0)).toBe('plain');
  });
});

describe('headingFormatEdit', () => {
  test('sets a paragraph to a heading at the cursor line', () => {
    expect(headingFormatEdit('foo\nbar', 0, 0, 2)).toEqual({
      changes: [{ from: 0, to: 3, insert: '## foo' }],
    });
  });

  test('toggles off when the line is already exactly that level', () => {
    expect(headingFormatEdit('## foo', 0, 0, 2)).toEqual({
      changes: [{ from: 0, to: 6, insert: 'foo' }],
    });
  });

  test('applies to every non-blank line in a multi-line selection', () => {
    expect(headingFormatEdit('a\nb', 0, 3, 1)).toEqual({
      changes: [
        { from: 0, to: 1, insert: '# a' },
        { from: 2, to: 3, insert: '# b' },
      ],
    });
  });

  test('level 0 strips an existing heading', () => {
    expect(headingFormatEdit('# a', 0, 0, 0)).toEqual({
      changes: [{ from: 0, to: 3, insert: 'a' }],
    });
  });

  test('blank lines are left untouched', () => {
    // Selection spans "a", the blank line, then "b".
    expect(headingFormatEdit('a\n\nb', 0, 4, 1)).toEqual({
      changes: [
        { from: 0, to: 1, insert: '# a' },
        { from: 3, to: 4, insert: '# b' },
      ],
    });
  });
});
