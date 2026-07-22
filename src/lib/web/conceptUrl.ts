// Concept ↔ pretty-URL mapping for Sunstone Web (pure; no DOM/IPC).
//
// The web viewer addresses a Concept by its LOCATION in the URL path rather than
// a `?path=` query, dropping the `.md` extension and a trailing `/index`:
//
//   index.md                          -> /
//   providers/index.md                -> /providers
//   research/providers/mistral-ai.md  -> /research/providers/mistral-ai
//
// The reverse (`urlToConcept`) is ambiguous — `/providers` could be the file
// `providers.md` OR the folder index `providers/index.md` — so it resolves
// against the set of real file paths (a folder index wins over a same-named
// leaf), returning `null` when nothing matches.

import type { TreeNode } from '$lib/types';
import type { RenderPayload } from './render';
import { stripMd } from '$lib/path';

/** Collect every FILE path (bundle-relative) in the tree, for URL resolution. */
export function collectFilePaths(tree: TreeNode, into = new Set<string>()): Set<string> {
  if (!tree.isDir) into.add(tree.path);
  for (const c of tree.children ?? []) collectFilePaths(c, into);
  return into;
}

/**
 * A Concept's bundle path → its pretty URL pathname. Drops `.md` and a trailing
 * `/index`; the root `index.md` becomes `/`. Each segment is URL-encoded.
 */
export function conceptToUrl(path: string): string {
  let p = stripMd(path);
  if (p === 'index') return '/';
  if (p.endsWith('/index')) p = p.slice(0, -'/index'.length);
  return '/' + p.split('/').map(encodeURIComponent).join('/');
}

/**
 * A pretty URL path (already percent-DECODED — e.g. a SvelteKit route param) →
 * the matching Concept bundle path, or `null` if none exists. A folder index
 * (`<p>/index.md`) is preferred over a same-named leaf (`<p>.md`).
 */
export function urlToConcept(urlPath: string, files: Set<string>): string | null {
  const segs = urlPath.split('/').filter(Boolean);
  if (segs.length === 0) return files.has('index.md') ? 'index.md' : null;
  const p = segs.join('/');
  for (const candidate of [`${p}/index.md`, `${p}.md`]) {
    if (files.has(candidate)) return candidate;
  }
  return null;
}

/**
 * The human title for a Concept, for the document `<title>`: its frontmatter
 * `title`, else its first H1, else a name derived from the path (a folder index
 * uses the folder name). Falls back to `Sunstone Web` when nothing is open.
 */
export function conceptTitle(selected: string | null, rendered: RenderPayload | null): string {
  const fm = rendered?.frontmatter.find((f) => f.key.toLowerCase() === 'title')?.values[0]?.trim();
  if (fm) return fm;
  const h1 = rendered?.outline.find((h) => h.level === 1)?.text.trim();
  if (h1) return h1;
  if (selected) return nameFromPath(selected);
  return 'Sunstone Web';
}

function nameFromPath(path: string): string {
  const parts = stripMd(path).split('/');
  let last = parts.pop() ?? '';
  if (last === 'index') last = parts.pop() ?? ''; // a folder index → the folder name
  return last || 'Sunstone Web';
}
