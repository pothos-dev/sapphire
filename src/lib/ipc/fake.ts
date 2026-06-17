import type { Backend } from './backend';
import type {
  TreeNode,
  FileChange,
  TagCount,
  BundleState,
  SearchHit,
  RewriteSummary,
} from '$lib/types';
import { resolveLink, isExternalLink } from '$lib/links';

/**
 * In-memory Backend implementation over a seeded fixture Bundle.
 *
 * This is what makes the frontend runnable + screenshottable in plain Chromium
 * under Playwright with no native build. It must be behaviourally faithful to
 * the real backend: same path conventions (bundle-relative, '/'-separated),
 * same tree shape, same path-escape rejection.
 *
 * The fixture is a small but realistic OKF bundle: nested folders, Concepts
 * with frontmatter (`type`/`title`/`tags`), the reserved `index.md` and
 * `log.md`, and at least one Concept linking to another.
 */

const FAKE_BUNDLE_ROOT = '/fake/bundle';

/** Map of bundle-relative path -> raw markdown content. */
const FILES: Record<string, string> = {
  'index.md': `---
type: index
title: Knowledge Base
description: Entry point for this demo Bundle.
tags: [okf, demo]
---

# Knowledge Base

Welcome. This is the reserved \`index.md\` for progressive disclosure.

## Contents

- [Concepts](/concepts/index.md)
- [Editor design](/concepts/editor/live-preview.md)
- [Change log](/log.md)
`,

  'log.md': `---
type: log
title: Change Log
---

# Log

- 2026-06-16 — Seeded the demo Bundle for the walking skeleton.
- 2026-06-15 — Initial Bundle created.
`,

  'concepts/index.md': `---
type: index
title: Concepts
tags: [okf]
---

# Concepts

- [CodeMirror](./codemirror.md)
- [Live preview](./editor/live-preview.md)
- [Bundle](./bundle.md)
`,

  'concepts/codemirror.md': `---
type: concept
title: CodeMirror
description: The editor core used by Emerald.
tags: [editor, dependency]
timestamp: 2026-06-15T10:00:00Z
---

# CodeMirror

CodeMirror 6 is the editor core. Emerald layers OKF-aware extensions on top.

The distinctive word marmalade appears here so full-text search has a target.

It powers the [Live preview](./editor/live-preview.md) experience.
`,

  'concepts/bundle.md': `---
type: concept
title: Bundle
description: The root folder opened by Emerald.
tags: [okf, core]
---

# Bundle

A **Bundle** is the root folder opened by Emerald — a tree of Concepts and
reserved files, per the OKF spec.

A second mention of Marmalade lives here to prove cross-Concept full-text search.

See also [CodeMirror](./codemirror.md) (relative link) and the
[Knowledge Base](/index.md) entry point (bundle-absolute link).
`,

  // A Concept exercising the frontmatter Properties panel: scalars, a `tags`
  // flat list, an EMPTY required `type` (flag case), an unknown/extra key, and
  // — critically — complex values (a nested map and a multi-line block scalar)
  // that must round-trip BYTE-FOR-BYTE when an unrelated scalar is edited.
  'concepts/complex-frontmatter.md': `---
type:
title: Complex Frontmatter
description: Exercises the Properties panel.
tags: [okf, complex]
custom_field: keep me intact
nested:
  author: jane
  reviewers:
    - bob
    - carol
prose: |
  This is a multi-line
  block scalar that must
  be preserved verbatim.
---

# Complex Frontmatter

This Concept has nested and multi-line frontmatter to prove verbatim
round-tripping when an unrelated scalar is edited.
`,

  // A Concept exercising the broken-link decoration AND the backlink graph:
  // it links to TWO existing Concepts (relative + bundle-absolute) and to TWO
  // non-existent targets (relative + bundle-absolute). Broken links must render
  // visually distinct yet stay clickable; existing links stay normal. This
  // Concept also gives `concepts/codemirror.md` and `index.md` extra backlinks,
  // making the backlinks query non-trivial.
  'concepts/links-demo.md': `---
type: concept
title: Links Demo
description: Exercises broken-link styling and the backlink graph.
tags: [okf, links]
---

# Links Demo

Working links resolve to real Concepts:

- [CodeMirror](./codemirror.md) — existing (relative)
- [Knowledge Base](/index.md) — existing (bundle-absolute)

Broken links point at Concepts that do not exist; they must render distinct
but stay clickable (never blocked, per the OKF spec):

- [Ghost Concept](./ghost.md) — broken (relative)
- [Missing Page](/does-not-exist.md) — broken (bundle-absolute)

An external link is never treated as broken: [Example](https://example.com).
`,

  // A Concept with NO frontmatter block at all. Exercises adding the first
  // property to a frontmatter-less doc (slice: add-property-text-or-list): the
  // serializer must synthesize a valid `---…---` block on the first commit.
  'concepts/no-frontmatter.md': `# No Frontmatter

This Concept has no YAML frontmatter block. Adding a property must synthesize
one from scratch.
`,

  'concepts/editor/live-preview.md': `---
type: concept
title: Live Preview
description: Obsidian-style hybrid editing.
tags: [editor, codemirror]
---

# Live Preview

Obsidian-style hybrid editing: the markdown source is the source of truth, but
inactive lines render styled while the cursor line shows raw markup. Text can be
**bold**, *italic*, or \`inline code\`.

## Features

- [x] Inactive lines render styled
- [ ] Cursor line reveals raw markup
- Lazy-loaded fenced-code grammars

A fenced code block, syntax-highlighted via a lazy-loaded grammar:

\`\`\`ts
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

A GFM table renders as an interactive widget:

| Feature      | Status |
| ------------ | ------ |
| Headings     | done   |
| Code blocks  | done   |
| Tables       | done   |

Inline image (data URI — renders fully under the fake backend):

![green dot](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCI+PGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMjgiIGZpbGw9IiMyZWNjNzEiLz48L3N2Zz4=)

Local image (resolved relative to the Concept; the widget renders even if the
src 404s under the fake backend — there is no static file server here):

![diagram](./assets/diagram.png)

Built on [CodeMirror](../codemirror.md).
`,
};

