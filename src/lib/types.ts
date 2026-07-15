// Shared TypeScript types crossing the IPC seam.
// Shapes must match the Rust serde structs (serde rename_all = "camelCase").
// See ARCHITECTURE.md and CONTEXT.md.

import type { EditorMode } from '$lib/editor/cm';

/**
 * A node in the Bundle's directory tree. Paths are bundle-relative,
 * '/'-separated, and '' for the root node.
 */
export type TreeNode = {
  name: string;
  path: string; // bundle-relative, '/'-separated, '' for root
  isDir: boolean;
  children?: TreeNode[]; // dirs only
};

/**
 * A Concept: a single `.md` file in the Bundle. Carries YAML frontmatter
 * (required `type`) and a free-form markdown body. (CONTEXT.md)
 *
 * Slice 1 only needs the raw markdown over the seam; richer parsed forms
 * (parsed frontmatter, links) arrive with the index slices. We define the
 * shape now so later slices extend rather than reinvent it.
 */
export type Concept = {
  /** bundle-relative, '/'-separated path of the `.md` file */
  path: string;
  /** raw markdown content, including the frontmatter block */
  content: string;
};

/**
 * A filesystem change reported by the Rust watcher over the IPC seam.
 * `paths` are bundle-relative, '/'-separated. Sapphire's own autosave writes
 * are suppressed by the backend and never appear here.
 */
export type FileChange = {
  /** what happened to the paths */
  kind: 'created' | 'modified' | 'removed';
  /** affected bundle-relative paths */
  paths: string[];
};

/**
 * A tag and the number of Concepts that carry it. Matches the Rust `TagCount`
 * (`serde rename_all = "camelCase"`). Returned by `Backend.allTags()`.
 */
export type TagCount = {
  tag: string;
  count: number;
};

/**
 * Per-Bundle session state persisted in the OS config folder (NEVER in the
 * Bundle). Matches the Rust `BundleState` (`serde rename_all = "camelCase"`).
 *
 * Designed to be EXTENDED (e.g. `recentFiles` and the sidebar flags below were
 * added this way). Both the Rust and fake backends tolerate missing/extra
 * fields, so adding a field here only requires defaulting it on read. `window`
 * is owned by Rust (it carries the window geometry through round-trips) and is
 * opaque to the frontend.
 */
export type BundleState = {
  /** bundle-relative path of the last-open Concept, or null if none */
  lastOpenConcept: string | null;
  /** bundle-relative paths of folders the user had expanded in the tree */
  expandedFolders: string[];
  /** window geometry, owned by Rust; opaque to the frontend (pass-through) */
  window?: unknown;
  /**
   * Bundle-relative paths of recently-opened Concepts, most-recent first.
   * Deduped and capped; used by the quick-nav palette's empty-input view.
   * Persisted per-Bundle in the OS config folder, never in the Bundle.
   */
  recentFiles?: string[];
  /**
   * Sidebar collapse state (persist-sidebar-collapse-state). All optional and
   * tolerated when missing; the session store defaults each to `true` on read,
   * so a fresh Bundle opens with the left Sidebar and every Section expanded.
   */
  /** whether the left Sidebar is expanded (vs collapsed entirely) */
  leftSidebarOpen?: boolean;
  /** whether the Explorer section is expanded */
  explorerOpen?: boolean;
  /** whether the Tags section is expanded */
  tagsOpen?: boolean;
  /** whether the Backlinks section is expanded */
  backlinksOpen?: boolean;
  /**
   * whether the right Sidebar (Backlinks; later Outline) is expanded
   * (right-sidebar-move-backlinks). Unlike the flags above this defaults to
   * `false` on read — the right Sidebar starts collapsed on a fresh Bundle.
   */
  rightSidebarOpen?: boolean;
  /**
   * whether the Outline section (in the right Sidebar) is expanded
   * (outline-section). Defaults to `true` on read, so the Outline shows the
   * moment the right Sidebar is first expanded.
   */
  outlineOpen?: boolean;
  /**
   * whether the Properties panel (editor-pane chrome) is expanded
   * (persist-properties-collapse). A single sticky preference like the Section
   * flags: defaults to `true` on read, and once the user toggles the header
   * chevron the choice persists across Concept switches and restarts.
   */
  propertiesOpen?: boolean;
  /**
   * The editor's tri-state view mode (Source / Live / Reading), restored on
   * relaunch (persist-editor-mode). Optional so older files tolerate its
   * absence; the session store defaults it to `DEFAULT_EDITOR_MODE` on read.
   */
  editorMode?: EditorMode;
};

/**
 * One full-text search match: a Concept (by bundle-relative path), the 1-based
 * line number of the match, and the matching line's text (snippet). Matches the
 * Rust `SearchHit` (`serde rename_all = "camelCase"`). Returned by
 * `Backend.search()`.
 */
export type SearchHit = {
  /** bundle-relative, '/'-separated path of the matched Concept */
  path: string;
  /** 1-based line number of the match within the Concept body */
  line: number;
  /** the matching line's text */
  snippet: string;
};

/**
 * Summary of an automatic link-rewrite pass after a Concept/folder rename or
 * move: how many links across how many files were rewritten to stay valid.
 * Matches the Rust `RewriteSummary` (`serde rename_all = "camelCase"`).
 * Returned by `Backend.renamePath()` / `Backend.movePath()`.
 */
export type RewriteSummary = {
  /** total number of individual links rewritten */
  linksChanged: number;
  /** number of distinct Concept files whose content was changed */
  filesChanged: number;
};

/**
 * One heading-slug rename, sent to `Backend.rewriteAnchors()` when a heading's
 * GitHub-style slug changes in the editor. Inbound `[[target#from]]` /
 * `[text](/target.md#from)` anchors are rewritten to `#to`. Matches the Rust
 * `AnchorRename` (`serde rename_all = "camelCase"`).
 */
export type AnchorRename = {
  /** the heading's previous slug (what existing links still point at) */
  from: string;
  /** the heading's new slug */
  to: string;
};

/**
 * Parsed YAML frontmatter on a Concept. Only `type` is required; other keys
 * are recommended and unknown keys must be preserved. Filled in by later
 * index slices; defined here so the vocabulary is stable.
 */
export type Frontmatter = {
  type: string;
  title?: string;
  description?: string;
  resource?: string;
  tags?: string[];
  timestamp?: string;
  /** unknown keys are preserved verbatim */
  [key: string]: unknown;
};
