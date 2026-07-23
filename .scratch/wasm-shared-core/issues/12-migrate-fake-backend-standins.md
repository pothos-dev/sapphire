# 12 — Fake backend: replace stand-ins with wasm, or port them?

Type: grilling
Status: open
Blocked by: 03, 04, 09, 10, 11

## Question

The fake backend (`ipc/fake/*`) exists so Playwright's desktop suite runs without a
Rust backend. If the real algorithms are now wasm-in-browser, does the fake backend
**call wasm directly** (deleting its stand-in reimplementations), and where does that
leave the deliberately-divergent stand-ins?

Decide per module:
- **Search** (`fake.ts::search` ↔ `search.rs`) — real Rust uses ripgrep/ignore-walk
  (filesystem); the fake is an in-memory simplified twin. Can wasm serve search over
  an in-memory corpus, or does the fake stay hand-rolled?
- **Whole-doc render** (`ipc/fake/render.ts` ↔ `render.rs` comrak) — the fake is a
  *minimal stand-in*, not a faithful port. [08](08-bundle-size-budget.md) resolved:
  comrak-in-wasm is **deferred out of v1** (~1.5 MB). So the fake renderer likely
  **stays a TS stand-in** for now; revisit replacing it if a later effort accepts the
  render-wasm size. Confirm and record.
- **Tree** (`ipc/fake/tree.ts` ↔ `bundle.rs`) — entangled with in-memory FILES/FOLDERS
  + IO semantics; likely stays TS (weak wasm candidate). Confirm.

## Constraint from [07](07-test-coverage-strategy.md)

07's coverage story makes the desktop Playwright suite the **primary** wasm behavioural
guard, which holds *only if* `fake.ts`'s index/rewrite ops derive from the **same shared
source** (consume wasm) rather than a ported divergent TS re-impl — a divergent fake
silently tests different logic than ships and would force the standing parity harness 07
rejects. So for the **pure** stand-ins with a shared-source twin (rewrite/link/index
family), the default is **consume wasm, delete the TS re-impl**. The deliberately-divergent
IO stand-ins with no pure shared source (search over a filesystem corpus, comrak render
deferred per 08, tree IO) are exempt — they stay hand-rolled TS.
