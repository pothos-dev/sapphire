import type { Backend } from './backend';
import type { TreeNode, FileChange, TagCount } from '$lib/types';
import { resolveLink } from '$lib/links';

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

  async allTypes(): Promise<string[]> {
    const set = new Set<string>();
    for (const path of conceptPaths()) {
      const { type } = parseFrontmatter(FILES[path]);
      if (type !== null && type !== '') set.add(type);
    }
    return [...set].sort();
  },
};
