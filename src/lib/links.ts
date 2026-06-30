/**
 * OKF markdown link resolution (pure, unit-testable; no DOM, no IPC).
 *
 * Concepts link to other Concepts via standard markdown links. A link `href`
 * is resolved against the CURRENT Concept's bundle-relative path to a bundle
 * relative, '/'-separated target path (the same convention used across the IPC
 * seam — see ARCHITECTURE.md).
 *
 * Link kinds:
 *   - External: `http://`, `https://`, `mailto:`, and any other `scheme:`
 *     prefixed URL. These are NOT navigated in-app; the caller opens them in a
 *     browser (existing behavior).
 *   - Bundle-absolute: href starts with `/` → resolved from the bundle root
 *     (the leading slash is stripped).
 *   - Relative: `./x.md`, `../y.md`, or a bare `x.md` → resolved against the
 *     directory of the current Concept, normalizing `.`/`..` segments.
 *
 * Anchors are kept simple: a pure anchor (`#heading`) is a no-op (returns
 * null — there is no target Concept to open). A `path#anchor` resolves to the
 * path and drops the anchor (anchor scrolling is a later slice).
 */

import { basename, dirname, stripMd } from './path';

export type ResolvedLink =
  | { kind: 'external'; href: string }
  | { kind: 'internal'; path: string }
  | { kind: 'none' };

/** Matches a URL scheme like `http:`, `https:`, `mailto:`, `tel:`. */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** True for links handled by the OS/browser, not by in-app navigation. */
export function isExternalLink(href: string): boolean {
  return SCHEME_RE.test(href);
}

/**
 * Normalize a '/'-separated path, collapsing `.` and `..` segments. The result
 * never has a leading slash and never escapes above the root (leading `..`
 * segments that would escape are dropped — matching the backend's escape
 * rejection rather than producing an invalid path).
 */
function normalizeSegments(segments: string[]): string {
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      // Pop a real segment; if there is none, the `..` escapes — drop it.
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join('/');
}

/**
 * The three components of a raw wikilink target `name|alias#anchor`. `name` is
 * the part that participates in file resolution (the `.md` is NOT stripped here
 * — resolution does that); `alias` and `anchor` are kept verbatim for callers
 * that preserve them (rendering, rename-rewrite). `null` when absent.
 *
 * Split order matters and mirrors Obsidian: the alias is everything after the
 * FIRST `|`; the anchor is everything after the FIRST `#` IN THE NAME PART (an
 * `#` inside the alias is display text, not an anchor).
 */
export interface WikilinkParts {
  name: string;
  alias: string | null;
  anchor: string | null;
}

/**
 * Split a raw wikilink inner text (`[[ … ]]` contents) into its `name`, `alias`
 * (after the first `|`), and `anchor` (after the first `#` in the name part).
 * Pure string surgery — no trimming of `name` beyond what callers need; the
 * resolver trims separately.
 */
export function splitWikilinkTarget(rawTarget: string): WikilinkParts {
  let rest = rawTarget;
  let alias: string | null = null;
  const pipe = rest.indexOf('|');
  if (pipe !== -1) {
    alias = rest.slice(pipe + 1);
    rest = rest.slice(0, pipe);
  }
  let anchor: string | null = null;
  const hash = rest.indexOf('#');
  if (hash !== -1) {
    anchor = rest.slice(hash + 1);
    rest = rest.slice(0, hash);
  }
  return { name: rest, alias, anchor };
}

/**
 * Resolve a wikilink target to a bundle path, or `null` if unresolved.
 *
 * Name-based (NOT path-based) resolution, matching Obsidian exactly (see
 * ADR-0004). `allPaths` is every concept `.md` path in the bundle (bundle
 * relative, no leading slash); `sourcePath` is the Concept the link is written
 * in; `rawTarget` is the inner text of `[[ … ]]` (may carry `|alias`/`#anchor`).
 *
 * Algorithm (identical to the Rust backend and the fake backend):
 *   - strip `|alias` then `#anchor`, trim; empty (`[[#heading]]`) → `sourcePath`
 *     (a pure same-file anchor);
 *   - drop a trailing case-insensitive `.md`;
 *   - case-insensitive, LITERAL match (no slug/space normalization);
 *   - bare name → match by basename; partial path (`a/b`) → match by path
 *     suffix (full path, or ending in `/name`);
 *   - ties resolve SILENTLY to the shortest path (fewest `/`), then
 *     lexicographically; no match → `null` (broken, like a broken md link).
 */
export function resolveWikilink(
  allPaths: string[],
  sourcePath: string,
  rawTarget: string,
): { path: string } | null {
  const { name } = splitWikilinkTarget(rawTarget);
  const t = stripMd(name.trim());
  if (t === '') return { path: sourcePath }; // pure same-file anchor [[#heading]]

  const L = t.toLowerCase();
  const candidates = allPaths.filter((p) => p.endsWith('.md'));

  let matches: string[];
  if (t.includes('/')) {
    // Partial path → suffix match (whole path, or ending in `/name`).
    matches = candidates.filter((c) => {
      const noExt = stripMd(c).toLowerCase();
      return noExt === L || noExt.endsWith(`/${L}`);
    });
  } else {
    // Bare name → basename match.
    matches = candidates.filter((c) => stripMd(basename(c)).toLowerCase() === L);
  }
  if (matches.length === 0) return null;

  // Tie-break: shortest path (fewest '/' segments), then lexicographically.
  matches.sort((a, b) => {
    const da = (a.match(/\//g) ?? []).length;
    const db = (b.match(/\//g) ?? []).length;
    if (da !== db) return da - db;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return { path: matches[0] };
}

/**
 * Resolve a markdown link `href` clicked inside the Concept at `currentPath`
 * (bundle-relative, '/'-separated) to a target.
 *
 * Returns `external` for scheme URLs (caller opens in browser), `internal`
 * with a bundle-relative path for OKF links, or `none` for pure anchors / empty
 * hrefs (nothing to navigate to).
 */
export function resolveLink(currentPath: string, href: string): ResolvedLink {
  const raw = href.trim();
  if (raw === '') return { kind: 'none' };

  // External (scheme) links are not navigated in-app.
  if (isExternalLink(raw)) return { kind: 'external', href: raw };

  // Pure anchor: nothing to open (stay on the current Concept).
  if (raw.startsWith('#')) return { kind: 'none' };

  // Drop a trailing `#anchor` (and any `?query`) — anchor scrolling is a later
  // slice; for now we navigate to the path component.
  const pathPart = raw.split('#')[0].split('?')[0];
  if (pathPart === '') return { kind: 'none' };

  if (pathPart.startsWith('/')) {
    // Bundle-absolute: resolve from the bundle root.
    const path = normalizeSegments(pathPart.slice(1).split('/'));
    return path === '' ? { kind: 'none' } : { kind: 'internal', path };
  }

  // Relative: resolve against the current Concept's directory.
  const dir = dirname(currentPath);
  const dirSegments = dir === '' ? [] : dir.split('/');
  const path = normalizeSegments([...dirSegments, ...pathPart.split('/')]);
  return path === '' ? { kind: 'none' } : { kind: 'internal', path };
}
