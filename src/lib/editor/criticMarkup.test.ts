// Unit tests for the pure CriticMarkup parsing + annotation authoring logic.
// Run with `bun test src/lib`. Pins: parsing each of the 5 mark types (spans,
// content bounds, payloads, substitution split), unterminated/empty handling,
// highlight+comment pairing (adjacency), annotation lookup by caret, and the
// insert / remove change sets (also applied to a string to confirm the result).
import { describe, expect, test } from 'bun:test';
import {
  annotationAt,
  changeMarkDecorations,
  insertHighlightComment,
  pairAnnotations,
  parseCriticMarks,
  removeAnnotation,
  setCommentText,
  type Annotation,
  type CriticDeco,
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

  test('embeds a supplied comment (the popup add path)', () => {
    const edit = insertHighlightComment('hello world', 0, 5, 'a note')!;
    expect(applyChanges('hello world', edit.changes)).toBe('{==hello==}{>>a note<<} world');
  });
});

describe('setCommentText', () => {
  test('replaces an existing comment in place', () => {
    const doc = '{==keep==}{>>old<<}';
    const ann = pairAnnotations(parseCriticMarks(doc))[0];
    const edit = setCommentText(doc, ann, 'new note');
    expect(applyChanges(doc, edit.changes)).toBe('{==keep==}{>>new note<<}');
  });

  test('appends a comment to a highlight-only annotation', () => {
    const doc = '{==keep==}';
    const ann = pairAnnotations(parseCriticMarks(doc))[0];
    const edit = setCommentText(doc, ann, 'added');
    expect(applyChanges(doc, edit.changes)).toBe('{==keep==}{>>added<<}');
  });

  test('updates a point comment', () => {
    const doc = 'a {>>old<<} b';
    const ann = pairAnnotations(parseCriticMarks(doc))[0];
    const edit = setCommentText(doc, ann, 'fresh');
    expect(applyChanges(doc, edit.changes)).toBe('a {>>fresh<<} b');
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

describe('changeMarkDecorations', () => {
  /** Compute decos for `doc` (no selection unless given) and tag each with the text it covers. */
  const decosFor = (
    doc: string,
    selections: { from: number; to: number }[] = [],
    allowReveal = false,
  ): (CriticDeco & { text: string })[] =>
    changeMarkDecorations(parseCriticMarks(doc), selections, allowReveal).map((d) => ({
      ...d,
      text: doc.slice(d.from, d.to),
    }));

  test('addition: green add span with both delimiters hidden', () => {
    const decos = decosFor('{++new++}');
    expect(decos).toEqual([
      { from: 3, to: 6, kind: 'add', text: 'new' },
      { from: 0, to: 3, kind: 'hide', text: '{++' },
      { from: 6, to: 9, kind: 'hide', text: '++}' },
    ]);
  });

  test('deletion: red del span with both delimiters hidden', () => {
    const decos = decosFor('{--old--}');
    expect(decos).toEqual([
      { from: 3, to: 6, kind: 'del', text: 'old' },
      { from: 0, to: 3, kind: 'hide', text: '{--' },
      { from: 6, to: 9, kind: 'hide', text: '--}' },
    ]);
  });

  test('substitution: red old span immediately followed by green new span', () => {
    const decos = decosFor('{~~old~>new~~}');
    // del `old`, then the `~>` separator hidden, then add `new`, then the outer delimiters.
    expect(decos).toEqual([
      { from: 3, to: 6, kind: 'del', text: 'old' },
      { from: 6, to: 8, kind: 'hide', text: '~>' },
      { from: 8, to: 11, kind: 'add', text: 'new' },
      { from: 0, to: 3, kind: 'hide', text: '{~~' },
      { from: 11, to: 14, kind: 'hide', text: '~~}' },
    ]);
    // The del span ends exactly where the add span begins (once the `~>` is hidden): adjacent.
    const del = decos.find((d) => d.kind === 'del')!;
    const add = decos.find((d) => d.kind === 'add')!;
    expect(add.from - del.to).toBe(2); // only the hidden `~>` sits between them
  });

  test('substitution with an empty half skips that zero-length span', () => {
    // Empty `new`: a del span + hidden separator + hidden delimiters, no add span.
    expect(decosFor('{~~gone~>~~}').map((d) => d.kind)).toEqual(['del', 'hide', 'hide', 'hide']);
    // Empty `old`: no del span; add span + hidden separator + delimiters.
    expect(decosFor('{~~~>added~~}').map((d) => d.kind)).toEqual(['hide', 'add', 'hide', 'hide']);
  });

  test('substitution with no ~> treats the whole inner as a red del span', () => {
    const decos = decosFor('{~~only~~}');
    expect(decos).toEqual([
      { from: 3, to: 7, kind: 'del', text: 'only' },
      { from: 0, to: 3, kind: 'hide', text: '{~~' },
      { from: 7, to: 10, kind: 'hide', text: '~~}' },
    ]);
  });

  test('no strikethrough/underline is a styling concern — the descriptors carry only add/del/hide', () => {
    const kinds = decosFor('{++a++}{--b--}{~~c~>d~~}').map((d) => d.kind);
    expect(new Set(kinds)).toEqual(new Set(['add', 'del', 'hide']));
  });

  test('reveal (hybrid): a selection touching the mark keeps delimiters visible', () => {
    // Caret inside the addition → delimiters NOT hidden, but the tint span stays.
    const decos = decosFor('{++new++}', [{ from: 4, to: 4 }], true);
    expect(decos).toEqual([{ from: 3, to: 6, kind: 'add', text: 'new' }]);
  });

  test('reveal only when allowed: view mode never reveals even with a caret inside', () => {
    const decos = decosFor('{++new++}', [{ from: 4, to: 4 }], false);
    expect(decos.map((d) => d.kind)).toEqual(['add', 'hide', 'hide']);
  });

  test('a selection OUTSIDE the mark does not reveal it', () => {
    const decos = decosFor('xx {++new++}', [{ from: 0, to: 1 }], true);
    expect(decos.map((d) => d.kind)).toEqual(['add', 'hide', 'hide']);
  });

  test('reveal is per-mark: only the touched substitution stays raw', () => {
    const doc = '{--a--}{~~b~>c~~}';
    // Caret inside the substitution (offsets 7..17) but not the deletion.
    const kinds = decosFor(doc, [{ from: 10, to: 10 }], true).map((d) => d.kind);
    // deletion collapses (del + 2 hides); substitution reveals (del, add only, no hides).
    expect(kinds).toEqual(['del', 'hide', 'hide', 'del', 'add']);
  });

  test('ignores highlight and comment marks (handled by the annotation flow)', () => {
    expect(changeMarkDecorations(parseCriticMarks('{==hi==}{>>note<<}'), [], false)).toEqual([]);
  });

  test('multiple change marks decorated independently in document order', () => {
    const decos = decosFor('{++a++} {--b--}');
    expect(decos.map((d) => [d.kind, d.text])).toEqual([
      ['add', 'a'],
      ['hide', '{++'],
      ['hide', '++}'],
      ['del', 'b'],
      ['hide', '{--'],
      ['hide', '--}'],
    ]);
  });
});
