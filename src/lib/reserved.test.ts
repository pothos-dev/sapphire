// Unit tests for the reserved-file helper (pure path logic).
// Run with `bun test src/lib`.
import { describe, expect, test } from 'bun:test';
import { isReservedFile, reservedKind, reservedPath, reservedStub } from './reserved';

describe('isReservedFile', () => {
  test('detects index.md / log.md at any level, case-insensitive', () => {
    expect(isReservedFile('index.md')).toBe(true);
    expect(isReservedFile('a/b/log.md')).toBe(true);
    expect(isReservedFile('a/INDEX.MD')).toBe(true);
  });
  test('ordinary Concepts are not reserved', () => {
    expect(isReservedFile('notes.md')).toBe(false);
    expect(isReservedFile('a/index-of-things.md')).toBe(false);
  });
});

describe('reservedKind', () => {
  test('maps to index / log / null', () => {
    expect(reservedKind('x/index.md')).toBe('index');
    expect(reservedKind('log.md')).toBe('log');
    expect(reservedKind('other.md')).toBeNull();
  });
});

describe('reservedPath', () => {
  test('joins folder and reserved basename', () => {
    expect(reservedPath('', 'index')).toBe('index.md');
    expect(reservedPath('a/b', 'log')).toBe('a/b/log.md');
  });
});

describe('reservedStub', () => {
  test('derives a heading from the folder', () => {
    expect(reservedStub('', 'index')).toBe('# Bundle\n');
    expect(reservedStub('a/b', 'index')).toBe('# b\n');
    expect(reservedStub('a/b', 'log')).toBe('# Log — b\n');
  });
});
