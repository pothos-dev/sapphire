import { describe, expect, test } from 'bun:test';
import { rewriteAnchorsIn } from './anchorRewrite';

const ALL = ['a.md', 'target.md', 'other.md'];
const r = (from: string, to: string) => [{ from, to }];

describe('rewriteAnchorsIn — wikilinks', () => {
  test('rewrites a bare wikilink anchor pointing at the target', () => {
    const { content, count } = rewriteAnchorsIn(
      'a.md',
      'see [[target#deep-section]] here',
      'target.md',
      r('deep-section', 'deeper-section'),
      ALL,
    );
    expect(content).toBe('see [[target#deeper-section]] here');
    expect(count).toBe(1);
  });

  test('preserves an alias while swapping the anchor', () => {
    const { content, count } = rewriteAnchorsIn(
      'a.md',
      '[[target#old|Label]]',
      'target.md',
      r('old', 'new'),
      ALL,
    );
    expect(content).toBe('[[target#new|Label]]');
    expect(count).toBe(1);
  });

  test('migrates an older literal anchor to the canonical slug', () => {
    const { content, count } = rewriteAnchorsIn(
      'a.md',
      '[[target#Deep Section]]',
      'target.md',
      r('deep-section', 'intro'),
      ALL,
    );
    expect(content).toBe('[[target#intro]]');
    expect(count).toBe(1);
  });

  test('leaves anchors to other targets and non-matching slugs alone', () => {
    const { content, count } = rewriteAnchorsIn(
      'a.md',
      '[[other#deep-section]] [[target#nope]] [[target#deep-section]]',
      'target.md',
      r('deep-section', 'x'),
      ALL,
    );
    expect(content).toBe('[[other#deep-section]] [[target#nope]] [[target#x]]');
    expect(count).toBe(1);
  });

  test('rewrites same-file anchors when source === target', () => {
    // In the open buffer, `[[#slug]]` resolves to the source itself.
    const { content, count } = rewriteAnchorsIn(
      'target.md',
      'jump to [[#old]] and [[target#old]]',
      'target.md',
      r('old', 'new'),
      ALL,
    );
    expect(content).toBe('jump to [[#new]] and [[target#new]]');
    expect(count).toBe(2);
  });

  test('skips code spans, fences and embeds', () => {
    const body =
      'real [[target#old]]\n```\ncode [[target#old]]\n```\n' +
      'inline `[[target#old]]` and ![[target#old]]';
    const { content, count } = rewriteAnchorsIn('a.md', body, 'target.md', r('old', 'new'), ALL);
    expect(content).toBe(
      'real [[target#new]]\n```\ncode [[target#old]]\n```\n' +
        'inline `[[target#old]]` and ![[target#old]]',
    );
    expect(count).toBe(1);
  });
});

describe('rewriteAnchorsIn — markdown links', () => {
  test('rewrites a markdown link anchor', () => {
    const { content, count } = rewriteAnchorsIn(
      'a.md',
      'See [it](/target.md#old) now.',
      'target.md',
      r('old', 'new'),
      ALL,
    );
    expect(content).toBe('See [it](/target.md#new) now.');
    expect(count).toBe(1);
  });

  test('preserves a query and title around the anchor', () => {
    const { content, count } = rewriteAnchorsIn(
      'a.md',
      '[it](/target.md#old?x=1 "Title")',
      'target.md',
      r('old', 'new'),
      ALL,
    );
    expect(content).toBe('[it](/target.md#new?x=1 "Title")');
    expect(count).toBe(1);
  });

  test('does not touch images or external links', () => {
    const { content, count } = rewriteAnchorsIn(
      'a.md',
      '![img](/target.md#old) [ext](https://x.dev/target.md#old)',
      'target.md',
      r('old', 'new'),
      ALL,
    );
    expect(content).toBe('![img](/target.md#old) [ext](https://x.dev/target.md#old)');
    expect(count).toBe(0);
  });
});

test('no renames is a no-op', () => {
  const { content, count } = rewriteAnchorsIn('a.md', '[[target#old]]', 'target.md', [], ALL);
  expect(content).toBe('[[target#old]]');
  expect(count).toBe(0);
});
