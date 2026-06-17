// Unit tests for the Outline heading scan (pure markdown function).
// Run with `bun test src/lib`. Pins current scanHeadings behavior incl. the
// frontmatter line offset and fenced-code skipping.
import { describe, expect, test } from 'bun:test';
import { scanHeadings } from './outline';

describe('scanHeadings', () => {
  test('no frontmatter: 1-based body line numbers', () => {
    expect(scanHeadings('# A\n## B')).toEqual([
      { level: 1, text: 'A', line: 1 },
      { level: 2, text: 'B', line: 2 },
    ]);
  });

  test('frontmatter offset is added to body heading line numbers', () => {
    const content =
      '---\ntype: x\n---\n# H1\ntext\n## H2\n```\n# not heading\n```\n### H3\n';
    expect(scanHeadings(content)).toEqual([
      { level: 1, text: 'H1', line: 4 },
      { level: 2, text: 'H2', line: 6 },
      { level: 3, text: 'H3', line: 10 },
    ]);
  });

  test('headings inside fenced code blocks are skipped', () => {
    const content = '# real\n```\n# fake\n```\n# real2';
    expect(scanHeadings(content)).toEqual([
      { level: 1, text: 'real', line: 1 },
      { level: 1, text: 'real2', line: 5 },
    ]);
  });

  test('a closing fence must use the same marker character', () => {
    // The `~~~` does not close a ```` ``` ```` block, so the `# inside` stays code.
    const content = '```\n# inside\n~~~\n# still inside\n```\n# after';
    expect(scanHeadings(content)).toEqual([{ level: 1, text: 'after', line: 6 }]);
  });

  test('heading marker text is trimmed', () => {
    expect(scanHeadings('###   spaced   ')).toEqual([
      { level: 3, text: 'spaced', line: 1 },
    ]);
  });
});
