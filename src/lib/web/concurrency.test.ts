import { test, expect } from 'bun:test';
import {
  isOwnEcho,
  routeFileChange,
  editToggleLabel,
  structuralOpGated,
} from './concurrency';
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

// --- path-match routing (ticket 08 §2-3) -----------------------------------

const change = (
  kind: FileChange['kind'],
  paths: string[],
  author?: string,
): FileChange => ({
  kind,
  paths,
  ...(author ? { origin: { clientId: 'other', author: { name: author } } } : {}),
});

test('a change to only other files → refresh (buffer untouched)', () => {
  expect(routeFileChange(change('modified', ['other.md'], 'Bob'), 'a.md', true)).toEqual({
    type: 'refresh',
  });
  // Nothing open → any change is just a refresh.
  expect(routeFileChange(change('modified', ['a.md']), null, false)).toEqual({ type: 'refresh' });
});

test('active path modified: clean → reload, dirty → conflict, with author', () => {
  expect(routeFileChange(change('modified', ['a.md'], 'Bob'), 'a.md', false)).toEqual({
    type: 'reload',
    author: 'Bob',
  });
  expect(routeFileChange(change('modified', ['a.md'], 'Bob'), 'a.md', true)).toEqual({
    type: 'conflict',
    author: 'Bob',
  });
});

test('a created event on the active path is treated as modified', () => {
  expect(routeFileChange(change('created', ['a.md']), 'a.md', false)).toEqual({
    type: 'reload',
    author: null,
  });
});

test('active path removed → deleted, carrying dirtiness (recreatable via Save)', () => {
  expect(routeFileChange(change('removed', ['a.md'], 'Bob'), 'a.md', true)).toEqual({
    type: 'deleted',
    author: 'Bob',
    dirty: true,
  });
  expect(routeFileChange(change('removed', ['a.md']), 'a.md', false)).toEqual({
    type: 'deleted',
    author: null,
    dirty: false,
  });
});

test('an external edit (no origin) reloads with a null author', () => {
  expect(routeFileChange(change('modified', ['a.md']), 'a.md', false)).toEqual({
    type: 'reload',
    author: null,
  });
});

// --- toggle label + structural gate (ticket 08 §4-5) -----------------------

test('editToggleLabel is Save when dirty, Done when clean', () => {
  expect(editToggleLabel(true)).toBe('Save');
  expect(editToggleLabel(false)).toBe('Done');
});

test('structural gate: create exempt; rename/move/delete gate only when dirty', () => {
  expect(structuralOpGated('create', true)).toBe(false);
  expect(structuralOpGated('rename', true)).toBe(true);
  expect(structuralOpGated('move', true)).toBe(true);
  expect(structuralOpGated('delete', true)).toBe(true);
  // Clean buffer never gates.
  for (const op of ['create', 'rename', 'move', 'delete'] as const) {
    expect(structuralOpGated(op, false)).toBe(false);
  }
});
