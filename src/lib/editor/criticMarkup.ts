// CriticMarkup parsing and the highlight+comment authoring flow for the editor.
//
// Pure, CodeMirror-free logic so it can be unit-tested over plain strings (the
// project convention: pure `.ts`, thin CM wiring in `cm.ts`). This module scans
// document text for CriticMarkup marks, groups highlight/comment pairs into
// annotations, and produces the CHANGES the CM command layer dispatches when a
// note is added or removed.
//
// The five CriticMarkup mark types (delimiters carry no required inner spaces —
// `{==foo==}` and `{== foo ==}` are both valid, and any inner whitespace is kept
// verbatim as content):
//   addition      {++ text ++}
//   deletion      {-- text --}
//   substitution  {~~ old ~> new ~~}
//   comment       {>> text <<}
//   highlight      {== text ==}

export type CriticMarkKind = 'addition' | 'deletion' | 'substitution' | 'comment' | 'highlight';

export interface CriticMark {
  kind: CriticMarkKind;
  /** Full span INCLUDING delimiters: [from, to) offsets into the doc. */
  from: number;
  to: number;
  /** Inner content span (between the delimiters): [contentFrom, contentTo). */
  contentFrom: number;
  contentTo: number;
  /** For highlight/comment/addition/deletion: the inner text (raw, untrimmed). Undefined for substitution. */
  text?: string;
  /** Substitution only: text before `~>`. */
  deleted?: string;
  /** Substitution only: text after `~>`. */
  inserted?: string;
}

/** A highlight+comment annotation as produced by the authoring flow. Either side may be null:
 *  highlight-only (comment not yet typed) or comment-only (point comment with no highlight). */
export interface Annotation {
  /** Overall span across whichever marks are present. */
  from: number;
  to: number;
  highlight: CriticMark | null;
  comment: CriticMark | null;
}

/** A change set for the editor to dispatch. */
export interface CriticEdit {
  changes: { from: number; to: number; insert: string }[];
  /** Where to place the cursor after applying, or null to let the editor remap. */
  cursor: number | null;
}

/** Opening delimiter (3 chars) → mark kind. */
const OPEN: Record<string, CriticMarkKind> = {
  '{++': 'addition',
  '{--': 'deletion',
  '{~~': 'substitution',
  '{>>': 'comment',
  '{==': 'highlight',
};

/** Mark kind → closing delimiter (3 chars). */
const CLOSE: Record<CriticMarkKind, string> = {
  addition: '++}',
  deletion: '--}',
  substitution: '~~}',
  comment: '<<}',
  highlight: '==}',
};

/** Scan the whole doc, return every CriticMarkup mark in document order (non-overlapping, left-to-right). */
export function parseCriticMarks(doc: string): CriticMark[] {
  const marks: CriticMark[] = [];
  let i = 0;
  while (i < doc.length) {
    const kind = OPEN[doc.slice(i, i + 3)];
    if (kind) {
      // Find the matching close after the open; an unterminated open is not a
      // mark, so fall through and advance a single char to keep scanning.
      const closeIdx = doc.indexOf(CLOSE[kind], i + 3);
      if (closeIdx !== -1) {
        const contentFrom = i + 3;
        const contentTo = closeIdx;
        const inner = doc.slice(contentFrom, contentTo);
        const mark: CriticMark = { kind, from: i, to: closeIdx + 3, contentFrom, contentTo };
        if (kind === 'substitution') {
          // The FIRST `~>` splits old/new; with none present be lenient and
          // treat the whole inner as the deleted side.
          const sep = inner.indexOf('~>');
          if (sep === -1) {
            mark.deleted = inner;
            mark.inserted = '';
          } else {
            mark.deleted = inner.slice(0, sep);
            mark.inserted = inner.slice(sep + 2);
          }
        } else {
          mark.text = inner;
        }
        marks.push(mark);
        i = mark.to;
        continue;
      }
    }
    i++;
  }
  return marks;
}

