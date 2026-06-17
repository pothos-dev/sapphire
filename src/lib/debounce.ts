// Trailing-edge debounce timer (pure; no DOM/IPC).
//
// Owns ONLY the cancel-and-reschedule timer mechanics shared by the autosave
// (editor) and session-persistence stores. Callers keep their own "should I
// actually run / flush" logic — this just collapses rapid `schedule()` calls
// into a single deferred `action()` run.

export interface Debouncer {
  /** (Re)start the timer; `action` runs once `ms` elapse with no new schedule. */
  schedule(): void;
  /** Cancel a pending run, if any, without running it. */
  cancel(): void;
}

/** Create a debouncer that runs `action` `ms` after the last `schedule()`. */
export function createDebouncer(action: () => void, ms: number): Debouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  function cancel(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }
  return {
    schedule(): void {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        action();
      }, ms);
    },
    cancel,
  };
}