/**
 * Explicitly-created folders that contain no `.md` file yet. Folders are
 * normally inferred from file paths, but `createFolder` can make an empty one;
 * we track those here so the tree reflects them (like a real empty directory).
 */
const FOLDERS = new Set<string>();

/**
 * Build the recursive TreeNode for the fixture from the flat FILES map.
 * Directories are inferred from path segments; only `.md` files are listed
 * (the fixture contains only markdown, mirroring an OKF Bundle's focus).
 */
function buildTree(): TreeNode {
  const root: TreeNode = { name: 'bundle', path: '', isDir: true, children: [] };

  // dirPath ('' for root) -> TreeNode
  const dirs = new Map<string, TreeNode>();
  dirs.set('', root);

  const ensureDir = (dirPath: string): TreeNode => {
    const existing = dirs.get(dirPath);
    if (existing) return existing;

    const slash = dirPath.lastIndexOf('/');
    const parentPath = slash === -1 ? '' : dirPath.slice(0, slash);
    const name = slash === -1 ? dirPath : dirPath.slice(slash + 1);
    const parent = ensureDir(parentPath);

    const node: TreeNode = { name, path: dirPath, isDir: true, children: [] };
    parent.children!.push(node);
    dirs.set(dirPath, node);
    return node;
  };

  // Explicitly-created empty folders (and their ancestors).
  for (const folder of FOLDERS) ensureDir(folder);

  for (const path of Object.keys(FILES)) {
    const slash = path.lastIndexOf('/');
    const dirPath = slash === -1 ? '' : path.slice(0, slash);
    const name = slash === -1 ? path : path.slice(slash + 1);
    const dir = ensureDir(dirPath);
    dir.children!.push({ name, path, isDir: false });
  }

  // Sort each directory: dirs first, then files, alphabetically.
  const sortNode = (node: TreeNode) => {
    if (!node.children) return;
    node.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortNode);
  };
  sortNode(root);

  return root;
}

// ---------------------------------------------------------------------------
// In-memory Bundle index, computed over the FILES fixture.
//
// Mirrors the Rust `index.rs` behaviour closely enough to test the UI: parse
// `type`/`tags` from frontmatter, extract outbound internal links (reusing the
// shared `resolveLink` so resolution matches the editor exactly), and derive a
// reverse (backlink) map plus tag/type aggregates. Recomputed on demand from
// FILES so created/removed/edited Concepts are reflected (like the real
// watcher-maintained index).
// ---------------------------------------------------------------------------

