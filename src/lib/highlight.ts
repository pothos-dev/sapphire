// Snippet highlighting for full-text Search results (pure; no DOM/IPC).
//
// Splits a result snippet into alternating matched / unmatched runs so the UI
// can emphasise every (case-insensitive) occurrence of the query. Kept as a
// pure function over strings so it is unit-testable independently of the
// SearchPanel component.

/** One run of a snippet: `match` is true for the substrings to emphasise. */
export interface HighlightPart {
  text: string;
  match: boolean;
}

/**
 * Split `snippet` around every case-insensitive occurrence of `query`,
 * preserving the snippet's original casing in the returned text. An empty (or
 * whitespace-only) query yields a single unmatched run covering the whole
 * snippet.
 */
export function highlightParts(snippet: string, query: string): HighlightPart[] {
  const q = query.trim();
  if (q === '') return [{ text: snippet, match: false }];
  const lower = snippet.toLowerCase();
  const needle = q.toLowerCase();
  const parts: HighlightPart[] = [];
  let i = 0;
  let found = lower.indexOf(needle, i);
  while (found !== -1) {
    if (found > i) parts.push({ text: snippet.slice(i, found), match: false });
    parts.push({ text: snippet.slice(found, found + needle.length), match: true });
    i = found + needle.length;
    found = lower.indexOf(needle, i);
  }
  if (i < snippet.length) parts.push({ text: snippet.slice(i), match: false });
  return parts;
}
