import { describe, expect, test } from 'bun:test';
import { createDebouncer } from './debounce';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('createDebouncer', () => {
  test('runs the action once after the quiet period', async () => {
    let calls = 0;
    const d = createDebouncer(() => calls++, 5);
    d.schedule();
    await sleep(20);
    expect(calls).toBe(1);
  });

  test('rapid schedules collapse into a single run', async () => {
    let calls = 0;
    const d = createDebouncer(() => calls++, 5);
    d.schedule();
    d.schedule();
    d.schedule();
    await sleep(20);
    expect(calls).toBe(1);
  });

  test('cancel prevents a pending run', async () => {
    let calls = 0;
    const d = createDebouncer(() => calls++, 5);
    d.schedule();
    d.cancel();
    await sleep(20);
    expect(calls).toBe(0);
  });
});
