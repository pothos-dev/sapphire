import { describe, expect, test } from 'bun:test';
import {
  KEY_COL,
  VALUE_COL,
  moveCell,
  nextCellTab,
  clampCell,
  type Cell,
} from './propertiesGrid';

const cell = (row: number, col: 0 | 1): Cell => ({ row, col });

describe('moveCell — arrow movement clamps at every edge (no wrap)', () => {
  test('up/down move rows within the column', () => {
    expect(moveCell(cell(1, KEY_COL), 'up', 3)).toEqual(cell(0, KEY_COL));
    expect(moveCell(cell(1, VALUE_COL), 'down', 3)).toEqual(cell(2, VALUE_COL));
  });

  test('up clamps at the top row, down clamps at the bottom row', () => {
    expect(moveCell(cell(0, VALUE_COL), 'up', 3)).toEqual(cell(0, VALUE_COL));
    expect(moveCell(cell(2, KEY_COL), 'down', 3)).toEqual(cell(2, KEY_COL));
  });

  test('left snaps to the key column, right to the value column (clamp at edges)', () => {
    expect(moveCell(cell(1, VALUE_COL), 'left', 3)).toEqual(cell(1, KEY_COL));
    expect(moveCell(cell(1, KEY_COL), 'right', 3)).toEqual(cell(1, VALUE_COL));
    // Already at the edge column → stay.
    expect(moveCell(cell(1, KEY_COL), 'left', 3)).toEqual(cell(1, KEY_COL));
    expect(moveCell(cell(1, VALUE_COL), 'right', 3)).toEqual(cell(1, VALUE_COL));
  });

  test('empty grid pins the cursor at the first key cell', () => {
    expect(moveCell(cell(0, VALUE_COL), 'down', 0)).toEqual(cell(0, KEY_COL));
  });
});

describe('nextCellTab — key→value→next-row key, clamping at the last value cell', () => {
  test('key cell advances to the value cell in the same row', () => {
    expect(nextCellTab(cell(0, KEY_COL), 3)).toEqual(cell(0, VALUE_COL));
  });

  test('value cell advances to the next row’s key cell', () => {
    expect(nextCellTab(cell(0, VALUE_COL), 3)).toEqual(cell(1, KEY_COL));
  });

  test('the last row’s value cell clamps (no wrap to the top)', () => {
    expect(nextCellTab(cell(2, VALUE_COL), 3)).toEqual(cell(2, VALUE_COL));
  });

  test('empty grid pins at the first key cell', () => {
    expect(nextCellTab(cell(0, KEY_COL), 0)).toEqual(cell(0, KEY_COL));
  });
});

describe('clampCell — re-clamp after the row count changes', () => {
  test('row above the new count clamps to the last row', () => {
    expect(clampCell(cell(5, VALUE_COL), 3)).toEqual(cell(2, VALUE_COL));
  });

  test('in-range row is preserved (column too)', () => {
    expect(clampCell(cell(1, KEY_COL), 3)).toEqual(cell(1, KEY_COL));
  });

  test('empty grid clamps to the first row', () => {
    expect(clampCell(cell(2, VALUE_COL), 0)).toEqual(cell(0, VALUE_COL));
  });
});
