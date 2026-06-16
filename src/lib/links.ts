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
  const slash = currentPath.lastIndexOf('/');
  const dir = slash === -1 ? '' : currentPath.slice(0, slash);
  const dirSegments = dir === '' ? [] : dir.split('/');
  const path = normalizeSegments([...dirSegments, ...pathPart.split('/')]);
  return path === '' ? { kind: 'none' } : { kind: 'internal', path };
}
