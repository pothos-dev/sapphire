import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

// ---------------------------------------------------------------------------
// Mermaid block detection (slice: mermaid-block-render, ADR-0005)
//
// Pure, DOM-free detection of ` ```mermaid ` fenced code blocks in a CodeMirror
// document. Kept separate from the render/widget shell (mermaid.ts) so it is
// unit-testable, following the `path.ts` / `outline.ts` convention.
//
// A Diagram (docs/GLOSSARY.md) is the rendered output of a `FencedCode` node whose
// info string is exactly `mermaid`. This module finds those nodes and returns,
// for each, the raw mermaid SOURCE (the fence body, between the open/close
// markers) and the DOCUMENT RANGE of the whole fence (so the render shell can
// `Decoration.replace` over it). All higher layers (lazy import, rendering,
// cursor-overlap reveal) build on these ranges.
// ---------------------------------------------------------------------------

/** A detected mermaid fence: its source and the doc range of the whole fence. */
export interface MermaidBlock {
  /** The diagram source — the fence BODY, excluding the ``` markers/info line. */
  readonly source: string;
  /** Start offset of the whole fence (the opening ``` ) in the document. */
  readonly from: number;
  /** End offset of the whole fence (after the closing ``` ) in the document. */
  readonly to: number;
}

/**
 * The fenced-code info string we treat as a diagram. docs/GLOSSARY.md "Diagram":
 * a fenced code block whose info is `mermaid`. Matched case-insensitively and
 * trimmed (mirrors how markdown info strings are read elsewhere).
 */
const MERMAID_INFO = 'mermaid';

/**
 * Read the info string of a `FencedCode` node (the text after the opening
 * ``` on the first line). Returns the trimmed, lower-cased info, or '' when the
 * fence has no info. Reads the `CodeInfo` child when present; otherwise derives
 * it from the opening line so a fence parsed before its `CodeInfo` child exists
 * still classifies correctly.
 */
function fenceInfo(state: EditorState, fenceFrom: number, fenceTo: number): string {
  const tree = syntaxTree(state);
  const cursor = tree.cursorAt(fenceFrom, 1);
  // Walk into the FencedCode node's children to find CodeInfo.
  if (cursor.firstChild()) {
    do {
      if (cursor.name === 'CodeInfo') {
        return state.doc.sliceString(cursor.from, cursor.to).trim().toLowerCase();
      }
      if (cursor.from > fenceTo) break;
    } while (cursor.nextSibling());
  }
  // Fallback: parse the info off the opening line (after the ``` / ~~~ marker).
  const firstLine = state.doc.lineAt(fenceFrom).text;
  const match = firstLine.match(/^\s*(?:`{3,}|~{3,})\s*([^\s`]*)/);
  return (match?.[1] ?? '').trim().toLowerCase();
}

/**
 * Extract the diagram source (fence body) from a `FencedCode` node range: the
 * lines strictly between the opening fence line and the closing fence line.
 * Returns '' for an empty/unclosed fence body. Pure string slicing on the doc.
 */
function fenceBody(state: EditorState, fenceFrom: number, fenceTo: number): string {
  const startLine = state.doc.lineAt(fenceFrom);
  const endLine = state.doc.lineAt(fenceTo);
  // Body is the lines after the opening line up to (but not including) the
  // closing fence line. A single-line/unclosed fence has no body.
  const bodyFromLine = startLine.number + 1;
  // If the fence closes (its last line is a fence marker), drop that line;
  // otherwise (unclosed, EOF) the body runs to the last line.
  const lastLineText = endLine.text;
  const closes = /^\s*(?:`{3,}|~{3,})\s*$/.test(lastLineText);
  const bodyToLine = closes ? endLine.number - 1 : endLine.number;
  if (bodyToLine < bodyFromLine) return '';
  const from = state.doc.line(bodyFromLine).from;
  const to = state.doc.line(bodyToLine).to;
  return state.doc.sliceString(from, to);
}

/**
 * Find every mermaid fence in the document.
 *
 * Pushes the parser across the whole doc with a budget (like `imageBlocks`) so
 * fences past the initial budgeted parse window are still found — the render
 * shell additionally rebuilds on `treeGrowthEffect` for very long documents.
 *
 * @param state    the editor state to scan.
 * @param parseMs  budget for `ensureSyntaxTree` (default 200ms, matching
 *                 atomic-editor's block builders); 0 in tests to use the
 *                 already-parsed tree synchronously.
 */
export function findMermaidBlocks(state: EditorState, parseMs = 200): MermaidBlock[] {
  const tree =
    (parseMs > 0 ? ensureSyntaxTree(state, state.doc.length, parseMs) : null) ??
    syntaxTree(state);
  const blocks: MermaidBlock[] = [];
  tree.iterate({
    enter: (node) => {
      if (node.name !== 'FencedCode') return;
      if (fenceInfo(state, node.from, node.to) !== MERMAID_INFO) return;
      blocks.push({
        source: fenceBody(state, node.from, node.to),
        from: node.from,
        to: node.to,
      });
    },
  });
  return blocks;
}

/**
 * True when the document contains at least one mermaid fence. The render shell
 * uses this to GATE the lazy `import('mermaid')` — documents with no diagram
 * never pay mermaid's (large) bundle cost (ADR-0005).
 */
export function hasMermaidBlock(state: EditorState, parseMs = 200): boolean {
  return findMermaidBlocks(state, parseMs).length > 0;
}

/**
 * True when the selection (any range) overlaps `[from, to]`. Used by the render
 * shell to decide whether to LIFT a diagram's block-replace and reveal the raw
 * fence for editing (hybrid). A cursor sitting exactly at either edge counts as
 * inside, so arrowing into the fence reveals it.
 */
export function selectionTouches(state: EditorState, from: number, to: number): boolean {
  for (const range of state.selection.ranges) {
    if (range.from <= to && range.to >= from) return true;
  }
  return false;
}

// Diagram theming (mermaid `base` theme + app-palette `themeVariables`) and the
// render cache key are now pure, CodeMirror-free helpers in `./mermaidTheme`,
// shared with the web viewer's mermaid island. Re-exported here so this module's
// existing importers (editor/mermaid.ts, the tests) are unchanged.
export {
  mermaidThemeConfig,
  mermaidCacheKey,
  type ResolvedTheme,
  type CssVarReader,
  type MermaidThemeConfig,
} from './mermaidTheme';
