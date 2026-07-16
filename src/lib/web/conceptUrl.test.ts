import { describe, expect, test } from 'bun:test';
import type { TreeNode } from '$lib/types';
import type { RenderPayload } from './render';
import { collectFilePaths, conceptToUrl, urlToConcept, conceptTitle } from './conceptUrl';

const tree: TreeNode = {
  name: 'bundle',
  path: '',
  isDir: true,
  children: [
    { name: 'index.md', path: 'index.md', isDir: false },
    { name: 'good.md', path: 'good.md', isDir: false },
    {
      name: 'providers',
      path: 'providers',
      isDir: true,
      children: [{ name: 'index.md', path: 'providers/index.md', isDir: false }],
    },
    {
      name: 'research',
      path: 'research',
      isDir: true,
      children: [
        {
          name: 'providers',
          path: 'research/providers',
          isDir: true,
          children: [
            { name: 'mistral-ai.md', path: 'research/providers/mistral-ai.md', isDir: false },
          ],
        },
      ],
    },
  ],
};

describe('conceptToUrl', () => {
  test('drops .md and a trailing /index; root index → /', () => {
    expect(conceptToUrl('index.md')).toBe('/');
    expect(conceptToUrl('providers/index.md')).toBe('/providers');
    expect(conceptToUrl('research/providers/mistral-ai.md')).toBe('/research/providers/mistral-ai');
    expect(conceptToUrl('good.md')).toBe('/good');
  });

  test('percent-encodes each segment', () => {
    expect(conceptToUrl('a b/c d.md')).toBe('/a%20b/c%20d');
  });
});

describe('urlToConcept', () => {
  const files = collectFilePaths(tree);

  test('collects only file paths', () => {
    expect([...files].sort()).toEqual(
      ['good.md', 'index.md', 'providers/index.md', 'research/providers/mistral-ai.md'].sort(),
    );
  });

  test('maps the root to index.md', () => {
    expect(urlToConcept('', files)).toBe('index.md');
    expect(urlToConcept('/', files)).toBe('index.md');
  });

  test('resolves a folder to its index and a leaf to its .md', () => {
    expect(urlToConcept('providers', files)).toBe('providers/index.md');
    expect(urlToConcept('research/providers/mistral-ai', files)).toBe(
      'research/providers/mistral-ai.md',
    );
    expect(urlToConcept('good', files)).toBe('good.md');
  });

  test('returns null when nothing matches', () => {
    expect(urlToConcept('nope', files)).toBeNull();
  });

  test('round-trips every concept path through conceptToUrl', () => {
    for (const p of files) {
      const url = conceptToUrl(p).slice(1); // drop leading '/'
      expect(urlToConcept(url, files)).toBe(p);
    }
  });
});

describe('conceptTitle', () => {
  const render = (over: Partial<RenderPayload>): RenderPayload => ({
    html: '',
    frontmatter: [],
    outline: [],
    ...over,
  });

  test('prefers frontmatter title', () => {
    const r = render({
      frontmatter: [{ key: 'title', values: ['Mistral AI'] }],
      outline: [{ level: 1, text: 'H1 Ignored', slug: 'h1' }],
    });
    expect(conceptTitle('research/providers/mistral-ai.md', r)).toBe('Mistral AI');
  });

  test('falls back to the first H1', () => {
    const r = render({ outline: [{ level: 1, text: 'Good Concept', slug: 'good' }] });
    expect(conceptTitle('good.md', r)).toBe('Good Concept');
  });

  test('falls back to the path name (folder index → folder name)', () => {
    expect(conceptTitle('good.md', render({}))).toBe('good');
    expect(conceptTitle('providers/index.md', render({}))).toBe('providers');
  });

  test('uses Sapphire Web when nothing is open or the path is the root index', () => {
    expect(conceptTitle(null, null)).toBe('Sapphire Web');
    expect(conceptTitle('index.md', render({}))).toBe('Sapphire Web');
  });
});
