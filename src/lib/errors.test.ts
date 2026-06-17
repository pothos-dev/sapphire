import { describe, expect, test } from 'bun:test';
import { errMessage } from './errors';

describe('errMessage', () => {
  test('returns an Error message', () => {
    expect(errMessage(new Error('boom'))).toBe('boom');
  });
  test('stringifies non-Error values', () => {
    expect(errMessage('plain string')).toBe('plain string');
    expect(errMessage(42)).toBe('42');
    expect(errMessage(null)).toBe('null');
  });
});
