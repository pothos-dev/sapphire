## What to build

A structured Properties panel for editing a Concept's YAML frontmatter, per ADR 0002 (flat key/value model).

- Parse the leading frontmatter block into an ordered map of key → value.
- Render a Properties panel above the body:
  - Scalar values (string/number/bool/date) → single text input.
  - Flat lists, notably `tags` → chip input (add/remove).
  - Any value that is NOT a scalar or flat list (nested map, multi-line block) → preserved verbatim and shown as a read-only raw field. It must round-trip untouched.
- Unknown keys are shown and preserved — never dropped.
- The required `type` field is visually flagged when missing or empty (the one OKF conformance rule). This flag is suppressed for reserved files (handled in their own slice).
- Editing a property writes back to the frontmatter block via the autosave path.

Type: **AFK**.

## Acceptance criteria

- [ ] Frontmatter renders as a panel above the body with typed inputs
- [ ] `tags` (and other flat lists) edit as chips; scalars edit as text
- [ ] A Concept with nested/complex frontmatter shows that value as read-only raw and round-trips it byte-for-byte
- [ ] Unknown keys are displayed and preserved on save
- [ ] Missing/empty `type` is visually flagged; editing it clears the flag
- [ ] Property edits persist via autosave

## Blocked by

- editing-autosave-watcher.md
