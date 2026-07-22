import { test, expect } from 'bun:test';
import { paneTitle } from './paneTitle';
import type { Property } from './frontmatter';

const scalar = (key: string, value: string): Property => ({ key, kind: 'scalar', scalar: value });

test('paneTitle: empty when nothing is open', () => {
  expect(paneTitle(null, [])).toBe('');
});

test('paneTitle: prefers a non-empty frontmatter title', () => {
  expect(paneTitle('concepts/codemirror.md', [scalar('title', 'CodeMirror 6')])).toBe(
    'CodeMirror 6',
  );
});

test('paneTitle: falls back to the filename stem when no title', () => {
  expect(paneTitle('concepts/editor/live-preview.md', [])).toBe('live-preview');
});

test('paneTitle: falls back when the title is blank/whitespace', () => {
  expect(paneTitle('concepts/bundle.md', [scalar('title', '   ')])).toBe('bundle');
});

test('paneTitle: ignores a non-scalar title property', () => {
  const listTitle: Property = { key: 'title', kind: 'list', list: ['a', 'b'] };
  expect(paneTitle('concepts/bundle.md', [listTitle])).toBe('bundle');
});

test('paneTitle: root-level Concept uses its stem', () => {
  expect(paneTitle('index.md', [])).toBe('index');
});
