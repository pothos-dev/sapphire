// Unit tests for the review-toggle availability helper. Run with `bun test src/lib`.
import { describe, expect, test } from 'bun:test';
import { reviewAvailability, REVIEW_ENABLED_TOOLTIP } from './review';
import type { FileHistory } from '$lib/types';

describe('reviewAvailability', () => {
  test('ok history enables the toggle with the review tooltip', () => {
    const history: FileHistory = { status: 'ok', commits: [] };
    expect(reviewAvailability(history)).toEqual({
      enabled: true,
      tooltip: REVIEW_ENABLED_TOOLTIP,
    });
  });

  test('null (still loading) keeps the toggle disabled', () => {
    const avail = reviewAvailability(null);
    expect(avail.enabled).toBe(false);
    expect(avail.tooltip.length).toBeGreaterThan(0);
  });

  test('every unavailable status disables the toggle with a distinct, non-empty tooltip', () => {
    const statuses: FileHistory['status'][] = [
      'notARepo',
      'untracked',
      'noHistory',
      'gitMissing',
    ];
    const tooltips = new Set<string>();
    for (const status of statuses) {
      const avail = reviewAvailability({ status } as FileHistory);
      expect(avail.enabled).toBe(false);
      expect(avail.tooltip.trim().length).toBeGreaterThan(0);
      tooltips.add(avail.tooltip);
    }
    // Each unavailable reason has its OWN explanatory tooltip.
    expect(tooltips.size).toBe(statuses.length);
  });
});
