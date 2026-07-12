// Unit tests for the pure CriticMarkup parsing + annotation authoring logic.
// Run with `bun test src/lib`. Pins: parsing each of the 5 mark types (spans,
// content bounds, payloads, substitution split), unterminated/empty handling,
// highlight+comment pairing (adjacency), annotation lookup by caret, and the
// insert / remove change sets (also applied to a string to confirm the result).
import { describe, expect, test } from 'bun:test';
import {
  annotationAt,
  insertHighlightComment,
  pairAnnotations,
  parseCriticMarks,
  removeAnnotation,
  type Annotation,
} from './criticMarkup';

/** Apply a change set to a doc string (test-only remap, mirrors CM's dispatch). */
function applyChanges(doc: string, changes: { from: number; to: number; insert: string }[]): string {
  const sorted = [...changes].sort((a, b) => a.from - b.from);
  let out = '';
  let pos = 0;
  for (const c of sorted) {
    out += doc.slice(pos, c.from) + c.insert;
    pos = c.to;
  }
  return out + doc.slice(pos);
}

describe('parseCriticMarks', () => {
  test('parses an addition with full and content spans', () => {
    const [m] = parseCriticMarks('{++new++}');
    expect(m).toEqual({
      kind: 'addition',
      from: 0,
      to: 9,
      contentFrom: 3,
      contentTo: 6,
      text: 'new',
    });
  });

  test('parses a deletion', () => {
    const [m] = parseCriticMarks('{--old--}');
    expect(m.kind).toBe('deletion');
    expect(m.text).toBe('old');
    expect([m.from, m.to, m.contentFrom, m.contentTo]).toEqual([0, 9, 3, 6]);
  });

  test('parses a highlight', () => {
    const [m] = parseCriticMarks('{==hi==}');
    expect(m.kind).toBe('highlight');
    expect(m.text).toBe('hi');
    expect([m.from, m.to, m.contentFrom, m.contentTo]).toEqual([0, 8, 3, 5]);
  });

  test('parses a comment', () => {
    const [m] = parseCriticMarks('{>>note<<}');
    expect(m.kind).toBe('comment');
    expect(m.text).toBe('note');
    expect([m.from, m.to, m.contentFrom, m.contentTo]).toEqual([0, 10, 3, 7]);
  });

  test('splits a substitution on the first ~>', () => {
    const [m] = parseCriticMarks('{~~old~>new~~}');
    expect(m.kind).toBe('substitution');
    expect(m.deleted).toBe('old');
    expect(m.inserted).toBe('new');
    expect(m.text).toBeUndefined();
  });

  test('substitution with no ~> keeps whole inner as deleted', () => {
    const [m] = parseCriticMarks('{~~only~~}');
    expect(m.deleted).toBe('only');
    expect(m.inserted).toBe('');
  });

  test('substitution splits on the FIRST ~> only', () => {
    const [m] = parseCriticMarks('{~~a~>b~>c~~}');
    expect(m.deleted).toBe('a');
    expect(m.inserted).toBe('b~>c');
  });

  test('keeps inner whitespace untrimmed', () => {
    const [m] = parseCriticMarks('{== foo ==}');
    expect(m.text).toBe(' foo ');
  });

  test('parses multiple marks in document order', () => {
    const marks = parseCriticMarks('a {++x++} b {>>y<<} c');
    expect(marks.map((m) => m.kind)).toEqual(['addition', 'comment']);
    expect(marks[0].from).toBe(2);
    expect(marks[1].from).toBe(12);
  });

  test('ignores an unterminated opening delimiter', () => {
    expect(parseCriticMarks('{++ no close here')).toEqual([]);
  });

  test('still finds a later mark after an unterminated open', () => {
    const marks = parseCriticMarks('{++ oops then {==real==}');
    expect(marks).toHaveLength(1);
    expect(marks[0].kind).toBe('highlight');
    expect(marks[0].text).toBe('real');
  });

  test('handles empty inner content', () => {
    const hi = parseCriticMarks('{====}')[0];
    expect(hi.kind).toBe('highlight');
    expect(hi.text).toBe('');
    expect([hi.contentFrom, hi.contentTo]).toEqual([3, 3]);

    const co = parseCriticMarks('{>><<}')[0];
    expect(co.kind).toBe('comment');
    expect(co.text).toBe('');
    expect([co.contentFrom, co.contentTo]).toEqual([3, 3]);
  });
});

