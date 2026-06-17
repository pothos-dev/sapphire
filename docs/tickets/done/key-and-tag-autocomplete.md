## What to build

Add autocomplete to the Properties panel in two places:

1. **Property key names** — when adding or renaming a key, suggest the OKF recommended keys (`type`, `title`, `description`, `resource`, `tags`, `timestamp`) plus every distinct frontmatter key already used across other documents in the bundle. This needs a new backend method `allKeys()` (interface + fake in-memory implementation + real Tauri/Rust `all_keys` command), following the existing `allTypes()` aggregation pattern (scan all concept paths, parse frontmatter, collect distinct keys). The OKF base keys are merged in client-side or seeded so they always appear.

2. **Tag values** — in the `tags` (and any list) chip input, suggest distinct tag values already used across the bundle, sourced from the existing `backend.allTags()`. OKF defines **no** controlled tag vocabulary (see docs/okf-spec.md §4.1), so there is no fixed tag list — suggestions come only from the bundle.

Both use `<datalist>`-style suggestions, mirroring the existing `type` field autocomplete. Suggestions refresh when the bundle index changes (same `indexStore.version` trigger as `bundleTypes`).

## Acceptance criteria

- [ ] Adding or renaming a key offers suggestions = OKF recommended keys ∪ distinct keys from other bundle documents.
- [ ] The new `allKeys()` exists on the backend interface, the fake backend, and the real backend (Rust `all_keys`), and returns distinct keys sorted.
- [ ] The chip input for `tags` (and other list fields) suggests distinct tag values from `allTags()`.
- [ ] Suggestion lists update after the bundle changes (new key/tag introduced elsewhere appears without reload).
- [ ] No hardcoded tag vocabulary is introduced (tags are bundle-sourced only).

## Blocked by

- docs/tickets/ready/add-property-text-or-list.md
