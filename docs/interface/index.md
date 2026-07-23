# Interface — layout, focus, and persisted view state

How the Sunstone window is laid out, how keyboard focus moves across it, and which UI state survives a relaunch. Start with the app shell, then the Sidebars, the focus model, and what gets persisted.

## Concepts

- [App shell](app-shell.md) - The top-level three-Pane layout: left Sidebar, central Editor pane, right Sidebar, wrapped by the nav bar.
- [Nav bar](nav-bar.md) - The global-controls header: Sidebar toggles, the tri-state view-mode control, and the Properties toggle.
- [Sidebars and Sections](sidebars.md) - The left/right Sidebars, their collapsible Sections and Accordion height-sharing, and transient focus-driven reveal.
- [Focus model](focus-model.md) - The six-Region 3×2 grid, directional movement, and the Focused item within a Region.
- [View state](view-state.md) - The per-user UI state restored on relaunch (last-open Concept, expanded folders, sidebar flags, tiling layout, window geometry) — never written into the Bundle.

## Related

- [Editor layout](/editor/editor-layout.md) - The Editor pane hosted between the two Sidebars.
- [Glossary](/GLOSSARY.md) - Canonical names for Pane, Sidebar, Section, Region, and View state.