describe('pairAnnotations', () => {
  test('binds an adjacent highlight and comment', () => {
    const marks = parseCriticMarks('{==h==}{>>c<<}');
    const anns = pairAnnotations(marks);
    expect(anns).toHaveLength(1);
    expect(anns[0].highlight).toBe(marks[0]);
    expect(anns[0].comment).toBe(marks[1]);
    expect([anns[0].from, anns[0].to]).toEqual([0, marks[1].to]);
  });

  test('does NOT bind when a space separates highlight and comment', () => {
    const marks = parseCriticMarks('{==h==} {>>c<<}');
    const anns = pairAnnotations(marks);
    expect(anns).toHaveLength(2);
    expect(anns[0]).toMatchObject({ highlight: marks[0], comment: null });
    expect(anns[1]).toMatchObject({ highlight: null, comment: marks[1] });
  });

  test('highlight with no following comment is highlight-only', () => {
    const marks = parseCriticMarks('{==h==}');
    const anns = pairAnnotations(marks);
    expect(anns).toEqual([{ from: 0, to: marks[0].to, highlight: marks[0], comment: null }]);
  });

  test('a lone comment is a point comment', () => {
    const marks = parseCriticMarks('{>>c<<}');
    const anns = pairAnnotations(marks);
    expect(anns).toEqual([{ from: 0, to: marks[0].to, highlight: null, comment: marks[0] }]);
  });

  test('excludes addition / deletion / substitution marks', () => {
    const marks = parseCriticMarks('{++a++}{--d--}{~~o~>n~~}');
    expect(pairAnnotations(marks)).toEqual([]);
  });
});

describe('annotationAt', () => {
  const anns = pairAnnotations(parseCriticMarks('xx{==h==}{>>c<<}yy'));
  const { from, to } = anns[0];

  test('matches a caret inside the span', () => {
    expect(annotationAt(anns, from + 1)).toBe(anns[0]);
  });

  test('matches at both edges (inclusive)', () => {
    expect(annotationAt(anns, from)).toBe(anns[0]);
    expect(annotationAt(anns, to)).toBe(anns[0]);
  });

  test('returns null outside the span', () => {
    expect(annotationAt(anns, from - 1)).toBeNull();
    expect(annotationAt(anns, to + 1)).toBeNull();
  });
});

describe('insertHighlightComment', () => {
  test('produces the two inserts and parks the cursor in the comment', () => {
    const edit = insertHighlightComment('hello world', 0, 5);
    expect(edit).toEqual({
      changes: [
        { from: 0, to: 0, insert: '{==' },
        { from: 5, to: 5, insert: '==}{>><<}' },
      ],
      cursor: 14, // to + 9
    });
  });

  test('applying the changes yields the expected markup', () => {
    const edit = insertHighlightComment('hello world', 0, 5)!;
    const result = applyChanges('hello world', edit.changes);
    expect(result).toBe('{==hello==}{>><<} world');
    // Cursor sits between `{>>` and `<<}`.
    expect(result.slice(edit.cursor! - 3, edit.cursor!)).toBe('{>>');
    expect(result.slice(edit.cursor!, edit.cursor! + 3)).toBe('<<}');
  });

  test('returns null when nothing is selected', () => {
    expect(insertHighlightComment('hello', 2, 2)).toBeNull();
  });
});

describe('removeAnnotation', () => {
  test('highlight + comment leaves the bare highlighted text', () => {
    const doc = '{==keep==}{>>note<<}';
    const ann = pairAnnotations(parseCriticMarks(doc))[0];
    const edit = removeAnnotation(doc, ann);
    expect(edit.cursor).toBeNull();
    expect(applyChanges(doc, edit.changes)).toBe('keep');
  });

  test('point comment is removed entirely', () => {
    const doc = 'a {>>note<<} b';
    const ann = pairAnnotations(parseCriticMarks(doc))[0];
    const edit = removeAnnotation(doc, ann);
    expect(applyChanges(doc, edit.changes)).toBe('a  b');
  });

  test('highlight-only leaves the bare text', () => {
    const doc = '{==kept==}';
    const ann: Annotation = pairAnnotations(parseCriticMarks(doc))[0];
    const edit = removeAnnotation(doc, ann);
    expect(applyChanges(doc, edit.changes)).toBe('kept');
  });
});
