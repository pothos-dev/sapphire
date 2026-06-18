# Sapphire — Architecture & Conventions

This document is the contract for all implementation work. Every slice (see
`docs/tickets/`) builds against the seams defined here. Read it before touching code.
See `CONTEXT.md` for domain language and `docs/adr/` for decisions.

## Stack

- **Tauri 2** desktop shell; **Rust** owns the filesystem and the bundle index.
- **SvelteKit + Svelte 5 (runes)**, static adapter, SPA mode (`ssr = false`). No router use
  beyond the single `+page.svelte` entry — it mounts the app shell.
- **CodeMirror 6** editor with **`@atomic-editor/editor`** live-preview extensions (ADR 0001).

## Repository layout

```
src/
  routes/+page.svelte        # thin entry; mounts <App/>
  lib/
    App.svelte               # app shell: tree pane | editor pane | side panels
    types.ts                 # shared TS types (TreeNode, Concept, Frontmatter, ...)
    path.ts                  # bundle-relative path helpers (basename/dirname/joinPath/...)
    errors.ts                # errMessage(e) — message from an Error or any thrown value
    debounce.ts              # createDebouncer (shared autosave/persist timer)
    frontmatter.ts links.ts outline.ts fuzzy.ts reserved.ts   # pure, unit-tested utils
    ipc/
      backend.ts             # Backend interface — the ONLY boundary to Rust
      tauri.ts               # real impl (invoke + event)
      fake.ts                # in-memory impl for browser/Playwright (wires fake/*)
      fake/                  # focused modules behind the fake backend:
        store.ts             #   fixture data + shared mutable FILES/FOLDERS state
        tree.ts              #   TreeNode build + rename/delete path mutation
        frontmatter.ts       #   YAML type/tags/keys parse (mirrors Rust index.rs)
        links.ts             #   outbound-link extraction + rename link-rewrite
      index.ts               # selects real vs fake at runtime; exports `backend`
    state/                   # Svelte 5 rune-based stores (.svelte.ts)
      bundle.svelte.ts       # tree
      editor.svelte.ts       # open concept, dirty/autosave, nav history
      session.svelte.ts      # per-Bundle persisted UI state (last concept, sidebars)
      suggestions.svelte.ts  # index-derived autocomplete (paths/types/keys/tags)
    editor/
      cm.ts                  # builds the CodeMirror EditorView + extension set
    components/              # Tree.svelte, Properties.svelte, Backlinks.svelte, ...
src-tauri/src/
  lib.rs                     # builder, manages AppState, registers commands
  app_state.rs               # BundleRoot + index handle + self-write tracker
  bundle.rs                  # tree walking, concept read/write, path resolution
  index.rs                   # in-memory index (frontmatter + links + reverse map)
  paths.rs                   # shared walker + bundle-relative + link-resolution helpers
  watcher.rs                 # notify watcher -> emits events to frontend
  search.rs                  # ripgrep-crate full-text search
  rewrite.rs                 # link auto-rewrite on rename/move (+ rename_and_rewrite)
  config.rs                  # per-Bundle session state (OS config dir)
```

The `#[tauri::command]` wrappers live inline in `lib.rs` (there is no separate
`commands/` directory). Keep those wrappers thin — real logic lives in the
modules (`bundle.rs`, `index.rs`, `rewrite.rs`, ...). Slices add files here; do
not invent parallel structures.

## The IPC seam (most important rule)

The frontend NEVER imports `@tauri-apps/api` outside `src/lib/ipc/`. All backend access goes
through the `Backend` interface in `ipc/backend.ts`. `ipc/index.ts` picks the implementation:

```ts
// runtime selection
export const backend: Backend =
  '__TAURI_INTERNALS__' in window ? tauriBackend : fakeBackend;
```

- `tauri.ts` implements `Backend` via `invoke(...)` and `listen(...)`.
- `fake.ts` implements the SAME interface over an in-memory bundle (seeded fixture). This is
  what makes the frontend runnable + screenshottable in plain Chromium under Playwright
  without building the native binary.

When a slice adds a Rust command, it adds a method to `Backend` and implements it in BOTH
`tauri.ts` and `fake.ts`. The fake impl must be behaviourally faithful enough to test the UI.

