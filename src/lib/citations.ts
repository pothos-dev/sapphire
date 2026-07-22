// Pure citation-reference detection (slice: citation-superscripts).
//
// A "citation reference" is a bracketed number that FOLLOWS a word inline —
// e.g. the `[6][7][8]` at the end of `…deep umami and body.[6][7][8]`. Those
// render as superscript, clickable links that jump to the matching entry in the
// citation table.
//
// A "citation definition" is the same `[n]` token sitting at the START of a
// line — the rows of the citation table itself (`[1] The basic tastes …`).
// Those must NOT be superscripted (a superscript row head would read wrong);
// they stay literal text and act as the jump TARGETS.
//
// The single rule that separates the two: a reference is immediately preceded
// by a non-whitespace character (it follows a word, punctuation, or the `]` of
// an adjacent reference like `[6][7]`); a definition is at line start, so it is
// preceded by a newline / start-of-document and is excluded.
//
// This module is DOM-free and CodeMirror-free so it can be unit-tested; the
// editor extension (`editor/citations.ts`) and any renderer layer thinly over
// these helpers.

/** A citation reference found in some text: its `[n]` span and the number `n`. */
export interface CitationRef {
  /** Offset of the `[` (inclusive), relative to the scanned text. */
  from: number;
  /** Offset just past the `]` (exclusive). */
  to: number;
  /** The citation number as written (digits only, e.g. `"7"`). */
  num: string;
}

/** Matches a bare bracketed integer: `[6]`, `[42]`. NOT `[6.1]`, `[^6]`, `[ ]`. */
const BRACKET_NUM_RE = /\[(\d+)\]/g;

/**
 * Find every inline citation reference in `text`. A `[n]` qualifies when it
 * FOLLOWS a word — i.e. the char immediately before `[` exists and is neither
 * whitespace nor `[` (the latter would be a `[[wikilink]]` fragment) — and is
 * NOT immediately followed by a character that makes it something else:
 *   - `]`  → part of a `]]` (wikilink close), not a standalone reference;
 *   - `(`  → an actual markdown link `[6](url)`;
 *   - `:`  → a reference-link definition `[6]: url`.
 * Line-start `[n]` (the citation-table rows) fail the "preceded by non-space"
 * test and are intentionally skipped. Returns matches in document order.
 */
export function findCitationRefs(text: string): CitationRef[] {
  const refs: CitationRef[] = [];
  for (const m of text.matchAll(BRACKET_NUM_RE)) {
    const from = m.index ?? 0;
    const to = from + m[0].length;
    const before = from > 0 ? text[from - 1] : '';
    const after = to < text.length ? text[to] : '';
    // Must follow a word: a non-whitespace char that is not an opening `[`.
    if (before === '' || /\s/.test(before) || before === '[') continue;
    // Reject the disambiguating trailers (`]]`, markdown link, ref definition).
    if (after === ']' || after === '(' || after === ':') continue;
    refs.push({ from, to, num: m[1] });
  }
  return refs;
}

/**
 * Offset of the citation-table DEFINITION for `num` — the first line whose
 * first non-blank content is `[num]` (allowing leading indentation). Returns
 * the offset of the `[`, or `null` when there is no such row. This is the jump
 * target a reference click scrolls to.
 */
export function citationDefPos(text: string, num: string): number | null {
  // `num` is digits-only (from `findCitationRefs`), so it is regex-safe.
  const re = new RegExp(`^[ \\t]*\\[${num}\\]`, 'm');
  const m = re.exec(text);
  if (!m) return null;
  return m.index + m[0].indexOf('[');
}
