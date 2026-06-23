// Unit tests for the pure mermaid block detection (ADR-0005).
// Run with `bun test src/lib`. Builds a real CodeMirror EditorState over the
// GFM markdown language (no DOM needed) and pins: a mermaid fence is detected
// with the right source + ranges, a non-mermaid fence is ignored, and the
// cursor-overlap helper that drives the hybrid reveal.
import { describe, expect, test } from 'bun:test';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  findMermaidBlocks,
  hasMermaidBlock,
  mermaidCacheKey,
  mermaidThemeConfig,
  selectionTouches,
} from './mermaidBlocks';

/** Build an EditorState with the GFM parser (so FencedCode nodes exist). */
function stateOf(doc: string, selection?: { anchor: number; head?: number }) {
  return EditorState.create({
    doc,
    selection: selection ? { anchor: selection.anchor, head: selection.head } : undefined,
    extensions: [markdown({ base: markdownLanguage })],
  });
}

// parseMs=0 makes detection read the already-parsed tree synchronously (no
// `ensureSyntaxTree` budget needed for these small docs).
const PARSE = 0;

describe('findMermaidBlocks', () => {
  test('detects a mermaid fence and returns its source', () => {
    const doc = ['# Title', '', '```mermaid', 'graph TD', 'A --> B', '```', '', 'after'].join(
      '\n',
    );
    const blocks = findMermaidBlocks(stateOf(doc), PARSE);
    expect(blocks.length).toBe(1);
    expect(blocks[0].source).toBe('graph TD\nA --> B');
  });

  test('returns the document range of the whole fence', () => {
    const doc = 'before\n\n```mermaid\ngraph TD\n```\n\nafter';
    const state = stateOf(doc);
    const blocks = findMermaidBlocks(state, PARSE);
    expect(blocks.length).toBe(1);
    // The range must span the opening ``` through the closing ```.
    const sliced = state.doc.sliceString(blocks[0].from, blocks[0].to);
    expect(sliced.startsWith('```mermaid')).toBe(true);
    expect(sliced.trimEnd().endsWith('```')).toBe(true);
  });

  test('ignores a non-mermaid fenced block', () => {
    const doc = '```python\nprint("hi")\n```';
    expect(findMermaidBlocks(stateOf(doc), PARSE)).toEqual([]);
  });

  test('ignores fences with no info string', () => {
    const doc = '```\nplain code\n```';
    expect(findMermaidBlocks(stateOf(doc), PARSE)).toEqual([]);
  });

  test('matches the info case-insensitively', () => {
    const doc = '```Mermaid\ngraph TD\n```';
    expect(findMermaidBlocks(stateOf(doc), PARSE).length).toBe(1);
  });

  test('finds multiple mermaid fences', () => {
    const doc = '```mermaid\nA\n```\n\ntext\n\n```mermaid\nB\n```';
    const blocks = findMermaidBlocks(stateOf(doc), PARSE);
    expect(blocks.map((b) => b.source)).toEqual(['A', 'B']);
  });

  test('an empty mermaid fence yields an empty source', () => {
    const doc = '```mermaid\n```';
    const blocks = findMermaidBlocks(stateOf(doc), PARSE);
    expect(blocks.length).toBe(1);
    expect(blocks[0].source).toBe('');
  });
});

describe('hasMermaidBlock', () => {
  test('true when a mermaid fence is present', () => {
    expect(hasMermaidBlock(stateOf('```mermaid\ngraph TD\n```'), PARSE)).toBe(true);
  });
  test('false for a document with no mermaid fence', () => {
    expect(hasMermaidBlock(stateOf('# just prose\n\n```js\nx\n```'), PARSE)).toBe(false);
  });
});

describe('selectionTouches', () => {
  test('true when the cursor sits inside the range', () => {
    const doc = '```mermaid\ngraph TD\n```';
    const [block] = findMermaidBlocks(stateOf(doc), PARSE);
    // Cursor in the middle of the fence body.
    const state = stateOf(doc, { anchor: block.from + 14 });
    expect(selectionTouches(state, block.from, block.to)).toBe(true);
  });

  test('false when the cursor is outside the range', () => {
    const doc = 'prose\n\n```mermaid\ngraph TD\n```';
    const [block] = findMermaidBlocks(stateOf(doc), PARSE);
    // Cursor at offset 0 (in the prose before the fence).
    const state = stateOf(doc, { anchor: 0 });
    expect(selectionTouches(state, block.from, block.to)).toBe(false);
  });

  test('true when the cursor sits exactly on the fence start (arrowing in)', () => {
    const doc = 'prose\n\n```mermaid\ngraph TD\n```';
    const [block] = findMermaidBlocks(stateOf(doc), PARSE);
    const state = stateOf(doc, { anchor: block.from });
    expect(selectionTouches(state, block.from, block.to)).toBe(true);
  });
});

describe('mermaidThemeConfig', () => {
  // A reader that echoes the var name back, so we can assert which app token maps
  // to which mermaid variable without a real DOM / getComputedStyle.
  const echo = (name: string) => name;

  test("always uses mermaid's overridable 'base' theme", () => {
    expect(mermaidThemeConfig(echo, 'light').theme).toBe('base');
    expect(mermaidThemeConfig(echo, 'dark').theme).toBe('base');
  });

  test('drives nodes from the app palette: surface fill, foreground border + text', () => {
    const { themeVariables } = mermaidThemeConfig(echo, 'dark');
    expect(themeVariables.primaryColor).toBe('--bg-elevated');
    expect(themeVariables.mainBkg).toBe('--bg-elevated');
    expect(themeVariables.primaryBorderColor).toBe('--text');
    expect(themeVariables.nodeBorder).toBe('--text');
    expect(themeVariables.primaryTextColor).toBe('--text');
    expect(themeVariables.lineColor).toBe('--text-muted');
  });

  test('uses the app UI font (top-level and in themeVariables)', () => {
    const cfg = mermaidThemeConfig(echo, 'light');
    expect(cfg.fontFamily).toBe('--font-ui');
    expect(cfg.themeVariables.fontFamily).toBe('--font-ui');
  });

  test('sets darkMode from the resolved theme', () => {
    expect(mermaidThemeConfig(echo, 'dark').themeVariables.darkMode).toBe(true);
    expect(mermaidThemeConfig(echo, 'light').themeVariables.darkMode).toBe(false);
  });
});

describe('mermaidCacheKey', () => {
  test('identical source + theme yields the same key (cache hit / DOM reuse)', () => {
    expect(mermaidCacheKey('graph TD\nA-->B', 'light')).toBe(
      mermaidCacheKey('graph TD\nA-->B', 'light'),
    );
  });

  test('different source yields a different key', () => {
    expect(mermaidCacheKey('graph TD\nA-->B', 'light')).not.toBe(
      mermaidCacheKey('graph TD\nA-->C', 'light'),
    );
  });

  test('a theme flip yields a different key for the same source (re-render)', () => {
    expect(mermaidCacheKey('graph TD\nA-->B', 'light')).not.toBe(
      mermaidCacheKey('graph TD\nA-->B', 'dark'),
    );
  });

  test('the theme token cannot collide with source text', () => {
    // Even if the source happens to start with a theme-like word, the prefix
    // keeps the two pairs distinct.
    expect(mermaidCacheKey('dark graph', 'light')).not.toBe(
      mermaidCacheKey('graph', 'dark'),
    );
  });
});