/** Split a Concept into its raw frontmatter block (or null) and body. */
function splitFrontmatter(content: string): { yaml: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!m) return { yaml: null, body: content };
  return { yaml: m[1], body: content.slice(m[0].length) };
}

/** Parse `type` (scalar) and `tags` (flat `[a, b]` or block list) from YAML. */
function parseFrontmatter(content: string): { type: string | null; tags: string[] } {
  const { yaml } = splitFrontmatter(content);
  if (yaml === null) return { type: null, tags: [] };

  let type: string | null = null;
  const tags: string[] = [];
  const lines = yaml.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const typeMatch = /^type:\s*(.*)$/.exec(line);
    if (typeMatch) {
      const v = typeMatch[1].trim();
      type = v === '' ? null : v;
      continue;
    }
    const tagsInline = /^tags:\s*\[(.*)\]\s*$/.exec(line);
    if (tagsInline) {
      for (const t of tagsInline[1].split(',')) {
        const tag = t.trim();
        if (tag !== '') tags.push(tag);
      }
      continue;
    }
    if (/^tags:\s*$/.test(line)) {
      // Block list: collect following `  - tag` lines.
      for (let j = i + 1; j < lines.length; j++) {
        const item = /^\s*-\s*(.+?)\s*$/.exec(lines[j]);
        if (!item) break;
        tags.push(item[1]);
      }
    }
  }
  return { type, tags };
}

/** Extract outbound internal link targets from a Concept's body, resolved. */
function outboundLinks(path: string, content: string): string[] {
  const { body } = splitFrontmatter(content);
  const targets = new Set<string>();
  // [text](target) but NOT images ![alt](src): require no `!` before `[`.
  const re = /(!?)\[[^\]]*\]\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1] === '!') continue; // image, not a Concept link
    // Drop a trailing "title" inside the parens.
    const href = m[2].trim().split(/\s+/)[0];
    const resolved = resolveLink(path, href);
    if (resolved.kind === 'internal') targets.add(resolved.path);
  }
  return [...targets];
}

// ---------------------------------------------------------------------------
// Automatic link rewriting on rename/move (slice: link-auto-rewrite).
//
// Ports the Rust `rewrite.rs` path math to the fake backend so the same
// two-directional, path-aware behaviour is exercised under Chromium/Playwright:
//   * inbound links (absolute -> new absolute; relative -> recomputed from the
//     source's own dir, preserving relative style);
//   * the moved Concept's own relative outbound links (recomputed from its NEW
//     dir; absolute links untouched);
//   * folder moves apply both to every contained Concept (co-moved siblings'
//     internal relative links stay valid, never double-broken).
// Only links whose resolved target IS a moved Concept change; anchors, queries,
// titles, link text and external links are preserved.
// ---------------------------------------------------------------------------

/** Directory portion of a bundle-relative path ('' for a root-level file). */
function dirOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** Relative path FROM `fromDir` TO bundle-relative `target`, with `./`/`../`. */
function relativePath(fromDir: string, target: string): string {
  const from = fromDir === '' ? [] : fromDir.split('/');
  const to = target === '' ? [] : target.split('/');
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) common++;
  const parts: string[] = [];
  for (let i = common; i < from.length; i++) parts.push('..');
  for (let i = common; i < to.length; i++) parts.push(to[i]);
  if (parts.length === 0) return '.';
  return parts[0] === '..' ? parts.join('/') : `./${parts.join('/')}`;
}

/** Split a URL into its path part and the `#anchor`/`?query` suffix (verbatim). */
function splitSuffix(url: string): { path: string; suffix: string } {
  const hash = url.indexOf('#');
  const query = url.indexOf('?');
  let cut = -1;
  if (hash !== -1 && query !== -1) cut = Math.min(hash, query);
  else if (hash !== -1) cut = hash;
  else if (query !== -1) cut = query;
  return cut === -1 ? { path: url, suffix: '' } : { path: url.slice(0, cut), suffix: url.slice(cut) };
}

