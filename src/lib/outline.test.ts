// Unit tests for the Outline heading scan (pure markdown function).
// Run with `bun test src/lib`. Pins current scanHeadings behavior incl. the
// frontmatter line offset, fenced-code skipping, and GitHub-style anchor slugs.
import { describe, expect, test } from 'bun:test';
import { findHeadingLine, scanHeadings } from './outline';

describe('scanHeadings', () => {
  test('no frontmatter: 1-based body line numbers + slugs', () => {
    expect(scanHeadings('# A\n## B')).toEqual([
      { level: 1, text: 'A', line: 1, slug: 'a' },
      { level: 2, text: 'B', line: 2, slug: 'b' },
    ]);
  });

  test('frontmatter offset is added to body heading line numbers', () => {
    const content =
      '---\ntype: x\n---\n# H1\ntext\n## H2\n```\n# not heading\n```\n### H3\n';
    expect(scanHeadings(content)).toEqual([
      { level: 1, text: 'H1', line: 4, slug: 'h1' },
      { level: 2, text: 'H2', line: 6, slug: 'h2' },
      { level: 3, text: 'H3', line: 10, slug: 'h3' },
    ]);
  });

  test('headings inside fenced code blocks are skipped', () => {
    const content = '# real\n```\n# fake\n```\n# real2';
    expect(scanHeadings(content)).toEqual([
      { level: 1, text: 'real', line: 1, slug: 'real' },
      { level: 1, text: 'real2', line: 5, slug: 'real2' },
    ]);
  });

  test('a closing fence must use the same marker character', () => {
    // The `~~~` does not close a ```` ``` ```` block, so the `# inside` stays code.
    const content = '```\n# inside\n~~~\n# still inside\n```\n# after';
    expect(scanHeadings(content)).toEqual([
      { level: 1, text: 'after', line: 6, slug: 'after' },
    ]);
  });

  test('heading marker text is trimmed', () => {
    expect(scanHeadings('###   spaced   ')).toEqual([
      { level: 3, text: 'spaced', line: 1, slug: 'spaced' },
    ]);
  });

  test('multi-word headings get GitHub-style slugs, deduped in order', () => {
    expect(scanHeadings('# Deep Section\n# Notes\n# Notes')).toEqual([
      { level: 1, text: 'Deep Section', line: 1, slug: 'deep-section' },
      { level: 1, text: 'Notes', line: 2, slug: 'notes' },
      { level: 1, text: 'Notes', line: 3, slug: 'notes-1' },
    ]);
  });
});

describe('findHeadingLine', () => {
  test('matches by GitHub slug, returns the full-doc line', () => {
    const content = '---\ntype: x\n---\n# Intro\n## Deep Section\n';
    expect(findHeadingLine(content, 'deep-section')).toBe(5);
    expect(findHeadingLine(content, 'intro')).toBe(4);
  });

  test('backward-compatible: a literal (pre-slug) anchor still resolves', () => {
    const content = '---\ntype: x\n---\n# Intro\n## Deep Section\n';
    expect(findHeadingLine(content, 'Deep Section')).toBe(5);
  });

  test('resolves a deduped slug to the right occurrence', () => {
    const content = '# Notes\n## Notes';
    expect(findHeadingLine(content, 'notes')).toBe(1);
    expect(findHeadingLine(content, 'notes-1')).toBe(2);
  });

  test('returns null when no heading matches', () => {
    expect(findHeadingLine('# A\n## B', 'missing')).toBeNull();
  });
});
