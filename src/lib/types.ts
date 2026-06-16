// Shared TypeScript types crossing the IPC seam.
// Shapes must match the Rust serde structs (serde rename_all = "camelCase").
// See ARCHITECTURE.md and CONTEXT.md.

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
 * `paths` are bundle-relative, '/'-separated. Emerald's own autosave writes
 * are suppressed by the backend and never appear here.
 */
export type FileChange = {
  /** what happened to the paths */
  kind: 'created' | 'modified' | 'removed';
  /** affected bundle-relative paths */
  paths: string[];
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