/**
 * Build the old->new move map for relocating `from` to `to`. A `.md` source is a
 * single Concept; otherwise it is a folder (remap every Concept under it).
 */
function buildMoveMap(from: string, to: string): Map<string, string> {
  const map = new Map<string, string>();
  if (from.endsWith('.md')) {
    map.set(from, to);
    return map;
  }
  const prefix = `${from}/`;
  for (const path of conceptPaths()) {
    if (path.startsWith(prefix)) map.set(path, `${to}/${path.slice(prefix.length)}`);
  }
  return map;
}

/**
 * Rewrite the links in one Concept's `content`. `oldSource` is the source's
 * pre-move path (resolution base as authored); `newSource` is its post-move path
 * (used to re-resolve + recompute relative links). Returns the new content and
 * the count of links changed.
 */
function rewriteLinksIn(
  oldSource: string,
  newSource: string,
  content: string,
  moves: Map<string, string>,
): { content: string; count: number } {
  const moved = oldSource !== newSource;
  // Match `[text](inner)` but NOT images `![alt](src)`.
  const re = /(!?)(\[[^\]]*\]\()([^)]*)(\))/g;
  let count = 0;
  const out = content.replace(re, (whole, bang: string, open: string, inner: string, close: string) => {
    if (bang === '!') return whole; // image
    const rewritten = rewriteTarget(oldSource, newSource, moved, inner, moves);
    if (rewritten === null) return whole;
    count++;
    return `${open}${rewritten}${close}`;
  });
  return { content: out, count };
}

/**
 * Decide whether a link's inner parens text targets a moved Concept and, if so,
 * return the rewritten inner text (new target; anchor/query/title preserved).
 * `null` means leave unchanged.
 */
function rewriteTarget(
  oldSource: string,
  newSource: string,
  moved: boolean,
  inner: string,
  moves: Map<string, string>,
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
  if (pathPart === '') return null;

  const isAbsolute = pathPart.startsWith('/');

  // Resolve as authored, from the source's ORIGINAL location.
  const resolved = resolveLink(oldSource, pathPart);
  if (resolved.kind !== 'internal') return null;

  const targetMoved = moves.has(resolved.path);
  const newTarget = moves.get(resolved.path) ?? resolved.path;

  if (isAbsolute) {
    if (!targetMoved) return null;
  } else if (!targetMoved && !moved) {
    return null;
  }

  const newPath = isAbsolute ? `/${newTarget}` : relativePath(dirOf(newSource), newTarget);
  if (newPath === pathPart) return null;

  return `${leading}${angleOpen}${newPath}${suffix}${angleClose}${title}`;
}

/**
 * Auto-rewrite links for a move of `from`->`to`, applied to the in-memory FILES.
 * Reads content BEFORE the rename (snapshot), so callers MUST call this BEFORE
 * mutating FILES with the rename. Returns the rewrite summary and a map of
 * new-path -> rewritten content to apply AFTER the rename.
 */
function planRewrites(from: string, to: string): {
  summary: RewriteSummary;
  writes: Map<string, string>;
} {
  const moves = buildMoveMap(from, to);
  const writes = new Map<string, string>();
  let linksChanged = 0;
  let filesChanged = 0;
  if (moves.size === 0) return { summary: { linksChanged, filesChanged }, writes };

  // Candidate sources: every Concept (cheap for the fixture) — inbound linkers
  // plus the moved files themselves. plan only emits writes for real changes.
  const sources = new Set<string>(conceptPaths());
  for (const old of moves.keys()) sources.add(old);

  for (const oldSource of [...sources].sort()) {
    const content = FILES[oldSource];
    if (content === undefined) continue;
    const newSource = moves.get(oldSource) ?? oldSource;
    const { content: rewritten, count } = rewriteLinksIn(oldSource, newSource, content, moves);
    if (count > 0) {
      linksChanged += count;
      filesChanged++;
      writes.set(newSource, rewritten);
    }
  }
  return { summary: { linksChanged, filesChanged }, writes };
}

/** All `.md` Concept paths currently in the fixture. */
function conceptPaths(): string[] {
  return Object.keys(FILES)
    .filter((p) => p.endsWith('.md'))
    .sort();
}

