import { test, expect } from 'bun:test';
import { isOwnEcho } from './concurrency';
import type { FileChange } from '$lib/types';

const withOrigin = (clientId: string): FileChange => ({
  kind: 'modified',
  paths: ['a.md'],
  origin: { clientId, author: { name: 'Ada' } },
});

test('isOwnEcho is true only for our own clientId', () => {
  expect(isOwnEcho(withOrigin('me'), 'me')).toBe(true);
  expect(isOwnEcho(withOrigin('someone-else'), 'me')).toBe(false);
});

test('a change with no origin (external/desktop) is never our echo', () => {
  expect(isOwnEcho({ kind: 'modified', paths: ['a.md'] }, 'me')).toBe(false);
});
