// Markdown heading scan for the Outline Section (slice: outline-section).
//
// Derives the open Concept's headings — live from the editor content — as an
// ordered list, each carrying its level (1–6, for indentation) and the 1-based
// line number IN THE FULL DOCUMENT (frontmatter included) so a click can scroll
// the editor to the exact line via `scrollToLine`.
//
// Two things are deliberately skipped so they never produce spurious entries:
//   - the leading YAML frontmatter block (a `# note` comment there is not an
//     H1) — located via the shared `splitFrontmatter` helper, and
//   - fenced code blocks (a `# comment` inside ``` … ``` is code, not a
//     heading) — tracked by toggling on ``` / ~~~ fences.
//
// Kept dependency-free of Svelte/CodeMirror so the scan is a pure function over
// a markdown string.

import { splitFrontmatter } from './frontmatter';

/** One outline entry: a markdown heading in document order. */
export interface OutlineHeading {
  /** Heading level, 1 (`#`) … 6 (`######`). Drives indentation. */
  level: number;
  /** The heading text (the `#` markers and surrounding space stripped). */
  text: string;
  /** 1-based line number in the FULL document (frontmatter included). */
  line: number;
}

/** An ATX heading line: 1–6 `#`, at least one space, then the text. */
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
/** A fenced-code-block delimiter: 3+ backticks or tildes (optional info string). */
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

/**
 * Scan raw markdown for its body headings, in document order.
 *
 * Skips the frontmatter block entirely (so a YAML `# comment` is never an H1)
 * and any line inside a fenced code block (so a `# comment` in a fence is code,
 * not a heading). Line numbers are 1-based against the FULL document, so the
 * offset of the frontmatter is added back to each body heading's line.
 */
export function scanHeadings(content: string): OutlineHeading[] {
  const { hasFrontmatter, open, yaml, close, body } = splitFrontmatter(content);
  // Lines consumed by the frontmatter block (open + yaml + close), so body line
  // N maps to full-document line `offset + N`.
  const offset = hasFrontmatter ? countLines(open) + countLines(yaml) + countLines(close) : 0;

  const headings: OutlineHeading[] = [];
  const lines = body.split('\n');
  let inFence = false;
  let fenceMarker = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1][0]; // ` or ~
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        // A closing fence must use the same marker character as the opener.
        inFence = false;
        fenceMarker = '';
      }
      continue;
    }
    if (inFence) continue;
    const m = HEADING_RE.exec(line);
    if (!m) continue;
    headings.push({
      level: m[1].length,
      text: m[2].trim(),
      line: offset + i + 1,
    });
  }
  return headings;
}

/**
 * Count the number of `\n`-separated line *starts* a chunk occupies — i.e. how
 * many lines it advances the cursor by. A chunk ending in a newline contributes
 * exactly its newline count; the frontmatter `open`/`yaml`/`close` chunks are
 * captured verbatim incl. their trailing newlines, so this sums to the lines
 * before the body begins.
 */
function countLines(chunk: string): number {
  if (chunk === '') return 0;
  let n = 0;
  for (let i = 0; i < chunk.length; i++) {
    if (chunk[i] === '\n') n++;
  }
  return n;
}
