// Tiny pure fuzzy matcher for the quick-nav palette (slice: quick-nav-palette).
//
// Subsequence matching with a simple positional score, kept pure and unit-
// testable (no DOM, no IPC). The query characters must appear in order within
// the candidate; the score rewards:
//   - contiguous runs (adjacent matched chars),
//   - matches at the start of a word / path segment (after `/`, `-`, `_`, `.`),
//   - matches in the BASENAME (last path segment) over the directory prefix,
//   - shorter candidates (a tighter match), as a tie-breaker.
//
// Matching is case-insensitive. Returns the matched character indices so the UI
// can highlight them.

/** A scored fuzzy match against one candidate string. */
export type FuzzyMatch = {
  /** the candidate that matched */
  target: string;
  /** higher is better */
  score: number;
  /** indices into `target` of the matched query characters (ascending) */
  positions: number[];
};

/** True if `ch` begins a new "word" in a path (segment / token boundary). */
function isBoundary(prev: string | undefined): boolean {
  if (prev === undefined) return true;
  return prev === '/' || prev === '-' || prev === '_' || prev === '.' || prev === ' ';
}

/**
 * Score `query` against `target`. Returns null when `query` is not a
 * subsequence of `target` (case-insensitive). An empty query matches everything
 * with a neutral score (callers typically show recents instead).
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  if (query === '') return { target, score: 0, positions: [] };

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Basename starts at the char after the last '/'.
  const slash = target.lastIndexOf('/');
  const baseStart = slash + 1; // 0 when there is no slash

  const positions: number[] = [];
  let score = 0;
  let ti = 0;
  let prevMatch = -2; // index of the previous matched char (for contiguity)

  for (let qi = 0; qi < q.length; qi++) {
    const qc = q[qi];
    let found = -1;
    for (; ti < t.length; ti++) {
      if (t[ti] === qc) {
        found = ti;
        break;
      }
    }
    if (found === -1) return null; // not a subsequence

    positions.push(found);
    score += 1; // base point per matched char

    if (found === prevMatch + 1) score += 8; // contiguous run (weighted high)
    if (isBoundary(target[found - 1])) score += 3; // word/segment start
    if (found >= baseStart) score += 2; // inside the basename

    prevMatch = found;
    ti = found + 1;
  }

  // Strong bonus when the whole query appears as a contiguous substring — a
  // literal match should dominate a scattered subsequence. Extra if it sits in
  // the basename (where the user is usually aiming).
  const sub = t.indexOf(q);
  if (sub !== -1) {
    score += 15;
    if (sub >= baseStart) score += 10;
    if (isBoundary(target[sub - 1])) score += 5; // substring at a word start
  }

  // Prefer tighter matches: lightly penalise long targets.
  score -= target.length * 0.01;

  return { target, score, positions };
}

/**
 * Rank `targets` against `query`, best first. With an empty query, returns the
 * targets unchanged (order preserved) with neutral scores — the palette uses
 * the recent-files order in that case instead of calling this.
 */
export function fuzzyRank(query: string, targets: string[]): FuzzyMatch[] {
  const out: FuzzyMatch[] = [];
  for (const target of targets) {
    const m = fuzzyMatch(query, target);
    if (m !== null) out.push(m);
  }
  // Stable sort by score desc, then shorter target, then alphabetical.
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.target.length !== b.target.length) return a.target.length - b.target.length;
    return a.target.localeCompare(b.target);
  });
  return out;
}
