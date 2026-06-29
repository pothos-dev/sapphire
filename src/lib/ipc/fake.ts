import type { Backend } from './backend';
import type {
  TreeNode,
  FileChange,
  TagCount,
  BundleState,
  SearchHit,
  RewriteSummary,
} from '$lib/types';
import {
  FAKE_BUNDLE_ROOT,
  FILES,
  FOLDERS,
  conceptPaths,
  isSafePath,
  folderExists,
} from './fake/store';
import { buildTree, renameInternal, deleteInternal } from './fake/tree';
import { outboundLinks, planRewrites } from './fake/links';
import { parseFrontmatter, parseFrontmatterKeys } from './fake/frontmatter';

/**
 * In-memory Backend implementation over a seeded fixture Bundle.
 *
 * This is what makes the frontend runnable + screenshottable in plain Chromium
 * under Playwright with no native build. It must be behaviourally faithful to
 * the real backend: same path conventions (bundle-relative, '/'-separated),
 * same tree shape, same path-escape rejection.
 *
 * The fixture, mutable in-memory state, and the focused operations over it live
 * in `./fake/*`:
 *   - `store`   — the fixture data + the shared mutable `FILES`/`FOLDERS` state
 *                 (exported as live bindings, so every module shares one copy)
 *                 plus the path predicates over them;
 *   - `tree`    — TreeNode construction + path-mutating rename/delete;
 *   - `frontmatter` — YAML `type`/`tags`/keys parse (mirrors Rust `index.rs`);
 *   - `links`   — outbound-link extraction + the rename/move link-rewrite engine.
 * This module wires them into the watcher-subscriber model and the exported
 * `fakeBackend`.
 */

// ---------------------------------------------------------------------------
// Simulated filesystem-change subscribers (the fake's stand-in for the Rust
// `notify` watcher).
// ---------------------------------------------------------------------------

/** Subscribers to simulated filesystem changes (see `onFileChanged`). */
const fileChangeSubscribers = new Set<(change: FileChange) => void>();

/**
 * Test hook: simulate an EXTERNAL filesystem change (as if another tool edited
 * the bundle), updating the in-memory fixture and notifying subscribers. This
 * is the fake's stand-in for the Rust `notify` watcher — it lets Playwright
 * exercise the tree-refresh / reload-open-Concept path. Unlike `writeConcept`
 * (Sapphire's own autosave), these changes ARE delivered to subscribers.
 *
 * Exposed on `window.__sapphireFake` so tests can drive it from the browser.
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
 * Test hook: strip the `tags` frontmatter from EVERY Concept so the Bundle
 * carries no tags, then notify subscribers (one `modified` per affected file).
 * Drives the empty-Bundle case for hide-tags-section-when-empty, where the
 * default fixture otherwise always has tags. Mirrors the real index refresh:
 * the tag-removal arrives as ordinary file-changed events, bumping the index
 * `version`.
 */
function clearAllTags(): void {
  for (const path of conceptPaths()) {
    const content = FILES[path];
    // Remove a `tags:` line (inline `[...]`) and any following block-list items.
    const lines = content.split('\n');
    const out: string[] = [];
    let stripping = false;
    let changed = false;
    for (const line of lines) {
      if (stripping) {
        // Drop block-list items belonging to the removed `tags:` key.
        if (/^\s*-\s+/.test(line)) {
          changed = true;
          continue;
        }
        stripping = false;
      }
      if (/^tags:\s*\[.*\]\s*$/.test(line)) {
        changed = true;
        continue;
      }
      if (/^tags:\s*$/.test(line)) {
        stripping = true;
        changed = true;
        continue;
      }
      out.push(line);
    }
    if (changed) {
      FILES[path] = out.join('\n');
      notifyFsChange('modified', path);
    }
  }
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__sapphireFake = {
    simulateExternalChange,
    clearAllTags,
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
    // Sapphire's own write: update the in-memory bundle but do NOT notify
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
  // SHOULD refresh the tree + index (unlike `writeConcept`, which is Sapphire's
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

  async allKeys(): Promise<string[]> {
    const set = new Set<string>();
    for (const path of conceptPaths()) {
      for (const key of parseFrontmatterKeys(FILES[path])) set.add(key);
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
const BUNDLE_STATE_KEY = `sapphire:bundleState:${FAKE_BUNDLE_ROOT}`;

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
      // Sidebar collapse flags: passed through untouched (undefined when absent,
      // which the session store defaults to `true` on read).
      leftSidebarOpen: parsed.leftSidebarOpen,
      explorerOpen: parsed.explorerOpen,
      tagsOpen: parsed.tagsOpen,
      backlinksOpen: parsed.backlinksOpen,
      // Right Sidebar collapse flag: passed through untouched (undefined when
      // absent, which the session store defaults to `false` on read).
      rightSidebarOpen: parsed.rightSidebarOpen,
      // Outline section collapse flag: passed through untouched (undefined when
      // absent, which the session store defaults to `true` on read).
      outlineOpen: parsed.outlineOpen,
      // Properties panel collapse flag: passed through untouched (undefined when
      // absent, which the session store defaults to `true` on read).
      propertiesOpen: parsed.propertiesOpen,
    };
  } catch {
    return defaultBundleState();
  }
}
