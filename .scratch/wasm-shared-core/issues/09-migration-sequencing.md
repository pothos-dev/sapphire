# 09 — Incremental migration sequencing & rollback

Type: grilling
Status: resolved
Blocked by: 02, 04, 08

## Question

In what order do the twin families migrate, and how do we de-risk each step?

The seam (02/03/04) proven, decide the sequence across the family tickets (10–17):
which family goes first as the end-to-end proof (recommend the link family, ticket 10),
how twins **coexist** during migration (feature flag / per-module switch so TS and
wasm can be compared), the parity-check gate before deleting each TS twin, and the
rollback path if a family can't cross cleanly. Produces the ordered migration plan the
ADR (ticket 18) records. Uses the inventory in
`../research/00-twin-inventory.md`.

## Answer

### Coexistence & rollback: clean-cut-per-PR

**No dual-path / feature-flag coexistence.** Each family crosses in a single PR that
(a) lands the Rust in `sunstone-shared`, (b) wires wasm at the frontend seam, (c)
**deletes the TS twin + its unit test in the same PR**, and (d) merges only with all
four gates + Playwright green. Rationale: a runtime switch is throwaway scaffolding
that forces *both* impls to load onto the synchronous decoration path and re-creates
a live twin — exactly what the effort and [07](07-test-coverage-strategy.md) kill.
**Rollback = `git revert` the family PR**; a family that can't cross cleanly simply
does not merge (its Rust may still land in `shared` unused). Per-family PRs keep each
revert surgical.

**Parity gate** (from [07](07-test-coverage-strategy.md)): the pre-delete check is a
**throwaway cut-over** step inside each family PR — run that twin's existing goldens
through the new wasm once, confirm byte-identical, then delete impl + test. No
standing parity harness.

### Ordered plan

**Step 0 — Pipeline stand-up (prerequisite, separate PR).** Stand up the crate triad
(02: `sunstone-shared`/`-native`/`-wasm`), `wasm-pack` + Vite wiring (01), `build:wasm`
+ `build:types` ordered before the gates (01/06), and the `indexStore.ensureWasm()` /
`.free()` seam (04/05) — shipping one **dummy `BundleIndex` export**, no real logic.
Proves the toolchain + load + gate-ordering are green *alongside* native, isolating
toolchain risk from logic risk before any family migrates. Decisions already made
(01/02/04/05/06); this is a sequencing entry, not a new decision ticket.

**Then the families** (topological order; seed first, consumer last):

1. **[10](10-migrate-link-family.md) — link family** — the seed / end-to-end proof.
   First real payload across the (now-standing) pipeline; establishes the marshalling +
   handle + parity-cut PR template the others copy. Pure `paths` already crossed with
   the crate extraction (02).
2. **[11](11-migrate-frontmatter-family.md) — frontmatter family** and
   **[13](13-migrate-render-derived-family.md) — render-derived + CM-decoration seam**
   — both follow the seed template. 13 is the most entangled (decoration seam; render
   itself deferred out of wasm per [08](08-bundle-size-budget.md)), so treat it as the
   hard one.
3. **[12](12-migrate-fake-backend-standins.md) — fake backend** — sequenced **after
   10 & 11** because 07's constraint makes it a *consumer* of their shared source
   (fake pure ops consume wasm; IO stand-ins stay TS).
4. **[15](15-migrate-path-helpers.md) — path helpers** and
   **[16](16-untwinned-ts-logic.md) — un-twinned TS (write-in-Rust vs keep)** run in
   parallel, off the critical path: 15 is disposition-only (pure paths already crossed),
   16 is a net-new-Rust scoping call, not drift removal — lowest urgency.
5. **[17](17-adr-assembly.md) — ADR assembly** — last; records this plan.

Blocking edges added to enforce the order: 11 & 13 gain `10`; 12 gains `10, 11`. 15 & 16
stay independent (parallel after 09). The frontier therefore serves **10 first**, then
11/13/15/16, then 12.
