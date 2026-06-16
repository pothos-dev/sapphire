import type { Backend } from './backend';
import type { TreeNode } from '$lib/types';

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

See also [CodeMirror](./codemirror.md).
`,

  'concepts/editor/live-preview.md': `---
type: concept
title: Live Preview
description: Obsidian-style hybrid editing.
tags: [editor, codemirror]
---

# Live Preview

Obsidian-style hybrid editing: the markdown source is the source of truth, but
inactive lines render styled while the cursor line shows raw markup.

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

const TREE = buildTree();

/** Reject paths that escape the bundle, mirroring the Rust validation. */
function isSafePath(path: string): boolean {
  if (path.startsWith('/')) return false;
  return !path.split('/').includes('..');
}

export const fakeBackend: Backend = {
  async bundleRoot(): Promise<string> {
    return FAKE_BUNDLE_ROOT;
  },

  async listTree(): Promise<TreeNode> {
    return TREE;
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
};
