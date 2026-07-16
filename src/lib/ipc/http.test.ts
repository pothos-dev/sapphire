import { test, expect } from 'bun:test';
import { parseFileChange } from './http';

// Pure parsing of an SSE `data:` payload into a `FileChange` (the `EventSource`
// bridge in `onFileChanged` only forwards a non-null result to the callback).

test('parses a well-formed change payload for each kind', () => {
  for (const kind of ['created', 'modified', 'removed'] as const) {
    expect(parseFileChange(JSON.stringify({ kind, paths: ['a/b.md'] }))).toEqual({
      kind,
      paths: ['a/b.md'],
    });
  }
});

test('parses multiple paths', () => {
  expect(parseFileChange('{"kind":"modified","paths":["x.md","y/z.md"]}')).toEqual({
    kind: 'modified',
    paths: ['x.md', 'y/z.md'],
  });
});

test('rejects malformed JSON', () => {
  expect(parseFileChange('not json')).toBeNull();
  expect(parseFileChange('')).toBeNull();
});

test('rejects an unknown kind or wrong-typed fields', () => {
  expect(parseFileChange('{"kind":"renamed","paths":["a.md"]}')).toBeNull();
  expect(parseFileChange('{"kind":"created"}')).toBeNull();
  expect(parseFileChange('{"kind":"created","paths":"a.md"}')).toBeNull();
  expect(parseFileChange('{"kind":"created","paths":[1,2]}')).toBeNull();
});
