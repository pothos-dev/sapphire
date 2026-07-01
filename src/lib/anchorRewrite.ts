/**
 * Anchor rewriting on heading rename (pure; no DOM, no IPC) — slice
 * slug-anchor-rewrite.
 *
 * When a heading's GitHub slug changes, the ANCHOR of every link that (a)
 * resolves to the renamed target and (b) whose current anchor slug matches a
 * rename's old slug is rewritten to the new slug. The link's path / name / alias
 * and every other link are preserved byte-for-byte. Both sides are slugged, so an
 * older literal anchor (`[[p#Deep Section]]`) matches `from: "deep-section"` and
 * is migrated to the canonical slug on the first heading change.
 *
 * MIRRORS the Rust `rewrite/anchors.rs` EXACTLY. Used by BOTH the fake backend
 * (cross-file inbound links, `ipc/fake/links.ts`) and the editor (same-file
 * `[[#slug]]` links rewritten in-buffer, App.svelte), so there is one source of
 * truth for the anchor-swap algorithm on the frontend.
 */

import { resolveLink, isExternalLink, resolveWikilink, splitWikilinkTarget } from './links';
import { slugify } from './slug';
import type { AnchorRename } from './types';

/**
 * Blank out fenced code blocks (``` / ~~~) and inline code spans, preserving
 * length + newlines so offsets stay aligned. Keeps the wikilink scanner from
 * picking up `[[ … ]]` written inside code (matching the outline scanner).
 */
export function maskCode(body: string): string {
  const lines = body.split('\n');
  const fenceRe = /^\s*(`{3,}|~{3,})/;
  let inFence = false;
  let fenceMarker = '';
  const out: string[] = [];
  for (const line of lines) {
    const fence = fenceRe.exec(line);
    if (fence) {
      const marker = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
      out.push(' '.repeat(line.length));
      continue;
    }
    if (inFence) {
      out.push(' '.repeat(line.length));
      continue;
    }
    out.push(line.replace(/`+[^`]*`+/g, (s) => ' '.repeat(s.length)));
  }
  return out.join('\n');
}

/** Split a URL into its path part and the `#anchor`/`?query` suffix (verbatim). */
export function splitSuffix(url: string): { path: string; suffix: string } {
  const hash = url.indexOf('#');
  const query = url.indexOf('?');
  let cut = -1;
  if (hash !== -1 && query !== -1) cut = Math.min(hash, query);
  else if (hash !== -1) cut = hash;
  else if (query !== -1) cut = query;
  return cut === -1 ? { path: url, suffix: '' } : { path: url.slice(0, cut), suffix: url.slice(cut) };
}

/** Matches a wikilink `[[ inner ]]` but NOT an embed `![[ … ]]` (leading `!`). */
const WIKILINK_RE = /(!?)\[\[([^\]]*)\]\]/g;

/** The new slug for an anchor whose current slug matches a rename, or null. */
function newAnchorFor(anchor: string, renames: AnchorRename[]): string | null {
  const slug = slugify(anchor);
  const r = renames.find((x) => x.from === slug);
  return r ? r.to : null;
}

/** Rewrite a markdown link's `#anchor` if it resolves to `target` and matches. */
function rewriteMdAnchor(
  source: string,
  inner: string,
  target: string,
  renames: AnchorRename[],
): string | null {
  const leadingWs = inner.length - inner.trimStart().length;
  const leading = inner.slice(0, leadingWs);
  const rest = inner.slice(leadingWs);
  const wsIdx = rest.search(/\s/);
  const urlRaw = wsIdx === -1 ? rest : rest.slice(0, wsIdx);
  const title = wsIdx === -1 ? '' : rest.slice(wsIdx);
  if (urlRaw === '') return null;

  let angleOpen = '';
  let angleClose = '';
  let urlCore = urlRaw;
  if (urlRaw.startsWith('<') && urlRaw.endsWith('>')) {
    angleOpen = '<';
    angleClose = '>';
    urlCore = urlRaw.slice(1, -1);
  }
  if (isExternalLink(urlCore) || urlCore.startsWith('#')) return null;

  const { path: pathPart, suffix } = splitSuffix(urlCore);
  if (pathPart === '' || !suffix.startsWith('#')) return null;
  const q = suffix.indexOf('?');
  const anchorEnd = q === -1 ? suffix.length : q;
  const anchor = suffix.slice(1, anchorEnd);
  const tail = suffix.slice(anchorEnd);

  const resolved = resolveLink(source, pathPart);
  if (resolved.kind !== 'internal' || resolved.path !== target) return null;
  const newAnchor = newAnchorFor(anchor, renames);
  if (newAnchor === null) return null;
  return `${leading}${angleOpen}${pathPart}#${newAnchor}${tail}${angleClose}${title}`;
}

/** Rewrite a wikilink's anchor (preserving name/alias) if it matches. */
function rewriteWikiAnchor(
  source: string,
  origInner: string,
  target: string,
  renames: AnchorRename[],
  allPaths: string[],
): string | null {
  const { anchor } = splitWikilinkTarget(origInner);
  if (anchor === null || anchor.trim() === '') return null;
  const resolved = resolveWikilink(allPaths, source, origInner);
  if (!resolved || resolved.path !== target) return null;
  const newAnchor = newAnchorFor(anchor, renames);
  if (newAnchor === null) return null;

  // Replace only the anchor text (between the first `#` and the next `|`).
  const h = origInner.indexOf('#');
  if (h === -1) return null;
  const after = origInner.slice(h + 1);
  const pipe = after.indexOf('|');
  const anchorEnd = pipe === -1 ? after.length : pipe;
  const rebuilt = `${origInner.slice(0, h)}#${newAnchor}${after.slice(anchorEnd)}`;
  return rebuilt === origInner ? null : rebuilt;
}

/**
 * Rewrite every anchor in `content` that points at a renamed heading in
 * `target`. `source` is the Concept `content` lives at (resolution base);
 * `allPaths` is the bundle's concept path set (name-based wikilink resolution).
 * Returns the rewritten content and the number of anchors changed.
 *
 * For same-file rewriting in the open editor buffer, pass `source === target`:
 * `[[#slug]]` resolves to the source (== target) and `[[self#slug]]` likewise.
 */
export function rewriteAnchorsIn(
  source: string,
  content: string,
  target: string,
  renames: AnchorRename[],
  allPaths: string[],
): { content: string; count: number } {
  if (renames.length === 0) return { content, count: 0 };
  let count = 0;
  // Markdown links `[text](inner)` but NOT images.
  const mdRe = /(!?)(\[[^\]]*\]\()([^)]*)(\))/g;
  const withMd = content.replace(mdRe, (whole, bang: string, open: string, inner: string, close: string) => {
    if (bang === '!') return whole;
    const rewritten = rewriteMdAnchor(source, inner, target, renames);
    if (rewritten === null) return whole;
    count++;
    return `${open}${rewritten}${close}`;
  });

  // Wikilinks (mask code first so `[[ … ]]` inside code are ignored).
  const masked = maskCode(withMd);
  let result = '';
  let last = 0;
  let m: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(masked)) !== null) {
    if (m[1] === '!') continue; // embed (deferred)
    const innerStart = m.index + m[1].length + 2; // after `(!?)[[`
    const inner = m[2];
    const origInner = withMd.slice(innerStart, innerStart + inner.length);
    const newInner = rewriteWikiAnchor(source, origInner, target, renames, allPaths);
    if (newInner === null) continue;
    result += withMd.slice(last, innerStart) + newInner;
    last = innerStart + inner.length;
    count++;
  }
  result += withMd.slice(last);
  return { content: result, count };
}