### Backend interface (grows per slice — keep both impls in sync)

Initial (slice 1) surface; later slices extend it:

```ts
interface Backend {
  bundleRoot(): Promise<string>;                 // absolute path opened via CLI
  listTree(): Promise<TreeNode>;                  // recursive tree of the bundle
  readConcept(path: string): Promise<string>;     // raw markdown by bundle-relative path
  // slice 2: writeConcept(path, content); onFileChanged(cb) event subscription
  // slice 6: indexQuery(...) ; slice 14: search(query) ; etc.
}
```

`TreeNode` (shared type):

```ts
type TreeNode = {
  name: string;
  path: string;            // bundle-relative, '/'-separated, '' for root
  isDir: boolean;
  children?: TreeNode[];   // dirs only
};
```

Paths crossing the seam are always **bundle-relative, forward-slash**. Rust resolves them
against the bundle root and rejects escapes (no `..` outside the bundle).

## Rust conventions

- CLI arg read in `lib.rs` setup: first positional arg = bundle path (default `.`), canonicalize,
  store in `AppState`. Expose via `bundle_root` command.
- Commands return `Result<T, String>` (stringified error) and use `serde` types shared in shape
  with the TS `types.ts`. Use `serde(rename_all = "camelCase")` so JSON matches TS.
- All path inputs validated against the bundle root before any fs op.

## Editor (CodeMirror 6 + atomic-editor)

`editor/cm.ts` builds the `EditorView`. Base extension set:

```ts
import { inlinePreview } from '@atomic-editor/editor';
import { imageBlocks } from '@atomic-editor/editor';
import { tables } from '@atomic-editor/editor';
import { atomicEditorTheme, atomicMarkdownSyntax } from '@atomic-editor/editor';
import '@atomic-editor/editor/styles.css';
```

- `inlinePreview({ onLinkClick })` gives Obsidian-style decorations AND routes link clicks —
  slice 5 passes an `onLinkClick` that resolves OKF paths and navigates, instead of opening a
  browser. Do NOT use atomic-editor's `wikiLinks` (OKF uses standard markdown links).
- Light/dark: set `data-theme="light"` on the editor root when OS/user theme is light
  (slice 9 owns the theme source; until then follow `prefers-color-scheme`).
- Read-only (slice 1) via `EditorState.readOnly.of(true)`; editable from slice 2.

## State (Svelte 5 runes)

Use `.svelte.ts` modules exporting rune-backed state (`$state`, `$derived`) and functions.
No external store library. Keep autosave/dirty logic in `state/editor.svelte.ts`.

## Testing & screenshots (AFK verification)

CDP is unavailable (Tauri uses WebKitGTK on Linux, not Chromium). So:

- **Unit tests (fast, pure logic).** `bun test src/lib` runs the bun built-in test
  runner over `src/lib/**/*.test.ts` (no extra dependency; `bun-types` is dev-only).
  These cover the pure, DOM-free modules — `path`, `errors`, `debounce`, `frontmatter`,
  `links`, `outline`, `fuzzy`, `reserved`. Keep them scoped to `src/lib` so the runner
  never picks up the Playwright specs in `tests/`. The Rust side has `#[cfg(test)]`
  unit tests run by `cargo test` (logic modules: bundle, index, rewrite, search, config,
  watcher, app_state).
- **Playwright over `vite dev` + the fake backend** is the primary interactive/visual test.
  Config: `playwright.config.ts` runs `bun run dev` (port 1420) as `webServer`. Tests live in
  `tests/`. Each slice adds at least one test that drives its UI and saves a screenshot to
  `tests/screenshots/<slice>.png`. The fake backend is active automatically (no `__TAURI_INTERNALS__`
  in Chromium).
- **Integration smoke** via `tauri-driver` + WebKitWebDriver is best-effort for the real webview;
  not required for every slice.

Every slice must leave `bun run check` (frontend typecheck), `bun test src/lib` (unit),
`cargo test` (Rust unit) and `cargo check` green, and add/extend a Playwright test with a
screenshot.

## Ticket workflow

When a slice is done, move its file from `docs/tickets/ready/` to `docs/tickets/done/` and
commit. Commit messages end with the line: `🤖 Generated with claude-code`.
