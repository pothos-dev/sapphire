# 01 — Document/Pane state split (single pane)

**What to build:** The editor's state is reorganised so that the *content of a
Concept* and the *view onto it* are separate things — without any visible change
to the app. A **Document** owns a Concept's buffer, dirty flag, autosave, and
edit-history (one per bundle-relative path). A **Pane** owns a CodeMirror view,
scroll/cursor, and view-mode, and attaches to a Document. The workspace holds
exactly one Pane. Opening, editing, autosave, navigation history, external-change
reload, review-diff, PDF export and the satellite panels all behave exactly as
today. This is pure prefactor: "make the change easy, then make the easy change."

**Blocked by:** None — can start immediately.

**Status:** done

- [ ] `editor.svelte.ts` singleton is split into a Document layer (per-path
      buffer/dirty/autosave/edit-history, owns disk writes) and a workspace/Pane
      layer (active pane, view state), with the workspace holding a single Pane.
- [ ] Opening a Concept, per-keystroke autosave (~300ms debounce), flush-on-blur,
      and external-change reload behave identically to today.
- [ ] Navigation history (back/forward, truncate-forward, follow-rename) is owned
      by the single Pane and behaves identically.
- [ ] Review-diff mode, Export-PDF, Outline, Backlinks, Properties and
      broken-link decorations still read from the (single) active pane's Document
      and behave identically.
- [ ] A Concept opened while already open is a no-op (no duplicate history), as
      today.
- [ ] `bun test src/lib`, `bun run check`, `cargo test`, `cargo check` all green;
      existing Playwright specs pass unchanged.
