# 15 — Path string helpers disposition

Type: grilling
Status: resolved
Blocked by: 03, 09

## Question

`path.ts` (`basename`, `dirname`, `stripMd`, `isMarkdownName`, `ensureMd`, `joinPath`,
`splitPath`, `remapPath`, `remapPaths`, `moveDestination`) partially overlaps Rust
`paths.rs` (`dir_of`, `to_rel_string`, `normalize_segments`) but also carries UI-only
convenience helpers used all over `.svelte` files synchronously.

Decide which helpers are genuine twins that migrate to wasm vs which stay TS as trivial
string ops (crossing the wasm boundary for `basename` would be absurd). Likely outcome:
keep the trivial helpers in TS, migrate only the ones that must byte-match Rust path
math (`remapPath`/`moveDestination` overlap with rewrite). Classify each.

## Answer

**`path.ts` stays entirely TS — zero helpers migrate to wasm.** Inspection *refutes* the
ticket's predicted "migrate `remapPath`/`moveDestination`" outcome: neither overlaps the
*shared* rewrite path-math, and all ten helpers fail both prongs of the migration criterion.

Two families, both stay TS:

**1. Trivial synchronous UI string ops** — `basename`, `dirname`, `stripMd`,
`isMarkdownName`, `ensureMd`, `joinPath`, `splitPath`. One-liners over `lastIndexOf('/')` /
a regex, called all over `.svelte` files synchronously for display and name entry. Crossing
the wasm boundary for a `basename` would be absurd (ticket's own words). `dirname` echoes
Rust `dir_of`, **but `dir_of` is now a private helper *inside* the wasm-migrated
`resolve_internal`** (ticket [10](10-migrate-link-family.md)) — the frontend no longer does
link resolution, so no maintained cross-language twin remains; `dirname` is pure UI. No
drift risk to kill.

**2. Subtree-prefix remaps over frontend-only session state** — `remapPath`, `remapPaths`,
`moveDestination`. The predicted "overlap with rewrite" doesn't hold up:
- The *shared* rewrite kernels (`rewrite/paths.rs`: relative-path computation, wikilink
  shortest-suffix, URL-suffix split, utf8-len) contain **no** remap / move-destination fn.
- Their only Rust echo is the `path.strip_prefix("{from}/")` line inside
  `rewrite.rs::build_move_map` — which walks the **index** and is part of the *native*
  rename/move command that ticket [12](12-migrate-fake-backend-standins.md) keeps native
  (Layer-2 orchestration, out of scope for wasm).
- The TS helpers never feed link rewriting. `remapPath`/`remapPaths` keep **frontend
  session state** valid after a rename (`session.svelte.ts` expanded folders + recents,
  `navHistory.ts`, `document.svelte.ts` open-doc keys, `workspace.svelte.ts` active path);
  `moveDestination` computes a drag-drop target in `treeActions.svelte.ts`. None crosses
  the `BundleIndex` handle; none operates over wasm-resident state.

Applying the two-pronged criterion (map Notes): **(a)** twin of *shared* Rust logic? No —
the echoes are either a private helper folded into wasm's own resolve (10) or a native-only
command (12). **(b)** operates over wasm-resident state? No — pure frontend session data.
`path.ts` is precisely the map's counterweight case: "a util that also serves non-wasm data
stays TS and is *fed* the wasm-resident data." Migrating it would manufacture a new twin to
kill drift that doesn't exist, and force trivial string ops through an `init()`-gated
async-loaded boundary.

**No new tickets; no fog graduated; nothing newly out of scope.** This confirms `path.ts`
survives the migration intact — a fact the ADR ([17](17-adr-assembly.md)) records under
"what stays TS," alongside [16](16-untwinned-ts-logic.md)'s un-twinned-TS verdicts.