/** Group marks into annotations. A comment mark whose `from` EQUALS the preceding highlight's `to`
 *  (directly adjacent, zero chars between) binds to that highlight → {highlight, comment}.
 *  A highlight with no adjacent comment → {highlight, comment:null}.
 *  A comment NOT bound to a preceding highlight → {highlight:null, comment} (point comment).
 *  Ignore addition/deletion/substitution marks here (they are not annotations; return them from
 *  parseCriticMarks but pairAnnotations skips them). */
export function pairAnnotations(marks: CriticMark[]): Annotation[] {
  const annotations: Annotation[] = [];
  for (let idx = 0; idx < marks.length; idx++) {
    const mark = marks[idx];
    if (mark.kind === 'highlight') {
      const next = marks[idx + 1];
      if (next && next.kind === 'comment' && next.from === mark.to) {
        annotations.push({ from: mark.from, to: next.to, highlight: mark, comment: next });
        idx++; // consume the bound comment
      } else {
        annotations.push({ from: mark.from, to: mark.to, highlight: mark, comment: null });
      }
    } else if (mark.kind === 'comment') {
      // A bound comment is consumed above, so any comment reached here is a point comment.
      annotations.push({ from: mark.from, to: mark.to, highlight: null, comment: mark });
    }
    // addition/deletion/substitution are not annotations — skip them.
  }
  return annotations;
}

/** The annotation whose overall [from,to) span contains `pos` (pos treated as a caret between chars;
 *  an annotation matches when from <= pos <= to), or null. */
export function annotationAt(annotations: Annotation[], pos: number): Annotation | null {
  for (const ann of annotations) {
    if (ann.from <= pos && pos <= ann.to) return ann;
  }
  return null;
}

/** Wrap [from,to) as a highlight followed by a comment carrying `comment` (empty by default),
 *  producing `{==<selected>==}{>><comment><<}`. With no `comment` the note is empty and the cursor
 *  is parked between `{>>` and `<<}` so it can be typed in the editor (the raw-authoring keybinding
 *  path); when the popup supplies the text up front the caller ignores the cursor. Returns null when
 *  from === to (nothing selected). */
export function insertHighlightComment(
  doc: string,
  from: number,
  to: number,
  comment = '',
): CriticEdit | null {
  if (from === to) return null;
  return {
    changes: [
      { from, to: from, insert: '{==' },
      { from: to, to, insert: `==}{>>${comment}<<}` },
    ],
    // 3 for `{==` inserted before the selection + 6 for `==}{>>` after it: the
    // start of the comment content (before `comment`).
    cursor: to + 9,
  };
}

/** Set an annotation's comment text (the popup edit path). When the annotation already carries a
 *  comment, replace its inner content in place; when it is highlight-only, append a fresh
 *  `{>><text><<}` directly after the highlight (so it binds). No-op (empty change set) for an
 *  annotation with neither a comment nor a highlight. Cursor null (let the editor remap). */
export function setCommentText(doc: string, annotation: Annotation, text: string): CriticEdit {
  const { highlight, comment } = annotation;
  if (comment) {
    return { changes: [{ from: comment.contentFrom, to: comment.contentTo, insert: text }], cursor: null };
  }
  if (highlight) {
    return { changes: [{ from: highlight.to, to: highlight.to, insert: `{>>${text}<<}` }], cursor: null };
  }
  return { changes: [], cursor: null };
}

/** Strip an annotation's markup, KEEPING the highlighted text: remove the highlight delimiters
 *  (`{==` and `==}`) and delete the entire bound comment `{>>...<<}`. For a point comment
 *  (highlight null) just delete the comment. Returns the changes; cursor null (let editor remap). */
export function removeAnnotation(doc: string, annotation: Annotation): CriticEdit {
  const changes: { from: number; to: number; insert: string }[] = [];
  const { highlight, comment } = annotation;
  if (highlight) {
    // Drop the opening `{==` and the closing `==}`, keeping the inner text.
    changes.push({ from: highlight.from, to: highlight.contentFrom, insert: '' });
    changes.push({ from: highlight.contentTo, to: highlight.to, insert: '' });
  }
  if (comment) {
    // The whole comment (delimiters + note) goes away.
    changes.push({ from: comment.from, to: comment.to, insert: '' });
  }
  return { changes, cursor: null };
}
