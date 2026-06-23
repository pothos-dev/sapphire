# Changelog

All notable changes to Sapphire are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.10.0] - 2026-06-23

### Added

- Wikilinks: `[[name]]` parsing with bundle-wide name resolution, rendering and
  navigation in live preview, backlinks, and automatic link rewriting on rename.
- Tri-state editor view mode toggle: Source / Live / Read.
- Collapsible frontmatter Properties panel, auto-revealed when it gains focus.
- Support for non-OKF folders: empty frontmatter collapses and the missing-`type`
  nag is dropped, so any plain markdown folder opens cleanly.
- Tidier Explorer folder rows: aligned caret, click-to-open index, child indent.

### Changed

- The rename input hides the implicit `.md` extension and re-appends it on confirm.

### Fixed

- Numeric frontmatter values (e.g. `order: 3`) are no longer silently quoted into
  strings on save, preserving their YAML type across the round-trip.

## [0.9.0] - 2026-06-18

First public release. Sapphire is a Tauri-based markdown knowledge editor.

### Added

- Explorer tree with full keyboard navigation and CRUD keybindings on the focused item.
- Region focus model: an active Region plus Alt-directional movement between Regions, with a unified Escape "peel" model and overlay restore-to-opener.
- Keyboard navigation for the Outline and Backlinks Regions.
- Properties metadata editor as a spreadsheet-style grid with keyboard navigation, chip-cell sub-navigation, and reachable add-controls.
- Tags browser with multi-expand and tree keyboard navigation.
- Drag-and-drop moving of Concepts and folders in the explorer tree.
- In-Concept Find & Replace, scrolling the highlighted result into view on arrow-key navigation.
- Transient auto-reveal of Regions hidden by a collapsed Section.
- Full-text search backend (ripgrep libraries, no external binary).
- Filesystem change watching with autosave.
- Unit test suite for pure library utilities plus a Playwright end-to-end suite.

### Fixed

- Bare and autolinked URLs no longer vanish in live preview.
- Focused-item highlight rings are gated on focus and start in the Explorer.
- Section-collapsed Regions are revealed correctly on Alt-in.
- The active-Region lift now shows on the Properties (metadata) editor.
