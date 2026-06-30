import { describe, expect, test } from 'bun:test';
import { isPlainKey } from './keynav';

const flags = (over: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {}) => ({
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...over,
});

describe('isPlainKey', () => {
  test('true when no modifier is held', () => {
    expect(isPlainKey(flags())).toBe(true);
  });

  test('false when any single modifier is held', () => {
    expect(isPlainKey(flags({ altKey: true }))).toBe(false);
    expect(isPlainKey(flags({ ctrlKey: true }))).toBe(false);
    expect(isPlainKey(flags({ metaKey: true }))).toBe(false);
    expect(isPlainKey(flags({ shiftKey: true }))).toBe(false);
  });

  test('false when several modifiers are held', () => {
    expect(isPlainKey(flags({ ctrlKey: true, shiftKey: true }))).toBe(false);
  });
});
