// Bundle-relative path helpers (pure string ops; no DOM/IPC).
//
// Paths across the app are bundle-relative and '/'-separated (ARCHITECTURE.md).
// These small functions consolidate the basename / dirname / strip-".md" /
// join logic that was previously copy-pasted across components and the shell.

/** The last path segment (basename). `'a/b.md'` → `'b.md'`; `'x'` → `'x'`. */
export function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

/**
 * The containing folder of `path`, with NO trailing slash and `''` for a
 * root-level path. `'a/b.md'` → `'a'`; `'x.md'` → `''`.
 */
export function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** Strip a trailing `.md` extension (case-insensitive). */
export function stripMd(path: string): string {
  return path.replace(/\.md$/i, '');
}

/** Join a folder (`''` = Bundle root) and a name into a bundle-relative path. */
export function joinPath(dir: string, name: string): string {
  return dir === '' ? name : `${dir}/${name}`;
}

/**
 * Split a path into a directory prefix (INCLUDING the trailing slash, `''` at
 * root) and the basename — for rendering a path with a de-emphasized dir.
 * `'a/b.md'` → `{ dir: 'a/', base: 'b.md' }`; `'x.md'` → `{ dir: '', base: 'x.md' }`.
 */
export function splitPath(path: string): { dir: string; base: string } {
  const slash = path.lastIndexOf('/');
  if (slash === -1) return { dir: '', base: path };
  return { dir: path.slice(0, slash + 1), base: path.slice(slash + 1) };
}
