import { describe, expect, test } from 'bun:test';
import {
  serializeLayout,
  deserializeLayout,
  migrateLegacy,
  resolveStoredLayout,
  type StoredLayout,
} from './layoutPersist';

// A two-column layout: column 0 has one tile, column 1 stacks two. Distinct
// weights + modes let us prove nothing is flattened or defaulted on round-trip.
function sampleLayout(): StoredLayout {
  return {
    columns: [
      { weight: 0.6, tiles: [{ path: 'a.md', mode: 'view', weight: 1 }] },
      {
        weight: 0.4,
        tiles: [
          { path: 'b.md', mode: 'edit', weight: 0.3 },
          { path: null, mode: 'hybrid', weight: 0.7 },
        ],
      },
    ],
    active: [1, 0],
  };
}

describe('serializeLayout', () => {
  test('captures order, weights, per-tile path + mode, and the active tile', () => {
    const layout = {
      columns: [
        { weight: 0.6, tiles: [{ id: 'p1', weight: 1 }] },
        {
          weight: 0.4,
          tiles: [
            { id: 'p2', weight: 0.3 },
            { id: 'p3', weight: 0.7 },
          ],
        },
      ],
    };
    const tileData = (id: string) =>
      ({
        p1: { path: 'a.md', mode: 'view' as const },
        p2: { path: 'b.md', mode: 'edit' as const },
        p3: { path: null, mode: 'hybrid' as const },
      })[id];

    expect(serializeLayout(layout, 'p2', tileData)).toEqual(sampleLayout());
  });

  test('falls back to active [0,0] when the active id is absent', () => {
    const layout = { columns: [{ weight: 1, tiles: [{ id: 'p1', weight: 1 }] }] };
    const out = serializeLayout(layout, 'gone', () => ({ path: 'a.md', mode: 'hybrid' }));
    expect(out.active).toEqual([0, 0]);
  });

  test('serializes an unknown tile id as an empty hybrid tile', () => {
    const layout = { columns: [{ weight: 1, tiles: [{ id: 'p1', weight: 1 }] }] };
    const out = serializeLayout(layout, 'p1', () => undefined);
    expect(out.columns[0].tiles[0]).toEqual({ path: null, mode: 'hybrid', weight: 1 });
  });
});

describe('deserializeLayout round-trip', () => {
  test('is identity for a valid layout (through JSON)', () => {
    const layout = sampleLayout();
    const roundTripped = deserializeLayout(JSON.parse(JSON.stringify(layout)));
    expect(roundTripped).toEqual(layout);
  });

  test('preserves the exact column + tile weights', () => {
    const out = deserializeLayout(sampleLayout())!;
    expect(out.columns.map((c) => c.weight)).toEqual([0.6, 0.4]);
    expect(out.columns[1].tiles.map((t) => t.weight)).toEqual([0.3, 0.7]);
  });
});

describe('deserializeLayout fallback (corrupt/empty → null)', () => {
  test('returns null for non-objects, null, and empty column lists', () => {
    expect(deserializeLayout(null)).toBeNull();
    expect(deserializeLayout(undefined)).toBeNull();
    expect(deserializeLayout('nope')).toBeNull();
    expect(deserializeLayout(42)).toBeNull();
    expect(deserializeLayout({})).toBeNull();
    expect(deserializeLayout({ columns: [] })).toBeNull();
    expect(deserializeLayout({ columns: 'x' })).toBeNull();
  });

  test('returns null when a column has no tiles or is malformed', () => {
    expect(deserializeLayout({ columns: [{ weight: 1, tiles: [] }] })).toBeNull();
    expect(deserializeLayout({ columns: [{ weight: 1 }] })).toBeNull();
    expect(deserializeLayout({ columns: [null] })).toBeNull();
    expect(deserializeLayout({ columns: [{ tiles: [null] }] })).toBeNull();
  });

  test('coerces cosmetic tile/column corruption rather than rejecting', () => {
    const out = deserializeLayout({
      columns: [{ weight: 'bad', tiles: [{ path: 42, mode: 'nonsense', weight: -3 }] }],
    })!;
    expect(out).not.toBeNull();
    expect(out.columns[0].weight).toBe(1);
    expect(out.columns[0].tiles[0]).toEqual({ path: null, mode: 'hybrid', weight: 1 });
  });

  test('clamps an out-of-range or malformed active pointer to [0,0]', () => {
    const base = { columns: [{ weight: 1, tiles: [{ path: 'a.md', mode: 'view', weight: 1 }] }] };
    expect(deserializeLayout({ ...base, active: [9, 9] })!.active).toEqual([0, 0]);
    expect(deserializeLayout({ ...base, active: 'x' })!.active).toEqual([0, 0]);
    expect(deserializeLayout({ ...base, active: [0] })!.active).toEqual([0, 0]);
  });
});

describe('migrateLegacy', () => {
  test('maps an old single-Concept session to one tile in that mode', () => {
    expect(migrateLegacy('notes/x.md', 'view')).toEqual({
      columns: [{ weight: 1, tiles: [{ path: 'notes/x.md', mode: 'view', weight: 1 }] }],
      active: [0, 0],
    });
  });

  test('maps a null last-open Concept to one empty tile', () => {
    expect(migrateLegacy(null, 'hybrid').columns[0].tiles[0].path).toBeNull();
  });
});

describe('resolveStoredLayout', () => {
  test('prefers a valid stored layout over migration', () => {
    const layout = sampleLayout();
    expect(resolveStoredLayout(layout, 'other.md', 'edit')).toEqual(layout);
  });

  test('migrates an old session (no layout) with a last-open Concept', () => {
    expect(resolveStoredLayout(undefined, 'x.md', 'view')).toEqual(migrateLegacy('x.md', 'view'));
  });

  test('returns null for a fresh session (no layout, no last-open Concept)', () => {
    expect(resolveStoredLayout(undefined, null, 'hybrid')).toBeNull();
    expect(resolveStoredLayout(null, null, 'hybrid')).toBeNull();
  });

  test('migrates when the stored layout is corrupt but a last-open Concept exists', () => {
    expect(resolveStoredLayout({ columns: [] }, 'x.md', 'edit')).toEqual(
      migrateLegacy('x.md', 'edit'),
    );
  });
});
