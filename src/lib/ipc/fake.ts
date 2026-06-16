import type { Backend } from './backend';
import type { TreeNode, FileChange } from '$lib/types';

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
};
