## What to build

Replace the app's jade/emerald **green** identity with a **sunstone-blue** palette that matches the new app icon, so the UI's colour identity tells the same story as the brand.

All theming lives in `src/app.css` as CSS custom properties selected by `data-theme="light"|"dark"` on the app root (owned by `src/lib/state/theme.svelte.ts`). Both schemes already exist and must both be updated:

- **Accent** — the current emerald/jade accent (`--accent`, `--accent-contrast`, `--accent-soft`, `--accent-ring`, and the derived tag-chip tokens) re-cast as sunstone blue, preserving the same muted/sophisticated feel (not a loud primary blue).
- **Backgrounds & text** — the green-tinted canvas/elevated/sunken backgrounds and green-grey text tones retuned to a cool blue-grey neutral so they harmonise with the blue accent in both light and dark modes.
- **Atomic editor tokens** — the `--atomic-editor-*` mappings (accent, link, selection, search) inherit from the new accent; confirm the in-editor (CodeMirror) rendering re-resolves correctly and doesn't fall back to the library's default purple.

Keep the existing token structure and naming; only the values change. Update the "palette identity" comment block in `app.css` to describe the sunstone identity.

## Acceptance criteria

- [ ] Light and dark modes both render a cohesive sunstone-blue accent over cool neutral backgrounds, matching the icon
- [ ] No green/jade/emerald accent values remain in `app.css`
- [ ] The CodeMirror editor (links, selection, search highlight, code rail) picks up the new accent in both themes — no purple fallback
- [ ] Contrast remains legible (text on backgrounds, accent-contrast on solid accent fills) in both modes
- [ ] Visual check captured for both modes (screenshots) for review

## Blocked by

- None - can start immediately
