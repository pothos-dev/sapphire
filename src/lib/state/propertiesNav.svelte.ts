// Properties grid keyboard-navigation state (slice: properties-grid-navigation).
//
// The Properties Section is a spreadsheet-style 2-column grid (key | value) with
// one row per frontmatter Property (CONTEXT.md "Focused item"; ADR 0003). The
// Focused item is a CELL, and the Region has THREE MODES:
//   - NAV mode   — the cell WRAPPER holds focus (spotlight ring); arrows navigate,
//                  the inner <input> is NOT focused.
//   - CHIPS mode — chip SUB-NAV for a list value cell: focus rides a roving index
//                  across the strip `[chip]…[+ new-tag input]` (←/→ move it, ↑/↓
//                  inert, `d` deletes the focused chip). `chipIndex` tracks the
//                  focused strip position; chip-strip math lives in `$lib/chipStrip`.
//   - EDIT mode  — the cell's <input> is focused; ordinary text editing (for a
//                  list cell this is typing in the new-tag input).
//
// This store holds ONLY the cursor (`cell` rune), the current `mode`, and (in
// chips mode) the focused `chipIndex`, plus the pure key-handling logic
// (delegating cell-index math to `$lib/propertiesGrid`). It is DOM-free:
// App.svelte / Properties drive DOM focus from `cell`/`mode` via an effect
// (focusing the cell wrapper in nav mode, the input in edit mode); PropertyRow
// owns the chip-strip DOM focus + local key handling (the chip depths). The
// store's actions cover enter/commit/cancel edit, add/delete row, and the
// nav-mode clipboard copy/paste. Keeping it here mirrors `explorerNav`/
// `listFocusNav` and keeps App's keydown wiring thin.

import { KEY_COL, VALUE_COL, moveCell, clampCell, type Cell } from '$lib/propertiesGrid';
import { isPlainKey } from '$lib/keynav';

/** How the focused VALUE cell behaves under Enter (the key cell is always plain). */
export type CellKind = 'scalar' | 'list' | 'raw';

/** Side-effects the handler invokes; supplied by App.svelte / Properties. */
export interface PropertiesNavActions {
  /** Number of property rows currently rendered. */
  rowCount: () => number;
  /** Kind of the VALUE cell at `row` (scalar / list / read-only raw). */
  valueKind: (row: number) => CellKind;
  /**
   * Enter EDIT mode on the focused cell: focus its <input>. For a `list` value
   * cell this focuses the chip-add input (full chip sub-nav is a later slice);
   * for a `raw` value cell it focuses the read-only textarea (select/copy only).
   * No-op return is fine — the store flips `mode` regardless and the focus effect
   * places DOM focus.
   */
  enterEdit: (cell: Cell) => void;
  /** Add a new scalar ("+ Text") property row and request edit mode on its key cell. */
  addRow: () => void;
  /** Add a new list ("+ List") property row (the add-controls row, right button). */
  addList: () => void;
  /** Delete the property row at `row`. */
  deleteRow: (row: number) => void;
  /** Copy the focused cell's value to the clipboard (nav-mode Ctrl+C). */
  copyCell: (cell: Cell) => void;
  /** Paste the clipboard into the focused cell as a string (nav-mode Ctrl+V). */
  pasteCell: (cell: Cell) => void;
}

class PropertiesNavStore {
  /** The Focused cell (keyboard cursor). Row 0 / key column by default. */
  cell = $state<Cell>({ row: 0, col: KEY_COL });

  /**
   * `nav`   = cell wrapper focused (arrows navigate);
   * `chips` = chip sub-nav of a list value cell (focus on a chip / new-tag input);
   * `edit`  = an <input>/<textarea> focused (text editing).
   */
  mode = $state<'nav' | 'chips' | 'edit'>('nav');

  /** Focused strip position in CHIPS mode: `0..chipCount-1` chips, `chipCount` = new-tag input. */
  chipIndex = $state(0);

  /** Place the cursor on `cell` in NAV mode (click, programmatic focus). */
  setCell(cell: Cell): void {
    this.cell = cell;
    this.mode = 'nav';
  }

  /**
   * Drop INTO a list value cell's chip sub-nav (CHIPS mode), landing on the
   * first chip (index 0), or on the new-tag input when the list is empty
   * (index 0 == chipCount). PropertyRow mirrors `chipIndex` into DOM focus.
   */
  toChips(index = 0): void {
    this.mode = 'chips';
    this.chipIndex = index;
  }

  /** Enter NAV mode on the cell at `row`/`col` (used after a commit). */
  toNav(cell: Cell): void {
    this.cell = cell;
    this.mode = 'nav';
  }