/** Reject paths that escape the bundle, mirroring the Rust validation. */
function isSafePath(path: string): boolean {
  if (path.startsWith('/')) return false;
  return !path.split('/').includes('..');
}

/** Subscribers to simulated filesystem changes (see `onFileChanged`). */
const fileChangeSubscribers = new Set<(change: FileChange) => void>();

/**
 * Test hook: simulate an EXTERNAL filesystem change (as if another tool edited
 * the bundle), updating the in-memory fixture and notifying subscribers. This
 * is the fake's stand-in for the Rust `notify` watcher — it lets Playwright
 * exercise the tree-refresh / reload-open-Concept path. Unlike `writeConcept`
 * (Emerald's own autosave), these changes ARE delivered to subscribers.
 *
 * Exposed on `window.__emeraldFake` so tests can drive it from the browser.
 */
function simulateExternalChange(
  kind: FileChange['kind'],
  path: string,
  content?: string,
): void {
  if (kind === 'removed') {
    delete FILES[path];
  } else if (content !== undefined) {
    FILES[path] = content;
  }
  for (const cb of fileChangeSubscribers) {
    cb({ kind, paths: [path] });
  }
}

/**
 * Notify subscribers of an already-applied change (the caller mutated FILES /
 * FOLDERS first). Used by the tree-CRUD ops, which — unlike `writeConcept` —
 * DO deliver to subscribers so the tree + index refresh.
 */
function notifyFsChange(kind: FileChange['kind'], path: string): void {
  for (const cb of fileChangeSubscribers) {
    cb({ kind, paths: [path] });
  }
}

/** True if `path` is an existing folder (explicit, or implied by a file). */
function folderExists(path: string): boolean {
  if (FOLDERS.has(path)) return true;
  const prefix = `${path}/`;
  return Object.keys(FILES).some((p) => p.startsWith(prefix));
}

/** True if `path` is an existing file OR folder. */
function pathExists(path: string): boolean {
  return Object.prototype.hasOwnProperty.call(FILES, path) || folderExists(path);
}

/**
 * Rename/move `from` to `to`, handling both a single Concept and a folder
 * (rewriting every descendant path). Mutates FILES + FOLDERS in place.
 */
function renameInternal(from: string, to: string): void {
  if (!pathExists(from)) throw new Error(`no such path: ${from}`);
  if (pathExists(to)) throw new Error(`already exists: ${to}`);

  if (Object.prototype.hasOwnProperty.call(FILES, from)) {
    // Single file.
    FILES[to] = FILES[from];
    delete FILES[from];
    return;
  }

  // Folder: move it and every descendant (files + tracked subfolders).
  const fromPrefix = `${from}/`;
  for (const p of Object.keys(FILES)) {
    if (p.startsWith(fromPrefix)) {
      FILES[`${to}/${p.slice(fromPrefix.length)}`] = FILES[p];
      delete FILES[p];
    }
  }
  for (const f of [...FOLDERS]) {
    if (f === from) {
      FOLDERS.delete(f);
      FOLDERS.add(to);
    } else if (f.startsWith(fromPrefix)) {
      FOLDERS.delete(f);
      FOLDERS.add(`${to}/${f.slice(fromPrefix.length)}`);
    }
  }
  FOLDERS.add(to);
}

/**
 * Rename/move `from`->`to`, auto-rewriting affected links. Plans the rewrites
 * from the PRE-move snapshot, performs the rename, applies the rewritten content
 * at the new locations, notifies subscribers, and returns the summary. Mirrors
 * the Rust `rename_and_rewrite` ordering exactly.
 */
function renameAndRewrite(from: string, to: string): RewriteSummary {
  // 1. Plan from the pre-move snapshot.
  const { summary, writes } = planRewrites(from, to);
  // 2. Perform the rename (mutates FILES + FOLDERS, validates existence).
  renameInternal(from, to);
  // 3. Apply rewritten content at the NEW locations.
  for (const [path, content] of writes) FILES[path] = content;
  // 4. A rename is a remove of the old path + create of the new one.
  notifyFsChange('removed', from);
  notifyFsChange('created', to);
  return summary;
}

/**
 * Delete `path` (file or folder, recursively). Returns the list of removed
 * paths (so each can be reported as a `removed` change).
 */
