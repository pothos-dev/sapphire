/**
 * GitHub-style heading slugs (pure, unit-testable; no DOM, no IPC).
 *
 * A heading's slug is the anchor other documents link to (`[[Page#deep-section]]`,
 * `[text](/page.md#deep-section)`). We follow GitHub's algorithm so the slugs
 * match what authors expect from rendered markdown:
 *   - lowercase (Unicode-aware);
 *   - drop everything that is not a letter, digit, hyphen, or underscore;
 *   - turn each whitespace character into a hyphen (so runs of spaces become runs
 *     of hyphens, matching GitHub — it does NOT collapse them);
 *   - de-duplicate repeated slugs in a document by appending `-1`, `-2`, … in
 *     document order (`slugifyHeadings`).
 *
 * `slugify` trims its input first, so a heading text (already trimmed by the
 * outline scan) and a hand-typed anchor (`#deep-section`, or the older literal
 * `#Deep Section`) both slug to the same value — matching is backward-compatible.
 *
 * MIRRORED EXACTLY by the Rust `slug::slugify` (`src-tauri/src/slug.rs`), the same
 * way `resolveWikilink` mirrors `resolve_wikilink`: the backend anchor-rewrite
 * compares a link's anchor slug to a rename's old slug, so the two must agree.
 */

/** GitHub-style slug for a single heading text (no de-duplication). */
export function slugify(text: string): string {
  let out = '';
  for (const ch of text.trim().toLowerCase()) {
    if (/\s/u.test(ch)) out += '-';
    else if (ch === '-' || ch === '_') out += ch;
    else if (/[\p{L}\p{N}]/u.test(ch)) out += ch;
    // everything else (punctuation, symbols, emoji) is dropped
  }
  return out;
}

/**
 * Slugs for an ordered list of heading texts, de-duplicated the way GitHub does:
 * the first occurrence of a slug is bare, later ones get `-1`, `-2`, … So two
 * `## Notes` headings become `notes` and `notes-1`. Slug identity depends on
 * prior occurrences, so this MUST be computed over the whole ordered list — never
 * per string in isolation.
 */
export function slugifyHeadings(texts: string[]): string[] {
  const counts = new Map<string, number>();
  return texts.map((t) => {
    const base = slugify(t);
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  });
}
