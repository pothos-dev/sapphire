import { describe, expect, test } from 'bun:test';
import { isNewTagIndex, moveChip, indexAfterDelete } from './chipStrip';

describe('isNewTagIndex — the trailing new-tag slot', () => {
  test('the index equal to (or past) chipCount is the new-tag input', () => {
    expect(isNewTagIndex(2, 2)).toBe(true); // 2 chips → index 2 is the input
    expect(isNewTagIndex(0, 0)).toBe(true); // empty list → index 0 is the input
  });

  test('an index within the chips is not the new-tag input', () => {
    expect(isNewTagIndex(0, 2)).toBe(false);
    expect(isNewTagIndex(1, 2)).toBe(false);
  });
});

describe('moveChip — ←/→ across chips + new-tag input, clamping (no wrap)', () => {
  test('right advances toward the new-tag input and clamps there', () => {
    // 2 chips → valid indices 0,1 (chips) and 2 (input).
    expect(moveChip(0, 'right', 2)).toBe(1);
    expect(moveChip(1, 'right', 2)).toBe(2);
    expect(moveChip(2, 'right', 2)).toBe(2); // clamp at the new-tag input
  });

  test('left moves toward the first chip and clamps at 0', () => {
    expect(moveChip(2, 'left', 2)).toBe(1);
    expect(moveChip(1, 'left', 2)).toBe(0);
    expect(moveChip(0, 'left', 2)).toBe(0); // clamp at the first chip
  });

  test('an empty list pins both directions on the new-tag input (index 0)', () => {
    expect(moveChip(0, 'left', 0)).toBe(0);
    expect(moveChip(0, 'right', 0)).toBe(0);
  });
});

describe('indexAfterDelete — focus moves to a neighbour chip', () => {
  test('deleting a middle chip keeps the slot index (right neighbour slides in)', () => {
    // [a,b,c] delete b (index 1) → [a,c]; focus stays on index 1 (now `c`).
    expect(indexAfterDelete(1, 3)).toBe(1);
  });

  test('deleting the last chip clamps focus onto the new last chip', () => {
    // [a,b,c] delete c (index 2) → [a,b]; focus → index 1 (now last).
    expect(indexAfterDelete(2, 3)).toBe(1);
  });

  test('deleting the first chip keeps index 0 (the old second chip)', () => {
    expect(indexAfterDelete(0, 3)).toBe(0);
  });

  test('deleting the only chip lands on the new-tag input (index 0)', () => {
    expect(indexAfterDelete(0, 1)).toBe(0);
  });
});