function deleteInternal(path: string): string[] {
  const removed: string[] = [];
  if (Object.prototype.hasOwnProperty.call(FILES, path)) {
    delete FILES[path];
    removed.push(path);
    return removed;
  }
  if (folderExists(path)) {
    const prefix = `${path}/`;
    for (const p of Object.keys(FILES)) {
      if (p.startsWith(prefix)) {
        delete FILES[p];
        removed.push(p);
      }
    }
    for (const f of [...FOLDERS]) {
      if (f === path || f.startsWith(prefix)) FOLDERS.delete(f);
    }
    removed.push(path);
  }
  return removed;
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__emeraldFake = {
    simulateExternalChange,
    files: FILES,
  };
}

export const fakeBackend: Backend = {
  async bundleRoot(): Promise<string> {
    return FAKE_BUNDLE_ROOT;
  },

  async listTree(): Promise<TreeNode> {
    // Rebuild each call so created/removed files (via writeConcept or a
    // simulated external change) are reflected, like the real walker.
    return buildTree();
  },

  async readConcept(path: string): Promise<string> {
    if (!isSafePath(path)) {
      throw new Error(`path escapes the bundle: ${path}`);
    }
    const content = FILES[path];
    if (content === undefined) {
      throw new Error(`no such concept: ${path}`);
    }
    return content;
  },

  async writeConcept(path: string, content: string): Promise<void> {
    if (!isSafePath(path)) {
      throw new Error(`path escapes the bundle: ${path}`);
    }
    // Emerald's own write: update the in-memory bundle but do NOT notify
    // subscribers — the real backend suppresses the watcher echo for self
    // writes, and the fake must be behaviourally faithful (no reload loop).
    FILES[path] = content;
  },

  onFileChanged(cb: (change: FileChange) => void): () => void {
    fileChangeSubscribers.add(cb);
    return () => {
      fileChangeSubscribers.delete(cb);
    };
  },

  // --- Tree CRUD (slice: tree-crud) ---
  // Mutate the in-memory fixture, then notify subscribers — structural changes
  // SHOULD refresh the tree + index (unlike `writeConcept`, which is Emerald's
  // own autosave and is suppressed). This mirrors the real backend, where these
  // ops are NOT recorded as self-writes so the watcher's `file-changed` fires.

  async createConcept(path: string): Promise<void> {
    if (!isSafePath(path)) throw new Error(`path escapes the bundle: ${path}`);
    if (!path.endsWith('.md')) throw new Error(`a Concept path must end in .md: ${path}`);
    if (Object.prototype.hasOwnProperty.call(FILES, path)) {
      throw new Error(`already exists: ${path}`);
    }
    FILES[path] = '';
    notifyFsChange('created', path);
  },

  async createFolder(path: string): Promise<void> {
    if (!isSafePath(path)) throw new Error(`path escapes the bundle: ${path}`);
    if (path === '') throw new Error('path must not be empty');
    if (folderExists(path)) throw new Error(`already exists: ${path}`);
    FOLDERS.add(path);
    notifyFsChange('created', path);
  },

  async renamePath(from: string, to: string): Promise<RewriteSummary> {
    if (!isSafePath(from) || !isSafePath(to)) {
      throw new Error('path escapes the bundle');
    }
    return renameAndRewrite(from, to);
  },

  async movePath(from: string, toDir: string): Promise<RewriteSummary> {
    if (!isSafePath(from) || (toDir !== '' && !isSafePath(toDir))) {
      throw new Error('path escapes the bundle');
    }
    const name = from.split('/').filter(Boolean).pop();
    if (!name) throw new Error(`invalid source path: ${from}`);
    const to = toDir === '' ? name : `${toDir.replace(/\/+$/, '')}/${name}`;
    if (to === from) throw new Error(`already in that folder: ${from}`);
    return renameAndRewrite(from, to);
  },

  async deletePath(path: string): Promise<void> {
    if (!isSafePath(path)) throw new Error(`path escapes the bundle: ${path}`);
    const removed = deleteInternal(path);
    if (removed.length === 0) throw new Error(`no such path: ${path}`);
    for (const p of removed) notifyFsChange('removed', p);
  },

  async listConceptPaths(): Promise<string[]> {
    return conceptPaths();
  },

  async conceptExists(path: string): Promise<boolean> {
    return path.endsWith('.md') && Object.prototype.hasOwnProperty.call(FILES, path);
  },

  async backlinks(path: string): Promise<string[]> {
    const sources: string[] = [];
    for (const source of conceptPaths()) {
      if (outboundLinks(source, FILES[source]).includes(path)) {
        sources.push(source);
      }
    }
    return sources.sort();
  },

  async allTags(): Promise<TagCount[]> {
    const counts = new Map<string, number>();
    for (const path of conceptPaths()) {
      const { tags } = parseFrontmatter(FILES[path]);
      // De-dupe within a Concept so a repeated tag counts once.
      for (const tag of new Set(tags)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => a.tag.localeCompare(b.tag));
  },

  async conceptsByTag(tag: string): Promise<string[]> {
    const out: string[] = [];
    for (const path of conceptPaths()) {
      const { tags } = parseFrontmatter(FILES[path]);
      if (tags.includes(tag)) out.push(path);
    }
    return out.sort();
  },

  async allTypes(): Promise<string[]> {
    const set = new Set<string>();
    for (const path of conceptPaths()) {
      const { type } = parseFrontmatter(FILES[path]);
      if (type !== null && type !== '') set.add(type);
    }
    return [...set].sort();
  },

  // Per-Bundle session state, backed by `localStorage` keyed by the fake bundle
  // path. localStorage survives a page reload, so a Playwright reload restores
  // the last-open Concept + expanded folders exactly as the real backend would
  // restore them from the OS config file. Robust to corrupt JSON (-> defaults).
  async loadBundleState(): Promise<BundleState> {
    return loadFakeBundleState();
  },

  async saveBundleState(state: BundleState): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(BUNDLE_STATE_KEY, JSON.stringify(state));
  },

  // Full-text search: scan every `.md` Concept's full content for a
  // case-insensitive substring of `query`, the JS equivalent of the Rust
  // ripgrep-crate search. Returns one hit per matching line (path + 1-based
  // line + the matching line text), ordered by path then line and capped at
  // MAX_SEARCH_RESULTS to mirror the backend's server-side cap. An empty /
  // whitespace query yields no matches (the UI doesn't search until input).
  async search(query: string): Promise<SearchHit[]> {
    const needle = query.trim().toLowerCase();
    if (needle === '') return [];

    const hits: SearchHit[] = [];
    for (const path of conceptPaths()) {
      const lines = FILES[path].split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].replace(/\r$/, '');
        if (line.toLowerCase().includes(needle)) {
          hits.push({ path, line: i + 1, snippet: line });
          if (hits.length >= MAX_SEARCH_RESULTS) break;
        }
      }
      if (hits.length >= MAX_SEARCH_RESULTS) break;
    }
    hits.sort((a, b) => (a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path)));
    return hits.slice(0, MAX_SEARCH_RESULTS);
  },
};

/** Mirror of the Rust `MAX_RESULTS` cap (search.rs). */
const MAX_SEARCH_RESULTS = 500;

/** localStorage key for the fake Bundle's session state. */
const BUNDLE_STATE_KEY = `emerald:bundleState:${FAKE_BUNDLE_ROOT}`;

/** Default per-Bundle state (mirrors the Rust `BundleState::default`). */
function defaultBundleState(): BundleState {
  return { lastOpenConcept: null, expandedFolders: [], recentFiles: [] };
}

/** Read the fake Bundle state from localStorage; corrupt/missing -> defaults. */
function loadFakeBundleState(): BundleState {
  if (typeof localStorage === 'undefined') return defaultBundleState();
  const raw = localStorage.getItem(BUNDLE_STATE_KEY);
  if (raw === null) return defaultBundleState();
  try {
    const parsed = JSON.parse(raw) as Partial<BundleState>;
    return {
      lastOpenConcept: parsed.lastOpenConcept ?? null,
      expandedFolders: Array.isArray(parsed.expandedFolders) ? parsed.expandedFolders : [],
      recentFiles: Array.isArray(parsed.recentFiles) ? parsed.recentFiles : [],
      window: parsed.window,
    };
  } catch {
    return defaultBundleState();
  }
}