  /**
   * Re-clamp the cursor after the row count changes (a row added/deleted, the
   * Concept switched). Keeps the cursor in range; resets to the first cell when
   * the grid is now empty.
   */
  clamp(rowCount: number): void {
    // The grid has `rowCount` data rows PLUS the add-controls row at index
    // `rowCount` (the "+ Text" / "+ List" buttons), which the cursor may rest
    // on — so clamp against `rowCount + 1` navigable rows.
    const next = clampCell(this.cell, rowCount + 1);
    // Only write when the position actually changes, so an effect that re-runs
    // this on every render doesn't churn a fresh object reference (which would
    // retrigger cursor-dependent effects in a loop).
    if (next.row !== this.cell.row || next.col !== this.cell.col) this.cell = next;
  }

  /**
   * Handle a within-Properties keydown in NAV mode. Returns true when the key
   * was handled (the caller should then `preventDefault`). Movement CLAMPS at the
   * grid edges (see `$lib/propertiesGrid`).
   *
   * Modified chords belong to the global handler (Alt = Region move) — EXCEPT
   * Ctrl+C / Ctrl+V, which this claims so nav mode can copy/paste the whole cell
   * value as a string. Edit mode never reaches here (the input has focus and the
   * keys it cares about are handled in `handleEditKeydown`).
   */
  handleNavKeydown(e: KeyboardEvent, actions: PropertiesNavActions): boolean {
    const rowCount = actions.rowCount();
    // The add-controls row ("+ Text" / "+ List") sits at index `rowCount`, one
    // past the last data row, and is navigable like any other row: col 0 is the
    // "+ Text" button, col 1 the "+ List" button. Movement runs over
    // `rowCount + 1` rows so ↓ from the last data row lands on it and ←/→ move
    // between the two buttons; Enter ACTIVATES the focused button.
    const navRows = rowCount + 1;
    const onAddRow = this.cell.row === rowCount;

    // Nav-mode clipboard: copy/paste the whole cell value as a string. Claimed
    // BEFORE the modified-chord guard below (which would otherwise yield Ctrl to
    // the global handler). Plain Ctrl/Cmd only — no Alt/Shift.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      const k = e.key.toLowerCase();
      if (k === 'c') {
        actions.copyCell(this.cell);
        return true;
      }
      if (k === 'v') {
        actions.pasteCell(this.cell);
        return true;
      }
      return false; // other Ctrl chords (undo/redo/palettes) → global handler
    }

    // Never claim other modified chords: those belong to the global handler
    // (Alt = Region move). Only plain keys navigate / act on the grid.
    if (!isPlainKey(e)) return false;

    switch (e.key) {
      case 'ArrowUp':
        this.cell = moveCell(this.cell, 'up', navRows);
        return true;
      case 'ArrowDown':
        this.cell = moveCell(this.cell, 'down', navRows);
        return true;
      case 'ArrowLeft':
        this.cell = moveCell(this.cell, 'left', navRows);
        return true;
      case 'ArrowRight':
        this.cell = moveCell(this.cell, 'right', navRows);
        return true;
      case 'Enter':
      case 'F2': {
        // On the add-controls row, Enter ACTIVATES the focused button rather
        // than entering edit mode: col 0 = "+ Text" (scalar), col 1 = "+ List".
        if (onAddRow) {
          if (this.cell.col === VALUE_COL) actions.addList();
          else actions.addRow();
          return true;
        }
        // A LIST value cell drops into chip SUB-NAV (CHIPS mode) rather than
        // edit mode: focus lands on the first chip (or the new-tag input when
        // the list is empty). PropertyRow owns the strip's keys + DOM focus.
        if (this.cell.col === VALUE_COL && actions.valueKind(this.cell.row) === 'list') {
          this.toChips(0);
          return true;
        }
        // Read-only raw value cells have no edit mode — `enterEdit` just focuses
        // the textarea for select/copy. We still flip to `edit` so Escape exits.
        this.mode = 'edit';
        actions.enterEdit(this.cell);
        return true;
      }
      case 'a':
        // `a` appends a new scalar row from anywhere (including the add row and
        // the empty grid), matching the "+ Text" button.
        actions.addRow();
        return true;
      case 'd':
        // The add-controls row has no property to delete.
        if (onAddRow) return true;
        actions.deleteRow(this.cell.row);
        return true;
      default:
        return false;
    }
  }

  // NOTE: edit-mode key handling (Enter commit+down / Tab commit+right / Escape
  // cancel) lives in Properties.svelte, where the focused cell's KIND is known
  // (key vs scalar vs list vs raw) and the per-input commit/cancel handlers are
  // in scope. The store deliberately owns only the cursor + mode + pure nav math.
}

export const propertiesNav = new PropertiesNavStore();
export { KEY_COL, VALUE_COL };
